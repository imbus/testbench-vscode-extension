import { allExtensionCommands, StorageKeys, TreeItemContextValues } from "./../constants";
/**
 * @file src/services/treeServiceManager.ts
 * @description TreeServiceManager
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../testBenchLogger";
import { ProjectDataService } from "../views/projectManagement/projectDataService";
import { TestElementDataService } from "../views/testElements/testElementDataService";
import { ResourceFileService } from "../views/testElements/resourceFileService";
import { IconManagementService } from "../views/common/iconManagementService";
import { MarkedItemStateService } from "../views/testTheme/markedItemStateService";
import { TestElementTreeBuilder } from "../views/testElements/testElementTreeBuilder";
import {
    ProjectManagementTreeDataProvider,
    CycleDataForThemeTreeEvent
} from "../views/projectManagement/projectManagementTreeDataProvider";
import { TestThemeTreeDataProvider } from "../views/testTheme/testThemeTreeDataProvider";
import { TestElementsTreeDataProvider } from "../views/testElements/testElementsTreeDataProvider";
import { BaseTreeItem } from "../views/common/baseTreeItem";
import { ProjectManagementTreeItem } from "../views/projectManagement/projectManagementTreeItem";
import { TestThemeTreeItem } from "../views/testTheme/testThemeTreeItem";
import { TestElementTreeItem } from "../views/testElements/testElementTreeItem";
import { PlayServerConnection } from "../testBenchConnection";
import { restartLanguageClient } from "../server";
import { StateChangeNotification } from "../views/common/unifiedTreeStateManager";
import { debounce } from "../utils";

export interface TreeServiceDependencies {
    extensionContext: vscode.ExtensionContext;
    logger: TestBenchLogger;
    getConnection: () => PlayServerConnection | null;
}

export interface TreeViewContainer {
    provider: any;
    treeView: vscode.TreeView<any>;
    updateMessage: (message?: string) => void;
}

/**
 * Centralized manager for all tree-related services and views with unified state management
 */
export class TreeServiceManager {
    public readonly logger: TestBenchLogger;
    public readonly extensionContext: vscode.ExtensionContext;
    private readonly getConnection: () => PlayServerConnection | null;

    // Core Services
    private _projectDataService: ProjectDataService | null = null;
    private _testElementDataService: TestElementDataService | null = null;
    private _resourceFileService: ResourceFileService | null = null;
    private _iconManagementService: IconManagementService | null = null;
    private _markedItemStateService: MarkedItemStateService | null = null;
    private _testElementTreeBuilder: TestElementTreeBuilder | null = null;

    // Tree Management
    private readonly treeViews = new Map<string, TreeViewContainer>();
    private _isInitialized = false;

    // Double-click detection state
    private lastClickTime = 0;
    private lastClickedItem: ProjectManagementTreeItem | null = null;
    private readonly DOUBLE_CLICK_THRESHOLD_MS = 400;

    // State change listeners for coordination
    private readonly stateChangeListeners = new Map<string, (notification: StateChangeNotification) => void>();
    private readonly debouncedSaveVisibleViews: () => void;

    constructor(dependencies: TreeServiceDependencies) {
        this.extensionContext = dependencies.extensionContext;
        this.logger = dependencies.logger;
        this.getConnection = dependencies.getConnection;
        this.debouncedSaveVisibleViews = debounce(() => this.saveVisibleViewsState(), 500);
        this.logger.trace("[TreeServiceManager] Initialized with unified state management integration");
    }

    /**
     * Initialize all services and prepare for tree view creation
     */
    public async initialize(): Promise<void> {
        if (this._isInitialized) {
            this.logger.warn("[TreeServiceManager] Already initialized, skipping re-initialization");
            return;
        }

        try {
            this.logger.info("[TreeServiceManager] Initializing core services...");

            // Ccore services
            this._iconManagementService = new IconManagementService(this.logger, this.extensionContext);
            this._resourceFileService = new ResourceFileService(this.logger);
            this._projectDataService = new ProjectDataService(this.getConnection, this.logger);
            this._testElementDataService = new TestElementDataService(this.getConnection, this.logger);
            this._markedItemStateService = new MarkedItemStateService(this.extensionContext, this.logger);
            this._testElementTreeBuilder = new TestElementTreeBuilder(this.logger);

            await this._markedItemStateService.initialize();

            this._isInitialized = true;
            this.logger.info(
                "[TreeServiceManager] All services initialized successfully with unified state management"
            );
        } catch (error) {
            this.logger.error("[TreeServiceManager] Failed to initialize services:", error);
            throw new Error(`TreeServiceManager initialization failed: ${(error as Error).message}`);
        }
    }

