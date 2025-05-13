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

/**
 * The provider for the login webview.
 */
export class LoginWebViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId: string = "testbenchExtension.webView";
    private currentWebview?: vscode.WebviewView;
    private _messageListenerDisposable: vscode.Disposable | undefined;

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

        // Dispose of the previous message listener if it exists.
        if (this._messageListenerDisposable) {
            this._messageListenerDisposable.dispose();
            logger.trace("Disposed previous message listener.");
        }

        // Enable scripts in the webview.
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources"),
                vscode.Uri.joinPath(this.extensionContext.extensionUri, "dist")
            ]
        };

        // Set initial HTML content, generates new UI
        await this.updateWebviewHTMLContent();

        // Store new listener disposable
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

        // Clean up when the view is disposed (e.g., user closes the view)
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
     * @param profileId - The ID of the profile to be considered for deletion.
     * @returns A promise that resolves when the confirmation process is complete.
     */
    private async handleRequestDeleteConfirmation(profileId: string): Promise<void> {
        logger.info(`[LoginWebView] Received request for delete confirmation for profile ID: ${profileId}`);
        if (!profileId) {
            logger.warn("[LoginWebView] No profileId provided for delete confirmation.");
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: "Cannot delete: Profile ID missing."
            });
            return;
        }

        const profileToDelete = (await profileManager.getProfiles(this.extensionContext)).find(
            (p) => p.id === profileId
        );
        if (!profileToDelete) {
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Profile not found for deletion.`
            });
            return;
        }

        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the profile "${profileToDelete.label}"?`,
            { modal: true }, // Makes the dialog modal
            "Delete", // Confirmation option
            "Cancel" // Cancellation option
        );

        if (confirmation === "Delete") {
            logger.info(`[LoginWebView] User confirmed deletion for profile ID: ${profileId}. Proceeding with delete.`);
            // Now call the actual delete handler
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
     * @param command The command to send to the webview.
     * @param payload The data to send with the command.
     */
    private postMessageToWebview(command: string, payload: any): void {
        if (this.currentWebview) {
            this.currentWebview.webview.postMessage({ command, payload });
        }
    }

    /**
     * Asynchronously fetches user profiles and sends them to the webview.
     * If successful, it posts the profiles for display.
     * If an error occurs, it logs the error and posts an error message to the webview.
     */
    private async sendProfilesToWebview(): Promise<void> {
        try {
            const profiles = await profileManager.getProfiles(this.extensionContext);
            this.postMessageToWebview(WebviewMessageCommands.DISPLAY_PROFILES_IN_WEBVIEW, profiles);
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
     * @param profileId The ID of the profile to use for login.
     * @returns A promise that resolves when the login attempt is complete.
     */
    private async handleLoginWithProfile(profileId: string): Promise<void> {
        logger.info(`[LoginWebView] Attempting login with profile ID: ${profileId}`);
        try {
            const profiles = await profileManager.getProfiles(this.extensionContext);
            const selectedProfile = profiles.find((p) => p.id === profileId);

            if (!selectedProfile) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: `Profile with ID ${profileId} not found.`
                });
                return;
            }

            // Set active profile ID before calling getSession
            await profileManager.setActiveProfileId(this.extensionContext, selectedProfile.id);

            // Trigger VS Code's authentication flow.
            const session = await vscode.authentication.getSession(
                TESTBENCH_AUTH_PROVIDER_ID,
                ["api_access"], // scopes
                { createIfNone: true } // This will trigger createSession
            );

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
            await profileManager.clearActiveProfile(this.extensionContext); // Clear if login fails
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
            await this.sendProfilesToWebview(); // Refresh list
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
     * @param profileId The ID of the profile to delete.
     * @returns A promise that resolves when the deletion process is complete.
     */
    private async handleDeleteProfile(profileId: string): Promise<void> {
        logger.info(`[LoginWebView] Attempting to delete profile ID: ${profileId}`);
        try {
            const profileToDelete = (await profileManager.getProfiles(this.extensionContext)).find(
                (p) => p.id === profileId
            );
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
            await this.sendProfilesToWebview(); // Refresh list
        } catch (error: any) {
            logger.error(`[LoginWebView] Error deleting profile ${profileId}:`, error);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Error deleting profile: ${error.message}`
            });
        }
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
                // Generate the new Profile Management UI
                this.currentWebview.webview.html = this.getProfileManagementHtmlPage(this.currentWebview.webview);
                // After setting HTML, if webview is visible and not signed in, tell it to load profiles
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
        return webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", iconName)
        );
    }

    /**
     * Generates the HTML content for the profile management webview.
     * This includes the UI for displaying, adding, and managing connection profiles.
     *
     * @param webview The VS Code webview instance to which this HTML will be rendered.
     *                Used to generate Content Security Policy nonces and URIs.
     * @returns A string containing the complete HTML for the profile management page.
     */
    private getProfileManagementHtmlPage(webview: vscode.Webview): string {
        const nonce = getNonce();
        const cspSource = webview.cspSource;
        const contentSecurityPolicy = `
            default-src 'none';
            img-src ${cspSource} https: data:;
            script-src 'nonce-${nonce}';
            style-src ${cspSource} 'unsafe-inline' 'self'; 
            font-src ${cspSource};
        `;

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
    padding: 15px; /* Increased padding */
    display: flex;
    flex-direction: column;
    height: 100vh;
    box-sizing: border-box;
    gap: 20px; /* Adds space between major sections */
}

/* Improved section styling */
.profile-section, .add-profile-section {
    padding: 15px; /* Increased padding */
    border: 1px solid var(--vscode-settings-dropdownBorder, var(--vscode-contrastBorder));
    border-radius: 6px; /* Slightly more rounded corners */
    background-color: var(--vscode-list-inactiveSelectionBackground); /* Subtle background */
}

h2, h3 {
    color: var(--vscode-settings-headerForeground);
    margin-top: 0;
    margin-bottom: 15px; /* Increased bottom margin */
    padding-bottom: 8px; /* Increased padding */
    border-bottom: 1px solid var(--vscode-focusBorder, var(--vscode-settings-dropdownBorder)); /* Use focusBorder for more emphasis */
    font-weight: 600; /* Slightly bolder headers */
}

/* For the "Available Profiles" header */
.profile-section h2::before {
    content: "👤 "; /* Example: Unicode icon for profiles */
    margin-right: 8px;
}

/* For the "Add New Profile" header */
.add-profile-section h3::before {
    content: "➕ "; /* Example: Unicode icon for add */
    margin-right: 8px;
}


ul#profilesList {
    list-style: none;
    padding: 0;
    max-height: 250px; /* Adjusted height */
    overflow-y: auto;
    border: 1px solid var(--vscode-input-border, var(--vscode-settings-textInputBorder));
    border-radius: 4px;
}

ul#profilesList li {
    padding: 10px 12px; /* Increased padding */
    margin-bottom: -1px; /* Allow borders to collapse nicely */
    border-bottom: 1px solid var(--vscode-input-border, var(--vscode-settings-textInputBorder));
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: var(--vscode-list-hoverBackground);
    transition: background-color 0.2s ease-in-out; /* Smooth hover */
}
ul#profilesList li:last-child {
    border-bottom: none; /* No border for the last item */
}
ul#profilesList li:hover {
    background-color: var(--vscode-list-focusBackground); /* More prominent hover */
}


ul#profilesList li .profile-details {
    flex-grow: 1;
    margin-right: 10px; /* Space before action buttons */
}

ul#profilesList li .profile-label {
    font-weight: bold;
    color: var(--vscode-list-activeSelectionForeground); /* More prominent label color */
    font-size: 1.05em; /* Slightly larger label */
}

ul#profilesList li .profile-info {
    font-size: 0.9em;
    color: var(--vscode-descriptionForeground);
    margin-top: 3px; /* Space below label */
}

.profile-actions { /* Container for buttons in list item */
    display: flex;
    gap: 8px; /* Space between buttons */
}

.profile-actions button {
    padding: 5px 10px; /* Adjusted padding */
    font-size: 0.9em;
    display: inline-flex; /* For icon alignment */
    align-items: center;
    gap: 5px; /* Space between icon and text */
}

button { /* General button styling */
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder)); /* Ensure border */
    padding: 8px 15px; /* Increased padding */
    cursor: pointer;
    border-radius: 4px; /* Consistent rounded corners */
    font-weight: 500; /* Slightly bolder text */
    transition: background-color 0.2s ease-in-out, border-color 0.2s ease-in-out;
}
button:hover {
    background-color: var(--vscode-button-hoverBackground);
    border-color: var(--vscode-focusBorder); /* Highlight border on hover */
}
button:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
}

/* Specific styling for primary action (Save Profile) */
#saveProfileBtn {
    background-color: var(--vscode-button-primaryBackground, var(--vscode-button-background)); /* VSCode 1.88+ */
    color: var(--vscode-button-primaryForeground, var(--vscode-button-foreground));
}
#saveProfileBtn:hover {
    background-color: var(--vscode-button-primaryHoverBackground, var(--vscode-button-hoverBackground));
}
#saveProfileBtn::before {
    content: "💾 "; /* Example: Save icon */
    /* font-family: 'Codicon'; For actual Codicons */
    /* content: '\\ea78'; */
}


/* Login button in profile list */
.login-btn {
    background-color: var(--vscode-button-primaryBackground, var(--vscode-button-background));
    color: var(--vscode-button-primaryForeground, var(--vscode-button-foreground));
}
.login-btn:hover {
    background-color: var(--vscode-button-primaryHoverBackground, var(--vscode-button-hoverBackground));
}
.login-btn::before {
    content: "➡️ "; /* Example: Login icon */
}

/* Delete button styling */
button.delete-btn {
    background-color: var(--vscode-button-secondaryBackground, var(--vscode-errorForeground)); /* Secondary or error */
    color: var(--vscode-button-secondaryForeground, white);
    border-color: var(--vscode-button-secondaryBackground, var(--vscode-errorForeground));
}
button.delete-btn:hover {
    background-color: var(--vscode-errorForeground);
    opacity: 0.8;
}
button.delete-btn::before {
    content: "🗑️ "; /* Example: Delete icon */
}

.form-group {
    margin-bottom: 15px; /* Increased spacing */
}

.form-group label {
    display: block;
    margin-bottom: 5px; /* Increased spacing */
    font-size: 0.95em;
    font-weight: 500; /* Slightly bolder labels */
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group input[type="password"] {
    width: calc(100% - 12px); /* padding compensation */
    padding: 8px 6px; /* Adjusted padding */
    border-radius: 3px;
    border: 1px solid var(--vscode-input-border, var(--vscode-settings-textInputBorder));
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
}
.form-group input[type="text"]:focus,
.form-group input[type="number"]:focus,
.form-group input[type="password"]:focus {
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
}

/* Password wrapper for potential future icon */
.password-wrapper {
    position: relative;
    display: flex;
    align-items: center;
}
.password-wrapper input[type="password"] {
    flex-grow: 1;
}
.password-toggle { /* Style for a show/hide button if you add one */
    position: absolute;
    right: 8px;
    cursor: pointer;
    background: none;
    border: none;
    color: var(--vscode-icon-foreground);
}


#messages {
    margin-top: 15px;
    padding: 10px 12px; /* Increased padding */
    border-radius: 4px;
    word-break: break-word;
    font-size: 0.95em;
    display: flex; /* For icon alignment */
    align-items: center;
    gap: 8px; /* Space between icon and text */
}
#messages.hidden { /* To hide message area when empty */
    display: none;
}

.message-info {
    background-color: var(--vscode-statusBarItem-remoteBackground);
    color: var(--vscode-statusBarItem-remoteForeground);
    border: 1px solid var(--vscode-statusBarItem-remoteBackground);
}
.message-info::before {
    content: "ℹ️ ";
}

.message-success {
    background-color: var(--vscode-terminal-ansiGreen); /* Or a more subtle green */
    color: var(--vscode-input-foreground); /* Or white if contrast is better */
    border: 1px solid var(--vscode-terminal-ansiGreen);
}
.message-success::before {
    content: "✅ ";
}

.message-error {
    background-color: var(--vscode-inputValidation-errorBackground, var(--vscode-errorForeground));
    color: var(--vscode-inputValidation-errorForeground, white);
    border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
}
.message-error::before {
    content: "❌ ";
}


.scrollable-content {
    flex-grow: 1;
    overflow-y: auto;
    padding-right: 5px; /* Space for scrollbar if it appears */
}

/* Empty state for profile list */
#noProfilesMessage {
    padding: 15px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    border: 1px dashed var(--vscode-input-border);
    border-radius: 4px;
}
#noProfilesMessage::before {
    content: "📂 ";
    display: block;
    font-size: 1.5em;
    margin-bottom: 5px;
}
    </style>
</head>
<body>
    <div class="scrollable-content">
    <section class="profile-section" aria-labelledby="profilesHeading">
        <h2 id="profilesHeading">Available Profiles</h2>
        <ul id="profilesList" aria-live="polite">
            </ul>
        <p id="noProfilesMessage" style="display: none;">No profiles configured yet.<br>Use the form below to add one.</p>
    </section>

    <section class="add-profile-section" aria-labelledby="addProfileHeading">
        <h3 id="addProfileHeading">Add New Profile</h3>
        <form id="addProfileForm">
            <div class="form-group">
                <label for="profileLabel">Profile Label (e.g., "My Dev Server")</label>
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
                    <input type="password" id="password" name="password" placeholder="Enter password (stored securely)">
                    </div>
                <small style="color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 4px; display: block;">Password will be stored securely in VS Code's Secret Storage.</small>
            </div>
            <button type="button" id="saveProfileBtn">Save New Profile</button>
        </form>
    </section>
</div>
<div id="messages" class="hidden" role="alert" aria-live="assertive"></div>

    <script nonce="${nonce}">
        (function() {
            const vscode = acquireVsCodeApi();
            const profilesListEl = document.getElementById('profilesList');
            const noProfilesMessageEl = document.getElementById('noProfilesMessage');
            const messagesEl = document.getElementById('messages');

            // Form elements
            const profileLabelInput = document.getElementById('profileLabel');
            const serverNameInput = document.getElementById('serverName');
            const portNumberInput = document.getElementById('portNumber');
            const usernameInput = document.getElementById('username');
            const passwordInput = document.getElementById('password');
            const saveProfileBtn = document.getElementById('saveProfileBtn');
            const addProfileForm = document.getElementById('addProfileForm');

            // Ensure elements exist before adding listeners
            if (!profilesListEl || !saveProfileBtn || !noProfilesMessageEl || !messagesEl || !addProfileForm) {
                console.error('[WebviewScript] Critical UI elements not found. Aborting script setup.');
                return;
            }

            function displayMessage(type, text) {
                messagesEl.textContent = text;
                messagesEl.className = 'message-' + type; // e.g., 'message-success'
                messagesEl.classList.remove('hidden'); // Make it visible
                messagesEl.setAttribute('role', type === 'error' ? 'alert' : 'status');

                // Clear message after a delay, but not for errors, or make errors clearable
                if (type !== 'error') {
                    setTimeout(() => {
                        messagesEl.textContent = '';
                        messagesEl.className = '';
                        messagesEl.classList.add('hidden');
                    }, 7000); // Slightly longer display
                } else {
                    // Optionally add a close button for errors
                    // For now, errors will persist until a new message or page reload
                }
            }

            function renderProfiles(profiles) {
                profilesListEl.innerHTML = ''; // Clear existing
                if (!profiles || profiles.length === 0) {
                    noProfilesMessageEl.style.display = 'block';
                    return;
                }
                noProfilesMessageEl.style.display = 'none';
                profiles.forEach(profile => {
                    const li = document.createElement('li');
                    li.setAttribute('tabindex', '0'); // Make list items focusable
                    li.setAttribute('aria-label', \`Profile: \${profile.label}, user \${profile.username} at \${profile.serverName}\`);

                    li.innerHTML = \`
                        <div class="profile-details">
                            <div class="profile-label">\${profile.label}</div>
                            <div class="profile-info">\${profile.username}@\${profile.serverName}:\${profile.portNumber}</div>
                        </div>
                        <div class="profile-actions">
                            <button class="login-btn" data-profile-id="\${profile.id}" aria-label="Login with profile \${profile.label}">Login</button>
                            <button class="delete-btn" data-profile-id="\${profile.id}" aria-label="Delete profile \${profile.label}">Delete</button>
                        </div>
                    \`;
                    profilesListEl.appendChild(li);
                });
            }

            // Event listeners for profile actions (profile list clicks)
            profilesListEl.addEventListener('click', function(event) {
                const targetButton = event.target.closest('button');

                if (targetButton) {
                    const profileId = targetButton.dataset.profileId;
                    if (targetButton.classList.contains('login-btn')) {
                        vscode.postMessage({ command: '${WebviewMessageCommands.LOGIN_WITH_PROFILE}', payload: { profileId } });
                    } else if (targetButton.classList.contains('delete-btn')) {
                        vscode.postMessage({ command: '${WebviewMessageCommands.REQUEST_DELETE_CONFIRMATION}', payload: { profileId } });
                    }
                }
            });

            // Event listener for saving new profile
            saveProfileBtn.addEventListener('click', function() {
                // Basic validation
                if (!serverNameInput.value.trim() || !portNumberInput.value.trim() || !usernameInput.value.trim()) {
                    displayMessage('error', 'Server, Port, and Username are required fields.');
                    // Focus the first empty required field
                    if (!serverNameInput.value.trim()) serverNameInput.focus();
                    else if (!portNumberInput.value.trim()) portNumberInput.focus();
                    else if (!usernameInput.value.trim()) usernameInput.focus();
                    return;
                }
                if (isNaN(parseInt(portNumberInput.value, 10))) {
                    displayMessage('error', 'Port must be a valid number.');
                    portNumberInput.focus();
                    return;
                }

                const payload = {
                    label: profileLabelInput.value.trim() || \`\${usernameInput.value.trim()}@\${serverNameInput.value.trim()}\`, // Auto-generate label if empty
                    serverName: serverNameInput.value.trim(),
                    portNumber: parseInt(portNumberInput.value, 10),
                    username: usernameInput.value.trim(),
                    password: passwordInput.value // Password can be empty, handled by auth provider
                };

                // Disable button during processing
                saveProfileBtn.disabled = true;
                saveProfileBtn.textContent = 'Saving...';

                vscode.postMessage({ command: '${WebviewMessageCommands.SAVE_NEW_PROFILE}', payload });
                // Password field is cleared, and button re-enabled via message from extension (PROFILE_OPERATION_COMPLETE or similar)
                // or after a timeout if direct feedback isn't implemented for this action.
                // For now, we'll clear and re-enable manually, but this is better handled by response from extension.
                setTimeout(() => { // Simulating processing delay and re-enabling
                    passwordInput.value = ''; // Clear password after attempt
                    // addProfileForm.reset(); // Optionally reset the whole form, but might not be desired if save fails.
                    saveProfileBtn.disabled = false;
                    saveProfileBtn.innerHTML = 'Save New Profile'; // Restore original text (including icon if it was HTML)
                    // If using textContent and icon was via ::before, it's simpler: saveProfileBtn.textContent = 'Save New Profile';
                }, 1000); // Adjust timing or remove if extension sends feedback

            });
            
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
                         // If profile operation was completed, re-enable save button
                        if (message.payload.operation === 'saveProfile' || message.payload.operation === 'deleteProfile') {
                            saveProfileBtn.disabled = false;
                            saveProfileBtn.innerHTML = 'Save New Profile'; // Reset text/icon
                        }
                        break;                   
                }
            });

            // Initial load: Tell the extension the UI is ready
            console.log('[WebviewScript] Requesting initial profiles via PROFILE_UI_LOADED.');
            vscode.postMessage({ command: '${WebviewMessageCommands.PROFILE_UI_LOADED}' });
            // Initially hide messages area
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
     * @param webview The VS Code webview instance to which the HTML will be rendered.
     * @returns A string containing the HTML markup for the "already logged in" page.
     */
    private getAlreadyLoggedInHtmlPage(webview: vscode.Webview): string {
        const imageUri = this.createIconUri(webview, "iTB-EE-Logo-256x256.png");
        const nonce = getNonce();
        const cspSource = webview.cspSource;
        const contentSecurityPolicy = `default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource};`;

        // Attempt to get current connection details for display
        const currentConnection = connection; // from './extension'
        let connectedAsInfo = "You are connected to TestBench.";
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
            background-color: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
            text-align: center;
        }
        .container { display: flex; flex-direction: column; align-items: center; }
        img { width: 48px; height: 48px; margin-bottom: 15px; }
        p { color: var(--vscode-descriptionForeground); }
    </style>
</head>
<body>
    <div class="container">
        ${imageUri ? `<img src="${imageUri}" alt="TestBench Logo">` : ""}
       <p class="connection-info">${connectedAsInfo}</p>
        <p class="info-text">Use the TestBench views in the explorer or run TestBench commands via the command palette.</p>
        <button id="logoutButton">Sign Out</button>
    </div>
    <script nonce="${nonce}">
        (function() {
            const vscode = acquireVsCodeApi();
            const logoutButton = document.getElementById('logoutButton');
            if (logoutButton) {
                logoutButton.addEventListener('click', () => {
                    console.log("Sign Out button clicked.");
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
 * @returns A 32-character random string.
 */
function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
