/**
 * @file src/views/testElements/testElementsTreeDataProvider.ts
 * @description Test elements tree data provider
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeDataProvider, TreeDataProviderOptions } from "../common/baseTreeDataProvider";
import { TestElementTreeItem, TestElementData } from "./testElementTreeItem";
import { TestElementDataService } from "./testElementDataService";
import { ResourceFileService } from "./resourceFileService";
import { TestElementTreeBuilder } from "./testElementTreeBuilder";
import { IconManagementService } from "../common/iconManagementService";
import { TreeViewType, TreeViewEmptyState, TreeViewOperationalState } from "../common/treeViewStateTypes";
import { CancellableOperation, CancellableOperationManager } from "../../services/cancellableOperationService";
import { StateChangeNotification } from "../common/unifiedTreeStateManager";
import { testElementsTreeViewID } from "../../constants";

export const fileContentOfRobotResourceSubdivisionFile = `tb:uid:`;

/**
 * Appends `.resource` extension to a file path if not already present and normalizes the path by trimming whitespace.
 */
function appendResourceExtensionAndTrimPathLocal(baseTargetPath: string, logger: TestBenchLogger): string {
    // logger.trace(`Adding .resource extension and trimming path: ${baseTargetPath}`);
    let targetPath = baseTargetPath.endsWith(".resource") ? baseTargetPath : `${baseTargetPath}.resource`;
    targetPath = targetPath.replace(/\s+(\.resource)$/, "$1").trimEnd();
    targetPath = targetPath.trimStart();
    logger.trace(`Normalized path: ${targetPath}`);
    return targetPath;
}

/**
 * Removes all occurrences of "[Robot-Resource]" from a given path string.
 */
function removeRobotResourceFromPathString(pathStr: string, logger: TestBenchLogger): string {
    const cleanedPath: string = pathStr.replace(/\[Robot-Resource\]/g, "");
    logger.trace(`[removeRobotResourceFromPathString] Removed [Robot-Resource] from path ${pathStr}: ${cleanedPath}`);
    return cleanedPath;
}

export class TestElementsTreeDataProvider extends BaseTreeDataProvider<TestElementTreeItem> {
    private currentTovKey: string = "";
    private readonly operationManager: CancellableOperationManager;

