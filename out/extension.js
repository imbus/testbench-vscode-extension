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
exports.ALLOW_PERSISTENT_IMPORT_BUTTON = exports.ENABLE_ICON_MARKING_ON_TEST_GENERATION = exports.treeServiceManager = exports.connection = exports.logger = void 0;
exports.setLogger = setLogger;
exports.setConnection = setConnection;
exports.getConnection = getConnection;
exports.getLoginWebViewProvider = getLoginWebViewProvider;
exports.safeCommandHandler = safeCommandHandler;
exports.initializeTreeViews = initializeTreeViews;
exports.activate = activate;
exports.updateOrRestartLS = updateOrRestartLS;
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
const node_1 = require("vscode-languageclient/node");
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
    await vscode.commands.executeCommand(`${constants_1.projectManagementTreeViewID}.removeView`);
}
async function displayProjectManagementTreeView() {
    await vscode.commands.executeCommand(`${constants_1.projectManagementTreeViewID}.focus`);
}
async function hideTestThemeTreeView() {
    await vscode.commands.executeCommand(`${constants_1.testThemeTreeViewID}.removeView`);
}
async function displayTestThemeTreeView() {
    await vscode.commands.executeCommand(`${constants_1.testThemeTreeViewID}.focus`);
}
async function hideTestElementsTreeView() {
    await vscode.commands.executeCommand(`${constants_1.testElementsTreeViewID}.removeView`);
}
async function displayTestElementsTreeView() {
    await vscode.commands.executeCommand(`${constants_1.testElementsTreeViewID}.focus`);
}
/**
 * Initializes all tree views using the TreeServiceManager.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function initializeTreeViews() {
    if (!exports.treeServiceManager) {
        exports.logger.error("[Extension] TreeServiceManager is not initialized. Cannot initialize tree views.");
        vscode.window.showErrorMessage("Failed to initialize TestBench views: Core services missing.");
        return;
    }
    if (!exports.treeServiceManager.getInitializationStatus()) {
        exports.logger.warn("[Extension] TreeServiceManager is not fully initialized. Proceeding, but some services might not be ready.");
    }
    try {
        await exports.treeServiceManager.initializeTreeViews();
        try {
            const projectProvider = exports.treeServiceManager.getProjectManagementProvider();
            const testThemeProvider = exports.treeServiceManager.getTestThemeProvider();
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
                    const projectProvider = exports.treeServiceManager.getProjectManagementProvider();
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
            if (!exports.treeServiceManager || !exports.treeServiceManager.getInitializationStatus()) {
                throw new Error("TreeServiceManager is not initialized");
            }
            await exports.treeServiceManager.handleCycleSelection(cycleItem);
            // Hide Projects view, show Test Theme and Test Elements views
            await hideProjectManagementTreeView();
            await displayTestThemeTreeView();
            await displayTestElementsTreeView();
        }
        catch (error) {
            exports.logger.error("[Cmd CycleClick] Error during cycle click handling:", error);
            // Reset Test Elements tree view on error
            try {
                const testElementsTreeView = exports.treeServiceManager.getTestElementsTreeView();
                testElementsTreeView.title = "Test Elements";
                const testElementsProvider = exports.treeServiceManager.getTestElementsProvider();
                testElementsProvider.updateTreeViewStatusMessage();
            }
            catch (resetError) {
                exports.logger.error("[Cmd CycleClick] Error resetting tree view after failure:", resetError);
            }
            vscode.window.showErrorMessage(`Error handling cycle selection: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    });
    // --- Command: Generate Tests For Cycle ---
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
    // --- Command: Generate Tests For Test Theme or Test Case Set ---
    registerSafeCommand(context, constants_1.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet, async (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet} for item: ${treeItem.label}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet} command called without connection.`);
            return;
        }
        try {
            const testThemeProvider = exports.treeServiceManager.getTestThemeProvider();
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
                const markedItemStateService = exports.treeServiceManager.markedItemStateService;
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
                    await markedItemStateService.markItemWithDescendants(itemKeyToMark, itemUIDToMark, projectKey, cycleKey, originalContext, true, descendantUIDs, descendantKeysWithUIDs);
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
            const testThemeProvider = exports.treeServiceManager.getTestThemeProvider();
            const markedItemStateService = exports.treeServiceManager.markedItemStateService;
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
                    await markedItemStateService.clearItemMarkingIncludingDescendants(itemKey);
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
            const projectProvider = exports.treeServiceManager.getProjectManagementProvider();
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
            const testThemeProvider = exports.treeServiceManager.getTestThemeProvider();
            const testThemeTreeView = exports.treeServiceManager.getTestThemeTreeView();
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
                const projectProvider = exports.treeServiceManager.getProjectManagementProvider();
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
                const testThemeProvider = exports.treeServiceManager.getTestThemeProvider();
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
            const projectProvider = exports.treeServiceManager.getProjectManagementProvider();
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
            const testThemeProvider = exports.treeServiceManager.getTestThemeProvider();
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
            const testElementsProvider = exports.treeServiceManager.getTestElementsProvider();
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
    // --- Command: Go To Resource File ---
    registerSafeCommand(context, constants_1.allExtensionCommands.openOrCreateRobotResourceFile, async (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.openOrCreateRobotResourceFile} for tree item:`, treeItem);
        try {
            const testElementsProvider = exports.treeServiceManager.getTestElementsProvider();
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
            const testElementsProvider = exports.treeServiceManager.getTestElementsProvider();
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
    // --- Command: Generate Test Cases For TOV ---
    registerSafeCommand(context, constants_1.allExtensionCommands.generateTestCasesForTOV, async (tovItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.generateTestCasesForTOV} for item: ${tovItem.label}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.generateTestCasesForTOV} command called without connection.`);
            return;
        }
        if ((0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR)) {
            await vscode.commands.executeCommand(constants_1.allExtensionCommands.clearInternalTestbenchFolder);
        }
        try {
            const projectKey = tovItem.getProjectKey();
            const tovKey = tovItem.getUniqueId();
            const tovName = typeof tovItem.label === "string" ? tovItem.label : "Unknown TOV";
            if (!projectKey || !tovKey) {
                const errorMessage = "Could not determine project or TOV key for test generation.";
                vscode.window.showErrorMessage(errorMessage);
                exports.logger.error(`${errorMessage} Project: ${projectKey}, TOV: ${tovKey}`);
                return;
            }
            exports.logger.info(`Starting test generation for TOV: ${tovName} (${tovKey}) in project: ${projectKey}`);
            await reportHandler.startTestGenerationUsingTOV(context, tovItem, projectKey, tovKey, false);
        }
        catch (error) {
            exports.logger.error("[Cmd] Error in generateTestCasesForTOV:", error);
            vscode.window.showErrorMessage(`Error generating tests for TOV: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    });
    // --- Command: Generate Tests for a Test Theme Tree Item opened from a TOV ---
    registerSafeCommand(context, constants_1.allExtensionCommands.generateTestsForTestThemeTreeItemFromTOV, async (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.generateTestsForTestThemeTreeItemFromTOV} for item: ${treeItem.label}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.generateTestsForTestThemeTreeItemFromTOV} command called without connection.`);
            return;
        }
        if ((0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR)) {
            await vscode.commands.executeCommand(constants_1.allExtensionCommands.clearInternalTestbenchFolder);
        }
        try {
            const testThemeProvider = exports.treeServiceManager.getTestThemeProvider();
            const projectKey = testThemeProvider.getCurrentProjectKey();
            const testElementsProvider = exports.treeServiceManager.getTestElementsProvider();
            const tovKey = testElementsProvider.getCurrentTovKey();
            const treeItemLabel = typeof treeItem.label === "string" ? treeItem.label : "Unknown Tree Item";
            if (!projectKey || !tovKey) {
                const errorMessage = "Could not determine project or TOV key for test generation.";
                vscode.window.showErrorMessage(errorMessage);
                exports.logger.error(`${errorMessage} Project: ${projectKey}, TOV: ${tovKey}`);
                return;
            }
            exports.logger.info(`Starting test generation for tree Item: ${treeItemLabel} (${tovKey}) in project: ${projectKey}`);
            await reportHandler.startTestGenerationUsingTOV(context, treeItem, projectKey, tovKey, true);
        }
        catch (error) {
            exports.logger.error("[Cmd] Error in generateTestsForTestThemeTreeItemFromTOV:", error);
            vscode.window.showErrorMessage(`Error generating tests for TOV: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    });
    // --- Command: Open TOV From Projects View ---
    registerSafeCommand(context, constants_1.allExtensionCommands.openTOVFromProjectsView, async (tovItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.openTOVFromProjectsView} for TOV item: ${tovItem.label}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.openTOVFromProjectsView} command called without connection.`);
            return;
        }
        try {
            await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.IS_TT_OPENED_FROM_CYCLE, false);
            await context.globalState.update(constants_1.StorageKeys.IS_TT_OPENED_FROM_CYCLE_STORAGE_KEY, false);
            const projectProvider = exports.treeServiceManager.getProjectManagementProvider();
            const testElementsProvider = exports.treeServiceManager.getTestElementsProvider();
            const testElementsTreeView = exports.treeServiceManager.getTestElementsTreeView();
            if (tovItem.contextValue === constants_1.TreeItemContextValues.VERSION) {
                const tovKeyOfSelectedTreeElement = tovItem.itemData?.key?.toString();
                const tovLabel = typeof tovItem.label === "string" ? tovItem.label : "Unknown TOV";
                if (tovKeyOfSelectedTreeElement) {
                    testElementsTreeView.title = `Test Elements (Loading...)`;
                    const areTestElementsFetched = await testElementsProvider.fetchTestElements(tovKeyOfSelectedTreeElement, tovLabel);
                    if (areTestElementsFetched) {
                        await exports.treeServiceManager.openTovAndInitTestThemes(tovItem);
                        exports.treeServiceManager.getTestThemeProvider().isTestThemeOpenedFromACycle = false;
                        await hideProjectManagementTreeView();
                        await displayTestThemeTreeView();
                        await displayTestElementsTreeView();
                        testElementsTreeView.title = `Test Elements (${tovLabel})`;
                        // Restart language client for the selected project/TOV
                        const projectAndTovNameObj = projectProvider.getProjectAndTovNamesFromProjectTreeItem(tovItem);
                        if (projectAndTovNameObj) {
                            const { projectName, tovName } = projectAndTovNameObj;
                            // Persist the active TOV context for restoration
                            if (projectName && tovName) {
                                // Clear last active cycle context when opening TOV
                                await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, undefined);
                                const tovContext = {
                                    tovKey: tovKeyOfSelectedTreeElement,
                                    tovLabel: tovName,
                                    projectName
                                };
                                await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, tovContext);
                                exports.logger.trace(`[Cmd] Persisted active TOV context:`, tovContext);
                                await updateOrRestartLS(projectName, tovName);
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
            exports.logger.error(`[Cmd] Error in OpenTOVFromProjectsView command:`, error);
            try {
                const testElementsTreeView = exports.treeServiceManager.getTestElementsTreeView();
                const testElementsProvider = exports.treeServiceManager.getTestElementsProvider();
                testElementsTreeView.title = "Test Elements";
                testElementsProvider.updateTreeViewStatusMessage();
            }
            catch (resetError) {
                exports.logger.error("[Cmd] Error resetting test elements view after failure:", resetError);
            }
            vscode.window.showErrorMessage(`Error loading test elements: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    });
    // --- Command: Open Cycle Contents ---
    registerSafeCommand(context, constants_1.allExtensionCommands.openCycleFromProjectsView, async (cycleTreeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.openCycleFromProjectsView} for cycle tree item: ${cycleTreeItem.label}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.openCycleFromProjectsView} command called without connection.`);
            return;
        }
        try {
            if (!exports.treeServiceManager || !exports.treeServiceManager.getInitializationStatus()) {
                throw new Error("TreeServiceManager is not initialized");
            }
            // Hide Projects view, show Test Theme and Test Elements views
            await hideProjectManagementTreeView();
            await displayTestThemeTreeView();
            await displayTestElementsTreeView();
            await exports.treeServiceManager.handleCycleSelection(cycleTreeItem);
        }
        catch (error) {
            exports.logger.error("[Cmd OpenCycleFromProjectsView] Error during cycle open handling:", error);
            // Reset Test Elements tree view on error
            try {
                const testElementsTreeView = exports.treeServiceManager.getTestElementsTreeView();
                testElementsTreeView.title = "Test Elements";
                const testElementsProvider = exports.treeServiceManager.getTestElementsProvider();
                testElementsProvider.updateTreeViewStatusMessage();
            }
            catch (resetError) {
                exports.logger.error("[Cmd OpenCycleFromProjectsView] Error resetting tree view after failure:", resetError);
            }
            vscode.window.showErrorMessage(`Error opening cycle: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    });
    // --- Command: Check and handle double clicks on cycle ---
    registerSafeCommand(context, constants_1.allExtensionCommands.checkForCycleDoubleClick, async (cycleTreeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.checkForCycleDoubleClick} for cycle tree item: ${cycleTreeItem.label}`);
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error(`${constants_1.allExtensionCommands.checkForCycleDoubleClick} command called without connection.`);
            return;
        }
        try {
            if (!exports.treeServiceManager || !exports.treeServiceManager.getInitializationStatus()) {
                throw new Error("TreeServiceManager is not initialized");
            }
            await exports.treeServiceManager.detectAndHandleCycleTreeItemDoubleClick(cycleTreeItem);
        }
        catch (error) {
            exports.logger.error("[Cmd checkForCycleDoubleClick] Error during cycle open handling:", error);
            vscode.window.showErrorMessage(`Error opening cycle: ${error instanceof Error ? error.message : "Unknown error"}`);
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
            // Refresh tree providers as the session has changed.
            if (!wasPreviouslyConnected ||
                (exports.connection && exports.connection.getSessionToken() !== newConnection.getSessionToken())) {
                exports.logger.info("[Extension] New session established. Refreshing project data.");
                try {
                    const projectProvider = exports.treeServiceManager.getProjectManagementProvider();
                    const testThemeProvider = exports.treeServiceManager.getTestThemeProvider();
                    const testElementsProvider = exports.treeServiceManager.getTestElementsProvider();
                    projectProvider.refresh(true);
                    testThemeProvider.clearTree();
                    testElementsProvider.clearTree();
                    exports.logger.debug("[Extension] Restoring data and view state after login.");
                    await exports.treeServiceManager.restoreDataState();
                    exports.treeServiceManager.restoreVisibleViewsState();
                }
                catch (error) {
                    exports.logger.warn("[Extension] Error managing trees during session change:", error);
                    await vscode.commands.executeCommand(constants_1.allExtensionCommands.displayAllProjects);
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
            exports.logger.debug("[Extension] Restoring data and view state after session change.");
            await exports.treeServiceManager.restoreDataState();
            exports.treeServiceManager.restoreVisibleViewsState();
            try {
                await exports.treeServiceManager.clearAllTreesData();
            }
            catch (error) {
                exports.logger.warn("[Extension] Error clearing tree data during session change:", error);
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
        try {
            await exports.treeServiceManager.clearAllTreesData();
        }
        catch (error) {
            exports.logger.warn("[Extension] Error clearing tree data during session change:", error);
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
    exports.treeServiceManager = new treeServiceManager_1.TreeServiceManager(treeServiceDependencies);
    try {
        await exports.treeServiceManager.initialize();
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
    const isTTOpenedFromCycle = context.globalState.get(constants_1.StorageKeys.IS_TT_OPENED_FROM_CYCLE_STORAGE_KEY);
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.IS_TT_OPENED_FROM_CYCLE, isTTOpenedFromCycle);
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
 * Updates or restarts the language server based on the current state.
 * @param projectName the name of the project to update or restart the language server for.
 * @param tovName the name of the TOV to update or restart the language server for.
 */
