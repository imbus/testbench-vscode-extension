import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
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
        logger.trace("[loginWebView] LoginWebViewProvider initialized.");
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
                vscode.Uri.joinPath(this.extensionContext.extensionUri, "dist"),
                vscode.Uri.joinPath(this.extensionContext.extensionUri, "src", "webview") // Allow access to the new folder
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

        if (this.extensionContext && this._messageListenerDisposable) {
            this.extensionContext.subscriptions.push(this._messageListenerDisposable);
        }

        webviewView.onDidDispose(
            () => {
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
        logger.debug(`[loginWebView] Attempting login to TestBench...`);
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
                logger.info(
                    `[loginWebView] Successfully logged in to TestBench server '${selectedConnection.label}:${selectedConnection.portNumber}'.`
                );
            } else {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: "TestBench Login Failed."
                });
            }
        } catch (error: any) {
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
     * This includes server name, port number, username, and an optional password and label.
     * The 'id' property is omitted as it will be generated upon saving.
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

            this.postMessageToWebview("enterEditMode", {
                connection: connectionToEdit,
                hasStoredPassword: !!storedPassword
            });

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
        logger.trace(`[loginWebView] Attempting to update connection: ${payload.label || payload.id}`);

        try {
            if (!payload.id || !payload.serverName || !payload.portNumber || !payload.username) {
                this.postMessageToWebview(WebviewMessageCommands.SHOW_WEBVIEW_MESSAGE, {
                    type: "error",
                    text: "Connection ID, Server, Port, and Username are required."
                });
                return;
            }

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

    private getConnectionManagementHtmlPage(webview: vscode.Webview): string {
        const nonce = getNonce();

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "src", "webview", "main.js")
        );
        const stylesPath = path.join(this.extensionContext.extensionPath, "src", "webview", "styles.css");
        const stylesContent = fs.readFileSync(stylesPath, "utf8");

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

        const iconStyles = `
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
                --icon-connections-header: url(${connectionsHeaderIconDarkUri});
                --icon-add-connection-header: url(${addConnectionHeaderIconDarkUri});
                --icon-edit-connection-header: url(${editConnectionHeaderIconDarkUri});
                --icon-save: url(${saveConnectionButtonIconDarkUri});
                --icon-login: url(${loginIconDarkUri});
                --icon-edit: url(${editIconDarkUri});
                --icon-delete: url(${deleteIconDarkUri});
            }
        `;

        const htmlTemplatePath = path.join(
            this.extensionContext.extensionPath,
            "src",
            "webview",
            "connectionManagement.html"
        );
        let html = fs.readFileSync(htmlTemplatePath, "utf8");

        html = html.replace(/{{nonce}}/g, nonce);
        html = html.replace(/{{cspSource}}/g, webview.cspSource);
        html = html.replace("{{mainCss}}", stylesContent);
        html = html.replace(/{{jsUri}}/g, scriptUri.toString());
        html = html.replace(/{{iconStyles}}/g, iconStyles);

        return html;
    }

    private getAlreadyLoggedInHtmlPage(webview: vscode.Webview): string {
        const nonce: string = getNonce();

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "src", "webview", "loggedIn.js")
        );
        const stylesPath = path.join(this.extensionContext.extensionPath, "src", "webview", "loggedIn.css");
        const stylesContent = fs.readFileSync(stylesPath, "utf8");
        const logoUri: vscode.Uri | null = this.createIconUri(webview, "testbench-logo.svg");

        const currentConnection: PlayServerConnection | null = connection;
        let connectedAsInfo: string = "You are connected to TestBench.";
        if (currentConnection) {
            connectedAsInfo = `Connected as <strong>${currentConnection.getUsername()}</strong> on <strong>${currentConnection.getServerName()}:${currentConnection.getServerPort()}</strong>.`;
        }

        const htmlTemplatePath = path.join(this.extensionContext.extensionPath, "src", "webview", "loggedIn.html");
        let html = fs.readFileSync(htmlTemplatePath, "utf8");

        html = html.replace(/{{nonce}}/g, nonce);
        html = html.replace(/{{cspSource}}/g, webview.cspSource);
        html = html.replace("{{mainCss}}", stylesContent);
        html = html.replace(/{{jsUri}}/g, scriptUri.toString());
        html = html.replace(/{{logoUri}}/g, logoUri ? logoUri.toString() : "");
        html = html.replace(/{{connectedAsInfo}}/g, connectedAsInfo);

        return html;
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
