/**
 * @file src/treeViews/implementations/testElements/TestElementsTreeView.ts
 * @description Tree view implementation for managing test elements.
 */

import * as vscode from "vscode";
import { TreeViewBase } from "../../core/TreeViewBase";
import { TestElementData, TestElementItemData, TestElementsTreeItem, TestElementType } from "./TestElementsTreeItem";
import { TreeViewConfig } from "../../core/TreeViewConfig";
import { TestElementsDataProvider } from "./TestElementsDataProvider";
import { testElementsConfig } from "./TestElementsConfig";
import { PlayServerConnection } from "../../../testBenchConnection";
import { ResourceFileService, ResourceOperationConfig } from "./ResourceFileService";
import { ContextKeys, TestElementItemTypes } from "../../../constants";
import { FilterService } from "../../utils/FilterService";
import { treeViews } from "../../../extension";
import { ClickHandler } from "../../core/ClickHandler";
import { findInteractionPositionInResourceFile } from "../../../server";

export class TestElementsTreeView extends TreeViewBase<TestElementsTreeItem> {
    private dataProvider: TestElementsDataProvider;
    private disposables: vscode.Disposable[] = [];
    private currentTovKey: string | null = null;
    private currentTovLabel: string | null = null;
    private currentProjectName: string | null = null;
    private currentTovName: string | null = null;
    private resourceFiles: Map<string, string[]> = new Map();
    private resourceFileService: ResourceFileService;
    private filterService: FilterService;
    private interactionClickHandler: ClickHandler<TestElementsTreeItem>;

    constructor(
        extensionContext: vscode.ExtensionContext,
        private getConnection: () => PlayServerConnection | null,
        config?: Partial<TreeViewConfig>
    ) {
        const fullConfig = { ...testElementsConfig, ...config };
        super(extensionContext, fullConfig);

        this.dataProvider = new TestElementsDataProvider(this.logger, getConnection, this.eventBus);
        this.resourceFileService = new ResourceFileService(this.logger);
        this.filterService = FilterService.getInstance();
        this.interactionClickHandler = new ClickHandler<TestElementsTreeItem>();

        this.registerEventHandlers();
        this.setupInteractionClickHandlers();
    }

    /**
     * Sets up click handlers for interaction items using the generalized click handler
     */
    private setupInteractionClickHandlers(): void {
        this.interactionClickHandler.updateHandlers({
            onSingleClick: async (item: TestElementsTreeItem) => {
                if (item.data.testElementType === TestElementType.Interaction) {
                    await this.handleInteractionSingleClick(item);
                }
            },
            onDoubleClick: async (item: TestElementsTreeItem) => {
                if (item.data.testElementType === TestElementType.Interaction) {
                    await this.handleInteractionDoubleClick(item);
                }
            }
        });
    }

    /**
     * Registers event handlers (listeners) for various tree view events.
     */
    private registerEventHandlers(): void {
        this.eventBus.on("testElements:fetched", (event) => {
            const { tovKey, count } = event.data;
            if (tovKey === this.currentTovKey) {
                this.logger.debug(
                    `[TestElementsTreeView] Received test elements fetched event for TOV ${tovKey} with ${count} elements`
                );
            }
        });

        this.eventBus.on("testElements:error", (event) => {
            const { tovKey, error } = event.data;
            if (tovKey === this.currentTovKey) {
                this.logger.error(
                    `[TestElementsTreeView] Received test elements error event for TOV ${tovKey}: ${error}`
                );
            }
        });

        this.eventBus.on("tov:loaded", async (event) => {
            const { tovKey, tovLabel } = event.data;
            if (tovKey && tovKey !== this.currentTovKey) {
                this.logger.debug(`[TestElementsTreeView] Received TOV loaded event for TOV ${tovKey}`);
                await this.loadTov(
                    tovKey,
                    tovLabel,
                    this.currentProjectName || undefined,
                    this.currentTovName || undefined
                );
            }
        });

        this.eventBus.on("connection:changed", async (event) => {
            const { connected } = event.data;
            if (connected && this.currentTovKey) {
                this.refresh();
            } else if (!connected) {
                this.clearTree();
            }
        });

        this.eventBus.on("testElement:updated", (event) => {
            const { item } = event.data;
            if (item) {
                this.refreshItemWithParents(item);
            }
        });

        /*
        // Listen for interaction selection events and handle double click detection
        this.eventBus.on("interaction:selected", async (event) => {
            const { item } = event.data;
            if (item && item.data.testElementType === TestElementType.Interaction) {
                await this.handleInteractionClick(item);
            }
        });
        */
    }

