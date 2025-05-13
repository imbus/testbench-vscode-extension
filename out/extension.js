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
exports.connection = exports.logger = void 0;
exports.getConfig = getConfig;
exports.setLogger = setLogger;
exports.setConnection = setConnection;
exports.getLoginWebViewProvider = getLoginWebViewProvider;
exports.getProjectManagementTreeDataProvider = getProjectManagementTreeDataProvider;
exports.getTestThemeTreeDataProvider = getTestThemeTreeDataProvider;
exports.getTestElementsTreeDataProvider = getTestElementsTreeDataProvider;
exports.getProjectTreeView = getProjectTreeView;
exports.getTestThemeTreeViewInstance = getTestThemeTreeViewInstance;
exports.getTestElementTreeView = getTestElementTreeView;
exports.getCurrentLsProject = getCurrentLsProject;
exports.getCurrentLsTov = getCurrentLsTov;
exports.safeCommandHandler = safeCommandHandler;
exports.loadConfiguration = loadConfiguration;
exports.initializeTreeViews = initializeTreeViews;
exports.updateLanguageServerContextAndRestart = updateLanguageServerContextAndRestart;
exports.activate = activate;
exports.deactivate = deactivate;
// Before releasing the extension:
// TODO: Add License.md to the extension
// TODO: Set logger level to info or debug in production, remove too detailed logs.
// TODO: In production, remove process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; in connection class.
const vscode = __importStar(require("vscode"));
const testBenchLogger = __importStar(require("./testBenchLogger"));
const testBenchConnection = __importStar(require("./testBenchConnection"));
const reportHandler = __importStar(require("./reportHandler"));
const projectManagementTreeView = __importStar(require("./projectManagementTreeView"));
const projectManagementTreeView_1 = require("./projectManagementTreeView");
const testElementsTreeView = __importStar(require("./testElementsTreeView"));
const loginWebView = __importStar(require("./loginWebView"));
const utils = __importStar(require("./utils"));
const path_1 = __importDefault(require("path"));
const constants_1 = require("./constants");
const server_1 = require("./server");
const testThemeTreeView_1 = require("./testThemeTreeView");
const testElementsTreeView_1 = require("./testElementsTreeView");
const testBenchAuthenticationProvider_1 = require("./testBenchAuthenticationProvider");
const profileManager = __importStar(require("./profileManager"));
const testBenchConnection_1 = require("./testBenchConnection");
/* =============================================================================
   Constants, Global Variables & Exports
   ============================================================================= */
