import * as vscode from "vscode";
import { PlayServerConnection } from "./testBenchConnection.ts";
import { TestThemeTreeDataProvider } from "./testThemeTreeView.ts";
export declare class ProjectManagementTreeDataProvider implements vscode.TreeDataProvider<ProjectManagementTreeItem> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<ProjectManagementTreeItem | void>;
    private connection;
    private rootItem;
    currentProjectKeyInView: string | null;
    testThemeDataProvider: TestThemeTreeDataProvider;
    constructor(connection: PlayServerConnection | null, projectKey?: string, testThemeDataProvider?: TestThemeTreeDataProvider);
    refresh(): void;
    getParent(element: ProjectManagementTreeItem): ProjectManagementTreeItem | null;
    private createTreeItem;
    getChildren(element?: ProjectManagementTreeItem): Promise<ProjectManagementTreeItem[]>;
    private getChildrenOfCycle;
    getTreeItem(element: ProjectManagementTreeItem): vscode.TreeItem;
    makeRoot(treeItem: ProjectManagementTreeItem): void;
    handleExpansion(element: ProjectManagementTreeItem, expanded: boolean): void;
    clearTree(): void;
}
export declare function findProjectKeyOfCycle(element: ProjectManagementTreeItem): string | undefined;
export declare class ProjectManagementTreeItem extends vscode.TreeItem {
    item: any;
    parent: ProjectManagementTreeItem | null;
    children?: ProjectManagementTreeItem[];
    constructor(label: string, contextValue: string, // The type of the tree item (Project, TOV, Cycle etc.)
    collapsibleState: vscode.TreeItemCollapsibleState, item: any, parent?: ProjectManagementTreeItem | null);
    private getIconPath;
    updateIcon(): void;
}
export declare function makeRoot(treeItem: ProjectManagementTreeItem, treeDataProvider: ProjectManagementTreeDataProvider): void;
export declare function initializeTreeView(context: vscode.ExtensionContext, connection: PlayServerConnection | null, selectedProjectKey?: string): Promise<[ProjectManagementTreeDataProvider | null, TestThemeTreeDataProvider | null]>;
