/**
 * @file projectManagementTreeView.ts
 * @description Provides the data provider and view management for the project management tree and test theme tree.
 * Project management tree displays the selected project and its test object versions and cycles.
 * Upon clicking on a test cycle element in project management tree, a test theme tree view is created under the project tree view
 * and the children elements of the test cycle (test themes and test case sets) are displayed in the test theme tree.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as testBenchTypes from "./testBenchTypes";
import { TestThemeTreeDataProvider } from "./testThemeTreeView";
import {
    connection,
    logger,
    setProjectTreeView,
    projectTreeView,
    setProjectManagementTreeDataProvider
} from "./extension";
import { testElementsTreeDataProvider } from "./extension";
import { TreeItemContextValues } from "./constants";

// Global references to the tree views and data provider with getters and setters.
export let projectManagementTreeView: vscode.TreeView<ProjectManagementTreeItem> | null = null;
export function getProjectManagementTreeView(): vscode.TreeView<ProjectManagementTreeItem> | null {
    return projectManagementTreeView;
}
export function setProjectManagementTreeView(view: vscode.TreeView<ProjectManagementTreeItem> | null): void {
    projectManagementTreeView = view;
}

export let projectManagementDataProvider: ProjectManagementTreeDataProvider | null = null;
export function getProjectManagementDataProvider(): ProjectManagementTreeDataProvider | null {
    return projectManagementDataProvider;
}
export function setProjectManagementDataProvider(provider: ProjectManagementTreeDataProvider | null): void {
    projectManagementDataProvider = provider;
}

export let testThemeTreeView: vscode.TreeView<ProjectManagementTreeItem> | null = null;
export function getTestThemeTreeView(): vscode.TreeView<ProjectManagementTreeItem> | null {
    return testThemeTreeView;
}
export function setTestThemeTreeView(view: vscode.TreeView<ProjectManagementTreeItem> | null): void {
    testThemeTreeView = view;
}

/**
 * Provides data for the project management tree view.
 * This tree view displays the selected project, its test object versions, and cycles.
 * When a test cycle element is clicked, its children (test themes and test case sets) are offloaded to the test theme tree view.
 */
