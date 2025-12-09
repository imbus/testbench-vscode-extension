/**
 * @file src/test/ui/testConfig.ts
 * @description Test configuration for UI tests, including credentials and connection settings.
 * Credentials are loaded from environment variables to avoid hardcoding sensitive data.
 */

import * as path from "path";
import * as fs from "fs";
import { getTestLogger } from "./testLogger";

const logger = getTestLogger();

/**
 * Test folder and file names for UI test setup.
 */
export const TEST_PATHS = {
    /** Base directory for all test artifacts (relative to project root) */
    BASE_STORAGE: ".test-resources",
    /** Subdirectory for VS Code binaries and data */
    VSCODE_DATA: "vscode-data",
    /** Subdirectory for installed extensions */
    EXTENSIONS: "extensions",
    /** Subdirectory for runtime workspace used during tests */
    WORKSPACE: "workspace",
    /** Source directory for test fixtures (relative to project root) */
    FIXTURES: "src/test/ui/fixtures",
    /** Package.json file name */
    PACKAGE_JSON: "package.json",
    /** VS Code test settings file (relative to project root) */
    VSCODE_TEST_SETTINGS: "./src/test/ui/.vscode-test.settings.json",
    /** Output directory for generated Robot Framework test files (relative to workspace) */
    ROBOT_OUTPUT_DIR: "tests",
    /** Output XML file path for Robot Framework results (relative to workspace) */
    ROBOT_OUTPUT_XML: "results/output.xml"
} as const;

/**
 * Gets the absolute path to the Robot Framework output directory.
 * This is where generated .robot files are placed.
 *
 * @param workspaceRoot - Optional workspace root path. If not provided, uses TEST_PATHS.WORKSPACE
 * @returns Absolute path to the output directory
 */
export function getRobotOutputDirectory(workspaceRoot?: string): string {
    const root = workspaceRoot || path.resolve(__dirname, "../../../", TEST_PATHS.BASE_STORAGE, TEST_PATHS.WORKSPACE);
    return path.join(root, TEST_PATHS.ROBOT_OUTPUT_DIR);
}

/**
 * Gets the absolute path to the Robot Framework output XML file.
 * This is where test execution results are stored.
 *
 * @param workspaceRoot - Optional workspace root path. If not provided, uses TEST_PATHS.WORKSPACE
 * @returns Absolute path to the output XML file
 */
export function getRobotOutputXmlPath(workspaceRoot?: string): string {
    const root = workspaceRoot || path.resolve(__dirname, "../../../", TEST_PATHS.BASE_STORAGE, TEST_PATHS.WORKSPACE);
    return path.join(root, TEST_PATHS.ROBOT_OUTPUT_XML);
}

/**
 * Flag to ensure environment loading only happens once (singleton pattern).
 */
let envLoaded = false;

/**
 * Centralized idempotent function to load environment variables from .env files.
 *
 * @param projectRoot - Optional project root path. If not provided, will be calculated from __dirname.
 * @returns True if at least one env file was loaded successfully, false otherwise
 */
