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
exports.safeCommandHandler = safeCommandHandler;
exports.promptForWorkspaceLocation = promptForWorkspaceLocation;
exports.loadConfiguration = loadConfiguration;
exports.initializeTreeViews = initializeTreeViews;
exports.activate = activate;
exports.deactivate = deactivate;
// TODO: Add progress bar for tree views when fetching elements to notify the user.
// TODO: Add progress bar for fetching cycle structure since it can take long.
// TODO: If possible, hide the tree views initially instead of creating them and then hiding them after.
// TODO: The user generated tests, executed the tests, and restarted he extension. Last generated test params are now invalid due to restart, and he cant import.
// Before releasing the extension:
// TODO: Add license to the extension
// TODO: Set logger level to info or debug in production
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
    generateTestCasesForCycle: { command: `${exports.baseKeyOfExtension}.generateTestCasesForCycle` },
    generateTestCasesForTestThemeOrTestCaseSet: {
        command: `${exports.baseKeyOfExtension}.generateTestCasesForTestThemeOrTestCaseSet`,
    },
    readRFTestResultsAndCreateReportWithResults: {
        command: `${exports.baseKeyOfExtension}.readRFTestResultsAndCreateReportWithResults`,
    },
    makeRoot: { command: `${exports.baseKeyOfExtension}.makeRoot` },
    getServerVersions: { command: `${exports.baseKeyOfExtension}.getServerVersions` },
    showExtensionSettings: { command: `${exports.baseKeyOfExtension}.showExtensionSettings` },
    fetchReportForSelectedTreeItem: { command: `${exports.baseKeyOfExtension}.fetchReportForSelectedTreeItem` },
    selectAndLoadProject: { command: `${exports.baseKeyOfExtension}.selectAndLoadProject` },
    uploadTestResultsToTestbench: { command: `${exports.baseKeyOfExtension}.uploadTestResultsToTestbench` },
    readAndUploadTestResultsToTestbench: { command: `${exports.baseKeyOfExtension}.readAndUploadTestResultsToTestbench` },
    executeRobotFrameworkTests: { command: `${exports.baseKeyOfExtension}.executeRobotFrameworkTests` },
    refreshProjectTreeView: { command: `${exports.baseKeyOfExtension}.refreshProjectTreeView` },
    refreshTestThemeTreeView: { command: `${exports.baseKeyOfExtension}.refreshTestThemeTreeView` },
    setWorkspaceLocation: { command: `${exports.baseKeyOfExtension}.setWorkspaceLocation` },
    clearWorkspaceFolder: { command: `${exports.baseKeyOfExtension}.clearWorkspaceFolder` },
    toggleProjectManagementTreeViewVisibility: {
        command: `${exports.baseKeyOfExtension}.toggleProjectManagementTreeViewVisibility`,
    },
    toggleTestThemeTreeViewVisibility: { command: `${exports.baseKeyOfExtension}.toggleTestThemeTreeViewVisibility` },
    toggleWebViewVisibility: { command: `${exports.baseKeyOfExtension}.toggleWebViewVisibility` },
    automaticLoginAfterExtensionActivation: { command: `${exports.baseKeyOfExtension}.automaticLoginAfterExtensionActivation` },
    refreshTestElementsTree: { command: `${exports.baseKeyOfExtension}.refreshTestElementsTree` },
    displayInteractionsForSelectedTOV: { command: `${exports.baseKeyOfExtension}.displayInteractionsForSelectedTOV` },
    goToTestElementFile: { command: `${exports.baseKeyOfExtension}.goToTestElementFile` },
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
            exports.logger.error("Error executing command:", error);
            vscode.window.showErrorMessage(`An error occurred: ${error instanceof Error ? error.message : error}`);
        }
    };
}
/**
 * Registers a command with error handling.
 *
 * @param context The extension context.
 * @param commandId The command ID.
 * @param callback The command handler.
 */
function registerSafeCommand(context, commandId, callback) {
    const disposable = vscode.commands.registerCommand(commandId, safeCommandHandler(callback));
    // Adding the command to the context subscriptions disposes them automatically when the extension is deactivated.
    context.subscriptions.push(disposable);
}
/**
 * Prompts the user to select a workspace location (folder).
 *
 * @returns The selected folder path, or undefined if none selected.
 */