export class ProjectManagementTreeDataProvider implements vscode.TreeDataProvider<ProjectManagementTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProjectManagementTreeItem | void> =
        new vscode.EventEmitter<ProjectManagementTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<ProjectManagementTreeItem | void> = this._onDidChangeTreeData.event;

    // The root item (a project) of the project management tree view.
    private rootItem: ProjectManagementTreeItem | null = null;
    // The project key currently in view.
    activeProjectKeyInView: string | null;

    public setActiveProjectKeyInView(key: string | null): void {
        this.activeProjectKeyInView = key;
    }
    // The test theme tree data provider used to display test themes.
    testThemeDataProvider: TestThemeTreeDataProvider;

    setTestThemeDataProvider(provider: TestThemeTreeDataProvider): void {
        this.testThemeDataProvider = provider;
    }
    // Store keys of expanded nodes to restore expansion state of collapsible elements after the refresh button is clicked.
    private expandedTreeItems = new Set<string>();

    /**
     * Constructs a new ProjectManagementTreeDataProvider.
     *
     * @param {string} activeProjectKey Optional project key in view.
     * @param {TestThemeTreeDataProvider} testThemeDataProvider Optional test theme tree data provider.
     */
    constructor(activeProjectKey?: string, testThemeDataProvider?: TestThemeTreeDataProvider) {
        this.activeProjectKeyInView = activeProjectKey ?? null;
        this.testThemeDataProvider = testThemeDataProvider!;
    }

    /**
     * Refreshes the tree view.
     */
    refresh(): void {
        logger.debug("Refreshing project management tree view.");
        this.storeExpandedTreeItems(this.rootItem);
        this.rootItem = null;
        this._onDidChangeTreeData.fire();
        logger.trace("Project management tree view refreshed.");
    }

    /**
     * Recursively stores the keys of expanded tree items.
     * Used to restore expansion state of collapsible elements after the refresh button is clicked.
     *
     * @param {ProjectManagementTreeItem| null} element The tree item to store.
     */
    private storeExpandedTreeItems(element: ProjectManagementTreeItem | null): void {
        if (element) {
            if (element.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                this.expandedTreeItems.add(element.item.key);
            }
            // Recursively check child elements
            if (element.children) {
                element.children.forEach((child) => this.storeExpandedTreeItems(child));
            }
        }
    }

    /**
     * Returns the parent of a given tree item.
     *
     * @param {ProjectManagementTreeItem} element The tree item.
     * @returns {ProjectManagementTreeItem | null} The parent tree item or null.
     */
    getParent(element: ProjectManagementTreeItem): ProjectManagementTreeItem | null {
        return element.parent;
    }

    /**
     * Creates a TestbenchTreeItem from raw JSON data.
     *
     * @param {any} jsonData The raw JSON data.
     * @param {ProjectManagementTreeItem | null} parent The parent tree item.
     * @returns {ProjectManagementTreeItem | null} A new TestbenchTreeItem or null.
     */
    private createTreeItem(jsonData: any, parent: ProjectManagementTreeItem | null): ProjectManagementTreeItem | null {
        if (!jsonData) {
            return null;
        }

        // Use the nodeType from the json data as contextValue.
        // contextValue can be one of these types, which can be found in the response from the server:
        // Project, Version, Cycle, TestThemeNode, TestCaseSetNode, TestCaseNode
        const contextValue: string = jsonData.nodeType;
        // For Cycle elements, we set collapsibleState to None since children of test cycles are shown in the Test Theme Tree.
        const collapsibleState: vscode.TreeItemCollapsibleState =
            contextValue === "Cycle" ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed;

        const treeItem: ProjectManagementTreeItem = new ProjectManagementTreeItem(
            jsonData.name,
            contextValue,
            collapsibleState,
            jsonData,
            parent
        );

        // Restore expansion state (after a refresh) if the node was previously expanded.
        // Cycles are not expandable in tree view, so only expand other elements.
        if (this.expandedTreeItems.has(treeItem.item.key) && contextValue !== "Cycle") {
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }

        return treeItem;
    }

    /**
     * Gets the children of a given tree item.
     * If no element is provided, it returns the root project.
     * Called when the tree view is first loaded or refreshed.
     *
     * @param {ProjectManagementTreeItem} element Optional parent tree item.
     * @returns {Promise<ProjectManagementTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    async getChildren(element?: ProjectManagementTreeItem): Promise<ProjectManagementTreeItem[]> {
        try {
            if (!connection) {
                return [];
            }
            if (!element) {
                // If a root item is set, return its children
                if (this.rootItem) {
                    return await this.getChildren(this.rootItem);
                }
                // No parent provided; load the root project.
                const projectTree: testBenchTypes.TreeNode | null = await connection.getProjectTreeOfProject(
                    this.activeProjectKeyInView
                );
                if (!projectTree) {
                    return [];
                }
                const rootItem: ProjectManagementTreeItem | null = this.createTreeItem(projectTree, null);
                return rootItem ? [rootItem] : [];
            }
            if (element.contextValue === "Cycle") {
                // When a cycle is clicked, clear the old test theme tree and offload cycle's children to the test theme tree view.
                this.testThemeDataProvider.clearTree();
                const children = await this.getChildrenOfCycle(element);
                this.testThemeDataProvider.setRoots(children);
                return []; // Return an empty array to prevent expansion in the Project Management Tree
            } else if (element.children) {
                // Return children directly if they exist (for elements under Test Cycle)
                return element.children;
            }

            const childrenData = element.item.children ?? [];
            // Create tree items for the children of the current element
            const children: ProjectManagementTreeItem[] = childrenData
                .map((childData: any) => this.createTreeItem(childData, element))
                .filter((item: any): item is ProjectManagementTreeItem => item !== null);
            return children;
        } catch (error) {
            logger.error(`Error fetching children for element ${element?.label || "root"}:`, error);
            return [];
        }
    }

    /**
     * Fetches the sub-elements of a cycle element and builds the test theme tree.
     *
     * @param {ProjectManagementTreeItem} element The cycle tree item.
     * @returns {Promise<ProjectManagementTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    public async getChildrenOfCycle(element: ProjectManagementTreeItem): Promise<ProjectManagementTreeItem[]> {
        logger.trace("Fetching children of cycle element:", element.label);
        const cycleKey: string = element.item.key;
        const projectKey: string | null = findProjectKeyOfCycleElement(element);

        if (!projectKey) {
            logger.warn("Project key of cycle not found (getChildrenOfCycle).");
            return [];
        }
        if (!connection) {
            logger.warn("No connection available (getChildrenOfCycle).");
            return [];
        }

        const cycleData: testBenchTypes.CycleStructure | null = await connection.fetchCycleStructureOfCycleInProject(
            projectKey,
            cycleKey
        );

        // If the cycle has no sub-elements, return an empty array
        if (!cycleData || !cycleData.nodes?.length) {
            logger.warn("Cycle has no sub-elements (getChildrenOfCycle).");
            return [];
        }

        // Create a map to store elements by their key. A key identifies an element uniquely.
        const elementsByKey = new Map<string, any>();
        cycleData.nodes.forEach((data: any) => {
            elementsByKey.set(data.base.key, data);
        });

        /**
         * Recursively builds the test theme tree starting from a given parent cycle key.
         *
         * @param {string} parentCycleKey - The key of the parent cycle.
         * @returns {ProjectManagementTreeItem[]} An array of tree items representing the test theme tree.
         */
        const buildTestThemeTree = (parentCycleKey: string): ProjectManagementTreeItem[] => {
            return (
                Array.from(elementsByKey.values())
                    // Filter elements that have the current parentKey and are not TestCaseNode elements
                    .filter(
                        (data) =>
                            data.base.parentKey === parentCycleKey &&
                            data.elementType !== TreeItemContextValues.TEST_CASE_NODE
                    )
                    // Filter out non-executable elements and elements that are locked by the system
                    .filter((data) => data.exec?.status !== "NotPlanned" && data.exec?.locker?.key !== "-2")
                    .map((data) => {
                        const hasChildren: boolean = Array.from(elementsByKey.values()).some(
                            (childData) => childData.base.parentKey === data.base.key
                        );
                        const treeItem: ProjectManagementTreeItem = new ProjectManagementTreeItem(
                            `${data.base.numbering} ${data.base.name}`,
                            data.elementType,
                            // TestCaseSetNode are the last level of the tree, so they are not collapsible.
                            // Only show the expand icon if the element has children.
                            data.elementType === TreeItemContextValues.TEST_CASE_SET_NODE
                                ? vscode.TreeItemCollapsibleState.None
                                : hasChildren
                                  ? vscode.TreeItemCollapsibleState.Collapsed
                                  : vscode.TreeItemCollapsibleState.None,
                            data,
                            element
                        );
                        // Maintain expansion state after a refresh if the element was expanded before
                        if (this.expandedTreeItems.has(treeItem.item.key)) {
                            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                        }
                        // If the current element has children, recursively build their tree items
                        if (hasChildren) {
                            treeItem.children = buildTestThemeTree(data.base.key);
                        }
                        return treeItem;
                    })
            );
        };

        const rootCycleKey: string = cycleData.root.base.key;
        // Build the tree starting from the root key
        const childrenOfCycle: ProjectManagementTreeItem[] = buildTestThemeTree(rootCycleKey);
        // Assign the built children to the current element
        element.children = childrenOfCycle;

        // Display the test theme tree view if not already displayed
        await vscode.commands.executeCommand("testThemeTree.focus");

        // Update the title of the test theme tree view
        if (testThemeTreeView) {
            testThemeTreeView.title = `Test Themes (${element.label})`;
        }
        return childrenOfCycle;
    }

    /**
     * Returns a TreeItem representation for the given element.
     *
     * @param {ProjectManagementTreeItem} element The tree item.
     * @returns {vscode.TreeItem} The tree item.
     */
    getTreeItem(element: ProjectManagementTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Sets the selected tree item as the root and refreshes the tree.
     *
     * @param {ProjectManagementTreeItem} treeItem The tree item to set as root.
     */
    makeRoot(treeItem: ProjectManagementTreeItem): void {
        logger.debug("Setting selected element as root:", treeItem);
        this.rootItem = treeItem;
        this.refresh();
    }

    /**
     * Handles expansion and collapse of a tree item.
     *
     * @param {ProjectManagementTreeItem} element The tree item.
     * @param {boolean} expanded True if the item is expanded, false otherwise.
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
     */
    async handleExpansion(element: ProjectManagementTreeItem, expanded: boolean): Promise<void> {
        logger.trace(`Setting expansion state of ${element.label} to ${expanded ? "expanded" : "collapsed"}.`);
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();
        // Store the expanded nodes to restore the expansion state after refreshing the tree
        if (expanded) {
            this.expandedTreeItems.add(element.item.key);
        } else {
            this.expandedTreeItems.delete(element.item.key);
        }
        // The test Cycles are not expandable anymore, but this code is left to be able to switch back to expandable cycles.
        // If the element is a test cycle, expanding it initializes the test theme tree
        if (expanded) {
            await this.handleTestCycleClick(element);
        }
    }

    /**
     * Handles a click on a test cycle element to initialize the test theme tree and the test elements tree.
     *
     * @param {ProjectManagementTreeItem} projectsTreeViewItem The clicked tree item in the projects tree view.
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
     */
    async handleTestCycleClick(projectsTreeViewItem: ProjectManagementTreeItem): Promise<void> {
        logger.trace("Handling tree item click for:", projectsTreeViewItem.label);
        if (projectsTreeViewItem.contextValue === "Cycle") {
            // Display a progress bar since this operation may take some time.
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Fetching Data From Server",
                    cancellable: false
                },
                async (progress) => {
                    logger.trace("Clicked tree item is a cycle. Creating test theme tree view.");
                    progress.report({ increment: 0, message: "Fetching test themes..." });

                    // Clear and set up the test theme tree view.
                    this.testThemeDataProvider.clearTree();
                    const children = await this.getChildrenOfCycle(projectsTreeViewItem);
                    this.testThemeDataProvider.setRoots(children);

                    progress.report({ increment: 50, message: "Fetching test elements..." });

                    // If the cycle has a parent of type TreeItemContextValues.VERSION, fetch and display test elements.
                    if (projectsTreeViewItem.parent?.item?.nodeType === TreeItemContextValues.VERSION) {
                        const tovKeyOfSelectedCycleElement = projectsTreeViewItem.parent?.item?.key;
                        logger.trace(
                            `Clicked cycle item has a parent TOV with the key: ${tovKeyOfSelectedCycleElement}. Creating test elements view using the TOV.`
                        );
                        await testElementsTreeDataProvider.fetchAndDisplayTestElements(
                            tovKeyOfSelectedCycleElement,
                            typeof projectsTreeViewItem.parent?.label === "string"
                                ? projectsTreeViewItem.parent.label
                                : undefined
                        );
                    }
                    // Hide the project management tree view after displaying the test theme tree view.
                    await hideProjectManagementTreeView();

                    progress.report({ increment: 100, message: "Processing complete." });
                }
            );
        }
    }

    /**
     * Clears the entire project management tree.
     */
    clearTree(): void {
        logger.trace("Clearing project management tree.");
        if (this.testThemeDataProvider) {
            this.testThemeDataProvider.clearTree();
        }
        this.rootItem = null;
        this.refresh();
    }
}

