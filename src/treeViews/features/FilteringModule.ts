/**
 * @file src/treeViews/features/FilteringModule.ts
 * @description Module for filtering tree items with text search and filter diff mode
 */

import { TreeViewModule } from "../core/TreeViewModule";
import { TreeViewContext } from "../core/TreeViewContext";
import { TreeItemBase } from "../core/TreeItemBase";
import { FilterState, FilterDefinition, SerializedFilterDefinition } from "../state/StateTypes";
import * as vscode from "vscode";
import { ContextKeys } from "../../constants";

export interface TextFilterOptions {
    searchText: string;
    caseSensitive: boolean;
    searchInLabel: boolean;
    searchInId: boolean;
    searchInDescription: boolean;
    searchInTooltip: boolean;
    searchInType: boolean;
    showParentsOfMatches: boolean;
    showChildrenOfMatches: boolean;
}

export interface FilterDiffState {
    enabled: boolean;
    filteredItems: Set<string>;
    originalIcons: Map<string, vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } | vscode.Uri>;
}

export class FilteringModule implements TreeViewModule {
    readonly id = "filtering";

    private context!: TreeViewContext;
    private filterState: FilterState;
    private compiledFilters = new Map<string, (item: TreeItemBase) => boolean>();
    private definedFilters = new Map<string, FilterDefinition>();
    private textFilter: TextFilterOptions | null = null;
    private filterDiffState: FilterDiffState = {
        enabled: false,
        filteredItems: new Set(),
        originalIcons: new Map()
    };

    constructor() {
        this.filterState = {
            activeFilters: [],
            customFilters: [],
            hiddenItems: new Set()
        };
    }

    /**
     * Initializes the filtering module with context and load saved state
     * @param context The tree view context
     */
    async initialize(context: TreeViewContext): Promise<void> {
        this.context = context;

        const filteringConfig = context.config.modules.filtering;
        if (filteringConfig?.defaultFilters) {
            filteringConfig.defaultFilters.forEach((filter) => {
                this.definedFilters.set(filter.id, filter);
            });
        }

        // Load saved filter state
        const state = context.stateManager.getState();
        if (state.filtering) {
            this.applyLoadedFilterState(state.filtering);

            // Restore filter diff state if it exists
            if (state.filtering.filterDiffState) {
                this.filterDiffState.enabled = state.filtering.filterDiffState.enabled || false;
                this.filterDiffState.filteredItems = new Set(state.filtering.filterDiffState.filteredItems || []);
                // Note: originalIcons are not restored as they are only needed during active diff mode

                // Update context keys to reflect the restored state
                this.updateDiffModeContextKeys(this.filterDiffState.enabled);
            }
        } else if (filteringConfig?.defaultFilters) {
            // If no state, initialize with defaults from config
            this.filterState.customFilters = [...filteringConfig.defaultFilters];
            this.compileFilters();
        }

        // Listen for state changes
        context.eventBus.on("state:changed", (event) => {
            if (event.data?.filtering) {
                this.applyLoadedFilterState(event.data.filtering);
            }
        });

        context.logger.trace(context.buildLogPrefix("FilteringModule", "Filtering module initialized."));
    }

    /**
     * Applies loaded state (which has no predicate functions) with the full
     * filter definitions from the configuration.
     * @param loadedFilteringState The partial filter state loaded from persistence.
     */
    private applyLoadedFilterState(loadedFilteringState: any): void {
        const customFilters: FilterDefinition[] = [];
        if (loadedFilteringState.customFilters) {
            (loadedFilteringState.customFilters as SerializedFilterDefinition[]).forEach((savedFilter) => {
                const definedFilter = this.definedFilters.get(savedFilter.id);
                if (definedFilter) {
                    // Create a complete filter definition by combining persisted state with the defined predicate
                    customFilters.push({
                        ...definedFilter,
                        enabled: savedFilter.enabled,
                        metadata: savedFilter.metadata
                    });
                }
            });
        }

        this.filterState = {
            activeFilters: loadedFilteringState.activeFilters || [],
            customFilters: customFilters,
            hiddenItems: new Set(loadedFilteringState.hiddenItems || [])
        };

        this.compileFilters();
    }

