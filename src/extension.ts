/**
 * @file extension.ts
 * @description Main entry point for the TestBench VS Code extension.
 */

// TODO: Add progress bar for tree views when fetching elements to notify the user.
// TODO: Add progress bar for fetching cycle structure since it can take long.
// TODO: If possible, hide the tree views initially instead of creating them and then hiding them after.
// TODO: The user generated tests, executed the tests, and restarted he extension. Last generated test params are now invalid due to restart, and he cant import.

// Before releasing the extension:
// TODO: Add license to the extension
// TODO: Set logger level to info or debug in production
// TODO: In production, remove process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; in connection class.

import * as vscode from "vscode";
import * as testBenchLogger from "./testBenchLogger";
import * as testBenchTypes from "./testBenchTypes";
import * as testBenchConnection from "./testBenchConnection";
import * as reportHandler from "./reportHandler";
import * as projectManagementTreeView from "./projectManagementTreeView";
import * as testElementsTreeView from "./testElementsTreeView";
import * as loginWebView from "./loginWebView";
import * as utils from "./utils";
import path from "path";

/* =============================================================================
   Constants, Global Variables & Exports
   ============================================================================= */

/** Prefix of the extension commands and settings in package.json*/
export const baseKeyOfExtension: string = "testbenchExtension";

/** Workspace configuration for the extension. */
let config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKeyOfExtension);
export function getConfig(): vscode.WorkspaceConfiguration {
    return config;
}

/**
 * All extension commands (as defined in package.json) to avoid typos.
 * Each command can be extended later with additional metadata such as description.
 */
export const allExtensionCommands: { [key: string]: { command: string } } = {
    displayCommand: { command: `${baseKeyOfExtension}.displayCommands` },
    login: { command: `${baseKeyOfExtension}.login` },
    logout: { command: `${baseKeyOfExtension}.logout` },
    generateTestCasesForCycle: { command: `${baseKeyOfExtension}.generateTestCasesForCycle` },
    generateTestCasesForTestThemeOrTestCaseSet: {
        command: `${baseKeyOfExtension}.generateTestCasesForTestThemeOrTestCaseSet`,
    },
    readRFTestResultsAndCreateReportWithResults: {
        command: `${baseKeyOfExtension}.readRFTestResultsAndCreateReportWithResults`,
    },
    makeRoot: { command: `${baseKeyOfExtension}.makeRoot` },
    getServerVersions: { command: `${baseKeyOfExtension}.getServerVersions` },
    showExtensionSettings: { command: `${baseKeyOfExtension}.showExtensionSettings` },
    fetchReportForSelectedTreeItem: { command: `${baseKeyOfExtension}.fetchReportForSelectedTreeItem` },
    selectAndLoadProject: { command: `${baseKeyOfExtension}.selectAndLoadProject` },
    uploadTestResultsToTestbench: { command: `${baseKeyOfExtension}.uploadTestResultsToTestbench` },
    readAndUploadTestResultsToTestbench: { command: `${baseKeyOfExtension}.readAndUploadTestResultsToTestbench` },
    executeRobotFrameworkTests: { command: `${baseKeyOfExtension}.executeRobotFrameworkTests` },
    refreshProjectTreeView: { command: `${baseKeyOfExtension}.refreshProjectTreeView` },
    refreshTestThemeTreeView: { command: `${baseKeyOfExtension}.refreshTestThemeTreeView` },
    setWorkspaceLocation: { command: `${baseKeyOfExtension}.setWorkspaceLocation` },
    clearWorkspaceFolder: { command: `${baseKeyOfExtension}.clearWorkspaceFolder` },
    toggleProjectManagementTreeViewVisibility: {
        command: `${baseKeyOfExtension}.toggleProjectManagementTreeViewVisibility`,
    },
    toggleTestThemeTreeViewVisibility: { command: `${baseKeyOfExtension}.toggleTestThemeTreeViewVisibility` },
    toggleWebViewVisibility: { command: `${baseKeyOfExtension}.toggleWebViewVisibility` },
    automaticLoginAfterExtensionActivation: { command: `${baseKeyOfExtension}.automaticLoginAfterExtensionActivation` },
    refreshTestElementsTree: { command: `${baseKeyOfExtension}.refreshTestElementsTree` },
    displayInteractionsForSelectedTOV: { command: `${baseKeyOfExtension}.displayInteractionsForSelectedTOV` },
    goToTestElementFile: { command: `${baseKeyOfExtension}.goToTestElementFile` },
};

