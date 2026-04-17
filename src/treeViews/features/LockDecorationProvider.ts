/**
 * @file src/treeViews/features/LockDecorationProvider.ts
 * @description Provides visual decorations (badge, color) for tree items that are locked by another user.
 * Uses VS Code's FileDecorationProvider to overlay lock indicators independently of the item's icon state.
 */

import * as vscode from "vscode";
import { userSessionManager } from "../../extension";

const LOCK_BADGE = "🔒";

type LockerValue = string | { key: string; name: string } | null | undefined;

export class LockDecorationProvider implements vscode.FileDecorationProvider {
    private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    private lockedItemUris = new Set<string>();

    private isLockedByDifferentUser(locker: LockerValue, currentUserKey: string): boolean {
        if (!locker) {
            return false;
        }
        const lockerKey = typeof locker === "string" ? locker : locker.key;
        return lockerKey !== currentUserKey;
    }

    /**
     * Updates the lock state for a tree item URI. Call this when tree items are created or refreshed.
     * @param uri The resourceUri of the tree item
     * @param lockers The locker fields from spec, aut, and exec layers
     */
    public updateLockState(
        uri: vscode.Uri,
        lockers: {
            spec?: string | { key: string; name: string } | null;
            aut?: string | { key: string; name: string } | null;
            exec?: string | { key: string; name: string } | null;
        }
    ): void {
        const currentUserKey = userSessionManager.getCurrentUserId();
        const hasLockByOther = Object.values(lockers).some((locker) =>
            this.isLockedByDifferentUser(locker, currentUserKey)
        );

        const uriStr = uri.toString();
        if (hasLockByOther) {
            this.lockedItemUris.add(uriStr);
        } else {
            this.lockedItemUris.delete(uriStr);
        }
    }

    /**
     * Checks if a tree item (by URI) is locked by another user.
     */
    public isLockedByOther(uri: vscode.Uri): boolean {
        return this.lockedItemUris.has(uri.toString());
    }

    /**
     * Fires a change event to refresh decorations for the given URIs, or all if undefined.
     */
    public fireDidChange(uris?: vscode.Uri[]): void {
        this._onDidChangeFileDecorations.fire(uris);
    }

    /**
     * Clears all tracked lock states and refreshes decorations.
     */
    public clear(): void {
        this.lockedItemUris.clear();
        this._onDidChangeFileDecorations.fire(undefined);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== "testbench-theme") {
            return undefined;
        }

        if (!this.lockedItemUris.has(uri.toString())) {
            return undefined;
        }

        return new vscode.FileDecoration(LOCK_BADGE, undefined, new vscode.ThemeColor("list.warningForeground"));
    }

    dispose(): void {
        this._onDidChangeFileDecorations.dispose();
    }
}
