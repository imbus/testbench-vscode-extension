/**
 * @file src/test/suite/reportHandler.test.ts
 * @description This file contains unit tests for the report handler functionality.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";
import * as configuration from "../../configuration";
import { ConfigKeys } from "../../constants";
import { analyzeImportResult } from "../../reportHandler";

suite("ReportHandler Test Suite", function () {
    let testEnv: TestEnvironment;
    let mockConfig: vscode.WorkspaceConfiguration;

    this.beforeEach(() => {
        testEnv = setupTestEnvironment();

        mockConfig = {
            get: testEnv.sandbox.stub().returns(false),
            has: testEnv.sandbox.stub().returns(true),
            inspect: testEnv.sandbox.stub(),
            update: testEnv.sandbox.stub().resolves()
        } as any;

        testEnv.sandbox.stub(configuration, "getExtensionConfiguration").returns(mockConfig);

        testEnv.vscodeMocks.executeCommandStub.resolves(undefined);
    });

    this.afterEach(() => {
        testEnv.sandbox.restore();
    });

    suite("Testing View Configuration Behavior", () => {
        test("should use correct configuration key", () => {
            const configGetStub = mockConfig.get as sinon.SinonStub;
            configGetStub.withArgs(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false).returns(true);

            const result = configuration
                .getExtensionConfiguration()
                .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false);

            assert.ok(
                configGetStub.calledWith(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false),
                "Should use the correct configuration key"
            );
            assert.strictEqual(result, true, "Should return the configured value");
        });

        test("should handle configuration with default value correctly", () => {
            const configGetStub = mockConfig.get as sinon.SinonStub;

            const result = configuration
                .getExtensionConfiguration()
                .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false);

            assert.ok(
                configGetStub.calledWith(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false),
                "Should call configuration with default value"
            );
            assert.strictEqual(result, false, "Should return default value when not configured");
        });

        test("should handle enabled configuration correctly", () => {
            const configGetStub = mockConfig.get as sinon.SinonStub;
            configGetStub.withArgs(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false).returns(true);

            const result = configuration
                .getExtensionConfiguration()
                .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false);

            assert.strictEqual(result, true, "Should return true when setting is enabled");
        });

        test("should handle disabled configuration correctly", () => {
            const configGetStub = mockConfig.get as sinon.SinonStub;
            configGetStub.withArgs(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false).returns(false);

            const result = configuration
                .getExtensionConfiguration()
                .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false);

            assert.strictEqual(result, false, "Should return false when setting is disabled");
        });

        test("should open testing view when setting is enabled", async () => {
            const configGetStub = mockConfig.get as sinon.SinonStub;
            configGetStub.withArgs(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false).returns(true);

            if (
                configuration
                    .getExtensionConfiguration()
                    .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false)
            ) {
                await vscode.commands.executeCommand("workbench.view.extension.test");
            }

            assert.ok(
                testEnv.vscodeMocks.executeCommandStub.calledWith("workbench.view.extension.test"),
                "Testing view should be opened when setting is enabled"
            );
        });

        test("should not open testing view when setting is disabled", async () => {
            const configGetStub = mockConfig.get as sinon.SinonStub;
            configGetStub.withArgs(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false).returns(false);

            if (
                configuration
                    .getExtensionConfiguration()
                    .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false)
            ) {
                await vscode.commands.executeCommand("workbench.view.extension.test");
            }

            assert.ok(
                !testEnv.vscodeMocks.executeCommandStub.calledWith("workbench.view.extension.test"),
                "Testing view should not be opened when setting is disabled"
            );
        });
    });

    suite("analyzeImportResult", () => {
        test("returns success=false when ExecutionImportingSuccess is missing", () => {
            const summary = analyzeImportResult({} as any);

            assert.strictEqual(summary.success, false);
            assert.strictEqual(summary.importedTestCaseSetCount, 0);
            assert.strictEqual(summary.importedTestCaseCount, 0);
            assert.deepStrictEqual(summary.importedTestCaseSetNames, []);
            assert.deepStrictEqual(summary.testCaseSetErrors, []);
            assert.deepStrictEqual(summary.testCaseWarnings, []);
        });

        test("counts imported sets/cases and collects warnings for non-imported cases", () => {
            const summary = analyzeImportResult({
                completion: {
                    result: {
                        ExecutionImportingSuccess: {
                            testCaseSets: [
                                {
                                    key: "set-1",
                                    executionKey: "exec-set-1",
                                    name: "Set A",
                                    finished: true,
                                    error: null,
                                    testCases: [
                                        { uid: "tc-1", importResult: "Imported", error: null, warnings: [] },
                                        { uid: "tc-2", importResult: "Skipped", error: null, warnings: [] }
                                    ]
                                }
                            ]
                        }
                    }
                }
            } as any);

            assert.strictEqual(summary.success, true);
            assert.strictEqual(summary.importedTestCaseSetCount, 1);
            assert.strictEqual(summary.importedTestCaseCount, 1);
            assert.deepStrictEqual(summary.importedTestCaseSetNames, ["Set A"]);
            assert.strictEqual(summary.testCaseSetErrors.length, 0);
            assert.strictEqual(summary.testCaseWarnings.length, 1);
            assert.ok(summary.testCaseWarnings[0].includes("tc-2"));
            assert.ok(summary.testCaseWarnings[0].includes("Skipped"));
        });

        test("reports zero imported test cases while still returning success=true", () => {
            const summary = analyzeImportResult({
                completion: {
                    result: {
                        ExecutionImportingSuccess: {
                            testCaseSets: [
                                {
                                    key: "set-1",
                                    executionKey: "exec-set-1",
                                    name: "Set A",
                                    finished: true,
                                    error: null,
                                    testCases: [{ uid: "tc-1", importResult: "Skipped", error: null, warnings: [] }]
                                }
                            ]
                        }
                    }
                }
            } as any);

            assert.strictEqual(summary.success, true);
            assert.strictEqual(summary.importedTestCaseSetCount, 0);
            assert.strictEqual(summary.importedTestCaseCount, 0);
            assert.deepStrictEqual(summary.importedTestCaseSetNames, []);
            assert.strictEqual(summary.testCaseWarnings.length, 1);
        });

        test("collects test case set errors and test case warnings/errors", () => {
            const summary = analyzeImportResult({
                completion: {
                    result: {
                        ExecutionImportingSuccess: {
                            testCaseSets: [
                                {
                                    key: "set-1",
                                    executionKey: "exec-set-1",
                                    name: "Set A",
                                    finished: false,
                                    error: { message: "Set-level failure", description: "desc" },
                                    testCases: [
                                        {
                                            uid: "tc-1",
                                            importResult: "Failed",
                                            error: { message: "tc-failed", description: "tc-desc" },
                                            warnings: ["warning-1", "warning-2"]
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                }
            } as any);

            assert.strictEqual(summary.success, true);
            assert.strictEqual(summary.importedTestCaseSetCount, 0);
            assert.strictEqual(summary.importedTestCaseCount, 0);
            assert.strictEqual(summary.testCaseSetErrors.length, 2);
            assert.ok(summary.testCaseSetErrors.some((entry) => entry.includes("Set-level failure")));
            assert.ok(summary.testCaseSetErrors.some((entry) => entry.includes("did not finish")));
            assert.strictEqual(summary.testCaseWarnings.length, 2);
            assert.ok(
                summary.testCaseWarnings.some((entry) => entry.includes("Failed") && entry.includes("tc-failed"))
            );
            assert.ok(
                summary.testCaseWarnings.some((entry) => entry.includes("warning-1") && entry.includes("warning-2"))
            );
        });

        test("deduplicates test case sets by executionKey/key/uid identifier", () => {
            const summary = analyzeImportResult({
                completion: {
                    result: {
                        ExecutionImportingSuccess: {
                            testCaseSets: [
                                {
                                    key: "set-1",
                                    executionKey: "dup-id",
                                    name: "Set A",
                                    finished: true,
                                    error: null,
                                    testCases: [{ uid: "tc-1", importResult: "Imported", error: null, warnings: [] }]
                                },
                                {
                                    key: "set-1-copy",
                                    executionKey: "dup-id",
                                    name: "Set A Duplicate",
                                    finished: true,
                                    error: null,
                                    testCases: [{ uid: "tc-2", importResult: "Imported", error: null, warnings: [] }]
                                }
                            ]
                        }
                    }
                }
            } as any);

            assert.strictEqual(summary.importedTestCaseSetCount, 1);
            assert.strictEqual(summary.importedTestCaseCount, 1);
            assert.deepStrictEqual(summary.importedTestCaseSetNames, ["Set A"]);
        });

        test("handles null/undefined nested fields gracefully", () => {
            const summary = analyzeImportResult({
                completion: {
                    result: {
                        ExecutionImportingSuccess: {
                            testCaseSets: [
                                {
                                    key: "set-1",
                                    executionKey: "exec-set-1",
                                    name: null,
                                    finished: true,
                                    error: null,
                                    testCases: [
                                        {
                                            uid: undefined,
                                            importResult: undefined,
                                            error: null,
                                            warnings: undefined
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                }
            } as any);

            assert.strictEqual(summary.success, true);
            assert.strictEqual(summary.importedTestCaseSetCount, 0);
            assert.strictEqual(summary.importedTestCaseCount, 0);
            assert.strictEqual(summary.testCaseWarnings.length, 1);
            assert.ok(summary.testCaseWarnings[0].includes("Unknown"));
        });
    });
});
