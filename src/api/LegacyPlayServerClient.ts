/**
 * @file src/api/LegacyPlayServerClient.ts
 * @description Client for communicating with the legacy Play Server (port 9444).
 *
 * This client will be removed when the new Play Server
 * implements the missing endpoints. All methods in this class use the old Play Server
 * running on port 9444 with BasicAuth authentication.
 */

import * as vscode from "vscode";
import * as https from "https";
import * as base64 from "base-64";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { logger } from "../extension";
import { withRetry, RetryPredicateFactory } from "../testBenchConnection";

/**
 * Interface for server locations response from the new Play server.
 */
interface ServerLocationsResponse {
    jBossHost: string;
    jBossJNDIPort: number;
    legacyPlayHost: string;
    legacyPlayPort: number;
}

/**
 * Client for legacy Play Server API calls.
 */
export class LegacyPlayServerClient {
    private static readonly DEFAULT_LEGACY_PORT = 9444;
    private static readonly LEGACY_SERVER_BASE_PATH = "/api/1";
    private static readonly SERVER_LOCATIONS_ENDPOINT = "/2/serverLocations";

    /** The currently active legacy server port (discovered during initialization or defaulted to 9444) */
    private currentLegacyPort: number = LegacyPlayServerClient.DEFAULT_LEGACY_PORT;

    /**
     * Creates a new LegacyPlayServerClient instance.
     * Note: Call initialize() after construction to discover the correct legacy server port.
     *
     * @param serverName The TestBench server hostname
     * @param newServerPort The new Play server port (used for serverLocations discovery)
     * @param sessionToken The session token for authentication
     * @param username The username for authentication
     * @param httpsAgent The HTTPS agent to use for requests (includes TLS configuration)
     * @param context The VS Code extension context
     */
    constructor(
        private serverName: string,
        private newServerPort: number,
        private sessionToken: string,
        private username: string,
        private httpsAgent: https.Agent | HttpsProxyAgent<string>,
        private context: vscode.ExtensionContext
    ) {
        logger.trace(
            `[LegacyPlayServerClient] Initialized for server '${this.serverName}' (default legacy port: ${LegacyPlayServerClient.DEFAULT_LEGACY_PORT}, new server port: ${this.newServerPort})`
        );
    }

    /**
     * Fetches server locations from the new Play server to discover the legacy Play server port.
     * This is called during initialization to determine the correct port before any legacy server requests.
     *
     * @returns A promise that resolves to the ServerLocationsResponse or null if the call fails
     */
    private async fetchServerLocations(): Promise<ServerLocationsResponse | null> {
        try {
            const newServerBaseUrl = `https://${this.serverName}:${this.newServerPort}/api`;
            const serverLocationsUrl = `${newServerBaseUrl}${LegacyPlayServerClient.SERVER_LOCATIONS_ENDPOINT}`;

            logger.debug(`[LegacyPlayServerClient] Attempting to fetch server locations from ${serverLocationsUrl}`);

            // New Play server uses session token directly in Authorization header
            const newServerSession: AxiosInstance = axios.create({
                baseURL: newServerBaseUrl,
                headers: {
                    Authorization: this.sessionToken,
                    "Content-Type": "application/vnd.testbench+json; charset=utf-8"
                },
                proxy: false,
                httpsAgent: this.httpsAgent
            });

            const serverLocationsResponse: AxiosResponse<ServerLocationsResponse> = await withRetry(
                () => newServerSession.get(LegacyPlayServerClient.SERVER_LOCATIONS_ENDPOINT),
                2, // maxRetries
                1000, // delayMs
                RetryPredicateFactory.createDefaultPredicate(),
                false, // Don't show progress bar for fallback attempts
                false // Never force logout from background legacy-port discovery
            );

            if (serverLocationsResponse.status === 200 && serverLocationsResponse.data) {
                logger.info(
                    `[LegacyPlayServerClient] Successfully fetched server locations. Legacy Play port: ${serverLocationsResponse.data.legacyPlayPort}`
                );
                return serverLocationsResponse.data;
            } else {
                logger.warn(
                    `[LegacyPlayServerClient] Unexpected response status ${serverLocationsResponse.status} when fetching server locations`
                );
                return null;
            }
        } catch (error: any) {
            if (error?.response?.status === 404) {
                logger.warn(
                    `[LegacyPlayServerClient] Server locations endpoint returned 404. The legacy server port cannot be discovered dynamically.`
                );
            } else {
                logger.error(`[LegacyPlayServerClient] Error fetching server locations: ${error?.message || error}`);
            }
            return null;
        }
    }

