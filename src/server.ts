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

/**
 * Validates prerequisites for initializing the language server.
 * @param {number} operationId The current operation ID for staleness checking.
 * @param {string} project The project name.
 * @param {string} tov The TOV name.
 * @returns {Promise<{ pythonPath: string; tbConnectionDetails: { serverName: string; serverPort: string; username: string; sessionToken: string } } | null>}
 * An object with pythonPath and tbConnectionDetails if prerequisites are met, otherwise null.
 * @private
 */
async function validateLsPrerequisites(
    operationId: number,
    project: string,
    tov: string
): Promise<{
    pythonPath: string;
    tbConnectionDetails: {
        serverName: string;
        serverPort: string;
        username: string;
        sessionToken: string;
    };
} | null> {
    logger.trace(`[validateLsPrerequisites - Op ${operationId}] Validating prerequisites for ${project}/${tov}.`);

    const pythonPath: string | undefined = await getInterpreterPath();
    if (!pythonPath) {
        logger.warn(
            `[validateLsPrerequisites - Op ${operationId}] Python interpreter path not found. LS will not be started for ${project}/${tov}.`
        );
        if (getCurrentLsOperationId() === operationId) {
            setLanguageClientInstance(undefined);
        }
        return null;
    }
    logger.info(`[validateLsPrerequisites - Op ${operationId}] Python path validated: ${pythonPath}.`);

    if (!connection) {
        logger.warn(
            `[validateLsPrerequisites - Op ${operationId}] No active TestBench connection. LS will not be started for ${project}/${tov}.`
        );
        if (getCurrentLsOperationId() === operationId) {
            setLanguageClientInstance(undefined);
        }
        return null;
    }
    const tbConnectionDetails = {
        serverName: connection.getServerName(),
        serverPort: connection.getServerPort(),
        username: connection.getUsername(),
        sessionToken: connection.getSessionToken()
    };
    logger.info(
        `[validateLsPrerequisites - Op ${operationId}] TestBench connection validated for server: ${tbConnectionDetails.serverName}.`
    );
    return { pythonPath, tbConnectionDetails };
}

/**
 * Builds the ServerOptions for the LanguageClient.
 * @param {string} pythonPath Path to the Python interpreter.
 * @param tbConnectionDetails Details of the TestBench connection.
 * @param {string} project The project name.
 * @param {string} tov The TOV name.
 * @returns {ServerOptions} The server options.
 * @private
 */
function buildServerOptions(
    pythonPath: string,
    tbConnectionDetails: { serverName: string; serverPort: string; username: string; sessionToken: string },
    project: string,
    tov: string
): ServerOptions {
    logger.trace(`[buildServerOptions] Building ServerOptions with Python: ${pythonPath}`);
    const { serverName, serverPort, username, sessionToken } = tbConnectionDetails;
    const commonArgs = [serverName || "", serverPort || "", username || "", sessionToken || "", project, tov || ""];

    return {
        run: {
            command: pythonPath,
            args: [LANGUAGE_SERVER_SCRIPT_PATH, ...commonArgs]
        },
        debug: {
            command: pythonPath,
            args: [LANGUAGE_SERVER_DEBUG_PATH, ...commonArgs]
        }
    };
}

/**
 * Builds the LanguageClientOptions for the LanguageClient.
 * @returns {LanguageClientOptions} The client options.
 * @private
 */
function buildClientOptions(): LanguageClientOptions {
    logger.trace("[buildClientOptions] Building ClientOptions.");
    return {
        documentSelector: [{ scheme: "file", language: "robotframework", pattern: "**/*.resource" }],
        synchronize: {
            fileEvents: [vscode.workspace.createFileSystemWatcher("**/*.resource", false, false)]
        },
        outputChannelName: "TestBench LS"
    };
}

/**
 * Starts the given language client, monitors for staleness, and sets up notifications.
 * @param {LanguageClient} newClient The LanguageClient instance to start.
 * @param {string} project The project name.
 * @param {string} tov The TOV name.
 * @param {number} operationId The current operation ID.
 * @throws Will throw an error if the client fails to start and the operation is current.
 * @private
 */
