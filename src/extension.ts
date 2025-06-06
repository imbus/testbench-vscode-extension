import { StorageKeys } from "./constants";
/**
 * @file extension.ts
 * @description Main entry point for the TestBench VS Code extension.
 */

// Before releasing the extension:
// TODO: Add License.md to the extension
// TODO: Set logger level to info or debug in production, remove too detailed logs.
// TODO: In production, remove process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; in connection class.
// Note: A virtual python environment is required for the extension to work + an empty pyproject.toml in workspace root.

import * as vscode from "vscode";
import * as testBenchLogger from "./testBenchLogger";
import * as testBenchConnection from "./testBenchConnection";
import * as reportHandler from "./reportHandler";
import * as loginWebView from "./loginWebView";
import * as utils from "./utils";
import path from "path";
import {
    allExtensionCommands,
    ConfigKeys,
    ContextKeys,
    folderNameOfInternalTestbenchFolder,
    TreeItemContextValues
} from "./constants";
import { client, restartLanguageClient, stopLanguageClient } from "./server";
import {
    TestBenchAuthenticationProvider,
    TESTBENCH_AUTH_PROVIDER_ID,
    TESTBENCH_AUTH_PROVIDER_LABEL
} from "./testBenchAuthenticationProvider";
import * as connectionManager from "./connectionManager";
import { PlayServerConnection } from "./testBenchConnection";
import { TovStructureOptions } from "./testBenchTypes";
import { getExtensionConfiguration, initializeConfigurationWatcher } from "./configuration";
import { BaseTreeItem } from "./views/common/baseTreeItem";
import { ProjectManagementTreeItem } from "./views/projectManagement/projectManagementTreeItem";
import { TestThemeTreeItem } from "./views/testTheme/testThemeTreeItem";
import { TreeServiceManager, TreeServiceDependencies } from "./services/treeServiceManager";
import { TestElementData, TestElementTreeItem } from "./views/testElements/testElementTreeItem";

/* =============================================================================
   Constants, Global Variables & Exports
   ============================================================================= */

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
export function getConnection(): testBenchConnection.PlayServerConnection | null {
    return connection;
}

/** Login webview provider instance. */
let loginWebViewProvider: loginWebView.LoginWebViewProvider | null = null;
export function getLoginWebViewProvider(): loginWebView.LoginWebViewProvider | null {
    return loginWebViewProvider;
}

// Centralized tree service manager
let treeServiceManager: TreeServiceManager;

// Global variable to store the authentication provider instance
let authProviderInstance: TestBenchAuthenticationProvider | null = null;

// Prevent multiple session change handling simultaneously
let isHandlingSessionChange: boolean = false;

// Determines if the icon of the tree item should be changed after generating tests for that item.
export const ENABLE_ICON_MARKING_ON_TEST_GENERATION: boolean = true;
// Determines if the import button of the tree item should still persist after importing test results for that item.
export const ALLOW_PERSISTENT_IMPORT_BUTTON: boolean = true;

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
 * Utility functions for tree view visibility management
 */
async function hideProjectManagementTreeView(): Promise<void> {
    await vscode.commands.executeCommand("projectManagementTree.removeView");
}

async function displayProjectManagementTreeView(): Promise<void> {
    await vscode.commands.executeCommand("projectManagementTree.focus");
}

async function hideTestThemeTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testThemeTree.removeView");
}

async function displayTestThemeTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testThemeTree.focus");
}

async function hideTestElementsTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testElementsView.removeView");
}

async function displayTestElementsTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testElementsView.focus");
}

