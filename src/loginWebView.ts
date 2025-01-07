import * as vscode from "vscode";
import { logger } from "./extension";

// Keep track of whether our login webview is visible or not to be able to toggle its visibility
let loginWebViewIsVisible: boolean = false;  // Initially hidden in extension.ts

export class LoginWebViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = "testbenchExtension.webView";
    /**
     * Called when the view is loaded by VS Code.
     */
    resolveWebviewView(webviewView: vscode.WebviewView) {
        // Enable scripts in our webview
        webviewView.webview.options = {
            enableScripts: true,
        };

        // Provide the HTML content
        webviewView.webview.html = this.getHtml();

        // Listen for messages from the webview
        webviewView.webview.onDidReceiveMessage((message) => {
            if (message.command === "login") {
                const { username, password } = message;
                vscode.window.showInformationMessage(`Username: ${username}\nPassword: ${password}`);
                logger.trace(`Webview input fields: Username: ${username}\nPassword: ${password}`);  // Delete this in production to not to store sensitive data in logs
            }
        });
    }

    /**
     * Return an HTML string with two text fields and a Submit button.
     */
    private getHtml(): string {
        // Minimal HTML (no Content-Security-Policy for simplicity).
        // For production, consider adding a nonce-based CSP.
        return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <title>Login to TestBench</title>
      </head>
      <body>
        <h2>Login to TestBench</h2>
        <div>
          <label for="username">Username:</label>
          <input id="username" type="text" />
        </div>
        <div style="margin-top: 0.5em;">
          <label for="password">Password:</label>
          <input id="password" type="password" />
        </div>
        <div style="margin-top: 1em;">
          <button id="submitBtn">Submit</button>
        </div>

        <script>
          // VS Code API object
          const vscode = acquireVsCodeApi();

          document.getElementById('submitBtn').addEventListener('click', () => {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            // Post a message to the extension
            vscode.postMessage({
              command: 'login',
              username: username,
              password: password
            });
          });
        </script>
      </body>
      </html>
    `;
    }
}

// Define the function that toggles visibility
export async function toggleWebViewVisibility() {
    if (loginWebViewIsVisible) {
        await vscode.commands.executeCommand("testbenchExtension.webView.removeView");
        logger.trace(`Login Webview is now hidden`);
    } else {
        await vscode.commands.executeCommand("testbenchExtension.webView.focus");
        logger.trace(`Login Webview is now displayed`);
    }
    loginWebViewIsVisible = !loginWebViewIsVisible;
}
