/**
 * @file src/treeViews/implementations/projects/ProjectsTreeView.ts
 * @description Tree view implementation for managing projects, versions, and cycles.
 */

import * as vscode from "vscode";
import { TreeViewBase } from "../../core/TreeViewBase";
import { ProjectData, ProjectsTreeItem } from "./ProjectsTreeItem";
import { TreeViewConfig } from "../../core/TreeViewConfig";
import { ProjectsDataProvider } from "./ProjectsDataProvider";
import { projectsConfig } from "./ProjectsConfig";
import { PlayServerConnection } from "../../../testBenchConnection";
import { allExtensionCommands, ConfigKeys, ProjectItemTypes, TreeViewTiming } from "../../../constants";
import { TreeNode } from "../../../testBenchTypes";
import { getExtensionConfiguration } from "../../../configuration";
import * as reportHandler from "../../../reportHandler";
import { updateOrRestartLS } from "../../../extension";
import { FilterService } from "../../utils/FilterService";

export class ProjectsTreeView extends TreeViewBase<ProjectsTreeItem> {
    private dataProvider: ProjectsDataProvider;
    private disposables: vscode.Disposable[] = [];
    private filterService: FilterService;

    constructor(
        extensionContext: vscode.ExtensionContext,
        private getConnection: () => PlayServerConnection | null,
        config?: Partial<TreeViewConfig>
    ) {
        // Merge with default config
        const fullConfig = { ...projectsConfig, ...config };
        super(extensionContext, fullConfig);

        this.dataProvider = new ProjectsDataProvider(this.logger, this.errorHandler, getConnection);
        this.filterService = FilterService.getInstance();
        this.registerCommands();
        this.registerEventHandlers();
    }

