/**
 * @file src/treeViews/implementations/testThemes/TestThemesDataProvider.ts
 * @description Data provider for managing test themes in the tree view.
 */

import { PlayServerConnection } from "../../../testBenchConnection";
import { TestStructure } from "../../../testBenchTypes";
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
        private getConnection: () => PlayServerConnection | null
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
            return cached;
        }

        const connection = this.getConnection();
        if (!connection) {
            this.logger.error("[TestThemesDataProvider] No connection available when fetching cycle structure");
            return null;
        }

        try {
            const testStructure = await connection.fetchTestStructureOfCycleFromServer(projectKey, cycleKey);
            if (!testStructure) {
                return null;
            }

            // Validate and normalize the structure
            const normalizedTestStructure = this.normalizeTestStructure(testStructure);
            if (!normalizedTestStructure) {
                return null;
            }

            this.cache.set(cacheKey, normalizedTestStructure);
            this.logger.trace(
                `[TestThemesDataProvider] Successfully fetched test structure with ${normalizedTestStructure.nodes?.length || 0} nodes`
            );

            return normalizedTestStructure;
        } catch (error) {
            this.logger.error(
                `[TestThemesDataProvider] Failed to fetch cycle structure for project key ${projectKey} and cycle key ${cycleKey}:`,
                error as Error
            );
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
            return cached;
        }

        const connection = this.getConnection();
        if (!connection) {
            this.logger.error("[TestThemesDataProvider] No connection available when fetching TOV structure");
            return null;
        }

        try {
            const testStructure = await connection.fetchTestStructureOfTOVFromServer(projectKey, tovKey);

            if (!testStructure) {
                return null;
            }

            // Validate and normalize the structure
            const normalizedTestStructure = this.normalizeTestStructure(testStructure);
            if (!normalizedTestStructure) {
                return null;
            }

            this.cache.set(cacheKey, normalizedTestStructure);
            this.logger.debug(
                `[TestThemesDataProvider] Successfully fetched TOV structure with ${normalizedTestStructure.nodes?.length || 0} nodes`
            );

            return normalizedTestStructure;
        } catch (error) {
            this.logger.error(
                `[TestThemesDataProvider] Failed to fetch TOV structure for project key ${projectKey} and TOV key ${tovKey}:`,
                error as Error
            );
            throw error;
        }
    }

    /**
     * Clear all cached data
     */
    public clearCache(): void {
        this.cache.clear();
        this.logger.trace("[TestThemesDataProvider] Cleared all cached test structures");
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
        this.logger.trace(`[TestThemesDataProvider] Invalidated cache for ${cacheKey}`);
    }

    /**
     * Normalizes a test structure to ensure consistent format
     * @param structure The raw test structure data
     * @return Normalized TestStructure object
     * @throws Error if structure format is invalid
     */
    private normalizeTestStructure(structure: any): TestStructure | null {
        // Handle different possible formats of the test structure
        if (!structure || typeof structure !== "object") {
            this.logger.error(`[TestThemesDataProvider] Invalid test structure format`);
            return null;
        }

        // If the structure already has the expected format
        if (structure.root && structure.nodes && Array.isArray(structure.nodes)) {
            return this.normalizeExistingStructure(structure);
        }

        return this.formatTestStructure(structure);
    }

    /**
     * Normalizes an existing test structure with proper format
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
     * Normalizes a single node within the test structure
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
     * Formats test structure to contain the proper fields.
     * @param structure The test structure to format
     * @return Formatted TestStructure object
     */
    private formatTestStructure(structure: any): TestStructure {
        const formatted: TestStructure = {
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

        if (structure.children && Array.isArray(structure.children)) {
            this.flattenTreeToNodes(structure, formatted.nodes);
        }

        return formatted;
    }

    /**
     * Flattens a hierarchical tree structure into a flat array of nodes
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
     * Determines the element type based on item properties
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
