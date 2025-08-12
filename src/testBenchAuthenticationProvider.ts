import * as vscode from "vscode";
import * as connectionManager from "./connectionManager";
import { loginToServerAndGetSessionDetails, TestBenchLoginResult } from "./testBenchConnection";
import { TestBenchConnection } from "./testBenchTypes";
import { logger } from "./extension";

export const TESTBENCH_AUTH_PROVIDER_ID = "testbench-auth";
export const TESTBENCH_AUTH_PROVIDER_LABEL = "TestBench"; // User-facing name in VS Code Accounts UI

interface TestBenchSessionData {
    sessionId: string; // VS Code session ID
    connectionId: string;
    testBenchSessionToken: string;
    accountLabel: string;
    userKey: string; // TestBench user key
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

    constructor(private context: vscode.ExtensionContext) {
        logger.trace("[AuthenticationProvider] TestBenchAuthenticationProvider initialized.");
    }

    /**
     * Prepares the provider for an upcoming silent auto-login attempt.
     * This should be called immediately before `vscode.authentication.getSession`
     * is invoked for an auto-login scenario.
     */
    public prepareForSilentAutoLogin(): void {
        logger.trace("[AuthenticationProvider] Preparing for silent auto-login attempt.");
        this._isAttemptingSilentAutoLogin = true;
    }

