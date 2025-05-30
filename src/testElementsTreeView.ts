/**
 * @file testElementsTreeView.ts
 * @description Provides a VS Code TreeDataProvider implementation to display test elements
 * retrieved from the TestBench server.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as utils from "./utils";
import { connection, logger, getConfig, testElementsTreeDataProvider, testElementTreeView } from "./extension";
import { ConfigKeys, TreeItemContextValues } from "./constants";

type TestElementType = "Subdivision" | "DataType" | "Interaction" | "Condition" | "Other";

export const fileContentOfRobotResourceSubdivisionFile = `*** Settings ***\nDocumentation    tb:uid:`;

/**
 * Interface representing a test element from the json response of the server.
 * @property id Unique identifier computed from the key properties.
 * @property parentId Identifier of the parent element (derived from the "parent" or, if missing, use the "libraryKey").
 * @property name Display name.
 * @property uniqueID The uniqueID string.
 * @property libraryKey Processed libraryKey (if originally an object, its serial is used).
 * @property jsonString Pretty-printed JSON representation.
 * @property details The original JSON object.
 * @property elementType The computed type of the element.
 * @property directRegexMatch Indicates whether this element directly passed the regex filter.
 * @property children An array of child test elements.
 * @property hierarchicalName The hierarchical name of the element (e.g., "Root/Child").
 * @property parent The parent element
 */
export interface TestElementData {
    id: string;
    parentId: string | null;
    name: string;
    uniqueID: string;
    libraryKey: string | null;
    jsonString: string;
    details: any;
    elementType: TestElementType;
    directRegexMatch: boolean;
    children?: TestElementData[];
    hierarchicalName?: string;
    parent?: TestElementData;
}

/**
 * Retrieves resource regex patterns from the extension settings
 * and attempts to convert them from Python-style to JavaScript RegExp objects.
 *
 * Note: The conversion from Python regex to JavaScript regex may not cover all advanced Python regex features.
 *
 * @returns {RegExp[]} An array of valid JavaScript RegExp objects.
 */
function getResourceRegexPatternsFromExtensionSettings(): RegExp[] {
    const pythonResourceRegexPatternsInExtensionSettings: string[] = getConfig().get(
        ConfigKeys.TB2ROBOT_RESOURCE_REGEX,
        []
    );
    logger.trace("Resource regex patterns from settings:", pythonResourceRegexPatternsInExtensionSettings);

    /**
     * Converts a simplr Python-style regex string to a more JavaScript-compatible regex string.
     * This handles common differences like named capture groups.
     * @param {string} pythonRegex The Python regex pattern string.
     * @returns {string} The converted JavaScript regex pattern string.
     */
    function convertPythonRegexToJs(pythonRegex: string): string {
        // Replace named capture group syntax ( Transform (?P<name>... into (?<name>... )
        let javascriptRegex: string = pythonRegex.replace(/\(\?P<([^>]+)>([^)]+)\)/g, "(?<$1>$2)");

        // Replace \s* with \s*
        javascriptRegex = javascriptRegex.replace(/\\s\*/g, "\\s*");

        // Replace [Robot-Resource] with \[Robot-Resource\]
        javascriptRegex = javascriptRegex.replace(/\[Robot-Resource\]/g, "\\[Robot-Resource\\]");

        // Replace .* with .*
        javascriptRegex = javascriptRegex.replace(/\.\*/g, "\\.*");

        // Replace . with \.
        javascriptRegex = javascriptRegex.replace(/(?<!\\)\./g, "\\.");

        return javascriptRegex;
    }

    const JSlibraryRegexPatterns: RegExp[] = pythonResourceRegexPatternsInExtensionSettings
        .map((pythonRegexPattern) => {
            logger.trace(`Converting python regex pattern: ${pythonRegexPattern}`);
            const convertedJSPattern: string = convertPythonRegexToJs(pythonRegexPattern);
            logger.trace(`Converted to javascript regex pattern: ${convertedJSPattern}`);
            try {
                const regex: RegExp = new RegExp(convertedJSPattern, "u");
                logger.trace(`Created JS regex: ${regex}`);
                return regex;
            } catch (error) {
                logger.error(`Invalid JS regex pattern: ${convertedJSPattern}`, error);
                return null;
            }
        })
        .filter((regex): regex is RegExp => regex !== null);

    logger.trace("Final JS regex patterns to use:", JSlibraryRegexPatterns);
    return JSlibraryRegexPatterns;
}

/**
 * Checks if a given value matches any regex in the provided list.
 * @param {srting} value The string to test.
 * @param {RegExp[]} regexList An array of RegExp objects.
 * @returns {boolean} True if any regex matches; false otherwise.
 */
function matchesRegex(value: string, regexList: RegExp[]): boolean {
    const result: boolean = regexList.some((regex) => regex.test(value));
    // logger.trace(`Value "${value}" matches regex patterns: ${result}`);
    return result;
}

/**
 * Determines the type of a test element based on its properties.
 *
 * @param {any} item The test element object.
 * @returns {TestElementType} The type of the test element.
 */
