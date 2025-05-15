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
// Note: A virtual python environment is required for the extension to work + an empty pyproject.toml in workspace root.

import * as vscode from "vscode";
import * as testBenchLogger from "./testBenchLogger";
import * as testBenchConnection from "./testBenchConnection";
import * as reportHandler from "./reportHandler";
import * as projectManagementTreeView from "./projectManagementTreeView";
import { getProjectAndTovNamesFromSelection } from "./projectManagementTreeView";
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
    TreeItemContextValues
} from "./constants";
import { CycleDataForThemeTreeEvent } from "./projectManagementTreeView";
import { client, initializeLanguageServer } from "./server";
import { hideTestThemeTreeView, TestThemeTreeDataProvider } from "./testThemeTreeView";
import { clearTestElementsTreeView, displayTestElementsTreeView } from "./testElementsTreeView";
import {
    TestBenchAuthenticationProvider,
    TESTBENCH_AUTH_PROVIDER_ID,
    TESTBENCH_AUTH_PROVIDER_LABEL
} from "./testBenchAuthenticationProvider";
import * as profileManager from "./profileManager";
import { PlayServerConnection } from "./testBenchConnection";

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

/** Global connection to the (new) TestBench Play server. */
export let connection: testBenchConnection.PlayServerConnection | null = null;
export function setConnection(newConnection: testBenchConnection.PlayServerConnection | null): void {
    connection = newConnection;
}

/** Login webview provider instance. */
let loginWebViewProvider: loginWebView.LoginWebViewProvider | null = null;
export function getLoginWebViewProvider(): loginWebView.LoginWebViewProvider | null {
    return loginWebViewProvider;
}

/** Module-private variables to hold the tree data providers and views. */
let _projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null = null;
let _testThemeTreeDataProvider: TestThemeTreeDataProvider | null = null;
let _testElementsTreeDataProvider: testElementsTreeView.TestElementsTreeDataProvider | undefined;
let _projectTreeView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> | undefined;
let _testThemeTreeView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> | undefined;
let _testElementTreeView: vscode.TreeView<testElementsTreeView.TestElementTreeItem> | undefined;

/** Getter functions for providers and views */
export function getProjectManagementTreeDataProvider(): projectManagementTreeView.ProjectManagementTreeDataProvider | null {
    return _projectManagementTreeDataProvider;
}

export function getTestThemeTreeDataProvider(): TestThemeTreeDataProvider | null {
    return _testThemeTreeDataProvider;
}

export function getTestElementsTreeDataProvider(): testElementsTreeView.TestElementsTreeDataProvider | undefined {
    return _testElementsTreeDataProvider;
}

export function getProjectTreeView(): vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> | undefined {
    return _projectTreeView;
}

export function getTestThemeTreeViewInstance():
    | vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem>
    | undefined {
    return _testThemeTreeView;
}

export function getTestElementTreeView(): vscode.TreeView<testElementsTreeView.TestElementTreeItem> | undefined {
    return _testElementTreeView;
}

// Global variable to store the authentication provider instance
let authProviderInstance: TestBenchAuthenticationProvider | null = null;

// Global state for current project and TOV context for language server
let currentLanguageServerProject: string | undefined;
let currentLanguageServerTov: string | undefined;

export function getCurrentLsProject(): string | undefined {
    return currentLanguageServerProject;
}

export function getCurrentLsTov(): string | undefined {
    return currentLanguageServerTov;
}

// Global variable to store the current configuration scope (workspace or global).
let currentConfigScope: vscode.Uri | undefined;
// Global variable to store the active editor instance to determine the best scope for configuration.
let activeEditor: vscode.TextEditor | undefined;

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
 * @param {string} commandId The command ID string.
 * @param {(...args: any[]) => any} callback The command handler function.
 */
function registerSafeCommand(
    context: vscode.ExtensionContext,
    commandId: string,
    callback: (...args: any[]) => any
): void {
    const disposable = vscode.commands.registerCommand(commandId, async (...args: any[]) => {
        try {
            await callback(...args);
        } catch (error: any) {
            // For silent auto-login, we expect errors if conditions aren't met,
            // so avoid showing an error message to the user for this specific command.
            if (commandId === allExtensionCommands.automaticLoginAfterExtensionActivation) {
                logger.warn(
                    `Command ${commandId} error (expected for silent auto-login if conditions not met): ${error.message}`
                );
            } else {
                logger.error(`Command ${commandId} error: ${error.message}`, error);
                vscode.window.showErrorMessage(`Command ${commandId} failed: ${error.message}`);
            }
        }
    });
    context.subscriptions.push(disposable);
}

/**
 * Loads the latest extension configuration and updates the global configuration object.
 * Handles the storage of credentials based on the configuration settings.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function loadConfiguration(context: vscode.ExtensionContext, newScope?: vscode.Uri): Promise<void> {
    // If no new scope provided, determine the best scope automatically
    if (newScope === undefined) {
        if (activeEditor) {
            // If there is an active editor, use its workspace folder as the scope
            newScope = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri;
        } else if (vscode.workspace.workspaceFolders?.length === 1) {
            // If there is only one workspace folder, use it as the scope
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
}

/**
 * Initializes the Test Elements Tree View.
 *
 * This function sets up the tree data provider for the test elements,
 * creates the tree view itself, and registers it with the extension's subscriptions.
 * Handles the initial message display if the tree is empty.
 *
 * @param {vscode.ExtensionContext} context - The extension context provided by VS Code, used for managing disposables.
 */