    // Operation IDs for different background tasks
    private static readonly ICON_UPDATE_OPERATION = "iconUpdate";
    private static readonly FETCH_OPERATION = "fetchTestElements";

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
            enableExpansionTracking: true,
            stateConfig: {
                treeViewId: testElementsTreeViewID,
                treeViewType: TreeViewType.TEST_ELEMENTS,
                noDataSourceMessage:
                    "Select a Test Object Version (TOV) from the 'Projects' view to load test elements.",
                loadingMessageTemplate: "Loading test elements for {dataSource}..."
            }
        };
        super(extensionContext, logger, updateMessageCallback, providerOptions);
        this.operationManager = new CancellableOperationManager(logger);
        this.logger.trace("[TestElementsTreeDataProvider] Initialized with unified state management");
    }

    /**
     * Handle unified state changes for better coordination
     */
    protected override onUnifiedStateChange(notification: StateChangeNotification): void {
        super.onUnifiedStateChange(notification);

        if (notification.changedFields.includes("operationalState")) {
            this.logger.trace(
                `[TestElementsTreeDataProvider] Operational state changed to: ${notification.newState.operationalState}`
            );
        }
    }

    public getCurrentTovKey(): string {
        return this.currentTovKey;
    }

    /**
     * Sets the current TOV key and optionally the display name for user-facing messages
     */
    public setCurrentTovKey(tovKey: string, displayName?: string): void {
        this.currentTovKey = tovKey;
        this.getUnifiedStateManager().setDataSource(tovKey, displayName || tovKey, displayName || tovKey);
    }

    public isTreeDataEmpty(): boolean {
        return this.rootTreeItems.length === 0;
    }

    /**
     * Updates the tree view status message using the unified state manager
     */
    public updateTreeViewStatusMessage(): void {
        const currentState = this.getUnifiedStateManager().getCurrentUnifiedState();
        this.logger.trace(
            `[TestElementsTreeDataProvider] Current state: ${currentState.operationalState}, Empty state: ${currentState.emptyState}`
        );
    }

    /**
     * Handles tree item expansion/collapse events to maintain state.
     */
    public handleItemExpansion(testElementTreeItem: TestElementTreeItem, expanded: boolean): void {
        this.logger.trace(
            `[TestElementsTreeDataProvider] Item ${testElementTreeItem.label} expansion changed to: ${expanded}`
        );
        this.handleExpansion(testElementTreeItem, expanded);
    }

    /**
     * Fetches test elements for a given TOV key and rebuilds the tree while preserving expansion state.
     */
    public async fetchTestElements(tovKey: string, newTreeViewTitle?: string): Promise<boolean> {
        this.operationManager.cancelOperation(TestElementsTreeDataProvider.FETCH_OPERATION);

        const operation = this.operationManager.createOperation(
            TestElementsTreeDataProvider.FETCH_OPERATION,
            `Fetch test elements for TOV: ${tovKey}`
        );

        const tovLabel = newTreeViewTitle || tovKey;
        try {
            this.logger.debug(`[TestElementsTreeDataProvider] Fetching test elements for TOV: ${tovKey}`);

            const tovDisplayName = newTreeViewTitle || tovKey;

            // Single coordinated state update through unified manager
            this.getUnifiedStateManager().updateState({
                dataSourceKey: tovKey,
                dataSourceLabel: tovLabel,
                dataSourceDisplayName: tovDisplayName,
                operationalState: TreeViewOperationalState.LOADING,
                metadata: { loadingMessage: `Loading test elements for TOV: ${tovLabel}...` }
            });

            const isRefreshingSameTov = this.currentTovKey === tovKey;
            if (isRefreshingSameTov && this.rootTreeItems.length > 0) {
                this.storeExpansionState();
            }

            this.updateTreeItem([]);

            operation.throwIfCancelled("before data fetch");

            const rawtestElementsJsonData = await this.testElementDataService.getTestElements(tovKey);

            operation.throwIfCancelled("after data fetch");

            if (rawtestElementsJsonData) {
                this.currentTovKey = tovKey;

                if (rawtestElementsJsonData.length === 0) {
                    // Coordinated state update for empty server data
                    this.getUnifiedStateManager().updateState({
                        hasDataFetchBeenAttempted: true,
                        isServerDataReceived: true,
                        itemsBeforeFiltering: 0,
                        itemsAfterFiltering: 0,
                        operationalState: TreeViewOperationalState.EMPTY,
                        emptyState: TreeViewEmptyState.SERVER_NO_DATA
                    });
                    this.updateTreeItem([]);
                    return true;
                }

                operation.throwIfCancelled("before tree building");

                const hierarchicalData: TestElementData[] = this.testElementTreeBuilder.build(rawtestElementsJsonData);
                const treeItems: TestElementTreeItem[] = this.convertHierarchicalDataToTreeItems(
                    hierarchicalData,
                    null
                );

                operation.throwIfCancelled("before tree update");

                // Coordinated state update for successful fetch
                this.getUnifiedStateManager().updateState({
                    hasDataFetchBeenAttempted: true,
                    isServerDataReceived: true,
                    itemsBeforeFiltering: rawtestElementsJsonData.length,
                    itemsAfterFiltering: treeItems.length,
                    operationalState:
                        treeItems.length === 0 ? TreeViewOperationalState.EMPTY : TreeViewOperationalState.READY,
                    emptyState: treeItems.length === 0 ? TreeViewEmptyState.FILTERED_OUT : undefined
                });

                // Update basic icons immediately
                this.updateBasicIcons(treeItems);
                this.updateTreeItem(treeItems);

                // Start background icon updates with cancellation support
                this.updateSubdivisionIconsInBackground(treeItems, operation);

                return true;
            } else {
                this.handleFetchFailure(tovLabel);
                return false;
            }
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                this.logger.debug(`[TestElementsTreeDataProvider] Fetch operation cancelled for TOV: ${tovKey}`);
                return false;
            }

            this.handleFetchFailure(tovLabel, error as Error);
            return false;
        }
    }

    /**
     * Updates the basic icons for test element tree items recursively.
     */
    private updateBasicIcons(items: TestElementTreeItem[]): void {
        const updateRecursive = (items: TestElementTreeItem[]) => {
            for (const item of items) {
                if (item.testElementData.testElementType !== "Subdivision") {
                    item.updateIcon();
                } else {
                    // Set default subdivision icon without file check
                    item.updateSubdivisionIcon("MissingSubdivision");
                }
                if (item.children) {
                    updateRecursive(item.children as TestElementTreeItem[]);
                }
            }
        };
        updateRecursive(items);
    }

    /**
     * Updates subdivision tree item icons in the background using batched processing.
     */
    private async updateSubdivisionIconsInBackground(
        items: TestElementTreeItem[],
        operation: CancellableOperation
    ): Promise<void> {
        // Cancel any existing icon update operation
        this.operationManager.cancelOperation(TestElementsTreeDataProvider.ICON_UPDATE_OPERATION);

        try {
            const subdivisionItems: TestElementTreeItem[] = [];
            const collectSubdivisions = (items: TestElementTreeItem[]) => {
                for (const item of items) {
                    if (operation.isCancelled) {
                        return;
                    }

                    if (item.testElementData.testElementType === "Subdivision") {
                        subdivisionItems.push(item);
                    }
                    if (item.children) {
                        collectSubdivisions(item.children as TestElementTreeItem[]);
                    }
                }
            };

            collectSubdivisions(items);

            // Process in batches with cancellation checks
            const batchSize = 10;
            const totalBatches = Math.ceil(subdivisionItems.length / batchSize);

            this.logger.trace(
                `[TestElementsTreeDataProvider] Starting background icon update for ${subdivisionItems.length} subdivisions in ${totalBatches} batches`
            );

            for (let i = 0; i < subdivisionItems.length; i += batchSize) {
                // Check for cancellation before each batch
                operation.throwIfCancelled(`batch ${Math.floor(i / batchSize) + 1}/${totalBatches}`);

                const batch = subdivisionItems.slice(i, i + batchSize);

                // Process batch with error handling
                await Promise.allSettled(batch.map((item) => this.updateSingleItemIconSafely(item, operation)));

                // Check for cancellation before UI update
                operation.throwIfCancelled("before UI update");

                // Fire update event for this batch
                this._onDidChangeTreeData.fire(undefined);

                // Small delay between batches to keep UI responsive
                if (i + batchSize < subdivisionItems.length) {
                    await operation.delay(10);
                }
            }

            this.logger.trace(
                `[TestElementsTreeDataProvider] Completed background icon update for ${subdivisionItems.length} subdivisions`
            );
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                this.logger.debug(`[TestElementsTreeDataProvider] Background icon update cancelled`);
            } else {
                this.logger.error(`[TestElementsTreeDataProvider] Error during background icon update:`, error);
            }
        }
    }

    /**
     * Safely updates a single item icon with error handling and cancellation
     */
    private async updateSingleItemIconSafely(
        item: TestElementTreeItem,
        operation: CancellableOperation
    ): Promise<void> {
        try {
            operation.throwIfCancelled(`icon update for ${item.label}`);

            if (item.isDisposed) {
                this.logger.trace(
                    `[TestElementsTreeDataProvider] Skipping icon update for disposed item: ${item.label}`
                );
                return;
            }

            await this.updateSingleItemIcon(item);
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }

            this.logger.error(`[TestElementsTreeDataProvider] Error updating icon for item ${item.label}:`, error);
            // Continue with other items despite individual failures
        }
    }

    /**
     * Converts hierarchical test element data to tree items with proper expansion state handling.
     */
    private convertHierarchicalDataToTreeItems(
        dataArray: TestElementData[],
        parent: TestElementTreeItem | null
    ): TestElementTreeItem[] {
        try {
            return dataArray.map((data) => {
                const treeItem = this.createTestThemeTreeItemFromData(data, parent);
                if (data.children && data.children.length > 0) {
                    treeItem.children = this.convertHierarchicalDataToTreeItems(data.children, treeItem);
                    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

                    this.applyStoredExpansionState(treeItem);
                } else {
                    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
                }
                return treeItem;
            });
        } catch (error) {
            this.logger.error(
                `[TestElementsTreeDataProvider] Error converting hierarchical data to tree items:`,
                error
            );
            this.getUnifiedStateManager().setError(error as Error, TreeViewEmptyState.PROCESSING_ERROR);
            throw error;
        }
    }

    /**
     * Updates the icon for a single test element tree item based on its type and file existence.
     */
    private async updateSingleItemIcon(item: TestElementTreeItem): Promise<void> {
        const treeItemData = item.testElementData;
        if (treeItemData.testElementType === "Subdivision") {
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

    /**
     * Fetches the root test elements for the tree view.
     */
    protected async fetchRootTreeItems(): Promise<TestElementTreeItem[]> {
        return this.rootTreeItems;
    }

    /**
     * Retrieves the child elements for a given test element tree item.
     */
    protected async fetchChildrenForTreeItem(treeItem: TestElementTreeItem): Promise<TestElementTreeItem[]> {
        return (treeItem.children as TestElementTreeItem[]) || [];
    }

    /**
     * Creates a tree item from test element data with proper state initialization.
     */
    protected createTestThemeTreeItemFromData(
        data: TestElementData,
        parent: TestElementTreeItem | null
    ): TestElementTreeItem {
        const item = new TestElementTreeItem(
            data,
            this.extensionContext,
            this.logger,
            this.iconManagementService,
            parent
        );
        this.logger.trace(`[TestElementsTreeDataProvider] Created tree item.`);

        this.applyStoredExpansionState(item);
        return item;
    }

    /**
     * Handles failures when fetching test elements for a TOV.
     */
    private handleFetchFailure(tovLabel: string, error?: Error): void {
        this.currentTovKey = "";
        const errorMsg = error ? error.message : "Unknown error";
        this.logger.error(`[TestElementsTreeDataProvider] Fetch failed for TOV "${tovLabel}": ${errorMsg}`, error);

        this.getUnifiedStateManager().setError(error || new Error(errorMsg), TreeViewEmptyState.FETCH_ERROR);
        vscode.window.showErrorMessage(`Failed to fetch test elements for TOV "${tovLabel}".`);
        this.updateTreeItem([]);
    }

    /**
     * Updates the tree elements and applies expansion state tracking if enabled.
     */
    protected override updateTreeItem(treItems: TestElementTreeItem[]): void {
        this.rootTreeItems = treItems;

        if (this.options.enableExpansionTracking && treItems.length > 0) {
            const applyExpansionRecursive = (items: TestElementTreeItem[]) => {
                for (const item of items) {
                    this.applyStoredExpansionState(item);
                    if (item.children) {
                        applyExpansionRecursive(item.children as TestElementTreeItem[]);
                    }
                }
            };
            applyExpansionRecursive(treItems);
        }

        this._onDidChangeTreeData.fire(undefined);

        if (treItems.length !== 0) {
            this.getUnifiedStateManager().updateState({
                operationalState: TreeViewOperationalState.READY
            });
        }
    }

    /**
     * Handles the "Go to Resource" command for a test element tree item.
     */
    public async handleGoToResourceCommand(treeItem: TestElementTreeItem): Promise<void> {
        if (!treeItem || !treeItem.testElementData) {
            return;
        }
        const hierarchicalName = treeItem.getHierarchicalName();
        const absolutePath = await this.resourceFileService.constructAbsolutePath(hierarchicalName);

        if (!absolutePath) {
            vscode.window.showErrorMessage(`Could not determine path for ${treeItem.label}.`);
            return;
        }

        try {
            if (treeItem.testElementData.testElementType === "Subdivision") {
                const processedPath = removeRobotResourceFromPathString(absolutePath, this.logger);
                if (treeItem.isFinalSubdivision()) {
                    const resourcePath = appendResourceExtensionAndTrimPathLocal(processedPath, this.logger);
                    const uid = treeItem.getUID();
                    if (!uid) {
                        this.logger.error(`Subdivision ${treeItem.label} has no UID for file content.`);
                        vscode.window.showErrorMessage(`Cannot create file for ${treeItem.label}: Missing Unique ID.`);
                        return;
                    }
                    const initialContent: string = `${fileContentOfRobotResourceSubdivisionFile}${uid}\n\n`;
                    await this.resourceFileService.ensureFileExists(resourcePath, initialContent);
                    await this.resourceFileService.openFileInEditor(resourcePath);
                } else {
                    await this.resourceFileService.ensureFolderPathExists(processedPath);
                    await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(processedPath));
                }
                await this.updateSingleItemIcon(treeItem);
                this._onDidChangeTreeData.fire(treeItem);
            } else if (treeItem.testElementData.testElementType === "Interaction") {
                const robotResourceAncestor = treeItem.getRobotResourceAncestor();
                if (!robotResourceAncestor) {
                    const subdivisionAncestor = treeItem.getSubdivisionAncestor();
                    if (subdivisionAncestor) {
                        await this.handleGoToResourceCommand(subdivisionAncestor);
                        return;
                    }
                    vscode.window.showErrorMessage(`Cannot find resource file for interaction '${treeItem.label}'.`);
                    return;
                }
                await this.handleGoToResourceCommand(robotResourceAncestor);
            } else {
                vscode.window.showInformationMessage(
                    `No file action for type: ${treeItem.testElementData.testElementType}`
                );
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error processing resource for ${treeItem.label}: ${error.message}`);
            this.logger.error(`GoToResource failed for ${treeItem.label}:`, error);
        }
    }

    /**
     * Creates a new interaction element under a subdivision in the test element tree.
     */
    public async createInteractionUnderSubdivision(
        subdivisionItem: TestElementTreeItem,
        interactionName: string
    ): Promise<TestElementData | null> {
        if (subdivisionItem.testElementData.testElementType !== "Subdivision") {
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
            testElementType: "Interaction",
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

    /**
     * Clears the tree data and resets the provider state using unified state management.
     */
    public override clearTree(): void {
        this.logger.trace("[TestElementsTreeDataProvider] Clearing tree and cancelling operations");

        // Cancel all background operations before clearing
        this.operationManager.cancelAllOperations();

        // Dispose existing tree items
        this.rootTreeItems.forEach((item) => {
            try {
                item.dispose();
            } catch (error) {
                this.logger.error(`[TestElementsTreeDataProvider] Error disposing tree item during clear:`, error);
            }
        });

        this.currentTovKey = "";
        super.clearTree();
    }

    /**
     * Dispose of the provider and all resources
     */
    public override dispose(): void {
        this.logger.trace("[TestElementsTreeDataProvider] Disposing provider");

        // Cancel all operations
        this.operationManager.dispose();

        // Dispose all tree items
        this.rootTreeItems.forEach((item) => {
            try {
                item.dispose();
            } catch (error) {
                this.logger.error(`[TestElementsTreeDataProvider] Error disposing tree item:`, error);
            }
        });

        super.dispose();
    }

    /**
     * Refreshes the test elements tree data provider using unified state management.
     */
    public override async refresh(isHardRefresh: boolean = false): Promise<void> {
        this.logger.debug(
            `[TestElementsTreeDataProvider] Refresh called. Hard: ${isHardRefresh}, Current TOV: ${this.currentTovKey}`
        );
        if (!this.currentTovKey) {
            this.clearTree();
            return;
        }
        this.storeExpansionState();

        const currentState = this.getUnifiedStateManager().getCurrentUnifiedState();
        const storedDisplayName = currentState.dataSourceDisplayName;

        const displayNameForRefresh =
            storedDisplayName && storedDisplayName !== this.currentTovKey ? storedDisplayName : undefined;

        await this.fetchTestElements(this.currentTovKey, displayNameForRefresh);
    }

    /**
     * Gets diagnostic information about the current tree state
     */
    public getDiagnostics(): Record<string, any> {
        return {
            currentTovKey: this.currentTovKey,
            rootTreeItemsCount: this.rootTreeItems.length,
            isTreeEmpty: this.isTreeDataEmpty(),
            unifiedStateDiagnostics: this.getUnifiedStateManager().getDiagnostics(),
            timestamp: new Date().toISOString()
        };
    }
}
