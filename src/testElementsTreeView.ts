/**
 * @file testElementsTreeView.ts
 * @description Provides a VS Code TreeDataProvider implementation to display test elements
 * retrieved from the TestBench server.
 */

// TODO: If the test element view is empty due to the filtering, show a message to the user that no elements are mathed with the regex?

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as utils from "./utils";
import { connection, logger, getConfig, testElementTreeView, getTestElementsTreeDataProvider } from "./extension";

/* =============================================================================
   Global Variables and Helper Functions
   ============================================================================= */

/** Stores the current TOV key used for fetching interactions. */
let currentTovKeyOfInteractionsInView: string = "";

/**
 * Returns the current TOV key.
 * @returns The current TOV key.
 */
export function getCurrentTovKey(): string {
    return currentTovKeyOfInteractionsInView;
}

/**
 * Sets the current TOV key.
 * @param {string} newTovKey The new TOV key.
 */
export function setCurrentTovKey(newTovKey: string): void {
    currentTovKeyOfInteractionsInView = newTovKey;
}

/**
 * Allowed element types for test elements.
 */
type ElementType = "Subdivision" | "DataType" | "Interaction" | "Condition" | "Other";

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
    elementType: ElementType;
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

        // Replace \s* with \s* (already correct in this case, but still execute)
        javascriptRegex = javascriptRegex.replace(/\\s\*/g, "\\s*");

        // Replace [Robot-Resource] with \[Robot-Resource\]
        javascriptRegex = javascriptRegex.replace(/\[Robot-Resource\]/g, "\\[Robot-Resource\\]");

        // Replace .* with .* (already correct in this case, but still execute)
        javascriptRegex = javascriptRegex.replace(/\.\*/g, "\\.*");

        // Replace . with \.
        javascriptRegex = javascriptRegex.replace(/(?<!\\)\./g, "\\.");

        return javascriptRegex;
    }

    const JSlibraryRegexPatterns = pythonResourceRegexPatternsInExtensionSettings
        .map((pythonRegexPattern) => {
            logger.trace(`Converting python regex pattern: ${pythonRegexPattern}`);
            const convertedJSPattern = convertPythonRegexToJs(pythonRegexPattern);
            logger.trace(`Converted to javascript regex pattern: ${convertedJSPattern}`);
            try {
                const regex = new RegExp(convertedJSPattern, "u");
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
 * @returns {ElementType} The type of the test element.
 */
function getTestElementTreeItemType(item: any): ElementType {
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
 * @param {ElementType} elementType The type of the test element.
 * @param {string} uniqueID The unique ID string.
 * @returns {string} The unique ID of the test element.
 */
function generateTestElementTreeItemId(item: any, elementType: ElementType, uniqueID: string): string {
    switch (elementType) {
        case "Subdivision":
        case "Interaction":
        case "Condition":
        case "DataType":
            // Use a consistent ID format for all keyed elements.
            return `${item[`${elementType}_key`].serial}_${uniqueID}`;
        default:
            // Fallback: use uniqueID as the identifier if no key-specific id is found.
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
        // During tree linking we match composite ids (which start with parent's serial)
        // "serial_uniqueID" is used for uniqueness even for elements with identical serials.
        return item.parent.uniqueID ? `${item.parent.serial}_${item.parent.uniqueID}` : item.parent.serial;
    }
    // If the element has no parent, use the libraryKey as the parent.
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
    const map: { [id: string]: TestElementData } = {};

    // Process each JSON object and create a TestElement.
    flatJsonTestElements.forEach((item) => {
        // Process the libraryKey: if it is an object with a 'serial' property, use that.
        // Otherwise, use the key as a string.
        let libraryKey: string | null = null;
        if (item.libraryKey) {
            if (typeof item.libraryKey === "object" && item.libraryKey.serial) {
                libraryKey = item.libraryKey.serial;
            } else {
                libraryKey = item.libraryKey;
            }
        }

        // Determine the element type and compute the id of the element.
        const testElementType: ElementType = getTestElementTreeItemType(item);
        // Each element type has a unique key property that is used as the identifier.
        const IDOfTestElement: string = generateTestElementTreeItemId(item, testElementType, item.uniqueID);
        // Determine the parent ID of the element. Use the 'parent' property if valid; otherwise, use the libraryKey as the parent.
        const parentId: string | null = getItemParentId(item, libraryKey);

        // Compute whether this element directly matches the regex filter.
        // If resouce regex patterns exist in the extension settings, use them. Otherwise, include all elements without filtering.
        const directRegexMatch: boolean =
            resourceRegexPatternsInExtensionSettings.length > 0
                ? matchesRegex(item.name, resourceRegexPatternsInExtensionSettings)
                : true;

        // Create the TestElement object.
        const testElement: TestElementData = {
            id: IDOfTestElement,
            parentId,
            name: item.name,
            uniqueID: item.uniqueID,
            libraryKey,
            jsonString: JSON.stringify(item, null, 2),
            details: item,
            elementType: testElementType,
            directRegexMatch: directRegexMatch,
            children: []
        };

        // Store the current element in the map.
        map[IDOfTestElement] = testElement;
    });

    // Build the full tree structure by assigning children to their respective parents.
    const rootsOfTestElementView: TestElementData[] = [];
    Object.values(map).forEach((testElement) => {
        if (testElement.parentId) {
            // Find the parent by matching a composite id (parent's serial + uniqueID).
            const parent: TestElementData | undefined = Object.values(map).find((p) =>
                p.id.startsWith(`${testElement.parentId}_`)
            );
            if (parent) {
                testElement.parent = parent;
                parent.children!.push(testElement);
            } else {
                // If the element has no parent, it is a root element.
                rootsOfTestElementView.push(testElement);
            }
        } else {
            // If the element has no parent, it is a root element.
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
     * @param {boolean} inherited True if the element inherits a match from a parent.
     * @returns {TestElementData | null} The filtered element or null if excluded.
     */
    function filterTestElementsTree(testElement: TestElementData, inherited: boolean): TestElementData | null {
        // Process and filter children recursively before filtering the current (parent) element.
        let filteredChildren: TestElementData[] = [];
        if (testElement.children) {
            // Determine if the children should inherit inclusion:
            // If the current element directly matches the regex or is already inherited, mark children as inherited.
            const childrenInherited: boolean = inherited || testElement.directRegexMatch;
            // Store the result of filtering the children, which will be used to determine if the current element should be included.
            filteredChildren = testElement.children
                .map((child) => filterTestElementsTree(child, childrenInherited))
                .filter((child) => child !== null) as TestElementData[];
        }

        // Filter out elements of type DataType or Condition.
        if (testElement.elementType === "DataType" || testElement.elementType === "Condition") {
            return null;
        }

        // For subdivisions, filter out the subdivision element if it has no children that match the regex.
        // Display the empty subdivision if it directly matches the regex.
        if (testElement.elementType === "Subdivision") {
            if (filteredChildren.length === 0 && !testElement.directRegexMatch) {
                return null;
            }
        }

        // Include the current element if it
        // 1- Inherits a match from a parent
        // 2- Directly matches the regex
        // 3- Has at least one regex matching child
        if (inherited || testElement.directRegexMatch || filteredChildren.length > 0) {
            return { ...testElement, children: filteredChildren };
        } else {
            // Exclude the element if it neither directly matches nor has any matching descendants.
            return null;
        }
    }

    // Apply filtering to each root and return only non-null elements.
    const filteredRoots: TestElementData[] = rootsOfTestElementView
        .map((root) => filterTestElementsTree(root, false))
        .filter((node): node is TestElementData => node !== null);

    /**
     * Recursively assigns hierarchical names (full paths) to each element.
     * @param {TestElementData} element The element.
     * @param {string} parentPath The accumulated parent path.
     */
    function assignHierarchicalNames(element: TestElementData, parentPath: string): void {
        // Compute the current hierarchical path.
        const currentPath: string = parentPath ? `${parentPath}/${element.name}` : element.name;
        element.hierarchicalName = currentPath;
        if (element.children && element.children.length > 0) {
            element.children.forEach((child: any) => assignHierarchicalNames(child, currentPath));
        }
    }
    filteredRoots.forEach((root) => assignHierarchicalNames(root, ""));

    // Identify nested robot resources, which is not allowed, and warn the user if found.
    const nestedRobotResources: string[] = [];
    /**
     * Recursively checks for nested robot resources.
     * If a robot resource is found under another robot resource, raise a warning.
     * @param {TestElementData} testElement The element to check.
     */
    function checkForNestedRobotResources(testElement: TestElementData): void {
        if (testElement.directRegexMatch) {
            // Check each child: if any child is also a robot resource, raise a warning.
            for (const child of testElement.children || []) {
                if (child.directRegexMatch) {
                    // Instead of storing the test elements, store a warning message.
                    nestedRobotResources.push(
                        `Robot resource '${testElement.name}' contains another robot resource '${child.name}'.`
                    );
                }
                // Continue checking children recursively.
                checkForNestedRobotResources(child);
            }
        } else {
            // If current element is not a robot resource, still check its children.
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
    const elementType = treeItem.testElementData.elementType;
    logger.trace(`Getting icon for element type: ${elementType}`);

    // Fallback to "Other" if the elementType is not defined or not in the iconMapping
    const iconPaths = iconMapping[elementType] || iconMapping["Other"];

    if (!iconPaths) {
        logger.error(`No icon mapping found for element type: ${elementType}. Falling back to default icon.`);
        const defaultIconPaths = iconMapping["Other"];
        const lightIconUri = vscode.Uri.file(path.join(__dirname, "..", "resources", "icons", defaultIconPaths.light));
        const darkIconUri = vscode.Uri.file(path.join(__dirname, "..", "resources", "icons", defaultIconPaths.dark));
        return { light: lightIconUri, dark: darkIconUri };
    }

    const lightIconUri = vscode.Uri.file(path.join(__dirname, "..", "resources", "icons", iconPaths.light));
    const darkIconUri = vscode.Uri.file(path.join(__dirname, "..", "resources", "icons", iconPaths.dark));

    return { light: lightIconUri, dark: darkIconUri };
}

/* =============================================================================
   TestElementTreeItem Class and TestElementsTreeDataProvider
   ============================================================================= */

/**
 * TestElementTreeItem represents a test element in the VS Code tree view.
 */
export class TestElementTreeItem extends vscode.TreeItem {
    public readonly testElementData: TestElementData;

    /**
     * Constructs a new TestElementTreeItem.
     * @param elementData The test element.
     */
    constructor(elementData: TestElementData) {
        // Set the label to the element's name.
        // Determine collapsibility based on whether the element has children.
        super(
            elementData.name,
            elementData.children && elementData.children.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        this.testElementData = elementData;
        // Set the context value to enable context menu contributions.
        this.contextValue = "testElement"; // This value is used in package.json to enable context menu contributions.

        // Build a tooltip string with detailed information about the element.
        let tooltip = `Type: ${elementData.elementType}\nName: ${elementData.name}\nUniqueID: ${elementData.uniqueID}`;
        if (elementData.libraryKey) {
            tooltip += `\nLibraryKey: ${elementData.libraryKey}`;
        }
        if (elementData.details.hasVersion !== undefined) {
            tooltip += `\nHas Version: ${elementData.details.hasVersion}`;
        }
        if (elementData.details.status !== undefined) {
            tooltip += `\nStatus: ${elementData.details.status}`;
        }

        // Append the original JSON representation (Useful for debugging).
        /*
        if (element.jsonString) {
            tooltip += `\n\nJSON Data:\n${element.jsonString}`;
        }
        */

        this.tooltip = tooltip;

        // Display the uniqueID as a description next to the label.
        this.description = elementData.uniqueID || "";

        // Set the initial icon based on the element type.
        this.setIcon(getIconUriForElementType(this));
    }

    public setIcon(newIconPath: { light: vscode.Uri; dark: vscode.Uri }): void {
        this.iconPath = newIconPath;
    }
}

/**
 * Constructs the absolute path for a test element based on the workspace root and hierarchical name.
 *
 * @param {TestElementTreeItem} testElementTreeItem The test element tree item.
 * @returns {Promise<string | undefined>} The absolute path of the test element, or undefined if not found.
 */
export async function constructAbsolutePathForTestElement(
    testElementTreeItem: TestElementTreeItem
): Promise<string | undefined> {
    const workspaceRootPath = await utils.validateAndReturnWorkspaceLocation();
    if (!workspaceRootPath) {
        logger.trace(
            `No workspace root path found while constructing absolute path for test element: ${testElementTreeItem.testElementData.name}`
        );
        return undefined;
    }

    // Construct the target path based on the hierarchical name of the test element.
    const absolutePathOfTestElement = path.join(
        workspaceRootPath,
        ...(testElementTreeItem.testElementData.hierarchicalName || "").split("/")
    );

    if (!absolutePathOfTestElement) {
        logger.trace(
            `No absolute path found while constructing absolute path for test element: ${testElementTreeItem.testElementData.name}`
        );
        return undefined;
    }

    return absolutePathOfTestElement;
}

/**
 * Updates the icon of a Subdivision based on whether it is locally available or not.
 * @param {TestElementTreeItem} testElementTreeItem The TestElementTreeItem to update.
 * @returns {Promise<void>} A promise that resolves when the icon is updated.
 */
export async function updateTestElementIcon(testElementTreeItem: TestElementTreeItem): Promise<void> {
    const absolutePathOfTestElement = await constructAbsolutePathForTestElement(testElementTreeItem);
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
            const children = testElementTreeItem.testElementData.children || [];
            const childItems = await Promise.all(
                children.map(async (child: any) => {
                    const childItem = new TestElementTreeItem(child);
                    await updateTestElementIcon(childItem);
                    return childItem;
                })
            );
            return childItems;
        } else {
            // If no parent is provided, return the root items.
            const rootItems = await Promise.all(
                this.treeData.map(async (child) => {
                    const childItem = new TestElementTreeItem(child);
                    await updateTestElementIcon(childItem);
                    return childItem;
                })
            );
            return rootItems;
        }
    }

    /**
     * Refreshes the tree view with new data.
     * @param {any} flatTestElementsJsonData A flat array of JSON objects representing test elements.
     */
    refresh(flatTestElementsJsonData: any[]): void {
        this.treeData = buildTree(flatTestElementsJsonData);
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Fetches test elements using a TOV key and updates the tree view.
     * @param {string} tovKey The TOV key.
     * @param {string} newTestElementsTreeViewTitle Optional new title for the tree view.
     * @returns {Promise<void>} A promise that resolves when the tree view is updated.
     */
    async fetchAndDisplayTestElements(tovKey: string, newTestElementsTreeViewTitle?: string): Promise<void> {
        // For testing with a local JSON file.
        // const jsonPath = "ABSOLUTE-PATH-TO-JSON-FILE";
        // const testElementsJsonData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

        // Commented out for debugging purposes
        const testElementsJsonData = await connection?.getTestElementsWithTovKeyOldPlayServer(tovKey);
        if (testElementsJsonData) {
            setCurrentTovKey(tovKey);
            displayTestElementsTreeView();
            this.refresh(testElementsJsonData);
            if (newTestElementsTreeViewTitle) {
                testElementTreeView.title = `Test Elements (${newTestElementsTreeViewTitle})`;
            }
        } else {
            vscode.window.showErrorMessage("Failed to fetch test elements from the server.");
        }
    }
}

/* =============================================================================
   View Management Functions
   ============================================================================= */

/**
 * Hides the Test Elements tree view.
 */
export async function hideTestElementsTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testElementsView.removeView");
}

/**
 * Displays the Test Elements tree view.
 */
export async function displayTestElementsTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testElementsView.focus");
}

/* =============================================================================
   Test Element File Handling Functions
   ============================================================================= */

/**
 * Normalizes a given base target path by making sure it ends with ".resource" and removing any
 * whitespace immediately preceding ".resource" as well as any trailing whitespace.
 *
 * @param {string} baseTargetPath - The input path string to normalize.
 * @returns {string} The normalized path string ending with ".resource" without extraneous whitespace.
 */
function appendResourceExtensionAndTrimPath(baseTargetPath: string): string {
    logger.trace(`Adding .resource extension and trimming the following path: ${baseTargetPath}`);

    // Append ".resource" if it is not already present at the end of the string.
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
        // Case-insensitive check: simply use stat.
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

    // For a case-sensitive check on the entire path hierarchy:
    // Resolve the absolute path.
    const resolvedPath: string = path.resolve(filePath);
    // Split the path into its parts. Filtering out any empty strings (e.g., due to leading separators).
    const parts: string[] = resolvedPath.split(path.sep).filter((part) => part !== "");

    logger.trace(`Resolved path: ${resolvedPath}`);

    // Determine the starting point (the root)
    let currentPath: string;
    if (path.isAbsolute(resolvedPath)) {
        if (process.platform === "win32") {
            // On Windows, the first part is typically the drive letter (e.g., "C:")
            currentPath = parts[0] + path.sep;
            parts.shift(); // Remove the drive letter from the parts.
        } else {
            currentPath = path.sep;
        }
    } else {
        // For relative paths, start with an empty string.
        currentPath = "";
    }

    // Walk through each part and verify that it exists with the exact case.
    for (const part of parts) {
        let entries: string[];
        try {
            entries = await fs.promises.readdir(currentPath);
            // logger.trace(`Entries in ${currentPath}: ${entries}`);
        } catch (err: any) {
            if (err.code === "ENOENT") {
                logger.trace(`Path does not exist: ${currentPath}`);
                return false;
            }
            throw err;
        }
        // Check if the current part exactly matches one of the entries.
        if (!entries.includes(part)) {
            logger.trace(`Returning false, part ${part} not found in ${currentPath}`);
            return false;
        }
        logger.trace(`Part ${part} found in ${currentPath}`);
        currentPath = path.join(currentPath, part);
    }

    logger.trace(`File exists with exact case, returning true: ${resolvedPath}`);
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

    // Determine if the subdivision is final (i.e., has no child subdivisions)
    const isFinalSubdivision: boolean = isFinalSubdivisionInTree(testElementTreeItem.testElementData);

    if (isFinalSubdivision) {
        // For final subdivisions, check if the resource file exists.
        logger.trace(
            `Checking if the resource file for final subdivision '${testElementTreeItem.testElementData.name}' exists locally.`
        );
        // Remove the "Robot-Resource" part from the path.
        let processedFinalSubdivisionPath: string = removeRobotResourceFromPathString(absolutePathOfTestElement);
        // Append ".resource" and trim the path.
        processedFinalSubdivisionPath = appendResourceExtensionAndTrimPath(processedFinalSubdivisionPath);
        const isSubdivisionResourceFilePresent: boolean = await isFilePresentLocally(processedFinalSubdivisionPath);
        logger.trace(
            `Final subdivision '${testElementTreeItem.testElementData.name}' exists locally as resource file: ${isSubdivisionResourceFilePresent}`
        );
        return isSubdivisionResourceFilePresent;
    } else {
        // For non-final subdivisions, check if the subdivision folder exists
        logger.trace(
            `Checking if the non-final subdivision folder '${testElementTreeItem.testElementData.name}' exists locally.`
        );
        const processedNonFinalSubdivisionPath: string = removeRobotResourceFromPathString(absolutePathOfTestElement);
        const isFolderPresent: boolean = await isFilePresentLocally(processedNonFinalSubdivisionPath);
        logger.trace(
            `Non-Final subdivision '${testElementTreeItem.testElementData.name}' exists locally: ${isFolderPresent}`
        );
        return isFolderPresent;
    }
}

/**
 * Handles the "Go To Resource File" option for a subdivision element by opening or creating its resource file or folder.
 * @param {TestElementTreeItem} subdivisionTreeItem The test element tree item representing a subdivision.
 */
export async function handleSubdivision(subdivisionTreeItem: TestElementTreeItem): Promise<void> {
    // Determine if the subdivision is final (i.e., has no child subdivisions)
    const isFinalSubdivision: boolean = isFinalSubdivisionInTree(subdivisionTreeItem.testElementData);

    // Construct the target path based on the hierarchical name of the test element.
    const absolutePathOfTestElement = await constructAbsolutePathForTestElement(subdivisionTreeItem);
    if (!absolutePathOfTestElement) {
        return;
    }
    const processedAbsolutePathOfTestElement = removeRobotResourceFromPathString(absolutePathOfTestElement);
    logger.trace(
        `Handling subdivision '${subdivisionTreeItem.testElementData.name}' with absolutePathOfTestElement: ${processedAbsolutePathOfTestElement}`
    );

    // If the subdivision is final, open the resource file. Else, represent it as a folder.
    if (isFinalSubdivision) {
        const processedTestElementPath: string = appendResourceExtensionAndTrimPath(processedAbsolutePathOfTestElement);

        // If the resource file does not exist, create it with a header.
        if (!(await isFilePresentLocally(processedTestElementPath))) {
            const dirName: string = path.dirname(processedTestElementPath);

            // Note: Windows won't create case-sensitive directories.
            // If there are already directories with the same name but different case, they will be used and no new directory will be created.
            logger.trace(`Creating directory to process subdivision click: ${dirName}`);
            await fs.promises.mkdir(dirName, { recursive: true });

            // Create the resource file with header content.
            const fileContent: string = `*** Settings ***\nDocumentation    tb:uid:${subdivisionTreeItem.testElementData.uniqueID}\n`;

            // Create resource file with header content.
            await fs.promises.writeFile(processedTestElementPath, fileContent);
            logger.trace(`Resource file created at ${processedTestElementPath}`);
        } else {
            logger.trace(`Resource file already exists at ${processedTestElementPath}, skipping creation.`);
        }

        // Open the resource file in the VS Code editor.
        const document: vscode.TextDocument = await vscode.workspace.openTextDocument(
            vscode.Uri.file(processedTestElementPath)
        );
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand("workbench.files.action.showActiveFileInExplorer");
    } else {
        // Non-final subdivision: represent as a folder.
        let folderExists: boolean = false;
        try {
            const stats: fs.Stats = await fs.promises.stat(processedAbsolutePathOfTestElement);
            folderExists = stats.isDirectory();
        } catch {
            // No need to specify the caught error since we don't use it.
            folderExists = false;
        }

        if (!folderExists) {
            await fs.promises.mkdir(processedAbsolutePathOfTestElement, { recursive: true });
            logger.trace(`Folder created at ${processedAbsolutePathOfTestElement}`);
        } else {
            logger.trace(`Subdivision folder already exists at ${processedAbsolutePathOfTestElement}`);
        }

        // Recursively handle all final subdivisions under this non-final subdivision.
        if (subdivisionTreeItem.testElementData.children) {
            logger.trace(`Handling children of subdivision '${subdivisionTreeItem.testElementData.name}'`);
            for (const child of subdivisionTreeItem.testElementData.children) {
                if (child.elementType === "Subdivision") {
                    await handleSubdivision(new TestElementTreeItem(child));
                }
            }
            logger.trace(`Finished handling children of subdivision '${subdivisionTreeItem.testElementData.name}'`);
        }

        // Open VS Code explorer.
        await vscode.commands.executeCommand("workbench.view.explorer");
    }

    // Trigger subdivision icon update after handling the subdivision.
    // Note: If the user deletes the resource file locally, the icon will not be updated until the next refresh.
    await updateTestElementIcon(subdivisionTreeItem);
    getTestElementsTreeDataProvider()._onDidChangeTreeData.fire(undefined);
}

/**
 * Handles an interaction element by opening the resource file of its nearest final subdivision.
 * @param {TestElementTreeItem} treeItem The test element tree item representing an interaction.
 */
export async function handleInteraction(treeItem: TestElementTreeItem): Promise<void> {
    const workspaceRootPath = await utils.validateAndReturnWorkspaceLocation();
    if (!workspaceRootPath) {
        return;
    }
    const testElement = treeItem.testElementData;

    // For an interaction, open the parent's final subdivision .resource file.
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
            return; // If no subdivision ancestor is found, do nothing.
        }
    }

    // Compute the hierarchical name if not already done.
    if (!finalSubdivisionAncestor.testElementData.hierarchicalName) {
        finalSubdivisionAncestor.testElementData.hierarchicalName = computeHierarchicalName(finalSubdivisionAncestor);
        logger.trace(
            `Computed hierarchical name for final subdivision: ${finalSubdivisionAncestor.testElementData.hierarchicalName}`
        );
    }
    // Construct the target path for the final subdivision.
    const finalSubdivisionAncestorPath = await constructAbsolutePathForTestElement(finalSubdivisionAncestor);
    if (!finalSubdivisionAncestorPath) {
        return;
    }
    // Process the final subdivision path by removing [Robot-Resource] and appending ".resource" and trimming whitespace.
    let processedFinalSubdivisionAncestorPath = removeRobotResourceFromPathString(finalSubdivisionAncestorPath);
    processedFinalSubdivisionAncestorPath = appendResourceExtensionAndTrimPath(processedFinalSubdivisionAncestorPath);

    // If the resource file does not exist, create it with a header.
    if (!(await isFilePresentLocally(processedFinalSubdivisionAncestorPath))) {
        const dirName: string = path.dirname(processedFinalSubdivisionAncestorPath);
        await fs.promises.mkdir(dirName, { recursive: true });

        // Create the resource file with header content.
        const fileContent: string = `*** Settings ***\nDocumentation    tb:uid:${finalSubdivisionAncestor.testElementData.uniqueID}\n`;

        await fs.promises.writeFile(processedFinalSubdivisionAncestorPath, fileContent);
        logger.trace(`Resource file created at ${processedFinalSubdivisionAncestorPath}`);
    } else {
        logger.trace(
            `Skipping creation of resource file at ${processedFinalSubdivisionAncestorPath} as it already exists.`
        );
    }
    // Open the final subdivision resource file in the VS Code editor.
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(processedFinalSubdivisionAncestorPath));
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("workbench.files.action.showActiveFileInExplorer");

    // Trigger subdivision icon update after handling the interaction.
    getTestElementsTreeDataProvider()._onDidChangeTreeData.fire(undefined);
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

/* =============================================================================
   Test Element Filtering and Hierarchy Functions
   ============================================================================= */

/**
 * Determines if a subdivision element is final (has no child subdivisions).
 * @param element The test element to check.
 * @returns True if the element is a final subdivision; false otherwise.
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
    // If any child is a subdivision, then this subdivision is not final.
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
    const testElement = treeItem.testElementData;
    logger.trace(`Searching subdivision ancestor for test element ${testElement.name}`);
    let current = testElement.parent;
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
    const testElement = treeItem.testElementData;
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
    const result: string = pathStr.replace(/\[Robot-Resource\]/g, "");
    logger.trace(`Removed [Robot-Resource] from path ${pathStr}: ${result}`);
    return result;
}
