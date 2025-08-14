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
import {
    ALLOW_PERSISTENT_IMPORT_BUTTON,
    ENABLE_ICON_MARKING_ON_TEST_GENERATION,
    treeViews,
    userSessionManager
} from "../../../extension";
import { MarkingModule } from "../../features/MarkingModule";
import * as reportHandler from "../../../reportHandler";
import { FilterService } from "../../utils/FilterService";
import { TreeViewEventTypes } from "../../utils/EventBus";
import { PersistenceModule } from "../../features/PersistenceModule";
import { ClickHandler } from "../../core/ClickHandler";

export class TestThemesTreeView extends TreeViewBase<TestThemesTreeItem> {
    private dataProvider: TestThemesDataProvider;
    private disposables: vscode.Disposable[] = [];
    private filterService: FilterService;
    public testCaseSetClickHandler: ClickHandler<TestThemesTreeItem>;

    private currentProjectKey: string | null = null;
    private currentProjectName: string | null = null;
    private currentTovKey: string | null = null;
    private currentTovName: string | null = null;
    private isOpenedFromCycle = false;
    private currentCycleKey: string | null = null;
    private currentCycleLabel: string | null = null;

    constructor(
        extensionContext: vscode.ExtensionContext,
        private getConnection: () => PlayServerConnection | null,
        config?: Partial<TreeViewConfig>
    ) {
        super(extensionContext, { ...testThemesConfig, ...config });
        this.dataProvider = new TestThemesDataProvider(this.logger, getConnection);
        this.filterService = FilterService.getInstance();
        this.testCaseSetClickHandler = new ClickHandler<TestThemesTreeItem>();

        this.registerEventHandlers();
        this.registerCommands();
        this.setupTestCaseSetClickHandlers();
    }

    /**
     * Registers all VS Code commands for the test themes tree view
     */
    private registerCommands(): void {
        this.disposables.push(
            vscode.commands.registerCommand(`${this.config.id}.makeRoot`, async (item: TestThemesTreeItem) =>
                this.makeRoot(item)
            )
        );

        this.disposables.push(
            vscode.commands.registerCommand(`${this.config.id}.resetCustomRoot`, async () => this.resetCustomRoot())
        );

        this.disposables.push(vscode.commands.registerCommand(`${this.config.id}.refresh`, () => this.refresh()));

        this.disposables.push(
            vscode.commands.registerCommand(
                allExtensionCommands.checkForTestCaseSetDoubleClick,
                async (item: TestThemesTreeItem) => {
                    if (item.id) {
                        await this.testCaseSetClickHandler.handleClick(item, item.id, this.logger);
                    }
                }
            )
        );

        this.disposables.push(
            vscode.commands.registerCommand(allExtensionCommands.markTestThemeForImport, (item: TestThemesTreeItem) =>
                this.markForImport(item)
            )
        );

        this.disposables.push(
            vscode.commands.registerCommand(
                allExtensionCommands.generateTestCasesForTestTheme,
                (item: TestThemesTreeItem) => this.generateTestCases(item)
            )
        );
    }

    /**
     * Registers event handlers (listeners) for the test themes tree view
     */
    private registerEventHandlers(): void {
        this.eventBus.on("cycle:selected", async (event) => {
            const { projectKey, cycleKey, projectName, tovName, cycleLabel } = event.data;
            await this.loadCycle(projectKey, cycleKey, projectName, tovName, cycleLabel);
        });
        this.eventBus.on("version:selected", async (event) => {
            const { projectKey, tovKey, projectName, tovName } = event.data;
            await this.loadTov(projectKey, tovKey, projectName, tovName);
        });

        this.eventBus.on("connection:changed", async (event) => {
            const { connected } = event.data;
            if (connected && (this.currentCycleKey || this.currentTovKey)) {
                this.refresh();
            } else if (!connected) {
                this.clearTree();
            }
        });

        this.eventBus.on("item:marked", (event) => {
            if (event.source === this.config.id) {
                const item = event.data.item as TestThemesTreeItem;
                this.refreshItem(item);
            }
        });

        this.eventBus.on("testGeneration:completed", () => {
            this.refresh();
        });

        this.eventBus.on(TreeViewEventTypes.MARKING_CLEARED_GLOBAL, (event) => {
            // Only clear markings if this event came from another test themes tree view instance
            // and was triggered by test generation
            if (event.source !== this.config.id && event.data?.reason === "testGeneration") {
                this.logger.debug(
                    "[TestThemesTreeView] Received global marking cleared event from another test themes tree view instance"
                );
                const markingModule = this.getModule("marking") as MarkingModule;
                if (markingModule) {
                    markingModule.clearAllMarkings(false);
                }
            }
        });
    }

