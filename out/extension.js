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
exports.testElementsTreeDataProvider = exports.projectTreeView = exports.testElementTreeView = exports.loginWebViewProvider = exports.connection = exports.projectManagementTreeDataProvider = exports.logger = exports.folderNameOfTestbenchWorkingDirectory = exports.allExtensionCommands = exports.baseKeyOfExtension = void 0;
exports.getConfig = getConfig;
exports.setProjectManagementTreeDataProvider = setProjectManagementTreeDataProvider;
exports.setConnection = setConnection;
exports.setProjectTreeView = setProjectTreeView;
exports.getTestElementsTreeDataProvider = getTestElementsTreeDataProvider;
exports.safeCommandHandler = safeCommandHandler;
exports.promptForWorkspaceLocation = promptForWorkspaceLocation;
exports.loadConfiguration = loadConfiguration;
exports.initializeTreeViews = initializeTreeViews;
exports.activate = activate;
exports.deactivate = deactivate;
// TODO: If possible, hide the tree views initially instead of creating them and then hiding them after.
// TODO: The user generated tests, executed the tests, and restarted he extension. Last generated test params are now invalid due to restart, and he cant import.
// Before releasing the extension:
// TODO: Add License.md to the extension
// TODO: Set logger level to info or debug in production, remove too detailed logs.
// TODO: In production, remove process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; in connection class.
const vscode = __importStar(require("vscode"));
const testBenchLogger = __importStar(require("./testBenchLogger"));
const testBenchConnection = __importStar(require("./testBenchConnection"));
const reportHandler = __importStar(require("./reportHandler"));
const projectManagementTreeView = __importStar(require("./projectManagementTreeView"));
const testElementsTreeView = __importStar(require("./testElementsTreeView"));
const loginWebView = __importStar(require("./loginWebView"));
const utils = __importStar(require("./utils"));
const path_1 = __importDefault(require("path"));
/* =============================================================================
   Constants, Global Variables & Exports
   ============================================================================= */
/** Prefix of the extension commands and settings in package.json*/
exports.baseKeyOfExtension = "testbenchExtension";
/** Workspace configuration for the extension. */
let config = vscode.workspace.getConfiguration(exports.baseKeyOfExtension);
function getConfig() {
    return config;
}
/**
 * All extension commands (as defined in package.json) to avoid typos.
 * Each command can be extended later with additional metadata such as description.
 */
