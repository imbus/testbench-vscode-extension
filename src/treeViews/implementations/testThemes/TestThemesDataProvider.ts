/**
 * @file src/treeViews/implementations/testThemes/TestThemesDataProvider.ts
 * @description Data provider for managing test themes in the tree view.
 */

import { ErrorHandler } from "../../utils/ErrorHandler";
import { PlayServerConnection } from "../../../testBenchConnection";
import { TestStructure } from "../../../testBenchTypes";
import { EventBus } from "../../utils/EventBus";
import { TestBenchLogger } from "../../../testBenchLogger";
import { FrameworkCache } from "../../utils/FrameworkCache";
import { TestThemeItemTypes } from "../../../constants";

/**
 * Data provider for Test Themes tree view
 * Handles all data fetching and caching for test themes
 */
export class TestThemesDataProvider {
    private cache = new FrameworkCache<TestStructure>();

    constructor(
        private logger: TestBenchLogger,
        private errorHandler: ErrorHandler,
        private getConnection: () => PlayServerConnection | null,
        private eventBus: EventBus
    ) {}

    /**
     * Fetch the cycle structure containing test themes
     * @param projectKey - The project key
     * @param cycleKey - The cycle key
     * @returns Promise resolving to TestStructure or null
     */
    public async fetchCycleStructure(projectKey: string, cycleKey: string): Promise<TestStructure | null> {
        const cacheKey = `${projectKey}:${cycleKey}`;

        const cached = this.cache.get(cacheKey);
        if (cached) {
            this.logger.debug(`Using cached structure for ${cacheKey}`);
            return cached;
        }

        const connection = this.getConnection();
        if (!connection) {
            throw new Error("No connection available");
        }

        try {
            this.logger.debug(`Fetching cycle structure for project: ${projectKey}, cycle: ${cycleKey}`);

            const testStructure = await connection.fetchTestStructureOfCycleFromServer(projectKey, cycleKey);

            if (!testStructure) {
                this.logger.warn("No test structure returned from server");
                return null;
            }

            // Validate and normalize the structure
            const normalized = this.normalizeTestStructure(testStructure);

            this.cache.set(cacheKey, normalized);
            this.logger.info(`Successfully fetched test structure with ${normalized.nodes?.length || 0} nodes`);

            return normalized;
        } catch (error) {
            this.logger.error(`Failed to fetch cycle structure for ${cacheKey}:`, error as Error);
            throw error;
        }
    }

    /**
     * Fetch the TOV structure containing test themes
     * @param projectKey - The project key
     * @param tovKey - The TOV key
     * @returns Promise resolving to TestStructure or null
     */
    public async fetchTovStructure(projectKey: string, tovKey: string): Promise<TestStructure | null> {
        const cacheKey = `${projectKey}:tov:${tovKey}`;

        const cached = this.cache.get(cacheKey);
        if (cached) {
            this.logger.debug(`Using cached TOV structure for ${cacheKey}`);
            return cached;
        }

        const connection = this.getConnection();
        if (!connection) {
            throw new Error("No connection available");
        }

        try {
            this.logger.debug(`Fetching TOV structure for project: ${projectKey}, TOV: ${tovKey}`);

            const testStructure = await connection.fetchTestStructureOfTOVFromServer(projectKey, tovKey);

            if (!testStructure) {
                this.logger.warn("No test structure returned from server");
                return null;
            }

            // Validate and normalize the structure
            const normalized = this.normalizeTestStructure(testStructure);

            this.cache.set(cacheKey, normalized);
            this.logger.info(`Successfully fetched TOV structure with ${normalized.nodes?.length || 0} nodes`);

            return normalized;
        } catch (error) {
            this.logger.error(`Failed to fetch TOV structure for ${cacheKey}:`, error as Error);
            throw error;
        }
    }

    /**
     * Clear all cached data
     */
    public clearCache(): void {
        this.cache.clear();
        this.logger.debug("Cleared all cached test structures");
    }

    /**
     * Invalidate the cache for a specific cycle or TOV
     * @param projectKey - The project key
     * @param key - The cycle or TOV key
     * @param isTov - Whether the key is for a TOV
     */
    public invalidateCache(projectKey: string, key: string, isTov: boolean = false): void {
        const cacheKey = isTov ? `${projectKey}:tov:${key}` : `${projectKey}:${key}`;
        this.cache.clear(cacheKey);
        this.logger.debug(`Invalidated cache for ${cacheKey}`);
    }

    /**
     * Normalizes a test structure to ensure consistent format
     * @param structure The raw test structure data
     * @return Normalized TestStructure object
     * @throws Error if structure format is invalid
     */
    private normalizeTestStructure(structure: any): TestStructure {
        // Handle different possible formats of the test structure
        if (!structure || typeof structure !== "object") {
            throw new Error("Invalid test structure format");
        }

        // If the structure already has the expected format
        if (structure.root && structure.nodes && Array.isArray(structure.nodes)) {
            return this.normalizeExistingStructure(structure);
        }

        // Convert old format to new format
        return this.convertOldFormat(structure);
    }

