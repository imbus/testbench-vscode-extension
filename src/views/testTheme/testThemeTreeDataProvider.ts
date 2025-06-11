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
import { ContextKeys, StorageKeys, testThemeTreeViewID, TreeItemContextValues } from "../../constants";
import { CycleTreeItemData, TestStructure } from "../../testBenchTypes";
import { DataForThemeTreeEvent } from "../projectManagement/projectManagementTreeDataProvider";
import { IconManagementService } from "../common/iconManagementService";
import { TreeViewType, TreeViewEmptyState, TreeViewOperationalState } from "../common/treeViewStateTypes";
import { CancellableOperation, CancellableOperationManager } from "../../services/cancellableOperationService";
import { StateChangeNotification } from "../common/unifiedTreeStateManager";
import { SerializedCustomRootState } from "../common/customRootService";

export class TestThemeTreeDataProvider extends BaseTreeDataProvider<TestThemeTreeItem> {
    private currentCycleKey: string | null = null;
    private currentProjectKey: string | null = null;
    private currentCycleLabel: string | null = null;
    private readonly iconService: IconManagementService;
    private readonly operationManager: CancellableOperationManager;
    private rawCycleData: TestStructure | null = null;
    public isTestThemeOpenedFromACycle: boolean = false;
    private isInitialLoad: boolean = true;

