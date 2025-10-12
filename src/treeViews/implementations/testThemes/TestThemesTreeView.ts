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
import { TestStructure, TestStructureNode } from "../../../testBenchTypes";
import { getExtensionConfiguration } from "../../../configuration";
import {
    ALLOW_PERSISTENT_IMPORT_BUTTON,
    ENABLE_ICON_MARKING_ON_TEST_GENERATION,
    extensionContext,
    treeViews,
    userSessionManager
} from "../../../extension";
import { MarkingModule } from "../../features/MarkingModule";
import * as reportHandler from "../../../reportHandler";
import { TreeViewEventTypes } from "../../utils/EventBus";
import { PersistenceModule } from "../../features/PersistenceModule";
import { ClickHandler } from "../../core/ClickHandler";
import { ProjectsTreeItem } from "../projects/ProjectsTreeItem";

/**
 * Interface for filter storage
 */
interface TestThemeFilterStorage {
    [contextKey: string]: any[];
}

export class TestThemesTreeView extends TreeViewBase<TestThemesTreeItem> {
    private dataProvider: TestThemesDataProvider;
    private disposables: vscode.Disposable[] = [];
    public testCaseSetClickHandler: ClickHandler<TestThemesTreeItem>;

    private currentProjectKey: string | null = null;
    private currentProjectName: string | null = null;
    private currentTovKey: string | null = null;
    private currentTovName: string | null = null;
    private isOpenedFromCycle = false;
    private currentCycleKey: string | null = null;
    private currentCycleLabel: string | null = null;
    private filterDiffMode: boolean = false;

    constructor(
        extensionContext: vscode.ExtensionContext,
        private getConnection: () => PlayServerConnection | null,
        config?: Partial<TreeViewConfig>
    ) {
        super(extensionContext, { ...testThemesConfig, ...config });
        this.dataProvider = new TestThemesDataProvider(this.logger, getConnection);
        this.testCaseSetClickHandler = new ClickHandler<TestThemesTreeItem>();

        this.registerEventHandlers();
        this.registerCommands();
        this.setupTestCaseSetClickHandlers();
        this.updateTestThemesFilterContextKey();
    }

    /**
     * Gets the user-specific storage key for the filter storage containing all contexts
     * @returns The user-specific storage key or fallback to global key if no user session exists
     */
    private getTestThemeFilterStorageKey(): string {
        const userStorageKey = userSessionManager.getUserStorageKey(
            `${StorageKeys.TEST_THEME_TREE_FILTERS}.structured`
        );
        return userStorageKey || `${StorageKeys.TEST_THEME_TREE_FILTERS}.structured`;
    }

    /**
     * Gets the test theme filter storage object from workspace state
     * @returns The storage object
     */
    private getTestThemeFilterStorage(): TestThemeFilterStorage {
        return this.extensionContext.workspaceState.get<TestThemeFilterStorage>(
            this.getTestThemeFilterStorageKey(),
            {}
        );
    }

    /**
     * Saves the test theme filter storage object to workspace state
     * @param storage The test theme filter storage object to save
     */
    private async saveTestThemeFilterStorage(storage: TestThemeFilterStorage): Promise<void> {
        await this.extensionContext.workspaceState.update(this.getTestThemeFilterStorageKey(), storage);
    }

    /**
     * Generates a context key for the structured storage based on the current tree view context.
     * @returns The context key for structured storage, or null if context is not available
     */

    public getContextKey(): string | null {
        if (!this.currentProjectKey) {
            return null;
        }

        if (this.isOpenedFromCycle && this.currentCycleKey && this.currentTovKey) {
            return `${this.currentProjectKey}.${this.currentTovKey}.${this.currentCycleKey}`;
        }

        if (!this.isOpenedFromCycle && this.currentTovKey) {
            return `${this.currentProjectKey}.${this.currentTovKey}`;
        }
        return null;
    }

