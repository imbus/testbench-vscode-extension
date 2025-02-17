/**
 * @file loginWebView.ts
 * @description Provides the login webview for the TestBench extension. This webview enables the user to enter
 * login credentials and triggers the login process using a HTML form.
 */

import * as vscode from "vscode";
import { logger, connection, allExtensionCommands, getConfig } from "./extension";
import { loginToNewPlayServerAndInitSessionToken } from "./testBenchConnection";
import { displayProjectManagementTreeView } from "./projectManagementTreeView";

// Tracks whether the login webview is visible.
export let loginWebViewIsVisible: boolean = true; // Initially display the view when the extension starts.

/**
 * The provider for the login webview.
 */
export class LoginWebViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = "testbenchExtension.webView";
    private currentWebview?: vscode.WebviewView;
    // Prevent multiple login processes by spamming the submit button.
    private isLoginProcessAlreadyRunning = false;

    /**
     * Constructs a new LoginWebViewProvider.
     * @param extensionContext The extension context.
     */
    constructor(private extensionContext?: vscode.ExtensionContext) {}

    /**
     * Called when VS Code loads the webview.
     * @param webviewView The webview view instance.
     */
    resolveWebviewView(webviewView: vscode.WebviewView): void {
        logger.trace("Resolving login webview view.");
        this.currentWebview = webviewView;

        // Enable scripts in the webview.
        webviewView.webview.options = {
            enableScripts: true,
        };

        // Set initial HTML content based on connection status.
        this.updateWebviewContent();

        // Listen for messages from the webview to respond to user actions.
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

    /**
     * Handles the login process when a login message is received from the webview when the user submits the form.
     * Prevents multiple login attempts and triggers the login sequence.
     * @param extensionContext The extension context.
     * @param serverName The server name.
     * @param portNumber The port number.
     * @param username The username.
     * @param password The password.
     */
    private async handleLogin(
        extensionContext: vscode.ExtensionContext | undefined,
        serverName: string,
        portNumber: number,
        username: string,
        password: string
    ): Promise<void> {
        if (this.isLoginProcessAlreadyRunning) {
            logger.trace("Login process already running; ignoring duplicate submit.");
            return;
        }
        this.isLoginProcessAlreadyRunning = true;
        logger.trace("Handling login command from webview.");

        if (this.isConnectedToServer()) {
            vscode.window.showInformationMessage("You are already connected to a server.");
            this.isLoginProcessAlreadyRunning = false;
            return;
        }

        // TODO: In production, don't log sensitive data.
        logger.trace(`Received login data: Server: ${serverName}, Port: ${portNumber}, Username: ${username}`);

        // Attempt to log in. Successfull login will update and hide the webview automatically.
        const loginResult = await loginToNewPlayServerAndInitSessionToken(
            extensionContext!,
            serverName,
            portNumber,
            username,
            password
        );

        // If login was successful, open project selection and display project tree view
        if (loginResult) {
            await vscode.commands.executeCommand(`${allExtensionCommands.selectAndLoadProject.command}`);
            // If the user does not select a project and clicks away, there wont be any active view.
            // Add project view so that the user can choose a project.
            displayProjectManagementTreeView();
        }

        // Release the lock on the login process.
        this.isLoginProcessAlreadyRunning = false;
    }

    /**
     * Updates the HTML content of the webview based on the connection status.
     */
    async updateWebviewContent(): Promise<void> {
        logger.trace("Updating login webview content.");
        if (!this.currentWebview) {
            logger.trace("No webview instance available for updating content.");
            return;
        }
        this.currentWebview.webview.html = this.isConnectedToServer()
            ? this.getAlreadyConnectedHtml()
            : await this.getLoginHtmlPage(this.currentWebview.webview);
        logger.trace("Login webview content updated.");
    }

    /**
     * Creates a URI for the TestBench icon.
     * @param webview The webview instance.
     * @returns The icon URI, or null if the extension context is undefined.
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
     * @param webview The webview instance.
     * @returns A promise resolving to an HTML string.
     */
    private async getLoginHtmlPage(webview: vscode.Webview): Promise<string> {
        logger.trace("Generating login HTML page.");
        // TODO: In production, don't log sensitive data.
        logger.trace(
            `Using stored settings: ServerName: ${getConfig().get<string>(
                "serverName",
                ""
            )}, Port: ${getConfig().get<string>("portNumber", "")}, Username: ${getConfig().get<string>(
                "username",
                ""
            )}`
        );
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
                  vscode.postMessage({ command: 'login', serverName, portNumber, username, password });
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
     * Returns HTML content for when the user is already connected.
     * @returns The HTML string.
     */
    private getAlreadyConnectedHtml(): string {
        logger.trace("Generating already connected HTML.");
        return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Connected</title>
          <script>
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

    /**
     * Determines whether the extension is connected to a server.
     * @returns True if connected; otherwise false.
     */
    private isConnectedToServer(): boolean {
        if (connection) {
            logger.trace("Connection is active.");
            return true;
        } else {
            logger.trace("No active connection found.");
            return false;
        }
    }
}

/* =============================================================================
   Webview Visibility and Update Functions
   ============================================================================= */

/**
 * Updates the login webview display based on the current visibility flag.
 */
export async function updateWebViewDisplay(): Promise<void> {
    logger.trace("Updating login webview display.");
    if (loginWebViewIsVisible) {
        await displayWebView();
        logger.trace("Login webview is displayed.");
    } else {
        await hideWebView();
        logger.trace("Login webview is hidden.");
    }
}

/**
 * Toggles the visibility of the login webview.
 */
export async function toggleWebViewVisibility(): Promise<void> {
    logger.trace("Toggling login webview visibility.");
    if (loginWebViewIsVisible) {
        await hideWebView();
        logger.trace("Login webview is now hidden.");
    } else {
        await displayWebView();
        logger.trace("Login webview is now displayed.");
    }
}

/**
 * Hides the login webview.
 */
export async function hideWebView(): Promise<void> {
    logger.trace("Hiding login webview.");
    await vscode.commands.executeCommand("testbenchExtension.webView.removeView");
    loginWebViewIsVisible = false;
}

/**
 * Displays the login webview.
 */
export async function displayWebView(): Promise<void> {
    logger.trace("Displaying login webview.");
    await vscode.commands.executeCommand("testbenchExtension.webView.focus");
    loginWebViewIsVisible = true;
}

/* 
// Example usage for updating webview content from another file:
this.currentWebview.webview.postMessage({
    command: "updateContent",
    html: `<h1>Connected to server</h1>`,
});

// When reinitializing content after webview recreation:
if (isConnected) {
    this.currentWebview.webview.postMessage({
        command: 'updateContent',
        html: this.getConnectedHtml(),
    });
}
*/
