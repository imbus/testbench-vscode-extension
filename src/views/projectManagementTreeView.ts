/**
 * @file projectManagementTreeView.ts
 * @description Provides the data provider and view management for the project management tree and test theme tree.
 * Project management tree displays the selected project and its test object versions and cycles.
 */

// TODO: Delete this file after the refactor

import * as vscode from "vscode";
import {
    getLatestLsContextRequestId,
    latestLsContextRequestId,
    restartLanguageClient,
    setCurrentLsOperationId,
    setLatestLsContextRequestId,
    stopLanguageClient
} from "../server";
import { CycleNodeData, CycleStructure, Project, TreeNode } from "../testBenchTypes";
import {
    connection,
    logger,
    projectManagementTreeDataProvider,
    testElementsTreeDataProvider,
    projectTreeView,
    testThemeTreeView,
    testElementTreeView
} from "../extension";
import { ContextKeys, TreeItemContextValues } from "../constants";
import { displayTestThemeTreeView, TestThemeTreeDataProvider } from "./testThemeTreeView";
import { displayTestElementsTreeView } from "./testElements/testElementsTreeView";
import { BaseTreeItem } from "./common/baseTreeItem";
import { ProjectDataService } from "../services/projectDataService";
import { BaseTreeDataProvider } from "./common/baseTreeDataProvider";

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
export class ProjectManagementTreeDataProvider extends BaseTreeDataProvider<BaseTreeItem> {
    private _onDidPrepareCycleDataForThemeTree: vscode.EventEmitter<CycleDataForThemeTreeEvent> =
        new vscode.EventEmitter<CycleDataForThemeTreeEvent>();
    public readonly onDidPrepareCycleDataForThemeTree: vscode.Event<CycleDataForThemeTreeEvent> =
        this._onDidPrepareCycleDataForThemeTree.event;

    private readonly projectDataService: ProjectDataService;
    private testThemeTreeDataProvider: TestThemeTreeDataProvider | null;

    constructor(
        updateMessageCallback: (message: string | undefined) => void,
        testThemeTreeDataProviderInstance: TestThemeTreeDataProvider | null,
        extensionContext: vscode.ExtensionContext,
        projectDataService: ProjectDataService
    ) {
        super(extensionContext, updateMessageCallback);
        this.projectDataService = projectDataService;
        this.testThemeTreeDataProvider = testThemeTreeDataProviderInstance;
        logger.trace("[ProjectManagementTreeDataProvider] Initialized.");
    }

    protected getContextKeyForCustomRootSet(): string {
        return ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT;
    }

    protected getActualContextValueForCustomRootItem(): string {
        return TreeItemContextValues.CUSTOM_ROOT_PROJECT;
    }

    protected async getChildrenForTreeView(element?: BaseTreeItem): Promise<BaseTreeItem[]> {
        if (!element) {
            return await this.getRootProjects();
        }
        if (element.contextValue === TreeItemContextValues.PROJECT) {
            return await this.getChildrenForProject(element);
        }
        if (element.contextValue === TreeItemContextValues.VERSION) {
            return this.getChildrenForVersion(element);
        }
        if (element.contextValue === TreeItemContextValues.CYCLE) {
            return [];
        }
        return element.children || [];
    }

    protected async getChildrenOfCustomRoot(customRootElement: BaseTreeItem): Promise<BaseTreeItem[]> {
        const originalContext = this.originalCustomRootContextValue || customRootElement.contextValue;
        logger.debug(
            `[ProjectManagementTreeDataProvider] Fetching children for custom root item: ${customRootElement.label} (Original type: ${originalContext})`
        );

        if (originalContext === TreeItemContextValues.PROJECT) {
            return await this.getChildrenForProject(customRootElement);
        } else if (originalContext === TreeItemContextValues.VERSION) {
            return this.getChildrenForVersion(customRootElement);
        } else if (originalContext === TreeItemContextValues.CYCLE) {
            return [];
        }
        logger.warn(
            `[ProjectManagementTreeDataProvider] Custom root item ${customRootElement.label} is of unhandled original type for children: ${originalContext}`
        );
        return [];
    }

