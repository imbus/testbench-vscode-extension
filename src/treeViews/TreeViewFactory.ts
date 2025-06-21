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
import { allExtensionCommands } from "../constants";
import { TestBenchLogger } from "../testBenchLogger";

export interface TreeViews {
    projectsTree: ProjectsTreeView;
    testThemesTree: TestThemesTreeView;
    testElementsTree: TestElementsTreeView;
    initialize: () => Promise<void>;
    dispose: () => void;
    refresh: () => void;
    clear: () => void;
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
        this.logger.info("Creating all tree views");

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
                this.disposables.forEach(d => d.dispose());
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
        this.logger.debug("Creating Projects tree view");

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
        this.logger.debug("Creating Test Themes tree view");

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
        this.logger.debug("Creating Test Elements tree view");

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
            this.logger.trace(`${treeType} tree visibility changed: ${e.visible}`);

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
                this.logger.trace(`${treeType} tree item selected:`, item.label);

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
            this.logger.trace(`${treeType} tree item expanded:`, e.element.label);

            treeView.eventBus.emit({
                type: "tree:itemExpanded",
                source: treeView.config.id,
                data: { item: e.element },
                timestamp: Date.now()
            });
        });

        const collapseDisposable = vscTreeView.onDidCollapseElement((e) => {
            this.logger.trace(`${treeType} tree item collapsed:`, e.element.label);

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
                treeView.eventBus.emit({
                    type: "cycle:selected",
                    source: treeView.config.id,
                    data: {
                        projectKey: item.getProjectKey(),
                        cycleKey: item.data.key,
                        cycleLabel: item.label
                    },
                    timestamp: Date.now()
                });
            } else if (item.data?.type === "version") {
                treeView.eventBus.emit({
                    type: "version:selected",
                    source: treeView.config.id,
                    data: {
                        projectKey: item.getProjectKey(),
                        versionKey: item.data.key,
                        versionLabel: item.label,
                        tovKey: item.data.key,
                        tovLabel: item.label
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
        this.logger.debug("Setting up inter-tree communication");

        // Projects to Test Themes: When cycle is selected
        const cycleSelectionDisposable = projectsTree.eventBus.on("cycle:selected", async (event) => {
            const { projectKey, cycleKey, cycleLabel } = event.data;
            this.logger.debug(`Cycle selected: ${cycleLabel} (${cycleKey})`);

            await testThemesTree.loadCycle(projectKey, cycleKey, cycleLabel);
        });

        // Projects to Test Elements: When version is selected
        const versionSelectionDisposable = projectsTree.eventBus.on("version:selected", async (event) => {
            const { tovKey, tovLabel } = event.data;
            this.logger.debug(`Version selected: ${tovLabel} (${tovKey})`);

            await testElementsTree.loadTov(tovKey, tovLabel);
        });

        // Test Themes to Projects: When test generation completes
        const testGenerationDisposable = testThemesTree.eventBus.on("testGeneration:completed", () => {
            this.logger.debug("Test generation completed, refreshing projects tree");
            projectsTree.refresh();
        });

        // Marking synchronization
        const markingDisposable = testThemesTree.eventBus.on("marking:added", () => {
            this.logger.debug("Item marked in test themes, updating projects tree");
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
        this.logger.debug("Registering global tree commands");

        // Refresh all trees
        const refreshAllCmd = vscode.commands.registerCommand(allExtensionCommands.refreshAllTrees, async () => {
            this.logger.info("Refreshing all trees");

            const startTime = Date.now();
            await Promise.all([projectsTree.refresh(), testThemesTree.refresh(), testElementsTree.refresh()]);

            const duration = Date.now() - startTime;
            this.logger.info(`All trees refreshed in ${duration}ms`);

            vscode.window.showInformationMessage("All trees refreshed");
        });

        // Clear all custom roots
        const clearRootsCmd = vscode.commands.registerCommand(allExtensionCommands.clearAllCustomRoots, () => {
            this.logger.info("Clearing all custom roots");

            projectsTree.resetCustomRoot();
            testThemesTree.resetCustomRoot();
            // TestElementsTreeView doesnt support custom roots

            vscode.window.showInformationMessage("All custom roots cleared");
        });

        // Clear all marks
        const clearMarksCmd = vscode.commands.registerCommand(allExtensionCommands.clearAllMarks, () => {
            this.logger.info("Clearing all marks");

            const markingModule = testThemesTree.getModule("marking");
            if (markingModule) {
                markingModule.clearAllMarks();
                vscode.window.showInformationMessage("All marks cleared");
            } else {
                vscode.window.showWarningMessage("Marking module not available");
            }
        });

        // Store disposables
        context.subscriptions.push(refreshAllCmd, clearRootsCmd, clearMarksCmd);
        this.disposables.push(refreshAllCmd, clearRootsCmd, clearMarksCmd);
    }

    /**
     * Dispose of all resources
     */
    public dispose(): void {
        this.logger.debug("Disposing TreeViewFactory");

        for (const disposable of this.disposables) {
            try {
                disposable.dispose();
            } catch (error) {
                this.logger.error("Error disposing resource:", error);
            }
        }

        this.disposables = [];
    }
}
