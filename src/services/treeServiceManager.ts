/**
 * @file src/services/treeServiceManager.ts
 * @description Enhanced TreeServiceManager with centralized tree view management
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../testBenchLogger";
import { ProjectDataService } from "./projectDataService";
import { TestElementDataService } from "./testElementDataService";
import { ResourceFileService } from "./resourceFileService";
import { IconManagementService } from "./iconManagementService";
import { MarkedItemStateService } from "./markedItemStateService";
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
 * Centralized manager for all tree-related services and views
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

    constructor(dependencies: TreeServiceDependencies) {
        this.extensionContext = dependencies.extensionContext;
        this.logger = dependencies.logger;
        this.getConnection = dependencies.getConnection;
        this.logger.trace("[TreeServiceManager] Initialized with enhanced tree view management");
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

            // Initialize core services
            this._iconManagementService = new IconManagementService(this.logger, this.extensionContext);
            this._resourceFileService = new ResourceFileService(this.logger);
            this._projectDataService = new ProjectDataService(this.getConnection, this.logger);
            this._testElementDataService = new TestElementDataService(this.getConnection, this.logger);
            this._markedItemStateService = new MarkedItemStateService(this.extensionContext, this.logger);
            this._testElementTreeBuilder = new TestElementTreeBuilder(this.logger);

            this._isInitialized = true;
            this.logger.info("[TreeServiceManager] All services initialized successfully");
        } catch (error) {
            this.logger.error("[TreeServiceManager] Failed to initialize services:", error);
            throw new Error(`TreeServiceManager initialization failed: ${(error as Error).message}`);
        }
    }

    /**
     * Create and register all tree views with the extension context
     */
    public async initializeTreeViews(): Promise<void> {
        if (!this._isInitialized) {
            throw new Error("TreeServiceManager must be initialized before creating tree views");
        }

        try {
            // Create Project Management Tree
            await this.createProjectManagementTree();

            // Create Test Theme Tree
            await this.createTestThemeTree();

            // Create Test Elements Tree
            await this.createTestElementsTree();

            // Setup inter-tree communication
            this.setupTreeViewInteractions();

            this.logger.info("[TreeServiceManager] All tree views initialized successfully");
        } catch (error) {
            this.logger.error("[TreeServiceManager] Failed to initialize tree views:", error);
            throw error;
        }
    }

    /**
     * Create and configure the Project Management tree view
     */
    private async createProjectManagementTree(): Promise<void> {
        const updateMessage = (message?: string) => {
            const container = this.treeViews.get("projectManagement");
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

        const treeView = vscode.window.createTreeView("projectManagementTree", {
            treeDataProvider: provider,
            canSelectMany: false
        });

        // Setup selection change listener for language server context
        this.extensionContext.subscriptions.push(
            treeView.onDidChangeSelection(async (event: vscode.TreeViewSelectionChangeEvent<BaseTreeItem>) => {
                await this.handleProjectTreeSelection(event, provider);
            })
        );

        this.extensionContext.subscriptions.push(treeView);
        this.treeViews.set("projectManagement", { provider, treeView, updateMessage });

        this.logger.info("[TreeServiceManager] Project Management tree view created");
    }

    /**
     * Create and configure the Test Theme tree view
     */
    private async createTestThemeTree(): Promise<void> {
        const updateMessage = (message?: string) => {
            const container = this.treeViews.get("testTheme");
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

        const treeView = vscode.window.createTreeView("testThemeTree", {
            treeDataProvider: provider
        });

        this.extensionContext.subscriptions.push(treeView);
        this.treeViews.set("testTheme", { provider, treeView, updateMessage });

        this.logger.info("[TreeServiceManager] Test Theme tree view created");
    }

    /**
     * Create and configure the Test Elements tree view
     */
    private async createTestElementsTree(): Promise<void> {
        const updateMessage = (message?: string) => {
            const container = this.treeViews.get("testElements");
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

        const treeView = vscode.window.createTreeView("testElementsView", {
            treeDataProvider: provider
        });

        // Setup expansion event handlers
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

        this.extensionContext.subscriptions.push(treeView);
        this.treeViews.set("testElements", { provider, treeView, updateMessage });

        // Initialize with clear state
        provider.clearTree();

        this.logger.info("[TreeServiceManager] Test Elements tree view created");
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

    // Getter methods with proper error handling
    public getProjectManagementProvider(): ProjectManagementTreeDataProvider {
        const container = this.treeViews.get("projectManagement");
        if (!container?.provider) {
            throw new Error("Project Management provider is not initialized. Call initializeTreeViews() first.");
        }
        return container.provider;
    }

    public getTestThemeProvider(): TestThemeTreeDataProvider {
        const container = this.treeViews.get("testTheme");
        if (!container?.provider) {
            throw new Error("Test Theme provider is not initialized. Call initializeTreeViews() first.");
        }
        return container.provider;
    }

    public getTestElementsProvider(): TestElementsTreeDataProvider {
        const container = this.treeViews.get("testElements");
        if (!container?.provider) {
            throw new Error("Test Elements provider is not initialized. Call initializeTreeViews() first.");
        }
        return container.provider;
    }

    public getProjectManagementTreeView(): vscode.TreeView<BaseTreeItem> {
        const container = this.treeViews.get("projectManagement");
        if (!container?.treeView) {
            throw new Error("Project Management tree view is not initialized. Call initializeTreeViews() first.");
        }
        return container.treeView;
    }

    public getTestThemeTreeView(): vscode.TreeView<TestThemeTreeItem> {
        const container = this.treeViews.get("testTheme");
        if (!container?.treeView) {
            throw new Error("Test Theme tree view is not initialized. Call initializeTreeViews() first.");
        }
        return container.treeView;
    }

    public getTestElementsTreeView(): vscode.TreeView<TestElementTreeItem> {
        const container = this.treeViews.get("testElements");
        if (!container?.treeView) {
            throw new Error("Test Elements tree view is not initialized. Call initializeTreeViews() first.");
        }
        return container.treeView;
    }

    // Utility methods for common operations
    public async clearAllTrees(): Promise<void> {
        try {
            this.getProjectManagementProvider().clearTree();
            this.getTestThemeProvider().clearTree();
            this.getTestElementsProvider().clearTree();
            this.logger.info("[TreeServiceManager] All trees cleared");
        } catch (error) {
            this.logger.error("[TreeServiceManager] Error clearing trees:", error);
        }
    }

    public async refreshAllTrees(isHardRefresh: boolean = false): Promise<void> {
        try {
            this.getProjectManagementProvider().refresh(isHardRefresh);
            this.getTestThemeProvider().refresh(isHardRefresh);
            this.getTestElementsProvider().refresh(isHardRefresh);
            this.logger.info(`[TreeServiceManager] All trees refreshed (hard: ${isHardRefresh})`);
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
            const testThemeProvider = this.getTestThemeProvider();
            const testElementsProvider = this.getTestElementsProvider();
            const testElementsTreeView = this.getTestElementsTreeView();

            // Clear previous content
            testThemeProvider.clearTree();
            testElementsProvider.clearTree();

            const tovKey = cycleItem.getTovKey();
            const tovLabel = cycleItem.parent?.label;

            // Handle Test Elements
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

            this.logger.info(`[TreeServiceManager] Cycle selection handled for: ${cycleItem.label}`);
        } catch (error) {
            this.logger.error("[TreeServiceManager] Error handling cycle selection:", error);
            throw error;
        }
    }

    // Service getters (existing implementation)
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
     * Get diagnostic information about the current tree state and services
     */
    public getDiagnostics(): Record<string, any> {
        const diagnostics: Record<string, any> = {
            managerType: this.constructor.name,
            isInitialized: this._isInitialized,
            treeViewsCount: this.treeViews.size,
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

        // Add diagnostics for each tree view
        for (const [key, container] of this.treeViews) {
            try {
                const providerDiagnostics =
                    container.provider && typeof container.provider.getDiagnostics === "function"
                        ? container.provider.getDiagnostics()
                        : { error: "No diagnostics available" };

                diagnostics.treeViews[key] = {
                    hasProvider: !!container.provider,
                    hasTreeView: !!container.treeView,
                    treeViewTitle: container.treeView?.title || "No title",
                    providerDiagnostics
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
        this.logger.info("[TreeServiceManager] Disposed successfully");
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
