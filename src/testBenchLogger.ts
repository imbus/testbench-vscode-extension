/**
 * @file testBenchLogger.ts
 * @description Logger for the TestBench VS Code extension.
 */

import * as fs from "fs";
import * as path from "path";
import * as utils from "./utils";
import { getExtensionConfiguration } from "./configuration";
import { ConfigKeys, folderNameOfInternalTestbenchFolder } from "./constants";

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
    private isRotating: boolean = false;
    private flattedPromise: Promise<{ stringify: (obj: any) => string }> | null = null;
    private cachedLogLevel: string;

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
     * Creates an instance of the TestBenchLogger.
     *
     * @param {boolean | undefined} outputToTerminal Optional flag to output log messages to the terminal.
     *
     * The constructor sets default log paths (using the extension’s directory) and then asynchronously
     * attempts to update them based on the configured workspace location. It also caches the log level from the configuration.
     */
    constructor(outputToTerminal?: boolean) {
        this.logFolderPath = path.join(__dirname, folderNameOfLogs);
        this.logFilePath = path.join(this.logFolderPath, fileNameOfActiveLogFile);
        this.outputLogToTerminal = outputToTerminal === true;
        this.cachedLogLevel = getExtensionConfiguration().get(ConfigKeys.LOGGER_LEVEL, "No logging");
        // Begin asynchronous initialization
        this.initPromise = this.initialize();
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
                console.log("Workspace location is not set in the extension settings. Using default log folder.");
            }
            await fsp.mkdir(this.logFolderPath, { recursive: true });
        } catch (error) {
            console.error("Error during logger initialization:", error);
        }
    }

    /**
     * Updates the cached log level configuration if it has changed.
     * Should be called whenever the extension configuration is updated.
     * @returns {boolean} True if the log level was updated, false otherwise.
     */
    public updateCachedLogLevel(): boolean {
        const newLogLevel: string = getExtensionConfiguration().get("testBenchLogger", "No logging");
        if (this.cachedLogLevel !== newLogLevel) {
            const oldLogLevel: string = this.cachedLogLevel;
            this.cachedLogLevel = newLogLevel;
            console.log(`Logger level changed from "${oldLogLevel}" to "${this.cachedLogLevel}"`);
            return true;
        }
        return false;
    }

    /**
     * Retrieves the "flatted" module, caching it after the first dynamic import.
     */
    private async getFlatted() {
        if (!this.flattedPromise) {
            this.flattedPromise = import("flatted");
        }
        return this.flattedPromise;
    }

    /**
     * Rotates log files if the current log file exceeds MAX_LOG_FILE_SIZE.
     *
     * The current log file is renamed (with a _0 suffix such as testBenchExtension.log_0) and older backups are shifted.
     * A simple mutex ensures only one rotation occurs at a time.
     */
    private async rotateLogs(): Promise<void> {
        if (this.isRotating) {
            return;
        }
        this.isRotating = true;
        try {
            let currentLogFileStats;
            try {
                // Check if the current log file exists and obtain its size.
                currentLogFileStats = await fsp.stat(this.logFilePath);
            } catch (error) {
                console.error(`Log file ${this.logFilePath} does not exist.`, error);
                return;
            }

            if (currentLogFileStats.size < MAX_LOG_FILE_SIZE_IN_BYTES) {
                return;
            }

            // Shift existing backup files using a naming scheme of testBenchExtension.log.1, testBenchExtension.log.2, etc.
            for (let i = MAX_LOG_FILES; i >= 2; i--) {
                const olderFileName: string = `${this.logFilePath}.${i - 1}`;
                const newFileName: string = `${this.logFilePath}.${i}`;
                try {
                    await fsp.access(olderFileName);
                    await fsp.rename(olderFileName, newFileName);
                } catch (error) {
                    console.error(`Failed to rotate log file ${olderFileName} to ${newFileName}:`, error);
                }
            }
            try {
                await fsp.rename(this.logFilePath, `${this.logFilePath}.1`);
            } catch (error) {
                console.error(`Failed to rename current log file ${this.logFilePath} after rotation:`, error);
            }
        } catch (error) {
            console.error(`Log rotation error: ${error}`);
        } finally {
            this.isRotating = false;
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
        // This library is only imported if needed, reducing the initial load time.
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
                return typeof detail === "object" ? JSON.stringify(detail, null, 2) : detail;
            } catch (error) {
                // If JSON.stringify fails due to a circular reference, safely stringify the object.
                if (error instanceof TypeError && error.message.includes("Converting circular structure to JSON")) {
                    return typeof detail === "object" ? stringify(detail) : detail;
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

        const timestamp: string = new Date().toISOString();
        const baseLogMessage: string = `${timestamp} [${logLevel.toUpperCase()}]: ${logMessage}`;
        const detailsMessage: string = await this.formatDetails(details);
        const completeLogMessage: string = `${baseLogMessage}${detailsMessage}`;

        try {
            await this.rotateLogs();

            // Check if log file exists, if not, create an empty file
            try {
                await fsp.access(this.logFilePath, fs.constants.F_OK);
            } catch (error) {
                console.error("Log file access failed, creating new file:", error);
                await fsp.writeFile(this.logFilePath, "");
            }

            await fsp.appendFile(this.logFilePath, `${completeLogMessage}\n`);
        } catch (error) {
            console.error(`Logging error: ${error}`);
        }

        if (shouldOutputToTerminal || this.outputLogToTerminal) {
            if (Array.isArray(details)) {
                console.log(baseLogMessage);
                details.forEach((detail) => console.log(detail));
            } else if (details) {
                console.log(baseLogMessage, details);
            } else {
                console.log(completeLogMessage);
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
    public trace(message: string, details?: any | any[], shouldOutputToTerminal?: boolean): void {
        this.log("Trace", message, details, shouldOutputToTerminal);
    }

    /**
     * Logs a debug message.
     *
     * @param {string} message The debug message.
     * @param details Optional details.
     * @param {boolean | undefined} shouldOutputToTerminal Optional flag to force terminal output.
     */
    public debug(message: string, details?: any | any[], shouldOutputToTerminal?: boolean): void {
        this.log("Debug", message, details, shouldOutputToTerminal);
    }

    /**
     * Logs an informational message.
     *
     * @param {string} message The info message.
     * @param details Optional details.
     * @param {boolean | undefined} shouldOutputToTerminal Optional flag to force terminal output.
     */
    public info(message: string, details?: any | any[], shouldOutputToTerminal?: boolean): void {
        this.log("Info", message, details, shouldOutputToTerminal);
    }

    /**
     * Logs a warning message.
     *
     * @param {string} message The warning message.
     * @param details Optional details.
     * @param {boolean | undefined} shouldOutputToTerminal Optional flag to force terminal output.
     */
    public warn(message: string, details?: any | any[], shouldOutputToTerminal?: boolean): void {
        this.log("Warn", message, details, shouldOutputToTerminal);
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
    public error(message: string, details?: any | any[], shouldOutputToTerminal: boolean = true): void {
        this.log("Error", message, details, shouldOutputToTerminal);
    }
}
