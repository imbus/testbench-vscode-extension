/**
 * @file src/treeViews/implementations/projects/ProjectsTreeView.ts
 * @description Tree view implementation for managing projects, versions, and cycles.
 */

import * as vscode from "vscode";
import { TreeViewBase } from "../../core/TreeViewBase";
import { TreeItemBase } from "../../core/TreeItemBase";
import { ProjectData, ProjectsTreeItem } from "./ProjectsTreeItem";
import { TreeViewConfig } from "../../core/TreeViewConfig";
import { ProjectsDataProvider } from "./ProjectsDataProvider";
import { projectsConfig } from "./ProjectsConfig";
import { PlayServerConnection } from "../../../testBenchConnection";
import { allExtensionCommands, ConfigKeys, ContextKeys, TreeViewTiming } from "../../../constants";
import { displayTestThemeTreeView } from "../testThemes/TestThemesTreeView";
import { displayTestElementsTreeView } from "../testElements/TestElementsTreeView";
import { getExtensionConfiguration } from "../../../configuration";
import * as reportHandler from "../../../reportHandler";
import { FilterService } from "../../utils/FilterService";
import { treeViews } from "../../../extension";
import { ClickHandler } from "../../core/ClickHandler";

export class ProjectsTreeView extends TreeViewBase<ProjectsTreeItem> {
    private dataProvider: ProjectsDataProvider;
    private disposables: vscode.Disposable[] = [];
    private cycleClickHandler: ClickHandler<ProjectsTreeItem>;
    private filterService: FilterService;

    constructor(
        extensionContext: vscode.ExtensionContext,
        private getConnection: () => PlayServerConnection | null,
        config?: Partial<TreeViewConfig>
    ) {
        // Merge with default config
        const fullConfig = { ...projectsConfig, ...config };
        super(extensionContext, fullConfig);

        this.dataProvider = new ProjectsDataProvider(this.logger, getConnection);
        this.filterService = FilterService.getInstance();
        this.cycleClickHandler = new ClickHandler<ProjectsTreeItem>();
        this.registerCommands();
        this.registerEventHandlers();
        this.setupCycleClickHandlers();
    }

    /**
     * Registers all command handlers for the projects tree view
     */
    private registerCommands(): void {
        this.disposables.push(
            vscode.commands.registerCommand(`${this.config.id}.makeRoot`, async (item: ProjectsTreeItem) =>
                this.makeRoot(item)
            )
        );

        this.disposables.push(
            vscode.commands.registerCommand(`${this.config.id}.resetCustomRoot`, async () => this.resetCustomRoot())
        );

        this.disposables.push(vscode.commands.registerCommand(`${this.config.id}.refresh`, () => this.refresh()));

        this.disposables.push(
            vscode.commands.registerCommand(
                allExtensionCommands.checkForCycleDoubleClick,
                async (item: ProjectsTreeItem) => {
                    if (item.id) {
                        await this.cycleClickHandler.handleClick(item, item.id, this.logger);
                    }
                }
            )
        );
    }

    /**
     * Sets up click handlers for cycle items using the generalized click handler
     */
    private setupCycleClickHandlers(): void {
        this.cycleClickHandler.updateHandlers({
            onSingleClick: async (item: ProjectsTreeItem) => {
                if (item.data.type === "cycle") {
                    await this.handleCycleSingleClick(item);
                }
            },
            onDoubleClick: async (item: ProjectsTreeItem) => {
                if (item.data.type === "cycle") {
                    await this.handleCycleDoubleClick(item);
                }
            }
        });
    }

