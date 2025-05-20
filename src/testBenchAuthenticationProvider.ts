import * as vscode from "vscode";
import * as profileManager from "./profileManager";
import { loginToServerAndGetSessionDetails, TestBenchLoginResult } from "./testBenchConnection";
import { TestBenchProfile } from "./testBenchTypes";
import { logger } from "./extension";

export const TESTBENCH_AUTH_PROVIDER_ID = "testbench-auth";
export const TESTBENCH_AUTH_PROVIDER_LABEL = "TestBench"; // User-facing name in VS Code Accounts UI

interface TestBenchSessionData {
    sessionId: string; // VS Code session ID
    profileId: string;
    testBenchSessionToken: string;
    accountLabel: string;
    userKey: string; // TestBench user key
}

export class TestBenchAuthenticationProvider implements vscode.AuthenticationProvider {
    public static readonly id = TESTBENCH_AUTH_PROVIDER_ID;
    public static readonly label = TESTBENCH_AUTH_PROVIDER_LABEL;

    // In-memory store for active sessions to avoid constant secret reads for getSessions
    // Key: VS Code session ID, Value: TestBenchSessionData
    private activeSessions: Map<string, TestBenchSessionData> = new Map();

    private _onDidChangeSessions =
        new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    readonly onDidChangeSessions: vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent> =
        this._onDidChangeSessions.event;

    private _isAttemptingSilentAutoLogin: boolean = false;

    constructor(private context: vscode.ExtensionContext) {
        logger.trace("[AuthProvider] TestBenchAuthenticationProvider initialized.");
    }

    /**
     * Prepares the provider for an upcoming silent auto-login attempt.
     * This should be called immediately before `vscode.authentication.getSession`
     * is invoked for an auto-login scenario.
     */
    public prepareForSilentAutoLogin(): void {
        logger.trace("[AuthProvider] Preparing for silent auto-login attempt.");
        this._isAttemptingSilentAutoLogin = true;
    }

