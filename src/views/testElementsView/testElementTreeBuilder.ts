/**
 * @file src/views/testElementsView/testElementTreeBuilder.ts
 * @description Builds a hierarchical tree structure from flat test element data.
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { TestElementData, TestElementType } from "./testElementsTreeView";
import { ConfigKeys } from "../../constants";
import { getExtensionSetting } from "../../configuration";

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

    private getElementType(item: any): TestElementType {
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
                this.logger.warn(
                    `[Builder.getParentId] Parent reference for item (name: ${item.name}, uniqueID: ${item.uniqueID}) is MISSING 'parent.uniqueID'. Parent serial: ${item.parent.serial}. This WILL cause linking failure if parent ID in map is composite. Treating as unparented for robust linking.`
                );
                return null;
            }
        }
        if (libraryKey) {
            return String(libraryKey);
        }
        return null;
    }

    public generateTestElementTreeItemId(item: any, elementType: TestElementType, uniqueID: string): string {
        switch (elementType) {
            case "Subdivision":
            case "Interaction":
            case "Condition":
            case "DataType": {
                const specificKey = item[`${elementType}_key`];
                if (specificKey && specificKey.serial && uniqueID) {
                    return `${specificKey.serial}_${uniqueID}`;
                }
                this.logger.warn(
                    `[generateTestElementTreeItemId] Element type ${elementType} for item ${uniqueID} missing specific key serial.`
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
        const elementIdToDataMap: { [id: string]: TestElementData } = {};

        flatJsonTestElements.forEach((jsonTestElement) => {
            let libraryKey: string | null = null;
            if (jsonTestElement.libraryKey) {
                libraryKey =
                    typeof jsonTestElement.libraryKey === "object" && jsonTestElement.libraryKey.serial
                        ? jsonTestElement.libraryKey.serial
                        : jsonTestElement.libraryKey;
            }

            const elementType: TestElementType = this.getElementType(jsonTestElement);
            const elementOwnUniqueID = jsonTestElement.uniqueID;
            const compositeId: string = this.generateTestElementTreeItemId(
                jsonTestElement,
                elementType,
                elementOwnUniqueID
            );

            const parentIdString: string | null = this.getParentId(jsonTestElement, libraryKey);

            const testElement: TestElementData = {
                id: compositeId, // Element's own composite ID used as key in map
                parentId: parentIdString,
                name: jsonTestElement.name,
                uniqueID: elementOwnUniqueID,
                libraryKey,
                jsonString: JSON.stringify(jsonTestElement, null, 2),
                details: jsonTestElement,
                elementType: elementType,
                directRegexMatch:
                    this.resourceRegexPatterns.length > 0
                        ? this.matchesRegex(jsonTestElement.name, this.resourceRegexPatterns)
                        : true,
                children: []
            };
            elementIdToDataMap[compositeId] = testElement;
        });

        const roots: TestElementData[] = [];
        Object.values(elementIdToDataMap).forEach((testElement) => {
            if (testElement.parentId) {
                let foundParentElement: TestElementData | undefined = elementIdToDataMap[testElement.parentId];

                if (!foundParentElement && testElement.parentId && !testElement.parentId.includes("_")) {
                    const serialToFind = testElement.parentId;
                    this.logger.trace(
                        `[Builder] Attempting fallback link for child '${testElement.name}' (ID: ${testElement.id}) using parent serial: '${serialToFind}'`
                    );

                    for (const potentialParent of Object.values(elementIdToDataMap)) {
                        let parentSerialFromDetails: string | undefined;
                        if (potentialParent.details?.Subdivision_key?.serial) {
                            parentSerialFromDetails = String(potentialParent.details.Subdivision_key.serial);
                        } else if (potentialParent.details?.Interaction_key?.serial) {
                            parentSerialFromDetails = String(potentialParent.details.Interaction_key.serial);
                        }

                        if (parentSerialFromDetails === serialToFind) {
                            foundParentElement = potentialParent;
                            this.logger.trace(
                                `[Builder] Fallback link successful for child '${testElement.name}' to parent '${foundParentElement.name}' (ID: ${foundParentElement.id}) via serial '${serialToFind}'`
                            );
                            break;
                        }
                    }
                }

                if (foundParentElement) {
                    testElement.parent = foundParentElement;
                    foundParentElement.children!.push(testElement);
                } else {
                    this.logger.warn(
                        `[TestElementTreeBuilder] Parent with ID '${testElement.parentId}' not found for element '${testElement.name}' (ID: ${testElement.id}). Making it a root.`
                    );
                    roots.push(testElement);
                }
            } else {
                roots.push(testElement);
            }
        });

        const filterAndBuildHierarchy = (element: TestElementData, inheritedMatch: boolean): TestElementData | null => {
            let validChildren: TestElementData[] = [];
            if (element.children) {
                const childrenInherit: boolean = inheritedMatch || element.directRegexMatch;
                validChildren = element.children
                    .map((child) => filterAndBuildHierarchy(child, childrenInherit))
                    .filter((child) => child !== null) as TestElementData[];
            }

            if (element.elementType === "DataType" || element.elementType === "Condition") {
                return null;
            }
            if (element.elementType === "Subdivision" && !element.directRegexMatch && inheritedMatch) {
                return null;
            }
            if (element.directRegexMatch || inheritedMatch || validChildren.length > 0) {
                //
                element.children = validChildren;
                return element;
            }
            return null;
        };

        const filteredRoots = roots
            .map((root) => filterAndBuildHierarchy(root, false))
            .filter((node) => node !== null) as TestElementData[];

        const assignNames = (element: TestElementData, parentPath: string): void => {
            const currentPath = parentPath ? `${parentPath}/${element.name}` : element.name;
            element.hierarchicalName = currentPath;
            element.children?.forEach((child) => assignNames(child, currentPath));
        };
        filteredRoots.forEach((root) => assignNames(root, ""));

        const nestedResourceWarnings: string[] = [];
        const checkNested = (element: TestElementData): void => {
            if (element.directRegexMatch) {
                element.children?.forEach((child) => {
                    if (child.directRegexMatch) {
                        nestedResourceWarnings.push(
                            `Robot resource '${element.name}' contains another resource '${child.name}'.`
                        );
                    }
                    checkNested(child);
                });
            } else {
                element.children?.forEach(checkNested);
            }
        };
        filteredRoots.forEach(checkNested);
        if (nestedResourceWarnings.length > 0) {
            this.logger.warn("[TestElementTreeBuilder] Nested robot resources found:", nestedResourceWarnings);
            vscode.window.showWarningMessage(
                `Warning: Nested robot resources found: ${nestedResourceWarnings.join("; ")}. Please review in TestBench Client.`
            );
        }
        return filteredRoots;
    }
}