    /**
     * Registers event handlers for the projects tree view.
     * Sets up listeners for project selection, data updates, and custom root events with debouncing
     */
    private registerEventHandlers(): void {
        // Listen for project selection events
        this.eventBus.on("project:selected", async (event) => {
            const { projectKey } = event.data;
            await this.handleProjectSelection(projectKey);
        });

        // Listen for data updates with debounce
        let refreshTimeout: NodeJS.Timeout | undefined;
        this.eventBus.on("data:projectsUpdated", async () => {
            if (refreshTimeout) {
                clearTimeout(refreshTimeout);
            }
            refreshTimeout = setTimeout(async () => {
                this.refresh();
                refreshTimeout = undefined;
            }, TreeViewTiming.EVENT_DEBOUNCE_MS);
        });

        // Listen for expand/collapse events
        this.eventBus.on("tree:itemExpanded", async (event) => {
            const item = event.data.item;
            if (item instanceof ProjectsTreeItem && item.data.type === "version") {
                await vscode.commands.executeCommand(allExtensionCommands.handleTOVClick, item);
            }
        });

        this.eventBus.on("tree:itemCollapsed", async (event) => {
            const item = event.data.item;
            if (item instanceof ProjectsTreeItem && item.data.type === "version") {
                await vscode.commands.executeCommand(allExtensionCommands.handleTOVClick, item);
            }
        });
    }

    /**
     * Handles project selection events from external sources
     * @param event The event containing project selection data
     */
    public async handleProjectSelectionEvent(event: { data: { projectKey: string } }): Promise<void> {
        await this.handleProjectSelection(event.data.projectKey);
    }

    /**
     * Handles data update events with debouncing
     */
    public async handleDataUpdateEvent(): Promise<void> {
        // This method is called by tests to simulate data update events
        // The actual debouncing logic is in registerEventHandlers
        await this.refresh();
    }

    /**
     * Fetches and creates root tree items for the projects view
     * Retrieves projects from the data provider and creates tree items, with optional deep loading for filtering
     * @return Promise resolving to an array of ProjectsTreeItem objects
     */
    protected async fetchRootItems(): Promise<ProjectsTreeItem[]> {
        const fetchedProjects = await this.dataProvider.fetchAndTransformProjects();
        if (!fetchedProjects || fetchedProjects.length === 0) {
            return [];
        }

        const createdProjectTreeItems = fetchedProjects.map((project) =>
            this.createTreeItem({
                key: project.key,
                name: project.name,
                description: project.description || "",
                type: "project",
                metadata: project.metadata
            })
        );

        // If filtering is active, we must load the entire hierarchy upfront
        // so that the filter logic can inspect children of non-matching parents.
        const filteringModule = this.getModule("filtering");
        const isFilteringActive = filteringModule?.isActive() || false;

        if (isFilteringActive) {
            await Promise.all(
                createdProjectTreeItems.map(async (projectItem) => {
                    // Fetch versions for the project
                    const versionItems = await this.getChildrenForItem(projectItem);
                    projectItem.children = versionItems;

                    // Fetch cycles for each version
                    await Promise.all(
                        versionItems.map(async (versionItem) => {
                            const cycleItems = await this.getChildrenForItem(versionItem);
                            versionItem.children = cycleItems;
                        })
                    );
                })
            );
        }

        return createdProjectTreeItems;
    }

    /**
     * Retrieves child items for a given tree item.
     * Fetches versions for projects and cycles for versions, with handling for filtering scenarios.
     * @param item The parent tree item to get children for
     * @return Promise resolving to an array of child ProjectsTreeItem objects
     */
    protected async getChildrenForItem(item: ProjectsTreeItem): Promise<ProjectsTreeItem[]> {
        const filteringModule = this.getModule("filtering");
        const isFilteringActive = filteringModule?.isActive() || false;

        // Projects have Versions as children
        if (item.data.type === "project") {
            const projectKey = item.data.key;
            const projectTree = await this.dataProvider.fetchProjectTree(projectKey);
            if (!projectTree || !projectTree.children) {
                return [];
            }

            // Filter for 'Version' nodes and map them to Tree Items
            const versionItems = projectTree.children
                .filter((childNode) => childNode.nodeType === "Version")
                .map((versionNode) => {
                    const versionData = this.dataProvider.transformTreeNode(versionNode, "version", projectKey);
                    return this.createTreeItem(versionData, item);
                });

            // If filtering is active, we need to load all children to properly evaluate parent/child relationships
            if (isFilteringActive && filteringModule) {
                // For each version, load its cycles for proper filtering
                for (const versionItem of versionItems) {
                    const cycles = await this.loadCyclesForVersion(versionItem);
                    versionItem.children = cycles;
                }
            }

            return versionItems;
        }

        // Versions have Cycles as children
        if (item.data.type === "version") {
            const cycles = await this.loadCyclesForVersion(item);
            return cycles;
        }

        // Cycles and other types have no children in this view
        return [];
    }

