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
import {
    connection,
    logger,
    getProjectTreeView,
    getTestElementTreeView,
    getTestThemeTreeViewInstance,
    getTestElementsTreeDataProvider
} from "./extension";
import { allExtensionCommands, TreeItemContextValues } from "./constants";
import { displayTestThemeTreeView, TestThemeTreeDataProvider } from "./testThemeTreeView";
import { displayTestElementsTreeView } from "./testElementsTreeView";

// Event payload
export interface CycleDataForThemeTreeEvent {
    projectKey: string;
    cycleKey: string;
    cycleLabel: string;
    rawCycleStructure: CycleStructure | null;
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

    private _onDidPrepareCycleDataForThemeTree: vscode.EventEmitter<CycleDataForThemeTreeEvent> =
        new vscode.EventEmitter<CycleDataForThemeTreeEvent>();
    public readonly onDidPrepareCycleDataForThemeTree: vscode.Event<CycleDataForThemeTreeEvent> =
        this._onDidPrepareCycleDataForThemeTree.event;

    // Callback for message updates
    private updateMessageCallback: (message: string | undefined) => void;
    // Injected TestThemeTreeDataProvider
    private testThemeTreeDataProvider: TestThemeTreeDataProvider | null;

    // Custom root
    private customRootKey: string | null = null;
    private customRootContextValue: string | null = null;
    private customRootJsonData: any | null = null;

    // Store keys of expanded nodes to restore expansion state of collapsible elements after a refresh.
    private expandedTreeItems: Set<string> = new Set<string>();

    /**
     * Constructs a new ProjectManagementTreeDataProvider.
     * @param {function} updateMessageCallback Callback to update the message in the tree view.
     * @param {TestThemeTreeDataProvider} testThemeTreeDataProviderInstance Instance of the TestThemeTreeDataProvider.
     */
    constructor(
        updateMessageCallback: (message: string | undefined) => void,
        testThemeTreeDataProviderInstance: TestThemeTreeDataProvider | null
    ) {
        this.updateMessageCallback = updateMessageCallback;
        this.testThemeTreeDataProvider = testThemeTreeDataProviderInstance;
        logger.trace("ProjectManagementTreeDataProvider initialized.");
    }

