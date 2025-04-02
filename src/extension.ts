/**
 * @file extension.ts
 * @description Main entry point for the TestBench VS Code extension.
 */

// TODO: If possible, hide the tree views initially instead of creating them and then hiding them after.
// TODO: The user generated tests, executed the tests, and restarted the extension. Last generated test params are now invalid due to restart, and he cant import. Use VS Code storage?

// Before releasing the extension:
// TODO: Add License.md to the extension
// TODO: Set logger level to info or debug in production, remove too detailed logs.
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
export const allExtensionCommands = {
    displayCommand: `${baseKeyOfExtension}.displayCommands`,
    login: `${baseKeyOfExtension}.login`,
    logout: `${baseKeyOfExtension}.logout`,
    generateTestCasesForCycle: `${baseKeyOfExtension}.generateTestCasesForCycle`,
    generateTestCasesForTestThemeOrTestCaseSet: `${baseKeyOfExtension}.generateTestCasesForTestThemeOrTestCaseSet`,
    readRFTestResultsAndCreateReportWithResults: `${baseKeyOfExtension}.readRFTestResultsAndCreateReportWithResults`,
    makeRoot: `${baseKeyOfExtension}.makeRoot`,
    getServerVersions: `${baseKeyOfExtension}.getServerVersions`,
    showExtensionSettings: `${baseKeyOfExtension}.showExtensionSettings`,
    fetchReportForSelectedTreeItem: `${baseKeyOfExtension}.fetchReportForSelectedTreeItem`,
    selectAndLoadProject: `${baseKeyOfExtension}.selectAndLoadProject`,
    importTestResultsToTestbench: `${baseKeyOfExtension}.importTestResultsToTestbench`,
    readAndImportTestResultsToTestbench: `${baseKeyOfExtension}.readAndImportTestResultsToTestbench`,
    executeRobotFrameworkTests: `${baseKeyOfExtension}.executeRobotFrameworkTests`,
    refreshProjectTreeView: `${baseKeyOfExtension}.refreshProjectTreeView`,
    refreshTestThemeTreeView: `${baseKeyOfExtension}.refreshTestThemeTreeView`,
    setWorkspaceLocation: `${baseKeyOfExtension}.setWorkspaceLocation`,
    clearWorkspaceFolder: `${baseKeyOfExtension}.clearWorkspaceFolder`,
    toggleProjectManagementTreeViewVisibility: `${baseKeyOfExtension}.toggleProjectManagementTreeViewVisibility`,
    toggleTestThemeTreeViewVisibility: `${baseKeyOfExtension}.toggleTestThemeTreeViewVisibility`,
    toggleWebViewVisibility: `${baseKeyOfExtension}.toggleWebViewVisibility`,
    automaticLoginAfterExtensionActivation: `${baseKeyOfExtension}.automaticLoginAfterExtensionActivation`,
    refreshTestElementsTree: `${baseKeyOfExtension}.refreshTestElementsTree`,
    displayInteractionsForSelectedTOV: `${baseKeyOfExtension}.displayInteractionsForSelectedTOV`,
    openRobotResourceFile: `${baseKeyOfExtension}.openRobotResourceFile`,
    createInteractionUnderSubdivision: `${baseKeyOfExtension}.createInteractionUnderSubdivision`,
    openIssueReporter: `${baseKeyOfExtension}.openIssueReporter`
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
export let testElementTreeView: vscode.TreeView<testElementsTreeView.TestElementTreeItem>;
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
export function getTestElementsTreeDataProvider(): testElementsTreeView.TestElementsTreeDataProvider {
    return testElementsTreeDataProvider;
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
export function safeCommandHandler(handler: (...args: any[]) => any): (...args: any[]) => Promise<void> {
    return async (...args: any[]) => {
        try {
            await handler(...args);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
            logger.error(`Error executing command: ${errorMessage}`, error);
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
 * @returns {Promise<string | undefined>} The selected folder path, or undefined if none selected.
 */
export async function promptForWorkspaceLocation(): Promise<string | undefined> {
    logger.debug("Prompting user to select a workspace location.");
    const options: vscode.OpenDialogOptions = {
        canSelectMany: false,
        openLabel: "Select Workspace Location",
        canSelectFolders: true,
        canSelectFiles: false,
        title: "Select Workspace Location"
    };

    const folderUris: vscode.Uri[] | undefined = await vscode.window.showOpenDialog(options);
    if (folderUris && folderUris[0]) {
        logger.debug(`Workspace location selected: ${folderUris[0].fsPath}`);
        return folderUris[0].fsPath;
    }
    logger.debug("No workspace location selected.");
    return undefined;
}

// Global variable to store the current configuration scope (workspace or global).
let currentConfigScope: vscode.Uri | undefined;
let activeEditor: vscode.TextEditor | undefined;

/**
 * Loads the latest extension configuration and updates the global configuration object.
 * Also handles the storage of credentials based on the configuration settings.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function loadConfiguration(context: vscode.ExtensionContext, newScope?: vscode.Uri): Promise<void> {
    // If no new scope provided, determine the best scope automatically
    if (newScope === undefined) {
        if (activeEditor) {
            newScope = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri;
        } else if (vscode.workspace.workspaceFolders?.length === 1) {
            newScope = vscode.workspace.workspaceFolders[0].uri;
        }
    }

    currentConfigScope = newScope;

    // Update the configuration object with the latest values.
    // Without this, the configuration changes may not be updated and old values may be used.
    config = vscode.workspace.getConfiguration(baseKeyOfExtension, currentConfigScope);

    // Log the configuration source for debugging
    const configSource: string = currentConfigScope
        ? `workspace folder: ${vscode.workspace.getWorkspaceFolder(currentConfigScope)?.name}`
        : "global (no workspace)";
    logger.trace(`Loading configuration from ${configSource}`);

    // Update the log level based on the new configuration.
    logger.updateCachedLogLevel();

    // If storePassword is set to false, delete the stored password immediately.
    // If storePassword is set to true, the password is only stored after a successful login.
    // The login process also clears the stored password if the user does not want to store it.
    if (!config.get<boolean>("storePasswordAfterLogin", false)) {
        await testBenchConnection?.clearStoredCredentials(context);
    }

    // Update the webview input fields after extension settings are changed to reflect the changes in the webview live.
    // Commented out due to the password field being empty after the extension settings are changed.
    // loginWebViewProvider?.updateWebviewHTMLContent();
}

// TODO: Code duplication with projectManagementTreeView.ts
function initializeProjectManagementTreeView(): void {
    projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(null!);
    projectTreeView = vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: projectManagementTreeDataProvider
    });
}

function initializeTestElementsTreeView(): void {
    testElementsTreeDataProvider = new testElementsTreeView.TestElementsTreeDataProvider();
    testElementTreeView = vscode.window.createTreeView("testElementsView", {
        treeDataProvider: testElementsTreeDataProvider
    });
    vscode.window.registerTreeDataProvider("testElementsView", testElementsTreeDataProvider);
    // Hide the test elements tree view initially.
    testElementsTreeView.hideTestElementsTreeView();
}

/**
 * Initializes the project tree and test elements tree.
 */
export function initializeTreeViews(): void {
    initializeProjectManagementTreeView();
    initializeTestElementsTreeView();
}

/**
 * Registers all the commands defined by the extension.
 *
 * @param context The extension context.
 */
function registerExtensionCommands(context: vscode.ExtensionContext): void {
    // --- Command: Toggle Login Webview Visibility ---
    registerSafeCommand(context, allExtensionCommands.toggleWebViewVisibility, loginWebView.toggleWebViewVisibility);

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
    registerSafeCommand(context, allExtensionCommands.showExtensionSettings, async () => {
        logger.debug("Show Extension Settings command called.");

        // Open the settings with the extension filter.
        await vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-visual-studio-code-extension"
        });
        // Open the workspace settings view (The default settings view is user settings)
        await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
        logger.trace("End of Show Extension Settings command.");
    });

    // --- Command: Automatic Login After Activation ---
    registerSafeCommand(context, allExtensionCommands.automaticLoginAfterExtensionActivation, async () => {
        // If auto login is active and the password is stored in the secrets, perform the login automatically.
        if (
            config.get<boolean>("automaticLoginAfterExtensionActivation", false) &&
            config.get<boolean>("storePasswordAfterLogin", false) &&
            (await context.secrets.get("password")) !== undefined
        ) {
            logger.debug("Performing automatic login.");

            const loginResult: testBenchConnection.PlayServerConnection | null =
                await testBenchConnection?.performLogin(context, false, true);
            if (loginResult) {
                // If login was successful, display project selection dialog and the project management tree view.
                projectManagementTreeView?.displayProjectManagementTreeView();
                vscode.commands.executeCommand(allExtensionCommands.selectAndLoadProject);
            }
        } else {
            logger.trace("Automatic login is disabled or password is not stored.");
        }
    });

    // --- Command: Login ---
    // Prevent multiple login processes from running simultaneously.
    let isLoginProcessAlreadyRunning: boolean = false;
    // Performs the login process and stores the connection object.
    registerSafeCommand(context, allExtensionCommands.login, async () => {
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
            const performLoginResult: testBenchConnection.PlayServerConnection | null =
                await testBenchConnection.performLogin(context);
            // If login was successful, display project selection dialog and the project management tree view.
            if (performLoginResult) {
                await vscode.commands.executeCommand(allExtensionCommands.selectAndLoadProject);
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
    registerSafeCommand(context, allExtensionCommands.logout, async () => {
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
        allExtensionCommands.generateTestCasesForCycle,
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
                await vscode.commands.executeCommand(allExtensionCommands.clearWorkspaceFolder);
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
        allExtensionCommands.fetchReportForSelectedTreeItem,
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
        allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet,
        async (treeItem: projectManagementTreeView.ProjectManagementTreeItem) => {
            logger.debug("Generate Test Cases For Test Theme or Test Case Set command called.");
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.warn("generateTestCasesForTestThemeOrTestCaseSet command called without connection.");
                return;
            }
            // Optionally clear the working directory before test generation.
            if (config.get<boolean>("clearWorkingDirectoryBeforeTestGeneration")) {
                await vscode.commands.executeCommand(allExtensionCommands.clearWorkspaceFolder);
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
    registerSafeCommand(context, allExtensionCommands.selectAndLoadProject, async () => {
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
        const selectedProjectKey: string | null =
            await connection.getProjectKeyFromProjectListQuickPickSelection(projectList);
        if (!selectedProjectKey) {
            logger.warn("No project selected for selectAndLoadProject command.");
            return;
        }

        // TODO: Code duplication with projectManagementTreeView.ts
        projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(
            selectedProjectKey
        );
        projectTreeView = vscode.window.createTreeView("projectManagementTree", {
            treeDataProvider: projectManagementTreeDataProvider
        });

        // Initialize and display the project management tree view with the selected project.
        [projectManagementTreeDataProvider] = await projectManagementTreeView.initializeProjectAndTestThemeTrees(
            context,
            connection,
            selectedProjectKey
        );

        // After selecting a (new) project, hide the test theme tree view and test elements tree view and clear the test elements tree view.
        projectManagementTreeView.hideTestThemeTreeView();
        testElementsTreeView.hideTestElementsTreeView();
        testElementsTreeView.clearTestElementsTreeView();

        logger.trace(`Project with key ${selectedProjectKey} loaded into project management tree view.`);
    });

    // --- Command: Toggle Project Management Tree View Visibility ---
    registerSafeCommand(context, allExtensionCommands.toggleProjectManagementTreeViewVisibility, async () => {
        await projectManagementTreeView.toggleProjectManagementTreeViewVisibility();
    });

    // --- Command: Toggle Test Theme Tree View Visibility ---
    registerSafeCommand(context, allExtensionCommands.toggleTestThemeTreeViewVisibility, async () => {
        await projectManagementTreeView.toggleTestThemeTreeViewVisibility();
    });

    // --- Command: Read Robotframework Test Results And Create Report With Results ---
    // Activated for a test theme or test case set element.
    // Reads the test results (output.xml) from the testbench working directory and creates a report zip file with the results.
    registerSafeCommand(context, allExtensionCommands.readRFTestResultsAndCreateReportWithResults, async () => {
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

    // --- Command: Import Test Results To Testbench ---
    // Imports the selected test results zip to the testbench server
    registerSafeCommand(context, allExtensionCommands.importTestResultsToTestbench, async () => {
        logger.debug("Import Test Results To Testbench command called.");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.warn("importTestResultsToTestbench command called without connection.");
            return;
        }
        if (!projectManagementTreeDataProvider || !projectManagementTreeDataProvider.activeProjectKeyInView) {
            vscode.window.showErrorMessage("No project selected. Please select a project first.");
            logger.warn("importTestResultsToTestbench command called without a selected project.");
            return;
        }
        await testBenchConnection.selectReportWithResultsAndImportToTestbench(
            connection,
            projectManagementTreeDataProvider
        );
        logger.trace("End of Import Test Results To Testbench command.");
    });

    // --- Command: Read And Import Test Results To Testbench ---
    // A command that combines the read and import test results commands.
    registerSafeCommand(context, allExtensionCommands.readAndImportTestResultsToTestbench, async () => {
        logger.debug("Read And Import Test Results To Testbench command called.");
        if (!connection) {
            const noConnectionMessage: string = "No connection available. Cannot import report.";
            vscode.window.showErrorMessage(noConnectionMessage);
            logger.warn(noConnectionMessage);
            return null;
        }
        if (!projectManagementTreeDataProvider || !projectManagementTreeDataProvider.activeProjectKeyInView) {
            const missingProjectKeyError: string = "Active project key is missing. Cannot import report.";
            vscode.window.showErrorMessage(missingProjectKeyError);
            logger.warn(missingProjectKeyError);
            return null;
        }
        await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(
            context,
            folderNameOfTestbenchWorkingDirectory,
            projectManagementTreeDataProvider
        );
        logger.trace("End of Read And Import Test Results To Testbench command.");
    });

    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshProjectTreeView, async () => {
        projectManagementTreeDataProvider?.refresh();
    });

    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshTestThemeTreeView, async () => {
        logger.debug("Refresh Test Theme Tree command called.");
        const cycleElement: projectManagementTreeView.ProjectManagementTreeItem | undefined =
            projectManagementTreeDataProvider?.testThemeDataProvider?.rootElements[0]?.parent ?? undefined;
        if (cycleElement && cycleElement.contextValue === "Cycle") {
            // Fetch the test themes etc. from the server
            const children: projectManagementTreeView.ProjectManagementTreeItem[] =
                (await projectManagementTreeDataProvider?.getChildrenOfCycle(cycleElement)) ?? [];
            projectManagementTreeDataProvider?.testThemeDataProvider?.setRoots(children);
        }
        projectManagementTreeDataProvider?.testThemeDataProvider.refresh();

        logger.trace("End of Refresh Test Theme Tree command.");
    });

    // --- Command: Make Root ---
    // Right clicking on a tree element and selecting "Make Root" context menu option will make the selected element the root of the tree.
    registerSafeCommand(
        context,
        allExtensionCommands.makeRoot,
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
    registerSafeCommand(context, allExtensionCommands.clearWorkspaceFolder, async () => {
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
    registerSafeCommand(context, allExtensionCommands.refreshTestElementsTree, async () => {
        logger.debug("Refresh Test Elements Tree command called.");
        const currentTovKey: string = testElementsTreeView.getCurrentTovKey();
        if (!currentTovKey) {
            vscode.window.showErrorMessage("No TOV key stored. Please fetch test elements first.");
            return;
        }
        await testElementsTreeDataProvider.fetchAndDisplayTestElements(currentTovKey);
    });

    // --- Command: Display Interactions For Selected TOV ---
    registerSafeCommand(
        context,
        allExtensionCommands.displayInteractionsForSelectedTOV,
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

    // --- Command: Open Robot Resource File ---
    // Opens or creates the file in the workspace corresponding to the selected test element.
    registerSafeCommand(
        context,
        allExtensionCommands.openRobotResourceFile,
        async (treeItem: testElementsTreeView.TestElementTreeItem) => {
            if (!treeItem || !treeItem.testElementData) {
                logger.trace("Invalid tree item or element in Open Robot Resource File command.");
                return;
            }

            // Construct the target path based on the hierarchical name of the test element.
            const absolutePathOfTestElement = await testElementsTreeView.constructAbsolutePathForTestElement(treeItem);
            if (!absolutePathOfTestElement) {
                return;
            }

            logger.trace(
                `Open Robot Resource File command created absolutePathOfTestElement: ${absolutePathOfTestElement}`
            );
            try {
                switch (treeItem.testElementData.elementType) {
                    case "Subdivision":
                        await testElementsTreeView.handleSubdivision(treeItem);
                        break;
                    case "Interaction":
                        await testElementsTreeView.handleInteraction(treeItem);
                        break;
                    default:
                        await testElementsTreeView.handleFallback(absolutePathOfTestElement);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage("Error in Open Robot Resource File command: " + error.message);
                logger.error("Error in Open Robot Resource File command:", error);
            }
        }
    );

    // --- Command: Create Interaction Under Subdivision ---
    // Creates a new interaction tree element under the selected subdivision.
    registerSafeCommand(
        context,
        allExtensionCommands.createInteractionUnderSubdivision,
        async (subdivisionTreeItem: testElementsTreeView.TestElementTreeItem) => {
            logger.debug("Create Interaction Under Subdivision command called.");

            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.warn("createInteractionUnderSubdivision command called without connection.");
                return;
            }

            // Prompt user for new interaction name
            const interactionName: string | undefined = await vscode.window.showInputBox({
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
            const newInteraction: testElementsTreeView.TestElementData | null =
                await testElementsTreeView.createInteractionUnderSubdivision(subdivisionTreeItem, interactionName);

            if (newInteraction) {
                // TODO: After the API is implemented, use the API to create the interaction on the server
                // For now, refresh the tree view to show the new interaction
                testElementsTreeDataProvider._onDidChangeTreeData.fire(undefined);

                vscode.window.showInformationMessage(`Successfully created interaction '${interactionName}'`);
                logger.debug(
                    `Created new interaction '${interactionName}' under subdivision '${subdivisionTreeItem.testElementData.name}'`
                );
            }
        }
    );

    // --- Command: Open Issue Reporter ---
    registerSafeCommand(context, allExtensionCommands.openIssueReporter, async () => {
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench-visual-studio-code-extension"
        });
    });

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

    // Initialize with the best scope
    activeEditor = vscode.window.activeTextEditor;

    // Initialize with global scope by default
    currentConfigScope = undefined;

    // Respond to configuration changes in the extension settings.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration(baseKeyOfExtension)) {
                await loadConfiguration(context);
                logger.info("Configuration updated after changes were detected.");
            }
        })
    );
    // Respond to changes in the active text editor to automatically update the configuration scope.
    // This is useful for multi-root workspaces where the user may switch between different folders.
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            activeEditor = editor;
            await loadConfiguration(context); // Automatically update config when editor changes
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
    vscode.commands.executeCommand(allExtensionCommands.automaticLoginAfterExtensionActivation);
}

/**
 * Called when the extension is deactivated.
 */
export async function deactivate(): Promise<void> {
    try {
        // Gracefully log out the user when the extension is deactivated.
        await connection?.logoutUser(projectManagementTreeDataProvider!);
        logger.info("Extension deactivated.");
    } catch (error) {
        logger.error("Error during deactivation:", error);
    }
}