/**
 * Finds the project key (serial) for a given cycle element by traversing upward in the tree hierarchy.
 *
 * @param {ProjectManagementTreeItem} element The cycle tree item.
 * @returns {string | null} The project key as a string if found; otherwise null.
 */
export function findProjectKeyOfCycleElement(element: ProjectManagementTreeItem): string | null {
    logger.trace("Finding project key for cycle element:", element.label);
    if (element.contextValue !== "Cycle") {
        logger.error("Element is not a cycle; cannot find project key.");
        return null;
    }
    let current: ProjectManagementTreeItem | null = element;
    while (current) {
        if (current.contextValue === TreeItemContextValues.PROJECT) {
            return current.item.key;
        }
        current = current.parent;
    }
    const projectKeyNotFoundErrorMessage: string = `Project key not found in tree element: ${element.label}`;
    logger.error(projectKeyNotFoundErrorMessage);
    vscode.window.showErrorMessage(projectKeyNotFoundErrorMessage);
    return null;
}

/**
 * Finds the cycle key (serial) for a given tree element by traversing upward in the tree hierarchy.
 *
 * @param {ProjectManagementTreeItem} element The tree item.
 * @returns {string | null} The cycle key as a string if found; otherwise null.
 */
export function findCycleKeyOfTreeElement(element: ProjectManagementTreeItem): string | null {
    logger.trace("Finding cycle key for tree element:", element.label);
    let current: ProjectManagementTreeItem | null = element;
    while (current) {
        if (current.contextValue === "Cycle") {
            logger.trace("Found cycle key:", current.item.key);
            return current.item.key;
        }
        current = current.parent;
    }
    const cycleKeyNotFoundErrorMessage: string = `Cycle key not found in tree element: ${element.label}`;
    logger.error(cycleKeyNotFoundErrorMessage);
    vscode.window.showErrorMessage(cycleKeyNotFoundErrorMessage);
    return null;
}

