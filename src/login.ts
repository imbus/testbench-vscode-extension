import * as vscode from "vscode";
import { Connection, login } from "./connection";

// A generalized method to prompt for any user input
async function promptForInput(
    prompt: string,
    canBeEmpty: boolean = false,
    password: boolean = false,
    validate?: (value: string) => string | null
): Promise<string | undefined> {
    // Loop until a valid input is provided, or the user cancels the input
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

        // User can type quit to cancel the login process
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

export async function performLogin(
    context: vscode.ExtensionContext,
    promptForNewCredentials: boolean = false
): Promise<Connection | null> {
    // Loop until the user successfully logs in or cancels the login process
    while (true) {
        // Retrieve the stored credentials if they exist
        let server: string | undefined = await context.secrets.get("server");
        let port: number | undefined = Number(await context.secrets.get("port"));
        let loginName: string | undefined = await context.secrets.get("loginName");
        let password: string | undefined = await context.secrets.get("password");

        // Check if the user wants to use the stored credentials
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
            // Server name cannot be empty
            if (!server) {
                return null;
            }

            const portInput = await promptForInput(
                "Enter the port number (default 9443, or type 'quit' to cancel)",
                true,
                false,
                // Port number must be a number
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
            // Login name cannot be empty
            if (!loginName) {
                return null;
            }

            password = await promptForInput("Enter your password (or type 'quit' to cancel)", false, true);
            // Password cannot be empty
            if (!password) {
                return null;
            }
        }

        // Ensuring server, loginName, and password are strings
        if (typeof server === "undefined" || typeof loginName === "undefined" || typeof password === "undefined") {
            vscode.window.showErrorMessage("Unexpected error: missing login credentials.");
            return null;
        }

        const serverUrl = `https://${server}:${port}/api/1/`;

        // const serverUrl = `https://${server}:${port}/api/1/`;

        const connection = await login(serverUrl, loginName, password);
        if (connection) {
            // If login is successful, store the credentials in VS Code storage
            context.secrets.store("server", server);
            context.secrets.store("port", port.toString());
            context.secrets.store("loginName", loginName);
            context.secrets.store("password", password);
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
                context.secrets.delete("server");
                context.secrets.delete("port");
                context.secrets.delete("loginName");
                context.secrets.delete("password");
            }
        }
    }
}
