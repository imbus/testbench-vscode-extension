/**
 * @file extension.ts
 * @description Main entry point for the TestBench VS Code extension.
 */

// Before releasing the extension:
// TODO: Add License.md to the extension
// TODO: Set logger level to info or debug in production, remove too detailed logs.
// TODO: In production, remove process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; in connection class.

import * as vscode from "vscode";
import * as testBenchLogger from "./testBenchLogger";
import * as testBenchConnection from "./testBenchConnection";
import * as reportHandler from "./reportHandler";
import * as projectManagementTreeView from "./projectManagementTreeView";
import * as testElementsTreeView from "./testElementsTreeView";
import * as loginWebView from "./loginWebView";
import * as utils from "./utils";
import path from "path";
import {
    allExtensionCommands,
    baseKeyOfExtension,
    ConfigKeys,
    ContextKeys,
    folderNameOfInternalTestbenchFolder,
    StorageKeys,
    TreeItemContextValues
} from "./constants";
import { initializeProjectAndTestThemeTrees } from "./projectManagementTreeView";
import { initializeLanguageServer } from "./server";

/* =============================================================================
   Constants, Global Variables & Exports
   ============================================================================= */

/** Workspace configuration for the extension. */
let config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKeyOfExtension);
export function getConfig(): vscode.WorkspaceConfiguration {
    return config;
}

/** Global logger instance. */
export let logger: testBenchLogger.TestBenchLogger;
export function setLogger(newLogger: testBenchLogger.TestBenchLogger): void {
    logger = newLogger;
}

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

/** Global tree views.
 * The generic parameter specifies the type of tree item displayed by each view.
 */
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
            const errorMessage: string = error instanceof Error ? error.message : "An unknown error occurred";
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
    if (!config.get<boolean>(ConfigKeys.STORE_PASSWORD_AFTER_LOGIN, false)) {
        await testBenchConnection?.clearStoredCredentials(context);
    }

    // Update the webview input fields after extension settings are changed to reflect the changes in the webview live.
    // Commented out due to the password field being empty after the extension settings are changed.
    // loginWebViewProvider?.updateWebviewHTMLContent();
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
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export function initializeTreeViews(context: vscode.ExtensionContext): void {
    initializeProjectAndTestThemeTrees(context);
    initializeTestElementsTreeView();
}

