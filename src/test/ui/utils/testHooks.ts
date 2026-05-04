/**
 * @file src/test/ui/testHooks.ts
 * @description Shared test hooks and setup utilities for UI tests.
 * Provides reusable before/after/beforeEach/afterEach hook implementations
 */

import * as fs from "fs";
import * as path from "path";
import { VSBrowser, WebDriver, EditorView, Workbench, By, until } from "vscode-extension-tester";
import { openTestBenchSidebar, ensureLoggedIn, UITimeouts, releaseModifierKeys } from "./testUtils";
import {
    isSlowMotionEnabled,
    getSlowMotionDelay,
    hasTestCredentials,
    getCredentialReadinessErrorMessage,
    TEST_PATHS
} from "../config/testConfig";
import { getTestLogger } from "./testLogger";
import { ProjectsViewPage } from "../pages/ProjectsViewPage";
import { TestThemesPage } from "../pages/TestThemesPage";

/**
 * Waits for VS Code workbench to be fully loaded and ready.
 *
 * @param driver - WebDriver instance
 * @param timeout - Maximum time to wait in milliseconds (default: 60000)
 * @returns Promise<boolean> - True if workbench is ready, false if timeout
 */
async function waitForVSCodeReady(driver: WebDriver, timeout: number = 60000): Promise<boolean> {
    const logger = getTestLogger();
    logger.info("VSCode", "Waiting for VS Code to be ready...");

    try {
        //  Wait for the main workbench element
        await driver.wait(until.elementLocated(By.css(".monaco-workbench")), timeout, "Waiting for monaco-workbench");

        // Wait for the activity bar to be present
        await driver.wait(
            until.elementLocated(By.css(".activitybar, .composite.viewlet")),
            timeout / 2,
            "Waiting for activity bar"
        );

        // Wait for extensions to activate
        await driver.sleep(2000);

        // Verify workbench is still present
        const workbench = await driver.findElements(By.css(".monaco-workbench"));
        if (workbench.length === 0) {
            logger.warn("VSCode", "Workbench disappeared, waiting again...");
            await driver.wait(
                until.elementLocated(By.css(".monaco-workbench")),
                timeout / 2,
                "Waiting for workbench after restart"
            );
            await driver.sleep(1000);
        }

        logger.info("VSCode", "VS Code is ready");
        return true;
    } catch (error) {
        logger.error("VSCode", `Failed to wait for VS Code: ${error}`);
        return false;
    }
}

/**
 * Test context shared across hooks within a test suite.
 */
export interface TestContext {
    browser: VSBrowser;
    driver: WebDriver;
}

/**
 * Options for configuring test suite hooks.
 */
export interface TestHooksOptions {
    /** Whether tests require user to be logged in (default: true) */
    requiresLogin?: boolean;
    /** Whether to open TestBench sidebar before each test (default: true) */
    openSidebar?: boolean;
    /** Whether to close all editors before/after suite (default: true) */
    closeEditors?: boolean;
    /** Whether to log slow motion status (default: true) */
    logSlowMotion?: boolean;
    /** Custom timeout in milliseconds (default: not set, uses Mocha default) */
    timeout?: number;
    /** Test suite name for logging purposes */
    suiteName?: string;
    /** Whether to capture screenshots on test failure (default: true) */
    captureScreenshotOnFailure?: boolean;
    /** Whether to clear notifications after each test (default: true) */
    clearNotifications?: boolean;
    /** Whether to verify sidebar is open before opening (avoids redundant operations) (default: true) */
    verifySidebarBeforeOpen?: boolean;
}

/**
 * Default hook options.
 */
const DEFAULT_OPTIONS: Required<TestHooksOptions> = {
    requiresLogin: true,
    openSidebar: true,
    closeEditors: true,
    logSlowMotion: true,
    timeout: UITimeouts.WORKSPACE_LOAD,
    suiteName: "UITest",
    captureScreenshotOnFailure: true,
    clearNotifications: true,
    verifySidebarBeforeOpen: true
};

export type SkipCategory = "precondition" | "error";

/**
 * Structured skip metadata propagated by helpers that decide to skip.
 */
export interface SkipDecision {
    category: SkipCategory;
    reason: string;
}

interface TestSkipMetadata {
    category: SkipCategory;
    reason?: string;
}

