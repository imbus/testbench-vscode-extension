import * as vscode from "vscode";
import * as reportHandler from "./reportHandler";
import * as testBenchConnection from "./testBenchConnection";
import * as projectManagementTreeView from "./projectManagementTreeView";
import * as testBenchTypes from "./testBenchTypes";
import path from "path";
import { TestBenchLogger } from "./testBenchLogger";

export const baseKey: string = "testbenchExtension"; // Prefix of the commands in package.json
export let logger: TestBenchLogger;
export let projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null = null; // Store the tree data provider
export function setProjectManagementTreeDataProvider(
    newProjectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null
) {
    projectManagementTreeDataProvider = newProjectManagementTreeDataProvider;
}
export let connection: testBenchConnection.PlayServerConnection | null = null; // Store the connection to server
export function setConnection(newConnection: testBenchConnection.PlayServerConnection | null) {
    connection = newConnection;
}
export const folderNameOfTestbenchWorkingDirectory: string = ".testbench"; // Folder to create under the working directory to download / process files

export let lastGeneratedReportParams: testBenchTypes.LastGeneratedReportParams = {
    executionBased: undefined,
    projectKey: undefined,
    cycleKey: undefined,
    UID: undefined,
};

export async function activate(context: vscode.ExtensionContext) {
    const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKey);
    logger = new TestBenchLogger();
    logger.info("Extension activated.");

    // Store extension commands
    const commands: { [key: string]: { command: string } } = {
        displayCommands: {
            command: `${baseKey}.displayCommands`
        },
        login: {
            command: `${baseKey}.login`
        },
        changeConnection: {
            command: `${baseKey}.changeConnection`,
        },
        logout: {
            command: `${baseKey}.logout`
        },
        generateTestCasesForCycle: {
            command: `${baseKey}.generateTestCasesForCycle`
        },
        generateTestCasesForTestThemeOrTestCaseSet: {
            command: `${baseKey}.generateTestCasesForTestThemeOrTestCaseSet`
        },
        readRFTestResultsAndCreateReportWithResults: {
            command: `${baseKey}.readRFTestResultsAndCreateReportWithResults`
        },
        makeRoot: {
            command: `${baseKey}.makeRoot`
        },
        getCycleStructure: {
            command: `${baseKey}.getCycleStructure`
        },
        getServerVersions: {
            command: `${baseKey}.getServerVersions`
        },
        showExtensionSettings: {
            command: `${baseKey}.showExtensionSettings`
        },
        fetchReportForSelectedTreeItem: {
            command: `${baseKey}.fetchReportForSelectedTreeItem`
        },
        selectAndLoadProject: {
            command: `${baseKey}.selectAndLoadProject`
        },
        uploadTestResultsToTestbench: {
            command: `${baseKey}.uploadTestResultsToTestbench`
        },
        readAndUploadTestResultsToTestbench: {
            command: `${baseKey}.readAndUploadTestResultsToTestbench`
        },
        executeRobotFrameworkTests: {
            command: `${baseKey}.executeRobotFrameworkTests`
        },
        refreshProjectTreeView: {
            command: `${baseKey}.refreshProjectTreeView`
        },
        refreshTestTreeView: {
            command: `${baseKey}.refreshTestTreeView`
        },
        setWorkspaceLocation: {
            command: `${baseKey}.setWorkspaceLocation`
        },
    };

    // Initialize or update extension configuration settings
    async function loadConfiguration() {
        // If storePassword is false, delete the stored password.
        // The password is only stored after a successful login.
        if (!config.get<boolean>("storePasswordAfterLogin", false)) {
            await testBenchConnection.clearStoredCredentials(context);
        }

        // If the user wont specify a workspace location, use the workspace location of VS Code
        if (!config.get<string>("workspaceLocation")) {
            await config.update("workspaceLocation", vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
        }

        if (config.get<boolean>("useDefaultValuesForTestbench2robotframework")) {
            // For testbench2robotframework configuration, set the generation and resource directory relative to the workspace location
            let defaultTestbench2robotframeworkConfig: testBenchTypes.Testbench2robotframeworkConfiguration =
                testBenchTypes.defaultTestbench2robotframeworkConfig;
            defaultTestbench2robotframeworkConfig.generationDirectory = path.join(
                config.get<string>("workspaceLocation")!,
                folderNameOfTestbenchWorkingDirectory,
                "Generated"
            );
            defaultTestbench2robotframeworkConfig.resourceDirectory = path.join(
                config.get<string>("workspaceLocation")!,
                "resources"
            );
            await config.update("testbench2robotframeworkConfig", defaultTestbench2robotframeworkConfig);
            // console.log("Updated testbench2robotframeworkConfig with default values.");
            logger.debug("Updated testbench2robotframeworkConfig with default values.");
        }
    }

    // Load initial configuration
    await loadConfiguration();

    // Respond to configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration(baseKey)) {
                await loadConfiguration();
                // console.log("Configuration updated.");
                logger.info("Configuration updated.");
            }
        })
    );

    // Prompts the user to select a folder and returns its path
    async function promptForWorkspaceLocation(): Promise<string | undefined> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: "Select Workspace Location",
            canSelectFolders: true,
            canSelectFiles: false,
        };

        const folderUri: vscode.Uri[] | undefined = await vscode.window.showOpenDialog(options);
        if (folderUri && folderUri[0]) {
            return folderUri[0].fsPath;
        }
        return undefined;
    }

    // Register the "Set Workspace Location" command
    context.subscriptions.push(
        vscode.commands.registerCommand(`${baseKey}.setWorkspaceLocation`, async () => {
            const newWorkspaceLocation: string | undefined = await promptForWorkspaceLocation();
            if (newWorkspaceLocation) {
                const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKey);
                await config.update("workspaceLocation", newWorkspaceLocation);
                vscode.window.showInformationMessage(`Workspace location set to: ${newWorkspaceLocation}`);
                logger.debug(`Workspace location set to: ${newWorkspaceLocation}`);
            }
        })
    );

    // Register "Show Extension Settings" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.showExtensionSettings.command, () => {
            // Open the settings UI of the extension inside the settings editor
            vscode.commands
                .executeCommand("workbench.action.openSettings2", {
                    query: "@ext:imbus.testbench-visual-studio-code-extension",
                })
                .then(() => {
                    // Open the workspace settings view (The default settings view is user settings)
                    vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
                });
            logger.debug("Extension settings opened.");
        })
    );
    // Login/Logout icon changes based on connection status
    vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", connection !== null);
    logger.debug(`Context value connectionActive set to: ${connection !== null}`);

    // The user may press the login button multiple times consecutively. Aviod executing the command again if already inside login.
    let insideLogin: boolean = false;
    // Register the "Login" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.login.command, async () => {
            if (insideLogin) {
                // console.log("Already inside login..");
                logger.debug(`Login process is already running.`);

                // If somehow login is stuck, reset the insideLogin flag after 10 seconds to avoid blocking the login process.
                setTimeout(() => {
                    insideLogin = false;
                    logger.debug(`insideLogin flag reset after 10 seconds.`);
                }, 5 * 1000);
                return;
            }
            insideLogin = true;

            // Only execute the finally block after the login attempt is fully completed to avoid multiple login prompts after clicking login multiple times.
            await testBenchConnection
                .performLogin(context, baseKey)
                .catch((error: any) => {
                    // console.error("Login process failed:", error);
                    logger.error(`Login process failed: ${error}`, true);
                })
                .finally(() => {
                    // Reset insideLogin after the login attempt is fully completed
                    insideLogin = false;
                    logger.debug(`insideLogin flag reset after login attempt.`);
                });
        })
    );

    // Register the "Logout" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.logout.command, async () => {
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.warn(`Logout command is called without a connection.`);
                return;
            }

            await connection.logoutUser(projectManagementTreeDataProvider!);
        })
    );

    // Register the "Generate Tests" command, which is activated for a cycle element
    context.subscriptions.push(
        vscode.commands.registerCommand(
            commands.generateTestCasesForCycle.command,
            async (item: projectManagementTreeView.TestbenchTreeItem) => {
                if (!connection) {
                    vscode.window.showErrorMessage("No connection available. Please log in first.");
                    logger.warn(`generateTestCasesForCycle command is called without a connection.`);
                    return;
                }

                if (!projectManagementTreeDataProvider) {
                    vscode.window.showErrorMessage(
                        "Project management tree is not initialized. Please select a project first."
                    );
                    logger.warn(`generateTestCasesForCycle command is called without a project data provider.`);
                    return;
                }

                // If the user did not clicked on a test cycle, test cycle wont have any children so that test themes cannot be displayed in the quickpick.
                // Call getChildrenOfCycle initialize the sub elements of the cycle.
                // Offload the children of the cycle to the Test Theme Tree
                if (projectManagementTreeDataProvider?.testThemeDataProvider) {
                    const children = (await projectManagementTreeDataProvider.getChildrenOfCycle(item)) ?? [];
                    projectManagementTreeDataProvider.testThemeDataProvider.setRoots(children);
                }

                await reportHandler.startTestGenerationProcessForCycle(
                    context,
                    item,
                    baseKey,
                    folderNameOfTestbenchWorkingDirectory
                );
            }
        )
    );

    // Register the "Fetch Report" command for a tree element
    context.subscriptions.push(
        vscode.commands.registerCommand(
            commands.fetchReportForSelectedTreeItem.command,
            async (treeItem: projectManagementTreeView.TestbenchTreeItem) => {
                await reportHandler.callFetchReportForTreeElement(
                    treeItem,
                    projectManagementTreeDataProvider,
                    folderNameOfTestbenchWorkingDirectory
                );
            }
        )
    );

    // Register the "Generate Tests For Test Theme or Test Case Set" command, which is activated for a test theme element
    context.subscriptions.push(
        vscode.commands.registerCommand(
            commands.generateTestCasesForTestThemeOrTestCaseSet.command,
            async (treeItem: projectManagementTreeView.TestbenchTreeItem) => {
                if (!connection) {
                    vscode.window.showErrorMessage("No connection available. Please log in first.");
                    logger.warn(`generateTestCasesForTestThemeOrTestCaseSet command is called without a connection.`);
                    return;
                }
                await reportHandler.generateTestCasesForTestThemeOrTestCaseSet(
                    context,
                    treeItem,
                    folderNameOfTestbenchWorkingDirectory
                );
            }
        )
    );

    // Register the "Select And Load Project" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.selectAndLoadProject.command, async () => {
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.warn(`selectAndLoadProject command is called without a connection.`);
                return;
            }
            const projectList: testBenchTypes.Project[] | null = await connection.getProjectsList();

            if (!projectList) {
                // vscode.window.showErrorMessage("No projects found..");
                logger.warn(`No projects found for the selectAndLoadProject command.`);
                return;
            }

            const selectedProjectKey: string | null = await connection.selectProjectKeyFromProjectList(projectList);

            if (!selectedProjectKey) {
                // vscode.window.showErrorMessage("No project selected..");
                logger.warn(`No project selected for the selectAndLoadProject command.`);
                return;
            }

            projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(
                connection,
                selectedProjectKey!
            );
            vscode.window.createTreeView("projectManagementTree", {
                treeDataProvider: projectManagementTreeDataProvider,
            });
            [projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeView(
                context,
                connection,
                selectedProjectKey!
            );
        })
    );

    // Register the "Read Test Results" command, which is activated for a test theme or test case set element
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.readRFTestResultsAndCreateReportWithResults.command, async () => {
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.warn(`readRFTestResultsAndCreateReportWithResults command is called without a connection.`);
                return;
            }

            await reportHandler.readTestResultsAndCreateReportWithResults(
                context,
                folderNameOfTestbenchWorkingDirectory
            );
        })
    );

    // Register the Upload Test Results to TestBench command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.uploadTestResultsToTestbench.command, async () => {
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.warn(`uploadTestResultsToTestbench command is called without a connection.`);
                return;
            }

            if (!projectManagementTreeDataProvider || !projectManagementTreeDataProvider.currentProjectKeyInView) {
                vscode.window.showErrorMessage("No project selected. Please select a project first.");
                logger.warn(`uploadTestResultsToTestbench command is called without a selected project.`);
                return;
            }

            await testBenchConnection.selectReportWithResultsAndImportToTestbench(
                connection,
                projectManagementTreeDataProvider
            );
        })
    );

    // Register the automated "Read Tests & Upload Results to TestBench" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.readAndUploadTestResultsToTestbench.command, async () => {
            await reportHandler.readTestsAndCreateResultsAndImportToTestbench(
                context,
                folderNameOfTestbenchWorkingDirectory,
                projectManagementTreeDataProvider
            );
        })
    );

    // Register the "Refresh Project Tree" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.refreshProjectTreeView.command, async () => {
            projectManagementTreeDataProvider?.clearTree();
            [projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeView(
                context,
                connection!,
                projectManagementTreeDataProvider?.currentProjectKeyInView!
            );
        })
    );

    // Register the "Refresh Test Tree" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.refreshTestTreeView.command, async () => {
            projectManagementTreeDataProvider?.testThemeDataProvider.refresh();

            let cycleElement: projectManagementTreeView.TestbenchTreeItem | undefined =
                projectManagementTreeDataProvider?.testThemeDataProvider?.rootElements[0]?.parent!;
            if (cycleElement && cycleElement.contextValue === "Cycle") {
                // Clear the test theme tree when a cycle is expanded so that clicking on a new test cycle will not show the old test themes
                projectManagementTreeDataProvider?.testThemeDataProvider?.clearTree();
                // Fetch the test themes from the server
                const children: projectManagementTreeView.TestbenchTreeItem[] =
                    (await projectManagementTreeDataProvider?.getChildrenOfCycle(cycleElement)) ?? [];
                projectManagementTreeDataProvider?.testThemeDataProvider?.setRoots(children);
            }
        })
    );

    // Register the "Make Root" command
    context.subscriptions.push(
        vscode.commands.registerCommand(
            commands.makeRoot.command,
            (treeItem: projectManagementTreeView.TestbenchTreeItem) => {
                if (projectManagementTreeDataProvider) {
                    // Find out for which element the make root command is called
                    if (
                        treeItem.contextValue === "Project" ||
                        treeItem.contextValue === "Version" ||
                        treeItem.contextValue === "Cycle"
                    ) {
                        // If we are in the project management tree, call the makeRoot method of the project management tree data provider
                        projectManagementTreeDataProvider.makeRoot(treeItem);
                    } else {
                        // If we are in the test theme tree, call the makeRoot method of the test theme tree data provider
                        projectManagementTreeDataProvider.testThemeDataProvider.makeRoot(treeItem);
                    }
                }
            }
        )
    );

    // Uncomment this if you want to prompt the user to log in when the extension activates
    // vscode.commands.executeCommand(`${baseKey}.login`);
}

export async function deactivate() {
    // Gracefully logout the user when the extension is deactivated
    await connection?.logoutUser(projectManagementTreeDataProvider!);
    logger.info("Extension deactivated.");
}
