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
import { ConfigKeys } from "../../../constants";
import * as vscode from "vscode";

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
    Interaction_key?: { serial: string };
    Condition_key?: { serial: string };
    DataType_key?: { serial: string };
}

export class TestElementsDataProvider {
    private elementsCache = new FrameworkCache<TestElementData[]>();
    private disposables: vscode.Disposable[] = [];

    constructor(
        private logger: TestBenchLogger,
        private getConnection: () => PlayServerConnection | null,
        private eventBus: EventBus
    ) {
        this.setupConfigurationChangeListener();
    }

    /**
     * Sets up a listener for configuration changes to clear cache when resource markers change
     */
    private setupConfigurationChangeListener(): void {
        const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("testbenchExtension.resourceMarker")) {
                this.logger.debug("[TestElementsDataProvider] Resource marker configuration changed, clearing cache");

                const newPatterns = this._getResourceRegexPatternsFromSettings();
                this.logger.debug(
                    `[TestElementsDataProvider] New resource marker patterns: ${JSON.stringify(newPatterns.map((p) => p.source))}`
                );

                this.clearCache();
                this.eventBus.emit({
                    type: "testElements:configurationChanged",
                    source: "testElements",
                    data: {
                        message: "Resource marker configuration changed, cache cleared",
                        newPatterns: newPatterns.map((p) => p.source),
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

        this.logger.debug(
            `[TestElementsDataProvider] Retrieved resource markers from settings: ${JSON.stringify(resourceMarkers)}`
        );

        if (!resourceMarkers || resourceMarkers.length === 0) {
            this.logger.debug("[TestElementsDataProvider] No resource markers configured, returning empty patterns");
            return [];
        }

        const patterns = resourceMarkers.map((marker) => {
            // Escape special regex characters in the marker
            const escaped = marker.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            return new RegExp(escaped);
        });

        this.logger.debug(
            `[TestElementsDataProvider] Generated regex patterns: ${JSON.stringify(patterns.map((p) => p.source))}`
        );
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
            const rawTestElementsData = await connection.getTestElementsWithTovKeyUsingOldPlayServer(tovKey);
            if (!rawTestElementsData || !Array.isArray(rawTestElementsData)) {
                return [];
            }

            const hierarchicalTestElemData = this._buildAndFilterHierarchy(rawTestElementsData);

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
     * @returns Array of root TestElementData objects forming the filtered hierarchy
     */
    private _buildAndFilterHierarchy(flatJsonTestElements: RawTestElement[]): TestElementData[] {
        const testElementIdToDataMap = this._transformRawElements(flatJsonTestElements);
        const { roots } = this._linkParentChildRelationships(testElementIdToDataMap);
        const filteredRoots = this._filterElementTree(roots);
        this._assignHierarchicalNames(filteredRoots);
        this._checkForNestedResources(filteredRoots);

        return filteredRoots;
    }

    /**
     * Converts raw JSON elements to TestElementData objects.
     * @param flatJsonTestElements The raw data from the server.
     * @returns A map of element ID to TestElementData.
     */
    private _transformRawElements(flatJsonTestElements: RawTestElement[]): { [id: string]: TestElementData } {
        const testElementIdToDataMap: { [id: string]: TestElementData } = {};

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

            const currentPatterns = this._getResourceRegexPatternsFromSettings();
            const directRegexMatch =
                currentPatterns.length > 0 ? this._matchesRegex(jsonTestElement.name, currentPatterns) : true;

            if (currentPatterns.length > 0) {
                this.logger.debug(
                    `[TestElementsDataProvider] Element "${jsonTestElement.name}" regex match: ${directRegexMatch} (patterns: ${JSON.stringify(currentPatterns.map((p) => p.source))})`
                );
            }

            const testElement: TestElementData = {
                id: compositeId,
                parentId: parentIdString,
                name: jsonTestElement.name,
                uniqueID: testElementOwnUniqueID,
                libraryKey,
                jsonString: JSON.stringify(jsonTestElement, null, 2),
                details: jsonTestElement || {},
                testElementType: testElementType,
                directRegexMatch: directRegexMatch,
                children: [],
                hierarchicalName: jsonTestElement.name // Will be properly set later
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
        Object.values(testElementIdToDataMap).forEach((testElementData) => {
            if (testElementData.parentId) {
                let foundParentTestElementData: TestElementData | undefined =
                    testElementIdToDataMap[testElementData.parentId];

                // Fallback linking logic for cases where parentId might just be the serial
                if (!foundParentTestElementData && !testElementData.parentId.includes("_")) {
                    const serialToFind = testElementData.parentId;
                    for (const potentialParent of Object.values(testElementIdToDataMap)) {
                        let parentSerialFromDetails: string | undefined;
                        if (potentialParent.details?.Subdivision_key?.serial) {
                            parentSerialFromDetails = String(potentialParent.details.Subdivision_key.serial);
                        } else if (potentialParent.details?.Interaction_key?.serial) {
                            parentSerialFromDetails = String(potentialParent.details.Interaction_key.serial);
                        }

                        if (parentSerialFromDetails === serialToFind) {
                            foundParentTestElementData = potentialParent;
                            break;
                        }
                    }
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
     * Recursively filters the element tree based on regex matches and hierarchy rules.
     * @param roots The root elements of the tree to filter.
     * @returns A new array of filtered root elements.
     */
    private _filterElementTree(roots: TestElementData[]): TestElementData[] {
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
            if (
                testElementData.testElementType === TestElementType.Subdivision &&
                !testElementData.directRegexMatch &&
                inheritedMatch
            ) {
                if (validChildren.length === 0) {
                    return null;
                }
            }
            if (testElementData.directRegexMatch || inheritedMatch || validChildren.length > 0) {
                testElementData.children = validChildren;
                return testElementData;
            }
            return null;
        };

        return roots.map((root) => recursiveFilter(root, false)).filter((node) => node !== null) as TestElementData[];
    }

    /**
     * Recursively assigns a full hierarchical name to each element in the tree.
     * @param roots The root elements of the tree.
     */
    private _assignHierarchicalNames(roots: TestElementData[]): void {
        const assign = (testElementData: TestElementData, parentPath: string): void => {
            const currentPath = parentPath ? `${parentPath}/${testElementData.name}` : testElementData.name;
            testElementData.hierarchicalName = currentPath;
            testElementData.children?.forEach((child) => assign(child, currentPath));
        };
        roots.forEach((rootTestElementData) => assign(rootTestElementData, ""));
    }

    /**
     * Traverses the tree to find and log warnings for nested resource files.
     * @param roots The root elements of the final tree.
     */
    private _checkForNestedResources(roots: TestElementData[]): void {
        const nestedResourceWarnings: string[] = [];
        const check = (testElementData: TestElementData): void => {
            if (testElementData.directRegexMatch) {
                testElementData.children?.forEach((child) => {
                    if (child.directRegexMatch) {
                        nestedResourceWarnings.push(
                            `Robot resource '${testElementData.name}' contains another resource '${child.name}'.`
                        );
                    }
                    check(child);
                });
            } else {
                testElementData.children?.forEach(check);
            }
        };
        roots.forEach(check);
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
        if (item.Interaction_key?.serial) {
            return TestElementType.Interaction;
        }
        if (item.Condition_key?.serial) {
            return TestElementType.Condition;
        }
        if (item.DataType_key?.serial) {
            return TestElementType.DataType;
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
            case TestElementType.Interaction:
            case TestElementType.Condition:
            case TestElementType.DataType: {
                const specificKey = raw[`${elementType}_key`];
                if (specificKey?.serial && raw.uniqueID) {
                    return `${specificKey.serial}_${raw.uniqueID}`;
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
     * Clears the test elements cache for a specific TOV or all TOVs.
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