export function loadEnv(projectRoot?: string): boolean {
    if (envLoaded) {
        return true;
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const dotenv = require("dotenv");

        const root = projectRoot || path.resolve(__dirname, "../../../");

        // Try multiple possible locations for the .env file in priority order
        const possiblePaths = [
            path.join(root, "testBenchConnection.env"),
            path.join(root, ".env"),
            path.resolve(process.cwd(), "testBenchConnection.env"),
            path.resolve(process.cwd(), ".env"),
            path.resolve(process.cwd(), ".testbenchConnection.env")
        ];

        let loadedAny = false;
        for (const envPath of possiblePaths) {
            if (fs.existsSync(envPath)) {
                const result = dotenv.config({ path: envPath, override: false });
                if (!result.error) {
                    logger.info("Env", `Loaded env file from: ${envPath}`);
                    loadedAny = true;
                    // Continue to try other files (don't break) to allow multiple env files
                } else {
                    logger.warn("Env", `Error loading env file from ${envPath}:`, result.error);
                }
            }
        }

        if (!loadedAny) {
            logger.warn("Env", "No .env files found. Environment variables must be set manually.");
            logger.trace("Env", `Looked in: ${possiblePaths.join(", ")}`);
        }

        logger.trace("Env", `TESTBENCH_TEST_SERVER_NAME=${process.env.TESTBENCH_TEST_SERVER_NAME || "not set"}`);
        logger.trace("Env", `TESTBENCH_TEST_USERNAME=${process.env.TESTBENCH_TEST_USERNAME || "not set"}`);
        logger.trace("Env", `TESTBENCH_TEST_PORT_NUMBER=${process.env.TESTBENCH_TEST_PORT_NUMBER || "not set"}`);
        logger.trace(
            "Env",
            `TESTBENCH_TEST_CONNECTION_LABEL=${process.env.TESTBENCH_TEST_CONNECTION_LABEL || "not set"}`
        );
        logger.trace("Env", `UI_TEST_SLOW_MOTION=${process.env.UI_TEST_SLOW_MOTION || "not set"}`);
        logger.trace("Env", `UI_TEST_SLOW_MOTION_DELAY=${process.env.UI_TEST_SLOW_MOTION_DELAY || "not set"}`);

        envLoaded = true;
        return loadedAny;
    } catch (error) {
        // dotenv is optional, if not available, env vars must be set manually
        logger.error("Env", "Error loading .env files:", error);
        logger.info("Env", "Continuing without .env file - environment variables must be set manually");
        envLoaded = true; // Mark as loaded to prevent retry loops
        return false;
    }
}

/**
 * Loads environment variables from .env files at module initialization.
 * This ensures env vars are available even if runUITests.ts wasn't used.
 * This is called automatically when the module is imported for backward compatibility.
 */
loadEnv();

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
    UI_TEST_SLOW_MOTION_DELAY: "UI_TEST_SLOW_MOTION_DELAY",
    // Test data environment variables
    TEST_PROJECT_NAME: "TEST_PROJECT_NAME",
    TEST_VERSION_NAME: "TEST_VERSION_NAME",
    TEST_CYCLE_NAME: "TEST_CYCLE_NAME",
    TEST_SUBDIVISION_NAME: "TEST_SUBDIVISION_NAME",
    TEST_RESOURCE_FILE_NAME: "TEST_RESOURCE_FILE_NAME",
    TEST_THEME_NAME: "TEST_THEME_NAME",
    // Logging configuration
    UI_TEST_LOG_LEVEL: "UI_TEST_LOG_LEVEL",
    UI_TEST_LOG_TO_FILE: "UI_TEST_LOG_TO_FILE",
    UI_TEST_LOG_TO_CONSOLE: "UI_TEST_LOG_TO_CONSOLE"
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
    logger.trace("TestConfig", "Reading credentials from environment:");
    logger.trace(
        "TestConfig",
        `  ${ENV_VARS.TESTBENCH_SERVER_NAME}=${process.env[ENV_VARS.TESTBENCH_SERVER_NAME] || "not set"}`
    );
    logger.trace(
        "TestConfig",
        `  ${ENV_VARS.TESTBENCH_USERNAME}=${process.env[ENV_VARS.TESTBENCH_USERNAME] || "not set"}`
    );
    logger.trace(
        "TestConfig",
        `  ${ENV_VARS.TESTBENCH_PORT_NUMBER}=${process.env[ENV_VARS.TESTBENCH_PORT_NUMBER] || "not set"}`
    );
    logger.trace(
        "TestConfig",
        `  ${ENV_VARS.TESTBENCH_CONNECTION_LABEL}=${process.env[ENV_VARS.TESTBENCH_CONNECTION_LABEL] || "not set"}`
    );
    logger.trace(
        "TestConfig",
        `  ${ENV_VARS.TESTBENCH_PASSWORD}=${process.env[ENV_VARS.TESTBENCH_PASSWORD] ? "***" : "not set"}`
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
        logger.warn(
            "TestConfig",
            "⚠️  WARNING: Using default values for: " +
                Object.entries(usingDefaults)
                    .filter(([_, usingDefault]) => usingDefault)
                    .map(([key]) => key)
                    .join(", ")
        );
        logger.warn(
            "TestConfig",
            "Make sure testBenchConnection.env file exists in project root with required variables."
        );
    } else {
        logger.info("TestConfig", "All credentials loaded from environment variables");
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
            logger.info("Slow Motion", `Enabled with delay: ${parsed}ms`);
            return parsed;
        }
    }

    // Default slow motion delay: 1000ms (1 second)
    logger.info("Slow Motion", "Enabled with default delay: 1000ms");
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

