/**
 * @file src/treeViews/TreeViewFactory.ts
 * @description Factory class for creating and configuring tree views
 */

import * as vscode from "vscode";
import { ProjectsTreeView } from "./implementations/projects/ProjectsTreeView";
import { TestThemesTreeView } from "./implementations/testThemes/TestThemesTreeView";
import { TestElementsTreeView } from "./implementations/testElements/TestElementsTreeView";
import { PlayServerConnection } from "../testBenchConnection";
import { TreeViewConfig } from "./core/TreeViewConfig";
import { allExtensionCommands, ContextKeys, StorageKeys } from "../constants";
import { TestBenchLogger } from "../testBenchLogger";
import { createAllTreeViews } from ".";
import {
    extensionContext,
    treeViews,
    getConnection,
    logger,
    setTreeViews,
    setExtensionContext,
    userSessionManager
} from "../extension";
import {
    displayProjectManagementTreeView,
    hideProjectManagementTreeView
} from "./implementations/projects/ProjectsTreeView";
import {
    displayTestElementsTreeView,
    hideTestElementsTreeView
} from "./implementations/testElements/TestElementsTreeView";
import { displayTestThemeTreeView, hideTestThemeTreeView } from "./implementations/testThemes/TestThemesTreeView";

export interface TreeViews {
    projectsTree: ProjectsTreeView;
    testThemesTree: TestThemesTreeView;
    testElementsTree: TestElementsTreeView;
    initialize: () => Promise<void>;
    dispose: () => void;
    refresh: () => void;
    clear: () => void;
    saveCurrentState: () => Promise<void>;
    resetForNewUser: () => Promise<void>;
    reloadAllTreeViewsStateFromPersistence: () => Promise<void>;
    // View state management methods
    saveUIContext: (viewId: "projects" | "testThemes" | "testElements", contextData?: any) => Promise<void>;
    clearViewState: () => Promise<void>;
    restoreViewsState: () => Promise<void>;
    loadDefaultViewsUI: () => Promise<void>;
    isValidSavedContext: (savedContext: any) => boolean;
}

export interface TreeViewFactoryOptions {
    customConfigs?: {
        projects?: Partial<TreeViewConfig>;
        testThemes?: Partial<TreeViewConfig>;
        testElements?: Partial<TreeViewConfig>;
    };
}

/**
 * Factory class responsible for creating and wiring up all tree views
 */
export class TreeViewFactory {
    private readonly logger = new TestBenchLogger();
    private disposables: vscode.Disposable[] = [];

    /**
     * Creates all tree views with proper configuration and inter-tree communication
     * @param context The extension context
     * @param getConnection The function to get the connection
     * @param options The options for the tree views
     * @return The tree views
     */
    public createTreeViews(
        context: vscode.ExtensionContext,
        getConnection: () => PlayServerConnection | null,
        options?: TreeViewFactoryOptions
    ): TreeViews {
        this.logger.debug("[TreeViewFactory] Creating extension tree views.");

        const projectsTree = this.createProjectsTreeView(context, getConnection, options?.customConfigs?.projects);

        const testThemesTree = this.createTestThemesTreeView(
            context,
            getConnection,
            options?.customConfigs?.testThemes
        );

        const testElementsTree = this.createTestElementsTreeView(
            context,
            getConnection,
            options?.customConfigs?.testElements
        );

        this.setupInterTreeCommunication(projectsTree, testThemesTree, testElementsTree);
        this.registerGlobalCommands(context, projectsTree, testThemesTree, testElementsTree);

        return {
            projectsTree,
            testThemesTree,
            testElementsTree,
            initialize: async () => {
                await Promise.all([
                    projectsTree.initialize(),
                    testThemesTree.initialize(),
                    testElementsTree.initialize()
                ]);
            },
            dispose: () => {
                projectsTree.dispose();
                testThemesTree.dispose();
                testElementsTree.dispose();
                this.disposables.forEach((d) => d.dispose());
                this.disposables = [];
            },
            refresh: () => {
                projectsTree.refresh();
                testThemesTree.refresh();
                testElementsTree.refresh();
            },
            clear: () => {
                projectsTree.clearTree();
                testThemesTree.clearTree();
                testElementsTree.clearTree();
            },
            saveCurrentState: async () => {
                await this.saveCurrentTreeViewState(projectsTree, testThemesTree, testElementsTree);
            },
            resetForNewUser: async () => {
                await this.resetTreeViewsForNewUser(projectsTree, testThemesTree, testElementsTree);
            },
            reloadAllTreeViewsStateFromPersistence: async () => {
                await this.reloadAllTreeViewStateFromPersistence(projectsTree, testThemesTree, testElementsTree);
            },
            // View state management methods
            saveUIContext: async (viewId: "projects" | "testThemes" | "testElements", contextData?: any) => {
                await this.saveUIContext(context, viewId, contextData);
            },
            clearViewState: async () => {
                await this.clearViewState(context);
            },
            restoreViewsState: async () => {
                await this.restoreTreeViewsState(context, { projectsTree, testThemesTree, testElementsTree });
            },
            loadDefaultViewsUI: async () => {
                await this.loadDefaultTreeViewsUI({ projectsTree, testThemesTree, testElementsTree });
            },
            isValidSavedContext: (savedContext: any) => {
                return this.isValidSavedContext(savedContext);
            }
        };
    }

