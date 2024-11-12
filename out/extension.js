"use strict";
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lastGeneratedReportParams = exports.folderNameOfTestbenchWorkingDirectory = exports.connection = exports.projectManagementTreeDataProvider = exports.logger = exports.baseKey = void 0;
exports.setProjectManagementTreeDataProvider = setProjectManagementTreeDataProvider;
exports.setConnection = setConnection;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const reportHandler = __importStar(require("./reportHandler"));
const testBenchConnection = __importStar(require("./testBenchConnection"));
const projectManagementTreeView = __importStar(require("./projectManagementTreeView"));
const testBenchTypes = __importStar(require("./testBenchTypes"));
const path_1 = __importDefault(require("path"));
const testBenchLogger_1 = require("./testBenchLogger");
exports.baseKey = "testbenchExtension"; // Prefix of the commands in package.json
exports.projectManagementTreeDataProvider = null; // Store the tree data provider
function setProjectManagementTreeDataProvider(newProjectManagementTreeDataProvider) {
    exports.projectManagementTreeDataProvider = newProjectManagementTreeDataProvider;
}
exports.connection = null; // Store the connection to server
function setConnection(newConnection) {
    exports.connection = newConnection;
}
exports.folderNameOfTestbenchWorkingDirectory = ".testbench"; // Folder to create under the working directory to download / process files
exports.lastGeneratedReportParams = {
    executionBased: undefined,
    projectKey: undefined,
    cycleKey: undefined,
    UID: undefined,
};
async function activate(context) {
    const config = vscode.workspace.getConfiguration(exports.baseKey);
    exports.logger = new testBenchLogger_1.TestBenchLogger();
    exports.logger.info("Extension activated.");
    // Store extension commands with their titles to be able to display them together in a quickpick
    const commands = {
        displayCommands: {
            command: `${exports.baseKey}.displayCommands`,
            title: "Display Available Commands",
        },
        login: {
            command: `${exports.baseKey}.login`,
            title: "Login to TestBench Server",
        },
        changeConnection: {
            command: `${exports.baseKey}.changeConnection`,
            title: "Change account",
        },
        logout: {
            command: `${exports.baseKey}.logout`,
            title: "Logout from TestBench Server",
        },
        generateTestCasesForCycle: {
            command: `${exports.baseKey}.generateTestCasesForCycle`,
            title: "Generate Tests",
        },
        generateTestCasesForTestThemeOrTestCaseSet: {
            command: `${exports.baseKey}.generateTestCasesForTestThemeOrTestCaseSet`,
            title: "Generate Tests",
        },
        readRFTestResultsAndCreateReportWithResults: {
            command: `${exports.baseKey}.readRFTestResultsAndCreateReportWithResults`,
            title: "Read Test Results & Create Report With Results",
        },
        makeRoot: {
            command: `${exports.baseKey}.makeRoot`,
            title: "Make Root Item",
        },
        getCycleStructure: {
            command: `${exports.baseKey}.getCycleStructure`,
            title: "Get Cycle Structure",
        },
        getServerVersions: {
            command: `${exports.baseKey}.getServerVersions`,
            title: "Get Server Versions",
        },
        showExtensionSettings: {
            command: `${exports.baseKey}.showExtensionSettings`,
            title: "Show Extension Settings",
        },
        fetchReportForSelectedTreeItem: {
            command: `${exports.baseKey}.fetchReportForSelectedTreeItem`,
            title: "Fetch Report",
        },
        selectAndLoadProject: {
            command: `${exports.baseKey}.selectAndLoadProject`,
            title: "Display Projects List",
        },
        uploadTestResultsToTestbench: {
            command: `${exports.baseKey}.uploadTestResultsToTestbench`,
            title: "Upload Test Results To Testbench",
        },
        readAndUploadTestResultsToTestbench: {
            command: `${exports.baseKey}.readAndUploadTestResultsToTestbench`,
            title: "Read Tests & Upload Results To Testbench",
        },
        executeRobotFrameworkTests: {
            command: `${exports.baseKey}.executeRobotFrameworkTests`,
            title: "Execute Tests",
        },
        refreshProjectTreeView: {
            command: `${exports.baseKey}.refreshProjectTreeView`,
            title: "Refresh Project Tree View",
        },
        refreshTestTreeView: {
            command: `${exports.baseKey}.refreshTestTreeView`,
            title: "Refresh Test Tree View",
        },
        setWorkspaceLocation: {
            command: `${exports.baseKey}.setWorkspaceLocation`,
            title: "Set Workspace Location",
        },
    };
    // Initialize or update extension configuration settings
    async function loadConfiguration() {
        // If storePassword is false, delete the stored password.
        // The password is only stored after a successful login.
        if (!config.get("storePasswordAfterLogin", false)) {
            await testBenchConnection.clearStoredCredentials(context);
        }
        // If the user wont specify a workspace location, use the workspace location of VS Code
        if (!config.get("workspaceLocation")) {
            await config.update("workspaceLocation", vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
        }
        if (config.get("useDefaultValuesForTestbench2robotframework")) {
            // For testbench2robotframework configuration, set the generation and resource directory relative to the workspace location
            let defaultTestbench2robotframeworkConfig = testBenchTypes.defaultTestbench2robotframeworkConfig;
            defaultTestbench2robotframeworkConfig.generationDirectory = path_1.default.join(config.get("workspaceLocation"), exports.folderNameOfTestbenchWorkingDirectory, "Generated");
            defaultTestbench2robotframeworkConfig.resourceDirectory = path_1.default.join(config.get("workspaceLocation"), "resources");
            await config.update("testbench2robotframeworkConfig", defaultTestbench2robotframeworkConfig);
            // console.log("Updated testbench2robotframeworkConfig with default values.");
            exports.logger.debug("Updated testbench2robotframeworkConfig with default values.");
        }
    }
    // Load initial configuration
    await loadConfiguration();
    // Respond to configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(exports.baseKey)) {
            await loadConfiguration();
            // console.log("Configuration changed and updated.");
            exports.logger.debug("Configuration changed and updated.");
        }
    }));
    // Prompts the user to select a folder and returns its path
    async function promptForWorkspaceLocation() {
        const options = {
            canSelectMany: false,
            openLabel: "Select Workspace Location",
            canSelectFolders: true,
            canSelectFiles: false,
        };
        const folderUri = await vscode.window.showOpenDialog(options);
        if (folderUri && folderUri[0]) {
            return folderUri[0].fsPath;
        }
        return undefined;
    }
    // Register the "Set Workspace Location" command
    context.subscriptions.push(vscode.commands.registerCommand(`${exports.baseKey}.setWorkspaceLocation`, async () => {
        const newWorkspaceLocation = await promptForWorkspaceLocation();
        if (newWorkspaceLocation) {
            const config = vscode.workspace.getConfiguration(exports.baseKey);
            await config.update("workspaceLocation", newWorkspaceLocation);
            vscode.window.showInformationMessage(`Workspace location set to: ${newWorkspaceLocation}`);
            exports.logger.debug(`Workspace location set to: ${newWorkspaceLocation}`);
        }
    }));
    // Register "Show Extension Settings" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.showExtensionSettings.command, () => {
        // Open the settings UI of the extension inside the settings editor
        vscode.commands
            .executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-visual-studio-code-extension",
        })
            .then(() => {
            // Open the workspace settings view (The default settings view is user settings)
            vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
        });
        exports.logger.debug("Extension settings opened.");
    }));
    // Login/Logout icon changes based on connection status
    vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", exports.connection !== null);
    exports.logger.debug(`Context value connectionActive set to: ${exports.connection !== null}`);
    // FIXME: Login was stuck again, servers are crashed also.
    // The user may press the login button multiple times consecutively. Aviod executing the command again if already inside login.
    let insideLogin = false;
    // Register the "Login" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.login.command, async () => {
        if (insideLogin) {
            // console.log("Already inside login..");
            exports.logger.debug(`Login process is already running.`);
            // If somehow login is stuck, reset the insideLogin flag after 10 seconds to avoid blocking the login process.
            setTimeout(() => {
                insideLogin = false;
                exports.logger.debug(`insideLogin flag reset after 10 seconds.`);
            }, 5 * 1000);
            return;
        }
        insideLogin = true;
        // Only execute the finally block after the login attempt is fully completed to avoid multiple login prompts after clicking login multiple times.
        await testBenchConnection
            .performLogin(context, exports.baseKey)
            .catch((error) => {
            // console.error("Login process failed:", error);
            exports.logger.error(`Login process failed: ${error}`, true);
        })
            .finally(() => {
            // Reset insideLogin after the login attempt is fully completed
            insideLogin = false;
            exports.logger.debug(`insideLogin flag reset after login attempt.`);
        });
    }));
    // Register the "Logout" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.logout.command, async () => {
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn(`Logout command is called without a connection.`);
            return;
        }
        await exports.connection.logoutUser(context, exports.projectManagementTreeDataProvider);
    }));
    // Register the "Generate Tests" command, which is activated for a cycle element
    context.subscriptions.push(vscode.commands.registerCommand(commands.generateTestCasesForCycle.command, async (item) => {
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn(`generateTestCasesForCycle command is called without a connection.`);
            return;
        }
        if (!exports.projectManagementTreeDataProvider) {
            vscode.window.showErrorMessage("Project management tree is not initialized. Please select a project first.");
            exports.logger.warn(`generateTestCasesForCycle command is called without a project data provider.`);
            return;
        }
        // If the user did not clicked on a test cycle, test cycle wont have any children so that test themes cannot be displayed in the quickpick.
        // Call getChildrenOfCycle initialize the sub elements of the cycle.
        // Offload the children of the cycle to the Test Theme Tree
        if (exports.projectManagementTreeDataProvider?.testThemeDataProvider) {
            const children = (await exports.projectManagementTreeDataProvider.getChildrenOfCycle(item)) ?? [];
            exports.projectManagementTreeDataProvider.testThemeDataProvider.setRoots(children);
        }
        await reportHandler.startTestGenerationProcessForCycle(context, item, exports.baseKey, exports.folderNameOfTestbenchWorkingDirectory);
    }));
    // Register the "Fetch Report" command for a tree element
    context.subscriptions.push(vscode.commands.registerCommand(commands.fetchReportForSelectedTreeItem.command, async (treeItem) => {
        await reportHandler.callFetchReportForTreeElement(treeItem, exports.projectManagementTreeDataProvider, exports.folderNameOfTestbenchWorkingDirectory);
    }));
    // Register the "Generate Tests For Test Theme or Test Case Set" command, which is activated for a test theme element
    context.subscriptions.push(vscode.commands.registerCommand(commands.generateTestCasesForTestThemeOrTestCaseSet.command, async (treeItem) => {
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn(`generateTestCasesForTestThemeOrTestCaseSet command is called without a connection.`);
            return;
        }
        await reportHandler.generateTestCasesForTestThemeOrTestCaseSet(context, treeItem, exports.folderNameOfTestbenchWorkingDirectory);
    }));
    // Register the "Select And Load Project" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.selectAndLoadProject.command, async () => {
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn(`selectAndLoadProject command is called without a connection.`);
            return;
        }
        const projectList = await exports.connection.getProjectsList();
        if (!projectList) {
            // vscode.window.showErrorMessage("No projects found..");
            exports.logger.warn(`No projects found for the selectAndLoadProject command.`);
            return;
        }
        const selectedProjectKey = await exports.connection.selectProjectKeyFromProjectList(projectList);
        if (!selectedProjectKey) {
            // vscode.window.showErrorMessage("No project selected..");
            exports.logger.warn(`No project selected for the selectAndLoadProject command.`);
            return;
        }
        exports.projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(exports.connection, selectedProjectKey);
        vscode.window.createTreeView("projectManagementTree", {
            treeDataProvider: exports.projectManagementTreeDataProvider,
        });
        [exports.projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeView(context, exports.connection, selectedProjectKey);
    }));
    // Register the "Read Test Results" command, which is activated for a test theme or test case set element
    context.subscriptions.push(vscode.commands.registerCommand(commands.readRFTestResultsAndCreateReportWithResults.command, async () => {
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn(`readRFTestResultsAndCreateReportWithResults command is called without a connection.`);
            return;
        }
        await reportHandler.readTestResultsAndCreateReportWithResults(context, exports.folderNameOfTestbenchWorkingDirectory);
    }));
    // Register the Upload Test Results to TestBench command
    context.subscriptions.push(vscode.commands.registerCommand(commands.uploadTestResultsToTestbench.command, async () => {
        if (!exports.connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            exports.logger.warn(`uploadTestResultsToTestbench command is called without a connection.`);
            return;
        }
        if (!exports.projectManagementTreeDataProvider || !exports.projectManagementTreeDataProvider.currentProjectKeyInView) {
            vscode.window.showErrorMessage("No project selected. Please select a project first.");
            exports.logger.warn(`uploadTestResultsToTestbench command is called without a selected project.`);
            return;
        }
        await testBenchConnection.selectReportWithResultsAndImportToTestbench(exports.connection, exports.projectManagementTreeDataProvider);
    }));
    // Register the automated "Read Tests & Upload Results to TestBench" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.readAndUploadTestResultsToTestbench.command, async () => {
        await reportHandler.readTestsAndCreateResultsAndImportToTestbench(context, exports.folderNameOfTestbenchWorkingDirectory, exports.projectManagementTreeDataProvider);
    }));
    // Register the "Refresh Project Tree" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.refreshProjectTreeView.command, async () => {
        exports.projectManagementTreeDataProvider?.clearTree();
        [exports.projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeView(context, exports.connection, exports.projectManagementTreeDataProvider?.currentProjectKeyInView);
    }));
    // Register the "Refresh Test Tree" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.refreshTestTreeView.command, async () => {
        exports.projectManagementTreeDataProvider?.testThemeDataProvider.refresh();
        let cycleElement = exports.projectManagementTreeDataProvider?.testThemeDataProvider?.rootElements[0]?.parent;
        if (cycleElement && cycleElement.contextValue === "Cycle") {
            // Clear the test theme tree when a cycle is expanded so that clicking on a new test cycle will not show the old test themes
            exports.projectManagementTreeDataProvider?.testThemeDataProvider?.clearTree();
            // Fetch the test themes from the server
            const children = (await exports.projectManagementTreeDataProvider?.getChildrenOfCycle(cycleElement)) ?? [];
            exports.projectManagementTreeDataProvider?.testThemeDataProvider?.setRoots(children);
        }
    }));
    // Register the "Make Root" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.makeRoot.command, (treeItem) => {
        if (exports.projectManagementTreeDataProvider) {
            // Find out for which element the make root command is called
            if (treeItem.contextValue === "Project" ||
                treeItem.contextValue === "Version" ||
                treeItem.contextValue === "Cycle") {
                // If we are in the project management tree, call the makeRoot method of the project management tree data provider
                exports.projectManagementTreeDataProvider.makeRoot(treeItem);
            }
            else {
                // If we are in the test theme tree, call the makeRoot method of the test theme tree data provider
                exports.projectManagementTreeDataProvider.testThemeDataProvider.makeRoot(treeItem);
            }
        }
    }));
    // Uncomment this if you want to prompt the user to log in when the extension activates
    // vscode.commands.executeCommand(`${baseKey}.login`);
}
function deactivate() {
    exports.logger.info("Extension deactivated.");
}
//# sourceMappingURL=extension.js.map