    /**
     * Loads cycles for a test object version item
     * @param versionItem The version item to load cycles for
     * @returns Promise that resolves to an array of cycle tree items
     */
    private async loadCyclesForVersion(versionItem: ProjectsTreeItem): Promise<ProjectsTreeItem[]> {
        const projectKey = versionItem.getProjectKey();
        if (!projectKey) {
            this.logger.warn(
                `[ProjectsTreeView] No project key found for version item ${versionItem.label} when loading cycles`
            );
            return [];
        }

        const fetchedProjectTree = await this.dataProvider.fetchProjectTree(projectKey);
        if (!fetchedProjectTree || !fetchedProjectTree.children) {
            this.logger.warn(`[ProjectsTreeView] No project tree found for project ${projectKey} when loading cycles`);
            return [];
        }

        const versionNode = fetchedProjectTree.children.find(
            (node) => node.nodeType === "Version" && node.key === versionItem.data.key
        );

        if (!versionNode || !versionNode.children) {
            this.logger.warn(
                `[ProjectsTreeView] No version node or children found for version ${versionItem.data.key} when loading cycles`
            );
            return [];
        }

        // Filter for Cycle nodes and map them to Tree Items
        const cycleItems = versionNode.children
            .filter((childNode) => childNode.nodeType === "Cycle")
            .map((cycleNode) => {
                const cycleData = this.dataProvider.transformTreeNode(cycleNode, "cycle", versionItem.data.key);
                return this.createTreeItem(cycleData, versionItem);
            });
        return cycleItems;
    }

    /**
     * Applies modules to a projects tree item
     * @param item The tree item to apply modules to
     */
    private applyModulesToProjectsItem(item: ProjectsTreeItem): void {
        const iconModule = this.getModule("icons");
        if (iconModule) {
            iconModule.setItemIcon(item);
        }
    }

    /**
     * Handles project selection events.
     * @param projectKey The key of the selected project
     */
    private async handleProjectSelection(projectKey: string): Promise<void> {
        this.logger.trace(`[ProjectsTreeView] Project selected: ${projectKey}`);

        this.stateManager.setState({
            selectedProjectKey: projectKey
        });

        // Emit event for other components
        this.eventBus.emit({
            type: "tree:projectSelected",
            source: this.config.id,
            data: { projectKey },
            timestamp: Date.now()
        });
    }

    /**
     * Handles cycle single click events.
     * @param item The cycle tree item that was single clicked
     */
    private async handleCycleSingleClick(item: ProjectsTreeItem): Promise<void> {
        if (item.originalContextValue !== "cycle") {
            return;
        }

        const cycleKey = item.getCycleKey();
        const projectKey = item.getProjectKey();
        const versionKey = item.getVersionKey();
        const projectName = item.parent?.parent?.label?.toString();
        const tovName = item.parent?.label?.toString();

        if (projectKey && cycleKey && versionKey && projectName && tovName) {
            this.logger.debug(`[ProjectsTreeView] Cycle item single clicked: ${item.label}`);

            await vscode.commands.executeCommand(allExtensionCommands.updateOrRestartLS, projectName, tovName);

            if (treeViews?.testThemesTree) {
                await treeViews.testThemesTree.loadCycle(
                    projectKey,
                    cycleKey,
                    projectName,
                    tovName,
                    item.label?.toString()
                );
            }
            if (treeViews?.testElementsTree) {
                await treeViews.testElementsTree.loadTov(versionKey, tovName, projectName, tovName);
            }
        } else {
            throw new Error("Invalid cycle item: missing project, cycle, or version key");
        }
    }