/** Name of the working folder (inside the workspace folder) used by TestBench to store and process files internally. */
export const folderNameOfTestbenchWorkingDirectory: string = ".testbench";

/** Global logger instance. */
export let logger: testBenchLogger.TestBenchLogger;

/** Global project management tree data provider. */
export let projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null = null;
export function setProjectManagementTreeDataProvider(
    newProjectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null
): void {
    projectManagementTreeDataProvider = newProjectManagementTreeDataProvider;
}

/** Global connection to the (new) TestBench Play server. */
export let connection: testBenchConnection.PlayServerConnection | null = null;
export function setConnection(newConnection: testBenchConnection.PlayServerConnection | null): void {
    connection = newConnection;
}

/** Global login webview provider instance. */
export let loginWebViewProvider: loginWebView.LoginWebViewProvider | null = null;

/** Global tree views. */
export let testElementTreeView: vscode.TreeView<testElementsTreeView.TestElementItem>;
export let projectTreeView: vscode.TreeView<projectManagementTreeView.ProjectManagementTreeItem>;
export function setProjectTreeView(
    newProjectTreeView: vscode.TreeView<projectManagementTreeView.ProjectManagementTreeItem>
): void {
    projectTreeView = newProjectTreeView;
}

/**
 * Global Test Elements Tree Data Provider.
 * Declared here so it can be referenced from command handlers.
 */
