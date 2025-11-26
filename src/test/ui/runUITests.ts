/**
 * @file src/test/ui/runUITests.ts
 * @description Entry point for running UI tests with VS Code Extension Tester.
 * Handles workspace setup, artifact centralization, and test execution.
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

        // Centralize storage for all transient test artifacts under .test-resources
        const baseStoragePath = path.resolve(projectRoot, ".test-resources");

        // Sub-directories for specific components
        const testStoragePath = path.join(baseStoragePath, "vscode-data"); // VS Code binaries
        const extensionsPath = path.join(baseStoragePath, "extensions"); // Installed extensions
        const runtimeWorkspacePath = path.join(baseStoragePath, "workspace"); // Active workspace used during tests

        // Source of truth for test files (not modified during tests)
        const fixturesPath = path.resolve(projectRoot, "src/test/ui/fixtures");

        console.log(`[Setup] Base Storage Path: ${baseStoragePath}`);
        console.log("[Setup] Preparing runtime workspace...");

        // Clean previous runtime workspace
        if (fs.existsSync(runtimeWorkspacePath)) {
            fs.rmSync(runtimeWorkspacePath, { recursive: true, force: true });
        }

        // Copy fixtures to runtime workspace
        if (fs.existsSync(fixturesPath)) {
            console.log(`[Setup] Copying fixtures from '${fixturesPath}' to '${runtimeWorkspacePath}'...`);
            fs.cpSync(fixturesPath, runtimeWorkspacePath, { recursive: true });
        } else {
            console.log(`[Setup] No fixtures found at '${fixturesPath}'. Creating empty workspace.`);
            fs.mkdirSync(runtimeWorkspacePath, { recursive: true });
        }

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

        const performSetup = async (forceClean: boolean = false): Promise<ExTester> => {
            if (forceClean) {
                console.log("[Setup] Cleaning VS Code data...");
                if (fs.existsSync(testStoragePath)) {
                    fs.rmSync(testStoragePath, { recursive: true, force: true });
                }
            }

            const tester = new ExTester(testStoragePath, ReleaseQuality.Stable, extensionsPath);

            // Check if VS Code binary exists in our specific sub-folder
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
            testFilesPattern = path.join(__dirname, "**/*.ui.test.js").replace(/\\/g, "/");
        }

        console.log(`[Test Runner] Test Pattern: ${testFilesPattern}`);
        console.log(`[Test Runner] Workspace:    ${runtimeWorkspacePath}`);

        await exTester.runTests(testFilesPattern, {
            settings: "./src/test/ui/.vscode-test.settings.json",
            resources: [runtimeWorkspacePath], // Opens the prepared runtime workspace
            cleanup: false // Set to true to keep the instance open after tests for debugging
        });

        console.log("UI tests completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Failed to run UI tests:", err);
        process.exit(1);
    }
}

main();