// ============================================
// Test Data Configuration
// ============================================

/**
 * Interface for TestBench project hierarchy test data.
 * Used to configure which project, version, cycle, etc. to use in tests.
 */
export interface TestDataConfig {
    /** Project name to navigate to (e.g., "TestBench Demo Agil") */
    projectName: string;
    /** Version/TOV name within the project (e.g., "Version 3.0") */
    versionName: string;
    /** Cycle name within the version (e.g., "3.0.2") */
    cycleName: string;
    /** Subdivision name for resource creation tests (e.g., "Resource Subdivision") */
    subdivisionName: string;
    /** Expected resource file name (e.g., "Resource Subdivision.resource") */
    resourceFileName: string;
    /** Test theme name for test generation tests (e.g., "Reihenfolge") */
    testThemeName: string;
}

/**
 * Default test data values.
 * These are used when environment variables are not set.
 */
const DEFAULT_TEST_DATA: TestDataConfig = {
    projectName: "TestBench Demo Agil 1",
    versionName: "Version 3.0",
    cycleName: "3.0.2",
    subdivisionName: "Resource Subdivision 1",
    resourceFileName: "Resource Subdivision 1.resource",
    testThemeName: "Reihenfolge"
};

/**
 * Gets test data configuration from environment variables.
 * Falls back to default values if environment variables are not set.
 *
 * Environment variables:
 * - TEST_PROJECT_NAME: Project name to use in tests
 * - TEST_VERSION_NAME: Version/TOV name to use in tests
 * - TEST_CYCLE_NAME: Cycle name to use in tests
 * - TEST_SUBDIVISION_NAME: Subdivision name for resource tests
 * - TEST_RESOURCE_FILE_NAME: Expected resource file name
 * - TEST_THEME_NAME: Test theme name for test generation tests
 *
 * @returns TestDataConfig object with test data values
 */
export function getTestData(): TestDataConfig {
    const getEnvVar = (envVar: string, defaultValue: string): string => {
        const value = process.env[envVar];
        if (value === undefined || value === null || value.trim() === "") {
            return defaultValue;
        }
        return value.trim();
    };

    const testData: TestDataConfig = {
        projectName: getEnvVar(ENV_VARS.TEST_PROJECT_NAME, DEFAULT_TEST_DATA.projectName),
        versionName: getEnvVar(ENV_VARS.TEST_VERSION_NAME, DEFAULT_TEST_DATA.versionName),
        cycleName: getEnvVar(ENV_VARS.TEST_CYCLE_NAME, DEFAULT_TEST_DATA.cycleName),
        subdivisionName: getEnvVar(ENV_VARS.TEST_SUBDIVISION_NAME, DEFAULT_TEST_DATA.subdivisionName),
        resourceFileName: getEnvVar(ENV_VARS.TEST_RESOURCE_FILE_NAME, DEFAULT_TEST_DATA.resourceFileName),
        testThemeName: getEnvVar(ENV_VARS.TEST_THEME_NAME, DEFAULT_TEST_DATA.testThemeName)
    };

    return testData;
}

