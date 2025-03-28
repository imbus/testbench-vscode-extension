/**
 * @file testBenchConnection.ts
 * @description Handles connection and communication with the TestBench server.
 */

import * as https from "https";
import * as vscode from "vscode";
import * as fs from "fs";
import * as testBenchTypes from "./testBenchTypes";
import * as reportHandler from "./reportHandler";
import * as loginWebView from "./loginWebView";
import * as base64 from "base-64"; // npm i --save-dev @types/base-64
import JSZip from "jszip";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import path from "path";
import * as projectManagementTreeView from "./projectManagementTreeView";
import {
    getConfig,
    setConnection,
    allExtensionCommands,
    folderNameOfTestbenchWorkingDirectory,
    setProjectManagementTreeDataProvider,
    logger,
    loginWebViewProvider
} from "./extension";
import * as utils from "./utils";

// TODO: Temporarily ignore SSL certificate validation (remove in production)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

/**
 * Represents a connection to the TestBench Play server.
 * Handles communication with the server, including login, logout, and API requests.
 */
export class PlayServerConnection {
    private context: vscode.ExtensionContext;
    private serverName: string;
    private portNumber: number;
    private sessionToken: string;
    private baseURL: string;
    private apiClient: AxiosInstance;
    private keepAliveIntervalId: NodeJS.Timeout | null = null;

