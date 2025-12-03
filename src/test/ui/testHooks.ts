/**
 * @file src/test/ui/testHooks.ts
 * @description Shared test hooks and setup utilities for UI tests.
 * Provides reusable before/after/beforeEach/afterEach hook implementations
 */

import * as fs from "fs";
import * as path from "path";
import { VSBrowser, WebDriver, EditorView, Workbench, By, until } from "vscode-extension-tester";
import { openTestBenchSidebar, ensureLoggedIn, UITimeouts } from "./testUtils";
import { isSlowMotionEnabled, getSlowMotionDelay, hasTestCredentials, TEST_PATHS } from "./testConfig";

/**
 * Waits for VS Code workbench to be fully loaded and ready.
 *
 * @param driver - WebDriver instance
 * @param timeout - Maximum time to wait in milliseconds (default: 60000)
 * @returns Promise<boolean> - True if workbench is ready, false if timeout
 */
async function waitForVSCodeReady(driver: WebDriver, timeout: number = 60000): Promise<boolean> {
    console.log("[VSCode] Waiting for VS Code to be ready...");

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
            console.log("[VSCode] Workbench disappeared, waiting again...");
            await driver.wait(
                until.elementLocated(By.css(".monaco-workbench")),
                timeout / 2,
                "Waiting for workbench after restart"
            );
            await driver.sleep(1000);
        }

        console.log("[VSCode] ✓ VS Code is ready");
        return true;
    } catch (error) {
        console.log(`[VSCode] ✗ Failed to wait for VS Code: ${error}`);
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

/**
 * Logs slow motion configuration status.
 * Called at the start of each test when logSlowMotion is enabled.
 */
export function logSlowMotionStatus(): void {
    if (isSlowMotionEnabled()) {
        console.log(`[Slow Motion] Enabled with ${getSlowMotionDelay()}ms delay`);
    } else {
        console.log("[Slow Motion] Disabled");
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

        console.log(`[Screenshot] Saved: ${filepath}`);
        return filepath;
    } catch (error) {
        console.log(`[Screenshot] Failed to capture screenshot: ${error}`);
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
            console.log(`[Cleanup] Cleared ${clearedCount} notification(s)`);
        }

        return clearedCount;
    } catch (error) {
        console.log(`[Cleanup] Error clearing notifications: ${error}`);
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
 * @param skipFn - Function to call to skip the test (typically `this.skip()`)
 * @returns Promise<boolean> - True if logged in, false if test should be skipped
 */
export async function ensureLoggedInOrSkip(driver: WebDriver, suiteName: string, skipFn: () => void): Promise<boolean> {
    if (!hasTestCredentials()) {
        console.log(`[${suiteName}] Test credentials not available. Skipping tests.`);
        skipFn();
        return false;
    }

    const loggedIn = await ensureLoggedIn(driver);
    if (!loggedIn) {
        console.log(`[${suiteName}] Failed to login. Skipping tests.`);
        skipFn();
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
        context.browser = VSBrowser.instance;
        context.driver = context.browser.driver;

        // Wait for VS Code to be fully loaded before any interactions
        const isReady = await waitForVSCodeReady(context.driver, opts.timeout);
        if (!isReady) {
            throw new Error("VS Code did not become ready within the timeout period");
        }

        if (opts.closeEditors) {
            try {
                await new EditorView().closeAllEditors();
            } catch (error) {
                console.log(`[${opts.suiteName}] Warning: Could not close editors: ${error}`);
                // Don't fail the hook, editors might already be closed
            }
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
        if (opts.closeEditors) {
            try {
                await new EditorView().closeAllEditors();
            } catch (error) {
                console.log(`[${opts.suiteName}] Warning: Could not close editors in after hook: ${error}`);
                // Don't fail the hook
            }
        }
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

        if (opts.logSlowMotion) {
            logSlowMotionStatus();
        }

        if (opts.openSidebar) {
            if (opts.verifySidebarBeforeOpen) {
                const isOpen = await isTestBenchSidebarOpen(driver);
                if (!isOpen) {
                    await openTestBenchSidebar(driver);
                } else {
                    console.log(`[${opts.suiteName}] TestBench sidebar is already open`);
                }
            } else {
                await openTestBenchSidebar(driver);
            }
        }

        if (opts.requiresLogin) {
            await ensureLoggedInOrSkip(driver, opts.suiteName, () => this.skip());
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
        const testTitle = this.currentTest?.title || "unknown";
        const testState = this.currentTest?.state;
        const testDuration = this.currentTest?.duration;

        // Log test result
        if (testState === "failed") {
            console.log(`[${opts.suiteName}] ✗ Test failed: "${testTitle}"`);

            // Capture screenshot on failure
            if (opts.captureScreenshotOnFailure) {
                await captureScreenshot(driver, testTitle, opts.suiteName);
            }
        } else if (testState === "passed") {
            const durationStr = testDuration ? ` (${testDuration}ms)` : "";
            console.log(`[${opts.suiteName}] ✓ Test passed: "${testTitle}"${durationStr}`);
        }

        // Clear notifications to ensure clean state for next test
        if (opts.clearNotifications) {
            await clearAllNotifications(driver);
        }

        // Ensure we're back to default content (not stuck in a webview)
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore errors when switching to default content
        }

        // Close any open dialogs by pressing Escape
        try {
            const { Key } = await import("vscode-extension-tester");
            await driver.actions().sendKeys(Key.ESCAPE).perform();
        } catch {
            // Ignore errors when sending Escape key
        }
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
        try {
            await driver.actions().sendKeys(Key.ESCAPE).perform();
            await driver.sleep(200);
        } catch {
            // Ignore escape key errors
        }
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
        const { ConnectionPage } = await import("./pages/ConnectionPage");
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
            await clearAllNotifications(driver);
        }

        // Close any stuck dialogs before starting cleanup
        await closeStuckDialogs(driver);

        await openTestBenchSidebar(driver);

        const { attemptLogout, deleteAllConnections, isWebviewAvailable } = await import("./testUtils");

        // Attempt logout with retry
        let logoutSuccess = false;
        for (let attempt = 1; attempt <= opts.maxCleanupRetries; attempt++) {
            try {
                await attemptLogout(driver);
                logoutSuccess = true;
                break;
            } catch (error) {
                console.log(`[${opts.suiteName}] Logout attempt ${attempt}/${opts.maxCleanupRetries} failed: ${error}`);
                if (attempt < opts.maxCleanupRetries) {
                    await closeStuckDialogs(driver);
                    await driver.sleep(500);
                }
            }
        }

        if (!logoutSuccess) {
            console.log(`[${opts.suiteName}] All logout attempts failed - may already be logged out`);
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
                    console.log(`[${opts.suiteName}] ✓ Cleanup verified: webview is in clean state`);
                    break;
                } else {
                    console.log(
                        `[${opts.suiteName}] Cleanup attempt ${attempt}/${opts.maxCleanupRetries}: connections still exist`
                    );
                }
            } catch (error) {
                console.log(
                    `[${opts.suiteName}] Cleanup attempt ${attempt}/${opts.maxCleanupRetries} failed: ${error}`
                );
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
            console.log(`[${opts.suiteName}] ⚠ Warning: Cleanup may not be complete after all retry attempts`);

            if (opts.skipOnCleanupFailure) {
                console.log(`[${opts.suiteName}] Skipping test due to cleanup failure`);
                this.skip();
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
            console.log(`[${opts.suiteName}] Warning: Workbench wait timed out: ${error}`);
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
            console.log(`[${opts.suiteName}] Warning: Webview availability wait timed out: ${error}`);
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
