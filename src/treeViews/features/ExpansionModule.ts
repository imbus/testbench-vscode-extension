/**
 * @file src/treeViews/features/ExpansionModule.ts
 * @description Module for managing expansion state.
 */

import { TreeViewModule } from "../core/TreeViewModule";
import { TreeViewContext } from "../core/TreeViewContext";
import { TreeItemBase } from "../core/TreeItemBase";
import { ExpansionState } from "../state/StateTypes";
import * as vscode from "vscode";

export class ExpansionModule implements TreeViewModule {
    readonly id = "expansion";

    private context!: TreeViewContext;
    private expandedItems: Set<string> = new Set();
    private collapsedItems: Set<string> = new Set();
    private defaultExpanded: boolean = false;
    private expansionDebounceTimer: NodeJS.Timeout | null = null;
    private readonly SAVE_DEBOUNCE_DELAY = 100;

    /**
     * Initializes the expansion module
     * @param context The tree view context
     */
    async initialize(context: TreeViewContext): Promise<void> {
        this.context = context;

        const expansionConfig = context.config.modules.expansion;
        if (expansionConfig) {
            this.defaultExpanded = expansionConfig.defaultExpanded || false;
        }

        const state = context.stateManager.getState();
        if (state.expansion) {
            this.expandedItems = new Set(state.expansion.expandedItems);
            this.collapsedItems = new Set(state.expansion.collapsedItems);
            this.defaultExpanded = state.expansion.defaultExpanded ?? this.defaultExpanded;
        }

        context.eventBus.on("tree:itemExpanded", (event) => {
            const item = event.data.item;
            if (item && item.id) {
                this.trackExpansion(item.id, true);
            }
        });

        context.eventBus.on("tree:itemCollapsed", (event) => {
            const item = event.data.item;
            if (item && item.id) {
                this.trackExpansion(item.id, false);
            }
        });

        context.eventBus.on("state:changed", (event) => {
            if (event.data?.expansion) {
                this.expandedItems = new Set(event.data.expansion.expandedItems);
                this.collapsedItems = new Set(event.data.expansion.collapsedItems);
                this.defaultExpanded = event.data.expansion.defaultExpanded ?? this.defaultExpanded;
            }
        });

        context.logger.debug("[ExpansionModule] Expansion module initialized");
    }

    /**
     * Tracks the expansion state of an item with immediate persistence
     * @param itemId The ID of the item
     * @param isExpanded Whether the item is expanded
     */
    public trackExpansion(itemId: string, isExpanded: boolean): void {
        if (isExpanded) {
            this.expandedItems.add(itemId);
            this.collapsedItems.delete(itemId);
        } else {
            this.expandedItems.delete(itemId);
            this.collapsedItems.add(itemId);
        }

        this.saveStateDebounced();
    }

    /**
     * Saves the expansion state with debounce to avoid too frequent saves
     */
    private saveStateDebounced(): void {
        if (this.expansionDebounceTimer) {
            clearTimeout(this.expansionDebounceTimer);
        }

        this.expansionDebounceTimer = setTimeout(() => {
            this.saveState();
        }, this.SAVE_DEBOUNCE_DELAY);
    }

    /**
     * Saves the current expansion state immediately
     */
    private saveState(): void {
        const expansionState: ExpansionState = {
            expandedItems: this.expandedItems,
            collapsedItems: this.collapsedItems,
            defaultExpanded: this.defaultExpanded
        };

        this.context.stateManager.setState({ expansion: expansionState });

        this.context.logger.debug(
            `[ExpansionModule] Saving expansion state: ${this.expandedItems.size} expanded, ${this.collapsedItems.size} collapsed`
        );

        this.context.eventBus.emit({
            type: "state:changed",
            source: this.id,
            data: { expansion: expansionState },
            timestamp: Date.now()
        });
    }

    /**
     * Applies the expansion state to a tree item
     * @param item The tree item to apply state to
     */
    public applyExpansionState(item: TreeItemBase): void {
        if (!item.id || item.collapsibleState === vscode.TreeItemCollapsibleState.None) {
            return;
        }

        if (this.expandedItems.has(item.id)) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        } else if (this.collapsedItems.has(item.id)) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        } else if (this.defaultExpanded) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }
    }

    /**
     * Gets the expansion state for a specific item
     * @param itemId The ID of the item
     * @returns The expansion state or undefined
     */
    public getExpansionState(itemId: string): vscode.TreeItemCollapsibleState | undefined {
        if (this.expandedItems.has(itemId)) {
            return vscode.TreeItemCollapsibleState.Expanded;
        } else if (this.collapsedItems.has(itemId)) {
            return vscode.TreeItemCollapsibleState.Collapsed;
        }
        return undefined;
    }

    /**
     * Checks if an item is expanded
     * @param itemId The ID of the item
     * @returns True if expanded, false otherwise
     */
    public isExpanded(itemId: string): boolean {
        return this.expandedItems.has(itemId);
    }

    /**
     * Expands all items
     */
    public expandAll(): void {
        this.collapsedItems.forEach((itemId) => {
            this.expandedItems.add(itemId);
        });
        this.collapsedItems.clear();
        this.saveState();
    }

    /**
     * Collapses all items
     */
    public collapseAll(): void {
        this.expandedItems.forEach((itemId) => {
            this.collapsedItems.add(itemId);
        });
        this.expandedItems.clear();
        this.saveState();
    }

    /**
     * Resets the expansion state
     */
    public reset(): void {
        this.expandedItems.clear();
        this.collapsedItems.clear();
        this.saveState();
    }

    /**
     * Forces an immediate save of the expansion state
     */
    public forceSave(): void {
        if (this.expansionDebounceTimer) {
            clearTimeout(this.expansionDebounceTimer);
            this.expansionDebounceTimer = null;
        }
        this.saveState();
    }

    /**
     * Disposes of the module
     */
    public dispose(): void {
        this.forceSave();

        if (this.expansionDebounceTimer) {
            clearTimeout(this.expansionDebounceTimer);
        }
    }
}
