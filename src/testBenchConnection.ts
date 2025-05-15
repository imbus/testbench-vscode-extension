/**
 * @file testBenchConnection.ts
 * @description Handles connection and communication with the TestBench server.
 */

import * as https from "https";
import * as vscode from "vscode";
import * as fs from "fs";
import * as testBenchTypes from "./testBenchTypes";
import * as reportHandler from "./reportHandler";
import * as base64 from "base-64"; // npm i --save-dev @types/base-64
import JSZip from "jszip";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import path from "path";

import { setConnection, logger, getProjectManagementTreeDataProvider, getLoginWebViewProvider } from "./extension";
import * as utils from "./utils";
import {
    ContextKeys,
    JobTypes,
    StorageKeys,
    allExtensionCommands,
    folderNameOfInternalTestbenchFolder
} from "./constants";

// TODO: Temporarily ignore SSL certificate validation (remove in production)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export interface TestBenchLoginResult {
    sessionToken: string;
    userKey: string; // From LoginResponse
    loginName: string; // The login name used
}

/**
 * Represents a connection to the TestBench Play server.
 * Handles communication with the server, including login, logout, and API requests.
 */
export class PlayServerConnection {
    private baseURL: string;
    private apiClient: AxiosInstance;
    private readonly keepAliveIntervalInSeconds: number = 4 * 60 * 1000; // 4 minutes
    private keepAliveIntervalId: NodeJS.Timeout | null = null;