exports.allExtensionCommands = {
    displayCommand: { command: `${exports.baseKeyOfExtension}.displayCommands` },
    login: { command: `${exports.baseKeyOfExtension}.login` },
    logout: { command: `${exports.baseKeyOfExtension}.logout` },
    generateTestCasesForCycle: {
        command: `${exports.baseKeyOfExtension}.generateTestCasesForCycle`
    },
    generateTestCasesForTestThemeOrTestCaseSet: {
        command: `${exports.baseKeyOfExtension}.generateTestCasesForTestThemeOrTestCaseSet`
    },
    readRFTestResultsAndCreateReportWithResults: {
        command: `${exports.baseKeyOfExtension}.readRFTestResultsAndCreateReportWithResults`
    },
    makeRoot: { command: `${exports.baseKeyOfExtension}.makeRoot` },
    getServerVersions: { command: `${exports.baseKeyOfExtension}.getServerVersions` },
    showExtensionSettings: {
        command: `${exports.baseKeyOfExtension}.showExtensionSettings`
    },
    fetchReportForSelectedTreeItem: {
        command: `${exports.baseKeyOfExtension}.fetchReportForSelectedTreeItem`
    },
    selectAndLoadProject: {
        command: `${exports.baseKeyOfExtension}.selectAndLoadProject`
    },
    uploadTestResultsToTestbench: {
        command: `${exports.baseKeyOfExtension}.uploadTestResultsToTestbench`
    },
    readAndUploadTestResultsToTestbench: {
        command: `${exports.baseKeyOfExtension}.readAndUploadTestResultsToTestbench`
    },
    executeRobotFrameworkTests: {
        command: `${exports.baseKeyOfExtension}.executeRobotFrameworkTests`
    },
    refreshProjectTreeView: {
        command: `${exports.baseKeyOfExtension}.refreshProjectTreeView`
    },
    refreshTestThemeTreeView: {
        command: `${exports.baseKeyOfExtension}.refreshTestThemeTreeView`
    },
    setWorkspaceLocation: {
        command: `${exports.baseKeyOfExtension}.setWorkspaceLocation`
    },
    clearWorkspaceFolder: {
        command: `${exports.baseKeyOfExtension}.clearWorkspaceFolder`
    },
    toggleProjectManagementTreeViewVisibility: {
        command: `${exports.baseKeyOfExtension}.toggleProjectManagementTreeViewVisibility`
    },
    toggleTestThemeTreeViewVisibility: {
        command: `${exports.baseKeyOfExtension}.toggleTestThemeTreeViewVisibility`
    },
    toggleWebViewVisibility: {
        command: `${exports.baseKeyOfExtension}.toggleWebViewVisibility`
    },
    automaticLoginAfterExtensionActivation: {
        command: `${exports.baseKeyOfExtension}.automaticLoginAfterExtensionActivation`
    },
    refreshTestElementsTree: {
        command: `${exports.baseKeyOfExtension}.refreshTestElementsTree`
    },
    displayInteractionsForSelectedTOV: {
        command: `${exports.baseKeyOfExtension}.displayInteractionsForSelectedTOV`
    },
    openRobotResourceFile: { command: `${exports.baseKeyOfExtension}.openRobotResourceFile` },
    changeConfigScope: { command: `${exports.baseKeyOfExtension}.changeConfigScope` },
    createInteractionUnderSubdivision: { command: `${exports.baseKeyOfExtension}.createInteractionUnderSubdivision` },
    openIssueReporter: { command: `${exports.baseKeyOfExtension}.openIssueReporter` }
};
/** Name of the working folder (inside the workspace folder) used by TestBench to store and process files internally. */
exports.folderNameOfTestbenchWorkingDirectory = ".testbench";
/** Global project management tree data provider. */
exports.projectManagementTreeDataProvider = null;
function setProjectManagementTreeDataProvider(newProjectManagementTreeDataProvider) {
    exports.projectManagementTreeDataProvider = newProjectManagementTreeDataProvider;
}
/** Global connection to the (new) TestBench Play server. */
exports.connection = null;
function setConnection(newConnection) {
    exports.connection = newConnection;
}
/** Global login webview provider instance. */
exports.loginWebViewProvider = null;
function setProjectTreeView(newProjectTreeView) {
    exports.projectTreeView = newProjectTreeView;
}
function getTestElementsTreeDataProvider() {
    return exports.testElementsTreeDataProvider;
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
 * @param {string} commandId The command ID.
 * @param {(...args: any[]) => any} callback The command handler.
 */
function registerSafeCommand(context, commandId, callback) {
    const disposable = vscode.commands.registerCommand(commandId, safeCommandHandler(callback));
    // Adding the command to the context subscriptions disposes them automatically when the extension is deactivated.
    context.subscriptions.push(disposable);
}
/**
 * Prompts the user to select a workspace location (folder).
 *
 * @returns {Promise<string | undefined>} The selected folder path, or undefined if none selected.
 */
async function promptForWorkspaceLocation() {
    exports.logger.debug("Prompting user to select a workspace location.");
    const options = {
        canSelectMany: false,
        openLabel: "Select Workspace Location",
        canSelectFolders: true,
        canSelectFiles: false,
        title: "Select Workspace Location"
    };
    const folderUris = await vscode.window.showOpenDialog(options);
    if (folderUris && folderUris[0]) {
        exports.logger.debug(`Workspace location selected: ${folderUris[0].fsPath}`);
        return folderUris[0].fsPath;
    }
    exports.logger.debug("No workspace location selected.");
    return undefined;
}
/**
 * Returns the best configuration scope based on the current context.
 * If a workspace folder is available, its URI is returned.
 * If multiple workspace folders are available, the user is prompted to choose one.
 * If no workspace folder is available, undefined is returned.
 *
 * @returns {Promise<vscode.Uri | undefined>} The URI of the best configuration scope, or undefined if none available.
 */
async function getBestConfigScope() {
    // Prefer active editor's folder
    if (vscode.window.activeTextEditor) {
        return vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri;
    }
    // For multi-root workspaces or when no editor is active
    if (vscode.workspace.workspaceFolders?.length) {
        // Create quick pick items for all workspace folders + global option
        const items = [
            {
                label: "$(globe) Global Settings",
                description: "Use user-level configuration"
            },
            ...vscode.workspace.workspaceFolders.map((folder) => ({
                label: `$(folder) ${folder.name}`,
                description: folder.uri.fsPath,
                folder // Store reference to the actual folder
            }))
        ];
        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: "Select configuration scope",
            ignoreFocusOut: true
        });
        // Return undefined for global, folder URI for workspace selection
        return picked?.folder?.uri;
    }
    // Single folder or no folder - default to global (undefined)
    return undefined;
}
let currentConfigScope;
// Initialize status item
const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
/*
 * Updates the status bar item to display the current configuration source.
 */
