/**
 * @file src/test/ui/testConfig.ts
 * @description Test configuration for UI tests, including credentials and connection settings.
 * Credentials are loaded from environment variables to avoid hardcoding sensitive data.
 */

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
 * Falls back to default values if environment variables are not set.
 *
 * @returns TestCredentials object
 * @throws Error if required credentials are missing and no defaults are available
 */
export function getTestCredentials(): TestCredentials {
    const credentials: TestCredentials = {
        connectionLabel: process.env[ENV_VARS.TESTBENCH_CONNECTION_LABEL] || DEFAULT_CREDENTIALS.connectionLabel,
        serverName: process.env[ENV_VARS.TESTBENCH_SERVER_NAME] || DEFAULT_CREDENTIALS.serverName,
        portNumber: process.env[ENV_VARS.TESTBENCH_PORT_NUMBER] || DEFAULT_CREDENTIALS.portNumber,
        username: process.env[ENV_VARS.TESTBENCH_USERNAME] || DEFAULT_CREDENTIALS.username,
        password: process.env[ENV_VARS.TESTBENCH_PASSWORD] || DEFAULT_CREDENTIALS.password
    };

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
