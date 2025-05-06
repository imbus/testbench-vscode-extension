/**
 * @file testBenchLogger.ts
 * @description Logger for the TestBench VS Code extension.
 */

import * as fs from "fs";
import * as path from "path";
import * as utils from "./utils";
import { getConfig } from "./extension";
import { folderNameOfInternalTestbenchFolder } from "./constants";

// Use the native promises API for filesystem operations.
const fsp = fs.promises;

// Name of the logs folder (inside the working directory)
export const folderNameOfLogs: string = "logs";

const MAX_LOG_FILE_SIZE: number = 5 * 1024 * 1024; // Maximum log file size (in bytes) 5 MB
const MAX_LOG_FILES: number = 3; // Maximum number of backup log files.

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
        // Initially set default values relative to the extension's directory.
        this.logFolderPath = path.join(__dirname, "logs");
        this.logFilePath = path.join(this.logFolderPath, "testBenchExtension.log");
        this.outputLogToTerminal = outputToTerminal === true;
        // Cache the current log level configuration.
        this.cachedLogLevel = getConfig().get("testBenchLogger", "No logging");
        // Begin asynchronous initialization.
        this.initPromise = this.initialize();
    }

    /**
     * Awaits the completion of asynchronous initialization.
     *
     * Used to ensure the logger has been initialized (i.e. updated log paths) before logging.
     */
    public async awaitInit(): Promise<void> {
        await this.initPromise;
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
                // Example: workspaceFolder/.testbench/logs/testBenchExtension.log
                this.logFolderPath = path.join(
                    workspaceLocation,
                    folderNameOfInternalTestbenchFolder,
                    folderNameOfLogs
                );
                this.logFilePath = path.join(this.logFolderPath, "testBenchExtension.log");
            } else {
                console.log("Workspace location is not set in the extension settings. Using default log folder.");
            }
            // Ensure that the log folder exists using asynchronous mkdir.
            await fsp.mkdir(this.logFolderPath, { recursive: true });
        } catch (error) {
            console.error("Error during logger initialization:", error);
        }
    }

    /**
     * Updates the cached log level configuration.
     * Should be called whenever the extension configuration is updated.
     */
    public updateCachedLogLevel(): void {
        this.cachedLogLevel = getConfig().get("testBenchLogger", "No logging");
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
            // Check if the current log file exists and obtain its size.
            let stats;
            try {
                stats = await fsp.stat(this.logFilePath);
            } catch (error) {
                // Log file does not exist; nothing to rotate.
                console.error(`Log file ${this.logFilePath} does not exist.`, error);
                return;
            }
            // If the log file is below the maximum size, no rotation is needed.
            if (stats.size < MAX_LOG_FILE_SIZE) {
                return;
            }

            // Shift existing backup files using a naming scheme.
            for (let i = MAX_LOG_FILES; i >= 2; i--) {
                const olderFileName: string = `${this.logFilePath}.${i - 1}`;
                const newFileName: string = `${this.logFilePath}.${i}`;
                try {
                    await fsp.access(olderFileName);
                    await fsp.rename(olderFileName, newFileName);
                } catch (error) {
                    // If the backup file doesn't exist, continue.
                    console.error(`Failed to rotate log file ${olderFileName} to ${newFileName}:`, error);
                }
            }
            // Rename the current log file to the first backup.
            try {
                await fsp.rename(this.logFilePath, `${this.logFilePath}.1`);
            } catch (error) {
                console.error(`Failed to rename current log file to ${this.logFilePath}_0 after rotation:`, error);
            }
        } catch (error) {
            console.error(`Log rotation error: ${error}`);
        } finally {
            // Reset the mutex flag.
            this.isRotating = false;
        }
    }

    /**
     * Formats additional details into a string.
     *
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
                // This works for most objects and arrays, but will fail for circular references.
                return typeof detail === "object" ? JSON.stringify(detail, null, 2) : detail;
            } catch (error) {
                // If JSON.stringify fails due to a circular reference, use the "flatted" library to safely stringify the object.
                if (error instanceof TypeError && error.message.includes("Converting circular structure to JSON")) {
                    return typeof detail === "object" ? stringify(detail) : detail;
                }
                // If the error is not related to circular references, return a placeholder error message.
                return "[Error formatting details]";
            }
        };

        // If the details parameter is an array, format each item individually and join them with newlines.
        if (Array.isArray(details)) {
            // Format each detail item, then join them with newlines.
            return details.map((detail) => `\n${formatSingleDetail(detail)}`).join("");
        } else {
            // If the details parameter is a single item, format it and prepend a newline.
            return `\n${formatSingleDetail(details)}`;
        }
    }

    /**
     * Writes a log message with a given level, message, and optional details.
     *
     * The method respects the log level set in the extension configuration. It rotates log files if necessary,
     * writes the log message to the log file, and optionally outputs the message to the terminal.
     *
     * @param {string} level The log level (e.g. "Trace", "Debug", "Info", "Warn", "Error").
     * @param {string} message The log message.
     * @param details Optional additional details to include.
     * @param {boolean | undefined} outputToTerminal Optional flag to force terminal output (overrides instance setting).
     */
    public async log(level: string, message: string, details?: any | any[], outputToTerminal?: boolean): Promise<void> {
        // Skip logging if disabled or log level is below the configured level.
        if (this.cachedLogLevel === "No logging" || this.levels[level] < this.levels[this.cachedLogLevel]) {
            return;
        }

        const timestamp: string = new Date().toISOString();
        const baseLogMessage: string = `${timestamp} [${level.toUpperCase()}]: ${message}`;
        const detailsMessage: string = await this.formatDetails(details);
        const fullLogMessage: string = `${baseLogMessage}${detailsMessage}`;

        // Write to log file
        try {
            await this.rotateLogs();

            // Ensure the log file exists; if not, create an empty file asynchronously.
            try {
                await fsp.access(this.logFilePath, fs.constants.F_OK);
            } catch (error) {
                console.error("Log file access failed, creating new file:", error);
                await fsp.writeFile(this.logFilePath, "");
            }

            await fsp.appendFile(this.logFilePath, `${fullLogMessage}\n`);
        } catch (error) {
            console.error(`Logging error: ${error}`);
        }

        // Output to terminal if enabled.
        if (outputToTerminal || this.outputLogToTerminal) {
            if (Array.isArray(details)) {
                console.log(baseLogMessage);
                details.forEach((detail) => console.log(detail)); // Logs each object individually for easy inspection
            } else if (details) {
                console.log(baseLogMessage, details);
            } else {
                console.log(fullLogMessage);
            }
        }
    }

    /**
     * Logs a trace message.
     *
     * @param {string} message The trace message.
     * @param details Optional details.
     * @param {boolean | undefined} outputToTerminal Optional flag to force terminal output.
     */
    public trace(message: string, details?: any | any[], outputToTerminal?: boolean): void {
        this.log("Trace", message, details, outputToTerminal);
    }

    /**
     * Logs a debug message.
     *
     * @param {string} message The debug message.
     * @param details Optional details.
     * @param {boolean | undefined} outputToTerminal Optional flag to force terminal output.
     */
    public debug(message: string, details?: any | any[], outputToTerminal?: boolean): void {
        this.log("Debug", message, details, outputToTerminal);
    }

    /**
     * Logs an informational message.
     *
     * @param {string} message The info message.
     * @param details Optional details.
     * @param {boolean | undefined} outputToTerminal Optional flag to force terminal output.
     */
    public info(message: string, details?: any | any[], outputToTerminal?: boolean): void {
        this.log("Info", message, details, outputToTerminal);
    }

    /**
     * Logs a warning message.
     *
     * @param {string} message The warning message.
     * @param details Optional details.
     * @param {boolean | undefined} outputToTerminal Optional flag to force terminal output.
     */
    public warn(message: string, details?: any | any[], outputToTerminal?: boolean): void {
        this.log("Warn", message, details, outputToTerminal);
    }

    /**
     * Logs an error message.
     *
     * Error messages are always sent to the terminal by default.
     *
     * @param {string} message The error message.
     * @param details Optional details.
     * @param {boolean | undefined} outputToTerminal Optional flag to force terminal output (defaults to true).
     */
    public error(message: string, details?: any | any[], outputToTerminal: boolean = true): void {
        this.log("Error", message, details, outputToTerminal);
    }
}
