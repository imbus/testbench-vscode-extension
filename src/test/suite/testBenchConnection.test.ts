/**
 * @file src/test/suite/testBenchConnection.test.ts
 * @description Unit tests for the TestBench connection functionality.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import * as https from "https";
import * as testBenchConnection from "../../testBenchConnection";
import { LegacyPlayServerClient } from "../../api/LegacyPlayServerClient";
import { allExtensionCommands } from "../../constants";
import { setLogger } from "../../extension";
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";

const MOCK_SERVER_HOST = "mock-server.local";
const MOCK_NEW_PLAY_SERVER_PORT = 12345;
const MOCK_SESSION_TOKEN = "mock-session-token";
const MOCK_USERNAME = "mock-user";
const MOCK_TOV_KEY = "mock-tov-key";
const MOCK_PROJECTS_ENDPOINT = "/mock/projects";
const MOCK_NETWORK_ERROR_MESSAGE = "Mock network unavailable";
const MOCK_LEGACY_API_FAILURE_MESSAGE = "Mock legacy API unavailable";

function createMockAxiosNetworkError(url: string): any {
    const networkError: any = new Error(MOCK_NETWORK_ERROR_MESSAGE);
    networkError.isAxiosError = true;
    networkError.config = { url };
    return networkError;
}

suite("testBenchConnection", function () {
    let testEnv: TestEnvironment;

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        setLogger(testEnv.logger as any);
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("withRetry", () => {
        test("does not force logout on network errors when forceLogoutOnNetworkError is false", async () => {
            const networkError = createMockAxiosNetworkError(MOCK_PROJECTS_ENDPOINT);

            await assert.rejects(async () => {
                await testBenchConnection.withRetry(
                    async () => {
                        throw networkError;
                    },
                    0,
                    0,
                    undefined,
                    false,
                    false
                );
            });

            sinon.assert.neverCalledWith(testEnv.vscodeMocks.executeCommandStub, allExtensionCommands.logout);
            sinon.assert.notCalled(testEnv.vscodeMocks.showWarningMessageStub);
        });

        test("forces logout on network errors when forceLogoutOnNetworkError is true", async () => {
            const networkError = createMockAxiosNetworkError(MOCK_PROJECTS_ENDPOINT);

            await assert.rejects(
                async () => {
                    await testBenchConnection.withRetry(
                        async () => {
                            throw networkError;
                        },
                        0,
                        0,
                        undefined,
                        false,
                        true
                    );
                },
                (error: any) => error instanceof testBenchConnection.TestBenchConnectionError
            );

            sinon.assert.calledWith(testEnv.vscodeMocks.executeCommandStub, allExtensionCommands.logout);
            sinon.assert.calledOnce(testEnv.vscodeMocks.showWarningMessageStub);
        });

        test("forces logout on network errors by default when forceLogoutOnNetworkError is omitted", async () => {
            const networkError = createMockAxiosNetworkError(MOCK_PROJECTS_ENDPOINT);

            await assert.rejects(
                async () => {
                    await testBenchConnection.withRetry(
                        async () => {
                            throw networkError;
                        },
                        0,
                        0,
                        undefined,
                        false
                    );
                },
                (error: any) => error instanceof testBenchConnection.TestBenchConnectionError
            );

            sinon.assert.calledWith(testEnv.vscodeMocks.executeCommandStub, allExtensionCommands.logout);
            sinon.assert.calledOnce(testEnv.vscodeMocks.showWarningMessageStub);
        });
    });

    suite("LegacyPlayServerClient", () => {
        test("shows user warning that session remains active when fetching test elements fails", async () => {
            const withRetryStub = testEnv.sandbox
                .stub(testBenchConnection, "withRetry")
                .rejects(new Error(MOCK_LEGACY_API_FAILURE_MESSAGE));

            const client = new LegacyPlayServerClient(
                MOCK_SERVER_HOST,
                MOCK_NEW_PLAY_SERVER_PORT,
                MOCK_SESSION_TOKEN,
                MOCK_USERNAME,
                new https.Agent(),
                testEnv.mockContext
            );

            const result = await client.getTestElements(MOCK_TOV_KEY);

            assert.strictEqual(result, null);
            sinon.assert.calledOnce(withRetryStub);
            sinon.assert.calledOnce(testEnv.vscodeMocks.showWarningMessageStub);
            sinon.assert.notCalled(testEnv.vscodeMocks.showErrorMessageStub);
        });

        test("shows user warning that session remains active when fetching filters fails", async () => {
            const withRetryStub = testEnv.sandbox
                .stub(testBenchConnection, "withRetry")
                .rejects(new Error(MOCK_LEGACY_API_FAILURE_MESSAGE));

            const client = new LegacyPlayServerClient(
                MOCK_SERVER_HOST,
                MOCK_NEW_PLAY_SERVER_PORT,
                MOCK_SESSION_TOKEN,
                MOCK_USERNAME,
                new https.Agent(),
                testEnv.mockContext
            );

            const filterResult = await client.getFilters();

            assert.strictEqual(filterResult, null);
            sinon.assert.calledOnce(withRetryStub);
            sinon.assert.calledOnce(testEnv.vscodeMocks.showWarningMessageStub);
            sinon.assert.notCalled(testEnv.vscodeMocks.showErrorMessageStub);
        });
    });
});
