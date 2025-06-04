/**
 * @file src/views/testElements/testElementsTreeDataProvider.ts
 * @description Test elements tree data provider using new architecture
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeDataProvider, TreeDataProviderOptions } from "../common/baseTreeDataProvider";
import { TestElementTreeItem, TestElementData } from "./testElementTreeItem";
import { TestElementDataService } from "../../services/testElementDataService";
import { ResourceFileService } from "../../services/resourceFileService";
import { TestElementTreeBuilder } from "./testElementTreeBuilder";
import { ConfigKeys } from "../../constants";
import { getExtensionConfiguration } from "../../configuration";
import { IconManagementService } from "../../services/iconManagementService";

export const fileContentOfRobotResourceSubdivisionFile = `tb:uid:`;

function appendResourceExtensionAndTrimPathLocal(baseTargetPath: string, logger: TestBenchLogger): string {
    logger.trace(`Adding .resource extension and trimming path: ${baseTargetPath}`);
    let targetPath = baseTargetPath.endsWith(".resource") ? baseTargetPath : `${baseTargetPath}.resource`;
    targetPath = targetPath.replace(/\s+(\.resource)$/, "$1").trimEnd();
    targetPath = targetPath.trimStart();
    logger.trace(`Normalized path: ${targetPath}`);
    return targetPath;
}

/**
 * Removes all occurrences of "[Robot-Resource]" from a given path string.
 * @param {string} pathStr The original path string.
 * @returns {string} The cleaned path string.
 */
function removeRobotResourceFromPathString(pathStr: string, logger: TestBenchLogger): string {
    const cleanedPath: string = pathStr.replace(/\[Robot-Resource\]/g, "");
    logger.trace(`[removeRobotResourceFromPathString] Removed [Robot-Resource] from path ${pathStr}: ${cleanedPath}`);
    return cleanedPath;
}

export class TestElementsTreeDataProvider extends BaseTreeDataProvider<TestElementTreeItem> {
    private currentTovKey: string = "";
    private isDataFetchAttempted: boolean = false;

    constructor(
        extensionContext: vscode.ExtensionContext,
        logger: TestBenchLogger,
        updateMessageCallback: (message: string | undefined) => void,
        private readonly testElementDataService: TestElementDataService,
        private readonly resourceFileService: ResourceFileService,
        private readonly iconManagementService: IconManagementService,
        private readonly testElementTreeBuilder: TestElementTreeBuilder
    ) {
        const providerOptions: TreeDataProviderOptions = {
            contextKey: "testbenchExtension.testElementsTreeHasCustomRoot",
            customRootContextValue: "customRoot.testElement",
            enableCustomRoot: false,
            enableExpansionTracking: true
        };
        super(extensionContext, logger, updateMessageCallback, providerOptions);
        this.logger.trace("[TestElementsTreeDataProvider] Initialized");
    }

    public getCurrentTovKey(): string {
        return this.currentTovKey;
    }
    public setCurrentTovKey(tovKey: string): void {
        this.currentTovKey = tovKey;
    }
    public isTreeDataEmpty(): boolean {
        return this.rootElements.length === 0;
    }

    public updateTreeViewStatusMessage(): void {
        if (this.isTreeDataEmpty()) {
            if (!this.isDataFetchAttempted) {
                this.updateMessageCallback(
                    "Select a Test Object Version (TOV) from the 'Projects' view to load test elements."
                );
            } else {
                const filterPatterns = getExtensionConfiguration().get<string[]>(
                    ConfigKeys.TB2ROBOT_RESOURCE_MARKER,
                    []
                );
                if (filterPatterns && filterPatterns.length > 0) {
                    this.updateMessageCallback("No test elements match the current filter criteria.");
                } else {
                    this.updateMessageCallback("No test elements found for the selected Test Object Version (TOV).");
                }
            }
        } else {
            this.updateMessageCallback(undefined);
        }
    }

    /**
     * Handles tree item expansion/collapse events to maintain state.
     * @param element The tree item that was expanded/collapsed
     * @param expanded Whether the item is now expanded or collapsed
     */
    public handleItemExpansion(element: TestElementTreeItem, expanded: boolean): void {
        this.logger.trace(`[TETDP] Item ${element.label} expansion changed to: ${expanded}`);
        this.handleExpansion(element, expanded);
    }

