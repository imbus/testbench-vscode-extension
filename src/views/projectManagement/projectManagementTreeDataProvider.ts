/**
 * @file src/views/projectManagement/projectManagementTreeDataProvider.ts
 * @description Project management tree data provider using new architecture
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeDataProvider } from "../common/baseTreeDataProvider";
import { ProjectManagementTreeItem } from "./projectManagementTreeItem";
import { ProjectDataService } from "../../services/projectDataService";
import { IconManagementService } from "../../services/iconManagementService";
import { TreeItemContextValues, ContextKeys } from "../../constants";
import { Project, TreeNode, CycleStructure } from "../../testBenchTypes";

export interface CycleDataForThemeTreeEvent {
    projectKey: string;
    cycleKey: string;
    cycleLabel: string;
    rawCycleStructure: CycleStructure | null;
}

export class ProjectManagementTreeDataProvider extends BaseTreeDataProvider<ProjectManagementTreeItem> {
    private _onDidPrepareCycleDataForThemeTree: vscode.EventEmitter<CycleDataForThemeTreeEvent> =
        new vscode.EventEmitter<CycleDataForThemeTreeEvent>();
    public readonly onDidPrepareCycleDataForThemeTree: vscode.Event<CycleDataForThemeTreeEvent> =
        this._onDidPrepareCycleDataForThemeTree.event;

    constructor(
        extensionContext: vscode.ExtensionContext,
        logger: TestBenchLogger,
        updateMessageCallback: (message: string | undefined) => void,
        private readonly projectDataService: ProjectDataService,
        private readonly iconManagementService: IconManagementService
    ) {
        super(extensionContext, logger, updateMessageCallback, {
            contextKey: ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT,
            customRootContextValue: TreeItemContextValues.CUSTOM_ROOT_PROJECT,
            enableCustomRoot: true,
            enableExpansionTracking: true
        });

        // Inject icon service into extension context for tree items
        (this.extensionContext as any).iconManagementService = this.iconManagementService;
    }

    /**
     * Fetch root elements (projects)
     */
    protected async fetchRootElements(): Promise<ProjectManagementTreeItem[]> {
        this.logger.debug("[ProjectManagementTreeDataProvider] Fetching root projects");

        const projectList: Project[] | null = await this.projectDataService.getProjectsList();

        if (!projectList) {
            this.updateMessageCallback("Error fetching projects. Please check connection or try refreshing.");
            return [];
        }

        if (projectList.length === 0) {
            this.updateMessageCallback(
                "No projects found on the server. Create a project in TestBench or check permissions."
            );
            return [];
        }

        const projectItems = projectList
            .map((project) => this.createTreeItemFromData(project, null))
            .filter((item) => item !== null) as ProjectManagementTreeItem[];

        this.updateMessageCallback(undefined);
        return projectItems;
    }

    /**
     * Fetch children for a specific element
     */
    protected async fetchChildrenForElement(element: ProjectManagementTreeItem): Promise<ProjectManagementTreeItem[]> {
        this.logger.debug(`[ProjectManagementTreeDataProvider] Fetching children for: ${element.label}`);

        switch (element.originalContextValue) {
            case TreeItemContextValues.PROJECT:
                return await this.getChildrenForProject(element);
            case TreeItemContextValues.VERSION:
                return this.getChildrenForVersion(element);
            case TreeItemContextValues.CYCLE:
                return []; // Cycles don't show direct children in this tree
            default:
                this.logger.warn(
                    `[ProjectManagementTreeDataProvider] Unknown element type: ${element.originalContextValue}`
                );
                return [];
        }
    }

    /**
     * Create tree item from raw data
     */
    protected createTreeItemFromData(
        data: any,
        parent: ProjectManagementTreeItem | null
    ): ProjectManagementTreeItem | null {
        if (!data || typeof data.key === "undefined" || typeof data.name === "undefined") {
            this.logger.warn(`[ProjectManagementTreeDataProvider] Invalid data for tree item creation:`, data);
            return null;
        }

        const contextValue = this.determineContextValue(data);
        const label = data.name;
        const collapsibleState = this.determineCollapsibleState(data, contextValue);

        const treeItem = new ProjectManagementTreeItem(
            label,
            contextValue,
            collapsibleState,
            data,
            this.extensionContext,
            parent
        );

        // Apply stored expansion state
        this.applyStoredExpansionState(treeItem);

        return treeItem;
    }

    /**
     * Get children for a project element
     */
    private async getChildrenForProject(
        projectElement: ProjectManagementTreeItem
    ): Promise<ProjectManagementTreeItem[]> {
        const projectKey = projectElement.getUniqueId();
        if (!projectKey) {
            this.logger.error(`[ProjectManagementTreeDataProvider] Project key missing for: ${projectElement.label}`);
            return [];
        }

        const projectTree: TreeNode | null = await this.projectDataService.getProjectTree(projectKey);

        if (!projectTree?.children?.length) {
            this.logger.debug(
                `[ProjectManagementTreeDataProvider] No children found for project: ${projectElement.label}`
            );
            return [];
        }

        return projectTree.children
            .map((tovNode) => this.createTreeItemFromData(tovNode, projectElement))
            .filter((item: ProjectManagementTreeItem | null): item is ProjectManagementTreeItem => item !== null);
    }

    /**
     * Get children for a version (TOV) element
     */
    private getChildrenForVersion(versionElement: ProjectManagementTreeItem): ProjectManagementTreeItem[] {
        this.logger.debug(`[ProjectManagementTreeDataProvider] Getting children for TOV: ${versionElement.label}`);

        const cycleNodes = versionElement.itemData.children ?? [];
        return cycleNodes
            .map((cycleNode: TreeNode) => this.createTreeItemFromData(cycleNode, versionElement))
            .filter((item: ProjectManagementTreeItem | null): item is ProjectManagementTreeItem => item !== null);
    }

    /**
     * Determine context value from data
     */
    private determineContextValue(data: any): string {
        // If data has a nodeType, use it directly
        if (data.nodeType) {
            return data.nodeType;
        }

        // Fallback logic based on data structure
        if (data.tovsCount !== undefined || data.cyclesCount !== undefined) {
            return TreeItemContextValues.PROJECT;
        }

        if (data.children && Array.isArray(data.children)) {
            return TreeItemContextValues.VERSION;
        }

        return TreeItemContextValues.CYCLE;
    }

    /**
     * Determine collapsible state from data and context
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
                return vscode.TreeItemCollapsibleState.None;

            default:
                return vscode.TreeItemCollapsibleState.None;
        }
    }

    /**
     * Handle cycle click for theme tree preparation
     */
    public async handleCycleClick(cycleItem: ProjectManagementTreeItem): Promise<void> {
        const cycleLabel = typeof cycleItem.label === "string" ? cycleItem.label : "N/A";
        this.logger.trace(`[ProjectManagementTreeDataProvider] Handling cycle click: ${cycleLabel}`);

        if (cycleItem.originalContextValue !== TreeItemContextValues.CYCLE) {
            this.logger.error("Clicked item is not a cycle. Cannot proceed.");
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
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ increment: 0, message: "Fetching cycle structure..." });

                    const rawCycleData = await this.getCycleStructure(projectKey, cycleKey);

                    progress.report({ increment: 50, message: "Preparing theme tree..." });

                    this._onDidPrepareCycleDataForThemeTree.fire({
                        projectKey,
                        cycleKey,
                        cycleLabel,
                        rawCycleStructure: rawCycleData
                    });

                    progress.report({ increment: 100, message: "Data loaded." });
                }
            );
        } catch (error) {
            this.logger.error(`[ProjectManagementTreeDataProvider] Error handling cycle click:`, error);
            vscode.window.showErrorMessage(
                `Failed to load cycle data: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Get cycle structure data
     */
    private async getCycleStructure(projectKey: string, cycleKey: string): Promise<CycleStructure | null> {
        try {
            return await this.projectDataService.fetchCycleStructure(projectKey, cycleKey);
        } catch (error) {
            this.logger.error(`[ProjectManagementTreeDataProvider] Failed to fetch cycle structure:`, error);
            return null;
        }
    }

    /**
     * Get project and TOV names for an item
     */
    public getProjectAndTovNamesForItem(
        item: ProjectManagementTreeItem
    ): { projectName: string | undefined; tovName: string | undefined } | null {
        let projectName: string | undefined;
        let tovName: string | undefined;

        let current: ProjectManagementTreeItem | null = item;

        // Traverse up the tree to find project and TOV names
        while (current) {
            const effectiveContext = this.customRootService.isCurrentRoot(current)
                ? this.customRootService.getOriginalContextValue()
                : current.originalContextValue;

            const itemName = current.itemData?.name;

            if (effectiveContext === TreeItemContextValues.PROJECT && !projectName) {
                projectName = itemName;
            } else if (effectiveContext === TreeItemContextValues.VERSION && !tovName) {
                tovName = itemName;
            }

            if (projectName && tovName) {
                break;
            }

            current = current.parent as ProjectManagementTreeItem | null;
        }

        // Handle case where the selected item itself is the project or TOV
        const selectedEffectiveContext = this.customRootService.isCurrentRoot(item)
            ? this.customRootService.getOriginalContextValue()
            : item.originalContextValue;

        if (selectedEffectiveContext === TreeItemContextValues.PROJECT && !projectName) {
            projectName = item.itemData?.name;
        } else if (selectedEffectiveContext === TreeItemContextValues.VERSION && !tovName) {
            tovName = item.itemData?.name;
        }

        this.logger.trace(
            `[ProjectManagementTreeDataProvider] Resolved names - Project: '${projectName}', TOV: '${tovName}'`
        );

        return { projectName, tovName };
    }

    /**
     * Override refresh to handle custom messaging
     */
    public refresh(isHardRefresh: boolean = false): void {
        this.logger.debug(`[ProjectManagementTreeDataProvider] Refreshing. Hard refresh: ${isHardRefresh}`);

        if (isHardRefresh && this.isCustomRootActive()) {
            this.customRootService.handleHardRefresh();
        }

        // Store expansion state before refresh
        this.storeExpansionState();

        if (this.isCustomRootActive()) {
            this.updateMessageCallback(undefined);
        } else {
            this.updateMessageCallback("Loading projects...");
        }

        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Override clear tree for specific messaging
     */
    public clearTree(): void {
        super.clearTree();
        this.updateMessageCallback("Not connected to TestBench. Please log in.");
    }
}
