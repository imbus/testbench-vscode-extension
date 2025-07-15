import * as vscode from "vscode";
import { LANGUAGE_SERVER_SCRIPT_PATH, LANGUAGE_SERVER_DEBUG_PATH } from "./constants";
import { getInterpreterPath } from "./python";
import { LanguageClient, LanguageClientOptions, ServerOptions, State } from "vscode-languageclient/node";
import { connection, logger } from "./extension";

interface TbConnectionDetails {
    serverName: string;
    serverPort: string;
    username: string;
    sessionToken: string;
}

interface LsPrerequisites {
    pythonPath: string;
    tbConnectionDetails: TbConnectionDetails;
}

interface PendingOperation {
    projectName: string;
    tovName: string;
    operationId: number;
}

// Global state management
export let client: LanguageClient | undefined;
export let latestLsContextRequestId: number = 0;
export let currentLsOperationId: number = 0;
let virtualDocumentContent = "";
const virtualDocumentScheme = "virtualdiff";
const onVirtualDocumentChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
const virtualDocumentProvider: vscode.TextDocumentContentProvider = {
    onDidChange: onVirtualDocumentChangeEmitter.event,
    provideTextDocumentContent(uri: vscode.Uri): string {
        // uri parameter is required by VS Code API but not used in this implementation
        void uri;
        return virtualDocumentContent;
    }
};

// State management for race condition prevention
let isLanguageServerBusy: boolean = false;
let pendingRestartParams: PendingOperation | null = null;
let restartTimeout: NodeJS.Timeout | null = null;

// Configuration constants
const RESTART_DEBOUNCE_MS = 300;
const CLIENT_START_TIMEOUT_MS = 30000;
const CLIENT_STOP_TIMEOUT_MS = 5000;
const CLIENT_DISPOSE_TIMEOUT_MS = 3000;
const STARTING_STATE_WAIT_MS = 1000;

// Getter and setter functions for global state
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

export function getLanguageClientInstance(): LanguageClient | undefined {
    return client;
}

function setLanguageClientInstance(newInstance: LanguageClient | undefined): void {
    client = newInstance;
}

/**
 * Checks if the current operation is still valid (not superseded by a newer operation)
 * by comparing the operation ID with the global current operation ID.
 * @param operationId The ID of the operation to check
 * @return True if the operation is current, false if it has been superseded
 */
function isOperationCurrent(operationId: number): boolean {
    return getCurrentLsOperationId() === operationId;
}

/**
 * Clears any pending restart timeout
 */
function clearPendingRestart(): void {
    if (restartTimeout) {
        clearTimeout(restartTimeout);
        restartTimeout = null;
    }
    pendingRestartParams = null;
}

/**
 * Creates a promise that times out after the specified duration.
 * If the timeout occurs, it rejects with an error indicating the operation name and duration.
 * @param timeoutMs The timeout duration in milliseconds
 * @param operationName A name for the operation, used in error messages
 * @return A promise that rejects with a timeout error after the specified duration
 */