    /**
     * Fetches test elements for a given TOV key and rebuilds the tree while preserving expansion state.
     * @param tovKey The Test Object Version key to fetch elements for
     * @param newTreeViewTitle Optional title for the tree view
     * @returns Promise<boolean> indicating success/failure
     */
    public async fetchTestElements(tovKey: string, newTreeViewTitle?: string): Promise<boolean> {
        this.logger.debug(`[TETDP] Fetching test elements for TOV: ${tovKey}`);
        this.isDataFetchAttempted = true;
        const tovLabel = newTreeViewTitle || tovKey;
        this.updateMessageCallback(`Loading test elements for TOV: ${tovLabel}...`);

        // Store expansion state before clearing tree
        const isRefreshingSameTov = this.currentTovKey === tovKey;
        if (isRefreshingSameTov && this.rootElements.length > 0) {
            this.storeExpansionState();
        }

        // Clear the tree
        this.updateElements([]);

        try {
            const rawtestElementsJsonData = await this.testElementDataService.getTestElements(tovKey);
            if (rawtestElementsJsonData) {
                this.currentTovKey = tovKey;
                const hierarchicalData: TestElementData[] = this.testElementTreeBuilder.build(rawtestElementsJsonData);
                const treeItems: TestElementTreeItem[] = this.convertHierarchicalDataToTreeItems(
                    hierarchicalData,
                    null
                );

                await this.updateAllItemIcons(treeItems);
                this.updateElements(treeItems);
                if (treeItems.length === 0) {
                    this.updateMessageCallback(`No test elements match criteria for TOV: ${tovLabel}.`);
                } else {
                    this.updateMessageCallback(undefined);
                }

                // TODO: Update tree view title
                // if (newTreeViewTitle && testElementTreeView) {
                //    testElementTreeView.title = `Test Elements (${newTreeViewTitle})`;
                // }
                return true;
            } else {
                this.handleFetchFailure(tovLabel);
                return false;
            }
        } catch (error) {
            this.handleFetchFailure(tovLabel, error);
            return false;
        }
    }

    /**
     * Converts hierarchical test element data to tree items with proper expansion state handling.
     * @param dataArray Array of test element data to convert
     * @param parent Parent tree item (null for root items)
     * @returns Array of tree items with children and proper expansion states
     */
    private convertHierarchicalDataToTreeItems(
        dataArray: TestElementData[],
        parent: TestElementTreeItem | null
    ): TestElementTreeItem[] {
        return dataArray.map((data) => {
            const treeItem = this.createTreeItemFromData(data, parent);
            if (data.children && data.children.length > 0) {
                treeItem.children = this.convertHierarchicalDataToTreeItems(data.children, treeItem);

                // Set default collapsible state based on children
                treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

                this.applyStoredExpansionState(treeItem);
            } else {
                treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
            }
            return treeItem;
        });
    }

    private async updateAllItemIcons(items: TestElementTreeItem[]): Promise<void> {
        for (const item of items) {
            await this.updateSingleItemIcon(item);
            if (item.children) {
                await this.updateAllItemIcons(item.children as TestElementTreeItem[]);
            }
        }
    }

    private async updateSingleItemIcon(item: TestElementTreeItem): Promise<void> {
        const elementData = item.testElementData;
        if (elementData.elementType === "Subdivision") {
            const hierarchicalName = item.getHierarchicalName();
            const absolutePath = await this.resourceFileService.constructAbsolutePath(hierarchicalName);
            if (absolutePath) {
                const isFinal = item.isFinalSubdivision();
                let pathToCheck = removeRobotResourceFromPathString(absolutePath, this.logger);
                if (isFinal) {
                    pathToCheck = appendResourceExtensionAndTrimPathLocal(pathToCheck, this.logger);
                }
                const exists = await this.resourceFileService.pathExists(pathToCheck);
                item.updateSubdivisionIcon(exists ? "LocalSubdivision" : "MissingSubdivision");
            } else {
                item.updateSubdivisionIcon("MissingSubdivision");
            }
        } else {
            item.updateIcon();
        }
    }

    protected async fetchRootElements(): Promise<TestElementTreeItem[]> {
        return this.rootElements;
    }

    protected async fetchChildrenForElement(element: TestElementTreeItem): Promise<TestElementTreeItem[]> {
        return (element.children as TestElementTreeItem[]) || [];
    }

    /**
     * Creates a tree item from test element data with proper state initialization.
     * @param data Test element data to create tree item from
     * @param parent Parent tree item (null for root items)
     * @returns Created tree item with proper expansion state applied
     */
    protected createTreeItemFromData(data: TestElementData, parent: TestElementTreeItem | null): TestElementTreeItem {
        const item = new TestElementTreeItem(
            data,
            this.extensionContext,
            this.logger,
            this.iconManagementService,
            parent
        );
        this.logger.trace(`[TETDP] Created tree item.`);

        this.applyStoredExpansionState(item);
        return item;
    }

