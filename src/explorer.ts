import * as vscode from 'vscode';
import * as path from 'path';  // Handle icon paths
import { Connection } from './connection';

export class TestBenchTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined> = new vscode.EventEmitter<TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined> = this._onDidChangeTreeData.event;

    private connection: Connection | null = null;

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
}

export class TreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly contextValue: string,  // The type of the tree item (Project, TOV, Cycle)
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly item: any,
    ) {
        super(label, collapsibleState);        
        this.contextValue = contextValue;
        
        // Assign custom icons based on the context
        this.iconPath = this.getIconPath(contextValue, collapsibleState);
    
        // Clicking on test cycles executes command
        if (contextValue === 'cycle') {
            this.command = {
                command: 'testbenchExtension.generate', // Command to execute
                title: 'Generate',
                arguments: [this] // Pass the tree item as an argument
            };
            this.tooltip = 'Generate';  // Tooltip when hovering over the item

        }
    }

    private getIconPath(contextValue: string, collapsibleState: vscode.TreeItemCollapsibleState): { light: string | vscode.Uri; dark: string | vscode.Uri } {
        const lightIconFolderPath = path.join(__dirname, '..', 'resources', 'icons', 'light'); // Path to light theme icons
        const darkIconFolderPath = path.join(__dirname, '..', 'resources', 'icons', 'dark'); // Path to dark theme icons
        
        let iconName = 'testbench-icon.svg';  // Default icon if no match
        switch (contextValue) {
            case 'project':
                // TODO : fix
                // iconName = 'project-closed.svg';
                iconName = collapsibleState === vscode.TreeItemCollapsibleState.Collapsed ? 'project-closed.svg' : 'project-opened.svg';
                break;
            case 'tov':
                iconName = collapsibleState === vscode.TreeItemCollapsibleState.Collapsed ? 'project-closed.svg' : 'project-opened.svg';
                // iconName = 'project-closed.svg';
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
}