/**
 * Initializes all tree views using the TreeServiceManager.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function initializeTreeViews(): Promise<void> {
    if (!treeServiceManager) {
        logger.error("[Extension] TreeServiceManager is not initialized. Cannot initialize tree views.");
        vscode.window.showErrorMessage("Failed to initialize TestBench views: Core services missing.");
        return;
    }

    if (!treeServiceManager.getInitializationStatus()) {
        logger.warn(
            "[Extension] TreeServiceManager is not fully initialized. Proceeding, but some services might not be ready."
        );
    }

    try {
        // Initialize all tree views through TreeServiceManager
        await treeServiceManager.initializeTreeViews();

        // Initial state setup
        try {
            const projectProvider = treeServiceManager.getProjectManagementProvider();
            const testThemeProvider = treeServiceManager.getTestThemeProvider();

            projectProvider.refresh(true);
            testThemeProvider.clearTree();
        } catch (error) {
            logger.warn("[Extension] Error during initial tree state setup:", error);
        }

        logger.info("[Extension] All tree views initialized successfully through TreeServiceManager.");
    } catch (error) {
        logger.error("[Extension] Failed to initialize tree views:", error);
        vscode.window.showErrorMessage(
            `Failed to initialize TestBench tree views: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        throw error;
    }
}

/**
 * Registers all extension commands with centralized provider access.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function registerExtensionCommands(context: vscode.ExtensionContext): Promise<void> {
    // --- Command: Show Extension Settings ---
    registerSafeCommand(context, allExtensionCommands.showExtensionSettings, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.showExtensionSettings}`);

        // Open the settings with the extension filter.
        await vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-extension"
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

        if (getExtensionConfiguration().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
            logger.info("[Cmd] Auto-login is enabled. Attempting silent login with last active connection...");

            const activeConnection: connectionManager.TestBenchConnection | undefined =
                await connectionManager.getActiveConnection(context);
            if (!activeConnection) {
                logger.info("[Cmd] Auto-login: No last active connection found. Cannot auto-login.");
                return;
            }

            if (!authProviderInstance) {
                logger.error("[Cmd] Auto-login: AuthenticationProvider instance is not available.");
                return;
            }

            try {
                await connectionManager.setActiveConnectionId(context, activeConnection.id);
                authProviderInstance.prepareForSilentAutoLogin();

                logger.trace("[Cmd] Auto-login: Calling vscode.authentication.getSession silently.");
                const session: vscode.AuthenticationSession = await vscode.authentication.getSession(
                    TESTBENCH_AUTH_PROVIDER_ID,
                    ["api_access"],
                    { createIfNone: true }
                );

                if (session) {
                    logger.info(
                        `[Cmd] Auto-login successful for connection: ${activeConnection.label} (session restored/created silently).`
                    );
                } else {
                    logger.info(
                        "[Cmd] Auto-login: No session restored/created silently. User may need to login manually."
                    );
                }
            } catch (error: any) {
                logger.warn(
                    `[Cmd] Auto-login attempt for connection "${activeConnection?.label || "unknown"}" failed silently (this is expected if credentials/connection are incomplete or server issues prevent silent login): ${error.message}`
                );
            }
        } else {
            logger.trace("[Cmd] Auto-login is disabled in settings.");
        }
    });

    // --- Command: Login ---
    registerSafeCommand(context, allExtensionCommands.login, async () => {
        logger.debug(`[Cmd] Called: ${allExtensionCommands.login}`);
        try {
            const session: vscode.AuthenticationSession = await vscode.authentication.getSession(
                TESTBENCH_AUTH_PROVIDER_ID,
                ["api_access"],
                { createIfNone: true }
            );
            if (session) {
                logger.info(`[Cmd] Login successful, session ID: ${session.id}`);
                await initializeTreeViews();
                try {
                    const projectProvider = treeServiceManager.getProjectManagementProvider();
                    projectProvider.refresh(true);
                } catch (error) {
                    logger.warn("[Cmd] Error refreshing project provider after login:", error);
                }
            }
        } catch (error) {
            logger.error(`[Cmd] Login process failed or was cancelled:`, error);
            vscode.window.showErrorMessage(`TestBench Login Failed: ${(error as Error).message}`);
        }
    });

    // --- Command: Logout ---
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
        await client?.stop();
    });

    // --- Command: Handle Cycle Click ---
    registerSafeCommand(
        context,
        allExtensionCommands.handleProjectCycleClick,
        async (cycleItem: ProjectManagementTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.handleProjectCycleClick} for item ${cycleItem.label}`);

            try {
                if (!treeServiceManager || !treeServiceManager.getInitializationStatus()) {
                    throw new Error("TreeServiceManager is not initialized");
                }

                // Hide Projects view, show Test Theme and Test Elements views
                await hideProjectManagementTreeView();
                await displayTestThemeTreeView();
                await displayTestElementsTreeView();

                await treeServiceManager.handleCycleSelection(cycleItem);
            } catch (error) {
                logger.error("[Cmd CycleClick] Error during cycle click handling:", error);

                // Reset Test Elements tree view on error
                try {
                    const testElementsTreeView = treeServiceManager.getTestElementsTreeView();
                    testElementsTreeView.title = "Test Elements";
                    const testElementsProvider = treeServiceManager.getTestElementsProvider();
                    testElementsProvider.updateTreeViewStatusMessage();
                } catch (resetError) {
                    logger.error("[Cmd CycleClick] Error resetting tree view after failure:", resetError);
                }

                vscode.window.showErrorMessage(
                    `Error handling cycle selection: ${error instanceof Error ? error.message : "Unknown error"}`
                );
            }
        }
    );

    // --- Command: Generate Test Cases For Cycle ---
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForCycle,
        async (item: ProjectManagementTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.generateTestCasesForCycle}`);
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error(`${allExtensionCommands.generateTestCasesForCycle} command called without connection.`);
                return;
            }

            if (getExtensionConfiguration().get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }

            await reportHandler.startTestGenerationForCycle(context, item);
        }
    );

    // --- Command: Generate Test Cases For Test Theme or Test Case Set ---
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet,
        async (treeItem: TestThemeTreeItem) => {
            logger.debug(
                `Command Called: ${allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet} for item: ${treeItem.label}`
            );

            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error(
                    `${allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet} command called without connection.`
                );
                return;
            }

            try {
                const testThemeProvider = treeServiceManager.getTestThemeProvider();

                if (getExtensionConfiguration().get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
                    await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
                }

                const cycleKey: string | null = testThemeProvider.getCurrentCycleKey();
                const projectKey: string | null = testThemeProvider.getCurrentProjectKey();

                if (!cycleKey || !projectKey) {
                    const errorMessage = `Error: Could not determine the active Project or Cycle context for test generation. Please ensure a cycle is selected and its themes are visible.`;
                    vscode.window.showErrorMessage(errorMessage);
                    logger.error(
                        `${errorMessage} (Project: ${projectKey}, Cycle: ${cycleKey}) for item '${treeItem.label}' (UID: ${treeItem.getUID()})`
                    );
                    return;
                }

                logger.trace(
                    `Using Project Key: '${projectKey}' and Cycle Key: '${cycleKey}' from TestThemeTreeDataProvider for test generation for item '${treeItem.label}'.`
                );

                const testGenerationSuccessful =
                    await reportHandler.generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
                        context,
                        treeItem,
                        typeof treeItem.label === "string" ? treeItem.label : treeItem.itemData?.name || "Unknown Item",
                        projectKey,
                        cycleKey,
                        treeItem.getUID() || ""
                    );

                if (testGenerationSuccessful && ENABLE_ICON_MARKING_ON_TEST_GENERATION) {
                    const markedItemStateService = treeServiceManager.markedItemStateService;
                    const itemKeyToMark = treeItem.getUniqueId();
                    const itemUIDToMark = treeItem.getUID();
                    const originalContext = treeItem.originalContextValue;

                    if (
                        itemKeyToMark &&
                        itemUIDToMark &&
                        originalContext &&
                        (originalContext === TreeItemContextValues.TEST_THEME_TREE_ITEM ||
                            originalContext === TreeItemContextValues.TEST_CASE_SET_TREE_ITEM)
                    ) {
                        const descendantUIDs = treeItem.getDescendantUIDs();
                        const descendantKeysWithUIDs = treeItem.getDescendantKeysWithUIDs();

                        await markedItemStateService.markItem(
                            itemKeyToMark,
                            itemUIDToMark,
                            projectKey,
                            cycleKey,
                            originalContext,
                            true,
                            descendantUIDs,
                            descendantKeysWithUIDs
                        );
                        testThemeProvider.refresh();
                    } else {
                        logger.warn(
                            `[Cmd Handler] Could not mark item ${treeItem.label} after generation, missing key/UID/originalContext or invalid type.`
                        );
                    }
                }
            } catch (error) {
                logger.error("[Cmd] Error in generateTestCasesForTestThemeOrTestCaseSet:", error);
                vscode.window.showErrorMessage(
                    `Error accessing Test Theme context: ${error instanceof Error ? error.message : "Unknown error"}`
                );
            }
        }
    );

    // --- Command: Display All Projects ---
    registerSafeCommand(context, allExtensionCommands.displayAllProjects, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.displayAllProjects}`);
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error(`${allExtensionCommands.displayAllProjects} command called without connection.`);
            return;
        }

        await displayProjectManagementTreeView();
        await hideTestThemeTreeView();
        await hideTestElementsTreeView();
    });

    // --- Command: Read Robotframework Test Results And Create Report With Results ---
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
    registerSafeCommand(
        context,
        allExtensionCommands.readAndImportTestResultsToTestbench,
        async (item?: TestThemeTreeItem) => {
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

            try {
                const testThemeProvider = treeServiceManager.getTestThemeProvider();
                const markedItemStateService = treeServiceManager.markedItemStateService;

                const targetProjectKey = testThemeProvider.getCurrentProjectKey();
                const targetCycleKey = testThemeProvider.getCurrentCycleKey();

                if (!targetProjectKey || !targetCycleKey) {
                    const errorMsg = `Could not determine active Project/Cycle key for import. Please ensure a cycle is selected.`;
                    logger.error(errorMsg);
                    vscode.window.showErrorMessage(errorMsg);
                    return null;
                }

                const itemKey = item.getUniqueId();
                const itemUID = item.getUID();
                const resolvedReportRootUID = markedItemStateService.getReportRootUID(
                    itemKey,
                    itemUID,
                    targetProjectKey,
                    targetCycleKey
                );

                if (!resolvedReportRootUID) {
                    const errorMsg = `Cannot determine Report Root UID for item: ${item.label}. This item may not be eligible for import or was not properly marked after test generation.`;
                    logger.error(errorMsg);
                    vscode.window.showErrorMessage(errorMsg);
                    return null;
                }

                const importSuccessful = await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(
                    context,
                    item,
                    targetProjectKey,
                    targetCycleKey,
                    resolvedReportRootUID
                );

                if (importSuccessful) {
                    logger.info(
                        `Import process for item ${item.label} (UID: ${resolvedReportRootUID}) reported success.`
                    );
                    if (!ALLOW_PERSISTENT_IMPORT_BUTTON) {
                        logger.debug(
                            `Clearing marked state for item: ${item.label} as ALLOW_PERSISTENT_IMPORT_BUTTON is false.`
                        );
                        await markedItemStateService.clearMarking(itemKey);
                    } else {
                        logger.debug(
                            `ALLOW_PERSISTENT_IMPORT_BUTTON is true. Import button will persist for item: ${item.label}`
                        );
                    }
                    testThemeProvider.refresh();
                } else {
                    logger.warn(
                        `Import process for item ${item.label} (UID: ${resolvedReportRootUID}) did not complete successfully or was cancelled.`
                    );
                }
            } catch (error) {
                logger.error("[Cmd] Error in readAndImportTestResultsToTestbench:", error);
                vscode.window.showErrorMessage(
                    `Error accessing Test Theme context: ${error instanceof Error ? error.message : "Unknown error"}`
                );
            }
        }
    );

    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshProjectTreeView, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.refreshProjectTreeView}`);

        try {
            const projectProvider = treeServiceManager.getProjectManagementProvider();
            projectProvider.refresh(false);
        } catch (error) {
            logger.error("[Cmd] Error refreshing project tree:", error);
            vscode.window.showErrorMessage("Failed to refresh project tree. Please check logs for details.");
        }
    });

    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshTestThemeTreeView, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.refreshTestThemeTreeView}`);

        try {
            const testThemeProvider = treeServiceManager.getTestThemeProvider();
            const testThemeTreeView = treeServiceManager.getTestThemeTreeView();

            if (!testThemeProvider.getCurrentCycleKey() || !testThemeProvider.getCurrentProjectKey()) {
                logger.info("Test Theme Tree: No current cycle selected to refresh. Clearing tree.");
                testThemeProvider.clearTree();
                testThemeTreeView.title = "Test Themes";
                return;
            }

            await testThemeProvider.refresh(false);
            logger.info("Test Theme Tree view refresh completed successfully.");
        } catch (error) {
            logger.error("[Cmd] Error refreshing test theme tree:", error);
            vscode.window.showErrorMessage("Failed to refresh Test Themes. Check logs for details.");
        }
    });

    // --- Command: Make Root ---
    registerSafeCommand(context, allExtensionCommands.makeRoot, (treeItem: BaseTreeItem) => {
        logger.debug(`Command Called: ${allExtensionCommands.makeRoot} for tree item:`, treeItem);
        if (!treeItem) {
            logger.warn("MakeRoot command called with null treeItem.");
            return;
        }

        try {
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
                const projectProvider = treeServiceManager.getProjectManagementProvider();
                projectProvider.makeRoot(treeItem as ProjectManagementTreeItem);
            }
            // Check if the item belongs to the Test Theme Tree
            else if (
                treeItem.contextValue &&
                (
                    [
                        TreeItemContextValues.TEST_THEME_TREE_ITEM,
                        TreeItemContextValues.TEST_CASE_SET_TREE_ITEM,
                        TreeItemContextValues.MARKED_TEST_THEME_TREE_ITEM,
                        TreeItemContextValues.MARKED_TEST_CASE_SET_TREE_ITEM
                    ] as string[]
                ).includes(treeItem.contextValue)
            ) {
                const testThemeProvider = treeServiceManager.getTestThemeProvider();
                if (typeof (testThemeProvider as any).makeRoot === "function") {
                    (testThemeProvider as any).makeRoot(treeItem);
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
        } catch (error) {
            logger.error("[Cmd] Error in makeRoot command:", error);
            vscode.window.showErrorMessage(`Failed to make '${treeItem.label}' a root: ${(error as Error).message}`);
        }
    });

    // --- Command: Reset Project Tree View Root ---
    registerSafeCommand(context, allExtensionCommands.resetProjectTreeViewRoot, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.resetProjectTreeViewRoot}`);
        try {
            const projectProvider = treeServiceManager.getProjectManagementProvider();
            projectProvider.resetCustomRoot();
        } catch (error) {
            logger.error("[Cmd] Error resetting project tree root:", error);
            vscode.window.showWarningMessage("Failed to reset project tree root.");
        }
    });

    // --- Command: Reset Test Theme Tree View Root ---
    registerSafeCommand(context, allExtensionCommands.resetTestThemeTreeViewRoot, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.resetTestThemeTreeViewRoot}`);
        try {
            const testThemeProvider = treeServiceManager.getTestThemeProvider();
            testThemeProvider.resetCustomRoot();
        } catch (error) {
            logger.error("[Cmd] Error resetting test theme tree root:", error);
            vscode.window.showWarningMessage("Failed to reset test theme tree root.");
        }
    });

    // --- Command: Clear Workspace Folder ---
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
            !getExtensionConfiguration().get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR) // Ask for confirmation if not set to clear before test generation
        );
    });

    // --- Command: Refresh Test Elements Tree ---
    registerSafeCommand(context, allExtensionCommands.refreshTestElementsTree, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.refreshTestElementsTree}`);

        try {
            const testElementsProvider = treeServiceManager.getTestElementsProvider();
            const currentTovKey: string = testElementsProvider.getCurrentTovKey();

            if (!currentTovKey) {
                logger.info("No TOV key available for refresh. Clearing tree with appropriate message.");
                testElementsProvider.clearTree();
                return;
            }

            logger.debug(`Refreshing test elements for TOV: ${currentTovKey}`);
            await testElementsProvider.refresh(false);
        } catch (error) {
            logger.error(`[Cmd] Error during test elements refresh:`, error);
            vscode.window.showErrorMessage(
                `Error refreshing test elements: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    });

    // --- Command: Go To Resource File ---
    registerSafeCommand(
        context,
        allExtensionCommands.openOrCreateRobotResourceFile,
        async (treeItem: TestElementTreeItem) => {
            logger.debug(
                `Command Called: ${allExtensionCommands.openOrCreateRobotResourceFile} for tree item:`,
                treeItem
            );
            try {
                const testElementsProvider = treeServiceManager.getTestElementsProvider();
                await testElementsProvider.handleGoToResourceCommand(treeItem);
            } catch (error) {
                logger.error("[Cmd] Error handling Go To Resource File command:", error);
                vscode.window.showErrorMessage("Failed to handle resource file operation. Please try again.");
            }
        }
    );

    // --- Command: Create Interaction Under Subdivision ---
    registerSafeCommand(
        context,
        allExtensionCommands.createInteractionUnderSubdivision,
        async (subdivisionTreeItem: TestElementTreeItem) => {
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

            try {
                const testElementsProvider = treeServiceManager.getTestElementsProvider();

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

                const newInteraction: TestElementData | null =
                    await testElementsProvider.createInteractionUnderSubdivision(subdivisionTreeItem, interactionName);

                if (newInteraction) {
                    testElementsProvider._onDidChangeTreeData.fire(undefined);
                    vscode.window.showInformationMessage(`Successfully created interaction '${interactionName}'`);
                    logger.debug(
                        `Created new interaction '${interactionName}' under subdivision '${subdivisionTreeItem.testElementData.name}'`
                    );
                }
            } catch (error) {
                logger.error("[Cmd] Error creating interaction under subdivision:", error);
                vscode.window.showErrorMessage("Failed to create interaction. Please try again.");
            }
        }
    );

    // --- Command: Open Issue Reporter ---
    registerSafeCommand(context, allExtensionCommands.openIssueReporter, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.openIssueReporter}`);
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench-extension"
        });
    });

    // --- Command: Modify Report With Results Zip ---
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
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    // --- Command: Generate Test Cases For TOV ---
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForTOV,
        async (tovItem: ProjectManagementTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.generateTestCasesForTOV} for item: ${tovItem.label}`);

            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error(`${allExtensionCommands.generateTestCasesForTOV} command called without connection.`);
                return;
            }

            if (getExtensionConfiguration().get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }

            try {
                const projectKey = tovItem.getProjectKey();
                const tovKey = tovItem.getUniqueId();
                const tovName = typeof tovItem.label === "string" ? tovItem.label : "Unknown TOV";

                if (!projectKey || !tovKey) {
                    const errorMessage = "Could not determine project or TOV key for test generation.";
                    vscode.window.showErrorMessage(errorMessage);
                    logger.error(`${errorMessage} Project: ${projectKey}, TOV: ${tovKey}`);
                    return;
                }

                // For TOV-level generation, we'll need to handle this differently than cycle generation
                // This would generate tests for the entire TOV rather than a specific cycle
                logger.info(`Starting test generation for TOV: ${tovName} (${tovKey}) in project: ${projectKey}`);

                // Here you would implement TOV-level test generation logic
                // This might involve fetching TOV structure and generating tests for all test themes
                await reportHandler.startTestGenerationForTOV(context, tovItem, projectKey, tovKey);
            } catch (error) {
                logger.error("[Cmd] Error in generateTestCasesForTOV:", error);
                vscode.window.showErrorMessage(
                    `Error generating tests for TOV: ${error instanceof Error ? error.message : "Unknown error"}`
                );
            }
        }
    );

    // --- Command: Open TOV Test Elements ---
    registerSafeCommand(
        context,
        allExtensionCommands.openTOVFromProjectsView,
        async (tovItem: ProjectManagementTreeItem) => {
            logger.debug(
                `Command Called: ${allExtensionCommands.openTOVFromProjectsView} for TOV item: ${tovItem.label}`
            );

            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error(`${allExtensionCommands.openTOVFromProjectsView} command called without connection.`);
                return;
            }

            try {
                const projectProvider = treeServiceManager.getProjectManagementProvider();
                const testElementsProvider = treeServiceManager.getTestElementsProvider();
                const testElementsTreeView = treeServiceManager.getTestElementsTreeView();

                if (tovItem.contextValue === TreeItemContextValues.VERSION) {
                    const tovKeyOfSelectedTreeElement = tovItem.itemData?.key?.toString();
                    const tovLabel = typeof tovItem.label === "string" ? tovItem.label : "Unknown TOV";

                    if (tovKeyOfSelectedTreeElement) {
                        testElementsTreeView.title = `Test Elements (Loading...)`;

                        const areTestElementsFetched: boolean = await testElementsProvider.fetchTestElements(
                            tovKeyOfSelectedTreeElement,
                            tovLabel
                        );

                        if (areTestElementsFetched) {
                            await hideProjectManagementTreeView();
                            await displayTestElementsTreeView();
                            testElementsTreeView.title = `Test Elements (${tovLabel})`;

                            // Persist the active TOV context for restoration
                            const tovContext = { tovKey: tovKeyOfSelectedTreeElement, tovLabel };
                            await context.workspaceState.update(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, tovContext);
                            logger.trace(`[Cmd] Persisted active TOV context:`, tovContext);

                            // Restart language client for the selected project/TOV
                            const projectAndTovNameObj = projectProvider.getProjectAndTovNamesForItem(tovItem);
                            if (projectAndTovNameObj) {
                                const { projectName, tovName } = projectAndTovNameObj;
                                if (projectName && tovName) {
                                    await restartLanguageClient(projectName, tovName);
                                }
                            }
                        } else {
                            testElementsTreeView.title = "Test Elements";
                            logger.warn(`Test Elements fetch failed for TOV: ${tovKeyOfSelectedTreeElement}`);
                            vscode.window.showErrorMessage(`Failed to fetch test elements for TOV: ${tovLabel}`);
                        }
                    } else {
                        const errorMsg = "Invalid TOV selection for test elements display.";
                        logger.warn(errorMsg);
                        vscode.window.showWarningMessage(errorMsg);
                    }
                }
            } catch (error) {
                logger.error(`[Cmd] Error in OpenTOVFromProjectsView command:`, error);
                try {
                    const testElementsTreeView = treeServiceManager.getTestElementsTreeView();
                    const testElementsProvider = treeServiceManager.getTestElementsProvider();
                    testElementsTreeView.title = "Test Elements";
                    testElementsProvider.updateTreeViewStatusMessage();
                } catch (resetError) {
                    logger.error("[Cmd] Error resetting test elements view after failure:", resetError);
                }
                vscode.window.showErrorMessage(
                    `Error loading test elements: ${error instanceof Error ? error.message : "Unknown error"}`
                );
            }
        }
    );

    // --- Command: Open Cycle Test Themes ---
    registerSafeCommand(
        context,
        allExtensionCommands.openCycleFromProjectsView,
        async (cycleTreeItem: ProjectManagementTreeItem) => {
            logger.debug(
                `Command Called: ${allExtensionCommands.openCycleFromProjectsView} for cycle tree item: ${cycleTreeItem.label}`
            );

            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error(`${allExtensionCommands.openCycleFromProjectsView} command called without connection.`);
                return;
            }

            try {
                if (!treeServiceManager || !treeServiceManager.getInitializationStatus()) {
                    throw new Error("TreeServiceManager is not initialized");
                }

                // Hide Projects view, show Test Theme and Test Elements views
                await hideProjectManagementTreeView();
                await displayTestThemeTreeView();
                await displayTestElementsTreeView();

                await treeServiceManager.handleCycleSelection(cycleTreeItem);
            } catch (error) {
                logger.error("[Cmd OpenCycleFromProjectsView] Error during cycle open handling:", error);

                // Reset Test Elements tree view on error
                try {
                    const testElementsTreeView = treeServiceManager.getTestElementsTreeView();
                    testElementsTreeView.title = "Test Elements";
                    const testElementsProvider = treeServiceManager.getTestElementsProvider();
                    testElementsProvider.updateTreeViewStatusMessage();
                } catch (resetError) {
                    logger.error(
                        "[Cmd OpenCycleFromProjectsView] Error resetting tree view after failure:",
                        resetError
                    );
                }

                vscode.window.showErrorMessage(
                    `Error opening cycle: ${error instanceof Error ? error.message : "Unknown error"}`
                );
            }
        }
    );
}

/**
 * Handles changes in the TestBench authentication session with centralized tree management.
 *
 * @param {vscode.ExtensionContext} context - The VS Code extension context.
 * @param {vscode.AuthenticationSession} existingSession - An optional existing authentication session to process.
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
        const activeConnection = await connectionManager.getActiveConnection(context);
        if (activeConnection) {
            // Check if a connection for this session and connection already exists
            if (
                connection &&
                connection.getSessionToken() === sessionToProcess.accessToken &&
                connection.getUsername() === activeConnection.username &&
                connection.getServerName() === activeConnection.serverName &&
                connection.getServerPort() === activeConnection.portNumber.toString()
            ) {
                logger.info(
                    `[Extension] Connection for connection '${activeConnection.label}' and current session token is already active. Skipping re-initialization.`
                );
                return;
            }

            logger.info(
                `[Extension] TestBench session active for connection: ${activeConnection.label}. Initializing PlayServerConnection.`
            );

            if (connection) {
                logger.warn(
                    "[Extension] A different connection was active. Logging out from previous server session before establishing new one."
                );
                await connection.logoutUserOnServer();
            }

            const newConnection = new PlayServerConnection(
                activeConnection.serverName,
                activeConnection.portNumber,
                activeConnection.username,
                sessionToProcess.accessToken
            );
            setConnection(newConnection);
            await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, true);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();

            // Refresh tree providers as the session has changed.
            if (
                !wasPreviouslyConnected ||
                (connection && connection.getSessionToken() !== newConnection.getSessionToken())
            ) {
                logger.info("[Extension] New session established. Refreshing project data.");
                try {
                    const projectProvider = treeServiceManager.getProjectManagementProvider();
                    const testThemeProvider = treeServiceManager.getTestThemeProvider();
                    const testElementsProvider = treeServiceManager.getTestElementsProvider();

                    projectProvider.refresh(true);
                    testThemeProvider.clearTree();
                    testElementsProvider.clearTree();

                    logger.debug("[Extension] Restoring data and view state after login.");

                    await treeServiceManager.restoreDataState();

                    treeServiceManager.restoreVisibleViewsState();
                } catch (error) {
                    logger.warn("[Extension] Error managing trees during session change:", error);
                    await vscode.commands.executeCommand(allExtensionCommands.displayAllProjects);
                }
            }
        } else {
            logger.warn("[Extension] Session exists, but no active connection. Clearing connection.");
            if (connection) {
                await connection.logoutUserOnServer();
            }
            setConnection(null);
            await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();

            logger.debug("[Extension] Restoring data and view state after session change.");
            await treeServiceManager.restoreDataState();
            treeServiceManager.restoreVisibleViewsState();

            try {
                await treeServiceManager.clearAllTreesData();
            } catch (error) {
                logger.warn("[Extension] Error clearing tree data during session change:", error);
            }
        }
    } else {
        logger.info("[Extension] No active session. Clearing connection.");
        if (connection) {
            await connection.logoutUserOnServer();
        }
        setConnection(null);
        await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
        getLoginWebViewProvider()?.updateWebviewHTMLContent();

        try {
            await treeServiceManager.clearAllTreesData();
        } catch (error) {
            logger.warn("[Extension] Error clearing tree data during session change:", error);
        }
    }
}

/* =============================================================================
   Extension Activation & Deactivation
   ============================================================================= */

