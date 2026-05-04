/**
 * @file src/test/ui/runUITests.ts
 * @description Entry point for running UI tests with VS Code Extension Tester.
 * Handles workspace setup, artifact centralization, and test execution.
 */

import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { ExTester, ReleaseQuality } from "vscode-extension-tester";
import { loadEnv, TEST_PATHS, getLoggerConfig, setActiveProfile, clearSettingsCache } from "../config/testConfig";
import { initializeTestLogger, getTestLogger } from "../utils/testLogger";
import { discoverUiTestFiles, selectUiTestFiles } from "./testDiscovery";

async function main(): Promise<void> {
    try {
        const projectRoot = path.resolve(__dirname, "../../../../");
        loadEnv(projectRoot);

        // Initialize the test logger early
        const loggerConfig = getLoggerConfig();
        const logger = await initializeTestLogger(projectRoot, loggerConfig);
        logger.info("Setup", "Loading environment variables...");
        logger.info("Setup", "UI Test Runner starting...");
        logger.info("Setup", `Project Root: ${projectRoot}`);

        // Check if a profile was specified via environment variable (from runUITestsWithProfiles.ts)
        const profileName = process.env.TESTBENCH_TEST_PROFILE;
        const profileSettingsPath = process.env.TESTBENCH_PROFILE_SETTINGS_PATH;

        if (profileName && profileSettingsPath) {
            logger.info("Setup", `Running with profile: ${profileName}`);
            logger.info("Setup", `Settings file: ${profileSettingsPath}`);
            setActiveProfile(profileName);
        } else {
            setActiveProfile(null);
            logger.info("Setup", "Using default settings (no profile specified)");
        }
        clearSettingsCache();

        // Centralize storage for all transient test artifacts under .test-resources
        const baseStoragePath = path.resolve(projectRoot, TEST_PATHS.BASE_STORAGE);

        // Sub-directories for specific components
        const testStoragePath = path.join(baseStoragePath, TEST_PATHS.VSCODE_DATA); // VS Code binaries
        const extensionsPath = path.join(baseStoragePath, TEST_PATHS.EXTENSIONS); // Installed extensions
        const runtimeWorkspacePath = path.join(baseStoragePath, TEST_PATHS.WORKSPACE); // Active workspace used during tests

        // Source of truth for test files (not modified during tests)
        const fixturesPath = path.resolve(projectRoot, TEST_PATHS.FIXTURES);

        logger.info("Setup", `Base Storage Path: ${baseStoragePath}`);
        logger.info("Setup", "Preparing runtime workspace...");

        // Clean previous runtime workspace
        if (fs.existsSync(runtimeWorkspacePath)) {
            fs.rmSync(runtimeWorkspacePath, { recursive: true, force: true });
        }

        // Copy fixtures to runtime workspace
        if (fs.existsSync(fixturesPath)) {
            logger.info("Setup", `Copying fixtures from '${fixturesPath}' to '${runtimeWorkspacePath}'...`);
            fs.cpSync(fixturesPath, runtimeWorkspacePath, { recursive: true });
        } else {
            logger.warn("Setup", `No fixtures found at '${fixturesPath}'. Creating empty workspace.`);
            fs.mkdirSync(runtimeWorkspacePath, { recursive: true });
        }

        logger.info("Setup", "Checking VSIX status...");
        const packageJsonPath = path.join(projectRoot, TEST_PATHS.PACKAGE_JSON);
        if (!fs.existsSync(packageJsonPath)) {
            throw new Error(`${TEST_PATHS.PACKAGE_JSON} not found at ${packageJsonPath}`);
        }

        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        const vsixName = `${packageJson.name}-${packageJson.version}.vsix`;
        const vsixPath = path.join(projectRoot, vsixName);

        if (fs.existsSync(vsixPath)) {
            logger.info("Setup", `Found existing VSIX: ${vsixName}. Skipping package creation.`);
        } else {
            logger.info("Setup", `VSIX not found (${vsixName}). Creating package...`);
            try {
                cp.execSync("npm run vsix-package", {
                    cwd: projectRoot,
                    stdio: "inherit"
                });
                logger.info("Setup", "VSIX package created successfully.");
            } catch (error) {
                logger.error("Setup", "Failed to create VSIX package.");
                throw error;
            }
        }

        const performSetup = async (forceClean: boolean = false): Promise<ExTester> => {
            if (forceClean) {
                logger.info("Setup", "Cleaning VS Code data...");
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
                logger.info("Setup", "Detected existing VS Code. Skipping download.");
            } else {
                logger.info("Setup", "Downloading VS Code...");
                await tester.downloadCode();
            }

            await tester.downloadChromeDriver();

            logger.info("Setup", `Installing extension from: ${vsixPath}`);
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
                logger.warn("Setup", "Detected corrupted VS Code archive (interrupted download).");
                logger.info("Setup", "Automatically cleaning and retrying download...");
                exTester = await performSetup(true);
            } else {
                throw err;
            }
        }

        logger.info("TestRunner", "Running UI tests...");

        // Handle arguments
        const specificFile = process.argv[2];
        const compiledUiRoot = path.join(__dirname, "..");
        const discoveredTests = discoverUiTestFiles(projectRoot, compiledUiRoot);

        if (discoveredTests.length === 0) {
            logger.error("TestRunner", "No UI test files were discovered under src/test/ui.");
            logger.close();
            process.exit(1);
        }

        const selectedTests = selectUiTestFiles(discoveredTests, specificFile);
        let testFilesPattern: string | string[];

        if (specificFile) {
            logger.info("TestRunner", `Targeting specific file: ${specificFile}`);
        } else {
            logger.info("TestRunner", "No specific file provided. Running all discovered UI tests.");
        }

        for (const testFile of selectedTests) {
            if (!fs.existsSync(testFile.compiledAbsolutePath)) {
                logger.error("TestRunner", "Compiled test file not found!");
                logger.error("TestRunner", `Source test: ${testFile.sourceRelativePath}`);
                logger.error("TestRunner", `Expected compiled file: ${testFile.compiledAbsolutePath}`);
                logger.error("TestRunner", "Try running 'npm run compile-tests' first.");
                logger.close();
                process.exit(1);
            }
        }

        if (selectedTests.length === 1) {
            testFilesPattern = selectedTests[0].compiledAbsolutePath.replace(/\\/g, "/");
            logger.info("TestRunner", `Test file found: ${testFilesPattern}`);
        } else {
            testFilesPattern = selectedTests.map((testFile) => testFile.compiledAbsolutePath.replace(/\\/g, "/"));
            logger.info("TestRunner", `Discovered ${selectedTests.length} UI test files.`);
        }

        logger.info(
            "TestRunner",
            `Test Pattern: ${Array.isArray(testFilesPattern) ? `${testFilesPattern.length} files` : testFilesPattern}`
        );
        logger.info("TestRunner", `Workspace: ${runtimeWorkspacePath}`);

        // Use profile-specific settings file if available, otherwise use default
        const settingsPath = profileSettingsPath || TEST_PATHS.VSCODE_TEST_SETTINGS;
        logger.info("TestRunner", `Settings: ${settingsPath}`);

        await exTester.runTests(testFilesPattern, {
            settings: settingsPath,
            resources: [runtimeWorkspacePath], // Opens the prepared runtime workspace
            cleanup: true // Set to true to keep the instance open after tests for debugging
        });

        logger.info("TestRunner", "UI tests completed successfully.");
        logger.close();
        process.exit(0);
    } catch (err) {
        const logger = getTestLogger();
        logger.error("TestRunner", `Failed to run UI tests: ${err}`);
        logger.close();
        process.exit(1);
    }
}

main();
