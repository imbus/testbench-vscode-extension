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
    getConfig,
    setConnection,
    baseKeyOfExtension,
    folderNameOfTestbenchWorkingDirectory,
    setProjectManagementTreeDataProvider,
    logger,
    loginWebViewProvider,
} from "./extension";
import * as loginWebView from "./loginWebView";

// Ignore SSL certificate validation in node requests
// TODO: Remove this in production, and use a valid certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

/**
 * Function to save JSON data to a file (For analysing the responses of the server)
 * @param filePath The file path to save the JSON data
 * @param data The JSON data to save
 */
function saveJsonToFile(filePath: string, data: any): void {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        // logger.trace(`JSON data saved to ${filePath}`);
    } catch (error: any) {
        // logger.error(`Error saving JSON data to ${filePath}: ${error.message}`);
    }
}

// Class to handle the connection to the TestBench server.
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

        // Create Axios instance for API calls to the server using the session token
        this.apiClient = axios.create({
            baseURL: this.baseURL,
            headers: {
                Authorization: this.sessionToken,
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false, // TODO: Should be true in production
            }),
        });

        // Start the keep-alive process to prevent session timeout after 5 minutes
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
        const token: string | undefined = await context.secrets.get("sessionToken");
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

    /**
     * Select a project key from the quick pick list of projects fetched from the server.
     * @param projectsData The list of projects fetched from the server.
     * @returns {Promise<string | null>} The selected project key as a string or null if no project is selected.
     */
    async getProjectKeyFromProjectListQuickPickSelection(
        projectsData: testBenchTypes.Project[]
    ): Promise<string | null> {
        const projectNames: string[] = projectsData.map((project: testBenchTypes.Project) => project.name);
        // Display a quick pick list of project names for the user to select a project name
        const selectedProjectName: string | undefined = await vscode.window.showQuickPick(projectNames, {
            placeHolder: "Select a project",
        });

        if (!selectedProjectName) {
            logger.error("Selected project name not found.");
            return null;
        }

        logger.debug("Selected project name:", selectedProjectName);
        const selectedProject: testBenchTypes.Project | undefined = projectsData.find(
            (project: testBenchTypes.Project) => project.name === selectedProjectName
        );
        if (!selectedProject) {
            // vscode.window.showErrorMessage("Selected project not found.");
            logger.error("Selected project not found.");
            return null;
        }

        return selectedProject.key;
    }

    /**
     * Fetches the list of projects from the TestBench server.
     * @returns {Promise<testBenchTypes.Project[] | null>} The list of projects fetched from the server or null if an error occurs.
     */
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

            // Save the response from server to a file for analyzing the structure
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

            logger.trace("Response status of project list request:", projectsResponse.status);
            if (projectsResponse.data) {
                logger.trace("Fetched project list:", projectsResponse.data);
                return projectsResponse.data;
            } else {
                logger.warn("Project list data is null or undefined.");
                return null;
            }
        } catch (error) {
            // Axios throws an error if the response status is not 2xx
            logger.error("Error fetching projects:", error);
            return null;
        }
    }

    /**
     * Fetches the project tree of a specific project from the TestBench server.
     * @param projectKey The project key as a string.
     * @returns {Promise<testBenchTypes.TreeNode | null>} The project tree fetched from the server or null if an error occurs.
     */
    async getProjectTreeOfProject(projectKey: string | null): Promise<testBenchTypes.TreeNode | null> {
        if (!this.sessionToken) {
            logger.warn("Session token is null. Cannot fetch project tree for the project key:", projectKey);
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

            logger.trace("Response status of project tree request:", projectTreeResponse.status);
            if (projectTreeResponse.data) {
                logger.trace("Fetched project tree:", projectTreeResponse.data);
                return projectTreeResponse.data;
            } else {
                logger.warn("Project tree data is null or undefined.");
                return null;
            }
        } catch (error) {
            logger.error("Error fetching project tree:", error);
            return null;
        }
    }

    /**
     * Fetches the cycle structure of a specific project and cycle from the TestBench server.
     * @param projectKey The project key as a string.
     * @param cycleKey The cycle key as a string.
     * @returns {Promise<testBenchTypes.CycleStructure | null>} The cycle structure fetched from the server or null if an error occurs.
     */
    async fetchCycleStructureOfCycleInProject(
        projectKey: string,
        cycleKey: string
    ): Promise<testBenchTypes.CycleStructure | null> {
        const cycleStructureUrl: string = `/projects/${projectKey}/cycles/${cycleKey}/structure/v1`;
        const requestBody: testBenchTypes.OptionalJobIDRequestParameter = {
            basedOnExecution: true,
            suppressFilteredData: false,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: [],
        };

        try {
            const cycleStructureResponse: AxiosResponse<testBenchTypes.CycleStructure> = await this.apiClient.post(
                cycleStructureUrl,
                requestBody,
                {
                    headers: {
                        accept: "application/json",
                        "Content-Type": "application/json",
                    },
                }
            );

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

            logger.trace("Response status of cycle structure request:", cycleStructureResponse.status);
            if (cycleStructureResponse.data) {
                logger.trace("Cycle Structure received:", cycleStructureResponse.data);
                return cycleStructureResponse.data;
            } else {
                logger.error(`Unexpected response code: ${cycleStructureResponse.status}`);
                return null;
            }
        } catch (error) {
            logger.error("Error fetching cycle structure:", error);
            return null;
        }
    }

    /**
     * Logs out the user from the TestBench server, clears the session data and stops the keep-alive process, clears the tree data provider which empties the tree view.
     * @param treeDataProvider The tree data provider to clear the tree after logout.
     * @returns {Promise<void | null>} A promise that resolves when the logout is successful or null if an error occurs.
     */
    async logoutUser(treeDataProvider: ProjectManagementTreeDataProvider): Promise<void | null> {
        logger.trace("Logging out user.");
        try {
            const logoutResponse: AxiosResponse = await this.apiClient.delete(`/login/session/v1`, {
                headers: {
                    accept: "application/vnd.testbench+json",
                },
            });

            if (logoutResponse.status === 204) {
                if (treeDataProvider) {
                    treeDataProvider.clearTree();
                }

                const logoutSuccessfulMessage: string = "Logout successful.";
                logger.debug(logoutSuccessfulMessage);
                vscode.window.showInformationMessage(logoutSuccessfulMessage);
            } else {
                const logoutFailedMessage: string = `Logout failed. Unexpected response status: ${logoutResponse.status}`;
                logger.error(logoutFailedMessage);
                vscode.window.showWarningMessage(logoutFailedMessage);
                return null;
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const logoutErrorMessage: string = `Error during logout: ${error.response?.status} - ${error.response?.statusText}. If the issue persists, please log in again.`;
                logger.error(logoutErrorMessage);
                vscode.window.showWarningMessage(logoutErrorMessage);
                return null;
            } else {
                logger.error(`An unexpected error occurred: ${error}`);
                return null;
            }
        } finally {
            // Regardless of the outcome of logout operation, stop the keep-alive process
            this.stopKeepAlive();
            this.clearSessionData(); // Clear the session data after stopping keep-alive because it also resets keepAliveIntervalId
            vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", false);
            setProjectManagementTreeDataProvider(null); // Clear the connection
            setConnection(null); // Clear the tree data provider
            // Notify login webview about the logout success to change its HTML content
            if (loginWebViewProvider) {
                loginWebViewProvider.updateWebviewContent();
            } else {
                logger.warn("loginWebViewProvider is null. Cannot update the webview content.");
            }
        }
    }

    /**
     * Uploads a zip archive containing JSON-based execution results to the TestBench server.
     * @param projectKey The project key as an integer.
     * @param zipFilePath The file path to the zip archive that contains the execution results as JSON files.
     * @returns {Promise<string>} A promise that resolves when the upload is successful.
     * @throws Error if the upload fails.
     */
    public async uploadExecutionResultsAndReturnUploadedFileName(
        projectKey: number,
        zipFilePath: string
    ): Promise<string> {
        const uploadResultZipURL: string = `/projects/${projectKey}/executionResults/v1`;

        try {
            const zipFileData: Buffer = fs.readFileSync(zipFilePath);

            logger.debug(`Uploading zip file ${zipFilePath} to ${uploadResultZipURL}`);
            const uploadZipResponse: AxiosResponse = await this.apiClient.post(uploadResultZipURL, zipFileData, {
                headers: {
                    "Content-Type": "application/zip",
                    accept: "application/json",
                },
                validateStatus: () => true, // Use this when you want to handle all status codes manually, otherwise Axios will throw an error for non-2xx status codes
            });

            switch (uploadZipResponse.status) {
                case 201:
                    logger.debug("Report uploaded to TestBench Server successfully.");
                    // Extract the fileName from the response and return it
                    const fileName: string | undefined = uploadZipResponse.data?.fileName;
                    if (fileName) {
                        return fileName;
                    } else {
                        const fileNameNotFoundMessage: string = "File name not found in the server response.";
                        logger.error(fileNameNotFoundMessage);
                        throw new Error(fileNameNotFoundMessage);
                    }
                case 403:
                    const uploadForbiddenMessage: string =
                        "Forbidden: You do not have permission to perform this action (Upload execution results).";
                    logger.error(uploadForbiddenMessage);
                    throw new Error(uploadForbiddenMessage);

                case 404:
                    const uploadNotFoundMessage: string =
                        "Not Found: The requested project was not found (Upload execution results).";
                    logger.error(uploadNotFoundMessage);
                    throw new Error(uploadNotFoundMessage);
                case 422:
                    const uploadUnprocessableEntityMessage: string =
                        "Unprocessable Entity: The uploaded file is invalid (Upload execution results).";
                    logger.error(uploadUnprocessableEntityMessage);
                    throw new Error(uploadUnprocessableEntityMessage);
                default:
                    const uploadUnexpectedMessage: string = `Unexpected status code ${uploadZipResponse.status} received from the server (Upload execution results).`;
                    logger.error(uploadUnexpectedMessage);
                    throw new Error(uploadUnexpectedMessage);
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error("An error occurred while uploading the file:", error.message);
                if (error.response) {
                    logger.error("Error response data:", error.response.data);
                }
            } else {
                logger.error("An unexpected error occurred:", error);
            }
            throw error;
        }
    }

    /**
     * Fetches the job ID of the import job from the TestBench server, which will be used for polling the import job status later.
     * @param projectKey The project key as an integer.
     * @param cycleKey The cycle key as an integer.
     * @param importData The data for the import as per API specification.
     * @returns {Promise<string>} The job ID as a string.
     * @throws Error if an error occurs during the import.
     */
    public async getJobIDOfImportJob(
        projectKey: number,
        cycleKey: number,
        importData: testBenchTypes.ImportData
    ): Promise<string> {
        const getJobIDOfImportUrl: string = `/projects/${projectKey}/cycles/${cycleKey}/import/v1`;

        try {
            const importJobIDResponse: AxiosResponse = await this.apiClient.post(getJobIDOfImportUrl, importData, {
                headers: {
                    "Content-Type": "application/json",
                    accept: "application/json",
                },
                validateStatus: () => true, // We handle status codes manually
            });

            switch (importJobIDResponse.status) {
                case 200:
                    const jobID: string | undefined = importJobIDResponse.data?.jobID;
                    if (jobID) {
                        logger.debug(`Import initiated successfully. Job ID: ${jobID}`);
                        return jobID;
                    } else {
                        const importJobIDNotFoundMessage: string =
                            "Success response received but no jobID found in the response (Import execution results).";
                        logger.error(importJobIDNotFoundMessage);
                        throw new Error(importJobIDNotFoundMessage);
                    }
                case 400:
                    const importBadRequestMessage: string =
                        "Bad Request: The request body structure is wrong (Import execution results).";
                    logger.error(importBadRequestMessage);
                    throw new Error(importBadRequestMessage);
                case 403:
                    const importForbiddenMessage: string =
                        "Forbidden: You do not have permission to perform this action (Import execution results).";
                    logger.error(importForbiddenMessage);
                    throw new Error(importForbiddenMessage);
                case 404:
                    const importNotFoundMessage: string =
                        "Not Found: Project or test cycle not found (Import execution results).";
                    logger.error(importNotFoundMessage);
                    throw new Error(importNotFoundMessage);
                case 422:
                    const importUnprocessableEntityMessage: string =
                        "Unprocessable Entity: The server cannot process the request (Import execution results).";
                    logger.error(importUnprocessableEntityMessage);
                    throw new Error(importUnprocessableEntityMessage);
                default:
                    const importUnexpectedMessage: string = `Unexpected status code ${importJobIDResponse.status} received from the server (Import execution results).`;
                    logger.error(importUnexpectedMessage);
                    throw new Error(importUnexpectedMessage);
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error("An Axios error occurred:", error.message);
                if (error.response) {
                    logger.error("Error response data:", error.response.data);
                }
            } else {
                logger.error("An unexpected error occurred:", error);
            }
            throw error;
        }
    }

    /**
     * Starts the keep-alive process to prevent the session from timing out.
     * The keep-alive process sends a GET request to the server every 4 minutes.
     * The constructor method of the PlayServerConnection class starts the keep-alive process automatically.
     * If the session token is null, the keep-alive process is not started.
     * If the keep-alive process is already running and it is triggered again, the previous one is stopped before starting a new one.
     */
    private startKeepAlive(): void {
        this.stopKeepAlive(); // Ensure no multiple intervals
        this.keepAliveIntervalId = setInterval(() => {
            this.sendKeepAliveRequest();
        }, 4 * 60 * 1000); // Every 4 minutes
        // console.log("Keep-alive STARTED.");
        // Send an immediate keep-alive request
        this.sendKeepAliveRequest();
        logger.trace("Keep-alive started.");
    }

    // Stops the keep-alive process.
    private stopKeepAlive(): void {
        if (this.keepAliveIntervalId) {
            clearInterval(this.keepAliveIntervalId);
            this.keepAliveIntervalId = null;
            logger.trace("Keep-alive stopped.");
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
            logger.trace("Keep-alive request sent.");
        } catch (error) {
            logger.error("Keep-alive request failed:", error);
        }
    }
}

