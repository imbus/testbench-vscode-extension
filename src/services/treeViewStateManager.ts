/**
 * @file src/services/treeViewStateManager.ts
 * @description Service for managing tree view states and messages across all tree views
 */

import { TestBenchLogger } from "../testBenchLogger";
import { getExtensionConfiguration } from "../configuration";
import { ConfigKeys } from "../constants";
import {
    TreeViewState,
    TreeViewEmptyState,
    TreeViewOperationalState,
    TreeViewStateConfig,
    TreeViewType,
    StateUpdateResult,
    StateUpdateParams
} from "./treeViewStateTypes";

/**
 * Service for managing tree view states and generating appropriate messages.
 * Provides a centralized way to handle tree view messaging across all tree data providers.
 */
export class TreeViewStateManager {
    private state: TreeViewState;
    private readonly config: TreeViewStateConfig;
    private readonly updateMessageCallback: (message: string | undefined) => void;

    constructor(
        private readonly logger: TestBenchLogger,
        config: TreeViewStateConfig,
        updateMessageCallback: (message: string | undefined) => void
    ) {
        this.config = config;
        this.updateMessageCallback = updateMessageCallback;
        this.state = this.createInitialState();

        this.logger.trace(`[TreeViewStateManager] Initialized for ${config.treeViewId} (${config.treeViewType})`);
    }

    /**
     * Creates the initial state for the tree view
     */
    private createInitialState(): TreeViewState {
        return {
            operationalState: TreeViewOperationalState.LOADING,
            emptyState: TreeViewEmptyState.NOT_INITIALIZED,
            currentDataSourceKey: "",
            currentDataSourceLabel: "",
            currentDataSourceDisplayName: "",
            dataFetchAttempted: false,
            serverDataReceived: false,
            itemsBeforeFiltering: 0,
            itemsAfterFiltering: 0,
            lastUpdated: new Date(),
            metadata: {}
        };
    }

    /**
     * Updates the tree view state and refreshes the message if needed
     */
    public updateState(updates: StateUpdateParams): StateUpdateResult {
        const previousState = { ...this.state };
        let stateChanged = false;

        // Apply updates to state
        if (updates.operationalState !== undefined && updates.operationalState !== this.state.operationalState) {
            this.state.operationalState = updates.operationalState;
            stateChanged = true;
        }

        if (updates.emptyState !== undefined && updates.emptyState !== this.state.emptyState) {
            this.state.emptyState = updates.emptyState;
            stateChanged = true;
        }

        if (updates.dataSourceKey !== undefined && updates.dataSourceKey !== this.state.currentDataSourceKey) {
            this.state.currentDataSourceKey = updates.dataSourceKey;
            stateChanged = true;
        }

        if (updates.dataSourceLabel !== undefined && updates.dataSourceLabel !== this.state.currentDataSourceLabel) {
            this.state.currentDataSourceLabel = updates.dataSourceLabel;
            stateChanged = true;
        }

        if (
            updates.dataSourceDisplayName !== undefined &&
            updates.dataSourceDisplayName !== this.state.currentDataSourceDisplayName
        ) {
            this.state.currentDataSourceDisplayName = updates.dataSourceDisplayName;
            stateChanged = true;
        }

        if (updates.dataFetchAttempted !== undefined && updates.dataFetchAttempted !== this.state.dataFetchAttempted) {
            this.state.dataFetchAttempted = updates.dataFetchAttempted;
            stateChanged = true;
        }

        if (updates.serverDataReceived !== undefined && updates.serverDataReceived !== this.state.serverDataReceived) {
            this.state.serverDataReceived = updates.serverDataReceived;
            stateChanged = true;
        }

        if (
            updates.itemsBeforeFiltering !== undefined &&
            updates.itemsBeforeFiltering !== this.state.itemsBeforeFiltering
        ) {
            this.state.itemsBeforeFiltering = updates.itemsBeforeFiltering;
            stateChanged = true;
        }

        if (
            updates.itemsAfterFiltering !== undefined &&
            updates.itemsAfterFiltering !== this.state.itemsAfterFiltering
        ) {
            this.state.itemsAfterFiltering = updates.itemsAfterFiltering;
            stateChanged = true;
        }

        if (updates.error !== undefined) {
            this.state.lastError = updates.error;
            stateChanged = true;
        }

        if (updates.metadata !== undefined) {
            this.state.metadata = { ...this.state.metadata, ...updates.metadata };
            stateChanged = true;
        }

        // Update timestamp if state changed
        if (stateChanged) {
            this.state.lastUpdated = new Date();
        }

        // Generate and update message
        const newMessage = this.generateMessage();
        this.updateMessageCallback(newMessage);

        if (stateChanged) {
            this.logger.trace(`[TreeViewStateManager] State updated for ${this.config.treeViewId}:`, {
                previousState: previousState.operationalState,
                newState: this.state.operationalState,
                message: newMessage
            });
        }

        return {
            stateChanged,
            previousState: stateChanged ? previousState : undefined,
            newMessage
        };
    }

