import * as https from "https";
import * as vscode from "vscode";
import * as fs from "fs";
import * as testBenchTypes from "./testBenchTypes";
import * as reportHandler from "./reportHandler";
import JSZip from "jszip";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { ProjectManagementTreeDataProvider } from "./projectManagementTreeView";
import path from "path";
import {
    setConnection,
    baseKey,
    folderNameOfTestbenchWorkingDirectory,
    setProjectManagementTreeDataProvider,
    logger,
} from "./extension";

// Ignore SSL certificate validation in node requests
// TODO: Remove this in production, and use a valid certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Function to save JSON data to a file (For analysing the responses of the server)
function saveJsonToFile(filePath: string, data: any): void {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        // vscode.window.showInformationMessage(`Cycle structure saved to ${filePath}`);
    } catch (error: any) {
        // vscode.window.showErrorMessage(`Error saving file: ${error.message}`);
    }
}

// TestBench server connection
export class PlayServerConnection {
    private context: vscode.ExtensionContext;
    private serverName: string;
    private portNumber: number;
    private sessionToken: string;
    private baseURL: string;
    private apiClient: AxiosInstance; // Axios instance for storing the session and API calls to the server
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

    public getApiClient(): AxiosInstance {
        return this.apiClient;
    }

    async getSessionTokenFromSecretStorage(context: vscode.ExtensionContext): Promise<string | undefined> {
        const token = await context.secrets.get("sessionToken");
        if (!token) {
            logger.error("Session token not found.");
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

    async selectProjectKeyFromProjectList(projectsData: testBenchTypes.Project[]): Promise<string | null> {
        const projectNames: string[] = projectsData.map((project: testBenchTypes.Project) => project.name);
        const selectedProjectName: string | undefined = await vscode.window.showQuickPick(projectNames, {
            placeHolder: "Select a project",
        });

        if (!selectedProjectName) {
            return null;
        }

        logger.debug("Selected project name:", selectedProjectName);
        const selectedProject: testBenchTypes.Project | undefined = projectsData.find(
            (project: testBenchTypes.Project) => project.name === selectedProjectName
        );
        if (!selectedProject) {
            // vscode.window.showErrorMessage("Selected project not found.");
            return null;
        }

        return selectedProject.key;
    }

    async getProjectsList(): Promise<testBenchTypes.Project[] | null> {
        if (!this.sessionToken) {
            logger.warn("Session token is null. Cannot fetch projects list.");
            return null;
        }
        try {
            const projectsURL: string = `/projects/v1`;
            const projectsResponse: AxiosResponse<testBenchTypes.Project[]> = await this.apiClient.get<
                testBenchTypes.Project[]
            >(projectsURL, {
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

            logger.debug("Fetched project list:", projectsResponse.data);
            return projectsResponse.data || [];
        } catch (error) {
            logger.error("Error fetching projects:", error);
            return null;
        }
    }

    async getProjectTreeOfProject(projectKey: string | null): Promise<testBenchTypes.TreeNode | null> {
        if (!this.sessionToken) {
            logger.warn("Session token is null. Cannot fetch project tree:", projectKey);
            return null;
        }
        if (!projectKey) {
            logger.warn("Project key is null or undefined. Cannot fetch project tree.");
            return null;
        }
        try {
            const projectTreeURL: string = `/projects/${projectKey}/tree/v1`;
            const projectTreeResponse: AxiosResponse<testBenchTypes.TreeNode> =
                await this.apiClient.get<testBenchTypes.TreeNode>(projectTreeURL, {
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

            logger.debug("Fetched project tree:", projectTreeResponse.data);
            return projectTreeResponse.data || null;
        } catch (error) {
            logger.error("Error fetching project tree:", error);
            return null;
        }
    }

    async fetchCycleStructure(
        projectKey: string,
        cycleKey: string
    ): Promise<testBenchTypes.CycleStructure | undefined> {
        const cycleStructureUrl: string = `/projects/${projectKey}/cycles/${cycleKey}/structure/v1`;
        const requestBody: testBenchTypes.OptionalJobIDRequestParameter = {
            basedOnExecution: true,
            suppressFilteredData: false,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: [],
        };

        try {
            const response: AxiosResponse<testBenchTypes.CycleStructure> = await this.apiClient.post(
                cycleStructureUrl,
                requestBody,
                {
                    headers: {
                        accept: "application/json",
                        "Content-Type": "application/json",
                    },
                }
            );

            if (response.status === 200) {
                logger.debug("Cycle Structure received:", response.data);

                // User selects a file path for saving the JSON
                /*
                const savePath: vscode.Uri | undefined = await vscode.window.showSaveDialog({
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
                logger.error(`Unexpected response code: ${response.status}`);
            }
        } catch (error) {
            logger.error("Error fetching cycle structure:", error);
        }
    }

    async logoutUser(treeDataProvider: ProjectManagementTreeDataProvider): Promise<void> {
        try {
            const response: AxiosResponse = await this.apiClient.delete(`/login/session/v1`, {
                headers: {
                    accept: "application/vnd.testbench+json",
                },
            });

            if (response.status === 204) {
                if (treeDataProvider) {
                    treeDataProvider.clearTree();
                }

                logger.debug("Logout successful");
                vscode.window.showInformationMessage("Logout successful.");
            } else {
                logger.error(`Unexpected response status: ${response.status}`);
                vscode.window.showWarningMessage(`Unexpected response status: ${response.status}`);
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error(
                    `Error during logout: ${error.response?.status} - ${error.response?.statusText}. If the issue persists, please log in again.`
                );
                vscode.window.showWarningMessage(
                    `Error during logout: ${error.response?.status} - ${error.response?.statusText}. If the issue persists, please log in again.`
                );
            } else {
                logger.error(`An unexpected error occurred: ${error}`);
            }
        } finally {
            // Regardless of the outcome, stop the keep-alive process
            this.stopKeepAlive();
            this.clearSessionData(); // Clear the session data after stopping keep-alive because it also resets keepAliveIntervalId
            vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", false);
            setProjectManagementTreeDataProvider(null); // Clear the connection
            setConnection(null); // Clear the tree data provider
        }
    }

    /**
     * Uploads a zip archive containing JSON-based execution results to the TestBench server.
     * @param projectKey The project key as an integer.
     * @param zipFilePath The file path to the zip archive that contains the execution results as JSON files.
     * @throws Error if the upload fails.
     * @returns A promise that resolves when the upload is successful.
     */
    public async uploadExecutionResults(projectKey: number, zipFilePath: string): Promise<string> {
        const uploadEndpointURL: string = `/projects/${projectKey}/executionResults/v1`;

        try {
            const zipFileData: Buffer = fs.readFileSync(zipFilePath);

            logger.debug(`Uploading zip file ${zipFilePath} to ${uploadEndpointURL}`);
            const response: AxiosResponse = await this.apiClient.post(uploadEndpointURL, zipFileData, {
                headers: {
                    "Content-Type": "application/zip",
                    accept: "application/json",
                },
                validateStatus: () => true, // Use this when you want to handle all status codes manually, otherwise Axios will throw an error for non-2xx status codes
            });

            switch (response.status) {
                case 201:
                    logger.debug("Report uploaded to TestBench Server successfully.");
                    // Extract the fileName from the response and return it
                    const fileName: string | undefined = response.data?.fileName;
                    if (fileName) {
                        return fileName;
                    } else {
                        throw new Error("File name not found in the server response.");
                    }
                case 403:
                    throw new Error(
                        "Forbidden: You do not have permission to perform this action (uploadExecutionResults)."
                    );
                case 404:
                    throw new Error("Not Found: The requested project was not found (uploadExecutionResults).");
                case 422:
                    throw new Error("Unprocessable Entity: The uploaded file is invalid (uploadExecutionResults).");
                default:
                    throw new Error(
                        `Unexpected status code ${response.status} received from the server (uploadExecutionResults).`
                    );
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error("An error occurred while uploading the file:", error.message);
                if (error.response) {
                    console.error("Response data:", error.response.data);
                }
            } else {
                logger.error("An unexpected error occurred:", error);
            }
            throw error;
        }
    }

    /**
     * Imports JSON-based execution results in the given zip archive to a specific project and cycle.
     * @param projectKey The project key as an integer.
     * @param cycleKey The cycle key as an integer.
     * @param importData The data for the import as per API specification.
     * @returns The job ID as a string.
     * @throws Error if an error occurs during the import.
     */
    public async importExecutionResults(
        projectKey: number,
        cycleKey: number,
        importData: testBenchTypes.ImportData
    ): Promise<string> {
        const endpoint: string = `/projects/${projectKey}/cycles/${cycleKey}/import/v1`;

        try {
            const response: AxiosResponse = await this.apiClient.post(endpoint, importData, {
                headers: {
                    "Content-Type": "application/json",
                    accept: "application/json",
                },
                validateStatus: () => true, // We handle status codes manually
            });

            switch (response.status) {
                case 200:
                    const jobID: string | undefined = response.data?.jobID;
                    if (jobID) {
                        logger.debug(`Import initiated successfully. Job ID: ${jobID}`);
                        return jobID;
                    } else {
                        throw new Error(
                            "Success response received but no jobID found in the response (importExecutionResults)."
                        );
                    }
                case 400:
                    throw new Error("Bad Request: The request body structure is wrong (importExecutionResults).");
                case 403:
                    throw new Error(
                        "Forbidden: You do not have permission to perform this action (importExecutionResults)."
                    );
                case 404:
                    throw new Error("Not Found: Project or test cycle not found (importExecutionResults).");
                case 422:
                    throw new Error(
                        "Unprocessable Entity: The server cannot process the request (importExecutionResults)."
                    );
                default:
                    throw new Error(
                        `Unexpected status code ${response.status} received from the server (importExecutionResults).`
                    );
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error("An Axios error occurred:", error.message);
                if (error.response) {
                    console.error("Response data:", error.response.data);
                }
            } else {
                logger.error("An unexpected error occurred:", error);
            }
            throw error;
        }
    }

    private startKeepAlive(): void {
        this.stopKeepAlive(); // Ensure no multiple intervals
        this.keepAliveIntervalId = setInterval(() => {
            this.sendKeepAliveRequest();
        }, 4 * 60 * 1000); // Every 4 minutes
        // console.log("Keep-alive STARTED.");
        // Send an immediate keep-alive request
        this.sendKeepAliveRequest();
    }

    private stopKeepAlive(): void {
        if (this.keepAliveIntervalId) {
            clearInterval(this.keepAliveIntervalId);
            this.keepAliveIntervalId = null;
            // console.log("Keep-alive STOPPED.");
        }
    }

    // Sends a GET request to the server to keep the session alive, which normally times out after 5 minutes
    private async sendKeepAliveRequest(): Promise<void> {
        if (!this.sessionToken) {
            logger.warn("Session token is null. Cannot send keep-alive request.");
            return;
        }
        try {
            await this.apiClient.get(`/login/session/v1`, {
                headers: {
                    accept: "application/vnd.testbench+json",
                },
            });

            // console.log("Keep-alive request SENT.");
        } catch (error) {
            logger.error("Keep-alive request failed:", error);
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
        const input: string | undefined = await vscode.window.showInputBox({
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
        const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKey);
        let storePassword: boolean = config.get<boolean>("storePasswordAfterLogin", false);
        let password: string | undefined;

        // Only retrieve the password if the user has choosen to store it
        if (storePassword) {
            password = await context.secrets.get("password");
        }
        const hasStoredCredentialsAndCanAutoLogin: boolean = !!(
            config.get<string>("serverName") &&
            config.get<string>("username") &&
            password &&
            storePassword
        );

        let useStoredCredentials: boolean = false;
        if (hasStoredCredentialsAndCanAutoLogin && !promptForNewCredentials) {
            const choice: string | undefined = await vscode.window.showInformationMessage(
                "Do you want to login using your previous credentials?",
                { modal: true }, // Modal dialog is used so that the input box wont disappear which locks the login function
                "Yes",
                "No"
            );
            if (choice === "Yes") {
                useStoredCredentials = true;
            }
            // User selected Cancel, which sets choice to undefined
            else if (!choice) {
                logger.debug("Login process aborted.");
                return null;
            }
            // Continue the function in case of "No"
        }

        let serverName: string | undefined;
        let portNumber: number | undefined;
        let username: string | undefined;

        if (useStoredCredentials) {
            serverName = config.get<string>("serverName")!;
            portNumber = config.get<number>("portNumber")!;
            username = config.get<string>("username")!;
        } else {
            const credentials: {
                serverName: string;
                portNumber: number;
                username: string;
                password: string;
            } | null = await promptForLoginCredentials(baseKey);
            if (!credentials) {
                vscode.window.showInformationMessage("Login process aborted.");
                logger.debug("Login process aborted.");
                return null;
            }
            ({ serverName, portNumber, username, password } = credentials);
        }

        // Attempt to login
        const newConnection: PlayServerConnection | null = await loginToNewPlayServerAndInitSessionToken(
            context,
            serverName,
            portNumber,
            username,
            password!,
            baseKey
        );

        if (newConnection) {
            logger.debug("Login successful.");
            vscode.window.showInformationMessage("Login successful.");

            vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", true);
            setConnection(newConnection);
            return newConnection;
        } else {
            // Login may fail due to a server problem or incorrect credentials.
            const retry: string | undefined = await vscode.window.showInformationMessage(
                "Login failed! Do you want to retry?",
                "Retry",
                "Cancel"
            );
            if (retry !== "Retry") {
                vscode.window.showInformationMessage("Login process aborted.");
                logger.debug("Login process aborted");
                return null;
            } else {
                // Continue the loop to retry
            }
        }
    }
}

// Function to prompt user for login credentials
async function promptForLoginCredentials(baseKey: string): Promise<{
    serverName: string;
    portNumber: number;
    username: string;
    password: string;
} | null> {
    const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKey);

    // Get server name from configuration
    const serverNameConfig: string = config.get<string>("serverName", "testbench");
    // Prompt user for server name, showing the default value only if it exists
    const serverNameInput: string | undefined = await promptForInput(
        `Enter the server name${serverNameConfig ? ` (Default: ${serverNameConfig})` : ""}`,
        true
    );

    // If user cancels the input prompt, return null to cancel the login process
    if ((!serverNameInput && !serverNameConfig) || serverNameInput === undefined) {
        return null;
    }

    // Use user input if provided, otherwise fallback to configuration value
    const serverName: string = serverNameInput || serverNameConfig;

    // Get port number from configuration (default: 9445)
    const portConfig: number = config.get<number>("portNumber", 9445);
    // Prompt user for port number, only showing the default if it's configured
    const portInputAsString: string | undefined = await promptForInput(
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

    const portNumber: number = portInputAsString ? parseInt(portInputAsString, 10) : portConfig;

    // Check if the server is accessible
    const serverVersions: testBenchTypes.ServerVersionsResponse | null = await fetchServerVersions(
        serverName,
        portNumber
    );
    if (!serverVersions) {
        logger.error("Server not accessible with the provided server name and port.");
        vscode.window.showErrorMessage("Server not accessible with the provided server name and port.");
        return null;
    }

    const usernameInput: string | undefined = await promptForInput(
        `Enter your login name (Default: ${config.get<string>("username", "undefined")})`,
        true
    );
    if (usernameInput === undefined) {
        return null;
    }
    const username: string = usernameInput || config.get<string>("username", "undefined");

    // Prompt for password
    const password: string | undefined = await promptForInput("Enter your password", false, true);
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
    const requestBody: testBenchTypes.LoginRequestBody = {
        login: username,
        password: password,
        force: true,
    };

    try {
        const baseURL: string = `https://${serverName}:${portNumber}/api`;
        const loginURL: string = `${baseURL}/login/session/v1`;

        // console.log("Sending Login POST request to:", loginURL);

        const response: AxiosResponse<testBenchTypes.LoginResponse> = await axios.post(loginURL, requestBody, {
            headers: {
                accept: "application/vnd.testbench+json",
                "Content-Type": "application/vnd.testbench+json",
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
        });

        if (response.status === 201) {
            // console.log("Login successful. Received session token:", response.data.sessionToken);

            // Store password in secret storage after succesfull login if the user chooses to
            const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKey);
            const storePassword: boolean = config.get<boolean>("storePasswordAfterLogin", false);
            if (storePassword) {
                await context.secrets.store("password", password);
                // console.log("Password stored securely in secret storage.");
            }

            // This starts keep alive in the constructor
            const connection: PlayServerConnection = new PlayServerConnection(
                context,
                serverName,
                portNumber,
                response.data.sessionToken
            );
            if (connection) {
                return connection;
            }
            return null;
        } else {
            logger.error("Login failed. Unexpected status code:", response.status);
            return null;
        }
    } catch (error) {
        logger.error("Error during login:", error);
        return null;
    }
}

// Function to clear stored credentials
export async function clearStoredCredentials(context: vscode.ExtensionContext) {
    try {
        await context.secrets.delete("password");
        logger.debug("Credentials deleted from secrets storage.");
    } catch (error) {
        logger.error("Failed to clear credentials:", error);
    }
}

// Retrieves the current versions of the TestBench web server.
// Used to verify the availability of server after receiving the server URL and port number in the login process.
async function fetchServerVersions(
    serverName: string,
    portNumber: number
): Promise<testBenchTypes.ServerVersionsResponse | null> {
    try {
        const baseURL: string = `https://${serverName}:${portNumber}`;
        const serverVersionsURL: string = `${baseURL}/api/serverVersions/v1`;

        logger.debug("Fetching server versions with URL:", serverVersionsURL);
        const response: AxiosResponse<testBenchTypes.ServerVersionsResponse> = await axios.get(serverVersionsURL, {
            headers: {
                Accept: "application/vnd.testbench+json",
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false, // TODO: Should be true in production
            }),
        });

        // vscode.window.showInformationMessage(`TestBench Release Version: ${response.data.releaseVersion}, Database Version: ${response.data.databaseVersion}, Revision: ${response.data.revision}`);
        logger.debug(
            `TestBench Release Version: ${response.data.releaseVersion}, Database Version: ${response.data.databaseVersion}, Revision: ${response.data.revision}`
        );
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                logger.error(`Error: Received status code ${error.response.status}`, error.response.data);
                if (error.response.status === 404) {
                    logger.error(`TestBench version cannot be found under the URL https://${serverName}:${portNumber}`);
                }
            } else if (error.request) {
                logger.error("Error: No response received from server.", error.request);
            } else {
                logger.error("Error:", error.message);
            }
        } else {
            logger.error("Unexpected error:", error);
        }
        return null;
    }
}

async function promptForReportZipFileWithResults(): Promise<string | undefined> {
    try {
        const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKey);
        const workspacePath: string | undefined = config.get<string>("workspaceLocation");
        const workingDirectoryFullPath: string = path.join(workspacePath!, folderNameOfTestbenchWorkingDirectory);

        const options: vscode.OpenDialogOptions = {
            defaultUri: vscode.Uri.file(workingDirectoryFullPath),
            openLabel: "Select Zip File with Test Results",
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            filters: {
                "Zip Files": ["zip"],
            },
        };

        const fileUri: vscode.Uri[] | undefined = await vscode.window.showOpenDialog(options);

        if (!fileUri || !fileUri[0]) {
            vscode.window.showErrorMessage("No file selected. Please select a valid .zip file.");
            logger.debug("No .zip file selected for report selection.");
            return undefined;
        }

        const selectedFilePath: string = fileUri[0].fsPath;
        if (!selectedFilePath.endsWith(".zip")) {
            vscode.window.showErrorMessage("Selected file is not a .zip file. Please select a valid .zip file.");
            logger.debug("Selected file is not a .zip file.");
            return undefined;
        }

        return selectedFilePath;
    } catch (error: any) {
        vscode.window.showErrorMessage(`An error occurred while selecting the report zip file: ${error.message}`);
        logger.error(`An error occurred while selecting the report zip file: ${error.message}`);
        return undefined;
    }
}

// Helper function to find the cycle key from the cycle name
function findCycleKeyFromCycleName(elements: any[], cycleName: string): string | null {
    for (const element of elements) {
        if (
            (element.item?.nodeType === "Cycle" && element.item?.name === cycleName) ||
            (element.nodeType === "Cycle" && element.name === cycleName)
        ) {
            return element.key;
        }

        // Recursively search in children elements
        const children: any[] = element.item?.children || element.children;
        if (children && children.length > 0) {
            const foundKey = findCycleKeyFromCycleName(children, cycleName);
            if (foundKey) return foundKey;
        }
    }
    return null;
}

// TODO: remove projectManagementTreeDataProvider when we replace local search with server project tree fetching and then searching
export async function importReportWithResultsToTestbench(
    connection: PlayServerConnection,
    projectManagementTreeDataProvider: ProjectManagementTreeDataProvider,
    resultZipFilePath: string
) {
    try {
        logger.debug("Importing report with results to TestBench server.");

        const { uniqueID, projectKey, cycleNameOfProject } = await extractDataFromReportile(resultZipFilePath);

        if (!uniqueID || !projectKey || !cycleNameOfProject) {
            vscode.window.showErrorMessage("Error extracting project key, cycle name and unique ID from the zip file.");
            logger.error("Error extracting project key, cycle name and unique ID from the zip file.");
            return;
        }

        /*
        // Save the contents of the variable to a file called allTreeElements.json
        const allTreeElementsPath = path.join(__dirname, "allTreeElements.json");
        saveJsonToFile(allTreeElementsPath, allTreeElements);
        console.log(`allTreeElements saved to ${allTreeElementsPath}`);
        */

        // TODO: We are currently searching for the Cycle key of the exported test theme locally, which causes issues if the project management tree is not initialized.
        // Later, we should fetch the project tree from the server and search for the cycle key there.
        const allTreeElementsInTreeView: any[] = await projectManagementTreeDataProvider?.getChildren(undefined);
        if (!allTreeElementsInTreeView) {
            logger.error("Failed to load project management tree elements to import results.");
            vscode.window.showErrorMessage("Failed to load project management tree elements.");
            return;
        }
        const cycleKeyOfImportedReport: string | null = findCycleKeyFromCycleName(
            allTreeElementsInTreeView,
            cycleNameOfProject
        );
        if (!cycleKeyOfImportedReport) {
            logger.error("Cycle not found in the project tree.");
            vscode.window.showErrorMessage("Cycle not found in the project tree.");
            return;
        }

        // Upload the zip file containing the results to TestBench server        
        const zipFilenameFromServer: string = await connection.uploadExecutionResults(
            Number(projectKey),
            resultZipFilePath
        );
        if (!zipFilenameFromServer) {
            logger.error("Error uploading the result zip file to the server.");
            vscode.window.showErrorMessage("Error uploading the results to the server.");
            return;
        }

        // TODO: Chech the new data of the new branch
        // Import the results to TestBench server
        const importData: testBenchTypes.ImportData = {
            fileName: zipFilenameFromServer,
            reportRootUID: uniqueID,
            useExistingDefect: true,
            ignoreNonExecutedTestCases: true,
            checkPaths: true,
            discardTesterInformation: false,
            // defaultTester: "tester",
            filters: [
                /*
                {
                    name: "Filter1",
                    filterType: "TestTheme",
                    testThemeUID: "themeUID456",
                },
                */
            ],
        };
        try {
            // Start the import job
            logger.debug("Starting import execution results");
            const jobID: string = await connection.importExecutionResults(
                Number(projectKey),
                Number(cycleKeyOfImportedReport),
                importData
            );

            // Poll the job status until it is completed
            const jobStatus: testBenchTypes.JobStatusResponse | null = await reportHandler.pollJobStatus(
                projectKey.toString(),
                jobID,
                "import"
            );

            // Check if the job is completed successfully
            if (!jobStatus || reportHandler.isImportJobFailed(jobStatus)) {
                logger.warn("Import not completed or failed.");
                vscode.window.showErrorMessage("Import not completed or failed.");
                return undefined;
            } else {
                logger.debug("Import completed successfully. Job Status:", jobStatus);
                vscode.window.showInformationMessage("Import completed successfully.");
            }
        } catch (error: any) {
            logger.error("Error:", error.message);
        }
    } catch (error: any) {
        logger.error("Error:", error.message);
        vscode.window.showErrorMessage(`An unexpected error occurred: ${error.message}`);
    }
}

// Import the report zip file which contains the test results to TestBench server
export async function selectReportWithResultsAndImportToTestbench(
    connection: PlayServerConnection,
    projectManagementTreeDataProvider: ProjectManagementTreeDataProvider
) {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Importing results to TestBench server`,
            cancellable: true,
        },
        async (progress, cancellationToken) => {
            if (progress) {
                progress.report({
                    message: `Selecting report file with results.`,
                    increment: 30,
                });
            }

            // const resultZipFileName = "ReportWithoutResultsForTb2robot.zip"; //"ReportWithResults.zip";
            const resultZipFilePath: string | undefined = await promptForReportZipFileWithResults();
            if (!resultZipFilePath) {
                // vscode.window.showErrorMessage("No location selected for the ReportWithResults.zip file.");
                return;
            }

            if (progress) {
                progress.report({
                    message: `Selecting report file with results.`,
                    increment: 30,
                });
            }

            await importReportWithResultsToTestbench(connection, projectManagementTreeDataProvider, resultZipFilePath);

            if (progress) {
                progress.report({
                    message: `Cleaning up.`,
                    increment: 30,
                });
            }
            const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKey);
            if (config.get<boolean>("clearReportAfterProcessing")) {
                // Remove the report zip file after usage
                await reportHandler.removeReportZipFile(resultZipFilePath);
            }
        }
    );
}

interface ExtractedData {
    uniqueID: string | null;
    projectKey: string | null;
    cycleNameOfProject: string | null;
}

async function extractDataFromReportile(zipFilePath: string): Promise<ExtractedData> {
    try {
        // Read zip file from disk
        const zipData: Buffer = await new Promise<Buffer>((resolve, reject) => {
            fs.readFile(path.resolve(zipFilePath), (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
        const zip: JSZip = new JSZip();

        // Load zip data
        const zipContents: JSZip = await zip.loadAsync(zipData);

        // Define file names
        const cycleStructureFile: string = "cycle_structure.json";
        const projectFile: string = "project.json";

        // Extract JSON content
        const cycleStructureJson = await extractAndParseJsonContent(zipContents, cycleStructureFile);
        const projectJson = await extractAndParseJsonContent(zipContents, projectFile);

        // Parse JSON and extract required fields
        const uniqueID: string | null = cycleStructureJson?.root?.base?.uniqueID || null;
        const projectKey: string | null = projectJson?.key || null;
        const cycleNameOfProject: string | null = projectJson?.projectContext?.cycleName || null;

        return { uniqueID, projectKey, cycleNameOfProject };
    } catch (error) {
        logger.error("Error extracting JSON data from zip file:", error);
        return { uniqueID: null, projectKey: null, cycleNameOfProject: null };
    }
}

// Helper function to extract and parse JSON file content
async function extractAndParseJsonContent(zipContents: JSZip, fileName: string): Promise<any> {
    try {
        const fileData: string | undefined = await zipContents.file(fileName)?.async("string");
        return fileData ? JSON.parse(fileData) : null;
    } catch (error) {
        logger.error(`Error reading or parsing ${fileName}:`, error);
        return null;
    }
}
