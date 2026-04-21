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
import { HttpsProxyAgent } from "https-proxy-agent";
import JSZip from "jszip";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import path from "path";
import { logger, getAuthProvider } from "./extension";
import * as utils from "./utils";
import {
    JobTypes,
    allExtensionCommands,
    folderNameOfInternalTestbenchFolder,
    ConfigKeys,
    INTERNAL_REPORTS_SUBFOLDER_NAME,
    TreeViewTiming
} from "./constants";
import { TestThemesTreeView } from "./treeViews/implementations/testThemes/TestThemesTreeView";
import { getExtensionSetting } from "./configuration";
import { TESTBENCH_AUTH_PROVIDER_ID } from "./testBenchAuthenticationProvider";
import * as connectionManager from "./connectionManager";
import { SharedSessionManager } from "./sharedSessionManager";
import { handleLanguageServerRestartOnSessionChange } from "./languageServer/server";
import { CacheManager } from "./core/cacheManager";
import { LegacyPlayServerClient } from "./api/LegacyPlayServerClient";

interface CachedCertificateData {
    path: string;
    mtimeMs: number;
    data: Buffer;
}

let cachedCertificate: CachedCertificateData | null = null;

/**
 * Module-level flag to prevent multiple retry progress notifications from being
 * shown simultaneously when several API calls fail at the same time.
 */
let isRetryNotificationActive = false;

const SESSION_LOGOUT_WARNING_MESSAGE =
    "Your TestBench session has expired or the server is unavailable. You are being returned to the login view.";

/**
 * Loads and caches certificate data from disk to avoid redundant reads.
 * @param absolutePath The absolute path to the certificate file
 * @returns The certificate data as a Buffer, or null if loading fails
 */
async function getCachedCertificateData(absolutePath: string): Promise<Buffer | null> {
    try {
        const stats = await fs.promises.stat(absolutePath);
        if (
            cachedCertificate &&
            cachedCertificate.path === absolutePath &&
            cachedCertificate.mtimeMs === stats.mtimeMs
        ) {
            logger.trace("[testBenchConnection] Reusing cached certificate data.");
            return cachedCertificate.data;
        }

        const certificateBuffer = await fs.promises.readFile(absolutePath);
        cachedCertificate = {
            path: absolutePath,
            mtimeMs: stats.mtimeMs,
            data: certificateBuffer
        };
        logger.trace("[testBenchConnection] Loaded certificate data into cache.");
        return certificateBuffer;
    } catch (error) {
        logger.warn("[testBenchConnection] Failed to load certificate data from disk:", error);
        cachedCertificate = null;
        return null;
    }
}

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
            logger.warn("[testBenchConnection] Enabling insecure TLS mode.");
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
            logger.debug("[testBenchConnection] Disabling insecure TLS mode.");
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

/**
 * Retry predicate factory to handle retry logic based on the status code of the response.
 */
export class RetryPredicateFactory {
    /**
     * Creates a retry predicate that never retries on client errors (4xx status codes).
     * @returns A retry predicate function
     */
    public static createDefaultPredicate(): (error: any) => boolean {
        return (error: any): boolean => {
            if (axios.isAxiosError(error) && error.response) {
                const status = error.response.status;
                if (status >= 400 && status < 500) {
                    logger.trace(`[testBenchConnection] Not retrying on client error ${status}`);
                    return false;
                }
            }
            return true;
        };
    }

    /**
     * Creates a retry predicate that never retries on specific status codes.
     * @param nonRetryableStatusCodes Array of HTTP status codes that should not be retried
     * @returns A retry predicate function
     */
    public static createCustomPredicate(nonRetryableStatusCodes: number[]): (error: any) => boolean {
        return (error: any): boolean => {
            if (axios.isAxiosError(error) && error.response) {
                const status = error.response.status;
                if (nonRetryableStatusCodes.includes(status)) {
                    logger.trace(`[testBenchConnection] Not retrying on status code ${status}`);
                    return false;
                }
            }
            return true;
        };
    }
}

export interface TestBenchLoginResult {
    sessionToken: string;
    userKey: string; // From LoginResponse
    loginName: string;
    isInsecure: boolean;
    serverVersion: string;
}

/**
 * Custom error that will be throwed in case an API request fails (including all of its retries)
 * to indicate that the session has expired or the server is unreachable.
 * Used to trigger a logout and return to the login view.
 */
export class TestBenchConnectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TestBenchConnectionError";
    }
}

/**
 * Creates a secure or insecure HTTPS agent.
 * @param {boolean} insecure - Whether to create an insecure agent that bypasses certificate validation.
 * @returns {Promise<https.Agent>} A configured https.Agent.
 */