function initializeTestElementsTreeView(context: vscode.ExtensionContext): void {
    _testElementsTreeDataProvider = new testElementsTreeView.TestElementsTreeDataProvider((message) => {
        // Pass callback for message updates
        if (_testElementTreeView) {
            _testElementTreeView.message = message;
        }
    });
    _testElementTreeView = vscode.window.createTreeView("testElementsView", {
        treeDataProvider: _testElementsTreeDataProvider
    });
    context.subscriptions.push(_testElementTreeView);

    if (_testElementsTreeDataProvider.isTreeDataEmpty()) {
        // Message setting will be handled by the provider via callback
        _testElementsTreeDataProvider.updateMessage();
    }
}

/**
 * Initializes the project tree and test elements tree.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export function initializeTreeViews(context: vscode.ExtensionContext): void {
    _testThemeTreeDataProvider = new TestThemeTreeDataProvider((message) => {
        if (_testThemeTreeView) {
            _testThemeTreeView.message = message;
        }
    });
    _testThemeTreeView = vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: _testThemeTreeDataProvider
    });
    context.subscriptions.push(_testThemeTreeView);

    _projectManagementTreeDataProvider = new projectManagementTreeView.ProjectManagementTreeDataProvider(
        (message) => {
            if (_projectTreeView) {
                _projectTreeView.message = message;
            }
        },
        _testThemeTreeDataProvider // Pass the test theme tree data provider to the project management tree
    );
    const newProjectTreeView: vscode.TreeView<projectManagementTreeView.BaseTestBenchTreeItem> =
        vscode.window.createTreeView("projectManagementTree", {
            treeDataProvider: _projectManagementTreeDataProvider,
            canSelectMany: false
        });
    context.subscriptions.push(newProjectTreeView);
    _projectTreeView = newProjectTreeView;

    // Listen to event from ProjectManagementTreeDataProvider to update the Test Theme Tree
    // when the cycle data is prepared.
    if (_projectManagementTreeDataProvider && _testThemeTreeView && _testThemeTreeDataProvider) {
        context.subscriptions.push(
            _projectManagementTreeDataProvider.onDidPrepareCycleDataForThemeTree(
                async (eventData: CycleDataForThemeTreeEvent) => {
                    if (_testThemeTreeDataProvider && _testThemeTreeView) {
                        logger.debug(`Cycle data prepared for ${eventData.cycleLabel}. Updating Test Theme Tree.`);

                        // Update the title of the Test Themes tree view
                        _testThemeTreeView.title = `Test Themes (${eventData.cycleLabel})`;
                        logger.trace(`Test Theme TreeView title updated to: ${_testThemeTreeView.title}`);

                        _testThemeTreeDataProvider.clearTree();
                        _testThemeTreeDataProvider.populateFromCycleData(eventData);
                    }
                }
            )
        );
    }

    // Initial data load/refresh for project tree
    _projectManagementTreeDataProvider?.refresh(true); // true for hard refresh

    if (_testThemeTreeDataProvider && _testThemeTreeView) {
        _testThemeTreeDataProvider.clearTree();
        // Message is set by clearTree/refresh via callback
    }
    initializeTestElementsTreeView(context);
    if (_projectTreeView && _projectManagementTreeDataProvider) {
        projectManagementTreeView.setupProjectTreeViewEventListeners(
            _projectTreeView,
            _projectManagementTreeDataProvider
        );
    }
}

/**
 * Registers all extension commands.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function registerExtensionCommands(context: vscode.ExtensionContext): Promise<void> {
    // --- Command: Show Extension Settings ---
    registerSafeCommand(context, allExtensionCommands.showExtensionSettings, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.showExtensionSettings}`);

        // Open the settings with the extension filter.
        await vscode.commands.executeCommand("workbench.action.openSettings2", {
            query: "@ext:imbus.testbench-visual-studio-code-extension"
        });
        // Open the "workspace" tab in settings view (The default settings view is the user tab in settings)
        await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings");
    });

    // --- Command: Set Workspace ---
    registerSafeCommand(context, allExtensionCommands.setWorkspace, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.setWorkspace}`);
        await utils.setWorkspaceLocation();
    });

    // --- Command: Manage Profiles ---
    registerSafeCommand(context, "testbenchExtension.manageProfiles", async () => {
        logger.debug("[Cmd] Called: testbenchExtension.manageProfiles");
        const profiles = await profileManager.getProfiles(context);
        const activeProfileId = await profileManager.getActiveProfileId(context);

        const items: vscode.QuickPickItem[] = [
            { label: "$(add) Add New Profile", description: "Configure a new TestBench connection" },
            ...profiles.map((p) => ({
                label: `${activeProfileId === p.id ? "$(check) " : ""}${p.label}`,
                description: `${p.username}@${p.serverName}:${p.portNumber}`,
                detail: p.id // Store ID for later use
            }))
        ];
        if (profiles.length > 0) {
            items.push({ label: "$(trash) Delete a Profile", description: "Remove a saved connection" });
            items.push({ label: "$(settings-gear) Set Active Profile", description: "Choose which profile to use" });
        }

        const selection = await vscode.window.showQuickPick(items, { placeHolder: "Manage TestBench Profiles" });

        if (selection) {
            if (selection.label.includes("$(add)")) {
                await vscode.commands.executeCommand(allExtensionCommands.addNewProfile);
            } else if (selection.label.includes("$(trash)")) {
                await vscode.commands.executeCommand(allExtensionCommands.deleteProfile);
            } else if (selection.label.includes("$(settings-gear)")) {
                await vscode.commands.executeCommand(allExtensionCommands.selectActiveProfile);
            } else if (selection.detail) {
                // An existing profile was selected (could be used to edit or set active)
                await profileManager.setActiveProfileId(context, selection.detail);
                vscode.window.showInformationMessage(
                    `Profile "${selection.label.replace("$(check) ", "")}" is now active. Please login if not already connected.`
                );
                // Trigger a login attempt with the new active profile
                await vscode.commands.executeCommand(allExtensionCommands.login);
            }
        }
    });

    registerSafeCommand(context, allExtensionCommands.addNewProfile, async () => {
        logger.debug("[Cmd] Called: testbenchExtension.addNewProfile");
        vscode.window.showInformationMessage(
            "To add a new profile, please use the 'TestBench: Login' command and choose to add a new connection when prompted."
        );
    });

    registerSafeCommand(context, allExtensionCommands.selectActiveProfile, async () => {
        logger.debug("[Cmd] Called: testbenchExtension.selectActiveProfile");
        const profiles = await profileManager.getProfiles(context);
        if (profiles.length === 0) {
            vscode.window.showInformationMessage("No saved TestBench profiles. Please add one first.");
            return;
        }
        const items = profiles.map((p) => ({
            label: p.label,
            description: `${p.username}@${p.serverName}:${p.portNumber}`,
            id: p.id
        }));
        const selection = await vscode.window.showQuickPick(items, { placeHolder: "Select active TestBench profile" });
        if (selection) {
            await profileManager.setActiveProfileId(context, selection.id);
            vscode.window.showInformationMessage(
                `Profile "${selection.label}" is now active. Please use the Login command to connect.`
            );
            // Optionally trigger login:
            // await vscode.commands.executeCommand(allExtensionCommands.login);
        }
    });

    registerSafeCommand(context, allExtensionCommands.deleteProfile, async () => {
        logger.debug("[Cmd] Called: testbenchExtension.deleteProfile");
        const profiles = await profileManager.getProfiles(context);
        if (profiles.length === 0) {
            vscode.window.showInformationMessage("No TestBench profiles to delete.");
            return;
        }
        const items = profiles.map((p) => ({ label: p.label, description: `ID: ${p.id}`, id: p.id }));
        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: "Select TestBench profile to delete"
        });
        if (selection) {
            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to delete profile "${selection.label}"?`,
                { modal: true },
                "Delete"
            );
            if (confirm === "Delete") {
                await profileManager.deleteProfile(context, selection.id);
                vscode.window.showInformationMessage(`Profile "${selection.label}" deleted.`);
            }
        }
    });

    // --- Command: Automatic Login After Activation ---
    registerSafeCommand(context, allExtensionCommands.automaticLoginAfterExtensionActivation, async () => {
        logger.debug(`[Cmd] Called: ${allExtensionCommands.automaticLoginAfterExtensionActivation}`);

        if (getConfig().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
            logger.info("[Cmd] Auto-login is enabled. Attempting silent login with last active profile...");

            const activeProfile = await profileManager.getActiveProfile(context);
            if (!activeProfile) {
                logger.info("[Cmd] Auto-login: No last active profile found. Cannot auto-login.");
                return;
            }

            const passwordIsStored = !!(await profileManager.getPasswordForProfile(context, activeProfile.id));
            const requiresPasswordAndNotStored =
                !passwordIsStored && getConfig().get<boolean>(ConfigKeys.STORE_PASSWORD_AFTER_LOGIN, false);

            if (requiresPasswordAndNotStored) {
                logger.warn(
                    `[Cmd] Auto-login: Password storage enabled, but no password found for active profile "${activeProfile.label}". Auto-login will likely fail if password is required.`
                );
            } else if (!getConfig().get<boolean>(ConfigKeys.STORE_PASSWORD_AFTER_LOGIN, false)) {
                logger.info(
                    `[Cmd] Auto-login: Password storage is disabled. Auto-login for profile "${activeProfile.label}" will only work if it does not require a password or server remembers session via other means.`
                );
            }

            if (!authProviderInstance) {
                logger.error("[Cmd] Auto-login: AuthenticationProvider instance is not available.");
                return;
            }

            try {
                // Set the active profile ID so the provider can pick it up
                await profileManager.setActiveProfileId(context, activeProfile.id);
                authProviderInstance.prepareForSilentAutoLogin();

                logger.trace("[Cmd] Auto-login: Calling vscode.authentication.getSession silently.");
                const session = await vscode.authentication.getSession(
                    TESTBENCH_AUTH_PROVIDER_ID,
                    ["api_access"], // Your defined scopes
                    { createIfNone: true } // Standard options
                );

                if (session) {
                    logger.info(
                        `[Cmd] Auto-login successful for profile: ${activeProfile.label} (session restored/created silently).`
                    );
                    // The onDidChangeSessions listener in extension.ts will handle further setup.
                } else {
                    // This case might not be hit if getSession throws on silent failure.
                    logger.info(
                        "[Cmd] Auto-login: No session restored/created silently. User may need to login manually."
                    );
                }
            } catch (error: any) {
                logger.warn(
                    `[Cmd] Auto-login attempt for profile "${activeProfile.label}" failed silently (this is expected if credentials/profile are incomplete or server issues prevent silent login): ${error.message}`
                );
                await profileManager.clearActiveProfile(context); // Clear if auto-login fails
            }
        } else {
            logger.trace("[Cmd] Auto-login is disabled in settings.");
        }
    });

    // --- Command: Login ---
    // Performs the login process and stores the connection object.
    registerSafeCommand(context, allExtensionCommands.login, async () => {
        logger.debug(`[Cmd] Called: ${allExtensionCommands.login}`);
        try {
            // This will trigger TestBenchAuthenticationProvider.createSession if no session exists
            const session = await vscode.authentication.getSession(
                TESTBENCH_AUTH_PROVIDER_ID,
                ["api_access"], // Define your scopes
                { createIfNone: true } // Prompt user to login if no session
            );
            // The onDidChangeSessions listener will handle setting up the connection object
            if (session) {
                logger.info(`[Cmd] Login successful, session ID: ${session.id}`);
                // handleTestBenchSessionChange might have already run, but ensure UI is updated
                await initializeTreeViews(context); // Re-ensure trees are ready
                getProjectManagementTreeDataProvider()?.refresh(true);
            }
        } catch (error) {
            logger.error(`[Cmd] Login process failed or was cancelled:`, error);
            vscode.window.showErrorMessage(`TestBench Login Failed: ${(error as Error).message}`);
        }
    });

    // --- Command: Logout ---
    // Performs the logout process and clears the connection object.
    registerSafeCommand(context, allExtensionCommands.logout, async () => {
        logger.debug(`[Cmd] Called (Alternative): ${allExtensionCommands.logout}`);
        try {
            logger.debug(`[Cmd] Called: ${allExtensionCommands.logout}`);

            // Step 1: Try to get an existing session for your provider.
            // We need the session.id to tell VS Code which session to remove.
            const session = await vscode.authentication.getSession(
                TESTBENCH_AUTH_PROVIDER_ID,
                [], // No specific scopes needed for logout, just to find the session
                { createIfNone: false, silent: true } // Do not create a new session if none exists, and don't show UI
            );

            if (session && session.id) {
                logger.trace(
                    `[Cmd] Found active TestBench session: ${session.id}. Attempting to remove via vscode.authentication.removeSession.`
                );

                if (authProviderInstance) {
                    await authProviderInstance.removeSession(session.id); // Call your provider's method
                    vscode.window.showInformationMessage("Logged out from TestBench.");
                } else {
                    logger.error("[Cmd] AuthProvider instance not available for logout.");
                    vscode.window.showErrorMessage("Logout failed: Auth provider not initialized.");
                    // Fallback to manual cleanup if provider instance is somehow null
                    await handleTestBenchSessionChange(context);
                }
            } else {
                logger.info("[Cmd] No active TestBench session found to logout. Ensuring UI is in a logged-out state.");
                // If VS Code's layer finds no session, ensure our extension's state is also cleared.
                // This is important if, for some reason, our internal state thinks we're logged in
                // but VS Code's session layer doesn't have a corresponding session.
                await handleTestBenchSessionChange(context); // This will set connection=null and update context
            }
        } catch (error: any) {
            logger.error(`[Cmd] Error during logout:`, error);
            vscode.window.showErrorMessage(`TestBench Logout Error: ${error.message}`);
            // Ensure clean state on error too
            await handleTestBenchSessionChange(context);
        }
    });

    // --- Command: Handle Cycle Click ---
    // Handles the click event on a cycle element in the project management tree view.
    registerSafeCommand(
        context,
        allExtensionCommands.handleProjectCycleClick,
        async (cycleItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.handleProjectCycleClick}`);
            const pmProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null =
                getProjectManagementTreeDataProvider();
            if (pmProvider) {
                // Clear the test theme tree and test elements tree view items before loading new data.
                // This might avoid displaying old data in the tree views if fetching fails.
                getTestThemeTreeDataProvider()?.clearTree();
                clearTestElementsTreeView();

                await pmProvider.handleTestCycleClick(cycleItem);
            } else {
                logger.error(
                    "Cycle click cannot be processed: Project management tree data provider is not initialized."
                );
                vscode.window.showErrorMessage("Project management tree is not initialized.");
            }
        }
    );

    // --- Command: Generate Test Cases For Cycle ---
    // Generates test cases for the selected cycle in the project management tree view.
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForCycle,
        async (item: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.generateTestCasesForCycle}`);
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error(`${allExtensionCommands.generateTestCasesForCycle} command called without connection.`);
                return;
            }

            // Optionally clear the working directory before test generation.
            if (config.get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }

            await reportHandler.startTestGenerationForCycle(context, item);
        }
    );

    // --- Command: Generate Test Cases For Test Theme or Test Case Set ---
    registerSafeCommand(
        context,
        allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet,
        async (treeItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet}`);
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error(
                    `${allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet} command called without connection.`
                );
                return;
            }
            // Optionally clear the working directory before test generation.
            if (config.get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }

            const ttProvider = getTestThemeTreeDataProvider();
            let cycleKey: string | null = null;

            if (ttProvider) {
                cycleKey = ttProvider.getCurrentCycleKey();
                if (cycleKey) {
                    logger.trace(`Using cycle key '${cycleKey}' from TestThemeTreeDataProvider for test generation.`);
                } else {
                    logger.warn(
                        "TestThemeTreeDataProvider available but cycle key not set. Falling back to parent traversal."
                    );
                    // Fallback
                    cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
                }
            } else {
                logger.warn("TestThemeTreeDataProvider not available. Falling back to parent traversal for cycle key.");
                // Fallback when provider is not available
                cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
            }

            if (!cycleKey) {
                vscode.window.showErrorMessage(
                    `Error: Cycle key not found for the selected item '${treeItem.label}'. Cannot generate tests.`
                );
                logger.error(
                    `Cycle key not found for tree element: ${treeItem.label} (UID: ${treeItem.item?.uniqueID || treeItem.item?.key})`
                );
                return;
            }

            await reportHandler.generateRobotFrameworkTestsForTestThemeOrTestCaseSet(context, treeItem, cycleKey);
        }
    );

    // --- Command: Display All Projects ---
    // Opens the project management tree view, hides other views, and displays all projects with their contents.
    registerSafeCommand(context, allExtensionCommands.displayAllProjects, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.displayAllProjects}`);
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error(`${allExtensionCommands.displayAllProjects} command called without connection.`);
            return;
        }

        await projectManagementTreeView?.displayProjectManagementTreeView();

        // Hide the test theme tree view and test elements tree view
        await hideTestThemeTreeView();
        await testElementsTreeView?.hideTestElementsTreeView();
    });

    // --- Command: Read Robotframework Test Results And Create Report With Results ---
    // Activated for a test theme or test case set element.
    // Reads the test results (output.xml) from the testbench working directory and creates a report zip file with the results.
    registerSafeCommand(context, allExtensionCommands.readRFTestResultsAndCreateReportWithResults, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.readRFTestResultsAndCreateReportWithResults}`);
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error(
                `${allExtensionCommands.readRFTestResultsAndCreateReportWithResults} command called without connection.`
            );
            return;
        }
        await reportHandler.fetchTestResultsAndCreateReportWithResultsWithTb2Robot(context);
    });

    // --- Command: Import Test Results To Testbench ---
    // Imports the selected test results zip to the testbench server
    registerSafeCommand(context, allExtensionCommands.importTestResultsToTestbench, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.importTestResultsToTestbench}`);
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            logger.error(`${allExtensionCommands.importTestResultsToTestbench} command called without connection.`);
            return;
        }

        await testBenchConnection.selectReportWithResultsAndImportToTestbench(connection);
    });

    // --- Command: Read And Import Test Results To Testbench ---
    // A command that combines the reading of robotframework test results, creating a report file with results, and importing test results to testbench server.
    registerSafeCommand(context, allExtensionCommands.readAndImportTestResultsToTestbench, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.readAndImportTestResultsToTestbench}`);
        if (!connection) {
            const noConnectionErrorMessage: string = "No connection available. Cannot import report.";
            vscode.window.showErrorMessage(noConnectionErrorMessage);
            logger.error(noConnectionErrorMessage);
            return null;
        }

        await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(context);
    });

    // --- Command: Refresh Project Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshProjectTreeView, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.refreshProjectTreeView} (Hard refresh)`);

        const pmProvider = getProjectManagementTreeDataProvider();
        const pTreeView = getProjectTreeView();
        if (pmProvider && pTreeView) {
            // Message update should be handled by provider via callback
            pmProvider.refresh(true); // true for hard refresh
        } else {
            logger.warn(`Project Management Tree Data Provider or Project Tree View not initialized. Cannot refresh.`);
        }
    });

    // --- Command: Refresh Test Theme Tree View ---
    registerSafeCommand(context, allExtensionCommands.refreshTestThemeTreeView, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.refreshTestThemeTreeView}`);

        const ttProvider = getTestThemeTreeDataProvider();
        const pmProvider = getProjectManagementTreeDataProvider();
        const ttView = getTestThemeTreeViewInstance();

        if (!ttProvider) {
            logger.warn("Test Theme Tree Data Provider not initialized. Cannot refresh.");
            vscode.window.showErrorMessage("Test Theme Tree is not available to refresh.");
            return;
        }

        if (!pmProvider) {
            logger.warn("Project Management Tree Data Provider not initialized. Cannot refresh.");
            vscode.window.showErrorMessage("Project Management Tree is not available to refresh.");
            return;
        }

        if (!ttView) {
            logger.warn("Test Theme TreeView instance is not available. Cannot set message.");
        }

        // Message update should be handled by provider via callback
        ttProvider.refresh();

        const currentCycleKey: string | null = ttProvider["_currentCycleKey"];
        if (currentCycleKey) {
            const firstRootInThemeTree = ttProvider.rootElements[0];
            const cycleElement: projectManagementTreeView.BaseTestBenchTreeItem | undefined =
                firstRootInThemeTree?.parent ?? undefined;

            if (
                cycleElement &&
                cycleElement.contextValue === TreeItemContextValues.CYCLE &&
                cycleElement.item?.key === currentCycleKey
            ) {
                logger.info(
                    `Refreshing Test Theme Tree for cycle: ${typeof cycleElement.label === "string" ? cycleElement.label : "N/A"}`
                );
                // Re-fetch children for this cycle and update the testThemeTreeDataProvider
                const children: projectManagementTreeView.BaseTestBenchTreeItem[] =
                    (await pmProvider.getChildrenOfCycle(cycleElement)) ?? [];
                // The setRoots will internally call refresh on testThemeTreeDataProvider
                ttProvider.setRoots(children, cycleElement.item.key);
                const themeTreeView = getTestThemeTreeViewInstance();
                if (themeTreeView) {
                    // Check if defined
                    themeTreeView.title = `Test Themes (${typeof cycleElement.label === "string" ? cycleElement.label : "Cycle"})`;
                }
            } else if (currentCycleKey) {
                logger.warn(
                    `Could not find the parent cycle element for the current Test Theme Tree (cycleKey: ${currentCycleKey}). Refreshing with current roots.`
                );
                ttProvider.refresh(); // Re-render current items.
            } else {
                logger.debug(
                    "No current cycle in Test Theme Tree to refresh, or provider not found. Clearing and refreshing."
                );
                ttProvider.clearTree(); // Calls refresh internally
            }
        } else {
            logger.warn(
                "Refresh Test Theme Tree: projectManagementTreeDataProvider or testThemeTreeDataProvider is null."
            );
            if (ttProvider) {
                ttProvider.refresh();
            } // Attempt to refresh what it has
        }
    });

    // --- Command: Make Root ---
    // Right clicking on a tree element and selecting "Make Root" context menu option will make the selected element the root of the tree.
    // Refreshing the tree will revert the tree to its original state.
    registerSafeCommand(
        context,
        allExtensionCommands.makeRoot,
        (treeItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(`Command Called: ${allExtensionCommands.makeRoot} for tree item:`, treeItem);
            if (!treeItem) {
                logger.warn("MakeRoot command called with null treeItem.");
                return;
            }

            const pmProvider = getProjectManagementTreeDataProvider();
            const ttProvider = getTestThemeTreeDataProvider();

            // Check if the item belongs to the Project Management Tree
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
                if (pmProvider) {
                    pmProvider.makeRoot(treeItem);
                } else {
                    const makeRootNoProviderErrorMessage: string =
                        "MakeRoot command called without projectManagementTreeDataProvider.";
                    logger.warn(makeRootNoProviderErrorMessage);
                    vscode.window.showErrorMessage(makeRootNoProviderErrorMessage);
                }
            }
            // Check if the item belongs to the Test Theme Tree
            else if (
                ttProvider &&
                treeItem.contextValue &&
                (
                    [TreeItemContextValues.TEST_THEME_NODE, TreeItemContextValues.TEST_CASE_SET_NODE] as string[]
                ).includes(treeItem.contextValue)
            ) {
                // Delegate to testThemeTreeDataProvider if it's a test theme item
                if (typeof (ttProvider as any).makeRoot === "function") {
                    (ttProvider as any).makeRoot(treeItem);
                } else {
                    logger.warn(
                        `MakeRoot: testThemeTreeDataProvider does not have a makeRoot method or item type (${treeItem.contextValue}) is not supported for makeRoot in test theme tree.`
                    );
                    vscode.window.showInformationMessage(
                        `Cannot make '${treeItem.label}' root in the Test Themes view with current implementation.`
                    );
                }
            } else {
                logger.warn(
                    `MakeRoot: Item type "${treeItem.contextValue}" not supported for makeRoot or target provider not identified.`
                );
                vscode.window.showInformationMessage(
                    `Item '${treeItem.label}' cannot be made a root in the current view.`
                );
            }
        }
    );

    // --- Command: Clear Workspace Folder ---
    // Clears the workspace folder of its contents, excluding extension log files.
    registerSafeCommand(context, allExtensionCommands.clearInternalTestbenchFolder, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.clearInternalTestbenchFolder}`);
        const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return;
        }
        const testbenchWorkingDirectoryPath: string = path.join(workspaceLocation, folderNameOfInternalTestbenchFolder);
        await utils.clearInternalTestbenchFolder(
            testbenchWorkingDirectoryPath,
            [testBenchLogger.folderNameOfLogs], // Exclude log files from deletion
            !config.get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR) // Ask for confirmation if not set to clear before test generation
        );
    });

    // --- Command: Refresh Test Elements Tree ---
    // Refreshes the test elements tree view with the latest test elements for the selected TOV.
    registerSafeCommand(context, allExtensionCommands.refreshTestElementsTree, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.refreshTestElementsTree}`);
        const teProvider = getTestElementsTreeDataProvider();
        if (!teProvider) {
            logger.warn("Test Elements Tree Data Provider not initialized. Cannot refresh Test Elements Tree.");
            return;
        }
        const currentTovKey: string = teProvider.getCurrentTovKey();
        if (!currentTovKey) {
            vscode.window.showErrorMessage("No TOV key stored. Please fetch test elements first.");
            return;
        }
        await teProvider.fetchTestElements(currentTovKey);
    });

    // --- Command: Display Interactions For Selected TOV ---
    registerSafeCommand(
        context,
        allExtensionCommands.displayInteractionsForSelectedTOV,
        async (treeItem: projectManagementTreeView.BaseTestBenchTreeItem) => {
            logger.debug(
                `Command Called: ${allExtensionCommands.displayInteractionsForSelectedTOV} for tree item:`,
                treeItem
            );
            const pmProvider = getProjectManagementTreeDataProvider();
            const teProvider = getTestElementsTreeDataProvider();
            // Check if the command is executed for a TOV element.
            if (pmProvider && treeItem.contextValue === TreeItemContextValues.VERSION) {
                const tovKeyOfSelectedTreeElement = treeItem.item?.key?.toString();
                if (tovKeyOfSelectedTreeElement && teProvider) {
                    const areTestElementsFetched: boolean = await teProvider.fetchTestElements(
                        tovKeyOfSelectedTreeElement,
                        typeof treeItem.label === "string" ? treeItem.label : undefined
                    );
                    if (areTestElementsFetched) {
                        await projectManagementTreeView?.hideProjectManagementTreeView();
                        await displayTestElementsTreeView();
                        const projectAndTovNameObj = getProjectAndTovNamesFromSelection(treeItem);

                        if (projectAndTovNameObj) {
                            const { projectName, tovName } = projectAndTovNameObj;

                            if (projectName && tovName) {
                                await initializeLanguageServer(projectName, tovName);
                            }
                        }
                    } else {
                        logger.warn(
                            `Test Elements Tree Data Provider not initialized or failed to fetch test elements for TOV: ${tovKeyOfSelectedTreeElement}`
                        );
                        vscode.window.showErrorMessage(
                            `Failed to fetch test elements for TOV: ${tovKeyOfSelectedTreeElement}`
                        );
                    }
                }
            }
        }
    );

    // --- Command: Go To Resource File ---
    // Opens or creates the robot resource file associated with the selected test element.
    registerSafeCommand(
        context,
        allExtensionCommands.openOrCreateRobotResourceFile,
        async (treeItem: testElementsTreeView.TestElementTreeItem) => {
            logger.debug(
                `Command Called: ${allExtensionCommands.openOrCreateRobotResourceFile} for tree item:`,
                treeItem
            );
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
                vscode.window.showErrorMessage(`Error in Open Robot Resource File command: ${error.message}`);
                logger.error(`${allExtensionCommands.openOrCreateRobotResourceFile} command failed: ${error.message}`);
            }
        }
    );

    // --- Command: Create Interaction Under Subdivision ---
    // Creates a new interaction tree element under the selected subdivision.
    registerSafeCommand(
        context,
        allExtensionCommands.createInteractionUnderSubdivision,
        async (subdivisionTreeItem: testElementsTreeView.TestElementTreeItem) => {
            logger.debug(
                `Command Called: ${allExtensionCommands.createInteractionUnderSubdivision} for tree item:`,
                subdivisionTreeItem
            );

            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                logger.error(
                    `${allExtensionCommands.createInteractionUnderSubdivision} command called without connection.`
                );
                return;
            }

            const teProvider = getTestElementsTreeDataProvider();
            if (!teProvider) {
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
                teProvider._onDidChangeTreeData.fire(undefined);

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
        logger.debug(`Command Called: ${allExtensionCommands.openIssueReporter}`);
        vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench-visual-studio-code-extension"
        });
    });

    // --- Command: Modify Report With Results Zip ---
    // Allows the user to select a report zip file and create a new report by removing JSON files that were not selected in the quick pick from the original report zip.
    registerSafeCommand(context, allExtensionCommands.modifyReportWithResultsZip, async () => {
        logger.debug(`Command Called: ${allExtensionCommands.modifyReportWithResultsZip}`);

        // Prompt the user to select a report zip file with results.
        const zipUris: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
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
    });

    // Set context value for connectionActive.
    // Used to enable or disable the login and logout buttons in the status bar,
    // which allows icon changes for login/logout buttons based on connectionActive variable.
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, connection !== null);
    logger.trace(`Context value connectionActive set to: ${connection !== null}`);
}

/**
 * Handles changes in the TestBench authentication session.
 *
 * This function is responsible for updating the application state based on the
 * provided or retrieved authentication session. It will:
 * - Attempt to retrieve an active session if one is not provided.
 * - If a session is active and an active profile exists:
 *   - Initialize a `PlayServerConnection` with the session token and profile details.
 *   - Set the `ContextKeys.CONNECTION_ACTIVE` to true.
 *   - Refresh relevant tree views and update the login webview.
 * - If a session is active but no active profile is found:
 *   - Clear any existing connection and log out the user from the server.
 *   - Set `ContextKeys.CONNECTION_ACTIVE` to false.
 *   - Clear tree views and update the login webview.
 * - If no session is active:
 *   - Clear any existing connection and log out the user from the server.
 *   - Set `ContextKeys.CONNECTION_ACTIVE` to false.
 *   - Clear tree views and update the login webview.
 *
 * @param context - The VS Code extension context.
 * @param existingSession - An optional existing authentication session to process.
 *                          If not provided, the function will attempt to retrieve the current session.
 * @returns A promise that resolves when the session change has been handled.
 */
