import * as vscode from "vscode";
import * as path from "path";
import { PlayServerConnection } from "./testBenchConnection";

export class TestThemeTreeDataProvider implements vscode.TreeDataProvider<TestThemeTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TestThemeTreeItem | void> =
        new vscode.EventEmitter<TestThemeTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<TestThemeTreeItem | void> = this._onDidChangeTreeData.event;

    private connection: PlayServerConnection | null;
    private rootItem: TestThemeTreeItem | null = null;
    private currentProjectKeyInView: string | null;

    constructor(connection: PlayServerConnection | null, projectKey?: string) {
        this.connection = connection;
        this.currentProjectKeyInView = projectKey ?? null;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getParent(element: TestThemeTreeItem): TestThemeTreeItem | null {
        return element.parent;
    }

    private createTreeItem(
        data: any,
        parent: TestThemeTreeItem | null,
        isRoot: boolean = false
    ): TestThemeTreeItem | null {
        if (!data) {
            return null;
        }

        const contextValue = data.nodeType.toLowerCase(); // project, version, cycle, testtheme, testcaseset, testcase
        const collapsibleState =
            contextValue === "testcaseset"
                ? vscode.TreeItemCollapsibleState.None // TestCaseSet is the last level of the tree, so set collapsibleState to None
                : vscode.TreeItemCollapsibleState.Collapsed; // Set collapsibleState to Collapsed to make items clickable to trigger getChildren when expanded

        const treeItem = new TestThemeTreeItem(data.name, contextValue, collapsibleState, data, parent);
        return treeItem;
    }

    async getChildren(element?: TestThemeTreeItem): Promise<TestThemeTreeItem[]> {
        if (!this.connection) {
            // vscode.window.showInformationMessage("No connection available for tree view.");
            return [];
        }

        if (!element) {
            if (this.rootItem) {
                // If a root item is set, return its children
                return this.getChildren(this.rootItem);
            }

            // No parent element provided, return the root project (single selected project)
            const projectTree = await this.connection.getProjectTreeOfProject(this.currentProjectKeyInView);
            const rootItem = this.createTreeItem(projectTree, null, true);
            return rootItem ? [rootItem] : [];
        }

        if (element.contextValue === "cycle") {
            return this.getCycleSubElements(element);
        } else if (element && element.children) {
            // Return children directly if they exist (for elements under Test Cycle)
            return element.children;
        }

        const childrenData = element.item.children ?? [];
        // Create tree items for the children of the current element
        const children = childrenData
            .map((childData: any) => this.createTreeItem(childData, element))
            .filter((item: any): item is TestThemeTreeItem => item !== null);

        return children;
    }

    private async getCycleSubElements(element: TestThemeTreeItem): Promise<TestThemeTreeItem[]> {
        const cycleKey = element.item.key;
        const projectKey = findProjectKeyOfCycle(element);

        if (!projectKey) {
            console.error("Project key of cycle not found.");
            return [];
        }

        // console.log("Cycle element: ", element);
        // console.log("Cycle element Project key: ", projectKeyOfCycle);

        const cycleData = await this.connection?.fetchCycleStructure(projectKey, cycleKey);

        if (!cycleData || !cycleData.nodes?.length) {
            console.log("Cycle has no sub-elements.");
            return [];
        }

        // A key identifies an element uniquely.
        // Create a map to store elements by their key
        const elementsByKey = new Map<string, any>();
        cycleData.nodes.forEach((data: any) => {
            elementsByKey.set(data.base.key, data);
        });

        // Recursively builds the tree structure starting from a given parent key.
        const buildTree = (parentKey: string): TestThemeTreeItem[] => {
            return (
                Array.from(elementsByKey.values())
                    // Filter elements that have the current parentKey and are not TestCase elements
                    .filter((data) => data.base.parentKey === parentKey && data.elementType !== "TestCase")
                    .map((data) => {
                        const hasChildren = Array.from(elementsByKey.values()).some(
                            (childData) => childData.base.parentKey === data.base.key
                        );

                        const treeItem = new TestThemeTreeItem(
                            `${data.base.numbering} (${data.elementType}) ${data.base.name} ${data.base.uniqueID}`,
                            data.elementType.toLowerCase(),
                            hasChildren
                                ? vscode.TreeItemCollapsibleState.Collapsed
                                : vscode.TreeItemCollapsibleState.None,
                            data,
                            element
                        );

                        // If the current element has children, recursively build their tree items
                        if (hasChildren) {
                            treeItem.children = buildTree(data.base.key);
                        }

                        return treeItem;
                    })
            );
        };

        const rootKey = cycleData.root.base.key;
        const children = buildTree(rootKey); // Build the tree starting from the root key
        element.children = children; // Assign the built children to the current element
        return children;
    }

    getTreeItem(element: TestThemeTreeItem): vscode.TreeItem {
        return element;
    }

    // Set the selected item as the root and refresh the tree view
    makeRoot(treeItem: TestThemeTreeItem): void {
        this.rootItem = treeItem;
        this.refresh();
    }

    handleExpansion(element: TestThemeTreeItem, expanded: boolean): void {
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();
    }

    clearTree(): void {
        this.rootItem = null;
        this.connection = null;
        this.refresh();
    }
}

