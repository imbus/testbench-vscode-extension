import * as vscode from "vscode";

// TODO; Implement logic for fetching test elements from the testbench server (in testBenchConnection class).

/**
 * Represents a tree element in the test element tree view.
 */
class TestElementTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: TreeElementType,
        public readonly tooltip?: string,
        public readonly children: TestElementTreeItem[] = []
    ) {
        super(label, collapsibleState);
        this.tooltip = tooltip;
    }
}

/**
 * Enum for the different types of tree elements.
 */
enum TreeElementType {
    Subdivision = "subdivision",
    Folder = "folder",
    Interaction = "interaction",
    DataType = "dataType",
    Condition = "condition",
}

/**
 * Tree data provider for the tree element tree view.
 */
export class TestElementTreeViewProvider implements vscode.TreeDataProvider<TestElementTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TestElementTreeItem | undefined | null | void> =
        new vscode.EventEmitter<TestElementTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TestElementTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    // Root elements of the tree
    private rootElements: TestElementTreeItem[] = [];

    constructor() {
        // Initialize the tree with some data
        this.initializeTreeData();
    }

    /**
     * Refreshes the tree view.
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Retrieves the children of a given tree element.
     * If the element is undefined, returns the root elements.
     * @param element The parent tree element.
     */
    getChildren(element?: TestElementTreeItem): TestElementTreeItem[] {
        return element ? element.children : this.rootElements;
    }

    /**
     * Retrieves the parent of a tree element (not implemented in this example).
     */
    getParent(_element: TestElementTreeItem): TestElementTreeItem | null {
        return null;
    }

    /**
     * Resolves a tree item for the given tree element.
     * @param element The tree element.
     */
    getTreeItem(element: TestElementTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Initializes mock tree data.
     */
    private initializeTreeData() {
        const subdivision4 = new TestElementTreeItem(
            "Subdivision 4",
            vscode.TreeItemCollapsibleState.Collapsed,
            TreeElementType.Subdivision,
            undefined,
            [
                new TestElementTreeItem(
                    "Interaction 1",
                    vscode.TreeItemCollapsibleState.None,
                    TreeElementType.Interaction
                ),
            ]
        );

        const subdivision2 = new TestElementTreeItem(
            "Subdivision 2",
            vscode.TreeItemCollapsibleState.Collapsed,
            TreeElementType.Subdivision,
            undefined,
            [subdivision4]
        );

        const subdivision1 = new TestElementTreeItem(
            "Subdivision 1",
            vscode.TreeItemCollapsibleState.Collapsed,
            TreeElementType.Subdivision,
            undefined,
            [
                new TestElementTreeItem("Datatype 1", vscode.TreeItemCollapsibleState.None, TreeElementType.DataType),
                new TestElementTreeItem("Condition 1", vscode.TreeItemCollapsibleState.None, TreeElementType.Condition),
            ]
        );

        const rootSubdivision = new TestElementTreeItem(
            "(Mock) Root Subdivision",
            vscode.TreeItemCollapsibleState.Collapsed,
            TreeElementType.Subdivision,
            undefined,
            [
                subdivision1,
                subdivision2,
                new TestElementTreeItem(
                    "Subdivision 3",
                    vscode.TreeItemCollapsibleState.Collapsed,
                    TreeElementType.Subdivision
                ),
            ]
        );

        this.rootElements = [rootSubdivision];
    }

    /**
     * Generates mock child elements based on the parent type.
     * @param parentType The type of the parent element.
     */
    private getMockChildren(parentType: TreeElementType): TestElementTreeItem[] {
        if (parentType === TreeElementType.Subdivision) {
            return [
                new TestElementTreeItem(
                    "Child Subdivision",
                    vscode.TreeItemCollapsibleState.Collapsed,
                    TreeElementType.Subdivision
                ),
                new TestElementTreeItem("Child Folder", vscode.TreeItemCollapsibleState.None, TreeElementType.Folder),
                new TestElementTreeItem(
                    "Child Interaction",
                    vscode.TreeItemCollapsibleState.None,
                    TreeElementType.Interaction
                ),
                new TestElementTreeItem(
                    "Child DataType",
                    vscode.TreeItemCollapsibleState.None,
                    TreeElementType.DataType
                ),
                new TestElementTreeItem(
                    "Child Condition",
                    vscode.TreeItemCollapsibleState.None,
                    TreeElementType.Condition
                ),
            ];
        }
        return [];
    }
}

// Hide the Test Elements tree view
export async function hideTestElementsTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testElementsTreeView.removeView"); // testElementsTreeView is the ID of the tree view in package.json
}

// Display the Test Elements  tree view
export async function displayTestElementsTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testElementsTreeView.focus");
}