interface SuiteExecutionStats {
    passed: number;
    failed: number;
    skipped: number;
    skippedByPrecondition: number;
    skippedByError: number;
}

type TestWithSkipMetadata = Mocha.Test & {
    __testbenchSkipMetadata?: TestSkipMetadata;
};

const suiteExecutionStats = new Map<string, SuiteExecutionStats>();

/**
 * Creates a zeroed stats object for one suite execution.
 */
function createEmptySuiteExecutionStats(): SuiteExecutionStats {
    return {
        passed: 0,
        failed: 0,
        skipped: 0,
        skippedByPrecondition: 0,
        skippedByError: 0
    };
}

/**
 * Initializes per-suite counters at suite start.
 */
function initializeSuiteExecutionStats(suiteName: string): void {
    suiteExecutionStats.set(suiteName, createEmptySuiteExecutionStats());
}

/**
 * Returns existing suite stats or lazily creates a fallback bucket.
 */
function getSuiteExecutionStats(suiteName: string): SuiteExecutionStats {
    const existingStats = suiteExecutionStats.get(suiteName);
    if (existingStats) {
        return existingStats;
    }

    const fallbackStats = createEmptySuiteExecutionStats();
    suiteExecutionStats.set(suiteName, fallbackStats);
    return fallbackStats;
}

/**
 * Persists skip metadata on the current test so afterEach can classify it.
 */
function recordSkipMetadata(test: Mocha.Test | undefined, metadata: TestSkipMetadata): void {
    if (!test) {
        return;
    }

    (test as TestWithSkipMetadata).__testbenchSkipMetadata = metadata;
}

/**
 * Reads and clears skip metadata from the test to avoid cross-test leakage.
 */
function consumeSkipMetadata(test: Mocha.Test | undefined): TestSkipMetadata | undefined {
    if (!test) {
        return undefined;
    }

    const typedTest = test as TestWithSkipMetadata;
    const metadata = typedTest.__testbenchSkipMetadata;
    delete typedTest.__testbenchSkipMetadata;
    return metadata;
}

/**
 * Skips the current test while recording categorized skip metadata for reporting.
 *
 * @param context - Mocha execution context
 * @param category - Skip classification used in per-suite summary output
 * @param reason - Optional human-readable reason for the skip
 * @returns Never returns because Mocha marks the test pending and aborts execution
 */
export function skipTest(context: Mocha.Context, category: SkipCategory, reason?: string): never {
    recordSkipMetadata(context.currentTest, { category, reason });
    return context.skip();
}

/**
 * Safely executes an async operation with error handling.
 * Logs errors but doesn't throw. Used for cleanup operations
 * that should not fail the test.
 *
 * @param operation - The async operation to execute
 * @param operationName - Name of the operation for logging
 * @param suiteName - Name of the test suite for logging context
 * @returns Promise<boolean> - True if operation succeeded, false otherwise
 */
async function safeExecute<T = void>(
    operation: () => Promise<T>,
    operationName: string,
    suiteName: string = "UITest"
): Promise<boolean> {
    const logger = getTestLogger();
    try {
        await operation();
        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isStaleElement = errorMessage.includes("stale element") || errorMessage.includes("StaleElementReference");

        if (isStaleElement) {
            logger.debug(suiteName, `${operationName}: stale element (expected during cleanup)`);
        } else {
            logger.warn(suiteName, `${operationName} failed: ${errorMessage}`);
        }
        return false;
    }
}

/**
 * Logs slow motion configuration status.
 * Called at the start of each test when logSlowMotion is enabled.
 */
export function logSlowMotionStatus(): void {
    const logger = getTestLogger();
    if (isSlowMotionEnabled()) {
        logger.info("SlowMotion", `Enabled with ${getSlowMotionDelay()}ms delay`);
    } else {
        logger.debug("SlowMotion", "Disabled");
    }
}

/**
 * Captures a screenshot and saves it to the test artifacts directory.
 * Screenshots are saved with a timestamp and test name for easy identification.
 *
 * @param driver - WebDriver instance
 * @param testName - Name of the test (used in filename)
 * @param suiteName - Name of the test suite (used in filename)
 * @returns Promise<string | null> - Path to saved screenshot or null if failed
 */