    /**
     * Create and register all tree views with the extension context.
     */
    public async initializeTreeViews(): Promise<void> {
        if (!this._isInitialized) {
            throw new Error("TreeServiceManager must be initialized before creating tree views");
        }
        try {
            await this.createProjectManagementTree();
            await this.createTestThemeTree();
            await this.createTestElementsTree();
            this.setupTreeViewInteractions();
            this.setupUnifiedStateCoordination();

            this.logger.info(
                "[TreeServiceManager] All tree views initialized successfully with unified state management"
            );
        } catch (error) {
            this.logger.error("[TreeServiceManager] Failed to initialize tree views:", error);
            throw error;
        }
    }

    /**
     * Saves the list of currently visible tree view IDs to workspace storage.
     */
    private async saveVisibleViewsState(): Promise<void> {
        try {
            const visibleViewIds: string[] = [];
            for (const [id, container] of this.treeViews) {
                if (container.treeView.visible) {
                    visibleViewIds.push(id);
                }
            }
            await this.extensionContext.workspaceState.update(StorageKeys.VISIBLE_VIEWS_STORAGE_KEY, visibleViewIds);
            this.logger.trace("[TreeServiceManager] Saved visible tree views:", visibleViewIds);
        } catch (error) {
            this.logger.error("[TreeServiceManager] Failed to save visible tree views state:", error);
        }
    }

    /**
     * Restores the visibility of tree views based on the persisted state.
     */
    public restoreVisibleViewsState(): void {
        try {
            const visibleViewIds = this.extensionContext.workspaceState.get<string[]>(
                StorageKeys.VISIBLE_VIEWS_STORAGE_KEY
            );

            // Use a small delay to ensure the views are fully registered before we try to focus them.
            setTimeout(() => {
                // If the key is undefined, it's the first run, so show the default view.
                if (visibleViewIds === undefined) {
                    this.logger.trace(
                        "[TreeServiceManager] No saved view state found, focusing on default project view."
                    );
                    vscode.commands.executeCommand("projectManagementTree.focus").then(undefined, (err) => {
                        this.logger.warn(`[TreeServiceManager] Could not set default focus for project view:`, err);
                    });
                    return;
                }

                // If the array exists (even if empty), respect the saved state.
                if (visibleViewIds.length > 0) {
                    this.logger.trace("[TreeServiceManager] Restoring visible tree views:", visibleViewIds);
                    for (const viewId of visibleViewIds) {
                        vscode.commands.executeCommand(`${viewId}.focus`).then(undefined, (err) => {
                            this.logger.warn(`[TreeServiceManager] Could not restore focus for view ${viewId}:`, err);
                        });
                    }
                } else {
                    this.logger.trace(
                        "[TreeServiceManager] User had no TestBench views visible. Respecting saved state."
                    );
                }
            }, 500); // 500ms delay for safety.
        } catch (error) {
            this.logger.error("[TreeServiceManager] Failed to initiate restore of visible tree views state:", error);
        }
    }

    /**
     * Restores the data state while ensuring expansion state is preserved
     */
    public async restoreDataState(): Promise<void> {
        this.logger.debug("[TreeServiceManager] Attempting to restore data state for dependent views.");

        try {
            // Restore Test Theme View if context is available
            const cycleContext = this.extensionContext.workspaceState.get<{
                projectKey: string;
                cycleKey: string;
                cycleLabel: string;
            }>(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY);

            if (cycleContext?.projectKey && cycleContext?.cycleKey) {
                this.logger.trace(
                    `[TreeServiceManager] Found persisted Cycle context. Restoring Test Themes for cycle: ${cycleContext.cycleLabel}`
                );

                // Fetch cycle data
                const rawCycleData = await this.projectDataService.fetchCycleStructure(
                    cycleContext.projectKey,
                    cycleContext.cycleKey
                );

                const testThemeProvider = this.getTestThemeProvider();
                const testThemeTreeView = this.getTestThemeTreeView();
                testThemeTreeView.title = `Test Themes (${cycleContext.cycleLabel})`;

                // Preserves expansion state
                testThemeProvider.populateFromCycleData({
                    ...cycleContext,
                    rawCycleStructure: rawCycleData
                });
            }

            // Restore Test Elements View if context is available
            const tovContext = this.extensionContext.workspaceState.get<{
                tovKey: string;
                tovLabel: string;
            }>(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY);

            if (tovContext?.tovKey) {
                this.logger.trace(
                    `[TreeServiceManager] Found persisted TOV context. Restoring Test Elements for TOV: ${tovContext.tovKey}`
                );

                const testElementsProvider = this.getTestElementsProvider();
                // fetchTestElements already handles expansion state properly
                await testElementsProvider.fetchTestElements(tovContext.tovKey, tovContext.tovLabel);
            }
        } catch (error) {
            this.logger.error("[TreeServiceManager] Failed to restore a view's data state:", error);
        }
    }

