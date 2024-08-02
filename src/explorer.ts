import * as vscode from 'vscode';
import * as path from 'path';  // Handle icon paths
import { Connection } from './connection';

export class TestBenchTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined> = new vscode.EventEmitter<TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined> = this._onDidChangeTreeData.event;

    private connection: Connection | null = null;
    private rootItem: TreeItem | null = null; // Track the current root item

    constructor(connection: Connection | null) {
        this.connection = connection;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        if (!this.connection) {
            vscode.window.showInformationMessage('No connection available yet for tree view.');
            return [];
        }

        if (!element) {
            if (this.rootItem) {
                // If a root item is set, return its children
                return this.getChildren(this.rootItem);
            }

            // Get projects
            const projects = await this.connection.getAllProjects();
            return projects.map(project => new TreeItem(project.name, 'project', vscode.TreeItemCollapsibleState.Collapsed, project));
        } else if (element.contextValue === 'project') {
            // Get TOVs for the selected project
            const tovItems = element.item.testObjectVersions || [];
            return tovItems.map((tov: { name: string; }) => new TreeItem(tov.name, 'tov', vscode.TreeItemCollapsibleState.Collapsed, tov));
        } else if (element.contextValue === 'tov') {
            // Get test cycles for the selected TOV
            const cycleItems = element.item.testCycles || [];
            return cycleItems.map((cycle: { name: string; }) => new TreeItem(cycle.name, 'cycle', vscode.TreeItemCollapsibleState.None, cycle));
        }
        return [];
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }
    
    // Set the selected item as the root and refresh the tree view
    makeRoot(treeItem: TreeItem): void {
        this.rootItem = treeItem; 
        this.refresh();
    }

    // To handle item expansion and collapse events
    handleExpansion(element: TreeItem, expanded: boolean) {
        element.collapsibleState = expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon(element.collapsibleState);  // Update the icon based on the new state
        this._onDidChangeTreeData.fire(element);  // Trigger a refresh for this specific element
    }
    
}

// Represents a tree item (Project, TOV, Cycle) in the tree view
export class TreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly contextValue: string,  // The type of the tree item (Project, TOV, Cycle)
        public collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly item: any,
    ) {
        super(label, collapsibleState);        
        this.contextValue = contextValue;
        
        // Assign custom icons based on type of item and if it is expanded or collapsed
        this.iconPath = this.getIconPath(contextValue, collapsibleState);
    
        // Clicking on Generate button for test cycles executes generate command
        if (contextValue === 'cycle') {
            this.command = {
                command: 'testbenchExtension.generate', // Command to execute
                title: 'Generate',
                arguments: [this] // Pass the tree item as an argument
            };
            this.tooltip = 'Generate';  // Tooltip when hovering over the item

        }
    }

    // Get the path to the icon based on the context value and collapsible state
    // TODO: Replace icons with own icons
    private getIconPath(contextValue: string, collapsibleState: vscode.TreeItemCollapsibleState): { light: string | vscode.Uri; dark: string | vscode.Uri } {
        // Path to light theme and dark theme icons
        const lightIconFolderPath = path.join(__dirname, '..', 'resources', 'icons', 'light'); 
        const darkIconFolderPath = path.join(__dirname, '..', 'resources', 'icons', 'dark');
        
        let iconName = 'testbench-icon.svg';
        switch (contextValue) {
            case 'project':
                iconName = collapsibleState === vscode.TreeItemCollapsibleState.Collapsed ? 'project-closed.svg' : 'project-opened.svg';
                break;
            case 'tov':
                iconName = collapsibleState === vscode.TreeItemCollapsibleState.Collapsed ? 'project-closed.svg' : 'project-opened.svg';                
                break;
            case 'cycle':
                iconName = 'cycle.svg';
                break;
        }

        return {
            light: path.join(lightIconFolderPath, iconName), 
            dark: path.join(darkIconFolderPath, iconName)   
        };
    }

    updateIcon(collapsibleState: vscode.TreeItemCollapsibleState): void {
        this.iconPath = this.getIconPath(this.contextValue, collapsibleState);
    }
}
