import * as vscode from "vscode";
import * as jsonReportHandler from "./jsonReportHandler";
import { TreeItem, makeRoot } from "./treeView";
import { PlayServerConnection, performLogin, changeConnection } from "./testbenchConnection";
import { TestBenchTreeDataProvider, initializeTreeView } from "./treeView";

export function activate(context: vscode.ExtensionContext) {
    // TODO: Add a new command to clear stored login data? (logout doesnt do that)

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
    };

    interface ReportGenerationConfiguration {
        generationDirectory: string;
        clearGenerationDirectory: boolean;
        createOutputZip: boolean;
        removeExtractedFiles: boolean;
    }

    // Variables to hold configuration settings
    let serverName: string;
    let portNumber: number;
    let username: string;
    let password: string;
    let downloadReportLocation: string;
    let reportGenerationConfig: ReportGenerationConfiguration;

    // Initialize or update configuration settings
    function loadConfiguration() {
        const config = vscode.workspace.getConfiguration(baseKey);

        serverName = config.get<string>("serverName", "testbench");
        portNumber = config.get<number>("portNumber", 9445);
        username = config.get<string>("username", "");
        password = config.get<string>("password", "");
        downloadReportLocation = config.get<string>("downloadReportLocation", "");
        reportGenerationConfig = config.get<ReportGenerationConfiguration>("reportGenerationConfig", {
            generationDirectory: "",
            clearGenerationDirectory: true,
            createOutputZip: false,
            removeExtractedFiles: false,
        });
    }

    // Load initial configuration
    loadConfiguration();

    // Handle configuration changes
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(baseKey)) {
            // Reload and apply configuration settings
            loadConfiguration();
        }
    });
    context.subscriptions.push(configChangeDisposable);

    // Register Show Extension Settings command
    const showExtensionSettingsDisposable = vscode.commands.registerCommand(commands.showExtensionSettings, () => {
        // Open the settings UI of the extension inside the settings editor
        vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-visual-studio-code-extension",
            revealSetting: {
                key: `${baseKey}`, // Add the setting key with.settingsName if you want to open a specific setting
                edit: true, // Set to true to focus on the edit control
            },
        });
    });
    context.subscriptions.push(showExtensionSettingsDisposable);

    // Store the connection to server
    let connection: PlayServerConnection | null = null;
    // Store the tree data provider to be able to clear it on logout
    let treeDataProvider: TestBenchTreeDataProvider | null = null;

    let loginDisposable = vscode.commands.registerCommand(commands.login, async () => {
        connection = await performLogin(context);
        if (!connection) {
            return;
        }
        treeDataProvider = await initializeTreeView(context, connection);

        // Display the commands after logging in
        vscode.commands.executeCommand(commands.displayCommands);
    });
    context.subscriptions.push(loginDisposable);

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
                    "Display Test Theme Tree",
                    "Cancel",
                ];
            } else {
                commandMenuOptions = [
                    "Login",
                    "Show Extension Settings",
                    "Cancel",
                ];
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

    // Register the "Display Test Theme Tree" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.displayTestThemeTree, async () => {
            treeDataProvider = await initializeTreeView(context, connection);
        })
    );

    // Register the "Logout" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.logout, async () => {
            if (connection) {
                await connection.logoutUser(context, treeDataProvider!);
                connection = null; // Clear the connection
            } else {
                vscode.window.showInformationMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Change Connection" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.changeConnection, async () => {
            let { newConnection, newTreeDataProvider } = await changeConnection(context, connection!);
            if (newConnection) {
                connection = newConnection; // Update the connection
                if (treeDataProvider) {
                    treeDataProvider = newTreeDataProvider; // Update the tree data provider
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
        vscode.commands.registerCommand(commands.generateTestCases, async (item: TreeItem) => {
            if (connection) {
                jsonReportHandler.startTestGenerationProcess(item, connection);
            } else {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Make Root" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.makeRoot, (treeItem: TreeItem) => {
            if (treeDataProvider) {
                makeRoot(treeItem, treeDataProvider);
            }
        })
    );

    // Uncomment this if you want to prompt the user to log in when the extension activates
    // vscode.commands.executeCommand(`${baseKey}.login`);
}

export function deactivate() {}
