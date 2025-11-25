/**
 * @file src/test/ui/runUITests.ts
 * @description Entry point for running UI tests with VS Code Extension Tester.
 */

import * as path from "path";
import * as fs from "fs";
import { ExTester, ReleaseQuality } from "vscode-extension-tester";
import { loadEnv } from "./testConfig";

async function main(): Promise<void> {
    try {
        console.log("Loading environment variables...");
        const projectRoot = path.resolve(__dirname, "../../../");
        loadEnv(projectRoot);

        const testStoragePath = path.resolve(projectRoot, ".test-resources");
        const extensionsPath = path.resolve(testStoragePath, "extensions");

        console.log("Starting UI tests...");
        console.log(`[Setup] Storage Path:    ${testStoragePath}`);

        // Handle setup with optional cleanup
        // Allows us to re-run setup if the first attempt fails due to corruption
        const performSetup = async (forceClean: boolean = false): Promise<ExTester> => {
            if (forceClean) {
                console.log("[Setup] Cleaning test resources...");
                if (fs.existsSync(testStoragePath)) {
                    fs.rmSync(testStoragePath, { recursive: true, force: true });
                }
            }

            const tester = new ExTester(testStoragePath, ReleaseQuality.Stable, extensionsPath);

            // Check for existing VS Code to skip download check
            const hasExistingVSCode =
                fs.existsSync(testStoragePath) &&
                fs.readdirSync(testStoragePath).some((file) => file.includes("vscode"));

            if (hasExistingVSCode && !forceClean) {
                console.log("[Setup] Detected existing VS Code. Skipping download.");
            } else {
                console.log("[Setup] Downloading VS Code...");
                await tester.downloadCode();
            }

            await tester.downloadChromeDriver();
            await tester.installVsix();

            return tester;
        };

        let exTester: ExTester;

        try {
            // Try to use existing cache
            exTester = await performSetup(false);
        } catch (err: any) {
            const isCorruptionError =
                err.message &&
                (err.message.includes("FILE_ENDED") ||
                    err.message.includes("end of central directory") ||
                    err.message.includes("invalid signature"));

            if (isCorruptionError) {
                console.warn("\n[Setup] Detected corrupted VS Code archive (interrupted download).");
                console.log("[Setup] Automatically cleaning and retrying download...\n");

                exTester = await performSetup(true);
            } else {
                throw err;
            }
        }

        console.log("Running UI tests...");

        // Handle arguments
        const specificFile = process.argv[2];
        let testFilesPattern: string;

        if (specificFile) {
            console.log(`[Test Runner] Targeting specific file: ${specificFile}`);
            const fileName = specificFile.replace(".ts", ".js");
            testFilesPattern = path.join(__dirname, fileName);
        } else {
            console.log(`[Test Runner] No specific file provided. Running all UI tests.`);
            testFilesPattern = path.join(__dirname, "./**/*.ui.test.js");
        }

        await exTester.runTests(testFilesPattern, {
            settings: "./src/test/ui/.vscode-test.settings.json",
            resources: [],
            cleanup: false
        });

        console.log("UI tests completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Failed to run UI tests:", err);
        process.exit(1);
    }
}

main();
