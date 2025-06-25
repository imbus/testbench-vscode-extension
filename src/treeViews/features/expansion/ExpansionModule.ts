/**
 * @file src/treeViews/features/expansion/ExpansionModule.ts
 * @description Module for managing expansion state.
 */

import { TreeViewModule } from "../../core/TreeViewModule";
import { TreeViewContext } from "../../core/TreeViewContext";
import { TreeItemBase } from "../../core/TreeItemBase";
import { ExpansionState } from "../../state/StateTypes";
import * as vscode from "vscode";

export class ExpansionModule implements TreeViewModule {
    readonly id = "expansion";

    private context!: TreeViewContext;
    private expansionState: ExpansionState;

    constructor() {
        this.expansionState = {
            expandedItems: new Set(),
            collapsedItems: new Set(),
            defaultExpanded: false
        };
    }

    /**
     * Initializes the expansion module with context and loads saved state
     * @param context The tree view context containing shared resources
     */
    async initialize(context: TreeViewContext): Promise<void> {
        this.context = context;

        const expansionConfig = context.config.modules.expansion;
        const defaultExpanded = expansionConfig?.defaultExpanded ?? false;

        const state = context.stateManager.getState();
        if (state.expansion) {
            this.expansionState = {
                expandedItems: new Set(state.expansion.expandedItems),
                collapsedItems: new Set(state.expansion.collapsedItems),
                defaultExpanded: state.expansion.defaultExpanded ?? defaultExpanded
            };
        } else {
            // Use default from config
            this.expansionState.defaultExpanded = defaultExpanded;
        }

        // Listen for state changes from other modules
        context.eventBus.on("state:changed", (event) => {
            const changes = event.data.changes;
            const expansionChange = changes.find((c: any) => c.field === "expansion");
            if (expansionChange && expansionChange.newValue) {
                this.expansionState = {
                    expandedItems: new Set(expansionChange.newValue.expandedItems),
                    collapsedItems: new Set(expansionChange.newValue.collapsedItems),
                    defaultExpanded: expansionChange.newValue.defaultExpanded ?? this.expansionState.defaultExpanded
                };
                this.context.logger.debug("Expansion state updated from state manager");

                this.reapplyExpansionStateToAllItems();
            }
        });

        // Listen for direct state manager updates to handle persistence loading
        const currentState = context.stateManager.getState();
        if (currentState.expansion) {
            this.expansionState = {
                expandedItems: new Set(currentState.expansion.expandedItems),
                collapsedItems: new Set(currentState.expansion.collapsedItems),
                defaultExpanded: currentState.expansion.defaultExpanded ?? defaultExpanded
            };
            this.context.logger.debug("Expansion state loaded from current state manager state");
        }

        // Listen for user expansion/collapse actions
        context.eventBus.on("tree:itemExpanded", (event) => {
            const item = event.data.item;
            if (item && item.id) {
                this.context.logger.debug(`Item expanded: ${item.label} (${item.id})`);
                this.setExpanded(item.id, true);
            }
        });

        context.eventBus.on("tree:itemCollapsed", (event) => {
            const item = event.data.item;
            if (item && item.id) {
                this.context.logger.debug(`Item collapsed: ${item.label} (${item.id})`);
                this.setExpanded(item.id, false);
            }
        });

        context.logger.debug("ExpansionModule initialized");
    }

    /**
     * Sets the expansion state for a specific item
     * @param itemId The ID of the item to set expansion for
     * @param expanded Whether the item should be expanded
     */
    public setExpanded(itemId: string, expanded: boolean): void {
        const expansionConfig = this.context.config.modules.expansion;
        if (!expansionConfig?.rememberExpansion) {
            return;
        }

        if (expanded) {
            this.expansionState.expandedItems.add(itemId);
            this.expansionState.collapsedItems.delete(itemId);
        } else {
            this.expansionState.expandedItems.delete(itemId);
            this.expansionState.collapsedItems.add(itemId);
        }

        this.updateState();
    }

    /**
     * Checks if an item is currently expanded
     * @param itemId The ID of the item to check
     * @return true if expanded, false otherwise
     */
    public isExpanded(itemId: string): boolean {
        const expansionConfig = this.context.config.modules.expansion;
        if (!expansionConfig?.rememberExpansion) {
            return this.expansionState.defaultExpanded;
        }

        if (this.expansionState.expandedItems.has(itemId)) {
            return true;
        }
        if (this.expansionState.collapsedItems.has(itemId)) {
            return false;
        }

        return this.expansionState.defaultExpanded;
    }