    /**
     * Gets default text filter options from configuration
     * @return Default text filter options
     */
    public getDefaultTextFilterOptions(): Partial<TextFilterOptions> {
        const filteringConfig = this.context.config.modules.filtering;
        if (!filteringConfig) {
            return {
                caseSensitive: false,
                searchInLabel: true,
                searchInId: false,
                searchInDescription: false,
                searchInTooltip: false,
                searchInType: false,
                showParentsOfMatches: true,
                showChildrenOfMatches: false
            };
        }

        return {
            caseSensitive: false,
            searchInLabel: true,
            searchInId: false,
            searchInDescription: false,
            searchInTooltip: false,
            searchInType: false,
            showParentsOfMatches: filteringConfig.showParentsOfMatches ?? true,
            showChildrenOfMatches: filteringConfig.showChildrenOfMatches || false
        };
    }

    /**
     * Sets text-based filter options
     * @param options Text filter options or null to clear
     */
    public setTextFilter(options: TextFilterOptions | null): void {
        this.textFilter = options;
        this.context.logger.debug(
            this.context.buildLogPrefix(
                "FilteringModule",
                `Text filter ${options ? "set" : "cleared"}: ${options?.searchText || "none"}`
            )
        );
        this.updateState();
        this.context.refresh({ immediate: true });
    }

    /**
     * Gets current text filter
     * @return Current text filter options or null
     */
    public getTextFilter(): TextFilterOptions | null {
        return this.textFilter;
    }

    /**
     * Enables or disables filter diff mode
     * @param enabled Whether to enable or disable filter diff mode
     */
    public setFilterDiffMode(enabled: boolean): void {
        this.filterDiffState.enabled = enabled;
        this.context.logger.debug(
            this.context.buildLogPrefix("FilteringModule", `Filter diff mode ${enabled ? "enabled" : "disabled"}`)
        );

        // Update context keys to control which diff button icon is shown
        this.updateDiffModeContextKeys(enabled);

        if (enabled) {
            this.calculateFilteredItems();
        } else {
            this.restoreOriginalIcons();
        }

        this.updateState();
        this.context.refresh({ immediate: true });
    }

    /**
     * Updates context keys to control diff button icon visibility
     * @param enabled Whether diff mode is enabled
     */
    private updateDiffModeContextKeys(enabled: boolean): void {
        const treeViewId = this.context.config.id;
        let contextKey: string;

        switch (treeViewId) {
            case "testbench.projects":
                contextKey = ContextKeys.FILTER_DIFF_MODE_ENABLED_PROJECTS;
                break;
            case "testbench.testThemes":
                contextKey = ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_THEMES;
                break;
            case "testbench.testElements":
                contextKey = ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_ELEMENTS;
                break;
            default:
                contextKey = ContextKeys.FILTER_DIFF_MODE_ENABLED;
        }

        // Use VS Code's setContext command to update the context key
        // This will trigger the UI to show the appropriate diff button icon
        vscode.commands.executeCommand("setContext", contextKey, enabled);
    }

    /**
     * Gets filter diff state
     * @return Current filter diff state
     */
    public getFilterDiffState(): FilterDiffState {
        return this.filterDiffState;
    }

    /**
     * Calculates which items are filtered for diff mode
     */
    private calculateFilteredItems(): void {
        this.filterDiffState.filteredItems.clear();
        this.filterDiffState.originalIcons.clear();

        const allTreeItems = this.getAllItems();

        for (const item of allTreeItems) {
            if (item.id) {
                const isFiltered = !this.doesTreeItemMatchesAllFilters(item);
                if (isFiltered) {
                    this.filterDiffState.filteredItems.add(item.id);
                    // Store original icon
                    if (item.iconPath && typeof item.iconPath !== "string") {
                        this.filterDiffState.originalIcons.set(item.id, item.iconPath);
                    }
                }
            }
        }

        this.context.logger.debug(
            this.context.buildLogPrefix(
                "FilteringModule",
                `Filter diff mode marked ${this.filterDiffState.filteredItems.size} items as filtered`
            )
        );
    }

    /**
     * Restores original icons when filter diff is disabled
     */
    private restoreOriginalIcons(): void {
        for (const [itemId, originalIcon] of this.filterDiffState.originalIcons) {
            const item = this.findTreeItemById(itemId);
            if (item) {
                item.iconPath = originalIcon;
            }
        }
        this.filterDiffState.originalIcons.clear();
    }

    /**
     * Gets all items in the tree recursively
     * @return Array of all tree items
     */
    private getAllItems(): TreeItemBase[] {
        const items: TreeItemBase[] = [];
        const collectItems = (itemList: TreeItemBase[]) => {
            for (const item of itemList) {
                items.push(item);
                if (item.children && item.children.length > 0) {
                    collectItems(item.children);
                }
            }
        };
        const rootItems = this.context.getCurrentRootItems();
        if (rootItems) {
            collectItems(rootItems);
        }

        return items;
    }

