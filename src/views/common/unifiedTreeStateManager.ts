/**
 * @file src/views/common/unifiedTreeStateManager.ts
 * @description Unified state manager that coordinates all tree-related state management
 */

import { TestBenchLogger } from "../../testBenchLogger";
import { TreeViewStateManager } from "./treeViewStateManager";
import { CustomRootService } from "./customRootService";
import { BaseTreeItem } from "./baseTreeItem";
import {
    TreeViewStateConfig,
    TreeViewOperationalState,
    TreeViewEmptyState,
    StateUpdateParams,
    StateUpdateResult
} from "./treeViewStateTypes";

/**
 * Unified state that encompasses all tree-related state concerns
 */
export interface UnifiedTreeState {
    // Operational state
    operationalState: TreeViewOperationalState;
    emptyState?: TreeViewEmptyState;

    // Data source tracking
    dataSourceKey: string;
    dataSourceLabel: string;
    dataSourceDisplayName: string;

    // Data fetch tracking
    hasDataFetchBeenAttempted: boolean;
    isServerDataReceived: boolean;
    itemsBeforeFiltering: number;
    itemsAfterFiltering: number;

    // Custom root state
    isCustomRootActive: boolean;
    customRootItem: any | null;
    customRootOriginalContext: string | null;

    // Expansion tracking
    expandedItems: Set<string>;

    // Error tracking
    lastError?: Error;
    lastUpdated: Date;
    metadata: Record<string, any>;
}

/**
 * State change notification interface
 */
export interface StateChangeNotification {
    previousState: Partial<UnifiedTreeState>;
    newState: UnifiedTreeState;
    changedFields: string[];
    stateUpdateResult: StateUpdateResult;
}

/**
 * Unified tree state manager that coordinates all tree state concerns
 * Provides a single interface for state management while delegating to appropriate managers
 */
export class UnifiedTreeStateManager<T extends BaseTreeItem> {
    private readonly logger: TestBenchLogger;
    private readonly treeViewStateManager: TreeViewStateManager;
    private readonly customRootService: CustomRootService<T>;
    private readonly stateChangeCallbacks: Array<(notification: StateChangeNotification) => void> = [];
    private isUpdating = false; // Prevent recursive updates

    constructor(
        logger: TestBenchLogger,
        stateConfig: TreeViewStateConfig,
        updateMessageCallback: (message: string | undefined) => void,
        customRootContextKey: string,
        customRootContextValue: string,
        onCustomRootStateChange?: (state: any) => void
    ) {
        this.logger = logger;

        // Initialize existing managers
        this.treeViewStateManager = new TreeViewStateManager(logger, stateConfig, updateMessageCallback);
        this.customRootService = new CustomRootService<T>(
            logger,
            customRootContextKey,
            customRootContextValue,
            (state) => this.handleCustomRootStateChange(state, onCustomRootStateChange)
        );

        this.logger.trace(`[UnifiedTreeStateManager] Initialized for ${stateConfig.treeViewId}`);
    }

    /**
     * Gets the current unified state by combining states from all managers
     */
    public getCurrentUnifiedState(): UnifiedTreeState {
        const viewState = this.treeViewStateManager.getCurrentState();
        const customRootState = this.customRootService.getState();

        return {
            // Operational state from TreeViewStateManager
            operationalState: viewState.operationalState,
            emptyState: viewState.emptyState,

            // Data source from TreeViewStateManager
            dataSourceKey: viewState.currentDataSourceKey,
            dataSourceLabel: viewState.currentDataSourceLabel,
            dataSourceDisplayName: viewState.currentDataSourceDisplayName,

            // Fetch tracking from TreeViewStateManager
            hasDataFetchBeenAttempted: viewState.dataFetchAttempted,
            isServerDataReceived: viewState.serverDataReceived,
            itemsBeforeFiltering: viewState.itemsBeforeFiltering,
            itemsAfterFiltering: viewState.itemsAfterFiltering,

            // Custom root state from CustomRootService
            isCustomRootActive: customRootState.isActive,
            customRootItem: customRootState.rootItem,
            customRootOriginalContext: customRootState.originalContextValue,

            // Expansion tracking from CustomRootService (internal access needed)
            expandedItems: new Set(this.getExpandedItemsFromCustomRootService()),

            // Error and metadata from TreeViewStateManager
            lastError: viewState.lastError,
            lastUpdated: viewState.lastUpdated,
            metadata: viewState.metadata || {}
        };
    }

