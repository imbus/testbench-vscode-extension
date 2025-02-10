import * as vscode from "vscode";
import * as path from "path";
import { connection, logger, getConfig } from "./extension";

// TODO: If the test element view is empty due to the filtering, show a message to the user that no elements are mathed with the regex.

// Global variables to store the current parameters for the tree view
let currentTovKeyOfInteractionsInView: string = "";
export function getCurrentTovKey(): string {
    return currentTovKeyOfInteractionsInView;
}
export function setCurrentTovKey(newKey: string): void {
    currentTovKeyOfInteractionsInView = newKey;
}

// Define the allowed element types for tree elements.
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
 * @property directMatch Indicates whether this element directly passed the filter.
 * @property children An array of child test elements.
 * @property hierarchicalName The hierarchical name of the element (e.g., "Root/Child").
 */
// Update the TestElement interface to include the hierarchicalName.
export interface TestElement {
    id: string;
    parentId: string | null;
    name: string;
    uniqueID: string;
    libraryKey: string | null;
    jsonString: string;
    details: any;
    elementType: ElementType;
    directMatch: boolean;
    children?: TestElement[];
    hierarchicalName?: string;
}

/**
 * Retrieves resource regex patterns for testbench2robotframework from the extension settings and tries to create javascript RegExps from them.
 * @returns An array of valid RegExp objects.
 */
