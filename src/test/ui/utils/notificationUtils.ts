/**
 * @file src/test/ui/utils/notificationUtils.ts
 * @description Helpers for interacting with VS Code notifications in UI tests.
 */

import { By, WebDriver, WebElement, Workbench } from "vscode-extension-tester";
import { getTestLogger } from "./testLogger";
import { applySlowMotion, UITimeouts } from "./waitHelpers";
import { escapeXPathLiteral } from "./xpathUtils";

const logger = getTestLogger();

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
        const closeButtonSelector =
            ".notifications-toasts .codicon-notifications-clear, " +
            ".notifications-toasts .codicon-close, " +
            ".notification-toast .action-label.codicon-close, " +
            ".notification-toast .codicon-notifications-clear-all";

        try {
            await driver.wait(
                async () => {
                    const closeButtons = await driver.findElements(By.css(closeButtonSelector));
                    if (closeButtons.length === 0) {
                        return true;
                    }

                    for (const button of closeButtons) {
                        try {
                            if (await button.isDisplayed()) {
                                await button.click();
                                clearedCount++;
                                return false;
                            }
                        } catch {
                            // Ignore stale elements and continue checking others.
                        }
                    }

                    return false;
                },
                UITimeouts.MEDIUM,
                "Waiting for notification toasts to be dismissed"
            );
        } catch {
            logger.debug("Cleanup", "Timed out while dismissing notification toasts");
        }

        let notificationsRemain = false;
        try {
            const remainingButtons = await driver.findElements(By.css(closeButtonSelector));
            notificationsRemain = remainingButtons.length > 0;
        } catch {
            notificationsRemain = false;
        }

        if (clearedCount === 0 || notificationsRemain) {
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
 * Finds a notification button by searching for notification containers and button text.
 * Handles both dialog-style and toast-style notifications.
 *
 * @param driver - The WebDriver instance
 * @param buttonText - The text of the button to find (e.g., "Create", "Cancel")
 * @param notificationText - Optional text that should be present in the notification
 * @param timeout - Maximum time to wait for notification (default: 10000ms)
 * @returns Promise<WebElement | null> - The found button element or null if not found
 */
export async function findNotificationButton(
    driver: WebDriver,
    buttonText: string,
    notificationText?: string,
    timeout: number = UITimeouts.LONG
): Promise<WebElement | null> {
    try {
        await driver.switchTo().defaultContent();
        const escapedButtonText = escapeXPathLiteral(buttonText);

        const button = await driver.wait(
            async () => {
                try {
                    const notificationContainers = await driver.findElements(
                        By.css(
                            ".monaco-dialog, .monaco-dialog-box, .monaco-list-row, .notification-toast, .notifications-toasts, [role='dialog']"
                        )
                    );

                    if (notificationText) {
                        for (const container of notificationContainers) {
                            try {
                                const text = await container.getText();
                                if (text.includes(notificationText)) {
                                    try {
                                        const btn = await container.findElement(
                                            By.xpath(
                                                `.//button[normalize-space(text())=${escapedButtonText}] | .//a[contains(@class, 'monaco-button') and normalize-space(text())=${escapedButtonText}]`
                                            )
                                        );
                                        if (btn) {
                                            return btn;
                                        }
                                    } catch {
                                        // Continue searching
                                    }
                                }
                            } catch {
                                // Continue searching
                            }
                        }
                    }

                    const buttons = await driver.findElements(
                        By.xpath(
                            `//button[normalize-space(text())=${escapedButtonText}] | //a[contains(@class, 'monaco-button') and normalize-space(text())=${escapedButtonText}]`
                        )
                    );

                    for (const btn of buttons) {
                        try {
                            const isDisplayed = await btn.isDisplayed();
                            if (isDisplayed) {
                                return btn;
                            }
                        } catch {
                            // Continue searching
                        }
                    }

                    return null;
                } catch {
                    return null;
                }
            },
            timeout,
            `Waiting for notification with button: ${buttonText}`
        );

        return button;
    } catch (error) {
        logger.error("Notification", "Error finding notification button", error);
        return null;
    }
}

/**
 * Clicks a button in a notification and waits for the action to complete.
 *
 * @param driver - The WebDriver instance
 * @param buttonText - The text of the button to click
 * @param notificationText - Optional text that should be present in the notification
 * @param timeout - Maximum time to wait for notification (default: 10000ms)
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function clickNotificationButton(
    driver: WebDriver,
    buttonText: string,
    notificationText?: string,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    try {
        const button = await findNotificationButton(driver, buttonText, notificationText, timeout);

        if (!button) {
            logger.trace("Notification", `Button "${buttonText}" not found in notification`);
            return false;
        }

        logger.trace("Notification", `Found notification button "${buttonText}", clicking...`);
        await button.click();
        await applySlowMotion(driver);

        await driver.wait(
            async () => {
                const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
                return modalBlocks.length === 0;
            },
            UITimeouts.MEDIUM,
            "Waiting for notification to close"
        );

        return true;
    } catch (error) {
        logger.error("Notification", "Error clicking notification button", error);
        return false;
    }
}