// TODO: The name ProjectManagementTreeItem is not quite right since this is also used for test theme tree items.
/**
 * Represents a tree item (Project, TOV, Cycle, TestThemeNode, TestCaseSetNode, etc.) in the tree view.
 */
export class ProjectManagementTreeItem extends vscode.TreeItem {
    public parent: ProjectManagementTreeItem | null;
    public children?: ProjectManagementTreeItem[];
    public statusOfTreeItem: string;

    /**
     * Constructs a new TestbenchTreeItem.
     *
     * @param {string} label The label to display.
     * @param {string} contextValue The type of the tree item.
     * @param {vscode.TreeItemCollapsibleState} collapsibleState The initial collapsible state.
     * @param {any} item The original data of the tree item.
     * @param {ProjectManagementTreeItem | null} parent The parent tree item.
     */
    constructor(
        label: string,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public item: any,
        parent: ProjectManagementTreeItem | null = null
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this.parent = parent;
        this.updateIcon();
        this.statusOfTreeItem = item.exec?.status || item.status || "None"; // Possible values: Active, Planned, Finished, Closed, etc.

        // Set the tooltip based on the context value.
        // Tooltip for project, TOV and cycle elements looks like this: Type, Name, Status, Key
        if (
            contextValue === TreeItemContextValues.PROJECT ||
            contextValue === TreeItemContextValues.VERSION ||
            contextValue === TreeItemContextValues.CYCLE
        ) {
            this.tooltip = `Type: ${contextValue}\nName: ${item.name}\nStatus: ${this.statusOfTreeItem}\nKey: ${item.key}`;
        }
        // Tooltip for test theme, test case set and test case looks like this: Numbering, Type, Name, Status, ID
        else if (
            contextValue === TreeItemContextValues.TEST_THEME_NODE ||
            contextValue === TreeItemContextValues.TEST_CASE_SET_NODE ||
            contextValue === TreeItemContextValues.TEST_CASE_NODE
        ) {
            if (item?.base?.numbering) {
                this.tooltip = `Numbering: ${item.base.numbering}\nType: ${item.elementType}\nName: ${item.base.name}\nStatus: ${this.statusOfTreeItem}\nID: ${item.base.uniqueID}`;
            }
            // Display the uniqueID as a description next to the label.
            this.description = item.base.uniqueID || "";
        }
    }