    /**
     * Refreshes a specific tree item and all of its parent items.
     * @param item The item to start the refresh from.
     */
    private refreshItemWithParents(item: TestElementsTreeItem): void {
        this._onDidChangeTreeData.fire(item);
        let parent = item.parent as TestElementsTreeItem | null;
        while (parent) {
            this._onDidChangeTreeData.fire(parent);
            parent = parent.parent as TestElementsTreeItem | null;
        }
    }

    /**
     * Loads test elements data.
     *
     * @param tovKey - The unique identifier for the TOV to load.
     * @param tovLabel - Optional label for the TOV to display in the title.
     * @param projectName - The name of the project containing the TOV.
     * @param tovName - The name of the TOV.
     * @param preserveExistingData - Whether to preserve existing data during loading.
     * @returns Promise that resolves when the TOV data is loaded.
     */
    private async loadTovWithProgress(
        tovKey: string,
        tovLabel?: string,
        projectName?: string,
        tovName?: string,
        preserveExistingData: boolean = false
    ): Promise<void> {
        const startTime = Date.now();
        this.logger.debug(`[TestElementsTreeView] Loading TOV with key ${tovKey}`);

        try {
            if (!preserveExistingData) {
                this.stateManager.setLoading(true);
            }

            const fetchedHierarchicalTestElements = await this.dataProvider.fetchTestElements(tovKey);
            const newRootItems = fetchedHierarchicalTestElements.map((element) => this._buildTreeItems(element));

            this.rootItems = newRootItems;
            this.currentTovKey = tovKey;
            this.currentTovLabel = tovLabel || null;
            this.currentProjectName = projectName || null;
            this.currentTovName = tovName || null;
            this.resourceFiles.clear();

            // Update title with format: Test Elements (Project Name, TOV Name)
            const titleParts = ["Test Elements"];
            if (projectName) {
                titleParts.push(projectName);
            }
            if (tovName) {
                titleParts.push(tovName);
            }

            if (titleParts.length > 1) {
                this.updateTitle(`${titleParts[0]} (${titleParts.slice(1).join(", ")})`);
            } else {
                this.updateTitle(titleParts[0]);
            }

            (this as any)._lastDataFetch = Date.now();
            (this as any)._intentionallyCleared = false;
            this.stateManager.setLoading(false);

            this._onDidChangeTreeData.fire(undefined);
            this.updateSubdivisionIcons(newRootItems);

            const loadTime = Date.now() - startTime;
            this.logger.debug(
                `[TestElementsTreeView] Successfully loaded ${newRootItems.length} test elements for TOV with key ${tovKey} in ${loadTime}ms`
            );

            this.eventBus.emit({
                type: "tov:loaded",
                source: this.config.id,
                data: {
                    tovKey,
                    tovLabel: this.currentTovLabel,
                    loadTime
                },
                timestamp: Date.now()
            });
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Error loading TOV with key ${tovKey}:`, error);
            this.stateManager.setLoading(false);
            this.stateManager.setError(error as Error);
            throw error;
        }
    }

    /**
     * Loads test elements for a specific TOV (Test Object Version).
     *
     * @param tovKey - The unique identifier for the TOV to load.
     * @param tovLabel - Optional label for the TOV to display in the title.
     * @param projectName - The name of the project containing the TOV.
     * @param tovName - The name of the TOV.
     * @param clearFirst - Whether to clear the tree before loading new data. Defaults to true.
     * @returns Promise that resolves when the TOV is loaded.
     */
    public async loadTov(
        tovKey: string,
        tovLabel?: string,
        projectName?: string,
        tovName?: string,
        clearFirst: boolean = true
    ): Promise<void> {
        try {
            this.logger.debug(
                `[TestElementsTreeView] Loading TOV with key ${tovKey}${clearFirst ? " (clearing first)" : " (preserving existing data)"}`
            );

            if (clearFirst || this.currentTovKey !== tovKey) {
                this.clearTree();
            }

            this.dataProvider.clearCache(tovKey); // Only clear cache for this specific TOV

            this.currentTovKey = tovKey;
            this.currentTovLabel = tovLabel || null;
            this.currentProjectName = projectName || null;
            this.currentTovName = tovName || null;
            this.resourceFiles.clear();

            // Update title with format: Test Elements (Project Name, TOV Name)
            const titleParts = ["Test Elements"];
            if (projectName) {
                titleParts.push(projectName);
            }
            if (tovName) {
                titleParts.push(tovName);
            }

            if (titleParts.length > 1) {
                this.updateTitle(`${titleParts[0]} (${titleParts.slice(1).join(", ")})`);
            } else {
                this.updateTitle(titleParts[0]);
            }

            const fetchedHierarchicalTestElements = await this.dataProvider.fetchTestElements(tovKey);

            this.rootItems = fetchedHierarchicalTestElements.map((element) => this._buildTreeItems(element));

            await this.updateSubdivisionIcons(this.rootItems);

            // Set the last data fetch timestamp to prevent infinite loading
            // This is important even for empty results to prevent the tree from continuously trying to load data
            (this as any)._lastDataFetch = Date.now();
            (this as any)._intentionallyCleared = false;
            this._onDidChangeTreeData.fire(undefined);
            (this as any).updateTreeViewMessage();

            this.eventBus.emit({
                type: "tov:loaded",
                source: this.config.id,
                data: {
                    tovKey,
                    tovLabel: this.currentTovLabel
                },
                timestamp: Date.now()
            });
            this.logger.info(`[TestElementsTreeView] Successfully loaded test elements for TOV ${tovKey}`);
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Error loading TOV:`, error);

            this.rootItems = [];
            (this as any)._lastDataFetch = Date.now();
            (this as any)._intentionallyCleared = false;
            this._onDidChangeTreeData.fire(undefined);
            (this as any).updateTreeViewMessage();

            this.logger.error("[TestElementsTreeView] Failed to load test elements", error as Error);
            throw error;
        }
    }

    /**
     * Clears the tree view and resets all associated state.
     */
    public clearTree(): void {
        super.clearTree();
        this.currentTovKey = null;
        this.currentTovLabel = null;
        this.currentProjectName = null;
        this.currentTovName = null;
        this.resourceFiles.clear();
        this.resetTitle();
    }

    /**
     * Recursively builds tree items from hierarchical test element data.
     *
     * @param data - The test element data to build the tree item from
     * @param parent - Optional parent tree item
     * @returns The constructed tree item with its children
     */
    private _buildTreeItems(data: TestElementData, parent?: TestElementsTreeItem): TestElementsTreeItem {
        const item = this.createTreeItem(data, parent);
        if (data.children && data.children.length > 0) {
            const childItems = data.children.map((childData) => this._buildTreeItems(childData, item));
            item.children = childItems;
        }

        return item;
    }

    /**
     * Fetches and builds the root items for the test elements tree view.
     *
     * @returns Promise that resolves to an array of root tree items
     */
    protected async fetchRootItems(): Promise<TestElementsTreeItem[]> {
        if (!this.currentTovKey) {
            this.logger.debug("[TestElementsTreeView] TOV key not set, cannot fetch root items");
            return [];
        }

        if (this.rootItems.length > 0) {
            const dataIsFresh = Date.now() - (this as any)._lastDataFetch < 60000;
            if (dataIsFresh) {
                this.logger.debug(
                    `[TestElementsTreeView] Returning cached root items for TOV with key ${this.currentTovKey}`
                );
                return this.rootItems;
            }
        }

        try {
            const hierarchicalTestElementsData = await this.dataProvider.fetchTestElements(this.currentTovKey);
            const rootTestElementItems = hierarchicalTestElementsData.map((data) => this._buildTreeItems(data));

            this.rootItems = rootTestElementItems;
            (this as any)._lastDataFetch = Date.now();

            // Async icon updates to avoid blocking UI
            this.updateSubdivisionIcons(rootTestElementItems).then(() => {
                this._onDidChangeTreeData.fire(undefined);
            });

            return rootTestElementItems;
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Failed to fetch root tree items and build tree items:`, error);
            return [];
        }
    }

    /**
     * Updates all subdivision icons by checking for their existence on the local file system
     * @param items Array of tree items to process
     * @returns Promise that resolves when all icon updates are complete
     */
    private async updateSubdivisionIcons(items: TestElementsTreeItem[]): Promise<void> {
        const subdivisionItems: TestElementsTreeItem[] = [];
        const collectSubdivisions = (currentItems: TestElementsTreeItem[]) => {
            for (const item of currentItems) {
                if (item.data.testElementType === TestElementType.Subdivision) {
                    subdivisionItems.push(item);
                }
                if (item.children) {
                    collectSubdivisions(item.children as TestElementsTreeItem[]);
                }
            }
        };
        collectSubdivisions(items);

        // Process file checks in parallel for all subdivisions.
        await Promise.all(
            subdivisionItems.map(async (item) => {
                try {
                    const hierarchicalName = item.data.hierarchicalName;
                    if (hierarchicalName) {
                        const isResourceFile = hierarchicalName.includes("[Robot-Resource]");
                        const cleanName = hierarchicalName.replace(/\[Robot-Resource\]/g, "").trim();
                        let resourcePath = await this.resourceFileService.constructAbsolutePath(cleanName);

                        if (resourcePath) {
                            if (isResourceFile && !resourcePath.endsWith(".resource")) {
                                resourcePath += ".resource";
                            }
                            const exists = await this.resourceFileService.pathExists(resourcePath);
                            item.updateLocalAvailability(exists, resourcePath);
                        }
                    }
                } catch (error) {
                    this.logger.error(
                        `[TestElementsTreeView] Error updating subdivision icon for tree item ${item.label}:`,
                        error
                    );
                }
            })
        );
    }

    /**
     * Updates the icons of parent items in the tree hierarchy.
     * This is called when a resource file is created or opened to update parent tree item icons
     * to reflect their availability in tree view.
     * @param item The tree item whose parents should be updated
     * @returns Promise that resolves when all parent icon updates are complete
     */
    private async updateParentIcons(item: TestElementsTreeItem): Promise<boolean> {
        try {
            let parent = item.parent as TestElementsTreeItem | null;
            let updated = false;
            while (parent) {
                if (parent.data.testElementType === TestElementType.Subdivision) {
                    const hierarchicalName = parent.data.hierarchicalName;
                    const isResourceFile = hierarchicalName && hierarchicalName.includes("[Robot-Resource]");
                    if (hierarchicalName && isResourceFile) {
                        const cleanName = hierarchicalName.replace(/\[Robot-Resource\]/g, "").trim();
                        let resourcePath = await this.resourceFileService.constructAbsolutePath(cleanName);
                        if (resourcePath) {
                            if (!resourcePath.endsWith(".resource")) {
                                resourcePath += ".resource";
                            }
                            const exists = await this.resourceFileService.pathExists(resourcePath);
                            parent.updateLocalAvailability(exists, resourcePath);
                            updated = true;
                        }
                    } else {
                        const cleanName = parent.data.name;
                        const folderPath = await this.resourceFileService.constructAbsolutePath(cleanName);
                        if (folderPath) {
                            const exists = await this.resourceFileService.directoryExists(folderPath);
                            parent.updateLocalAvailability(exists, folderPath);
                            updated = true;
                        }
                    }
                }
                parent = parent.parent as TestElementsTreeItem | null;
            }
            this._onDidChangeTreeData.fire(undefined);
            return updated;
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Error updating parent icons for item ${item.label}:`, error);
            return false;
        }
    }

    /**
     * Retrieves the children for a given tree item.
     * @param item The tree item to get children for
     * @returns Promise resolving to an array of child tree items
     */
    protected async getChildrenForItem(item: TestElementsTreeItem): Promise<TestElementsTreeItem[]> {
        if (item.children && item.children.length > 0) {
            return item.children as TestElementsTreeItem[];
        }
        return [];
    }

    /**
     * Creates a new tree item from test element data.
     * @param data The test element data to create the item from
     * @param parent Optional parent tree item
     * @returns The created tree item
     */
    protected createTreeItem(data: TestElementData, parent?: TestElementsTreeItem): TestElementsTreeItem {
        const testElementType = this.convertToTestElementTypeEnum(data.testElementType);

        // Convert TestElementData to the extended TestElementItemData
        const itemData: TestElementItemData = {
            ...data,
            testElementType,
            tovKey: this.currentTovKey || undefined,
            resourceFiles: this.resourceFiles.get(data.id) || [],
            isLocallyAvailable: false,
            localPath: undefined
        };

        // Check if parent resource is locally available for interactions
        if (testElementType === TestElementType.Interaction && parent) {
            itemData.isLocallyAvailable = parent.data.isLocallyAvailable || false;
        }

        const item = new TestElementsTreeItem(itemData, this.extensionContext, parent, this.eventBus);
        item.updateId();
        this.applyModulesToTestElementsItem(item);

        return item;
    }

    /**
     * Converts a string literal test element type to its corresponding enum value.
     * @param type The string literal type to convert
     * @returns The corresponding TestElementType enum value
     */
    private convertToTestElementTypeEnum(type: string): TestElementType {
        switch (type) {
            case TestElementItemTypes.SUBDIVISION:
                return TestElementType.Subdivision;
            case TestElementItemTypes.INTERACTION:
                return TestElementType.Interaction;
            case TestElementItemTypes.DATA_TYPE:
                return TestElementType.DataType;
            case TestElementItemTypes.CONDITION:
                return TestElementType.Condition;
            case TestElementItemTypes.OTHER:
            default:
                return TestElementType.Other;
        }
    }

    /**
     * Applies modules to a test elements tree item.
     * @param item The test elements tree item to apply modules to
     */
    private applyModulesToTestElementsItem(item: TestElementsTreeItem): void {
        const expansionModule = this.getModule("expansion");
        if (expansionModule) {
            expansionModule.applyExpansionState(item);
        }

        const filterModule = this.getModule("filtering");
        if (filterModule && filterModule.isActive()) {
            // Filtering will be applied at the getChildren level
        }
    }

    /**
     * Gets the current TOV key.
     * @returns The current TOV key or null if not set
     */
    public getCurrentTovKey(): string | null {
        return this.currentTovKey;
    }

    /**
     * Gets the current project name.
     * @returns The current project name or null if not set
     */
    public getCurrentProjectName(): string | null {
        return this.currentProjectName;
    }

    /**
     * Gets the current TOV name.
     * @returns The current TOV name or null if not set
     */
    public getCurrentTovName(): string | null {
        return this.currentTovName;
    }

    /**
     * Returns the test elements provider.
     * @returns The tree data provider for test elements
     */
    public getTestElementsProvider(): vscode.TreeDataProvider<TestElementsTreeItem> {
        return this;
    }

    /**
     * Validates and constructs the robot resource file path to be created and returns it.
     * @param hierarchicalName The hierarchical name from the item
     * @param errorMessages Error messages for validation failures
     * @returns Promise resolving to the cleaned name and constructed path
     */
    private async validateAndConstructPath(
        hierarchicalName: string | undefined,
        errorMessages: { noHierarchicalName: string; noPath: string }
    ): Promise<{ cleanName: string; resourcePath: string } | null> {
        if (!hierarchicalName) {
            vscode.window.showErrorMessage(errorMessages.noHierarchicalName);
            return null;
        }

        const cleanName = hierarchicalName.replace(/\[Robot-Resource\]/g, "").trim();
        let resourcePath = await this.resourceFileService.constructAbsolutePath(cleanName);

        if (!resourcePath) {
            vscode.window.showErrorMessage(errorMessages.noPath);
            return null;
        }

        if (!resourcePath.endsWith(".resource")) {
            resourcePath += ".resource";
        }

        return { cleanName, resourcePath };
    }

    /**
     * Creates a missing robot resource file in the given resource path and updates the tree item with its parents.
     * @param config The resource operation configuration
     * @param resourcePath The path where the file should be created
     * @param targetItem The item to update after creation
     * @returns Promise resolving to whether the file was created successfully
     */
    private async createMissingResourceFile(
        config: ResourceOperationConfig,
        resourcePath: string,
        targetItem: TestElementsTreeItem
    ): Promise<boolean> {
        if (!config.createMissing) {
            const cleanName = targetItem.data.hierarchicalName?.replace(/\[Robot-Resource\]/g, "").trim();
            vscode.window.showErrorMessage(
                config.errorMessages.fileNotFound.replace("{path}", `${cleanName}.resource`)
            );
            return false;
        }

        try {
            const uid = targetItem.data.uniqueID;
            if (!uid) {
                const label = typeof targetItem.label === "string" ? targetItem.label : "Unknown";
                throw new Error(config.errorMessages.noUid.replace("{label}", label));
            }

            let contextWithProjectAndTovName = "";
            if (this.currentProjectName && this.currentTovName) {
                contextWithProjectAndTovName = `tb:context:${this.currentProjectName}/${this.currentTovName}\n`;
            }

            const initialFileContent = `tb:uid:${uid}\n${contextWithProjectAndTovName}\n`;
            await this.resourceFileService.ensureFileExists(resourcePath, initialFileContent);

            this.logger.info(`[TestElementsTreeView] Created missing resource file at path: ${resourcePath}`);

            targetItem.updateLocalAvailability(true, resourcePath);
            await this.updateParentIcons(targetItem);
            this.refreshItemWithParents(targetItem);

            if (config.successMessages?.created) {
                vscode.window.showInformationMessage(config.successMessages.created);
            }

            return true;
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Error creating resource file ${resourcePath}:`, error);
            vscode.window.showErrorMessage(
                `Failed to create resource file: ${error instanceof Error ? error.message : "Unknown error"}`
            );
            return false;
        }
    }

    /**
     * Creates a folder in the specified path if it does not exist and updates visuals of the tree item with its parents.
     * @param config The resource operation configuration
     * @param folderPath The path where the folder should be created
     * @param targetItem The item to update after creation
     * @returns Promise resolving to whether the folder was created successfully
     */
    private async createMissingFolder(
        config: ResourceOperationConfig,
        folderPath: string,
        targetItem: TestElementsTreeItem
    ): Promise<boolean> {
        if (!config.createMissing) {
            const cleanName = targetItem.data.hierarchicalName?.replace(/\[Robot-Resource\]/g, "").trim();
            vscode.window.showErrorMessage(config.errorMessages.folderNotFound.replace("{path}", cleanName || ""));
            return false;
        }

        try {
            await this.resourceFileService.ensureFolderPathExists(folderPath);
            this.logger.info(`[TestElementsTreeView] Created missing folder at path: ${folderPath}`);

            targetItem.updateLocalAvailability(true, folderPath);
            await this.updateParentIcons(targetItem);
            this.refreshItemWithParents(targetItem);

            return true;
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Error creating folder at path ${folderPath}:`, error);
            vscode.window.showErrorMessage(
                `Failed to create folder ${folderPath}: ${error instanceof Error ? error.message : "Unknown error"}`
            );
            return false;
        }
    }

    /**
     * Opens a file in VS Code editor.
     * @param filePath The path of the file to open
     */
    private async openFileInVSCodeEditor(filePath: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Error opening file in VS Code editor:`, error);
            vscode.window.showErrorMessage(
                `Error opening file: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Reveals a file in VS Code's explorer view.
     * @param filePath The path of the file to reveal
     */
    private async revealFileInVSCodeExplorer(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            await vscode.commands.executeCommand("revealInExplorer", uri);
            this.logger.debug(`[TestElementsTreeView] Revealed file in VS Code explorer: ${filePath}`);
        } catch (error) {
            this.logger.warn(
                `[TestElementsTreeView] Failed to reveal file in VS Code explorer: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Opens and reveals a resource file in VS Code.
     * @param resourcePath The path of the resource file
     */
    private async openAndRevealResourceFile(resourcePath: string): Promise<void> {
        await this.openFileInVSCodeEditor(resourcePath);
        await this.revealFileInVSCodeExplorer(resourcePath);
    }

    /**
     * Opens a resource file in VS Code editor and positions cursor at a specific interaction.
     * @param resourcePath The path of the resource file
     * @param interactionName The name of the interaction to find and position cursor at
     * @param uid The unique identifier of the tree item
     */
    private async openFileAndJumpToInteraction(
        resourcePath: string,
        interactionName: string,
        uid: string
    ): Promise<void> {
        let textDocument: vscode.TextDocument;
        let textEditor: vscode.TextEditor;

        try {
            textDocument = await vscode.workspace.openTextDocument(resourcePath);
            textEditor = await vscode.window.showTextDocument(textDocument);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            this.logger.error(
                `[TestElementsTreeView] Failed to open resource file at path ${resourcePath}: ${errorMessage}`,
                error
            );
            vscode.window.showErrorMessage(`Failed to open resource file at path ${resourcePath}: ${errorMessage}`);
            return;
        }
        try {
            const interactionLineNumber = await findInteractionPositionInResourceFile(
                textDocument.uri,
                interactionName,
                uid
            );
            if (interactionLineNumber !== undefined) {
                const position = new vscode.Position(interactionLineNumber, 0);
                textEditor.selection = new vscode.Selection(position, position);
                textEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            }
        } catch (positioningError) {
            const errorMessage = positioningError instanceof Error ? positioningError.message : "Unknown error";
            this.logger.warn(
                `[TestElementsTreeView] Failed to position cursor for interaction '${interactionName}' in resource file at path ${resourcePath}: ${errorMessage}`,
                positioningError
            );
        }
    }

    /**
     * Opens a resource file in VS Code's editor and reveals the opened file in the VS Code explorer view.
     * If the file doesn't exist, it will create the file first.
     * @param item The tree item representing a resource.
     */
    public async openAvailableResource(item: TestElementsTreeItem): Promise<void> {
        const config: ResourceOperationConfig = {
            operationType: "open",
            createMissing: true,
            targetItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine resource path: item has no hierarchical name.",
                noPath: "Cannot construct resource path: workspace location not found.",
                noParent: "",
                noUid: "Subdivision {label} has no UID.",
                fileNotFound: "Resource file does not exist: {path}.",
                folderNotFound: ""
            }
        };

        const pathResult = await this.validateAndConstructPath(item.data.hierarchicalName, config.errorMessages);
        if (!pathResult) {
            return;
        }

        const { resourcePath } = pathResult;

        try {
            const fileExists = await this.resourceFileService.fileExists(resourcePath);

            if (!fileExists) {
                const created = await this.createMissingResourceFile(config, resourcePath, item);
                if (!created) {
                    return;
                }
            }

            await this.openAndRevealResourceFile(resourcePath);
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Error checking file existence for ${resourcePath}:`, error);
            vscode.window.showErrorMessage(
                `Error checking resource file: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Creates a missing resource file, opens it in VS Code editor and reveals it in the VS Code explorer view.
     * @param item The tree item representing a missing resource.
     */
    public async createMissingResource(item: TestElementsTreeItem): Promise<void> {
        const config: ResourceOperationConfig = {
            operationType: "create",
            createMissing: true,
            targetItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine resource path: item has no hierarchical name.",
                noPath: "Cannot construct resource path: workspace location not found.",
                noParent: "",
                noUid: "Subdivision {label} has no UID.",
                fileNotFound: "",
                folderNotFound: ""
            }
        };

        const pathResult = await this.validateAndConstructPath(item.data.hierarchicalName, config.errorMessages);
        if (!pathResult) {
            return;
        }

        const { resourcePath } = pathResult;

        try {
            const created = await this.createMissingResourceFile(config, resourcePath, item);
            if (!created) {
                return;
            }

            await this.openAndRevealResourceFile(resourcePath);
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Error creating resource file at path ${resourcePath}:`, error);
            vscode.window.showErrorMessage(
                `Error creating resource file at path ${resourcePath}: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Reveals a subdivision folder in VS Code's file explorer.
     * If the folder doesn't exist, it will create the folder first.
     * @param item The tree item representing a folder.
     */
    public async openFolderInExplorer(item: TestElementsTreeItem): Promise<void> {
        const config: ResourceOperationConfig = {
            operationType: "folder",
            createMissing: true,
            targetItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine folder path: item has no hierarchical name.",
                noPath: "Cannot construct folder path: workspace location not found.",
                noParent: "",
                noUid: "",
                fileNotFound: "",
                folderNotFound: "Folder does not exist: {path}"
            }
        };

        const pathResult = await this.validateAndConstructPath(item.data.hierarchicalName, config.errorMessages);
        if (!pathResult) {
            return;
        }

        const { resourcePath } = pathResult;
        const folderPath = resourcePath.replace(/\.resource$/, "");
        const folderExists = await this.resourceFileService.directoryExists(folderPath);

        if (!folderExists) {
            const created = await this.createMissingFolder(config, folderPath, item);
            if (!created) {
                return;
            }
        }

        await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(folderPath));
    }

    /**
     * Finds and opens the robot resource of an interaction and reveals the opened file in the VS Code explorer view.
     * Also jumps to the interaction position in the file.
     * If the parent resource file doesn't exist, it will create the file first.
     * @param item The tree item representing an interaction.
     */
    public async goToInteractionResource(item: TestElementsTreeItem): Promise<void> {
        const parentResource = item.parent as TestElementsTreeItem;
        if (!parentResource) {
            vscode.window.showErrorMessage(`Could not find the parent resource for interaction ${item.label}`);
            return;
        }

        const config: ResourceOperationConfig = {
            operationType: "interaction",
            createMissing: true,
            targetItem: parentResource,
            parentItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine resource path: parent has no hierarchical name.",
                noPath: "Cannot construct resource path: workspace location not found.",
                noParent: "Cannot find parent resource for interaction.",
                noUid: "Parent resource {label} has no UID.",
                fileNotFound: "Parent resource file does not exist: {path}.",
                folderNotFound: "Parent resource folder does not exist: {path}."
            }
        };

        const pathResult = await this.validateAndConstructPath(
            parentResource.data.hierarchicalName,
            config.errorMessages
        );
        if (!pathResult) {
            return;
        }

        const { resourcePath } = pathResult;
        const fileExists = await this.resourceFileService.fileExists(resourcePath);

        if (!fileExists) {
            const created = await this.createMissingResourceFile(config, resourcePath, parentResource);
            if (!created) {
                return;
            }
        }

        const interactionName = typeof item.label === "string" ? item.label : item.label?.toString() || "";
        await this.openFileAndJumpToInteraction(resourcePath, interactionName, item.data.uniqueID);
        await this.revealFileInVSCodeExplorer(resourcePath);
    }

    /**
     * Creates a missing parent resource for an interaction, opens it and
     * reveals the opened file in the VS Code explorer view.
     * @param item The interaction tree item
     */
    public async createMissingParentResourceForInteraction(item: TestElementsTreeItem): Promise<void> {
        const parentResource = item.parent as TestElementsTreeItem;
        if (!parentResource) {
            vscode.window.showErrorMessage(`Could not find the parent resource for interaction ${item.label}`);
            return;
        }

        const config: ResourceOperationConfig = {
            operationType: "create",
            createMissing: true,
            targetItem: parentResource,
            parentItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine resource path: parent has no hierarchical name.",
                noPath: "Cannot construct resource path: workspace location not found.",
                noParent: "Cannot find parent resource for interaction.",
                noUid: "Parent resource {label} has no UID.",
                fileNotFound: "Parent resource file does not exist: {path}.",
                folderNotFound: "Parent resource folder does not exist: {path}."
            }
        };

        const pathResult = await this.validateAndConstructPath(
            parentResource.data.hierarchicalName,
            config.errorMessages
        );
        if (!pathResult) {
            return;
        }

        const { resourcePath } = pathResult;
        const fileExists = await this.resourceFileService.fileExists(resourcePath);

        if (!fileExists) {
            const created = await this.createMissingResourceFile(config, resourcePath, parentResource);
            if (!created) {
                return;
            }
        }

        await this.openAndRevealResourceFile(resourcePath);
    }

    /**
     * Handles interaction single click events.
     * Opens or creates the .resource file in the editor and jumps to the interaction.
     * @param item The interaction tree item that was single clicked
     */
    private async handleInteractionSingleClick(item: TestElementsTreeItem): Promise<void> {
        this.logger.debug(`[TestElementsTreeView] Interaction tree item single clicked: ${item.label}`);
        await this.openInteractionResource(item);
    }

    /**
     * Opens the robot resource of an interaction in the editor without revealing it in the explorer.
     * Jumps to the interaction position in the file.
     * If the parent resource file doesn't exist, it will create the file first.
     * @param item The tree item representing an interaction.
     */
    public async openInteractionResource(item: TestElementsTreeItem): Promise<void> {
        const parentResource = item.parent as TestElementsTreeItem;
        if (!parentResource) {
            vscode.window.showErrorMessage(`Could not find the parent resource for interaction ${item.label}`);
            return;
        }

        const config: ResourceOperationConfig = {
            operationType: "interaction",
            createMissing: true,
            targetItem: parentResource,
            parentItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine resource path: parent has no hierarchical name.",
                noPath: "Cannot construct resource path: workspace location not found.",
                noParent: "Cannot find parent resource for interaction.",
                noUid: "Parent resource {label} has no UID.",
                fileNotFound: "Parent resource file does not exist: {path}.",
                folderNotFound: "Parent resource folder does not exist: {path}."
            }
        };

        const pathResult = await this.validateAndConstructPath(
            parentResource.data.hierarchicalName,
            config.errorMessages
        );
        if (!pathResult) {
            return;
        }

        const { resourcePath } = pathResult;
        const fileExists = await this.resourceFileService.fileExists(resourcePath);

        if (!fileExists) {
            const created = await this.createMissingResourceFile(config, resourcePath, parentResource);
            if (!created) {
                return;
            }
        }

        const interactionName = typeof item.label === "string" ? item.label : item.label?.toString() || "";
        await this.openFileAndJumpToInteraction(resourcePath, interactionName, item.data.uniqueID);
    }

    /**
     * Handles interaction double click events.
     * Opens the resource file, jumps to the interaction position, and reveals the file in explorer.
     * @param item The interaction tree item that was double clicked
     */
    private async handleInteractionDoubleClick(item: TestElementsTreeItem): Promise<void> {
        this.logger.debug(`[TestElementsTreeView] Interaction tree item double clicked: ${item.label}`);
        await this.openInteractionResource(item);

        const parentResource = item.parent as TestElementsTreeItem;
        if (parentResource) {
            const config: ResourceOperationConfig = {
                operationType: "open",
                createMissing: true,
                targetItem: parentResource,
                parentItem: item,
                errorMessages: {
                    noHierarchicalName: "Cannot determine resource path: parent has no hierarchical name.",
                    noPath: "Cannot construct resource path: workspace location not found.",
                    noParent: "Cannot find parent resource for interaction.",
                    noUid: "Parent resource {label} has no UID.",
                    fileNotFound: "Parent resource file does not exist: {path}.",
                    folderNotFound: "Parent resource folder does not exist: {path}."
                }
            };

            const pathResult = await this.validateAndConstructPath(
                parentResource.data.hierarchicalName,
                config.errorMessages
            );
            if (pathResult) {
                await this.revealFileInVSCodeExplorer(pathResult.resourcePath);
            }
        }
    }

    /**
     * Handles interaction clicks from external commands
     * @param item The interaction item that was clicked
     */
    public async handleInteractionClick(item: TestElementsTreeItem): Promise<void> {
        if (!item.id) {
            return;
        }

        await this.interactionClickHandler.handleClick(item, item.id, this.logger);
    }

    /**
     * Disposes of all resources and cleans up the tree view.
     */
    public async dispose(): Promise<void> {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
        await super.dispose();
    }

    /**
     * Override the base refresh method to fetch data from the server with improved progress handling
     *
     * @param item Optional specific item to refresh
     * @param options Optional refresh options
     */
    public override refresh(item?: TestElementsTreeItem, options?: { immediate?: boolean }): void {
        this.logger.debug(
            `[TestElementsTreeView] Refreshing test elements tree view${item ? ` for tree item: ${item.label}` : ""}`
        );

        if (item) {
            super.refresh(item, options);
            return;
        }

        if (this.currentTovKey) {
            this.dataProvider.clearCache(this.currentTovKey);

            this.loadTovWithProgress(
                this.currentTovKey,
                this.currentTovLabel || undefined,
                this.currentProjectName || undefined,
                this.currentTovName || undefined,
                true
            );
        } else {
            this.logger.debug("[TestElementsTreeView] No TOV key available while refreshing, clearing tree");
            this.clearTree();
        }
    }
}

export async function hideTestElementsTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_ELEMENTS_TREE, false);
}

export async function displayTestElementsTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_ELEMENTS_TREE, true);
    const filterService = FilterService.getInstance();
    filterService.setActiveTreeViewByContext(treeViews, ContextKeys.SHOW_TEST_ELEMENTS_TREE);
}
