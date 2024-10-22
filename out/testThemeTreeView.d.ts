import * as vscode from "vscode";
import { ProjectManagementTreeItem } from "./projectManagementTreeView.ts";
export declare class TestThemeTreeDataProvider implements vscode.TreeDataProvider<ProjectManagementTreeItem> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<ProjectManagementTreeItem | void>;
    private rootElements;
    refresh(): void;
    getParent(element: ProjectManagementTreeItem): ProjectManagementTreeItem | null;
    getChildren(element?: ProjectManagementTreeItem): Promise<ProjectManagementTreeItem[]>;
    getTreeItem(element: ProjectManagementTreeItem): vscode.TreeItem;
    setRoots(roots: ProjectManagementTreeItem[]): void;
    makeRoot(element: ProjectManagementTreeItem): void;
    handleExpansion(element: ProjectManagementTreeItem, expanded: boolean): void;
    clearTree(): void;
}
