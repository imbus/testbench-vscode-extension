/**
 * @file src/views/testTheme/testThemeTreeDataProvider.ts
 * @description Test theme tree data provider using new architecture
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeDataProvider } from "../common/baseTreeDataProvider";
import { TestThemeTreeItem } from "./testThemeTreeItem";
import { ProjectDataService } from "../../services/projectDataService";
import { MarkedItemStateService } from "../../services/markedItemStateService";
import { IconManagementService } from "../../services/iconManagementService";
import { TreeItemContextValues, ContextKeys } from "../../constants";
import { CycleDataForThemeTreeEvent } from "../projectManagement/projectManagementTreeDataProvider";
import { CycleNodeData, CycleStructure } from "../../testBenchTypes";

export class TestThemeTreeDataProvider extends BaseTreeDataProvider<TestThemeTreeItem> {
    private currentCycleKey: string | null = null;
    private currentProjectKey: string | null = null;
    private currentCycleLabel: string | null = null;

    constructor(
        extensionContext: vscode.ExtensionContext,
        logger: TestBenchLogger,
        updateMessageCallback: (message: string | undefined) => void,
        private readonly projectDataService: ProjectDataService,
        private readonly markedItemStateService: MarkedItemStateService,
        private readonly iconManagementService: IconManagementService
    ) {
        super(extensionContext, logger, updateMessageCallback, {
            contextKey: ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT,
            customRootContextValue: TreeItemContextValues.CUSTOM_ROOT_TEST_THEME,
            enableCustomRoot: true,
            enableExpansionTracking: true
        });

        // Inject services into extension context for tree items
        (this.extensionContext as any).iconManagementService = this.iconManagementService;
        (this.extensionContext as any).markedItemStateService = this.markedItemStateService;
    }

    /**
     * Get current cycle key
     */
    public getCurrentCycleKey(): string | null {
        return this.currentCycleKey;
    }

    /**
     * Get current project key
     */
    public getCurrentProjectKey(): string | null {
        return this.currentProjectKey;
    }

    /**
     * Populate tree from cycle data
     */
    public populateFromCycleData(eventData: CycleDataForThemeTreeEvent): void {
        this.logger.trace(`[TestThemeTreeDataProvider] Populating from cycle data: ${eventData.cycleKey}`);

        this.currentCycleKey = eventData.cycleKey;
        this.currentProjectKey = eventData.projectKey;
        this.currentCycleLabel = eventData.cycleLabel;

        // Reset custom root if active
        if (this.isCustomRootActive()) {
            this.customRootService.resetCustomRoot();
        }

        if (!eventData.rawCycleStructure?.nodes?.length || !eventData.rawCycleStructure.root?.base?.key) {
            this.logger.warn(`[TestThemeTreeDataProvider] Invalid cycle structure for: ${eventData.cycleLabel}`);
            this.updateElements([]);
            return;
        }

        const elements = this.buildTreeFromCycleStructure(eventData.rawCycleStructure);
        this.updateElements(elements);

        // Restore marking state after tree is built
        this.restoreMarkingState();
    }

    /**
     * Fetch root elements - not used directly since we populate from cycle data
     */
    protected async fetchRootElements(): Promise<TestThemeTreeItem[]> {
        if (!this.currentCycleKey || !this.currentProjectKey) {
            this.updateMessageCallback("Select a cycle from the 'Projects' view to see test themes.");
            return [];
        }

        // Fetch fresh cycle structure
        try {
            const cycleStructure = await this.projectDataService.fetchCycleStructure(
                this.currentProjectKey,
                this.currentCycleKey
            );

            if (cycleStructure) {
                return this.buildTreeFromCycleStructure(cycleStructure);
            }
        } catch (error) {
            this.logger.error(`[TestThemeTreeDataProvider] Error fetching cycle structure:`, error);
        }

        return [];
    }

    /**
     * Fetch children for an element
     */
    protected async fetchChildrenForElement(element: TestThemeTreeItem): Promise<TestThemeTreeItem[]> {
        return (element.children as TestThemeTreeItem[]) || [];
    }

    /**
     * Create tree item from cycle node data
     */
    protected createTreeItemFromData(data: CycleNodeData, parent: TestThemeTreeItem | null): TestThemeTreeItem | null {
        if (!data?.base?.key || !data?.base?.name) {
            this.logger.warn("[TestThemeTreeDataProvider] Invalid cycle node data");
            return null;
        }

        const label = data.base.numbering ? `${data.base.numbering} ${data.base.name}` : data.base.name;
        const hasChildren = this.willHaveVisibleChildren(data);
        const collapsibleState = hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        const treeItem = new TestThemeTreeItem(
            label,
            data.elementType,
            collapsibleState,
            data,
            this.extensionContext,
            parent
        );

        // Apply stored expansion state
        this.applyStoredExpansionState(treeItem);

        return treeItem;
    }

    /**
     * Build tree structure from cycle structure
     */
    private buildTreeFromCycleStructure(cycleStructure: CycleStructure): TestThemeTreeItem[] {
        const elementsByKey = new Map<string, CycleNodeData>();

        // Index all nodes by key
        cycleStructure.nodes.forEach((node) => {
            if (node?.base?.key) {
                elementsByKey.set(node.base.key, node);
            }
        });

        if (elementsByKey.size === 0) {
            this.logger.error("[TestThemeTreeDataProvider] No valid nodes found in cycle structure");
            return [];
        }

        const rootCycleKey = cycleStructure.root.base.key;
        return this.buildTreeRecursively(rootCycleKey, null, elementsByKey);
    }

    /**
     * Build tree recursively from cycle data
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
                    // Build children recursively
                    const grandChildren = this.buildTreeRecursively(nodeData.base.key, treeItem, elementsByKey);
                    treeItem.children = grandChildren;

                    // Update collapsible state based on actual children
                    if (grandChildren.length > 0) {
                        treeItem.collapsibleState = this.customRootService.shouldBeExpanded(treeItem.getUniqueId())
                            ? vscode.TreeItemCollapsibleState.Expanded
                            : vscode.TreeItemCollapsibleState.Collapsed;
                    } else {
                        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
                    }

                    children.push(treeItem);
                }
            }
        }

        return children;
    }

    /**
     * Check if a cycle node should be visible in test theme tree
     */
    private isNodeVisibleInTestThemeTree(nodeData: CycleNodeData): boolean {
        // Exclude test cases
        if (nodeData.elementType === TreeItemContextValues.TEST_CASE_NODE) {
            return false;
        }

        // Filter out non-executable elements and system-locked elements
        if (nodeData.exec?.status === "NotPlanned" || nodeData.exec?.locker === "-2") {
            return false;
        }

        return true;
    }

    /**
     * Check if a node will have visible children
     */
    private willHaveVisibleChildren(nodeData: CycleNodeData): boolean {
        // This would require checking the full cycle structure
        // For now, assume theme nodes and case set nodes can have children
        return (
            nodeData.elementType === TreeItemContextValues.TEST_THEME_NODE ||
            nodeData.elementType === TreeItemContextValues.TEST_CASE_SET_NODE
        );
    }

    /**
     * Mark an item as generated
     */
    public async markItemAsGenerated(item: TestThemeTreeItem): Promise<void> {
        if (!item.canGenerateTests()) {
            this.logger.warn(`[TestThemeTreeDataProvider] Item cannot be marked for generation: ${item.label}`);
            return;
        }

        const itemKey = item.getUniqueId();
        const itemUID = item.getUID();

        if (!itemKey || !itemUID) {
            this.logger.error(`[TestThemeTreeDataProvider] Missing key or UID for item: ${item.label}`);
            return;
        }

        try {
            // Clear previous markings
            await this.markedItemStateService.clearMarking();

            // Get descendant information
            const descendantUIDs = item.getDescendantUIDs();
            const descendantKeysWithUIDs = item.getDescendantKeysWithUIDs();

            // Mark the item and its descendants
            await this.markedItemStateService.markItem(
                itemKey,
                itemUID,
                item.originalContextValue,
                true, // isDirectlyGenerated
                descendantUIDs,
                descendantKeysWithUIDs
            );

            // Update UI state for all visible items
            this.updateTreeItemsMarkingRecursive(this.rootElements);

            this.logger.info(`[TestThemeTreeDataProvider] Marked item as generated: ${item.label}`);
            this._onDidChangeTreeData.fire(undefined);
        } catch (error) {
            this.logger.error(`[TestThemeTreeDataProvider] Error marking item as generated:`, error);
        }
    }

    /**
     * Clear marked status for an item
     */
    public async clearMarkedItemStatus(item?: TestThemeTreeItem): Promise<void> {
        const itemKey = item ? item.getUniqueId() : undefined;

        try {
            await this.markedItemStateService.clearMarking(itemKey);
            this.updateTreeItemsMarkingRecursive(this.rootElements);

            this.logger.info(`[TestThemeTreeDataProvider] Cleared marked status for: ${item?.label || "all items"}`);
            this._onDidChangeTreeData.fire(undefined);
        } catch (error) {
            this.logger.error(`[TestThemeTreeDataProvider] Error clearing marked status:`, error);
        }
    }

    /**
     * Get report root UID for an item
     */
    public getReportRootUIDForItem(item: TestThemeTreeItem): string | undefined {
        const itemKey = item.getUniqueId();
        const itemUID = item.getUID();

        if (!itemKey || !itemUID) {
            return undefined;
        }

        return this.markedItemStateService.getReportRootUID(itemKey, itemUID);
    }

    /**
     * Restore marking state for visible items
     */
    private restoreMarkingState(): void {
        this.updateTreeItemsMarkingRecursive(this.rootElements);
    }

    /**
     * Update marking state recursively for tree items
     */
    private updateTreeItemsMarkingRecursive(items: TestThemeTreeItem[]): void {
        for (const item of items) {
            const itemKey = item.getUniqueId();
            const itemUID = item.getUID();

            if (itemKey && itemUID) {
                const importState = this.markedItemStateService.getItemImportState(itemKey, itemUID);
                item.updateContextForMarking(importState.shouldShow);
            }

            if (item.children) {
                this.updateTreeItemsMarkingRecursive(item.children as TestThemeTreeItem[]);
            }
        }
    }

    /**
     * Clear tree and reset state
     */
    public clearTree(): void {
        this.currentCycleKey = null;
        this.currentProjectKey = null;
        this.currentCycleLabel = null;

        super.clearTree();
        this.updateMessageCallback("Select a cycle from the 'Projects' view to see test themes.");
    }

    /**
     * Override refresh to handle cycle data refresh
     */
    public async refresh(isHardRefresh: boolean = false): Promise<void> {
        this.logger.debug(`[TestThemeTreeDataProvider] Refreshing. Hard refresh: ${isHardRefresh}`);

        if (isHardRefresh && this.isCustomRootActive()) {
            this.customRootService.handleHardRefresh();
        }

        if (!this.currentCycleKey || !this.currentProjectKey) {
            this.clearTree();
            return;
        }

        try {
            // Store expansion state
            this.storeExpansionState();

            // Show loading message
            const loadingMessage =
                this.isCustomRootActive() && this.getCurrentCustomRoot()
                    ? `Refreshing: ${this.getCurrentCustomRoot()?.label}...`
                    : `Loading test themes for cycle: ${this.currentCycleLabel || this.currentCycleKey}...`;

            this.updateMessageCallback(loadingMessage);

            // Fetch fresh data
            const cycleStructure = await this.projectDataService.fetchCycleStructure(
                this.currentProjectKey,
                this.currentCycleKey
            );

            if (cycleStructure) {
                if (this.isCustomRootActive() && !isHardRefresh) {
                    // Handle custom root refresh
                    await this.refreshCustomRoot(cycleStructure);
                } else {
                    // Normal refresh
                    const elements = this.buildTreeFromCycleStructure(cycleStructure);
                    this.updateElements(elements);
                    this.restoreMarkingState();
                }
            } else {
                this.updateElements([]);
            }
        } catch (error) {
            this.logger.error(`[TestThemeTreeDataProvider] Error during refresh:`, error);
            this.updateMessageCallback(`Error loading themes for ${this.currentCycleLabel || this.currentCycleKey}.`);
        }
    }

    /**
     * Refresh custom root with updated data
     */
    private async refreshCustomRoot(cycleStructure: CycleStructure): Promise<void> {
        const currentRoot = this.getCurrentCustomRoot();
        if (!currentRoot) {
            return;
        }

        // Find updated data for current root
        const currentRootKey = currentRoot.getUniqueId();
        const updatedNodeData = cycleStructure.nodes.find((node) => node.base.key === currentRootKey);

        if (updatedNodeData) {
            // Update root item data
            currentRoot.itemData = updatedNodeData;

            // Update label if changed
            const newLabel = updatedNodeData.base.numbering
                ? `${updatedNodeData.base.numbering} ${updatedNodeData.base.name}`
                : updatedNodeData.base.name;
            currentRoot.label = newLabel;

            // Rebuild children
            const elementsByKey = new Map<string, CycleNodeData>();
            cycleStructure.nodes.forEach((node) => {
                if (node?.base?.key) {
                    elementsByKey.set(node.base.key, node);
                }
            });

            currentRoot.children = this.buildTreeRecursively(currentRootKey, currentRoot, elementsByKey);

            // Update collapsible state
            currentRoot.collapsibleState =
                currentRoot.children.length > 0
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None;

            this.rootElements = [currentRoot];
            this.restoreMarkingState();
            this._onDidChangeTreeData.fire(currentRoot);
        } else {
            this.logger.warn(
                `[TestThemeTreeDataProvider] Custom root not found in refreshed data. Resetting to full view.`
            );
            this.customRootService.resetCustomRoot();
            const elements = this.buildTreeFromCycleStructure(cycleStructure);
            this.updateElements(elements);
            this.restoreMarkingState();
        }
    }
}