async function startAndMonitorClient(
    newClient: LanguageClient,
    project: string,
    tov: string,
    operationId: number
): Promise<void> {
    logger.info(`[startAndMonitorClient - Op ${operationId}] Attempting to start LS for ${project}/${tov}.`);
    try {
        await newClient.start();
        logger.info(`[startAndMonitorClient - Op ${operationId}] LS for ${project}/${tov} started successfully.`);

        if (getCurrentLsOperationId() !== operationId) {
            logger.warn(
                `[startAndMonitorClient - Op ${operationId}] LS for ${project}/${tov} started, but became stale (current is ${getCurrentLsOperationId()}). Stopping this LS.`
            );

            await newClient
                .stop()
                .catch((e) =>
                    logger.error(
                        `[startAndMonitorClient - Op ${operationId}] Error stopping stale (but started) client: ${(e as Error).message}`
                    )
                );
            await newClient
                .dispose()
                .catch((e) =>
                    logger.error(
                        `[startAndMonitorClient - Op ${operationId}] Error disposing stale (but started) client: ${(e as Error).message}`
                    )
                );
            if (getLanguageClientInstance() === newClient) {
                setLanguageClientInstance(undefined);
            }
            return;
        }

        const currentGlobalClient: LanguageClient | undefined = getLanguageClientInstance();
        if (currentGlobalClient === newClient) {
            logger.info(
                `[startAndMonitorClient - Op ${operationId}] Setting up notifications for LS ${project}/${tov}.`
            );
            currentGlobalClient.onNotification("custom/notification", (params) => {
                logger.info(
                    `[startAndMonitorClient - Op ${operationId}] Received custom notification: ${params.message}`
                );
                vscode.window.showInformationMessage(`TestBench LS: ${params.message}`);
            });
        } else {
            logger.warn(
                `[startAndMonitorClient - Op ${operationId}] LS for ${project}/${tov} started, but global client instance changed (current is for op ${getCurrentLsOperationId()}) before notification setup. This instance may be orphaned or soon replaced.`
            );
        }
    } catch (error) {
        const clientThatFailed: LanguageClient = newClient;
        const errorMessage: string = (error as Error).message;
        if (getCurrentLsOperationId() !== operationId) {
            logger.warn(
                `[startAndMonitorClient - Op ${operationId}] LS for ${project}/${tov} failed to start (likely superseded by Op ${getCurrentLsOperationId()}). Error: ${errorMessage}`
            );
        } else {
            logger.error(
                `[startAndMonitorClient - Op ${operationId}] Failed to start TestBench LS for Project: ${project}, TOV: ${tov}. Error: ${errorMessage}`,
                error
            );
            throw error;
        }

        if (getLanguageClientInstance() === clientThatFailed) {
            setLanguageClientInstance(undefined);
        }
        if (clientThatFailed && clientThatFailed.state !== State.Stopped) {
            logger.trace(`[startAndMonitorClient - Op ${operationId}] Disposing client that failed to start.`);
            await clientThatFailed
                .dispose()
                .catch((e) =>
                    logger.error(
                        `[startAndMonitorClient - Op ${operationId}] Error disposing client that failed to start: ${(e as Error).message}`
                    )
                );
        }
    }
}

/**
 * Initializes and starts the language server for a given project and TOV.
 * Manages the lifecycle of the LanguageClient instance, ensuring only one relevant client runs.
 * @param {string} project The project name.
 * @param {string} tov The TOV (Test Object Version) name.
 * @param {number} operationId A unique ID for this initialization attempt to handle concurrent requests.
 * @returns {Promise<void>}
 * @async
 */
