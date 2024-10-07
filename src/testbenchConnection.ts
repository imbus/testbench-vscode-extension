import * as https from "https";
import * as vscode from "vscode";
import * as base64 from "base-64"; // npm i --save-dev @types/base-64
import * as fs from "fs";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { TestThemeTreeDataProvider, initializeTreeView_TO_REMOVE } from "./testThemeTreeView";

// Ignore SSL certificate validation in node requests
// TODO: Remove this in production, and use a valid certificate?
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// New play server Project structure
interface Project {
    key: string;
    creationTime: string;
    name: string;
    status: string;
    visibility: boolean;
    tovsCount: number;
    cyclesCount: number;
    description: string;
    lockerKey: string | null;
    startDate: string | null;
    endDate: string | null;
}

// New play server Tree node structure
interface TreeNode {
    nodeType: string;
    key: string;
    name: string;
    creationTime: string;
    status: string;
    visibility: boolean;
    children?: TreeNode[]; // Optional property since not all nodes have children
}

function saveJsonToFile(filePath: string, data: any) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        vscode.window.showInformationMessage(`Cycle structure saved to ${filePath}`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error saving file: ${error.message}`);
        return undefined;
    }
}

// Define an interface for the server versions response
interface ServerVersionsResponse {
    releaseVersion: string;
    databaseVersion: string;
    revision: string;
}

// TestBench server connection
export class PlayServerConnection {
    context: vscode.ExtensionContext; // TODO: Use this to store and retrieve the credentials in secret storage or DELETE?
    serverName: string;
    oldPlayServerPortNumber = 9443;
    newPlayServerPortNumber = 9445;

    loginName: string; // TODO: Store in secret storage
    password: string | undefined; // TODO: Store in secret storage
    oldPlayServerSession: AxiosInstance | null;
    newPlayServerSession: AxiosInstance | null;
    sessionToken: string; // TODO: Store the session token in secret storage

    oldPlayServerBaseUrl: string;
    newPlayServerBaseUrl: string;

    // Keep the connection alive by sending a request to the server every 4 minutes, the server timeout is 5 minutes
    private keepAliveIntervalId: NodeJS.Timeout | null = null;

    constructor(
        context: vscode.ExtensionContext,
        serverName: string,
        loginName: string,
        password: string, // TODO: Delete this after implementing new play server session
        sessionToken: string
    ) {
        this.context = context;
        this.serverName = serverName;
        this.loginName = loginName;
        this.password = password;
        this.sessionToken = sessionToken;

        this.oldPlayServerBaseUrl = `https://${this.serverName}:${this.oldPlayServerPortNumber}/api/1`;
        this.newPlayServerBaseUrl = `https://${this.serverName}:${this.newPlayServerPortNumber}/api`;

        // TODO: Delete this after implementing new play server session
        // Create session for API calls to the old play server
        this.oldPlayServerSession = axios.create({
            baseURL: this.oldPlayServerBaseUrl,
            // Old play server, which runs on port 9443, uses BasicAuth.
            // Use loginName as username, and use sessionToken as the password.
            auth: {
                username: loginName,
                // TODO: username: await context.secrets.get("loginName");
                password: sessionToken,
                // TODO: password: await this.getSessionTokenFromSecretStorage(context),
            },
            headers: {
                // Manually encode the credentials to Base64, avoid creating a separate variable for this.
                Authorization: `Basic ${base64.encode(`${loginName}:${password}`)}`,
                "Content-Type": "application/vnd.testbench+json; charset=utf-8",
            },
            // Ignore self-signed certificates
            httpsAgent: new https.Agent({
                rejectUnauthorized: false, // This should only be used in a development environment
            }),
        });

        // Create session for API calls to the new play server
        this.newPlayServerSession = axios.create({
            baseURL: this.newPlayServerBaseUrl,
            headers: {
                Authorization: this.sessionToken,
            },
            // Ignore self-signed certificates
            httpsAgent: new https.Agent({
                rejectUnauthorized: false, // This should only be used in a development environment
            }),
        });

        // Start the keep alive process to keep the session alive
        this.startKeepAlive();
    }

    // Method to retrieve the session token from secure storage
    async getSessionTokenFromSecretStorage(context: vscode.ExtensionContext): Promise<string | undefined> {
        const token = await context.secrets.get("sessionToken");
        if (!token) {
            console.error("Session token not found.");
        }
        return token;
    }

    async selectProjectKeyFromProjectList(projectsData: Project[]): Promise<string | null> {
        const projectNames = projectsData.map((project: Project) => project.name);
        const selectedProjectName = await vscode.window.showQuickPick(projectNames, {
            placeHolder: "Select a project",
        });

        if (selectedProjectName === undefined || !selectedProjectName) {
            return null;
        }

        console.log("selectedProjectName: ", selectedProjectName);
        const selectedProject = projectsData.find((project: Project) => project.name === selectedProjectName);
        if (!selectedProject) {
            // vscode.window.showErrorMessage("Selected project not found.");
            return null;
        }

        return selectedProject.key;
    }

    // Get the list of projects from the new play server
    async getProjectList(): Promise<Project[] | null> {
        if (!this.sessionToken) {
            console.warn("Session token is null. Cannot fetch projects list.");
            return null;
        }
        try {
            const projectsURL = `${this.newPlayServerBaseUrl}/projects/v1`;

            if (!this.newPlayServerSession) {
                console.warn("New play server session is not initialized. Cannot fetch projects list.");
                return null;
            }

            const projectsResponse = await this.newPlayServerSession.get(projectsURL, {
                headers: {
                    Authorization: this.sessionToken,
                    accept: "application/vnd.testbench+json",
                },
            });

            // Save the JSON to a file for analyzing the structure
            /*
            const savePath = await vscode.window.showSaveDialog({
                saveLabel: "Save Project Tree",
                filters: {
                    "JSON Files": ["json"],
                    "All Files": ["*"],
                },
            });
            if (savePath) {
                const filePath = savePath.fsPath;
                saveJsonToFile(filePath, projectsResponse.data);
            } else {
                vscode.window.showErrorMessage("No file path selected.");
            }
            */

            console.log("Fetched project list:", projectsResponse.data);

            // TODO: Create a separate command: Fetch every project with every TOV and cycle and display them in tree view.

            return projectsResponse.data || [];
        } catch (error) {
            console.error("Error fetching projects:", error);
            return null;
        }
    }

    // Get the list of projects from the new play server
    async getProjectTreeOfProject(projectKey: string | null): Promise<TreeNode | null> {
        if (!this.sessionToken) {
            console.warn("Session token is null. Cannot fetch project tree:", projectKey);
            return null;
        }
        if (!projectKey || projectKey === null || projectKey === undefined) {
            console.warn("Project key is null or undefined. Cannot fetch project tree.");
            return null;
        }
        try {
            const projectTreeURL = `${this.newPlayServerBaseUrl}/projects/${projectKey}/tree/v1`;

            if (!this.newPlayServerSession) {
                console.warn("New play server session is not initialized. Cannot fetch project tree.");
                return null;
            }

            const projectTreeResponse = await this.newPlayServerSession.get(projectTreeURL, {
                headers: {
                    Authorization: this.sessionToken,
                    accept: "application/vnd.testbench+json",
                },
            });

            // Save the JSON to a file for analyzing the structure
            /*
            const savePath = await vscode.window.showSaveDialog({
                saveLabel: "Save Project Tree",
                filters: {
                    "JSON Files": ["json"],
                    "All Files": ["*"],
                },
            });
            if (savePath) {
                const filePath = savePath.fsPath;
                saveJsonToFile(filePath, projectTreeResponse.data);
            } else {
                vscode.window.showErrorMessage("No file path selected.");
            }
            */

            console.log("Fetched project tree:", projectTreeResponse.data);
            return projectTreeResponse.data || [];
        } catch (error) {
            console.error("Error fetching project tree:", error);
            return null;
        }
    }

    // Method to fetch all projects from the server
    // TODO: Delete this after the new play server is implemented
    async getAllProjectsFromOldPlayServer(includeTOVs: boolean = true, includeCycles: boolean = true): Promise<any[]> {
        try {
            // console.log(`Getting all projects from server.`);

            // GET request to fetch all projects
            if (!this.oldPlayServerSession) {
                vscode.window.showErrorMessage("Session is not initialized.");
                throw new Error("Session is not initialized.");
            }
            const response = await this.oldPlayServerSession.get("/projects", {
                params: { includeTOVs: includeTOVs, includeCycles: includeCycles }, // Query parameters for the request
            });
            console.log("Response from getAllProjectsFromOldPlayServer:", response.data);

            // Save the JSON to a file for analyzing the structure
            /*
            const savePath = await vscode.window.showSaveDialog({
                saveLabel: "Save Project Tree",
                filters: {
                    "JSON Files": ["json"],
                    "All Files": ["*"],
                },
            });
            if (savePath) {
                const filePath = savePath.fsPath;
                saveJsonToFile(filePath, response.data);
            } else {
                vscode.window.showErrorMessage("No file path selected.");
            }
            */

            // Return the list of projects, or an empty array if no projects are found
            return response.data.projects || [];
        } catch (error) {
            console.error("Error getting all projects:", error);
            return [];
        }
    }

    // Fetch the structure of a cycle
    async fetchCycleStructure(projectKey: string, cycleKey: string) {
        const cycleStructureUrl = `${this.newPlayServerBaseUrl}/projects/${projectKey}/cycles/${cycleKey}/structure/v1`;

        const requestBody = {
            basedOnExecution: true,
            suppressFilteredData: false,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: [],
        };

        try {
            if (!this.newPlayServerSession) {
                vscode.window.showErrorMessage("Session is not initialized.");
                throw new Error("Session is not initialized.");
            }
            const response = await this.newPlayServerSession.post(cycleStructureUrl, requestBody, {
                headers: {
                    accept: "application/json",
                    "Content-Type": "application/json",
                },
            });

            if (response.status === 200) {
                console.log("Cycle Structure received:", response.data);

                // User selects a file path for saving the JSON
                /*
                const savePath = await vscode.window.showSaveDialog({
                    saveLabel: "Save Cycle Structure",
                    filters: {
                        "JSON Files": ["json"],
                        "All Files": ["*"],
                    },
                });

                if (savePath) {
                    const filePath = savePath.fsPath;
                    saveJsonToFile(filePath, response.data);
                } else {
                    vscode.window.showErrorMessage("No file path selected.");
                }*/

                return response.data;
            } else {
                console.error(`Unexpected response code: ${response.status}`);
            }
        } catch (error) {
            console.error("Error fetching cycle structure:", error);
        }
    }

    // Sends a GET request to the projects endpoint to verify if the connection is working.
    async checkIsWorking(): Promise<boolean> {
        try {
            // console.log(`Checking connection...`);
            if (!this.oldPlayServerSession) {
                vscode.window.showErrorMessage("Session is not initialized.");
                throw new Error("Session is not initialized.");
            }
            const response: AxiosResponse = await this.oldPlayServerSession.get("/projects", {
                params: {
                    includeTOVs: "false",
                    includeCycles: "false",
                },
            });
            // console.log(`Response status for checking connection: ${response.status}`);
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

    async logoutUser(context: vscode.ExtensionContext, treeDataProvider: TestThemeTreeDataProvider): Promise<void> {
        try {
            const response: AxiosResponse = await axios.delete(`${this.newPlayServerBaseUrl}/login/session/v1`, {
                headers: {
                    Authorization: this.sessionToken,
                    accept: "application/vnd.testbench+json",
                },
            });

            if (response.status === 204) {
                // clearStoredCredentials(context); // Clear the stored credentials not needed if the user wants to log in automatically again
                removeSessionData(context, this); // Clear the session data
                if (treeDataProvider) {
                    treeDataProvider.clearTree();
                } else {
                    vscode.window.showErrorMessage("treeDataProvider is null.");
                }

                console.log("Logout successful");
                vscode.window.showInformationMessage("Logout successful.");
            } else {
                console.log(`Unexpected response status: ${response.status}`);
                vscode.window.showInformationMessage(`Unexpected response status: ${response.status}`);
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error(
                    `Error during logout: ${error.response?.status} - ${error.response?.statusText}. If the issue persists, please log in again.`
                );
                vscode.window.showInformationMessage(
                    `Error during logout: ${error.response?.status} - ${error.response?.statusText}. If the issue persists, please log in again.`
                );
            } else {
                console.error(`An unexpected error occurred: ${error}`);
            }
        } finally {
            this.stopKeepAlive();
        }
    }

    private startKeepAlive(): void {
        this.stopKeepAlive(); // Ensure no multiple intervals
        this.keepAliveIntervalId = setInterval(() => {
            this.keepAlive();
        }, 4 * 60 * 1000); // Every 4 minutes
        console.log("Keep-alive STARTED.");
        // Send an immediate keep-alive request
        this.keepAlive();
    }

    private stopKeepAlive(): void {
        console.log("Keep-alive STOPPED.");
        if (this.keepAliveIntervalId) {
            clearInterval(this.keepAliveIntervalId);
            this.keepAliveIntervalId = null;
        }
    }

    private async keepAlive(): Promise<void> {
        if (!this.sessionToken) {
            console.warn("Session token is null. Cannot send keep-alive request.");
            return;
        }
        try {
            const keepAliveURL = `${this.newPlayServerBaseUrl}/login/session/v1`;

            if (!this.newPlayServerSession) {
                console.warn("New play server session is not initialized. Cannot send keep-alive request.");
                return;
            }

            await this.newPlayServerSession.get(keepAliveURL, {
                headers: {
                    Authorization: this.sessionToken,
                    accept: "application/vnd.testbench+json",
                },
            });

            console.log("Keep-alive request SENT.");
        } catch (error) {
            console.error("Keep-alive request failed:", error);
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

// TODO: Split this function into 2 separate functions: One for the login data input and validation, and one for the actual login request.
// TODO: Pressing cancel on user name input wont cancel directly, but will show the password input, and then cancel.
// Entry point for the login process
export async function performLogin(
    context: vscode.ExtensionContext,
    baseKey: string,
    promptForNewCredentials: boolean = false
): Promise<PlayServerConnection | null> {
    // Loop until the user successfully logs in or cancels the login process
    while (true) {
        // Retrieve the stored credentials if they exist
        // Pwd stored in secret storage, and used to login automatically next time.
        const config = vscode.workspace.getConfiguration(baseKey);
        let password: string | undefined = undefined;

        const hasStoredCredentials =
            config.get<string>("serverName", "testbench") &&
            config.get<string>("username") &&
            (await context.secrets.get("password"));

        // Check if the user wants to use the stored credentials to login with one click
        let useStoredCredentials = false;
        if (hasStoredCredentials && !promptForNewCredentials) {
            const choice = await vscode.window.showInformationMessage(
                "Do you want to login using your previous credentials?",
                "Yes",
                "No"
            );
            if (choice === "Yes") {
                useStoredCredentials = true;
            }
        }

        // If the user doesn't want to use the stored credentials, prompt for new credentials
        if (!useStoredCredentials) {
            let serverNameInput = await promptForInput(
                `Enter the server name (Default value: ${config.get<string>("serverName", "testbench")})`,
                true
            );
            console.log("Server name input: ", serverNameInput);
            // If the user enters a non empty input, update the configuration with the new value.
            if (serverNameInput) {
                config.update("serverName", serverNameInput);
                console.log("Server name updated: ", serverNameInput);
            } // If the user leaves the input empty, do nothing and use the default value in the configuration.

            const portInputAsString = await promptForInput(
                `Enter the port number (Default value: ${config.get<number>("portNumber", 9445)})`,
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
            console.log("Port number input: ", portInputAsString);
            if (portInputAsString) {
                config.update("portNumber", parseInt(portInputAsString, 10));
                console.log("Port number updated: ", portInputAsString);
            }

            // New: Check if the server is accessible under this server name and port number
            const serverVersions = await fetchServerVersions(
                config.get<string>("serverName", "testbench"),
                config.get<number>("portNumber", 9445).toString()
            );
            if (!serverVersions) {
                console.log("Server versions not found.");
                return null;
            }

            let loginName = await promptForInput(
                `Enter your login name (Default value ${config.get<string>("username", "undefined")})`,
                true
            );
            // If the user leaves the input empty, do nothing and use the default value in the configuration.
            if (loginName) {
                config.update("username", loginName);
            }

            password = await promptForInput(`Enter your password`, false, true);
            // Password cannot be empty
            if (!password) {
                return null;
            }
        } else {
            // Use the stored credentials to login automatically (Extension settings and SecretStorage)
            password = await context.secrets.get("password");
        }

        // Check if any of the login credentials are missing
        if (
            typeof config.get<string>("serverName", "testbench") === "undefined" ||
            typeof config.get<string>("username") === "undefined" ||
            typeof password === "undefined"
        ) {
            vscode.window.showErrorMessage("Unexpected error: missing login credentials.");
            return null;
        }

        // console.log(`Starting login process with URL: ${newPlayServerBaseUrl}, username: ${loginName}, and password: ${password}.`);

        // Login to the new play server that runs on port 9445 and return the session token.
        const connection = await loginToNewPlayServerAndInitSessionToken(
            context,
            baseKey,
            config.get<string>("serverName", "testbench"),
            config.get<number>("portNumber", 9445),
            config.get<string>("username")!,
            password
        );
        if (connection) {
            if (connection.sessionToken) {
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
                    clearStoredCredentials(context);
                    // Don't return null here, so that the user can retry the login process
                }
            }
        } else {
            console.log("Login failed.");
            vscode.window.showErrorMessage("Login failed.");
            return null;
        }
    }
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
async function loginToNewPlayServerAndInitSessionToken(
    context: vscode.ExtensionContext,
    baseKey: string,
    serverName: string,
    portNumber: number,
    username: string,
    password: string
): Promise<PlayServerConnection | null> {
    // Request payload for login
    const requestBody: LoginRequest = {
        login: username,
        password: password,
        force: true,
    };

    try {
        const config = vscode.workspace.getConfiguration(baseKey);
        const newPlayServerBaseUrl = `https://${config.get<string>("serverName", "testbench")}:${config
            .get<number>("portNumber", 9445)
            .toString()}/api`;
        let loginURLOfNewPlayServer = `${newPlayServerBaseUrl}/login/session/v1`;

        console.log("Sending Login POST request to:", loginURLOfNewPlayServer);
        // console.log("Request body for login:", requestBody);

        // Send POST request to login to the server
        const response: AxiosResponse<LoginResponse> = await axios.post(loginURLOfNewPlayServer, requestBody, {
            headers: {
                accept: "application/vnd.testbench+json",
                "Content-Type": "application/vnd.testbench+json",
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
        });

        // TODO: Dont store Session token in the connection class?
        if (response.status === 201) {
            console.log("Login successful. Received session token:", response.data.sessionToken);

            // TODO: Prompt the user to store the credentials in secret storage in order to login automatically next time.
            await storeCredentialsInSecretStorage(
                context,
                baseKey,
                serverName,
                portNumber,
                username,
                password,
                response.data.sessionToken
            );

            const connection = new PlayServerConnection(
                context,
                serverName,
                username, // TODO: remove?
                password, // TODO: remove?
                response.data.sessionToken // TODO: remove?
            );
            if (await connection.checkIsWorking()) {
                return connection;
            }
            return null;
        } else {
            console.log("Login failed. Unexpected status code:", response.status);
            return null;
        }
    } catch (error) {
        console.error("Error during login:", error);
        return null;
    }
}

async function storeCredentialsInSecretStorage(
    context: vscode.ExtensionContext,
    baseKey: string,
    serverName: string,
    portNumber: number,
    username: string,
    password: string,
    sessionToken: string
): Promise<void> {
    try {
        await context.secrets.store("server", serverName);
        await context.secrets.store("port", portNumber.toString());
        await context.secrets.store("loginName", username);
        await context.secrets.store("password", password);
        await context.secrets.store("sessionToken", sessionToken);
        console.log("Credentials stored securely in secret storage.");
    } catch (error) {
        console.error("Failed to store credentials:", error);
        vscode.window.showErrorMessage("Failed to store credentials securely.");
    }
}

async function clearStoredCredentials(context: vscode.ExtensionContext) {
    try {
        await context.secrets.delete("server");
        await context.secrets.delete("port");
        await context.secrets.delete("loginName");
        await context.secrets.delete("password");
        await context.secrets.delete("sessionToken");
        console.log("Cleared credentials successfully.");
    } catch (error) {
        console.error("Failed to clear credentials:", error);
    }
}

function removeSessionData(context: vscode.ExtensionContext, connection: PlayServerConnection | null) {
    if (connection) {
        connection.loginName = "";
        connection.password = "";
        connection.oldPlayServerSession = null;
        connection.sessionToken = ""; // TODO: Delete after storing in secret storage
    }
}

export async function changeConnection(
    context: vscode.ExtensionContext,
    baseKey: string,
    oldConnection: PlayServerConnection
): Promise<{ newConnection: PlayServerConnection | null; newTreeDataProvider: TestThemeTreeDataProvider | null }> {
    if (oldConnection) {
        removeSessionData(context, oldConnection);
        await clearStoredCredentials(context);
        let newConnection = await performLogin(context, baseKey, true);

        let newTreeDataProvider: TestThemeTreeDataProvider | null = null;
        if (newConnection) {
            newTreeDataProvider = await initializeTreeView_TO_REMOVE(context, newConnection);
            //newTreeDataProvider = new TestThemeTreeDataProvider(newConnection);
            //await newTreeDataProvider.initializeTreeView(context, newConnection);
        }
        return { newConnection, newTreeDataProvider };
    } else {
        vscode.window.showErrorMessage("No connection available. Please log in first.");
    }
    return { newConnection: null, newTreeDataProvider: null };
}

/**
 * Retrieves the current versions of the TestBench web server.
 * Used to verify the availability of server after receiving the server URL and port number in the login process.
 * @param baseURL - The base URL of the TestBench server.
 * @returns A promise that resolves to the server versions.
 */
async function fetchServerVersions(serverName: string, portNumber: string): Promise<ServerVersionsResponse | null> {
    try {
        const baseURL = `https://${serverName}:${portNumber}`;
        const serverVersionsURL = `${baseURL}/api/serverVersions/v1`;

        console.log("Fetching server versions with URL:", serverVersionsURL);
        const response: AxiosResponse<ServerVersionsResponse> = await axios.get(serverVersionsURL, {
            headers: {
                Accept: "application/vnd.testbench+json",
            },
        });

        vscode.window.showInformationMessage(
            `TestBench Release Version: ${response.data.releaseVersion}, Database Version: ${response.data.databaseVersion}, Revision: ${response.data.revision}`
        );
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                // Server responded with a status outside the 2xx range
                console.error(`Error: Received status code ${error.response.status}`, error.response.data);
                if (error.response.status === 404) {
                    console.error("The TestBench version cannot be found.");
                    vscode.window.showErrorMessage(
                        `TestBench version cannot be found under the URL https://${serverName}:${portNumber}`
                    );
                }
            } else if (error.request) {
                // No response was received
                console.error("Error: No response received from server.", error.request);
                vscode.window.showErrorMessage(
                    `TestBench is not available under the URL https://${serverName}:${portNumber}`
                );
            } else {
                // Error setting up the request
                console.error("Error:", error.message);
            }
        } else {
            // Non-Axios error
            console.error("Unexpected error:", error);
        }
        return null;
    }
}