    /**
     * Handles cycle double click events.
     * @param item The cycle tree item that was double clicked
     */
    private async handleCycleDoubleClick(item: ProjectsTreeItem): Promise<void> {
        if (item.originalContextValue !== "cycle") {
            return;
        }

        const cycleKey = item.getCycleKey();
        const projectKey = item.getProjectKey();
        const versionKey = item.getVersionKey();
        const projectName = item.parent?.parent?.label?.toString();
        const tovName = item.parent?.label?.toString();

        if (!cycleKey || !projectKey) {
            this.logger.warn(
                "[ProjectsTreeView] Missing cycle and project keys for cycle selection when handling cycle double click"
            );
            return;
        }

        if (!projectName || !tovName) {
            const missingProjectAndTovNameErrorMessage = `[ProjectsTreeView] Cannot update language server: Missing project / TOV name. Project: ${projectName}, TOV: ${tovName}`;
            const missingProjectAndTovNameErrorMessageForUser = `Cannot update language server: Missing project / TOV name.`;
            this.logger.error(missingProjectAndTovNameErrorMessage);
            vscode.window.showErrorMessage(missingProjectAndTovNameErrorMessageForUser);
        } else {
            await vscode.commands.executeCommand(allExtensionCommands.updateOrRestartLS, projectName, tovName);
        }

        await displayTestThemeTreeView();
        await displayTestElementsTreeView();
        await hideProjectManagementTreeView();

        // Emit events for other trees to load
        this.eventBus.emit({
            type: "cycle:activated",
            source: this.config.id,
            data: {
                cycleKey,
                projectKey,
                tovKey: versionKey,
                cycleLabel: item.label as string
            },
            timestamp: Date.now()
        });
    }

    /**
     * Handles cycle clicks from external commands
     * @param item The cycle item that was clicked
     */
    public async handleCycleClick(item: ProjectsTreeItem): Promise<void> {
        if (item.id) {
            await this.cycleClickHandler.handleClick(item, item.id, this.logger);
        }
    }

    /**
     * Selects a project in the tree view
     * @param projectKey The key of the project to select
     */
    public async selectProject(projectKey: string): Promise<void> {
        const projects = await this.getRootItems();
        const project = projects.find((p) => p.data.key === projectKey);

        if (project && this.vscTreeView) {
            await this.vscTreeView.reveal(project, {
                select: true,
                focus: true,
                expand: true
            });
        }
    }

    /**
     * Selects a cycle in the tree view by expanding the project and version hierarchy
     * @param projectKey The key of the project containing the cycle
     * @param cycleKey The key of the cycle to select
     */
    public async selectCycle(projectKey: string, cycleKey: string): Promise<void> {
        // Find and expand the project
        const projects = await this.getRootItems();
        const project = projects.find((p) => p.data.key === projectKey);

        if (!project || !this.vscTreeView) {
            return;
        }

        // Expand project to load versions
        await this.vscTreeView.reveal(project, { expand: true });

        // Find the cycle in the project's descendants
        const versions = await this.getChildrenForItem(project);
        for (const version of versions) {
            await this.vscTreeView.reveal(version, { expand: true });

            const cycles = await this.getChildrenForItem(version);
            const cycle = cycles.find((c) => c.data.key === cycleKey);

            if (cycle) {
                await this.vscTreeView.reveal(cycle, {
                    select: true,
                    focus: true
                });
                break;
            }
        }
    }

    /**
     * Extracts project and TOV names by traversing up the tree hierarchy
     * @param item The tree item to start from
     * @returns Object containing project name and TOV name (if found)
     */
    public getProjectAndTovNames(item: ProjectsTreeItem): { projectName: string; tovName: string | null } {
        let projectName = "";
        let tovName: string | null = null;

        let currentItem: ProjectsTreeItem | null = item;
        // Navigate up the tree to find project and TOV
        while (currentItem) {
            if (currentItem.originalContextValue === "project") {
                projectName = currentItem.label as string;
            } else if (currentItem.originalContextValue === "version") {
                tovName = currentItem.label as string;
            }
            currentItem = currentItem.parent as ProjectsTreeItem;
        }

        return { projectName, tovName };
    }

    /**
     * Gets the VS Code tree view instance
     * @returns The tree view instance or undefined if not available
     */
    public getTreeView(): vscode.TreeView<ProjectsTreeItem> | undefined {
        return this.vscTreeView;
    }

    /**
     * Gets the tree data provider for project management
     * @returns The tree data provider instance
     */
    public getProjectManagementProvider(): vscode.TreeDataProvider<ProjectsTreeItem> {
        return this;
    }

    /**
     * Disposes of all registered commands and event listeners
     */
    public override async dispose(): Promise<void> {
        // Dispose all registered commands and event listeners
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];