    /**
     * Gets the saved test theme tree filters from structured storage for the current context.
     * @returns The saved filters array or empty array if none exist.
     */
    public getSavedFilters(): any[] {
        const contextKey = this.getContextKey();
        if (!contextKey) {
            // No valid context available, return empty filters
            return [];
        }

        const structuredStorage = this.getTestThemeFilterStorage();
        return structuredStorage[contextKey] || [];
    }

    /**
     * Saves test theme tree filters to structured storage for the current context.
     * @param filters The filters array to save.
     */
    public async saveFilters(filters: any[]): Promise<void> {
        const contextKey = this.getContextKey();

        if (!contextKey) {
            this.logger.warn(`[TestThemesTreeView] Cannot save ${filters.length} filters: no valid context available`);
            return;
        }

        const structuredStorage = this.getTestThemeFilterStorage();

        if (filters.length === 0) {
            delete structuredStorage[contextKey];
        } else {
            structuredStorage[contextKey] = filters;
        }

        await this.saveTestThemeFilterStorage(structuredStorage);
        this.logger.debug(`[TestThemesTreeView] Saved ${filters.length} test theme filters for context: ${contextKey}`);
        await this.updateTestThemesFilterContextKey();
    }

    /**
     * Clears saved test theme tree filters from structured storage for the current context.
     */
    public async clearSavedFilters(): Promise<void> {
        await this.saveFilters([]);
        const contextKey = this.getContextKey();
        this.logger.trace(`[TestThemesTreeView] Cleared test theme filters for context: ${contextKey || "no-context"}`);
        await this.updateTestThemesFilterContextKey();
    }

    /**
     * Gets all context keys that have stored filters
     * @returns Array of context keys that have filter data
     */
    public getAllFilterContextKeys(): string[] {
        const structuredStorage = this.getTestThemeFilterStorage();
        return Object.keys(structuredStorage);
    }

    /**
     * Gets filter data for all contexts
     * @returns Object containing all context filter data
     */
    public getAllContextFilters(): TestThemeFilterStorage {
        return this.getTestThemeFilterStorage();
    }

    /**
     * Clears filters for a specific context
     * @param contextKey The context key to clear
     */
    public async clearFiltersForContext(contextKey: string): Promise<void> {
        const structuredStorage = this.getTestThemeFilterStorage();
        delete structuredStorage[contextKey];
        await this.saveTestThemeFilterStorage(structuredStorage);
        this.logger.debug(`[TestThemesTreeView] Cleared filters for context: ${contextKey}`);
    }

    /**
     * Gets the currently saved test theme filters for the active test themes tree view context.
     * @returns The saved filters array or empty array if none exist.
     */
    public static getCurrentFilters(): any[] {
        if (treeViews?.testThemesTree) {
            return treeViews.testThemesTree.getSavedFilters();
        }
        return [];
    }

    /**
     * Validates a list of stored filters against a list of filters from the server.
     * @param storedFilters The filters saved in the workspace state
     * @param serverFilters The current list of filters from the server
     * @param logger A logger instance for debugging
     * @returns An object containing the valid and removed filters
     */
    private static validateFilters(
        storedFilters: any[],
        serverFilters: any[]
    ): { validFilters: any[]; removedFilters: any[] } {
        const serverFiltersByName = new Map<string, any>();
        const serverFiltersBySerial = new Map<string, any>();
        serverFilters.forEach((filter: any) => {
            if (filter.name) {
                serverFiltersByName.set(filter.name, filter);
            }
            if (filter.key?.serial) {
                serverFiltersBySerial.set(filter.key.serial, filter);
            }
        });

        const validFilters: any[] = [];
        const removedFilters: any[] = [];
        storedFilters.forEach((storedFilter) => {
            let isValid = false;
            let matchedServerFilter = null;
            if (storedFilter.key?.serial && serverFiltersBySerial.has(storedFilter.key.serial)) {
                matchedServerFilter = serverFiltersBySerial.get(storedFilter.key.serial);
                isValid = true;
            } else if (storedFilter.name && serverFiltersByName.has(storedFilter.name)) {
                const serverFilter = serverFiltersByName.get(storedFilter.name);
                if (storedFilter.type && serverFilter.type) {
                    isValid = storedFilter.type === serverFilter.type;
                    if (isValid) {
                        matchedServerFilter = serverFilter;
                    }
                } else {
                    isValid = true;
                    matchedServerFilter = serverFilter;
                }
            }

            if (isValid && matchedServerFilter) {
                validFilters.push(matchedServerFilter);
            } else {
                removedFilters.push(storedFilter);
            }
        });

        return { validFilters, removedFilters };
    }

