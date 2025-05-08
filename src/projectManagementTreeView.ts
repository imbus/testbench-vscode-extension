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
    projectManagementTreeDataProvider,
    setProjectManagementTreeDataProvider
} from "./extension";
import { testElementsTreeDataProvider } from "./extension";
import { allExtensionCommands, TreeItemContextValues } from "./constants";
import { clearTestElementsTreeView, displayTestElementsTreeView } from "./testElementsTreeView";

// Global references to the tree views and data provider with getters and setters.
export let projectManagementTreeView: vscode.TreeView<ProjectManagementTreeItem> | null = null;
export function getProjectManagementTreeView(): vscode.TreeView<ProjectManagementTreeItem> | null {
    return projectManagementTreeView;
}
export function setProjectManagementTreeView(view: vscode.TreeView<ProjectManagementTreeItem> | null): void {
    projectManagementTreeView = view;
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
    private _onDidChangeTreeData: vscode.EventEmitter<
        ProjectManagementTreeItem | ProjectManagementTreeItem[] | void | undefined
    > = // Allow undefined for root refresh
        new vscode.EventEmitter<ProjectManagementTreeItem | ProjectManagementTreeItem[] | void | undefined>();
    readonly onDidChangeTreeData: vscode.Event<
        ProjectManagementTreeItem | ProjectManagementTreeItem[] | void | undefined
    > = this._onDidChangeTreeData.event;

    // TODO: Remove?
    public activeProjectKeyInView: string | null = null;

    public setActiveProjectKeyInView(key: string | null): void {
        this.activeProjectKeyInView = key;
    }
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
     * @param {string} explicitContextValue An explicit context value if jsonData.nodeType is not reliable.
     * @param {ProjectManagementTreeItem | null} parent The parent tree item.
     * @returns {ProjectManagementTreeItem | null} A new TestbenchTreeItem or null.
     */
    private createTreeItem(
        jsonData: any,
        explicitContextValue: string,
        parent: ProjectManagementTreeItem | null
    ): ProjectManagementTreeItem | null {
        if (!jsonData || !jsonData.key || !jsonData.name) {
            // Check for required properties for a valid tree item
            logger.warn("Attempted to create tree item with invalid jsonData:", jsonData);
            return null;
        }

        // Extract key, name, and other base data
        let itemKey: string | undefined; // Key is also used for tracking expansion state
        let itemName: string | undefined;
        let itemBaseData: any; // To hold the object containing key/name

        if (
            explicitContextValue === TreeItemContextValues.TEST_THEME_NODE ||
            explicitContextValue === TreeItemContextValues.TEST_CASE_SET_NODE ||
            explicitContextValue === TreeItemContextValues.TEST_CASE_NODE
        ) {
            // Data comes from fetchCycleStructureOfCycleInProject.
            itemBaseData = jsonData;
            if (!itemBaseData) {
                logger.warn("Tree item data missing 'base' property:", jsonData);
                return null;
            }
            itemKey = itemBaseData.key;
            itemName = itemBaseData.name;

            // Check if key or name are missing AFTER trying to access them
            if (!itemKey || itemName === undefined) {
                logger.warn(
                    `Attempted to create tree item with missing key or name. Key: ${itemKey}, Name: ${itemName}`,
                    itemBaseData
                );
                return null;
            }

            // Adjust label specifically for these types if numbering exists
            if (itemBaseData.numbering) {
                itemName = `${itemBaseData.numbering} ${itemBaseData.name}`;
            }
        } else {
            // Data comes from getProjectTreeOfProject or getProjectsList
            itemBaseData = jsonData;
            itemKey = jsonData.key;
            itemName = jsonData.name;
        }

        // Check if needed properties were found
        if (!itemKey || itemName === undefined) {
            // Check itemName for undefined specifically
            logger.warn(
                `Attempted to create tree item with missing key or name. Key: ${itemKey}, Name: ${itemName}`,
                itemBaseData
            );
            return null;
        }

        // contextValue can be one of these types, which can be found in the response from the server:
        // Project, Version, Cycle, TestThemeNode, TestCaseSetNode, TestCaseNode
        const contextValue: string = explicitContextValue;
        const label: string = itemName; // Use the extracted name/label

        // Cycle elements are not collapsible since children of test cycles are shown in the Test Theme Tree.
        // Determine default collapsible state based on type and potential children
        let defaultCollapsibleState: vscode.TreeItemCollapsibleState;
        if (contextValue === TreeItemContextValues.CYCLE) {
            defaultCollapsibleState = vscode.TreeItemCollapsibleState.None; // Cycles offload children
        } else if (contextValue === TreeItemContextValues.PROJECT) {
            // Projects are collapsible if they have TOVs or Cycles reported by the API
            const hasPotentialChildren =
                (jsonData.tovsCount && jsonData.tovsCount > 0) || (jsonData.cyclesCount && jsonData.cyclesCount > 0);
            defaultCollapsibleState = hasPotentialChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
        } else if (contextValue === TreeItemContextValues.VERSION) {
            // TOVs are collapsible if they have children (Cycles) in the TreeNode structure
            defaultCollapsibleState =
                jsonData.children && jsonData.children.length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
        } else {
            // Default fallback for other types
            defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
        }

        const treeItem: ProjectManagementTreeItem = new ProjectManagementTreeItem(
            label,
            contextValue,
            // Initially set to the default state determined above
            defaultCollapsibleState,
            jsonData,
            parent
        );

        // Restore Expansion State
        // Check if this item's key was previously expanded
        if (this.expandedTreeItems.has(itemKey) && defaultCollapsibleState !== vscode.TreeItemCollapsibleState.None) {
            // If it was expanded, override the default state to Expanded
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            logger.trace(`Restoring expanded state for item: ${label} (Key: ${itemKey})`);
        }

        // Update tooltip and description after creation
        if (
            contextValue === TreeItemContextValues.PROJECT ||
            contextValue === TreeItemContextValues.VERSION ||
            contextValue === TreeItemContextValues.CYCLE
        ) {
            treeItem.tooltip = `Type: ${contextValue}\nName: ${treeItem.item.name}\nStatus: ${treeItem.statusOfTreeItem}\nKey: ${treeItem.item.key}`;
            if (contextValue === TreeItemContextValues.PROJECT) {
                treeItem.tooltip += `\nTOVs: ${treeItem.item.tovsCount || 0}\nCycles: ${treeItem.item.cyclesCount || 0}`;
            }
        } else if (
            itemBaseData &&
            (contextValue === TreeItemContextValues.TEST_THEME_NODE ||
                contextValue === TreeItemContextValues.TEST_CASE_SET_NODE ||
                contextValue === TreeItemContextValues.TEST_CASE_NODE)
        ) {
            // Use itemBaseData for these types
            treeItem.tooltip = `Type: ${contextValue}\nName: ${itemBaseData.name}\nStatus: ${treeItem.statusOfTreeItem}\nID: ${itemBaseData.uniqueID}`;
            if (itemBaseData.numbering) {
                treeItem.tooltip = `Numbering: ${itemBaseData.numbering}\n${treeItem.tooltip}`;
            }
            treeItem.description = itemBaseData.uniqueID || "";
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
        if (!connection) {
            // If no connection is available, return a placeholder item.
            return [
                new ProjectManagementTreeItem(
                    "Not connected to TestBench",
                    "error.notConnected",
                    vscode.TreeItemCollapsibleState.None,
                    {},
                    null
                )
            ];
        }
        try {
            // Fetch Root Projects
            if (!element) {
                // Root level: Fetch and display all projects
                logger.debug("Fetching all projects for the root of Project Management Tree.");
                const projectList: testBenchTypes.Project[] | null = await connection.getProjectsList();

                if (projectList && projectList.length > 0) {
                    // If projects are found, map each project data to a ProjectManagementTreeItem
                    // createTreeItem handles expansion state.
                    return projectList
                        .map((project) =>
                            // Create item for Project: pass project data, explicit context, and null parent.
                            this.createTreeItem(project, TreeItemContextValues.PROJECT, null)
                        )
                        .filter((item): item is ProjectManagementTreeItem => item !== null); // Filter out any null items if creation failed.
                } else if (projectList) {
                    // Empty list
                    logger.debug("No projects found on the server.");
                    return [
                        new ProjectManagementTreeItem(
                            "No projects found",
                            "info.noProjects",
                            vscode.TreeItemCollapsibleState.None,
                            {},
                            null
                        )
                    ];
                } else {
                    // Eerror during fetch, return placeholder
                    logger.error("Failed to fetch project list from the server.");
                    return [
                        new ProjectManagementTreeItem(
                            "Error fetching projects",
                            "error.fetchProjects",
                            vscode.TreeItemCollapsibleState.None,
                            {},
                            null
                        )
                    ];
                }
            }

            // Children of a Project item (Test Object Versions)
            if (element.contextValue === TreeItemContextValues.PROJECT) {
                logger.debug(`Fetching children (TOVs) for project: ${element.label}`);
                const projectKey = element.item.key; // element.item is testBenchTypes.Project
                if (!projectKey) {
                    logger.error(`Project key is missing for project item: ${element.label}`);
                    return [];
                }
                // Fetch the detailed tree for this project, which contains TOVs as children
                const projectTree: testBenchTypes.TreeNode | null =
                    await connection.getProjectTreeOfProject(projectKey);
                // Check if the project tree and its children (TOVs) exist.
                if (projectTree && projectTree.children && projectTree.children.length > 0) {
                    return projectTree.children
                        .map(
                            (
                                tovNode // tovNode is testBenchTypes.TreeNode
                            ) =>
                                // Pass `element` as the parent
                                this.createTreeItem(tovNode, tovNode.nodeType, element) // tovNode.nodeType should be "Version"
                        )
                        .filter(
                            (item: ProjectManagementTreeItem | null): item is ProjectManagementTreeItem => item !== null
                        );
                }
                logger.debug(`No children (TOVs) found for project: ${element.label}`);
                return [];
            }

            // Children of a TOV (Cycles)
            if (element.contextValue === TreeItemContextValues.VERSION) {
                logger.debug(`Fetching children (Cycles) for TOV: ${element.label}`);
                // element.item is testBenchTypes.TreeNode representing a TOV
                // Its children array contains the Cycle nodes.
                const cycleNodes = element.item.children ?? [];
                return cycleNodes
                    .map(
                        (
                            cycleNode: testBenchTypes.TreeNode // cycleNode is a testBenchTypes.TreeNode
                        ) => this.createTreeItem(cycleNode, cycleNode.nodeType, element) // cycleNode.nodeType should be "Cycle"
                    )
                    .filter(
                        (item: ProjectManagementTreeItem | null): item is ProjectManagementTreeItem => item !== null
                    );
            }

            // Cycles do not show children directly in this tree; they are offloaded to TestThemeTree
            if (element.contextValue === TreeItemContextValues.CYCLE) {
                logger.trace(
                    `Cycle node ${element.label} expanded in Project Tree. Offloading children to Test Theme Tree.`
                );
                // Offload children to TestThemeTree
                this.testThemeDataProvider.clearTree(); // Clear previous
                const childrenOfCycle = await this.getChildrenOfCycle(element); // This fetches and prepares children for the other tree
                this.testThemeDataProvider.setRoots(childrenOfCycle);
                return []; // Return empty as children are in another tree
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
                new ProjectManagementTreeItem(
                    "Error loading children",
                    "error.generic",
                    vscode.TreeItemCollapsibleState.None,
                    {},
                    null
                )
            ];
        }
        logger.warn(`getChildren reached end without returning for element: ${element?.label}`);
        return []; // Default empty return
    }

    /**
     * Adds the key of an expanded element to the set used for state preservation.
     * Called by the tree view's onDidExpandElement listener.
     * @param {ProjectManagementTreeItem} element The element that was expanded.
     */
    public rememberExpandedItem(element: ProjectManagementTreeItem): void {
        if (element && element.item && element.item.key) {
            this.expandedTreeItems.add(element.item.key);
            logger.trace(`Remembered expanded item: ${element.label} (Key: ${element.item.key})`);
        }
    }

    /**
     * Removes the key of a collapsed element from the set used for state preservation.
     * Called by the tree view's onDidCollapseElement listener.
     * @param {ProjectManagementTreeItem} element The element that was collapsed.
     */
    public forgetExpandedItem(element: ProjectManagementTreeItem): void {
        if (element && element.item && element.item.key) {
            this.expandedTreeItems.delete(element.item.key);
            logger.trace(`Forgot expanded item: ${element.label} (Key: ${element.item.key})`);
        }
    }

    /**
     * Fetches the sub-elements of a cycle element and builds the test theme tree.
     *
     * @param {ProjectManagementTreeItem} cycleElement The cycle tree item.
     * @returns {Promise<ProjectManagementTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    public async getChildrenOfCycle(cycleElement: ProjectManagementTreeItem): Promise<ProjectManagementTreeItem[]> {
        logger.trace("Fetching children of cycle element:", cycleElement.label);

        // Ensure we are dealing with a Cycle element
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

        const cycleData: testBenchTypes.CycleStructure | null = await connection.fetchCycleStructureOfCycleInProject(
            projectKey,
            cycleKey
        );

        // If the cycle has no sub-elements, return a placeholder item.
        if (!cycleData || !cycleData.nodes?.length) {
            logger.error("Cycle has no sub-elements (getChildrenOfCycle).");
            vscode.window.showErrorMessage("Failed to fetch data for the selected cycle.");
            return []; // Return empty, which will result in the placeholder in TestThemeTree
        }
        if (!cycleData.nodes || cycleData.nodes.length === 0 || !cycleData.root?.base?.key) {
            logger.error(`Cycle structure for ${cycleElement.label} has no nodes or root key. Displaying placeholder.`);
            return [];
        }

        // Create a map to store elements by their key. A key identifies an element uniquely.
        const elementsByKey = new Map<string, any>();
        cycleData.nodes.forEach((data: any) => {
            if (data?.base?.key) {
                elementsByKey.set(data.base.key, data);
            } else {
                // logger.warn("Found node without base.key in cycle structure:", data);
            }
        });

        if (elementsByKey.size === 0 && cycleData.nodes.length > 0) {
            logger.error(`No nodes with base.key were found in the cycle structure data, cannot build tree.`);
            return []; // Cannot proceed if no nodes have keys for lookup
        }

        /**
         * Recursively builds the test theme tree starting from a given parent cycle key.
         * Processes nodes from the cycle structure, filters them,
         * creates corresponding tree items, and handles hierarchy and expansion state.
         *
         * @param {string} parentCycleKey - The key of the parent element whose children are being built.
         * @param {ProjectManagementTreeItem} parentTreeItem - The tree item representing the parent.
         * @returns {ProjectManagementTreeItem[]} An array of tree items representing the children for the Test Theme tree.
         */
        const buildTestThemeTree = (
            parentCycleKey: string,
            parentTreeItem: ProjectManagementTreeItem
        ): ProjectManagementTreeItem[] => {
            // Filter potential children
            // Get all nodes from the map, filter them based on parent key and type first.
            const potentialChildrenData = Array.from(elementsByKey.values()).filter(
                (data) =>
                    // Ensure node has base data and matches the parent key
                    data?.base?.parentKey === parentCycleKey &&
                    // Exclude test cases from this tree view
                    data.elementType !== TreeItemContextValues.TEST_CASE_NODE &&
                    // Filter out non-executable elements and elements that are locked by the system
                    data.exec?.status !== "NotPlanned" &&
                    data.exec?.locker?.key !== "-2"
            );

            // Map filtered data to Tree Items
            // Process each valid child node data to create a tree item.
            const childTreeItems: (ProjectManagementTreeItem | null)[] = potentialChildrenData.map((data) => {
                // Determine if this node has its own valid children
                // Check if any node in the original map lists the current node's key as its parent,
                // meets the type criteria, and isn't filtered by status/locker.
                const hasVisibleChildren: boolean = Array.from(elementsByKey.values()).some(
                    (childData) =>
                        childData?.base?.parentKey === data.base.key &&
                        childData.elementType !== TreeItemContextValues.TEST_CASE_NODE &&
                        childData.exec?.status !== "NotPlanned" &&
                        childData.exec?.locker?.key !== "-2"
                );

                // Create the basic tree item
                // Call the main createTreeItem helper, passing the base data and explicit type.
                // It handles basic creation, label generation and context value.
                const treeItem: ProjectManagementTreeItem | null = this.createTreeItem(
                    data.base, // Pass the base data containing key, name, numbering etc.
                    data.elementType,
                    parentTreeItem // Pass the parent item for hierarchy
                );

                // If item creation failed, skip further processing
                if (!treeItem) {
                    return null;
                }

                // Store the full original data node onto the item if needed elsewhere
                treeItem.item = data;

                // Configure Collapsible State
                // Determine the state based on type and whether it has children.
                treeItem.collapsibleState =
                    data.elementType === TreeItemContextValues.TEST_CASE_SET_NODE
                        ? vscode.TreeItemCollapsibleState.None // TestCaseSetNodes are leaves in this view
                        : hasVisibleChildren
                          ? vscode.TreeItemCollapsibleState.Collapsed // Expandable if it has valid children
                          : vscode.TreeItemCollapsibleState.None; // Not expandable otherwise

                // Restore Expansion State
                // Check if this item was previously expanded and override state if necessary.
                const itemKey = data.base.key; // Use the key from the base object
                if (
                    itemKey &&
                    this.expandedTreeItems.has(itemKey) &&
                    treeItem.collapsibleState !== vscode.TreeItemCollapsibleState.None
                ) {
                    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                }

                // Recursively build children
                // If the current element has children, recursively call this function
                // to build the subtree for the next level.
                if (hasVisibleChildren) {
                    // Pass current treeItem as the new parent, use data.base.key for the next level's parent key
                    treeItem.children = buildTestThemeTree(data.base.key, treeItem);
                } else {
                    // Ensure children property is an empty array if no children
                    treeItem.children = [];
                }

                return treeItem; // Return the tree item
            });

            // Filter out nulls
            // Remove any null entries that might have resulted from failed item creation.
            return childTreeItems.filter(
                (item: ProjectManagementTreeItem | null): item is ProjectManagementTreeItem => item !== null
            );
        };

        const rootCycleKey: string = cycleData.root.base.key;
        // The parent for the first level of TestThemeTree items is the original cycleElement from ProjectManagementTree
        const childrenOfCycle: ProjectManagementTreeItem[] = buildTestThemeTree(rootCycleKey, cycleElement);
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
        logger.debug("Setting selected element as a temporary root:", treeItem.label);
        // Re-render starting from this item.
        // This requires getChildren to handle if 'element' is this new 'root'.
        // However, the standard way is to refresh and have getChildren return only this item.
        this.activeProjectKeyInView =
            treeItem.contextValue === TreeItemContextValues.PROJECT
                ? treeItem.item.key
                : findProjectKeyOfCycleElement(treeItem);
        this.refresh(); // re-trigger getChildren, which loads all projects.
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
        if (projectsTreeViewItem.contextValue === TreeItemContextValues.CYCLE) {
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

                    // Ensure activeProjectKeyInView is set based on the clicked cycle's project.
                    const projectKey: string | null = findProjectKeyOfCycleElement(projectsTreeViewItem);
                    if (projectKey) {
                        this.setActiveProjectKeyInView(projectKey);
                    } else {
                        logger.error(
                            "Could not determine project key for the clicked cycle. Aborting further actions."
                        );
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
                    this.testThemeDataProvider.clearTree(); // Clear previous test themes
                    const childrenForTestThemeTree: ProjectManagementTreeItem[] =
                        await this.getChildrenOfCycle(projectsTreeViewItem);
                    this.testThemeDataProvider.setRoots(childrenForTestThemeTree);

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
    }

    /**
     * Clears the project management tree.
     */
    public clearTree(): void {
        logger.trace("Clearing project management tree.");
        if (this.testThemeDataProvider) {
            this.testThemeDataProvider.clearTree();
        }
        this.activeProjectKeyInView = null;
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
            this.description = item.base?.uniqueID || "";
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
 * Initializes the test theme tree view.
 * This function creates a new tree view for test themes and sets its data provider.
 * @returns {TestThemeTreeDataProvider} The initialized test theme tree data provider.
 */
function initializeTestThemeTreeView(): TestThemeTreeDataProvider {
    logger.debug("Initializing test theme tree.");
    const testThemeDataProvider: TestThemeTreeDataProvider = new TestThemeTreeDataProvider();

    if (!testThemeTreeView) {
        // testThemeTree is the ID from package.json
        const newView: vscode.TreeView<ProjectManagementTreeItem> = vscode.window.createTreeView("testThemeTree", {
            treeDataProvider: testThemeDataProvider
        });
        setTestThemeTreeView(newView);
    }

    return testThemeDataProvider;
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
    const newProjectTreeView: vscode.TreeView<ProjectManagementTreeItem> = vscode.window.createTreeView(
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
        await projectManagementTreeDataProvider!.handleExpansion(event.element, true);
    });

    // Handle collapse events to update expansion state and icons dynamically.
    projectTreeView.onDidCollapseElement(async (event) => {
        await projectManagementTreeDataProvider!.handleExpansion(event.element, false);
    });

    // Handle selection changes (click events) to trigger test theme tree initialization on cycle click.
    projectTreeView.onDidChangeSelection(async (event) => {
        if (event.selection.length > 0) {
            const selectedElement: ProjectManagementTreeItem = event.selection[0];
            logger.trace(
                `Selection changed in Project Tree: ${selectedElement.label}, context: ${selectedElement.contextValue}`
            );

            // Update activeProjectKeyInView based on selection
            let current: ProjectManagementTreeItem | null = selectedElement;
            while (current) {
                if (current.contextValue === TreeItemContextValues.PROJECT) {
                    projectManagementTreeDataProvider?.setActiveProjectKeyInView(current.item.key);
                    break;
                }
                current = current.parent;
            }
            if (!current) {
                // No project ancestor found (should not happen for valid items)
                projectManagementTreeDataProvider?.setActiveProjectKeyInView(null);
            }

            if (selectedElement && selectedElement.contextValue === TreeItemContextValues.CYCLE) {
                // Trigger loading data into TestThemeTree and TestElementsTree
                // await projectManagementDataProvider!.handleTestCycleClick(selectedElement);
            }
        }
    });
}

/**
 * Initializes the project management tree view and test theme tree view and set the global references.
 * @param {vscode.ExtensionContext} context The VS Code extension context.
 * @returns {Promise<void>} A promise that resolves when the trees are initialized. *
 */
export async function initializeProjectAndTestThemeTrees(context: vscode.ExtensionContext): Promise<void> {
    logger.debug("Initializing project and test theme trees (multi-project mode).");

    // Setup the test theme tree view first, its provider is needed by ProjectManagementTreeDataProvider
    const testThemeDataProvider: TestThemeTreeDataProvider = initializeTestThemeTreeView();
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
 * @param {ProjectManagementTreeItem} element The tree item.
 * @returns {string | null} The project key as a string if found; otherwise null.
 */
export function findProjectKeyForElement(element: ProjectManagementTreeItem): string | null {
    logger.trace("Finding project key for element:", element.label);
    let current: ProjectManagementTreeItem | null = element;
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
