/**
 * @file src/test/ui/testConfig.ts
 * @description Test configuration for UI tests, including credentials and connection settings.
 * Credentials are loaded from environment variables to avoid hardcoding sensitive data.
 */

import * as path from "path";
import * as fs from "fs";

/**
 * Loads environment variables from .env files at module initialization.
 * This ensures env vars are available even if runUITests.ts wasn't used.
 */
(function loadEnvVars() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const dotenv = require("dotenv");

        // Try multiple possible locations for the .env file
        const possiblePaths = [
            path.resolve(process.cwd(), "testBenchConnection.env"), // Current working directory
            path.resolve(process.cwd(), ".env"), // Standard .env file
            path.resolve(__dirname, "../../../testBenchConnection.env"), // Project root (from compiled out/test/ui)
            path.resolve(__dirname, "../../../.env") // Project root .env
        ];

        for (const envPath of possiblePaths) {
            if (fs.existsSync(envPath)) {
                const result = dotenv.config({ path: envPath, override: false });
                if (!result.error) {
                    console.log(`[TestConfig] Loaded env file from: ${envPath}`);
                    break;
                }
            }
        }
    } catch {
        // dotenv is optional - if not available, env vars must be set manually
        // Don't log error as it's expected in some environments
    }
})();

/**
 * Test credentials interface for TestBench connection.
 * All values should be provided via environment variables.
 */
export interface TestCredentials {
    connectionLabel: string;
    serverName: string;
    portNumber: string;
    username: string;
    password: string;
}

/**
 * Environment variable names for test credentials and configuration.
 */
const ENV_VARS = {
    TESTBENCH_CONNECTION_LABEL: "TESTBENCH_TEST_CONNECTION_LABEL",
    TESTBENCH_SERVER_NAME: "TESTBENCH_TEST_SERVER_NAME",
    TESTBENCH_PORT_NUMBER: "TESTBENCH_TEST_PORT_NUMBER",
    TESTBENCH_USERNAME: "TESTBENCH_TEST_USERNAME",
    TESTBENCH_PASSWORD: "TESTBENCH_TEST_PASSWORD",
    UI_TEST_SLOW_MOTION: "UI_TEST_SLOW_MOTION",
    UI_TEST_SLOW_MOTION_DELAY: "UI_TEST_SLOW_MOTION_DELAY"
} as const;

/**
 * Default test credentials (fallback values for local development).
 * These should only be used when environment variables are not set.
 */
const DEFAULT_CREDENTIALS: TestCredentials = {
    connectionLabel: "TestLabel",
    serverName: "testServerName.com",
    portNumber: "9445",
    username: "testUsername",
    password: "testPassword"
};

/**
 * Gets test credentials from environment variables.
 * Falls back to default values ONLY if environment variables are not set.
 * Environment variables take priority over defaults.
 *
 * @returns TestCredentials object
 * @throws Error if required credentials are missing and no defaults are available
 */