async function handleTestBenchSessionChange(
    context: vscode.ExtensionContext,
    existingSession?: vscode.AuthenticationSession
): Promise<void> {
    logger.info(`[handleTestBenchSessionChange] Session changed. Processing... Has session: ${!!existingSession}`);
    let sessionToProcess = existingSession;
    if (!sessionToProcess) {
        try {
            sessionToProcess = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                createIfNone: false,
                silent: true
            });
        } catch (error) {
            logger.warn("[Extension] Error getting current session during handleTestBenchSessionChange:", error);
            sessionToProcess = undefined;
        }
    }

    const wasPreviouslyConnected = !!connection; // Check connection state before potential changes

    if (sessionToProcess && sessionToProcess.accessToken) {
        const activeProfile = await profileManager.getActiveProfile(context);
        if (activeProfile) {
            // Check if a connection for this session and profile already exists
            if (
                connection && // Global connection object from extension.ts
                connection.getSessionToken() === sessionToProcess.accessToken &&
                connection.getUsername() === activeProfile.username &&
                connection.getServerName() === activeProfile.serverName &&
                connection.getServerPort() === activeProfile.portNumber.toString()
            ) {
                logger.info(
                    `[Extension] Connection for profile '${activeProfile.label}' and current session token is already active. Skipping re-initialization.`
                );
                if (!wasPreviouslyConnected) {
                    logger.info("[Extension] Re-asserting UI state for existing matching connection.");
                    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, true); // Ensure context is set
                    getLoginWebViewProvider()?.updateWebviewHTMLContent();
                    await vscode.commands.executeCommand(allExtensionCommands.displayAllProjects);
                    getProjectManagementTreeDataProvider()?.refresh(true);
                    getTestThemeTreeDataProvider()?.clearTree();
                    clearTestElementsTreeView();
                }
                return; // Exit if the connection is already the correct one
            }

            logger.info(
                `[Extension] TestBench session active for profile: ${activeProfile.label}. Initializing PlayServerConnection.`
            );

            if (connection) {
                logger.warn(
                    "[Extension] A different connection was active. Logging out from previous server session before establishing new one."
                );
                await connection.logoutUserOnServer(); // Ensure previous server session is terminated
            }

            const newConnection = new PlayServerConnection(
                activeProfile.serverName,
                activeProfile.portNumber,
                activeProfile.username,
                sessionToProcess.accessToken
            );
            setConnection(newConnection); // Set the global connection
            await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, true);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();

            if (
                !wasPreviouslyConnected ||
                (connection && connection.getSessionToken() !== newConnection.getSessionToken())
            ) {
                // This is a new login session (e.g., startup auto-login, or manual login from disconnected state)
                logger.info(
                    "[Extension] New session established. Setting default view to 'Projects' and refreshing data."
                );
                // Set the correct view visibility
                await vscode.commands.executeCommand(allExtensionCommands.displayAllProjects);

                // Refresh/clear data
                getProjectManagementTreeDataProvider()?.refresh(true); // Hard refresh for projects
                getTestThemeTreeDataProvider()?.clearTree();
                clearTestElementsTreeView();
            } else {
                // Session changed while already connected (e.g., profile switch if supported, or token refresh)
                // For a profile switch, resetting to Projects view is also a good default.
                logger.info(
                    "[Extension] Session changed while already connected. Resetting view to 'Projects' and refreshing data."
                );
                await vscode.commands.executeCommand(allExtensionCommands.displayAllProjects);
                getProjectManagementTreeDataProvider()?.refresh(true);
                getTestThemeTreeDataProvider()?.clearTree();
                clearTestElementsTreeView();
            }
        } else {
            logger.warn("[Extension] Session exists, but no active profile. Clearing connection.");
            if (connection) {
                await connection.logoutUserOnServer();
            }
            setConnection(null);
            await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();

            // Clean up views and data on logout/no active profile
            await projectManagementTreeView?.hideProjectManagementTreeView();
            await hideTestThemeTreeView();
            await testElementsTreeView?.hideTestElementsTreeView();
            getProjectManagementTreeDataProvider()?.clearTree();
            getTestThemeTreeDataProvider()?.clearTree();
            clearTestElementsTreeView();
        }
    } else {
        logger.info("[Extension] No active session. Clearing connection.");
        if (connection) {
            await connection.logoutUserOnServer();
        }
        setConnection(null);
        await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
        getLoginWebViewProvider()?.updateWebviewHTMLContent();

        // Clean up views and data on logout
        await projectManagementTreeView?.hideProjectManagementTreeView();
        await hideTestThemeTreeView();
        await testElementsTreeView?.hideTestElementsTreeView();
        getProjectManagementTreeDataProvider()?.clearTree();
        getTestThemeTreeDataProvider()?.clearTree();
        clearTestElementsTreeView();
    }
}

