import { strict as assert } from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import { TestBenchLogger } from "../../testBenchLogger";
import { promisify } from "util";
const fsUnlink = promisify(fs.unlink);
const fsExists = promisify(fs.exists);

suite("TestBenchLogger Tests", async () => {
    const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("testbenchExtension");
    config.update("testBenchLogger", "1");

    const logger = new TestBenchLogger();
    const logFilePathOfLogger = logger.getLogFilePath();
    const logFolderPathOfLogger = logger.getLogFolderPath();

    setup(async () => {
        // Ensure the log directory is clean before each test
        if (await fsExists(logFilePathOfLogger)) {
            await fsUnlink(logFilePathOfLogger);
        }
        for (let i = 0; i < 3; i++) {
            const rotatedLogFilePath = `${logFilePathOfLogger}.${i}`;
            if (await fsExists(rotatedLogFilePath)) {
                await fsUnlink(rotatedLogFilePath);
            }
        }
    });

    /*
    test("should create a log file and write a log message", async () => {
        logger.log("3", "Test info message");

        const logFolderExists = await fsExists(logFolderPathOfLogger);
        assert.strictEqual(logFolderExists, true, "Log folder should exist");

        const logFileExists = await fsExists(logFilePathOfLogger);
        assert.strictEqual(logFileExists, true, "Log file should exist");

        const logContent = fs.readFileSync(logFilePathOfLogger, "utf8");
        assert(logContent.includes("Test info message"), "Log file should contain the log message");
    });

    test("should rotate log files when exceeding max size", async () => {
        const largeMessage = "A".repeat(1024 * 1024); // 1 MB message

        // Write enough messages to exceed the 5 MB limit
        for (let i = 0; i < 6; i++) {
            logger.log("3", largeMessage);
        }

        const rotatedLogExists = await fsExists(`${logFilePathOfLogger}_0`);
        assert.strictEqual(rotatedLogExists, true, "Rotated log file should exist");

        const logExists = await fsExists(logFilePathOfLogger);
        assert.strictEqual(logExists, true, "New log file should exist");
    });
    

    test("should not log messages below the configured log level", async () => {
        logger.log("1", "This is a trace message");

        const logExists = await fsExists(logFilePathOfLogger);
        assert.strictEqual(logExists, false, "Log file should not exist for trace level");
    });
    */
});