/**
 * A generalized method to prompt for any user input in VS Code input box with live validation.
 * The function loops until the user provides a valid input or cancels the prompt. The prompt also quits by typing "quit".
 * @param promptMessage The prompt message to display to the user.
 * @param inputCanBeEmpty Whether the input can be empty or not.
 * @param maskSensitiveInputData Whether the input should be hidden such as a password or not.
 * @param validateInputFunction A function to validate the input. If the input is invalid, the function should return an error message.
 * If the input is valid, the function should return null.
 * @returns {Promise<string | null>} A promise that resolves with the user input as a string or null if the user cancels the prompt.
 */
async function promptForInputAndValidate(
    promptMessage: string,
    inputCanBeEmpty: boolean = false,
    maskSensitiveInputData: boolean = false,
    validateInputFunction?: (value: string) => string | null
): Promise<string | null> {
    while (true) {
        const input: string | undefined = await vscode.window.showInputBox({
            prompt: promptMessage,
            password: maskSensitiveInputData,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!inputCanBeEmpty && value === "") {
                    return "Value cannot be empty";
                }
                if (validateInputFunction) {
                    return validateInputFunction(value);
                }
                return null;
            },
        });

        if (input === undefined || input.toLowerCase() === "quit") {
            vscode.window.showInformationMessage("Login process aborted");
            return null;
        }

        if (!validateInputFunction || validateInputFunction(input) === null) {
            return input;
        }

        vscode.window.showErrorMessage(validateInputFunction(input) || "Invalid input, please try again.");
    }
}