    /**
     * Determines the icon path for the tree item based on its type and status.
     * Currently this is not used fully, but it allows to have different icons for different statuses of the tree items like the TestBench Client.
     *
     * @returns The absolute icon path to the icon file.
     */
    private getIconPath(): { light: string; dark: string } {
        const iconFolderPath: string = path.join(__dirname, "..", "resources", "icons");
        const status = this.item.status || "default"; // (Active, Planned, Finished, Closed etc.)
        const type = this.contextValue; // (Project, TOV, Cycle etc.)
        // Map the context and status to the corresponding icon file name
        const iconMap: Record<string, Record<string, { light: string; dark: string }>> = {
            Project: {
                active: { light: "projects-light.svg", dark: "projects-dark.svg" },
                planned: { light: "projects-light.svg", dark: "projects-dark.svg" },
                finished: { light: "projects-light.svg", dark: "projects-dark.svg" },
                closed: { light: "projects-light.svg", dark: "projects-dark.svg" },
                default: { light: "projects-light.svg", dark: "projects-dark.svg" }
            },
            Version: {
                active: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                planned: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                finished: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                closed: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                default: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" }
            },
            Cycle: {
                active: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                planned: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                finished: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                closed: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                default: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" }
            },
            TestThemeNode: {
                default: { light: "TestThemeOriginal-light.svg", dark: "TestThemeOriginal-dark.svg" }
            },
            TestCaseSetNode: {
                default: { light: "TestCaseSetOriginal-light.svg", dark: "TestCaseSetOriginal-dark.svg" }
            },
            TestCaseNode: {
                default: { light: "TestCase-light.svg", dark: "TestCase-dark.svg" }
            },
            default: {
                default: { light: "TBU_Logo_cropped.svg", dark: "TBU_Logo_cropped.svg" }
            }
        };

        // Map the context and status to the corresponding icon file name
        const typeIcons = iconMap[type as keyof typeof iconMap] || iconMap["default"];
        const iconFileNames = typeIcons[status] || typeIcons["default"] || iconMap.default.default;

        // Return the full paths for light and dark mode icons
        return {
            light: path.join(iconFolderPath, iconFileNames.light),
            dark: path.join(iconFolderPath, iconFileNames.dark)
        };
    }

