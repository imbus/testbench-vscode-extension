/**
 * @file src/test/ui/runUITests.ts
 * @description Entry point for running UI tests with VS Code Extension Tester.
 * Handles workspace setup, artifact centralization, and test execution.
 */

import * as path from "path";
import * as fs from "fs";
import { ExTester, ReleaseQuality } from "vscode-extension-tester";
import {
    loadEnv,
    TEST_PATHS,
    getLoggerConfig,
    setActiveProfile,
    clearSettingsCache,
    assertCredentialReadinessForStrictMode
} from "../config/testConfig";
import { initializeTestLogger, getTestLogger } from "../utils/testLogger";
import { discoverUiTestFiles, selectUiTestFiles } from "./testDiscovery";
import {
    createRunnerPaths,
    ensureVsixPackage,
    hasExistingVSCodeInstallation,
    isArchiveCorruptionError,
    prepareRuntimeWorkspace,
    setupExTesterEnvironment
} from "./runnerBootstrap";

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
        const isolationMode = process.env.TESTBENCH_TEST_ISOLATION_MODE;
        const skipSetupFromParent = process.env.TESTBENCH_SKIP_SETUP === "true";

        if (profileName && profileSettingsPath) {
            logger.info("Setup", `Running with profile: ${profileName}`);
            logger.info("Setup", `Settings file: ${profileSettingsPath}`);
            setActiveProfile(profileName);
        } else {
            setActiveProfile(null);
            logger.info("Setup", "Using default settings (no profile specified)");
        }
        clearSettingsCache();

        if (isolationMode) {
            logger.info("Setup", `Isolation mode: ${isolationMode}`);
        }
        if (skipSetupFromParent) {
            logger.info("Setup", "Setup mode: reusing parent-initialized test assets");
        }

        // In strict mode (CI or explicit flag), fail before expensive setup when credentials are invalid.
        assertCredentialReadinessForStrictMode();

        // Centralize storage for all transient test artifacts under .test-resources
        const runnerPaths = createRunnerPaths(projectRoot);

        logger.info("Setup", `Base Storage Path: ${runnerPaths.baseStoragePath}`);
        logger.info("Setup", "Preparing runtime workspace...");
        prepareRuntimeWorkspace(runnerPaths, logger);

        logger.info("Setup", "Checking VSIX status...");
        const { vsixPath } = ensureVsixPackage(projectRoot, runnerPaths.packageJsonPath, logger);

        const performSetup = async (forceClean: boolean = false): Promise<ExTester> => {
            return setupExTesterEnvironment({
                testStoragePath: runnerPaths.testStoragePath,
                extensionsPath: runnerPaths.extensionsPath,
                vsixPath,
                logger,
                forceClean,
                skipVsCodeDownloadAndDriver: false,
                installVsix: true
            });
        };

        let exTester: ExTester;

        if (skipSetupFromParent) {
            const hasExistingVSCode = hasExistingVSCodeInstallation(runnerPaths.testStoragePath);
            const hasExtensionsDirectory = fs.existsSync(runnerPaths.extensionsPath);

            if (hasExistingVSCode && hasExtensionsDirectory) {
                logger.info("Setup", "Using existing VS Code and extension assets from parent setup.");
                exTester = new ExTester(runnerPaths.testStoragePath, ReleaseQuality.Stable, runnerPaths.extensionsPath);
            } else {
                logger.warn("Setup", "Requested setup reuse, but required assets were missing. Running setup now.");
                exTester = await performSetup(false);
            }
        } else {
            try {
                exTester = await performSetup(false);
            } catch (err) {
                if (isArchiveCorruptionError(err)) {
                    logger.warn("Setup", "Detected corrupted VS Code archive (interrupted download).");
                    logger.info("Setup", "Automatically cleaning and retrying download...");
                    exTester = await performSetup(true);
                } else {
                    throw err;
                }
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
        logger.info("TestRunner", `Workspace: ${runnerPaths.runtimeWorkspacePath}`);

        // Use profile-specific settings file if available, otherwise use default
        const settingsPath = profileSettingsPath || TEST_PATHS.VSCODE_TEST_SETTINGS;
        logger.info("TestRunner", `Settings: ${settingsPath}`);

        await exTester.runTests(testFilesPattern, {
            settings: settingsPath,
            resources: [runnerPaths.runtimeWorkspacePath], // Opens the prepared runtime workspace
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
