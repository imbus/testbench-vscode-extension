import axios, { AxiosInstance, AxiosResponse } from "axios";
import * as https from "https";
import * as vscode from "vscode";
import * as base64 from "base-64"; // npm i --save-dev @types/base-64

// Ignore SSL certificate validation in node requests
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Interface for the response structure of the projects
// TODO: Use these interfaces to type the response data
interface ProjectResponse {
    projects: Project[];
}

interface Project {
    name: string;
    testObjectVersions: TestObjectVersion[];
    key: { serial: string };
    status: string;
    visibility: boolean;
    variantsManagementEnabled: boolean;
    creationTime: string;
}

interface TestObjectVersion {
    parent: { serial: string };
    name: string;
    endDate: string;
    variantDef: { serial: string };
    key: { serial: string };
    status: string;
    isBaseTOV: boolean;
    sourceTOV: { serial: string };
    startDate: string;
    visibility: boolean;
    cloningVisibility: boolean;
    creationTime: string;
    testCycles: TestCycle[];
    lockerKey: { serial: string };
}

interface TestCycle {
    parent: { serial: string };
    name: string;
    endDate: string;
    key: { serial: string };
    status: string;
    startDate: string;
    visibility: boolean;
    creationTime: string;
}

// TestBench server connection
export class PlayServerConnection {
    serverName: string;
    oldPlayServerPortNumber = 9443;
    newPlayServerPortNumber = 9445;

    loginName: string;
    password: string;
    session: AxiosInstance;
    sessionToken: string;

    oldPlayServerBaseUrl: string;
    newPlayServerBaseUrl: string;

    constructor(serverName: string, loginName: string, password: string, sessionToken: string) {
        this.serverName = serverName;
        this.loginName = loginName;
        this.password = password;
        this.sessionToken = sessionToken;

        this.oldPlayServerBaseUrl = `https://${this.serverName}:${this.oldPlayServerPortNumber}/api/1`;
        this.newPlayServerBaseUrl = `https://${this.serverName}:${this.newPlayServerPortNumber}/api`;

        // Manually encode the credentials to Base64
        const encodedCredentials = base64.encode(`${loginName}:${password}`);

        // Create an Axios instance with the necessary configuration
        this.session = axios.create({
            baseURL: this.oldPlayServerBaseUrl,
            // Old play server, which runs on port 9443, uses BasicAuth.
            // Use loginName as username, and use sessionToken as the password.
            auth: {
                username: loginName,
                password: sessionToken,
            },
            headers: {
                Authorization: `Basic ${encodedCredentials}`,
                "Content-Type": "application/vnd.testbench+json; charset=utf-8",
            },
            // Ignore self-signed certificates
            httpsAgent: new https.Agent({
                rejectUnauthorized: false, // This should only be used in a development environment
            }),
        });
    }

    // Method to fetch all projects from the server
    // TODO: Change the return type to Project[] instead of any[]
    async getAllProjects(includeTOVs: boolean = true, includeCycles: boolean = true): Promise<any[]> {
        try {
            console.log(`Getting all projects from server.`);

            // Make the GET request to fetch all projects
            const response = await this.session.get("/projects", {
                params: { includeTOVs: includeTOVs, includeCycles: includeCycles }, // Query parameters for the request
            });
            console.log("Response from getAllProjects:", response.data);

            // Return the list of projects, or an empty array if no projects are found
            return response.data.projects || [];
        } catch (error) {
            console.error("Error getting all projects:", error);
            return [];
        }
    }

    // Sends a GET request to the projects endpoint to verify if the connection is working.
    async checkIsWorking(): Promise<boolean> {
        try {
            console.log(`Checking connection...`);
            const response: AxiosResponse = await this.session.get("/projects", {
                params: {
                    includeTOVs: "false",
                    includeCycles: "false",
                },
            });
            console.log(`Response status for checking connection: ${response.status}`);
            return response.status === 200;
        } catch (error: any) {
            console.error("Error checking connection:", error.message);
            console.error("Error config:", error.config);
            if (error.response) {
                console.error("Error response data:", error.response.data);
                console.error("Error response status:", error.response.status);
                console.error("Error response headers:", error.response.headers);
            }
            return false;
        }
    }
}

// A generalized method to prompt for any user input with live validation
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