    /**
     * Updates state in a coordinated manner across all managers
     * @param updates State updates to apply
     * @returns Result of the state update operation
     */
    public updateState(updates: Partial<UnifiedTreeState>): StateChangeNotification {
        if (this.isUpdating) {
            this.logger.warn("[UnifiedTreeStateManager] Recursive state update detected, skipping");
            const currentState = this.getCurrentUnifiedState();
            return {
                previousState: currentState,
                newState: currentState,
                changedFields: [],
                stateUpdateResult: { stateChanged: false }
            };
        }

        this.isUpdating = true;
        const previousState = this.getCurrentUnifiedState();
        const changedFields: string[] = [];

        try {
            const viewStateUpdates: StateUpdateParams = {};
            let hasViewStateUpdates = false;

            if (updates.operationalState !== undefined && updates.operationalState !== previousState.operationalState) {
                viewStateUpdates.operationalState = updates.operationalState;
                hasViewStateUpdates = true;
                changedFields.push("operationalState");
            }

            if (updates.emptyState !== undefined && updates.emptyState !== previousState.emptyState) {
                viewStateUpdates.emptyState = updates.emptyState;
                hasViewStateUpdates = true;
                changedFields.push("emptyState");
            }

            if (updates.dataSourceKey !== undefined && updates.dataSourceKey !== previousState.dataSourceKey) {
                viewStateUpdates.dataSourceKey = updates.dataSourceKey;
                hasViewStateUpdates = true;
                changedFields.push("dataSourceKey");
            }

            if (updates.dataSourceLabel !== undefined && updates.dataSourceLabel !== previousState.dataSourceLabel) {
                viewStateUpdates.dataSourceLabel = updates.dataSourceLabel;
                hasViewStateUpdates = true;
                changedFields.push("dataSourceLabel");
            }

            if (
                updates.dataSourceDisplayName !== undefined &&
                updates.dataSourceDisplayName !== previousState.dataSourceDisplayName
            ) {
                viewStateUpdates.dataSourceDisplayName = updates.dataSourceDisplayName;
                hasViewStateUpdates = true;
                changedFields.push("dataSourceDisplayName");
            }

            if (
                updates.hasDataFetchBeenAttempted !== undefined &&
                updates.hasDataFetchBeenAttempted !== previousState.hasDataFetchBeenAttempted
            ) {
                viewStateUpdates.dataFetchAttempted = updates.hasDataFetchBeenAttempted;
                hasViewStateUpdates = true;
                changedFields.push("dataFetchAttempted");
            }

            if (
                updates.isServerDataReceived !== undefined &&
                updates.isServerDataReceived !== previousState.isServerDataReceived
            ) {
                viewStateUpdates.serverDataReceived = updates.isServerDataReceived;
                hasViewStateUpdates = true;
                changedFields.push("serverDataReceived");
            }

            if (
                updates.itemsBeforeFiltering !== undefined &&
                updates.itemsBeforeFiltering !== previousState.itemsBeforeFiltering
            ) {
                viewStateUpdates.itemsBeforeFiltering = updates.itemsBeforeFiltering;
                hasViewStateUpdates = true;
                changedFields.push("itemsBeforeFiltering");
            }

            if (
                updates.itemsAfterFiltering !== undefined &&
                updates.itemsAfterFiltering !== previousState.itemsAfterFiltering
            ) {
                viewStateUpdates.itemsAfterFiltering = updates.itemsAfterFiltering;
                hasViewStateUpdates = true;
                changedFields.push("itemsAfterFiltering");
            }

            if (updates.lastError !== undefined) {
                viewStateUpdates.error = updates.lastError;
                hasViewStateUpdates = true;
                changedFields.push("lastError");
            }

            if (updates.metadata !== undefined) {
                viewStateUpdates.metadata = updates.metadata;
                hasViewStateUpdates = true;
                changedFields.push("metadata");
            }

            let stateUpdateResult: StateUpdateResult = { stateChanged: false };
            if (hasViewStateUpdates) {
                stateUpdateResult = this.treeViewStateManager.updateState(viewStateUpdates);
            }

            // Handle custom root state changes
            if (
                updates.isCustomRootActive !== undefined &&
                updates.isCustomRootActive !== previousState.isCustomRootActive
            ) {
                if (updates.isCustomRootActive && updates.customRootItem) {
                    this.customRootService.setCustomRoot(updates.customRootItem);
                } else if (!updates.isCustomRootActive) {
                    this.customRootService.resetCustomRoot();
                }
                changedFields.push("customRootActive");
            }

            // Handle expansion state changes
            if (updates.expandedItems !== undefined) {
                this.syncExpandedItems(updates.expandedItems);
                changedFields.push("expandedItems");
            }

            const newState = this.getCurrentUnifiedState();

            // Notify callbacks of state change
            const notification: StateChangeNotification = {
                previousState,
                newState,
                changedFields,
                stateUpdateResult
            };

            this.notifyStateChangeCallbacks(notification);

            this.logger.trace(`[UnifiedTreeStateManager] State updated. Changed fields: ${changedFields.join(", ")}`);

            return notification;
        } finally {
            this.isUpdating = false;
        }
    }

