import * as vscode from "vscode";
import { ProjectManagementTreeItem } from "./projectManagementTreeView";

export class TestThemeTreeDataProvider implements vscode.TreeDataProvider<ProjectManagementTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProjectManagementTreeItem | void> =
        new vscode.EventEmitter<ProjectManagementTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<ProjectManagementTreeItem | void> = this._onDidChangeTreeData.event;

    rootElements: ProjectManagementTreeItem[] = [];

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getParent(element: ProjectManagementTreeItem): ProjectManagementTreeItem | null {
        return element.parent;
    }

    async getChildren(element?: ProjectManagementTreeItem): Promise<ProjectManagementTreeItem[]> {
        if (!element) {
            return this.rootElements;
        }

        return element.children || [];
    }

    getTreeItem(element: ProjectManagementTreeItem): vscode.TreeItem {
        return element;
    }

    // Set the root elements of the tree
    setRoots(roots: ProjectManagementTreeItem[]): void {
        this.rootElements = roots;
        this.refresh();
    }

    // Set the selected element as the only root element
    makeRoot(element: ProjectManagementTreeItem): void {
        this.rootElements = [element]; // Set the selected element as the root
        this.refresh(); // Refresh the tree to display the new root
    }

    handleExpansion(element: ProjectManagementTreeItem, expanded: boolean): void {
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