    /**
     * Create and configure the Project Management tree view
     */
    private async createProjectManagementTree(): Promise<void> {
        const viewId = "projectManagementTree";
        const updateMessage = (message?: string) => {
            const container = this.treeViews.get(viewId);
            if (container?.treeView) {
                container.treeView.message = message;
            }
        };
        const provider = new ProjectManagementTreeDataProvider(
            this.extensionContext,
            this.logger,
            this.iconManagementService,
            updateMessage,
            this.projectDataService
        );
        const treeView = vscode.window.createTreeView(viewId, {
            treeDataProvider: provider,
            canSelectMany: false
        });

        // Handle expansion/collapse events
        this.extensionContext.subscriptions.push(
            treeView.onDidExpandElement((event: vscode.TreeViewExpansionEvent<ProjectManagementTreeItem>) => {
                provider.handleExpansion(event.element, true);
            })
        );
        this.extensionContext.subscriptions.push(
            treeView.onDidCollapseElement((event: vscode.TreeViewExpansionEvent<ProjectManagementTreeItem>) => {
                provider.handleExpansion(event.element, false);
            })
        );

        // Handle selection events with double-click detection
        this.extensionContext.subscriptions.push(
            treeView.onDidChangeSelection(async (event: vscode.TreeViewSelectionChangeEvent<BaseTreeItem>) => {
                this.logger.debug(`[TreeServiceManager] Selection changed, items: ${event.selection.length}`);
                if (event.selection.length > 0) {
                    const selectedItem = event.selection[0];

                    if (selectedItem instanceof ProjectManagementTreeItem) {
                        const currentTime = Date.now();
                        const timeDiff = currentTime - this.lastClickTime;

                        // Check if this is a double-click on a cycle item
                        if (
                            selectedItem.originalContextValue === TreeItemContextValues.CYCLE &&
                            this.lastClickedItem?.getUniqueId() === selectedItem.getUniqueId() &&
                            timeDiff < this.DOUBLE_CLICK_THRESHOLD_MS
                        ) {
                            this.logger.debug(
                                `[TreeServiceManager] Double-click detected on cycle: ${selectedItem.label}`
                            );

                            // Reset click tracking
                            this.lastClickTime = 0;
                            this.lastClickedItem = null;

                            try {
                                await vscode.commands.executeCommand(
                                    allExtensionCommands.openCycleTestThemes,
                                    selectedItem
                                );
                            } catch (error) {
                                this.logger.error(
                                    "[TreeServiceManager] Error executing openCycleTestThemes command:",
                                    error
                                );
                                vscode.window.showErrorMessage(
                                    `Failed to open cycle: ${error instanceof Error ? error.message : "Unknown error"}`
                                );
                            }
                        } else {
                            // Single-click or first click: update tracking and handle selection
                            this.lastClickTime = currentTime;
                            this.lastClickedItem = selectedItem;

                            // Handle normal selection for language server context updates
                            await this.handleProjectTreeSelection(event, provider);
                        }
                    } else {
                        await this.handleProjectTreeSelection(event, provider);
                    }
                }
            })
        );

        // Listen for visibility changes to persist the state.
        this.extensionContext.subscriptions.push(
            treeView.onDidChangeVisibility(() => {
                this.debouncedSaveVisibleViews();
            })
        );
        this.extensionContext.subscriptions.push(treeView);
        this.treeViews.set(viewId, { provider, treeView, updateMessage });
        this.setupProviderStateListener(viewId, provider);
        this.logger.info(
            "[TreeServiceManager] Project Management tree view created with unified state management and double-click handling"
        );
    }