    /**
     * Creates a new PlayServerConnection.
     *
     * @param {string} serverName - The name of the server.
     * @param {number} portNumber - The port number of the server.
     * @param {string} username - The username for authentication.
     * @param {string} sessionToken - The session token for authentication.
     */
    constructor(
        public serverName: string,
        public portNumber: number,
        public username: string,
        private sessionToken: string
    ) {
        this.baseURL = `https://${this.serverName}:${this.portNumber}/api`;
        logger.trace(
            `[PlayServerConnection] Initializing for server: ${this.serverName}, port: ${this.portNumber}, username: ${this.username}`
        );

        // Create Axios instance for API calls to the server using the session token
        this.apiClient = axios.create({
            baseURL: this.baseURL,
            headers: { Authorization: this.sessionToken },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false // TODO: Use true in production.
            })
        });

        // Only start keep-alive if a token is provided
        if (this.sessionToken) {
            // Start the keep-alive process immediately to prevent session timeout after 5 minutes
            this.startKeepAlive();
        } else {
            logger.warn("[PlayServerConnection] Initialized without a session token. Keep-alive not started.");
        }
    }

    /** Returns the server name. */
    public getServerName(): string {
        return this.serverName;
    }

    /** Returns the server port. */
    public getServerPort(): string {
        return this.portNumber.toString();
    }

    public getUsername(): string {
        return this.username;
    }

    /** Returns the base URL of the server. */
    public getBaseURL(): string {
        return this.baseURL;
    }

    /** Returns the Axios API client. */
    public getApiClient(): AxiosInstance {
        return this.apiClient;
    }

    /**
     * Returns the current session token.
     * @returns {string} The session token.
     */
    public getSessionToken(): string {
        return this.sessionToken;
    }

    /**
     * Logs out the user from the TestBench server by invalidating the current session token.
     * This method now focuses on the server-side logout. UI and global state changes
     * should be handled by the AuthenticationProvider or session change listeners.
     * @returns {Promise<boolean>} True if server logout was successful or no action needed, false on API error.
     */
    async logoutUserOnServer(): Promise<boolean> {
        logger.debug(
            `[PlayServerConnection] Attempting to log out user ${this.username} from server ${this.serverName}.`
        );
        if (!this.sessionToken) {
            logger.warn("[PlayServerConnection] No session token available. Cannot perform server-side logout.");
            this.stopKeepAlive(); // Stop keep-alive even if no token, as a precaution
            return true; // No action needed, consider it "successful" in terms of cleanup
        }

        try {
            const logoutResponse: AxiosResponse = await withRetry(
                () =>
                    this.apiClient.delete(`/login/session/v1`, {
                        // apiClient is already configured with the token
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                3,
                2000
            );

            if (logoutResponse.status === 204) {
                logger.debug("[PlayServerConnection] Server logout successful (204).");
                return true;
            } else {
                logger.error(
                    `[PlayServerConnection] Server logout failed. Unexpected response status: ${logoutResponse.status}`
                );
                return false;
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error(
                    `[PlayServerConnection] Error during server logout: ${error.response?.status} - ${error.response?.statusText}.`
                );
            } else {
                logger.error(`[PlayServerConnection] Unexpected error during server logout: ${error}`);
            }
            return false;
        } finally {
            this.stopKeepAlive(); // Always stop keep-alive after a logout attempt
            // Do NOT clear session data here or call setConnection(null). That's for the auth provider / extension.ts
        }
    }

    /**
     * Retrieves the session token from VS Code's secret storage.
     *
     * @param {vscode.ExtensionContext} context - The extension context.
     * @returns {Promise<string | undefined>} The session token or undefined if not found.
     */
    async getSessionTokenFromSecretStorage(context: vscode.ExtensionContext): Promise<string | undefined> {
        const token: string | undefined = await context.secrets.get(StorageKeys.SESSION_TOKEN);
        if (!token) {
            logger.error("Session token not found.");
        }
        return token;
    }

    /** Clears session data and resets API client and keep-alive timer. */
    clearSessionData(): void {
        this.baseURL = "";
        this.serverName = "";
        this.portNumber = 0;
        this.sessionToken = "";
        this.apiClient = axios.create();
        this.keepAliveIntervalId = null;
    }

    /**
     * Displays a quick pick list for selecting a project key.
     *
     * @param projectsData - The list of projects fetched from the server.
     * @returns {Promise<string | null>} The selected project key or null if none selected.
     */
    async getProjectKeyFromProjectListQuickPickSelection(
        projectsData: testBenchTypes.Project[]
    ): Promise<string | null> {
        // Extract project names from the projects data and display them in a quick pick list
        const projectNames: string[] = projectsData.map((project) => project.name);
        const selectedProjectName: string | undefined = await vscode.window.showQuickPick(projectNames, {
            placeHolder: "Select a project"
        });

        if (!selectedProjectName) {
            logger.error("Selected project name not found.");
            return null;
        }

        logger.debug("Selected project name:", selectedProjectName);
        const selectedProject = projectsData.find((project) => project.name === selectedProjectName);
        if (!selectedProject) {
            logger.error("Selected project not found.");
            return null;
        }

        return selectedProject.key;
    }

    /**
     * Fetches the list of projects from the TestBench server.
     *
     * @returns {Promise<testBenchTypes.Project[] | null>} The list of projects or null if an error occurs.
     */
    async getProjectsList(): Promise<testBenchTypes.Project[] | null> {
        if (!this.sessionToken || !this.apiClient) {
            logger.error("Session token is null. Cannot fetch projects list.");
            return null;
        }
        try {
            logger.debug("Fetching projects list.");
            const projectsURL: string = `/projects/v1`;
            // Wrap the project list get request in the withRetry helper.
            const projectsResponse: AxiosResponse<testBenchTypes.Project[]> = await withRetry(
                () =>
                    this.apiClient.get(projectsURL, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                3, // maxRetries: try 3 additional times
                2000 // delayMs: wait 2000ms between attempts
            );

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
                utils.saveJsonDataToFile(filePath, projectsResponse.data);
            } else {
                vscode.window.showErrorMessage("No file path selected.");
            }
            */

            logger.trace("Response status of project list request:", projectsResponse.status);
            if (projectsResponse.data) {
                logger.trace("Fetched project list:", projectsResponse.data);
                return projectsResponse.data;
            } else {
                logger.error("Project list data is null or undefined.");
                return null;
            }
        } catch (error) {
            // Axios throws an error automatically if the response status is not 2xx
            logger.error("Error fetching projects:", error);
            return null;
        }
    }

    /**
     * Fetches the project tree for a specific project from the TestBench server.
     *
     * @param {string | null} projectKey - The project key as a string.
     * @returns {Promise<testBenchTypes.TreeNode | null>} The project tree fetched from the server or null if an error occurs.
     */
    async getProjectTreeOfProject(projectKey: string | null): Promise<testBenchTypes.TreeNode | null> {
        logger.trace("Fetching project tree for project key:", projectKey);
        if (!this.sessionToken) {
            logger.error("Session token is null. Cannot fetch project tree for project key:", projectKey);
            return null;
        }
        if (!projectKey) {
            logger.error("Project key is null or undefined. Cannot fetch project tree.");
            return null;
        }
        try {
            const projectTreeURL: string = `/projects/${projectKey}/tree/v1`;
            const projectTreeResponse: AxiosResponse<testBenchTypes.TreeNode> = await withRetry(
                () =>
                    this.apiClient.get(projectTreeURL, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                3, // maxRetries: try 3 additional times
                2000 // delayMs: wait 2000ms between attempts
            );

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
                utils.saveJsonDataToFile(filePath, projectTreeResponse.data);
            } else {
                vscode.window.showErrorMessage("No file path selected.");
            }
            */

            logger.trace("Response status of project tree request:", projectTreeResponse.status);
            if (projectTreeResponse.data) {
                logger.trace("Fetched project tree:", projectTreeResponse.data);
                return projectTreeResponse.data;
            } else {
                logger.error("Project tree data is null or undefined.");
                return null;
            }
        } catch (error) {
            logger.error("Error fetching project tree:", error);
            return null;
        }
    }

    // TODO: If this API call is implemented in the new play server, replace this method with the new API.
    /**
     * Fetches test elements using the Test Object Version (TOV) key from the old play server.
     *
     * @param {string | null} tovKey - The TOV key as a string.
     * @returns {Promise<any | null>} The test elements data fetched from the server or null if an error occurs.
     */
    async getTestElementsWithTovKeyUsingOldPlayServer(tovKey: string | null): Promise<any | null> {
        logger.debug("Fetching test elements with TOV key:", tovKey);
        if (!this.sessionToken) {
            logger.error("Session token is null. Cannot fetch test elements for TOV key:", tovKey);
            return null;
        }
        if (!tovKey) {
            logger.error("TOV key is null or undefined. Cannot fetch test elements.");
            return null;
        }

        try {
            const oldPlayServerPortNumber: number = 9443;
            const oldPlayServerBaseUrl: string = `https://${this.serverName}:${oldPlayServerPortNumber}/api/1`;
            const getTestElementsURL: string = `tovs/${tovKey}/testElements`;

            logger.trace("Creating session for old play server with URL:", oldPlayServerBaseUrl);

            const userNameFromConfig: string = this.username;
            const encoded = base64.encode(`${userNameFromConfig}:${this.sessionToken}`);
            logger.trace("@@@@ Username from config:", userNameFromConfig);
            logger.trace("@@@@ Session token:", this.sessionToken);
            logger.trace("@@@@ base64 encoded credentials:", encoded);
            // Create session for API calls to the old play server
            const oldPlayServerSession: axios.AxiosInstance = axios.create({
                baseURL: oldPlayServerBaseUrl,
                // Old play server, which runs on port 9443, uses BasicAuth.
                // Use loginName as username, and use sessionToken as the password
                auth: {
                    username: this.username,
                    password: this.sessionToken
                },
                headers: {
                    // Manually encode the credentials to Base64
                    Authorization: `Basic ${encoded}`,
                    "Content-Type": "application/vnd.testbench+json; charset=utf-8"
                },
                // Ignore self-signed certificates
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false //TODO: This should only be used in a development environment
                })
            });

            if (!oldPlayServerSession) {
                logger.error("@@@@@ Failed to create session for old play server.");
                return null;
            } else {
                logger.trace(`@@@@@ Old play server session created successfully: ${oldPlayServerSession}`);
            }

            logger.trace(`Sending GET request to ${getTestElementsURL} for TOV key ${tovKey}`);
            const testElementsResponse: AxiosResponse = await withRetry(
                () => oldPlayServerSession.get(getTestElementsURL),
                3, // maxRetries: try 3 additional times
                2000, // delayMs: wait 2000ms between attempts
                (error) => {
                    if (axios.isAxiosError(error) && error.response) {
                        // Do not retry if the error is due to authentication or if the resource is not found.
                        const nonRetryableStatusCodes: number[] = [401, 404];
                        if (nonRetryableStatusCodes.includes(error.response.status)) {
                            return false;
                        }
                    }
                    return true;
                }
            );

            // Save the JSON to a file for analyzing the structure
            /*
            const savePath = await vscode.window.showSaveDialog({
                saveLabel: "Save Test Elements JSON Response From Server",
                filters: {
                    "JSON Files": ["json"],
                    "All Files": ["*"],
                },
            });
            if (savePath) {
                const filePath = savePath.fsPath;
                utils.saveJsonDataToFile(filePath, testElementsResponse.data);
                vscode.window.showInformationMessage(`Test elements response saved to ${filePath}`);
            } else {
                vscode.window.showErrorMessage("No file path selected.");
            }
            */

            logger.trace("Response status of get test elements request:", testElementsResponse.status);
            if (testElementsResponse.data) {
                logger.trace("Fetched test elements data:", testElementsResponse.data);
                return testElementsResponse.data;
            } else {
                logger.error("Test elements data is null or undefined.");
                return null;
            }
        } catch (error) {
            logger.error("Error fetching test elements:", error);
            vscode.window.showErrorMessage("Error fetching test elements. Please check the logs for details.");
            return null;
        }
    }

    /**
     * Fetches the cycle structure of a specific cycle within a project from the TestBench server.
     *
     * @param {string} projectKey - The project key as a string.
     * @param {string} cycleKey - The cycle key as a string.
     * @returns {Promise<testBenchTypes.CycleStructure | null>} The cycle structure or null if an error occurs.
     */
    async fetchCycleStructureOfCycleInProject(
        projectKey: string,
        cycleKey: string
    ): Promise<testBenchTypes.CycleStructure | null> {
        const cycleStructureUrl = `/projects/${projectKey}/cycles/${cycleKey}/structure/v1`;
        const requestBody: testBenchTypes.OptionalJobIDRequestParameter = {
            basedOnExecution: true,
            suppressFilteredData: false,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: []
        };

        try {
            const cycleStructureResponse: AxiosResponse<testBenchTypes.CycleStructure> = await withRetry(
                () =>
                    this.apiClient.post(cycleStructureUrl, requestBody, {
                        headers: {
                            accept: "application/json",
                            "Content-Type": "application/json"
                        }
                    }),
                3, // maxRetries: try 3 additional times
                2000, // delayMs: wait 2000ms between attempts
                (error) => {
                    if (axios.isAxiosError(error) && error.response) {
                        // Do not retry if the error is due to a bad request, missing resource, or unprocessable data.
                        const nonRetryableStatusCodes = [400, 404, 422];
                        if (nonRetryableStatusCodes.includes(error.response.status)) {
                            return false;
                        }
                    }
                    return true;
                }
            );

            // Save the JSON to a file for analyzing the structure
            /*
            const savePath: vscode.Uri | undefined = await vscode.window.showSaveDialog({
                saveLabel: "Save Cycle Structure",
                filters: {
                    "JSON Files": ["json"],
                    "All Files": ["*"],
                },
            });
            if (savePath) {
                const filePath: string = savePath.fsPath;
                utils.saveJsonDataToFile(filePath, cycleStructureResponse.data);
            } else {
                vscode.window.showErrorMessage("No file path selected.");
            }
            */

            logger.trace(`Cycle structure response for cycle key ${cycleKey}:`, cycleStructureResponse.status);
            if (cycleStructureResponse.data) {
                logger.trace(`Received cycle structure for cycle key ${cycleKey}:`, cycleStructureResponse.data);
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
     * Logs out the user from the TestBench server.
     * Clears session data, stops the keep-alive process.
     * @returns {Promise<void | null>} A promise that resolves when logout is complete, or null if an error occurs.
     */
    async logoutUser(): Promise<void | null> {
        logger.debug("Logging out user.");
        try {
            const logoutResponse: AxiosResponse = await withRetry(
                () =>
                    this.apiClient.delete(`/login/session/v1`, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                3, // maxRetries: try 3 additional times
                2000 // delayMs: wait 2000ms between attempts
            );

            if (logoutResponse.status === 204) {
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
                logger.error(`Unexpected error during logout: ${error}`);
                return null;
            }
        } finally {
            // Regardless of the outcome of logout operation, stop the keep-alive process
            this.stopKeepAlive();
            this.clearSessionData(); // Clear the session data after stopping keep-alive because it also resets keepAliveIntervalId
            await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);

            const pmProvider = getProjectManagementTreeDataProvider();
            pmProvider?.clearTree();
            setConnection(null);
            // Notify login webview about the logout success to change its HTML content
            const lwvProvider = getLoginWebViewProvider();
            if (lwvProvider) {
                await lwvProvider.updateWebviewHTMLContent();
            } else {
                logger.error("loginWebViewProvider is null. Cannot update webview content.");
            }
        }
    }

    /**
     * Imports a zip archive containing JSON-based test execution results to the TestBench server.
     *
     * @param {number} projectKey - The project key.
     * @param {string} zipFilePath - The file path to the zip archive.
     * @returns {Promise<string>} The file name returned by the server.
     * @throws An error if the import fails.
     */
    public async importExecutionResultsAndReturnImportedFileName(
        projectKey: number,
        zipFilePath: string
    ): Promise<string> {
        const importResultZipURL: string = `/projects/${projectKey}/executionResults/v1`;

        try {
            const zipFileData: Buffer = fs.readFileSync(zipFilePath);
            logger.debug(`Importing zip file "${zipFilePath}" to ${importResultZipURL}`);
            const importZipResponse: AxiosResponse = await withRetry(
                () =>
                    this.apiClient.post(importResultZipURL, zipFileData, {
                        headers: {
                            "Content-Type": "application/zip",
                            accept: "application/json"
                        },
                        // Handle all status codes manually
                        validateStatus: () => true
                    }),
                3, // maxRetries: try 3 additional times
                2000, // delayMs: wait 2000ms between attempts
                (error) => {
                    // Do not retry if the error is due to a non-transient condition
                    if (axios.isAxiosError(error) && error.response) {
                        const nonRetryableStatusCodes = [403, 404, 422];
                        if (nonRetryableStatusCodes.includes(error.response.status)) {
                            return false;
                        }
                    }
                    return true;
                }
            );

            switch (importZipResponse.status) {
                case 201: {
                    logger.debug("Report imported successfully.");
                    // Extract the fileName from the response and return it
                    const fileName: string | undefined = importZipResponse.data?.fileName;
                    if (fileName) {
                        return fileName;
                    } else {
                        const fileNameNotFoundMessage: string = "File name not found in server response.";
                        logger.error(fileNameNotFoundMessage);
                        throw new Error(fileNameNotFoundMessage);
                    }
                }
                case 403: {
                    const importForbiddenMessage: string =
                        "Forbidden: You do not have permission to import execution results.";
                    logger.error(importForbiddenMessage);
                    throw new Error(importForbiddenMessage);
                }
                case 404: {
                    const importNotFoundMessage: string = "Not Found: The requested project was not found.";
                    logger.error(importNotFoundMessage);
                    throw new Error(importNotFoundMessage);
                }
                case 422: {
                    const importUnprocessableEntityMessage: string =
                        "Unprocessable Entity: The imported file is invalid.";
                    logger.error(importUnprocessableEntityMessage);
                    throw new Error(importUnprocessableEntityMessage);
                }
                default: {
                    const importUnexpectedErrorMessage: string = `Unexpected status code ${importZipResponse.status} received.`;
                    logger.error(importUnexpectedErrorMessage);
                    throw new Error(importUnexpectedErrorMessage);
                }
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error("An Axios error occurred while importing the file:", error.message);
                if (error.response) {
                    logger.error("Error response data:", error.response.data);
                }
            } else {
                logger.error("An unexpected error occurred while importing the file:", error);
            }
            throw error;
        }
    }

    /**
     * Fetches the job ID of an import job from the TestBench server, which will be used for polling the import job status later.
     *
     * @param {number} projectKey - The project key.
     * @param {number} cycleKey - The cycle key.
     * @param {testBenchTypes.ImportData} importData - The import data.
     * @returns {Promise<string>} The job ID as a string.
     * @throws An error if the import fails.
     */
    public async getJobIDOfImportJob(
        projectKey: number,
        cycleKey: number,
        importData: testBenchTypes.ImportData
    ): Promise<string> {
        const getJobIDOfImportUrl: string = `/projects/${projectKey}/cycles/${cycleKey}/import/v1`;

        try {
            const importJobIDResponse: AxiosResponse = await withRetry(
                () =>
                    this.apiClient.post(getJobIDOfImportUrl, importData, {
                        headers: {
                            "Content-Type": "application/json",
                            accept: "application/json"
                        },
                        validateStatus: () => true
                    }),
                3, // maxRetries: try 3 additional times
                2000, // delayMs: wait 2000ms between attempts
                (error) => {
                    // Do not retry if the error has a non-transient status code.
                    if (axios.isAxiosError(error) && error.response) {
                        const nonRetryableStatusCodes = [400, 403, 404, 422];
                        if (nonRetryableStatusCodes.includes(error.response.status)) {
                            return false;
                        }
                    }
                    return true;
                }
            );

            switch (importJobIDResponse.status) {
                case 200: {
                    const jobID: string | undefined = importJobIDResponse.data?.jobID;
                    if (jobID) {
                        logger.debug(`Import initiated successfully. Job ID: ${jobID}`);
                        return jobID;
                    } else {
                        const importJobIDNotFoundMessage: string =
                            "Success response received but no jobID found in the response.";
                        logger.error(importJobIDNotFoundMessage);
                        throw new Error(importJobIDNotFoundMessage);
                    }
                }
                case 400: {
                    const importBadRequestMessage: string = "Bad Request: The request body is invalid.";
                    logger.error(importBadRequestMessage);
                    throw new Error(importBadRequestMessage);
                }
                case 403: {
                    const importForbiddenMessage: string =
                        "Forbidden: You do not have permission to import execution results.";
                    logger.error(importForbiddenMessage);
                    throw new Error(importForbiddenMessage);
                }
                case 404: {
                    const importNotFoundMessage: string = "Not Found: Project or test cycle not found.";
                    logger.error(importNotFoundMessage);
                    throw new Error(importNotFoundMessage);
                }
                case 422: {
                    const importUnprocessableEntityMessage: string =
                        "Unprocessable Entity: The server cannot process the request.";
                    logger.error(importUnprocessableEntityMessage);
                    throw new Error(importUnprocessableEntityMessage);
                }
                default: {
                    const importUnexpectedErrorMessage: string = `Unexpected status code ${importJobIDResponse.status} received.`;
                    logger.error(importUnexpectedErrorMessage);
                    throw new Error(importUnexpectedErrorMessage);
                }
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error("Axios error during import job ID retrieval:", error.message);
                if (error.response) {
                    logger.error("Error response data:", error.response.data);
                }
            } else {
                logger.error("Unexpected error during import job ID retrieval:", error);
            }
            throw error;
        }
    }

    /**
     * Starts the keep-alive process that prevents the session from timing out.
     * The keep-alive process sends a GET request to the server every 4 minutes.
     * The constructor method of the PlayServerConnection class starts the keep-alive process automatically.
     * If the session token is null, the keep-alive process is not started.
     * If the keep-alive process is already running and it is triggered again, the previous one is stopped before starting a new one.
     */
    public startKeepAlive(): void {
        this.stopKeepAlive(); // Prevent multiple intervals if previously started.
        this.keepAliveIntervalId = setInterval(() => {
            this.sendKeepAliveRequest();
        }, this.keepAliveIntervalInSeconds);
        // Send an immediate keep-alive request.
        this.sendKeepAliveRequest();
        logger.trace("Keep-alive started.");
    }

    /** Stops the keep-alive process. */
    private stopKeepAlive(): void {
        if (this.keepAliveIntervalId) {
            clearInterval(this.keepAliveIntervalId);
            this.keepAliveIntervalId = null;
            logger.trace("Keep-alive stopped.");
        }
    }

    /**
     * Sends a GET request to the server to keep the session alive, which normally times out after 5 minutes.
     * The keep-alive process is started automatically when the PlayServerConnection object is created, and it runs every 4 minutes.
     * If the request fails, retries are attempted up to 3 times with a delay of 1 second between each attempt.
     * If the keep alive request fails, the user is logged out automatically, since the session will be timed out later anyway.
     */
    private async sendKeepAliveRequest(): Promise<void> {
        if (!this.sessionToken || !this.apiClient) {
            logger.error("[PlayServerConnection] Session token or apiClient is null. Cannot send keep-alive request.");
            this.stopKeepAlive();
            return;
        }

        try {
            await withRetry(
                () =>
                    this.apiClient.get(`/login/session/v1`, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                5, // maxRetries: try 5 additional times
                2000 // delayMs: wait 2000ms between attempts
            );
            logger.trace("Keep-alive request sent.");
        } catch (error) {
            // IMPORTANT: If keep-alive fails and results in logout, it should signal this failure
            // back to the AuthenticationProvider or a global listener to update the VS Code session state.
            // This might involve emitting an event from PlayServerConnection or having the keep-alive
            // failure directly trigger vscode.authentication.removeSession if possible.
            logger.error("Keep-alive request failed after retries:", error);
            logger.warn("Logging out the user after keep-alive failure.");
            await vscode.commands.executeCommand(`${allExtensionCommands.logout}`);
        }
    }
}

/**
 * Executes an asynchronous function with retry logic in case of failures such as temporary network problems.
 * Used to retry API calls in case of network errors. To disable retries for an API call, set maxRetries to 0.
 *
 * @template T - The type returned by the asynchronous function.
 * @param {Promise<T>} asyncFunction - The asynchronous function to execute.
 * @param {number} maxRetries - Maximum number of retry attempts (default is 3).
 * @param {number} delayMs - Delay in milliseconds between retries (default is 1000ms).
 * @param {boolean} shouldRetry - Optional predicate function that receives the error and returns whether to retry.
 * @param {boolean} showProgressBar - Optional flag to control whether to show a VS Code progress bar (default is false).
 * @returns {Promise<T>} A promise resolving to the function's return value.
 * @throws The error from the last failed attempt if all retries fail.
 */
export async function withRetry<T>(
    asyncFunction: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 2000,
    shouldRetry?: (error: any) => boolean,
    showProgressBar: boolean = true
): Promise<T> {
    let attempt: number = 0;

    while (true) {
        try {
            // Attempt to execute the function.
            return await asyncFunction();
        } catch (error) {
            // Log the retry attempt and delay before retrying.
            logger.warn(`Attempt ${attempt} failed. Retrying in ${delayMs}ms...`);

            // Check if we should not retry based on the error type/condition.
            if (shouldRetry && !shouldRetry(error)) {
                logger.warn(`Error is not retryable. Aborting further retry attempts.`);
                throw error;
            }

            attempt++;
            if (attempt > maxRetries) {
                // If we've exceeded maxRetries, rethrow the error.
                logger.error(`Attempt ${attempt} failed. Maximum retries reached, aborting further retries.`);
                throw error;
            }

            // Show the progress bar only if retries are happening and the flag is enabled.
            if (showProgressBar) {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Retrying request",
                        cancellable: false
                    },
                    async (progress) => {
                        progress.report({ message: `Attempt ${attempt} of ${maxRetries}` });
                        await new Promise((resolve) => setTimeout(resolve, delayMs));
                    }
                );
            } else {
                // If progress bar is disabled, just wait for the delay.
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }
}

// TODO: This function could be useful for a quickpick login UI, where the user has to enter the server URL and port number first.
// But with a login web view all inputs are given at once. Delete this function if not needed.
/**
 * Fetches the server versions from the TestBench server.
 * Used to verify the availability of server after receiving the server URL and port number in the login process.
 *
 * @param {string} serverName - The server name.
 * @param {number} portNumber - The port number.
 * @returns {Promise<testBenchTypes.ServerVersionsResponse | null>} The server versions data or null if an error occurs.
 */
async function fetchServerVersions(
    serverName: string,
    portNumber: number
): Promise<testBenchTypes.ServerVersionsResponse | null> {
    try {
        const baseURL = `https://${serverName}:${portNumber}`;
        const serverVersionsURL = `${baseURL}/api/serverVersions/v1`;

        logger.debug("Fetching server versions from URL:", serverVersionsURL);
        const serverVersionsResponse: AxiosResponse<testBenchTypes.ServerVersionsResponse> = await withRetry(
            () =>
                axios.get(serverVersionsURL, {
                    headers: { Accept: "application/vnd.testbench+json" },
                    httpsAgent: new https.Agent({ rejectUnauthorized: false }) // TODO: set to true in production
                }),
            3, // maxRetries: try 3 additional times
            2000, // delayMs: wait 2000ms between attempts
            // Retry only if the error is due to a non-transient condition
            (error) => {
                if (axios.isAxiosError(error) && error.response) {
                    // Do not retry if a 404 is received
                    const nonRetryableStatusCodes = [404];
                    if (nonRetryableStatusCodes.includes(error.response.status)) {
                        return false;
                    }
                }
                return true;
            }
        );

        logger.debug(
            `TestBench Release Version: ${serverVersionsResponse.data.releaseVersion}, ` +
                `Database Version: ${serverVersionsResponse.data.databaseVersion}, ` +
                `Revision: ${serverVersionsResponse.data.revision}`
        );
        return serverVersionsResponse.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                logger.error(`Error: Received status code ${error.response.status}`, error.response.data);
                if (error.response.status === 404) {
                    logger.error(`TestBench version cannot be found at https://${serverName}:${portNumber}`);
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
 * Opens a file dialog for selecting a zip file containing test results.
 *
 * @returns {Promise<string | null>} The selected zip file path or null if none selected.
 */
async function promptForReportZipFileWithResults(): Promise<string | null> {
    try {
        const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            const workspaceLocationErrorMessage: string = "Workspace location could not be determined.";
            vscode.window.showErrorMessage(workspaceLocationErrorMessage);
            logger.warn(workspaceLocationErrorMessage);
            return null;
        }

        const workingDirectoryPath: string = path.join(workspaceLocation, folderNameOfInternalTestbenchFolder);
        const options: vscode.OpenDialogOptions = {
            defaultUri: vscode.Uri.file(workingDirectoryPath),
            openLabel: "Select Zip File with Test Results",
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            filters: { "Zip Files": ["zip"] }
        };

        const fileUri: vscode.Uri[] | undefined = await vscode.window.showOpenDialog(options);
        if (!fileUri || !fileUri[0]) {
            const noZipFileSelectedMessage: string = "No zip file selected. Please select a valid .zip file.";
            vscode.window.showErrorMessage(noZipFileSelectedMessage);
            logger.debug(noZipFileSelectedMessage);
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
 * Imports a report (zip file with test results) to the TestBench server.
 *
 * @param {PlayServerConnection} connection - The PlayServerConnection.
 * @param {string} projectKeyString - The project key string.
 * @param {string} cycleKeyString - The cycle key string.
 * @param {string} reportWithResultsZipFilePath - The file path of the zip file containing the test results to import.
 * @returns {Promise<void | null>} A promise that resolves when the import is complete, or null if an error occurs.
 */
export async function importReportWithResultsToTestbench(
    connection: PlayServerConnection,
    projectKeyString: string, // Now accepts projectKey
    cycleKeyString: string, // Now accepts cycleKey
    reportWithResultsZipFilePath: string
): Promise<void | null> {
    try {
        logger.debug("Importing report with results to TestBench server.");
        const { uniqueID } = await extractDataFromReport(reportWithResultsZipFilePath);
        if (!uniqueID) {
            const extractionErrorMsg: string = "Error extracting unique ID from the zip file.";
            vscode.window.showErrorMessage(extractionErrorMsg);
            logger.error(extractionErrorMsg);
            return null;
        }

        // TODO: We are currently searching for the Cycle key of the exported test theme locally, which causes issues if the project management tree is not initialized.
        // Later, we should fetch the project tree from the server and search for the cycle key there.

        /*
        // For debugging, save the tree elements to a file called allTreeElements.json
        const allTreeElementsPath = path.join(__dirname, "allTreeElements.json");
        utils.saveJsonDataToFile(allTreeElementsPath, allTreeElementsInTreeView);
        console.log(`allTreeElements saved to ${allTreeElementsPath}`);
        */

        // Use the passed-in keys (convert to numbers for API calls)
        const projectKey: number = Number(projectKeyString);
        const cycleKey: number = Number(cycleKeyString);

        if (isNaN(projectKey) || isNaN(cycleKey)) {
            logger.error(
                `Invalid projectKey (${projectKeyString}) or cycleKey (${cycleKeyString}) provided for import.`
            );
            vscode.window.showErrorMessage("Internal error: Invalid project or cycle identifier for import.");
            return null;
        }

        const zipFilenameFromServer: string = await connection.importExecutionResultsAndReturnImportedFileName(
            projectKey,
            reportWithResultsZipFilePath
        );
        if (!zipFilenameFromServer) {
            const importErrorMessage: string = "Error importing the result file to the server.";
            logger.error(importErrorMessage);
            vscode.window.showErrorMessage(importErrorMessage);
            return null;
        }

        // Import the results to TestBench server
        const importData: testBenchTypes.ImportData = {
            fileName: zipFilenameFromServer,
            reportRootUID: uniqueID,
            useExistingDefect: true,
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
            ]
        };

        try {
            // Start the import job
            logger.debug("Starting import execution results.");
            const importJobID: string = await connection.getJobIDOfImportJob(projectKey, cycleKey, importData);

            // Poll the job status until it is completed
            const importJobStatus: testBenchTypes.JobStatusResponse | null = await reportHandler.pollJobStatus(
                projectKeyString,
                importJobID,
                JobTypes.IMPORT
            );

            // Check job completion status
            if (!importJobStatus || reportHandler.isImportJobFailed(importJobStatus)) {
                const importJobFailedMessage: string = "Import job could not be completed.";
                logger.warn(importJobFailedMessage);
                vscode.window.showErrorMessage(importJobFailedMessage);
                return null;
            } else if (reportHandler.isImportJobCompletedSuccessfully(importJobStatus)) {
                vscode.window.showInformationMessage("Import completed successfully.");
            } else {
                logger.warn("Import job finished polling but status is unknown.", importJobStatus);
                vscode.window.showWarningMessage("Import job status unknown after polling.");
            }
        } catch (error: any) {
            logger.error(
                `Error during import job initiation or polling for Project ${projectKey}, Cycle ${cycleKey}:`,
                error.message
            );
            return null;
        }
    } catch (error: any) {
        logger.error("Error importing report:", error.message);
        vscode.window.showErrorMessage(`An unexpected error occurred: ${error.message}`);
        return null;
    }
}

/**
 * Prompts the user to select a report zip file and imports it to the TestBench server.
 *
 * @param {PlayServerConnection} connection - The PlayServerConnection.
 * @returns {Promise<void | null>} A promise that resolves when the import is complete, or null if an error occurs.
 */
export async function selectReportWithResultsAndImportToTestbench(
    connection: PlayServerConnection
): Promise<void | null> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Importing results to TestBench server`,
            cancellable: true
        },
        async (progress) => {
            progress.report({ message: "Selecting report file with results.", increment: 30 });
            const resultZipFilePath: string | null = await promptForReportZipFileWithResults();
            if (!resultZipFilePath) {
                return null;
            }

            progress.report({ message: "Extracting report context...", increment: 10 });
            const { projectKey, cycleKey } = await extractDataFromReport(resultZipFilePath);

            // Validate extracted keys
            if (!projectKey || !cycleKey) {
                const missingDataContextMsg: string =
                    "Could not extract necessary project or cycle key from the selected report file.";
                logger.error(missingDataContextMsg);
                vscode.window.showErrorMessage(missingDataContextMsg);
                // Clean up the selected file if it exists and configured, even on error
                await reportHandler.cleanUpReportFileIfConfiguredInSettings(resultZipFilePath);
                return null;
            }

            progress.report({ message: "Importing report file.", increment: 30 });
            await importReportWithResultsToTestbench(connection, projectKey, cycleKey, resultZipFilePath);
            progress.report({ message: "Cleaning up.", increment: 30 });
            await reportHandler.cleanUpReportFileIfConfiguredInSettings(resultZipFilePath);
        }
    );
}

/**
 * Extracts uniqueID, projectKey, and cycleName from a report zip file.
 *
 * @param {string} zipFilePath - The file path of the zip file.
 * @returns {Promise<ExtractedData>} An object containing uniqueID, projectKey, and cycleNameOfProject.
 */
export async function extractDataFromReport(zipFilePath: string): Promise<{
    uniqueID: string | null;
    projectKey: string | null;
    cycleNameOfProject: string | null;
    cycleKey: string | null;
}> {
    try {
        // Read zip file from disk
        const zipData: Buffer = await fs.promises.readFile(path.resolve(zipFilePath));
        const zip: JSZip = new JSZip();
        // Load zip data
        const zipContents: JSZip = await zip.loadAsync(zipData);

        // Define file names
        const cycleStructureFileName: string = "cycle_structure.json";
        const projectFileName: string = "project.json";

        // Extract JSON content
        const cycleStructureJson = await utils.extractAndParseJsonContent(zipContents, cycleStructureFileName);
        const projectJson = await utils.extractAndParseJsonContent(zipContents, projectFileName);

        // Parse JSON and extract required fields
        const uniqueID: string | null = cycleStructureJson?.root?.base?.uniqueID || null;
        const projectKey: string | null = projectJson?.key || null;
        const cycleNameOfProject: string | null = projectJson?.projectContext?.cycleName || null;
        const cycleKey: string | null = projectJson?.projectContext?.cycleKey || null;

        logger.debug(
            `Extracted data from zip file "${zipFilePath}": uniqueID = ${uniqueID}, projectKey = ${projectKey}, cycleName = ${cycleNameOfProject}, cycleKey = ${cycleKey}` // Log cycleKey
        );
        return { uniqueID, projectKey, cycleNameOfProject, cycleKey };
    } catch (error) {
        logger.error("Error extracting JSON data from zip file:", error);
        return { uniqueID: null, projectKey: null, cycleNameOfProject: null, cycleKey: null };
    }
}

/**
 * Logs in to the TestBench server with the provided credentials and returns session details.
 * This function focuses on the API interaction and does not handle UI or global state.
 *
 * @param serverName The server hostname or IP.
 * @param portNumber The server port.
 * @param username The TestBench username.
 * @param password The TestBench password.
 * @returns A promise resolving to TestBenchLoginResult if successful, otherwise null.
 */
export async function loginToServerAndGetSessionDetails(
    serverName: string,
    portNumber: number,
    username: string,
    password: string
): Promise<TestBenchLoginResult | null> {
    const requestBody: testBenchTypes.LoginRequestBody = {
        login: username,
        password: password,
        force: true // Or make this configurable if needed
    };

    const baseURL = `https://${serverName}:${portNumber}/api`;
    const loginURL = `${baseURL}/login/session/v1`;

    logger.trace(`[Connection] Sending login request to: ${loginURL} for user ${username}`);

    try {
        // Using withRetry helper (assuming it's still in this file or imported)
        const loginResponse: AxiosResponse<testBenchTypes.LoginResponse> = await withRetry(
            () =>
                axios.post(loginURL, requestBody, {
                    headers: {
                        accept: "application/vnd.testbench+json",
                        "Content-Type": "application/vnd.testbench+json"
                    },
                    httpsAgent: new https.Agent({ rejectUnauthorized: false }) // TODO: Review for production
                }),
            3, // maxRetries
            2000, // delayMs
            (error) => {
                // shouldRetry predicate
                if (axios.isAxiosError(error) && error.response && error.response.status === 401) {
                    logger.warn("[Connection] Login attempt failed with 401 (Invalid Credentials). Not retrying.");
                    return false; // Do not retry on 401
                }
                return true; // Retry on other errors (e.g., network issues)
            }
        );

        if (loginResponse.status === 201 && loginResponse.data && loginResponse.data.sessionToken) {
            logger.info(`[Connection] Login successful for user ${username} on ${serverName}.`);
            return {
                sessionToken: loginResponse.data.sessionToken,
                userKey: loginResponse.data.userKey,
                loginName: loginResponse.data.login
                // Add other relevant fields from LoginResponse if needed
            };
        } else {
            logger.error(
                `[Connection] Login failed for ${username}. Unexpected status code: ${loginResponse.status}, Data: ${JSON.stringify(loginResponse.data)}`
            );
            return null;
        }
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response && error.response.status === 401) {
            // Already logged by shouldRetry, but good to catch specifically
        } else {
            logger.error(`[Connection] Error during login for ${username} to ${serverName}:`, error.message);
        }
        return null; // Ensure null is returned on any error
    }
}