/** Workspace configuration for the extension. */
let config = vscode.workspace.getConfiguration(constants_1.baseKeyOfExtension);
function getConfig() {
    return config;
}
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
/** Module-private variables to hold the tree data providers and views. */
let _projectManagementTreeDataProvider = null;
let _testThemeTreeDataProvider = null;
let _testElementsTreeDataProvider;
let _projectTreeView;
let _testThemeTreeView;
let _testElementTreeView;
/** Getter functions for providers and views */
function getProjectManagementTreeDataProvider() {
    return _projectManagementTreeDataProvider;
}
function getTestThemeTreeDataProvider() {
    return _testThemeTreeDataProvider;
}
function getTestElementsTreeDataProvider() {
    return _testElementsTreeDataProvider;
}
function getProjectTreeView() {
    return _projectTreeView;
}
function getTestThemeTreeViewInstance() {
    return _testThemeTreeView;
}
function getTestElementTreeView() {
    return _testElementTreeView;
}
// Global variable to store the authentication provider instance
let authProviderInstance = null;
// Global state for current project and TOV context for language server
let currentLanguageServerProject;
let currentLanguageServerTov;
function getCurrentLsProject() {
    return currentLanguageServerProject;
}
function getCurrentLsTov() {
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
            // For silent auto-login, we expect errors if conditions aren't met,
            // so avoid showing an error message to the user for this specific command.
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
// Global variable to store the current configuration scope (workspace or global).
let currentConfigScope;
// Global variable to store the active editor instance to determine the best scope for configuration.
let activeEditor;
/**
 * Loads the latest extension configuration and updates the global configuration object.
 * Handles the storage of credentials based on the configuration settings.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function loadConfiguration(context, newScope) {
    // If no new scope provided, determine the best scope automatically
    if (newScope === undefined) {
        if (activeEditor) {
            // If there is an active editor, use its workspace folder as the scope
            newScope = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri;
        }
        else if (vscode.workspace.workspaceFolders?.length === 1) {
            // If there is only one workspace folder, use it as the scope
            newScope = vscode.workspace.workspaceFolders[0].uri;
        }
    }
    currentConfigScope = newScope;
    // Update the configuration object with the latest values.
    // Without this, the configuration changes may not be updated and old values may be used.
    config = vscode.workspace.getConfiguration(constants_1.baseKeyOfExtension, currentConfigScope);
    // Log the configuration source for debugging
    const configSource = currentConfigScope
        ? `workspace folder: ${vscode.workspace.getWorkspaceFolder(currentConfigScope)?.name}`
        : "global (no workspace)";
    exports.logger.trace(`Loading configuration from ${configSource}`);
    // Update the log level based on the new configuration.
    exports.logger.updateCachedLogLevel();
    // If storePassword is set to false, delete the stored password immediately.
    // If storePassword is set to true, the password is only stored after a successful login.
    // The login process also clears the stored password if the user does not want to store it.
    if (!config.get(constants_1.ConfigKeys.STORE_PASSWORD_AFTER_LOGIN, false)) {
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
function initializeTestElementsTreeView(context) {
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
function initializeTreeViews(context) {
    _testThemeTreeDataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider((message) => {
        if (_testThemeTreeView) {
            _testThemeTreeView.message = message;
        }
    });
    _testThemeTreeView = vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: _testThemeTreeDataProvider
    });
    context.subscriptions.push(_testThemeTreeView);
    _projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider((message) => {
        if (_projectTreeView) {
            _projectTreeView.message = message;
        }
    }, _testThemeTreeDataProvider // Pass the test theme tree data provider to the project management tree
    );
    const newProjectTreeView = vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: _projectManagementTreeDataProvider,
        canSelectMany: false
    });
    context.subscriptions.push(newProjectTreeView);
    _projectTreeView = newProjectTreeView;
    // Listen to event from ProjectManagementTreeDataProvider to update the Test Theme Tree
    // when the cycle data is prepared.
    if (_projectManagementTreeDataProvider && _testThemeTreeView && _testThemeTreeDataProvider) {
        context.subscriptions.push(_projectManagementTreeDataProvider.onDidPrepareCycleDataForThemeTree(async (eventData) => {
            if (_testThemeTreeDataProvider && _testThemeTreeView) {
                exports.logger.debug(`Cycle data prepared for ${eventData.cycleLabel}. Updating Test Theme Tree.`);
                // Update the title of the Test Themes tree view
                _testThemeTreeView.title = `Test Themes (${eventData.cycleLabel})`;
                exports.logger.trace(`Test Theme TreeView title updated to: ${_testThemeTreeView.title}`);
                _testThemeTreeDataProvider.clearTree();
                _testThemeTreeDataProvider.populateFromCycleData(eventData);
            }
        }));
    }
    // Initial data load/refresh for project tree
    _projectManagementTreeDataProvider?.refresh(true); // true for hard refresh
    if (_testThemeTreeDataProvider && _testThemeTreeView) {
        _testThemeTreeDataProvider.clearTree();
        // Message is set by clearTree/refresh via callback
    }
    initializeTestElementsTreeView(context);
    if (_projectTreeView && _projectManagementTreeDataProvider) {
        projectManagementTreeView.setupProjectTreeViewEventListeners(_projectTreeView, _projectManagementTreeDataProvider);
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
            query: "@ext:imbus.testbench-visual-studio-code-extension"
        });
        // Open the "workspace" tab in settings view (The default settings view is the user tab in settings)
        await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
    });
    // --- Command: Set Workspace ---
    registerSafeCommand(context, constants_1.allExtensionCommands.setWorkspace, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.setWorkspace}`);
        await utils.setWorkspaceLocation();
    });
    // --- Command: Manage Profiles ---
    registerSafeCommand(context, "testbenchExtension.manageProfiles", async () => {
        exports.logger.debug("[Cmd] Called: testbenchExtension.manageProfiles");
        const profiles = await profileManager.getProfiles(context);
        const activeProfileId = await profileManager.getActiveProfileId(context);
        const items = [
            { label: "$(add) Add New Profile", description: "Configure a new TestBench connection" },
            ...profiles.map((p) => ({
                label: `${activeProfileId === p.id ? "$(check) " : ""}${p.label}`,
                description: `${p.username}@${p.serverName}:${p.portNumber}`,
                detail: p.id // Store ID for later use
            }))
        ];
        if (profiles.length > 0) {
            items.push({ label: "$(trash) Delete a Profile", description: "Remove a saved connection" });
            items.push({ label: "$(settings-gear) Set Active Profile", description: "Choose which profile to use" });
        }
        const selection = await vscode.window.showQuickPick(items, { placeHolder: "Manage TestBench Profiles" });
        if (selection) {
            if (selection.label.includes("$(add)")) {
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.addNewProfile);
            }
            else if (selection.label.includes("$(trash)")) {
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.deleteProfile);
            }
            else if (selection.label.includes("$(settings-gear)")) {
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.selectActiveProfile);
            }
            else if (selection.detail) {
                // An existing profile was selected (could be used to edit or set active)                
                await profileManager.setActiveProfileId(context, selection.detail);
                vscode.window.showInformationMessage(`Profile "${selection.label.replace("$(check) ", "")}" is now active. Please login if not already connected.`);
                // Trigger a login attempt with the new active profile
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.login);
            }
        }
    });
    registerSafeCommand(context, constants_1.allExtensionCommands.addNewProfile, async () => {
        exports.logger.debug("[Cmd] Called: testbenchExtension.addNewProfile");
        vscode.window.showInformationMessage("To add a new profile, please use the 'TestBench: Login' command and choose to add a new connection when prompted.");
    });
    registerSafeCommand(context, constants_1.allExtensionCommands.selectActiveProfile, async () => {
        exports.logger.debug("[Cmd] Called: testbenchExtension.selectActiveProfile");
        const profiles = await profileManager.getProfiles(context);
        if (profiles.length === 0) {
            vscode.window.showInformationMessage("No saved TestBench profiles. Please add one first.");
            return;
        }
        const items = profiles.map((p) => ({
            label: p.label,
            description: `${p.username}@${p.serverName}:${p.portNumber}`,
            id: p.id
        }));
        const selection = await vscode.window.showQuickPick(items, { placeHolder: "Select active TestBench profile" });
        if (selection) {
            await profileManager.setActiveProfileId(context, selection.id);
            vscode.window.showInformationMessage(`Profile "${selection.label}" is now active. Please use the Login command to connect.`);
            // Optionally trigger login:
            // await vscode.commands.executeCommand(allExtensionCommands.login);
        }
    });
    registerSafeCommand(context, constants_1.allExtensionCommands.deleteProfile, async () => {
        exports.logger.debug("[Cmd] Called: testbenchExtension.deleteProfile");
        const profiles = await profileManager.getProfiles(context);
        if (profiles.length === 0) {
            vscode.window.showInformationMessage("No TestBench profiles to delete.");
            return;
        }
        const items = profiles.map((p) => ({ label: p.label, description: `ID: ${p.id}`, id: p.id }));
        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: "Select TestBench profile to delete"
        });
        if (selection) {
            const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete profile "${selection.label}"?`, { modal: true }, "Delete");
            if (confirm === "Delete") {
                await profileManager.deleteProfile(context, selection.id);
                vscode.window.showInformationMessage(`Profile "${selection.label}" deleted.`);
            }
        }
    });
    // --- Command: Automatic Login After Activation ---
    registerSafeCommand(context, constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation, async () => {
        exports.logger.debug(`[Cmd] Called: ${constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation}`);
        if (getConfig().get(constants_1.ConfigKeys.AUTO_LOGIN, false)) {
            exports.logger.info("[Cmd] Auto-login is enabled. Attempting silent login with last active profile...");
            const activeProfile = await profileManager.getActiveProfile(context);
            if (!activeProfile) {
                exports.logger.info("[Cmd] Auto-login: No last active profile found. Cannot auto-login.");
                return;
            }
            const passwordIsStored = !!(await profileManager.getPasswordForProfile(context, activeProfile.id));
            const requiresPasswordAndNotStored = !passwordIsStored && getConfig().get(constants_1.ConfigKeys.STORE_PASSWORD_AFTER_LOGIN, false);
            if (requiresPasswordAndNotStored) {
                exports.logger.warn(`[Cmd] Auto-login: Password storage enabled, but no password found for active profile "${activeProfile.label}". Auto-login will likely fail if password is required.`);
            }
            else if (!getConfig().get(constants_1.ConfigKeys.STORE_PASSWORD_AFTER_LOGIN, false)) {
                exports.logger.info(`[Cmd] Auto-login: Password storage is disabled. Auto-login for profile "${activeProfile.label}" will only work if it does not require a password or server remembers session via other means.`);
            }
            if (!authProviderInstance) {
                exports.logger.error("[Cmd] Auto-login: AuthenticationProvider instance is not available.");
                return;
            }
            try {
                // Set the active profile ID so the provider can pick it up
                await profileManager.setActiveProfileId(context, activeProfile.id);
                authProviderInstance.prepareForSilentAutoLogin();
                exports.logger.trace("[Cmd] Auto-login: Calling vscode.authentication.getSession silently.");
                const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], // Your defined scopes
                { createIfNone: true } // Standard options
                );
                if (session) {
                    exports.logger.info(`[Cmd] Auto-login successful for profile: ${activeProfile.label} (session restored/created silently).`);
                    // The onDidChangeSessions listener in extension.ts will handle further setup.
                }
                else {
                    // This case might not be hit if getSession throws on silent failure.
                    exports.logger.info("[Cmd] Auto-login: No session restored/created silently. User may need to login manually.");
                }
            }
            catch (error) {
                exports.logger.warn(`[Cmd] Auto-login attempt for profile "${activeProfile.label}" failed silently (this is expected if credentials/profile are incomplete or server issues prevent silent login): ${error.message}`);
                await profileManager.clearActiveProfile(context); // Clear if auto-login fails
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
            // This will trigger TestBenchAuthenticationProvider.createSession if no session exists
            const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], // Define your scopes
            { createIfNone: true } // Prompt user to login if no session
            );
            // The onDidChangeSessions listener will handle setting up the connection object
            if (session) {
                exports.logger.info(`[Cmd] Login successful, session ID: ${session.id}`);
                // handleTestBenchSessionChange might have already run, but ensure UI is updated
                await initializeTreeViews(context); // Re-ensure trees are ready
                getProjectManagementTreeDataProvider()?.refresh(true);
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
        exports.logger.debug(`[Cmd] Called (Alternative): ${constants_1.allExtensionCommands.logout}`);
        try {
            exports.logger.debug(`[Cmd] Called: ${constants_1.allExtensionCommands.logout}`);
            // Step 1: Try to get an existing session for your provider.
            // We need the session.id to tell VS Code which session to remove.
            const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, [], // No specific scopes needed for logout, just to find the session
            { createIfNone: false, silent: true } // Do not create a new session if none exists, and don't show UI
            );
            if (session && session.id) {
                exports.logger.trace(`[Cmd] Found active TestBench session: ${session.id}. Attempting to remove via vscode.authentication.removeSession.`);
                if (authProviderInstance) {
                    await authProviderInstance.removeSession(session.id); // Call your provider's method
                    vscode.window.showInformationMessage("Logged out from TestBench.");
                }
                else {
                    exports.logger.error("[Cmd] AuthProvider instance not available for logout.");
                    vscode.window.showErrorMessage("Logout failed: Auth provider not initialized.");
                    // Fallback to manual cleanup if provider instance is somehow null
                    await handleTestBenchSessionChange(context);
                }
            }
            else {
                exports.logger.info("[Cmd] No active TestBench session found to logout. Ensuring UI is in a logged-out state.");
                // If VS Code's layer finds no session, ensure our extension's state is also cleared.
                // This is important if, for some reason, our internal state thinks we're logged in
                // but VS Code's session layer doesn't have a corresponding session.
                await handleTestBenchSessionChange(context); // This will set connection=null and update context
            }
        }
        catch (error) {
            exports.logger.error(`[Cmd] Error during logout:`, error);
            vscode.window.showErrorMessage(`TestBench Logout Error: ${error.message}`);
            // Ensure clean state on error too
            await handleTestBenchSessionChange(context);
        }
    });
    // --- Command: Handle Cycle Click ---
    // Handles the click event on a cycle element in the project management tree view.
    registerSafeCommand(context, constants_1.allExtensionCommands.handleProjectCycleClick, async (cycleItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.handleProjectCycleClick}`);
        const pmProvider = getProjectManagementTreeDataProvider();
        if (pmProvider) {
            // Clear the test theme tree and test elements tree view items before loading new data.
            // This might avoid displaying old data in the tree views if fetching fails.
            getTestThemeTreeDataProvider()?.clearTree();
            (0, testElementsTreeView_1.clearTestElementsTreeView)();
            await pmProvider.handleTestCycleClick(cycleItem);
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
        // Optionally clear the working directory before test generation.
        if (config.get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR)) {
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
        // Optionally clear the working directory before test generation.
        if (config.get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR)) {
            await vscode.commands.executeCommand(constants_1.allExtensionCommands.clearInternalTestbenchFolder);
        }
        const ttProvider = getTestThemeTreeDataProvider();
        let cycleKey = null;
        if (ttProvider) {
            cycleKey = ttProvider.getCurrentCycleKey();
            if (cycleKey) {
                exports.logger.trace(`Using cycle key '${cycleKey}' from TestThemeTreeDataProvider for test generation.`);
            }
            else {
                exports.logger.warn("TestThemeTreeDataProvider available but cycle key not set. Falling back to parent traversal.");
                // Fallback
                cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
            }
        }
        else {
            exports.logger.warn("TestThemeTreeDataProvider not available. Falling back to parent traversal for cycle key.");
            // Fallback when provider is not available
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
        await projectManagementTreeView.displayProjectManagementTreeView();
        // Hide the test theme tree view and test elements tree view
        await (0, testThemeTreeView_1.hideTestThemeTreeView)();
        await testElementsTreeView.hideTestElementsTreeView();
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
    registerSafeCommand(context, constants_1.allExtensionCommands.readAndImportTestResultsToTestbench, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.readAndImportTestResultsToTestbench}`);
        if (!exports.connection) {
            const noConnectionErrorMessage = "No connection available. Cannot import report.";
            vscode.window.showErrorMessage(noConnectionErrorMessage);
            exports.logger.error(noConnectionErrorMessage);
            return null;
        }
        await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(context);
    });
    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshProjectTreeView, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.refreshProjectTreeView} (Hard refresh)`);
        const pmProvider = getProjectManagementTreeDataProvider();
        const pTreeView = getProjectTreeView();
        if (pmProvider && pTreeView) {
            // Message update should be handled by provider via callback
            pmProvider.refresh(true); // true for hard refresh
        }
        else {
            exports.logger.warn(`Project Management Tree Data Provider or Project Tree View not initialized. Cannot refresh.`);
        }
    });
    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshTestThemeTreeView, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.refreshTestThemeTreeView}`);
        const ttProvider = getTestThemeTreeDataProvider();
        const pmProvider = getProjectManagementTreeDataProvider();
        const ttView = getTestThemeTreeViewInstance();
        if (!ttProvider) {
            exports.logger.warn("Test Theme Tree Data Provider not initialized. Cannot refresh.");
            vscode.window.showErrorMessage("Test Theme Tree is not available to refresh.");
            return;
        }
        if (!pmProvider) {
            exports.logger.warn("Project Management Tree Data Provider not initialized. Cannot refresh.");
            vscode.window.showErrorMessage("Project Management Tree is not available to refresh.");
            return;
        }
        if (!ttView) {
            exports.logger.warn("Test Theme TreeView instance is not available. Cannot set message.");
        }
        // Message update should be handled by provider via callback
        ttProvider.refresh();
        const currentCycleKey = ttProvider["_currentCycleKey"];
        if (currentCycleKey) {
            const firstRootInThemeTree = ttProvider.rootElements[0];
            const cycleElement = firstRootInThemeTree?.parent ?? undefined;
            if (cycleElement &&
                cycleElement.contextValue === constants_1.TreeItemContextValues.CYCLE &&
                cycleElement.item?.key === currentCycleKey) {
                exports.logger.info(`Refreshing Test Theme Tree for cycle: ${typeof cycleElement.label === "string" ? cycleElement.label : "N/A"}`);
                // Re-fetch children for this cycle and update the testThemeTreeDataProvider
                const children = (await pmProvider.getChildrenOfCycle(cycleElement)) ?? [];
                // The setRoots will internally call refresh on testThemeTreeDataProvider
                ttProvider.setRoots(children, cycleElement.item.key);
                const themeTreeView = getTestThemeTreeViewInstance();
                if (themeTreeView) {
                    // Check if defined
                    themeTreeView.title = `Test Themes (${typeof cycleElement.label === "string" ? cycleElement.label : "Cycle"})`;
                }
            }
            else if (currentCycleKey) {
                exports.logger.warn(`Could not find the parent cycle element for the current Test Theme Tree (cycleKey: ${currentCycleKey}). Refreshing with current roots.`);
                ttProvider.refresh(); // Re-render current items.
            }
            else {
                exports.logger.debug("No current cycle in Test Theme Tree to refresh, or provider not found. Clearing and refreshing.");
                ttProvider.clearTree(); // Calls refresh internally
            }
        }
        else {
            exports.logger.warn("Refresh Test Theme Tree: projectManagementTreeDataProvider or testThemeTreeDataProvider is null.");
            if (ttProvider) {
                ttProvider.refresh();
            } // Attempt to refresh what it has
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
        const pmProvider = getProjectManagementTreeDataProvider();
        const ttProvider = getTestThemeTreeDataProvider();
        // Check if the item belongs to the Project Management Tree
        if (treeItem.contextValue &&
            [
                constants_1.TreeItemContextValues.PROJECT,
                constants_1.TreeItemContextValues.VERSION,
                constants_1.TreeItemContextValues.CYCLE
            ].includes(treeItem.contextValue)) {
            if (pmProvider) {
                pmProvider.makeRoot(treeItem);
            }
            else {
                const makeRootNoProviderErrorMessage = "MakeRoot command called without projectManagementTreeDataProvider.";
                exports.logger.warn(makeRootNoProviderErrorMessage);
                vscode.window.showErrorMessage(makeRootNoProviderErrorMessage);
            }
        }
        // Check if the item belongs to the Test Theme Tree
        else if (ttProvider &&
            treeItem.contextValue &&
            [constants_1.TreeItemContextValues.TEST_THEME_NODE, constants_1.TreeItemContextValues.TEST_CASE_SET_NODE].includes(treeItem.contextValue)) {
            // Delegate to testThemeTreeDataProvider if it's a test theme item
            if (typeof ttProvider.makeRoot === "function") {
                ttProvider.makeRoot(treeItem);
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
        !config.get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR) // Ask for confirmation if not set to clear before test generation
        );
    });
    // --- Command: Refresh Test Elements Tree ---
    // Refreshes the test elements tree view with the latest test elements for the selected TOV.
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshTestElementsTree, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.refreshTestElementsTree}`);
        const teProvider = getTestElementsTreeDataProvider();
        if (!teProvider) {
            exports.logger.warn("Test Elements Tree Data Provider not initialized. Cannot refresh Test Elements Tree.");
            return;
        }
        const currentTovKey = teProvider.getCurrentTovKey();
        if (!currentTovKey) {
            vscode.window.showErrorMessage("No TOV key stored. Please fetch test elements first.");
            return;
        }
        await teProvider.fetchTestElements(currentTovKey);
    });
    // --- Command: Display Interactions For Selected TOV ---
    registerSafeCommand(context, constants_1.allExtensionCommands.displayInteractionsForSelectedTOV, async (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.displayInteractionsForSelectedTOV} for tree item:`, treeItem);
        const pmProvider = getProjectManagementTreeDataProvider();
        const teProvider = getTestElementsTreeDataProvider();
        // Check if the command is executed for a TOV element.
        if (pmProvider && treeItem.contextValue === constants_1.TreeItemContextValues.VERSION) {
            const tovKeyOfSelectedTreeElement = treeItem.item?.key?.toString();
            if (tovKeyOfSelectedTreeElement && teProvider) {
                const areTestElementsFetched = await teProvider.fetchTestElements(tovKeyOfSelectedTreeElement, typeof treeItem.label === "string" ? treeItem.label : undefined);
                if (areTestElementsFetched) {
                    await projectManagementTreeView.hideProjectManagementTreeView();
                    await (0, testElementsTreeView_1.displayTestElementsTreeView)();
                    const projectAndTovNameObj = (0, projectManagementTreeView_1.getProjectAndTovNamesFromSelection)(treeItem);
                    if (projectAndTovNameObj) {
                        const { projectName, tovName } = projectAndTovNameObj;
                        if (projectName && tovName) {
                            await (0, server_1.initializeLanguageServer)(projectName, tovName);
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
    registerSafeCommand(context, constants_1.allExtensionCommands.openOrCreateRobotResourceFile, async (treeItem) => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.openOrCreateRobotResourceFile} for tree item:`, treeItem);
        if (!treeItem || !treeItem.testElementData) {
            exports.logger.trace("Invalid tree item or element in Open Robot Resource File command.");
            return;
        }
        // Construct the target path based on the hierarchical name of the test element.
        const absolutePathOfSelectedTestElement = await testElementsTreeView.constructAbsolutePathForTestElement(treeItem);
        if (!absolutePathOfSelectedTestElement) {
            return;
        }
        exports.logger.trace(`Opening Robot Resource File - absolute path for test element tree item (${treeItem.testElementData.name}) resolved as: ${absolutePathOfSelectedTestElement}`);
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
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error in Open Robot Resource File command: ${error.message}`);
            exports.logger.error(`${constants_1.allExtensionCommands.openOrCreateRobotResourceFile} command failed: ${error.message}`);
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
        const teProvider = getTestElementsTreeDataProvider();
        if (!teProvider) {
            return;
        }
        // Prompt user for new interaction name
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
        // Create the new interaction
        const newInteraction = await testElementsTreeView.createInteractionUnderSubdivision(subdivisionTreeItem, interactionName);
        if (newInteraction) {
            // TODO: After the API is implemented, use the API to create the interaction on the server
            // For now, refresh the tree view to show the new interaction
            teProvider._onDidChangeTreeData.fire(undefined);
            vscode.window.showInformationMessage(`Successfully created interaction '${interactionName}'`);
            exports.logger.debug(`Created new interaction '${interactionName}' under subdivision '${subdivisionTreeItem.testElementData.name}'`);
        }
    });
    // --- Command: Open Issue Reporter ---
    // Opens the official VS Code issue reporter, where the extension is preselected.
    registerSafeCommand(context, constants_1.allExtensionCommands.openIssueReporter, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.openIssueReporter}`);
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench-visual-studio-code-extension"
        });
    });
    // --- Command: Modify Report With Results Zip ---
    // Allows the user to select a report zip file and create a new report by removing JSON files that were not selected in the quick pick from the original report zip.
    registerSafeCommand(context, constants_1.allExtensionCommands.modifyReportWithResultsZip, async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.modifyReportWithResultsZip}`);
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
        const zipPath = zipUris[0].fsPath;
        const quickPickItems = await reportHandler.getQuickPickItemsFromReportZipWithResults(zipPath);
        // Then call your quick pick function with the retrieved items.
        const chosenQuickPickItems = await reportHandler.showMultiSelectQuickPick(quickPickItems);
        exports.logger.log("Trace", "User selected following json files:", chosenQuickPickItems);
        // Create a new zip file by removing JSON files that were not selected from the original report zip.
        await reportHandler.createNewReportWithSelectedItems(zipPath, chosenQuickPickItems);
    });
    // Set context value for connectionActive.
    // Used to enable or disable the login and logout buttons in the status bar,
    // which allows icon changes for login/logout buttons based on connectionActive variable.
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, exports.connection !== null);
    exports.logger.trace(`Context value connectionActive set to: ${exports.connection !== null}`);
}
/**
 * Handles changes in the TestBench authentication session.
 *
 * This function is responsible for updating the application state based on the
 * provided or retrieved authentication session. It will:
 * - Attempt to retrieve an active session if one is not provided.
 * - If a session is active and an active profile exists:
 *   - Initialize a `PlayServerConnection` with the session token and profile details.
 *   - Set the `ContextKeys.CONNECTION_ACTIVE` to true.
 *   - Refresh relevant tree views and update the login webview.
 * - If a session is active but no active profile is found:
 *   - Clear any existing connection and log out the user from the server.
 *   - Set `ContextKeys.CONNECTION_ACTIVE` to false.
 *   - Clear tree views and update the login webview.
 * - If no session is active:
 *   - Clear any existing connection and log out the user from the server.
 *   - Set `ContextKeys.CONNECTION_ACTIVE` to false.
 *   - Clear tree views and update the login webview.
 *
 * @param context - The VS Code extension context.
 * @param existingSession - An optional existing authentication session to process.
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
    const wasPreviouslyConnected = !!exports.connection; // Check connection state before potential changes
    if (sessionToProcess && sessionToProcess.accessToken) {
        const activeProfile = await profileManager.getActiveProfile(context);
        if (activeProfile) {
            exports.logger.info(`[Extension] TestBench session active for profile: ${activeProfile.label}. Initializing PlayServerConnection.`);
            const newConnection = new testBenchConnection_1.PlayServerConnection(activeProfile.serverName, activeProfile.portNumber, activeProfile.username, sessionToProcess.accessToken);
            setConnection(newConnection); // Set the global connection
            await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, true);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
            if (!wasPreviouslyConnected) {
                // This is a new login session (e.g., startup auto-login, or manual login from disconnected state)
                exports.logger.info("[Extension] New session established. Setting default view to 'Projects' and refreshing data.");
                // Set the correct view visibility
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.displayAllProjects);
                // Refresh/clear data
                getProjectManagementTreeDataProvider()?.refresh(true); // Hard refresh for projects  
                getTestThemeTreeDataProvider()?.clearTree();
                (0, testElementsTreeView_1.clearTestElementsTreeView)();
            }
            else {
                // Session changed while already connected (e.g., profile switch if supported, or token refresh)
                // For a profile switch, resetting to Projects view is also a good default.
                exports.logger.info("[Extension] Session changed while already connected. Resetting view to 'Projects' and refreshing data.");
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.displayAllProjects);
                getProjectManagementTreeDataProvider()?.refresh(true);
                getTestThemeTreeDataProvider()?.clearTree();
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
            // Clean up views and data on logout/no active profile
            await projectManagementTreeView.hideProjectManagementTreeView();
            await (0, testThemeTreeView_1.hideTestThemeTreeView)();
            await testElementsTreeView.hideTestElementsTreeView();
            getProjectManagementTreeDataProvider()?.clearTree();
            getTestThemeTreeDataProvider()?.clearTree();
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
        // Clean up views and data on logout
        await projectManagementTreeView.hideProjectManagementTreeView();
        await (0, testThemeTreeView_1.hideTestThemeTreeView)();
        await testElementsTreeView.hideTestElementsTreeView();
        getProjectManagementTreeDataProvider()?.clearTree();
        getTestThemeTreeDataProvider()?.clearTree();
        (0, testElementsTreeView_1.clearTestElementsTreeView)();
    }
}
/**
 * Updates the context for the Language Server and triggers a restart.
 * @param {string} projectName (Optional) The name of the selected project.
 * @param {string} tovName (Optional) The name of the selected TOV.
 */
async function updateLanguageServerContextAndRestart(projectName, tovName) {
    const projectChanged = currentLanguageServerProject !== projectName;
    const tovChanged = currentLanguageServerTov !== tovName;
    if (projectChanged || tovChanged) {
        exports.logger.info(` Project name or TOV name changed.
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
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function activate(context) {
    // Initialize logger.
    exports.logger = new testBenchLogger.TestBenchLogger();
    exports.logger.info("Extension activated.");
    // Initialize with the best scope
    activeEditor = vscode.window.activeTextEditor;
    // Initialize with global scope by default
    currentConfigScope = undefined;
    // Respond to configuration changes in the extension settings.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(constants_1.baseKeyOfExtension)) {
            await loadConfiguration(context);
            exports.logger.info("Configuration updated after changes were detected.");
        }
    }));
    // Respond to changes in the active text editor to automatically update the configuration scope.
    // This is useful for multi-root workspaces where the user may switch between different folders.
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        activeEditor = editor;
        await loadConfiguration(context); // Automatically update config when editor changes
    }));
    // Load initial configuration
    await loadConfiguration(context);
    // Register AuthenticationProvider
    authProviderInstance = new testBenchAuthenticationProvider_1.TestBenchAuthenticationProvider(context);
    context.subscriptions.push(vscode.authentication.registerAuthenticationProvider(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_LABEL, // User-facing name in Accounts UI
    authProviderInstance, { supportsMultipleAccounts: false } // Change to true to support multiple simultaneous TestBench logins
    ));
    exports.logger.info("TestBenchAuthenticationProvider registered.");
    // Session Change Listener
    context.subscriptions.push(vscode.authentication.onDidChangeSessions(async (e) => {
        if (e.provider.id === testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID) {
            exports.logger.info("[Extension] TestBench authentication sessions changed.");
            await handleTestBenchSessionChange(context);
        }
    }));
    initializeTreeViews(context);
    // Set the initial connection context state. Before any login attempt, connection is null.
    // VS Code will show/hide views based on this initial state matching the 'when' clauses in package.json
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, exports.connection !== null);
    exports.logger.trace(`Initial connectionActive context set to: ${exports.connection !== null}`);
    // Register the login webview provider.
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    // Register all extension commands.
    await registerExtensionCommands(context);
    // Attempt to restore session on activation
    // Try to get an existing session without creating one.
    exports.logger.trace("[Extension] Attempting to silently restore existing TestBench session on activation...");
    try {
        const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: false, // Dont trigger createSession yet
            silent: true // Try to get silently
        });
        if (session) {
            exports.logger.info("[Extension] Found existing VS Code AuthenticationSession for TestBench during initial check.");
            await handleTestBenchSessionChange(context, session);
        }
        else {
            exports.logger.info("[Extension] No existing TestBench session found during initial check.");
            // If auto-login is enabled, it will be triggered next.
            // If not, user needs to login manually.
            // Ensure UI reflects logged-out state if no session and no auto-login.
            if (!getConfig().get(constants_1.ConfigKeys.AUTO_LOGIN, false)) {
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
    // This will happen *after* the initial silent check for an existing session.
    if (getConfig().get(constants_1.ConfigKeys.AUTO_LOGIN, false)) {
        exports.logger.info("[Extension] Auto-login configured. Triggering automatic login command.");
        // Dont use await, to block the login webview display, let it run in background
        vscode.commands
            .executeCommand(constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation)
            .then(undefined, (err) => {
            exports.logger.error("[Extension] Error triggering auto-login command during activation:", err);
        });
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
        // Gracefully log out the user when the extension is deactivated.
        if (exports.connection) {
            exports.logger.info("[Extension] Performing server logout on deactivation.");
            await exports.connection.logoutUserOnServer();
            setConnection(null);
        }
        // Stop the language server
        if (server_1.client) {
            await server_1.client?.stop();
            exports.logger.info("[Extension] Language server stopped.");
        }
        exports.logger.info("Extension deactivated.");
    }
    catch (error) {
        exports.logger.error("Error during deactivation:", error);
    }
}
//# sourceMappingURL=extension.js.map