async function createHttpsAgent(insecure: boolean = false): Promise<HttpsProxyAgent<string> | https.Agent> {
    const http_config = vscode.workspace.getConfiguration("http");
    const proxy_url = http_config.get<string>(ConfigKeys.PROXY_URL);
    const agent_url: string = proxy_url ?? "";

    const agentOptions: https.AgentOptions & {
        checkServerIdentity?: (hostname: string, cert: tls.PeerCertificate) => Error | undefined;
    } = {};

    if (insecure) {
        logger.trace("[testBenchConnection] Creating an insecure HTTPS agent that ignores certificate errors.");
        agentOptions.rejectUnauthorized = false;
        agentOptions.checkServerIdentity = () => undefined;
    } else {
        const defaultCAs = tls.rootCertificates.map((cert) => Buffer.from(cert));
        const certificatePathSetting = getExtensionSetting<string>(ConfigKeys.CERTIFICATE_PATH);
        let absoluteCertPath: string | null = null;
        if (certificatePathSetting) {
            if (path.isAbsolute(certificatePathSetting)) {
                if (await utils.isAbsolutePath(certificatePathSetting, true)) {
                    absoluteCertPath = certificatePathSetting;
                } else {
                    logger.warn(
                        `[testBenchConnection] Absolute certificate path "${certificatePathSetting}" does not exist or is not accessible.`
                    );
                }
            } else {
                absoluteCertPath = await utils.constructAbsolutePathFromRelativePath(certificatePathSetting, true);
            }
        } else {
            const certPath = process.env.NODE_EXTRA_CA_CERTS;
            if (!certPath) {
                logger.debug("[testBenchConnection] Environment variable 'NODE_EXTRA_CA_CERTS' is not set.");
            } else {
                absoluteCertPath = certPath;
            }
        }
        if (!absoluteCertPath) {
            logger.debug(`[testBenchConnection] Certificate path "${certificatePathSetting}" could not be resolved.`);
            agentOptions.ca = defaultCAs;
            logger.debug("[testBenchConnection] Using only default system CAs.");
        } else {
            const customCA = await getCachedCertificateData(absoluteCertPath);
            if (customCA) {
                const combinedCAs = [...defaultCAs, customCA];
                logger.debug("[testBenchConnection] Using combined CAs (default system CAs + custom CA).");
                agentOptions.ca = combinedCAs;
            } else {
                logger.warn(
                    `[testBenchConnection] Unable to load certificate at "${absoluteCertPath}". Falling back to default system CAs.`
                );
                agentOptions.ca = defaultCAs;
            }
        }
    }

    if (agent_url) {
        return new HttpsProxyAgent(agent_url, agentOptions);
    }

    return new https.Agent(agentOptions);
}

/**
 * Represents a connection to the TestBench Play server.
 * Handles communication with the server, including login, logout, and API requests.
 */
export class PlayServerConnection {
    private baseURL: string;
    private apiClient!: AxiosInstance;
    private legacyClient!: LegacyPlayServerClient;
    private readonly keepAliveIntervalInMs: number = 30 * 1000; // 30 seconds
    private readonly keepAliveRequestTimeoutInMs: number = 10 * 1000; // 10 seconds per request attempt
    private keepAliveIntervalId: NodeJS.Timeout | null = null;
    private testElementsCache: CacheManager<string, any>;
    private testStructureCache: CacheManager<string, testBenchTypes.TestStructure>;
    private legacyInitPromise: Promise<void> | null = null;
    private isKeepAliveInProgress: boolean = false;

    /**
     * Creates a new PlayServerConnection.
     *
     * @param {string} serverName - The name of the server.
     * @param {number} portNumber - The port number of the server.
     * @param {string} username - The username for authentication.
     * @param {string} sessionToken - The session token for authentication.
     * @param {vscode.ExtensionContext} context - The extension context for path resolution.
     * @param {boolean} isInsecure - Whether to use insecure TLS.
     * @param {string} serverVersion - The TestBench server version (used for legacy port cache invalidation).
     */
    constructor(
        public serverName: string,
        public portNumber: number,
        public username: string,
        private sessionToken: string,
        private context: vscode.ExtensionContext,
        private isInsecure: boolean = false,
        private serverVersion: string = ""
    ) {
        this.baseURL = `https://${this.serverName}:${this.portNumber}/api`;
        this.testElementsCache = new CacheManager<string, any>(TreeViewTiming.TREE_DATA_FRESHNESS_THRESHOLD_MS);
        this.testStructureCache = new CacheManager<string, testBenchTypes.TestStructure>(
            TreeViewTiming.TREE_DATA_FRESHNESS_THRESHOLD_MS
        );
        logger.trace(
            `[testBenchConnection] Initializing server connection for '${this.serverName}:${this.portNumber}' as '${this.username}'.`
        );
    }

