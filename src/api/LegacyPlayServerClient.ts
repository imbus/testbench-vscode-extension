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
import * as tls from "tls";
import * as base64 from "base-64";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { logger } from "../extension";
import { withRetry, RetryPredicateFactory, TLSSecurityManager } from "../testBenchConnection";

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
    private static readonly CERTIFICATE_ERROR_CODES = new Set([
        "SELF_SIGNED_CERT",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "CERT_UNTRUSTED",
        "DEPTH_ZERO_SELF_SIGNED_CERT"
    ]);

    /** The currently active legacy server port (discovered during initialization or defaulted to 9444) */
    private currentLegacyPort: number = LegacyPlayServerClient.DEFAULT_LEGACY_PORT;

    /**
     * If true, all legacy requests use insecure TLS due to a previously detected
     * certificate mismatch on the legacy endpoint.
     */
    private useInsecureLegacyTls: boolean = false;

    /**
     * Creates a new LegacyPlayServerClient instance.
     * Note: Call initialize() after construction to discover the correct legacy server port.
     *
     * @param serverName The TestBench server hostname
     * @param newServerPort The new Play server port (used for serverLocations discovery)
     * @param sessionToken The session token for authentication
     * @param username The username for authentication
     * @param httpsAgent The HTTPS agent to use for requests (includes TLS configuration)
     */
    constructor(
        private serverName: string,
        private newServerPort: number,
        private sessionToken: string,
        private username: string,
        private httpsAgent: https.Agent | HttpsProxyAgent<string>
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
                false // Don't show progress bar for fallback attempts
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
     * Always fetches port from the new Play server's serverLocations endpoint.
     * If the fetch fails, it falls back to the default port 9444 for backward compatibility.
     *
     * @returns A promise that resolves when initialization is complete
     */
    public async initialize(): Promise<void> {
        logger.debug(`[LegacyPlayServerClient] Initializing and discovering legacy server port...`);

        const serverLocations = await this.fetchServerLocations();

        if (serverLocations && serverLocations.legacyPlayPort) {
            this.currentLegacyPort = serverLocations.legacyPlayPort;
            logger.info(
                `[LegacyPlayServerClient] Successfully discovered legacy Play server port: ${this.currentLegacyPort}`
            );
        } else {
            logger.info(
                `[LegacyPlayServerClient] Could not discover legacy server port. Using default port ${LegacyPlayServerClient.DEFAULT_LEGACY_PORT}`
            );
        }

        logger.debug(
            `[LegacyPlayServerClient] Initialization complete. Will use port ${this.currentLegacyPort} for legacy server requests.`
        );
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

        const httpsAgent = this.useInsecureLegacyTls
            ? new https.Agent({
                  rejectUnauthorized: false,
                  checkServerIdentity: (_hostname: string, _cert: tls.PeerCertificate) => undefined
              })
            : this.httpsAgent;

        logger.trace(
            `[LegacyPlayServerClient] Creating legacy server session with URL ${legacyServerBaseUrl} (insecureTLS=${this.useInsecureLegacyTls})`
        );

        return axios.create({
            baseURL: legacyServerBaseUrl,
            // Old Play Server uses BasicAuth with username and sessionToken as password
            auth: {
                username: this.username,
                password: this.sessionToken
            },
            headers: {
                accept: "application/vnd.testbench+json; charset=utf-8",
                Authorization: `Basic ${encoded}`,
                "Content-Type": "application/vnd.testbench+json; charset=utf-8"
            },
            proxy: false,
            httpsAgent
        });
    }

    /**
     * Determines if the given error is related to TLS certificate validation failure.
     * @param error The error object to check
     * @returns True if the error is a certificate validation error, false otherwise
     */
    private isCertificateValidationError(error: unknown): boolean {
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

        if (axios.isAxiosError(error)) {
            const code = error.code || "";
            return (
                LegacyPlayServerClient.CERTIFICATE_ERROR_CODES.has(code) ||
                hasCertificateMessage(error.message) ||
                hasCertificateMessage(error.cause instanceof Error ? error.cause.message : undefined)
            );
        }

        if (error instanceof Error) {
            return hasCertificateMessage(error.message);
        }

        return false;
    }

    /**
     * Returns a predicate function for retrying legacy server requests that treats TLS certificate validation errors as non-retryable.
     * @returns A predicate function that returns true for retryable errors and false for non-retryable errors
     */
    private getRetryPredicate(): (error: any) => boolean {
        const defaultPredicate = RetryPredicateFactory.createDefaultPredicate();
        return (error: any) => {
            if (this.isCertificateValidationError(error)) {
                return false;
            }
            return defaultPredicate(error);
        };
    }

    /**
     * Executes a GET request to the legacy Play server with automatic fallback to insecure TLS if a certificate validation error is detected.
     * @param requestPath The path of the request to be made
     * @returns A promise that resolves to the AxiosResponse or throws an error if all retries fail
     */
    private async executeLegacyGetWithCertFallback(requestPath: string): Promise<AxiosResponse> {
        const session = this.createLegacyServerSession();
        try {
            return await withRetry(
                () => session.get(requestPath),
                3, // maxRetries
                2000, // delayMs
                this.getRetryPredicate()
            );
        } catch (error: unknown) {
            if (!this.isCertificateValidationError(error)) {
                throw error;
            }

            logger.warn(
                `[LegacyPlayServerClient] Certificate validation failed on legacy endpoint (code: ${(error as any)?.code || "unknown"}). Retrying legacy request with insecure TLS.`
            );

            this.useInsecureLegacyTls = true;
            const insecureSession = this.createLegacyServerSession();
            try {
                return await withRetry(
                    () => insecureSession.get(requestPath),
                    1, // maxRetries
                    1000, // delayMs
                    RetryPredicateFactory.createDefaultPredicate(),
                    false
                );
            } catch (insecureError: unknown) {
                if (!this.isCertificateValidationError(insecureError)) {
                    throw insecureError;
                }

                logger.warn(
                    `[LegacyPlayServerClient] Insecure legacy agent still failed certificate validation (code: ${(insecureError as any)?.code || "unknown"}). Enabling global insecure TLS mode and retrying once.`
                );

                TLSSecurityManager.getInstance().enableInsecureMode();
                const globallyInsecureSession = this.createLegacyServerSession();
                return withRetry(
                    () => globallyInsecureSession.get(requestPath),
                    0, // maxRetries
                    0, // delayMs
                    RetryPredicateFactory.createDefaultPredicate(),
                    false
                );
            }
        }
    }

    /**
     * Executes a legacy GET with TLS fallback and, when needed, a port fallback.
     * @param requestPath The path of the request to be made
     * @returns A promise that resolves to the AxiosResponse or throws an error if all retries fail
     */
    private async executeLegacyGetWithPortAndTlsFallback(requestPath: string): Promise<AxiosResponse> {
        try {
            return await this.executeLegacyGetWithCertFallback(requestPath);
        } catch (error: unknown) {
            if (
                !this.isCertificateValidationError(error) ||
                this.currentLegacyPort === LegacyPlayServerClient.DEFAULT_LEGACY_PORT
            ) {
                throw error;
            }

            const discoveredPort = this.currentLegacyPort;
            logger.warn(
                `[LegacyPlayServerClient] Legacy request on discovered port ${discoveredPort} failed with certificate validation. Retrying on default port ${LegacyPlayServerClient.DEFAULT_LEGACY_PORT}.`
            );

            this.currentLegacyPort = LegacyPlayServerClient.DEFAULT_LEGACY_PORT;
            this.useInsecureLegacyTls = false;

            try {
                return await this.executeLegacyGetWithCertFallback(requestPath);
            } catch (fallbackError: unknown) {
                this.currentLegacyPort = discoveredPort;
                throw fallbackError;
            }
        }
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
            const response: AxiosResponse = await this.executeLegacyGetWithPortAndTlsFallback(getTestElementsURL);
            if (response.data) {
                logger.trace(`[LegacyPlayServerClient] Successfully fetched test elements data for TOV ${tovKey}:`, {
                    response: response.data
                });
                return response.data;
            } else {
                logger.error(`[LegacyPlayServerClient] Test elements data is not available for TOV key ${tovKey}.`);
                return null;
            }
        } catch (error) {
            logger.error(`[LegacyPlayServerClient] Error fetching test elements for TOV key ${tovKey}: ${error}`);
            vscode.window.showErrorMessage("Error fetching test elements. Please check the logs for details.");
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

            const response: AxiosResponse = await this.executeLegacyGetWithPortAndTlsFallback(getFiltersPath);

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
            vscode.window.showErrorMessage("Error fetching filters. Please check the logs for details.");
            return null;
        }
    }
}