    /**
     * Initializes the legacy Play server client by discovering the correct port.
     * This method should be called immediately after construction.
     * First checks the cache for a previously discovered port for this server.
     * If not cached, it fetches from the new Play server's serverLocations endpoint and caches the result.
     * If the fetch fails, it falls back to the default port 9444 for backward compatibility.
     *
     * @returns A promise that resolves when initialization is complete
     */
    public async initialize(): Promise<void> {
        logger.debug(`[LegacyPlayServerClient] Initializing and discovering legacy server port...`);

        // Check cache first to avoid redundant API calls
        const cachedPort = this.getCachedPort();
        if (cachedPort !== null) {
            this.currentLegacyPort = cachedPort;
            logger.info(
                `[LegacyPlayServerClient] Using cached legacy Play server port: ${this.currentLegacyPort} for server '${this.serverName}'`
            );
            logger.debug(
                `[LegacyPlayServerClient] Initialization complete. Will use port ${this.currentLegacyPort} for legacy server requests.`
            );
            return;
        }

        // No cache, fetch from server
        logger.debug(`[LegacyPlayServerClient] No cached port found. Fetching from server...`);
        const serverLocations = await this.fetchServerLocations();

        if (serverLocations && serverLocations.legacyPlayPort) {
            this.currentLegacyPort = serverLocations.legacyPlayPort;
            // Cache the discovered port for future use
            this.cachePort(this.currentLegacyPort);
            logger.info(
                `[LegacyPlayServerClient] Successfully discovered and cached legacy Play server port: ${this.currentLegacyPort}`
            );
        } else {
            // Cache the default port so we don't keep trying to fetch
            this.cachePort(LegacyPlayServerClient.DEFAULT_LEGACY_PORT);
            logger.info(
                `[LegacyPlayServerClient] Could not discover legacy server port. Using and caching default port ${LegacyPlayServerClient.DEFAULT_LEGACY_PORT}`
            );
        }

        logger.debug(
            `[LegacyPlayServerClient] Initialization complete. Will use port ${this.currentLegacyPort} for legacy server requests.`
        );
    }

    /**
     * Gets the storage key for caching the legacy Play server port for a specific server.
     *
     * @returns The storage key string
     */
    private getPortCacheKey(): string {
        return `testbenchExtension.legacyPlayServerPort.${this.serverName}`;
    }

    /**
     * Retrieves the cached legacy Play server port for the current server from persistent storage.
     *
     * @returns The cached port number, or null if not found or invalid
     */
    private getCachedPort(): number | null {
        try {
            const cacheKey = this.getPortCacheKey();
            const cachedValue = this.context.globalState.get<number>(cacheKey);

            if (cachedValue && typeof cachedValue === "number" && cachedValue > 0) {
                logger.trace(
                    `[LegacyPlayServerClient] Found cached port ${cachedValue} for server '${this.serverName}'`
                );
                return cachedValue;
            }

            logger.trace(`[LegacyPlayServerClient] No valid cached port found for server '${this.serverName}'`);
            return null;
        } catch (error) {
            logger.warn(
                `[LegacyPlayServerClient] Error retrieving cached port for server '${this.serverName}': ${error}`
            );
            return null;
        }
    }

    /**
     * Stores the legacy Play server port in persistent storage for future use.
     * The port is cached per server and persists across VS Code window reloads.
     *
     * @param port The port number to cache
     */
    private async cachePort(port: number): Promise<void> {
        try {
            const cacheKey = this.getPortCacheKey();
            await this.context.globalState.update(cacheKey, port);
            logger.trace(
                `[LegacyPlayServerClient] Cached port ${port} for server '${this.serverName}' in persistent storage`
            );
        } catch (error) {
            logger.warn(`[LegacyPlayServerClient] Failed to cache port for server '${this.serverName}': ${error}`);
        }
    }

    /**
     * Clears the cached legacy Play server port for the current server.
     * This can be useful if the server configuration changes or for troubleshooting.
     *
     * @returns A promise that resolves when the cache is cleared
     */
    public async clearPortCache(): Promise<void> {
        try {
            const cacheKey = this.getPortCacheKey();
            await this.context.globalState.update(cacheKey, undefined);
            logger.info(`[LegacyPlayServerClient] Cleared cached port for server '${this.serverName}'`);
        } catch (error) {
            logger.warn(
                `[LegacyPlayServerClient] Failed to clear cached port for server '${this.serverName}': ${error}`
            );
        }
    }

    /**
     * Creates an axios instance configured for the legacy Play server with the current port.
     * The port is discovered during initialization via the serverLocations endpoint.
     *
     * @returns A configured AxiosInstance
     */
    private createLegacyServerSession(): AxiosInstance {
        const legacyServerBaseUrl = `https://${this.serverName}:${this.currentLegacyPort}${LegacyPlayServerClient.LEGACY_SERVER_BASE_PATH}`;
        const encoded = base64.encode(`${this.username}:${this.sessionToken}`);

        logger.trace(`[LegacyPlayServerClient] Creating legacy server session with URL ${legacyServerBaseUrl}`);

        return axios.create({
            baseURL: legacyServerBaseUrl,
            // Old Play Server uses BasicAuth with username and sessionToken as password
            auth: {
                username: this.username,
                password: this.sessionToken
            },
            headers: {
                Authorization: `Basic ${encoded}`,
                "Content-Type": "application/vnd.testbench+json; charset=utf-8"
            },
            proxy: false,
            httpsAgent: this.httpsAgent
        });
    }

