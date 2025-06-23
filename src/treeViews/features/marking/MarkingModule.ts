/**
 * @file src/treeViews/features/marking/MarkingModule.ts
 * @description Module for managing marking state of tree items.
 */

import { TreeViewModule } from "../../core/TreeViewModule";
import { TreeViewContext } from "../../core/TreeViewContext";
import { TreeItemBase } from "../../core/TreeItemBase";
import { MarkingState, MarkingInfo, MarkingHierarchy } from "../../state/StateTypes";
import { TreeViewEventTypes } from "../../utils/EventBus";

export class MarkingModule implements TreeViewModule {
    readonly id = "marking";

    private context!: TreeViewContext;
    private markingState: MarkingState;
    constructor() {
        this.markingState = {
            markedItems: new Map(),
            hierarchies: new Map()
        };
    }

    /**
     * Initializes the marking module with the given context
     * @param context The tree view context to initialize with
     */
    async initialize(context: TreeViewContext): Promise<void> {
        this.context = context;
        const state = context.stateManager.getState();
        if (state.marking) {
            this.markingState = state.marking;
        }

        context.eventBus.on("state:changed", (event) => {
            const changes = event.data.changes;
            const markingChange = changes.find((c: any) => c.field === "marking");
            if (markingChange) {
                this.markingState = markingChange.newValue || this.createEmptyState();
            }
        });

        this.context.logger.debug("MarkingModule initialized");
    }

    /**
     * Creates an empty marking state
     * @returns Empty marking state with empty maps
     */
    private createEmptyState(): MarkingState {
        return {
            markedItems: new Map(),
            hierarchies: new Map()
        };
    }

    /**
     * Marks a single tree item
     * @param item The tree item to mark
     * @param projectKey The project key
     * @param cycleKey The cycle key
     * @param type The marking type (default value is "default")
     */
    public markItem(item: TreeItemBase, projectKey: string, cycleKey: string, type: string = "default"): void {
        const markingConfig = this.context.config.modules.marking;
        if (!markingConfig?.enabled) {
            this.context.logger.warn("Marking is not enabled");
            return;
        }

        if (!item.id) {
            this.context.logger.warn(`Cannot mark item without ID: ${item.label}`);
            return;
        }

        const canBeMarked: boolean =
            markingConfig.markingContextValues &&
            markingConfig.markingContextValues.includes(item.originalContextValue);
        if (!canBeMarked) {
            this.context.logger.warn(`Item type ${item.originalContextValue} cannot be marked`);
            return;
        }

        const markingInfo: MarkingInfo = {
            itemId: item.id,
            projectKey,
            cycleKey,
            timestamp: Date.now(),
            type,
            metadata: {
                label: item.label as string,
                contextValue: item.originalContextValue,
                uniqueID: (item as any).data?.base?.uniqueID || undefined
            }
        };
        this.markingState.markedItems.set(item.id, markingInfo);
        this.updateState();

        item.setMetadata("marked", true);
        item.setMetadata("markingInfo", markingInfo);

        this.context.eventBus.emit({
            type: "item:marked",
            source: this.context.config.id,
            data: {
                item,
                marked: true,
                markingInfo
            },
            timestamp: Date.now()
        });
        this.context.logger.info(`Marked item: ${item.label}`);
    }

    /**
     * Marks a tree item and all its descendants
     * @param item The root tree item to mark
     * @param projectKey The project key
     * @param cycleKey The cycle key
     * @param type The marking type (default value is "default")
     */
    public markItemWithDescendants(
        item: TreeItemBase,
        projectKey: string,
        cycleKey: string,
        type: string = "default"
    ): void {
        if (!item.id) {
            this.context.logger.warn(`Cannot mark item without ID: ${item.label}`);
            return;
        }

        this.markItem(item, projectKey, cycleKey, type);
        const descendants = item.getDescendants();
        const validDescendants = descendants.filter((desc) => desc.id !== undefined);
        const descendantIds = validDescendants.map((desc) => desc.id!);
        const skippedCount: number = descendants.length - validDescendants.length;
        if (skippedCount > 0) {
            this.context.logger.warn(
                `Skipped ${skippedCount} descendants without IDs while marking item with descendants`
            );
        }

        const markHierarchy: MarkingHierarchy = {
            rootId: item.id,
            descendantIds: new Set(descendantIds)
        };
        this.markingState.hierarchies.set(item.id, markHierarchy);

        validDescendants.forEach((descendant) => {
            this.markItem(descendant, projectKey, cycleKey, type);
        });
        this.updateState();
        this.context.logger.info(`Marked item and ${validDescendants.length} descendants: ${item.label}`);
        this.context.refresh({ immediate: true });
    }

    /**
     * Unmarks a tree item by its ID
     * @param itemId The ID of the item to unmark
     */
    public unmarkItemByID(itemId: string): void {
        const markingInfo = this.markingState.markedItems.get(itemId);
        if (!markingInfo) {
            return;
        }

        this.markingState.markedItems.delete(itemId);

        // Remove hierarchy if this was a root
        const markHierarchy = this.markingState.hierarchies.get(itemId);
        if (markHierarchy) {
            markHierarchy.descendantIds.forEach((descendantId) => {
                this.markingState.markedItems.delete(descendantId);
            });
            this.markingState.hierarchies.delete(itemId);
        }

        this.updateState();
        this.context.logger.info(`Unmarked item: ${itemId}`);
    }

    /**
     * Checks if an item is marked
     * @param itemId The ID of the item to check
     * @returns True if the item is marked, false otherwise
     */
    public isMarked(itemId: string): boolean {
        return this.markingState.markedItems.has(itemId);
    }

