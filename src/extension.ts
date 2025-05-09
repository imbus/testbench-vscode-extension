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
import { initializeLanguageServer } from "./server";
import { displayTestThemeTreeView, hideTestThemeTreeView, TestThemeTreeDataProvider } from "./testThemeTreeView";

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

/** Module-private webview provider instance. */
let loginWebViewProvider: loginWebView.LoginWebViewProvider | null = null;
export function getLoginWebViewProvider(): loginWebView.LoginWebViewProvider | null {
    return loginWebViewProvider;
}

/** Module-private variables to hold instances */
let _projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null = null;
let _testThemeTreeDataProvider: TestThemeTreeDataProvider | null = null;
let _testThemeTreeViewInstance: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> | undefined;
let _testElementTreeView: vscode.TreeView<testElementsTreeView.TestElementTreeItem> | undefined;
let _projectTreeView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> | undefined;
let _testElementsTreeDataProvider: testElementsTreeView.TestElementsTreeDataProvider | undefined;

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
    return _testThemeTreeViewInstance;
}

export function getTestElementTreeView(): vscode.TreeView<testElementsTreeView.TestElementTreeItem> | undefined {
    return _testElementTreeView;
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
 * @param {string} commandId The command ID.
 * @param {(...args: any[]) => any} callback The command handler.
 */
function registerSafeCommand(
    context: vscode.ExtensionContext,
    commandId: string,
    callback: (...args: any[]) => any
): void {
    const disposable = vscode.commands.registerCommand(commandId, safeCommandHandler(callback));
    // Adding the command to the context subscriptions disposes them automatically when the extension is deactivated.
    context.subscriptions.push(disposable);
}

// Global variable to store the current configuration scope (workspace or global).
let currentConfigScope: vscode.Uri | undefined;
let activeEditor: vscode.TextEditor | undefined;

/**
 * Loads the latest extension configuration and updates the global configuration object.
 * Also handles the storage of credentials based on the configuration settings.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function loadConfiguration(context: vscode.ExtensionContext, newScope?: vscode.Uri): Promise<void> {
    // If no new scope provided, determine the best scope automatically
    if (newScope === undefined) {
        if (activeEditor) {
            newScope = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri;
        } else if (vscode.workspace.workspaceFolders?.length === 1) {
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

    // Update the webview input fields after extension settings are changed to reflect the changes in the webview live.
    // Commented out due to the password field being empty after the extension settings are changed.
    // await loginWebViewProvider?.updateWebviewHTMLContent();
}

/**
 * Initializes the Test Elements Tree View.
 *
 * This function sets up the tree data provider for the test elements,
 * creates the tree view itself, and registers it with the extension's subscriptions.
 * It also handles the initial message display if the tree is empty and
 * hides the tree view by default.
 *
 * @param context - The extension context provided by VS Code, used for managing disposables.
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
    context.subscriptions.push(_testElementTreeView); // Add to subscriptions

    if (_testElementsTreeDataProvider.isTreeDataEmpty()) {
        // Message setting will be handled by the provider via callback
        _testElementsTreeDataProvider.updateMessage();
    }
    // Hide the test elements tree view initially.
    testElementsTreeView.hideTestElementsTreeView();
}

/**
 * Initializes the project tree and test elements tree.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export function initializeTreeViews(context: vscode.ExtensionContext): void {
    // Create TestThemeTreeDataProvider
    _testThemeTreeDataProvider = new TestThemeTreeDataProvider((message) => {
        // Pass callback for message updates
        if (_testThemeTreeViewInstance) {
            _testThemeTreeViewInstance.message = message;
        }
    });
    _testThemeTreeViewInstance = vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: _testThemeTreeDataProvider
    });
    context.subscriptions.push(_testThemeTreeViewInstance);

    _projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(
        (message) => {
            // Pass callback for message updates
            if (_projectTreeView) {
                _projectTreeView.message = message;
            }
        },
        _testThemeTreeDataProvider // Pass testThemeTreeDataProvider instance
    );
    const newProjectTreeView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> =
        vscode.window.createTreeView("projectManagementTree", {
            treeDataProvider: _projectManagementTreeDataProvider,
            canSelectMany: false
        });
    context.subscriptions.push(newProjectTreeView);
    _projectTreeView = newProjectTreeView; // Assign to module-private variable

    // Listen to the new event from ProjectManagementTreeDataProvider
    if (_projectManagementTreeDataProvider && _testThemeTreeViewInstance && _testThemeTreeDataProvider) {
        context.subscriptions.push(
            _projectManagementTreeDataProvider.onDidPrepareCycleDataForThemeTree(
                async (eventData: CycleDataForThemeTreeEvent) => {
                    if (_testThemeTreeDataProvider && _testThemeTreeViewInstance) {
                        // Also check _testThemeTreeViewInstance
                        logger.info(`Cycle data prepared for ${eventData.cycleLabel}. Updating Test Theme Tree.`);
                        _testThemeTreeDataProvider.clearTree();
                        _testThemeTreeDataProvider.populateFromCycleData(eventData);

                        // Update the title of the Test Themes tree view
                        _testThemeTreeViewInstance.title = `Test Themes (${eventData.cycleLabel})`;
                        logger.trace(`Test Theme TreeView title updated to: ${_testThemeTreeViewInstance.title}`);

                        await projectManagementTreeView.hideProjectManagementTreeView();
                        await displayTestThemeTreeView();
                        if (getTestElementsTreeDataProvider()) {
                            await testElementsTreeView.displayTestElementsTreeView();
                        }
                    }
                }
            )
        );
    }

    // Initial data load/refresh for project tree
    _projectManagementTreeDataProvider?.refresh(true); // true for hard refresh

    if (_testThemeTreeDataProvider && _testThemeTreeViewInstance) {
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
 * Registers all the commands defined by the extension.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function registerExtensionCommands(context: vscode.ExtensionContext): Promise<void> {
    // --- Command: Show Extension Settings ---
    registerSafeCommand(context, allExtensionCommands.showExtensionSettings, async () => {
        logger.debug("Command Called: Show Extension Settings");

        // Open the settings with the extension filter.
        await vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-visual-studio-code-extension"
        });
        // Open the workspace settings view (The default settings view is user settings)
        await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
        logger.trace("End of command: Show Extension Settings");
    });

    // --- Command: Set Workspace ---
    registerSafeCommand(context, allExtensionCommands.setWorkspace, async () => {
        logger.debug("Command Called: Set Workspace");
        await utils.setWorkspaceLocation();
        logger.trace("End of command: Set Workspace");
    });

    // --- Command: Automatic Login After Activation ---
    registerSafeCommand(context, allExtensionCommands.automaticLoginAfterExtensionActivation, async () => {
        // If auto login is active and the password is stored in the secrets, perform the login automatically.
        if (
            config.get<boolean>("automaticLoginAfterExtensionActivation", false) &&
            config.get<boolean>("storePasswordAfterLogin", false) &&
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
            logger.trace("Automatic login is disabled or password is not stored.");
        }
    });

    // --- Command: Login ---
    // Prevent multiple login processes from running simultaneously.
    let isLoginProcessAlreadyRunning: boolean = false;
    // Performs the login process and stores the connection object.
    registerSafeCommand(context, allExtensionCommands.login, async () => {
        logger.debug("Command Called: Login");
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
                const pmProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null =
                    getProjectManagementTreeDataProvider();
                if (pmProvider) {
                    pmProvider.refresh();
                }
            }
        } catch (error) {
            logger.error(`Login process failed: ${error}`);
        } finally {
            // Release the lock after login attempt.
            isLoginProcessAlreadyRunning = false;
            logger.trace("isLoginProcessAlreadyRunning flag is reset to false after login attempt.");
        }
        logger.trace("End of command: Login");
    });

    // --- Command: Logout ---
    // Performs the logout process, clears the connection object and shows the login webview.
    registerSafeCommand(context, allExtensionCommands.logout, async () => {
        logger.debug("Command Called: Logout");
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

        logger.trace("End of command: Logout");
    });

    // --- Command: Handle Cycle Click ---
    // Handles the click event on a project cycle in the project management tree view.
    registerSafeCommand(
        context,
        allExtensionCommands.handleProjectCycleClick,
        async (cycleItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            const pmProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null =
                getProjectManagementTreeDataProvider();
            if (pmProvider) {
                await pmProvider.handleTestCycleClick(cycleItem);
            } else {
                logger.error("Project management tree data provider is not initialized. (Handle Cycle Click)");
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
            logger.debug("Command Called: Generate Test Cases For Cycle");
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error("generateTestCasesForCycle command called without connection.");
                return;
            }

            const pmProvider = getProjectManagementTreeDataProvider();
            const ttProvider = getTestThemeTreeDataProvider();

            if (!pmProvider) {
                vscode.window.showErrorMessage(
                    "Project management tree is not initialized. Please select a project first."
                );
                logger.error("generateTestCasesForCycle command called without project data provider.");
                return;
            }
            // Optionally clear the working directory before test generation.
            if (config.get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }

            // If the user did not clicked on a test cycle in the tree view before,
            // the test cycle wont have any initialized children so that test themes cannot be displayed in the quickpick.
            // Call getChildrenOfCycle to initialize the sub elements (Test themes etc.) of the cycle.
            // Offload the children of the cycle to the Test Theme Tree View.
            if (pmProvider && ttProvider) {
                const children: projectManagementTreeView.BaseTestBenchTreeItem[] =
                    (await pmProvider.getChildrenOfCycle(item)) ?? [];
                if (item.item?.key) {
                    // The projectManagementTreeDataProvider.handleTestCycleClick method
                    // already fires an event that leads to testThemeTreeDataProvider.setRoots.
                    // But this command might be triggered from a context menu without a "click"
                    // that would normally populate the TestThemeTree.

                    // Directly update TestThemeTree (if this command is the primary trigger for this view for this action)
                    ttProvider.clearTree(); // Clear previous state
                    ttProvider.setRoots(children, item.item.key);

                    const ttView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> | undefined =
                        getTestThemeTreeViewInstance();

                    if (ttView) {
                        const themeTreeView:
                            | vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem>
                            | undefined = getTestThemeTreeViewInstance();
                        if (themeTreeView) {
                            themeTreeView.title = `Test Themes (${typeof item.label === "string" ? item.label : "Cycle"})`;
                        }
                    }
                    await vscode.commands.executeCommand("testThemeTree.focus");
                } else {
                    logger.warn(
                        `Cycle key not found for item '${typeof item.label === "string" ? item.label : "unknown"}' in 'generateTestCasesForCycle'. Cannot set roots for test theme tree.`
                    );
                }
            } else {
                logger.warn(
                    "generateTestCasesForCycle: projectManagementTreeDataProvider or testThemeTreeDataProvider is null."
                );
            }
            await reportHandler.startTestGenerationForCycle(context, item);
            logger.trace("End of command: Generate Test Cases For Cycle");
        }
    );

    // --- Command: Fetch Report for Selected Tree Item ---
    registerSafeCommand(
        context,
        allExtensionCommands.fetchReportForSelectedTreeItem,
        async (treeItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            await reportHandler.fetchReportForTreeElement(
                treeItem,
                getProjectManagementTreeDataProvider(),
                folderNameOfInternalTestbenchFolder
            );
        }
    );

    // --- Command: Generate Test Cases For Test Theme or Test Case Set ---
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet,
        async (treeItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug("Command Called: Generate Test Cases For Test Theme or Test Case Set");
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error("generateTestCasesForTestThemeOrTestCaseSet command called without connection.");
                return;
            }
            // Optionally clear the working directory before test generation.
            if (config.get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }

            const ttProvider = getTestThemeTreeDataProvider();
            let cycleKey: string | null = null;

            if (
                (ttProvider && ttProvider.rootElements.includes(treeItem)) ||
                (ttProvider && treeItem.parent && ttProvider.rootElements.includes(treeItem.parent))
            ) {
                cycleKey = ttProvider["_currentCycleKey"];
                if (cycleKey) {
                    if (!cycleKey) {
                        logger.error(
                            "Cycle key could not be determined from TestThemeTreeDataProvider for item:",
                            treeItem.label
                        );
                        vscode.window.showErrorMessage("Could not determine the current cycle for test generation.");
                        return;
                    }
                    logger.info(`Using cycleKey '${cycleKey}' from TestThemeTreeDataProvider for test generation.`);
                } else {
                    logger.error("Could not retrieve current cycle key from TestThemeTreeDataProvider.");
                    vscode.window.showErrorMessage("Failed to identify the current cycle for test generation.");
                    return;
                }
            } else {
                // Fallback or if item is from another tree (should not happen for this command context)
                logger.warn(
                    "Item not recognized as part of the current TestThemeTree. Falling back to parent traversal for cycle key."
                );
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
            logger.trace("End of command: Generate Test Cases For Test Theme or Test Case Set");
        }
    );

    // --- Command: Display All Projects ---
    // Opens the project management tree view and displays all projects with their contents.
    registerSafeCommand(context, allExtensionCommands.displayAllProjects, async () => {
        logger.debug("Command Called: Display All Projects");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error("displayAllProjects command called without connection.");
            return;
        }

        // Clear all tree states before reloading
        const pmProvider = getProjectManagementTreeDataProvider();
        const ttProvider = getTestThemeTreeDataProvider();
        const teProvider = getTestElementsTreeDataProvider();

        pmProvider?.clearTree();
        ttProvider?.clearTree();
        if (teProvider) {
            teProvider.refresh([]);
        }

        await projectManagementTreeView.displayProjectManagementTreeView();

        // After selecting a (new) project, hide the test theme tree view and test elements tree view and clear the test elements tree view.
        await hideTestThemeTreeView();
        await testElementsTreeView.hideTestElementsTreeView();
        testElementsTreeView.clearTestElementsTreeView();

        logger.trace("Project list refreshed in project management tree view.");
    });

    // --- Command: Toggle Project Management Tree View Visibility ---
    registerSafeCommand(context, allExtensionCommands.toggleProjectManagementTreeViewVisibility, async () => {
        await projectManagementTreeView.toggleProjectManagementTreeViewVisibility();
    });

    // --- Command: Toggle Test Theme Tree View Visibility ---
    registerSafeCommand(context, allExtensionCommands.toggleTestThemeTreeViewVisibility, async () => {
        await projectManagementTreeView.toggleTestThemeTreeViewVisibility();
    });

    // --- Command: Read Robotframework Test Results And Create Report With Results ---
    // Activated for a test theme or test case set element.
    // Reads the test results (output.xml) from the testbench working directory and creates a report zip file with the results.
    registerSafeCommand(context, allExtensionCommands.readRFTestResultsAndCreateReportWithResults, async () => {
        logger.debug("Command Called: Read RF Test Results And Create Report With Results");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error("readRFTestResultsAndCreateReportWithResults command called without connection.");
            return;
        }
        await reportHandler.fetchTestResultsAndCreateReportWithResultsWithTb2Robot(context);
        logger.trace("End of command: Read RF Test Results And Create Report With Results");
    });

    // --- Command: Import Test Results To Testbench ---
    // Imports the selected test results zip to the testbench server
    registerSafeCommand(context, allExtensionCommands.importTestResultsToTestbench, async () => {
        logger.debug("Command Called: Import Test Results To Testbench");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error("importTestResultsToTestbench command called without connection.");
            return;
        }

        await testBenchConnection.selectReportWithResultsAndImportToTestbench(connection);
        logger.trace("End of command: Import Test Results To Testbench");
    });

    // --- Command: Read And Import Test Results To Testbench ---
    // A command that combines the read and import test results commands.
    registerSafeCommand(context, allExtensionCommands.readAndImportTestResultsToTestbench, async () => {
        logger.debug("Command called: Read And Import Test Results To Testbench");
        if (!connection) {
            const noConnectionErrorMessage: string = "No connection available. Cannot import report.";
            vscode.window.showErrorMessage(noConnectionErrorMessage);
            logger.error(noConnectionErrorMessage);
            return null;
        }

        const pmProvider = getProjectManagementTreeDataProvider();

        if (!pmProvider) {
            const missingProviderErrorMessage: string =
                "Project management tree provider is not initialized. Cannot import report.";
            vscode.window.showErrorMessage(missingProviderErrorMessage);
            logger.error(missingProviderErrorMessage);
            return null;
        }

        await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(context);
        logger.trace("End of Command: Read And Import Test Results To Testbench");
    });

    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshProjectTreeView, async () => {
        logger.debug("Command Called: Refresh Project Tree View (Hard Refresh)");

        const pmProvider = getProjectManagementTreeDataProvider();
        const pTreeView = getProjectTreeView();
        if (pmProvider && pTreeView) {
            // Message update should be handled by provider via callback
            // pTreeView.message = "Refreshing projects...";
            pmProvider.refresh(true); // true for hard refresh
        } else {
            logger.warn("RefreshProjectTreeView: projectManagementTreeDataProvider or projectTreeView is null.");
        }
        logger.trace("End of command: Refresh Project Tree View");
    });

    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshTestThemeTreeView, async () => {
        logger.debug("Command called: Refresh Test Theme Tree");

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
                ttProvider.refresh(); // This will just re-render current items.
            } else {
                logger.debug(
                    "No current cycle in Test Theme Tree to refresh, or provider not found. Clearing and refreshing."
                );
                ttProvider.clearTree(); // This calls refresh internally
            }
        } else {
            logger.warn(
                "Refresh Test Theme Tree: projectManagementTreeDataProvider or testThemeTreeDataProvider is null."
            );
            if (ttProvider) {
                ttProvider.refresh();
            } // Attempt to refresh what it has
        }

        logger.trace("End of command: Refresh Test Theme Tree");
    });

    // --- Command: Make Root ---
    // Right clicking on a tree element and selecting "Make Root" context menu option will make the selected element the root of the tree.
    registerSafeCommand(
        context,
        allExtensionCommands.makeRoot,
        (treeItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug("Command Called: Make Root for tree item:", treeItem?.label);
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
                    logger.warn("MakeRoot: projectManagementTreeDataProvider is null for project tree item.");
                    vscode.window.showErrorMessage("Project tree is not available to set root.");
                }
            } else if (
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
            logger.trace("End of Make Root command.");
        }
    );

    // --- Command: Clear Workspace Folder ---
    // Clears the workspace folder of its contents, excluding log files.
    registerSafeCommand(context, allExtensionCommands.clearInternalTestbenchFolder, async () => {
        logger.debug("Command Called: Clear Workspace Folder");
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
        logger.trace("End of Command: Clear Workspace Folder");
    });

    // --- Command: Refresh Test Elements Tree ---
    // Refreshes the test elements tree view with the latest test elements for the selected TOV.
    registerSafeCommand(context, allExtensionCommands.refreshTestElementsTree, async () => {
        logger.debug("Command Called: Refresh Test Elements Tree");
        const teProvider = getTestElementsTreeDataProvider();
        if (!teProvider) {
            return;
        }
        const currentTovKey: string = teProvider.getCurrentTovKey();
        if (!currentTovKey) {
            vscode.window.showErrorMessage("No TOV key stored. Please fetch test elements first.");
            return;
        }
        await teProvider.fetchAndDisplayTestElements(currentTovKey);
    });

    // --- Command: Display Interactions For Selected TOV ---
    registerSafeCommand(
        context,
        allExtensionCommands.displayInteractionsForSelectedTOV,
        async (treeItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(
                "Command Called: Display Interactions For Selected TOV command called for tree item:",
                treeItem
            );
            const pmProvider = getProjectManagementTreeDataProvider();
            const teProvider = getTestElementsTreeDataProvider();
            const teView = getTestElementTreeView();
            // Check if the command is executed for a TOV element.
            if (pmProvider && treeItem.contextValue === TreeItemContextValues.VERSION) {
                const tovKeyOfSelectedTreeElement = treeItem.item?.key?.toString();
                if (tovKeyOfSelectedTreeElement && teProvider) {
                    const areTestElementsFetched: boolean = await teProvider.fetchAndDisplayTestElements(
                        tovKeyOfSelectedTreeElement,
                        typeof treeItem.label === "string" ? treeItem.label : undefined
                    );
                    if (areTestElementsFetched) {
                        await projectManagementTreeView.hideProjectManagementTreeView();
                        // testElementTreeView.message is cleared by fetchAndDisplayTestElements on success
                    } else if (teView) {
                        // If fetch failed, fetchAndDisplayTestElements already sets an error message
                    }
                }
            }
            logger.trace("End of Command: Display Interactions For Selected TOV");
        }
    );

    // --- Command: Go To Resource File ---
    // Opens or creates the robot resource file associated with the selected test element.
    registerSafeCommand(
        context,
        allExtensionCommands.openOrCreateRobotResourceFile,
        async (treeItem: testElementsTreeView.TestElementTreeItem) => {
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
                vscode.window.showErrorMessage("Error in Open Robot Resource File command: " + error.message);
                logger.error("Error in Open Robot Resource File command:", error);
            }
        }
    );

    // --- Command: Create Interaction Under Subdivision ---
    // Creates a new interaction tree element under the selected subdivision.
    registerSafeCommand(
        context,
        allExtensionCommands.createInteractionUnderSubdivision,
        async (subdivisionTreeItem: testElementsTreeView.TestElementTreeItem) => {
            logger.debug("Command Called: Create Interaction Under Subdivision");

            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error("createInteractionUnderSubdivision command called without connection.");
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
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench-visual-studio-code-extension"
        });
    });

    // --- Command: Modify Report With Results Zip ---
    // Allows the user to select a report zip file and create a new report by removing JSON files that were not selected in the quick pick from the original report zip.
    registerSafeCommand(context, allExtensionCommands.modifyReportWithResultsZip, async () => {
        logger.debug("Command called: Quick pick with multiselect");

        // Prompt the user to select a report zip file with results.
        const zipUris = await vscode.window.showOpenDialog({
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

        logger.trace("End of command: Quick pick with multiselect");
    });

    // Set context value for connectionActive.
    // Used to enable or disable the login and logout buttons in the status bar,
    // which allows icon changes for login/logout buttons based on connectionActive variable.
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, connection !== null);
    logger.trace(`Context value connectionActive set to: ${connection !== null}`);
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

    // Load initial configuration and register a listener for configuration changes.
    await loadConfiguration(context);

    initializeTreeViews(context);

    // Register the login webview provider.
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider)
    );

    // Register all extension commands.
    await registerExtensionCommands(context);

    // Set the initial context state. Before any login attempt, connection is null.
    // VS Code will show/hide views based on this initial state matching the 'when' clauses in package.json
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, connection !== null);
    logger.trace(`Initial connectionActive context set to: ${connection !== null}`);

    await initializeLanguageServer();

    // Execute automatic login if the setting is enabled.
    await vscode.commands.executeCommand(allExtensionCommands.automaticLoginAfterExtensionActivation);
}

/**
 * Called when the extension is deactivated.
 */
export async function deactivate(): Promise<void> {
    try {
        // Gracefully log out the user when the extension is deactivated.
        await connection?.logoutUser();
        logger.info("Extension deactivated.");
    } catch (error) {
        logger.error("Error during deactivation:", error);
    }
}
