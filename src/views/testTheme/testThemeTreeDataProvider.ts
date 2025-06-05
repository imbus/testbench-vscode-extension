/**
 * @file src/views/testTheme/testThemeTreeDataProvider.ts
 * @description Test theme tree data provider using new architecture
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeDataProvider, TreeDataProviderOptions } from "../common/baseTreeDataProvider";
import { TestThemeTreeItem } from "./testThemeTreeItem";
import { ProjectDataService } from "../../services/projectDataService";
import { MarkedItemStateService } from "../../services/markedItemStateService";
import { ContextKeys, TreeItemContextValues } from "../../constants";
import { CycleNodeData, CycleStructure } from "../../testBenchTypes";
import { CycleDataForThemeTreeEvent } from "../projectManagement/projectManagementTreeDataProvider";
import { IconManagementService } from "../../services/iconManagementService";
import { TreeViewType, TreeViewEmptyState, TreeViewOperationalState } from "../../services/treeViewStateTypes";
import { CancellableOperation, CancellableOperationManager } from "../../services/cancellableOperationService";

export class TestThemeTreeDataProvider extends BaseTreeDataProvider<TestThemeTreeItem> {
    private currentCycleKey: string | null = null;
    private currentProjectKey: string | null = null;
    private currentCycleLabel: string | null = null;
    private readonly iconService: IconManagementService;

    private readonly operationManager: CancellableOperationManager;

    // Operation IDs
    private static readonly FETCH_CYCLE_STRUCTURE_OPERATION = "fetchCycleStructure";
    private static readonly REFRESH_OPERATION = "refreshTestThemes";

    constructor(
        extensionContext: vscode.ExtensionContext,
        logger: TestBenchLogger,
        updateMessageCallback: (message: string | undefined) => void,
        private readonly projectDataService: ProjectDataService,
        private readonly markedItemStateService: MarkedItemStateService,
        iconManagementService: IconManagementService
    ) {
        const providerOptions: TreeDataProviderOptions = {
            contextKey: ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT,
            customRootContextValue: TreeItemContextValues.CUSTOM_ROOT_TEST_THEME,
            enableCustomRoot: true,
            enableExpansionTracking: true,
            stateConfig: {
                treeViewId: "testThemeTree",
                treeViewType: TreeViewType.TEST_THEME,
                noDataSourceMessage: "Select a cycle from the 'Projects' view to see test themes.",
                loadingMessageTemplate: "Loading test themes for {dataSource}..."
            }
        };
        super(extensionContext, logger, updateMessageCallback, providerOptions);
        this.iconService = iconManagementService;
        this.operationManager = new CancellableOperationManager(logger);
        this.logger.trace("[TestThemeTreeDataProvider] Initialized with enhanced state management");
    }

    public getCurrentCycleKey(): string | null {
        return this.currentCycleKey;
    }
    public getCurrentProjectKey(): string | null {
        return this.currentProjectKey;
    }

    /**
     * Populates the tree data provider with cycle data from the provided event.
     * Sets the current cycle context, builds the tree structure from raw cycle data,
     * and updates the tree view elements. Handles error states for invalid data.
     *
     * @param eventData - The cycle data event containing cycle information and structure
     */
    public populateFromCycleData(eventData: CycleDataForThemeTreeEvent): void {
        this.logger.trace(`[TestThemeTreeDataProvider] Populating from cycle data: ${eventData.cycleKey}`);

        this.setDataSource(eventData.cycleKey, eventData.cycleLabel, eventData.cycleLabel);

        this.currentCycleKey = eventData.cycleKey;
        this.currentProjectKey = eventData.projectKey;
        this.currentCycleLabel = eventData.cycleLabel;

        if (this.isCustomRootActive()) {
            this.customRootService.resetCustomRoot();
        }
        this.storeExpansionState(); // Store expansion state before building new tree

        if (!eventData.rawCycleStructure?.nodes?.length || !eventData.rawCycleStructure.root?.base?.key) {
            this.logger.warn(`[TTTDP] Invalid cycle structure for: ${eventData.cycleLabel}`);
            this.updateElements([]);
            this.setErrorState(new Error("Invalid cycle structure"), TreeViewEmptyState.PROCESSING_ERROR);
            return;
        }

        try {
            const elements = this.buildTreeFromCycleStructure(eventData.rawCycleStructure);
            this.recordFetchAttempt(true, eventData.rawCycleStructure.nodes.length, elements.length);
            this.updateElements(elements);

            if (elements.length === 0) {
                this.updateTreeState({
                    operationalState: TreeViewOperationalState.EMPTY,
                    emptyState: TreeViewEmptyState.SERVER_NO_DATA
                });
            }
        } catch (error) {
            this.logger.error(`[TTTDP] Error building tree from cycle structure:`, error);
            this.setErrorState(error as Error, TreeViewEmptyState.PROCESSING_ERROR);
        }
    }

    protected async fetchRootElements(): Promise<TestThemeTreeItem[]> {
        if (!this.currentCycleKey || !this.currentProjectKey) {
            this.updateTreeState({
                operationalState: TreeViewOperationalState.EMPTY,
                emptyState: TreeViewEmptyState.NO_DATA_SOURCE
            });
            return [];
        }

        // Cancel any existing fetch operation
        this.operationManager.cancelOperation(TestThemeTreeDataProvider.FETCH_CYCLE_STRUCTURE_OPERATION);

        const operation = this.operationManager.createOperation(
            TestThemeTreeDataProvider.FETCH_CYCLE_STRUCTURE_OPERATION,
            `Fetch cycle structure: ${this.currentCycleLabel || this.currentCycleKey}`
        );

        try {
            this.logger.debug(`[TTTDP] fetchRootElements for cycle ${this.currentCycleKey}`);
            this.setLoadingState(`Loading test themes for cycle: ${this.currentCycleLabel || this.currentCycleKey}...`);

            operation.throwIfCancelled("before cycle structure fetch");

            const cycleStructure = await this.projectDataService.fetchCycleStructure(
                this.currentProjectKey,
                this.currentCycleKey
            );

            operation.throwIfCancelled("after cycle structure fetch");

            if (cycleStructure) {
                const newRootElements = this.buildTreeFromCycleStructure(cycleStructure);

                // Apply expansion state to new elements
                const applyExpansionRecursive = (items: TestThemeTreeItem[]) => {
                    for (const item of items) {
                        this.applyStoredExpansionState(item);
                        if (item.children) {
                            applyExpansionRecursive(item.children as TestThemeTreeItem[]);
                        }
                    }
                };
                applyExpansionRecursive(newRootElements);
                this.rootElements = newRootElements;

                this.recordFetchAttempt(true, cycleStructure.nodes?.length || 0, newRootElements.length);

                if (newRootElements.length === 0) {
                    this.updateTreeState({
                        operationalState: TreeViewOperationalState.EMPTY,
                        emptyState: TreeViewEmptyState.SERVER_NO_DATA
                    });
                } else {
                    this.updateTreeState({
                        operationalState: TreeViewOperationalState.READY
                    });
                }

                return newRootElements;
            } else {
                this.setErrorState(new Error("Failed to fetch cycle structure"), TreeViewEmptyState.FETCH_ERROR);
                return [];
            }
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                this.logger.debug(`[TTTDP] Cycle structure fetch cancelled for: ${this.currentCycleKey}`);
                return [];
            }

            this.logger.error(`[TTTDP] Error in fetchRootElements:`, error);
            this.setErrorState(error as Error, TreeViewEmptyState.FETCH_ERROR);
            return [];
        }
    }

    /**
     * Fetches child elements for a given test theme tree item.
     * @param element - The parent tree item to retrieve children for
     * @returns A promise that resolves to an array of child tree items, or empty array if none exist
     */
    protected async fetchChildrenForElement(element: TestThemeTreeItem): Promise<TestThemeTreeItem[]> {
        return (element.children as TestThemeTreeItem[]) || [];
    }

    /**
     * Creates a TestThemeTreeItem from cycle node data with proper validation and state management.
     *
     * @param data - The cycle node data containing base information and element type
     * @param parent - The parent tree item, or null if this is a root item
     * @returns A configured TestThemeTreeItem or null if data is invalid
     */
    protected createTreeItemFromData(data: CycleNodeData, parent: TestThemeTreeItem | null): TestThemeTreeItem | null {
        if (!data?.base?.key || !data?.base?.name) {
            this.logger.warn("[TTTDP] Invalid cycle node data for tree item creation:", data);
            return null;
        }
        const label = data.base.numbering ? `${data.base.numbering} ${data.base.name}` : data.base.name;
        const hasChildren = this.nodeWillHaveVisibleChildren(data, this.getRawNodesFromCurrentRoot());

        const collapsibleState = hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        const treeItem = new TestThemeTreeItem(
            label,
            data.elementType,
            collapsibleState,
            data,
            this.extensionContext,
            this.logger,
            this.iconService,
            parent
        );

        const itemKey = treeItem.getUniqueId();
        const itemUID = treeItem.getUID();
        if (itemKey && itemUID) {
            const importState = this.markedItemStateService.getItemImportState(itemKey, itemUID);
            treeItem.updateContextForMarking(importState.shouldShow);
        }

        this.applyStoredExpansionState(treeItem);
        return treeItem;
    }

    /**
     * Retrieves the raw node data from the current active root element.
     *
     * @returns An array of CycleNodeData representing the child nodes of the current root,
     * or an empty array if no nodes are available or the structure cannot be accessed.
     */
    private getRawNodesFromCurrentRoot(): CycleNodeData[] {
        const activeRoot = this.isCustomRootActive()
            ? this.getCurrentCustomRoot()?.itemData
            : (this.rootElements[0]?.itemData as CycleNodeData); // This is flawed if multiple roots
        if (activeRoot && activeRoot.nodes) {
            return activeRoot.nodes;
        } // If root is the cycle_structure.json itself
        if (this.rootElements.length > 0 && this.rootElements[0]?.itemData?.parentCycleStructure?.nodes) {
            return this.rootElements[0].itemData.parentCycleStructure.nodes;
        }
        this.logger.warn("[TTTDP] Cannot get raw nodes for child check, full structure not readily available.");
        return [];
    }

    /**
     * Determines if a node will have any visible children in the test theme tree.
     * @param nodeData - The parent node to check for visible children
     * @param allNodes - Array of all available nodes to search through
     * @returns True if the node has at least one visible child, false otherwise
     */
    private nodeWillHaveVisibleChildren(nodeData: CycleNodeData, allNodes: CycleNodeData[]): boolean {
        return allNodes.some(
            (childNode) =>
                childNode.base.parentKey === nodeData.base.key && this.isNodeVisibleInTestThemeTree(childNode)
        );
    }

    /**
     * Builds a tree structure from cycle structure data by creating a map of nodes
     * and recursively constructing the tree starting from the root node.
     *
     * @param cycleStructure - The cycle structure containing nodes and root information
     * @returns Array of TestThemeTreeItem representing the built tree, or empty array if no valid nodes found
     */
    private buildTreeFromCycleStructure(cycleStructure: CycleStructure): TestThemeTreeItem[] {
        const elementsByKey = new Map<string, CycleNodeData>();
        cycleStructure.nodes.forEach((node) => {
            if (node?.base?.key) {
                elementsByKey.set(node.base.key, node);
            }
        });

        if (elementsByKey.size === 0 && cycleStructure.nodes.length > 0) {
            this.logger.error("[TTTDP] No nodes with base.key found in cycle structure.");
            return [];
        }
        const rootCycleKey = cycleStructure.root.base.key;
        return this.buildTreeRecursively(rootCycleKey, null, elementsByKey);
    }

    /**
     * Recursively builds a tree structure from flat node data.
     *
     * @param parentKey - The key of the parent node to build children for
     * @param parentItem - The parent tree item, or null for root level
     * @param elementsByKey - Map containing all node data indexed by key
     * @returns Array of tree items that are children of the specified parent
     */
    private buildTreeRecursively(
        parentKey: string,
        parentItem: TestThemeTreeItem | null,
        elementsByKey: Map<string, CycleNodeData>
    ): TestThemeTreeItem[] {
        const children: TestThemeTreeItem[] = [];
        for (const nodeData of elementsByKey.values()) {
            if (nodeData.base.parentKey === parentKey && this.isNodeVisibleInTestThemeTree(nodeData)) {
                const treeItem = this.createTreeItemFromData(nodeData, parentItem);
                if (treeItem) {
                    const grandChildren = this.buildTreeRecursively(nodeData.base.key, treeItem, elementsByKey);
                    treeItem.children = grandChildren;
                    if (grandChildren.length > 0) {
                        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                    } else {
                        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
                    }
                    this.applyStoredExpansionState(treeItem);
                    children.push(treeItem);
                }
            }
        }
        return children;
    }

    /**
     * Determines whether a node should be visible in the test theme tree view.
     *
     * @param nodeData - The cycle node data to evaluate for visibility
     * @returns `false` if the node is a test case, has "NotPlanned" status, or has locker value "-2"; otherwise `true`
     */
    private isNodeVisibleInTestThemeTree(nodeData: CycleNodeData): boolean {
        if (nodeData.elementType === TreeItemContextValues.TEST_CASE_NODE) {
            return false;
        }
        if (nodeData.exec?.status === "NotPlanned" || nodeData.exec?.locker === "-2") {
            return false;
        }
        return true;
    }

    /**
     * Retrieves the report root UID for a given test theme tree item.
     *
     * @param item - The test theme tree item to get the report root UID for
     * @returns The report root UID if the item has both a unique ID and UID, undefined otherwise
     */
    public getReportRootUIDForItem(item: TestThemeTreeItem): string | undefined {
        const itemKey = item.getUniqueId();
        const itemUID = item.getUID();
        return itemKey && itemUID ? this.markedItemStateService.getReportRootUID(itemKey, itemUID) : undefined;
    }

    /**
     * Clears the test theme tree and resets all current state variables.
     * Extends the base clearTree functionality by resetting cycle and project tracking.
     */
    public override clearTree(): void {
        this.currentCycleKey = null;
        this.currentProjectKey = null;
        this.currentCycleLabel = null;
        super.clearTree();
        this.logger.trace("[TestThemeTreeDataProvider] Tree cleared with enhanced state management.");
    }

    /**
     * Refreshes the test theme tree data by fetching the latest cycle structure.
     *
     * @param isHardRefresh - If true, resets custom root and forces a complete refresh
     * @returns Promise that resolves when the refresh operation completes
     *
     * @remarks
     * - Cancels any ongoing refresh operations before starting
     * - Preserves tree expansion state during refresh
     * - Handles both normal and custom root refresh scenarios
     * - Sets appropriate loading and error states during the operation
     */
    public override async refresh(isHardRefresh: boolean = false): Promise<void> {
        // Cancel any ongoing refresh operations
        this.operationManager.cancelOperation(TestThemeTreeDataProvider.REFRESH_OPERATION);

        const operation = this.operationManager.createOperation(
            TestThemeTreeDataProvider.REFRESH_OPERATION,
            "Refresh test themes"
        );

        try {
            this.logger.debug(`[TestThemeTreeDataProvider] Refreshing. Hard refresh: ${isHardRefresh}`);

            if (isHardRefresh && this.isCustomRootActive()) {
                this.customRootService.resetCustomRoot();
            }
            this.storeExpansionState();

            if (!this.currentCycleKey || !this.currentProjectKey) {
                this.clearTree();
                return;
            }

            this.setDataSource(this.currentCycleKey, this.currentCycleLabel || this.currentCycleKey);

            const loadingMessage =
                this.isCustomRootActive() && this.getCurrentCustomRoot()
                    ? `Refreshing: ${this.getCurrentCustomRoot()?.label}...`
                    : `Refreshing test themes for cycle: ${this.currentCycleLabel || this.currentCycleKey}...`;

            this.setLoadingState(loadingMessage);

            operation.throwIfCancelled("before cycle structure fetch in refresh");

            const cycleStructure = await this.projectDataService.fetchCycleStructure(
                this.currentProjectKey,
                this.currentCycleKey
            );

            operation.throwIfCancelled("after cycle structure fetch in refresh");

            if (cycleStructure) {
                if (this.isCustomRootActive() && !isHardRefresh) {
                    await this.refreshCustomRootNode(cycleStructure, operation);
                } else {
                    const elements = this.buildTreeFromCycleStructure(cycleStructure);
                    this.recordFetchAttempt(true, cycleStructure.nodes?.length || 0, elements.length);
                    this.updateElements(elements);
                }
            } else {
                this.setErrorState(new Error("Failed to fetch cycle structure"), TreeViewEmptyState.FETCH_ERROR);
            }
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                this.logger.debug("[TTTDP] Refresh operation cancelled");
                return;
            }

            this.logger.error(`[TTTDP] Error during refresh:`, error);
            this.setErrorState(error as Error, TreeViewEmptyState.FETCH_ERROR);
        }
    }

    /**
     * Refreshes the custom root node with updated cycle structure data while preserving expansion state.
     * If the custom root is not found in the updated data, resets the custom root and triggers a full refresh.
     *
     * @param cycleStructure - The updated cycle structure containing node data
     * @param operation - Cancellable operation to check for cancellation during refresh
     * @throws If the operation is cancelled before refresh begins
     */
    private async refreshCustomRootNode(
        cycleStructure: CycleStructure,
        operation: CancellableOperation
    ): Promise<void> {
        const currentRoot = this.getCurrentCustomRoot();
        if (!currentRoot) {
            return;
        }

        operation.throwIfCancelled("before custom root refresh");

        const currentRootKey = currentRoot.getUniqueId();
        const elementsByKey = new Map<string, CycleNodeData>();
        cycleStructure.nodes.forEach((node) => node?.base?.key && elementsByKey.set(node.base.key, node));

        const updatedNodeData = elementsByKey.get(currentRootKey);

        if (updatedNodeData) {
            currentRoot.itemData = updatedNodeData;
            currentRoot.label = updatedNodeData.base.numbering
                ? `${updatedNodeData.base.numbering} ${updatedNodeData.base.name}`
                : updatedNodeData.base.name;
            currentRoot.children = this.buildTreeRecursively(currentRootKey, currentRoot, elementsByKey);
            currentRoot.collapsibleState =
                currentRoot.children.length > 0
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None;

            this.applyStoredExpansionState(currentRoot);
            this.updateElements([currentRoot]);
        } else {
            this.logger.warn(`[TTTDP] Custom root ${currentRootKey} not found in refreshed data. Resetting.`);
            this.customRootService.resetCustomRoot();
            this.refresh(true);
        }
    }

    /**
     * Dispose with operation cleanup
     */
    public override dispose(): void {
        this.operationManager.dispose();
        super.dispose();
    }
}