function getTestElementTreeItemType(item: any): TestElementType {
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

/**
 * Generates a unique ID for a test element, handling different element types.
 *
 * @param {any} item The test element object.
 * @param {TestElementType} elementType The type of the test element.
 * @param {string} uniqueID The unique ID string.
 * @returns {string} The unique ID of the test element.
 */
function generateTestElementTreeItemId(item: any, elementType: TestElementType, uniqueID: string): string {
    switch (elementType) {
        case "Subdivision":
        case "Interaction":
        case "Condition":
        case "DataType": {
            const specificKey = item[`${elementType}_key`];
            if (specificKey && specificKey.serial) {
                return `${specificKey.serial}_${uniqueID}`;
            }
            logger.warn(
                `[generateTestElementTreeItemId] Element type ${elementType} for item ${uniqueID} missing specific key serial.`
            );
            return uniqueID;
        }
        default:
            return uniqueID;
    }
}

/**
 * Determines the parent ID of a test element.
 *
 * @param {any} item The test element object.
 * @param {string | null | undefined} libraryKey The library key.
 * @returns {string | null} The parent ID of the test element.
 */
function getItemParentId(item: any, libraryKey: string | null | undefined): string | null {
    // Use the 'parent' property if valid; otherwise, use the libraryKey as the parent.
    if (item.parent && item.parent.serial) {
        // Use both the parent's serial and uniqueID to create the composite parentId.
        // During tree linking composite ids are matched (which start with parent's serial)
        // "serial_uniqueID" is used for uniqueness even for elements with identical serials.
        return item.parent.uniqueID ? `${item.parent.serial}_${item.parent.uniqueID}` : String(item.parent.serial);
    }

    return libraryKey ? String(libraryKey) : null;
}

/**
 * Transforms a flat list of raw test elements from the server into a hierarchical tree structure (TestElementData[]).
 * This involves:
 * 1. Converting raw elements to TestElementData objects.
 * 2. Mapping elements by their generated IDs.
 * 3. Linking children to their parents to form the tree.
 * 4. Filtering the tree based on element types and regex matches (from extension settings).
 * 5. Assigning hierarchical names (full paths) to each element.
 * 6. Checking for and warning about nested robot resources.
 *
 * @param {any[]} flatJsonTestElements An array of raw test element objects from the server.
 * @returns {TestElementData[]} An array of root TestElementData objects representing the filtered and structured tree.
 */
function buildTree(flatJsonTestElements: any[]): TestElementData[] {
    const resourceRegexPatternsInExtensionSettings: RegExp[] = getResourceRegexPatternsFromExtensionSettings();
    logger.trace("Building tree with regex patterns:", resourceRegexPatternsInExtensionSettings);

    // Build a map for all elements without filtering.
    // This map is used to assign children to their respective parents.
    const elementIdToDataMap: { [id: string]: TestElementData } = {};

    // Process each JSON object and create a TestElement.
    flatJsonTestElements.forEach((jsonTestElement) => {
        let libraryKey: string | null = null;
        if (jsonTestElement.libraryKey) {
            if (typeof jsonTestElement.libraryKey === "object" && jsonTestElement.libraryKey.serial) {
                libraryKey = jsonTestElement.libraryKey.serial;
            } else {
                libraryKey = jsonTestElement.libraryKey;
            }
        }

        const testElementType: TestElementType = getTestElementTreeItemType(jsonTestElement);
        const UniqueIDOfTestElement: string = generateTestElementTreeItemId(
            jsonTestElement,
            testElementType,
            jsonTestElement.uniqueID
        );
        const testElementParentId: string | null = getItemParentId(jsonTestElement, libraryKey);

        const isRegexMatch: boolean =
            resourceRegexPatternsInExtensionSettings.length > 0
                ? matchesRegex(jsonTestElement.name, resourceRegexPatternsInExtensionSettings)
                : true;

        const testElement: TestElementData = {
            id: UniqueIDOfTestElement,
            parentId: testElementParentId,
            name: jsonTestElement.name,
            uniqueID: jsonTestElement.uniqueID,
            libraryKey,
            jsonString: JSON.stringify(jsonTestElement, null, 2),
            details: jsonTestElement,
            elementType: testElementType,
            directRegexMatch: isRegexMatch,
            children: []
        };

        elementIdToDataMap[UniqueIDOfTestElement] = testElement;
    });

    // Build the full tree structure by assigning children to their respective parents.
    const rootsOfTestElementView: TestElementData[] = [];
    Object.values(elementIdToDataMap).forEach((testElement) => {
        if (testElement.parentId) {
            const foundParentElement: TestElementData | undefined = Object.values(elementIdToDataMap).find((p) =>
                p.id.startsWith(`${testElement.parentId}_`)
            );
            if (foundParentElement) {
                testElement.parent = foundParentElement;
                foundParentElement.children!.push(testElement);
            } else {
                rootsOfTestElementView.push(testElement);
            }
        } else {
            rootsOfTestElementView.push(testElement);
        }
    });

    /**
     * Recursively filters the tree based on element type and regex matching.
     * Also, if a robot resource (directRegexMatch true) is nested under another robot resource,
     * it is filtered out and a warning message is recorded.
     * Filtered elements become null and are removed from the tree.
     *
     * @param {TestElementData} testElement The element to filter.
     * @param {boolean} doesInheritMatchFromParent True if the element inherits a match from a parent.
     * @returns {TestElementData | null} The filtered element or null if excluded.
     */
    function filterTestElementsTree(
        testElement: TestElementData,
        doesInheritMatchFromParent: boolean
    ): TestElementData | null {
        let filteredChildren: TestElementData[] = [];
        if (testElement.children) {
            // Determine if the children should inherit inclusion:
            // If the current element directly matches the regex or is already inherited, mark children as inherited.
            const childrenInherited: boolean = doesInheritMatchFromParent || testElement.directRegexMatch;
            filteredChildren = testElement.children
                .map((child) => filterTestElementsTree(child, childrenInherited))
                .filter((child) => child !== null) as TestElementData[];
        }

        if (testElement.elementType === "DataType" || testElement.elementType === "Condition") {
            return null;
        }

        // Hide non robot resources if they don't have visible children.
        if (testElement.elementType === "Subdivision" && !testElement.directRegexMatch && doesInheritMatchFromParent) {
            return null;
        }

        if (testElement.directRegexMatch || doesInheritMatchFromParent || filteredChildren.length > 0) {
            return { ...testElement, children: filteredChildren };
        }

        return null;
    }

    const filteredRoots: TestElementData[] = rootsOfTestElementView
        .map((root) => filterTestElementsTree(root, false))
        .filter((node): node is TestElementData => node !== null);

    /**
     * Recursively assigns hierarchical names (full paths) to each element.
     * @param {TestElementData} element The element.
     * @param {string} parentPath The accumulated parent path.
     */
    function assignHierarchicalNames(element: TestElementData, parentPath: string): void {
        const currentHierarchicalPath: string = parentPath ? `${parentPath}/${element.name}` : element.name;
        element.hierarchicalName = currentHierarchicalPath;
        if (element.children && element.children.length > 0) {
            element.children.forEach((child: any) => assignHierarchicalNames(child, currentHierarchicalPath));
        }
    }
    filteredRoots.forEach((root) => assignHierarchicalNames(root, ""));

    // Nested robot resources can be created with the current TestBench Client, which is not allowed.
    // Warn the user if found.
    const nestedRobotResources: string[] = [];

    /**
     * Recursively checks for nested robot resources.
     * If a robot resource is found under another robot resource, create a warning message in nestedRobotResources.
     * @param {TestElementData} testElement The element to check.
     */
    function checkForNestedRobotResources(testElement: TestElementData): void {
        if (testElement.directRegexMatch) {
            for (const child of testElement.children || []) {
                if (child.directRegexMatch) {
                    nestedRobotResources.push(
                        `Robot resource '${testElement.name}' contains another robot resource '${child.name}'.`
                    );
                }
                checkForNestedRobotResources(child);
            }
        } else {
            for (const child of testElement.children || []) {
                checkForNestedRobotResources(child);
            }
        }
    }

    filteredRoots.forEach((root) => checkForNestedRobotResources(root));
    if (nestedRobotResources.length > 0) {
        vscode.window.showWarningMessage(
            `Warning: Nested robot resources found. Please review the test elements view in TestBench Client.`
        );
    }

    return filteredRoots;
}

/**
 * Mapping from element types to icon file names. *
 */
const iconMapping: Record<string, { light: string; dark: string }> = {
    DataType: { light: "dataType-light.svg", dark: "dataType-dark.svg" },
    Interaction: { light: "testStep-light.svg", dark: "testStep-dark.svg" },
    Condition: { light: "condition-light.svg", dark: "condition-dark.svg" },
    Subdivision: { light: "missingSubdivision-light.svg", dark: "missingSubdivision-dark.svg" },
    MissingSubdivision: { light: "missingSubdivision-light.svg", dark: "missingSubdivision-dark.svg" },
    LocalSubdivision: { light: "localSubdivision-light.svg", dark: "localSubdivision-dark.svg" },
    Other: { light: "other-light.svg", dark: "other-dark.svg" }
};

/**
 * Returns the icon URI for a given element type. Supports light and dark themes.
 * @param {TestElementTreeItem} treeItem The test element tree item.
 * @returns {vscode.Uri} The icon URI.
 */
function getIconUriForElementType(treeItem: TestElementTreeItem): { light: vscode.Uri; dark: vscode.Uri } {
    const elementType: TestElementType = treeItem.testElementData?.elementType || "Other";
    logger.trace(`Getting icon for element type: ${elementType}`);
    const iconFileNames = iconMapping[elementType] || iconMapping["Other"];

    if (!iconFileNames) {
        logger.error(`No icon mapping found for element type: ${elementType}. Falling back to default icon.`);
        const defaultIconPaths = iconMapping["Other"];
        const lightIconUri: vscode.Uri = vscode.Uri.file(
            path.join(__dirname, "..", "resources", "icons", defaultIconPaths.light)
        );
        const darkIconUri: vscode.Uri = vscode.Uri.file(
            path.join(__dirname, "..", "resources", "icons", defaultIconPaths.dark)
        );
        return { light: lightIconUri, dark: darkIconUri };
    }

    const lightIconUri: vscode.Uri = vscode.Uri.file(
        path.join(__dirname, "..", "resources", "icons", iconFileNames.light)
    );
    const darkIconUri: vscode.Uri = vscode.Uri.file(
        path.join(__dirname, "..", "resources", "icons", iconFileNames.dark)
    );

    return { light: lightIconUri, dark: darkIconUri };
}

/**
 * TestElementTreeItem represents a test element in the VS Code tree view.
 */
export class TestElementTreeItem extends vscode.TreeItem {
    public readonly testElementData: TestElementData;

    /**
     * Constructs a new TestElementTreeItem.
     * @param {TestElementData} elementData The test element.
     */
    constructor(elementData: TestElementData) {
        const label: string = elementData?.name || "Placeholder";
        const collapsibleState =
            elementData?.children && elementData.children.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;

        super(label, collapsibleState);
        this.testElementData = elementData || ({} as TestElementData);

        // Context value is used in package.json to enable context menu contributions.
        switch (elementData.elementType) {
            case "Subdivision":
                this.contextValue = TreeItemContextValues.SUBDIVISION;
                break;
            case "Interaction":
                this.contextValue = TreeItemContextValues.INTERACTION;
                break;
            case "DataType":
                this.contextValue = TreeItemContextValues.DATA_TYPE;
                break;
            case "Condition":
                this.contextValue = TreeItemContextValues.CONDITION;
                break;
            default:
                this.contextValue = TreeItemContextValues.TEST_ELEMENT;
                break;
        }

        const tooltipLines: string[] = [
            `Type: ${this.testElementData.elementType || "N/A"}`,
            `Name: ${elementData.name || label}`
        ];
        if (elementData.uniqueID) {
            tooltipLines.push(`UniqueID: ${this.testElementData.uniqueID}`);
        }
        if (elementData.libraryKey) {
            tooltipLines.push(`LibraryKey: ${elementData.libraryKey}`);
        }
        if (elementData.details?.hasVersion !== undefined) {
            tooltipLines.push(`Has Version: ${elementData.details.hasVersion}`);
        }
        if (elementData.details?.status !== undefined) {
            tooltipLines.push(`Status: ${elementData.details.status}`);
        }
        // Include raw JSON (Useful for debugging)
        // if (elementData.jsonString) { tooltipLines.push(`\nJSON Data:\n${elementData.jsonString}`); }

        this.tooltip = new vscode.MarkdownString(tooltipLines.join("\n"));

        // Display the uniqueID as a description next to the label.
        this.description = elementData.uniqueID || "";

        this.setIcon(getIconUriForElementType(this));
    }

    /**
     * Updates the iconPath for this tree item.
     * @param newIconPath An object containing URIs for the light and dark theme icons.
     */
    public setIcon(newIconPath: { light: vscode.Uri; dark: vscode.Uri }): void {
        this.iconPath = newIconPath;
    }
}

/**
 * Constructs the absolute path for a test element based on the workspace root and hierarchical name.
 *
 * @param {TestElementTreeItem} testElementTreeItem The test element tree item to construct the path for.
 * @returns {Promise<string | undefined>} The absolute path of the test element, or undefined if not found.
 */
export async function constructAbsolutePathForTestElement(
    testElementTreeItem: TestElementTreeItem
): Promise<string | undefined> {
    const workspaceRootPath: string | undefined = await utils.validateAndReturnWorkspaceLocation();
    if (!workspaceRootPath) {
        logger.trace(
            `No workspace root path found while constructing absolute path for test element: ${testElementTreeItem.testElementData.name}`
        );
        return undefined;
    }

    if (!testElementTreeItem.testElementData.hierarchicalName) {
        logger.error(
            `[constructAbsolutePathForTestElement] Test element "${testElementTreeItem.testElementData.name}" (ID: ${testElementTreeItem.testElementData.id}) has no hierarchical name. Cannot construct absolute path.`
        );
        return undefined;
    }

    const absoluteTestElementPath: string = path.join(
        workspaceRootPath,
        testElementTreeItem.testElementData.hierarchicalName
    );
    logger.trace(
        `[constructAbsolutePathForTestElement] Constructed absolute path for tree item "${testElementTreeItem.testElementData.name}": ${absoluteTestElementPath}`
    );
    return absoluteTestElementPath;
}

/**
 * Updates the icon of a Subdivision based on whether it is locally available or not.
 * @param {TestElementTreeItem} testElementTreeItem The TestElementTreeItem to update.
 * @returns {Promise<void>} A promise that resolves when the icon is updated.
 */
export async function updateTestElementIcon(testElementTreeItem: TestElementTreeItem): Promise<void> {
    const absolutePathOfTestElement: string | undefined =
        await constructAbsolutePathForTestElement(testElementTreeItem);

    if (!absolutePathOfTestElement) {
        logger.warn(
            `[updateTestElementIcon] Cannot update icon for "${testElementTreeItem.label}": absolute path could not be determined.`
        );
        return;
    }

    logger.trace(
        `[updateTestElementIcon] Updating icon for test element: ${testElementTreeItem.testElementData.name} with absolute path ${absolutePathOfTestElement}`
    );
    if (testElementTreeItem.testElementData.elementType !== "Subdivision") {
        testElementTreeItem.setIcon(getIconUriForElementType(testElementTreeItem));
    } else {
        logger.trace(
            `[updateTestElementIcon] Updating icon for subdivision: ${testElementTreeItem.testElementData.name}`
        );
        const isSubdivisionAvailableLocally: boolean = await isSubdivisionLocallyAvailable(
            testElementTreeItem,
            absolutePathOfTestElement
        );
        const iconKey = isSubdivisionAvailableLocally ? "LocalSubdivision" : "MissingSubdivision";
        const iconFileNames = iconMapping[iconKey];

        if (iconFileNames) {
            testElementTreeItem.setIcon({
                light: vscode.Uri.file(path.join(__dirname, "..", "resources", "icons", iconFileNames.light)),
                dark: vscode.Uri.file(path.join(__dirname, "..", "resources", "icons", iconFileNames.dark))
            });
        } else {
            // Defensive fallback
            testElementTreeItem.setIcon(getIconUriForElementType(testElementTreeItem));
            logger.warn(
                `[TestElementsView] Icon key "${iconKey}" not found in iconMapping for subdivision "${testElementTreeItem.label}".`
            );
        }
    }
}

/**
 * TestElementsTreeDataProvider implements the VS Code TreeDataProvider interface for test elements.
 */
export class TestElementsTreeDataProvider implements vscode.TreeDataProvider<TestElementTreeItem> {
    public _onDidChangeTreeDataEmitter: vscode.EventEmitter<TestElementTreeItem | undefined> = new vscode.EventEmitter<
        TestElementTreeItem | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<TestElementTreeItem | undefined> =
        this._onDidChangeTreeDataEmitter.event;
    private currentTreeData: TestElementData[] = [];

    private currentSelectedTovKey: string = "";
    public getCurrentTovKey(): string {
        return this.currentSelectedTovKey;
    }
    public setCurrentTovKey(tovKey: string): void {
        this.currentSelectedTovKey = tovKey;
    }

    // Flag to be able to set a proper tree view message
    public isDataFetchAttempted: boolean = false;

    private treeViewMessageUpdater: (message: string | undefined) => void;

    constructor(updateTreeViewMessageCallback: (message: string | undefined) => void) {
        this.treeViewMessageUpdater = updateTreeViewMessageCallback;
    }

    public setTreeViewMessage(message: string | undefined): void {
        this.treeViewMessageUpdater(message);
    }

    public updateTreeViewStatusMessage(): void {
        if (this.isTreeDataEmpty()) {
            if (!this.isDataFetchAttempted) {
                this.setTreeViewMessage(
                    "Select a Test Object Version (TOV) from the 'Projects' view to load test elements."
                );
            } else {
                const filterPatterns: string[] = getConfig().get(ConfigKeys.TB2ROBOT_RESOURCE_REGEX, []);
                if (filterPatterns && filterPatterns.length > 0) {
                    this.setTreeViewMessage("No test elements match the current filter criteria.");
                } else {
                    this.setTreeViewMessage("No test elements found for the selected Test Object Version (TOV).");
                }
            }
        } else {
            this.setTreeViewMessage(undefined);
        }
    }

    /**
     * Checks if the current tree data is empty.
     * @returns {boolean} True if the tree data is empty; false otherwise.
     */
    public isTreeDataEmpty(): boolean {
        return !this.currentTreeData || this.currentTreeData.length === 0;
    }

    /**
     * Gets the TestElementTreeItem representation for the given TestElementData.
     * @param {TestElementTreeItem} item The TestElementTreeItem from getChildren.
     * @returns The same item.
     */
    getTreeItem(item: TestElementTreeItem): vscode.TreeItem {
        return item;
    }

    /**
     * Returns the children for a given test element.
     * @param {TestElementTreeItem} parentTestElement Optional parent TestElementTreeItem.
     * @returns {Thenable<TestElementTreeItem[]>} A promise resolving to an array of TestElementTreeItems.
     */
    async getChildren(parentTestElement?: TestElementTreeItem): Promise<TestElementTreeItem[]> {
        if (parentTestElement) {
            const childrenData: TestElementData[] = parentTestElement.testElementData.children || [];
            const childItems: TestElementTreeItem[] = await Promise.all(
                childrenData.map(async (childData: any) => {
                    const childItem = new TestElementTreeItem(childData);
                    await updateTestElementIcon(childItem);
                    return childItem;
                })
            );
            return childItems;
        } else {
            if (this.isTreeDataEmpty()) {
                logger.trace(
                    "[getChildren] TestElementsTreeDataProvider: No tree data found for root, returning empty. Message should be set."
                );
                return [];
            }

            const rootTreeItems: TestElementTreeItem[] = await Promise.all(
                this.currentTreeData.map(async (rootData) => {
                    const rootTestElementItems: TestElementTreeItem = new TestElementTreeItem(rootData);
                    await updateTestElementIcon(rootTestElementItems);
                    return rootTestElementItems;
                })
            );
            return rootTreeItems;
        }
    }

    /**
     * Refreshes the tree view with new data.
     * Handles message updates based on the presence of data.
     * @param {any} flatTestElementsJsonData A flat array of JSON objects representing test elements.
     */
    refresh(flatTestElementsJsonData: any[]): void {
        this.currentTreeData = buildTree(flatTestElementsJsonData);
        if (testElementTreeView) {
            if (this.isTreeDataEmpty()) {
                const filterPatterns: string[] = getConfig().get(ConfigKeys.TB2ROBOT_RESOURCE_REGEX, []);
                if (filterPatterns && filterPatterns.length > 0) {
                    this.treeViewMessageUpdater("No test elements match the current filter criteria.");
                } else {
                    this.treeViewMessageUpdater("No test elements found for the selected Test Object Version (TOV).");
                }
                logger.trace(`Test Elements view message set: ${testElementTreeView.message}`);
            } else {
                this.treeViewMessageUpdater(undefined);
                logger.trace("Test Elements view message cleared.");
            }
        }

        this._onDidChangeTreeDataEmitter.fire(undefined);
    }

    /**
     * Fetches test elements using a TOV key and updates the tree view.
     * @param {string} tovKey The TOV key.
     * @param {string} newTestElementsTreeViewTitle Optional new title for the tree view.
     * @returns {Promise<boolean>} A promise that resolves to true if test elements were fetched and displayed, false otherwise.
     */
    async fetchTestElements(tovKey: string, newTestElementsTreeViewTitle?: string): Promise<boolean> {
        // For testing with a local JSON file.
        // const jsonPath = "ABSOLUTE-PATH-TO-JSON-FILE";
        // const testElementsJsonData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

        this.isDataFetchAttempted = true;

        const tovLabel: string = newTestElementsTreeViewTitle || tovKey;
        this.treeViewMessageUpdater(`Loading test elements for TOV: ${tovLabel}...`);

        // Clear current data and trigger UI update to show loading message
        this.currentTreeData = [];
        this._onDidChangeTreeDataEmitter.fire(undefined);

        try {
            const testElementsJsonData = await connection?.getTestElementsWithTovKeyUsingOldPlayServer(tovKey);
            if (testElementsJsonData) {
                this.currentSelectedTovKey = tovKey;
                this.refresh(testElementsJsonData);

                if (newTestElementsTreeViewTitle && testElementTreeView) {
                    testElementTreeView.title = `Test Elements (${newTestElementsTreeViewTitle})`;
                }
                return true;
            } else {
                this.currentSelectedTovKey = "";
                vscode.window.showErrorMessage("Failed to fetch test elements from the server.");
                this.treeViewMessageUpdater("Error: Failed to fetch test elements. Please try again or check logs.");
                this.currentTreeData = [];
                this._onDidChangeTreeDataEmitter.fire(undefined);

                return false;
            }
        } catch (error) {
            this.currentSelectedTovKey = "";
            const errorMessage: string = error instanceof Error ? error.message : "Unknown error";
            logger.error(
                `[fetchTestElements] Failed to fetch test elements for TOV "${tovKey}": ${errorMessage}`,
                error
            );
            vscode.window.showErrorMessage(`Failed to fetch test elements for TOV "${tovLabel}".`);
            this.setTreeViewMessage(`Error fetching elements for TOV "${tovLabel}". Please check logs or try again.`);
            this.currentTreeData = [];
            this._onDidChangeTreeDataEmitter.fire(undefined);
            return false;
        }
    }
}

/**
 * Hides the Test Elements tree view.
 */
export async function hideTestElementsTreeView(): Promise<void> {
    if (testElementTreeView) {
        await vscode.commands.executeCommand("testElementsView.removeView");
    } else {
        logger.warn("Test Elements view instance not found, 'removeView' command not executed.");
    }
}

/**
 * Displays the Test Elements tree view.
 */
export async function displayTestElementsTreeView(): Promise<void> {
    if (testElementTreeView) {
        await vscode.commands.executeCommand("testElementsView.focus");
    } else {
        logger.warn("Test Elements view instance not found, 'focus' command not executed.");
    }
}

/**
 * Normalizes a given base target path by making sure it ends with ".resource" and removing any
 * whitespace immediately preceding ".resource" as well as any trailing whitespace.
 *
 * @param {string} baseTargetPath - The input path string to normalize.
 * @returns {string} The normalized path string ending with ".resource" without extraneous whitespace.
 */
function appendResourceExtensionAndTrimPath(baseTargetPath: string): string {
    logger.trace(`Adding .resource extension and trimming the following path: ${baseTargetPath}`);
    let targetPath: string = baseTargetPath.endsWith(".resource") ? baseTargetPath : baseTargetPath + ".resource";

    // Remove any whitespace that appears immediately before ".resource" and trim trailing whitespace.
    targetPath = targetPath.replace(/\s+(\.resource)$/, "$1").replace(/\s+$/, "");

    // Remove any (one or more) whitespaces from the beginning of the string.
    targetPath = targetPath.replace(/^\s+/, "");

    logger.trace(`Normalized path after adding .resource and trimming : ${targetPath}`);
    return targetPath;
}

/**
 * Checks if a file (or folder) exists, with an option for a case-sensitive or case-insensitive check.
 * For a case-sensitive check, every folder in the path hierarchy is verified to match exactly.
 * @param {string} filePath The full path to the file (or folder).
 * @param {boolean} caseSensitiveCheck Optional flag to perform a case-sensitive check (true by default).
 * @returns A promise that resolves to true if the entire path exists with exact casing, false otherwise.
 */
async function isFilePresentLocally(filePath: string, caseSensitiveCheck: boolean = false): Promise<boolean> {
    logger.trace(`[isFilePresentLocally] Checking if file exists: ${filePath}`);
    if (!caseSensitiveCheck) {
        // Check with stat is case-insensitive
        try {
            await fs.promises.stat(filePath);
            logger.trace(`[isFilePresentLocally] File exists with case-insensitive check: ${filePath}`);
            return true;
        } catch (err: any) {
            if (err.code === "ENOENT") {
                logger.trace(`[isFilePresentLocally] File does not exist: ${filePath}`);
                return false;
            }
            logger.error(`[isFilePresentLocally] Error stating file "${filePath}" (case-insensitive): ${err.message}`);
            throw err;
        }
    }

    const absoluteFilePath: string = path.resolve(filePath);
    // Split the path into its parts. Filtering out any empty strings (e.g., due to leading separators).
    const filePathSegments: string[] = absoluteFilePath.split(path.sep).filter((part) => part !== "");

    logger.trace(`[isFilePresentLocally] Resolved path: ${absoluteFilePath}`);

    // Determine the starting point (the root)
    let currentConstructedPath: string;
    if (path.isAbsolute(absoluteFilePath)) {
        if (process.platform === "win32") {
            // On Windows, the first part is typically the drive letter (e.g., "C:")
            currentConstructedPath = filePathSegments[0] + path.sep;
            // Remove the drive letter from the parts.
            filePathSegments.shift();
        } else {
            currentConstructedPath = path.sep;
        }
    } else {
        // For relative paths, start with an empty string.
        currentConstructedPath = "";
    }

    for (const pathSegment of filePathSegments) {
        let directoryEntries: string[];
        try {
            directoryEntries = await fs.promises.readdir(currentConstructedPath);
            // logger.trace(`Entries in ${currentPath}: ${entries}`);
        } catch (err: any) {
            if (err.code === "ENOENT") {
                logger.trace(`[isFilePresentLocally] Path does not exist: ${currentConstructedPath}`);
                return false;
            }
            throw err;
        }
        if (!directoryEntries.includes(pathSegment)) {
            logger.trace(
                `[isFilePresentLocally] Returning false, part ${pathSegment} not found in ${currentConstructedPath}`
            );
            return false;
        }
        logger.trace(`[isFilePresentLocally] Part ${pathSegment} found in ${currentConstructedPath}`);
        currentConstructedPath = path.join(currentConstructedPath, pathSegment);
    }

    logger.trace(`[isFilePresentLocally] File exists with exact case, returning true: ${absoluteFilePath}`);
    return true;
}

/**
 * Checks if a subdivision exists locally.
 *
 * @param {TestElementTreeItem} testElementTreeItem The test element tree item representing a subdivision.
 * @param {string} absolutePathOfTestElement The absolute path of the test element.
 * @returns {Promise<boolean>} A promise that resolves to true if the subdivision exists locally, false otherwise.
 */
async function isSubdivisionLocallyAvailable(
    testElementTreeItem: TestElementTreeItem,
    absolutePathOfTestElement: string
): Promise<boolean> {
    logger.trace(
        `[isSubdivisionLocallyAvailable] Checking if subdivision exists locally: ${absolutePathOfTestElement}`
    );
    if (testElementTreeItem.testElementData.elementType !== "Subdivision") {
        logger.trace(`[isSubdivisionLocallyAvailable] Element is not a subdivision, returning false.`);
        return false;
    }

    const isFinalSubdivision: boolean = isFinalSubdivisionInTree(testElementTreeItem.testElementData);
    let pathToCheck: string = removeRobotResourceFromPathString(absolutePathOfTestElement);

    if (isFinalSubdivision) {
        pathToCheck = appendResourceExtensionAndTrimPath(pathToCheck);
        logger.trace(
            `[isSubdivisionLocallyAvailable] Final subdivision "${testElementTreeItem.testElementData.name}". Checking for resource file: "${pathToCheck}"`
        );
        return isFilePresentLocally(pathToCheck);
    } else {
        logger.trace(
            `[isSubdivisionLocallyAvailable] Non-final subdivision "${testElementTreeItem.testElementData.name}". Checking for folder: "${pathToCheck}"`
        );
        return isFilePresentLocally(pathToCheck);
    }
}

/**
 * Creates a folder structure based on the provided target path.
 * It checks each component of the path and creates directories as needed.
 * @param {string} targetPath The target path to create the folder structure.
 * @returns {Promise<void>} A promise that resolves when the folder structure is created.
 */
async function createFolderStructure(targetPath: string): Promise<void> {
    try {
        const normalizedPath: string = path.normalize(targetPath);
        const normalizedPathSegments: string[] = normalizedPath.split(path.sep).filter((p) => p);
        // Handle drive letter on Windows
        let currentPath: string = normalizedPathSegments[0] + (process.platform === "win32" ? path.sep : "");

        for (let i = 1; i < normalizedPathSegments.length; i++) {
            currentPath = path.join(currentPath, normalizedPathSegments[i]);

            try {
                const stats: fs.Stats = await fs.promises.stat(currentPath);
                if (!stats.isDirectory()) {
                    throw new Error(
                        `[createFolderStructure] Path component exists but is not a directory: ${currentPath}`
                    );
                }
            } catch (error: any) {
                if (error.code === "ENOENT") {
                    await fs.promises.mkdir(currentPath, { recursive: true });
                    logger.trace(`[createFolderStructure] Created directory: ${currentPath}`);
                } else {
                    throw error;
                }
            }
        }
    } catch (error) {
        logger.error(`[createFolderStructure] Failed to create folder structure: ${error}`);
        throw error;
    }
}

/**
 * Handles the "Go To Resource File" option for a subdivision element by opening or creating its resource file or folder.
 * @param {TestElementTreeItem} subdivisionTreeItem The test element tree item representing a subdivision.
 */
export async function handleSubdivision(subdivisionTreeItem: TestElementTreeItem): Promise<void> {
    const absolutePath: string | undefined = await constructAbsolutePathForTestElement(subdivisionTreeItem);
    if (!absolutePath) {
        return;
    }

    const processedPath: string = removeRobotResourceFromPathString(absolutePath);

    try {
        if (isFinalSubdivisionInTree(subdivisionTreeItem.testElementData)) {
            const resourcePath: string = appendResourceExtensionAndTrimPath(processedPath);
            await createFolderStructure(path.dirname(resourcePath));

            if (!(await isFilePresentLocally(resourcePath))) {
                const fileContent: string = `${fileContentOfRobotResourceSubdivisionFile}${subdivisionTreeItem.testElementData.uniqueID}\n`;
                await fs.promises.writeFile(resourcePath, fileContent);
            }

            const document: vscode.TextDocument = await vscode.workspace.openTextDocument(
                vscode.Uri.file(resourcePath)
            );
            await vscode.window.showTextDocument(document);
        } else {
            await createFolderStructure(processedPath);
            await vscode.commands.executeCommand("workbench.view.explorer");

            if (subdivisionTreeItem.testElementData.children) {
                for (const child of subdivisionTreeItem.testElementData.children) {
                    if (
                        child.elementType === "Subdivision" &&
                        child.parent?.id === subdivisionTreeItem.testElementData.id
                    ) {
                        await handleSubdivision(new TestElementTreeItem(child));
                    }
                }
            }
        }

        await updateTestElementIcon(subdivisionTreeItem);
        testElementsTreeDataProvider?._onDidChangeTreeDataEmitter.fire(undefined);
    } catch (error: any) {
        logger.error(`[handleSubdivision] Failed to handle subdivision: ${error}`);
        vscode.window.showErrorMessage(`Failed to create folder structure: ${error.message}`);
    }
}

/**
 * Handles an interaction element by opening the resource file of its nearest final robotframework resource subdivision .resource file.
 * @param {TestElementTreeItem} interactionTreeItem The test element tree item representing an interaction.
 */
export async function handleInteraction(interactionTreeItem: TestElementTreeItem): Promise<void> {
    const workspaceRootPath: string | undefined = await utils.validateAndReturnWorkspaceLocation();
    if (!workspaceRootPath) {
        return;
    }
    const interactionData: TestElementData = interactionTreeItem.testElementData;
    const robotResourceAncestor: TestElementTreeItem | null = getRobotResourceAncestor(interactionTreeItem);

    if (!robotResourceAncestor) {
        logger.warn(
            `[handleInteraction] Interaction '${interactionData.uniqueID}' has no Robot-Resource Subdivision ancestor. Falling back to nearest general Subdivision.`
        );
        const subdivisionAncestor: TestElementTreeItem | null = getSubdivisionAncestor(interactionTreeItem);
        if (subdivisionAncestor) {
            logger.trace(
                `[handleInteraction] Nearest Subdivision Ancestor (fallback) of Interaction '${interactionData.uniqueID}': `,
                subdivisionAncestor.testElementData
            );
            await handleSubdivision(subdivisionAncestor);
            return;
        } else {
            vscode.window.showErrorMessage(
                `Cannot determine resource file for interaction '${interactionData.name}'. No subdivision ancestor found.`
            );
            logger.error(
                `[handleInteraction] No subdivision ancestor found for interaction '${interactionData.name}'.`
            );
            return;
        }
    }

    if (!robotResourceAncestor.testElementData.hierarchicalName) {
        robotResourceAncestor.testElementData.hierarchicalName = computeHierarchicalName(robotResourceAncestor);
        logger.trace(
            `[handleInteraction] Computed hierarchical name for robot resource subdivision: ${robotResourceAncestor.testElementData.hierarchicalName}`
        );
    }
    const robotResourceAncestorAbsolutePath: string | undefined =
        await constructAbsolutePathForTestElement(robotResourceAncestor);
    if (!robotResourceAncestorAbsolutePath) {
        vscode.window.showErrorMessage(
            `Could not determine path for resource: ${robotResourceAncestor.testElementData.name}`
        );
        return;
    }

    let processedRobotResourceAncestorPath: string = removeRobotResourceFromPathString(
        robotResourceAncestorAbsolutePath
    );
    processedRobotResourceAncestorPath = appendResourceExtensionAndTrimPath(processedRobotResourceAncestorPath);

    try {
        if (!(await isFilePresentLocally(processedRobotResourceAncestorPath))) {
            await createFolderStructure(path.dirname(processedRobotResourceAncestorPath));
            const fileContent: string = `${fileContentOfRobotResourceSubdivisionFile}${robotResourceAncestor.testElementData.uniqueID}\n`;
            await fs.promises.writeFile(processedRobotResourceAncestorPath, fileContent);
            logger.trace(`[handleInteraction] Resource file created at ${processedRobotResourceAncestorPath}`);
        } else {
            logger.trace(
                `[handleInteraction] Skipping creation of resource file at ${processedRobotResourceAncestorPath} as it already exists.`
            );
        }

        const resourceFileDocument: vscode.TextDocument = await vscode.workspace.openTextDocument(
            vscode.Uri.file(processedRobotResourceAncestorPath)
        );
        await vscode.window.showTextDocument(resourceFileDocument);
        await vscode.commands.executeCommand("workbench.files.action.showActiveFileInExplorer");

        testElementsTreeDataProvider?._onDidChangeTreeDataEmitter.fire(undefined);
    } catch (error: any) {
        logger.error(
            `[handleInteraction] Failed to handle interaction "${interactionData.name}": ${error.message}`,
            error
        );
        vscode.window.showErrorMessage(
            `Failed to open/create resource for interaction "${interactionData.name}": ${error.message}`
        );
    }
}

/**
 * Handles fallback for opening a test element file.
 * @param {string} targetPath The target file path.
 */
export async function handleFallback(targetPath: string): Promise<void> {
    try {
        if (!(await isFilePresentLocally(targetPath))) {
            const dirName: string = path.dirname(targetPath);
            await fs.promises.mkdir(dirName, { recursive: true });
            await fs.promises.writeFile(targetPath, "");
        }
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand("workbench.files.action.showActiveFileInExplorer");
    } catch (error: any) {
        logger.error(`[handleFallback] Error in fallback file handling for "${targetPath}": ${error.message}`, error);
        vscode.window.showErrorMessage(`Failed to open or create file "${targetPath}": ${error.message}`);
    }
}

/**
 * Creates a new interaction tree item under a subdivision.
 * @param {TestElementTreeItem} subdivisionTreeItem The subdivision tree item.
 * @param {string} interactionName The name of the new interaction.
 * @returns {Promise<TestElementData | null>} The created interaction data or null if failed.
 */
export async function createInteractionUnderSubdivision(
    subdivisionTreeItem: TestElementTreeItem,
    interactionName: string
): Promise<TestElementData | null> {
    if (subdivisionTreeItem.testElementData.elementType !== "Subdivision") {
        vscode.window.showErrorMessage("Can only create interactions under subdivisions.");
        return null;
    }

    if (!interactionName || interactionName.trim() === "") {
        vscode.window.showErrorMessage("Interaction name cannot be empty.");
        return null;
    }

    try {
        // Create a new interaction object
        // TODO: Adjust the implementation after API changes
        const newInteraction: any = {
            name: interactionName,
            elementType: "Interaction",
            uniqueID: `new-interaction-${Date.now()}`,
            parent: {
                // Extract serial from parent ID
                serial: subdivisionTreeItem.testElementData.id.split("_")[0],
                uniqueID: subdivisionTreeItem.testElementData.uniqueID
            },
            Interaction_key: {
                serial: `new-interaction-${Date.now()}`
            }
        };

        const interactionData: TestElementData = {
            id: generateTestElementTreeItemId(newInteraction, "Interaction", newInteraction.uniqueID),
            parentId: subdivisionTreeItem.testElementData.id,
            name: interactionName,
            uniqueID: newInteraction.uniqueID,
            libraryKey: subdivisionTreeItem.testElementData.libraryKey,
            jsonString: JSON.stringify(newInteraction, null, 2),
            details: newInteraction,
            elementType: "Interaction",
            directRegexMatch: false,
            children: [],
            parent: subdivisionTreeItem.testElementData,
            hierarchicalName: `${subdivisionTreeItem.testElementData.hierarchicalName}/${interactionName}`
        };

        if (!subdivisionTreeItem.testElementData.children) {
            subdivisionTreeItem.testElementData.children = [];
        }
        subdivisionTreeItem.testElementData.children.push(interactionData);

        return interactionData;
    } catch (error) {
        logger.error("[createInteractionUnderSubdivision] Error creating interaction tree item:", error);
        vscode.window.showErrorMessage("Failed to create interaction: " + (error as Error).message);
        return null;
    }
}

/**
 * Determines if a subdivision element is final (has no child subdivisions).
 * @param {TestElementData} element The test element to check.
 * @returns {boolean} True if the element is a final subdivision; false otherwise.
 */
export function isFinalSubdivisionInTree(element: TestElementData): boolean {
    if (element.elementType !== "Subdivision") {
        logger.trace(`[isFinalSubdivisionInTree] Element ${element.name} is not a subdivision.`);
        return false;
    }
    if (!element.children) {
        logger.trace(`[isFinalSubdivisionInTree] Element ${element.name} has no children and is final.`);
        return true;
    }
    const isFinalSubdivision: boolean = !element.children.some(
        (child: { elementType: string }) => child.elementType === "Subdivision"
    );

    if (isFinalSubdivision) {
        logger.trace(`[isFinalSubdivisionInTree] Test element ${element.name} is a final subdivision.`);
    } else {
        logger.trace(`[isFinalSubdivisionInTree] Test element ${element.name} is not a final subdivision.`);
    }

    return isFinalSubdivision;
}

/**
 * Traverses upward from an interaction element to find the nearest final subdivision.
 * @param {TestElementTreeItem} treeItem The test element tree item representing an interaction.
 * @returns {TestElementTreeItem | null} The nearest final subdivision ancestor, or null if not found.
 */
export function getFinalSubdivisionAncestor(treeItem: TestElementTreeItem): TestElementTreeItem | null {
    const initialTestElementData: TestElementData = treeItem.testElementData;
    logger.trace(
        `[getFinalSubdivisionAncestor] Searching final subdivision ancestor for test element ${initialTestElementData.name}`
    );
    let currentAncestorData = initialTestElementData.parent;
    while (currentAncestorData) {
        if (currentAncestorData.elementType === "Subdivision" && isFinalSubdivisionInTree(currentAncestorData)) {
            logger.trace(
                `[getFinalSubdivisionAncestor] Found final subdivision ancestor for test element ${initialTestElementData.name}: ${currentAncestorData.name}`
            );
            return new TestElementTreeItem(currentAncestorData);
        }
        currentAncestorData = currentAncestorData.parent;
    }
    logger.trace(
        `[getFinalSubdivisionAncestor] No final subdivision ancestor found for test element ${initialTestElementData.name} with unique ID: ${initialTestElementData.uniqueID}`
    );
    return null;
}

/**
 * Checks if the given test element represents a robot resource subdivision
 * that directly matches a regular expression.
 *
 * @param {TestElementData} element The test element data to check.
 * @returns True if the element is a "Subdivision" type and has a direct regex match, false otherwise.
 */
function isRobotResourceSubdivision(element: TestElementData): boolean {
    if (element.elementType !== "Subdivision") {
        return false;
    }
    return element.directRegexMatch;
}

/**
 * Searches upwards from the given test element to find its nearest ancestor
 * that represents a "Robot-Resource" subdivision.
 *
 * @param {TestElementTreeItem} treeItem The starting `TestElementTreeItem` from which to begin the search.
 * @returns {TestElementTreeItem | null} The `TestElementTreeItem` representing the Robot-Resource subdivision ancestor if found,
 * otherwise `null`.
 */
export function getRobotResourceAncestor(treeItem: TestElementTreeItem): TestElementTreeItem | null {
    const initialTestElementData = treeItem.testElementData;
    logger.trace(
        `[getRobotResourceAncestor] Searching Robot-Resource subdivision ancestor for test element ${initialTestElementData.name}`
    );
    let currentAncestorData = initialTestElementData.parent;
    while (currentAncestorData) {
        if (currentAncestorData.elementType === "Subdivision" && isRobotResourceSubdivision(currentAncestorData)) {
            logger.trace(
                `[getRobotResourceAncestor] Found Robot-Resource subdivision ancestor for test element ${initialTestElementData.name}: ${currentAncestorData.name}`
            );
            return new TestElementTreeItem(currentAncestorData);
        }
        currentAncestorData = currentAncestorData.parent;
    }
    logger.trace(
        `[getRobotResourceAncestor] No Robot-Resource subdivision ancestor found for test element ${initialTestElementData.name} with unique ID: ${initialTestElementData.uniqueID}`
    );
    return null;
}

/**
 * Traverses upward from an interaction element to find the nearest parent subdivision.
 * @param {TestElementTreeItem} treeItem The test element tree item representing an interaction.
 * @returns {TestElementTreeItem | null} The nearest subdivision ancestor, or null if not found.
 */
export function getSubdivisionAncestor(treeItem: TestElementTreeItem): TestElementTreeItem | null {
    const initialTestElementData: TestElementData = treeItem.testElementData;
    logger.trace(
        `[getSubdivisionAncestor] Searching subdivision ancestor for test element ${initialTestElementData.name}`
    );
    let currentAncestorData: TestElementData | undefined = initialTestElementData.parent;
    while (currentAncestorData) {
        if (currentAncestorData.elementType === "Subdivision") {
            logger.trace(
                `[getSubdivisionAncestor] Found subdivision ancestor for test element ${initialTestElementData.name}: ${currentAncestorData.name}`
            );
            return new TestElementTreeItem(currentAncestorData);
        }
        currentAncestorData = currentAncestorData.parent;
    }
    logger.trace(
        `[getSubdivisionAncestor] No subdivision ancestor found for test element ${initialTestElementData.name} with unique ID: ${initialTestElementData.uniqueID}`
    );
    return null;
}

/**
 * Computes the hierarchical name of a test element by concatenating parent names.
 * @param {TestElementTreeItem} treeItem The test element tree item.
 * @returns {string} The hierarchical name (e.g., "Root/Child").
 */
export function computeHierarchicalName(treeItem: TestElementTreeItem): string {
    const testElementData: TestElementData = treeItem.testElementData;
    if (testElementData.parent) {
        const parentTreeItem = new TestElementTreeItem(testElementData.parent);
        return `${computeHierarchicalName(parentTreeItem)}/${testElementData.name}`;
    }
    return testElementData.name;
}

/**
 * Removes all occurrences of "[Robot-Resource]" from a given path string.
 * @param {string} pathStr The original path string.
 * @returns {string} The cleaned path string.
 */
export function removeRobotResourceFromPathString(pathStr: string): string {
    const cleanedPath: string = pathStr.replace(/\[Robot-Resource\]/g, "");
    logger.trace(`[removeRobotResourceFromPathString] Removed [Robot-Resource] from path ${pathStr}: ${cleanedPath}`);
    return cleanedPath;
}

/**
 * Clears the test elements tree view by refreshing it with an empty array.
 */
export function clearTestElementsTreeView(): void {
    if (testElementsTreeDataProvider) {
        testElementsTreeDataProvider.setCurrentTovKey("");
        testElementsTreeDataProvider.isDataFetchAttempted = false;
        testElementsTreeDataProvider.refresh([]);
    }
}
