/**
 * @file src/treeViews/implementations/testElements/TestElementsDataProvider.ts
 * @description Data provider for managing test elements in the tree view.
 */

import { PlayServerConnection } from "../../../testBenchConnection";
import { TestElementData, TestElementType } from "./TestElementsTreeItem";
import { EventBus } from "../../utils/EventBus";
import { TestBenchLogger } from "../../../testBenchLogger";
import { FrameworkCache } from "../../utils/FrameworkCache";
import { getExtensionSetting } from "../../../configuration";
import { ConfigKeys, TreeViewTiming } from "../../../constants";
import * as vscode from "vscode";
import { ResourceFileService } from "./ResourceFileService";

interface RawTestElement {
    id: string;
    name: string;
    serial?: string;
    uniqueID?: string;
    hierarchicalName: string;
    parent?: { serial: string; uniqueID?: string };
    details?: any;
    libraryKey?: string | { serial: string } | null;
    jsonString?: string;
    type?: string;
    regexMatch?: boolean;
    Subdivision_key?: { serial: string };
    // TODO: API v1 uses Interaction_key for Keywords, Keyword_key is not used yet. Replace API v1 support when no longer needed
    Keyword_key?: { serial: string };
    Interaction_key?: { serial: string };
    Condition_key?: { serial: string };
    DataType_key?: { serial: string };
}

type TestElementsVisibilityMode = "resourceOnly" | "allSubdivisions";

export class TestElementsDataProvider {
    private elementsCache = new FrameworkCache<TestElementData[]>(TreeViewTiming.TREE_DATA_FRESHNESS_THRESHOLD_MS);
    private disposables: vscode.Disposable[] = [];

    constructor(
        private logger: TestBenchLogger,
        private getConnection: () => PlayServerConnection | null,
        private eventBus: EventBus
    ) {
        this.setupConfigurationChangeListener();
    }

