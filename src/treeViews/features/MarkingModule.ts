/**
 * @file src/treeViews/features/MarkingModule.ts
 * @description Module for managing marking state of tree items.
 */

import { TreeViewModule } from "../core/TreeViewModule";
import { TreeViewContext } from "../core/TreeViewContext";
import { TreeItemBase } from "../core/TreeItemBase";
import { MarkingState, MarkingInfo, MarkingHierarchy } from "../state/StateTypes";
import { TreeViewEventTypes } from "../utils/EventBus";

export interface MarkingContext {
    projectKey?: string | null;
    tovKey?: string | null;
    cycleKey?: string | null;
    contextId?: string | null;
    contextType?: "cycle" | "tov" | "unknown";
}

interface ResolvedMarkingContext {
    projectKey: string;
    cycleKey: string;
    contextType: "cycle" | "tov" | "unknown";
    tovKey?: string;
    contextId?: string;
}

export class MarkingModule implements TreeViewModule {
    readonly id = "marking";

    private context!: TreeViewContext;
    private markingState: MarkingState;
    private contextResolver?: () => MarkingContext;
    constructor() {
        this.markingState = {
            markedItems: new Map(),
            hierarchies: new Map()
        };
    }

    /**
     * Registers a resolver used to determine the active tree view context when applying markings.
     * @param resolver Function returning the current marking context information.
     */
    public setContextResolver(resolver: () => MarkingContext): void {
        this.contextResolver = resolver;
    }

    private resolveCurrentContext(): MarkingContext {
        try {
            return this.contextResolver ? this.contextResolver() : {};
        } catch {
            return {};
        }
    }

    /**
     * Normalizes the marking context details.
     * @param contextDetails The marking context details to normalize.
     * @returns Normalized marking context.
     */
    private normalizeContext(contextDetails: MarkingContext): ResolvedMarkingContext {
        const contextType =
            contextDetails.contextType ??
            (contextDetails.cycleKey ? "cycle" : contextDetails.tovKey ? "tov" : "unknown");

        const projectKey = contextDetails.projectKey ?? "";
        const primaryKey =
            contextType === "cycle"
                ? (contextDetails.cycleKey ?? "")
                : (contextDetails.tovKey ?? contextDetails.cycleKey ?? "");

        const normalizedContext: ResolvedMarkingContext = {
            projectKey,
            cycleKey: primaryKey,
            contextType
        };

        if (contextDetails.tovKey && contextDetails.tovKey !== "") {
            normalizedContext.tovKey = contextDetails.tovKey;
        } else if (contextType === "tov" && primaryKey) {
            normalizedContext.tovKey = primaryKey;
        }

        if (typeof contextDetails.contextId === "string" && contextDetails.contextId.trim() !== "") {
            normalizedContext.contextId = contextDetails.contextId.trim();
        }

        return normalizedContext;
    }

