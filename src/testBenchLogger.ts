/**
 * @file testBenchLogger.ts
 * @description Logger for the TestBench VS Code extension.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as utils from "./utils";
import { getExtensionConfiguration } from "./configuration";
import { ConfigKeys, folderNameOfInternalTestbenchFolder, baseKeyOfExtension } from "./constants";

// Use the native promises API for filesystem operations.
const fsp = fs.promises;

const MAX_LOG_FILE_SIZE_IN_BYTES: number = 5 * 1024 * 1024;
const MAX_LOG_FILES: number = 3;

const fileNameOfActiveLogFile: string = "testBenchExtension.log";
export const folderNameOfLogs: string = "logs";

/**
 * A logger for the TestBench extension.
 *
 * The logger writes messages to a file (with log rotation) and can optionally mirror logs to the terminal.
 * The log file location is determined from the extension settings (workspace location); if not set, a default
 * location relative to the extension directory is used.
 */
export class TestBenchLogger {
    private logFolderPath: string;
    private logFilePath: string;
    private outputLogToTerminal: boolean;
    private initPromise: Promise<void>;
    private rotationPromise: Promise<void> | null = null;
    private flattedPromise: Promise<{ stringify: (obj: any) => string }> | null = null;
    private cachedLogLevel: string;
    private configChangeListener: vscode.Disposable | null = null;
    private currentLogSize: number = 0;

    /**
     * Log levels are 0 to 5, with 1 being the most verbose (trace) and 5 being the least verbose (error).
     * Levels: 0 = no logging, 1 = trace, 2 = debug, 3 = info, 4 = warn, 5 = error.
     */
    private levels: { [key: string]: number } = {
        "No logging": 0,
        Trace: 1,
        Debug: 2,
        Info: 3,
        Warn: 4,
        Error: 5
    };

    /**
     * Returns the full path of the current log file.
     */
    public getLogFilePath(): string {
        return this.logFilePath;
    }

    /**
     * Returns the full path of the log folder.
     */
    public getLogFolderPath(): string {
        return this.logFolderPath;
    }

    /**
     * Gets the current log level as a string.
     * @returns {string} The current log level (e.g., "Trace", "Debug", "Info", etc.)
     */
    public get level(): string {
        return this.cachedLogLevel;
    }

    /**
     * Gets the numeric value of the current log level.
     * @returns {number} The numeric log level (0-5)
     */
    public getLevelNumber(): number {
        return this.levels[this.cachedLogLevel] || 0;
    }

    /**
     * Checks if the logger is configured to log at the specified level.
     * @param {string} logLevel - The log level to check
     * @returns {boolean} True if the specified level would be logged
     */
    public isLevelEnabled(logLevel: string): boolean {
        return this.cachedLogLevel !== "No logging" && this.levels[logLevel] >= this.levels[this.cachedLogLevel];
    }

    /**
     * Creates an instance of the TestBenchLogger.
     *
     * @param {boolean | undefined} outputToTerminal Optional flag to output log messages to the terminal.
     *
     * The constructor sets default log paths (using the extension's directory) and then asynchronously
     * attempts to update them based on the configured workspace location. It also caches the log level from the configuration.
     */
    constructor(outputToTerminal?: boolean) {
        this.logFolderPath = path.join(__dirname, folderNameOfLogs);
        this.logFilePath = path.join(this.logFolderPath, fileNameOfActiveLogFile);
        this.outputLogToTerminal = outputToTerminal === true;
        this.cachedLogLevel = getExtensionConfiguration().get(ConfigKeys.LOGGER_LEVEL, "No logging");

        // Set up configuration change listener
        this.setupConfigurationListener();

        // Begin asynchronous initialization
        this.initPromise = this.initialize();
    }

