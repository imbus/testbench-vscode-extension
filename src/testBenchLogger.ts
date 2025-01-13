import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { getConfig, folderNameOfTestbenchWorkingDirectory } from "./extension";

export const folderNameOfLogs = "logs";

const MAX_LOG_FILE_SIZE: number = 5 * 1024 * 1024; // 5 MB
const MAX_LOG_FILES: number = 3; // Maximum number of backup log files.

// In total, MAX_LOG_FILE_SIZE * MAX_LOG_FILES MegaBytes of logs will be stored at maximum.

// Async logging for performance.
// Use promisify to convert fs functions to promises.
const fsAppendFile = promisify(fs.appendFile);
const fsStat = promisify(fs.stat);
const fsRename = promisify(fs.rename);

export class TestBenchLogger {
    private logFolderPath: string;
    private logFilePath: string;
    // Log levels are 1-5, with 1 being the most verbose (trace) and 5 being the least verbose (error).
    // But in the extension settings, the user can select 0 as log level to disable logging.
    private levels: { [key: string]: number } = {
        "No logging": 0,
        Trace: 1,
        Debug: 2,
        Info: 3,
        Warn: 4,
        Error: 5,
    };
    private outputLogToTerminal: boolean = false; // Output log messages to the terminal

    getLogFilePath(): string {
        return this.logFilePath;
    }

    getLogFolderPath(): string {
        return this.logFolderPath;
    }

    constructor(outputToTerminal?: boolean) {
        // If workspaceLocation is not set, use the extension directory, and create a logs folder
        const workspaceFolder = getConfig().get<string>("workspaceLocation");
        // Example path: workspaceFolder/.testbench/logs/testBenchExtension.log
        if (workspaceFolder) {
            this.logFolderPath = path.join(
                workspaceFolder,
                folderNameOfTestbenchWorkingDirectory,
                folderNameOfLogs // Create a log folder with this name in the workspace folder
            );
            this.logFilePath = path.join(this.logFolderPath, "testBenchExtension.log");
        } else {
            this.logFolderPath = path.join(__dirname, "logs");
            this.logFilePath = path.join(this.logFolderPath, "testBenchExtension.log");
        }

        if (outputToTerminal) {
            this.outputLogToTerminal = outputToTerminal;
        }

        // Ensure log directory exists
        if (!fs.existsSync(this.logFolderPath)) {
            fs.mkdirSync(this.logFolderPath, { recursive: true });
        }
    }

    // Rotate logs if current log file exceeds MAX_LOG_FILE_SIZE
    // We always log to extension.log, and rename it to extension.log.0, extension.log.1, etc. when it exceeds MAX_LOG_FILE_SIZE
    private async rotateLogs() {
        try {
            // If log file does not exist, no rotation is needed
            if (!fs.existsSync(this.logFilePath)) {
                return;
            }

            // Get the size of the current log file
            const logFileSize: number = (await fsStat(this.logFilePath)).size;
            if (logFileSize >= MAX_LOG_FILE_SIZE) {
                // Rename each previous log file by shifting its index by 1
                for (let i = MAX_LOG_FILES - 1; i > 0; i--) {
                    const oldFile = `${this.logFilePath}.${i}`; // Example: extension.log.1
                    const olderFile = `${this.logFilePath}.${i - 1}`;
                    if (fs.existsSync(olderFile)) {
                        await fsRename(olderFile, oldFile);
                    }
                }
                // After rotating all existing log files, rename the current log to extension.log.0 and start a new log file.
                await fsRename(this.logFilePath, `${this.logFilePath}_0`);
            }
        } catch (error) {
            console.error(`Log rotation error: ${error}`);
        }
    }

    // Log messages with optional details and output to terminal
    public async log(level: string, message: string, details?: any | any[], outputToTerminal?: boolean) {
        const configuredLogLevel: string = getConfig().get("testBenchLogger", "No logging");

        // Implement no logging if log level is set to 0
        /*
        if (!level) {
            if (configuredLogLevel === "No logging") {
                return;
            }
        }*/

        if (configuredLogLevel === "No logging") {
            return;
        }

        if (this.levels[level] < this.levels[configuredLogLevel]) {
            return;
        }

        const timestamp = new Date().toISOString();
        const baseLogMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;

        // Initialize the complete log message
        let fullLogMessage = baseLogMessage;

        // Dynamically import flatted only if needed
        const { stringify } = await import("flatted");

        // Check if details is an array and process each item; otherwise, handle as a single item
        try {
            if (Array.isArray(details)) {
                for (const detail of details) {
                    const detailMessage = typeof detail === "object" ? JSON.stringify(detail, null, 2) : detail;
                    fullLogMessage += `\n${detailMessage}`;
                }
            } else if (details) {
                fullLogMessage += `\n${typeof details === "object" ? JSON.stringify(details, null, 2) : details}`;
            }
        } catch (error) {
            // If the object is circular, use flatted to stringify
            if (error instanceof TypeError && error.message.includes("Converting circular structure to JSON")) {
                // fullLogMessage += `\n[Error: Converting circular structure to JSON]`;

                if (Array.isArray(details)) {
                    for (const detail of details) {
                        const detailMessage = typeof detail === "object" ? stringify(detail) : detail;
                        fullLogMessage += `\n${detailMessage}`;
                    }
                } else if (details) {
                    fullLogMessage += `\n${typeof details === "object" ? stringify(details) : details}`;
                }
            }
        }

        // Write to log file
        try {
            await this.rotateLogs();

            // Ensure the log file exists; if not, create it
            if (!fs.existsSync(this.logFilePath)) {
                fs.writeFileSync(this.logFilePath, ""); // Create an empty log file if missing
            }

            await fsAppendFile(this.logFilePath, `${fullLogMessage}\n`);
        } catch (error) {
            console.error(`Logging error: ${error}`);
        }

        if (outputToTerminal || this.outputLogToTerminal) {
            // Log to console for inspection
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

    public trace(message: string, details?: any | any[], outputToTerminal?: boolean) {
        this.log("Trace", message, details, outputToTerminal);
    }

    public debug(message: string, details?: any | any[], outputToTerminal?: boolean) {
        this.log("Debug", message, details, outputToTerminal);
    }

    public info(message: string, details?: any | any[], outputToTerminal?: boolean) {
        this.log("Info", message, details, outputToTerminal);
    }

    public warn(message: string, details?: any | any[], outputToTerminal?: boolean) {
        this.log("Warn", message, details, outputToTerminal);
    }
    // Log the error messages always to the terminal
    public error(message: string, details?: any | any[], outputToTerminal: boolean = true) {
        this.log("Error", message, details, outputToTerminal);
    }
}
