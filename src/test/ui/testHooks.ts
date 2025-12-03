/**
 * @file src/test/ui/testHooks.ts
 * @description Shared test hooks and setup utilities for UI tests.
 * Provides reusable before/after/beforeEach/afterEach hook implementations
 */

import { VSBrowser, WebDriver, EditorView } from "vscode-extension-tester";
import { openTestBenchSidebar, ensureLoggedIn } from "./testUtils";
import { isSlowMotionEnabled, getSlowMotionDelay, hasTestCredentials } from "./testConfig";

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
}

/**
 * Default hook options.
 */
const DEFAULT_OPTIONS: Required<TestHooksOptions> = {
    requiresLogin: true,
    openSidebar: true,
    closeEditors: true,
    logSlowMotion: true,
    timeout: 120000,
    suiteName: "UITest"
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
 * Initializes browser and driver, closes all editors.
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

        if (opts.closeEditors) {
            await new EditorView().closeAllEditors();
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
            await new EditorView().closeAllEditors();
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
            await openTestBenchSidebar(driver);
        }

        if (opts.requiresLogin) {
            await ensureLoggedInOrSkip(driver, opts.suiteName, () => this.skip());
        }
    };
}

/**
 * Creates a standard `afterEach` hook implementation.
 * Can be extended for cleanup tasks.
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
        // Placeholder for future cleanup logic
        // Example actions:
        // - Take screenshots on failure
        // - Reset state
        // - Clear notifications
        // - Log test duration
        const driver = getDriver();

        // Log test result if test failed
        if (this.currentTest?.state === "failed") {
            console.log(`[${opts.suiteName}] Test failed: ${this.currentTest.title}`);
            // await captureScreenshot(driver, this.currentTest.title);
        }

        // Ensure we're back to default content (not stuck in a webview)
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore errors when switching to default content
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
 * Sets up hooks for login webview tests (which have different requirements).
 * These tests need the user to be logged OUT, not logged in.
 *
 * @param context - Test context object to populate with browser/driver
 * @param options - Hook configuration options (requiresLogin is forced to false)
 */
export function setupLoginWebviewTestHooks(context: TestContext, options: TestHooksOptions = {}): void {
    const opts = {
        ...DEFAULT_OPTIONS,
        ...options,
        requiresLogin: false, // Login webview tests require logged OUT state
        suiteName: options.suiteName || "LoginWebview"
    };

    before(createBeforeHook(context, opts));
    after(createAfterHook(opts));
    // Note: loginWebview.ui.test.ts has custom beforeEach that handles logout
    // Don't register a standard beforeEach here
}
