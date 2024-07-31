import * as vscode from 'vscode';
import { Connection, login } from './connection';

async function promptForInput(
    prompt: string,
    canBeEmpty: boolean = false,
    password: boolean = false,
    validate?: (value: string) => string | null
): Promise<string | undefined> {
    while (true) {
        const input = await vscode.window.showInputBox({
            prompt,
            password,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!canBeEmpty && value === "") {
                    return "Value cannot be empty";
                }
                if (validate) {
                    return validate(value);
                }
                return null;
            },
        });

        if (input === undefined || input.toLowerCase() === "quit") {
            vscode.window.showInformationMessage("Login process aborted");
            return undefined;
        }

        if (!validate || validate(input) === null) {
            return input;
        }

        vscode.window.showErrorMessage(validate(input) || "Invalid input, please try again.");
    }
}

export async function performLogin(context: vscode.ExtensionContext, promptForNewCredentials: boolean = false): Promise<Connection | null> {
    while (true) {
        let server: string | undefined = context.globalState.get("server");
        let port: number | undefined = context.globalState.get("port");
        let loginName: string | undefined = context.globalState.get("loginName");
        let password: string | undefined = context.globalState.get("password");

        let useStoredCredentials = false;
        if (server && loginName && password && !promptForNewCredentials) {
            const choice = await vscode.window.showInformationMessage(
                "Do you want to login using your previous credentials?",
                "Yes",
                "No"
            );
            if (choice === "Yes") {
                useStoredCredentials = true;
            }
        }

        if (!useStoredCredentials) {
            server = await promptForInput("Enter the server name (or type 'quit' to cancel)");
            if (!server) {
                return null;
            }

            const portInput = await promptForInput(
                "Enter the port number (default 9443, or type 'quit' to cancel)",
                true,
                false,
                (value) => {
                    if (value && !/^\d+$/.test(value)) {
                        return "Port number must be a number";
                    }
                    return null;
                }
            );
            if (portInput === undefined) {
                return null;
            }
            port = portInput ? parseInt(portInput, 10) : 9443;

            loginName = await promptForInput("Enter your login name (or type 'quit' to cancel)");
            if (!loginName) {
                return null;
            }

            password = await promptForInput("Enter your password (or type 'quit' to cancel)", false, true);
            if (!password) {
                return null;
            }
        }

        // Ensuring server, loginName, and password are strings
        if (typeof server === 'undefined' || typeof loginName === 'undefined' || typeof password === 'undefined') {
            vscode.window.showErrorMessage("Unexpected error: missing login credentials.");
            return null;
        }

        const serverUrl = `https://${server}:${port}/api/1/`;

        const connection = await login(serverUrl, loginName, password);
        if (connection) {
            context.globalState.update("server", server);
            context.globalState.update("port", port);
            context.globalState.update("loginName", loginName);
            context.globalState.update("password", password);
            vscode.window.showInformationMessage("Login successful!");

            return connection;     
        } else {
            const retry = await vscode.window.showInformationMessage(
                "Login failed! Do you want to retry?",
                "Retry",
                "Cancel"
            );
            if (retry === "Cancel") {
                vscode.window.showInformationMessage("Login process aborted");
                return null;
            } else {
                context.globalState.update("server", undefined);
                context.globalState.update("port", undefined);
                context.globalState.update("loginName", undefined);
                context.globalState.update("password", undefined);
            }
        }
    }
}
