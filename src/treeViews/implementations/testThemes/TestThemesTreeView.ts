/**
 * @file src/treeViews/implementations/testThemes/TestThemesTreeView.ts
 * @description Tree view implementation for managing test themes and test cases.
 */

import * as vscode from "vscode";
import { TreeViewBase } from "../../core/TreeViewBase";
import { TestThemesTreeItem, TestThemeData, TestThemeType } from "./TestThemesTreeItem";
import { TreeViewConfig } from "../../core/TreeViewConfig";
import { TestThemesDataProvider } from "./TestThemesDataProvider";
import { testThemesConfig } from "./TestThemesConfig";
import { PlayServerConnection } from "../../../testBenchConnection";
import { allExtensionCommands, ConfigKeys, ContextKeys, StorageKeys, TestThemeItemTypes } from "../../../constants";
import { TestStructure } from "../../../testBenchTypes";
import { getExtensionConfiguration } from "../../../configuration";
import { ALLOW_PERSISTENT_IMPORT_BUTTON, ENABLE_ICON_MARKING_ON_TEST_GENERATION } from "../../../extension";
import { MarkingModule } from "../../features/marking/MarkingModule";
import * as reportHandler from "../../../reportHandler";
import { FilterService } from "../../utils/FilterService";

export class TestThemesTreeView extends TreeViewBase<TestThemesTreeItem> {
    private dataProvider: TestThemesDataProvider;
    private disposables: vscode.Disposable[] = [];
    private filterService: FilterService;

    private currentProjectKey: string | null = null;
    private currentCycleKey: string | null = null;
    private currentCycleLabel: string | null = null;
    private currentTovKey: string | null = null;
    private isOpenedFromCycle = false;

    constructor(
        extensionContext: vscode.ExtensionContext,
        private getConnection: () => PlayServerConnection | null,
        config?: Partial<TreeViewConfig>
    ) {
        super(extensionContext, { ...testThemesConfig, ...config });
        this.dataProvider = new TestThemesDataProvider(this.logger, this.errorHandler, getConnection, this.eventBus);
        this.filterService = FilterService.getInstance();

        this.registerEventHandlers();
        this.registerCommands();
        this.initializeMarkingState();
    }

    /**
     * Registers all VS Code commands for the test themes tree view
     */
    private registerCommands(): void {
        // Make root command
        this.disposables.push(
            vscode.commands.registerCommand(`${this.config.id}.makeRoot`, async (item: TestThemesTreeItem) =>
                this.makeRoot(item)
            )
        );

        // Reset custom root
        this.disposables.push(
            vscode.commands.registerCommand(`${this.config.id}.resetCustomRoot`, async () => this.resetCustomRoot())
        );

        // Refresh command
        this.disposables.push(vscode.commands.registerCommand(`${this.config.id}.refresh`, () => this.refresh()));

        // Mark for import command
        this.disposables.push(
            vscode.commands.registerCommand(allExtensionCommands.markTestThemeForImport, (item: TestThemesTreeItem) =>
                this.markForImport(item)
            )
        );

        // Generate test cases command
        this.disposables.push(
            vscode.commands.registerCommand(
                allExtensionCommands.generateTestCasesForTestTheme,
                (item: TestThemesTreeItem) => this.generateTestCases(item)
            )
        );
    }

    /**
     * Registers event handlers for the test themes tree view
     */
    private registerEventHandlers(): void {
        // Listen for cycle selection from projects tree
        this.eventBus.on("cycle:selected", async (event) => {
            const { projectKey, cycleKey, cycleLabel } = event.data;
            await this.loadCycle(projectKey, cycleKey, cycleLabel);
        });

        // Listen for TOV selection from projects tree
        this.eventBus.on("tov:selected", async (event) => {
            const { projectKey, tovKey } = event.data;
            await this.loadTov(projectKey, tovKey);
        });

        // Listen for connection changes
        this.eventBus.on("connection:changed", async (event) => {
            const { connected } = event.data;
            if (connected && (this.currentCycleKey || this.currentTovKey)) {
                this.refresh();
            } else if (!connected) {
                this.clearTree();
            }
        });

        // Listen for marking events
        this.eventBus.on("item:marked", (event) => {
            if (event.source === this.config.id) {
                const item = event.data.item as TestThemesTreeItem;
                this.refreshItem(item);
            }
        });

        // Listen for test generation events
        this.eventBus.on("testGeneration:completed", () => {
            this.refresh();
        });
    }