    /**
     * Initializes the connection asynchronously, setting up the HTTPS agent and API client.
     */
    async initialize(): Promise<void> {
        if (this.isInsecure) {
            TLSSecurityManager.getInstance().enableInsecureMode();
        }
        const agentToUse = await createHttpsAgent(this.isInsecure);
        this.apiClient = axios.create({
            baseURL: this.baseURL,
            headers: { Authorization: this.sessionToken },
            httpsAgent: agentToUse,
            proxy: false
        });

        // Initialize legacy client for old Play Server API calls
        this.legacyClient = new LegacyPlayServerClient(
            this.serverName,
            this.portNumber,
            this.sessionToken,
            this.username,
            agentToUse
        );

        // Initialize legacy server port discovery in the background
        this.legacyInitPromise = this.legacyClient.initialize().catch((error) => {
            logger.warn(
                `[testBenchConnection] Legacy Play server initialization failed, but main connection is still functional: ${error?.message || error}`
            );
        });

        if (this.sessionToken) {
            // Start the keep-alive process immediately to prevent session timeout after 5 minutes
            this.startKeepAlive();
        } else {
            logger.warn("[testBenchConnection] Initialized without a session token. Server keep-alive not started.");
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
     * Clears the current session token, stops keep-alive, and resets TLS settings.
     * NOTE: We don't call “delete session” API call on server so that other API clients are not logged out by the extension.
     * @returns {Promise<boolean>} True if server logout was successful or no action needed, false on API error.
     */
    async teardownAfterLogout(): Promise<boolean> {
        try {
            logger.trace("[testBenchConnection] Tearing down connection after logout.");
            this.stopKeepAlive();
            this.testElementsCache.clearCache();
            this.testStructureCache.clearCache();
            // Await any ongoing legacy client initialization before teardown
            if (this.legacyInitPromise) {
                await this.legacyInitPromise;
                this.legacyInitPromise = null;
            }
            const tlsManager = TLSSecurityManager.getInstance();
            tlsManager.disableInsecureMode();
            this.sessionToken = "";
        } catch (error) {
            logger.error("[testBenchConnection] Error during teardown after logout:", error);
            return false;
        }

        return true;
    }

    /**
     * Fetches the list of projects from the TestBench server.
     *
     * @returns {Promise<testBenchTypes.Project[] | null>} The list of projects or null if an error occurs.
     */
    async getProjectsList(): Promise<testBenchTypes.Project[] | null> {
        if (!this.sessionToken || !this.apiClient) {
            logger.trace("[testBenchConnection] Session token is null. Cannot fetch projects list.");
            return null;
        }
        try {
            const projectsURL: string = `/2/projects`;
            logger.trace(`[testBenchConnection] Fetching projects list using URL: ${projectsURL}`);
            const projectsResponse: AxiosResponse<testBenchTypes.Project[]> = await withRetry(
                () =>
                    this.apiClient.get(projectsURL, {
                        headers: { accept: "application/vnd.testbench+json" },
                        proxy: false
                    }),
                3, // Try 3 additional times
                2000, // delayMs
                RetryPredicateFactory.createDefaultPredicate()
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
                logger.trace(`[testBenchConnection] Fetched project list for request ${projectsURL}:`, {
                    response: projectsResponse.data
                });
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
            const projectTreeURL: string = `/2/projects/${projectKey}/tree`;
            logger.trace(
                `[testBenchConnection] Fetching project tree for project key ${projectKey} using URL ${projectTreeURL}`
            );
            const projectTreeResponse: AxiosResponse<testBenchTypes.TreeNode> = await withRetry(
                () =>
                    this.apiClient.get(projectTreeURL, {
                        headers: { accept: "application/vnd.testbench+json" },
                        proxy: false
                    }),
                3, // maxRetries
                2000, // delayMs
                RetryPredicateFactory.createDefaultPredicate()
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

            logger.trace(
                `[testBenchConnection] Response status of project tree request for URL ${projectTreeURL}: ${projectTreeResponse.status}`
            );
            if (projectTreeResponse.data) {
                logger.trace(`[testBenchConnection] Fetched project tree for request ${projectTreeURL}:`, {
                    response: projectTreeResponse.data
                });
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
        if (!tovKey) {
            logger.error(`[testBenchConnection] TOV key is missing. Cannot fetch test elements.`);
            return null;
        }

        const cachedEntry = this.testElementsCache.getEntryFromCache(tovKey);
        if (cachedEntry) {
            logger.trace(`[testBenchConnection] Returning cached test elements for TOV key ${tovKey}.`);
            return cachedEntry;
        }

        // Delegate to legacy client
        const testElements = await this.legacyClient.getTestElements(tovKey);

        // Cache the result if successful
        if (testElements) {
            this.testElementsCache.setEntryInCache(tovKey, testElements);
        }

        return testElements;
    }

    // TODO: If this API call is implemented in the new play server, replace this method with the new API.
    /**
     * Returns all filters that can be accessed by the connected user.
     *
     * @returns {Promise<any | null>} The filters data or null if an error occurs
     */
    async getFiltersFromOldPlayServer(): Promise<any | null> {
        return this.legacyClient.getFilters();
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
        const tovReportUrl: string = `/2/projects/${projectKey}/tovs/${tovKey}/report`;

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
                        },
                        proxy: false
                    }),
                3, // maxRetries
                2000, // delayMs
                RetryPredicateFactory.createDefaultPredicate()
            );

            logger.debug(
                `[testBenchConnection] Response status of TOV report job ID request for URL ${tovReportUrl}: ${tovReportJobResponse.status}`
            );
            if (tovReportJobResponse.data.jobID) {
                logger.trace(`[testBenchConnection] Received TOV report Job ID for URL ${tovReportUrl}:`, {
                    response: tovReportJobResponse.data
                });
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
     * @param {boolean} suppressFilteredData - Whether to suppress filtered data from the server response
     * @returns {Promise<testBenchTypes.TestStructure | null>} The test structure or null if an error occurs.
     */
    async fetchTestStructureOfCycleFromServer(
        projectKey: string,
        cycleKey: string,
        suppressFilteredData: boolean = true
    ): Promise<testBenchTypes.TestStructure | null> {
        const testStructureOfCycleUrl = `/2/projects/${projectKey}/cycles/${cycleKey}/structure`;
        const validatedFilters = await TestThemesTreeView.getValidatedFiltersForApiRequest();
        return this._fetchTestStructureWithFilterHandling(
            testStructureOfCycleUrl,
            validatedFilters,
            "cycle",
            suppressFilteredData
        );
    }

    /**
     * Fetches the test structure of a specific TOV within a project from the TestBench server.
     *
     * @param {string} projectKey - The project key as a string.
     * @param {string} tovKey - The TOV key as a string.
     * @param {boolean} suppressFilteredData - Whether to suppress filtered data from the server response
     * @returns {Promise<testBenchTypes.TestStructure | null>} The cycle structure or null if an error occurs.
     */
    async fetchTestStructureOfTOVFromServer(
        projectKey: string,
        tovKey: string,
        suppressFilteredData: boolean = true
    ): Promise<testBenchTypes.TestStructure | null> {
        const testStructureOfTOVUrl = `/2/projects/${projectKey}/tovs/${tovKey}/structure`;
        const validatedFilters = await TestThemesTreeView.getValidatedFiltersForApiRequest();
        return this._fetchTestStructureWithFilterHandling(
            testStructureOfTOVUrl,
            validatedFilters,
            "TOV",
            suppressFilteredData
        );
    }

    /**
     * Internal method to fetch test structure with pre-validated filters.
     * Filters are already validated and transformed before reaching this method.
     *
     * @param {string} url - The API endpoint URL
     * @param {any[]} validatedFilters - The pre-validated and transformed filters
     * @param {string} structureType - Type of structure being fetched (for logging)
     * @param {boolean} suppressFilteredData - Whether to suppress filtered data from the server response
     * @returns {Promise<testBenchTypes.TestStructure | null>} The test structure or null if an error occurs.
     */
    private async _fetchTestStructureWithFilterHandling(
        url: string,
        validatedFilters: any[],
        structureType: string,
        suppressFilteredData: boolean = true
    ): Promise<testBenchTypes.TestStructure | null> {
        const cacheKey = `${url}-${JSON.stringify(validatedFilters)}-${suppressFilteredData}`;
        const cachedEntry = this.testStructureCache.getEntryFromCache(cacheKey);
        if (cachedEntry) {
            logger.trace(`[testBenchConnection] Returning cached test structure for ${structureType}.`);
            return cachedEntry;
        }

        const requestBody: testBenchTypes.OptionalJobIDRequestParameter = {
            basedOnExecution: true,
            suppressFilteredData: suppressFilteredData,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: validatedFilters
        };

        logger.trace(
            `[testBenchConnection] Fetching ${structureType} structure from URL ${url} and request body:`,
            requestBody
        );

        if (validatedFilters.length > 0) {
            logger.trace(
                `[testBenchConnection] Using ${validatedFilters.length} validated filters when fetching ${structureType} structure:`,
                validatedFilters.map((f: any) => f.name)
            );
        }

        try {
            const response: AxiosResponse<testBenchTypes.TestStructure> = await withRetry(
                () =>
                    this.apiClient.post(url, requestBody, {
                        headers: {
                            accept: "application/json",
                            "Content-Type": "application/json"
                        }
                    }),
                3, // maxRetries
                2000, // delayMs
                (error) => {
                    if (axios.isAxiosError(error) && error.response) {
                        // Standard non-retryable status codes
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
                `[testBenchConnection] Response status of test structure of ${structureType} request for URL ${url}:`,
                response.status
            );

            if (response.data) {
                logger.trace(`[testBenchConnection] Received ${structureType} structure:`, {
                    response: response.data
                });
                this.testStructureCache.setEntryInCache(cacheKey, response.data);
                return response.data;
            } else {
                logger.error(
                    `[testBenchConnection] Unexpected response code when fetching ${structureType} structure for ${url}: ${response.status}`
                );
                return null;
            }
        } catch (error) {
            logger.error(
                `[testBenchConnection] Error fetching test structure for ${structureType} using ${url}:`,
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
        const importResultZipURL: string = `/2/projects/${projectKey}/executionResults`;

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
                        validateStatus: () => true,
                        proxy: false
                    }),
                3, // maxRetries
                2000, // delayMs
                RetryPredicateFactory.createDefaultPredicate()
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
        const getJobIDOfImportUrl: string = `/2/projects/${projectKey}/cycles/${cycleKey}/import`;

        logger.trace(
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
                        proxy: false,
                        validateStatus: () => true
                    }),
                3, // maxRetries
                2000, // delayMs
                RetryPredicateFactory.createDefaultPredicate()
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
     * The keep-alive process sends a GET request to the server in regular intervals.
     * The constructor method of the PlayServerConnection class starts the keep-alive process automatically.
     * If the session token is null, the keep-alive process is not started.
     * If the keep-alive process is already running and it is triggered again, the previous one is stopped before starting a new one.
     */
    public startKeepAlive(): void {
        this.stopKeepAlive();
        this.keepAliveIntervalId = setInterval(() => {
            this.sendKeepAliveRequest();
        }, this.keepAliveIntervalInMs);
        // this.sendKeepAliveRequest();
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
     * Sends a lightweight GET request to the server to keep the session alive, which normally times out after 5 minutes.
     * The keep-alive process is started automatically when the PlayServerConnection object is created.
     * If the request fails, retries are attempted up to 3 times with a delay of 2 second between each attempt.
     * If the keep alive request fails with an error code other than 401, the user is logged out automatically.
     * If the keep alive request fails with an error code 401, extension tries to re-authenticate same user silently using stored credentials.
     */
    private async sendKeepAliveRequest(): Promise<void> {
        if (this.isKeepAliveInProgress) {
            logger.trace("[testBenchConnection] Keep-alive request already in progress. Skipping this interval.");
            return;
        }

        if (!this.sessionToken || !this.apiClient) {
            logger.error(
                "[testBenchConnection] Session token or apiClient is missing. Cannot send keep-alive request."
            );
            this.stopKeepAlive();
            return;
        }

        this.isKeepAliveInProgress = true;

        try {
            await withRetry(
                () => {
                    // Hung requests should not block future keep-alive cycles.
                    const requestAbortController = new AbortController();
                    const requestTimeoutHandle = setTimeout(() => {
                        requestAbortController.abort();
                    }, this.keepAliveRequestTimeoutInMs);

                    return this.apiClient
                        .get(`/2/login/session`, {
                            headers: { accept: "application/vnd.testbench+json" },
                            proxy: false,
                            timeout: this.keepAliveRequestTimeoutInMs,
                            signal: requestAbortController.signal
                        })
                        .finally(() => {
                            clearTimeout(requestTimeoutHandle);
                        });
                },
                3,
                2000,
                RetryPredicateFactory.createDefaultPredicate()
            );
            logger.trace("[testBenchConnection] Keep-alive request sent.");
        } catch (error) {
            logger.warn("[testBenchConnection] Keep-alive request failed after retries, attempting re-login:", error);

            let shouldLogout = true;

            if (axios.isAxiosError(error) && error.response?.status === 401) {
                shouldLogout =
                    !(await this.trySilentReloginWithStoredPassword()) &&
                    !(await this.tryFallbackReloginWithAuthProvider());
            }

            if (shouldLogout) {
                vscode.window.showWarningMessage(SESSION_LOGOUT_WARNING_MESSAGE);
                await vscode.commands.executeCommand(`${allExtensionCommands.logout}`);
            }
        } finally {
            this.isKeepAliveInProgress = false;
        }
    }

    /**
     * Attempts silent re-login using stored password.
     * @returns True if re-login succeeded, false otherwise.
     */
    private async trySilentReloginWithStoredPassword(): Promise<boolean> {
        const activeConnection = await connectionManager.getActiveConnection(this.context);
        if (
            !activeConnection ||
            activeConnection.username !== this.username ||
            activeConnection.serverName !== this.serverName ||
            activeConnection.portNumber !== this.portNumber
        ) {
            return false;
        }

        const storedPassword = await connectionManager.getPasswordForConnection(this.context, activeConnection.id);
        if (!storedPassword) {
            return false;
        }

        const loginResult = await loginToServerAndGetSessionDetails(
            this.serverName,
            this.portNumber,
            this.username,
            storedPassword
        );

        if (!loginResult) {
            return false;
        }

        await this.handleReloginSuccess(loginResult, activeConnection.id);
        logger.trace(
            "[testBenchConnection] Successfully re-authenticated silently using stored credentials after 401 in keep-alive"
        );
        return true;
    }

    /**
     * Attempts fallback re-login using authProvider.
     * @returns True if re-login succeeded, false otherwise.
     */
    private async tryFallbackReloginWithAuthProvider(): Promise<boolean> {
        const authProvider = getAuthProvider();
        if (!authProvider) {
            return false;
        }

        const currentSession = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            silent: true
        });
        if (currentSession) {
            await authProvider.removeSession(currentSession.id);
        }

        authProvider.markNextLoginAsSilent();
        try {
            const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                createIfNone: true
            });
            if (!session) {
                return false;
            }

            const oldToken = this.sessionToken;
            this.sessionToken = session.accessToken;
            this.apiClient.defaults.headers.Authorization = this.sessionToken;
            this.startKeepAlive();

            // For fallback, we don't have full loginResult, so skip shared session update
            // Assume isInsecure from current state (or fetch if needed)
            await handleLanguageServerRestartOnSessionChange(oldToken, this.sessionToken);

            logger.info("[testBenchConnection] Successfully re-authenticated after 401 in keep-alive");
            return true;
        } catch (reloginError) {
            logger.warn("[testBenchConnection] Silent re-authentication failed:", reloginError);
            return false;
        }
    }

    /**
     * Handles common updates after successful re-login.
     * @param loginResult The login result containing new session details.
     * @param connectionId The ID of the active connection.
     */
    private async handleReloginSuccess(loginResult: TestBenchLoginResult, connectionId: string): Promise<void> {
        const oldToken = this.sessionToken;
        this.sessionToken = loginResult.sessionToken;
        this.apiClient.defaults.headers.Authorization = this.sessionToken;
        this.startKeepAlive();

        const sharedSessionManager = SharedSessionManager.getInstance(this.context);
        await sharedSessionManager.storeSharedSession(
            connectionId, // Using connection ID as session ID
            loginResult.sessionToken,
            loginResult.userKey,
            loginResult.loginName,
            connectionId,
            this.serverName,
            this.portNumber,
            this.username,
            loginResult.isInsecure,
            loginResult.serverVersion
        );

        await handleLanguageServerRestartOnSessionChange(oldToken, this.sessionToken);
    }
}

/**
 * Executes an asynchronous function with retry logic in case of failures such as temporary network problems.
 * Used to retry API calls in case of network errors. To disable retries for an API call, set maxRetries to 0.
 *
 * @template T - The type returned by the asynchronous function.
 * @param {Promise<T>} asyncFunction - The asynchronous function to execute.
 * @param {number} maxAllowedRetryCount - Maximum number of retry attempts (default is 3).
 * @param {number} delayMs - Delay in milliseconds between retries (default is 2000ms).
 * @param {boolean} shouldRetry - Optional predicate function that receives the error and returns whether to retry.
 * @param {boolean} showProgressBar - Optional flag to control whether to show a VS Code progress bar (default is true).
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
    const totalAttempts = maxAllowedRetryCount + 1;

    const buildRequestUrl = (baseURL?: string, requestUrl?: string): string => {
        if (!requestUrl) {
            return "<unknown-url>";
        }
        if (/^https?:\/\//i.test(requestUrl)) {
            return requestUrl;
        }
        if (!baseURL) {
            return requestUrl;
        }

        const normalizedBase = baseURL.replace(/\/+$/, "");
        const normalizedPath = requestUrl.replace(/^\/+/, "");
        return `${normalizedBase}/${normalizedPath}`;
    };

    const getRequestDescription = (error: unknown): string => {
        if (!axios.isAxiosError(error)) {
            return "<non-axios-error>";
        }

        const method = (error.config?.method || "GET").toUpperCase();
        const requestUrl = buildRequestUrl(error.config?.baseURL, error.config?.url);
        return `${method} ${requestUrl}`;
    };

    const getStatusDescription = (error: unknown): string => {
        if (!axios.isAxiosError(error)) {
            return "unknown";
        }
        return error.response?.status?.toString() ?? "network/no-response";
    };

    const getErrorCodeDescription = (error: unknown): string => {
        if (!axios.isAxiosError(error)) {
            return "unknown";
        }
        return error.code || "none";
    };

    const isCertificateValidationError = (error: unknown): boolean => {
        const hasCertificateMessage = (message: string | undefined): boolean => {
            if (!message) {
                return false;
            }

            const normalizedMessage = message.toLowerCase();
            return (
                normalizedMessage.includes("self signed certificate") ||
                normalizedMessage.includes("unable to verify") ||
                normalizedMessage.includes("certificate")
            );
        };

        if (!axios.isAxiosError(error)) {
            return error instanceof Error ? hasCertificateMessage(error.message) : false;
        }

        const certErrorCodes = new Set([
            "SELF_SIGNED_CERT",
            "SELF_SIGNED_CERT_IN_CHAIN",
            "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
            "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
            "CERT_UNTRUSTED",
            "DEPTH_ZERO_SELF_SIGNED_CERT"
        ]);

        return (
            certErrorCodes.has(error.code || "") ||
            hasCertificateMessage(error.message) ||
            hasCertificateMessage(error.cause instanceof Error ? error.cause.message : undefined)
        );
    };

    /**
     * Checks if the given error indicates an expired session or server unavailability,
     * and forces a local logout if so. Excludes authentication endpoint errors.
     * @param error - The error to check.
     * @returns True if a logout was performed, false otherwise.
     */
    const checkAndForceLogout = async (error: any) => {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const isNetworkError = !error.response;
            const isAuthEndpoint = error.config?.url?.includes("/2/login/session");
            const requestDescription = getRequestDescription(error);

            if (isCertificateValidationError(error)) {
                logger.warn(
                    `[testBenchConnection] Certificate validation error detected for ${requestDescription} (code: ${getErrorCodeDescription(
                        error
                    )}). Skipping automatic logout so caller can apply TLS fallback handling.`
                );
                return false;
            }

            if (!isAuthEndpoint && (status === 401 || status === 403 || isNetworkError)) {
                logger.warn(
                    `[testBenchConnection] Unrecoverable API error detected for ${requestDescription} (status: ${status}, networkError: ${isNetworkError}, code: ${getErrorCodeDescription(
                        error
                    )}). Forcing a local logout.`
                );
                vscode.window.showWarningMessage(SESSION_LOGOUT_WARNING_MESSAGE);
                await vscode.commands.executeCommand(allExtensionCommands.logout);
                return true;
            }
        }
        return false;
    };

    while (true) {
        try {
            return await asyncFunction();
        } catch (error) {
            const currentAttempt = retryCount + 1;
            const requestDescription = getRequestDescription(error);
            const statusDescription = getStatusDescription(error);
            const errorCode = getErrorCodeDescription(error);
            const errorMessage = error instanceof Error ? error.message : String(error);

            logger.trace(
                `[testBenchConnection] Attempt ${currentAttempt}/${totalAttempts} failed for ${requestDescription} (status: ${statusDescription}, code: ${errorCode}): ${errorMessage}`
            );

            // Check if we should retry this error
            if (shouldRetry && !shouldRetry(error)) {
                logger.trace(
                    `[testBenchConnection] Error is not retryable for ${requestDescription}. Aborting further retry attempts.`
                );
                const loggedOut = await checkAndForceLogout(error);
                if (loggedOut) {
                    throw new TestBenchConnectionError(
                        "Session expired or server unavailable. User has been logged out."
                    );
                }
                throw error;
            }

            retryCount++;
            if (retryCount > maxAllowedRetryCount) {
                logger.error(
                    `[testBenchConnection] Attempt ${retryCount}/${totalAttempts} failed for ${requestDescription}. Maximum retries (${maxAllowedRetryCount}) reached, aborting further retries.`
                );
                const loggedOut = await checkAndForceLogout(error);
                if (loggedOut) {
                    throw new TestBenchConnectionError(
                        "Session expired or server unavailable. User has been logged out."
                    );
                }
                throw error;
            }

            // Show the progress bar only if retries are happening, the flag is enabled,
            // and no other retry notification is already visible.
            if (showProgressBar && !isRetryNotificationActive) {
                isRetryNotificationActive = true;
                try {
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
                } finally {
                    isRetryNotificationActive = false;
                }
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

        const workingDirectoryPath: string = path.join(
            workspaceLocation,
            folderNameOfInternalTestbenchFolder,
            INTERNAL_REPORTS_SUBFOLDER_NAME
        );
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
            treeRootUID: uniqueID,
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
            progress.report({ message: "Selecting report file with results.", increment: 40 });
            const resultZipFilePath: string | null = await promptForReportZipFileWithResults();
            if (!resultZipFilePath) {
                return null;
            }

            progress.report({ message: "Extracting report context...", increment: 20 });
            const { projectKey, cycleKey } = await extractDataFromReport(resultZipFilePath);

            if (!projectKey || !cycleKey) {
                const missingDataContextMsg: string =
                    "[testBenchConnection] Could not extract necessary project or cycle key from the selected report file.";
                const missingDataContextMsgForUser: string =
                    "Could not extract necessary project or cycle key from the selected report file.";
                logger.error(missingDataContextMsg);
                vscode.window.showErrorMessage(missingDataContextMsgForUser);
                return null;
            }

            progress.report({ message: "Importing report file.", increment: 40 });
            await importReportWithResultsToTestbench(connection, projectKey, cycleKey, resultZipFilePath);
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
 * This function focuses on the API keyword and does not handle UI or global state.
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
    const requestBody: testBenchTypes.LoginRequestBody = {
        login: username,
        password: password,
        force: true
    };

    const baseURL: string = `https://${serverName}:${portNumber}/api`;
    const loginURL: string = `${baseURL}/2/login/session`;

    logger.trace(`[testBenchConnection] Endpoint used for login is '${loginURL}', user ${username}.`);

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
            proxy: false,
            httpsAgent: agent
        });
    };

    try {
        const secureAgent = await createHttpsAgent();
        const loginResponse = await performLogin(secureAgent);
        if (loginResponse.status === 201 && loginResponse.data?.sessionToken) {
            logger.info(`[testBenchConnection] Login successful for user ${username} on ${serverName}.`);

            return {
                sessionToken: loginResponse.data.sessionToken,
                userKey: loginResponse.data.userKey,
                loginName: loginResponse.data.login,
                isInsecure: false,
                serverVersion: loginResponse.data.serverVersion || ""
            };
        }
        return null;
    } catch (error: any) {
        const certErrorCodes = [
            "SELF_SIGNED_CERT_IN_CHAIN",
            "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
            "CERT_UNTRUSTED",
            "DEPTH_ZERO_SELF_SIGNED_CERT"
        ];

        if (axios.isAxiosError(error) && certErrorCodes.includes(error.code || "")) {
            logger.warn(
                `[testBenchConnection] Certificate validation failed for ${serverName}: ${error.message}. Prompting user for insecure connection option.`
            );
            const proceedAnywayOption = "Proceed Anyway";
            const message = `You are using an untrusted certificate. If you proceed, your connection might not be secure.\nDetails: ${error.message}`;
            const choice = await vscode.window.showWarningMessage(message, { modal: true }, proceedAnywayOption);

            if (choice === proceedAnywayOption) {
                logger.debug(
                    `[testBenchConnection] User chose to proceed with insecure connection to '${serverName}'.`
                );
                const tlsManager = TLSSecurityManager.getInstance();
                tlsManager.enableInsecureMode();
                try {
                    logger.debug(
                        `[testBenchConnection] Attempting insecure connection to '${serverName}:${portNumber}'.`
                    );
                    const insecureAgent = await createHttpsAgent(true);
                    const insecureLoginResponse = await axios.post(loginURL, requestBody, {
                        headers: {
                            accept: "application/vnd.testbench+json",
                            "Content-Type": "application/vnd.testbench+json"
                        },
                        httpsAgent: insecureAgent,
                        timeout: 10000,
                        validateStatus: () => true,
                        proxy: false
                    });
                    if (insecureLoginResponse.status === 201 && insecureLoginResponse.data?.sessionToken) {
                        logger.debug(
                            `[testBenchConnection] Insecure login successful for user '${username}' on '${serverName}'.`
                        );
                        return {
                            sessionToken: insecureLoginResponse.data.sessionToken,
                            userKey: insecureLoginResponse.data.userKey,
                            loginName: insecureLoginResponse.data.login,
                            isInsecure: true,
                            serverVersion: insecureLoginResponse.data.serverVersion || ""
                        };
                    } else {
                        logger.error(
                            `[testBenchConnection] Insecure login returned status ${insecureLoginResponse.status}`
                        );
                        vscode.window.showErrorMessage(
                            `Login Error: Request failed with status code ${insecureLoginResponse.status}`
                        );
                    }
                } catch (insecureError: any) {
                    vscode.window.showErrorMessage(`${insecureError.code}: ${insecureError.message}`);
                    logger.error(
                        `[testBenchConnection] Insecure login attempt failed for ${username} on ${serverName}:`,
                        insecureError.message
                    );
                    if (axios.isAxiosError(insecureError)) {
                        logger.error(
                            `[testBenchConnection] Insecure Axios error details:\nCode=${insecureError.code},\nResponse=${JSON.stringify(insecureError.response?.data)},\nConfig=${JSON.stringify(insecureError.config)}`
                        );
                    }
                }
            }
            return null;
        } else {
            vscode.window.showErrorMessage(`Error during login: ${error.code}`);
            // Note: The error object is very large and contains sensitive information
            logger.error(`[testBenchConnection] Error during login for ${username} to ${serverName}`);
            return null;
        }
    }
}
