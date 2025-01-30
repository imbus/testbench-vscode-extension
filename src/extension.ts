import * as vscode from "vscode";
import * as reportHandler from "./reportHandler";
import * as testBenchConnection from "./testBenchConnection";
import * as projectManagementTreeView from "./projectManagementTreeView";
import * as testBenchTypes from "./testBenchTypes";
import * as loginWebView from "./loginWebView";
import * as testBenchLogger from "./testBenchLogger";
import * as testElementsTreeView from "./testElementsTreeView";
import * as utils from "./utils";
import path from "path";

// TODO: Add progress bar for tree views when fetching elements to notify the user.
// TODO: Add progress bar for fetching cycle structure since it can take long.
// TODO: Hide the tree views initially instead of creating them and then hiding them after.
// TODO: Adjust / test workflow file for building vsix package as artifact

// Before releasing the extension:
// TODO: Add license to the extension
// TODO: Set logger level to info or debug in production
// TODO: In production, remove process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; in connection class.

// Prefix of the extension commands in package.json
export const baseKeyOfExtension: string = "testbenchExtension";
// Config variable to access the extension settings
let config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKeyOfExtension);
export function getConfig(): vscode.WorkspaceConfiguration {
    return config;
}

// All extension commands listed in package.json to avoid typos.
// A description field can be added to each command if needed in future.
export const allExtensionCommands: { [key: string]: { command: string } } = {
    displayCommand: {
        command: `${baseKeyOfExtension}.displayCommands`,
    },
    login: {
        command: `${baseKeyOfExtension}.login`,
    },
    logout: {
        command: `${baseKeyOfExtension}.logout`,
    },
    generateTestCasesForCycle: {
        command: `${baseKeyOfExtension}.generateTestCasesForCycle`,
    },
    generateTestCasesForTestThemeOrTestCaseSet: {
        command: `${baseKeyOfExtension}.generateTestCasesForTestThemeOrTestCaseSet`,
    },
    readRFTestResultsAndCreateReportWithResults: {
        command: `${baseKeyOfExtension}.readRFTestResultsAndCreateReportWithResults`,
    },
    makeRoot: {
        command: `${baseKeyOfExtension}.makeRoot`,
    },
    getServerVersions: {
        command: `${baseKeyOfExtension}.getServerVersions`,
    },
    showExtensionSettings: {
        command: `${baseKeyOfExtension}.showExtensionSettings`,
    },
    fetchReportForSelectedTreeItem: {
        command: `${baseKeyOfExtension}.fetchReportForSelectedTreeItem`,
    },
    selectAndLoadProject: {
        command: `${baseKeyOfExtension}.selectAndLoadProject`,
    },
    uploadTestResultsToTestbench: {
        command: `${baseKeyOfExtension}.uploadTestResultsToTestbench`,
    },
    readAndUploadTestResultsToTestbench: {
        command: `${baseKeyOfExtension}.readAndUploadTestResultsToTestbench`,
    },
    executeRobotFrameworkTests: {
        command: `${baseKeyOfExtension}.executeRobotFrameworkTests`,
    },
    refreshProjectTreeView: {
        command: `${baseKeyOfExtension}.refreshProjectTreeView`,
    },
    refreshTestThemeTreeView: {
        command: `${baseKeyOfExtension}.refreshTestThemeTreeView`,
    },
    setWorkspaceLocation: {
        command: `${baseKeyOfExtension}.setWorkspaceLocation`,
    },
    clearWorkspaceFolder: {
        command: `${baseKeyOfExtension}.clearWorkspaceFolder`,
    },
    toggleProjectManagementTreeViewVisibility: {
        command: `${baseKeyOfExtension}.toggleProjectManagementTreeViewVisibility`,
    },
    toggleTestThemeTreeViewVisibility: {
        command: `${baseKeyOfExtension}.toggleTestThemeTreeViewVisibility`,
    },
    toggleWebViewVisibility: {
        command: `${baseKeyOfExtension}.toggleWebViewVisibility`,
    },
    automaticLoginAfterExtensionActivation: {
        command: `${baseKeyOfExtension}.automaticLoginAfterExtensionActivation`,
    },
};

