/**
 * @file src/treeViews/features/customRoot/CustomRootModule.ts
 * @description Module for managing a custom root in the tree view, allowing users to set a specific item as the root of the tree.
 */

import * as vscode from "vscode";
import { TreeViewModule } from "../../core/TreeViewModule";
import { TreeViewContext } from "../../core/TreeViewContext";
import { TreeItemBase } from "../../core/TreeItemBase";
import { CustomRootState } from "../../state/StateTypes";
import { TreeViewEventTypes } from "../../utils/EventBus";

export class CustomRootModule implements TreeViewModule {
    readonly id = "customRoot";

    private context!: TreeViewContext;
    private customRootState: CustomRootState | null = null;

    /**
     * Initializes the CustomRootModule with the provided context.
     * Sets up state management and event listeners for custom root functionality.
     * @param context The tree view context containing shared resources
     */
    async initialize(context: TreeViewContext): Promise<void> {
        this.context = context;
        const state = context.stateManager.getState();
        this.customRootState = state.customRoot;
        this.registerCommands();

        // Listen for state changes
        context.eventBus.on("state:changed", (event) => {
            const changes = event.data.changes;
            const customRootChange = changes.find((c: any) => c.field === "customRoot");
            if (customRootChange) {
                // Only update if the new value is different from the current state
                if (this.customRootState !== customRootChange.newValue) {
                    this.customRootState = customRootChange.newValue;
                    this.updateContextKey();
                }
            }
        });

        context.logger.debug("CustomRootModule initialized");
    }

    /**
     * Registers commands and sets up initial context key state.
     * Called during module initialization.
     */
    private registerCommands(): void {
        const customRootConfig = this.context.config.modules.customRoot;
        if (!customRootConfig) {
            return;
        }

        // Set initial context key
        this.updateContextKey();
    }

    /**
     * Updates the VS Code context key to reflect the current custom root state.
     * Used to control command visibility and availability.
     */
    private updateContextKey(): void {
        const customRootConfig = this.context.config.modules.customRoot;
        if (customRootConfig) {
            vscode.commands.executeCommand("setContext", customRootConfig.contextKey, this.isActive());
        }
    }

    /**
     * Applies the correct context value to a tree item based on whether it is the active custom root.
     * This method should be called by the TreeView before rendering an item.
     * @param item The TreeItemBase to apply context to.
     */
    public applyCustomRootContext(item: TreeItemBase): void {
        if (this.isActive() && this.customRootState?.rootItemId && item.id === this.customRootState.rootItemId) {
            // This item is the active custom root, so set metadata and let the item handle context value
            item.setMetadata("isCustomRoot", true);
            // Update the context value to reflect the new state
            if (typeof (item as any).updateContextValue === "function") {
                (item as any).updateContextValue();
            }
        } else {
            // This item is not the active root, clear the custom root metadata
            item.setMetadata("isCustomRoot", false);
            // Update the context value to reflect the new state
            if (typeof (item as any).updateContextValue === "function") {
                (item as any).updateContextValue();
            }
        }
    }

    /**
     * Checks if a custom root is currently active
     * @return true if custom root is active, false otherwise
     */
    public isActive(): boolean {
        return this.customRootState?.active ?? false;
    }

    /**
     * Retrieves the current custom root item
     * @return The custom root TreeItemBase or null if not active
     */
    public getCustomRoot(): TreeItemBase | null {
        if (!this.isActive() || !this.customRootState?.rootItemId) {
            return null;
        }

        // Find the item in the tree
        const state = this.context.stateManager.getState();
        const customRootItem = state.items.get(this.customRootState.rootItemId);

        if (!customRootItem) {
            this.reset();
            return null;
        }

        return customRootItem;
    }

    /**
     * Sets a tree item as the custom root
     * @param item The TreeItemBase to set as custom root
     */
    public setCustomRoot(item: TreeItemBase): void {
        const customRootConfig = this.context.config.modules.customRoot;
        if (!customRootConfig?.enabled) {
            this.context.logger.warn("Custom root is not enabled");
            return;
        }

        if (
            customRootConfig.allowedItemTypes &&
            !customRootConfig.allowedItemTypes.includes(item.originalContextValue)
        ) {
            this.context.logger.warn(`Item type ${item.originalContextValue} is not allowed as custom root`);
            return;
        }

        // Check maxDepth if configured
        if (customRootConfig.maxDepth !== undefined) {
            const itemDepth = item.getDepth();
            if (itemDepth > customRootConfig.maxDepth) {
                this.context.logger.warn(
                    `Item depth ${itemDepth} exceeds maximum allowed depth ${customRootConfig.maxDepth}`
                );
                return;
            }
        }

        // Build root path
        const rootPath: string[] = [];
        let currentTreeItem: TreeItemBase | null = item;
        while (currentTreeItem) {
            rootPath.unshift(currentTreeItem.label as string);
            currentTreeItem = currentTreeItem.parent;
        }

        const newCustomRootState: CustomRootState = {
            active: true,
            rootItemId: item.id ?? null, // Convert undefined to null
            rootItemPath: rootPath,
            originalTitle: this.context.config.title,
            contextData: {
                originalContextValue: item.originalContextValue,
                label: item.label as string,
                timestamp: Date.now()
            }
        };

        this.customRootState = newCustomRootState;

        this.context.stateManager.addItem(item);
        // Update the state, which will notify other components.
        this.context.stateManager.setState({ customRoot: newCustomRootState });
        this.updateContextKey();

        // Emit an event to announce the change
        this.context.eventBus.emit({
            type: TreeViewEventTypes.CUSTOM_ROOT_SET,
            source: this.context.config.id,
            data: { item },
            timestamp: Date.now()
        });

        this.context.refresh({ immediate: true });
        this.context.logger.info(`Set custom root: ${item.label}`);
    }

    /**
     * Resets the custom root to its default state
     */
    public reset(): void {
        const config = this.context.config.modules.customRoot;
        if (!config) {
            return;
        }

        this.customRootState = null;
        this.context.stateManager.setState({ customRoot: null });
        this.updateContextKey();

        // Emit an event to announce the change
        this.context.eventBus.emit({
            type: TreeViewEventTypes.CUSTOM_ROOT_RESET,
            source: this.context.config.id,
            data: {},
            timestamp: Date.now()
        });

        this.context.refresh({ immediate: true });
        this.context.logger.info("Custom root reset");
    }

    /**
     * Gets the parent of a tree element in custom root mode
     * @param element The TreeItemBase to find parent for
     * @return Parent TreeItemBase, null if root, or undefined for normal behavior
     */
    public getParent(element: TreeItemBase): TreeItemBase | null | undefined {
        if (!this.isActive() || !this.customRootState) {
            return undefined;
        }

        // If element is the custom root, it has no parent
        if (element.id === this.customRootState.rootItemId) {
            return null;
        }

        // Otherwise use normal parent logic
        return undefined;
    }

    /**
     * Handles configuration changes for the custom root module.
     * If the custom root is disabled, it will be reset.
     * @param config The new configuration object
     */
    async onConfigChange(config: any): Promise<void> {
        const customRootConfig = config.modules?.customRoot;
        if (customRootConfig && !customRootConfig.enabled && this.isActive()) {
            this.reset();
        }
    }

    /**
     * Disposes the custom root module and cleans up resources.
     * If the custom root is active, it will be reset.
     */
    dispose(): void {
        if (this.isActive()) {
            this.reset();
        }
    }
}