export let testElementsTreeDataProvider: testElementsTreeView.TestElementsTreeDataProvider;

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
export function safeCommandHandler(handler: (...args: any[]) => any): (...args: any[]) => Promise<void> {
    return async (...args: any[]) => {
        try {
            await handler(...args);
        } catch (error) {
            logger.error("Error executing command:", error);
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
function registerSafeCommand(
    context: vscode.ExtensionContext,
    commandId: string,
    callback: (...args: any[]) => any
): void {
    const disposable = vscode.commands.registerCommand(commandId, safeCommandHandler(callback));
    // Adding the command to the context subscriptions disposes them automatically when the extension is deactivated.
    context.subscriptions.push(disposable);
}

/**
 * Prompts the user to select a workspace location (folder).
 *
 * @returns The selected folder path, or undefined if none selected.
 */
export async function promptForWorkspaceLocation(): Promise<string | undefined> {
    logger.debug("Prompting user to select a workspace location.");
    const options: vscode.OpenDialogOptions = {
        canSelectMany: false,
        openLabel: "Select Workspace Location",
        canSelectFolders: true,
        canSelectFiles: false,
        title: "Select Workspace Location",
    };

    const folderUris = await vscode.window.showOpenDialog(options);
    if (folderUris && folderUris[0]) {
        logger.debug(`Workspace location selected: ${folderUris[0].fsPath}`);
        return folderUris[0].fsPath;
    }
    logger.debug("No workspace location selected.");
    return undefined;
}

/**
 * Loads the latest extension configuration.
 *
 * @param context The extension context.
 */
export async function loadConfiguration(context: vscode.ExtensionContext): Promise<void> {
    // Update the configuration object with the latest values.
    // Without this, the configuration changes may not be updated and old values may be used.
    config = vscode.workspace.getConfiguration(baseKeyOfExtension);

    // If storePassword is set to false, delete the stored password immediately.
    // If storePassword is set to true, the password is only stored after a successful login.
    if (!config.get<boolean>("storePasswordAfterLogin", false)) {        
        await testBenchConnection?.clearStoredCredentials(context);
    }

    // Update the webview input fields after extension settings are changed to reflect the changes in the webview live
    loginWebViewProvider?.updateWebviewContent();
}

/**
 * Initializes the tree views used by the extension. 
 */
export function initializeTreeViews(): void {
    // Initialize project management tree view.
    projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(null!);
    projectTreeView = vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: projectManagementTreeDataProvider,
    });

    // Initialize test elements tree view.
    testElementsTreeDataProvider = new testElementsTreeView.TestElementsTreeDataProvider();
    testElementTreeView = vscode.window.createTreeView("testElementsView", {
        treeDataProvider: testElementsTreeDataProvider,
    });
    vscode.window.registerTreeDataProvider("testElementsView", testElementsTreeDataProvider);
    // Hide the test elements tree view initially.
    testElementsTreeView.hideTestElementsTreeView();
}

/**
 * Registers all the commands defined by the extension.
 *
 * @param context The extension context.
 */
function registerExtensionCommands(context: vscode.ExtensionContext): void {
    // --- Command: Toggle Login Webview Visibility ---
    registerSafeCommand(
        context,
        allExtensionCommands.toggleWebViewVisibility.command,
        loginWebView.toggleWebViewVisibility
    );

    // --- Command: Set Workspace Location ---
    // Prompts the user to select a workspace location and updates the workspace configuration with the selected path.
    registerSafeCommand(context, `${baseKeyOfExtension}.setWorkspaceLocation`, async () => {
        logger.debug("Set Workspace Location command called.");
        const newWorkspaceLocation = await promptForWorkspaceLocation();
        if (newWorkspaceLocation) {
            await config.update("workspaceLocation", newWorkspaceLocation);
            vscode.window.showInformationMessage(`Workspace location set to: ${newWorkspaceLocation}`);
            logger.debug(`Workspace location set to: ${newWorkspaceLocation}`);
        }
        logger.trace("End of Set Workspace Location command.");
    });

    // --- Command: Show Extension Settings ---
    registerSafeCommand(context, allExtensionCommands.showExtensionSettings.command, async () => {
        logger.debug("Show Extension Settings command called.");
        // Open the settings with the extension filter.
        await vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-visual-studio-code-extension",
        });
        // Open the workspace settings view (The default settings view is user settings)
        await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
        logger.trace("End of Show Extension Settings command.");
    });

    // --- Command: Automatic Login After Activation ---
    registerSafeCommand(context, allExtensionCommands.automaticLoginAfterExtensionActivation.command, async () => {
        // If auto login is active and the password is stored in the secrets, perform the login automatically.
        if (
            config.get<boolean>("automaticLoginAfterExtensionActivation", false) &&
            config.get<boolean>("storePasswordAfterLogin", false) &&
            (await context.secrets.get("password") !== undefined)
        ) {
            logger.debug("Performing automatic login.");
            if (await testBenchConnection?.performLogin(context, baseKeyOfExtension, false, true)) {
                // If login was successful, display project selection dialog and the project management tree view.
                projectManagementTreeView?.displayProjectManagementTreeView();
                await vscode.commands.executeCommand(allExtensionCommands.selectAndLoadProject.command);
            }
        } else {
            logger.warn("Automatic login is disabled or password is not stored.");
        }
    });

    // --- Command: Login ---
    // Prevent multiple login processes from running simultaneously.
    let isLoginProcessAlreadyRunning = false;
    // Performs the login process and stores the connection object.
    registerSafeCommand(context, allExtensionCommands.login.command, async () => {
        logger.debug("Login command called.");
        if (isLoginProcessAlreadyRunning) {
            logger.debug("Login process already running, aborting login.");
            // If (somehow) login flag is stuck and set to true,
            // reset the flag after 5 seconds to prevent a deadlock.
            setTimeout(() => {
                isLoginProcessAlreadyRunning = false;
                logger.trace("isLoginProcessAlreadyRunning flag reset to false after 5 seconds.");
            }, 5000);
            return;
        }
        isLoginProcessAlreadyRunning = true;
        try {
            const performLoginResult = await testBenchConnection.performLogin(context, baseKeyOfExtension);
            // If login was successful, display project selection dialog and the project management tree view.
            if (performLoginResult) {
                await vscode.commands.executeCommand(allExtensionCommands.selectAndLoadProject.command);
            }
        } catch (error) {
            logger.error(`Login process failed: ${error}`);
        } finally {
            // Release the lock after login attempt.
            isLoginProcessAlreadyRunning = false;
            logger.trace("isLoginProcessAlreadyRunning flag is reset to false after login attempt.");
        }
        logger.trace("End of Login command.");
    });

    // --- Command: Logout ---
    // Performs the logout process, clears the connection object and shows the login webview.
    registerSafeCommand(context, allExtensionCommands.logout.command, async () => {
        logger.debug("Logout command called.");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.warn("Logout command called without connection.");
            return;
        }
        await connection.logoutUser(projectManagementTreeDataProvider!);
        // Show the login webview and hide the tree views after logout.
        loginWebView.displayWebView();
        projectManagementTreeView.hideProjectManagementTreeView();
        projectManagementTreeView.hideTestThemeTreeView();
        testElementsTreeView.hideTestElementsTreeView();
        logger.trace("End of Logout command.");
    });

    // --- Command: Generate Test Cases For Cycle ---
    // Generates test cases for the selected cycle in the project management tree view.
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForCycle.command,
        async (item: projectManagementTreeView.ProjectManagementTreeItem) => {
            logger.debug("Generate Test Cases For Cycle command called.");
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.warn("generateTestCasesForCycle command called without connection.");
                return;
            }
            if (!projectManagementTreeDataProvider) {
                vscode.window.showErrorMessage(
                    "Project management tree is not initialized. Please select a project first."
                );
                logger.warn("generateTestCasesForCycle command called without project data provider.");
                return;
            }
            // Optionally clear the working directory before test generation.
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
            await reportHandler.startTestGenerationForCycle(context, item, folderNameOfTestbenchWorkingDirectory);
            logger.trace("End of Generate Test Cases For Cycle command.");
        }
    );

    // --- Command: Fetch Report for Selected Tree Item ---
    registerSafeCommand(
        context,
        allExtensionCommands.fetchReportForSelectedTreeItem.command,
        async (treeItem: projectManagementTreeView.ProjectManagementTreeItem) => {
            await reportHandler.fetchReportForTreeElement(
                treeItem,
                projectManagementTreeDataProvider,
                folderNameOfTestbenchWorkingDirectory
            );
        }
    );

    // --- Command: Generate Test Cases For Test Theme or Test Case Set ---
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet.command,
        async (treeItem: projectManagementTreeView.ProjectManagementTreeItem) => {
            logger.debug("Generate Test Cases For Test Theme or Test Case Set command called.");
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.warn("generateTestCasesForTestThemeOrTestCaseSet command called without connection.");
                return;
            }
            // Optionally clear the working directory before test generation.
            if (config.get<boolean>("clearWorkingDirectoryBeforeTestGeneration")) {
                await vscode.commands.executeCommand(allExtensionCommands.clearWorkspaceFolder.command);
            }
            await reportHandler.generateRobotFrameworkTestsForTestThemeOrTestCaseSet(
                context,
                treeItem,
                folderNameOfTestbenchWorkingDirectory
            );
            logger.trace("End of Generate Test Cases For Test Theme or Test Case Set command.");
        }
    );

    // --- Command: Select And Load Project ---
    // Fetches the projects list from the server and prompts the user to select a project to display its contents in the tree view.
    registerSafeCommand(context, allExtensionCommands.selectAndLoadProject.command, async () => {
        logger.debug("Select And Load Project command called.");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.warn("selectAndLoadProject command called without connection.");
            return;
        }
        const projectList: testBenchTypes.Project[] | null = await connection.getProjectsList();
        if (!projectList) {
            logger.warn("No projects found for selectAndLoadProject command.");
            return;
        }
        const selectedProjectKey: string | null = await connection.getProjectKeyFromProjectListQuickPickSelection(
            projectList
        );
        if (!selectedProjectKey) {
            logger.warn("No project selected for selectAndLoadProject command.");
            return;
        }
        projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(
            selectedProjectKey
        );
        projectTreeView = vscode.window.createTreeView("projectManagementTree", {
            treeDataProvider: projectManagementTreeDataProvider,
        });
        // Initialize and display the project management tree view with the selected project.
        [projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeViews(
            context,
            connection,
            selectedProjectKey
        );
        logger.trace(`Project with key ${selectedProjectKey} loaded into project management tree view.`);
    });

    // --- Command: Toggle Project Management Tree View Visibility ---
    registerSafeCommand(context, allExtensionCommands.toggleProjectManagementTreeViewVisibility.command, async () => {
        await projectManagementTreeView.toggleProjectManagementTreeViewVisibility();
    });

    // --- Command: Toggle Test Theme Tree View Visibility ---
    registerSafeCommand(context, allExtensionCommands.toggleTestThemeTreeViewVisibility.command, async () => {
        await projectManagementTreeView.toggleTestThemeTreeViewVisibility();
    });

    // --- Command: Read Robotframework Test Results And Create Report With Results ---
    // Activated for a test theme or test case set element.
    // Reads the test results (output.xml) from the testbench working directory and creates a report zip file with the results.
    registerSafeCommand(context, allExtensionCommands.readRFTestResultsAndCreateReportWithResults.command, async () => {
        logger.debug("Read RF Test Results And Create Report With Results command called.");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.warn("readRFTestResultsAndCreateReportWithResults command called without connection.");
            return;
        }
        await reportHandler.fetchTestResultsAndCreateReportWithResultsWithTb2Robot(
            context,
            folderNameOfTestbenchWorkingDirectory
        );
        logger.trace("End of Read RF Test Results And Create Report With Results command.");
    });

    // --- Command: Upload Test Results To Testbench ---
    // Uploads the selected test results zip to the testbench server
    registerSafeCommand(context, allExtensionCommands.uploadTestResultsToTestbench.command, async () => {
        logger.debug("Upload Test Results To Testbench command called.");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.warn("uploadTestResultsToTestbench command called without connection.");
            return;
        }
        if (!projectManagementTreeDataProvider || !projectManagementTreeDataProvider.currentProjectKeyInView) {
            vscode.window.showErrorMessage("No project selected. Please select a project first.");
            logger.warn("uploadTestResultsToTestbench command called without a selected project.");
            return;
        }
        await testBenchConnection.selectReportWithResultsAndImportToTestbench(
            connection,
            projectManagementTreeDataProvider
        );
        logger.trace("End of Upload Test Results To Testbench command.");
    });

    // --- Command: Read And Upload Test Results To Testbench ---
    // A command that combines the read and upload test results commands.
    registerSafeCommand(context, allExtensionCommands.readAndUploadTestResultsToTestbench.command, async () => {
        logger.debug("Read And Upload Test Results To Testbench command called.");
        await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(
            context,
            folderNameOfTestbenchWorkingDirectory,
            projectManagementTreeDataProvider
        );
        logger.trace("End of Read And Upload Test Results To Testbench command.");
    });

    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshProjectTreeView.command, async () => {
        logger.debug("Refresh Project Tree command called.");
        [projectManagementTreeDataProvider] = await projectManagementTreeView.initializeTreeViews(
            context,
            connection!,
            projectManagementTreeDataProvider?.currentProjectKeyInView!
        );
        logger.trace("End of Refresh Project Tree command.");
    });

    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshTestThemeTreeView.command, async () => {
        logger.debug("Refresh Test Theme Tree command called.");
        projectManagementTreeDataProvider?.testThemeDataProvider.refresh();
        const cycleElement =
            projectManagementTreeDataProvider?.testThemeDataProvider?.rootElements[0]?.parent ?? undefined;
        if (cycleElement && cycleElement.contextValue === "Cycle") {
            // Fetch the test themes etc. from the server
            const children: projectManagementTreeView.ProjectManagementTreeItem[] =
                (await projectManagementTreeDataProvider?.getChildrenOfCycle(cycleElement)) ?? [];
            projectManagementTreeDataProvider?.testThemeDataProvider?.setRoots(children);
        }
        logger.trace("End of Refresh Test Theme Tree command.");
    });

    // --- Command: Make Root ---
    // Right clicking on a tree element and selecting "Make Root" context menu option will make the selected element the root of the tree.
    registerSafeCommand(
        context,
        allExtensionCommands.makeRoot.command,
        (treeItem: projectManagementTreeView.ProjectManagementTreeItem) => {
            logger.debug("Make Root command called for tree item:", treeItem);
            if (projectManagementTreeDataProvider) {
                // Find out for which element type the make root command is called
                if (treeItem.contextValue && ["Project", "Version", "Cycle"].includes(treeItem.contextValue)) {
                    projectManagementTreeDataProvider.makeRoot(treeItem);
                } else {
                    projectManagementTreeDataProvider.testThemeDataProvider.makeRoot(treeItem);
                }
            }
            logger.trace("End of Make Root command.");
        }
    );

    // --- Command: Clear Workspace Folder ---
    // Clears the workspace folder of its contents, excluding log files.
    registerSafeCommand(context, allExtensionCommands.clearWorkspaceFolder.command, async () => {
        logger.debug("Clear Workspace Folder command called.");
        const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return;
        }
        const testbenchWorkingDirectoryPath = path.join(workspaceLocation, folderNameOfTestbenchWorkingDirectory);
        await utils.clearWorkspaceFolder(
            testbenchWorkingDirectoryPath,
            [testBenchLogger.folderNameOfLogs], // Exclude log files from deletion
            !config.get<boolean>("clearWorkingDirectoryBeforeTestGeneration") // Ask for confirmation if not set to clear before test generation
        );
        logger.trace("End of Clear Workspace Folder command.");
    });

    // --- Command: Refresh Test Elements Tree ---
    // Refreshes the test elements tree view with the latest test elements for the selected TOV.
    registerSafeCommand(context, allExtensionCommands.refreshTestElementsTree.command, async () => {
        logger.trace("Refresh Test Elements Tree command called.");
        const currentTovKey = testElementsTreeView.getCurrentTovKey();
        if (!currentTovKey) {
            vscode.window.showErrorMessage("No TOV key stored. Please fetch test elements first.");
            return;
        }
        await testElementsTreeDataProvider.fetchAndDisplayTestElements(currentTovKey);
    });

    // --- Command: Display Interactions For Selected TOV ---
    registerSafeCommand(
        context,
        allExtensionCommands.displayInteractionsForSelectedTOV.command,
        async (treeItem: projectManagementTreeView.ProjectManagementTreeItem) => {
            logger.debug("Display Interactions For Selected TOV command called for tree item:", treeItem);
            // Check if the command is executed for a TOV element.
            if (projectManagementTreeDataProvider && treeItem.contextValue === "Version") {
                const tovKeyOfSelectedTreeElement = treeItem.item?.key?.toString();
                if (tovKeyOfSelectedTreeElement) {
                    await testElementsTreeDataProvider.fetchAndDisplayTestElements(
                        tovKeyOfSelectedTreeElement,
                        typeof treeItem.label === "string" ? treeItem.label : undefined
                    );
                }
            }
            logger.trace("End of Display Interactions For Selected TOV command.");
        }
    );

    // --- Command: Go To Test Element File ---
    // Opens or creates the file in the workspace corresponding to the selected test element.
    registerSafeCommand(
        context,
        allExtensionCommands.goToTestElementFile.command,
        async (treeItem: testElementsTreeView.TestElementItem) => {
            if (!treeItem || !treeItem.element) {
                logger.trace("Invalid tree item or element in goToTestElementFile command.");
                return;
            }
            const testElement = treeItem.element;
            if (!testElement.hierarchicalName) {
                logger.trace("Test element does not have a valid hierarchical name.");
                return;
            }
            const workspaceRootPath = await utils.validateAndReturnWorkspaceLocation();
            if (!workspaceRootPath) {
                return;
            }
            // Construct the target path based on the hierarchical name of the test element.
            const baseTargetPath = path.join(workspaceRootPath, ...testElement.hierarchicalName.split("/"));
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
            } catch (error: any) {
                vscode.window.showErrorMessage("Error in goToFile command: " + error.message);
                logger.error("Error in goToFile command:", error);
            }
        }
    );

    // Set context value for connectionActive.
    // Used to enable or disable the login and logout buttons in the status bar,
    // which allows icon changes for login/logout buttons based on connectionActive variable.
    vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", connection !== null);
    logger.trace(`Context value connectionActive set to: ${connection !== null}`);
}