function getResourceRegexPatternsFromExtensionSettings(): RegExp[] {
    const pythonResourceRegexPatternsInExtensionSettings: string[] = getConfig().get(
        "resourceRegexInTestbench2robotframework",
        []
    );

    logger.trace("Resource regex patterns in extension settings:", pythonResourceRegexPatternsInExtensionSettings);

    // TODO: A complete conversion from python regex to javascript regex is not working as expected. If we only use simple regex patterns, we can use the existing code.
    function convertPythonRegexToJs(pythonRegex: string): string {
        // Replace Python's named capture group syntax: (?P<name>pattern)
        // with JavaScript's syntax: (?<name>pattern)
        let jsRegex = pythonRegex.replace(/\(\?P<([a-zA-Z_]\w*)>/g, "(?<$1>");
        return jsRegex;
    }

    const JSlibraryRegexPatterns = pythonResourceRegexPatternsInExtensionSettings
        .map((pattern) => {
            logger.trace(`Trying to create JS regex pattern from: ${pattern}`);
            pattern = convertPythonRegexToJs(pattern);
            logger.trace(`Converted JS regex pattern: ${pattern}`);
            try {
                const regex = new RegExp(pattern, "u");
                if (regex instanceof RegExp) {
                    logger.trace(`Regex conversion succesful: ${regex}`);
                }
                return regex;
            } catch (error) {
                logger.error(`Invalid regex pattern in settings: ${pattern}`, error);
                return null;
            }
        })
        .filter((regex): regex is RegExp => regex !== null);

    logger.trace("Returning created javascript regex patterns:", JSlibraryRegexPatterns);

    return JSlibraryRegexPatterns;
}

/**
 * Checks if a given value matches any of the provided regex patterns.
 * @param value The string to test.
 * @param regexList An array of RegExp objects.
 * @returns True if any pattern matches; false otherwise.
 */
function matchesRegex(value: string, regexList: RegExp[]): boolean {
    let result: boolean = regexList.some((regex) => regex.test(value));
    logger.trace(`Result of matching value ${value} against regex patterns ${regexList}: ${result}`);
    return result;
}

/**
 * Builds a hierarchical tree from a flat array of JSON objects representing test elements. The tree elements are filtered based on some rules and regex patterns.  
 * @param flatJsonTestElements Flat array of JSON objects from the server.
 * @returns An array of root TestElement objects forming the tree.
 */
function buildTree(flatJsonTestElements: any[]): TestElement[] {
    // Retrieve regex patterns from extension settings.
    const resourceRegexPatternsInExtensionSettings = getResourceRegexPatternsFromExtensionSettings();

    logger.trace(
        "Building test elements tree with resourceRegexPatternsInExtensionSettings:",
        resourceRegexPatternsInExtensionSettings
    );

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
        // Each element type has a unique key property that is used as the identifier.
        let testElementType: ElementType;
        let id: string = "";
        if (item.Subdivision_key && item.Subdivision_key.serial) {
            testElementType = "Subdivision";
            id = item.Subdivision_key.serial;
        } else if (item.Interaction_key && item.Interaction_key.serial) {
            testElementType = "Interaction";
            id = item.Interaction_key.serial;
        } else if (item.Condition_key && item.Condition_key.serial) {
            testElementType = "Condition";
            id = item.Condition_key.serial;
        } else if (item.DataType_key && item.DataType_key.serial) {
            testElementType = "DataType";
            id = item.DataType_key.serial;
        } else {
            testElementType = "Other";
            // Fallback: use uniqueID as the identifier if no key-specific id is found.
            id = item.uniqueID;
        }

        // Determine the parent ID of the element.
        // Use the 'parent' property if valid; otherwise, use the libraryKey as the parent.
        let parentId: string | null = null;
        if (item.parent && item.parent.serial && item.parent.serial !== "0") {
            parentId = item.parent.serial;
        } else if (libraryKey) {
            parentId = libraryKey;
        }

        // Compute whether this element directly matches the regex filter.
        // If resouce regex patterns exist in the extension settings, use them. Otherwise, include all elements without filtering.
        const directMatch: boolean =
            resourceRegexPatternsInExtensionSettings.length > 0
                ? matchesRegex(item.name, resourceRegexPatternsInExtensionSettings)
                : true;

        // Create the TestElement object.
        const testElement: TestElement = {
            id,
            parentId,
            name: item.name,
            uniqueID: item.uniqueID,
            libraryKey,
            jsonString: JSON.stringify(item, null, 2),
            details: item,
            elementType: testElementType,
            directMatch,
            children: [],
        };
        
        // Store the current element in the map.
        map[id] = testElement;
    });

    // Build the full tree structure by assigning children to their respective parents.
    const rootsOfTestElementView: TestElement[] = [];
    Object.values(map).forEach((testElement) => {
        // Assign the element as a child to its parent (if it exists).
        if (testElement.parentId && map[testElement.parentId]) {
            map[testElement.parentId].children!.push(testElement);        
        } else {
            // If the element has no parent, it is a root element.
            rootsOfTestElementView.push(testElement);
        }
    });

    /**
     * Recursively filters the tree elements based on:
     * Regex matching: If the element directly matches or inherits a match from its parent, include it.
     * Exclude subdivisions if they have no children after filtering (empty subdivisions).
     * Exclude elements of type DataType and Condition (and only display non empty subdivisions and interactions).
     * @param testElement The TestElement to process.
     * @param inherited Flag indicating whether the inclusion is inherited from a parent match.
     * @returns The filtered TestElement or null if it should be excluded.
     */
    function filterTree(testElement: TestElement, inherited: boolean): TestElement | null {
        // Filter out elements of type DataType or Condition.
        if (testElement.elementType === "DataType" || testElement.elementType === "Condition") {
            return null;
        }

        // Process and filter children recursively.
        let filteredChildren: TestElement[] = [];
        if (testElement.children) {
            // Determine if the children should inherit inclusion:
            // If the current element directly matches or is already inherited, mark children as inherited.
            const childrenInherited = inherited || testElement.directMatch;
            filteredChildren = testElement.children
                .map((child) => filterTree(child, childrenInherited))
                .filter((child) => child !== null) as TestElement[];
        }

        // For subdivisions, filter out the subdivision element if it has no children.
        if (testElement.elementType === "Subdivision" && filteredChildren.length === 0) {
            return null;
        }

        // Regex filtering logic:
        // If the inclusion flag is set (inherited) or the element directly matches, include it along with its filtered children.
        if (inherited || testElement.directMatch) {
            return { ...testElement, children: filteredChildren };
        } else {
            // If the element does not directly match but has some matching descendants, promote the element to include them.
            if (filteredChildren.length > 0) {
                return { ...testElement, children: filteredChildren };
            }
            // Exclude the element if it neither directly matches nor has any matching descendants.
            return null;
        }
    }

    // Apply filtering to each root and return only non-null elements.
    const filteredRoots: TestElement[] = rootsOfTestElementView
        .map((root) => filterTree(root, false))
        .filter((node): node is TestElement => node !== null);

    // Recursively assign hierarchical names to each element, which is the full path from the root.
    function assignHierarchicalNames(element: TestElement, parentPath: string) {
        // Compute the current hierarchical path.
        const currentPath = parentPath ? `${parentPath}/${element.name}` : element.name;
        element.hierarchicalName = currentPath;
        if (element.children && element.children.length > 0) {
            element.children.forEach((child) => assignHierarchicalNames(child, currentPath));
        }
    }
    // 
    filteredRoots.forEach((root) => assignHierarchicalNames(root, ""));

    return filteredRoots;
}