export async function captureScreenshot(
    driver: WebDriver,
    testName: string,
    suiteName: string = "UITest"
): Promise<string | null> {
    const logger = getTestLogger();
    try {
        // Create screenshots directory if it doesn't exist
        const projectRoot = path.resolve(__dirname, "../../../");
        const screenshotsDir = path.join(projectRoot, TEST_PATHS.BASE_STORAGE, "screenshots");

        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const sanitizedTestName = testName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
        const filename = `${suiteName}_${sanitizedTestName}_${timestamp}.png`;
        const filepath = path.join(screenshotsDir, filename);

        const screenshot = await driver.takeScreenshot();
        fs.writeFileSync(filepath, screenshot, "base64");

        logger.info("Screenshot", `Saved: ${filepath}`);
        return filepath;
    } catch (error) {
        logger.error("Screenshot", `Failed to capture screenshot: ${error}`);
        return null;
    }
}

/**
 * Clears all VS Code notifications.
 * Useful for cleaning up state between tests.
 *
 * @param driver - WebDriver instance
 * @returns Promise<number> - Number of notifications cleared
 */
export async function clearAllNotifications(driver: WebDriver): Promise<number> {
    const logger = getTestLogger();
    try {
        await driver.switchTo().defaultContent();

        let clearedCount = 0;
        const maxIterations = 20; // Limit

        for (let i = 0; i < maxIterations; i++) {
            try {
                // Find notification close buttons
                const closeButtons = await driver.findElements(
                    By.css(
                        ".notifications-toasts .codicon-notifications-clear, " +
                            ".notifications-toasts .codicon-close, " +
                            ".notification-toast .action-label.codicon-close, " +
                            ".notification-toast .codicon-notifications-clear-all"
                    )
                );

                if (closeButtons.length === 0) {
                    break; // No more notifications to clear
                }

                // Click the first close button
                const btn = closeButtons[0];
                if (await btn.isDisplayed()) {
                    await btn.click();
                    clearedCount++;
                    await driver.sleep(100);
                }
            } catch {
                // Notification may have disappeared, continue
                break;
            }
        }

        // Also try to clear notifications via command palette if any remain
        if (clearedCount === 0) {
            try {
                const workbench = new Workbench();
                const notificationCenter = await workbench.openNotificationsCenter();
                await notificationCenter.clearAllNotifications();
                await notificationCenter.close();
            } catch {
                // Ignore errors - notification center might not be available
            }
        }

        if (clearedCount > 0) {
            logger.debug("Cleanup", `Cleared ${clearedCount} notification(s)`);
        }

        return clearedCount;
    } catch (error) {
        logger.warn("Cleanup", `Error clearing notifications: ${error}`);
        return 0;
    }
}

/**
 * Checks if the TestBench sidebar is currently open and visible.
 *
 * @param _driver - WebDriver instance (unused but kept for API consistency)
 * @returns Promise<boolean> - True if sidebar is open, false otherwise
 */
