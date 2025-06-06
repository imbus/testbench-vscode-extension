/**
 * @file src/views/testTheme/testThemeTreeDataProvider.ts
 * @description Test theme tree data provider using unified state management
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeDataProvider, TreeDataProviderOptions } from "../common/baseTreeDataProvider";
import { TestThemeTreeItem } from "./testThemeTreeItem";
import { ProjectDataService } from "../projectManagement/projectDataService";
import { MarkedItemStateService } from "./markedItemStateService";
import { ContextKeys, TreeItemContextValues } from "../../constants";
import { CycleTreeItemData, CycleStructure } from "../../testBenchTypes";
import { CycleDataForThemeTreeEvent } from "../projectManagement/projectManagementTreeDataProvider";
import { IconManagementService } from "../common/iconManagementService";
import { TreeViewType, TreeViewEmptyState, TreeViewOperationalState } from "../common/treeViewStateTypes";
import { CancellableOperation, CancellableOperationManager } from "../../services/cancellableOperationService";
import { StateChangeNotification } from "../common/unifiedTreeStateManager";

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
        this.logger.trace("[TestThemeTreeDataProvider] Initialized with unified state management");
    }

    /**
     * Handle unified state changes for better coordination
     */
    protected override onUnifiedStateChange(notification: StateChangeNotification): void {
        super.onUnifiedStateChange(notification);

        if (notification.changedFields.includes("customRootActive")) {
            const state = notification.newState;
            if (state.isCustomRootActive) {
                this.logger.debug(`[TestThemeTreeDataProvider] Custom root activated: ${state.customRootItem?.label}`);
            } else {
                this.logger.debug("[TestThemeTreeDataProvider] Custom root deactivated");
            }
        }
    }

    public getCurrentCycleKey(): string | null {
        return this.currentCycleKey;
    }

    public getCurrentProjectKey(): string | null {
        return this.currentProjectKey;
    }

    /**
     * Populates the tree data provider with cycle data from the provided event.
     * Uses unified state management for coordinated state updates.
     */
    public populateFromCycleData(eventData: CycleDataForThemeTreeEvent): void {
        this.logger.trace(`[TestThemeTreeDataProvider] Populating from cycle data: ${eventData.cycleKey}`);

        // Single coordinated state update through unified manager
        this.getUnifiedStateManager().updateState({
            dataSourceKey: eventData.cycleKey,
            dataSourceLabel: eventData.cycleLabel,
            dataSourceDisplayName: eventData.cycleLabel,
            operationalState: TreeViewOperationalState.LOADING
        });

        this.currentCycleKey = eventData.cycleKey;
        this.currentProjectKey = eventData.projectKey;
        this.currentCycleLabel = eventData.cycleLabel;

        const state = this.getUnifiedStateManager().getCurrentUnifiedState();
        if (state.isCustomRootActive) {
            this.getUnifiedStateManager().resetCustomRoot();
        }

        this.storeExpansionState();

        if (!eventData.rawCycleStructure?.nodes?.length || !eventData.rawCycleStructure.root?.base?.key) {
            this.logger.warn(`[TestThemeTreeDataProvider] Invalid cycle structure for: ${eventData.cycleLabel}`);
            this.updateTreeItem([]);
            this.getUnifiedStateManager().setError(
                new Error("Invalid cycle structure"),
                TreeViewEmptyState.PROCESSING_ERROR
            );
            return;
        }

        try {
            const testThemeTreeItems = this.buildTestThemeTreeFromCycleStructure(eventData.rawCycleStructure);

            // Coordinated state update for successful population
            this.getUnifiedStateManager().updateState({
                hasDataFetchBeenAttempted: true,
                isServerDataReceived: true,
                itemsBeforeFiltering: eventData.rawCycleStructure.nodes.length,
                itemsAfterFiltering: testThemeTreeItems.length,
                operationalState:
                    testThemeTreeItems.length === 0 ? TreeViewOperationalState.EMPTY : TreeViewOperationalState.READY,
                emptyState: testThemeTreeItems.length === 0 ? TreeViewEmptyState.SERVER_NO_DATA : undefined
            });

            this.updateTreeItem(testThemeTreeItems);
        } catch (error) {
            this.logger.error(`[TestThemeTreeDataProvider] Error building tree from cycle structure:`, error);
            this.getUnifiedStateManager().setError(error as Error, TreeViewEmptyState.PROCESSING_ERROR);
        }
    }

    protected async fetchRootTreeItems(): Promise<TestThemeTreeItem[]> {
        if (!this.currentCycleKey || !this.currentProjectKey) {
            this.getUnifiedStateManager().setEmpty(TreeViewEmptyState.NO_DATA_SOURCE);
            return [];
        }

        // Cancel any existing fetch operation
        this.operationManager.cancelOperation(TestThemeTreeDataProvider.FETCH_CYCLE_STRUCTURE_OPERATION);

        const operation = this.operationManager.createOperation(
            TestThemeTreeDataProvider.FETCH_CYCLE_STRUCTURE_OPERATION,
            `Fetch cycle structure: ${this.currentCycleLabel || this.currentCycleKey}`
        );

        try {
            this.logger.debug(`[TestThemeTreeDataProvider] fetchRootElements for cycle ${this.currentCycleKey}`);
            this.getUnifiedStateManager().setLoading(
                `Loading test themes for cycle: ${this.currentCycleLabel || this.currentCycleKey}...`
            );

            operation.throwIfCancelled("before cycle structure fetch");

            const cycleStructure = await this.projectDataService.fetchCycleStructure(
                this.currentProjectKey,
                this.currentCycleKey
            );

            operation.throwIfCancelled("after cycle structure fetch");

            if (cycleStructure) {
                const newRootTestThemeTreeItems = this.buildTestThemeTreeFromCycleStructure(cycleStructure);

                const applyExpansionRecursive = (items: TestThemeTreeItem[]) => {
                    for (const item of items) {
                        this.applyStoredExpansionState(item);
                        if (item.children) {
                            applyExpansionRecursive(item.children as TestThemeTreeItem[]);
                        }
                    }
                };
                applyExpansionRecursive(newRootTestThemeTreeItems);
                this.rootTreeItems = newRootTestThemeTreeItems;

                // Single coordinated state update for successful fetch
                this.getUnifiedStateManager().updateState({
                    hasDataFetchBeenAttempted: true,
                    isServerDataReceived: true,
                    itemsBeforeFiltering: cycleStructure.nodes?.length || 0,
                    itemsAfterFiltering: newRootTestThemeTreeItems.length,
                    operationalState:
                        newRootTestThemeTreeItems.length === 0
                            ? TreeViewOperationalState.EMPTY
                            : TreeViewOperationalState.READY,
                    emptyState: newRootTestThemeTreeItems.length === 0 ? TreeViewEmptyState.SERVER_NO_DATA : undefined
                });

                return newRootTestThemeTreeItems;
            } else {
                this.getUnifiedStateManager().setError(
                    new Error("Failed to fetch cycle structure"),
                    TreeViewEmptyState.FETCH_ERROR
                );
                return [];
            }
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                this.logger.debug(
                    `[TestThemeTreeDataProvider] Cycle structure fetch cancelled for: ${this.currentCycleKey}`
                );
                return [];
            }

            this.logger.error(`[TestThemeTreeDataProvider] Error in fetchRootElements:`, error);
            this.getUnifiedStateManager().setError(error as Error, TreeViewEmptyState.FETCH_ERROR);
            return [];
        }
    }

    /**
     * Fetches child elements for a given test theme tree item.
     */
    protected async fetchChildrenForTreeItem(testThemeTreeItem: TestThemeTreeItem): Promise<TestThemeTreeItem[]> {
        return (testThemeTreeItem.children as TestThemeTreeItem[]) || [];
    }

    /**
     * Creates a TestThemeTreeItem from cycle node data with proper validation and state management.
     */
    protected createTestThemeTreeItemFromData(
        data: CycleTreeItemData,
        parent: TestThemeTreeItem | null
    ): TestThemeTreeItem | null {
        if (!data?.base?.key || !data?.base?.name) {
            this.logger.warn("[TestThemeTreeDataProvider] Invalid cycle node data for tree item creation:", data);
            return null;
        }
        const testThemeLabel = data.base.numbering ? `${data.base.numbering} ${data.base.name}` : data.base.name;
        const hasChildren = this.nodeWillHaveVisibleChildren(data, this.getRawNodesFromCurrentRoot());

        const collapsibleState = hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        const treeItem = new TestThemeTreeItem(
            testThemeLabel,
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
     */
    private getRawNodesFromCurrentRoot(): CycleTreeItemData[] {
        const state = this.getUnifiedStateManager().getCurrentUnifiedState();
        const activeRoot = state.isCustomRootActive
            ? state.customRootItem?.itemData
            : (this.rootTreeItems[0]?.itemData as CycleTreeItemData);

        if (activeRoot && activeRoot.nodes) {
            return activeRoot.nodes;
        }

        if (this.rootTreeItems.length > 0 && this.rootTreeItems[0]?.itemData?.parentCycleStructure?.nodes) {
            return this.rootTreeItems[0].itemData.parentCycleStructure.nodes;
        }

        this.logger.warn(
            "[TestThemeTreeDataProvider] Cannot get raw nodes for child check, full structure not readily available."
        );
        return [];
    }

    /**
     * Determines if a node will have any visible children in the test theme tree.
     */
    private nodeWillHaveVisibleChildren(
        cycleNodeData: CycleTreeItemData,
        allCycleNodeData: CycleTreeItemData[]
    ): boolean {
        return allCycleNodeData.some(
            (childNode) =>
                childNode.base.parentKey === cycleNodeData.base.key && this.isTreeItemVisibleInTestThemeTree(childNode)
        );
    }

    /**
     * Builds a tree of `TestThemeTreeItem` objects from a given `CycleStructure`.
     *
     * This method first maps all nodes within the `cycleStructure` by their `base.key`
     * for lookup, then initiates a recursive build process starting
     * from the root node of the `cycleStructure`.
     *
     * If the `cycleStructure` contains nodes but none of them have a `base.key`,
     * an error is logged, and an empty array is returned.
     *
     * @param cycleStructure The cycle structure data used to build the tree.
     * @returns An array of `TestThemeTreeItem` representing the root level of the constructed tree,
     * or an empty array if no valid nodes are found or an error occurs.
     */
    private buildTestThemeTreeFromCycleStructure(cycleStructure: CycleStructure): TestThemeTreeItem[] {
        const treeItemsByKey = new Map<string, CycleTreeItemData>();
        cycleStructure.nodes.forEach((node) => {
            if (node?.base?.key) {
                treeItemsByKey.set(node.base.key, node);
            }
        });

        if (treeItemsByKey.size === 0 && cycleStructure.nodes.length > 0) {
            this.logger.error("[TestThemeTreeDataProvider] No nodes with base.key found in cycle structure.");
            return [];
        }
        const rootCycleKey = cycleStructure.root.base.key;
        return this.buildTestThemeTreeRecursively(rootCycleKey, null, treeItemsByKey);
    }

    /**
     * Recursively builds a tree structure from flat node data.
     */
    private buildTestThemeTreeRecursively(
        parentTestThemeKey: string,
        parentTestThemeTreeItem: TestThemeTreeItem | null,
        testThemeItemsByKey: Map<string, CycleTreeItemData>
    ): TestThemeTreeItem[] {
        const childTestThemeTreeItems: TestThemeTreeItem[] = [];
        for (const testThemeItemData of testThemeItemsByKey.values()) {
            if (
                testThemeItemData.base.parentKey === parentTestThemeKey &&
                this.isTreeItemVisibleInTestThemeTree(testThemeItemData)
            ) {
                const testThemeTreeItem = this.createTestThemeTreeItemFromData(
                    testThemeItemData,
                    parentTestThemeTreeItem
                );
                if (testThemeTreeItem) {
                    const grandChildrenOfTestThemeTreeItem = this.buildTestThemeTreeRecursively(
                        testThemeItemData.base.key,
                        testThemeTreeItem,
                        testThemeItemsByKey
                    );
                    testThemeTreeItem.children = grandChildrenOfTestThemeTreeItem;
                    if (grandChildrenOfTestThemeTreeItem.length > 0) {
                        testThemeTreeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                    } else {
                        testThemeTreeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
                    }
                    this.applyStoredExpansionState(testThemeTreeItem);
                    childTestThemeTreeItems.push(testThemeTreeItem);
                }
            }
        }
        return childTestThemeTreeItems;
    }

    /**
     * Determines whether a node should be visible in the test theme tree view.
     */
    private isTreeItemVisibleInTestThemeTree(cycleTreeItemData: CycleTreeItemData): boolean {
        if (cycleTreeItemData.elementType === TreeItemContextValues.TEST_CASE_TREE_ITEM) {
            return false;
        }
        if (cycleTreeItemData.exec?.status === "NotPlanned" || cycleTreeItemData.exec?.locker === "-2") {
            return false;
        }
        return true;
    }

    /**
     * Retrieves the report root UID for a given test theme tree item.
     */
    public getReportRootUIDForItem(testThemeTreeItem: TestThemeTreeItem): string | undefined {
        const testThemeTreeItemKey = testThemeTreeItem.getUniqueId();
        const testThemeTreeItemUID = testThemeTreeItem.getUID();
        return testThemeTreeItemKey && testThemeTreeItemUID
            ? this.markedItemStateService.getReportRootUID(testThemeTreeItemKey, testThemeTreeItemUID)
            : undefined;
    }

    /**
     * Clears the test theme tree and resets all current state variables.
     * Uses unified state management for coordinated clearing.
     */
    public override clearTree(): void {
        this.currentCycleKey = null;
        this.currentProjectKey = null;
        this.currentCycleLabel = null;
        super.clearTree();
        this.logger.trace("[TestThemeTreeDataProvider] Tree cleared with unified state management.");
    }

    /**
     * Refreshes the test theme tree data by fetching the latest cycle structure.
     * Uses unified state management for coordinated refresh operations.
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

            if (isHardRefresh) {
                this.getUnifiedStateManager().resetCustomRoot();
            }
            this.storeExpansionState();

            if (!this.currentCycleKey || !this.currentProjectKey) {
                this.clearTree();
                return;
            }

            // Coordinated state update for refresh
            const state = this.getUnifiedStateManager().getCurrentUnifiedState();
            const loadingTreeItemsMessage =
                state.isCustomRootActive && state.customRootItem
                    ? `Refreshing: ${state.customRootItem.label}...`
                    : `Refreshing test themes for cycle: ${this.currentCycleLabel || this.currentCycleKey}...`;

            this.getUnifiedStateManager().updateState({
                dataSourceKey: this.currentCycleKey,
                dataSourceLabel: this.currentCycleLabel || this.currentCycleKey,
                operationalState: TreeViewOperationalState.REFRESHING,
                metadata: { loadingMessage: loadingTreeItemsMessage }
            });

            operation.throwIfCancelled("before cycle structure fetch in refresh");

            const fetchedCycleStructure = await this.projectDataService.fetchCycleStructure(
                this.currentProjectKey,
                this.currentCycleKey
            );

            operation.throwIfCancelled("after cycle structure fetch in refresh");

            if (fetchedCycleStructure) {
                if (state.isCustomRootActive && !isHardRefresh) {
                    await this.refreshCustomRootTreeItem(fetchedCycleStructure, operation);
                } else {
                    const testThemeTreeItems = this.buildTestThemeTreeFromCycleStructure(fetchedCycleStructure);

                    // Single coordinated update for successful refresh
                    this.getUnifiedStateManager().updateState({
                        hasDataFetchBeenAttempted: true,
                        isServerDataReceived: true,
                        itemsBeforeFiltering: fetchedCycleStructure.nodes?.length || 0,
                        itemsAfterFiltering: testThemeTreeItems.length,
                        operationalState: TreeViewOperationalState.READY
                    });

                    this.updateTreeItem(testThemeTreeItems);
                }
            } else {
                this.getUnifiedStateManager().setError(
                    new Error("Failed to fetch cycle structure"),
                    TreeViewEmptyState.FETCH_ERROR
                );
            }
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                this.logger.debug("[TestThemeTreeDataProvider] Refresh operation cancelled");
                return;
            }

            this.logger.error(`[TestThemeTreeDataProvider] Error during refresh:`, error);
            this.getUnifiedStateManager().setError(error as Error, TreeViewEmptyState.FETCH_ERROR);
        }
    }

    protected override async getRootChildren(): Promise<TestThemeTreeItem[]> {
        const state = this.getUnifiedStateManager().getCurrentUnifiedState();
        if (state.isCustomRootActive && state.customRootItem) {
            this.getUnifiedStateManager().setReady(1);
            return [state.customRootItem as TestThemeTreeItem];
        }
        return super.getRootChildren();
    }

    /**
     * Refreshes the custom root node with updated cycle structure data while preserving expansion state.
     */
    private async refreshCustomRootTreeItem(
        cycleStructure: CycleStructure,
        operation: CancellableOperation
    ): Promise<void> {
        const state = this.getUnifiedStateManager().getCurrentUnifiedState();
        const currentTestThemeRootItem = state.customRootItem as TestThemeTreeItem;
        if (!currentTestThemeRootItem) {
            return;
        }

        operation.throwIfCancelled("before custom root refresh");

        const currentTestThemeRootItemKey = currentTestThemeRootItem.getUniqueId();
        const testThemeTreeItemDataMap = new Map<string, CycleTreeItemData>(); // Map to hold cycle nodes by key
        cycleStructure.nodes.forEach((node) => node?.base?.key && testThemeTreeItemDataMap.set(node.base.key, node));

        const updatedCycleTreeItemData = testThemeTreeItemDataMap.get(currentTestThemeRootItemKey);

        if (updatedCycleTreeItemData) {
            currentTestThemeRootItem.itemData = updatedCycleTreeItemData;
            currentTestThemeRootItem.label = updatedCycleTreeItemData.base.numbering
                ? `${updatedCycleTreeItemData.base.numbering} ${updatedCycleTreeItemData.base.name}`
                : updatedCycleTreeItemData.base.name;
            currentTestThemeRootItem.children = this.buildTestThemeTreeRecursively(
                currentTestThemeRootItemKey,
                currentTestThemeRootItem,
                testThemeTreeItemDataMap
            );
            currentTestThemeRootItem.collapsibleState =
                currentTestThemeRootItem.children.length > 0
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None;

            this.applyStoredExpansionState(currentTestThemeRootItem);
            this.updateTreeItem([currentTestThemeRootItem]);
        } else {
            this.logger.warn(
                `[TestThemeTreeDataProvider] Custom root ${currentTestThemeRootItemKey} not found in refreshed data. Resetting.`
            );
            this.getUnifiedStateManager().resetCustomRoot();
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
