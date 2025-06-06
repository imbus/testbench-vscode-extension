/**
 * @file src/test/suite/testBenchLogger.test.ts
 * @description This file contains unit tests for the TestBenchLogger class.
 */

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
});