// Entry point for the login process
export async function performLogin(
    context: vscode.ExtensionContext,
    promptForNewCredentials: boolean = false
): Promise<PlayServerConnection | null> {
    // Loop until the user successfully logs in or cancels the login process
    while (true) {
        // Retrieve the stored credentials if they exist
        let serverName: string | undefined = await context.secrets.get("server");
        let portNumber: number | undefined = Number(await context.secrets.get("port"));
        let loginName: string | undefined = await context.secrets.get("loginName");
        let password: string | undefined = await context.secrets.get("password");

        // Check if the user wants to use the stored credentials to login with one click
        let useStoredCredentials = false;
        if (serverName && loginName && password && !promptForNewCredentials) {
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
            serverName = await promptForInput("Enter the server name (or type 'quit' to cancel)");
            // Server name cannot be empty
            if (!serverName) {
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
            portNumber = portInput ? parseInt(portInput, 10) : 9443;

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
        if (typeof serverName === "undefined" || typeof loginName === "undefined" || typeof password === "undefined") {
            vscode.window.showErrorMessage("Unexpected error: missing login credentials.");
            return null;
        }

        // Construct the server URL. The old play server runs on port 9443 and has the URL /api/1,
        // while the new play server runs on port 9445 and has a different URL such as /api/login/session/v1 .
        // TODO: These hard coded port numbers make the port number input redundant. Remove it? Or maybe store the port and server name also in connection class.
        const oldPlayServerPortNumber = 9443;
        const newPlayServerPortNumber = 9445;
        const oldPlayServerBaseUrl = `https://${serverName}:${oldPlayServerPortNumber}/api/1`;
        const newPlayServerBaseUrl = `https://${serverName}:${newPlayServerPortNumber}/api`; // /api/login/session/v1`;

        console.log(
            `Starting login process with URL: ${newPlayServerBaseUrl}, username: ${loginName}, and password: ${password}.`
        );

        // Login to the new play server that runs on port 9445 and return the session token.
        const sessionToken = await loginToNewPlayServerAndGetSessionToken(newPlayServerBaseUrl, loginName, password);
        if (sessionToken) {
            console.log("Session token retrieved successfully: ", sessionToken);

            const connection = await createConnectionToOldPlayServer(serverName, loginName, password, sessionToken);
            if (connection) {
                // If login is successful, store the credentials in VS Code storage
                context.secrets.store("server", serverName);
                context.secrets.store("port", portNumber.toString());
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
                    // Don't return null here, so that the user can retry the login process
                }
            }
        } else {
            console.log("Failed to retrieve session token.");
            return null;
        }
    }
}

async function createConnectionToOldPlayServer(
    serverName: string,
    loginName: string,
    password: string,
    sessionToken: string
): Promise<PlayServerConnection | null> {
    const connection = new PlayServerConnection(serverName, loginName, password, sessionToken);
    if (await connection.checkIsWorking()) {
        return connection;
    }
    return null;
}

// Request body structure for the login request
interface LoginRequest {
    login: string;
    password: string;
    force: boolean;
}

// Response body structure for the login request
interface LoginResponse {
    userKey: string;
    login: string;
    sessionToken: string;
    globalRoles: string[];
    internalUserManagement: boolean;
    serverVersion: string;
    licenseWarning: string | null;
}

// Login to the new play server that runs on port 9445 and return the session token.
// The old play server that runs on port 9443 has the URL /api/1, while the new play server has the URL /api/login/session/v1 .
async function loginToNewPlayServerAndGetSessionToken(
    baseUrl: string,
    username: string,
    password: string
): Promise<string | null> {
    // Define the request payload
    const requestBody: LoginRequest = {
        login: username,
        password: password,
        force: true,
    };

    try {
        let url = `${baseUrl}/login/session/v1`;

        // Log to console before sending request
        console.log("Sending Login POST request to:", url);

        // Send POST request to the server
        const response: AxiosResponse<LoginResponse> = await axios.post(url, requestBody, {
            headers: {
                accept: "application/vnd.testbench+json",
                "Content-Type": "application/vnd.testbench+json",
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
        });

        if (response.status === 201) {
            console.log("Login successful. Received session token:", response.data.sessionToken);
            return response.data.sessionToken;
        } else {
            console.log("Login failed. Unexpected status code:", response.status);
            return null;
        }
    } catch (error) {
        console.error("Error during login:", error);
        return null;
    }
}