function updateConfigSourceDisplay() {
    const folderName = currentConfigScope
        ? vscode.workspace.getWorkspaceFolder(currentConfigScope)?.name
        : "Global Settings";
    statusItem.text = `TestBench Config: ${currentConfigScope ? "$(folder-active)" : "$(globe)"} ${folderName}`;
    statusItem.tooltip = currentConfigScope
        ? `Workspace: ${currentConfigScope.fsPath}\nClick to change configuration scope`
        : "Using global user settings\nClick to change configuration scope";
    statusItem.command = `${exports.baseKeyOfExtension}.changeConfigScope`;
    statusItem.show();
}
/**
 * Loads the latest extension configuration and updates the global configuration object.
 * Also handles the storage of credentials based on the configuration settings.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function loadConfiguration(context) {
    // Update the configuration object with the latest values.
    // Without this, the configuration changes may not be updated and old values may be used.
    config = vscode.workspace.getConfiguration(exports.baseKeyOfExtension, currentConfigScope);
    updateConfigSourceDisplay();
    // Log the configuration source for debugging
    const configSource = currentConfigScope
        ? `workspace folder: ${vscode.workspace.getWorkspaceFolder(currentConfigScope)?.name}`
        : "global (no workspace)";
    exports.logger.trace(`Loading configuration from ${configSource}`);
    // Update the log level based on the new configuration.
    exports.logger.updateCachedLogLevel();
    // If storePassword is set to false, delete the stored password immediately.
    // If storePassword is set to true, the password is only stored after a successful login.
    if (!config.get("storePasswordAfterLogin", false)) {
        await testBenchConnection?.clearStoredCredentials(context);
    }
    // Update the webview input fields after extension settings are changed to reflect the changes in the webview live
    exports.loginWebViewProvider?.updateWebviewContent();
}
function initializeProjectManagementTreeView() {
    exports.projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(null);
    exports.projectTreeView = vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: exports.projectManagementTreeDataProvider
    });
}
function initializeTestElementsTreeView() {
    exports.testElementsTreeDataProvider = new testElementsTreeView.TestElementsTreeDataProvider();
    exports.testElementTreeView = vscode.window.createTreeView("testElementsView", {
        treeDataProvider: exports.testElementsTreeDataProvider
    });
    vscode.window.registerTreeDataProvider("testElementsView", exports.testElementsTreeDataProvider);
    // Hide the test elements tree view initially.
    testElementsTreeView.hideTestElementsTreeView();
}
/**
 * Initializes the project tree and test elements tree.
 */
function initializeTreeViews() {
    initializeProjectManagementTreeView();
    initializeTestElementsTreeView();
}
/**
 * Registers all the commands defined by the extension.
 *
 * @param context The extension context.
 */
