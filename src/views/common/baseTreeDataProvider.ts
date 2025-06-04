/**
 * @file src/views/common/baseTreeDataProvider.ts
 * @description Base class for VS Code TreeDataProviders with improved service integration
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeItem as BaseTreeItem } from "./baseTreeItem";
import { CustomRootService } from "../../services/customRootService";

export interface TreeDataProviderOptions {
    contextKey: string;
    customRootContextValue: string;
    enableCustomRoot?: boolean;
    enableExpansionTracking?: boolean;
}

export abstract class BaseTreeDataProvider<T extends BaseTreeItem> implements vscode.TreeDataProvider<T> {
    public _onDidChangeTreeData: vscode.EventEmitter<T | T[] | undefined | void> = new vscode.EventEmitter<
        T | T[] | undefined | void
    >();
    public readonly onDidChangeTreeData: vscode.Event<T | T[] | undefined | void> = this._onDidChangeTreeData.event;

    protected customRootService: CustomRootService<T>;
    protected rootElements: T[] = [];

    constructor(
        protected readonly extensionContext: vscode.ExtensionContext,
        protected readonly logger: TestBenchLogger,
        protected updateMessageCallback: (message: string | undefined) => void,
        private readonly options: TreeDataProviderOptions
    ) {
        this.customRootService = new CustomRootService<T>(
            logger,
            options.contextKey,
            options.customRootContextValue,
            (state) => this.onCustomRootStateChange(state)
        );
    }

    /**
     * Abstract methods that must be implemented by subclasses
     */
    protected abstract fetchRootElements(): Promise<T[]>;
    protected abstract fetchChildrenForElement(element: T): Promise<T[]>;
    protected abstract createTreeItemFromData(data: any, parent: T | null): T | null;

    /**
     * Get tree item representation
     */
    getTreeItem(element: T): vscode.TreeItem {
        return element;
    }

    /**
     * Get parent of an element
     */
    getParent(element: T): vscode.ProviderResult<T> {
        if (this.customRootService.isActive()) {
            const currentRoot = this.customRootService.getCurrentRoot();
            if (element === currentRoot) {
                return null;
            }
            if (element.parent === currentRoot) {
                return currentRoot;
            }
        }
        return element.parent as T;
    }

    /**
     * Get children of an element or root elements
     */
    async getChildren(element?: T): Promise<T[]> {
        try {
            if (!element) {
                return await this.getRootChildren();
            }

            // Check if this is a custom root request
            if (this.customRootService.isActive() && this.customRootService.isCurrentRoot(element)) {
                return await this.getChildrenForCustomRoot(element);
            }

            return await this.fetchChildrenForElement(element);
        } catch (error: any) {
            this.logger.error(
                `[BaseTreeDataProvider] Error in getChildren for element ${element?.label || "root"}: ${error.message}`,
                error
            );
            this.updateMessageCallback(`Error loading tree items: ${error.message}`);
            return [];
        }
    }

    /**
     * Refresh the tree view
     */
    public refresh(isHardRefresh: boolean = false): void {
        this.logger.debug(`[BaseTreeDataProvider] Refreshing tree. Hard refresh: ${isHardRefresh}`);

        if (isHardRefresh) {
            this.customRootService.handleHardRefresh();
        }

        if (!this.customRootService.isActive()) {
            this.updateMessageCallback("Loading...");
        }

        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Clear tree data
     */
    public clearTree(): void {
        this.logger.debug(`[${this.constructor.name}] Clearing tree`);
        if (this.options.enableCustomRoot) {
            this.customRootService.resetCustomRoot();
        }
        this.rootElements = [];
        this.updateMessageCallback(undefined);
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Set an item as custom root
     */
    public makeRoot(item: T): void {
        if (!this.options.enableCustomRoot) {
            this.logger.warn("[BaseTreeDataProvider] Custom root is not enabled for this provider");
            return;
        }

        if (!this.customRootService.canSetAsRoot(item)) {
            this.logger.error(`[BaseTreeDataProvider] Item cannot be set as root: ${item.label}`);
            return;
        }

        this.customRootService.setCustomRoot(item);
        this.updateMessageCallback(undefined);
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Reset custom root
     */
    public resetCustomRoot(): void {
        this.customRootService.resetCustomRoot();
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Handle expansion of an item
     */
    public handleExpansion(element: T, expanded: boolean): void {
        element.handleExpansion(expanded);

        if (this.options.enableExpansionTracking) {
            const itemId = element.getUniqueId();
            if (expanded) {
                this.customRootService.rememberExpandedItem(itemId);
            } else {
                this.customRootService.forgetExpandedItem(itemId);
            }
        }
    }

    /**
     * Apply stored expansion state to an item
     */
    protected applyStoredExpansionState(item: T): void {
        if (this.options.enableExpansionTracking) {
            this.customRootService.applyExpansionState(item);
        }
    }

    /**
     * Store expansion state from current tree
     */
    protected storeExpansionState(): void {
        if (this.options.enableExpansionTracking) {
            this.customRootService.storeExpansionState(this.rootElements);
        }
    }

    /**
     * Get root children based on custom root state
     */
    private async getRootChildren(): Promise<T[]> {
        if (this.customRootService.isActive()) {
            return this.customRootService.getChildrenForCustomRoot();
        }

        this.rootElements = await this.fetchRootElements();
        return this.rootElements;
    }

    /**
     * Get children for custom root element
     */
    protected async getChildrenForCustomRoot(customRootElement: T): Promise<T[]> {
        return await this.fetchChildrenForElement(customRootElement);
    }

    /**
     * Handle custom root state changes
     */
    protected onCustomRootStateChange(state: any): void {
        this.logger.trace(`[BaseTreeDataProvider] Custom root state changed:`, state);
    }

    /**
     * Update tree elements and refresh
     */
    protected updateElements(elements: T[]): void {
        this.rootElements = elements;

        if (this.options.enableExpansionTracking) {
            // Apply expansion state to new elements
            const applyExpansionRecursive = (items: T[]) => {
                for (const item of items) {
                    this.applyStoredExpansionState(item);
                    if (item.children) {
                        applyExpansionRecursive(item.children as T[]);
                    }
                }
            };
            applyExpansionRecursive(elements);
        }

        this.updateMessageCallback(elements.length === 0 ? "No items found" : undefined);
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Find item by unique ID
     */
    protected findItemById(id: string, items?: T[]): T | null {
        const searchItems = items || this.rootElements;

        for (const item of searchItems) {
            if (item.getUniqueId() === id) {
                return item;
            }

            if (item.children) {
                const found = this.findItemById(id, item.children as T[]);
                if (found) {
                    return found;
                }
            }
        }

        return null;
    }

    /**
     * Get current root elements
     */
    public getCurrentElements(): T[] {
        return [...this.rootElements];
    }

    /**
     * Check if custom root is active
     */
    public isCustomRootActive(): boolean {
        return this.customRootService.isActive();
    }

    /**
     * Get current custom root item
     */
    public getCurrentCustomRoot(): T | null {
        return this.customRootService.getCurrentRoot();
    }

    public showTreeStatusMessage(message: string | undefined): void {
        this.updateMessageCallback(message);
        this.logger.trace(`[${this.constructor.name}] Status message updated to "${message}"`);
    }

    /**
     * Dispose of the provider
     */
    public dispose(): void {
        this.customRootService.dispose();
        this._onDidChangeTreeData.dispose();
    }
}
