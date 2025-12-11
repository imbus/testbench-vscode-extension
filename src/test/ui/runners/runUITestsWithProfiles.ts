/**
 * @file src/test/ui/runUITestsWithProfiles.ts
 * @description Enhanced test runner that supports running UI tests with multiple configuration profiles.
 * Can run tests with a specific profile or iterate through all profiles.
 */

import * as path from "path";
import * as fs from "fs";
import * as cp from "child_process";
import { ExTester, ReleaseQuality } from "vscode-extension-tester";
import { loadEnv, TEST_PATHS, getLoggerConfig } from "../config/testConfig";
import { initializeTestLogger, getTestLogger } from "../utils/testLogger";
import {
    TEST_PROFILES,
    getProfileByName,
    getCompleteSettings,
    isValidProfile,
    getAvailableProfiles
} from "../config/testConfigurations";

interface TestRunOptions {
    profile?: string; // Specific profile name to use, or undefined to run with all profiles
    testFile?: string; // Specific test file to run, or undefined to run all tests
    skipSetup?: boolean; // Skip VS Code download/setup if already done
}

/**
 * Creates a settings file for a specific profile.
 *
 * @param profile - The profile to create settings for
 * @param projectRoot - The project root directory
 * @returns Path to the created settings file
 */
function createSettingsFile(profile: any, projectRoot: string): string {
    const settingsDir = path.join(projectRoot, "src/test/ui/config/profiles");
    if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
    }

    const settingsPath = path.join(settingsDir, `.vscode-test.settings.${profile.name}.json`);
    const settings = getCompleteSettings(profile);

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
    return settingsPath;
}

/**
 * Runs tests with a specific configuration profile.
 *
 * @param profile - The test profile to use
 * @param options - Test run options
 * @param exTester - The ExTester instance
 * @param projectRoot - The project root directory
 * @param runtimeWorkspacePath - The workspace path for tests
 * @returns Promise<boolean> - True if tests passed, false otherwise
 */
async function runTestsWithProfile(
    profile: any,
    options: TestRunOptions,
    exTester: ExTester,
    projectRoot: string,
    runtimeWorkspacePath: string
): Promise<boolean> {
    const logger = getTestLogger();
    logger.info("ProfileRunner", `\n${"=".repeat(80)}`);
    logger.info("ProfileRunner", `Running tests with profile: ${profile.name}`);
    logger.info("ProfileRunner", `Description: ${profile.description}`);
    logger.info("ProfileRunner", `${"=".repeat(80)}\n`);

    // Create settings file for this profile
    const settingsPath = createSettingsFile(profile, projectRoot);
    logger.info("ProfileRunner", `Settings file: ${settingsPath}`);

    // Clear settings cache to ensure fresh settings are loaded for this profile
    const { clearSettingsCache } = await import("../config/testConfig");
    clearSettingsCache();

    // Determine test pattern
    let testFilesPattern: string;
    if (options.testFile) {
        const fileName = options.testFile.replace(".ts", ".js");
        const compiledTestPath = path.join(__dirname, "..", fileName);

        if (!fs.existsSync(compiledTestPath)) {
            logger.error("ProfileRunner", `Test file not found: ${compiledTestPath}`);
            return false;
        }

        testFilesPattern = compiledTestPath.replace(/\\/g, "/");
        logger.info("ProfileRunner", `Running specific test: ${options.testFile}`);
    } else {
        testFilesPattern = path.join(__dirname, "..", "**/*.ui.test.js").replace(/\\/g, "/");
        logger.info("ProfileRunner", "Running all UI tests");
    }

    try {
        await exTester.runTests(testFilesPattern, {
            settings: settingsPath,
            resources: [runtimeWorkspacePath],
            cleanup: true
        });

        logger.info("ProfileRunner", `✓ Tests passed with profile: ${profile.name}\n`);
        return true;
    } catch (error) {
        logger.error("ProfileRunner", `✗ Tests failed with profile: ${profile.name}`);
        logger.error("ProfileRunner", `Error: ${error}\n`);
        return false;
    }
}

/**
 * Main test runner function.
 */
