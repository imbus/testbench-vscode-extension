import * as vscode from "vscode";
import * as path from "path";
import { PlayServerConnection } from "./testbenchConnection";

export class TestThemeTreeDataProvider implements vscode.TreeDataProvider<TestThemeTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TestThemeTreeItem | undefined> = new vscode.EventEmitter<
        TestThemeTreeItem | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<TestThemeTreeItem | undefined> = this._onDidChangeTreeData.event;

    private connection: PlayServerConnection | null = null;
    private rootItem: TestThemeTreeItem | null = null;
    currentProjectKeyInView: string | null = null; // TODO: Temporary solution for new play server, delete later?
    useNewPlayServer: boolean = true; // Temporary flag to switch between old and new play server

    constructor(connection: PlayServerConnection | null, projectKey?: string) {
        this.connection = connection;
        this.currentProjectKeyInView = projectKey ?? null;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getParent(element: TestThemeTreeItem): TestThemeTreeItem | null {
        return element.parent ?? null;
    }

    // getChildren for the new play server
    async getChildrenOfNewPlayServer(element?: TestThemeTreeItem): Promise<TestThemeTreeItem[]> {
        if (!element) {
            if (this.rootItem) {
                // If a root item is set, return its children
                return this.getChildren(this.rootItem);
            }

            // No parent element provided, return the root project (single selected project)
            const projectTreeOfNewPlayServer = await this.connection!.getProjectTreeOfProject(
                this.currentProjectKeyInView
            );
            const rootItem = this.createTreeItemForNewPlayServer(true, projectTreeOfNewPlayServer, null);
            return Promise.resolve(rootItem ? [rootItem] : []);
        } else if (element.contextValue === "project") {
            // Return Test Object Versions (children of the project)
            return Promise.resolve(
                element.item.children!.map((tov: any) => this.createTreeItemForNewPlayServer(false, tov, element))
            );
        } else if (element.contextValue === "version") {
            // Return Test Cycles (children of a version)
            return Promise.resolve(
                element.item.children!.map((cycle: any) => this.createTreeItemForNewPlayServer(false, cycle, element))
            );
        } else if (element.contextValue === "cycle") {
            // If the element is a cycle, load its sub-elements
            return await this.getCycleSubElements(element);
        } else if (element && element.children) {
            // If the element has children (For elements under Test Cycle), return them directly
            return element.children;
        }

        return Promise.resolve([]);
    }

    createTreeItemForNewPlayServer(
        isRoot: boolean,
        data: any,
        element: TestThemeTreeItem | null
    ): TestThemeTreeItem | null {
        if (!data) {
            return null;
        }

        let collapsibleState;
        // TestCaseSet is the last level of the tree, so set collapsibleState to None
        let contextValue = data.nodeType.toLowerCase(); // project, version, cycle, testtheme, testcaseset
        if (contextValue === "testcaseset") {
            collapsibleState = vscode.TreeItemCollapsibleState.None;
            // Set collapsibleState to Collapsed to make items clickable to trigger getChildren when expanded
        } else {
            collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }

        const treeItem = new TestThemeTreeItem(data.name, contextValue, collapsibleState, data);
        treeItem.contextValue = contextValue;
        treeItem.item = data;
        treeItem.parent = isRoot ? null : element ?? null; // Set parent for each non-root item
        return treeItem;
    }

    // TODO: Replace the getChildren code of old play server with new play server implementation
    async getChildren(element?: TestThemeTreeItem): Promise<TestThemeTreeItem[]> {
        if (!this.connection) {
            // vscode.window.showInformationMessage("No connection available for tree view.");
            return [];
        }

        if (this.useNewPlayServer) {
            return this.getChildrenOfNewPlayServer(element);
        } else {
            // If no element is passed, return the root elements which are projects
            if (!element) {
                if (this.rootItem) {
                    // If a root item is set, return its children
                    return this.getChildren(this.rootItem);
                }

                const projectsOldPlayServer = await this.connection.getAllProjectsFromOldPlayServer();
                // Create tree items for each project
                return projectsOldPlayServer.map((project) => {
                    const treeItem = new TestThemeTreeItem(
                        project.name,
                        "project",
                        vscode.TreeItemCollapsibleState.Collapsed,
                        project
                    );
                    treeItem.parent = null; // Root elements have no parent
                    return treeItem;
                });
            } else if (element && element.children) {
                // If the element has children, return them directly
                return element.children;
            } else if (element.contextValue === "project") {
                // Get TOVs for the selected project
                const tovItems = element.item.testObjectVersions || [];
                // Create tree items for each TOV
                return tovItems.map((tov: { name: string }) => {
                    const treeItem = new TestThemeTreeItem(
                        tov.name,
                        "tov",
                        vscode.TreeItemCollapsibleState.Collapsed,
                        tov
                    );
                    treeItem.parent = element; // Set parent for each TOV item
                    return treeItem;
                });
            } else if (element.contextValue === "tov") {
                // Get test cycles for the selected TOV
                const cycleItems = element.item.testCycles || [];
                // Create tree items for each cycle
                return cycleItems.map((cycle: { name: string }) => {
                    const treeItem = new TestThemeTreeItem(
                        cycle.name,
                        "cycle",
                        vscode.TreeItemCollapsibleState.Collapsed,
                        cycle
                    );
                    treeItem.parent = element; // Set parent for each cycle item
                    return treeItem;
                });
            } else if (element.contextValue === "cycle") {
                // If the element is a cycle, load its sub-elements
                return await this.getCycleSubElements(element);
            }
            return [];
        }
    }

    // Fetch cycle structure and build the element tree hierarchy using the numbering field of the elements
    private async getCycleSubElements(element: TestThemeTreeItem): Promise<Thenable<TestThemeTreeItem[]>> {
        // Get the key of the cycle
        const cycleKey = element.item.key.serial ?? element.item.key; // TODO: Workaround to have both old and new play servers, delete key.serial later

        // Function to find the serial key of the project of a cycle element in the tree hierarchy
        function findProjectKeyOfCycle(element: TestThemeTreeItem): string | undefined {
            let currentElement: TestThemeTreeItem | null = element;
            while (currentElement) {
                // Check if the current element is a project, if yes, return its key
                if (currentElement.contextValue === "project") {
                    return currentElement.item.key.serial ?? currentElement.item.key; // TODO: Workaround to have both old and new play servers, delete key.serial later
                }
                currentElement = currentElement.parent ?? null; // Move to the parent element
            }
            return undefined;
        }
        const projectKeyOfCycle = findProjectKeyOfCycle(element);
        if (!projectKeyOfCycle) {
            console.error("Project key of cycle not found.");
            return Promise.resolve([]);
        }

        // console.log("Cycle element: ", element);
        // console.log("Cycle element Project key: ", projectKeyOfCycle);

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

                // Recursively build tree structure using the parentKey property
                function buildTree(parentKey: string): TestThemeTreeItem[] {
                    // Store the child elements of the current parent element being processed.
                    const children: TestThemeTreeItem[] = [];
                    for (const key in elementsByNumbering) {
                        const data = elementsByNumbering[key];
                        // Check if the current element's parentKey matches the given parentKey
                        if (data.base.parentKey === parentKey) {
                            // Dont display TestCase elements in the tree view
                            if (data.elementType === "TestCase") {
                                continue;
                            }

                            // Check if the current element has any children
                            const hasChildren = Object.keys(elementsByNumbering).some(
                                (num) => data.base.key === elementsByNumbering[num].base.parentKey
                            );

                            // Create a new TreeItem for the current element
                            const treeItem = new TestThemeTreeItem(
                                `${data.base.numbering} (${data.elementType}) ${data.base.name} ${data.base.uniqueID}`, // Label
                                `${data.elementType}`, // Context value
                                hasChildren
                                    ? vscode.TreeItemCollapsibleState.Collapsed
                                    : vscode.TreeItemCollapsibleState.None,
                                data
                            );
                            treeItem.parent = element; // Set parent for each tree item
                            // console.log("  TreeItem created:", treeItem);

                            // Process the child elements recursively
                            if (hasChildren) {
                                treeItem.children = buildTree(data.base.key);
                            }

                            // Add the TreeItem to the children array
                            children.push(treeItem);
                        }
                    }
                    return children;
                }

                // Get the root element
                const rootKey = cycleData.root.base.key;
                return Promise.resolve(buildTree(rootKey));
            }
        }
        return Promise.resolve([]); // Return an empty array if no data is found
    }

    getTreeItem(element: TestThemeTreeItem): vscode.TreeItem {
        return element;
    }

    // Set the selected item as the root and refresh the tree view
    makeRoot(treeItem: TestThemeTreeItem): void {
        this.rootItem = treeItem;
        this.refresh();
    }

    // Handle item expansion and collapse events
    handleExpansion(element: TestThemeTreeItem, expanded: boolean) {
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
    }

    // Creates a tree view to browse projects
    /*
    async initializeTreeView(
        context: vscode.ExtensionContext,
        connection: PlayServerConnection | null,
        selectedProjectKey?: string // TODO: New play server solution. Make it a non optional parameter later?
    ): Promise<TestThemeTreeDataProvider | null> {
        if (!connection) {
            vscode.window.showInformationMessage("No connection available. Please login first.");
            return null;
        }

        this.connection = connection;
        this.currentProjectKeyInView = selectedProjectKey ?? null;

        // Create the tree view
        const treeView = vscode.window.createTreeView("testBenchProjects", {
            treeDataProvider: this,
        });

        // Handle expansion and collapse events for dynamic icon change of tree view items
        treeView.onDidExpandElement((e) => {
            this.handleExpansion(e.element, true);
        });
        treeView.onDidCollapseElement((e) => {
            this.handleExpansion(e.element, false);
        });

        this.refresh();
        context.subscriptions.push(treeView);
        return this;
    }*/
}

