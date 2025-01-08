import * as vscode from "vscode";
import * as path from "path";
import { PlayServerConnection } from "./testBenchConnection";
import { TestThemeTreeDataProvider } from "./testThemeTreeView";
import { connection, logger } from "./extension";
import * as testBenchTypes from "./testBenchTypes";

let projectManagementTreeView: vscode.TreeView<TestbenchTreeItem> | null = null;
let projectManagementDataProvider: ProjectManagementTreeDataProvider | null = null;

let testThemeTreeView: vscode.TreeView<TestbenchTreeItem> | null = null;

// Project management tree view that displays projects, versions and cycles.
// Upon clicking on a cycle element, the remaining children elements are displayed in test theme tree (test themes and test case sets).
export class ProjectManagementTreeDataProvider implements vscode.TreeDataProvider<TestbenchTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TestbenchTreeItem | void> =
        new vscode.EventEmitter<TestbenchTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<TestbenchTreeItem | void> = this._onDidChangeTreeData.event;

    // The root item (A project) of the tree view
    private rootItem: TestbenchTreeItem | null = null;
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

    getParent(element: TestbenchTreeItem): TestbenchTreeItem | null {
        return element.parent;
    }

    private createTreeItem(
        data: any,
        parent: TestbenchTreeItem | null,
        isRoot: boolean = false
    ): TestbenchTreeItem | null {
        if (!data) {
            return null;
        }

        const contextValue: string = data.nodeType; // Project, Version, Cycle, testthemenode, TestCaseSetNode, TestCaseNode
        const collapsibleState: vscode.TreeItemCollapsibleState =
            contextValue === "Cycle"
                ? vscode.TreeItemCollapsibleState.None // Test cycles are set to none to be non expandable, the user can click on it to see the test themes
                : vscode.TreeItemCollapsibleState.Collapsed; // Set collapsibleState to Collapsed to make items clickable to trigger getChildren when expanded
        const treeItem: TestbenchTreeItem = new TestbenchTreeItem(
            data.name,
            contextValue,
            collapsibleState,
            data,
            parent
        );
        return treeItem;
    }

    async getChildren(element?: TestbenchTreeItem): Promise<TestbenchTreeItem[]> {
        if (!connection) {
            // vscode.window.showWarningMessage("No connection available for tree view.");
            return [];
        }

        if (!element) {
            if (this.rootItem) {
                // If a root item is set, return its children
                return await this.getChildren(this.rootItem);
            }

            // No parent element provided, return the root project (single selected project)
            const projectTree: testBenchTypes.TreeNode | null = await connection.getProjectTreeOfProject(
                this.currentProjectKeyInView
            );
            const rootItem: TestbenchTreeItem | null = this.createTreeItem(projectTree, null, true);
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
        const children: TestbenchTreeItem[] = childrenData
            .map((childData: any) => this.createTreeItem(childData, element))
            .filter((item: any): item is TestbenchTreeItem => item !== null);

        return children;
    }

    // Fetches the sub-elements of a cycle element and builds the tree structure
    public async getChildrenOfCycle(element: TestbenchTreeItem): Promise<TestbenchTreeItem[]> {
        const cycleKey: string = element.item.key;
        const projectKey: string | undefined = findProjectKeyOfCycleElement(element);

        if (!projectKey) {
            // console.warn("Project key of cycle not found.");
            logger.warn("Project key of cycle not found (getChildrenOfCycle).");
            return [];
        }

        if (!connection) {
            // console.warn("No connection available for tree view.");
            logger.warn("No connection available for tree view (getChildrenOfCycle).");
            return [];
        }

        const cycleData: testBenchTypes.CycleStructure | null = await connection.fetchCycleStructureOfCycleInProject(
            projectKey,
            cycleKey
        );

        if (!cycleData || !cycleData.nodes?.length) {
            // console.warn("Cycle has no sub-elements.");
            logger.warn("Cycle has no sub-elements (getChildrenOfCycle).");
            return [];
        }

        // A key identifies an element uniquely.
        // Create a map to store elements by their key
        const elementsByKey = new Map<string, any>();
        cycleData.nodes.forEach((data: any) => {
            elementsByKey.set(data.base.key, data);
        });

        // Recursively builds the tree structure starting from a given parent key.
        const buildTree = (parentKey: string): TestbenchTreeItem[] => {
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

                        const treeItem = new TestbenchTreeItem(
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

        const rootKey: string = cycleData.root.base.key;
        const children: TestbenchTreeItem[] = buildTree(rootKey); // Build the tree starting from the root key
        element.children = children; // Assign the built children to the current element
        // Display the test theme tree view if not already displayed
        await vscode.commands.executeCommand("testThemeTree.focus");
        return children;
    }

    getTreeItem(element: TestbenchTreeItem): vscode.TreeItem {
        return element;
    }

    // Set the selected item as the root and refresh the tree view
    makeRoot(treeItem: TestbenchTreeItem): void {
        this.rootItem = treeItem;
        this.refresh();
    }

    async handleExpansion(element: TestbenchTreeItem, expanded: boolean): Promise<void> {
        // console.log(`@@ Element ${element.label} is expanded: ${expanded}`);
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();

        // The test Cycles are not expandable anymore, but this code is left to be able to switch back to expandable cycles.
        // If the element is a test cycle and expanding it, initialize the test theme tree
        if (expanded) {
            await this.handleTestCycleClick(element);
        }
    }

    // Trigger initialization of test theme tree when a test cycle is clicked
    async handleTestCycleClick(testCycleItem: TestbenchTreeItem): Promise<void> {
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
export function findProjectKeyOfCycleElement(element: TestbenchTreeItem): string | undefined {
    if (element.contextValue !== "Cycle") {
        // console.error("Element is not a cycle.");
        logger.error("Element is not a cycle (findProjectKeyOfCycleElement).");
        return undefined;
    }
    let currentElement: TestbenchTreeItem | null = element;
    while (currentElement) {
        if (currentElement.contextValue === "Project") {
            return currentElement.item.key;
        }
        currentElement = currentElement.parent;
    }
    // console.error("Project key not found.");
    logger.error("Project key not found (findProjectKeyOfCycleElement).");
    return undefined;
}

// Function to find the serial key of the project of a cycle element in the tree hierarchy
export function findCycleKeyOfTreeElement(element: TestbenchTreeItem): string | undefined {
    /*
    if ((element.contextValue !== "TestThemeNode") && (element.contextValue !== "TestCaseSetNode")) {
        console.error("Invalid tree element type.");
        return undefined;
    }*/
    let currentElement: TestbenchTreeItem | null = element;
    while (currentElement) {
        if (currentElement.contextValue === "Cycle") {
            return currentElement?.item?.key;
        }
        currentElement = currentElement?.parent;
    }
    // console.error("Cycle key not found.");
    logger.error("Cycle key not found (findCycleKeyOfTreeElement).");
    return undefined;
}

// Represents a tree item (Project, TOV, Cycle, etc) in the tree view
export class TestbenchTreeItem extends vscode.TreeItem {
    public parent: TestbenchTreeItem | null;
    public children?: TestbenchTreeItem[];
    public statusOfTreeItem: string;

    constructor(
        label: string,
        contextValue: string, // The type of the tree item (Project, TOV, Cycle etc.)
        collapsibleState: vscode.TreeItemCollapsibleState,
        public item: any, // The original data of the tree item
        parent: TestbenchTreeItem | null = null
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
        const iconFolderPath: string = path.join(__dirname, "..", "resources", "icons");
        const statusOfTreeItem: string = this.item.status || "default"; // (Active, Planned, Finished, Closed etc.)
        const treeItemType: string = this.contextValue!; // (Project, TOV, Cycle etc.)

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
                default: "TBU_Logo_cropped.svg",
            },
        };

        const contextIcons: Record<string, string> = iconMap[treeItemType] || iconMap["default"];
        const iconFileName: string =
            contextIcons[statusOfTreeItem] || contextIcons["default"] || iconMap.default.default;

        return path.join(iconFolderPath, iconFileName);
    }

    updateIcon(): void {
        this.iconPath = this.getIconPath();
    }
}

// TODO: Refactor this function
export async function initializeTreeViews(
    context: vscode.ExtensionContext,
    connection: PlayServerConnection | null,
    selectedProjectKey?: string
): Promise<[ProjectManagementTreeDataProvider | null, TestThemeTreeDataProvider | null]> {
    if (!connection) {
        vscode.window.showErrorMessage("No connection available. Please log in first.");
        return [null, null];
    }

    const testThemeDataProvider = new TestThemeTreeDataProvider();

    testThemeTreeView = vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: testThemeDataProvider,
    });

    projectManagementDataProvider = new ProjectManagementTreeDataProvider(
        connection,
        selectedProjectKey,
        testThemeDataProvider
    );

    projectManagementTreeView = vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: projectManagementDataProvider,
    });

    // Handle expansion and collapse events to update icons dynamically
    projectManagementTreeView.onDidExpandElement(async (event) => {
        await projectManagementDataProvider!.handleExpansion(event.element, true);
    });

    projectManagementTreeView.onDidCollapseElement(async (event) => {
        await projectManagementDataProvider!.handleExpansion(event.element, false);
    });

    // Handle click events to trigger test theme tree initialization on test cycle click
    projectManagementTreeView.onDidChangeSelection(async (event) => {
        //  Retrieve the currently selected element in the tree view
        const selectedElement = event.selection[0];
        if (selectedElement && selectedElement.contextValue === "Cycle") {
            await projectManagementDataProvider!.handleTestCycleClick(selectedElement);
        }
    });

    context.subscriptions.push(testThemeTreeView);
    testThemeDataProvider.refresh();

    await vscode.commands.executeCommand("projectManagementTree.focus"); // Display the project management tree view if not displayed already

    return [projectManagementDataProvider, testThemeDataProvider];
}

