/**
 * @file src/test/ui/runUITestsWithProfiles.ts
 * @description Enhanced test runner that supports running UI tests with multiple configuration profiles.
 * Can run tests with a specific profile or iterate through all profiles.
 * Tracks each test file separately per profile and generates a comprehensive summary matrix.
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
    granular?: boolean; // Run each test file separately (slower but gives per-file results)
}

/**
 * Result of a single test file execution.
 */
interface TestFileResult {
    testFile: string;
    profile: string;
    passed: boolean;
    duration: number; // in milliseconds
    error?: string;
}

/**
 * Available UI test files.
 */
const UI_TEST_FILES = [
    "loginWebview.ui.test.ts",
    "projectsView.ui.test.ts",
    "testThemesView.ui.test.ts",
    "resourceCreationFlow.ui.test.ts",
    "searchFeature.ui.test.ts",
    "testElementsView.ui.test.ts",
    "contextConfiguration.ui.test.ts",
    "toolbarActions.ui.test.ts"
];

/**
 * Short names for test files (used in summary table).
 */
const TEST_FILE_SHORT_NAMES: Record<string, string> = {
    "loginWebview.ui.test.ts": "login",
    "projectsView.ui.test.ts": "projects",
    "testThemesView.ui.test.ts": "themes",
    "resourceCreationFlow.ui.test.ts": "resource",
    "searchFeature.ui.test.ts": "search",
    "testElementsView.ui.test.ts": "elements",
    "contextConfiguration.ui.test.ts": "config",
    "toolbarActions.ui.test.ts": "toolbar"
};

/**
 * Result of running all tests with a single profile.
 */
