/**
 * @file src/test/ui/testLogger.ts
 * @description Centralized logging utility for UI tests.
 * Provides persistent file logging with console output, log levels, and rotation support.
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Log levels for filtering output.
 */
export enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
    NONE = 5
}

/**
 * Log level names for display.
 */
const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.TRACE]: "TRACE",
    [LogLevel.DEBUG]: "DEBUG",
    [LogLevel.INFO]: "INFO",
    [LogLevel.WARN]: "WARN",
    [LogLevel.ERROR]: "ERROR",
    [LogLevel.NONE]: "NONE"
};

/**
 * Configuration options for the test logger.
 */
export interface TestLoggerConfig {
    /** Directory where log files are stored */
    logDirectory?: string;
    /** Base name for log files (without extension) */
    logFileName?: string;
    /** Minimum log level to output */
    logLevel?: LogLevel;
    /** Whether to also output to console */
    consoleOutput?: boolean;
    /** Maximum log file size in bytes before rotation */
    maxFileSize?: number;
    /** Maximum number of rotated log files to keep */
    maxLogFiles?: number;
    /** Whether to include timestamps in log messages */
    includeTimestamp?: boolean;
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Required<TestLoggerConfig> = {
    logDirectory: ".test-resources/logs",
    logFileName: "ui-tests",
    logLevel: LogLevel.TRACE,
    consoleOutput: true,
    maxFileSize: 5 * 1024 * 1024, // 5 MB
    maxLogFiles: 5,
    includeTimestamp: true
};

/**
 * Test Logger class for persistent logging in UI tests.
 *
 * Features:
 * - Writes to both console and file
 * - Supports log levels for filtering
 * - Automatic log rotation when file size exceeds limit
 * - Timestamps and prefixes for easy identification
 * - Test context tracking (suite, test name)
 */
export class TestLogger {
    private static instance: TestLogger | null = null;
    private config: Required<TestLoggerConfig>;
    private logFilePath: string;
    private writeStream: fs.WriteStream | null = null;
    private currentTestSuite: string = "";
    private currentTestName: string = "";
    private sessionId: string;
    private isInitialized: boolean = false;

    /**
     * Private constructor for singleton pattern.
     */
    private constructor(config: TestLoggerConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.sessionId = this.generateSessionId();
        this.logFilePath = this.buildLogFilePath();
    }

    /**
     * Gets the singleton instance of the logger.
     * Creates a new instance if one doesn't exist.
     *
     * @param config - Optional configuration (only used on first call)
     * @returns The singleton TestLogger instance
     */
    public static getInstance(config?: TestLoggerConfig): TestLogger {
        if (!TestLogger.instance) {
            TestLogger.instance = new TestLogger(config);
        }
        return TestLogger.instance;
    }

    /**
     * Creates a detached logger instance that does not participate in the singleton lifecycle.
     * Useful for deterministic pre-initialization logging behavior.
     */
    public static createDetached(config?: TestLoggerConfig): TestLogger {
        return new TestLogger(config);
    }

    /**
     * Resets the singleton instance.
     * Useful for testing or reinitializing with new config.
     */
    public static resetInstance(): void {
        if (TestLogger.instance) {
            TestLogger.instance.close();
            TestLogger.instance = null;
        }
    }

    /**
     * Initializes the logger by creating the log directory and file.
     * Must be called before logging (idempotent).
     *
     * @param projectRoot - The project root directory
     * @returns Promise<boolean> - True if initialization succeeded
     */
    public async initialize(projectRoot: string): Promise<boolean> {
        if (this.isInitialized) {
            return true;
        }

        try {
            // Build full path for log directory
            const fullLogDir = path.isAbsolute(this.config.logDirectory)
                ? this.config.logDirectory
                : path.join(projectRoot, this.config.logDirectory);

            // Ensure log directory exists
            if (!fs.existsSync(fullLogDir)) {
                fs.mkdirSync(fullLogDir, { recursive: true });
            }

            // Update log file path with full directory
            this.logFilePath = path.join(fullLogDir, `${this.config.logFileName}-${this.sessionId}.log`);

            // Perform log rotation if needed
            await this.rotateLogsIfNeeded(fullLogDir);

            // Create write stream
            this.writeStream = fs.createWriteStream(this.logFilePath, { flags: "a" });

            // Write session header
            this.writeToFile(this.createSessionHeader());

            this.isInitialized = true;
            this.info("Logger", `Initialized. Log file: ${this.logFilePath}`);

            return true;
        } catch (error) {
            console.error("[TestLogger] Failed to initialize:", error);
            return false;
        }
    }