async function main(): Promise<void> {
    try {
        const projectRoot = path.resolve(__dirname, "../../../../");
        loadEnv(projectRoot);

        // Initialize the test logger early
        const loggerConfig = getLoggerConfig();
        const logger = await initializeTestLogger(projectRoot, loggerConfig);

        // Parse command line arguments
        const args = process.argv.slice(2);
        const options: TestRunOptions = {};

        // Parse arguments: --profile=<name> --test=<file> --skip-setup
        for (const arg of args) {
            if (arg.startsWith("--profile=")) {
                options.profile = arg.substring("--profile=".length);
            } else if (arg.startsWith("--test=")) {
                options.testFile = arg.substring("--test=".length);
            } else if (arg === "--skip-setup") {
                options.skipSetup = true;
            } else if (!arg.startsWith("--")) {
                // Support legacy format: just the test filename
                options.testFile = arg;
            }
        }

        logger.info("Setup", "UI Test Runner with Profiles starting...");
        logger.info("Setup", `Project Root: ${projectRoot}`);

        // Validate profile if specified
        if (options.profile && !isValidProfile(options.profile)) {
            logger.error("Setup", `Invalid profile: ${options.profile}`);
            logger.error("Setup", `Available profiles: ${getAvailableProfiles().join(", ")}`);
            process.exit(1);
        }

        // Centralize storage for all transient test artifacts under .test-resources
        const baseStoragePath = path.resolve(projectRoot, TEST_PATHS.BASE_STORAGE);
        const testStoragePath = path.join(baseStoragePath, TEST_PATHS.VSCODE_DATA);
        const extensionsPath = path.join(baseStoragePath, TEST_PATHS.EXTENSIONS);
        const runtimeWorkspacePath = path.join(baseStoragePath, TEST_PATHS.WORKSPACE);
        const fixturesPath = path.resolve(projectRoot, TEST_PATHS.FIXTURES);

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

        // Check VSIX
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

        // Setup ExTester
        const performSetup = async (forceClean: boolean = false): Promise<ExTester> => {
            if (forceClean) {
                logger.info("Setup", "Cleaning VS Code data...");
                if (fs.existsSync(testStoragePath)) {
                    fs.rmSync(testStoragePath, { recursive: true, force: true });
                }
            }

            const tester = new ExTester(testStoragePath, ReleaseQuality.Stable, extensionsPath);

            // Handle VS Code download (can be skipped if already present)
            if (options.skipSetup) {
                logger.info("Setup", "Skipping VS Code download (--skip-setup flag)");
            } else {
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
            }

            // Always install extension (required for profile-specific settings)
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
                logger.warn("Setup", "Detected corrupted VS Code. Cleaning and retrying...");
                exTester = await performSetup(true);
            } else {
                throw err;
            }
        }

        // Determine which profiles to run
        const profilesToRun = options.profile ? [getProfileByName(options.profile)!] : TEST_PROFILES;

        logger.info("TestRunner", `Will run tests with ${profilesToRun.length} profile(s)`);

        // Run tests with each profile
        const results: { profile: string; passed: boolean }[] = [];

        for (const profile of profilesToRun) {
            const passed = await runTestsWithProfile(profile, options, exTester, projectRoot, runtimeWorkspacePath);
            results.push({ profile: profile.name, passed });

            // If running multiple profiles and one fails, continue with others
            // but track the failure for final report
        }

        // Print summary
        logger.info("Summary", `\n${"=".repeat(80)}`);
        logger.info("Summary", "Test Execution Summary");
        logger.info("Summary", `${"=".repeat(80)}`);

        let allPassed = true;
        for (const result of results) {
            const status = result.passed ? "✓ PASSED" : "✗ FAILED";
            logger.info("Summary", `  ${status.padEnd(10)} - ${result.profile}`);
            if (!result.passed) {
                allPassed = false;
            }
        }

        logger.info("Summary", `${"=".repeat(80)}\n`);

        if (allPassed) {
            logger.info("Summary", "All tests passed successfully!");
            logger.close();
            process.exit(0);
        } else {
            logger.error("Summary", "Some tests failed. See log above for details.");
            logger.close();
            process.exit(1);
        }
    } catch (err) {
        const logger = getTestLogger();
        logger.error("TestRunner", `Failed to run UI tests: ${err}`);
        logger.close();
        process.exit(1);
    }
}

main();
