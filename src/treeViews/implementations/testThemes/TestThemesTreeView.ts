/**
 * @file src/treeViews/implementations/testThemes/TestThemesTreeView.ts
 * @description Tree view implementation for managing test themes and test cases.
 */

import * as vscode from "vscode";
import { RefreshOptions, TreeViewBase } from "../../core/TreeViewBase";
import { TestThemesTreeItem, TestThemeData, TestThemeType } from "./TestThemesTreeItem";
import { TreeViewConfig } from "../../core/TreeViewConfig";
import { TestThemesDataProvider } from "./TestThemesDataProvider";
import { testThemesConfig } from "./TestThemesConfig";
import { PlayServerConnection } from "../../../testBenchConnection";
import { allExtensionCommands, ConfigKeys, ContextKeys, StorageKeys, TestThemeItemTypes } from "../../../constants";
import { TestStructure, TestStructureNode } from "../../../testBenchTypes";
import { getExtensionConfiguration, getExtensionSetting } from "../../../configuration";
import {
    ALLOW_PERSISTENT_IMPORT_BUTTON,
    ENABLE_ICON_MARKING_ON_TEST_GENERATION,
    extensionContext,
    treeViews,
    userSessionManager
} from "../../../extension";
import { MarkingModule, MarkingContext } from "../../features/MarkingModule";
import * as reportHandler from "../../../reportHandler";
import { TreeViewEventTypes } from "../../utils/EventBus";
import { PersistenceModule } from "../../features/PersistenceModule";
import { ClickHandler } from "../../core/ClickHandler";
import { ProjectsTreeItem } from "../projects/ProjectsTreeItem";
import { LockerValue, normalizeLockerKey, SYSTEM_LOCK_KEY } from "./lockUtils";

/**
 * Interface for filter storage
 */
interface TestThemeFilterStorage {
    [contextKey: string]: any[];
}

/**
 * Interface for test generation context
 */
interface GenerationContext {
    projectKey: string;
    cycleKey: string;
    tovKey: string;
    isOpenedFromCycle: boolean;
}