export function getTestCredentials(): TestCredentials {
    // Helper to check if env var is set and not empty
    const getEnvVar = (envVar: string, defaultValue: string): string => {
        const value = process.env[envVar];
        // Only use default if env var is undefined, null, or empty string
        if (value === undefined || value === null || value.trim() === "") {
            return defaultValue;
        }
        return value.trim();
    };

    // Debug: Log what we're reading from environment
    console.log("[TestConfig] Reading credentials from environment:");
    console.log(
        `[TestConfig]   ${ENV_VARS.TESTBENCH_SERVER_NAME}=${process.env[ENV_VARS.TESTBENCH_SERVER_NAME] || "not set"}`
    );
    console.log(
        `[TestConfig]   ${ENV_VARS.TESTBENCH_USERNAME}=${process.env[ENV_VARS.TESTBENCH_USERNAME] || "not set"}`
    );
    console.log(
        `[TestConfig]   ${ENV_VARS.TESTBENCH_PORT_NUMBER}=${process.env[ENV_VARS.TESTBENCH_PORT_NUMBER] || "not set"}`
    );
    console.log(
        `[TestConfig]   ${ENV_VARS.TESTBENCH_CONNECTION_LABEL}=${process.env[ENV_VARS.TESTBENCH_CONNECTION_LABEL] || "not set"}`
    );
    console.log(
        `[TestConfig]   ${ENV_VARS.TESTBENCH_PASSWORD}=${process.env[ENV_VARS.TESTBENCH_PASSWORD] ? "***" : "not set"}`
    );

    const credentials: TestCredentials = {
        connectionLabel: getEnvVar(ENV_VARS.TESTBENCH_CONNECTION_LABEL, DEFAULT_CREDENTIALS.connectionLabel),
        serverName: getEnvVar(ENV_VARS.TESTBENCH_SERVER_NAME, DEFAULT_CREDENTIALS.serverName),
        portNumber: getEnvVar(ENV_VARS.TESTBENCH_PORT_NUMBER, DEFAULT_CREDENTIALS.portNumber),
        username: getEnvVar(ENV_VARS.TESTBENCH_USERNAME, DEFAULT_CREDENTIALS.username),
        password: getEnvVar(ENV_VARS.TESTBENCH_PASSWORD, DEFAULT_CREDENTIALS.password)
    };

    // Log which values are from env vs defaults (for debugging)
    const usingDefaults = {
        connectionLabel: !process.env[ENV_VARS.TESTBENCH_CONNECTION_LABEL]?.trim(),
        serverName: !process.env[ENV_VARS.TESTBENCH_SERVER_NAME]?.trim(),
        portNumber: !process.env[ENV_VARS.TESTBENCH_PORT_NUMBER]?.trim(),
        username: !process.env[ENV_VARS.TESTBENCH_USERNAME]?.trim(),
        password: !process.env[ENV_VARS.TESTBENCH_PASSWORD]?.trim()
    };

    if (usingDefaults.serverName || usingDefaults.username) {
        console.log(
            "[TestConfig] ⚠️  WARNING: Using default values for:",
            Object.entries(usingDefaults)
                .filter(([_, usingDefault]) => usingDefault)
                .map(([key]) => key)
                .join(", ")
        );
        console.log(
            "[TestConfig] Make sure testBenchConnection.env file exists in project root with required variables."
        );
    } else {
        console.log("[TestConfig] ✅ All credentials loaded from environment variables");
    }

    // Validate that we have at least the minimum required credentials
    if (!credentials.serverName || !credentials.username) {
        throw new Error(
            "Missing required test credentials. Please set the following environment variables:\n" +
                `  - ${ENV_VARS.TESTBENCH_SERVER_NAME}\n` +
                `  - ${ENV_VARS.TESTBENCH_USERNAME}\n` +
                `  - ${ENV_VARS.TESTBENCH_PASSWORD}\n` +
                `  - ${ENV_VARS.TESTBENCH_PORT_NUMBER} (optional, defaults to 443)\n` +
                `  - ${ENV_VARS.TESTBENCH_CONNECTION_LABEL} (optional)`
        );
    }

    return credentials;
}

/**
 * Validates that test credentials are available.
 * Useful for skipping tests when credentials are not configured.
 *
 * @returns True if credentials are available, false otherwise
 */
export function hasTestCredentials(): boolean {
    try {
        getTestCredentials();
        return true;
    } catch {
        return false;
    }
}

/**
 * Gets the slow motion delay in milliseconds for UI test actions.
 * When slow motion is enabled, visible actions are delayed to allow human observation.
 *
 * @returns Delay in milliseconds (default: 0, meaning no delay)
 */
export function getSlowMotionDelay(): number {
    const slowMotionEnabled = process.env[ENV_VARS.UI_TEST_SLOW_MOTION];
    if (!slowMotionEnabled || slowMotionEnabled.toLowerCase() !== "true") {
        return 0;
    }

    const delayMs = process.env[ENV_VARS.UI_TEST_SLOW_MOTION_DELAY];
    if (delayMs) {
        const parsed = parseInt(delayMs, 10);
        if (!isNaN(parsed) && parsed > 0) {
            console.log(`[Slow Motion] Enabled with delay: ${parsed}ms`);
            return parsed;
        }
    }

    // Default slow motion delay: 1000ms (1 second)
    console.log(`[Slow Motion] Enabled with default delay: 1000ms`);
    return 1000;
}

/**
 * Checks if slow motion mode is enabled for UI tests.
 *
 * @returns True if slow motion is enabled, false otherwise
 */
export function isSlowMotionEnabled(): boolean {
    return getSlowMotionDelay() > 0;
}
