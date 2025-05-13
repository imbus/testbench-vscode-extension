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
    StorageKeys,
    TreeItemContextValues
} from "./constants";
import { CycleDataForThemeTreeEvent } from "./projectManagementTreeView";
import { client, initializeLanguageServer } from "./server";
import { hideTestThemeTreeView, TestThemeTreeDataProvider } from "./testThemeTreeView";
import { clearTestElementsTreeView, displayTestElementsTreeView } from "./testElementsTreeView";

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

/** Module-private variables to hold the tree data providers and views. */
let _projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null = null;
let _testThemeTreeDataProvider: TestThemeTreeDataProvider | null = null;
let _testElementsTreeDataProvider: testElementsTreeView.TestElementsTreeDataProvider | undefined;
let _projectTreeView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> | undefined;
let _testThemeTreeView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> | undefined;
let _testElementTreeView: vscode.TreeView<testElementsTreeView.TestElementTreeItem> | undefined;

/** Getter functions for providers and views */
export function getProjectManagementTreeDataProvider(): projectManagementTreeView.ProjectManagementTreeDataProvider | null {
    return _projectManagementTreeDataProvider;
}

export function getTestThemeTreeDataProvider(): TestThemeTreeDataProvider | null {
    return _testThemeTreeDataProvider;
}

export function getTestElementsTreeDataProvider(): testElementsTreeView.TestElementsTreeDataProvider | undefined {
    return _testElementsTreeDataProvider;
}

export function getProjectTreeView(): vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> | undefined {
    return _projectTreeView;
}

export function getTestThemeTreeViewInstance():
    | vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem>
    | undefined {
    return _testThemeTreeView;
}

export function getTestElementTreeView(): vscode.TreeView<testElementsTreeView.TestElementTreeItem> | undefined {
    return _testElementTreeView;
}

// Global state for current project and TOV context for language server
let currentLanguageServerProject: string | undefined;
let currentLanguageServerTov: string | undefined;

export function getCurrentLsProject(): string | undefined {
    return currentLanguageServerProject;
}

export function getCurrentLsTov(): string | undefined {
    return currentLanguageServerTov;
}

/* =============================================================================
   Helper Functions
   ============================================================================= */

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
    const disposable: vscode.Disposable = vscode.commands.registerCommand(commandId, safeCommandHandler(callback));
    // Adding the command to the context subscriptions disposes them automatically when the extension is deactivated.
    context.subscriptions.push(disposable);
}

// Global variable to store the current configuration scope (workspace or global).
let currentConfigScope: vscode.Uri | undefined;
// Global variable to store the active editor instance to determine the best scope for configuration.
let activeEditor: vscode.TextEditor | undefined;