/**
 * Called when the extension is activated.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger = new testBenchLogger.TestBenchLogger();
    logger.info("Extension activated.");
    initializeConfigurationWatcher();

    // Register AuthenticationProvider
    authProviderInstance = new TestBenchAuthenticationProvider(context);
    context.subscriptions.push(
        vscode.authentication.registerAuthenticationProvider(
            TESTBENCH_AUTH_PROVIDER_ID,
            TESTBENCH_AUTH_PROVIDER_LABEL,
            authProviderInstance,
            { supportsMultipleAccounts: false }
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

    // Initialize TreeServiceManager
    const treeServiceDependencies: TreeServiceDependencies = {
        extensionContext: context,
        logger: logger,
        getConnection: getConnection
    };

    treeServiceManager = new TreeServiceManager(treeServiceDependencies);

    try {
        await treeServiceManager.initialize();
        logger.info("[Extension] TreeServiceManager initialized successfully.");
    } catch (error) {
        logger.error("[Extension] TreeServiceManager initialization failed:", error);
        vscode.window.showErrorMessage(
            "TestBench Extension critical services failed to initialize. Some features may be unavailable."
        );
    }

    await initializeTreeViews();

    // Set the initial connection context state
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, connection !== null);
    logger.trace(`Initial connectionActive context set to: ${connection !== null}`);

    await vscode.commands.executeCommand("setContext", ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false);
    await vscode.commands.executeCommand("setContext", ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);

    // Initialize login webview
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    await registerExtensionCommands(context);

    // Attempt to restore session on activation
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
            if (!getExtensionConfiguration().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
                await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
                getLoginWebViewProvider()?.updateWebviewHTMLContent();
            }
        }
    } catch (error) {
        logger.warn("[Extension] Error trying to get initial session silently:", error);
        await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
    }

    // Trigger Automatic Login Command if configured
    if (getExtensionConfiguration().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
        logger.info("[Extension] Auto-login configured. Triggering automatic login command.");
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
        if (treeServiceManager) {
            logger.info("[Extension] Disposing TreeServiceManager on deactivation.");
            treeServiceManager.dispose();
        }
        logger.info("Extension deactivated.");
    } catch (error) {
        logger.error("Error during deactivation:", error);
    }
}
