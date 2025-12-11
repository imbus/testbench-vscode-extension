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
 * Client for legacy Play Server API calls.
 */
export class LegacyPlayServerClient {
    private static readonly OLD_SERVER_PORT = 9444;
    private static readonly OLD_SERVER_BASE_PATH = "/api/1";

    /**
     * Creates a new LegacyPlayServerClient instance.
     *
     * @param serverName The TestBench server hostname
     * @param sessionToken The session token for authentication
     * @param username The username for authentication
     * @param httpsAgent The HTTPS agent to use for requests (includes TLS configuration)
     * @param context The VS Code extension context
     */
    constructor(
        private serverName: string,
        private sessionToken: string,
        private username: string,
        private httpsAgent: https.Agent | HttpsProxyAgent<string>,
        private context: vscode.ExtensionContext
    ) {
        logger.trace(
            `[LegacyPlayServerClient] Initialized for server '${this.serverName}:${LegacyPlayServerClient.OLD_SERVER_PORT}'`
        );
    }

    /**
     * Fetches test elements using the Test Object Version (TOV) key from the old Play Server.
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
            const oldPlayServerBaseUrl: string = `https://${this.serverName}:${LegacyPlayServerClient.OLD_SERVER_PORT}${LegacyPlayServerClient.OLD_SERVER_BASE_PATH}`;
            const getTestElementsURL: string = `tovs/${tovKey}/testElements`;

            const encoded = base64.encode(`${this.username}:${this.sessionToken}`);

            logger.debug(
                `[LegacyPlayServerClient] Creating session for old Play Server with URL ${oldPlayServerBaseUrl} to fetch test elements.`
            );

            const oldPlayServerSession: AxiosInstance = axios.create({
                baseURL: oldPlayServerBaseUrl,
                // Old Play Server, which runs on port 9444, uses BasicAuth.
                // Use loginName as username, and use sessionToken as the password
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

            if (!oldPlayServerSession) {
                logger.error(
                    `[LegacyPlayServerClient] Failed to create session for old Play Server with URL ${oldPlayServerBaseUrl} while fetching test elements for TOV key ${tovKey}`
                );
                return null;
            }

            logger.trace(
                `[LegacyPlayServerClient] Fetching test elements for TOV key ${tovKey} from ${getTestElementsURL}`
            );

            const testElementsResponse: AxiosResponse = await withRetry(
                () => oldPlayServerSession.get(getTestElementsURL),
                3, // maxRetries
                2000, // delayMs
                RetryPredicateFactory.createDefaultPredicate()
            );

            logger.debug(
                `[LegacyPlayServerClient] Response status of GET test elements request for URL ${getTestElementsURL}: ${testElementsResponse.status}`
            );

            if (testElementsResponse.data) {
                logger.trace(
                    `[LegacyPlayServerClient] Fetched test elements data from URL ${getTestElementsURL}:`,
                    testElementsResponse.data
                );
                return testElementsResponse.data;
            } else {
                logger.error(
                    `[LegacyPlayServerClient] Test elements data is not available from URL ${getTestElementsURL}.`
                );
                return null;
            }
        } catch (error) {
            logger.error(`[LegacyPlayServerClient] Error fetching test elements for TOV key ${tovKey}: ${error}`);
            vscode.window.showErrorMessage("Error fetching test elements. Please check the logs for details.");
            return null;
        }
    }

    /**
     * Returns all filters that can be accessed by the connected user from the old Play Server.
     * @returns A promise that resolves to the filters data or null if an error occurs
     */
    async getFilters(): Promise<any | null> {
        if (!this.sessionToken) {
            logger.error("[LegacyPlayServerClient] Session token is null. Cannot fetch filters");
            return null;
        }

        try {
            const oldPlayServerBaseUrl: string = `https://${this.serverName}:${LegacyPlayServerClient.OLD_SERVER_PORT}${LegacyPlayServerClient.OLD_SERVER_BASE_PATH}`;
            const getFiltersURL: string = `${oldPlayServerBaseUrl}/filters`;

            logger.debug(
                `[LegacyPlayServerClient] Creating session for old Play Server with URL ${oldPlayServerBaseUrl} to fetch filters`
            );

            const encoded = base64.encode(`${this.username}:${this.sessionToken}`);

            const oldPlayServerSession: AxiosInstance = axios.create({
                baseURL: oldPlayServerBaseUrl,
                // Old Play Server, which runs on port 9444, uses BasicAuth.
                // Use loginName as username, and use sessionToken as the password
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

            if (!oldPlayServerSession) {
                logger.error(
                    `[LegacyPlayServerClient] Failed to create session for old Play Server with URL ${oldPlayServerBaseUrl} while fetching filters`
                );
                return null;
            }

            logger.trace(`[LegacyPlayServerClient] Fetching filters from URL ${getFiltersURL}`);

            const getFiltersResponse: AxiosResponse = await withRetry(
                () => oldPlayServerSession.get(getFiltersURL),
                3, // maxRetries
                2000, // delayMs
                RetryPredicateFactory.createDefaultPredicate()
            );

            logger.debug(
                `[LegacyPlayServerClient] Response status of get filters request for URL ${getFiltersURL}: ${getFiltersResponse.status}`
            );

            if (getFiltersResponse.data) {
                logger.trace(
                    `[LegacyPlayServerClient] Fetched filters data for request ${getFiltersURL}:`,
                    getFiltersResponse.data
                );
                return getFiltersResponse.data;
            } else {
                logger.error(`[LegacyPlayServerClient] Filters data is not available from URL ${getFiltersURL}.`);
                return null;
            }
        } catch (error) {
            logger.error(`[LegacyPlayServerClient] Error fetching filters: ${error}`);
            vscode.window.showErrorMessage("Error fetching filters. Please check the logs for details.");
            return null;
        }
    }
}
