import * as vscode from "vscode";
import { LANGUAGE_SERVER_SCRIPT_PATH, LANGUAGE_SERVER_DEBUG_PATH } from "./constants";
import { getInterpreterPath } from "./python";
import { LanguageClient, LanguageClientOptions, ServerOptions, State } from "vscode-languageclient/node";
import { connection, logger } from "./extension";

export let client: LanguageClient | undefined;

// Variables to prioritize the latest request (Project tree view selection change event)
export let latestLsContextRequestId: number = 0;
export let currentLsOperationId: number = 0;

export function getLatestLsContextRequestId(): number {
    return latestLsContextRequestId;
}

export function setLatestLsContextRequestId(value: number): void {
    latestLsContextRequestId = value;
}

export function getCurrentLsOperationId(): number {
    return currentLsOperationId;
}

export function setCurrentLsOperationId(value: number): void {
    currentLsOperationId = value;
}

export async function initializeLanguageServer(project: string, tov: string): Promise<void> {
    logger.info(`[initializeLanguageServer] Initializing TestBench LS for Project: ${project}, TOV: ${tov}`);
    if (client) {
        logger.warn(
            "[initializeLanguageServer] Existing client found before initialization. Attempting to dispose it."
        );
        try {
            await stopLanguageClient();
        } catch (e) {
            logger.error("[initializeLanguageServer] Error disposing lingering client", e);
        }
        client = undefined;
    }

    const pythonPath: string | undefined = await getInterpreterPath();
    if (!pythonPath) {
        logger.warn(
            "[initializeLanguageServer] Python interpreter path not found. Language Server will not be started. Please ensure Python is configured correctly."
        );
        return;
    }
    if (!connection) {
        logger.info(
            "[initializeLanguageServer] No active TestBench connection. Language Server will not be started yet."
        );
        return;
    }
    const serverName: string = connection.getServerName();
    const serverPort: string = connection.getServerPort();
    const username: string = connection.getUsername();
    const sessionToken: string = connection.getSessionToken();
    const serverOptions: ServerOptions = {
        run: {
            command: pythonPath,
            args: [
                LANGUAGE_SERVER_SCRIPT_PATH,
                serverName || "",
                serverPort || "",
                username || "",
                sessionToken || "",
                project,
                tov || ""
            ]
        },
        debug: {
            command: pythonPath,
            args: [
                LANGUAGE_SERVER_DEBUG_PATH,
                serverName || "",
                serverPort || "",
                username || "",
                sessionToken || "",
                project,
                tov || ""
            ]
        }
        // debug: { command: pythonPath, args: ["-m", "testbench_ls", "--debug"] },
    };
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "robotframework", pattern: "**/*.resource" }],
        synchronize: {
            fileEvents: [vscode.workspace.createFileSystemWatcher("**/*.resource", false, false)]
        }
    };
    client = new LanguageClient("testbench-ls", "TestBench LS", serverOptions, clientOptions);
    logger.info(
        `[initializeLanguageServer] Starting TestBench LS with parameters - Project: ${project}, TOV: ${tov}, PythonPath: ${pythonPath}, ServerName: ${serverName}, ServerPort: ${serverPort}, Username: ${username}, SessionToken: ${sessionToken ? "****" : "undefined"}, ScriptPath: ${LANGUAGE_SERVER_SCRIPT_PATH}, DebugPath: ${LANGUAGE_SERVER_DEBUG_PATH}, ClientOptions: ${JSON.stringify(clientOptions)}`
    );
    try {
        await client.start();
        client.onNotification("custom/notification", (params) => {
            vscode.window.showInformationMessage(`${params.message}`);
        });
    } catch (error) {
        logger.error(
            `[initializeLanguageServer] Failed to start TestBench LS for Project: ${project}, TOV: ${tov}:`,
            error
        );
        logger.error(
            `[initializeLanguageServer] LS Init Params: pythonPath: ${pythonPath}, serverName: ${serverName}, serverPort: ${serverPort}, username: ${username}, sessionToken: ${sessionToken ? "****" : "undefined"}, project: ${project}, tov: ${tov}, scriptPath: ${LANGUAGE_SERVER_SCRIPT_PATH}, debugPath: ${LANGUAGE_SERVER_DEBUG_PATH}, clientOptions: ${JSON.stringify(
                clientOptions
            )}`
        );
        client = undefined;
        throw error;
    }
}

