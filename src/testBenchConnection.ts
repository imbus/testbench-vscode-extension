/**
 * @file src/testBenchConnection.ts
 * @description Handles connection and communication with the TestBench server.
 */

import * as https from "https";
import * as tls from "tls";
import * as vscode from "vscode";
import * as fs from "fs";

import * as testBenchTypes from "./testBenchTypes";
import * as reportHandler from "./reportHandler";
import * as base64 from "base-64";
import JSZip from "jszip";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import path from "path";
import { getLoginWebViewProvider, logger, setConnection } from "./extension";
import * as utils from "./utils";
import {
    ContextKeys,
    JobTypes,
    allExtensionCommands,
    folderNameOfInternalTestbenchFolder,
    ConfigKeys
} from "./constants";
import { ExecutionMode } from "./testBenchTypes";
import { getExtensionSetting } from "./configuration";

let agentForNextConnection: https.Agent | null = null;

/**
 * Manages TLS security state globally for the extension.
 * Provides a centralized way to handle secure vs insecure connections
 */
export class TLSSecurityManager {
    private static instance: TLSSecurityManager;
    private isInsecureMode: boolean = false;
    private originalNODE_TLS_REJECT_UNAUTHORIZED: string | undefined;

    private constructor() {
        this.originalNODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    }

    public static getInstance(): TLSSecurityManager {
        if (!TLSSecurityManager.instance) {
            TLSSecurityManager.instance = new TLSSecurityManager();
        }
        return TLSSecurityManager.instance;
    }

    /**
     * Enables insecure mode globally for the extension.
     * This should only be called when the user explicitly chooses to proceed with insecure connections.
     */
    public enableInsecureMode(): void {
        if (!this.isInsecureMode) {
            logger.warn("[TLSSecurityManager] Enabling insecure TLS mode globally");
            this.isInsecureMode = true;
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        }
    }

    /**
     * Disables insecure mode and restores original TLS settings.
     * This should be called when logging out or when a new secure login is attempted.
     */
    public disableInsecureMode(): void {
        if (this.isInsecureMode) {
            logger.info("[TLSSecurityManager] Disabling insecure TLS mode and restoring original settings");
            this.isInsecureMode = false;
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = this.originalNODE_TLS_REJECT_UNAUTHORIZED;
        }
    }

    /**
     * Checks if the extension is currently in insecure mode.
     * @returns {boolean} True if insecure mode is enabled, false otherwise.
     */
    public isInInsecureMode(): boolean {
        return this.isInsecureMode;
    }

    /**
     * Resets the security manager to its initial state.
     * This should be called when the extension is deactivated or when a new session starts.
     */
    public reset(): void {
        this.disableInsecureMode();
        this.originalNODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    }

    /**
     * Gets the current TLS security status for debugging purposes.
     * @returns {string} A string describing the current TLS security state.
     */
    public getTLSSecurityManagerStatus(): string {
        return `TLS Security Manager: ${this.isInsecureMode ? "INSECURE" : "SECURE"} mode, NODE_TLS_REJECT_UNAUTHORIZED=${process.env.NODE_TLS_REJECT_UNAUTHORIZED}`;
    }
}

export interface TestBenchLoginResult {
    sessionToken: string;
    userKey: string; // From LoginResponse
    loginName: string;
}

/**
 * Creates a secure HTTPS agent that trusts default system CAs and optionally a custom bundled CA.
 * Falls back to using only default CAs if the custom certificate file is not found.
 * @returns {Promise<https.Agent>} A configured https.Agent.
 */
async function createSecureHttpsAgent(): Promise<https.Agent> {
    try {
        const defaultCAs = tls.rootCertificates.map((cert) => Buffer.from(cert));
        const certificatePathSetting = getExtensionSetting<string>(ConfigKeys.CERTIFICATE_PATH);
        if (!certificatePathSetting) {
            logger.debug("[testBenchConnection] No certificate path configured. Using default system CAs only.");
            return new https.Agent({ ca: defaultCAs });
        }

        const absoluteCertPath = await utils.constructAbsolutePathFromRelativePath(certificatePathSetting, true);
        if (!absoluteCertPath) {
            logger.debug(
                `[testBenchConnection] Certificate path "${certificatePathSetting}" could not be resolved or file does not exist. Falling back to default system CAs.`
            );
            return new https.Agent({ ca: defaultCAs });
        }

        const customCA = fs.readFileSync(absoluteCertPath);
        const combinedCAs = [...defaultCAs, customCA];

        logger.debug("[testBenchConnection] Using combined CAs (default system CAs + custom CA).");
        return new https.Agent({
            ca: combinedCAs
        });
    } catch (error) {
        logger.warn(
            "[testBenchConnection] Failed to read custom certificate file. Falling back to default system CAs.",
            error
        );
        return new https.Agent();
    }
}

/**
 * Represents a connection to the TestBench Play server.
 * Handles communication with the server, including login, logout, and API requests.
 */
export class PlayServerConnection {
    private baseURL: string;
    private apiClient!: AxiosInstance;
    private readonly keepAliveIntervalInSeconds: number = 4 * 60 * 1000; // 4 minutes
    private keepAliveIntervalId: NodeJS.Timeout | null = null;