export async function isTestBenchSidebarOpen(_driver: WebDriver): Promise<boolean> {
    try {
        const { SideBarView } = await import("vscode-extension-tester");
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        const sections = await content.getSections();

        for (const section of sections) {
            const title = await section.getTitle();
            if (
                title.includes("TestBench") ||
                title.includes("Projects") ||
                title.includes("Login") ||
                title.includes("Test Themes") ||
                title.includes("Test Elements")
            ) {
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Ensures user is logged in and skips test if login fails or credentials unavailable.
 *
 * @param driver - WebDriver instance
 * @param suiteName - Name of the test suite for logging
 * @param skipFn - Callback that applies skip behavior using an optional categorized decision payload
 * @returns Promise<boolean> - True if logged in, false if test should be skipped
 */
export async function ensureLoggedInOrSkip(
    driver: WebDriver,
    suiteName: string,
    skipFn: (decision?: SkipDecision) => void
): Promise<boolean> {
    const logger = getTestLogger();
    if (!hasTestCredentials()) {
        const readinessMessage = getCredentialReadinessErrorMessage();
        const reason = readinessMessage
            ? `Test credentials not available. Skipping tests. ${readinessMessage}`
            : "Test credentials not available. Skipping tests.";
        logger.warn(suiteName, reason);
        skipFn({ category: "precondition", reason });
        return false;
    }

    const loggedIn = await ensureLoggedIn(driver);
    if (!loggedIn) {
        const reason = "Failed to login. Skipping tests.";
        logger.warn(suiteName, reason);
        skipFn({ category: "precondition", reason });
        return false;
    }

    return true;
}

/**
 * Creates a standard `before` hook implementation.
 * Initializes browser and driver, waits for VS Code to be ready, closes all editors.
 *
 * @param context - Test context object to populate with browser/driver
 * @param options - Hook configuration options
 * @returns Async function suitable for Mocha's `before` hook
 */
export function createBeforeHook(context: TestContext, options: TestHooksOptions = {}): () => Promise<void> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    return async function (): Promise<void> {
        const logger = getTestLogger();
        context.browser = VSBrowser.instance;
        context.driver = context.browser.driver;

        logger.suiteStart(opts.suiteName);
        initializeSuiteExecutionStats(opts.suiteName);

        // Wait for VS Code to be fully loaded before any interactions
        const isReady = await waitForVSCodeReady(context.driver, opts.timeout);
        if (!isReady) {
            throw new Error("VS Code did not become ready within the timeout period");
        }

        if (opts.closeEditors) {
            await safeExecute(
                async () => new EditorView().closeAllEditors(),
                "Close all editors in before hook",
                opts.suiteName
            );
        }
    };
}

/**
 * Creates a standard `after` hook implementation.
 * Closes all editors.
 *
 * @param options - Hook configuration options
 * @returns Async function suitable for Mocha's `after` hook
 */
export function createAfterHook(options: TestHooksOptions = {}): () => Promise<void> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    return async function (): Promise<void> {
        const logger = getTestLogger();
        const stats = getSuiteExecutionStats(opts.suiteName);

        if (opts.closeEditors) {
            await safeExecute(
                async () => new EditorView().closeAllEditors(),
                "Close all editors in after hook",
                opts.suiteName
            );
        }

        logger.suiteEnd(opts.suiteName, {
            passed: stats.passed,
            failed: stats.failed,
            skipped: stats.skipped
        });

        if (stats.skipped > 0) {
            logger.info(
                "Suite",
                `Skip breakdown for ${opts.suiteName}: precondition=${stats.skippedByPrecondition}, error=${stats.skippedByError}`
            );
        }

        suiteExecutionStats.delete(opts.suiteName);
    };
}

/**
 * Creates a standard `beforeEach` hook implementation.
 * Opens sidebar, logs slow motion status, ensures login.
 *
 * @param getDriver - Function that returns the WebDriver instance
 * @param options - Hook configuration options
 * @returns Async function suitable for Mocha's `beforeEach` hook
 */
export function createBeforeEachHook(
    getDriver: () => WebDriver,
    options: TestHooksOptions = {}
): (this: Mocha.Context) => Promise<void> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    return async function (this: Mocha.Context): Promise<void> {
        const driver = getDriver();
        const logger = getTestLogger();
        const testTitle = this.currentTest?.title || "unknown";

        logger.testStart(opts.suiteName, testTitle);

        if (opts.logSlowMotion) {
            logSlowMotionStatus();
        }

        if (opts.openSidebar) {
            if (opts.verifySidebarBeforeOpen) {
                const isOpen = await isTestBenchSidebarOpen(driver);
                if (!isOpen) {
                    await openTestBenchSidebar(driver);
                } else {
                    logger.debug(opts.suiteName, "TestBench sidebar is already open");
                }
            } else {
                await openTestBenchSidebar(driver);
            }
        }

        if (opts.requiresLogin) {
            await ensureLoggedInOrSkip(driver, opts.suiteName, (decision) => {
                const category = decision?.category || "precondition";
                const reason = decision?.reason;
                skipTest(this, category, reason);
            });
        }
    };
}

/**
 * Creates a standard `afterEach` hook implementation.
 * Handles cleanup tasks including:
 * - Capturing screenshots on test failure
 * - Clearing notifications
 * - Ensuring driver is in default content
 * - Logging test duration and status
 *
 * @param getDriver - Function that returns the WebDriver instance
 * @param options - Hook configuration options
 * @returns Async function suitable for Mocha's `afterEach` hook
 */
export function createAfterEachHook(
    getDriver: () => WebDriver,
    options: TestHooksOptions = {}
): (this: Mocha.Context) => Promise<void> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    return async function (this: Mocha.Context): Promise<void> {
        const driver = getDriver();
        const logger = getTestLogger();
        const stats = getSuiteExecutionStats(opts.suiteName);
        const testTitle = this.currentTest?.title || "unknown";
        const testState = this.currentTest?.state;
        const testDuration = this.currentTest?.duration;

        // Log test result
        if (testState === "failed") {
            stats.failed += 1;
            logger.testFail(testTitle, this.currentTest?.err, testDuration);

            // Capture screenshot on failure - use safe execution to prevent blocking other cleanup
            if (opts.captureScreenshotOnFailure) {
                await safeExecute(
                    async () => captureScreenshot(driver, testTitle, opts.suiteName),
                    "Capture failure screenshot",
                    opts.suiteName
                );
            }
        } else if (testState === "passed") {
            stats.passed += 1;
            logger.testPass(testTitle, testDuration);
        } else if (testState === "pending") {
            stats.skipped += 1;
            const skipMetadata = consumeSkipMetadata(this.currentTest);

            if (skipMetadata?.category === "precondition") {
                stats.skippedByPrecondition += 1;
                logger.testSkip(testTitle, skipMetadata.reason || "precondition");
            } else {
                stats.skippedByError += 1;
                logger.testSkip(testTitle, skipMetadata?.reason || "uncategorized");
            }
        }

        // Clear notifications to ensure clean state for next test
        if (opts.clearNotifications) {
            await safeExecute(async () => clearAllNotifications(driver), "Clear notifications", opts.suiteName);
        }

        // Ensure we're back to default content (not stuck in a webview)
        await safeExecute(
            async () => {
                await driver.switchTo().defaultContent();
            },
            "Switch to default content",
            opts.suiteName
        );

        // Close any open dialogs by pressing Escape
        await safeExecute(
            async () => {
                const { Key } = await import("vscode-extension-tester");
                await driver.actions().sendKeys(Key.ESCAPE).perform();
            },
            "Close dialogs with Escape key",
            opts.suiteName
        );

        // Reset keyboard modifier state so one test cannot affect the next test's input actions.
        await safeExecute(
            async () => {
                await releaseModifierKeys(driver, "Cleanup");
            },
            "Release modifier keys",
            opts.suiteName
        );
    };
}