    /**
     * Sets the tree to loading state with optional message
     */
    public setLoading(message?: string): void {
        this.updateState({
            operationalState: TreeViewOperationalState.LOADING,
            metadata: message ? { loadingMessage: message } : undefined
        });
    }

    /**
     * Sets the tree to ready state (has data)
     */
    public setReady(itemCount: number): void {
        this.updateState({
            operationalState: TreeViewOperationalState.READY,
            itemsAfterFiltering: itemCount,
            emptyState: undefined
        });
    }

    /**
     * Sets the tree to empty state with specific reason
     */
    public setEmpty(emptyState: TreeViewEmptyState, context?: any): void {
        this.updateState({
            operationalState: TreeViewOperationalState.EMPTY,
            emptyState,
            metadata: context ? { emptyContext: context } : undefined
        });
    }

    /**
     * Sets the tree to error state
     */
    public setError(error: Error, emptyState: TreeViewEmptyState = TreeViewEmptyState.FETCH_ERROR): void {
        this.updateState({
            operationalState: TreeViewOperationalState.ERROR,
            emptyState,
            error
        });
    }

    /**
     * Sets the data source information
     */
    public setDataSource(key: string, label?: string, displayName?: string): void {
        this.updateState({
            dataSourceKey: key,
            dataSourceLabel: label || key,
            dataSourceDisplayName: displayName || label || key
        });
    }

    /**
     * Records fetch attempt and results
     */
    public recordFetchAttempt(
        serverReturnedData: boolean,
        itemsBeforeFilter: number = 0,
        itemsAfterFilter: number = 0
    ): void {
        this.updateState({
            dataFetchAttempted: true,
            serverDataReceived: serverReturnedData,
            itemsBeforeFiltering: itemsBeforeFilter,
            itemsAfterFiltering: itemsAfterFilter
        });
    }

    /**
     * Clears the tree state (for logout, disconnect, etc.)
     */
    public clear(): void {
        this.state = this.createInitialState();
        this.updateState({
            emptyState: TreeViewEmptyState.NO_DATA_SOURCE
        });
    }

    /**
     * Gets the current state (readonly)
     */
    public getCurrentState(): Readonly<TreeViewState> {
        return { ...this.state };
    }

    /**
     * Generates appropriate message based on current state
     */
    private generateMessage(): string | undefined {
        // If tree has data, no message needed
        if (this.state.operationalState === TreeViewOperationalState.READY && this.state.itemsAfterFiltering > 0) {
            return undefined;
        }

        // Check for custom message resolver first
        if (this.config.customMessageResolver) {
            try {
                const customMessage = this.config.customMessageResolver(this.state);
                if (customMessage) {
                    return customMessage;
                }
            } catch (error) {
                this.logger.warn(
                    `[TreeViewStateManager] Custom message resolver failed for ${this.config.treeViewId}:`,
                    error
                );
            }
        }

        // Handle loading states
        if (this.state.operationalState === TreeViewOperationalState.LOADING) {
            return this.generateLoadingMessage();
        }

        if (this.state.operationalState === TreeViewOperationalState.REFRESHING) {
            return this.generateRefreshingMessage();
        }

        // Handle empty/error states
        if (
            this.state.operationalState === TreeViewOperationalState.EMPTY ||
            this.state.operationalState === TreeViewOperationalState.ERROR
        ) {
            return this.generateEmptyStateMessage();
        }

        // Fallback
        return this.getDefaultMessage();
    }

