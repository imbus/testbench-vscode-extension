/**
 * @file src/views/common/customRootService.ts
 * @description Service for managing custom root state across tree providers
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { BaseTreeItem as BaseTreeItem } from "./baseTreeItem";

export interface CustomRootState<T extends BaseTreeItem> {
    isActive: boolean;
    rootItem: T | null;
    originalContextValue: string | null;
    customContextValue: string;
}

export class CustomRootService<T extends BaseTreeItem> {
    private state: CustomRootState<T>;
    private expandedItems: Set<string> = new Set();

    constructor(
        private readonly logger: TestBenchLogger,
        private readonly contextKey: string,
        private readonly customContextValue: string,
        private readonly onStateChange?: (state: CustomRootState<T>) => void
    ) {
        this.state = {
            isActive: false,
            rootItem: null,
            originalContextValue: null,
            customContextValue
        };
    }

    /**
     * Set an item as the custom root
     */
    public setCustomRoot(item: T): void {
        this.logger.debug(`[CustomRootService] Setting custom root: ${item.label}`);

        // Reset previous custom root if exists
        if (this.state.rootItem && this.state.rootItem !== item) {
            this.resetPreviousRoot();
        }

        this.state = {
            isActive: true,
            rootItem: item,
            originalContextValue: item.contextValue ?? null,
            customContextValue: this.customContextValue
        };

        item.setAsCustomRoot(true);
        item.contextValue = this.customContextValue;

        if (item.children && item.children.length > 0) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }

        vscode.commands.executeCommand("setContext", this.contextKey, true);
        this.onStateChange?.(this.state);
        this.logger.info(`[CustomRootService] Custom root set to: ${item.label}`);
    }

    /**
     * Reset custom root to normal view
     */
    public resetCustomRoot(): void {
        this.logger.debug(`[CustomRootService] Resetting custom root`);

        if (!this.state.isActive) {
            this.logger.trace(`[CustomRootService] No custom root active to reset`);
            return;
        }

        this.resetPreviousRoot();
        this.clearState();
    }

    /**
     * Get current custom root state
     */
    public getState(): Readonly<CustomRootState<T>> {
        return { ...this.state };
    }

    /**
     * Check if custom root is active
     */
    public isActive(): boolean {
        return this.state.isActive;
    }

    /**
     * Get current custom root item
     */
    public getCurrentRoot(): T | null {
        return this.state.rootItem;
    }

    /**
     * Remember expanded item
     */
    public rememberExpandedItem(itemId: string): void {
        this.expandedItems.add(itemId);
        this.logger.trace(`[CustomRootService] Remembered expanded item: ${itemId}`);
    }

    /**
     * Forget expanded item
     */
    public forgetExpandedItem(itemId: string): void {
        this.expandedItems.delete(itemId);
        this.logger.trace(`[CustomRootService] Forgot expanded item: ${itemId}`);
    }

    /**
     * Check if item should be expanded
     */
    public shouldBeExpanded(itemId: string): boolean {
        return this.expandedItems.has(itemId);
    }

    /**
     * Clear all expansion state
     */
    public clearExpansionState(): void {
        this.expandedItems.clear();
    }

    /**
     * Get all expanded items
     */
    public getExpandedItems(): string[] {
        return Array.from(this.expandedItems);
    }

    /**
     * Set expanded items
     * @param expandedItems Array of item IDs that should be expanded
     */
    public setExpandedItems(expandedItems: string[]): void {
        this.expandedItems = new Set(expandedItems);
        this.logger.trace(`[CustomRootService] Set expanded items: ${expandedItems.length} items`);
    }

    /**
     * Check if an item is the current custom root
     */
    public isCurrentRoot(item: T): boolean {
        if (!this.state.isActive || !this.state.rootItem) {
            return false;
        }

        return this.state.rootItem.getUniqueId() === item.getUniqueId();
    }

    /**
     * Get the original context value for the current root
     */
    public getOriginalContextValue(): string | null {
        return this.state.originalContextValue;
    }

    /**
     * Handle hard refresh - typically resets custom root
     */
    public handleHardRefresh(): boolean {
        if (this.state.isActive) {
            this.resetCustomRoot();
            return true;
        }
        return false;
    }

    /**
     * Apply stored expansion state to an item
     */
    public applyExpansionState(item: T): void {
        const itemId = item.getUniqueId();
        if (this.shouldBeExpanded(itemId)) {
            if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            }
        }
    }

    /**
     * Store expansion state from a tree
     */
    public storeExpansionState(items: T[]): void {
        const storeRecursive = (treeItems: T[]) => {
            for (const item of treeItems) {
                if (item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                    this.rememberExpandedItem(item.getUniqueId());
                }
                if (item.children) {
                    storeRecursive(item.children as T[]);
                }
            }
        };

        storeRecursive(items);
    }

    /**
     * Reset the previous root item's state
     */
    private resetPreviousRoot(): void {
        if (this.state.rootItem && this.state.originalContextValue) {
            this.state.rootItem.setAsCustomRoot(false);
            this.state.rootItem.contextValue = this.state.originalContextValue;
            this.state.rootItem.updateIcon();
        }
    }

    /**
     * Clear internal state
     */
    private clearState(): void {
        this.state = {
            isActive: false,
            rootItem: null,
            originalContextValue: null,
            customContextValue: this.customContextValue
        };
        vscode.commands.executeCommand("setContext", this.contextKey, false);
        this.clearExpansionState();
        this.onStateChange?.(this.state);
        this.logger.info(`[CustomRootService] Custom root state cleared`);
    }

    /**
     * Validate if an item can be set as custom root
     */
    public canSetAsRoot(item: T): boolean {
        return item !== null && item.getUniqueId() !== undefined;
    }

    /**
     * Get children for custom root - utility method for tree providers
     */
    public getChildrenForCustomRoot(): T[] {
        if (!this.state.isActive || !this.state.rootItem) {
            return [];
        }
        if (this.state.rootItem.collapsibleState === vscode.TreeItemCollapsibleState.None) {
            const children = this.state.rootItem.children;
            if (children && children.length > 0) {
                this.state.rootItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            }
        }

        return [this.state.rootItem];
    }

    /**
     * Dispose of the service
     */
    public dispose(): void {
        if (this.state.isActive) {
            this.resetCustomRoot();
        }
        this.clearExpansionState();
    }
}
