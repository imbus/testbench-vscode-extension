import * as vscode from "vscode";
import { ProjectManagementTreeItem } from "./projectManagementTreeView";

// TODO: Create a test theme tree item class?
export class TestThemeTreeDataProvider implements vscode.TreeDataProvider<ProjectManagementTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProjectManagementTreeItem | void> =
        new vscode.EventEmitter<ProjectManagementTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<ProjectManagementTreeItem | void> = this._onDidChangeTreeData.event;

    private rootElements: ProjectManagementTreeItem[] = [];

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

    // Set the selected item as the root and refresh the tree view
    // TODO: Implement
    makeRoot(): void {}

    handleExpansion(element: ProjectManagementTreeItem, expanded: boolean): void {
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();
    }

    // Clear the tree
    clear(): void {
        this.rootElements = [];
        this.refresh();
    }
}
