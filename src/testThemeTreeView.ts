/**
 * @file testThemeTreeView.ts
 * @description Provides a VS Code TreeDataProvider implementation for the Test Theme Tree view.
 */

import * as vscode from "vscode";
import { BaseTestBenchTreeItem, CycleDataForThemeTreeEvent } from "./projectManagementTreeView";
import { logger, getTestThemeTreeViewInstance, connection } from "./extension";
import { TreeItemContextValues } from "./constants";
import { CycleNodeData, CycleStructure } from "./testBenchTypes";

/**
 * TestThemeTreeDataProvider implements the TreeDataProvider interface to display
 * TestTheme items in the Test Theme Tree view.
 */
export class TestThemeTreeDataProvider implements vscode.TreeDataProvider<BaseTestBenchTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<BaseTestBenchTreeItem | void> =
        new vscode.EventEmitter<BaseTestBenchTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<BaseTestBenchTreeItem | void> = this._onDidChangeTreeData.event;

    private _currentCycleKey: string | null = null;
    public getCurrentCycleKey(): string | null {
        return this._currentCycleKey;
    }
    private _currentProjectKey: string | null = null;
    public getCurrentProjectKey(): string | null {
        return this._currentProjectKey;
    }

    private _currentCycleLabel: string | null = null;

    /** Root elements for the Test Theme Tree view */
    rootElements: BaseTestBenchTreeItem[] = [];

    /** Set to store keys of expanded items so that refresh can restore expansion state */
    private expandedTreeItems: Set<string> = new Set<string>();

    private updateTreeViewStatusMessageCallback: (message: string | undefined) => void;

    constructor(updateMessageCallback: (message: string | undefined) => void) {
        this.updateTreeViewStatusMessageCallback = updateMessageCallback;
    }

    public setTreeViewStatusMessage(message: string | undefined): void {
        this.updateTreeViewStatusMessageCallback(message);
    }

    /**
     * Refreshes the test theme tree view.
     * Fetches fresh data from the server for the current cycle,
     * clears any custom root, and updates tree view messages.
     * @param {boolean} isHardRefresh - If true, implies a user-initiated refresh (refresh button)) and not an internal refresh.
     */
    async refresh(isHardRefresh: boolean = false): Promise<void> {
        logger.debug(`Refreshing test theme tree view. Hard refresh: ${isHardRefresh}`);

        this.storeExpandedTreeItems(this.rootElements);

        if (!this._currentCycleKey || !this._currentProjectKey) {
            logger.warn("TestThemeTreeDataProvider: Cannot refresh without a current cycle and project key.");
            this.clearTree();
            this.updateTreeViewStatusMessageCallback("Select a cycle from the 'Projects' view to see test themes.");
            this._onDidChangeTreeData.fire(undefined);
            return;
        }

        this.setTreeViewStatusMessage(
            `Loading test themes for cycle: ${this._currentCycleLabel || this._currentCycleKey}...`
        );
        this.rootElements = [];
        this._onDidChangeTreeData.fire(undefined);

        try {
            if (!connection) {
                logger.error("TestThemeTreeDataProvider: No active connection to TestBench server.");
                this.setTreeViewStatusMessage("Error: Not connected to TestBench server.");
                this.rootElements = [];
                this._onDidChangeTreeData.fire(undefined);
                return;
            }

            const rawCycleStructure: CycleStructure | null = await connection.fetchCycleStructureOfCycleInProject(
                this._currentProjectKey,
                this._currentCycleKey
            );

            if (rawCycleStructure) {
                this.populateFromCycleData({
                    projectKey: this._currentProjectKey,
                    cycleKey: this._currentCycleKey,
                    cycleLabel: this._currentCycleLabel || this._currentCycleKey,
                    rawCycleStructure: rawCycleStructure
                });
            } else {
                logger.warn(
                    `TestThemeTreeDataProvider: Failed to fetch cycle structure for cycle ${this._currentCycleKey}.`
                );
                this.setTreeViewStatusMessage(
                    `Failed to load test themes for ${this._currentCycleLabel || this._currentCycleKey}.`
                );
                this.rootElements = [];
            }
        } catch (error) {
            logger.error(
                `TestThemeTreeDataProvider: Error during refresh data fetch for cycle ${this._currentCycleKey}:`,
                error
            );
            this.setTreeViewStatusMessage(
                `Error loading themes: ${error instanceof Error ? error.message : "Unknown error"}`
            );
            this.rootElements = [];
        } finally {
            const currentThemeTreeView = getTestThemeTreeViewInstance();
            if (this.rootElements.length === 0 && currentThemeTreeView) {
                if (!this.setTreeViewStatusMessage) {
                    if (this._currentCycleKey) {
                        this.setTreeViewStatusMessage(
                            this._currentCycleLabel
                                ? `No test themes found for cycle ${this._currentCycleLabel}.`
                                : "No test themes found for the current cycle."
                        );
                    } else {
                        this.setTreeViewStatusMessage("Select a cycle to see test themes.");
                    }
                }
            } else if (this.rootElements.length > 0) {
                this.setTreeViewStatusMessage(undefined);
            }
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    /**
     * Internal refresh logic after data population, to update messages and fire data change.
     * Avoids re-fetching if called from populateFromCycleData.
     */
    private internalRefreshAfterPopulate(): void {
        logger.debug("TestThemeTreeDataProvider: Internal refresh after populating data.");
        this.storeExpandedTreeItems(this.rootElements);

        const currentThemeTreeView = getTestThemeTreeViewInstance();
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
            if (currentThemeTreeView) {
                logger.trace(`Test Themes view message set: ${currentThemeTreeView.message}`);
            }
        } else {
            this.updateTreeViewStatusMessageCallback(undefined);
            if (currentThemeTreeView) {
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
            if (!this.rootElements || this.rootElements.length === 0) {
                logger.trace(
                    "TestThemeTreeDataProvider: No root elements found, returning empty. Message should be set."
                );
                return [];
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
     * Sets the root elements of the test theme tree and refreshes the view.
     * This method is typically called when initially populating from cycle data.
     * @param {BaseTestBenchTreeItem[]} roots An array of TestbenchTreeItems to set as roots.
     * @param {string} projectKey The key of the project this cycle belongs to.
     * @param {string} cycleKey The key of the cycle these roots belong to.
     * @param {string} cycleLabel The label/name of the cycle.
     */
    setRoots(roots: BaseTestBenchTreeItem[], projectKey: string, cycleKey: string, cycleLabel: string): void {
        logger.trace(
            `TestThemeTreeDataProvider: Setting roots for projectKey: ${projectKey}, cycleKey: ${cycleKey}, cycleLabel: ${cycleLabel}`
        );
        this._currentProjectKey = projectKey;
        this._currentCycleKey = cycleKey;
        this._currentCycleLabel = cycleLabel;
        this.rootElements = roots;

        const currentThemeTreeView = getTestThemeTreeViewInstance();
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
            if (currentThemeTreeView) {
                logger.trace(`Test Themes view message set: ${currentThemeTreeView.message}`);
            }
        } else {
            this.updateTreeViewStatusMessageCallback(undefined);
            if (currentThemeTreeView) {
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
        this.rootElements = [element];
        this._onDidChangeTreeData.fire(undefined);
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
     * @param {string} contextValue - The context value determining the item's type and behavior.
     * @param {BaseTestBenchTreeItem | null} parent - The parent tree item, or null if it's a root item.
     * @param {boolean} hasVisibleChildren - Indicates if the item has children that are currently visible in the tree.
     * @returns A new {@link BaseTestBenchTreeItem} instance, or null if `nodeData` is invalid.
     */
    private createThemeTreeItem(
        nodeData: CycleNodeData, // Raw data for the test theme item
        contextValue: string,
        parent: BaseTestBenchTreeItem | null,
        hasVisibleChildren: boolean
    ): BaseTestBenchTreeItem | null {
        if (
            !nodeData ||
            !nodeData.base ||
            typeof nodeData.base.key === "undefined" ||
            typeof nodeData.base.name === "undefined"
        ) {
            logger.warn(
                `TestThemeTreeDataProvider: Attempted to create theme tree item with invalid data structure for context ${contextValue}:`,
                nodeData
            );
            return null;
        }

        const itemName: string = nodeData.base.name;
        const label: string = nodeData.base.numbering ? `${nodeData.base.numbering} ${itemName}` : itemName;
        let defaultCollapsibleState: vscode.TreeItemCollapsibleState;

        switch (contextValue) {
            case TreeItemContextValues.TEST_THEME_NODE:
                defaultCollapsibleState = hasVisibleChildren
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
                break;
            case TreeItemContextValues.TEST_CASE_SET_NODE:
                defaultCollapsibleState = hasVisibleChildren
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
                break;
            // TEST_CASE_NODE is filtered out by isCycleNodeVisibleInTestThemeTree
            default:
                logger.warn(
                    `TestThemeTreeDataProvider: Unexpected contextValue '${contextValue}' during item creation.`
                );
                defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
        }

        const treeItem: BaseTestBenchTreeItem = new BaseTestBenchTreeItem(
            label,
            contextValue,
            defaultCollapsibleState,
            nodeData,
            parent
        );

        // Restore Expansion State
        const itemKeyForExpansion = treeItem.item?.base?.key; // Key is in item.base for CycleStructure nodes
        if (
            itemKeyForExpansion &&
            this.expandedTreeItems.has(itemKeyForExpansion) &&
            treeItem.collapsibleState !== vscode.TreeItemCollapsibleState.None
        ) {
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            logger.trace(
                `TestThemeTreeDataProvider: Restoring expanded state for item: ${treeItem.label} (Key: ${itemKeyForExpansion})`
            );
        }
        return treeItem;
    }
}

/**
 * Hides the test theme tree view.
 */
export async function hideTestThemeTreeView(): Promise<void> {
    if (getTestThemeTreeViewInstance()) {
        await vscode.commands.executeCommand("testThemeTree.removeView");
    } else {
        logger.debug("Test Theme Tree View instance not found; 'removeView' command not executed.");
    }
}

/**
 * Displays the test theme tree view.
 */
export async function displayTestThemeTreeView(): Promise<void> {
    if (getTestThemeTreeViewInstance()) {
        await vscode.commands.executeCommand("testThemeTree.focus");
    } else {
        logger.debug("Test Theme Tree View instance not found; 'removeView' command not executed.");
    }
}
