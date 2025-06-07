/**
 * @file src/views/testElementsView/testElementTreeBuilder.ts
 * @description Builds a hierarchical tree structure from flat test element data.
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { ConfigKeys } from "../../constants";
import { getExtensionSetting } from "../../configuration";
import { TestElementType, TestElementData } from "./testElementTreeItem";

export class TestElementTreeBuilder {
    private readonly logger: TestBenchLogger;
    private readonly resourceRegexPatterns: RegExp[];

    constructor(logger: TestBenchLogger) {
        this.logger = logger;
        this.resourceRegexPatterns = this.getResourceRegexPatternsFromSettings();
    }

    private getResourceRegexPatternsFromSettings(): RegExp[] {
        const resourceMarkers: string[] | undefined = getExtensionSetting<string[]>(
            ConfigKeys.TB2ROBOT_RESOURCE_MARKER
        );
        if (resourceMarkers === undefined) {
            return [];
        }
        const patterns: RegExp[] = resourceMarkers.map((marker) => {
            // eslint-disable-next-line no-useless-escape
            const escapedResourceMarker = marker.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
            return new RegExp(`(?:.*\\.)?(?<resourceName>[^.]+?)\\s*${escapedResourceMarker}.*`);
        });
        this.logger.trace(
            "[TestElementTreeBuilder] Loaded resource regex patterns:",
            patterns.map((p) => p.source)
        );
        return patterns;
    }

    private matchesRegex(value: string, regexList: RegExp[]): boolean {
        return regexList.some((regex) => regex.test(value));
    }

    private getTestElementType(item: any): TestElementType {
        if (item.Subdivision_key && item.Subdivision_key.serial) {
            return "Subdivision";
        }
        if (item.Interaction_key && item.Interaction_key.serial) {
            return "Interaction";
        }
        if (item.Condition_key && item.Condition_key.serial) {
            return "Condition";
        }
        if (item.DataType_key && item.DataType_key.serial) {
            return "DataType";
        }
        return "Other";
    }

    private getParentId(item: any, libraryKey: string | null | undefined): string | null {
        if (item.parent && item.parent.serial) {
            if (item.parent.uniqueID) {
                return `${item.parent.serial}_${item.parent.uniqueID}`;
            } else {
                /*
                this.logger.warn(
                    `[Builder.getParentId] Parent reference for item (name: ${item.name}, uniqueID: ${item.uniqueID}) is MISSING 'parent.uniqueID'. Parent serial: ${item.parent.serial}. Falling back to using parent serial as parentId.`
                );
                */
                return String(item.parent.serial);
            }
        }
        if (libraryKey) {
            return String(libraryKey);
        }
        return null;
    }

    public generateTestElementTreeItemId(item: any, testElementType: TestElementType, uniqueID: string): string {
        switch (testElementType) {
            case "Subdivision":
            case "Interaction":
            case "Condition":
            case "DataType": {
                const specificKey = item[`${testElementType}_key`];
                if (specificKey && specificKey.serial && uniqueID) {
                    return `${specificKey.serial}_${uniqueID}`;
                }
                this.logger.warn(
                    `[generateTestElementTreeItemId] Test element type ${testElementType} for item ${uniqueID} missing specific key serial.`
                );
                return uniqueID || `fallback_${Date.now()}_${Math.random()}`;
            }
            default:
                return uniqueID || `fallback_other_${Date.now()}_${Math.random()}`;
        }
    }

    /**
     * Transforms a flat list of raw test elements from the server into a hierarchical tree structure.
     */
    public build(flatJsonTestElements: any[]): TestElementData[] {
        this.logger.trace(
            "[TestElementTreeBuilder] Building tree with regex patterns:",
            this.resourceRegexPatterns.map((p) => p.source)
        );
        const testElementIdToDataMap: { [id: string]: TestElementData } = {};

        flatJsonTestElements.forEach((jsonTestElement) => {
            let libraryKey: string | null = null;
            if (jsonTestElement.libraryKey) {
                libraryKey =
                    typeof jsonTestElement.libraryKey === "object" && jsonTestElement.libraryKey.serial
                        ? jsonTestElement.libraryKey.serial
                        : jsonTestElement.libraryKey;
            }

            const testElementType: TestElementType = this.getTestElementType(jsonTestElement);
            const testElementOwnUniqueID = jsonTestElement.uniqueID;
            const compositeId: string = this.generateTestElementTreeItemId(
                jsonTestElement,
                testElementType,
                testElementOwnUniqueID
            );

            const parentIdString: string | null = this.getParentId(jsonTestElement, libraryKey);

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
                        ? this.matchesRegex(jsonTestElement.name, this.resourceRegexPatterns)
                        : true,
                children: []
            };
            testElementIdToDataMap[compositeId] = testElement;
        });

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
                        `[TestElementTreeBuilder] Parent with ID '${testElementData.parentId}' not found for element '${testElementData.name}' (ID: ${testElementData.id}). Making it a root.`
                    );
                    roots.push(testElementData);
                }
            } else {
                roots.push(testElementData);
            }
        });

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

            if (testElementData.testElementType === "DataType" || testElementData.testElementType === "Condition") {
                return null;
            }
            if (
                testElementData.testElementType === "Subdivision" &&
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

        const assignNames = (testElementData: TestElementData, parentPath: string): void => {
            const currentPath = parentPath ? `${parentPath}/${testElementData.name}` : testElementData.name;
            testElementData.hierarchicalName = currentPath;
            testElementData.children?.forEach((child) => assignNames(child, currentPath));
        };
        filteredTestElementDataRoots.forEach((rootTestElementData) => assignNames(rootTestElementData, ""));

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
            this.logger.warn("[TestElementTreeBuilder] Nested robot resources found:", nestedResourceWarnings);
            vscode.window.showWarningMessage(
                `Warning: Nested robot resources found: ${nestedResourceWarnings.join("; ")}. Please review in TestBench Client.`
            );
        }
        return filteredTestElementDataRoots;
    }
}