    /**
     * Creates the Projects tree view
     * @param context The extension context
     * @param getConnection The function to get the connection
     * @param customConfig The custom configuration for the tree view
     * @return The projects tree view
     */
    private createProjectsTreeView(
        context: vscode.ExtensionContext,
        getConnection: () => PlayServerConnection | null,
        customConfig?: Partial<TreeViewConfig>
    ): ProjectsTreeView {
        this.logger.debug("[TreeViewFactory] Creating Projects tree view.");

        const treeView = new ProjectsTreeView(context, getConnection, customConfig);

        const vscTreeView = vscode.window.createTreeView(treeView.config.id, {
            treeDataProvider: treeView,
            // showCollapseAll: true,
            canSelectMany: false
        });

        treeView.setTreeView(vscTreeView);

        context.subscriptions.push(vscTreeView);
        this.disposables.push(vscTreeView);

        this.setupTreeViewHandlers(treeView, vscTreeView, "projects");

        return treeView;
    }

    /**
     * Creates the Test Themes tree view
     * @param context The extension context
     * @param getConnection The function to get the connection
     * @param customConfig The custom configuration for the tree view
     * @return The test themes tree view
     */
    private createTestThemesTreeView(
        context: vscode.ExtensionContext,
        getConnection: () => PlayServerConnection | null,
        customConfig?: Partial<TreeViewConfig>
    ): TestThemesTreeView {
        this.logger.debug("[TreeViewFactory] Creating Test Themes tree view.");

        const treeView = new TestThemesTreeView(context, getConnection, customConfig);

        const vscTreeView = vscode.window.createTreeView(treeView.config.id, {
            treeDataProvider: treeView,
            // showCollapseAll: true,
            canSelectMany: false
        });

        treeView.setTreeView(vscTreeView);

        context.subscriptions.push(vscTreeView);
        this.disposables.push(vscTreeView);

        this.setupTreeViewHandlers(treeView, vscTreeView, "testThemes");

        return treeView;
    }

    /**
     * Creates the Test Elements tree view
     * @param context The extension context
     * @param getConnection The function to get the connection
     * @param customConfig The custom configuration for the tree view
     * @return The test elements tree view
     */
    private createTestElementsTreeView(
        context: vscode.ExtensionContext,
        getConnection: () => PlayServerConnection | null,
        customConfig?: Partial<TreeViewConfig>
    ): TestElementsTreeView {
        this.logger.debug("[TreeViewFactory] Creating Test Elements tree view.");

        const treeView = new TestElementsTreeView(context, getConnection, customConfig);

        const vscTreeView = vscode.window.createTreeView(treeView.config.id, {
            treeDataProvider: treeView,
            // showCollapseAll: true,
            canSelectMany: false
        });

        treeView.setTreeView(vscTreeView);

        context.subscriptions.push(vscTreeView);
        this.disposables.push(vscTreeView);

        this.setupTreeViewHandlers(treeView, vscTreeView, "testElements");

        return treeView;
    }