    /**
     * Gets the current log file path.
     */
    public getLogFilePath(): string {
        return this.logFilePath;
    }

    /**
     * Sets the current test context for log prefixing.
     *
     * @param suiteName - The test suite name
     * @param testName - The individual test name (optional)
     */
    public setTestContext(suiteName: string, testName?: string): void {
        this.currentTestSuite = suiteName;
        this.currentTestName = testName || "";
    }

    /**
     * Clears the current test context.
     */
    public clearTestContext(): void {
        this.currentTestSuite = "";
        this.currentTestName = "";
    }

    /**
     * Logs a trace-level message.
     */
    public trace(prefix: string, message: string, ...args: unknown[]): void {
        this.log(LogLevel.TRACE, prefix, message, ...args);
    }

    /**
     * Logs a debug-level message.
     */
    public debug(prefix: string, message: string, ...args: unknown[]): void {
        this.log(LogLevel.DEBUG, prefix, message, ...args);
    }

    /**
     * Logs an info-level message.
     */
    public info(prefix: string, message: string, ...args: unknown[]): void {
        this.log(LogLevel.INFO, prefix, message, ...args);
    }

    /**
     * Logs a warning-level message.
     */
    public warn(prefix: string, message: string, ...args: unknown[]): void {
        this.log(LogLevel.WARN, prefix, message, ...args);
    }

    /**
     * Logs an error-level message.
     */
    public error(prefix: string, message: string, ...args: unknown[]): void {
        this.log(LogLevel.ERROR, prefix, message, ...args);
    }

    /**
     * Logs a test start event.
     */
    public testStart(suiteName: string, testName: string): void {
        this.setTestContext(suiteName, testName);
        this.info("Test", `▶ Starting: ${testName}`);
    }

    /**
     * Logs a test pass event.
     */
    public testPass(testName: string, durationMs?: number): void {
        const duration = durationMs ? ` (${durationMs}ms)` : "";
        this.info("Test", `Passed: ${testName}${duration}`);
    }

    /**
     * Logs a test failure event.
     */
    public testFail(testName: string, error?: Error | string, durationMs?: number): void {
        const duration = durationMs ? ` (${durationMs}ms)` : "";
        this.error("Test", `Failed: ${testName}${duration}`);
        if (error) {
            const errorMessage = error instanceof Error ? error.message : error;
            this.error("Test", `  Error: ${errorMessage}`);
            if (error instanceof Error && error.stack) {
                this.debug("Test", `  Stack: ${error.stack}`);
            }
        }
    }

    /**
     * Logs a test skip event.
     */
    public testSkip(testName: string, reason?: string): void {
        const reasonStr = reason ? ` - ${reason}` : "";
        this.warn("Test", `⊘ Skipped: ${testName}${reasonStr}`);
    }

    /**
     * Logs a suite start event.
     */
    public suiteStart(suiteName: string): void {
        this.setTestContext(suiteName);
        this.info("Suite", `━━━ Starting Suite: ${suiteName} ━━━`);
    }

    /**
     * Logs a suite end event.
     */
    public suiteEnd(suiteName: string, stats?: { passed: number; failed: number; skipped: number }): void {
        if (stats) {
            this.info(
                "Suite",
                `━━━ Finished: ${suiteName} (Passed: ${stats.passed}, Failed: ${stats.failed}, Skipped: ${stats.skipped}) ━━━`
            );
        } else {
            this.info("Suite", `━━━ Finished Suite: ${suiteName} ━━━`);
        }
        this.clearTestContext();
    }

