/**
 * @file src/treeViews/core/TreeViewBase.ts
 * @description Base class for tree views.
 * Provides the base functionality for all tree views.
 * Includes methods for managing modules, context, state, and data.
 */

import * as vscode from "vscode";
import { TreeItemBase } from "./TreeItemBase";
import { TreeViewConfig } from "./TreeViewConfig";
import { TreeViewContext, TreeViewContextImpl } from "./TreeViewContext";
import { TreeViewModule } from "./TreeViewModule";
import { ModuleRegistry } from "./ModuleRegistry";
import { StateManager } from "../state/StateManager";
import { EventBus } from "../utils/EventBus";
import { TestBenchLogger } from "../../testBenchLogger";
import { FilteringModule } from "../features/FilteringModule";
import { TreeViewTiming } from "../../constants";
import { IconModule } from "../features/IconModule";
import { userSessionManager } from "../../extension";
import { PersistenceModule } from "../features/PersistenceModule";
import { CacheManager } from "../../core/cacheManager";

const ROOT_ITEMS_CACHE_KEY = "root_items";

export interface RefreshOptions {
    immediate?: boolean;
    skipDataReload?: boolean;
}

export abstract class TreeViewBase<T extends TreeItemBase> implements vscode.TreeDataProvider<T> {
    protected readonly _onDidChangeTreeData = new vscode.EventEmitter<T | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    protected readonly modules = new Map<string, TreeViewModule>();
    protected readonly context: TreeViewContext;
    public readonly stateManager: StateManager;
    public readonly logger: TestBenchLogger;
    public readonly eventBus: EventBus;
    protected vscTreeView: vscode.TreeView<T> | undefined;

    protected rootItemsCache: CacheManager<string, T[]>;
    protected rootItems: T[] = [];
    private _disposed = false;
    private _initialized = false;
    private _isLoading = false;
    private _dataFetchDebounceTimeout: NodeJS.Timeout | undefined;
    private _intentionallyCleared = false;

    /**
     * Generates a consistent log prefix that includes the tree view ID
     * @param operation The operation being logged
     * @returns A formatted log prefix string
     */
    private buildLogPrefix(operation: string): string {
        return `[TreeViewBase:${this.config.id}] ${operation}`;
    }

    constructor(
        protected readonly extensionContext: vscode.ExtensionContext,
        public readonly config: TreeViewConfig
    ) {
        this.logger = new TestBenchLogger();
        this.eventBus = new EventBus();
        this.stateManager = new StateManager(extensionContext, config.id, this.eventBus, userSessionManager);
        this.context = new TreeViewContextImpl(
            extensionContext,
            config,
            this.stateManager,
            this.eventBus,
            this.logger,
            this
        );
        this.rootItemsCache = new CacheManager<string, T[]>(TreeViewTiming.TREE_DATA_FRESHNESS_THRESHOLD_MS);

        this.eventBus.on("connection:changed", async (event) => {
            const { connected } = event.data;
            if (connected) {
                await this.loadData();
            } else {
                this.clearTree();
            }
        });

        this.eventBus.on("state:changed", () => {
            this.handleStateChange();
        });
    }

    /**
     * Sets the VS Code tree view reference for this tree view
     * @param treeView The VS Code tree view instance
     */
    public setTreeView(treeView: vscode.TreeView<T>): void {
        this.vscTreeView = treeView;
        this.updateTreeViewMessage();
    }

    /**
     * Updates the title of the tree view
     * @param title The new title to set
     */
    public updateTitle(title: string): void {
        if (this.vscTreeView) {
            this.vscTreeView.title = title;
        }
    }

    /**
     * Resets the title to the default title from config
     */
    public resetTitle(): void {
        if (this.vscTreeView) {
            this.vscTreeView.title = this.config.title;
        }
    }

