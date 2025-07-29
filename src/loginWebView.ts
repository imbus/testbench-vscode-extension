/**
 * @file loginWebView.ts
 * @description Provides the login webview for the TestBench extension. This webview enables the user to enter
 * login credentials and triggers the login process using a HTML form.
 */

import * as vscode from "vscode";
import { logger, connection } from "./extension";
import { WebviewMessageCommands, allExtensionCommands } from "./constants";
import * as connectionManager from "./connectionManager";
import { TestBenchConnection } from "./testBenchTypes";
import { TESTBENCH_AUTH_PROVIDER_ID } from "./testBenchAuthenticationProvider";
import { PlayServerConnection } from "./testBenchConnection";

interface EditingConnectionData extends TestBenchConnection {
    password?: string;
}

/**
 * The provider for the login webview.
 */
export class LoginWebViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId: string = "testbenchExtension.webView";
    private currentWebview?: vscode.WebviewView;
    private _messageListenerDisposable: vscode.Disposable | undefined;
    private editingConnectionId: string | null = null;

    /**
     * Constructs a new LoginWebViewProvider.
     * @param {vscode.ExtensionContext} extensionContext The extension context.
     */
    constructor(private extensionContext: vscode.ExtensionContext) {
        logger.debug("[loginWebView] LoginWebViewProvider initialized.");
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
        logger.trace("[loginWebView] Resolving login webview view.");
        this.currentWebview = webviewView;

        if (this._messageListenerDisposable) {
            this._messageListenerDisposable.dispose();
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
            logger.trace(`[loginWebView] Received message from webview: ${message.command}`);
            switch (message.command) {
                case WebviewMessageCommands.CONNECTION_UI_LOADED:
                    await this.sendConnectionToWebview();
                    break;
                case WebviewMessageCommands.LOGIN_WITH_CONNECTION:
                    await this.handleLoginWithConnection(message.payload.connectionId);
                    break;
                case WebviewMessageCommands.SAVE_NEW_CONNECTION:
                    await this.handleSaveNewConnection(message.payload);
                    break;
                case WebviewMessageCommands.REQUEST_DELETE_CONFIRMATION:
                    await this.handleRequestDeleteConfirmation(message.payload.connectionId);
                    break;
                case WebviewMessageCommands.LOGIN:
                    logger.debug('[loginWebView] "Sign In" button clicked. Triggering TestBench login command.');
                    vscode.commands.executeCommand(allExtensionCommands.login).then(undefined, (err) => {
                        logger.error("[loginWebView] Error executing login command:", err);
                        this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                            type: "error",
                            text: "Could not start TestBench login process."
                        });
                    });
                    break;
                case WebviewMessageCommands.TRIGGER_COMMAND:
                    if (message.payload && message.payload.commandId) {
                        logger.debug(
                            `[loginWebView] Webview requested to trigger command: ${message.payload.commandId}`
                        );
                        vscode.commands.executeCommand(message.payload.commandId).then(undefined, (err) => {
                            logger.error(
                                `[loginWebView] Error executing command '${message.payload.commandId}' from webview:`,
                                err
                            );
                            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                                type: "error",
                                text: `Could not execute command: ${message.payload.commandId}`
                            });
                        });
                    }
                    break;
                case WebviewMessageCommands.EDIT_CONNECTION:
                    await this.handleEditConnection(message.payload.connectionId);
                    break;
                case WebviewMessageCommands.UPDATE_CONNECTION:
                    await this.handleUpdateConnection(message.payload);
                    break;
                case WebviewMessageCommands.CANCEL_EDIT_CONNECTION:
                    await this.handleCancelEditConnection();
                    break;
                default:
                    logger.warn(`[loginWebView] Unknown command from webview: ${message.command}`);
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
            },
            null,
            this.extensionContext?.subscriptions
        );
    }

    /**
     * Handles the request to confirm the deletion of a user connection.
     * It prompts the user with a confirmation dialog before proceeding with the deletion.
     *
     * @param {string} connectionId - The ID of the connection to be considered for deletion.
     * @returns A promise that resolves when the confirmation process is complete.
     */
    private async handleRequestDeleteConfirmation(connectionId: string): Promise<void> {
        // Prevent deletion of connection currently being edited
        if (this.editingConnectionId === connectionId) {
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "warning",
                text: "Cannot delete connection while editing it. Please save or cancel your changes first."
            });
            return;
        }

        if (!connectionId) {
            logger.warn("[loginWebView] No connection ID provided for delete confirmation.");
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: "Cannot delete: Connection ID missing."
            });
            return;
        }

        const connectionToDelete: connectionManager.TestBenchConnection | undefined = (
            await connectionManager.getConnections(this.extensionContext)
        ).find((p) => p.id === connectionId);
        if (!connectionToDelete) {
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Connection not found for deletion.`
            });
            return;
        }

        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the connection "${connectionToDelete.label}"?`,
            { modal: true },
            "Delete",
            "No"
        );

        if (confirmation === "Delete") {
            logger.debug(
                `[loginWebView] User confirmed deletion for connection ID: ${connectionId}. Proceeding with deletion.`
            );
            await this.handleDeleteConnection(connectionId);
        } else {
            logger.debug(`[loginWebView] User cancelled deletion for connection ID: ${connectionId}.`);
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
     * Asynchronously fetches user connections them to the webview sorted alphabetically by label.
     * Send the editing state to the webview if a connection edited.
     * If successful, it posts the connections for display.
     * If an error occurs, it logs the error and posts an error message to the webview.
     */
    private async sendConnectionToWebview(): Promise<void> {
        try {
            const connections: connectionManager.TestBenchConnection[] = await connectionManager.getConnections(
                this.extensionContext
            );
            const sortedConnections = connections.sort((a, b) =>
                a.label.toLowerCase().localeCompare(b.label.toLowerCase())
            );

            this.postMessageToWebview(WebviewMessageCommands.DISPLAY_CONNECTIONS_IN_WEBVIEW, {
                connections: sortedConnections,
                editingConnectionId: this.editingConnectionId
            });
        } catch (error: any) {
            logger.error("[loginWebView] Error fetching connections for webview:", error);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: "Error loading connections."
            });
        }
    }

    /**
     * Handles the login process using a specified connection ID.
     * It retrieves the connection, sets it as active, and then initiates
     * the VS Code authentication flow.
     *
     * @param {string} connectionId The ID of the connection to use for login.
     * @returns A promise that resolves when the login attempt is complete.
     */
    private async handleLoginWithConnection(connectionId: string): Promise<void> {
        logger.debug(`[loginWebView] Attempting login with connection ID: ${connectionId}`);
        try {
            const connections: connectionManager.TestBenchConnection[] = await connectionManager.getConnections(
                this.extensionContext
            );
            const selectedConnection: connectionManager.TestBenchConnection | undefined = connections.find(
                (p) => p.id === connectionId
            );

            if (!selectedConnection) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: `Connection with ID ${connectionId} not found.`
                });
                return;
            }

            await connectionManager.setActiveConnectionId(this.extensionContext, selectedConnection.id);

            const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                createIfNone: true
            });

            if (session) {
                logger.info(`[loginWebView] Login successful via provider for connection: ${selectedConnection.label}`);
            } else {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: "TestBench Login Failed."
                });
            }
        } catch (error: any) {
            logger.error(`[loginWebView] Login failed for connection ${connectionId}:`, error);
            await connectionManager.clearActiveConnection(this.extensionContext);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Login Error: ${error.message}`
            });
        }
    }

    /**
     * Handles the saving of a new user connection.
     * It validates the necessary connection data, attempts to save it,
     * and then sends a status message (success or error) back to the webview.
     * If successful, it also refreshes the list of connections in the webview.
     *
     * @param connectionData - An object containing the details of the new connection to be saved.
     *                      This includes server name, port number, username, and an optional password and label.
     *                      The 'id' property is omitted as it will be generated upon saving.
     * @returns A promise that resolves when the save operation (including webview updates) is complete.
     */
    private async handleSaveNewConnection(
        connectionData: Omit<TestBenchConnection, "id"> & { password?: string }
    ): Promise<void> {
        logger.debug(`[loginWebView] Attempting to save new connection: ${connectionData.label || "No Label"}`);
        try {
            if (!connectionData.serverName || !connectionData.portNumber || !connectionData.username) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: "Server, Port, and Username are required."
                });
                return;
            }

            // Check for duplicate label
            if (connectionData.label && connectionData.label.trim()) {
                const existingConnectionByLabel: connectionManager.TestBenchConnection | undefined =
                    await connectionManager.findConnectionByLabel(this.extensionContext, connectionData.label.trim());

                if (existingConnectionByLabel) {
                    this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                        type: "warning",
                        text: `A connection with the label "${connectionData.label}" already exists. Connection labels must be unique.`
                    });
                    logger.warn(
                        `[loginWebView] Attempt to save connection with duplicate label prevented: ${connectionData.label}`
                    );
                    return;
                }
            }

            // Don't include password check when comparing existing connections
            const existingConnection: connectionManager.TestBenchConnection | undefined =
                await connectionManager.findConnectionByCredentials(
                    this.extensionContext,
                    connectionData.serverName,
                    connectionData.portNumber,
                    connectionData.username
                );

            if (existingConnection) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "warning",
                    text: `A connection with the same server, port, and username already exists: "${existingConnection.label}". Not saving duplicate.`
                });
                logger.warn(
                    `[loginWebView] Attempt to save duplicate connection (server/user match) prevented for: ${existingConnection.label}`
                );
                return;
            }

            const newConnectionId = await connectionManager.saveConnection(
                this.extensionContext,
                connectionData,
                connectionData.password
            );
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "success",
                text: `Connection "${connectionData.label || newConnectionId}" saved.`
            });
            await this.sendConnectionToWebview();
        } catch (error: any) {
            logger.error("[loginWebView] Error saving new connection:", error);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Error saving connection: ${error.message}`
            });
        }
    }

    /**
     * Handles the deletion of a user connection.
     * It attempts to find and delete a connection based on the provided ID.
     * Sends success or error messages to the webview and refreshes the connection list upon successful deletion.
     *
     * @param {string} connectionId The ID of the connection to delete.
     * @returns A promise that resolves when the deletion process is complete.
     */
    private async handleDeleteConnection(connectionId: string): Promise<void> {
        logger.debug(`[loginWebView] Attempting to delete connection ID: ${connectionId}`);
        try {
            const connectionToDelete: connectionManager.TestBenchConnection | undefined = (
                await connectionManager.getConnections(this.extensionContext)
            ).find((p) => p.id === connectionId);
            if (!connectionToDelete) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: `Connection not found for deletion.`
                });
                return;
            }

            await connectionManager.deleteConnection(this.extensionContext, connectionId);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "success",
                text: `Connection "${connectionToDelete.label}" deleted.`
            });
            await this.sendConnectionToWebview();
        } catch (error: any) {
            logger.error(`[loginWebView] Error deleting connection ${connectionId}:`, error);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Error deleting connection: ${error.message}`
            });
        }
    }

    /**
     * Handles entering edit mode for a specific connection.
     * Loads the connection data into the form and switches the UI to edit mode.
     *
     * @param {string} connectionId - The ID of the connection to edit.
     * @returns A promise that resolves when the edit mode is set up.
     */
    private async handleEditConnection(connectionId: string): Promise<void> {
        try {
            const connections: connectionManager.TestBenchConnection[] = await connectionManager.getConnections(
                this.extensionContext
            );
            const connectionToEdit: connectionManager.TestBenchConnection | undefined = connections.find(
                (p) => p.id === connectionId
            );

            if (!connectionToEdit) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: `Connection not found for editing.`
                });
                return;
            }

            const storedPassword = await connectionManager.getPasswordForConnection(
                this.extensionContext,
                connectionId
            );
            this.editingConnectionId = connectionId;

            // Send edit mode data and refresh connections to update UI state
            this.postMessageToWebview("enterEditMode", {
                connection: connectionToEdit,
                hasStoredPassword: !!storedPassword
            });

            // Refresh connections to disable delete button for the editing connection
            await this.sendConnectionToWebview();

            logger.debug(`[loginWebView] Edit mode activated for connection: ${connectionToEdit.label}`);
        } catch (error: any) {
            logger.error(`[loginWebView] Error entering edit mode for connection ${connectionId}:`, error);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Error loading connection for editing: ${error.message}`
            });
        }
    }

    /**
     * Handles updating an existing connection with new data.
     * Validates the data and saves the updated connection.
     *
     * @param payload - An object containing the updated connection data including the connection ID.
     * @returns A promise that resolves when the update operation is complete.
     */
    private async handleUpdateConnection(payload: EditingConnectionData): Promise<void> {
        logger.info(`[loginWebView] Attempting to update connection: ${payload.label || payload.id}`);

        try {
            if (!payload.id || !payload.serverName || !payload.portNumber || !payload.username) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: "Connection ID, Server, Port, and Username are required."
                });
                return;
            }

            // Check for duplicate label (excluding the current connection being edited)
            if (payload.label && payload.label.trim()) {
                const existingConnectionByLabel: connectionManager.TestBenchConnection | undefined =
                    await connectionManager.findConnectionByLabel(
                        this.extensionContext,
                        payload.label.trim(),
                        payload.id
                    );

                if (existingConnectionByLabel) {
                    this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                        type: "warning",
                        text: `Another connection with the label "${payload.label}" already exists. Connection labels must be unique.`
                    });
                    logger.warn(
                        `[loginWebView] Attempt to update to duplicate label prevented. Existing connection: ${existingConnectionByLabel.label}`
                    );
                    return;
                }
            }

            // Check if another connection already exists with the same server/port/username combination
            // (excluding the current connection being edited)
            const existingConnection: connectionManager.TestBenchConnection | undefined =
                await connectionManager.findConnectionByCredentials(
                    this.extensionContext,
                    payload.serverName,
                    payload.portNumber,
                    payload.username
                );

            if (existingConnection && existingConnection.id !== payload.id) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "warning",
                    text: `Another connection with the same server, port, and username already exists: "${existingConnection.label}". Cannot save duplicate.`
                });
                logger.warn(
                    `[loginWebView] Attempt to update to duplicate connection credentials prevented. Existing connection: ${existingConnection.label}`
                );
                return;
            }

            // Show confirmation dialog after validations
            const connections: connectionManager.TestBenchConnection[] = await connectionManager.getConnections(
                this.extensionContext
            );
            const originalUneditedConnection: connectionManager.TestBenchConnection | undefined = connections.find(
                (p) => p.id === payload.id
            );
            const originalUneditedLabel = originalUneditedConnection?.label || payload.id;

            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to overwrite the connection "${originalUneditedLabel}"?`,
                { modal: true },
                "Save Changes",
                "No"
            );

            if (confirmation !== "Save Changes") {
                logger.debug(`[loginWebView] User cancelled update for connection: ${payload.label}`);
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "info",
                    text: "Connection update cancelled."
                });
                return;
            }

            await connectionManager.saveConnection(this.extensionContext, payload, payload.password);

            this.editingConnectionId = null;
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "success",
                text: `Connection "${payload.label}" updated successfully.`
            });

            this.postMessageToWebview("exitEditMode", {});
            await this.sendConnectionToWebview();
        } catch (error: any) {
            logger.error("[loginWebView] Error updating connection:", error);
            this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                type: "error",
                text: `Error updating connection: ${error.message}`
            });
        }
    }
    /**
     * Handles cancelling the edit operation.
     * Clears the editing state and resets the form.
     *
     * @returns A promise that resolves when the cancel operation is complete.
     */
    private async handleCancelEditConnection(): Promise<void> {
        logger.trace(`[loginWebView] Cancelling edit mode for connection ID: ${this.editingConnectionId}`);
        this.editingConnectionId = null;

        this.postMessageToWebview("exitEditMode", {});
        this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
            type: "info",
            text: "Edit cancelled."
        });

        // Refresh connections to re-enable delete button
        await this.sendConnectionToWebview();

        logger.debug("[loginWebView] Edit mode cancelled and form reset.");
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
                this.currentWebview.webview.html = this.getConnectionManagementHtmlPage(this.currentWebview.webview);
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
            logger.error("[loginWebView] Extension context is undefined. Cannot create icon URI.");
            return null;
        }
        const iconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", iconName)
        );
        return iconUri;
    }

    /**
     * Generates the HTML content for the connection management webview.
     * This includes the UI for displaying, adding, and managing connection connections.
     *
     * @param {vscode.Webview} webview The VS Code webview instance to which this HTML will be rendered.
     *                Used to generate Content Security Policy nonces and URIs.
     * @returns {string} A string containing the complete HTML for the connection management page.
     */
    private getConnectionManagementHtmlPage(webview: vscode.Webview): string {
        const nonce: string = getNonce();
        const cspSource: string = webview.cspSource;
        const contentSecurityPolicy: string = `
        default-src 'none';
        img-src ${cspSource} https: data:;
        script-src 'nonce-${nonce}';
        style-src ${cspSource} 'unsafe-inline' 'self'; 
        font-src ${cspSource};
    `;

        const connectionsHeaderIconDarkUri = this.createIconUri(webview, "connections-dark.svg");
        const connectionsHeaderIconLightUri = this.createIconUri(webview, "connections-light.svg");
        const addConnectionHeaderIconDarkUri = this.createIconUri(webview, "add-dark.svg");
        const addConnectionHeaderIconLightUri = this.createIconUri(webview, "add-light.svg");
        const editConnectionHeaderIconDarkUri = this.createIconUri(webview, "edit-connection-dark.svg");
        const editConnectionHeaderIconLightUri = this.createIconUri(webview, "edit-connection-light.svg");
        const saveConnectionButtonIconDarkUri = this.createIconUri(webview, "save-dark.svg");
        const saveConnectionButtonIconLightUri = this.createIconUri(webview, "save-light.svg");
        const loginIconLightUri = this.createIconUri(webview, "login-webview-light.svg");
        const loginIconDarkUri = this.createIconUri(webview, "login-webview-dark.svg");
        const editIconLightUri = this.createIconUri(webview, "edit-connection-light.svg");
        const editIconDarkUri = this.createIconUri(webview, "edit-connection-dark.svg");
        const deleteIconLightUri = this.createIconUri(webview, "remove-connection-light.svg");
        const deleteIconDarkUri = this.createIconUri(webview, "remove-connection-dark.svg");

        return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8"/>
        <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>TestBench Connection Management</title>
        <style>
            /* Css custom properties */
            :root {
                /* Spacing scale */
                --spacing-xs: 4px;
                --spacing-sm: 6px;
                --spacing-md: 8px;
                --spacing-lg: 10px;
                --spacing-xl: 12px;
                --spacing-2xl: 15px;
                --spacing-3xl: 20px;
                
                /* Icon sizing */
                --icon-size: 16px;
                --icon-size-sm: 14px;
                
                /* Button sizing */
                --btn-min-size: 32px;
                --btn-min-size-sm: 28px;
                --btn-padding: 8px 15px;
                --btn-padding-sm: 6px 8px;
                --btn-padding-xs: 4px 6px;
                
                /* Border radius */
                --border-radius: 4px;
                --border-radius-sm: 3px;
                --border-radius-lg: 6px;
                
                /* Colors using CSS custom properties with fallbacks */
                --color-primary-bg: var(--vscode-button-primaryBackground, var(--vscode-button-background));
                --color-primary-fg: var(--vscode-button-primaryForeground, var(--vscode-button-foreground));
                --color-primary-hover: var(--vscode-button-primaryHoverBackground, var(--vscode-button-hoverBackground));
                
                --color-secondary-bg: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
                --color-secondary-fg: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
                --color-secondary-hover: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
                
                --color-error: var(--vscode-errorForeground);
                --color-error-fg: var(--vscode-button-primaryForeground, white);
                
                --color-border: var(--vscode-button-border, var(--vscode-contrastBorder));
                --color-focus: var(--vscode-focusBorder);
                --color-input-border: var(--vscode-input-border, var(--vscode-settings-textInputBorder));
                
                /* Theme-specific background colors */
                --bg-body: var(--vscode-side-bar-background, var(--vscode-editor-background));
                --bg-section: var(--vscode-list-inactiveSelectionBackground);
                --bg-list-hover: var(--vscode-list-hoverBackground);
                --bg-list-focus: var(--vscode-list-focusBackground);
                --bg-input: var(--vscode-input-background);
                
                /* Text colors */
                --text-primary: var(--vscode-editor-foreground);
                --text-secondary: var(--vscode-descriptionForeground);
                --text-header: var(--vscode-settings-headerForeground);
                --text-input: var(--vscode-input-foreground);
            }

            /* Theme-specific icon URLs */
            [data-vscode-theme-kind="vscode-light"],
            :root {
                --icon-connections-header: url(${connectionsHeaderIconLightUri});
                --icon-add-connection-header: url(${addConnectionHeaderIconLightUri});
                --icon-edit-connection-header: url(${editConnectionHeaderIconLightUri});
                --icon-save: url(${saveConnectionButtonIconLightUri});
                --icon-login: url(${loginIconLightUri});
                --icon-edit: url(${editIconLightUri});
                --icon-delete: url(${deleteIconLightUri});
            }

            [data-vscode-theme-kind="vscode-dark"],
            [data-vscode-theme-kind="vscode-high-contrast"] {
                --bg-body: #2d2d30;
                --icon-connections-header: url(${connectionsHeaderIconDarkUri});
                --icon-add-connection-header: url(${addConnectionHeaderIconDarkUri});
                --icon-edit-connection-header: url(${editConnectionHeaderIconDarkUri});
                --icon-save: url(${saveConnectionButtonIconDarkUri});
                --icon-login: url(${loginIconDarkUri});
                --icon-edit: url(${editIconDarkUri});
                --icon-delete: url(${deleteIconDarkUri});
            }

            [data-vscode-theme-kind="vscode-light"] {
                --bg-body: #f8f8f8;
                /* Light theme specific button colors */
                --color-secondary-bg: var(--vscode-input-background, #ffffff);
                --color-secondary-fg: var(--vscode-foreground, #000000);
                --color-border: var(--vscode-input-border, #d0d0d0);
                --bg-list-hover: var(--vscode-list-hoverBackground, #f0f0f0);
            }

            [data-vscode-theme-kind="vscode-high-contrast"] {
                --bg-body: #1e1e1e;
            }

            /* Base styles */
            body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--text-primary);
                background-color: var(--bg-body);
                padding: var(--spacing-2xl);
                display: flex;
                flex-direction: column;
                height: 100vh;
                box-sizing: border-box;
                gap: var(--spacing-3xl);
                margin: 0;
            }

            /* Layout components */
            .scrollable-content {
                flex-grow: 1;
                overflow-y: auto;
                padding-right: 5px;
            }

            .connection-section,
            .add-connection-section {
                padding: var(--spacing-2xl);
                border: 1px solid var(--vscode-settings-dropdownBorder, var(--vscode-contrastBorder));
                border-radius: var(--border-radius-lg);
                background-color: var(--bg-section);
                min-width: 0;
                overflow: hidden;
                min-height: auto;
            }

            /* Typography */
            h2, h3 {
                color: var(--text-header);
                margin: 0 0 var(--spacing-2xl) 0;
                padding-bottom: var(--spacing-md);
                border-bottom: 1px solid var(--color-focus, var(--vscode-settings-dropdownBorder));
                font-weight: 600;
                display: flex;
                align-items: center;
            }

            .form-group label,
            .connection-label {
                color: var(--text-primary) !important;
            }

            /* Icon system */
            .icon {
                width: var(--icon-size);
                height: var(--icon-size);
                margin-right: var(--spacing-md);
                background: no-repeat center / var(--icon-size);
                flex-shrink: 0;
            }

            .icon-connections-header { background-image: var(--icon-connections-header); }
            .icon-add-connection-header { background-image: var(--icon-add-connection-header); }
            .icon-edit-connection-header { background-image: var(--icon-edit-connection-header); }
            .icon-save { background-image: var(--icon-save); }
            .icon-login { background-image: var(--icon-login); }
            .icon-edit { background-image: var(--icon-edit); }
            .icon-delete { background-image: var(--icon-delete); }

            /* Remove margin for connection action icons */
            .connection-actions .icon {
                margin-right: 0;
            }

            /* Button system */
            button {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: 1px solid var(--color-border);
                padding: var(--btn-padding);
                cursor: pointer;
                border-radius: var(--border-radius);
                font-weight: 500;
                transition: background-color 0.2s ease-in-out, border-color 0.2s ease-in-out;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }

            button:hover {
                background-color: var(--vscode-button-hoverBackground);
                border-color: var(--color-focus);
            }

            button:focus {
                outline: 1px solid var(--color-focus);
                outline-offset: 2px;
            }

            button .icon {
                margin-right: var(--spacing-sm);
            }

            /* Button variants */
            #saveConnectionBtn {
                background-color: var(--color-primary-bg);
                color: var(--color-primary-fg);
                border-color: var(--color-primary-bg);
            }

            #saveConnectionBtn:hover {
                background-color: var(--color-primary-hover);
            }

            .login-btn,
            .edit-btn,
            .delete-btn,
            #cancelEditBtn {
                background-color: var(--color-secondary-bg);
                color: var(--color-secondary-fg);
                border-color: var(--color-secondary-bg);
            }

            .login-btn:hover,
            .edit-btn:hover,
            #cancelEditBtn:hover {
                background-color: var(--color-secondary-hover);
            }

            .delete-btn:hover {
                background-color: var(--color-error);
                color: var(--color-error-fg);
                border-color: var(--color-error);
                opacity: 0.8;
            }

            /* Connection list component */
            #connectionsList {
                list-style: none;
                padding: 0;
                max-height: min(60vh, 400px);
                border: 1px solid var(--color-input-border);
                border-radius: var(--border-radius);
                transition: max-height 0.2s ease-in-out;
            }

            #connectionsList li {
                box-sizing: border-box;
                padding: var(--spacing-lg) var(--spacing-xl);
                margin-bottom: -1px;
                border-bottom: 1px solid var(--color-input-border);
                display: flex;
                justify-content: space-between;
                align-items: center;
                background-color: var(--bg-list-hover);
                transition: background-color 0.2s ease-in-out;
                min-height: 60px;
                flex-wrap: nowrap;
                overflow: hidden;
                min-width: 0;
            }

            #connectionsList li:last-child {
                border-bottom: none;
            }

            #connectionsList li:hover {
                background-color: var(--bg-list-focus);
            }

            .connection-details {
                flex-grow: 1;
                flex-shrink: 1;
                margin-right: var(--spacing-lg);
                min-width: 0;
                overflow: hidden;
            }

            .connection-label {
                font-weight: bold;
                color: var(--vscode-foreground);
                font-size: 1.05em;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 100%;
            }

            .connection-info {
                font-size: 0.9em;
                color: var(--text-secondary);
                margin-top: 3px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 100%;
            }

            .connection-being-edited {
                background-color: var(--bg-list-focus);
                border-left: 3px solid var(--vscode-gitDecoration-modifiedResourceForeground, #E1C16E);
                padding-left: 9px;
            }

            .connection-being-edited:focus-within {
                outline: 2px solid var(--vscode-gitDecoration-modifiedResourceForeground);
                outline-offset: 2px;
            }

            .editing-indicator {
                font-size: 0.8em;
                color: var(--vscode-gitDecoration-modifiedResourceForeground, #E1C16E);
                font-weight: normal;
                margin-left: var(--spacing-md);
                opacity: 0.8;
            }

            /* Connection actions */
            .connection-actions {
                display: flex;
                gap: var(--spacing-sm);
                align-items: center;
                flex-shrink: 0;
                min-width: fit-content;
            }

            .connection-actions button {
                padding: var(--btn-padding-sm);
                font-size: 0.9em;
                min-width: var(--btn-min-size);
                min-height: var(--btn-min-size);
                max-width: var(--btn-min-size);
                position: relative;
            }

            .connection-actions button:disabled {
                opacity: 0.3;
                cursor: not-allowed;
                background-color: var(--color-secondary-bg);
                color: var(--text-secondary);
            }

            .connection-actions button:disabled:hover {
                background-color: var(--color-secondary-bg);
                opacity: 0.3;
            }

            .delete-btn:disabled {
                background-color: var(--color-secondary-bg);
                color: var(--text-secondary);
                border-color: var(--color-secondary-bg);
                opacity: 0.3;
            }

            /* Form component */
            .form-group {
                margin-bottom: var(--spacing-2xl);
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
                padding: var(--spacing-md) var(--spacing-sm);
                border-radius: var(--border-radius-sm);
                border: 1px solid var(--color-input-border);
                background-color: var(--bg-input);
                color: var(--text-input);
                box-sizing: border-box;
                min-width: 0;
            }

            .form-group input:focus {
                border-color: var(--color-focus);
                box-shadow: 0 0 0 1px var(--color-focus);
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
                right: var(--spacing-md);
                cursor: pointer;
                background: none;
                border: none;
                color: var(--vscode-icon-foreground);
            }

            /* Edit mode */
            .edit-mode .add-connection-section {
                border-color: var(--vscode-gitDecoration-modifiedResourceForeground);
            }

            .edit-mode .add-connection-section h3 {
                color: var(--vscode-gitDecoration-modifiedResourceForeground);
            }

            .edit-actions {
                display: flex;
                gap: var(--spacing-lg);
                margin-top: var(--spacing-lg);
                flex-wrap: wrap;
            }

            .edit-actions button {
                flex: 1;
                min-width: 120px;
            }

            /* Messages */
            #messages {
                margin-top: var(--spacing-2xl);
                padding: var(--spacing-lg) var(--spacing-xl);
                border-radius: var(--border-radius);
                word-break: break-word;
                font-size: 0.95em;
                display: flex;
                align-items: center;
                gap: var(--spacing-md);
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

            #noConnectionsMessage {
                padding: var(--spacing-2xl);
                text-align: center;
                color: var(--text-secondary);
                border: 1px dashed var(--color-input-border);
                border-radius: var(--border-radius);
                min-height: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: var(--spacing-lg) 0;
                word-wrap: break-word;
                hyphens: auto;
            }

            /* Responsive design*/
            /* Mobile-first approach with consolidated breakpoints */
            @media (max-width: 320px) {
                body {
                    padding: var(--spacing-lg);
                    gap: var(--spacing-2xl);
                }

                .connection-section,
                .add-connection-section {
                    padding: var(--spacing-xl);
                }
            }

            @media (max-width: 300px) {
                #connectionsList li {
                    padding: var(--spacing-md) var(--spacing-lg);
                }

                .connection-actions {
                    gap: var(--spacing-xs);
                }

                .connection-actions button {
                    min-width: var(--btn-min-size-sm);
                    min-height: var(--btn-min-size-sm);
                    max-width: var(--btn-min-size-sm);
                    padding: var(--btn-padding-xs);
                }

                .connection-actions button .icon {
                    width: var(--icon-size-sm);
                    height: var(--icon-size-sm);
                    background-size: var(--icon-size-sm);
                }
            }

            @media (max-width: 280px) {
                .edit-actions {
                    flex-direction: column;
                    gap: var(--spacing-md);
                }

                .edit-actions button {
                    flex: none;
                    width: 100%;
                }
            }
        </style>
    </head>
    <!-- Rest of the HTML remains exactly the same -->
    <body>
        <div class="scrollable-content">
        <section class="connection-section" aria-labelledby="connectionsHeading">
            <h2 id="connectionsHeading">
                <span class="icon icon-connections-header"></span>
                TestBench Connections
            </h2>
            <div id="connectionsLoadingMessage" style="padding: 10px; text-align: center;">
                <vscode-progress-ring></vscode-progress-ring>
                <p style="color: var(--vscode-descriptionForeground); margin-top: 5px;">Loading connections...</p>
            </div>
            <ul id="connectionsList" aria-live="polite">
            </ul>
            <p id="noConnectionsMessage" style="display: none;">No connections configured yet.<br>Use the form below to add one.</p>
        </section>

        <section class="add-connection-section" aria-labelledby="addConnectionHeading">
            <h3 id="addConnectionHeading">
                <span class="icon icon-add-connection-header"></span>
                <span id="sectionTitle">Add New Connection</span>
            </h3>
            <form id="addConnectionForm">
                <div class="form-group">
                    <label for="connectionLabel">Connection Label (e.g., "My TestBench Connection")</label>
                    <input type="text" id="connectionLabel" name="connectionLabel" placeholder="Optional, e.g., Main TestBench">
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
                    <label for="storePasswordCheckbox" style="margin-bottom: 0; font-weight: normal;">Store password for this connection</label>
                </div>
                
                <button type="button" id="saveConnectionBtn">
                    <span class="icon icon-save"></span>                
                    <span id="saveButtonText">Save New Connection</span>
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
        // JavaScript remains exactly the same
        (function() {
            const vscode = acquireVsCodeApi();
            const connectionsListEl = document.getElementById('connectionsList');
            const noConnectionsMessageEl = document.getElementById('noConnectionsMessage');
            const connectionsLoadingMessageEl = document.getElementById('connectionsLoadingMessage');
            const messagesEl = document.getElementById('messages');
            const cancelEditBtn = document.getElementById('cancelEditBtn');
            const editActionsDiv = document.getElementById('editActions');
            const sectionTitle = document.getElementById('sectionTitle');
            const sectionIcon = document.querySelector('.add-connection-section h3 .icon');
            const saveButtonText = document.getElementById('saveButtonText');

            let currentEditingConnectionId = null;
            let isEditMode = false;

            // Form elements
            const connectionLabelInput = document.getElementById('connectionLabel');
            const serverNameInput = document.getElementById('serverName');
            const portNumberInput = document.getElementById('portNumber');
            const usernameInput = document.getElementById('username');
            const passwordInput = document.getElementById('password');
            const storePasswordCheckbox = document.getElementById('storePasswordCheckbox');
            const saveConnectionBtn = document.getElementById('saveConnectionBtn');
            const addConnectionForm = document.getElementById('addConnectionForm');

            if (!connectionsListEl || !saveConnectionBtn || !noConnectionsMessageEl || !messagesEl || !addConnectionForm || !connectionsLoadingMessageEl) {
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

            function renderConnections(data) {
                let connections, editingConnectionId;
                if (Array.isArray(data)) {
                    connections = data;
                    editingConnectionId = null;
                } else {
                    connections = data.connections || [];
                    editingConnectionId = data.editingConnectionId || null;
                }

                if (connectionsLoadingMessageEl) {
                    connectionsLoadingMessageEl.style.display = 'none';
                }
                connectionsListEl.innerHTML = '';

                if (!connections || connections.length === 0) {
                    if (noConnectionsMessageEl) {
                        noConnectionsMessageEl.style.display = 'block';
                    }
                    if (connectionsListEl) {
                        connectionsListEl.style.display = 'none';
                    }
                } else {
                    if (noConnectionsMessageEl) {
                        noConnectionsMessageEl.style.display = 'none';
                    }
                    if (connectionsListEl) {
                        connectionsListEl.style.display = 'block';
                    }

                    // Sort connections alphabetically by label
                    const sortedConnections = [...connections].sort((a, b) => 
                        a.label.toLowerCase().localeCompare(b.label.toLowerCase())
                    );
                    
                    sortedConnections.forEach(connection => {
                        const li = document.createElement('li');
                        const isBeingEdited = editingConnectionId === connection.id;
                        
                        // Add visual indication for connection being edited
                        if (isBeingEdited) {
                            li.classList.add('connection-being-edited');
                        }
                        
                        li.setAttribute('tabindex', '0');
                        li.setAttribute('aria-label', \`Connection: \${connection.label}, user \${connection.username} at \${connection.serverName}\`);

                        li.innerHTML = \`
                        <div class="connection-details">
                            <div class="connection-label">
                                \${connection.label}
                                \${isBeingEdited ? '<span class="editing-indicator">(editing)</span>' : ''}
                            </div>
                            <div class="connection-info">\${connection.username}@\${connection.serverName}:\${connection.portNumber}</div>
                        </div>
                        <div class="connection-actions">
                            <button class="login-btn" data-connection-id="\${connection.id}" 
                                    aria-label="Login with connection \${connection.label}" 
                                    title="Login with this connection"
                                    \${isBeingEdited ? 'disabled' : ''}>
                                <span class="icon icon-login"></span>
                            </button>
                            <button class="edit-btn" data-connection-id="\${connection.id}" 
                                    aria-label="Edit connection \${connection.label}" 
                                    title="Edit this connection"
                                    \${isBeingEdited ? 'disabled' : ''}
                                    style="\${isBeingEdited ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                                <span class="icon icon-edit"></span>
                            </button>
                            <button class="delete-btn" data-connection-id="\${connection.id}" 
                                    aria-label="Delete connection \${connection.label}" 
                                    title="\${isBeingEdited ? 'Cannot delete while editing' : 'Delete this connection'}"
                                    \${isBeingEdited ? 'disabled' : ''}
                                    style="\${isBeingEdited ? 'opacity: 0.3; cursor: not-allowed;' : ''}">
                                <span class="icon icon-delete"></span>
                            </button>
                        </div>
                        \`;
                        connectionsListEl.appendChild(li);
                    });
                }
            }

            function enterEditMode(connection, hasStoredPassword) {
                console.log('[WebviewScript] Entering edit mode for connection:', connection);
                isEditMode = true;
                currentEditingConnectionId = connection.id;
                
                // Update UI state
                document.body.classList.add('edit-mode');
                sectionTitle.textContent = 'Edit connection';
                if (sectionIcon) {
                    sectionIcon.className = 'icon icon-edit-connection-header';
                }
                saveButtonText.textContent = 'Save Changes';
                
                // Show cancel button
                editActionsDiv.style.display = 'block';
                
                // Populate form with connection data
                connectionLabelInput.value = connection.label || '';
                serverNameInput.value = connection.serverName || '';
                portNumberInput.value = connection.portNumber || '';
                usernameInput.value = connection.username || '';
                passwordInput.value = ''; // Don't pre-fill password for security
                
                // Update checkbox state
                storePasswordCheckbox.checked = hasStoredPassword;
                
                // Focus on the label field
                connectionLabelInput.focus();
                
                displayMessage('info', \`Editing connection: \${connection.label}\`);
            }

            function exitEditMode() {
                console.log('[WebviewScript] Exiting edit mode');
                isEditMode = false;
                currentEditingConnectionId = null;
                
                // Reset UI state
                document.body.classList.remove('edit-mode');
                sectionTitle.textContent = 'Add New Connection';
                if (sectionIcon) {
                    sectionIcon.className = 'icon icon-add-connection-header';
                }
                saveButtonText.textContent = 'Save New Connection';
                
                // Hide cancel button
                editActionsDiv.style.display = 'none';
                
                // Clear and reset form
                addConnectionForm.reset();
                portNumberInput.value = '9445'; // Reset default port
                storePasswordCheckbox.checked = true; // Reset default
            }

            function handleSaveConnection() {
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
                    label: connectionLabelInput.value.trim() || \`\${usernameInput.value.trim()}@\${serverNameInput.value.trim()}\`,
                    serverName: serverNameInput.value.trim(),
                    portNumber: parseInt(portNumberInput.value, 10),
                    username: usernameInput.value.trim(),
                    password: storePasswordCheckbox.checked ? passwordInput.value : undefined
                };
                if (isEditMode && currentEditingConnectionId) {
                    // Update existing connection
                    payload.id = currentEditingConnectionId;
                    saveConnectionBtn.disabled = true;
                    saveButtonText.textContent = 'Updating...';
                    vscode.postMessage({ command: '${WebviewMessageCommands.UPDATE_CONNECTION}', payload });
                } else {
                    // Save new connection
                    saveConnectionBtn.disabled = true;
                    saveButtonText.textContent = 'Saving...';
                    vscode.postMessage({ command: '${WebviewMessageCommands.SAVE_NEW_CONNECTION}', payload });
                }

                setTimeout(() => {
                    passwordInput.value = '';
                    saveConnectionBtn.disabled = false;
                    if (isEditMode) {
                        saveButtonText.textContent = 'Save Changes';
                    } else {
                        saveButtonText.textContent = 'Save New Connection';
                    }
                }, 1000);
            }

            // Event listeners
            saveConnectionBtn.addEventListener('click', handleSaveConnection);

            connectionsListEl.addEventListener('click', function(event) {
                const targetButton = event.target.closest('button');
                if (targetButton && !targetButton.disabled) {
                    const connectionId = targetButton.dataset.connectionId;
                    if (targetButton.classList.contains('login-btn')) {
                        vscode.postMessage({ command: 'loginWithConnection', payload: { connectionId: connectionId } });
                    } else if (targetButton.classList.contains('edit-btn')) {
                        vscode.postMessage({ command: 'editConnection', payload: { connectionId: connectionId } });
                    } else if (targetButton.classList.contains('delete-btn')) {
                        vscode.postMessage({ command: 'requestDeleteConfirmation', payload: { connectionId: connectionId } });
                    }
                } else if (targetButton && targetButton.disabled) {
                    if (targetButton.classList.contains('delete-btn')) {
                        displayMessage('info', 'Cannot delete connection while editing it. Please save or cancel your changes first.');
                    } else if (targetButton.classList.contains('login-btn') || targetButton.classList.contains('edit-btn')) {
                        displayMessage('info', 'Please save or cancel your current changes before performing other actions.');
                    }
                }
            });

            if (cancelEditBtn) {
                cancelEditBtn.addEventListener('click', function() {
                    vscode.postMessage({ command: '${WebviewMessageCommands.CANCEL_EDIT_CONNECTION}' });
                });
            }
            
            // Handle messages from the extension host
            window.addEventListener('message', event => {
                const message = event.data;
                console.log('[WebviewScript] Message received from host:', message);
                switch (message.command) {
                    case '${WebviewMessageCommands.DISPLAY_CONNECTIONS_IN_WEBVIEW}':
                        renderConnections(message.payload);
                        break;
                    case '${WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE}':
                        displayMessage(message.payload.type, message.payload.text);
                        // Reset button states
                        if (saveConnectionBtn) {
                            saveConnectionBtn.disabled = false;
                            if (isEditMode) {
                                saveButtonText.textContent = 'Save Changes';
                            } else {
                                saveButtonText.textContent = 'Save New Connection';
                            }
                        }
                        break;
                    case 'enterEditMode':
                        enterEditMode(message.payload.connection, message.payload.hasStoredPassword);
                        break;
                    case 'exitEditMode':
                        exitEditMode();
                        break;
                }
            });

            // Tell the extension the UI is ready
            console.log('[WebviewScript] Requesting initial connections via CONNECTION_UI_LOADED.');
            vscode.postMessage({ command: '${WebviewMessageCommands.CONNECTION_UI_LOADED}' });
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
                                try {
                                    vscode.postMessage({ 
                                        command: '${WebviewMessageCommands.TRIGGER_COMMAND}', 
                                        payload: { commandId: '${allExtensionCommands.logout}' }
                                    });
                                } catch (e) {
                                    console.error("Failed to send logout command:", e);
                                }
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