function registerExtensionCommands(context) {
    // --- Command: Change Configuration Scope ---
    registerSafeCommand(context, exports.allExtensionCommands.changeConfigScope.command, async () => {
        const newScope = await getBestConfigScope();
        if (newScope !== undefined || currentConfigScope !== undefined) {
            currentConfigScope = newScope;
            await loadConfiguration(context);
            vscode.window.showInformationMessage(`Configuration scope updated to ${currentConfigScope ? vscode.workspace.getWorkspaceFolder(currentConfigScope)?.name : "Global"}`);
        }
    });
    // --- Command: Toggle Login Webview Visibility ---
    registerSafeCommand(context, exports.allExtensionCommands.toggleWebViewVisibility.command, loginWebView.toggleWebViewVisibility);
    // --- Command: Set Workspace Location ---
    // Prompts the user to select a workspace location and updates the workspace configuration with the selected path.
    registerSafeCommand(context, `${exports.baseKeyOfExtension}.setWorkspaceLocation`, async () => {
        exports.logger.debug("Set Workspace Location command called.");
        const newWorkspaceLocation = await promptForWorkspaceLocation();
        if (newWorkspaceLocation) {
            await config.update("workspaceLocation", newWorkspaceLocation);
            vscode.window.showInformationMessage(`Workspace location set to: ${newWorkspaceLocation}`);
            exports.logger.debug(`Workspace location set to: ${newWorkspaceLocation}`);
        }
        exports.logger.trace("End of Set Workspace Location command.");
    });
    // --- Command: Show Extension Settings ---
    registerSafeCommand(context, exports.allExtensionCommands.showExtensionSettings.command, async () => {
        exports.logger.debug("Show Extension Settings command called.");
        // Open the settings with the extension filter.
        await vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-visual-studio-code-extension"
        });
        // Open the workspace settings view (The default settings view is user settings)
        await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
        exports.logger.trace("End of Show Extension Settings command.");
    });
    // --- Command: Automatic Login After Activation ---
    registerSafeCommand(context, exports.allExtensionCommands.automaticLoginAfterExtensionActivation.command, async () => {
        // If auto login is active and the password is stored in the secrets, perform the login automatically.
        if (config.get("automaticLoginAfterExtensionActivation", false) &&
            config.get("storePasswordAfterLogin", false) &&
            (await context.secrets.get("password")) !== undefined) {
            exports.logger.debug("Performing automatic login.");
            const loginResult = await testBenchConnection?.performLogin(context, false, true);
            if (loginResult) {
                // If login was successful, display project selection dialog and the project management tree view.
                projectManagementTreeView?.displayProjectManagementTreeView();
                vscode.commands.executeCommand(exports.allExtensionCommands.selectAndLoadProject.command);
            }
        }
        else {
            exports.logger.trace("Automatic login is disabled or password is not stored.");
        }
    });
    // --- Command: Login ---
    // Prevent multiple login processes from running simultaneously.
    let isLoginProcessAlreadyRunning = false;
    // Performs the login process and stores the connection object.
    registerSafeCommand(context, exports.allExtensionCommands.login.command, async () => {
        exports.logger.debug("Login command called.");
        if (isLoginProcessAlreadyRunning) {
            exports.logger.debug("Login process already running, aborting login.");
            // If (somehow) login flag is stuck and set to true,
            // reset the flag after 5 seconds to prevent a deadlock.
            setTimeout(() => {
                isLoginProcessAlreadyRunning = false;
                exports.logger.trace("isLoginProcessAlreadyRunning flag reset to false after 5 seconds.");
            }, 5000);
            return;
        }
        isLoginProcessAlreadyRunning = true;
        try {
            const performLoginResult = await testBenchConnection.performLogin(context);
            // If login was successful, display project selection dialog and the project management tree view.
            if (performLoginResult) {
                await vscode.commands.executeCommand(exports.allExtensionCommands.selectAndLoadProject.command);
            }
        }
        catch (error) {
            exports.logger.error(`Login process failed: ${error}`);
        }
        finally {
            // Release the lock after login attempt.
            isLoginProcessAlreadyRunning = false;
            exports.logger.trace("isLoginProcessAlreadyRunning flag is reset to false after login attempt.");
        }
        exports.logger.trace("End of Login command.");
    });
    // --- Command: Logout ---
    // Performs the logout process, clears the connection object and shows the login webview.
    registerSafeCommand(context, exports.allExtensionCommands.logout.command, async () => {
        exports.logger.debug("Logout command called.");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn("Logout command called without connection.");
            return;
        }
        await exports.connection.logoutUser(exports.projectManagementTreeDataProvider);
        // Show the login webview and hide the tree views after logout.
        loginWebView.displayWebView();
        projectManagementTreeView.hideProjectManagementTreeView();
        projectManagementTreeView.hideTestThemeTreeView();
        testElementsTreeView.hideTestElementsTreeView();
        exports.logger.trace("End of Logout command.");
    });
    // --- Command: Generate Test Cases For Cycle ---
    // Generates test cases for the selected cycle in the project management tree view.
    registerSafeCommand(context, exports.allExtensionCommands.generateTestCasesForCycle.command, async (item) => {
        exports.logger.debug("Generate Test Cases For Cycle command called.");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn("generateTestCasesForCycle command called without connection.");
            return;
        }
        if (!exports.projectManagementTreeDataProvider) {
            vscode.window.showErrorMessage("Project management tree is not initialized. Please select a project first.");
            exports.logger.warn("generateTestCasesForCycle command called without project data provider.");
            return;
        }
        // Optionally clear the working directory before test generation.
        if (config.get("clearWorkingDirectoryBeforeTestGeneration")) {
            await vscode.commands.executeCommand(exports.allExtensionCommands.clearWorkspaceFolder.command);
        }
        // If the user did not clicked on a test cycle in the tree view before,
        // the test cycle wont have any initialized children so that test themes cannot be displayed in the quickpick.
        // Call getChildrenOfCycle to initialize the sub elements (Test themes etc.) of the cycle.
        // Offload the children of the cycle to the Test Theme Tree View.
        if (exports.projectManagementTreeDataProvider?.testThemeDataProvider) {
            const children = (await exports.projectManagementTreeDataProvider.getChildrenOfCycle(item)) ?? [];
            exports.projectManagementTreeDataProvider.testThemeDataProvider.setRoots(children);
        }
        await reportHandler.startTestGenerationForCycle(context, item, exports.folderNameOfTestbenchWorkingDirectory);
        exports.logger.trace("End of Generate Test Cases For Cycle command.");
    });
    // --- Command: Fetch Report for Selected Tree Item ---
    registerSafeCommand(context, exports.allExtensionCommands.fetchReportForSelectedTreeItem.command, async (treeItem) => {
        await reportHandler.fetchReportForTreeElement(treeItem, exports.projectManagementTreeDataProvider, exports.folderNameOfTestbenchWorkingDirectory);
    });
    // --- Command: Generate Test Cases For Test Theme or Test Case Set ---
    registerSafeCommand(context, exports.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet.command, async (treeItem) => {
        exports.logger.debug("Generate Test Cases For Test Theme or Test Case Set command called.");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn("generateTestCasesForTestThemeOrTestCaseSet command called without connection.");
            return;
        }
        // Optionally clear the working directory before test generation.
        if (config.get("clearWorkingDirectoryBeforeTestGeneration")) {
            await vscode.commands.executeCommand(exports.allExtensionCommands.clearWorkspaceFolder.command);
        }
        await reportHandler.generateRobotFrameworkTestsForTestThemeOrTestCaseSet(context, treeItem, exports.folderNameOfTestbenchWorkingDirectory);
        exports.logger.trace("End of Generate Test Cases For Test Theme or Test Case Set command.");
    });
    // --- Command: Select And Load Project ---
    // Fetches the projects list from the server and prompts the user to select a project to display its contents in the tree view.
    registerSafeCommand(context, exports.allExtensionCommands.selectAndLoadProject.command, async () => {
        exports.logger.debug("Select And Load Project command called.");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn("selectAndLoadProject command called without connection.");
            return;
        }
        const projectList = await exports.connection.getProjectsList();
        if (!projectList) {
            exports.logger.warn("No projects found for selectAndLoadProject command.");
            return;
        }
        const selectedProjectKey = await exports.connection.getProjectKeyFromProjectListQuickPickSelection(projectList);
        if (!selectedProjectKey) {
            exports.logger.warn("No project selected for selectAndLoadProject command.");
            return;
        }
        exports.projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(selectedProjectKey);
        exports.projectTreeView = vscode.window.createTreeView("projectManagementTree", {
            treeDataProvider: exports.projectManagementTreeDataProvider
        });
        // Initialize and display the project management tree view with the selected project.
        [exports.projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeViews(context, exports.connection, selectedProjectKey);
        // After selecting a (new) project, hide the test theme tree view and test elements tree view and clear the test elements tree view.
        projectManagementTreeView.hideTestThemeTreeView();
        testElementsTreeView.hideTestElementsTreeView();
        testElementsTreeView.clearTestElementsTreeView();
        exports.logger.trace(`Project with key ${selectedProjectKey} loaded into project management tree view.`);
    });
    // --- Command: Toggle Project Management Tree View Visibility ---
    registerSafeCommand(context, exports.allExtensionCommands.toggleProjectManagementTreeViewVisibility.command, async () => {
        await projectManagementTreeView.toggleProjectManagementTreeViewVisibility();
    });
    // --- Command: Toggle Test Theme Tree View Visibility ---
    registerSafeCommand(context, exports.allExtensionCommands.toggleTestThemeTreeViewVisibility.command, async () => {
        await projectManagementTreeView.toggleTestThemeTreeViewVisibility();
    });
    // --- Command: Read Robotframework Test Results And Create Report With Results ---
    // Activated for a test theme or test case set element.
    // Reads the test results (output.xml) from the testbench working directory and creates a report zip file with the results.
    registerSafeCommand(context, exports.allExtensionCommands.readRFTestResultsAndCreateReportWithResults.command, async () => {
        exports.logger.debug("Read RF Test Results And Create Report With Results command called.");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn("readRFTestResultsAndCreateReportWithResults command called without connection.");
            return;
        }
        await reportHandler.fetchTestResultsAndCreateReportWithResultsWithTb2Robot(context, exports.folderNameOfTestbenchWorkingDirectory);
        exports.logger.trace("End of Read RF Test Results And Create Report With Results command.");
    });
    // --- Command: Upload Test Results To Testbench ---
    // Uploads the selected test results zip to the testbench server
    registerSafeCommand(context, exports.allExtensionCommands.uploadTestResultsToTestbench.command, async () => {
        exports.logger.debug("Upload Test Results To Testbench command called.");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn("uploadTestResultsToTestbench command called without connection.");
            return;
        }
        if (!exports.projectManagementTreeDataProvider || !exports.projectManagementTreeDataProvider.currentProjectKeyInView) {
            vscode.window.showErrorMessage("No project selected. Please select a project first.");
            exports.logger.warn("uploadTestResultsToTestbench command called without a selected project.");
            return;
        }
        await testBenchConnection.selectReportWithResultsAndImportToTestbench(exports.connection, exports.projectManagementTreeDataProvider);
        exports.logger.trace("End of Upload Test Results To Testbench command.");
    });
    // --- Command: Read And Upload Test Results To Testbench ---
    // A command that combines the read and upload test results commands.
    registerSafeCommand(context, exports.allExtensionCommands.readAndUploadTestResultsToTestbench.command, async () => {
        exports.logger.debug("Read And Upload Test Results To Testbench command called.");
        await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(context, exports.folderNameOfTestbenchWorkingDirectory, exports.projectManagementTreeDataProvider);
        exports.logger.trace("End of Read And Upload Test Results To Testbench command.");
    });
    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, exports.allExtensionCommands.refreshProjectTreeView.command, async () => {
        exports.logger.debug("Refresh Project Tree command called.");
        [exports.projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeViews(context, exports.connection, exports.projectManagementTreeDataProvider?.currentProjectKeyInView ?? undefined // Instead of null, return undefined
        );
        exports.logger.trace("End of Refresh Project Tree command.");
    });
    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, exports.allExtensionCommands.refreshTestThemeTreeView.command, async () => {
        exports.logger.debug("Refresh Test Theme Tree command called.");
        exports.projectManagementTreeDataProvider?.testThemeDataProvider.refresh();
        const cycleElement = exports.projectManagementTreeDataProvider?.testThemeDataProvider?.rootElements[0]?.parent ?? undefined;
        if (cycleElement && cycleElement.contextValue === "Cycle") {
            // Fetch the test themes etc. from the server
            const children = (await exports.projectManagementTreeDataProvider?.getChildrenOfCycle(cycleElement)) ?? [];
            exports.projectManagementTreeDataProvider?.testThemeDataProvider?.setRoots(children);
        }
        exports.logger.trace("End of Refresh Test Theme Tree command.");
    });
    // --- Command: Make Root ---
    // Right clicking on a tree element and selecting "Make Root" context menu option will make the selected element the root of the tree.
    registerSafeCommand(context, exports.allExtensionCommands.makeRoot.command, (treeItem) => {
        exports.logger.debug("Make Root command called for tree item:", treeItem);
        if (exports.projectManagementTreeDataProvider) {
            // Find out for which element type the make root command is called
            if (treeItem.contextValue && ["Project", "Version", "Cycle"].includes(treeItem.contextValue)) {
                exports.projectManagementTreeDataProvider.makeRoot(treeItem);
            }
            else {
                exports.projectManagementTreeDataProvider.testThemeDataProvider.makeRoot(treeItem);
            }
        }
        exports.logger.trace("End of Make Root command.");
    });
    // --- Command: Clear Workspace Folder ---
    // Clears the workspace folder of its contents, excluding log files.
    registerSafeCommand(context, exports.allExtensionCommands.clearWorkspaceFolder.command, async () => {
        exports.logger.debug("Clear Workspace Folder command called.");
        const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return;
        }
        const testbenchWorkingDirectoryPath = path_1.default.join(workspaceLocation, exports.folderNameOfTestbenchWorkingDirectory);
        await utils.clearWorkspaceFolder(testbenchWorkingDirectoryPath, [testBenchLogger.folderNameOfLogs], // Exclude log files from deletion
        !config.get("clearWorkingDirectoryBeforeTestGeneration") // Ask for confirmation if not set to clear before test generation
        );
        exports.logger.trace("End of Clear Workspace Folder command.");
    });
    // --- Command: Refresh Test Elements Tree ---
    // Refreshes the test elements tree view with the latest test elements for the selected TOV.
    registerSafeCommand(context, exports.allExtensionCommands.refreshTestElementsTree.command, async () => {
        exports.logger.debug("Refresh Test Elements Tree command called.");
        const currentTovKey = testElementsTreeView.getCurrentTovKey();
        if (!currentTovKey) {
            vscode.window.showErrorMessage("No TOV key stored. Please fetch test elements first.");
            return;
        }
        await exports.testElementsTreeDataProvider.fetchAndDisplayTestElements(currentTovKey);
    });
    // --- Command: Display Interactions For Selected TOV ---
    registerSafeCommand(context, exports.allExtensionCommands.displayInteractionsForSelectedTOV.command, async (treeItem) => {
        exports.logger.debug("Display Interactions For Selected TOV command called for tree item:", treeItem);
        // Check if the command is executed for a TOV element.
        if (exports.projectManagementTreeDataProvider && treeItem.contextValue === "Version") {
            const tovKeyOfSelectedTreeElement = treeItem.item?.key?.toString();
            if (tovKeyOfSelectedTreeElement) {
                await exports.testElementsTreeDataProvider.fetchAndDisplayTestElements(tovKeyOfSelectedTreeElement, typeof treeItem.label === "string" ? treeItem.label : undefined);
            }
        }
        exports.logger.trace("End of Display Interactions For Selected TOV command.");
    });
    // --- Command: Open Robot Resource File ---
    // Opens or creates the file in the workspace corresponding to the selected test element.
    registerSafeCommand(context, exports.allExtensionCommands.openRobotResourceFile.command, async (treeItem) => {
        if (!treeItem || !treeItem.testElementData) {
            exports.logger.trace("Invalid tree item or element in Open Robot Resource File command.");
            return;
        }
        // Construct the target path based on the hierarchical name of the test element.
        const absolutePathOfTestElement = await testElementsTreeView.constructAbsolutePathForTestElement(treeItem);
        if (!absolutePathOfTestElement) {
            return;
        }
        exports.logger.trace(`Open Robot Resource File command created absolutePathOfTestElement: ${absolutePathOfTestElement}`);
        try {
            switch (treeItem.testElementData.elementType) {
                case "Subdivision":
                    await testElementsTreeView.handleSubdivision(treeItem);
                    break;
                case "Interaction":
                    await testElementsTreeView.handleInteraction(treeItem);
                    break;
                default:
                    await testElementsTreeView.handleFallback(absolutePathOfTestElement);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage("Error in Open Robot Resource File command: " + error.message);
            exports.logger.error("Error in Open Robot Resource File command:", error);
        }
    });
    // --- Command: Create Interaction Under Subdivision ---
    // Creates a new interaction tree element under the selected subdivision.
    registerSafeCommand(context, exports.allExtensionCommands.createInteractionUnderSubdivision.command, async (subdivisionTreeItem) => {
        exports.logger.debug("Create Interaction Under Subdivision command called.");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn("createInteractionUnderSubdivision command called without connection.");
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
            exports.testElementsTreeDataProvider._onDidChangeTreeData.fire(undefined);
            vscode.window.showInformationMessage(`Successfully created interaction '${interactionName}'`);
            exports.logger.debug(`Created new interaction '${interactionName}' under subdivision '${subdivisionTreeItem.testElementData.name}'`);
        }
    });
    // --- Command: Open Issue Reporter ---
    registerSafeCommand(context, exports.allExtensionCommands.openIssueReporter.command, async () => {
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench-visual-studio-code-extension"
        });
    });
    // Set context value for connectionActive.
    // Used to enable or disable the login and logout buttons in the status bar,
    // which allows icon changes for login/logout buttons based on connectionActive variable.
    vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", exports.connection !== null);
    exports.logger.trace(`Context value connectionActive set to: ${exports.connection !== null}`);
}
/* =============================================================================
   Extension Activation & Deactivation
   ============================================================================= */