interface ScopeLockInfo {
    lockedDescendantNames: string[];
    isSelectedScopeLocked: boolean;
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
    private robotFilesWatcher: vscode.FileSystemWatcher | undefined;
    private markingRefreshDebounceHandle: NodeJS.Timeout | undefined;

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
        this.setupRobotFilesWatcher();
    }

    public override async initialize(): Promise<void> {
        await super.initialize();

        const markingModule = this.getModule("marking") as MarkingModule | undefined;
        if (markingModule) {
            markingModule.setContextResolver(() => this.getCurrentMarkingContext());
        }
    }

    private getCurrentMarkingContext(overrides?: Partial<MarkingContext>): MarkingContext {
        const base: MarkingContext = {
            projectKey: this.currentProjectKey ?? undefined,
            tovKey: this.currentTovKey ?? undefined,
            contextType: this.isOpenedFromCycle ? "cycle" : "tov",
            contextId: this.getContextKey() ?? undefined
        };

        if (this.isOpenedFromCycle) {
            base.cycleKey = this.currentCycleKey ?? undefined;
        } else {
            base.cycleKey = this.currentTovKey ?? undefined;
        }

        return { ...base, ...overrides };
    }

    private buildGenerationMarkingContext(context: GenerationContext): MarkingContext {
        return this.getCurrentMarkingContext(
            context.isOpenedFromCycle
                ? {
                      projectKey: context.projectKey ?? this.currentProjectKey ?? undefined,
                      tovKey: context.tovKey ?? this.currentTovKey ?? undefined,
                      cycleKey: context.cycleKey ?? this.currentCycleKey ?? undefined,
                      contextType: "cycle"
                  }
                : {
                      projectKey: context.projectKey ?? this.currentProjectKey ?? undefined,
                      tovKey: context.tovKey ?? this.currentTovKey ?? undefined,
                      cycleKey: context.tovKey ?? this.currentTovKey ?? undefined,
                      contextType: "tov"
                  }
        );
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
        // Disable filter diff mode if no test theme filter is active
        if (filters.length === 0 && this.filterDiffMode) {
            await this.setFilterDiffMode(false);
        }
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
        // Refetch data from server so that suppressFilteredData respects current diff mode
        this.dataProvider.clearCache();
        if (this.currentProjectKey && this.currentCycleKey && this.isOpenedFromCycle) {
            await this.loadCycle(
                this.currentProjectKey,
                this.currentCycleKey,
                this.currentTovKey || "",
                this.currentProjectName || "",
                this.currentTovName || "",
                this.currentCycleLabel || undefined
            );
        } else if (this.currentProjectKey && this.currentTovKey && !this.isOpenedFromCycle) {
            await this.loadTov(
                this.currentProjectKey,
                this.currentTovKey,
                this.currentProjectName || "",
                this.currentTovName || ""
            );
        } else {
            this.refresh();
        }
        this.logger.debug(`[TestThemesTreeView] Applied ${filters.length} filters and reloaded data`);
    }

    /**
     * Clears all filters and refreshes the tree view.
     */
    public async clearFiltersAndRefresh(): Promise<void> {
        await this.clearSavedFilters();
        // Refetch data from server so that suppressFilteredData respects current diff mode
        this.dataProvider.clearCache();
        if (this.currentProjectKey && this.currentCycleKey && this.isOpenedFromCycle) {
            await this.loadCycle(
                this.currentProjectKey,
                this.currentCycleKey,
                this.currentTovKey || "",
                this.currentProjectName || "",
                this.currentTovName || "",
                this.currentCycleLabel || undefined
            );
        } else if (this.currentProjectKey && this.currentTovKey && !this.isOpenedFromCycle) {
            await this.loadTov(
                this.currentProjectKey,
                this.currentTovKey,
                this.currentProjectName || "",
                this.currentTovName || ""
            );
        } else {
            this.refresh();
        }
        this.logger.debug(`[TestThemesTreeView] Cleared all filters and reloaded data`);
    }

    /**
     * Sets the filter diff mode and updates the tree view.
     * @param enabled True to enable filter diff mode, false to disable.
     */
    private async setFilterDiffMode(enabled: boolean): Promise<void> {
        if (this.filterDiffMode === enabled) {
            return; // No change needed
        }
        this.filterDiffMode = enabled;
        await vscode.commands.executeCommand(
            "setContext",
            ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_THEMES,
            this.filterDiffMode
        );
        this.logger.debug(
            `[TestThemesTreeView] Filter diff mode ${
                this.filterDiffMode ? "enabled" : "disabled"
            } and context key ${ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_THEMES} set to ${this.filterDiffMode}`
        );

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
     * Enables the filter diff mode.
     */
    public async enableFilterDiffMode(): Promise<void> {
        // Only enable if test theme filter is active
        const hasFilters = this.getSavedFilters().length > 0;
        if (!hasFilters) {
            this.logger.trace(
                "[TestThemesTreeView] Skipping enabling filter diff mode: no active test theme filters present"
            );
            return;
        }
        await this.setFilterDiffMode(true);
    }

    /**
     * Disables the filter diff mode.
     */
    public async disableFilterDiffMode(): Promise<void> {
        await this.setFilterDiffMode(false);
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
            vscode.commands.registerCommand(`${this.config.id}.refresh`, () => this.refreshWithCacheClear())
        );

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
                    { modal: true },
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

            const markingInfo = markingModule.getMarkingInfo(item.id!);
            if (!markingInfo || (markingInfo.type !== "import" && markingInfo.type !== "imported")) {
                const itemNotMarkedForImportErrorMessageForUser = `Item ${itemLabel} is not marked for import. Only items that have been generated can be imported.`;
                vscode.window.showErrorMessage(itemNotMarkedForImportErrorMessageForUser);
                const itemNotMarkedForImportErrorMessage =
                    "[TestThemesTreeView] " + itemNotMarkedForImportErrorMessageForUser;
                this.logger.error(itemNotMarkedForImportErrorMessage);
                return;
            }

            const { importUID, rootId } = this.resolveImportScope(item, itemUID, markingModule);

            this.logger.debug(
                `[TestThemesTreeView] Import scope resolved for '${itemLabel}': itemUID='${itemUID}', importUID='${importUID}', rootId='${rootId ?? "none"}', elementType='${item.data.elementType}'`
            );

            const importTargetItem = item;

            // Validate lock state with fresh server data to avoid stale lock information.
            const lockInfo = await this.getScopeLockInfo(importTargetItem, projectKey, cycleKey || "", "cycle");
            const lockedDescendantNames = lockInfo.lockedDescendantNames;
            if (lockedDescendantNames.length > 0) {
                const lockedList = lockedDescendantNames.join(", ");
                if (lockInfo.isSelectedScopeLocked) {
                    // The selected import scope item itself is locked by another user.
                    vscode.window.showWarningMessage(
                        `Cannot import "${itemLabel}" because the selected import scope is locked by another user.`
                    );
                    this.logger.warn(
                        `[TestThemesTreeView] Import blocked for "${itemLabel}", selected import scope is locked by another user.`
                    );
                    return;
                }

                // Some descendants are locked
                const proceed = await vscode.window.showWarningMessage(
                    `Some items are locked by another user and will not be imported: ${lockedList}. Do you want to proceed with the remaining items?`,
                    { modal: true },
                    "Proceed",
                    "Cancel"
                );
                if (proceed !== "Proceed") {
                    this.logger.debug(
                        `[TestThemesTreeView] Import cancelled by user due to locked descendants: ${lockedList}`
                    );
                    return;
                }
            }

            const importResult = await reportHandler.fetchTestResultsAndCreateResultsAndImportToTestbench(
                this.extensionContext,
                item,
                projectKey,
                cycleKey || tovKey || "",
                importUID
            );

            if (importResult) {
                if (importResult.importedTestCaseCount === 0) {
                    // Import job succeeded on the server but no test cases were actually imported.
                    // This usually happens when items are locked by another user in TestBench.
                    let noItemsImportedWarning = `Import completed for "${itemLabel}", but no test cases were actually imported.`;
                    if (lockedDescendantNames.length > 0) {
                        noItemsImportedWarning += ` The following items are locked by another user: ${lockedDescendantNames.join(", ")}.`;
                    } else {
                        noItemsImportedWarning +=
                            " This can happen when no importable test execution data exists for the selected scope, " +
                            "or when items are locked by another user in TestBench.";
                    }
                    this.logger.warn(`[TestThemesTreeView] ${noItemsImportedWarning}`);
                    vscode.window.showWarningMessage(noItemsImportedWarning);
                } else {
                    let importSuccessfulMessageForUser =
                        `Successfully imported ${importResult.importedTestCaseSetCount} test case set(s) with ` +
                        `${importResult.importedTestCaseCount} test case(s) for "${itemLabel}" to TestBench.`;
                    if (lockedDescendantNames.length > 0) {
                        importSuccessfulMessageForUser +=
                            ` Note: The following items were locked by another user and could not be imported: ` +
                            `${lockedDescendantNames.join(", ")}.`;
                    }
                    this.logger.info(`[TestThemesTreeView] ${importSuccessfulMessageForUser}`);
                    vscode.window.showInformationMessage(importSuccessfulMessageForUser);

                    if (importResult.testCaseSetErrors.length > 0 || importResult.testCaseWarnings.length > 0) {
                        const warningDetails = [
                            ...importResult.testCaseSetErrors,
                            ...importResult.testCaseWarnings
                        ].join("; ");
                        this.logger.warn(
                            `[TestThemesTreeView] Import completed with warnings for ${itemLabel}: ${warningDetails}`
                        );
                        vscode.window.showWarningMessage(
                            `Import completed for ${itemLabel} but with warnings. Check the TestBench log for details.`
                        );
                    }
                }

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
                } else {
                    const markingContext = this.getCurrentMarkingContext();
                    markingModule.markItemWithDescendants(item, markingContext, "imported");
                }

                // Clear cache before refresh to get updated lock status from server
                // After import, items are typically locked by system and should be hidden
                this.dataProvider.clearCache();
                this.refresh();
            } else {
                const importFailedMessageForUser = `Import was cancelled or did not complete successfully for ${itemLabel}`;
                const importFailedMessage = `[TestThemesTreeView] Import process for item ${itemLabel} (UID: ${importUID}) did not complete successfully or was cancelled.`;
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
     * Resolves the UID scope used for importing execution results.
     * Import always stays item scoped and uses the clicked item's UID.
     * Resolves an optional hierarchy root ID for UI state handling.
     * @param item The tree item being imported
     * @param itemUID The unique ID of the item being imported
     * @param markingModule The marking module instance to use for hierarchy resolution
     */
    private resolveImportScope(
        item: TestThemesTreeItem,
        itemUID: string,
        markingModule: MarkingModule
    ): { importUID: string; rootId: string | null } {
        const rootId = markingModule.getRootIDForDescendant(item.id!);

        this.logger.trace(
            `[TestThemesTreeView] resolveImportScope: item='${item.label?.toString() || "Unknown"}', itemId='${item.id}', itemUID='${itemUID}', elementType='${item.data.elementType}', hierarchyRootId='${rootId ?? "none"}'`
        );

        if (rootId) {
            this.logger.trace(
                `[TestThemesTreeView] Import remains item-scoped despite hierarchy root '${rootId}'. Using clicked item UID '${itemUID}'.`
            );
        }

        return { importUID: itemUID, rootId: rootId ?? null };
    }

    /**
     * Refreshes lock information for the selected scope from latest server data.
     * Falls back to current in-memory tree state if fresh data cannot be loaded.
     * @param item Selected root item for import/generation.
     * @param projectKey Active project key.
     * @param scopeKey Active cycle or TOV key.
     * @param scopeType Scope type used to fetch latest structure.
     * @returns Fresh lock information for warning/validation flow.
     */
    private async getScopeLockInfo(
        item: TestThemesTreeItem,
        projectKey: string,
        scopeKey: string,
        scopeType: "cycle" | "tov"
    ): Promise<ScopeLockInfo> {
        const fallback: ScopeLockInfo = {
            lockedDescendantNames: this.getLockedDescendantNames(item),
            isSelectedScopeLocked: item.lockedByOther
        };

        if (!projectKey || !scopeKey) {
            return fallback;
        }

        try {
            this.dataProvider.clearCache();
            const latestStructure =
                scopeType === "cycle"
                    ? await this.dataProvider.fetchCycleStructure(projectKey, scopeKey, false)
                    : await this.dataProvider.fetchTovStructure(projectKey, scopeKey, false);
            if (!latestStructure || !latestStructure.nodes || latestStructure.nodes.length === 0) {
                return fallback;
            }

            const selectedNode =
                latestStructure.nodes.find((node) => node.base.uniqueID === item.data.base.uniqueID) ||
                latestStructure.nodes.find((node) => node.base.key === item.data.base.key);

            if (!selectedNode) {
                return fallback;
            }

            const childrenByParent = new Map<string, TestStructureNode[]>();
            for (const node of latestStructure.nodes) {
                const parentKey = node.base.parentKey || "";
                const existing = childrenByParent.get(parentKey);
                if (existing) {
                    existing.push(node);
                } else {
                    childrenByParent.set(parentKey, [node]);
                }
            }

            const lockedNames = new Set<string>();
            const stack: TestStructureNode[] = [selectedNode];
            let isSelectedScopeLocked = false;
            const selectedNodeKey = selectedNode.base.key;
            const selectedNodeUID = selectedNode.base.uniqueID;

            while (stack.length > 0) {
                const currentNode = stack.pop()!;
                const isLockedByOther = this.isNodeLockedByOtherUser(currentNode);
                if (isLockedByOther) {
                    lockedNames.add(currentNode.base.name || "Unknown");
                    if (
                        currentNode.base.key === selectedNodeKey ||
                        (selectedNodeUID !== "" && currentNode.base.uniqueID === selectedNodeUID)
                    ) {
                        isSelectedScopeLocked = true;
                    }
                }

                const children = childrenByParent.get(currentNode.base.key) || [];
                for (const child of children) {
                    stack.push(child);
                }
            }

            item.setLockedByOther(isSelectedScopeLocked);

            return {
                lockedDescendantNames: this.sortLockedNames(lockedNames),
                isSelectedScopeLocked
            };
        } catch (error) {
            this.logger.warn(
                `[TestThemesTreeView] Failed to refresh lock state for ${scopeType} scope. Using local state.`,
                error
            );
            return fallback;
        }
    }

    /**
     * Resolves lock information for test generation scope using freshest available server data.
     * @param item Selected generation root item.
     * @param context Active generation context.
     * @returns Lock information for generation prompt logic.
     */
    private async getGenerationScopeLockInfo(
        item: TestThemesTreeItem,
        context: GenerationContext
    ): Promise<ScopeLockInfo> {
        if (context.isOpenedFromCycle && context.cycleKey) {
            return this.getScopeLockInfo(item, context.projectKey, context.cycleKey, "cycle");
        }

        if (context.tovKey) {
            return this.getScopeLockInfo(item, context.projectKey, context.tovKey, "tov");
        }

        return {
            lockedDescendantNames: this.getLockedDescendantNames(item),
            isSelectedScopeLocked: item.lockedByOther
        };
    }

    /**
     * Collects names of descendant tree items (and the item itself) that are locked by another user.
     * @param item The root tree item to check
     * @returns Array of names of locked items
     */
    private getLockedDescendantNames(item: TestThemesTreeItem): string[] {
        const lockedNames = new Set<string>();
        const stack: TestThemesTreeItem[] = [item];

        while (stack.length > 0) {
            const current = stack.pop()!;
            if (current.lockedByOther) {
                lockedNames.add(current.label?.toString() || current.data.base.name || "Unknown");
            }

            const childItems = (current.children || []) as TestThemesTreeItem[];
            for (const child of childItems) {
                stack.push(child);
            }
        }

        return this.sortLockedNames(lockedNames);
    }

    /**
     * Returns lock names in stable order for prompts/logging.
     * @param names Lock names to normalize and sort.
     * @returns Sorted lock names.
     */
    private sortLockedNames(names: Iterable<string>): string[] {
        return Array.from(new Set(names)).sort((left, right) =>
            left.localeCompare(right, undefined, { sensitivity: "base" })
        );
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
            this.prepareForContextSwitchLoading();
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
        await this.refreshMarkingFromWorkspace();
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
            this.prepareForContextSwitchLoading();
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

        // Check if item is locked by system (-2)
        // The locker can be either a string or an object with a key property
        const lockerValue = nodeData.exec?.locker;
        if (lockerValue !== null && lockerValue !== undefined) {
            const lockerKey = typeof lockerValue === "string" ? lockerValue : lockerValue.key;
            if (lockerKey === "-2") {
                return false;
            }
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
            const context = this.validateTestGenerationContext();
            if (!context) {
                return;
            }

            const canProceed = await this.confirmTestGenerationScope(item, context);
            if (!canProceed) {
                return;
            }

            await this.executeClearInternalDirIfNeeded();

            const testGenerationSuccessful = await this.performTestGeneration(item, context);

            if (testGenerationSuccessful) {
                await this.handleSuccessfulGeneration(item, context);
            }
        } catch (error) {
            this.handleTestGenerationError(error);
        }
    }

    /**
     * Validates lock state before generation and asks for confirmation when only descendants are locked.
     * @param item Selected generation root item.
     * @param context Active generation context.
     * @returns True when generation should proceed.
     */
    private async confirmTestGenerationScope(item: TestThemesTreeItem, context: GenerationContext): Promise<boolean> {
        const itemLabel = item.label?.toString() || item.data.base.name || "Unknown Item";
        const lockInfo = await this.getGenerationScopeLockInfo(item, context);
        const lockedDescendantNames = lockInfo.lockedDescendantNames;

        if (lockedDescendantNames.length === 0) {
            return true;
        }

        if (lockInfo.isSelectedScopeLocked) {
            const scopeLockedMessage = `Cannot generate tests for "${itemLabel}" because the selected scope is locked by another user.`;
            vscode.window.showWarningMessage(scopeLockedMessage);
            this.logger.warn(`[TestThemesTreeView] ${scopeLockedMessage}`);
            return false;
        }

        const lockedList = lockedDescendantNames.join(", ");
        const proceed = await vscode.window.showWarningMessage(
            `Some items are locked by another user and will not be generated: ${lockedList}. Do you want to proceed with the remaining items?`,
            { modal: true },
            "Proceed",
            "Cancel"
        );

        if (proceed !== "Proceed") {
            this.logger.debug(
                `[TestThemesTreeView] Test generation cancelled by user due to locked descendants: ${lockedList}`
            );
            return false;
        }

        return true;
    }

    /**
     * Clears internal TestBench directory if configured to do so.
     */
    private async executeClearInternalDirIfNeeded(): Promise<void> {
        if (getExtensionConfiguration().get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)) {
            await vscode.commands.executeCommand(allExtensionCommands.clearInternalTestbenchFolder);
        }
    }

    /**
     * Validates and returns the test generation context (project, cycle, TOV keys).
     * @returns Generation context object or null if validation fails
     */
    private validateTestGenerationContext(): GenerationContext | null {
        const projectKey = this.currentProjectKey;
        const cycleKey = this.currentCycleKey;
        const tovKey = this.currentTovKey;

        if (!projectKey || (!cycleKey && !tovKey)) {
            const errorMessage = "Could not determine the active Project, Cycle, or TOV context for test generation.";
            this.logger.error(`[TestThemesTreeView] ${errorMessage}`);
            vscode.window.showErrorMessage(errorMessage);
            return null;
        }

        return {
            projectKey,
            cycleKey: cycleKey || "",
            tovKey: tovKey || "",
            isOpenedFromCycle: this.isOpenedFromCycle
        };
    }

    /**
     * Performs the actual test generation based on context (cycle vs TOV).
     * @param item The test theme tree item to generate tests for
     * @param context The validated generation context
     * @returns True if generation was successful, false otherwise
     */
    private async performTestGeneration(item: TestThemesTreeItem, context: GenerationContext): Promise<boolean> {
        const itemLabel = item.label?.toString() || "Unknown Item";
        const itemUID = item.data.base.uniqueID;

        if (context.isOpenedFromCycle && context.cycleKey) {
            // Generation from a cycle context
            return await reportHandler.generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
                this.extensionContext,
                item,
                itemLabel,
                context.projectKey,
                context.cycleKey,
                itemUID
            );
        } else if (context.tovKey) {
            // Generation from a TOV context
            return await reportHandler.startTestGenerationUsingTOV(
                this.extensionContext,
                item,
                context.projectKey,
                context.tovKey,
                true
            );
        }

        return false;
    }

    /**
     * Handles post-generation tasks: marking items and updating UI.
     * @param item The test theme tree item that was generated
     * @param context The generation context
     */
    private async handleSuccessfulGeneration(item: TestThemesTreeItem, context: GenerationContext): Promise<void> {
        await this.applyPostGenerationMarking(item, context);
        await this.updateRobotFileAvailabilityForAllTreeItems();
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Applies marking to generated items based on context (import vs generation marking).
     * @param item The test theme tree item to mark
     * @param context The generation context determining marking type
     */
    private async applyPostGenerationMarking(item: TestThemesTreeItem, context: GenerationContext): Promise<void> {
        if (!ENABLE_ICON_MARKING_ON_TEST_GENERATION) {
            return;
        }

        const markingModule = this.getModule("marking") as MarkingModule;
        if (!markingModule || !item.id) {
            this.logger.warn(
                `[TestThemesTreeView] Could not mark item ${item.label}: Marking module not available or item has no ID.`
            );
            return;
        }

        markingModule.clearAllMarkings();

        // Determine marking type and context key based on whether opened from cycle or TOV
        const markingType = context.isOpenedFromCycle ? "import" : "generation";
        const markingContext = this.buildGenerationMarkingContext(context);

        markingModule.markItemWithDescendants(item, markingContext, markingType);

        // Force an immediate save of the state to disk to prevent data loss on reload
        const persistenceModule = this.getModule("persistence") as PersistenceModule | undefined;
        if (persistenceModule) {
            await persistenceModule.forceSave();
        }
    }

    /**
     * Applies import markings to all test theme items after a full cycle generation that was triggered
     * from the projects tree view.
     * @param cycleItem The projects tree cycle item used for generation.
     */
    public async markCycleGenerationFromProjectsView(cycleItem: ProjectsTreeItem): Promise<void> {
        if (!ENABLE_ICON_MARKING_ON_TEST_GENERATION) {
            this.logger.trace(
                "[TestThemesTreeView] Skipping cycle generation marking because icon marking is disabled."
            );
            return;
        }

        const projectKey = cycleItem.getProjectKey();
        const cycleKey = cycleItem.getCycleKey();
        const tovKey = cycleItem.getVersionKey();

        if (!projectKey || !cycleKey || !tovKey) {
            this.logger.warn(
                "[TestThemesTreeView] Cannot apply import markings after cycle generation: missing project, cycle, or TOV key."
            );
            return;
        }

        const projectName = cycleItem.parent?.parent?.label?.toString() || projectKey;
        const tovName = cycleItem.parent?.label?.toString() || tovKey;
        const cycleLabel = cycleItem.label?.toString() || cycleKey;

        try {
            const requiresContextReload =
                !this.isOpenedFromCycle ||
                this.currentProjectKey !== projectKey ||
                this.currentCycleKey !== cycleKey ||
                this.currentTovKey !== tovKey;

            if (requiresContextReload) {
                this.logger.debug(
                    `[TestThemesTreeView] Loading cycle '${cycleLabel}' to apply generation markings from projects view.`
                );
                await this.loadCycle(projectKey, cycleKey, tovKey, projectName, tovName, cycleLabel);
            } else {
                await this.updateRobotFileAvailabilityForAllTreeItems();
            }

            const rootItems = this.rootItems ?? [];
            if (rootItems.length === 0) {
                this.logger.warn(
                    `[TestThemesTreeView] No test theme items available to mark after generating cycle '${cycleLabel}'.`
                );
                return;
            }

            const markingModule = this.getModule("marking") as MarkingModule | undefined;
            if (!markingModule) {
                this.logger.warn(
                    "[TestThemesTreeView] Cannot apply import markings after cycle generation: marking module unavailable."
                );
                return;
            }

            const persistenceModule = this.getModule("persistence") as PersistenceModule | undefined;

            const generationContext: GenerationContext = {
                projectKey,
                cycleKey,
                tovKey,
                isOpenedFromCycle: true
            };
            const markingContext = this.buildGenerationMarkingContext(generationContext);

            markingModule.clearAllMarkings();

            for (const rootItem of rootItems) {
                if (!rootItem.id) {
                    continue;
                }
                markingModule.markItemWithDescendants(rootItem, markingContext, "import");
            }

            if (persistenceModule) {
                await persistenceModule.forceSave();
            }

            this.logger.info(
                `[TestThemesTreeView] Applied import markings for generated cycle '${cycleLabel}' (${rootItems.length} root item(s)).`
            );
        } catch (error) {
            this.logger.error(
                `[TestThemesTreeView] Failed to apply import markings after generating cycle '${cycleItem.label}'.`,
                error
            );
        }
    }

    /**
     * Handles errors during test generation.
     * @param error The error that occurred
     */
    private handleTestGenerationError(error: unknown): void {
        this.logger.error("[TestThemesTreeView] Error generating test cases:", error);
        vscode.window.showErrorMessage(
            `Error generating test cases: ${error instanceof Error ? error.message : "Unknown error"}`
        );
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
                cycleKey: this.isOpenedFromCycle ? this.currentCycleKey || undefined : this.currentTovKey || undefined,
                tovKey: this.currentTovKey || undefined
            };

            const item = new TestThemesTreeItem(treeItemData, this.extensionContext, parent);
            item.setMetadata("openedFromCycle", this.isOpenedFromCycle);
            item.updateId();
            this.applyModulesToTestThemesItem(item);
            item.setLockedByOther(this.isLockedByOtherUser(treeItemData));

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
     * Gets the currently authenticated user key used for lock ownership checks.
     * @returns User key or null when no valid user session is available.
     */
    private getCurrentUserKey(): string | null {
        const currentUserKey = userSessionManager?.getCurrentUserId?.();
        if (!currentUserKey || currentUserKey.trim() === "" || currentUserKey === "global_fallback") {
            return null;
        }

        return currentUserKey;
    }

    /**
     * Normalizes locker value into a comparable locker key.
     * @param locker Locker value from spec/aut/exec layer.
     * @returns Normalized locker key or null when not available.
     */
    private getLockerKey(locker: LockerValue): string | null {
        return normalizeLockerKey(locker);
    }

    /**
     * Evaluates whether a locker belongs to a different user than the current session user.
     * @param locker Locker value from spec/aut/exec layer.
     * @returns True only when locked by a different user (system lock excluded).
     */
    private isLockerLockedByOtherUser(locker: LockerValue): boolean {
        const currentUserKey = this.getCurrentUserKey();
        if (!currentUserKey) {
            return false;
        }

        const lockerKey = this.getLockerKey(locker);
        if (!lockerKey) {
            return false;
        }

        // System lock is not a different user lock.
        if (lockerKey === SYSTEM_LOCK_KEY) {
            return false;
        }

        return lockerKey !== currentUserKey;
    }

    /**
     * Checks whether any execution-relevant locker field in a TestTheme tree item is owned by another user.
     * @param data Tree item data containing spec/aut/exec lockers.
     * @returns True when the execution layer is locked by another user.
     */
    private isLockedByOtherUser(data: TestThemeData): boolean {
        return this.isLockerLockedByOtherUser(data.exec?.locker);
    }

    /**
     * Checks whether any execution-relevant locker field in a server node is owned by another user.
     * @param node Server node data containing spec/aut/exec lockers.
     * @returns True when the execution layer is locked by another user.
     */
    private isNodeLockedByOtherUser(node: TestStructureNode): boolean {
        return this.isLockerLockedByOtherUser(node.exec?.locker);
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
                markingModule.markItem(item, this.getCurrentMarkingContext(), "import");
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
        // Clear any pending debounced refresh
        if (this.markingRefreshDebounceHandle) {
            clearTimeout(this.markingRefreshDebounceHandle);
            this.markingRefreshDebounceHandle = undefined;
        }

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

    public override refresh(item?: TestThemesTreeItem, options?: RefreshOptions): void {
        if (item || options?.skipDataReload) {
            super.refresh(item, options);
            return;
        }

        this.refreshWithCacheClear(options).catch((error) => {
            this.logger.error("[TestThemesTreeView] Failed to refresh test themes tree view:", error);
        });
    }

    /**
     * Refreshes the tree view by clearing the cache and reloading data from the server.
     * This ensures that the latest data is fetched, including updated lock statuses and other server-side changes.
     */
    private async reloadCurrentContext(): Promise<boolean> {
        if (this.currentProjectKey && this.currentCycleKey && this.isOpenedFromCycle) {
            await this.loadCycle(
                this.currentProjectKey,
                this.currentCycleKey,
                this.currentTovKey || "",
                this.currentProjectName || "",
                this.currentTovName || "",
                this.currentCycleLabel || undefined
            );
            return true;
        }

        if (this.currentProjectKey && this.currentTovKey && !this.isOpenedFromCycle) {
            await this.loadTov(
                this.currentProjectKey,
                this.currentTovKey,
                this.currentProjectName || "",
                this.currentTovName || ""
            );
            return true;
        }

        return false;
    }

    public async refreshWithCacheClear(options?: RefreshOptions): Promise<void> {
        this.logger.debug("[TestThemesTreeView] Refreshing with cache clear to fetch latest data from server");
        this.dataProvider.clearCache();

        const reloaded = await this.reloadCurrentContext();

        if (!reloaded) {
            super.refresh(undefined, options);
        }
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
     * Updates robot file and folder availability for all tree items that can generate tests
     * and updates the context to show/hide the "Open Generated Robot File" button
     */
    private async updateRobotFileAvailabilityForAllTreeItems(): Promise<void> {
        try {
            const allTestThemeTreeItems = this.getAllTestThemeTreeItems();
            let hasAnyRobotFile = false;

            const availabilityChecks = allTestThemeTreeItems
                .filter((item) => item.canGenerateTests())
                .map(async (item) => {
                    try {
                        let hasContent = false;

                        // Check robot file for test case sets
                        if (item.canHaveRobotFile()) {
                            hasContent = await item.checkRobotFileExists();
                            if (hasContent) {
                                hasAnyRobotFile = true;
                            }
                        }
                        // Check folder for test themes
                        else if (item.data.elementType === TestThemeItemTypes.TEST_THEME) {
                            hasContent = await item.checkFolderExists();
                        }

                        item.updateContextValue();
                    } catch (error) {
                        this.logger.error(
                            `[TestThemesTreeView] Error checking content availability for ${item.data.base.name}:`,
                            error
                        );
                    }
                });

            await Promise.all(availabilityChecks);
            await vscode.commands.executeCommand("setContext", ContextKeys.HAS_GENERATED_ROBOT_FILE, hasAnyRobotFile);
        } catch (error) {
            this.logger.error("[TestThemesTreeView] Error updating content availability for all tree items:", error);
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
     * Sets up workspace file system watchers for Robot Framework files and test theme folders
     * to keep item markings in sync with actual file and folder availability.
     */
    private setupRobotFilesWatcher(): void {
        try {
            const schedule = () => this.scheduleMarkingRefresh();

            // Watch all .robot files in the workspace
            this.robotFilesWatcher = vscode.workspace.createFileSystemWatcher("**/*.robot");
            this.disposables.push(
                this.robotFilesWatcher.onDidCreate(schedule),
                this.robotFilesWatcher.onDidChange(schedule),
                this.robotFilesWatcher.onDidDelete(schedule),
                this.robotFilesWatcher
            );

            // Watch for workspace file system changes to detect folder operations
            // This is more reliable than FileSystemWatcher for directory changes
            this.disposables.push(
                vscode.workspace.onDidCreateFiles((event) => {
                    if (this.isRelevantWorkspaceChange(event.files)) {
                        this.logger.trace(`[TestThemesTreeView] Detected file/folder creation in workspace`);
                        schedule();
                    }
                }),
                vscode.workspace.onDidDeleteFiles((event) => {
                    if (this.isRelevantWorkspaceChange(event.files)) {
                        this.logger.trace(`[TestThemesTreeView] Detected file/folder deletion in workspace`);
                        schedule();
                    }
                }),
                vscode.workspace.onDidRenameFiles((event) => {
                    const relevantFiles = event.files.map((f) => f.oldUri).concat(event.files.map((f) => f.newUri));
                    if (this.isRelevantWorkspaceChange(relevantFiles)) {
                        this.logger.trace(`[TestThemesTreeView] Detected file/folder rename in workspace`);
                        schedule();
                    }
                })
            );
        } catch (error) {
            this.logger.error("[TestThemesTreeView] Error setting up file and folder watchers:", error);
        }
    }

    /**
     * Checks if a workspace file change is relevant to test theme marking
     * (i.e., if it's within the output directory)
     * @param files Array of URIs that were changed
     * @returns True if the change is relevant to test theme folders
     */
    private isRelevantWorkspaceChange(files: readonly vscode.Uri[]): boolean {
        const outputDirectory = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_OUTPUT_DIR);
        if (!outputDirectory || files.length === 0) {
            return false;
        }

        // Check if any of the changed files are within the output directory
        return files.some((uri) => {
            const relativePath = vscode.workspace.asRelativePath(uri, false);
            return relativePath.startsWith(outputDirectory);
        });
    }

    /**
     * Debounces and schedules a marking refresh run (update availability + sync marks).
     */
    private scheduleMarkingRefresh(): void {
        if (this.markingRefreshDebounceHandle) {
            clearTimeout(this.markingRefreshDebounceHandle);
        }
        this.markingRefreshDebounceHandle = setTimeout(async () => {
            try {
                await this.refreshMarkingFromWorkspace();
            } catch (error) {
                this.logger.error("[TestThemesTreeView] Error during debounced marking refresh:", error);
            }
        }, 500);
    }

    /**
     * Updates robot file availability flags and synchronizes item markings accordingly.
     */
    private async refreshMarkingFromWorkspace(): Promise<void> {
        await this.updateRobotFileAvailabilityForAllTreeItems();
        await this.syncMarkingsWithRobotFileAvailability();
    }

    /**
     * Synchronizes the marking state of tree items with the availability of
     * their corresponding .robot files or folders. If content exists (file for test case sets,
     * folder for test themes), the item is marked with type "generation". If content is missing,
     * any existing mark is removed.
     */
    public async syncMarkingsWithRobotFileAvailability(): Promise<void> {
        try {
            const markingModule = this.getModule("marking") as MarkingModule | undefined;
            if (!markingModule) {
                return;
            }

            // Process all items that can be marked (both test case sets and test themes)
            const treeItemCandidates = this.getAllTestThemeTreeItems().filter((treeItem) => treeItem.canBeMarked());
            const desiredMarkType = this.getDesiredMarkType();
            const markingContext = this.getCurrentMarkingContext();

            const tasks = treeItemCandidates.map(async (treeItem) => {
                try {
                    // Check if content exists (robot file for test case sets, folder for test themes)
                    const contentExistsForTreeItem = treeItem.hasGeneratedContent();
                    await this.bindMarkForItemToItsExistence(
                        treeItem,
                        contentExistsForTreeItem,
                        markingModule,
                        desiredMarkType,
                        markingContext
                    );
                } catch (err) {
                    this.logger.error("[TestThemesTreeView] Error syncing marking for item:", err);
                }
            });

            await Promise.all(tasks);
        } catch (error) {
            this.logger.error("[TestThemesTreeView] Error syncing markings with content availability:", error);
        }
    }

    /**
     * Determines the desired marking type for the current view context.
     * In cycle context we want 'import' to show the Import button.
     * In TOV context we use 'generation' to reflect local file availability.
     */
    private getDesiredMarkType(): "import" | "generation" {
        return this.isOpenedFromCycle ? "import" : "generation";
    }

    /**
     * Applies a mark to an item using the marking module or falls back to updating
     * the item's metadata when context keys are not available yet (early refresh).
     */
    private applyMarkForItem(
        item: TestThemesTreeItem,
        desiredType: "import" | "generation",
        markingContext: MarkingContext,
        markingModule: MarkingModule
    ): void {
        const itemId = item.id;
        if (!itemId) {
            return;
        }

        const projectKey = markingContext.projectKey ?? undefined;
        const contextKey = markingContext.cycleKey ?? markingContext.tovKey ?? undefined;

        if (projectKey && contextKey) {
            markingModule.markItem(item, markingContext, desiredType);
            return;
        }

        // Fallback: update item metadata only
        item.setMetadata("marked", true);
        item.setMetadata("markingInfo", {
            itemId,
            projectKey: projectKey || "",
            cycleKey: contextKey || "",
            timestamp: Date.now(),
            type: desiredType,
            tovKey: markingContext.tovKey ?? undefined,
            contextId: markingContext.contextId ?? undefined,
            contextType:
                markingContext.contextType ??
                (markingContext.cycleKey ? "cycle" : markingContext.tovKey ? "tov" : "unknown"),
            metadata: {
                label: item.label as string,
                contextValue: item.originalContextValue,
                uniqueID: item.data.base.uniqueID || undefined
            }
        });
        item.updateContextValue();
        this._onDidChangeTreeData.fire(item);
    }

    /**
     * Connects the marking state of a single item with its content existence.
     * - If content exists (file for test case sets, folder for test themes), ensure the item is marked with the desired type.
     * - If marked with a different type, upgrade when appropriate and never
     *   downgrade from 'import' to 'generation'.
     * - If no content exists, unmark the item.
     */
    private async bindMarkForItemToItsExistence(
        treeItem: TestThemesTreeItem,
        contentExistsForTreeItem: boolean,
        markingModule: MarkingModule,
        desiredType: "import" | "generation",
        markingContext: MarkingContext
    ): Promise<void> {
        const itemId = treeItem.id;
        if (!itemId) {
            return;
        }

        const isMarked = markingModule.isMarked(itemId);
        const currentMark = markingModule.getMarkingInfo(itemId);

        if (contentExistsForTreeItem) {
            if (!isMarked) {
                if (desiredType === "import") {
                    // Avoid automatically marking cycle contexts based on shared folder/file names.
                    return;
                }

                this.applyMarkForItem(treeItem, desiredType, markingContext, markingModule);
                return;
            }

            if (currentMark && currentMark.type !== desiredType) {
                // Dont downgrade existing 'import' mark to 'generation'
                if (currentMark.type === "import" && desiredType === "generation") {
                    return;
                }
                if (desiredType === "import") {
                    // Keep import markings explicit
                    return;
                }
                this.applyMarkForItem(treeItem, desiredType, markingContext, markingModule);
            }
        } else if (isMarked) {
            // Remove any marking for items without content
            markingModule.unmarkItemByID(itemId);
        }
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
        // When all filters are cleared globally, disable filter diff mode
        if (this.filterDiffMode) {
            await this.setFilterDiffMode(false);
        }
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