        await super.dispose();
    }

    /**
     * Creates a new tree item with applied modules.
     * @param data The project data for the tree item
     * @param parent The parent tree item (optional)
     * @returns The created tree item
     */
    protected createTreeItem(data: ProjectData, parent?: ProjectsTreeItem): ProjectsTreeItem {
        const treeItem = new ProjectsTreeItem(data, this.extensionContext, parent);
        treeItem.updateId();
        this.applyModulesToProjectsItem(treeItem);
        return treeItem;
    }

    /**
     * Determines if children should be loaded for an item during expansion restoration.
     * @param item The tree item to check
     * @returns True if children should be loaded for this item
     */
    protected shouldLoadChildrenForExpansion(item: TreeItemBase): boolean {
        const projectsItem = item as ProjectsTreeItem;

        // For version items, load children (cycles) if they haven't been loaded yet
        if (projectsItem.data?.type === "version") {
            return !projectsItem.children || projectsItem.children.length === 0;
        }

        // For project items, load children (versions) if they haven't been loaded yet
        if (projectsItem.data?.type === "project") {
            return !projectsItem.children || projectsItem.children.length === 0;
        }

        // Cycles don't have children in projects tree view
        return false;
    }

    /**
     * Generates test cases for the selected cycle.
     * @param item The cycle item to generate test cases for
     */
    public async generateTestCasesForCycle(item: ProjectsTreeItem): Promise<void> {
        const connection = this.getConnection();
        if (!connection) {
            vscode.window.showErrorMessage(`No connection available. Please log in first.`);
            this.logger.error(
                `[ProjectsTreeView] No connection available. Cannot generate test cases for cycle ${item.label}`
            );
            return;
        }

        if (getExtensionConfiguration().get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
            await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
        }

        await reportHandler.startTestGenerationForCycle(this.extensionContext, item);
    }

    /**
     * Generates test cases for a Test Object Version (TOV).
     * @param item The TOV item to generate test cases for
     * @returns Promise that resolves when test generation is complete
     */
    public async generateTestCasesForTOV(item: ProjectsTreeItem): Promise<void> {
        const connection = this.getConnection();
        if (!connection) {
            vscode.window.showErrorMessage(`No connection available. Please log in first.`);
            this.logger.error(
                `[ProjectsTreeView] No connection available. Cannot generate test cases for TOV ${item.label}`
            );
            return;
        }

        if (getExtensionConfiguration().get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
            await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
        }

        try {
            const projectKey = item.getProjectKey();
            const tovKey = item.getVersionKey();

            if (!projectKey || !tovKey) {
                const missingProjectAndTovKeyErrorMessage = `[ProjectsTreeView] Could not determine project or TOV key for test generation. Project: ${projectKey}, TOV: ${tovKey}`;
                const missingProjectAndTovKeyErrorMessageForUser = `Could not determine project or TOV key for test generation.`;
                vscode.window.showErrorMessage(missingProjectAndTovKeyErrorMessageForUser);
                this.logger.error(missingProjectAndTovKeyErrorMessage);
                return;
            }

            await reportHandler.startTestGenerationUsingTOV(this.extensionContext, item, projectKey, tovKey, false);
        } catch (error) {
            this.logger.error(
                `[ProjectsTreeView] Error in generateTestCasesForTOV: ${error instanceof Error ? error.message : String(error)}`
            );
            vscode.window.showErrorMessage(
                `Error generating tests for TOV: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Overrides the base refresh method to fetch data from the server
     *
     * @param item Optional specific item to refresh
     * @param options Optional refresh options
     */
    public override refresh(item?: ProjectsTreeItem, options?: { immediate?: boolean }): void {
        this.logger.debug(`[ProjectsTreeView] Refreshing projects tree view${item ? ` for item: ${item.label}` : ""}`);

        if (item) {
            super.refresh(item, options);
            return;
        }

        super.refresh(undefined, options);
    }
}

export async function hideProjectManagementTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    vscode.commands.executeCommand("setContext", ContextKeys.SHOW_PROJECTS_TREE, false);
}

export async function displayProjectManagementTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_PROJECTS_TREE, true);
    const filterService = FilterService.getInstance();
    filterService.setActiveTreeViewByContext(treeViews, ContextKeys.SHOW_PROJECTS_TREE);
}