/**
 * Called when the extension is activated.
 *
 * @param context The extension context.
 */
async function activate(context) {
    // Initialize logger.
    exports.logger = new testBenchLogger.TestBenchLogger();
    exports.logger.info("Extension activated.");
    // Initialize the status bar item for displaying the configuration source.
    context.subscriptions.push(statusItem);
    // Initialize with global scope by default
    currentConfigScope = undefined;
    updateConfigSourceDisplay();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(exports.baseKeyOfExtension)) {
            await loadConfiguration(context);
            exports.logger.info("Configuration updated after changes were detected.");
        }
    }));
    // Load initial configuration and register a listener for configuration changes.
    await loadConfiguration(context);
    initializeTreeViews();
    // Register the login webview provider.
    exports.loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, exports.loginWebViewProvider));
    // Register all extension commands.
    registerExtensionCommands(context);
    // Display the login webview display.
    // This calls focuses and opens our extension even when the user wont want to use our extension.
    // To solve this in package.json, "activationEvents" is set to "onView:testBenchExplorer" to activate the extension only when the extension view is opened.
    await loginWebView.updateWebViewDisplay();
    // Hide all tree views on activation, so that only login webview is visible.
    await vscode.commands.executeCommand("projectManagementTree.removeView");
    await vscode.commands.executeCommand("testThemeTree.removeView");
    await vscode.commands.executeCommand("testElementsView.removeView");
    // Execute automatic login if the setting is enabled.
    vscode.commands.executeCommand(exports.allExtensionCommands.automaticLoginAfterExtensionActivation.command);
}
/**
 * Called when the extension is deactivated.
 */
async function deactivate() {
    try {
        // Gracefully log out the user when the extension is deactivated.
        await exports.connection?.logoutUser(exports.projectManagementTreeDataProvider);
        exports.logger.info("Extension deactivated.");
    }
    catch (error) {
        exports.logger.error("Error during deactivation:", error);
    }
}
//# sourceMappingURL=extension.js.map