// Hide the project management tree view
export async function hideProjectManagementTreeView(): Promise<void> {
    await vscode.commands.executeCommand("projectManagementTree.removeView"); // projectManagementTree is the ID of the tree view in package.json
}

// Display the project management tree view
async function displayProjectManagementTreeView(): Promise<void> {
    await vscode.commands.executeCommand("projectManagementTree.focus");
}

// Hide the test theme tree view
export async function hideTestThemeTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testThemeTree.removeView"); // testThemeTree is the ID of the tree view in package.json
}

// Display the test theme tree view
async function displayTestThemeTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testThemeTree.focus");
}

// Function to toggle the visibility of the project management tree view
export async function toggleProjectManagementTreeViewVisibility(): Promise<void> {
    logger.debug("Toggling project tree view visibility.");
    if (projectManagementTreeView) {
        if (projectManagementTreeView.visible) {
            logger.trace("Project Tree view is visible. Hiding tree view.");

            await hideProjectManagementTreeView();

            logger.trace("Project tree view is hidden now.");
        } else {
            logger.trace("Project tree view is hidden. Revealing tree view.");

            await displayProjectManagementTreeView();

            logger.trace("Project tree view is displayed now.");
        }
    }
}

// Function to toggle the visibility of the test theme tree view
export async function toggleTestThemeTreeViewVisibility(): Promise<void> {
    logger.debug("Toggling test theme tree view visibility.");
    if (testThemeTreeView) {
        if (testThemeTreeView.visible) {
            logger.trace("Test theme tree view is visible. Hiding tree view.");

            await hideTestThemeTreeView();

            logger.trace("Test theme tree view is hidden now.");
        } else {
            logger.trace("Test theme tree view is hidden. Revealing tree view.");

            await displayTestThemeTreeView();

            logger.trace("Test theme tree view is displayed now.");
        }
    }
}
