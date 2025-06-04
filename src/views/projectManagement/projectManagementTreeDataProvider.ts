/**
 * @file src/views/projectManagement/projectManagementTreeDataProvider.ts
 * @description Project management tree data provider using new architecture
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeDataProvider, TreeDataProviderOptions } from "../common/baseTreeDataProvider";
import { ProjectManagementTreeItem } from "./projectManagementTreeItem";
import { ProjectDataService } from "../../services/projectDataService";
import { ContextKeys, TreeItemContextValues } from "../../constants";
import { Project, TreeNode, CycleStructure } from "../../testBenchTypes";
import { IconManagementService } from "../../services/iconManagementService";

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
            enableExpansionTracking: true
        };
        super(extensionContext, logger, updateMessageCallback, providerOptions);
        this.logger.trace("[ProjectManagementTreeDataProvider] Initialized");
    }

    protected async fetchRootElements(): Promise<ProjectManagementTreeItem[]> {
        this.logger.debug("[ProjectManagementTreeDataProvider] Fetching root projects");
        const projectList: Project[] | null = await this.projectDataService.getProjectsList();

        if (projectList === null) {
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
            .filter((item): item is ProjectManagementTreeItem => item !== null);

        this.updateMessageCallback(undefined);
        return projectItems;
    }

    protected async fetchChildrenForElement(element: ProjectManagementTreeItem): Promise<ProjectManagementTreeItem[]> {
        this.logger.debug(`[ProjectManagementTreeDataProvider] Fetching children for: ${element.label}`);
        const itemContext = element.originalContextValue;

        switch (itemContext) {
            case TreeItemContextValues.PROJECT:
                return this.getChildrenForProject(element);
            case TreeItemContextValues.VERSION:
                return this.getChildrenForVersion(element);
            case TreeItemContextValues.CYCLE:
                return []; // Cycles don't show direct children in this tree
            default:
                this.logger.warn(
                    `[ProjectManagementTreeDataProvider] Unknown element type for fetching children: ${itemContext}`
                );
                return [];
        }
    }

    protected createTreeItemFromData(
        data: any, // Project or TreeNode
        parent: ProjectManagementTreeItem | null
    ): ProjectManagementTreeItem | null {
        if (!data || typeof data.key === "undefined" || typeof data.name === "undefined") {
            this.logger.warn(`[ProjectManagementTreeDataProvider] Invalid data for tree item:`, data);
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
            this.logger,
            this.iconService,
            parent
        );
        this.applyStoredExpansionState(treeItem);
        return treeItem;
    }

    private determineContextValue(data: any): string {
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

    private async getChildrenForProject(
        projectElement: ProjectManagementTreeItem
    ): Promise<ProjectManagementTreeItem[]> {
        const projectKey = projectElement.getUniqueId();
        if (!projectKey) {
            this.logger.error(`[PMTDP] Project key missing for: ${projectElement.label}`);
            return [];
        }
        const projectTree: TreeNode | null = await this.projectDataService.getProjectTree(projectKey);
        if (!projectTree?.children?.length) {
            return [];
        }
        return projectTree.children
            .map((tovNode) => this.createTreeItemFromData(tovNode, projectElement))
            .filter((item): item is ProjectManagementTreeItem => item !== null);
    }

    private getChildrenForVersion(versionElement: ProjectManagementTreeItem): ProjectManagementTreeItem[] {
        const cycleNodes: TreeNode[] = versionElement.itemData.children ?? [];
        return cycleNodes
            .map((cycleNode) => this.createTreeItemFromData(cycleNode, versionElement))
            .filter((item): item is ProjectManagementTreeItem => item !== null);
    }

    public async handleCycleClick(cycleItem: ProjectManagementTreeItem): Promise<void> {
        const cycleLabel = typeof cycleItem.label === "string" ? cycleItem.label : "N/A";
        this.logger.trace(`[PMTDP] Handling cycle click: ${cycleLabel}`);

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
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ increment: 0, message: "Fetching cycle structure..." });
                    const rawCycleData = await this.projectDataService.fetchCycleStructure(projectKey, cycleKey);
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
            this.logger.error(`[PMTDP] Error handling cycle click:`, error);
            vscode.window.showErrorMessage(
                `Failed to load data for cycle '${cycleLabel}': ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    public getProjectAndTovNamesForItem(item: ProjectManagementTreeItem): { projectName?: string; tovName?: string } {
        let projectName: string | undefined;
        let tovName: string | undefined;
        let current: ProjectManagementTreeItem | null = item;

        while (current) {
            const context = this.customRootService.isCurrentRoot(current)
                ? this.customRootService.getOriginalContextValue()
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
        const selectedContext = this.customRootService.isCurrentRoot(item)
            ? this.customRootService.getOriginalContextValue()
            : item.originalContextValue;

        if (selectedContext === TreeItemContextValues.PROJECT && !projectName) {
            projectName = item.itemData?.name;
        }
        if (selectedContext === TreeItemContextValues.VERSION && !tovName) {
            tovName = item.itemData?.name;
        }

        this.logger.trace(`[PMTDP] Resolved for ${item.label}: Project='${projectName}', TOV='${tovName}'`);
        return { projectName, tovName };
    }

    public override clearTree(): void {
        super.clearTree();
        this.updateMessageCallback("Not connected to TestBench or no projects available.");
        this.logger.trace("[ProjectManagementTreeDataProvider] Tree cleared.");
    }

    public override refresh(isHardRefresh: boolean = false): void {
        this.logger.debug(`[ProjectManagementTreeDataProvider] Refreshing. Hard refresh: ${isHardRefresh}`);
        if (isHardRefresh && this.isCustomRootActive()) {
            this.customRootService.resetCustomRoot();
        }
        // Store expansion state before fetching new data if not a hard reset of custom root
        if (!(isHardRefresh && this.isCustomRootActive())) {
            this.storeExpansionState();
        }

        if (this.isCustomRootActive()) {
            this.updateMessageCallback(undefined); // Custom root view has its own context
        } else {
            this.updateMessageCallback("Loading projects...");
        }
        this._onDidChangeTreeData.fire(undefined);
    }
}