/**
 * Sets up all standard hooks for a test suite.
 * Convenience function that registers before, after, beforeEach, and afterEach hooks.
 *
 * @param context - Test context object to populate with browser/driver
 * @param options - Hook configuration options
 */
export function setupTestHooks(context: TestContext, options: TestHooksOptions = {}): void {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    before(createBeforeHook(context, opts));
    after(createAfterHook(opts));
    beforeEach(createBeforeEachHook(() => context.driver, opts));
    afterEach(createAfterEachHook(() => context.driver, opts));
}

/**
 * Resets the extension state by navigating to Projects view.
 * Useful for ensuring a known state before tests that depend on specific views.
 *
 * This function:
 * 1. Opens the TestBench sidebar
 * 2. If in Test Themes/Elements views, clicks "Open Projects View" to return to Projects
 * 3. Waits for Projects view to be visible
 *
 * @param driver - WebDriver instance
 * @param suiteName - Name of the test suite for logging
 * @returns Promise<boolean> - True if reset was successful, false otherwise
 */
export async function resetToProjectsView(driver: WebDriver, suiteName: string = "TestHooks"): Promise<boolean> {
    const logger = getTestLogger();
    try {
        await driver.switchTo().defaultContent();
        await openTestBenchSidebar(driver);

        const projectsPage = new ProjectsViewPage(driver);
        const themesPage = new TestThemesPage(driver);

        // Check if we're already in Projects view
        if (await projectsPage.isProjectsViewVisible()) {
            logger.debug(suiteName, "Already in Projects view");
            return true;
        }

        // We might be in Test Themes/Elements view - try to navigate back
        if (await themesPage.isTestThemesViewVisible()) {
            logger.info(suiteName, "In Test Themes view, navigating back to Projects...");
            await themesPage.clickOpenProjectsView();

            // Wait for projects view to appear
            try {
                await driver.wait(
                    async () => {
                        return await projectsPage.isProjectsViewVisible();
                    },
                    5000,
                    "Waiting for Projects view to appear"
                );

                logger.info(suiteName, "Successfully returned to Projects view");
                return true;
            } catch {
                logger.warn(suiteName, "Timed out waiting for Projects view after clicking back");
            }
        }

        logger.warn(suiteName, "Could not reset to Projects view");
        return false;
    } catch (error) {
        logger.error(suiteName, `Error resetting to Projects view: ${error}`);
        return false;
    }
}

