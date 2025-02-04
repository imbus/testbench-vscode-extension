import * as vscode from "vscode";
import { connection, logger } from "./extension";

// Global variables to store the current parameters for the tree view
let currentTovKey: string = "";
let currentUniqueIDFilter: string | null = null;

export function getCurrentTovKey(): string {
    return currentTovKey;
}

export function getCurrentUniqueIDFilter(): string | null {
    return currentUniqueIDFilter;
}

export function setCurrentTovKey(newKey: string): void {
    currentTovKey = newKey;
}

export function setCurrentUniqueIDFilter(newFilter: string | null): void {
    currentUniqueIDFilter = newFilter;
}

// Json response structure for tree elements
interface TestElement {
    id: string; // Computed from the key property in the JSON.
    parentId: string | null; // Derived from the "parent" field (null if missing or "0").
    name: string;
    uniqueID: string;
    libraryKey: string | null; // If libraryKey is an object, we use its serial.
    jsonString: string; // The original JSON string representation of this element
    details: any; // The full original object for additional info.
    children?: TestElement[]; // Will be filled when building the tree.
}

// Build a hierarchical tree from the flat JSON array
//    If filterUniqueID is provided (non-empty), only include items whose uniqueID starts with it.
// =============================================================================
function buildTree(flatElements: any[], filterUniqueID: string | null): TestElement[] {
    // If a non-empty filter string is provided, filter the elements; otherwise use all.
    const filteredElements =
        filterUniqueID && filterUniqueID.trim() !== ""
            ? flatElements.filter((item) => item.uniqueID && item.uniqueID.includes(filterUniqueID))
            : flatElements;

    const map: { [id: string]: TestElement } = {};
    const roots: TestElement[] = [];

    // Convert each filtered object into a TestElement.
    filteredElements.forEach((item) => {
        // Determine the unique id from one of the key properties.
        let id: string = "";
        if (item.Subdivision_key && item.Subdivision_key.serial) {
            id = item.Subdivision_key.serial;
        } else if (item.DataType_key && item.DataType_key.serial) {
            id = item.DataType_key.serial;
        } else if (item.Interaction_key && item.Interaction_key.serial) {
            id = item.Interaction_key.serial;
        }

        // Derive the parent id. If the parent field is null or has serial "0", treat it as a root.
        let parentId: string | null = null;
        if (item.parent && item.parent.serial && item.parent.serial !== "0") {
            parentId = item.parent.serial;
        }

        // Process the libraryKey: if it is an object, use its serial.
        let libraryKey: string | null = null;
        if (item.libraryKey) {
            if (typeof item.libraryKey === "object" && item.libraryKey.serial) {
                libraryKey = item.libraryKey.serial;
            } else {
                libraryKey = item.libraryKey;
            }
        }

        // Build our TestElement object, including the original JSON string.
        const element: TestElement = {
            id,
            parentId,
            name: item.name,
            uniqueID: item.uniqueID,
            libraryKey,
            details: item,
            jsonString: JSON.stringify(item, null, 2),
            children: [],
        };

        map[id] = element;
    });

    // Build the tree: assign each element as a child of its parent (if available).
    Object.values(map).forEach((element) => {
        if (element.parentId && map[element.parentId]) {
            map[element.parentId].children!.push(element);
        } else {
            roots.push(element);
        }
    });

    return roots;
}

// Custom TreeItem class for test elements
class TestElementItem extends vscode.TreeItem {
    constructor(public readonly element: TestElement) {
        // Use the "name" property as the label.
        // Expandable if the element has children.
        super(
            element.name,
            element.children && element.children.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );

        // Build a tooltip with details.
        let tooltip = `Name: ${element.name}\nUniqueID: ${element.uniqueID}`;
        if (element.libraryKey) {
            tooltip += `\nLibraryKey: ${element.libraryKey}`;
        }
        if (element.details.hasVersion !== undefined) {
            tooltip += `\nHas Version: ${element.details.hasVersion}`;
        }
        if (element.details.status !== undefined) {
            tooltip += `\nStatus: ${element.details.status}`;
        }
        // Append the original JSON string representation.
        tooltip += `\nJSON Representation:\n${element.jsonString}`;

        this.tooltip = tooltip;
        // Optionally show uniqueID as a description after the label.
        this.description = element.uniqueID || "";
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

    getChildren(element?: TestElementItem): Thenable<TestElementItem[]> {
        if (element) {
            return Promise.resolve((element.element.children || []).map((child) => new TestElementItem(child)));
        } else {
            return Promise.resolve(this.treeData.map((child) => new TestElementItem(child)));
        }
    }

    // Refresh the tree view with new data and an optional uniqueID filter.
    refresh(flatData: any[], filter?: string | null): void {
        this.treeData = buildTree(flatData, filter || null);
        this._onDidChangeTreeData.fire(undefined);
    }

    // Helper function to call the API and update the tree view.
    async fetchAndDisplayTestElements(tovKey: string, uniqueIDFilter: string | null): Promise<void> {
        const testElementsJsonResponseData = await connection?.getTestElementsWithTovKeyOldPlayServer(tovKey);
        if (testElementsJsonResponseData) {
            displayTestElementsTreeView();
            this.refresh(testElementsJsonResponseData, uniqueIDFilter);
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

// Helper function to prompt for TOV key and optional uniqueID filter.
export async function promptForTovKeyAndFilter(): Promise<{ tovKey: string; uniqueIDFilter: string | null } | null> {
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

    const uniqueIDFilterInput = await vscode.window.showInputBox({
        prompt: "Enter uniqueID filter string (optional)",
        placeHolder: "e.g. RF-",
        ignoreFocusOut: true,
    });

    return {
        tovKey: tovKeyInput.trim(),
        uniqueIDFilter: uniqueIDFilterInput && uniqueIDFilterInput.trim() !== "" ? uniqueIDFilterInput.trim() : null,
    };
}
