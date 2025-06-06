/**
 * @file src/views/testElements/testElementDataService.ts
 * @description Service for fetching test elements data from the TestBench server.
 */

import { PlayServerConnection } from "../../testBenchConnection";
import { TestBenchLogger } from "../../testBenchLogger";

export class TestElementDataService {
    private readonly getConnection: () => PlayServerConnection | null;
    private readonly logger: TestBenchLogger;

    constructor(getConnection: () => PlayServerConnection | null, logger: TestBenchLogger) {
        this.getConnection = getConnection;
        this.logger = logger;

        if (typeof this.getConnection !== "function") {
            this.logger.error(
                "[TestElementDataService] getConnection function is not a valid function during construction."
            );
        }
    }

    /**
     * Fetches test elements using the Test Object Version (TOV) key.
     * This currently uses an older Play server API endpoint.
     * @param {string} tovKey - The TOV key as a string.
     * @returns {Promise<any[] | null>} An array of raw test element objects or null if an error occurs or not connected.
     */
    async getTestElements(tovKey: string | null): Promise<any[] | null> {
        const currentConnection = this.getConnection();
        if (!currentConnection) {
            this.logger.error("[TestElementDataService] No active connection. Cannot fetch test elements.");
            return null;
        }
        if (!tovKey) {
            this.logger.error("[TestElementDataService] TOV key is null or undefined. Cannot fetch test elements.");
            return null;
        }

        try {
            this.logger.debug(`[TestElementDataService] Fetching test elements for TOV key: ${tovKey}`);
            const rawTestElementsJsonData = await currentConnection.getTestElementsWithTovKeyUsingOldPlayServer(tovKey);

            if (rawTestElementsJsonData === null) {
                this.logger.warn(
                    `[TestElementDataService] getTestElementsWithTovKeyUsingOldPlayServer returned null for TOV key ${tovKey}.`
                );
                return null;
            }
            return Array.isArray(rawTestElementsJsonData) ? rawTestElementsJsonData : null;
        } catch (error) {
            this.logger.error(`[TestElementDataService] Error fetching test elements for TOV key ${tovKey}:`, error);
            return null;
        }
    }
}
