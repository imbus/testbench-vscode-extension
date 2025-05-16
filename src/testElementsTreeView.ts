/**
 * @file testElementsTreeView.ts
 * @description Provides a VS Code TreeDataProvider implementation to display test elements
 * retrieved from the TestBench server.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as utils from "./utils";
import {
    connection,
    logger,
    getConfig,
    getTestElementTreeView,
    getTestElementsTreeDataProvider as extensionGetTestElementsTreeDataProvider
} from "./extension";
import { ConfigKeys, TreeItemContextValues } from "./constants";

type TestElementType = "Subdivision" | "DataType" | "Interaction" | "Condition" | "Other";

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
 * Retrieves python resource regex patterns from the extension settings and converts them into JavaScript RegExps.
 * @returns {RegExp[]} An array of valid RegExp objects.
 */
function getResourceRegexPatternsFromExtensionSettings(): RegExp[] {
    const pythonResourceRegexPatternsInExtensionSettings: string[] = getConfig().get(
        "resourceRegexInTestbench2robotframework",
        []
    );
    logger.trace("Resource regex patterns from settings:", pythonResourceRegexPatternsInExtensionSettings);

    // Note: A complete conversion from python regex to javascript regex is not working as expected. If we only use simple regex patterns, we can use the existing code.
    // Convert Python-style named capture groups to JavaScript syntax, and handle other differences such as escaping.
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
        case "DataType":
            return `${item[`${elementType}_key`].serial}_${uniqueID}`;
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
        return item.parent.uniqueID ? `${item.parent.serial}_${item.parent.uniqueID}` : item.parent.serial;
    }

    return libraryKey ? String(libraryKey) : null;
}

/**
 * Builds a hierarchical tree from a flat array of JSON objects representing test elements.
 * Applies filtering based on element type and regex matching.
 * @param {any[]} flatJsonTestElements Flat array of JSON objects from the server.
 * @returns {TestElementData[]} An array of root TestElement objects forming the tree.
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

        // Display empty subdivisions if it directly matches the regex.
        if (testElement.elementType === "Subdivision") {
            if (filteredChildren.length === 0 && !testElement.directRegexMatch) {
                return null;
            }
        }

        if (doesInheritMatchFromParent || testElement.directRegexMatch || filteredChildren.length > 0) {
            return { ...testElement, children: filteredChildren };
        } else {
            return null;
        }
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
    const iconPaths = iconMapping[elementType] || iconMapping["Other"];

    if (!iconPaths) {
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

    const lightIconUri: vscode.Uri = vscode.Uri.file(path.join(__dirname, "..", "resources", "icons", iconPaths.light));
    const darkIconUri: vscode.Uri = vscode.Uri.file(path.join(__dirname, "..", "resources", "icons", iconPaths.dark));

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

        let tooltipText: string = `Type: ${this.testElementData.elementType || "N/A"}\nName: ${elementData.name || label}`;
        if (elementData.uniqueID) {
            tooltipText += `\nUniqueID: ${this.testElementData.uniqueID}`;
        }
        if (elementData.libraryKey) {
            tooltipText += `\nLibraryKey: ${elementData.libraryKey}`;
        }
        if (elementData.details?.hasVersion !== undefined) {
            tooltipText += `\nHas Version: ${elementData.details.hasVersion}`;
        }
        if (elementData.details?.status !== undefined) {
            tooltipText += `\nStatus: ${elementData.details.status}`;
        }

        // Append the original JSON representation (Useful for debugging).
        /*
        if (element.jsonString) {
            tooltip += `\n\nJSON Data:\n${element.jsonString}`;
        }
        */

        this.tooltip = tooltipText;

        // Display the uniqueID as a description next to the label.
        this.description = elementData.uniqueID || "";

        this.setIcon(getIconUriForElementType(this));
    }

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

    const testElementPathSegments: string[] = [];
    let currentElement: TestElementData | undefined = testElementTreeItem.testElementData;

    while (currentElement) {
        testElementPathSegments.unshift(currentElement.name);
        currentElement = currentElement.parent;
    }

    if (testElementPathSegments.length === 0) {
        logger.error(
            `No path parts found for test element ${testElementTreeItem.testElementData.name}. Returning undefined, cannot construct absolute path.`
        );
        return undefined;
    }

    const absoluteTestElementPath: string = path.join(workspaceRootPath, ...testElementPathSegments);
    logger.trace(
        `Constructed path from tree item ${testElementTreeItem.testElementData.name}: ${absoluteTestElementPath}`
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
        return;
    }

    logger.trace(
        `Updating icon for test element: ${testElementTreeItem.testElementData.name} with absolute path ${absolutePathOfTestElement}`
    );
    if (testElementTreeItem.testElementData.elementType !== "Subdivision") {
        testElementTreeItem.setIcon(getIconUriForElementType(testElementTreeItem));
    } else {
        logger.trace(`Updating icon for subdivision: ${testElementTreeItem.testElementData.name}`);
        const isLocal: boolean = await isSubdivisionLocallyAvailable(testElementTreeItem, absolutePathOfTestElement);

        if (isLocal) {
            const localIconUri = {
                light: vscode.Uri.file(
                    path.join(__dirname, "..", "resources", "icons", iconMapping["LocalSubdivision"].light)
                ),
                dark: vscode.Uri.file(
                    path.join(__dirname, "..", "resources", "icons", iconMapping["LocalSubdivision"].dark)
                )
            };
            testElementTreeItem.setIcon(localIconUri);
        } else {
            const missingIconUri = {
                light: vscode.Uri.file(
                    path.join(__dirname, "..", "resources", "icons", iconMapping["MissingSubdivision"].light)
                ),
                dark: vscode.Uri.file(
                    path.join(__dirname, "..", "resources", "icons", iconMapping["MissingSubdivision"].dark)
                )
            };
            testElementTreeItem.setIcon(missingIconUri);
        }
    }
}

