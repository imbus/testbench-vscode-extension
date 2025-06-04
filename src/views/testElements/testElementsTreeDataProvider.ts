/**
 * @file src/views/testElements/testElementsTreeDataProvider.ts
 * @description Test elements tree data provider using new architecture
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeDataProvider } from "../common/baseTreeDataProvider";
import { TestElementTreeItem, TestElementData } from "./testElementTreeItem";
import { TestElementDataService } from "../../services/testElementDataService";
import { ResourceFileService } from "../../services/resourceFileService";
import { IconManagementService } from "../../services/iconManagementService";
import { TestElementTreeBuilder } from "./testElementTreeBuilder";
import { ConfigKeys } from "../../constants";
import { getExtensionConfiguration } from "../../configuration";

export const fileContentOfRobotResourceSubdivisionFile = `*** Settings ***\nDocumentation    tb:uid:`;

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
        super(extensionContext, logger, updateMessageCallback, {
            contextKey: "testbenchExtension.testElementsTreeHasCustomRoot", // Not used currently
            customRootContextValue: "customRoot.testElement", // Not used currently
            enableCustomRoot: false, // Test elements don't use custom root
            enableExpansionTracking: true
        });

        // Inject services into extension context for tree items
        (this.extensionContext as any).iconManagementService = this.iconManagementService;
        (this.extensionContext as any).resourceFileService = this.resourceFileService;
    }

    /**
     * Get current TOV key
     */
    public getCurrentTovKey(): string {
        return this.currentTovKey;
    }

    /**
     * Set current TOV key
     */
    public setCurrentTovKey(tovKey: string): void {
        this.currentTovKey = tovKey;
    }

    /**
     * Check if tree data is empty
     */
    public isTreeDataEmpty(): boolean {
        return this.rootElements.length === 0;
    }

    /**
     * Update tree view status message based on current state
     */
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
     * Fetch test elements for a TOV key
     */
    public async fetchTestElements(tovKey: string, newTreeViewTitle?: string): Promise<boolean> {
        this.isDataFetchAttempted = true;
        const tovLabel = newTreeViewTitle || tovKey;

        this.logger.debug(`[TestElementsTreeDataProvider] Fetching test elements for TOV: ${tovKey}`);
        this.updateMessageCallback(`Loading test elements for TOV: ${tovLabel}...`);

        // Clear current data and trigger UI update to show loading message
        this.updateElements([]);

        try {
            const testElementsJsonData = await this.testElementDataService.getTestElements(tovKey);

            if (testElementsJsonData) {
                this.currentTovKey = tovKey;
                const treeElements = this.buildTreeFromData(testElementsJsonData);

                // Update icons for subdivision elements based on file existence
                await this.updateSubdivisionIcons(treeElements);

                this.updateElements(treeElements);
                this.updateTreeViewStatusMessage();

                return true;
            } else {
                this.handleFetchTestElementsFailure(tovLabel);
                return false;
            }
        } catch (error) {
            this.handleFetchTestElementsFailure(tovLabel, error);
            return false;
        }
    }

    /**
     * Fetch root elements - builds tree from current data
     */
    protected async fetchRootElements(): Promise<TestElementTreeItem[]> {
        // This provider doesn't fetch from external source for root elements
        // Root elements are set via fetchTestElements method
        return this.rootElements;
    }

    /**
     * Fetch children for an element
     */
    protected async fetchChildrenForElement(element: TestElementTreeItem): Promise<TestElementTreeItem[]> {
        return (element.children as TestElementTreeItem[]) || [];
    }

    /**
     * Create tree item from test element data
     */
    protected createTreeItemFromData(data: TestElementData, parent: TestElementTreeItem | null): TestElementTreeItem {
        return new TestElementTreeItem(data, this.extensionContext, parent);
    }

    /**
     * Build tree structure from flat test element data
     */
    private buildTreeFromData(flatTestElementsJsonData: any[]): TestElementTreeItem[] {
        // Use the existing tree builder to create the hierarchical structure
        const testElementDataArray = this.testElementTreeBuilder.build(flatTestElementsJsonData);

        // Convert to tree items
        return this.convertTestElementDataToTreeItems(testElementDataArray, null);
    }

    /**
     * Convert TestElementData array to tree items recursively
     */
    private convertTestElementDataToTreeItems(
        dataArray: TestElementData[],
        parent: TestElementTreeItem | null
    ): TestElementTreeItem[] {
        const treeItems: TestElementTreeItem[] = [];

        for (const data of dataArray) {
            const treeItem = this.createTreeItemFromData(data, parent);

            // Convert children recursively
            if (data.children && data.children.length > 0) {
                treeItem.children = this.convertTestElementDataToTreeItems(data.children, treeItem);

                // Update collapsible state based on children
                treeItem.collapsibleState = this.customRootService.shouldBeExpanded(treeItem.getUniqueId())
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed;
            }

            treeItems.push(treeItem);
        }

        return treeItems;
    }

    /**
     * Update subdivision icons based on file existence
     */
    private async updateSubdivisionIcons(items: TestElementTreeItem[]): Promise<void> {
        const updateIconsRecursive = async (elements: TestElementTreeItem[]) => {
            for (const item of elements) {
                if (item.testElementData.elementType === "Subdivision") {
                    try {
                        const hierarchicalName = item.getHierarchicalName();
                        const absolutePath = await this.resourceFileService.constructAbsolutePath(hierarchicalName);

                        if (absolutePath) {
                            const isFinal = item.isFinalSubdivision();
                            let pathToCheck = this.removeRobotResourceFromPath(absolutePath);

                            if (isFinal) {
                                pathToCheck = this.appendResourceExtension(pathToCheck);
                            }

                            const exists = await this.resourceFileService.pathExists(pathToCheck);
                            const iconType = exists ? "LocalSubdivision" : "MissingSubdivision";
                            item.updateSubdivisionIcon(iconType);
                        } else {
                            item.updateSubdivisionIcon("MissingSubdivision");
                        }
                    } catch (error) {
                        this.logger.warn(
                            `[TestElementsTreeDataProvider] Error updating icon for ${item.label}:`,
                            error
                        );
                        item.updateSubdivisionIcon("MissingSubdivision");
                    }
                }

                if (item.children) {
                    await updateIconsRecursive(item.children as TestElementTreeItem[]);
                }
            }
        };

        await updateIconsRecursive(items);
    }

    /**
     * Handle "Go To Resource" command
     */
    public async handleGoToResourceCommand(item: TestElementTreeItem): Promise<void> {
        if (!item || !item.testElementData) {
            this.logger.trace("[TestElementsTreeDataProvider] Invalid tree item in Go To Resource command");
            return;
        }

        const hierarchicalName = item.getHierarchicalName();
        const absolutePath = await this.resourceFileService.constructAbsolutePath(hierarchicalName);

        if (!absolutePath) {
            vscode.window.showErrorMessage(`Could not determine path for ${item.label}.`);
            return;
        }

        this.logger.trace(`[TestElementsTreeDataProvider] Go To Resource: ${hierarchicalName} -> ${absolutePath}`);

        try {
            switch (item.testElementData.elementType) {
                case "Subdivision":
                    await this.handleSubdivisionGoToResource(item, absolutePath);
                    break;
                case "Interaction":
                    await this.handleInteractionGoToResource(item, absolutePath);
                    break;
                default:
                    this.logger.warn(`Go To Resource: Element type ${item.testElementData.elementType} not handled`);
                    vscode.window.showInformationMessage(
                        `No specific file action for type: ${item.testElementData.elementType}`
                    );
                    break;
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error in Go To Resource command: ${error.message}`);
            this.logger.error(`Go To Resource command failed for ${item.label}: ${error.message}`);
        }
    }

    /**
     * Handle subdivision go-to-resource logic
     */
    private async handleSubdivisionGoToResource(item: TestElementTreeItem, absolutePath: string): Promise<void> {
        const processedPath = this.removeRobotResourceFromPath(absolutePath);

        try {
            if (item.isFinalSubdivision()) {
                const resourcePath = this.appendResourceExtension(processedPath);
                const uniqueID = item.testElementData.uniqueID;

                if (!uniqueID) {
                    this.logger.error(`Subdivision ${item.label} has no uniqueID. Cannot create file content.`);
                    vscode.window.showErrorMessage(`Cannot create file for ${item.label}: Missing Unique ID.`);
                    return;
                }

                const initialContent = `${fileContentOfRobotResourceSubdivisionFile}${uniqueID}\n`;
                await this.resourceFileService.ensureFileExists(resourcePath, initialContent);
                await this.resourceFileService.openFileInEditor(resourcePath);
            } else {
                await this.resourceFileService.ensureFolderPathExists(processedPath);
                await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(processedPath));
            }

            // Update icon after file operation
            item.updateSubdivisionIcon("LocalSubdivision");
            this._onDidChangeTreeData.fire(item);
        } catch (error: any) {
            this.logger.error(`Subdivision go-to-resource failed for ${item.label}: ${error.message}`, error);
            vscode.window.showErrorMessage(`Failed to handle subdivision ${item.label}: ${error.message}`);
        }
    }

    /**
     * Handle interaction go-to-resource logic
     */
    private async handleInteractionGoToResource(item: TestElementTreeItem, absolutePath: string): Promise<void> {
        this.logger.trace(`Processing interaction: ${item.label} and absolute path: ${absolutePath}`);

        const robotResourceAncestor = item.getRobotResourceAncestor();

        if (!robotResourceAncestor) {
            this.logger.warn(
                `Interaction '${item.testElementData.uniqueID}' has no Robot-Resource ancestor. Trying nearest Subdivision.`
            );
            const subdivisionAncestor = item.getSubdivisionAncestor();

            if (subdivisionAncestor) {
                await this.handleGoToResourceCommand(subdivisionAncestor);
                return;
            } else {
                vscode.window.showErrorMessage(
                    `Cannot determine resource file for interaction '${item.testElementData.name}'. No subdivision ancestor.`
                );
                this.logger.error(`No subdivision ancestor for interaction '${item.testElementData.name}'.`);
                return;
            }
        }
    }

    /**
     * Create new interaction under subdivision
     */
    public async createInteractionUnderSubdivision(
        subdivisionItem: TestElementTreeItem,
        interactionName: string
    ): Promise<TestElementData | null> {
        if (subdivisionItem.testElementData.elementType !== "Subdivision") {
            vscode.window.showErrorMessage("Can only create interactions under subdivisions.");
            return null;
        }

        if (!interactionName || interactionName.trim() === "") {
            vscode.window.showErrorMessage("Interaction name cannot be empty.");
            return null;
        }

        try {
            // Create new interaction data
            const newInteractionRaw = {
                name: interactionName,
                elementType: "Interaction",
                uniqueID: `new-interaction-${Date.now()}`,
                parent: {
                    serial: subdivisionItem.testElementData.id.split("_")[0],
                    uniqueID: subdivisionItem.testElementData.uniqueID
                },
                Interaction_key: {
                    serial: `new-interaction-key-${Date.now()}`
                }
            };

            const interactionData: TestElementData = {
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
                parent: subdivisionItem.testElementData,
                hierarchicalName: `${subdivisionItem.getHierarchicalName()}/${interactionName}`
            };

            // Add to subdivision's children
            if (!subdivisionItem.testElementData.children) {
                subdivisionItem.testElementData.children = [];
            }
            subdivisionItem.testElementData.children.push(interactionData);

            // Create tree item and add to subdivision's children
            const newTreeItem = this.createTreeItemFromData(interactionData, subdivisionItem);
            if (!subdivisionItem.children) {
                subdivisionItem.children = [];
            }
            (subdivisionItem.children as TestElementTreeItem[]).push(newTreeItem);

            // Update subdivision's collapsible state
            subdivisionItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;

            this._onDidChangeTreeData.fire(subdivisionItem);

            this.logger.debug(
                `Created new interaction '${interactionName}' under subdivision '${subdivisionItem.testElementData.name}'`
            );
            return interactionData;
        } catch (error) {
            this.logger.error("Error creating interaction:", error);
            vscode.window.showErrorMessage("Failed to create interaction: " + (error as Error).message);
            return null;
        }
    }

    /**
     * Handle test elements fetch failure
     */
    private handleFetchTestElementsFailure(tovLabel: string, error?: any): void {
        this.currentTovKey = "";
        const errorMessage = error instanceof Error ? error.message : "Unknown error during fetch";

        this.logger.error(`Failed to fetch test elements for TOV "${tovLabel}": ${errorMessage}`, error);
        vscode.window.showErrorMessage(`Failed to fetch test elements for TOV "${tovLabel}".`);

        this.updateMessageCallback(`Error fetching elements for TOV "${tovLabel}". Check logs or try again.`);
        this.updateElements([]);
    }

    /**
     * Remove [Robot-Resource] from path string
     */
    private removeRobotResourceFromPath(pathStr: string): string {
        return pathStr.replace(/\[Robot-Resource\]/g, "");
    }

    /**
     * Append .resource extension and trim path
     */
    private appendResourceExtension(baseTargetPath: string): string {
        let targetPath = baseTargetPath.endsWith(".resource") ? baseTargetPath : baseTargetPath + ".resource";

        // Remove whitespace before .resource and trim
        targetPath = targetPath.replace(/\s+(\.resource)$/, "$1").replace(/\s+$/, "");

        // Remove whitespace from beginning
        targetPath = targetPath.replace(/^\s+/, "");

        return targetPath;
    }

    /**
     * Override clear tree to reset TOV key
     */
    public clearTree(): void {
        this.currentTovKey = "";
        this.isDataFetchAttempted = false;
        super.clearTree();
        this.updateTreeViewStatusMessage();
    }

    /**
     * Override refresh to handle current TOV
     */
    public refresh(isHardRefresh: boolean = false): void {
        this.logger.debug(`[TestElementsTreeDataProvider] Refreshing. Hard refresh: ${isHardRefresh}`);

        if (!this.currentTovKey) {
            this.clearTree();
            return;
        }

        // Re-fetch test elements for current TOV
        this.fetchTestElements(this.currentTovKey);
    }
}
