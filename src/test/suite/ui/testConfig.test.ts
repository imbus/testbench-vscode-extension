/**
 * @file src/test/suite/ui/testConfig.test.ts
 * @description Unit tests for UI test credential readiness validation.
 */

import * as assert from "assert";
import {
    hasTestCredentials,
    getTestCredentials,
    getCredentialReadinessErrorMessage,
    assertCredentialReadinessForStrictMode
} from "../../../test/ui/config/testConfig";

suite("UI Test Credential Readiness", () => {
    const ENV_KEYS = [
        "TESTBENCH_TEST_SERVER_NAME",
        "TESTBENCH_TEST_USERNAME",
        "TESTBENCH_TEST_PASSWORD",
        "TESTBENCH_TEST_PORT_NUMBER",
        "TESTBENCH_TEST_CONNECTION_LABEL",
        "UI_TEST_STRICT_CREDENTIALS",
        "CI"
    ];

    let originalEnv: Record<string, string | undefined> = {};

    setup(() => {
        originalEnv = {};
        for (const key of ENV_KEYS) {
            originalEnv[key] = process.env[key];
            delete process.env[key];
        }
    });

    teardown(() => {
        for (const key of ENV_KEYS) {
            const previousValue = originalEnv[key];
            if (previousValue === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previousValue;
            }
        }
    });

    test("rejects required fallback defaults in non-strict mode", () => {
        assert.strictEqual(hasTestCredentials(), false);

        const message = getCredentialReadinessErrorMessage();
        assert.ok(message);
        assert.ok(message?.includes("Credential fallback defaults are in use"));
        assert.ok(message?.includes("TESTBENCH_TEST_SERVER_NAME"));
    });

    test("accepts explicit env values even when they look like test placeholders", () => {
        process.env.TESTBENCH_TEST_SERVER_NAME = "testServerName.com";
        process.env.TESTBENCH_TEST_USERNAME = "test-username";
        process.env.TESTBENCH_TEST_PASSWORD = "test-password";

        assert.strictEqual(hasTestCredentials(), true);

        const credentials = getTestCredentials();
        assert.strictEqual(credentials.serverName, "testServerName.com");
        assert.strictEqual(credentials.username, "test-username");
        assert.strictEqual(credentials.password, "test-password");
    });

    test("fails fast in strict mode when required env vars are missing", () => {
        process.env.CI = "true";

        assert.throws(
            () => assertCredentialReadinessForStrictMode(),
            (error: unknown) =>
                error instanceof Error &&
                error.message.includes("Strict credential mode is enabled") &&
                error.message.includes("TESTBENCH_TEST_SERVER_NAME") &&
                error.message.includes("TESTBENCH_TEST_USERNAME") &&
                error.message.includes("TESTBENCH_TEST_PASSWORD")
        );
    });

    test("allows strict mode override to false in CI", () => {
        process.env.CI = "true";
        process.env.UI_TEST_STRICT_CREDENTIALS = "false";

        assert.doesNotThrow(() => assertCredentialReadinessForStrictMode());
        assert.strictEqual(hasTestCredentials(), false);
    });

    test("accepts explicit non-placeholder credentials in strict mode", () => {
        process.env.CI = "true";
        process.env.TESTBENCH_TEST_SERVER_NAME = "qa-testbench.company.internal";
        process.env.TESTBENCH_TEST_USERNAME = "qa_automation_user";
        process.env.TESTBENCH_TEST_PASSWORD = "superSecretPassword123";
        process.env.TESTBENCH_TEST_PORT_NUMBER = "9445";
        process.env.TESTBENCH_TEST_CONNECTION_LABEL = "CI Connection";

        assert.doesNotThrow(() => assertCredentialReadinessForStrictMode());
        assert.strictEqual(hasTestCredentials(), true);

        const credentials = getTestCredentials();
        assert.strictEqual(credentials.serverName, "qa-testbench.company.internal");
        assert.strictEqual(credentials.username, "qa_automation_user");
        assert.strictEqual(credentials.password, "superSecretPassword123");
        assert.strictEqual(credentials.portNumber, "9445");
        assert.strictEqual(credentials.connectionLabel, "CI Connection");
    });
});
