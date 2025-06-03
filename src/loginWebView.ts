/**
 * @file loginWebView.ts
 * @description Provides the login webview for the TestBench extension. This webview enables the user to enter
 * login credentials and triggers the login process using a HTML form.
 */

import * as vscode from "vscode";
import { logger, connection } from "./extension";
import { WebviewMessageCommands, allExtensionCommands } from "./constants";
import * as profileManager from "./profileManager";
import { TestBenchProfile } from "./testBenchTypes";
import { TESTBENCH_AUTH_PROVIDER_ID } from "./testBenchAuthenticationProvider";
import { PlayServerConnection } from "./testBenchConnection";

interface EditingProfileData extends TestBenchProfile {
    password?: string;
}

/**
 * The provider for the login webview.
 */
export class LoginWebViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId: string = "testbenchExtension.webView";
    private currentWebview?: vscode.WebviewView;
    private _messageListenerDisposable: vscode.Disposable | undefined;
    private editingProfileId: string | null = null;

    /**
     * Constructs a new LoginWebViewProvider.
     * @param {vscode.ExtensionContext} extensionContext The extension context.
     */
    constructor(private extensionContext: vscode.ExtensionContext) {
        logger.trace("LoginWebViewProvider initialized.");
    }

    /**
     * Called when VS Code loads the webview.
     * @param {vscode.WebviewView} webviewView The webview view instance.
     */
    async resolveWebviewView(
        webviewView: vscode.WebviewView,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _context: vscode.WebviewViewResolveContext,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _token: vscode.CancellationToken
    ): Promise<void> {
        logger.trace("Resolving login webview view.");
        this.currentWebview = webviewView;

        if (this._messageListenerDisposable) {
            this._messageListenerDisposable.dispose();
            logger.trace("Disposed previous message listener.");
        }

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources"),
                vscode.Uri.joinPath(this.extensionContext.extensionUri, "dist")
            ]
        };

        await this.updateWebviewHTMLContent();

        // Listen for messages from the webview to respond to user actions.
        this._messageListenerDisposable = webviewView.webview.onDidReceiveMessage(async (message) => {
            logger.trace(`[LoginWebView] Received message from webview: ${message.command}`);
            switch (message.command) {
                case WebviewMessageCommands.PROFILE_UI_LOADED:
                    await this.sendProfilesToWebview();
                    break;
                case WebviewMessageCommands.LOGIN_WITH_PROFILE:
                    await this.handleLoginWithProfile(message.payload.profileId);
                    break;
                case WebviewMessageCommands.SAVE_NEW_PROFILE:
                    await this.handleSaveNewProfile(message.payload);
                    break;
                case WebviewMessageCommands.REQUEST_DELETE_CONFIRMATION:
                    await this.handleRequestDeleteConfirmation(message.payload.profileId);
                    break;
                case WebviewMessageCommands.LOGIN:
                    logger.info(
                        '[LoginWebView] Old "Sign In" button clicked. Triggering TestBench login command for generic flow.'
                    );
                    vscode.commands.executeCommand(allExtensionCommands.login).then(undefined, (err) => {
                        logger.error("[LoginWebView] Error executing generic login command:", err);
                        this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                            type: "error",
                            text: "Could not start TestBench login process."
                        });
                    });
                    break;
                case WebviewMessageCommands.TRIGGER_COMMAND:
                    if (message.payload && message.payload.commandId) {
                        logger.info(
                            `[LoginWebView] Webview requested to trigger command: ${message.payload.commandId}`
                        );
                        vscode.commands.executeCommand(message.payload.commandId).then(undefined, (err) => {
                            logger.error(
                                `[LoginWebView] Error executing command '${message.payload.commandId}' from webview:`,
                                err
                            );
                            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                                type: "error",
                                text: `Could not execute command: ${message.payload.commandId}`
                            });
                        });
                    }
                    break;
                case WebviewMessageCommands.EDIT_PROFILE:
                    await this.handleEditProfile(message.payload.profileId);
                    break;
                case WebviewMessageCommands.UPDATE_PROFILE:
                    await this.handleUpdateProfile(message.payload);
                    break;
                case WebviewMessageCommands.CANCEL_EDIT_PROFILE:
                    await this.handleCancelEditProfile();
                    break;
                default:
                    logger.warn(`[LoginWebView] Unknown command from webview: ${message.command}`);
                    break;
            }
        });

        // Add the new disposable to the extension context subscriptions
        // to ensure it's cleaned up if the extension deactivates
        if (this.extensionContext && this._messageListenerDisposable) {
            this.extensionContext.subscriptions.push(this._messageListenerDisposable);
        }

        webviewView.onDidDispose(
            () => {
                // Only clear currentWebview if it's the one being disposed
                if (this.currentWebview === webviewView) {
                    this.currentWebview = undefined;
                }
                if (this._messageListenerDisposable) {
                    this._messageListenerDisposable.dispose();
                }
                logger.trace("[LoginWebView] Profile Management webview disposed.");
            },
            null,
            this.extensionContext?.subscriptions
        );
    }

    /**
     * Handles the request to confirm the deletion of a user profile.
     * It prompts the user with a confirmation dialog before proceeding with the deletion.
     *
     * @param {string} profileId - The ID of the profile to be considered for deletion.
     * @returns A promise that resolves when the confirmation process is complete.
     */
    private async handleRequestDeleteConfirmation(profileId: string): Promise<void> {
        logger.info(`[LoginWebView] Received request for delete confirmation for profile ID: ${profileId}`);
        // Prevent deletion of profile currently being edited
        if (this.editingProfileId === profileId) {
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "warning",
                text: "Cannot delete profile while editing it. Please save or cancel your changes first."
            });
            logger.warn(`[LoginWebView] Attempted to delete profile ${profileId} while it's being edited.`);
            return;
        }

        if (!profileId) {
            logger.warn("[LoginWebView] No profileId provided for delete confirmation.");
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: "Cannot delete: Profile ID missing."
            });
            return;
        }

        const profileToDelete: profileManager.TestBenchProfile | undefined = (
            await profileManager.getProfiles(this.extensionContext)
        ).find((p) => p.id === profileId);
        if (!profileToDelete) {
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Profile not found for deletion.`
            });
            return;
        }

        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the profile "${profileToDelete.label}"?`,
            { modal: true },
            "Delete",
            "No"
        );

        if (confirmation === "Delete") {
            logger.info(`[LoginWebView] User confirmed deletion for profile ID: ${profileId}. Proceeding with delete.`);
            await this.handleDeleteProfile(profileId);
        } else {
            logger.info(`[LoginWebView] User cancelled deletion for profile ID: ${profileId}.`);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "info",
                text: "Delete operation cancelled."
            });
        }
    }

    /**
     * Posts a message to the current webview.
     * @param {string} command The command to send to the webview.
     * @param payload The data to send with the command.
     */
    private postMessageToWebview(command: string, payload: any): void {
        if (this.currentWebview) {
            this.currentWebview.webview.postMessage({ command, payload });
        }
    }

    /**
     * Asynchronously fetches user profiles and sends them to the webview sorted alphabetically by label.
     * Send the editing state to the webview if a profile is being edited.
     * If successful, it posts the profiles for display.
     * If an error occurs, it logs the error and posts an error message to the webview.
     */
    private async sendProfilesToWebview(): Promise<void> {
        try {
            const profiles: profileManager.TestBenchProfile[] = await profileManager.getProfiles(this.extensionContext);
            const sortedProfiles = profiles.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));

            this.postMessageToWebview(WebviewMessageCommands.DISPLAY_PROFILES_IN_WEBVIEW, {
                profiles: sortedProfiles,
                editingProfileId: this.editingProfileId
            });
        } catch (error: any) {
            logger.error("[LoginWebView] Error fetching profiles for webview:", error);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: "Error loading profiles."
            });
        }
    }

    /**
     * Handles the login process using a specified profile ID.
     * It retrieves the profile, sets it as active, and then initiates
     * the VS Code authentication flow.
     *
     * @param {string} profileId The ID of the profile to use for login.
     * @returns A promise that resolves when the login attempt is complete.
     */
    private async handleLoginWithProfile(profileId: string): Promise<void> {
        logger.info(`[LoginWebView] Attempting login with profile ID: ${profileId}`);
        try {
            const profiles: profileManager.TestBenchProfile[] = await profileManager.getProfiles(this.extensionContext);
            const selectedProfile: profileManager.TestBenchProfile | undefined = profiles.find(
                (p) => p.id === profileId
            );

            if (!selectedProfile) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: `Profile with ID ${profileId} not found.`
                });
                return;
            }

            await profileManager.setActiveProfileId(this.extensionContext, selectedProfile.id);

            const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                createIfNone: true
            });

            if (session) {
                logger.info(`[LoginWebView] Login successful via provider for profile: ${selectedProfile.label}`);
                // The onDidChangeSessions listener in extension.ts handles UI updates
            } else {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: "Login failed. Please check credentials or server details."
                });
            }
        } catch (error: any) {
            logger.error(`[LoginWebView] Login failed for profile ${profileId}:`, error);
            await profileManager.clearActiveProfile(this.extensionContext);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Login Error: ${error.message}`
            });
        }
    }

    /**
     * Handles the saving of a new user profile.
     * It validates the necessary profile data, attempts to save it,
     * and then sends a status message (success or error) back to the webview.
     * If successful, it also refreshes the list of profiles in the webview.
     *
     * @param profileData - An object containing the details of the new profile to be saved.
     *                      This includes server name, port number, username, and an optional password and label.
     *                      The 'id' property is omitted as it will be generated upon saving.
     * @returns A promise that resolves when the save operation (including webview updates) is complete.
     */
    private async handleSaveNewProfile(
        profileData: Omit<TestBenchProfile, "id"> & { password?: string }
    ): Promise<void> {
        logger.info(`[LoginWebView] Attempting to save new profile: ${profileData.label || "No Label"}`);
        try {
            if (!profileData.serverName || !profileData.portNumber || !profileData.username) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: "Server, Port, and Username are required."
                });
                return;
            }

            // Check for duplicate label
            if (profileData.label && profileData.label.trim()) {
                const existingProfileByLabel: profileManager.TestBenchProfile | undefined =
                    await profileManager.findProfileByLabel(this.extensionContext, profileData.label.trim());

                if (existingProfileByLabel) {
                    this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                        type: "warning",
                        text: `A profile with the label "${profileData.label}" already exists. Profile labels must be unique.`
                    });
                    logger.warn(
                        `[LoginWebView] Attempt to save profile with duplicate label prevented: ${profileData.label}`
                    );
                    return;
                }
            }

            // Don't include password check when comparing existing profiles
            const existingProfile: profileManager.TestBenchProfile | undefined =
                await profileManager.findProfileByCredentials(
                    this.extensionContext,
                    profileData.serverName,
                    profileData.portNumber,
                    profileData.username
                );

            if (existingProfile) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "warning",
                    text: `A profile with the same server, port, and username already exists: "${existingProfile.label}". Not saving duplicate.`
                });
                logger.warn(
                    `[LoginWebView] Attempt to save duplicate profile (server/user match) prevented for: ${existingProfile.label}`
                );
                return;
            }

            const newProfileId = await profileManager.saveProfile(
                this.extensionContext,
                profileData,
                profileData.password
            );
            logger.info(`[LoginWebView] New profile saved with ID: ${newProfileId}`);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "success",
                text: `Profile "${profileData.label || newProfileId}" saved.`
            });
            await this.sendProfilesToWebview();
        } catch (error: any) {
            logger.error("[LoginWebView] Error saving new profile:", error);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Error saving profile: ${error.message}`
            });
        }
    }

    /**
     * Handles the deletion of a user profile.
     * It attempts to find and delete a profile based on the provided ID.
     * Sends success or error messages to the webview and refreshes the profile list upon successful deletion.
     *
     * @param {string} profileId The ID of the profile to delete.
     * @returns A promise that resolves when the deletion process is complete.
     */
    private async handleDeleteProfile(profileId: string): Promise<void> {
        logger.info(`[LoginWebView] Attempting to delete profile ID: ${profileId}`);
        try {
            const profileToDelete: profileManager.TestBenchProfile | undefined = (
                await profileManager.getProfiles(this.extensionContext)
            ).find((p) => p.id === profileId);
            if (!profileToDelete) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: `Profile not found for deletion.`
                });
                return;
            }

            await profileManager.deleteProfile(this.extensionContext, profileId);
            logger.info(`[LoginWebView] Profile deleted: ${profileId}`);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "success",
                text: `Profile "${profileToDelete.label}" deleted.`
            });
            await this.sendProfilesToWebview();
        } catch (error: any) {
            logger.error(`[LoginWebView] Error deleting profile ${profileId}:`, error);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Error deleting profile: ${error.message}`
            });
        }
    }

    /**
     * Handles entering edit mode for a specific profile.
     * Loads the profile data into the form and switches the UI to edit mode.
     *
     * @param {string} profileId - The ID of the profile to edit.
     * @returns A promise that resolves when the edit mode is set up.
     */
    private async handleEditProfile(profileId: string): Promise<void> {
        logger.info(`[LoginWebView] Entering edit mode for profile ID: ${profileId}`);
        try {
            const profiles: profileManager.TestBenchProfile[] = await profileManager.getProfiles(this.extensionContext);
            const profileToEdit: profileManager.TestBenchProfile | undefined = profiles.find((p) => p.id === profileId);

            if (!profileToEdit) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: `Profile not found for editing.`
                });
                return;
            }

            const storedPassword = await profileManager.getPasswordForProfile(this.extensionContext, profileId);
            this.editingProfileId = profileId;

            // Send edit mode data and refresh profiles to update UI state
            this.postMessageToWebview("enterEditMode", {
                profile: profileToEdit,
                hasStoredPassword: !!storedPassword
            });

            // Refresh profiles to disable delete button for the editing profile
            await this.sendProfilesToWebview();

            logger.info(`[LoginWebView] Edit mode activated for profile: ${profileToEdit.label}`);
        } catch (error: any) {
            logger.error(`[LoginWebView] Error entering edit mode for profile ${profileId}:`, error);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Error loading profile for editing: ${error.message}`
            });
        }
    }

    /**
     * Handles updating an existing profile with new data.
     * Validates the data and saves the updated profile.
     *
     * @param payload - An object containing the updated profile data including the profile ID.
     * @returns A promise that resolves when the update operation is complete.
     */
    private async handleUpdateProfile(payload: EditingProfileData): Promise<void> {
        logger.info(`[LoginWebView] Attempting to update profile: ${payload.label || payload.id}`);

        try {
            if (!payload.id || !payload.serverName || !payload.portNumber || !payload.username) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: "Profile ID, Server, Port, and Username are required."
                });
                return;
            }

            // Check for duplicate label (excluding the current profile being edited)
            if (payload.label && payload.label.trim()) {
                const existingProfileByLabel: profileManager.TestBenchProfile | undefined =
                    await profileManager.findProfileByLabel(this.extensionContext, payload.label.trim(), payload.id);

                if (existingProfileByLabel) {
                    this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                        type: "warning",
                        text: `Another profile with the label "${payload.label}" already exists. Profile labels must be unique.`
                    });
                    logger.warn(
                        `[LoginWebView] Attempt to update to duplicate label prevented. Existing profile: ${existingProfileByLabel.label}`
                    );
                    return;
                }
            }

            // Check if another profile already exists with the same server/port/username combination
            // (excluding the current profile being edited)
            const existingProfile: profileManager.TestBenchProfile | undefined =
                await profileManager.findProfileByCredentials(
                    this.extensionContext,
                    payload.serverName,
                    payload.portNumber,
                    payload.username
                );

            if (existingProfile && existingProfile.id !== payload.id) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "warning",
                    text: `Another profile with the same server, port, and username already exists: "${existingProfile.label}". Cannot save duplicate.`
                });
                logger.warn(
                    `[LoginWebView] Attempt to update to duplicate profile credentials prevented. Existing profile: ${existingProfile.label}`
                );
                return;
            }

            // Show confirmation dialog after validations
            const profiles: profileManager.TestBenchProfile[] = await profileManager.getProfiles(this.extensionContext);
            const originalUneditedProfile: profileManager.TestBenchProfile | undefined = profiles.find(
                (p) => p.id === payload.id
            );
            const originalUneditedLabel = originalUneditedProfile?.label || payload.id;

            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to overwrite the profile "${originalUneditedLabel}"?`,
                { modal: true },
                "Save Changes",
                "No"
            );

            if (confirmation !== "Save Changes") {
                logger.info(`[LoginWebView] User cancelled update for profile: ${payload.label}`);
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "info",
                    text: "Profile update cancelled."
                });
                return;
            }

            const updatedProfileId = await profileManager.saveProfile(this.extensionContext, payload, payload.password);
            logger.info(`[LoginWebView] Profile updated successfully with ID: ${updatedProfileId}`);

            this.editingProfileId = null;
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "success",
                text: `Profile "${payload.label}" updated successfully.`
            });

            this.postMessageToWebview("exitEditMode", {});
            await this.sendProfilesToWebview();
        } catch (error: any) {
            logger.error("[LoginWebView] Error updating profile:", error);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Error updating profile: ${error.message}`
            });
        }
    }
    /**
     * Handles cancelling the edit operation.
     * Clears the editing state and resets the form.
     *
     * @returns A promise that resolves when the cancel operation is complete.
     */
    private async handleCancelEditProfile(): Promise<void> {
        logger.info(`[LoginWebView] Cancelling edit mode for profile ID: ${this.editingProfileId}`);
        this.editingProfileId = null;

        this.postMessageToWebview("exitEditMode", {});
        this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
            type: "info",
            text: "Edit cancelled."
        });

        // Refresh profiles to re-enable delete button
        await this.sendProfilesToWebview();

        logger.info("[LoginWebView] Edit mode cancelled and form reset.");
    }

    /**
     * Updates the HTML content of the webview based on the connection status.
     */
    async updateWebviewHTMLContent(): Promise<void> {
        if (this.currentWebview) {
            const isSignedIn = !!connection;
            if (isSignedIn) {
                this.currentWebview.webview.html = this.getAlreadyLoggedInHtmlPage(this.currentWebview.webview);
            } else {
                this.currentWebview.webview.html = this.getProfileManagementHtmlPage(this.currentWebview.webview);
            }
        }
    }

    /**
     * Creates a URI for the TestBench icon.
     * @param {vscode.Webview} webview The webview instance.
     * @param {string} iconName The name of the icon file.
     * @returns {vscode.Uri | null} The icon URI, or null if the extension context is undefined.
     */
    private createIconUri(webview: vscode.Webview, iconName: string): vscode.Uri | null {
        if (!this.extensionContext) {
            logger.error("[LoginWebView] Extension context is undefined; cannot create icon URI.");
            return null;
        }
        const iconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", iconName)
        );
        return iconUri;
    }

    /**
     * Generates the HTML content for the profile management webview.
     * This includes the UI for displaying, adding, and managing connection profiles.
     *
     * @param {vscode.Webview} webview The VS Code webview instance to which this HTML will be rendered.
     *                Used to generate Content Security Policy nonces and URIs.
     * @returns {string} A string containing the complete HTML for the profile management page.
     */
    private getProfileManagementHtmlPage(webview: vscode.Webview): string {
        const nonce: string = getNonce();
        const cspSource: string = webview.cspSource;
        const contentSecurityPolicy: string = `
            default-src 'none';
            img-src ${cspSource} https: data:;
            script-src 'nonce-${nonce}';
            style-src ${cspSource} 'unsafe-inline' 'self'; 
            font-src ${cspSource};
        `;

        const profilesHeaderIconDarkUri = this.createIconUri(webview, "profiles-dark.svg");
        const profilesHeaderIconLightUri = this.createIconUri(webview, "profiles-light.svg");
        const addProfileHeaderIconDarkUri = this.createIconUri(webview, "add-dark.svg");
        const addProfileHeaderIconLightUri = this.createIconUri(webview, "add-light.svg");
        const editProfileHeaderIconDarkUri = this.createIconUri(webview, "edit-profile-dark.svg");
        const editProfileHeaderIconLightUri = this.createIconUri(webview, "edit-profile-light.svg");
        const saveProfileButtonIconDarkUri = this.createIconUri(webview, "save-dark.svg");
        const saveProfileButtonIconLightUri = this.createIconUri(webview, "save-light.svg");
        const loginIconLightUri = this.createIconUri(webview, "login-webview-light.svg");
        const loginIconDarkUri = this.createIconUri(webview, "login-webview-dark.svg");
        const editIconLightUri = this.createIconUri(webview, "edit-profile-light.svg");
        const editIconDarkUri = this.createIconUri(webview, "edit-profile-dark.svg");
        const deleteIconLightUri = this.createIconUri(webview, "remove-profile-light.svg");
        const deleteIconDarkUri = this.createIconUri(webview, "remove-profile-dark.svg");

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8"/>
            <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>TestBench Profile Management</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-side-bar-background, var(--vscode-editor-background));
                    padding: 15px;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    box-sizing: border-box;
                    gap: 20px;
                }
                body[data-vscode-theme-kind="vscode-dark"] {
                    background-color: #2d2d30;
                }
                body[data-vscode-theme-kind="vscode-light"] {
                    background-color: #f8f8f8;
                }
                body[data-vscode-theme-kind="vscode-high-contrast"] {
                    background-color: #1e1e1e;
                }
                .profile-section, .add-profile-section {
                    padding: 15px;
                    border: 1px solid var(--vscode-settings-dropdownBorder, var(--vscode-contrastBorder));
                    border-radius: 6px;
                    background-color: var(--vscode-list-inactiveSelectionBackground);
                    min-width: 0;
                    overflow: hidden;
                }
                @media (max-width: 320px) {
                    body {
                        padding: 10px;
                        gap: 15px;
                    }
                    
                    .profile-section, .add-profile-section {
                        padding: 12px;
                    }
                }
                h2, h3 {
                    color: var(--vscode-settings-headerForeground);
                    margin: 0 0 15px 0;
                    padding-bottom: 8px;
                    border-bottom: 1px solid var(--vscode-focusBorder, var(--vscode-settings-dropdownBorder));
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                }
                ul#profilesList {
                    list-style: none;
                    padding: 0;                    
                    max-height: min(60vh, 400px);
                    border: 1px solid var(--vscode-input-border, var(--vscode-settings-textInputBorder));
                    border-radius: 4px;
                    transition: max-height 0.2s ease-in-out;
                }  

                ul#profilesList li {
                    box-sizing: border-box;
                    padding: 10px 12px;
                    margin-bottom: -1px;
                    border-bottom: 1px solid var(--vscode-input-border, var(--vscode-settings-textInputBorder));
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background-color: var(--vscode-list-hoverBackground);
                    transition: background-color 0.2s ease-in-out;
                    min-height: 60px;
                    flex-wrap: nowrap; 
                    overflow: hidden;
                    min-width: 0;
                }
                ul#profilesList li:last-child {
                    border-bottom: none;
                }
                ul#profilesList li:hover {
                    background-color: var(--vscode-list-focusBackground);
                }
                ul#profilesList li .profile-details {
                    flex-grow: 1;
                    flex-shrink: 1;
                    margin-right: 10px;
                    min-width: 0;
                    overflow: hidden;
                }
                ul#profilesList li .profile-label {
                    font-weight: bold;
                    color: var(--vscode-list-activeSelectionForeground);
                    font-size: 1.05em;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 100%;
                }
                ul#profilesList li .profile-info {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 3px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 100%;
                }
                ul#profilesList li.profile-being-edited {
                    background-color: var(--vscode-list-focusBackground);
                    border-left: 3px solid var(--vscode-gitDecoration-modifiedResourceForeground, #E1C16E);
                    padding-left: 9px; /* Adjust for border */
                }
                ul#profilesList li .profile-actions button:disabled {
                    opacity: 0.3;
                    cursor: not-allowed;
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-descriptionForeground);
                }
                ul#profilesList li .profile-actions button:disabled:hover {
                    background-color: var(--vscode-button-secondaryBackground);
                    opacity: 0.3;
                }
                .editing-indicator {
                    font-size: 0.8em;
                    color: var(--vscode-gitDecoration-modifiedResourceForeground, #E1C16E);
                    font-weight: normal;
                    margin-left: 8px;
                    opacity: 0.8;
                }
                ul#profilesList li .profile-actions button.delete-btn:disabled {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-descriptionForeground);
                    border-color: var(--vscode-button-secondaryBackground);
                    opacity: 0.3;
                }
                ul#profilesList li.profile-being-edited:focus-within {
                    outline: 2px solid var(--vscode-gitDecoration-modifiedResourceForeground);
                    outline-offset: 2px;
                }
                ul#profilesList li .profile-actions button[disabled][title]:hover::after {
                    content: attr(title);
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background-color: var(--vscode-editorHoverWidget-background);
                    color: var(--vscode-editorHoverWidget-foreground);
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 0.8em;
                    white-space: nowrap;
                    z-index: 1000;
                    pointer-events: none;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                }
                .profile-actions {
                    display: flex;
                    gap: 6px;
                    align-items: center;
                    flex-shrink: 0;
                    min-width: fit-content;
                }
                .profile-actions button {
                    padding: 6px 8px;
                    font-size: 0.9em;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 32px;
                    min-height: 32px;
                    border-radius: 4px;
                    flex-shrink: 0;
                    max-width: 32px;
                }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder));
                    padding: 8px 15px;
                    cursor: pointer;
                    border-radius: 4px;
                    font-weight: 500;
                    transition: background-color 0.2s ease-in-out, border-color 0.2s ease-in-out;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                    border-color: var(--vscode-focusBorder);
                }
                button:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                    outline-offset: 2px;
                }
                button .icon {
                    margin-right: 6px;
                }
                .profile-actions button .icon {
                    margin-right: 0;
                }                    
                #saveProfileBtn, .login-btn {
                    background-color: var(--vscode-button-primaryBackground, var(--vscode-button-background));
                    color: var(--vscode-button-primaryForeground, var(--vscode-button-foreground));
                }
                #saveProfileBtn:hover, .login-btn:hover {
                    background-color: var(--vscode-button-primaryHoverBackground, var(--vscode-button-hoverBackground));
                }
                .edit-btn {
                    background-color: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
                    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
                    border-color: var(--vscode-button-secondaryBackground, var(--vscode-button-border));
                }
                .edit-btn:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
                    opacity: 0.9;
                }
                button.delete-btn {
                    background-color: var(--vscode-button-secondaryBackground, var(--vscode-errorForeground));
                    color: var(--vscode-button-secondaryForeground, white);
                    border-color: var(--vscode-button-secondaryBackground, var(--vscode-errorForeground));
                }
                button.delete-btn:hover {
                    background-color: var(--vscode-errorForeground);
                    opacity: 0.8;
                }
                .form-group {
                    margin-bottom: 15px;
                    min-width: 0;
                }
                .form-group label {
                    display: block;
                    margin-bottom: 5px;
                    font-size: 0.95em;
                    font-weight: 500;
                }
                .form-group input[type="text"],
                .form-group input[type="number"],
                .form-group input[type="password"] {
                    width: calc(100% - 12px);
                    padding: 8px 6px;
                    border-radius: 3px;
                    border: 1px solid var(--vscode-input-border, var(--vscode-settings-textInputBorder));
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    box-sizing: border-box;
                    min-width: 0;
                }
                .form-group input:focus {
                    border-color: var(--vscode-focusBorder);
                    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
                }
                .password-wrapper {
                    position: relative;
                    display: flex;
                    align-items: center;
                    min-width: 0;
                }
                .password-wrapper input[type="password"] {
                    flex-grow: 1;
                    flex-shrink: 1;
                    min-width: 0;
                }
                .password-toggle {
                    position: absolute;
                    right: 8px;
                    cursor: pointer;
                    background: none;
                    border: none;
                    color: var(--vscode-icon-foreground);
                }
                #messages {
                    margin-top: 15px;
                    padding: 10px 12px;
                    border-radius: 4px;
                    word-break: break-word;
                    font-size: 0.95em;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    overflow-wrap: break-word;
                    hyphens: auto;
                }
                #messages.hidden {
                    display: none;
                }
                .message-info {
                    background-color: var(--vscode-inputValidation-infoBackground);
                    color: var(--vscode-inputValidation-infoForeground);
                    border: 1px solid var(--vscode-inputValidation-infoBorder);
                }
                .message-success {
                    background-color: var(--vscode-editorGutter-addedBackground);
                    color: var(--vscode-notification-infoForeground);
                    border: 1px solid var(--vscode-gitDecoration-addedResourceForeground);
                }
                .message-error {
                    background-color: var(--vscode-inputValidation-errorBackground);
                    color: var(--vscode-inputValidation-errorForeground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                }
                .message-warning {
                    background-color: var(--vscode-inputValidation-warningBackground, #warning_color_background_fallback);
                    color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
                    border: 1px solid var(--vscode-inputValidation-warningBorder, #warning_color_border_fallback);
                }
                .scrollable-content {
                    flex-grow: 1;
                    overflow-y: auto;
                    padding-right: 5px;
                }
                #noProfilesMessage {
                    padding: 15px;
                    text-align: center;
                    color: var(--vscode-descriptionForeground);
                    border: 1px dashed var(--vscode-input-border);
                    border-radius: 4px;
                    min-height: auto;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 10px 0;
                    word-wrap: break-word;
                    hyphens: auto;
                }
                .profile-section {
                    padding: 15px;
                    border: 1px solid var(--vscode-settings-dropdownBorder, var(--vscode-contrastBorder));
                    border-radius: 6px;
                    background-color: var(--vscode-list-inactiveSelectionBackground);
                    /* Remove any fixed heights that might cause gaps */
                    min-height: auto;
                }
                .icon {
                    width: 16px;
                    height: 16px;
                    margin-right: 8px;
                    background-repeat: no-repeat;
                    background-position: center;
                    background-size: 16px 16px;
                    flex-shrink: 0;
                }            

                /* Edit mode styles */
                .edit-mode .add-profile-section {
                    border-color: var(--vscode-gitDecoration-modifiedResourceForeground);
                }
                
                .edit-mode .add-profile-section h3 {
                    color: var(--vscode-gitDecoration-modifiedResourceForeground);
                }
                                
                .edit-actions {
                    display: flex;
                    gap: 10px;
                    margin-top: 10px;
                    flex-wrap: wrap;
                }
                
                .edit-actions button {
                    flex: 1;
                    min-width: 120px;
                }
                
                #cancelEditBtn {
                    background-color: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
                    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
                }
                
                #cancelEditBtn:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
                }
                
                /* Theme-based icon styles */
                @media (prefers-color-scheme: light) {
                    .icon-profiles-header { background-image: url(${profilesHeaderIconLightUri}); }
                    .icon-add-profile-header { background-image: url(${addProfileHeaderIconLightUri}); }
                    .icon-edit-profile-header { background-image: url(${editProfileHeaderIconLightUri}); }
                    .icon-save { background-image: url(${saveProfileButtonIconLightUri}); }
                    .icon-login { background-image: url(${loginIconLightUri}); }
                    .icon-edit { background-image: url(${editIconLightUri}); }
                    .icon-delete { background-image: url(${deleteIconLightUri}); }
                }
                
                @media (prefers-color-scheme: dark) {
                    .icon-profiles-header { background-image: url(${profilesHeaderIconDarkUri}); }
                    .icon-add-profile-header { background-image: url(${addProfileHeaderIconDarkUri}); }
                    .icon-edit-profile-header { background-image: url(${editProfileHeaderIconDarkUri}); }
                    .icon-save { background-image: url(${saveProfileButtonIconDarkUri}); }
                    .icon-login { background-image: url(${loginIconDarkUri}); }
                    .icon-edit { background-image: url(${editIconDarkUri}); }
                    .icon-delete { background-image: url(${deleteIconDarkUri}); }
                }

                /* Responsive breakpoints for very small screens */
                @media (max-width: 300px) {
                    ul#profilesList li {
                        padding: 8px 10px;
                    }
                    
                    .profile-actions {
                        gap: 4px;
                    }
                    
                    .profile-actions button {
                        min-width: 28px;
                        min-height: 28px;
                        max-width: 28px;
                        padding: 4px 6px;
                    }
                    
                    .profile-actions button .icon {
                        width: 14px;
                        height: 14px;
                        background-size: 14px 14px;
                    }
                }

                @media (max-width: 280px) {
                    .edit-actions {
                        flex-direction: column; /* Stack buttons vertically on very small screens */
                        gap: 8px;
                    }
                    
                    .edit-actions button {
                        flex: none;
                        width: 100%;
                    }
                }
                
                /* VS Code theme fallbacks */
                body[data-vscode-theme-kind="vscode-light"] .icon-profiles-header { background-image: url(${profilesHeaderIconLightUri}); }
                body[data-vscode-theme-kind="vscode-light"] .icon-add-profile-header { background-image: url(${addProfileHeaderIconLightUri}); }
                body[data-vscode-theme-kind="vscode-light"] .icon-edit-profile-header { background-image: url(${editProfileHeaderIconLightUri}); }
                body[data-vscode-theme-kind="vscode-light"] .icon-save { background-image: url(${saveProfileButtonIconLightUri}); }
                body[data-vscode-theme-kind="vscode-light"] .icon-login { background-image: url(${loginIconLightUri}); }
                body[data-vscode-theme-kind="vscode-light"] .icon-edit { background-image: url(${editIconLightUri}); }
                body[data-vscode-theme-kind="vscode-light"] .icon-delete { background-image: url(${deleteIconLightUri}); }
        
                body[data-vscode-theme-kind="vscode-dark"] .icon-profiles-header,
                body[data-vscode-theme-kind="vscode-high-contrast"] .icon-profiles-header { background-image: url(${profilesHeaderIconDarkUri}); }
                body[data-vscode-theme-kind="vscode-dark"] .icon-add-profile-header,
                body[data-vscode-theme-kind="vscode-high-contrast"] .icon-add-profile-header { background-image: url(${addProfileHeaderIconDarkUri}); }
                body[data-vscode-theme-kind="vscode-dark"] .icon-edit-profile-header,
                body[data-vscode-theme-kind="vscode-high-contrast"] .icon-edit-profile-header { background-image: url(${editProfileHeaderIconDarkUri}); }
                body[data-vscode-theme-kind="vscode-dark"] .icon-save,
                body[data-vscode-theme-kind="vscode-high-contrast"] .icon-save { background-image: url(${saveProfileButtonIconDarkUri}); }
                body[data-vscode-theme-kind="vscode-dark"] .icon-login,
                body[data-vscode-theme-kind="vscode-high-contrast"] .icon-login { background-image: url(${loginIconDarkUri}); }
                body[data-vscode-theme-kind="vscode-dark"] .icon-edit,
                body[data-vscode-theme-kind="vscode-high-contrast"] .icon-edit { background-image: url(${editIconDarkUri}); }
                body[data-vscode-theme-kind="vscode-dark"] .icon-delete,
                body[data-vscode-theme-kind="vscode-high-contrast"] .icon-delete { background-image: url(${deleteIconDarkUri}); }
            </style>
        </head>
        <body>
            <div class="scrollable-content">
            <section class="profile-section" aria-labelledby="profilesHeading">
                <h2 id="profilesHeading">
                    <span class="icon icon-profiles-header"></span>
                    TestBench Connections
                </h2>
                <div id="profilesLoadingMessage" style="padding: 10px; text-align: center;">
                    <vscode-progress-ring></vscode-progress-ring>
                    <p style="color: var(--vscode-descriptionForeground); margin-top: 5px;">Loading profiles...</p>
                </div>
                <ul id="profilesList" aria-live="polite">
                </ul>
                <p id="noProfilesMessage" style="display: none;">No profiles configured yet.<br>Use the form below to add one.</p>
            </section>
    
            <section class="add-profile-section" aria-labelledby="addProfileHeading">
                <h3 id="addProfileHeading">
                    <span class="icon icon-add-profile-header"></span>
                    <span id="sectionTitle">Add New Connection</span>
                </h3>
                <form id="addProfileForm">
                    <div class="form-group">
                        <label for="profileLabel">Connection Label (e.g., "My TestBench Connection")</label>
                        <input type="text" id="profileLabel" name="profileLabel" placeholder="Optional, e.g., Main TestBench">
                    </div>
                    <div class="form-group">
                        <label for="serverName">Server Hostname or IP Address</label>
                        <input type="text" id="serverName" name="serverName" required placeholder="e.g., testbench.example.com">
                    </div>
                    <div class="form-group">
                        <label for="portNumber">Port Number</label>
                        <input type="number" id="portNumber" name="portNumber" value="9445" required placeholder="e.g., 9445">
                    </div>
                    <div class="form-group">
                        <label for="username">Username</label>
                        <input type="text" id="username" name="username" required placeholder="Your TestBench username">
                    </div>
                    <div class="form-group">
                        <label for="password">Password</label>
                        <div class="password-wrapper">
                            <input type="password" id="password" name="password" placeholder="Enter password">
                        </div>
                        <small style="color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 4px; display: block;">Only non-empty passwords will be stored.</small>
                    </div>
                    <div class="form-group" style="display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" id="storePasswordCheckbox" name="storePassword" checked style="width: auto; height: auto; margin-right: 5px;">
                        <label for="storePasswordCheckbox" style="margin-bottom: 0; font-weight: normal;">Store password for this profile</label>
                    </div>
                    
                    <button type="button" id="saveProfileBtn">
                        <span class="icon icon-save"></span>                
                        <span id="saveButtonText">Save New Profile</span>
                    </button>
                    
                    <div class="edit-actions" id="editActions" style="display: none;">
                        <button type="button" id="cancelEditBtn">
                            Cancel Edit
                        </button>
                    </div>

                </form>
            </section>
        </div>
        <div id="messages" class="hidden" role="alert" aria-live="assertive"></div>
    
            <script nonce="${nonce}">
            (function() {
                const vscode = acquireVsCodeApi();
                const profilesListEl = document.getElementById('profilesList');
                const noProfilesMessageEl = document.getElementById('noProfilesMessage');
                const profilesLoadingMessageEl = document.getElementById('profilesLoadingMessage');
                const messagesEl = document.getElementById('messages');
                const cancelEditBtn = document.getElementById('cancelEditBtn');
                const editActionsDiv = document.getElementById('editActions');
                const sectionTitle = document.getElementById('sectionTitle');
                const sectionIcon = document.querySelector('.add-profile-section h3 .icon');
                const saveButtonText = document.getElementById('saveButtonText');

                let currentEditingProfileId = null;
                let isEditMode = false;
    
                // Form elements
                const profileLabelInput = document.getElementById('profileLabel');
                const serverNameInput = document.getElementById('serverName');
                const portNumberInput = document.getElementById('portNumber');
                const usernameInput = document.getElementById('username');
                const passwordInput = document.getElementById('password');
                const storePasswordCheckbox = document.getElementById('storePasswordCheckbox');
                const saveProfileBtn = document.getElementById('saveProfileBtn');
                const addProfileForm = document.getElementById('addProfileForm');
    
                if (!profilesListEl || !saveProfileBtn || !noProfilesMessageEl || !messagesEl || !addProfileForm || !profilesLoadingMessageEl) {
                    console.error('[WebviewScript] Critical UI elements not found. Aborting script setup.');
                    return;
                }
    
                function displayMessage(type, text) {
                    messagesEl.textContent = text;
                    messagesEl.className = 'message-' + type;
                    messagesEl.classList.remove('hidden');
                    messagesEl.setAttribute('role', type === 'error' ? 'alert' : 'status');
    
                    // Clear message after a delay
                    if (type !== 'error') {
                        setTimeout(() => {
                        messagesEl.textContent = '';
                        messagesEl.className = '';
                        messagesEl.classList.add('hidden');
                        }, 7000);
                    }
                }    

                function renderProfiles(data) {
                    let profiles, editingProfileId;
                    if (Array.isArray(data)) {
                        profiles = data;
                        editingProfileId = null;
                    } else {
                        profiles = data.profiles || [];
                        editingProfileId = data.editingProfileId || null;
                    }

                    if (profilesLoadingMessageEl) {
                        profilesLoadingMessageEl.style.display = 'none';
                    }
                    profilesListEl.innerHTML = '';

                    if (!profiles || profiles.length === 0) {
                        if (noProfilesMessageEl) {
                            noProfilesMessageEl.style.display = 'block';
                        }
                        if (profilesListEl) {
                            profilesListEl.style.display = 'none';
                        }
                    } else {
                        if (noProfilesMessageEl) {
                            noProfilesMessageEl.style.display = 'none';
                        }
                        if (profilesListEl) {
                            profilesListEl.style.display = 'block';
                        }

                        // Sort profiles alphabetically by label
                        const sortedProfiles = [...profiles].sort((a, b) => 
                            a.label.toLowerCase().localeCompare(b.label.toLowerCase())
                        );
                        
                        sortedProfiles.forEach(profile => {
                            const li = document.createElement('li');
                            const isBeingEdited = editingProfileId === profile.id;
                            
                            // Add visual indication for profile being edited
                            if (isBeingEdited) {
                                li.classList.add('profile-being-edited');
                            }
                            
                            li.setAttribute('tabindex', '0');
                            li.setAttribute('aria-label', \`Profile: \${profile.label}, user \${profile.username} at \${profile.serverName}\`);

                            li.innerHTML = \`
                            <div class="profile-details">
                                <div class="profile-label">
                                    \${profile.label}
                                    \${isBeingEdited ? '<span class="editing-indicator">(editing)</span>' : ''}
                                </div>
                                <div class="profile-info">\${profile.username}@\${profile.serverName}:\${profile.portNumber}</div>
                            </div>
                            <div class="profile-actions">
                                <button class="login-btn" data-profile-id="\${profile.id}" 
                                        aria-label="Login with profile \${profile.label}" 
                                        title="Login with this profile"
                                        \${isBeingEdited ? 'disabled' : ''}>
                                    <span class="icon icon-login"></span>
                                </button>
                                <button class="edit-btn" data-profile-id="\${profile.id}" 
                                        aria-label="Edit profile \${profile.label}" 
                                        title="Edit this profile"
                                        \${isBeingEdited ? 'disabled' : ''}
                                        style="\${isBeingEdited ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                                    <span class="icon icon-edit"></span>
                                </button>
                                <button class="delete-btn" data-profile-id="\${profile.id}" 
                                        aria-label="Delete profile \${profile.label}" 
                                        title="\${isBeingEdited ? 'Cannot delete while editing' : 'Delete this profile'}"
                                        \${isBeingEdited ? 'disabled' : ''}
                                        style="\${isBeingEdited ? 'opacity: 0.3; cursor: not-allowed;' : ''}">
                                    <span class="icon icon-delete"></span>
                                </button>
                            </div>
                            \`;
                            profilesListEl.appendChild(li);
                        });
                    }
                }

                function enterEditMode(profile, hasStoredPassword) {
                    console.log('[WebviewScript] Entering edit mode for profile:', profile);
                    isEditMode = true;
                    currentEditingProfileId = profile.id;
                    
                    // Update UI state
                    document.body.classList.add('edit-mode');
                    sectionTitle.textContent = 'Edit Profile';
                    if (sectionIcon) {
                        sectionIcon.className = 'icon icon-edit-profile-header';
                    }
                    saveButtonText.textContent = 'Save Changes';
                    
                    // Show cancel button
                    editActionsDiv.style.display = 'block';
                    
                    // Populate form with profile data
                    profileLabelInput.value = profile.label || '';
                    serverNameInput.value = profile.serverName || '';
                    portNumberInput.value = profile.portNumber || '';
                    usernameInput.value = profile.username || '';
                    passwordInput.value = ''; // Don't pre-fill password for security
                    
                    // Update checkbox state
                    storePasswordCheckbox.checked = hasStoredPassword;
                    
                    // Focus on the label field
                    profileLabelInput.focus();
                    
                    displayMessage('info', \`Editing profile: \${profile.label}\`);
                }

                function exitEditMode() {
                    console.log('[WebviewScript] Exiting edit mode');
                    isEditMode = false;
                    currentEditingProfileId = null;
                    
                    // Reset UI state
                    document.body.classList.remove('edit-mode');
                    sectionTitle.textContent = 'Add New Profile';
                    if (sectionIcon) {
                        sectionIcon.className = 'icon icon-add-profile-header';
                    }
                    saveButtonText.textContent = 'Save New Profile';
                    
                    // Hide cancel button
                    editActionsDiv.style.display = 'none';
                    
                    // Clear and reset form
                    addProfileForm.reset();
                    portNumberInput.value = '9445'; // Reset default port
                    storePasswordCheckbox.checked = true; // Reset default
                }
    
                function handleSaveProfile() {
                    if (!serverNameInput.value.trim() || !portNumberInput.value.trim() || !usernameInput.value.trim()) {
                        displayMessage('error', 'Server, Port, and Username are required fields.');
                        if (!serverNameInput.value.trim()) {serverNameInput.focus();}
                        else if (!portNumberInput.value.trim()) {portNumberInput.focus();}
                        else if (!usernameInput.value.trim()) {usernameInput.focus();}
                        return;
                    }
                    if (isNaN(parseInt(portNumberInput.value, 10))) {
                        displayMessage('error', 'Port must be a valid number.');
                        portNumberInput.focus();
                        return;
                    }

                    const payload = {
                        label: profileLabelInput.value.trim() || \`\${usernameInput.value.trim()}@\${serverNameInput.value.trim()}\`,
                        serverName: serverNameInput.value.trim(),
                        portNumber: parseInt(portNumberInput.value, 10),
                        username: usernameInput.value.trim(),
                        password: storePasswordCheckbox.checked ? passwordInput.value : undefined
                    };
                    if (isEditMode && currentEditingProfileId) {
                        // Update existing profile
                        payload.id = currentEditingProfileId;
                        saveProfileBtn.disabled = true;
                        saveButtonText.textContent = 'Updating...';
                        vscode.postMessage({ command: '${WebviewMessageCommands.UPDATE_PROFILE}', payload });
                    } else {
                        // Save new profile
                        saveProfileBtn.disabled = true;
                        saveButtonText.textContent = 'Saving...';
                        vscode.postMessage({ command: '${WebviewMessageCommands.SAVE_NEW_PROFILE}', payload });
                    }

                    setTimeout(() => {
                        passwordInput.value = '';
                        saveProfileBtn.disabled = false;
                        if (isEditMode) {
                            saveButtonText.textContent = 'Save Changes';
                        } else {
                            saveButtonText.textContent = 'Save New Profile';
                        }
                    }, 1000);
                }
    
                // Event listeners
                saveProfileBtn.addEventListener('click', handleSaveProfile);
    
                profilesListEl.addEventListener('click', function(event) {
                    const targetButton = event.target.closest('button');
                    if (targetButton && !targetButton.disabled) {
                        const profileId = targetButton.dataset.profileId;
                        if (targetButton.classList.contains('login-btn')) {
                            vscode.postMessage({ command: 'loginWithProfile', payload: { profileId } });
                        } else if (targetButton.classList.contains('edit-btn')) {
                            vscode.postMessage({ command: 'editProfile', payload: { profileId } });
                        } else if (targetButton.classList.contains('delete-btn')) {
                            vscode.postMessage({ command: 'requestDeleteConfirmation', payload: { profileId } });
                        }
                    } else if (targetButton && targetButton.disabled) {
                        if (targetButton.classList.contains('delete-btn')) {
                            displayMessage('info', 'Cannot delete profile while editing it. Please save or cancel your changes first.');
                        } else if (targetButton.classList.contains('login-btn') || targetButton.classList.contains('edit-btn')) {
                            displayMessage('info', 'Please save or cancel your current changes before performing other actions.');
                        }
                    }
                });

                if (cancelEditBtn) {
                    cancelEditBtn.addEventListener('click', function() {
                        vscode.postMessage({ command: '${WebviewMessageCommands.CANCEL_EDIT_PROFILE}' });
                    });
                }
                
                // Handle messages from the extension host
                window.addEventListener('message', event => {
                    const message = event.data;
                    console.log('[WebviewScript] Message received from host:', message);
                    switch (message.command) {
                        case '${WebviewMessageCommands.DISPLAY_PROFILES_IN_WEBVIEW}':
                            renderProfiles(message.payload);
                            break;
                        case '${WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE}':
                            displayMessage(message.payload.type, message.payload.text);
                            // Reset button states
                            if (saveProfileBtn) {
                                saveProfileBtn.disabled = false;
                                if (isEditMode) {
                                    saveButtonText.textContent = 'Save Changes';
                                } else {
                                    saveButtonText.textContent = 'Save New Profile';
                                }
                            }
                            break;
                        case 'enterEditMode':
                            enterEditMode(message.payload.profile, message.payload.hasStoredPassword);
                            break;
                        case 'exitEditMode':
                            exitEditMode();
                            break;
                    }
                });
    
                // Tell the extension the UI is ready
                console.log('[WebviewScript] Requesting initial profiles via PROFILE_UI_LOADED.');
                vscode.postMessage({ command: '${WebviewMessageCommands.PROFILE_UI_LOADED}' });
                messagesEl.classList.add('hidden');
            }());
            </script>
        </body>
        </html>`;
    }

    /**
     * Generates the HTML content for a webview page indicating that the user is already logged in.
     * This page displays a success message, the TestBench logo, and a sign-out button.
     *
     * @param {vscode.Webview} webview The VS Code webview instance to which the HTML will be rendered.
     * @returns {string} A string containing the HTML markup for the "already logged in" page.
     */
    private getAlreadyLoggedInHtmlPage(webview: vscode.Webview): string {
        const testBenchLogoUri: vscode.Uri | null = this.createIconUri(webview, "testbench-logo.svg");
        const nonce: string = getNonce();
        const cspSource: string = webview.cspSource;
        const contentSecurityPolicy: string = `default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource};`;

        const currentConnection: PlayServerConnection | null = connection;
        let connectedAsInfo: string = "You are connected to TestBench.";
        if (currentConnection) {
            connectedAsInfo = `Connected as <strong>${currentConnection.getUsername()}</strong> on <strong>${currentConnection.getServerName()}:${currentConnection.getServerPort()}</strong>.`;
        }

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8"/>
                <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>TestBench Connected</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                        color: var(--vscode-editor-foreground);
                        background-color: var(--vscode-side-bar-background, var(--vscode-editor-background));
                        padding: 15px;
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        box-sizing: border-box;
                        gap: 20px;
                    }
                    body[data-vscode-theme-kind="vscode-dark"] {
                        background-color: #2d2d30;
                    }
                    body[data-vscode-theme-kind="vscode-light"] {
                        background-color: #f8f8f8;
                    }
                    body[data-vscode-theme-kind="vscode-high-contrast"] {
                        background-color: #1e1e1e;
                    }
                    .container { display: flex; flex-direction: column; align-items: center; }
                    img { width: 48px; height: 48px; margin-bottom: 15px; }
                    p { color: var(--vscode-descriptionForeground); }
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder));
                        padding: 8px 15px;
                        cursor: pointer;
                        border-radius: 4px;
                        font-weight: 500;
                        transition: background-color 0.2s ease-in-out, border-color 0.2s ease-in-out;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        max-width: 100%;
                        box-sizing: border-box;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    ${testBenchLogoUri ? `<img src="${testBenchLogoUri}" alt="TestBench Logo" class="logo">` : ""}
                    <p class="connection-info">${connectedAsInfo}</p>
                    <p class="info-text">Use the TestBench views in the explorer or run TestBench commands.</p>
                    <button id="logoutButton"><span class="icon icon-logout"></span>Sign Out</button>
                </div>
                <script nonce="${nonce}">
                    (function() {
                        const vscode = acquireVsCodeApi();
                        const logoutButton = document.getElementById('logoutButton');
                        if (logoutButton) {
                            logoutButton.addEventListener('click', () => {
                                console.log("Sign Out button clicked.");
                                vscode.postMessage({ 
                                    command: '${WebviewMessageCommands.TRIGGER_COMMAND}', 
                                    payload: { commandId: '${allExtensionCommands.logout}' }
                                });                
                            });
                        }
                    }());
                </script>
            </body>
            </html>`;
    }
}

/**
 * Generates a random 32-character string.
 * This string can be used as a nonce (number used once) for security purposes.
 * @returns {string} A 32-character random string.
 */
function getNonce(): string {
    let text: string = "";
    const possible: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
