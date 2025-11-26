/**
 * @file src/test/ui/runUITests.ts
 * @description Entry point for running UI tests with VS Code Extension Tester.
 */

import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { ExTester, ReleaseQuality } from "vscode-extension-tester";
import { loadEnv } from "./testConfig";

async function main(): Promise<void> {
    try {
        console.log("Loading environment variables...");
        const projectRoot = path.resolve(__dirname, "../../../");
        loadEnv(projectRoot);

        const testStoragePath = path.resolve(projectRoot, ".test-resources");
        const extensionsPath = path.resolve(testStoragePath, "extensions");

        console.log("[Setup] Checking VSIX status...");

        const packageJsonPath = path.join(projectRoot, "package.json");
        if (!fs.existsSync(packageJsonPath)) {
            throw new Error(`package.json not found at ${packageJsonPath}`);
        }

        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        const vsixName = `${packageJson.name}-${packageJson.version}.vsix`;
        const vsixPath = path.join(projectRoot, vsixName);

        if (fs.existsSync(vsixPath)) {
            console.log(`[Setup] Found existing VSIX: ${vsixName}. Skipping package creation.`);
        } else {
            console.log(`[Setup] VSIX not found (${vsixName}). Creating package...`);
            try {
                cp.execSync("npm run vsix-package", {
                    cwd: projectRoot,
                    stdio: "inherit"
                });
                console.log("[Setup] VSIX package created successfully.");
            } catch (error) {
                console.error("[Setup] Failed to create VSIX package.");
                throw error;
            }
        }

        console.log("Starting UI tests...");
        console.log(`[Setup] Storage Path:    ${testStoragePath}`);

        const performSetup = async (forceClean: boolean = false): Promise<ExTester> => {
            if (forceClean) {
                console.log("[Setup] Cleaning test resources...");
                if (fs.existsSync(testStoragePath)) {
                    fs.rmSync(testStoragePath, { recursive: true, force: true });
                }
            }

            const tester = new ExTester(testStoragePath, ReleaseQuality.Stable, extensionsPath);

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

            console.log(`[Setup] Installing extension from: ${vsixPath}`);
            await tester.installVsix({
                vsixFile: vsixPath,
                installDependencies: true
            });

            return tester;
        };

        let exTester: ExTester;

        try {
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
            testFilesPattern = path.join(__dirname, fileName).replace(/\\/g, "/");
        } else {
            console.log(`[Test Runner] No specific file provided. Running all UI tests.`);
            // Ensure globs use forward slashes even on Windows
            testFilesPattern = path.join(__dirname, "**/*.ui.test.js").replace(/\\/g, "/");
        }

        console.log(`[Test Runner] Test Pattern: ${testFilesPattern}`);

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
