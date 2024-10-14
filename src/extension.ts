import * as vscode from "vscode";
import * as jsonReportHandler from "./jsonReportHandler";
import { PlayServerConnection, performLogin, changeConnection } from "./testBenchConnection";
import {
    ProjectManagementTreeItem,
    ProjectManagementTreeDataProvider,
    initializeTreeView,
} from "./projectManagementTreeView";

export function activate(context: vscode.ExtensionContext) {
    // TODO: WebViev UI for login?
    // TODO: Create extension documentation in Readme.md
    // TODO: Add a new command to clear stored login data? (logout doesnt do that)
    // TODO: (Later) Upload test results back to TestBench server.
    // TODO: Extra: Create command: Fetch every project with every TOV and cycle and display them in tree view.

    const baseKey = "testbenchExtension";
    const commands = {
        displayCommands: `${baseKey}.displayCommands`,
        login: `${baseKey}.login`,
        changeConnection: `${baseKey}.changeConnection`,
        logout: `${baseKey}.logout`,
        displayProjectsList: `${baseKey}.displayProjectsList`,
        generateTestCases: `${baseKey}.generateTestCases`,
        makeRoot: `${baseKey}.makeRoot`,
        getCycleStructure: `${baseKey}.getCycleStructure`,
        getServerVersions: `${baseKey}.getServerVersions`,
        showExtensionSettings: `${baseKey}.showExtensionSettings`,
        getProjectList: `${baseKey}.getProjectList`,
        refreshTreeView: `${baseKey}.refreshTreeView`,
        setWorkspaceLocation: `${baseKey}.setWorkspaceLocation`,
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
            console.log("Password deleted from secrets storage.");
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
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(baseKey)) {
                loadConfiguration();
                console.log(`Configuration changed!`);
            }
        })
    );

    async function promptForWorkspaceLocation(): Promise<string | undefined> {
        const options: vscode.OpenDialogOptions = {
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
    context.subscriptions.push(
        vscode.commands.registerCommand(`${baseKey}.setWorkspaceLocation`, async () => {
            const newWorkspaceLocation = await promptForWorkspaceLocation();
            if (newWorkspaceLocation) {
                workspaceLocation = newWorkspaceLocation;
                const config = vscode.workspace.getConfiguration(baseKey);
                await config.update("workspaceLocation", workspaceLocation);
                vscode.window.showInformationMessage(`Workspace location set to: ${workspaceLocation}`);
            }
        })
    );

    // Register Show Extension Settings command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.showExtensionSettings, () => {
            // Open the settings UI of the extension inside the settings editor
            vscode.commands.executeCommand("workbench.action.openSettings2", {
                query: "@ext:imbus.testbench-visual-studio-code-extension",
            });
        })
    );

    let connection: PlayServerConnection | null = null; // Store the connection to server
    vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", connection !== null); // Icon change based on connection status
    let projectManagementTreeDataProvider: ProjectManagementTreeDataProvider | null = null; // Store the tree data provider

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
                    vscode.commands.executeCommand(commands.displayProjectsList);
                    break;
                case "Cancel":
                    return;
            }
        })
    );

    // TODO: Change the login icon based on connection status?
    // Register the "Login" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.login, async () => {
            if (!connection) {
                console.log("Connection was null, performing login..");
                let connectionAfterLogin = await performLogin(context, baseKey);
                if (!connectionAfterLogin) {
                    console.log("Login failed.");
                    return;
                } else {
                    connection = connectionAfterLogin;
                }

                // testThemeDataProvider = await initializeTreeView(context, connection);
                // vscode.commands.executeCommand(commands.getProjectList);

                // Display the commands after logging in
                vscode.commands.executeCommand(commands.displayCommands);
            } else {
                console.log("Connection not null.");
                vscode.window.showInformationMessage("You are already logged in.");
            }
        })
    );

    // Register the "Display Test Theme Tree" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.displayProjectsList, async () => {
            // testThemeDataProvider = await initializeTreeView_TO_REMOVE(context, connection);
            vscode.commands.executeCommand(commands.getProjectList);
        })
    );

    // Register the "Logout" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.logout, async () => {
            if (connection) {
                await connection.logoutUser(context, projectManagementTreeDataProvider!);
                connection = null; // Clear the connection
            } else {
                vscode.window.showInformationMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Change Connection" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.changeConnection, async () => {
            let { newConnection, newTreeDataProvider } = await changeConnection(
                context,
                baseKey,
                connection!,
                projectManagementTreeDataProvider!
            );
            if (newConnection) {
                connection = newConnection; // Update the connection
                if (projectManagementTreeDataProvider) {
                    projectManagementTreeDataProvider = newTreeDataProvider; // Update the tree data provider
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
        vscode.commands.registerCommand(commands.generateTestCases, async (item: ProjectManagementTreeItem) => {
            if (connection) {
                jsonReportHandler.startTestGenerationProcess(item, connection, baseKey);
            } else {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Make Root" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.makeRoot, (treeItem: ProjectManagementTreeItem) => {
            if (projectManagementTreeDataProvider) {
                // TODO: This is a bad way to find the correct tree data provider
                if (
                    treeItem.contextValue === "project" ||
                    treeItem.contextValue === "version" ||
                    treeItem.contextValue === "cycle"
                ) {
                    projectManagementTreeDataProvider.makeRoot(treeItem);
                } else {
                    projectManagementTreeDataProvider.testThemeDataProvider.makeRoot(treeItem);
                }
            }
        })
    );

    // Register the "Refresh Tree" command
    // TODO: Fix? When a Tov is set root in the project management tree while the test theme tree is open, and you refresh the project management tree, test theme tree elements disappears.
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.refreshTreeView, async () => {
            projectManagementTreeDataProvider?.clearTree();
            [projectManagementTreeDataProvider] = await initializeTreeView(
                context,
                connection!,
                projectManagementTreeDataProvider?.currentProjectKeyInView!
            );
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

                projectManagementTreeDataProvider = new ProjectManagementTreeDataProvider(
                    connection,
                    selectedProjectKey!
                );
                vscode.window.createTreeView("projectManagementTree", {
                    treeDataProvider: projectManagementTreeDataProvider,
                });
                [projectManagementTreeDataProvider] = await initializeTreeView(
                    context,
                    connection,
                    selectedProjectKey!
                );
            } else {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
            }
        })
    );

    // Uncomment this if you want to prompt the user to log in when the extension activates
    // vscode.commands.executeCommand(`${baseKey}.login`);
}

export function deactivate() {}
