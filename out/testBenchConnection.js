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
exports.withRetry = withRetry;
exports.importReportWithResultsToTestbench = importReportWithResultsToTestbench;
exports.selectReportWithResultsAndImportToTestbench = selectReportWithResultsAndImportToTestbench;
exports.extractDataFromReport = extractDataFromReport;
exports.loginToServerAndGetSessionDetails = loginToServerAndGetSessionDetails;
const https = __importStar(require("https"));
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const reportHandler = __importStar(require("./reportHandler"));
const base64 = __importStar(require("base-64"));
const jszip_1 = __importDefault(require("jszip"));
const axios_1 = __importDefault(require("axios"));
const path_1 = __importDefault(require("path"));
const extension_1 = require("./extension");
const utils = __importStar(require("./utils"));
const constants_1 = require("./constants");
const testBenchTypes_1 = require("./testBenchTypes");
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
        extension_1.logger.trace(`[PlayServerConnection] Initializing for server: ${this.serverName}, port: ${this.portNumber}, username: ${this.username}`);
        this.apiClient = axios_1.default.create({
            baseURL: this.baseURL,
            headers: { Authorization: this.sessionToken },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false // TODO: Use true in production.
            })
        });
        if (this.sessionToken) {
            // Start the keep-alive process immediately to prevent session timeout after 5 minutes
            this.startKeepAlive();
        }
        else {
            extension_1.logger.warn("[PlayServerConnection] Initialized without a session token. Keep-alive not started.");
        }
    }
    /** Returns the server name. */
    getServerName() {
        return this.serverName;
    }
    /** Returns the server port. */
    getServerPort() {
        return this.portNumber.toString();
    }
    /** Returns the username. */
    getUsername() {
        return this.username;
    }
    /** Returns the base URL of the server. */
    getBaseURL() {
        return this.baseURL;
    }
    /** Returns the Axios API client. */
    getApiClient() {
        return this.apiClient;
    }
    /** Returns the current session token. */
    getSessionToken() {
        return this.sessionToken;
    }
    /**
     * Logs out the user from the TestBench server by invalidating the current session token.
     * This method now focuses on the server-side logout. UI and global state changes
     * should be handled by the AuthenticationProvider or session change listeners.
     * @returns {Promise<boolean>} True if server logout was successful or no action needed, false on API error.
     */
    async logoutUserOnServer() {
        extension_1.logger.debug(`[PlayServerConnection] Attempting to log out user ${this.username} from server ${this.serverName}.`);
        if (!this.sessionToken) {
            extension_1.logger.warn("[PlayServerConnection] No session token available. Cannot perform server-side logout.");
            this.stopKeepAlive();
            return true;
        }
        try {
            const logoutResponse = await withRetry(() => this.apiClient.delete(`/login/session/v1`, {
                headers: { accept: "application/vnd.testbench+json" }
            }), 3, 2000);
            if (logoutResponse.status === 204) {
                extension_1.logger.debug("[PlayServerConnection] Server logout successful (204).");
                // Clearing the global state and session token
                (0, extension_1.setConnection)(null);
                await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, false);
                this.sessionToken = "";
                (0, extension_1.getLoginWebViewProvider)()?.updateWebviewHTMLContent();
                return true;
            }
            else {
                extension_1.logger.error(`[PlayServerConnection] Server logout failed. Unexpected response status: ${logoutResponse.status}`);
                return false;
            }
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                extension_1.logger.error(`[PlayServerConnection] Error during server logout: ${error.response?.status} - ${error.response?.statusText}.`);
            }
            else {
                extension_1.logger.error(`[PlayServerConnection] Unexpected error during server logout: ${error}`);
            }
            return false;
        }
        finally {
            this.stopKeepAlive();
        }
    }
    /**
     * Fetches the list of projects from the TestBench server.
     *
     * @returns {Promise<testBenchTypes.Project[] | null>} The list of projects or null if an error occurs.
     */
    async getProjectsList() {
        if (!this.sessionToken || !this.apiClient) {
            extension_1.logger.error("Session token is null. Cannot fetch projects list.");
            return null;
        }
        try {
            extension_1.logger.debug("Fetching projects list.");
            const projectsURL = `/projects/v1`;
            const projectsResponse = await withRetry(() => this.apiClient.get(projectsURL, {
                headers: { accept: "application/vnd.testbench+json" }
            }), 3, // Try 3 additional times
            2000 // delayMs
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
            }), 3, // maxRetries
            2000 // delayMs
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
    // TODO: If this API call is implemented in the new play server, replace this method with the new API.
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
            const getTestElementsURL = `tovs/${tovKey}/testElements`;
            extension_1.logger.trace("Creating session for old play server with URL:", oldPlayServerBaseUrl);
            const userNameFromConfig = this.username;
            const encoded = base64.encode(`${userNameFromConfig}:${this.sessionToken}`);
            const oldPlayServerSession = axios_1.default.create({
                baseURL: oldPlayServerBaseUrl,
                // Old play server, which runs on port 9443, uses BasicAuth.
                // Use loginName as username, and use sessionToken as the password
                auth: {
                    username: this.username,
                    password: this.sessionToken
                },
                headers: {
                    Authorization: `Basic ${encoded}`,
                    "Content-Type": "application/vnd.testbench+json; charset=utf-8"
                },
                // Ignore self-signed certificates
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false //TODO: This should only be used in a development environment
                })
            });
            if (!oldPlayServerSession) {
                extension_1.logger.error("Failed to create session for old play server.");
                return null;
            }
            else {
                extension_1.logger.trace(`Old play server session created successfully.`);
            }
            extension_1.logger.trace(`Sending GET request to ${getTestElementsURL} for TOV key ${tovKey}`);
            const testElementsResponse = await withRetry(() => oldPlayServerSession.get(getTestElementsURL), 3, // maxRetries
            2000, // delayMs
            (error) => {
                if (axios_1.default.isAxiosError(error) && error.response) {
                    // Retry predicates
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
                // Note: The output of testElementsResponse is large
                // logger.trace("Fetched test elements data:", testElementsResponse.data);
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
    // TODO: If this API call is implemented in the new play server, replace this method with the new API.
    /**
     * Returns all filters that can be accessed by the connected user.
     */
    async getFiltersFromOldPlayServer() {
        extension_1.logger.debug("Fetching filters");
        if (!this.sessionToken) {
            extension_1.logger.error("Session token is null. Cannot fetch filters");
            return null;
        }
        try {
            const oldPlayServerPortNumber = 9443;
            const oldPlayServerBaseUrl = `https://${this.serverName}:${oldPlayServerPortNumber}/api/1`;
            const getFiltersURL = `${oldPlayServerBaseUrl}/filters`;
            extension_1.logger.trace("Creating session for old play server with URL:", oldPlayServerBaseUrl);
            const userNameFromConfig = this.username;
            const encoded = base64.encode(`${userNameFromConfig}:${this.sessionToken}`);
            const oldPlayServerSession = axios_1.default.create({
                baseURL: oldPlayServerBaseUrl,
                // Old play server, which runs on port 9443, uses BasicAuth.
                // Use loginName as username, and use sessionToken as the password
                auth: {
                    username: this.username,
                    password: this.sessionToken
                },
                headers: {
                    Authorization: `Basic ${encoded}`,
                    "Content-Type": "application/vnd.testbench+json; charset=utf-8"
                },
                // Ignore self-signed certificates
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false //TODO: This should only be used in a development environment
                })
            });
            if (!oldPlayServerSession) {
                extension_1.logger.error("Failed to create session for old play server.");
                return null;
            }
            else {
                extension_1.logger.trace(`Old play server session created successfully.`);
            }
            extension_1.logger.trace(`Sending GET request to ${getFiltersURL}`);
            const getFiltersResponse = await withRetry(() => oldPlayServerSession.get(getFiltersURL), 3, // maxRetries
            2000, // delayMs
            (error) => {
                if (axios_1.default.isAxiosError(error) && error.response) {
                    // Retry predicates
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
                utils.saveJsonDataToFile(filePath, getFiltersResponse.data);
                vscode.window.showInformationMessage(`Response saved to ${filePath}`);
            } else {
                vscode.window.showErrorMessage("No file path selected.");
            }
            */
            extension_1.logger.trace("Response status of get filters request:", getFiltersResponse.status);
            if (getFiltersResponse.data) {
                extension_1.logger.trace("Fetched filters data:", getFiltersResponse.data);
                return getFiltersResponse.data;
            }
            else {
                extension_1.logger.error("Filters data is null or undefined.");
                return null;
            }
        }
        catch (error) {
            extension_1.logger.error("Error fetching filters:", error);
            vscode.window.showErrorMessage("Error fetching filters. Please check the logs for details.");
            return null;
        }
    }
    /**
     * Sends a request to the TestBench server to package the Test Object Version (TOV) into a zip file.
     *
     * @param {string} projectKey - The project key as a string.
     * @param {string} tovKey - The Test Object Version key as a string.
     * @param {testBenchTypes.TovStructureOptions} tovStructureOptions - The TOV structure options.
     * @returns {Promise<string | null>} The job ID of the requested job.
     */
    async requestToPackageTovsInServerAndGetJobID(projectKey, tovKey, tovStructureOptions) {
        const tovReportUrl = `/projects/${projectKey}/tovs/${tovKey}/report/v1`;
        try {
            const tovReportJobResponse = await withRetry(() => this.apiClient.post(tovReportUrl, tovStructureOptions, {
                headers: {
                    accept: "application/json",
                    "Content-Type": "application/json"
                }
            }), 3, // maxRetries
            2000, // delayMs
            (error) => {
                if (axios_1.default.isAxiosError(error) && error.response) {
                    // Retry predicates - don't retry on client errors
                    const nonRetryableStatusCodes = [404, 422];
                    if (nonRetryableStatusCodes.includes(error.response.status)) {
                        return false;
                    }
                }
                return true;
            });
            extension_1.logger.trace(`TOV report job ID response for TOV key ${tovKey}:`, tovReportJobResponse.status);
            if (tovReportJobResponse.data.jobID) {
                extension_1.logger.trace(`Received TOV report Job ID for TOV key ${tovKey}:`, tovReportJobResponse.data);
                return tovReportJobResponse.data.jobID;
            }
            else {
                extension_1.logger.error(`Unexpected response code: ${tovReportJobResponse.status}`);
                return null;
            }
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error) && error.response) {
                switch (error.response.status) {
                    case 404:
                        extension_1.logger.error(`TOV report job ID fetch failed: Project (${projectKey}) or TOV (${tovKey}) not found.`);
                        break;
                    case 422:
                        extension_1.logger.error(`TOV report job ID fetch failed: Invalid tree root UID, filter, or test theme UID.`);
                        break;
                    default:
                        extension_1.logger.error(`TOV report job ID fetch failed with status ${error.response.status}:`, error.message);
                }
            }
            else {
                extension_1.logger.error("Error fetching TOV report job ID:", error);
            }
            return null;
        }
    }
    /**
     * Fetches the tests structure of a specific cycle within a project from the TestBench server.
     *
     * @param {string} projectKey - The project key as a string.
     * @param {string} cycleKey - The cycle key as a string.
     * @returns {Promise<testBenchTypes.TestStructure | null>} The test structure or null if an error occurs.
     */
    async fetchTestStructureOfCycleFromServer(projectKey, cycleKey) {
        const testStructureOfCycleUrl = `/projects/${projectKey}/cycles/${cycleKey}/structure/v1`;
        const requestBody = {
            executionMode: testBenchTypes_1.ExecutionMode.Execute,
            suppressFilteredData: false,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: []
        };
        try {
            const testStructureOfCycleResponse = await withRetry(() => this.apiClient.post(testStructureOfCycleUrl, requestBody, {
                headers: {
                    accept: "application/json",
                    "Content-Type": "application/json"
                }
            }), 3, // maxRetries
            2000, // delayMs
            (error) => {
                if (axios_1.default.isAxiosError(error) && error.response) {
                    // Retry predicates
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
            extension_1.logger.trace(`Test structure of cycle response for cycle key ${cycleKey}:`, testStructureOfCycleResponse.status);
            if (testStructureOfCycleResponse.data) {
                // Note: The output of cycleStructureResponse is large
                extension_1.logger.trace(`@@@@ Received cycle structure for cycle key ${cycleKey}:`, testStructureOfCycleResponse.data);
                return testStructureOfCycleResponse.data;
            }
            else {
                extension_1.logger.error(`Unexpected response code: ${testStructureOfCycleResponse.status}`);
                return null;
            }
        }
        catch (error) {
            extension_1.logger.error("Error fetching test structure for cycle:", error);
            return null;
        }
    }
    /**
     * Fetches the test structure of a specific TOV within a project from the TestBench server.
     *
     * @param {string} projectKey - The project key as a string.
     * @param {string} tovKey - The TOV key as a string.
     * @returns {Promise<testBenchTypes.TestStructure | null>} The cycle structure or null if an error occurs.
     */
    async fetchTestStructureOfTOVFromServer(projectKey, tovKey) {
        const testStructureOfTOVUrl = `/projects/${projectKey}/tovs/${tovKey}/structure/v1`;
        const requestBody = {
            executionMode: testBenchTypes_1.ExecutionMode.Execute,
            suppressFilteredData: false,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: []
        };
        try {
            const testStructureOfTOVResponse = await withRetry(() => this.apiClient.post(testStructureOfTOVUrl, requestBody, {
                headers: {
                    accept: "application/json",
                    "Content-Type": "application/json"
                }
            }), 3, // maxRetries
            2000, // delayMs
            (error) => {
                if (axios_1.default.isAxiosError(error) && error.response) {
                    // Retry predicates
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
            extension_1.logger.trace(`Test structure of TOV response for TOV key ${tovKey}:`, testStructureOfTOVResponse.status);
            if (testStructureOfTOVResponse.data) {
                // Note: The output is large
                extension_1.logger.trace(`!!!! Received test structure for TOV key ${tovKey}:`, testStructureOfTOVResponse.data);
                return testStructureOfTOVResponse.data;
            }
            else {
                extension_1.logger.error(`Unexpected response code: ${testStructureOfTOVResponse.status}`);
                return null;
            }
        }
        catch (error) {
            extension_1.logger.error("Error fetching test structure for TOV:", error);
            return null;
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
            }), 3, // maxRetries
            2000, // delayMs
            (error) => {
                // Retry predicates
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
            }), 3, // maxRetries
            2000, // delayMs
            (error) => {
                // Retry predicates
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
        this.stopKeepAlive();
        this.keepAliveIntervalId = setInterval(() => {
            this.sendKeepAliveRequest();
        }, this.keepAliveIntervalInSeconds);
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
        if (!this.sessionToken || !this.apiClient) {
            extension_1.logger.error("[PlayServerConnection] Session token or apiClient is null. Cannot send keep-alive request.");
            this.stopKeepAlive();
            return;
        }
        try {
            await withRetry(() => this.apiClient.get(`/login/session/v1`, {
                headers: { accept: "application/vnd.testbench+json" }
            }), 5, // maxRetries
            2000 // delayMs
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
 * @param {number} maxAllowedRetryCount - Maximum number of retry attempts (default is 3).
 * @param {number} delayMs - Delay in milliseconds between retries (default is 1000ms).
 * @param {boolean} shouldRetry - Optional predicate function that receives the error and returns whether to retry.
 * @param {boolean} showProgressBar - Optional flag to control whether to show a VS Code progress bar (default is false).
 * @returns {Promise<T>} A promise resolving to the function's return value.
 * @throws The error from the last failed attempt if all retries fail.
 */
async function withRetry(asyncFunction, maxAllowedRetryCount = 3, delayMs = 2000, shouldRetry, showProgressBar = true) {
    let retryCount = 0;
    while (true) {
        try {
            return await asyncFunction();
        }
        catch (error) {
            extension_1.logger.warn(`Attempt ${retryCount} failed. Retrying in ${delayMs}ms...`);
            if (shouldRetry && !shouldRetry(error)) {
                extension_1.logger.warn(`Error is not retryable. Aborting further retry attempts.`);
                throw error;
            }
            retryCount++;
            if (retryCount > maxAllowedRetryCount) {
                extension_1.logger.error(`Attempt ${retryCount} failed. Maximum retries reached, aborting further retries.`);
                throw error;
            }
            // Show the progress bar only if retries are happening and the flag is enabled.
            if (showProgressBar) {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Retrying request",
                    cancellable: false
                }, async (progress) => {
                    progress.report({ message: `Attempt ${retryCount} of ${maxAllowedRetryCount}` });
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                });
            }
            else {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
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
/**
 * Imports a report (zip file with test results) to the TestBench server.
 *
 * @param {PlayServerConnection} connection - The PlayServerConnection.
 * @param {string} projectKeyString - The project key string.
 * @param {string} cycleKeyString - The cycle key string.
 * @param {string} reportWithResultsZipFilePath - The file path of the zip file containing the test results to import.
 * @returns {Promise<void | null>} A promise that resolves when the import is complete, or null if an error occurs.
 */
async function importReportWithResultsToTestbench(connection, projectKeyString, cycleKeyString, reportWithResultsZipFilePath) {
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
        // For debugging, save the tree items to a file called allTreeElements.json
        const allTreeElementsPath = path.join(__dirname, "allTreeElements.json");
        utils.saveJsonDataToFile(allTreeElementsPath, allTreeElementsInTreeView);
        console.log(`allTreeElements saved to ${allTreeElementsPath}`);
        */
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
        const importData = {
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
            extension_1.logger.debug("Starting import execution results.");
            const importJobID = await connection.getJobIDOfImportJob(projectKey, cycleKey, importData);
            const importJobStatus = await reportHandler.pollJobStatus(projectKeyString, importJobID, constants_1.JobTypes.IMPORT);
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
        if (!projectKey || !cycleKey) {
            const missingDataContextMsg = "Could not extract necessary project or cycle key from the selected report file.";
            extension_1.logger.error(missingDataContextMsg);
            vscode.window.showErrorMessage(missingDataContextMsg);
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
        const zipData = await fs.promises.readFile(path_1.default.resolve(zipFilePath));
        const zip = new jszip_1.default();
        const zipContents = await zip.loadAsync(zipData);
        const cycleStructureFileName = "cycle_structure.json";
        const projectFileName = "project.json";
        const cycleStructureJson = await utils.extractAndParseJsonContent(zipContents, cycleStructureFileName);
        const projectJson = await utils.extractAndParseJsonContent(zipContents, projectFileName);
        const uniqueID = cycleStructureJson?.root?.base?.uniqueID || null;
        const projectKey = projectJson?.key || null;
        const cycleNameOfProject = projectJson?.projectContext?.cycleName || null;
        const cycleKey = projectJson?.projectContext?.cycleKey || null;
        extension_1.logger.debug(`Extracted data from zip file "${zipFilePath}": uniqueID = ${uniqueID}, projectKey = ${projectKey}, cycleName = ${cycleNameOfProject}, cycleKey = ${cycleKey}`);
        return { uniqueID, projectKey, cycleNameOfProject, cycleKey };
    }
    catch (error) {
        extension_1.logger.error("Error extracting JSON data from zip file:", error);
        return { uniqueID: null, projectKey: null, cycleNameOfProject: null, cycleKey: null };
    }
}
/**
 * Logs in to the TestBench server with the provided credentials and returns session details.
 * This function focuses on the API interaction and does not handle UI or global state.
 *
 * @param {string} serverName The server hostname or IP.
 * @param {number} portNumber The server port.
 * @param {string} username The TestBench username.
 * @param {string} password The TestBench password.
 * @returns {Promise<TestBenchLoginResult | null>} A promise resolving to TestBenchLoginResult if successful, otherwise null.
 */
async function loginToServerAndGetSessionDetails(serverName, portNumber, username, password) {
    const requestBody = {
        login: username,
        password: password,
        force: true
    };
    const baseURL = `https://${serverName}:${portNumber}/api`;
    const loginURL = `${baseURL}/login/session/v1`;
    extension_1.logger.trace(`[Connection] Sending login request to: ${loginURL} for user ${username}`);
    try {
        const loginResponse = await withRetry(() => axios_1.default.post(loginURL, requestBody, {
            headers: {
                accept: "application/vnd.testbench+json",
                "Content-Type": "application/vnd.testbench+json"
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }) // TODO: Review for production
        }), 3, // maxRetries
        2000, // delayMs
        (error) => {
            // shouldRetry predicate
            if (axios_1.default.isAxiosError(error) && error.response && error.response.status === 401) {
                extension_1.logger.warn("[Connection] Login attempt failed with 401 (Invalid Credentials). Not retrying.");
                return false;
            }
            return true;
        });
        if (loginResponse.status === 201 && loginResponse.data && loginResponse.data.sessionToken) {
            extension_1.logger.info(`[Connection] Login successful for user ${username} on ${serverName}.`);
            return {
                sessionToken: loginResponse.data.sessionToken,
                userKey: loginResponse.data.userKey,
                loginName: loginResponse.data.login
            };
        }
        else {
            extension_1.logger.error(`[Connection] Login failed for ${username}. Unexpected status code: ${loginResponse.status}, Data: ${JSON.stringify(loginResponse.data)}`);
            return null;
        }
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error) && error.response && error.response.status === 401) {
            extension_1.logger.error(`[Connection] Login failed for ${username} to ${serverName}: Invalid credentials.`);
        }
        else {
            extension_1.logger.error(`[Connection] Error during login for ${username} to ${serverName}:`, error.message);
        }
        return null;
    }
}
//# sourceMappingURL=testBenchConnection.js.map