    /**
     * Registers all command handlers for the projects tree view
     */
    private registerCommands(): void {
        // Make root command
        this.disposables.push(
            vscode.commands.registerCommand(`${this.config.id}.makeRoot`, async (item: ProjectsTreeItem) =>
                this.makeRoot(item)
            )
        );

        // Reset custom root command
        this.disposables.push(
            vscode.commands.registerCommand(`${this.config.id}.resetCustomRoot`, async () => this.resetCustomRoot())
        );

        // Refresh command
        this.disposables.push(vscode.commands.registerCommand(`${this.config.id}.refresh`, () => this.refresh()));

        // Cycle double-click handler
        this.disposables.push(
            vscode.commands.registerCommand(allExtensionCommands.checkForCycleDoubleClick, (item: ProjectsTreeItem) =>
                this.handleCycleDoubleClick(item)
            )
        );
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
            }, TreeViewTiming.EVENT_DEBOUNCE_MS); // 500ms debounce
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
        try {
            const connection = this.getConnection();
            if (!connection) {
                this.logger.debug("No connection available for fetching projects");
                return [];
            }

            this.logger.debug("Starting to fetch projects");
            const fetchedProjects = await this.dataProvider.fetchProjects();
            this.logger.debug(`Fetched ${fetchedProjects.length} projects from data provider`);
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
                this.logger.debug("Filtering is active. Performing deep load of project hierarchy.");
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
                this.logger.debug("Deep load completed for filtering.");
            }

            this.logger.debug(`Created ${createdProjectTreeItems.length} tree items successfully`);
            return createdProjectTreeItems;
        } catch (error) {
            this.logger.error("Error in fetchRootItems:", error);
            if (error instanceof Error) {
                this.logger.error(`Error details - message: ${error.message}, stack: ${error.stack}`);
            }
            return [];
        }
    }

    /**
     * Retrieves child items for a given tree item.
     * Fetches versions for projects and cycles for versions, with handling for filtering scenarios.
     * @param item The parent tree item to get children for
     * @return Promise resolving to an array of child ProjectsTreeItem objects
     */
    protected async getChildrenForItem(item: ProjectsTreeItem): Promise<ProjectsTreeItem[]> {
        this.logger.debug(`Fetching children for ${item.label} (${item.data.type})`);

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
                this.logger.debug(
                    `Filtering active, loading all children for project ${item.label} to evaluate relationships`
                );

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
            this.logger.warn(`No project key found for version item ${versionItem.label}`);
            return [];
        }

        const fetchedProjectTree = await this.dataProvider.fetchProjectTree(projectKey);
        if (!fetchedProjectTree || !fetchedProjectTree.children) {
            this.logger.warn(`No project tree found for project ${projectKey}`);
            return [];
        }

        const versionNode = fetchedProjectTree.children.find(
            (node) => node.nodeType === "Version" && node.key === versionItem.data.key
        );

        if (!versionNode || !versionNode.children) {
            this.logger.warn(`No version node or children found for version ${versionItem.data.key}`);
            return [];
        }

        // Filter for Cycle nodes and map them to Tree Items
        const cycleItems = versionNode.children
            .filter((childNode) => childNode.nodeType === "Cycle")
            .map((cycleNode) => {
                const cycleData = this.dataProvider.transformTreeNode(cycleNode, "cycle", versionItem.data.key);
                return this.createTreeItem(cycleData, versionItem);
            });

        this.logger.debug(`Found ${cycleItems.length} cycles for version ${versionItem.label}`);
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
     * Handles item selection events in the projects tree view.
     * @param item The selected tree item
     */
    private async handleItemSelection(item: ProjectsTreeItem): Promise<void> {
        if (item.data.type === "version") {
            const tovKey = item.getVersionKey();
            const tovLabel = item.label as string;

            if (tovKey) {
                // Get project and version names for language server
                const projectName = item.parent?.label?.toString();
                const tovName = item.label?.toString();

                // Validate projectName and tovName before calling updateOrRestartLS
                if (!projectName || !tovName) {
                    const errorMessage = `Cannot update language server: invalid project or TOV name. Project: ${projectName}, TOV: ${tovName}`;
                    vscode.window.showErrorMessage(errorMessage);
                    this.logger.error(errorMessage);
                } else {
                    // Update or restart language server
                    await vscode.commands.executeCommand(allExtensionCommands.updateOrRestartLS, projectName, tovName);
                }

                this.eventBus.emit({
                    type: "version:selected",
                    source: this.config.id,
                    data: {
                        projectKey: item.getProjectKey(),
                        versionKey: tovKey,
                        versionLabel: tovLabel,
                        tovKey: tovKey,
                        tovLabel: tovLabel
                    },
                    timestamp: Date.now()
                });
            }
        } else if (item.data.type === "cycle") {
            // Handle cycle selection
            const cycleKey = item.getCycleKey();
            const projectKey = item.getProjectKey();
            const cycleLabel = item.label as string;

            if (cycleKey && projectKey) {
                // Get project and version names for language server
                const projectName = item.parent?.parent?.label?.toString();
                const tovName = item.parent?.label?.toString();

                // Validate projectName and tovName before calling updateOrRestartLS
                if (!projectName || !tovName) {
                    const errorMessage = `Cannot update language server: invalid project or TOV name. Project: ${projectName}, TOV: ${tovName}`;
                    vscode.window.showErrorMessage(errorMessage);
                    this.logger.error(errorMessage);
                } else {
                    // Update or restart language server
                    await vscode.commands.executeCommand(allExtensionCommands.updateOrRestartLS, projectName, tovName);
                }

                this.eventBus.emit({
                    type: "cycle:selected",
                    source: this.config.id,
                    data: {
                        projectKey,
                        cycleKey,
                        cycleLabel
                    },
                    timestamp: Date.now()
                });
            }
        }
    }

    /**
     * Handles project selection events.
     * @param projectKey The key of the selected project
     */
    private async handleProjectSelection(projectKey: string): Promise<void> {
        this.logger.info(`Project selected: ${projectKey}`);

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
     * Handles cycle double-click events.
     * @param item The cycle tree item that was double-clicked
     */
    private async handleCycleDoubleClick(item: ProjectsTreeItem): Promise<void> {
        if (item.originalContextValue !== "cycle") {
            return;
        }

        const cycleKey = item.getCycleKey();
        const projectKey = item.getProjectKey();

        const versionKey = item.getVersionKey();
        const tovKey = versionKey;

        if (!cycleKey || !projectKey) {
            this.logger.warn("Missing required keys for cycle selection");
            return;
        }

        const projectName = item.parent?.parent?.label?.toString();
        const tovName = item.parent?.label?.toString();

        // Validate projectName and tovName before calling updateOrRestartLS
        if (!projectName || !tovName) {
            const errorMessage = `Cannot update language server: invalid project or TOV name. Project: ${projectName}, TOV: ${tovName}`;
            vscode.window.showErrorMessage(errorMessage);
            this.logger.error(errorMessage);
        } else {
            // Update or restart language server
            await vscode.commands.executeCommand(allExtensionCommands.updateOrRestartLS, projectName, tovName);
        }

        // Emit events for other trees to load
        this.eventBus.emit({
            type: "cycle:activated",
            source: this.config.id,
            data: {
                cycleKey,
                projectKey,
                tovKey, // Can be null if cycle is not under a version
                cycleLabel: item.label as string
            },
            timestamp: Date.now()
        });

        vscode.window.showInformationMessage(`Loading test themes for cycle: ${item.label}`);
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
     * Fetches versions for a project item.
     * @param projectItem The project item to fetch versions for
     * @returns Promise that resolves to an array of version tree items
     */
    private async getVersionsForProject(projectItem: ProjectsTreeItem): Promise<ProjectsTreeItem[]> {
        try {
            const connection = this.getConnection();
            if (!connection) {
                this.logger.debug("No connection available, returning empty array");
                return [];
            }

            const projectKey = projectItem.data.key;
            const projectTree = await this.dataProvider.fetchProjectTree(projectKey);

            if (!projectTree || !projectTree.children) {
                this.logger.debug(`No versions found for project ${projectKey}`);
                return [];
            }

            const versions = projectTree.children
                .filter((child: TreeNode) => child.nodeType === ProjectItemTypes.VERSION)
                .map((versionNode: TreeNode) =>
                    this.createTreeItem(
                        {
                            key: versionNode.key,
                            name: versionNode.name,
                            description: "",
                            type: "version",
                            metadata: versionNode
                        },
                        projectItem
                    )
                )
                .filter((item) => !item.data.metadata?.error); // Filter out error items

            this.logger.debug(`Found ${versions.length} versions for project ${projectItem.label}`);
            return versions;
        } catch (error) {
            return this.errorHandler.handle(error as Error, `Failed to fetch versions for ${projectItem.label}`, []);
        }
    }

    /**
     * Fetches cycles for a version item.
     * @param versionItem The version item to fetch cycles for
     * @returns Promise that resolves to an array of cycle tree items
     */
    private async getCyclesForVersion(versionItem: ProjectsTreeItem): Promise<ProjectsTreeItem[]> {
        try {
            const connection = this.getConnection();
            if (!connection) {
                this.logger.debug("No connection available, returning empty array");
                return [];
            }

            const children = versionItem.data.metadata?.children;

            if (!children || !Array.isArray(children)) {
                this.logger.debug(`No cycles found for version ${versionItem.label}`);
                return [];
            }

            const cycles = children
                .filter((child: TreeNode) => child.nodeType === ProjectItemTypes.CYCLE)
                .map((cycleNode: TreeNode) =>
                    this.createTreeItem(
                        {
                            key: cycleNode.key,
                            name: cycleNode.name,
                            description: "",
                            type: "cycle",
                            metadata: cycleNode
                        },
                        versionItem
                    )
                )
                .filter((item) => !item.data.metadata?.error); // Filter out error items

            this.logger.debug(`Found ${cycles.length} cycles for version ${versionItem.label}`);
            return cycles;
        } catch (error) {
            return this.errorHandler.handle(error as Error, `Failed to fetch cycles for ${versionItem.label}`, []);
        }
    }

    /**
     * Handles cycle selection and updates state
     * @param cycleKey The key of the selected cycle
     * @param projectKey The key of the project containing the cycle
     */
    private async handleCycleSelection(cycleKey: string, projectKey: string): Promise<void> {
        this.logger.info(`Cycle selected: ${cycleKey} in project ${projectKey}`);

        this.stateManager.setState({
            selectedCycleKey: cycleKey,
            selectedProjectKey: projectKey
        });

        const cycleItem = this.findItemByKey(cycleKey, "cycle");
        const cycleLabel = (cycleItem?.label as string) || cycleKey;

        // Emit event for test themes tree
        this.eventBus.emit({
            type: "cycle:selected",
            source: this.config.id,
            data: {
                projectKey,
                cycleKey,
                cycleLabel
            },
            timestamp: Date.now()
        });
    }

    /**
     * Generates test cases for the selected cycle.
     * @param item The cycle item to generate test cases for
     */
    public async generateTestCasesForCycle(item: ProjectsTreeItem): Promise<void> {
        this.logger.debug(`Command Called: generateTestCasesForCycle for item ${item.label}`);
        const connection = this.getConnection();
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            this.logger.error(`generateTestCasesForCycle command called without connection.`);
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
        this.logger.debug(`Command Called: generateTestCasesForTOV for item ${item.label}`);
        const connection = this.getConnection();
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            this.logger.error(`generateTestCasesForTOV command called without connection.`);
            return;
        }

        if (getExtensionConfiguration().get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
            await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
        }

        try {
            const projectKey = item.getProjectKey();
            const tovKey = item.getVersionKey();
            const tovName = typeof item.label === "string" ? item.label : "Unknown TOV";
            const projectName = item.parent?.label?.toString();

            // Validate projectName and tovName before calling updateOrRestartLS
            if (!projectName || !tovName) {
                const errorMessage = `Cannot update language server: invalid project or TOV name. Project: ${projectName}, TOV: ${tovName}`;
                vscode.window.showErrorMessage(errorMessage);
                this.logger.error(errorMessage);
                return;
            }

            await updateOrRestartLS(projectName, tovName);

            if (!projectKey || !tovKey) {
                const errorMessage = "Could not determine project or TOV key for test generation.";
                vscode.window.showErrorMessage(errorMessage);
                this.logger.error(`${errorMessage} Project: ${projectKey}, TOV: ${tovKey}`);
                return;
            }

            this.logger.info(`Starting test generation for TOV: ${tovName} (${tovKey}) in project: ${projectKey}`);
            await reportHandler.startTestGenerationUsingTOV(this.extensionContext, item, projectKey, tovKey, false);
        } catch (error) {
            this.logger.error("[Cmd] Error in generateTestCasesForTOV:", error);
            vscode.window.showErrorMessage(
                `Error generating tests for TOV: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Finds a tree item by its key and optionally type.
     * @param key The key of the item to find
     * @param type Optional type filter for the item
     * @returns The found tree item or undefined if not found
     */
    private findItemByKey(key: string, type?: string): ProjectsTreeItem | undefined {
        // Search through all loaded items
        const searchItem = (items: ProjectsTreeItem[]): ProjectsTreeItem | undefined => {
            for (const item of items) {
                if (item.data.key === key && (!type || item.data.type === type)) {
                    return item;
                }
                // Search children recursively
                if (item.children.length > 0) {
                    const found = searchItem(item.children as ProjectsTreeItem[]);
                    if (found) {
                        return found;
                    }
                }
            }
            return undefined;
        };

        return searchItem(this.rootItems);
    }

    /**
     * Overrides the base refresh method to fetch data from the server
     *
     * @param item Optional specific item to refresh
     * @param options Optional refresh options
     */
    public override refresh(item?: ProjectsTreeItem, options?: { immediate?: boolean }): void {
        this.logger.debug(`Refreshing projects tree view${item ? ` for item: ${item.label}` : ""}`);

        if (item) {
            super.refresh(item, options);
            return;
        }

        super.refresh(undefined, options);
        this.logger.debug("Projects tree view refresh initiated - will fetch fresh data from server");
    }
}
