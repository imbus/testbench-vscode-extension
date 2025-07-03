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
import { ResourceFileService } from "./ResourceFileService";
import { ContextKeys, TestElementItemTypes } from "../../../constants";
import { FilterService } from "../../utils/FilterService";
import { treeViews } from "../../../extension";

export class TestElementsTreeView extends TreeViewBase<TestElementsTreeItem> {
    private dataProvider: TestElementsDataProvider;
    private disposables: vscode.Disposable[] = [];
    private currentTovKey: string | null = null;
    private currentTovLabel: string | null = null;
    private resourceFiles: Map<string, string[]> = new Map();
    private resourceFileService: ResourceFileService;
    private isUpdating: boolean = false;
    private updateQueue: Promise<void> = Promise.resolve();
    private filterService: FilterService;

    constructor(
        extensionContext: vscode.ExtensionContext,
        private getConnection: () => PlayServerConnection | null,
        config?: Partial<TreeViewConfig>
    ) {
        const fullConfig = { ...testElementsConfig, ...config };
        super(extensionContext, fullConfig);

        this.dataProvider = new TestElementsDataProvider(this.logger, this.errorHandler, getConnection, this.eventBus);
        this.resourceFileService = new ResourceFileService(this.logger);
        this.filterService = FilterService.getInstance();

        this.registerEventHandlers();
    }

