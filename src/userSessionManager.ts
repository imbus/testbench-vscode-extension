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
}