interface ProfileResult {
    profile: string;
    passed: boolean;
    duration: number;
    error?: string;
    testFiles: string[];
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
 * Runs a single test file with a specific configuration profile.
 *
 * @param profile - The test profile to use
 * @param testFile - The test file to run
 * @param exTester - The ExTester instance
 * @param projectRoot - The project root directory
 * @param runtimeWorkspacePath - The workspace path for tests
 * @param settingsPath - Path to the settings file
 * @returns Promise<TestFileResult> - Result of the test execution
 */
async function runSingleTestFile(
    profile: any,
    testFile: string,
    exTester: ExTester,
    projectRoot: string,
    runtimeWorkspacePath: string,
    settingsPath: string
): Promise<TestFileResult> {
    const logger = getTestLogger();
    const startTime = Date.now();

    const fileName = testFile.replace(".ts", ".js");
    const compiledTestPath = path.join(__dirname, "..", fileName);

    if (!fs.existsSync(compiledTestPath)) {
        logger.error("TestRunner", `Test file not found: ${compiledTestPath}`);
        return {
            testFile,
            profile: profile.name,
            passed: false,
            duration: Date.now() - startTime,
            error: `Test file not found: ${compiledTestPath}`
        };
    }

    const testFilesPattern = compiledTestPath.replace(/\\/g, "/");
    logger.info("TestRunner", `  Running: ${testFile}`);

    try {
        await exTester.runTests(testFilesPattern, {
            settings: settingsPath,
            resources: [runtimeWorkspacePath],
            cleanup: true
        });

        const duration = Date.now() - startTime;
        logger.info("TestRunner", `  ${testFile} passed (${formatDuration(duration)})`);
        return {
            testFile,
            profile: profile.name,
            passed: true,
            duration
        };
    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error("TestRunner", `  ${testFile} failed (${formatDuration(duration)})`);
        return {
            testFile,
            profile: profile.name,
            passed: false,
            duration,
            error: String(error)
        };
    }
}

/**
 * Runs all specified test files with a specific configuration profile.
 *
 * @param profile - The test profile to use
 * @param testFiles - Array of test files to run
 * @param exTester - The ExTester instance
 * @param projectRoot - The project root directory
 * @param runtimeWorkspacePath - The workspace path for tests
 * @returns Promise<TestFileResult[]> - Results of all test executions
 */
async function runTestsWithProfile(
    profile: any,
    testFiles: string[],
    exTester: ExTester,
    projectRoot: string,
    runtimeWorkspacePath: string
): Promise<TestFileResult[]> {
    const logger = getTestLogger();
    logger.info("ProfileRunner", `\n${"=".repeat(80)}`);
    logger.info("ProfileRunner", `Running tests with profile: ${profile.name}`);
    logger.info("ProfileRunner", `Description: ${profile.description}`);
    logger.info("ProfileRunner", `Test files: ${testFiles.length}`);
    logger.info("ProfileRunner", `${"=".repeat(80)}\n`);

    // Create settings file for this profile
    const settingsPath = createSettingsFile(profile, projectRoot);
    logger.info("ProfileRunner", `Settings file: ${settingsPath}`);

    // Set the active profile and clear settings cache to ensure fresh settings are loaded
    const { clearSettingsCache, setActiveProfile } = await import("../config/testConfig");
    setActiveProfile(profile.name);
    clearSettingsCache();

    const results: TestFileResult[] = [];

    for (const testFile of testFiles) {
        const result = await runSingleTestFile(
            profile,
            testFile,
            exTester,
            projectRoot,
            runtimeWorkspacePath,
            settingsPath
        );
        results.push(result);
    }

    // Profile summary
    const passed = results.filter((r) => r.passed).length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    logger.info("ProfileRunner", `\nProfile "${profile.name}" completed: ${passed}/${results.length} passed`);
    logger.info("ProfileRunner", `Total duration: ${formatDuration(totalDuration)}\n`);

    return results;
}

/**
 * Runs all test files for a profile in a SINGLE VS Code session using a SUBPROCESS.
 * This ensures complete isolation between profile runs by spawning a new Node.js process
 * for each profile. This is essential because:
 * 1. Mocha maintains internal state that can cause tests to be skipped on subsequent runs
 * 2. VS Code/ChromeDriver state can leak between runs in the same process
 * 3. The vscode-extension-tester ExTester.runTests() is not designed for multiple invocations
 *    in the same process
 *
 * @param profile - The test profile to use
 * @param testFiles - Array of test files to run
 * @param projectRoot - The project root directory
 * @returns Promise<ProfileResult> - Result of the profile execution
 */
async function runAllTestsForProfile(profile: any, testFiles: string[], projectRoot: string): Promise<ProfileResult> {
    const logger = getTestLogger();
    const startTime = Date.now();

    logger.info("ProfileRunner", `\n${"=".repeat(80)}`);
    logger.info("ProfileRunner", `Running tests with profile: ${profile.name}`);
    logger.info("ProfileRunner", `Description: ${profile.description}`);
    logger.info("ProfileRunner", `Test files: ${testFiles.length} (running in isolated subprocess)`);
    logger.info("ProfileRunner", `${"=".repeat(80)}\n`);

    // Create settings file for this profile
    const settingsPath = createSettingsFile(profile, projectRoot);
    logger.info("ProfileRunner", `Settings file: ${settingsPath}`);

    // Run tests in a subprocess to ensure complete isolation
    // This is critical because Mocha and VS Code state doesn't reset properly
    // when ExTester.runTests() is called multiple times in the same process
    return new Promise<ProfileResult>((resolve) => {
        const runUITestsScript = path.join(__dirname, "runUITests.js");

        // Pass the profile name via environment variable so runUITests.ts can use it
        const env = {
            ...process.env,
            TESTBENCH_TEST_PROFILE: profile.name,
            TESTBENCH_PROFILE_SETTINGS_PATH: settingsPath
        };

        logger.info("ProfileRunner", `Spawning subprocess for profile: ${profile.name}`);
        logger.info("ProfileRunner", `Script: ${runUITestsScript}`);

        const child = cp.spawn("node", [runUITestsScript], {
            cwd: projectRoot,
            env,
            stdio: ["inherit", "pipe", "pipe"],
            shell: true
        });

        let stderr = "";

        child.stdout?.on("data", (data) => {
            const text = data.toString();
            // Forward output to console for real-time visibility
            process.stdout.write(text);
        });

        child.stderr?.on("data", (data) => {
            const text = data.toString();
            stderr += text;
            // Forward stderr to console
            process.stderr.write(text);
        });

        child.on("close", (code) => {
            const duration = Date.now() - startTime;
            const passed = code === 0;

            if (passed) {
                logger.info(
                    "ProfileRunner",
                    `\nProfile "${profile.name}" completed successfully (${formatDuration(duration)})\n`
                );
            } else {
                logger.error(
                    "ProfileRunner",
                    `\nProfile "${profile.name}" failed with exit code ${code} (${formatDuration(duration)})`
                );
            }

            resolve({
                profile: profile.name,
                passed,
                duration,
                testFiles,
                error: passed ? undefined : `Exit code: ${code}. ${stderr.slice(-500)}`
            });
        });

        child.on("error", (err) => {
            const duration = Date.now() - startTime;
            logger.error("ProfileRunner", `\nProfile "${profile.name}" failed to start: ${err.message}`);

            resolve({
                profile: profile.name,
                passed: false,
                duration,
                testFiles,
                error: err.message
            });
        });
    });
}

/**
 * Formats duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    } else if (ms < 60000) {
        return `${(ms / 1000).toFixed(1)}s`;
    } else {
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(0);
        return `${minutes}m ${seconds}s`;
    }
}

/**
 * Generates and prints a comprehensive summary matrix.
 */
function printSummaryMatrix(results: TestFileResult[], profiles: string[], testFiles: string[]): void {
    const logger = getTestLogger();

    // Build results map for quick lookup
    const resultsMap = new Map<string, TestFileResult>();
    for (const result of results) {
        const key = `${result.profile}|${result.testFile}`;
        resultsMap.set(key, result);
    }

    // Calculate column widths
    const shortNames = testFiles.map((f) => TEST_FILE_SHORT_NAMES[f] || f.replace(".ui.test.ts", ""));
    const maxProfileWidth = Math.max(20, ...profiles.map((p) => p.length));
    const colWidth = Math.max(8, ...shortNames.map((n) => n.length + 2));

    // Header
    logger.info("Summary", `\n${"=".repeat(maxProfileWidth + 4 + testFiles.length * (colWidth + 1) + 10)}`);
    logger.info(
        "Summary",
        `TEST EXECUTION SUMMARY MATRIX (${profiles.length} profiles × ${testFiles.length} tests = ${profiles.length * testFiles.length} combinations)`
    );
    logger.info("Summary", `${"=".repeat(maxProfileWidth + 4 + testFiles.length * (colWidth + 1) + 10)}`);

    // Column headers
    let headerRow = "Profile".padEnd(maxProfileWidth) + " │";
    for (const shortName of shortNames) {
        headerRow += shortName.padStart(colWidth) + " ";
    }
    headerRow += "│ Total";
    logger.info("Summary", headerRow);

    // Separator
    let separator = "─".repeat(maxProfileWidth) + "─┼";
    for (let i = 0; i < testFiles.length; i++) {
        separator += "─".repeat(colWidth) + "─";
    }
    separator += "┼───────";
    logger.info("Summary", separator);

    // Data rows
    let totalPassed = 0;
    let totalFailed = 0;

    for (const profile of profiles) {
        let row = profile.padEnd(maxProfileWidth) + " │";
        let profilePassed = 0;
        let profileTotal = 0;

        for (const testFile of testFiles) {
            const key = `${profile}|${testFile}`;
            const result = resultsMap.get(key);

            if (result) {
                profileTotal++;
                if (result.passed) {
                    row += "✓".padStart(colWidth) + " ";
                    profilePassed++;
                    totalPassed++;
                } else {
                    row += "✗".padStart(colWidth) + " ";
                    totalFailed++;
                }
            } else {
                row += "-".padStart(colWidth) + " ";
            }
        }

        row += `│ ${profilePassed}/${profileTotal}`;
        logger.info("Summary", row);
    }

    // Footer separator
    logger.info("Summary", separator);

    // Totals row
    let totalsRow = "TOTAL".padEnd(maxProfileWidth) + " │";
    for (const testFile of testFiles) {
        const passedForFile = results.filter((r) => r.testFile === testFile && r.passed).length;
        const totalForFile = results.filter((r) => r.testFile === testFile).length;
        totalsRow += `${passedForFile}/${totalForFile}`.padStart(colWidth) + " ";
    }
    totalsRow += `│ ${totalPassed}/${totalPassed + totalFailed}`;
    logger.info("Summary", totalsRow);

    logger.info("Summary", `${"=".repeat(maxProfileWidth + 4 + testFiles.length * (colWidth + 1) + 10)}`);

    // Summary statistics
    const totalTests = totalPassed + totalFailed;
    const passRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : "0.0";
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    logger.info("Summary", "");
    logger.info("Summary", `Results: ${totalPassed}/${totalTests} passed (${passRate}%)`);
    logger.info("Summary", `Total duration: ${formatDuration(totalDuration)}`);

    // List failures if any
    const failures = results.filter((r) => !r.passed);
    if (failures.length > 0) {
        logger.info("Summary", "");
        logger.info("Summary", `Failed tests (${failures.length}):`);
        for (const failure of failures) {
            logger.info("Summary", `  ${failure.profile} / ${failure.testFile}`);
            if (failure.error) {
                // Truncate long error messages
                const shortError = failure.error.length > 100 ? failure.error.substring(0, 100) + "..." : failure.error;
                logger.info("Summary", `      Error: ${shortError}`);
            }
        }
    }

    logger.info("Summary", "");
}

/**
 * Prints a simple profile-level summary (used when running all tests per profile).
 */
function printProfileSummary(results: ProfileResult[]): void {
    const logger = getTestLogger();

    logger.info("Summary", `\n${"=".repeat(80)}`);
    logger.info("Summary", `TEST EXECUTION SUMMARY (${results.length} profiles)`);
    logger.info("Summary", `${"=".repeat(80)}`);

    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    const passedProfiles = results.filter((r) => r.passed).length;
    const failedProfiles = results.filter((r) => !r.passed).length;

    for (const result of results) {
        const status = result.passed ? "PASSED" : "FAILED";
        const duration = formatDuration(result.duration);
        logger.info("Summary", `  ${status.padEnd(10)} ${result.profile.padEnd(25)} (${duration})`);
    }

    logger.info("Summary", `${"=".repeat(80)}`);
    logger.info("Summary", "");
    logger.info("Summary", `Results: ${passedProfiles}/${results.length} profiles passed`);
    logger.info("Summary", `Total duration: ${formatDuration(totalDuration)}`);

    // List failures if any
    if (failedProfiles > 0) {
        logger.info("Summary", "");
        logger.info("Summary", `Failed profiles (${failedProfiles}):`);
        for (const result of results.filter((r) => !r.passed)) {
            logger.info("Summary", `  ${result.profile}`);
            if (result.error) {
                const shortError = result.error.length > 100 ? result.error.substring(0, 100) + "..." : result.error;
                logger.info("Summary", `      Error: ${shortError}`);
            }
        }
    }

    logger.info("Summary", "");
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

        // Parse arguments: --profile=<name> --test=<file> --skip-setup --granular
        for (const arg of args) {
            if (arg.startsWith("--profile=")) {
                options.profile = arg.substring("--profile=".length);
            } else if (arg.startsWith("--test=")) {
                options.testFile = arg.substring("--test=".length);
            } else if (arg === "--skip-setup") {
                options.skipSetup = true;
            } else if (arg === "--granular") {
                options.granular = true;
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

        // One-time setup: download VS Code and ChromeDriver
        const performOneTimeSetup = async (forceClean: boolean = false): Promise<void> => {
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

            // Install extension once during setup
            logger.info("Setup", `Installing extension from: ${vsixPath}`);
            await tester.installVsix({
                vsixFile: vsixPath,
                installDependencies: true
            });
        };

        // Create a fresh ExTester instance for each profile run
        // This ensures each profile gets a clean VS Code session
        const createExTester = (): ExTester => {
            return new ExTester(testStoragePath, ReleaseQuality.Stable, extensionsPath);
        };

        try {
            await performOneTimeSetup(false);
        } catch (err: any) {
            const isCorruptionError =
                err.message &&
                (err.message.includes("FILE_ENDED") ||
                    err.message.includes("end of central directory") ||
                    err.message.includes("invalid signature"));

            if (isCorruptionError) {
                logger.warn("Setup", "Detected corrupted VS Code. Cleaning and retrying...");
                await performOneTimeSetup(true);
            } else {
                throw err;
            }
        }

        // Determine which profiles to run
        const profilesToRun = options.profile ? [getProfileByName(options.profile)!] : TEST_PROFILES;

        // Determine which test files to run
        const testFilesToRun = options.testFile ? [options.testFile] : UI_TEST_FILES;

        // Validate test files exist
        for (const testFile of testFilesToRun) {
            const compiledPath = path.join(__dirname, "..", testFile.replace(".ts", ".js"));
            if (!fs.existsSync(compiledPath)) {
                logger.error("Setup", `Test file not found: ${testFile}`);
                logger.error("Setup", `Expected at: ${compiledPath}`);
                process.exit(1);
            }
        }

        const totalCombinations = profilesToRun.length * testFilesToRun.length;
        logger.info(
            "TestRunner",
            `Will run ${totalCombinations} test combination(s): ${profilesToRun.length} profile(s) × ${testFilesToRun.length} test file(s)`
        );

        // Determine execution mode:
        // - Granular mode: Run each test file separately (slower, gives per-file results)
        // - Fast mode (default): Run all tests per profile in single VS Code session
        const useGranularMode = options.granular || options.testFile !== undefined;

        if (useGranularMode) {
            logger.info("TestRunner", "Mode: Granular (running each test file separately)");

            // Run tests with each profile, tracking each test file separately
            const allResults: TestFileResult[] = [];

            for (const profile of profilesToRun) {
                // Create a fresh ExTester instance for each profile
                // This ensures each profile gets a clean VS Code session
                const exTester = createExTester();
                logger.info("ProfileRunner", `Created fresh ExTester instance for profile: ${profile.name}`);

                const profileResults = await runTestsWithProfile(
                    profile,
                    testFilesToRun,
                    exTester,
                    projectRoot,
                    runtimeWorkspacePath
                );
                allResults.push(...profileResults);
            }

            // Print comprehensive summary matrix
            printSummaryMatrix(
                allResults,
                profilesToRun.map((p) => p.name),
                testFilesToRun
            );

            // Determine exit code
            const allPassed = allResults.every((r) => r.passed);

            if (allPassed) {
                logger.info("Summary", "All tests passed successfully!");
                logger.close();
                process.exit(0);
            } else {
                logger.error("Summary", "Some tests failed. See details above.");
                logger.close();
                process.exit(1);
            }
        } else {
            logger.info("TestRunner", "Mode: Subprocess (running each profile in isolated subprocess)");

            // Run all tests for each profile in a separate subprocess
            // This ensures complete isolation - Mocha and VS Code state are fresh for each profile
            const profileResults: ProfileResult[] = [];

            for (const profile of profilesToRun) {
                logger.info("ProfileRunner", `Starting isolated subprocess for profile: ${profile.name}`);

                const result = await runAllTestsForProfile(profile, testFilesToRun, projectRoot);
                profileResults.push(result);
            }

            // Print profile-level summary
            printProfileSummary(profileResults);

            // Determine exit code
            const allPassed = profileResults.every((r) => r.passed);

            if (allPassed) {
                logger.info("Summary", "All tests passed successfully!");
                logger.close();
                process.exit(0);
            } else {
                logger.error("Summary", "Some tests failed. See details above.");
                logger.close();
                process.exit(1);
            }
        }
    } catch (err) {
        const logger = getTestLogger();
        logger.error("TestRunner", `Failed to run UI tests: ${err}`);
        logger.close();
        process.exit(1);
    }
}

main();