    /**
     * Sets up a listener for configuration changes that affect the logger level.
     */
    private setupConfigurationListener(): void {
        this.configChangeListener = vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(`${baseKeyOfExtension}.${ConfigKeys.LOGGER_LEVEL}`)) {
                console.log(`[testBenchLogger] Configuration change detected for logger level`);
                const wasUpdated = this.updateCachedLogLevel();
                if (wasUpdated) {
                    console.log(`[testBenchLogger] Successfully updated logger level to: ${this.cachedLogLevel}`);
                } else {
                    console.log(`[testBenchLogger] Logger level unchanged: ${this.cachedLogLevel}`);
                }
            }
        });
    }

    /**
     * Performs asynchronous initialization of the logger.
     *
     * It attempts to obtain the workspace location from the extension settings and update the log folder and file paths.
     * If the workspace location is unavailable, the default values remain.
     */
    private async initialize(): Promise<void> {
        try {
            const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation(false);
            if (workspaceLocation) {
                // Example logFolderPath: workspaceFolder/.testbench/logs/testBenchExtension.log
                this.logFolderPath = path.join(
                    workspaceLocation,
                    folderNameOfInternalTestbenchFolder,
                    folderNameOfLogs
                );
                this.logFilePath = path.join(this.logFolderPath, fileNameOfActiveLogFile);
            } else {
                console.log(
                    "[testBenchLogger] Workspace location is not set in the extension settings. Using default log folder."
                );
            }
            await fsp.mkdir(this.logFolderPath, { recursive: true });

            try {
                const stats = await fsp.stat(this.logFilePath);
                this.currentLogSize = stats.size;
            } catch (error: any) {
                if (error.code === "ENOENT") {
                    this.currentLogSize = 0;
                } else {
                    throw error;
                }
            }
        } catch (error: any) {
            if (error.code === "EPERM" || error.code === "EACCES") {
                console.error(
                    `[testBenchLogger] Logger Fatal Error: Permission denied to create log directory at '${this.logFolderPath}'. Please check folder permissions. Logging to file will be disabled.`
                );
                this.cachedLogLevel = "No logging";
            } else {
                console.error(`[testBenchLogger] Error during logger initialization:`, error);
            }
        }
    }

    /**
     * Updates the cached log level configuration if it has changed.
     * Should be called whenever the extension configuration is updated.
     * @returns {boolean} True if the log level was updated, false otherwise.
     */
    public updateCachedLogLevel(): boolean {
        // Read configuration directly from VS Code instead of using cached version
        // to avoid race conditions with the configuration watcher
        const freshConfiguration = vscode.workspace.getConfiguration(baseKeyOfExtension);
        const newLogLevel: string = freshConfiguration.get(ConfigKeys.LOGGER_LEVEL, "No logging");
        if (this.cachedLogLevel !== newLogLevel) {
            const oldLogLevel: string = this.cachedLogLevel;
            this.cachedLogLevel = newLogLevel;
            console.log(`[testBenchLogger] Logger level changed from "${oldLogLevel}" to "${this.cachedLogLevel}"`);
            return true;
        }
        return false;
    }

    /**
     * Disposes of the logger and cleans up resources.
     */
    public dispose(): void {
        if (this.configChangeListener) {
            this.configChangeListener.dispose();
            this.configChangeListener = null;
        }
    }

    /**
     * Rotates log files if the current log file exceeds MAX_LOG_FILE_SIZE.
     * Reads all existing log files, sorts them, and renames them,
     * removes the oldest log file and shifts the index of the rest.
     */
    private async rotateLogs(): Promise<void> {
        if (this.currentLogSize < MAX_LOG_FILE_SIZE_IN_BYTES) {
            return;
        }

        this.currentLogSize = 0;

        try {
            const filesInLogFolderPath: string[] = await fsp.readdir(this.logFolderPath);
            const logFiles: string[] = filesInLogFolderPath
                .filter((f) => f.startsWith(fileNameOfActiveLogFile))
                .sort()
                .reverse();

            for (const logFile of logFiles) {
                const filePath: string = path.join(this.logFolderPath, logFile);
                const logFileNameParts: string[] = logFile.split(".");
                // Example rotation: testBenchExtension.log.1 -> .2, testBenchExtension.log -> .1
                const index: number =
                    logFileNameParts.length > 2 ? parseInt(logFileNameParts[logFileNameParts.length - 1], 10) : 0;

                if (index >= MAX_LOG_FILES) {
                    // Delete oldest log file
                    await fsp.unlink(filePath);
                } else {
                    // Rename to the next index
                    const newFilePath = `${this.logFilePath}.${index + 1}`;
                    await fsp.rename(filePath, newFilePath);
                }
            }
        } catch (error: any) {
            if (error.code === "EPERM" || error.code === "EACCES") {
                console.error(
                    `[testBenchLogger] Logger Error: Permission denied during log rotation in '${this.logFolderPath}'. Please check file and folder permissions.`
                );
            } else {
                console.error(
                    `[testBenchLogger] Logger Error: An unexpected error occurred during log rotation: ${error.message}`
                );
            }
        }
    }

    /**
     * Formats additional details into a string.
     * If an object cannot be stringified with JSON due to circular references, the "flatted" library is used.
     *
     * @param details An object or array of objects to be stringified.
     * @returns {Promise<string>} A formatted string representation of the details (or an empty string if none provided).
     */
    private async formatDetails(details?: any | any[]): Promise<string> {
        if (details === undefined || details === null) {
            return "";
        }

        // Dynamically import the "flatted" library to handle circular references.
        const { stringify } = await this.getFlatted();

        /**
         * Helper function to format a single detail item.
         * This function safely converts an object to a string, handling circular references if necessary.
         *
         * @param detail - The detail item to format (can be an object, array, or primitive value).
         * @returns {string} - The formatted string representation of the detail.
         */
        const formatSingleDetail = (detail: any): string => {
            try {
                // Attempt to stringify the detail using JSON.stringify.
                // Will fail for circular references.
                return typeof detail === "object" ? JSON.stringify(detail, null, 2) : String(detail);
            } catch (error: any) {
                if (error instanceof TypeError && error.message.includes("Converting circular structure to JSON")) {
                    return typeof detail === "object" ? stringify(detail) : String(detail);
                }
                return "[Error formatting details]";
            }
        };

        // If the details parameter is an array, format each item individually and join them with newlines.
        if (Array.isArray(details)) {
            return details.map((detail) => `\n${formatSingleDetail(detail)}`).join("");
        } else {
            return `\n${formatSingleDetail(details)}`;
        }
    }

    /**
     * Retrieves the "flatted" module, caching it after the first dynamic import.
     */
    private getFlatted() {
        if (!this.flattedPromise) {
            this.flattedPromise = import("flatted");
        }
        return this.flattedPromise;
    }

    /**
     * Ensures the log file exists, creating it if missing.
     */
    private async ensureLogFileExists(): Promise<void> {
        try {
            await fsp.access(this.logFilePath);
        } catch (error: any) {
            if (error.code === "ENOENT") {
                console.log(`[testBenchLogger] Log file missing, recreating: ${this.logFilePath}`);
                try {
                    await fsp.mkdir(this.logFolderPath, { recursive: true });
                    await fsp.writeFile(this.logFilePath, "", { encoding: "utf8" });
                    console.log(`[testBenchLogger] Log file recreated successfully: ${this.logFilePath}`);
                } catch (createError: any) {
                    console.error(`[testBenchLogger] Failed to recreate log file '${this.logFilePath}':`, createError);
                    throw createError;
                }
            } else {
                throw error;
            }
        }
    }

    /**
     * Ensures exclusive access to log file operations like rotation to prevent race conditions.
     * @param op The async operation (e.g., writing a log) to execute exclusively.
     */
    private async performExclusive<T>(op: () => Promise<T>): Promise<T> {
        // Wait for any ongoing rotation to complete.
        while (this.rotationPromise) {
            await this.rotationPromise.catch((err) => {
                console.error(
                    "[testBenchLogger] Logger Warning: Waited for a rotation that resulted in an error.",
                    err
                );
            });
        }

        try {
            // Set the promise to indicate that a rotation is in progress.
            this.rotationPromise = this.rotateLogs();
            await this.rotationPromise;
        } finally {
            this.rotationPromise = null;
        }

        return op();
    }

    /**
     * Writes a log message with a given level, message, and optional details.
     *
     * The method respects the log level set in the extension configuration. It rotates log files if necessary,
     * writes the log message to the log file, and optionally outputs the message to the terminal.
     *
     * @param {string} logLevel The log level (e.g. "Trace", "Debug", "Info", "Warn", "Error").
     * @param {string} logMessage The log message.
     * @param details Optional additional details to include.
     * @param {boolean | undefined} shouldOutputToTerminal Optional flag to force terminal output (overrides instance setting).
     */
    public async log(
        logLevel: string,
        logMessage: string,
        details?: any | any[],
        shouldOutputToTerminal?: boolean
    ): Promise<void> {
        if (this.cachedLogLevel === "No logging" || this.levels[logLevel] < this.levels[this.cachedLogLevel]) {
            return;
        }
        await this.initPromise;

        const timestamp: string = new Date().toISOString();
        const baseLogMessage: string = `${timestamp} [${logLevel.toUpperCase()}]: ${logMessage}`;
        const detailsMessage: string = await this.formatDetails(details);
        const completeLogMessage: string = `${baseLogMessage}${detailsMessage}\n`;

        if (shouldOutputToTerminal || this.outputLogToTerminal) {
            if (Array.isArray(details) && details.length > 0) {
                console.log(baseLogMessage, ...details);
            } else if (details) {
                console.log(baseLogMessage, details);
            } else {
                console.log(baseLogMessage);
            }
        }

        // Perform file writing exclusively to prevent race conditions with rotation.
        try {
            await this.performExclusive(async () => {
                await this.ensureLogFileExists();
                await fsp.appendFile(this.logFilePath, completeLogMessage, { encoding: "utf8" });
                this.currentLogSize += Buffer.byteLength(completeLogMessage, "utf8");
            });
        } catch (error: any) {
            if (error.code === "EPERM" || error.code === "EACCES") {
                console.error(
                    `[testBenchLogger] Logger Fatal Error: Permission denied to write to log file '${this.logFilePath}'. Please check file permissions. Further file logging may fail.`
                );
            } else if (error.code === "ENOENT") {
                console.error(
                    `[testBenchLogger] Logger Error: Log file '${this.logFilePath}' was deleted and could not be recreated. File logging may fail.`
                );
            } else {
                console.error(`[testBenchLogger] Logger Error: Failed to write to log file.`, error);
            }
        }
    }

    /**
     * Logs a trace message.
     *
     * @param {string} message The trace message.
     * @param details Optional details.
     * @param {boolean | undefined} shouldOutputToTerminal Optional flag to force terminal output.
     */
    public trace(message: string, details?: any | any[], shouldOutputToTerminal?: boolean): Promise<void> {
        return this.log("Trace", message, details, shouldOutputToTerminal);
    }

    /**
     * Logs a debug message.
     *
     * @param {string} message The debug message.
     * @param details Optional details.
     * @param {boolean | undefined} shouldOutputToTerminal Optional flag to force terminal output.
     */
    public debug(message: string, details?: any | any[], shouldOutputToTerminal?: boolean): Promise<void> {
        return this.log("Debug", message, details, shouldOutputToTerminal);
    }

    /**
     * Logs an informational message.
     *
     * @param {string} message The info message.
     * @param details Optional details.
     * @param {boolean | undefined} shouldOutputToTerminal Optional flag to force terminal output.
     */
    public info(message: string, details?: any | any[], shouldOutputToTerminal?: boolean): Promise<void> {
        return this.log("Info", message, details, shouldOutputToTerminal);
    }

    /**
     * Logs a warning message.
     *
     * @param {string} message The warning message.
     * @param details Optional details.
     * @param {boolean | undefined} shouldOutputToTerminal Optional flag to force terminal output.
     */
    public warn(message: string, details?: any | any[], shouldOutputToTerminal?: boolean): Promise<void> {
        return this.log("Warn", message, details, shouldOutputToTerminal);
    }

    /**
     * Logs an error message.
     *
     * Error messages are always sent to the terminal by default.
     *
     * @param {string} message The error message.
     * @param details Optional details.
     * @param {boolean | undefined} shouldOutputToTerminal Optional flag to force terminal output (defaults to true).
     */
    public error(message: string, details?: any | any[], shouldOutputToTerminal: boolean = true): Promise<void> {
        return this.log("Error", message, details, shouldOutputToTerminal);
    }
}
