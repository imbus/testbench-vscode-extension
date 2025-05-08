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
exports.testElementsTreeDataProvider = exports.projectTreeView = exports.testElementTreeView = exports.loginWebViewProvider = exports.connection = exports.projectManagementTreeDataProvider = exports.logger = void 0;
exports.getConfig = getConfig;
exports.setLogger = setLogger;
exports.setProjectManagementTreeDataProvider = setProjectManagementTreeDataProvider;
exports.setConnection = setConnection;
exports.setProjectTreeView = setProjectTreeView;
exports.getTestElementsTreeDataProvider = getTestElementsTreeDataProvider;
exports.safeCommandHandler = safeCommandHandler;
exports.loadConfiguration = loadConfiguration;
exports.initializeTreeViews = initializeTreeViews;
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
const testElementsTreeView = __importStar(require("./testElementsTreeView"));
const loginWebView = __importStar(require("./loginWebView"));
const utils = __importStar(require("./utils"));
const path_1 = __importDefault(require("path"));
const constants_1 = require("./constants");
const projectManagementTreeView_1 = require("./projectManagementTreeView");
const server_1 = require("./server");
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
    // --- Command: Show Extension Settings ---
    registerSafeCommand(context, constants_1.allExtensionCommands.showExtensionSettings, async () => {
        exports.logger.debug("Command Called: Show Extension Settings");
        // Open the settings with the extension filter.
        await vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-visual-studio-code-extension"
        });
        // Open the workspace settings view (The default settings view is user settings)
        await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
        exports.logger.trace("End of command: Show Extension Settings");
    });
    // --- Command: Set Workspace ---
    registerSafeCommand(context, constants_1.allExtensionCommands.setWorkspace, async () => {
        exports.logger.debug("Command Called: Set Workspace");
        await utils.setWorkspaceLocation();
        exports.logger.trace("End of command: Set Workspace");
    });
    // --- Command: Automatic Login After Activation ---
    registerSafeCommand(context, constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation, async () => {
        // If auto login is active and the password is stored in the secrets, perform the login automatically.
        if (config.get("automaticLoginAfterExtensionActivation", false) &&
            config.get("storePasswordAfterLogin", false) &&
            (await context.secrets.get(constants_1.StorageKeys.PASSWORD)) !== undefined) {
            exports.logger.debug("Performing automatic login.");
            const loginResult = await testBenchConnection?.performLogin(context, false, true);
            if (loginResult) {
                // Display project management tree and hide other tree views if they are open.
                projectManagementTreeView?.displayProjectManagementTreeView();
                await projectManagementTreeView?.hideTestThemeTreeView();
                await testElementsTreeView?.hideTestElementsTreeView();
                exports.projectManagementTreeDataProvider?.refresh();
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
    registerSafeCommand(context, constants_1.allExtensionCommands.login, async () => {
        exports.logger.debug("Command Called: Login");
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
            if (performLoginResult) {
                // Reinitialize tree views after successful login
                initializeTreeViews(context);
                exports.projectManagementTreeDataProvider?.refresh();
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
        exports.logger.trace("End of command: Login");
    });
    // --- Command: Logout ---
    // Performs the logout process, clears the connection object and shows the login webview.
    registerSafeCommand(context, constants_1.allExtensionCommands.logout, async () => {
        exports.logger.debug("Command Called: Logout");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error("Logout command called without connection.");
            return;
        }
        await exports.connection.logoutUser(exports.projectManagementTreeDataProvider);
        exports.logger.trace("End of command: Logout");
    });
    // --- Command: Handle Cycle Click ---
    // Handles the click event on a project cycle in the project management tree view.
    registerSafeCommand(context, constants_1.allExtensionCommands.handleProjectCycleClick, async (cycleItem) => {
        if (exports.projectManagementTreeDataProvider) {
            await exports.projectManagementTreeDataProvider.handleTestCycleClick(cycleItem);
        }
        else {
            exports.logger.error("Project management tree data provider is not initialized. (Handle Cycle Click)");
            vscode.window.showErrorMessage("Project management tree is not initialized.");
        }
    });
    // --- Command: Generate Test Cases For Cycle ---
    // Generates test cases for the selected cycle in the project management tree view.
    registerSafeCommand(context, constants_1.allExtensionCommands.generateTestCasesForCycle, async (item) => {
        exports.logger.debug("Command Called: Generate Test Cases For Cycle");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error("generateTestCasesForCycle command called without connection.");
            return;
        }
        if (!exports.projectManagementTreeDataProvider) {
            vscode.window.showErrorMessage("Project management tree is not initialized. Please select a project first.");
            exports.logger.error("generateTestCasesForCycle command called without project data provider.");
            return;
        }
        // Optionally clear the working directory before test generation.
        if (config.get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR)) {
            await vscode.commands.executeCommand(constants_1.allExtensionCommands.clearInternalTestbenchFolder);
        }
        // If the user did not clicked on a test cycle in the tree view before,
        // the test cycle wont have any initialized children so that test themes cannot be displayed in the quickpick.
        // Call getChildrenOfCycle to initialize the sub elements (Test themes etc.) of the cycle.
        // Offload the children of the cycle to the Test Theme Tree View.
        if (exports.projectManagementTreeDataProvider?.testThemeDataProvider) {
            const children = (await exports.projectManagementTreeDataProvider.getChildrenOfCycle(item)) ?? [];
            if (item.item?.key) {
                exports.projectManagementTreeDataProvider.testThemeDataProvider.setRoots(children, item.item.key);
            }
            else {
                exports.logger.warn(`Cycle key not found for item '${typeof item.label === "string" ? item.label : "unknown"}' in 'generateTestCasesForCycle'. Cannot set roots for test theme tree.`);
            }
        }
        await reportHandler.startTestGenerationForCycle(context, item);
        exports.logger.trace("End of command: Generate Test Cases For Cycle");
    });
    // --- Command: Fetch Report for Selected Tree Item ---
    registerSafeCommand(context, constants_1.allExtensionCommands.fetchReportForSelectedTreeItem, async (treeItem) => {
        await reportHandler.fetchReportForTreeElement(treeItem, exports.projectManagementTreeDataProvider, constants_1.folderNameOfInternalTestbenchFolder);
    });
    // --- Command: Generate Test Cases For Test Theme or Test Case Set ---
    registerSafeCommand(context, constants_1.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet, async (treeItem) => {
        exports.logger.debug("Command Called: Generate Test Cases For Test Theme or Test Case Set");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error("generateTestCasesForTestThemeOrTestCaseSet command called without connection.");
            return;
        }
        // Optionally clear the working directory before test generation.
        if (config.get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR)) {
            await vscode.commands.executeCommand(constants_1.allExtensionCommands.clearInternalTestbenchFolder);
        }
        await reportHandler.generateRobotFrameworkTestsForTestThemeOrTestCaseSet(context, treeItem);
        exports.logger.trace("End of command: Generate Test Cases For Test Theme or Test Case Set");
    });
    // --- Command: Display All Projects ---
    // Opens the project management tree view and displays all projects with their contents.
    registerSafeCommand(context, constants_1.allExtensionCommands.displayAllProjects, async () => {
        exports.logger.debug("Command Called: Display All Projects");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error("displayAllProjects command called without connection.");
            return;
        }
        // Clear all tree states before reloading
        exports.projectManagementTreeDataProvider?.clearTree();
        exports.projectManagementTreeDataProvider?.testThemeDataProvider.clearTree();
        exports.testElementsTreeDataProvider.refresh([]);
        await projectManagementTreeView.initializeProjectAndTestThemeTrees(context);
        await projectManagementTreeView.displayProjectManagementTreeView();
        // After selecting a (new) project, hide the test theme tree view and test elements tree view and clear the test elements tree view.
        await projectManagementTreeView.hideTestThemeTreeView();
        await testElementsTreeView.hideTestElementsTreeView();
        testElementsTreeView.clearTestElementsTreeView();
        exports.logger.trace("Project list refreshed in project management tree view.");
    });
    // --- Command: Toggle Project Management Tree View Visibility ---
    registerSafeCommand(context, constants_1.allExtensionCommands.toggleProjectManagementTreeViewVisibility, async () => {
        await projectManagementTreeView.toggleProjectManagementTreeViewVisibility();
    });
    // --- Command: Toggle Test Theme Tree View Visibility ---
    registerSafeCommand(context, constants_1.allExtensionCommands.toggleTestThemeTreeViewVisibility, async () => {
        await projectManagementTreeView.toggleTestThemeTreeViewVisibility();
    });
    // --- Command: Read Robotframework Test Results And Create Report With Results ---
    // Activated for a test theme or test case set element.
    // Reads the test results (output.xml) from the testbench working directory and creates a report zip file with the results.
    registerSafeCommand(context, constants_1.allExtensionCommands.readRFTestResultsAndCreateReportWithResults, async () => {
        exports.logger.debug("Command Called: Read RF Test Results And Create Report With Results");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error("readRFTestResultsAndCreateReportWithResults command called without connection.");
            return;
        }
        await reportHandler.fetchTestResultsAndCreateReportWithResultsWithTb2Robot(context);
        exports.logger.trace("End of command: Read RF Test Results And Create Report With Results");
    });
    // --- Command: Import Test Results To Testbench ---
    // Imports the selected test results zip to the testbench server
    registerSafeCommand(context, constants_1.allExtensionCommands.importTestResultsToTestbench, async () => {
        exports.logger.debug("Command Called: Import Test Results To Testbench");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error("importTestResultsToTestbench command called without connection.");
            return;
        }
        await testBenchConnection.selectReportWithResultsAndImportToTestbench(exports.connection);
        exports.logger.trace("End of command: Import Test Results To Testbench");
    });
    // --- Command: Read And Import Test Results To Testbench ---
    // A command that combines the read and import test results commands.
    registerSafeCommand(context, constants_1.allExtensionCommands.readAndImportTestResultsToTestbench, async () => {
        exports.logger.debug("Command called: Read And Import Test Results To Testbench");
        if (!exports.connection) {
            const noConnectionErrorMessage = "No connection available. Cannot import report.";
            vscode.window.showErrorMessage(noConnectionErrorMessage);
            exports.logger.error(noConnectionErrorMessage);
            return null;
        }
        if (!exports.projectManagementTreeDataProvider) {
            const missingProviderErrorMessage = "Project management tree provider is not initialized. Cannot import report.";
            vscode.window.showErrorMessage(missingProviderErrorMessage);
            exports.logger.error(missingProviderErrorMessage);
            return null;
        }
        await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(context);
        exports.logger.trace("End of Command: Read And Import Test Results To Testbench");
    });
    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshProjectTreeView, async () => {
        exports.projectManagementTreeDataProvider?.refresh();
    });
    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshTestThemeTreeView, async () => {
        exports.logger.debug("Command called: Refresh Test Theme Tree");
        const cycleElement = exports.projectManagementTreeDataProvider?.testThemeDataProvider?.rootElements[0]?.parent ?? undefined;
        if (cycleElement && cycleElement.contextValue === "Cycle") {
            // Fetch the test themes from the server
            const children = (await exports.projectManagementTreeDataProvider?.getChildrenOfCycle(cycleElement)) ?? [];
            const cycleKey = cycleElement.item?.key;
            if (cycleKey) {
                exports.projectManagementTreeDataProvider?.testThemeDataProvider?.setRoots(children, cycleKey);
            }
            else {
                exports.logger.warn(`Cycle key not found for item '${typeof cycleElement.label === "string" ? cycleElement.label : "unknown"}' in 'refreshTestThemeTreeView'. Cannot set roots for test theme tree.`);
            }
        }
        exports.projectManagementTreeDataProvider?.testThemeDataProvider.refresh();
        exports.logger.trace("End of command: Refresh Test Theme Tree");
    });
    // --- Command: Make Root ---
    // Right clicking on a tree element and selecting "Make Root" context menu option will make the selected element the root of the tree.
    registerSafeCommand(context, constants_1.allExtensionCommands.makeRoot, (treeItem) => {
        exports.logger.debug("Command Called: Make Root for tree item:", treeItem);
        if (exports.projectManagementTreeDataProvider) {
            // Find out for which element type the make root command is called
            if (treeItem.contextValue &&
                [
                    constants_1.TreeItemContextValues.PROJECT,
                    constants_1.TreeItemContextValues.VERSION,
                    constants_1.TreeItemContextValues.CYCLE
                ].includes(treeItem.contextValue)) {
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
    registerSafeCommand(context, constants_1.allExtensionCommands.clearInternalTestbenchFolder, async () => {
        exports.logger.debug("Command Called: Clear Workspace Folder");
        const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return;
        }
        const testbenchWorkingDirectoryPath = path_1.default.join(workspaceLocation, constants_1.folderNameOfInternalTestbenchFolder);
        await utils.clearInternalTestbenchFolder(testbenchWorkingDirectoryPath, [testBenchLogger.folderNameOfLogs], // Exclude log files from deletion
        !config.get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR) // Ask for confirmation if not set to clear before test generation
        );
        exports.logger.trace("End of Command: Clear Workspace Folder");
    });
    // --- Command: Refresh Test Elements Tree ---
    // Refreshes the test elements tree view with the latest test elements for the selected TOV.
    registerSafeCommand(context, constants_1.allExtensionCommands.refreshTestElementsTree, async () => {
        exports.logger.debug("Command Called: Refresh Test Elements Tree");
        const currentTovKey = testElementsTreeView.getCurrentTovKey();
        if (!currentTovKey) {
            vscode.window.showErrorMessage("No TOV key stored. Please fetch test elements first.");
            return;
        }
        await exports.testElementsTreeDataProvider.fetchAndDisplayTestElements(currentTovKey);
    });
    // --- Command: Display Interactions For Selected TOV ---
    registerSafeCommand(context, constants_1.allExtensionCommands.displayInteractionsForSelectedTOV, async (treeItem) => {
        exports.logger.debug("Command Called: Display Interactions For Selected TOV command called for tree item:", treeItem);
        // Check if the command is executed for a TOV element.
        if (exports.projectManagementTreeDataProvider && treeItem.contextValue === constants_1.TreeItemContextValues.VERSION) {
            const tovKeyOfSelectedTreeElement = treeItem.item?.key?.toString();
            if (tovKeyOfSelectedTreeElement) {
                const areTestElementsFetched = await exports.testElementsTreeDataProvider.fetchAndDisplayTestElements(tovKeyOfSelectedTreeElement, typeof treeItem.label === "string" ? treeItem.label : undefined);
                // Hide Project Contents Tree View after displaying Test Elements Tree View.
                if (areTestElementsFetched) {
                    await projectManagementTreeView?.hideProjectManagementTreeView();
                }
            }
        }
        exports.logger.trace("End of Command: Display Interactions For Selected TOV");
    });
    // --- Command: Go To Resource File ---
    // Opens or creates the robot resource file associated with the selected test element.
    registerSafeCommand(context, constants_1.allExtensionCommands.openOrCreateRobotResourceFile, async (treeItem) => {
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
            vscode.window.showErrorMessage("Error in Open Robot Resource File command: " + error.message);
            exports.logger.error("Error in Open Robot Resource File command:", error);
        }
    });
    // --- Command: Create Interaction Under Subdivision ---
    // Creates a new interaction tree element under the selected subdivision.
    registerSafeCommand(context, constants_1.allExtensionCommands.createInteractionUnderSubdivision, async (subdivisionTreeItem) => {
        exports.logger.debug("Command Called: Create Interaction Under Subdivision");
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.error("createInteractionUnderSubdivision command called without connection.");
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
    // Opens the official VS Code issue reporter, where the extension is preselected.
    registerSafeCommand(context, constants_1.allExtensionCommands.openIssueReporter, async () => {
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench-visual-studio-code-extension"
        });
    });
    // --- Command: Modify Report With Results Zip ---
    // Allows the user to select a report zip file and create a new report by removing JSON files that were not selected in the quick pick from the original report zip.
    registerSafeCommand(context, constants_1.allExtensionCommands.modifyReportWithResultsZip, async () => {
        exports.logger.debug("Command called: Quick pick with multiselect");
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
        exports.logger.trace("End of command: Quick pick with multiselect");
    });
    // Set context value for connectionActive.
    // Used to enable or disable the login and logout buttons in the status bar,
    // which allows icon changes for login/logout buttons based on connectionActive variable.
    vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, exports.connection !== null);
    exports.logger.trace(`Context value connectionActive set to: ${exports.connection !== null}`);
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
    // Load initial configuration and register a listener for configuration changes.
    await loadConfiguration(context);
    initializeTreeViews(context);
    // Register the login webview provider.
    exports.loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, exports.loginWebViewProvider));
    // Register all extension commands.
    registerExtensionCommands(context);
    // Set the initial context state. Before any login attempt, connection is null.
    // VS Code will show/hide views based on this initial state matching the 'when' clauses in package.json
    await vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", exports.connection !== null);
    exports.logger.trace(`Initial connectionActive context set to: ${exports.connection !== null}`);
    await (0, server_1.initializeLanguageServer)();
    // Execute automatic login if the setting is enabled.
    vscode.commands.executeCommand(constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation);
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