    /**
     * Generates loading message
     */
    private generateLoadingMessage(): string {
        const loadingMessage = this.state.metadata?.loadingMessage;
        if (loadingMessage) {
            return loadingMessage;
        }

        if (this.config.loadingMessageTemplate && this.state.currentDataSourceDisplayName) {
            return this.config.loadingMessageTemplate.replace("{dataSource}", this.state.currentDataSourceDisplayName);
        }

        switch (this.config.treeViewType) {
            case TreeViewType.PROJECT_MANAGEMENT:
                return "Loading projects...";
            case TreeViewType.TEST_THEME:
                return this.state.currentDataSourceDisplayName
                    ? `Loading test themes for ${this.state.currentDataSourceDisplayName}...`
                    : "Loading test themes...";
            case TreeViewType.TEST_ELEMENTS:
                return this.state.currentDataSourceDisplayName
                    ? `Loading test elements for ${this.state.currentDataSourceDisplayName}...`
                    : "Loading test elements...";
            default:
                return "Loading...";
        }
    }

    /**
     * Generates refreshing message
     */
    private generateRefreshingMessage(): string {
        const displayName = this.state.currentDataSourceDisplayName;
        switch (this.config.treeViewType) {
            case TreeViewType.PROJECT_MANAGEMENT:
                return "Refreshing projects...";
            case TreeViewType.TEST_THEME:
                return displayName ? `Refreshing test themes for ${displayName}...` : "Refreshing test themes...";
            case TreeViewType.TEST_ELEMENTS:
                return displayName ? `Refreshing test elements for ${displayName}...` : "Refreshing test elements...";
            default:
                return "Refreshing...";
        }
    }

    /**
     * Generates message for empty states based on the specific empty state reason
     */
    private generateEmptyStateMessage(): string {
        const displayName =
            this.state.currentDataSourceDisplayName ||
            this.state.currentDataSourceLabel ||
            this.state.currentDataSourceKey;

        switch (this.state.emptyState) {
            case TreeViewEmptyState.NOT_INITIALIZED:
                return this.getInitializingMessage();

            case TreeViewEmptyState.NO_DATA_SOURCE:
                return this.config.noDataSourceMessage || this.getNoDataSourceMessage();

            case TreeViewEmptyState.NO_CONNECTION:
                return this.getNoConnectionMessage();

            case TreeViewEmptyState.AUTH_REQUIRED:
                return this.getAuthRequiredMessage();

            case TreeViewEmptyState.FETCH_ERROR:
                return this.getFetchErrorMessage(displayName);

            case TreeViewEmptyState.SERVER_NO_DATA:
                return this.getServerNoDataMessage(displayName);

            case TreeViewEmptyState.FILTERED_OUT:
                return this.getFilteredOutMessage(displayName);

            case TreeViewEmptyState.PROCESSING_ERROR:
                return this.getProcessingErrorMessage(displayName);

            default:
                return this.getDefaultEmptyMessage(displayName);
        }
    }

    /**
     * Get initializing message based on tree type
     */
    private getInitializingMessage(): string {
        switch (this.config.treeViewType) {
            case TreeViewType.PROJECT_MANAGEMENT:
                return "Projects view is initializing...";
            case TreeViewType.TEST_THEME:
                return "Test Themes view is initializing...";
            case TreeViewType.TEST_ELEMENTS:
                return "Test Elements view is initializing...";
            default:
                return "Tree view is initializing...";
        }
    }

    /**
     * Get no data source message based on tree type
     */
    private getNoDataSourceMessage(): string {
        switch (this.config.treeViewType) {
            case TreeViewType.PROJECT_MANAGEMENT:
                return "Not connected to TestBench or no projects available.";
            case TreeViewType.TEST_THEME:
                return "Select a cycle from the 'Projects' view to see test themes.";
            case TreeViewType.TEST_ELEMENTS:
                return "Select a Test Object Version (TOV) from the 'Projects' view to load test elements.";
            default:
                return "No data source selected.";
        }
    }

    /**
     * Get no connection message
     */
    private getNoConnectionMessage(): string {
        return "No connection to TestBench server. Please login first.";
    }

