/**
 * @file connectionManager.ts
 * @description Manages TestBench connection connections, storing connection details in globalState
 * and passwords securely in SecretStorage.
 */

import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./extension";
import { StorageKeys } from "./constants";

export interface TestBenchConnection {
    id: string; // Unique identifier for the connection (e.g., a UUID)
    label: string; // User-friendly name for the connection (e.g., "Dev Server", "Client X Prod")
    serverName: string;
    portNumber: number;
    username: string;
}

/**
 * Retrieves all saved TestBench connections.
 * @param {vscode.ExtensionContext} context The extension context.
 * @returns {Promise<TestBenchConnection[]>} A promise that resolves to an array of TestBenchConnection objects.
 */
export async function getConnections(context: vscode.ExtensionContext): Promise<TestBenchConnection[]> {
    try {
        const connections: TestBenchConnection[] = context.globalState.get<TestBenchConnection[]>(
            StorageKeys.CONNECTIONS_STORAGE_KEY,
            []
        );
        logger.debug(`[ConnectionManager] Retrieved ${connections.length} connections.`);
        return connections;
    } catch (error) {
        logger.error("[ConnectionManager] Error retrieving connections:", error);
        return [];
    }
}

/**
 * Saves or updates a TestBench connection.
 * If it's a new connection (no id or id not found), a new id will be generated.
 * Passwords that are empty strings will not be stored. To remove an existing password,
 * pass `undefined` or an empty string for the password parameter.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param connection The connection data to save. The `id` can be omitted for new connections.
 * @param {string} [password] The password for the connection (optional). If undefined or an empty string,
 * no password will be stored, and any existing password for this connection will be removed.
 * @returns {Promise<string>} The ID of the saved connection.
 * @throws {Error} If a connection with the same label already exists (excluding the current connection for updates).
 */
export async function saveConnection(
    context: vscode.ExtensionContext,
    connection: Omit<TestBenchConnection, "id"> & { id?: string }, // Optional id for new connections
    password?: string
): Promise<string> {
    try {
        const connections: TestBenchConnection[] = await getConnections(context);
        let connectionToSave: TestBenchConnection;
        const existingConnectionIndex: number = connection.id
            ? connections.findIndex((p) => p.id === connection.id)
            : -1;

        const duplicateConnection = await findConnectionByLabel(context, connection.label, connection.id);
        if (duplicateConnection) {
            const errorMessage = `[ConnectionManager] A connection with the label "${connection.label}" already exists. Connection labels must be unique.`;
            logger.warn(errorMessage);
            throw new Error(errorMessage);
        }

        if (existingConnectionIndex !== -1 && connection.id) {
            connectionToSave = { ...connections[existingConnectionIndex], ...connection };
            connections[existingConnectionIndex] = connectionToSave;
            logger.debug(
                `[ConnectionManager] Updating connection: ${connectionToSave.label} with ID ${connectionToSave.id}`
            );
        } else {
            const newId: string = uuidv4();
            connectionToSave = { ...connection, id: newId } as TestBenchConnection;
            connections.push(connectionToSave);
            logger.debug(
                `[ConnectionManager] Adding new connection ${connectionToSave.label} with ID ${connectionToSave.id}`
            );
        }

        await context.globalState.update(StorageKeys.CONNECTIONS_STORAGE_KEY, connections);
        if (password && password.length > 0) {
            await context.secrets.store(StorageKeys.CONNECTION_PASSWORD_SECRET_PREFIX + connectionToSave.id, password);
        } else {
            await context.secrets.delete(StorageKeys.CONNECTION_PASSWORD_SECRET_PREFIX + connectionToSave.id);
        }
        return connectionToSave.id;
    } catch (error) {
        logger.error(`[ConnectionManager] Error saving connection ${connection.label}:`, error);
        vscode.window.showErrorMessage(`Failed to save connection: ${(error as Error).message}`);
        throw error;
    }
}

/**
 * Deletes a TestBench connection and its associated password.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} connectionIdToDelete The ID of the connection to delete.
 */
export async function deleteConnection(context: vscode.ExtensionContext, connectionIdToDelete: string): Promise<void> {
    try {
        let connections: TestBenchConnection[] = await getConnections(context);
        const initialLength: number = connections.length;
        connections = connections.filter((p) => p.id !== connectionIdToDelete);

        if (connections.length < initialLength) {
            await context.globalState.update(StorageKeys.CONNECTIONS_STORAGE_KEY, connections);
            await context.secrets.delete(StorageKeys.CONNECTION_PASSWORD_SECRET_PREFIX + connectionIdToDelete);
            logger.debug(`[ConnectionManager] Deleted connection with ID: ${connectionIdToDelete}`);

            const activeConnectionId: string | undefined = await getActiveConnectionId(context);
            if (activeConnectionId === connectionIdToDelete) {
                await setActiveConnectionId(context, undefined);
            }
        } else {
            logger.warn(`[ConnectionManager] Connection with ID ${connectionIdToDelete} not found for deletion.`);
        }
    } catch (error) {
        logger.error(`[ConnectionManager] Error deleting connection ${connectionIdToDelete}:`, error);
        vscode.window.showErrorMessage(`Failed to delete connection: ${(error as Error).message}`);
    }
}

/**
 * Retrieves the stored password for a given connection ID.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} connectionId The ID of the connection.
 * @returns A promise that resolves to the password string, or undefined if not found or an error occurs.
 */
export async function getPasswordForConnection(
    context: vscode.ExtensionContext,
    connectionId: string
): Promise<string | undefined> {
    try {
        const password: string | undefined = await context.secrets.get(
            StorageKeys.CONNECTION_PASSWORD_SECRET_PREFIX + connectionId
        );
        return password;
    } catch (error) {
        logger.error(`[ConnectionManager] Error retrieving password for connection ${connectionId}:`, error);
        return undefined;
    }
}