    /**
     * Initializes the tree view and its modules
     * @returns Promise that resolves when initialization is complete
     */
    public async initialize(): Promise<void> {
        if (this._initialized) {
            this.logger.warn(this.buildLogPrefix("Tree view already initialized"));
            return;
        }

        try {
            this.logger.trace(this.buildLogPrefix("Initializing tree view"));

            // Load persistence state first before other modules to ensure expansion state
            // is available during tree rendering phase
            await this.initializePersistence();
            await this.initializeModules();

            // Don't load data during initialization, wait for connection event
            this._initialized = true;

            this.updateTreeViewMessage();

            // Set up event listeners for proper expansion tracking
            if (this.vscTreeView) {
                // Are already set up in TreeViewFactory
                this.eventBus.on("tree:itemExpanded", () => {
                    const expansionModule = this.getModule("expansion");
                    if (expansionModule && typeof expansionModule.forceSave === "function") {
                        setTimeout(() => expansionModule.forceSave(), 50);
                    }
                });

                this.eventBus.on("tree:itemCollapsed", () => {
                    const expansionModule = this.getModule("expansion");
                    if (expansionModule && typeof expansionModule.forceSave === "function") {
                        setTimeout(() => expansionModule.forceSave(), 50);
                    }
                });
            }
            this.logger.trace(this.buildLogPrefix("Tree view initialized successfully"));
        } catch (error) {
            this.logger.error(
                this.buildLogPrefix("Error during initialization"),
                error instanceof Error ? error : new Error(String(error))
            );
            throw error;
        }
    }

    /**
     * Checks if the tree view has been initialized
     * @returns True if initialized, false otherwise
     */
    public isInitialized(): boolean {
        return this._initialized;
    }

    /**
     * Initializes the persistence module to load saved state before other modules.
     * This ensures expansion state is available during tree rendering, preventing animation delays.
     * @returns Promise that resolves when persistence module is initialized
     */
    private async initializePersistence(): Promise<void> {
        const enabledModules = ModuleRegistry.createEnabledModules(this.config.features);
        const persistenceModule = enabledModules.get("persistence");

        if (persistenceModule) {
            try {
                this.registerModule(persistenceModule);
                await persistenceModule.initialize(this.context);
                this.logger.trace(
                    this.buildLogPrefix("Persistence module initialized first for immediate state availability.")
                );
            } catch (error) {
                this.logger.error(this.buildLogPrefix("Failed to initialize persistence module first:"), error);
            }
        }
    }

    /**
     * Initializes all enabled modules from the registry.
     * The modules are registered and then initialized.
     * If a module fails to initialize, it will continue with the other modules.
     * @returns Promise that resolves when all modules are initialized
     */
    protected async initializeModules(): Promise<void> {
        const enabledModules = ModuleRegistry.createEnabledModules(this.config.features);
        const modulePromises: Promise<void>[] = [];

        // Register all modules and initialize non-persistence modules
        for (const [moduleName, module] of enabledModules) {
            // Skip persistence module as it's already registered and initialized in initializePersistence
            if (moduleName === "persistence") {
                continue;
            }

            this.registerModule(module);
            modulePromises.push(
                module.initialize(this.context).catch((error) => {
                    this.logger.error(this.buildLogPrefix(`Failed to initialize module ${moduleName}:`), error);
                    // Continue with other modules even if one fails
                })
            );
        }

        await Promise.all(modulePromises);
    }

    /**
     * Registers a module with the tree view.
     * If the module is already registered, it will not be registered again.
     * @param module The module to register
     */
    protected registerModule(module: TreeViewModule): void {
        if (this.modules.has(module.id)) {
            return;
        }

        this.modules.set(module.id, module);
        this.logger.trace(this.buildLogPrefix(`Registered module: ${module.id}`));
    }

    /**
     * Gets a module by its ID
     * @param moduleId The ID of the module to retrieve
     * @returns The module instance or undefined if not found
     */
    public getModule<M extends TreeViewModule>(moduleId: string): M | undefined {
        return this.modules.get(moduleId) as M;
    }

    public async addModule(module: TreeViewModule): Promise<void> {
        if (this.modules.has(module.id)) {
            this.logger.warn(`[TreeViewBase] Module with ID '${module.id}' already exists.`);
            return;
        }
        this.registerModule(module);
        try {
            await module.initialize(this.context);
        } catch (error) {
            this.logger.error(this.buildLogPrefix(`Failed to initialize module ${module.id}:`), error);
        }
    }

    /**
     * Gets the current root items for modules that need access to all items
     * @returns Array of current root items
     */
    public getCurrentRootItems(): T[] {
        return this.rootItems;
    }

