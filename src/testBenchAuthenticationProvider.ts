import * as vscode from "vscode";
import * as connectionManager from "./connectionManager";
import { loginToServerAndGetSessionDetails, TestBenchLoginResult, PlayServerConnection } from "./testBenchConnection";
import { TestBenchConnection } from "./testBenchTypes";
import { logger } from "./extension";
import { SharedSessionManager } from "./sharedSessionManager";
import { StorageKeys } from "./constants";

export const TESTBENCH_AUTH_PROVIDER_ID = "testbench-auth";
export const TESTBENCH_AUTH_PROVIDER_LABEL = "TestBench"; // User-facing name in VS Code Accounts UI

interface TestBenchSessionData {
    sessionId: string; // VS Code session ID
    connectionId: string;
    testBenchSessionToken: string;
    accountLabel: string;
    userKey: string; // TestBench user key
}

class UserCancelledError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UserCancelledError";
    }
}

export class TestBenchAuthenticationProvider implements vscode.AuthenticationProvider {
    public static readonly id = TESTBENCH_AUTH_PROVIDER_ID;
    public static readonly label = TESTBENCH_AUTH_PROVIDER_LABEL;

    // Store active sessions to avoid constant secret reads for getSessions
    // Key: VS Code session ID, Value: TestBenchSessionData
    private activeSessions: Map<string, TestBenchSessionData> = new Map();

    private _onDidChangeSessions =
        new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    readonly onDidChangeSessions: vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent> =
        this._onDidChangeSessions.event;

    private _isAttemptingSilentAutoLogin: boolean = false;

    constructor(
        private context: vscode.ExtensionContext,
        private instanceId: string
    ) {
        logger.trace("[AuthenticationProvider] TestBenchAuthenticationProvider initialized.");
        this.loadExistingSharedSessions();
    }

    /**
     * Loads existing shared sessions on initialization
     */
    private async loadExistingSharedSessions(): Promise<void> {
        try {
            const sharedSessionManager = SharedSessionManager.getInstance(this.context);
            const sharedSession = await sharedSessionManager.getSharedSession();

            if (sharedSession) {
                // Add shared session to active sessions
                const sessionData: TestBenchSessionData = {
                    sessionId: sharedSession.sessionId || `shared_${sharedSession.connectionId}_${Date.now()}`,
                    connectionId: sharedSession.connectionId,
                    testBenchSessionToken: sharedSession.sessionToken,
                    accountLabel: `${sharedSession.username}@${sharedSession.serverName}`,
                    userKey: sharedSession.userKey
                };

                this.activeSessions.set(sessionData.sessionId, sessionData);
                logger.debug(
                    "[AuthenticationProvider] Loaded existing shared session for: " + sessionData.accountLabel
                );
            }
        } catch (error) {
            logger.error("[AuthenticationProvider] Error loading shared sessions:", error);
        }
    }

    /**
     * Prepares the provider for an upcoming silent auto-login attempt.
     * This should be called immediately before `vscode.authentication.getSession`
     * is invoked for an auto-login scenario.
     */
    public markNextLoginAsSilent(): void {
        logger.trace("[AuthenticationProvider] Preparing for silent auto-login attempt.");
        this._isAttemptingSilentAutoLogin = true;
    }

    /**
     * Get a list of sessions.
     * @returns A promise that resolves to an array of authentication sessions.
     */
    async getSessions(): Promise<vscode.AuthenticationSession[]> {
        const sessionsToReturn: vscode.AuthenticationSession[] = [];
        for (const sessionData of this.activeSessions.values()) {
            sessionsToReturn.push({
                id: sessionData.sessionId,
                accessToken: sessionData.testBenchSessionToken,
                account: { label: sessionData.accountLabel, id: sessionData.userKey },
                scopes: ["api_access"]
            });
        }
        logger.trace(`[AuthenticationProvider] Returning ${sessionsToReturn.length} session(s).`);
        return sessionsToReturn;
    }