/**
 * Sets the ID of the currently active TestBench connection.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string | undefined} connectionId The ID of the connection to set as active, or undefined to clear the active connection.
 */
export async function setActiveConnectionId(
    context: vscode.ExtensionContext,
    connectionId: string | undefined
): Promise<void> {
    try {
        await context.globalState.update(StorageKeys.ACTIVE_CONNECTION_ID_KEY, connectionId);
        if (connectionId) {
            logger.debug(`[ConnectionManager] Active connection ID set to: ${connectionId}`);
        }
    } catch (error) {
        logger.error(`[ConnectionManager] Error setting active connection ID ${connectionId}:`, error);
    }
}

/**
 * Gets the ID of the currently active TestBench connection.
 * @param {vscode.ExtensionContext} context The extension context.
 * @returns {Promise<string | undefined>} A promise that resolves to the active connection ID string, or undefined if none is set.
 */
export async function getActiveConnectionId(context: vscode.ExtensionContext): Promise<string | undefined> {
    try {
        const activeId = context.globalState.get<string | undefined>(StorageKeys.ACTIVE_CONNECTION_ID_KEY);
        return activeId;
    } catch (error) {
        logger.error(`[ConnectionManager] Error retrieving active connection ID:`, error);
        return undefined;
    }
}

/**
 * Retrieves the full details of the currently active TestBench connection.
 * @param {vscode.ExtensionContext} context The extension context.
 * @returns {Promise<TestBenchConnection | undefined>} A promise that resolves to the TestBenchConnection object if an active connection is set and found, otherwise undefined.
 */
export async function getActiveConnection(context: vscode.ExtensionContext): Promise<TestBenchConnection | undefined> {
    try {
        const activeId: string | undefined = await getActiveConnectionId(context);
        if (activeId) {
            const connections: TestBenchConnection[] = await getConnections(context);
            const activeConnection: TestBenchConnection | undefined = connections.find((p) => p.id === activeId);
            if (activeConnection) {
                return activeConnection;
            } else {
                logger.warn(
                    `[ConnectionManager] Active connection ID ${activeId} set, but connection not found in storage. Clearing active ID.`
                );
                await setActiveConnectionId(context, undefined);
            }
        }
        logger.debug("[ConnectionManager] No active connection found.");
        return undefined;
    } catch (error) {
        logger.error(`[ConnectionManager] Error retrieving active connection details:`, error);
        return undefined;
    }
}

/**
 * Clears the currently set active connection.
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function clearActiveConnection(context: vscode.ExtensionContext): Promise<void> {
    await setActiveConnectionId(context, undefined);
}

/**
 * Checks if a connection with the given credentials (server, port, username) already exists.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} serverName The server name to check.
 * @param {number} portNumber The port number to check.
 * @param {string} username The username to check.
 * @returns {Promise<TestBenchConnection | undefined>} A promise that resolves to the existing TestBenchConnection if a duplicate is found, otherwise undefined.
 */
export async function findConnectionByCredentials(
    context: vscode.ExtensionContext,
    serverName: string,
    portNumber: number,
    username: string
): Promise<TestBenchConnection | undefined> {
    try {
        const connections: TestBenchConnection[] = await getConnections(context);
        for (const connection of connections) {
            if (
                connection.serverName.toLowerCase() === serverName.toLowerCase() &&
                connection.portNumber === portNumber &&
                connection.username.toLowerCase() === username.toLowerCase()
            ) {
                return connection;
            }
        }
        logger.debug(`[ConnectionManager] No existing connection found with the provided server/user.`);
        return undefined;
    } catch (error) {
        logger.error(`[ConnectionManager] Error checking for duplicate connection by server/user:`, error);
        return undefined;
    }
}

/**
 * Checks if a connection with the given label already exists.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} label The label to check.
 * @param {string} excludeConnectionId Optional connection ID to exclude from the check (Used for label editing in Login UI).
 * @returns {Promise<TestBenchConnection | undefined>} A promise that resolves to the existing TestBenchConnection if a duplicate is found, otherwise undefined.
 */
export async function findConnectionByLabel(
    context: vscode.ExtensionContext,
    label: string,
    excludeConnectionId?: string
): Promise<TestBenchConnection | undefined> {
    try {
        const connections: TestBenchConnection[] = await getConnections(context);
        const normalizedLabel = label.trim().toLowerCase();

        for (const connection of connections) {
            if (excludeConnectionId && connection.id === excludeConnectionId) {
                continue;
            }

            if (connection.label.trim().toLowerCase() === normalizedLabel) {
                return connection;
            }
        }

        logger.debug(`[ConnectionManager] No existing connection found with label: ${label}`);
        return undefined;
    } catch (error) {
        logger.error(`[ConnectionManager] Error checking for duplicate connection by label ${label}:`, error);
        return undefined;
    }
}

/**
 * Checks if the current connection matches the session and active connection.
 * @param currentConnection - The current connection to check.
 * @param session - The session to check.
 * @param activeConnection - The active connection to check.
 * @returns True if the current connection matches the session and active connection, false otherwise.
 */
export function isConnectionAlreadyActive(
    currentConnection: {
        getSessionToken(): string;
        getUsername(): string;
        getServerName(): string;
        getServerPort(): string;
    } | null,
    session: { accessToken: string },
    activeConnection: TestBenchConnection
): boolean {
    return !!(
        currentConnection &&
        currentConnection.getSessionToken() === session.accessToken &&
        currentConnection.getUsername() === activeConnection.username &&
        currentConnection.getServerName() === activeConnection.serverName &&
        currentConnection.getServerPort() === activeConnection.portNumber.toString()
    );
}
