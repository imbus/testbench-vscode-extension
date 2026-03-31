/**
 * @file src/extension.ts
 * @description Main entry point for the TestBench VS Code extension.
 */

import * as vscode from "vscode";
import * as testBenchLogger from "./testBenchLogger";
import * as testBenchConnection from "./testBenchConnection";
import * as loginWebView from "./loginWebView";
import {
    allExtensionCommands,
    ConfigKeys,
    ContextKeys,
    folderNameOfInternalTestbenchFolder,
    StorageKeys
} from "./constants";
import {
    TestBenchAuthenticationProvider,
    TESTBENCH_AUTH_PROVIDER_ID,
    TESTBENCH_AUTH_PROVIDER_LABEL,
    getSessionToProcess
} from "./testBenchAuthenticationProvider";
import * as connectionManager from "./connectionManager";
import { PlayServerConnection } from "./testBenchConnection";
import { getExtensionConfiguration, initializeConfigurationWatcher } from "./configuration";
import { TreeViews } from "./treeViews/TreeViewFactory";
import * as utils from "./utils";
import path from "path";
import {
    stopLanguageClient,
    client,
    handleLanguageServerRestartOnSessionChange,
    configureLanguageServerIntegration
} from "./languageServer/server";
import { displayProjectManagementTreeView } from "./treeViews/implementations/projects/ProjectsTreeView";
import { hideTestElementsTreeView } from "./treeViews/implementations/testElements/TestElementsTreeView";
import { hideTestThemeTreeView } from "./treeViews/implementations/testThemes/TestThemesTreeView";
import { initializeTreeViews } from "./treeViews/TreeViewFactory";
import { UserSessionManager } from "./userSessionManager";
import { SharedSessionManager } from "./sharedSessionManager";
import { v4 as uuidv4 } from "uuid";
import { activeConfigService } from "./languageServer/activeConfigService";
import { checkWorkspaceAndNotifyUser } from "./utils";
import { registerExtensionCommands } from "./extensionCommands";

/* =============================================================================
   Constants, Global Variables & Exports
   ============================================================================= */

// Global logger instance.
export let logger: testBenchLogger.TestBenchLogger;
export function setLogger(newLogger: testBenchLogger.TestBenchLogger): void {
    logger = newLogger;
}
export function getLogger(): testBenchLogger.TestBenchLogger {
    return logger;
}

// Global connection to the (new) TestBench Play server.
export let connection: testBenchConnection.PlayServerConnection | null = null;
export function setConnection(newConnection: testBenchConnection.PlayServerConnection | null): void {
    connection = newConnection;
}
export function getConnection(): testBenchConnection.PlayServerConnection | null {
    return connection;
}

// Login webview provider instance.
let loginWebViewProvider: loginWebView.LoginWebViewProvider | null = null;
export function getLoginWebViewProvider(): loginWebView.LoginWebViewProvider | null {
    return loginWebViewProvider;
}

// Global tree views instance
export let treeViews: TreeViews | null = null;
export function setTreeViews(newTreeViews: TreeViews | null): void {
    treeViews = newTreeViews;
}

export let extensionContext: vscode.ExtensionContext;
export function setExtensionContext(context: vscode.ExtensionContext): void {
    extensionContext = context;
}

// Global variable to store the authentication provider instance
let authProviderInstance: TestBenchAuthenticationProvider | null = null;
export function getAuthProvider(): TestBenchAuthenticationProvider | null {
    return authProviderInstance;
}

// Prevent multiple session change handling simultaneously
let isHandlingSessionChange: boolean = false;
export function setIsHandlingSessionChange(value: boolean): void {
    isHandlingSessionChange = value;
}
export function getIsHandlingSessionChange(): boolean {
    return isHandlingSessionChange;
}

// Prevent multiple test generation or import operations simultaneously
export let isTestOperationInProgress: boolean = false;
export function setIsTestOperationInProgress(value: boolean): void {
    isTestOperationInProgress = value;
}
export function getIsTestOperationInProgress(): boolean {
    return isTestOperationInProgress;
}

export let userSessionManager: UserSessionManager;

// Determines if the icon of the tree item should be changed after generating tests for that item.
export const ENABLE_ICON_MARKING_ON_TEST_GENERATION: boolean = true;
// Determines if the import button of the tree item should still persist after importing test results for that item.
export const ALLOW_PERSISTENT_IMPORT_BUTTON: boolean = true;

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
            logger.error(`[extension] Error executing command: ${errorMessage}`, error);
            vscode.window.showErrorMessage(`Error executing command: ${errorMessage}`);
        }
    };
}