/**
 * Logs the current test data configuration.
 * Useful for debugging which values are being used.
 */
export function logTestDataConfig(): void {
    const testData = getTestData();
    const usingDefaults = {
        projectName: !process.env[ENV_VARS.TEST_PROJECT_NAME]?.trim(),
        versionName: !process.env[ENV_VARS.TEST_VERSION_NAME]?.trim(),
        cycleName: !process.env[ENV_VARS.TEST_CYCLE_NAME]?.trim(),
        subdivisionName: !process.env[ENV_VARS.TEST_SUBDIVISION_NAME]?.trim(),
        resourceFileName: !process.env[ENV_VARS.TEST_RESOURCE_FILE_NAME]?.trim(),
        testThemeName: !process.env[ENV_VARS.TEST_THEME_NAME]?.trim()
    };

    logger.info("TestData", "Current test data configuration:");
    logger.info("TestData", `  Project: "${testData.projectName}"${usingDefaults.projectName ? " (default)" : ""}`);
    logger.info("TestData", `  Version: "${testData.versionName}"${usingDefaults.versionName ? " (default)" : ""}`);
    logger.info("TestData", `  Cycle: "${testData.cycleName}"${usingDefaults.cycleName ? " (default)" : ""}`);
    logger.info(
        "TestData",
        `  Subdivision: "${testData.subdivisionName}"${usingDefaults.subdivisionName ? " (default)" : ""}`
    );
    logger.info(
        "TestData",
        `  Resource File: "${testData.resourceFileName}"${usingDefaults.resourceFileName ? " (default)" : ""}`
    );
    logger.info(
        "TestData",
        `  Test Theme: "${testData.testThemeName}"${usingDefaults.testThemeName ? " (default)" : ""}`
    );
}

// ============================================
// Logger Configuration
// ============================================

import { LogLevel, TestLoggerConfig } from "./testLogger";

/**
 * Log level string to enum mapping.
 */
const LOG_LEVEL_MAP: Record<string, LogLevel> = {
    trace: LogLevel.TRACE,
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
    none: LogLevel.NONE
};

/**
 * Gets the log level from environment variable.
 *
 * @returns LogLevel enum value
 */
export function getLogLevel(): LogLevel {
    const levelStr = process.env[ENV_VARS.UI_TEST_LOG_LEVEL]?.toLowerCase().trim();
    if (levelStr && levelStr in LOG_LEVEL_MAP) {
        return LOG_LEVEL_MAP[levelStr];
    }
    return LogLevel.TRACE; // Default
}

/**
 * Checks if file logging is enabled.
 *
 * @returns True if file logging is enabled (default: true)
 */
export function isFileLoggingEnabled(): boolean {
    const value = process.env[ENV_VARS.UI_TEST_LOG_TO_FILE]?.toLowerCase().trim();
    return value !== "false" && value !== "0";
}

/**
 * Checks if console logging is enabled.
 *
 * @returns True if console logging is enabled (default: true)
 */
export function isConsoleLoggingEnabled(): boolean {
    const value = process.env[ENV_VARS.UI_TEST_LOG_TO_CONSOLE]?.toLowerCase().trim();
    return value !== "false" && value !== "0";
}

/**
 * Gets the logger configuration from environment variables.
 *
 * @returns TestLoggerConfig object
 */
export function getLoggerConfig(): TestLoggerConfig {
    return {
        logLevel: getLogLevel(),
        consoleOutput: isConsoleLoggingEnabled(),
        logDirectory: path.join(TEST_PATHS.BASE_STORAGE, "logs"),
        logFileName: "ui-tests",
        maxFileSize: 5 * 1024 * 1024, // 5 MB
        maxLogFiles: 5,
        includeTimestamp: true
    };
}
