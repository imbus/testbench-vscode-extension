/**
 * @file src/views/testTheme/testThemeTreeDataProvider.ts
 * @description Test theme tree data provider using new architecture
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeDataProvider, TreeDataProviderOptions } from "../common/baseTreeDataProvider";
import { TestThemeTreeItem } from "./testThemeTreeItem";
import { ProjectDataService } from "../../services/projectDataService";
import { MarkedItemStateService } from "../../services/markedItemStateService";
import { ContextKeys, TreeItemContextValues } from "../../constants";
import { CycleNodeData, CycleStructure } from "../../testBenchTypes";
import { CycleDataForThemeTreeEvent } from "../projectManagement/projectManagementTreeDataProvider";
import { IconManagementService } from "../../services/iconManagementService";
import { TreeViewType, TreeViewEmptyState, TreeViewOperationalState } from "../../services/treeViewStateTypes";

export class TestThemeTreeDataProvider extends BaseTreeDataProvider<TestThemeTreeItem> {
    private currentCycleKey: string | null = null;
    private currentProjectKey: string | null = null;
    private currentCycleLabel: string | null = null;
    private readonly iconService: IconManagementService;

    constructor(
        extensionContext: vscode.ExtensionContext,
        logger: TestBenchLogger,
        updateMessageCallback: (message: string | undefined) => void,
        private readonly projectDataService: ProjectDataService,
        private readonly markedItemStateService: MarkedItemStateService,
        iconManagementService: IconManagementService
    ) {
        const providerOptions: TreeDataProviderOptions = {
            contextKey: ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT,
            customRootContextValue: TreeItemContextValues.CUSTOM_ROOT_TEST_THEME,
            enableCustomRoot: true,
            enableExpansionTracking: true,
            stateConfig: {
                treeViewId: "testThemeTree",
                treeViewType: TreeViewType.TEST_THEME,
                noDataSourceMessage: "Select a cycle from the 'Projects' view to see test themes.",
                loadingMessageTemplate: "Loading test themes for {dataSource}..."
            }
        };
        super(extensionContext, logger, updateMessageCallback, providerOptions);
        this.iconService = iconManagementService;
        this.logger.trace("[TestThemeTreeDataProvider] Initialized with enhanced state management");
    }

    public getCurrentCycleKey(): string | null {
        return this.currentCycleKey;
    }
    public getCurrentProjectKey(): string | null {
        return this.currentProjectKey;
    }

    public populateFromCycleData(eventData: CycleDataForThemeTreeEvent): void {
        this.logger.trace(`[TestThemeTreeDataProvider] Populating from cycle data: ${eventData.cycleKey}`);

        this.setDataSource(eventData.cycleKey, eventData.cycleLabel, eventData.cycleLabel);

        this.currentCycleKey = eventData.cycleKey;
        this.currentProjectKey = eventData.projectKey;
        this.currentCycleLabel = eventData.cycleLabel;

        if (this.isCustomRootActive()) {
            this.customRootService.resetCustomRoot();
        }
        this.storeExpansionState(); // Store expansion state before building new tree

        if (!eventData.rawCycleStructure?.nodes?.length || !eventData.rawCycleStructure.root?.base?.key) {
            this.logger.warn(`[TTTDP] Invalid cycle structure for: ${eventData.cycleLabel}`);
            this.updateElements([]);
            this.setErrorState(new Error("Invalid cycle structure"), TreeViewEmptyState.PROCESSING_ERROR);
            return;
        }

        try {
            const elements = this.buildTreeFromCycleStructure(eventData.rawCycleStructure);
            this.recordFetchAttempt(true, eventData.rawCycleStructure.nodes.length, elements.length);
            this.updateElements(elements);

            if (elements.length === 0) {
                this.updateTreeState({
                    operationalState: TreeViewOperationalState.EMPTY,
                    emptyState: TreeViewEmptyState.SERVER_NO_DATA
                });
            }
        } catch (error) {
            this.logger.error(`[TTTDP] Error building tree from cycle structure:`, error);
            this.setErrorState(error as Error, TreeViewEmptyState.PROCESSING_ERROR);
        }
    }

    protected async fetchRootElements(): Promise<TestThemeTreeItem[]> {
        if (!this.currentCycleKey || !this.currentProjectKey) {
            this.updateTreeState({
                operationalState: TreeViewOperationalState.EMPTY,
                emptyState: TreeViewEmptyState.NO_DATA_SOURCE
            });
            return [];
        }

        this.logger.debug(`[TTTDP] fetchRootElements for cycle ${this.currentCycleKey}`);
        this.setLoadingState(`Loading test themes for cycle: ${this.currentCycleLabel || this.currentCycleKey}...`);

        try {
            const cycleStructure = await this.projectDataService.fetchCycleStructure(
                this.currentProjectKey,
                this.currentCycleKey
            );

            if (cycleStructure) {
                const newRootElements = this.buildTreeFromCycleStructure(cycleStructure);
                const applyExpansionRecursive = (items: TestThemeTreeItem[]) => {
                    for (const item of items) {
                        this.applyStoredExpansionState(item);
                        if (item.children) {
                            applyExpansionRecursive(item.children as TestThemeTreeItem[]);
                        }
                    }
                };
                applyExpansionRecursive(newRootElements);
                this.rootElements = newRootElements;

                this.recordFetchAttempt(true, cycleStructure.nodes?.length || 0, newRootElements.length);

                if (newRootElements.length === 0) {
                    this.updateTreeState({
                        operationalState: TreeViewOperationalState.EMPTY,
                        emptyState: TreeViewEmptyState.SERVER_NO_DATA
                    });
                } else {
                    this.updateTreeState({
                        operationalState: TreeViewOperationalState.READY
                    });
                }

                return newRootElements;
            } else {
                this.setErrorState(new Error("Failed to fetch cycle structure"), TreeViewEmptyState.FETCH_ERROR);
                return [];
            }
        } catch (error) {
            this.logger.error(`[TTTDP] Error in fetchRootElements:`, error);
            this.setErrorState(error as Error, TreeViewEmptyState.FETCH_ERROR);
            return [];
        }
    }

    protected async fetchChildrenForElement(element: TestThemeTreeItem): Promise<TestThemeTreeItem[]> {
        return (element.children as TestThemeTreeItem[]) || [];
    }

    protected createTreeItemFromData(data: CycleNodeData, parent: TestThemeTreeItem | null): TestThemeTreeItem | null {
        if (!data?.base?.key || !data?.base?.name) {
            this.logger.warn("[TTTDP] Invalid cycle node data for tree item creation:", data);
            return null;
        }
        const label = data.base.numbering ? `${data.base.numbering} ${data.base.name}` : data.base.name;
        const hasChildren = this.nodeWillHaveVisibleChildren(data, this.getRawNodesFromCurrentRoot());

        const collapsibleState = hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        const treeItem = new TestThemeTreeItem(
            label,
            data.elementType,
            collapsibleState,
            data,
            this.extensionContext,
            this.logger,
            this.iconService,
            parent
        );

        const itemKey = treeItem.getUniqueId();
        const itemUID = treeItem.getUID();
        if (itemKey && itemUID) {
            const importState = this.markedItemStateService.getItemImportState(itemKey, itemUID);
            treeItem.updateContextForMarking(importState.shouldShow);
        }

        this.applyStoredExpansionState(treeItem);
        return treeItem;
    }

    // Helper to get the current set of all nodes being processed
    private getRawNodesFromCurrentRoot(): CycleNodeData[] {
        const activeRoot = this.isCustomRootActive()
            ? this.getCurrentCustomRoot()?.itemData
            : (this.rootElements[0]?.itemData as CycleNodeData); // This is flawed if multiple roots
        if (activeRoot && activeRoot.nodes) {
            return activeRoot.nodes;
        } // If root is the cycle_structure.json itself
        if (this.rootElements.length > 0 && this.rootElements[0]?.itemData?.parentCycleStructure?.nodes) {
            return this.rootElements[0].itemData.parentCycleStructure.nodes;
        }
        this.logger.warn("[TTTDP] Cannot get raw nodes for child check, full structure not readily available.");
        return [];
    }

    private nodeWillHaveVisibleChildren(nodeData: CycleNodeData, allNodes: CycleNodeData[]): boolean {
        return allNodes.some(
            (childNode) =>
                childNode.base.parentKey === nodeData.base.key && this.isNodeVisibleInTestThemeTree(childNode)
        );
    }

    private buildTreeFromCycleStructure(cycleStructure: CycleStructure): TestThemeTreeItem[] {
        const elementsByKey = new Map<string, CycleNodeData>();
        cycleStructure.nodes.forEach((node) => {
            if (node?.base?.key) {
                elementsByKey.set(node.base.key, node);
            }
        });

        if (elementsByKey.size === 0 && cycleStructure.nodes.length > 0) {
            this.logger.error("[TTTDP] No nodes with base.key found in cycle structure.");
            return [];
        }
        const rootCycleKey = cycleStructure.root.base.key;
        return this.buildTreeRecursively(rootCycleKey, null, elementsByKey);
    }

    private buildTreeRecursively(
        parentKey: string,
        parentItem: TestThemeTreeItem | null,
        elementsByKey: Map<string, CycleNodeData>
    ): TestThemeTreeItem[] {
        const children: TestThemeTreeItem[] = [];
        for (const nodeData of elementsByKey.values()) {
            if (nodeData.base.parentKey === parentKey && this.isNodeVisibleInTestThemeTree(nodeData)) {
                const treeItem = this.createTreeItemFromData(nodeData, parentItem);
                if (treeItem) {
                    const grandChildren = this.buildTreeRecursively(nodeData.base.key, treeItem, elementsByKey);
                    treeItem.children = grandChildren;
                    if (grandChildren.length > 0) {
                        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                    } else {
                        treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
                    }
                    this.applyStoredExpansionState(treeItem);
                    children.push(treeItem);
                }
            }
        }
        return children;
    }

    private isNodeVisibleInTestThemeTree(nodeData: CycleNodeData): boolean {
        if (nodeData.elementType === TreeItemContextValues.TEST_CASE_NODE) {
            return false;
        }
        if (nodeData.exec?.status === "NotPlanned" || nodeData.exec?.locker === "-2") {
            return false;
        }
        return true;
    }

    public getReportRootUIDForItem(item: TestThemeTreeItem): string | undefined {
        const itemKey = item.getUniqueId();
        const itemUID = item.getUID();
        return itemKey && itemUID ? this.markedItemStateService.getReportRootUID(itemKey, itemUID) : undefined;
    }

    public override clearTree(): void {
        this.currentCycleKey = null;
        this.currentProjectKey = null;
        this.currentCycleLabel = null;
        super.clearTree();
        this.logger.trace("[TestThemeTreeDataProvider] Tree cleared with enhanced state management.");
    }

    public override async refresh(isHardRefresh: boolean = false): Promise<void> {
        this.logger.debug(`[TestThemeTreeDataProvider] Refreshing. Hard refresh: ${isHardRefresh}`);

        if (isHardRefresh && this.isCustomRootActive()) {
            this.customRootService.resetCustomRoot();
        }
        this.storeExpansionState();

        if (!this.currentCycleKey || !this.currentProjectKey) {
            this.clearTree();
            return;
        }

        this.setDataSource(this.currentCycleKey, this.currentCycleLabel || this.currentCycleKey);

        const loadingMessage =
            this.isCustomRootActive() && this.getCurrentCustomRoot()
                ? `Refreshing: ${this.getCurrentCustomRoot()?.label}...`
                : `Refreshing test themes for cycle: ${this.currentCycleLabel || this.currentCycleKey}...`;

        this.setLoadingState(loadingMessage);

        try {
            const cycleStructure = await this.projectDataService.fetchCycleStructure(
                this.currentProjectKey,
                this.currentCycleKey
            );

            if (cycleStructure) {
                if (this.isCustomRootActive() && !isHardRefresh) {
                    await this.refreshCustomRootNode(cycleStructure);
                } else {
                    const elements = this.buildTreeFromCycleStructure(cycleStructure);
                    this.recordFetchAttempt(true, cycleStructure.nodes?.length || 0, elements.length);
                    this.updateElements(elements);
                }
            } else {
                this.setErrorState(new Error("Failed to fetch cycle structure"), TreeViewEmptyState.FETCH_ERROR);
            }
        } catch (error) {
            this.logger.error(`[TTTDP] Error during refresh:`, error);
            this.setErrorState(error as Error, TreeViewEmptyState.FETCH_ERROR);
        }
    }

    private async refreshCustomRootNode(cycleStructure: CycleStructure): Promise<void> {
        const currentRoot = this.getCurrentCustomRoot();
        if (!currentRoot) {
            return;
        }

        const currentRootKey = currentRoot.getUniqueId();
        const elementsByKey = new Map<string, CycleNodeData>();
        cycleStructure.nodes.forEach((node) => node?.base?.key && elementsByKey.set(node.base.key, node));

        const updatedNodeData = elementsByKey.get(currentRootKey);

        if (updatedNodeData) {
            currentRoot.itemData = updatedNodeData;
            currentRoot.label = updatedNodeData.base.numbering
                ? `${updatedNodeData.base.numbering} ${updatedNodeData.base.name}`
                : updatedNodeData.base.name;
            currentRoot.children = this.buildTreeRecursively(currentRootKey, currentRoot, elementsByKey);
            currentRoot.collapsibleState =
                currentRoot.children.length > 0
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None;

            this.applyStoredExpansionState(currentRoot);
            this.updateElements([currentRoot]);
        } else {
            this.logger.warn(`[TTTDP] Custom root ${currentRootKey} not found in refreshed data. Resetting.`);
            this.customRootService.resetCustomRoot();
            this.refresh(true);
        }
    }
}