    /**
     * Imports test results for a marked test theme item
     * @param item The test theme tree item to import results for
     */
    public async importTestResultsForTestThemeTreeItem(item: TestThemesTreeItem): Promise<void> {
        // Prevent import functionality when opened from a TOV
        if (!this.isOpenedFromCycle) {
            const importFromTovNotPossibleWarningMessage =
                "[TestThemesTreeView] Invalid operation: Import functionality is not available when viewing test themes from a TOV.";
            this.logger.warn(importFromTovNotPossibleWarningMessage);
            return;
        }

        const connection = this.getConnection();
        if (!connection) {
            const noConnectionAvailableWarningMessage =
                "[TestThemesTreeView] No connection available. Please log in first.";
            this.logger.error(noConnectionAvailableWarningMessage);
            const noConnectionAvailableWarningMessageForUser = "No connection available. Please log in first.";
            vscode.window.showErrorMessage(noConnectionAvailableWarningMessageForUser);
            return;
        }

        try {
            const projectKey = this.currentProjectKey;
            const cycleKey = this.currentCycleKey;
            const tovKey = this.currentTovKey;

            if (!projectKey || (!cycleKey && !tovKey)) {
                const importContextMissingErrorMessageForUser =
                    "Could not determine the active Project, Cycle, or TOV key for import.";
                vscode.window.showErrorMessage(importContextMissingErrorMessageForUser);
                const importContextMissingErrorMessage =
                    "[TestThemesTreeView] " + importContextMissingErrorMessageForUser;
                this.logger.error(importContextMissingErrorMessage);
                return;
            }

            const itemLabel = item.label?.toString() || "Unknown Item";
            const itemUID = item.data.base.uniqueID;

            if (!itemUID) {
                const itemHasNoUniqueIDErrorMessageForUser = `Cannot import test results: Item ${itemLabel} has no unique ID.`;
                vscode.window.showErrorMessage(itemHasNoUniqueIDErrorMessageForUser);
                const itemHasNoUniqueIDErrorMessage = "[TestThemesTreeView] " + itemHasNoUniqueIDErrorMessageForUser;
                this.logger.error(itemHasNoUniqueIDErrorMessage);
                return;
            }

            // Check if this is the same item as the last import
            const userId = userSessionManager.getCurrentUserId();
            const lastImportedItemKey = `${userId}.${StorageKeys.SUB_TREE_ITEM_IMPORT_STORAGE_KEY}_lastItemId`;
            const lastImportedItem = this.extensionContext.workspaceState.get<string>(lastImportedItemKey);

            if (lastImportedItem === item.id) {
                const result = await vscode.window.showWarningMessage(
                    `You have already imported test results for "${itemLabel}". Do you want to import it again?`,
                    "Yes, Import Again",
                    "Cancel"
                );

                if (result !== "Yes, Import Again") {
                    this.logger.debug(
                        `[TestThemesTreeView] Re-import operation cancelled by user for tree item: ${itemLabel}`
                    );
                    return;
                }
            }

            const markingModule = this.getModule("marking") as MarkingModule;
            if (!markingModule) {
                throw new Error("Marking module not available");
            }

            // Verify the item is marked for import
            const markingInfo = markingModule.getMarkingInfo(item.id!);
            if (!markingInfo || markingInfo.type !== "import") {
                const itemNotMarkedForImportErrorMessageForUser = `Item ${itemLabel} is not marked for import. Only items that have been generated can be imported.`;
                vscode.window.showErrorMessage(itemNotMarkedForImportErrorMessageForUser);
                const itemNotMarkedForImportErrorMessage =
                    "[TestThemesTreeView] " + itemNotMarkedForImportErrorMessageForUser;
                this.logger.error(itemNotMarkedForImportErrorMessage);
                return;
            }

            // Determine which UID to use for the import
            // If this is a descendant of a marked hierarchy, use the root UID
            const rootId = markingModule.getRootIDForDescendant(item.id!);
            let reportRootUID = itemUID;

            if (rootId) {
                // This item is a descendant, get the root's UID
                const rootMarkingInfo = markingModule.getMarkingInfo(rootId);
                if (rootMarkingInfo && rootMarkingInfo.metadata?.uniqueID) {
                    reportRootUID = rootMarkingInfo.metadata.uniqueID;
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
                const importSuccessfulMessageForUser = `Successfully imported test results for ${itemLabel}`;
                const importSuccessfulMessage = `[TestThemesTreeView] Successfully imported test results for ${itemLabel} with UID ${reportRootUID}`;
                this.logger.info(importSuccessfulMessage);
                vscode.window.showInformationMessage(importSuccessfulMessageForUser);

                this.extensionContext.workspaceState.update(lastImportedItemKey, item.id);

                if (!ALLOW_PERSISTENT_IMPORT_BUTTON) {
                    // If this was a root item with descendants, unmark the entire hierarchy
                    const hierarchy = markingModule.getHierarchy(item.id!);
                    if (hierarchy) {
                        markingModule.unmarkItemByID(item.id!);
                    } else if (rootId) {
                        markingModule.unmarkItemByID(rootId);
                    } else {
                        markingModule.unmarkItemByID(item.id!);
                    }
                }

                this.refresh();
            } else {
                const importFailedMessageForUser = `Import was cancelled or did not complete successfully for ${itemLabel}`;
                const importFailedMessage = `[TestThemesTreeView] Import process for item ${itemLabel} (UID: ${reportRootUID}) did not complete successfully or was cancelled.`;
                this.logger.warn(importFailedMessage);
                vscode.window.showWarningMessage(importFailedMessageForUser);
            }
        } catch (error) {
            const importErrorMessageForUser = `Error importing test results: ${error instanceof Error ? error.message : "Unknown error"}`;
            const importErrorMessage = `[TestThemesTreeView] Error importing test results: ${error instanceof Error ? error.message : "Unknown error"}`;
            this.logger.error(importErrorMessage);
            vscode.window.showErrorMessage(importErrorMessageForUser);
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
     * Gets the current project name
     * @return The current project name or null if not set
     */
    public getCurrentProjectName(): string | null {
        return this.currentProjectName;
    }

    /**
     * Gets the current TOV name
     * @return The current TOV name or null if not set
     */
    public getCurrentTovName(): string | null {
        return this.currentTovName;
    }

    /**
     * Updates the marking module configuration based on the opening context
     * Import button should only be visible when opened from a cycle, not from a TOV
     * @param isOpenedFromCycle Whether the tree view was opened from a cycle
     */
    private updateMarkingModuleConfiguration(isOpenedFromCycle: boolean): void {
        const markingModule = this.getModule("marking") as MarkingModule;
        if (!markingModule) {
            this.logger.warn("[TestThemesTreeView] Marking module not available for configuration update");
            return;
        }

        const markingConfig = this.config.modules.marking;
        if (markingConfig) {
            markingConfig.showImportButton = isOpenedFromCycle;
        }
    }

    /**
     * Loads a cycle and builds the test themes tree
     * @param projectKey The project key
     * @param cycleKey The cycle key
     * @param projectName The project name
     * @param tovName The TOV name
     * @param cycleLabel Optional cycle label for display
     * @return Promise that resolves when loading is complete
     */
    public async loadCycle(
        projectKey: string,
        cycleKey: string,
        projectName: string,
        tovName: string,
        cycleLabel?: string
    ): Promise<void> {
        try {
            this.logger.debug(`[TestThemesTreeView] Loading cycle ${cycleKey} for project ${projectKey}`);

            this.dataProvider.clearCache();
            this.currentProjectKey = projectKey;
            this.currentCycleKey = cycleKey;
            this.currentCycleLabel = cycleLabel || null;

            this.currentProjectName = projectName;
            this.currentTovName = tovName;
            this.isOpenedFromCycle = true;

            // Enable import button
            this.updateMarkingModuleConfiguration(true);

            // Update title with format: Test Themes (Project Name, TOV Name, Cycle Name)
            const titleParts = ["Test Themes"];
            if (projectName) {
                titleParts.push(projectName);
            }
            if (tovName) {
                titleParts.push(tovName);
            }
            if (cycleLabel) {
                titleParts.push(cycleLabel);
            }

            if (titleParts.length > 1) {
                this.updateTitle(`${titleParts[0]} (${titleParts.slice(1).join(", ")})`);
            } else {
                this.updateTitle(titleParts[0]);
            }

            await vscode.commands.executeCommand("setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, true);

            const fetchedTestStructure = await this.dataProvider.fetchCycleStructure(projectKey, cycleKey);
            if (!fetchedTestStructure) {
                throw new Error("Failed to fetch test structure");
            }

            // Clear existing tree data only, preserving UI state (expansion, marking, etc.)
            this.clearTreeDataOnly();

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
            (this as any)._intentionallyCleared = false;

            this._onDidChangeTreeData.fire(undefined);
            await this.updateRobotFileAvailabilityForAllTreeItems();
            this._onDidChangeTreeData.fire(undefined);
            (this as any).updateTreeViewMessage();
        } catch (error) {
            this.logger.error("[TestThemesTreeView] Error loading cycle:", error);

            this.rootItems = [];
            (this as any)._lastDataFetch = Date.now();
            (this as any)._intentionallyCleared = false;
            this._onDidChangeTreeData.fire(undefined);
            (this as any).updateTreeViewMessage();

            throw error;
        }
    }

    public async loadTov(projectKey: string, tovKey: string, projectName: string, tovName: string): Promise<void> {
        try {
            this.logger.debug(`[TestThemesTreeView] Loading TOV ${tovKey} for project ${projectKey}`);

            this.dataProvider.clearCache();
            this.currentProjectKey = projectKey;
            this.currentTovKey = tovKey;
            this.currentProjectName = projectName;
            this.currentTovName = tovName;
            this.isOpenedFromCycle = false;

            this.updateMarkingModuleConfiguration(false);

            // Update title with format: Test Themes (Project Name, TOV Name)
            const titleParts = ["Test Themes"];
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

            await vscode.commands.executeCommand("setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, false);

            const fetchedTestStructure = await this.dataProvider.fetchTovStructure(projectKey, tovKey);
            if (!fetchedTestStructure) {
                throw new Error("Failed to fetch test structure");
            }

            // Clear existing tree data only, preserving UI state (expansion, marking, etc.)
            this.clearTreeDataOnly();

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
            (this as any)._intentionallyCleared = false;

            this._onDidChangeTreeData.fire(undefined);
            await this.updateRobotFileAvailabilityForAllTreeItems();
            this._onDidChangeTreeData.fire(undefined);
            (this as any).updateTreeViewMessage();
        } catch (error) {
            this.logger.error("[TestThemesTreeView] Error loading TOV:", error);

            this.rootItems = [];
            (this as any)._lastDataFetch = Date.now();
            (this as any)._intentionallyCleared = false;
            this._onDidChangeTreeData.fire(undefined);
            (this as any).updateTreeViewMessage();

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
                const testGenerationContextMissingErrorMessage =
                    "[TestThemesTreeView] Could not determine the active Project, Cycle, or TOV context for test generation.";
                const testGenerationContextMissingErrorMessageForUser =
                    "Could not determine the active Project, Cycle, or TOV context for test generation.";
                vscode.window.showErrorMessage(testGenerationContextMissingErrorMessageForUser);
                this.logger.error(testGenerationContextMissingErrorMessage);
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
                    markingModule.clearAllMarkings();

                    // Mark the item and its descendants for import
                    // The marking module handles refreshing
                    const contextKey = cycleKey || tovKey || "";
                    markingModule.markItemWithDescendants(item, projectKey, contextKey, "import");

                    const persistenceModule = this.getModule("persistence") as PersistenceModule | undefined;
                    if (persistenceModule) {
                        await persistenceModule.forceSave();
                    }
                } else {
                    this.logger.warn(
                        `[TestThemesTreeView] Could not mark item ${item.label}: Marking module not available or item has no ID.`
                    );
                }
            } else if (
                testGenerationSuccessful &&
                ENABLE_ICON_MARKING_ON_TEST_GENERATION &&
                !this.isOpenedFromCycle &&
                tovKey
            ) {
                const markingModule = this.getModule("marking") as MarkingModule;
                if (markingModule && item.id) {
                    markingModule.clearAllMarkings();
                    markingModule.markItemWithDescendants(item, projectKey, tovKey, "generation");

                    // Force an immediate save of the state to disk to prevent data loss on reload.
                    const persistenceModule = this.getModule("persistence") as PersistenceModule | undefined;
                    if (persistenceModule) {
                        await persistenceModule.forceSave();
                    }
                } else {
                    this.logger.warn(
                        `[TestThemesTreeView] Could not mark item ${item.label}: Marking module not available or item has no ID.`
                    );
                }
            }

            if (testGenerationSuccessful) {
                await this.updateRobotFileAvailabilityForAllTreeItems();
                this._onDidChangeTreeData.fire(undefined);
            }
        } catch (error) {
            this.logger.error("[TestThemesTreeView] Error generating test cases:", error);
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
                cycleKey: this.isOpenedFromCycle ? this.currentCycleKey || undefined : this.currentTovKey || undefined
            };

            const item = new TestThemesTreeItem(treeItemData, this.extensionContext, parent);
            item.setMetadata("openedFromCycle", this.isOpenedFromCycle);
            item.updateId();
            this.applyModulesToTestThemesItem(item);

            return item;
        } catch (error) {
            this.logger.error("[TestThemesTreeView] Error creating tree item:", error);
            throw error;
        }
    }

    /**
     * Applies available modules to a test themes tree item
     * @param item The tree item to apply modules to
     */
    private applyModulesToTestThemesItem(item: TestThemesTreeItem): void {
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
            this.logger.warn(
                "[TestThemesTreeView] Cannot mark item for import: Test themes tree was opened from a TOV, not a cycle. Import is only available when opened from a cycle."
            );
            return;
        }

        const markingModule = this.getModule("marking") as MarkingModule | undefined;
        if (!markingModule || !item.id || !this.currentProjectKey || !this.currentCycleKey) {
            this.logger.warn("[TestThemesTreeView] Cannot mark item: Marking module or context is not available.", {
                hasModule: !!markingModule,
                id: item.id
            });
            return;
        }

        try {
            const isCurrentlyMarked = markingModule.isMarked(item.id);
            if (isCurrentlyMarked) {
                markingModule.unmarkItemByID(item.id);
            } else {
                markingModule.markItem(item, this.currentProjectKey, this.currentCycleKey, "import");
            }
            // The marking module will trigger the necessary refresh.
        } catch (error) {
            this.logger.error("[TestThemesTreeView] Error marking for import:", error);
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
     * Disposes of the tree view and all its resources
     */
    public async dispose(): Promise<void> {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
        if (this.vscTreeView) {
            this.vscTreeView.dispose();
            this.vscTreeView = undefined;
        }
        await super.dispose();
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
        super.clearTree();
        this.currentProjectKey = null;
        this.currentCycleKey = null;
        this.currentCycleLabel = null;
        this.currentTovKey = null;
        this.isOpenedFromCycle = false;
        this._onDidChangeTreeData.fire(undefined);
        this.resetTitle();
    }

    /**
     * Overrides the base refresh method to fetch data from the server
     *
     * @param item Optional specific item to refresh
     * @param options Optional refresh options
     */
    public override refresh(item?: TestThemesTreeItem, options?: { immediate?: boolean }): void {
        if (item) {
            super.refresh(item, options);
            return;
        }

        if (this.currentProjectKey && this.currentProjectName && this.currentTovName) {
            if (this.currentCycleKey && this.isOpenedFromCycle) {
                this.dataProvider.invalidateCache(this.currentProjectKey, this.currentCycleKey, false);
                this.loadCycle(
                    this.currentProjectKey,
                    this.currentCycleKey,
                    this.currentProjectName,
                    this.currentTovName,
                    this.currentCycleLabel || undefined
                ).catch((error) => {
                    this.logger.error(
                        "[TestThemesTreeView] Error refreshing test themes tree from cycle context:",
                        error
                    );
                });
            } else if (this.currentTovKey) {
                this.dataProvider.invalidateCache(this.currentProjectKey, this.currentTovKey, true);
                this.loadTov(
                    this.currentProjectKey,
                    this.currentTovKey,
                    this.currentProjectName,
                    this.currentTovName
                ).catch((error) => {
                    this.logger.error(
                        "[TestThemesTreeView] Error refreshing test themes tree from TOV context:",
                        error
                    );
                });
            } else {
                this.clearTree();
            }
        } else {
            this.clearTree();
        }
    }

    /**
     * Updates robot file availability for all tree items that can generate tests
     * and updates the context to show/hide the "Open Generated Robot File" button
     */
    private async updateRobotFileAvailabilityForAllTreeItems(): Promise<void> {
        try {
            const allTestThemeTreeItems = this.getAllTestThemeTreeItems();
            let hasAnyRobotFile = false;

            const robotFileChecks = allTestThemeTreeItems
                .filter((item) => item.canGenerateTests())
                .map(async (item) => {
                    try {
                        const hasRobotFile = await item.checkRobotFileExists();
                        if (hasRobotFile) {
                            hasAnyRobotFile = true;
                        }

                        item.updateContextValue();
                    } catch (error) {
                        this.logger.error(
                            `[TestThemesTreeView] Error checking robot file availability for ${item.data.base.name}:`,
                            error
                        );
                    }
                });

            await Promise.all(robotFileChecks);
            await vscode.commands.executeCommand("setContext", ContextKeys.HAS_GENERATED_ROBOT_FILE, hasAnyRobotFile);
        } catch (error) {
            this.logger.error("[TestThemesTreeView] Error updating robot file availability for all tree items:", error);
            throw error;
        }
    }

    /**
     * Gets all test theme tree items in the tree view recursively beginning from root items.
     * @returns Array of all tree items
     */
    public getAllTestThemeTreeItems(): TestThemesTreeItem[] {
        const items: TestThemesTreeItem[] = [];

        const collectTreeItems = (currentItems: TestThemesTreeItem[]) => {
            for (const item of currentItems) {
                items.push(item);
                if (item.children && item.children.length > 0) {
                    collectTreeItems(item.children as TestThemesTreeItem[]);
                }
            }
        };

        if (this.rootItems) {
            collectTreeItems(this.rootItems);
        }

        return items;
    }

    /**
     * Sets up click handlers for test case set items using the generalized click handler
     */
    private setupTestCaseSetClickHandlers(): void {
        this.testCaseSetClickHandler.updateHandlers({
            onSingleClick: async (item: TestThemesTreeItem) => {
                if (item.data.elementType === TestThemeItemTypes.TEST_CASE_SET) {
                    await this.handleTestCaseSetSingleClick(item);
                }
            },
            onDoubleClick: async (item: TestThemesTreeItem) => {
                if (item.data.elementType === TestThemeItemTypes.TEST_CASE_SET) {
                    await this.handleTestCaseSetDoubleClick(item);
                }
            }
        });
    }

    /**
     * Handles test case set single click events.
     * @param item The test case set tree item that was single clicked
     */
    private async handleTestCaseSetSingleClick(item: TestThemesTreeItem): Promise<void> {
        this.logger.debug(`[TestThemesTreeView] Test case set item single clicked: ${item.label}`);

        if (!item.hasGeneratedRobotFile()) {
            return;
        }

        await item.openGeneratedRobotFile();
    }

    /**
     * Handles test case set double click events.
     * @param item The test case set tree item that was double clicked
     */
    private async handleTestCaseSetDoubleClick(item: TestThemesTreeItem): Promise<void> {
        this.logger.debug(`[TestThemesTreeView] Test case set item double clicked: ${item.label}`);

        if (!item.hasGeneratedRobotFile()) {
            return;
        }

        await item.openGeneratedRobotFile();

        const robotFilePath = item.getRobotFilePath();
        if (robotFilePath) {
            const uri = vscode.Uri.file(robotFilePath);
            await vscode.commands.executeCommand("revealInExplorer", uri);
            this.logger.debug(`[TestThemesTreeView] Revealed robot file in explorer: ${robotFilePath}`);
        }
    }
}

export async function hideTestThemeTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_THEMES_TREE, false);
}

export async function displayTestThemeTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_THEMES_TREE, true);
    const filterService = FilterService.getInstance();
    filterService.setActiveTreeViewByContext(treeViews, ContextKeys.SHOW_TEST_THEMES_TREE);
}