async function promptForWorkspaceLocation() {
    exports.logger.debug("Prompting user to select a workspace location.");
    const options = {
        canSelectMany: false,
        openLabel: "Select Workspace Location",
        canSelectFolders: true,
        canSelectFiles: false,
        title: "Select Workspace Location",
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
 * Loads the latest extension configuration.
 *
 * @param context The extension context.
 */
async function loadConfiguration(context) {
    // Update the configuration object with the latest values.
    // Without this, the configuration changes may not be updated and old values may be used.
    config = vscode.workspace.getConfiguration(exports.baseKeyOfExtension);
    // If storePassword is set to false, delete the stored password immediately.
    // If storePassword is set to true, the password is only stored after a successful login.
    if (config?.get("storePasswordAfterLogin", false)) {
        await testBenchConnection?.clearStoredCredentials(context);
    }
    // Update the webview input fields after extension settings are changed to reflect the changes in the webview live
    exports.loginWebViewProvider?.updateWebviewContent();
}
/**
 * Initializes the tree views used by the extension.
 */
function initializeTreeViews() {
    // Initialize project management tree view.
    exports.projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(null);
    exports.projectTreeView = vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: exports.projectManagementTreeDataProvider,
    });
    // Initialize test elements tree view.
    exports.testElementsTreeDataProvider = new testElementsTreeView.TestElementsTreeDataProvider();
    exports.testElementTreeView = vscode.window.createTreeView("testElementsView", {
        treeDataProvider: exports.testElementsTreeDataProvider,
    });
    vscode.window.registerTreeDataProvider("testElementsView", exports.testElementsTreeDataProvider);
    // Hide the test elements tree view initially.
    testElementsTreeView.hideTestElementsTreeView();
}
/**
 * Registers all the commands defined by the extension.
 *
 * @param context The extension context.
 */
function registerExtensionCommands(context) {
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
            query: "@ext:imbus.testbench-visual-studio-code-extension",
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
            (await context.secrets.get("password"))) {
            exports.logger.debug("Performing automatic login.");
            if (await testBenchConnection?.performLogin(context, exports.baseKeyOfExtension, false, true)) {
                // If login was successful, display project selection dialog and the project management tree view.
                projectManagementTreeView?.displayProjectManagementTreeView();
                await vscode.commands.executeCommand(exports.allExtensionCommands.selectAndLoadProject.command);
            }
        }
        else {
            exports.logger.error("Automatic login is disabled or password is not stored.");
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
            const performLoginResult = await testBenchConnection.performLogin(context, exports.baseKeyOfExtension);
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
            treeDataProvider: exports.projectManagementTreeDataProvider,
        });
        // Initialize and display the project management tree view with the selected project.
        [exports.projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeViews(context, exports.connection, selectedProjectKey);
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
        [exports.projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeViews(context, exports.connection, exports.projectManagementTreeDataProvider?.currentProjectKeyInView);
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
        exports.logger.trace("Refresh Test Elements Tree command called.");
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
    // --- Command: Go To Test Element File ---
    // Opens or creates the file in the workspace corresponding to the selected test element.
    registerSafeCommand(context, exports.allExtensionCommands.goToTestElementFile.command, async (treeItem) => {
        if (!treeItem || !treeItem.element) {
            exports.logger.trace("Invalid tree item or element in goToTestElementFile command.");
            return;
        }
        const testElement = treeItem.element;
        if (!testElement.hierarchicalName) {
            exports.logger.trace("Test element does not have a valid hierarchical name.");
            return;
        }
        const workspaceRootPath = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceRootPath) {
            return;
        }
        // Construct the target path based on the hierarchical name of the test element.
        const baseTargetPath = path_1.default.join(workspaceRootPath, ...testElement.hierarchicalName.split("/"));
        try {
            switch (testElement.elementType) {
                case "Subdivision":
                    await testElementsTreeView.handleSubdivision(testElement, baseTargetPath);
                    break;
                case "Interaction":
                    await testElementsTreeView.handleInteraction(testElement, workspaceRootPath);
                    break;
                default:
                    await testElementsTreeView.handleFallback(baseTargetPath);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage("Error in goToFile command: " + error.message);
            exports.logger.error("Error in goToFile command:", error);
        }
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
    // Load initial configuration and register a listener for configuration changes.
    await loadConfiguration(context);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(exports.baseKeyOfExtension)) {
            await loadConfiguration(context);
            exports.logger.info("Configuration updated after changes were detected.");
        }
    }));
    initializeTreeViews();
    // Register the login webview provider.
    exports.loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, exports.loginWebViewProvider));
    // Register all extension commands.
    registerExtensionCommands(context);
    // Display the login webview display.
    // This calls focuses and opens (focuses to) our extension even when the user wont want to use our extension.
    // To solve this in package.json, "activationEvents" is set to "onView:testBenchExplorer" to activate the extension only when the extension view is opened.
    await loginWebView.updateWebViewDisplay();
    // Hide all tree views on activation, so that only login webview is visible.
    await vscode.commands.executeCommand("projectManagementTree.removeView");
    await vscode.commands.executeCommand("testThemeTree.removeView");
    await vscode.commands.executeCommand("testElementsView.removeView");
    // Execute automatic login if the setting is enabled.
    await vscode.commands.executeCommand(exports.allExtensionCommands.automaticLoginAfterExtensionActivation.command);
}
/**
 * Called when the extension is deactivated.
 */
async function deactivate() {
    // Gracefully log out the user when the extension is deactivated.
    await exports.connection?.logoutUser(exports.projectManagementTreeDataProvider);
    exports.logger.info("Extension deactivated.");
}
//# sourceMappingURL=extension.js.map