/**
 * Updates the context for the Language Server and triggers a restart.
 * @param {string} projectName (Optional) The name of the selected project.
 * @param {string} tovName (Optional) The name of the selected TOV.
 */
export async function updateLanguageServerContextAndRestart(projectName?: string, tovName?: string): Promise<void> {
    const projectChanged: boolean = currentLanguageServerProject !== projectName;
    const tovChanged: boolean = currentLanguageServerTov !== tovName;

    if (projectChanged || tovChanged) {
        logger.info(` Project name or TOV name changed.
            Old: Project='${currentLanguageServerProject}', TOV='${currentLanguageServerTov}'. 
            New: Project='${projectName}', TOV='${tovName}'.`);
        currentLanguageServerProject = projectName;
        currentLanguageServerTov = tovName;
        // TODO: Restart language server with new project and TOV here
    }
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

    // Load initial configuration
    await loadConfiguration(context);

    // Register AuthenticationProvider
    authProviderInstance = new TestBenchAuthenticationProvider(context);
    context.subscriptions.push(
        vscode.authentication.registerAuthenticationProvider(
            TESTBENCH_AUTH_PROVIDER_ID,
            TESTBENCH_AUTH_PROVIDER_LABEL, // User-facing name in Accounts UI
            authProviderInstance,
            { supportsMultipleAccounts: false } // Change to true to support multiple simultaneous TestBench logins
        )
    );
    logger.info("TestBenchAuthenticationProvider registered.");

    // Session Change Listener
    context.subscriptions.push(
        vscode.authentication.onDidChangeSessions(async (e) => {
            if (e.provider.id === TESTBENCH_AUTH_PROVIDER_ID) {
                logger.info("[Extension] TestBench authentication sessions changed.");
                try {
                    // Get the current session state directly from the API.
                    const currentSession = await vscode.authentication.getSession(
                        TESTBENCH_AUTH_PROVIDER_ID,
                        ["api_access"],
                        { createIfNone: false, silent: true } // Get an existing session
                    );
                    logger.info(
                        `[Extension] Fetched current session in onDidChangeSessions: ${currentSession ? currentSession.id : "undefined"}`
                    );
                    await handleTestBenchSessionChange(context, currentSession);
                } catch (error) {
                    logger.error("[Extension] Error getting session in onDidChangeSessions listener:", error);
                    // If an error occurs, it's safer to assume no session / logout state.
                    await handleTestBenchSessionChange(context, undefined);
                }
            }
        })
    );

    initializeTreeViews(context);

    // Set the initial connection context state. Before any login attempt, connection is null.
    // VS Code will show/hide views based on this initial state matching the 'when' clauses in package.json
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, connection !== null);
    logger.trace(`Initial connectionActive context set to: ${connection !== null}`);

    // Register the login webview provider.
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Register all extension commands.
    await registerExtensionCommands(context);

    // Attempt to restore session on activation
    // Try to get an existing session without creating one.
    logger.trace("[Extension] Attempting to silently restore existing TestBench session on activation...");
    try {
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: false, // Dont trigger createSession yet
            silent: true // Try to get silently
        });
        if (session) {
            logger.info("[Extension] Found existing VS Code AuthenticationSession for TestBench during initial check.");
            await handleTestBenchSessionChange(context, session);
        } else {
            logger.info("[Extension] No existing TestBench session found during initial check.");
            // If auto-login is enabled, it will be triggered next.
            // If not, user needs to login manually.
            // Ensure UI reflects logged-out state if no session and no auto-login.
            if (!getConfig().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
                await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
                getLoginWebViewProvider()?.updateWebviewHTMLContent();
            }
        }
    } catch (error) {
        logger.warn("[Extension] Error trying to get initial session silently:", error);
        await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
    }

    // Trigger Automatic Login Command if configured
    // This will happen *after* the initial silent check for an existing session.
    if (getConfig().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
        logger.info("[Extension] Auto-login configured. Triggering automatic login command.");
        // Dont use await, to block the login webview display, let it run in background
        vscode.commands
            .executeCommand(allExtensionCommands.automaticLoginAfterExtensionActivation)
            .then(undefined, (err) => {
                logger.error("[Extension] Error triggering auto-login command during activation:", err);
            });
    } else {
        logger.info("[Extension] Auto-login is disabled. Skipping automatic login command.");
    }

    logger.info("Extension activated successfully.");
}

/**
 * Called when the extension is deactivated.
 */
export async function deactivate(): Promise<void> {
    try {
        // Gracefully log out the user when the extension is deactivated.
        if (connection) {
            logger.info("[Extension] Performing server logout on deactivation.");
            await connection.logoutUserOnServer();
            setConnection(null);
        }
        // Stop the language server
        if (client) {
            await client?.stop();
            logger.info("[Extension] Language server stopped.");
        }
        logger.info("Extension deactivated.");
    } catch (error) {
        logger.error("Error during deactivation:", error);
    }
}
