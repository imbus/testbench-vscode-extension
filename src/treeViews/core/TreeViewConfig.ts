/**
 * @file src/treeViews/core/TreeViewConfig.ts
 * @description Configuration interface for tree views.
 */

export interface TreeViewConfig {
    // Core settings
    id: string;
    title: string;
    contextValue: string;

    // Feature toggles
    features: {
        customRoot: boolean;
        marking: boolean;
        persistence: boolean;
        filtering: boolean;
        icons: boolean;
        expansion: boolean;
    };

    // Module configurations
    modules: {
        customRoot?: CustomRootConfig;
        marking?: MarkingConfig;
        persistence?: PersistenceConfig;
        filtering?: FilterConfig;
        icons?: IconConfig;
        expansion?: ExpansionConfig;
    };

    // Behavior settings
    behavior: {
        refreshStrategy: "full" | "incremental" | "smart";
        errorHandling: "silent" | "notify" | "throw";
        // Optional maximum time limit for data loading operations in tree views to prevent tree views
        // from hanging indefinitely when data fetching operations take too long.
        // If not set, operations will wait indefinitely.
        loadingTimeout?: number;
        // Delay between consecutive refresh operations to prevent excessive refreshes.
        debounceDelay: number;
    };

    // UI settings
    ui: {
        emptyMessage: string;
        loadingMessage: string;
        errorMessage: string;
        showTooltips: boolean;
        tooltipFormat: string;
    };
}

export interface CustomRootConfig {
    enabled: boolean;
    contextKey: string;
    allowedItemTypes: string[];
    persistAcrossSessions: boolean;
    maxDepth?: number;
}

export interface MarkingConfig {
    enabled: boolean;
    strategies: string[];
    persistMarks: boolean;
    showImportButton: boolean;
    allowPersistentImport: boolean;
    markingContextValues: string[];
}

export interface PersistenceConfig {
    strategy: "workspace" | "global" | "none";
    autoSave: boolean;
    saveDebounce: number;
    includeCustomRoot: boolean;
    includeExpansion: boolean;
    includeMarking: boolean;
}

export interface FilterConfig {
    enabled: boolean;
    defaultFilters: FilterDefinition[];
    allowUserFilters: boolean;
    persistFilters: boolean;
    showParentsOfMatches: boolean;
    showChildrenOfMatches: boolean;
}

export interface FilterDefinition {
    id: string;
    name: string;
    predicate: (item: any) => boolean;
    enabled: boolean;
}

export interface IconConfig {
    theme: "default" | "minimal" | "colorful" | "custom";
    customMappings?: Record<string, string>;
    showStatusIcons: boolean;
    animateLoading: boolean;
}

export interface ExpansionConfig {
    rememberExpansion: boolean;
    defaultExpanded: boolean;
    expandedLevels: number; // (Not used) How many levels to expand by default
    collapseOnRefresh: boolean;
}