    /**
     * Sets the tree to loading state with optional message
     * @param message Optional loading message
     */
    public setLoading(message?: string): StateChangeNotification {
        return this.updateState({
            operationalState: TreeViewOperationalState.LOADING,
            metadata: message ? { loadingMessage: message } : {}
        });
    }

    /**
     * Sets the tree to ready state (has data)
     * @param itemCount Number of items in the tree
     */
    public setReady(itemCount: number): StateChangeNotification {
        return this.updateState({
            operationalState: TreeViewOperationalState.READY,
            itemsAfterFiltering: itemCount,
            emptyState: undefined
        });
    }

    /**
     * Sets the tree to empty state with specific reason
     * @param emptyState The reason why the tree is empty
     * @param context Optional context information
     */
    public setEmpty(emptyState: TreeViewEmptyState, context?: any): StateChangeNotification {
        return this.updateState({
            operationalState: TreeViewOperationalState.EMPTY,
            emptyState,
            metadata: context ? { emptyContext: context } : {}
        });
    }

    /**
     * Sets the tree to error state
     * @param error The error that occurred
     * @param emptyState Optional empty state reason
     */
    public setError(
        error: Error,
        emptyState: TreeViewEmptyState = TreeViewEmptyState.FETCH_ERROR
    ): StateChangeNotification {
        return this.updateState({
            operationalState: TreeViewOperationalState.ERROR,
            emptyState,
            lastError: error
        });
    }

    /**
     * Sets the data source information
     * @param key Data source key
     * @param label Optional human-readable label
     * @param displayName Optional display name for UI
     */
    public setDataSource(key: string, label?: string, displayName?: string): StateChangeNotification {
        return this.updateState({
            dataSourceKey: key,
            dataSourceLabel: label || key,
            dataSourceDisplayName: displayName || label || key
        });
    }

    /**
     * Records a fetch attempt and results
     * @param serverReturnedData Whether the server returned data
     * @param itemsBeforeFilter Number of items before filtering
     * @param itemsAfterFilter Number of items after filtering
     */
    public recordFetchAttempt(
        serverReturnedData: boolean,
        itemsBeforeFilter: number = 0,
        itemsAfterFilter: number = 0
    ): StateChangeNotification {
        return this.updateState({
            hasDataFetchBeenAttempted: true,
            isServerDataReceived: serverReturnedData,
            itemsBeforeFiltering: itemsBeforeFilter,
            itemsAfterFiltering: itemsAfterFilter
        });
    }

    /**
     * Sets a custom root item
     * @param item The item to set as custom root
     */
    public setCustomRoot(item: T): StateChangeNotification {
        return this.updateState({
            isCustomRootActive: true,
            customRootItem: item
        });
    }