    /**
     * Writes a separator line to the log.
     */
    public separator(): void {
        const line = "─".repeat(80);
        this.writeToFile(line + "\n");
        if (this.config.consoleOutput) {
            console.log(line);
        }
    }

    /**
     * Closes the logger and flushes any pending writes.
     */
    public close(): void {
        if (this.writeStream) {
            this.writeToFile(this.createSessionFooter());
            this.writeStream.end();
            this.writeStream = null;
        }
        this.isInitialized = false;
    }

    /**
     * Core logging method.
     */
    private log(level: LogLevel, prefix: string, message: string, ...args: unknown[]): void {
        if (level < this.config.logLevel) {
            return;
        }

        const formattedMessage = this.formatMessage(level, prefix, message, args);

        // Write to file
        this.writeToFile(formattedMessage + "\n");

        // Write to console if enabled
        if (this.config.consoleOutput) {
            this.writeToConsole(level, prefix, message, args);
        }
    }

    /**
     * Formats a log message with timestamp, level, and context.
     */
    private formatMessage(level: LogLevel, prefix: string, message: string, args: unknown[]): string {
        const parts: string[] = [];

        // Timestamp
        if (this.config.includeTimestamp) {
            parts.push(`[${this.getTimestamp()}]`);
        }

        // Log level
        parts.push(`[${LOG_LEVEL_NAMES[level].padEnd(5)}]`);

        // Test context
        if (this.currentTestSuite) {
            parts.push(`[${this.currentTestSuite}]`);
        }

        // Prefix
        if (prefix) {
            parts.push(`[${prefix}]`);
        }

        // Message
        parts.push(message);

        // Additional arguments
        if (args.length > 0) {
            parts.push(args.map((arg) => this.formatArgument(arg)).join(" "));
        }

        return parts.join(" ");
    }

    /**
     * Writes to console with appropriate log method.
     */
    private writeToConsole(level: LogLevel, prefix: string, message: string, args: unknown[]): void {
        const formattedPrefix = prefix ? `[${prefix}]` : "";
        const fullMessage = `${formattedPrefix} ${message}`;

        switch (level) {
            case LogLevel.ERROR:
                console.error(fullMessage, ...args);
                break;
            case LogLevel.WARN:
                console.warn(fullMessage, ...args);
                break;
            case LogLevel.DEBUG:
            case LogLevel.TRACE:
                console.debug(fullMessage, ...args);
                break;
            default:
                console.log(fullMessage, ...args);
        }
    }

    /**
     * Writes a string to the log file.
     */
    private writeToFile(content: string): void {
        if (this.writeStream) {
            this.writeStream.write(content);
        }
    }

    /**
     * Formats an argument for logging.
     */
    private formatArgument(arg: unknown): string {
        if (arg === null) {
            return "null";
        }
        if (arg === undefined) {
            return "undefined";
        }
        if (typeof arg === "object") {
            try {
                return JSON.stringify(arg, null, 2);
            } catch {
                return String(arg);
            }
        }
        return String(arg);
    }

    /**
     * Gets a formatted timestamp string.
     */
    private getTimestamp(): string {
        const now = new Date();
        return now.toISOString();
    }

    /**
     * Generates a unique session ID for this test run.
     */
    private generateSessionId(): string {
        const now = new Date();
        const date = now.toISOString().split("T")[0];
        const time = now.toTimeString().split(" ")[0].replace(/:/g, "-");
        return `${date}_${time}`;
    }

    /**
     * Builds the log file path.
     */
    private buildLogFilePath(): string {
        return path.join(this.config.logDirectory, `${this.config.logFileName}-${this.sessionId}.log`);
    }

