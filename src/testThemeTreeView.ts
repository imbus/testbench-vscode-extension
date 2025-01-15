import * as vscode from "vscode";
import { TestbenchTreeItem } from "./projectManagementTreeView";
import { logger } from "./extension";

export class TestThemeTreeDataProvider implements vscode.TreeDataProvider<TestbenchTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TestbenchTreeItem | void> =
        new vscode.EventEmitter<TestbenchTreeItem | void>();
    readonly onDidChangeTreeData: vscode.Event<TestbenchTreeItem | void> = this._onDidChangeTreeData.event;

    rootElements: TestbenchTreeItem[] = [];

    private expandedNodes = new Set<string>(); // To store expanded node keys

    refresh(): void {
        logger.trace("Refreshing test theme tree view.");

        // Store the keys of the expanded nodes
        this.storeExpandedNodes(this.rootElements);

        // Trigger refresh
        this._onDidChangeTreeData.fire();
    }

    getParent(element: TestbenchTreeItem): TestbenchTreeItem | null {
        return element.parent;
    }

    async getChildren(element?: TestbenchTreeItem): Promise<TestbenchTreeItem[]> {
        if (!element) {
            return this.rootElements;
        }

        return element.children || [];
    }

    getTreeItem(element: TestbenchTreeItem): vscode.TreeItem {
        return element;
    }

    // Set the root elements of the tree
    setRoots(roots: TestbenchTreeItem[]): void {
        logger.trace("Setting root elements of the test theme tree to:", roots);
        this.rootElements = roots;
        this.refresh();
    }

    // Set the selected element as the only root element
    makeRoot(element: TestbenchTreeItem): void {
        logger.trace("Setting the selected element as the root of the test theme tree view:", element);
        this.rootElements = [element]; // Set the selected element as the root
        this.refresh(); // Refresh the tree to display the new root
    }

    handleExpansion(element: TestbenchTreeItem, expanded: boolean): void {
        logger.trace(
            `Setting the expansion state of ${element.label} to ${
                expanded ? "expanded" : "collapsed"
            } in test theme tree.`
        );
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        
        if (expanded) {
            this.expandedNodes.add(element.item.key);
        } else {
            this.expandedNodes.delete(element.item.key);
        }
        
        element.updateIcon();
    }

    // Recursive function to store the keys of the expanded nodes
    private storeExpandedNodes(elements: TestbenchTreeItem[] | null) {
        if (elements) {
            elements.forEach((element) => {
                if (element.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                    this.expandedNodes.add(element.item.key);
                }
                // Recursively check child elements
                if (element.children) {
                    this.storeExpandedNodes(element.children);
                }
            });
        }
    }

    // Clear the tree
    clearTree(): void {
        logger.trace("Clearing the test theme tree.");
        this.rootElements = [];
        this.refresh();
    }
}