    /**
     * Applies expansion state to a tree item
     * @param item The tree item to apply expansion state to
     */
    public applyExpansionState(item: TreeItemBase): void {
        const itemId = item.id;
        if (!itemId) {
            return;
        }

        const state = this.context.stateManager.getState();
        if (
            state.expansion &&
            (state.expansion.expandedItems.size !== this.expansionState.expandedItems.size ||
                state.expansion.collapsedItems.size !== this.expansionState.collapsedItems.size)
        ) {
            this.reloadState();
        }

        const shouldExpand = this.isExpanded(itemId);

        if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
            item.collapsibleState = shouldExpand
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed;
        }
    }

    /**
     * Expands all items up to the configured level
     */
    public expandAll(): void {
        const expansionConfig = this.context.config.modules.expansion;
        const expandedLevels = expansionConfig?.expandedLevels ?? Infinity;

        const state = this.context.stateManager.getState();
        state.items.forEach((item, itemId) => {
            const depth = this.getItemDepth(item);
            if (depth < expandedLevels) {
                this.expansionState.expandedItems.add(itemId);
                this.expansionState.collapsedItems.delete(itemId);
            }
        });

        this.updateState();
        this.context.refresh();
    }

    /**
     * Collapses all expanded items
     */
    public collapseAll(): void {
        this.expansionState.expandedItems.forEach((itemId) => {
            this.expansionState.collapsedItems.add(itemId);
        });
        this.expansionState.expandedItems.clear();

        this.updateState();
        this.context.refresh();
    }

    /**
     * Toggles the expansion state of an item
     * @param itemId The ID of the item to toggle
     */
    public toggleExpansion(itemId: string): void {
        const isExpanded = this.isExpanded(itemId);
        this.setExpanded(itemId, !isExpanded);
    }

    /**
     * Sets the default expansion state for new items
     * @param defaultExpanded The default expansion state
     */
    public setDefaultExpanded(defaultExpanded: boolean): void {
        this.expansionState.defaultExpanded = defaultExpanded;
        this.updateState();
    }

    /**
     * Resets expansion state to defaults
     */
    public reset(): void {
        this.expansionState = {
            expandedItems: new Set(),
            collapsedItems: new Set(),
            defaultExpanded: this.context.config.modules.expansion?.defaultExpanded ?? false
        };

        this.updateState();
        this.context.refresh();
    }

    /**
     * Gets the current expansion state
     * @return The current expansion state
     */
    public getState(): ExpansionState {
        return {
            expandedItems: new Set(this.expansionState.expandedItems),
            collapsedItems: new Set(this.expansionState.collapsedItems),
            defaultExpanded: this.expansionState.defaultExpanded
        };
    }

    /**
     * Updates the state manager with current expansion state
     */
    private updateState(): void {
        this.context.stateManager.setState({
            expansion: this.getState()
        });
    }

    /**
     * Calculates the depth of an item in the tree
     * @param item The item to calculate depth for
     * @return The depth of the item
     */
    private getItemDepth(item: any): number {
        let depth = 0;
        let current = item;

        while (current.parent) {
            depth++;
            current = current.parent;
        }

        return depth;
    }

    /**
     * Reloads expansion state from the state manager
     * This is useful when state is loaded after the module is initialized
     */
    public reloadState(): void {
        const state = this.context.stateManager.getState();
        if (state.expansion) {
            const expansionConfig = this.context.config.modules.expansion;
            const defaultExpanded = expansionConfig?.defaultExpanded ?? false;

            this.expansionState = {
                expandedItems: new Set(state.expansion.expandedItems),
                collapsedItems: new Set(state.expansion.collapsedItems),
                defaultExpanded: state.expansion.defaultExpanded ?? defaultExpanded
            };

            this.context.logger.debug("Expansion state reloaded from state manager");
        }
    }

    /**
     * Handles configuration changes for the expansion module
     * @param config The new configuration object
     */
    public async onConfigChange(config: any): Promise<void> {
        const expansionConfig = config.modules?.expansion;
        if (expansionConfig) {
            // Update default expanded state if changed
            if (
                expansionConfig.defaultExpanded !== undefined &&
                expansionConfig.defaultExpanded !== this.expansionState.defaultExpanded
            ) {
                this.expansionState.defaultExpanded = expansionConfig.defaultExpanded;
                this.updateState();
            }

            if (expansionConfig.collapseOnRefresh) {
                this.collapseAll();
            }
        }
    }

    /**
     * Disposes the expansion module and saves final state
     */
    public dispose(): void {
        // Save final state
        this.updateState();
    }

    /**
     * Re-applies expansion state to all existing tree items
     */
    private reapplyExpansionStateToAllItems(): void {
        const state = this.context.stateManager.getState();
        state.items.forEach((item) => {
            this.applyExpansionState(item);
        });
    }
}
