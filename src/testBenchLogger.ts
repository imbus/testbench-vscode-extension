/**
 * @file testBenchLogger.ts
 * @description Logger for the TestBench VS Code extension.
 */

import * as fs from "fs";
import * as path from "path";
import * as utils from "./utils";
import { promisify } from "util";
import { getConfig, folderNameOfTestbenchWorkingDirectory } from "./extension";

// Name of the logs folder (inside the working directory)
export const folderNameOfLogs = "logs";

const MAX_LOG_FILE_SIZE: number = 5 * 1024 * 1024; // Maximum log file size (in bytes) 5 MB
const MAX_LOG_FILES: number = 3; // Maximum number of backup log files.

// Async logging for performance.
// Promisify selected fs functions for async/await usage.
const fsAppendFile = promisify(fs.appendFile);
const fsStat = promisify(fs.stat);
const fsRename = promisify(fs.rename);

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
     * @param outputToTerminal Optional flag to output log messages to the terminal.
     *
     * The constructor sets default log paths (using the extension’s directory) and then asynchronously
     * attempts to update them based on the configured workspace location.
     */
    constructor(outputToTerminal?: boolean) {
        // Initially set default values relative to the extension's directory.
        this.logFolderPath = path.join(__dirname, "logs");
        this.logFilePath = path.join(this.logFolderPath, "testBenchExtension.log");
        this.outputLogToTerminal = outputToTerminal === true;
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
            const workspaceLocation = await utils.validateAndReturnWorkspaceLocation(false);
            if (workspaceLocation) {
                // Example: workspaceFolder/.testbench/logs/testBenchExtension.log
                this.logFolderPath = path.join(
                    workspaceLocation,
                    folderNameOfTestbenchWorkingDirectory,
                    folderNameOfLogs
                );
                this.logFilePath = path.join(this.logFolderPath, "testBenchExtension.log");
            } else {
                console.log("Workspace location is not set in the extension settings. Using default log folder.");
            }
            // Ensure that the log folder exists.
            if (!fs.existsSync(this.logFolderPath)) {
                fs.mkdirSync(this.logFolderPath, { recursive: true });
            }
        } catch (error) {
            console.error("Error during logger initialization:", error);
        }
    }

    /**
     * Rotates log files if the current log file exceeds MAX_LOG_FILE_SIZE.
     *
     * The current log file is renamed (with a _0 suffix such as testBenchExtension.log_0) and older backups are shifted.
     */
    private async rotateLogs(): Promise<void> {
        try {
            if (!fs.existsSync(this.logFilePath)) {
                // Nothing to rotate if the log file does not exist.
                return;
            }

            // Get the size of the current log file
            const logFileSize: number = (await fsStat(this.logFilePath)).size;
            if (logFileSize < MAX_LOG_FILE_SIZE) {
                return;
            }

            // Shift existing backup files.
            for (let i = MAX_LOG_FILES - 1; i > 0; i--) {
                // Rename each previous log file by shifting its index by 1
                const oldFile = `${this.logFilePath}.${i}`; // Example: extension.log.1
                const olderFile = `${this.logFilePath}.${i - 1}`;
                if (fs.existsSync(olderFile)) {
                    await fsRename(olderFile, oldFile);
                }
            }
            // After rotating all existing log files, rename the current log file to start a new one.
            await fsRename(this.logFilePath, `${this.logFilePath}_0`);
        } catch (error) {
            console.error(`Log rotation error: ${error}`);
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
        let detailString = "";
        if (details === undefined || details === null) {
            return detailString;
        }

        // Dynamically import "flatted" only if needed.
        const { stringify } = await import("flatted");

        // Check if details is an array and process each item; otherwise, handle as a single item
        try {
            if (Array.isArray(details)) {
                for (const detail of details) {
                    detailString += "\n" + (typeof detail === "object" ? JSON.stringify(detail, null, 2) : detail);
                }
            } else {
                detailString = "\n" + (typeof details === "object" ? JSON.stringify(details, null, 2) : details);
            }
        } catch (error) {
            // In case of circular references, fall back to flatted.
            if (error instanceof TypeError && error.message.includes("Converting circular structure to JSON")) {
                if (Array.isArray(details)) {
                    for (const detail of details) {
                        detailString += "\n" + (typeof detail === "object" ? stringify(detail) : detail);
                    }
                } else {
                    detailString = "\n" + (typeof details === "object" ? stringify(details) : details);
                }
            } else {
                detailString += "\n[Error formatting details]";
            }
        }
        return detailString;
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
     * @param {boolean} outputToTerminal Optional flag to force terminal output (overrides instance setting).
     */
    public async log(level: string, message: string, details?: any | any[], outputToTerminal?: boolean): Promise<void> {
        // Get the log level from extension configuration.
        const configuredLogLevel: string = getConfig().get("testBenchLogger", "No logging");

        // Do not log if logging is disabled.
        if (configuredLogLevel === "No logging") {
            return;
        }

        // Skip messages below the configured log level.
        if (this.levels[level] < this.levels[configuredLogLevel]) {
            return;
        }

        const timestamp = new Date().toISOString();
        const baseLogMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;
        const detailsMessage = await this.formatDetails(details);
        const fullLogMessage = `${baseLogMessage}${detailsMessage}`;

        // Write to log file
        try {
            await this.rotateLogs();

            // Ensure the log file exists. If not, create an empty file.
            if (!fs.existsSync(this.logFilePath)) {
                fs.writeFileSync(this.logFilePath, ""); // Create an empty log file if missing
            }

            await fsAppendFile(this.logFilePath, `${fullLogMessage}\n`);
        } catch (error) {
            console.error(`Logging error: ${error}`);
        }

        // Output to terminal if enabled.
        if (outputToTerminal || this.outputLogToTerminal) {
            if (Array.isArray(details)) {
                console.log(baseLogMessage);
                for (const detail of details) {
                    console.log(detail); // Logs each object individually for easy inspection
                }
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
     * @param message The trace message.
     * @param details Optional details.
     * @param outputToTerminal Optional flag to force terminal output.
     */
    public trace(message: string, details?: any | any[], outputToTerminal?: boolean): void {
        this.log("Trace", message, details, outputToTerminal);
    }

    /**
     * Logs a debug message.
     *
     * @param message The debug message.
     * @param details Optional details.
     * @param outputToTerminal Optional flag to force terminal output.
     */
    public debug(message: string, details?: any | any[], outputToTerminal?: boolean): void {
        this.log("Debug", message, details, outputToTerminal);
    }

    /**
     * Logs an informational message.
     *
     * @param message The info message.
     * @param details Optional details.
     * @param outputToTerminal Optional flag to force terminal output.
     */
    public info(message: string, details?: any | any[], outputToTerminal?: boolean): void {
        this.log("Info", message, details, outputToTerminal);
    }

    /**
     * Logs a warning message.
     *
     * @param message The warning message.
     * @param details Optional details.
     * @param outputToTerminal Optional flag to force terminal output.
     */
    public warn(message: string, details?: any | any[], outputToTerminal?: boolean): void {
        this.log("Warn", message, details, outputToTerminal);
    }

    /**
     * Logs an error message.
     *
     * Error messages are always sent to the terminal by default.
     *
     * @param message The error message.
     * @param details Optional details.
     * @param outputToTerminal Optional flag to force terminal output (defaults to true).
     */
    public error(message: string, details?: any | any[], outputToTerminal: boolean = true): void {
        this.log("Error", message, details, outputToTerminal);
    }
}