    /**
     * Get a list of sessions.
     * @param {string[]} scopes An optional list of scopes. If provided, the sessions returned should match these permissions.
     * @returns A promise that resolves to an array of authentication sessions.
     */
    async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
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
     * @param {vscode.AuthenticationProviderSessionOptions} options - Optional parameters for session creation, which can indicate if the call is for silent authentication.
     * @returns {Promise<vscode.AuthenticationSession>} A promise that resolves to a `vscode.AuthenticationSession` object upon successful login.
     * @throws Error if the login process is cancelled, fails due to incorrect credentials,
     * missing connection information, or other issues during session creation.
     */
    async createSession(
        scopes: readonly string[],
        options?: vscode.AuthenticationProviderSessionOptions
    ): Promise<vscode.AuthenticationSession> {
        const isSilent: boolean = this._isAttemptingSilentAutoLogin;
        if (this._isAttemptingSilentAutoLogin) {
            this._isAttemptingSilentAutoLogin = false;
            logger.debug("[AuthenticationProvider] Silent auto-login attempt detected while creating session.");
        }

        try {
            let targetConnection: TestBenchConnection | undefined;
            let passwordToUse: string | undefined;

            const activeConnectionIdFromManager: string | undefined = await connectionManager.getActiveConnectionId(
                this.context
            );

            if (activeConnectionIdFromManager) {
                const allConnections: connectionManager.TestBenchConnection[] = await connectionManager.getConnections(
                    this.context
                );
                targetConnection = allConnections.find((p) => p.id === activeConnectionIdFromManager);
                if (!targetConnection) {
                    logger.warn(
                        `[AuthenticationProvider] Active connection ID ${activeConnectionIdFromManager} was set, but connection not found.`
                    );
                    await connectionManager.clearActiveConnection(this.context);
                    if (isSilent) {
                        throw new Error("Active connection for auto-login not found.");
                    }
                }
            }

            if (!targetConnection) {
                if (isSilent) {
                    throw new Error("No active connection available for silent auto-login.");
                }
                const connections = await connectionManager.getConnections(this.context);
                const quickPickItems: (vscode.QuickPickItem & {
                    connection?: TestBenchConnection;
                    isAddNew?: boolean;
                })[] = [
                    ...connections.map((p) => ({
                        label: p.label,
                        description: `${p.username}@${p.serverName}:${p.portNumber}`,
                        connection: p
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
                    throw new Error("TestBench login cancelled by user (QuickPick).");
                }

                if (selection.isAddNew || !selection.connection) {
                    const newConnectionDetails = await this.promptForNewConnectionDetails();
                    if (!newConnectionDetails) {
                        throw new Error("Connection creation cancelled.");
                    }

                    // Check for duplicate label if provided
                    if (newConnectionDetails.label && newConnectionDetails.label.trim()) {
                        const existingConnectionByLabel: connectionManager.TestBenchConnection | undefined =
                            await connectionManager.findConnectionByLabel(
                                this.context,
                                newConnectionDetails.label.trim()
                            );

                        if (existingConnectionByLabel) {
                            throw new Error(
                                `A connection with the label "${newConnectionDetails.label}" already exists. Connection labels must be unique.`
                            );
                        }
                    }

                    // Create temp connection object with a temporary ID for unsaved connections
                    const tempConnectionId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
                    targetConnection = {
                        id: tempConnectionId,
                        label:
                            newConnectionDetails.label ||
                            `${newConnectionDetails.username}@${newConnectionDetails.serverName}`,
                        serverName: newConnectionDetails.serverName,
                        portNumber: newConnectionDetails.portNumber,
                        username: newConnectionDetails.username
                    };
                    passwordToUse = newConnectionDetails.password;

                    const saveNewConnectionChoice: string | undefined = await vscode.window.showQuickPick(
                        ["Yes", "No"],
                        {
                            placeHolder: `Save new connection "${targetConnection.label}"?`,
                            ignoreFocusOut: true
                        }
                    );

                    if (saveNewConnectionChoice === "Yes") {
                        try {
                            const savedId: string = await connectionManager.saveConnection(
                                this.context,
                                targetConnection,
                                passwordToUse
                            );
                            targetConnection.id = savedId;
                            await connectionManager.setActiveConnectionId(this.context, targetConnection.id);
                        } catch (saveError: any) {
                            logger.error(
                                `[AuthenticationProvider] Failed to save new connection: ${saveError.message}`
                            );
                            throw new Error(`Failed to save connection: ${saveError.message}`);
                        }
                    } else if (!passwordToUse) {
                        throw new Error("Password required for unsaved connection.");
                    }
                } else {
                    targetConnection = selection.connection;
                }
            }

            if (passwordToUse === undefined && targetConnection) {
                passwordToUse = await connectionManager.getPasswordForConnection(this.context, targetConnection.id);

                if (passwordToUse === undefined) {
                    const manuallyEnteredPassword: string | undefined = await vscode.window.showInputBox({
                        prompt: `Enter password for ${targetConnection.label}${isSilent ? " (auto-login attempt)" : ""}`,
                        password: true,
                        ignoreFocusOut: true
                    });

                    if (manuallyEnteredPassword === undefined) {
                        throw new Error(`Password entry cancelled${isSilent ? " for auto-login" : ""}.`);
                    }
                    if (manuallyEnteredPassword === "") {
                        // User entered an empty password
                        throw new Error(
                            `Password cannot be empty. Please enter a valid password or cancel${isSilent ? " (auto-login attempt)" : ""}.`
                        );
                    }
                    passwordToUse = manuallyEnteredPassword;
                } else if (passwordToUse === "") {
                    if (isSilent) {
                        throw new Error(
                            `Empty password stored for connection "${targetConnection.label}". Auto-login failed. Please update connection interactively.`
                        );
                    }
                    const manuallyEnteredPassword: string | undefined = await vscode.window.showInputBox({
                        prompt: `Enter password for ${targetConnection.label} (stored password was empty)`,
                        password: true,
                        ignoreFocusOut: true
                    });
                    if (manuallyEnteredPassword === undefined) {
                        throw new Error("Password entry cancelled.");
                    }
                    if (manuallyEnteredPassword === "") {
                        throw new Error("Password cannot be empty. Please enter a valid password or cancel.");
                    }
                    passwordToUse = manuallyEnteredPassword;
                }
            }
            if (!targetConnection || passwordToUse === undefined) {
                throw new Error("Connection details or password not available for login.");
            }
            if (passwordToUse === "") {
                throw new Error("Cannot attempt login with an empty password.");
            }

            try {
                this.validateConnectionForLogin(targetConnection, passwordToUse);
            } catch (validationError: any) {
                logger.error(`[AuthenticationProvider] Connection validation failed: ${validationError.message}`);
                throw validationError;
            }

            const loginResult: TestBenchLoginResult | null = await loginToServerAndGetSessionDetails(
                targetConnection.serverName,
                targetConnection.portNumber,
                targetConnection.username,
                passwordToUse
            );

            if (!loginResult || !loginResult.sessionToken || !loginResult.userKey) {
                await connectionManager.clearActiveConnection(this.context);
                throw new Error("Login to TestBench failed.");
            }
            const initialPasswordFromStorage: string | undefined = await connectionManager.getPasswordForConnection(
                this.context,
                targetConnection.id
            );
            const wasPasswordManuallyEnteredOrCorrected =
                (initialPasswordFromStorage === undefined || initialPasswordFromStorage === "") &&
                passwordToUse &&
                passwordToUse.length > 0;

            if (wasPasswordManuallyEnteredOrCorrected && targetConnection.id) {
                const storePasswordAfterLoginChoice = await vscode.window.showQuickPick(["Yes", "No"], {
                    placeHolder: `Save password for connection "${targetConnection.label}"?`,
                    ignoreFocusOut: true
                });
                if (storePasswordAfterLoginChoice === "Yes") {
                    await connectionManager.saveConnection(this.context, targetConnection, passwordToUse);
                }
            }

            const vsCodeSessionId: string = Date.now().toString() + Math.random().toString();
            const sessionData: TestBenchSessionData = {
                sessionId: vsCodeSessionId,
                connectionId: targetConnection.id,
                testBenchSessionToken: loginResult.sessionToken,
                accountLabel: `${targetConnection.username}@${targetConnection.serverName}`,
                userKey: loginResult.userKey
            };
            this.activeSessions.set(vsCodeSessionId, sessionData);
            await connectionManager.setActiveConnectionId(this.context, targetConnection.id);

            this._onDidChangeSessions.fire({
                added: [
                    {
                        id: vsCodeSessionId,
                        accessToken: sessionData.testBenchSessionToken,
                        account: { label: sessionData.accountLabel, id: sessionData.userKey },
                        scopes
                    }
                ],
                removed: [],
                changed: []
            });
            logger.debug(
                `[AuthenticationProvider] TestBench session created successfully for ${sessionData.accountLabel}`
            );
            return {
                id: vsCodeSessionId,
                accessToken: sessionData.testBenchSessionToken,
                account: { label: sessionData.accountLabel, id: sessionData.userKey },
                scopes
            };
        } catch (error: any) {
            logger.error(`[AuthenticationProvider] Error during createSession`);
            if (!isSilent) {
                await connectionManager.clearActiveConnection(this.context);
            }
            throw error;
        }
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
                `[AuthenticationProvider] Removing session locally: ${sessionData.accountLabel} (ID: ${sessionId})`
            );
            this.activeSessions.delete(sessionId);

            this._onDidChangeSessions.fire({
                added: [],
                removed: [{ id: sessionId, accessToken: "", account: { label: "", id: "" }, scopes: [] }],
                changed: []
            });
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
            prompt: "Enter Port Number (e.g., 9445)",
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
    private validateConnectionForLogin(connection: TestBenchConnection, password: string | undefined): void {
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