    /**
     * Gets marking information for an item
     * @param itemId The ID of the item
     * @returns Marking information or undefined if not marked
     */
    public getMarkingInfo(itemId: string): MarkingInfo | undefined {
        return this.markingState.markedItems.get(itemId);
    }

    /**
     * Gets all marked items
     * @returns Map of all marked items
     */
    public getMarkedItems(): Map<string, MarkingInfo> {
        return new Map(this.markingState.markedItems);
    }

    /**
     * Gets marked items filtered by type
     * @param type The marking type to filter by
     * @returns Array of marking information for items of the specified type
     */
    public getMarkedItemsByType(type: string): MarkingInfo[] {
        const items: MarkingInfo[] = [];
        this.markingState.markedItems.forEach((info) => {
            if (info.type === type) {
                items.push(info);
            }
        });
        return items;
    }

    /**
     * Gets hierarchy information for a root item
     * @param rootId The ID of the root item
     * @returns Hierarchy information or undefined if not found
     */
    public getHierarchy(rootId: string): MarkingHierarchy | undefined {
        return this.markingState.hierarchies.get(rootId);
    }

    /**
     * Checks if an item is marked as a descendant in any hierarchy
     * @param itemId The ID of the item to check
     * @returns True if the item is marked as a descendant, false otherwise
     */
    public isDescendantMarked(itemId: string): boolean {
        // Check if this item is part of any hierarchy as a descendant
        for (const hierarchy of this.markingState.hierarchies.values()) {
            if (hierarchy.descendantIds.has(itemId)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Gets the root ID for a descendant item
     * @param descendantId The ID of the descendant item
     * @returns Root ID or null if not found
     */
    public getRootIDForDescendant(descendantId: string): string | null {
        for (const [rootId, hierarchy] of this.markingState.hierarchies) {
            if (hierarchy.descendantIds.has(descendantId)) {
                return rootId;
            }
        }
        return null;
    }

    /**
     * Clears all markings from the marking state.
     * Emits a global event to notify other tree view instances to clear their markings.
     * @param emitGlobalEvent Whether to emit a global event to notify other tree view instances (default: true)
     */
    public clearAllMarkings(emitGlobalEvent: boolean = true): void {
        this.markingState = this.createEmptyState();
        this.updateState();
        this.context.refresh();
        this.context.logger.info("Cleared all markings");

        if (emitGlobalEvent) {
            this.context.eventBus.emit({
                type: TreeViewEventTypes.MARKING_CLEARED_GLOBAL,
                source: this.context.config.id,
                data: {
                    reason: "testGeneration",
                    timestamp: Date.now()
                },
                timestamp: Date.now()
            });
        }
    }

    /**
     * Clears markings filtered by type
     * @param type The marking type to clear
     */
    public clearMarkingsByType(type: string): void {
        const itemsToRemove: string[] = [];
        this.markingState.markedItems.forEach((info, itemId) => {
            if (info.type === type) {
                itemsToRemove.push(itemId);
            }
        });
        itemsToRemove.forEach((itemId) => this.unmarkItemByID(itemId));
        this.context.logger.info(`Cleared ${itemsToRemove.length} markings of type: ${type}`);
    }

    /**
     * Applies marking state to a tree item when it is created or refreshed
     * by setting metadata. The item itself is responsible for updating its
     * context value based on this metadata.
     * @param item The TreeItemBase to apply marking state to
     */
    public applyMarkingToItem(item: TreeItemBase): void {
        if (!item.id) {
            return;
        }

        const markingInfo = this.markingState.markedItems.get(item.id);
        if (markingInfo) {
            // Check if import marking should be applied based on configuration
            const markingConfig = this.context.config.modules.marking;
            if (markingInfo.type === "import" && markingConfig && !markingConfig.showImportButton) {
                // Don't apply import marking when import button is disabled
                item.setMetadata("marked", false);
                item.setMetadata("markingInfo", undefined);
            } else {
                item.setMetadata("marked", true);
                item.setMetadata("markingInfo", markingInfo);
            }
        } else {
            item.setMetadata("marked", false);
            item.setMetadata("markingInfo", undefined);
        }

        // Allow the item to update its own context value based on the new metadata
        if (typeof (item as any).updateContextValue === "function") {
            (item as any).updateContextValue();
        }
    }

    /**
     * Updates the marking state and refreshes the tree view
     */
    private updateState(): void {
        this.context.stateManager.setState({ marking: this.markingState });
        this.context.refresh({ immediate: true });
    }

    /**
     * Refreshes marking state for all items in the tree
     * This should be called when the tree is rebuilt or when marking state changes
     */
    public refreshMarkingState(): void {
        // The marking state will be applied to items when they are created or refreshed
        this.context.refresh({ immediate: true });
        this.context.logger.debug("Refreshed marking state for all items");
    }

    /**
     * Handles configuration changes for the marking module.
     * Does not emit global event for configuration changes.
     * @param config The new configuration
     */
    async onConfigChange(config: any): Promise<void> {
        const markingConfig = config.modules?.marking;
        if (markingConfig && !markingConfig.enabled) {
            this.clearAllMarkings(false);
        }
    }

    /**
     * Disposes of the marking module
     * Clears all markings if persistence is not enabled.
     * Does not emit global event for disposal.
     */
    dispose(): void {
        if (!this.context.config.modules.marking?.persistMarks) {
            this.clearAllMarkings(false);
        }
    }
}