    /**
     * Finds tree item by ID in the tree
     * @param itemId The tree item ID to search for
     * @return Found tree item or null
     */
    private findTreeItemById(itemId: string): TreeItemBase | null {
        const findInTreeItems = (itemList: TreeItemBase[]): TreeItemBase | null => {
            for (const item of itemList) {
                if (item.id === itemId) {
                    return item;
                }
                if (item.children && item.children.length > 0) {
                    const found = findInTreeItems(item.children);
                    if (found) {
                        return found;
                    }
                }
            }
            return null;
        };

        const rootItems = this.context.getCurrentRootItems();
        return rootItems ? findInTreeItems(rootItems) : null;
    }

    /**
     * Checks if tree item matches text filter criteria
     * @param item The tree item to check
     * @return True if tree item matches text filter
     */
    private doesItemMatchesTextFilter(item: TreeItemBase): boolean {
        if (!this.textFilter || !this.textFilter.searchText.trim()) {
            return true;
        }

        const searchText = this.textFilter.searchText;
        const searchTextLower = this.textFilter.caseSensitive ? searchText : searchText.toLowerCase();
        // Search in label
        if (this.textFilter.searchInLabel && item.label) {
            const label = this.textFilter.caseSensitive ? item.label.toString() : item.label.toString().toLowerCase();
            if (label.includes(searchTextLower)) {
                return true;
            }
        }

        // Search in description
        if (this.textFilter.searchInDescription && item.description) {
            const description = this.textFilter.caseSensitive
                ? item.description.toString()
                : item.description.toString().toLowerCase();
            if (description.includes(searchTextLower)) {
                return true;
            }
        }

        // Search in tooltip
        if (this.textFilter.searchInTooltip && item.tooltip) {
            const tooltip = this.textFilter.caseSensitive
                ? item.tooltip.toString()
                : item.tooltip.toString().toLowerCase();
            if (tooltip.includes(searchTextLower)) {
                return true;
            }
        }

        // Search in ID
        if (this.textFilter.searchInId && item.id) {
            const id = this.textFilter.caseSensitive ? item.id : item.id.toLowerCase();
            if (id.includes(searchTextLower)) {
                return true;
            }
        }

        // Search in Type (contextValue)
        if (this.textFilter.searchInType && item.contextValue) {
            const type = this.textFilter.caseSensitive ? item.contextValue : item.contextValue.toLowerCase();
            if (type.includes(searchTextLower)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Checks if tree item matches all active filters
     * @param item The tree item to check
     * @return True if tree item matches all filters
     */
    private doesTreeItemMatchesAllFilters(item: TreeItemBase): boolean {
        if (!this.doesItemMatchesTextFilter(item)) {
            return false;
        }

        // Check custom filters
        for (const filterId of this.filterState.activeFilters) {
            const filterFunction = this.compiledFilters.get(filterId);
            if (filterFunction && !filterFunction(item)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Applies filter diff visual indicators to tree item
     * @param item The tree item to apply visuals to
     */
    public applyFilterDiffVisualsToTreeItem(item: TreeItemBase): void {
        if (!this.filterDiffState.enabled || !item.id) {
            return;
        }

        const isFiltered = this.filterDiffState.filteredItems.has(item.id);
        if (isFiltered) {
            // Apply filtered icon
            item.iconPath = {
                light: vscode.Uri.joinPath(
                    this.context.extensionContext.extensionUri,
                    "resources",
                    "icons",
                    "block-light.svg"
                ),
                dark: vscode.Uri.joinPath(
                    this.context.extensionContext.extensionUri,
                    "resources",
                    "icons",
                    "block-dark.svg"
                )
            };
        }
    }

    /**
     * Registers or updates a filter definition.
     * If the filter already exists, it will be updated with the new filter.
     * @param filter The filter definition to register
     */
    public registerFilter(filter: FilterDefinition): void {
        // Store the full definition
        this.definedFilters.set(filter.id, filter);

        const existingFilterIndex = this.filterState.customFilters.findIndex((f) => f.id === filter.id);
        if (existingFilterIndex > -1) {
            this.filterState.customFilters[existingFilterIndex] = filter;
        } else {
            this.filterState.customFilters.push(filter);
        }

        if (filter.enabled) {
            this.compileFilter(filter);
        }

        this.updateState();
    }

    /**
     * Toggles a filter on or off
     * @param filterId The ID of the filter to toggle
     * @param enabled Whether to enable or disable the filter
     */
    public toggleFilter(filterId: string, enabled: boolean): void {
        const filter = this.filterState.customFilters.find((f) => f.id === filterId);
        if (!filter) {
            return;
        }

        filter.enabled = enabled;
        if (enabled) {
            this.compileFilter(filter);
            if (!this.filterState.activeFilters.includes(filterId)) {
                this.filterState.activeFilters.push(filterId);
            }
        } else {
            this.compiledFilters.delete(filterId);
            this.filterState.activeFilters = this.filterState.activeFilters.filter((id) => id !== filterId);
        }

        this.updateState();
        this.context.refresh({ immediate: true });
    }

    /**
     * Filters an array of tree items based on active filters, preserving the hierarchy.
     * @param items Array of tree items to filter
     * @return Filtered array of tree items
     */
    public filterTreeItems<T extends TreeItemBase>(items: T[]): T[] {
        if (!this.isActive()) {
            return items;
        }

        this.context.logger.trace(
            this.context.buildLogPrefix(
                "FilteringModule",
                `Filtering ${items.length} items. Filter: ${JSON.stringify(this.textFilter)}`
            )
        );

        if (this.filterDiffState.enabled) {
            this.context.logger.debug(
                this.context.buildLogPrefix(
                    "FilteringModule",
                    "Filter diff mode enabled, skipping hierarchical filtering."
                )
            );
            return items;
        }

        const recursiveFilter = (itemList: T[]): T[] => {
            const result: T[] = [];
            for (const item of itemList) {
                // Recursively filter children first
                const filteredChildren = item.children ? recursiveFilter(item.children as T[]) : [];

                const itemIsVisible = this.isVisible(item);

                // An item is kept if it's visible itself, OR if it has any visible children
                if (itemIsVisible || filteredChildren.length > 0) {
                    // Clone the item to avoid modifying the original tree
                    const newItem = item.clone() as T;
                    newItem.children = filteredChildren; // Assign the filtered children
                    // Ensure parent references are correct in the new filtered tree
                    filteredChildren.forEach((child) => (child.parent = newItem));
                    result.push(newItem);
                }
            }
            return result;
        };

        const filteredItems = recursiveFilter(items);
        this.context.logger.debug(
            this.context.buildLogPrefix(
                "FilteringModule",
                `Filtered ${items.length} root items down to ${filteredItems.length} visible items in hierarchy`
            )
        );
        this.context.logger.trace(
            this.context.buildLogPrefix(
                "FilteringModule",
                `Filtering complete. Returning ${filteredItems.length} items.`
            )
        );
        return filteredItems;
    }

    /**
     * Determines if a tree item should be visible based on filters.
     * @param item The tree item to check visibility for
     * @return True if tree item should be visible
     */
    public isVisible(item: TreeItemBase): boolean {
        // Check if item is explicitly hidden
        if (item.id && this.filterState.hiddenItems.has(item.id)) {
            return false;
        }

        // Check if item matches filters (without parent/child inclusion logic)
        const matchesFilters = this.matchesTextFilterOnly(item);
        if (!this.textFilter) {
            return matchesFilters;
        }

        if (matchesFilters) {
            return true;
        }

        // Check if we should show children of matching items
        if (this.textFilter.showChildrenOfMatches && this.hasMatchingAncestor(item)) {
            return true;
        }

        return false;
    }

    /**
     * Checks if a tree item has matching ancestors
     * @param item The tree item to check
     * @return True if tree item has matching ancestors
     */
    private hasMatchingAncestor(item: TreeItemBase): boolean {
        let currentParent = item.parent;
        while (currentParent) {
            // Only check text filter criteria, not parent/child inclusion
            if (this.matchesTextFilterOnly(currentParent)) {
                return true;
            }
            currentParent = currentParent.parent;
        }

        return false;
    }

    /**
     * Checks if tree item matches text filter criteria only
     * @param item The tree item to check
     * @return True if tree item matches text filter
     */
    private matchesTextFilterOnly(item: TreeItemBase): boolean {
        if (!this.doesItemMatchesTextFilter(item)) {
            return false;
        }

        // Check custom filters (but not parent/child inclusion)
        for (const filterId of this.filterState.activeFilters) {
            const filterFunction = this.compiledFilters.get(filterId);
            if (filterFunction && !filterFunction(item)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Hides a tree item from view
     * @param item The tree item to hide
     */
    public hideItem(item: TreeItemBase): void {
        if (item.id) {
            this.filterState.hiddenItems.add(item.id);
            this.updateState();
            this.context.refresh({ immediate: true });
        }
    }

    /**
     * Shows a previously hidden tree item
     * @param item The tree item to show
     */
    public showItem(item: TreeItemBase): void {
        if (item.id && this.filterState.hiddenItems.has(item.id)) {
            this.filterState.hiddenItems.delete(item.id);
            this.updateState();
            this.context.refresh({ immediate: true });
        }
    }

    /**
     * Hides a tree item by its ID
     * @param itemId The ID of the tree item to hide
     */
    public hideItemById(itemId: string): void {
        this.filterState.hiddenItems.add(itemId);
        this.updateState();
        this.context.refresh({ immediate: true });
    }

    /**
     * Shows a tree item by its ID
     * @param itemId The ID of the tree item to show
     */
    public showItemById(itemId: string): void {
        if (this.filterState.hiddenItems.has(itemId)) {
            this.filterState.hiddenItems.delete(itemId);
            this.updateState();
            this.context.refresh({ immediate: true });
        }
    }

    /**
     * Toggles visibility of a tree item
     * @param item The tree item to toggle visibility for
     */
    public toggleItemVisibility(item: TreeItemBase): void {
        if (!item.id) {
            return;
        }

        if (this.filterState.hiddenItems.has(item.id)) {
            this.showItem(item);
        } else {
            this.hideItem(item);
        }
    }

    /**
     * Clears all hidden items
     */
    public clearHiddenItems(): void {
        this.filterState.hiddenItems.clear();
        this.updateState();
        this.context.refresh({ immediate: true });
    }

    /**
     * Clears all active filters and hidden items
     */
    public clearAllFilters(): void {
        this.textFilter = null;
        this.filterState.activeFilters = [];
        this.filterState.hiddenItems.clear();
        this.compiledFilters.clear();
        this.filterDiffState.enabled = false;
        this.filterDiffState.filteredItems.clear();
        this.filterDiffState.originalIcons.clear();

        // Update context keys to reflect that diff mode is disabled
        this.updateDiffModeContextKeys(false);

        this.updateState();
        this.context.refresh({ immediate: true });
        this.context.logger.debug(this.context.buildLogPrefix("FilteringModule", "All filters cleared"));
    }

    /**
     * Checks if any filters are currently active
     * @return True if any filters are active
     */
    public isActive(): boolean {
        return (
            this.filterState.activeFilters.length > 0 ||
            this.filterState.hiddenItems.size > 0 ||
            this.textFilter !== null ||
            this.filterDiffState.enabled
        );
    }

    /**
     * Gets all currently active filters
     * @return Array of active filter definitions
     */
    public getActiveFilters(): FilterDefinition[] {
        return this.filterState.customFilters.filter(
            (filter) => filter.enabled && this.filterState.activeFilters.includes(filter.id)
        );
    }

    /**
     * Removes a filter by ID
     * @param filterId The ID of the filter to remove
     */
    public removeFilter(filterId: string): void {
        this.filterState.customFilters = this.filterState.customFilters.filter((filter) => filter.id !== filterId);
        this.filterState.activeFilters = this.filterState.activeFilters.filter((id) => id !== filterId);
        this.compiledFilters.delete(filterId);
        this.updateState();
        this.context.refresh({ immediate: true });
    }

    /**
     * Compiles a filter definition into an executable predicate function
     * @param filter The filter definition to compile
     */
    private compileFilter(filter: FilterDefinition): void {
        try {
            this.compiledFilters.set(filter.id, filter.predicate);
        } catch (error) {
            this.context.logger.error(
                this.context.buildLogPrefix("FilteringModule", `Failed to compile filter ${filter.id}:`),
                error
            );
        }
    }

    /**
     * Compiles all enabled filters into executable predicate functions
     */
    private compileFilters(): void {
        this.compiledFilters.clear();
        for (const filter of this.filterState.customFilters) {
            if (filter.enabled) {
                this.compileFilter(filter);
            }
        }
    }

    /**
     * Updates the state manager with current filtering state
     */
    private updateState(): void {
        this.context.stateManager.setState({
            filtering: {
                ...this.filterState,
                textFilter: this.textFilter,
                filterDiffState: {
                    enabled: this.filterDiffState.enabled,
                    filteredItems: Array.from(this.filterDiffState.filteredItems),
                    originalIcons: Array.from(this.filterDiffState.originalIcons.entries())
                }
            }
        });
    }

    /**
     * Disposes the filtering module and cleans up resources
     */
    public dispose(): void {
        this.compiledFilters.clear();
        this.filterDiffState.originalIcons.clear();
    }
}