/**
 * Creates and initializes a new PlayServerConnection.
 * @param activeConnection - The active connection to use.
 * @param session - The session to use.
 * @param currentConnection - The current connection to use.
 * @param context - The extension context.
 * @returns The new connection.
 */
async function createNewConnection(
    activeConnection: connectionManager.TestBenchConnection,
    session: vscode.AuthenticationSession,
    currentConnection: PlayServerConnection | null,
    context: vscode.ExtensionContext,
    isInsecure: boolean,
    serverVersion: string = ""
): Promise<PlayServerConnection> {
    if (currentConnection) {
        logger.warn(
            "[extension] A different connection was active. Logging out from previous server session before establishing new one."
        );
        await currentConnection.teardownAfterLogout();
    }

    const newConnection = new PlayServerConnection(
        activeConnection.serverName,
        activeConnection.portNumber,
        activeConnection.username,
        session.accessToken,
        context,
        isInsecure,
        serverVersion
    );
    await newConnection.initialize();
    setConnection(newConnection);
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, true);
    getLoginWebViewProvider()?.updateWebviewHTMLContent();
    await checkWorkspaceAndNotifyUser();

    return newConnection;
}

/**
 * Handles the case when there's no active connection but a session exists. *
 */
async function handleNoActiveConnection(): Promise<void> {
    if (connection) {
        await connection.teardownAfterLogout();
    }

    if (treeViews) {
        treeViews.clear();
        treeViews.projectsTree.clearCache();
        await treeViews.loadDefaultViewsUI();
    }
}

/**
 * Handles the case when there's no session (logout).
 */
export async function handleNoSession(): Promise<void> {
    if (connection) {
        await connection.teardownAfterLogout();
    }
    setConnection(null);
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);

    // Save current state before ending session to ensure persistence
    if (treeViews) {
        await treeViews.saveCurrentState();
    }

    userSessionManager.endSession();

    // Clear tree data but preserve persistent state (expansion, marking, etc.)
    if (treeViews) {
        treeViews.projectsTree.clearTree();
        treeViews.projectsTree.clearCache();
        treeViews.testThemesTree.clearTree();
        treeViews.testElementsTree.clearTree();
        await treeViews.loadDefaultViewsUI();
    }

    await stopLanguageClient();
    getLoginWebViewProvider()?.updateWebviewHTMLContent();
}

/**
 * Handles changes in the TestBench authentication session.
 *
 * @param {vscode.ExtensionContext} context - The VS Code extension context.
 * @param {vscode.AuthenticationSession} existingSession - An optional existing authentication session to process.
 */
export async function handleTestBenchSessionChange(
    context: vscode.ExtensionContext,
    existingSession?: vscode.AuthenticationSession
): Promise<void> {
    logger.trace(`[extension] Handling session change`);

    const sessionToProcess = await getSessionToProcess(existingSession);
    const wasPreviouslyConnected = !!connection;
    const previousSessionToken = connection?.getSessionToken();

    if (sessionToProcess?.accessToken) {
        // Clear previous logout signals on new login
        await context.globalState.update(StorageKeys.LOGOUT_SIGNAL_KEY, undefined);
        logger.trace("[extension] Cleared logout signal due to new session.");

        getLoginWebViewProvider()?.resetEditMode();
        const previousUserId = userSessionManager.getCurrentUserId();
        const newUserId = sessionToProcess.account.id;
        const wasNewSessionStarted = previousUserId !== newUserId;
        const sharedSessionManager = SharedSessionManager.getInstance(context);
        const sharedSession = await sharedSessionManager.getSharedSession();
        let isInsecure = false;
        let serverVersion = "";
        if (sharedSession && sharedSession.sessionToken === sessionToProcess.accessToken) {
            isInsecure = sharedSession.isInsecure;
            serverVersion = sharedSession.serverVersion || "";
        }

        // If switching to a different user, reset state for the previous user's data
        if (wasNewSessionStarted && previousUserId !== "global_fallback" && treeViews) {
            logger.trace(
                `[extension] Switching from user ${previousUserId} to ${newUserId}, clearing previous user's tree state`
            );
            await treeViews.resetForNewUser();
        }

        userSessionManager.startSession({
            userKey: sessionToProcess.account.id,
            login: sessionToProcess.account.label
        });

        const activeConnection = await connectionManager.getActiveConnection(context);

        if (!activeConnection) {
            await handleNoActiveConnection();
            return;
        }

        if (connectionManager.isConnectionAlreadyActive(connection, sessionToProcess, activeConnection)) {
            logger.trace(
                `[extension] Connection for '${activeConnection.label}' and current session token is already active. Skipping re-initialization.`
            );
            return;
        }
        const newConnection = await createNewConnection(
            activeConnection,
            sessionToProcess,
            connection,
            context,
            isInsecure,
            serverVersion
        );
        await handleLanguageServerRestartOnSessionChange(previousSessionToken, newConnection.getSessionToken());

        const isNewConnection =
            !wasPreviouslyConnected ||
            !!(connection && connection.getSessionToken() !== newConnection.getSessionToken());

        if (isNewConnection && treeViews) {
            logger.trace("[extension] New connection established, restoring tree view state.");
            await treeViews.reloadAllTreeViewsStateFromPersistence({ refresh: false });
            await treeViews.restoreViewsState();
        } else if (treeViews) {
            logger.trace("[extension] Session refreshed, reloading persistent UI state.");
            await treeViews.reloadAllTreeViewsStateFromPersistence();
        }
    } else {
        await handleNoSession();
    }
}