    /**
     * Converts a tree element to a VS Code tree item with applied module effects.
     * @param element The tree element to convert
     * @returns The VS Code tree item
     */
    getTreeItem(element: T): vscode.TreeItem {
        const markingModule = this.getModule("marking");
        if (markingModule && typeof markingModule.applyMarkingToItem === "function") {
            markingModule.applyMarkingToItem(element);
        }

        const filteringModule = this.getModule("filtering") as FilteringModule;
        if (filteringModule && typeof filteringModule.applyFilterDiffVisualsToTreeItem === "function") {
            filteringModule.applyFilterDiffVisualsToTreeItem(element);
        }

        const iconModule = this.getModule("icons") as IconModule | undefined;
        if (iconModule) {
            iconModule.setItemIcon(element);
        }

        const expansionModule = this.getModule("expansion");
        if (expansionModule) {
            expansionModule.applyExpansionState(element);
        }

        return element;
    }

    /**
     * Gets the parent of a tree element
     * @param element The element to get the parent for
     * @returns The parent element or undefined
     */
    getParent(element: T): vscode.ProviderResult<T> {
        return element.parent as T;
    }

    /**
     * Gets the children of a tree element with filtering and expansion applied
     * @param element The element to get children for, undefined for root
     * @returns Promise that resolves to array of child elements
     */
    async getChildren(element?: T): Promise<T[]> {
        try {
            this.logger.trace(this.buildLogPrefix(`getChildren called for: ${element?.label || "root"}`));

            let children: T[];

            if (!element) {
                children = await this.expandAll(await this.getRootItems());
            } else {
                const preFilteredChildren = element.getMetadata("_filteredChildren");
                if (preFilteredChildren && Array.isArray(preFilteredChildren)) {
                    // Use pre-filtered children to preserve item functionality during search
                    children = preFilteredChildren as T[];
                } else {
                    children = await this.getChildrenForItem(element);
                }
            }

            // Apply filtering if active
            const filterModule = this.getModule("filtering");
            if (filterModule && filterModule.isActive()) {
                if (!element) {
                    children = await this.expandAll(children);
                    children = filterModule.filterTreeItems(children);
                } else if (!element.getMetadata("_filteredChildren")) {
                    children = filterModule.filterTreeItems(children);
                }
            }

            const expansionModule = this.getModule("expansion");
            this.logger.trace(this.buildLogPrefix("Applying expansion state to children tree items"));
            if (expansionModule) {
                children.forEach((child) => expansionModule.applyExpansionState(child));

                // Preload children for items that should be expanded to eliminate expansion animation delay
                await this.preloadChildrenForExpandedItems(children);
            }

            return children;
        } catch (error) {
            const emptyArray: T[] = [];
            this.logger.error(this.buildLogPrefix("Failed to get children"), error as Error);
            return emptyArray;
        }
    }

    /**
     * Preloads children for items that should be expanded to eliminate expansion animation delay.
     * This ensures that when VS Code renders items with collapsibleState = Expanded,
     * their children are already available in memory.
     * @param items Array of tree items to check for expansion state
     * @returns Promise that resolves when all expanded items have their children preloaded
     */
    private async preloadChildrenForExpandedItems(items: T[]): Promise<void> {
        const preloadPromises: Promise<void>[] = [];

        for (const item of items) {
            if (item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                preloadPromises.push(this.preloadChildrenForSingleItem(item));
            }
        }

        if (preloadPromises.length > 0) {
            this.logger.trace(this.buildLogPrefix(`Preloading children for ${preloadPromises.length} expanded items`));
            await Promise.all(preloadPromises);
        }
    }

    /**
     * Preloads children for a single expanded item.
     * @param item The tree item to preload children for
     * @returns Promise that resolves when children are preloaded
     */
    private async preloadChildrenForSingleItem(item: T): Promise<void> {
        try {
            if (!item.children || item.children.length === 0) {
                const children = await this.getChildrenForItem(item);
                item.children = children;
                this.logger.trace(
                    this.buildLogPrefix(`Preloaded ${children.length} children for expanded item: ${item.label}`)
                );
            }
        } catch (error) {
            this.logger.trace(
                this.buildLogPrefix(`Failed to preload children for item ${item.id || item.label}:`),
                error
            );
        }
    }

