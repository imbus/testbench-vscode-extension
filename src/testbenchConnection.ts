import * as https from "https";
import * as vscode from "vscode";
import * as fs from "fs";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { ProjectManagementTreeDataProvider, initializeTreeView } from "./projectManagementTreeView";

// Ignore SSL certificate validation in node requests
// TODO: Remove this in production, and use a valid certificate
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
    children?: TreeNode[]; // Not all nodes have children
}

// Define an interface for the server versions response
interface ServerVersionsResponse {
    releaseVersion: string;
    databaseVersion: string;
    revision: string;
}

// Function to save JSON data to a file (For analysing the responses of the server)
function saveJsonToFile(filePath: string, data: any): void {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        vscode.window.showInformationMessage(`Cycle structure saved to ${filePath}`);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error saving file: ${error.message}`);
    }
}

// TestBench server connection
export class PlayServerConnection {
    private context: vscode.ExtensionContext;
    private serverName: string;
    private portNumber: number;
    private sessionToken: string;
    private baseURL: string;
    private apiClient: AxiosInstance;
    private keepAliveIntervalId: NodeJS.Timeout | null = null;

    constructor(context: vscode.ExtensionContext, serverName: string, portNumber: number, sessionToken: string) {
        this.context = context;
        this.serverName = serverName;
        this.portNumber = portNumber;
        this.sessionToken = sessionToken;
        this.baseURL = `https://${this.serverName}:${this.portNumber}/api`;

        // Create Axios instance for API calls to the server
        this.apiClient = axios.create({
            baseURL: this.baseURL,
            headers: {
                Authorization: this.sessionToken,
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false, // TODO: Should be true in production
            }),
        });

        // Start the keep-alive process to prevent timeout after 5 minutes
        this.startKeepAlive();
    }

    public getSessionToken(): string {
        return this.sessionToken;
    }

    public getBaseURL(): string {
        return this.baseURL;
    }

    async getSessionTokenFromSecretStorage(context: vscode.ExtensionContext): Promise<string | undefined> {
        const token = await context.secrets.get("sessionToken");
        if (!token) {
            console.error("Session token not found.");
        }
        return token;
    }

    clearSessionData() {
        this.baseURL = "";
        this.serverName = "";
        this.portNumber = 0;
        this.sessionToken = "";
        this.apiClient = axios.create();
        this.keepAliveIntervalId = null;
    }

    async selectProjectKeyFromProjectList(projectsData: Project[]): Promise<string | null> {
        const projectNames = projectsData.map((project: Project) => project.name);
        const selectedProjectName = await vscode.window.showQuickPick(projectNames, {
            placeHolder: "Select a project",
        });

        if (!selectedProjectName) {
            return null;
        }

        console.log("Selected project name:", selectedProjectName);
        const selectedProject = projectsData.find((project: Project) => project.name === selectedProjectName);
        if (!selectedProject) {
            // vscode.window.showErrorMessage("Selected project not found.");
            return null;
        }

        return selectedProject.key;
    }

    async getProjectList(): Promise<Project[] | null> {
        if (!this.sessionToken) {
            console.warn("Session token is null. Cannot fetch projects list.");
            return null;
        }
        try {
            const projectsURL = `/projects/v1`;
            const projectsResponse = await this.apiClient.get<Project[]>(projectsURL, {
                headers: {
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
            return projectsResponse.data || [];
        } catch (error) {
            console.error("Error fetching projects:", error);
            return null;
        }
    }

    async getProjectTreeOfProject(projectKey: string | null): Promise<TreeNode | null> {
        if (!this.sessionToken) {
            console.warn("Session token is null. Cannot fetch project tree:", projectKey);
            return null;
        }
        if (!projectKey) {
            console.warn("Project key is null or undefined. Cannot fetch project tree.");
            return null;
        }
        try {
            const projectTreeURL = `/projects/${projectKey}/tree/v1`;
            const projectTreeResponse = await this.apiClient.get<TreeNode>(projectTreeURL, {
                headers: {
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
            return projectTreeResponse.data || null;
        } catch (error) {
            console.error("Error fetching project tree:", error);
            return null;
        }
    }

    async fetchCycleStructure(projectKey: string, cycleKey: string) {
        const cycleStructureUrl = `/projects/${projectKey}/cycles/${cycleKey}/structure/v1`;
        const requestBody = {
            basedOnExecution: true,
            suppressFilteredData: false,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: [],
        };

        try {
            const response = await this.apiClient.post(cycleStructureUrl, requestBody, {
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
                }
                */

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
            const projectsURL = `/projects/v1`;
            const projectsResponse = await this.apiClient.get(projectsURL, {
                headers: {
                    accept: "application/vnd.testbench+json",
                },
            });
            return projectsResponse.status === 200;
        } catch (error: any) {
            console.error("Error checking connection:", error.message);
            if (error.response) {
                console.error("Error response data:", error.response.data);
                console.error("Error response status:", error.response.status);
                console.error("Error response headers:", error.response.headers);
            }
            return false;
        }
    }

    async logoutUser(
        context: vscode.ExtensionContext,
        treeDataProvider: ProjectManagementTreeDataProvider
    ): Promise<void> {
        try {
            const response: AxiosResponse = await this.apiClient.delete(`/login/session/v1`, {
                headers: {
                    accept: "application/vnd.testbench+json",
                },
            });

            if (response.status === 204) {
                // clearStoredCredentials(context, baseKey); // Clear the stored credentials not needed if the user wants to log in automatically again
                this.clearSessionData(); // Clear the session data
                if (treeDataProvider) {
                    treeDataProvider.clearTree();
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
            // Regardless of the outcome, stop the keep-alive process
            vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", false);
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

    // Sends a GET request to the server to keep the session alive, which normally times out after 5 minutes
    private async keepAlive(): Promise<void> {
        if (!this.sessionToken) {
            console.warn("Session token is null. Cannot send keep-alive request.");
            return;
        }
        try {
            await this.apiClient.get(`/login/session/v1`, {
                headers: {
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

// Entry point for the login process
export async function performLogin(
    context: vscode.ExtensionContext,
    baseKey: string,
    promptForNewCredentials: boolean = false
): Promise<PlayServerConnection | null> {
    // Loop until the user successfully logs in or cancels the login process
    while (true) {
        // Retrieve the stored credentials if they exist
        const config = vscode.workspace.getConfiguration(baseKey);
        let storePassword = config.get<boolean>("storePasswordAfterLogin", false);
        let password: string | undefined;

        // Only retrieve the password if the user has choosen to store it
        if (storePassword) {
            password = await context.secrets.get("password");
        }
        const hasStoredCredentials =
            config.get<string>("serverName") && config.get<string>("username") && password && storePassword;

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

        let serverName: string | undefined;
        let portNumber: number | undefined;
        let username: string | undefined;

        if (useStoredCredentials) {
            serverName = config.get<string>("serverName")!;
            portNumber = config.get<number>("portNumber")!;
            username = config.get<string>("username")!;
        } else {
            const credentials = await promptForLoginCredentials(context, baseKey);
            if (!credentials) {
                vscode.window.showInformationMessage("Login process aborted");
                return null;
            }
            ({ serverName, portNumber, username, password } = credentials);
        }

        // Attempt to login
        const connection = await loginToNewPlayServerAndInitSessionToken(
            context,
            serverName,
            portNumber,
            username,
            password!,
            baseKey
        );

        if (connection) {
            vscode.window.showInformationMessage("Login successful!");
            vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", true);
            return connection;
        } else {
            await clearStoredCredentials(context, baseKey);
            const retry = await vscode.window.showInformationMessage(
                "Login failed! Do you want to retry?",
                "Retry",
                "Cancel"
            );
            if (retry !== "Retry") {
                vscode.window.showInformationMessage("Login process aborted");
                return null;
            } else {
                // Continue the loop to retry
            }
        }
    }
}

// Function to prompt user for login credentials
async function promptForLoginCredentials(
    context: vscode.ExtensionContext,
    baseKey: string
): Promise<{
    serverName: string;
    portNumber: number;
    username: string;
    password: string;
} | null> {
    const config = vscode.workspace.getConfiguration(baseKey);

    // Get server name from configuration
    const serverNameConfig = config.get<string>("serverName", "testbench");
    // Prompt user for server name, showing the default value only if it exists
    const serverNameInput = await promptForInput(
        `Enter the server name${serverNameConfig ? ` (Default: ${serverNameConfig})` : ""}`,
        true
    );

    // If user cancels the input prompt, return null to cancel the login process
    if ((!serverNameInput && !serverNameConfig) || serverNameInput === undefined) {
        return null;
    }

    // Use user input if provided, otherwise fallback to configuration value
    const serverName = serverNameInput || serverNameConfig;

    // Get port number from configuration (default: 9445)
    const portConfig = config.get<number>("portNumber", 9445);
    // Prompt user for port number, only showing the default if it's configured
    const portInputAsString = await promptForInput(
        `Enter the port number${portConfig ? ` (Default: ${portConfig})` : ""}`,
        true,
        false,
        (value) => {
            if (value && !/^\d+$/.test(value)) {
                return "Port number must be a number";
            }
            return null;
        }
    );

    if ((!portInputAsString && !portConfig) || portInputAsString === undefined) {
        return null;
    }

    const portNumber = portInputAsString ? parseInt(portInputAsString, 10) : portConfig;

    // Check if the server is accessible
    const serverVersions = await fetchServerVersions(serverName, portNumber);
    if (!serverVersions) {
        vscode.window.showErrorMessage("Server not accessible with the provided server name and port.");
        return null;
    }

    const usernameInput = await promptForInput(
        `Enter your login name (Default: ${config.get<string>("username", "undefined")})`,
        true
    );
    if (usernameInput === undefined) {
        return null;
    }
    const username = usernameInput || config.get<string>("username", "undefined");

    // Prompt for password
    const password = await promptForInput("Enter your password", false, true);
    if (password === undefined) {
        return null;
    }

    return { serverName, portNumber, username, password };
}

// Login to the new play server and return the session token.
async function loginToNewPlayServerAndInitSessionToken(
    context: vscode.ExtensionContext,
    serverName: string,
    portNumber: number,
    username: string,
    password: string,
    baseKey: string
): Promise<PlayServerConnection | null> {
    const requestBody: LoginRequest = {
        login: username,
        password: password,
        force: true,
    };

    try {
        const baseURL = `https://${serverName}:${portNumber}/api`;
        const loginURL = `${baseURL}/login/session/v1`;

        console.log("Sending Login POST request to:", loginURL);

        const response: AxiosResponse<LoginResponse> = await axios.post(loginURL, requestBody, {
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

            // Store password in secret storage if the user chooses to
            const config = vscode.workspace.getConfiguration(baseKey);
            const storePassword = config.get<boolean>("storePasswordAfterLogin", false);
            if (storePassword) {
                await context.secrets.store("password", password);
                console.log("Password stored securely in secret storage.");
            }

            const connection = new PlayServerConnection(context, serverName, portNumber, response.data.sessionToken);
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

// Function to clear stored credentials
async function clearStoredCredentials(context: vscode.ExtensionContext, baseKey: string) {
    try {
        await context.secrets.delete("password");
    } catch (error) {
        console.error("Failed to clear credentials:", error);
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

export async function changeConnection(
    context: vscode.ExtensionContext,
    baseKey: string,
    oldConnection: PlayServerConnection,
    oldTreeDataProvider: ProjectManagementTreeDataProvider
): Promise<{
    newConnection: PlayServerConnection | null;
    newTreeDataProvider: ProjectManagementTreeDataProvider | null;
}> {
    if (oldConnection) {
        await oldConnection.logoutUser(context, oldTreeDataProvider);
        await clearStoredCredentials(context, baseKey);
        let newConnection = await performLogin(context, baseKey, true);

        let newTreeDataProvider: ProjectManagementTreeDataProvider | null = null;
        if (newConnection) {
            [newTreeDataProvider] = await initializeTreeView(context, newConnection);
        }
        return { newConnection, newTreeDataProvider };
    } else {
        vscode.window.showErrorMessage("No connection available. Please log in first.");
    }
    return { newConnection: null, newTreeDataProvider: null };
}

// Retrieves the current versions of the TestBench web server.
// Used to verify the availability of server after receiving the server URL and port number in the login process.
async function fetchServerVersions(serverName: string, portNumber: number): Promise<ServerVersionsResponse | null> {
    try {
        const baseURL = `https://${serverName}:${portNumber}`;
        const serverVersionsURL = `${baseURL}/api/serverVersions/v1`;

        console.log("Fetching server versions with URL:", serverVersionsURL);
        const response: AxiosResponse<ServerVersionsResponse> = await axios.get(serverVersionsURL, {
            headers: {
                Accept: "application/vnd.testbench+json",
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false, // TODO: Should be true in production
            }),
        });

        vscode.window.showInformationMessage(
            `TestBench Release Version: ${response.data.releaseVersion}, Database Version: ${response.data.databaseVersion}, Revision: ${response.data.revision}`
        );
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                console.error(`Error: Received status code ${error.response.status}`, error.response.data);
                if (error.response.status === 404) {
                    console.error(
                        `TestBench version cannot be found under the URL https://${serverName}:${portNumber}`
                    );
                }
            } else if (error.request) {
                console.error("Error: No response received from server.", error.request);
            } else {
                console.error("Error:", error.message);
            }
        } else {
            console.error("Unexpected error:", error);
        }
        return null;
    }
}