    /**
     * Validates stored filters against current server filters to avoid using invalid / outdated filters.
     * Prioritizes filter key (serial) validation over name validation since filter names can be
     * swapped on server side but filter keys remain immutable.
     * @returns Promise resolving to validated filters for API requests
     */
    private static async validateAndGetCurrentFilters(): Promise<any[]> {
        if (!treeViews?.testThemesTree) {
            return [];
        }

        const contextKey = treeViews.testThemesTree.getContextKey();
        const storedFilters = treeViews.testThemesTree.getSavedFilters();
        treeViews.testThemesTree.logger.debug(
            `[TestThemesTreeView] validateAndGetCurrentFilters: context=${contextKey}, filters=${storedFilters.length}`
        );

        if (storedFilters.length === 0) {
            return [];
        }

        const connection = treeViews.testThemesTree.getConnection();

        if (!connection) {
            treeViews.testThemesTree.logger.warn("[TestThemesTreeView] No connection available for filter validation");
            await treeViews.testThemesTree.saveFilters([]);
            return [];
        }

        try {
            const serverFilters = await connection.getFiltersFromOldPlayServer();
            if (!serverFilters || !Array.isArray(serverFilters)) {
                treeViews.testThemesTree.logger.warn(
                    "[TestThemesTreeView] Could not fetch server filters for validation"
                );
                await treeViews.testThemesTree.saveFilters([]);
                return [];
            }

            const { validFilters, removedFilters } = TestThemesTreeView.validateFilters(storedFilters, serverFilters);

            if (removedFilters.length > 0) {
                const contextInfo = treeViews.testThemesTree.getContextKey() || "no-context";
                vscode.window
                    .showWarningMessage(
                        `Some applied filters for "${contextInfo}" are no longer valid on the server and have been cleared. You can re-select filters if needed.`,
                        "Re-select Filters"
                    )
                    .then(async (selection) => {
                        if (selection === "Re-select Filters") {
                            await vscode.commands.executeCommand("testbenchExtension.displayFiltersForTestThemeTree");
                        }
                    });

                await treeViews.testThemesTree.saveFilters(validFilters);
                treeViews.testThemesTree.logger.info(
                    `[TestThemesTreeView] Removed ${removedFilters.length} invalid filter(s) for context "${contextInfo}": ${removedFilters.map((f) => f.name).join(", ")}`
                );
            }

            return validFilters;
        } catch (error) {
            treeViews.testThemesTree.logger.error("[TestThemesTreeView] Error validating stored filters:", error);
            await treeViews.testThemesTree.saveFilters([]);
            return [];
        }
    }

    /**
     * Transforms saved filters from server response format to API request format.
     * @param savedFilters The filters as saved from the server response
     * @returns The filters transformed for API requests
     */
    public static transformFiltersForApiRequest(
        savedFilters: any[]
    ): { name: string; filterType: "TestTheme" | "TestCase" | "TestCaseSet"; testThemeUID: string }[] {
        return savedFilters.map((filter) => ({
            name: filter.name,
            filterType: filter.type as "TestTheme" | "TestCase" | "TestCaseSet",
            testThemeUID: "" // Apply to all test themes by default
        }));
    }

    /**
     * Applies filters and refreshes the tree view.
     * @param filters The filters array to save and apply.
     */
    public async applyFiltersAndRefresh(filters: any[]): Promise<void> {
        await this.saveFilters(filters);
        this.refresh();
        this.logger.debug(`[TestThemesTreeView] Applied ${filters.length} filters and refreshed tree view`);
    }