    /**
     * Updates the tree item's icon.
     */
    updateIcon(): void {
        const iconPaths = this.getIconPath();
        this.iconPath = {
            light: vscode.Uri.file(iconPaths.light),
            dark: vscode.Uri.file(iconPaths.dark)
        };
    }
}

/**
 * Initializes the test theme tree view.
 * This function creates a new tree view for test themes and sets its data provider.
 * @returns {TestThemeTreeDataProvider} The initialized test theme tree data provider.
 */
function initializeTestThemeTreeView(): TestThemeTreeDataProvider {
    logger.debug("Initializing test theme tree.");
    const testThemeDataProvider: TestThemeTreeDataProvider = new TestThemeTreeDataProvider();
    testThemeTreeView = vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: testThemeDataProvider
    });
    return testThemeDataProvider;
}

/**
 * Initializes the project management tree view.
 * This function creates a new tree view for project management and sets its data provider.
 * @param {string | undefined} selectedProjectKey The key of the selected project.
 * @param {TestThemeTreeDataProvider} testThemeDataProvider The test theme tree data provider.
 * @returns {ProjectManagementTreeDataProvider} The initialized project management tree data provider.
 */
function createProjectDataProviderAndView(
    selectedProjectKey?: string | undefined,
    testThemeDataProvider?: TestThemeTreeDataProvider
): ProjectManagementTreeDataProvider {
    logger.debug("Initializing project management tree view.");
    projectManagementDataProvider = new ProjectManagementTreeDataProvider(selectedProjectKey, testThemeDataProvider);
    setProjectTreeView(
        vscode.window.createTreeView("projectManagementTree", {
            treeDataProvider: projectManagementDataProvider
        })
    );

    return projectManagementDataProvider;
}

/**
 * Sets up event listeners for the project tree view to handle expand/collapse and selection events.
 * These events update the expansion state, icons dynamically, and initialize the test theme tree on cycle click.
 */
