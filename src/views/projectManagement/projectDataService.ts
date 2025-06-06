/**
 * @file src/views/projectManagement/projectDataService.ts
 * @description Service for managing project data.
 */

import { PlayServerConnection } from "../../testBenchConnection";
import { TestBenchLogger } from "../../testBenchLogger";
import { Project, TreeNode, CycleStructure } from "../../testBenchTypes";

export class ProjectDataService {
    private readonly getConnection: () => PlayServerConnection | null;
    private readonly logger: TestBenchLogger;

    constructor(getConnection: () => PlayServerConnection | null, logger: TestBenchLogger) {
        this.getConnection = getConnection;
        this.logger = logger;
        if (typeof this.getConnection !== "function") {
            this.logger.error(
                "[ProjectDataService] getConnection function is not a valid function during construction."
            );
        }
    }

    /**
     * Fetches the list of projects from the TestBench server.
     * @returns {Promise<Project[] | null>} The list of projects or null if an error occurs or not connected.
     */
    async getProjectsList(): Promise<Project[] | null> {
        const currentConnection = this.getConnection();
        if (!currentConnection) {
            this.logger.error("[ProjectDataService] No active connection. Cannot fetch projects list.");
            return null;
        }
        try {
            this.logger.debug("[ProjectDataService] Fetching projects list.");
            const projects = await currentConnection.getProjectsList();
            if (projects === null) {
                this.logger.warn("[ProjectDataService] getProjectsList returned null.");
            }
            return projects;
        } catch (error) {
            this.logger.error("[ProjectDataService] Error fetching projects list:", error);
            return null;
        }
    }

    /**
     * Fetches the project tree for a specific project from the TestBench server.
     * @param {string} projectKey - The project key as a string.
     * @returns {Promise<TreeNode | null>} The project tree or null if an error occurs or not connected.
     */
    async getProjectTree(projectKey: string | null): Promise<TreeNode | null> {
        const currentConnection = this.getConnection();
        if (!currentConnection) {
            this.logger.error("[ProjectDataService] No active connection. Cannot fetch project tree.");
            return null;
        }
        if (!projectKey) {
            this.logger.error("[ProjectDataService] Project key is null or undefined. Cannot fetch project tree.");
            return null;
        }
        try {
            this.logger.debug(`[ProjectDataService] Fetching project tree for project key: ${projectKey}`);
            const projectTree = await currentConnection.getProjectTreeOfProject(projectKey);
            if (projectTree === null) {
                this.logger.warn(`[ProjectDataService] getProjectTreeOfProject returned null for key ${projectKey}.`);
            }
            return projectTree;
        } catch (error) {
            this.logger.error(`[ProjectDataService] Error fetching project tree for key ${projectKey}:`, error);
            return null;
        }
    }

    /**
     * Fetches the cycle structure of a specific cycle within a project from the TestBench server.
     * @param {string} projectKey - The project key as a string.
     * @param {string} cycleKey - The cycle key as a string.
     * @returns {Promise<CycleStructure | null>} The cycle structure or null if an error occurs or not connected.
     */
    async fetchCycleStructure(projectKey: string, cycleKey: string): Promise<CycleStructure | null> {
        const currentConnection = this.getConnection();
        if (!currentConnection) {
            this.logger.error("[ProjectDataService] No active connection. Cannot fetch cycle structure.");
            return null;
        }
        if (!projectKey || !cycleKey) {
            this.logger.error(
                `[ProjectDataService] ProjectKey ${projectKey} or CycleKey ${cycleKey} is null/undefined. Cannot fetch cycle structure.`
            );
            return null;
        }
        try {
            this.logger.debug(
                `[ProjectDataService] Fetching cycle structure for project ${projectKey}, cycle ${cycleKey}.`
            );
            const cycleStructure = await currentConnection.fetchCycleStructureOfCycleInProject(projectKey, cycleKey);
            if (cycleStructure === null) {
                this.logger.warn(
                    `[ProjectDataService] fetchCycleStructureOfCycleInProject returned null for project ${projectKey}, cycle ${cycleKey}.`
                );
            }
            return cycleStructure;
        } catch (error) {
            this.logger.error(
                `[ProjectDataService] Error fetching cycle structure for project ${projectKey}, cycle ${cycleKey}:`,
                error
            );
            return null;
        }
    }
}
