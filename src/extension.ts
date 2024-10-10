import * as vscode from "vscode";
import * as jsonReportHandler from "./jsonReportHandler";
import { PlayServerConnection, performLogin, changeConnection } from "./testBenchConnection";
import {
    TestThemeTreeItem,
    makeRoot,
    TestThemeTreeDataProvider,
    initializeTreeView_TO_REMOVE,
} from "./projectManagementTreeView";
import { TreeViewDataProvider } from "./testThemeTreeView";

export function activate(context: vscode.ExtensionContext) {
    // TODO: WebViev UI for login?
    // TODO: Create extension documentation in Readme.md
    // TODO: Add a new command to clear stored login data? (logout doesnt do that)
    // TODO: Refactor code (+ Todo's in code) / Review code quality
    // TODO: (Later) Upload test results back to TestBench server.
    // TODO: Extra: Create command: Fetch every project with every TOV and cycle and display them in tree view.


    const baseKey = "testbenchExtension";
    const commands = {
        displayCommands: `${baseKey}.displayCommands`,
        login: `${baseKey}.login`,
        changeConnection: `${baseKey}.changeConnection`,
        logout: `${baseKey}.logout`,
        displayTestThemeTree: `${baseKey}.initTestThemeTree`,
        executeRobotTests: `${baseKey}.runRobotTests`,
        generateTestCases: `${baseKey}.generateTestCases`,
        makeRoot: `${baseKey}.makeRoot`,
        getCycleStructure: `${baseKey}.getCycleStructure`,
        getServerVersions: `${baseKey}.getServerVersions`,
        showExtensionSettings: `${baseKey}.showExtensionSettings`,
        getProjectList: `${baseKey}.getProjectList`,
    };

    interface ReportGenerationConfiguration {
        generationDirectory: string;
        clearGenerationDirectory: boolean;
        createOutputZip: boolean;
        removeExtractedFiles: boolean;
    }

    // Configuration settings
    let serverName: string;
    let portNumber: number;
    let username: string | undefined; // Username has no default value in package.json
    let storePassword: boolean;
    let workspaceLocation: string | undefined;
    let reportGenerationConfig: ReportGenerationConfiguration;

    // Initialize or update configuration settings
    async function loadConfiguration() {
        const config = vscode.workspace.getConfiguration(baseKey);

        serverName = config.get<string>("serverName", "testbench");
        portNumber = config.get<number>("portNumber", 9445);
        username = config.get<string>("username");
        storePassword = config.get<boolean>("storePasswordAfterLogin", false);
        // If storePassword is false, delete the stored password
        if (!storePassword) {
            await context.secrets.delete(`password`);
            console.log("@@ Password deleted from secrets storage.");
        }
        workspaceLocation = config.get<string>("workspaceLocation");
        reportGenerationConfig = config.get<ReportGenerationConfiguration>("reportGenerationConfig", {
            generationDirectory: "",
            clearGenerationDirectory: true,
            createOutputZip: false,
            removeExtractedFiles: false,
        });
    }

    // Load initial configuration
    loadConfiguration();

    // Respond to configuration changes
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(baseKey)) {
            loadConfiguration();
            console.log(`Configuration changed!`);
        }
    });
    context.subscriptions.push(configChangeDisposable);

    // Register Show Extension Settings command
    const showExtensionSettingsDisposable = vscode.commands.registerCommand(commands.showExtensionSettings, () => {
        // Open the settings UI of the extension inside the settings editor
        vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-visual-studio-code-extension",
            /*
            revealSetting: {
                key: `${baseKey}`, // Add the setting key with.settingsName if you want to open a specific setting
                edit: true, // Set to true to focus on the edit control
            },*/
        });
    });
    context.subscriptions.push(showExtensionSettingsDisposable);

    // Store the connection to server
    let connection: PlayServerConnection | null = null;
    // Store the test theme tree data provider to be able to clear it on logout
    let testThemeDataProvider: TestThemeTreeDataProvider | null = null;

    // TODO: Implement the new tree view
    const newTreeDataProvider = new TreeViewDataProvider();
    // Register the Tree2 view in the TestBench Explorer
    vscode.window.registerTreeDataProvider("testThemeTree", newTreeDataProvider);

    // Register the "Display Commands" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.displayCommands, async () => {
            // Display the commands based on the connection status. (Logout etc. is only available if connection is active)
            let commandMenuOptions = [];
            if (connection) {
                commandMenuOptions = [
                    "Logout",
                    "Change connection",
                    "Show Extension Settings",
                    "Get Project List",
                    "Display Test Theme Tree",
                    "Cancel",
                ];
            } else {
                commandMenuOptions = ["Login", "Show Extension Settings", "Cancel"];
            }

            const nextAction = await vscode.window.showQuickPick(commandMenuOptions, {
                placeHolder: "What do you want to do?",
            });

            switch (nextAction) {
                case "Login":
                    vscode.commands.executeCommand(commands.login);
                    break;
                case "Logout":
                    vscode.commands.executeCommand(commands.logout);
                    break;
                case "Show Extension Settings":
                    vscode.commands.executeCommand(commands.showExtensionSettings);
                    break;
                case "Get Project List":
                    vscode.commands.executeCommand(commands.getProjectList);
                    break;
                case "Change connection":
                    vscode.commands.executeCommand(commands.changeConnection);
                    break;
                case "Display Test Theme Tree":
                    vscode.commands.executeCommand(commands.displayTestThemeTree);
                    break;
                case "Cancel":
                    return;
            }
        })
    );

    let loginDisposable = vscode.commands.registerCommand(commands.login, async () => {
        let connectionAfterLogin = await performLogin(context, baseKey);
        if (!connectionAfterLogin) {
            return;
        } else {
            connection = connectionAfterLogin;
        }

        // testThemeDataProvider = await initializeTreeView(context, connection);
        // vscode.commands.executeCommand(commands.getProjectList);

        // Display the commands after logging in
        vscode.commands.executeCommand(commands.displayCommands);
    });
    context.subscriptions.push(loginDisposable);

    // TODO: Refresh command for new play server gets the project list
    // Register the "Display Test Theme Tree" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.displayTestThemeTree, async () => {
            // testThemeDataProvider = await initializeTreeView_TO_REMOVE(context, connection);
            vscode.commands.executeCommand(commands.getProjectList);
        })
    );

    // Register the "Logout" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.logout, async () => {
            if (connection) {
                await connection.logoutUser(context, testThemeDataProvider!);
                connection = null; // Clear the connection
            } else {
                vscode.window.showInformationMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Change Connection" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.changeConnection, async () => {
            let { newConnection, newTreeDataProvider } = await changeConnection(context, baseKey, connection!);
            if (newConnection) {
                connection = newConnection; // Update the connection
                if (testThemeDataProvider) {
                    testThemeDataProvider = newTreeDataProvider; // Update the tree data provider
                } else {
                    vscode.window.showErrorMessage("Error: TreeDataProvider is null.");
                }
            } else {
                vscode.window.showInformationMessage("Connection change cancelled.");
            }
        })
    );

    // Register the "Generate Test Cases" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.generateTestCases, async (item: TestThemeTreeItem) => {
            if (connection) {
                jsonReportHandler.startTestGenerationProcess(item, connection, baseKey);
            } else {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Make Root" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.makeRoot, (treeItem: TestThemeTreeItem) => {
            if (testThemeDataProvider) {
                makeRoot(treeItem, testThemeDataProvider);
            }
        })
    );

    // Register the "Get Projects List" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.getProjectList, async () => {
            if (connection) {
                const projectList = await connection.getProjectList();

                if (!projectList) {
                    // vscode.window.showErrorMessage("No projects found..");
                    return;
                }

                const selectedProjectKey = await connection.selectProjectKeyFromProjectList(projectList);

                if (!selectedProjectKey) {
                    // vscode.window.showErrorMessage("No project selected..");
                    return;
                }

                testThemeDataProvider = new TestThemeTreeDataProvider(connection, selectedProjectKey!);
                vscode.window.createTreeView("projectManagementTree", { treeDataProvider: testThemeDataProvider });
                testThemeDataProvider = await initializeTreeView_TO_REMOVE(context, connection, selectedProjectKey!);
            }
        })
    );

    // Uncomment this if you want to prompt the user to log in when the extension activates
    // vscode.commands.executeCommand(`${baseKey}.login`);
}

export function deactivate() {}
