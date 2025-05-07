/**
 * @file testThemeTreeView.ts
 * @description Provides a VS Code TreeDataProvider implementation for the Test Theme Tree view.
 */

import * as vscode from "vscode";
import { ProjectManagementTreeItem } from "./projectManagementTreeView";
import { logger } from "./extension";

/**
 * TestThemeTreeDataProvider implements the TreeDataProvider interface to display
 * TestTheme items in the Test Theme Tree view.
 */
export class TestThemeTreeDataProvider implements vscode.TreeDataProvider<ProjectManagementTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProjectManagementTreeItem | void> =
        new vscode.EventEmitter<ProjectManagementTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<ProjectManagementTreeItem | void> = this._onDidChangeTreeData.event;

    /** Root elements for the Test Theme Tree view */
    rootElements: ProjectManagementTreeItem[] = [];

    /** Set to store keys of expanded items so that refresh can restore expansion state */
    private expandedTreeItems: Set<string> = new Set<string>();

    /**
     * Refreshes the test theme tree view.
     */
    refresh(): void {
        logger.debug("Refreshing test theme tree view.");
        // Store the keys of the expanded items to preserve state on refresh.
        this.storeExpandedTreeItems(this.rootElements);
        this._onDidChangeTreeData.fire();
    }

    /**
     * Returns the parent of a given tree item.
     * @param {ProjectManagementTreeItem} element The tree item.
     * @returns {ProjectManagementTreeItem | null} The parent TestbenchTreeItem or null.
     */
    getParent(element: ProjectManagementTreeItem): ProjectManagementTreeItem | null {
        return element.parent;
    }

    /**
     * Returns the children of a given tree item. If no element is provided,
     * returns the root elements.
     * @param {ProjectManagementTreeItem} element Optional parent tree item.
     * @returns {Promise<ProjectManagementTreeItem[]>} A promise resolving to an array of TestbenchTreeItems.
     */
    async getChildren(element?: ProjectManagementTreeItem): Promise<ProjectManagementTreeItem[]> {
        if (!element) {
            if (!this.rootElements || this.rootElements.length === 0) {
                logger.trace("TestThemeTreeDataProvider: No root elements found, returning placeholder.");
                // If no root elements are found, return a placeholder item.
                return [
                    new ProjectManagementTreeItem(
                        "No test themes found for this cycle",
                        "placeholder",
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
     * @param {ProjectManagementTreeItem[]} element The TestbenchTreeItem.
     * @returns {vscode.TreeItem} The corresponding vscode.TreeItem.
     */
    getTreeItem(element: ProjectManagementTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Sets the root elements of the test theme tree and refreshes the view.
     * @param {ProjectManagementTreeItem[]} roots An array of TestbenchTreeItems to set as roots.
     */
    setRoots(roots: ProjectManagementTreeItem[]): void {
        // Output of roots is circular and large, so it is commented out.
        // logger.trace("Setting root elements of the test theme tree to:", roots);
        this.rootElements = roots;
        this.refresh();
    }

    /**
     * Sets the selected tree item as the sole root of the test theme tree and refreshes the view.
     * @param {ProjectManagementTreeItem} element The TestbenchTreeItem to set as root.
     */
    makeRoot(element: ProjectManagementTreeItem): void {
        logger.debug("Setting the selected element as the root of the test theme tree view:", element);
        this.rootElements = [element];
        this.refresh();
    }

    /**
     * Handles expansion or collapse of a tree item and updates its icon.
     * @param {ProjectManagementTreeItem} element The TestbenchTreeItem.
     * @param {boolean} expanded True if the item is expanded; false if collapsed.
     */
    handleExpansion(element: ProjectManagementTreeItem, expanded: boolean): void {
        logger.trace(
            `Setting expansion state of "${element.label}" to ${
                expanded ? "expanded" : "collapsed"
            } in test theme tree.`
        );
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;

        if (expanded) {
            this.expandedTreeItems.add(element.item.key);
        } else {
            this.expandedTreeItems.delete(element.item.key);
        }

        element.updateIcon();
    }

    /**
     * Recursively stores the keys of expanded nodes.
     * @param {ProjectManagementTreeItem[] | null} elements An array of TestbenchTreeItems or null.
     */
    private storeExpandedTreeItems(elements: ProjectManagementTreeItem[] | null): void {
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
        this.rootElements = [];
        this.refresh();
    }
}