    /**
     * Sets up common event handlers for a tree view
     * @param treeView The tree view to set up event handlers for
     * @param vscTreeView The VS Code tree view
     * @param treeType The type of tree
     */
    private setupTreeViewHandlers<T extends { config: TreeViewConfig; eventBus: any }>(
        treeView: T,
        vscTreeView: vscode.TreeView<any>,
        treeType: "projects" | "testThemes" | "testElements"
    ): void {
        // Track visibility
        const visibilityDisposable = vscTreeView.onDidChangeVisibility((e) => {
            this.logger.trace(`[TreeViewFactory] ${treeType} tree visibility changed: ${e.visible}`);

            treeView.eventBus.emit({
                type: "tree:visible",
                source: treeView.config.id,
                data: { visible: e.visible },
                timestamp: Date.now()
            });
        });

        // Track selection
        const selectionDisposable = vscTreeView.onDidChangeSelection((e) => {
            if (e.selection.length > 0) {
                const item = e.selection[0];
                this.logger.trace(`[TreeViewFactory] ${treeType} tree item selected: ${item.label}`);

                treeView.eventBus.emit({
                    type: "tree:itemSelected",
                    source: treeView.config.id,
                    data: { item, selection: e.selection },
                    timestamp: Date.now()
                });

                // Handle specific item types
                this.handleItemSelection(treeView, item, treeType);
            }
        });

        // Track expansion/collapse
        const expansionDisposable = vscTreeView.onDidExpandElement((e) => {
            this.logger.trace(`[TreeViewFactory] ${treeType} tree item expanded: ${e.element.label}`);

            treeView.eventBus.emit({
                type: "tree:itemExpanded",
                source: treeView.config.id,
                data: { item: e.element },
                timestamp: Date.now()
            });
        });

        const collapseDisposable = vscTreeView.onDidCollapseElement((e) => {
            this.logger.trace(`[TreeViewFactory] ${treeType} tree item collapsed: ${e.element.label}`);

            treeView.eventBus.emit({
                type: "tree:itemCollapsed",
                source: treeView.config.id,
                data: { item: e.element },
                timestamp: Date.now()
            });
        });

        this.disposables.push(visibilityDisposable, selectionDisposable, expansionDisposable, collapseDisposable);
    }

    /**
     * Handle item selection based on tree type
     * @param treeView The tree view to handle item selection for
     * @param item The item that was selected
     * @param treeType The type of tree
     */
    private handleItemSelection<T extends { config: TreeViewConfig; eventBus: any }>(
        treeView: T,
        item: any,
        treeType: "projects" | "testThemes" | "testElements"
    ): void {
        if (treeType === "projects") {
            // Handle project tree selections
            // Cycle clicks are handled in setupCycleClickHandlers of ProjectsTreeView
            if (item.data?.type === "version") {
                const projectName = item.parent?.label?.toString();
                treeView.eventBus.emit({
                    type: "version:selected",
                    source: treeView.config.id,
                    data: {
                        projectKey: item.getProjectKey(),
                        versionKey: item.data.key,
                        versionLabel: item.label,
                        tovKey: item.data.key,
                        tovLabel: item.label,
                        projectName: projectName,
                        tovName: item.label?.toString()
                    },
                    timestamp: Date.now()
                });
            }
        } else if (treeType === "testThemes") {
            // Handle test theme tree selections
            if (item.data?.type === "testCase") {
                treeView.eventBus.emit({
                    type: "testCase:selected",
                    source: treeView.config.id,
                    data: { item },
                    timestamp: Date.now()
                });
            }
        } else if (treeType === "testElements") {
            // Handle test elements tree selections
            /*
            if (item.data?.testElementType === "Interaction") {
                treeView.eventBus.emit({
                    type: "interaction:selected",
                    source: treeView.config.id,
                    data: { item },
                    timestamp: Date.now()
                });
            }*/
        }
    }