async function updateOrRestartLS(projectName, tovName) {
    if (!projectName || !tovName) {
        exports.logger.error("[Cmd] updateOrRestartLS called with invalid project or TOV name.");
        vscode.window.showErrorMessage("Invalid project or TOV name provided for language server update.");
        return;
    }
    const existingClient = (0, server_1.getLanguageClientInstance)();
    exports.logger.debug(`[Cmd] updateOrRestartLS called with projectName: ${projectName}, tovName: ${tovName}, existingClient state: ${existingClient ? existingClient.state : "none"}`);
    if (existingClient && existingClient.state !== node_1.State.Stopped && existingClient.state !== node_1.State.Starting) {
        exports.logger.debug(`[Cmd] Updating language client with project name: ${projectName}, TOV name: ${tovName}`);
        await vscode.commands.executeCommand("testbench_ls.updateProject", projectName);
        await vscode.commands.executeCommand("testbench_ls.updateTov", tovName);
    }
    else {
        await (0, server_1.restartLanguageClient)(projectName, tovName);
    }
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
        if (exports.treeServiceManager) {
            exports.logger.info("[Extension] Disposing TreeServiceManager on deactivation.");
            exports.treeServiceManager.dispose();
        }
        exports.logger.info("Extension deactivated.");
    }
    catch (error) {
        exports.logger.error("Error during deactivation:", error);
    }
}
//# sourceMappingURL=extension.js.map