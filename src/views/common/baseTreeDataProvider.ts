/**
 * @file src/views/common/baseTreeDataProvider.ts
 * @description Base class for VS Code TreeDataProviders in the TestBench extension,
 * providing common functionalities like custom root management and expansion state tracking.
 */

import * as vscode from "vscode";
import { BaseTestBenchTreeItem } from "./baseTreeItem";
import { logger } from "../../extension";

export abstract class BaseTreeDataProvider<T extends BaseTestBenchTreeItem> implements vscode.TreeDataProvider<T> {
    protected _onDidChangeTreeData: vscode.EventEmitter<T | T[] | undefined | void> = new vscode.EventEmitter<
        T | T[] | undefined | void
    >();
    public readonly onDidChangeTreeData: vscode.Event<T | T[] | undefined | void> = this._onDidChangeTreeData.event;

    public customRootItemInstance: T | null = null;
    public originalCustomRootContextValue: string | null = null;
    public isCustomRootActive: boolean = false;
    public expandedTreeItems: Set<string> = new Set<string>();

    constructor(
        protected readonly extensionContext: vscode.ExtensionContext,
        protected readonly updateMessageCallback: (message: string | undefined) => void
    ) {}

    /**
     * Gets the VS Code context key string that indicates if this tree view has a custom root.
     * (e.g., "testbenchExtension.projectTreeHasCustomRoot")
     */
    protected abstract getContextKeyForCustomRootSet(): string;

    /**
     * Gets the contextValue string to be set on the custom root item itself.
     * (e.g., "customRoot.project")
     */
    protected abstract getActualContextValueForCustomRootItem(): string;

    /**
     * Fetches/returns the children for the tree view.
     * If `element` is provided, it fetches children for that element.
     * If `element` is undefined, it fetches the root elements of the tree.
     * This method will be called by the base `getChildren` when not in a custom root scenario,
     * or when fetching children of a normal item.
     */
    protected abstract getChildrenForTreeView(element?: T): Promise<T[]>;

    /**
     * Fetches/returns the children for the current `customRootItemInstance`.
     * This method is called by the base `getChildren` when `customRootItemInstance` is the `element`.
     */
    protected abstract getChildrenOfCustomRoot(customRootElement: T): Promise<T[]>;

    /**
     * Returns the UI representation (TreeItem) of the element.
     * @param element The element for which to return the TreeItem.
     */
    getTreeItem(element: T): vscode.TreeItem {
        return element;
    }

    /**
     * Returns the parent of the given element.
     * Handles cases where a custom root is active.
     * @param element The element for which to get the parent.
     */
    getParent(element: T): vscode.ProviderResult<T> {
        if (this.isCustomRootActive && this.customRootItemInstance) {
            if (element === this.customRootItemInstance) {
                return null;
            }
            if (element.parent === this.customRootItemInstance) {
                return this.customRootItemInstance;
            }
        }
        return element.parent as T;
    }

    /**
     * Gets the children of a given tree item or the root elements if no item is provided.
     * Manages displaying either the custom root or the normal tree structure.
     * @param element Optional parent tree item.
     */
    async getChildren(element?: T): Promise<T[]> {
        try {
            if (!element) {
                if (this.isCustomRootActive && this.customRootItemInstance) {
                    if (this.customRootItemInstance.collapsibleState === vscode.TreeItemCollapsibleState.None) {
                        const children = await this.getChildrenOfCustomRoot(this.customRootItemInstance);
                        if (children.length > 0) {
                            this.customRootItemInstance.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                        }
                    }
                    return [this.customRootItemInstance];
                }
                return await this.getChildrenForTreeView();
            }

            if (
                this.isCustomRootActive &&
                this.customRootItemInstance &&
                (element.item?.key === this.customRootItemInstance.item?.key ||
                    element.item?.base?.key === this.customRootItemInstance.item?.base?.key)
            ) {
                return await this.getChildrenOfCustomRoot(element);
            }
            return await this.getChildrenForTreeView(element);
        } catch (error: any) {
            logger.error(
                `[BaseTreeDataProvider] Error in getChildren for element ${element?.label || "root"}: ${error.message}`,
                error
            );
            this.updateMessageCallback(`Error loading tree items: ${error.message}`);
            return [];
        }
    }