    /**
     * Sets up a listener for configuration changes that affect Test Elements filtering.
     * Cache is cleared when marker-based matching or visibility mode changes.
     */
    private setupConfigurationChangeListener(): void {
        const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
            const resourceMarkerChanged = event.affectsConfiguration("testbenchExtension.resourceMarker");
            const visibilityModeChanged = event.affectsConfiguration(
                `testbenchExtension.${ConfigKeys.TEST_ELEMENTS_VISIBILITY_MODE}`
            );

            if (resourceMarkerChanged || visibilityModeChanged) {
                this.logger.debug(
                    "[TestElementsDataProvider] Test Elements filtering configuration changed, clearing cache"
                );

                const newPatterns = this._getResourceRegexPatternsFromSettings();
                const visibilityMode = this.getTestElementsVisibilityMode();
                this.logger.debug(
                    `[TestElementsDataProvider] New resource marker patterns: ${JSON.stringify(newPatterns.map((p) => p.source))}`
                );
                this.logger.debug(`[TestElementsDataProvider] New Test Elements visibility mode: ${visibilityMode}`);

                this.clearFilteredCache();
                this.eventBus.emit({
                    type: "testElements:configurationChanged",
                    source: "testElements",
                    data: {
                        message: "Test Elements filtering configuration changed, cache cleared",
                        newPatterns: newPatterns.map((p) => p.source),
                        visibilityMode,
                        timestamp: Date.now()
                    },
                    timestamp: Date.now()
                });
            }
        });
        this.disposables.push(configChangeDisposable);
    }

    /**
     * Retrieves resource regex patterns from extension settings.
     * This method is now dynamic and will always return the current configuration.
     *
     * @returns {RegExp[]} Array of compiled regex patterns for resource markers.
     */
    private _getResourceRegexPatternsFromSettings(): RegExp[] {
        const resourceMarkers: string[] | undefined = getExtensionSetting<string[]>(
            ConfigKeys.TB2ROBOT_RESOURCE_MARKER
        );

        /*
        this.logger.debug(
            `[TestElementsDataProvider] Retrieved resource markers from settings: ${JSON.stringify(resourceMarkers)}`
        );
        */

        if (!resourceMarkers || resourceMarkers.length === 0) {
            this.logger.debug("[TestElementsDataProvider] No resource markers configured, returning empty patterns");
            return [];
        }

        const patterns = resourceMarkers.map((marker) => {
            // Escape special regex characters in the marker
            const escaped = marker.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            return new RegExp(escaped);
        });

        // this.logger.debug(`[TestElementsDataProvider] Generated regex patterns: ${JSON.stringify(patterns.map((p) => p.source))}`);
        return patterns;
    }

    /**
     * Fetches, builds, and filters the test element hierarchy for a TOV
     *
     * @param tovKey The Test Object Version key
     * @return Promise resolving to hierarchical array of root TestElementData items
     * @throws Error when no connection is available
     */
    public async fetchTestElements(tovKey: string): Promise<TestElementData[]> {
        const connection = this.getConnection();
        if (!connection) {
            throw new Error("No connection available");
        }

        const cachedElements = this.elementsCache.get(tovKey);
        if (cachedElements) {
            this.logger.debug(`[TestElementsDataProvider] Returning cached test elements for TOV: ${tovKey}`);
            return cachedElements;
        }

        try {
            this.logger.debug(`[TestElementsDataProvider] Fetching raw test elements for TOV: ${tovKey}`);
            const rawTestElementsData = await connection.getTestElementsWithTovKeyUsingOldPlayServer(tovKey);
            if (!rawTestElementsData || !Array.isArray(rawTestElementsData)) {
                return [];
            }

            const hierarchicalTestElemData = await this._buildAndFilterHierarchy(rawTestElementsData);

            this.elementsCache.set(tovKey, hierarchicalTestElemData);
            this.eventBus.emit({
                type: "testElements:fetched",
                source: "testElements",
                data: { tovKey, count: hierarchicalTestElemData.length },
                timestamp: Date.now()
            });

            return hierarchicalTestElemData;
        } catch (error) {
            this.logger.error(`[TestElementsDataProvider] Failed to fetch test elements for TOV key ${tovKey}:`, error);
            this.eventBus.emit({
                type: "testElements:error",
                source: "testElements",
                data: { tovKey, error: error instanceof Error ? error.message : "Unknown error" },
                timestamp: Date.now()
            });
            throw error;
        }
    }

    /**
     * Orchestrates the transformation of flat test element data into a filtered hierarchy.
     * @param flatJsonTestElements - Array of raw test element data from the server
     * @returns Promise resolving to array of root TestElementData objects forming the filtered hierarchy
     */
    private async _buildAndFilterHierarchy(flatJsonTestElements: RawTestElement[]): Promise<TestElementData[]> {
        const testElementIdToDataMap = this._transformRawElements(flatJsonTestElements);
        const { roots } = this._linkParentChildRelationships(testElementIdToDataMap);
        const filteredRoots = this._filterElementTree(roots);
        this._finalizeFilteredTree(filteredRoots);

        return filteredRoots;
    }

    /**
     * Converts raw JSON elements to TestElementData objects.
     * @param flatJsonTestElements The raw data from the server.
     * @returns A map of element ID to TestElementData.
     */
    private _transformRawElements(flatJsonTestElements: RawTestElement[]): { [id: string]: TestElementData } {
        const testElementIdToDataMap: { [id: string]: TestElementData } = {};
        const currentPatterns = this._getResourceRegexPatternsFromSettings();

        flatJsonTestElements.forEach((jsonTestElement) => {
            let libraryKey: string | null = null;
            if (jsonTestElement.libraryKey) {
                libraryKey =
                    typeof jsonTestElement.libraryKey === "object" && jsonTestElement.libraryKey.serial
                        ? jsonTestElement.libraryKey.serial
                        : String(jsonTestElement.libraryKey);
            }

            const testElementType: TestElementType = this._getTestElementType(jsonTestElement);
            const testElementOwnUniqueID = jsonTestElement.uniqueID || "";
            const compositeId: string = this._generateElementId(jsonTestElement);
            const parentIdString: string | null = this._getParentId(jsonTestElement);

            const directRegexMatch =
                currentPatterns.length > 0 ? this._matchesRegex(jsonTestElement.name, currentPatterns) : true;

            /*
            if (currentPatterns.length > 0) {
                this.logger.debug(`[TestElementsDataProvider] Element "${jsonTestElement.name}" regex match: ${directRegexMatch} (patterns: ${JSON.stringify(currentPatterns.map((p) => p.source))})`);
            }
            */

            const originalName = jsonTestElement.name;
            const normalizedName = ResourceFileService.normalizePath(originalName);

            const testElement: TestElementData = {
                id: compositeId,
                parentId: parentIdString,
                displayName: normalizedName,
                originalName: originalName,
                uniqueID: testElementOwnUniqueID,
                libraryKey,
                jsonString: jsonTestElement.jsonString,
                details: jsonTestElement || {},
                testElementType: testElementType,
                directRegexMatch: directRegexMatch,
                children: [],
                hierarchicalName: normalizedName // Will be set later
            };
            testElementIdToDataMap[compositeId] = testElement;
        });

        return testElementIdToDataMap;
    }

    /**
     * Establishes parent-child relationships from a map of elements.
     * @param testElementIdToDataMap A map of all available elements.
     * @returns An object containing the map and an array of root elements.
     */
    private _linkParentChildRelationships(testElementIdToDataMap: { [id: string]: TestElementData }): {
        roots: TestElementData[];
        map: { [id: string]: TestElementData };
    } {
        const roots: TestElementData[] = [];
        const testElements = Object.values(testElementIdToDataMap);
        const serialToElementMap = new Map<string, TestElementData>();

        for (const element of testElements) {
            const serial = this._extractElementSerialFromDetails(element);
            if (serial && !serialToElementMap.has(serial)) {
                serialToElementMap.set(serial, element);
            }
        }

        testElements.forEach((testElementData) => {
            if (testElementData.parentId) {
                let foundParentTestElementData: TestElementData | undefined =
                    testElementIdToDataMap[testElementData.parentId];

                // Fallback linking logic for cases where parentId might just be the serial
                if (!foundParentTestElementData && !testElementData.parentId.includes("_")) {
                    foundParentTestElementData = serialToElementMap.get(testElementData.parentId);
                }

                if (foundParentTestElementData) {
                    testElementData.parent = foundParentTestElementData;
                    foundParentTestElementData.children!.push(testElementData);
                } else {
                    roots.push(testElementData);
                }
            } else {
                roots.push(testElementData);
            }
        });
        return { roots, map: testElementIdToDataMap };
    }

    /**
     * Extracts the serial from element details for fallback parent linking.
     * @param testElementData The element to inspect.
     * @returns The element serial if available.
     */
    private _extractElementSerialFromDetails(testElementData: TestElementData): string | undefined {
        if (testElementData.details?.Subdivision_key?.serial) {
            return String(testElementData.details.Subdivision_key.serial);
        }
        if (testElementData.details?.Keyword_key?.serial) {
            return String(testElementData.details.Keyword_key.serial);
        }
        if (testElementData.details?.Interaction_key?.serial) {
            // Note: Interaction was renamed to keyword in GUI but Interaction_key is used in API v1 for keywords.
            return String(testElementData.details.Interaction_key.serial);
        }
        return undefined;
    }

    /**
     * Recursively filters the element tree items.
     * Rules:
     * - Filter out empty subdivisions, DataTypes and Conditions.
     * - Include Subdivision if:
     *       Subdivision name matches resource marker defined in extension settings
     *       OR a child subdivision tree item has a resource marker match.
     * - Include Keyword if:
     *       The direct parent subdivision has a resource directory match.
     * @param rootsToFilter The root elements of the unfiltered test elements tree to filter.
     * @returns A new array of filtered root elements.
     */
    private _filterElementTree(rootsToFilter: TestElementData[]): TestElementData[] {
        const visibilityMode = this.getTestElementsVisibilityMode();

        const recursiveFilter = (testElementData: TestElementData, inheritedMatch: boolean): TestElementData | null => {
            let validChildren: TestElementData[] = [];
            if (testElementData.children) {
                const childrenInherit: boolean = inheritedMatch || testElementData.directRegexMatch;
                validChildren = testElementData.children
                    .map((child) => recursiveFilter(child, childrenInherit))
                    .filter((child) => child !== null) as TestElementData[];
            }

            if (
                testElementData.testElementType === TestElementType.DataType ||
                testElementData.testElementType === TestElementType.Condition
            ) {
                return null;
            }

            const shouldIncludeCurrentNode =
                visibilityMode === "allSubdivisions"
                    ? true
                    : this.shouldIncludeInResourceOnlyMode(testElementData, inheritedMatch, validChildren.length);

            if (shouldIncludeCurrentNode || validChildren.length > 0) {
                testElementData.children = validChildren;
                return testElementData;
            }

            return null;
        };

        return rootsToFilter
            .map((root) => recursiveFilter(root, false))
            .filter((node) => node !== null) as TestElementData[];
    }

    /**
     * Returns the configured Test Elements visibility mode.
     * Falls back to "resourceOnly" for missing or invalid values.
     */
    private getTestElementsVisibilityMode(): TestElementsVisibilityMode {
        const configuredMode = getExtensionSetting<string>(ConfigKeys.TEST_ELEMENTS_VISIBILITY_MODE);
        if (configuredMode === "allSubdivisions" || configuredMode === "resourceOnly") {
            return configuredMode;
        }

        if (configuredMode && configuredMode.trim().length > 0) {
            this.logger.warn(
                `[TestElementsDataProvider] Unknown visibility mode '${configuredMode}'. Falling back to 'resourceOnly'.`
            );
        }

        return "resourceOnly";
    }

    /**
     * Resource-only filtering behavior used by the default Test Elements mode.
     * Keeps subdivisions/keywords visible only when they match resource markers,
     * are descendants of matched nodes, or have matched descendants.
     */
    private shouldIncludeInResourceOnlyMode(
        testElementData: TestElementData,
        inheritedMatch: boolean,
        validChildrenCount: number
    ): boolean {
        if (
            testElementData.testElementType === TestElementType.Subdivision &&
            !testElementData.directRegexMatch &&
            inheritedMatch &&
            validChildrenCount === 0
        ) {
            return false;
        }

        return testElementData.directRegexMatch || inheritedMatch || validChildrenCount > 0;
    }

    /**
     * Performs post-filter tree finalization by traversing the filtered tree.
     *
     * Traversal assigns hierarchical names, computes virtual folder markers,
     * and gathers nested resource warnings.
     *
     * @param roots The filtered root elements.
     */
    private _finalizeFilteredTree(roots: TestElementData[]): void {
        const resourceDirectoryMarker =
            getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_DIRECTORY_MARKER) || "";
        const nestedResourceWarnings: string[] = [];

        /**
         * Resource information computed for a processed subtree.
         * - containsResourceSubdivision: whether this subtree contains any resource subdivision.
         * - firstResourceBoundaryDepth: first boundary depth encountered in this subtree,
         *   used to derive virtual-folder status for ancestor subdivisions.
         */
        type SubtreeResourceAnalysis = {
            containsResourceSubdivision: boolean;
            firstResourceBoundaryDepth: number | null;
        };

        /**
         * Resolves the virtual-folder boundary depth for a resource path.
         * If no marker is configured (or no marker is found in the path), returns null,
         * which means ancestor subdivisions should stay virtual.
         *
         * @param pathParts Path segments of the current resource subdivision.
         * @returns Boundary depth (root level is 1), or null if boundary is not defined.
         */
        const resolveVirtualBoundaryDepth = (pathParts: string[]): number | null => {
            if (!resourceDirectoryMarker) {
                return null;
            }

            const markerPosition = ResourceFileService.findResourceDirectoryMarkerIndex(
                pathParts,
                resourceDirectoryMarker
            );
            if (markerPosition !== -1) {
                return markerPosition + 1;
            }

            return null;
        };

        /**
         * Finalizes one node subtree in depth first order.
         *
         * 1) assign hierarchicalName based on parent path and current display name
         * 2) detect nested resource warnings
         * 3) compute hasResourceDescendant
         * 4) compute isVirtual for non-resource subdivisions with resource descendants
         * 5) return subtree resource analysis for parent computation
         *
         * @param node The current node being processed.
         * @param parentPath The hierarchical path of the parent node.
         * @param currentDepth Depth of the current node in the hierarchy (root level is 1).
         * @param parentIsResource A boolean indicating if the parent node is a resource.
         * @returns Subtree resource analysis used by parent recursion level.
         */
        const finalizeNodeSubtree = (
            node: TestElementData,
            parentPath: string,
            currentDepth: number,
            parentIsResource: boolean
        ): SubtreeResourceAnalysis => {
            const currentPath = parentPath ? `${parentPath}/${node.displayName}` : node.displayName;
            node.hierarchicalName = currentPath;

            const isSubdivision = node.testElementType === TestElementType.Subdivision;
            const isResource = node.directRegexMatch;

            if (parentIsResource && isResource) {
                nestedResourceWarnings.push(
                    `Robot resource '${node.parent?.displayName ?? "Unknown"}' contains another resource '${node.displayName}'.`
                );
            }

            let hasResourceSubdivisionInChildren = false;
            let firstResourceBoundaryDepthFromChildren: number | null = null;

            for (const child of node.children || []) {
                const childSubtreeAnalysis = finalizeNodeSubtree(child, currentPath, currentDepth + 1, isResource);
                if (childSubtreeAnalysis.containsResourceSubdivision) {
                    hasResourceSubdivisionInChildren = true;
                    if (firstResourceBoundaryDepthFromChildren === null) {
                        // Keep the first boundary discovered in DFS order for deterministic behavior.
                        firstResourceBoundaryDepthFromChildren = childSubtreeAnalysis.firstResourceBoundaryDepth;
                    }
                }
            }

            if (isSubdivision) {
                node.hasResourceDescendant = hasResourceSubdivisionInChildren;
            }

            if (isSubdivision && isResource) {
                node.hasResourceDescendant = true;
                return {
                    containsResourceSubdivision: true,
                    firstResourceBoundaryDepth: resolveVirtualBoundaryDepth(currentPath.split("/"))
                };
            }

            if (isSubdivision && hasResourceSubdivisionInChildren) {
                const boundaryDepth = firstResourceBoundaryDepthFromChildren;
                // Without a boundary, all ancestors remain virtual (legacy behavior).
                node.isVirtual = boundaryDepth === null ? true : currentDepth <= boundaryDepth;

                return {
                    containsResourceSubdivision: true,
                    firstResourceBoundaryDepth: firstResourceBoundaryDepthFromChildren
                };
            }

            return {
                containsResourceSubdivision: hasResourceSubdivisionInChildren,
                firstResourceBoundaryDepth: firstResourceBoundaryDepthFromChildren
            };
        };

        roots.forEach((rootNode) => finalizeNodeSubtree(rootNode, "", 1, false));

        if (nestedResourceWarnings.length > 0) {
            this.logger.warn("[TestElementsDataProvider] Nested robot resources found:", nestedResourceWarnings);
        }
    }

    /**
     * Checks if a value matches any regex pattern in the provided list.
     * @param value The string value to test against the regex patterns.
     * @param regexList Array of regular expressions to test against.
     * @returns True if the value matches any regex pattern, false otherwise.
     */
    private _matchesRegex(value: string, regexList: RegExp[]): boolean {
        return regexList.some((regex) => regex.test(value));
    }

    /**
     * Determines the test element type based on the presence of specific keys.
     * @param item The raw test element to analyze.
     * @returns The determined TestElementType.
     */
    private _getTestElementType(item: RawTestElement): TestElementType {
        if (item.Subdivision_key?.serial) {
            return TestElementType.Subdivision;
        }
        // TODO: Replace API v1 support when no longer needed;
        // API v1 uses Interaction_key for Keywords, Keyword_key is not used.
        if (item.Keyword_key?.serial || item.Interaction_key?.serial) {
            if (this.logger.isLevelEnabled("Trace")) {
                this.logger.trace(
                    `[TestElementsDataProvider] Identified element "${item.name}" as Keyword (Keyword_key: ${!!item.Keyword_key?.serial}, Interaction_key: ${!!item.Interaction_key?.serial})`
                );
            }
            return TestElementType.Keyword;
        }
        if (item.Condition_key?.serial) {
            return TestElementType.Condition;
        }
        if (item.DataType_key?.serial) {
            return TestElementType.DataType;
        }
        if (this.logger.isLevelEnabled("Trace")) {
            this.logger.trace(
                `[TestElementsDataProvider] Element "${item.name}" could not be typed (no matching key found), defaulting to Other`
            );
        }
        return TestElementType.Other;
    }

    /**
     * Generates a unique element ID for a test element.
     * @param raw The raw test element data.
     * @returns A unique string identifier for the element.
     */
    private _generateElementId(raw: RawTestElement): string {
        const elementType = this._getTestElementType(raw);
        switch (elementType) {
            case TestElementType.Subdivision:
            case TestElementType.Condition:
            case TestElementType.DataType: {
                const keyFieldMap: Record<string, string> = {
                    [TestElementType.Subdivision]: "Subdivision_key",
                    [TestElementType.Condition]: "Condition_key",
                    [TestElementType.DataType]: "DataType_key"
                };
                const keyField = keyFieldMap[elementType];
                const specificKey = raw[keyField as keyof RawTestElement] as { serial: string } | undefined;
                if (specificKey?.serial && raw.uniqueID) {
                    return `${specificKey.serial}_${raw.uniqueID}`;
                }
                this.logger.warn(
                    `[TestElementsDataProvider] Test element tree item with UID ${raw.uniqueID} and type ${elementType} is missing specific key serial.`
                );
                return raw.uniqueID || `fallback_${Date.now()}_${Math.random()}`;
            }
            case TestElementType.Keyword: {
                // Check both Keyword_key and Interaction_key (API v1)
                const keywordKey = raw.Keyword_key || raw.Interaction_key;
                if (keywordKey?.serial && raw.uniqueID) {
                    return `${keywordKey.serial}_${raw.uniqueID}`;
                }
                this.logger.warn(
                    `[TestElementsDataProvider] Test element tree item with UID ${raw.uniqueID} and type ${elementType} is missing specific key serial.`
                );
                return raw.uniqueID || `fallback_${Date.now()}_${Math.random()}`;
            }
            default:
                return raw.uniqueID || `fallback_other_${Date.now()}_${Math.random()}`;
        }
    }

    /**
     * Extracts the parent ID from a raw test element.
     * @param raw The raw test element data.
     * @returns The parent ID as a string, or null if no parent exists.
     */
    private _getParentId(raw: RawTestElement): string | null {
        if (raw.parent?.uniqueID && raw.parent.serial) {
            return `${raw.parent.serial}_${raw.parent.uniqueID}`;
        }
        if (raw.parent?.serial && raw.parent.serial !== "0") {
            return String(raw.parent.serial);
        }
        return null;
    }

    /**
     * Clears the filtered test elements cache for a specific TOV or all TOVs.
     * @param tovKey Optional TOV key to clear cache for. If not provided, clears all cache.
     */
    public clearCache(tovKey?: string): void {
        if (tovKey) {
            this.elementsCache.clear(tovKey);
        } else {
            this.elementsCache.clear();
        }
    }

    /**
     * Clears only the filtered elements cache, keeping the raw data from the server.
     * Useful when only the visibility configuration changes.
     * @param tovKey Optional TOV key to clear cache for. If not provided, clears all filtered cache.
     */
    public clearFilteredCache(tovKey?: string): void {
        if (tovKey) {
            this.elementsCache.clear(tovKey);
        } else {
            this.elementsCache.clear();
        }
    }

    /**
     * Cleans up resources and disposes of configuration listeners
     */
    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
        this.clearCache();
    }
}
