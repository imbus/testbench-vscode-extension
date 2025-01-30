import * as vscode from "vscode";
import { logger, connection, baseKeyOfExtension, allExtensionCommands, getConfig } from "./extension";
import { loginToNewPlayServerAndInitSessionToken } from "./testBenchConnection";
import { displayProjectManagementTreeView } from "./projectManagementTreeView";

// Keep track of whether our login webview is visible or not to be able to toggle its visibility
export let loginWebViewIsVisible: boolean = true; // Initially display the view when the extension starts

export class LoginWebViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = "testbenchExtension.webView";
    // Store the reference to the WebviewView
    private currentWebview?: vscode.WebviewView;

    private isLoginProcessAlreadyRunning: boolean = false; // Prevent multiple login processes by spamming submit button

    // Private fields to hold our username/password
    constructor(private extensionContext?: vscode.ExtensionContext | undefined) {}

    /**
     * Called when the view is loaded by VS Code.
     */
    resolveWebviewView(webviewView: vscode.WebviewView) {
        logger.trace("Resolving webview view");
        this.currentWebview = webviewView; // Store reference to the WebviewView
        // Enable scripts in our webview
        webviewView.webview.options = {
            enableScripts: true,
        };

        // Check server connection and set initial content
        this.updateWebviewContent();

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage((message) => {
            logger.trace(`Received message from webview: ${message.command}`);
            if (message.command === "login") {
                this.handleLogin(
                    this.extensionContext,
                    message.serverName,
                    parseInt(message.portNumber, 10), // Port number is an integer
                    message.username,
                    message.password
                );
            }
        });
    }

    private async handleLogin(
        extensionContext: vscode.ExtensionContext | undefined,
        serverName: string,
        portNumber: number,
        username: string,
        password: string
    ) {
        if (this.isLoginProcessAlreadyRunning) {
            logger.trace("Login process for the login webview is already running, ignoring the submit button.");
            return;
        }
        this.isLoginProcessAlreadyRunning = true;
        logger.trace("Handling login command from webview");
        if (this.isConnectedToServer()) {
            vscode.window.showInformationMessage("You are already connected to a server.");
            return;
        }
        logger.trace(
            `Webview input fields: Server Name: ${serverName} Port Number: ${portNumber} Username: ${username}`
        ); // TODO: Delete this in production to not to store sensitive data in logs

        // Login logic also notifies and hides the webview from activity bar
        const loginResult = await loginToNewPlayServerAndInitSessionToken(
            extensionContext!,
            serverName,
            portNumber,
            username,
            password!,
            baseKeyOfExtension
        );

        // If login was successful, open project selection and display project tree view
        if (loginResult) {
            // Open project selection after logging in, this command also takes care of the visibility of the tree views
            await vscode.commands.executeCommand(`${allExtensionCommands.selectAndLoadProject.command}`);

            // When the user wont select a project and clicks away, there wont be any view in activity bar.
            // Add project view to activity bar so that he can choose project again.
            displayProjectManagementTreeView();
        }

        // Release the lock
        this.isLoginProcessAlreadyRunning = false;
    }

    // Update the HTML content of the webview based on the connection status
    async updateWebviewContent() {
        logger.trace("Updating webview content.");
        if (!this.currentWebview) {
            logger.trace("No webview to update webview content.");
            return;
        }
        this.currentWebview.webview.html = this.isConnectedToServer()
            ? this.getAlreadyConnectedHtml()
            : await this.getLoginPageHtmlSimple(this.currentWebview.webview);
        logger.trace("Webview content updated.");
    }

    // Create the URI for the testbench icon
    private createIconUri(webview: vscode.Webview): vscode.Uri | null {
        if (!this.extensionContext) {
            logger.error("Extension context is not defined, cannot get the URI for the icon.");
            return null;
        }
        // Generate the URI for testbench icon
        const imageUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext!.extensionUri, "resources", "icons", "iTB-EE-Logo-256x256.png")
        );
        return imageUri;
    }

    /**
     * Return an HTML string with two text fields and a Submit button.
     */
    private async getLoginPageHtmlComplex(webview: vscode.Webview): Promise<string> {
        logger.trace("Getting login page HTML");

        const imageUri = this.createIconUri(webview);

        // Minimal HTML (no Content-Security-Policy for simplicity).
        // For production, consider adding a nonce-based CSP.
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8"/>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Login to TestBench</title>
            <style>
            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
                font-family: Arial, sans-serif;
            }

            body {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                background: linear-gradient(to right, #6a11cb, #2575fc);
                color: #fff;
            }

            img {
                width: 40px;
                height: 40px;
                vertical-align: middle;
            }

            h2 {
                margin-left: 1em;
            }

            .header-container {
                display: flex;
                align-items: center;
                margin-bottom: 1em;
            }

            form {
                background: #fff;
                color: #333;
                padding: 2em;
                border-radius: 10px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                width: 100%;
                max-width: 400px;
            }

            .form-group {
                margin-bottom: 1em;
            }

            label {
                display: block;
                font-weight: bold;
                margin-bottom: 0.5em;
            }

            input {
                width: 100%;
                padding: 0.8em;
                border: 1px solid #ccc;
                border-radius: 5px;
                font-size: 1em;
            }

            input:focus {
                outline: none;
                border-color: #6a11cb;
                box-shadow: 0 0 5px rgba(106, 17, 203, 0.5);
            }

            button {
                width: 100%;
                padding: 0.8em;
                background: #6a11cb;
                color: #fff;
                border: none;
                border-radius: 5px;
                font-size: 1em;
                font-weight: bold;
                cursor: pointer;
                transition: background 0.3s;
            }

            button:hover {
                background: #2575fc;
            }

            @media (max-width: 600px) {
                form {
                padding: 1.5em;
                }

                h2 {
                font-size: 1.5em;
                }
            }
            </style>
        </head>
        <body>
            <form id="loginForm" onsubmit="event.preventDefault(); submitLogin();">
            <div class="header-container">
            <img src="${imageUri || ""}" alt="TestBench Logo">
            <h2>Login to TestBench</h2>
            </div>
            <div class="form-group">
                <label for="serverName">Server Name:</label>
                <input id="serverName" type="text" placeholder="Server Name" value="${
                    getConfig().get<string>("serverName", "") || ""
                }" required />
            </div>
            <div class="form-group">
                <label for="portNumber">Port Number:</label>
                <input id="portNumber" type="text" placeholder="Port Number" value="${
                    getConfig().get<string>("portNumber", "") || ""
                }" required />
            </div>
            <div class="form-group">
                <label for="username">Username:</label>
                <input id="username" type="text" placeholder="Username" value="${
                    getConfig().get<string>("username", "") || ""
                }" required />
            </div>
            <div class="form-group">
                <label for="password">Password:</label>
                <input id="password" type="password" placeholder="Password" value="${
                    (await this.extensionContext?.secrets.get("password")) || ""
                }" required />
            </div>
            <button id="submitBtn" type="submit">Submit</button>
            </form>
            <script>
            // VS Code API object
            const vscode = acquireVsCodeApi();

            // Function to send login data to the extension
            function submitLogin() {
                const serverName = document.getElementById('serverName').value;
                const portNumber = document.getElementById('portNumber').value;
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;

                // Send message to the extension
                vscode.postMessage({
                command: 'login',
                serverName,
                portNumber,
                username,
                password
                });
            }

            // Listen for messages from the extension to update the content dynamically
            window.addEventListener('message', (event) => {
                const message = event.data;
                if (message.command === 'updateContent') {
                document.body.innerHTML = message.html;
                }
            });
            </script>
        </body>
        </html>
        `;
    }

    /**
     * Return an HTML string with two text fields and a Submit button.
     */
    private async getLoginPageHtmlSimple(webview: vscode.Webview): Promise<string> {
        logger.trace("Getting login page HTML.");
        logger.trace(
            `Credentials for login page: ${getConfig().get<string>("serverName", "")}, ${getConfig().get<string>(
                "portNumber",
                ""
            )}, ${getConfig().get<string>("username", "")}`
        );  // Password is not logged for security reasons

        const imageUri = this.createIconUri(webview);

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
            input {
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
                <input id="serverName" type="text" placeholder="Server Name" value="${
                    getConfig().get<string>("serverName", "") || ""
                }" required/>
            </div>
            <div>
                <label for="portNumber">Port Number:</label>
                <input id="portNumber" type="text" placeholder="Port Number" value="${
                    getConfig().get<string>("portNumber", "") || ""
                }" required/>
            </div>
            <div>
                <label for="username">Username:</label>
                <input id="username" type="text" placeholder="Username" value="${
                    getConfig().get<string>("username", "") || ""
                }" required/>
            </div>
            <div>
                <label for="password">Password:</label>
                <input id="password" type="password" placeholder="Password" value="${
                    (await this.extensionContext?.secrets.get("password")) || ""
                }" required/>
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

                vscode.postMessage({
                    command: 'login',
                    serverName,
                    portNumber,
                    username,
                    password
                });
            }

            window.addEventListener('message', (event) => {
                const message = event.data;
                if (message.command === 'updateContent') {
                    document.body.innerHTML = message.html;
                }
            });
        </script>
    </body>
    </html>
    `;
    }

    /**
     * HTML content for the connected state.
     */
    private getAlreadyConnectedHtml(): string {
        logger.trace("Getting already connected HTML");
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Connected</title>
                <script>
                // Listen for messages from the extension
                window.addEventListener('message', (event) => {
                    const message = event.data;
                    if (message.command === 'updateContent') {
                        document.body.innerHTML = message.html;
                    }
                });
            </script>
            </head>
            <body>
                <h1>Connected to server</h1>
            </body>
            </html>
        `;
    }

    private isConnectedToServer(): boolean {
        if (connection) {
            logger.trace("Connection to server is active");
            return true;
        } else {
            logger.trace("Connection to server is not active");
            return false;
        }
    }
}

// Define the function that toggles visibility
export async function updateWebViewDisplay(): Promise<void> {
    logger.trace(`Updating login webview visibility`);
    if (loginWebViewIsVisible) {
        await displayWebView();
        logger.trace(`Login Webview is now displayed`);
    } else {
        await hideWebView();
        logger.trace(`Login Webview is now hidden`);
    }
}

// Define the function that toggles visibility
export async function toggleWebViewVisibility(): Promise<void> {
    logger.trace(`Toggling login webview visibility`);
    if (loginWebViewIsVisible) {
        await hideWebView();
        logger.trace(`Login Webview is now hidden`);
    } else {
        await displayWebView();
        logger.trace(`Login Webview is now displayed`);
    }
}

export async function hideWebView(): Promise<void> {
    logger.trace("Hiding login webview");
    await vscode.commands.executeCommand("testbenchExtension.webView.removeView");
    loginWebViewIsVisible = false;
}

export async function displayWebView(): Promise<void> {
    logger.trace("Displaying login webview");
    await vscode.commands.executeCommand("testbenchExtension.webView.focus");
    loginWebViewIsVisible = true;
}

/*
// Use this code to update the content of the webview from another file
this.currentWebview.webview.postMessage({
    command: "updateContent",
    html: `
                        <h1>Connected to server</h1>
                    `,
});

// If you need to reinitialize the content when the Webview is recreated:
if (isConnected) {
    this.currentWebview.webview.postMessage({
        command: 'updateContent',
        html: this.getConnectedHtml(),
    });
}
*/
