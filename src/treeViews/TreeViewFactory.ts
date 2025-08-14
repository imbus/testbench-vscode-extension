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

export interface TreeViews {
    projectsTree: ProjectsTreeView;
    testThemesTree: TestThemesTreeView;
    testElementsTree: TestElementsTreeView;
    initialize: () => Promise<void>;
    dispose: () => void;
    refresh: () => void;
    clear: () => void;
    saveCurrentState: () => Promise<void>;
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
        this.logger.debug("[TreeViewFactory] Creating all tree views");

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
        this.logger.debug("[TreeViewFactory] Creating Projects tree view");

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
        this.logger.debug("[TreeViewFactory] Creating Test Themes tree view");

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
        this.logger.debug("[TreeViewFactory] Creating Test Elements tree view");

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
            if (item.data?.type === "cycle") {
                const projectName = item.parent?.parent?.label?.toString();
                const tovName = item.parent?.label?.toString();
                treeView.eventBus.emit({
                    type: "cycle:selected",
                    source: treeView.config.id,
                    data: {
                        projectKey: item.getProjectKey(),
                        cycleKey: item.data.key,
                        cycleLabel: item.label,
                        projectName: projectName,
                        tovName: tovName
                    },
                    timestamp: Date.now()
                });
            } else if (item.data?.type === "version") {
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
        this.logger.debug("[TreeViewFactory] Setting up inter-tree communication");

        // Projects to Test Themes: When cycle is selected
        const cycleSelectionDisposable = projectsTree.eventBus.on("cycle:selected", async (event) => {
            const { projectKey, cycleKey, cycleLabel, projectName, tovName } = event.data;
            this.logger.debug(`[TreeViewFactory] Cycle selected: ${cycleLabel} (${cycleKey})`);

            if (projectName && tovName) {
                await testThemesTree.loadCycle(projectKey, cycleKey, projectName, tovName, cycleLabel);
            } else {
                this.logger.error("[TreeViewFactory] Missing project or TOV name for cycle selection event.");
            }
        });

        // Projects to Test Elements: When version is selected
        const versionSelectionDisposable = projectsTree.eventBus.on("version:selected", async (event) => {
            const { tovKey, tovLabel, projectName, tovName } = event.data;
            this.logger.debug(`[TreeViewFactory] Version selected: ${tovLabel} (${tovKey})`);

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
        this.logger.debug("[TreeViewFactory] Registering global tree commands");

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

        // Check for saved view state before setting default visibility (user scoped)
        const userId = userSessionManager.getCurrentUserId();
        const savedViewId = context.workspaceState.get<string>(`${userId}.${StorageKeys.VISIBLE_VIEWS_STORAGE_KEY}`);
        const savedCycleContext = context.workspaceState.get<any>(
            `${userId}.${StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY}`
        );
        const savedTovContext = context.workspaceState.get<any>(`${userId}.${StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY}`);
        const savedContext = savedCycleContext || savedTovContext;

        // Determine initial visibility based on saved state
        let showProjects = true;
        let showTestThemes = false;
        let showTestElements = false;

        if (savedViewId && savedViewId !== "projects" && savedContext) {
            const hasValidProjectName = savedContext.projectName && typeof savedContext.projectName === "string";
            const hasValidTovName = savedContext.tovName && typeof savedContext.tovName === "string";

            if (hasValidProjectName && hasValidTovName) {
                showProjects = false;
                showTestThemes = savedViewId === "testThemes" || savedViewId === "testElements";
                showTestElements = savedViewId === "testElements";
            }
        }

        await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_PROJECTS_TREE, showProjects);
        await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_THEMES_TREE, showTestThemes);
        await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_ELEMENTS_TREE, showTestElements);

        logger.trace("[TreeViewFactory] Tree views initialized successfully");
    } catch (error) {
        logger.error("[TreeViewFactory] Failed to initialize tree views:", error);
        throw error;
    }
}
