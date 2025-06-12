/**
 * @file src/test/runTest.ts
 * @description This script is used to run integration tests for the VS Code extension.
 * Simplifies the process of downloading, unzipping, and launching VS Code with extension test parameters
 */

import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath: string = path.resolve(__dirname, "../../");

        // The path to the extension test script
        // Passed to --extensionTestsPath
        const extensionTestsPath: string = path.resolve(__dirname, "./suite/index");

        console.log("Extension Development Path:", extensionDevelopmentPath);
        console.log("Extension Test Path:", extensionTestsPath);
        console.log("Running tests...");

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                "--disable-extensions", // Disable other extensions
                "--disable-workspace-trust", // Disable workspace trust dialog
                "--disable-telemetry", // Disable telemetry
                "--skip-welcome", // Skip welcome page
                "--skip-release-notes" // Skip release notes
            ],
            // Set version explicitly to avoid multiple downloads
            version: "stable"
        });
    } catch (err: any) {
        console.error("Failed to run tests:", err);
        process.exit(1);
    }
}

main();
