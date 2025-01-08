import * as vscode from "vscode";
import { logger, connection, baseKey, setConnection } from "./extension";
import { loginToNewPlayServerAndInitSessionToken, PlayServerConnection } from "./testBenchConnection";

// TODO: Hide tree views when the login webview is visible

// Keep track of whether our login webview is visible or not to be able to toggle its visibility
export let loginWebViewIsVisible: boolean = true; // Initially display the view when the extension starts

export class LoginWebViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = "testbenchExtension.webView";
    // Store the reference to the WebviewView
    private currentWebview?: vscode.WebviewView;

    // Private fields to hold our username/password
    constructor(
        private readonly extensionContext?: vscode.ExtensionContext | undefined,
        private readonly serverName?: string,
        private readonly portNumber?: string,
        private readonly username?: string,
        private readonly password?: string
    ) {}

    /**
     * Called when the view is loaded by VS Code.
     */
    resolveWebviewView(webviewView: vscode.WebviewView) {
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
        logger.trace("Handling login command from webview");
        if (this.isConnectedToServer()) {
            vscode.window.showInformationMessage("You are already connected to a server.");
            return;
        }
        logger.trace(
            `Webview input fields: Server Name: ${serverName} Port Number: ${portNumber} Username: ${username} Password: ${password}`
        ); // TODO: Delete this in production to not to store sensitive data in logs

        // Login logic also notifies and hides the webview from activity bar
        await loginToNewPlayServerAndInitSessionToken(
            extensionContext!,
            serverName,
            portNumber,
            username,
            password!,
            baseKey
        );

        // OPTIONAL
        // Open project selection after logging in, this command also takes care of the visibility of the tree views
        vscode.commands.executeCommand(`${baseKey}.selectAndLoadProject`);
    }

    async updateWebviewContent() {
        logger.trace("Updating webview content");
        if (!this.currentWebview) {
            logger.trace("No webview to update webview content");
            return;
        }
        this.currentWebview.webview.html = this.isConnectedToServer()
            ? this.getAlreadyConnectedHtml()
            : this.getLoginPageHtmlSimple(this.currentWebview.webview);
        logger.trace("Webview content updated");
    }

    private createIconUri(webview: vscode.Webview): vscode.Uri | null {
        if (!this.extensionContext) {
            logger.error("Extension context is not defined, cannot get the URI for the icon");
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
    private getLoginPageHtmlComplex(webview: vscode.Webview): string {
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
                <img src="${imageUri}" alt="TestBench Logo">
                <h2>Login to TestBench</h2>
            </div>
                <div class="form-group">
                    <label for="serverName">Server Name:</label>
                    <input id="serverName" type="text" placeholder="Server Name" value="${this.serverName}" required />
                </div>
                <div class="form-group">
                    <label for="portNumber">Port Number:</label>
                    <input id="portNumber" type="text" placeholder="Port Number" value="${this.portNumber}" required />
                </div>
                <div class="form-group">
                    <label for="username">Username:</label>
                    <input id="username" type="text" placeholder="Username" value="${this.username}" required />
                </div>
                <div class="form-group">
                    <label for="password">Password:</label>
                    <input id="password" type="password" placeholder="Password" value="${this.password}" required />
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
    private getLoginPageHtmlComplex2(webview: vscode.Webview): string {
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
                body {
                    font-family: sans-serif;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    background-color: #f5f5f5;
                    padding: 30px; /* Added padding to the body */
                }
                
                .header-container img {
                    width: 30px;
                    height: 30px;
                    margin-right: 10px;
                }

                h2 {
                    text-align: center;
                    margin-bottom: 20px;
                }

                label {
                    display: block;
                    margin-bottom: 5px;
                    color: black;
                }

                input[type="text"],
                input[type="password"] {
                    width: 100%;
                    padding: 10px;
                    border: 1px solid #ccc;
                    border-radius: 3px;
                    box-sizing: border-box;
                    margin-bottom: 15px;
                }

                button[type="submit"] {
                    background-color: #007bff;
                    color: #fff;
                    padding: 10px 20px;
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                    width: 100%;
                }

                button[type="submit"]:hover {
                    background-color: #0069d9;
                }
            </style>
        </head>
        <body>
            <img src="${imageUri}" alt="TestBench Logo">
            <h2>Login to TestBench</h2>
            <form id="loginForm" onsubmit="event.preventDefault(); submitLogin();">
                <div>
                    <label for="serverName">Server Name:</label>
                    <input id="serverName" type="text" placeholder="Server Name" value="${this.serverName}" required/>
                </div>
                <div>
                    <label for="portNumber">Port Number:</label>
                    <input id="portNumber" type="text" placeholder="Port Number" value="${this.portNumber}" required/>
                </div>
                <div>
                    <label for="username">Username:</label>
                    <input id="username" type="text" placeholder="Username" value="${this.username}" required/>
                </div>
                <div>
                    <label for="password">Password:</label>
                    <input id="password" type="password" placeholder="Password" value="${this.password}" required/>
                </div>
                <div style="margin-top: 1em;">
                    <button id="submitBtn" type="submit">Submit</button>
                </div>
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
    private getLoginPageHtmlSimple(webview: vscode.Webview): string {
        logger.trace("Getting login page HTML");

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
                    font-family: Arial, sans-serif;
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
                }
                form div {
                    margin-top: 0.5em;
                }
                /* Ensures each label appears on its own line */
                label {
                    display: block;
                    margin-bottom: 0.25em;
                }
            </style>
        </head>
        <body>
            <div class="header-container">
                <img src="${imageUri}" alt="TestBench Logo">
                <h2>Login to TestBench</h2>
            </div>
            <form id="loginForm" onsubmit="event.preventDefault(); submitLogin();">
                <div>
                    <label for="serverName">Server Name:</label>
                    <input id="serverName" type="text" placeholder="Server Name" value="${this.serverName}" required/>
                </div>
                <div>
                    <label for="portNumber">Port Number:</label>
                    <input id="portNumber" type="text" placeholder="Port Number" value="${this.portNumber}" required/>
                </div>
                <div>
                    <label for="username">Username:</label>
                    <input id="username" type="text" placeholder="Username" value="${this.username}" required/>
                </div>
                <div>
                    <label for="password">Password:</label>
                    <input id="password" type="password" placeholder="Password" value="${this.password}" required/>
                </div>
                <div style="margin-top: 1em;">
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
    if (loginWebViewIsVisible) {
        await hideWebView();
        logger.trace(`Login Webview is now hidden`);
    } else {
        await displayWebView();
        logger.trace(`Login Webview is now displayed`);
    }
}

export async function hideWebView(): Promise<void> {
    await vscode.commands.executeCommand("testbenchExtension.webView.removeView");
    loginWebViewIsVisible = false;
}

export async function displayWebView(): Promise<void> {
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
