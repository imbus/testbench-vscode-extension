"use strict";
/**
 * @file extension.ts
 * @description Main entry point for the TestBench VS Code extension.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOW_PERSISTENT_IMPORT_BUTTON = exports.ENABLE_ICON_MARKING_ON_GENERATE = exports.testElementTreeView = exports.testThemeTreeView = exports.projectTreeView = exports.testElementsTreeDataProvider = exports.testThemeTreeDataProvider = exports.projectManagementTreeDataProvider = exports.connection = exports.logger = void 0;
exports.setLogger = setLogger;
exports.setConnection = setConnection;
exports.getLoginWebViewProvider = getLoginWebViewProvider;
exports.safeCommandHandler = safeCommandHandler;
exports.initializeTreeViews = initializeTreeViews;
exports.activate = activate;
exports.deactivate = deactivate;
// Before releasing the extension:
// TODO: Add License.md to the extension
// TODO: Set logger level to info or debug in production, remove too detailed logs.
// TODO: In production, remove process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; in connection class.
// Note: A virtual python environment is required for the extension to work + an empty pyproject.toml in workspace root.
const vscode = __importStar(require("vscode"));
const testBenchLogger = __importStar(require("./testBenchLogger"));
const testBenchConnection = __importStar(require("./testBenchConnection"));
const reportHandler = __importStar(require("./reportHandler"));
const projectManagementTreeView = __importStar(require("./views/projectManagementTreeView"));
const testElementsTreeView = __importStar(require("./views/testElementsView/testElementsTreeView"));
const loginWebView = __importStar(require("./loginWebView"));
const utils = __importStar(require("./utils"));
const path_1 = __importDefault(require("path"));
const constants_1 = require("./constants");
const server_1 = require("./server");
const testThemeTreeView_1 = require("./views/testThemeTreeView");
const testElementsTreeView_1 = require("./views/testElementsView/testElementsTreeView");
const testBenchAuthenticationProvider_1 = require("./testBenchAuthenticationProvider");
const profileManager = __importStar(require("./profileManager"));
const testBenchConnection_1 = require("./testBenchConnection");
const configuration_1 = require("./configuration");
const projectDataService_1 = require("./services/projectDataService");
const testElementDataService_1 = require("./services/testElementDataService");
const markedItemStateService_1 = require("./services/markedItemStateService");
const resourceFileService_1 = require("./services/resourceFileService");
const testElementTreeBuilder_1 = require("./views/testElementsView/testElementTreeBuilder");
function setLogger(newLogger) {
    exports.logger = newLogger;
}
/** Global connection to the (new) TestBench Play server. */
exports.connection = null;
function setConnection(newConnection) {
    exports.connection = newConnection;
}
/** Login webview provider instance. */
let loginWebViewProvider = null;
function getLoginWebViewProvider() {
    return loginWebViewProvider;
}
/** Global variables to hold the tree data providers and views. */
exports.projectManagementTreeDataProvider = null;
exports.testThemeTreeDataProvider = null;
// Global variable to store the authentication provider instance
let authProviderInstance = null;
// Prevent multiple session change handling simultaneously
let isHandlingSessionChange = false;
// Determines if the icon of the tree item should be changed after generating tests for that item.
exports.ENABLE_ICON_MARKING_ON_GENERATE = true;
// Determines if the import button of the tree item should still persist after importing test results for that item.
exports.ALLOW_PERSISTENT_IMPORT_BUTTON = true;
/**
 * Wraps a command handler with error handling to prevent the extension from crashing due to unhandled exceptions in commands.
 * It takes a handler function as input and returns a new function that executes the original handler inside a try/catch block.
 *
 * @param handler The async function to execute.
 * @returns A new async function that wraps the handler with try/catch.
 */
