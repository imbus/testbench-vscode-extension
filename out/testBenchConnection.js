"use strict";
/**
 * @file testBenchConnection.ts
 * @description Handles connection and communication with the TestBench server.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayServerConnection = void 0;
exports.performLogin = performLogin;
exports.loginToNewPlayServerAndInitSessionToken = loginToNewPlayServerAndInitSessionToken;
exports.clearStoredCredentials = clearStoredCredentials;
exports.importReportWithResultsToTestbench = importReportWithResultsToTestbench;
exports.selectReportWithResultsAndImportToTestbench = selectReportWithResultsAndImportToTestbench;
const https = __importStar(require("https"));
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const reportHandler = __importStar(require("./reportHandler"));
const base64 = __importStar(require("base-64")); // npm i --save-dev @types/base-64
const jszip_1 = __importDefault(require("jszip"));
const axios_1 = __importDefault(require("axios"));
const path_1 = __importDefault(require("path"));
const server_1 = require("./server");
const extension_1 = require("./extension");
const utils = __importStar(require("./utils"));
const constants_1 = require("./constants");
// TODO: Temporarily ignore SSL certificate validation (remove in production)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
/**
 * Represents a connection to the TestBench Play server.
 * Handles communication with the server, including login, logout, and API requests.
 */
class PlayServerConnection {
    serverName;
    portNumber;
    username;
    sessionToken;
    baseURL;
    apiClient;
    keepAliveIntervalInSeconds = 4 * 60 * 1000; // 4 minutes
    keepAliveIntervalId = null;
    /**
     * Creates a new PlayServerConnection.
     *
     * @param {string} serverName - The name of the server.
     * @param {number} portNumber - The port number of the server.
     * @param {string} username - The username for authentication.
     * @param {string} sessionToken - The session token for authentication.
     */
    constructor(serverName, portNumber, username, sessionToken) {
        this.serverName = serverName;
        this.portNumber = portNumber;
        this.username = username;
        this.sessionToken = sessionToken;
        this.baseURL = `https://${this.serverName}:${this.portNumber}/api`;
        // Create Axios instance for API calls to the server using the session token
        this.apiClient = axios_1.default.create({
            baseURL: this.baseURL,
            headers: { Authorization: this.sessionToken },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false // TODO: Use true in production.
            })
        });
        // Start the keep-alive process immediately to prevent session timeout after 5 minutes
        this.startKeepAlive();
    }
    /** Returns the server name. */
    getServerName() {
        return this.serverName;
    }
    /** Returns the server port. */
    getServerPort() {
        return this.portNumber.toString();
    }
    getUsername() {
        return this.username;
    }
    /** Returns the current session token. */
    getSessionToken() {
        return this.sessionToken;
    }
    /** Returns the base URL of the server. */
    getBaseURL() {
        return this.baseURL;
    }
    /** Returns the Axios API client. */
    getApiClient() {
        return this.apiClient;
    }
    /**
     * Retrieves the session token from VS Code's secret storage.
     *
     * @param {vscode.ExtensionContext} context - The extension context.
     * @returns {Promise<string | undefined>} The session token or undefined if not found.
     */
    async getSessionTokenFromSecretStorage(context) {
        const token = await context.secrets.get(constants_1.StorageKeys.SESSION_TOKEN);
        if (!token) {
            extension_1.logger.error("Session token not found.");
        }
        return token;
    }
    /** Clears session data and resets API client and keep-alive timer. */
    clearSessionData() {
        this.baseURL = "";
        this.serverName = "";
        this.portNumber = 0;
        this.sessionToken = "";
        this.apiClient = axios_1.default.create();
        this.keepAliveIntervalId = null;
    }
    /**
     * Displays a quick pick list for selecting a project key.
     *
     * @param projectsData - The list of projects fetched from the server.
     * @returns {Promise<string | null>} The selected project key or null if none selected.
     */
    async getProjectKeyFromProjectListQuickPickSelection(projectsData) {
        // Extract project names from the projects data and display them in a quick pick list
        const projectNames = projectsData.map((project) => project.name);
        const selectedProjectName = await vscode.window.showQuickPick(projectNames, {
            placeHolder: "Select a project"
        });
        if (!selectedProjectName) {
            extension_1.logger.error("Selected project name not found.");
            return null;
        }
        extension_1.logger.debug("Selected project name:", selectedProjectName);
        const selectedProject = projectsData.find((project) => project.name === selectedProjectName);
        if (!selectedProject) {
            extension_1.logger.error("Selected project not found.");
            return null;
        }
        return selectedProject.key;
    }
    /**
     * Fetches the list of projects from the TestBench server.
     *
     * @returns {Promise<testBenchTypes.Project[] | null>} The list of projects or null if an error occurs.
     */
    async getProjectsList() {
        if (!this.sessionToken) {
            extension_1.logger.error("Session token is null. Cannot fetch projects list.");
            return null;
        }
        try {
            extension_1.logger.debug("Fetching projects list.");
            const projectsURL = `/projects/v1`;
            // Wrap the project list get request in the withRetry helper.
            const projectsResponse = await withRetry(() => this.apiClient.get(projectsURL, {
                headers: { accept: "application/vnd.testbench+json" }
            }), 3, // maxRetries: try 3 additional times
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
            extension_1.logger.trace("Response status of project list request:", projectsResponse.status);
            if (projectsResponse.data) {
                extension_1.logger.trace("Fetched project list:", projectsResponse.data);
                return projectsResponse.data;
            }
            else {
                extension_1.logger.error("Project list data is null or undefined.");
                return null;
            }
        }
        catch (error) {
            // Axios throws an error automatically if the response status is not 2xx
            extension_1.logger.error("Error fetching projects:", error);
            return null;
        }
    }
    /**
     * Fetches the project tree for a specific project from the TestBench server.
     *
     * @param {string | null} projectKey - The project key as a string.
     * @returns {Promise<testBenchTypes.TreeNode | null>} The project tree fetched from the server or null if an error occurs.
     */
    async getProjectTreeOfProject(projectKey) {
        extension_1.logger.trace("Fetching project tree for project key:", projectKey);
        if (!this.sessionToken) {
            extension_1.logger.error("Session token is null. Cannot fetch project tree for project key:", projectKey);
            return null;
        }
        if (!projectKey) {
            extension_1.logger.error("Project key is null or undefined. Cannot fetch project tree.");
            return null;
        }
        try {
            const projectTreeURL = `/projects/${projectKey}/tree/v1`;
            const projectTreeResponse = await withRetry(() => this.apiClient.get(projectTreeURL, {
                headers: { accept: "application/vnd.testbench+json" }
            }), 3, // maxRetries: try 3 additional times
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
            extension_1.logger.trace("Response status of project tree request:", projectTreeResponse.status);
            if (projectTreeResponse.data) {
                extension_1.logger.trace("Fetched project tree:", projectTreeResponse.data);
                return projectTreeResponse.data;
            }
            else {
                extension_1.logger.error("Project tree data is null or undefined.");
                return null;
            }
        }
        catch (error) {
            extension_1.logger.error("Error fetching project tree:", error);
            return null;
        }
    }
    /**
     * Fetches test elements using the Test Object Version (TOV) key from the old play server.
     *
     * @param {string | null} tovKey - The TOV key as a string.
     * @returns {Promise<any | null>} The test elements data fetched from the server or null if an error occurs.
     */
    async getTestElementsWithTovKeyUsingOldPlayServer(tovKey) {
        extension_1.logger.debug("Fetching test elements with TOV key:", tovKey);
        if (!this.sessionToken) {
            extension_1.logger.error("Session token is null. Cannot fetch test elements for TOV key:", tovKey);
            return null;
        }
        if (!tovKey) {
            extension_1.logger.error("TOV key is null or undefined. Cannot fetch test elements.");
            return null;
        }
        try {
            const oldPlayServerPortNumber = 9443;
            const oldPlayServerBaseUrl = `https://${this.serverName}:${oldPlayServerPortNumber}/api/1`;
            const getTestElementsURL = `/tovs/${tovKey}/testElements`;
            extension_1.logger.trace("Creating session for old play server.");
            // Create session for API calls to the old play server
            const oldPlayServerSession = axios_1.default.create({
                baseURL: oldPlayServerBaseUrl,
                // Old play server, which runs on port 9443, uses BasicAuth.
                // Use loginName as username, and use sessionToken as the password
                auth: {
                    username: (0, extension_1.getConfig)().get("username"),
                    password: this.sessionToken
                },
                headers: {
                    // Manually encode the credentials to Base64
                    Authorization: `Basic ${base64.encode(`${(0, extension_1.getConfig)().get("username")}:${this.sessionToken}`)}`,
                    "Content-Type": "application/vnd.testbench+json; charset=utf-8"
                },
                // Ignore self-signed certificates
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false //TODO: This should only be used in a development environment
                })
            });
            extension_1.logger.trace(`Sending GET request to ${getTestElementsURL} for TOV key ${tovKey}`);
            const testElementsResponse = await withRetry(() => oldPlayServerSession.get(getTestElementsURL), 3, // maxRetries: try 3 additional times
            2000, // delayMs: wait 2000ms between attempts
            (error) => {
                if (axios_1.default.isAxiosError(error) && error.response) {
                    // Do not retry if the error is due to authentication or if the resource is not found.
                    const nonRetryableStatusCodes = [401, 404];
                    if (nonRetryableStatusCodes.includes(error.response.status)) {
                        return false;
                    }
                }
                return true;
            });
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
            extension_1.logger.trace("Response status of get test elements request:", testElementsResponse.status);
            if (testElementsResponse.data) {
                extension_1.logger.trace("Fetched test elements data:", testElementsResponse.data);
                return testElementsResponse.data;
            }
            else {
                extension_1.logger.error("Test elements data is null or undefined.");
                return null;
            }
        }
        catch (error) {
            extension_1.logger.error("Error fetching test elements:", error);
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
    async fetchCycleStructureOfCycleInProject(projectKey, cycleKey) {
        const cycleStructureUrl = `/projects/${projectKey}/cycles/${cycleKey}/structure/v1`;
        const requestBody = {
            basedOnExecution: true,
            suppressFilteredData: false,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: []
        };
        try {
            const cycleStructureResponse = await withRetry(() => this.apiClient.post(cycleStructureUrl, requestBody, {
                headers: {
                    accept: "application/json",
                    "Content-Type": "application/json"
                }
            }), 3, // maxRetries: try 3 additional times
            2000, // delayMs: wait 2000ms between attempts
            (error) => {
                if (axios_1.default.isAxiosError(error) && error.response) {
                    // Do not retry if the error is due to a bad request, missing resource, or unprocessable data.
                    const nonRetryableStatusCodes = [400, 404, 422];
                    if (nonRetryableStatusCodes.includes(error.response.status)) {
                        return false;
                    }
                }
                return true;
            });
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
            extension_1.logger.trace(`Cycle structure response for cycle key ${cycleKey}:`, cycleStructureResponse.status);
            if (cycleStructureResponse.data) {
                extension_1.logger.trace(`Received cycle structure for cycle key ${cycleKey}:`, cycleStructureResponse.data);
                return cycleStructureResponse.data;
            }
            else {
                extension_1.logger.error(`Unexpected response code: ${cycleStructureResponse.status}`);
                return null;
            }
        }
        catch (error) {
            extension_1.logger.error("Error fetching cycle structure:", error);
            return null;
        }
    }
    /**
     * Logs out the user from the TestBench server.
     * Clears session data, stops the keep-alive process, clears the tree data provider which empties the tree view.
     *
     * @param {projectManagementTreeView.ProjectManagementTreeDataProvider} projectTreeDataProvider - The project management tree data provider.
     * @returns {Promise<void | null>} A promise that resolves when logout is complete, or null if an error occurs.
     */
    async logoutUser(projectTreeDataProvider) {
        extension_1.logger.debug("Logging out user.");
        try {
            const logoutResponse = await withRetry(() => this.apiClient.delete(`/login/session/v1`, {
                headers: { accept: "application/vnd.testbench+json" }
            }), 3, // maxRetries: try 3 additional times
            2000 // delayMs: wait 2000ms between attempts
            );
            if (logoutResponse.status === 204) {
                if (projectTreeDataProvider) {
                    projectTreeDataProvider.clearTree();
                }
                else {
                    // Note: When deactivating the extension or closing VS Code, the tree data provider may be null and this warning is expected.
                    extension_1.logger.warn("Tree data provider is not defined. Cannot clear the tree.");
                }
                const logoutSuccessfulMessage = "Logout successful.";
                server_1.client.stop();
                extension_1.logger.debug(logoutSuccessfulMessage);
                vscode.window.showInformationMessage(logoutSuccessfulMessage);
            }
            else {
                const logoutFailedMessage = `Logout failed. Unexpected response status: ${logoutResponse.status}`;
                extension_1.logger.error(logoutFailedMessage);
                vscode.window.showWarningMessage(logoutFailedMessage);
                return null;
            }
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                const logoutErrorMessage = `Error during logout: ${error.response?.status} - ${error.response?.statusText}. If the issue persists, please log in again.`;
                extension_1.logger.error(logoutErrorMessage);
                vscode.window.showWarningMessage(logoutErrorMessage);
                return null;
            }
            else {
                extension_1.logger.error(`Unexpected error during logout: ${error}`);
                return null;
            }
        }
        finally {
            // Regardless of the outcome of logout operation, stop the keep-alive process
            this.stopKeepAlive();
            this.clearSessionData(); // Clear the session data after stopping keep-alive because it also resets keepAliveIntervalId
            await vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", false);
            (0, extension_1.setProjectManagementTreeDataProvider)(null); // Clear the connection from the tree data provider
            (0, extension_1.setConnection)(null);
            // Notify login webview about the logout success to change its HTML content
            if (extension_1.loginWebViewProvider) {
                extension_1.loginWebViewProvider.updateWebviewHTMLContent();
            }
            else {
                extension_1.logger.error("loginWebViewProvider is null. Cannot update webview content.");
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
    async importExecutionResultsAndReturnImportedFileName(projectKey, zipFilePath) {
        const importResultZipURL = `/projects/${projectKey}/executionResults/v1`;
        try {
            const zipFileData = fs.readFileSync(zipFilePath);
            extension_1.logger.debug(`Importing zip file "${zipFilePath}" to ${importResultZipURL}`);
            const importZipResponse = await withRetry(() => this.apiClient.post(importResultZipURL, zipFileData, {
                headers: {
                    "Content-Type": "application/zip",
                    accept: "application/json"
                },
                // Handle all status codes manually
                validateStatus: () => true
            }), 3, // maxRetries: try 3 additional times
            2000, // delayMs: wait 2000ms between attempts
            (error) => {
                // Do not retry if the error is due to a non-transient condition
                if (axios_1.default.isAxiosError(error) && error.response) {
                    const nonRetryableStatusCodes = [403, 404, 422];
                    if (nonRetryableStatusCodes.includes(error.response.status)) {
                        return false;
                    }
                }
                return true;
            });
            switch (importZipResponse.status) {
                case 201: {
                    extension_1.logger.debug("Report imported successfully.");
                    // Extract the fileName from the response and return it
                    const fileName = importZipResponse.data?.fileName;
                    if (fileName) {
                        return fileName;
                    }
                    else {
                        const fileNameNotFoundMessage = "File name not found in server response.";
                        extension_1.logger.error(fileNameNotFoundMessage);
                        throw new Error(fileNameNotFoundMessage);
                    }
                }
                case 403: {
                    const importForbiddenMessage = "Forbidden: You do not have permission to import execution results.";
                    extension_1.logger.error(importForbiddenMessage);
                    throw new Error(importForbiddenMessage);
                }
                case 404: {
                    const importNotFoundMessage = "Not Found: The requested project was not found.";
                    extension_1.logger.error(importNotFoundMessage);
                    throw new Error(importNotFoundMessage);
                }
                case 422: {
                    const importUnprocessableEntityMessage = "Unprocessable Entity: The imported file is invalid.";
                    extension_1.logger.error(importUnprocessableEntityMessage);
                    throw new Error(importUnprocessableEntityMessage);
                }
                default: {
                    const importUnexpectedErrorMessage = `Unexpected status code ${importZipResponse.status} received.`;
                    extension_1.logger.error(importUnexpectedErrorMessage);
                    throw new Error(importUnexpectedErrorMessage);
                }
            }
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                extension_1.logger.error("An Axios error occurred while importing the file:", error.message);
                if (error.response) {
                    extension_1.logger.error("Error response data:", error.response.data);
                }
            }
            else {
                extension_1.logger.error("An unexpected error occurred while importing the file:", error);
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
    async getJobIDOfImportJob(projectKey, cycleKey, importData) {
        const getJobIDOfImportUrl = `/projects/${projectKey}/cycles/${cycleKey}/import/v1`;
        try {
            const importJobIDResponse = await withRetry(() => this.apiClient.post(getJobIDOfImportUrl, importData, {
                headers: {
                    "Content-Type": "application/json",
                    accept: "application/json"
                },
                validateStatus: () => true
            }), 3, // maxRetries: try 3 additional times
            2000, // delayMs: wait 2000ms between attempts
            (error) => {
                // Do not retry if the error has a non-transient status code.
                if (axios_1.default.isAxiosError(error) && error.response) {
                    const nonRetryableStatusCodes = [400, 403, 404, 422];
                    if (nonRetryableStatusCodes.includes(error.response.status)) {
                        return false;
                    }
                }
                return true;
            });
            switch (importJobIDResponse.status) {
                case 200: {
                    const jobID = importJobIDResponse.data?.jobID;
                    if (jobID) {
                        extension_1.logger.debug(`Import initiated successfully. Job ID: ${jobID}`);
                        return jobID;
                    }
                    else {
                        const importJobIDNotFoundMessage = "Success response received but no jobID found in the response.";
                        extension_1.logger.error(importJobIDNotFoundMessage);
                        throw new Error(importJobIDNotFoundMessage);
                    }
                }
                case 400: {
                    const importBadRequestMessage = "Bad Request: The request body is invalid.";
                    extension_1.logger.error(importBadRequestMessage);
                    throw new Error(importBadRequestMessage);
                }
                case 403: {
                    const importForbiddenMessage = "Forbidden: You do not have permission to import execution results.";
                    extension_1.logger.error(importForbiddenMessage);
                    throw new Error(importForbiddenMessage);
                }
                case 404: {
                    const importNotFoundMessage = "Not Found: Project or test cycle not found.";
                    extension_1.logger.error(importNotFoundMessage);
                    throw new Error(importNotFoundMessage);
                }
                case 422: {
                    const importUnprocessableEntityMessage = "Unprocessable Entity: The server cannot process the request.";
                    extension_1.logger.error(importUnprocessableEntityMessage);
                    throw new Error(importUnprocessableEntityMessage);
                }
                default: {
                    const importUnexpectedErrorMessage = `Unexpected status code ${importJobIDResponse.status} received.`;
                    extension_1.logger.error(importUnexpectedErrorMessage);
                    throw new Error(importUnexpectedErrorMessage);
                }
            }
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                extension_1.logger.error("Axios error during import job ID retrieval:", error.message);
                if (error.response) {
                    extension_1.logger.error("Error response data:", error.response.data);
                }
            }
            else {
                extension_1.logger.error("Unexpected error during import job ID retrieval:", error);
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
    startKeepAlive() {
        this.stopKeepAlive(); // Prevent multiple intervals if previously started.
        this.keepAliveIntervalId = setInterval(() => {
            this.sendKeepAliveRequest();
        }, this.keepAliveIntervalInSeconds);
        // Send an immediate keep-alive request.
        this.sendKeepAliveRequest();
        extension_1.logger.trace("Keep-alive started.");
    }
    /** Stops the keep-alive process. */
    stopKeepAlive() {
        if (this.keepAliveIntervalId) {
            clearInterval(this.keepAliveIntervalId);
            this.keepAliveIntervalId = null;
            extension_1.logger.trace("Keep-alive stopped.");
        }
    }
    /**
     * Sends a GET request to the server to keep the session alive, which normally times out after 5 minutes.
     * The keep-alive process is started automatically when the PlayServerConnection object is created, and it runs every 4 minutes.
     * If the request fails, retries are attempted up to 3 times with a delay of 1 second between each attempt.
     * If the keep alive request fails, the user is logged out automatically, since the session will be timed out later anyway.
     */
    async sendKeepAliveRequest() {
        if (!this.sessionToken) {
            extension_1.logger.error("Session token is null. Cannot send keep-alive request.");
            return;
        }
        try {
            await withRetry(() => this.apiClient.get(`/login/session/v1`, {
                headers: { accept: "application/vnd.testbench+json" }
            }), 5, // maxRetries: try 5 additional times
            2000 // delayMs: wait 2000ms between attempts
            );
            extension_1.logger.trace("Keep-alive request sent.");
        }
        catch (error) {
            extension_1.logger.error("Keep-alive request failed after retries:", error);
            extension_1.logger.warn("Logging out the user after keep-alive failure.");
            await vscode.commands.executeCommand(`${constants_1.allExtensionCommands.logout}`);
        }
    }
}
exports.PlayServerConnection = PlayServerConnection;
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
async function withRetry(asyncFunction, maxRetries = 3, delayMs = 2000, shouldRetry, showProgressBar = true) {
    let attempt = 0;
    while (true) {
        try {
            // Attempt to execute the function.
            return await asyncFunction();
        }
        catch (error) {
            // Log the retry attempt and delay before retrying.
            extension_1.logger.warn(`Attempt ${attempt} failed. Retrying in ${delayMs}ms...`);
            // Check if we should not retry based on the error type/condition.
            if (shouldRetry && !shouldRetry(error)) {
                extension_1.logger.warn(`Error is not retryable. Aborting further retry attempts.`);
                throw error;
            }
            attempt++;
            if (attempt > maxRetries) {
                // If we've exceeded maxRetries, rethrow the error.
                extension_1.logger.error(`Attempt ${attempt} failed. Maximum retries reached, aborting further retries.`);
                throw error;
            }
            // Show the progress bar only if retries are happening and the flag is enabled.
            if (showProgressBar) {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Retrying request",
                    cancellable: false
                }, async (progress) => {
                    progress.report({ message: `Attempt ${attempt} of ${maxRetries}` });
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                });
            }
            else {
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
 * @param {string} promptMessage - The prompt message.
 * @param {boolean} inputCanBeEmpty - Whether the input may be empty.
 * @param {boolean }maskSensitiveInputData - Whether to mask the input (e.g. for passwords).
 * @param {(value: string) => string | null} validateInputFunction - Optional validation function; should return an error message if invalid.
 * @returns {Promise<string | null>} The user input as a string, or null if aborted.
 */
async function promptForInputAndValidate(promptMessage, inputCanBeEmpty = false, maskSensitiveInputData = false, validateInputFunction) {
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
async function performLogin(context, promptForNewCredentials = false, performAutoLoginWithStoredCredentialsWithoutPrompting) {
    // Loop until the user successfully logs in or cancels the login process
    while (true) {
        // Retrieve the stored credentials if they exist
        let password;
        // Only retrieve the password if the user has choosen to store it after successful login
        if ((0, extension_1.getConfig)().get("storePasswordAfterLogin", false)) {
            password = await context.secrets.get(constants_1.StorageKeys.PASSWORD);
        }
        // If the user has not chosen to store the password, clear it from the secret storage
        else {
            clearStoredCredentials(context);
        }
        const userHasStoredCredentials = !!((0, extension_1.getConfig)().get(constants_1.ConfigKeys.SERVER_NAME) &&
            (0, extension_1.getConfig)().get("username") &&
            password &&
            (0, extension_1.getConfig)().get("storePasswordAfterLogin", false));
        let useStoredCredentials = false;
        // If the user has stored credentials and can auto-login,
        // and the user has not chosen to prompt for new credentials,
        // and the user has not chosen to auto-login without prompting, then auto-login
        if (userHasStoredCredentials &&
            !promptForNewCredentials &&
            !performAutoLoginWithStoredCredentialsWithoutPrompting) {
            const choice = await vscode.window.showInformationMessage("Do you want to login using your previous credentials?", 
            // Modal dialog is used so that the input box wont disappear, which forces the user to choose an option. Without it, login may be locked.
            { modal: true }, "Yes", "No");
            if (choice === "Yes") {
                useStoredCredentials = true;
            }
            // User selected Cancel, which sets choice to undefined
            else if (!choice) {
                extension_1.logger.debug("Login process aborted.");
                return null;
            }
            // Continue the function in case of "No"
        }
        else {
            // Convert undefined value to false with !! if the optional parameter is not provided
            useStoredCredentials = !!performAutoLoginWithStoredCredentialsWithoutPrompting;
        }
        let serverName;
        let portNumber;
        let username;
        // If the user has stored credentials and wants to use them, retrieve them from the configuration, else prompt the user for new credentials
        if (useStoredCredentials) {
            serverName = (0, extension_1.getConfig)().get(constants_1.ConfigKeys.SERVER_NAME);
            portNumber = (0, extension_1.getConfig)().get("portNumber");
            username = (0, extension_1.getConfig)().get("username");
        }
        else {
            const credentials = await promptForLoginCredentials();
            if (!credentials) {
                vscode.window.showInformationMessage("Login process aborted.");
                extension_1.logger.debug("Login process aborted.");
                return null;
            }
            ({ serverName, portNumber, username, password } = credentials);
        }
        // Attempt to login
        const newConnection = await loginToNewPlayServerAndInitSessionToken(context, serverName, portNumber, username, password);
        if (newConnection) {
            return newConnection;
        }
        else {
            // Login may fail due to a server problem or incorrect credentials.
            const retry = await vscode.window.showInformationMessage("Login failed! Do you want to retry?", "Retry", "Cancel");
            if (retry !== "Retry") {
                vscode.window.showInformationMessage("Login process aborted.");
                extension_1.logger.debug("Login process aborted.");
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
async function promptForLoginCredentials() {
    const serverNameInConfig = (0, extension_1.getConfig)().get(constants_1.ConfigKeys.SERVER_NAME, "testbench");
    // Prompt user for server name, showing the default value only if it exists
    const serverNameInput = await promptForInputAndValidate(`Enter the server name${serverNameInConfig ? ` (Default: ${serverNameInConfig})` : ""}`, true);
    // If user cancels the input prompt, return null to cancel the login process
    if ((!serverNameInput && !serverNameInConfig) || serverNameInput === undefined) {
        extension_1.logger.trace("Login process aborted while entering server name.");
        return null;
    }
    // Use user input if provided, otherwise fallback to configuration value
    const serverName = serverNameInput || serverNameInConfig;
    // Get port number from configuration (default: 9445)
    const portInConfig = (0, extension_1.getConfig)().get("portNumber", 9445);
    // Prompt user for port number, only showing the default if it's configured
    const portInputAsString = await promptForInputAndValidate(`Enter the port number${portInConfig ? ` (Default: ${portInConfig})` : ""}`, true, false, (value) => (!/^\d+$/.test(value) ? "Port number must be a number" : null));
    if ((!portInputAsString && !portInConfig) || portInputAsString === undefined) {
        extension_1.logger.trace("Login process aborted while entering port number.");
        return null;
    }
    const portNumber = portInputAsString ? parseInt(portInputAsString, 10) : portInConfig;
    const serverVersionsResponse = await fetchServerVersions(serverName, portNumber);
    if (!serverVersionsResponse) {
        const serverVersionsErrorMessage = "Server not accessible with the provided server name and port.";
        extension_1.logger.error(serverVersionsErrorMessage);
        vscode.window.showErrorMessage(serverVersionsErrorMessage);
        return null;
    }
    const usernameInput = await promptForInputAndValidate(`Enter your login name (Default: ${(0, extension_1.getConfig)().get("username", "undefined")})`, true);
    if (!usernameInput) {
        extension_1.logger.trace("Login process aborted while entering username.");
        return null;
    }
    const username = usernameInput || (0, extension_1.getConfig)().get("username", "undefined");
    const password = await promptForInputAndValidate("Enter your password", false, true);
    if (!password) {
        extension_1.logger.trace("Login process aborted while entering password.");
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
async function loginToNewPlayServerAndInitSessionToken(context, serverName, portNumber, username, password) {
    const requestBody = {
        login: username,
        password: password,
        force: true
    };
    try {
        const connection = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Logging in",
            cancellable: true
        }, async (progress) => {
            const baseURL = `https://${serverName}:${portNumber}/api`;
            const loginURL = `${baseURL}/login/session/v1`;
            extension_1.logger.trace("Sending login request to:", loginURL);
            progress.report({ message: "Sending login request..." });
            const loginResponse = await withRetry(() => axios_1.default.post(loginURL, requestBody, {
                headers: {
                    accept: "application/vnd.testbench+json",
                    "Content-Type": "application/vnd.testbench+json"
                },
                httpsAgent: new https.Agent({ rejectUnauthorized: false })
            }), 3, // maxRetries
            2000, // delayMs
            (error) => {
                // Do not retry if the error is due to invalid credentials (HTTP 401)
                if (axios_1.default.isAxiosError(error) && error.response && error.response.status === 401) {
                    return false;
                }
                return true;
            });
            // An exception is thrown automatically if the status code is not 2xx
            if (loginResponse.status === 201) {
                // Store password in secret storage after succesfull login if the user chooses to
                if ((0, extension_1.getConfig)().get("storePasswordAfterLogin", false)) {
                    await context.secrets.store(constants_1.StorageKeys.PASSWORD, password);
                    extension_1.logger.trace("Password stored securely.");
                }
                else {
                    extension_1.logger.trace("User chose not to store password.");
                    // Clear the password from secret storage if it was previously stored
                    clearStoredCredentials(context);
                }
                // Starts keep alive in the constructor of PlayServerConnection
                const newConnection = new PlayServerConnection(serverName, portNumber, username, loginResponse.data.sessionToken);
                // Set the global connection object, it can be null in case the login fails
                (0, extension_1.setConnection)(newConnection);
                // Set the connectionActive context value for changing the login icon to logout icon based on this value
                await vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", true);
                const loginSuccessfulMessage = "Login successful.";
                await (0, server_1.initializeLanguageServer)();
                extension_1.logger.debug(loginSuccessfulMessage);
                vscode.window.showInformationMessage(loginSuccessfulMessage);
                // Upon successful login, update the login webview content and hide it.
                if (extension_1.loginWebViewProvider) {
                    extension_1.loginWebViewProvider.updateWebviewHTMLContent();
                }
                else {
                    extension_1.logger.error("loginWebViewProvider is null. Cannot update webview content.");
                }
                return newConnection;
            }
            else {
                const loginFailedMessage = "Login failed. Unexpected status code: " + loginResponse.status;
                extension_1.logger.error(loginFailedMessage);
                vscode.window.showInformationMessage(loginFailedMessage);
                return null;
            }
        });
        return connection;
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error) && error.response && error.response.status === 401) {
            extension_1.logger.error("Login failed: Invalid credentials.");
            vscode.window.showInformationMessage("Login failed: Invalid credentials.");
        }
        else {
            extension_1.logger.error("Error during login");
            vscode.window.showInformationMessage("Error during login.");
        }
        return null;
    }
}
/**
 * Clears stored user credentials from secret storage.
 *
 * @param {vscode.ExtensionContext} context - The extension context.
 */
async function clearStoredCredentials(context) {
    try {
        await context.secrets.delete(constants_1.StorageKeys.PASSWORD);
        extension_1.logger.debug("Credentials deleted from secret storage.");
    }
    catch (error) {
        extension_1.logger.error("Failed to clear credentials:", error);
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
async function fetchServerVersions(serverName, portNumber) {
    try {
        const baseURL = `https://${serverName}:${portNumber}`;
        const serverVersionsURL = `${baseURL}/api/serverVersions/v1`;
        extension_1.logger.debug("Fetching server versions from URL:", serverVersionsURL);
        const serverVersionsResponse = await withRetry(() => axios_1.default.get(serverVersionsURL, {
            headers: { Accept: "application/vnd.testbench+json" },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }) // TODO: set to true in production
        }), 3, // maxRetries: try 3 additional times
        2000, // delayMs: wait 2000ms between attempts
        // Retry only if the error is due to a non-transient condition
        (error) => {
            if (axios_1.default.isAxiosError(error) && error.response) {
                // Do not retry if a 404 is received
                const nonRetryableStatusCodes = [404];
                if (nonRetryableStatusCodes.includes(error.response.status)) {
                    return false;
                }
            }
            return true;
        });
        extension_1.logger.debug(`TestBench Release Version: ${serverVersionsResponse.data.releaseVersion}, ` +
            `Database Version: ${serverVersionsResponse.data.databaseVersion}, ` +
            `Revision: ${serverVersionsResponse.data.revision}`);
        return serverVersionsResponse.data;
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error)) {
            if (error.response) {
                extension_1.logger.error(`Error: Received status code ${error.response.status}`, error.response.data);
                if (error.response.status === 404) {
                    extension_1.logger.error(`TestBench version cannot be found at https://${serverName}:${portNumber}`);
                }
            }
            else if (error.request) {
                extension_1.logger.error("Error: No response received from server.", error.request);
            }
            else {
                extension_1.logger.error("Error:", error.message);
            }
        }
        else {
            extension_1.logger.error("Unexpected error:", error);
        }
        return null;
    }
}
/**
 * Opens a file dialog for selecting a zip file containing test results.
 *
 * @returns {Promise<string | null>} The selected zip file path or null if none selected.
 */
async function promptForReportZipFileWithResults() {
    try {
        const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            const workspaceLocationErrorMessage = "Workspace location could not be determined.";
            vscode.window.showErrorMessage(workspaceLocationErrorMessage);
            extension_1.logger.warn(workspaceLocationErrorMessage);
            return null;
        }
        const workingDirectoryPath = path_1.default.join(workspaceLocation, constants_1.folderNameOfInternalTestbenchFolder);
        const options = {
            defaultUri: vscode.Uri.file(workingDirectoryPath),
            openLabel: "Select Zip File with Test Results",
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            filters: { "Zip Files": ["zip"] }
        };
        const fileUri = await vscode.window.showOpenDialog(options);
        if (!fileUri || !fileUri[0]) {
            const noZipFileSelectedMessage = "No zip file selected. Please select a valid .zip file.";
            vscode.window.showErrorMessage(noZipFileSelectedMessage);
            extension_1.logger.debug(noZipFileSelectedMessage);
            return null;
        }
        const selectedFilePath = fileUri[0].fsPath;
        if (!selectedFilePath.endsWith(".zip")) {
            vscode.window.showErrorMessage("Selected file is not a .zip file. Please select a valid .zip file.");
            extension_1.logger.debug("Selected file is not a .zip file.");
            return null;
        }
        return selectedFilePath;
    }
    catch (error) {
        const zipSelectionErrorMessage = `An error occurred while selecting the report zip file: ${error.message}`;
        vscode.window.showErrorMessage(zipSelectionErrorMessage);
        extension_1.logger.error(zipSelectionErrorMessage);
        return null;
    }
}
// TODO: remove projectManagementTreeDataProvider when we replace local search with server project tree fetching and then searching
/**
 * Imports a report (zip file with test results) to the TestBench server.
 *
 * @param {PlayServerConnection} connection - The PlayServerConnection.
 * @param {string} projectKeyString - The project key string.
 * @param {string} cycleKeyString - The cycle key string.
 * @param {string} reportWithResultsZipFilePath - The file path of the zip file containing the test results to import.
 * @returns {Promise<void | null>} A promise that resolves when the import is complete, or null if an error occurs.
 */
async function importReportWithResultsToTestbench(connection, projectKeyString, // Now accepts projectKey
cycleKeyString, // Now accepts cycleKey
reportWithResultsZipFilePath) {
    try {
        extension_1.logger.debug("Importing report with results to TestBench server.");
        const { uniqueID } = await extractDataFromReport(reportWithResultsZipFilePath);
        if (!uniqueID) {
            const extractionErrorMsg = "Error extracting unique ID from the zip file.";
            vscode.window.showErrorMessage(extractionErrorMsg);
            extension_1.logger.error(extractionErrorMsg);
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
        const projectKey = Number(projectKeyString);
        const cycleKey = Number(cycleKeyString);
        if (isNaN(projectKey) || isNaN(cycleKey)) {
            extension_1.logger.error(`Invalid projectKey (${projectKeyString}) or cycleKey (${cycleKeyString}) provided for import.`);
            vscode.window.showErrorMessage("Internal error: Invalid project or cycle identifier for import.");
            return null;
        }
        const zipFilenameFromServer = await connection.importExecutionResultsAndReturnImportedFileName(projectKey, reportWithResultsZipFilePath);
        if (!zipFilenameFromServer) {
            const importErrorMessage = "Error importing the result file to the server.";
            extension_1.logger.error(importErrorMessage);
            vscode.window.showErrorMessage(importErrorMessage);
            return null;
        }
        // TODO: ignoreNonExecutedTestCases and checkPaths do not exists in feature branch
        // Import the results to TestBench server
        const importData = {
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
            extension_1.logger.debug("Starting import execution results.");
            const importJobID = await connection.getJobIDOfImportJob(projectKey, cycleKey, importData);
            // Poll the job status until it is completed
            const importJobStatus = await reportHandler.pollJobStatus(projectKeyString, importJobID, constants_1.JobTypes.IMPORT);
            // Check job completion status
            if (!importJobStatus || reportHandler.isImportJobFailed(importJobStatus)) {
                const importJobFailedMessage = "Import job could not be completed.";
                extension_1.logger.warn(importJobFailedMessage);
                vscode.window.showErrorMessage(importJobFailedMessage);
                return null;
            }
            else if (reportHandler.isImportJobCompletedSuccessfully(importJobStatus)) {
                vscode.window.showInformationMessage("Import completed successfully.");
            }
            else {
                extension_1.logger.warn("Import job finished polling but status is unknown.", importJobStatus);
                vscode.window.showWarningMessage("Import job status unknown after polling.");
            }
        }
        catch (error) {
            extension_1.logger.error(`Error during import job initiation or polling for Project ${projectKey}, Cycle ${cycleKey}:`, error.message);
            return null;
        }
    }
    catch (error) {
        extension_1.logger.error("Error importing report:", error.message);
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
async function selectReportWithResultsAndImportToTestbench(connection) {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Importing results to TestBench server`,
        cancellable: true
    }, async (progress) => {
        progress.report({ message: "Selecting report file with results.", increment: 30 });
        const resultZipFilePath = await promptForReportZipFileWithResults();
        if (!resultZipFilePath) {
            return null;
        }
        progress.report({ message: "Extracting report context...", increment: 10 });
        const { projectKey, cycleKey } = await extractDataFromReport(resultZipFilePath);
        // Validate extracted keys
        if (!projectKey || !cycleKey) {
            const missingDataContextMsg = "Could not extract necessary project or cycle key from the selected report file.";
            extension_1.logger.error(missingDataContextMsg);
            vscode.window.showErrorMessage(missingDataContextMsg);
            // Clean up the selected file if it exists and configured, even on error
            await reportHandler.cleanUpReportFileIfConfiguredInSettings(resultZipFilePath);
            return null;
        }
        progress.report({ message: "Importing report file.", increment: 30 });
        await importReportWithResultsToTestbench(connection, projectKey, cycleKey, resultZipFilePath);
        progress.report({ message: "Cleaning up.", increment: 30 });
        await reportHandler.cleanUpReportFileIfConfiguredInSettings(resultZipFilePath);
    });
}
/**
 * Extracts uniqueID, projectKey, and cycleName from a report zip file.
 *
 * @param {string} zipFilePath - The file path of the zip file.
 * @returns {Promise<ExtractedData>} An object containing uniqueID, projectKey, and cycleNameOfProject.
 */
async function extractDataFromReport(zipFilePath) {
    try {
        // Read zip file from disk
        const zipData = await fs.promises.readFile(path_1.default.resolve(zipFilePath));
        const zip = new jszip_1.default();
        // Load zip data
        const zipContents = await zip.loadAsync(zipData);
        // Define file names
        const cycleStructureFileName = "cycle_structure.json";
        const projectFileName = "project.json";
        // Extract JSON content
        const cycleStructureJson = await utils.extractAndParseJsonContent(zipContents, cycleStructureFileName);
        const projectJson = await utils.extractAndParseJsonContent(zipContents, projectFileName);
        // Parse JSON and extract required fields
        const uniqueID = cycleStructureJson?.root?.base?.uniqueID || null;
        const projectKey = projectJson?.key || null;
        const cycleNameOfProject = projectJson?.projectContext?.cycleName || null;
        const cycleKey = projectJson?.projectContext?.cycleKey || null;
        extension_1.logger.debug(`Extracted data from zip file "${zipFilePath}": uniqueID = ${uniqueID}, projectKey = ${projectKey}, cycleName = ${cycleNameOfProject}, cycleKey = ${cycleKey}` // Log cycleKey
        );
        return { uniqueID, projectKey, cycleNameOfProject, cycleKey };
    }
    catch (error) {
        extension_1.logger.error("Error extracting JSON data from zip file:", error);
        return { uniqueID: null, projectKey: null, cycleNameOfProject: null, cycleKey: null };
    }
}
//# sourceMappingURL=testBenchConnection.js.map