    /**
     * Create and configure the Test Theme tree view
     */
    private async createTestThemeTree(): Promise<void> {
        const viewId = "testThemeTree";
        const updateMessage = (message?: string) => {
            const container = this.treeViews.get(viewId);
            if (container?.treeView) {
                container.treeView.message = message;
            }
        };
        const provider = new TestThemeTreeDataProvider(
            this.extensionContext,
            this.logger,
            updateMessage,
            this.projectDataService,
            this.markedItemStateService,
            this.iconManagementService
        );
        const treeView = vscode.window.createTreeView(viewId, {
            treeDataProvider: provider
        });
        this.extensionContext.subscriptions.push(
            treeView.onDidExpandElement((event: vscode.TreeViewExpansionEvent<TestThemeTreeItem>) => {
                provider.handleExpansion(event.element, true);
            })
        );
        this.extensionContext.subscriptions.push(
            treeView.onDidCollapseElement((event: vscode.TreeViewExpansionEvent<TestThemeTreeItem>) => {
                provider.handleExpansion(event.element, false);
            })
        );
        // Listen for visibility changes to persist the state.
        this.extensionContext.subscriptions.push(
            treeView.onDidChangeVisibility(() => {
                this.debouncedSaveVisibleViews();
            })
        );
        this.extensionContext.subscriptions.push(treeView);
        this.treeViews.set(viewId, { provider, treeView, updateMessage });
        this.setupProviderStateListener(viewId, provider);
        this.logger.info("[TreeServiceManager] Test Theme tree view created with unified state management");
    }

    /**
     * Initialize Test Elements tree without clearing expansion state
     */
    private async createTestElementsTree(): Promise<void> {
        const viewId = "testElementsView";
        const updateMessage = (message?: string) => {
            const container = this.treeViews.get(viewId);
            if (container?.treeView) {
                container.treeView.message = message;
            }
        };
        const provider = new TestElementsTreeDataProvider(
            this.extensionContext,
            this.logger,
            updateMessage,
            this.testElementDataService,
            this.resourceFileService,
            this.iconManagementService,
            this.testElementTreeBuilder
        );
        const treeView = vscode.window.createTreeView(viewId, {
            treeDataProvider: provider
        });

        // Set up event handlers
        this.extensionContext.subscriptions.push(
            treeView.onDidExpandElement((event) => {
                if (provider && typeof provider.handleItemExpansion === "function") {
                    provider.handleItemExpansion(event.element, true);
                }
            })
        );
        this.extensionContext.subscriptions.push(
            treeView.onDidCollapseElement((event) => {
                if (provider && typeof provider.handleItemExpansion === "function") {
                    provider.handleItemExpansion(event.element, false);
                }
            })
        );

        // Listen for visibility changes to persist the state
        this.extensionContext.subscriptions.push(
            treeView.onDidChangeVisibility(() => {
                this.debouncedSaveVisibleViews();
            })
        );

        this.extensionContext.subscriptions.push(treeView);
        this.treeViews.set(viewId, { provider, treeView, updateMessage });
        this.setupProviderStateListener(viewId, provider);

        // Initialize with empty state but preserve expansion state
        provider.updateTreeViewStatusMessage();

        this.logger.info("[TreeServiceManager] Test Elements tree view created with unified state management");
    }

    /**
     * Setup state change listeners for individual providers to enable coordination
     */
    private setupProviderStateListener(providerKey: string, provider: any): void {
        if (provider && provider.getUnifiedStateManager) {
            const listener = (notification: StateChangeNotification) => {
                this.handleProviderStateChange(providerKey, notification);
            };

            provider.getUnifiedStateManager().onStateChange(listener);
            this.stateChangeListeners.set(providerKey, listener);

            this.logger.trace(`[TreeServiceManager] State change listener setup for ${providerKey}`);
        }
    }

    /**
     * Handle state changes from individual providers for coordination
     */
    private handleProviderStateChange(providerKey: string, notification: StateChangeNotification): void {
        this.logger.trace(
            `[TreeServiceManager] State change in ${providerKey}: ${notification.changedFields.join(", ")}`
        );

        if (notification.changedFields.includes("operationalState")) {
            this.logger.debug(
                `[TreeServiceManager] ${providerKey} operational state: ${notification.newState.operationalState}`
            );
        }
    }

    /**
     * Setup unified state coordination between all providers
     */
    private setupUnifiedStateCoordination(): void {
        // Individual providers manage their own state through the unified manager
        // This method can be extended to add cross-provider state coordination
        this.logger.trace("[TreeServiceManager] Unified state coordination setup completed");
    }