/* =============================================================================
   Extension Activation & Deactivation
   ============================================================================= */

/**
 * Called when the extension is activated.
 *
 * @param context The extension context.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Initialize logger.
    logger = new testBenchLogger.TestBenchLogger();
    logger.info("Extension activated.");

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration(baseKeyOfExtension)) {
                await loadConfiguration(context);
                logger.info("Configuration updated after changes were detected.");
            }
        })
    );

    // Load initial configuration and register a listener for configuration changes.
    await loadConfiguration(context);    

    initializeTreeViews();

    // Register the login webview provider.
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider)
    );

    // Register all extension commands.
    registerExtensionCommands(context);

    // Display the login webview display.
    // This calls focuses and opens our extension even when the user wont want to use our extension.
    // To solve this in package.json, "activationEvents" is set to "onView:testBenchExplorer" to activate the extension only when the extension view is opened.
    await loginWebView.updateWebViewDisplay();
    // Hide all tree views on activation, so that only login webview is visible.
    await vscode.commands.executeCommand("projectManagementTree.removeView");
    await vscode.commands.executeCommand("testThemeTree.removeView");
    await vscode.commands.executeCommand("testElementsView.removeView");

    // Execute automatic login if the setting is enabled.
    await vscode.commands.executeCommand(allExtensionCommands.automaticLoginAfterExtensionActivation.command);
}

/**
 * Called when the extension is deactivated.
 */
export async function deactivate(): Promise<void> {
    // Gracefully log out the user when the extension is deactivated.
    await connection?.logoutUser(projectManagementTreeDataProvider!);
    logger.info("Extension deactivated.");
}
