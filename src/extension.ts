/**
 * @file extension.ts
 * @description Main entry point for the TestBench VS Code extension.
 */

// TODO: If possible, hide the tree views initially instead of creating them and then hiding them after.
// TODO: The user generated tests, executed the tests, and restarted the extension. Last generated test params are now invalid due to restart, and he cant import. Use VS Code storage?

// Before releasing the extension:
// TODO: Add License.md to the extension
// TODO: Set logger level to info or debug in production, remove too detailed logs.
// TODO: In production, remove process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; in connection class.
// Note: A virtual python environment is required for the extension to work + an empty pyproject.toml in workspace root.

import * as vscode from "vscode";
import * as testBenchLogger from "./testBenchLogger";
import * as testBenchConnection from "./testBenchConnection";
import * as reportHandler from "./reportHandler";
import * as projectManagementTreeView from "./projectManagementTreeView";
import * as testElementsTreeView from "./testElementsTreeView";
import * as loginWebView from "./loginWebView";
import * as utils from "./utils";
import path from "path";
import {
    allExtensionCommands,
    baseKeyOfExtension,
    ConfigKeys,
    ContextKeys,
    folderNameOfInternalTestbenchFolder,
    TreeItemContextValues
} from "./constants";
import { CycleDataForThemeTreeEvent } from "./projectManagementTreeView";
import { client, restartLanguageClient, stopLanguageClient } from "./server";
import { hideTestThemeTreeView, TestThemeTreeDataProvider } from "./testThemeTreeView";
import { clearTestElementsTreeView, displayTestElementsTreeView } from "./testElementsTreeView";
import {
    TestBenchAuthenticationProvider,
    TESTBENCH_AUTH_PROVIDER_ID,
    TESTBENCH_AUTH_PROVIDER_LABEL
} from "./testBenchAuthenticationProvider";
import * as profileManager from "./profileManager";
import { PlayServerConnection } from "./testBenchConnection";
import { TovStructureOptions } from "./testBenchTypes";

/* =============================================================================
   Constants, Global Variables & Exports
   ============================================================================= */

/** Workspace configuration for the extension. */
let config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKeyOfExtension);
export function getConfig(): vscode.WorkspaceConfiguration {
    return config;
}

/** Global logger instance. */
export let logger: testBenchLogger.TestBenchLogger;
export function setLogger(newLogger: testBenchLogger.TestBenchLogger): void {
    logger = newLogger;
}

/** Global connection to the (new) TestBench Play server. */
export let connection: testBenchConnection.PlayServerConnection | null = null;
export function setConnection(newConnection: testBenchConnection.PlayServerConnection | null): void {
    connection = newConnection;
}

/** Login webview provider instance. */
let loginWebViewProvider: loginWebView.LoginWebViewProvider | null = null;
export function getLoginWebViewProvider(): loginWebView.LoginWebViewProvider | null {
    return loginWebViewProvider;
}

/** Global variables to hold the tree data providers and views. */
export let projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null = null;
export let testThemeTreeDataProvider: TestThemeTreeDataProvider | null = null;
export let testElementsTreeDataProvider: testElementsTreeView.TestElementsTreeDataProvider | undefined;
export let projectTreeView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> | undefined;
export let testThemeTreeView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> | undefined;
export let testElementTreeView: vscode.TreeView<testElementsTreeView.TestElementTreeItem> | undefined;

// Global variable to store the authentication provider instance
let authProviderInstance: TestBenchAuthenticationProvider | null = null;

// Global variable to store the current configuration scope (workspace or global).
let currentConfigScope: vscode.Uri | undefined;
// Global variable to store the active editor instance to determine the best scope for configuration.
let activeEditor: vscode.TextEditor | undefined;
// Prevent multiple session change handling simultaneously
let isHandlingSessionChange = false;

// Prevent multiple session change handling simultaneously
let isHandlingSessionChange: boolean = false;

// Determines if the icon of the tree item should be changed after generating tests for that item.
export const ENABLE_ICON_MARKING_ON_GENERATE: boolean = true;
// Determines if the import button of the tree item should still persist after importing test results for that item.
export const ALLOW_PERSISTENT_IMPORT_BUTTON: boolean = false;

/**
 * Wraps a command handler with error handling to prevent the extension from crashing due to unhandled exceptions in commands.
 * It takes a handler function as input and returns a new function that executes the original handler inside a try/catch block.
 *
 * @param handler The async function to execute.
 * @returns A new async function that wraps the handler with try/catch.
 */
export function safeCommandHandler(handler: (...args: any[]) => any): (...args: any[]) => Promise<void> {
    return async (...args: any[]) => {
        try {
            await handler(...args);
        } catch (error) {
            const errorMessage: string = error instanceof Error ? error.message : "An unknown error occurred";
            logger.error(`Error executing command: ${errorMessage}`, error);
            vscode.window.showErrorMessage(`An error occurred: ${errorMessage}`);
        }
    };
}

/**
 * Registers a command with error handling.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} commandId The command ID string.
 * @param {(...args: any[]) => any} callback The command handler function.
 */
function registerSafeCommand(
    context: vscode.ExtensionContext,
    commandId: string,
    callback: (...args: any[]) => any
): void {
    const disposable: vscode.Disposable = vscode.commands.registerCommand(commandId, async (...args: any[]) => {
        try {
            await callback(...args);
        } catch (error: any) {
            // Errors expected in silent auto-login, dont show error message to user.
            if (commandId === allExtensionCommands.automaticLoginAfterExtensionActivation) {
                logger.warn(
                    `Command ${commandId} error (expected for silent auto-login if conditions not met): ${error.message}`
                );
            } else {
                logger.error(`Command ${commandId} error: ${error.message}`, error);
                vscode.window.showErrorMessage(`Command ${commandId} failed: ${error.message}`);
            }
        }
    });
    context.subscriptions.push(disposable);
}