    /**
     * Creates a new PlayServerConnection.
     *
     * @param {string} serverName - The name of the server.
     * @param {number} portNumber - The port number of the server.
     * @param {string} username - The username for authentication.
     * @param {string} sessionToken - The session token for authentication.
     * @param {vscode.ExtensionContext} context - The extension context for path resolution.
     */
    constructor(
        public serverName: string,
        public portNumber: number,
        public username: string,
        private sessionToken: string,
        private context: vscode.ExtensionContext
    ) {
        this.baseURL = `https://${this.serverName}:${this.portNumber}/api`;
        logger.trace(
            `[testBenchConnection] Initializing server connection for server name: ${this.serverName}, port: ${this.portNumber}, username: ${this.username}`
        );
    }

    /**
     * Initializes the connection asynchronously, setting up the HTTPS agent and API client.
     */
    async initialize(): Promise<void> {
        let agentToUse: https.Agent;
        if (agentForNextConnection) {
            logger.debug("[testBenchConnection] Using pre-configured agent for the new session.");
            agentToUse = agentForNextConnection;
            agentForNextConnection = null;

            if (agentToUse.options && agentToUse.options.rejectUnauthorized === false) {
                logger.debug("[testBenchConnection] Using insecure agent for this session.");
            }
        } else {
            logger.warn("[testBenchConnection] No pre-configured agent found. Defaulting to a new secure agent.");
            agentToUse = await createSecureHttpsAgent();
        }
        this.apiClient = axios.create({
            baseURL: this.baseURL,
            headers: { Authorization: this.sessionToken },
            httpsAgent: agentToUse
        });

        if (this.sessionToken) {
            // Start the keep-alive process immediately to prevent session timeout after 5 minutes
            this.startKeepAlive();
        } else {
            logger.warn("[testBenchConnection] Initialized without a session token. Keep-alive not started.");
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

    /** Returns the username. */
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

    /** Returns the current session token. */
    public getSessionToken(): string {
        return this.sessionToken;
    }

    /**
     * Creates a retry predicate that handles certificate errors appropriately based on the agent type.
     * @returns A function that determines whether to retry based on the error.
     */
    private createRetryPredicate(): (error: any) => boolean {
        const isInsecureAgent =
            this.apiClient.defaults.httpsAgent &&
            (this.apiClient.defaults.httpsAgent as any).options &&
            (this.apiClient.defaults.httpsAgent as any).options.rejectUnauthorized === false;

        return (error: any): boolean => {
            if (axios.isAxiosError(error) && error.response && error.response.status === 401) {
                return false;
            }

            if (isInsecureAgent) {
                return true;
            }

            const certErrorCodes = ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_UNTRUSTED", "DEPTH_ZERO_SELF_SIGNED_CERT"];
            if (axios.isAxiosError(error) && certErrorCodes.includes(error.code || "")) {
                return false;
            }
            return true;
        };
    }

    /**
     * Logs out the user from the TestBench server by invalidating the current session token.
     * This method now focuses on the server-side logout. UI and global state changes
     * should be handled by the AuthenticationProvider or session change listeners.
     * @returns {Promise<boolean>} True if server logout was successful or no action needed, false on API error.
     */
    async logoutUserOnServer(): Promise<boolean> {
        logger.debug(
            `[testBenchConnection] Attempting to log out user ${this.username} from server ${this.serverName}.`
        );
        if (!this.sessionToken) {
            logger.warn("[testBenchConnection] No session token available. Cannot perform server-side logout.");
            this.stopKeepAlive();
            return true;
        }

        try {
            const logoutResponse: AxiosResponse = await withRetry(
                () =>
                    this.apiClient.delete(`/login/session/v1`, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                3,
                2000,
                this.createRetryPredicate()
            );

            if (logoutResponse.status === 204) {
                logger.debug("[testBenchConnection] Server logout successful.");
                const tlsManager = TLSSecurityManager.getInstance();
                tlsManager.disableInsecureMode();

                setConnection(null);
                await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
                this.sessionToken = "";
                getLoginWebViewProvider()?.updateWebviewHTMLContent();

                return true;
            } else {
                logger.error(`[testBenchConnection] Server logout failed. Response status: ${logoutResponse.status}`);
                return false;
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error(
                    `[testBenchConnection] Error during server logout: ${error.response?.status} - ${error.response?.statusText}.`
                );
            } else {
                logger.error(`[testBenchConnection] Unexpected error during server logout: ${error}`);
            }
            return false;
        } finally {
            this.stopKeepAlive();
        }
    }

    /**
     * Fetches the list of projects from the TestBench server.
     *
     * @returns {Promise<testBenchTypes.Project[] | null>} The list of projects or null if an error occurs.
     */
    async getProjectsList(): Promise<testBenchTypes.Project[] | null> {
        if (!this.sessionToken || !this.apiClient) {
            logger.error("[testBenchConnection] Session token is null. Cannot fetch projects list.");
            return null;
        }
        try {
            const projectsURL: string = `/projects/v1`;
            logger.debug(`[testBenchConnection] Fetching projects list using URL: ${projectsURL}`);
            const projectsResponse: AxiosResponse<testBenchTypes.Project[]> = await withRetry(
                () =>
                    this.apiClient.get(projectsURL, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                3, // Try 3 additional times
                2000, // delayMs
                this.createRetryPredicate()
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

            logger.debug(
                `[testBenchConnection] Response status of project list request for URL ${projectsURL}: ${projectsResponse.status}`
            );
            if (projectsResponse.data) {
                logger.trace(
                    `[testBenchConnection] Fetched project list for request ${projectsURL}:`,
                    projectsResponse.data
                );
                return projectsResponse.data;
            } else {
                logger.error("[testBenchConnection] Project list data is not available.");
                return null;
            }
        } catch (error) {
            // Axios throws an error automatically if the response status is not 2xx
            logger.error("[testBenchConnection] Error fetching projects:", error);
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
        if (!this.sessionToken) {
            logger.error(
                `[testBenchConnection] Session token is null. Cannot fetch project tree for project key: ${projectKey}`
            );
            return null;
        }
        if (!projectKey) {
            logger.error("[testBenchConnection] Project key is missing. Cannot fetch project tree.");
            return null;
        }
        try {
            const projectTreeURL: string = `/projects/${projectKey}/tree/v1`;
            logger.debug(
                `[testBenchConnection] Fetching project tree for project key ${projectKey} using URL ${projectTreeURL}`
            );
            const projectTreeResponse: AxiosResponse<testBenchTypes.TreeNode> = await withRetry(
                () =>
                    this.apiClient.get(projectTreeURL, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                3, // maxRetries
                2000, // delayMs
                this.createRetryPredicate()
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

            logger.debug(
                `[testBenchConnection] Response status of project tree request for URL ${projectTreeURL}: ${projectTreeResponse.status}`
            );
            if (projectTreeResponse.data) {
                logger.trace(
                    `[testBenchConnection] Fetched project tree for request ${projectTreeURL}:`,
                    projectTreeResponse.data
                );
                return projectTreeResponse.data;
            } else {
                logger.error("[testBenchConnection] Project tree data is not available.");
                return null;
            }
        } catch (error) {
            logger.error(`[testBenchConnection] Error fetching project tree: ${error}`);
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
        if (!this.sessionToken) {
            logger.error(
                `[testBenchConnection] Session token is null. Cannot fetch test elements for TOV key: ${tovKey}`
            );
            return null;
        }
        if (!tovKey) {
            logger.error(`[testBenchConnection] TOV key is missing. Cannot fetch test elements.`);
            return null;
        }

        try {
            const oldPlayServerPortNumber: number = 9443;
            const oldPlayServerBaseUrl: string = `https://${this.serverName}:${oldPlayServerPortNumber}/api/1`;
            const getTestElementsURL: string = `tovs/${tovKey}/testElements`;

            const userNameFromConfig: string = this.username;
            const encoded = base64.encode(`${userNameFromConfig}:${this.sessionToken}`);

            logger.debug(
                `[testBenchConnection] Creating session for old play server with URL ${oldPlayServerBaseUrl} to fetch test elements for TOV key ${tovKey}`
            );
            const oldPlayServerSession: axios.AxiosInstance = axios.create({
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
                httpsAgent: this.apiClient.defaults.httpsAgent
            });

            if (!oldPlayServerSession) {
                logger.error(
                    `[testBenchConnection] Failed to create session for old play server with URL ${oldPlayServerBaseUrl} while fetching test elements for TOV key ${tovKey}`
                );
                return null;
            }

            logger.debug(
                `[testBenchConnection] Fetching test elements for TOV key ${tovKey} from ${getTestElementsURL}`
            );
            const testElementsResponse: AxiosResponse = await withRetry(
                () => oldPlayServerSession.get(getTestElementsURL),
                3, // maxRetries
                2000, // delayMs
                (error) => {
                    if (axios.isAxiosError(error) && error.response) {
                        // Retry predicates
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

            logger.debug(
                `[testBenchConnection] Response status of GET test elements request for URL ${getTestElementsURL}: ${testElementsResponse.status}`
            );
            if (testElementsResponse.data) {
                // Note: The output of testElementsResponse is large
                logger.trace(
                    `[testBenchConnection] Fetched test elements data from URL ${getTestElementsURL}:`,
                    testElementsResponse.data
                );
                return testElementsResponse.data;
            } else {
                logger.error(
                    `[testBenchConnection] Test elements data is not available from URL ${getTestElementsURL}.`
                );
                return null;
            }
        } catch (error) {
            logger.error(`[testBenchConnection] Error fetching test elements for TOV key ${tovKey}: ${error}`);
            vscode.window.showErrorMessage("Error fetching test elements. Please check the logs for details.");
            return null;
        }
    }

    // TODO: If this API call is implemented in the new play server, replace this method with the new API.
    /**
     * Returns all filters that can be accessed by the connected user.
     */
    async getFiltersFromOldPlayServer(): Promise<any | null> {
        if (!this.sessionToken) {
            logger.error("[testBenchConnection] Session token is null. Cannot fetch filters");
            return null;
        }

        try {
            const oldPlayServerPortNumber: number = 9443;
            const oldPlayServerBaseUrl: string = `https://${this.serverName}:${oldPlayServerPortNumber}/api/1`;
            const getFiltersURL: string = `${oldPlayServerBaseUrl}/filters`;

            logger.debug(
                `[testBenchConnection] Creating session for old play server with URL ${oldPlayServerBaseUrl} to fetch filters`
            );

            const userNameFromConfig: string = this.username;
            const encoded = base64.encode(`${userNameFromConfig}:${this.sessionToken}`);
            const oldPlayServerSession: axios.AxiosInstance = axios.create({
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
                httpsAgent: this.apiClient.defaults.httpsAgent
            });

            if (!oldPlayServerSession) {
                logger.error(
                    `[testBenchConnection] Failed to create session for old play server with URL ${oldPlayServerBaseUrl} while fetching filters`
                );
                return null;
            }

            logger.debug(`[testBenchConnection] Fetching filters from URL ${getFiltersURL}`);
            const getFiltersResponse: AxiosResponse = await withRetry(
                () => oldPlayServerSession.get(getFiltersURL),
                3, // maxRetries
                2000, // delayMs
                (error) => {
                    if (axios.isAxiosError(error) && error.response) {
                        // Retry predicates
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
                utils.saveJsonDataToFile(filePath, getFiltersResponse.data);
                vscode.window.showInformationMessage(`Response saved to ${filePath}`);
            } else {
                vscode.window.showErrorMessage("No file path selected.");
            }
            */

            logger.debug(
                `[testBenchConnection] Response status of get filters request for URL ${getFiltersURL}: ${getFiltersResponse.status}`
            );
            if (getFiltersResponse.data) {
                logger.trace(
                    `[testBenchConnection] Fetched filters data for request ${getFiltersURL}:`,
                    getFiltersResponse.data
                );
                return getFiltersResponse.data;
            } else {
                logger.error(`[testBenchConnection] Filters data is not available from URL ${getFiltersURL}.`);
                return null;
            }
        } catch (error) {
            logger.error(`[testBenchConnection] Error fetching filters: ${error}`);
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
    async requestToPackageTovsInServerAndGetJobID(
        projectKey: string,
        tovKey: string,
        tovStructureOptions: testBenchTypes.TovStructureOptions
    ): Promise<string | null> {
        const tovReportUrl: string = `/projects/${projectKey}/tovs/${tovKey}/report/v1`;

        logger.debug(
            `[testBenchConnection] Requesting TOV report job ID using URL ${tovReportUrl} and options: ${JSON.stringify(tovStructureOptions)}`
        );

        try {
            const tovReportJobResponse: AxiosResponse<testBenchTypes.JobIdResponse> = await withRetry(
                () =>
                    this.apiClient.post(tovReportUrl, tovStructureOptions, {
                        headers: {
                            accept: "application/json",
                            "Content-Type": "application/json"
                        }
                    }),
                3, // maxRetries
                2000, // delayMs
                (error) => {
                    if (axios.isAxiosError(error) && error.response) {
                        // Retry predicates - don't retry on client errors
                        const nonRetryableStatusCodes = [404, 422];
                        if (nonRetryableStatusCodes.includes(error.response.status)) {
                            return false;
                        }
                    }
                    return true;
                }
            );

            logger.debug(
                `[testBenchConnection] Response status of TOV report job ID request for URL ${tovReportUrl}:`,
                tovReportJobResponse.status
            );
            if (tovReportJobResponse.data.jobID) {
                logger.trace(
                    `[testBenchConnection] Received TOV report Job ID for URL ${tovReportUrl}:`,
                    tovReportJobResponse.data
                );
                return tovReportJobResponse.data.jobID;
            } else {
                logger.error(
                    `[testBenchConnection] Unexpected response code when fetching TOV report job ID: ${tovReportJobResponse.status}`
                );
                return null;
            }
        } catch (error) {
            if (axios.isAxiosError(error) && error.response) {
                switch (error.response.status) {
                    case 404:
                        logger.error(
                            `[testBenchConnection] TOV report job ID fetch failed: Project (${projectKey}) or TOV (${tovKey}) not found.`
                        );
                        break;
                    case 422:
                        logger.error(
                            `[testBenchConnection] TOV report job ID fetch failed: Invalid tree root UID, filter, or test theme UID.`
                        );
                        break;
                    default:
                        logger.error(
                            `[testBenchConnection] TOV report job ID fetch failed with status ${error.response.status}:`,
                            error.message
                        );
                }
            } else {
                logger.error(`[testBenchConnection] Error fetching TOV report job ID: ${error}`);
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
    async fetchTestStructureOfCycleFromServer(
        projectKey: string,
        cycleKey: string
    ): Promise<testBenchTypes.TestStructure | null> {
        const testStructureOfCycleUrl = `/projects/${projectKey}/cycles/${cycleKey}/structure/v1`;
        const requestBody: testBenchTypes.OptionalJobIDRequestParameter = {
            executionMode: ExecutionMode.Execute,
            suppressFilteredData: false,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: []
        };

        logger.debug(
            `[testBenchConnection] Fetching cycle structure from URL ${testStructureOfCycleUrl} and request body:`,
            requestBody
        );

        try {
            const testStructureOfCycleResponse: AxiosResponse<testBenchTypes.TestStructure> = await withRetry(
                () =>
                    this.apiClient.post(testStructureOfCycleUrl, requestBody, {
                        headers: {
                            accept: "application/json",
                            "Content-Type": "application/json"
                        }
                    }),
                3, // maxRetries
                2000, // delayMs
                (error) => {
                    if (axios.isAxiosError(error) && error.response) {
                        // Retry predicates
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

            logger.debug(
                `[testBenchConnection] Response status of test structure of cycle request for URL ${testStructureOfCycleUrl}:`,
                testStructureOfCycleResponse.status
            );
            if (testStructureOfCycleResponse.data) {
                // Note: The output of cycleStructureResponse is large
                logger.trace(
                    `[testBenchConnection] Received cycle structure for cycle key ${cycleKey}:`,
                    testStructureOfCycleResponse.data
                );
                return testStructureOfCycleResponse.data;
            } else {
                logger.error(
                    `[testBenchConnection] Unexpected response code when fetching cycle structure for ${testStructureOfCycleUrl}: ${testStructureOfCycleResponse.status}`
                );
                return null;
            }
        } catch (error) {
            logger.error(
                `[testBenchConnection] Error fetching test structure for cycle using ${testStructureOfCycleUrl}:`,
                error
            );
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
    async fetchTestStructureOfTOVFromServer(
        projectKey: string,
        tovKey: string
    ): Promise<testBenchTypes.TestStructure | null> {
        const testStructureOfTOVUrl = `/projects/${projectKey}/tovs/${tovKey}/structure/v1`;
        const requestBody: testBenchTypes.OptionalJobIDRequestParameter = {
            executionMode: ExecutionMode.Execute,
            suppressFilteredData: false,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: []
        };

        logger.debug(
            `[testBenchConnection] Fetching test structure of TOV from URL ${testStructureOfTOVUrl} and request body:`,
            requestBody
        );

        try {
            const testStructureOfTOVResponse: AxiosResponse<testBenchTypes.TestStructure> = await withRetry(
                () =>
                    this.apiClient.post(testStructureOfTOVUrl, requestBody, {
                        headers: {
                            accept: "application/json",
                            "Content-Type": "application/json"
                        }
                    }),
                3, // maxRetries
                2000, // delayMs
                (error) => {
                    if (axios.isAxiosError(error) && error.response) {
                        // Retry predicates
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

            logger.debug(
                `[testBenchConnection] Received test structure of TOV response status for URL ${testStructureOfTOVUrl}:`,
                testStructureOfTOVResponse.status
            );
            if (testStructureOfTOVResponse.data) {
                // Note: The output is large
                logger.trace(
                    `[testBenchConnection] Received test structure from URL ${testStructureOfTOVUrl}:`,
                    testStructureOfTOVResponse.data
                );
                return testStructureOfTOVResponse.data;
            } else {
                logger.error(
                    `[testBenchConnection] Unexpected response code when fetching test structure for TOV using URL ${testStructureOfTOVUrl}: ${testStructureOfTOVResponse.status}`
                );
                return null;
            }
        } catch (error) {
            logger.error(
                `[testBenchConnection] Error fetching test structure for TOV using URL ${testStructureOfTOVUrl}:`,
                error
            );
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
    public async importExecutionResultsAndReturnImportedFileName(
        projectKey: number,
        zipFilePath: string
    ): Promise<string> {
        const importResultZipURL: string = `/projects/${projectKey}/executionResults/v1`;

        try {
            const zipFileData: Buffer = fs.readFileSync(zipFilePath);
            logger.debug(`[testBenchConnection] Importing zip file "${zipFilePath}" using URL ${importResultZipURL}`);
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
                3, // maxRetries
                2000, // delayMs
                (error) => {
                    // Retry predicates
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
                    logger.debug(`[testBenchConnection] Report "${zipFilePath}" imported successfully.`);
                    const fileName: string | undefined = importZipResponse.data?.fileName;
                    if (fileName) {
                        return fileName;
                    } else {
                        const fileNameNotFoundErrorMessage: string = `[testBenchConnection] Imported file name not found in server response.`;
                        logger.error(fileNameNotFoundErrorMessage);
                        throw new Error(fileNameNotFoundErrorMessage);
                    }
                }
                case 403: {
                    const importForbiddenMessage: string =
                        "[testBenchConnection] Error when importing report: 403 Forbidden: You do not have permission to import execution results.";
                    logger.error(importForbiddenMessage);
                    throw new Error(importForbiddenMessage);
                }
                case 404: {
                    const importNotFoundMessage: string =
                        "[testBenchConnection] Error when importing report: 404 Not Found: The requested project was not found.";
                    logger.error(importNotFoundMessage);
                    throw new Error(importNotFoundMessage);
                }
                case 422: {
                    const importUnprocessableEntityMessage: string =
                        "[testBenchConnection] Error when importing report: 422 Unprocessable Entity: The imported file is invalid.";
                    logger.error(importUnprocessableEntityMessage);
                    throw new Error(importUnprocessableEntityMessage);
                }
                default: {
                    const importUnexpectedErrorMessage: string = `[testBenchConnection] Error when importing report: Unexpected status code ${importZipResponse.status} received.`;
                    logger.error(importUnexpectedErrorMessage);
                    throw new Error(importUnexpectedErrorMessage);
                }
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error(
                    `[testBenchConnection] Error when importing report: Axios error: ${error.message}. Error response data: ${error?.response?.data}`
                );
            } else {
                logger.error(`[testBenchConnection] Unexpected error when importing report:`, error);
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

        logger.debug(
            `[testBenchConnection] Fetching job ID of import job from URL ${getJobIDOfImportUrl} and import data request body:`,
            importData
        );

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
                3, // maxRetries
                2000, // delayMs
                (error) => {
                    // Retry predicates
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
                        logger.debug(`[testBenchConnection] Job ID of import job retrieved successfully: ${jobID}`);
                        return jobID;
                    } else {
                        const importJobIDNotFoundMessage: string =
                            "[testBenchConnection] Success response received but no jobID found in the response.";
                        logger.error(importJobIDNotFoundMessage);
                        throw new Error(importJobIDNotFoundMessage);
                    }
                }
                case 400: {
                    const importBadRequestMessage: string =
                        "[testBenchConnection] Error when fetching job ID of import job: 400 Bad Request: The request body is invalid.";
                    logger.error(importBadRequestMessage);
                    throw new Error(importBadRequestMessage);
                }
                case 403: {
                    const importForbiddenMessage: string =
                        "[testBenchConnection] Error when fetching job ID of import job: 403 Forbidden: You do not have permission to import execution results.";
                    logger.error(importForbiddenMessage);
                    throw new Error(importForbiddenMessage);
                }
                case 404: {
                    const importNotFoundMessage: string =
                        "[testBenchConnection] Error when fetching job ID of import job: 404 Not Found: Project or test cycle not found.";
                    logger.error(importNotFoundMessage);
                    throw new Error(importNotFoundMessage);
                }
                case 422: {
                    const importUnprocessableEntityMessage: string =
                        "[testBenchConnection] Error when fetching job ID of import job: 422 Unprocessable Entity: The server cannot process the request.";
                    logger.error(importUnprocessableEntityMessage);
                    throw new Error(importUnprocessableEntityMessage);
                }
                default: {
                    const importUnexpectedErrorMessage: string = `[testBenchConnection] Error when fetching job ID of import job: Unexpected status code ${importJobIDResponse.status} received.`;
                    logger.error(importUnexpectedErrorMessage);
                    throw new Error(importUnexpectedErrorMessage);
                }
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                logger.error(
                    `[testBenchConnection] Error when fetching job ID of import job: Axios error: ${error.message}. Error response data: ${error?.response?.data}`
                );
            } else {
                logger.error(`[testBenchConnection] Unexpected error when fetching job ID of import job:`, error);
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
        this.stopKeepAlive();
        this.keepAliveIntervalId = setInterval(() => {
            this.sendKeepAliveRequest();
        }, this.keepAliveIntervalInSeconds);
        this.sendKeepAliveRequest();
        logger.trace("[testBenchConnection] Keep-alive started.");
    }

    /** Stops the keep-alive process. */
    private stopKeepAlive(): void {
        if (this.keepAliveIntervalId) {
            clearInterval(this.keepAliveIntervalId);
            this.keepAliveIntervalId = null;
            logger.trace("[testBenchConnection] Keep-alive stopped.");
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
            logger.error(
                "[testBenchConnection] Session token or apiClient is missing. Cannot send keep-alive request."
            );
            this.stopKeepAlive();
            return;
        }

        try {
            await withRetry(
                () =>
                    this.apiClient.get(`/login/session/v1`, {
                        headers: { accept: "application/vnd.testbench+json" }
                    }),
                5, // maxRetries
                2000, // delayMs
                this.createRetryPredicate()
            );
            logger.trace("[testBenchConnection] Keep-alive request sent.");
        } catch (error) {
            logger.error(
                "[testBenchConnection] Keep-alive request failed after retries, logging out the user after keep-alive failure:",
                error
            );
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
 * @param {number} maxAllowedRetryCount - Maximum number of retry attempts (default is 3).
 * @param {number} delayMs - Delay in milliseconds between retries (default is 1000ms).
 * @param {boolean} shouldRetry - Optional predicate function that receives the error and returns whether to retry.
 * @param {boolean} showProgressBar - Optional flag to control whether to show a VS Code progress bar (default is false).
 * @returns {Promise<T>} A promise resolving to the function's return value.
 * @throws The error from the last failed attempt if all retries fail.
 */
export async function withRetry<T>(
    asyncFunction: () => Promise<T>,
    maxAllowedRetryCount: number = 3,
    delayMs: number = 2000,
    shouldRetry?: (error: any) => boolean,
    showProgressBar: boolean = true
): Promise<T> {
    let retryCount: number = 0;

    while (true) {
        try {
            return await asyncFunction();
        } catch (error) {
            logger.warn(`[testBenchConnection] Attempt ${retryCount} failed. Retrying in ${delayMs}ms...`);

            if (shouldRetry && !shouldRetry(error)) {
                logger.warn(`[testBenchConnection] Error is not retryable. Aborting further retry attempts.`);
                throw error;
            }

            retryCount++;
            if (retryCount > maxAllowedRetryCount) {
                logger.error(
                    `[testBenchConnection] Attempt ${retryCount} failed. Maximum retries reached, aborting further retries.`
                );
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
                        progress.report({ message: `Attempt ${retryCount} of ${maxAllowedRetryCount}` });
                        await new Promise((resolve) => setTimeout(resolve, delayMs));
                    }
                );
            } else {
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
async function promptForReportZipFileWithResults(): Promise<string | null> {
    try {
        const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            const workspaceLocationErrorMessage: string =
                "[testBenchConnection] Workspace location could not be determined while selecting report zip file.";
            const workspaceLocationErrorMessageForUser: string = "Workspace location could not be determined.";
            vscode.window.showErrorMessage(workspaceLocationErrorMessageForUser);
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
            const noZipFileSelectedMessage: string =
                "[testBenchConnection] No zip file selected while selecting report zip file.";
            const noZipFileSelectedMessageForUser: string = "No zip file selected. Please select a valid .zip file.";
            vscode.window.showErrorMessage(noZipFileSelectedMessageForUser);
            logger.debug(noZipFileSelectedMessage);
            return null;
        }

        const selectedFilePath: string = fileUri[0].fsPath;
        if (!selectedFilePath.endsWith(".zip")) {
            const selectedFileIsNotZipFileMessage: string =
                "[testBenchConnection] Selected file is not a .zip file while selecting report zip file.";
            const selectedFileIsNotZipFileMessageForUser: string =
                "Selected file is not a .zip file. Please select a valid .zip file.";
            vscode.window.showErrorMessage(selectedFileIsNotZipFileMessageForUser);
            logger.debug(selectedFileIsNotZipFileMessage);
            return null;
        }
        return selectedFilePath;
    } catch (error: any) {
        const zipSelectionErrorMessage: string = "[testBenchConnection] Error while selecting report zip file:";
        const zipSelectionErrorMessageForUser: string = "An error occurred while selecting the report zip file.";
        vscode.window.showErrorMessage(zipSelectionErrorMessageForUser);
        logger.error(`${zipSelectionErrorMessage} ${error.message}`);
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
    projectKeyString: string,
    cycleKeyString: string,
    reportWithResultsZipFilePath: string
): Promise<void | null> {
    try {
        logger.debug("Importing report with results to TestBench server.");
        const { uniqueID } = await extractDataFromReport(reportWithResultsZipFilePath);
        if (!uniqueID) {
            const extractionErrorMsg: string =
                "[testBenchConnection] Error extracting unique ID from the zip file during import report with results process.";
            const extractionErrorMsgForUser: string =
                "Error extracting unique ID from the zip file during import process.";
            vscode.window.showErrorMessage(extractionErrorMsgForUser);
            logger.error(extractionErrorMsg);
            return null;
        }

        /*
        // For debugging, save the tree items to a file called allTreeElements.json
        const allTreeElementsPath = path.join(__dirname, "allTreeElements.json");
        utils.saveJsonDataToFile(allTreeElementsPath, allTreeElementsInTreeView);
        logger.debug(`[testBenchConnection] All tree elements saved to ${allTreeElementsPath}`);
        */

        const projectKey: number = Number(projectKeyString);
        const cycleKey: number = Number(cycleKeyString);

        if (isNaN(projectKey) || isNaN(cycleKey)) {
            const invalidProjectOrCycleKeyMessage: string =
                "[testBenchConnection] Invalid projectKey or cycleKey provided for import.";
            const invalidProjectOrCycleKeyMessageForUser: string = "Invalid project or cycle key provided for import.";
            vscode.window.showErrorMessage(invalidProjectOrCycleKeyMessageForUser);
            logger.error(invalidProjectOrCycleKeyMessage);
            return null;
        }

        const zipFilenameFromServer: string = await connection.importExecutionResultsAndReturnImportedFileName(
            projectKey,
            reportWithResultsZipFilePath
        );
        if (!zipFilenameFromServer) {
            const importErrorMessage: string =
                "[testBenchConnection] Error importing the report file with results to the server.";
            const importErrorMessageForUser: string = "Error importing the report file to the server.";
            vscode.window.showErrorMessage(importErrorMessageForUser);
            logger.error(importErrorMessage);
            return null;
        }

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
            const importJobID: string = await connection.getJobIDOfImportJob(projectKey, cycleKey, importData);

            const importJobStatus: testBenchTypes.JobStatusResponse | null = await reportHandler.pollJobStatus(
                projectKeyString,
                importJobID,
                JobTypes.IMPORT
            );

            if (!importJobStatus || reportHandler.isImportJobFailed(importJobStatus)) {
                const importJobFailedMessageForUser: string = "Import job could not be completed.";
                vscode.window.showErrorMessage(importJobFailedMessageForUser);
                return null;
            } else if (!reportHandler.isImportJobCompletedSuccessfully(importJobStatus)) {
                const importJobStatusUnknownMessage: string =
                    "[testBenchConnection] Import job finished polling but status is unknown.";
                const importJobStatusUnknownMessageForUser: string = "Import job status unknown after polling.";
                logger.warn(importJobStatusUnknownMessage, importJobStatus);
                vscode.window.showWarningMessage(importJobStatusUnknownMessageForUser);
            }
        } catch (error: any) {
            logger.error(
                `[testBenchConnection] Error during import job initiation or polling for Project key ${projectKey}, Cycle key ${cycleKey}:`,
                error.message
            );
            return null;
        }
    } catch (error: any) {
        const unexpectedErrorMessage: string =
            "[testBenchConnection] Unexpected error during import report with results process.";
        const unexpectedErrorMessageForUser: string = "Unexpected error during import process.";
        logger.error(`${unexpectedErrorMessage} ${error.message}`);
        vscode.window.showErrorMessage(unexpectedErrorMessageForUser);
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

            if (!projectKey || !cycleKey) {
                const missingDataContextMsg: string =
                    "[testBenchConnection] Could not extract necessary project or cycle key from the selected report file.";
                const missingDataContextMsgForUser: string =
                    "Could not extract necessary project or cycle key from the selected report file.";
                logger.error(missingDataContextMsg);
                vscode.window.showErrorMessage(missingDataContextMsgForUser);
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
        const zipData: Buffer = await fs.promises.readFile(path.resolve(zipFilePath));
        const zip: JSZip = new JSZip();
        const zipContents: JSZip = await zip.loadAsync(zipData);

        const cycleStructureFileName: string = "cycle_structure.json";
        const projectFileName: string = "project.json";

        const cycleStructureJson = await utils.extractAndParseJsonContent(zipContents, cycleStructureFileName);
        const projectJson = await utils.extractAndParseJsonContent(zipContents, projectFileName);

        const uniqueID: string | null = cycleStructureJson?.root?.base?.uniqueID || null;
        const projectKey: string | null = projectJson?.key || null;
        const cycleNameOfProject: string | null = projectJson?.projectContext?.cycleName || null;
        const cycleKey: string | null = projectJson?.projectContext?.cycleKey || null;

        logger.debug(
            `[testBenchConnection] Extracted data from zip file "${zipFilePath}": uniqueID = ${uniqueID}, projectKey = ${projectKey}, cycleName = ${cycleNameOfProject}, cycleKey = ${cycleKey}`
        );
        return { uniqueID, projectKey, cycleNameOfProject, cycleKey };
    } catch (error) {
        logger.error(`[testBenchConnection] Error extracting JSON data from zip file "${zipFilePath}":`, error);
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
export async function loginToServerAndGetSessionDetails(
    serverName: string,
    portNumber: number,
    username: string,
    password: string
): Promise<TestBenchLoginResult | null> {
    agentForNextConnection = null;

    const requestBody: testBenchTypes.LoginRequestBody = {
        login: username,
        password: password,
        force: true
    };

    const baseURL: string = `https://${serverName}:${portNumber}/api`;
    const loginURL: string = `${baseURL}/login/session/v1`;

    logger.debug(`[testBenchConnection] Sending login request to: ${loginURL} for user ${username}`);

    /**
     * Performs login without retry logic.
     * @param agent The HTTPS agent to use for the request.
     */
    const performLogin = async (agent: https.Agent): Promise<AxiosResponse<testBenchTypes.LoginResponse>> => {
        return axios.post(loginURL, requestBody, {
            headers: {
                accept: "application/vnd.testbench+json",
                "Content-Type": "application/vnd.testbench+json"
            },
            httpsAgent: agent
        });
    };

    try {
        const secureAgent = await createSecureHttpsAgent();
        const loginResponse = await performLogin(secureAgent);
        if (loginResponse.status === 201 && loginResponse.data?.sessionToken) {
            logger.info(`[testBenchConnection] Login successful for user ${username} on ${serverName}.`);
            agentForNextConnection = secureAgent;

            return {
                sessionToken: loginResponse.data.sessionToken,
                userKey: loginResponse.data.userKey,
                loginName: loginResponse.data.login
            };
        }
        return null;
    } catch (error: any) {
        const certErrorCodes = ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_UNTRUSTED", "DEPTH_ZERO_SELF_SIGNED_CERT"];

        if (axios.isAxiosError(error) && certErrorCodes.includes(error.code || "")) {
            logger.warn(
                `[testBenchConnection] Certificate validation failed for ${serverName}: ${error.message}. Prompting user for insecure connection option.`
            );

            const proceedAnywayPromptText = "Proceed Anyway (insecure)";
            const choice = await vscode.window.showWarningMessage(
                `The security certificate for "${serverName}" is not trusted. This could expose you to security risks.`,
                { modal: true },
                proceedAnywayPromptText
            );

            if (choice === proceedAnywayPromptText) {
                logger.debug(`[testBenchConnection] User chose to proceed with insecure connection to ${serverName}.`);

                const tlsManager = TLSSecurityManager.getInstance();
                tlsManager.enableInsecureMode();

                try {
                    logger.debug(`[testBenchConnection] Attempting insecure connection to ${serverName}:${portNumber}`);

                    const insecureAgent = new https.Agent({
                        rejectUnauthorized: false,
                        checkServerIdentity: () => undefined
                    });

                    const insecureLoginResponse = await axios.post(loginURL, requestBody, {
                        headers: {
                            accept: "application/vnd.testbench+json",
                            "Content-Type": "application/vnd.testbench+json"
                        },
                        httpsAgent: insecureAgent,
                        timeout: 10000,
                        validateStatus: () => true // Accept any status code
                    });

                    if (insecureLoginResponse.status === 201 && insecureLoginResponse.data?.sessionToken) {
                        logger.info(
                            `[testBenchConnection] Insecure login successful for user ${username} on ${serverName}.`
                        );
                        agentForNextConnection = insecureAgent;
                        return {
                            sessionToken: insecureLoginResponse.data.sessionToken,
                            userKey: insecureLoginResponse.data.userKey,
                            loginName: insecureLoginResponse.data.login
                        };
                    } else {
                        logger.error(
                            `[testBenchConnection] Insecure login returned status ${insecureLoginResponse.status}`
                        );
                    }
                } catch (insecureError: any) {
                    logger.error(
                        `[testBenchConnection] Insecure login attempt failed for ${username} on ${serverName}:`,
                        insecureError.message
                    );
                    if (axios.isAxiosError(insecureError)) {
                        logger.error(`[testBenchConnection] Insecure error code: ${insecureError.code}`);
                        logger.error(`[testBenchConnection] Insecure error response:`, insecureError.response?.data);
                        logger.error(`[testBenchConnection] Insecure error config:`, insecureError.config);
                    }
                }
            }
            return null;
        } else {
            if (axios.isAxiosError(error) && error.response && error.response.status === 401) {
                logger.error(
                    `[testBenchConnection] Login failed for ${username} to ${serverName}: Invalid credentials.`
                );
            } else {
                logger.error(
                    `[testBenchConnection] Error during login for ${username} to ${serverName}:`,
                    error.message
                );
            }
            return null;
        }
    }
}
