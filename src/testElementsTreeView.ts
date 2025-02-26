/**
 * @file testElementsTreeView.ts
 * @description Provides a VS Code TreeDataProvider implementation to display test elements
 * retrieved from the TestBench server.
 */

// TODO: If the test element view is empty due to the filtering, show a message to the user that no elements are mathed with the regex.

import * as vscode from "vscode";
import * as path from "path";
import * as utils from "./utils";
import * as fs from "fs";
import { connection, logger, getConfig, testElementTreeView } from "./extension";

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
 * @param newKey The new TOV key.
 */
export function setCurrentTovKey(newKey: string): void {
    currentTovKeyOfInteractionsInView = newKey;
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
export interface TestElement {
    id: string;
    parentId: string | null;
    name: string;
    uniqueID: string;
    libraryKey: string | null;
    jsonString: string;
    details: any;
    elementType: ElementType;
    directRegexMatch: boolean;
    children?: TestElement[];
    hierarchicalName?: string;
    parent?: TestElement;
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
    // Convert Python-style named capture groups to JavaScript syntax.
    function convertPythonRegexToJs(pythonRegex: string): string {
        return pythonRegex.replace(/\(\?P<([a-zA-Z_]\w*)>/g, "(?<$1>");
    }

    const JSlibraryRegexPatterns = pythonResourceRegexPatternsInExtensionSettings
        .map((pattern) => {
            logger.trace(`Converting pattern: ${pattern}`);
            const convertedPattern = convertPythonRegexToJs(pattern);
            logger.trace(`Converted pattern: ${convertedPattern}`);
            try {
                const regex = new RegExp(convertedPattern, "u");
                logger.trace(`Created regex: ${regex}`);
                return regex;
            } catch (error) {
                logger.error(`Invalid regex pattern: ${convertedPattern}`, error);
                return null;
            }
        })
        .filter((regex): regex is RegExp => regex !== null);

    logger.trace("Final JS regex patterns:", JSlibraryRegexPatterns);
    return JSlibraryRegexPatterns;
}

/**
 * Checks if a given value matches any regex in the provided list.
 * @param {srting} value The string to test.
 * @param {RegExp[]} regexList An array of RegExp objects.
 * @returns {boolean} True if any regex matches; false otherwise.
 */
function matchesRegex(value: string, regexList: RegExp[]): boolean {
    const result = regexList.some((regex) => regex.test(value));
    logger.trace(`Value "${value}" matches regex patterns: ${result}`);
    return result;
}

/**
 * Determines the type of a test element based on its properties.
 *
 * @param {any} item The test element object.
 * @returns {ElementType} The type of the test element.
 */
function getTestElementItemType(item: any): ElementType {
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
function generateTestElementItemId(item: any, elementType: ElementType, uniqueID: string): string {
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
 * @param flatJsonTestElements Flat array of JSON objects from the server.
 * @returns {TestElement[]} An array of root TestElement objects forming the tree.
 */
function buildTree(flatJsonTestElements: any[]): TestElement[] {
    const resourceRegexPatternsInExtensionSettings = getResourceRegexPatternsFromExtensionSettings();
    logger.trace("Building tree with regex patterns:", resourceRegexPatternsInExtensionSettings);

    // Build a map for all elements without filtering.
    // This map is used to assign children to their respective parents.
    const map: { [id: string]: TestElement } = {};

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
        const testElementType: ElementType = getTestElementItemType(item);
        // Each element type has a unique key property that is used as the identifier.
        const IDOfTestElement: string = generateTestElementItemId(item, testElementType, item.uniqueID);
        // Determine the parent ID of the element. Use the 'parent' property if valid; otherwise, use the libraryKey as the parent.
        const parentId: string | null = getItemParentId(item, libraryKey);

        // Compute whether this element directly matches the regex filter.
        // If resouce regex patterns exist in the extension settings, use them. Otherwise, include all elements without filtering.
        const directRegexMatch =
            resourceRegexPatternsInExtensionSettings.length > 0
                ? matchesRegex(item.name, resourceRegexPatternsInExtensionSettings)
                : true;

        // Create the TestElement object.
        const testElement: TestElement = {
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
    const rootsOfTestElementView: TestElement[] = [];
    Object.values(map).forEach((testElement) => {
        if (testElement.parentId) {
            // Find the parent by matching a composite id (parent's serial + uniqueID).
            const parent = Object.values(map).find((p) => p.id.startsWith(`${testElement.parentId}_`));
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
     * Filtered elements become null and are removed from the tree.
     *
     * @param {TestElement} testElement The element to filter.
     * @param {boolean} inherited True if the element inherits a match from a parent.
     * @returns {TestElement | null} The filtered element or null if excluded.
     */
    function filterTestElementsTree(testElement: TestElement, inherited: boolean): TestElement | null {
        // Process and filter children recursively before filtering the current (parent) element.
        let filteredChildren: TestElement[] = [];
        if (testElement.children) {
            // Determine if the children should inherit inclusion:
            // If the current element directly matches the regex or is already inherited, mark children as inherited.
            const childrenInherited = inherited || testElement.directRegexMatch;
            // Store the result of filtering the children, which will be used to determine if the current element should be included.
            filteredChildren = testElement.children
                .map((child) => filterTestElementsTree(child, childrenInherited))
                .filter((child) => child !== null) as TestElement[];
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
    const filteredRoots = rootsOfTestElementView
        .map((root) => filterTestElementsTree(root, false))
        .filter((node): node is TestElement => node !== null);

    /**
     * Recursively assigns hierarchical names (full paths) to each element.
     * @param element The element.
     * @param parentPath The accumulated parent path.
     */
    function assignHierarchicalNames(element: TestElement, parentPath: string): void {
        // Compute the current hierarchical path.
        const currentPath = parentPath ? `${parentPath}/${element.name}` : element.name;
        element.hierarchicalName = currentPath;
        if (element.children && element.children.length > 0) {
            element.children.forEach((child) => assignHierarchicalNames(child, currentPath));
        }
    }
    filteredRoots.forEach((root) => assignHierarchicalNames(root, ""));

    return filteredRoots;
}

/**
 * Mapping from element types to icon file names.
 */
const iconMapping: Record<ElementType, string> = {
    Subdivision: "dataset.svg",
    DataType: "dataType.svg",
    Interaction: "testStep.svg",
    Condition: "condition.svg",
    Other: "other.svg"
};

/**
 * Returns a vscode.Uri for the icon corresponding to an element type.
 * @param {ElementType} elementType The element type.
 * @returns The URI of the icon.
 */
function getIconUri(elementType: ElementType): vscode.Uri {
    return vscode.Uri.file(path.join(__dirname, "..", "resources", "icons", iconMapping[elementType]));
}

/* =============================================================================
   TestElementItem Class and TestElementsTreeDataProvider
   ============================================================================= */

/**
 * TestElementItem represents a test element in the VS Code tree view.
 */
export class TestElementItem extends vscode.TreeItem {
    public readonly element: TestElement;

    /**
     * Constructs a new TestElementItem.
     * @param element The test element.
     */
    constructor(element: TestElement) {
        // Set the label to the element's name.
        // Determine collapsibility based on whether the element has children.
        super(
            element.name,
            element.children && element.children.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        this.element = element;
        // Set the context value to enable context menu contributions.
        this.contextValue = "testElement"; // This value is used in package.json to enable context menu contributions.

        // Build a tooltip string with detailed information about the element.
        let tooltip = `Type: ${element.elementType}\nName: ${element.name}\nUniqueID: ${element.uniqueID}`;
        if (element.libraryKey) {
            tooltip += `\nLibraryKey: ${element.libraryKey}`;
        }
        if (element.details.hasVersion !== undefined) {
            tooltip += `\nHas Version: ${element.details.hasVersion}`;
        }
        if (element.details.status !== undefined) {
            tooltip += `\nStatus: ${element.details.status}`;
        }

        // TODO: Remove this in production
        // Append the original JSON representation (Useful for debugging).
        if (element.jsonString) {
            tooltip += `\n\nJSON Data:\n${element.jsonString}`;
        }

        this.tooltip = tooltip;

        // Display the uniqueID as a description next to the label.
        this.description = element.uniqueID || "";
        // Set the icon based on the element type.
        this.iconPath = {
            light: getIconUri(element.elementType),
            dark: getIconUri(element.elementType)
        };
    }
}

/**
 * TestElementsTreeDataProvider implements the VS Code TreeDataProvider interface for test elements.
 */
export class TestElementsTreeDataProvider implements vscode.TreeDataProvider<TestElementItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TestElementItem | undefined> = new vscode.EventEmitter<
        TestElementItem | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<TestElementItem | undefined> = this._onDidChangeTreeData.event;
    private treeData: TestElement[] = [];

    getTreeItem(element: TestElementItem): vscode.TreeItem {
        return element;
    }

    /**
     * Returns the children for a given test element.
     * @param {TestElementItem} element Optional parent TestElementItem.
     * @returns A promise resolving to an array of TestElementItems.
     */
    getChildren(element?: TestElementItem): Thenable<TestElementItem[]> {
        if (element) {
            return Promise.resolve((element.element.children || []).map((child) => new TestElementItem(child)));
        } else {
            return Promise.resolve(this.treeData.map((child) => new TestElementItem(child)));
        }
    }

    /**
     * Refreshes the tree view with new data.
     * @param flatTestElementsJsonData A flat array of JSON objects representing test elements.
     */
    refresh(flatTestElementsJsonData: any[]): void {
        this.treeData = buildTree(flatTestElementsJsonData);
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Fetches test elements using a TOV key and updates the tree view.
     * @param {string} tovKey The TOV key.
     * @param {string} newTestElementsTreeViewTitle Optional new title for the tree view.
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
 * @param baseTargetPath - The input path string to normalize.
 * @returns The normalized path string ending with ".resource" without extraneous whitespace.
 */
function appendResourceExtensionAndRemoveWhitespaceBeforeIt(baseTargetPath: string): string {
    // Append ".resource" if it is not already present at the end of the string.
    let targetPath: string = baseTargetPath.endsWith(".resource") ? baseTargetPath : baseTargetPath + ".resource";

    // Remove any whitespace that appears immediately before ".resource" and trim trailing whitespace.
    targetPath = targetPath.replace(/\s+(\.resource)$/, "$1").replace(/\s+$/, "");

    return targetPath;
}

/**
 * Handles a subdivision element by opening its resource file or folder.
 * @param {TestElement} testElement The test element representing a subdivision.
 * @param {string} baseTargetPath The base target path.
 */
export async function handleSubdivision(testElement: TestElement, baseTargetPath: string): Promise<void> {
    // Determine if the subdivision is final (i.e. has no child subdivision)
    const isFinalSubdivision: boolean =
        !testElement.children || !testElement.children.some((child) => child.elementType === "Subdivision");
    logger.trace(`Subdivision '${testElement.name}' is ${isFinalSubdivision ? "final" : "not final"}.`);
    baseTargetPath = removeRobotResourceFromPathString(baseTargetPath);
    if (isFinalSubdivision) {
        const targetPath: string = appendResourceExtensionAndRemoveWhitespaceBeforeIt(baseTargetPath);
        if (!(await utils.fileExistsAsync(targetPath))) {
            const dirName = path.dirname(targetPath);
            await fs.promises.mkdir(dirName, { recursive: true });
            // Create the resource file with header content.
            const fileContent = `*** Settings ***\nDocumentation    tb:uid:${testElement.uniqueID}\n`;
            // Create resource file with header content.
            await fs.promises.writeFile(targetPath, fileContent);
            logger.trace(`Resource file created at ${targetPath}`);
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand("workbench.files.action.showActiveFileInExplorer");
    } else {
        // Non-final subdivision: represent as a folder.
        let folderExists = false;
        try {
            const stats = await fs.promises.stat(baseTargetPath);
            folderExists = stats.isDirectory();
        } catch {
            // No need to specify the catched error since we don't use it.
            folderExists = false;
        }
        if (!folderExists) {
            await fs.promises.mkdir(baseTargetPath, { recursive: true });
            logger.trace(`Folder created at ${baseTargetPath}`);
        }
        await vscode.commands.executeCommand("workbench.view.explorer");
    }
}

/**
 * Handles an interaction element by opening the resource file of its nearest final subdivision.
 * @param {TestElement} testElement The test element representing an interaction.
 * @param {string} workspaceRootPath The root path of the workspace.
 */
export async function handleInteraction(testElement: TestElement, workspaceRootPath: string): Promise<void> {
    // For an interaction, open the parent's final subdivision .resource file.
    const finalSubdivision = getFinalSubdivisionAncestor(testElement);
    if (!finalSubdivision) {
        return;
    }
    // Compute the hierarchical name if not already done.
    if (!finalSubdivision.hierarchicalName) {
        finalSubdivision.hierarchicalName = computeHierarchicalName(finalSubdivision);
        logger.trace(`Computed hierarchical name for final subdivision: ${finalSubdivision.hierarchicalName}`);
    }
    // Construct the target path for the final subdivision.
    let finalTargetPath = path.join(workspaceRootPath, ...finalSubdivision.hierarchicalName.split("/"));
    finalTargetPath = removeRobotResourceFromPathString(finalTargetPath);
    finalTargetPath = appendResourceExtensionAndRemoveWhitespaceBeforeIt(finalTargetPath);

    // If the resource file does not exist, create it with a header.
    if (!(await utils.fileExistsAsync(finalTargetPath))) {
        const dirName = path.dirname(finalTargetPath);
        await fs.promises.mkdir(dirName, { recursive: true });
        const fileContent = `*** Settings ***\nDocumentation    tb:uid:${testElement.uniqueID}\n`;
        await fs.promises.writeFile(finalTargetPath, fileContent);
        logger.trace(`Resource file created at ${finalTargetPath}`);
    } else {
        logger.trace(`Skipping creation of resource file at ${finalTargetPath} as it already exists.`);
    }
    // Open the final subdivision resource file in the VS Code editor.
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(finalTargetPath));
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand("workbench.files.action.showActiveFileInExplorer");
}

/**
 * Handles fallback for opening a test element file.
 * @param targetPath The target file path.
 */
export async function handleFallback(targetPath: string): Promise<void> {
    if (!(await utils.fileExistsAsync(targetPath))) {
        const dirName = path.dirname(targetPath);
        await fs.promises.mkdir(dirName, { recursive: true });
        await fs.promises.writeFile(targetPath, "");
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
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
export function isFinalSubdivisionInTree(element: TestElement): boolean {
    if (element.elementType !== "Subdivision") {
        logger.trace(`Element ${element.name} is not a subdivision.`);
        return false;
    }
    if (!element.children) {
        logger.trace(`Element ${element.name} has no children and is final.`);
        return true;
    }
    // If any child is a subdivision, then this subdivision is not final.
    const isFinalSubdivision = !element.children.some((child) => child.elementType === "Subdivision");
    logger.trace(`Element ${element.name} is ${isFinalSubdivision ? "" : "not "}a final subdivision.`);
    return isFinalSubdivision;
}

/**
 * Traverses upward from an interaction element to find the nearest final subdivision.
 * @param {TestElement} testElement The test element representing an interaction.
 * @returns {TestElement | null} The nearest final subdivision ancestor, or null if not found.
 */
export function getFinalSubdivisionAncestor(testElement: TestElement): TestElement | null {
    logger.trace(`Searching final subdivision ancestor for test element ${testElement.name}`);
    let current = testElement.parent;
    while (current) {
        if (current.elementType === "Subdivision" && isFinalSubdivisionInTree(current)) {
            logger.trace(`Found final subdivision ancestor for test element ${testElement.name}: ${current.name}`);
            return current;
        }
        current = current.parent;
    }
    logger.trace(
        `No final subdivision ancestor found for test element ${testElement.name} with unique ID: ${testElement.uniqueID}`
    );
    return null;
}

/**
 * Computes the hierarchical name of a test element by concatenating parent names.
 * @param {TestElement} element The test element.
 * @returns {string} The hierarchical name (e.g., "Root/Child").
 */
export function computeHierarchicalName(element: TestElement): string {
    return element.parent ? computeHierarchicalName(element.parent) + "/" + element.name : element.name;
}

/**
 * Removes all occurrences of "[Robot-Resource]" from a given path string.
 * @param {string} pathStr The original path string.
 * @returns {string} The cleaned path string.
 */
export function removeRobotResourceFromPathString(pathStr: string): string {
    return pathStr.replace(/\[Robot-Resource\]/g, "");
}