/**
 * Maps an element type to its corresponding icon file name.
 */
const iconMapping: Record<ElementType, string> = {
    Subdivision: "dataset.svg",
    DataType: "dataType.svg",
    Interaction: "testStep.svg",
    Condition: "condition.svg",
    Other: "other.svg",
};

/**
 * Returns a URI for the given element type's icon.
 * Assumes that icons are stored in the "resources/icons" folder.
 * @param elementType The type of the element.
 * @returns A vscode.Uri pointing to the icon.
 */
function getIconUri(elementType: ElementType): vscode.Uri {
    // __dirname is assumed to be within the compiled output folder.
    return vscode.Uri.file(path.join(__dirname, "..", "resources", "icons", iconMapping[elementType]));
}

/**
 * TestElementItem class representing a test element in the VS Code tree view.
 */
export class TestElementItem extends vscode.TreeItem {
    public readonly element: TestElement;

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

        // Append the original JSON representation (Useful for debugging).
        // tooltip += `\nJSON Representation:\n${element.jsonString}`;

        this.tooltip = tooltip;
        // Display the uniqueID as a description next to the label.
        this.description = element.uniqueID || "";

        // Set the icon based on the element type.
        this.iconPath = {
            light: getIconUri(element.elementType),
            dark: getIconUri(element.elementType),
        };
    }
}

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
     * Returns the children for a given TreeItem.
     * If no element is provided, returns the root elements.
     */
    getChildren(element?: TestElementItem): Thenable<TestElementItem[]> {
        if (element) {
            return Promise.resolve((element.element.children || []).map((child) => new TestElementItem(child)));
        } else {
            return Promise.resolve(this.treeData.map((child) => new TestElementItem(child)));
        }
    }

    /**
     * Refreshes the tree view with new data and an optional uniqueID filter.
     * @param flatJsonData Flat array of JSON objects representing test elements.
     */
    refresh(flatJsonData: any[]): void {
        this.treeData = buildTree(flatJsonData);
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Helper function to call the API and update the tree view.
     * @param tovKey TOV key used to fetch test elements.
     */
    async fetchAndDisplayTestElements(tovKey: string): Promise<void> {
        const testElementsJsonResponseData = await connection?.getTestElementsWithTovKeyOldPlayServer(tovKey);
        if (testElementsJsonResponseData) {
            // Store inputs for later refreshes.
            setCurrentTovKey(tovKey);

            displayTestElementsTreeView();
            this.refresh(testElementsJsonResponseData);
        } else {
            vscode.window.showErrorMessage("Failed to fetch test elements from the server.");
        }
    }
}

// Hide the Test Elements tree view
export async function hideTestElementsTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testElementsView.removeView"); // testElementsView is the ID of the tree view in package.json
}

// Display the Test Elements  tree view
export async function displayTestElementsTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testElementsView.focus");
}

/**
 * Prompts the user for the TOV key and an optional uniqueID filter.
 * @returns An object containing the TOV key and uniqueID filter, or null if input is cancelled.
 */
export async function promptForTovKeyAndFilter(): Promise<string | null> {
    const tovKeyInput = await vscode.window.showInputBox({
        prompt: "Enter the TOV key",
        placeHolder: "e.g. 175",
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim() === "") {
                return "TOV key cannot be empty";
            }
            return null;
        },
    });

    if (!tovKeyInput) {
        vscode.window.showWarningMessage("No TOV key provided.");
        return null;
    }

    return tovKeyInput.trim();
}
