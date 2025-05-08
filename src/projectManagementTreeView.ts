/**
 * @file projectManagementTreeView.ts
 * @description Provides the data provider and view management for the project management tree and test theme tree.
 * Project management tree displays the selected project and its test object versions and cycles.
 * Upon clicking on a test cycle element in project management tree, a test theme tree view is created under the project tree view
 * and the children elements of the test cycle (test themes and test case sets) are displayed in the test theme tree.
 */

import * as vscode from "vscode";
import * as path from "path";
import { CycleNodeData, CycleStructure, Project, TreeNode } from "./testBenchTypes";
import { TestThemeTreeDataProvider } from "./testThemeTreeView";
import {
    connection,
    logger,
    setProjectTreeView,
    projectTreeView,
    projectManagementTreeDataProvider,
    setProjectManagementTreeDataProvider
} from "./extension";
import { testElementsTreeDataProvider } from "./extension";
import { allExtensionCommands, TreeItemContextValues } from "./constants";
import { clearTestElementsTreeView, displayTestElementsTreeView } from "./testElementsTreeView";

// Global references to the tree views and data provider with getters and setters.
export let projectManagementTreeView: vscode.TreeView<BaseTestBenchTreeItem> | null = null;
export function getProjectManagementTreeView(): vscode.TreeView<BaseTestBenchTreeItem> | null {
    return projectManagementTreeView;
}
export function setProjectManagementTreeView(view: vscode.TreeView<BaseTestBenchTreeItem> | null): void {
    projectManagementTreeView = view;
}

export let testThemeTreeView: vscode.TreeView<BaseTestBenchTreeItem> | null = null;
export function getTestThemeTreeView(): vscode.TreeView<BaseTestBenchTreeItem> | null {
    return testThemeTreeView;
}
export function setTestThemeTreeView(view: vscode.TreeView<BaseTestBenchTreeItem> | null): void {
    testThemeTreeView = view;
}

/**
 * Provides data for the project management tree view.
 * This tree view displays the selected project, its test object versions, and cycles.
 * When a test cycle element is clicked, its children (test themes and test case sets) are offloaded to the test theme tree view.
 */