    /**
     * Sets the selected tree item as the root for this tree view.
     * @param treeItem The tree item to set as the custom root.
     */
    public makeRoot(treeItem: T): void {
        const itemName = typeof treeItem.label === "string" ? treeItem.label : treeItem.item?.name || "UnknownItem";
        logger.debug(`[BaseTreeDataProvider] Setting item "${itemName}" as custom root.`);

        if (
            this.customRootItemInstance &&
            this.customRootItemInstance !== treeItem &&
            this.originalCustomRootContextValue
        ) {
            this.customRootItemInstance.contextValue = this.originalCustomRootContextValue;
            this.customRootItemInstance.updateIcon();
        }

        this.customRootItemInstance = treeItem;
        this.originalCustomRootContextValue = treeItem.contextValue ?? null;
        treeItem.contextValue = this.getActualContextValueForCustomRootItem();
        treeItem.parent = null;
        this.isCustomRootActive = true;
        if (treeItem.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }
        treeItem.updateIcon();

        vscode.commands.executeCommand("setContext", this.getContextKeyForCustomRootSet(), true);
        this.updateMessageCallback(undefined);
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Resets the custom root, restoring the tree to its default full view.
     */
    public resetCustomRoot(): void {
        const itemName = this.customRootItemInstance
            ? typeof this.customRootItemInstance.label === "string"
                ? this.customRootItemInstance.label
                : this.customRootItemInstance.item?.name
            : "N/A";
        logger.debug(`[BaseTreeDataProvider] Resetting custom root. Previously: "${itemName}"`);
        if (this.isCustomRootActive) {
            this.resetCustomRootInternally();
            this._onDidChangeTreeData.fire(undefined);
            logger.info("[BaseTreeDataProvider] Custom root has been reset.");
        } else {
            logger.trace("[BaseTreeDataProvider] No custom root was active to reset.");
        }
    }

    /**
     * Internal logic to reset custom root state variables.
     */
    protected resetCustomRootInternally(): void {
        if (this.customRootItemInstance && this.originalCustomRootContextValue) {
            this.customRootItemInstance.contextValue = this.originalCustomRootContextValue;
            this.customRootItemInstance.updateIcon();
        }
        this.customRootItemInstance = null;
        this.originalCustomRootContextValue = null;
        this.isCustomRootActive = false;
        this.expandedTreeItems.clear();
        vscode.commands.executeCommand("setContext", this.getContextKeyForCustomRootSet(), false);
        this.updateMessageCallback(undefined);
    }

    /**
     * Remembers an item that has been expanded in the tree view.
     * @param element The expanded tree item.
     */
    public rememberExpandedItem(element: T): void {
        const itemId = element.item?.key || element.item?.base?.key;
        if (itemId) {
            this.expandedTreeItems.add(itemId);
            logger.trace(`[BaseTreeDataProvider] Remembered expanded item: "${element.label}" (ID: ${itemId})`);
        }
    }

    /**
     * Forgets an item that has been collapsed in the tree view.
     * @param element The collapsed tree item.
     */
    public forgetExpandedItem(element: T): void {
        const itemId = element.item?.key || element.item?.base?.key;
        if (itemId) {
            this.expandedTreeItems.delete(itemId);
            logger.trace(`[BaseTreeDataProvider] Forgot expanded item: "${element.label}" (ID: ${itemId})`);
        }
    }

    /**
     * Applies the stored expansion state to a given tree item.
     * Typically called by derived classes when creating tree items.
     * @param item The tree item to apply expansion state to.
     */
    protected applyStoredExpansionState(item: T): void {
        const itemId = item.item?.key || item.item?.base?.key;
        if (itemId && this.expandedTreeItems.has(itemId)) {
            if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            }
        }
    }

    /**
     * Refreshes the tree view, optionally performing a hard refresh.
     * Derived classes should override to implement their specific refresh logic,
     * potentially calling `super.refresh()` or `this._onDidChangeTreeData.fire()`.
     * @param isHardRefresh Optional flag to force a hard refresh.
     */
    public refresh(isHardRefresh: boolean = false): void {
        logger.debug(`[BaseTreeDataProvider] Base refresh called. Hard refresh: ${isHardRefresh}`);
        if (isHardRefresh && this.isCustomRootActive) {
            this.resetCustomRootInternally();
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Clears all data from the tree and resets its state.
     * Derived classes should implement specific logic to clear their data stores.
     */
    public clearTree(): void {
        logger.debug("[BaseTreeDataProvider] Base clearTree called.");
        this.resetCustomRootInternally();
        this.expandedTreeItems.clear();
        this._onDidChangeTreeData.fire(undefined);
    }
}
