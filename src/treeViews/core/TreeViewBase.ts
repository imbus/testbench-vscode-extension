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
import { ErrorHandler } from "../utils/ErrorHandler";
import { TestBenchLogger } from "../../testBenchLogger";
import { CustomRootModule } from "../features/customRoot/CustomRootModule";
import { FilteringModule } from "../features/filtering/FilteringModule";
import { TreeViewTiming } from "../../constants";
import { IconModule } from "../features/icons/IconModule";

export abstract class TreeViewBase<T extends TreeItemBase> implements vscode.TreeDataProvider<T> {
    protected readonly _onDidChangeTreeData = new vscode.EventEmitter<T | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    protected readonly modules = new Map<string, TreeViewModule>();
    protected readonly context: TreeViewContext;
    public readonly stateManager: StateManager;
    public readonly logger: TestBenchLogger;
    public readonly errorHandler: ErrorHandler;
    public readonly eventBus: EventBus;
    protected vscTreeView: vscode.TreeView<T> | undefined;

    protected rootItems: T[] = [];
    private _disposed = false;
    private _initialized = false;
    private _isLoading = false;
    private _lastDataFetch = 0;
    private _dataFetchDebounceTimeout: NodeJS.Timeout | undefined;
    private _intentionallyCleared = false;
    constructor(
        protected readonly extensionContext: vscode.ExtensionContext,
        public readonly config: TreeViewConfig
    ) {
        this.logger = new TestBenchLogger();
        this.errorHandler = new ErrorHandler(this.logger);
        this.eventBus = new EventBus();
        this.stateManager = new StateManager(extensionContext, config.id, this.eventBus);
        this.context = new TreeViewContextImpl(
            extensionContext,
            config,
            this.stateManager,
            this.eventBus,
            this.logger,
            this.errorHandler,
            this
        );

        this.eventBus.on("connection:changed", async (event) => {
            const { connected } = event.data;
            if (connected) {
                await this.loadData();
            } else {
                this.clearTree();
            }
        });
    }

    /**
     * Sets the VS Code tree view reference for this tree view
     * @param treeView The VS Code tree view instance
     */
    public setTreeView(treeView: vscode.TreeView<T>): void {
        this.vscTreeView = treeView;
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
            this.logger.warn("Tree view already initialized");
            return;
        }

