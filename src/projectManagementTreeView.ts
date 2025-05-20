/**
 * @file projectManagementTreeView.ts
 * @description Provides the data provider and view management for the project management tree and test theme tree.
 * Project management tree displays the selected project and its test object versions and cycles.
 */

import * as vscode from "vscode";
import * as path from "path";
import {
    getLatestLsContextRequestId,
    latestLsContextRequestId,
    restartLanguageClient,
    setCurrentLsOperationId,
    setLatestLsContextRequestId,
    stopLanguageClient
} from "./server";
import { CycleNodeData, CycleStructure, Project, TreeNode } from "./testBenchTypes";
import {
    connection,
    logger,
    projectManagementTreeDataProvider,
    testElementsTreeDataProvider,
    projectTreeView,
    testThemeTreeView,
    testElementTreeView
} from "./extension";
import { allExtensionCommands, ContextKeys, TreeItemContextValues } from "./constants";
import { displayTestThemeTreeView, TestThemeTreeDataProvider } from "./testThemeTreeView";
import { displayTestElementsTreeView } from "./testElementsTreeView";

// Event payload for when cycle data is prepared for the Test Theme tree
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
    private testThemeTreeDataProvider: TestThemeTreeDataProvider | null;

    // Variables to temporarily set a custom root item in the tree view.
    private customRootKey: string | null = null;
    private customRootJsonData: any | null = null;
    public customRootItemInstance: BaseTestBenchTreeItem | null = null;
    public originalCustomRootContextValue: string | null = null;

    // Store keys of expanded tree nodes to restore expansion state of collapsible elements after a refresh.
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
        vscode.commands.executeCommand("setContext", ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false);
        logger.trace("ProjectManagementTreeDataProvider initialized.");
    }

    /**
     * Refreshes the tree view.
     * If isHardRefresh is true, it resets the custom root item.
     * @param {boolean} isHardRefresh Optional flag to force a hard refresh.
     */
    refresh(isHardRefresh: boolean = false): void {
        logger.debug(`Refreshing project management tree view. Hard refresh: ${isHardRefresh}`);

        if (isHardRefresh && this.customRootKey !== null) {
            this.resetCustomRootInternally();
        }

        if (!connection) {
            this.updateMessageCallback("Not connected to TestBench. Please log in.");
        } else if (this.customRootKey && this.customRootJsonData) {
            this.updateMessageCallback(undefined);
        } else {
            this.updateMessageCallback("Loading projects...");
        }

        this._onDidChangeTreeData.fire(undefined);
        logger.trace("Project management tree view refresh triggered.");
    }

    /**
     * Returns the parent of a given tree item.
     *
     * @param {BaseTestBenchTreeItem} element The tree item.
     * @returns {BaseTestBenchTreeItem | null} The parent tree item or null.
     */
    getParent(element: BaseTestBenchTreeItem): BaseTestBenchTreeItem | null {
        if (this.customRootItemInstance && element.parent === this.customRootItemInstance) {
            return this.customRootItemInstance;
        }

        if (this.customRootItemInstance && element === this.customRootItemInstance) {
            return null;
        }

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

        const projectKey: string | null = this.getProjectKeyForTreeItem(cycleElement);
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
        if (!cycleData.nodes || !cycleData.root?.base?.key) {
            logger.error(`Fetched cycle structure for ${cycleElementLabel} is missing nodes or root key.`);
            return null;
        }
        return cycleData;
    }

    /**
     * Gets the project key for a given tree node, considering the custom root state.
     * @param {BaseTestBenchTreeItem} treeItem The tree item.
     * @returns The project key string or null.
     */
    public getProjectKeyForTreeItem(treeItem: BaseTestBenchTreeItem): string | null {
        logger.trace(`Provider: Getting project key for node: ${treeItem.label}`);
        let currentTreeItem: BaseTestBenchTreeItem | null = treeItem;
        while (currentTreeItem) {
            const isTheCustomRoot: boolean = this.customRootItemInstance === currentTreeItem;
            const originalContext = isTheCustomRoot
                ? this.originalCustomRootContextValue
                : currentTreeItem.contextValue;

            if (originalContext === TreeItemContextValues.PROJECT) {
                logger.trace(
                    `Provider: Found project key '${currentTreeItem.item.key}' for node '${treeItem.label}' via item '${currentTreeItem.label}'`
                );
                return currentTreeItem.item.key;
            }
            currentTreeItem = currentTreeItem.parent;
        }
        logger.warn(`Provider: Project key not found for node '${treeItem.label}' by traversing up.`);
        return null;
    }

    /**
     * Gets the TOV (Version) key for a given tree node.
     * @param {BaseTestBenchTreeItem} treeItem The tree item.
     * @returns The TOV key string or null.
     */
    public getTovKeyForNode(treeItem: BaseTestBenchTreeItem): string | null {
        logger.trace(`Provider: Getting TOV key for node: ${treeItem.label}`);
        let currentTreeItem: BaseTestBenchTreeItem | null = treeItem;
        while (currentTreeItem) {
            const isTheCustomRoot: boolean = this.customRootItemInstance === currentTreeItem;
            const originalContext = isTheCustomRoot
                ? this.originalCustomRootContextValue
                : currentTreeItem.contextValue;

            if (originalContext === TreeItemContextValues.VERSION) {
                logger.trace(
                    `Provider: Found TOV key '${currentTreeItem.item.key}' for node '${treeItem.label}' via item '${currentTreeItem.label}'`
                );
                return currentTreeItem.item.key;
            }
            if (originalContext === TreeItemContextValues.PROJECT) {
                break;
            }
            currentTreeItem = currentTreeItem.parent;
        }
        logger.trace(`Provider: TOV key not found for node '${treeItem.label}' by traversing up to a TOV.`);
        return null;
    }

    /**
     * Determines the project name and TOV name for a given tree item, considering custom root.
     * @param {BaseTestBenchTreeItem} selectedTreeItem The BaseTestBenchTreeItem.
     * @returns An object with projectName and tovName.
     */
    public getProjectAndTovNamesForItem(selectedTreeItem: BaseTestBenchTreeItem): {
        projectName: string | undefined;
        tovName: string | undefined;
    } | null {
        if (!selectedTreeItem || !selectedTreeItem.item) {
            logger.trace("[LSP Context] Selected item or item.data is null in getProjectAndTovNamesForLSP.");
            return null;
        }

        let projectName: string | undefined;
        let tovName: string | undefined;

        // Helper to get the 'original' context value if the item is the current custom root
        const getEffectiveContext = (item: BaseTestBenchTreeItem): string | undefined => {
            if (this.customRootKey && item.item?.key === this.customRootKey) {
                return this.originalCustomRootContextValue || item.contextValue;
            }
            return item.contextValue;
        };

        // Helper to get the 'original' item data if the item is the current custom root
        const getEffectiveItemData = (item: BaseTestBenchTreeItem): any => {
            if (this.customRootKey && item.item?.key === this.customRootKey && this.customRootJsonData) {
                return this.customRootJsonData;
            }
            return item.item;
        };

        let currentItemForTraversal: BaseTestBenchTreeItem | null = selectedTreeItem;

        // Traverse up from the selected item to find Project and TOV
        while (currentItemForTraversal) {
            const effectiveContext = getEffectiveContext(currentItemForTraversal);
            const effectiveData = getEffectiveItemData(currentItemForTraversal);

            if (effectiveContext === TreeItemContextValues.PROJECT) {
                projectName = effectiveData.name;
            } else if (effectiveContext === TreeItemContextValues.VERSION) {
                tovName = effectiveData.name;
            }

            // If we've found both, or found a project and already had a TOV, we can stop.
            if ((projectName && tovName) || (effectiveContext === TreeItemContextValues.PROJECT && tovName)) {
                break;
            }
            // If the current item is the custom root, and it's not a project,
            // we might not find a project by traversing its 'parent' because it's acting as a root.
            if (
                this.customRootKey &&
                currentItemForTraversal.item?.key === this.customRootKey &&
                effectiveContext !== TreeItemContextValues.PROJECT
            ) {
                break; // Stop at custom root if it's not a project itself.
            }

            currentItemForTraversal = currentItemForTraversal.parent;
        }

        // If the selected item was a TOV (or a custom root that *was* a TOV) and we haven't found a project name yet
        if (getEffectiveContext(selectedTreeItem) === TreeItemContextValues.VERSION && !projectName) {
            if (
                selectedTreeItem.parent &&
                getEffectiveContext(selectedTreeItem.parent) === TreeItemContextValues.PROJECT
            ) {
                projectName = getEffectiveItemData(selectedTreeItem.parent).name;
            } else {
                // This case occurs if a TOV is made a custom root. Its original project parent isn't easily found
                // by simple traversal of tree items *after* makeRoot.
                // The ProjectManagementTreeDataProvider doesn't explicitly store the TOV's original project name when it becomes a custom root.
                // For the LS to work reliably when a TOV is a custom root, this might need enhancement in makeRoot.
                logger.warn(
                    `[LSP Context] Selected item or custom root is a TOV ('${tovName}'). Project name could not be determined by simple parent traversal. LS might require project name.`
                );
            }
        }

        // If the selected item was a Cycle (or a custom root that *was* a Cycle)
        if (getEffectiveContext(selectedTreeItem) === TreeItemContextValues.CYCLE) {
            if (
                selectedTreeItem.parent &&
                getEffectiveContext(selectedTreeItem.parent) === TreeItemContextValues.VERSION
            ) {
                if (!tovName) {
                    tovName = getEffectiveItemData(selectedTreeItem.parent).name;
                }
                if (
                    selectedTreeItem.parent.parent &&
                    getEffectiveContext(selectedTreeItem.parent.parent) === TreeItemContextValues.PROJECT
                ) {
                    if (!projectName) {
                        projectName = getEffectiveItemData(selectedTreeItem.parent.parent).name;
                    }
                }
            }
        }

        // If the custom root itself is a project, and we haven't found a project name through traversal (e.g. selected item is the custom root project)
        if (
            !projectName &&
            this.customRootKey &&
            this.originalCustomRootContextValue === TreeItemContextValues.PROJECT
        ) {
            if (selectedTreeItem.item?.key === this.customRootKey || !selectedTreeItem.parent) {
                // if selected is the custom root or has no parent in current view
                projectName = this.customRootJsonData.name;
            }
        }
        // If the custom root itself is a TOV, and we haven't found a TOV name
        if (!tovName && this.customRootKey && this.originalCustomRootContextValue === TreeItemContextValues.VERSION) {
            if (selectedTreeItem.item?.key === this.customRootKey || !selectedTreeItem.parent) {
                tovName = this.customRootJsonData.name;
                // Try to get project name if this TOV custom root was selected
                if (
                    selectedTreeItem.item?.key === this.customRootKey &&
                    selectedTreeItem.parent &&
                    getEffectiveContext(selectedTreeItem.parent) === TreeItemContextValues.PROJECT
                ) {
                    projectName = getEffectiveItemData(selectedTreeItem.parent).name;
                }
            }
        }

        logger.trace(
            `[LSP Context Provider Method] Determined for ${selectedTreeItem.label}': Project ${projectName}', TOV='${tovName}'`
        );
        return { projectName, tovName };
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
                // Cycles in this tree are not directly expandable to show themes
                defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
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

        const projectTree: TreeNode | null = await connection!.getProjectTreeOfProject(projectKey);

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
        const projectList: Project[] | null = await connection!.getProjectsList();

        if (projectList && projectList.length > 0) {
            this.updateMessageCallback(undefined);
            return projectList
                .map((project) => this.createTreeItem(project, TreeItemContextValues.PROJECT, null))
                .filter((item): item is BaseTestBenchTreeItem => item !== null);
        } else if (projectList) {
            logger.debug("No projects found on the server.");
            this.updateMessageCallback(
                "No projects found on the server. Create a project in TestBench or check permissions."
            );
            return [];
        } else {
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
        return [];
    }

    /**
     * Gets the children of a given tree item.
     * If no element is provided, it returns the root project.
     * Called when the tree view is first loaded or refreshed.
     *
     * @param {BaseTestBenchTreeItem} treeElement Optional parent tree item.
     * @returns {Promise<BaseTestBenchTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    async getChildren(treeElement?: BaseTestBenchTreeItem): Promise<BaseTestBenchTreeItem[]> {
        if (!connection) {
            this.updateMessageCallback("Not connected to TestBench. Please log in.");
            return [];
        }
        try {
            if (!treeElement) {
                // Requesting root level items
                if (this.customRootItemInstance) {
                    if (this.customRootItemInstance.collapsibleState === vscode.TreeItemCollapsibleState.None) {
                        const originalContext = this.originalCustomRootContextValue;
                        if (
                            originalContext === TreeItemContextValues.PROJECT ||
                            originalContext === TreeItemContextValues.VERSION
                        ) {
                            this.customRootItemInstance.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                        }
                    } else {
                        this.customRootItemInstance.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                    }
                    return [this.customRootItemInstance];
                }
                return await this.getRootProjects();
            }

            if (this.customRootItemInstance && treeElement.item.key === this.customRootItemInstance.item.key) {
                logger.debug(
                    `Fetching children for custom root item: ${treeElement.label} (Original type: ${this.originalCustomRootContextValue})`
                );
                if (this.originalCustomRootContextValue === TreeItemContextValues.PROJECT) {
                    return await this.getChildrenForProject(treeElement);
                } else if (this.originalCustomRootContextValue === TreeItemContextValues.VERSION) {
                    return this.getChildrenForVersion(treeElement);
                } else if (this.originalCustomRootContextValue === TreeItemContextValues.CYCLE) {
                    return [];
                }
                logger.warn(
                    `Custom root item ${treeElement.label} is of unhandled original type: ${this.originalCustomRootContextValue}`
                );
                return [];
            }

            if (treeElement.contextValue === TreeItemContextValues.PROJECT) {
                return await this.getChildrenForProject(treeElement);
            }

            if (treeElement.contextValue === TreeItemContextValues.VERSION) {
                return this.getChildrenForVersion(treeElement);
            }

            // Cycles do not show children directly in this tree
            if (treeElement.contextValue === TreeItemContextValues.CYCLE) {
                return await this.handleCycleExpansion(treeElement);
            }

            // Fallback for unexpected element types or elements with pre-loaded children.
            if (treeElement.children) {
                logger.warn(`Returning pre-loaded children for element: ${treeElement.label}.`);
                return treeElement.children;
            }
        } catch (error) {
            logger.error(`Error in getChildren for element ${treeElement?.label || "root"}:`, error);
            vscode.window.showErrorMessage(
                `Error fetching tree data: ${error instanceof Error ? error.message : "Unknown error"}`
            );
            this.updateMessageCallback("An error occurred while loading tree items.");
            return [];
        }

        logger.warn(`getChildren reached end without returning for element: ${treeElement?.label}`);
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
            if (
                this.customRootItemInstance &&
                this.customRootItemInstance !== treeItem &&
                this.originalCustomRootContextValue
            ) {
                this.customRootItemInstance.contextValue = this.originalCustomRootContextValue;
            }

            this.customRootKey = treeItem.item.key;
            this.customRootJsonData = { ...treeItem.item };
            this.customRootItemInstance = treeItem;
            this.originalCustomRootContextValue = treeItem.contextValue;
            treeItem.contextValue = TreeItemContextValues.CUSTOM_ROOT_PROJECT;

            if (
                this.originalCustomRootContextValue === TreeItemContextValues.PROJECT ||
                this.originalCustomRootContextValue === TreeItemContextValues.VERSION
            ) {
                treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            } else {
                treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
            }
            treeItem.parent = null;

            vscode.commands.executeCommand("setContext", ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, true);
            logger.debug(
                `Item "${typeof treeItem.label === "string" ? treeItem.label : treeItem.item.name}" (Key: ${this.customRootKey}) is now set as custom root.`
            );
        } else {
            this.resetCustomRootInternally();
            logger.debug("Custom root cleared due to invalid item for makeRoot.");
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Resets the custom root configuration internally.
     * Clears any custom root settings, restores the original context
     * if applicable, and updates the UI to reflect that no custom root is active.
     * It also clears the record of expanded tree items and updates any associated messages.
     */
    private resetCustomRootInternally(): void {
        const oldCustomRootInstance = this.customRootItemInstance;
        if (oldCustomRootInstance && this.originalCustomRootContextValue) {
            oldCustomRootInstance.contextValue = this.originalCustomRootContextValue;
        }
        this.customRootKey = null;
        this.customRootJsonData = null;
        this.customRootItemInstance = null;
        this.originalCustomRootContextValue = null;
        this.expandedTreeItems.clear();
        vscode.commands.executeCommand("setContext", ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false);
        this.updateMessageCallback(undefined);
    }

    /**
     * Resets the custom root, restoring the tree to display all projects.
     */
    public resetCustomRoot(): void {
        logger.debug("Resetting custom root for Project Management Tree.");
        if (this.customRootKey !== null) {
            this.resetCustomRootInternally();
            this._onDidChangeTreeData.fire(undefined);
            const itemThatWasRoot: BaseTestBenchTreeItem | null = this.customRootItemInstance;
            if (itemThatWasRoot) {
                this._onDidChangeTreeData.fire(itemThatWasRoot);
            }
            logger.info("Project Management Tree custom root has been reset.");
        } else {
            logger.trace("No custom root was active in Project Management Tree to reset.");
        }
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
        if (expanded) {
            this.expandedTreeItems.add(element.item.key);
        } else {
            this.expandedTreeItems.delete(element.item.key);
        }
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

        const projectKey: string | null = this.getProjectKeyForTreeItem(projectsTreeViewItem);

        if (!projectKey) {
            logger.error(
                `Project key could not be determined for cycle: ${projectsTreeViewItem.label}. Item parent: ${projectsTreeViewItem.parent?.label}, Custom root: ${this.customRootItemInstance?.label}`
            );
            vscode.window.showErrorMessage(
                `Could not determine project context for cycle '${projectsTreeViewItem.label}'.`
            );
            return;
        }

        if (testThemeTreeView && this.testThemeTreeDataProvider) {
            this.testThemeTreeDataProvider.setTreeViewStatusMessage(
                `Loading test themes for cycle: ${currentCycleLabel}...`
            );
        }
        if (testElementTreeView && testElementsTreeDataProvider) {
            const tovParent = projectsTreeViewItem.parent;
            const tovLabel: string =
                tovParent && typeof tovParent.label === "string" ? tovParent.label : "selected TOV";
            testElementsTreeDataProvider.setTreViewMessage(`Loading test elements for ${tovLabel}...`);
            testElementsTreeDataProvider.refresh([]);
        }

        // Hide the project management tree view and show the test theme tree and test elements tree views
        // BEFORE fetching data for responsiveness
        await hideProjectManagementTreeView();
        await displayTestThemeTreeView();
        if (testElementsTreeDataProvider) {
            await displayTestElementsTreeView();
        }

        const tovKeyOfSelectedCycleElement: string | null = this.getTovKeyForNode(projectsTreeViewItem);
        const tovLabel: string | undefined = tovKeyOfSelectedCycleElement
            ? projectsTreeViewItem.parent?.item.name
            : undefined;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Fetching data for cycle: ${currentCycleLabel}`,
                cancellable: false
            },
            async (progress) => {
                progress.report({ increment: 0, message: "Fetching test themes..." });
                const rawCycleData: CycleStructure | null = await this.getCycleJSONData(projectsTreeViewItem);

                progress.report({ increment: 40, message: "Preparing views..." });
                this._onDidPrepareCycleDataForThemeTree.fire({
                    projectKey: projectKey,
                    cycleKey: cycleKey,
                    cycleLabel: currentCycleLabel,
                    rawCycleStructure: rawCycleData
                });

                progress.report({ increment: 60, message: "Fetching test elements..." });
                if (testElementsTreeDataProvider) {
                    if (tovKeyOfSelectedCycleElement) {
                        logger.trace(
                            `Clicked cycle's parent TOV key: ${tovKeyOfSelectedCycleElement}. Fetching test elements.`
                        );
                        const areTestElementsFetched: boolean = await testElementsTreeDataProvider.fetchTestElements(
                            tovKeyOfSelectedCycleElement,
                            tovLabel
                        );
                        if (!areTestElementsFetched) {
                            testElementsTreeDataProvider.refresh([]);
                        }
                    } else {
                        logger.warn("Parent TOV key not found for the clicked cycle. Clearing test elements.");
                        testElementsTreeDataProvider.refresh([]);
                    }
                } else {
                    logger.error("TestElementsTreeDataProvider is not available for fetching elements.");
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
        this.resetCustomRootInternally();
        if (!connection) {
            this.updateMessageCallback("Not connected to TestBench. Please log in.");
        } else {
            this.updateMessageCallback("Project data cleared. Refresh or select a project.");
        }
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
    if (
        element.contextValue !== TreeItemContextValues.CYCLE &&
        element.contextValue !== TreeItemContextValues.TEST_THEME_NODE &&
        element.contextValue !== TreeItemContextValues.TEST_CASE_SET_NODE
    ) {
        logger.error(`Element ${element.label} is not a cycle or descendant; cannot find project key.`);
    }
    let current: BaseTestBenchTreeItem | null = element;
    while (current) {
        const isCustomProjectRoot: boolean =
            projectManagementTreeDataProvider?.customRootItemInstance === current &&
            projectManagementTreeDataProvider?.originalCustomRootContextValue === TreeItemContextValues.PROJECT;

        if (current.contextValue === TreeItemContextValues.PROJECT || isCustomProjectRoot) {
            logger.trace(`Found project key for cycle element: ${current.item.key} (Item: ${current.label})`);
            return current.item.key;
        }
        current = current.parent;
    }
    const projectKeyNotFoundErrorMessage: string = `Project key not found for cycle element: ${element.label}`;
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
    public originalContextValue?: string;

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
        this.originalContextValue = contextValue;
        this.parent = parent;
        this.statusOfTreeItem = item.exec?.status || item.status || "None"; // Possible values: Active, Planned, Finished, Closed, etc.

        // item.base is specific to CycleStructure nodes (TestThemes, TestCaseSets)
        const itemDataForTooltip = item?.base || item;

        // Set the tooltip based on the context value.
        if (
            contextValue === TreeItemContextValues.PROJECT ||
            contextValue === TreeItemContextValues.VERSION ||
            contextValue === TreeItemContextValues.CYCLE ||
            (this.originalContextValue &&
                (
                    [
                        TreeItemContextValues.PROJECT,
                        TreeItemContextValues.VERSION,
                        TreeItemContextValues.CYCLE
                    ] as string[]
                ).includes(this.originalContextValue))
        ) {
            this.tooltip = `Type: ${this.originalContextValue || contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nKey: ${itemDataForTooltip.key}`;
            if (
                (this.originalContextValue === TreeItemContextValues.PROJECT ||
                    contextValue === TreeItemContextValues.PROJECT) &&
                item
            ) {
                this.tooltip += `\nTOVs: ${item.tovsCount || 0}\nCycles: ${item.cyclesCount || 0}`;
            }
        } else if (
            contextValue === TreeItemContextValues.TEST_THEME_NODE ||
            contextValue === TreeItemContextValues.TEST_CASE_SET_NODE ||
            contextValue === TreeItemContextValues.TEST_CASE_NODE ||
            (this.originalContextValue &&
                (
                    [TreeItemContextValues.TEST_THEME_NODE, TreeItemContextValues.TEST_CASE_SET_NODE] as string[]
                ).includes(this.originalContextValue))
        ) {
            if (itemDataForTooltip?.numbering) {
                this.tooltip = `Numbering: ${itemDataForTooltip.numbering}\nType: ${itemDataForTooltip.elementType || this.originalContextValue || contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nID: ${itemDataForTooltip.uniqueID}`;
            } else {
                this.tooltip = `Type: ${itemDataForTooltip.elementType || this.originalContextValue || contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nID: ${itemDataForTooltip.uniqueID}`;
            }
            this.description = itemDataForTooltip?.uniqueID || "";
        } else if (
            contextValue === TreeItemContextValues.CUSTOM_ROOT_PROJECT ||
            contextValue === TreeItemContextValues.CUSTOM_ROOT_THEME
        ) {
            this.tooltip = `Custom Root View\nType: ${this.originalContextValue || "N/A"}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}`;
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
        let typeForIconLookup: string | undefined = this.contextValue;
        if (
            this.contextValue === TreeItemContextValues.CUSTOM_ROOT_PROJECT ||
            this.contextValue === TreeItemContextValues.CUSTOM_ROOT_THEME
        ) {
            typeForIconLookup = this.originalContextValue || this.contextValue;
        }

        const status: string = this.statusOfTreeItem?.toLowerCase() || "default"; // (Active, Planned, Finished, Closed etc.)

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
        const typeIcons = iconMap[typeForIconLookup as keyof typeof iconMap] || iconMap["default"];
        const iconFileNames = typeIcons[status] || typeIcons["default"] || iconMap.default.default;

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
    });
    projectTreeView.onDidCollapseElement(async (event) => {
        await projectManagementProvider.handleExpansion(event.element, false);
        projectManagementProvider.forgetExpandedItem(event.element);
    });

    // React to selection changes in the project tree view
    if (projectTreeView) {
        projectTreeView.onDidChangeSelection(async (event) => {
            if (event.selection.length > 0 && projectManagementTreeDataProvider) {
                const selectedElement: BaseTestBenchTreeItem = event.selection[0];
                logger.trace(
                    `Selection changed in Project Tree: ${typeof selectedElement.label === "string" ? selectedElement.label : "N/A"}, context: ${selectedElement.contextValue}`
                );

                const projectAndTovNameObj =
                    projectManagementTreeDataProvider.getProjectAndTovNamesForItem(selectedElement);
                if (!projectAndTovNameObj) {
                    logger.warn("Project and TOV names not found for the selected element.");
                    return;
                }
                const { projectName, tovName } = projectAndTovNameObj;
                logger.trace(`Selected Project: ${projectName}, TOV: ${tovName}`);

                if (projectName && tovName) {
                    await restartLanguageClient(projectName, tovName);
                } else {
                    // If only a project is selected (tovName is undefined), stop the LS.
                    if (projectName && !tovName) {
                        logger.info(
                            `[ProjectSelect] Project '${projectName}' selected, but no TOV. Stopping active LS.`
                        );
                        setLatestLsContextRequestId(latestLsContextRequestId + 1);
                        const thisStopOperationId: number = getLatestLsContextRequestId();
                        setCurrentLsOperationId(thisStopOperationId);
                        await stopLanguageClient();
                    } else {
                        logger.warn(
                            "Could not determine context for LS restart from selection (Project or TOV missing)."
                        );
                    }
                }
            }
        });
    }
}

/**
 * Hides the project management tree view.
 */
export async function hideProjectManagementTreeView(): Promise<void> {
    if (projectTreeView && projectTreeView.visible) {
        logger.trace(
            "Project management tree view is visible. Attempting to execute 'projectManagementTree.removeView'."
        );
        await vscode.commands.executeCommand("projectManagementTree.removeView");
    }
}

/**
 * Displays the project management tree view.
 */
export async function displayProjectManagementTreeView(): Promise<void> {
    if (projectTreeView) {
        await vscode.commands.executeCommand("projectManagementTree.focus");
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
