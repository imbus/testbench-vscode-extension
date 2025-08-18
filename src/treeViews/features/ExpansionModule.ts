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
            this.updateExpansionFromState(state.expansion);
            context.logger.debug(
                context.buildLogPrefix(
                    "ExpansionModule",
                    `Initialized with expansion state: ${this.expandedItems.size} expanded, ${this.collapsedItems.size} collapsed items`
                )
            );
        } else {
            context.logger.debug(
                context.buildLogPrefix("ExpansionModule", "No expansion state found during initialization")
            );
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
            const newState = event.data?.newState;
            if (newState?.expansion) {
                this.updateExpansionFromState(newState.expansion);
                context.logger.debug(
                    context.buildLogPrefix(
                        "ExpansionModule",
                        `Updated expansion state from persistence: ${this.expandedItems.size} expanded, ${this.collapsedItems.size} collapsed items`
                    )
                );
            }
        });

        context.logger.debug(context.buildLogPrefix("ExpansionModule", "Expansion module initialized"));
    }

    /**
     * Updates the expansion state from loaded state data
     * @param expansionState The expansion state to apply
     */
    private updateExpansionFromState(expansionState: ExpansionState): void {
        this.expandedItems = new Set(expansionState.expandedItems);
        this.collapsedItems = new Set(expansionState.collapsedItems);
        this.defaultExpanded = expansionState.defaultExpanded ?? this.defaultExpanded;
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
            this.context.buildLogPrefix(
                "ExpansionModule",
                `Saving expansion state: ${this.expandedItems.size} expanded, ${this.collapsedItems.size} collapsed`
            )
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

        const originalState = item.collapsibleState;

        if (this.expandedItems.has(item.id)) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            if (originalState !== vscode.TreeItemCollapsibleState.Expanded) {
                this.context.logger.trace(
                    this.context.buildLogPrefix(
                        "ExpansionModule",
                        `Applied expanded state to item: ${item.label} (${item.id})`
                    )
                );
            }
        } else if (this.collapsedItems.has(item.id)) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            if (originalState !== vscode.TreeItemCollapsibleState.Collapsed) {
                this.context.logger.trace(
                    this.context.buildLogPrefix(
                        "ExpansionModule",
                        `Applied collapsed state to item: ${item.label} (${item.id})`
                    )
                );
            }
        } else if (this.defaultExpanded) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            if (originalState !== vscode.TreeItemCollapsibleState.Expanded) {
                this.context.logger.trace(
                    this.context.buildLogPrefix(
                        "ExpansionModule",
                        `Applied default expanded state to item: ${item.label} (${item.id})`
                    )
                );
            }
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
