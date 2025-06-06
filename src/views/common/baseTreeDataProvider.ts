/**
 * @file src/views/common/baseTreeDataProvider.ts
 * @description Base class for VS Code TreeDataProviders
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeItem as BaseTreeItem } from "./baseTreeItem";
import { UnifiedTreeStateManager, StateChangeNotification } from "../../services/unifiedTreeStateManager";
import {
    TreeViewStateConfig,
    TreeViewEmptyState,
    TreeViewOperationalState,
    StateUpdateParams
} from "../../services/treeViewStateTypes";

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

        // Register disposables for cleanup
        this._disposables.push(this._onDidChangeTreeData);
        this._disposables.push(this.unifiedStateManager);

        this.logger.trace("[BaseTreeDataProvider] Initialized with unified state management");
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
                this.unifiedStateManager.setLoading();
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
        this.logger.debug(`[${this.constructor.name}] Clearing tree`);

        // Dispose all current tree items
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

        this.unifiedStateManager.setCustomRoot(item);
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Reset custom root
     */
    public resetCustomRoot(): void {
        this.unifiedStateManager.resetCustomRoot();
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Handle expansion of an item
     */
    public handleExpansion(treeItem: T, expanded: boolean): void {
        treeItem.handleExpansion(expanded);

        if (this.options.enableExpansionTracking) {
            const itemId = treeItem.getUniqueId();
            this.unifiedStateManager.setItemExpansion(itemId, expanded);
        }
    }

    /**
     * Apply stored expansion state to an item
     */
    protected applyStoredExpansionState(item: T): void {
        if (this.options.enableExpansionTracking) {
            const state = this.unifiedStateManager.getCurrentUnifiedState();
            const itemId = item.getUniqueId();
            if (state.expandedItems.has(itemId)) {
                if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                    item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                }
            }
        }
    }

    /**
     * Store expansion state from current tree
     */
    protected storeExpansionState(): void {
        if (this.options.enableExpansionTracking) {
            const expandedIds = new Set<string>();

            const collectExpanded = (items: T[]) => {
                for (const item of items) {
                    if (item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                        expandedIds.add(item.getUniqueId());
                    }
                    if (item.children) {
                        collectExpanded(item.children as T[]);
                    }
                }
            };

            collectExpanded(this.rootTreeItems);
            this.unifiedStateManager.updateState({ expandedItems: expandedIds });
        }
    }

    /**
     * Update tree tree items and refresh with proper state management
     */
    protected updateTreeItem(treeItems: T[]): void {
        // Dispose old tree items before replacing
        this.rootTreeItems.forEach((treeItem) => {
            try {
                if (treeItem && typeof treeItem.dispose === "function") {
                    treeItem.dispose();
                }
            } catch (error) {
                this.logger.error(`[${this.constructor.name}] Error disposing old tree item:`, error);
            }
        });

        this.rootTreeItems = treeItems;

        // Apply expansion state if tracking is enabled
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

        // Update state based on tree item count
        if (treeItems.length === 0) {
            this.unifiedStateManager.setEmpty(TreeViewEmptyState.SERVER_NO_DATA);
        } else {
            this.unifiedStateManager.setReady(treeItems.length);
        }

        this._onDidChangeTreeData.fire(undefined);
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
     * Get root children based on custom root state with improved error handling
     */
    private async getRootChildren(): Promise<T[]> {
        try {
            const state = this.unifiedStateManager.getCurrentUnifiedState();
            if (state.isCustomRootActive && state.customRootItem) {
                return [state.customRootItem as T];
            }

            this.rootTreeItems = await this.fetchRootTreeItems();

            if (this.rootTreeItems.length === 0) {
                this.unifiedStateManager.setEmpty(TreeViewEmptyState.SERVER_NO_DATA);
            } else {
                this.unifiedStateManager.setReady(this.rootTreeItems.length);
            }

            return this.rootTreeItems;
        } catch (error: any) {
            this.logger.error(`[BaseTreeDataProvider] Error fetching root tree items:`, error);
            this.unifiedStateManager.setError(error, TreeViewEmptyState.FETCH_ERROR);
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

        // Can be overridden by subclasses for custom behavior
    }

    /**
     * Handle custom root state changes (for backwards compatibility)
     */
    protected onCustomRootStateChange(state: any): void {
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
     * Dispose of the provider and all resources
     */
    public dispose(): void {
        this.logger.debug(`[${this.constructor.name}] Disposing provider`);

        try {
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
