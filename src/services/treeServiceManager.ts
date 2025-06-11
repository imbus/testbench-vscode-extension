/**
 * @file src/services/treeServiceManager.ts
 * @description TreeServiceManager
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../testBenchLogger";
import {
    allExtensionCommands,
    ContextKeys,
    projectManagementTreeViewID,
    StorageKeys,
    testElementsTreeViewID,
    testThemeTreeViewID,
    TreeItemContextValues
} from "./../constants";
import { ProjectDataService } from "../views/projectManagement/projectDataService";
import { TestElementDataService } from "../views/testElements/testElementDataService";
import { ResourceFileService } from "../views/testElements/resourceFileService";
import { IconManagementService } from "../views/common/iconManagementService";
import { MarkedItemStateService } from "../views/testTheme/markedItemStateService";
import { TestElementTreeBuilder } from "../views/testElements/testElementTreeBuilder";
import {
    ProjectManagementTreeDataProvider,
    DataForThemeTreeEvent
} from "../views/projectManagement/projectManagementTreeDataProvider";
import { TestThemeTreeDataProvider } from "../views/testTheme/testThemeTreeDataProvider";
import { TestElementsTreeDataProvider } from "../views/testElements/testElementsTreeDataProvider";
import { BaseTreeItem } from "../views/common/baseTreeItem";
import { ProjectManagementTreeItem } from "../views/projectManagement/projectManagementTreeItem";
import { TestThemeTreeItem } from "../views/testTheme/testThemeTreeItem";
import { TestElementTreeItem } from "../views/testElements/testElementTreeItem";
import { PlayServerConnection } from "../testBenchConnection";
import { getLanguageClientInstance, restartLanguageClient } from "../server";
import { StateChangeNotification } from "../views/common/unifiedTreeStateManager";
import { debounce } from "../utils";
import { State } from "vscode-languageclient";

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

    // Double click detection on projects tree items
    private lastClickTime = 0;
    private lastClickedItem: ProjectManagementTreeItem | null = null;
    private readonly DOUBLE_CLICK_THRESHOLD_MS = 500;
    private clickTimer: NodeJS.Timeout | null = null;

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

            // Core services
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

            // Small delay to ensure the views are fully registered before focusing
            setTimeout(() => {
                // If the key is undefined, it's the first run, so show the default view.
                if (visibleViewIds === undefined) {
                    this.logger.trace(
                        "[TreeServiceManager] No saved view state found, focusing on default project view."
                    );
                    vscode.commands.executeCommand(`${projectManagementTreeViewID}.focus`).then(undefined, (err) => {
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
            }, 300);
        } catch (error) {
            this.logger.error("[TreeServiceManager] Failed to initiate restore of visible tree views state:", error);
        }
    }

    /**
     * Asynchronously restores the data state for all tree views.
     *
     * Attempts to retrieve the last active context (either a test cycle or a
     * Test Object Version - TOV) from the workspace state. Based on the retrieved context,
     * it fetches the necessary data (project tree, test elements, test themes) and updates
     * the respective tree view providers. It also updates the language server with the
     * current project and TOV context.
     *
     * If no active context is found, or if a project key cannot be resolved, the restoration
     * process is aborted. Errors during the process are logged.
     *
     * @returns A promise that resolves when the data state restoration is complete or aborted.
     */
    public async restoreDataState(): Promise<void> {
        this.logger.debug("[TreeServiceManager] Attempting to restore data state for all views.");

        try {
            const cycleContext = this.extensionContext.workspaceState.get<{
                projectKey: string;
                key: string;
                label: string;
            }>(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY);
            const tovContext = this.extensionContext.workspaceState.get<{
                tovKey: string;
                tovLabel: string;
                projectName?: string;
            }>(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY);

            if (!cycleContext && !tovContext) {
                this.logger.trace(
                    "[TreeServiceManager] No active context found in storage. Skipping data state restore."
                );
                return;
            }

            const projectKey = cycleContext?.projectKey || (await this.findProjectKeyForTov(tovContext));
            if (!projectKey) {
                this.logger.error(
                    "[TreeServiceManager] Could not resolve a projectKey from stored context. Aborting restore."
                );
                return;
            }

            const projectTree = await this.projectDataService.getProjectTree(projectKey);
            const tovNode = cycleContext
                ? projectTree?.children?.find((tov) => tov.children?.some((c) => c.key === cycleContext.key))
                : projectTree?.children?.find((tov) => tov.key === tovContext?.tovKey);

            const projectName = (await this.projectDataService.getProjectsList())?.find(
                (p) => p.key.toString() === projectKey
            )?.name;
            const tovKey = tovNode?.key;
            const tovName = tovNode?.name;

            if (tovKey && tovName) {
                this.logger.trace(`[TreeServiceManager] Restoring Test Elements for TOV: ${tovName} (${tovKey})`);
                await this.getTestElementsProvider().fetchTestElements(tovKey, tovName);
            }

            if (cycleContext) {
                this.logger.trace(`[TreeServiceManager] Restoring Test Themes for Cycle: ${cycleContext.label}`);
                const rawCycleData = await this.projectDataService.fetchTestStructureUsingProjectAndCycleKey(
                    projectKey,
                    cycleContext.key
                );
                this.getTestThemeProvider().loadTestThemesDataFromCycleData({
                    projectKey,
                    key: cycleContext.key,
                    label: cycleContext.label,
                    rawTestStructure: rawCycleData,
                    isFromCycle: true
                });
                this.getTestThemeTreeView().title = `Test Themes (${cycleContext.label})`;
            } else if (tovContext) {
                this.logger.trace(`[TreeServiceManager] Restoring Test Themes for TOV: ${tovContext.tovLabel}`);
                const rawTovData = await this.projectDataService.fetchTestStructureUsingProjectAndTOVKey(
                    projectKey,
                    tovContext.tovKey
                );
                this.getTestThemeProvider().loadTestThemesDataFromCycleData({
                    projectKey,
                    key: tovContext.tovKey,
                    label: tovContext.tovLabel,
                    rawTestStructure: rawTovData,
                    isFromCycle: false
                });
                this.getTestThemeTreeView().title = `Test Themes (${tovContext.tovLabel})`;
            }

            if (projectName && tovName) {
                this.logger.info(
                    `[TreeServiceManager] Updating language server with context: Project='${projectName}', TOV='${tovName}'`
                );
                const existingClient = getLanguageClientInstance();
                if (existingClient && existingClient.state !== State.Stopped) {
                    await vscode.commands.executeCommand("testbench_ls.updateProject", projectName);
                    await vscode.commands.executeCommand("testbench_ls.updateTov", tovName);
                } else {
                    await restartLanguageClient(projectName, tovName);
                }
            }
        } catch (error) {
            this.logger.error("[TreeServiceManager] Failed to restore view data state due to an error:", error);
        }
    }

    /**
     * Finds the project key for a given project name.
     *
     * @param tovContext - An object optionally containing the project name.
     * @returns A promise that resolves to the project key as a string if found, otherwise undefined.
     */
    private async findProjectKeyForTov(tovContext: { projectName?: string } | undefined): Promise<string | undefined> {
        if (!tovContext?.projectName) {
            return undefined;
        }
        const projects = await this.projectDataService.getProjectsList();
        return projects?.find((p) => p.name === tovContext.projectName)?.key.toString();
    }

    /**
     * Create and configure the Project Management tree view
     */
    private async createProjectManagementTree(): Promise<void> {
        const updateMessage = (message?: string) => {
            const treeViewContainer = this.treeViews.get(projectManagementTreeViewID);
            if (treeViewContainer?.treeView) {
                treeViewContainer.treeView.message = message;
            }
        };
        const projectManagementTreeProvider = new ProjectManagementTreeDataProvider(
            this.extensionContext,
            this.logger,
            this.iconManagementService,
            updateMessage,
            this.projectDataService
        );
        const treeView = vscode.window.createTreeView(projectManagementTreeViewID, {
            treeDataProvider: projectManagementTreeProvider,
            canSelectMany: false
        });

        // Handle expansion/collapse events
        this.extensionContext.subscriptions.push(
            treeView.onDidExpandElement((event: vscode.TreeViewExpansionEvent<ProjectManagementTreeItem>) => {
                projectManagementTreeProvider.handleExpansion(event.element, true);
            })
        );
        this.extensionContext.subscriptions.push(
            treeView.onDidCollapseElement((event: vscode.TreeViewExpansionEvent<ProjectManagementTreeItem>) => {
                projectManagementTreeProvider.handleExpansion(event.element, false);
            })
        );

        //  Handle selection change events
        this.extensionContext.subscriptions.push(
            treeView.onDidChangeSelection(async (event: vscode.TreeViewSelectionChangeEvent<BaseTreeItem>) => {
                this.logger.debug(`[TreeServiceManager] Selection changed, items: ${event.selection.length}`);
                if (event.selection.length > 0) {
                    const selectedTreeItem = event.selection[0];
                    if (!(selectedTreeItem instanceof ProjectManagementTreeItem)) {
                        return;
                    }

                    const isCycleItem =
                        selectedTreeItem.originalContextValue === TreeItemContextValues.CYCLE ||
                        selectedTreeItem.contextValue === TreeItemContextValues.CYCLE;

                    const isTovItem =
                        selectedTreeItem.originalContextValue === TreeItemContextValues.VERSION ||
                        selectedTreeItem.contextValue === TreeItemContextValues.VERSION;

                    if (isCycleItem || isTovItem) {
                        await this.handleTovOrCycleSelectionForLS(event, projectManagementTreeProvider);
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
        this.treeViews.set(projectManagementTreeViewID, {
            provider: projectManagementTreeProvider,
            treeView,
            updateMessage
        });
        this.setupProviderStateListener(projectManagementTreeViewID, projectManagementTreeProvider);
        this.logger.info(
            "[TreeServiceManager] Project Management tree view created with unified state management and double-click handling"
        );
    }

    /**
     * Detects double-click events on cycle tree items and handles them appropriately.
     * On single-click, triggers selection handling with a timer. On double-click,
     * clears the timer and executes cycle-specific selection logic.
     *
     * @param cycleItem - The cycle tree item that was clicked
     * @returns Promise that resolves when the click handling is complete
     */
    public async detectAndHandleCycleTreeItemDoubleClick(cycleItem: ProjectManagementTreeItem): Promise<void> {
        const currentTime = new Date().getTime();

        const isDoubleClick =
            currentTime - this.lastClickTime < this.DOUBLE_CLICK_THRESHOLD_MS &&
            this.lastClickedItem?.getUniqueId() === cycleItem.getUniqueId();

        if (isDoubleClick) {
            this.logger.debug(`[TreeServiceManager] Double-click detected on cycle: ${cycleItem.label}`);

            if (this.clickTimer) {
                clearTimeout(this.clickTimer);
            }

            this.clickTimer = null;
            this.lastClickedItem = null;
            this.lastClickTime = 0;

            await vscode.commands.executeCommand(allExtensionCommands.openCycleFromProjectsView, cycleItem);
        } else {
            this.logger.debug(
                `[TreeServiceManager] Single-click detected on cycle: ${cycleItem.label}. Setting timer.`
            );
            this.lastClickTime = currentTime;
            this.lastClickedItem = cycleItem;

            const singleClickEvent = { selection: [cycleItem] };
            const provider = this.getProjectManagementProvider();

            await this.handleTovOrCycleSelectionForLS(singleClickEvent, provider);
        }
    }

    /**
     * Create and configure the Test Theme tree view
     */
    private async createTestThemeTree(): Promise<void> {
        const updateMessage = (message?: string) => {
            const treeViewContainer = this.treeViews.get(testThemeTreeViewID);
            if (treeViewContainer?.treeView) {
                treeViewContainer.treeView.message = message;
            }
        };
        const testThemeTreeDataProvider = new TestThemeTreeDataProvider(
            this.extensionContext,
            this.logger,
            updateMessage,
            this.projectDataService,
            this.markedItemStateService,
            this.iconManagementService
        );
        const treeView = vscode.window.createTreeView(testThemeTreeViewID, {
            treeDataProvider: testThemeTreeDataProvider
        });
        this.extensionContext.subscriptions.push(
            treeView.onDidExpandElement((event: vscode.TreeViewExpansionEvent<TestThemeTreeItem>) => {
                testThemeTreeDataProvider.handleExpansion(event.element, true);
            })
        );
        this.extensionContext.subscriptions.push(
            treeView.onDidCollapseElement((event: vscode.TreeViewExpansionEvent<TestThemeTreeItem>) => {
                testThemeTreeDataProvider.handleExpansion(event.element, false);
            })
        );
        // Listen for visibility changes to persist the state.
        this.extensionContext.subscriptions.push(
            treeView.onDidChangeVisibility(() => {
                this.debouncedSaveVisibleViews();
            })
        );
        this.extensionContext.subscriptions.push(treeView);
        this.treeViews.set(testThemeTreeViewID, { provider: testThemeTreeDataProvider, treeView, updateMessage });
        this.setupProviderStateListener(testThemeTreeViewID, testThemeTreeDataProvider);
        this.logger.info("[TreeServiceManager] Test Theme tree view created with unified state management");
    }

    /**
     * Initialize Test Elements tree without clearing expansion state
     */
    private async createTestElementsTree(): Promise<void> {
        const updateMessage = (message?: string) => {
            const treeViewContainer = this.treeViews.get(testElementsTreeViewID);
            if (treeViewContainer?.treeView) {
                treeViewContainer.treeView.message = message;
            }
        };
        const testElementsTreeProvider = new TestElementsTreeDataProvider(
            this.extensionContext,
            this.logger,
            updateMessage,
            this.testElementDataService,
            this.resourceFileService,
            this.iconManagementService,
            this.testElementTreeBuilder
        );
        const treeView = vscode.window.createTreeView(testElementsTreeViewID, {
            treeDataProvider: testElementsTreeProvider
        });

        // Set up event handlers
        this.extensionContext.subscriptions.push(
            treeView.onDidExpandElement((event) => {
                if (testElementsTreeProvider && typeof testElementsTreeProvider.handleItemExpansion === "function") {
                    testElementsTreeProvider.handleItemExpansion(event.element, true);
                }
            })
        );
        this.extensionContext.subscriptions.push(
            treeView.onDidCollapseElement((event) => {
                if (testElementsTreeProvider && typeof testElementsTreeProvider.handleItemExpansion === "function") {
                    testElementsTreeProvider.handleItemExpansion(event.element, false);
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
        this.treeViews.set(testElementsTreeViewID, { provider: testElementsTreeProvider, treeView, updateMessage });
        this.setupProviderStateListener(testElementsTreeViewID, testElementsTreeProvider);

        // Initialize with empty state but preserve expansion state
        testElementsTreeProvider.updateTreeViewStatusMessage();

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
     * Sets up event listeners and interactions between tree view providers.
     *
     * Currently used to handle interactions between the Project Management tree and Test Theme tree,
     * where the Project Management tree prepares cycle data for the Test Theme tree.
     */
    private setupTreeViewInteractions(): void {
        const projectProvider = this.getProjectManagementProvider();
        const testThemeProvider = this.getTestThemeProvider();
        const testThemeTreeView = this.getTestThemeTreeView();

        if (projectProvider && testThemeProvider && testThemeTreeView) {
            this.extensionContext.subscriptions.push(
                projectProvider.onDidPrepareDataForThemeTree(async (eventData: DataForThemeTreeEvent) => {
                    testThemeTreeView.title = `Test Themes (${eventData.label})`;
                    testThemeProvider.loadTestThemesDataFromCycleData(eventData);
                    this.logger.debug(`[TreeServiceManager] Cycle data prepared for ${eventData.label}`);
                })
            );
        }
    }

    /**
     * Handles tree view selection changes for language server operations when a TOV (Test Object Version)
     * or Cycle item is selected. Restarts the language client with the appropriate project and TOV context.
     *
     * @param event - The tree view selection change event containing selected items
     * @param provider - The project management tree data provider to resolve project/TOV names
     * @returns Promise that resolves when the language client restart is complete
     */
    private async handleTovOrCycleSelectionForLS(
        event: vscode.TreeViewSelectionChangeEvent<BaseTreeItem>,
        provider: ProjectManagementTreeDataProvider
    ): Promise<void> {
        if (event.selection.length > 0) {
            const selectedTreeItem = event.selection[0];
            if (selectedTreeItem instanceof ProjectManagementTreeItem) {
                const isCycleItem =
                    selectedTreeItem.originalContextValue === TreeItemContextValues.CYCLE ||
                    selectedTreeItem.contextValue === TreeItemContextValues.CYCLE;

                const isTovItem =
                    selectedTreeItem.originalContextValue === TreeItemContextValues.VERSION ||
                    selectedTreeItem.contextValue === TreeItemContextValues.VERSION;

                // Only handle cycle or TOV items
                if (!isCycleItem && !isTovItem) {
                    return;
                }

                this.logger.trace(
                    `[TreeServiceManager] Project Tree selection: ${selectedTreeItem.label}, context: ${selectedTreeItem.contextValue}`
                );

                const { projectName, tovName } = provider.getProjectAndTovNamesFromProjectTreeItem(selectedTreeItem);
                this.logger.info(
                    `[TreeServiceManager] Resolved LS Context: Project='${projectName}', TOV='${tovName}'`
                );

                if (projectName && tovName) {
                    const existingClient = getLanguageClientInstance();
                    if (existingClient && existingClient.state !== State.Stopped) {
                        await vscode.commands.executeCommand("testbench_ls.updateProject", projectName);
                        await vscode.commands.executeCommand("testbench_ls.updateTov", tovName);
                    } else {
                        await restartLanguageClient(projectName, tovName);
                    }
                }
            }
        }
    }

    /**
     * Clear tree data while preserving expansion state (for refresh/repopulation scenarios)
     */
    public async clearAllTreesData(): Promise<void> {
        try {
            await this.extensionContext.workspaceState.update(StorageKeys.CUSTOM_ROOT_PROJECT_TREE, undefined);
            await this.extensionContext.workspaceState.update(StorageKeys.CUSTOM_ROOT_TEST_THEME_TREE, undefined);

            this.getProjectManagementProvider().clearTree();
            this.getTestThemeProvider().clearTree();
            this.getTestElementsProvider().clearTree();
            this.logger.info("[TreeServiceManager] All tree data cleared (expansion state preserved)");
        } catch (error) {
            this.logger.error("[TreeServiceManager] Error clearing tree data:", error);
        }
    }

    public getProjectManagementProvider(): ProjectManagementTreeDataProvider {
        const treeViewContainer = this.treeViews.get(projectManagementTreeViewID);
        if (!treeViewContainer?.provider) {
            throw new Error("Project Management provider is not initialized. Call initializeTreeViews() first.");
        }
        return treeViewContainer.provider;
    }

    public getTestThemeProvider(): TestThemeTreeDataProvider {
        const treeViewContainer = this.treeViews.get(testThemeTreeViewID);
        if (!treeViewContainer?.provider) {
            throw new Error("Test Theme provider is not initialized. Call initializeTreeViews() first.");
        }
        return treeViewContainer.provider;
    }

    public getTestElementsProvider(): TestElementsTreeDataProvider {
        const treeViewContainer = this.treeViews.get(testElementsTreeViewID);
        if (!treeViewContainer?.provider) {
            throw new Error("Test Elements provider is not initialized. Call initializeTreeViews() first.");
        }
        return treeViewContainer.provider;
    }

    public getProjectManagementTreeView(): vscode.TreeView<BaseTreeItem> {
        const treeViewContainer = this.treeViews.get(projectManagementTreeViewID);
        if (!treeViewContainer?.treeView) {
            throw new Error("Project Management tree view is not initialized. Call initializeTreeViews() first.");
        }
        return treeViewContainer.treeView;
    }

    public getTestThemeTreeView(): vscode.TreeView<TestThemeTreeItem> {
        const treeViewContainer = this.treeViews.get(testThemeTreeViewID);
        if (!treeViewContainer?.treeView) {
            throw new Error("Test Theme tree view is not initialized. Call initializeTreeViews() first.");
        }
        return treeViewContainer.treeView;
    }

    public getTestElementsTreeView(): vscode.TreeView<TestElementTreeItem> {
        const treeViewContainer = this.treeViews.get(testElementsTreeViewID);
        if (!treeViewContainer?.treeView) {
            throw new Error("Test Elements tree view is not initialized. Call initializeTreeViews() first.");
        }
        return treeViewContainer.treeView;
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

    /**
     * Refreshes all tree providers in the tree service manager.
     *
     * @param isHardRefresh - Whether to perform a hard refresh that clears cached data. Defaults to false.
     * @returns A promise that resolves when all trees have been refreshed.
     */
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

    /**
     * Updates the titles of tree views based on the provided title configuration.
     *
     * @param titles - Object containing optional title strings for different tree views
     * @param titles.project - Optional title for the project tree view (unused)
     * @param titles.testTheme - Optional title for the test theme tree view
     * @param titles.testElements - Optional title for the test elements tree view
     */
    public updateTreeViewTitles(titles: { project?: string; testTheme?: string; testElements?: string }): void {
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

    /**
     * Handles the selection of a cycle item in the project management tree.
     * Updates the test elements tree view and initializes test themes based on the selected cycle.
     *
     * @param cycleItem - The selected cycle item from the project management tree
     * @throws Error if cycle selection handling fails
     */
    public async handleCycleSelection(cycleItem: ProjectManagementTreeItem): Promise<void> {
        try {
            const projectProvider = this.getProjectManagementProvider();
            const testElementsProvider = this.getTestElementsProvider();
            const testElementsTreeView = this.getTestElementsTreeView();

            testElementsProvider.clearTree();

            const tovKey = cycleItem.getTovKey();
            const tovLabel = cycleItem.parent?.label;

            // Handle Test Elements
            if (tovKey && typeof tovLabel === "string") {
                testElementsTreeView.title = `Test Elements (${tovLabel})`;
                try {
                    const fetchTestElementsResult = await testElementsProvider.fetchTestElements(tovKey, tovLabel);
                    if (!fetchTestElementsResult) {
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

            // Handle Test Themes
            const testThemeProvider = this.getTestThemeProvider();
            testThemeProvider.isTestThemeOpenedFromACycle = true;
            await projectProvider.initTestThemeTreeAfterCycleClick(cycleItem);

            this.logger.info(
                `[TreeServiceManager] Cycle selection handled for: ${cycleItem.label} with unified state management`
            );
        } catch (error) {
            this.logger.error("[TreeServiceManager] Error handling cycle selection:", error);
            throw error;
        }
    }

    /**
     * Handles the open command for a TOV item in projects tree.
     * Initializes the test themes based on the selected TOV.
     *
     * @param tovItem - The selected TOV item from the project management tree
     * @throws Error if TOV opening fails
     */
    public async openTovAndInitTestThemes(tovItem: ProjectManagementTreeItem): Promise<void> {
        try {
            await vscode.commands.executeCommand("setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, false);
            await this.extensionContext.globalState.update(StorageKeys.IS_TT_OPENED_FROM_CYCLE_STORAGE_KEY, false);

            const projectProvider = this.getProjectManagementProvider();
            const testThemeProvider = this.getTestThemeProvider();
            testThemeProvider.isTestThemeOpenedFromACycle = false;
            testThemeProvider.clearTree();

            await projectProvider.initTestThemeTreeAfterTOVClick(tovItem);

            this.logger.info(`[TreeServiceManager] Opened TOV for: ${tovItem.label} with unified state management`);
        } catch (error) {
            this.logger.error("[TreeServiceManager] Error opening TOV:", error);
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