function createTimeoutPromise(timeoutMs: number, operationName: string): Promise<never> {
    return new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${operationName} timeout after ${timeoutMs}ms`)), timeoutMs)
    );
}

/**
 * Wraps an async operation with timeout protection
 * If the operation does not complete within the specified timeout,
 * it rejects with a timeout error.
 * @param operation The async operation to execute
 * @param timeoutMs The timeout duration in milliseconds
 * @param operationName A descriptive name for the operation, used in error messages
 * @return A promise that resolves with the operation result or rejects with a timeout error
 */
async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    return Promise.race([operation(), createTimeoutPromise(timeoutMs, operationName)]);
}

/**
 * Validates prerequisites for initializing the language server.
 * @param operationId The current operation ID for staleness checking
 * @param project The project name
 * @param tov The TOV name
 * @returns Promise resolving to prerequisites object or null if validation fails
 */
async function validateLsPrerequisites(
    operationId: number,
    project: string,
    tov: string
): Promise<LsPrerequisites | null> {
    logger.trace(`[validateLsPrerequisites - Op ${operationId}] Validating prerequisites for ${project}/${tov}.`);

    const pythonPath = await validatePythonInterpreter(operationId, project, tov);
    if (!pythonPath) {
        return null;
    }

    const tbConnectionDetails = await validateTestBenchConnection(operationId, project, tov);
    if (!tbConnectionDetails) {
        return null;
    }

    logger.info(
        `[validateLsPrerequisites - Op ${operationId}] Prerequisites validated for ${project}/${tov}. ` +
            `Python: ${pythonPath}, Server: ${tbConnectionDetails.serverName}`
    );

    return { pythonPath, tbConnectionDetails };
}

/**
 * Validates the Python interpreter path.
 * Logs a warning and potentially resets the language client if the path is not found.
 *
 * @param operationId - The unique identifier for the operation.
 * @param projectName - The name of the project.
 * @param tovName - The name of the TOV.
 * @returns A promise that resolves to the Python interpreter path if found, otherwise null.
 */
async function validatePythonInterpreter(
    operationId: number,
    projectName: string,
    tovName: string
): Promise<string | null> {
    const pythonPath = await getInterpreterPath();
    if (!pythonPath) {
        logger.warn(
            `[validateLsPrerequisites - Op ${operationId}] Python interpreter path not found. ` +
                `LS will not be started for ${projectName}/${tovName}.`
        );
        if (isOperationCurrent(operationId)) {
            setLanguageClientInstance(undefined);
        }
        return null;
    }

    logger.info(`[validateLsPrerequisites - Op ${operationId}] Python path validated: ${pythonPath}.`);
    return pythonPath;
}

/**
 * Validates the active TestBench connection.
 *
 * @param operationId - The unique identifier for the current operation.
 * @param projectName - The name of the project.
 * @param tovName - The name of the TOV.
 * @returns The TestBench connection details if a connection is active, otherwise null.
 */
async function validateTestBenchConnection(
    operationId: number,
    projectName: string,
    tovName: string
): Promise<TbConnectionDetails | null> {
    if (!connection) {
        logger.warn(
            `[validateLsPrerequisites - Op ${operationId}] No active TestBench connection. ` +
                `LS will not be started for ${projectName}/${tovName}.`
        );
        if (isOperationCurrent(operationId)) {
            setLanguageClientInstance(undefined);
        }
        return null;
    }

    const tbConnectionDetails: TbConnectionDetails = {
        serverName: connection.getServerName(),
        serverPort: connection.getServerPort(),
        username: connection.getUsername(),
        sessionToken: connection.getSessionToken()
    };

    logger.info(
        `[validateLsPrerequisites - Op ${operationId}] TestBench connection validated for server: ${tbConnectionDetails.serverName}.`
    );

    return tbConnectionDetails;
}

/**
 * Constructs server options for starting the language server.
 *
 * @param pythonPath - The path to the Python executable.
 * @param tbConnectionDetails - Details required to connect to the server.
 * @param projectName - The name of the project.
 * @param tovName - The name of the TOV.
 * @returns ServerOptions configured for both run and debug modes.
 */
function buildServerOptions(
    pythonPath: string,
    tbConnectionDetails: TbConnectionDetails,
    projectName: string,
    tovName: string
): ServerOptions {
    logger.trace(`[buildServerOptions] Building ServerOptions with Python: ${pythonPath}`);

    const { serverName, serverPort, username, sessionToken } = tbConnectionDetails;
    const commonArgs = [
        serverName || "",
        serverPort || "",
        username || "",
        sessionToken || "",
        projectName,
        tovName || ""
    ];

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
 * Builds `LanguageClientOptions` for the TestBench language client.
 *
 * @returns The configured `LanguageClientOptions`.
 */
function buildClientOptions(): LanguageClientOptions {
    logger.trace("[buildClientOptions] Building ClientOptions.");

    return {
        documentSelector: [
            {
                scheme: "file",
                language: "robotframework",
                pattern: "**/*.resource"
            }
        ],
        synchronize: {
            fileEvents: [vscode.workspace.createFileSystemWatcher("**/*.resource", false, false)]
        },
        outputChannelName: "TestBench LS"
    };
}

/**
 * Safely disposes of a LanguageClient instance, handling potential timeouts and errors.
 *
 * @param client - The LanguageClient to dispose.
 * @param operationId - An identifier for the operation, used in logging.
 * @param context - A string describing the context of the disposal, used in logging.
 * @returns A promise that resolves when the disposal attempt is complete.
 *          Disposal errors are caught and logged, but not re-thrown.
 */
async function safeClientDispose(client: LanguageClient, operationId: number, context: string): Promise<void> {
    try {
        await withTimeout(() => client.dispose(), CLIENT_DISPOSE_TIMEOUT_MS, `Client disposal (${context})`);
        logger.info(`[safeClientDispose - Op ${operationId}] Client disposed successfully (${context}).`);
    } catch (error) {
        const errorMessage = (error as Error).message;
        logger.warn(`[safeClientDispose - Op ${operationId}] Disposal error (${context}): ${errorMessage}`);
        // Don't throw - disposal errors are typically non-fatal
    }
}

/**
 * Attempts to stop the language client within a predefined timeout.
 * Errors encountered during the stop operation are caught and logged, but not re-thrown.
 *
 * @param client The LanguageClient instance to stop.
 * @param operationId An identifier for the current operation, used for logging.
 * @param context A string providing context for the stop operation, used in log messages.
 * @returns A promise that resolves once the stop attempt (including handling any errors or timeouts) is complete.
 */
async function safeClientStop(client: LanguageClient, operationId: number, context: string): Promise<void> {
    try {
        await withTimeout(() => client.stop(), CLIENT_STOP_TIMEOUT_MS, `Client stop (${context})`);
        logger.info(`[safeClientStop - Op ${operationId}] Client stopped successfully (${context}).`);
    } catch (error) {
        const errorMessage = (error as Error).message;
        logger.warn(`[safeClientStop - Op ${operationId}] Stop error (${context}): ${errorMessage}`);
        // Continue to disposal even if stop failed
    }
}

/**
 * Handles a language client based on its current state, performing actions like stopping or disposing.
 *
 * @param clientToStop - The language client to manage.
 * @param operationId - An identifier for the operation, used for logging.
 * @returns A promise that resolves when the client has been handled.
 */
async function handleClientByState(clientToStop: LanguageClient, operationId: number): Promise<void> {
    const state = clientToStop.state;
    logger.trace(`[stopLanguageClient - Op ${operationId}] Client current state: ${state}.`);

    switch (state) {
        case State.Starting:
            logger.warn(
                `[stopLanguageClient - Op ${operationId}] Client is starting. Waiting briefly before disposal.`
            );
            // Wait briefly for starting to complete, then dispose
            await new Promise((resolve) => setTimeout(resolve, STARTING_STATE_WAIT_MS));
            await safeClientDispose(clientToStop, operationId, "starting state");
            break;

        case State.Running:
            logger.trace(`[stopLanguageClient - Op ${operationId}] Stopping currently running client.`);
            await safeClientStop(clientToStop, operationId, "running state");
            await safeClientDispose(clientToStop, operationId, "after stop");
            break;

        case State.Stopped:
            logger.trace(`[stopLanguageClient - Op ${operationId}] Client is already stopped. Disposing.`);
            await safeClientDispose(clientToStop, operationId, "already stopped");
            break;

        default:
            logger.warn(
                `[stopLanguageClient - Op ${operationId}] Client in unexpected state: ${state}. Force disposing.`
            );
            await safeClientDispose(clientToStop, operationId, `unexpected state ${state}`);
            break;
    }
}

/**
 * Determines whether an error should be rethrown based on its message,
 * deactivation status, and operation ID.
 *
 * Errors are not rethrown if the system is deactivating, if the error message
 * indicates a non-fatal issue (e.g., client not running, timeout), or if
 * the error does not pertain to the current operation.
 *
 * @param errorMessage - The error message string.
 * @param isDeactivating - A boolean flag indicating if the relevant component is deactivating.
 * @param operationId - The ID of the operation that encountered the error.
 * @returns `true` if the error should be rethrown, `false` otherwise.
 */
function shouldRethrowError(errorMessage: string, isDeactivating: boolean, operationId: number): boolean {
    const nonFatalErrorMessages = [
        "Client is not running",
        "Client is not stopping",
        "Client is already stopping",
        "already disposed",
        "timeout"
    ];

    const isNonFatalError = nonFatalErrorMessages.some((msg) => errorMessage.toLowerCase().includes(msg.toLowerCase()));
    const isCurrentOperation = getCurrentLsOperationId() === operationId;

    return !isDeactivating && !isNonFatalError && isCurrentOperation;
}

/**
 * Stops the language client.
 *
 * This function attempts to gracefully stop and dispose of the active language client instance.
 * It handles different client states and includes error handling and logging.
 *
 * @param isDeactivating - Optional. If true, indicates the stop is part of a deactivation process,
 * which may affect error handling. Defaults to false.
 * @returns A promise that resolves when the client has been stopped or an attempt has been made.
 */
export async function stopLanguageClient(isDeactivating: boolean = false): Promise<void> {
    const clientToStop = getLanguageClientInstance();
    const operationId = getCurrentLsOperationId();

    logger.info(
        `[stopLanguageClient - Op ${operationId}] Request to stop TestBench LS. ` +
            `Deactivating: ${isDeactivating}. Client present: ${!!clientToStop}. ` +
            `Client state: ${clientToStop?.state}`
    );

    if (!clientToStop) {
        logger.trace(`[stopLanguageClient - Op ${operationId}] No client instance to stop.`);
        return;
    }

    // Clear the global reference immediately to prevent further operations
    if (getLanguageClientInstance() === clientToStop) {
        setLanguageClientInstance(undefined);
        logger.trace(`[stopLanguageClient - Op ${operationId}] Global client instance has been cleared.`);
    } else {
        logger.warn(
            `[stopLanguageClient - Op ${operationId}] Attempting to stop a client that is not the current global instance. ` +
                `This might be a stale client or an issue in lifecycle management.`
        );
    }

    try {
        await handleClientByState(clientToStop, operationId);
    } catch (error) {
        const errorMessage = (error as Error).message || String(error);
        logger.error(
            `[stopLanguageClient - Op ${operationId}] Error stopping/disposing language client: ${errorMessage}`,
            error
        );

        // Attempt final cleanup if the client is still not in a stopped state
        if (clientToStop.state !== State.Stopped) {
            try {
                logger.warn(
                    `[stopLanguageClient - Op ${operationId}] Attempting final cleanup for client in state: ${clientToStop.state} ` +
                        `after error: ${errorMessage}.`
                );
                await safeClientDispose(clientToStop, operationId, "final cleanup");
            } catch (finalError) {
                logger.error(
                    `[stopLanguageClient - Op ${operationId}] Error during final cleanup: ${(finalError as Error).message}`
                );
            }
        }

        if (shouldRethrowError(errorMessage, isDeactivating, operationId)) {
            logger.error(
                `[stopLanguageClient - Op ${operationId}] Re-throwing error as it occurred during an active, non-deactivating operation: ${errorMessage}`
            );
            throw error;
        } else if (!isDeactivating) {
            logger.warn(
                `[stopLanguageClient - Op ${operationId}] Suppressed re-throw for error on stale operation ` +
                    `(current OpId: ${getCurrentLsOperationId()}, latest OpId: ${latestLsContextRequestId}): ${errorMessage}`
            );
        } else {
            logger.info(
                `[stopLanguageClient - Op ${operationId}] Error not re-thrown. Deactivating: ${isDeactivating}, Message: ${errorMessage}`
            );
        }
    } finally {
        logger.info(
            `[stopLanguageClient - Op ${operationId}] stopLanguageClient completed for client (State was ${clientToStop?.state}).`
        );
    }
}

/**
 * Sets up notification handlers for the language client.
 * It listens for "custom/notification" and displays an information message.
 *
 * @param client - The language client to set up notifications for.
 * @param projectName - The name of the project associated with the client.
 * @param tovName - The name of the TOV (Test Object Version) associated with the client.
 * @param operationId - An identifier for the current operation, used in logging.
 */
function setupClientNotifications(
    client: LanguageClient,
    projectName: string,
    tovName: string,
    operationId: number
): void {
    client.onNotification("testbench-language-server/show-error", (params) => {
        vscode.window.showErrorMessage(`${params.message}`);
    });

    client.onNotification("testbench-language-server/show-info", (params) => {
        vscode.window.showInformationMessage(`${params.message}`);
    });

    client.onNotification("testbench-language-server/log-info", (params) => {
        logger.info(`[Language server] - ${params.message}`);
    });

    client.onNotification("testbench-language-server/log-debug", (params) => {
        logger.debug(`[Language server] - ${params.message}`);
    });

    client.onNotification("testbench-language-server/log-trace", (params) => {
        logger.trace(`[Language server] - ${params.message}`);
    });

    client.onNotification("testbench-language-server/log-error", (params) => {
        logger.error(`[Language server] - ${params.message}`);
    });

    client.onNotification("testbench-language-server/log-warn", (params) => {
        logger.warn(`[Language server] - ${params.message}`);
    });

    client.onNotification("testbench-language-server/attempt-push-subdivision", (params) => {
        const path = params.path;
        const subdivisionUid = params.subdivisionUid;
        vscode.window
            .showWarningMessage(
                "Are you sure you want to push your changes to TestBench?",
                {
                    modal: true,
                    detail: "Interactions in TestBench will change which might also affect Test Structure Elements that use those interactions."
                },
                "Accept",
                "View Diff"
            )
            .then(async (selection) => {
                if (selection === "Accept") {
                    vscode.commands.executeCommand("testbench_ls.pushSubdivision", {
                        document_uri: path
                    });
                } else if (selection === "View Diff") {
                    vscode.commands.executeCommand("testbench_ls.showTestbenchSubdivisionDiff", {
                        document_uri: path,
                        subdivision_uid: subdivisionUid
                    });
                }
            });
    });

    client.onNotification("testbench-language-server/attempt-push-keyword", (params) => {
        const path = params.path;
        const keywordUid = params.keyword_uid;
        vscode.window
            .showWarningMessage(
                "Are you sure you want to push your changes to TestBench?",
                {
                    modal: true,
                    detail: "Interactions in TestBench will change which might also affect Test Structure Elements that use those interactions."
                },
                "Accept",
                "View Diff"
            )
            .then(async (selection) => {
                if (selection === "Accept") {
                    vscode.commands.executeCommand("testbench_ls.pushKeyword", {
                        document_uri: path,
                        keyword_uid: keywordUid
                    });
                } else if (selection === "View Diff") {
                    vscode.commands.executeCommand("testbench_ls.showTestbenchKeywordDiff", {
                        document_uri: path,
                        keyword_uid: keywordUid
                    });
                }
            });
    });

    vscode.workspace.registerTextDocumentContentProvider(virtualDocumentScheme, virtualDocumentProvider);
    client.onNotification("testbench-language-server/display-diff", (params) => {
        const realPath = params.path;
        const realUri = vscode.Uri.parse(realPath);
        const realFileName = realUri.path.split("/").pop() || "unknown";
        const virtualUri = vscode.Uri.parse(`${virtualDocumentScheme}:${realPath}`);
        virtualDocumentContent = params.virtualContent;
        onVirtualDocumentChangeEmitter.fire(virtualUri);
        vscode.commands.executeCommand("vscode.diff", virtualUri, realUri, `${realFileName} (TestBench Changes)`);
    });

    logger.info(
        `[startAndMonitorClient - Op ${operationId}] Language server notification handler set up for ${projectName}/${tovName}.`
    );
}

/**
 * Validates if the language client operation is still current after the client has started.
 * If the operation is stale, it stops and disposes of the client.
 *
 * @param newClient - The language client instance to validate.
 * @param operationId - The ID of the operation that started the client.
 * @param projectName - The project name.
 * @param tovName - The TOV name.
 * @returns True if the client is current and valid, false otherwise.
 */
async function validateClientAfterStart(
    newClient: LanguageClient,
    operationId: number,
    projectName: string,
    tovName: string
): Promise<boolean> {
    if (!isOperationCurrent(operationId)) {
        logger.warn(
            `[startAndMonitorClient - Op ${operationId}] LS for ${projectName}/${tovName} started, ` +
                `but became stale (current is ${getCurrentLsOperationId()}). Stopping this LS.`
        );

        await safeClientStop(newClient, operationId, "stale after start");
        await safeClientDispose(newClient, operationId, "stale after start");

        if (getLanguageClientInstance() === newClient) {
            setLanguageClientInstance(undefined);
        }

        return false;
    }
    return true;
}

/**
 * Handles client start failure with appropriate cleanup
 */
/**
 * Handles failures encountered during the startup of a new LanguageClient.
 *
 * It logs the error, cleans up the failed client instance, and re-throws the error
 * if the operation is still considered the current one.
 *
 * @param newClient - The LanguageClient instance that failed to start.
 * @param error - The error object representing the cause of the failure.
 * @param operationId - The unique identifier for the client start operation.
 * @param projectName - The name.
 * @param tovName - The TOV name.
 * @returns A promise that resolves when cleanup is complete. The promise may reject if the error is re-thrown.
 */
async function handleClientStartFailure(
    newClient: LanguageClient,
    error: Error,
    operationId: number,
    projectName: string,
    tovName: string
): Promise<void> {
    const errorMessage = error.message;

    if (!isOperationCurrent(operationId)) {
        logger.warn(
            `[startAndMonitorClient - Op ${operationId}] LS for ${projectName}/${tovName} failed to start ` +
                `(likely superseded by Op ${getCurrentLsOperationId()}). Error: ${errorMessage}`
        );
    } else {
        logger.error(
            `[startAndMonitorClient - Op ${operationId}] Failed to start TestBench LS for ` +
                `Project: ${projectName}, TOV: ${tovName}. Error: ${errorMessage}`,
            error
        );
    }

    // Clean up the failed client
    if (getLanguageClientInstance() === newClient) {
        setLanguageClientInstance(undefined);
    }

    if (newClient.state !== State.Stopped) {
        await safeClientDispose(newClient, operationId, "failed start cleanup");
    }

    if (isOperationCurrent(operationId)) {
        throw error;
    }
}

/**
 * Starts a new language client and monitors its initialization.
 * It handles timeouts during startup and ensures the client is still
 * the current one after starting before setting up notifications.
 * Logs the process and handles any startup failures.
 *
 * @param newClient - The language client instance to start.
 * @param projectName - The project name.
 * @param tovName - The TOV name.
 * @param operationId - A unique identifier for this operation, used for logging.
 * @returns A promise that resolves when the client has been started and monitored, or when an error occurs.
 */
async function startAndMonitorClient(
    newClient: LanguageClient,
    projectName: string,
    tovName: string,
    operationId: number
): Promise<void> {
    logger.info(`[startAndMonitorClient - Op ${operationId}] Attempting to start LS for ${projectName}/${tovName}.`);

    try {
        await withTimeout(() => newClient.start(), CLIENT_START_TIMEOUT_MS, "Language server start");

        logger.info(
            `[startAndMonitorClient - Op ${operationId}] LS for ${projectName}/${tovName} started successfully.`
        );

        const isStillCurrent = await validateClientAfterStart(newClient, operationId, projectName, tovName);
        if (!isStillCurrent) {
            return;
        }

        const currentGlobalClient = getLanguageClientInstance();
        if (currentGlobalClient === newClient) {
            setupClientNotifications(newClient, projectName, tovName, operationId);
        } else {
            logger.warn(
                `[startAndMonitorClient - Op ${operationId}] LS for ${projectName}/${tovName} started, ` +
                    `but global client instance changed (current is for op ${getCurrentLsOperationId()}) ` +
                    `before notification setup. This instance may be orphaned or soon replaced.`
            );
        }
    } catch (error) {
        await handleClientStartFailure(newClient, error as Error, operationId, projectName, tovName);
    }
}

/**
 * Creates a new LanguageClient instance.
 *
 * @param pythonPath - Path to the Python interpreter.
 * @param tbConnectionDetails - Connection details for the TestBench server.
 * @param projectName - The project name.
 * @param tovName - The TOV name.
 * @param operationId - An identifier for the operation, used for logging.
 * @returns A new LanguageClient instance configured for TestBench.
 */
function createLanguageClient(
    pythonPath: string,
    tbConnectionDetails: TbConnectionDetails,
    projectName: string,
    tovName: string,
    operationId: number
): LanguageClient {
    const serverOptions = buildServerOptions(pythonPath, tbConnectionDetails, projectName, tovName);
    const clientOptions = buildClientOptions();

    const newClientInstance = new LanguageClient("testbench-ls", "TestBench LS", serverOptions, clientOptions);

    logger.info(
        `[LS Manager - Op ${operationId}] New LanguageClient instance created for ${projectName}/${tovName}. ` +
            `PythonPath: ${pythonPath}, ServerName: ${tbConnectionDetails.serverName}, ` +
            `ServerPort: ${tbConnectionDetails.serverPort}, Username: ${tbConnectionDetails.username}, ` +
            `SessionToken: ${tbConnectionDetails.sessionToken ? "****" : "undefined"}, ` +
            `ScriptPath: ${LANGUAGE_SERVER_SCRIPT_PATH}, DebugPath: ${LANGUAGE_SERVER_DEBUG_PATH}`
    );

    logger.trace(
        `[LS Manager - Op ${operationId}] ClientOptions: DocumentSelector: ${JSON.stringify(clientOptions.documentSelector)}, ` +
            `OutputChannelName: ${clientOptions.outputChannelName}. Synchronize.fileEvents is configured.`
    );

    return newClientInstance;
}

/**
 * Handles an existing language client instance if found.
 * It attempts to stop any active existing client and then checks if the current operation is still valid.
 *
 * @param operationId - The unique identifier for the current operation.
 * @param projectName - The project name.
 * @param tovName - The TOV name.
 * @returns A promise that resolves to `true` if the operation can proceed (either no existing client or it was stopped successfully and operation is current),
 * or `false` if the operation became stale after attempting to stop a prior client.
 */
async function handleExistingClient(operationId: number, projectName: string, tovName: string): Promise<boolean> {
    const existingClient = getLanguageClientInstance();

    if (existingClient && existingClient.state !== State.Stopped) {
        logger.warn(
            `[initializeLanguageServer - Op ${operationId}] Existing client found unexpectedly ` +
                `(State: ${existingClient.state}). Attempting to stop it before initializing new one for ${projectName}/${tovName}.`
        );

        try {
            await stopLanguageClient(false);
            logger.info(
                `[initializeLanguageServer - Op ${operationId}] Successfully stopped unexpected existing client.`
            );
        } catch (e) {
            logger.error(
                `[initializeLanguageServer - Op ${operationId}] Error stopping unexpected existing client ` +
                    `for ${projectName}/${tovName}: ${(e as Error).message}`
            );
        }
    }

    if (!isOperationCurrent(operationId)) {
        logger.warn(
            `[initializeLanguageServer - Op ${operationId}] Initialization for ${projectName}/${tovName} ` +
                `became stale after attempting to stop prior client (current global OpId is ${getCurrentLsOperationId()}). Aborting.`
        );
        return false;
    }

    return true;
}

/**
 * Initializes the TestBench Language Server for a given project and TOV.
 *
 * Handles the lifecycle of the language server client, including:
 * - Checking for stale operations.
 * - Managing existing client instances.
 * - Validating prerequisites like Python path and connection details.
 * - Creating, assigning, and starting a new language client instance.
 *
 * @param project - The project identifier.
 * @param tov - The TOV identifier.
 * @param operationId - A unique identifier for this initialization operation to prevent race conditions.
 * @returns A promise that resolves when the initialization process is complete or aborted.
 */
export async function initializeLanguageServer(project: string, tov: string, operationId: number): Promise<void> {
    logger.info(
        `[initializeLanguageServer - Op ${operationId}] Initializing TestBench LS for ` +
            `Project: ${project}, TOV: ${tov}. Current global OpId: ${getCurrentLsOperationId()}`
    );

    if (!isOperationCurrent(operationId)) {
        logger.warn(
            `[initializeLanguageServer - Op ${operationId}] Initialization for ${project}/${tov} ` +
                `is stale (current global OpId is ${getCurrentLsOperationId()}). Aborting.`
        );
        return;
    }

    const shouldContinue = await handleExistingClient(operationId, project, tov);
    if (!shouldContinue) {
        return;
    }

    const prerequisites = await validateLsPrerequisites(operationId, project, tov);
    if (!prerequisites) {
        return;
    }

    const { pythonPath, tbConnectionDetails } = prerequisites;

    const newClientInstance = createLanguageClient(pythonPath, tbConnectionDetails, project, tov, operationId);

    // Check staleness before client assignment
    if (!isOperationCurrent(operationId)) {
        logger.warn(
            `[initializeLanguageServer - Op ${operationId}] Initialization for ${project}/${tov} ` +
                `is stale before client assignment (current global OpId is ${getCurrentLsOperationId()}). ` +
                `Disposing newly created client without starting.`
        );

        await safeClientDispose(newClientInstance, operationId, "stale before assignment");
        return;
    }

    logger.info(
        `[initializeLanguageServer - Op ${operationId}] Setting new client instance for ${project}/${tov} as the global client.`
    );
    setLanguageClientInstance(newClientInstance);
    await startAndMonitorClient(newClientInstance, project, tov, operationId);
}

/**
 * Schedules a deferred language server restart for the specified project and TOV.
 * The requests are debounced: any existing pending restart is cleared,
 * and only the latest call for the same project/TOV combination will execute after a delay.
 *
 * @param projectName - The name of the project for which the restart is scheduled.
 * @param tovName - The name of the TOV for which the restart is scheduled.
 */
function scheduleDeferredRestart(projectName: string, tovName: string): void {
    logger.info(`[LS Restart] Language server busy, deferring restart for ${projectName}/${tovName}`);

    clearPendingRestart();
    pendingRestartParams = { projectName, tovName, operationId: getCurrentLsOperationId() };

    restartTimeout = setTimeout(async () => {
        const pending = pendingRestartParams;
        if (pending && pending.projectName === projectName && pending.tovName === tovName) {
            logger.info(`[LS Restart] Executing deferred restart for ${projectName}/${tovName}`);
            await executeRestart(projectName, tovName);
        }
    }, RESTART_DEBOUNCE_MS);
}

/**
 * Schedules a debounced restart operation for a specific project and TOV.
 *
 * Clears any previously scheduled restart and sets a new one.
 * If multiple calls are made within a short period (defined by `RESTART_DEBOUNCE_MS`),
 * only the latest call will eventually trigger the `executeRestart` function.
 *
 * @param projectName - The name of the project for which the restart is scheduled.
 * @param tovName - The name of the TOV associated with the project.
 */
function scheduleDebouncedRestart(projectName: string, tovName: string): void {
    clearPendingRestart();
    pendingRestartParams = { projectName, tovName, operationId: getCurrentLsOperationId() };

    restartTimeout = setTimeout(async () => {
        const pending = pendingRestartParams;
        if (pending && pending.projectName === projectName && pending.tovName === tovName) {
            await executeRestart(projectName, tovName);
        }
    }, RESTART_DEBOUNCE_MS);
}

/**
 * Restarts the language server for a specified project and TOV.
 * If a restart operation is already in progress, this request is skipped.
 * The function attempts to stop the current language client and then initialize a new one.
 *
 * @param projectName The name of the project context for the language server.
 * @param tovName The name of the TOV context for the language server.
 * @returns A promise that resolves once the restart attempt has concluded,
 *          regardless of whether it was skipped, successful, or encountered an error.
 */
async function executeRestart(projectName: string, tovName: string): Promise<void> {
    if (isLanguageServerBusy) {
        logger.warn(`[LS Restart] Already busy, skipping restart for ${projectName}/${tovName}`);
        return;
    }

    isLanguageServerBusy = true;
    const thisOperationId = ++latestLsContextRequestId;
    setCurrentLsOperationId(thisOperationId);

    try {
        logger.info(`[LS Restart - Op ${thisOperationId}] Starting restart for ${projectName}/${tovName}`);
        try {
            await stopLanguageClient();
            logger.info(`[LS Restart - Op ${thisOperationId}] Previous client stopped.`);
        } catch (error) {
            logger.warn(`[LS Restart - Op ${thisOperationId}] Error stopping previous client (continuing):`, error);
            // Continue with initialization even if stop failed
        }

        if (!isOperationCurrent(thisOperationId)) {
            logger.warn(`[LS Restart - Op ${thisOperationId}] Operation superseded during stop phase`);
            return;
        }

        await initializeLanguageServer(projectName, tovName, thisOperationId);
        logger.info(`[LS Restart - Op ${thisOperationId}] Restart completed for ${projectName}/${tovName}`);
    } catch (error) {
        const errorMessage = (error as Error).message;
        logger.error(`[LS Restart - Op ${thisOperationId}] Error during restart: ${errorMessage}`, error);

        if (isOperationCurrent(thisOperationId)) {
            vscode.window.showErrorMessage(`Failed to restart Language Server for ${tovName}: ${errorMessage}`);
        }
    } finally {
        if (isOperationCurrent(thisOperationId)) {
            isLanguageServerBusy = false;
            clearPendingRestart();
        }
        logger.info(`[LS Restart - Op ${thisOperationId}] Operation finished for ${projectName}/${tovName}`);
    }
}

/**
 * Restarts the language client for a given project and TOV.
 * If the language server is busy, the restart is deferred.
 * Rapid successive calls are debounced.
 *
 * @param projectName - The name of the project.
 * @param tovName - The name of the TOV.
 * @returns A promise that resolves when the restart process is initiated or scheduled.
 */
export async function restartLanguageClient(projectName: string, tovName: string): Promise<void> {
    logger.info(`[LS Restart] Request for ${projectName}/${tovName}. Current busy state: ${isLanguageServerBusy}`);

    // If busy with another operation, defer this request
    if (isLanguageServerBusy) {
        scheduleDeferredRestart(projectName, tovName);
        return;
    }

    // Debounce rapid successive calls
    scheduleDebouncedRestart(projectName, tovName);
}

/**
 * Updates or restarts the language server based on the current state.
 * @param projectName the name of the project to update or restart the language server for.
 * @param tovName the name of the TOV to update or restart the language server for.
 */
export async function updateOrRestartLS(projectName: string | undefined, tovName: string | undefined): Promise<void> {
    if (!projectName || !tovName) {
        logger.error("[Cmd] updateOrRestartLS called with invalid project or TOV name.");
        vscode.window.showErrorMessage("Invalid project or TOV name provided for language server update.");
        return;
    }

    if (!connection) {
        logger.warn("[Cmd] updateOrRestartLS called without active connection. Cannot update language server.");
        vscode.window.showWarningMessage("No active connection available. Please log in first.");
        return;
    }

    const existingClient = getLanguageClientInstance();
    logger.debug(
        `[Cmd] updateOrRestartLS called with projectName: ${projectName}, tovName: ${tovName}, existingClient state: ${existingClient ? existingClient.state : "none"}`
    );

    if (!existingClient || existingClient.state === State.Stopped || existingClient.state === State.Starting) {
        logger.debug(`[Cmd] Restarting language client for project: ${projectName}, TOV: ${tovName}`);
        await restartLanguageClient(projectName, tovName);
    } else {
        logger.debug(`[Cmd] Updating language client with project name: ${projectName}, TOV name: ${tovName}`);

        try {
            await vscode.commands.executeCommand("testbench_ls.updateProject", projectName);
            await vscode.commands.executeCommand("testbench_ls.updateTov", tovName);
            logger.debug(`[Cmd] Language client updated for project: ${projectName}, TOV: ${tovName}`);
        } catch (error) {
            logger.warn(`[Cmd] Failed to update language client, restarting instead: ${error}`);
            await restartLanguageClient(projectName, tovName);
        }
    }
}

/**
 * Checks if the language server is running.
 * The server is considered running when it exists and is in the Running state.
 *
 * @returns True if the language server is running, false otherwise.
 */
export function isLanguageServerRunning(): boolean {
    return client !== undefined && client.state === State.Running;
}

/**
 * Handles language server restart if session token changed.
 * @param previousSessionToken - The previous session token.
 * @param newSessionToken - The new session token.
 */
export async function handleLanguageServerRestartOnSessionChange(
    previousSessionToken: string | undefined,
    newSessionToken: string
): Promise<void> {
    if (previousSessionToken !== newSessionToken) {
        logger.info(
            "[Extension] Session token changed. Stopping language server to ensure it gets updated credentials."
        );
        try {
            await stopLanguageClient();
            logger.debug("[Extension] Language server stopped due to session token change.");
        } catch (error) {
            logger.warn("[Extension] Error stopping language server during session change:", error);
        }
    }
}

/**
 * Waits for the language server to be ready, with a timeout.
 * This function can be used by command handlers to ensure the language server
 * is available before proceeding with operations that require it.
 *
 * @param timeoutMs Maximum time to wait in milliseconds (default: 30000ms)
 * @param checkIntervalMs Interval between readiness checks in milliseconds (default: 100ms)
 * @param cancellationToken Optional cancellation token to allow early termination
 * @returns Promise that resolves when the language server is ready or rejects on timeout/cancellation
 */
export async function waitForLanguageServerReady(
    timeoutMs: number = 30000,
    checkIntervalMs: number = 100,
    cancellationToken?: vscode.CancellationToken
): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        if (cancellationToken?.isCancellationRequested) {
            throw new Error("Language server wait operation was cancelled");
        }

        if (isLanguageServerRunning()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
    }

    throw new Error(`Language server did not become ready within ${timeoutMs}ms`);
}

/**
 * Finds the position of an interaction in a resource file using the language server.
 *
 * @param uri The URI of the resource file to search in
 * @param interactionName The name of the interaction to find
 * @param interactionUid The unique ID of the tree item
 * @returns Promise that resolves to the line number where the interaction was found, or undefined if not found
 */
export async function findInteractionPositionInResourceFile(
    uri: vscode.Uri,
    interactionName: string,
    interactionUid: string
): Promise<number | undefined> {
    if (!isLanguageServerRunning()) {
        logger.warn(
            "[findInteractionPositionInResourceFile] Language server not running, cannot find interaction position"
        );
        return undefined;
    }

    try {
        const lineNumber = await vscode.commands.executeCommand(
            "testbench_ls.getInteractionPosition",
            uri.toString(),
            interactionName,
            interactionUid
        );

        if (typeof lineNumber === "number") {
            return lineNumber;
        } else {
            logger.warn(
                `[findInteractionPositionInResourceFile] Language server returned invalid line number: ${lineNumber}`
            );
            return undefined;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(
            `[findInteractionPositionInResourceFile] Error finding interaction position: ${errorMessage}`,
            error
        );
        return undefined;
    }
}