    /**
     * Get a list of sessions.
     * @param {string[]} scopes An optional list of scopes. If provided, the sessions returned should match these permissions.
     * @returns A promise that resolves to an array of authentication sessions.
     */
    async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
        logger.trace(`[AuthProvider] getSessions called. Scopes: ${scopes}`);
        const sessionsToReturn: vscode.AuthenticationSession[] = [];
        for (const sessionData of this.activeSessions.values()) {
            sessionsToReturn.push({
                id: sessionData.sessionId,
                accessToken: sessionData.testBenchSessionToken,
                account: { label: sessionData.accountLabel, id: sessionData.userKey },
                scopes: ["api_access"]
            });
        }
        logger.trace(`[AuthProvider] getSessions returning ${sessionsToReturn.length} session(s).`);
        return sessionsToReturn;
    }

    /**
     * Creates a new TestBench authentication session.
     *
     * This method handles both interactive and silent (automatic) login attempts.
     * It can utilize an active profile, prompt the user to select or create a new profile,
     * and manages password retrieval and storage.
     *
     * @param {string[]} scopes - An array of scopes requested for the session.
     * @param {vscode.AuthenticationProviderSessionOptions} options - Optional parameters for session creation, which can indicate if the call is for silent authentication.
     * @returns {Promise<vscode.AuthenticationSession>} A promise that resolves to a `vscode.AuthenticationSession` object upon successful login.
     * @throws Error if the login process is cancelled, fails due to incorrect credentials,
     * missing profile information, or other issues during session creation.
     */
    async createSession(
        scopes: readonly string[],
        options?: vscode.AuthenticationProviderSessionOptions
    ): Promise<vscode.AuthenticationSession> {
        const isSilent: boolean = this._isAttemptingSilentAutoLogin;
        if (this._isAttemptingSilentAutoLogin) {
            this._isAttemptingSilentAutoLogin = false;
            logger.trace("[AuthProvider] createSession: Silent auto-login attempt detected.");
        } else {
            logger.trace(
                `[AuthProvider] createSession called (interactive). Scopes: ${scopes}, Options: ${JSON.stringify(options)}`
            );
        }

        try {
            let targetProfile: TestBenchProfile | undefined;
            let passwordToUse: string | undefined;

            const activeProfileIdFromManager: string | undefined = await profileManager.getActiveProfileId(
                this.context
            );

            if (activeProfileIdFromManager) {
                const allProfiles: profileManager.TestBenchProfile[] = await profileManager.getProfiles(this.context);
                targetProfile = allProfiles.find((p) => p.id === activeProfileIdFromManager);
                if (targetProfile) {
                    logger.info(
                        `[AuthProvider] Using active profile for ${isSilent ? "silent " : ""}login: ${targetProfile.label}`
                    );
                } else {
                    logger.warn(
                        `[AuthProvider] Active profile ID ${activeProfileIdFromManager} was set, but profile not found.`
                    );
                    await profileManager.clearActiveProfile(this.context);
                    if (isSilent) {
                        throw new Error("Active profile for auto-login not found.");
                    }
                }
            }

            if (!targetProfile) {
                if (isSilent) {
                    throw new Error("No active profile available for silent auto-login.");
                }
                logger.trace("[AuthProvider] No valid pre-selected profile, proceeding with QuickPick.");
                const profiles = await profileManager.getProfiles(this.context);
                const quickPickItems: (vscode.QuickPickItem & { profile?: TestBenchProfile; isAddNew?: boolean })[] = [
                    ...profiles.map((p) => ({
                        label: p.label,
                        description: `${p.username}@${p.serverName}:${p.portNumber}`,
                        profile: p
                    })),
                    {
                        label: "$(add) Add New TestBench Connection...",
                        isAddNew: true,
                        description: "Configure a new connection profile"
                    }
                ];

                const selection = await vscode.window.showQuickPick(quickPickItems, {
                    placeHolder: "Select a TestBench Profile or Add New",
                    ignoreFocusOut: true
                });

                if (!selection) {
                    throw new Error("TestBench login cancelled by user (QuickPick).");
                }

                if (selection.isAddNew || !selection.profile) {
                    const newProfileDetails = await this.promptForNewProfileDetails();
                    if (!newProfileDetails) {
                        throw new Error("Profile creation cancelled.");
                    }
                    // Temp profile object, might not have ID yet if not saved
                    targetProfile = {
                        id: "", // Will be set by saveProfile
                        label:
                            newProfileDetails.label || `${newProfileDetails.username}@${newProfileDetails.serverName}`,
                        serverName: newProfileDetails.serverName,
                        portNumber: newProfileDetails.portNumber,
                        username: newProfileDetails.username
                    };
                    passwordToUse = newProfileDetails.password;

                    const saveNewConnectionChoice = await vscode.window.showQuickPick(["Yes", "No"], {
                        placeHolder: `Save new connection "${targetProfile.label}"?`,
                        ignoreFocusOut: true
                    });
                    if (saveNewConnectionChoice === "Yes") {
                        const savedId: string = await profileManager.saveProfile(
                            this.context,
                            targetProfile,
                            passwordToUse
                        );
                        targetProfile.id = savedId;
                        await profileManager.setActiveProfileId(this.context, targetProfile.id);
                    } else if (!passwordToUse) {
                        throw new Error("Password required for unsaved profile.");
                    }
                } else {
                    targetProfile = selection.profile;
                }
            }

            if (passwordToUse === undefined && targetProfile) {
                // if password wasn't set during new profile creation
                passwordToUse = await profileManager.getPasswordForProfile(this.context, targetProfile.id);
                if (passwordToUse === undefined) {
                    if (isSilent) {
                        // For silent auto-login, if password is not found and is required, fail silently
                        throw new Error(
                            `Password for profile "${targetProfile.label}" not found in storage. Auto-login failed.`
                        );
                    }
                    passwordToUse = await vscode.window.showInputBox({
                        prompt: `Enter password for ${targetProfile.label}`,
                        password: true,
                        ignoreFocusOut: true
                    });
                    // Empty string is a valid password
                    if (passwordToUse === undefined) {
                        throw new Error("Password entry cancelled.");
                    }
                    if (targetProfile.id) {
                        const storePasswordChoice = await vscode.window.showQuickPick(["Yes", "No"], {
                            placeHolder: `Save password for profile "${targetProfile.label}"?`,
                            ignoreFocusOut: true
                        });
                        if (storePasswordChoice === "Yes") {
                            await profileManager.saveProfile(this.context, targetProfile, passwordToUse);
                        }
                    }
                }
            }

            if (!targetProfile || passwordToUse === undefined) {
                throw new Error("Profile details or password not available for login.");
            }

            logger.info(`[AuthProvider] Attempting login to ${targetProfile.serverName} as ${targetProfile.username}`);
            const loginResult: TestBenchLoginResult | null = await loginToServerAndGetSessionDetails(
                targetProfile.serverName,
                targetProfile.portNumber,
                targetProfile.username,
                passwordToUse
            );

            if (!loginResult || !loginResult.sessionToken || !loginResult.userKey) {
                await profileManager.clearActiveProfile(this.context);
                throw new Error("TestBench login failed. Check credentials or server details.");
            }

            const vsCodeSessionId: string = Date.now().toString() + Math.random().toString();
            const sessionData: TestBenchSessionData = {
                sessionId: vsCodeSessionId,
                profileId: targetProfile.id,
                testBenchSessionToken: loginResult.sessionToken,
                accountLabel: `${targetProfile.username}@${targetProfile.serverName}`,
                userKey: loginResult.userKey
            };
            this.activeSessions.set(vsCodeSessionId, sessionData);
            await profileManager.setActiveProfileId(this.context, targetProfile.id);

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
            logger.info(`[AuthProvider] TestBench session created successfully for ${sessionData.accountLabel}`);
            return {
                id: vsCodeSessionId,
                accessToken: sessionData.testBenchSessionToken,
                account: { label: sessionData.accountLabel, id: sessionData.userKey },
                scopes
            };
        } catch (error: any) {
            logger.error(`[AuthProvider] createSession error${isSilent ? " (auto-login)" : ""}:`, error);
            await profileManager.clearActiveProfile(this.context);
            throw error;
        }
    }

    /**
     * Removes an authentication session.
     *
     * This method deletes the session from the internal `activeSessions` map.
     * If the removed session was associated with the currently active profile,
     * the active profile is cleared. Finally, it fires the `_onDidChangeSessions`
     * event to notify VS Code about the session removal.
     *
     * @param {string} sessionId The ID of the session to remove.
     * @returns A promise that resolves when the session has been removed and notifications have been sent.
     */
    async removeSession(sessionId: string): Promise<void> {
        logger.trace(`[AuthProvider] removeSession called for ID ${sessionId}`);
        const sessionData: TestBenchSessionData | undefined = this.activeSessions.get(sessionId);
        if (sessionData) {
            logger.info(`[AuthProvider] Removing session locally: ${sessionData.accountLabel} (ID: ${sessionId})`);
            this.activeSessions.delete(sessionId);

            const activeProfileId: string | undefined = await profileManager.getActiveProfileId(this.context);
            if (activeProfileId === sessionData.profileId) {
                await profileManager.clearActiveProfile(this.context);
                logger.trace(
                    `[AuthProvider] Cleared active profile as it matched removed session's profile ID: ${sessionData.profileId}`
                );
            }

            this._onDidChangeSessions.fire({
                added: [],
                removed: [{ id: sessionId, accessToken: "", account: { label: "", id: "" }, scopes: [] }],
                changed: []
            });
            logger.info(`[AuthProvider] Fired onDidChangeSessions for removed session: ${sessionData.accountLabel}`);
        } else {
            logger.warn(`[AuthProvider] removeSession called for an unknown session ID: ${sessionId}`);
        }
    }

    /**
     * Prompts the user to enter details for a new TestBench profile.
     * This includes server name, port number, username, password, and an optional label.
     * If the user cancels any of the required inputs (server name, port, username),
     * the function returns `undefined`. Otherwise, it returns an object containing
     * the entered details. The password can be an empty string. If no label is provided,
     * a default label in the format `username@serverName` is used.
     * @returns A promise that resolves to an object with the profile details,
     * or `undefined` if the user cancels the input process for required fields.
     */
    private async promptForNewProfileDetails(): Promise<
        (Omit<TestBenchProfile, "id" | "label"> & { label?: string; password?: string }) | undefined
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
        const password: string | undefined = await vscode.window.showInputBox({
            prompt: "Enter TestBench Password",
            password: true,
            ignoreFocusOut: true
        });
        // Let createSession handle if password is empty,

        const label: string | undefined = await vscode.window.showInputBox({
            prompt: "Enter a label for this connection (optional)",
            placeHolder: `${username}@${serverName}`,
            ignoreFocusOut: true
        });

        return {
            serverName,
            portNumber,
            username,
            password: password === undefined ? "" : password, // Treat undefined password as empty for consistency if not cancelled earlier
            label: label || `${username}@${serverName}`
        };
    }
}