/**
 * Loads the latest extension configuration and updates the global configuration object.
 * Handles the storage of credentials based on the configuration settings.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function loadConfiguration(context: vscode.ExtensionContext, newScope?: vscode.Uri): Promise<void> {
    if (newScope === undefined) {
        if (activeEditor) {
            newScope = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri;
        } else if (vscode.workspace.workspaceFolders?.length === 1) {
            newScope = vscode.workspace.workspaceFolders[0].uri;
        }
    }

    currentConfigScope = newScope;
    config = vscode.workspace.getConfiguration(baseKeyOfExtension, currentConfigScope);

    const configSource: string = currentConfigScope
        ? `workspace folder: ${vscode.workspace.getWorkspaceFolder(currentConfigScope)?.name}`
        : "global (no workspace)";
    logger.trace(`Loading configuration from ${configSource}`);

    logger.updateCachedLogLevel();
}

/**
 * Initializes the Test Elements Tree View.
 *
 * This function sets up the tree data provider for the test elements,
 * creates the tree view itself, and registers it with the extension's subscriptions.
 * Handles the initial message display if the tree is empty.
 *
 * @param {vscode.ExtensionContext} context - The extension context provided by VS Code, used for managing disposables.
 */
function initializeTestElementsTreeView(context: vscode.ExtensionContext): void {
    testElementsTreeDataProvider = new testElementsTreeView.TestElementsTreeDataProvider((message) => {
        if (testElementTreeView) {
            testElementTreeView.message = message;
        }
    });
    testElementTreeView = vscode.window.createTreeView("testElementsView", {
        treeDataProvider: testElementsTreeDataProvider
    });
    context.subscriptions.push(testElementTreeView);

    if (testElementsTreeDataProvider.isTreeDataEmpty()) {
        testElementsTreeDataProvider.updateTreeViewStatusMessage();
    }
}

