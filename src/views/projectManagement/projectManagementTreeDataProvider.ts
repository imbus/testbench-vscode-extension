/**
 * @file src/views/projectManagement/projectManagementTreeDataProvider.ts
 * @description Project management tree data provider
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeDataProvider, TreeDataProviderOptions } from "../common/baseTreeDataProvider";
import { ProjectManagementTreeItem } from "./projectManagementTreeItem";
import { ProjectDataService } from "../../services/projectDataService";
import { ContextKeys, TreeItemContextValues } from "../../constants";
import { Project, TreeNode, CycleStructure } from "../../testBenchTypes";
import { IconManagementService } from "../../services/iconManagementService";
import { TreeViewType, TreeViewEmptyState, TreeViewOperationalState } from "../../services/treeViewStateTypes";
import { CancellableOperationManager } from "../../services/cancellableOperationService";
import { StateChangeNotification } from "../../services/unifiedTreeStateManager";

export interface CycleDataForThemeTreeEvent {
    projectKey: string;
    cycleKey: string;
    cycleLabel: string;
    rawCycleStructure: CycleStructure | null;
}

export class ProjectManagementTreeDataProvider extends BaseTreeDataProvider<ProjectManagementTreeItem> {
    private _onDidPrepareCycleDataForThemeTree = new vscode.EventEmitter<CycleDataForThemeTreeEvent>();
    public readonly onDidPrepareCycleDataForThemeTree: vscode.Event<CycleDataForThemeTreeEvent> =
        this._onDidPrepareCycleDataForThemeTree.event;

    private readonly operationManager: CancellableOperationManager;

    // Operation IDs for different async operations
    private static readonly FETCH_PROJECTS_OPERATION = "fetchProjects";
    private static readonly FETCH_PROJECT_TREE_OPERATION = "fetchProjectTree";
    private static readonly HANDLE_CYCLE_CLICK_OPERATION = "handleCycleClick";

    constructor(
        extensionContext: vscode.ExtensionContext,
        logger: TestBenchLogger,
        private readonly iconService: IconManagementService,
        updateMessageCallback: (message: string | undefined) => void,
        private readonly projectDataService: ProjectDataService
    ) {
        const providerOptions: TreeDataProviderOptions = {
            contextKey: ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT,
            customRootContextValue: TreeItemContextValues.CUSTOM_ROOT_PROJECT,
            enableCustomRoot: true,
            enableExpansionTracking: true,
            stateConfig: {
                treeViewId: "projectManagementTree",
                treeViewType: TreeViewType.PROJECT_MANAGEMENT,
                noDataSourceMessage: "Not connected to TestBench or no projects available.",
                loadingMessageTemplate: "Loading projects..."
            }
        };
        super(extensionContext, logger, updateMessageCallback, providerOptions);
        this.operationManager = new CancellableOperationManager(logger);
        this.logger.trace("[ProjectManagementTreeDataProvider] Initialized with unified state management");
    }

    /**
     * Handle unified state changes for better coordination
     */
    protected override onUnifiedStateChange(notification: StateChangeNotification): void {
        super.onUnifiedStateChange(notification);

        if (notification.changedFields.includes("operationalState")) {
            this.logger.trace(
                `[ProjectManagementTreeDataProvider] Operational state changed to: ${notification.newState.operationalState}`
            );
        }
    }

    /**
     * Fetches and returns the root-level project tree items for the tree view.
     * Uses unified state management for coordinated state updates.
     */
    protected async fetchRootTreeItems(): Promise<ProjectManagementTreeItem[]> {
        this.operationManager.cancelOperation(ProjectManagementTreeDataProvider.FETCH_PROJECTS_OPERATION);

        const operation = this.operationManager.createOperation(
            ProjectManagementTreeDataProvider.FETCH_PROJECTS_OPERATION,
            "Fetch projects list"
        );

        try {
            this.logger.debug("[ProjectManagementTreeDataProvider] Fetching root projects");
            this.getUnifiedStateManager().setLoading("Loading projects...");

            operation.throwIfCancelled("before projects fetch");

            const projectList: Project[] | null = await this.projectDataService.getProjectsList();

            operation.throwIfCancelled("after projects fetch");

            if (projectList === null) {
                this.getUnifiedStateManager().setError(
                    new Error("Failed to fetch projects"),
                    TreeViewEmptyState.FETCH_ERROR
                );
                return [];
            }

            // Single coordinated state update for successful fetch
            this.getUnifiedStateManager().updateState({
                hasDataFetchBeenAttempted: true,
                isServerDataReceived: true,
                itemsBeforeFiltering: projectList.length,
                itemsAfterFiltering: projectList.length,
                operationalState:
                    projectList.length === 0 ? TreeViewOperationalState.EMPTY : TreeViewOperationalState.READY,
                emptyState: projectList.length === 0 ? TreeViewEmptyState.SERVER_NO_DATA : undefined
            });

            const projectItems = projectList
                .map((project) => this.createTestThemeTreeItemFromData(project, null))
                .filter((item): item is ProjectManagementTreeItem => item !== null);

            return projectItems;
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                this.logger.debug("[ProjectManagementTreeDataProvider] Projects fetch cancelled");
                return [];
            }

            this.logger.error("[ProjectManagementTreeDataProvider] Error fetching projects:", error);
            this.getUnifiedStateManager().setError(error as Error, TreeViewEmptyState.FETCH_ERROR);
            return [];
        }
    }

    /**
     * Fetches child tree items for a given tree item based on its context type.
     */
    protected async fetchChildrenForTreeItem(
        projectsTreeItem: ProjectManagementTreeItem
    ): Promise<ProjectManagementTreeItem[]> {
        this.logger.debug(`[ProjectManagementTreeDataProvider] Fetching children for: ${projectsTreeItem.label}`);
        const itemContext = projectsTreeItem.originalContextValue;

        switch (itemContext) {
            case TreeItemContextValues.PROJECT:
                return this.getChildrenForProject(projectsTreeItem);
            case TreeItemContextValues.VERSION:
                return this.getChildrenForVersion(projectsTreeItem);
            case TreeItemContextValues.CYCLE:
                return []; // Cycles don't show direct children in this tree
            default:
                this.logger.warn(
                    `[ProjectManagementTreeDataProvider] Unknown tree item type for fetching children: ${itemContext}`
                );
                return [];
        }
    }

    /**
     * Creates a ProjectManagementTreeItem from raw data with validation and state management.
     */
    protected createTestThemeTreeItemFromData(
        data: any, // Project or TreeNode
        parent: ProjectManagementTreeItem | null
    ): ProjectManagementTreeItem | null {
        if (!data || typeof data.key === "undefined" || typeof data.name === "undefined") {
            this.logger.warn(`[ProjectManagementTreeDataProvider] Invalid data for tree item:`, data);
            return null;
        }

        const contextValue = this.determineContextValueFromData(data);
        const label = data.name;
        const collapsibleState = this.determineCollapsibleState(data, contextValue);

        const treeItem = new ProjectManagementTreeItem(
            label,
            contextValue,
            collapsibleState,
            data,
            this.extensionContext,
            this.logger,
            this.iconService,
            parent
        );
        this.applyStoredExpansionState(treeItem);
        return treeItem;
    }

    /**
     * Determines the appropriate context value for a tree item based on its data structure.
     */
    private determineContextValueFromData(data: any): string {
        if (data.nodeType) {
            return data.nodeType;
        } // "Version" or "Cycle" for TreeNodes
        if (typeof data.tovsCount !== "undefined" || typeof data.cyclesCount !== "undefined") {
            return TreeItemContextValues.PROJECT;
        }

        if (Object.prototype.hasOwnProperty.call(data, "children")) {
            return TreeItemContextValues.VERSION;
        }
        return TreeItemContextValues.CYCLE;
    }

    /**
     * Determines the collapsible state of a tree item based on its context and data.
     */
    private determineCollapsibleState(data: any, contextValue: string): vscode.TreeItemCollapsibleState {
        switch (contextValue) {
            case TreeItemContextValues.PROJECT: {
                const project = data as Project;
                return (project.tovsCount && project.tovsCount > 0) || (project.cyclesCount && project.cyclesCount > 0)
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
            }
            case TreeItemContextValues.VERSION: {
                const version = data as TreeNode;
                return version.children && version.children.length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
            }
            case TreeItemContextValues.CYCLE:
                return vscode.TreeItemCollapsibleState.None; // Cycles are leaves in projects tree
            default:
                return vscode.TreeItemCollapsibleState.None;
        }
    }

    /**
     * Retrieves and converts child nodes for a given project tree item.
     */
    private async getChildrenForProject(
        projectTreeItem: ProjectManagementTreeItem
    ): Promise<ProjectManagementTreeItem[]> {
        const projectKey = projectTreeItem.getUniqueId();
        if (!projectKey) {
            this.logger.error(`[ProjectManagementTreeDataProvider] Project key missing for: ${projectTreeItem.label}`);
            return [];
        }

        const operationId = `${ProjectManagementTreeDataProvider.FETCH_PROJECT_TREE_OPERATION}_${projectKey}`;
        this.operationManager.cancelOperation(operationId);

        const operation = this.operationManager.createOperation(
            operationId,
            `Fetch project tree for: ${projectTreeItem.label}`
        );

        try {
            operation.throwIfCancelled("before project tree fetch");

            const projectTree: TreeNode | null = await this.projectDataService.getProjectTree(projectKey);

            operation.throwIfCancelled("after project tree fetch");

            if (!projectTree?.children?.length) {
                return [];
            }

            return projectTree.children
                .map((tovNode) => this.createTestThemeTreeItemFromData(tovNode, projectTreeItem))
                .filter((item): item is ProjectManagementTreeItem => item !== null);
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                this.logger.debug(`[ProjectManagementTreeDataProvider] Project tree fetch cancelled for ${projectKey}`);
                return [];
            }

            this.logger.error(
                `[ProjectManagementTreeDataProvider] Error fetching children for project ${projectKey}:`,
                error
            );
            return [];
        }
    }

    /**
     * Retrieves and creates tree items for all child cycles of a version tree item.
     */
    private getChildrenForVersion(versionTreeItem: ProjectManagementTreeItem): ProjectManagementTreeItem[] {
        const cycleNodes: TreeNode[] = versionTreeItem.itemData.children ?? [];
        return cycleNodes
            .map((cycleNode) => this.createTestThemeTreeItemFromData(cycleNode, versionTreeItem))
            .filter((item): item is ProjectManagementTreeItem => item !== null);
    }

    /**
     * Handles click events on cycle tree items by fetching cycle structure data
     * and preparing it for the theme tree view.
     */
    public async handleCycleClick(cycleItem: ProjectManagementTreeItem): Promise<void> {
        const cycleLabel = typeof cycleItem.label === "string" ? cycleItem.label : "N/A";

        // Cancel any existing cycle click operation
        this.operationManager.cancelOperation(ProjectManagementTreeDataProvider.HANDLE_CYCLE_CLICK_OPERATION);

        const operation = this.operationManager.createOperation(
            ProjectManagementTreeDataProvider.HANDLE_CYCLE_CLICK_OPERATION,
            `Handle cycle click: ${cycleLabel}`
        );

        if (cycleItem.originalContextValue !== TreeItemContextValues.CYCLE) {
            this.logger.error("Clicked item is not a cycle.");
            return;
        }

        const cycleKey = cycleItem.getUniqueId();
        const projectKey = cycleItem.getProjectKey();

        if (!cycleKey || !projectKey) {
            this.logger.error(`Missing keys for cycle click. Cycle: ${cycleKey}, Project: ${projectKey}`);
            vscode.window.showErrorMessage(`Could not determine project context for cycle '${cycleLabel}'.`);
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Fetching data for cycle: ${cycleLabel}`,
                    cancellable: true // Allow user to cancel
                },
                async (progress, cancellationToken) => {
                    // Link VS Code's cancellation token with our operation
                    cancellationToken.onCancellationRequested(() => {
                        operation.cancel();
                    });

                    progress.report({ increment: 0, message: "Fetching cycle structure..." });

                    try {
                        operation.throwIfCancelled("before cycle structure fetch");

                        const rawCycleData = await this.projectDataService.fetchCycleStructure(projectKey, cycleKey);

                        operation.throwIfCancelled("after cycle structure fetch");

                        progress.report({ increment: 50, message: "Preparing theme tree..." });

                        this._onDidPrepareCycleDataForThemeTree.fire({
                            projectKey,
                            cycleKey,
                            cycleLabel,
                            rawCycleStructure: rawCycleData
                        });

                        progress.report({ increment: 100, message: "Data loaded." });
                    } catch (fetchError) {
                        if (fetchError instanceof vscode.CancellationError) {
                            this.logger.debug(
                                `[ProjectManagementTreeDataProvider] Cycle click operation cancelled for: ${cycleLabel}`
                            );
                            throw fetchError;
                        }

                        this.logger.error(`[ProjectManagementTreeDataProvider] Error fetching cycle data:`, fetchError);
                        throw fetchError;
                    }
                }
            );
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                this.logger.debug(`[ProjectManagementTreeDataProvider] Cycle click cancelled by user: ${cycleLabel}`);
                return;
            }

            this.logger.error(`[ProjectManagementTreeDataProvider] Error handling cycle click:`, error);
            vscode.window.showErrorMessage(
                `Failed to load data for cycle '${cycleLabel}': ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Retrieves the project and TOV (Test Object Version) names for a given tree item by traversing up the parent hierarchy.
     */
    public getProjectAndTovNamesForItem(item: ProjectManagementTreeItem): { projectName?: string; tovName?: string } {
        let projectName: string | undefined;
        let tovName: string | undefined;
        let current: ProjectManagementTreeItem | null = item;

        while (current) {
            const state = this.getUnifiedStateManager().getCurrentUnifiedState();
            const context =
                state.isCustomRootActive && this.isCurrentRoot(current)
                    ? state.customRootOriginalContext
                    : current.originalContextValue;
            const name = current.itemData?.name;

            if (context === TreeItemContextValues.PROJECT) {
                projectName = name;
            }
            if (context === TreeItemContextValues.VERSION) {
                tovName = name;
            }
            if (projectName && tovName) {
                break;
            }
            current = current.parent as ProjectManagementTreeItem | null;
        }

        // If the item itself is Project/Version and names not set by parent traversal
        const state = this.getUnifiedStateManager().getCurrentUnifiedState();
        const selectedContext =
            state.isCustomRootActive && this.isCurrentRoot(item)
                ? state.customRootOriginalContext
                : item.originalContextValue;

        if (selectedContext === TreeItemContextValues.PROJECT && !projectName) {
            projectName = item.itemData?.name;
        }
        if (selectedContext === TreeItemContextValues.VERSION && !tovName) {
            tovName = item.itemData?.name;
        }

        this.logger.trace(
            `[ProjectManagementTreeDataProvider] Resolved for ${item.label}: Project='${projectName}', TOV='${tovName}'`
        );
        return { projectName, tovName };
    }

    /**
     * Check if an item is the current custom root
     */
    public isCurrentRoot(item: ProjectManagementTreeItem): boolean {
        const state = this.getUnifiedStateManager().getCurrentUnifiedState();
        if (!state.isCustomRootActive || !state.customRootItem) {
            return false;
        }
        return (state.customRootItem as ProjectManagementTreeItem).getUniqueId() === item.getUniqueId();
    }

    /**
     * Clears the project management tree and resets its state.
     */
    public override clearTree(): void {
        super.clearTree();
        this.logger.trace("[ProjectManagementTreeDataProvider] Tree cleared with unified state management.");
    }

    /**
     * Refreshes the project management tree view using unified state management.
     */
    public override refresh(isHardRefresh: boolean = false): void {
        this.logger.debug(`[ProjectManagementTreeDataProvider] Refreshing. Hard refresh: ${isHardRefresh}`);

        this.operationManager.cancelAllOperations();

        if (isHardRefresh) {
            this.getUnifiedStateManager().resetCustomRoot();
        }

        if (!(isHardRefresh && this.isCustomRootActive())) {
            this.storeExpansionState();
        }

        if (this.isCustomRootActive()) {
            this.getUnifiedStateManager().updateState({
                operationalState: TreeViewOperationalState.REFRESHING
            });
        } else {
            this.getUnifiedStateManager().setLoading("Loading projects...");
        }

        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Dispose with operation cleanup
     */
    public override dispose(): void {
        this.operationManager.dispose();
        super.dispose();
    }
}