/**
 * Registers all the commands defined by the extension.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
function registerExtensionCommands(context: vscode.ExtensionContext): void {
    // --- Command: Show Extension Settings ---
    registerSafeCommand(context, allExtensionCommands.showExtensionSettings, async () => {
        logger.debug("Command Called: Show Extension Settings");

        // Open the settings with the extension filter.
        await vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-visual-studio-code-extension"
        });
        // Open the workspace settings view (The default settings view is user settings)
        await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
        logger.trace("End of command: Show Extension Settings");
    });

    // --- Command: Set Workspace ---
    registerSafeCommand(context, allExtensionCommands.setWorkspace, async () => {
        logger.debug("Command Called: Set Workspace");
        await utils.setWorkspaceLocation();
        logger.trace("End of command: Set Workspace");
    });

    // --- Command: Automatic Login After Activation ---
    registerSafeCommand(context, allExtensionCommands.automaticLoginAfterExtensionActivation, async () => {
        // If auto login is active and the password is stored in the secrets, perform the login automatically.
        if (
            config.get<boolean>("automaticLoginAfterExtensionActivation", false) &&
            config.get<boolean>("storePasswordAfterLogin", false) &&
            (await context.secrets.get(StorageKeys.PASSWORD)) !== undefined
        ) {
            logger.debug("Performing automatic login.");

            const loginResult: testBenchConnection.PlayServerConnection | null =
                await testBenchConnection?.performLogin(context, false, true);
            if (loginResult) {
                // Display project management tree and hide other tree views if they are open.
                projectManagementTreeView?.displayProjectManagementTreeView();
                await projectManagementTreeView?.hideTestThemeTreeView();
                await testElementsTreeView?.hideTestElementsTreeView();
                projectManagementTreeDataProvider?.refresh();
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
        logger.debug("Command Called: Login");
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
            if (performLoginResult) {
                // Reinitialize tree views after successful login
                initializeTreeViews(context);
                projectManagementTreeDataProvider?.refresh();
            }
        } catch (error) {
            logger.error(`Login process failed: ${error}`);
        } finally {
            // Release the lock after login attempt.
            isLoginProcessAlreadyRunning = false;
            logger.trace("isLoginProcessAlreadyRunning flag is reset to false after login attempt.");
        }
        logger.trace("End of command: Login");
    });

    // --- Command: Logout ---
    // Performs the logout process, clears the connection object and shows the login webview.
    registerSafeCommand(context, allExtensionCommands.logout, async () => {
        logger.debug("Command Called: Logout");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error("Logout command called without connection.");
            return;
        }
        await connection.logoutUser(projectManagementTreeDataProvider!);

        logger.trace("End of command: Logout");
    });

    // --- Command: Handle Cycle Click ---
    // Handles the click event on a project cycle in the project management tree view.
    registerSafeCommand(
        context,
        allExtensionCommands.handleProjectCycleClick,
        async (cycleItem: projectManagementTreeView.ProjectManagementTreeItem) => {
            if (projectManagementTreeDataProvider) {
                await projectManagementTreeDataProvider.handleTestCycleClick(cycleItem);
            } else {
                logger.error("Project management tree data provider is not initialized. (Handle Cycle Click)");
                vscode.window.showErrorMessage("Project management tree is not initialized.");
            }
        }
    );

    // --- Command: Generate Test Cases For Cycle ---
    // Generates test cases for the selected cycle in the project management tree view.
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForCycle,
        async (item: projectManagementTreeView.ProjectManagementTreeItem) => {
            logger.debug("Command Called: Generate Test Cases For Cycle");
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error("generateTestCasesForCycle command called without connection.");
                return;
            }
            if (!projectManagementTreeDataProvider) {
                vscode.window.showErrorMessage(
                    "Project management tree is not initialized. Please select a project first."
                );
                logger.error("generateTestCasesForCycle command called without project data provider.");
                return;
            }
            // Optionally clear the working directory before test generation.
            if (config.get<boolean>("clearInternalTestbenchDirectoryBeforeTestGeneration")) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }
            // If the user did not clicked on a test cycle in the tree view before,
            // the test cycle wont have any initialized children so that test themes cannot be displayed in the quickpick.
            // Call getChildrenOfCycle to initialize the sub elements (Test themes etc.) of the cycle.
            // Offload the children of the cycle to the Test Theme Tree View.
            if (projectManagementTreeDataProvider?.testThemeDataProvider) {
                const children: projectManagementTreeView.ProjectManagementTreeItem[] =
                    (await projectManagementTreeDataProvider.getChildrenOfCycle(item)) ?? [];
                projectManagementTreeDataProvider.testThemeDataProvider.setRoots(children);
            }
            await reportHandler.startTestGenerationForCycle(context, item);
            logger.trace("End of command: Generate Test Cases For Cycle");
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
                folderNameOfInternalTestbenchFolder
            );
        }
    );

    // --- Command: Generate Test Cases For Test Theme or Test Case Set ---
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet,
        async (treeItem: projectManagementTreeView.ProjectManagementTreeItem) => {
            logger.debug("Command Called: Generate Test Cases For Test Theme or Test Case Set");
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error("generateTestCasesForTestThemeOrTestCaseSet command called without connection.");
                return;
            }
            // Optionally clear the working directory before test generation.
            if (config.get<boolean>("clearInternalTestbenchDirectoryBeforeTestGeneration")) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }
            await reportHandler.generateRobotFrameworkTestsForTestThemeOrTestCaseSet(context, treeItem);
            logger.trace("End of command: Generate Test Cases For Test Theme or Test Case Set");
        }
    );

    // --- Command: Select And Load Project ---
    // Fetches the projects list from the server and prompts the user to select a project to display its contents in the tree view.
    registerSafeCommand(context, allExtensionCommands.selectAndLoadProject, async () => {
        logger.debug("Command Called: Select And Load Project");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error("selectAndLoadProject command called without connection.");
            return;
        }

        // This command will now effectively refresh the all-projects view
        // It reuses initializeProjectAndTestThemeTrees which should now handle loading all projects.
        await projectManagementTreeView.initializeProjectAndTestThemeTrees(context); // No project key passed
        projectManagementTreeView.displayProjectManagementTreeView(); // Ensure view is focused

        // After selecting a (new) project, hide the test theme tree view and test elements tree view and clear the test elements tree view.
        projectManagementTreeView.hideTestThemeTreeView();
        testElementsTreeView.hideTestElementsTreeView();
        testElementsTreeView.clearTestElementsTreeView();

        logger.trace("Project list refreshed in project management tree view.");
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
        logger.debug("Command Called: Read RF Test Results And Create Report With Results");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error("readRFTestResultsAndCreateReportWithResults command called without connection.");
            return;
        }
        await reportHandler.fetchTestResultsAndCreateReportWithResultsWithTb2Robot(context);
        logger.trace("End of command: Read RF Test Results And Create Report With Results");
    });

    // --- Command: Import Test Results To Testbench ---
    // Imports the selected test results zip to the testbench server
    registerSafeCommand(context, allExtensionCommands.importTestResultsToTestbench, async () => {
        logger.debug("Command Called: Import Test Results To Testbench");
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error("importTestResultsToTestbench command called without connection.");
            return;
        }

        await testBenchConnection.selectReportWithResultsAndImportToTestbench(connection);
        logger.trace("End of command: Import Test Results To Testbench");
    });

    // --- Command: Read And Import Test Results To Testbench ---
    // A command that combines the read and import test results commands.
    registerSafeCommand(context, allExtensionCommands.readAndImportTestResultsToTestbench, async () => {
        logger.debug("Command called: Read And Import Test Results To Testbench");
        if (!connection) {
            const noConnectionErrorMessage: string = "No connection available. Cannot import report.";
            vscode.window.showErrorMessage(noConnectionErrorMessage);
            logger.error(noConnectionErrorMessage);
            return null;
        }
        if (!projectManagementTreeDataProvider) {
            const missingProviderErrorMessage: string =
                "Project management tree provider is not initialized. Cannot import report.";
            vscode.window.showErrorMessage(missingProviderErrorMessage);
            logger.error(missingProviderErrorMessage);
            return null;
        }

        if (!projectManagementTreeDataProvider.activeProjectKeyInView) {
            const missingProjectKeyErrorMessage: string = "Active project key is missing. Cannot import report.";
            vscode.window.showErrorMessage(missingProjectKeyErrorMessage);
            logger.error(missingProjectKeyErrorMessage);
            return null;
        }
        await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(context);
        logger.trace("End of Command: Read And Import Test Results To Testbench");
    });

    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshProjectTreeView, async () => {
        projectManagementTreeDataProvider?.refresh();
    });

    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshTestThemeTreeView, async () => {
        logger.debug("Command called: Refresh Test Theme Tree");
        const cycleElement: projectManagementTreeView.ProjectManagementTreeItem | undefined =
            projectManagementTreeDataProvider?.testThemeDataProvider?.rootElements[0]?.parent ?? undefined;
        if (cycleElement && cycleElement.contextValue === "Cycle") {
            // Fetch the test themes etc. from the server
            const children: projectManagementTreeView.ProjectManagementTreeItem[] =
                (await projectManagementTreeDataProvider?.getChildrenOfCycle(cycleElement)) ?? [];
            projectManagementTreeDataProvider?.testThemeDataProvider?.setRoots(children);
        }
        projectManagementTreeDataProvider?.testThemeDataProvider.refresh();

        logger.trace("End of command: Refresh Test Theme Tree");
    });

    // --- Command: Make Root ---
    // Right clicking on a tree element and selecting "Make Root" context menu option will make the selected element the root of the tree.
    registerSafeCommand(
        context,
        allExtensionCommands.makeRoot,
        (treeItem: projectManagementTreeView.ProjectManagementTreeItem) => {
            logger.debug("Command Called: Make Root for tree item:", treeItem);
            if (projectManagementTreeDataProvider) {
                // Find out for which element type the make root command is called
                if (
                    treeItem.contextValue &&
                    (
                        [
                            TreeItemContextValues.PROJECT,
                            TreeItemContextValues.VERSION,
                            TreeItemContextValues.CYCLE
                        ] as string[]
                    ).includes(treeItem.contextValue)
                ) {
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
    registerSafeCommand(context, allExtensionCommands.clearInternalTestbenchFolder, async () => {
        logger.debug("Command Called: Clear Workspace Folder");
        const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return;
        }
        const testbenchWorkingDirectoryPath: string = path.join(workspaceLocation, folderNameOfInternalTestbenchFolder);
        await utils.clearInternalTestbenchFolder(
            testbenchWorkingDirectoryPath,
            [testBenchLogger.folderNameOfLogs], // Exclude log files from deletion
            !config.get<boolean>("clearInternalTestbenchDirectoryBeforeTestGeneration") // Ask for confirmation if not set to clear before test generation
        );
        logger.trace("End of Command: Clear Workspace Folder");
    });

    // --- Command: Refresh Test Elements Tree ---
    // Refreshes the test elements tree view with the latest test elements for the selected TOV.
    registerSafeCommand(context, allExtensionCommands.refreshTestElementsTree, async () => {
        logger.debug("Command Called: Refresh Test Elements Tree");
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
            logger.debug(
                "Command Called: Display Interactions For Selected TOV command called for tree item:",
                treeItem
            );
            // Check if the command is executed for a TOV element.
            if (projectManagementTreeDataProvider && treeItem.contextValue === TreeItemContextValues.VERSION) {
                const tovKeyOfSelectedTreeElement = treeItem.item?.key?.toString();
                if (tovKeyOfSelectedTreeElement) {
                    const areTestElementsFetched: boolean =
                        await testElementsTreeDataProvider.fetchAndDisplayTestElements(
                            tovKeyOfSelectedTreeElement,
                            typeof treeItem.label === "string" ? treeItem.label : undefined
                        );
                    // Hide Project Contents Tree View after displaying Test Elements Tree View.
                    if (areTestElementsFetched) {
                        await projectManagementTreeView?.hideProjectManagementTreeView();
                    }
                }
            }
            logger.trace("End of Command: Display Interactions For Selected TOV");
        }
    );

    // --- Command: Go To Resource File ---
    // Opens or creates the robot resource file associated with the selected test element.
    registerSafeCommand(
        context,
        allExtensionCommands.openOrCreateRobotResourceFile,
        async (treeItem: testElementsTreeView.TestElementTreeItem) => {
            if (!treeItem || !treeItem.testElementData) {
                logger.trace("Invalid tree item or element in Open Robot Resource File command.");
                return;
            }

            // Construct the target path based on the hierarchical name of the test element.
            const absolutePathOfSelectedTestElement: string | undefined =
                await testElementsTreeView.constructAbsolutePathForTestElement(treeItem);
            if (!absolutePathOfSelectedTestElement) {
                return;
            }

            logger.trace(
                `Opening Robot Resource File - absolute path for test element tree item (${treeItem.testElementData.name}) resolved as: ${absolutePathOfSelectedTestElement}`
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
                        await testElementsTreeView.handleFallback(absolutePathOfSelectedTestElement);
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
            logger.debug("Command Called: Create Interaction Under Subdivision");

            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error("createInteractionUnderSubdivision command called without connection.");
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
    // Opens the official VS Code issue reporter, where the extension is preselected.
    registerSafeCommand(context, allExtensionCommands.openIssueReporter, async () => {
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench-visual-studio-code-extension"
        });
    });

    // --- Command: Modify Report With Results Zip ---
    // Allows the user to select a report zip file and create a new report by removing JSON files that were not selected in the quick pick from the original report zip.
    registerSafeCommand(context, allExtensionCommands.modifyReportWithResultsZip, async () => {
        logger.debug("Command called: Quick pick with multiselect");

        // Prompt the user to select a report zip file with results.
        const zipUris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: {
                "Zip Files": ["zip"],
                "All Files": ["*"]
            },
            openLabel: "Select Report Zip File"
        });
        if (!zipUris || zipUris.length === 0) {
            vscode.window.showErrorMessage("No zip file selected.");
            return;
        }
        const zipPath: string = zipUris[0].fsPath;
        const quickPickItems: string[] = await reportHandler.getQuickPickItemsFromReportZipWithResults(zipPath);

        // Then call your quick pick function with the retrieved items.
        const chosenQuickPickItems: string[] = await reportHandler.showMultiSelectQuickPick(quickPickItems);
        logger.log("Trace", "User selected following json files:", chosenQuickPickItems);

        // Create a new zip file by removing JSON files that were not selected from the original report zip.
        await reportHandler.createNewReportWithSelectedItems(zipPath, chosenQuickPickItems);

        logger.trace("End of command: Quick pick with multiselect");
    });

    // Set context value for connectionActive.
    // Used to enable or disable the login and logout buttons in the status bar,
    // which allows icon changes for login/logout buttons based on connectionActive variable.
    vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, connection !== null);
    logger.trace(`Context value connectionActive set to: ${connection !== null}`);
}

/* =============================================================================
   Extension Activation & Deactivation
   ============================================================================= */

/**
 * Called when the extension is activated.
 *
 * @param {vscode.ExtensionContext} context The extension context.
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

    initializeTreeViews(context);

    // Register the login webview provider.
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider)
    );

    // Register all extension commands.
    registerExtensionCommands(context);

    // Set the initial context state. Before any login attempt, connection is null.
    // VS Code will show/hide views based on this initial state matching the 'when' clauses in package.json
    await vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", connection !== null);
    logger.trace(`Initial connectionActive context set to: ${connection !== null}`);

    await initializeLanguageServer();

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
