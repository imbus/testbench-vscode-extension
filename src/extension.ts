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
        displayCommands: {
            command: `${baseKey}.displayCommands`,
            title: "Display Available Commands",
        },
        login: {
            command: `${baseKey}.login`,
            title: "Login to TestBench Server",
        },
        changeConnection: {
            command: `${baseKey}.changeConnection`,
            title: "Change account",
        },
        logout: {
            command: `${baseKey}.logout`,
            title: "Logout from TestBench Server",
        },
        generateTestCases: {
            command: `${baseKey}.generateTestCases`,
            title: "Generate Test Cases",
        },
        makeRoot: {
            command: `${baseKey}.makeRoot`,
            title: "Make Root Item",
        },
        getCycleStructure: {
            command: `${baseKey}.getCycleStructure`,
            title: "Get Cycle Structure",
        },
        getServerVersions: {
            command: `${baseKey}.getServerVersions`,
            title: "Get Server Versions",
        },
        showExtensionSettings: {
            command: `${baseKey}.showExtensionSettings`,
            title: "Show Extension Settings",
        },
        selectAndLoadProject: {
            command: `${baseKey}.selectAndLoadProject`,
            title: "Display Projects List",
        },
        refreshTreeView: {
            command: `${baseKey}.refreshTreeView`,
            title: "Refresh Tree View",
        },
        setWorkspaceLocation: {
            command: `${baseKey}.setWorkspaceLocation`,
            title: "Set Workspace Location",
        },
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
            await context.secrets.delete("password");
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
                console.log("Configuration changed!");
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
        vscode.commands.registerCommand(commands.showExtensionSettings.command, () => {
            // Open the settings UI of the extension inside the settings editor
            vscode.commands.executeCommand("workbench.action.openSettings2", {
                query: "@ext:imbus.testbench-visual-studio-code-extension",
            })
            .then(() => {
                // Open the workspace settings view (The default settings view is user settings)
                vscode.commands.executeCommand('workbench.action.openWorkspaceSettings');
            });
        })
    );

    let connection: PlayServerConnection | null = null; // Store the connection to server
    vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", connection !== null); // Login/Logout icon changes based on connection status
    let projectManagementTreeDataProvider: ProjectManagementTreeDataProvider | null = null; // Store the tree data provider

    // Register the "Display Commands" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.displayCommands.command, async () => {
            // Display the commands based on the connection status. (Logout etc. is only available if connection is active)
            let commandMenuOptions = [];
            if (connection) {
                commandMenuOptions = [
                    commands.logout.title,
                    commands.changeConnection.title,
                    commands.showExtensionSettings.title,
                    commands.selectAndLoadProject.title,
                    "Cancel",
                ];
            } else {
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
                case commands.changeConnection.title:
                    vscode.commands.executeCommand(commands.changeConnection.command);
                    break;
                case "Cancel":
                    return;
            }
        })
    );

    let insideLogin = false; // The user may press the login button multiple times consecutively. Aviod executing the command if already inside login.
    // Register the "Login" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.login.command, async () => {
            if (insideLogin) {
                console.log("Already inside login..");
                return;
            }
            insideLogin = true;

            // Only execute the finally block after the login attempt is fully completed to avoid multiple login prompts after clicking login multiple times.
            performLogin(context, baseKey)
                .then((connectionAfterLogin: any) => {
                    // Login successful
                    if (!connectionAfterLogin) {
                        console.log("Login failed.");
                        return;
                    } else {
                        connection = connectionAfterLogin;
                    }

                    // ... other actions after successful login ...
                })
                .catch((error: any) => {
                    // Handle login error
                    console.error("Login process failed:", error);
                })
                .finally(() => {
                    // Reset insideLogin after the login attempt is fully completed
                    insideLogin = false;
                });
        })
    );

    // Register the "Logout" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.logout.command, async () => {
            if (connection) {
                await connection.logoutUser(context, projectManagementTreeDataProvider!);
                connection = null; // Clear the connection
                projectManagementTreeDataProvider = null; // Clear the tree data provider
            } else {
                vscode.window.showInformationMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Change Connection" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.changeConnection.command, async () => {
            let { newConnection, newTreeDataProvider } = await changeConnection(
                context,
                baseKey,
                connection!,
                projectManagementTreeDataProvider!
            );
            if (newConnection) {
                connection = newConnection; // Update the connection
                projectManagementTreeDataProvider = newTreeDataProvider; // Update the tree data provider
            } else {
                vscode.window.showInformationMessage("Error when changing connection.");
            }
        })
    );

    // Register the "Generate Test Cases" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.generateTestCases.command, async (item: ProjectManagementTreeItem) => {
            if (connection) {
                jsonReportHandler.startTestGenerationProcess(item, connection, baseKey);
            } else {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Make Root" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.makeRoot.command, (treeItem: ProjectManagementTreeItem) => {
            if (projectManagementTreeDataProvider) {
                // TODO: This is a bad way to find the correct tree data provider, use polymorphism / interfaces instead?
                if (
                    treeItem.contextValue === "project" ||
                    treeItem.contextValue === "version" ||
                    treeItem.contextValue === "cycle"
                ) {
                    // If we are in the project management tree, call the makeRoot method of the project management tree data provider
                    projectManagementTreeDataProvider.makeRoot(treeItem);
                } else {
                    // If we are in the test theme tree, call the makeRoot method of the test theme tree data provider
                    projectManagementTreeDataProvider.testThemeDataProvider.makeRoot(treeItem);
                }
            }
        })
    );

    // Register the "Refresh Tree" command
    // TODO: Bug or Feature? When a Tov is set root in the project management tree while the test theme tree is open,
    // and you refresh the project management tree, test theme tree elements disappears.
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.refreshTreeView.command, async () => {
            projectManagementTreeDataProvider?.clearTree();
            [projectManagementTreeDataProvider] = await initializeTreeView(
                context,
                connection!,
                projectManagementTreeDataProvider?.currentProjectKeyInView!
            );
        })
    );

    // Register the "Select And Load Project" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.selectAndLoadProject.command, async () => {
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
