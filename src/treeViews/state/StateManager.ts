/**
 * @file src/treeViews/state/StateManager.ts
 * @description State management for tree views with persistence, history, and change tracking.
 */

import * as vscode from "vscode";
import { TreeViewState, StateChange, StateSnapshot, SerializedTreeViewState } from "./StateTypes";
import { EventBus, TreeViewEvent } from "../utils/EventBus";
import { TreeViewTiming } from "../../constants";

export class StateManager {
    private state: TreeViewState;
    private stateHistory: StateSnapshot[] = [];
    private saveTimer: NodeJS.Timeout | null = null;
    private readonly maxHistorySize = 50;
    private readonly saveDelay = TreeViewTiming.STATE_SAVE_DELAY_MS;
    private _disposed = false;

    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly treeViewId: string,
        private readonly eventBus: EventBus
    ) {
        this.state = this.createInitialState();
    }

    private createInitialState(): TreeViewState {
        return {
            loading: false,
            error: null,
            initialized: false,
            lastRefresh: Date.now(),
            items: new Map(),
            rootItems: [],
            customRoot: null,
            marking: null,
            expansion: null,
            filtering: null,
            selectedItemId: null,
            selectedProjectKey: null,
            selectedCycleKey: null,
            selectedTovKey: null,
            metadata: {}
        };
    }

    // State access
    public getState(): TreeViewState {
        return this.state;
    }

    public isLoading(): boolean {
        return this.state.loading;
    }

    public hasError(): boolean {
        return this.state.error !== null;
    }

    public getError(): Error | null {
        return this.state.error;
    }

    // State updates
    public setState(updates: Partial<TreeViewState>): void {
        const previousState = this.cloneState(this.state);

        // Apply updates
        Object.assign(this.state, updates);
        this.state.lastRefresh = Date.now();

        // Add to history
        this.addToHistory(previousState);

        // Emit state change event
        this.emitStateChange(previousState, this.state);

        // Schedule save
        if (this.shouldAutoSave(updates)) {
            this.scheduleSave();
        }
    }

    public setLoading(isLoading: boolean): void {
        this.setState({ loading: isLoading });
    }

    public setError(error: Error | null): void {
        this.setState({ error, loading: false });
    }

    public updateItem(itemId: string, item: any): void {
        const items = new Map(this.state.items);
        items.set(itemId, item);
        this.setState({ items });
    }

    public addItem(item: any): void {
        const items = new Map(this.state.items);
        items.set(item.id, item);
        this.setState({ items });
    }

    public removeItem(itemId: string): void {
        const items = new Map(this.state.items);
        items.delete(itemId);
        this.setState({ items });
    }

    public clear(): void {
        this.setState({
            loading: false,
            error: null,
            customRoot: null,
            marking: null,
            expansion: null,
            filtering: null,
            items: new Map(),
            rootItems: []
        });
    }

    /**
     * Saves the current state to workspace storage
     * @return Promise that resolves when save is complete
     */
    public async save(): Promise<void> {
        try {
            const dataToSave = this.serializeState(this.state);
            const key = `treeState.${this.treeViewId}`;

            await this.extensionContext.workspaceState.update(key, dataToSave);

            this.eventBus.emit({
                type: "state:saved",
                source: this.treeViewId,
                data: { state: this.state },
                timestamp: Date.now()
            });
        } catch (error) {
            this.eventBus.emit({
                type: "state:error",
                source: this.treeViewId,
                data: { error },
                timestamp: Date.now()
            });
        }
    }

    /**
     * Loads state from workspace storage
     * @return Promise that resolves when load is complete
     */
    public async load(): Promise<void> {
        try {
            const key = `treeState.${this.treeViewId}`;
            const savedData = this.extensionContext.workspaceState.get<SerializedTreeViewState>(key);

            if (savedData) {
                const loadedState = this.deserializeState(savedData);
                this.state = { ...this.state, ...loadedState };

                this.eventBus.emit({
                    type: "state:loaded",
                    source: this.treeViewId,
                    data: { state: this.state },
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            this.eventBus.emit({
                type: "state:error",
                source: this.treeViewId,
                data: { error },
                timestamp: Date.now()
            });
        }
    }

    /**
     * Schedules a delayed save operation
     */
    private scheduleSave(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }

        this.saveTimer = setTimeout(() => {
            this.save();
        }, this.saveDelay);
    }

    /**
     * Undoes the last state change
     */
    public undo(): void {
        if (this.stateHistory.length > 0) {
            const previousSnapshot = this.stateHistory.pop()!;
            const currentState = this.cloneState(this.state);
            this.state = previousSnapshot.state;
            this.emitStateChange(currentState, previousSnapshot.state);
        }
    }

    /**
     * Checks if undo is possible
     * @return True if undo is possible
     */
    public canUndo(): boolean {
        return this.stateHistory.length > 0;
    }

    /**
     * Creates a snapshot of the current state
     * @param description Optional description of the snapshot
     */
    public createSnapshot(description?: string): void {
        const snapshot: StateSnapshot = {
            state: this.cloneState(this.state),
            timestamp: Date.now(),
            description
        };
        this.addToHistory(snapshot.state);
    }

    /**
     * Adds a state snapshot to the history
     * @param state The state to snapshot
     */
    private addToHistory(state: TreeViewState): void {
        const snapshot: StateSnapshot = {
            state: state,
            timestamp: Date.now()
        };

        this.stateHistory.push(snapshot);

        // Limit history size
        if (this.stateHistory.length > this.maxHistorySize) {
            this.stateHistory.shift();
        }
    }

    /**
     * Checks if auto-save should be triggered
     * @param updates The updates to check
     * @return True if auto-save should be triggered
     */
    private shouldAutoSave(updates: Partial<TreeViewState>): boolean {
        // Save on significant changes
        return !!(updates.customRoot || updates.marking || updates.expansion || updates.filtering || updates.rootItems);
    }

    /**
     * Emits a state change event
     * @param previousState The previous state
     * @param newState The new state
     */
    private emitStateChange(previousState: TreeViewState, newState: TreeViewState): void {
        const changes = this.detectChanges(previousState, newState);

        if (changes.length > 0) {
            const event: TreeViewEvent = {
                type: "state:changed",
                source: this.treeViewId,
                data: {
                    changes,
                    previousState,
                    newState
                },
                timestamp: Date.now()
            };

            this.eventBus.emit(event);
        }
    }

    /**
     * Detects changes between two states
     * @param prev The previous state
     * @param next The new state
     * @return Array of changes
     */
    private detectChanges(prev: TreeViewState, next: TreeViewState): StateChange[] {
        const changes: StateChange[] = [];

        // Check each field for changes
        const fields: (keyof TreeViewState)[] = [
            "loading",
            "error",
            "customRoot",
            "marking",
            "expansion",
            "filtering",
            "selectedItemId",
            "selectedProjectKey",
            "selectedCycleKey",
            "selectedTovKey"
        ];

        for (const field of fields) {
            if (!this.deepEqual(prev[field], next[field])) {
                changes.push({
                    field,
                    oldValue: prev[field],
                    newValue: next[field],
                    timestamp: Date.now()
                });
            }
        }

        return changes;
    }

    /**
     * Checks if two values are deeply equal
     * @param a The first value
     * @param b The second value
     * @return True if the values are deeply equal
     */
    private deepEqual(a: any, b: any): boolean {
        if (a === b) {
            return true;
        }
        if (a === null || b === null) {
            return false;
        }
        if (typeof a !== typeof b) {
            return false;
        }

        if (a instanceof Map && b instanceof Map) {
            if (a.size !== b.size) {
                return false;
            }
            for (const [key, value] of a) {
                if (!b.has(key) || !this.deepEqual(value, b.get(key))) {
                    return false;
                }
            }
            return true;
        }

        if (a instanceof Set && b instanceof Set) {
            if (a.size !== b.size) {
                return false;
            }
            for (const value of a) {
                if (!b.has(value)) {
                    return false;
                }
            }
            return true;
        }

        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) {
                return false;
            }
            for (let i = 0; i < a.length; i++) {
                if (!this.deepEqual(a[i], b[i])) {
                    return false;
                }
            }
            return true;
        }

        if (typeof a === "object" && typeof b === "object") {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) {
                return false;
            }
            for (const key of keysA) {
                if (!keysB.includes(key) || !this.deepEqual(a[key], b[key])) {
                    return false;
                }
            }
            return true;
        }

        return false;
    }

    /**
     * Clones a state object
     * @param state The state to clone
     * @return The cloned state
     */
    private cloneState(state: TreeViewState): TreeViewState {
        return {
            ...state,
            items: new Map(state.items),
            error: state.error ? { ...state.error } : null,
            customRoot: state.customRoot ? { ...state.customRoot } : null,
            marking: state.marking
                ? {
                      markedItems: new Map(state.marking.markedItems),
                      hierarchies: new Map(state.marking.hierarchies)
                  }
                : null,
            expansion: state.expansion
                ? {
                      expandedItems: new Set(state.expansion.expandedItems),
                      collapsedItems: new Set(state.expansion.collapsedItems),
                      defaultExpanded: state.expansion.defaultExpanded
                  }
                : null,
            filtering: state.filtering
                ? {
                      ...state.filtering,
                      activeFilters: [...state.filtering.activeFilters],
                      customFilters: [...state.filtering.customFilters],
                      hiddenItems: new Set(state.filtering.hiddenItems)
                  }
                : null,
            rootItems: [...state.rootItems]
        };
    }

    /**
     * Serializes a state object
     * @param state The state to serialize
     * @return The serialized state
     */
    private serializeState(state: TreeViewState): SerializedTreeViewState {
        return {
            version: 1,
            treeViewId: this.treeViewId,
            timestamp: Date.now(),
            state: {
                loading: state.loading,
                error: state.error
                    ? {
                          message: state.error.message,
                          stack: state.error.stack
                      }
                    : null,
                initialized: state.initialized,
                lastRefresh: state.lastRefresh,
                items: Array.from(state.items.entries()),
                rootItems: state.rootItems,
                customRoot: state.customRoot
                    ? {
                          active: state.customRoot.active,
                          rootItemId: state.customRoot.rootItemId,
                          rootItemPath: state.customRoot.rootItemPath,
                          originalTitle: state.customRoot.originalTitle,
                          contextData: state.customRoot.contextData
                      }
                    : null,
                marking: state.marking
                    ? {
                          markedItems: Array.from(state.marking.markedItems.entries()),
                          hierarchies: Array.from(state.marking.hierarchies.entries()).map(([key, h]) => [
                              key,
                              {
                                  rootId: h.rootId,
                                  descendantIds: Array.from(h.descendantIds)
                              }
                          ])
                      }
                    : null,
                expansion: state.expansion
                    ? {
                          expandedItems: Array.from(state.expansion.expandedItems),
                          collapsedItems: Array.from(state.expansion.collapsedItems),
                          defaultExpanded: state.expansion.defaultExpanded
                      }
                    : null,
                filtering: state.filtering
                    ? {
                          activeFilters: state.filtering.activeFilters,
                          customFilters: state.filtering.customFilters.map((f) => ({
                              ...f,
                              predicate: typeof f.predicate === "function" ? f.predicate.toString() : f.predicate
                          })),
                          hiddenItems: Array.from(state.filtering.hiddenItems)
                      }
                    : null,
                selectedItemId: state.selectedItemId,
                selectedProjectKey: state.selectedProjectKey,
                selectedCycleKey: state.selectedCycleKey,
                selectedTovKey: state.selectedTovKey,
                metadata: state.metadata
            }
        };
    }

    /**
     * Deserializes a state object
     * @param data The serialized state
     * @return The deserialized state
     */
    private deserializeState(data: SerializedTreeViewState): Partial<TreeViewState> {
        const state = data.state;
        return {
            loading: state.loading,
            error: state.error ? new Error(state.error.message) : null,
            initialized: state.initialized,
            lastRefresh: state.lastRefresh,
            items: new Map(state.items || []),
            rootItems: state.rootItems || [],
            customRoot: state.customRoot,
            marking: state.marking
                ? {
                      markedItems: new Map(state.marking.markedItems || []),
                      hierarchies: new Map(
                          (state.marking.hierarchies || []).map(([key, h]: [string, any]) => [
                              key,
                              {
                                  rootId: h.rootId,
                                  descendantIds: new Set(h.descendantIds || [])
                              }
                          ])
                      )
                  }
                : null,
            expansion: state.expansion
                ? {
                      expandedItems: new Set(state.expansion.expandedItems || []),
                      collapsedItems: new Set(state.expansion.collapsedItems || []),
                      defaultExpanded: state.expansion.defaultExpanded
                  }
                : null,
            filtering: state.filtering
                ? {
                      activeFilters: state.filtering.activeFilters || [],
                      customFilters: state.filtering.customFilters || [],
                      hiddenItems: new Set(state.filtering.hiddenItems || [])
                  }
                : null,
            selectedItemId: state.selectedItemId,
            selectedProjectKey: state.selectedProjectKey,
            selectedCycleKey: state.selectedCycleKey,
            selectedTovKey: state.selectedTovKey,
            metadata: state.metadata || {}
        };
    }

    /**
     * Disposes of the state manager
     */
    public dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;

        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }

        this.stateHistory = [];
    }
}
