/**
 * @file src/treeViews/state/StateTypes.ts
 * @description Type definitions for tree view state management.
 */

import { TreeItemBase } from "../core/TreeItemBase";

/**
 * Main tree view state interface
 */
export interface TreeViewState {
    // Core state
    loading: boolean;
    error: Error | null;
    initialized: boolean;
    lastRefresh: number;
    lastSessionToken?: string;

    // Item tracking
    items: Map<string, TreeItemBase>;
    rootItems: string[];

    // Feature states
    customRoot: CustomRootState | null;
    marking: MarkingState | null;
    expansion: ExpansionState | null;
    filtering: FilterState | null;

    // Selection and context
    selectedItemId: string | null;
    selectedProjectKey: string | null;
    selectedCycleKey: string | null;
    selectedTovKey: string | null;

    // Additional metadata
    metadata: Record<string, any>;
}

/**
 * Custom root state
 */
export interface CustomRootState {
    active: boolean;
    rootItemId: string | null;
    rootItemPath: string[];
    originalTitle: string;
    contextData: Record<string, any>;
}

/**
 * Marking state for items
 */
export interface MarkingState {
    markedItems: Map<string, MarkingInfo>;
    hierarchies: Map<string, MarkingHierarchy>;
}

export interface MarkingInfo {
    itemId: string;
    projectKey: string;
    cycleKey: string;
    timestamp: number;
    type: string;
    metadata?: Record<string, any>;
}

export interface MarkingHierarchy {
    rootId: string;
    descendantIds: Set<string>;
}

/**
 * Expansion state for tree items
 */
export interface ExpansionState {
    expandedItems: Set<string>;
    collapsedItems: Set<string>;
    defaultExpanded: boolean;
}

/**
 * Filtering state
 */
export interface FilterState {
    activeFilters: string[];
    customFilters: FilterDefinition[];
    hiddenItems: Set<string>;
    textFilter?: {
        searchText: string;
        caseSensitive: boolean;
        searchInLabel: boolean;
        searchInUniqueId: boolean;
        searchInDescription: boolean;
    } | null;
    filterDiffState?: {
        enabled: boolean;
        filteredItems: string[];
        originalIcons: Array<[string, any]>;
    };
}

export interface FilterDefinition {
    id: string;
    name: string;
    predicate: ((item: TreeItemBase) => boolean) | string;
    enabled: boolean;
    metadata?: Record<string, any>;
}

/**
 * State change event
 */
export interface StateChange {
    field: keyof TreeViewState;
    oldValue: any;
    newValue: any;
    timestamp: number;
}

/**
 * State snapshot for history
 */
export interface StateSnapshot {
    state: TreeViewState;
    timestamp: number;
    description?: string;
}

/**
 * Persistence configuration
 */
export interface PersistenceConfig {
    strategy: "workspace" | "global" | "none";
    autoSave: boolean;
    saveDebounce: number;
    includeCustomRoot: boolean;
    includeExpansion: boolean;
    includeMarking: boolean;
}

/**
 * State manager options
 */
export interface StateManagerOptions {
    treeViewId: string;
    persistence?: PersistenceConfig;
    maxHistorySize?: number;
    enableHistory?: boolean;
}

/**
 * Serialized state for storage
 */
export interface SerializedTreeViewState {
    version: number;
    treeViewId: string;
    timestamp: number;
    state: {
        loading: boolean;
        error: { message: string; stack?: string } | null;
        initialized: boolean;
        lastRefresh: number;
        lastSessionToken?: string;
        items: Array<[string, any]>;
        rootItems: string[];
        customRoot: SerializedCustomRootState | null;
        marking: SerializedMarkingState | null;
        expansion: SerializedExpansionState | null;
        filtering: SerializedFilterState | null;
        selectedItemId: string | null;
        selectedProjectKey: string | null;
        selectedCycleKey: string | null;
        selectedTovKey: string | null;
        metadata: Record<string, any>;
    };
}

export interface SerializedCustomRootState {
    active: boolean;
    rootItemId: string | null;
    rootItemPath: string[];
    originalTitle: string;
    contextData: Record<string, any>;
}

export interface SerializedMarkingState {
    markedItems: Array<[string, MarkingInfo]>;
    hierarchies: Array<[string, { rootId: string; descendantIds: string[] }]>;
}

export interface SerializedExpansionState {
    expandedItems: string[];
    collapsedItems: string[];
    defaultExpanded: boolean;
}

export interface SerializedFilterState {
    activeFilters: string[];
    customFilters: Array<{
        id: string;
        name: string;
        predicate: string;
        enabled: boolean;
        metadata?: Record<string, any>;
    }>;
    hiddenItems: string[];
    textFilter?: {
        searchText: string;
        caseSensitive: boolean;
        searchInLabel: boolean;
        searchInUniqueId: boolean;
        searchInDescription: boolean;
    } | null;
    filterDiffState?: {
        enabled: boolean;
        filteredItems: string[];
        originalIcons: Array<[string, any]>;
    };
}
