/**
 * @file src/core/cacheManager.ts
 * @description A generic time-aware cache manager for caching tree view data.
 * Used to prevent unnecessary API calls that are called too frequently in short intervals.
 */

export interface CacheEntry<T> {
    data: T;
    timestampOfEntry: number;
}

export class CacheManager<KeyType, ValueType> {
    private cacheMap: Map<KeyType, CacheEntry<ValueType>> = new Map();

    constructor(private timeToLiveInMS: number) {}

    /**
     * Retrieves an entry from the cache if it exists and is not expired.
     * @param key The key of the item to retrieve.
     * @returns The cached data, or null if not found or expired.
     */
    public getEntryFromCache(key: KeyType): ValueType | null {
        const entry = this.cacheMap.get(key);
        if (entry && Date.now() - entry.timestampOfEntry < this.timeToLiveInMS) {
            return entry.data;
        }
        if (entry) {
            this.cacheMap.delete(key);
        }
        return null;
    }

    /**
     * Adds or updates an entry in the cache.
     * @param key The key of the item to set.
     * @param value The value to store.
     */
    public setEntryInCache(key: KeyType, value: ValueType): void {
        this.cacheMap.set(key, { data: value, timestampOfEntry: Date.now() });
    }

    /**
     * Clears all entries from the cache.
     */
    public clearCache(): void {
        this.cacheMap.clear();
    }

    /**
     * Checks if a valid, non-stale entry exists for a key.
     * @param key The key to check.
     * @returns True if a valid entry exists, false otherwise.
     */
    public hasEntryInCache(key: KeyType): boolean {
        const entry = this.cacheMap.get(key);
        if (entry && Date.now() - entry.timestampOfEntry < this.timeToLiveInMS) {
            return true;
        }
        return false;
    }
}
