/**
 * @file src/treeViews/utils/EventBus.ts
 * @description Event bus for decoupled communication between tree view components.
 */

import * as vscode from "vscode";
import { TreeViewTiming } from "../../constants";

export interface TreeViewEvent {
    type: string;
    source: string;
    data?: any;
    timestamp: number;
}

export type EventHandler = (event: TreeViewEvent) => void | Promise<void>;

export interface EventSubscription {
    unsubscribe: () => void;
}

export class EventBus implements vscode.Disposable {
    private handlers: Map<string, Set<EventHandler>> = new Map();
    private eventHistory: TreeViewEvent[] = [];
    private readonly maxHistorySize = TreeViewTiming.EVENT_HISTORY_MAX_SIZE;
    private isDisposed = false;

    /**
     * Subscribe to an event type
     * @param eventType The type of event to subscribe to
     * @param handler The handler function to call when the event occurs
     * @return A subscription object that can be used to unsubscribe
     */
    public on(eventType: string, handler: EventHandler): EventSubscription {
        if (this.isDisposed) {
            throw new Error("EventBus has been disposed");
        }

        if (!this.handlers.has(eventType)) {
            this.handlers.set(eventType, new Set());
        }

        this.handlers.get(eventType)!.add(handler);

        // Return subscription object
        return {
            unsubscribe: () => {
                this.off(eventType, handler);
            }
        };
    }

    /**
     * Subscribe to an event type for only one emission
     * @param eventType The type of event to subscribe to
     * @param handler The handler function to call when the event occurs
     * @return A subscription object that can be used to unsubscribe
     */
    public once(eventType: string, handler: EventHandler): EventSubscription {
        const wrappedHandler: EventHandler = (event) => {
            handler(event);
            this.off(eventType, wrappedHandler);
        };

        return this.on(eventType, wrappedHandler);
    }

    /**
     * Unsubscribe from an event type
     * @param eventType The type of event to unsubscribe from
     * @param handler The handler function to unsubscribe
     */
    public off(eventType: string, handler: EventHandler): void {
        const handlers = this.handlers.get(eventType);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.handlers.delete(eventType);
            }
        }
    }

    /**
     * Emit an event
     * @param event The event to emit
     */
    public async emit(event: TreeViewEvent): Promise<void> {
        if (this.isDisposed) {
            throw new Error("EventBus has been disposed");
        }

        this.addToHistory(event);
        const handlers = new Set<EventHandler>();

        const specificHandlers = this.handlers.get(event.type);
        if (specificHandlers) {
            specificHandlers.forEach((h) => handlers.add(h));
        }

        const wildcardHandlers = this.handlers.get("*");
        if (wildcardHandlers) {
            wildcardHandlers.forEach((h) => handlers.add(h));
        }

        // Execute handlers
        const promises: Promise<void>[] = [];

        for (const handler of handlers) {
            try {
                const result = handler(event);
                if (result instanceof Promise) {
                    promises.push(
                        result.catch((error) => {
                            console.error(`Error in event handler for ${event.type}:`, error);
                        })
                    );
                }
            } catch (error) {
                console.error(`Error in event handler for ${event.type}:`, error);
            }
        }

        if (promises.length > 0) {
            await Promise.all(promises);
        }
    }

    /**
     * Emit an event and wait for all handlers to complete
     * @param event The event to emit
     */
    public async emitAndWait(event: TreeViewEvent): Promise<void> {
        return this.emit(event);
    }

    /**
     * Clear all handlers for a specific event type
     * @param eventType The type of event to clear handlers for
     */
    public clearHandlers(eventType?: string): void {
        if (eventType) {
            this.handlers.delete(eventType);
        } else {
            this.handlers.clear();
        }
    }

    /**
     * Get event history
     * @param eventType The type of event to get history for
     * @return The event history
     */
    public getHistory(eventType?: string): TreeViewEvent[] {
        if (eventType) {
            return this.eventHistory.filter((e) => e.type === eventType);
        }
        return [...this.eventHistory];
    }

    /**
     * Clear event history
     */
    public clearHistory(): void {
        this.eventHistory = [];
    }

    /**
     * Add an event to the history.
     * Limits the history size to maxHistorySize.
     * @param event The event to add to the history
     */
    private addToHistory(event: TreeViewEvent): void {
        this.eventHistory.push(event);

        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }
    }

    /**
     * Check if there are any handlers for an event type
     * @param eventType The type of event to check for handlers
     * @return True if there are any handlers for the event type
     */
    public hasHandlers(eventType: string): boolean {
        return this.handlers.has(eventType) || this.handlers.has("*");
    }

    /**
     * Get the number of handlers for an event type
     * @param eventType The type of event to get the handler count for
     * @return The number of handlers for the event type
     */
    public getHandlerCount(eventType?: string): number {
        if (eventType) {
            const handlers = this.handlers.get(eventType);
            return handlers ? handlers.size : 0;
        }

        let total = 0;
        for (const handlers of this.handlers.values()) {
            total += handlers.size;
        }
        return total;
    }

    /**
     * Dispose of the event bus
     */
    public dispose(): void {
        if (this.isDisposed) {
            return;
        }

        this.isDisposed = true;
        this.handlers.clear();
        this.eventHistory = [];
    }
}

// Common event types
export const TreeViewEventTypes = {
    // State events
    STATE_CHANGED: "state:changed",
    STATE_LOADED: "state:loaded",
    STATE_SAVED: "state:saved",
    STATE_ERROR: "state:error",

    // Tree events
    TREE_REFRESH: "tree:refresh",
    TREE_ITEM_SELECTED: "tree:itemSelected",
    TREE_ITEM_EXPANDED: "tree:itemExpanded",
    TREE_ITEM_COLLAPSED: "tree:itemCollapsed",
    TREE_PROJECT_SELECTED: "tree:projectSelected",
    TREE_CYCLE_SELECTED: "tree:cycleSelected",

    // Module events
    MODULE_INITIALIZED: "module:initialized",
    MODULE_ERROR: "module:error",
    MODULE_CONFIG_CHANGED: "module:configChanged",

    // Custom root events
    CUSTOM_ROOT_SET: "customRoot:set",
    CUSTOM_ROOT_RESET: "customRoot:reset",

    // Marking events
    MARKING_ADDED: "marking:added",
    MARKING_REMOVED: "marking:removed",
    MARKING_CLEARED: "marking:cleared",
    MARKING_CLEARED_GLOBAL: "marking:cleared:global",

    // Filter events
    FILTER_ADDED: "filter:added",
    FILTER_REMOVED: "filter:removed",
    FILTER_APPLIED: "filter:applied",

    // Data events
    DATA_LOADING: "data:loading",
    DATA_LOADED: "data:loaded",
    DATA_ERROR: "data:error",

    // Test generation events
    TEST_GENERATION_STARTED: "testGeneration:started",
    TEST_GENERATION_COMPLETED: "testGeneration:completed",
    TEST_GENERATION_FAILED: "testGeneration:failed",

    // Import events
    IMPORT_STARTED: "import:started",
    IMPORT_COMPLETED: "import:completed",
    IMPORT_FAILED: "import:failed"
} as const;

// Type helper for event types
export type TreeViewEventType = (typeof TreeViewEventTypes)[keyof typeof TreeViewEventTypes];