function setupProjectTreeViewEventListeners(): void {
    // Handle expand events to update expansion state and icons dynamically.
    projectTreeView.onDidExpandElement(async (event) => {
        await projectManagementDataProvider!.handleExpansion(event.element, true);
    });

    // Handle collapse events to update expansion state and icons dynamically.
    projectTreeView.onDidCollapseElement(async (event) => {
        await projectManagementDataProvider!.handleExpansion(event.element, false);
    });

    // Handle selection changes (click events) to trigger test theme tree initialization on cycle click.
    projectTreeView.onDidChangeSelection(async (event) => {
        // Retrieve the currently selected element in the tree view.
        const selectedElement: ProjectManagementTreeItem = event.selection[0];
        if (selectedElement && selectedElement.contextValue === "Cycle") {
            await projectManagementDataProvider!.handleTestCycleClick(selectedElement);
        }
    });
}

/**
 * Initializes the project management tree view and test theme tree view and set the global references.
 *
 * @param {vscode.ExtensionContext} context The VS Code extension context.
 * @param {string} selectedProjectKey Optional project key.
 * @returns {Promise<void>} A promise that resolves when the initialization is complete.
 */
export async function initializeProjectAndTestThemeTrees(
    context: vscode.ExtensionContext,
    selectedProjectKey?: string
): Promise<void> {
    logger.debug("Initializing project and test theme trees.");

    // Setup the project management tree view.
    createProjectDataProviderAndView(selectedProjectKey);
    setupProjectTreeViewEventListeners();
    if (!projectManagementDataProvider) {
        logger.error("Failed to create project management tree data provider.");
        return;
    }
    setProjectManagementTreeDataProvider(projectManagementDataProvider);
    context.subscriptions.push(projectTreeView);

    // Setup the test theme tree view.
    const testThemeDataProvider: TestThemeTreeDataProvider = initializeTestThemeTreeView();
    if (!testThemeTreeView) {
        logger.error("Failed to create test theme tree view.");
        return;
    }
    projectManagementDataProvider.setTestThemeDataProvider(testThemeDataProvider);
    projectManagementDataProvider.testThemeDataProvider.refresh();
    context.subscriptions.push(testThemeTreeView);

    // Display the project management tree view if not displayed already
    await vscode.commands.executeCommand("projectManagementTree.focus");
}

/**
 * Hides the project management tree view.
 */
export async function hideProjectManagementTreeView(): Promise<void> {
    // projectManagementTree is the ID of the tree view in package.json
    await vscode.commands.executeCommand("projectManagementTree.removeView");
}

/**
 * Displays the project management tree view.
 */
export async function displayProjectManagementTreeView(): Promise<void> {
    await vscode.commands.executeCommand("projectManagementTree.focus");
}

/**
 * Hides the test theme tree view.
 */
export async function hideTestThemeTreeView(): Promise<void> {
    // testThemeTree is the ID of the tree view in package.json
    await vscode.commands.executeCommand("testThemeTree.removeView");
}

/**
 * Displays the test theme tree view.
 */
async function displayTestThemeTreeView(): Promise<void> {
    await vscode.commands.executeCommand("testThemeTree.focus");
}

/**
 * Toggles the visibility of the project management tree view.
 */
export async function toggleProjectManagementTreeViewVisibility(): Promise<void> {
    logger.debug("Toggling project management tree view visibility.");
    if (projectManagementTreeView) {
        if (projectManagementTreeView.visible) {
            logger.trace("Project tree view is visible. Hiding it.");
            await hideProjectManagementTreeView();
            logger.trace("Project tree view is now hidden.");
        } else {
            logger.trace("Project tree view is hidden. Displaying it.");
            await displayProjectManagementTreeView();
            logger.trace("Project tree view is now displayed.");
        }
    }
}

/**
 * Toggles the visibility of the test theme tree view.
 */
export async function toggleTestThemeTreeViewVisibility(): Promise<void> {
    logger.debug("Toggling test theme tree view visibility.");
    if (testThemeTreeView) {
        if (testThemeTreeView.visible) {
            logger.trace("Test theme tree view is visible. Hiding it.");
            await hideTestThemeTreeView();
            logger.trace("Test theme tree view is now hidden.");
        } else {
            logger.trace("Test theme tree view is hidden. Displaying it.");
            await displayTestThemeTreeView();
            logger.trace("Test theme tree view is now displayed.");
        }
    }
}