    /**
     * Shows a user-facing warning for legacy API failures while clarifying that
     * the current TestBench session remains active.
     *
     * @param operationName The operation that failed (e.g., "test elements", "filters")
     */
    private showLegacyApiFailureWarning(operationName: string): void {
        vscode.window.showWarningMessage(`Could not fetch ${operationName} from the legacy TestBench API.`);
    }

    /**
     * Fetches test elements using the Test Object Version (TOV) key from the legacy Play Server.
     * Uses the port discovered during initialization.
     *
     * @param tovKey The TOV key as a string
     * @returns A promise that resolves to the test elements data or null if an error occurs
     */
    async getTestElements(tovKey: string | null): Promise<any | null> {
        if (!tovKey) {
            logger.error(`[LegacyPlayServerClient] TOV key is missing. Cannot fetch test elements.`);
            return null;
        }

        if (!this.sessionToken) {
            logger.error(
                `[LegacyPlayServerClient] Session token is null. Cannot fetch test elements for TOV key: ${tovKey}`
            );
            return null;
        }

        try {
            const getTestElementsURL = `tovs/${tovKey}/testElements`;
            logger.trace(
                `[LegacyPlayServerClient] Fetching test elements for TOV key ${tovKey} from port ${this.currentLegacyPort}`
            );

            const session = this.createLegacyServerSession();
            let getTestElementsResponse: AxiosResponse;
            try {
                getTestElementsResponse = await withRetry(
                    () => session.get(getTestElementsURL),
                    3, // maxRetries
                    2000, // delayMs
                    RetryPredicateFactory.createDefaultPredicate(),
                    true,
                    false // Legacy endpoint network issues must not trigger global logout
                );
            } catch (error) {
                const isNetworkError = axios.isAxiosError(error) && !error.response;
                if (!isNetworkError) {
                    throw error;
                }

                logger.warn(
                    `[LegacyPlayServerClient] Network error while fetching test elements on port ${this.currentLegacyPort}. Attempting legacy port rediscovery and one final retry.`
                );

                await this.clearPortCache();
                await this.initialize();

                const retryLegacyServerSession = this.createLegacyServerSession();
                getTestElementsResponse = await withRetry(
                    () => retryLegacyServerSession.get(getTestElementsURL),
                    1, // maxRetries
                    1000, // delayMs
                    RetryPredicateFactory.createDefaultPredicate(),
                    true,
                    false // Legacy endpoint network issues must not trigger global logout
                );
            }

            if (getTestElementsResponse.data) {
                logger.trace(`[LegacyPlayServerClient] Successfully fetched test elements data for TOV ${tovKey}:`, {
                    response: getTestElementsResponse.data
                });
                return getTestElementsResponse.data;
            } else {
                logger.error(`[LegacyPlayServerClient] Test elements data is not available for TOV key ${tovKey}.`);
                return null;
            }
        } catch (error) {
            logger.error(`[LegacyPlayServerClient] Error fetching test elements for TOV key ${tovKey}: ${error}`);
            this.showLegacyApiFailureWarning("test elements");
            return null;
        }
    }

    /**
     * Returns all filters that can be accessed by the connected user from the legacy Play Server.
     * Uses the port discovered during initialization.
     *
     * @returns A promise that resolves to the filters data or null if an error occurs
     */
    async getFilters(): Promise<any | null> {
        if (!this.sessionToken) {
            logger.error("[LegacyPlayServerClient] Session token is null. Cannot fetch filters");
            return null;
        }

        try {
            const getFiltersPath = "/filters";
            logger.trace(
                `[LegacyPlayServerClient] Fetching filters from legacy Play server on port ${this.currentLegacyPort}`
            );

            const session = this.createLegacyServerSession();
            let response: AxiosResponse;
            try {
                response = await withRetry(
                    () => session.get(getFiltersPath),
                    3, // maxRetries
                    2000, // delayMs
                    RetryPredicateFactory.createDefaultPredicate(),
                    true,
                    false // Legacy endpoint network issues must not trigger global logout
                );
            } catch (error) {
                const isNetworkError = axios.isAxiosError(error) && !error.response;
                if (!isNetworkError) {
                    throw error;
                }

                logger.warn(
                    `[LegacyPlayServerClient] Network error while fetching filters on port ${this.currentLegacyPort}. Attempting legacy port rediscovery and one final retry.`
                );

                await this.clearPortCache();
                await this.initialize();

                const retrySession = this.createLegacyServerSession();
                response = await withRetry(
                    () => retrySession.get(getFiltersPath),
                    1, // maxRetries
                    1000, // delayMs
                    RetryPredicateFactory.createDefaultPredicate(),
                    true,
                    false // Legacy endpoint network issues must not trigger global logout
                );
            }

            if (response.data) {
                logger.trace(`[LegacyPlayServerClient] Successfully fetched filters data:`, {
                    response: response.data
                });
                return response.data;
            } else {
                logger.error(`[LegacyPlayServerClient] Filters data is not available.`);
                return null;
            }
        } catch (error) {
            logger.error(`[LegacyPlayServerClient] Error fetching filters: ${error}`);
            this.showLegacyApiFailureWarning("filters");
            return null;
        }
    }
}