    /**
     * Clears all filters and refreshes the tree view.
     */
    public async clearFiltersAndRefresh(): Promise<void> {
        await this.clearSavedFilters();
        this.refresh();
        this.logger.debug(`[TestThemesTreeView] Cleared all filters and refreshed tree view`);
    }

    /**
     * Toggles the filter diff mode and updates the tree view.
     * When enabled, shows filtered out tree items with an icon defined in IconModule.
     * When disabled, hides filtered out items.
     */
    public async toggleFilterDiffMode(): Promise<void> {
        this.filterDiffMode = !this.filterDiffMode;
        await vscode.commands.executeCommand(
            "setContext",
            ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_THEMES,
            this.filterDiffMode
        );
        this.logger.debug(`[TestThemesTreeView] Filter diff mode ${this.filterDiffMode ? "enabled" : "disabled"}
            and context key ${ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_THEMES} set to ${this.filterDiffMode}`);

        if (this.currentProjectKey && this.currentCycleKey && this.isOpenedFromCycle) {
            this.dataProvider.clearCache();
            await this.loadCycle(
                this.currentProjectKey,
                this.currentCycleKey,
                this.currentTovKey || "",
                this.currentProjectName || "",
                this.currentTovName || "",
                this.currentCycleLabel || undefined
            );
        } else if (this.currentProjectKey && this.currentTovKey && !this.isOpenedFromCycle) {
            this.dataProvider.clearCache();
            await this.loadTov(
                this.currentProjectKey,
                this.currentTovKey,
                this.currentProjectName || "",
                this.currentTovName || ""
            );
        } else {
            this.refresh();
        }
    }