/**
 * Loads the latest extension configuration and updates the global configuration object.
 * Handles the storage of credentials based on the configuration settings.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function loadConfiguration(context: vscode.ExtensionContext, newScope?: vscode.Uri): Promise<void> {
    // If no new scope provided, determine the best scope automatically
    if (newScope === undefined) {
        if (activeEditor) {
            // If there is an active editor, use its workspace folder as the scope
            newScope = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri;
        } else if (vscode.workspace.workspaceFolders?.length === 1) {
            // If there is only one workspace folder, use it as the scope
            newScope = vscode.workspace.workspaceFolders[0].uri;
        }
    }

    currentConfigScope = newScope;

    // Update the configuration object with the latest values.
    // Without this, the configuration changes may not be updated and old values may be used.
    config = vscode.workspace.getConfiguration(baseKeyOfExtension, currentConfigScope);

    // Log the configuration source for debugging
    const configSource: string = currentConfigScope
        ? `workspace folder: ${vscode.workspace.getWorkspaceFolder(currentConfigScope)?.name}`
        : "global (no workspace)";
    logger.trace(`Loading configuration from ${configSource}`);

    // Update the log level based on the new configuration.
    logger.updateCachedLogLevel();

    // If storePassword is set to false, delete the stored password immediately.
    // If storePassword is set to true, the password is only stored after a successful login.
    // The login process also clears the stored password if the user does not want to store it.
    if (!config.get<boolean>(ConfigKeys.STORE_PASSWORD_AFTER_LOGIN, false)) {
        await testBenchConnection?.clearStoredCredentials(context);
    }
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
    _testElementsTreeDataProvider = new testElementsTreeView.TestElementsTreeDataProvider((message) => {
        // Pass callback for message updates
        if (_testElementTreeView) {
            _testElementTreeView.message = message;
        }
    });
    _testElementTreeView = vscode.window.createTreeView("testElementsView", {
        treeDataProvider: _testElementsTreeDataProvider
    });
    context.subscriptions.push(_testElementTreeView);

    if (_testElementsTreeDataProvider.isTreeDataEmpty()) {
        // Message setting will be handled by the provider via callback
        _testElementsTreeDataProvider.updateMessage();
    }
}

/**
 * Initializes the project tree and test elements tree.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export function initializeTreeViews(context: vscode.ExtensionContext): void {
    _testThemeTreeDataProvider = new TestThemeTreeDataProvider((message) => {
        if (_testThemeTreeView) {
            _testThemeTreeView.message = message;
        }
    });
    _testThemeTreeView = vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: _testThemeTreeDataProvider
    });
    context.subscriptions.push(_testThemeTreeView);

    _projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(
        (message) => {
            if (_projectTreeView) {
                _projectTreeView.message = message;
            }
        },
        _testThemeTreeDataProvider // Pass the test theme tree data provider to the project management tree
    );
    const newProjectTreeView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> =
        vscode.window.createTreeView("projectManagementTree", {
            treeDataProvider: _projectManagementTreeDataProvider,
            canSelectMany: false
        });
    context.subscriptions.push(newProjectTreeView);
    _projectTreeView = newProjectTreeView;

    // Listen to event from ProjectManagementTreeDataProvider to update the Test Theme Tree
    // when the cycle data is prepared.
    if (_projectManagementTreeDataProvider && _testThemeTreeView && _testThemeTreeDataProvider) {
        context.subscriptions.push(
            _projectManagementTreeDataProvider.onDidPrepareCycleDataForThemeTree(
                async (eventData: CycleDataForThemeTreeEvent) => {
                    if (_testThemeTreeDataProvider && _testThemeTreeView) {
                        logger.debug(`Cycle data prepared for ${eventData.cycleLabel}. Updating Test Theme Tree.`);

                        // Update the title of the Test Themes tree view
                        _testThemeTreeView.title = `Test Themes (${eventData.cycleLabel})`;
                        logger.trace(`Test Theme TreeView title updated to: ${_testThemeTreeView.title}`);

                        _testThemeTreeDataProvider.clearTree();
                        _testThemeTreeDataProvider.populateFromCycleData(eventData);
                    }
                }
            )
        );
    }

    // Initial data load/refresh for project tree
    _projectManagementTreeDataProvider?.refresh(true); // true for hard refresh

    if (_testThemeTreeDataProvider && _testThemeTreeView) {
        _testThemeTreeDataProvider.clearTree();
        // Message is set by clearTree/refresh via callback
    }
    initializeTestElementsTreeView(context);
    if (_projectTreeView && _projectManagementTreeDataProvider) {
        projectManagementTreeView.setupProjectTreeViewEventListeners(
            _projectTreeView,
            _projectManagementTreeDataProvider
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

    // --- Command: Automatic Login After Activation ---
    registerSafeCommand(context, allExtensionCommands.automaticLoginAfterExtensionActivation, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.automaticLoginAfterExtensionActivation}`);
        // If auto login is active and the password is stored in the secrets, perform the login automatically.
        if (
            config.get<boolean>(ConfigKeys.AUTO_LOGIN, false) &&
            config.get<boolean>(ConfigKeys.STORE_PASSWORD_AFTER_LOGIN, false) &&
            (await context.secrets.get(StorageKeys.PASSWORD)) !== undefined
        ) {
            logger.debug("Performing automatic login.");

            const loginResult: testBenchConnection.PlayServerConnection | null =
                await testBenchConnection?.performLogin(context, false, true);
            if (loginResult) {
                // Display project management tree and hide other tree views if they are open.
                await projectManagementTreeView?.displayProjectManagementTreeView();
                await hideTestThemeTreeView();
                await testElementsTreeView?.hideTestElementsTreeView();
                const pmDataProvider = getProjectManagementTreeDataProvider();
                if (pmDataProvider) {
                    pmDataProvider.refresh(true); // Force hard refresh on login
                } else {
                    logger.warn("ProjectManagementTreeDataProvider not available for refresh after automatic login.");
                }
            }
        } else {
            logger.trace("Skipping auto login: Automatic login is disabled or password is not stored.");
        }
    });

    // --- Command: Login ---
    // Prevent multiple login processes from running simultaneously.
    let isLoginProcessAlreadyRunning: boolean = false;
    // Performs the login process and stores the connection object.
    registerSafeCommand(context, allExtensionCommands.login, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.login}`);
        if (isLoginProcessAlreadyRunning) {
            logger.debug("Login process already running, aborting login.");
            // If (somehow) login flag is stuck and set to true,
            // reset the flag after 5 seconds to prevent a deadlock.
            setTimeout(() => {
                isLoginProcessAlreadyRunning = false;
                logger.trace("isLoginProcessAlreadyRunning flag reset to false after 5 seconds.");
            }, 5000);
            return;
        }
        isLoginProcessAlreadyRunning = true;
        try {
            const performLoginResult: testBenchConnection.PlayServerConnection | null =
                await testBenchConnection.performLogin(context);
            if (performLoginResult) {
                // Reinitialize tree views after successful login
                initializeTreeViews(context);
            }
        } catch (error) {
            logger.error(`Login process failed: ${error}`);
        } finally {
            // Release the lock after login attempt.
            isLoginProcessAlreadyRunning = false;
            logger.trace("isLoginProcessAlreadyRunning flag is reset to false after login attempt.");
        }
    });

    // --- Command: Logout ---
    // Performs the logout process and clears the connection object.
    registerSafeCommand(context, allExtensionCommands.logout, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.logout}`);
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error("Logout command called without connection.");
            // Ensure UI is in logged-out state if somehow connection is null but UI isn't
            await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
            return;
        }
        await connection.logoutUser();

        // Clear provider states on logout
        getProjectManagementTreeDataProvider()?.clearTree();
        getTestThemeTreeDataProvider()?.clearTree();
        getTestElementsTreeDataProvider()?.refresh([]); // Clear with empty data
        // Login web view is displayed automatically after context value change

        // Stop the language server if it is running
        await client.stop();
    });

    // --- Command: Handle Cycle Click ---
    // Handles the click event on a cycle element in the project management tree view.
    registerSafeCommand(
        context,
        allExtensionCommands.handleProjectCycleClick,
        async (cycleItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.handleProjectCycleClick}`);
            const pmProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null =
                getProjectManagementTreeDataProvider();
            if (pmProvider) {
                // Clear the test theme tree and test elements tree view items before loading new data.
                // This might avoid displaying old data in the tree views if fetching fails.
                getTestThemeTreeDataProvider()?.clearTree();
                clearTestElementsTreeView();

                await pmProvider.handleTestCycleClick(cycleItem);
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

            // Optionally clear the working directory before test generation.
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
            // Optionally clear the working directory before test generation.
            if (config.get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }

            const ttProvider = getTestThemeTreeDataProvider();
            let cycleKey: string | null = null;

            if (ttProvider) {
                cycleKey = ttProvider.getCurrentCycleKey();
                if (cycleKey) {
                    logger.info(`Using cycle key '${cycleKey}' from TestThemeTreeDataProvider for test generation.`);
                } else {
                    logger.warn(
                        "TestThemeTreeDataProvider available but cycle key not set. Falling back to parent traversal."
                    );
                    // Fallback
                    cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
                }
            } else {
                logger.warn("TestThemeTreeDataProvider not available. Falling back to parent traversal for cycle key.");
                // Fallback when provider is not available
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

        await projectManagementTreeView.displayProjectManagementTreeView();

        // Hide the test theme tree view and test elements tree view
        await hideTestThemeTreeView();
        await testElementsTreeView.hideTestElementsTreeView();
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
    // A command that combines the read and import test results commands.
    registerSafeCommand(context, allExtensionCommands.readAndImportTestResultsToTestbench, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.readAndImportTestResultsToTestbench}`);
        if (!connection) {
            const noConnectionErrorMessage: string = "No connection available. Cannot import report.";
            vscode.window.showErrorMessage(noConnectionErrorMessage);
            logger.error(noConnectionErrorMessage);
            return null;
        }

        const pmProvider = getProjectManagementTreeDataProvider();

        if (!pmProvider) {
            const missingProjectProviderErrorMessage: string =
                "Project management tree provider is not initialized. Cannot import report.";
            vscode.window.showErrorMessage(missingProjectProviderErrorMessage);
            logger.error(missingProjectProviderErrorMessage);
            return null;
        }

        await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(context);
    });

    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshProjectTreeView, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.refreshProjectTreeView} (Hard refresh)`);

        const pmProvider = getProjectManagementTreeDataProvider();
        const pTreeView = getProjectTreeView();
        if (pmProvider && pTreeView) {
            // Message update should be handled by provider via callback
            pmProvider.refresh(true); // true for hard refresh
        } else {
            logger.warn(`Project Management Tree Data Provider or Project Tree View not initialized. Cannot refresh.`);
        }
    });

    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshTestThemeTreeView, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.refreshTestThemeTreeView}`);

        const ttProvider = getTestThemeTreeDataProvider();
        const pmProvider = getProjectManagementTreeDataProvider();
        const ttView = getTestThemeTreeViewInstance();

        if (!ttProvider) {
            logger.warn("Test Theme Tree Data Provider not initialized. Cannot refresh.");
            vscode.window.showErrorMessage("Test Theme Tree is not available to refresh.");
            return;
        }

        if (!pmProvider) {
            logger.warn("Project Management Tree Data Provider not initialized. Cannot refresh.");
            vscode.window.showErrorMessage("Project Management Tree is not available to refresh.");
            return;
        }

        if (!ttView) {
            logger.warn("Test Theme TreeView instance is not available. Cannot set message.");
        }

        // Message update should be handled by provider via callback
        ttProvider.refresh();

        const currentCycleKey: string | null = ttProvider["_currentCycleKey"];
        if (currentCycleKey) {
            const firstRootInThemeTree = ttProvider.rootElements[0];
            const cycleElement: projectManagementTreeView.BaseTestBenchTreeItem | undefined =
                firstRootInThemeTree?.parent ?? undefined;

            if (
                cycleElement &&
                cycleElement.contextValue === TreeItemContextValues.CYCLE &&
                cycleElement.item?.key === currentCycleKey
            ) {
                logger.info(
                    `Refreshing Test Theme Tree for cycle: ${typeof cycleElement.label === "string" ? cycleElement.label : "N/A"}`
                );
                // Re-fetch children for this cycle and update the testThemeTreeDataProvider
                const children: projectManagementTreeView.BaseTestBenchTreeItem[] =
                    (await pmProvider.getChildrenOfCycle(cycleElement)) ?? [];
                // The setRoots will internally call refresh on testThemeTreeDataProvider
                ttProvider.setRoots(children, cycleElement.item.key);
                const themeTreeView = getTestThemeTreeViewInstance();
                if (themeTreeView) {
                    // Check if defined
                    themeTreeView.title = `Test Themes (${typeof cycleElement.label === "string" ? cycleElement.label : "Cycle"})`;
                }
            } else if (currentCycleKey) {
                logger.warn(
                    `Could not find the parent cycle element for the current Test Theme Tree (cycleKey: ${currentCycleKey}). Refreshing with current roots.`
                );
                ttProvider.refresh(); // Re-render current items.
            } else {
                logger.debug(
                    "No current cycle in Test Theme Tree to refresh, or provider not found. Clearing and refreshing."
                );
                ttProvider.clearTree(); // Calls refresh internally
            }
        } else {
            logger.warn(
                "Refresh Test Theme Tree: projectManagementTreeDataProvider or testThemeTreeDataProvider is null."
            );
            if (ttProvider) {
                ttProvider.refresh();
            } // Attempt to refresh what it has
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

            const pmProvider = getProjectManagementTreeDataProvider();
            const ttProvider = getTestThemeTreeDataProvider();

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
                if (pmProvider) {
                    pmProvider.makeRoot(treeItem);
                } else {
                    const makeRootNoProviderErrorMessage: string =
                        "MakeRoot command called without projectManagementTreeDataProvider.";
                    logger.warn(makeRootNoProviderErrorMessage);
                    vscode.window.showErrorMessage(makeRootNoProviderErrorMessage);
                }
            }
            // Check if the item belongs to the Test Theme Tree
            else if (
                ttProvider &&
                treeItem.contextValue &&
                (
                    [TreeItemContextValues.TEST_THEME_NODE, TreeItemContextValues.TEST_CASE_SET_NODE] as string[]
                ).includes(treeItem.contextValue)
            ) {
                // Delegate to testThemeTreeDataProvider if it's a test theme item
                if (typeof (ttProvider as any).makeRoot === "function") {
                    (ttProvider as any).makeRoot(treeItem);
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
        const teProvider = getTestElementsTreeDataProvider();
        if (!teProvider) {
            logger.warn("Test Elements Tree Data Provider not initialized. Cannot refresh Test Elements Tree.");
            return;
        }
        const currentTovKey: string = teProvider.getCurrentTovKey();
        if (!currentTovKey) {
            vscode.window.showErrorMessage("No TOV key stored. Please fetch test elements first.");
            return;
        }
        await teProvider.fetchTestElements(currentTovKey);
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
            const pmProvider = getProjectManagementTreeDataProvider();
            const teProvider = getTestElementsTreeDataProvider();
            // Check if the command is executed for a TOV element.
            if (pmProvider && treeItem.contextValue === TreeItemContextValues.VERSION) {
                const tovKeyOfSelectedTreeElement = treeItem.item?.key?.toString();
                if (tovKeyOfSelectedTreeElement && teProvider) {
                    const areTestElementsFetched: boolean = await teProvider.fetchTestElements(
                        tovKeyOfSelectedTreeElement,
                        typeof treeItem.label === "string" ? treeItem.label : undefined
                    );
                    if (areTestElementsFetched) {
                        await projectManagementTreeView.hideProjectManagementTreeView();
                        await displayTestElementsTreeView();
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

            const teProvider = getTestElementsTreeDataProvider();
            if (!teProvider) {
                return;
            }

            // Prompt user for new interaction name
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

            // Create the new interaction
            const newInteraction: testElementsTreeView.TestElementData | null =
                await testElementsTreeView.createInteractionUnderSubdivision(subdivisionTreeItem, interactionName);

            if (newInteraction) {
                // TODO: After the API is implemented, use the API to create the interaction on the server
                // For now, refresh the tree view to show the new interaction
                teProvider._onDidChangeTreeData.fire(undefined);

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
    // Allows the user to select a report zip file and create a new report by removing JSON files that were not selected in the quick pick from the original report zip.
    registerSafeCommand(context, allExtensionCommands.modifyReportWithResultsZip, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.modifyReportWithResultsZip}`);

        // Prompt the user to select a report zip file with results.
        const zipUris: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: {
                "Zip Files": ["zip"],
                "All Files": ["*"]
            },
            openLabel: "Select Report Zip File"
        });
        if (!zipUris || zipUris.length === 0) {
            vscode.window.showErrorMessage("No zip file selected.");
            return;
        }
        const zipPath: string = zipUris[0].fsPath;
        const quickPickItems: string[] = await reportHandler.getQuickPickItemsFromReportZipWithResults(zipPath);

        // Then call your quick pick function with the retrieved items.
        const chosenQuickPickItems: string[] = await reportHandler.showMultiSelectQuickPick(quickPickItems);
        logger.log("Trace", "User selected following json files:", chosenQuickPickItems);

        // Create a new zip file by removing JSON files that were not selected from the original report zip.
        await reportHandler.createNewReportWithSelectedItems(zipPath, chosenQuickPickItems);
    });

    // Set context value for connectionActive.
    // Used to enable or disable the login and logout buttons in the status bar,
    // which allows icon changes for login/logout buttons based on connectionActive variable.
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, connection !== null);
    logger.trace(`Context value connectionActive set to: ${connection !== null}`);
}

/**
 * Updates the context for the Language Server and triggers a restart.
 * @param {string} projectName (Optional) The name of the selected project.
 * @param {string} tovName (Optional) The name of the selected TOV.
 */