    /**
     * Sets up communication between tree views
     * @param projectsTree The projects tree view
     * @param testThemesTree The test themes tree view
     * @param testElementsTree The test elements tree view
     */
    private setupInterTreeCommunication(
        projectsTree: ProjectsTreeView,
        testThemesTree: TestThemesTreeView,
        testElementsTree: TestElementsTreeView
    ): void {
        this.logger.trace("[TreeViewFactory] Setting up inter-tree communication.");

        // Projects to Test Themes: When cycle is selected
        const cycleSelectionDisposable = projectsTree.eventBus.on("cycle:selected", async (event) => {
            const { projectKey, cycleKey, tovKey, cycleLabel, projectName, tovName } = event.data;
            this.logger.debug(`[TreeViewFactory] Selected Test Cycle '${cycleLabel}' in projects view.`);

            if (projectName && tovName && tovKey) {
                await testThemesTree.loadCycle(projectKey, cycleKey, tovKey, projectName, tovName, cycleLabel);
            } else {
                this.logger.error("[TreeViewFactory] Missing project, TOV name, or TOV key for cycle selection event.");
            }
        });

        // Projects to Test Elements: When version is selected
        const versionSelectionDisposable = projectsTree.eventBus.on("version:selected", async (event) => {
            const { tovKey, tovLabel, projectName, tovName } = event.data;
            this.logger.debug(`[TreeViewFactory] Selected Test Object Version '${tovLabel}' in projects tree.`);

            await testElementsTree.loadTov(tovKey, tovLabel, projectName, tovName);
        });

        // Test Themes to Projects: When test generation completes
        const testGenerationDisposable = testThemesTree.eventBus.on("testGeneration:completed", () => {
            projectsTree.refresh();
        });

        // Marking synchronization
        const markingDisposable = testThemesTree.eventBus.on("marking:added", () => {
            projectsTree.refresh();
        });

        // Store disposables
        this.disposables.push(
            { dispose: () => cycleSelectionDisposable.unsubscribe() },
            { dispose: () => versionSelectionDisposable.unsubscribe() },
            { dispose: () => testGenerationDisposable.unsubscribe() },
            { dispose: () => markingDisposable.unsubscribe() }
        );
    }

    /**
     * Register global commands that affect multiple trees
     * @param context The extension context
     * @param projectsTree The projects tree view
     * @param testThemesTree The test themes tree view
     * @param testElementsTree The test elements tree view
     */
    private registerGlobalCommands(
        context: vscode.ExtensionContext,
        projectsTree: ProjectsTreeView,
        testThemesTree: TestThemesTreeView,
        testElementsTree: TestElementsTreeView
    ): void {
        this.logger.trace("[TreeViewFactory] Registering global tree commands.");

        // Refresh all trees
        const refreshAllCmd = vscode.commands.registerCommand(allExtensionCommands.refreshAllTrees, async () => {
            await Promise.all([projectsTree.refresh(), testThemesTree.refresh(), testElementsTree.refresh()]);
        });

        // Clear all custom roots
        const clearRootsCmd = vscode.commands.registerCommand(allExtensionCommands.clearAllCustomRoots, () => {
            this.logger.trace("[TreeViewFactory] Clearing all custom roots of tree views");

            projectsTree.resetCustomRoot();
            testThemesTree.resetCustomRoot();
            // TestElementsTreeView doesnt support custom roots
        });

        // Clear all marks
        const clearMarksCmd = vscode.commands.registerCommand(allExtensionCommands.clearAllMarks, () => {
            this.logger.trace("[TreeViewFactory] Clearing all markings from test theme tree view");

            const markingModule = testThemesTree.getModule("marking");
            if (markingModule) {
                markingModule.clearAllMarks();
            }
        });

        // Store disposables
        context.subscriptions.push(refreshAllCmd, clearRootsCmd, clearMarksCmd);
        this.disposables.push(refreshAllCmd, clearRootsCmd, clearMarksCmd);
    }

    /**
     * Saves the current state of all tree views to ensure persistence across sessions.
     * This method forces immediate persistence of expansion state and other UI state.
     * @param projectsTree The projects tree view
     * @param testThemesTree The test themes tree view
     * @param testElementsTree The test elements tree view
     */
    private async saveCurrentTreeViewState(
        projectsTree: ProjectsTreeView,
        testThemesTree: TestThemesTreeView,
        testElementsTree: TestElementsTreeView
    ): Promise<void> {
        try {
            const savePromises: Promise<void>[] = [];

            const persistenceModules = [
                projectsTree.getModule("persistence"),
                testThemesTree.getModule("persistence"),
                testElementsTree.getModule("persistence")
            ];

            for (const persistenceModule of persistenceModules) {
                if (persistenceModule && typeof (persistenceModule as any).forceSave === "function") {
                    savePromises.push((persistenceModule as any).forceSave());
                }
            }

            await Promise.all(savePromises);
            this.logger.debug("[TreeViewFactory] Successfully saved current tree view state");
        } catch (error) {
            this.logger.error("[TreeViewFactory] Error saving tree view state:", error);
        }
    }

