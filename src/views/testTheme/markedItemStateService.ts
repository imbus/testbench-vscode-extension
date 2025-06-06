/**
 * @file src/views/testTheme/markedItemStateService.ts
 * @description Service to manage the state of marked items in the Test Theme Tree.
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../../testBenchLogger";
import { StorageKeys } from "../../constants";

export interface MarkedItemInfo {
    key: string;
    projectKey: string;
    cycleKey: string;
    originalContextValue: string;
    isDirectlyGenerated: boolean;
    uniqueID: string;
}

export interface GeneratedItemHierarchy {
    rootKey: string;
    rootUID: string;
    projectKey: string;
    cycleKey: string;
    markedSubItemUIDs: Set<string>;
    markedSubItemsWithUID: Map<string, string>;
    // Map<subItemKey, subItemUID>
}

export class MarkedItemStateService {
    private currentMarkedItemInfo: MarkedItemInfo | null = null;
    private generatedItemHierarchies: Map<string, GeneratedItemHierarchy> = new Map(); // Key is rootKey of the hierarchy

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly logger: TestBenchLogger
    ) {}

    /**
     * Initializes the service by loading marked items and hierarchies from workspace storage.
     * Should be called once when the service is ready.
     */
    public async initialize(): Promise<void> {
        try {
            const storedMarkedItem = this.context.workspaceState.get<MarkedItemInfo>(
                StorageKeys.MARKED_TEST_GENERATION_ITEM
            );
            if (storedMarkedItem) {
                if (
                    storedMarkedItem.key &&
                    storedMarkedItem.originalContextValue &&
                    storedMarkedItem.uniqueID !== undefined &&
                    storedMarkedItem.projectKey &&
                    storedMarkedItem.cycleKey
                ) {
                    this.currentMarkedItemInfo = {
                        key: storedMarkedItem.key,
                        projectKey: storedMarkedItem.projectKey,
                        cycleKey: storedMarkedItem.cycleKey,
                        originalContextValue: storedMarkedItem.originalContextValue,
                        isDirectlyGenerated: storedMarkedItem.isDirectlyGenerated ?? true,
                        uniqueID: storedMarkedItem.uniqueID
                    };
                    this.logger.trace(
                        `[MarkedItemStateService] Loaded marked item from workspace state: ${storedMarkedItem.key} (UID: ${storedMarkedItem.uniqueID})`
                    );
                } else {
                    this.logger.warn(
                        "[MarkedItemStateService] Stored marked item is missing required context properties, ignoring."
                    );
                    this.currentMarkedItemInfo = null;
                }
            }

            const storedHierarchies = this.context.workspaceState.get<Array<[string, any]>>(
                `${StorageKeys.MARKED_TEST_GENERATION_ITEM}_hierarchies`
            );
            if (storedHierarchies && Array.isArray(storedHierarchies)) {
                this.generatedItemHierarchies = new Map();
                for (const [key, hierarchyData] of storedHierarchies) {
                    if (
                        hierarchyData.rootKey &&
                        hierarchyData.rootUID &&
                        hierarchyData.markedSubItemUIDs &&
                        hierarchyData.projectKey &&
                        hierarchyData.cycleKey
                    ) {
                        const hierarchy: GeneratedItemHierarchy = {
                            rootKey: hierarchyData.rootKey,
                            rootUID: hierarchyData.rootUID,
                            projectKey: hierarchyData.projectKey,
                            cycleKey: hierarchyData.cycleKey,
                            markedSubItemUIDs: new Set(
                                Array.isArray(hierarchyData.markedSubItemUIDs) ? hierarchyData.markedSubItemUIDs : []
                            ),
                            markedSubItemsWithUID: new Map(
                                Array.isArray(hierarchyData.markedSubItemsWithUID)
                                    ? hierarchyData.markedSubItemsWithUID
                                    : []
                            )
                        };
                        this.generatedItemHierarchies.set(key, hierarchy);
                    }
                }
                this.logger.trace(
                    `[MarkedItemStateService] Loaded ${this.generatedItemHierarchies.size} generated item hierarchies from storage`
                );
            }
        } catch (error) {
            this.logger.error("[MarkedItemStateService] Error loading marked items from storage:", error);
            this.generatedItemHierarchies = new Map();
            this.currentMarkedItemInfo = null;
        }
    }
    private async _saveState(): Promise<void> {
        try {
            await this.context.workspaceState.update(
                StorageKeys.MARKED_TEST_GENERATION_ITEM,
                this.currentMarkedItemInfo
            );
            const hierarchiesForStorage = Array.from(this.generatedItemHierarchies.entries()).map(
                ([key, hierarchy]) => [
                    key,
                    {
                        rootKey: hierarchy.rootKey,
                        rootUID: hierarchy.rootUID,
                        projectKey: hierarchy.projectKey,
                        cycleKey: hierarchy.cycleKey,
                        markedSubItemUIDs: Array.from(hierarchy.markedSubItemUIDs),
                        markedSubItemsWithUID: Array.from(hierarchy.markedSubItemsWithUID.entries())
                    }
                ]
            );
            await this.context.workspaceState.update(
                `${StorageKeys.MARKED_TEST_GENERATION_ITEM}_hierarchies`,
                hierarchiesForStorage
            );
            this.logger.trace("[MarkedItemStateService] Saved marked items to storage successfully");
        } catch (error) {
            this.logger.error("[MarkedItemStateService] Error saving marked items to storage:", error);
        }
    }

    /**
     * Marks an item and its descendants as generated.
     * Clears any previous markings and hierarchies.
     */
    public async markItem(
        itemKey: string,
        itemUID: string,
        projectKey: string,
        cycleKey: string,
        originalContextValue: string,
        isDirectlyGenerated: boolean, // True for the root of generation
        descendantUIDs: string[],
        descendantKeysWithUIDs: Array<[string, string]> // Array of [key, UID]
    ): Promise<void> {
        this.logger.info(
            `[MarkedItemStateService] Marking item ${itemKey} (UID: ${itemUID}) for project ${projectKey}, cycle ${cycleKey}.`
        );
        // Clear previous state
        this.currentMarkedItemInfo = null;
        this.generatedItemHierarchies.clear();
        this.currentMarkedItemInfo = {
            key: itemKey,
            projectKey,
            cycleKey,
            originalContextValue,
            isDirectlyGenerated,
            uniqueID: itemUID
        };
        // Create and store hierarchy for this newly marked root item
        const newHierarchy: GeneratedItemHierarchy = {
            rootKey: itemKey,
            rootUID: itemUID,
            projectKey,
            cycleKey,
            markedSubItemUIDs: new Set(descendantUIDs),
            markedSubItemsWithUID: new Map(descendantKeysWithUIDs)
        };
        this.generatedItemHierarchies.set(itemKey, newHierarchy);

        await this._saveState();
    }

    /**
     * Clears the marking state for a specific item and its associated hierarchy.
     * If no itemKey is provided, clears all markings.
     */
    public async clearMarking(itemKeyToClear?: string): Promise<void> {
        if (itemKeyToClear) {
            if (this.currentMarkedItemInfo && this.currentMarkedItemInfo.key === itemKeyToClear) {
                this.currentMarkedItemInfo = null;
            }
            this.generatedItemHierarchies.delete(itemKeyToClear);
            this.logger.info(
                `[MarkedItemStateService] Cleared marking for item hierarchy rooted by key: ${itemKeyToClear}.`
            );
        } else {
            this.currentMarkedItemInfo = null;
            this.generatedItemHierarchies.clear();
            this.logger.info("[MarkedItemStateService] Cleared all marked item states and hierarchies.");
        }
        await this._saveState();
    }

    /**
     * Checks if an item should display an import button.
     * Based on original `shouldTreeItemDisplayImportButton` logic
     */
    public getItemImportState(
        itemKey: string,
        itemUID: string | undefined,
        projectKey: string | null,
        cycleKey: string | null
    ): {
        shouldShow: boolean;
        rootUID?: string;
    } {
        if (
            this.currentMarkedItemInfo &&
            this.currentMarkedItemInfo.projectKey === projectKey &&
            this.currentMarkedItemInfo.cycleKey === cycleKey &&
            this.currentMarkedItemInfo.key === itemKey &&
            this.currentMarkedItemInfo.uniqueID === itemUID
        ) {
            return { shouldShow: true, rootUID: itemUID };
        }

        if (itemUID) {
            for (const hierarchy of this.generatedItemHierarchies.values()) {
                if (
                    hierarchy.projectKey === projectKey &&
                    hierarchy.cycleKey === cycleKey &&
                    hierarchy.markedSubItemUIDs &&
                    hierarchy.markedSubItemUIDs.has(itemUID)
                ) {
                    return { shouldShow: true, rootUID: itemUID };
                }
            }
        }
        return { shouldShow: false };
    }

    /**
     * Determines the report root UID for an item, essential for report operations.
     * Based on original `getReportRootUIDForItem` logic
     */
    public getReportRootUID(
        itemKey: string,
        itemUID: string | undefined,
        projectKey: string | null,
        cycleKey: string | null
    ): string | undefined {
        if (!itemKey || !itemUID) {
            this.logger.trace(
                `[MarkedItemStateService] getReportRootUID: Item key or UID is missing for item with key ${itemKey}.`
            );
            return undefined;
        }

        const importState = this.getItemImportState(itemKey, itemUID, projectKey, cycleKey);
        if (importState.shouldShow && importState.rootUID) {
            // If it's eligible for import, its own UID is the relevant root for that specific import.
            this.logger.trace(
                `[MarkedItemStateService] getReportRootUID: Using item's own UID for targeted import: ${itemUID} (key: ${itemKey})`
            );
            return importState.rootUID;
        }

        if (
            this.currentMarkedItemInfo &&
            this.currentMarkedItemInfo.projectKey === projectKey &&
            this.currentMarkedItemInfo.cycleKey === cycleKey &&
            this.currentMarkedItemInfo.key === itemKey &&
            this.currentMarkedItemInfo.uniqueID === itemUID &&
            this.currentMarkedItemInfo.isDirectlyGenerated
        ) {
            this.logger.trace(
                `[MarkedItemStateService] getReportRootUID: Using directly generated item's UID: ${itemUID} (key: ${itemKey})`
            );
            return itemUID;
        }

        this.logger.trace(
            `[MarkedItemStateService] getReportRootUID: No specific report root UID found for item key ${itemKey}, UID ${itemUID}.`
        );
        return undefined;
    }

    public getActiveMarkedItemInfo(): MarkedItemInfo | null {
        return this.currentMarkedItemInfo;
    }
}