    /**
     * Setup interactions between tree views
     */
    private setupTreeViewInteractions(): void {
        const projectProvider = this.getProjectManagementProvider();
        const testThemeProvider = this.getTestThemeProvider();
        const testThemeTreeView = this.getTestThemeTreeView();

        if (projectProvider && testThemeProvider && testThemeTreeView) {
            this.extensionContext.subscriptions.push(
                projectProvider.onDidPrepareCycleDataForThemeTree(async (eventData: CycleDataForThemeTreeEvent) => {
                    testThemeTreeView.title = `Test Themes (${eventData.cycleLabel})`;
                    testThemeProvider.populateFromCycleData(eventData);
                    this.logger.debug(`[TreeServiceManager] Cycle data prepared for ${eventData.cycleLabel}`);
                })
            );
        }
    }

    /**
     * Handle project tree selection changes for language server context
     */
    private async handleProjectTreeSelection(
        event: vscode.TreeViewSelectionChangeEvent<BaseTreeItem>,
        provider: ProjectManagementTreeDataProvider
    ): Promise<void> {
        if (event.selection.length > 0) {
            const selectedItem = event.selection[0];
            if (selectedItem instanceof ProjectManagementTreeItem) {
                this.logger.trace(
                    `[TreeServiceManager] Project Tree selection: ${selectedItem.label}, context: ${selectedItem.contextValue}`
                );

                const { projectName, tovName } = provider.getProjectAndTovNamesForItem(selectedItem);
                this.logger.info(
                    `[TreeServiceManager] Resolved LS Context: Project='${projectName}', TOV='${tovName}'`
                );

                if (projectName && tovName) {
                    await restartLanguageClient(projectName, tovName);
                }
            }
        }
    }

    /**
     * Clear tree data while preserving expansion state (for refresh/repopulation scenarios)
     */
    public async clearAllTreesData(): Promise<void> {
        try {
            this.getProjectManagementProvider().clearTree();
            this.getTestThemeProvider().clearTree();
            this.getTestElementsProvider().clearTree();
            this.logger.info("[TreeServiceManager] All tree data cleared (expansion state preserved)");
        } catch (error) {
            this.logger.error("[TreeServiceManager] Error clearing tree data:", error);
        }
    }

    public getProjectManagementProvider(): ProjectManagementTreeDataProvider {
        const container = this.treeViews.get("projectManagementTree"); // Corrected Key
        if (!container?.provider) {
            throw new Error("Project Management provider is not initialized. Call initializeTreeViews() first.");
        }
        return container.provider;
    }

    public getTestThemeProvider(): TestThemeTreeDataProvider {
        const container = this.treeViews.get("testThemeTree"); // Corrected Key
        if (!container?.provider) {
            throw new Error("Test Theme provider is not initialized. Call initializeTreeViews() first.");
        }
        return container.provider;
    }

    public getTestElementsProvider(): TestElementsTreeDataProvider {
        const container = this.treeViews.get("testElementsView");
        if (!container?.provider) {
            throw new Error("Test Elements provider is not initialized. Call initializeTreeViews() first.");
        }
        return container.provider;
    }

    public getProjectManagementTreeView(): vscode.TreeView<BaseTreeItem> {
        const container = this.treeViews.get("projectManagementTree");
        if (!container?.treeView) {
            throw new Error("Project Management tree view is not initialized. Call initializeTreeViews() first.");
        }
        return container.treeView;
    }

    public getTestThemeTreeView(): vscode.TreeView<TestThemeTreeItem> {
        const container = this.treeViews.get("testThemeTree");
        if (!container?.treeView) {
            throw new Error("Test Theme tree view is not initialized. Call initializeTreeViews() first.");
        }
        return container.treeView;
    }

    public getTestElementsTreeView(): vscode.TreeView<TestElementTreeItem> {
        const container = this.treeViews.get("testElementsView");
        if (!container?.treeView) {
            throw new Error("Test Elements tree view is not initialized. Call initializeTreeViews() first.");
        }
        return container.treeView;
    }

    /**
     * Clear all trees and their persistent state (for logout/disconnect scenarios)
     */
    public async clearAllTrees(): Promise<void> {
        try {
            this.getProjectManagementProvider().clearTreeAndState();
            this.getTestThemeProvider().clearTreeAndState();
            this.getTestElementsProvider().clearTreeAndState();
            this.logger.info("[TreeServiceManager] All trees and state cleared");
        } catch (error) {
            this.logger.error("[TreeServiceManager] Error clearing trees and state:", error);
        }
    }