// Folder to create inside the workspace / project directory (Which is set in the extension settings) to store and process files
export const folderNameOfTestbenchWorkingDirectory: string = ".testbench";

export let logger: testBenchLogger.TestBenchLogger;

// Store the project management tree data provider to be able to access it from other files
export let projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null = null;
export function setProjectManagementTreeDataProvider(
    newProjectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null
) {
    projectManagementTreeDataProvider = newProjectManagementTreeDataProvider;
}

// Store the connection to testbench server
export let connection: testBenchConnection.PlayServerConnection | null = null;
export function setConnection(newConnection: testBenchConnection.PlayServerConnection | null) {
    connection = newConnection;
}

// Webview provider for the login webview
export let loginWebViewProvider: loginWebView.LoginWebViewProvider | null = null;

// Called when the extension is activated.
// In package.json, "activationEvents": ["onStartupFinished"] is used to activate the extension after the startup of VS Code
// because the extension needs to be fully loaded to work smoothly.
export async function activate(context: vscode.ExtensionContext) {
    // TODO: If workspace location is not set, logger cant start.
    logger = new testBenchLogger.TestBenchLogger();
    logger.info("Extension activated.");

    // Initialize the project tree data provider to avoid displaying the default text of VS Code saying that the data provider is not initialized.
    projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(null, null!);
    vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: projectManagementTreeDataProvider,
    });

    // TODO: Make this a global variable?
    // Initialize the test elements tree view
    const testElementsTreeDataProvider = new testElementsTreeView.TestElementTreeViewProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("testElementsTreeView", testElementsTreeDataProvider),
        vscode.commands.registerCommand("testElementsTreeView.refresh", () => testElementsTreeDataProvider.refresh())
    );
    vscode.window.createTreeView("testElementsTreeView", {
        treeDataProvider: testElementsTreeDataProvider,
    });
    testElementsTreeView.hideTestElementsTreeView();

    // Initialize or update extension configuration settings
    async function loadConfiguration() {
        // Update the configuration object with the latest values.
        // Without this, the configuration changes may not be updated and old values may be used.
        config = vscode.workspace.getConfiguration(baseKeyOfExtension);

        // If storePassword is set to false, delete the stored password immediately.
        // If storePassword is set to true, the password is only stored after a successful login.
        if (!config.get<boolean>("storePasswordAfterLogin", false)) {
            await testBenchConnection.clearStoredCredentials(context);
        }

        // TODO: Instead of setting a default value, leave it empty if the user wont initialize it
        // If the user wont specify a workspace location, use the first current workspace location of VS Code
        /*
        if (!config.get<string>("workspaceLocation")) {
            await config.update("workspaceLocation", vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
            logger.debug("Workspace location was not set. Initializing it to the first workspace folder of VS Code.");
        }
        */

        // Update the webview input fields after extension settings are changed to reflect the changes in the webview live
        loginWebViewProvider?.updateWebviewContent();
    }

    // Load initial configuration of the extension
    await loadConfiguration();

    // Respond to configuration changes of the user
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration(baseKeyOfExtension)) {
                await loadConfiguration();
                logger.info("Configuration updated after changes were detected.");
            }
        })
    );

    // Register login webview view provider
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    const loginWebViewDisposable = vscode.window.registerWebviewViewProvider(
        loginWebView.LoginWebViewProvider.viewId,
        loginWebViewProvider
    );
    context.subscriptions.push(loginWebViewDisposable);

    // Register the "ToggleLogin Webview visibility" command
    const toggleWebViewVisibilityCommand = vscode.commands.registerCommand(
        allExtensionCommands.toggleWebViewVisibility.command,
        loginWebView.toggleWebViewVisibility
    );
    context.subscriptions.push(toggleWebViewVisibilityCommand);
    // Hide or show the login webview based on the stored visibility state in loginWebView class on extension activation

    // This calls focus and opens (focuses to) our extension even when the user wont want to use our extension.
    // To solve this in package.json, "activationEvents" is set to "onView:testBenchExplorer" to activate the extension only when the view is opened.
    await loginWebView.updateWebViewDisplay();

    // Hide project tree view and test theme tree view when the extension starts and displays the login webview
    await vscode.commands.executeCommand("projectManagementTree.removeView");
    await vscode.commands.executeCommand("testThemeTree.removeView");

    // Prompts the user to select a workspace folder and returns its path
    async function promptForWorkspaceLocation(): Promise<string | undefined> {
        logger.debug("Prompting user to select a workspace location.");
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: "Select Workspace Location",
            canSelectFolders: true,
            canSelectFiles: false,
            title: "Select Workspace Location",
        };

        const folderUri: vscode.Uri[] | undefined = await vscode.window.showOpenDialog(options);
        if (folderUri && folderUri[0]) {
            logger.debug(`Workspace location selected in selection prompt: ${folderUri[0].fsPath}`);
            return folderUri[0].fsPath;
        }
        logger.debug("No workspace location selected.");
        return undefined;
    }

    // Register the "Set Workspace Location" command.
    // Prompt the user to select a workspace location and update the workspace configuration with the selected path.
    context.subscriptions.push(
        vscode.commands.registerCommand(`${baseKeyOfExtension}.setWorkspaceLocation`, async () => {
            logger.debug("Set Workspace Location command called.");
            const newWorkspaceLocation: string | undefined = await promptForWorkspaceLocation();
            if (newWorkspaceLocation) {
                await config.update("workspaceLocation", newWorkspaceLocation);
                vscode.window.showInformationMessage(`Workspace location set to: ${newWorkspaceLocation}`);
                logger.debug(`Workspace location in extension settings set to: ${newWorkspaceLocation}`);
            }

            logger.trace("End of Set Workspace Location command.");
        })
    );

    // Register "Show Extension Settings" command.
    // Opens the settings UI of the extension inside the settings editor.
    context.subscriptions.push(
        vscode.commands.registerCommand(allExtensionCommands.showExtensionSettings.command, async () => {
            logger.debug("Show Extension Settings command called.");
            // Open the settings UI of the extension inside the settings editor
            await vscode.commands
                .executeCommand("workbench.action.openSettings2", {
                    query: "@ext:imbus.testbench-visual-studio-code-extension",
                })
                .then(async () => {
                    // Open the workspace settings view (The default settings view is user settings)
                    await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
                });
            logger.trace("End of Show Extension Settings command.");
        })
    );

    // The connectionActive context value is used to enable or disable the login and logout buttons in the status bar,
    // which allows icon changes for login/logout buttons based on connection status.
    await vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", connection !== null);
    logger.trace(`Context value connectionActive set to: ${connection !== null}`);

    // Register "Automatic login" command.
    // If the user has stored credentials, automatically log in when the extension is activated and display the project selection and project tree.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            allExtensionCommands.automaticLoginAfterExtensionActivation.command,
            async () => {
                if (config.get<boolean>("automaticLoginAfterExtensionActivation", false)) {
                    logger.debug("Automatic login command called.");
                    if (await testBenchConnection.performLogin(context, baseKeyOfExtension, false, true)) {
                        projectManagementTreeView.displayProjectManagementTreeView();
                        await vscode.commands.executeCommand(`${allExtensionCommands.selectAndLoadProject.command}`);
                    }

                    // TODO: Dont continue if perform login fails
                    // TODO: The user probably wont use VS Code just for this extension, dont prompt for project selection automatically?
                }
            }
        )
    );

    // The user may press the login button multiple times consecutively which may cause multiple login processes to run at the same time.
    // Aviod executing the command again if we are already inside login command.
    let isLoginProcessAlreadyRunning: boolean = false;
    // Register the "Login" command.
    // Perform the login process and store the connection object.
    context.subscriptions.push(
        vscode.commands.registerCommand(allExtensionCommands.login.command, async () => {
            logger.debug(`Login command called.`);
            if (isLoginProcessAlreadyRunning) {
                logger.debug(`Login process is already running.`);

                // If (somehow) login flag is stuck and set to true, reset the isLoginProcessAlreadyRunning flag after 10 seconds to avoid blocking the login process.
                setTimeout(() => {
                    isLoginProcessAlreadyRunning = false;
                    logger.trace(`isLoginProcessAlreadyRunning flag reset after 10 seconds.`);
                }, 5 * 1000);
                return;
            }
            isLoginProcessAlreadyRunning = true;

            // Only execute the finally block after the login attempt is fully completed to avoid multiple login prompts after clicking login multiple times.
            const performLoginResult = await testBenchConnection
                .performLogin(context, baseKeyOfExtension)
                .catch((error: any) => {
                    logger.error(`Login process failed: ${error}`);
                })
                .finally(() => {
                    // Reset isLoginProcessAlreadyRunning after the login attempt is fully completed
                    isLoginProcessAlreadyRunning = false;
                    logger.trace(`insideLogin flag reset after login attempt.`);
                });

            // If login was successful and not null, open project selection after logging in, this command also takes care of the visibility of the tree views
            if (performLoginResult) {
                await vscode.commands.executeCommand(`${allExtensionCommands.selectAndLoadProject.command}`);
            }

            logger.trace(`End of Login command.`);
        })
    );

    // Register the "Logout" command.
    // Performs the logout process, clears the connection object and shows the login webview.
    context.subscriptions.push(
        vscode.commands.registerCommand(allExtensionCommands.logout.command, async () => {
            logger.debug(`Logout command called.`);
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.warn(`Logout command is called without a connection.`);
                return;
            }

            await connection.logoutUser(projectManagementTreeDataProvider!);

            // Display the login webview and hide the tree views after logging out
            loginWebView.displayWebView();
            projectManagementTreeView.hideProjectManagementTreeView();
            projectManagementTreeView.hideTestThemeTreeView();

            logger.trace(`End of Logout command.`);
        })
    );

    // Register the "Generate Test Cases For Cycle" command, which is activated for a cycle element in the tree view.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            allExtensionCommands.generateTestCasesForCycle.command,
            async (item: projectManagementTreeView.TestbenchTreeItem) => {
                logger.debug(`Generate Test Cases For Cycle command called.`);
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

                // Clear the working directory before starting the test generation process if the configuration is set
                if (config.get<boolean>("clearWorkingDirectoryBeforeTestGeneration")) {
                    await vscode.commands.executeCommand(allExtensionCommands.clearWorkspaceFolder.command);
                }

                // If the user did not clicked on a test cycle in the tree view before,
                // the test cycle wont have any initialized children so that test themes cannot be displayed in the quickpick.
                // Call getChildrenOfCycle to initialize the sub elements (Test themes etc.) of the cycle.
                // Offload the children of the cycle to the Test Theme Tree View.
                if (projectManagementTreeDataProvider?.testThemeDataProvider) {
                    const children = (await projectManagementTreeDataProvider.getChildrenOfCycle(item)) ?? [];
                    projectManagementTreeDataProvider.testThemeDataProvider.setRoots(children);
                }

                await reportHandler.startTestGenerationForCycle(
                    context,
                    item,
                    baseKeyOfExtension,
                    folderNameOfTestbenchWorkingDirectory
                );
                logger.trace(`End of Generate Test Cases For Cycle command.`);
            }
        )
    );

    // Register the "Fetch Report" command for a tree element.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            allExtensionCommands.fetchReportForSelectedTreeItem.command,
            async (treeItem: projectManagementTreeView.TestbenchTreeItem) => {
                await reportHandler.fetchReportForTreeElement(
                    treeItem,
                    projectManagementTreeDataProvider,
                    folderNameOfTestbenchWorkingDirectory
                );
            }
        )
    );

    // Register the "Generate Tests For Test Theme or Test Case Set" command.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet.command,
            async (treeItem: projectManagementTreeView.TestbenchTreeItem) => {
                logger.debug(`Generate Test Cases For Test Theme or Test Case Set command called.`);
                if (!connection) {
                    vscode.window.showErrorMessage("No connection available. Please log in first.");
                    logger.warn(`generateTestCasesForTestThemeOrTestCaseSet command is called without a connection.`);
                    return;
                }

                // Clear the working directory before starting the test generation process if the configuration is set
                if (config.get<boolean>("clearWorkingDirectoryBeforeTestGeneration")) {
                    await vscode.commands.executeCommand(allExtensionCommands.clearWorkspaceFolder.command);
                }

                await reportHandler.generateRobotFrameworkTestsForTestThemeOrTestCaseSet(
                    context,
                    treeItem,
                    folderNameOfTestbenchWorkingDirectory
                );
                logger.trace(`End of Generate Test Cases For Test Theme or Test Case Set command.`);
            }
        )
    );

    // Register the "Select And Load Project" command.
    // Fetches the projects list from the server and prompts the user to select a project to display its contents in the tree view.
    context.subscriptions.push(
        vscode.commands.registerCommand(allExtensionCommands.selectAndLoadProject.command, async () => {
            logger.debug(`Select And Load Project command called.`);
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

            const selectedProjectKey: string | null = await connection.getProjectKeyFromProjectListQuickPickSelection(
                projectList
            );

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
            // Initializes and displays the project management tree view with the selected project
            [projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeViews(
                context,
                connection,
                selectedProjectKey!
            );
            logger.trace(
                `End of Select And Load Project command command. Project with key ${selectedProjectKey} is loaded into the project management tree view.`
            );
        })
    );

    // Register the "Toggle project management tree view visibility" command
    context.subscriptions.push(
        vscode.commands.registerCommand(
            allExtensionCommands.toggleProjectManagementTreeViewVisibility.command,
            async () => {
                await projectManagementTreeView.toggleProjectManagementTreeViewVisibility();
            }
        )
    );

    // Register the "Toggle test theme tree view visibility" command
    context.subscriptions.push(
        vscode.commands.registerCommand(allExtensionCommands.toggleTestThemeTreeViewVisibility.command, async () => {
            await projectManagementTreeView.toggleTestThemeTreeViewVisibility();
        })
    );

    // Register the "Read Test Results" command, which is activated for a test theme or test case set element.
    // Reads the test results from the testbench working directory and creates a report with the results.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            allExtensionCommands.readRFTestResultsAndCreateReportWithResults.command,
            async () => {
                logger.debug(`Read RF Test Results And Create Report With Results command called.`);
                if (!connection) {
                    vscode.window.showErrorMessage("No connection available. Please log in first.");
                    logger.warn(`readRFTestResultsAndCreateReportWithResults command is called without a connection.`);
                    return;
                }
                await reportHandler.fetchTestResultsAndCreateReportWithResultsWithTb2Robot(
                    context,
                    folderNameOfTestbenchWorkingDirectory
                );
                logger.trace(`End of Read RF Test Results And Create Report With Results command.`);
            }
        )
    );

    // TODO: Only display the command icon if the user is able to import?
    // Register the "Upload Test Results To Testbench" to TestBench command.
    // Uploads the selected test results for a test cycle to the testbench server.
    context.subscriptions.push(
        vscode.commands.registerCommand(allExtensionCommands.uploadTestResultsToTestbench.command, async () => {
            logger.debug(`Upload Test Results To Testbench command called.`);
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
            logger.trace(`End of Upload Test Results To Testbench command.`);
        })
    );

    // Register the automated "Read Tests, Create Results & Upload Results to TestBench" command.
    context.subscriptions.push(
        vscode.commands.registerCommand(allExtensionCommands.readAndUploadTestResultsToTestbench.command, async () => {
            logger.debug(`Read And Upload Test Results To Testbench command called.`);
            await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(
                context,
                folderNameOfTestbenchWorkingDirectory,
                projectManagementTreeDataProvider
            );
            logger.trace(`End of Read And Upload Test Results To Testbench command.`);
        })
    );

    // Register the "Refresh Project Tree" command.
    context.subscriptions.push(
        vscode.commands.registerCommand(allExtensionCommands.refreshProjectTreeView.command, async () => {
            logger.debug(`Refresh Project Tree command called.`);
            // projectManagementTreeDataProvider?.clearTree();
            [projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeViews(
                context,
                connection!,
                projectManagementTreeDataProvider?.currentProjectKeyInView!
            );
            logger.trace(`End of Refresh Project Tree command.`);
        })
    );

    // Register the "Refresh Test Theme Tree" command
    context.subscriptions.push(
        vscode.commands.registerCommand(allExtensionCommands.refreshTestThemeTreeView.command, async () => {
            logger.debug(`Refresh Test Theme Tree command called.`);
            projectManagementTreeDataProvider?.testThemeDataProvider.refresh();

            let cycleElement: projectManagementTreeView.TestbenchTreeItem | undefined =
                projectManagementTreeDataProvider?.testThemeDataProvider?.rootElements[0]?.parent!;
            if (cycleElement && cycleElement.contextValue === "Cycle") {
                // Clear the test theme tree when a cycle is expanded so that clicking on a new test cycle will not show the old test themes
                // projectManagementTreeDataProvider?.testThemeDataProvider?.clearTree();
                // Fetch the test themes from the server
                const children: projectManagementTreeView.TestbenchTreeItem[] =
                    (await projectManagementTreeDataProvider?.getChildrenOfCycle(cycleElement)) ?? [];
                projectManagementTreeDataProvider?.testThemeDataProvider?.setRoots(children);
            }
            logger.trace(`End of Refresh Test Tree command.`);
        })
    );

    // Register the "Make Root" command.
    // Makes the selected tree item the root of the tree.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            allExtensionCommands.makeRoot.command,
            (treeItem: projectManagementTreeView.TestbenchTreeItem) => {
                logger.debug(`Make Root command called for tree item:`, treeItem);
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
                logger.trace(`End of Make Root command.`);
            }
        )
    );

    // TODO: If workspace location is not set, and if we prompt the user to set it here, and the user selects no,
    // in test generation, we check this again and the modal dialog is opened twice
    
    // Register the "Clear Workspace Folder" command.
    // Clears the workspace folder of its contents, excluding log files.
    context.subscriptions.push(
        vscode.commands.registerCommand(allExtensionCommands.clearWorkspaceFolder.command, async () => {
            logger.debug(`Clear Workspace Folder command called.`);
            const workspaceLocationInExtensionSettings = config.get<string>("workspaceLocation", "");
            if (!workspaceLocationInExtensionSettings) {
                const workspaceLocationNotSetError : string = "No workspace location set. Please set the workspace location first.";
                vscode.window.showErrorMessage(workspaceLocationNotSetError);
                logger.warn(workspaceLocationNotSetError);                
                return;
            }

            const testbenchWorkingDirectoryPath = path.join(
                workspaceLocationInExtensionSettings,
                folderNameOfTestbenchWorkingDirectory
            );
            await utils.clearWorkspaceFolder(
                testbenchWorkingDirectoryPath,
                [testBenchLogger.folderNameOfLogs],
                !config.get<boolean>("clearWorkingDirectoryBeforeTestGeneration")
            );
            logger.trace(`End of Clear Workspace Folder command.`);
        })
    );

    // TODO: Remove?
    // Try to automatically login the user after the extension is activated if the setting is enabled
    await vscode.commands.executeCommand(`${allExtensionCommands.automaticLoginAfterExtensionActivation.command}`);
}

export async function deactivate() {
    // Gracefully logout the user when the extension is deactivated.
    await connection?.logoutUser(projectManagementTreeDataProvider!);
    // TODO: Clear the testbench working directory contents when the extension is deactivated?
    logger.info("Extension deactivated.");
}