/**
 * Collapses all expanded tree items in a tree section.
 * Useful for resetting tree state between tests to ensure isolation.
 *
 * @param driver - WebDriver instance
 * @param section - The tree section containing items to collapse
 * @returns Promise<number> - Number of items collapsed
 */
export async function collapseAllTreeItems(driver: WebDriver, section: any): Promise<number> {
    let collapsedCount = 0;
    try {
        const items = await section.getVisibleItems();
        for (const item of items) {
            try {
                const hasChildren = await item.hasChildren();
                const isExpanded = await item.isExpanded();
                if (hasChildren && isExpanded) {
                    await item.collapse();
                    await driver.sleep(100); // Brief pause for UI update
                    collapsedCount++;
                }
            } catch {
                // Item may have been removed or become stale, continue
            }
        }
    } catch {
        // Section may not be available
    }
    return collapsedCount;
}

/**
 * Options for configuring login webview test hooks.
 */
export interface LoginWebviewHooksOptions extends TestHooksOptions {
    /** Custom beforeEach logic to run after standard cleanup (logout, delete connections) */
    customBeforeEach?: (driver: WebDriver) => Promise<void>;
    /** Maximum number of cleanup retry attempts (default: 3) */
    maxCleanupRetries?: number;
    /** Whether to skip the test if cleanup fails completely (default: true) */
    skipOnCleanupFailure?: boolean;
}

/**
 * Attempts to close any stuck dialogs by pressing Escape multiple times.
 *
 * @param driver - WebDriver instance
 * @param maxAttempts - Maximum number of escape key presses (default: 3)
 * @returns Promise<void>
 */
async function closeStuckDialogs(driver: WebDriver, maxAttempts: number = 3): Promise<void> {
    const { Key } = await import("vscode-extension-tester");
    for (let i = 0; i < maxAttempts; i++) {
        await safeExecute(
            async () => {
                await driver.actions().sendKeys(Key.ESCAPE).perform();
                await driver.sleep(200);
            },
            `Send Escape key (attempt ${i + 1}/${maxAttempts})`,
            "Cleanup"
        );
    }
}

/**
 * Verifies that the webview is in a clean state (no connections, form reset).
 *
 * @param driver - WebDriver instance
 * @returns Promise<boolean> - True if webview is in clean state
 */
async function verifyCleanWebviewState(driver: WebDriver): Promise<boolean> {
    try {
        const { findAndSwitchToWebview } = await import("./testUtils");
        const webviewFound = await findAndSwitchToWebview(driver);
        if (!webviewFound) {
            return false;
        }

        // Check if connections list is empty
        const { ConnectionPage } = await import("../pages/ConnectionPage");
        const connectionPage = new ConnectionPage(driver);
        const connectionCount = await connectionPage.getConnectionCount();

        await driver.switchTo().defaultContent();

        return connectionCount === 0;
    } catch {
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore
        }
        return false;
    }
}

/**
 * Creates a beforeEach hook specifically for login webview tests.
 * These tests require the user to be logged OUT and all connections deleted.
 * Includes robust cleanup with retry logic and state verification.
 *
 * @param getDriver - Function that returns the WebDriver instance
 * @param options - Hook configuration options
 * @returns Async function suitable for Mocha's `beforeEach` hook
 */