    /**
     * Creates a new TestBench authentication session.
     *
     * This method handles both interactive and silent (automatic) login attempts.
     * It can utilize an active connection, prompt the user to select or create a new connection,
     * and manages password retrieval and storage.
     *
     * @param {string[]} scopes - An array of scopes requested for the session.
     * @returns {Promise<vscode.AuthenticationSession>} A promise that resolves to a `vscode.AuthenticationSession` object upon successful login.
     * @throws Error if the login process is cancelled, fails due to incorrect credentials,
     * missing connection information, or other issues during session creation.
     */
    async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
        const isSilentLogin = this.consumeSilentAutoLoginFlag();

        try {
            const { connection, initialPassword } = await this.selectConnectionInQuickPick(isSilentLogin);
            const passwordResult = await this.resolvePasswordForConnection(connection, initialPassword, isSilentLogin);
            this.validateConnectionDetailsForLogin(connection, passwordResult.password);
            const { loginResult, usingSharedSession } = await this.performLogin(connection, passwordResult.password);
            await this.offerToStorePassword(connection, passwordResult, passwordResult.password);
            return await this.storeSession(connection, loginResult, scopes, usingSharedSession);
        } catch (error: any) {
            if (error instanceof UserCancelledError) {
                logger.debug(`[AuthenticationProvider] ${error.message}`);
            } else {
                logger.error(`[AuthenticationProvider] Error during session creation: ${error.message || error}`);
                if (!isSilentLogin) {
                    await connectionManager.clearActiveConnection(this.context);
                }
            }
            throw error;
        }
    }

    /*
     * Consumes the silent auto-login flag by resetting it for future attempts.
     * @return true if the current attempt is a silent auto-login, false otherwise.
     */
    private consumeSilentAutoLoginFlag(): boolean {
        const isSilentAttempt = this._isAttemptingSilentAutoLogin;
        if (this._isAttemptingSilentAutoLogin) {
            this._isAttemptingSilentAutoLogin = false;
            logger.debug("[AuthenticationProvider] Silent auto-login attempt detected while creating session.");
        }
        return isSilentAttempt;
    }

    /**
     * Selects a TestBench connection for the session.
     * @param isSilent - Whether the selection is for a silent auto-login.
     * @returns A promise that resolves to an object containing the selected connection and an optional initial password.
     */
    private async selectConnectionInQuickPick(isSilent: boolean): Promise<{
        connection: TestBenchConnection;
        initialPassword?: string;
    }> {
        const activeConnectionId = await connectionManager.getActiveConnectionId(this.context);
        if (activeConnectionId) {
            const connections = await connectionManager.getConnections(this.context);
            const activeConnection = connections.find((item) => item.id === activeConnectionId);
            if (activeConnection) {
                return { connection: activeConnection };
            }

            logger.warn(
                `[AuthenticationProvider] Active connection ID ${activeConnectionId} was set, but connection not found.`
            );
            await connectionManager.clearActiveConnection(this.context);
            if (isSilent) {
                throw new Error("Active connection for auto-login not found.");
            }
        }

        if (isSilent) {
            throw new Error("No active connection available for silent auto-login.");
        }

        const connections = await connectionManager.getConnections(this.context);
        const quickPickItems: (vscode.QuickPickItem & {
            connection?: TestBenchConnection;
            isAddNew?: boolean;
        })[] = [
            ...connections.map((item) => ({
                label: item.label,
                description: `${item.username}@${item.serverName}:${item.portNumber}`,
                connection: item
            })),
            {
                label: "$(add) Add New TestBench Connection...",
                isAddNew: true,
                description: "Configure a new connection connection"
            }
        ];

        const selection = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: "Select a TestBench Connection or Add New",
            ignoreFocusOut: true
        });

        if (!selection) {
            throw new UserCancelledError("TestBench login cancelled by user.");
        }

        if (!selection.isAddNew && selection.connection) {
            return { connection: selection.connection };
        }

        const newConnectionDetails = await this.promptForNewConnectionDetails();
        if (!newConnectionDetails) {
            throw new UserCancelledError("Connection creation cancelled by user.");
        }

        if (newConnectionDetails.label && newConnectionDetails.label.trim()) {
            const existingConnectionByLabel = await connectionManager.findConnectionByLabel(
                this.context,
                newConnectionDetails.label.trim()
            );

            if (existingConnectionByLabel) {
                throw new Error(
                    `A connection with the label "${newConnectionDetails.label}" already exists. Connection labels must be unique.`
                );
            }
        }

        const tempConnectionId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const connection: TestBenchConnection = {
            id: tempConnectionId,
            label: newConnectionDetails.label || `${newConnectionDetails.username}@${newConnectionDetails.serverName}`,
            serverName: newConnectionDetails.serverName,
            portNumber: newConnectionDetails.portNumber,
            username: newConnectionDetails.username
        };

        let initialPassword = newConnectionDetails.password;
        const saveNewConnectionChoice = await vscode.window.showQuickPick(["Yes", "No"], {
            placeHolder: `Save new connection "${connection.label}"?`,
            ignoreFocusOut: true
        });

        if (saveNewConnectionChoice === "Yes") {
            try {
                const savedId = await connectionManager.saveConnection(this.context, {
                    ...connection,
                    password: initialPassword
                });
                connection.id = savedId;
                initialPassword = undefined;
            } catch (saveError: any) {
                logger.error(`[AuthenticationProvider] Failed to save new connection: ${saveError.message}`);
                throw new Error(`Failed to save connection: ${saveError.message}`);
            }
        } else if (!initialPassword) {
            throw new Error("Password required for unsaved connection.");
        }

        return { connection, initialPassword };
    }

    /**
     * Resolves the password for a given connection, either from the initial input or by prompting the user.
     * @param connection - The TestBench connection for which to resolve the password.
     * @param initialPassword - An optional initial password provided by the user.
     * @param isSilent - Whether the resolution is for a silent auto-login.
     * @returns A promise that resolves to an object containing the resolved password and metadata about its origin.
     */
    private async resolvePasswordForConnection(
        connection: TestBenchConnection,
        initialPassword: string | undefined,
        isSilent: boolean
    ): Promise<{ password: string; wasManuallyProvided: boolean; hadStoredPassword: boolean }> {
        if (initialPassword !== undefined) {
            if (initialPassword === "") {
                throw new Error("Cannot attempt login with an empty password.");
            }
            return {
                password: initialPassword,
                wasManuallyProvided: true,
                hadStoredPassword: false
            };
        }

        const storedPassword = await connectionManager.getPasswordForConnection(this.context, connection.id);
        if (storedPassword === undefined) {
            const password = await this.promptForPassword(
                `Enter password for ${connection.label}${isSilent ? " (auto-login attempt)" : ""}`,
                isSilent
            );
            return { password, wasManuallyProvided: true, hadStoredPassword: false };
        }

        if (storedPassword === "") {
            if (isSilent) {
                throw new Error(
                    `Empty password stored for connection "${connection.label}". Auto-login failed. Please update connection interactively.`
                );
            }
            const password = await this.promptForPassword(
                `Enter password for ${connection.label} (stored password was empty)`,
                isSilent
            );
            return { password, wasManuallyProvided: true, hadStoredPassword: false };
        }

        return {
            password: storedPassword,
            wasManuallyProvided: false,
            hadStoredPassword: true
        };
    }

    private async promptForPassword(prompt: string, isSilent: boolean): Promise<string> {
        const manuallyEnteredPassword = await vscode.window.showInputBox({
            prompt,
            password: true,
            ignoreFocusOut: true
        });

        if (manuallyEnteredPassword === undefined) {
            throw new UserCancelledError(`Password entry cancelled${isSilent ? " for auto-login" : ""}.`);
        }

        if (manuallyEnteredPassword === "") {
            throw new Error("Password cannot be empty. Please enter a valid password or cancel.");
        }

        return manuallyEnteredPassword;
    }

    private async performLogin(
        connection: TestBenchConnection,
        password: string
    ): Promise<{ loginResult: TestBenchLoginResult; usingSharedSession: boolean }> {
        const sharedSessionManager = SharedSessionManager.getInstance(this.context);
        const existingSharedSession = await sharedSessionManager.getSharedSession();

        if (
            existingSharedSession &&
            existingSharedSession.connectionId === connection.id &&
            existingSharedSession.serverName === connection.serverName &&
            existingSharedSession.portNumber === connection.portNumber &&
            existingSharedSession.username === connection.username
        ) {
            logger.debug("[AuthenticationProvider] Found existing shared session, attempting to validate...");

            const tempConnection = new PlayServerConnection(
                connection.serverName,
                connection.portNumber,
                connection.username,
                existingSharedSession.sessionToken,
                this.context,
                existingSharedSession.isInsecure
            );
            await tempConnection.initialize();

            const isValid = await sharedSessionManager.validateSession(tempConnection);
            if (isValid) {
                logger.info("[AuthenticationProvider] Using existing shared session instead of creating new login");
                return {
                    loginResult: {
                        sessionToken: existingSharedSession.sessionToken,
                        userKey: existingSharedSession.userKey,
                        loginName: existingSharedSession.loginName,
                        isInsecure: existingSharedSession.isInsecure
                    },
                    usingSharedSession: true
                };
            }

            logger.debug("[AuthenticationProvider] Shared session is no longer valid, proceeding with new login");
            await sharedSessionManager.clearSharedSession();
        }

        const loginResult = await loginToServerAndGetSessionDetails(
            connection.serverName,
            connection.portNumber,
            connection.username,
            password
        );

        if (!loginResult || !loginResult.sessionToken || !loginResult.userKey) {
            await connectionManager.clearActiveConnection(this.context);
            throw new Error("Login to TestBench failed.");
        }

        return { loginResult, usingSharedSession: false };
    }

    private async offerToStorePassword(
        connection: TestBenchConnection,
        passwordResult: { wasManuallyProvided: boolean; hadStoredPassword: boolean },
        password: string
    ): Promise<void> {
        if (!passwordResult.wasManuallyProvided || passwordResult.hadStoredPassword || !password || !connection.id) {
            return;
        }

        const storePasswordAfterLoginChoice = await vscode.window.showQuickPick(["Yes", "No"], {
            placeHolder: `Save password for connection "${connection.label}"?`,
            ignoreFocusOut: true
        });

        if (storePasswordAfterLoginChoice === "Yes") {
            await connectionManager.saveConnection(this.context, {
                ...connection,
                password
            });
        }
    }

    private async storeSession(
        connection: TestBenchConnection,
        loginResult: TestBenchLoginResult,
        scopes: readonly string[],
        usingSharedSession: boolean
    ): Promise<vscode.AuthenticationSession> {
        const sessionId = connection.id;
        const sessionData: TestBenchSessionData = {
            sessionId,
            connectionId: connection.id,
            testBenchSessionToken: loginResult.sessionToken,
            accountLabel: `${connection.username}@${connection.serverName}`,
            userKey: loginResult.userKey
        };

        this.activeSessions.set(sessionId, sessionData);
        await connectionManager.setActiveConnectionId(this.context, connection.id);

        const authSession: vscode.AuthenticationSession = {
            id: sessionId,
            accessToken: sessionData.testBenchSessionToken,
            account: { label: sessionData.accountLabel, id: sessionData.userKey },
            scopes
        };

        this._onDidChangeSessions.fire({
            added: [authSession],
            removed: [],
            changed: []
        });

        if (!usingSharedSession) {
            const sharedSessionManager = SharedSessionManager.getInstance(this.context);
            await sharedSessionManager.storeSharedSession(
                sessionId,
                loginResult.sessionToken,
                loginResult.userKey,
                loginResult.loginName,
                connection.id,
                connection.serverName,
                connection.portNumber,
                connection.username,
                loginResult.isInsecure
            );
            logger.debug(
                "[AuthenticationProvider] Stored new session in shared session manager for cross-window access"
            );
        }

        logger.debug(
            `[AuthenticationProvider] TestBench session created successfully for '${sessionData.accountLabel}'.`
        );

        return authSession;
    }

    /**
     * Removes a session with the specified session ID.
     *
     * This method deletes the session from the active sessions map and triggers
     * an event to notify listeners about the removed session. If the session ID
     * does not exist in the active sessions, a warning is logged.
     *
     * @param sessionId - The unique identifier of the session to be removed.
     * @returns A promise that resolves when the session has been removed.
     */
    async removeSession(sessionId: string): Promise<void> {
        const sessionData: TestBenchSessionData | undefined = this.activeSessions.get(sessionId);
        if (sessionData) {
            logger.debug(
                `[AuthenticationProvider] Instance ${this.instanceId} is initiating a logout and setting the signal.`
            );
            await this.context.globalState.update(StorageKeys.LOGOUT_SIGNAL_KEY, {
                initiatorId: this.instanceId,
                timestamp: Date.now()
            });

            logger.trace(
                `[AuthenticationProvider] Removing session locally: ${sessionData.accountLabel} (ID: ${sessionId})`
            );

            const removedSession: vscode.AuthenticationSession = {
                id: sessionData.sessionId,
                accessToken: sessionData.testBenchSessionToken,
                account: { label: sessionData.accountLabel, id: sessionData.userKey },
                scopes: ["api_access"]
            };

            this.activeSessions.delete(sessionId);

            this._onDidChangeSessions.fire({
                added: [],
                removed: [removedSession],
                changed: []
            });

            const sharedSessionManager = SharedSessionManager.getInstance(this.context);
            await sharedSessionManager.clearSharedSession();
            logger.debug("[AuthenticationProvider] Cleared shared session data on logout");
        } else {
            logger.warn(`[AuthenticationProvider] Session removal requested for unknown session ID: ${sessionId}`);
        }
    }

    /**
     * Prompts the user to enter details for a new TestBench connection.
     * This includes server name, port number, username, password, and an optional label.
     * If the user cancels any of the required inputs (server name, port, username),
     * the function returns `undefined`. Otherwise, it returns an object containing
     * the entered details. The password can be an empty string. If no label is provided,
     * a default label in the format `username@serverName` is used.
     * @returns A promise that resolves to an object with the connection details,
     * or `undefined` if the user cancels the input process for required fields.
     */
    private async promptForNewConnectionDetails(): Promise<
        (Omit<TestBenchConnection, "id" | "label"> & { label?: string; password?: string }) | undefined
    > {
        const serverName: string | undefined = await vscode.window.showInputBox({
            prompt: "Enter TestBench Server Name (e.g., testbench.example.com)",
            ignoreFocusOut: true
        });
        if (!serverName) {
            return undefined;
        }
        const portStr: string | undefined = await vscode.window.showInputBox({
            prompt: "Enter Port Number (e.g., 9443)",
            ignoreFocusOut: true,
            validateInput: (val) => (/^\d+$/.test(val) ? null : "Must be a number")
        });
        if (!portStr) {
            return undefined;
        }
        const portNumber: number = parseInt(portStr, 10);
        const username: string | undefined = await vscode.window.showInputBox({
            prompt: "Enter TestBench Username",
            ignoreFocusOut: true
        });
        if (!username) {
            return undefined;
        }

        const passwordInput: string | undefined = await vscode.window.showInputBox({
            prompt: "Enter TestBench Password (optional, can be left empty if you don't want to store it)",
            password: true,
            ignoreFocusOut: true
        });

        const label: string | undefined = await vscode.window.showInputBox({
            prompt: "Enter a label for this connection (optional)",
            placeHolder: `${username}@${serverName}`,
            ignoreFocusOut: true
        });

        return {
            serverName,
            portNumber,
            username,
            password: passwordInput, // Treat undefined password as empty
            label: label || `${username}@${serverName}`
        };
    }

    /**
     * Validates connection details before attempting login.
     * @param connection The connection to validate
     * @param password The password to validate
     * @throws Error if validation fails
     */
    private validateConnectionDetailsForLogin(connection: TestBenchConnection, password: string | undefined): void {
        if (!connection) {
            throw new Error("Connection details are required for login.");
        }

        if (!connection.serverName || connection.serverName.trim() === "") {
            throw new Error("Server name is required for login.");
        }

        if (!connection.portNumber || connection.portNumber <= 0 || connection.portNumber > 65535) {
            throw new Error("Valid port number (1-65535) is required for login.");
        }

        if (!connection.username || connection.username.trim() === "") {
            throw new Error("Username is required for login.");
        }

        if (!password || password === "") {
            throw new Error("Password is required for login.");
        }
    }
}

/**
 * Gets the session to process, either from the parameter or by fetching it.
 * @param existingSession - An optional existing authentication session to process.
 * @returns The session to process or undefined if no session is found.
 */
export async function getSessionToProcess(
    existingSession?: vscode.AuthenticationSession
): Promise<vscode.AuthenticationSession | undefined> {
    if (existingSession) {
        return existingSession;
    }

    try {
        return await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: false,
            silent: true
        });
    } catch (error) {
        logger.warn("[AuthenticationProvider] Error getting current session:", error);
        return undefined;
    }
}
