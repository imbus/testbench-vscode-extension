import * as vscode from "vscode";
import * as path from "path";
import { PlayServerConnection } from "./testBenchConnection";
import { TestThemeTreeDataProvider } from "./testThemeTreeView";
import { connection } from "./extension";

// Project management tree view that displays projects, versions and cycles.
// Upon clicking on a cycle element, the remaining children elements are displayed in test theme tree (test themes and test case sets).
export class ProjectManagementTreeDataProvider implements vscode.TreeDataProvider<ProjectManagementTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProjectManagementTreeItem | void> =
        new vscode.EventEmitter<ProjectManagementTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<ProjectManagementTreeItem | void> = this._onDidChangeTreeData.event;

    private rootItem: ProjectManagementTreeItem | null = null;
    // The key of the project currently in view in the tree
    currentProjectKeyInView: string | null;
    // The test theme tree data provider to offload the test theme tree data
    testThemeDataProvider: TestThemeTreeDataProvider;

    constructor(
        connection: PlayServerConnection | null,
        projectKey?: string,
        testThemeDataProvider?: TestThemeTreeDataProvider
    ) {
        this.currentProjectKeyInView = projectKey ?? null;
        this.testThemeDataProvider = testThemeDataProvider!;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getParent(element: ProjectManagementTreeItem): ProjectManagementTreeItem | null {
        return element.parent;
    }

    private createTreeItem(
        data: any,
        parent: ProjectManagementTreeItem | null,
        isRoot: boolean = false
    ): ProjectManagementTreeItem | null {
        if (!data) {
            return null;
        }

        const contextValue = data.nodeType; // Project, Version, Cycle, testthemenode, TestCaseSetNode, TestCaseNode
        const collapsibleState =
            contextValue === "Cycle"
                ? vscode.TreeItemCollapsibleState.None // Test cycles are set to none to be non expandable, the user can click on it to see the test themes
                : vscode.TreeItemCollapsibleState.Collapsed; // Set collapsibleState to Collapsed to make items clickable to trigger getChildren when expanded
        const treeItem = new ProjectManagementTreeItem(data.name, contextValue, collapsibleState, data, parent);
        return treeItem;
    }

    async getChildren(element?: ProjectManagementTreeItem): Promise<ProjectManagementTreeItem[]> {
        if (!connection) {
            // vscode.window.showWarningMessage("No connection available for tree view.");
            return [];
        }

        if (!element) {
            if (this.rootItem) {
                // If a root item is set, return its children
                return this.getChildren(this.rootItem);
            }

            // No parent element provided, return the root project (single selected project)
            const projectTree = await connection.getProjectTreeOfProject(this.currentProjectKeyInView);
            const rootItem = this.createTreeItem(projectTree, null, true);
            return rootItem ? [rootItem] : [];
        }

        if (element.contextValue === "Cycle") {
            // Clear the test theme tree when a cycle is expanded so that clicking on a new test cycle will not show the old test themes
            this.testThemeDataProvider.clearTree();
            // Offload the children of the cycle to the Test Theme Tree
            this.testThemeDataProvider.setRoots(await this.getChildrenOfCycle(element));

            return []; // Return an empty array to prevent expansion in the Project Management Tree
        } else if (element && element.children) {
            // Return children directly if they exist (for elements under Test Cycle)
            return element.children;
        }

        const childrenData = element.item.children ?? [];
        // Create tree items for the children of the current element
        const children = childrenData
            .map((childData: any) => this.createTreeItem(childData, element))
            .filter((item: any): item is ProjectManagementTreeItem => item !== null);

        return children;
    }

    // Fetches the sub-elements of a cycle element and builds the tree structure
    public async getChildrenOfCycle(element: ProjectManagementTreeItem): Promise<ProjectManagementTreeItem[]> {
        const cycleKey = element.item.key;
        const projectKey = findProjectKeyOfCycleElement(element);

        if (!projectKey) {
            console.error("Project key of cycle not found.");
            return [];
        }

        if (!connection) {
            console.error("No connection available for tree view.");
            return [];
        }

        const cycleData = await connection.fetchCycleStructure(projectKey, cycleKey);

        if (!cycleData || !cycleData.nodes?.length) {
            console.warn("Cycle has no sub-elements.");
            return [];
        }

        // A key identifies an element uniquely.
        // Create a map to store elements by their key
        const elementsByKey = new Map<string, any>();
        cycleData.nodes.forEach((data: any) => {
            elementsByKey.set(data.base.key, data);
        });

        // Recursively builds the tree structure starting from a given parent key.
        const buildTree = (parentKey: string): ProjectManagementTreeItem[] => {
            return (
                Array.from(elementsByKey.values())
                    // Filter elements that have the current parentKey and are not TestCaseNode elements
                    .filter((data) => data.base.parentKey === parentKey && data.elementType !== "TestCaseNode")
                    // Filter out not executable elements and elements that are locked by the system
                    .filter((data) => data.exec?.status !== "NotPlanned" && data.exec?.locker?.key !== "-2")
                    .map((data) => {
                        const hasChildren = Array.from(elementsByKey.values()).some(
                            (childData) => childData.base.parentKey === data.base.key
                        );

                        const treeItem = new ProjectManagementTreeItem(
                            `${data.base.numbering} ${data.base.name}`,
                            data.elementType,
                            // TestCaseSetNode are the last level of the tree, so they are not collapsible.
                            // Only show the expand icon if the element has children.
                            data.elementType === "TestCaseSetNode"
                                ? vscode.TreeItemCollapsibleState.None
                                : hasChildren
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

    getTreeItem(element: ProjectManagementTreeItem): vscode.TreeItem {
        return element;
    }

    // Set the selected item as the root and refresh the tree view
    makeRoot(treeItem: ProjectManagementTreeItem): void {
        this.rootItem = treeItem;
        this.refresh();
    }

    handleExpansion(element: ProjectManagementTreeItem, expanded: boolean): void {
        // console.log(`@@ Element ${element.label} is expanded: ${expanded}`);
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();

        // The test Cycles are not expandable anymore, but this code is left to be able to switch back to expandable cycles.
        // If the element is a test cycle and expanding it, initialize the test theme tree
        if (expanded) {
            this.handleTestCycleClick(element);
        }
    }

    // Trigger initialization of test theme tree when a test cycle is clicked
    async handleTestCycleClick(testCycleItem: ProjectManagementTreeItem): Promise<void> {
        // console.log(`Element ${testCycleItem.label} is clicked.`);
        if (testCycleItem.contextValue === "Cycle") {
            // Use the existing refresh or data loading function for initializing the test theme tree
            this.testThemeDataProvider.clearTree();
            this.testThemeDataProvider.setRoots(await this.getChildrenOfCycle(testCycleItem));
        }
    }

    clearTree(): void {
        this.testThemeDataProvider.clearTree();
        this.rootItem = null;
        this.refresh();
    }
}

// Function to find the serial key of the project of a cycle element in the tree hierarchy
export function findProjectKeyOfCycleElement(element: ProjectManagementTreeItem): string | undefined {
    if (element.contextValue !== "Cycle") {
        console.error("Element is not a cycle.");
        return undefined;
    }
    let currentElement: ProjectManagementTreeItem | null = element;
    while (currentElement) {
        if (currentElement.contextValue === "Project") {
            return currentElement.item.key;
        }
        currentElement = currentElement.parent;
    }
    console.error("Project key not found.");
    return undefined;
}

// Function to find the serial key of the project of a cycle element in the tree hierarchy
export function findCycleKeyOfTreeElement(element: ProjectManagementTreeItem): string | undefined {
    /*
    if ((element.contextValue !== "TestThemeNode") && (element.contextValue !== "TestCaseSetNode")) {
        console.error("Invalid tree element type.");
        return undefined;
    }*/
    let currentElement: ProjectManagementTreeItem | null = element;
    while (currentElement) {
        if (currentElement.contextValue === "Cycle") {
            return currentElement?.item?.key;
        }
        currentElement = currentElement?.parent;
    }
    console.error("Cycle key not found.");
    return undefined;
}

// Represents a tree item (Project, TOV, Cycle, etc) in the tree view
export class ProjectManagementTreeItem extends vscode.TreeItem {
    public parent: ProjectManagementTreeItem | null;
    public children?: ProjectManagementTreeItem[];
    public statusOfTreeItem: string;

    constructor(
        label: string,
        contextValue: string, // The type of the tree item (Project, TOV, Cycle etc.)
        collapsibleState: vscode.TreeItemCollapsibleState,
        public item: any,
        parent: ProjectManagementTreeItem | null = null
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this.parent = parent;
        this.updateIcon();
        this.statusOfTreeItem = item.exec?.status || item.status || "None"; // (Active, Planned, Finished, Closed etc.)

        // Set the tooltip based on the context value
        // Tooltip for project, TOV, cycle: Type, Name, Status, Key
        if (contextValue === "Project" || contextValue === "Version" || contextValue === "Cycle") {
            this.tooltip = `Type: ${contextValue}, Name: ${item.name}, Status: ${this.statusOfTreeItem}, Key: ${item.key}`;
        }
        // Tooltip for test theme, test case set, test case: Numbering, Type, Name, Status, ID
        else if (
            contextValue === "TestThemeNode" ||
            contextValue === "TestCaseSetNode" ||
            contextValue === "TestCaseNode"
        ) {
            if (item?.base?.numbering) {
                this.tooltip = `Numbering: ${item.base.numbering}, Type: ${item.elementType}, Name: ${item.base.name}, Status: ${this.statusOfTreeItem}, ID: ${item.base.uniqueID}`;
            }
        }
    }

    private getIconPath(): string {
        const iconFolderPath = path.join(__dirname, "..", "resources", "icons");
        const statusOfTreeItem = this.item.status || "default"; // (Active, Planned, Finished, Closed etc.)
        const treeItemType = this.contextValue!; // (Project, TOV, Cycle etc.)

        // Map the context and status to the corresponding icon file name
        const iconMap: Record<string, Record<string, string>> = {
            Project: {
                active: "projects.svg",
                planned: "projects.svg",
                finished: "projects.svg",
                closed: "projects.svg",
                default: "projects.svg",
            },
            Version: {
                active: "TOV-specification.svg",
                planned: "TOV-specification.svg",
                finished: "TOV-specification.svg",
                closed: "TOV-specification.svg",
                default: "TOV-specification.svg",
            },
            Cycle: {
                active: "Cycle-execution.svg",
                planned: "Cycle-execution.svg",
                finished: "Cycle-execution.svg",
                closed: "Cycle-execution.svg",
                default: "Cycle-execution.svg",
            },
            TestThemeNode: {
                default: "TestThemeOriginal.svg",
            },
            TestCaseSetNode: {
                default: "TestCaseSetOriginal.svg",
            },
            TestCaseNode: {
                default: "TestCase.svg",
            },
            default: {
                default: "iTB-EE-Logo.svg",
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

export async function initializeTreeView(
    context: vscode.ExtensionContext,
    connection: PlayServerConnection | null,
    selectedProjectKey?: string
): Promise<[ProjectManagementTreeDataProvider | null, TestThemeTreeDataProvider | null]> {
    if (!connection) {
        vscode.window.showErrorMessage("No connection available. Please log in first.");
        return [null, null];
    }

    const testThemeDataProvider = new TestThemeTreeDataProvider();

    const testThemeTreeView = vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: testThemeDataProvider,
    });

    const projectManagementDataProvider = new ProjectManagementTreeDataProvider(
        connection,
        selectedProjectKey,
        testThemeDataProvider
    );
    const projectManagementTreeView = vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: projectManagementDataProvider,
    });

    // Handle expansion and collapse events to update icons dynamically
    projectManagementTreeView.onDidExpandElement((event) => {
        projectManagementDataProvider.handleExpansion(event.element, true);
    });

    projectManagementTreeView.onDidCollapseElement((event) => {
        projectManagementDataProvider.handleExpansion(event.element, false);
    });

    // Handle click events to trigger test theme tree initialization on test cycle click
    projectManagementTreeView.onDidChangeSelection((event) => {
        //  Retrieve the currently selected element in the tree view
        const selectedElement = event.selection[0];
        if (selectedElement && selectedElement.contextValue === "Cycle") {
            projectManagementDataProvider.handleTestCycleClick(selectedElement);
        }
    });

    context.subscriptions.push(testThemeTreeView);
    testThemeDataProvider.refresh();

    return [projectManagementDataProvider, testThemeDataProvider];
}