    private handleFetchFailure(tovLabel: string, error?: any) {
        this.currentTovKey = "";
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`[TETDP] Fetch failed for TOV "${tovLabel}": ${errorMsg}`, error);
        vscode.window.showErrorMessage(`Failed to fetch test elements for TOV "${tovLabel}".`);
        this.updateMessageCallback(`Error fetching elements for TOV "${tovLabel}". Check logs.`);
        this.updateElements([]);
    }

    public async handleGoToResourceCommand(item: TestElementTreeItem): Promise<void> {
        if (!item || !item.testElementData) {
            return;
        }
        const hierarchicalName = item.getHierarchicalName();
        const absolutePath = await this.resourceFileService.constructAbsolutePath(hierarchicalName);

        if (!absolutePath) {
            vscode.window.showErrorMessage(`Could not determine path for ${item.label}.`);
            return;
        }

        try {
            if (item.testElementData.elementType === "Subdivision") {
                const processedPath = removeRobotResourceFromPathString(absolutePath, this.logger);
                if (item.isFinalSubdivision()) {
                    const resourcePath = appendResourceExtensionAndTrimPathLocal(processedPath, this.logger);
                    const uid = item.getUID();
                    if (!uid) {
                        this.logger.error(`Subdivision ${item.label} has no UID for file content.`);
                        vscode.window.showErrorMessage(`Cannot create file for ${item.label}: Missing Unique ID.`);
                        return;
                    }
                    const initialContent: string = `${fileContentOfRobotResourceSubdivisionFile}${uid}\n\n`;
                    await this.resourceFileService.ensureFileExists(resourcePath, initialContent);
                    await this.resourceFileService.openFileInEditor(resourcePath);
                } else {
                    await this.resourceFileService.ensureFolderPathExists(processedPath);
                    await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(processedPath));
                }
                await this.updateSingleItemIcon(item);
                this._onDidChangeTreeData.fire(item);
            } else if (item.testElementData.elementType === "Interaction") {
                const robotResourceAncestor = item.getRobotResourceAncestor();
                if (!robotResourceAncestor) {
                    const subdivisionAncestor = item.getSubdivisionAncestor();
                    if (subdivisionAncestor) {
                        await this.handleGoToResourceCommand(subdivisionAncestor);
                        return;
                    }
                    vscode.window.showErrorMessage(`Cannot find resource file for interaction '${item.label}'.`);
                    return;
                }
                await this.handleGoToResourceCommand(robotResourceAncestor);
            } else {
                vscode.window.showInformationMessage(`No file action for type: ${item.testElementData.elementType}`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error processing resource for ${item.label}: ${error.message}`);
            this.logger.error(`GoToResource failed for ${item.label}:`, error);
        }
    }

    public async createInteractionUnderSubdivision(
        subdivisionItem: TestElementTreeItem,
        interactionName: string
    ): Promise<TestElementData | null> {
        if (subdivisionItem.testElementData.elementType !== "Subdivision") {
            vscode.window.showErrorMessage("Can only create interactions under subdivisions.");
            return null;
        }
        const newInteractionRaw = {
            name: interactionName,
            elementType: "Interaction",
            uniqueID: `new-interaction-${Date.now()}`,
            parent: {
                serial: subdivisionItem.testElementData.id.split("_")[0],
                uniqueID: subdivisionItem.testElementData.uniqueID
            },
            Interaction_key: { serial: `new-interaction-key-${Date.now()}` }
        };

        const hierarchicalName = subdivisionItem.getHierarchicalName();
        const newInteractionData: TestElementData = {
            id: this.testElementTreeBuilder.generateTestElementTreeItemId(
                newInteractionRaw,
                "Interaction",
                newInteractionRaw.uniqueID
            ),
            parentId: subdivisionItem.testElementData.id,
            name: interactionName,
            uniqueID: newInteractionRaw.uniqueID,
            libraryKey: subdivisionItem.testElementData.libraryKey,
            jsonString: JSON.stringify(newInteractionRaw, null, 2),
            details: newInteractionRaw,
            elementType: "Interaction",
            directRegexMatch: false,
            children: [],
            parent: subdivisionItem.testElementData, // Link to parent TestElementData
            hierarchicalName: `${hierarchicalName}/${interactionName}`
        };

        if (!subdivisionItem.testElementData.children) {
            subdivisionItem.testElementData.children = [];
        }
        subdivisionItem.testElementData.children.push(newInteractionData);
        this.refresh(true);
        return newInteractionData;
    }

    public override clearTree(): void {
        this.currentTovKey = "";
        this.isDataFetchAttempted = false;
        super.clearTree();
        this.updateTreeViewStatusMessage();
        this.logger.trace("[TestElementsTreeDataProvider] Tree cleared.");
    }

    public override async refresh(isHardRefresh: boolean = false): Promise<void> {
        this.logger.debug(`[TETDP] Refresh called. Hard: ${isHardRefresh}, Current TOV: ${this.currentTovKey}`);
        if (!this.currentTovKey) {
            this.clearTree();
            return;
        }
        this.storeExpansionState();
        await this.fetchTestElements(this.currentTovKey);
    }
}