export async function stopLanguageClient(isDeactivating: boolean = false): Promise<void> {
    logger.info(`[stopLanguageClient] Stopping TestBench LS. Deactivating: ${isDeactivating}.`);
    if (!client) {
        logger.trace("[stopLanguageClient] No client instance to stop.");
        return;
    }

    try {
        if (client.state === State.Starting) {
            logger.warn(
                "[stopLanguageClient] Attempting to stop a client that is currently starting. This might take a moment or require a future explicit stop if it proceeds to run."
            );

            if (!isDeactivating) {
                logger.info(
                    "[stopLanguageClient] Client is starting. It will be replaced by the new instance if initialization proceeds."
                );

                const oldStartingClient: LanguageClient = client;
                client = undefined;

                if (oldStartingClient && oldStartingClient.state !== State.Stopped) {
                    oldStartingClient.dispose();
                    logger.trace(
                        "[stopLanguageClient] Disposed of the client instance that was in a starting/running state."
                    );
                }
                return;
            } else {
                await client.dispose();
                logger.info("[stopLanguageClient] Client disposed during deactivation.");
                client = undefined;
                return;
            }
        }

        if (client.state === State.Running) {
            logger.trace("[stopLanguageClient] Stopping currently running client.");
            await client.stop();
            logger.trace("[stopLanguageClient] Client stopped successfully.");
            client.dispose();
            client = undefined;
        } else if (client.state === State.Stopped) {
            logger.trace("[stopLanguageClient] Client is already stopped.");
            client.dispose();
            client = undefined;
        }
    } catch (error: any) {
        logger.error(`[stopLanguageClient] Error stopping/disposing language client: ${error.message}`, error);

        if (client) {
            try {
                client.dispose();
            } catch (disposeError) {
                logger.error(`[stopLanguageClient] Error disposing client after a stop error: ${disposeError}`);
            }
            client = undefined;
        }
        if (!isDeactivating) {
            throw error;
        }
    }
}

/**
 * Asynchronously restarts the language client for a given project and TOV name.
 *
 * This function implements a debouncing mechanism to handle rapid sequential requests,
 * ensuring that only the most recent restart request is processed. It stops any
 * existing language client instance before initializing a new one with the specified
 * project and TOV context.
 *
 * @param {string} projectName The name of the project context for the language server.
 * @param {string} tovName - The name of the TOV context for the language server.
 * @returns A promise that resolves when the restart operation (or its cancellation due to a newer request) is complete.
 */
export async function restartLanguageClient(projectName: string, tovName: string): Promise<void> {
    const thisOperationId = ++latestLsContextRequestId;
    currentLsOperationId = thisOperationId;

    logger.trace(`[RestartLS] Request ${thisOperationId}: Queueing LS restart for ${projectName}/${tovName}`);

    // Check if this operation is still the latest one the user requested.
    if (currentLsOperationId !== thisOperationId) {
        logger.trace(
            `[RestartLS] Request ${thisOperationId}: Stale after debounce. Newer request ${currentLsOperationId} exists. Aborting.`
        );
        return; // A newer request came in during the debounce period.
    }

    try {
        logger.info(`[RestartLS] Request ${thisOperationId}: Proceeding for ${projectName}/${tovName}`);
        await stopLanguageClient();

        if (currentLsOperationId !== thisOperationId) {
            logger.trace(
                `[RestartLS] Request ${thisOperationId}: Stale after stopping old client. Newer request ${currentLsOperationId} exists. Aborting start.`
            );
            return;
        }

        logger.trace(`[RestartLS] Request ${thisOperationId}: Initializing new client for ${projectName}/${tovName}`);
        await initializeLanguageServer(projectName, tovName);
        logger.info(
            `[RestartLS] Request ${thisOperationId}: LS successfully restarted/initialized for ${projectName}/${tovName}`
        );
    } catch (error) {
        if (currentLsOperationId === thisOperationId) {
            logger.error(
                `[RestartLS] Request ${thisOperationId}: Error during language client management for ${projectName}/${tovName}:`,
                error
            );
            vscode.window.showErrorMessage(
                `Failed to update Language Server context for ${tovName}: ${(error as Error).message}`
            );
        } else {
            logger.warn(
                `[RestartLS] Request ${thisOperationId}: Error occurred in an outdated/cancelled operation for ${projectName}/${tovName}. Error:`,
                error
            );
        }
    }
}