// Represents a tree item (Project, TOV, Cycle, etc) in the tree view
export class TestThemeTreeItem extends vscode.TreeItem {
    parent?: TestThemeTreeItem | null; // Track the parent of each tree item
    children?: TestThemeTreeItem[] | null; // Add a children property to store child elements

    constructor(
        public readonly label: string,
        public contextValue: string, // The type of the tree item (Project, TOV, Cycle etc.)
        public collapsibleState: vscode.TreeItemCollapsibleState,
        public item: any
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
    private getIconPath(
        treeItem: TestThemeTreeItem,
        collapsibleState: vscode.TreeItemCollapsibleState
    ): string | vscode.Uri {
        const iconFolderPath = path.join(__dirname, "..", "resources", "icons");

        let iconName = "testbench-icon.svg";
        switch (treeItem.contextValue) {
            case "project":
                // TODO: Add the remaining icons for different statuses
                switch (treeItem.item.status.toLowerCase()) {
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
            case "version":
                switch (treeItem.item.status.toLowerCase()) {
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
                switch (treeItem.item.status.toLowerCase()) {
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
export function makeRoot(treeItem: TestThemeTreeItem, treeDataProvider: TestThemeTreeDataProvider): void {
    // const treeDataProvider = new TestBenchTreeDataProvider(connection);
    treeDataProvider.makeRoot(treeItem);
    vscode.window.showInformationMessage(`"${treeItem.label}" is now the root.`);
    vscode.window.registerTreeDataProvider("testBenchProjects", treeDataProvider);
}

// Creates a tree view to browse projects
export async function initializeTreeView_TO_REMOVE(
    context: vscode.ExtensionContext,
    connection: PlayServerConnection | null,
    selectedProjectKey?: string // TODO: New play server solution. Make it a non optional parameter later?
): Promise<TestThemeTreeDataProvider | null> {
    if (!connection) {
        vscode.window.showInformationMessage("No connection available. Please login first.");
        return null;
    }

    // Create the tree view with the connection
    const testThemeDataProvider = new TestThemeTreeDataProvider(connection, selectedProjectKey!);
    // const testThemeDataProvider = new TestThemeTreeDataProvider(connection, selectedProjectKey!);
    // Create the tree view
    const treeView = vscode.window.createTreeView("testBenchProjects", {
        treeDataProvider: testThemeDataProvider,
    });

    // Handle expansion and collapse events for dynamic icon change of tree view items
    treeView.onDidExpandElement((e) => {
        testThemeDataProvider.handleExpansion(e.element, true);
    });
    treeView.onDidCollapseElement((e) => {
        testThemeDataProvider.handleExpansion(e.element, false);
    });

    testThemeDataProvider.refresh();
    context.subscriptions.push(treeView);
    return testThemeDataProvider;
}