    // Operation IDs
    private static readonly FETCH_CYCLE_STRUCTURE_OPERATION = "fetchCycleStructure";

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
                treeViewId: testThemeTreeViewID,
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
     * Overrides the base makeRoot to ensure the item's marked status is correctly
     * applied when it becomes a custom root.
     */
    public override makeRoot(item: TestThemeTreeItem): void {
        super.makeRoot(item);

        const itemKey = item.getUniqueId();
        const itemUID = item.getUID();

        if (itemKey && itemUID) {
            const importState = this.markedItemStateService.getItemImportState(
                itemKey,
                itemUID,
                this.currentProjectKey,
                this.currentCycleKey
            );

            item.updateContextForMarking(importState.shouldShow);
        }
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

    protected getCustomRootStorageKey(): string {
        return StorageKeys.CUSTOM_ROOT_TEST_THEME_TREE;
    }

    protected getCurrentContextData(): any {
        return {
            projectKey: this.currentProjectKey,
            cycleKey: this.currentCycleKey
        };
    }

    protected isCustomRootContextValid(savedState: SerializedCustomRootState): boolean {
        if (this.pendingCustomRootRestore && this.currentProjectKey === null && this.currentCycleKey === null) {
            return true;
        }

        return (
            savedState.contextData?.projectKey === this.currentProjectKey &&
            savedState.contextData?.cycleKey === this.currentCycleKey
        );
    }

    public getCurrentCycleKey(): string | null {
        return this.currentCycleKey;
    }

    public getCurrentProjectKey(): string | null {
        return this.currentProjectKey;
    }

    /**
     * Override updateTreeItem to handle custom root restoration after context is set
     */
    protected updateTreeItem(treeItems: TestThemeTreeItem[]): void {
        // Call parent implementation
        super.updateTreeItem(treeItems);

        // If we still have pending custom root and context is now set, try restoration
        if (
            this.pendingCustomRootRestore &&
            this.currentProjectKey !== null &&
            this.currentCycleKey !== null &&
            treeItems.length > 0
        ) {
            // Re-validate with current context
            if (this.isCustomRootContextValid(this.pendingCustomRootRestore)) {
                setTimeout(() => {
                    this.tryRestoreCustomRoot();
                }, 200); // Slightly longer delay for test theme tree
            } else {
                this.logger.info(
                    "[TestThemeTreeDataProvider] Custom root context doesn't match current context, clearing pending restore"
                );
                this.pendingCustomRootRestore = null;
                this.saveCustomRootState();
            }
        }
    }

    /**
     * Populates the tree data provider with cycle data from the provided event.
     * Preserves custom root if we're in the same cycle context.
     */
    public loadTestThemesDataFromCycleData(eventData: DataForThemeTreeEvent): void {
        this.logger.trace(`[TestThemeTreeDataProvider] Populating from cycle data: ${eventData.key}`);
        this.isTestThemeOpenedFromACycle = true;
        this.rawCycleData = eventData.rawTestStructure;

        const isContextChanging = this.isInitialLoad
            ? false
            : this.currentCycleKey !== eventData.key || this.currentProjectKey !== eventData.projectKey;

        const hasPendingCustomRootForThisContext =
            this.pendingCustomRootRestore &&
            this.pendingCustomRootRestore.contextData?.projectKey === eventData.projectKey &&
            this.pendingCustomRootRestore.contextData?.cycleKey === eventData.key;

        // Set context and loading state
        this.getUnifiedStateManager().updateState({
            dataSourceKey: eventData.key,
            dataSourceLabel: eventData.label,
            dataSourceDisplayName: eventData.label,
            operationalState: TreeViewOperationalState.LOADING
        });
        this.currentCycleKey = eventData.key;
        this.currentProjectKey = eventData.projectKey;
        this.currentCycleLabel = eventData.label;
        this.isInitialLoad = false;

        // Validate data
        if (!eventData.rawTestStructure?.nodes?.length || !eventData.rawTestStructure.root?.base?.key) {
            this.logger.warn(`[TestThemeTreeDataProvider] Invalid cycle structure for: ${eventData.label}`);
            this.updateTreeItem([]);
            this.getUnifiedStateManager().setError(
                new Error("Invalid cycle structure"),
                TreeViewEmptyState.PROCESSING_ERROR
            );
            return;
        }

        const currentState = this.getUnifiedStateManager().getCurrentUnifiedState();

        if (isContextChanging && !hasPendingCustomRootForThisContext) {
            // Context is changing, so reset any existing custom root from a different context
            if (currentState.isCustomRootActive) {
                this.logger.info("[TestThemeTreeDataProvider] Context changed, resetting custom root");
                this.getUnifiedStateManager().resetCustomRoot();
                this.pendingCustomRootRestore = null;
            }
        }

        // If a custom root is active and we are not changing context, use the non destructive refresh
        if (currentState.isCustomRootActive && !isContextChanging) {
            this.logger.debug(
                `[TestThemeTreeDataProvider] Repopulating with active custom root. Using non-destructive refresh.`
            );
            const operation = this.operationManager.createOperation(
                "populateCustomRoot",
                `Populate custom root: ${currentState.customRootItem?.label}`
            );
            try {
                this.refreshCustomRootTreeItem(eventData.rawTestStructure, operation);
            } catch (error) {
                this.logger.error(`[TestThemeTreeDataProvider] Error during custom root repopulation:`, error);
                this.getUnifiedStateManager().setError(error as Error, TreeViewEmptyState.PROCESSING_ERROR);
            } finally {
                operation.dispose();
            }
            return;
        }

        // Perform full/destructive rebuild for new contexts or if no custom root is active
        this.logger.debug("[TestThemeTreeDataProvider] Performing full tree rebuild.");
        this.storeExpansionState();

        try {
            const testThemeTreeItems = this.buildTestThemeTreeFromCycleStructure(eventData.rawTestStructure);
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

            const cycleStructureFromServer = await this.projectDataService.fetchTestStructureUsingProjectAndCycleKey(
                this.currentProjectKey,
                this.currentCycleKey
            );

            operation.throwIfCancelled("after cycle structure fetch");

            if (cycleStructureFromServer) {
                const builtRootTestThemeTreeItems = this.buildTestThemeTreeFromCycleStructure(cycleStructureFromServer);

                const applyExpansionRecursive = (items: TestThemeTreeItem[]) => {
                    for (const item of items) {
                        this.applyStoredExpansionState(item);
                        if (item.children) {
                            applyExpansionRecursive(item.children as TestThemeTreeItem[]);
                        }
                    }
                };
                applyExpansionRecursive(builtRootTestThemeTreeItems);
                this.rootTreeItems = builtRootTestThemeTreeItems;

                // Single coordinated state update for successful fetch
                this.getUnifiedStateManager().updateState({
                    hasDataFetchBeenAttempted: true,
                    isServerDataReceived: true,
                    itemsBeforeFiltering: cycleStructureFromServer.nodes?.length || 0,
                    itemsAfterFiltering: builtRootTestThemeTreeItems.length,
                    operationalState:
                        builtRootTestThemeTreeItems.length === 0
                            ? TreeViewOperationalState.EMPTY
                            : TreeViewOperationalState.READY,
                    emptyState: builtRootTestThemeTreeItems.length === 0 ? TreeViewEmptyState.SERVER_NO_DATA : undefined
                });

                return builtRootTestThemeTreeItems;
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

        // Default to collapsed. The recursive build function will set the final state.
        const collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

        const testThemeTreeItem = new TestThemeTreeItem(
            testThemeLabel,
            data.elementType,
            collapsibleState,
            data,
            this.extensionContext,
            this.logger,
            this.iconService,
            parent
        );

        // Apply the restored expansion state to the newly created item.
        this.applyStoredExpansionState(testThemeTreeItem);

        const itemKey = testThemeTreeItem.getUniqueId();
        const itemUID = testThemeTreeItem.getUID();
        if (itemKey && itemUID) {
            const importState = this.markedItemStateService.getItemImportState(
                itemKey,
                itemUID,
                this.currentProjectKey,
                this.currentCycleKey
            );
            testThemeTreeItem.updateContextForMarking(importState.shouldShow);
        }

        return testThemeTreeItem;
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
    private buildTestThemeTreeFromCycleStructure(cycleStructure: TestStructure): TestThemeTreeItem[] {
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

                    // Set the final state based on whether children exist.
                    if (grandChildrenOfTestThemeTreeItem.length > 0) {
                        testThemeTreeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                    } else {
                        testThemeTreeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
                    }

                    // after setting the default state, apply the stored expansion state to override it if necessary.
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
            ? this.markedItemStateService.getReportRootUID(
                  testThemeTreeItemKey,
                  testThemeTreeItemUID,
                  this.currentProjectKey,
                  this.currentCycleKey
              )
            : undefined;
    }

    /**
     * Clears the test theme tree and resets all current state variables.
     * Uses unified state management for coordinated clearing.
     */
    public override clearTree(): void {
        this.isInitialLoad = true;
        super.clearTree();
        this.logger.trace("[TestThemeTreeDataProvider] Tree cleared with unified state management.");
    }

    /**
     * Refreshes the Test Theme tree view.
     * This method re-fetches the cycle structure, rebuilds the tree,
     * and ensures the custom root state is correctly restored if it was active.
     * @param isHardRefresh If true, forces a full reset including custom root.
     */
    public override async refresh(isHardRefresh: boolean = false): Promise<void> {
        const operationId = "refreshTestThemes";
        this.logger.debug(`[TestThemeTreeDataProvider] Refreshing. Hard refresh: ${isHardRefresh}`);
        this.operationManager.cancelOperation(operationId);
        const operation = this.operationManager.createOperation(operationId, "Refresh test themes");

        if (isHardRefresh) {
            this.getUnifiedStateManager().resetCustomRoot();
        }

        // Check if custom root is active before proceeding
        const isCustomRootActive = this.isCustomRootActive();
        const activeCustomRootId = isCustomRootActive ? this.getCurrentCustomRoot()?.getUniqueId() : null;

        // Store expansion state unless we are doing a hard refresh that clears the custom root
        if (!(isHardRefresh && isCustomRootActive)) {
            this.storeExpansionState();
        }

        // Set the view to a refreshing state
        this.updateTreeState({
            operationalState: TreeViewOperationalState.REFRESHING
        });
        try {
            const projectKey = this.getCurrentProjectKey();
            const dataSourceKey = this.getCurrentCycleKey();

            if (!projectKey || !dataSourceKey) {
                this.logger.warn(
                    "[TestThemeTreeDataProvider] Refresh called but no active project/dataSource key. Clearing tree."
                );
                this.clearTree();
                return;
            }

            operation.throwIfCancelled("before fetching data structure");

            let cycleStructure: TestStructure | null;
            if (this.isTestThemeOpenedFromACycle) {
                this.logger.debug(`Refreshing with Cycle key: ${dataSourceKey}`);
                cycleStructure = await this.projectDataService.fetchTestStructureUsingProjectAndCycleKey(
                    projectKey,
                    dataSourceKey
                );
            } else {
                this.logger.debug(`Refreshing with TOV key: ${dataSourceKey}`);
                cycleStructure = await this.projectDataService.fetchTestStructureUsingProjectAndTOVKey(
                    projectKey,
                    dataSourceKey
                );
            }

            operation.throwIfCancelled("after fetching data structure");

            if (!cycleStructure) {
                this.logger.warn("[TestThemeTreeDataProvider] No data structure returned during refresh");
                this.setErrorState(new Error("Failed to fetch data structure"), TreeViewEmptyState.FETCH_ERROR);
                return;
            }

            // This condition will now be correctly false after a hard refresh
            if (isCustomRootActive && activeCustomRootId && !isHardRefresh) {
                this.logger.debug(
                    `[TestThemeTreeDataProvider] Refreshing with custom root: ${this.getCurrentCustomRoot()?.label}`
                );
                await this.refreshCustomRootTreeItem(cycleStructure, operation);
            } else {
                // This block will now correctly execute on a reset.
                const newItems = this.buildTestThemeTreeFromCycleStructure(cycleStructure);
                this.updateTreeItem(newItems);

                // Apply expansion state to new items
                const applyExpansionRecursive = (items: TestThemeTreeItem[]) => {
                    for (const item of items) {
                        this.applyStoredExpansionState(item);
                        if (item.children) {
                            applyExpansionRecursive(item.children as TestThemeTreeItem[]);
                        }
                    }
                };
                applyExpansionRecursive(newItems);
            }

            this.logger.info("Test Theme Tree view refresh completed successfully.");
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                this.logger.info("[TestThemeTreeDataProvider] Refresh operation was cancelled.");
                // Reset to a stable state if cancelled during fetch
                if (this.rootTreeItems.length === 0) {
                    this.updateTreeState({
                        operationalState: TreeViewOperationalState.EMPTY,
                        emptyState: TreeViewEmptyState.NO_DATA_SOURCE
                    });
                }
            } else {
                this.logger.error("[TestThemeTreeDataProvider] Error during refresh:", error);
                this.setErrorState(error as Error, TreeViewEmptyState.FETCH_ERROR);
            }
        } finally {
            operation.dispose();
        }
    }

    /**
     * Reset custom root and restore the full tree view by performing a hard refresh.
     */
    public override async resetCustomRoot(): Promise<void> {
        this.logger.debug("[TestThemeTreeDataProvider] Resetting custom root via hard refresh.");
        await this.refresh(true);
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
        cycleStructure: TestStructure,
        operation: CancellableOperation
    ): Promise<void> {
        const state = this.unifiedStateManager.getCurrentUnifiedState();
        const currentTestThemeRootItem = state.customRootItem as TestThemeTreeItem;
        if (!currentTestThemeRootItem) {
            return;
        }

        operation.throwIfCancelled("before custom root refresh");

        // Store parent chain expansion state
        const parentsToKeepExpanded: string[] = [];
        let parent = currentTestThemeRootItem.parent as TestThemeTreeItem | null;
        while (parent) {
            parentsToKeepExpanded.push(parent.getUniqueId());
            parent = parent.parent as TestThemeTreeItem | null;
        }

        const currentTestThemeRootItemKey = currentTestThemeRootItem.getUniqueId();
        const testThemeTreeItemDataMap = new Map<string, CycleTreeItemData>();
        cycleStructure.nodes.forEach((node) => node?.base?.key && testThemeTreeItemDataMap.set(node.base.key, node));

        const updatedCycleTreeItemData = testThemeTreeItemDataMap.get(currentTestThemeRootItemKey);
        if (updatedCycleTreeItemData) {
            // Dispose existing children before rebuilding
            if (currentTestThemeRootItem.children) {
                currentTestThemeRootItem.children.forEach((child) => {
                    try {
                        if (child && typeof child.dispose === "function") {
                            child.dispose();
                        }
                    } catch (error) {
                        this.logger.error(
                            `[TestThemeTreeDataProvider] Error disposing child during custom root refresh:`,
                            error
                        );
                    }
                });
            }

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

            // After rebuilding, ensure parent chain remains expanded
            if (parentsToKeepExpanded.length > 0) {
                const currentExpanded = new Set(this.unifiedStateManager.getCurrentUnifiedState().expandedItems);
                parentsToKeepExpanded.forEach((id) => currentExpanded.add(id));
                this.unifiedStateManager.updateState({ expandedItems: currentExpanded });
            }

            // Re-apply marked state for the root item itself
            const rootKey = currentTestThemeRootItem.getUniqueId();
            const rootUID = currentTestThemeRootItem.getUID();
            if (rootKey && rootUID) {
                const importState = this.markedItemStateService.getItemImportState(
                    rootKey,
                    rootUID,
                    this.currentProjectKey,
                    this.currentCycleKey
                );
                currentTestThemeRootItem.updateContextForMarking(importState.shouldShow);
            }

            // Update the root tree items array directly without calling updateTreeItem
            // This preserves the custom root item without disposing it
            this.rootTreeItems = [currentTestThemeRootItem];

            this.getUnifiedStateManager().updateState({
                hasDataFetchBeenAttempted: true,
                isServerDataReceived: true,
                itemsBeforeFiltering: cycleStructure.nodes?.length || 0,
                itemsAfterFiltering: 1, // Custom root counts as 1 item
                operationalState: TreeViewOperationalState.READY
            });

            this._onDidChangeTreeData.fire(undefined);

            this.logger.debug(
                `[TestThemeTreeDataProvider] Custom root refreshed successfully with ${currentTestThemeRootItem.children.length} children`
            );
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