export async function initializeLanguageServer(project: string, tov: string, operationId: number): Promise<void> {
    logger.info(
        `[initializeLanguageServer - Op ${operationId}] Initializing TestBench LS for Project: ${project}, TOV: ${tov}. Current global OpId: ${getCurrentLsOperationId()}`
    );

    if (getCurrentLsOperationId() !== operationId) {
        logger.warn(
            `[initializeLanguageServer - Op ${operationId}] Initialization for ${project}/${tov} is stale (current global OpId is ${getCurrentLsOperationId()}). Aborting.`
        );
        return;
    }

    const existingClient: LanguageClient | undefined = getLanguageClientInstance();
    if (existingClient && existingClient.state !== State.Stopped) {
        logger.warn(
            `[initializeLanguageServer - Op ${operationId}] Existing client found unexpectedly (State: ${existingClient.state}). Attempting to stop it before initializing new one for ${project}/${tov}.`
        );
        try {
            await stopLanguageClient(false);
            logger.info(
                `[initializeLanguageServer - Op ${operationId}] Successfully stopped unexpected existing client.`
            );
        } catch (e) {
            logger.error(
                `[initializeLanguageServer - Op ${operationId}] Error stopping unexpected existing client for ${project}/${tov}: ${(e as Error).message}`
            );
        }
    }

    if (getCurrentLsOperationId() !== operationId) {
        logger.warn(
            `[initializeLanguageServer - Op ${operationId}] Initialization for ${project}/${tov} became stale after attempting to stop prior client (current global OpId is ${getCurrentLsOperationId()}). Aborting.`
        );
        return;
    }

    const prerequisites = await validateLsPrerequisites(operationId, project, tov);
    if (!prerequisites) {
        return;
    }
    const { pythonPath, tbConnectionDetails } = prerequisites;

    const serverOptions: ServerOptions = buildServerOptions(pythonPath, tbConnectionDetails, project, tov);
    const clientOptions: LanguageClientOptions = buildClientOptions();

    const newClientInstance = new LanguageClient("testbench-ls", "TestBench LS", serverOptions, clientOptions);
    logger.info(
        `[LS Manager - Op ${operationId}] New LanguageClient instance created for ${project}/${tov}. ` + // [Source: 44]
            `PythonPath: ${pythonPath}, ServerName: ${tbConnectionDetails.serverName}, ServerPort: ${tbConnectionDetails.serverPort}, ` +
            `Username: ${tbConnectionDetails.username}, SessionToken: ${tbConnectionDetails.sessionToken ? "****" : "undefined"}, ` +
            `ScriptPath: ${LANGUAGE_SERVER_SCRIPT_PATH}, DebugPath: ${LANGUAGE_SERVER_DEBUG_PATH}`
    );
    logger.trace(
        `[LS Manager - Op ${operationId}] ClientOptions: DocumentSelector: ${JSON.stringify(clientOptions.documentSelector)}, OutputChannelName: ${clientOptions.outputChannelName}. Synchronize.fileEvents is configured.`
    );

    if (getCurrentLsOperationId() !== operationId) {
        logger.warn(
            `[initializeLanguageServer - Op ${operationId}] Initialization for ${project}/${tov} is stale before client assignment (current global OpId is ${getCurrentLsOperationId()}). Disposing newly created client without starting.`
        );

        await newClientInstance
            .dispose()
            .catch((e) =>
                logger.error(
                    `[initializeLanguageServer - Op ${operationId}] Error disposing unstarted client for stale op: ${(e as Error).message}`
                )
            );
        return;
    }

    logger.info(
        `[initializeLanguageServer - Op ${operationId}] Setting new client instance for ${project}/${tov} as the global client.`
    );
    setLanguageClientInstance(newClientInstance);
    await startAndMonitorClient(newClientInstance, project, tov, operationId);
}

/**
 * Stops the currently active language client.
 * @param {boolean} [isDeactivating=false] - True if the extension is deactivating, affects error re-throwing.
 * @returns {Promise<void>}
 * @async
 */
export async function stopLanguageClient(isDeactivating: boolean = false): Promise<void> {
    const clientToStop: LanguageClient | undefined = getLanguageClientInstance();
    logger.info(
        `[stopLanguageClient] Request to stop TestBench LS. Deactivating: ${isDeactivating}. Client present: ${!!clientToStop}. Client state: ${clientToStop?.state}`
    );

    if (!clientToStop) {
        logger.trace("[stopLanguageClient] No client instance to stop.");
        return;
    }

    if (getLanguageClientInstance() === clientToStop) {
        setLanguageClientInstance(undefined);
        logger.trace("[stopLanguageClient] Global client instance has been cleared.");
    } else {
        logger.warn(
            "[stopLanguageClient] Attempting to stop a client that is not the current global instance. This might be a stale client or an issue in lifecycle management."
        );
    }

    try {
        const state: State = clientToStop.state;
        logger.trace(`[stopLanguageClient] Client current state: ${state}.`);
        if (state === State.Starting) {
            logger.warn("[stopLanguageClient] Attempting to dispose a client that is currently starting.");
            await clientToStop.dispose();
            logger.info("[stopLanguageClient] Disposed of the client instance that was in a starting state.");
        } else if (state === State.Running) {
            logger.trace("[stopLanguageClient] Stopping currently running client.");
            await clientToStop.stop();
            logger.info("[stopLanguageClient] Client stopped successfully. Now disposing.");
            await clientToStop.dispose();
            logger.info("[stopLanguageClient] Client disposed after stopping.");
        } else if (state === State.Stopped) {
            logger.trace("[stopLanguageClient] Client is already stopped. Disposing.");
            await clientToStop.dispose();
            logger.info("[stopLanguageClient] Client disposed (was already stopped).");
        } else {
            logger.warn(
                `[stopLanguageClient] Client is in an unexpected state: ${state}. Attempting dispose directly.`
            );
            await clientToStop.dispose();
            logger.info(`[stopLanguageClient] Disposed client from unexpected state ${state}.`);
        }
    } catch (error: any) {
        const errorMessage: string = error.message || String(error);
        logger.error(`[stopLanguageClient] Error stopping/disposing language client: ${errorMessage}`, error);

        const nonFatalErrorMessages: string[] = [
            "Client is not running",
            "Client is not stopping",
            "Client is already stopping",
            "already disposed"
        ];
        if (
            clientToStop &&
            clientToStop.state !== State.Stopped &&
            !nonFatalErrorMessages.some((msg) => errorMessage.includes(msg))
        ) {
            try {
                logger.warn(
                    `[stopLanguageClient] Attempting final dispose for client in state: ${clientToStop.state} after error: ${errorMessage}.`
                );
                await clientToStop.dispose();
                logger.info(`[stopLanguageClient] Final dispose attempt completed after error.`);
            } catch (disposeError: any) {
                logger.error(
                    `[stopLanguageClient] Error during final dispose attempt after initial error: ${disposeError.message}`
                );
            }
        }

        const shouldRethrow: boolean =
            !isDeactivating &&
            !nonFatalErrorMessages.some((msg) => errorMessage.includes(msg)) &&
            getCurrentLsOperationId() === latestLsContextRequestId;

        if (shouldRethrow) {
            logger.error(
                `[stopLanguageClient] Re-throwing error as it occurred during an active, non-deactivating operation: ${errorMessage}`
            );
            throw error;
        } else if (!isDeactivating && !nonFatalErrorMessages.some((msg) => errorMessage.includes(msg))) {
            logger.warn(
                `[stopLanguageClient] Suppressed re-throw for error on stale operation (current OpId: ${getCurrentLsOperationId()}, latest OpId: ${latestLsContextRequestId}): ${errorMessage}`
            );
        } else {
            logger.info(
                `[stopLanguageClient] Error not re-thrown. Deactivating: ${isDeactivating}, Message: ${errorMessage}`
            );
        }
    } finally {
        logger.info(`[stopLanguageClient] stopLanguageClient for client (State was ${clientToStop?.state}) finished.`);
    }
}

