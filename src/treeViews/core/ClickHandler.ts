/**
 * @file src/treeViews/core/ClickHandler.ts
 * @description Click handler for tree view items with single and double click support.
 */

import { TreeViewTiming } from "../../constants";

/**
 * Interface for click event data
 */
export interface ClickEventData {
    id: string;
    timestamp: number;
}

/**
 * Interface for click handler configuration
 */
export interface ClickHandlerConfig {
    /**
     * Double-click threshold in milliseconds.
     * Defaults to TreeViewTiming.DOUBLE_CLICK_THRESHOLD_MS if not specified.
     */
    doubleClickThresholdMs?: number;
    enableLogging?: boolean;
}

/**
 * Interface for click action handlers
 */
export interface ClickActionHandlers<T> {
    onSingleClick?: (item: T) => Promise<void> | void;
    onDoubleClick?: (item: T) => Promise<void> | void;
}

/**
 * Click handler for tree view items
 * Manages single and double click detection and execution
 */
export class ClickHandler<T> {
    private clickHistory = new Map<string, ClickEventData>();
    private config: ClickHandlerConfig;
    private handlers: ClickActionHandlers<T>;

    constructor(config: ClickHandlerConfig = {}, handlers: ClickActionHandlers<T> = {}) {
        this.config = {
            enableLogging: true,
            ...config
        };
        this.handlers = handlers;
    }

    /**
     * Handles a click event for a tree item
     * @param item The tree item that was clicked
     * @param itemId The unique identifier for the item
     * @param logger Optional logger for debugging
     */
    public async handleClick(item: T, itemId: string, logger?: any): Promise<void> {
        const now = Date.now();
        const previousClick = this.clickHistory.get(itemId);

        const threshold = this.config.doubleClickThresholdMs ?? TreeViewTiming.DOUBLE_CLICK_THRESHOLD_MS;
        const isDoubleClick = previousClick && now - previousClick.timestamp < threshold;

        if (isDoubleClick) {
            if (this.config.enableLogging && logger) {
                logger.debug(`Double-click detected for item: ${itemId}`);
            }

            this.clickHistory.delete(itemId);

            if (this.handlers.onDoubleClick) {
                try {
                    await this.handlers.onDoubleClick(item);
                } catch (error) {
                    if (logger) {
                        logger.error(`Error in double-click handler: ${error}`);
                    }
                    throw error;
                }
            }
        } else {
            this.clickHistory.set(itemId, { id: itemId, timestamp: now });

            if (this.config.enableLogging && logger) {
                logger.debug(`Single-click detected for item: ${itemId}`);
            }

            if (this.handlers.onSingleClick) {
                try {
                    await this.handlers.onSingleClick(item);
                } catch (error) {
                    if (logger) {
                        logger.error(`Error in single-click handler: ${error}`);
                    }
                    throw error;
                }
            }
        }
    }

    /**
     * Clears click history for a specific item
     * @param itemId The item ID to clear history for
     */
    public clearClickHistory(itemId: string): void {
        this.clickHistory.delete(itemId);
    }

    /**
     * Clears all click history
     */
    public clearAllClickHistory(): void {
        this.clickHistory.clear();
    }

    /**
     * Updates the click action handlers
     * @param handlers The new handlers to use
     */
    public updateHandlers(handlers: ClickActionHandlers<T>): void {
        this.handlers = { ...this.handlers, ...handlers };
    }

    /**
     * Updates the configuration
     * @param config The new configuration to use
     */
    public updateConfig(config: Partial<ClickHandlerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Gets the current click history for debugging
     * @returns A copy of the click history map
     */
    public getClickHistory(): Map<string, ClickEventData> {
        return new Map(this.clickHistory);
    }
}