    /**
     * Creates a new PlayServerConnection.
     *
     * @param context - The VS Code extension context.
     * @param serverName - The server name or IP address.
     * @param portNumber - The server port number.
     * @param sessionToken - The session token for authentication.
     */
    constructor(context: vscode.ExtensionContext, serverName: string, portNumber: number, sessionToken: string) {
        this.context = context;
        this.serverName = serverName;
        this.portNumber = portNumber;
        this.sessionToken = sessionToken;
        this.baseURL = `https://${this.serverName}:${this.portNumber}/api`;

        // Create Axios instance for API calls to the server using the session token
        this.apiClient = axios.create({
            baseURL: this.baseURL,
            headers: { Authorization: this.sessionToken },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false // TODO: Use true in production.
            })
        });

        // Start the keep-alive process immediately to prevent session timeout after 5 minutes
        this.startKeepAlive();
    }

    /** Returns the current session token. */
    public getSessionToken(): string {
        return this.sessionToken;
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
     * Retrieves the session token from VS Code's secret storage.
     *
     * @param context - The extension context.
     * @returns The session token or undefined if not found.
     */
    async getSessionTokenFromSecretStorage(context: vscode.ExtensionContext): Promise<string | undefined> {
        const token: string | undefined = await context.secrets.get("sessionToken");
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
            logger.warn("Selected project name not found.");
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
        if (!this.sessionToken) {
            logger.warn("Session token is null. Cannot fetch projects list.");
            return null;
        }
        try {
            logger.debug("Fetching projects list.");
            const projectsURL = `/projects/v1`;
            // Wrap the project list get request in the withRetry helper.
            const projectsResponse: AxiosResponse<testBenchTypes.Project[]> = await withRetry(
                () =>
                    this.apiClient.get(projectsURL, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                3, // maxRetries: try 3 additional times
                1000 // delayMs: wait 1000ms between attempts
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
                logger.warn("Project list data is null or undefined.");
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
     * @param projectKey - The project key as a string.
     * @returns {Promise<testBenchTypes.TreeNode | null>} The project tree fetched from the server or null if an error occurs.
     */
    async getProjectTreeOfProject(projectKey: string | null): Promise<testBenchTypes.TreeNode | null> {
        logger.trace("Fetching project tree for project key:", projectKey);
        if (!this.sessionToken) {
            logger.warn("Session token is null. Cannot fetch project tree for project key:", projectKey);
            return null;
        }
        if (!projectKey) {
            logger.warn("Project key is null or undefined. Cannot fetch project tree.");
            return null;
        }
        try {
            const projectTreeURL = `/projects/${projectKey}/tree/v1`;
            const projectTreeResponse: AxiosResponse<testBenchTypes.TreeNode> = await withRetry(
                () =>
                    this.apiClient.get(projectTreeURL, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                3, // maxRetries: try 3 additional times
                1000 // delayMs: wait 1000ms between attempts
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
                logger.warn("Project tree data is null or undefined.");
                return null;
            }
        } catch (error) {
            logger.error("Error fetching project tree:", error);
            return null;
        }
    }

    /**
     * Fetches test elements using the Test Object Version (TOV) key from the old play server.
     *
     * @param tovKey - The TOV key as a string.
     * @returns The test elements data fetched from the server or null if an error occurs.
     */
    async getTestElementsWithTovKeyOldPlayServer(tovKey: string | null): Promise<any | null> {
        logger.debug("Fetching test elements with TOV key:", tovKey);
        if (!this.sessionToken) {
            logger.warn("Session token is null. Cannot fetch test elements for TOV key:", tovKey);
            return null;
        }
        if (!tovKey) {
            logger.warn("TOV key is null or undefined. Cannot fetch test elements.");
            return null;
        }

        try {
            const oldPlayServerBaseUrl = `https://${this.serverName}:9443/api/1`;
            const getTestElementsURL = `/tovs/${tovKey}/testElements`;

            logger.trace("Creating session for old play server.");

            // Create session for API calls to the old play server
            const oldPlayServerSession = axios.create({
                baseURL: oldPlayServerBaseUrl,
                // Old play server, which runs on port 9443, uses BasicAuth.
                // Use loginName as username, and use sessionToken as the password
                auth: {
                    username: getConfig().get<string>("username")!,
                    password: this.sessionToken
                },
                headers: {
                    // Manually encode the credentials to Base64
                    Authorization: `Basic ${base64.encode(
                        `${getConfig().get<string>("username")}:${this.sessionToken}`
                    )}`,
                    "Content-Type": "application/vnd.testbench+json; charset=utf-8"
                },
                // Ignore self-signed certificates
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false //TODO: This should only be used in a development environment
                })
            });

            logger.trace(`Sending GET request to ${getTestElementsURL} for TOV key ${tovKey}`);
            const testElementsResponse: AxiosResponse = await withRetry(
                () => oldPlayServerSession.get(getTestElementsURL),
                3, // maxRetries: try 3 additional times
                1000, // delayMs: wait 1000ms between attempts
                (error) => {
                    if (axios.isAxiosError(error) && error.response) {
                        // Do not retry if the error is due to authentication or if the resource is not found.
                        const nonRetryableStatusCodes = [401, 404];
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
                logger.warn("Test elements data is null or undefined.");
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
     * @param projectKey - The project key as a string.
     * @param cycleKey - The cycle key as a string.
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
                1000, // delayMs: wait 1000ms between attempts
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
                utils.saveJsonDataToFile(filePath, response.data);
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
     * Clears session data, stops the keep-alive process, clears the tree data provider which empties the tree view.
     *
     * @param projectTreeDataProvider - The project management tree data provider.
     * @returns {Promise<void | null>} A promise that resolves when logout is complete, or null if an error occurs.
     */
    async logoutUser(
        projectTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider
    ): Promise<void | null> {
        logger.debug("Logging out user.");
        try {
            const logoutResponse: AxiosResponse = await withRetry(
                () =>
                    this.apiClient.delete(`/login/session/v1`, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                3, // maxRetries: try 3 additional times
                1000 // delayMs: wait 1000ms between attempts
            );

            if (logoutResponse.status === 204) {
                if (projectTreeDataProvider) {
                    projectTreeDataProvider.clearTree();
                } else {
                    // Note: When deactivating the extension or closing VS Code, the tree data provider may be null and this warning is expected.
                    logger.warn("Tree data provider is not defined. Cannot clear the tree.");
                }

                const logoutSuccessfulMessage = "Logout successful.";
                logger.debug(logoutSuccessfulMessage);
                vscode.window.showInformationMessage(logoutSuccessfulMessage);
            } else {
                const logoutFailedMessage = `Logout failed. Unexpected response status: ${logoutResponse.status}`;
                logger.error(logoutFailedMessage);
                vscode.window.showWarningMessage(logoutFailedMessage);
                return null;
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const logoutErrorMessage = `Error during logout: ${error.response?.status} - ${error.response?.statusText}. If the issue persists, please log in again.`;
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
            await vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", false);
            setProjectManagementTreeDataProvider(null); // Clear the connection from the tree data provider
            setConnection(null);
            // Notify login webview about the logout success to change its HTML content
            if (loginWebViewProvider) {
                loginWebViewProvider.updateWebviewContent();
            } else {
                logger.warn("loginWebViewProvider is null. Cannot update webview content.");
            }
        }
    }

    /**
     * Uploads a zip archive containing JSON-based test execution results to the TestBench server.
     *
     * @param {number} projectKey - The project key.
     * @param {string} zipFilePath - The file path to the zip archive.
     * @returns {Promise<string>} The file name returned by the server.
     * @throws An error if the upload fails.
     */
    public async uploadExecutionResultsAndReturnUploadedFileName(
        projectKey: number,
        zipFilePath: string
    ): Promise<string> {
        const uploadResultZipURL = `/projects/${projectKey}/executionResults/v1`;

        try {
            const zipFileData: Buffer = fs.readFileSync(zipFilePath);
            logger.debug(`Uploading zip file "${zipFilePath}" to ${uploadResultZipURL}`);
            const uploadZipResponse: AxiosResponse = await withRetry(
                () =>
                    this.apiClient.post(uploadResultZipURL, zipFileData, {
                        headers: {
                            "Content-Type": "application/zip",
                            accept: "application/json"
                        },
                        // Handle all status codes manually
                        validateStatus: () => true
                    }),
                3, // maxRetries: try 3 additional times
                1000, // delayMs: wait 1000ms between attempts
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

            switch (uploadZipResponse.status) {
                case 201: {
                    logger.debug("Report uploaded successfully.");
                    // Extract the fileName from the response and return it
                    const fileName: string | undefined = uploadZipResponse.data?.fileName;
                    if (fileName) {
                        return fileName;
                    } else {
                        const fileNameNotFoundMessage = "File name not found in server response.";
                        logger.error(fileNameNotFoundMessage);
                        throw new Error(fileNameNotFoundMessage);
                    }
                }
                case 403: {
                    const uploadForbiddenMessage = "Forbidden: You do not have permission to upload execution results.";
                    logger.error(uploadForbiddenMessage);
                    throw new Error(uploadForbiddenMessage);
                }
                case 404: {
                    const uploadNotFoundMessage = "Not Found: The requested project was not found.";
                    logger.error(uploadNotFoundMessage);
                    throw new Error(uploadNotFoundMessage);
                }
                case 422: {
                    const uploadUnprocessableEntityMessage = "Unprocessable Entity: The uploaded file is invalid.";
                    logger.error(uploadUnprocessableEntityMessage);
                    throw new Error(uploadUnprocessableEntityMessage);
                }
                default: {
                    const uploadUnexpectedErrorMessage = `Unexpected status code ${uploadZipResponse.status} received.`;
                    logger.error(uploadUnexpectedErrorMessage);
                    throw new Error(uploadUnexpectedErrorMessage);
                }
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error("An Axios error occurred while uploading the file:", error.message);
                if (error.response) {
                    logger.error("Error response data:", error.response.data);
                }
            } else {
                logger.error("An unexpected error occurred while uploading the file:", error);
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
        const getJobIDOfImportUrl = `/projects/${projectKey}/cycles/${cycleKey}/import/v1`;

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
                1000, // delayMs: wait 1000ms between attempts
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
                        const importJobIDNotFoundMessage =
                            "Success response received but no jobID found in the response.";
                        logger.error(importJobIDNotFoundMessage);
                        throw new Error(importJobIDNotFoundMessage);
                    }
                }
                case 400: {
                    const importBadRequestMessage = "Bad Request: The request body is invalid.";
                    logger.error(importBadRequestMessage);
                    throw new Error(importBadRequestMessage);
                }
                case 403: {
                    const importForbiddenMessage = "Forbidden: You do not have permission to import execution results.";
                    logger.error(importForbiddenMessage);
                    throw new Error(importForbiddenMessage);
                }
                case 404: {
                    const importNotFoundMessage = "Not Found: Project or test cycle not found.";
                    logger.error(importNotFoundMessage);
                    throw new Error(importNotFoundMessage);
                }
                case 422: {
                    const importUnprocessableEntityMessage =
                        "Unprocessable Entity: The server cannot process the request.";
                    logger.error(importUnprocessableEntityMessage);
                    throw new Error(importUnprocessableEntityMessage);
                }
                default: {
                    const importUnexpectedErrorMessage = `Unexpected status code ${importJobIDResponse.status} received.`;
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
    private startKeepAlive(): void {
        this.stopKeepAlive(); // Prevent multiple intervals if previously started.
        this.keepAliveIntervalId = setInterval(
            () => {
                this.sendKeepAliveRequest();
            },
            4 * 60 * 1000 // Every 4 minutes
        );
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
        if (!this.sessionToken) {
            logger.warn("Session token is null. Cannot send keep-alive request.");
            return;
        }

        try {
            await withRetry(
                () =>
                    this.apiClient.get(`/login/session/v1`, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                3, // maxRetries: try 3 additional times
                1000 // delayMs: wait 1000ms between attempts
            );
            logger.trace("Keep-alive request sent.");
        } catch (error) {
            logger.error("Keep-alive request failed after retries:", error);
            logger.warn("Logging out the user after keep-alive failure.");
            await vscode.commands.executeCommand(`${allExtensionCommands.logout.command}`);
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
async function withRetry<T>(
    asyncFunction: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000,
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
                        title: "Retrying request...",
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

/**
 * Prompts the user for general input with live validation.
 * Loops until valid input is provided, "quit" is typed, or the user cancels.
 *
 * @param promptMessage - The prompt message.
 * @param inputCanBeEmpty - Whether the input may be empty.
 * @param maskSensitiveInputData - Whether to mask the input (e.g. for passwords).
 * @param validateInputFunction - Optional validation function; should return an error message if invalid.
 * @returns {Promise<string | null>} The user input as a string, or null if aborted.
 */
async function promptForInputAndValidate(
    promptMessage: string,
    inputCanBeEmpty: boolean = false,
    maskSensitiveInputData: boolean = false,
    validateInputFunction?: (value: string) => string | null
): Promise<string | null> {
    while (true) {
        const input = await vscode.window.showInputBox({
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
            }
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
 * Performs the login process to the TestBench server by prompting the user for the server name, port number, username, and password.
 * Loops until login is successful or the user cancels.
 *
 * @param {vscode.ExtensionContext} context - The extension context.
 * @param {boolean} promptForNewCredentials - Whether to prompt for new credentials.
 * @param {boolean} performAutoLoginWithStoredCredentialsWithoutPrompting - (Optional) Whether to auto-login without prompting.
 * @returns {Promise<PlayServerConnection | null>} A PlayServerConnection if login is successful; otherwise, null.
 */
export async function performLogin(
    context: vscode.ExtensionContext,
    promptForNewCredentials: boolean = false,
    performAutoLoginWithStoredCredentialsWithoutPrompting?: boolean
): Promise<PlayServerConnection | null> {
    // Loop until the user successfully logs in or cancels the login process
    while (true) {
        // Retrieve the stored credentials if they exist
        const storePasswordAfterSuccessfulLogin: boolean = getConfig().get<boolean>("storePasswordAfterLogin", false);
        let password: string | undefined;

        // Only retrieve the password if the user has choosen to store it after successful login
        if (storePasswordAfterSuccessfulLogin) {
            password = await context.secrets.get("password");
        }
        const userHasStoredCredentials = !!(
            getConfig().get<string>("serverName") &&
            getConfig().get<string>("username") &&
            password &&
            storePasswordAfterSuccessfulLogin
        );

        let useStoredCredentials = false;
        // If the user has stored credentials and can auto-login,
        // and the user has not chosen to prompt for new credentials,
        // and the user has not chosen to auto-login without prompting, then auto-login
        if (
            userHasStoredCredentials &&
            !promptForNewCredentials &&
            !performAutoLoginWithStoredCredentialsWithoutPrompting
        ) {
            const choice = await vscode.window.showInformationMessage(
                "Do you want to login using your previous credentials?",
                // Modal dialog is used so that the input box wont disappear, which forces the user to choose an option. Without it, login may be locked.
                { modal: true },
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
        } else {
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
            const credentials = await promptForLoginCredentials();
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
            serverName!,
            portNumber!,
            username!,
            password!
        );

        if (newConnection) {
            return newConnection;
        } else {
            // Login may fail due to a server problem or incorrect credentials.
            const retry = await vscode.window.showInformationMessage(
                "Login failed! Do you want to retry?",
                "Retry",
                "Cancel"
            );
            if (retry !== "Retry") {
                vscode.window.showInformationMessage("Login process aborted.");
                logger.debug("Login process aborted.");
                return null;
            }
            // Continue the loop to retry
        }
    }
}

/**
 * Prompts the user for login credentials.
 *
 * @returns {Promise<{ serverName: string; portNumber: number; username: string; password: string } | null>}
 * An object containing serverName, portNumber, username, and password or null if aborted.
 */
async function promptForLoginCredentials(): Promise<{
    serverName: string;
    portNumber: number;
    username: string;
    password: string;
} | null> {
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
    const portInputAsString = await promptForInputAndValidate(
        `Enter the port number${portInConfig ? ` (Default: ${portInConfig})` : ""}`,
        true,
        false,
        (value) => (!/^\d+$/.test(value) ? "Port number must be a number" : null)
    );
    if ((!portInputAsString && !portInConfig) || portInputAsString === undefined) {
        logger.trace("Login process aborted while entering port number.");
        return null;
    }
    const portNumber: number = portInputAsString ? parseInt(portInputAsString, 10) : portInConfig;

    const serverVersionsResponse: testBenchTypes.ServerVersionsResponse | null = await fetchServerVersions(
        serverName,
        portNumber
    );
    if (!serverVersionsResponse) {
        const serverVersionsErrorMessage = "Server not accessible with the provided server name and port.";
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

    const password: string | null = await promptForInputAndValidate("Enter your password", false, true);
    if (!password) {
        logger.trace("Login process aborted while entering password.");
        return null;
    }

    return { serverName, portNumber, username, password };
}

/**
 * Logs in to the TestBench server and initializes a session token.
 *
 * @param {vscode.ExtensionContext} context - The extension context.
 * @param {string} serverName - The server name.
 * @param {number} portNumber - The port number.
 * @param {string} username - The username.
 * @param {string} password - The password.
 * @returns {Promise<PlayServerConnection | null>} A PlayServerConnection if login is successful; otherwise, null.
 */
export async function loginToNewPlayServerAndInitSessionToken(
    context: vscode.ExtensionContext,
    serverName: string,
    portNumber: number,
    username: string,
    password: string
): Promise<PlayServerConnection | null> {
    const requestBody: testBenchTypes.LoginRequestBody = {
        login: username,
        password: password,
        force: true
    };
    try {
        const connection = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Logging in",
                cancellable: true
            },
            async (progress) => {
                const baseURL = `https://${serverName}:${portNumber}/api`;
                const loginURL = `${baseURL}/login/session/v1`;

                logger.trace("Sending login request to:", loginURL);
                progress.report({ message: "Sending login request..." });

                const loginResponse: AxiosResponse<testBenchTypes.LoginResponse> = await withRetry(
                    () =>
                        axios.post(loginURL, requestBody, {
                            headers: {
                                accept: "application/vnd.testbench+json",
                                "Content-Type": "application/vnd.testbench+json"
                            },
                            httpsAgent: new https.Agent({ rejectUnauthorized: false })
                        }),
                    3, // maxRetries
                    1000, // delayMs
                    (error) => {
                        // Do not retry if the error is due to invalid credentials (HTTP 401)
                        if (axios.isAxiosError(error) && error.response && error.response.status === 401) {
                            return false;
                        }
                        return true;
                    }
                );

                // An exception is thrown automatically if the status code is not 2xx
                if (loginResponse.status === 201) {
                    // Store password in secret storage after succesfull login if the user chooses to
                    if (getConfig().get<boolean>("storePasswordAfterLogin", false)) {
                        await context.secrets.store("password", password);
                        logger.trace("Password stored securely.");
                    } else {
                        logger.trace("User chose not to store password.");
                    }
                    // Starts keep alive in the constructor of PlayServerConnection
                    const newConnection: PlayServerConnection = new PlayServerConnection(
                        context,
                        serverName,
                        portNumber,
                        loginResponse.data.sessionToken
                    );
                    // Set the global connection object, it can be null in case the login fails
                    setConnection(newConnection);
                    // Set the connectionActive context value for changing the login icon to logout icon based on this value
                    await vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", true);
                    const loginSuccessfulMessage: string = "Login successful.";
                    logger.debug(loginSuccessfulMessage);
                    vscode.window.showInformationMessage(loginSuccessfulMessage);
                    // Upon successful login, update the login webview content and hide it.
                    if (loginWebViewProvider) {
                        loginWebViewProvider.updateWebviewContent();
                        loginWebView.hideWebView();
                    } else {
                        logger.warn("loginWebViewProvider is null. Cannot update webview content.");
                    }
                    return newConnection;
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
        if (axios.isAxiosError(error) && error.response && error.response.status === 401) {
            logger.error("Login failed: Invalid credentials.");
            vscode.window.showInformationMessage("Login failed: Invalid credentials.");
        } else {
            logger.error("Error during login");
            vscode.window.showInformationMessage("Error during login.");
        }
        return null;
    }
}

/**
 * Clears stored user credentials from secret storage.
 *
 * @param context - The extension context.
 */
export async function clearStoredCredentials(context: vscode.ExtensionContext): Promise<void> {
    try {
        await context.secrets.delete("password");
        logger.debug("Credentials deleted from secret storage.");
    } catch (error) {
        logger.error("Failed to clear credentials:", error);
    }
}

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
            1000, // delayMs: wait 1000ms between attempts
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
        const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            vscode.window.showErrorMessage("Workspace location is not set in the configuration.");
            logger.warn("Workspace location is not set in the configuration.");
            return null;
        }

        const workingDirectoryPath = path.join(workspaceLocation, folderNameOfTestbenchWorkingDirectory);
        const options: vscode.OpenDialogOptions = {
            defaultUri: vscode.Uri.file(workingDirectoryPath),
            openLabel: "Select Zip File with Test Results",
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            filters: { "Zip Files": ["zip"] }
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (!fileUri || !fileUri[0]) {
            vscode.window.showErrorMessage("No file selected. Please select a valid .zip file.");
            logger.debug("No zip file selected.");
            return null;
        }

        const selectedFilePath = fileUri[0].fsPath;
        if (!selectedFilePath.endsWith(".zip")) {
            vscode.window.showErrorMessage("Selected file is not a .zip file. Please select a valid .zip file.");
            logger.debug("Selected file is not a .zip file.");
            return null;
        }
        return selectedFilePath;
    } catch (error: any) {
        const zipSelectionErrorMessage = `An error occurred while selecting the report zip file: ${error.message}`;
        vscode.window.showErrorMessage(zipSelectionErrorMessage);
        logger.error(zipSelectionErrorMessage);
        return null;
    }
}

/**
 * Recursively searches for a cycle key matching the given cycle name.
 *
 * @param treeElements - The array of tree elements.
 * @param cycleName - The cycle name to search for.
 * @returns {string | null} The cycle key if found, otherwise null.
 */
function findCycleKeyFromCycleNameRecursively(treeElements: any[], cycleName: string): string | null {
    for (const element of treeElements) {
        if (
            (element.item?.nodeType === "Cycle" && element.item?.name === cycleName) ||
            (element.nodeType === "Cycle" && element.name === cycleName)
        ) {
            return element.key;
        }
        // Recursively search in children elements
        const children: any[] = element.item?.children || element.children;
        if (children && children.length > 0) {
            const foundCycleKey = findCycleKeyFromCycleNameRecursively(children, cycleName);
            if (foundCycleKey) {
                return foundCycleKey;
            }
        }
    }
    return null;
}

// TODO: remove projectManagementTreeDataProvider when we replace local search with server project tree fetching and then searching
/**
 * Imports a report (zip file with test results) to the TestBench server.
 *
 * @param connection - The PlayServerConnection.
 * @param projectManagementTreeDataProvider - The tree data provider.
 * @param resultZipFilePath - The file path of the zip file.
 * @returns {Promise<void | null>} A promise that resolves when the import is complete, or null if an error occurs.
 */
export async function importReportWithResultsToTestbench(
    connection: PlayServerConnection,
    projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider,
    resultZipFilePath: string
): Promise<void | null> {
    try {
        logger.debug("Importing report with results to TestBench server.");
        const { uniqueID, projectKey, cycleNameOfProject } = await extractDataFromReport(resultZipFilePath);
        if (!uniqueID || !projectKey || !cycleNameOfProject) {
            const msg = "Error extracting project key, cycle name, and unique ID from the zip file.";
            vscode.window.showErrorMessage(msg);
            logger.error(msg);
            return null;
        }

        // TODO: We are currently searching for the Cycle key of the exported test theme locally, which causes issues if the project management tree is not initialized.
        // Later, we should fetch the project tree from the server and search for the cycle key there.

        const allTreeElementsInTreeView = await projectManagementTreeDataProvider.getChildren(undefined);
        if (!allTreeElementsInTreeView) {
            const loadProjectTreeErrorMessage =
                "Failed to load project management tree elements for importing results.";
            logger.error(loadProjectTreeErrorMessage);
            vscode.window.showErrorMessage("Failed to load project management tree elements.");
            return null;
        }

        /*
        // For debugging, save the tree elements to a file called allTreeElements.json
        const allTreeElementsPath = path.join(__dirname, "allTreeElements.json");
        utils.saveJsonDataToFile(allTreeElementsPath, allTreeElementsInTreeView);
        console.log(`allTreeElements saved to ${allTreeElementsPath}`);
        */

        const cycleKeyOfImportedReport = findCycleKeyFromCycleNameRecursively(
            allTreeElementsInTreeView,
            cycleNameOfProject
        );
        if (!cycleKeyOfImportedReport) {
            const cycleNotFoundErrorMessage = "Cycle not found in the project tree.";
            logger.error(cycleNotFoundErrorMessage);
            vscode.window.showErrorMessage(cycleNotFoundErrorMessage);
            return null;
        }

        const zipFilenameFromServer = await connection.uploadExecutionResultsAndReturnUploadedFileName(
            Number(projectKey),
            resultZipFilePath
        );
        if (!zipFilenameFromServer) {
            const uploadErrorMessage = "Error uploading the result file to the server.";
            logger.error(uploadErrorMessage);
            vscode.window.showErrorMessage(uploadErrorMessage);
            return null;
        }

        // TODO: Check the new data of the new branch
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
            ]
        };

        try {
            // Start the import job
            logger.debug("Starting import execution results.");
            const importJobID = await connection.getJobIDOfImportJob(
                Number(projectKey),
                Number(cycleKeyOfImportedReport),
                importData
            );

            // Poll the job status until it is completed
            const importJobStatus = await reportHandler.pollJobStatus(projectKey.toString(), importJobID, "import");

            // Check if the job is completed successfully
            if (!importJobStatus || reportHandler.isImportJobFailed(importJobStatus)) {
                const importJobFailedMessage = "Import job not completed or failed.";
                logger.warn(importJobFailedMessage);
                vscode.window.showErrorMessage(importJobFailedMessage);
                return null;
            } else {
                vscode.window.showInformationMessage("Import completed successfully.");
            }
        } catch (error: any) {
            logger.error("Error during import job:", error.message);
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
 * @param {projectManagementTreeView.ProjectManagementTreeDataProvider} projectManagementTreeDataProvider - The tree data provider.
 * @returns {Promise<void | null>} A promise that resolves when the import is complete, or null if an error occurs.
 */
export async function selectReportWithResultsAndImportToTestbench(
    connection: PlayServerConnection,
    projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider
): Promise<void | null> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Importing results to TestBench server`,
            cancellable: true
        },
        async (progress) => {
            progress.report({ message: "Selecting report file with results.", increment: 30 });
            const resultZipFilePath = await promptForReportZipFileWithResults();
            if (!resultZipFilePath) {
                logger.error("No location selected for the report zip file with results.");
                return null;
            }
            progress.report({ message: "Importing report file.", increment: 30 });
            await importReportWithResultsToTestbench(connection, projectManagementTreeDataProvider, resultZipFilePath);
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
async function extractDataFromReport(zipFilePath: string): Promise<{
    uniqueID: string | null;
    projectKey: string | null;
    cycleNameOfProject: string | null;
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

        logger.debug(
            `Extracted data from zip file "${zipFilePath}": uniqueID = ${uniqueID}, projectKey = ${projectKey}, cycleName = ${cycleNameOfProject}`
        );
        return { uniqueID, projectKey, cycleNameOfProject };
    } catch (error) {
        logger.error("Error extracting JSON data from zip file:", error);
        return { uniqueID: null, projectKey: null, cycleNameOfProject: null };
    }
}
