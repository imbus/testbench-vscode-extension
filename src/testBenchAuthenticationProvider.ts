import * as vscode from "vscode";
import * as profileManager from "./profileManager";
import { loginToServerAndGetSessionDetails } from "./testBenchConnection";
import { TestBenchProfile } from "./testBenchTypes";
import { logger } from "./extension";

export const TESTBENCH_AUTH_PROVIDER_ID = "testbench-auth";
export const TESTBENCH_AUTH_PROVIDER_LABEL = "TestBench";

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
     * @param scopes An optional list of scopes. If provided, the sessions returned should match these permissions.
     * @returns A promise that resolves to an array of authentication sessions.
     */
    async getSessions(
        scopes?: readonly string[]
        // options?: vscode.AuthenticationProviderSessionOptions
    ): Promise<vscode.AuthenticationSession[]> {
        logger.trace(`[AuthProvider] getSessions called. Scopes: ${scopes}`);
        const sessionsToReturn: vscode.AuthenticationSession[] = [];
        for (const sessionData of this.activeSessions.values()) {
            sessionsToReturn.push({
                id: sessionData.sessionId,
                accessToken: sessionData.testBenchSessionToken,
                account: { label: sessionData.accountLabel, id: sessionData.userKey },
                scopes: ["api_access"] // Static scopes
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
     * @param scopes - An array of scopes requested for the session.
     * @param options - Optional parameters for session creation, which can indicate if the call is for silent authentication.
     * @returns A promise that resolves to a `vscode.AuthenticationSession` object upon successful login.
     * @throws Error if the login process is cancelled, fails due to incorrect credentials,
     * missing profile information, or other issues during session creation.
     */
    async createSession(
        scopes: readonly string[],
        options?: vscode.AuthenticationProviderSessionOptions
    ): Promise<vscode.AuthenticationSession> {
        logger.trace(`[AuthProvider] createSession called. Scopes: ${scopes}, Options: ${JSON.stringify(options)}`);

        logger.trace(`[AuthProvider] createSession called. Scopes: ${scopes}, Options: ${JSON.stringify(options)}`);
        const isSilent = this._isAttemptingSilentAutoLogin; // Check if it's a silent attempt
        if (this._isAttemptingSilentAutoLogin) {
            this._isAttemptingSilentAutoLogin = false; // Reset flag immediately for subsequent calls
            logger.trace("[AuthProvider] createSession: Silent auto-login attempt detected.");
        } else {
            logger.trace(
                `[AuthProvider] createSession called (interactive). Scopes: ${scopes}, Options: ${JSON.stringify(options)}`
            );
        }

        try {
            let targetProfile: TestBenchProfile | undefined;
            let passwordToUse: string | undefined;

            // Check if a profile hint is provided (e.g., from our new Webview)
            // The LoginWebView will have already called profileManager.setActiveProfileId()
            const activeProfileIdFromManager = await profileManager.getActiveProfileId(this.context);

            if (activeProfileIdFromManager) {
                const allProfiles = await profileManager.getProfiles(this.context);
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
                // Fallback to QuickPick if no hint or hint invalid
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
                    const newProfileDetails = await this.promptForNewProfileDetails(); // Existing method
                    if (!newProfileDetails) {
                        throw new Error("Profile creation cancelled.");
                    }
                    // Temp profile object, might not have ID yet if not saved
                    targetProfile = {
                        id: "", // Placeholder, will be set by saveProfile
                        label:
                            newProfileDetails.label || `${newProfileDetails.username}@${newProfileDetails.serverName}`,
                        serverName: newProfileDetails.serverName,
                        portNumber: newProfileDetails.portNumber,
                        username: newProfileDetails.username
                        // Password handled separately
                    };
                    passwordToUse = newProfileDetails.password;

                    const saveChoice = await vscode.window.showQuickPick(["Yes", "No"], {
                        placeHolder: `Save new connection "${targetProfile.label}"?`,
                        ignoreFocusOut: true
                    });
                    if (saveChoice === "Yes") {
                        const savedId = await profileManager.saveProfile(this.context, targetProfile, passwordToUse);
                        targetProfile.id = savedId; // Update profile with actual ID
                        await profileManager.setActiveProfileId(this.context, targetProfile.id); // Set as active
                    } else if (!passwordToUse) {
                        // If not saving and password wasn't provided in promptForNewProfileDetails (e.g. it was optional)
                        throw new Error("Password required for unsaved profile.");
                    }
                } else {
                    targetProfile = selection.profile;
                }
            }

            // Password retrieval for targetProfile (whether from hint or QuickPick)
            if (passwordToUse === undefined && targetProfile) {
                // if password wasn't set during new profile creation
                passwordToUse = await profileManager.getPasswordForProfile(this.context, targetProfile.id);
                if (passwordToUse === undefined) {
                    // Password not found in storage
                    if (isSilent) {
                        // For silent auto-login, if password is not found and is required, we must fail.
                        throw new Error(
                            `Password for profile "${targetProfile.label}" not found in storage. Auto-login failed.`
                        );
                    }
                    passwordToUse = await vscode.window.showInputBox({
                        prompt: `Enter password for ${targetProfile.label}`,
                        password: true,
                        ignoreFocusOut: true
                    });
                    if (passwordToUse === undefined) {
                        // Check for undefined, as empty string might be a valid password
                        throw new Error("Password entry cancelled.");
                    }
                    // Offer to save the password if retrieved this way and profile exists
                    if (targetProfile.id) {
                        // Only if it's an existing or saved new profile
                        const storePasswordChoice = await vscode.window.showQuickPick(["Yes", "No"], {
                            placeHolder: `Save password for profile "${targetProfile.label}"?`,
                            ignoreFocusOut: true
                        });
                        if (storePasswordChoice === "Yes") {
                            // Re-save the profile with the newly entered password
                            await profileManager.saveProfile(this.context, targetProfile, passwordToUse);
                        }
                    }
                }
            }

            if (!targetProfile || passwordToUse === undefined) {
                throw new Error("Profile details or password not available for login.");
            }

            logger.info(`[AuthProvider] Attempting login to ${targetProfile.serverName} as ${targetProfile.username}`);
            const loginResult = await loginToServerAndGetSessionDetails(
                targetProfile.serverName,
                targetProfile.portNumber,
                targetProfile.username,
                passwordToUse
            );

            if (!loginResult || !loginResult.sessionToken || !loginResult.userKey) {
                await profileManager.clearActiveProfile(this.context); // Clear active if login fails
                throw new Error("TestBench login failed. Check credentials or server details.");
            }

            const vsCodeSessionId = Date.now().toString() + Math.random().toString();
            const sessionData: TestBenchSessionData = {
                sessionId: vsCodeSessionId,
                profileId: targetProfile.id, // Ensure targetProfile has an ID here
                testBenchSessionToken: loginResult.sessionToken,
                accountLabel: `${targetProfile.username}@${targetProfile.serverName}`,
                userKey: loginResult.userKey
            };
            this.activeSessions.set(vsCodeSessionId, sessionData);
            await profileManager.setActiveProfileId(this.context, targetProfile.id); // Ensure it's set as active

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
        } catch (err: any) {
            logger.error(`[AuthProvider] createSession error${isSilent ? " (auto-login)" : ""}:`, err);
            await profileManager.clearActiveProfile(this.context);
            throw err; // Re-throw to signal failure
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
     * @param sessionId The ID of the session to remove.
     * @returns A promise that resolves when the session has been removed and notifications have been sent.
     */
    async removeSession(sessionId: string): Promise<void> {
        logger.trace(`[AuthProvider] removeSession called for ID ${sessionId}`);
        const sessionData = this.activeSessions.get(sessionId);
        if (sessionData) {
            logger.info(`[AuthProvider] Removing session locally: ${sessionData.accountLabel} (ID: ${sessionId})`);
            this.activeSessions.delete(sessionId);

            const activeProfileId = await profileManager.getActiveProfileId(this.context);
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
        const serverName = await vscode.window.showInputBox({
            prompt: "Enter TestBench Server Name (e.g., testbench.example.com)",
            ignoreFocusOut: true
        });
        if (!serverName) {
            return undefined;
        }
        const portStr = await vscode.window.showInputBox({
            prompt: "Enter Port Number (e.g., 9445)",
            ignoreFocusOut: true,
            validateInput: (val) => (/^\d+$/.test(val) ? null : "Must be a number")
        });
        if (!portStr) {
            return undefined;
        }
        const portNumber = parseInt(portStr, 10);
        const username = await vscode.window.showInputBox({ prompt: "Enter TestBench Username", ignoreFocusOut: true });
        if (!username) {
            return undefined;
        }
        const password = await vscode.window.showInputBox({
            prompt: "Enter TestBench Password",
            password: true,
            ignoreFocusOut: true
        });
        // Don't return undefined if password is empty, let createSession handle it if needed
        const label = await vscode.window.showInputBox({
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