export async function updateLanguageServerContextAndRestart(projectName?: string, tovName?: string): Promise<void> {
    const projectChanged: boolean = currentLanguageServerProject !== projectName;
    const tovChanged: boolean = currentLanguageServerTov !== tovName;

    if (projectChanged || tovChanged) {
        logger.info(` Project name or TOV name changed.
            Old: Project='${currentLanguageServerProject}', TOV='${currentLanguageServerTov}'. 
            New: Project='${projectName}', TOV='${tovName}'.`);
        currentLanguageServerProject = projectName;
        currentLanguageServerTov = tovName;
        // TODO: Restart language server with new project and TOV here
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
    // Initialize logger.
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
            await loadConfiguration(context); // Automatically update config when editor changes
        })
    );

    // Load initial configuration
    await loadConfiguration(context);

    initializeTreeViews(context);

    // Set the initial connection context state. Before any login attempt, connection is null.
    // VS Code will show/hide views based on this initial state matching the 'when' clauses in package.json
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, connection !== null);
    logger.trace(`Initial connectionActive context set to: ${connection !== null}`);

    // Register the login webview provider.
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider)
    );

    // Register all extension commands.
    await registerExtensionCommands(context);

    await initializeLanguageServer();

    // Execute automatic login if the setting is enabled.
    // NOTE: Do not use await here, otherwise the login form won't be shown until the login process is finished.
    vscode.commands.executeCommand(allExtensionCommands.automaticLoginAfterExtensionActivation);
}

/**
 * Called when the extension is deactivated.
 */
export async function deactivate(): Promise<void> {
    try {
        // Gracefully log out the user when the extension is deactivated.
        await connection?.logoutUser();
        // Stop the language server if it is running
        await client.stop();
        logger.info("Extension deactivated.");
    } catch (error) {
        logger.error("Error during deactivation:", error);
    }
}
