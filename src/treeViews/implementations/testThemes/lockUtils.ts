/**
 * @file lockUtils.ts
 * @description Shared lock and visibility utilities for test theme tree view/item logic.
 */

import { TestThemeItemTypes } from "../../../constants";
import { TestStructureNode } from "../../../testBenchTypes";

export type LockerValue = string | { key: string; name: string } | null | undefined;

export const SYSTEM_LOCK_KEY = "-2";

export interface TestThemeVisibilityOptions {
    filterDiffModeEnabled?: boolean;
}

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

/**
 * Evaluates whether a test theme node is visible according to Test Themes view rules.
 *
 * @param node Structure node to evaluate.
 * @param options Visibility evaluation options.
 * @returns True when the node is visible.
 */
export function isTestThemeNodeVisible(
    node: Pick<TestStructureNode, "elementType" | "exec" | "base">,
    options: TestThemeVisibilityOptions = {}
): boolean {
    const { filterDiffModeEnabled = false } = options;

    if (node.elementType === TestThemeItemTypes.TEST_CASE) {
        return false;
    }

    if (node.exec?.status === "NotPlanned") {
        return false;
    }

    const lockerKey = normalizeLockerKey(node.exec?.locker);
    if (lockerKey === SYSTEM_LOCK_KEY) {
        return false;
    }

    if (!filterDiffModeEnabled && node.base?.matchesFilter === false) {
        return false;
    }

    return true;
}