    public async refreshAllTrees(isHardRefresh: boolean = false): Promise<void> {
        try {
            this.getProjectManagementProvider().refresh(isHardRefresh);
            this.getTestThemeProvider().refresh(isHardRefresh);
            this.getTestElementsProvider().refresh(isHardRefresh);
            this.logger.info(
                `[TreeServiceManager] All trees refreshed (hard: ${isHardRefresh}) using unified state management`
            );
        } catch (error) {
            this.logger.error("[TreeServiceManager] Error refreshing trees:", error);
        }
    }

    public updateTreeTitles(titles: { project?: string; testTheme?: string; testElements?: string }): void {
        try {
            if (titles.testTheme) {
                this.getTestThemeTreeView().title = titles.testTheme;
            }
            if (titles.testElements) {
                this.getTestElementsTreeView().title = titles.testElements;
            }
            this.logger.trace("[TreeServiceManager] Tree titles updated:", titles);
        } catch (error) {
            this.logger.error("[TreeServiceManager] Error updating tree titles:", error);
        }
    }

    public async handleCycleSelection(cycleItem: ProjectManagementTreeItem): Promise<void> {
        try {
            const projectProvider = this.getProjectManagementProvider();
            const testElementsProvider = this.getTestElementsProvider();
            const testElementsTreeView = this.getTestElementsTreeView();

            testElementsProvider.clearTree();

            const tovKey = cycleItem.getTovKey();
            const tovLabel = cycleItem.parent?.label;

            if (tovKey && typeof tovLabel === "string") {
                testElementsTreeView.title = `Test Elements (${tovLabel})`;
                try {
                    const success = await testElementsProvider.fetchTestElements(tovKey, tovLabel);
                    if (!success) {
                        this.logger.warn(`[TreeServiceManager] Failed to fetch test elements for TOV: ${tovKey}`);
                    }
                } catch (error) {
                    this.logger.error("[TreeServiceManager] Error fetching test elements:", error);
                }
            } else if (tovKey) {
                testElementsTreeView.title = `Test Elements (TOV: ${tovKey})`;
            } else {
                testElementsTreeView.title = "Test Elements";
                testElementsProvider.clearTree();
            }

            // Handle Test Themes through project provider
            await projectProvider.handleCycleClick(cycleItem);

            this.logger.info(
                `[TreeServiceManager] Cycle selection handled for: ${cycleItem.label} with unified state management`
            );
        } catch (error) {
            this.logger.error("[TreeServiceManager] Error handling cycle selection:", error);
            throw error;
        }
    }

    public get projectDataService(): ProjectDataService {
        if (!this._projectDataService) {
            throw new Error("ProjectDataService is not initialized. Call initialize() first.");
        }
        return this._projectDataService;
    }

    public get testElementDataService(): TestElementDataService {
        if (!this._testElementDataService) {
            throw new Error("TestElementDataService is not initialized. Call initialize() first.");
        }
        return this._testElementDataService;
    }

    public get resourceFileService(): ResourceFileService {
        if (!this._resourceFileService) {
            throw new Error("ResourceFileService is not initialized. Call initialize() first.");
        }
        return this._resourceFileService;
    }

    public get iconManagementService(): IconManagementService {
        if (!this._iconManagementService) {
            throw new Error("IconManagementService is not initialized. Call initialize() first.");
        }
        return this._iconManagementService;
    }

    public get markedItemStateService(): MarkedItemStateService {
        if (!this._markedItemStateService) {
            throw new Error("MarkedItemStateService is not initialized. Call initialize() first.");
        }
        return this._markedItemStateService;
    }

    public get testElementTreeBuilder(): TestElementTreeBuilder {
        if (!this._testElementTreeBuilder) {
            throw new Error("TestElementTreeBuilder is not initialized. Call initialize() first.");
        }
        return this._testElementTreeBuilder;
    }

    public getInitializationStatus(): boolean {
        return this._isInitialized;
    }

    public createServiceFactory(): TreeServiceFactory {
        return new TreeServiceFactory(this);
    }