        try {
            this.logger.debug("Initializing tree view");
            await this.initializeModules();
            // Don't load data during initialization, wait for connection event
            this._initialized = true;

            // Set up event listeners for proper expansion tracking
            if (this.vscTreeView) {
                // Are already set up in TreeViewFactory, added for safety
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
            this.logger.debug("Tree view initialized successfully");
        } catch (error) {
            this.errorHandler.handleVoid(
                error instanceof Error ? error : new Error(String(error)),
                "TreeViewBase.initialize"
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
     * Initializes all enabled modules from the registry.
     * The modules are registered and then initialized.
     * If a module fails to initialize, it will continue with the other modules.
     * @returns Promise that resolves when all modules are initialized
     */
    private async initializeModules(): Promise<void> {
        const enabledModules = ModuleRegistry.createEnabledModules(this.config.features);
        const modulePromises: Promise<void>[] = [];

        for (const [, module] of enabledModules) {
            this.registerModule(module);
        }

        // Initialize persistence module first to ensure state is loaded
        const persistenceModule = enabledModules.get("persistence");
        if (persistenceModule) {
            try {
                await persistenceModule.initialize(this.context);
                this.logger.debug("Module initialized: persistence");
            } catch (error) {
                this.logger.error("Failed to initialize module persistence:", error);
            }
        }

        // Initialize all other modules in parallel
        for (const [moduleName, module] of enabledModules) {
            if (moduleName === "persistence") {
                continue;
            }

            modulePromises.push(
                module
                    .initialize(this.context)
                    .then(() => {
                        this.logger.debug(`Module initialized: ${moduleName}`);
                    })
                    .catch((error) => {
                        this.logger.error(`Failed to initialize module ${moduleName}:`, error);
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
            this.logger.warn(`Module ${module.id} already registered`);
            return;
        }

        this.modules.set(module.id, module);
        this.logger.debug(`Registered module: ${module.id}`);
    }

    /**
     * Gets a module by its ID
     * @param moduleId The ID of the module to retrieve
     * @returns The module instance or undefined if not found
     */
    public getModule<M extends TreeViewModule>(moduleId: string): M | undefined {
        return this.modules.get(moduleId) as M;
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
        const customRootModule = this.getModule("customRoot");
        if (customRootModule) {
            (customRootModule as CustomRootModule).applyCustomRootContext(element);
        }

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
     * Gets the parent of a tree element, considering custom root module
     * @param element The element to get the parent for
     * @returns The parent element or undefined
     */
    getParent(element: T): vscode.ProviderResult<T> {
        const customRootModule = this.getModule("customRoot");
        if (customRootModule && customRootModule.isActive()) {
            const customParent = customRootModule.getParent(element);
            if (customParent !== undefined) {
                return customParent;
            }
        }

        return element.parent as T;
    }

    /**
     * Gets the children of a tree element with filtering and expansion applied
     * @param element The element to get children for, undefined for root
     * @returns Promise that resolves to array of child elements
     */
    async getChildren(element?: T): Promise<T[]> {
        try {
            this.logger.trace(`getChildren called for: ${element?.label || "root"}`);
            const customRootModule = this.getModule("customRoot");
            if (!element && customRootModule && customRootModule.isActive()) {
                this.logger.trace("Using custom root module for getChildren");
                const customRoot = customRootModule.getCustomRoot();
                if (customRoot) {
                    return [customRoot as T];
                }
            }

            let children: T[];
            if (!element) {
                this.logger.trace("Getting root items for getChildren");
                children = await this.getRootItems();
            } else {
                this.logger.trace(`Getting children for item: ${element.label}`);
                children = await this.getChildrenForItem(element);
            }

            this.logger.trace(`Got ${children.length} children before filtering`);
            const filterModule = this.getModule("filtering");
            if (filterModule && filterModule.isActive()) {
                this.logger.trace("Applying filtering");
                // If this is the root level and parent/child inclusion is enabled,
                // tree structure should be loaded fully for filtering
                if (!element && this.shouldExpandForFiltering(filterModule)) {
                    this.logger.trace("Expanding tree structure for filtering");
                    children = await this.expandTreeForFiltering(children);
                }

                children = filterModule.filterTreeItems(children);
                this.logger.trace(`After filtering: ${children.length} children`);
            } else {
                this.logger.trace("No filtering applied");
            }

            const expansionModule = this.getModule("expansion");
            if (expansionModule) {
                this.logger.trace("Applying expansion state");
                children.forEach((child) => expansionModule.applyExpansionState(child));
            }

            this.logger.trace(`Returning ${children.length} children`);
            return children;
        } catch (error) {
            const emptyArray: T[] = [];
            return this.errorHandler.handle(error as Error, "Failed to get children", emptyArray);
        }
    }

    /**
     * Determines if tree expansion is needed for filtering
     * @param filterModule The filtering module instance
     * @return True if expansion is required, false otherwise
     */
    private shouldExpandForFiltering(filterModule: any): boolean {
        const textFilter = filterModule.getTextFilter();
        return textFilter && (textFilter.showParentsOfMatches || textFilter.showChildrenOfMatches);
    }

    /**
     * Expands tree structure to load all children for filtering
     * @param items Array of tree items to expand
     * @return Promise resolving to expanded items with loaded children
     */
    private async expandTreeForFiltering(items: T[]): Promise<T[]> {
        const expandedItems: T[] = [];
        for (const item of items) {
            const children = await this.getChildrenForItem(item);
            item.children = children;
            expandedItems.push(item);
        }

        return expandedItems;
    }

    /**
     * Retrieves root items with caching and loading logic
     * @return Promise resolving to array of root tree items
     */
    protected async getRootItems(): Promise<T[]> {
        this.logger.trace(
            `getRootItems called - isLoading: ${this._isLoading}, lastFetch: ${Date.now() - this._lastDataFetch}ms ago, hasItems: ${this.rootItems.length > 0}, intentionallyCleared: ${this._intentionallyCleared}`
        );
        const hasItems = this.rootItems.length > 0;
        const dataIsFresh = Date.now() - this._lastDataFetch < TreeViewTiming.DATA_FRESHNESS_THRESHOLD_MS;
        if (hasItems && dataIsFresh) {
            this.logger.trace("Using cached root items");
            return this.rootItems;
        }

        if (this._isLoading) {
            this.logger.trace("Data load in progress, returning current items");
            return this.rootItems;
        }

        // Check if we have a recent fetch (even if empty) to prevent infinite loading
        if (this._lastDataFetch > 0 && Date.now() - this._lastDataFetch < TreeViewTiming.DATA_FRESHNESS_THRESHOLD_MS) {
            this.logger.trace("Using recent empty result to prevent infinite loading");
            return this.rootItems;
        }

        if (this._intentionallyCleared && this.rootItems.length === 0) {
            this.logger.trace("Tree was intentionally cleared and is empty, not loading data");
            return this.rootItems;
        }

        this.logger.trace("No valid cache, loading fresh data");
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
    public refresh(item?: T, options?: { immediate?: boolean }): void {
        this.logger.debug(
            `Refreshing tree view${item ? ` for item: ${item.label}` : ""}${options?.immediate ? " immediately" : ""}`
        );
        if (this._dataFetchDebounceTimeout) {
            clearTimeout(this._dataFetchDebounceTimeout);
            this._dataFetchDebounceTimeout = undefined;
        }

        if (!item) {
            // Full refresh
            this._intentionallyCleared = false;
            // Reset flag for full refresh
            this.loadData(options);
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
    }

    /**
     * Sets the given item as the custom root for this tree view.
     * Delegates the core logic to the CustomRootModule.
     * @param item The tree item to set as the new root.
     */
    public makeRoot(item: T): void {
        const customRootModule = this.getModule("customRoot") as CustomRootModule | undefined;
        if (customRootModule) {
            customRootModule.setCustomRoot(item);
        } else {
            this.logger.warn("CustomRootModule not available for this tree view.");
        }
    }

    /**
     * Resets the custom root, restoring the tree view to its default state.
     * Delegates the core logic to the CustomRootModule.
     */
    public resetCustomRoot(): void {
        const customRootModule = this.getModule("customRoot") as CustomRootModule | undefined;
        if (customRootModule) {
            customRootModule.reset();
        } else {
            this.logger.warn("CustomRootModule not available for this tree view.");
        }
    }

    /**
     * Clears the tree view by removing all root items and resetting state
     */
    public clearTree(): void {
        this.logger.debug("Clearing tree view");
        this.rootItems = [];
        this.stateManager.clear();
        this._lastDataFetch = 0;
        this._onDidChangeTreeData.fire(undefined);
        this._intentionallyCleared = true;
    }

    /**
     * Updates the tree view configuration and notifies modules of changes
     * @param newConfig Partial configuration to merge with existing config
     */
    public async updateConfig(newConfig: Partial<TreeViewConfig>): Promise<void> {
        this.logger.debug("Updating tree view configuration");
        // Merge configs
        Object.assign(this.config, newConfig);

        for (const module of this.modules.values()) {
            if (module.onConfigChange) {
                await module.onConfigChange(this.config);
            }
        }

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
        this.logger.debug("Disposing tree view");
        for (const module of this.modules.values()) {
            try {
                await module.dispose();
            } catch (error) {
                this.logger.error(`Error disposing module ${module.id}:`, error);
            }
        }

        this._onDidChangeTreeData.dispose();
        this.eventBus.dispose();
        this.stateManager.dispose();

        this.rootItems = [];
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
     * Loads data for the tree view with optional immediate refresh
     * @param options Optional parameters for data loading behavior
     */
    protected async loadData(options?: { immediate?: boolean }): Promise<void> {
        if (this._isLoading) {
            this.logger.debug("Data load already in progress, skipping");
            return;
        }

        try {
            this.logger.debug("Starting data load");
            this._isLoading = true;
            this.stateManager.setLoading(true);

            const hasNoData = this.rootItems.length === 0;
            const isDataStale = Date.now() - this._lastDataFetch >= TreeViewTiming.DATA_STALE_THRESHOLD_MS;
            const shouldFetch = hasNoData || isDataStale;

            if (shouldFetch) {
                const timeoutMs = this.config.behavior.loadingTimeout;
                this.rootItems = await this.withOptionalTimeout(() => this.fetchRootItems(), "Data loading", timeoutMs);
                this._lastDataFetch = Date.now();
                this._intentionallyCleared = false;
            }

            this.stateManager.setLoading(false);
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

            setTimeout(() => {
                this.restoreExpansionState().catch((error) => {
                    this.logger.error("Failed to restore expansion state:", error);
                });
            }, 100);
        } catch (error) {
            this.logger.error("Error during data load:", error);
            this.stateManager.setError(error as Error);
            throw error;
        } finally {
            this._isLoading = false;
            this.logger.debug("Data load completed");
        }
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

        this.logger.debug(`Restoring expansion state for ${state.expansion.expandedItems.size} items`);

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

        collectItems(this.rootItems);

        const itemsToExpand: T[] = [];
        for (const itemId of state.expansion.expandedItems) {
            const item = itemsById.get(itemId);
            if (item) {
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
                this.logger.trace(`Could not expand item ${item.id}: ${error}`);
            }
        }

        this.logger.debug(`Expansion state restoration completed`);
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
}