/**
 * Function to perform the login process to the TestBench server by prompting the user for the server name, port number, username, and password.
 * Loops until the user successfully logs in or cancels the login process.
 * @param context The extension context
 * @param baseKey The base key for the configuration settings
 * @param promptForNewCredentials Whether to prompt the user for new credentials or not. Default is false.
 * @returns {Promise<PlayServerConnection | null>} A promise that resolves with the connection object if the login is successful, otherwise null.
 */
export async function performLogin(
    context: vscode.ExtensionContext,
    baseKey: string,
    promptForNewCredentials: boolean = false,
    performAutoLoginWithStoredCredentialsWithoutPrompting?: boolean
): Promise<PlayServerConnection | null> {
    // Loop until the user successfully logs in or cancels the login process
    while (true) {
        // Retrieve the stored credentials if they exist
        let storePasswordAfterSuccessfulLogin: boolean = getConfig().get<boolean>("storePasswordAfterLogin", false);
        let password: string | undefined;

        // Only retrieve the password if the user has choosen to store it
        if (storePasswordAfterSuccessfulLogin) {
            password = await context.secrets.get("password");
        }
        const userHasStoredCredentialsAndCanAutoLogin: boolean = !!(
            getConfig().get<string>("serverName") &&
            getConfig().get<string>("username") &&
            password &&
            storePasswordAfterSuccessfulLogin
        );

        let useStoredCredentials: boolean = false;
        // If the user has stored credentials and can auto-login, 
        // and the user has not chosen to prompt for new credentials, 
        // and the user has not chosen to auto-login without prompting, then auto-login
        if (userHasStoredCredentialsAndCanAutoLogin && !promptForNewCredentials && !performAutoLoginWithStoredCredentialsWithoutPrompting) {
            const choice: string | undefined = await vscode.window.showInformationMessage(
                "Do you want to login using your previous credentials?",
                { modal: true }, // Modal dialog is used so that the input box wont disappear, which forces the user to choose an option. Without it, login may be locked.
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
        else {
            // Convert undefined value to false with !! if the optional parameter is not provided
            useStoredCredentials = !!performAutoLoginWithStoredCredentialsWithoutPrompting;
        }

        let serverName: string | undefined;
        let portNumber: number | undefined;
        let username: string | undefined;

        // If the user has stored credentials and wants to use them, retrieve them from the configuration, else prompt the user for new credentials
        if (useStoredCredentials) {
            serverName = getConfig().get<string>("serverName")!;
            portNumber = getConfig().get<number>("portNumber")!;
            username = getConfig().get<string>("username")!;
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

/**
 * Function to prompt user for login credentials
 * @param baseKey The base key for the configuration settings
 * @returns {Promise<{ serverName: string; portNumber: number; username: string; password: string } | null>}
 * A promise that resolves with the login credentials if the user provides them, otherwise null.
 */
async function promptForLoginCredentials(baseKey: string): Promise<{
    serverName: string;
    portNumber: number;
    username: string;
    password: string;
} | null> {
    // Get server name from configuration
    const serverNameInConfig: string = getConfig().get<string>("serverName", "testbench");
    // Prompt user for server name, showing the default value only if it exists
    const serverNameInput: string | null = await promptForInputAndValidate(
        `Enter the server name${serverNameInConfig ? ` (Default: ${serverNameInConfig})` : ""}`,
        true
    );

    // If user cancels the input prompt, return null to cancel the login process
    if ((!serverNameInput && !serverNameInConfig) || serverNameInput === undefined) {
        logger.trace("Login process aborted while entering server name.");
        return null;
    }

    // Use user input if provided, otherwise fallback to configuration value
    const serverName: string = serverNameInput || serverNameInConfig;

    // Get port number from configuration (default: 9445)
    const portInConfig: number = getConfig().get<number>("portNumber", 9445);
    // Prompt user for port number, only showing the default if it's configured
    const portInputAsString: string | null = await promptForInputAndValidate(
        `Enter the port number${portInConfig ? ` (Default: ${portInConfig})` : ""}`,
        true,
        false,
        (value) => {
            if (value && !/^\d+$/.test(value)) {
                return "Port number must be a number";
            }
            return null;
        }
    );

    if ((!portInputAsString && !portInConfig) || portInputAsString === undefined) {
        logger.trace("Login process aborted while etnering port number.");
        return null;
    }

    const portNumber: number = portInputAsString ? parseInt(portInputAsString, 10) : portInConfig;

    // Check if the server is accessible
    const serverVersionsResponse: testBenchTypes.ServerVersionsResponse | null = await fetchServerVersions(
        serverName,
        portNumber
    );
    if (!serverVersionsResponse) {
        const serverVersionsErrorMessage: string = "Server not accessible with the provided server name and port.";
        logger.error(serverVersionsErrorMessage);
        vscode.window.showErrorMessage(serverVersionsErrorMessage);
        return null;
    }

    const usernameInput: string | null = await promptForInputAndValidate(
        `Enter your login name (Default: ${getConfig().get<string>("username", "undefined")})`,
        true
    );
    if (!usernameInput) {
        logger.trace("Login process aborted while entering username.");
        return null;
    }
    const username: string = usernameInput || getConfig().get<string>("username", "undefined");

    // Prompt for password
    const password: string | null = await promptForInputAndValidate("Enter your password", false, true);
    if (!password) {
        logger.trace("Login process aborted while entering password.");
        return null;
    }

    return { serverName, portNumber, username, password };
}

/**
 * Login to the new play server and return the session token.
 * @param context The extension context
 * @param serverName The server name
 * @param portNumber The port number
 * @param username The username
 * @param password The password
 * @param baseKey The base key for the configuration settings
 * @returns {Promise<PlayServerConnection | null>} A promise that resolves with the connection object if the login is successful, otherwise null.
 */
export async function loginToNewPlayServerAndInitSessionToken(
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
        const connection = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Logging in",
                cancellable: true,
            },
            async (progress, token) => {
                const baseURL: string = `https://${serverName}:${portNumber}/api`;
                const loginURL: string = `${baseURL}/login/session/v1`;

                logger.trace("Sending Login request to:", loginURL);
                progress.report({ message: "Sending login request..." });

                const loginResponse: AxiosResponse<testBenchTypes.LoginResponse> = await axios.post(
                    loginURL,
                    requestBody,
                    {
                        headers: {
                            accept: "application/vnd.testbench+json",
                            "Content-Type": "application/vnd.testbench+json",
                        },
                        httpsAgent: new https.Agent({
                            rejectUnauthorized: false,
                        }),
                    }
                );

                // An exception is thrown automatically if the status code is not 2xx
                if (loginResponse.status === 201) {
                    // Store password in secret storage after succesfull login if the user chooses to
                    const storePassword: boolean = getConfig().get<boolean>("storePasswordAfterLogin", false);
                    if (storePassword) {
                        await context.secrets.store("password", password);
                        logger.trace("Password stored securely in secret storage.");
                    }

                    // This starts keep alive in the constructor
                    const newConnection: PlayServerConnection = new PlayServerConnection(
                        context,
                        serverName,
                        portNumber,
                        loginResponse.data.sessionToken
                    );
                    setConnection(newConnection); // Set the global connection object, it can be null in case the login fails
                    if (newConnection) {
                        // Set the connectionActive context value for changing the login icon to logout icon based on this value
                        vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", true);
                        const loginSuccessfulMessage: string = "Login successful.";
                        logger.debug(loginSuccessfulMessage);
                        vscode.window.showInformationMessage(loginSuccessfulMessage);
                        if (loginWebViewProvider) {
                            loginWebViewProvider.updateWebviewContent(); // Notify webview about the login success to change its HTML content
                            loginWebView.hideWebView(); // Hide the webview after successful login
                        } else {
                            logger.warn("loginWebViewProvider is null. Cannot update the webview content.");
                        }

                        return newConnection;
                    }
                    logger.error("Connection object is null after successful login.");
                    return null;
                } else {
                    const loginFailedMessage: string = "Login failed. Unexpected status code: " + loginResponse.status;
                    logger.error(loginFailedMessage);
                    vscode.window.showInformationMessage(loginFailedMessage);
                    return null;
                }
            }
        );
        return connection;
    } catch (error) {
        logger.error("Error during login:", error); // Note: The error log could be very large in the log file
        vscode.window.showInformationMessage("Error during login.");
        return null;
    }
}

/**
 * Function to clear stored user credentials
 * @param context The extension context
 */
export async function clearStoredCredentials(context: vscode.ExtensionContext): Promise<void> {
    try {
        await context.secrets.delete("password");
        logger.debug("Credentials deleted from secrets storage.");
    } catch (error) {
        logger.error("Failed to clear credentials:", error);
    }
}

/**
 * Retrieves the current versions of the TestBench web server. Used to verify the availability of server after receiving the server URL and port number in the login process.
 * @param serverName The server name
 * @param portNumber The port number
 * @returns {Promise<testBenchTypes.ServerVersionsResponse | null>} A promise that resolves with the server versions if successful, otherwise null.
 */
async function fetchServerVersions(
    serverName: string,
    portNumber: number
): Promise<testBenchTypes.ServerVersionsResponse | null> {
    try {
        const baseURL: string = `https://${serverName}:${portNumber}`;
        const serverVersionsURL: string = `${baseURL}/api/serverVersions/v1`;

        logger.debug("Fetching server versions with URL:", serverVersionsURL);
        const serverVersionsResponse: AxiosResponse<testBenchTypes.ServerVersionsResponse> = await axios.get(
            serverVersionsURL,
            {
                headers: {
                    Accept: "application/vnd.testbench+json",
                },
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false, // TODO: Should be true in production
                }),
            }
        );

        // vscode.window.showInformationMessage(`TestBench Release Version: ${response.data.releaseVersion}, Database Version: ${response.data.databaseVersion}, Revision: ${response.data.revision}`);
        logger.debug(
            `TestBench Release Version: ${serverVersionsResponse.data.releaseVersion}, Database Version: ${serverVersionsResponse.data.databaseVersion}, Revision: ${serverVersionsResponse.data.revision}`
        );
        return serverVersionsResponse.data;
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

/**
 * Opens a file select dialog for the user to select a zip file with the test results.
 * @returns {Promise<string | null>} A promise that resolves with the zip file path if the user selects a file, otherwise null.
 */
async function promptForReportZipFileWithResults(): Promise<string | null> {
    try {
        const workspaceLocation: string | undefined = getConfig().get<string>("workspaceLocation");
        const workingDirectoryPath: string = path.join(workspaceLocation!, folderNameOfTestbenchWorkingDirectory);

        const options: vscode.OpenDialogOptions = {
            defaultUri: vscode.Uri.file(workingDirectoryPath),
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
            logger.debug("No zip file selected for report selection.");
            return null;
        }

        const selectedFilePath: string = fileUri[0].fsPath;
        if (!selectedFilePath.endsWith(".zip")) {
            vscode.window.showErrorMessage("Selected file is not a .zip file. Please select a valid .zip file.");
            logger.debug("Selected file is not a .zip file.");
            return null;
        }

        return selectedFilePath;
    } catch (error: any) {
        const zipSelectionErrorMessage: string = `An error occurred while selecting the report zip file: ${error.message}`;
        vscode.window.showErrorMessage(zipSelectionErrorMessage);
        logger.error(zipSelectionErrorMessage);
        return null;
    }
}

/**
 * Finds the cycle key from the cycle name
 * @param treeElementsInTreeView The elements to search in
 * @param cycleName The cycle name to search for
 * @returns {string | null} The cycle key as a string or null if not found
 */
function findCycleKeyFromCycleNameRecursively(treeElementsInTreeView: any[], cycleName: string): string | null {
    for (const treeElement of treeElementsInTreeView) {
        if (
            (treeElement.item?.nodeType === "Cycle" && treeElement.item?.name === cycleName) ||
            (treeElement.nodeType === "Cycle" && treeElement.name === cycleName)
        ) {
            return treeElement.key;
        }

        // Recursively search in children elements
        const children: any[] = treeElement.item?.children || treeElement.children;
        if (children && children.length > 0) {
            const foundCycleKey = findCycleKeyFromCycleNameRecursively(children, cycleName);
            if (foundCycleKey) return foundCycleKey;
        }
    }
    return null;
}

// TODO: remove projectManagementTreeDataProvider when we replace local search with server project tree fetching and then searching
/**
 * Imports the report with results to TestBench server.
 * @param connection The connection to the TestBench server.
 * @param projectManagementTreeDataProvider The project management tree data provider.
 * @param resultZipFilePath The file path of the zip file containing the results.
 * @returns {Promise<void | null>} A promise that resolves when the import is completed or null if an error occurs.
 */
export async function importReportWithResultsToTestbench(
    connection: PlayServerConnection,
    projectManagementTreeDataProvider: ProjectManagementTreeDataProvider,
    resultZipFilePath: string
): Promise<void | null> {
    try {
        logger.debug("Importing report with results to TestBench server.");

        const { uniqueID, projectKey, cycleNameOfProject } = await extractDataFromReport(resultZipFilePath);

        if (!uniqueID || !projectKey || !cycleNameOfProject) {
            const extractDataErrorMessage: string =
                "Error extracting project key, cycle name and unique ID from the zip file.";
            vscode.window.showErrorMessage(extractDataErrorMessage);
            logger.error(extractDataErrorMessage);
            return null;
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
            return null;
        }
        const cycleKeyOfImportedReport: string | null = findCycleKeyFromCycleNameRecursively(
            allTreeElementsInTreeView,
            cycleNameOfProject
        );
        if (!cycleKeyOfImportedReport) {
            const cycleNotFoundMessage: string = "Cycle not found in the project tree.";
            logger.error(cycleNotFoundMessage);
            vscode.window.showErrorMessage(cycleNotFoundMessage);
            return null;
        }

        // Upload the zip file containing the results to TestBench server
        const zipFilenameFromServer: string = await connection.uploadExecutionResultsAndReturnUploadedFileName(
            Number(projectKey),
            resultZipFilePath
        );
        if (!zipFilenameFromServer) {
            const uploadErrorMessage: string = "Error uploading the result file to the server.";
            logger.error(uploadErrorMessage);
            vscode.window.showErrorMessage(uploadErrorMessage);
            return null;
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
            const importJobID: string = await connection.getJobIDOfImportJob(
                Number(projectKey),
                Number(cycleKeyOfImportedReport),
                importData
            );

            // Poll the job status until it is completed
            const importJobStatus: testBenchTypes.JobStatusResponse | null = await reportHandler.pollJobStatus(
                projectKey.toString(),
                importJobID,
                "import"
            );

            // Check if the job is completed successfully
            if (!importJobStatus || reportHandler.isImportJobFailed(importJobStatus)) {
                const importJobFailedMessage: string = "Import job not completed or failed.";
                logger.warn(importJobFailedMessage);
                vscode.window.showErrorMessage(importJobFailedMessage);
                return null;
            } else {
                vscode.window.showInformationMessage("Import completed successfully.");
            }
        } catch (error: any) {
            logger.error("Error:", error.message);
            return null;
        }
    } catch (error: any) {
        logger.error("Error:", error.message);
        vscode.window.showErrorMessage(`An unexpected error occurred: ${error.message}`);
        return null;
    }
}

/**
 * Import the report zip file which contains the test results to TestBench server
 * @param connection The connection to the TestBench server.
 * @param projectManagementTreeDataProvider The project management tree data provider.
 * @returns {Promise<void | null>} A promise that resolves when the import is completed or null if an error occurs.
 */
export async function selectReportWithResultsAndImportToTestbench(
    connection: PlayServerConnection,
    projectManagementTreeDataProvider: ProjectManagementTreeDataProvider
): Promise<void | null> {
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
            const resultZipFilePath: string | null = await promptForReportZipFileWithResults();
            if (!resultZipFilePath) {
                logger.error("No location selected for the report zip file with results.");
                return null;
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
            if (getConfig().get<boolean>("clearReportAfterProcessing")) {
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

/**
 * Extracts the unique ID, project key and cycle name from the report zip file.
 * @param zipFilePath The file path of the zip file containing the results.
 * @returns {Promise<ExtractedData>} A promise that resolves with the extracted data.
 */
async function extractDataFromReport(zipFilePath: string): Promise<ExtractedData> {
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
        const cycleStructureFileName: string = "cycle_structure.json";
        const projectFileName: string = "project.json";

        // Extract JSON content
        const cycleStructureJson = await extractAndParseJsonContent(zipContents, cycleStructureFileName);
        const projectJson = await extractAndParseJsonContent(zipContents, projectFileName);

        // Parse JSON and extract required fields
        const uniqueID: string | null = cycleStructureJson?.root?.base?.uniqueID || null;
        const projectKey: string | null = projectJson?.key || null;
        const cycleNameOfProject: string | null = projectJson?.projectContext?.cycleName || null;

        logger.debug(
            `Extracted data from zip file ${zipFilePath}: uniqueID = ${uniqueID}, projectKey = ${projectKey}, cycleNameOfProject = ${cycleNameOfProject}`
        );

        return { uniqueID, projectKey, cycleNameOfProject };
    } catch (error) {
        logger.error("Error extracting JSON data from zip file:", error);
        return { uniqueID: null, projectKey: null, cycleNameOfProject: null };
    }
}

/**
 * Extract and parse JSON file content from a zip file
 * @param zipContents The zip file contents
 * @param fileName The name of the file to extract and parse
 * @returns {Promise<any>} A promise that resolves with the parsed JSON content or null if an error occurs.
 */
async function extractAndParseJsonContent(zipContents: JSZip, fileName: string): Promise<any> {
    try {
        const fileData: string | undefined = await zipContents.file(fileName)?.async("string");
        return fileData ? JSON.parse(fileData) : null;
    } catch (error) {
        logger.error(`Error reading or parsing ${fileName}:`, error);
        return null;
    }
}