    /**
     * Gets the current filter diff mode state.
     * @returns True if filter diff mode is enabled, false otherwise.
     */
    public isFilterDiffModeEnabled(): boolean {
        return this.filterDiffMode;
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
        /*
        // cycle:selected is not emitted anymore, setupCycleClickHandlers of ProjectsTreeView handles this
        this.eventBus.on("cycle:selected", async (event) => {
            const { projectKey, cycleKey, tovKey, projectName, tovName, cycleLabel } = event.data;
            await this.loadCycle(projectKey, cycleKey, tovKey, projectName, tovName, cycleLabel);
        });
        */
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
            // TODO: Check if there are results in TestBench and only ask if they already exist
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
                const importSuccessfulMessageForUser = `Successfully imported Robot Framework test results for ${reportRootUID} (${itemLabel}) to TestBench.`;
                this.logger.info(`[TestThemesTreeView] ${importSuccessfulMessageForUser}`);
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
     * @param tovKey The TOV key (required for context generation)
     * @param projectName The project name
     * @param tovName The TOV name
     * @param cycleLabel Optional cycle label for display
     * @return Promise that resolves when loading is complete
     */
    public async loadCycle(
        projectKey: string,
        cycleKey: string,
        tovKey: string,
        projectName: string,
        tovName: string,
        cycleLabel?: string
    ): Promise<void> {
        try {
            this.logger.trace(
                `[TestThemesTreeView] Loading Test Cycle '${cycleLabel}' from project '${projectName}' to get Test Theme information...`
            );
            this.stateManager.setLoading(true);
            this.dataProvider.clearCache();

            // Set context before fetching data so filters can be applied correctly
            this.currentProjectKey = projectKey;
            this.currentCycleKey = cycleKey;
            this.currentTovKey = tovKey;
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

            // When filter diff mode is on, dont suppress filtered data so we can display all items
            const suppressFilteredData = !this.filterDiffMode;
            this.logger.trace(
                `[TestThemesTreeView] Fetching cycle structure with suppressFilteredData=${suppressFilteredData} (filterDiffMode=${this.filterDiffMode})`
            );
            const fetchedTestStructure = await this.dataProvider.fetchCycleStructure(
                projectKey,
                cycleKey,
                suppressFilteredData
            );
            await this._processAndRenderTree(fetchedTestStructure);
        } catch (error) {
            this._handleLoadError(error, "cycle");
        }
    }

    private async _processAndRenderTree(fetchedTestStructure: TestStructure | null): Promise<void> {
        if (!fetchedTestStructure) {
            throw new Error("Failed to fetch test structure");
        }

        this.clearTreeDataOnly();
        type NodeWithChildren = TestStructureNode & { hasChildren: boolean };

        // Build the tree structure
        const nodeMap = new Map<string, NodeWithChildren>(
            fetchedTestStructure.nodes.map((node: TestStructureNode) => [
                node.base.key,
                { ...node, hasChildren: false }
            ])
        );

        // Calculate which nodes have children
        for (const node of nodeMap.values()) {
            if (node.base.parentKey && nodeMap.has(node.base.parentKey)) {
                const parentNode = nodeMap.get(node.base.parentKey);
                if (parentNode) {
                    parentNode.hasChildren = true;
                }
            }
        }

        const rootItems = this.buildTreeRecursively(fetchedTestStructure.root.base.key, null, nodeMap);
        this.rootItems = rootItems;

        // Set the last data fetch timestamp to prevent infinite loading
        // This is important even for empty results to prevent the tree from continuously trying to load data
        (this as any)._lastDataFetch = Date.now();
        (this as any)._intentionallyCleared = false;

        this.stateManager.setLoading(false);
        this._onDidChangeTreeData.fire(undefined);
        await this.updateRobotFileAvailabilityForAllTreeItems();
        this._onDidChangeTreeData.fire(undefined);
        (this as any).updateTreeViewMessage();

        const currentFilters = this.getSavedFilters();
        this.logger.debug(
            `[TestThemesTreeView] Successfully loaded data with ${currentFilters.length} saved filters for context: ${this.getContextKey()}`
        );
        if (currentFilters.length > 0) {
            this.logger.debug(
                `[TestThemesTreeView] Saved filter names: ${currentFilters.map((f) => f.name).join(", ")}`
            );
        }
        await vscode.commands.executeCommand(
            "setContext",
            ContextKeys.TEST_THEME_TREE_HAS_FILTERS,
            currentFilters.length > 0
        );
    }

    private _handleLoadError(error: unknown, context: string): void {
        this.logger.error(`[TestThemesTreeView] Error loading ${context}:`, error);

        this.rootItems = [];
        (this as any)._lastDataFetch = Date.now();
        (this as any)._intentionallyCleared = false;
        this.stateManager.setLoading(false);
        this._onDidChangeTreeData.fire(undefined);
        (this as any).updateTreeViewMessage();

        throw error;
    }

    public async loadTov(projectKey: string, tovKey: string, projectName: string, tovName: string): Promise<void> {
        try {
            this.logger.debug(`[TestThemesTreeView] Loading TOV ${tovKey} for project ${projectKey}`);
            this.stateManager.setLoading(true);

            this.dataProvider.clearCache();

            // Set context BEFORE fetching data so filters can be applied correctly
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

            const suppressFilteredData = !this.filterDiffMode;
            this.logger.trace(
                `[TestThemesTreeView] Fetching TOV structure with suppressFilteredData=${suppressFilteredData} (filterDiffMode=${this.filterDiffMode})`
            );
            const fetchedTestStructure = await this.dataProvider.fetchTovStructure(
                projectKey,
                tovKey,
                suppressFilteredData
            );
            await this._processAndRenderTree(fetchedTestStructure);
        } catch (error) {
            this._handleLoadError(error, "TOV");
        }
    }

    /**
     * Determines if a tree item should be visible.
     * @param nodeData The node data containing visibility information
     * @returns `true` if the item should be visible, otherwise `false`.
     */
    private _isVisible(nodeData: TestStructureNode): boolean {
        // A test theme tree item is not visible in test theme view if:
        // - It is a "Test Case"
        // - Execution status is "NotPlanned"
        // - Item is locked by system (-2)
        // - When filter diff mode is OFF and matchesFilter is false
        if (nodeData.elementType === TestThemeItemTypes.TEST_CASE) {
            return false;
        }

        if (nodeData.exec?.status === "NotPlanned") {
            return false;
        }
        if (nodeData.exec?.locker === "-2") {
            return false;
        }

        // If filter diff mode is disabled and there are filters applied,
        // hide items that don't match the filter
        if (!this.filterDiffMode && nodeData.base?.matchesFilter === false) {
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
        nodeMap: Map<string, TestStructureNode & { hasChildren: boolean }>
    ): TestThemesTreeItem[] {
        const children: TestThemesTreeItem[] = [];
        // Find all nodes that have this parent key
        for (const nodeData of nodeMap.values()) {
            if (nodeData.base.parentKey === parentKey) {
                const item = this.createTreeItem(nodeData, parent || undefined);
                // Recursively build children for the visible item
                const grandChildren = this.buildTreeRecursively(nodeData.base.key, item, nodeMap);
                item.children = grandChildren;

                // An item is included if it's visible itself, or if it has visible children.
                if (this._isVisible(nodeData) || grandChildren.length > 0) {
                    children.push(item);
                }
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

            // Apply filter diff icon if filter diff mode is enabled and item doesn't match filter
            if (this.filterDiffMode && treeItemData.base.matchesFilter === false) {
                item.isFilteredOutInDiffMode = true;
            }

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
        this.updateTestThemesFilterContextKey();
    }

    /**
     * Updates the test themes filter context key based on current saved filters
     */
    public async updateTestThemesFilterContextKey(): Promise<void> {
        const currentFilters = this.getSavedFilters();
        const hasFilters = currentFilters.length > 0;
        this.logger.trace(
            `[TestThemesTreeView] Updating filter context key: hasFilters=${hasFilters}, filterCount=${currentFilters.length}`
        );
        await vscode.commands.executeCommand("setContext", ContextKeys.TEST_THEME_TREE_HAS_FILTERS, hasFilters);
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
                    this.currentTovKey!,
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
        this.logger.debug(`[TestThemesTreeView] Clicked Test Case Set '${item.label}'.`);

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
        this.logger.debug(`[TestThemesTreeView] Double clicked Test Case Set '${item.label}'.`);

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

    /**
     * Gets validated filters for API requests without making any test API calls.
     * Performs comprehensive validation against the filters endpoint only.
     * @returns Promise resolving to validated filters for API requests
     */
    public static async getValidatedFiltersForApiRequest(): Promise<
        {
            name: string;
            filterType: "TestTheme" | "TestCase" | "TestCaseSet";
            testThemeUID: string;
        }[]
    > {
        const validatedFilters = await TestThemesTreeView.validateAndGetCurrentFilters();
        return TestThemesTreeView.transformFiltersForApiRequest(validatedFilters);
    }

    /**
     * Clears all context-specific filter storage completely for the current user.
     * This method properly cleans up all filter data across all contexts for the current user.
     */
    public async clearAllContextSpecificFilters(): Promise<void> {
        await this.saveTestThemeFilterStorage({});
        this.logger.info("[TestThemesTreeView] Cleared all test theme filter storage for current user");
    }

    /**
     * Generates a context key from a ProjectsTreeItem for filter storage.
     * @param item The ProjectsTreeItem (cycle, TOV, or project item)
     * @returns The context key for getting appropriate filters
     */
    public static getContextKeyFromProjectsTreeItem(item: ProjectsTreeItem): string | null {
        const projectKey = item.getProjectKey();
        const versionKey = item.getVersionKey();
        const cycleKey = item.getCycleKey();

        if (!projectKey) {
            return null;
        }

        if (cycleKey && versionKey) {
            return `${projectKey}.${versionKey}.${cycleKey}`;
        }

        if (versionKey) {
            return `${projectKey}.${versionKey}`;
        }

        return null;
    }

    /**
     * Generates a context key from a TestThemesTreeItem for filter storage.
     * @param item The TestThemesTreeItem
     * @returns The context key for getting appropriate filters
     */
    public static getContextKeyFromTestThemesTreeItem(item: TestThemesTreeItem): string | null {
        const projectKey = item.data.projectKey;
        const cycleKey = item.data.cycleKey;

        if (!projectKey || !cycleKey) {
            if (treeViews?.testThemesTree) {
                treeViews.testThemesTree.logger.debug(
                    `[TestThemesTreeView] Missing keys for context: projectKey=${projectKey}, cycleKey=${cycleKey}`
                );
            }
            return null;
        }

        const isOpenedFromCycle = item.getMetadata("openedFromCycle") === true;

        if (isOpenedFromCycle) {
            if (treeViews?.testThemesTree) {
                const currentCycleKey = treeViews.testThemesTree.getCurrentCycleKey();
                if (currentCycleKey) {
                    const contextKey = `${projectKey}.${cycleKey}.${currentCycleKey}`;
                    treeViews.testThemesTree.logger.debug(
                        `[TestThemesTreeView] Generated cycle context key: ${contextKey} (projectKey=${projectKey}, tovKey=${cycleKey}, cycleKey=${currentCycleKey})`
                    );

                    return contextKey;
                }
            }

            // Fallback to TOV context
            const fallbackKey = `${projectKey}.${cycleKey}`;
            if (treeViews?.testThemesTree) {
                treeViews.testThemesTree.logger.debug(
                    `[TestThemesTreeView] Using TOV fallback context key: ${fallbackKey}`
                );
            }

            return fallbackKey;
        }

        const tovContextKey = `${projectKey}.${cycleKey}`;

        if (treeViews?.testThemesTree) {
            treeViews.testThemesTree.logger.debug(`[TestThemesTreeView] Generated TOV context key: ${tovContextKey}`);
        }

        return tovContextKey;
    }

    /**
     * Gets the user-specific storage key for structured filter storage (static version)
     * @returns The user-specific storage key or fallback to global key if no user session exists
     */
    private static getStructuredFilterStorageKeyStatic(): string {
        const userStorageKey = userSessionManager.getUserStorageKey(
            `${StorageKeys.TEST_THEME_TREE_FILTERS}.structured`
        );
        return userStorageKey || `${StorageKeys.TEST_THEME_TREE_FILTERS}.structured`;
    }

    /**
     * Gets filters for a specific context key from structured storage.
     * @param contextKey The context key in format "projectKey.tovKey" or "projectKey.tovKey.cycleKey"
     * @returns The filters for that context or empty array if none exist
     */
    public static getFiltersForContext(contextKey: string): any[] {
        if (!extensionContext) {
            return [];
        }

        const structuredStorage = extensionContext.workspaceState.get<TestThemeFilterStorage>(
            TestThemesTreeView.getStructuredFilterStorageKeyStatic(),
            {}
        );
        return structuredStorage[contextKey] || [];
    }

    /**
     * Validates stored filters for a specific context against server filters.
     * @param contextKey The context key to get filters for
     * @returns Promise resolving to validated filters in server format
     */
    private static async validateFiltersForSpecificContext(contextKey: string | null): Promise<any[]> {
        if (!contextKey) {
            return [];
        }

        const storedFilters = TestThemesTreeView.getFiltersForContext(contextKey);

        if (storedFilters.length === 0) {
            return [];
        }

        const connection = treeViews?.testThemesTree?.getConnection();

        if (!connection) {
            treeViews?.testThemesTree?.logger.warn(
                "[TestThemesTreeView] No connection available for filter validation"
            );
            return [];
        }

        try {
            const serverFilters = await connection.getFiltersFromOldPlayServer();
            if (!serverFilters || !Array.isArray(serverFilters)) {
                treeViews?.testThemesTree?.logger.warn(
                    "[TestThemesTreeView] Could not fetch server filters for validation"
                );
                return [];
            }

            const { validFilters } = TestThemesTreeView.validateFilters(storedFilters, serverFilters);
            return validFilters;
        } catch (error) {
            treeViews?.testThemesTree?.logger.error(
                "[TestThemesTreeView] Error validating filters for specific context:",

                error
            );

            return [];
        }
    }

    /**
     * Gets validated filters for API requests for a specific context.
     * @param contextKey The context key to get filters for
     * @returns Promise resolving to validated filters for API requests
     */
    public static async getValidatedFiltersForSpecificContext(contextKey: string | null): Promise<
        {
            name: string;
            filterType: "TestTheme" | "TestCase" | "TestCaseSet";
            testThemeUID: string;
        }[]
    > {
        if (treeViews?.testThemesTree) {
            treeViews.testThemesTree.logger.debug(`[TestThemesTreeView] Validating filters for context: ${contextKey}`);
        }

        const validatedFilters = await TestThemesTreeView.validateFiltersForSpecificContext(contextKey);
        const apiFilters = TestThemesTreeView.transformFiltersForApiRequest(validatedFilters);

        if (treeViews?.testThemesTree) {
            treeViews.testThemesTree.logger.debug(
                `[TestThemesTreeView] Found ${validatedFilters.length} validated filters, transformed to ${apiFilters.length} API filters for context: ${contextKey}`
            );

            if (apiFilters.length > 0) {
                treeViews.testThemesTree.logger.debug(
                    `[TestThemesTreeView] API filters: ${JSON.stringify(apiFilters.map((f) => ({ name: f.name, type: f.filterType })))}`
                );
            }
        }

        return apiFilters;
    }

    /**
     * Gets validated filters for API requests from a tree item (either ProjectsTreeItem or TestThemesTreeItem).
     * @param item The tree item to get context from
     * @returns Promise resolving to validated filters for API requests
     */
    public static async getValidatedFiltersForTreeItem(item: ProjectsTreeItem | TestThemesTreeItem): Promise<
        {
            name: string;
            filterType: "TestTheme" | "TestCase" | "TestCaseSet";
            testThemeUID: string;
        }[]
    > {
        let contextKey: string | null = null;

        if (treeViews?.testThemesTree) {
            const instanceContextKey = treeViews.testThemesTree.getContextKey();
            if (instanceContextKey) {
                contextKey = instanceContextKey;
                treeViews.testThemesTree.logger.trace(
                    `[TestThemesTreeView] Using instance context key: ${contextKey} for item: ${item.label}`
                );
            }
        }

        // Fallback to context key generation
        if (!contextKey) {
            if (item instanceof ProjectsTreeItem) {
                contextKey = TestThemesTreeView.getContextKeyFromProjectsTreeItem(item);
            } else if (item instanceof TestThemesTreeItem) {
                contextKey = TestThemesTreeView.getContextKeyFromTestThemesTreeItem(item);
            }

            if (treeViews?.testThemesTree) {
                treeViews.testThemesTree.logger.trace(
                    `[TestThemesTreeView] Using static context key: ${contextKey} for item: ${item.label}`
                );
            }
        }

        if (treeViews?.testThemesTree) {
            const allContextKeys = treeViews.testThemesTree.getAllFilterContextKeys();

            treeViews.testThemesTree.logger.trace(
                `[TestThemesTreeView] Available filter context keys: ${JSON.stringify(allContextKeys)}`
            );
        }

        const result = await TestThemesTreeView.getValidatedFiltersForSpecificContext(contextKey);

        if (treeViews?.testThemesTree) {
            treeViews.testThemesTree.logger.debug(
                `[TestThemesTreeView] Retrieved ${result.length} filters for context key: ${contextKey}`
            );

            if (result.length > 0) {
                treeViews.testThemesTree.logger.debug(
                    `[TestThemesTreeView] Filter names: ${result.map((f) => f.name).join(", ")}`
                );
            }
        }

        return result;
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
}