export function createLoginWebviewBeforeEachHook(
    getDriver: () => WebDriver,
    options: LoginWebviewHooksOptions = {}
): (this: Mocha.Context) => Promise<void> {
    const opts = {
        ...DEFAULT_OPTIONS,
        ...options,
        suiteName: options.suiteName || "LoginWebview",
        maxCleanupRetries: options.maxCleanupRetries ?? 3,
        skipOnCleanupFailure: options.skipOnCleanupFailure ?? true
    };

    return async function (this: Mocha.Context): Promise<void> {
        const driver = getDriver();

        if (opts.logSlowMotion) {
            logSlowMotionStatus();
        }

        // Clear any leftover notifications from previous tests
        if (opts.clearNotifications) {
            await safeExecute(
                async () => clearAllNotifications(driver),
                "Clear notifications in login webview beforeEach",
                opts.suiteName
            );
        }

        // Close any stuck dialogs before starting cleanup
        await closeStuckDialogs(driver);

        await openTestBenchSidebar(driver);

        const { attemptLogout, deleteAllConnections, isWebviewAvailable } = await import("./testUtils");
        const logger = getTestLogger();

        // Attempt logout with retry
        let logoutSuccess = false;
        for (let attempt = 1; attempt <= opts.maxCleanupRetries; attempt++) {
            try {
                await attemptLogout(driver);
                logoutSuccess = true;
                break;
            } catch (error) {
                logger.warn(opts.suiteName, `Logout attempt ${attempt}/${opts.maxCleanupRetries} failed: ${error}`);
                if (attempt < opts.maxCleanupRetries) {
                    await closeStuckDialogs(driver);
                    await driver.sleep(500);
                }
            }
        }

        if (!logoutSuccess) {
            logger.debug(opts.suiteName, "All logout attempts failed - may already be logged out");
        }

        // Delete all connections with retry
        let cleanupSuccess = false;
        for (let attempt = 1; attempt <= opts.maxCleanupRetries; attempt++) {
            try {
                await deleteAllConnections(driver);

                // Verify cleanup was successful
                const isClean = await verifyCleanWebviewState(driver);
                if (isClean) {
                    cleanupSuccess = true;
                    logger.info(opts.suiteName, "Cleanup verified: webview is in clean state");
                    break;
                } else {
                    logger.warn(
                        opts.suiteName,
                        `Cleanup attempt ${attempt}/${opts.maxCleanupRetries}: connections still exist`
                    );
                }
            } catch (error) {
                logger.warn(opts.suiteName, `Cleanup attempt ${attempt}/${opts.maxCleanupRetries} failed: ${error}`);
            }

            // Recovery actions between retries
            if (attempt < opts.maxCleanupRetries) {
                await closeStuckDialogs(driver);
                await driver.switchTo().defaultContent();
                await driver.sleep(500);
                await openTestBenchSidebar(driver);
            }
        }

        if (!cleanupSuccess) {
            logger.warn(opts.suiteName, "⚠ Warning: Cleanup may not be complete after all retry attempts");

            if (opts.skipOnCleanupFailure) {
                const reason = "Skipping test due to cleanup failure";
                logger.info(opts.suiteName, reason);
                skipTest(this, "error", reason);
                return;
            }
        }

        await driver.switchTo().defaultContent();

        // Wait for workbench to be ready
        const { until, By } = await import("vscode-extension-tester");
        try {
            await driver.wait(
                until.elementLocated(By.css(".monaco-workbench")),
                UITimeouts.MEDIUM,
                "Waiting for workbench to be ready"
            );
        } catch (error) {
            logger.warn(opts.suiteName, `Workbench wait timed out: ${error}`);
        }

        // Wait for webview to be available after cleanup
        try {
            await driver.wait(
                async () => {
                    try {
                        return await isWebviewAvailable(driver);
                    } catch {
                        return false;
                    }
                },
                UITimeouts.MEDIUM,
                "Waiting for webview to be available after cleanup"
            );
        } catch (error) {
            logger.warn(opts.suiteName, `Webview availability wait timed out: ${error}`);
            // Continue anyway - the test will handle webview availability checks
        }

        if (options.customBeforeEach) {
            await options.customBeforeEach(driver);
        }
    };
}

/**
 * Sets up hooks for login webview tests (which have different requirements).
 * These tests need the user to be logged OUT, not logged in.
 *
 * @param context - Test context object to populate with browser/driver
 * @param options - Hook configuration options (requiresLogin is forced to false)
 */
export function setupLoginWebviewTestHooks(context: TestContext, options: LoginWebviewHooksOptions = {}): void {
    const opts = {
        ...DEFAULT_OPTIONS,
        ...options,
        requiresLogin: false, // Login webview tests require logged OUT state
        suiteName: options.suiteName || "LoginWebview"
    };

    before(createBeforeHook(context, opts));
    after(createAfterHook(opts));
    beforeEach(createLoginWebviewBeforeEachHook(() => context.driver, opts));
    afterEach(createAfterEachHook(() => context.driver, opts));
}