    /**
     * @brief Normalizes an existing test structure with proper format
     * @param structure The test structure with root and nodes
     * @return Normalized TestStructure object
     */
    private normalizeExistingStructure(structure: any): TestStructure {
        const normalized: TestStructure = {
            root: {
                base: {
                    key: structure.root.base.key || "",
                    name: structure.root.base.name || "Root",
                    numbering: structure.root.base.numbering || "",
                    parentKey: structure.root.base.parentKey || "",
                    uniqueID: structure.root.base.uniqueID || "",
                    matchesFilter: structure.root.base.matchesFilter || false
                },
                filters: structure.root.filters || [],
                elementType: structure.root.elementType || "RootNode"
            },
            nodes: structure.nodes.map((node: any) => this.normalizeNode(node))
        };

        return normalized;
    }

    /**
     * @brief Normalizes a single node within the test structure
     * @param node The raw node data
     * @return Normalized node object
     */
    private normalizeNode(node: any): any {
        const normalized = {
            base: {
                key: node.base.key || "",
                name: node.base.name || "",
                numbering: node.base.numbering || "",
                parentKey: node.base.parentKey || "",
                uniqueID: node.base.uniqueID || "",
                matchesFilter: node.base.matchesFilter || false
            },
            spec: {
                key: node.spec?.key || "",
                locker: node.spec?.locker || null,
                status: node.spec?.status || "None"
            },
            aut: {
                key: node.aut?.key || "",
                locker: node.aut?.locker || null,
                status: node.aut?.status || "None"
            },
            exec: node.exec
                ? {
                      status: node.exec.status || "None",
                      execStatus: node.exec.execStatus || "None",
                      verdict: node.exec.verdict || "None",
                      key: node.exec.key || "",
                      locker: node.exec.locker || null
                  }
                : null,
            filters: node.filters || [],
            elementType: node.elementType || TestThemeItemTypes.TEST_THEME
        };

        return normalized;
    }

    /**
     * @brief Converts old format test structure to new normalized format
     * @param structure The old format test structure
     * @return Normalized TestStructure object
     */
    private convertOldFormat(structure: any): TestStructure {
        const normalized: TestStructure = {
            root: {
                base: {
                    key: structure.elementKey || structure.key || "",
                    name: structure.label || structure.name || "Root",
                    numbering: "",
                    parentKey: "",
                    uniqueID: "",
                    matchesFilter: false
                },
                filters: [],
                elementType: "RootNode"
            },
            nodes: []
        };

        // Convert old format to new format
        if (structure.children && Array.isArray(structure.children)) {
            this.flattenTreeToNodes(structure, normalized.nodes);
        }

        return normalized;
    }

    /**
     * @brief Flattens a hierarchical tree structure into a flat array of nodes
     * @param item The current tree item to process
     * @param nodes The array to store flattened nodes
     * @param parentKey Optional parent key for the current item
     */
    private flattenTreeToNodes(item: any, nodes: any[], parentKey?: string): void {
        const node = {
            base: {
                key: item.elementKey || item.key || `node_${Date.now()}_${Math.random()}`,
                name: item.label || item.name || "Unknown",
                numbering: item.numbering || "",
                parentKey: parentKey || "",
                uniqueID: item.uid || "",
                matchesFilter: false
            },
            spec: {
                key: item.spec?.key || "",
                locker: item.spec?.locker || null,
                status: item.spec?.status || "None"
            },
            aut: {
                key: item.aut?.key || "",
                locker: item.aut?.locker || null,
                status: item.aut?.status || "None"
            },
            exec: item.exec
                ? {
                      status: item.exec.status || "None",
                      execStatus: item.exec.execStatus || "None",
                      verdict: item.exec.verdict || "None",
                      key: item.exec.key || "",
                      locker: item.exec.locker || null
                  }
                : null,
            filters: item.filters || [],
            elementType: this.determineElementType(item)
        };

        nodes.push(node);

        // Recursively process children
        if (item.children && Array.isArray(item.children)) {
            item.children.forEach((child: any) => {
                this.flattenTreeToNodes(child, nodes, node.base.key);
            });
        }
    }

    /**
     * @brief Determines the element type based on item properties
     * @param item The item to determine type for
     * @return The determined element type string
     */
    private determineElementType(item: any): string {
        if (item.elementType) {
            return item.elementType;
        }
        if (item.isTestCaseSet) {
            return "TestCaseSetNode";
        }
        if (item.isTestCase) {
            return "TestCaseNode";
        }
        return "TestThemeNode";
    }
}