// Function to find the serial key of the project of a cycle element in the tree hierarchy
export function findProjectKeyOfCycle(element: TestThemeTreeItem): string | undefined {
    let currentElement: TestThemeTreeItem | null = element;
    while (currentElement) {
        if (currentElement.contextValue === "project") {
            return currentElement.item.key;
        }
        currentElement = currentElement.parent;
    }
    return undefined;
}

// Represents a tree item (Project, TOV, Cycle, etc) in the tree view
export class TestThemeTreeItem extends vscode.TreeItem {
    public parent: TestThemeTreeItem | null;
    public children?: TestThemeTreeItem[];

    constructor(
        label: string,
        contextValue: string, // The type of the tree item (Project, TOV, Cycle etc.)
        collapsibleState: vscode.TreeItemCollapsibleState,
        public item: any,
        parent: TestThemeTreeItem | null = null
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this.parent = parent;
        this.updateIcon();
    }

    private getIconPath(): string {
        const iconFolderPath = path.join(__dirname, "..", "resources", "icons");
        const statusOfTreeItem = this.item.status?.toLowerCase() || "default"; // (Active, Planned, Finished, Closed etc.)
        const treeItemType = this.contextValue!.toLowerCase(); // (Project, TOV, Cycle etc.)

        // Map the context and status to the corresponding icon file name
        const iconMap: Record<string, Record<string, string>> = {
            project: {
                active: "Project_B_Active.png",
                planned: "Project_B_Planned.png",
                finished: "Project_B_Finished.png",
                closed: "Project_B_Closed.png",
                default: "Project.png",
            },
            version: {
                active: "Testobject_B_Active.png",
                planned: "Testobject_B_Planned.png",
                finished: "Testobject_B_Finished.png",
                closed: "Testobject_B_Closed.png",
                default: "Testobject.png",
            },
            cycle: {
                active: "TestCycle_Active.png",
                planned: "TestCycle_Planned.png",
                finished: "TestCycle_Finished.png",
                closed: "TestCycle_Closed.png",
                default: "TestCycle.png",
            },
            testtheme: {
                default: "Testtheme_B.png",
            },
            testcaseset: {
                default: "TestCaseSet_B.png",
            },
            testcase: {
                default: "TestCase.png",
            },
            default: {
                default: "iTB-EE-Logo-22x20.png",
            },
        };

        const contextIcons = iconMap[treeItemType] || iconMap["default"];
        const iconFileName = contextIcons[statusOfTreeItem] || contextIcons["default"] || iconMap.default.default;

        return path.join(iconFolderPath, iconFileName);
    }

    updateIcon(): void {
        this.iconPath = this.getIconPath();
    }
}

export function makeRoot(treeItem: TestThemeTreeItem, treeDataProvider: TestThemeTreeDataProvider): void {
    treeDataProvider.makeRoot(treeItem);
    vscode.window.showInformationMessage(`"${treeItem.label}" is now the root.`);
    vscode.window.registerTreeDataProvider("projectManagementTree", treeDataProvider);
}

export async function initializeTreeView_TO_REMOVE(
    context: vscode.ExtensionContext,
    connection: PlayServerConnection | null,
    selectedProjectKey?: string
): Promise<TestThemeTreeDataProvider | null> {
    if (!connection) {
        vscode.window.showErrorMessage("No connection available. Please log in first.");
        return null;
    }

    const testThemeDataProvider = new TestThemeTreeDataProvider(connection, selectedProjectKey);
    const treeView = vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: testThemeDataProvider,
    });

    // Handle expansion and collapse events to update icons dynamically
    treeView.onDidExpandElement((event) => {
        testThemeDataProvider.handleExpansion(event.element, true);
    });

    treeView.onDidCollapseElement((event) => {
        testThemeDataProvider.handleExpansion(event.element, false);
    });

    context.subscriptions.push(treeView);
    testThemeDataProvider.refresh();

    return testThemeDataProvider;
}