    /**
     * Creates a session header for the log file.
     */
    private createSessionHeader(): string {
        const divider = "═".repeat(80);
        const lines = [
            divider,
            `UI Test Session Started`,
            `Session ID: ${this.sessionId}`,
            `Started at: ${new Date().toISOString()}`,
            `Log Level: ${LOG_LEVEL_NAMES[this.config.logLevel]}`,
            `Node Version: ${process.version}`,
            `Platform: ${process.platform}`,
            divider,
            ""
        ];
        return lines.join("\n");
    }

    /**
     * Creates a session footer for the log file.
     */
    private createSessionFooter(): string {
        const divider = "═".repeat(80);
        const lines = ["", divider, `Session Ended at: ${new Date().toISOString()}`, divider, ""];
        return lines.join("\n");
    }

    /**
     * Rotates log files if the directory exceeds max files.
     */
    private async rotateLogsIfNeeded(logDir: string): Promise<void> {
        try {
            const files = fs
                .readdirSync(logDir)
                .filter((f) => f.endsWith(".log"))
                .sort();

            if (files.length >= this.config.maxLogFiles) {
                // Remove oldest files
                const filesToRemove = files.slice(0, files.length - this.config.maxLogFiles + 1);
                for (const file of filesToRemove) {
                    fs.unlinkSync(path.join(logDir, file));
                }
            }
        } catch {
            // Ignore rotation errors
        }
    }
}

/**
 * Global logger instance for convenience.
 * Call initializeTestLogger() before using.
 */
let globalLogger: TestLogger | null = null;
const preInitConsoleLogger: TestLogger = TestLogger.createDetached({
    consoleOutput: true,
    logLevel: LogLevel.TRACE
});

function getActiveLogger(): TestLogger {
    return globalLogger ?? preInitConsoleLogger;
}

/**
 * Returns a stable object that forwards each property access to the current active logger.
 * This keeps top-level logger constants in other modules deterministic even before bootstrap.
 */
function createDynamicLoggerProxy(): TestLogger {
    return new Proxy({} as TestLogger, {
        get(_target: TestLogger, prop: string | symbol): unknown {
            const activeLogger = getActiveLogger();
            const loggerRecord = activeLogger as unknown as Record<string | symbol, unknown>;
            const value = loggerRecord[prop];

            if (typeof value === "function") {
                return (value as (...args: unknown[]) => unknown).bind(activeLogger);
            }

            return value;
        }
    });
}

const loggerProxy: TestLogger = createDynamicLoggerProxy();

/**
 * Initializes the global test logger.
 *
 * @param projectRoot - The project root directory
 * @param config - Optional logger configuration
 * @returns Promise<TestLogger> - The initialized logger
 */
export async function initializeTestLogger(projectRoot: string, config?: TestLoggerConfig): Promise<TestLogger> {
    const logger = TestLogger.getInstance(config);
    await logger.initialize(projectRoot);
    globalLogger = logger;
    return logger;
}

/**
 * Gets the global test logger instance.
 * Before explicit initialization, this routes to a console-only detached logger.
 *
 * @returns The global TestLogger instance
 */
export function getTestLogger(): TestLogger {
    return loggerProxy;
}

/**
 * Convenience function for logging info messages.
 */
export function logInfo(prefix: string, message: string, ...args: unknown[]): void {
    getTestLogger().info(prefix, message, ...args);
}

/**
 * Convenience function for logging debug messages.
 */
export function logDebug(prefix: string, message: string, ...args: unknown[]): void {
    getTestLogger().debug(prefix, message, ...args);
}

/**
 * Convenience function for logging warning messages.
 */
export function logWarn(prefix: string, message: string, ...args: unknown[]): void {
    getTestLogger().warn(prefix, message, ...args);
}

/**
 * Convenience function for logging error messages.
 */
export function logError(prefix: string, message: string, ...args: unknown[]): void {
    getTestLogger().error(prefix, message, ...args);
}

/**
 * Convenience function for logging trace messages.
 */
export function logTrace(prefix: string, message: string, ...args: unknown[]): void {
    getTestLogger().trace(prefix, message, ...args);
}
