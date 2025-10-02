/**
 * @file src/sharedSessionManager.ts
 * @description Manages shared TestBench sessions across multiple VS Code instances
 */

import * as vscode from "vscode";
import { PlayServerConnection } from "./testBenchConnection";
import { logger } from "./extension";

interface SharedSessionData {
    sessionToken: string;
    userKey: string;
    loginName: string;
    connectionId: string;
    serverName: string;
    portNumber: number;
    username: string;
    createdAt: number;
    lastValidated: number;
    isInsecure: boolean;
}

const SHARED_SESSION_KEY = "testbenchExtension.sharedSession";
const SESSION_VALIDATION_INTERVAL = 60000; // 1 minute

export class SharedSessionManager {
    private static instance: SharedSessionManager;

    private constructor(private context: vscode.ExtensionContext) {}

    public static getInstance(context: vscode.ExtensionContext): SharedSessionManager {
        if (!SharedSessionManager.instance) {
            SharedSessionManager.instance = new SharedSessionManager(context);
        }
        return SharedSessionManager.instance;
    }

    /**
     * Stores session data that can be shared across VS Code instances
     */
    public async storeSharedSession(
        sessionToken: string,
        userKey: string,
        loginName: string,
        connectionId: string,
        serverName: string,
        portNumber: number,
        username: string,
        isInsecure: boolean
    ): Promise<void> {
        const sessionData: SharedSessionData = {
            sessionToken,
            userKey,
            loginName,
            connectionId,
            serverName,
            portNumber,
            username,
            isInsecure,
            createdAt: Date.now(),
            lastValidated: Date.now()
        };

        // Store in both secret storage (for token) and global state (for metadata)
        await this.context.secrets.store(SHARED_SESSION_KEY + ".token", sessionToken);
        await this.context.globalState.update(SHARED_SESSION_KEY + ".metadata", {
            ...sessionData,
            sessionToken: undefined // Don't store token in global state
        });

        logger.debug("[SharedSessionManager] Stored shared session for user: " + loginName);
    }

    /**
     * Retrieves shared session data if available and still valid
     */
    public async getSharedSession(): Promise<SharedSessionData | null> {
        try {
            const token = await this.context.secrets.get(SHARED_SESSION_KEY + ".token");
            const metadata = this.context.globalState.get<Omit<SharedSessionData, "sessionToken">>(
                SHARED_SESSION_KEY + ".metadata"
            );

            if (!token || !metadata) {
                return null;
            }

            // Reconstruct full session data
            const sessionData: SharedSessionData = {
                ...metadata,
                sessionToken: token
            };

            // Check if session needs revalidation
            const timeSinceValidation = Date.now() - sessionData.lastValidated;
            if (timeSinceValidation > SESSION_VALIDATION_INTERVAL) {
                logger.trace("[SharedSessionManager] Session needs revalidation");
                return sessionData; // Return data for validation attempt
            }

            return sessionData;
        } catch (error) {
            logger.error("[SharedSessionManager] Error retrieving shared session:", error);
            return null;
        }
    }

    /**
     * Validates if a session is still active on the server
     */
    public async validateSession(connection: PlayServerConnection): Promise<boolean> {
        try {
            const apiClient = connection.getApiClient();
            const response = await apiClient.get(`/login/session/v1`, {
                headers: { accept: "application/vnd.testbench+json" },
                proxy: false,
                validateStatus: () => true
            });

            const isValid = response.status === 200;

            if (isValid) {
                // Update last validated timestamp
                const metadata = this.context.globalState.get<any>(SHARED_SESSION_KEY + ".metadata");
                if (metadata) {
                    await this.context.globalState.update(SHARED_SESSION_KEY + ".metadata", {
                        ...metadata,
                        lastValidated: Date.now()
                    });
                }
            }

            logger.trace(`[SharedSessionManager] Session validation result: ${isValid}`);
            return isValid;
        } catch (error) {
            logger.error("[SharedSessionManager] Error validating session:", error);
            return false;
        }
    }

    /**
     * Clears the shared session data
     */
    public async clearSharedSession(): Promise<void> {
        await this.context.secrets.delete(SHARED_SESSION_KEY + ".token");
        await this.context.globalState.update(SHARED_SESSION_KEY + ".metadata", undefined);
        logger.debug("[SharedSessionManager] Cleared shared session data");
    }

    /**
     * Checks if a shared session exists for the given connection
     */
    public async hasSharedSessionForConnection(connectionId: string): Promise<boolean> {
        const session = await this.getSharedSession();
        return session !== null && session.connectionId === connectionId;
    }
}
