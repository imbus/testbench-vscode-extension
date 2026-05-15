/**
 * @file src/test/ui/utils/waitHelpers.ts
 * @description Wait and timing helpers for UI tests.
 */

import { getSlowMotionDelay } from "../config/testConfig";
import { getTestLogger } from "./testLogger";
import { WebDriver, By, SideBarView } from "vscode-extension-tester";

const logger = getTestLogger();
const DEFAULT_WAIT_TEXT_SNIPPET_LENGTH = 80;

interface TreeSectionLike {
    getVisibleItems(): Promise<unknown[]>;
    getTitle?(): Promise<string>;
}

/**
 * Creates a single-line snippet suitable for timeout diagnostics.
 *
 * @param text - Raw text to normalize and truncate
 * @param maxLength - Maximum snippet length including ellipsis
 * @returns string - Normalized, bounded-length text snippet
 */
function createWaitTextSnippet(text: string, maxLength: number = DEFAULT_WAIT_TEXT_SNIPPET_LENGTH): string {
    const normalizedText = text.replace(/\s+/g, " ").trim();
    if (!normalizedText) {
        return "<empty>";
    }

    if (normalizedText.length <= maxLength) {
        return normalizedText;
    }

    return `${normalizedText.slice(0, Math.max(1, maxLength - 3))}...`;
}

/**
 * Timeout and delay constants for UI operations (in milliseconds).
 * Timeouts are used for waiting with conditions (driver.wait).
 * Delays are used for fixed sleep durations (driver.sleep).
 */
export const UITimeouts = {
    MINIMAL: 1000,
    SHORT: 2000,
    MEDIUM: 5000,
    LONG: 10000,
    VERY_LONG: 15000,
    WORKSPACE_LOAD: 120000
} as const;

/**
 * Waits for a condition to be true with polling.
 *
 * @param driver - The WebDriver instance
 * @param condition - Function that returns true when condition is met
 * @param timeout - Maximum time to wait (default: 5000ms)
 * @param pollInterval - How often to check condition (default: 100ms)
 * @param description - Description for logging
 * @returns Promise<boolean> - True if condition was met, false if timeout
 */
export async function waitForCondition(
    driver: WebDriver,
    condition: () => Promise<boolean>,
    timeout: number = UITimeouts.MEDIUM,
    pollInterval: number = 100,
    description: string = "condition"
): Promise<boolean> {
    let lastConditionError: unknown;

    try {
        await driver.wait(
            async () => {
                try {
                    return await condition();
                } catch (error) {
                    lastConditionError = error;
                    // Keep polling when the condition is temporarily unstable.
                    return false;
                }
            },
            timeout,
            `Waiting for ${description}`,
            pollInterval
        );
        return true;
    } catch (waitError) {
        const waitErrorMessage = waitError instanceof Error ? waitError.message : String(waitError);
        const conditionErrorContext =
            lastConditionError !== undefined
                ? `; lastConditionError=${lastConditionError instanceof Error ? lastConditionError.message : String(lastConditionError)}`
                : "";

        logger.debug(
            "Wait",
            `Timeout waiting for ${description} (timeout=${timeout}ms, poll=${pollInterval}ms; waitError=${waitErrorMessage})${conditionErrorContext}`
        );
        return false;
    }
}

/**
 * Waits for the VS Code activity bar element to be present in the DOM.
 *
 * Standardizes activity-bar readiness polling that previously appeared as
 * inline `driver.wait` callbacks across reload/stability helpers, providing
 * uniform timeout/poll diagnostics via {@link waitForCondition}.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait in milliseconds
 * @param context - Caller context appended to the wait description for diagnostics
 * @returns Promise<boolean> - True if the activity bar appeared, false on timeout
 */
export async function waitForActivityBar(
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM,
    context: string = "shell readiness"
): Promise<boolean> {
    return waitForCondition(
        driver,
        async () => {
            try {
                const activityBar = await driver.findElement(By.id("workbench.parts.activitybar"));
                return activityBar !== null;
            } catch {
                return false;
            }
        },
        timeout,
        100,
        `activity bar to be interactive (${context})`
    );
}

/**
 * Executes a bounded retry loop for operations that are attempt-driven
 * rather than time/poll-driven.
 *
 * @param operation - Operation that returns true when successful
 * @param maxAttempts - Maximum number of attempts before giving up
 * @param description - Human-readable context for diagnostics
 * @param onRetry - Optional hook executed between attempts
 * @returns Promise<boolean> - True if operation succeeded, false otherwise
 */
