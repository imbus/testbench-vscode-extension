/**
 * @file src/views/common/baseTreeDataProvider.ts
 * @description Base class for VS Code TreeDataProviders
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeItem as BaseTreeItem } from "./baseTreeItem";
import { UnifiedTreeStateManager, StateChangeNotification } from "./unifiedTreeStateManager";
import {
    TreeViewStateConfig,
    TreeViewEmptyState,
    TreeViewOperationalState,
    StateUpdateParams
} from "./treeViewStateTypes";
import { debounce } from "../../utils";
import { SerializedCustomRootState } from "./customRootService";

export interface TreeDataProviderOptions {
    contextKey: string;
    customRootContextValue: string;
    enableCustomRoot?: boolean;
    enableExpansionTracking?: boolean;
    stateConfig?: TreeViewStateConfig;
}

export abstract class BaseTreeDataProvider<T extends BaseTreeItem>
    implements vscode.TreeDataProvider<T>, vscode.Disposable
{
    public _onDidChangeTreeData: vscode.EventEmitter<T | T[] | undefined | void> = new vscode.EventEmitter<
        T | T[] | undefined | void
    >();
    public readonly onDidChangeTreeData: vscode.Event<T | T[] | undefined | void> = this._onDidChangeTreeData.event;

    protected rootTreeItems: T[] = [];
    protected unifiedStateManager: UnifiedTreeStateManager<T>;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly storageKey: string;
    private readonly debouncedPersistExpansionState: () => void;
    public pendingCustomRootRestore: SerializedCustomRootState | null = null;

    constructor(
        protected readonly extensionContext: vscode.ExtensionContext,
        protected readonly logger: TestBenchLogger,
        protected updateMessageCallback: (message: string | undefined) => void,
        protected readonly options: TreeDataProviderOptions
    ) {
        const stateConfig = options.stateConfig || {
            treeViewId: options.contextKey,
            treeViewType: "project_management" as any
        };

        this.storageKey = `testbench.expandedItems.${stateConfig.treeViewId}`;

        // Debounce the persistence function to avoid excessive writes on frequent UI interactions.
        this.debouncedPersistExpansionState = debounce(() => this.persistExpansionState(), 500);

        this.unifiedStateManager = new UnifiedTreeStateManager<T>(
            logger,
            stateConfig,
            updateMessageCallback,
            options.contextKey,
            options.customRootContextValue,
            (state) => this.onCustomRootStateChange(state)
        );

        // Register for state change notifications
        this.unifiedStateManager.onStateChange((notification) => this.onUnifiedStateChange(notification));

        this._disposables.push(this._onDidChangeTreeData);
        this._disposables.push(this.unifiedStateManager);

        this.loadExpansionState();

        if (this.options.enableCustomRoot) {
            this.loadCustomRootState();
        }

        this.logger.trace("[BaseTreeDataProvider] Initialized with unified state management");
    }

    /**
     * Get the storage key for custom root state based on tree type
     */
    protected abstract getCustomRootStorageKey(): string;

    /**
     * Load custom root state from storage
     */
    private loadCustomRootState(): void {
        try {
            const storageKey = this.getCustomRootStorageKey();
            const savedState = this.extensionContext.workspaceState.get<SerializedCustomRootState>(storageKey);

            if (savedState && savedState.isActive && savedState.rootItemId) {
                this.pendingCustomRootRestore = savedState;
                this.logger.info(
                    `[BaseTreeDataProvider] Loaded custom root state for restoration: ${savedState.rootItemLabel}`
                );
            }
        } catch (error) {
            this.logger.error("[BaseTreeDataProvider] Error loading custom root state:", error);
        }
    }

    /**
     * Save custom root state to storage
     */
    protected saveCustomRootState(): void {
        if (!this.options.enableCustomRoot) {
            return;
        }

        try {
            const storageKey = this.getCustomRootStorageKey();
            const customRootService = this.unifiedStateManager.getCustomRootService();
            const state = customRootService.serialize();

            state.contextData = this.getCurrentContextData();

            this.extensionContext.workspaceState.update(storageKey, state);
            this.logger.trace(
                `[BaseTreeDataProvider] Saved custom root state with context: ${state.isActive ? state.rootItemLabel : "none"}`
            );
        } catch (error) {
            this.logger.error("[BaseTreeDataProvider] Error saving custom root state:", error);
        }
    }

    /**
     * Check if the current context matches the saved custom root context
     */
    protected isCustomRootContextValid(savedState: SerializedCustomRootState): boolean {
        // Default implementation. Overridden by subclasses.
        this.logger.trace(
            `[BaseTreeDataProvider] Checking custom root context validity for saved state: ${savedState.rootItemLabel}`
        );
        return true;
    }

    /**
     * Get current context data for saving with custom root
     */
    protected getCurrentContextData(): any {
        // Default implementation. Overridden by subclasses.
        return {};
    }

    /**
     * Try to restore custom root after tree items are loaded
     */
    protected tryRestoreCustomRoot(): void {
        if (!this.pendingCustomRootRestore || !this.pendingCustomRootRestore.isActive) {
            return;
        }

        const { rootItemId, rootItemLabel } = this.pendingCustomRootRestore;

        if (!rootItemId) {
            this.logger.warn("[BaseTreeDataProvider] No root item ID in pending restore state");
            this.pendingCustomRootRestore = null;
            return;
        }

        const item = this.findItemById(rootItemId);

        if (item && !item.isDisposed) {
            this.logger.info(`[BaseTreeDataProvider] Restoring custom root: ${item.label} (${rootItemId})`);

            const customRootService = this.unifiedStateManager.getCustomRootService();
            customRootService.prepareForRestoration(this.pendingCustomRootRestore);
            this.makeRoot(item);
            this.pendingCustomRootRestore = null;
        } else {
            this.logger.warn(
                `[BaseTreeDataProvider] Could not find valid item to restore as custom root: ${rootItemLabel} (${rootItemId})`
            );

            this.pendingCustomRootRestore = null;
            this.saveCustomRootState();
        }
    }

    /**
     * Loads the expansion state from workspace storage and applies it to the state manager.
     */
    private loadExpansionState(): void {
        try {
            const expandedIds = this.extensionContext.workspaceState.get<string[]>(this.storageKey, []);
            if (expandedIds.length > 0) {
                this.unifiedStateManager.updateState({ expandedItems: new Set(expandedIds) });
                this.logger.trace(
                    `[BaseTreeDataProvider] Loaded ${expandedIds.length} expanded items for ${this.storageKey}`
                );
            }
        } catch (error) {
            this.logger.error(`[BaseTreeDataProvider] Error loading expansion state for ${this.storageKey}:`, error);
        }
    }

    /**
     * Persists the current expansion state to the workspace storage.
     */
    private persistExpansionState(): void {
        try {
            if (!this.options.enableExpansionTracking) {
                return;
            }
            const state = this.unifiedStateManager.getCurrentUnifiedState();
            const expandedIds = Array.from(state.expandedItems);
            this.extensionContext.workspaceState.update(this.storageKey, expandedIds);
            this.logger.trace(
                `[BaseTreeDataProvider] Persisted ${expandedIds.length} expanded items for ${this.storageKey}`
            );
        } catch (error) {
            this.logger.error(`[BaseTreeDataProvider] Error persisting expansion state for ${this.storageKey}:`, error);
        }
    }

    /**
     * Abstract methods that must be implemented by subclasses
     */
    protected abstract fetchRootTreeItems(): Promise<T[]>;
    protected abstract fetchChildrenForTreeItem(treeItem: T): Promise<T[]>;
    protected abstract createTestThemeTreeItemFromData(data: any, parent: T | null): T | null;

    /**
     * Get tree item representation
     */
    getTreeItem(treeItem: T): vscode.TreeItem {
        return treeItem;
    }

    /**
     * Get parent of a tre item
     */
    getParent(treeItem: T): vscode.ProviderResult<T> {
        const state = this.unifiedStateManager.getCurrentUnifiedState();
        if (state.isCustomRootActive) {
            const currentRoot = state.customRootItem;
            if (treeItem === currentRoot) {
                return null;
            }
            if (treeItem.parent === currentRoot) {
                return currentRoot;
            }
        }
        return treeItem.parent as T;
    }

    /**
     * Get children of a tree item or root tree tems
     */
    async getChildren(treeItem?: T): Promise<T[]> {
        try {
            if (!treeItem) {
                return await this.getRootChildren();
            }

            if (!treeItem) {
                return await this.getRootChildren();
            }

            // Check if this is a custom root request
            const state = this.unifiedStateManager.getCurrentUnifiedState();
            if (state.isCustomRootActive && this.isCurrentRoot(treeItem)) {
                return await this.getChildrenForCustomRoot(treeItem);
            }

            return await this.fetchChildrenForTreeItem(treeItem);
        } catch (error: any) {
            this.logger.error(
                `[BaseTreeDataProvider] Error in getChildren for tree item ${treeItem?.label || "root"}: ${error.message}`,
                error
            );
            this.unifiedStateManager.setError(error, TreeViewEmptyState.FETCH_ERROR);
            return [];
        }
    }

    /**
     * Refresh the tree view with improved state management
     */
    public refresh(isHardRefresh: boolean = false): void {
        this.logger.debug(`[BaseTreeDataProvider] Refreshing tree. Hard refresh: ${isHardRefresh}`);

        if (isHardRefresh) {
            this.unifiedStateManager.resetCustomRoot();
        }

        this.unifiedStateManager.updateState({
            operationalState: TreeViewOperationalState.REFRESHING
        });

        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Clear tree data with proper state management
     */
    public clearTree(): void {
        this.logger.debug(`[${this.constructor.name}] Clearing tree data (preserving expansion state)`);

        this.rootTreeItems.forEach((treeItem) => {
            try {
                if (treeItem && typeof treeItem.dispose === "function") {
                    treeItem.dispose();
                }
            } catch (error) {
                this.logger.error(`[${this.constructor.name}] Error disposing tree item during clear:`, error);
            }
        });

        this.rootTreeItems = [];

        // Update operational state without clearing expansion state
        this.unifiedStateManager.updateState({
            operationalState: TreeViewOperationalState.EMPTY,
            emptyState: TreeViewEmptyState.NO_DATA_SOURCE,
            itemsAfterFiltering: 0
        });

        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Clear tree data and all persistent state (expansion state, custom root, etc.)
     * Use this when completely resetting the tree (e.g., switching projects, logout)
     */
    public clearTreeAndState(): void {
        this.logger.debug(`[${this.constructor.name}] Clearing tree data and all state`);

        // Store current expansion state before clearing if we have tree items
        if (this.options.enableExpansionTracking && this.rootTreeItems.length > 0) {
            this.storeExpansionState();
        }

        this.rootTreeItems.forEach((treeItem) => {
            try {
                if (treeItem && typeof treeItem.dispose === "function") {
                    treeItem.dispose();
                }
            } catch (error) {
                this.logger.error(`[${this.constructor.name}] Error disposing tree item during clear:`, error);
            }
        });

        this.rootTreeItems = [];
        this.unifiedStateManager.clear();
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Set an item as custom root
     */
    public makeRoot(item: T): void {
        if (!this.options.enableCustomRoot) {
            this.logger.warn("[BaseTreeDataProvider] Custom root is not enabled for this provider");
            return;
        }

        if (!this.canSetAsRoot(item)) {
            this.logger.error(`[BaseTreeDataProvider] Item cannot be set as root: ${item.label}`);
            return;
        }

        this.storeExpansionState();
        this.unifiedStateManager.setCustomRoot(item);

        // Immediately set ready state to prevent loading message
        this.unifiedStateManager.setReady(1);

        this._onDidChangeTreeData.fire(undefined);
        this.saveCustomRootState();
        this.logger.debug(`[BaseTreeDataProvider] Set custom root to item: ${item.label} (${item.getUniqueId()})`);
    }

    /**
     * Reset custom root
     */
    public resetCustomRoot(): void {
        this.unifiedStateManager.resetCustomRoot();
        this.saveCustomRootState();
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Handle expansion of an item, update the state, and trigger persistence.
     * @param treeItem The item being expanded or collapsed.
     * @param expanded The new expansion state.
     */
    public handleExpansion(treeItem: T, expanded: boolean): void {
        treeItem.handleExpansion(expanded);
        if (this.options.enableExpansionTracking) {
            const itemId = treeItem.getUniqueId();
            this.unifiedStateManager.setItemExpansion(itemId, expanded);
            // Trigger the debounced persistence to save the state after a short delay.
            this.debouncedPersistExpansionState();
        }
        this.logger.debug(
            `[BaseTreeDataProvider] Item ${treeItem.label} (${treeItem.getUniqueId()}) expansion set to ${expanded}`
        );
    }

    /**
     * Apply stored expansion state to an item and ensure its parents are expanded
     */
    protected applyStoredExpansionState(item: T): void {
        if (this.options.enableExpansionTracking) {
            const state = this.unifiedStateManager.getCurrentUnifiedState();
            const itemId = item.getUniqueId();
            if (state.expandedItems.has(itemId)) {
                if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                    item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                    this.ensureParentsExpanded(item);
                }
            }
        }
        this.logger.debug(
            `[BaseTreeDataProvider] Applied expansion state for item ${item.label} (${item.getUniqueId()})`
        );
    }

    /**
     * Store expansion state from current tree, including parent chain information.
     */
    protected storeExpansionState(): void {
        if (!this.options.enableExpansionTracking) {
            return;
        }

        if (this.rootTreeItems.length === 0) {
            this.logger.trace(
                `[BaseTreeDataProvider] storeExpansionState skipped for ${this.storageKey} because tree is empty.`
            );
            return;
        }
        const expandedIds = new Set<string>();
        const implicitlyExpandedIds = new Set<string>(); // Parents that must be expanded

        const collectExpanded = (items: T[], parentChain: T[] = []) => {
            for (const item of items) {
                const itemId = item.getUniqueId();

                if (item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                    expandedIds.add(itemId);

                    // Mark all parents as implicitly expanded
                    parentChain.forEach((parent) => {
                        implicitlyExpandedIds.add(parent.getUniqueId());
                    });
                }
                if (item.children) {
                    collectExpanded(item.children as T[], [...parentChain, item]);
                }
            }
        };

        collectExpanded(this.rootTreeItems);

        // Merge explicitly and implicitly expanded items
        implicitlyExpandedIds.forEach((id) => expandedIds.add(id));

        this.unifiedStateManager.updateState({ expandedItems: expandedIds });
        this.logger.debug(
            `[BaseTreeDataProvider] Stored expansion state for ${expandedIds.size} items (including parent chains): ${[...expandedIds].join(", ")}`
        );
    }

    /**
     * Ensures all parent items in the hierarchy are expanded for a given item.
     * This is necessary when restoring expansion state to ensure items remain visible.
     * @param item The item for which to ensure parents are expanded.
     */
    protected ensureParentsExpanded(item: T): void {
        const parentsToExpand: T[] = [];
        let current = item.parent as T | null;

        while (current) {
            parentsToExpand.push(current);
            current = current.parent as T | null;
        }

        // Expand parents from root to immediate parent
        parentsToExpand.reverse().forEach((parent) => {
            if (parent.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                parent.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                this.unifiedStateManager.setItemExpansion(parent.getUniqueId(), true);
            }
        });
    }

    /**
     * Update tree tree items and refresh with proper state management
     */
    protected updateTreeItem(treeItems: T[]): void {
        const state = this.unifiedStateManager.getCurrentUnifiedState();
        const customRootItem = state.customRootItem as T;
        const customRootId = state.isCustomRootActive && customRootItem ? customRootItem.getUniqueId() : null;

        // Dispose old tree items before replacing, but preserve custom root if it's in the new items
        this.rootTreeItems.forEach((treeItem) => {
            try {
                // Determine if the current item from the old tree is the custom root
                const isTheCustomRoot = customRootId ? treeItem.getUniqueId() === customRootId : false;

                // Check if an item with the same ID as the custom root exists in the new data set
                const newTreeHasRoot = customRootId
                    ? treeItems.some((newItem) => newItem.getUniqueId() === customRootId)
                    : false;

                // Preserve the item instance only if it's the custom root and it still exists in the new data
                const shouldPreserve = isTheCustomRoot && newTreeHasRoot;

                if (treeItem && typeof treeItem.dispose === "function" && !shouldPreserve) {
                    treeItem.dispose();
                }
            } catch (error) {
                this.logger.error(`[${this.constructor.name}] Error disposing old tree item:`, error);
            }
        });

        this.rootTreeItems = treeItems;

        if (this.options.enableExpansionTracking && treeItems.length > 0) {
            const applyExpansionRecursive = (items: T[]) => {
                for (const item of items) {
                    this.applyStoredExpansionState(item);
                    if (item.children) {
                        applyExpansionRecursive(item.children as T[]);
                    }
                }
            };
            applyExpansionRecursive(treeItems);
        }

        if (treeItems.length === 0) {
            this.unifiedStateManager.setEmpty(TreeViewEmptyState.SERVER_NO_DATA);
        } else {
            this.unifiedStateManager.setReady(treeItems.length);
        }

        this._onDidChangeTreeData.fire(undefined);

        // After updating tree items, try to restore custom root if pending
        if (this.pendingCustomRootRestore && treeItems.length > 0) {
            // Use a small delay to ensure the tree is fully rendered
            setTimeout(() => {
                this.tryRestoreCustomRoot();
            }, 100);
        }
    }

    /**
     * Sets the data source for state tracking
     */
    protected setDataSource(key: string, label?: string, displayName?: string): void {
        this.unifiedStateManager.setDataSource(key, label, displayName);
    }

    /**
     * Records a fetch attempt with results
     */
    protected recordFetchAttempt(success: boolean, itemsBeforeFilter: number = 0, itemsAfterFilter: number = 0): void {
        this.unifiedStateManager.recordFetchAttempt(success, itemsBeforeFilter, itemsAfterFilter);
    }

    /**
     * Sets loading state with optional message
     */
    protected setLoadingState(message?: string): void {
        this.unifiedStateManager.setLoading(message);
    }

    /**
     * Sets error state
     */
    protected setErrorState(error: Error, emptyState: TreeViewEmptyState = TreeViewEmptyState.FETCH_ERROR): void {
        this.unifiedStateManager.setError(error, emptyState);
    }

    /**
     * Updates the tree state with custom parameters
     */
    protected updateTreeState(params: StateUpdateParams): void {
        this.unifiedStateManager.updateState(params);
    }

    /**
     * Check if custom root is active
     */
    public isCustomRootActive(): boolean {
        return this.unifiedStateManager.getCurrentUnifiedState().isCustomRootActive;
    }

    /**
     * Get current custom root item
     */
    public getCurrentCustomRoot(): T | null {
        return this.unifiedStateManager.getCurrentUnifiedState().customRootItem as T | null;
    }

    /**
     * Check if an item is the current custom root
     */
    public isCurrentRoot(item: T): boolean {
        const state = this.unifiedStateManager.getCurrentUnifiedState();
        if (!state.isCustomRootActive || !state.customRootItem) {
            return false;
        }
        return (state.customRootItem as T).getUniqueId() === item.getUniqueId();
    }

    /**
     * Check if an item can be set as custom root
     */
    private canSetAsRoot(item: T): boolean {
        return item !== null && item.getUniqueId() !== undefined;
    }

    /**
     * Override getRootChildren to ensure custom root restoration
     */
    protected async getRootChildren(): Promise<T[]> {
        try {
            const state = this.unifiedStateManager.getCurrentUnifiedState();
            if (state.isCustomRootActive && state.customRootItem) {
                this.unifiedStateManager.setReady(1);
                return [state.customRootItem as T];
            }

            const isDataFetchRequired =
                state.operationalState !== TreeViewOperationalState.READY &&
                state.operationalState !== TreeViewOperationalState.EMPTY;

            if (isDataFetchRequired) {
                this.rootTreeItems = await this.fetchRootTreeItems();

                if (this.pendingCustomRootRestore && this.rootTreeItems.length > 0) {
                    if (this.isCustomRootContextValid(this.pendingCustomRootRestore)) {
                        setTimeout(() => {
                            this.tryRestoreCustomRoot();
                        }, 100);
                    } else {
                        this.logger.info("[BaseTreeDataProvider] Custom root context changed, not restoring");
                        this.pendingCustomRootRestore = null;
                    }
                }
            }

            return this.rootTreeItems;
        } catch (error: any) {
            this.logger.error(`[BaseTreeDataProvider] Error fetching root tree items:`, error);
            this.unifiedStateManager.setError(error, TreeViewEmptyState.FETCH_ERROR);
            this.rootTreeItems = [];
            return [];
        }
    }

    /**
     * Get children for custom root tree item
     */
    protected async getChildrenForCustomRoot(customRootTreeItem: T): Promise<T[]> {
        return await this.fetchChildrenForTreeItem(customRootTreeItem);
    }

    /**
     * Handle unified state changes
     */
    protected onUnifiedStateChange(notification: StateChangeNotification): void {
        this.logger.trace(
            `[BaseTreeDataProvider] Unified state changed. Fields: ${notification.changedFields.join(", ")}`
        );
    }

    /**
     * Handle custom root state changes (for backwards compatibility)
     */
    protected onCustomRootStateChange(state: any): void {
        this.saveCustomRootState();
        this.logger.trace(`[BaseTreeDataProvider] Custom root state changed:`, state);
    }

    /**
     * Find item by unique ID
     */
    protected findItemById(id: string, items?: T[]): T | null {
        const searchItems = items || this.rootTreeItems;

        for (const item of searchItems) {
            if (item.getUniqueId() === id) {
                return item;
            }

            if (item.children) {
                const found = this.findItemById(id, item.children as T[]);
                if (found) {
                    return found;
                }
            }
        }

        return null;
    }

    /**
     * Get current root tree items
     */
    public getCurrentRootTreeItems(): T[] {
        return [...this.rootTreeItems];
    }

    /**
     * Show tree status message (legacy method for backward compatibility)
     */
    public showTreeStatusMessage(message: string | undefined): void {
        this.updateMessageCallback(message);
        this.logger.trace(`[${this.constructor.name}] Status message updated to "${message}"`);
    }

    /**
     * Get the unified state manager for advanced state operations
     */
    protected getUnifiedStateManager(): UnifiedTreeStateManager<T> {
        return this.unifiedStateManager;
    }

    /**
     * Get the underlying state manager for backwards compatibility
     */
    protected getStateManager() {
        return this.unifiedStateManager.getTreeViewStateManager();
    }

    /**
     * Get diagnostic information about the tree state
     */
    public getDiagnostics(): Record<string, any> {
        return {
            providerType: this.constructor.name,
            rootTreeItemsCount: this.rootTreeItems.length,
            unifiedStateDiagnostics: this.unifiedStateManager.getDiagnostics(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Dispose of the provider and all resources, ensuring the final state is saved.
     */
    public dispose(): void {
        this.logger.debug(`[${this.constructor.name}] Disposing provider`);
        try {
            // Persist state one last time on dispose to capture the final state.
            this.persistExpansionState();
            this.clearTree();
            this._disposables.forEach((disposable) => {
                try {
                    disposable.dispose();
                } catch (error) {
                    this.logger.error(`[${this.constructor.name}] Error disposing resource:`, error);
                }
            });
            this._disposables.length = 0;
        } catch (error) {
            this.logger.error(`[${this.constructor.name}] Error during provider disposal:`, error);
        }
    }
}
