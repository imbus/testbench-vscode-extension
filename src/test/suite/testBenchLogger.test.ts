/**
 * @file src/test/suite/testBenchLogger.test.ts
 * @description This file contains unit tests for the TestBenchLogger class.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import { TestBenchLogger } from "../../testBenchLogger";
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";
import { createMockWorkspaceConfiguration } from "../utils/stubHelpers";
import { ConfigKeys } from "../../constants";
import { promisify } from "util";
import * as utils from "../../utils";
import * as configuration from "../../configuration";

const fsUnlink = promisify(fs.unlink);
const fsExists = promisify(fs.exists);

suite("TestBenchLogger Tests", function () {
    let testEnv: TestEnvironment;
    let logger: TestBenchLogger;
    let logFilePath: string;
    let logFolderPath: string;
    let fsStubs: {
        mkdir: sinon.SinonStub;
        appendFile: sinon.SinonStub;
        stat: sinon.SinonStub;
        readdir: sinon.SinonStub;
        rename: sinon.SinonStub;
        unlink: sinon.SinonStub;
    };
    let configStub: sinon.SinonStub;
    let utilsStub: sinon.SinonStub;

    this.beforeEach(async () => {
        testEnv = setupTestEnvironment();

        const mockConfig = createMockWorkspaceConfiguration(testEnv.sandbox, {
            [ConfigKeys.LOGGER_LEVEL]: "Info"
        });

        configStub = testEnv.sandbox.stub(configuration, "getExtensionConfiguration").returns(mockConfig);

        utilsStub = testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves(undefined);

        fsStubs = {
            mkdir: testEnv.sandbox.stub(fs.promises, "mkdir").resolves(),
            appendFile: testEnv.sandbox.stub(fs.promises, "appendFile").resolves(),
            stat: testEnv.sandbox.stub(fs.promises, "stat"),
            readdir: testEnv.sandbox.stub(fs.promises, "readdir"),
            rename: testEnv.sandbox.stub(fs.promises, "rename").resolves(),
            unlink: testEnv.sandbox.stub(fs.promises, "unlink").resolves()
        };

        testEnv.sandbox.stub(console, "log");
        testEnv.sandbox.stub(console, "error");

        logger = new TestBenchLogger();
        logFilePath = logger.getLogFilePath();
        logFolderPath = logger.getLogFolderPath();

        // Wait for initialization to complete
        await new Promise((resolve) => setTimeout(resolve, 10));
    });

    this.afterEach(async () => {
        // Clean up any actual log files that might have been created
        try {
            if (await fsExists(logFilePath)) {
                await fsUnlink(logFilePath);
            }
            // Clean up rotated log files
            for (let i = 1; i <= 3; i++) {
                const rotatedLogPath = `${logFilePath}.${i}`;
                if (await fsExists(rotatedLogPath)) {
                    await fsUnlink(rotatedLogPath);
                }
            }
        } catch {
            // Ignore cleanup errors
        }

        testEnv.sandbox.restore();
    });

    test("should initialize with default configuration", () => {
        assert.strictEqual(logger.level, "Info");
        assert.strictEqual(logger.getLevelNumber(), 3);
        assert.ok(logger.isLevelEnabled("Info"));
        assert.ok(logger.isLevelEnabled("Warn"));
        assert.ok(logger.isLevelEnabled("Error"));
        assert.ok(!logger.isLevelEnabled("Debug"));
        assert.ok(!logger.isLevelEnabled("Trace"));
    });

    test("should handle 'No logging' level correctly", () => {
        const mockConfig = createMockWorkspaceConfiguration(testEnv.sandbox, {
            [ConfigKeys.LOGGER_LEVEL]: "No logging"
        });
        configStub.returns(mockConfig);

        const noLoggingLogger = new TestBenchLogger();

        assert.strictEqual(noLoggingLogger.level, "No logging");
        assert.strictEqual(noLoggingLogger.getLevelNumber(), 0);
        assert.ok(!noLoggingLogger.isLevelEnabled("Info"));
    });

    test("should update cached log level when configuration changes", () => {
        const mockConfig = createMockWorkspaceConfiguration(testEnv.sandbox, {
            [ConfigKeys.LOGGER_LEVEL]: "Debug"
        });
        configStub.returns(mockConfig);

        const wasUpdated = logger.updateCachedLogLevel();

        assert.ok(wasUpdated);
        assert.strictEqual(logger.level, "Debug");
        assert.strictEqual(logger.getLevelNumber(), 2);
    });

    test("should create log directory during initialization", async () => {
        fsStubs.mkdir.reset();
        fsStubs.mkdir.resolves();

        new TestBenchLogger();
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.ok(fsStubs.mkdir.calledOnce);
        assert.ok(fsStubs.mkdir.calledWith(logFolderPath, { recursive: true }));
    });

    test("should handle permission errors during directory creation", async () => {
        const permissionError = new Error("Permission denied");
        (permissionError as any).code = "EPERM";
        fsStubs.mkdir.rejects(permissionError);

        const newLogger = new TestBenchLogger();
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(newLogger.level, "No logging");
    });

    test("should write log messages to file", async () => {
        const testMessage = "Test log message";
        const testDetails = { key: "value" };

        await logger.log("Info", testMessage, testDetails);

        assert.ok(fsStubs.appendFile.calledOnce);
        const callArgs = fsStubs.appendFile.getCall(0).args;
        assert.strictEqual(callArgs[0], logFilePath);
        assert.strictEqual(callArgs[2].encoding, "utf8");

        const logContent = callArgs[1];
        assert.ok(logContent.includes(testMessage));
        assert.ok(logContent.includes("INFO"));
        assert.ok(logContent.includes("key"));
        assert.ok(logContent.includes("value"));
    });

    test("should respect log level filtering", async () => {
        const mockConfig = createMockWorkspaceConfiguration(testEnv.sandbox, {
            [ConfigKeys.LOGGER_LEVEL]: "Warn"
        });
        configStub.returns(mockConfig);
        const warnLogger = new TestBenchLogger();

        await warnLogger.log("Debug", "This should not be logged");
        await warnLogger.log("Info", "This should not be logged");
        await warnLogger.log("Warn", "This should be logged");
        await warnLogger.log("Error", "This should be logged");

        assert.strictEqual(fsStubs.appendFile.callCount, 2);
    });

    test("should handle circular references in details", async () => {
        const circularObj: any = { name: "test" };
        circularObj.self = circularObj;

        await logger.log("Info", "Circular reference test", circularObj);

        assert.ok(fsStubs.appendFile.calledOnce);
    });

    test("should handle array details correctly", async () => {
        const testDetails = [{ item1: "value1" }, { item2: "value2" }, "string item"];

        await logger.log("Info", "Array details test", testDetails);

        assert.ok(fsStubs.appendFile.calledOnce);
        const logContent = fsStubs.appendFile.getCall(0).args[1];
        assert.ok(logContent.includes("item1"));
        assert.ok(logContent.includes("value1"));
        assert.ok(logContent.includes("item2"));
        assert.ok(logContent.includes("value2"));
        assert.ok(logContent.includes("string item"));
    });

    test("should handle null and undefined details", async () => {
        await logger.log("Info", "Null details test", null);
        await logger.log("Info", "Undefined details test", undefined);

        assert.strictEqual(fsStubs.appendFile.callCount, 2);

        const call1 = fsStubs.appendFile.getCall(0).args[1];
        const call2 = fsStubs.appendFile.getCall(1).args[1];

        assert.ok(!call1.includes("null"));
        assert.ok(!call2.includes("undefined"));
    });

    test("should handle workspace location changes", async () => {
        const workspacePath = "/test/workspace";
        utilsStub.resolves(workspacePath);

        const newLogger = new TestBenchLogger();
        await new Promise((resolve) => setTimeout(resolve, 10));

        const expectedLogPath = path.join(workspacePath, ".testbench", "logs", "testBenchExtension.log");
        assert.strictEqual(newLogger.getLogFilePath(), expectedLogPath);
    });

    test("should handle workspace location validation failure", async () => {
        utilsStub.resolves(undefined);

        const newLogger = new TestBenchLogger();
        await new Promise((resolve) => setTimeout(resolve, 10));

        const loggerModulePath = require.resolve("../../testBenchLogger");
        const defaultLogPath = path.join(path.dirname(loggerModulePath), "logs", "testBenchExtension.log");
        assert.strictEqual(newLogger.getLogFilePath(), defaultLogPath);
    });

    test("should handle concurrent log writes safely", async () => {
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(logger.log("Info", `Concurrent message ${i}`));
        }

        await Promise.all(promises);
        assert.strictEqual(fsStubs.appendFile.callCount, 5);
    });

    test("should handle large objects in details", async () => {
        const largeObject = {
            array: new Array(1000).fill("test"),
            nested: {
                deep: {
                    object: {
                        with: {
                            many: {
                                levels: "value"
                            }
                        }
                    }
                }
            }
        };

        await logger.log("Info", "Large object test", largeObject);

        assert.ok(fsStubs.appendFile.calledOnce);
        const logContent = fsStubs.appendFile.getCall(0).args[1];
        assert.ok(logContent.includes("levels"));
        assert.ok(logContent.includes("value"));
    });

    test("should handle special characters in log messages", async () => {
        const specialMessage = "Test with special chars: äöüßéèêñç";
        const specialDetails = { unicode: "🎉🚀💻" };

        await logger.log("Info", specialMessage, specialDetails);

        assert.ok(fsStubs.appendFile.calledOnce);
        const logContent = fsStubs.appendFile.getCall(0).args[1];
        assert.ok(logContent.includes(specialMessage));
        assert.ok(logContent.includes("🎉"));
    });
});