export async function retryUntil(
    operation: (attempt: number) => Promise<boolean>,
    maxAttempts: number,
    description: string,
    onRetry?: (attempt: number, lastError?: unknown) => Promise<void>
): Promise<boolean> {
    if (maxAttempts < 1) {
        logger.warn("Wait", `Invalid retry configuration for ${description}: attempts=${maxAttempts}`);
        return false;
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let attemptError: unknown;

        try {
            if (await operation(attempt)) {
                return true;
            }
        } catch (error) {
            attemptError = error;
            lastError = error;
        }

        if (attempt < maxAttempts && onRetry) {
            await onRetry(attempt, attemptError);
        }
    }

    const errorContext = lastError ? `; lastError=${String(lastError)}` : "";
    logger.debug("Wait", `Retries exhausted for ${description} (attempts=${maxAttempts})${errorContext}`);
    return false;
}

/**
 * Runs an async operation with a hard timeout and returns null on timeout.
 *
 * This helper standardizes short per-operation bounds used in flaky UI tree traversal,
 * where callers prefer to continue scanning rather than failing the whole test flow.
 *
 * @param operation - Operation to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Human-readable operation context for timeout diagnostics
 * @returns Promise<T | null> - Operation result, or null when timed out
 */
export async function runWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number = 2500,
    operationName: string = "operation"
): Promise<T | null> {
    const timeoutSentinel = Symbol("runWithTimeoutTimeout");
    let timeoutHandle: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<typeof timeoutSentinel>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(timeoutSentinel), timeoutMs);
    });

    try {
        const result = await Promise.race<T | typeof timeoutSentinel>([operation(), timeoutPromise]);
        if (result === timeoutSentinel) {
            logger.debug("Wait", `Timeout in ${operationName} (timeout=${timeoutMs}ms)`);
            return null;
        }
        return result;
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}

/**
 * Waits for a tooltip to appear after hovering over an element.
 * Searches multiple tooltip selectors used by VS Code.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait
 * @param contextDescription - Operation context used in timeout diagnostics
 * @returns Promise<string | null> - Tooltip text if found, null otherwise
 */
export async function waitForTooltip(
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM,
    contextDescription: string = "tooltip content"
): Promise<string | null> {
    const tooltipSelectors = [
        ".monaco-hover-content",
        ".hover-contents",
        ".monaco-hover",
        "[class*='tooltip']",
        ".hover-row",
        ".custom-hover"
    ];

    let tooltipText: string | null = null;

    await waitForCondition(
        driver,
        async () => {
            for (const selector of tooltipSelectors) {
                try {
                    const tooltips = await driver.findElements(By.css(selector));
                    for (const tooltip of tooltips) {
                        if (await tooltip.isDisplayed()) {
                            const text = await tooltip.getText();
                            if (text && text.trim().length > 0) {
                                tooltipText = text;
                                return true;
                            }
                        }
                    }
                } catch {
                    // Continue trying other selectors
                }
            }
            return false;
        },
        timeout,
        100,
        `${contextDescription} to appear via hover`
    );

    return tooltipText;
}

/**
 * Waits for the VS Code Testing View to be fully loaded.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait
 * @returns Promise<boolean> - True if Testing View is ready
 */
export async function waitForTestingViewReady(
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM,
    contextDescription: string = "Testing View readiness"
): Promise<boolean> {
    return waitForCondition(
        driver,
        async () => {
            const sideBar = new SideBarView();
            const content = sideBar.getContent();
            const sections = await content.getSections();

            for (const section of sections) {
                const title = await section.getTitle();
                if (title.toLowerCase().includes("test")) {
                    return true;
                }
            }
            return false;
        },
        timeout,
        200,
        `${contextDescription} (sidebar section title contains "test")`
    );
}

/**
 * Waits for terminal output to contain expected text.
 *
 * @param driver - The WebDriver instance
 * @param expectedText - Text to look for in terminal output
 * @param timeout - Maximum time to wait
 * @returns Promise<boolean> - True if expected text was found
 */
export async function waitForTerminalOutput(
    driver: WebDriver,
    expectedText: string,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    const expectedTextSnippet = createWaitTextSnippet(expectedText);

    return waitForCondition(
        driver,
        async () => {
            const terminalContent = await driver.findElements(By.css(".terminal-wrapper .xterm-rows, .xterm-screen"));
            for (const content of terminalContent) {
                try {
                    const text = await content.getText();
                    if (text.includes(expectedText)) {
                        return true;
                    }
                } catch {
                    // Continue checking other terminal elements
                }
            }
            return false;
        },
        timeout,
        500,
        `terminal output to contain "${expectedTextSnippet}"`
    );
}

