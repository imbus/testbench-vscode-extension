/**
 * @file src/treeViews/features/persistence/PersistenceModule.ts
 * @description Module for managing persistence of tree view state.
 */

import { TreeViewModule } from "../../core/TreeViewModule";
import { TreeViewContext } from "../../core/TreeViewContext";
import { TreeViewState } from "../../state/StateTypes";
import { TreeViewTiming } from "../../../constants";

export class PersistenceModule implements TreeViewModule {
    readonly id = "persistence";

    private context!: TreeViewContext;
    private saveTimeout: NodeJS.Timeout | null = null;
    private readonly STORAGE_KEY_PREFIX = "treeView.state.";
    private readonly STORAGE_VERSION = 1;

    /**
     * Initializes the persistence module
     * @param context The tree view context
     */
    async initialize(context: TreeViewContext): Promise<void> {
        this.context = context;

        const persistenceConfig = context.config.modules.persistence;
        if (!persistenceConfig) {
            return;
        }

        // Listen for state changes
        context.eventBus.on("state:changed", () => {
            this.scheduleSave();
        });

        // Load initial state
        const loadedState = await this.load();
        if (loadedState) {
            context.stateManager.setState(loadedState);
        }

        context.logger.debug("PersistenceModule initialized");
    }

    /**
     * Schedules a save operation with debouncing
     */
    private scheduleSave(): void {
        const config = this.context.config.modules.persistence;
        if (!config?.autoSave) {
            return;
        }

        // Clear existing timeout
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }

        // Schedule new save
        this.saveTimeout = setTimeout(() => {
            this.save();
        }, config.saveDebounce || TreeViewTiming.DEFAULT_SAVE_DEBOUNCE_MS);
    }

    /**
     * Saves the current state to storage
     */
    public async save(): Promise<void> {
        const config = this.context.config.modules.persistence;
        if (!config || config.strategy === "none") {
            return;
        }

        try {
            const state = this.context.stateManager.getState();
            const dataToSave = this.prepareDataForSave(state);

            if (config.strategy === "workspace") {
                await this.saveToWorkspace(dataToSave);
            } else if (config.strategy === "global") {
                await this.saveToGlobal(dataToSave);
            }

            this.context.logger.debug("State saved successfully");
        } catch (error) {
            this.context.errorHandler.handleVoid(error as Error, "Failed to save state");
        }
    }

    /**
     * Loads state from storage
     * @returns The loaded state or null if not found
     */
    public async load(): Promise<Partial<TreeViewState> | null> {
        const persistenceConfig = this.context.config.modules.persistence;
        if (!persistenceConfig || persistenceConfig.strategy === "none") {
            return null;
        }

        try {
            let data: any;

            if (persistenceConfig.strategy === "workspace") {
                data = await this.loadFromWorkspace();
            } else if (persistenceConfig.strategy === "global") {
                data = await this.loadFromGlobal();
            }

            return this.parseLoadedData(data);
        } catch (error) {
            this.context.errorHandler.handleVoid(error as Error, "Failed to load state");
            return null;
        }
    }

    /**
     * Prepares state data for saving
     * @param state The current tree view state
     * @returns The prepared data object
     */
    private prepareDataForSave(state: TreeViewState): any {
        const persistenceConfig = this.context.config.modules.persistence!;
        const dataToSave: any = {
            version: this.STORAGE_VERSION,
            timestamp: Date.now(),
            lastRefresh: state.lastRefresh
        };

        if (persistenceConfig.includeCustomRoot && state.customRoot) {
            dataToSave.customRoot = state.customRoot;
        }

        if (persistenceConfig.includeExpansion && state.expansion) {
            dataToSave.expansion = {
                expandedItems: Array.from(state.expansion.expandedItems),
                collapsedItems: Array.from(state.expansion.collapsedItems),
                defaultExpanded: state.expansion.defaultExpanded
            };
        }

        if (persistenceConfig.includeMarking && state.marking) {
            dataToSave.marking = {
                markedItems: Array.from(state.marking.markedItems.entries()),
                hierarchies: Array.from(state.marking.hierarchies.entries()).map(([key, h]) => [
                    key,
                    {
                        rootId: h.rootId,
                        descendantIds: Array.from(h.descendantIds)
                    }
                ])
            };
        }

        // Save selection state
        dataToSave.selectedItemId = state.selectedItemId;
        dataToSave.selectedProjectKey = state.selectedProjectKey;
        dataToSave.selectedCycleKey = state.selectedCycleKey;
        dataToSave.selectedTovKey = state.selectedTovKey;

        // Save metadata
        dataToSave.metadata = state.metadata;

        return dataToSave;
    }

    /**
     * Parses loaded data into state object
     * @param data The raw loaded data
     * @returns The parsed state or null if invalid
     */
    private parseLoadedData(data: any): Partial<TreeViewState> | null {
        if (!data) {
            return null;
        }

        // Check version compatibility
        if (data.version && data.version !== this.STORAGE_VERSION) {
            this.context.logger.warn(`Storage version mismatch: expected ${this.STORAGE_VERSION}, got ${data.version}`);
        }

        const state: Partial<TreeViewState> = {};

        // Restore basic state
        if (data.lastRefresh) {
            state.lastRefresh = data.lastRefresh;
        }

        // Restore custom root
        if (data.customRoot) {
            state.customRoot = data.customRoot;
        }

        // Restore expansion state
        if (data.expansion) {
            const expansionConfig = this.context.config.modules.expansion;
            state.expansion = {
                expandedItems: new Set(data.expansion.expandedItems || []),
                collapsedItems: new Set(data.expansion.collapsedItems || []),
                defaultExpanded: data.expansion.defaultExpanded ?? expansionConfig?.defaultExpanded ?? false
            };
        }

        // Restore marking state
        if (data.marking) {
            state.marking = {
                markedItems: new Map(data.marking.markedItems || []),
                hierarchies: new Map(
                    (data.marking.hierarchies || []).map(([key, h]: [string, any]) => [
                        key,
                        {
                            rootId: h.rootId,
                            descendantIds: new Set(h.descendantIds || [])
                        }
                    ])
                )
            };
        }

        // Restore selection state
        if (data.selectedItemId !== undefined) {
            state.selectedItemId = data.selectedItemId;
        }
        if (data.selectedProjectKey !== undefined) {
            state.selectedProjectKey = data.selectedProjectKey;
        }
        if (data.selectedCycleKey !== undefined) {
            state.selectedCycleKey = data.selectedCycleKey;
        }
        if (data.selectedTovKey !== undefined) {
            state.selectedTovKey = data.selectedTovKey;
        }

        // Restore metadata
        if (data.metadata) {
            state.metadata = data.metadata;
        }

        return state;
    }

    /**
     * Saves data to workspace storage
     * @param data The data to save
     */
    private async saveToWorkspace(data: any): Promise<void> {
        const storageKeyToUse = `${this.STORAGE_KEY_PREFIX}${this.context.config.id}`;
        await this.context.extensionContext.workspaceState.update(storageKeyToUse, data);
    }

    /**
     * Saves data to global storage
     * @param data The data to save
     */
    private async saveToGlobal(data: any): Promise<void> {
        const storageKeyToUse = `${this.STORAGE_KEY_PREFIX}${this.context.config.id}`;
        await this.context.extensionContext.globalState.update(storageKeyToUse, data);
    }

    /**
     * Loads data from workspace storage
     * @returns The loaded data
     */
    private async loadFromWorkspace(): Promise<any> {
        const storageKeyToUse = `${this.STORAGE_KEY_PREFIX}${this.context.config.id}`;
        return this.context.extensionContext.workspaceState.get(storageKeyToUse);
    }

    /**
     * Loads data from global storage
     * @returns The loaded data
     */
    private async loadFromGlobal(): Promise<any> {
        const storageKeyToUse = `${this.STORAGE_KEY_PREFIX}${this.context.config.id}`;
        return this.context.extensionContext.globalState.get(storageKeyToUse);
    }

    /**
     * Clears all persisted data
     */
    public async clear(): Promise<void> {
        const persistenceConfig = this.context.config.modules.persistence;
        if (!persistenceConfig) {
            return;
        }

        const storageKeyToUse = `${this.STORAGE_KEY_PREFIX}${this.context.config.id}`;

        try {
            if (persistenceConfig.strategy === "workspace") {
                await this.context.extensionContext.workspaceState.update(storageKeyToUse, undefined);
            } else if (persistenceConfig.strategy === "global") {
                await this.context.extensionContext.globalState.update(storageKeyToUse, undefined);
            }

            this.context.logger.debug("Persistence cleared");
        } catch (error) {
            this.context.errorHandler.handleVoid(error as Error, "Failed to clear persistence");
        }
    }

    /**
     * Handles configuration changes
     * @param config The new configuration
     */
    async onConfigChange(config: any): Promise<void> {
        const persistenceConfig = config.modules?.persistence;
        if (persistenceConfig) {
            // If auto-save was disabled, cancel any pending saves
            if (!persistenceConfig.autoSave && this.saveTimeout) {
                clearTimeout(this.saveTimeout);
                this.saveTimeout = null;
            }

            // Strategy changed
            const oldPersistenceConfig = this.context.config.modules.persistence;
            if (oldPersistenceConfig && persistenceConfig.strategy !== oldPersistenceConfig.strategy) {
                this.context.logger.info(
                    `Persistence strategy changed from ${oldPersistenceConfig.strategy} to ${persistenceConfig.strategy}`
                );
                // Migration logic can be implemented here
            }
        }
    }

    /**
     * Disposes the persistence module and saves any pending data
     */
    dispose(): void {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.save();
        }
    }
}
