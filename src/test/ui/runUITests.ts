/**
 * @file src/test/ui/runUITests.ts
 * @description Entry point for running UI tests with VS Code Extension Tester
 */

import * as path from "path";
import * as fs from "fs";
import { ExTester, ReleaseQuality } from "vscode-extension-tester";

/**
 * Loads environment variables from .env files.
 * This must be called before ExTester runs tests to ensure env vars are available.
 */
function loadEnvironmentVariables(): void {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const dotenv = require("dotenv");

        // Get project root (where package.json is located)
        const projectRoot = path.resolve(__dirname, "../../../");

        // Try to load .env file from project root
        const envPath = path.join(projectRoot, ".env");
        if (fs.existsSync(envPath)) {
            const result = dotenv.config({ path: envPath });
            if (!result.error) {
                console.log(`[Env] Loaded .env from: ${envPath}`);
            }
        }

        // Try to load testBenchConnection.env from project root
        const testBenchEnvPath = path.join(projectRoot, "testBenchConnection.env");
        console.log(`[Env] Looking for testBenchConnection.env at: ${testBenchEnvPath}`);
        console.log(`[Env] Project root: ${projectRoot}`);
        console.log(`[Env] File exists: ${fs.existsSync(testBenchEnvPath)}`);

        if (fs.existsSync(testBenchEnvPath)) {
            const result = dotenv.config({ path: testBenchEnvPath, override: false });
            if (!result.error) {
                console.log(`[Env] ✅ Successfully loaded testBenchConnection.env from: ${testBenchEnvPath}`);
            } else {
                console.log(`[Env] ❌ Error loading testBenchConnection.env:`, result.error);
            }
        } else {
            console.log(`[Env] ⚠️  testBenchConnection.env not found at: ${testBenchEnvPath}`);
            console.log(`[Env] Please ensure testBenchConnection.env exists in the project root directory.`);
        }

        // Log loaded values for debugging (without exposing passwords)
        console.log(`[Env] TESTBENCH_TEST_SERVER_NAME=${process.env.TESTBENCH_TEST_SERVER_NAME || "not set"}`);
        console.log(`[Env] TESTBENCH_TEST_USERNAME=${process.env.TESTBENCH_TEST_USERNAME || "not set"}`);
        console.log(`[Env] TESTBENCH_TEST_PORT_NUMBER=${process.env.TESTBENCH_TEST_PORT_NUMBER || "not set"}`);
        console.log(
            `[Env] TESTBENCH_TEST_CONNECTION_LABEL=${process.env.TESTBENCH_TEST_CONNECTION_LABEL || "not set"}`
        );
        console.log(`[Env] UI_TEST_SLOW_MOTION=${process.env.UI_TEST_SLOW_MOTION || "not set"}`);
        console.log(`[Env] UI_TEST_SLOW_MOTION_DELAY=${process.env.UI_TEST_SLOW_MOTION_DELAY || "not set"}`);
    } catch (error) {
        console.log("[Env] Error loading .env files:", error);
        console.log("[Env] Continuing without .env file - environment variables must be set manually");
    }
}

async function main(): Promise<void> {
    try {
        // Load environment variables FIRST, before anything else
        console.log("Loading environment variables...");
        loadEnvironmentVariables();

        console.log("Starting UI tests with VS Code Extension Tester...");

        // The folder containing the Extension Manifest package.json
        const extensionDevelopmentPath = path.resolve(__dirname, "../../../");

        // Path to the extension test runner script
        const extensionTestsPath = path.resolve(__dirname, "./index");

        // Download VS Code, unzip it and run the integration test
        console.log("Extension development path:", extensionDevelopmentPath);
        console.log("Extension tests path:", extensionTestsPath);

        // Initialize ExTester
        const exTester = new ExTester(
            extensionDevelopmentPath,
            ReleaseQuality.Stable,
            path.resolve(extensionDevelopmentPath, "test-resources")
        );

        console.log("Setting up ExTester...");

        // Download VS Code and ChromeDriver
        await exTester.downloadCode();
        await exTester.downloadChromeDriver();

        console.log("Installing extension dependencies...");
        await exTester.installVsix();

        console.log("Running UI tests...");

        // Run the tests
        const testFilesPattern = path.join(__dirname, "./**/*.ui.test.js");
        await exTester.runTests(testFilesPattern, {
            settings: "./src/test/ui/.vscode-test.settings.json",
            resources: [], // Workspace folders to open during tests
            cleanup: false // Set to true to cleanup VS Code instance after tests
        });

        console.log("UI tests completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Failed to run UI tests:", err);
        process.exit(1);
    }
}

main();
