/**
 * @file testThemeTreeView.ts
 * @description Provides a VS Code TreeDataProvider implementation for the Test Theme Tree view.
 */

import * as vscode from "vscode";
import { BaseTestBenchTreeItem, CycleDataForThemeTreeEvent } from "./projectManagementTreeView";
import { logger, connection, testThemeTreeView } from "./extension";
import { ContextKeys, StorageKeys, TreeItemContextValues } from "./constants";
import { CycleNodeData, CycleStructure } from "./testBenchTypes";

interface MarkedItemInfo {
    key: string;
    originalContextValue: string;
    isDirectlyGenerated: boolean;
}

interface GeneratedItemHierarchy {
    rootKey: string;
    rootUID: string;
    markedSubItems: Set<string>;
}

/**
 * TestThemeTreeDataProvider implements the TreeDataProvider interface to display
 * TestTheme items in the Test Theme Tree view.
 */
export class TestThemeTreeDataProvider implements vscode.TreeDataProvider<BaseTestBenchTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<BaseTestBenchTreeItem | void> =
        new vscode.EventEmitter<BaseTestBenchTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<BaseTestBenchTreeItem | void> = this._onDidChangeTreeData.event;

    private extensionContext: vscode.ExtensionContext;

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
    private customRootItemInstance: BaseTestBenchTreeItem | null = null;
    private originalCustomRootContextValue: string | null = null;
    /** Root elements for the Test Theme Tree view */
    public rootElements: BaseTestBenchTreeItem[] = [];
    /** Set to store keys of expanded items so that refresh can restore expansion state */
    private expandedTreeItems: Set<string> = new Set<string>();
    private currentMarkedItemInfo: MarkedItemInfo | null = null;
    private generatedItemHierarchies: Map<string, GeneratedItemHierarchy> = new Map();

    private updateTreeViewStatusMessageCallback: (message: string | undefined) => void;

    constructor(updateMessageCallback: (message: string | undefined) => void, context: vscode.ExtensionContext) {
        this.extensionContext = context;
        this.updateTreeViewStatusMessageCallback = updateMessageCallback;
        vscode.commands.executeCommand("setContext", ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);

        this.loadMarkedItemsFromStorage();
    }

    /**
     * Loads marked items and hierarchies from workspace storage
     */
    private async loadMarkedItemsFromStorage(): Promise<void> {
        try {
            const storedMarkedItem = this.extensionContext.workspaceState.get<MarkedItemInfo>(
                StorageKeys.MARKED_TEST_GENERATION_ITEM
            );
            if (storedMarkedItem) {
                this.currentMarkedItemInfo = {
                    key: storedMarkedItem.key,
                    originalContextValue: storedMarkedItem.originalContextValue,
                    isDirectlyGenerated: storedMarkedItem.isDirectlyGenerated ?? true // True for existing items
                };
                logger.trace(
                    `[TestThemeTreeDataProvider] Loaded marked item from workspace state: ${storedMarkedItem.key}`
                );
            }

            const storedHierarchies = this.extensionContext.workspaceState.get<Array<[string, any]>>(
                `${StorageKeys.MARKED_TEST_GENERATION_ITEM}_hierarchies`
            );
            if (storedHierarchies && Array.isArray(storedHierarchies)) {
                this.generatedItemHierarchies = new Map();
                for (const [key, hierarchyData] of storedHierarchies) {
                    const hierarchy: GeneratedItemHierarchy = {
                        rootKey: hierarchyData.rootKey,
                        rootUID: hierarchyData.rootUID,
                        markedSubItems: new Set(
                            Array.isArray(hierarchyData.markedSubItems) ? hierarchyData.markedSubItems : []
                        )
                    };
                    this.generatedItemHierarchies.set(key, hierarchy);
                }
                logger.trace(
                    `[TestThemeTreeDataProvider] Loaded ${this.generatedItemHierarchies.size} generated item hierarchies from storage`
                );
            }
        } catch (error) {
            logger.error("[TestThemeTreeDataProvider] Error loading marked items from storage:", error);
            this.generatedItemHierarchies = new Map();
            this.currentMarkedItemInfo = null;
        }
    }

    /**
     * Saves marked items and hierarchies to workspace storage
     */
    private async saveMarkedItemsToStorage(): Promise<void> {
        try {
            await this.extensionContext.workspaceState.update(
                StorageKeys.MARKED_TEST_GENERATION_ITEM,
                this.currentMarkedItemInfo
            );

            // Convert Sets to Arrays
            const hierarchiesForStorage = Array.from(this.generatedItemHierarchies.entries()).map(
                ([key, hierarchy]) => [
                    key,
                    {
                        rootKey: hierarchy.rootKey,
                        rootUID: hierarchy.rootUID,
                        markedSubItems: Array.from(hierarchy.markedSubItems)
                    }
                ]
            );

            await this.extensionContext.workspaceState.update(
                `${StorageKeys.MARKED_TEST_GENERATION_ITEM}_hierarchies`,
                hierarchiesForStorage
            );
        } catch (error) {
            logger.error("[TestThemeTreeDataProvider] Error saving marked items to storage:", error);
        }
    }

    public setTreeViewStatusMessage(message: string | undefined): void {
        this.updateTreeViewStatusMessageCallback(message);
    }

    /**
     * Determines if an item should show import functionality based on the generated hierarchies
     */
    private shouldShowImportFunctionality(itemKey: string): { shouldShow: boolean; rootUID?: string } {
        // Check if this item is directly marked
        if (this.currentMarkedItemInfo && this.currentMarkedItemInfo.key === itemKey) {
            return { shouldShow: true, rootUID: this.getItemUIDByKey(itemKey) };
        }

        // Check if this item is part of any generated hierarchy
        for (const hierarchy of this.generatedItemHierarchies.values()) {
            if (hierarchy.markedSubItems.has(itemKey)) {
                return { shouldShow: true, rootUID: this.getItemUIDByKey(itemKey) };
            }
        }

        return { shouldShow: false };
    }

    /**
     * Gets the UID for an item by its key
     */
    private getItemUIDByKey(treeItemKey: string): string | undefined {
        const treeItem = this.findItemByKey(treeItemKey, this.rootElements);
        return treeItem?.item?.base?.uniqueID || treeItem?.item?.uniqueID;
    }

    /**
     * Recursively collects all descendant keys of a given item
     */
    private collectDescendantKeys(treeItem: BaseTestBenchTreeItem): string[] {
        const descendantsKeys: string[] = [];

        if (treeItem.children) {
            for (const child of treeItem.children) {
                const childKey = child.item?.base?.key || child.item?.key;
                if (childKey) {
                    descendantsKeys.push(childKey);
                    descendantsKeys.push(...this.collectDescendantKeys(child));
                }
            }
        }

        return descendantsKeys;
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
            this.isCustomRootActive && this.customRootItemInstance ? this.customRootItemInstance.item.base.key : null;

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
            if (!connection) {
                logger.error("TestThemeTreeDataProvider: No active connection to TestBench server.");
                this.setTreeViewStatusMessage("Error: Not connected to TestBench server.");
                if (!this.isCustomRootActive) {
                    this.rootElements = [];
                }
                return;
            }

            rawCycleStructure = await connection.fetchCycleStructureOfCycleInProject(
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
                    logger.debug(
                        `Soft refreshing custom root: ${this.customRootItemInstance.label} (Key: ${currentCustomRootKeyBeforeRefresh})`
                    );

                    const elementsByKey: Map<string, CycleNodeData> = new Map<string, CycleNodeData>();
                    rawCycleStructure.nodes.forEach((node: CycleNodeData) => {
                        if (node?.base?.key) {
                            elementsByKey.set(node.base.key, node);
                        }
                    });

                    const updatedCustomRootNodeData = elementsByKey.get(currentCustomRootKeyBeforeRefresh);

                    if (updatedCustomRootNodeData && this.customRootItemInstance) {
                        this.customRootItemInstance.item = updatedCustomRootNodeData;
                        const newLabel = updatedCustomRootNodeData.base.numbering
                            ? `${updatedCustomRootNodeData.base.numbering} ${updatedCustomRootNodeData.base.name}`
                            : updatedCustomRootNodeData.base.name;
                        if (this.customRootItemInstance.label !== newLabel) {
                            this.customRootItemInstance.label = newLabel;
                        }
                        this.customRootItemInstance.statusOfTreeItem = updatedCustomRootNodeData.exec?.status || "None";
                        this.customRootItemInstance.updateIcon();

                        this.customRootItemInstance.children = this.buildThemeTreeRecursively(
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
            } else if (!operationSuccessful && connection) {
                this.setTreeViewStatusMessage(
                    `Error loading themes for ${this._currentCycleLabel || this._currentCycleKey}.`
                );
            } else if (!connection) {
                this.setTreeViewStatusMessage("Error: Not connected to TestBench server.");
            } else {
                this.setTreeViewStatusMessage(undefined);
            }

            if (this.currentMarkedItemInfo) {
                const item = this.findItemByKey(this.currentMarkedItemInfo.key, this.rootElements);
                if (item) {
                    if (this.currentMarkedItemInfo.originalContextValue === TreeItemContextValues.TEST_THEME_NODE) {
                        item.contextValue = TreeItemContextValues.MARKED_TEST_THEME_NODE;
                    } else if (
                        this.currentMarkedItemInfo.originalContextValue === TreeItemContextValues.TEST_CASE_SET_NODE
                    ) {
                        item.contextValue = TreeItemContextValues.MARKED_TEST_CASE_SET_NODE;
                    }
                    item._isMarkedForImport = true;
                    item.updateIcon();
                    this._onDidChangeTreeData.fire(item);
                }
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
     * Returns the parent of a given tree item.
     * @param {BaseTestBenchTreeItem} element The tree item.
     * @returns {BaseTestBenchTreeItem | null} The parent TestbenchTreeItem or null.
     */
    getParent(element: BaseTestBenchTreeItem): BaseTestBenchTreeItem | null {
        return element.parent;
    }

    /**
     * Returns the children of a given tree item. If no element is provided,
     * returns the root elements.
     * @param {BaseTestBenchTreeItem} element Optional parent tree item.
     * @returns {Promise<BaseTestBenchTreeItem[]>} A promise resolving to an array of TestbenchTreeItems.
     */
    async getChildren(element?: BaseTestBenchTreeItem): Promise<BaseTestBenchTreeItem[]> {
        if (!element) {
            if (this.isCustomRootActive && this.customRootItemInstance) {
                return [this.customRootItemInstance];
            }
            return this.rootElements;
        }
        return element.children || [];
    }

    /**
     * Returns the TreeItem representation for a given element.
     * @param {BaseTestBenchTreeItem[]} element The TestbenchTreeItem.
     * @returns {vscode.TreeItem} The corresponding vscode.TreeItem.
     */
    getTreeItem(element: BaseTestBenchTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Recursively finds an item in a tree of `BaseTestBenchTreeItem` objects by its key.
     *
     * @param {string} key - The key to search for.
     * @param {BaseTestBenchTreeItem[]} items - The array of `BaseTestBenchTreeItem` objects to search within.
     * @returns {BaseTestBenchTreeItem | null} The `BaseTestBenchTreeItem` if found, otherwise `null`.
     */
    private findItemByKey(key: string, items: BaseTestBenchTreeItem[]): BaseTestBenchTreeItem | null {
        for (const item of items) {
            if (item.item?.key === key || item.item?.base?.key === key) {
                return item;
            }
            if (item.children) {
                const found = this.findItemByKey(key, item.children);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }

    /**
     * Clears marking from a single item
     */
    private clearItemMarking(treeItem: BaseTestBenchTreeItem): void {
        if (treeItem.originalContextValue) {
            treeItem._isMarkedForImport = false;
            treeItem.contextValue = treeItem.originalContextValue;
            treeItem.updateIcon();
        }
    }

    /**
     * Clears the marked state of items and refreshes the view
     */
    private async clearOldMarkedItemAndRefresh(oldMarkedTreeItemKey?: string): Promise<void> {
        const keyToClear: string | undefined = oldMarkedTreeItemKey || this.currentMarkedItemInfo?.key;
        if (keyToClear) {
            const treeItem: BaseTestBenchTreeItem | null = this.findItemByKey(keyToClear, this.rootElements);
            if (treeItem && treeItem.originalContextValue) {
                this.clearItemMarking(treeItem);
            }

            // Clear all items from hierarchies
            for (const hierarchy of this.generatedItemHierarchies.values()) {
                for (const subItemKey of hierarchy.markedSubItems) {
                    const subItem = this.findItemByKey(subItemKey, this.rootElements);
                    if (subItem) {
                        this.clearItemMarking(subItem);
                    }
                }
            }

            this._onDidChangeTreeData.fire(undefined);
        }
    }

    /**
     * Marks a specified `BaseTestBenchTreeItem` as "generated".
     * This involves updating its `contextValue` and icon, persisting the marked state,
     * and clearing any previously marked item.
     * @param {BaseTestBenchTreeItem} itemToMark The tree item to be marked.
     */
    public async markItemAsGenerated(itemToMark: BaseTestBenchTreeItem): Promise<void> {
        if (!itemToMark || (!itemToMark.item?.key && !itemToMark.item?.base?.key)) {
            logger.warn("[TestThemeTreeDataProvider] Attempted to mark an invalid item.");
            return;
        }

        const itemKey = itemToMark.item.key || itemToMark.item.base.key;
        const itemUID = itemToMark.item?.base?.uniqueID || itemToMark.item?.uniqueID;
        const originalContext = itemToMark.originalContextValue || itemToMark.contextValue;

        if (!originalContext || !itemUID) {
            logger.error(`[TestThemeTreeDataProvider] Cannot mark item ${itemKey}, required properties missing.`);
            return;
        }

        await this.clearOldMarkedItemAndRefresh();

        itemToMark._isMarkedForImport = true;
        this.updateItemContextForImport(itemToMark, originalContext);
        itemToMark.updateIcon();

        const descendantKeys = this.collectDescendantKeys(itemToMark);
        const hierarchy: GeneratedItemHierarchy = {
            rootKey: itemKey,
            rootUID: itemUID,
            markedSubItems: new Set(descendantKeys)
        };

        this.generatedItemHierarchies.set(itemKey, hierarchy);
        this.markDescendantsRecursively(itemToMark);
        this.currentMarkedItemInfo = {
            key: itemKey,
            originalContextValue: originalContext,
            isDirectlyGenerated: true
        };

        await this.saveMarkedItemsToStorage();

        logger.info(
            `[TestThemeTreeDataProvider] Marked item ${itemKey} and ${descendantKeys.length} descendants for import functionality.`
        );

        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Recursively marks descendants with import functionality.
     * Only marks TestThemeNode and TestCaseSetNode descendants.
     */
    private markDescendantsRecursively(parentItem: BaseTestBenchTreeItem): void {
        if (!parentItem.children) {
            return;
        }

        for (const child of parentItem.children) {
            const childKey = child.item?.base?.key || child.item?.key;
            if (!childKey) {
                continue;
            }

            const originalContext = child.originalContextValue || child.contextValue;
            if (!originalContext) {
                continue;
            }

            if (
                originalContext === TreeItemContextValues.TEST_THEME_NODE ||
                originalContext === TreeItemContextValues.TEST_CASE_SET_NODE
            ) {
                child._isMarkedForImport = true;
                this.updateItemContextForImport(child, originalContext);
                child.updateIcon();
            }

            this.markDescendantsRecursively(child);
        }
    }

    /**
     * Updates the context value for import functionality
     */
    private updateItemContextForImport(item: BaseTestBenchTreeItem, originalContext: string): void {
        if (originalContext === TreeItemContextValues.TEST_THEME_NODE) {
            item.contextValue = TreeItemContextValues.MARKED_TEST_THEME_NODE;
        } else if (originalContext === TreeItemContextValues.TEST_CASE_SET_NODE) {
            item.contextValue = TreeItemContextValues.MARKED_TEST_CASE_SET_NODE;
        }
    }

    /**
     * Enhanced method to apply marking during tree building/refresh
     */
    private applyImportMarkingToItem(treeItem: BaseTestBenchTreeItem): void {
        const treeItemKey = treeItem.item?.base?.key || treeItem.item?.key;
        if (!treeItemKey) {
            return;
        }

        const importInfoOfTreeItem = this.shouldShowImportFunctionality(treeItemKey);
        if (importInfoOfTreeItem.shouldShow) {
            const originalContext = treeItem.originalContextValue || treeItem.contextValue;
            if (
                originalContext === TreeItemContextValues.TEST_THEME_NODE ||
                originalContext === TreeItemContextValues.TEST_CASE_SET_NODE
            ) {
                treeItem._isMarkedForImport = true;
                this.updateItemContextForImport(treeItem, originalContext);
                treeItem.updateIcon();
            }
        }
    }

    /**
     * Gets the appropriate reportRootUID for import based on the selected item
     */
    public getReportRootUIDForItem(item: BaseTestBenchTreeItem): string | undefined {
        const itemKey = item.item?.base?.key || item.item?.key;
        if (!itemKey) {
            return undefined;
        }

        // If this item was directly generated, use its own UID
        if (
            this.currentMarkedItemInfo &&
            this.currentMarkedItemInfo.key === itemKey &&
            this.currentMarkedItemInfo.isDirectlyGenerated
        ) {
            return item.item?.base?.uniqueID || item.item?.uniqueID;
        }

        // For sub items, use its own UID for targeted import
        const importInfo = this.shouldShowImportFunctionality(itemKey);
        if (importInfo.shouldShow) {
            return item.item?.base?.uniqueID || item.item?.uniqueID;
        }

        return undefined;
    }

    /**
     * Clears the marked status of a specified tree item.
     * It removes the item's marked state from storage and refreshes the view.
     *
     * @param {BaseTestBenchTreeItem} itemToClear - The tree item whose marked status needs to be cleared.
     * @returns A promise that resolves when the operation is complete.
     */
    public async clearMarkedItemStatus(itemToClear: BaseTestBenchTreeItem): Promise<void> {
        if (!itemToClear || (!itemToClear.item?.key && !itemToClear.item?.base?.key)) {
            logger.warn("[clearMarkedItemStatus] Attempted to clear marked status for an invalid item.");
            return;
        }

        const itemKey = itemToClear.item.key || itemToClear.item.base.key;
        let hierarchyToRemove: string | null = null;

        // Check if this is a root item
        if (this.generatedItemHierarchies.has(itemKey)) {
            hierarchyToRemove = itemKey;
        } else {
            // Check if this is a sub item of any hierarchy
            for (const [rootKey, hierarchy] of this.generatedItemHierarchies) {
                if (hierarchy.markedSubItems.has(itemKey)) {
                    hierarchyToRemove = rootKey;
                    break;
                }
            }
        }

        if (hierarchyToRemove) {
            this.generatedItemHierarchies.delete(hierarchyToRemove);
        }

        await this.clearOldMarkedItemAndRefresh(itemKey);
        this.currentMarkedItemInfo = null;
        await this.saveMarkedItemsToStorage();

        logger.info(`[clearMarkedItemStatus] Cleared marked status for item ${itemKey} and its hierarchy.`);
    }
    /**
     * Sets the root elements of the test theme tree and refreshes the view.
     * This method is typically called when initially populating from cycle data.
     * @param {BaseTestBenchTreeItem[]} roots An array of TestbenchTreeItems to set as roots.
     * @param {string} projectKey The key of the project this cycle belongs to.
     * @param {string} cycleKey The key of the cycle these roots belong to.
     * @param {string} cycleLabel The label/name of the cycle.
     */
    private setRoots(roots: BaseTestBenchTreeItem[], projectKey: string, cycleKey: string, cycleLabel: string): void {
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
     * @param {BaseTestBenchTreeItem} element The TestbenchTreeItem to set as root.
     */
    makeRoot(element: BaseTestBenchTreeItem): void {
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
            const itemThatWasRoot: BaseTestBenchTreeItem | null = this.customRootItemInstance;
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
     * @param {BaseTestBenchTreeItem} element The TestbenchTreeItem.
     * @param {boolean} expanded True if the item is expanded; false if collapsed.
     */
    handleExpansion(element: BaseTestBenchTreeItem, expanded: boolean): void {
        logger.trace(
            `Setting expansion state of "${element.label}" to ${
                expanded ? "expanded" : "collapsed"
            } in test theme tree.`
        );
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;

        if (expanded && element.item?.key) {
            this.expandedTreeItems.add(element.item.key);
        } else if (element.item?.key) {
            this.expandedTreeItems.delete(element.item.key);
        }

        element.updateIcon();
    }

    /**
     * Recursively stores the keys of expanded nodes.
     * @param {BaseTestBenchTreeItem[] | null} elements An array of TestbenchTreeItems or null.
     */
    private storeExpandedTreeItems(elements: BaseTestBenchTreeItem[] | null): void {
        if (elements) {
            elements.forEach((element) => {
                if (element.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                    this.expandedTreeItems.add(element.item.key);
                }
                if (element.children) {
                    this.storeExpandedTreeItems(element.children);
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
                this.rootElements = this.buildThemeTreeRecursively(
                    rootCycleNodeKey,
                    null,
                    elementsByKey,
                    eventData.rawCycleStructure.root.base.name
                );
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
     * @param {BaseTestBenchTreeItem | null} parentTreeItem - The parent tree item in the current recursion level, or null for the root.
     * @param {Map<string, CycleNodeData>} elementsByKey - A map containing all available cycle node data, keyed by their unique keys.
     * @param {string} parentNameForLogging - The name of the parent item, used for logging purposes.
     * @returns {BaseTestBenchTreeItem[]} An array of `BaseTestBenchTreeItem` representing the children of the specified parent.
     */
    private buildThemeTreeRecursively(
        parentItemKey: string,
        parentTreeItem: BaseTestBenchTreeItem | null,
        elementsByKey: Map<string, CycleNodeData>,
        parentNameForLogging: string
    ): BaseTestBenchTreeItem[] {
        logger.trace(
            `TestThemeTreeDataProvider: Building children for parentKey: ${parentItemKey} ('${parentNameForLogging}')`
        );
        const potentialChildrenData: CycleNodeData[] = Array.from(elementsByKey.values()).filter(
            (node) => node?.base?.parentKey === parentItemKey && this.isCycleNodeVisibleInTestThemeTree(node)
        );

        const childTreeItems: (BaseTestBenchTreeItem | null)[] = potentialChildrenData.map((nodeData) => {
            const hasVisibleChildren: boolean = Array.from(elementsByKey.values()).some(
                (childNodeCandidate) =>
                    childNodeCandidate?.base?.parentKey === nodeData.base.key &&
                    this.isCycleNodeVisibleInTestThemeTree(childNodeCandidate)
            );

            const treeItem: BaseTestBenchTreeItem | null = this.createThemeTreeItem(
                nodeData,
                nodeData.elementType,
                parentTreeItem,
                hasVisibleChildren
            );

            if (!treeItem) {
                return null;
            }

            if (hasVisibleChildren) {
                treeItem.children = this.buildThemeTreeRecursively(
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

        return childTreeItems.filter(
            (item: BaseTestBenchTreeItem | null): item is BaseTestBenchTreeItem => item !== null
        );
    }

    /**
     * Creates a tree item for the Test Theme view.
     *
     * @param {CycleNodeData} nodeData - The raw data for the theme item.
     * @param {string} originalContextValue - The context value determining the item's type and behavior.
     * @param {BaseTestBenchTreeItem | null} parent - The parent tree item, or null if it's a root item.
     * @param {boolean} hasVisibleChildren - Indicates if the item has children that are currently visible in the tree.
     * @returns A new {@link BaseTestBenchTreeItem} instance, or null if `nodeData` is invalid.
     */
    private createThemeTreeItem(
        nodeData: CycleNodeData,
        originalContextValue: string,
        parent: BaseTestBenchTreeItem | null,
        hasVisibleChildren: boolean
    ): BaseTestBenchTreeItem | null {
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

        const treeItem: BaseTestBenchTreeItem = new BaseTestBenchTreeItem(
            label,
            originalContextValue,
            defaultCollapsibleState,
            nodeData,
            parent
        );

        this.applyImportMarkingToItem(treeItem);

        // Restore expansion state
        const itemKeyForExpansion = treeItem.item?.base?.key;
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