    /**
     * Resets the custom root
     */
    public resetCustomRoot(): StateChangeNotification {
        return this.updateState({
            isCustomRootActive: false,
            customRootItem: null,
            customRootOriginalContext: null
        });
    }

    /**
     * Tracks expansion state for an item
     * @param itemId The unique ID of the item
     * @param expanded Whether the item is expanded
     */
    public setItemExpansion(itemId: string, expanded: boolean): StateChangeNotification {
        const currentExpanded = this.getCurrentUnifiedState().expandedItems;
        const newExpanded = new Set(currentExpanded);

        if (expanded) {
            newExpanded.add(itemId);
        } else {
            newExpanded.delete(itemId);
        }

        return this.updateState({
            expandedItems: newExpanded
        });
    }

    /**
     * Clears all state
     */
    public clear(): StateChangeNotification {
        this.customRootService.resetCustomRoot();
        this.treeViewStateManager.clear();

        return this.updateState({
            operationalState: TreeViewOperationalState.EMPTY,
            emptyState: TreeViewEmptyState.NO_DATA_SOURCE,
            isCustomRootActive: false,
            customRootItem: null,
            customRootOriginalContext: null,
            expandedItems: new Set()
        });
    }

    /**
     * Adds a callback to be notified of state changes
     * @param callback Function to call when state changes
     */
    public onStateChange(callback: (notification: StateChangeNotification) => void): void {
        this.stateChangeCallbacks.push(callback);
    }

    /**
     * Removes a state change callback
     * @param callback The callback to remove
     */
    public removeStateChangeCallback(callback: (notification: StateChangeNotification) => void): void {
        const index = this.stateChangeCallbacks.indexOf(callback);
        if (index >= 0) {
            this.stateChangeCallbacks.splice(index, 1);
        }
    }

    /**
     * Gets access to the underlying TreeViewStateManager for backwards compatibility
     */
    public getTreeViewStateManager(): TreeViewStateManager {
        return this.treeViewStateManager;
    }

    /**
     * Gets access to the underlying CustomRootService for backwards compatibility
     */
    public getCustomRootService(): CustomRootService<T> {
        return this.customRootService;
    }

    /**
     * Gets diagnostic information about the current state
     */
    public getDiagnostics(): Record<string, any> {
        const unifiedState = this.getCurrentUnifiedState();
        return {
            unifiedState,
            treeViewStateManagerDiagnostics: this.treeViewStateManager.getDiagnostics(),
            customRootServiceState: this.customRootService.getState(),
            stateChangeCallbacksCount: this.stateChangeCallbacks.length,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Disposes of the manager and all resources
     */
    public dispose(): void {
        this.stateChangeCallbacks.length = 0;
        this.customRootService.dispose();
        this.logger.trace("[UnifiedTreeStateManager] Disposed successfully");
    }

    /**
     * Handles custom root state changes from the CustomRootService
     */
    private handleCustomRootStateChange(state: any, originalCallback?: (state: any) => void): void {
        if (!this.isUpdating) {
            this.updateState({
                isCustomRootActive: state.isActive,
                customRootItem: state.rootItem,
                customRootOriginalContext: state.originalContextValue
            });
        }

        if (originalCallback) {
            originalCallback(state);
        }
    }

    /**
     * Gets expanded items from CustomRootService
     */
    private getExpandedItemsFromCustomRootService(): string[] {
        return this.customRootService.getExpandedItems();
    }

    /**
     * Syncs expanded items with CustomRootService
     */
    private syncExpandedItems(expandedItems: Set<string>): void {
        this.customRootService.setExpandedItems(Array.from(expandedItems));
    }

    /**
     * Notifies all registered callbacks of state changes
     */
    private notifyStateChangeCallbacks(notification: StateChangeNotification): void {
        this.stateChangeCallbacks.forEach((callback) => {
            try {
                callback(notification);
            } catch (error) {
                this.logger.error("[UnifiedTreeStateManager] Error in state change callback:", error);
            }
        });
    }
}