    /**
     * Registers event handlers (listeners) for various tree view events.
     */
    private registerEventHandlers(): void {
        this.eventBus.on("testElements:fetched", (event) => {
            const { tovKey, count } = event.data;
            if (tovKey === this.currentTovKey) {
                this.logger.debug(`Received test elements fetched event for TOV ${tovKey} with ${count} elements`);
            }
        });

        this.eventBus.on("testElements:error", (event) => {
            const { tovKey, error } = event.data;
            if (tovKey === this.currentTovKey) {
                this.logger.error(`Error fetching test elements for TOV ${tovKey}: ${error}`);
                this.errorHandler.handleVoid(new Error(error), "testElements:error");
            }
        });

        this.eventBus.on("cycle:selected", async () => {
            this.logger.debug(`Cycle selected, need to find associated TOV`);
            // handled in extension.ts handleProjectCycleClick
        });

        this.eventBus.on("tov:loaded", async (event) => {
            const { tovKey, tovLabel } = event.data;
            if (tovKey && tovKey !== this.currentTovKey) {
                this.logger.debug(`Loading test elements for TOV ${tovKey} from test themes event`);
                await this.loadTov(tovKey, tovLabel);
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
            const { id } = event.data;
            const item = this.findItemById(this.rootItems, id);
            if (item) {
                // Refresh only the specific item that changed
                this._onDidChangeTreeData.fire(item);
            }
        });
    }

    /**
     * Finds a tree item recursively by its unique ID.
     * @param items The list of items to search through.
     * @param id The ID of the item to find.
     * @returns The found TestElementsTreeItem or undefined.
     */
    private findItemById(items: TestElementsTreeItem[], id: string): TestElementsTreeItem | undefined {
        for (const item of items) {
            if (item.id === id) {
                return item;
            }
            if (item.children && item.children.length > 0) {
                const found = this.findItemById(item.children as TestElementsTreeItem[], id);
                if (found) {
                    return found;
                }
            }
        }
        return undefined;
    }

    /**
     * Loads test elements for a specific TOV (Test Object Version).
     *
     * @param tovKey - The unique identifier for the TOV to load.
     * @param tovLabel - Optional label for the TOV to display in the title.
     * @returns Promise that resolves when the TOV is loaded.
     */
    public async loadTov(tovKey: string, tovLabel?: string): Promise<void> {
        try {
            this.logger.debug(`Loading TOV ${tovKey}`);

            this.clearTree();
            this.dataProvider.clearCache(tovKey); // Only clear cache for this specific TOV

            this.currentTovKey = tovKey;
            this.currentTovLabel = tovLabel || null;
            this.resourceFiles.clear();

            if (tovLabel) {
                this.updateTitle(`${this.config.title} (${tovLabel})`);
            } else {
                this.updateTitle(`${this.config.title} (TOV: ${tovKey})`);
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
            this.logger.info(`Successfully loaded test elements for TOV ${tovKey}`);
        } catch (error) {
            this.logger.error("Error loading TOV:", error);

            this.rootItems = [];
            (this as any)._lastDataFetch = Date.now();
            (this as any)._intentionallyCleared = false;
            this._onDidChangeTreeData.fire(undefined);
            (this as any).updateTreeViewMessage();

            this.errorHandler.handleVoid(error as Error, "Failed to load test elements");
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
            this.logger.debug("No TOV selected, returning empty array");
            return [];
        }

        if (this.rootItems.length > 0) {
            const dataIsFresh = Date.now() - (this as any)._lastDataFetch < 30000;
            if (dataIsFresh) {
                this.logger.debug(`Using cached root items for TOV: ${this.currentTovKey}`);
                return this.rootItems;
            }
        }

        try {
            this.logger.debug(`Fetching root items for TOV: ${this.currentTovKey}`);
            const hierarchicalTestElementsData = await this.dataProvider.fetchTestElements(this.currentTovKey);
            const rootTestElementItems = hierarchicalTestElementsData.map((data) => this._buildTreeItems(data));

            // Await the icon updates directly to ensure they complete before the UI is drawn.
            await this.updateSubdivisionIcons(rootTestElementItems);
            this.logger.info(`Built tree and updated icons for ${rootTestElementItems.length} root test elements.`);
            return rootTestElementItems;
        } catch (error) {
            this.logger.error("Failed to fetch and build test elements tree:", error);
            this.errorHandler.handleVoid(error as Error, "Could not load Test Elements.");
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
                            item.updateLocalAvailability(exists);
                        }
                    }
                } catch (error) {
                    this.logger.error(`Error updating icon for item ${item.label}:`, error);
                }
            })
        );
    }

    /**
     * Updates the icon for a single tree item by checking its local availability
     * @param item The tree item to update
     * @returns Promise that resolves when the icon update is complete
     */
    private async updateSingleItemIcon(item: TestElementsTreeItem): Promise<void> {
        try {
            if (item.data.testElementType === TestElementType.Subdivision) {
                const hierarchicalName = item.data.hierarchicalName;
                if (hierarchicalName) {
                    const isResourceFile = hierarchicalName.includes("[Robot-Resource]");

                    if (isResourceFile) {
                        const cleanName = hierarchicalName.replace(/\[Robot-Resource\]/g, "").trim();
                        const lastSlash = cleanName.lastIndexOf("/");
                        let parentPath = "";
                        let baseName = cleanName;
                        if (lastSlash !== -1) {
                            parentPath = cleanName.substring(0, lastSlash);
                            baseName = cleanName.substring(lastSlash + 1);
                        }
                        const resourceFileRelative = parentPath
                            ? `${parentPath}/${baseName}.resource`
                            : `${baseName}.resource`;
                        const resourceFilePath =
                            await this.resourceFileService.constructAbsolutePath(resourceFileRelative);
                        let exists = false;
                        if (resourceFilePath) {
                            exists = await this.resourceFileService.fileExists(resourceFilePath);
                        }
                        // Fallback: check if file exists without .resource extension
                        if (!exists) {
                            const fallbackRelative = parentPath ? `${parentPath}/${baseName}` : baseName;
                            const fallbackPath = await this.resourceFileService.constructAbsolutePath(fallbackRelative);
                            if (fallbackPath) {
                                exists = await this.resourceFileService.fileExists(fallbackPath);
                            }
                        }
                        item.updateLocalAvailability(exists);
                        this._onDidChangeTreeData.fire(item);
                    } else {
                        // For non-resource subdivisions, check if the folder exists locally
                        const absolutePath = await this.resourceFileService.constructAbsolutePath(hierarchicalName);
                        if (absolutePath) {
                            const exists = await this.resourceFileService.directoryExists(absolutePath);
                            item.updateLocalAvailability(exists);
                            this._onDidChangeTreeData.fire(item);
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.error(`Error updating icon for item ${item.label}:`, error);
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
     * Gets the context value for a given test element type.
     * @param testElementType The test element type to get context value for
     * @returns The context value string for the element type
     */
    private getContextValueForElementType(testElementType: TestElementType): string {
        switch (testElementType) {
            case TestElementItemTypes.SUBDIVISION:
                return "testElement.subdivision";
            case TestElementItemTypes.INTERACTION:
                return "testElement.interaction";
            case TestElementItemTypes.DATA_TYPE:
                return "testElement.dataType";
            case TestElementItemTypes.CONDITION:
                return "testElement.condition";
            default:
                return "testElement.other";
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
     * Gets the test elements provider.
     * @returns The tree data provider for test elements
     */
    public getTestElementsProvider(): vscode.TreeDataProvider<TestElementsTreeItem> {
        return this;
    }

    /**
     * Opens or creates a Robot resource file for the given test element item.
     *
     * @param item The test element tree item to open or create resource file for
     * @returns Promise that resolves when the operation is complete
     */
    public async openOrCreateRobotResourceFile(item: TestElementsTreeItem): Promise<void> {
        const itemType = item.data.testElementType;

        if (itemType !== TestElementType.Subdivision && itemType !== TestElementType.Interaction) {
            vscode.window.showErrorMessage("This command can only be used on a Subdivision or an Interaction.");
            return;
        }

        const resourceItem = (itemType === TestElementType.Interaction ? item.parent : item) as
            | TestElementsTreeItem
            | undefined;

        if (!resourceItem || resourceItem.data.testElementType !== TestElementType.Subdivision) {
            vscode.window.showErrorMessage("Could not find the parent resource for this item.");
            return;
        }

        const hierarchicalName = resourceItem.data.hierarchicalName;
        if (!hierarchicalName) {
            vscode.window.showErrorMessage("Cannot determine resource path: item has no hierarchical name.");
            return;
        }

        try {
            const isResourceFile = hierarchicalName.includes("[Robot-Resource]");
            const cleanName = hierarchicalName.replace(/\[Robot-Resource\]/g, "").trim();
            let resourcePath = await this.resourceFileService.constructAbsolutePath(cleanName);

            if (!resourcePath) {
                return;
            }

            if (isResourceFile) {
                if (!resourcePath.endsWith(".resource")) {
                    resourcePath += ".resource";
                }
                const uid = resourceItem.data.uniqueID;
                if (!uid) {
                    throw new Error(`Subdivision ${resourceItem.label} has no UID.`);
                }

                const initialResourceFileContent = `tb:uid:${uid}\n\n`;
                await this.resourceFileService.ensureFileExists(resourcePath, initialResourceFileContent);
                const doc = await vscode.workspace.openTextDocument(resourcePath);
                await vscode.window.showTextDocument(doc);
            } else {
                await this.resourceFileService.ensureFolderPathExists(resourcePath);
                await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(resourcePath));
            }

            // Only update the icons of the resource item and its parents
            await this.updateSingleItemIcon(resourceItem);
            let parent = resourceItem.parent as TestElementsTreeItem | null;
            while (parent) {
                if (parent.data.testElementType === TestElementType.Subdivision) {
                    await this.updateSingleItemIcon(parent);
                }
                parent = parent.parent as TestElementsTreeItem | null;
            }
        } catch (error) {
            this.errorHandler.handleVoid(error as Error, "Failed to open or create Robot resource file.");
            vscode.window.showErrorMessage(
                `Error handling resource file: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    // TODO: Implement this feature after the backend API is implemented.
    /**
     * Handles the "Create Interaction" command for creating new interactions under subdivisions.
     * @param item The TestElementsTreeItem representing the subdivision where the interaction will be created.
     * @returns Promise<void> A promise that resolves when the operation completes.
     * @throws May throw errors related to user input validation or file operations.
     */
    public async createInteraction(item: TestElementsTreeItem): Promise<void> {
        if (item.data.testElementType !== TestElementType.Subdivision) {
            vscode.window.showErrorMessage("This command can only be used on a Subdivision.");
            return;
        }

        const interactionName = await vscode.window.showInputBox({
            prompt: "Enter the name for the new Interaction (Keyword)",
            placeHolder: "e.g., Log In To System",
            validateInput: (text) => {
                return text.trim().length > 0 ? null : "Interaction name cannot be empty.";
            }
        });

        if (!interactionName) {
            this.logger.debug("User cancelled 'Create Interaction' command.");
            return;
        }
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
     * Override the base refresh method to fetch data from the server
     *
     * @param item Optional specific item to refresh
     * @param options Optional refresh options
     */
    public override refresh(item?: TestElementsTreeItem, options?: { immediate?: boolean }): void {
        this.logger.debug(`Refreshing test elements tree view${item ? ` for item: ${item.label}` : ""}`);

        if (item) {
            super.refresh(item, options);
            return;
        }

        if (this.currentTovKey) {
            this.dataProvider.clearCache(this.currentTovKey);

            this.loadTov(this.currentTovKey, this.currentTovLabel || undefined)
                .then(() => {
                    this.logger.debug("Successfully refreshed test elements tree from TOV context");
                })
                .catch((error) => {
                    this.logger.error("Error refreshing test elements tree from TOV context:", error);
                    // Don't clear the tree on error, keep existing data
                });
        } else {
            this.logger.debug("No TOV key available, clearing tree");
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