    /**
     * Resets tree view state when switching to a different user.
     * Ensures each user has their own clean state when logging in for the first time
     * or when switching between different user accounts.
     * @param projectsTree The projects tree view
     * @param testThemesTree The test themes tree view
     * @param testElementsTree The test elements tree view
     */
    private async resetTreeViewsForNewUser(
        projectsTree: ProjectsTreeView,
        testThemesTree: TestThemesTreeView,
        testElementsTree: TestElementsTreeView
    ): Promise<void> {
        try {
            await this.saveCurrentTreeViewState(projectsTree, testThemesTree, testElementsTree);

            projectsTree.resetForNewSession();
            testThemesTree.resetForNewSession();
            testElementsTree.resetForNewSession();

            this.logger.debug("[TreeViewFactory] Successfully reset tree views for new user");
        } catch (error) {
            this.logger.error("[TreeViewFactory] Error resetting tree views for new user:", error);
        }
    }

    /**
     * Reloads tree view state from persistence for all tree views.
     * Called when a user session is established to restore their saved UI state.
     * @param projectsTree The projects tree view
     * @param testThemesTree The test themes tree view
     * @param testElementsTree The test elements tree view
     */
    private async reloadAllTreeViewStateFromPersistence(
        projectsTree: ProjectsTreeView,
        testThemesTree: TestThemesTreeView,
        testElementsTree: TestElementsTreeView
    ): Promise<void> {
        try {
            await Promise.all([
                projectsTree.reloadStateFromPersistence(),
                testThemesTree.reloadStateFromPersistence(),
                testElementsTree.reloadStateFromPersistence()
            ]);
            this.logger.debug(`[TreeViewFactory] Successfully reloaded tree view state.`);
        } catch (error) {
            this.logger.error(`[TreeViewFactory] Error reloading tree view state:`, error);
        }
    }

    // View State Management Methods

    /**
     * Generates user-specific storage key
     * @param baseStorageKey The base key to use for storage
     * @returns The user-specific storage key or throws if no valid session
     */
    private getUserStorageKey(baseStorageKey: string): string {
        const key = userSessionManager.getUserStorageKey(baseStorageKey);
        if (!key) {
            throw new Error("No valid user session available for storage key generation");
        }
        return key;
    }

    /**
     * Validates saved context data for view restoration.
     * @param savedContext The saved context to validate
     * @returns True if the saved context is valid, false otherwise
     */
    private isValidSavedContext(savedContext: any): boolean {
        return !!(
            savedContext &&
            savedContext.projectName &&
            typeof savedContext.projectName === "string" &&
            savedContext.tovName &&
            typeof savedContext.tovName === "string"
        );
    }

    /**
     * Saves the UI context data to the workspace state for later restoration.
     * @param context The extension context
     * @param viewId The ID of the currently visible primary view
     * @param contextData The data required to restore the view (e.g., keys and names)
     */
    private async saveUIContext(
        context: vscode.ExtensionContext,
        viewId: "projects" | "testThemes" | "testElements",
        contextData?: any
    ): Promise<void> {
        const visibleViewsKey = this.getUserStorageKey(StorageKeys.VISIBLE_VIEWS_STORAGE_KEY);
        await context.workspaceState.update(visibleViewsKey, viewId);

        if (contextData) {
            const hasValidProjectName = contextData.projectName && typeof contextData.projectName === "string";
            const hasValidTovName = contextData.tovName && typeof contextData.tovName === "string";

            if (!hasValidProjectName || !hasValidTovName) {
                this.logger.warn(
                    `[TreeViewFactory] Cannot save UI context: invalid contextData. ` +
                        `projectName: ${contextData.projectName}, tovName: ${contextData.tovName}. ` +
                        `Clearing context state.`
                );
                const cycleContextKey = this.getUserStorageKey(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY);
                const tovContextKey = this.getUserStorageKey(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY);
                await context.workspaceState.update(cycleContextKey, undefined);
                await context.workspaceState.update(tovContextKey, undefined);
                return;
            }

            const cycleContextKey = this.getUserStorageKey(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY);
            const tovContextKey = this.getUserStorageKey(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY);

            if (contextData.isCycle) {
                await context.workspaceState.update(cycleContextKey, contextData);
                await context.workspaceState.update(tovContextKey, undefined);
            } else {
                await context.workspaceState.update(tovContextKey, contextData);
                await context.workspaceState.update(cycleContextKey, undefined);
            }
        }
    }