/**
 * Initializes the project tree and test elements tree.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export function initializeTreeViews(context: vscode.ExtensionContext): void {
    testThemeTreeDataProvider = new TestThemeTreeDataProvider((message) => {
        if (testThemeTreeView) {
            testThemeTreeView.message = message;
        }
    }, context);
    testThemeTreeView = vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: testThemeTreeDataProvider
    });
    context.subscriptions.push(testThemeTreeView);

    projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider((message) => {
        if (projectTreeView) {
            projectTreeView.message = message;
        }
    }, testThemeTreeDataProvider);
    const newProjectTreeView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> =
        vscode.window.createTreeView("projectManagementTree", {
            treeDataProvider: projectManagementTreeDataProvider,
            canSelectMany: false
        });
    projectTreeView = newProjectTreeView;
    context.subscriptions.push(projectTreeView);

    if (projectManagementTreeDataProvider && testThemeTreeView && testThemeTreeDataProvider) {
        context.subscriptions.push(
            projectManagementTreeDataProvider.onDidPrepareCycleDataForThemeTree(
                async (eventData: CycleDataForThemeTreeEvent) => {
                    if (testThemeTreeDataProvider && testThemeTreeView) {
                        logger.debug(
                            `[Prepare Cycle Event] Cycle data prepared for ${eventData.cycleLabel}. Updating Test Theme Tree.`
                        );

                        testThemeTreeView.title = `Test Themes (${eventData.cycleLabel})`;
                        logger.trace(`Test Themes view title updated to: ${testThemeTreeView.title}`);

                        testThemeTreeDataProvider.clearTree();
                        testThemeTreeDataProvider.populateFromCycleData(eventData);
                    }
                }
            )
        );
    }

    projectManagementTreeDataProvider?.refresh(true);

    if (testThemeTreeDataProvider && testThemeTreeView) {
        testThemeTreeDataProvider.clearTree();
    }
    initializeTestElementsTreeView(context);
    if (projectTreeView && projectManagementTreeDataProvider) {
        projectManagementTreeView.setupProjectTreeViewEventListeners(
            projectTreeView,
            projectManagementTreeDataProvider
        );
    }
}

/**
 * Registers all extension commands.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function registerExtensionCommands(context: vscode.ExtensionContext): Promise<void> {
    // --- Command: Show Extension Settings ---
    registerSafeCommand(context, allExtensionCommands.showExtensionSettings, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.showExtensionSettings}`);

        // Open the settings with the extension filter.
        await vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-visual-studio-code-extension"
        });
        // Open the "workspace" tab in settings view (The default settings view is the user tab in settings)
        await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
    });

    // --- Command: Set Workspace ---
    registerSafeCommand(context, allExtensionCommands.setWorkspace, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.setWorkspace}`);
        await utils.setWorkspaceLocation();
    });

    // --- Command: Automatic Login After Extension Start ---
    registerSafeCommand(context, allExtensionCommands.automaticLoginAfterExtensionActivation, async () => {
        logger.debug(`[Cmd] Called: ${allExtensionCommands.automaticLoginAfterExtensionActivation}`);

        if (getConfig().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
            logger.info("[Cmd] Auto-login is enabled. Attempting silent login with last active profile...");

            const activeProfile: profileManager.TestBenchProfile | undefined =
                await profileManager.getActiveProfile(context);
            if (!activeProfile) {
                logger.info("[Cmd] Auto-login: No last active profile found. Cannot auto-login.");
                return;
            }

            if (!authProviderInstance) {
                logger.error("[Cmd] Auto-login: AuthenticationProvider instance is not available.");
                return;
            }

            try {
                await profileManager.setActiveProfileId(context, activeProfile.id);
                authProviderInstance.prepareForSilentAutoLogin();

                logger.trace("[Cmd] Auto-login: Calling vscode.authentication.getSession silently.");
                const session: vscode.AuthenticationSession = await vscode.authentication.getSession(
                    TESTBENCH_AUTH_PROVIDER_ID,
                    ["api_access"],
                    { createIfNone: true }
                );

                if (session) {
                    logger.info(
                        `[Cmd] Auto-login successful for profile: ${activeProfile.label} (session restored/created silently).`
                    );
                } else {
                    logger.info(
                        "[Cmd] Auto-login: No session restored/created silently. User may need to login manually."
                    );
                }
            } catch (error: any) {
                logger.warn(
                    `[Cmd] Auto-login attempt for profile "${activeProfile?.label || "unknown"}" failed silently (this is expected if credentials/profile are incomplete or server issues prevent silent login): ${error.message}`
                );
            }
        } else {
            logger.trace("[Cmd] Auto-login is disabled in settings.");
        }
    });

    // --- Command: Login ---
    // Performs the login process and stores the connection object.
    registerSafeCommand(context, allExtensionCommands.login, async () => {
        logger.debug(`[Cmd] Called: ${allExtensionCommands.login}`);
        try {
            // Triggers TestBenchAuthenticationProvider.createSession if no session exists
            const session: vscode.AuthenticationSession = await vscode.authentication.getSession(
                TESTBENCH_AUTH_PROVIDER_ID,
                ["api_access"],
                { createIfNone: true }
            );
            if (session) {
                logger.info(`[Cmd] Login successful, session ID: ${session.id}`);
                initializeTreeViews(context);
                projectManagementTreeDataProvider?.refresh(true);
            }
        } catch (error) {
            logger.error(`[Cmd] Login process failed or was cancelled:`, error);
            vscode.window.showErrorMessage(`TestBench Login Failed: ${(error as Error).message}`);
        }
    });

    // --- Command: Logout ---
    // Performs the logout process and clears the connection object.
    registerSafeCommand(context, allExtensionCommands.logout, async () => {
        logger.debug(`[Cmd] Called: ${allExtensionCommands.logout}`);
        try {
            const session: vscode.AuthenticationSession | undefined = await vscode.authentication.getSession(
                TESTBENCH_AUTH_PROVIDER_ID,
                [],
                { createIfNone: false, silent: true }
            );

            if (session && session.id) {
                logger.trace(
                    `[Cmd] Found active TestBench session: ${session.id}. Attempting to remove via vscode.authentication.removeSession.`
                );

                if (authProviderInstance) {
                    await authProviderInstance.removeSession(session.id);
                    vscode.window.showInformationMessage("Logged out from TestBench.");
                } else {
                    logger.error("[Cmd] AuthProvider instance not available for logout.");
                    vscode.window.showErrorMessage("Logout failed: Auth provider not initialized.");
                    await handleTestBenchSessionChange(context);
                }
            } else {
                logger.info("[Cmd] No active TestBench session found to logout. Ensuring UI is in a logged-out state.");
                await handleTestBenchSessionChange(context);
            }
        } catch (error: any) {
            logger.error(`[Cmd] Error during logout:`, error);
            vscode.window.showErrorMessage(`TestBench Logout Error: ${error.message}`);
            await handleTestBenchSessionChange(context);
        }
        await connection.logoutUser();

        // Clear provider states on logout
        getProjectManagementTreeDataProvider()?.clearTree();
        getTestThemeTreeDataProvider()?.clearTree();
        getTestElementsTreeDataProvider()?.refresh([]); // Clear with empty data
        // Login web view is displayed automatically after context value change

        // Stop the language server if it is running
        await client?.stop();
    });

    // --- Command: Handle Cycle Click ---
    // Handles the click event on a cycle element in the project management tree view.
    registerSafeCommand(
        context,
        allExtensionCommands.handleProjectCycleClick,
        async (cycleItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.handleProjectCycleClick}`);
            if (projectManagementTreeDataProvider) {
                // Avoid displaying old data in the tree views by clearing if fetching fails.
                testThemeTreeDataProvider?.clearTree();
                clearTestElementsTreeView();

                await projectManagementTreeDataProvider.handleTestCycleClick(cycleItem);
            } else {
                logger.error(
                    "Cycle click cannot be processed: Project management tree data provider is not initialized."
                );
                vscode.window.showErrorMessage("Project management tree is not initialized.");
            }
        }
    );

    // --- Command: Generate Test Cases For Cycle ---
    // Generates test cases for the selected cycle in the project management tree view.
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForCycle,
        async (item: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.generateTestCasesForCycle}`);
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error(`${allExtensionCommands.generateTestCasesForCycle} command called without connection.`);
                return;
            }

            if (config.get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }

            await reportHandler.startTestGenerationForCycle(context, item);
        }
    );

    // --- Command: Generate Test Cases For Test Theme or Test Case Set ---
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet,
        async (treeItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet}`);
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error(
                    `${allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet} command called without connection.`
                );
                return;
            }
            if (config.get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }

            let cycleKey: string | null = null;

            if (testThemeTreeDataProvider) {
                cycleKey = testThemeTreeDataProvider.getCurrentCycleKey();
                if (cycleKey) {
                    logger.trace(`Using cycle key '${cycleKey}' from TestThemeTreeDataProvider for test generation.`);
                } else {
                    logger.warn(
                        "TestThemeTreeDataProvider available but cycle key not set. Falling back to parent traversal."
                    );
                    cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
                }
            } else {
                logger.warn("TestThemeTreeDataProvider not available. Falling back to parent traversal for cycle key.");
                cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
            }

            if (!cycleKey) {
                vscode.window.showErrorMessage(
                    `Error: Cycle key not found for the selected item '${treeItem.label}'. Cannot generate tests.`
                );
                logger.error(
                    `Cycle key not found for tree element: ${treeItem.label} (UID: ${treeItem.item?.uniqueID || treeItem.item?.key})`
                );
                return;
            }

            await reportHandler.generateRobotFrameworkTestsForTestThemeOrTestCaseSet(context, treeItem, cycleKey);
        }
    );

    // --- Command: Display All Projects ---
    // Opens the project management tree view, hides other views, and displays all projects with their contents.
    registerSafeCommand(context, allExtensionCommands.displayAllProjects, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.displayAllProjects}`);
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error(`${allExtensionCommands.displayAllProjects} command called without connection.`);
            return;
        }

        await projectManagementTreeView?.displayProjectManagementTreeView();
        await hideTestThemeTreeView();
        await testElementsTreeView?.hideTestElementsTreeView();
    });

    // --- Command: Read Robotframework Test Results And Create Report With Results ---
    // Activated for a test theme or test case set element.
    // Reads the test results (output.xml) from the testbench working directory and creates a report zip file with the results.
    registerSafeCommand(context, allExtensionCommands.readRFTestResultsAndCreateReportWithResults, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.readRFTestResultsAndCreateReportWithResults}`);
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error(
                `${allExtensionCommands.readRFTestResultsAndCreateReportWithResults} command called without connection.`
            );
            return;
        }
        await reportHandler.fetchTestResultsAndCreateReportWithResultsWithTb2Robot(context);
    });

    // --- Command: Import Test Results To Testbench ---
    // Imports the selected test results zip to the testbench server
    registerSafeCommand(context, allExtensionCommands.importTestResultsToTestbench, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.importTestResultsToTestbench}`);
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error(`${allExtensionCommands.importTestResultsToTestbench} command called without connection.`);
            return;
        }

        await testBenchConnection.selectReportWithResultsAndImportToTestbench(connection);
    });

    // --- Command: Read And Import Test Results To Testbench ---
    // A command that combines the reading of robotframework test results, creating a report file with results, and importing test results to testbench server.
    registerSafeCommand(
        context,
        allExtensionCommands.readAndImportTestResultsToTestbench,
        async (item?: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.readAndImportTestResultsToTestbench}`);
            if (!connection) {
                const noConnectionErrorMessage: string = "No connection available. Cannot import report.";
                vscode.window.showErrorMessage(noConnectionErrorMessage);
                logger.error(noConnectionErrorMessage);
                return null;
            }

            if (!item) {
                logger.warn(
                    `${allExtensionCommands.readAndImportTestResultsToTestbench} called without a tree item. This command should be invoked from a marked Test Theme/Set item.`
                );
                vscode.window.showWarningMessage(
                    "Please invoke this command from a Test Theme or Test Case Set that has generated tests."
                );
                return null;
            }

            await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(context, item);
        }
    );

    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshProjectTreeView, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.refreshProjectTreeView}`);

        if (projectManagementTreeDataProvider && projectTreeView) {
            projectManagementTreeDataProvider.refresh(false);
        } else {
            logger.warn(`Project Management Tree Data Provider or Project Tree View not initialized. Cannot refresh.`);
        }
    });

    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshTestThemeTreeView, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.refreshTestThemeTreeView}`);

        if (!testThemeTreeDataProvider) {
            logger.warn("Test Theme Tree Data Provider not initialized. Cannot refresh.");
            vscode.window.showErrorMessage("Test Theme Tree is not available to refresh.");
            return;
        }

        if (!testThemeTreeDataProvider.getCurrentCycleKey() || !testThemeTreeDataProvider.getCurrentProjectKey()) {
            logger.info("Test Theme Tree: No current cycle selected to refresh. Clearing tree.");
            testThemeTreeDataProvider.clearTree();
            if (testThemeTreeView) {
                testThemeTreeView.title = "Test Themes";
            }
            return;
        }

        try {
            await testThemeTreeDataProvider.refresh(false);
            logger.info("Test Theme Tree view refresh initiated and completed via provider.");
        } catch (error) {
            logger.error("Error during Test Theme Tree view refresh command execution:", error);
            vscode.window.showErrorMessage("Failed to refresh Test Themes. Check logs for details.");
            testThemeTreeDataProvider.setTreeViewStatusMessage("Error refreshing test themes.");
        }
    });

    // --- Command: Make Root ---
    // Right clicking on a tree element and selecting "Make Root" context menu option will make the selected element the root of the tree.
    // Refreshing the tree will revert the tree to its original state.
    registerSafeCommand(
        context,
        allExtensionCommands.makeRoot,
        (treeItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.makeRoot} for tree item:`, treeItem);
            if (!treeItem) {
                logger.warn("MakeRoot command called with null treeItem.");
                return;
            }
            // Check if the item belongs to the Project Management Tree
            if (
                treeItem.contextValue &&
                (
                    [
                        TreeItemContextValues.PROJECT,
                        TreeItemContextValues.VERSION,
                        TreeItemContextValues.CYCLE
                    ] as string[]
                ).includes(treeItem.contextValue)
            ) {
                if (projectManagementTreeDataProvider) {
                    projectManagementTreeDataProvider.makeRoot(treeItem);
                } else {
                    const makeRootNoProviderErrorMessage: string =
                        "MakeRoot command called without projectManagementTreeDataProvider.";
                    logger.warn(makeRootNoProviderErrorMessage);
                    vscode.window.showErrorMessage(makeRootNoProviderErrorMessage);
                }
            }
            // Check if the item belongs to the Test Theme Tree
            else if (
                testThemeTreeDataProvider &&
                treeItem.contextValue &&
                (
                    [TreeItemContextValues.TEST_THEME_NODE, TreeItemContextValues.TEST_CASE_SET_NODE] as string[]
                ).includes(treeItem.contextValue)
            ) {
                // Delegate to testThemeTreeDataProvider if it's a test theme item
                if (typeof (testThemeTreeDataProvider as any).makeRoot === "function") {
                    (testThemeTreeDataProvider as any).makeRoot(treeItem);
                } else {
                    logger.warn(
                        `MakeRoot: testThemeTreeDataProvider does not have a makeRoot method or item type (${treeItem.contextValue}) is not supported for makeRoot in test theme tree.`
                    );
                    vscode.window.showInformationMessage(
                        `Cannot make '${treeItem.label}' root in the Test Themes view with current implementation.`
                    );
                }
            } else {
                logger.warn(
                    `MakeRoot: Item type "${treeItem.contextValue}" not supported for makeRoot or target provider not identified.`
                );
                vscode.window.showInformationMessage(
                    `Item '${treeItem.label}' cannot be made a root in the current view.`
                );
            }
        }
    );

    // --- Command: Reset Project Tree View Root ---
    registerSafeCommand(context, allExtensionCommands.resetProjectTreeViewRoot, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.resetProjectTreeViewRoot}`);
        if (projectManagementTreeDataProvider) {
            projectManagementTreeDataProvider.resetCustomRoot();
        } else {
            logger.warn("ProjectManagementTreeDataProvider not available to reset custom root.");
            vscode.window.showWarningMessage("Project tree is not ready to reset root.");
        }
    });

    // --- Command: Reset Test Theme Tree View Root ---
    registerSafeCommand(context, allExtensionCommands.resetTestThemeTreeViewRoot, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.resetTestThemeTreeViewRoot}`);
        if (testThemeTreeDataProvider) {
            await testThemeTreeDataProvider.resetCustomRoot();
        } else {
            logger.warn("TestThemeTreeDataProvider not available to reset custom root.");
            vscode.window.showWarningMessage("Test theme tree is not ready to reset root.");
        }
    });

    // --- Command: Clear Workspace Folder ---
    // Clears the workspace folder of its contents, excluding extension log files.
    registerSafeCommand(context, allExtensionCommands.clearInternalTestbenchFolder, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.clearInternalTestbenchFolder}`);
        const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return;
        }
        const testbenchWorkingDirectoryPath: string = path.join(workspaceLocation, folderNameOfInternalTestbenchFolder);
        await utils.clearInternalTestbenchFolder(
            testbenchWorkingDirectoryPath,
            [testBenchLogger.folderNameOfLogs], // Exclude log files from deletion
            !config.get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR) // Ask for confirmation if not set to clear before test generation
        );
    });

    // --- Command: Refresh Test Elements Tree ---
    // Refreshes the test elements tree view with the latest test elements for the selected TOV.
    registerSafeCommand(context, allExtensionCommands.refreshTestElementsTree, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.refreshTestElementsTree}`);
        if (!testElementsTreeDataProvider) {
            logger.warn("Test Elements Tree Data Provider not initialized. Cannot refresh Test Elements Tree.");
            return;
        }
        const currentTovKey: string = testElementsTreeDataProvider.getCurrentTovKey();
        if (!currentTovKey) {
            vscode.window.showErrorMessage("No TOV key stored. Please fetch test elements first.");
            return;
        }
        await testElementsTreeDataProvider.fetchTestElements(currentTovKey);
    });

    // --- Command: Display Interactions For Selected TOV ---
    registerSafeCommand(
        context,
        allExtensionCommands.displayInteractionsForSelectedTOV,
        async (treeItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(
                `Command Called: ${allExtensionCommands.displayInteractionsForSelectedTOV} for tree item:`,
                treeItem
            );

            if (projectManagementTreeDataProvider && treeItem.contextValue === TreeItemContextValues.VERSION) {
                const tovKeyOfSelectedTreeElement = treeItem.item?.key?.toString();
                if (tovKeyOfSelectedTreeElement && testElementsTreeDataProvider) {
                    const areTestElementsFetched: boolean = await testElementsTreeDataProvider.fetchTestElements(
                        tovKeyOfSelectedTreeElement,
                        typeof treeItem.label === "string" ? treeItem.label : undefined
                    );
                    if (areTestElementsFetched) {
                        await projectManagementTreeView?.hideProjectManagementTreeView();
                        await displayTestElementsTreeView();

                        // Clicking on the "Show Robotframework Resources" button will not trigger project management tree onDidChangeSelection event,
                        // which restarts the language client.
                        // Retrieve the project name and TOV name from the tree item for language client restart.
                        const projectAndTovNameObj =
                            projectManagementTreeDataProvider.getProjectAndTovNamesForItem(treeItem);
                        if (projectAndTovNameObj) {
                            const { projectName, tovName } = projectAndTovNameObj;
                            if (projectName && tovName) {
                                await restartLanguageClient(projectName, tovName);
                            }
                        }
                    } else {
                        logger.warn(
                            `Test Elements Tree Data Provider not initialized or failed to fetch test elements for TOV: ${tovKeyOfSelectedTreeElement}`
                        );
                        vscode.window.showErrorMessage(
                            `Failed to fetch test elements for TOV: ${tovKeyOfSelectedTreeElement}`
                        );
                    }
                }
            }
        }
    );

    // --- Command: Go To Resource File ---
    // Opens or creates the robot resource file associated with the selected test element.
    registerSafeCommand(
        context,
        allExtensionCommands.openOrCreateRobotResourceFile,
        async (treeItem: testElementsTreeView.TestElementTreeItem) => {
            logger.debug(
                `Command Called: ${allExtensionCommands.openOrCreateRobotResourceFile} for tree item:`,
                treeItem
            );
            if (!treeItem || !treeItem.testElementData) {
                logger.trace("Invalid tree item or element in Open Robot Resource File command.");
                return;
            }

            // Construct the target path based on the hierarchical name of the test element.
            const absolutePathOfSelectedTestElement: string | undefined =
                await testElementsTreeView.constructAbsolutePathForTestElement(treeItem);
            if (!absolutePathOfSelectedTestElement) {
                return;
            }

            logger.trace(
                `Opening Robot Resource File - absolute path for test element tree item (${treeItem.testElementData.name}) resolved as: ${absolutePathOfSelectedTestElement}`
            );
            try {
                switch (treeItem.testElementData.elementType) {
                    case "Subdivision":
                        await testElementsTreeView.handleSubdivision(treeItem);
                        break;
                    case "Interaction":
                        await testElementsTreeView.handleInteraction(treeItem);
                        break;
                    default:
                        await testElementsTreeView.handleFallback(absolutePathOfSelectedTestElement);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Error in Open Robot Resource File command: ${error.message}`);
                logger.error(`${allExtensionCommands.openOrCreateRobotResourceFile} command failed: ${error.message}`);
            }
        }
    );

    // --- Command: Create Interaction Under Subdivision ---
    // Creates a new interaction tree element under the selected subdivision.
    registerSafeCommand(
        context,
        allExtensionCommands.createInteractionUnderSubdivision,
        async (subdivisionTreeItem: testElementsTreeView.TestElementTreeItem) => {
            logger.debug(
                `Command Called: ${allExtensionCommands.createInteractionUnderSubdivision} for tree item:`,
                subdivisionTreeItem
            );

            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error(
                    `${allExtensionCommands.createInteractionUnderSubdivision} command called without connection.`
                );
                return;
            }

            if (!testElementsTreeDataProvider) {
                return;
            }

            const interactionName: string | undefined = await vscode.window.showInputBox({
                prompt: "Enter name for the new Interaction",
                placeHolder: "New Interaction Name",
                validateInput: (value) => {
                    if (!value || value.trim() === "") {
                        return "Interaction name cannot be empty";
                    }
                    return null;
                }
            });

            if (!interactionName) {
                return; // User cancelled input box
            }

            const newInteraction: testElementsTreeView.TestElementData | null =
                await testElementsTreeView.createInteractionUnderSubdivision(subdivisionTreeItem, interactionName);

            if (newInteraction) {
                // TODO: After the API is implemented, use the API to create the interaction on the server
                // For now, refresh the tree view to show the new interaction
                testElementsTreeDataProvider._onDidChangeTreeDataEmitter.fire(undefined);

                vscode.window.showInformationMessage(`Successfully created interaction '${interactionName}'`);
                logger.debug(
                    `Created new interaction '${interactionName}' under subdivision '${subdivisionTreeItem.testElementData.name}'`
                );
            }
        }
    );

    // --- Command: Open Issue Reporter ---
    // Opens the official VS Code issue reporter, where the extension is preselected.
    registerSafeCommand(context, allExtensionCommands.openIssueReporter, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.openIssueReporter}`);
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench-visual-studio-code-extension"
        });
    });

    // --- Command: Modify Report With Results Zip ---
    // TODO: This feature needs to be discussed with the team.
    // Allows the user to select a report zip file and create a new report by removing JSON files that were not selected in the quick pick from the original report zip.
    registerSafeCommand(context, allExtensionCommands.modifyReportWithResultsZip, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.modifyReportWithResultsZip}`);

        const zipUris: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: {
                "Zip Files": ["zip"],
                "All Files": ["*"]
            },
            openLabel: "Select Report Zip File With Test Results"
        });
        if (!zipUris || zipUris.length === 0) {
            vscode.window.showErrorMessage("No zip file selected.");
            return;
        }
        const zipPath: string = zipUris[0].fsPath;
        const quickPickItems: string[] = await reportHandler.getQuickPickItemsFromReportZipWithResults(zipPath);

        const chosenQuickPickItems: string[] = await reportHandler.showMultiSelectQuickPick(quickPickItems);
        logger.log("Trace", "User selected following json files:", chosenQuickPickItems);

        await reportHandler.createNewReportWithSelectedItems(zipPath, chosenQuickPickItems);
    });

    // TODO: Remove / reimplement after testing
    // --- Command: Get Filters ---
    registerSafeCommand(context, allExtensionCommands.getFilters, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.getFilters}`);
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error(`${allExtensionCommands.getFilters} command called without connection.`);
            return;
        }
        try {
            const filters = await connection.getFiltersFromOldPlayServer();
            if (!filters || !Array.isArray(filters) || filters.length === 0) {
                vscode.window.showInformationMessage("No filters found.");
                logger.trace("No filters retrieved from server or empty filters array.");
                return;
            }

            logger.trace("Filters retrieved successfully:", JSON.stringify(filters, null, 2));

            // Create QuickPick items from the filters
            const quickPickItems: vscode.QuickPickItem[] = filters.map(
                (filter: any) =>
                    ({
                        label: filter.name || "Unnamed Filter",
                        description: `Type: ${filter.type || "Unknown"} | ${filter.public ? "Public" : "Private"}`,
                        detail: `Key: ${filter.key?.serial || "No Key"}`,
                        // Store the entire filter object in the detail for later access
                        filterData: filter
                    }) as vscode.QuickPickItem & { filterData: any }
            );

            // Show QuickPick to user
            const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: "Select a filter to view its content",
                title: "Available Filters"
            });

            if (selectedItem && (selectedItem as any).filterData) {
                const selectedFilter = (selectedItem as any).filterData;
                const content = selectedFilter.content || "No content available";

                // Display the filter content in a message box
                const action = await vscode.window.showInformationMessage(
                    `Filter: ${selectedFilter.name}\n\nContent:\n${content}`,
                    { modal: true },
                    "Copy to Clipboard"
                );

                // Optional: Copy content to clipboard if user clicks the button
                if (action === "Copy to Clipboard") {
                    await vscode.env.clipboard.writeText(content);
                    vscode.window.showInformationMessage("Filter content copied to clipboard.");
                }

                logger.info(`User selected filter: ${selectedFilter.name} with content: ${content}`);
            } else {
                logger.info("User cancelled filter selection or no filter was selected.");
            }
        } catch (error) {
            logger.error("Error retrieving filters:", error);
            vscode.window.showErrorMessage(`Failed to retrieve filters: ${(error as Error).message}`);
        }
    });

    // TODO: Remove / reimplement after testing
    // --- Command: Get TOV Structure ---
    registerSafeCommand(context, allExtensionCommands.fetchTovStructure, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.fetchTovStructure}`);
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error(`${allExtensionCommands.fetchTovStructure} command called without connection.`);
            return;
        }
        try {
            // Get Project Key from user input
            const projectKey = await vscode.window.showInputBox({
                prompt: "Enter the Project Key",
                placeHolder: "e.g., 30",
                validateInput: (value) => {
                    if (!value || value.trim() === "") {
                        return "Project Key cannot be empty";
                    }
                    if (!/^\d+$/.test(value.trim())) {
                        return "Project Key must be a number";
                    }
                    return null;
                }
            });

            if (!projectKey) {
                logger.info("User cancelled project key input.");
                return;
            }

            // Get TOV Key from user input
            const tovKey = await vscode.window.showInputBox({
                prompt: "Enter the TOV (Test Object Version) Key",
                placeHolder: "e.g., 176",
                validateInput: (value) => {
                    if (!value || value.trim() === "") {
                        return "TOV Key cannot be empty";
                    }
                    if (!/^\d+$/.test(value.trim())) {
                        return "TOV Key must be a number";
                    }
                    return null;
                }
            });

            if (!tovKey) {
                logger.info("User cancelled TOV key input.");
                return;
            }

            // Get Tree Root UID from user input
            const treeRootUID = await vscode.window.showInputBox({
                prompt: "Enter the Tree Root UID (optional)",
                placeHolder: "e.g., iTB-TT-299 (leave empty for default)",
                validateInput: (value) => {
                    // Tree Root UID is optional, so empty values are allowed
                    return null;
                }
            });

            // Get filters from server and let user select
            let selectedFilters: any[] = [];

            try {
                const filters = await connection.getFiltersFromOldPlayServer();

                if (filters && Array.isArray(filters) && filters.length > 0) {
                    // Ask user if they want to apply filters
                    const applyFilters = await vscode.window.showQuickPick(["No filters", "Select filters"], {
                        placeHolder: "Do you want to apply filters to the TOV structure?",
                        title: "Filter Selection"
                    });

                    if (applyFilters === "Select filters") {
                        // Create QuickPick items from the filters with multi-select capability
                        const quickPickItems: vscode.QuickPickItem[] = filters.map(
                            (filter: any) =>
                                ({
                                    label: filter.name || "Unnamed Filter",
                                    description: `Type: ${filter.type || "Unknown"} | ${filter.public ? "Public" : "Private"}`,
                                    detail: `Key: ${filter.key?.serial || "No Key"}`,
                                    filterData: filter
                                }) as vscode.QuickPickItem & { filterData: any }
                        );

                        // Create a multi-select QuickPick
                        const quickPick = vscode.window.createQuickPick();
                        quickPick.items = quickPickItems;
                        quickPick.canSelectMany = true;
                        quickPick.placeholder = "Select filters to apply (you can select multiple)";
                        quickPick.title = "Select Filters for TOV Structure";

                        quickPick.show();

                        const selectedItems = await new Promise<vscode.QuickPickItem[]>((resolve) => {
                            quickPick.onDidAccept(() => {
                                resolve([...quickPick.selectedItems]);
                                quickPick.hide();
                            });
                            quickPick.onDidHide(() => {
                                resolve([]);
                                quickPick.dispose();
                            });
                        });

                        // Convert selected items to filter format expected by the API
                        selectedFilters = selectedItems
                            .map((item: any) => {
                                const filterData = item.filterData;
                                return {
                                    name: filterData.name,
                                    filterType: filterData.type,
                                    testThemeUID: filterData.type === "TestTheme" ? filterData.key?.serial : undefined
                                };
                            })
                            .filter((filter) => filter.filterType); // Remove any invalid filters

                        logger.info(`User selected ${selectedFilters.length} filters:`, selectedFilters);
                    }
                } else {
                    logger.info("No filters available from server for TOV structure.");
                }
            } catch (filterError) {
                logger.warn("Could not retrieve filters for TOV structure, proceeding without filters:", filterError);
                vscode.window.showWarningMessage("Could not retrieve filters. Proceeding without filters.");
            }

            // Build TOV Structure Options with user inputs
            const tovStructureOptions: TovStructureOptions = {
                treeRootUID: treeRootUID?.trim() || "iTB-TT-299", // Use default if empty
                suppressFilteredData: false,
                suppressEmptyTestThemes: true,
                filters: selectedFilters
            };

            logger.info(`Fetching TOV structure with options:`, {
                projectKey: projectKey.trim(),
                tovKey: tovKey.trim(),
                options: tovStructureOptions
            });

            // Show progress while fetching
            const tovStructure = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Fetching TOV Structure",
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: "Retrieving TOV structure from server..." });
                    return await connection?.fetchTovStructure(projectKey.trim(), tovKey.trim(), tovStructureOptions);
                }
            );

            if (tovStructure) {
                logger.info("TOV structure retrieved successfully:", JSON.stringify(tovStructure, null, 2));

                // Show result in information message with option to save
                const action = await vscode.window.showInformationMessage(
                    `TOV Structure retrieved successfully for Project ${projectKey}, TOV ${tovKey}.\n\nFilters applied: ${selectedFilters.length}\nTree Root UID: ${tovStructureOptions.treeRootUID}`,
                    { modal: true },
                    "View Details",
                    "Save to File"
                );

                if (action === "View Details") {
                    // Show detailed structure in a new document
                    const doc = await vscode.workspace.openTextDocument({
                        content: JSON.stringify(tovStructure, null, 2),
                        language: "json"
                    });
                    await vscode.window.showTextDocument(doc);
                } else if (action === "Save to File") {
                    // Let user save the structure to a file
                    const saveUri = await vscode.window.showSaveDialog({
                        filters: {
                            "JSON Files": ["json"],
                            "All Files": ["*"]
                        },
                        defaultUri: vscode.Uri.file(`tov_structure_${projectKey}_${tovKey}.json`)
                    });

                    if (saveUri) {
                        const content = JSON.stringify(tovStructure, null, 2);
                        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, "utf8"));
                        vscode.window.showInformationMessage(`TOV structure saved to ${saveUri.fsPath}`);
                    }
                }
            } else {
                // Undefined is expected if no TOV structure is found or filtering results in no data
                logger.warn("TOV structure retrieval returned null or undefined.");
            }
        } catch (error) {
            logger.error("Error fetching TOV structure:", error);
            vscode.window.showErrorMessage(`Failed to retrieve TOV structure: ${(error as Error).message}`);
        }
    });
}

/**
 * Handles changes in the TestBench authentication session.
 *
 * Updates the application state based on the provided or retrieved authentication session.
 * @param {vscode.ExtensionContext} context - The VS Code extension context.
 * @param {vscode.AuthenticationSession} existingSession - An optional existing authentication session to process.
 *                          If not provided, the function will attempt to retrieve the current session.
 * @returns A promise that resolves when the session change has been handled.
 */