    private doesMarkingMatchCurrentContext(markingInfo: MarkingInfo): boolean {
        const currentContext = this.resolveCurrentContext();

        if (!currentContext || Object.keys(currentContext).length === 0) {
            return true;
        }

        if (markingInfo.contextId && currentContext.contextId && markingInfo.contextId !== currentContext.contextId) {
            return false;
        }

        if (
            markingInfo.projectKey &&
            currentContext.projectKey &&
            markingInfo.projectKey !== currentContext.projectKey
        ) {
            return false;
        }

        const expectedType = markingInfo.contextType ?? (markingInfo.cycleKey ? "cycle" : "unknown");

        if (expectedType === "cycle") {
            if (markingInfo.cycleKey && currentContext.cycleKey && markingInfo.cycleKey !== currentContext.cycleKey) {
                return false;
            }
            if (markingInfo.tovKey && currentContext.tovKey && markingInfo.tovKey !== currentContext.tovKey) {
                return false;
            }
        } else if (expectedType === "tov") {
            const infoTovKey = markingInfo.tovKey ?? markingInfo.cycleKey;
            if (infoTovKey && currentContext.tovKey && infoTovKey !== currentContext.tovKey) {
                return false;
            }
        } else {
            if (markingInfo.cycleKey && currentContext.cycleKey && markingInfo.cycleKey !== currentContext.cycleKey) {
                return false;
            }
        }

        return true;
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
            if (event.data?.marking) {
                this.markingState = event.data.marking || this.createEmptyState();
            }
        });

        this.context.logger.trace(context.buildLogPrefix("MarkingModule", "Marking module initialized."));
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
    public markItem(item: TreeItemBase, contextDetails: MarkingContext = {}, type: string = "default"): void {
        const markingConfig = this.context.config.modules.marking;
        if (!markingConfig?.enabled) {
            this.context.logger.warn(this.context.buildLogPrefix("MarkingModule", "Marking is not enabled"));
            return;
        }

        if (!item.id) {
            this.context.logger.warn(
                this.context.buildLogPrefix(
                    "MarkingModule",
                    `Item ID does not exist for ${item.label}. Cannot mark item`
                )
            );
            return;
        }

        const canBeMarked: boolean =
            markingConfig.markingContextValues &&
            markingConfig.markingContextValues.includes(item.originalContextValue);
        if (!canBeMarked) {
            this.context.logger.debug(
                this.context.buildLogPrefix("MarkingModule", `Item type ${item.originalContextValue} cannot be marked`)
            );
            return;
        }

        const normalizedContext = this.normalizeContext(contextDetails);

        const markingInfo: MarkingInfo = {
            itemId: item.id,
            projectKey: normalizedContext.projectKey,
            cycleKey: normalizedContext.cycleKey,
            timestamp: Date.now(),
            type,
            tovKey: normalizedContext.tovKey,
            contextId: normalizedContext.contextId,
            contextType: normalizedContext.contextType,
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
        this.context.logger.trace(this.context.buildLogPrefix("MarkingModule", `Marked item: ${item.label}`));
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
        contextDetails: MarkingContext = {},
        type: string = "default"
    ): void {
        if (!item.id) {
            this.context.logger.warn(
                this.context.buildLogPrefix(
                    "MarkingModule",
                    `Item ID does not exist for ${item.label}. Cannot mark item and its descendants`
                )
            );
            return;
        }

        this.markItem(item, contextDetails, type);
        const descendants = item.getDescendants();
        const validDescendants = descendants.filter((desc) => desc.id !== undefined);
        const descendantIds = validDescendants.map((desc) => desc.id!);

        const markHierarchy: MarkingHierarchy = {
            rootId: item.id,
            descendantIds: new Set(descendantIds)
        };
        this.markingState.hierarchies.set(item.id, markHierarchy);

        validDescendants.forEach((descendant) => {
            this.markItem(descendant, contextDetails, type);
        });
        this.updateState();
        this.context.logger.trace(
            this.context.buildLogPrefix(
                "MarkingModule",
                `Marked item ${item.label} and ${validDescendants.length} descendants`
            )
        );
        this.context.refresh({ immediate: true, skipDataReload: true });
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
        this.context.logger.trace(this.context.buildLogPrefix("MarkingModule", `Unmarked item: ${itemId}`));
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
     * Gets hierarchy information for a root item
     * @param rootId The ID of the root item
     * @returns Hierarchy information or undefined if not found
     */
    public getHierarchy(rootId: string): MarkingHierarchy | undefined {
        return this.markingState.hierarchies.get(rootId);
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
        this.context.refresh({ skipDataReload: true });
        this.context.logger.trace(this.context.buildLogPrefix("MarkingModule", "Cleared all markings"));

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
            if (!this.doesMarkingMatchCurrentContext(markingInfo)) {
                item.setMetadata("marked", false);
                item.setMetadata("markingInfo", undefined);
                if (typeof (item as any).updateContextValue === "function") {
                    (item as any).updateContextValue();
                }
                return;
            }

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
        this.context.refresh({ immediate: true, skipDataReload: true });
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
        if (this.context.config.modules.marking?.persistMarks) {
            this.context.stateManager.setState({ marking: this.markingState });
        } else {
            this.clearAllMarkings(false);
        }
    }
}
