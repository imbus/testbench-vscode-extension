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
Object.defineProperty(exports, "__esModule", { value: true });
exports.baseKey = void 0;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const jsonReportHandler = __importStar(require("./jsonReportHandler"));
const testbenchConnection = __importStar(require("./testbenchConnection"));
const projectManagementTreeView = __importStar(require("./projectManagementTreeView"));
// TODO: WebViev UI for login?
// TODO: Create extension documentation in Readme.md
// Prefix of the commands in package.json
exports.baseKey = "testbenchExtension";
function activate(context) {
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
            command: `${exports.baseKey}.generateTestCases`,
            title: "Generate Tests",
        },
        generateTestCasesForTestTheme: {
            command: `${exports.baseKey}.generateTestCasesForTestTheme`,
            title: "Generate Tests",
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
        selectAndLoadProject: {
            command: `${exports.baseKey}.selectAndLoadProject`,
            title: "Display Projects List",
        },
        uploadTestResultsToTestbench: {
            command: `${exports.baseKey}.uploadTestResultsToTestbench`,
            title: "Upload Test Results To Testbench",
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
    // Extension configuration settings
    let storePassword;
    let workspaceLocation;
    // Initialize or update configuration settings
    async function loadConfiguration() {
        const config = vscode.workspace.getConfiguration(exports.baseKey);
        storePassword = config.get("storePasswordAfterLogin", false);
        // If storePassword is false, delete the stored password.
        // The password is only stored after a successful login.
        if (!storePassword) {
            testbenchConnection.clearStoredCredentials(context);
        }
        // If the user wont specify a workspace location, use the workspace location of VS Code
        if (!config.get("workspaceLocation")) {
            await config.update("workspaceLocation", vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
        }
    }
    // Load initial configuration
    loadConfiguration();
    // Respond to configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(exports.baseKey)) {
            loadConfiguration();
            console.log("Configuration changed!");
        }
    }));
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
            workspaceLocation = newWorkspaceLocation;
            const config = vscode.workspace.getConfiguration(exports.baseKey);
            await config.update("workspaceLocation", workspaceLocation);
            vscode.window.showInformationMessage(`Workspace location set to: ${workspaceLocation}`);
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
    }));
    let projectManagementTreeDataProvider = null; // Store the tree data provider
    let connection = null; // Store the connection to server
    vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", connection !== null); // Login/Logout icon changes based on connection status
    // Register the "Display Commands" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.displayCommands.command, async () => {
        // Display the commands based on the connection status. (Logout etc. is only available if connection is active)
        let commandMenuOptions = [];
        if (connection) {
            commandMenuOptions = [
                commands.logout.title,
                commands.changeConnection.title,
                commands.showExtensionSettings.title,
                commands.selectAndLoadProject.title,
                commands.uploadTestResultsToTestbench.title,
                "Cancel",
            ];
        }
        else {
            commandMenuOptions = [commands.login.title, commands.showExtensionSettings.title, "Cancel"];
        }
        const nextAction = await vscode.window.showQuickPick(commandMenuOptions, {
            placeHolder: "What do you want to do?",
        });
        switch (nextAction) {
            case commands.login.title:
                vscode.commands.executeCommand(commands.login.command);
                break;
            case commands.logout.title:
                vscode.commands.executeCommand(commands.logout.command);
                break;
            case commands.showExtensionSettings.title:
                vscode.commands.executeCommand(commands.showExtensionSettings.command);
                break;
            case commands.selectAndLoadProject.title:
                vscode.commands.executeCommand(commands.selectAndLoadProject.command);
                break;
            case commands.uploadTestResultsToTestbench.title:
                vscode.commands.executeCommand(commands.uploadTestResultsToTestbench.command);
                break;
            case commands.changeConnection.title:
                vscode.commands.executeCommand(commands.changeConnection.command);
                break;
            case "Cancel":
                return;
        }
    }));
    // The user may press the login button multiple times consecutively. Aviod executing the command again if already inside login.
    let insideLogin = false;
    // Register the "Login" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.login.command, async () => {
        if (insideLogin) {
            console.log("Already inside login..");
            return;
        }
        insideLogin = true;
        // Only execute the finally block after the login attempt is fully completed to avoid multiple login prompts after clicking login multiple times.
        testbenchConnection
            .performLogin(context, exports.baseKey)
            .then((connectionAfterLogin) => {
            if (!connectionAfterLogin) {
                return;
            }
            else {
                connection = connectionAfterLogin;
            }
        })
            .catch((error) => {
            console.error("Login process failed:", error);
        })
            .finally(() => {
            // Reset insideLogin after the login attempt is fully completed
            insideLogin = false;
        });
    }));
    // Register the "Logout" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.logout.command, async () => {
        if (connection) {
            await connection.logoutUser(context, projectManagementTreeDataProvider);
            connection = null; // Clear the connection
            projectManagementTreeDataProvider = null; // Clear the tree data provider
        }
        else {
            vscode.window.showWarningMessage("No connection available. Please log in first.");
        }
    }));
    // Register the "Change Connection" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.changeConnection.command, async () => {
        let { newConnection, newTreeDataProvider } = await testbenchConnection.changeConnection(context, exports.baseKey, connection, projectManagementTreeDataProvider);
        if (newConnection) {
            connection = newConnection; // Update the connection
            projectManagementTreeDataProvider = newTreeDataProvider; // Update the tree data provider
        }
        else {
            vscode.window.showWarningMessage("Error when changing connection.");
        }
    }));
    // Download the zip inside a folder and not directly into the workspace folder, and keep working in one folder.
    const folderNameToDownloadReport = "Report";
    // Register the "Generate Tests" command, which is activated for a cycle element
    context.subscriptions.push(vscode.commands.registerCommand(commands.generateTestCasesForCycle.command, async (item) => {
        if (connection) {
            // Clear the test theme tree when a cycle is expanded so that clicking on a new test cycle will not show the old test themes
            // projectManagementTreeDataProvider?.testThemeDataProvider.clearTree();
            // If the user did not expanded a test cycle, test cycle wont have any children so that test themes cannot be displayed in the quickpick.
            // Call getChildrenOfCycle initialize the sub elements of the cycle.
            // Offload the children of the cycle to the Test Theme Tree
            if (projectManagementTreeDataProvider?.testThemeDataProvider) {
                const children = (await projectManagementTreeDataProvider.getChildrenOfCycle(item)) ?? [];
                projectManagementTreeDataProvider.testThemeDataProvider.setRoots(children);
            }
            if (projectManagementTreeDataProvider) {
                await jsonReportHandler.startTestGenerationProcess(context, item, connection, exports.baseKey, folderNameToDownloadReport, projectManagementTreeDataProvider);
            }
            else {
                vscode.window.showErrorMessage("Project management tree is not initialized. Please select a project first.");
            }
        }
        else {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
        }
    }));
    // Register the "Generate Tests For Test Theme" command, which is activated for a test theme element
    context.subscriptions.push(vscode.commands.registerCommand(commands.generateTestCasesForTestTheme.command, async (treeItem) => {
        if (connection) {
            console.log("Generating tests for test theme:", treeItem);
            let testThemeTreeUniqueID = treeItem.item?.base?.uniqueID;
            let cycleKey = projectManagementTreeView.findCycleKeyOfTestThemeElement(treeItem);
            let projectKey = projectManagementTreeView.findProjectKeyOfCycleElement(treeItem.parent);
            // TODO: remove projectManagementTreeDataProvider when we replace local search with server project tree fetching and then searching
            if (!projectKey || !cycleKey || !testThemeTreeUniqueID || !projectManagementTreeDataProvider) {
                console.error("Error when finding project key, cycle key, test theme unique ID or projectManagementTreeDataProvider.");
                return;
            }
            jsonReportHandler.generateTestsWithTestBenchToRobotFramework(context, treeItem, typeof treeItem.label === "string" ? treeItem.label : "", // Label might be undefined
            exports.baseKey, projectKey, cycleKey, connection, folderNameToDownloadReport, projectManagementTreeDataProvider, // TODO
            testThemeTreeUniqueID);
        }
        else {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
        }
    }));
    // Register the "Make Root" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.makeRoot.command, (treeItem) => {
        if (projectManagementTreeDataProvider) {
            // Find out for which element the make root command is called
            if (treeItem.contextValue === "Project" ||
                treeItem.contextValue === "Version" ||
                treeItem.contextValue === "Cycle") {
                // If we are in the project management tree, call the makeRoot method of the project management tree data provider
                projectManagementTreeDataProvider.makeRoot(treeItem);
            }
            else {
                // If we are in the test theme tree, call the makeRoot method of the test theme tree data provider
                projectManagementTreeDataProvider.testThemeDataProvider.makeRoot(treeItem);
            }
        }
    }));
    // Register the "Refresh Project Tree" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.refreshProjectTreeView.command, async () => {
        projectManagementTreeDataProvider?.clearTree();
        [projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeView(context, connection, projectManagementTreeDataProvider?.currentProjectKeyInView);
    }));
    // Register the "Refresh Test Tree" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.refreshTestTreeView.command, async () => {
        projectManagementTreeDataProvider?.testThemeDataProvider.refresh();
        let cycleElement = projectManagementTreeDataProvider?.testThemeDataProvider?.rootElements[0]?.parent;
        if (cycleElement && cycleElement.contextValue === "Cycle") {
            // Clear the test theme tree when a cycle is expanded so that clicking on a new test cycle will not show the old test themes
            projectManagementTreeDataProvider?.testThemeDataProvider?.clearTree();
            // Fetch the test themes from the server
            const children = (await projectManagementTreeDataProvider?.getChildrenOfCycle(cycleElement)) ?? [];
            projectManagementTreeDataProvider?.testThemeDataProvider?.setRoots(children);
        }
    }));
    // Register the "Select And Load Project" command
    context.subscriptions.push(vscode.commands.registerCommand(commands.selectAndLoadProject.command, async () => {
        if (connection) {
            const projectList = await connection.getProjectsList();
            if (!projectList) {
                // vscode.window.showErrorMessage("No projects found..");
                return;
            }
            const selectedProjectKey = await connection.selectProjectKeyFromProjectList(projectList);
            if (!selectedProjectKey) {
                // vscode.window.showErrorMessage("No project selected..");
                return;
            }
            projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(connection, selectedProjectKey);
            vscode.window.createTreeView("projectManagementTree", {
                treeDataProvider: projectManagementTreeDataProvider,
            });
            [projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeView(context, connection, selectedProjectKey);
        }
        else {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
        }
    }));
    // Register the Upload Test Results to TestBench command
    context.subscriptions.push(vscode.commands.registerCommand(commands.uploadTestResultsToTestbench.command, async () => {
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            return;
        }
        if (!projectManagementTreeDataProvider || !projectManagementTreeDataProvider.currentProjectKeyInView) {
            vscode.window.showErrorMessage("No project selected. Please select a project first.");
            return;
        }
        testbenchConnection.selectReportWithResultsAndImportToTestbench(connection, projectManagementTreeDataProvider);
    }));
    // Uncomment this if you want to prompt the user to log in when the extension activates
    // vscode.commands.executeCommand(`${baseKey}.login`);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map