async function handleTestBenchSessionChange(
    context: vscode.ExtensionContext,
    existingSession?: vscode.AuthenticationSession
): Promise<void> {
    logger.info(`[handleTestBenchSessionChange] Session changed. Processing... Has session: ${!!existingSession}`);
    let sessionToProcess = existingSession;
    if (!sessionToProcess) {
        try {
            sessionToProcess = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                createIfNone: false,
                silent: true
            });
        } catch (error) {
            logger.warn("[Extension] Error getting current session during handleTestBenchSessionChange:", error);
            sessionToProcess = undefined;
        }
    }

    const wasPreviouslyConnected = !!connection;

    if (sessionToProcess && sessionToProcess.accessToken) {
        const activeProfile = await profileManager.getActiveProfile(context);
        if (activeProfile) {
            // Check if a connection for this session and profile already exists
            if (
                connection &&
                connection.getSessionToken() === sessionToProcess.accessToken &&
                connection.getUsername() === activeProfile.username &&
                connection.getServerName() === activeProfile.serverName &&
                connection.getServerPort() === activeProfile.portNumber.toString()
            ) {
                logger.info(
                    `[Extension] Connection for profile '${activeProfile.label}' and current session token is already active. Skipping re-initialization.`
                );
                if (!wasPreviouslyConnected) {
                    logger.info("[Extension] Re-asserting UI state for existing matching connection.");
                    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, true);
                    getLoginWebViewProvider()?.updateWebviewHTMLContent();
                    await vscode.commands.executeCommand(allExtensionCommands.displayAllProjects);

                    projectManagementTreeDataProvider?.refresh(true);
                    testThemeTreeDataProvider?.clearTree();
                    clearTestElementsTreeView();
                }
                return;
            }

            logger.info(
                `[Extension] TestBench session active for profile: ${activeProfile.label}. Initializing PlayServerConnection.`
            );

            if (connection) {
                logger.warn(
                    "[Extension] A different connection was active. Logging out from previous server session before establishing new one."
                );
                await connection.logoutUserOnServer();
            }

            const newConnection = new PlayServerConnection(
                activeProfile.serverName,
                activeProfile.portNumber,
                activeProfile.username,
                sessionToProcess.accessToken
            );
            setConnection(newConnection);
            await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, true);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();

            if (
                !wasPreviouslyConnected ||
                (connection && connection.getSessionToken() !== newConnection.getSessionToken())
            ) {
                // This is a new login session (e.g., startup auto-login, or manual login from disconnected state)
                logger.info(
                    "[Extension] New session established. Setting default view to 'Projects' and refreshing data."
                );
                await vscode.commands.executeCommand(allExtensionCommands.displayAllProjects);

                projectManagementTreeDataProvider?.refresh(true);
                testThemeTreeDataProvider?.clearTree();
                clearTestElementsTreeView();
            } else {
                // Session changed while already connected (e.g., profile switch if supported, or token refresh)
                logger.info(
                    "[Extension] Session changed while already connected. Resetting view to 'Projects' and refreshing data."
                );
                await vscode.commands.executeCommand(allExtensionCommands.displayAllProjects);
                projectManagementTreeDataProvider?.refresh(true);
                testThemeTreeDataProvider?.clearTree();
                clearTestElementsTreeView();
            }
        } else {
            logger.warn("[Extension] Session exists, but no active profile. Clearing connection.");
            if (connection) {
                await connection.logoutUserOnServer();
            }
            setConnection(null);
            await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();

            await projectManagementTreeView?.hideProjectManagementTreeView();
            await hideTestThemeTreeView();
            await testElementsTreeView?.hideTestElementsTreeView();
            projectManagementTreeDataProvider?.clearTree();
            testThemeTreeDataProvider?.clearTree();
            clearTestElementsTreeView();
        }
    } else {
        logger.info("[Extension] No active session. Clearing connection.");
        if (connection) {
            await connection.logoutUserOnServer();
        }
        setConnection(null);
        await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
        getLoginWebViewProvider()?.updateWebviewHTMLContent();

        await projectManagementTreeView?.hideProjectManagementTreeView();
        await hideTestThemeTreeView();
        await testElementsTreeView?.hideTestElementsTreeView();
        projectManagementTreeDataProvider?.clearTree();
        testThemeTreeDataProvider?.clearTree();
        clearTestElementsTreeView();
    }
}

