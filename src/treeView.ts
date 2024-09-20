import * as vscode from "vscode";
import * as path from "path";
import * as utils from "./utils";
import { PlayServerConnection } from "./testbenchConnection";

export class TestBenchTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined> = new vscode.EventEmitter<
        TreeItem | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined> = this._onDidChangeTreeData.event;

    private connection: PlayServerConnection | null = null;
    private rootItem: TreeItem | null = null;

    constructor(connection: PlayServerConnection | null) {
        this.connection = connection;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getParent(element: TreeItem): TreeItem | null {
        return element.parent ?? null;
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        if (!this.connection) {
            vscode.window.showInformationMessage("No connection available for tree view.");
            return [];
        }

        if (!element) {
            if (this.rootItem) {
                // If a root item is set, return its children
                return this.getChildren(this.rootItem);
            }

            // Get projects, which are the top level elements
            const projects = await this.connection.getAllProjects();
            // Create tree items for each project
            return projects.map((project) => {
                const treeItem = new TreeItem(
                    project.name,
                    "project",
                    vscode.TreeItemCollapsibleState.Collapsed,
                    project
                );
                treeItem.parent = null; // Root elements have no parent
                return treeItem;
            });
        } else if (element.contextValue === "project") {
            // Get TOVs for the selected project
            const tovItems = element.item.testObjectVersions || [];
            // Create tree items for each TOV
            return tovItems.map((tov: { name: string }) => {
                const treeItem = new TreeItem(tov.name, "tov", vscode.TreeItemCollapsibleState.Collapsed, tov);
                treeItem.parent = element; // Set parent for each TOV item
                return treeItem;
            });
        } else if (element.contextValue === "tov") {
            // Get test cycles for the selected TOV
            const cycleItems = element.item.testCycles || [];
            // Create tree items for each cycle
            return cycleItems.map((cycle: { name: string }) => {
                const treeItem = new TreeItem(cycle.name, "cycle", vscode.TreeItemCollapsibleState.None, cycle);
                treeItem.parent = element; // Set parent for each cycle item
                return treeItem;
            });
        } else if (element.contextValue === "cycle") {
            // If the element is a cycle, load its sub-elements
            return this.getCycleSubElements(element);
        }
        return [];
    }

    // TODO: Implement fetching of cycle structure and display its sub-elements in the tree view
    // Implement fetching of cycle structure
    private async getCycleSubElements(element: TreeItem): Promise<Thenable<TreeItem[]>> {
        // Get the key of the cycle
        const cycleKey = element.item.item.key.serial;
        // Get all projects from the server to find the project key of the cycle
        const allProjects = await this.connection?.getAllProjects();
        if (allProjects) {
            // Find the project key of the cycle
            const projectKeyOfCycle = utils.findProjectKeyOfCycle(allProjects, cycleKey);
            if (projectKeyOfCycle) {
                const cycleData = await this.connection?.fetchCycleStructure(projectKeyOfCycle, cycleKey);
                if (cycleData) {
                    return Promise.resolve(
                        cycleData.map((data: any) => {
                            const treeItem = new TreeItem(
                                // TODO: Modify label and contextValue based on the cycleData
                                "label",
                                "contextValue",
                                vscode.TreeItemCollapsibleState.Collapsed,
                                data
                            );
                            treeItem.parent = element; // Set parent for each item
                            return treeItem;
                        })
                    );
                }
            }
        }
        return Promise.resolve([]); // Return an empty array if no data is found
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    // Set the selected item as the root and refresh the tree view
    makeRoot(treeItem: TreeItem): void {
        this.rootItem = treeItem;
        this.refresh();
    }

    // Handle item expansion and collapse events
    handleExpansion(element: TreeItem, expanded: boolean) {
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon(element.collapsibleState); // Update the icon based on the new state
        this._onDidChangeTreeData.fire(element); // Trigger a refresh for this specific element
    }

    // Clear the tree data and refresh the view
    clearTree(): void {
        this.rootItem = null;
        this.connection = null;
        this.refresh(); // Refresh the tree view to reflect the cleared data
        vscode.window.showInformationMessage("Tree view cleared.");
    }
}

// Represents a tree item (Project, TOV, Cycle, etc) in the tree view
export class TreeItem extends vscode.TreeItem {
    parent?: TreeItem | null; // Track the parent of each tree item

    constructor(
        public readonly label: string,
        public readonly contextValue: string, // The type of the tree item (Project, TOV, Cycle)
        public collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly item: any
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;

        // Assign custom icons based on type of item and if it is expanded or collapsed
        this.iconPath = this.getIconPath(contextValue, collapsibleState);

        // Clicking on Generate button for test cycles executes generate command
        if (contextValue === "cycle") {
            this.command = {
                command: "testbenchExtension.generate", // Command to execute
                title: "Generate",
                arguments: [this], // Pass the tree item as an argument
            };
            this.tooltip = "Generate"; // Tooltip when hovering over the item
        }
    }

    // TODO: The icons used are placeholder icons. Replace icons with own icons.
    // Get the path to the icon based on the context value and collapsible state
    private getIconPath(
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState
    ): { light: string | vscode.Uri; dark: string | vscode.Uri } {
        // Path to light theme and dark theme icons
        const lightIconFolderPath = path.join(__dirname, "..", "resources", "icons", "light");
        const darkIconFolderPath = path.join(__dirname, "..", "resources", "icons", "dark");

        let iconName = "testbench-icon.svg";
        switch (contextValue) {
            case "project":
                iconName =
                    collapsibleState === vscode.TreeItemCollapsibleState.Collapsed
                        ? "project-closed.svg"
                        : "project-opened.svg";
                break;
            case "tov":
                iconName =
                    collapsibleState === vscode.TreeItemCollapsibleState.Collapsed
                        ? "project-closed.svg"
                        : "project-opened.svg";
                break;
            case "cycle":
                iconName = "cycle.svg";
                break;
        }

        return {
            light: path.join(lightIconFolderPath, iconName),
            dark: path.join(darkIconFolderPath, iconName),
        };
    }

    updateIcon(collapsibleState: vscode.TreeItemCollapsibleState): void {
        this.iconPath = this.getIconPath(this.contextValue, collapsibleState);
    }
}

// Command to set the selected item as the root of the tree view
export function makeRoot(connection: PlayServerConnection, treeItem: TreeItem) {
    if (connection) {
        const treeDataProvider = new TestBenchTreeDataProvider(connection);
        treeDataProvider.makeRoot(treeItem);
        vscode.window.showInformationMessage(`"${treeItem.label}" is now the root.`);
        vscode.window.registerTreeDataProvider("testBenchProjects", treeDataProvider);
    } else {
        vscode.window.showErrorMessage("No connection available. Please log in first.");
    }
}
