/**
 * @file src/treeViews/utils/FrameworkCache.ts
 * @description A generic, time-to-live (TTL) cache for storing any type of data.
 */

import { TreeViewTiming } from "../../constants";

export class FrameworkCache<T> {
    private cache = new Map<
        string,
        {
            data: T; // Use the generic type T
            timestamp: number;
            ttl: number;
        }
    >();

    constructor(
        private defaultTTL: number = TreeViewTiming.DEFAULT_CACHE_TTL_MS // 5 minutes default
    ) {}

    /**
     * Get cached data for a given key.
     * @param key The unique key for the cached item.
     * @returns The cached data of type T, or null if not found or expired.
     */
    get(key: string): T | null {
        const cached = this.cache.get(key);
        if (!cached) {
            return null;
        }

        // Check if expired
        if (Date.now() - cached.timestamp > cached.ttl) {
            this.cache.delete(key);
            return null;
        }

        return cached.data;
    }

    /**
     * Set cached data.
     * @param key The unique key for the cached item.
     * @param data The data of type T to cache.
     * @param ttl Optional time-to-live in milliseconds.
     */
    set(key: string, data: T, ttl?: number): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl: ttl || this.defaultTTL
        });
    }

    /**
     * Clear the cache for a specific key, or clear the entire cache.
     * @param key Optional. The key of the item to remove. If omitted, clears the whole cache.
     */
    clear(key?: string): void {
        if (key) {
            this.cache.delete(key);
        } else {
            this.cache.clear();
        }
    }

    /**
     * Get cache statistics
     * @return The cache statistics
     */
    getStats(): {
        size: number;
        keys: string[];
        totalMemory: number;
    } {
        const keys = Array.from(this.cache.keys());
        const totalMemory = Array.from(this.cache.values()).reduce((sum, item) => {
            return sum + JSON.stringify(item.data).length;
        }, 0);

        return {
            size: this.cache.size,
            keys,
            totalMemory
        };
    }

    /**
     * Get the cache key for a given project and cycle
     * @param projectKey The key of the project
     * @param cycleKey The key of the cycle
     * @return The cache key
     */
    private getCacheKey(projectKey: string, cycleKey: string): string {
        return `${projectKey}:${cycleKey}`;
    }
}