    /**
     * Get authentication required message
     */
    private getAuthRequiredMessage(): string {
        return "Authentication required. Please login to TestBench.";
    }

    /**
     * Get fetch error message
     */
    private getFetchErrorMessage(displayName: string): string {
        const errorDetail = this.state.lastError ? ` (${this.state.lastError.message})` : "";

        switch (this.config.treeViewType) {
            case TreeViewType.PROJECT_MANAGEMENT:
                return `Error fetching projects${errorDetail}. Please check connection or try refreshing.`;
            case TreeViewType.TEST_THEME:
                return `Error fetching test themes for "${displayName}"${errorDetail}. Check logs for details.`;
            case TreeViewType.TEST_ELEMENTS:
                return `Error fetching test elements for "${displayName}"${errorDetail}. Check logs for details.`;
            default:
                return `Error fetching data for "${displayName}"${errorDetail}. Check logs for details.`;
        }
    }

    /**
     * Get server no data message
     */
    private getServerNoDataMessage(displayName: string): string {
        switch (this.config.treeViewType) {
            case TreeViewType.PROJECT_MANAGEMENT:
                return "No projects found on the server. Create a project in TestBench or check permissions.";
            case TreeViewType.TEST_THEME:
                return `No test themes found for cycle "${displayName}".`;
            case TreeViewType.TEST_ELEMENTS:
                return `No test elements found on server for TOV "${displayName}".`;
            default:
                return `No data found for "${displayName}".`;
        }
    }

    /**
     * Get filtered out message
     */
    private getFilteredOutMessage(displayName: string): string {
        if (this.config.treeViewType === TreeViewType.TEST_ELEMENTS) {
            const filterPatterns = getExtensionConfiguration().get<string[]>(ConfigKeys.TB2ROBOT_RESOURCE_MARKER, []);
            if (filterPatterns && filterPatterns.length > 0) {
                return `All test elements (${this.state.itemsBeforeFiltering}) were filtered out by current filter criteria. Consider reviewing your resource marker settings.`;
            } else {
                return `Test elements were processed but none matched the display criteria for TOV "${displayName}".`;
            }
        }

        return `Data for "${displayName}" was filtered out by current criteria.`;
    }

    /**
     * Get processing error message
     */
    private getProcessingErrorMessage(displayName: string): string {
        switch (this.config.treeViewType) {
            case TreeViewType.PROJECT_MANAGEMENT:
                return "Error processing project data. The data may be corrupted or in an unexpected format.";
            case TreeViewType.TEST_THEME:
                return `Error processing test themes for "${displayName}". The data may be corrupted or in an unexpected format.`;
            case TreeViewType.TEST_ELEMENTS:
                return `Error processing test elements for "${displayName}". The data may be corrupted or in an unexpected format.`;
            default:
                return `Error processing data for "${displayName}". The data may be corrupted or in an unexpected format.`;
        }
    }

    /**
     * Get default empty message
     */
    private getDefaultEmptyMessage(displayName: string): string {
        switch (this.config.treeViewType) {
            case TreeViewType.PROJECT_MANAGEMENT:
                return "No projects available.";
            case TreeViewType.TEST_THEME:
                return displayName ? `No test themes available for "${displayName}".` : "No test themes available.";
            case TreeViewType.TEST_ELEMENTS:
                return displayName ? `No test elements available for "${displayName}".` : "No test elements available.";
            default:
                return displayName ? `No data available for "${displayName}".` : "No data available.";
        }
    }

    /**
     * Get default message for tree type
     */
    private getDefaultMessage(): string {
        switch (this.config.treeViewType) {
            case TreeViewType.PROJECT_MANAGEMENT:
                return "Projects";
            case TreeViewType.TEST_THEME:
                return "Test Themes";
            case TreeViewType.TEST_ELEMENTS:
                return "Test Elements";
            default:
                return "Tree View";
        }
    }

    /**
     * Gets diagnostic information about the current state
     */
    public getDiagnostics(): Record<string, any> {
        return {
            treeViewId: this.config.treeViewId,
            treeViewType: this.config.treeViewType,
            currentState: this.state,
            lastMessage: this.generateMessage(),
            timestamp: new Date().toISOString()
        };
    }
}
