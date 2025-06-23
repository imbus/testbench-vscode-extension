/**
 * @file src/treeViews/implementations/testElements/TestElementsDataProvider.ts
 * @description Data provider for managing test elements in the tree view.
 */

import { ErrorHandler } from "../../utils/ErrorHandler";
import { PlayServerConnection } from "../../../testBenchConnection";
import { TestElementData, TestElementType } from "./TestElementsTreeItem";
import { EventBus } from "../../utils/EventBus";
import { TestBenchLogger } from "../../../testBenchLogger";
import { FrameworkCache } from "../../utils/FrameworkCache";
import { getExtensionSetting } from "../../../configuration";
import { ConfigKeys } from "../../../constants";

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
    private readonly resourceRegexPatterns: RegExp[];

    constructor(
        private logger: TestBenchLogger,
        private errorHandler: ErrorHandler,
        private getConnection: () => PlayServerConnection | null,
        private eventBus: EventBus
    ) {
        this.resourceRegexPatterns = this._getResourceRegexPatternsFromSettings();
    }

    /**
     * Retrieves resource regex patterns from extension settings.
     *
     * @returns {RegExp[]} Array of compiled regex patterns for resource markers.
     */
    private _getResourceRegexPatternsFromSettings(): RegExp[] {
        const resourceMarkers: string[] | undefined = getExtensionSetting<string[]>(
            ConfigKeys.TB2ROBOT_RESOURCE_MARKER
        );
        if (!resourceMarkers) {
            return [];
        }
        return resourceMarkers.map((marker) => {
            const escaped = marker.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            return new RegExp(`(?:.*\\.)?(?<resourceName>[^.]+?)\\s*${escaped}.*`);
        });
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
            this.logger.debug(`Returning cached test elements for TOV: ${tovKey}`);
            return cachedElements;
        }

        try {
            this.logger.debug(`Fetching raw test elements for TOV: ${tovKey}`);
            const rawTestElementsData = await connection.getTestElementsWithTovKeyUsingOldPlayServer(tovKey);

            if (!rawTestElementsData || !Array.isArray(rawTestElementsData)) {
                this.logger.warn(`No test elements returned for TOV: ${tovKey}`);
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

            this.logger.info(
                `Successfully built and filtered tree with ${hierarchicalTestElemData.length} root elements for TOV: ${tovKey}`
            );
            return hierarchicalTestElemData;
        } catch (error) {
            this.logger.error(`Failed to fetch test elements for TOV ${tovKey}:`, error);
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
     * Transforms flat test element data into a hierarchical structure with filtering.
     *
     * Performs these transformations:
     * 1. Converts raw JSON elements to TestElementData objects
     * 2. Establishes parent-child relationships
     * 3. Filters elements based on regex patterns and hierarchy rules
     * 4. Assigns hierarchical names to all elements
     * 5. Detects and warns about nested resource files
     *   (A resorce file cannot contain another resource file, but in TestBench client, its possible to create such a structure)
     *
     * @param flatJsonTestElements - Array of raw test element data from the server
     * @returns Array of root TestElementData objects forming the filtered hierarchy
     */
    private _buildAndFilterHierarchy(flatJsonTestElements: RawTestElement[]): TestElementData[] {
        this.logger.trace(
            "[TestElementsDataProvider] Building tree with regex patterns:",
            this.resourceRegexPatterns.map((p) => p.source)
        );
        const testElementIdToDataMap: { [id: string]: TestElementData } = {};

        // Transform all raw items into TestElementData
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

            const testElement: TestElementData = {
                id: compositeId, // Test element's own composite ID used as key in map
                parentId: parentIdString,
                name: jsonTestElement.name,
                uniqueID: testElementOwnUniqueID,
                libraryKey,
                jsonString: JSON.stringify(jsonTestElement, null, 2),
                details: jsonTestElement || {},
                testElementType: testElementType,
                directRegexMatch:
                    this.resourceRegexPatterns.length > 0
                        ? this._matchesRegex(jsonTestElement.name, this.resourceRegexPatterns)
                        : true,
                children: [],
                hierarchicalName: jsonTestElement.name
            };
            testElementIdToDataMap[compositeId] = testElement;
        });

        // Link children to parents
        const roots: TestElementData[] = [];
        Object.values(testElementIdToDataMap).forEach((testElementData) => {
            if (testElementData.parentId) {
                let foundParentTestElementData: TestElementData | undefined =
                    testElementIdToDataMap[testElementData.parentId];

                if (
                    !foundParentTestElementData &&
                    testElementData.parentId &&
                    !testElementData.parentId.includes("_")
                ) {
                    const serialToFind = testElementData.parentId;
                    /*
                    this.logger.trace(
                        `[Builder] Attempting fallback link for child '${testElementData.name}' (ID: ${testElementData.id}) using parent serial: '${serialToFind}'`
                    );
                    */

                    for (const potentialParent of Object.values(testElementIdToDataMap)) {
                        let parentSerialFromDetails: string | undefined;
                        if (potentialParent.details?.Subdivision_key?.serial) {
                            parentSerialFromDetails = String(potentialParent.details.Subdivision_key.serial);
                        } else if (potentialParent.details?.Interaction_key?.serial) {
                            parentSerialFromDetails = String(potentialParent.details.Interaction_key.serial);
                        }

                        if (parentSerialFromDetails === serialToFind) {
                            foundParentTestElementData = potentialParent;
                            /*
                            this.logger.trace(
                                `[Builder] Fallback link successful for child '${testElementData.name}' to parent '${foundParentTestElementData.name}' (ID: ${foundParentTestElementData.id}) via serial '${serialToFind}'`
                            );
                            */
                            break;
                        }
                    }
                }

                if (foundParentTestElementData) {
                    testElementData.parent = foundParentTestElementData;
                    foundParentTestElementData.children!.push(testElementData);
                } else {
                    this.logger.warn(
                        `[TestElementsDataProvider] Parent with ID '${testElementData.parentId}' not found for element '${testElementData.name}' (ID: ${testElementData.id}). Making it a root.`
                    );
                    roots.push(testElementData);
                }
            } else {
                roots.push(testElementData);
            }
        });

        // Filter and build hierarchy
        const filterAndBuildHierarchy = (
            testElementData: TestElementData,
            inheritedMatch: boolean
        ): TestElementData | null => {
            let validChildren: TestElementData[] = [];
            if (testElementData.children) {
                const childrenInherit: boolean = inheritedMatch || testElementData.directRegexMatch;
                validChildren = testElementData.children
                    .map((child) => filterAndBuildHierarchy(child, childrenInherit))
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

        const filteredTestElementDataRoots = roots
            .map((root) => filterAndBuildHierarchy(root, false))
            .filter((node) => node !== null) as TestElementData[];

        // Assign hierarchical names
        const assignNames = (testElementData: TestElementData, parentPath: string): void => {
            const currentPath = parentPath ? `${parentPath}/${testElementData.name}` : testElementData.name;
            testElementData.hierarchicalName = currentPath;
            testElementData.children?.forEach((child) => assignNames(child, currentPath));
        };
        filteredTestElementDataRoots.forEach((rootTestElementData) => assignNames(rootTestElementData, ""));

        // Check for nested resources and warn
        const nestedResourceWarnings: string[] = [];
        const checkNested = (testElementData: TestElementData): void => {
            if (testElementData.directRegexMatch) {
                testElementData.children?.forEach((child) => {
                    if (child.directRegexMatch) {
                        nestedResourceWarnings.push(
                            `Robot resource '${testElementData.name}' contains another resource '${child.name}'.`
                        );
                    }
                    checkNested(child);
                });
            } else {
                testElementData.children?.forEach(checkNested);
            }
        };
        filteredTestElementDataRoots.forEach(checkNested);
        if (nestedResourceWarnings.length > 0) {
            this.logger.warn("[TestElementsDataProvider] Nested robot resources found:", nestedResourceWarnings);
        }

        return filteredTestElementDataRoots;
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
                    `[generateElementId] Test element type ${elementType} for item ${raw.uniqueID} missing specific key serial.`
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
            this.logger.debug(`Cleared cache for TOV: ${tovKey}`);
        } else {
            this.elementsCache.clear();
            this.logger.debug("Cleared all test elements cache");
        }
    }
}