/**
 * Waits for the sidebar tree view to refresh and have visible items.
 *
 * @param driver - The WebDriver instance
 * @param _section - The tree section to monitor (currently unused)
 * @param timeout - Maximum time to wait
 * @returns Promise<boolean> - True if tree has refreshed with items
 */
export async function waitForTreeRefresh(
    driver: WebDriver,
    section: TreeSectionLike | null | undefined,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    let sectionContext = "any sidebar section";
    if (section?.getTitle) {
        try {
            const sectionTitle = await section.getTitle();
            if (sectionTitle) {
                sectionContext = `section '${sectionTitle}'`;
            }
        } catch {
            // Keep generic context when title cannot be resolved.
        }
    }

    return waitForCondition(
        driver,
        async () => {
            try {
                if (section) {
                    const sectionItems = await section.getVisibleItems();
                    return sectionItems.length > 0;
                }

                const sideBar = new SideBarView();
                const content = sideBar.getContent();
                const sections = await content.getSections();
                for (const sec of sections) {
                    const items = await sec.getVisibleItems();
                    if (items.length > 0) {
                        return true;
                    }
                }
                return false;
            } catch {
                return false;
            }
        },
        timeout,
        200,
        `tree to refresh in ${sectionContext}`
    );
}

/**
 * Waits for a VS Code notification containing specific text.
 *
 * @param driver - The WebDriver instance
 * @param textToMatch - Partial text to match in the notification
 * @param timeout - Maximum time to wait (default: 60000ms for long operations)
 * @returns Promise<boolean> - True if notification appeared, false if timeout
 */
export async function waitForNotification(
    driver: WebDriver,
    textToMatch: string,
    timeout: number = 60000
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        logger.trace("Notification", `Waiting for notification containing: "${textToMatch}"...`);

        return await waitForCondition(
            driver,
            async () => {
                try {
                    // Look for notification toasts and center notifications
                    const notificationContainers = await driver.findElements(
                        By.css(
                            ".notifications-toasts, .notification-toast, " +
                                ".monaco-dialog, .notification-list-item, " +
                                ".notification-list-item-message, [class*='notification']"
                        )
                    );

                    for (const container of notificationContainers) {
                        try {
                            const text = await container.getText();
                            if (text.includes(textToMatch)) {
                                logger.trace("Notification", `Found notification: "${text.substring(0, 100)}..."`);
                                return true;
                            }
                        } catch {
                            // Element may be stale, continue
                        }
                    }

                    const notificationItems = await driver.findElements(
                        By.css(".notification-list-item, .notifications-list-container .monaco-list-row")
                    );

                    for (const item of notificationItems) {
                        try {
                            const text = await item.getText();
                            if (text.includes(textToMatch)) {
                                logger.trace(
                                    "Notification",
                                    `Found notification in center: "${text.substring(0, 100)}..."`
                                );
                                return true;
                            }
                        } catch {
                            // Element may be stale, continue
                        }
                    }

                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            200,
            `notification containing "${textToMatch}"`
        );
    } catch (error) {
        logger.debug("Notification", `Notification wait failed before polling started: ${error}`);
        return false;
    }
}

/**
 * Waits for tree items to load in a tree section.
 *
 * @param section - The tree section to wait for
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait (default: UITimeouts.LONG)
 * @returns Promise<boolean> - True if items loaded, false if timeout
 */
export async function waitForTreeItems(
    section: TreeSectionLike,
    driver: WebDriver,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    let sectionContext = "tree section";
    if (section.getTitle) {
        try {
            const sectionTitle = await section.getTitle();
            if (sectionTitle) {
                sectionContext = `tree section '${sectionTitle}'`;
            }
        } catch {
            // Keep generic context when title cannot be resolved.
        }
    }

    return waitForCondition(
        driver,
        async () => {
            try {
                const items = await section.getVisibleItems();
                return items.length > 0;
            } catch {
                return false;
            }
        },
        timeout,
        200,
        `items to load in ${sectionContext}`
    );
}

/**
 * Applies slow motion delay if enabled in configuration.
 * This should be called after visible UI actions to allow human observation.
 * Only delays when slow motion mode is enabled via UI_TEST_SLOW_MOTION environment variable.
 *
 * This is an intentional allowlisted fixed delay: it serves demonstrability/debuggability,
 * not synchronization with product state.
 *
 * @param driver - The WebDriver instance
 * @param customDelay - Optional custom delay in milliseconds (overrides config)
 * @returns Promise<void>
 */
export async function applySlowMotion(driver: WebDriver, customDelay?: number): Promise<void> {
    const delay = customDelay !== undefined ? customDelay : getSlowMotionDelay();
    if (delay > 0) {
        await driver.sleep(delay);
    }
}
