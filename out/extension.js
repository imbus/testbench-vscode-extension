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
exports.ALLOW_PERSISTENT_IMPORT_BUTTON = exports.ENABLE_ICON_MARKING_ON_TEST_GENERATION = exports.connection = exports.logger = void 0;
exports.setLogger = setLogger;
exports.setConnection = setConnection;
exports.getConnection = getConnection;
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
const loginWebView = __importStar(require("./loginWebView"));
const utils = __importStar(require("./utils"));
const path_1 = __importDefault(require("path"));
const constants_1 = require("./constants");
const server_1 = require("./server");
const testBenchAuthenticationProvider_1 = require("./testBenchAuthenticationProvider");
const connectionManager = __importStar(require("./connectionManager"));
const testBenchConnection_1 = require("./testBenchConnection");
const configuration_1 = require("./configuration");
const treeServiceManager_1 = require("./services/treeServiceManager");
function setLogger(newLogger) {
    exports.logger = newLogger;
}
/** Global connection to the (new) TestBench Play server. */
exports.connection = null;
function setConnection(newConnection) {
    exports.connection = newConnection;
}
function getConnection() {
    return exports.connection;
}
/** Login webview provider instance. */
let loginWebViewProvider = null;
function getLoginWebViewProvider() {
    return loginWebViewProvider;
}
// Centralized tree service manager
let treeServiceManager;
// Global variable to store the authentication provider instance
let authProviderInstance = null;
// Prevent multiple session change handling simultaneously
let isHandlingSessionChange = false;
// Determines if the icon of the tree item should be changed after generating tests for that item.
exports.ENABLE_ICON_MARKING_ON_TEST_GENERATION = true;
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
 * Utility functions for tree view visibility management
 */
