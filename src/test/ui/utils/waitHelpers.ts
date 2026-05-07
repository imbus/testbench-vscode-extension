/**
 * @file src/test/ui/utils/waitHelpers.ts
 * @description Wait and timing helpers for UI tests.
 */

import { getSlowMotionDelay } from "../config/testConfig";
import { getTestLogger } from "./testLogger";
import { WebDriver, By, SideBarView } from "vscode-extension-tester";

const logger = getTestLogger();

interface TreeSectionLike {
    getVisibleItems(): Promise<unknown[]>;
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
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        try {
            if (await condition()) {
                return true;
            }
        } catch {
            // Condition threw an error, continue polling
        }
        await driver.sleep(pollInterval);
    }

    logger.debug("Wait", `Timeout waiting for ${description}`);
    return false;
}

/**
 * Waits for a tooltip to appear after hovering over an element.
 * Searches multiple tooltip selectors used by VS Code.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait
 * @returns Promise<string | null> - Tooltip text if found, null otherwise
 */
export async function waitForTooltip(driver: WebDriver, timeout: number = UITimeouts.MEDIUM): Promise<string | null> {
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
        "tooltip to appear"
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
    timeout: number = UITimeouts.MEDIUM
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
        "Testing View to be ready"
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
        `terminal output containing '${expectedText}'`
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
        "tree to refresh"
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

        await driver.wait(
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
            `Waiting for notification containing: "${textToMatch}"`
        );

        return true;
    } catch (error) {
        logger.debug("Notification", `Notification not found within timeout: ${error}`);
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
    try {
        await driver.wait(
            async () => {
                try {
                    const items = await section.getVisibleItems();
                    return items.length > 0;
                } catch {
                    return false;
                }
            },
            timeout,
            "Waiting for tree items to load"
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Applies slow motion delay if enabled in configuration.
 * This should be called after visible UI actions to allow human observation.
 * Only delays when slow motion mode is enabled via UI_TEST_SLOW_MOTION environment variable.
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
