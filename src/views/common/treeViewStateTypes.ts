/**
 * @file src/views/common/treeViewStateTypes.ts
 * @description Common interfaces and types for tree view state management
 */

/**
 * Enum representing different states that can lead to an empty tree view
 */
export enum TreeViewEmptyState {
    /** Tree view is in initial state */
    NOT_INITIALIZED = "not_initialized",
    /** No data source selected (e.g., no project, no cycle, no TOV) */
    NO_DATA_SOURCE = "no_data_source",
    /** Error occurred while fetching data */
    FETCH_ERROR = "fetch_error",
    /** Server returned empty data */
    SERVER_NO_DATA = "server_no_data",
    /** Data was filtered out by user settings */
    FILTERED_OUT = "filtered_out",
    /** Error occurred while processing data */
    PROCESSING_ERROR = "processing_error",
    /** No connection available */
    NO_CONNECTION = "no_connection",
    /** Authentication required */
    AUTH_REQUIRED = "auth_required"
}

/**
 * Current operational state of the tree view
 */
export enum TreeViewOperationalState {
    /** Tree is loading data */
    LOADING = "loading",
    /** Tree has data and is ready */
    READY = "ready",
    /** Tree is empty but in a valid state */
    EMPTY = "empty",
    /** Tree is in an error state */
    ERROR = "error",
    /** Tree is refreshing data */
    REFRESHING = "refreshing"
}

/**
 * Interface representing the current state of a tree view
 */
export interface TreeViewState {
    /** Current operational state */
    operationalState: TreeViewOperationalState;
    /** If empty, the specific reason why */
    emptyState?: TreeViewEmptyState;
    /** Key/identifier of the current data source (project, cycle, TOV, etc.) */
    currentDataSourceKey: string;
    /** Human-readable label of the current data source */
    currentDataSourceLabel: string;
    /** Display name for user-facing messages */
    currentDataSourceDisplayName: string;
    /** Whether data fetch has been attempted */
    dataFetchAttempted: boolean;
    /** Whether server returned data (even if empty) */
    serverDataReceived: boolean;
    /** Number of items before filtering */
    itemsBeforeFiltering: number;
    /** Number of items after filtering */
    itemsAfterFiltering: number;
    /** Last error that occurred */
    lastError?: Error;
    /** Timestamp of last state change */
    lastUpdated: Date;
    /** Additional context-specific metadata */
    metadata?: Record<string, any>;
}

/**
 * Configuration for tree view state manager
 */
export interface TreeViewStateConfig {
    /** Unique identifier for this tree view */
    treeViewId: string;
    /** Type of tree view (for message customization) */
    treeViewType: TreeViewType;
    /** Default message when no data source is selected */
    noDataSourceMessage?: string;
    /** Message template for loading state */
    loadingMessageTemplate?: string;
    /** Custom message resolver function */
    customMessageResolver?: (state: TreeViewState) => string | undefined;
}

/**
 * Types of tree views for message customization
 */
export enum TreeViewType {
    PROJECT_MANAGEMENT = "project_management",
    TEST_THEME = "test_theme",
    TEST_ELEMENTS = "test_elements"
}

/**
 * Result of state update operation
 */
export interface StateUpdateResult {
    /** Whether the state actually changed */
    stateChanged: boolean;
    /** Previous state if changed */
    previousState?: TreeViewState;
    /** New message to display */
    newMessage?: string;
}

/**
 * Parameters for updating tree view state
 */
export interface StateUpdateParams {
    /** New operational state */
    operationalState?: TreeViewOperationalState;
    /** New empty state (if empty) */
    emptyState?: TreeViewEmptyState;
    /** Data source key */
    dataSourceKey?: string;
    /** Data source label */
    dataSourceLabel?: string;
    /** Data source display name */
    dataSourceDisplayName?: string;
    /** Whether data fetch was attempted */
    dataFetchAttempted?: boolean;
    /** Whether server returned data */
    serverDataReceived?: boolean;
    /** Items before filtering */
    itemsBeforeFiltering?: number;
    /** Items after filtering */
    itemsAfterFiltering?: number;
    /** Error that occurred */
    error?: Error;
    /** Additional metadata */
    metadata?: Record<string, any>;
}
