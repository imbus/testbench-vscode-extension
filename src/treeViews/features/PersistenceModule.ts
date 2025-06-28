/**
 * @file src/treeViews/features/PersistenceModule.ts
 * @description Module for managing persistence of tree view state
 */

import { TreeViewModule } from "../core/TreeViewModule";
import { TreeViewContext } from "../core/TreeViewContext";
import { TreeViewState } from "../state/StateTypes";
import * as vscode from "vscode";

export class PersistenceModule implements TreeViewModule {
    readonly id = "persistence";

    private context!: TreeViewContext;
    private saveTimeout: NodeJS.Timeout | null = null;
    private readonly STORAGE_KEY_PREFIX = "treeView.state.";
    private readonly STORAGE_VERSION = 1;
    private readonly SAVE_DEBOUNCE_MS = 100; // Save quickly but avoid excessive writes
    private isSaving = false;

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

        context.eventBus.on("state:changed", () => {
            this.debouncedSave();
        });

        const loadedState = await this.load();
        if (loadedState) {
            context.logger.debug("Persistence module loaded state from storage");
            context.stateManager.setState(loadedState);
            context.logger.debug("Persistence module set state in state manager");

            // Apply expansion state after a delay to ensure tree is ready
            setTimeout(() => {
                context.logger.debug("Triggering expansion state restoration");
                this.restoreExpansionState();
            }, 200);
        } else {
            context.logger.debug("Persistence module: no saved state found");
        }

        // Listen for VS Code workspace events to save before shutdown
        context.extensionContext.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(() => {
                this.save();
            })
        );

        context.logger.debug("PersistenceModule initialized");
    }

    /**
     * Saves state with debouncing to avoid excessive writes
     */
    private debouncedSave(): void {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }

        this.saveTimeout = setTimeout(() => {
            this.save();
        }, this.SAVE_DEBOUNCE_MS);
    }

    /**
     * Saves the current state to storage
     */
    public async save(): Promise<void> {
        const config = this.context.config.modules.persistence;
        if (!config || config.strategy === "none" || this.isSaving) {
            return;
        }

        this.isSaving = true;

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
            // Only log error if it's not a cancellation
            if (error instanceof Error && !error.message.includes("Canceled")) {
                this.context.errorHandler.handleVoid(error, "Failed to save state");
            }
        } finally {
            this.isSaving = false;
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
     * Restores expansion state by triggering expansion of saved items
     */
    private async restoreExpansionState(): Promise<void> {
        const state = this.context.stateManager.getState();
        if (!state.expansion || state.expansion.expandedItems.size === 0) {
            return;
        }

        this.context.logger.debug(`Restoring expansion for ${state.expansion.expandedItems.size} items`);

        // Get the VS Code tree view if available
        const treeView = (this.context as any).treeView?.vscTreeView;
        if (!treeView) {
            this.context.logger.debug("No VS Code tree view available for expansion restoration");
            return;
        }

        this.context.refresh();
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
            this.context.logger.debug(
                `Saving expansion state: ${dataToSave.expansion.expandedItems.length} expanded, ${dataToSave.expansion.collapsedItems.length} collapsed`
            );
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

        dataToSave.selectedItemId = state.selectedItemId;
        dataToSave.selectedProjectKey = state.selectedProjectKey;
        dataToSave.selectedCycleKey = state.selectedCycleKey;
        dataToSave.selectedTovKey = state.selectedTovKey;

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

        if (data.version && data.version !== this.STORAGE_VERSION) {
            this.context.logger.warn(`Storage version mismatch: expected ${this.STORAGE_VERSION}, got ${data.version}`);
        }

        const state: Partial<TreeViewState> = {};

        if (data.lastRefresh) {
            state.lastRefresh = data.lastRefresh;
        }

        if (data.customRoot) {
            state.customRoot = data.customRoot;
        }

        if (data.expansion) {
            const expansionConfig = this.context.config.modules.expansion;
            state.expansion = {
                expandedItems: new Set(data.expansion.expandedItems || []),
                collapsedItems: new Set(data.expansion.collapsedItems || []),
                defaultExpanded: data.expansion.defaultExpanded ?? expansionConfig?.defaultExpanded ?? false
            };
            this.context.logger.debug(
                `Loaded expansion state: ${state.expansion.expandedItems.size} expanded, ${state.expansion.collapsedItems.size} collapsed`
            );
        }

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
        const storageKey = `${this.STORAGE_KEY_PREFIX}${this.context.config.id}`;
        await this.context.extensionContext.workspaceState.update(storageKey, data);
    }

    /**
     * Loads data from workspace storage
     * @returns The loaded data or undefined
     */
    private async loadFromWorkspace(): Promise<any> {
        const storageKey = `${this.STORAGE_KEY_PREFIX}${this.context.config.id}`;
        return this.context.extensionContext.workspaceState.get(storageKey);
    }

    /**
     * Saves data to global storage
     * @param data The data to save
     */
    private async saveToGlobal(data: any): Promise<void> {
        const storageKey = `${this.STORAGE_KEY_PREFIX}${this.context.config.id}`;
        await this.context.extensionContext.globalState.update(storageKey, data);
    }

    /**
     * Loads data from global storage
     * @returns The loaded data or undefined
     */
    private async loadFromGlobal(): Promise<any> {
        const storageKey = `${this.STORAGE_KEY_PREFIX}${this.context.config.id}`;
        return this.context.extensionContext.globalState.get(storageKey);
    }

    /**
     * Clears all persisted state
     */
    public async clear(): Promise<void> {
        const config = this.context.config.modules.persistence;
        if (!config) {
            return;
        }

        const storageKey = `${this.STORAGE_KEY_PREFIX}${this.context.config.id}`;

        if (config.strategy === "workspace") {
            await this.context.extensionContext.workspaceState.update(storageKey, undefined);
        } else if (config.strategy === "global") {
            await this.context.extensionContext.globalState.update(storageKey, undefined);
        }
    }

    /**
     * Forces an immediate save of the current state
     */
    public async forceSave(): Promise<void> {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        await this.save();
    }

    /**
     * Disposes of the module
     */
    public async dispose(): Promise<void> {
        await this.forceSave();
    }
}