async function hideProjectManagementTreeView() {
    await vscode.commands.executeCommand("projectManagementTree.removeView");
}
async function displayProjectManagementTreeView() {
    await vscode.commands.executeCommand("projectManagementTree.focus");
}
async function hideTestThemeTreeView() {
    await vscode.commands.executeCommand("testThemeTree.removeView");
}
async function displayTestThemeTreeView() {
    await vscode.commands.executeCommand("testThemeTree.focus");
}
async function hideTestElementsTreeView() {
    await vscode.commands.executeCommand("testElementsView.removeView");
}
async function displayTestElementsTreeView() {
    await vscode.commands.executeCommand("testElementsView.focus");
}
/**
 * Initializes all tree views using the TreeServiceManager.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function initializeTreeViews() {
    if (!treeServiceManager) {
        exports.logger.error("[Extension] TreeServiceManager is not initialized. Cannot initialize tree views.");
        vscode.window.showErrorMessage("Failed to initialize TestBench views: Core services missing.");
        return;
    }
    if (!treeServiceManager.getInitializationStatus()) {
        exports.logger.warn("[Extension] TreeServiceManager is not fully initialized. Proceeding, but some services might not be ready.");
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
        }
        catch (error) {
            exports.logger.warn("[Extension] Error during initial tree state setup:", error);
        }
        exports.logger.info("[Extension] All tree views initialized successfully through TreeServiceManager.");
    }
    catch (error) {
        exports.logger.error("[Extension] Failed to initialize tree views:", error);
        vscode.window.showErrorMessage(`Failed to initialize TestBench tree views: ${error instanceof Error ? error.message : "Unknown error"}`);
        throw error;
    }
}
/**
 * Registers all extension commands with centralized provider access.
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
            exports.logger.info("[Cmd] Auto-login is enabled. Attempting silent login with last active connection...");
            const activeConnection = await connectionManager.getActiveConnection(context);
            if (!activeConnection) {
                exports.logger.info("[Cmd] Auto-login: No last active connection found. Cannot auto-login.");
                return;
            }
            if (!authProviderInstance) {
                exports.logger.error("[Cmd] Auto-login: AuthenticationProvider instance is not available.");
                return;
            }
            try {
                await connectionManager.setActiveConnectionId(context, activeConnection.id);
                authProviderInstance.prepareForSilentAutoLogin();
                exports.logger.trace("[Cmd] Auto-login: Calling vscode.authentication.getSession silently.");
                const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], { createIfNone: true });
                if (session) {
                    exports.logger.info(`[Cmd] Auto-login successful for connection: ${activeConnection.label} (session restored/created silently).`);
                }
                else {
                    exports.logger.info("[Cmd] Auto-login: No session restored/created silently. User may need to login manually.");
                }
            }
            catch (error) {
                exports.logger.warn(`[Cmd] Auto-login attempt for connection "${activeConnection?.label || "unknown"}" failed silently (this is expected if credentials/connection are incomplete or server issues prevent silent login): ${error.message}`);
            }
        }
        else {
            exports.logger.trace("[Cmd] Auto-login is disabled in settings.");
        }
    });
    // --- Command: Login ---
    registerSafeCommand(context, constants_1.allExtensionCommands.login, async () => {
        exports.logger.debug(`[Cmd] Called: ${constants_1.allExtensionCommands.login}`);
        try {
            const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], { createIfNone: true });
            if (session) {
                exports.logger.info(`[Cmd] Login successful, session ID: ${session.id}`);
                await initializeTreeViews();
                try {
                    const projectProvider = treeServiceManager.getProjectManagementProvider();
                    projectProvider.refresh(true);
                }
                catch (error) {
                    exports.logger.warn("[Cmd] Error refreshing project provider after login:", error);
                }
            }
        }
        catch (error) {
            exports.logger.error(`[Cmd] Login process failed or was cancelled:`, error);
            vscode.window.showErrorMessage(`TestBench Login Failed: ${error.message}`);
        }
    });
    // --- Command: Logout ---
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
    registerSafeCommand(context, constants_1.allExtensionCommands.handleProjectCycleClick, async (cycleItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.handleProjectCycleClick} for item ${cycleItem.label}`);
        try {
            if (!treeServiceManager || !treeServiceManager.getInitializationStatus()) {
                throw new Error("TreeServiceManager is not initialized");
            }
            // Hide Projects view, show Test Theme and Test Elements views
            await hideProjectManagementTreeView();
            await displayTestThemeTreeView();
            await displayTestElementsTreeView();
            await treeServiceManager.handleCycleSelection(cycleItem);
        }
        catch (error) {
            exports.logger.error("[Cmd CycleClick] Error during cycle click handling:", error);
            // Reset Test Elements tree view on error
            try {
                const testElementsTreeView = treeServiceManager.getTestElementsTreeView();
                testElementsTreeView.title = "Test Elements";
                const testElementsProvider = treeServiceManager.getTestElementsProvider();
                testElementsProvider.updateTreeViewStatusMessage();
            }
            catch (resetError) {
                exports.logger.error("[Cmd CycleClick] Error resetting tree view after failure:", resetError);
            }
            vscode.window.showErrorMessage(`Error handling cycle selection: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    });
    // --- Command: Generate Test Cases For Cycle ---
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
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet} for item: ${treeItem.label}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet} command called without connection.`);
            return;
        }
        try {
            const testThemeProvider = treeServiceManager.getTestThemeProvider();
            if ((0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR)) {
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.clearInternalTestbenchFolder);
            }
            const cycleKey = testThemeProvider.getCurrentCycleKey();
            const projectKey = testThemeProvider.getCurrentProjectKey();
            if (!cycleKey || !projectKey) {
                const errorMessage = `Error: Could not determine the active Project or Cycle context for test generation. Please ensure a cycle is selected and its themes are visible.`;
                vscode.window.showErrorMessage(errorMessage);
                exports.logger.error(`${errorMessage} (Project: ${projectKey}, Cycle: ${cycleKey}) for item '${treeItem.label}' (UID: ${treeItem.getUID()})`);
                return;
            }
            exports.logger.trace(`Using Project Key: '${projectKey}' and Cycle Key: '${cycleKey}' from TestThemeTreeDataProvider for test generation for item '${treeItem.label}'.`);
            const testGenerationSuccessful = await reportHandler.generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(context, treeItem, typeof treeItem.label === "string" ? treeItem.label : treeItem.itemData?.name || "Unknown Item", projectKey, cycleKey, treeItem.getUID() || "");
            if (testGenerationSuccessful && exports.ENABLE_ICON_MARKING_ON_TEST_GENERATION) {
                const markedItemStateService = treeServiceManager.markedItemStateService;
                const itemKeyToMark = treeItem.getUniqueId();
                const itemUIDToMark = treeItem.getUID();
                const originalContext = treeItem.originalContextValue;
                if (itemKeyToMark &&
                    itemUIDToMark &&
                    originalContext &&
                    (originalContext === constants_1.TreeItemContextValues.TEST_THEME_TREE_ITEM ||
                        originalContext === constants_1.TreeItemContextValues.TEST_CASE_SET_TREE_ITEM)) {
                    const descendantUIDs = treeItem.getDescendantUIDs();
                    const descendantKeysWithUIDs = treeItem.getDescendantKeysWithUIDs();
                    await markedItemStateService.markItem(itemKeyToMark, itemUIDToMark, projectKey, cycleKey, originalContext, true, descendantUIDs, descendantKeysWithUIDs);
                    testThemeProvider.refresh();
                }
                else {
                    exports.logger.warn(`[Cmd Handler] Could not mark item ${treeItem.label} after generation, missing key/UID/originalContext or invalid type.`);
                }
            }
        }
        catch (error) {
            exports.logger.error("[Cmd] Error in generateTestCasesForTestThemeOrTestCaseSet:", error);
            vscode.window.showErrorMessage(`Error accessing Test Theme context: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    });
    // --- Command: Display All Projects ---
    registerSafeCommand(context, constants_1.allExtensionCommands.displayAllProjects, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.displayAllProjects}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.displayAllProjects} command called without connection.`);
            return;
        }
        await displayProjectManagementTreeView();
        await hideTestThemeTreeView();
        await hideTestElementsTreeView();
    });
    // --- Command: Read Robotframework Test Results And Create Report With Results ---
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
        try {
            const testThemeProvider = treeServiceManager.getTestThemeProvider();
            const markedItemStateService = treeServiceManager.markedItemStateService;
            const targetProjectKey = testThemeProvider.getCurrentProjectKey();
            const targetCycleKey = testThemeProvider.getCurrentCycleKey();
            if (!targetProjectKey || !targetCycleKey) {
                const errorMsg = `Could not determine active Project/Cycle key for import. Please ensure a cycle is selected.`;
                exports.logger.error(errorMsg);
                vscode.window.showErrorMessage(errorMsg);
                return null;
            }
            const itemKey = item.getUniqueId();
            const itemUID = item.getUID();
            const resolvedReportRootUID = markedItemStateService.getReportRootUID(itemKey, itemUID, targetProjectKey, targetCycleKey);
            if (!resolvedReportRootUID) {
                const errorMsg = `Cannot determine Report Root UID for item: ${item.label}. This item may not be eligible for import or was not properly marked after test generation.`;
                exports.logger.error(errorMsg);
                vscode.window.showErrorMessage(errorMsg);
                return null;
            }
            const importSuccessful = await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(context, item, targetProjectKey, targetCycleKey, resolvedReportRootUID);
            if (importSuccessful) {
                exports.logger.info(`Import process for item ${item.label} (UID: ${resolvedReportRootUID}) reported success.`);
                if (!exports.ALLOW_PERSISTENT_IMPORT_BUTTON) {
                    exports.logger.debug(`Clearing marked state for item: ${item.label} as ALLOW_PERSISTENT_IMPORT_BUTTON is false.`);
                    await markedItemStateService.clearMarking(itemKey);
                }
                else {
                    exports.logger.debug(`ALLOW_PERSISTENT_IMPORT_BUTTON is true. Import button will persist for item: ${item.label}`);
                }
                testThemeProvider.refresh();
            }
            else {
                exports.logger.warn(`Import process for item ${item.label} (UID: ${resolvedReportRootUID}) did not complete successfully or was cancelled.`);
            }
        }
        catch (error) {
            exports.logger.error("[Cmd] Error in readAndImportTestResultsToTestbench:", error);
            vscode.window.showErrorMessage(`Error accessing Test Theme context: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    });
    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshProjectTreeView, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.refreshProjectTreeView}`);
        try {
            const projectProvider = treeServiceManager.getProjectManagementProvider();
            projectProvider.refresh(false);
        }
        catch (error) {
            exports.logger.error("[Cmd] Error refreshing project tree:", error);
            vscode.window.showErrorMessage("Failed to refresh project tree. Please check logs for details.");
        }
    });
    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshTestThemeTreeView, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.refreshTestThemeTreeView}`);
        try {
            const testThemeProvider = treeServiceManager.getTestThemeProvider();
            const testThemeTreeView = treeServiceManager.getTestThemeTreeView();
            if (!testThemeProvider.getCurrentCycleKey() || !testThemeProvider.getCurrentProjectKey()) {
                exports.logger.info("Test Theme Tree: No current cycle selected to refresh. Clearing tree.");
                testThemeProvider.clearTree();
                testThemeTreeView.title = "Test Themes";
                return;
            }
            await testThemeProvider.refresh(false);
            exports.logger.info("Test Theme Tree view refresh completed successfully.");
        }
        catch (error) {
            exports.logger.error("[Cmd] Error refreshing test theme tree:", error);
            vscode.window.showErrorMessage("Failed to refresh Test Themes. Check logs for details.");
        }
    });
    // --- Command: Make Root ---
    registerSafeCommand(context, constants_1.allExtensionCommands.makeRoot, (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.makeRoot} for tree item:`, treeItem);
        if (!treeItem) {
            exports.logger.warn("MakeRoot command called with null treeItem.");
            return;
        }
        try {
            // Check if the item belongs to the Project Management Tree
            if (treeItem.contextValue &&
                [
                    constants_1.TreeItemContextValues.PROJECT,
                    constants_1.TreeItemContextValues.VERSION,
                    constants_1.TreeItemContextValues.CYCLE
                ].includes(treeItem.contextValue)) {
                const projectProvider = treeServiceManager.getProjectManagementProvider();
                projectProvider.makeRoot(treeItem);
            }
            // Check if the item belongs to the Test Theme Tree
            else if (treeItem.contextValue &&
                [
                    constants_1.TreeItemContextValues.TEST_THEME_TREE_ITEM,
                    constants_1.TreeItemContextValues.TEST_CASE_SET_TREE_ITEM,
                    constants_1.TreeItemContextValues.MARKED_TEST_THEME_TREE_ITEM,
                    constants_1.TreeItemContextValues.MARKED_TEST_CASE_SET_TREE_ITEM
                ].includes(treeItem.contextValue)) {
                const testThemeProvider = treeServiceManager.getTestThemeProvider();
                if (typeof testThemeProvider.makeRoot === "function") {
                    testThemeProvider.makeRoot(treeItem);
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
        }
        catch (error) {
            exports.logger.error("[Cmd] Error in makeRoot command:", error);
            vscode.window.showErrorMessage(`Failed to make '${treeItem.label}' a root: ${error.message}`);
        }
    });
    // --- Command: Reset Project Tree View Root ---
    registerSafeCommand(context, constants_1.allExtensionCommands.resetProjectTreeViewRoot, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.resetProjectTreeViewRoot}`);
        try {
            const projectProvider = treeServiceManager.getProjectManagementProvider();
            projectProvider.resetCustomRoot();
        }
        catch (error) {
            exports.logger.error("[Cmd] Error resetting project tree root:", error);
            vscode.window.showWarningMessage("Failed to reset project tree root.");
        }
    });
    // --- Command: Reset Test Theme Tree View Root ---
    registerSafeCommand(context, constants_1.allExtensionCommands.resetTestThemeTreeViewRoot, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.resetTestThemeTreeViewRoot}`);
        try {
            const testThemeProvider = treeServiceManager.getTestThemeProvider();
            testThemeProvider.resetCustomRoot();
        }
        catch (error) {
            exports.logger.error("[Cmd] Error resetting test theme tree root:", error);
            vscode.window.showWarningMessage("Failed to reset test theme tree root.");
        }
    });
    // --- Command: Clear Workspace Folder ---
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
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshTestElementsTree, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.refreshTestElementsTree}`);
        try {
            const testElementsProvider = treeServiceManager.getTestElementsProvider();
            const currentTovKey = testElementsProvider.getCurrentTovKey();
            if (!currentTovKey) {
                exports.logger.info("No TOV key available for refresh. Clearing tree with appropriate message.");
                testElementsProvider.clearTree();
                return;
            }
            exports.logger.debug(`Refreshing test elements for TOV: ${currentTovKey}`);
            await testElementsProvider.refresh(false);
        }
        catch (error) {
            exports.logger.error(`[Cmd] Error during test elements refresh:`, error);
            vscode.window.showErrorMessage(`Error refreshing test elements: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    });
    // --- Command: Display Interactions For Selected TOV ---
    registerSafeCommand(context, constants_1.allExtensionCommands.displayInteractionsForSelectedTOV, async (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.displayInteractionsForSelectedTOV} for tree item:`, treeItem);
        try {
            const projectProvider = treeServiceManager.getProjectManagementProvider();
            const testElementsProvider = treeServiceManager.getTestElementsProvider();
            const testElementsTreeView = treeServiceManager.getTestElementsTreeView();
            if (treeItem.contextValue === constants_1.TreeItemContextValues.VERSION) {
                const tovKeyOfSelectedTreeElement = treeItem.itemData?.key?.toString();
                const tovLabel = typeof treeItem.label === "string" ? treeItem.label : "Unknown TOV";
                if (tovKeyOfSelectedTreeElement) {
                    testElementsTreeView.title = `Test Elements (Loading...)`;
                    const areTestElementsFetched = await testElementsProvider.fetchTestElements(tovKeyOfSelectedTreeElement, tovLabel);
                    if (areTestElementsFetched) {
                        await hideProjectManagementTreeView();
                        await displayTestElementsTreeView();
                        testElementsTreeView.title = `Test Elements (${tovLabel})`;
                        // Restart language client for the selected project/TOV
                        const projectAndTovNameObj = projectProvider.getProjectAndTovNamesForItem(treeItem);
                        if (projectAndTovNameObj) {
                            const { projectName, tovName } = projectAndTovNameObj;
                            if (projectName && tovName) {
                                await (0, server_1.restartLanguageClient)(projectName, tovName);
                            }
                        }
                    }
                    else {
                        testElementsTreeView.title = "Test Elements";
                        exports.logger.warn(`Test Elements fetch failed for TOV: ${tovKeyOfSelectedTreeElement}`);
                        vscode.window.showErrorMessage(`Failed to fetch test elements for TOV: ${tovLabel}`);
                    }
                }
                else {
                    const errorMsg = "Invalid TOV selection for test elements display.";
                    exports.logger.warn(errorMsg);
                    vscode.window.showWarningMessage(errorMsg);
                }
            }
        }
        catch (error) {
            exports.logger.error(`[Cmd] Error in display interactions command:`, error);
            try {
                const testElementsTreeView = treeServiceManager.getTestElementsTreeView();
                const testElementsProvider = treeServiceManager.getTestElementsProvider();
                testElementsTreeView.title = "Test Elements";
                testElementsProvider.updateTreeViewStatusMessage();
            }
            catch (resetError) {
                exports.logger.error("[Cmd] Error resetting test elements view after failure:", resetError);
            }
            vscode.window.showErrorMessage(`Error loading test elements: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    });
    // --- Command: Go To Resource File ---
    registerSafeCommand(context, constants_1.allExtensionCommands.openOrCreateRobotResourceFile, async (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.openOrCreateRobotResourceFile} for tree item:`, treeItem);
        try {
            const testElementsProvider = treeServiceManager.getTestElementsProvider();
            await testElementsProvider.handleGoToResourceCommand(treeItem);
        }
        catch (error) {
            exports.logger.error("[Cmd] Error handling Go To Resource File command:", error);
            vscode.window.showErrorMessage("Failed to handle resource file operation. Please try again.");
        }
    });
    // --- Command: Create Interaction Under Subdivision ---
    registerSafeCommand(context, constants_1.allExtensionCommands.createInteractionUnderSubdivision, async (subdivisionTreeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.createInteractionUnderSubdivision} for tree item:`, subdivisionTreeItem);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.createInteractionUnderSubdivision} command called without connection.`);
            return;
        }
        try {
            const testElementsProvider = treeServiceManager.getTestElementsProvider();
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
            const newInteraction = await testElementsProvider.createInteractionUnderSubdivision(subdivisionTreeItem, interactionName);
            if (newInteraction) {
                testElementsProvider._onDidChangeTreeData.fire(undefined);
                vscode.window.showInformationMessage(`Successfully created interaction '${interactionName}'`);
                exports.logger.debug(`Created new interaction '${interactionName}' under subdivision '${subdivisionTreeItem.testElementData.name}'`);
            }
        }
        catch (error) {
            exports.logger.error("[Cmd] Error creating interaction under subdivision:", error);
            vscode.window.showErrorMessage("Failed to create interaction. Please try again.");
        }
    });
    // --- Command: Open Issue Reporter ---
    registerSafeCommand(context, constants_1.allExtensionCommands.openIssueReporter, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.openIssueReporter}`);
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench-extension"
        });
    });
    // --- Command: Modify Report With Results Zip ---
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
 * Handles changes in the TestBench authentication session with centralized tree management.
 *
 * @param {vscode.ExtensionContext} context - The VS Code extension context.
 * @param {vscode.AuthenticationSession} existingSession - An optional existing authentication session to process.
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
        const activeConnection = await connectionManager.getActiveConnection(context);
        if (activeConnection) {
            // Check if a connection for this session and connection already exists
            if (exports.connection &&
                exports.connection.getSessionToken() === sessionToProcess.accessToken &&
                exports.connection.getUsername() === activeConnection.username &&
                exports.connection.getServerName() === activeConnection.serverName &&
                exports.connection.getServerPort() === activeConnection.portNumber.toString()) {
                exports.logger.info(`[Extension] Connection for connection '${activeConnection.label}' and current session token is already active. Skipping re-initialization.`);
                if (!wasPreviouslyConnected) {
                    exports.logger.info("[Extension] Re-asserting UI state for existing matching connection.");
                    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, true);
                    getLoginWebViewProvider()?.updateWebviewHTMLContent();
                    await vscode.commands.executeCommand(constants_1.allExtensionCommands.displayAllProjects);
                    try {
                        const projectProvider = treeServiceManager.getProjectManagementProvider();
                        const testThemeProvider = treeServiceManager.getTestThemeProvider();
                        projectProvider.refresh(true);
                        testThemeProvider.clearTree();
                    }
                    catch (error) {
                        exports.logger.warn("[Extension] Error refreshing trees during session restore:", error);
                    }
                }
                return;
            }
            exports.logger.info(`[Extension] TestBench session active for connection: ${activeConnection.label}. Initializing PlayServerConnection.`);
            if (exports.connection) {
                exports.logger.warn("[Extension] A different connection was active. Logging out from previous server session before establishing new one.");
                await exports.connection.logoutUserOnServer();
            }
            const newConnection = new testBenchConnection_1.PlayServerConnection(activeConnection.serverName, activeConnection.portNumber, activeConnection.username, sessionToProcess.accessToken);
            setConnection(newConnection);
            await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, true);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
            // Only display projects tree view after a login,
            // so that the user won't other tree views in loading state
            await hideTestThemeTreeView();
            await hideTestElementsTreeView();
            if (!wasPreviouslyConnected ||
                (exports.connection && exports.connection.getSessionToken() !== newConnection.getSessionToken())) {
                exports.logger.info("[Extension] New session established. Setting default view to 'Projects' and refreshing data.");
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.displayAllProjects);
                try {
                    const projectProvider = treeServiceManager.getProjectManagementProvider();
                    const testThemeProvider = treeServiceManager.getTestThemeProvider();
                    const testElementsProvider = treeServiceManager.getTestElementsProvider();
                    projectProvider.refresh(true);
                    testThemeProvider.clearTree();
                    testElementsProvider.clearTree();
                }
                catch (error) {
                    exports.logger.warn("[Extension] Error managing trees during session change:", error);
                }
            }
            else {
                exports.logger.info("[Extension] Session changed while already connected. Resetting view to 'Projects' and refreshing data.");
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.displayAllProjects);
                try {
                    const projectProvider = treeServiceManager.getProjectManagementProvider();
                    const testThemeProvider = treeServiceManager.getTestThemeProvider();
                    const testElementsProvider = treeServiceManager.getTestElementsProvider();
                    projectProvider.refresh(true);
                    testThemeProvider.clearTree();
                    testElementsProvider.clearTree();
                }
                catch (error) {
                    exports.logger.warn("[Extension] Error managing trees during session update:", error);
                }
            }
        }
        else {
            exports.logger.warn("[Extension] Session exists, but no active connection. Clearing connection.");
            if (exports.connection) {
                await exports.connection.logoutUserOnServer();
            }
            setConnection(null);
            await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, false);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
            await hideProjectManagementTreeView();
            await hideTestThemeTreeView();
            await hideTestElementsTreeView();
            try {
                treeServiceManager.clearAllTrees();
            }
            catch (error) {
                exports.logger.warn("[Extension] Error clearing trees during logout:", error);
            }
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
        await hideProjectManagementTreeView();
        await hideTestThemeTreeView();
        await hideTestElementsTreeView();
        try {
            treeServiceManager.clearAllTrees();
        }
        catch (error) {
            exports.logger.warn("[Extension] Error clearing trees during session cleanup:", error);
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
async function activate(context) {
    exports.logger = new testBenchLogger.TestBenchLogger();
    exports.logger.info("Extension activated.");
    (0, configuration_1.initializeConfigurationWatcher)();
    // Register AuthenticationProvider
    authProviderInstance = new testBenchAuthenticationProvider_1.TestBenchAuthenticationProvider(context);
    context.subscriptions.push(vscode.authentication.registerAuthenticationProvider(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_LABEL, authProviderInstance, { supportsMultipleAccounts: false }));
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
    // Initialize TreeServiceManager
    const treeServiceDependencies = {
        extensionContext: context,
        logger: exports.logger,
        getConnection: getConnection
    };
    treeServiceManager = new treeServiceManager_1.TreeServiceManager(treeServiceDependencies);
    try {
        await treeServiceManager.initialize();
        exports.logger.info("[Extension] TreeServiceManager initialized successfully.");
    }
    catch (error) {
        exports.logger.error("[Extension] TreeServiceManager initialization failed:", error);
        vscode.window.showErrorMessage("TestBench Extension critical services failed to initialize. Some features may be unavailable.");
    }
    await initializeTreeViews();
    // Set the initial connection context state
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, exports.connection !== null);
    exports.logger.trace(`Initial connectionActive context set to: ${exports.connection !== null}`);
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false);
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);
    // Initialize login webview
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    await registerExtensionCommands(context);
    // Attempt to restore session on activation
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
        if (treeServiceManager) {
            exports.logger.info("[Extension] Disposing TreeServiceManager on deactivation.");
            treeServiceManager.dispose();
        }
        exports.logger.info("Extension deactivated.");
    }
    catch (error) {
        exports.logger.error("Error during deactivation:", error);
    }
}
//# sourceMappingURL=extension.js.map