    /**
     * Clears all view state storage. This function is used to clear invalid view state
     * when restoration fails, not for logout scenarios where view state should be preserved.
     * @param context The extension context
     */
    private async clearViewState(context: vscode.ExtensionContext): Promise<void> {
        const visibleViewsKey = this.getUserStorageKey(StorageKeys.VISIBLE_VIEWS_STORAGE_KEY);
        const cycleContextKey = this.getUserStorageKey(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY);
        const tovContextKey = this.getUserStorageKey(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY);

        await context.workspaceState.update(visibleViewsKey, "projects");
        await context.workspaceState.update(cycleContextKey, undefined);
        await context.workspaceState.update(tovContextKey, undefined);
    }

    /**
     * Loads the default tree views where only projects tree view is visible.
     * @param treeViews The tree views object containing individual tree view instances
     */
    private async loadDefaultTreeViewsUI(treeViews: {
        projectsTree: ProjectsTreeView;
        testThemesTree: TestThemesTreeView;
        testElementsTree: TestElementsTreeView;
    }): Promise<void> {
        treeViews.projectsTree.refresh();
        await displayProjectManagementTreeView();
        await hideTestThemeTreeView();
        await hideTestElementsTreeView();
    }

    /**
     * Restores a previously saved view state.
     * Updates the language server, loads data into the tree views based on the saved context,
     * and adjusts the visibility of the tree views accordingly.
     * @param savedViewId The identifier of the view to restore
     * @param savedContext An object containing the saved view information (project, TOV, cycle data)
     * @param treeViews The tree views object containing individual tree view instances
     * @returns A promise that resolves to true if the view was successfully restored, false otherwise
     */
    private async performDeferredViewRestoration(
        savedViewId: string,
        savedContext: any,
        treeViews: {
            projectsTree: ProjectsTreeView;
            testThemesTree: TestThemesTreeView;
            testElementsTree: TestElementsTreeView;
        }
    ): Promise<boolean> {
        try {
            this.logger.debug(`[TreeViewFactory] Performing deferred view restoration for: ${savedViewId}`);
            treeViews.testThemesTree.stateManager.setLoading(true);
            treeViews.testElementsTree.stateManager.setLoading(true);
            await displayTestThemeTreeView();
            await displayTestElementsTreeView();
            await hideProjectManagementTreeView();

            if (savedContext.isCycle) {
                await treeViews.testThemesTree.loadCycle(
                    savedContext.projectKey,
                    savedContext.cycleKey,
                    savedContext.tovKey,
                    savedContext.projectName,
                    savedContext.tovName,
                    savedContext.cycleLabel
                );
            } else {
                await treeViews.testThemesTree.loadTov(
                    savedContext.projectKey,
                    savedContext.tovKey,
                    savedContext.projectName,
                    savedContext.tovName
                );
            }

            await treeViews.testElementsTree.loadTov(
                savedContext.tovKey,
                savedContext.tovName,
                savedContext.projectName,
                savedContext.tovName
            );

            this.logger.trace(
                `[TreeViewFactory] Successfully restored view to context of TOV: ${savedContext.tovName}`
            );
            return true;
        } catch (error) {
            this.logger.error("[TreeViewFactory] Failed to restore view state:", error);
            treeViews.testThemesTree.stateManager.setLoading(false);
            treeViews.testElementsTree.stateManager.setLoading(false);
            return false;
        }
    }

