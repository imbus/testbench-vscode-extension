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
exports.loadConfiguration = loadConfiguration;
exports.initializeTreeViews = initializeTreeViews;
exports.activate = activate;
exports.deactivate = deactivate;
// TODO: If possible, hide the tree views initially instead of creating them and then hiding them after.
// TODO: The user generated tests, executed the tests, and restarted the extension. Last generated test params are now invalid due to restart, and he cant import. Use VS Code storage?
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
const projectManagementTreeView_1 = require("./projectManagementTreeView");
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
    displayCommand: `${exports.baseKeyOfExtension}.displayCommands`,
    login: `${exports.baseKeyOfExtension}.login`,
    logout: `${exports.baseKeyOfExtension}.logout`,
    generateTestCasesForCycle: `${exports.baseKeyOfExtension}.generateTestCasesForCycle`,
    generateTestCasesForTestThemeOrTestCaseSet: `${exports.baseKeyOfExtension}.generateTestCasesForTestThemeOrTestCaseSet`,
    readRFTestResultsAndCreateReportWithResults: `${exports.baseKeyOfExtension}.readRFTestResultsAndCreateReportWithResults`,
    makeRoot: `${exports.baseKeyOfExtension}.makeRoot`,
    getServerVersions: `${exports.baseKeyOfExtension}.getServerVersions`,
    showExtensionSettings: `${exports.baseKeyOfExtension}.showExtensionSettings`,
    fetchReportForSelectedTreeItem: `${exports.baseKeyOfExtension}.fetchReportForSelectedTreeItem`,
    selectAndLoadProject: `${exports.baseKeyOfExtension}.selectAndLoadProject`,
    importTestResultsToTestbench: `${exports.baseKeyOfExtension}.importTestResultsToTestbench`,
    readAndImportTestResultsToTestbench: `${exports.baseKeyOfExtension}.readAndImportTestResultsToTestbench`,
    executeRobotFrameworkTests: `${exports.baseKeyOfExtension}.executeRobotFrameworkTests`,
    refreshProjectTreeView: `${exports.baseKeyOfExtension}.refreshProjectTreeView`,
    refreshTestThemeTreeView: `${exports.baseKeyOfExtension}.refreshTestThemeTreeView`,
    clearInternalTestbenchFolder: `${exports.baseKeyOfExtension}.clearInternalTestbenchFolder`,
    toggleProjectManagementTreeViewVisibility: `${exports.baseKeyOfExtension}.toggleProjectManagementTreeViewVisibility`,
    toggleTestThemeTreeViewVisibility: `${exports.baseKeyOfExtension}.toggleTestThemeTreeViewVisibility`,
    toggleWebViewVisibility: `${exports.baseKeyOfExtension}.toggleWebViewVisibility`,
    automaticLoginAfterExtensionActivation: `${exports.baseKeyOfExtension}.automaticLoginAfterExtensionActivation`,
    refreshTestElementsTree: `${exports.baseKeyOfExtension}.refreshTestElementsTree`,
    displayInteractionsForSelectedTOV: `${exports.baseKeyOfExtension}.displayInteractionsForSelectedTOV`,
    openRobotResourceFile: `${exports.baseKeyOfExtension}.openRobotResourceFile`,
    createInteractionUnderSubdivision: `${exports.baseKeyOfExtension}.createInteractionUnderSubdivision`,
    openIssueReporter: `${exports.baseKeyOfExtension}.openIssueReporter`
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
// Global variable to store the current configuration scope (workspace or global).
let currentConfigScope;
let activeEditor;
/**
 * Loads the latest extension configuration and updates the global configuration object.
 * Also handles the storage of credentials based on the configuration settings.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function loadConfiguration(context, newScope) {
    // If no new scope provided, determine the best scope automatically
    if (newScope === undefined) {
        if (activeEditor) {
            newScope = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri;
        }
        else if (vscode.workspace.workspaceFolders?.length === 1) {
            newScope = vscode.workspace.workspaceFolders[0].uri;
        }
    }
    currentConfigScope = newScope;
    // Update the configuration object with the latest values.
    // Without this, the configuration changes may not be updated and old values may be used.
    config = vscode.workspace.getConfiguration(exports.baseKeyOfExtension, currentConfigScope);
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
    if (!config.get("storePasswordAfterLogin", false)) {
        await testBenchConnection?.clearStoredCredentials(context);
    }
    // Update the webview input fields after extension settings are changed to reflect the changes in the webview live.
    // Commented out due to the password field being empty after the extension settings are changed.
    // loginWebViewProvider?.updateWebviewHTMLContent();
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
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
function initializeTreeViews(context) {
    (0, projectManagementTreeView_1.initializeProjectAndTestThemeTrees)(context);
    initializeTestElementsTreeView();
}
/**
 * Registers all the commands defined by the extension.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
function registerExtensionCommands(context) {
    // --- Command: Toggle Login Webview Visibility ---
    registerSafeCommand(context, exports.allExtensionCommands.toggleWebViewVisibility, loginWebView.toggleWebViewVisibility);
    // --- Command: Show Extension Settings ---
    registerSafeCommand(context, exports.allExtensionCommands.showExtensionSettings, async () => {
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
    registerSafeCommand(context, exports.allExtensionCommands.automaticLoginAfterExtensionActivation, async () => {
        // If auto login is active and the password is stored in the secrets, perform the login automatically.
        if (config.get("automaticLoginAfterExtensionActivation", false) &&
            config.get("storePasswordAfterLogin", false) &&
            (await context.secrets.get("password")) !== undefined) {
            exports.logger.debug("Performing automatic login.");
            const loginResult = await testBenchConnection?.performLogin(context, false, true);
            if (loginResult) {
                // If login was successful, display project selection dialog and the project management tree view.
                projectManagementTreeView?.displayProjectManagementTreeView();
                vscode.commands.executeCommand(exports.allExtensionCommands.selectAndLoadProject);
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
    registerSafeCommand(context, exports.allExtensionCommands.login, async () => {
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
                await vscode.commands.executeCommand(exports.allExtensionCommands.selectAndLoadProject);
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
    registerSafeCommand(context, exports.allExtensionCommands.logout, async () => {
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
    registerSafeCommand(context, exports.allExtensionCommands.generateTestCasesForCycle, async (item) => {
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
        if (config.get("clearInternalTestbenchDirectoryBeforeTestGeneration")) {
            await vscode.commands.executeCommand(exports.allExtensionCommands.clearInternalTestbenchFolder);
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
    registerSafeCommand(context, exports.allExtensionCommands.fetchReportForSelectedTreeItem, async (treeItem) => {
        await reportHandler.fetchReportForTreeElement(treeItem, exports.projectManagementTreeDataProvider, exports.folderNameOfTestbenchWorkingDirectory);
    });
    // --- Command: Generate Test Cases For Test Theme or Test Case Set ---
    registerSafeCommand(context, exports.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet, async (treeItem) => {
        exports.logger.debug("Generate Test Cases For Test Theme or Test Case Set command called.");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn("generateTestCasesForTestThemeOrTestCaseSet command called without connection.");
            return;
        }
        // Optionally clear the working directory before test generation.
        if (config.get("clearInternalTestbenchDirectoryBeforeTestGeneration")) {
            await vscode.commands.executeCommand(exports.allExtensionCommands.clearInternalTestbenchFolder);
        }
        await reportHandler.generateRobotFrameworkTestsForTestThemeOrTestCaseSet(context, treeItem, exports.folderNameOfTestbenchWorkingDirectory);
        exports.logger.trace("End of Generate Test Cases For Test Theme or Test Case Set command.");
    });
    // --- Command: Select And Load Project ---
    // Fetches the projects list from the server and prompts the user to select a project to display its contents in the tree view.
    registerSafeCommand(context, exports.allExtensionCommands.selectAndLoadProject, async () => {
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
        // Show a quick pick dialog to select a project from the projects list.
        const selectedProjectKey = await exports.connection.getProjectKeyFromProjectListQuickPickSelection(projectList);
        if (!selectedProjectKey) {
            exports.logger.warn("No project selected for selectAndLoadProject command.");
            return;
        }
        // Initialize and display the project management tree view with the selected project.
        await projectManagementTreeView.initializeProjectAndTestThemeTrees(context, selectedProjectKey);
        // After selecting a (new) project, hide the test theme tree view and test elements tree view and clear the test elements tree view.
        projectManagementTreeView.hideTestThemeTreeView();
        testElementsTreeView.hideTestElementsTreeView();
        testElementsTreeView.clearTestElementsTreeView();
        exports.logger.trace(`Project with key ${selectedProjectKey} loaded into project management tree view.`);
    });
    // --- Command: Toggle Project Management Tree View Visibility ---
    registerSafeCommand(context, exports.allExtensionCommands.toggleProjectManagementTreeViewVisibility, async () => {
        await projectManagementTreeView.toggleProjectManagementTreeViewVisibility();
    });
    // --- Command: Toggle Test Theme Tree View Visibility ---
    registerSafeCommand(context, exports.allExtensionCommands.toggleTestThemeTreeViewVisibility, async () => {
        await projectManagementTreeView.toggleTestThemeTreeViewVisibility();
    });
    // --- Command: Read Robotframework Test Results And Create Report With Results ---
    // Activated for a test theme or test case set element.
    // Reads the test results (output.xml) from the testbench working directory and creates a report zip file with the results.
    registerSafeCommand(context, exports.allExtensionCommands.readRFTestResultsAndCreateReportWithResults, async () => {
        exports.logger.debug("Read RF Test Results And Create Report With Results command called.");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn("readRFTestResultsAndCreateReportWithResults command called without connection.");
            return;
        }
        await reportHandler.fetchTestResultsAndCreateReportWithResultsWithTb2Robot(context, exports.folderNameOfTestbenchWorkingDirectory);
        exports.logger.trace("End of Read RF Test Results And Create Report With Results command.");
    });
    // --- Command: Import Test Results To Testbench ---
    // Imports the selected test results zip to the testbench server
    registerSafeCommand(context, exports.allExtensionCommands.importTestResultsToTestbench, async () => {
        exports.logger.debug("Import Test Results To Testbench command called.");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn("importTestResultsToTestbench command called without connection.");
            return;
        }
        if (!exports.projectManagementTreeDataProvider || !exports.projectManagementTreeDataProvider.activeProjectKeyInView) {
            vscode.window.showErrorMessage("No project selected. Please select a project first.");
            exports.logger.warn("importTestResultsToTestbench command called without a selected project.");
            return;
        }
        await testBenchConnection.selectReportWithResultsAndImportToTestbench(exports.connection, exports.projectManagementTreeDataProvider);
        exports.logger.trace("End of Import Test Results To Testbench command.");
    });
    // --- Command: Read And Import Test Results To Testbench ---
    // A command that combines the read and import test results commands.
    registerSafeCommand(context, exports.allExtensionCommands.readAndImportTestResultsToTestbench, async () => {
        exports.logger.debug("Read And Import Test Results To Testbench command called.");
        if (!exports.connection) {
            const noConnectionMessage = "No connection available. Cannot import report.";
            vscode.window.showErrorMessage(noConnectionMessage);
            exports.logger.warn(noConnectionMessage);
            return null;
        }
        if (!exports.projectManagementTreeDataProvider || !exports.projectManagementTreeDataProvider.activeProjectKeyInView) {
            const missingProjectKeyError = "Active project key is missing. Cannot import report.";
            vscode.window.showErrorMessage(missingProjectKeyError);
            exports.logger.warn(missingProjectKeyError);
            return null;
        }
        await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(context, exports.folderNameOfTestbenchWorkingDirectory, exports.projectManagementTreeDataProvider);
        exports.logger.trace("End of Read And Import Test Results To Testbench command.");
    });
    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, exports.allExtensionCommands.refreshProjectTreeView, async () => {
        exports.projectManagementTreeDataProvider?.refresh();
    });
    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, exports.allExtensionCommands.refreshTestThemeTreeView, async () => {
        exports.logger.debug("Refresh Test Theme Tree command called.");
        const cycleElement = exports.projectManagementTreeDataProvider?.testThemeDataProvider?.rootElements[0]?.parent ?? undefined;
        if (cycleElement && cycleElement.contextValue === "Cycle") {
            // Fetch the test themes etc. from the server
            const children = (await exports.projectManagementTreeDataProvider?.getChildrenOfCycle(cycleElement)) ?? [];
            exports.projectManagementTreeDataProvider?.testThemeDataProvider?.setRoots(children);
        }
        exports.projectManagementTreeDataProvider?.testThemeDataProvider.refresh();
        exports.logger.trace("End of Refresh Test Theme Tree command.");
    });
    // --- Command: Make Root ---
    // Right clicking on a tree element and selecting "Make Root" context menu option will make the selected element the root of the tree.
    registerSafeCommand(context, exports.allExtensionCommands.makeRoot, (treeItem) => {
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
    registerSafeCommand(context, exports.allExtensionCommands.clearInternalTestbenchFolder, async () => {
        exports.logger.debug("Clear Workspace Folder command called.");
        const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return;
        }
        const testbenchWorkingDirectoryPath = path_1.default.join(workspaceLocation, exports.folderNameOfTestbenchWorkingDirectory);
        await utils.clearInternalTestbenchFolder(testbenchWorkingDirectoryPath, [testBenchLogger.folderNameOfLogs], // Exclude log files from deletion
        !config.get("clearInternalTestbenchDirectoryBeforeTestGeneration") // Ask for confirmation if not set to clear before test generation
        );
        exports.logger.trace("End of Clear Workspace Folder command.");
    });
    // --- Command: Refresh Test Elements Tree ---
    // Refreshes the test elements tree view with the latest test elements for the selected TOV.
    registerSafeCommand(context, exports.allExtensionCommands.refreshTestElementsTree, async () => {
        exports.logger.debug("Refresh Test Elements Tree command called.");
        const currentTovKey = testElementsTreeView.getCurrentTovKey();
        if (!currentTovKey) {
            vscode.window.showErrorMessage("No TOV key stored. Please fetch test elements first.");
            return;
        }
        await exports.testElementsTreeDataProvider.fetchAndDisplayTestElements(currentTovKey);
    });
    // --- Command: Display Interactions For Selected TOV ---
    registerSafeCommand(context, exports.allExtensionCommands.displayInteractionsForSelectedTOV, async (treeItem) => {
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
    // --- Command: Go To Resource File ---
    // Opens or creates the robot resource file associated with the selected test element.
    registerSafeCommand(context, exports.allExtensionCommands.openRobotResourceFile, async (treeItem) => {
        if (!treeItem || !treeItem.testElementData) {
            exports.logger.trace("Invalid tree item or element in Open Robot Resource File command.");
            return;
        }
        // Construct the target path based on the hierarchical name of the test element.
        const absolutePathOfSelectedTestElement = await testElementsTreeView.constructAbsolutePathForTestElement(treeItem);
        if (!absolutePathOfSelectedTestElement) {
            return;
        }
        exports.logger.trace(`Open Robot Resource File command created absolutePathOfTestElement: ${absolutePathOfSelectedTestElement}`);
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
            vscode.window.showErrorMessage("Error in Open Robot Resource File command: " + error.message);
            exports.logger.error("Error in Open Robot Resource File command:", error);
        }
    });
    // --- Command: Create Interaction Under Subdivision ---
    // Creates a new interaction tree element under the selected subdivision.
    registerSafeCommand(context, exports.allExtensionCommands.createInteractionUnderSubdivision, async (subdivisionTreeItem) => {
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
    registerSafeCommand(context, exports.allExtensionCommands.openIssueReporter, async () => {
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
    // Initialize with the best scope
    activeEditor = vscode.window.activeTextEditor;
    // Initialize with global scope by default
    currentConfigScope = undefined;
    // Respond to configuration changes in the extension settings.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(exports.baseKeyOfExtension)) {
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
    // Load initial configuration and register a listener for configuration changes.
    await loadConfiguration(context);
    initializeTreeViews(context);
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
    vscode.commands.executeCommand(exports.allExtensionCommands.automaticLoginAfterExtensionActivation);
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