export class ProjectManagementTreeDataProvider implements vscode.TreeDataProvider<BaseTestBenchTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<
        BaseTestBenchTreeItem | BaseTestBenchTreeItem[] | void | undefined
    > = // Allow undefined for root refresh
        new vscode.EventEmitter<BaseTestBenchTreeItem | BaseTestBenchTreeItem[] | void | undefined>();
    readonly onDidChangeTreeData: vscode.Event<BaseTestBenchTreeItem | BaseTestBenchTreeItem[] | void | undefined> =
        this._onDidChangeTreeData.event;

    // The test theme tree data provider used to display test themes.
    testThemeDataProvider: TestThemeTreeDataProvider;
    setTestThemeDataProvider(provider: TestThemeTreeDataProvider): void {
        this.testThemeDataProvider = provider;
    }

    // Store keys of expanded nodes to restore expansion state of collapsible elements after a refresh.
    private expandedTreeItems: Set<string> = new Set<string>();

    /**
     * Constructs a new ProjectManagementTreeDataProvider.
     *
     * @param {TestThemeTreeDataProvider} testThemeDataProvider Optional test theme tree data provider.
     */
    constructor(testThemeDataProvider?: TestThemeTreeDataProvider) {
        this.testThemeDataProvider = testThemeDataProvider!;
    }

    /**
     * Refreshes the tree view.
     */
    refresh(): void {
        logger.debug("Refreshing project management tree view.");
        this._onDidChangeTreeData.fire(undefined); // Fire with undefined to refresh from the root
        logger.trace("Project management tree view refreshed.");
    }

    /**
     * Returns the parent of a given tree item.
     *
     * @param {BaseTestBenchTreeItem} element The tree item.
     * @returns {BaseTestBenchTreeItem | null} The parent tree item or null.
     */
    getParent(element: BaseTestBenchTreeItem): BaseTestBenchTreeItem | null {
        return element.parent;
    }

    // Factory method to create a tree item based on the provided JSON data and context value.
    static TreeItemFactory = class {
        static create(
            jsonData: any, // Can be Project, TreeNode, or CycleStructure node's 'base' or the node itself
            contextValue: string, // Explicit context value like TreeItemContextValues.PROJECT
            parent: BaseTestBenchTreeItem | null
        ): BaseTestBenchTreeItem | null {
            let itemKey: string | undefined;
            let itemName: string | undefined;
            let itemData: any; // This will hold the object that BaseTestBenchTreeItem's 'item' property will refer to.
            let label: string;
            let defaultCollapsibleState: vscode.TreeItemCollapsibleState;

            // Normalize data extraction
            // For TestThemeNode, TestCaseSetNode, TestCaseNode, jsonData is expected to be the 'base' object or the full node from CycleStructure
            if (
                contextValue === TreeItemContextValues.TEST_THEME_NODE ||
                contextValue === TreeItemContextValues.TEST_CASE_SET_NODE ||
                contextValue === TreeItemContextValues.TEST_CASE_NODE
            ) {
                // If jsonData itself has 'key' and 'name', it might be the 'base' object already.
                // If it has 'base.key', then it's the full CycleStructure node.
                itemData = jsonData.base || jsonData; // Use jsonData.base if it exists, otherwise jsonData
                if (!itemData || typeof itemData.key === "undefined" || typeof itemData.name === "undefined") {
                    logger.warn("Attempted to create test theme/case tree item with invalid data structure:", jsonData);
                    return null;
                }
                itemKey = itemData.key;
                itemName = itemData.name;
                label = itemData.numbering ? `${itemData.numbering} ${itemName}` : itemName!;
            } else {
                // For Project, Version, Cycle
                itemData = jsonData; // jsonData is testBenchTypes.Project or testBenchTypes.TreeNode
                if (!itemData || typeof itemData.key === "undefined" || typeof itemData.name === "undefined") {
                    logger.warn(
                        "Attempted to create project/version/cycle tree item with invalid data structure:",
                        jsonData
                    );
                    return null;
                }
                itemKey = itemData.key;
                itemName = itemData.name;
                label = itemName!;
            }

            if (itemKey === undefined || itemName === undefined) {
                logger.warn(
                    `Attempted to create tree item with missing key or name. Context: ${contextValue}, Key: ${itemKey}, Name: ${itemName}`,
                    jsonData
                );
                return null;
            }

            // Determine default collapsible state based on type and potential children
            switch (contextValue) {
                case TreeItemContextValues.PROJECT: {
                    const projectData = itemData as Project;
                    const hasProjectChildren =
                        (projectData.tovsCount && projectData.tovsCount > 0) ||
                        (projectData.cyclesCount && projectData.cyclesCount > 0);
                    defaultCollapsibleState = hasProjectChildren
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None;
                    break;
                }
                case TreeItemContextValues.VERSION: {
                    const versionData = itemData as TreeNode;
                    defaultCollapsibleState =
                        versionData.children && versionData.children.length > 0
                            ? vscode.TreeItemCollapsibleState.Collapsed
                            : vscode.TreeItemCollapsibleState.None;
                    break;
                }
                case TreeItemContextValues.CYCLE:
                    defaultCollapsibleState = vscode.TreeItemCollapsibleState.None; // Cycles offload children
                    break;
                case TreeItemContextValues.TEST_THEME_NODE:
                    // Test Themes are collapsible, Test Case Sets are not.
                    defaultCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                    break;
                case TreeItemContextValues.TEST_CASE_SET_NODE:
                    defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
                    break;
                case TreeItemContextValues.TEST_CASE_NODE: // Test cases are not displayed in these trees
                    defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
                    break;
                default:
                    defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
            }

            // itemData (which is jsonData or jsonData.base) is passed to BaseTestBenchTreeItem constructor
            return new BaseTestBenchTreeItem(label, contextValue, defaultCollapsibleState, itemData, parent);
        }
    };

    /**
     * Creates a TestbenchTreeItem from raw JSON data.
     * Handles expansion state restoration for collapsible items.
     *
     * @param {any} jsonData The raw JSON data.
     * @param {string} explicitContextValue An explicit context value if jsonData.nodeType is not reliable.
     * @param {BaseTestBenchTreeItem | null} parent The parent tree item.
     * @returns {BaseTestBenchTreeItem | null} A new TestbenchTreeItem or null.
     */
    private createTreeItem(
        jsonData: any,
        explicitContextValue: string,
        parent: BaseTestBenchTreeItem | null
    ): BaseTestBenchTreeItem | null {
        if (!jsonData) {
            // TreeItemFactory will do more detailed validation
            logger.warn("Attempted to create tree item with invalid jsonData (null or undefined).");
            return null;
        }

        const treeItem = ProjectManagementTreeDataProvider.TreeItemFactory.create(
            jsonData, // Pass the raw jsonData
            explicitContextValue,
            parent
        );

        if (!treeItem) {
            return null;
        }

        // Restore Expansion State
        // The `itemKey` used for expandedTreeItems should come from treeItem.item.key
        // which the factory has now set based on the jsonData structure.
        const itemKeyForExpansion = treeItem.item?.key;
        if (
            itemKeyForExpansion &&
            this.expandedTreeItems.has(itemKeyForExpansion) &&
            treeItem.collapsibleState !== vscode.TreeItemCollapsibleState.None
        ) {
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            logger.trace(`Restoring expanded state for item: ${treeItem.label} (Key: ${itemKeyForExpansion})`);
        }

        return treeItem;
    }

    /**
     * Fetches and returns the children (Test Object Versions) for a given Project element.
     * @param {BaseTestBenchTreeItem} projectElement The parent Project element.
     * @returns {Promise<BaseTestBenchTreeItem[]>}
     * @private
     */
    private async getChildrenForProject(projectElement: BaseTestBenchTreeItem): Promise<BaseTestBenchTreeItem[]> {
        logger.debug(`Workspaceing children (TOVs) for project: ${projectElement.label}`);
        const projectKey = projectElement.item.key;
        if (!projectKey) {
            logger.error(`Project key is missing for project item: ${projectElement.label}`);
            return [];
        }

        const projectTree: TreeNode | null = await connection!.getProjectTreeOfProject(projectKey); // connection is checked

        if (projectTree && projectTree.children && projectTree.children.length > 0) {
            return projectTree.children
                .map(
                    (
                        tovNode // tovNode is testBenchTypes.TreeNode
                    ) => this.createTreeItem(tovNode, tovNode.nodeType, projectElement) // tovNode.nodeType should be "Version"
                )
                .filter((item: BaseTestBenchTreeItem | null): item is BaseTestBenchTreeItem => item !== null);
        }
        logger.debug(`No children (TOVs) found for project: ${projectElement.label}`);
        return [];
    }

    /**
     * Returns the children (Cycles) for a given Version (TOV) element.
     * These are typically pre-loaded as part of the Version's data.
     * @param {BaseTestBenchTreeItem} versionElement The parent Version element.
     * @returns {BaseTestBenchTreeItem[]}
     * @private
     */
    private getChildrenForVersion(versionElement: BaseTestBenchTreeItem): BaseTestBenchTreeItem[] {
        logger.debug(`Workspaceing children (Cycles) for TOV: ${versionElement.label}`);
        // element.item is testBenchTypes.TreeNode representing a TOV
        // Its children array contains the Cycle nodes.
        const cycleNodes = versionElement.item.children ?? [];
        return cycleNodes
            .map(
                (
                    cycleNode: TreeNode // cycleNode is a testBenchTypes.TreeNode
                ) => this.createTreeItem(cycleNode, cycleNode.nodeType, versionElement) // cycleNode.nodeType should be "Cycle"
            )
            .filter((item: BaseTestBenchTreeItem | null): item is BaseTestBenchTreeItem => item !== null);
    }

    /**
     * Fetches and returns the root projects for the tree view.
     * @private
     */
    private async getRootProjects(): Promise<BaseTestBenchTreeItem[]> {
        logger.debug("Fetching all projects for the root of Project Management Tree.");
        const projectList: Project[] | null = await connection!.getProjectsList(); // connection is checked before calling this

        if (projectList && projectList.length > 0) {
            return projectList
                .map((project) => this.createTreeItem(project, TreeItemContextValues.PROJECT, null))
                .filter((item): item is BaseTestBenchTreeItem => item !== null);
        } else if (projectList) {
            // Empty list
            logger.debug("No projects found on the server.");
            return [
                new BaseTestBenchTreeItem(
                    "No projects found",
                    "info.noProjects",
                    vscode.TreeItemCollapsibleState.None,
                    {},
                    null
                )
            ];
        } else {
            // Error during fetch
            logger.error("Failed to fetch project list from the server.");
            return [
                new BaseTestBenchTreeItem(
                    "Error fetching projects",
                    "error.fetchProjects",
                    vscode.TreeItemCollapsibleState.None,
                    {},
                    null
                )
            ];
        }
    }

    /**
     * Handles the expansion of a Cycle element.
     * Offloads the actual children to the TestThemeTreeDataProvider.
     * Returns an empty array as Cycle elements do not display children directly in this tree.
     * @param {BaseTestBenchTreeItem} cycleElement The Cycle element.
     * @returns {Promise<BaseTestBenchTreeItem[]>}
     * @private
     */
    private async handleCycleExpansion(cycleElement: BaseTestBenchTreeItem): Promise<BaseTestBenchTreeItem[]> {
        logger.trace(
            `Cycle node ${cycleElement.label} expanded in Project Tree. Offloading children to Test Theme Tree.`
        );
        // Offload children to TestThemeTree
        this.testThemeDataProvider.clearTree(); // Clear previous
        const childrenOfCycle: BaseTestBenchTreeItem[] = await this.getChildrenOfCycle(cycleElement); // Fetches and prepares children for TestThemeTree
        const cycleKey = cycleElement.item?.key;
        if (typeof cycleKey === "string") {
            this.testThemeDataProvider.setRoots(childrenOfCycle, cycleKey);
        } else {
            logger.error(
                `Cycle key not found for element ${cycleElement.label} in getChildren. Clearing test theme tree.`
            );
            this.testThemeDataProvider.clearTree();
        }
        return []; // Return empty as children are in another tree
    }

    /**
     * Gets the children of a given tree item.
     * If no element is provided, it returns the root project.
     * Called when the tree view is first loaded or refreshed.
     *
     * @param {BaseTestBenchTreeItem} element Optional parent tree item.
     * @returns {Promise<BaseTestBenchTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    async getChildren(element?: BaseTestBenchTreeItem): Promise<BaseTestBenchTreeItem[]> {
        if (!connection) {
            // If no connection is available, return a placeholder item.
            return [
                new BaseTestBenchTreeItem(
                    "Not connected to TestBench",
                    "error.notConnected",
                    vscode.TreeItemCollapsibleState.None,
                    {},
                    null
                )
            ];
        }
        try {
            if (!element) {
                // Root level: Fetch and display all projects
                return await this.getRootProjects();
            }

            // Children of a Project item (Test Object Versions)
            if (element.contextValue === TreeItemContextValues.PROJECT) {
                return await this.getChildrenForProject(element);
            }

            // Children of a TOV (Cycles)
            if (element.contextValue === TreeItemContextValues.VERSION) {
                return this.getChildrenForVersion(element);
            }

            // Cycles do not show children directly in this tree: they are offloaded to TestThemeTree
            if (element.contextValue === TreeItemContextValues.CYCLE) {
                return await this.handleCycleExpansion(element);
            }

            // Fallback for unexpected element types or elements with pre-loaded children.
            if (element.children) {
                logger.warn(`Returning pre-loaded children for element: ${element.label}.`);
                return element.children;
            }
        } catch (error) {
            logger.error(`Error in getChildren for element ${element?.label || "root"}:`, error);
            vscode.window.showErrorMessage(
                `Error fetching tree data: ${error instanceof Error ? error.message : "Unknown error"}`
            );
            return [
                new BaseTestBenchTreeItem(
                    "Error loading children",
                    "error.generic",
                    vscode.TreeItemCollapsibleState.None,
                    {},
                    null
                )
            ];
        }

        logger.warn(`getChildren reached end without returning for element: ${element?.label}`);
        return [];
    }

    /**
     * Adds the key of an expanded element to the set used for state preservation.
     * Called by the tree view's onDidExpandElement listener.
     * @param {BaseTestBenchTreeItem} element The element that was expanded.
     */
    public rememberExpandedItem(element: BaseTestBenchTreeItem): void {
        if (element && element.item && element.item.key) {
            this.expandedTreeItems.add(element.item.key);
            logger.trace(`Remembered expanded item: ${element.label} (Key: ${element.item.key})`);
        }
    }

    /**
     * Removes the key of a collapsed element from the set used for state preservation.
     * Called by the tree view's onDidCollapseElement listener.
     * @param {BaseTestBenchTreeItem} element The element that was collapsed.
     */
    public forgetExpandedItem(element: BaseTestBenchTreeItem): void {
        if (element && element.item && element.item.key) {
            this.expandedTreeItems.delete(element.item.key);
            logger.trace(`Forgot expanded item: ${element.label} (Key: ${element.item.key})`);
        }
    }

    /**
     * Predicate function to determine if a raw cycle node should be visible in the Test Theme tree.
     * @param {CycleNodeData} nodeData The raw data for a node from the cycle structure.
     * @returns {boolean} True if the node should be visible, false otherwise.
     * @private
     */
    private isCycleNodeVisibleInTestThemeTree(nodeData: CycleNodeData): boolean {
        // Exclude test cases from the Test Theme tree view
        if (nodeData.elementType === TreeItemContextValues.TEST_CASE_NODE) {
            return false;
        }
        // Filter out non-executable elements and elements that are locked by the system
        if (nodeData.exec?.status === "NotPlanned" || nodeData.exec?.locker === "-2") {
            return false;
        }
        return true;
    }

    /**
     * Fetches the sub-elements of a cycle element and builds the test theme tree.
     *
     * @param {BaseTestBenchTreeItem} cycleElement The cycle tree item.
     * @returns {Promise<BaseTestBenchTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    public async getChildrenOfCycle(cycleElement: BaseTestBenchTreeItem): Promise<BaseTestBenchTreeItem[]> {
        logger.trace("Fetching children of cycle element:", cycleElement.label);

        // Check if the cycleElement is a valid cycle item
        if (cycleElement.contextValue !== TreeItemContextValues.CYCLE) {
            logger.warn(`getChildrenOfCycle called on non-Cycle item: ${cycleElement.label}`);
            return [];
        }

        const cycleKey: string = cycleElement.item?.key;
        if (!cycleKey) {
            logger.error("Cycle key is missing from the provided cycleElement item data.");
            return [];
        }

        const projectKey: string | null = findProjectKeyOfCycleElement(cycleElement);
        if (!projectKey) {
            logger.warn("Project key of cycle not found (getChildrenOfCycle).");
            return [];
        }
        if (!connection) {
            logger.warn("No connection available (getChildrenOfCycle).");
            return [];
        }

        const cycleData: CycleStructure | null = await connection.fetchCycleStructureOfCycleInProject(
            projectKey,
            cycleKey
        );

        // If the cycle has no sub-elements, return a placeholder item.
        if (!cycleData || !cycleData.nodes?.length) {
            logger.trace("Cycle has no sub-elements (getChildrenOfCycle).");
            // vscode.window.showErrorMessage("Failed to fetch data for the selected cycle.");
            return []; // Return empty, which will result in the placeholder in TestThemeTree
        }
        if (!cycleData.nodes || !cycleData.nodes?.length || !cycleData.root?.base?.key) {
            logger.error(`Cycle structure for ${cycleElement.label} has no nodes or root key. Displaying placeholder.`);
            return [];
        }

        // Create a map to store elements by their key. A key identifies an element uniquely.
        const elementsByKey: Map<string, any> = new Map<string, any>();
        cycleData.nodes.forEach((data: any) => {
            const cycleNode: CycleNodeData = data as CycleNodeData; // Cast for type checking
            if (cycleNode?.base?.key) {
                elementsByKey.set(cycleNode.base.key, cycleNode);
            } else {
                logger.warn("Found node without base.key in cycle structure:", cycleNode);
            }
        });

        if (elementsByKey.size === 0 && cycleData.nodes.length > 0) {
            logger.error(`No nodes with base.key were found in the cycle structure data, cannot build tree.`);
            return []; // Cannot proceed if no nodes have keys for lookup
        }

        /**
         * Recursively builds the test theme tree starting from a given parent cycle key.
         * Processes nodes from the cycle structure, filters them using predicates,
         * creates corresponding tree items, and handles hierarchy.
         *
         * @param {string} parentItemKey - The key of the parent element whose children are being built.
         * @param {BaseTestBenchTreeItem} parentTreeItem - The tree item representing the parent.
         * @returns {BaseTestBenchTreeItem[]} An array of tree items representing the children for the Test Theme tree.
         */
        const buildTestThemeTreeRecursive = (
            parentItemKey: string,
            parentTreeItem: BaseTestBenchTreeItem
        ): BaseTestBenchTreeItem[] => {
            // Filter potential children
            // Get all nodes from the map, filter them based on parent key and type first.
            const potentialChildrenData = Array.from(elementsByKey.values()).filter(
                (node) => node?.base?.parentKey === parentItemKey && this.isCycleNodeVisibleInTestThemeTree(node) // Apply visibility filter
            );

            // Map filtered data to Tree Items
            // Process each valid child node data to create a tree item.
            const childTreeItems: (BaseTestBenchTreeItem | null)[] = potentialChildrenData.map((nodeData) => {
                // Determine if this node has its own valid children
                // Check if any node in the original map lists the current node's key as its parent,
                // meets the type criteria, and isn't filtered by status/locker.
                const hasVisibleChildren: boolean = Array.from(elementsByKey.values()).some(
                    (childNode) =>
                        childNode?.base?.parentKey === nodeData.base.key &&
                        this.isCycleNodeVisibleInTestThemeTree(childNode)
                );

                // Create the basic tree item.
                // The contextValue is nodeData.elementType.
                const treeItem: BaseTestBenchTreeItem | null = this.createTreeItem(
                    nodeData, // Pass the full node data, factory will access nodeData.base if needed
                    nodeData.elementType,
                    parentTreeItem
                );

                // If item creation failed, skip further processing
                if (!treeItem) {
                    return null;
                }

                // Store the full original data node onto the item if needed elsewhere
                treeItem.item = nodeData;

                // Determine the collapsible state based on type and whether it has children.
                // TestCaseSetNodes are leaves in test theme tree, they are not expandable.
                // Expandable if it has valid children, not expandable otherwise.
                if (nodeData.elementType === TreeItemContextValues.TEST_CASE_SET_NODE) {
                    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
                } else {
                    // For TestThemeNode primarily
                    treeItem.collapsibleState = hasVisibleChildren
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None;
                }

                // Recursively build children
                // If the current element has children, recursively call this function
                // to build the subtree for the next level.
                if (hasVisibleChildren) {
                    // Pass current treeItem as the new parent, use data.base.key for the next level's parent key
                    treeItem.children = buildTestThemeTreeRecursive(nodeData.base.key, treeItem);
                } else {
                    // Ensure children property is an empty array if no children
                    treeItem.children = [];
                }

                return treeItem; // Return the tree item
            });

            // Remove any null entries that might have resulted from failed item creation.
            return childTreeItems.filter(
                (item: BaseTestBenchTreeItem | null): item is BaseTestBenchTreeItem => item !== null
            );
        };

        const rootCycleKey: string = cycleData.root.base.key;
        // The parent for the first level of TestThemeTree items is the original cycleElement from ProjectManagementTree
        const childrenOfCycle: BaseTestBenchTreeItem[] = buildTestThemeTreeRecursive(rootCycleKey, cycleElement);
        // Assign the built children to the current element
        cycleElement.children = childrenOfCycle;

        // Display the test theme tree view if not already displayed
        await displayTestThemeTreeView();

        // Update the title of the test theme tree view
        if (testThemeTreeView) {
            testThemeTreeView.title = `Test Themes (${cycleElement.label})`;
        }
        return childrenOfCycle;
    }

    /**
     * Returns a TreeItem representation for the given element.
     *
     * @param {BaseTestBenchTreeItem} element The tree item.
     * @returns {vscode.TreeItem} The tree item.
     */
    getTreeItem(element: BaseTestBenchTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Sets the selected tree item as the root and refreshes the tree.
     *
     * @param {BaseTestBenchTreeItem} treeItem The tree item to set as root.
     */
    makeRoot(treeItem: BaseTestBenchTreeItem): void {
        logger.debug("Setting selected element as a temporary root:", treeItem.label);
        this.refresh(); // re-trigger getChildren, which loads all projects.
    }

    /**
     * Handles expansion and collapse of a tree item.
     *
     * @param {BaseTestBenchTreeItem} element The tree item.
     * @param {boolean} expanded True if the item is expanded, false otherwise.
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
     */
    async handleExpansion(element: BaseTestBenchTreeItem, expanded: boolean): Promise<void> {
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
        /*
        // The test Cycles are not expandable anymore, but this code is left to be able to switch back to expandable cycles.
        // If the element is a test cycle, expanding it initializes the test theme tree
        if (expanded) {
            await this.handleTestCycleClick(element);
        }
        */
    }

    /**
     * Handles a click on a test cycle element to initialize the test theme tree and the test elements tree.
     *
     * @param {BaseTestBenchTreeItem} projectsTreeViewItem The clicked tree item in the projects tree view.
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
     */
    async handleTestCycleClick(projectsTreeViewItem: BaseTestBenchTreeItem): Promise<void> {
        logger.trace("Handling tree item click for:", projectsTreeViewItem.label);
        logger.debug("ProjectManagementTreeDataProvider instance in handleTestCycleClick:", this);
        if (projectsTreeViewItem.contextValue !== TreeItemContextValues.CYCLE) {
            logger.error("Clicked tree item is not a cycle. Cannot proceed.");
            return;
        }

        const cycleKey = projectsTreeViewItem.item.key;

        // Skip if already viewing this cycle
        if (this.testThemeDataProvider.isCurrentCycle(cycleKey)) {
            return;
        }

        // Display a progress bar since this operation may take some time.
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Fetching data for cycle: ${projectsTreeViewItem.label}`,
                cancellable: false
            },
            async (progress) => {
                progress.report({ increment: 0, message: "Fetching test themes..." });
                logger.trace("Clicked tree item is a cycle. Creating test theme tree view.");

                // Clear the test theme tree first
                this.testThemeDataProvider.clearTree();
                testElementsTreeDataProvider.refresh([]);

                // Ensure activeProjectKeyInView is set based on the clicked cycle's project.
                const projectKey: string | null = findProjectKeyOfCycleElement(projectsTreeViewItem);
                if (!projectKey) {
                    logger.error("Could not determine project key for the clicked cycle. Aborting further actions.");
                    vscode.window.showErrorMessage("Could not identify the project for the selected cycle.");
                    return;
                }

                // Hide the project management tree view
                await hideProjectManagementTreeView();
                // Display the test theme tree view
                await displayTestThemeTreeView();
                // Display the test elements tree view
                await displayTestElementsTreeView();

                progress.report({ increment: 20, message: "Fetching test themes..." });
                // Fetch new data for the test theme tree
                const childrenForTestThemeTree: BaseTestBenchTreeItem[] =
                    await this.getChildrenOfCycle(projectsTreeViewItem);
                logger.debug("TestThemeTreeDataProvider instance before setRoots:", this.testThemeDataProvider);
                this.testThemeDataProvider.setRoots(childrenForTestThemeTree, cycleKey);

                progress.report({ increment: 60, message: "Fetching test elements..." });
                // If the cycle has a parent of type TOV (Version), fetch and display test elements.
                if (projectsTreeViewItem.parent?.contextValue === TreeItemContextValues.VERSION) {
                    // Check parent context value
                    const tovKeyOfSelectedCycleElement = projectsTreeViewItem.parent?.item?.key; // Get key from parent's item
                    const tovLabel: string | undefined =
                        typeof projectsTreeViewItem.parent?.label === "string"
                            ? projectsTreeViewItem.parent.label
                            : undefined;
                    if (tovKeyOfSelectedCycleElement) {
                        logger.trace(
                            `Clicked cycle item has a parent TOV with key: ${tovKeyOfSelectedCycleElement}. Fetching test elements.`
                        );
                        const areTestElementsFetched: boolean =
                            await testElementsTreeDataProvider.fetchAndDisplayTestElements(
                                tovKeyOfSelectedCycleElement,
                                tovLabel
                            );
                        if (!areTestElementsFetched) {
                            clearTestElementsTreeView();
                        }
                    } else {
                        logger.warn("Parent TOV key not found for the clicked cycle.");
                    }
                } else {
                    logger.trace(
                        "Clicked cycle item does not have a direct TOV parent or parent information is missing."
                    );
                    clearTestElementsTreeView();
                }
                progress.report({ increment: 100, message: "Data loaded." });
            }
        );
    }

    /**
     * Clears the project management tree.
     */
    public clearTree(): void {
        logger.trace("Clearing project management tree.");
        if (this.testThemeDataProvider) {
            this.testThemeDataProvider.clearTree();
        }
        this.refresh();
    }
}

/**
 * Finds the project key (serial) for a given cycle element by traversing upward in the tree hierarchy.
 *
 * @param {BaseTestBenchTreeItem} element The cycle tree item.
 * @returns {string | null} The project key as a string if found; otherwise null.
 */
export function findProjectKeyOfCycleElement(element: BaseTestBenchTreeItem): string | null {
    logger.trace("Finding project key for cycle element:", element.label);
    if (element.contextValue !== TreeItemContextValues.CYCLE) {
        logger.error("Element is not a cycle; cannot find project key.");
        return null;
    }
    let current: BaseTestBenchTreeItem | null = element;
    while (current) {
        if (current.contextValue === TreeItemContextValues.PROJECT) {
            logger.trace("Found project key for cycle element:", current.item.key);
            return current.item.key;
        }
        current = current.parent;
    }
    const projectKeyNotFoundErrorMessage: string = `Project key not found for cycle element: ${element.label}`;
    logger.error(projectKeyNotFoundErrorMessage);
    vscode.window.showErrorMessage(projectKeyNotFoundErrorMessage);
    return null;
}

/**
 * Finds the project key (serial) for a given project tree item by traversing upward in the tree hierarchy.
 * The input element can be of type Project, Version, Cycle, TestThemeNode, TestCaseSetNode, or TestCaseNode.
 *
 * @param {BaseTestBenchTreeItem} element The project tree item.
 * @returns {string | null} The project key as a string if found; otherwise null.
 */
export function findProjectKeyOfProjectTreeItem(element: BaseTestBenchTreeItem): string | null {
    logger.trace("Finding project key for project tree item:", element.label);
    let current: BaseTestBenchTreeItem | null = element;
    while (current) {
        if (current.contextValue === TreeItemContextValues.PROJECT) {
            logger.trace("Found project key:", current.item.key);
            return current.item.key;
        }
        current = current.parent;
    }
    const projectKeyNotFoundErrorMessage: string = `Project key not found traversing up from tree element: ${element.label}`;
    logger.error(projectKeyNotFoundErrorMessage);
    return null;
}

/**
 * Finds the cycle key (serial) for a given tree element by traversing upward in the tree hierarchy.
 *
 * @param {BaseTestBenchTreeItem} element The tree item.
 * @returns {string | null} The cycle key as a string if found; otherwise null.
 */
export function findCycleKeyOfTreeElement(element: BaseTestBenchTreeItem): string | null {
    logger.trace("Finding cycle key for tree element:", element.label);
    let current: BaseTestBenchTreeItem | null = element;
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
export class BaseTestBenchTreeItem extends vscode.TreeItem {
    public parent: BaseTestBenchTreeItem | null;
    public children?: BaseTestBenchTreeItem[];
    public statusOfTreeItem: string;

    /**
     * Constructs a new TestbenchTreeItem.
     *
     * @param {string} label The label to display.
     * @param {string} contextValue The type of the tree item.
     * @param {vscode.TreeItemCollapsibleState} collapsibleState The initial collapsible state.
     * @param {any} item The original data of the tree item.
     * @param {BaseTestBenchTreeItem | null} parent The parent tree item.
     */
    constructor(
        label: string,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public item: any,
        parent: BaseTestBenchTreeItem | null = null
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this.parent = parent;
        this.statusOfTreeItem = item.exec?.status || item.status || "None"; // Possible values: Active, Planned, Finished, Closed, etc.

        // item.base is specific to CycleStructure nodes (TestThemes, TestCaseSets)
        const itemDataForTooltip = item?.base || item;

        // Set the tooltip based on the context value.
        // Tooltip for project, TOV and cycle elements looks like this: Type, Name, Status, Key
        if (
            contextValue === TreeItemContextValues.PROJECT ||
            contextValue === TreeItemContextValues.VERSION ||
            contextValue === TreeItemContextValues.CYCLE
        ) {
            this.tooltip = `Type: ${contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nKey: ${itemDataForTooltip.key}`;
            // For a project, add TOVs and cycles count to the tooltip.
            if (contextValue === TreeItemContextValues.PROJECT && item) {
                this.tooltip += `\nTOVs: ${item.tovsCount || 0}\nCycles: ${item.cyclesCount || 0}`;
            }
        }
        // Tooltip for test theme, test case set and test case looks like this: Numbering, Type, Name, Status, ID
        else if (
            contextValue === TreeItemContextValues.TEST_THEME_NODE ||
            contextValue === TreeItemContextValues.TEST_CASE_SET_NODE ||
            contextValue === TreeItemContextValues.TEST_CASE_NODE
        ) {
            if (itemDataForTooltip?.numbering) {
                this.tooltip = `Numbering: ${itemDataForTooltip.numbering}\nType: ${itemDataForTooltip.elementType || contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nID: ${itemDataForTooltip.uniqueID}`;
            } else {
                this.tooltip = `Type: ${itemDataForTooltip.elementType || contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nID: ${itemDataForTooltip.uniqueID}`;
            }
            // Display the uniqueID as a description next to the label.
            this.description = itemDataForTooltip?.uniqueID || "";
        }

        // Set the command to be executed when the tree item is clicked.
        // Without this command, an already clicked cycle item is not clickable again.
        if (contextValue === TreeItemContextValues.CYCLE) {
            this.command = {
                command: allExtensionCommands.handleProjectCycleClick,
                title: "Show Test Themes",
                arguments: [this]
            };
        }

        // Set the icon path based on the context value and status.
        this.updateIcon();
    }

    /**
     * Determines the icon path for the tree item based on its type and status.
     * Currently this is not used fully, but it allows to have different icons for different statuses of the tree items like the TestBench Client.
     *
     * @returns The absolute icon path to the icon file.
     */
    private getIconPath(): { light: string; dark: string } {
        const iconFolderPath: string = path.join(__dirname, "..", "resources", "icons");
        const status = this.item?.status || "default"; // (Active, Planned, Finished, Closed etc.)
        const type: string | undefined = this.contextValue; // (Project, TOV, Cycle etc.)
        // Map the context and status to the corresponding icon file name
        const iconMap: Record<string, Record<string, { light: string; dark: string }>> = {
            [TreeItemContextValues.PROJECT]: {
                active: { light: "project-light.svg", dark: "project-dark.svg" },
                planned: { light: "project-light.svg", dark: "project-dark.svg" },
                finished: { light: "project-light.svg", dark: "project-dark.svg" },
                closed: { light: "project-light.svg", dark: "project-dark.svg" },
                default: { light: "project-light.svg", dark: "project-dark.svg" }
            },
            [TreeItemContextValues.VERSION]: {
                active: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                planned: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                finished: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                closed: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                default: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" }
            },
            [TreeItemContextValues.CYCLE]: {
                active: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                planned: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                finished: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                closed: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                default: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" }
            },
            [TreeItemContextValues.TEST_THEME_NODE]: {
                default: { light: "TestThemeOriginal-light.svg", dark: "TestThemeOriginal-dark.svg" }
            },
            [TreeItemContextValues.TEST_CASE_SET_NODE]: {
                default: { light: "TestCaseSetOriginal-light.svg", dark: "TestCaseSetOriginal-dark.svg" }
            },
            [TreeItemContextValues.TEST_CASE_NODE]: {
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
 * Initializes the project management tree view.
 * This function creates a new tree view for project management and sets its data provider.
 * @param {TestThemeTreeDataProvider} testThemeDataProvider The test theme tree data provider.
 * @returns {ProjectManagementTreeDataProvider} The initialized project management tree data provider.
 */
function createProjectDataProviderAndView(
    testThemeDataProvider?: TestThemeTreeDataProvider
): ProjectManagementTreeDataProvider {
    logger.debug("Initializing project management tree view.");
    const provider: ProjectManagementTreeDataProvider = new ProjectManagementTreeDataProvider(testThemeDataProvider);
    setProjectManagementTreeDataProvider(provider);
    const newProjectTreeView: vscode.TreeView<BaseTestBenchTreeItem> = vscode.window.createTreeView(
        "projectManagementTree",
        {
            // View ID from package.json
            treeDataProvider: provider,
            canSelectMany: false
        }
    );
    setProjectTreeView(newProjectTreeView);
    return provider;
}

/**
 * Sets up event listeners for the project tree view to handle expand/collapse and selection events.
 * These events update the expansion state, icons dynamically, and initialize the test theme tree on cycle click.
 */
function setupProjectTreeViewEventListeners(): void {
    if (!projectTreeView) {
        logger.error("Project tree view (projectTreeView) is not initialized. Cannot set up event listeners.");
        return;
    }

    // Handle expand events to update expansion state and icons dynamically.
    projectTreeView.onDidExpandElement(async (event) => {
        if (projectManagementTreeDataProvider) {
            await projectManagementTreeDataProvider.handleExpansion(event.element, true);
        }
    });

    // Handle collapse events to update expansion state and icons dynamically.
    projectTreeView.onDidCollapseElement(async (event) => {
        if (projectManagementTreeDataProvider) {
            await projectManagementTreeDataProvider.handleExpansion(event.element, false);
        }
    });

    // Handle selection changes (initial click events) to trigger test theme tree initialization on cycle click.
    // Note: Clicking on an already clicked cycle item does not trigger this onDidChangeSelection, another command is used to handle this.
    projectTreeView.onDidChangeSelection(async (event) => {
        if (event.selection.length > 0) {
            const selectedElement: BaseTestBenchTreeItem = event.selection[0];
            logger.trace(
                `Selection changed in Project Tree: ${selectedElement.label}, context: ${selectedElement.contextValue}`
            );

            // TODO: Remove?
            if (selectedElement && selectedElement.contextValue === TreeItemContextValues.CYCLE) {
                // Trigger loading data into TestThemeTree and TestElementsTree
                if (projectManagementTreeDataProvider) {
                    // await projectManagementTreeDataProvider.handleTestCycleClick(selectedElement);
                } else {
                    logger.error("projectManagementTreeDataProvider is null, cannot handle test cycle click.");
                }
            }
        }
    });
}

/**
 * Initializes or updates the project management tree view and test theme tree view and set the global references.
 * This function ensures that tree views and data providers are created only once during extension activation.
 * Subsequent calls update the existing instances and their internal references.
 * @param {vscode.ExtensionContext} context The VS Code extension context.
 * @returns {Promise<void>} A promise that resolves when the trees are initialized or updated.
 */
export async function initializeProjectAndTestThemeTrees(context: vscode.ExtensionContext): Promise<void> {
    logger.debug("Initializing project and test theme trees (multi-project mode).");

    // Always create fresh providers to ensure clean state
    const testThemeDataProvider = new TestThemeTreeDataProvider();
    setTestThemeTreeView(
        vscode.window.createTreeView("testThemeTree", {
            treeDataProvider: testThemeDataProvider
        })
    );

    const projectProvider = new ProjectManagementTreeDataProvider(testThemeDataProvider);
    setProjectManagementTreeDataProvider(projectProvider);

    // Clear any existing state
    testThemeDataProvider.clearTree();
    projectProvider.clearTree();

    // Setup the test theme tree view first, its provider is needed by ProjectManagementTreeDataProvider
    // const testThemeDataProvider: TestThemeTreeDataProvider = initializeTestThemeTreeView();
    if (!testThemeTreeView) {
        logger.error("Failed to create test theme tree view instance.");
        return;
    }
    if (testThemeDataProvider && projectManagementTreeDataProvider) {
        projectManagementTreeDataProvider.setTestThemeDataProvider(testThemeDataProvider);
    } else if (testThemeDataProvider && !projectManagementTreeDataProvider) {
        // initializing for the first time
    } else {
        logger.error("Failed to initialize testThemeDataProvider or projectManagementDataProvider not yet ready.");
    }

    // Setup the project management tree view.
    createProjectDataProviderAndView(testThemeDataProvider);
    setupProjectTreeViewEventListeners();

    if (!projectManagementTreeDataProvider) {
        logger.error("Failed to create project management tree data provider.");
        return;
    }

    if (projectTreeView) {
        context.subscriptions.push(projectTreeView);
    } else {
        logger.error("Project Tree View (projectTreeView) was not created successfully.");
    }

    // Initialize Test Theme Tree
    if (projectManagementTreeDataProvider && testThemeDataProvider) {
        projectManagementTreeDataProvider.setTestThemeDataProvider(testThemeDataProvider);
        projectManagementTreeDataProvider.testThemeDataProvider.refresh();
    }
    if (testThemeTreeView) {
        context.subscriptions.push(testThemeTreeView);
    }

    // Display the project management tree view if not displayed already
    // Triggers getChildren() for the root, loads all projects.
    await vscode.commands.executeCommand("projectManagementTree.focus");
    logger.info("Project and Test Theme trees initialized for multi-project display.");
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

/**
 * Finds the project key (serial) for a given tree element by traversing upward in the tree hierarchy.
 *
 * @param {BaseTestBenchTreeItem} element The tree item.
 * @returns {string | null} The project key as a string if found; otherwise null.
 */
export function findProjectKeyForElement(element: BaseTestBenchTreeItem): string | null {
    logger.trace("Finding project key for element:", element.label);
    let current: BaseTestBenchTreeItem | null = element;
    while (current) {
        if (current.contextValue === TreeItemContextValues.PROJECT) {
            logger.trace("Found project key for element:", current.item.key);
            return current.item.key;
        }
        current = current.parent;
    }
    const projectKeyNotFoundErrorMessage: string = `Project key not found traversing up from tree element: ${element.label}`;
    logger.error(projectKeyNotFoundErrorMessage);
    return null;
}
