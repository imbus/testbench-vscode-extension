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
        access: sinon.SinonStub;
        writeFile: sinon.SinonStub;
    };
    let configStub: sinon.SinonStub;
    let vscodeConfigStub: sinon.SinonStub;
    let utilsStub: sinon.SinonStub;

    this.beforeEach(async () => {
        testEnv = setupTestEnvironment();

        const mockConfig = createMockWorkspaceConfiguration(testEnv.sandbox, {
            [ConfigKeys.LOGGER_LEVEL]: "Info"
        });

        configStub = testEnv.sandbox.stub(configuration, "getExtensionConfiguration").returns(mockConfig);
        vscodeConfigStub = testEnv.vscodeMocks.getConfigurationStub;
        vscodeConfigStub.returns(mockConfig);

        utilsStub = testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");

        fsStubs = {
            mkdir: testEnv.sandbox.stub(fs.promises, "mkdir").resolves(),
            appendFile: testEnv.sandbox.stub(fs.promises, "appendFile").resolves(),
            stat: testEnv.sandbox.stub(fs.promises, "stat"),
            readdir: testEnv.sandbox.stub(fs.promises, "readdir"),
            rename: testEnv.sandbox.stub(fs.promises, "rename").resolves(),
            unlink: testEnv.sandbox.stub(fs.promises, "unlink").resolves(),
            access: testEnv.sandbox.stub(fs.promises, "access").resolves(),
            writeFile: testEnv.sandbox.stub(fs.promises, "writeFile").resolves()
        };

        // When stat is called for the log file, simulate it not existing (ENOENT)
        const enoentError = new Error("File not found");
        (enoentError as any).code = "ENOENT";
        fsStubs.stat.rejects(enoentError);

        testEnv.sandbox.stub(console, "log");
        testEnv.sandbox.stub(console, "error");

        logger = new TestBenchLogger();
        await logger["initPromise"];
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
        vscodeConfigStub.returns(mockConfig);

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
        vscodeConfigStub.returns(mockConfig);

        const wasUpdated = logger.updateCachedLogLevel();

        assert.ok(wasUpdated);
        assert.strictEqual(logger.level, "Debug");
        assert.strictEqual(logger.getLevelNumber(), 2);
    });

    test("should automatically update log level when configuration changes", async () => {
        // Initial level should be Info
        assert.strictEqual(logger.level, "Info");
        assert.strictEqual(logger.getLevelNumber(), 3);

        const newMockConfig = createMockWorkspaceConfiguration(testEnv.sandbox, {
            [ConfigKeys.LOGGER_LEVEL]: "Debug"
        });
        configStub.returns(newMockConfig);
        vscodeConfigStub.returns(newMockConfig);

        // Logger has its own configuration listener that updates the level.
        // Call updateCachedLogLevel to simulate automatic update
        const wasUpdated = logger.updateCachedLogLevel();

        assert.ok(wasUpdated);
        assert.strictEqual(logger.level, "Debug");
        assert.strictEqual(logger.getLevelNumber(), 2);
        assert.ok(logger.isLevelEnabled("Debug"));
        assert.ok(logger.isLevelEnabled("Info"));
        assert.ok(logger.isLevelEnabled("Warn"));
        assert.ok(logger.isLevelEnabled("Error"));
        assert.ok(!logger.isLevelEnabled("Trace"));
    });

    test("should not update log level when configuration hasn't changed", () => {
        const currentLevel = logger.level;
        const mockConfig = createMockWorkspaceConfiguration(testEnv.sandbox, {
            [ConfigKeys.LOGGER_LEVEL]: currentLevel
        });
        configStub.returns(mockConfig);
        vscodeConfigStub.returns(mockConfig);

        const wasUpdated = logger.updateCachedLogLevel();

        assert.ok(!wasUpdated);
        assert.strictEqual(logger.level, currentLevel);
    });

    test("should create log directory during initialization", async () => {
        fsStubs.mkdir.reset();
        fsStubs.mkdir.resolves();

        const newLogger = new TestBenchLogger();
        await newLogger["initPromise"];
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.ok(fsStubs.mkdir.calledOnce);
        assert.ok(fsStubs.mkdir.calledWith(path.join("/test/workspace", ".testbench", "logs"), { recursive: true }));
    });

    test("should handle permission errors during directory creation", async () => {
        const permissionError = new Error("Permission denied");
        (permissionError as any).code = "EPERM";
        fsStubs.mkdir.rejects(permissionError);

        const newLogger = new TestBenchLogger();
        await newLogger["initPromise"];
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.strictEqual(newLogger.level, "Info");
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
        vscodeConfigStub.returns(mockConfig);
        const warnLogger = new TestBenchLogger();
        await warnLogger["initPromise"];

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
        await newLogger["initPromise"];
        await new Promise((resolve) => setTimeout(resolve, 10));

        const expectedLogPath = path.join(workspacePath, ".testbench", "logs", "testBenchExtension.log");
        assert.strictEqual(newLogger.getLogFilePath(), expectedLogPath);
    });

    test("should handle workspace location validation failure", async () => {
        utilsStub.resolves(undefined);

        const newLogger = new TestBenchLogger();
        await newLogger["initPromise"];
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

    test("should recreate missing log file when writing logs", async () => {
        fsStubs.mkdir.reset();
        fsStubs.writeFile.reset();
        fsStubs.appendFile.reset();

        const enoentError = new Error("File not found");
        (enoentError as any).code = "ENOENT";
        fsStubs.access.rejects(enoentError);
        fsStubs.appendFile.resolves();

        const testMessage = "Test message after file recreation";
        await logger.log("Info", testMessage);

        assert.ok(fsStubs.access.calledOnce);
        assert.ok(fsStubs.access.calledWith(logFilePath));
        assert.ok(fsStubs.mkdir.calledWith(logFolderPath, { recursive: true }));
        assert.ok(fsStubs.writeFile.calledOnce);
        assert.ok(fsStubs.writeFile.calledWith(logFilePath, "", { encoding: "utf8" }));
        assert.ok(fsStubs.appendFile.calledOnce);
        const logContent = fsStubs.appendFile.getCall(0).args[1];
        assert.ok(logContent.includes(testMessage));
    });

    test("should handle existing log file without recreation", async () => {
        fsStubs.mkdir.reset();
        fsStubs.writeFile.reset();
        fsStubs.appendFile.reset();

        fsStubs.access.resolves();
        fsStubs.appendFile.resolves();

        const testMessage = "Test message with existing file";
        await logger.log("Info", testMessage);

        assert.ok(fsStubs.access.calledOnce);
        assert.ok(fsStubs.access.calledWith(logFilePath));

        assert.ok(!fsStubs.mkdir.called);
        assert.ok(!fsStubs.writeFile.called);

        assert.ok(fsStubs.appendFile.calledOnce);
        const logContent = fsStubs.appendFile.getCall(0).args[1];
        assert.ok(logContent.includes(testMessage));
    });

    test("should handle errors when recreating log file", async () => {
        fsStubs.mkdir.reset();
        fsStubs.writeFile.reset();
        fsStubs.appendFile.reset();

        const enoentError = new Error("File not found");
        (enoentError as any).code = "ENOENT";
        fsStubs.access.rejects(enoentError);

        const createError = new Error("Permission denied");
        (createError as any).code = "EPERM";
        fsStubs.writeFile.rejects(createError);

        const testMessage = "Test message with file creation error";
        await logger.log("Info", testMessage);

        assert.ok(fsStubs.access.calledOnce);
        assert.ok(fsStubs.mkdir.calledWith(logFolderPath, { recursive: true }));
        assert.ok(fsStubs.writeFile.calledOnce);
        assert.ok(!fsStubs.appendFile.called);
    });

    test("should handle non-ENOENT errors when checking file existence", async () => {
        fsStubs.mkdir.reset();
        fsStubs.writeFile.reset();
        fsStubs.appendFile.reset();

        const otherError = new Error("Permission denied");
        (otherError as any).code = "EPERM";
        fsStubs.access.rejects(otherError);

        const testMessage = "Test message with access error";
        await logger.log("Info", testMessage);

        assert.ok(fsStubs.access.calledOnce);
        assert.ok(!fsStubs.mkdir.called);
        assert.ok(!fsStubs.writeFile.called);
        assert.ok(!fsStubs.appendFile.called);
    });

    test("should sanitize error-like details to message across log levels", async () => {
        const err = new Error("session validation failed");

        await logger.warn("Warn with error", err);

        assert.ok(fsStubs.appendFile.calledOnce);
        const logContent = fsStubs.appendFile.getCall(0).args[1];
        assert.ok(logContent.includes("session validation failed"));
        assert.ok(!logContent.includes("stack"));
    });

    test("should keep non-error objects fully logged", async () => {
        const responsePayload = { message: "ok", items: [{ id: 1, name: "node" }] };

        await logger.info("Response payload", responsePayload);

        assert.ok(fsStubs.appendFile.calledOnce);
        const logContent = fsStubs.appendFile.getCall(0).args[1];
        assert.ok(logContent.includes("items"));
        assert.ok(logContent.includes("node"));
    });

    test("should handle concurrent log writes with missing file", async () => {
        fsStubs.mkdir.reset();
        fsStubs.writeFile.reset();
        fsStubs.appendFile.reset();

        const enoentError = new Error("File not found");
        (enoentError as any).code = "ENOENT";
        fsStubs.access.rejects(enoentError);
        fsStubs.appendFile.resolves();

        // 3 concurrent log writes
        const promises = [];
        for (let i = 0; i < 3; i++) {
            promises.push(logger.log("Info", `Concurrent message ${i}`));
        }

        await Promise.all(promises);

        assert.ok(fsStubs.access.callCount >= 3);

        assert.ok(fsStubs.mkdir.calledWith(logFolderPath, { recursive: true }));
        assert.ok(fsStubs.writeFile.called);
        assert.strictEqual(fsStubs.appendFile.callCount, 3);
    });
});
