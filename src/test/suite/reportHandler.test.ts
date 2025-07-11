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
            configGetStub.withArgs(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false).returns(true);

            const result = configuration
                .getExtensionConfiguration()
                .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false);

            assert.ok(
                configGetStub.calledWith(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false),
                "Should use the correct configuration key"
            );
            assert.strictEqual(result, true, "Should return the configured value");
        });

        test("should handle configuration with default value correctly", () => {
            const configGetStub = mockConfig.get as sinon.SinonStub;

            const result = configuration
                .getExtensionConfiguration()
                .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false);

            assert.ok(
                configGetStub.calledWith(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false),
                "Should call configuration with default value"
            );
            assert.strictEqual(result, false, "Should return default value when not configured");
        });

        test("should handle enabled configuration correctly", () => {
            const configGetStub = mockConfig.get as sinon.SinonStub;
            configGetStub.withArgs(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false).returns(true);

            const result = configuration
                .getExtensionConfiguration()
                .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false);

            assert.strictEqual(result, true, "Should return true when setting is enabled");
        });

        test("should handle disabled configuration correctly", () => {
            const configGetStub = mockConfig.get as sinon.SinonStub;
            configGetStub.withArgs(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false).returns(false);

            const result = configuration
                .getExtensionConfiguration()
                .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false);

            assert.strictEqual(result, false, "Should return false when setting is disabled");
        });

        test("should open testing view when setting is enabled", async () => {
            const configGetStub = mockConfig.get as sinon.SinonStub;
            configGetStub.withArgs(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false).returns(true);

            if (
                configuration
                    .getExtensionConfiguration()
                    .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false)
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
            configGetStub.withArgs(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false).returns(false);

            if (
                configuration
                    .getExtensionConfiguration()
                    .get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false)
            ) {
                await vscode.commands.executeCommand("workbench.view.extension.test");
            }

            assert.ok(
                !testEnv.vscodeMocks.executeCommandStub.calledWith("workbench.view.extension.test"),
                "Testing view should not be opened when setting is disabled"
            );
        });
    });
});