/**
 * TestElementsTreeDataProvider implements the VS Code TreeDataProvider interface for test elements.
 */
export class TestElementsTreeDataProvider implements vscode.TreeDataProvider<TestElementTreeItem> {
    public _onDidChangeTreeData: vscode.EventEmitter<TestElementTreeItem | undefined> = new vscode.EventEmitter<
        TestElementTreeItem | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<TestElementTreeItem | undefined> = this._onDidChangeTreeData.event;
    private treeData: TestElementData[] = [];

    private _currentTovKey: string = "";
    public getCurrentTovKey(): string {
        return this._currentTovKey;
    }
    public setCurrentTovKey(tovKey: string): void {
        this._currentTovKey = tovKey;
    }

    // Flag to be able to set a proper tree view message
    private dataFetchAttempted: boolean = false;
    public setDataFetchAttempted(attempted: boolean): void {
        this.dataFetchAttempted = attempted;
    }

    private updateTreeViewStatusMessageCallback: (message: string | undefined) => void;

    constructor(updateMessageCallback: (message: string | undefined) => void) {
        this.updateTreeViewStatusMessageCallback = updateMessageCallback;
    }

    public setTreViewMessage(message: string | undefined): void {
        this.updateTreeViewStatusMessageCallback(message);
    }

    public updateTreeViewStatusMessage(): void {
        if (this.isTreeDataEmpty()) {
            if (!this.dataFetchAttempted) {
                this.setTreViewMessage(
                    "Select a Test Object Version (TOV) from the 'Projects' view to load test elements."
                );
            } else {
                const filterPatterns = getConfig().get("resourceRegexInTestbench2robotframework", []);
                if (filterPatterns && filterPatterns.length > 0) {
                    this.setTreViewMessage("No test elements match the current filter criteria.");
                } else {
                    this.setTreViewMessage("No test elements found for the selected Test Object Version (TOV).");
                }
            }
        } else {
            this.setTreViewMessage(undefined);
        }
    }

    public isTreeDataEmpty(): boolean {
        return !this.treeData || this.treeData.length === 0;
    }