    /**
     * Get diagnostic information about the current tree state and services with unified state details
     */
    public getDiagnostics(): Record<string, any> {
        const diagnostics: Record<string, any> = {
            managerType: this.constructor.name,
            isInitialized: this._isInitialized,
            treeViewsCount: this.treeViews.size,
            stateListenersCount: this.stateChangeListeners.size,
            treeViews: {},
            services: {
                projectDataService: !!this._projectDataService,
                testElementDataService: !!this._testElementDataService,
                resourceFileService: !!this._resourceFileService,
                iconManagementService: !!this._iconManagementService,
                markedItemStateService: !!this._markedItemStateService,
                testElementTreeBuilder: !!this._testElementTreeBuilder
            },
            timestamp: new Date().toISOString()
        };

        // Add diagnostics for each tree view including unified state information
        for (const [key, container] of this.treeViews) {
            try {
                const providerDiagnostics =
                    container.provider && typeof container.provider.getDiagnostics === "function"
                        ? container.provider.getDiagnostics()
                        : { error: "No diagnostics available" };

                let unifiedStateDiagnostics = {};
                if (container.provider && container.provider.getUnifiedStateManager) {
                    try {
                        unifiedStateDiagnostics = container.provider.getUnifiedStateManager().getDiagnostics();
                    } catch (error) {
                        unifiedStateDiagnostics = { error: "Failed to get unified state diagnostics" };
                        this.logger.error(
                            `[TreeServiceManager] Error getting unified state diagnostics for ${key}:`,
                            error
                        );
                    }
                }

                diagnostics.treeViews[key] = {
                    hasProvider: !!container.provider,
                    hasTreeView: !!container.treeView,
                    treeViewTitle: container.treeView?.title || "No title",
                    providerDiagnostics,
                    unifiedStateDiagnostics
                };
            } catch (error) {
                diagnostics.treeViews[key] = {
                    error: `Failed to get diagnostics: ${(error as Error).message}`
                };
            }
        }

        return diagnostics;
    }

    /**
     * Dispose of all tree views and clean up resources
     */
    public dispose(): void {
        // Save visible views state one last time before disposing
        this.saveVisibleViewsState();
        for (const [key, listener] of this.stateChangeListeners) {
            try {
                const container = this.treeViews.get(key);
                if (container?.provider && container.provider.getUnifiedStateManager) {
                    container.provider.getUnifiedStateManager().removeStateChangeCallback(listener);
                }
            } catch (error) {
                this.logger.error(`[TreeServiceManager] Error removing state listener for ${key}:`, error);
            }
        }
        this.stateChangeListeners.clear();
        for (const [key, container] of this.treeViews) {
            try {
                if (container.provider && typeof container.provider.dispose === "function") {
                    container.provider.dispose();
                }
            } catch (error) {
                this.logger.error(`[TreeServiceManager] Error disposing provider for ${key}:`, error);
            }
        }
        this.treeViews.clear();
        this.logger.info("[TreeServiceManager] Disposed successfully with unified state management cleanup");
    }
}

/**
 * Factory for creating tree providers with injected dependencies
 */
export class TreeServiceFactory {
    constructor(private readonly treeServiceManager: TreeServiceManager) {}

    createProjectManagementProvider(
        updateMessageCallback: (message: string | undefined) => void
    ): ProjectManagementTreeDataProvider {
        return new ProjectManagementTreeDataProvider(
            this.treeServiceManager.extensionContext,
            this.treeServiceManager.logger,
            this.treeServiceManager.iconManagementService,
            updateMessageCallback,
            this.treeServiceManager.projectDataService
        );
    }

    createTestThemeProvider(updateMessageCallback: (message: string | undefined) => void): TestThemeTreeDataProvider {
        return new TestThemeTreeDataProvider(
            this.treeServiceManager.extensionContext,
            this.treeServiceManager.logger,
            updateMessageCallback,
            this.treeServiceManager.projectDataService,
            this.treeServiceManager.markedItemStateService,
            this.treeServiceManager.iconManagementService
        );
    }

    createTestElementsProvider(
        updateMessageCallback: (message: string | undefined) => void
    ): TestElementsTreeDataProvider {
        return new TestElementsTreeDataProvider(
            this.treeServiceManager.extensionContext,
            this.treeServiceManager.logger,
            updateMessageCallback,
            this.treeServiceManager.testElementDataService,
            this.treeServiceManager.resourceFileService,
            this.treeServiceManager.iconManagementService,
            this.treeServiceManager.testElementTreeBuilder
        );
    }
}
