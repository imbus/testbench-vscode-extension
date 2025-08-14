/**
 * @file src/userSessionManager.ts
 * @description Manages the active user session and provides a unique identifier for storage.
 */

import * as vscode from "vscode";

const LAST_ACTIVE_USER_KEY = "testbenchExtension.lastActiveUser";

export interface UserInfo {
    userKey: string;
    login: string;
}

export class UserSessionManager {
    private currentUser: UserInfo | null = null;

    constructor(private context: vscode.ExtensionContext) {
        const lastUser = context.globalState.get<UserInfo>(LAST_ACTIVE_USER_KEY);
        if (lastUser) {
            this.currentUser = lastUser;
        }
    }

    public startSession(userInfo: UserInfo): void {
        this.currentUser = userInfo;
        this.context.globalState.update(LAST_ACTIVE_USER_KEY, userInfo);
    }

    public endSession(): void {
        this.currentUser = null;
        this.context.globalState.update(LAST_ACTIVE_USER_KEY, undefined);
    }

    public getCurrentUserId(): string {
        return this.currentUser?.userKey ?? "global_fallback";
    }

    /**
     * Checks if a valid user session is active (not the fallback session)
     * @returns True if a valid user session is active, false otherwise
     */
    public hasValidUserSession(): boolean {
        const userId = this.getCurrentUserId();
        return userId !== "global_fallback";
    }

    /**
     * Gets a user-specific storage key if a valid session exists
     * @param baseKey The base key to make user-specific
     * @returns User-specific storage key or null if no valid session
     */
    public getUserStorageKey(baseKey: string): string | null {
        if (!this.hasValidUserSession()) {
            return null;
        }
        return `${this.getCurrentUserId()}.${baseKey}`;
    }
}
