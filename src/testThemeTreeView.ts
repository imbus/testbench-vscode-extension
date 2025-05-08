/**
 * @file testThemeTreeView.ts
 * @description Provides a VS Code TreeDataProvider implementation for the Test Theme Tree view.
 */

import * as vscode from "vscode";
import { BaseTestBenchTreeItem } from "./projectManagementTreeView";
import { logger } from "./extension";
import { TreeItemContextValues } from "./constants";

/**
 * TestThemeTreeDataProvider implements the TreeDataProvider interface to display
 * TestTheme items in the Test Theme Tree view.
 */
export class TestThemeTreeDataProvider implements vscode.TreeDataProvider<BaseTestBenchTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<BaseTestBenchTreeItem | void> =
        new vscode.EventEmitter<BaseTestBenchTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<BaseTestBenchTreeItem | void> = this._onDidChangeTreeData.event;

    private _currentCycleKey: string | null = null;
    public isCurrentCycle(cycleKey: string): boolean {
        return this._currentCycleKey === cycleKey;
    }

    /** Root elements for the Test Theme Tree view */
    rootElements: BaseTestBenchTreeItem[] = [];

    /** Set to store keys of expanded items so that refresh can restore expansion state */
    private expandedTreeItems: Set<string> = new Set<string>();

    /**
     * Refreshes the test theme tree view.
     */
    refresh(): void {
        logger.debug("Refreshing test theme tree view.");
        // Store the keys of the expanded items to preserve state on refresh.
        this.storeExpandedTreeItems(this.rootElements);
        // Explicitly fire with undefined to ensure a full refresh from the root.
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
                logger.trace("TestThemeTreeDataProvider: No root elements found, returning placeholder.");
                // If no root elements are found, return a placeholder item.
                return [
                    new BaseTestBenchTreeItem(
                        "No test themes found for this cycle",
                        "placeholder.testTheme",
                        vscode.TreeItemCollapsibleState.None,
                        {},
                        null
                    )
                ];
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
     * @param {BaseTestBenchTreeItem[]} roots An array of TestbenchTreeItems to set as roots.
     * @param {string} cycleKey The key of the cycle these roots belong to.
     */
    setRoots(roots: BaseTestBenchTreeItem[], cycleKey: string): void {
        // Output of roots is circular and large, so it is commented out.
        // logger.trace("Setting root elements of the test theme tree to:", roots);
        this._currentCycleKey = cycleKey;
        this.rootElements = roots;
        this.refresh(); // This will call _onDidChangeTreeData.fire(undefined)
    }

    /**
     * Sets the selected tree item as the sole root of the test theme tree and refreshes the view.
     * @param {BaseTestBenchTreeItem} element The TestbenchTreeItem to set as root.
     */
    makeRoot(element: BaseTestBenchTreeItem): void {
        logger.debug("Setting the selected element as the root of the test theme tree view:", element);
        // Find the cycle key for the new root element if it's part of a cycle.
        let newCycleKey: string | null = null;
        if (element.parent && element.parent.contextValue === TreeItemContextValues.CYCLE) {
            newCycleKey = element.parent.item?.key;
        } else if (element.contextValue === TreeItemContextValues.CYCLE) {
            newCycleKey = element.item?.key;
        }
        // If a cycle key is found and is different, or if we are making a non-cycle element root, update _currentCycleKey.
        if (newCycleKey) {
            this._currentCycleKey = newCycleKey;
        } else {
            // If the new root isn't directly tied to a known cycle in its parentage here,
            // it might be an implicit change of context.
        }

        this.rootElements = [element];
        this.refresh();
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

        // Store the key of the expanded item in the set.
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
        this.rootElements = [];
        // TODO: Clear the expanded set items after clear command if needed.
        // this.expandedTreeItems.clear();
        this._onDidChangeTreeData.fire();
    }
}
