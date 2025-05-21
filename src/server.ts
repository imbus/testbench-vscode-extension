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

function getLanguageClientInstance(): LanguageClient | undefined {
    return client;
}

function setLanguageClientInstance(newInstance: LanguageClient | undefined): void {
    client = newInstance;
}

export async function initializeLanguageServer(project: string, tov: string, operationId: number): Promise<void> {
    logger.info(
        `[initializeLanguageServer] Operation ID ${operationId}: Initializing TestBench LS for Project: ${project}, TOV: ${tov}`
    );

    if (getCurrentLsOperationId() !== operationId) {
        logger.warn(
            `[initializeLanguageServer] Operation ID ${operationId} for ${project}/${tov} is stale (current is ${getCurrentLsOperationId()}). Aborting initialization.`
        );
        return;
    }

    const existingClient = getLanguageClientInstance();
    if (existingClient && existingClient.state !== State.Stopped) {
        logger.warn(
            `[initializeLanguageServer] Operation ID ${operationId}: Existing client found unexpectedly. Attempting to stop it.`
        );
        await stopLanguageClient(false).catch((e) =>
            logger.error(
                `[initializeLanguageServer] Error stopping unexpected existing client for Op ${operationId}: ${e.message}`
            )
        );
    }
    if (getCurrentLsOperationId() !== operationId) {
        logger.warn(
            `[initializeLanguageServer] Operation ID ${operationId} for ${project}/${tov} became stale after attempting to stop prior client. Aborting.`
        );
        return;
    }

    const pythonPath: string | undefined = await getInterpreterPath();
    if (!pythonPath) {
        logger.warn(
            `[initializeLanguageServer] Operation ID ${operationId}: Python interpreter path not found. LS will not be started.`
        );
        if (getCurrentLsOperationId() === operationId) {
            setLanguageClientInstance(undefined);
        }
        return;
    }
    if (!connection) {
        logger.info(
            `[initializeLanguageServer] Operation ID ${operationId}: No active TestBench connection. LS will not be started.`
        );
        if (getCurrentLsOperationId() === operationId) {
            setLanguageClientInstance(undefined);
        }
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

    const newClientInstance = new LanguageClient("testbench-ls", "TestBench LS", serverOptions, clientOptions);
    logger.info(
        `[initializeLanguageServer] Operation ID ${operationId}: Starting TestBench LS with parameters - Project: ${project}, TOV: ${tov}, PythonPath: ${pythonPath}, ServerName: ${serverName}, ServerPort: ${serverPort}, Username: ${username}, SessionToken: ${sessionToken ? "****" : "undefined"}, ScriptPath: ${LANGUAGE_SERVER_SCRIPT_PATH}, DebugPath: ${LANGUAGE_SERVER_DEBUG_PATH}, ClientOptions: ${JSON.stringify(clientOptions)}`
    );

    if (getCurrentLsOperationId() !== operationId) {
        logger.warn(
            `[initializeLanguageServer] Operation ID ${operationId} for ${project}/${tov} is stale before client assignment (current is ${getCurrentLsOperationId()}). Disposing newly created client without starting.`
        );
        await newClientInstance
            .dispose()
            .catch((e) =>
                logger.error(
                    `[initializeLanguageServer] Error disposing unstarted client for stale op ${operationId}: ${e.message}`
                )
            );
        return;
    }
    setLanguageClientInstance(newClientInstance);

    try {
        await newClientInstance.start();
        logger.info(
            `[initializeLanguageServer] Operation ID ${operationId}: LS for ${project}/${tov} started successfully.`
        );

        if (getCurrentLsOperationId() !== operationId) {
            logger.warn(
                `[initializeLanguageServer] Operation ID ${operationId} for ${project}/${tov} started, but became stale (current is ${getCurrentLsOperationId()}). Stopping this LS.`
            );
            await newClientInstance
                .stop()
                .catch((e) =>
                    logger.error(
                        `[initializeLanguageServer] Error stopping stale (but started) client for op ${operationId}: ${e.message}`
                    )
                );
            await newClientInstance
                .dispose()
                .catch((e) =>
                    logger.error(
                        `[initializeLanguageServer] Error disposing stale (but started) client for op ${operationId}: ${e.message}`
                    )
                );
            if (getLanguageClientInstance() === newClientInstance) {
                setLanguageClientInstance(undefined);
            }
        } else {
            const currentGlobalClient = getLanguageClientInstance();
            if (currentGlobalClient === newClientInstance) {
                currentGlobalClient.onNotification("custom/notification", (params) => {
                    vscode.window.showInformationMessage(`${params.message}`);
                });
            } else {
                logger.warn(
                    `[initializeLanguageServer] Operation ID ${operationId}: Client for ${project}/${tov} started but global client changed before notification setup. Global client is for op ${getCurrentLsOperationId()}.`
                );
            }
        }
    } catch (error) {
        const clientThatFailed = newClientInstance;

        if (getCurrentLsOperationId() !== operationId) {
            logger.warn(
                `[initializeLanguageServer] Operation ID ${operationId} for ${project}/${tov} failed to start (likely superseded by ${getCurrentLsOperationId()}). Error: ${(error as Error).message}`
            );
        } else {
            logger.error(
                `[initializeLanguageServer] Operation ID ${operationId}: Failed to start TestBench LS for Project: ${project}, TOV: ${tov}:`,
                error
            );
            logger.error(
                `[initializeLanguageServer] Operation ID ${operationId}: Error message: ${(error as Error).message}`
            );
            throw error;
        }

        if (getLanguageClientInstance() === clientThatFailed) {
            setLanguageClientInstance(undefined);
        }
        if (clientThatFailed && clientThatFailed.state !== State.Stopped) {
            await clientThatFailed
                .dispose()
                .catch((e) =>
                    logger.error(
                        `[initializeLanguageServer] Error disposing client that failed to start for op ${operationId}: ${e.message}`
                    )
                );
        }
    }
}

export async function stopLanguageClient(isDeactivating: boolean = false): Promise<void> {
    const clientToStop = getLanguageClientInstance();
    logger.info(`[stopLanguageClient] Stopping TestBench LS. Deactivating: ${isDeactivating}.`);

    if (!clientToStop) {
        logger.trace("[stopLanguageClient] No client instance to stop.");
        return;
    }

    if (getLanguageClientInstance() === clientToStop) {
        setLanguageClientInstance(undefined);
    }

    try {
        if (clientToStop.state === State.Starting) {
            logger.warn("[stopLanguageClient] Attempting to dispose a client that is currently starting.");
            await clientToStop.dispose();
            logger.trace("[stopLanguageClient] Disposed of the client instance that was in a starting state.");
            return;
        }

        if (clientToStop.state === State.Running) {
            logger.trace("[stopLanguageClient] Stopping currently running client.");
            await clientToStop.stop();
            logger.trace("[stopLanguageClient] Client stopped successfully.");
        }
        if (clientToStop.state === State.Stopped) {
            logger.trace("[stopLanguageClient] Client is stopped. Disposing.");
            await clientToStop.dispose();
            logger.trace("[stopLanguageClient] Client disposed.");
        }
    } catch (error: any) {
        const errorMessage = error.message || String(error);
        logger.error(`[stopLanguageClient] Error stopping/disposing language client: ${errorMessage}`, error);
        if (
            clientToStop &&
            clientToStop.state !== State.Stopped &&
            !errorMessage.includes("Client is not running") &&
            !errorMessage.includes("Client is not stopping")
        ) {
            try {
                logger.trace(
                    `[stopLanguageClient] Attempting final dispose for client in state: ${clientToStop.state}`
                );
                await clientToStop.dispose();
            } catch (disposeError: any) {
                logger.error(`[stopLanguageClient] Error during final dispose attempt: ${disposeError.message}`);
            }
        }
        if (
            !isDeactivating &&
            !(
                errorMessage.includes("Client is not running") ||
                errorMessage.includes("Client is not stopping") ||
                errorMessage.includes("Client is already stopping")
            )
        ) {
            if (getCurrentLsOperationId() === latestLsContextRequestId) {
                throw error;
            } else {
                logger.warn(`[stopLanguageClient] Suppressed re-throw for error on stale operation: ${errorMessage}`);
            }
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
    setCurrentLsOperationId(thisOperationId);
    logger.trace(`[RestartLS] Request ${thisOperationId}: Queueing LS restart for ${projectName}/${tovName}`);

    if (getCurrentLsOperationId() !== thisOperationId) {
        logger.trace(
            `[RestartLS] Request ${thisOperationId}: Stale immediately. Newer request ${getCurrentLsOperationId()} exists. Aborting.`
        );
        return;
    }

    try {
        logger.info(`[RestartLS] Request ${thisOperationId}: Proceeding for ${projectName}/${tovName}`);
        await stopLanguageClient();

        if (getCurrentLsOperationId() !== thisOperationId) {
            logger.trace(
                `[RestartLS] Request ${thisOperationId}: Stale after stopping old client. Newer request ${getCurrentLsOperationId()} exists. Aborting start.`
            );
            return;
        }

        logger.trace(`[RestartLS] Request ${thisOperationId}: Initializing new client for ${projectName}/${tovName}`);
        await initializeLanguageServer(projectName, tovName, thisOperationId);
        logger.info(
            `[RestartLS] Request ${thisOperationId}: LS successfully restarted/initialized for ${projectName}/${tovName}`
        );
    } catch (error) {
        if (getCurrentLsOperationId() === thisOperationId) {
            logger.error(
                `[RestartLS] Request ${thisOperationId}: Error during language client management for ${projectName}/${tovName}:`,
                error
            );
            vscode.window.showErrorMessage(
                `Failed to update Language Server context for ${tovName}: ${(error as Error).message}`
            );
        } else {
            logger.warn(
                `[RestartLS] Request ${thisOperationId}: Error caught in restartLanguageClient for an outdated/cancelled operation for ${projectName}/${tovName}. Error:`,
                error
            );
        }
    }
}