    /**
     * Imports test results for a marked test theme item
     * @param item The test theme tree item to import results for
     */
    public async importTestResultsForTestThemeTreeItem(item: TestThemesTreeItem): Promise<void> {
        // Prevent import functionality when opened from a TOV
        if (!this.isOpenedFromCycle) {
            const errorMessage = "Import functionality is not available when viewing test themes from a TOV. Please open from a cycle to use import features.";
            vscode.window.showErrorMessage(errorMessage);
            this.logger.warn(errorMessage);
            return;
        }

        const connection = this.getConnection();
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            return;
        }

        try {
            const projectKey = this.currentProjectKey;
            const cycleKey = this.currentCycleKey;
            const tovKey = this.currentTovKey;

            if (!projectKey || (!cycleKey && !tovKey)) {
                const errorMessage =
                    "Error: Could not determine the active Project, Cycle, or TOV context for test import.";
                vscode.window.showErrorMessage(errorMessage);
                this.logger.error(errorMessage);
                return;
            }

            const itemLabel = item.label?.toString() || "Unknown Item";
            const itemUID = item.data.base.uniqueID;

            if (!itemUID) {
                const errorMessage = `Cannot import test results: Item ${itemLabel} has no unique ID.`;
                vscode.window.showErrorMessage(errorMessage);
                this.logger.error(errorMessage);
                return;
            }

            // Check if this is the same item as the last import
            const lastImportedItemKey = `${StorageKeys.SUB_TREE_ITEM_IMPORT_STORAGE_KEY}_last`;
            const lastImportedItem = this.extensionContext.workspaceState.get<string>(lastImportedItemKey);

            if (lastImportedItem === item.id) {
                const result = await vscode.window.showWarningMessage(
                    `You have already imported test results for "${itemLabel}". Do you want to import it again?`,
                    "Yes, Import Again",
                    "Cancel"
                );

                if (result !== "Yes, Import Again") {
                    this.logger.info(`User cancelled re-import of item: ${itemLabel}`);
                    return;
                }
            }

            this.logger.info(`Starting test result import for item: ${itemLabel} (UID: ${itemUID})`);

            // Get the marking module to check if this is a properly marked item
            const markingModule = this.getModule("marking") as MarkingModule;
            if (!markingModule) {
                throw new Error("Marking module not available");
            }

            // Verify the item is marked for import
            const markingInfo = markingModule.getMarkingInfo(item.id!);
            if (!markingInfo || markingInfo.type !== "import") {
                const errorMessage = `Item ${itemLabel} is not marked for import. Only items that have been generated can be imported.`;
                vscode.window.showErrorMessage(errorMessage);
                this.logger.error(errorMessage);
                return;
            }

            // Determine which UID to use for the import
            // If this is a descendant of a marked hierarchy, we need to use the root UID
            const rootId = markingModule.getRootIDForDescendant(item.id!);
            let reportRootUID = itemUID;

            if (rootId) {
                // This item is a descendant, get the root's UID
                const rootMarkingInfo = markingModule.getMarkingInfo(rootId);
                if (rootMarkingInfo && rootMarkingInfo.metadata?.uniqueID) {
                    reportRootUID = rootMarkingInfo.metadata.uniqueID;
                    this.logger.debug(`Using root UID ${reportRootUID} for import (item ${itemUID} is a descendant)`);
                }
            } else {
                // Check if this item itself is a root with descendants
                const hierarchy = markingModule.getHierarchy(item.id!);
                if (hierarchy) {
                    this.logger.debug(`Item ${itemUID} is a root with ${hierarchy.descendantIds.size} descendants`);
                }
            }

            const importSuccessful = await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(
                this.extensionContext,
                item,
                projectKey,
                cycleKey || tovKey || "",
                reportRootUID
            );

            if (importSuccessful) {
                this.logger.info(
                    `Import process for item ${itemLabel} (UID: ${reportRootUID}) completed successfully.`
                );
                vscode.window.showInformationMessage(`Successfully imported test results for: ${itemLabel}`);

                // Store the last imported item storage key
                this.extensionContext.workspaceState.update(
                    `${StorageKeys.SUB_TREE_ITEM_IMPORT_STORAGE_KEY}_last`,
                    item.id
                );

                // Check if we should clear the marking after import
                if (!ALLOW_PERSISTENT_IMPORT_BUTTON) {
                    this.logger.debug(
                        `Clearing marked state for item: ${itemLabel} as ALLOW_PERSISTENT_IMPORT_BUTTON is false.`
                    );

                    // If this was a root item with descendants, unmark the entire hierarchy
                    const hierarchy = markingModule.getHierarchy(item.id!);
                    if (hierarchy) {
                        markingModule.unmarkItemByID(item.id!);
                    } else if (rootId) {
                        // If this was a descendant, unmark from the root
                        markingModule.unmarkItemByID(rootId);
                    } else {
                        markingModule.unmarkItemByID(item.id!);
                    }
                } else {
                    this.logger.debug(
                        `ALLOW_PERSISTENT_IMPORT_BUTTON is true. Import button will persist for item: ${itemLabel}`
                    );
                }

                // Refresh the tree to show any status updates
                this.refresh();
            } else {
                this.logger.warn(
                    `Import process for item ${itemLabel} (UID: ${reportRootUID}) did not complete successfully or was cancelled.`
                );
                vscode.window.showWarningMessage(
                    `Import was cancelled or did not complete successfully for: ${itemLabel}`
                );
            }
        } catch (error) {
            this.logger.error("Error importing test results:", error);
            vscode.window.showErrorMessage(
                `Error importing test results: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Checks if import functionality is available in the current context
     * @return True if import functionality is available (opened from cycle), false otherwise
     */
    public isImportFunctionalityAvailable(): boolean {
        return this.isOpenedFromCycle;
    }

    /**
     * Gets the current project key
     * @return The current project key or null if not set
     */
    public getCurrentProjectKey(): string | null {
        return this.currentProjectKey;
    }

    /**
     * Gets the current cycle key
     * @return The current cycle key or null if not set
     */
    public getCurrentCycleKey(): string | null {
        return this.currentCycleKey;
    }

    /**
     * Gets the current cycle label
     * @return The current cycle label or null if not set
     */
    public getCurrentCycleLabel(): string | null {
        return this.currentCycleLabel;
    }

    /**
     * Gets the test theme tree data provider
     * @return The tree data provider instance
     */
    public getTestThemeProvider(): vscode.TreeDataProvider<TestThemesTreeItem> {
        return this;
    }

    /**
     * Updates the marking module configuration based on the opening context
     * Import button should only be visible when opened from a cycle, not from a TOV
     * @param isOpenedFromCycle Whether the tree view was opened from a cycle
     */
    private updateMarkingModuleConfiguration(isOpenedFromCycle: boolean): void {
        const markingModule = this.getModule("marking") as MarkingModule;
        if (!markingModule) {
            this.logger.warn("Marking module not available for configuration update");
            return;
        }

        // Update the marking configuration to control import button visibility
        const markingConfig = this.config.modules.marking;
        if (markingConfig) {
            markingConfig.showImportButton = isOpenedFromCycle;
            this.logger.debug(`Updated marking module configuration: showImportButton = ${isOpenedFromCycle}`);
        }
    }

    /**
     * Loads a cycle and builds the test themes tree
     * @param projectKey The project key
     * @param cycleKey The cycle key
     * @param cycleLabel Optional cycle label for display
     * @return Promise that resolves when loading is complete
     */
    public async loadCycle(projectKey: string, cycleKey: string, cycleLabel?: string): Promise<void> {
        try {
            this.logger.debug(`Loading cycle ${cycleKey} for project ${projectKey}`);

            // Clear existing state
            this.currentProjectKey = null;
            this.currentCycleKey = null;
            this.currentCycleLabel = null;
            this.currentTovKey = null;
            this.dataProvider.clearCache();

            // Set new state
            this.currentProjectKey = projectKey;
            this.currentCycleKey = cycleKey;
            this.currentCycleLabel = cycleLabel || null;
            this.isOpenedFromCycle = true;

            // Update marking module configuration to enable import button
            this.updateMarkingModuleConfiguration(true);

            // Update title to include cycle label
            if (cycleLabel) {
                this.updateTitle(`${this.config.title} (${cycleLabel})`);
            }

            await vscode.commands.executeCommand("setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, true);

            // Fetch and build the tree
            const fetchedTestStructure = await this.dataProvider.fetchCycleStructure(projectKey, cycleKey);
            if (!fetchedTestStructure) {
                throw new Error("Failed to fetch test structure");
            }

            // Clear existing items
            this._onDidChangeTreeData.fire(undefined);

            // Build the tree structure
            const nodeMap = new Map(
                fetchedTestStructure.nodes.map((node) => [node.base.key, { ...node, hasChildren: false }])
            );

            // Calculate which nodes have children
            for (const node of nodeMap.values()) {
                if (node.base.parentKey && nodeMap.has(node.base.parentKey)) {
                    nodeMap.get(node.base.parentKey)!.hasChildren = true;
                }
            }

            const rootItems = this.buildTreeRecursively(fetchedTestStructure.root.base.key, null, nodeMap);
            this.rootItems = rootItems;

            // Set the last data fetch timestamp to prevent infinite loading
            // This is important even for empty results to prevent the tree from continuously trying to load data
            (this as any)._lastDataFetch = Date.now();

            // Refresh marking state for all items
            const markingModule = this.getModule("marking") as MarkingModule;
            if (markingModule) {
                markingModule.refreshMarkingState();
            }

            this._onDidChangeTreeData.fire(undefined);
        } catch (error) {
            this.logger.error("Error loading cycle:", error);
            throw error;
        }
    }

    public async loadTov(projectKey: string, tovKey: string): Promise<void> {
        try {
            this.logger.debug(`Loading TOV ${tovKey} for project ${projectKey}`);

            // Clear existing state
            this.currentProjectKey = null;
            this.currentCycleKey = null;
            this.currentCycleLabel = null;
            this.currentTovKey = null;
            this.dataProvider.clearCache();

            // Set new state
            this.currentProjectKey = projectKey;
            this.currentTovKey = tovKey;
            this.isOpenedFromCycle = false;

            // Update marking module configuration to disable import button
            this.updateMarkingModuleConfiguration(false);

            // Get TOV name from the data provider or use TOV key as fallback
            let tovName = `TOV: ${tovKey}`;
            try {
                const connection = this.getConnection();
                if (connection) {
                    tovName = `TOV: ${tovKey}`;
                }
            } catch {
                this.logger.warn(`Could not get TOV name for ${tovKey}, using key as fallback`);
            }

            // Update title to include TOV name
            this.updateTitle(`${this.config.title} (${tovName})`);

            await vscode.commands.executeCommand("setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, false);

            const fetchedTestStructure = await this.dataProvider.fetchTovStructure(projectKey, tovKey);
            if (!fetchedTestStructure) {
                throw new Error("Failed to fetch test structure");
            }

            // Clear existing items
            this._onDidChangeTreeData.fire(undefined);

            const nodeMap = new Map(
                fetchedTestStructure.nodes.map((node) => [node.base.key, { ...node, hasChildren: false }])
            );

            // Calculate which nodes have children
            for (const node of nodeMap.values()) {
                if (node.base.parentKey && nodeMap.has(node.base.parentKey)) {
                    nodeMap.get(node.base.parentKey)!.hasChildren = true;
                }
            }

            const rootItems = this.buildTreeRecursively(fetchedTestStructure.root.base.key, null, nodeMap);
            this.rootItems = rootItems;

            // Set the last data fetch timestamp to prevent infinite loading
            // This is important even for empty results to prevent the tree from continuously trying to load data
            (this as any)._lastDataFetch = Date.now();

            // Refresh marking state for all items
            const markingModule = this.getModule("marking") as MarkingModule;
            if (markingModule) {
                markingModule.refreshMarkingState();
            }

            // Refresh the view
            this._onDidChangeTreeData.fire(undefined);
        } catch (error) {
            this.logger.error("Error loading TOV:", error);
            throw error;
        }
    }

    /**
     * Determines if a given tree node should be visible based on filtering rules.
     * Do not display if:
     * - The node is a test case node
     * - The node has execution status "NotPlanned"
     * - The node has execution locker value "-2" (Locked by system)
     * @param nodeData The data for the node to check.
     * @returns `true` if the item should be visible, otherwise `false`.
     */
    private _isVisible(nodeData: TestStructure["nodes"][0]): boolean {
        if (nodeData.elementType === TestThemeItemTypes.TEST_CASE) {
            return false;
        }

        if (nodeData.exec?.status === "NotPlanned") {
            return false;
        }
        if (nodeData.exec?.locker === "-2") {
            return false;
        }

        return true;
    }

    /**
     * Retrieves the children for a given tree item.
     * @param item The tree item to get children for. If null, returns root items.
     * @returns Promise resolving to an array of child tree items.
     */
    protected async getChildrenForItem(item: TestThemesTreeItem): Promise<TestThemesTreeItem[]> {
        if (!item) {
            // If no item is provided, return the root items
            return this.rootItems || [];
        }

        return item.children as TestThemesTreeItem[];
    }

    /**
     * Generates test cases for the specified test theme tree item.
     * @param item The test theme tree item to generate test cases for.
     * @returns Promise that resolves when test generation is complete.
     */
    public async generateTestCases(item: TestThemesTreeItem): Promise<void> {
        const connection = this.getConnection();
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            return;
        }

        try {
            if (getExtensionConfiguration().get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
                await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
            }

            const projectKey = this.currentProjectKey;
            const cycleKey = this.currentCycleKey;
            const tovKey = this.currentTovKey;

            if (!projectKey || (!cycleKey && !tovKey)) {
                const errorMessage =
                    "Error: Could not determine the active Project, Cycle, or TOV context for test generation.";
                vscode.window.showErrorMessage(errorMessage);
                this.logger.error(errorMessage);
                return;
            }

            const itemLabel = item.label?.toString() || "Unknown Item";
            const itemUID = item.data.base.uniqueID;

            let testGenerationSuccessful = false;
            if (this.isOpenedFromCycle && cycleKey) {
                // Generation from a cycle context
                testGenerationSuccessful =
                    await reportHandler.generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
                        this.extensionContext,
                        item,
                        itemLabel,
                        projectKey,
                        cycleKey,
                        itemUID
                    );
            } else if (tovKey) {
                // Generation from a TOV context
                testGenerationSuccessful = await reportHandler.startTestGenerationUsingTOV(
                    this.extensionContext,
                    item,
                    projectKey,
                    tovKey,
                    true
                );
            }

            if (testGenerationSuccessful && ENABLE_ICON_MARKING_ON_TEST_GENERATION && this.isOpenedFromCycle) {
                const markingModule = this.getModule("marking") as MarkingModule;
                if (markingModule && item.id) {
                    this.logger.debug(
                        `Clearing all previous markings before marking item ${item.label} and its descendants for import.`
                    );

                    // Clear all previous markings
                    markingModule.clearAllMarkings();

                    // Mark the item and its descendants for import
                    // The marking module handles refreshing
                    const contextKey = cycleKey || tovKey || "";
                    markingModule.markItemWithDescendants(item, projectKey, contextKey, "import");
                } else {
                    this.logger.warn(
                        `Could not mark item ${item.label}: Marking module not available or item has no ID.`
                    );
                }
            } else if (testGenerationSuccessful && !this.isOpenedFromCycle) {
                this.logger.debug(
                    `Test generation successful but not marking for import: opened from TOV context`
                );
            }
        } catch (error) {
            this.logger.error("Error generating test cases:", error);
            vscode.window.showErrorMessage(
                `Error generating test cases: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Recursively builds a tree structure from node data
     * @param parentKey The key of the parent node
     * @param parent The parent tree item or null for root
     * @param nodeMap Map containing all node data
     * @returns Array of tree items representing the children
     */
    private buildTreeRecursively(
        parentKey: string,
        parent: TestThemesTreeItem | null,
        nodeMap: Map<string, TestStructure["nodes"][0]>
    ): TestThemesTreeItem[] {
        const children: TestThemesTreeItem[] = [];
        // Find all nodes that have this parent key
        for (const nodeData of nodeMap.values()) {
            if (nodeData.base.parentKey === parentKey) {
                // Check if the item is visible before processing it
                if (!this._isVisible(nodeData)) {
                    continue; // Skip this item and its entire branch
                }
                const item = this.createTreeItem(nodeData, parent || undefined);
                // Recursively build children for the visible item
                const grandChildren = this.buildTreeRecursively(nodeData.base.key, item, nodeMap);
                item.children = grandChildren;

                children.push(item);
            }
        }

        return children;
    }

    /**
     * Creates a tree item from raw data
     * @param data The raw data object containing node information
     * @param parent Optional parent tree item
     * @returns A new TestThemesTreeItem instance
     * @throws Error if data format is invalid
     */
    protected createTreeItem(data: any, parent?: TestThemesTreeItem): TestThemesTreeItem {
        try {
            // Validate required fields
            if (!data || typeof data !== "object") {
                throw new Error("Invalid data format");
            }

            if (!data.base || typeof data.base !== "object") {
                throw new Error("Invalid base data format");
            }

            // Create tree item data
            const treeItemData: TestThemeData = {
                type: data.elementType as TestThemeType,
                base: {
                    key: data.base.key || "",
                    name: data.base.name || "Unknown",
                    numbering: data.base.numbering || "",
                    parentKey: data.base.parentKey || "",
                    uniqueID: data.base.uniqueID || "",
                    matchesFilter: data.base.matchesFilter || false
                },
                spec: {
                    key: data.spec?.key || "",
                    locker: data.spec?.locker || null,
                    status: data.spec?.status || "None"
                },
                aut: {
                    key: data.aut?.key || "",
                    locker: data.aut?.locker || null,
                    status: data.aut?.status || "None"
                },
                exec: data.exec
                    ? {
                          status: data.exec.status || "None",
                          execStatus: data.exec.execStatus || "None",
                          verdict: data.exec.verdict || "None",
                          key: data.exec.key || "",
                          locker: data.exec.locker || null
                      }
                    : null,
                filters: data.filters || [],
                elementType: data.elementType || TestThemeItemTypes.TEST_THEME,
                hasChildren: data.hasChildren ?? false,
                projectKey: this.currentProjectKey || undefined,
                cycleKey: this.currentCycleKey || undefined
            };

            const item = new TestThemesTreeItem(treeItemData, this.extensionContext, parent);
            item.setMetadata("openedFromCycle", this.isOpenedFromCycle);
            this.applyModulesToTestThemesItem(item);

            return item;
        } catch (error) {
            this.logger.error("Error creating tree item:", error);
            throw error;
        }
    }

    /**
     * Applies available modules to a test themes tree item
     * @param item The tree item to apply modules to
     */
    private applyModulesToTestThemesItem(item: TestThemesTreeItem): void {
        // Apply any modules that need to be attached to the item
        const modules = [this.getModule("icons"), this.getModule("expansion"), this.getModule("marking")].filter(
            Boolean
        );
        for (const module of modules) {
            if (module?.applyMarkingToItem) {
                module.applyMarkingToItem(item);
            }
        }
    }

    /**
     * Handles item selection in the tree view
     * @param item The selected tree item
     */
    private handleItemSelection(item: TestThemesTreeItem): void {
        // Handle item selection
        this.eventBus.emit({
            type: "item:selected",
            source: this.config.id,
            data: {
                item,
                projectKey: this.currentProjectKey,
                cycleKey: this.currentCycleKey,
                tovKey: this.currentTovKey
            },
            timestamp: Date.now()
        });
    }

    /**
     * Marks or unmarks an item for import by interacting with the MarkingModule.
     * @param item The tree item to mark/unmark
     */
    private markForImport(item: TestThemesTreeItem): void {
        // Prevent import marking when opened from a TOV
        if (!this.isOpenedFromCycle) {
            this.logger.warn("Cannot mark item for import: Test themes tree was opened from a TOV, not a cycle");
            vscode.window.showWarningMessage("Import functionality is not available when viewing test themes from a TOV. Please open from a cycle to use import features.");
            return;
        }

        const markingModule = this.getModule("marking") as MarkingModule | undefined;
        if (!markingModule || !item.id || !this.currentProjectKey || !this.currentCycleKey) {
            this.logger.warn("Cannot mark item: Marking module or context is not available.", {
                hasModule: !!markingModule,
                id: item.id
            });
            return;
        }

        try {
            // Toggle marking state
            const isCurrentlyMarked = markingModule.isMarked(item.id);
            if (isCurrentlyMarked) {
                markingModule.unmarkItemByID(item.id);
            } else {
                markingModule.markItem(item, this.currentProjectKey, this.currentCycleKey, "import");
            }
            // The marking module will trigger the necessary refresh.
        } catch (error) {
            this.logger.error("Error marking for import:", error);
            throw error;
        }
    }

    /**
     * Refreshes a specific tree item
     * @param item The tree item to refresh
     */
    private refreshItem(item: TestThemesTreeItem): void {
        this._onDidChangeTreeData.fire(item);
    }

    /**
     * Selects and reveals a theme in the tree view
     * @param themeKey The key of the theme to select
     */
    public async selectTheme(themeKey: string): Promise<void> {
        try {
            const theme = this.findThemeByKey(this.rootItems || [], themeKey);
            if (!theme) {
                throw new Error(`Theme not found: ${themeKey}`);
            }

            await this.vscTreeView?.reveal(theme, {
                select: true,
                focus: true,
                expand: true
            });
        } catch (error) {
            this.logger.error("Error selecting theme:", error);
            throw error;
        }
    }

    /**
     * Finds a theme item by its key in the tree
     * @param items Array of tree items to search
     * @param key The key to search for
     * @return The found theme item or null
     */
    private findThemeByKey(items: TestThemesTreeItem[], key: string): TestThemesTreeItem | null {
        for (const item of items) {
            if (item.data.base.key === key) {
                return item;
            }
            if (item.children) {
                const found = this.findThemeByKey(item.children as TestThemesTreeItem[], key);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }

    /**
     * Disposes of the tree view and all its resources
     */
    public dispose(): void {
        // Dispose of all disposables
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];

        // Dispose of tree view
        if (this.vscTreeView) {
            this.vscTreeView.dispose();
            this.vscTreeView = undefined;
        }
    }

    /**
     * Fetches the root items of the tree
     * @return Promise resolving to array of root tree items
     */
    protected async fetchRootItems(): Promise<TestThemesTreeItem[]> {
        return this.rootItems || [];
    }

    /**
     * Clears the tree view and resets all state variables
     */
    public clearTree(): void {
        this.rootItems = [];
        this.currentProjectKey = null;
        this.currentCycleKey = null;
        this.currentCycleLabel = null;
        this.currentTovKey = null;
        this.isOpenedFromCycle = false;
        this._onDidChangeTreeData.fire(undefined);
        this.resetTitle();
    }

    /**
     * Initializes the marking state by waiting for modules and refreshing marking state
     */
    private async initializeMarkingState(): Promise<void> {
        // Wait for modules to be initialized
        await this.initialize();

        const markingModule = this.getModule("marking") as MarkingModule;
        if (markingModule) {
            markingModule.refreshMarkingState();
        }
    }
}