    /**
     * Refreshes the tree view.
     * If isHardRefresh is true, it resets the custom root item.
     * @param {boolean} isHardRefresh Optional flag to force a hard refresh.
     */
    refresh(isHardRefresh: boolean = false): void {
        logger.debug("Refreshing project management tree view.");
        if (isHardRefresh) {
            this.customRootKey = null;
            this.customRootContextValue = null;
            this.customRootJsonData = null;
            this.expandedTreeItems.clear();
            logger.trace("Hard refresh: Custom root has been reset.");
        }
        const currentProjectTreeView = getProjectTreeView();
        if (!connection) {
            this.updateMessageCallback("Not connected to TestBench. Please log in.");
        } else if (currentProjectTreeView && this.customRootKey && this.customRootJsonData) {
            const tempLabel = this.customRootJsonData?.name || this.customRootKey;
            this.updateMessageCallback(`Displaying custom root: ${tempLabel}`);
        } else {
            // Default state before fetching root projects
            this.updateMessageCallback("Loading projects..."); // Temporary loading message
        }

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

    /**
     * Fetches the raw json data for a specific test cycle from the server.
     *
     * @param {BaseTestBenchTreeItem} cycleElement The tree item representing the cycle.
     * @returns {Promise<CycleStructure | null>} A promise that resolves to a `CycleStructure` object or `null` if an error occurs.
     */
    public async getCycleJSONData(cycleElement: BaseTestBenchTreeItem): Promise<CycleStructure | null> {
        const cycleElementLabel: string = typeof cycleElement.label === "string" ? cycleElement.label : "N/A";
        logger.trace("Fetching raw cycle data for element:", cycleElementLabel);
        if (cycleElement.contextValue !== TreeItemContextValues.CYCLE) {
            logger.warn(`getRawCycleData called on non-Cycle item: ${cycleElementLabel}`);
            return null;
        }

        const cycleKey: string = cycleElement.item?.key;
        if (!cycleKey) {
            logger.error("Cycle key is missing from the provided cycleElement item data.");
            return null;
        }

        const projectKey: string | null = findProjectKeyOfCycleElement(cycleElement);
        if (!projectKey) {
            logger.warn("Project key of cycle not found (getRawCycleData).");
            return null;
        }
        if (!connection) {
            logger.warn("No connection available (getRawCycleData).");
            return null;
        }

        const cycleData: CycleStructure | null = await connection.fetchCycleStructureOfCycleInProject(
            projectKey,
            cycleKey
        );

        if (!cycleData) {
            logger.trace("No cycle structure data returned from server (getRawCycleData).");
            return null;
        }
        // Validate fetched data
        if (!cycleData.nodes || !cycleData.root?.base?.key) {
            logger.error(`Workspaceed cycle structure for ${cycleElementLabel} is missing nodes or root key.`);
            return null;
        }
        return cycleData;
    }

    /**
     * Creates a TestbenchTreeItem from raw JSON data.
     * Handles expansion state restoration for collapsible items.
     *
     * @param {any} jsonData The raw JSON data.
     * @param {string} contextValue An explicit context value if jsonData.nodeType is not reliable.
     * @param {BaseTestBenchTreeItem | null} parent The parent tree item.
     * @returns {BaseTestBenchTreeItem | null} A new TestbenchTreeItem or null.
     */
    private createTreeItem(
        jsonData: any,
        contextValue: string,
        parent: BaseTestBenchTreeItem | null
    ): BaseTestBenchTreeItem | null {
        if (!jsonData) {
            logger.warn("Attempted to create tree item with invalid jsonData (null or undefined).");
            return null;
        }

        const itemData: any = jsonData;
        let defaultCollapsibleState: vscode.TreeItemCollapsibleState;

        // Normalize data extraction
        if (!itemData || typeof itemData.key === "undefined" || typeof itemData.name === "undefined") {
            logger.warn(
                `Attempted to create project/version/cycle tree item with invalid data structure for context ${contextValue}:`,
                jsonData
            );
            return null;
        }
        const itemKey: string | undefined = itemData.key;
        const itemName: string | undefined = itemData.name;
        const label: string = itemName!;

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
                defaultCollapsibleState = vscode.TreeItemCollapsibleState.None; // Cycles in this tree are not directly expandable to show themes
                break;
            default:
                logger.warn(
                    `Unexpected contextValue '${contextValue}' in ProjectManagementTreeDataProvider.createTreeItem`
                );
                defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
        }

        const treeItem: BaseTestBenchTreeItem = new BaseTestBenchTreeItem(
            label,
            contextValue,
            defaultCollapsibleState,
            itemData,
            parent
        );

        // Restore Expansion State
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
        logger.debug(`Fetching children (TOVs) for project: ${projectElement.label}`);
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
        logger.debug(`Fetching children (Cycles) for TOV: ${versionElement.label}`);
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
     * This is called when no custom root is set and the tree should display all projects.
     * @private
     */
    private async getRootProjects(): Promise<BaseTestBenchTreeItem[]> {
        logger.debug("Fetching all projects for the root of Project Management Tree.");
        const projectList: Project[] | null = await connection!.getProjectsList(); // connection is checked before calling this

        if (projectList && projectList.length > 0) {
            // Clear message if projects found
            this.updateMessageCallback(undefined);
            return projectList
                .map((project) => this.createTreeItem(project, TreeItemContextValues.PROJECT, null))
                .filter((item): item is BaseTestBenchTreeItem => item !== null);
        } else if (projectList) {
            // Empty list
            logger.debug("No projects found on the server.");
            this.updateMessageCallback(
                "No projects found on the server. Create a project in TestBench or check permissions."
            );
            return [];
        } else {
            // Error during fetch
            logger.error("Failed to fetch project list from the server.");
            this.updateMessageCallback("Error fetching projects. Please check connection or try refreshing.");
            vscode.window.showErrorMessage("Failed to fetch project list from TestBench. Check logs for details.");
            return [];
        }
    }

    /**
     * Handles the expansion of a Cycle element.
     * For the project management tree, cycles do not directly show children here.
     * The actual children (test themes, etc.) are intended for the TestThemeTree.
     * This method could be simplified or removed if cycle expansion in this tree
     * should not trigger data loading for another tree directly.
     * @param {BaseTestBenchTreeItem} cycleElement The Cycle element.
     * @returns {Promise<BaseTestBenchTreeItem[]>}
     * @private
     */
    private async handleCycleExpansion(cycleElement: BaseTestBenchTreeItem): Promise<BaseTestBenchTreeItem[]> {
        logger.trace(
            `Cycle node ${typeof cycleElement.label === "string" ? cycleElement.label : "N/A"} expanded in Project Tree.`
        );
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
            // Handle "Not Connected" state with message
            this.updateMessageCallback("Not connected to TestBench. Please log in.");
            return [];
        }
        try {
            if (!element) {
                // Root level: Fetch and display all projects
                if (this.customRootKey && this.customRootContextValue && this.customRootJsonData) {
                    this.updateMessageCallback(undefined); // Clear message for custom root
                    // Reconstruct the custom root item to be displayed
                    const rootItem = this.createTreeItem(
                        this.customRootJsonData,
                        this.customRootContextValue,
                        null // Parent is null for root
                    );
                    if (rootItem) {
                        if (rootItem.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                            rootItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                        }
                        return [rootItem];
                    } else {
                        // Failed to recreate custom root, clear it and fall back to all projects
                        logger.error(
                            `Failed to recreate custom root for key ${this.customRootKey}. Clearing custom root.`
                        );
                        this.customRootKey = null;
                        this.customRootContextValue = null;
                        this.customRootJsonData = null;
                        return await this.getRootProjects();
                    }
                }
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
            this.updateMessageCallback("An error occurred while loading tree items.");
            return [];
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
        const cycleElementLabel: string = typeof cycleElement.label === "string" ? cycleElement.label : "N/A";
        logger.trace("Fetching children of cycle element:", cycleElementLabel);
        if (cycleElement.contextValue !== TreeItemContextValues.CYCLE) {
            logger.warn(`getChildrenOfCycle called on non-Cycle item: ${cycleElementLabel}`);
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

        if (!cycleData || !cycleData.nodes?.length) {
            logger.trace("Cycle has no sub-elements (getChildrenOfCycle).");
            return [];
        }
        if (!cycleData.nodes || !cycleData.nodes?.length || !cycleData.root?.base?.key) {
            logger.error(`Cycle structure for ${cycleElementLabel} has no nodes or root key. Displaying placeholder.`);
            return [];
        }

        const elementsByKey: Map<string, any> = new Map<string, any>();
        cycleData.nodes.forEach((data: any) => {
            const cycleNode: CycleNodeData = data as CycleNodeData;
            if (cycleNode?.base?.key) {
                elementsByKey.set(cycleNode.base.key, cycleNode);
            } else {
                logger.warn("Found node without base.key in cycle structure:", cycleNode);
            }
        });
        if (elementsByKey.size === 0 && cycleData.nodes.length > 0) {
            logger.error(`No nodes with base.key were found in the cycle structure data, cannot build tree.`);
            return [];
        }

        const buildTestThemeTreeRecursive = (
            parentItemKey: string,
            parentTreeItem: BaseTestBenchTreeItem
        ): BaseTestBenchTreeItem[] => {
            const potentialChildrenData = Array.from(elementsByKey.values()).filter(
                (node) => node?.base?.parentKey === parentItemKey && this.isCycleNodeVisibleInTestThemeTree(node)
            );
            const childTreeItems: (BaseTestBenchTreeItem | null)[] = potentialChildrenData.map((nodeData) => {
                // Determine if this nodeData itself will have children in the theme tree
                const hasVisibleChildren: boolean = Array.from(elementsByKey.values()).some(
                    (childNodeCandidate) =>
                        childNodeCandidate?.base?.parentKey === nodeData.base.key &&
                        this.isCycleNodeVisibleInTestThemeTree(childNodeCandidate)
                );

                const treeItem: BaseTestBenchTreeItem | null = this.createTreeItem(
                    nodeData,
                    nodeData.elementType,
                    parentTreeItem
                );
                if (!treeItem) {
                    return null;
                }
                treeItem.item = nodeData;
                if (nodeData.elementType === TreeItemContextValues.TEST_CASE_SET_NODE) {
                    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
                } else {
                    treeItem.collapsibleState = hasVisibleChildren
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None;
                }

                /*
                // Restore expansion if it was previously expanded (createTreeItem already does this)
                const itemKeyForExpansion = treeItem.item?.base?.key || treeItem.item?.key; // CycleStructure items have key in base
                if (
                    itemKeyForExpansion &&
                    this.expandedTreeItems.has(itemKeyForExpansion) &&
                    treeItem.collapsibleState !== vscode.TreeItemCollapsibleState.None
                ) {
                    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                }
                */

                if (hasVisibleChildren) {
                    treeItem.children = buildTestThemeTreeRecursive(nodeData.base.key, treeItem);
                } else {
                    treeItem.children = [];
                }
                return treeItem;
            });
            return childTreeItems.filter(
                (item: BaseTestBenchTreeItem | null): item is BaseTestBenchTreeItem => item !== null
            );
        };

        const rootCycleKey: string = cycleData.root.base.key;
        const childrenOfCycleToReturn: BaseTestBenchTreeItem[] = buildTestThemeTreeRecursive(
            rootCycleKey,
            cycleElement
        );
        // cycleElement.children = childrenOfCycleToReturn; // Do NOT assign here if this is for another tree.
        // The project tree item itself does not have these as direct children.
        return childrenOfCycleToReturn;
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
        if (treeItem && treeItem.item && treeItem.item.key && treeItem.contextValue) {
            // Store the necessary information to reconstruct or fetch
            this.customRootKey = treeItem.item.key;
            this.customRootContextValue = treeItem.contextValue;
            // Store a copy of the item's data.
            this.customRootJsonData = { ...treeItem.item }; // Shallow copy
            logger.debug(
                `Item "${typeof treeItem.label === "string" ? treeItem.label : treeItem.item.name}" (Key: ${this.customRootKey}) is now set as custom root.`
            );
        } else {
            this.customRootKey = null;
            this.customRootContextValue = null;
            this.customRootJsonData = null;
            logger.debug("Custom root cleared.");
        }
        this._onDidChangeTreeData.fire(undefined); // Refresh the tree to show the new root or all projects
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
     * Handles a click on a test cycle element.
     * Prepares data for the Test Theme tree and fires an event,
     * and handles Test Elements tree population.
     *
     * @param {BaseTestBenchTreeItem} projectsTreeViewItem The clicked tree item in the projects tree view.
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
     */
    public async handleTestCycleClick(projectsTreeViewItem: BaseTestBenchTreeItem): Promise<void> {
        const currentCycleLabel: string =
            typeof projectsTreeViewItem.label === "string" ? projectsTreeViewItem.label : "N/A";
        logger.trace("Handling tree item click for:", currentCycleLabel);

        if (projectsTreeViewItem.contextValue !== TreeItemContextValues.CYCLE) {
            logger.error("Clicked tree item is not a cycle. Cannot proceed.");
            return;
        }

        const cycleKey = projectsTreeViewItem.item.key;
        if (!cycleKey) {
            logger.error("Cycle key is missing from clicked item. Cannot proceed.");
            return;
        }

        const projectKey: string | null = findProjectKeyOfCycleElement(projectsTreeViewItem);
        if (!projectKey) {
            logger.error("Project key is missing from clicked item. Cannot proceed.");
            return;
        }

        const currentThemeTreeView = getTestThemeTreeViewInstance();
        const currentElementTreeView = getTestElementTreeView();
        const currentElementsProvider = getTestElementsTreeDataProvider();

        // Set loading message for Test Themes before fetching cycle children
        if (currentThemeTreeView && this.testThemeTreeDataProvider) {
            // Check injected provider
            // Message update on theme tree view is handled by its own provider via callback
            this.testThemeTreeDataProvider.setMessage(`Loading test themes for cycle: ${currentCycleLabel}...`);
        }
        // Test Elements message
        if (currentElementTreeView && currentElementsProvider) {
            const tovParent = projectsTreeViewItem.parent;
            const tovLabel: string =
                tovParent && typeof tovParent.label === "string" ? tovParent.label : "selected TOV";
            currentElementsProvider.setMessage(`Loading test elements for ${tovLabel}...`);
            currentElementsProvider.refresh([]);
        }

        // Hide the project management tree view and show the test theme tree and test elements tree views
        // before fetching data for responsiveness
        await hideProjectManagementTreeView();
        await displayTestThemeTreeView();
        if (getTestElementsTreeDataProvider()) {
            await displayTestElementsTreeView();
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Fetching data for cycle: ${currentCycleLabel}`,
                cancellable: false
            },
            async (progress) => {
                progress.report({ increment: 0, message: "Fetching test themes..." });

                // Fetch raw cycle data
                const rawCycleData: CycleStructure | null = await this.getCycleJSONData(projectsTreeViewItem);

                progress.report({ increment: 40, message: "Preparing views..." });

                // Fire the event with the raw data
                this._onDidPrepareCycleDataForThemeTree.fire({
                    projectKey: projectKey,
                    cycleKey: cycleKey,
                    cycleLabel: currentCycleLabel,
                    rawCycleStructure: rawCycleData
                });

                // Test Elements Tree Logic
                progress.report({ increment: 60, message: "Fetching test elements..." });
                if (projectsTreeViewItem.parent?.contextValue === TreeItemContextValues.VERSION) {
                    const tovKeyOfSelectedCycleElement = projectsTreeViewItem.parent?.item?.key;
                    const tovLabel: string | undefined =
                        typeof projectsTreeViewItem.parent?.label === "string"
                            ? projectsTreeViewItem.parent.label
                            : undefined;

                    if (tovKeyOfSelectedCycleElement) {
                        logger.trace(
                            `Clicked cycle item has a parent TOV with key: ${tovKeyOfSelectedCycleElement}. Fetching test elements.`
                        );
                        if (currentElementsProvider) {
                            const areTestElementsFetched: boolean = await currentElementsProvider.fetchTestElements(
                                tovKeyOfSelectedCycleElement,
                                tovLabel
                            );
                            if (!areTestElementsFetched) {
                                const teProvider = getTestElementsTreeDataProvider();
                                teProvider?.refresh([]);
                            }
                        } else {
                            logger.error("testElementsTreeDataProvider is not available.");
                        }
                    } else {
                        logger.warn("Parent TOV key not found for the clicked cycle.");
                        const teProvider = getTestElementsTreeDataProvider();
                        teProvider?.refresh([]); // Clear if context is lost
                    }
                } else {
                    logger.trace(
                        "Clicked cycle item does not have a direct TOV parent or parent information is missing."
                    );
                    const teProvider = getTestElementsTreeDataProvider();
                    teProvider?.refresh([]);
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
        this.customRootKey = null;
        this.customRootContextValue = null;
        this.customRootJsonData = null;
        this.expandedTreeItems.clear();
        this.updateMessageCallback("Select a project to see its contents or refresh.");
        this._onDidChangeTreeData.fire(undefined);
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
 * Sets up event listeners for the project tree view to handle expand/collapse and selection events.
 * These events update the expansion state, icons dynamically, and initialize the test theme tree on cycle click.
 * @param {vscode.TreeView<BaseTestBenchTreeItem>} projectTreeView The project tree view instance.
 * @param {ProjectManagementTreeDataProvider} projectManagementProvider The project management data provider instance.
 */
export function setupProjectTreeViewEventListeners(
    projectTreeView: vscode.TreeView<BaseTestBenchTreeItem>,
    projectManagementProvider: ProjectManagementTreeDataProvider
): void {
    if (!projectTreeView) {
        logger.error("Project tree view (projectTreeView) is not initialized. Cannot set up event listeners.");
        return;
    }
    if (!projectManagementProvider) {
        logger.error("Project management data provider is not initialized. Cannot set up event listeners.");
        return;
    }

    projectTreeView.onDidExpandElement(async (event) => {
        await projectManagementProvider.handleExpansion(event.element, true);
        projectManagementProvider.rememberExpandedItem(event.element);
        // If cycle expansion in project tree should also trigger theme tree population
        // (independent of the click command), then handleTestCycleClick could be called here too,
        // which would then fire the event.
        /*
        if (event.element.contextValue === TreeItemContextValues.CYCLE) {
            await projectManagementProvider.handleTestCycleClick(event.element);
         }*/
    });
    projectTreeView.onDidCollapseElement(async (event) => {
        await projectManagementProvider.handleExpansion(event.element, false);
        projectManagementProvider.forgetExpandedItem(event.element);
    });

    // React to selection changes in the project tree view
    projectTreeView.onDidChangeSelection(async (event) => {
        if (event.selection.length > 0) {
            const selectedElement: BaseTestBenchTreeItem = event.selection[0];
            logger.trace(
                `Selection changed in Project Tree: ${typeof selectedElement.label === "string" ? selectedElement.label : "N/A"}, context: ${selectedElement.contextValue}`
            );
            /* Do not handle click events here, as they are handled by the command in the tree item.
            if (selectedElement && selectedElement.contextValue === TreeItemContextValues.CYCLE) {
                await providerInstance.handleTestCycleClick(selectedElement);
            }*/

            const projectAndTovNameObj = getProjectAndTovNamesFromSelection(selectedElement);

            if (projectAndTovNameObj) {
                const { projectName, tovName } = projectAndTovNameObj;
                logger.trace(`Selected Project: ${projectName}, TOV: ${tovName}`);
                // TODO: Restart language server with the selected project and TOV
            } else {
                logger.warn("Could not determine context for LS restart from selection.");
                // TODO: Maybe stop language server if no valid context is selected
            }
        }
    });
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

/**
 * Determines the project name and TOV name based on the selected TreeItem.
 * @param {BaseTestBenchTreeItem} selectedItem The selected BaseTestBenchTreeItem.
 * @returns {{ projectName: string | undefined; tovName: string | undefined }} An object with projectName and tovName, or null if not determinable.
 */
export function getProjectAndTovNamesFromSelection(
    selectedItem: BaseTestBenchTreeItem
): { projectName: string | undefined; tovName: string | undefined } | null {
    if (!selectedItem || !selectedItem.item) {
        return null;
    }

    let projectName: string | undefined;
    let tovName: string | undefined;

    let currentItem: BaseTestBenchTreeItem | null = selectedItem;

    // Iterate upwards in the tree to find Project and TOV
    while (currentItem) {
        if (currentItem.contextValue === TreeItemContextValues.PROJECT) {
            projectName = currentItem.item.name;
        } else if (currentItem.contextValue === TreeItemContextValues.VERSION) {
            tovName = currentItem.item.name;
            // If we found the TOV, its parent must be the project
            if (currentItem.parent && currentItem.parent.contextValue === TreeItemContextValues.PROJECT) {
                projectName = currentItem.parent.item.name;
            }
        }
        // If both project and TOV are found (or project, if TOV was the root element of selection)
        if (projectName && (tovName || selectedItem.contextValue === TreeItemContextValues.PROJECT)) {
            break;
        }
        currentItem = currentItem.parent;
    }

    // If the selected item is a Project
    if (selectedItem.contextValue === TreeItemContextValues.PROJECT) {
        projectName = selectedItem.item.name;
        tovName = undefined; // No specific TOV selected
        logger.trace(`Selected item is a Project. Project: ${projectName}, TOV: (none)`);
    }
    // If the selected item is a TOV
    else if (selectedItem.contextValue === TreeItemContextValues.VERSION) {
        tovName = selectedItem.item.name;
        if (selectedItem.parent && selectedItem.parent.contextValue === TreeItemContextValues.PROJECT) {
            projectName = selectedItem.parent.item.name;
        }
        logger.trace(`Selected item is a TOV. Project: ${projectName}, TOV: ${tovName}`);
    }
    // A Cycle is selected
    else if (selectedItem.contextValue === TreeItemContextValues.CYCLE) {
        if (selectedItem.parent && selectedItem.parent.contextValue === TreeItemContextValues.VERSION) {
            tovName = selectedItem.parent.item.name;
            if (
                selectedItem.parent.parent &&
                selectedItem.parent.parent.contextValue === TreeItemContextValues.PROJECT
            ) {
                projectName = selectedItem.parent.parent.item.name;
            }
        }
        logger.trace(`Selected item is a Cycle. Project: ${projectName}, TOV: ${tovName}`);
    }

    if (!projectName) {
        logger.warn(`Could not determine Project Name from selected item: ${selectedItem.label}`);
    }

    return { projectName, tovName };
}
