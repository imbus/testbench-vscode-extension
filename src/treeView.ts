import * as vscode from "vscode";
import * as path from "path";
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
        console.log(`getChildren called with element: ${element?.label}`);
        if (!this.connection) {
            // vscode.window.showInformationMessage("No connection available for tree view.");
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
        } else if (element && element.children) {
            // TODO : Test for test cycle sub hierarchy
            // If the element has children, return them directly
            return element.children;
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
                const treeItem = new TreeItem(cycle.name, "cycle", vscode.TreeItemCollapsibleState.Collapsed, cycle);
                treeItem.parent = element; // Set parent for each cycle item
                return treeItem;
            });
        } else if (element.contextValue === "cycle") {
            // If the element is a cycle, load its sub-elements
            console.log(`getChildren cycle element: ${element.label}`);
            return await this.getCycleSubElements(element);
        }
        return [];
    }

    // Fetch cycle structure and build the element tree hierarchy using the numbering field of the elements
    private async getCycleSubElements(element: TreeItem): Promise<Thenable<TreeItem[]>> {
        // Get the key of the cycle
        const cycleKey = element.item.key.serial;
        // TODO: parent.parent is used to find the project of a cycle, which could be problematic if more test object versios are in the hierarchy in between
        const projectKeyOfCycle = element.parent?.parent?.item?.key?.serial;

        console.log("Cycle element: ", element);
        console.log("Cycle element Parent Project: ", element.parent?.parent);
        console.log("Cycle element Project key: ", projectKeyOfCycle);

        if (projectKeyOfCycle) {
            const cycleData = await this.connection?.fetchCycleStructure(projectKeyOfCycle, cycleKey);
            if (cycleData) {
                if (cycleData.nodes?.length === 0) {
                    console.log("Cycle has 0 sub elements.");
                    return Promise.resolve([]);
                }

                // Create a map to store elements by their numbering
                const elementsByNumbering: { [numbering: string]: any } = {};
                cycleData.nodes?.forEach((data: any) => {
                    // Store elements by their numbering, where numbering is the key
                    elementsByNumbering[data.base.numbering] = data;
                });

                // Recursively build tree structure by constructing a hierarchical tree structure from a flat collection of elements
                // Track elements already added to avoid duplicates in the tree with addedElements variable
                function buildTree(numberingPrefix: string, addedElements: Set<string> = new Set()): TreeItem[] {
                    const children: TreeItem[] = []; // Current level's child elements

                    for (const numbering in elementsByNumbering) {
                        if (
                            numbering.startsWith(numberingPrefix) && // Ensure the element is in the current hierarchy level
                            numbering.length > numberingPrefix.length && // Ensure the element is not the same as the parent
                            !addedElements.has(numbering) // Check if the element has not already been added
                        ) {
                            addedElements.add(numbering); // Mark the element as added to skip it and avoid duplicates

                            const data = elementsByNumbering[numbering];
                            const nextLevelPrefix = numbering + "."; // Prefix for the next level of hierarchy
                            // Check if any element's numbering starts with nextLevelPrefix, so see the current element has childs
                            const hasChildren = Object.keys(elementsByNumbering).some((num) =>
                                num.startsWith(nextLevelPrefix)
                            );

                            const treeItem = new TreeItem(
                                `${data.base.numbering} (${data.elementType}) ${data.base.name} ${data.base.uniqueID}`, // Label
                                `${data.elementType}`, // Context value
                                hasChildren
                                    ? vscode.TreeItemCollapsibleState.Collapsed
                                    : vscode.TreeItemCollapsibleState.None,
                                data
                            );

                            // Process the child elements recursively
                            if (hasChildren) {
                                treeItem.children = buildTree(nextLevelPrefix, addedElements);
                            }

                            children.push(treeItem);
                        }
                    }

                    return children;
                }

                return Promise.resolve(buildTree("")); // Start building the tree from the root
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
        // vscode.window.showInformationMessage("Tree view cleared.");
    }
}

// Represents a tree item (Project, TOV, Cycle, etc) in the tree view
export class TreeItem extends vscode.TreeItem {
    parent?: TreeItem | null; // Track the parent of each tree item
    children?: TreeItem[] | null; // Add a children property to store child elements

    constructor(
        public readonly label: string,
        public readonly contextValue: string, // The type of the tree item (Project, TOV, Cycle etc.)
        public collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly item: any
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;

        // Assign custom icons based on type of item and if it is expanded or collapsed
        this.iconPath = this.getIconPath(this, collapsibleState);

        // Executing a command on single click on the tree item
        /*
        if (contextValue === "cycle") {
            this.command = {
                command: "testbenchExtension.generateTestCases", // Command to execute
                title: "Generate Test Cases",
                // arguments: [this], // Pass the tree item as an argument. Error: Circular reference
            };
            this.tooltip = "Generate Test Cases"; // Tooltip when hovering over the item
        }
        */
    }

    // Get the path to the icon based on the context value and collapsible state
    private getIconPath(treeItem: TreeItem, collapsibleState: vscode.TreeItemCollapsibleState): string | vscode.Uri {
        const iconFolderPath = path.join(__dirname, "..", "resources", "icons");

        let iconName = "testbench-icon.svg";
        switch (treeItem.contextValue) {
            case "project":
                // TODO: Add the remaining icons for different statuses
                switch (treeItem.item.status) {
                    case "active":
                        iconName = "Project_B_Active.png";
                        break;
                    case "planned":
                        iconName = "Project_B_Planned.png";
                        break;
                    case "finished":
                        iconName = "Project_B_Finished.png";
                        break;
                    case "closed":
                        iconName = "Project_B_Closed.png";
                        break;
                    default:
                        iconName = "Project.png";
                }
                break;
            case "tov":
                switch (treeItem.item.status) {
                    case "active":
                        iconName = "Testobject_B_Active.png";
                        break;
                    case "planned":
                        iconName = "Testobject_B_Planned.png";
                        break;
                    case "finished":
                        iconName = "Testobject_B_Finished.png";
                        break;
                    case "closed":
                        iconName = "Testobject_B_Closed.png";
                        break;
                    default:
                        iconName = "Testobject.png";
                }
                break;
            case "cycle":
                switch (treeItem.item.status) {
                    case "active":
                        iconName = "TestCycle_Active.png";
                        break;
                    case "planned":
                        iconName = "TestCycle_Planned.png";
                        break;
                    case "finished":
                        iconName = "TestCycle_Finished.png";
                        break;
                    case "closed":
                        iconName = "TestCycle_Closed.png";
                        break;
                    default:
                        iconName = "TestCycle.png";
                }
                break;
            case "TestTheme":
                iconName = "Testtheme_B.png";
                break;
            case "TestCaseSet":
                iconName = "TestCaseSet_B.png";
                break;
            case "TestCase":
                iconName = "TestCase.png";
                break;
            default:
                iconName = "iTB-EE-Logo-22x20.png";
        }

        return path.join(iconFolderPath, iconName);
    }

    updateIcon(collapsibleState: vscode.TreeItemCollapsibleState): void {
        this.iconPath = this.getIconPath(this, collapsibleState);
    }
}

// Command to set the selected item as the root of the tree view
export function makeRoot(treeItem: TreeItem, treeDataProvider: TestBenchTreeDataProvider): void {
    // const treeDataProvider = new TestBenchTreeDataProvider(connection);
    treeDataProvider.makeRoot(treeItem);
    vscode.window.showInformationMessage(`"${treeItem.label}" is now the root.`);
    vscode.window.registerTreeDataProvider("testBenchProjects", treeDataProvider);
}

// Creates a tree view to browse projects
export async function initializeTreeView(
    context: vscode.ExtensionContext,
    connection: PlayServerConnection | null
): Promise<TestBenchTreeDataProvider | null> {
    if (!connection) {
        vscode.window.showInformationMessage("No connection available. Please login first.");
        return null;
    }

    // Create the tree view with the connection
    const treeDataProvider = new TestBenchTreeDataProvider(connection);
    // Create the tree view
    const treeView = vscode.window.createTreeView("testBenchProjects", {
        treeDataProvider,
    });

    // Handle expansion and collapse events for dynamic icon change of tree view items
    treeView.onDidExpandElement((e) => {
        treeDataProvider.handleExpansion(e.element, true);
    });
    treeView.onDidCollapseElement((e) => {
        treeDataProvider.handleExpansion(e.element, false);
    });

    /*
    // TODO: Collapse all tree elements recursively when the tree view is created, this would fix the icon issue after resfreshing the tree view
    async function collapseAllElements(element: TreeItem) {
        treeDataProvider.handleExpansion(element, false); // Collapse the current element
        const children = await treeDataProvider.getChildren(element); // Get children of the element
        if (children) {
            for (const child of children) {
                await collapseAllElements(child); // Recursively collapse all child elements
            }
        }
    }

    // Collapse all root elements and their children recursively        
    const rootElements = await treeDataProvider.getChildren();
    if (rootElements) {
        for (const rootElement of rootElements) {
            await collapseAllElements(rootElement); // Start recursion from root elements
        }
    }
    */

    treeDataProvider.refresh();
    context.subscriptions.push(treeView);

    vscode.window.showInformationMessage("Test Theme Tree initialized.");
    return treeDataProvider;
}
