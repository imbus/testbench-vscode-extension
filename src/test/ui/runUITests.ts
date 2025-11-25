/**
 * @file src/test/ui/runUITests.ts
 * @description Entry point for running UI tests with VS Code Extension Tester
 */

import * as path from "path";
import { ExTester, ReleaseQuality } from "vscode-extension-tester";
import { loadEnv } from "./testConfig";

async function main(): Promise<void> {
    try {
        // Load environment variables FIRST, before anything else
        console.log("Loading environment variables...");
        const projectRoot = path.resolve(__dirname, "../../../");
        loadEnv(projectRoot);

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