    getTreeItem(item: TestElementTreeItem): vscode.TreeItem {
        return item;
    }

    /**
     * Returns the children for a given test element.
     * @param {TestElementTreeItem} testElementTreeItem Optional parent TestElementTreeItem.
     * @returns {Thenable<TestElementTreeItem[]>} A promise resolving to an array of TestElementTreeItems.
     */
    async getChildren(testElementTreeItem?: TestElementTreeItem): Promise<TestElementTreeItem[]> {
        if (testElementTreeItem) {
            const children: TestElementData[] = testElementTreeItem.testElementData.children || [];
            const childItems: TestElementTreeItem[] = await Promise.all(
                children.map(async (child: any) => {
                    const childItem = new TestElementTreeItem(child);
                    await updateTestElementIcon(childItem);
                    return childItem;
                })
            );
            return childItems;
        } else {
            if (this.isTreeDataEmpty()) {
                logger.trace(
                    "TestElementsTreeDataProvider: No tree data found for root, returning empty. Message should be set."
                );
                return [];
            }

            const rootTreeItems: TestElementTreeItem[] = await Promise.all(
                this.treeData.map(async (child) => {
                    const childItem: TestElementTreeItem = new TestElementTreeItem(child);
                    await updateTestElementIcon(childItem);
                    return childItem;
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
        this.treeData = buildTree(flatTestElementsJsonData);
        const currentElementTreeView = getTestElementTreeView();
        if (currentElementTreeView) {
            if (this.isTreeDataEmpty()) {
                const filterPatterns = getConfig().get(ConfigKeys.TB2ROBOT_RESOURCE_REGEX, []);
                if (filterPatterns && filterPatterns.length > 0) {
                    this.updateTreeViewStatusMessageCallback("No test elements match the current filter criteria.");
                } else {
                    this.updateTreeViewStatusMessageCallback(
                        "No test elements found for the selected Test Object Version (TOV)."
                    );
                }
                logger.trace(`Test Elements view message set: ${currentElementTreeView.message}`);
            } else {
                this.updateTreeViewStatusMessageCallback(undefined);
                logger.trace("Test Elements view message cleared.");
            }
        }

        this._onDidChangeTreeData.fire(undefined);
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

        this.setDataFetchAttempted(true);

        const tovLabel: string = newTestElementsTreeViewTitle || tovKey;
        this.updateTreeViewStatusMessageCallback(`Loading test elements for TOV: ${tovLabel}...`);

        // Clear current data and trigger UI update to show loading message
        this.treeData = [];
        this._onDidChangeTreeData.fire(undefined);

        const testElementsJsonData = await connection?.getTestElementsWithTovKeyUsingOldPlayServer(tovKey);
        if (testElementsJsonData) {
            this._currentTovKey = tovKey;
            this.refresh(testElementsJsonData);
            const currentElementTreeView = getTestElementTreeView();

            if (newTestElementsTreeViewTitle && currentElementTreeView) {
                currentElementTreeView.title = `Test Elements (${newTestElementsTreeViewTitle})`;
            }
            return true;
        } else {
            this._currentTovKey = "";
            vscode.window.showErrorMessage("Failed to fetch test elements from the server.");
            this.updateTreeViewStatusMessageCallback(
                "Error: Failed to fetch test elements. Please try again or check logs."
            );
            this.treeData = [];
            this._onDidChangeTreeData.fire(undefined);

            return false;
        }
    }
}

/**
 * Hides the Test Elements tree view.
 */
export async function hideTestElementsTreeView(): Promise<void> {
    if (getTestElementTreeView()) {
        await vscode.commands.executeCommand("testElementsView.removeView");
    } else {
        logger.warn("Test Elements view instance not found, 'removeView' command not executed.");
    }
}

/**
 * Displays the Test Elements tree view.
 */
export async function displayTestElementsTreeView(): Promise<void> {
    if (getTestElementTreeView()) {
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
    logger.trace(`Checking if file exists: ${filePath}`);
    if (!caseSensitiveCheck) {
        // Check with stat is case-insensitive
        try {
            await fs.promises.stat(filePath);
            logger.trace(`File exists with case-insensitive check: ${filePath}`);
            return true;
        } catch (err: any) {
            if (err.code === "ENOENT") {
                logger.trace(`File does not exist: ${filePath}`);
                return false;
            }
            throw err;
        }
    }

    const absoluteFilePath: string = path.resolve(filePath);
    // Split the path into its parts. Filtering out any empty strings (e.g., due to leading separators).
    const filePathSegments: string[] = absoluteFilePath.split(path.sep).filter((part) => part !== "");

    logger.trace(`Resolved path: ${absoluteFilePath}`);

    // Determine the starting point (the root)
    let currentPath: string;
    if (path.isAbsolute(absoluteFilePath)) {
        if (process.platform === "win32") {
            // On Windows, the first part is typically the drive letter (e.g., "C:")
            currentPath = filePathSegments[0] + path.sep;
            // Remove the drive letter from the parts.
            filePathSegments.shift();
        } else {
            currentPath = path.sep;
        }
    } else {
        // For relative paths, start with an empty string.
        currentPath = "";
    }

    for (const pathSegment of filePathSegments) {
        let directoryEntries: string[];
        try {
            directoryEntries = await fs.promises.readdir(currentPath);
            // logger.trace(`Entries in ${currentPath}: ${entries}`);
        } catch (err: any) {
            if (err.code === "ENOENT") {
                logger.trace(`Path does not exist: ${currentPath}`);
                return false;
            }
            throw err;
        }
        if (!directoryEntries.includes(pathSegment)) {
            logger.trace(`Returning false, part ${pathSegment} not found in ${currentPath}`);
            return false;
        }
        logger.trace(`Part ${pathSegment} found in ${currentPath}`);
        currentPath = path.join(currentPath, pathSegment);
    }

    logger.trace(`File exists with exact case, returning true: ${absoluteFilePath}`);
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
    logger.trace(`Checking if subdivision exists locally: ${absolutePathOfTestElement}`);
    if (testElementTreeItem.testElementData.elementType !== "Subdivision") {
        logger.trace(`Element is not a subdivision, returning false.`);
        return false;
    }

    const isFinalSubdivision: boolean = isFinalSubdivisionInTree(testElementTreeItem.testElementData);

    if (isFinalSubdivision) {
        logger.trace(
            `Checking if the resource file for final subdivision '${testElementTreeItem.testElementData.name}' exists locally.`
        );
        let processedFinalSubdivisionPath: string = removeRobotResourceFromPathString(absolutePathOfTestElement);
        processedFinalSubdivisionPath = appendResourceExtensionAndTrimPath(processedFinalSubdivisionPath);
        const isSubdivisionResourceFilePresent: boolean = await isFilePresentLocally(processedFinalSubdivisionPath);
        logger.trace(
            `Final subdivision '${testElementTreeItem.testElementData.name}' exists locally as resource file: ${isSubdivisionResourceFilePresent}`
        );
        return isSubdivisionResourceFilePresent;
    } else {
        logger.trace(
            `Checking if the non-final subdivision folder '${testElementTreeItem.testElementData.name}' exists locally.`
        );
        const processedNonFinalSubdivisionPath: string = removeRobotResourceFromPathString(absolutePathOfTestElement);
        const isSubdivisionFolderPresent: boolean = await isFilePresentLocally(processedNonFinalSubdivisionPath);
        logger.trace(
            `Non-Final subdivision '${testElementTreeItem.testElementData.name}' exists locally: ${isSubdivisionFolderPresent}`
        );
        return isSubdivisionFolderPresent;
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
                    throw new Error(`Path component exists but is not a directory: ${currentPath}`);
                }
            } catch (error: any) {
                if (error.code === "ENOENT") {
                    await fs.promises.mkdir(currentPath, { recursive: true });
                    logger.trace(`Created directory: ${currentPath}`);
                } else {
                    throw error;
                }
            }
        }
    } catch (error) {
        logger.error(`Failed to create folder structure: ${error}`);
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
                const fileContent: string = `*** Settings ***\nDocumentation    tb:uid:${subdivisionTreeItem.testElementData.uniqueID}\n`;
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
        const teProvider = extensionGetTestElementsTreeDataProvider();
        teProvider?._onDidChangeTreeData.fire(undefined);
    } catch (error: any) {
        logger.error(`Failed to handle subdivision: ${error}`);
        vscode.window.showErrorMessage(`Failed to create folder structure: ${error.message}`);
    }
}

/**
 * Handles an interaction element by opening the resource file of its nearest final subdivision .resource file.
 * @param {TestElementTreeItem} treeItem The test element tree item representing an interaction.
 */
export async function handleInteraction(treeItem: TestElementTreeItem): Promise<void> {
    const workspaceRootPath: string | undefined = await utils.validateAndReturnWorkspaceLocation();
    if (!workspaceRootPath) {
        return;
    }
    const testElement: TestElementData = treeItem.testElementData;

    const finalSubdivisionAncestor: TestElementTreeItem | null = getFinalSubdivisionAncestor(treeItem);
    if (!finalSubdivisionAncestor) {
        // If no final subdivision is found: handle the case as if its parent subdivision is clicked.
        const subdivisionAncestor: TestElementTreeItem | null = getSubdivisionAncestor(treeItem);
        if (subdivisionAncestor) {
            logger.trace(
                `Subdivision Ancestor of Interaction '${testElement.uniqueID}': `,
                subdivisionAncestor.testElementData
            );
            await handleSubdivision(subdivisionAncestor);
            return;
        } else {
            return;
        }
    }

    if (!finalSubdivisionAncestor.testElementData.hierarchicalName) {
        finalSubdivisionAncestor.testElementData.hierarchicalName = computeHierarchicalName(finalSubdivisionAncestor);
        logger.trace(
            `Computed hierarchical name for final subdivision: ${finalSubdivisionAncestor.testElementData.hierarchicalName}`
        );
    }
    const finalSubdivisionAncestorAbsolutePath: string | undefined =
        await constructAbsolutePathForTestElement(finalSubdivisionAncestor);
    if (!finalSubdivisionAncestorAbsolutePath) {
        return;
    }
    let processedFinalSubdivisionAncestorPath: string = removeRobotResourceFromPathString(
        finalSubdivisionAncestorAbsolutePath
    );
    processedFinalSubdivisionAncestorPath = appendResourceExtensionAndTrimPath(processedFinalSubdivisionAncestorPath);

    if (!(await isFilePresentLocally(processedFinalSubdivisionAncestorPath))) {
        await createFolderStructure(path.dirname(processedFinalSubdivisionAncestorPath));

        const fileContent: string = `*** Settings ***\nDocumentation    tb:uid:${finalSubdivisionAncestor.testElementData.uniqueID}\n`;

        await fs.promises.writeFile(processedFinalSubdivisionAncestorPath, fileContent);
        logger.trace(`Resource file created at ${processedFinalSubdivisionAncestorPath}`);
    } else {
        logger.trace(
            `Skipping creation of resource file at ${processedFinalSubdivisionAncestorPath} as it already exists.`
        );
    }

    const finalSubdivisionResourceFileDocument: vscode.TextDocument = await vscode.workspace.openTextDocument(
        vscode.Uri.file(processedFinalSubdivisionAncestorPath)
    );
    await vscode.window.showTextDocument(finalSubdivisionResourceFileDocument);
    await vscode.commands.executeCommand("workbench.files.action.showActiveFileInExplorer");

    // Trigger subdivision icon update
    const teProvider = extensionGetTestElementsTreeDataProvider();
    teProvider?._onDidChangeTreeData.fire(undefined);
}

/**
 * Handles fallback for opening a test element file.
 * @param {string} targetPath The target file path.
 */
export async function handleFallback(targetPath: string): Promise<void> {
    if (!(await isFilePresentLocally(targetPath))) {
        const dirName: string = path.dirname(targetPath);
        await fs.promises.mkdir(dirName, { recursive: true });
        await fs.promises.writeFile(targetPath, "");
    }
    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("workbench.files.action.showActiveFileInExplorer");
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
        logger.error("Error creating interaction tree item:", error);
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
        logger.trace(`Element ${element.name} is not a subdivision.`);
        return false;
    }
    if (!element.children) {
        logger.trace(`Element ${element.name} has no children and is final.`);
        return true;
    }
    const isFinalSubdivision: boolean = !element.children.some(
        (child: { elementType: string }) => child.elementType === "Subdivision"
    );

    if (isFinalSubdivision) {
        logger.trace(`Test element ${element.name} is a final subdivision.`);
    } else {
        logger.trace(`Test element ${element.name} is not a final subdivision.`);
    }

    return isFinalSubdivision;
}

/**
 * Traverses upward from an interaction element to find the nearest final subdivision.
 * @param {TestElementTreeItem} treeItem The test element tree item representing an interaction.
 * @returns {TestElementTreeItem | null} The nearest final subdivision ancestor, or null if not found.
 */
export function getFinalSubdivisionAncestor(treeItem: TestElementTreeItem): TestElementTreeItem | null {
    const testElement = treeItem.testElementData;
    logger.trace(`Searching final subdivision ancestor for test element ${testElement.name}`);
    let current = testElement.parent;
    while (current) {
        if (current.elementType === "Subdivision" && isFinalSubdivisionInTree(current)) {
            logger.trace(`Found final subdivision ancestor for test element ${testElement.name}: ${current.name}`);
            return new TestElementTreeItem(current);
        }
        current = current.parent;
    }
    logger.trace(
        `No final subdivision ancestor found for test element ${testElement.name} with unique ID: ${testElement.uniqueID}`
    );
    return null;
}

/**
 * Traverses upward from an interaction element to find the nearest parent subdivision.
 * @param {TestElementTreeItem} treeItem The test element tree item representing an interaction.
 * @returns {TestElementTreeItem | null} The nearest subdivision ancestor, or null if not found.
 */
export function getSubdivisionAncestor(treeItem: TestElementTreeItem): TestElementTreeItem | null {
    const testElement: TestElementData = treeItem.testElementData;
    logger.trace(`Searching subdivision ancestor for test element ${testElement.name}`);
    let current: TestElementData | undefined = testElement.parent;
    while (current) {
        if (current.elementType === "Subdivision") {
            logger.trace(`Found subdivision ancestor for test element ${testElement.name}: ${current.name}`);
            return new TestElementTreeItem(current);
        }
        current = current.parent;
    }
    logger.trace(
        `No subdivision ancestor found for test element ${testElement.name} with unique ID: ${testElement.uniqueID}`
    );
    return null;
}

/**
 * Computes the hierarchical name of a test element by concatenating parent names.
 * @param {TestElementTreeItem} treeItem The test element tree item.
 * @returns {string} The hierarchical name (e.g., "Root/Child").
 */
export function computeHierarchicalName(treeItem: TestElementTreeItem): string {
    const testElement: TestElementData = treeItem.testElementData;
    return testElement.parent
        ? computeHierarchicalName(new TestElementTreeItem(testElement.parent)) + "/" + testElement.name
        : testElement.name;
}

/**
 * Removes all occurrences of "[Robot-Resource]" from a given path string.
 * @param {string} pathStr The original path string.
 * @returns {string} The cleaned path string.
 */
export function removeRobotResourceFromPathString(pathStr: string): string {
    const cleanedPath: string = pathStr.replace(/\[Robot-Resource\]/g, "");
    logger.trace(`Removed [Robot-Resource] from path ${pathStr}: ${cleanedPath}`);
    return cleanedPath;
}

/**
 * Clears the test elements tree view by refreshing it with an empty array.
 */
export function clearTestElementsTreeView(): void {
    const teProvider = extensionGetTestElementsTreeDataProvider();
    if (teProvider) {
        teProvider.setCurrentTovKey("");
        teProvider.setDataFetchAttempted(false);
        teProvider.refresh([]);
    }
}
