/**
 * Shared lock utilities for test theme tree view/item logic.
 */

export type LockerValue = string | { key: string; name: string } | null | undefined;

export const SYSTEM_LOCK_KEY = "-2";

/**
 * Normalizes locker value into a comparable locker key.
 * @param locker Locker value from spec/aut/exec layer.
 * @returns Normalized locker key or null when not available.
 */
export function normalizeLockerKey(locker: LockerValue): string | null {
    if (locker === null || locker === undefined) {
        return null;
    }

    if (typeof locker === "string") {
        const trimmed = locker.trim();
        return trimmed === "" ? null : trimmed;
    }

    const rawKey = locker.key;
    if (rawKey === null || rawKey === undefined) {
        return null;
    }

    const normalized = String(rawKey).trim();
    return normalized === "" ? null : normalized;
}