function safeCommandHandler(handler) {
    return async (...args) => {
        try {
            await handler(...args);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
            exports.logger.error(`Error executing command: ${errorMessage}`, error);
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
function registerSafeCommand(context, commandId, callback) {
    const disposable = vscode.commands.registerCommand(commandId, async (...args) => {
        try {
            await callback(...args);
        }
        catch (error) {
            // Errors expected in silent auto-login, dont show error message to user.
            if (commandId === constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation) {
                exports.logger.warn(`Command ${commandId} error (expected for silent auto-login if conditions not met): ${error.message}`);
            }
            else {
                exports.logger.error(`Command ${commandId} error: ${error.message}`, error);
                vscode.window.showErrorMessage(`Command ${commandId} failed: ${error.message}`);
            }
        }
    });
    context.subscriptions.push(disposable);
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
function initializeTestElementsTreeView(context) {
    const testElementDataService = new testElementDataService_1.TestElementDataService(() => exports.connection, exports.logger);
    const resourceFileService = new resourceFileService_1.ResourceFileService(exports.logger);
    const testElementTreeBuilder = new testElementTreeBuilder_1.TestElementTreeBuilder(exports.logger);
    exports.testElementsTreeDataProvider = new testElementsTreeView.TestElementsTreeDataProvider((message) => {
        if (exports.testElementTreeView) {
            exports.testElementTreeView.message = message;
        }
    }, testElementDataService, resourceFileService, context, testElementTreeBuilder);
    exports.testElementTreeView = vscode.window.createTreeView("testElementsView", {
        treeDataProvider: exports.testElementsTreeDataProvider
    });
    context.subscriptions.push(exports.testElementTreeView);
    if (exports.testElementsTreeDataProvider.isTreeDataEmpty()) {
        exports.testElementsTreeDataProvider.updateTreeViewStatusMessage();
    }
}
/**
 * Initializes the project tree and test elements tree.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function initializeTreeViews(context) {
    const projectDataService = new projectDataService_1.ProjectDataService(() => exports.connection, exports.logger);
    const markedItemStateService = new markedItemStateService_1.MarkedItemStateService(context, exports.logger);
    await markedItemStateService.initialize();
    exports.testThemeTreeDataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider((message) => {
        if (exports.testThemeTreeView) {
            exports.testThemeTreeView.message = message;
        }
    }, context, projectDataService, markedItemStateService);
    exports.testThemeTreeView = vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: exports.testThemeTreeDataProvider
    });
    context.subscriptions.push(exports.testThemeTreeView);
    exports.projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider((message) => {
        if (exports.projectTreeView) {
            exports.projectTreeView.message = message;
        }
    }, exports.testThemeTreeDataProvider, context, projectDataService);
    const newProjectTreeView = vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: exports.projectManagementTreeDataProvider,
        canSelectMany: false
    });
    exports.projectTreeView = newProjectTreeView;
    context.subscriptions.push(exports.projectTreeView);
    if (exports.projectManagementTreeDataProvider && exports.testThemeTreeView && exports.testThemeTreeDataProvider) {
        context.subscriptions.push(exports.projectManagementTreeDataProvider.onDidPrepareCycleDataForThemeTree(async (eventData) => {
            if (exports.testThemeTreeDataProvider && exports.testThemeTreeView) {
                exports.logger.debug(`[Prepare Cycle Event] Cycle data prepared for ${eventData.cycleLabel}. Updating Test Theme Tree.`);
                exports.testThemeTreeView.title = `Test Themes (${eventData.cycleLabel})`;
                exports.logger.trace(`Test Themes view title updated to: ${exports.testThemeTreeView.title}`);
                exports.testThemeTreeDataProvider.clearTree();
                exports.testThemeTreeDataProvider.populateFromCycleData(eventData);
            }
        }));
    }
    exports.projectManagementTreeDataProvider?.refresh(true);
    if (exports.testThemeTreeDataProvider && exports.testThemeTreeView) {
        exports.testThemeTreeDataProvider.clearTree();
    }
    initializeTestElementsTreeView(context);
    if (exports.projectTreeView && exports.projectManagementTreeDataProvider) {
        projectManagementTreeView.setupProjectTreeViewEventListeners(exports.projectTreeView, exports.projectManagementTreeDataProvider);
    }
}
/**
 * Registers all extension commands.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function registerExtensionCommands(context) {
    // --- Command: Show Extension Settings ---
    registerSafeCommand(context, constants_1.allExtensionCommands.showExtensionSettings, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.showExtensionSettings}`);
        // Open the settings with the extension filter.
        await vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-extension"
        });
        // Open the "workspace" tab in settings view (The default settings view is the user tab in settings)
        await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
    });
    // --- Command: Set Workspace ---
    registerSafeCommand(context, constants_1.allExtensionCommands.setWorkspace, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.setWorkspace}`);
        await utils.setWorkspaceLocation();
    });
    // --- Command: Automatic Login After Extension Start ---
    registerSafeCommand(context, constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation, async () => {
        exports.logger.debug(`[Cmd] Called: ${constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation}`);
        if ((0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.AUTO_LOGIN, false)) {
            exports.logger.info("[Cmd] Auto-login is enabled. Attempting silent login with last active profile...");
            const activeProfile = await profileManager.getActiveProfile(context);
            if (!activeProfile) {
                exports.logger.info("[Cmd] Auto-login: No last active profile found. Cannot auto-login.");
                return;
            }
            if (!authProviderInstance) {
                exports.logger.error("[Cmd] Auto-login: AuthenticationProvider instance is not available.");
                return;
            }
            try {
                await profileManager.setActiveProfileId(context, activeProfile.id);
                authProviderInstance.prepareForSilentAutoLogin();
                exports.logger.trace("[Cmd] Auto-login: Calling vscode.authentication.getSession silently.");
                const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], { createIfNone: true });
                if (session) {
                    exports.logger.info(`[Cmd] Auto-login successful for profile: ${activeProfile.label} (session restored/created silently).`);
                }
                else {
                    exports.logger.info("[Cmd] Auto-login: No session restored/created silently. User may need to login manually.");
                }
            }
            catch (error) {
                exports.logger.warn(`[Cmd] Auto-login attempt for profile "${activeProfile?.label || "unknown"}" failed silently (this is expected if credentials/profile are incomplete or server issues prevent silent login): ${error.message}`);
            }
        }
        else {
            exports.logger.trace("[Cmd] Auto-login is disabled in settings.");
        }
    });
    // --- Command: Login ---
    // Performs the login process and stores the connection object.
    registerSafeCommand(context, constants_1.allExtensionCommands.login, async () => {
        exports.logger.debug(`[Cmd] Called: ${constants_1.allExtensionCommands.login}`);
        try {
            // Triggers TestBenchAuthenticationProvider.createSession if no session exists
            const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], { createIfNone: true });
            if (session) {
                exports.logger.info(`[Cmd] Login successful, session ID: ${session.id}`);
                initializeTreeViews(context);
                exports.projectManagementTreeDataProvider?.refresh(true);
            }
        }
        catch (error) {
            exports.logger.error(`[Cmd] Login process failed or was cancelled:`, error);
            vscode.window.showErrorMessage(`TestBench Login Failed: ${error.message}`);
        }
    });
    // --- Command: Logout ---
    // Performs the logout process and clears the connection object.
    registerSafeCommand(context, constants_1.allExtensionCommands.logout, async () => {
        exports.logger.debug(`[Cmd] Called: ${constants_1.allExtensionCommands.logout}`);
        try {
            const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, [], { createIfNone: false, silent: true });
            if (session && session.id) {
                exports.logger.trace(`[Cmd] Found active TestBench session: ${session.id}. Attempting to remove via vscode.authentication.removeSession.`);
                if (authProviderInstance) {
                    await authProviderInstance.removeSession(session.id);
                    vscode.window.showInformationMessage("Logged out from TestBench.");
                }
                else {
                    exports.logger.error("[Cmd] AuthProvider instance not available for logout.");
                    vscode.window.showErrorMessage("Logout failed: Auth provider not initialized.");
                    await handleTestBenchSessionChange(context);
                }
            }
            else {
                exports.logger.info("[Cmd] No active TestBench session found to logout. Ensuring UI is in a logged-out state.");
                await handleTestBenchSessionChange(context);
            }
        }
        catch (error) {
            exports.logger.error(`[Cmd] Error during logout:`, error);
            vscode.window.showErrorMessage(`TestBench Logout Error: ${error.message}`);
            await handleTestBenchSessionChange(context);
        }
        await server_1.client?.stop();
    });
    // --- Command: Handle Cycle Click ---
    // Handles the click event on a cycle element in the project management tree view.
    registerSafeCommand(context, constants_1.allExtensionCommands.handleProjectCycleClick, async (cycleItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.handleProjectCycleClick}`);
        if (exports.projectManagementTreeDataProvider) {
            // Avoid displaying old data in the tree views by clearing if fetching fails.
            exports.testThemeTreeDataProvider?.clearTree();
            (0, testElementsTreeView_1.clearTestElementsTreeView)();
            await exports.projectManagementTreeDataProvider.handleTestCycleClick(cycleItem);
        }
        else {
            exports.logger.error("Cycle click cannot be processed: Project management tree data provider is not initialized.");
            vscode.window.showErrorMessage("Project management tree is not initialized.");
        }
    });
    // --- Command: Generate Test Cases For Cycle ---
    // Generates test cases for the selected cycle in the project management tree view.
    registerSafeCommand(context, constants_1.allExtensionCommands.generateTestCasesForCycle, async (item) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.generateTestCasesForCycle}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.generateTestCasesForCycle} command called without connection.`);
            return;
        }
        if ((0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR)) {
            await vscode.commands.executeCommand(constants_1.allExtensionCommands.clearInternalTestbenchFolder);
        }
        await reportHandler.startTestGenerationForCycle(context, item);
    });
    // --- Command: Generate Test Cases For Test Theme or Test Case Set ---
    registerSafeCommand(context, constants_1.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet, async (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet} command called without connection.`);
            return;
        }
        if ((0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR)) {
            await vscode.commands.executeCommand(constants_1.allExtensionCommands.clearInternalTestbenchFolder);
        }
        let cycleKey = null;
        if (exports.testThemeTreeDataProvider) {
            cycleKey = exports.testThemeTreeDataProvider.getCurrentCycleKey();
            if (cycleKey) {
                exports.logger.trace(`Using cycle key '${cycleKey}' from TestThemeTreeDataProvider for test generation.`);
            }
            else {
                exports.logger.warn("TestThemeTreeDataProvider available but cycle key not set. Falling back to parent traversal.");
                cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
            }
        }
        else {
            exports.logger.warn("TestThemeTreeDataProvider not available. Falling back to parent traversal for cycle key.");
            cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
        }
        if (!cycleKey) {
            vscode.window.showErrorMessage(`Error: Cycle key not found for the selected item '${treeItem.label}'. Cannot generate tests.`);
            exports.logger.error(`Cycle key not found for tree element: ${treeItem.label} (UID: ${treeItem.item?.uniqueID || treeItem.item?.key})`);
            return;
        }
        await reportHandler.generateRobotFrameworkTestsForTestThemeOrTestCaseSet(context, treeItem, cycleKey);
    });
    // --- Command: Display All Projects ---
    // Opens the project management tree view, hides other views, and displays all projects with their contents.
    registerSafeCommand(context, constants_1.allExtensionCommands.displayAllProjects, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.displayAllProjects}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.displayAllProjects} command called without connection.`);
            return;
        }
        await projectManagementTreeView?.displayProjectManagementTreeView();
        await (0, testThemeTreeView_1.hideTestThemeTreeView)();
        await testElementsTreeView?.hideTestElementsTreeView();
    });
    // --- Command: Read Robotframework Test Results And Create Report With Results ---
    // Activated for a test theme or test case set element.
    // Reads the test results (output.xml) from the testbench working directory and creates a report zip file with the results.
    registerSafeCommand(context, constants_1.allExtensionCommands.readRFTestResultsAndCreateReportWithResults, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.readRFTestResultsAndCreateReportWithResults}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.readRFTestResultsAndCreateReportWithResults} command called without connection.`);
            return;
        }
        await reportHandler.fetchTestResultsAndCreateReportWithResultsWithTb2Robot(context);
    });
    // --- Command: Import Test Results To Testbench ---
    // Imports the selected test results zip to the testbench server
    registerSafeCommand(context, constants_1.allExtensionCommands.importTestResultsToTestbench, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.importTestResultsToTestbench}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.importTestResultsToTestbench} command called without connection.`);
            return;
        }
        await testBenchConnection.selectReportWithResultsAndImportToTestbench(exports.connection);
    });
    // --- Command: Read And Import Test Results To Testbench ---
    // A command that combines the reading of robotframework test results, creating a report file with results, and importing test results to testbench server.
    registerSafeCommand(context, constants_1.allExtensionCommands.readAndImportTestResultsToTestbench, async (item) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.readAndImportTestResultsToTestbench}`);
        if (!exports.connection) {
            const noConnectionErrorMessage = "No connection available. Cannot import report.";
            vscode.window.showErrorMessage(noConnectionErrorMessage);
            exports.logger.error(noConnectionErrorMessage);
            return null;
        }
        if (!item) {
            exports.logger.warn(`${constants_1.allExtensionCommands.readAndImportTestResultsToTestbench} called without a tree item. This command should be invoked from a marked Test Theme/Set item.`);
            vscode.window.showWarningMessage("Please invoke this command from a Test Theme or Test Case Set that has generated tests.");
            return null;
        }
        await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(context, item);
    });
    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshProjectTreeView, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.refreshProjectTreeView}`);
        if (exports.projectManagementTreeDataProvider && exports.projectTreeView) {
            exports.projectManagementTreeDataProvider.refresh(false);
        }
        else {
            exports.logger.warn(`Project Management Tree Data Provider or Project Tree View not initialized. Cannot refresh.`);
        }
    });
    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshTestThemeTreeView, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.refreshTestThemeTreeView}`);
        if (!exports.testThemeTreeDataProvider) {
            exports.logger.warn("Test Theme Tree Data Provider not initialized. Cannot refresh.");
            vscode.window.showErrorMessage("Test Theme Tree is not available to refresh.");
            return;
        }
        if (!exports.testThemeTreeDataProvider.getCurrentCycleKey() || !exports.testThemeTreeDataProvider.getCurrentProjectKey()) {
            exports.logger.info("Test Theme Tree: No current cycle selected to refresh. Clearing tree.");
            exports.testThemeTreeDataProvider.clearTree();
            if (exports.testThemeTreeView) {
                exports.testThemeTreeView.title = "Test Themes";
            }
            return;
        }
        try {
            await exports.testThemeTreeDataProvider.refresh(false);
            exports.logger.info("Test Theme Tree view refresh initiated and completed via provider.");
        }
        catch (error) {
            exports.logger.error("Error during Test Theme Tree view refresh command execution:", error);
            vscode.window.showErrorMessage("Failed to refresh Test Themes. Check logs for details.");
            exports.testThemeTreeDataProvider.setTreeViewStatusMessage("Error refreshing test themes.");
        }
    });
    // --- Command: Make Root ---
    // Right clicking on a tree element and selecting "Make Root" context menu option will make the selected element the root of the tree.
    // Refreshing the tree will revert the tree to its original state.
    registerSafeCommand(context, constants_1.allExtensionCommands.makeRoot, (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.makeRoot} for tree item:`, treeItem);
        if (!treeItem) {
            exports.logger.warn("MakeRoot command called with null treeItem.");
            return;
        }
        // Check if the item belongs to the Project Management Tree
        if (treeItem.contextValue &&
            [constants_1.TreeItemContextValues.PROJECT, constants_1.TreeItemContextValues.VERSION, constants_1.TreeItemContextValues.CYCLE].includes(treeItem.contextValue)) {
            if (exports.projectManagementTreeDataProvider) {
                exports.projectManagementTreeDataProvider.makeRoot(treeItem);
            }
            else {
                const makeRootNoProviderErrorMessage = "MakeRoot command called without projectManagementTreeDataProvider.";
                exports.logger.warn(makeRootNoProviderErrorMessage);
                vscode.window.showErrorMessage(makeRootNoProviderErrorMessage);
            }
        }
        // Check if the item belongs to the Test Theme Tree
        else if (exports.testThemeTreeDataProvider &&
            treeItem.contextValue &&
            [constants_1.TreeItemContextValues.TEST_THEME_NODE, constants_1.TreeItemContextValues.TEST_CASE_SET_NODE].includes(treeItem.contextValue)) {
            // Delegate to testThemeTreeDataProvider if it's a test theme item
            if (typeof exports.testThemeTreeDataProvider.makeRoot === "function") {
                exports.testThemeTreeDataProvider.makeRoot(treeItem);
            }
            else {
                exports.logger.warn(`MakeRoot: testThemeTreeDataProvider does not have a makeRoot method or item type (${treeItem.contextValue}) is not supported for makeRoot in test theme tree.`);
                vscode.window.showInformationMessage(`Cannot make '${treeItem.label}' root in the Test Themes view with current implementation.`);
            }
        }
        else {
            exports.logger.warn(`MakeRoot: Item type "${treeItem.contextValue}" not supported for makeRoot or target provider not identified.`);
            vscode.window.showInformationMessage(`Item '${treeItem.label}' cannot be made a root in the current view.`);
        }
    });
    // --- Command: Reset Project Tree View Root ---
    registerSafeCommand(context, constants_1.allExtensionCommands.resetProjectTreeViewRoot, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.resetProjectTreeViewRoot}`);
        if (exports.projectManagementTreeDataProvider) {
            exports.projectManagementTreeDataProvider.resetCustomRoot();
        }
        else {
            exports.logger.warn("ProjectManagementTreeDataProvider not available to reset custom root.");
            vscode.window.showWarningMessage("Project tree is not ready to reset root.");
        }
    });
    // --- Command: Reset Test Theme Tree View Root ---
    registerSafeCommand(context, constants_1.allExtensionCommands.resetTestThemeTreeViewRoot, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.resetTestThemeTreeViewRoot}`);
        if (exports.testThemeTreeDataProvider) {
            await exports.testThemeTreeDataProvider.resetCustomRoot();
        }
        else {
            exports.logger.warn("TestThemeTreeDataProvider not available to reset custom root.");
            vscode.window.showWarningMessage("Test theme tree is not ready to reset root.");
        }
    });
    // --- Command: Clear Workspace Folder ---
    // Clears the workspace folder of its contents, excluding extension log files.
    registerSafeCommand(context, constants_1.allExtensionCommands.clearInternalTestbenchFolder, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.clearInternalTestbenchFolder}`);
        const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return;
        }
        const testbenchWorkingDirectoryPath = path_1.default.join(workspaceLocation, constants_1.folderNameOfInternalTestbenchFolder);
        await utils.clearInternalTestbenchFolder(testbenchWorkingDirectoryPath, [testBenchLogger.folderNameOfLogs], // Exclude log files from deletion
        !(0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR) // Ask for confirmation if not set to clear before test generation
        );
    });
    // --- Command: Refresh Test Elements Tree ---
    // Refreshes the test elements tree view with the latest test elements for the selected TOV.
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshTestElementsTree, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.refreshTestElementsTree}`);
        if (!exports.testElementsTreeDataProvider) {
            exports.logger.warn("Test Elements Tree Data Provider not initialized. Cannot refresh Test Elements Tree.");
            return;
        }
        const currentTovKey = exports.testElementsTreeDataProvider.getCurrentTovKey();
        if (!currentTovKey) {
            vscode.window.showErrorMessage("No TOV key stored. Please fetch test elements first.");
            return;
        }
        await exports.testElementsTreeDataProvider.fetchTestElements(currentTovKey);
    });
    // --- Command: Display Interactions For Selected TOV ---
    registerSafeCommand(context, constants_1.allExtensionCommands.displayInteractionsForSelectedTOV, async (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.displayInteractionsForSelectedTOV} for tree item:`, treeItem);
        if (exports.projectManagementTreeDataProvider && treeItem.contextValue === constants_1.TreeItemContextValues.VERSION) {
            const tovKeyOfSelectedTreeElement = treeItem.item?.key?.toString();
            if (tovKeyOfSelectedTreeElement && exports.testElementsTreeDataProvider) {
                const areTestElementsFetched = await exports.testElementsTreeDataProvider.fetchTestElements(tovKeyOfSelectedTreeElement, typeof treeItem.label === "string" ? treeItem.label : undefined);
                if (areTestElementsFetched) {
                    await projectManagementTreeView?.hideProjectManagementTreeView();
                    await (0, testElementsTreeView_1.displayTestElementsTreeView)();
                    // Clicking on the "Show Robotframework Resources" button will not trigger project management tree onDidChangeSelection event,
                    // which restarts the language client.
                    // Retrieve the project name and TOV name from the tree item for language client restart.
                    const projectAndTovNameObj = exports.projectManagementTreeDataProvider.getProjectAndTovNamesForItem(treeItem);
                    if (projectAndTovNameObj) {
                        const { projectName, tovName } = projectAndTovNameObj;
                        if (projectName && tovName) {
                            await (0, server_1.restartLanguageClient)(projectName, tovName);
                        }
                    }
                }
                else {
                    exports.logger.warn(`Test Elements Tree Data Provider not initialized or failed to fetch test elements for TOV: ${tovKeyOfSelectedTreeElement}`);
                    vscode.window.showErrorMessage(`Failed to fetch test elements for TOV: ${tovKeyOfSelectedTreeElement}`);
                }
            }
        }
    });
    // --- Command: Go To Resource File ---
    // Opens or creates the robot resource file associated with the selected test element.
    registerSafeCommand(
    //
    context, constants_1.allExtensionCommands.openOrCreateRobotResourceFile, async (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.openOrCreateRobotResourceFile} for tree item:`, treeItem);
        if (exports.testElementsTreeDataProvider) {
            await exports.testElementsTreeDataProvider.handleGoToResourceCommand(treeItem);
        }
        else {
            exports.logger.error("TestElementsTreeDataProvider not initialized. Cannot handle Go To Resource File command.");
            vscode.window.showErrorMessage("Test Elements view is not ready. Please try again.");
        }
    });
    // --- Command: Create Interaction Under Subdivision ---
    // Creates a new interaction tree element under the selected subdivision.
    registerSafeCommand(context, constants_1.allExtensionCommands.createInteractionUnderSubdivision, async (subdivisionTreeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.createInteractionUnderSubdivision} for tree item:`, subdivisionTreeItem);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.createInteractionUnderSubdivision} command called without connection.`);
            return;
        }
        if (!exports.testElementsTreeDataProvider) {
            return;
        }
        const interactionName = await vscode.window.showInputBox({
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
        const newInteraction = await exports.testElementsTreeDataProvider.createInteractionUnderSubdivision(subdivisionTreeItem, interactionName);
        if (newInteraction) {
            // TODO: After the API is implemented, use the API to create the interaction on the server
            // For now, refresh the tree view to show the new interaction
            exports.testElementsTreeDataProvider._onDidChangeTreeDataEmitter.fire(undefined);
            vscode.window.showInformationMessage(`Successfully created interaction '${interactionName}'`);
            exports.logger.debug(`Created new interaction '${interactionName}' under subdivision '${subdivisionTreeItem.testElementData.name}'`);
        }
    });
    // --- Command: Open Issue Reporter ---
    // Opens the official VS Code issue reporter, where the extension is preselected.
    registerSafeCommand(context, constants_1.allExtensionCommands.openIssueReporter, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.openIssueReporter}`);
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench-extension"
        });
    });
    // --- Command: Modify Report With Results Zip ---
    // TODO: This feature needs to be discussed with the team.
    // Allows the user to select a report zip file and create a new report by removing JSON files that were not selected in the quick pick from the original report zip.
    registerSafeCommand(context, constants_1.allExtensionCommands.modifyReportWithResultsZip, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.modifyReportWithResultsZip}`);
        const zipUris = await vscode.window.showOpenDialog({
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
        const zipPath = zipUris[0].fsPath;
        const quickPickItems = await reportHandler.getQuickPickItemsFromReportZipWithResults(zipPath);
        const chosenQuickPickItems = await reportHandler.showMultiSelectQuickPick(quickPickItems);
        exports.logger.log("Trace", "User selected following json files:", chosenQuickPickItems);
        await reportHandler.createNewReportWithSelectedItems(zipPath, chosenQuickPickItems);
    });
    // TODO: Remove / reimplement after testing
    // --- Command: Get Filters ---
    registerSafeCommand(context, constants_1.allExtensionCommands.getFilters, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.getFilters}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.getFilters} command called without connection.`);
            return;
        }
        try {
            const filters = await exports.connection.getFiltersFromOldPlayServer();
            if (!filters || !Array.isArray(filters) || filters.length === 0) {
                vscode.window.showInformationMessage("No filters found.");
                exports.logger.trace("No filters retrieved from server or empty filters array.");
                return;
            }
            exports.logger.trace("Filters retrieved successfully:", JSON.stringify(filters, null, 2));
            // Create QuickPick items from the filters
            const quickPickItems = filters.map((filter) => ({
                label: filter.name || "Unnamed Filter",
                description: `Type: ${filter.type || "Unknown"} | ${filter.public ? "Public" : "Private"}`,
                detail: `Key: ${filter.key?.serial || "No Key"}`,
                // Store the entire filter object in the detail for later access
                filterData: filter
            }));
            // Show QuickPick to user
            const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: "Select a filter to view its content",
                title: "Available Filters"
            });
            if (selectedItem && selectedItem.filterData) {
                const selectedFilter = selectedItem.filterData;
                const content = selectedFilter.content || "No content available";
                // Display the filter content in a message box
                const action = await vscode.window.showInformationMessage(`Filter: ${selectedFilter.name}\n\nContent:\n${content}`, { modal: true }, "Copy to Clipboard");
                // Optional: Copy content to clipboard if user clicks the button
                if (action === "Copy to Clipboard") {
                    await vscode.env.clipboard.writeText(content);
                    vscode.window.showInformationMessage("Filter content copied to clipboard.");
                }
                exports.logger.info(`User selected filter: ${selectedFilter.name} with content: ${content}`);
            }
            else {
                exports.logger.info("User cancelled filter selection or no filter was selected.");
            }
        }
        catch (error) {
            exports.logger.error("Error retrieving filters:", error);
            vscode.window.showErrorMessage(`Failed to retrieve filters: ${error.message}`);
        }
    });
    // TODO: Remove / reimplement after testing
    // --- Command: Get TOV Structure ---
    registerSafeCommand(context, constants_1.allExtensionCommands.fetchTovStructure, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.fetchTovStructure}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.fetchTovStructure} command called without connection.`);
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
                exports.logger.info("User cancelled project key input.");
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
                exports.logger.info("User cancelled TOV key input.");
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
            let selectedFilters = [];
            try {
                const filters = await exports.connection.getFiltersFromOldPlayServer();
                if (filters && Array.isArray(filters) && filters.length > 0) {
                    // Ask user if they want to apply filters
                    const applyFilters = await vscode.window.showQuickPick(["No filters", "Select filters"], {
                        placeHolder: "Do you want to apply filters to the TOV structure?",
                        title: "Filter Selection"
                    });
                    if (applyFilters === "Select filters") {
                        // Create QuickPick items from the filters with multi-select capability
                        const quickPickItems = filters.map((filter) => ({
                            label: filter.name || "Unnamed Filter",
                            description: `Type: ${filter.type || "Unknown"} | ${filter.public ? "Public" : "Private"}`,
                            detail: `Key: ${filter.key?.serial || "No Key"}`,
                            filterData: filter
                        }));
                        // Create a multi-select QuickPick
                        const quickPick = vscode.window.createQuickPick();
                        quickPick.items = quickPickItems;
                        quickPick.canSelectMany = true;
                        quickPick.placeholder = "Select filters to apply (you can select multiple)";
                        quickPick.title = "Select Filters for TOV Structure";
                        quickPick.show();
                        const selectedItems = await new Promise((resolve) => {
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
                            .map((item) => {
                            const filterData = item.filterData;
                            return {
                                name: filterData.name,
                                filterType: filterData.type,
                                testThemeUID: filterData.type === "TestTheme" ? filterData.key?.serial : undefined
                            };
                        })
                            .filter((filter) => filter.filterType); // Remove any invalid filters
                        exports.logger.info(`User selected ${selectedFilters.length} filters:`, selectedFilters);
                    }
                }
                else {
                    exports.logger.info("No filters available from server for TOV structure.");
                }
            }
            catch (filterError) {
                exports.logger.warn("Could not retrieve filters for TOV structure, proceeding without filters:", filterError);
                vscode.window.showWarningMessage("Could not retrieve filters. Proceeding without filters.");
            }
            // Build TOV Structure Options with user inputs
            const tovStructureOptions = {
                treeRootUID: treeRootUID?.trim() || "iTB-TT-299", // Use default if empty
                suppressFilteredData: false,
                suppressEmptyTestThemes: true,
                filters: selectedFilters
            };
            exports.logger.info(`Fetching TOV structure with options:`, {
                projectKey: projectKey.trim(),
                tovKey: tovKey.trim(),
                options: tovStructureOptions
            });
            // Show progress while fetching
            const tovStructure = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Fetching TOV Structure",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "Retrieving TOV structure from server..." });
                return await exports.connection?.fetchTovStructure(projectKey.trim(), tovKey.trim(), tovStructureOptions);
            });
            if (tovStructure) {
                exports.logger.info("TOV structure retrieved successfully:", JSON.stringify(tovStructure, null, 2));
                // Show result in information message with option to save
                const action = await vscode.window.showInformationMessage(`TOV Structure retrieved successfully for Project ${projectKey}, TOV ${tovKey}.\n\nFilters applied: ${selectedFilters.length}\nTree Root UID: ${tovStructureOptions.treeRootUID}`, { modal: true }, "View Details", "Save to File");
                if (action === "View Details") {
                    // Show detailed structure in a new document
                    const doc = await vscode.workspace.openTextDocument({
                        content: JSON.stringify(tovStructure, null, 2),
                        language: "json"
                    });
                    await vscode.window.showTextDocument(doc);
                }
                else if (action === "Save to File") {
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
            }
            else {
                // Undefined is expected if no TOV structure is found or filtering results in no data
                exports.logger.warn("TOV structure retrieval returned null or undefined.");
            }
        }
        catch (error) {
            exports.logger.error("Error fetching TOV structure:", error);
            vscode.window.showErrorMessage(`Failed to retrieve TOV structure: ${error.message}`);
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
async function handleTestBenchSessionChange(context, existingSession) {
    exports.logger.info(`[handleTestBenchSessionChange] Session changed. Processing... Has session: ${!!existingSession}`);
    let sessionToProcess = existingSession;
    if (!sessionToProcess) {
        try {
            sessionToProcess = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                createIfNone: false,
                silent: true
            });
        }
        catch (error) {
            exports.logger.warn("[Extension] Error getting current session during handleTestBenchSessionChange:", error);
            sessionToProcess = undefined;
        }
    }
    const wasPreviouslyConnected = !!exports.connection;
    if (sessionToProcess && sessionToProcess.accessToken) {
        const activeProfile = await profileManager.getActiveProfile(context);
        if (activeProfile) {
            // Check if a connection for this session and profile already exists
            if (exports.connection &&
                exports.connection.getSessionToken() === sessionToProcess.accessToken &&
                exports.connection.getUsername() === activeProfile.username &&
                exports.connection.getServerName() === activeProfile.serverName &&
                exports.connection.getServerPort() === activeProfile.portNumber.toString()) {
                exports.logger.info(`[Extension] Connection for profile '${activeProfile.label}' and current session token is already active. Skipping re-initialization.`);
                if (!wasPreviouslyConnected) {
                    exports.logger.info("[Extension] Re-asserting UI state for existing matching connection.");
                    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, true);
                    getLoginWebViewProvider()?.updateWebviewHTMLContent();
                    await vscode.commands.executeCommand(constants_1.allExtensionCommands.displayAllProjects);
                    exports.projectManagementTreeDataProvider?.refresh(true);
                    exports.testThemeTreeDataProvider?.clearTree();
                    (0, testElementsTreeView_1.clearTestElementsTreeView)();
                }
                return;
            }
            exports.logger.info(`[Extension] TestBench session active for profile: ${activeProfile.label}. Initializing PlayServerConnection.`);
            if (exports.connection) {
                exports.logger.warn("[Extension] A different connection was active. Logging out from previous server session before establishing new one.");
                await exports.connection.logoutUserOnServer();
            }
            const newConnection = new testBenchConnection_1.PlayServerConnection(activeProfile.serverName, activeProfile.portNumber, activeProfile.username, sessionToProcess.accessToken);
            setConnection(newConnection);
            await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, true);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
            if (!wasPreviouslyConnected ||
                (exports.connection && exports.connection.getSessionToken() !== newConnection.getSessionToken())) {
                // This is a new login session (e.g., startup auto-login, or manual login from disconnected state)
                exports.logger.info("[Extension] New session established. Setting default view to 'Projects' and refreshing data.");
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.displayAllProjects);
                exports.projectManagementTreeDataProvider?.refresh(true);
                exports.testThemeTreeDataProvider?.clearTree();
                (0, testElementsTreeView_1.clearTestElementsTreeView)();
            }
            else {
                // Session changed while already connected (e.g., profile switch if supported, or token refresh)
                exports.logger.info("[Extension] Session changed while already connected. Resetting view to 'Projects' and refreshing data.");
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.displayAllProjects);
                exports.projectManagementTreeDataProvider?.refresh(true);
                exports.testThemeTreeDataProvider?.clearTree();
                (0, testElementsTreeView_1.clearTestElementsTreeView)();
            }
        }
        else {
            exports.logger.warn("[Extension] Session exists, but no active profile. Clearing connection.");
            if (exports.connection) {
                await exports.connection.logoutUserOnServer();
            }
            setConnection(null);
            await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, false);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
            await projectManagementTreeView?.hideProjectManagementTreeView();
            await (0, testThemeTreeView_1.hideTestThemeTreeView)();
            await testElementsTreeView?.hideTestElementsTreeView();
            exports.projectManagementTreeDataProvider?.clearTree();
            exports.testThemeTreeDataProvider?.clearTree();
            (0, testElementsTreeView_1.clearTestElementsTreeView)();
        }
    }
    else {
        exports.logger.info("[Extension] No active session. Clearing connection.");
        if (exports.connection) {
            await exports.connection.logoutUserOnServer();
        }
        setConnection(null);
        await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, false);
        getLoginWebViewProvider()?.updateWebviewHTMLContent();
        await projectManagementTreeView?.hideProjectManagementTreeView();
        await (0, testThemeTreeView_1.hideTestThemeTreeView)();
        await testElementsTreeView?.hideTestElementsTreeView();
        exports.projectManagementTreeDataProvider?.clearTree();
        exports.testThemeTreeDataProvider?.clearTree();
        (0, testElementsTreeView_1.clearTestElementsTreeView)();
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
async function activate(context) {
    exports.logger = new testBenchLogger.TestBenchLogger();
    exports.logger.info("Extension activated.");
    (0, configuration_1.initializeConfigurationWatcher)();
    // Register AuthenticationProvider
    authProviderInstance = new testBenchAuthenticationProvider_1.TestBenchAuthenticationProvider(context);
    context.subscriptions.push(vscode.authentication.registerAuthenticationProvider(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_LABEL, authProviderInstance, { supportsMultipleAccounts: false } // No support for multiple simultaneous TestBench logins
    ));
    exports.logger.info("TestBenchAuthenticationProvider registered.");
    // Session Change Listener
    context.subscriptions.push(vscode.authentication.onDidChangeSessions(async (e) => {
        if (e.provider.id === testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID) {
            if (isHandlingSessionChange) {
                exports.logger.trace("[Extension] onDidChangeSessions: Already handling a session change, skipping this invocation.");
                return;
            }
            isHandlingSessionChange = true;
            exports.logger.info("[Extension] TestBench authentication sessions changed.");
            try {
                const currentSession = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], { createIfNone: false, silent: true });
                exports.logger.info(`[Extension] Fetched current session in onDidChangeSessions: ${currentSession ? currentSession.id : "undefined"}`);
                await handleTestBenchSessionChange(context, currentSession);
            }
            catch (error) {
                exports.logger.error("[Extension] Error getting session in onDidChangeSessions listener:", error);
                await handleTestBenchSessionChange(context, undefined);
            }
            finally {
                isHandlingSessionChange = false;
            }
        }
    }));
    await initializeTreeViews(context);
    // Set the initial connection context state. Before any login attempt, connection is null.
    // VS Code will show/hide views based on this initial state matching the 'when' clauses in package.json
    // CONNECTION_ACTIVE is also used to enable or disable the login and logout buttons in the status bar,
    // which allows icon changes for login/logout buttons based on connectionActive variable.
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, exports.connection !== null);
    exports.logger.trace(`Initial connectionActive context set to: ${exports.connection !== null}`);
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false);
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    await registerExtensionCommands(context);
    // Attempt to restore session on activation
    // Try to get an existing session without creating one.
    exports.logger.trace("[Extension] Attempting to silently restore existing TestBench session on activation...");
    try {
        const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: false,
            silent: true
        });
        if (session) {
            exports.logger.info("[Extension] Found existing VS Code AuthenticationSession for TestBench during initial check.");
            await handleTestBenchSessionChange(context, session);
        }
        else {
            exports.logger.info("[Extension] No existing TestBench session found during initial check.");
            // If auto-login is enabled, it will be triggered next.
            // If not, user needs to login manually.
            if (!(0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.AUTO_LOGIN, false)) {
                await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, false);
                getLoginWebViewProvider()?.updateWebviewHTMLContent();
            }
        }
    }
    catch (error) {
        exports.logger.warn("[Extension] Error trying to get initial session silently:", error);
        await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, false);
    }
    // Trigger Automatic Login Command if configured
    if ((0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.AUTO_LOGIN, false)) {
        exports.logger.info("[Extension] Auto-login configured. Triggering automatic login command.");
        // Note: Dont use await here, which would block the login webview display during autologin.
        vscode.commands.executeCommand(constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation);
    }
    else {
        exports.logger.info("[Extension] Auto-login is disabled. Skipping automatic login command.");
    }
    exports.logger.info("Extension activated successfully.");
}
/**
 * Called when the extension is deactivated.
 */
async function deactivate() {
    try {
        if (exports.connection) {
            exports.logger.info("[Extension] Performing server logout on deactivation.");
            await exports.connection.logoutUserOnServer();
            setConnection(null);
        }
        if (server_1.client) {
            exports.logger.info("[Extension] Attempting to stop language server on deactivation.");
            await (0, server_1.stopLanguageClient)(true);
            exports.logger.info("[Extension] Language server stopped on deactivation.");
        }
        exports.logger.info("Extension deactivated.");
    }
    catch (error) {
        exports.logger.error("Error during deactivation:", error);
    }
}
//# sourceMappingURL=extension.js.map