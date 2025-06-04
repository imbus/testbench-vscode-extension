/**
 * @file testThemeTreeView.ts
 * @description Provides a VS Code TreeDataProvider implementation for the Test Theme Tree view.
 */

// TODO: Delete this file after the refactor

import * as vscode from "vscode";
import { CycleDataForThemeTreeEvent } from "./projectManagementTreeView";
import { logger, testThemeTreeView } from "../extension";
import { ContextKeys, TreeItemContextValues } from "../constants";
import { CycleNodeData, CycleStructure } from "../testBenchTypes";
import { ProjectDataService } from "../services/projectDataService";
import { MarkedItemStateService } from "../services/markedItemStateService";
import { TestThemeTreeItem } from "./testTheme/testThemeTreeItem";

/**
 * TestThemeTreeDataProvider implements the TreeDataProvider interface to display
 * TestTheme items in the Test Theme Tree view.
 */
export class TestThemeTreeDataProvider implements vscode.TreeDataProvider<TestThemeTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TestThemeTreeItem | void> =
        new vscode.EventEmitter<TestThemeTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<TestThemeTreeItem | void> = this._onDidChangeTreeData.event;

    private readonly projectDataService: ProjectDataService;
    private readonly markedItemStateService: MarkedItemStateService;

    private _currentCycleKey: string | null = null;
    public getCurrentCycleKey(): string | null {
        return this._currentCycleKey;
    }
    private _currentProjectKey: string | null = null;
    public getCurrentProjectKey(): string | null {
        return this._currentProjectKey;
    }

    private _currentCycleLabel: string | null = null;
    private isCustomRootActive: boolean = false;
    private customRootItemInstance: TestThemeTreeItem | null = null;
    private originalCustomRootContextValue: string | null = null;
    /** Root elements for the Test Theme Tree view */
    public rootElements: TestThemeTreeItem[] = [];
    /** Set to store keys of expanded items so that refresh can restore expansion state */
    private expandedTreeItems: Set<string> = new Set<string>();

    private updateTreeViewStatusMessageCallback: (message: string | undefined) => void;

    constructor(
        updateMessageCallback: (message: string | undefined) => void,
        private readonly extensionContext: vscode.ExtensionContext,
        projectDataService: ProjectDataService,
        markedItemStateService: MarkedItemStateService
    ) {
        this.updateTreeViewStatusMessageCallback = updateMessageCallback;
        this.projectDataService = projectDataService;
        this.markedItemStateService = markedItemStateService;
        vscode.commands.executeCommand("setContext", ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);

        logger.trace("[TestThemeTreeDataProvider] Initialized with services.");
    }

    public setTreeViewStatusMessage(message: string | undefined): void {
        this.updateTreeViewStatusMessageCallback(message);
    }

    /**
     * Determines if a tree item should show import button based on the generated hierarchies.
     * @param {string} itemKey - The key of the item to check.
     * @param {string | undefined} itemUID - The unique identifier of the item, if available.
     * @return {Object} An object containing:
     * - `shouldShow`: A boolean indicating if the import functionality should be shown for this item.
     * - `rootUID`: The UID of the root item if it is marked, otherwise undefined.
     */
    private shouldTreeItemDisplayImportButton(
        itemKey: string,
        itemUID: string | undefined
    ): { shouldShow: boolean; rootUID?: string } {
        return this.markedItemStateService.getItemImportState(itemKey, itemUID);
    }

    /**
     * Refreshes the test theme tree view.
     * Fetches fresh data from the server for the current cycle,
     * clears any custom root, and updates tree view messages.
     * @param {boolean} isHardRefresh - If true, implies a user-initiated refresh (refresh button)) and not an internal refresh.
     */
    async refresh(isHardRefresh: boolean = false): Promise<void> {
        logger.debug(
            `Refreshing test theme tree view. Hard refresh: ${isHardRefresh}, Custom root active: ${this.isCustomRootActive}`
        );

        const currentCustomRootKeyBeforeRefresh =
            this.isCustomRootActive && this.customRootItemInstance
                ? this.customRootItemInstance.itemData.base.key
                : null;

        if (isHardRefresh && this.isCustomRootActive) {
            logger.trace("Hard refresh requested with active custom root. Resetting to full cycle view.");
            this.resetCustomRootInternally();
        }

        this.storeExpandedTreeItems(this.rootElements);

        if (!this._currentCycleKey || !this._currentProjectKey) {
            logger.warn("TestThemeTreeDataProvider: Cannot refresh without a current cycle and project key.");
            this.clearTree();
            this._onDidChangeTreeData.fire(undefined);
            return;
        }

        const initialLoadingMessage =
            this.isCustomRootActive && this.customRootItemInstance && !isHardRefresh
                ? `Refreshing: ${this.customRootItemInstance.label}...`
                : `Loading test themes for cycle: ${this._currentCycleLabel || this._currentCycleKey}...`;
        this.setTreeViewStatusMessage(initialLoadingMessage);

        if (!(this.isCustomRootActive && !isHardRefresh)) {
            this.rootElements = [];
        }
        this._onDidChangeTreeData.fire(undefined);

        let rawCycleStructure: CycleStructure | null = null;
        let operationSuccessful = false;

        try {
            if (!this.projectDataService) {
                logger.error("[TestThemeTreeDataProvider] ProjectDataService is not available.");
                this.setTreeViewStatusMessage("Error: Data service not available.");
                if (!this.isCustomRootActive) {
                    this.rootElements = [];
                }
                return;
            }

            rawCycleStructure = await this.projectDataService.fetchCycleStructure(
                this._currentProjectKey,
                this._currentCycleKey
            );

            if (rawCycleStructure) {
                operationSuccessful = true;
                if (
                    this.isCustomRootActive &&
                    this.customRootItemInstance &&
                    !isHardRefresh &&
                    currentCustomRootKeyBeforeRefresh
                ) {
                    const elementsByKey: Map<string, CycleNodeData> = new Map<string, CycleNodeData>();
                    rawCycleStructure.nodes.forEach((node: CycleNodeData) => {
                        if (node?.base?.key) {
                            elementsByKey.set(node.base.key, node);
                        }
                    });

                    const updatedCustomRootNodeData = elementsByKey.get(currentCustomRootKeyBeforeRefresh);

                    if (updatedCustomRootNodeData && this.customRootItemInstance) {
                        this.customRootItemInstance.itemData = updatedCustomRootNodeData;
                        const newLabel = updatedCustomRootNodeData.base.numbering
                            ? `${updatedCustomRootNodeData.base.numbering} ${updatedCustomRootNodeData.base.name}`
                            : updatedCustomRootNodeData.base.name;
                        if (this.customRootItemInstance.label !== newLabel) {
                            this.customRootItemInstance.label = newLabel;
                        }
                        this.customRootItemInstance.state.status = updatedCustomRootNodeData.exec?.status || "None";
                        this.customRootItemInstance.updateIcon();

                        this.customRootItemInstance.children = this.buildTestThemeTreeRecursively(
                            currentCustomRootKeyBeforeRefresh,
                            this.customRootItemInstance,
                            elementsByKey,
                            updatedCustomRootNodeData.base.name
                        );

                        if (this.customRootItemInstance.children && this.customRootItemInstance.children.length > 0) {
                            this.customRootItemInstance.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                        } else {
                            this.customRootItemInstance.collapsibleState = vscode.TreeItemCollapsibleState.None;
                        }

                        this.rootElements = [this.customRootItemInstance];
                        this._onDidChangeTreeData.fire(this.customRootItemInstance);
                    } else {
                        logger.warn(
                            `Custom root item (Key: ${currentCustomRootKeyBeforeRefresh}) not found in refreshed cycle structure. Resetting to full view.`
                        );
                        this.resetCustomRootInternally();
                        this.populateFromCycleData({
                            projectKey: this._currentProjectKey,
                            cycleKey: this._currentCycleKey,
                            cycleLabel: this._currentCycleLabel || this._currentCycleKey,
                            rawCycleStructure: rawCycleStructure
                        });
                        operationSuccessful = true;
                    }
                } else {
                    this.populateFromCycleData({
                        projectKey: this._currentProjectKey,
                        cycleKey: this._currentCycleKey,
                        cycleLabel: this._currentCycleLabel || this._currentCycleKey,
                        rawCycleStructure: rawCycleStructure
                    });
                    operationSuccessful = true;
                }
            } else {
                logger.warn(`Failed to fetch cycle structure for cycle ${this._currentCycleKey} during refresh.`);
                if (!this.isCustomRootActive) {
                    this.rootElements = [];
                }
            }
        } catch (error) {
            logger.error(`Error during refresh data fetch for cycle ${this._currentCycleKey}:`, error);
            if (!this.isCustomRootActive) {
                this.rootElements = [];
            }
            rawCycleStructure = null;
        } finally {
            if (!this._currentCycleKey) {
                this.setTreeViewStatusMessage("Select a cycle from the 'Projects' view to see test themes.");
            } else if (operationSuccessful && this.rootElements.length === 0) {
                this.setTreeViewStatusMessage(
                    this._currentCycleLabel
                        ? `No test themes found for cycle ${this._currentCycleLabel}.`
                        : "No test themes found for the current cycle."
                );
            } else if (!operationSuccessful && this.projectDataService) {
                this.setTreeViewStatusMessage(
                    `Error loading themes for ${this._currentCycleLabel || this._currentCycleKey}.`
                );
            } else if (!this.projectDataService) {
                this.setTreeViewStatusMessage("Error: Not connected to TestBench server.");
            } else {
                this.setTreeViewStatusMessage(undefined);
            }

            if (operationSuccessful && this.rootElements.length > 0) {
                this.restoreMarkingState();
            }

            const alreadyFired: boolean = this.isCustomRootActive && !isHardRefresh && operationSuccessful;
            const isDataFullyLoaded =
                operationSuccessful && (!this.isCustomRootActive || isHardRefresh) && rawCycleStructure;

            if (!alreadyFired && !isDataFullyLoaded) {
                this._onDidChangeTreeData.fire(undefined);
            }
        }
    }

    /**
     * Internal refresh logic after data population, to update messages and fire data change.
     * Avoids re-fetching if called from populateFromCycleData.
     */
    private internalRefreshAfterPopulate(): void {
        logger.debug("TestThemeTreeDataProvider: Internal refresh after populating data.");
        this.storeExpandedTreeItems(this.rootElements);

        if (this.rootElements.length === 0) {
            if (this._currentCycleKey) {
                this.updateTreeViewStatusMessageCallback(
                    this._currentCycleLabel
                        ? `No test themes found for cycle ${this._currentCycleLabel}.`
                        : "No test themes found for the current cycle."
                );
            } else {
                this.updateTreeViewStatusMessageCallback("Select a cycle to see test themes.");
            }
            if (testThemeTreeView) {
                logger.trace(`Test Themes view message set: ${testThemeTreeView.message}`);
            }
        } else {
            this.updateTreeViewStatusMessageCallback(undefined);
            if (testThemeTreeView) {
                logger.trace("Test Themes view message cleared.");
            }
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Finds item by both key and UID for.
     * This method traverses the tree recursively, searching for an item with a specific key and UID.
     * @param {string} treeItemKey - The key to search for.
     * @param {string} treeItemUID - The unique identifier to search for.
     * @return {TestThemeTreeItem | null} The `BaseTestBenchTreeItem` if found, otherwise `null`.
     */
    private findTreeItemByKeyAndUID(
        treeItemKey: string,
        treeItemUID: string,
        items: TestThemeTreeItem[]
    ): TestThemeTreeItem | null {
        for (const item of items) {
            const itemKey = item.itemData?.key || item.itemData?.base?.key;
            const itemUID = item.itemData?.base?.uniqueID || item.itemData?.uniqueID;

            if (itemKey === treeItemKey && itemUID === treeItemUID) {
                return item;
            }

            if (item.children) {
                const foundTreeItem = this.findTreeItemByKeyAndUID(
                    treeItemKey,
                    treeItemUID,
                    item.children as TestThemeTreeItem[]
                );
                if (foundTreeItem) {
                    return foundTreeItem;
                }
            }
        }
        return null;
    }

    /**
     * Iterates through the given tree items and updates their UI (_isMarkedForImport, contextValue, icon)
     * based on the current state provided by MarkedItemStateService.
     */
    private updateTreeItemsMarkingRecursive(items: TestThemeTreeItem[]): boolean {
        let uiChanged = false;
        for (const item of items) {
            const itemKey = item.itemData?.base?.key || item.itemData?.key;
            const itemUID = item.itemData?.base?.uniqueID || item.itemData?.uniqueID;

            if (itemKey && itemUID) {
                const importState = this.markedItemStateService.getItemImportState(itemKey, itemUID);
                const oldIsMarked = item.state.isMarked;
                const oldContextValue = item.contextValue;

                if (importState.shouldShow) {
                    item.state.isMarked = true;
                    if (item.originalContextValue) {
                        // Must be set during item creation
                        this.updateItemContextForImport(item, item.originalContextValue);
                    } else {
                        logger.error(
                            `[TestThemeTreeDataProvider] CRITICAL: Item ${item.label} (UID: ${itemUID}) has no originalContextValue during marking.`
                        );
                        // Attempt fallback, but this indicates a problem elsewhere
                        let baseContext = item.contextValue; // Current context value
                        if (item.contextValue === TreeItemContextValues.MARKED_TEST_THEME_NODE) {
                            baseContext = TreeItemContextValues.TEST_THEME_NODE;
                        } else if (item.contextValue === TreeItemContextValues.MARKED_TEST_CASE_SET_NODE) {
                            baseContext = TreeItemContextValues.TEST_CASE_SET_NODE;
                        }
                        this.updateItemContextForImport(item, baseContext!);
                    }
                } else {
                    // Item should NOT be marked
                    item.state.isMarked = false;
                    if (item.originalContextValue) {
                        // Must be set during item creation
                        item.contextValue = item.originalContextValue;
                    } else {
                        // If originalContextValue is missing, means it was previously a marked type. Revert it.
                        // This fallback logic is defensive. Ideally, originalContextValue is always present.
                        if (item.contextValue === TreeItemContextValues.MARKED_TEST_THEME_NODE) {
                            item.contextValue = TreeItemContextValues.TEST_THEME_NODE;
                        } else if (item.contextValue === TreeItemContextValues.MARKED_TEST_CASE_SET_NODE) {
                            item.contextValue = TreeItemContextValues.TEST_CASE_SET_NODE;
                        }
                        logger.warn(
                            `[TestThemeTreeDataProvider] Item ${item.label} (UID: ${itemUID}) should be unmarked but originalContextValue is missing. Attempted to infer base context.`
                        );
                    }
                }
                item.updateIcon(); // Update icon based on new state

                if (oldIsMarked !== item.state.isMarked || oldContextValue !== item.contextValue) {
                    uiChanged = true;
                }
            }

            if (item.children && item.children.length > 0) {
                if (this.updateTreeItemsMarkingRecursive(item.children as TestThemeTreeItem[])) {
                    uiChanged = true;
                }
            }
        }
        return uiChanged;
    }

    /**
     * Restores marking state only to originally marked items
     */
    private restoreMarkingState(): void {
        logger.debug("[TestThemeTreeDataProvider] Restoring marking state for visible items (restoreMarkingState).");
        this.updateTreeItemsMarkingRecursive(this.rootElements);
    }

    /**
     * Returns the parent of a given tree item.
     * @param {TestThemeTreeItem} element The tree item.
     * @returns {TestThemeTreeItem | null} The parent TestbenchTreeItem or null.
     */
    getParent(element: TestThemeTreeItem): TestThemeTreeItem | null {
        return element.parent as TestThemeTreeItem | null;
    }

    /**
     * Returns the children of a given tree item. If no element is provided,
     * returns the root elements.
     * @param {TestThemeTreeItem} element Optional parent tree item.
     * @returns {Promise<TestThemeTreeItem[]>} A promise resolving to an array of TestbenchTreeItems.
     */
    async getChildren(element?: TestThemeTreeItem): Promise<TestThemeTreeItem[]> {
        if (!element) {
            if (this.isCustomRootActive && this.customRootItemInstance) {
                return [this.customRootItemInstance];
            }
            return this.rootElements;
        }
        return (element.children as TestThemeTreeItem[]) || [];
    }

    /**
     * Returns the TreeItem representation for a given element.
     * @param {TestThemeTreeItem[]} element The TestbenchTreeItem.
     * @returns {vscode.TreeItem} The corresponding vscode.TreeItem.
     */
    getTreeItem(element: TestThemeTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Recursively finds an item in a tree of `BaseTestBenchTreeItem` objects by its key.
     *
     * @param {string} key - The key to search for.
     * @param {TestThemeTreeItem[]} items - The array of `BaseTestBenchTreeItem` objects to search within.
     * @returns {TestThemeTreeItem | null} The `BaseTestBenchTreeItem` if found, otherwise `null`.
     */
    private findItemByKey(key: string, items: TestThemeTreeItem[]): TestThemeTreeItem | null {
        for (const item of items) {
            if (item.itemData?.key === key || item.itemData?.base?.key === key) {
                return item;
            }
            if (item.children) {
                const found = this.findItemByKey(key, item.children as TestThemeTreeItem[]);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }

    /**
     * Collects all descendant UIDs of a given tree item.
     * This method traverses the tree recursively,
     * collecting unique identifiers (UIDs) of all descendants of a given tree item.
     * @param {TestThemeTreeItem} treeItem - The tree item whose descendants are to be collected.
     * @return {string[]} An array of unique identifiers (UIDs) of all descendants.
     */
    private collectDescendantUIDs(treeItem: TestThemeTreeItem): string[] {
        const descendantsUIDs: string[] = [];
        const visitedUIDs = new Set<string>();

        function recurse(currentItem: TestThemeTreeItem) {
            if (currentItem.children) {
                for (const child of currentItem.children) {
                    const childUID = child.itemData?.base?.uniqueID || child.itemData?.uniqueID;
                    if (childUID && !visitedUIDs.has(childUID)) {
                        visitedUIDs.add(childUID);
                        descendantsUIDs.push(childUID);
                        recurse(child as TestThemeTreeItem);
                    }
                }
            }
        }

        recurse(treeItem);
        return descendantsUIDs;
    }

    /**
     * Collects descendant keys with UIDs for tracking
     * This method traverses the tree recursively,
     * collecting keys and UIDs of all descendants of a given tree item.
     * @param {TestThemeTreeItem} treeItem - The tree item whose descendants are to be collected.
     * @return {Array<[string, string]>} An array of tuples, each containing a key and its corresponding UID.
     */
    private collectDescendantKeysWithUIDs(treeItem: TestThemeTreeItem): Array<[string, string]> {
        const descendantsKeysWithUIDs: Array<[string, string]> = [];

        if (treeItem.children) {
            for (const child of treeItem.children) {
                const childKey = child.itemData?.base?.key || child.itemData?.key;
                const childUID = child.itemData?.base?.uniqueID || child.itemData?.uniqueID;
                if (childKey && childUID) {
                    descendantsKeysWithUIDs.push([childKey, childUID]);
                    descendantsKeysWithUIDs.push(...this.collectDescendantKeysWithUIDs(child as TestThemeTreeItem));
                }
            }
        }
        return descendantsKeysWithUIDs;
    }

    /**
     * Marks a specified `BaseTestBenchTreeItem` as "generated".
     * This involves updating its `contextValue` and icon, persisting the marked state,
     * and clearing any previously marked item.
     * @param {TestThemeTreeItem} treeItemToMark The tree item to be marked.
     */
    public async markItemAsGenerated(treeItemToMark: TestThemeTreeItem): Promise<void> {
        if (!treeItemToMark || (!treeItemToMark.itemData?.key && !treeItemToMark.itemData?.base?.key)) {
            logger.warn("[TestThemeTreeDataProvider] Attempted to mark an invalid item for generation.");
            return;
        }

        const itemKey = (treeItemToMark.itemData.key || treeItemToMark.itemData.base.key)!;
        const itemUID = (treeItemToMark.itemData?.base?.uniqueID || treeItemToMark.itemData?.uniqueID)!;
        const originalContext = (treeItemToMark.originalContextValue || treeItemToMark.contextValue)!;

        if (!originalContext || !itemUID) {
            logger.error(
                `[TestThemeTreeDataProvider] Cannot mark item ${itemKey} as generated, required properties missing (UID or originalContext).`
            );
            return;
        }

        logger.debug(`[TestThemeTreeDataProvider] Marking item as generated: ${itemKey} (UID: ${itemUID})`);

        // 1. Update the state in the service.
        // The service's markItem method should handle clearing previous markings if only one root marking is allowed.
        const descendantUIDs = this.collectDescendantUIDs(treeItemToMark);
        const descendantKeysWithUIDs = this.collectDescendantKeysWithUIDs(treeItemToMark);

        // Ensure clearMarking in the service clears all hierarchies and current info if that's the design.
        // Or ensure markItem itself does this before setting the new one.
        // Based on MarkedItemStateService.markItem, it clears internally before setting the new one.
        // So, explicit clearMarking() before markItem() is redundant but not harmful if markItem is idempotent regarding clearing.
        // For clarity that we intend to replace all markings:
        await this.markedItemStateService.clearMarking();
        await this.markedItemStateService.markItem(
            itemKey,
            itemUID,
            originalContext,
            true, // isDirectlyGenerated for the main item
            descendantUIDs,
            descendantKeysWithUIDs
        );

        // 2. Synchronize the entire visible tree UI with the new state from the service.
        const uiActuallyChanged = this.updateTreeItemsMarkingRecursive(this.rootElements);

        logger.info(
            `[TestThemeTreeDataProvider] Item ${itemKey} (UID: ${itemUID}) and its descendants marked as generated. State saved by service. UI updated: ${uiActuallyChanged}`
        );

        // 3. Notify VS Code to refresh the tree view if UI actually changed.
        if (uiActuallyChanged) {
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    /**
     * Recursively marks descendants of the given tree item.
     * Only marks TestThemeNode and TestCaseSetNode descendants.
     * State is managed by the service.
     *
     * @param parentItem The parent tree item whose descendants are to be marked.
     */
    private markDescendantsRecursively(parentItem: TestThemeTreeItem): void {
        if (!parentItem.children) {
            return;
        }

        for (const child of parentItem.children) {
            const childKey = child.itemData?.base?.key || child.itemData?.key;
            if (!childKey) {
                continue;
            }

            const originalContext = child.originalContextValue || child.contextValue;
            if (!originalContext) {
                continue;
            }

            // Check with service if this descendant should be marked.
            // This requires markedItemStateService to have a way to check individual sub-items.
            // For simplicity here, we assume if the parent root was marked, all its collectible descendants were intended to be.
            // The service call `markItem` already stored the list of all descendants.
            // `getItemImportState` should correctly report these.
            const childUID = child.itemData?.base?.uniqueID || child.itemData?.uniqueID;
            const importState = this.markedItemStateService.getItemImportState(childKey, childUID);

            if (
                importState.shouldShow &&
                (originalContext === TreeItemContextValues.TEST_THEME_NODE ||
                    originalContext === TreeItemContextValues.TEST_CASE_SET_NODE)
            ) {
                child.state.isMarked = true;
                this.updateItemContextForImport(child as TestThemeTreeItem, originalContext);
                child.updateIcon();
            }
            this.markDescendantsRecursively(child as TestThemeTreeItem);
        }
    }

    /**
     * Updates the context value of a tree item based on its original context
     * to visually mark it for an import operation.
     *
     * @param item The tree item whose context value is to be updated.
     * @param originalContext The original context value of the tree item.
     */
    private updateItemContextForImport(item: TestThemeTreeItem, originalContext: string): void {
        if (originalContext === TreeItemContextValues.TEST_THEME_NODE) {
            item.contextValue = TreeItemContextValues.MARKED_TEST_THEME_NODE;
        } else if (originalContext === TreeItemContextValues.TEST_CASE_SET_NODE) {
            item.contextValue = TreeItemContextValues.MARKED_TEST_CASE_SET_NODE;
        }
    }

    /**
     * Validates if an item was actually marked.
     * This checks if the current marked item info matches the item key and UID,
     * or if the item UID is part of any generated hierarchies.
     * @param {string} itemKey - The key of the item to check.
     * @param {string | undefined} itemUID - The unique identifier of the item, if available.
     * @return {boolean} True if the item is marked, false otherwise.
     */
    public isItemActuallyMarked(itemKey: string, itemUID: string | undefined): boolean {
        return this.markedItemStateService.getItemImportState(itemKey, itemUID).shouldShow;
    }

    /**
     * Gets the report root unique identifier (UID) for a given tree item.
     *
     * This UID is determined based on whether the item was directly generated
     * or if it's eligible for import functionality.
     *
     * @param item The tree item for which to find the report root UID.
     * @returns The uniqueID of the item if it's a directly generated item or an item
     *          eligible for import, otherwise undefined.
     */
    public getReportRootUIDForItem(item: TestThemeTreeItem): string | undefined {
        const itemKey = item.itemData?.base?.key || item.itemData?.key;
        const itemUID = item.itemData?.base?.uniqueID || item.itemData?.uniqueID;
        return this.markedItemStateService.getReportRootUID(itemKey!, itemUID);
    }

    /**
     * Clears the marked status of a specified tree item.
     * It removes the item's marked state from storage and refreshes the view.
     *
     * @param {TestThemeTreeItem} itemToClear - The tree item whose marked status needs to be cleared.
     * @returns A promise that resolves when the operation is complete.
     */
    public async clearMarkedItemStatus(itemToClear?: TestThemeTreeItem): Promise<void> {
        const itemKeyToClearInService = itemToClear
            ? itemToClear.itemData.key || itemToClear.itemData.base.key
            : undefined;

        if (itemToClear && !itemKeyToClearInService) {
            logger.warn("[TestThemeTreeDataProvider] Attempted to clear marked status for an item with no key.");
            return;
        }

        logger.debug(
            `[TestThemeTreeDataProvider] Clearing marked status for service key: ${itemKeyToClearInService || "all"}`
        );
        await this.markedItemStateService.clearMarking(itemKeyToClearInService);

        const uiActuallyChanged = this.updateTreeItemsMarkingRecursive(this.rootElements);

        logger.info(
            `[TestThemeTreeDataProvider] Cleared marked status for item ${itemKeyToClearInService || "all"}. UI updated: ${uiActuallyChanged}`
        ); //
        if (uiActuallyChanged) {
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    /**
     * Sets the root elements of the test theme tree and refreshes the view.
     * This method is typically called when initially populating from cycle data.
     * @param {TestThemeTreeItem[]} roots An array of TestbenchTreeItems to set as roots.
     * @param {string} projectKey The key of the project this cycle belongs to.
     * @param {string} cycleKey The key of the cycle these roots belong to.
     * @param {string} cycleLabel The label/name of the cycle.
     */
    private setRoots(roots: TestThemeTreeItem[], projectKey: string, cycleKey: string, cycleLabel: string): void {
        logger.trace(
            `TestThemeTreeDataProvider: Setting roots for projectKey: ${projectKey}, cycleKey: ${cycleKey}, cycleLabel: ${cycleLabel}`
        );
        this._currentProjectKey = projectKey;
        this._currentCycleKey = cycleKey;
        this._currentCycleLabel = cycleLabel;
        this.rootElements = roots;

        if (this.rootElements.length === 0) {
            if (this._currentCycleKey) {
                this.updateTreeViewStatusMessageCallback(
                    this._currentCycleLabel
                        ? `No test themes found for cycle ${this._currentCycleLabel}.`
                        : "No test themes found for the current cycle."
                );
            } else {
                this.updateTreeViewStatusMessageCallback("Select a cycle to see test themes.");
            }
            if (testThemeTreeView) {
                logger.trace(`Test Themes view message set: ${testThemeTreeView.message}`);
            }
        } else {
            this.updateTreeViewStatusMessageCallback(undefined);
            if (testThemeTreeView) {
                logger.trace("Test Themes view message cleared.");
            }
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Sets the selected tree item as the sole root of the test theme tree and refreshes the view.
     * This implements the "Make Root" button functionality.
     * Make Root" only changes what's immediately displayed.
     * @param {TestThemeTreeItem} element The TestbenchTreeItem to set as root.
     */
    makeRoot(element: TestThemeTreeItem): void {
        logger.debug("Setting the selected element as the root of the test theme tree view:", element);

        if (
            this.customRootItemInstance &&
            this.customRootItemInstance !== element &&
            this.originalCustomRootContextValue
        ) {
            this.customRootItemInstance.contextValue = this.originalCustomRootContextValue;
        }

        this.rootElements = [element];
        this.isCustomRootActive = true;
        this.customRootItemInstance = element;
        this.originalCustomRootContextValue = element.contextValue ?? null;
        element.contextValue = TreeItemContextValues.CUSTOM_ROOT_TEST_THEME;

        if (element.children && element.children.length > 0) {
            element.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        } else {
            element.collapsibleState = vscode.TreeItemCollapsibleState.None;
        }
        element.parent = null;

        vscode.commands.executeCommand("setContext", ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, true);
        this._onDidChangeTreeData.fire(undefined);
        logger.info(`Item "${element.label}" is now set as custom root for Test Themes.`);
    }

    /**
     * Resets the custom root, restoring the tree to display the full data for the current cycle.
     */
    public async resetCustomRoot(): Promise<void> {
        logger.debug("Resetting custom root for Test Theme Tree.");
        if (this.isCustomRootActive) {
            const itemThatWasRoot: TestThemeTreeItem | null = this.customRootItemInstance;
            this.resetCustomRootInternally();
            await this.refresh(true);
            if (itemThatWasRoot) {
                this._onDidChangeTreeData.fire(itemThatWasRoot);
            }
            logger.info("Test Theme Tree custom root has been reset.");
        } else {
            logger.trace("No custom root was active in Test Theme Tree to reset.");
        }
    }

    /**
     * Resets the custom root item for the theme tree view.
     *
     * This method restores the original context value of the custom root item if it exists,
     * clears the custom root state, and updates the relevant VS Code context key.
     */
    private resetCustomRootInternally(): void {
        if (this.customRootItemInstance && this.originalCustomRootContextValue) {
            this.customRootItemInstance.contextValue = this.originalCustomRootContextValue;
        }
        this.isCustomRootActive = false;
        this.customRootItemInstance = null;
        this.originalCustomRootContextValue = null;
        vscode.commands.executeCommand("setContext", ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);
    }

    /**
     * Handles expansion or collapse of a tree item and updates its icon.
     * @param {TestThemeTreeItem} element The TestbenchTreeItem.
     * @param {boolean} expanded True if the item is expanded; false if collapsed.
     */
    handleExpansion(element: TestThemeTreeItem, expanded: boolean): void {
        logger.trace(
            `Setting expansion state of "${element.label}" to ${
                expanded ? "expanded" : "collapsed"
            } in test theme tree.`
        );
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;

        if (expanded && element.itemData?.key) {
            this.expandedTreeItems.add(element.itemData.key);
        } else if (element.itemData?.key) {
            this.expandedTreeItems.delete(element.itemData.key);
        }

        element.updateIcon();
    }

    /**
     * Recursively stores the keys of expanded nodes.
     * @param {TestThemeTreeItem[] | null} elements An array of TestbenchTreeItems or null.
     */
    private storeExpandedTreeItems(elements: TestThemeTreeItem[] | null): void {
        if (elements) {
            elements.forEach((element) => {
                if (element.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                    this.expandedTreeItems.add(element.itemData.key);
                }
                if (element.children) {
                    this.storeExpandedTreeItems(element.children as TestThemeTreeItem[]);
                }
            });
        }
    }

    /**
     * Clears the test theme tree by resetting the root elements and refreshing the view.
     */
    clearTree(): void {
        logger.trace("Clearing the test theme tree.");
        this._currentCycleKey = null;
        this._currentProjectKey = null;
        this._currentCycleLabel = null;
        // this.currentMarkedItemInfo = null;
        this.resetCustomRootInternally();
        this.rootElements = [];
        this.updateTreeViewStatusMessageCallback("Select a cycle from the 'Projects' view to see test themes.");
        this.expandedTreeItems.clear();
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Populates the tree view with data from a specific cycle.
     *
     * Processes the provided cycle data, builds a tree structure
     * from its nodes, and then refreshes the tree view to display the new data.
     * If the provided data is invalid or incomplete, the tree view will be cleared.
     *
     * @param {CycleDataForThemeTreeEvent} eventData - The cycle data used to populate the tree.
     *                    It includes the cycle key, label, and raw node structure.
     */
    public populateFromCycleData(eventData: CycleDataForThemeTreeEvent): void {
        logger.trace(`TestThemeTreeDataProvider: Populating from cycle data for cycleKey: ${eventData.cycleKey}`);
        this._currentCycleKey = eventData.cycleKey;
        this._currentProjectKey = eventData.projectKey;
        this._currentCycleLabel = eventData.cycleLabel;

        if (this.isCustomRootActive) {
            this.resetCustomRootInternally();
        }

        if (
            !eventData.rawCycleStructure ||
            !eventData.rawCycleStructure.nodes?.length ||
            !eventData.rawCycleStructure.root?.base?.key
        ) {
            logger.warn(`No valid raw cycle structure data provided for cycle ${eventData.cycleLabel}. Clearing tree.`);
            this.rootElements = [];
        } else {
            const elementsByKey: Map<string, CycleNodeData> = new Map<string, CycleNodeData>();
            eventData.rawCycleStructure.nodes.forEach((node: CycleNodeData) => {
                if (node?.base?.key) {
                    elementsByKey.set(node.base.key, node);
                } else {
                    logger.warn("TestThemeTreeDataProvider: Found node without base.key in cycle structure:", node);
                }
            });

            if (elementsByKey.size === 0 && eventData.rawCycleStructure.nodes.length > 0) {
                logger.error(
                    `TestThemeTreeDataProvider: No nodes with base.key were found in the cycle structure data for cycle ${eventData.cycleLabel}, cannot build tree.`
                );
                this.rootElements = [];
            } else {
                const rootCycleNodeKey: string = eventData.rawCycleStructure.root.base.key;
                this.rootElements = this.buildTestThemeTreeRecursively(
                    rootCycleNodeKey,
                    null,
                    elementsByKey,
                    eventData.rawCycleStructure.root.base.name
                );

                // Restore marking state after tree is built
                this.restoreMarkingState();
            }
        }

        this.isCustomRootActive = false;
        vscode.commands.executeCommand("setContext", ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);
        this.internalRefreshAfterPopulate();
    }

    /**
     * Checks if a cycle node is visible in the test theme tree.
     * @param {CycleNodeData} nodeData The cycle node data.
     * @returns {boolean} True if the node is visible; false otherwise.
     */
    private isCycleNodeVisibleInTestThemeTree(nodeData: CycleNodeData): boolean {
        if (nodeData.elementType === TreeItemContextValues.TEST_CASE_NODE) {
            return false;
        }
        if (nodeData.exec?.status === "NotPlanned" || nodeData.exec?.locker === "-2") {
            return false;
        }
        return true;
    }

    /**
     * Recursively builds a theme tree structure.
     *
     * @param {string} parentItemKey - The key of the parent item for which to find children.
     * @param {TestThemeTreeItem | null} parentTreeItem - The parent tree item in the current recursion level, or null for the root.
     * @param {Map<string, CycleNodeData>} elementsByKey - A map containing all available cycle node data, keyed by their unique keys.
     * @param {string} parentNameForLogging - The name of the parent item, used for logging purposes.
     * @returns {TestThemeTreeItem[]} An array of `BaseTestBenchTreeItem` representing the children of the specified parent.
     */
    private buildTestThemeTreeRecursively(
        parentItemKey: string,
        parentTreeItem: TestThemeTreeItem | null,
        elementsByKey: Map<string, CycleNodeData>,
        parentNameForLogging: string
    ): TestThemeTreeItem[] {
        logger.trace(
            `TestThemeTreeDataProvider: Building children for parentKey: ${parentItemKey} ('${parentNameForLogging}')`
        );
        const potentialChildrenData: CycleNodeData[] = Array.from(elementsByKey.values()).filter(
            (node) => node?.base?.parentKey === parentItemKey && this.isCycleNodeVisibleInTestThemeTree(node)
        );

        const childTreeItems: (TestThemeTreeItem | null)[] = potentialChildrenData.map((nodeData) => {
            const hasVisibleChildren: boolean = Array.from(elementsByKey.values()).some(
                (childNodeCandidate) =>
                    childNodeCandidate?.base?.parentKey === nodeData.base.key &&
                    this.isCycleNodeVisibleInTestThemeTree(childNodeCandidate)
            );

            const treeItem: TestThemeTreeItem | null = this.createTestThemeTreeItem(
                nodeData,
                nodeData.elementType,
                parentTreeItem,
                hasVisibleChildren
            );

            if (!treeItem) {
                return null;
            }

            if (hasVisibleChildren) {
                treeItem.children = this.buildTestThemeTreeRecursively(
                    nodeData.base.key,
                    treeItem,
                    elementsByKey,
                    nodeData.base.name
                );
            } else {
                treeItem.children = [];
            }
            return treeItem;
        });

        return childTreeItems.filter((item: TestThemeTreeItem | null): item is TestThemeTreeItem => item !== null);
    }

    /**
     * Creates a tree item for the Test Theme view.
     *
     * @param {CycleNodeData} nodeData - The raw data for the theme item.
     * @param {string} originalContextValue - The context value determining the item's type and behavior.
     * @param {TestThemeTreeItem | null} parent - The parent tree item, or null if it's a root item.
     * @param {boolean} hasVisibleChildren - Indicates if the item has children that are currently visible in the tree.
     * @returns A new instance, or null if `nodeData` is invalid.
     */
    private createTestThemeTreeItem(
        nodeData: CycleNodeData,
        originalContextValue: string,
        parent: TestThemeTreeItem | null,
        hasVisibleChildren: boolean
    ): TestThemeTreeItem | null {
        if (!nodeData?.base?.key || !nodeData?.base?.name) {
            logger.warn("TestThemeTreeDataProvider: Attempted to create theme tree item with invalid data structure");
            return null;
        }

        const itemName: string = nodeData.base.name;
        const label: string = nodeData.base.numbering ? `${nodeData.base.numbering} ${itemName}` : itemName;

        let defaultCollapsibleState: vscode.TreeItemCollapsibleState;
        switch (originalContextValue) {
            case TreeItemContextValues.TEST_THEME_NODE:
            case TreeItemContextValues.TEST_CASE_SET_NODE:
                defaultCollapsibleState = hasVisibleChildren
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
                break;
            default:
                defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
        }

        const treeItem: TestThemeTreeItem = new TestThemeTreeItem(
            label,
            originalContextValue,
            defaultCollapsibleState,
            nodeData,
            this.extensionContext,
            parent
        );

        // Restore expansion state
        const itemKeyForExpansion = treeItem.itemData?.base?.key;
        if (
            itemKeyForExpansion &&
            this.expandedTreeItems.has(itemKeyForExpansion) &&
            treeItem.collapsibleState !== vscode.TreeItemCollapsibleState.None
        ) {
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }

        return treeItem;
    }
}

/**
 * Hides the test theme tree view.
 */
export async function hideTestThemeTreeView(): Promise<void> {
    if (testThemeTreeView) {
        await vscode.commands.executeCommand("testThemeTree.removeView");
    } else {
        logger.debug("Test Theme Tree View instance not found; 'removeView' command not executed.");
    }
}

/**
 * Displays the test theme tree view.
 */
export async function displayTestThemeTreeView(): Promise<void> {
    if (testThemeTreeView) {
        await vscode.commands.executeCommand("testThemeTree.focus");
    } else {
        logger.debug("Test Theme Tree View instance not found; 'removeView' command not executed.");
    }
}