    /**
     * Refreshes tree views and attempts to restore previous view state and
     * initializes the language server if necessary.
     * @param context The extension context
     * @param treeViews The tree views object containing individual tree view instances
     */
    private async restoreTreeViewsState(
        context: vscode.ExtensionContext,
        treeViews: {
            projectsTree: ProjectsTreeView;
            testThemesTree: TestThemesTreeView;
            testElementsTree: TestElementsTreeView;
        }
    ): Promise<void> {
        this.logger.debug("[TreeViewFactory] Restoring tree views state");

        try {
            treeViews.projectsTree.clearTree();
            treeViews.testThemesTree.clearTree();
            treeViews.testElementsTree.clearTree();
            treeViews.projectsTree.refresh();

            const visibleViewsKey = this.getUserStorageKey(StorageKeys.VISIBLE_VIEWS_STORAGE_KEY);
            const cycleContextKey = this.getUserStorageKey(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY);
            const tovContextKey = this.getUserStorageKey(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY);

            let savedViewId = context.workspaceState.get<string>(visibleViewsKey);
            const savedCycleContext = context.workspaceState.get<any>(cycleContextKey);
            const savedTovContext = context.workspaceState.get<any>(tovContextKey);
            let savedContext = savedCycleContext || savedTovContext;

            let viewRestored = false;

            // Check if the project to be restored is still available to the current user
            if (savedContext && this.isValidSavedContext(savedContext)) {
                const connection = getConnection();
                if (connection) {
                    const availableProjects = await connection.getProjectsList();
                    const projectIsAvailable = availableProjects?.some((p) => p.name === savedContext.projectName);

                    if (!projectIsAvailable) {
                        this.logger.debug(
                            `[TreeViewFactory] Project '${savedContext.projectName}' from saved context is no longer available. ` +
                                `Skipping restoration.`
                        );
                        await this.clearViewState(context);
                        savedContext = null;
                        savedViewId = undefined;
                    } else {
                        this.logger.debug(
                            `[TreeViewFactory] Project '${savedContext.projectName}' from saved context is available. Proceeding with restoration.`
                        );
                    }
                }
            }

            if (savedViewId && savedViewId !== "projects" && savedContext) {
                if (!this.isValidSavedContext(savedContext)) {
                    this.logger.warn(
                        `[TreeViewFactory] Cannot restore view state: invalid context data. ` +
                            `projectName: ${savedContext.projectName}, tovName: ${savedContext.tovName}. ` +
                            `Clearing invalid state and loading default view.`
                    );
                    await this.clearViewState(context);
                } else {
                    try {
                        viewRestored = await this.performDeferredViewRestoration(savedViewId, savedContext, treeViews);
                    } catch (error) {
                        this.logger.error(`[TreeViewFactory] Failed to restore view state:`, error);
                        viewRestored = false;
                    }
                }
            }

            if (!viewRestored) {
                this.logger.trace(
                    "[TreeViewFactory] No saved state available to restore or restoration failed. Loading default view."
                );
                await this.loadDefaultTreeViewsUI(treeViews);
            }
        } catch (error) {
            this.logger.warn(`[TreeViewFactory] Error managing trees during session change:`, error);
            await this.loadDefaultTreeViewsUI(treeViews);
        }
    }

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        this.logger.debug("[TreeViewFactory] Disposing TreeViewFactory");

        for (const disposable of this.disposables) {
            try {
                disposable.dispose();
            } catch (error) {
                this.logger.error("[TreeViewFactory] Error disposing resource:", error);
            }
        }

        this.disposables = [];
    }
}

/**
 * Disposes the old treeViews variable and initializes all tree views fresh.
 */
export async function initializeTreeViews(context: vscode.ExtensionContext): Promise<void> {
    setExtensionContext(context);

    if (treeViews) {
        treeViews.dispose();
    }

    try {
        setTreeViews(createAllTreeViews(extensionContext, getConnection));

        if (!treeViews) {
            logger.error("[TreeViewFactory] Global tree views variable is null. Cannot initialize tree views.");
            return;
        }

        await treeViews.initialize();

        // Skip user-specific state loading during initialization, user session is not available yet.
        const showProjects = true;
        const showTestThemes = false;
        const showTestElements = false;

        await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_PROJECTS_TREE, showProjects);
        await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_THEMES_TREE, showTestThemes);
        await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_ELEMENTS_TREE, showTestElements);

        logger.trace("[TreeViewFactory] Tree views initialized successfully");
    } catch (error) {
        logger.error("[TreeViewFactory] Failed to initialize tree views:", error);
        throw error;
    }
}