/** Sets up and registers the authentication provider and its listeners.
 * @param context The extension context.
 * @param instanceId A unique identifier for this extension instance.
 * @returns The initialized TestBenchAuthenticationProvider instance.
 */
function initializeAuthentication(
    context: vscode.ExtensionContext,
    instanceId: string
): TestBenchAuthenticationProvider {
    const authProviderInstance = new TestBenchAuthenticationProvider(context, instanceId);
    context.subscriptions.push(
        vscode.authentication.registerAuthenticationProvider(
            TESTBENCH_AUTH_PROVIDER_ID,
            TESTBENCH_AUTH_PROVIDER_LABEL,
            authProviderInstance,
            { supportsMultipleAccounts: false }
        )
    );

    context.subscriptions.push(
        vscode.authentication.onDidChangeSessions(async (e) => {
            if (e.provider.id !== TESTBENCH_AUTH_PROVIDER_ID || isHandlingSessionChange) {
                return;
            }

            isHandlingSessionChange = true;
            logger.trace("[extension] TestBench authentication sessions changed.");
            try {
                const currentSession = await vscode.authentication.getSession(
                    TESTBENCH_AUTH_PROVIDER_ID,
                    ["api_access"],
                    { createIfNone: false, silent: true }
                );
                await handleTestBenchSessionChange(context, currentSession);
            } catch (error) {
                logger.error("[extension] Error getting session in onDidChangeSessions listener:", error);
                await handleTestBenchSessionChange(context, undefined);
            } finally {
                isHandlingSessionChange = false;
            }
        })
    );

    logger.trace("[extension] TestBenchAuthenticationProvider registered.");
    return authProviderInstance;
}

/** Initializes context keys. */
async function initializeContextValues(context: vscode.ExtensionContext): Promise<void> {
    // Set initial context states
    const initialContexts = [
        { key: ContextKeys.CONNECTION_ACTIVE, value: false },
        { key: ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, value: false },
        { key: ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, value: false },
        { key: ContextKeys.FILTER_DIFF_MODE_ENABLED, value: false },
        { key: ContextKeys.FILTER_DIFF_MODE_ENABLED_PROJECTS, value: false },
        { key: ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_THEMES, value: false },
        { key: ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_ELEMENTS, value: false },
        { key: ContextKeys.TEST_THEME_TREE_HAS_FILTERS, value: false }
    ];

    for (const ctx of initialContexts) {
        await vscode.commands.executeCommand("setContext", ctx.key, ctx.value);
    }

    const isTTOpenedFromCycle = context.globalState.get<string | undefined>(
        StorageKeys.IS_TT_OPENED_FROM_CYCLE_STORAGE_KEY
    );
    await vscode.commands.executeCommand("setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, isTTOpenedFromCycle);

    // Initialize workspace availability context and listener
    const updateWorkspaceAvailabilityContext = async () => {
        const hasWorkspace = (vscode.workspace.workspaceFolders?.length || 0) > 0;
        await vscode.commands.executeCommand("setContext", ContextKeys.WORKSPACE_AVAILABLE, hasWorkspace);
    };
    await updateWorkspaceAvailabilityContext();
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            updateWorkspaceAvailabilityContext().catch((err) =>
                logger?.error("[extension] Error updating workspace availability context:", err)
            );
        })
    );
}