/**
 * Asynchronously restarts the language client for a given project and TOV name.
 * This function implements a debouncing mechanism to handle rapid sequential requests,
 * ensuring that only the most recent restart request is processed. It stops any
 * existing language client instance before initializing a new one.
 * @param {string} projectName The name of the project context for the language server.
 * @param {string} tovName - The name of the TOV context for the language server.
 * @returns {Promise<void>} A promise that resolves when the restart operation is complete or cancelled.
 * @async
 */
export async function restartLanguageClient(projectName: string, tovName: string): Promise<void> {
    const thisOperationId: number = ++latestLsContextRequestId;
    setCurrentLsOperationId(thisOperationId);
    logger.info(
        `[LS Restart - Op ${thisOperationId}] Requested for ${projectName}/${tovName}. Global OpId set to ${thisOperationId}.`
    );

    // Debounce slightly to allow any other immediate requests to also update latestLsContextRequestId
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (getCurrentLsOperationId() !== thisOperationId) {
        logger.warn(
            `[LS Restart - Op ${thisOperationId}] Stale immediately. Newer request ${getCurrentLsOperationId()} exists. Aborting restart for ${projectName}/${tovName}.`
        );
        return;
    }

    logger.info(`[LS Restart - Op ${thisOperationId}] Proceeding for ${projectName}/${tovName}.`);
    try {
        logger.trace(`[LS Restart - Op ${thisOperationId}] Stopping any existing language client.`);
        await stopLanguageClient();
        logger.info(`[LS Restart - Op ${thisOperationId}] Previous client stopped (if any).`);

        if (getCurrentLsOperationId() !== thisOperationId) {
            logger.warn(
                `[LS Restart - Op ${thisOperationId}] Stale after stopping old client. Newer request ${getCurrentLsOperationId()} exists. Aborting start for ${projectName}/${tovName}.`
            );
            return;
        }

        logger.trace(`[LS Restart - Op ${thisOperationId}] Initializing new client for ${projectName}/${tovName}.`);
        await initializeLanguageServer(projectName, tovName, thisOperationId);
        logger.info(
            `[LS Restart - Op ${thisOperationId}] LS successfully restarted/initialized for ${projectName}/${tovName}.`
        );
    } catch (error) {
        const errorMessage: string = (error as Error).message;
        if (getCurrentLsOperationId() === thisOperationId) {
            // This error is for the current, active operation
            logger.error(
                `[LS Restart - Op ${thisOperationId}] Error during language client management for ${projectName}/${tovName}: ${errorMessage}`,
                error
            );
            vscode.window.showErrorMessage(`Failed to update Language Server context for ${tovName}: ${errorMessage}`);
        } else {
            // This error is for an outdated operation
            logger.warn(
                `[LS Restart - Op ${thisOperationId}] Error caught for an outdated/cancelled operation for ${projectName}/${tovName} (current OpId ${getCurrentLsOperationId()}). Error: ${errorMessage}`,
                error
            );
        }
    } finally {
        logger.info(`[LS Restart - Op ${thisOperationId}] Management for ${projectName}/${tovName} finished.`);
    }
}
