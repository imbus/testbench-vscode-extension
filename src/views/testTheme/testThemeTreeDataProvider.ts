/**
 * @file src/views/testTheme/testThemeTreeDataProvider.ts
 * @description Test theme tree data provider using unified state management
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
import { StateChangeNotification } from "../../services/unifiedTreeStateManager";

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
            if (state.customRootActive) {
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
        if (state.customRootActive) {
            this.getUnifiedStateManager().resetCustomRoot();
        }

        this.storeExpansionState();

        if (!eventData.rawCycleStructure?.nodes?.length || !eventData.rawCycleStructure.root?.base?.key) {
            this.logger.warn(`[TestThemeTreeDataProvider] Invalid cycle structure for: ${eventData.cycleLabel}`);
            this.updateElements([]);
            this.getUnifiedStateManager().setError(
                new Error("Invalid cycle structure"),
                TreeViewEmptyState.PROCESSING_ERROR
            );
            return;
        }

        try {
            const elements = this.buildTreeFromCycleStructure(eventData.rawCycleStructure);

            // Coordinated state update for successful population
            this.getUnifiedStateManager().updateState({
                dataFetchAttempted: true,
                serverDataReceived: true,
                itemsBeforeFiltering: eventData.rawCycleStructure.nodes.length,
                itemsAfterFiltering: elements.length,
                operationalState:
                    elements.length === 0 ? TreeViewOperationalState.EMPTY : TreeViewOperationalState.READY,
                emptyState: elements.length === 0 ? TreeViewEmptyState.SERVER_NO_DATA : undefined
            });

            this.updateElements(elements);
        } catch (error) {
            this.logger.error(`[TestThemeTreeDataProvider] Error building tree from cycle structure:`, error);
            this.getUnifiedStateManager().setError(error as Error, TreeViewEmptyState.PROCESSING_ERROR);
        }
    }

    protected async fetchRootElements(): Promise<TestThemeTreeItem[]> {
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
                const newRootElements = this.buildTreeFromCycleStructure(cycleStructure);

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

                // Single coordinated state update for successful fetch
                this.getUnifiedStateManager().updateState({
                    dataFetchAttempted: true,
                    serverDataReceived: true,
                    itemsBeforeFiltering: cycleStructure.nodes?.length || 0,
                    itemsAfterFiltering: newRootElements.length,
                    operationalState:
                        newRootElements.length === 0 ? TreeViewOperationalState.EMPTY : TreeViewOperationalState.READY,
                    emptyState: newRootElements.length === 0 ? TreeViewEmptyState.SERVER_NO_DATA : undefined
                });

                return newRootElements;
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
    protected async fetchChildrenForElement(element: TestThemeTreeItem): Promise<TestThemeTreeItem[]> {
        return (element.children as TestThemeTreeItem[]) || [];
    }

    /**
     * Creates a TestThemeTreeItem from cycle node data with proper validation and state management.
     */
    protected createTreeItemFromData(data: CycleNodeData, parent: TestThemeTreeItem | null): TestThemeTreeItem | null {
        if (!data?.base?.key || !data?.base?.name) {
            this.logger.warn("[TestThemeTreeDataProvider] Invalid cycle node data for tree item creation:", data);
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
     */
    private getRawNodesFromCurrentRoot(): CycleNodeData[] {
        const state = this.getUnifiedStateManager().getCurrentUnifiedState();
        const activeRoot = state.customRootActive
            ? state.customRootItem?.itemData
            : (this.rootElements[0]?.itemData as CycleNodeData);

        if (activeRoot && activeRoot.nodes) {
            return activeRoot.nodes;
        }

        if (this.rootElements.length > 0 && this.rootElements[0]?.itemData?.parentCycleStructure?.nodes) {
            return this.rootElements[0].itemData.parentCycleStructure.nodes;
        }

        this.logger.warn(
            "[TestThemeTreeDataProvider] Cannot get raw nodes for child check, full structure not readily available."
        );
        return [];
    }

    /**
     * Determines if a node will have any visible children in the test theme tree.
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
     */
    private buildTreeFromCycleStructure(cycleStructure: CycleStructure): TestThemeTreeItem[] {
        const elementsByKey = new Map<string, CycleNodeData>();
        cycleStructure.nodes.forEach((node) => {
            if (node?.base?.key) {
                elementsByKey.set(node.base.key, node);
            }
        });

        if (elementsByKey.size === 0 && cycleStructure.nodes.length > 0) {
            this.logger.error("[TestThemeTreeDataProvider] No nodes with base.key found in cycle structure.");
            return [];
        }
        const rootCycleKey = cycleStructure.root.base.key;
        return this.buildTreeRecursively(rootCycleKey, null, elementsByKey);
    }

    /**
     * Recursively builds a tree structure from flat node data.
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
     */
    public getReportRootUIDForItem(item: TestThemeTreeItem): string | undefined {
        const itemKey = item.getUniqueId();
        const itemUID = item.getUID();
        return itemKey && itemUID ? this.markedItemStateService.getReportRootUID(itemKey, itemUID) : undefined;
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
            const loadingMessage =
                state.customRootActive && state.customRootItem
                    ? `Refreshing: ${state.customRootItem.label}...`
                    : `Refreshing test themes for cycle: ${this.currentCycleLabel || this.currentCycleKey}...`;

            this.getUnifiedStateManager().updateState({
                dataSourceKey: this.currentCycleKey,
                dataSourceLabel: this.currentCycleLabel || this.currentCycleKey,
                operationalState: TreeViewOperationalState.REFRESHING,
                metadata: { loadingMessage }
            });

            operation.throwIfCancelled("before cycle structure fetch in refresh");

            const cycleStructure = await this.projectDataService.fetchCycleStructure(
                this.currentProjectKey,
                this.currentCycleKey
            );

            operation.throwIfCancelled("after cycle structure fetch in refresh");

            if (cycleStructure) {
                if (state.customRootActive && !isHardRefresh) {
                    await this.refreshCustomRootNode(cycleStructure, operation);
                } else {
                    const elements = this.buildTreeFromCycleStructure(cycleStructure);

                    // Single coordinated update for successful refresh
                    this.getUnifiedStateManager().updateState({
                        dataFetchAttempted: true,
                        serverDataReceived: true,
                        itemsBeforeFiltering: cycleStructure.nodes?.length || 0,
                        itemsAfterFiltering: elements.length,
                        operationalState: TreeViewOperationalState.READY
                    });

                    this.updateElements(elements);
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

    /**
     * Refreshes the custom root node with updated cycle structure data while preserving expansion state.
     */
    private async refreshCustomRootNode(
        cycleStructure: CycleStructure,
        operation: CancellableOperation
    ): Promise<void> {
        const state = this.getUnifiedStateManager().getCurrentUnifiedState();
        const currentRoot = state.customRootItem as TestThemeTreeItem;
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
            this.logger.warn(
                `[TestThemeTreeDataProvider] Custom root ${currentRootKey} not found in refreshed data. Resetting.`
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