/**
 * Validates a stored session by attempting to use it to fetch a simple endpoint.
 * This prevents creating connections and opening tree views with expired tokens.
 * @param context The extension context
 * @param session The session to validate
 * @returns True if the session is valid, false otherwise
 */
async function validateStoredSession(
    context: vscode.ExtensionContext,
    session: vscode.AuthenticationSession
): Promise<boolean> {
    logger.trace("[extension] Validating stored session before restoration...");

    try {
        const sharedSessionManager = SharedSessionManager.getInstance(context);
        const sharedSession = await sharedSessionManager.getSharedSession();

        if (!sharedSession || sharedSession.sessionToken !== session.accessToken) {
            logger.debug("[extension] No matching shared session data found for validation.");
            return false;
        }

        const tempConnection = new PlayServerConnection(
            sharedSession.serverName,
            sharedSession.portNumber,
            sharedSession.username,
            sharedSession.sessionToken,
            context,
            sharedSession.isInsecure,
            sharedSession.serverVersion || ""
        );

        await tempConnection.initialize();
        const isValid = await sharedSessionManager.validateSession(tempConnection);
        await tempConnection.teardownAfterLogout();

        if (!isValid) {
            logger.debug("[extension] Stored session validation failed, session is expired or invalid.");
            await sharedSessionManager.clearSharedSession();
        }

        return isValid;
    } catch (error: any) {
        logger.warn("[extension] Session validation failed:", error.message || error);
        const sharedSessionManager = SharedSessionManager.getInstance(context);
        await sharedSessionManager.clearSharedSession();
        return false;
    }
}

/** Attempts to restore a previous session or perform an automatic login. */
async function handleInitialSession(context: vscode.ExtensionContext): Promise<void> {
    logger.trace("[extension] Checking for existing TestBench session to restore...");
    try {
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: false,
            silent: true
        });

        if (session) {
            // Validate the session before using it
            const isSessionValid = await validateStoredSession(context, session);

            if (isSessionValid) {
                await handleTestBenchSessionChange(context, session);
                logger.debug("[extension] Successfully restored previous TestBench session.");
                return; // Session restored, no need for auto-login
            } else {
                logger.debug("[extension] Stored session is no longer valid. Clearing session and showing login.");
                // Remove the invalid session
                if (authProviderInstance) {
                    await authProviderInstance.removeSession(session.id);
                }
                getLoginWebViewProvider()?.updateWebviewHTMLContent();
                return;
            }
        }

        logger.debug("[extension] No previous session found. Checking for auto-login config.");
        if (getExtensionConfiguration().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
            logger.debug("[extension] Auto-login is enabled. Attempting silent login.");
            performAutomaticLogin(context);
        } else {
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
        }
    } catch (error) {
        logger.warn("[extension] Error trying to get initial TestBench session silently:", error);
        getLoginWebViewProvider()?.updateWebviewHTMLContent();
    }
}

/** Performs a silent, automatic login if configured. */
async function performAutomaticLogin(context: vscode.ExtensionContext): Promise<void> {
    logger.trace(`[extension] Performing automatic login on activation.`);
    try {
        const storedConnections = await connectionManager.getConnections(context);
        if (storedConnections.length === 0) {
            logger.debug("[extension] No stored connections found. Skipping automatic login.");
            return;
        }

        // Check if last used connection exists
        const activeConnection = await connectionManager.getActiveConnection(context);
        if (!activeConnection) {
            logger.debug("[extension] No active connection found. Skipping automatic login.");
            return;
        }

        authProviderInstance?.markNextLoginAsSilent();
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: true
        });

        if (session) {
            await handleTestBenchSessionChange(context, session);
        }
    } catch (error) {
        logger.trace("[extension] Automatic login failed silently:", error);
    }
}

/** Sets up the polling mechanism to sync logout across multiple windows.
 * @param context The extension context.
 * @param instanceId A unique identifier for this extension instance. *
 */
