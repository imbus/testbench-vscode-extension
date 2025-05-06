/**
 * @file loginWebView.ts
 * @description Provides the login webview for the TestBench extension. This webview enables the user to enter
 * login credentials and triggers the login process using a HTML form.
 */

import * as vscode from "vscode";
import { logger, connection, getConfig } from "./extension";
import { loginToNewPlayServerAndInitSessionToken, PlayServerConnection } from "./testBenchConnection";
import { displayProjectManagementTreeView } from "./projectManagementTreeView";
import { WebviewMessageCommands, ConfigKeys, StorageKeys, allExtensionCommands } from "./constants";

/**
 * The provider for the login webview.
 */
export class LoginWebViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId: string = "testbenchExtension.webView";
    private currentWebview?: vscode.WebviewView;
    // Prevent multiple login processes which can be caused by spamming the login button.
    private isLoginProcessAlreadyRunningAfterButtonClick: boolean = false;

    /**
     * Constructs a new LoginWebViewProvider.
     * @param {vscode.ExtensionContext} extensionContext The extension context.
     */
    constructor(private extensionContext?: vscode.ExtensionContext) {}

    /**
     * Called when VS Code loads the webview.
     * @param {vscode.WebviewView} webviewView The webview view instance.
     */
    resolveWebviewView(webviewView: vscode.WebviewView): void {
        logger.trace("Resolving login webview view.");
        this.currentWebview = webviewView;

        // Enable scripts in the webview.
        webviewView.webview.options = {
            enableScripts: true
        };

        // Set initial HTML content based on connection status.
        this.updateWebviewHTMLContent();

        // Listen for messages from the webview to respond to user actions.
        webviewView.webview.onDidReceiveMessage(async (message) => {
            logger.trace(`Received message from webview: ${message.command}`);
            switch (message.command) {
                // Handle the login attempt
                case WebviewMessageCommands.LOGIN:
                    this.handleLogin(
                        this.extensionContext,
                        message.serverName,
                        parseInt(message.portNumber, 10), // Port number is an integer, parse it
                        message.username,
                        message.password
                    );
                    break;
                // Handle setting updates directly from the webview checkboxes
                case WebviewMessageCommands.UPDATE_SETTING:
                    await this.updateSetting(message.key, message.value);
                    break;
            }
        });

        // Clean up when the view is disposed (e.g., user closes the view)
        webviewView.onDidDispose(
            () => {
                this.currentWebview = undefined;
                logger.trace("Login webview disposed.");
            },
            null,
            this.extensionContext?.subscriptions
        );
    }

    /**
     * Updates a setting in the workspace configuration.
     * @param {string} key The setting key.
     * @param {any} value The new value for the setting.
     */
    private async updateSetting(key: string, value: any): Promise<void> {
        try {
            await vscode.workspace
                .getConfiguration("testbenchExtension")
                .update(key, value, vscode.ConfigurationTarget.Workspace);
            logger.info(`Setting '${key}' updated to '${value}' via webview.`);
        } catch (error) {
            logger.error(`Failed to update setting ${key} from webview:`, error);
            vscode.window.showErrorMessage(`Failed to update setting '${key}'.`);
        }
    }

    /**
     * Handles the login process when a login message is received from the webview when the user submits the login form.
     * Prevents multiple login attempts and triggers the login sequence.
     * @param {vscode.ExtensionContext | undefined} extensionContext The extension context.
     * @param {string} serverName The server name.
     * @param {number} portNumber The port number.
     * @param {string} username The username.
     * @param {string} password The password.
     */
    private async handleLogin(
        extensionContext: vscode.ExtensionContext | undefined,
        serverName: string,
        portNumber: number,
        username: string,
        password: string
    ): Promise<void> {
        if (this.isLoginProcessAlreadyRunningAfterButtonClick) {
            logger.trace("Login process already running; ignoring duplicate submit.");
            return;
        }
        this.isLoginProcessAlreadyRunningAfterButtonClick = true;
        logger.trace("Handling login command from webview.");

        if (!extensionContext) {
            logger.error("Extension context is missing in handleLogin.");
            this.showLoginErrorInWebview("Internal error: Extension context missing."); // Show error in webview
            this.isLoginProcessAlreadyRunningAfterButtonClick = false;
            return;
        }

        // Check if the user is already connected to a server, if so, show a message and hide the webview.
        if (this.isConnectedToServer()) {
            vscode.window.showInformationMessage("You are already connected to a server.");
            this.isLoginProcessAlreadyRunningAfterButtonClick = false;
            return;
        }

        // In production, don't log sensitive data.
        logger.trace(`Received login data: Server: ${serverName}, Port: ${portNumber}, Username: ${username}`);

        try {
            // Attempt to log in. Successfull login will update and hide the webview automatically.
            const connectionAfterLoginAttempt: PlayServerConnection | null =
                await loginToNewPlayServerAndInitSessionToken(
                    extensionContext!,
                    serverName,
                    portNumber,
                    username,
                    password
                );

            // If login was successful, open project selection and display project tree view
            if (connectionAfterLoginAttempt) {
                await vscode.commands.executeCommand(`${allExtensionCommands.selectAndLoadProject}`);
                // If the user does not select a project and clicks away, there wont be any active view.
                // Add project view so that the user can choose a project.
                displayProjectManagementTreeView();
            } else {
                logger.warn("Login failed via webview.");
                this.showLoginErrorInWebview("Login failed. Please check credentials or server details.");
            }
        } catch (error) {
            logger.error("Exception during login attempt from webview:", error);
            this.showLoginErrorInWebview(`Login error: ${(error as Error).message}`);
        } finally {
            // Release the lock on the login process.
            this.isLoginProcessAlreadyRunningAfterButtonClick = false;
        }
    }

    /**
     * Updates the HTML content of the webview based on the connection status.
     */
    async updateWebviewHTMLContent(): Promise<void> {
        if (this.currentWebview) {
            logger.trace("Setting/Updating login webview HTML content.");
            // The view is only resolved when not connected, so we always show the login page.
            this.currentWebview.webview.html = await this.getLoginHtmlPage(this.currentWebview.webview);
        } else {
            logger.trace("No current login webview to update content for.");
        }
    }

    /**
     * Sends a message to the webview to display an error message.
     * @param {string} errorMessage The error message text to display.
     */
    private showLoginErrorInWebview(errorMessage: string): void {
        if (this.currentWebview) {
            // Post a message that the webview's script can handle
            this.currentWebview.webview.postMessage({
                command: WebviewMessageCommands.SHOW_ERROR,
                message: errorMessage
            });
        }
    }

    /**
     * Creates a URI for the TestBench icon.
     * @param {vscode.Webview} webview The webview instance.
     * @returns {vscode.Uri | null} The icon URI, or null if the extension context is undefined.
     */
    private createIconUri(webview: vscode.Webview): vscode.Uri | null {
        if (!this.extensionContext) {
            logger.error("Extension context is undefined; cannot create icon URI.");
            return null;
        }
        // Create the URI for testbench icon
        return webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", "iTB-EE-Logo-256x256.png")
        );
    }

    /**
     * Returns a simple login HTML page with VS Code styling.
     * @param {vscode.Webview} webview The webview instance.
     * @returns {Promise<string>} A promise resolving to an HTML string.
     */
    private async getLoginHtmlPage(webview: vscode.Webview): Promise<string> {
        logger.trace("Returning login HTML page for Webview.");
        if (!this.extensionContext) {
            logger.warn("Extension context is undefined; cannot get stored settings.");
        }

        const imageUri: vscode.Uri | null = this.createIconUri(webview);

        // Use constants for config keys
        const serverNameValue: string = getConfig().get<string>(ConfigKeys.SERVER_NAME, "");
        const portNumberValue: string = getConfig().get<string>(ConfigKeys.PORT_NUMBER, "");
        const usernameValue: string = getConfig().get<string>(ConfigKeys.USERNAME, "");
        const storedPasswordValue: string = (await this.extensionContext?.secrets.get(StorageKeys.PASSWORD)) || "";
        const savePasswordChecked: string = getConfig().get<boolean>(ConfigKeys.STORE_PASSWORD_AFTER_LOGIN, false)
            ? "checked"
            : "";
        const autoLoginChecked: string = getConfig().get<boolean>(ConfigKeys.AUTO_LOGIN, false) ? "checked" : "";

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login to TestBench</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 20px;
        }
        .header-container {
            display: flex;
            align-items: center;
            margin-bottom: 1em;
        }
        .header-container img {
            width: 30px;
            height: 30px;
            margin-right: 10px;
        }
        .header-container h2 {
            margin: 0;
            color: var(--vscode-editor-foreground);
        }
        form div {
            margin-top: 0.5em;
        }
        label {
            display: block;
            margin-bottom: 0.25em;
            color: var(--vscode-editor-foreground);
        }
        input[type="text"],
        input[type="password"] {
            width: 100%;
            padding: 0.5em;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
        }
        input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        button {
            margin-top: 1em;
            padding: 0.5em 1em;
            border: none;
            border-radius: 4px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        /* Optional styling for checkboxes */
        .checkbox-container {
            display: flex;
            align-items: center;
        }
        .checkbox-container input {
            margin-right: 0.5em;
        }
    </style>
</head>
<body>
    <div class="header-container">
        <img src="${imageUri || ""}" alt="TestBench Logo">
        <h2>Login to TestBench</h2>
    </div>
    <form id="loginForm" onsubmit="event.preventDefault(); submitLogin();">
        <div>
            <label for="serverName">Server Name:</label>
            <input id="serverName" type="text" placeholder="Server Name" value="${serverNameValue || ""}" required/>
        </div>
        <div>
            <label for="portNumber">Port Number:</label>
            <input id="portNumber" type="text" placeholder="Port Number" value="${portNumberValue || ""}" required/>
        </div>
        <div>
            <label for="username">Username:</label>
            <input id="username" type="text" placeholder="Username" value="${usernameValue || ""}" required/>
        </div>
        <div>
            <label for="password">Password:</label>
            <input id="password" type="password" placeholder="Password" value="${storedPasswordValue}" required/>
        </div>
        <div class="checkbox-container">
            <input id="savePassword" type="checkbox" ${savePasswordChecked}/>
            <label for="savePassword">Save Password</label>
        </div>
        <div class="checkbox-container">
            <input id="autoLogin" type="checkbox" ${autoLoginChecked}/>
            <label for="autoLogin">Auto Login</label>
        </div>              
        <div>
            <button id="submitBtn" type="submit">Submit</button>
        </div>
    </form>
    <script>
        const vscode = acquireVsCodeApi();
        function submitLogin() {
            const serverName = document.getElementById('serverName').value;
            const portNumber = document.getElementById('portNumber').value;
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const autoLogin = document.getElementById('autoLogin').checked;
            const savePassword = document.getElementById('savePassword').checked;
            vscode.postMessage({ command: ${WebviewMessageCommands.LOGIN}, serverName, portNumber, username, password, autoLogin, savePassword });
        }

        // Add event listeners for checkbox changes
        document.getElementById('autoLogin').addEventListener('change', function() {
            vscode.postMessage({ 
                command: ${WebviewMessageCommands.UPDATE_SETTING}, 
                key: ${ConfigKeys.AUTO_LOGIN}, 
                value: this.checked 
            });
        });
        document.getElementById('savePassword').addEventListener('change', function() {
            vscode.postMessage({ 
                command: ${WebviewMessageCommands.UPDATE_SETTING}, 
                key: '${ConfigKeys.STORE_PASSWORD_AFTER_LOGIN}', 
                value: this.checked 
            });
        });

        // Handle messages from the extension
        window.addEventListener('message', (event) => {
            const message = event.data;
             // Keep literal string for receiving message command
            if (message.command === '${WebviewMessageCommands.UPDATE_CONTENT}') {
                // Potentially update parts of the page instead of innerHTML
                if (message.html) {
                     document.body.innerHTML = message.html;
                }
            }
            // Keep literal string for receiving message command
            if (message.command === '${WebviewMessageCommands.SHOW_ERROR}') {
                 // Add a dedicated error display area in your HTML
                 const errorDiv = document.getElementById('error-message');
                 if (errorDiv && message.message) {
                     errorDiv.textContent = message.message;
                     errorDiv.style.display = 'block'; // Make it visible
                 }
            }
        });
    </script>
</body>
</html>
`;
    }

    /**
     * Determines whether the extension is connected to a server.
     * @returns {boolean} True if connected; otherwise false.
     */
    private isConnectedToServer(): boolean {
        if (connection) {
            logger.trace("Connection is active.");
            return true;
        } else {
            logger.trace("Connection is not active.");
            return false;
        }
    }
}
