import * as vscode from "vscode";

// Define the data model for the tree items
class TreeItem extends vscode.TreeItem {
    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${this.label}`;
    }
}

// Implement the TreeDataProvider for Tree 2
export class TreeViewDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | void> = new vscode.EventEmitter<
        TreeItem | undefined | void
    >();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    // Reload the tree data
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    // Provide the root elements for the tree
    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    // Provide the children of the tree
    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        if (!element) {
            return Promise.resolve([]);
        }
        return Promise.resolve([]);
    }
}