function initializeCrossWindowStateSync(context: vscode.ExtensionContext, instanceId: string): void {
    let lastProcessedLogoutTimestamp = 0;
    const logoutPollInterval = setInterval(async () => {
        const signal = context.globalState.get<{ initiatorId: string; timestamp: number }>(
            StorageKeys.LOGOUT_SIGNAL_KEY
        );

        if (signal && signal.initiatorId !== instanceId && signal.timestamp > lastProcessedLogoutTimestamp) {
            logger.trace(
                `[extension] Detected logout signal from instance (${signal.initiatorId}). Logging out this instance (${instanceId}).`
            );
            lastProcessedLogoutTimestamp = signal.timestamp;

            if (connection) {
                await vscode.commands.executeCommand(allExtensionCommands.logout);
            }
        }
    }, 3000); // Poll every 3 seconds

    context.subscriptions.push({
        dispose: () => clearInterval(logoutPollInterval)
    });
}

/**
 * Called when the extension is activated.
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        const instanceId = uuidv4();
        logger = new testBenchLogger.TestBenchLogger();
        logger.info(`[extension] Activating extension instance ${instanceId}.`);
        initializeConfigurationWatcher();

        // Initialize login webview
        loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider, {
                webviewOptions: { retainContextWhenHidden: true }
            })
        );

        // Authentication and session management
        authProviderInstance = initializeAuthentication(context, instanceId);
        userSessionManager = new UserSessionManager(context);

        await initializeTreeViews(context);
        await initializeContextValues(context);
        await registerExtensionCommands(context);
        configureLanguageServerIntegration(context);
        await activeConfigService.initialize(context);

        // Handle session restoration and automatic login after everything is set up
        await handleInitialSession(context);

        // Start background tasks
        initializeCrossWindowStateSync(context, instanceId);

        logger.info(`[extension] Extension instance ${instanceId} activated successfully.`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        // Ensure logger is initialized, or fall back to console
        const log = logger ? logger.error : console.error;
        log(`[extension] Failed to activate extension. ${errorMessage}`, error);
        vscode.window.showErrorMessage(`TestBench Extension failed to activate: ${errorMessage}`);
    }
}

export async function clearAllExtensionData(
    context: vscode.ExtensionContext,
    showConfirmation: boolean = false
): Promise<boolean> {
    isTestOperationInProgress = false;
    try {
        if (showConfirmation) {
            const confirmation = await vscode.window.showWarningMessage(
                "This will clear ALL TestBench extension data including:\n\n" +
                    "• All saved connections and passwords\n" +
                    "• Current login session\n" +
                    "• Tree view states and custom roots\n" +
                    "• Import tracking data\n" +
                    "• All persistent settings\n\n" +
                    "This action cannot be undone. Are you sure you want to continue?",
                { modal: true },
                "Clear All Data"
            );

            if (confirmation !== "Clear All Data") {
                return false;
            }
        }

        if (connection) {
            try {
                await connection.teardownAfterLogout();
            } catch (error) {
                logger.error("[extension] Error logging out from server while clearing all extension data:", error);
            }
            setConnection(null);
        }

        logger.debug("[extension] Clearing connection passwords from secret storage...");
        try {
            const connections = await connectionManager.getConnections(context);
            for (const conn of connections) {
                try {
                    await context.secrets.delete(StorageKeys.CONNECTION_PASSWORD_SECRET_PREFIX + conn.id);
                    logger.debug(`[extension] Cleared password for connection: ${conn.label}`);
                } catch (error) {
                    logger.error(
                        `[extension] Error clearing password for connection ${conn.label} while clearing all extension data:`,
                        error
                    );
                }
            }
        } catch (error) {
            logger.error("[extension] Error clearing connection passwords while clearing all extension data:", error);
        }

        try {
            logger.debug("[extension] Clearing VS Code authentication sessions...");
            const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, [], {
                createIfNone: false,
                silent: true
            });
            if (session && authProviderInstance) {
                await authProviderInstance.removeSession(session.id);
            }
        } catch (error) {
            logger.error("[extension] Error clearing authentication session while clearing all extension data:", error);
        }

        // State Clearing Logic
        const extensionKeyPatterns = ["testbenchExtension.", "treeState.", "treeView.state."];

        logger.debug("[extension] Clearing workspace state storage for all users...");
        const allWorkspaceKeys = context.workspaceState.keys();
        const extensionWorkspaceKeys = allWorkspaceKeys.filter((key) =>
            extensionKeyPatterns.some((pattern) => key.includes(pattern))
        );

        for (const key of extensionWorkspaceKeys) {
            try {
                await context.workspaceState.update(key, undefined);
                logger.trace(`[extension] Cleared workspace state key: ${key}`);
            } catch (error) {
                logger.error(`[extension] Error clearing workspace state key ${key}:`, error);
            }
        }

        logger.debug("[extension] Clearing global state storage for all users...");
        const allGlobalKeys = context.globalState.keys();
        const extensionGlobalKeys = allGlobalKeys.filter((key) =>
            extensionKeyPatterns.some((pattern) => key.includes(pattern))
        );

        for (const key of extensionGlobalKeys) {
            try {
                await context.globalState.update(key, undefined);
                logger.trace(`[extension] Cleared global state key: ${key}`);
            } catch (error) {
                logger.error(`[extension] Error clearing global state key ${key}:`, error);
            }
        }

        if (treeViews) {
            logger.debug("[extension] Clearing tree data and state...");
            try {
                treeViews.clear();

                if (treeViews.projectsTree) {
                    await treeViews.projectsTree.clearAllModuleState();
                }
                if (treeViews.testThemesTree) {
                    await treeViews.testThemesTree.clearAllModuleState();
                }
                if (treeViews.testElementsTree) {
                    await treeViews.testElementsTree.clearAllModuleState();
                }

                if (treeViews.projectsTree) {
                    treeViews.projectsTree.refresh();
                }
                if (treeViews.testThemesTree) {
                    treeViews.testThemesTree.refresh();
                }
                if (treeViews.testElementsTree) {
                    treeViews.testElementsTree.refresh();
                }
            } catch (error) {
                logger.error("[extension] Error clearing tree data while clearing all extension data:", error);
            }
        }

        const contextUpdates = [
            ["setContext", ContextKeys.CONNECTION_ACTIVE, false],
            ["setContext", ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false],
            ["setContext", ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false],
            ["setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, false]
        ];

        for (const [command, key, value] of contextUpdates) {
            try {
                await vscode.commands.executeCommand(command as string, key, value);
            } catch (error) {
                logger.error(`[extension] Error updating context ${key}:`, error);
            }
        }

        try {
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
        } catch (error) {
            logger.error("[extension] Error updating login webview while clearing all extension data:", error);
        }

        if (client) {
            logger.debug("[extension] Stopping language client...");
            try {
                await stopLanguageClient(true);
            } catch (error) {
                logger.error("[extension] Error stopping language client while clearing all extension data:", error);
            }
        }

        logger.debug("[extension] Clearing internal testbench folder...");
        try {
            const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
            if (workspaceLocation) {
                const testbenchWorkingDirectoryPath: string = path.join(
                    workspaceLocation,
                    folderNameOfInternalTestbenchFolder
                );
                await utils.clearInternalTestbenchFolder(
                    testbenchWorkingDirectoryPath,
                    [testBenchLogger.folderNameOfLogs],
                    false
                );
            }
        } catch (error) {
            logger.error(
                "[extension] Error clearing internal testbench folder while clearing all extension data:",
                error
            );
        }

        try {
            await treeViews?.testThemesTree.clearAllContextSpecificFilters();
        } catch (error) {
            logger.error("[extension] Error clearing saved test theme filters during clear all:", error);
        }

        try {
            await displayProjectManagementTreeView();
            await hideTestThemeTreeView();
            await hideTestElementsTreeView();
        } catch (error) {
            logger.error("[extension] Error managing view visibility while clearing all extension data:", error);
        }

        logger.info("[extension] All extension data cleared successfully.");

        if (showConfirmation) {
            vscode.window.showInformationMessage(
                "All TestBench extension data has been cleared successfully. You will need to log in again to use the extension."
            );
        }

        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(`[extension] Error during clear all extension data operation: ${errorMessage}`, error);

        if (showConfirmation) {
            vscode.window.showErrorMessage(`Error clearing extension data: ${errorMessage}`);
        }

        return false;
    }
}

/**
 * Called when the extension is deactivated.
 */
export async function deactivate(): Promise<void> {
    logger.trace("[extension] Deactivating extension.");
    try {
        isTestOperationInProgress = false;

        // if (connection) {
        //     await connection.logoutUserOnServer();
        // }
        if (client) {
            await stopLanguageClient(true);
        }
        if (treeViews) {
            await treeViews.projectsTree.dispose();
            await treeViews.testThemesTree.dispose();
            await treeViews.testElementsTree.dispose();
            treeViews = null;
        }
        activeConfigService.dispose();
        logger.info("[extension] Extension deactivated");
        if (logger) {
            logger.dispose();
        }
    } catch (error) {
        logger.error("[extension] Error during deactivation:", error);
        if (logger) {
            logger.dispose();
        }
    }
}
