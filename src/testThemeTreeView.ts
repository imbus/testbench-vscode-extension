import * as vscode from "vscode";
import { TestbenchTreeItem } from "./projectManagementTreeView";
import { logger } from "./extension";

export class TestThemeTreeDataProvider implements vscode.TreeDataProvider<TestbenchTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TestbenchTreeItem | void> =
        new vscode.EventEmitter<TestbenchTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<TestbenchTreeItem | void> = this._onDidChangeTreeData.event;

    rootElements: TestbenchTreeItem[] = [];

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getParent(element: TestbenchTreeItem): TestbenchTreeItem | null {
        return element.parent;
    }

    async getChildren(element?: TestbenchTreeItem): Promise<TestbenchTreeItem[]> {
        if (!element) {
            return this.rootElements;
        }

        return element.children || [];
    }

    getTreeItem(element: TestbenchTreeItem): vscode.TreeItem {
        return element;
    }

    // Set the root elements of the tree
    setRoots(roots: TestbenchTreeItem[]): void {
        this.rootElements = roots;
        this.refresh();
    }

    // Set the selected element as the only root element
    makeRoot(element: TestbenchTreeItem): void {
        this.rootElements = [element]; // Set the selected element as the root
        this.refresh(); // Refresh the tree to display the new root
    }

    handleExpansion(element: TestbenchTreeItem, expanded: boolean): void {
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();
    }

    // Clear the tree
    clearTree(): void {
        this.rootElements = [];
        this.refresh();
    }
}