/* =============================================================================
   Extension Activation & Deactivation
   ============================================================================= */

/**
 * Called when the extension is activated.
 *
 * @param context The extension context.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger = new testBenchLogger.TestBenchLogger();
    logger.info("Extension activated.");

    // Initialize with the best scope
    activeEditor = vscode.window.activeTextEditor;
    // Initialize with global scope by default
    currentConfigScope = undefined;

    // Respond to configuration changes in the extension settings.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration(baseKeyOfExtension)) {
                await loadConfiguration(context);
                logger.info("Configuration updated after changes were detected.");
            }
        })
    );
    // Respond to changes in the active text editor to automatically update the configuration scope.
    // This is useful for multi-root workspaces where the user may switch between different folders.
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            activeEditor = editor;
            await loadConfiguration(context);
        })
    );

    await loadConfiguration(context);

    // Register AuthenticationProvider
    authProviderInstance = new TestBenchAuthenticationProvider(context);
    context.subscriptions.push(
        vscode.authentication.registerAuthenticationProvider(
            TESTBENCH_AUTH_PROVIDER_ID,
            TESTBENCH_AUTH_PROVIDER_LABEL,
            authProviderInstance,
            { supportsMultipleAccounts: false } // No support for multiple simultaneous TestBench logins
        )
    );
    logger.info("TestBenchAuthenticationProvider registered.");

    // Session Change Listener
    context.subscriptions.push(
        vscode.authentication.onDidChangeSessions(async (e) => {
            if (e.provider.id === TESTBENCH_AUTH_PROVIDER_ID) {
                if (isHandlingSessionChange) {
                    logger.trace(
                        "[Extension] onDidChangeSessions: Already handling a session change, skipping this invocation."
                    );
                    return;
                }
                isHandlingSessionChange = true;
                logger.info("[Extension] TestBench authentication sessions changed.");
                try {
                    const currentSession = await vscode.authentication.getSession(
                        TESTBENCH_AUTH_PROVIDER_ID,
                        ["api_access"],
                        { createIfNone: false, silent: true }
                    );
                    logger.info(
                        `[Extension] Fetched current session in onDidChangeSessions: ${currentSession ? currentSession.id : "undefined"}`
                    );
                    await handleTestBenchSessionChange(context, currentSession);
                } catch (error) {
                    logger.error("[Extension] Error getting session in onDidChangeSessions listener:", error);
                    await handleTestBenchSessionChange(context, undefined);
                } finally {
                    isHandlingSessionChange = false;
                }
            }
        })
    );

    initializeTreeViews(context);

    // Set the initial connection context state. Before any login attempt, connection is null.
    // VS Code will show/hide views based on this initial state matching the 'when' clauses in package.json
    // CONNECTION_ACTIVE is also used to enable or disable the login and logout buttons in the status bar,
    // which allows icon changes for login/logout buttons based on connectionActive variable.
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, connection !== null);
    logger.trace(`Initial connectionActive context set to: ${connection !== null}`);

    await vscode.commands.executeCommand("setContext", ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false);
    await vscode.commands.executeCommand("setContext", ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);

    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    await registerExtensionCommands(context);

    // Attempt to restore session on activation
    // Try to get an existing session without creating one.
    logger.trace("[Extension] Attempting to silently restore existing TestBench session on activation...");
    try {
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: false,
            silent: true
        });
        if (session) {
            logger.info("[Extension] Found existing VS Code AuthenticationSession for TestBench during initial check.");
            await handleTestBenchSessionChange(context, session);
        } else {
            logger.info("[Extension] No existing TestBench session found during initial check.");
            // If auto-login is enabled, it will be triggered next.
            // If not, user needs to login manually.
            if (!getConfig().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
                await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
                getLoginWebViewProvider()?.updateWebviewHTMLContent();
            }
        }
    } catch (error) {
        logger.warn("[Extension] Error trying to get initial session silently:", error);
        await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
    }

    // Trigger Automatic Login Command if configured
    if (getConfig().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
        logger.info("[Extension] Auto-login configured. Triggering automatic login command.");
        // Note: Dont use await here, which would block the login webview display during autologin.
        vscode.commands.executeCommand(allExtensionCommands.automaticLoginAfterExtensionActivation);
    } else {
        logger.info("[Extension] Auto-login is disabled. Skipping automatic login command.");
    }

    logger.info("Extension activated successfully.");
}

/**
 * Called when the extension is deactivated.
 */
export async function deactivate(): Promise<void> {
    try {
        if (connection) {
            logger.info("[Extension] Performing server logout on deactivation.");
            await connection.logoutUserOnServer();
            setConnection(null);
        }
        if (client) {
            logger.info("[Extension] Attempting to stop language server on deactivation.");
            await stopLanguageClient(true);
            logger.info("[Extension] Language server stopped on deactivation.");
        }
        logger.info("Extension deactivated.");
    } catch (error) {
        logger.error("Error during deactivation:", error);
    }
}