    /**
     * Recursively expands all items in a given list of tree items.
     * @param items The list of items to expand.
     * @returns The list of items with all descendants loaded.
     */
    private async expandAll(items: T[]): Promise<T[]> {
        for (const item of items) {
            if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None && item.children.length === 0) {
                const children = await this.getChildrenForItem(item);
                item.children = children;
                await this.expandAll(children);
            }
        }
        return items;
    }

    /**
     * Retrieves root items with caching and loading logic
     * @return Promise resolving to array of root tree items
     */
    protected async getRootItems(): Promise<T[]> {
        const cachedItems = this.rootItemsCache.getEntryFromCache(ROOT_ITEMS_CACHE_KEY);
        if (cachedItems) {
            this.logger.trace(this.buildLogPrefix("Using cached root items"));
            this.rootItems = cachedItems;
            return cachedItems;
        }

        if (this._isLoading) {
            return this.rootItems;
        }

        if (this._intentionallyCleared && this.rootItems.length === 0) {
            return [];
        }

        await this.loadData();
        return this.rootItems;
    }

    /**
     * Fetches the root items for the tree view
     * @return Promise resolving to array of root tree items
     */
    protected abstract fetchRootItems(): Promise<T[]>;

    /**
     * Retrieves children for a specific tree item
     * @param item The parent tree item
     * @return Promise resolving to array of child tree items
     */
    protected abstract getChildrenForItem(item: T): Promise<T[]>;

    /**
     * Creates a new tree item from data
     * @param data The data to create the tree item from
     * @param parent Optional parent tree item
     * @return The created tree item
     */
    protected abstract createTreeItem(data: any, parent?: T): T;

    /**
     * Refreshes the tree view with optional debouncing
     * @param item Optional specific item to refresh
     * @param options Optional refresh options including immediate flag
     */
    public refresh(item?: T, options?: RefreshOptions): void {
        this.logger.trace(
            this.buildLogPrefix(
                `Refreshing tree view${item ? ` for item: ${item.label}` : ""}${options?.immediate ? " immediately" : ""}`
            )
        );
        if (this._dataFetchDebounceTimeout) {
            clearTimeout(this._dataFetchDebounceTimeout);
            this._dataFetchDebounceTimeout = undefined;
        }

        const skipDataReload = options?.skipDataReload ?? false;

        if (!item) {
            // Full refresh
            this._intentionallyCleared = false;

            if (skipDataReload) {
                this.logger.trace(this.buildLogPrefix("Skipping data reload per refresh options."));
                if (options?.immediate) {
                    this._onDidChangeTreeData.fire(undefined);
                } else {
                    this._dataFetchDebounceTimeout = setTimeout(() => {
                        this._onDidChangeTreeData.fire(undefined);
                        this._dataFetchDebounceTimeout = undefined;
                    }, TreeViewTiming.UI_REFRESH_DEBOUNCE_MS);
                }
            } else {
                // Reset flag for full refresh
                this.loadData(options);
            }
        } else {
            // Partial refresh
            if (options?.immediate) {
                this._onDidChangeTreeData.fire(item);
            } else {
                // Default debounced behavior
                this._dataFetchDebounceTimeout = setTimeout(() => {
                    this._onDidChangeTreeData.fire(item);
                    this._dataFetchDebounceTimeout = undefined;
                }, TreeViewTiming.UI_REFRESH_DEBOUNCE_MS);
            }
        }

        this.updateTreeViewMessage();
    }

    /**
     * Clears the tree view by removing all root items and resetting state
     */
    public clearTree(): void {
        this.logger.trace(this.buildLogPrefix("Clearing tree view"));
        this.rootItems = [];
        this.rootItemsCache.clearCache();
        this.stateManager.clear();
        this._intentionallyCleared = true;
        this._onDidChangeTreeData.fire(undefined);
        this.updateTreeViewMessage();
    }

    /**
     * Clears only the tree data (root items) but preserves UI state like expansion, marking, etc.
     * This is useful when refreshing data while maintaining user's UI preferences.
     */
    public clearTreeDataOnly(): void {
        this.logger.trace(this.buildLogPrefix("Clearing tree data only, preserving UI state"));
        this.rootItems = [];
        this.rootItemsCache.clearCache();
        this._intentionallyCleared = true;
        this._onDidChangeTreeData.fire(undefined);
        this.updateTreeViewMessage();
    }

    /**
     * Prepares the tree for loading data for a new context by clearing currently shown tree items and
     * activating the loading state immediately.
     * Preserves UI state (expansion, marking, filtering) by default.
     * @param preserveUiState When false, additionally clears cached data (items, rootItems)
     * but preserves persistent module state (expansion, marking, filtering).
     */
    public prepareForContextSwitchLoading(preserveUiState: boolean = true): void {
        // Skip if already prepared
        if (this.rootItems.length === 0 && this.stateManager.isLoading()) {
            return;
        }

        if (preserveUiState) {
            // Clear data without touching module state
            this.rootItems = [];
            this.rootItemsCache.clearCache();
            this._intentionallyCleared = true;
        } else {
            this.clearTree();
        }

        this.stateManager.setState({ error: null, loading: true });
        this._onDidChangeTreeData.fire(undefined);
        this.updateTreeViewMessage();
    }

    /**
     * Clears the state of all modules associated with this tree view.
     */
    public async clearAllModuleState(): Promise<void> {
        this.logger.debug(this.buildLogPrefix(`Clearing all module states for tree: ${this.config.id}`));

        const persistenceModule = this.getModule("persistence");
        if (persistenceModule && typeof (persistenceModule as any).clear === "function") {
            await (persistenceModule as any).clear();
        }

        const expansionModule = this.getModule("expansion");
        if (expansionModule && typeof (expansionModule as any).reset === "function") {
            (expansionModule as any).reset();
        }

        const markingModule = this.getModule("marking");
        if (markingModule && typeof (markingModule as any).clearAllMarkings === "function") {
            (markingModule as any).clearAllMarkings(false); // Don't emit global event
        }

        const filteringModule = this.getModule("filtering");
        if (filteringModule && typeof (filteringModule as any).clearAllFilters === "function") {
            (filteringModule as any).clearAllFilters();
        }

        if (this.stateManager && typeof this.stateManager.setState === "function") {
            this.stateManager.setState({
                expansion: null,
                marking: null,
                filtering: null
            });
        }
    }

    /**
     * Resets the tree view and all its modules to a clean state for a new session.
     */
    public resetForNewSession(): void {
        this.logger.debug(this.buildLogPrefix(`Performing full state reset for new session: ${this.config.id}`));

        this.stateManager.resetState();

        for (const module of this.modules.values()) {
            if (typeof module.reset === "function") {
                module.reset();
            }
        }

        this.rootItems = [];
        this.rootItemsCache.clearCache();
        this._intentionallyCleared = true;
        this.resetTitle();
        this._onDidChangeTreeData.fire(undefined);
        this.updateTreeViewMessage();
    }

    /**
     * Forces a reload of the tree's persistent UI state (expansion, marking, etc.) from storage.
     * This is intended to be used after a user logs in.
     * Expansion state is applied directly during tree rendering.
     */
    public async reloadStateFromPersistence(options?: { refresh?: boolean }): Promise<void> {
        const persistenceModule = this.getModule("persistence") as PersistenceModule | undefined;
        if (!persistenceModule) {
            this.logger.warn(this.buildLogPrefix(`No persistence module available for ${this.config.id}`));
            return;
        }

        this.logger.debug(this.buildLogPrefix(`Reloading persistent tree view state...`));
        const loadedState = await persistenceModule.loadState();

        if (loadedState) {
            this.stateManager.setState(loadedState);
            this.logger.debug(
                this.buildLogPrefix(
                    `Successfully reloaded persistent tree view state, expansion will be applied during next tree rendering.`
                )
            );

            if (loadedState.expansion) {
                this.logger.debug(
                    this.buildLogPrefix(
                        `Loaded tree view expansion state with ${loadedState.expansion.expandedItems?.size || 0} expanded nodes.`
                    )
                );
            }

            // Apply the loaded state
            if (options?.refresh ?? true) {
                this.refresh(undefined, { immediate: true });
            }
        } else {
            this.logger.debug(this.buildLogPrefix(`No persistent state found for ${this.config.id}`));
        }
    }

    /**
     * Updates the tree view configuration and notifies modules of changes
     * @param newConfig Partial configuration to merge with existing config
     */
    public async updateConfig(newConfig: Partial<TreeViewConfig>): Promise<void> {
        this.logger.debug(this.buildLogPrefix("Updating tree view configuration"));
        // Merge configs
        Object.assign(this.config, newConfig);

        for (const module of this.modules.values()) {
            if (module.onConfigChange) {
                await module.onConfigChange(this.config);
            }
        }

        this.updateTreeViewMessage();

        if (newConfig.features) {
            await this.initializeModules();
            this.refresh();
        }
    }

    /**
     * Disposes the tree view and all its resources
     */
    public async dispose(): Promise<void> {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this.logger.trace(this.buildLogPrefix("Disposing tree view"));

        // Dispose other modules first
        for (const [id, module] of this.modules.entries()) {
            if (id !== "persistence") {
                try {
                    await module.dispose();
                } catch (error) {
                    this.logger.error(this.buildLogPrefix(`Error disposing module ${id}:`), error);
                }
            }
        }

        // Dispose persistence module last
        const persistenceModule = this.modules.get("persistence");
        if (persistenceModule) {
            try {
                await persistenceModule.dispose();
            } catch (error) {
                this.logger.error(this.buildLogPrefix(`Error disposing persistence module:`), error);
            }
        }

        this._onDidChangeTreeData.dispose();
        this.eventBus.dispose();
        this.stateManager.dispose();
        this.rootItems = [];
        this.rootItemsCache.clearCache();
        this.modules.clear();
    }

    /**
     * Creates a promise that times out after the specified duration.
     * If the timeout occurs, it rejects with an error indicating the operation name and duration.
     * @param timeoutMs The timeout duration in milliseconds
     * @param operationName A name for the operation, used in error messages
     * @return A promise that rejects with a timeout error after the specified duration
     */
    private createTimeoutPromise(timeoutMs: number, operationName: string): Promise<never> {
        return new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${operationName} timeout after ${timeoutMs}ms`)), timeoutMs)
        );
    }

    /**
     * Wraps an async operation with optional timeout protection.
     * If timeout is not configured, the operation will wait indefinitely.
     * @param operation The async operation to execute
     * @param operationName A descriptive name for the operation, used in error messages
     * @param timeoutMs Optional timeout duration in milliseconds
     * @return A promise that resolves with the operation result or rejects with a timeout error
     */
    private async withOptionalTimeout<T>(
        operation: () => Promise<T>,
        operationName: string,
        timeoutMs?: number
    ): Promise<T> {
        if (timeoutMs === undefined) {
            return await operation();
        }

        return Promise.race([operation(), this.createTimeoutPromise(timeoutMs, operationName)]);
    }

    /**
     * Updates the tree view message based on current state.
     */
    private updateTreeViewMessage(): void {
        if (!this.vscTreeView) {
            return;
        }

        try {
            const message = this.determineTreeViewMessage();
            this.vscTreeView.message = message;
        } catch (error) {
            this.vscTreeView.message = undefined;
            this.logger.error(this.buildLogPrefix("Error updating tree view message:"), error);
        }
    }

    /**
     * Determines the appropriate message to display in the tree view.
     * @returns The message string or undefined if no message should be displayed
     */
    private determineTreeViewMessage(): string | undefined {
        const state = this.stateManager?.getState();
        if (!state) {
            return undefined;
        }

        // Error state
        if (state.error) {
            return this.config.ui.errorMessage;
        }

        // Loading state
        if (state.loading) {
            return this.config.ui.loadingMessage;
        }

        // Filtering messages
        const filterMessage = this.getFilteringMessage();
        if (filterMessage) {
            return filterMessage;
        }

        // Empty state
        if (this.shouldShowEmptyMessage()) {
            return this.config.ui.emptyMessage;
        }

        // No message needed
        return undefined;
    }

    /**
     * Gets the appropriate filtering-related message if filtering is active.
     * @returns Filter message string or undefined if no filter message is applicable
     */
    private getFilteringMessage(): string | undefined {
        const filteringModule = this.getModule("filtering") as FilteringModule | undefined;
        if (!filteringModule?.isActive()) {
            return undefined;
        }

        const rootItems = this.getCurrentRootItems();
        if (rootItems.length === 0) {
            return undefined;
        }

        const filteredItems = filteringModule.filterTreeItems(rootItems);
        const textFilter = filteringModule.getTextFilter();

        // No items match the filter
        if (filteredItems.length === 0) {
            return this.buildNoMatchesMessage(textFilter?.searchText);
        }

        // Items match, show search context if text filter is active
        if (textFilter?.searchText) {
            return `Search results for: "${textFilter.searchText}"`;
        }

        return undefined;
    }

    /**
     * Builds the appropriate message when no items match the filter.
     * @param searchText The search text if a text filter is active
     * @returns Message string for no matches
     */
    private buildNoMatchesMessage(searchText?: string): string {
        if (searchText) {
            return `No items found for "${searchText}"`;
        }
        return "All items have been filtered.";
    }

    /**
     * Determines if the empty message should be shown.
     * @returns True if empty message should be displayed
     */
    private shouldShowEmptyMessage(): boolean {
        return this.getCurrentRootItems().length === 0 && !this._intentionallyCleared;
    }

    /**
     * Loads data for the tree view with optional immediate refresh
     * @param options Optional parameters for data loading behavior
     */
    protected async loadData(options?: RefreshOptions): Promise<void> {
        if (this._isLoading) {
            return;
        }

        try {
            this._isLoading = true;
            this.stateManager.setLoading(true);
            this.updateTreeViewMessage();

            const timeoutMs = this.config.behavior.loadingTimeout;
            const newRootItems = await this.withOptionalTimeout(() => this.fetchRootItems(), "Data loading", timeoutMs);
            this.rootItems = newRootItems;
            this.rootItemsCache.setEntryInCache(ROOT_ITEMS_CACHE_KEY, newRootItems);
            this._intentionallyCleared = false;

            this.stateManager.setLoading(false);
            this.updateTreeViewMessage();

            // Trigger a UI refresh after a loadData call, respecting the immediate flag.
            // The decision to fetch data should not prevent a requested UI update.
            if (this._dataFetchDebounceTimeout) {
                clearTimeout(this._dataFetchDebounceTimeout);
                this._dataFetchDebounceTimeout = undefined;
            }

            if (options?.immediate) {
                this._onDidChangeTreeData.fire(undefined);
            } else {
                this._dataFetchDebounceTimeout = setTimeout(() => {
                    this._onDidChangeTreeData.fire(undefined);
                    this._dataFetchDebounceTimeout = undefined;
                }, TreeViewTiming.UI_REFRESH_DEBOUNCE_MS);
            }
        } catch (error) {
            this.logger.error(this.buildLogPrefix("Error during data load:"), error);
            this.stateManager.setError(error as Error);
            this.updateTreeViewMessage();
            throw error;
        } finally {
            this._isLoading = false;
        }
    }

    /**
     * Preloads children for items that have expansion state saved.
     * Necessary for version items in projects tree view that need their cycles loaded.
     */
    protected async preloadChildrenForExpansion(): Promise<void> {
        const state = this.stateManager.getState();
        if (!state.expansion || state.expansion.expandedItems.size === 0) {
            return;
        }

        const itemsById = new Map<string, TreeItemBase>();
        const collectCurrentItems = (items: TreeItemBase[]): void => {
            for (const item of items) {
                if (item.id) {
                    itemsById.set(item.id, item);
                }
                if (item.children && item.children.length > 0) {
                    collectCurrentItems(item.children);
                }
            }
        };

        collectCurrentItems(this.getCurrentRootItems() as TreeItemBase[]);

        // For each expanded item ID, ensure its children are loaded, but only
        // if the item's ancestor chain is effectively expanded
        const expandedItems = state.expansion.expandedItems;
        const collapsedItems = state.expansion.collapsedItems;
        const defaultExpanded = state.expansion.defaultExpanded ?? false;

        for (const expandedItemId of expandedItems) {
            const item = itemsById.get(expandedItemId);
            if (
                item &&
                this.shouldLoadChildrenForExpansion(item) &&
                this.isAncestorChainExpanded(item, expandedItems, collapsedItems, defaultExpanded)
            ) {
                try {
                    this.logger.trace(
                        this.buildLogPrefix(`Preloading children for expanded item: ${item.label} (${expandedItemId})`)
                    );
                    const children = await this.getChildrenForItem(item as any);
                    (item as any).children = children;

                    collectCurrentItems(children as TreeItemBase[]);
                } catch (error) {
                    this.logger.warn(
                        this.buildLogPrefix(`Failed to preload children for item ${expandedItemId}:`),
                        error
                    );
                }
            }
        }
    }

    /**
     * Determines if children should be loaded for an item during expansion restoration.
     * @param item The item to check if children should be loaded for
     * @returns True if children should be loaded, false otherwise
     */
    protected shouldLoadChildrenForExpansion(item: TreeItemBase): boolean {
        return (
            item.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed ||
            item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded
        );
    }

    /**
     * Restores the expansion state for all items in the tree.
     * This should be called after the tree is populated with data.
     */
    protected async restoreExpansionState(): Promise<void> {
        const expansionModule = this.getModule("expansion");
        if (!expansionModule || !this.vscTreeView) {
            return;
        }

        const state = this.stateManager.getState();
        if (!state.expansion || state.expansion.expandedItems.size === 0) {
            return;
        }

        this.logger.trace(
            this.buildLogPrefix(`Restoring expansion state for ${state.expansion.expandedItems.size} items`)
        );

        const itemsById = new Map<string, T>();

        const collectItems = (items: T[]): void => {
            for (const item of items) {
                if (item.id) {
                    itemsById.set(item.id, item);
                }
                if (item.children && item.children.length > 0) {
                    collectItems(item.children as T[]);
                }
            }
        };

        collectItems(this.getCurrentRootItems());

        const expandedItems = state.expansion.expandedItems;
        const collapsedItems = state.expansion.collapsedItems;
        const defaultExpanded = state.expansion.defaultExpanded ?? false;
        const itemsToExpand: T[] = [];

        for (const itemId of expandedItems) {
            const item = itemsById.get(itemId);
            if (item && this.isAncestorChainExpanded(item, expandedItems, collapsedItems, defaultExpanded)) {
                itemsToExpand.push(item);
            }
        }

        itemsToExpand.sort((a, b) => {
            const depthA = this.getItemDepth(a);
            const depthB = this.getItemDepth(b);
            return depthA - depthB;
        });

        for (const item of itemsToExpand) {
            try {
                await this.vscTreeView.reveal(item, {
                    expand: true,
                    focus: false,
                    select: false
                });
            } catch (error) {
                this.logger.trace(
                    this.buildLogPrefix(`Could not restore expansion state for item ${item.id}: ${error}`)
                );
            }
        }

        this.logger.trace(this.buildLogPrefix(`Expansion state restoration completed`));
    }

    /**
     * Determines whether the ancestor chain of the provided tree item
     * is expanded given the current expansion state.
     * If any ancestor is explicitly collapsed, or neither explicitly expanded
     * nor covered by defaultExpanded=true, the chain is considered not expanded.
     * @param treeItem The tree item to check
     * @param expandedItems Set of expanded item IDs
     * @param collapsedItems Set of collapsed item IDs
     * @param defaultExpanded Whether items are expanded by default
     */
    protected isAncestorChainExpanded(
        treeItem: TreeItemBase,
        expandedItems: Set<string>,
        collapsedItems: Set<string>,
        defaultExpanded: boolean
    ): boolean {
        let current: TreeItemBase | undefined = treeItem.parent as TreeItemBase | undefined;
        while (current) {
            const currentId = (current as any).id as string | undefined;
            if (currentId) {
                if (collapsedItems.has(currentId)) {
                    return false;
                }
                if (!expandedItems.has(currentId) && !defaultExpanded) {
                    return false;
                }
            }
            current = current.parent as TreeItemBase | undefined;
        }
        return true;
    }

    /**
     * Gets the depth of an item in the tree
     * @param item The item to get the depth for
     * @returns The depth of the item (0 for root items)
     */
    private getItemDepth(item: T): number {
        let depth = 0;
        let current = item.parent as T | undefined;
        while (current) {
            depth++;
            current = current.parent as T | undefined;
        }
        return depth;
    }

    /**
     * Handles state changes from the StateManager
     */
    private handleStateChange(): void {
        this.updateTreeViewMessage();
    }
}
