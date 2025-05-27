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

function getLanguageClientInstance(): LanguageClient | undefined {
    return client;
}

function setLanguageClientInstance(newInstance: LanguageClient | undefined): void {
    client = newInstance;
}

/**
 * Checks if the current operation is still valid (not superseded by a newer operation)
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
 * Creates a promise that times out after the specified duration
 */
function createTimeoutPromise(timeoutMs: number, operationName: string): Promise<never> {
    return new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${operationName} timeout after ${timeoutMs}ms`)), timeoutMs)
    );
}

/**
 * Wraps an async operation with timeout protection
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

    // Validate Python interpreter
    const pythonPath = await validatePythonInterpreter(operationId, project, tov);
    if (!pythonPath) {
        return null;
    }

    // Validate TestBench connection
    const tbConnectionDetails = validateTestBenchConnection(operationId, project, tov);
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
 * Validates Python interpreter availability
 */
async function validatePythonInterpreter(operationId: number, project: string, tov: string): Promise<string | null> {
    const pythonPath = await getInterpreterPath();
    if (!pythonPath) {
        logger.warn(
            `[validateLsPrerequisites - Op ${operationId}] Python interpreter path not found. ` +
                `LS will not be started for ${project}/${tov}.`
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
 * Validates TestBench connection availability
 */
function validateTestBenchConnection(operationId: number, project: string, tov: string): TbConnectionDetails | null {
    if (!connection) {
        logger.warn(
            `[validateLsPrerequisites - Op ${operationId}] No active TestBench connection. ` +
                `LS will not be started for ${project}/${tov}.`
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
 * Builds the ServerOptions for the LanguageClient
 */
function buildServerOptions(
    pythonPath: string,
    tbConnectionDetails: TbConnectionDetails,
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
 * Builds the LanguageClientOptions for the LanguageClient
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
 * Safely disposes a language client with error handling
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
 * Safely stops a language client with error handling
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
 * Handles client cleanup based on its current state
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
 * Determines if an error should be re-thrown based on context
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
 * Enhanced stopping of the currently active language client with better error handling
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

        // Determine if error should be re-thrown
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
 * Sets up notification handlers for the language client
 */
function setupClientNotifications(client: LanguageClient, project: string, tov: string, operationId: number): void {
    client.onNotification("custom/notification", (params) => {
        logger.info(`[startAndMonitorClient - Op ${operationId}] Received custom notification: ${params.message}`);
        vscode.window.showInformationMessage(`TestBench LS: ${params.message}`);
    });

    logger.info(`[startAndMonitorClient - Op ${operationId}] Notification handlers set up for LS ${project}/${tov}.`);
}

/**
 * Validates that the client is still current after successful start
 */
async function validateClientAfterStart(
    newClient: LanguageClient,
    operationId: number,
    project: string,
    tov: string
): Promise<boolean> {
    if (!isOperationCurrent(operationId)) {
        logger.warn(
            `[startAndMonitorClient - Op ${operationId}] LS for ${project}/${tov} started, ` +
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
async function handleClientStartFailure(
    newClient: LanguageClient,
    error: Error,
    operationId: number,
    project: string,
    tov: string
): Promise<void> {
    const errorMessage = error.message;

    if (!isOperationCurrent(operationId)) {
        logger.warn(
            `[startAndMonitorClient - Op ${operationId}] LS for ${project}/${tov} failed to start ` +
                `(likely superseded by Op ${getCurrentLsOperationId()}). Error: ${errorMessage}`
        );
    } else {
        logger.error(
            `[startAndMonitorClient - Op ${operationId}] Failed to start TestBench LS for ` +
                `Project: ${project}, TOV: ${tov}. Error: ${errorMessage}`,
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

    // Only throw if this is still the current operation
    if (isOperationCurrent(operationId)) {
        throw error;
    }
}

/**
 * Enhanced client starting with better monitoring and error handling
 */
async function startAndMonitorClient(
    newClient: LanguageClient,
    project: string,
    tov: string,
    operationId: number
): Promise<void> {
    logger.info(`[startAndMonitorClient - Op ${operationId}] Attempting to start LS for ${project}/${tov}.`);

    try {
        // Start client with timeout protection
        await withTimeout(() => newClient.start(), CLIENT_START_TIMEOUT_MS, "Language server start");

        logger.info(`[startAndMonitorClient - Op ${operationId}] LS for ${project}/${tov} started successfully.`);

        // Validate that the client is still current after successful start
        const isStillCurrent = await validateClientAfterStart(newClient, operationId, project, tov);
        if (!isStillCurrent) {
            return;
        }

        // Set up notifications only if this is still the current global client
        const currentGlobalClient = getLanguageClientInstance();
        if (currentGlobalClient === newClient) {
            setupClientNotifications(newClient, project, tov, operationId);
        } else {
            logger.warn(
                `[startAndMonitorClient - Op ${operationId}] LS for ${project}/${tov} started, ` +
                    `but global client instance changed (current is for op ${getCurrentLsOperationId()}) ` +
                    `before notification setup. This instance may be orphaned or soon replaced.`
            );
        }
    } catch (error) {
        await handleClientStartFailure(newClient, error as Error, operationId, project, tov);
    }
}

/**
 * Creates and validates a new language client instance
 */
function createLanguageClient(
    pythonPath: string,
    tbConnectionDetails: TbConnectionDetails,
    project: string,
    tov: string,
    operationId: number
): LanguageClient {
    const serverOptions = buildServerOptions(pythonPath, tbConnectionDetails, project, tov);
    const clientOptions = buildClientOptions();

    const newClientInstance = new LanguageClient("testbench-ls", "TestBench LS", serverOptions, clientOptions);

    logger.info(
        `[LS Manager - Op ${operationId}] New LanguageClient instance created for ${project}/${tov}. ` +
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
 * Handles cleanup of existing client before starting new one
 */
async function handleExistingClient(operationId: number, project: string, tov: string): Promise<boolean> {
    const existingClient = getLanguageClientInstance();

    if (existingClient && existingClient.state !== State.Stopped) {
        logger.warn(
            `[initializeLanguageServer - Op ${operationId}] Existing client found unexpectedly ` +
                `(State: ${existingClient.state}). Attempting to stop it before initializing new one for ${project}/${tov}.`
        );

        try {
            await stopLanguageClient(false);
            logger.info(
                `[initializeLanguageServer - Op ${operationId}] Successfully stopped unexpected existing client.`
            );
        } catch (e) {
            logger.error(
                `[initializeLanguageServer - Op ${operationId}] Error stopping unexpected existing client ` +
                    `for ${project}/${tov}: ${(e as Error).message}`
            );
        }
    }

    // Check if operation is still current after stopping existing client
    if (!isOperationCurrent(operationId)) {
        logger.warn(
            `[initializeLanguageServer - Op ${operationId}] Initialization for ${project}/${tov} ` +
                `became stale after attempting to stop prior client (current global OpId is ${getCurrentLsOperationId()}). Aborting.`
        );
        return false;
    }

    return true;
}

/**
 * Enhanced language server initialization with better lifecycle management
 */
export async function initializeLanguageServer(project: string, tov: string, operationId: number): Promise<void> {
    logger.info(
        `[initializeLanguageServer - Op ${operationId}] Initializing TestBench LS for ` +
            `Project: ${project}, TOV: ${tov}. Current global OpId: ${getCurrentLsOperationId()}`
    );

    // Check if operation is current at the start
    if (!isOperationCurrent(operationId)) {
        logger.warn(
            `[initializeLanguageServer - Op ${operationId}] Initialization for ${project}/${tov} ` +
                `is stale (current global OpId is ${getCurrentLsOperationId()}). Aborting.`
        );
        return;
    }

    // Handle any existing client
    const shouldContinue = await handleExistingClient(operationId, project, tov);
    if (!shouldContinue) {
        return;
    }

    // Validate prerequisites
    const prerequisites = await validateLsPrerequisites(operationId, project, tov);
    if (!prerequisites) {
        return;
    }

    const { pythonPath, tbConnectionDetails } = prerequisites;

    // Create new client instance
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

    // Assign the new client and start it
    logger.info(
        `[initializeLanguageServer - Op ${operationId}] Setting new client instance for ${project}/${tov} as the global client.`
    );
    setLanguageClientInstance(newClientInstance);
    await startAndMonitorClient(newClientInstance, project, tov, operationId);
}

/**
 * Schedules a deferred restart operation
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
 * Schedules a debounced restart operation
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
 * Executes the actual restart operation with proper state management
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

        // Stop existing client with enhanced error handling
        try {
            await stopLanguageClient();
            logger.info(`[LS Restart - Op ${thisOperationId}] Previous client stopped.`);
        } catch (error) {
            logger.warn(`[LS Restart - Op ${thisOperationId}] Error stopping previous client (continuing):`, error);
            // Continue with initialization even if stop failed
        }

        // Check if operation is still current after stopping
        if (!isOperationCurrent(thisOperationId)) {
            logger.warn(`[LS Restart - Op ${thisOperationId}] Operation superseded during stop phase`);
            return;
        }

        // Initialize new client
        await initializeLanguageServer(projectName, tovName, thisOperationId);
        logger.info(`[LS Restart - Op ${thisOperationId}] Restart completed for ${projectName}/${tovName}`);
    } catch (error) {
        const errorMessage = (error as Error).message;
        logger.error(`[LS Restart - Op ${thisOperationId}] Error during restart: ${errorMessage}`, error);

        if (isOperationCurrent(thisOperationId)) {
            vscode.window.showErrorMessage(`Failed to restart Language Server for ${tovName}: ${errorMessage}`);
        }
    } finally {
        // Always clear busy state and pending params when this operation completes
        if (isOperationCurrent(thisOperationId)) {
            isLanguageServerBusy = false;
            clearPendingRestart();
        }
        logger.info(`[LS Restart - Op ${thisOperationId}] Operation finished for ${projectName}/${tovName}`);
    }
}

/**
 * Enhanced restart function with improved debouncing and state management
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