    /**
     * Refreshes the project management tree view.
     * @param isHardRefresh Optional flag to force a hard refresh.
     */
    public refresh(isHardRefresh: boolean = false): void {
        logger.debug(`[ProjectManagementTreeDataProvider] Refreshing. Hard refresh: ${isHardRefresh}`);
        if (isHardRefresh && this.isCustomRootActive) {
            this.resetCustomRootInternally();
        }

        if (this.isCustomRootActive && this.customRootItemInstance) {
            this.updateMessageCallback(undefined);
        } else {
            this.updateMessageCallback("Loading projects...");
        }
        this._onDidChangeTreeData.fire(undefined);
        logger.trace("[ProjectManagementTreeDataProvider] Tree view refresh triggered.");
    }

    /**
     * Fetches the raw json data for a specific test cycle from the server.
     *
     * @param {BaseTreeItem} cycleElement The tree item representing the cycle.
     * @returns {Promise<CycleStructure | null>} A promise that resolves to a `CycleStructure` object or `null` if an error occurs.
     */
    public async getCycleJSONData(cycleElement: BaseTreeItem): Promise<CycleStructure | null> {
        const cycleElementLabel: string = typeof cycleElement.label === "string" ? cycleElement.label : "N/A";
        logger.trace("Fetching raw cycle data for element:", cycleElementLabel);
        if (cycleElement.contextValue !== TreeItemContextValues.CYCLE) {
            logger.warn(`getRawCycleData called on non-Cycle item: ${cycleElementLabel}`);
            return null;
        }

        const cycleKey: string = cycleElement.itemData?.key;
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

        const cycleData = await this.projectDataService.fetchCycleStructure(projectKey, cycleKey);

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
     * @param {BaseTreeItem} treeItem The tree item.
     * @returns The project key string or null.
     */
    public getProjectKeyForTreeItem(treeItem: BaseTreeItem): string | null {
        logger.trace(`Provider: Getting project key for node: ${treeItem.label}`);
        let currentTreeItem: BaseTreeItem | null = treeItem;
        while (currentTreeItem) {
            const isTheCustomRoot: boolean = this.customRootItemInstance === currentTreeItem;
            const originalContext = isTheCustomRoot
                ? this.originalCustomRootContextValue
                : currentTreeItem.contextValue;

            if (originalContext === TreeItemContextValues.PROJECT) {
                logger.trace(
                    `Provider: Found project key '${currentTreeItem.itemData.key}' for node '${treeItem.label}' via item '${currentTreeItem.label}'`
                );
                return currentTreeItem.itemData.key;
            }
            currentTreeItem = currentTreeItem.parent;
        }
        logger.warn(`Provider: Project key not found for node '${treeItem.label}' by traversing up.`);
        return null;
    }

    /**
     * Gets the TOV (Version) key for a given tree node.
     * @param {BaseTreeItem} treeItem The tree item.
     * @returns The TOV key string or null.
     */
    public getTovKeyForNode(treeItem: BaseTreeItem): string | null {
        logger.trace(`Provider: Getting TOV key for node: ${treeItem.label}`);
        let currentTreeItem: BaseTreeItem | null = treeItem;
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
     * Determines the project name and TOV name for a given tree item,
     * considering custom root state.
     * @param {BaseTreeItem} selectedTreeItem The BaseTreeItem.
     * @returns An object with projectName and tovName, or null if resolution fails.
     */
    public getProjectAndTovNamesForItem(selectedTreeItem: BaseTreeItem): {
        projectName: string | undefined;
        tovName: string | undefined;
    } | null {
        if (!selectedTreeItem || !selectedTreeItem.itemData) {
            logger.trace(
                "[ProjectManagementTreeDataProvider.getProjectAndTovNamesForItem] Selected item or item.data is null."
            );
            return null;
        }

        let projectName: string | undefined;
        let tovName: string | undefined;

        const getEffectiveContext = (item: BaseTreeItem): string | undefined => {
            if (
                this.isCustomRootActive &&
                this.customRootItemInstance === item &&
                this.originalCustomRootContextValue
            ) {
                return this.originalCustomRootContextValue;
            }
            return item.contextValue;
        };

        const getEffectiveItemName = (item: BaseTreeItem): string | undefined => {
            return item.itemData?.name;
        };

        let currentItemForTraversal: BaseTreeItem | null = selectedTreeItem;

        while (currentItemForTraversal) {
            const effectiveContext = getEffectiveContext(currentItemForTraversal);
            const currentItemName = getEffectiveItemName(currentItemForTraversal);

            if (effectiveContext === TreeItemContextValues.PROJECT) {
                projectName = currentItemName;
            } else if (effectiveContext === TreeItemContextValues.VERSION) {
                tovName = currentItemName;
            }

            if (projectName && tovName) {
                break;
            }
            if (this.isCustomRootActive && this.customRootItemInstance === currentItemForTraversal) {
                break;
            }
            currentItemForTraversal = currentItemForTraversal.parent;
        }

        const selectedEffectiveContext = getEffectiveContext(selectedTreeItem);
        const selectedItemName = getEffectiveItemName(selectedTreeItem);

        if (selectedEffectiveContext === TreeItemContextValues.VERSION && !projectName) {
            tovName = tovName || selectedItemName;
        }

        if (selectedEffectiveContext === TreeItemContextValues.PROJECT) {
            projectName = projectName || selectedItemName;
        }

        if (selectedEffectiveContext === TreeItemContextValues.CYCLE) {
            const parent = selectedTreeItem.parent;
            if (parent) {
                const parentEffectiveContext = getEffectiveContext(parent);
                if (parentEffectiveContext === TreeItemContextValues.VERSION) {
                    tovName = tovName || getEffectiveItemName(parent);
                    if (parent.parent) {
                        const grandparentEffectiveContext = getEffectiveContext(parent.parent);
                        if (grandparentEffectiveContext === TreeItemContextValues.PROJECT) {
                            projectName = projectName || getEffectiveItemName(parent.parent);
                        }
                    }
                }
            }
        }

        logger.trace(
            `[ProjectManagementTreeDataProvider.getProjectAndTovNamesForItem] Determined for "${selectedItemName}": Project='${projectName}', TOV='${tovName}'`
        );
        return { projectName, tovName };
    }

    /**
     * Creates a TestbenchTreeItem from raw JSON data.
     * Handles expansion state restoration for collapsible items.
     *
     * @param {any} jsonData The raw JSON data.
     * @param {string} contextValue An explicit context value if jsonData.nodeType is not reliable.
     * @param {BaseTreeItem | null} parent The parent tree item.
     * @returns {BaseTreeItem | null} A new TestbenchTreeItem or null.
     */
    private createTreeItemFromData(
        jsonData: any,
        contextValue: string,
        parent: BaseTreeItem | null
    ): BaseTreeItem | null {
        if (!jsonData) {
            return null;
        }
        const itemData: any = jsonData;
        let defaultCollapsibleState: vscode.TreeItemCollapsibleState;

        if (typeof itemData.key === "undefined" || typeof itemData.name === "undefined") {
            logger.warn(`[ProjectManagementTreeDataProvider] Invalid data for context ${contextValue}:`, jsonData);
            return null;
        }
        const label: string = itemData.name!;

        switch (contextValue) {
            case TreeItemContextValues.PROJECT: {
                const projectData = itemData as Project;
                defaultCollapsibleState =
                    (projectData.tovsCount && projectData.tovsCount > 0) ||
                    (projectData.cyclesCount && projectData.cyclesCount > 0)
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
                defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
                break;
            default:
                logger.warn(
                    `[ProjectManagementTreeDataProvider] Unexpected contextValue '${contextValue}' in createTreeItemFromData`
                );
                defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
        }

        const treeItem = new BaseTreeItem(
            label,
            contextValue,
            defaultCollapsibleState,
            itemData,
            this.extensionContext,
            parent
        );

        this.applyStoredExpansionState(treeItem);
        return treeItem;
    }

    /**
     * Fetches and returns the children (Test Object Versions) for a given Project element.
     * @param {BaseTreeItem} projectElement The parent Project element.
     * @returns {Promise<BaseTreeItem[]>}
     * @private
     */
    private async getChildrenForProject(projectElement: BaseTreeItem): Promise<BaseTreeItem[]> {
        logger.debug(`Fetching children (TOVs) for project: ${projectElement.label}`);
        const projectKey = projectElement.itemData.key;
        if (!projectKey) {
            logger.error(`Project key is missing for project item: ${projectElement.label}`);
            return [];
        }

        const projectTree: TreeNode | null = await this.projectDataService.getProjectTree(projectKey);

        if (projectTree && projectTree.children && projectTree.children.length > 0) {
            return projectTree.children
                .map(
                    (
                        tovNode // tovNode is testBenchTypes.TreeNode
                    ) => this.createTreeItemFromData(tovNode, tovNode.nodeType, projectElement) // tovNode.nodeType should be "Version"
                )
                .filter((item: BaseTreeItem | null): item is BaseTreeItem => item !== null);
        }
        logger.debug(`No children (TOVs) found for project: ${projectElement.label}`);
        return [];
    }

    /**
     * Returns the children (Cycles) for a given Version (TOV) element.
     * These are typically pre-loaded as part of the Version's data.
     * @param {BaseTreeItem} versionElement The parent Version element.
     * @returns {BaseTreeItem[]}
     * @private
     */
    private getChildrenForVersion(versionElement: BaseTreeItem): BaseTreeItem[] {
        logger.debug(`Fetching children (Cycles) for TOV: ${versionElement.label}`);
        // element.item is testBenchTypes.TreeNode representing a TOV
        // Its children array contains the Cycle nodes.
        const cycleNodes = versionElement.itemData.children ?? [];
        return cycleNodes
            .map(
                (
                    cycleNode: TreeNode // cycleNode is a testBenchTypes.TreeNode
                ) => this.createTreeItemFromData(cycleNode, cycleNode.nodeType, versionElement) // cycleNode.nodeType should be "Cycle"
            )
            .filter((item: BaseTreeItem | null): item is BaseTreeItem => item !== null);
    }

    /**
     * Fetches and returns the root projects for the tree view.
     * This is called when no custom root is set and the tree should display all projects.
     * @private
     */
    private async getRootProjects(): Promise<BaseTreeItem[]> {
        logger.debug("Fetching all projects for the root of Project Management Tree.");
        const projectList: Project[] | null = await this.projectDataService.getProjectsList();

        if (projectList && projectList.length > 0) {
            this.updateMessageCallback(undefined);
            return projectList
                .map((project) => this.createTreeItemFromData(project, TreeItemContextValues.PROJECT, null))
                .filter((item): item is BaseTreeItem => item !== null);
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
     * @param {BaseTreeItem} cycleElement The Cycle element.
     * @returns {Promise<BaseTreeItem[]>}
     * @private
     */
    private async handleCycleExpansion(cycleElement: BaseTreeItem): Promise<BaseTreeItem[]> {
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
     * @param {BaseTreeItem} treeElement Optional parent tree item.
     * @returns {Promise<BaseTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    async getChildren(treeElement?: BaseTreeItem): Promise<BaseTreeItem[]> {
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

            if (this.customRootItemInstance && treeElement.itemData.key === this.customRootItemInstance.itemData.key) {
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
     * @param {BaseTreeItem} element The element that was expanded.
     */
    public rememberExpandedItem(element: BaseTreeItem): void {
        if (element && element.itemData && element.itemData.key) {
            this.expandedTreeItems.add(element.itemData.key);
            logger.trace(`Remembered expanded item: ${element.label} (Key: ${element.itemData.key})`);
        }
    }

    /**
     * Removes the key of a collapsed element from the set used for state preservation.
     * Called by the tree view's onDidCollapseElement listener.
     * @param {BaseTreeItem} element The element that was collapsed.
     */
    public forgetExpandedItem(element: BaseTreeItem): void {
        if (element && element.itemData && element.itemData.key) {
            this.expandedTreeItems.delete(element.itemData.key);
            logger.trace(`Forgot expanded item: ${element.label} (Key: ${element.itemData.key})`);
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
     * @param {BaseTreeItem} cycleElement The cycle tree item.
     * @returns {Promise<BaseTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    public async getChildrenOfCycle(cycleElement: BaseTreeItem): Promise<BaseTreeItem[]> {
        const cycleElementLabel: string = typeof cycleElement.label === "string" ? cycleElement.label : "N/A";
        logger.trace("Fetching children of cycle element:", cycleElementLabel);
        if (cycleElement.contextValue !== TreeItemContextValues.CYCLE) {
            logger.warn(`getChildrenOfCycle called on non-Cycle item: ${cycleElementLabel}`);
            return [];
        }

        const cycleKey: string = cycleElement.itemData?.key;
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

        const buildTestThemeTreeRecursive = (parentItemKey: string, parentTreeItem: BaseTreeItem): BaseTreeItem[] => {
            const potentialChildrenData = Array.from(elementsByKey.values()).filter(
                (node) => node?.base?.parentKey === parentItemKey && this.isCycleNodeVisibleInTestThemeTree(node)
            );
            const childTreeItems: (BaseTreeItem | null)[] = potentialChildrenData.map((nodeData) => {
                // Determine if this nodeData itself will have children in the theme tree
                const hasVisibleChildren: boolean = Array.from(elementsByKey.values()).some(
                    (childNodeCandidate) =>
                        childNodeCandidate?.base?.parentKey === nodeData.base.key &&
                        this.isCycleNodeVisibleInTestThemeTree(childNodeCandidate)
                );

                const treeItem: BaseTreeItem | null = this.createTreeItemFromData(
                    nodeData,
                    nodeData.elementType,
                    parentTreeItem
                );
                if (!treeItem) {
                    return null;
                }
                treeItem.itemData = nodeData;
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
            return childTreeItems.filter((item: BaseTreeItem | null): item is BaseTreeItem => item !== null);
        };

        const rootCycleKey: string = cycleData.root.base.key;
        const childrenOfCycleToReturn: BaseTreeItem[] = buildTestThemeTreeRecursive(rootCycleKey, cycleElement);

        return childrenOfCycleToReturn;
    }

    /**
     * Returns a TreeItem representation for the given element.
     *
     * @param {BaseTreeItem} element The tree item.
     * @returns {vscode.TreeItem} The tree item.
     */
    getTreeItem(element: BaseTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Handles expansion and collapse of a tree item.
     *
     * @param {BaseTreeItem} element The tree item.
     * @param {boolean} expanded True if the item is expanded, false otherwise.
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
     */
    async handleExpansion(element: BaseTreeItem, expanded: boolean): Promise<void> {
        logger.trace(`Setting expansion state of ${element.label} to ${expanded ? "expanded" : "collapsed"}.`);
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();
        if (expanded) {
            this.expandedTreeItems.add(element.itemData.key);
        } else {
            this.expandedTreeItems.delete(element.itemData.key);
        }
    }

    /**
     * Handles a click on a test cycle element.
     * Prepares data for the Test Theme tree and fires an event,
     * and handles Test Elements tree population.
     *
     * @param {BaseTreeItem} projectsTreeViewItem The clicked tree item in the projects tree view.
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
     */
    public async handleTestCycleClick(projectsTreeViewItem: BaseTreeItem): Promise<void> {
        const currentCycleLabel: string =
            typeof projectsTreeViewItem.label === "string" ? projectsTreeViewItem.label : "N/A";
        logger.trace("Handling tree item click for:", currentCycleLabel);

        if (projectsTreeViewItem.contextValue !== TreeItemContextValues.CYCLE) {
            logger.error("Clicked tree item is not a cycle. Cannot proceed.");
            return;
        }

        const cycleKey = projectsTreeViewItem.itemData.key;
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
            testElementsTreeDataProvider.setTreeViewMessage(`Loading test elements for ${tovLabel}...`);
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
            ? projectsTreeViewItem.parent?.itemData.name
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
        logger.trace("[ProjectManagementTreeDataProvider] Clearing tree.");
        super.clearTree();
        if (!connection) {
            this.updateMessageCallback("Not connected to TestBench. Please log in.");
        } else {
            this.updateMessageCallback("Project data cleared. Refresh or select a project.");
        }
    }
}

/**
 * Finds the project key (serial) for a given cycle element by traversing upward in the tree hierarchy.
 *
 * @param {BaseTreeItem} element The cycle tree item.
 * @returns {string | null} The project key as a string if found; otherwise null.
 */
export function findProjectKeyOfCycleElement(element: BaseTreeItem): string | null {
    logger.trace("Finding project key for cycle element:", element.label);
    if (
        element.contextValue !== TreeItemContextValues.CYCLE &&
        element.contextValue !== TreeItemContextValues.TEST_THEME_NODE &&
        element.contextValue !== TreeItemContextValues.TEST_CASE_SET_NODE
    ) {
        logger.error(`Element ${element.label} is not a cycle or descendant; cannot find project key.`);
    }
    let current: BaseTreeItem | null = element;
    while (current) {
        const isCustomProjectRoot: boolean =
            projectManagementTreeDataProvider?.customRootItemInstance === current &&
            projectManagementTreeDataProvider?.originalCustomRootContextValue === TreeItemContextValues.PROJECT;

        if (current.contextValue === TreeItemContextValues.PROJECT || isCustomProjectRoot) {
            logger.trace(`Found project key for cycle element: ${current.itemData.key} (Item: ${current.label})`);
            return current.itemData.key;
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
 * @param {BaseTreeItem} element The tree item.
 * @returns {string | null} The cycle key as a string if found; otherwise null.
 */
export function findCycleKeyOfTreeElement(element: BaseTreeItem): string | null {
    logger.trace("Finding cycle key for tree element:", element.label);
    let current: BaseTreeItem | null = element;
    while (current) {
        const effectiveContextValue: string | undefined = current.originalContextValue || current.contextValue;
        if (effectiveContextValue === TreeItemContextValues.CYCLE) {
            logger.trace("Found cycle key:", current.itemData.key);
            return current.itemData.key;
        }
        current = current.parent;
    }
    const cycleKeyNotFoundErrorMessage: string = `Cycle key not found in tree element: ${element.label}`;
    logger.error(cycleKeyNotFoundErrorMessage);
    return null;
}

/**
 * Sets up event listeners for the project tree view to handle expand/collapse and selection events.
 * These events update the expansion state, icons dynamically, and initialize the test theme tree on cycle click.
 * @param {vscode.TreeView<BaseTreeItem>} projectTreeView The project tree view instance.
 * @param {ProjectManagementTreeDataProvider} projectManagementProvider The project management data provider instance.
 */
export function setupProjectTreeViewEventListeners(
    projectTreeView: vscode.TreeView<BaseTreeItem>,
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
                const selectedElement: BaseTreeItem = event.selection[0];
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
 * @param {BaseTreeItem} element The tree item.
 * @returns {string | null} The project key as a string if found; otherwise null.
 */
export function findProjectKeyForElement(element: BaseTreeItem): string | null {
    logger.trace("Finding project key for element:", element.label);
    let current: BaseTreeItem | null = element;
    while (current) {
        const effectiveContextValue: string | undefined = current.originalContextValue || current.contextValue;
        if (effectiveContextValue === TreeItemContextValues.PROJECT) {
            logger.trace("Found project key for element:", current.itemData.key);
            return current.itemData.key;
        }
        current = current.parent;
    }
    const projectKeyNotFoundErrorMessage: string = `Project key not found traversing up from tree element: ${element.label}`;
    logger.error(projectKeyNotFoundErrorMessage);
    return null;
}
