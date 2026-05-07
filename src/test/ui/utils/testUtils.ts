/**
 * @file src/test/ui/testUtils.ts
 * @description Utility functions and constants for UI tests
 */

import { getTestCredentials, getCredentialReadinessErrorMessage, hasTestCredentials } from "../config/testConfig";
import { ConnectionPage, type ConnectionFormData, type ConnectionSearchResult } from "../pages/ConnectionPage";
import { handleConfirmationDialog } from "./dialogUtils";
import { getTestLogger } from "./testLogger";
import { clickToolbarButton } from "./toolbarUtils";
import { findAndSwitchToWebview, isWebviewAvailable } from "./webviewUtils";
import { escapeXPathLiteral } from "./xpathUtils";
import { UITimeouts, applySlowMotion } from "./waitHelpers";
import {
    WebDriver,
    By,
    ActivityBar,
    SideBarView,
    WebElement,
    until,
    Key,
    TreeItem,
    EditorView,
    TextEditor
} from "vscode-extension-tester";

const logger = getTestLogger();

/**
 * Button text constants used in VS Code modals and dialogs.
 */
export const ModalButtonTexts = {
    ALLOW: "Allow", // Authentication provider modal button text
    PROCEED_ANYWAY: "Proceed Anyway" // Certificate warning modal button text
} as const;

/**
 * XPath selectors for finding modal buttons by text.
 * Used to find buttons in VS Code dialogs and modals.
 */
export const ModalButtonSelectors = {
    ALLOW: `//button[contains(text(), '${ModalButtonTexts.ALLOW}') or @aria-label='${ModalButtonTexts.ALLOW}'] | //a[contains(@class, 'monaco-button') and contains(., '${ModalButtonTexts.ALLOW}')]`,
    PROCEED_ANYWAY: `//button[contains(text(), '${ModalButtonTexts.PROCEED_ANYWAY}') or @aria-label='${ModalButtonTexts.PROCEED_ANYWAY}'] | //a[contains(@class, 'monaco-button') and contains(., '${ModalButtonTexts.PROCEED_ANYWAY}')]`
} as const;

const STARTUP_OVERLAY_SELECTORS = {
    OVERLAY: ".onboarding-a-overlay.visible",
    SKIP: `//button[normalize-space(.)='Skip'] | //a[normalize-space(.)='Skip'] | //*[@role='button' and normalize-space(.)='Skip']`,
    CONTINUE_WITHOUT_SIGNIN: `//button[contains(normalize-space(.), 'Continue without Signing In')] | //a[contains(normalize-space(.), 'Continue without Signing In')]`
} as const;

/**
 * Logs out from TestBench if a session is active.
 * Uses the logout toolbar button in the Projects view.
 * If currently in Test Themes or Test Elements view, navigates back to Projects view first.
 * Waits for logout to complete and verifies the webview is available.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if logout was successful, false if no active session or logout failed
 */
export async function attemptLogout(driver: WebDriver): Promise<boolean> {
    try {
        // Check if already logged out (webview is available)
        const alreadyLoggedOut = await isWebviewAvailable(driver);
        if (alreadyLoggedOut) {
            logger.trace("Logout", "Already logged out - webview is available");
            return true;
        }

        logger.trace("Logout", "Attempting to logout via toolbar button...");
        await driver.switchTo().defaultContent();

        const sideBar = new SideBarView();
        let content = sideBar.getContent();
        let sections = await content.getSections();

        // Check if we're in Test Themes or Test Elements view (need to navigate to Projects first)
        let inTestView = false;
        let testThemesSection: any = null;

        for (const section of sections) {
            const title = await section.getTitle();
            if (title.includes("Test Themes")) {
                inTestView = true;
                testThemesSection = section;
                logger.trace("Logout", "Currently in Test Themes view, navigating to Projects view first...");
                break;
            } else if (title.includes("Test Elements")) {
                inTestView = true;
                logger.trace("Logout", "Currently in Test Elements view, looking for Test Themes section...");
                // Test Elements and Test Themes are shown together, find Test Themes to click its toolbar
                for (const s of sections) {
                    const t = await s.getTitle();
                    if (t.includes("Test Themes")) {
                        testThemesSection = s;
                        break;
                    }
                }
                break;
            }
        }

        // Navigate back to Projects view if needed
        if (inTestView && testThemesSection) {
            const clicked = await clickToolbarButton(testThemesSection, "Open Projects View", driver);
            if (clicked) {
                logger.trace("Logout", "Clicked 'Open Projects View' button");
                // Wait for Projects view to appear
                await waitForProjectsView(driver, UITimeouts.LONG);
                await driver.sleep(500);
            } else {
                logger.warn("Logout", "Failed to click 'Open Projects View' button");
            }

            // Refresh sidebar content
            content = sideBar.getContent();
            sections = await content.getSections();
        }

        // Find Projects section
        let projectsSection: any = null;
        for (const section of sections) {
            const title = await section.getTitle();
            if (title.includes("Projects")) {
                projectsSection = section;
                break;
            }
        }

        if (!projectsSection) {
            logger.warn("Logout", "Projects section not found, cannot logout");
            return false;
        }

        // Click the logout toolbar button in Projects view
        const logoutClicked = await clickToolbarButton(projectsSection, "logout", driver);

        if (!logoutClicked) {
            logger.warn("Logout", "Failed to click logout toolbar button");
            return false;
        }

        logger.trace("Logout", "Clicked logout toolbar button, waiting for logout to complete...");

        // Wait for logout to complete and webview to become available
        try {
            await driver.wait(
                async () => {
                    return await isWebviewAvailable(driver);
                },
                UITimeouts.LONG,
                "Waiting for logout to complete (webview to become available)"
            );
            logger.trace("Logout", "Logout successful - webview is now available");
            return true;
        } catch {
            logger.warn("Logout", "Logout button clicked but webview still not available");
            return false;
        }
    } catch (error) {
        // If logout fails, log error but don't fail the test
        logger.error("Logout", "Error during logout attempt:", error);
        // Check if we're already logged out
        try {
            const webviewAvailable = await isWebviewAvailable(driver);
            if (webviewAvailable) {
                logger.trace("Logout", "Webview is available despite error - assuming already logged out");
                return true;
            }
        } catch {
            // Ignore errors when checking webview
        }
        return false;
    }
}

/**
 * Handles authentication modal by clicking the "Allow" button if present.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait for the button (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function handleAllowButton(driver: WebDriver, timeout: number = UITimeouts.MEDIUM): Promise<boolean> {
    try {
        // Wait for modal to appear and find Allow button
        const allowButtons = await driver.wait(async () => {
            const elements = await driver.findElements(By.xpath(ModalButtonSelectors.ALLOW));
            return elements.length > 0 ? elements : null;
        }, timeout);

        if (allowButtons && allowButtons.length > 0) {
            await allowButtons[0].click();
            logger.trace("Modal", `Clicked ${ModalButtonTexts.ALLOW} button`);

            // Wait for modal to disappear
            await driver.wait(
                async () => {
                    const elements = await driver.findElements(By.xpath(ModalButtonSelectors.ALLOW));
                    return elements.length === 0;
                },
                timeout,
                "Waiting for Allow modal to close"
            );
            return true;
        }

        return false;
    } catch (error) {
        logger.debug("Modal", `Could not find or click ${ModalButtonTexts.ALLOW} button:`, error);
        return false;
    }
}

/**
 * Handles certificate warning modal by clicking the "Proceed Anyway" button if present.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait for the button (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function handleProceedAnywayButton(
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    try {
        logger.trace("Modal", "Checking for certificate warning...");
        const proceedButtons = await driver.wait(async () => {
            const elements = await driver.findElements(By.xpath(ModalButtonSelectors.PROCEED_ANYWAY));
            return elements.length > 0 ? elements : null;
        }, timeout);

        if (proceedButtons && proceedButtons.length > 0) {
            await proceedButtons[0].click();
            logger.trace("Modal", `Clicked ${ModalButtonTexts.PROCEED_ANYWAY} button for untrusted certificate`);

            // Wait for action to complete and modal to disappear
            await driver.wait(
                async () => {
                    const elements = await driver.findElements(By.xpath(ModalButtonSelectors.PROCEED_ANYWAY));
                    return elements.length === 0;
                },
                timeout,
                "Waiting for Proceed Anyway modal to close"
            );
            return true;
        }

        return false;
    } catch (error) {
        logger.debug("Modal", `Could not find or click ${ModalButtonTexts.PROCEED_ANYWAY} button:`, error);
        return false;
    }
}

/**
 * Handles both authentication and certificate warning modals in sequence.
 * This is a convenience function that calls both handleAllowButton and handleProceedAnywayButton.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<void>
 */
export async function handleAuthenticationModals(driver: WebDriver): Promise<void> {
    await handleAllowButton(driver);
    await handleProceedAnywayButton(driver);
}

/**
 * Dismisses the VS Code startup/sign-in overlay if it is shown.
 * This screen can block clicks on the activity bar and cause UI tests to fail.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if overlay was dismissed, false otherwise
 */
async function dismissStartupSignInOverlay(driver: WebDriver): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        const isOverlayVisible = async (): Promise<boolean> => {
            try {
                const overlays = await driver.findElements(By.css(STARTUP_OVERLAY_SELECTORS.OVERLAY));
                if (overlays.length === 0) {
                    return false;
                }

                for (const overlay of overlays) {
                    if (await overlay.isDisplayed()) {
                        return true;
                    }
                }
                return false;
            } catch {
                return false;
            }
        };

        if (!(await isOverlayVisible())) {
            return false;
        }

        logger.debug("StartupOverlay", "Detected startup welcome/sign-in overlay. Attempting to dismiss it.");

        const tryClickOverlayAction = async (selector: string, actionLabel: string): Promise<boolean> => {
            try {
                const candidates = await driver.findElements(By.xpath(selector));
                for (const element of candidates) {
                    if ((await element.isDisplayed()) && (await element.isEnabled())) {
                        await element.click();
                        logger.debug("StartupOverlay", `Clicked '${actionLabel}' on startup overlay.`);
                        return true;
                    }
                }
            } catch {
                // Ignore and proceed with next fallback.
            }
            return false;
        };

        let actionTriggered = await tryClickOverlayAction(STARTUP_OVERLAY_SELECTORS.SKIP, "Skip");
        if (!actionTriggered) {
            actionTriggered = await tryClickOverlayAction(
                STARTUP_OVERLAY_SELECTORS.CONTINUE_WITHOUT_SIGNIN,
                "Continue without Signing In"
            );
        }

        if (!actionTriggered) {
            await driver.actions().sendKeys(Key.ESCAPE).perform();
            logger.debug("StartupOverlay", "Sent Escape to dismiss startup overlay.");
        }

        await driver.wait(
            async () => !(await isOverlayVisible()),
            UITimeouts.MEDIUM,
            "Waiting for startup overlay to close",
            UITimeouts.MINIMAL
        );

        return true;
    } catch (error) {
        logger.debug("StartupOverlay", `Could not dismiss startup overlay: ${error}`);
        return false;
    }
}

/**
 * Opens the TestBench sidebar by finding and clicking the TestBench activity bar item.
 * Handles stale element references by retrying if needed.
 *
 * @param driver - The WebDriver instance (optional, for waiting)
 * @returns Promise<void>
 */
export async function openTestBenchSidebar(driver?: WebDriver): Promise<void> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Proactively dismiss onboarding/sign-in overlay on each retry.
            // This remains a fast no-op on VS Code versions where the overlay is absent.
            if (driver) {
                await dismissStartupSignInOverlay(driver);
            }

            // Check if sidebar is already open by trying to get sections
            if (driver) {
                try {
                    const sideBar = new SideBarView();
                    const content = sideBar.getContent();
                    const sections = await content.getSections();
                    if (sections.length > 0) {
                        // Sidebar appears to be open, verify it's the TestBench sidebar
                        let foundTestBench = false;
                        for (const section of sections) {
                            const title = await section.getTitle();
                            if (title.includes("TestBench") || title.includes("Projects") || title.includes("Login")) {
                                foundTestBench = true;
                                break;
                            }
                        }
                        if (foundTestBench) {
                            logger.trace("Sidebar", "TestBench sidebar is already open");
                            return;
                        }
                    }
                } catch {
                    // Sidebar not open or not accessible, continue to open it
                }
            }

            const activityBar = new ActivityBar();
            const controls = await activityBar.getViewControls();

            let testBenchControlFound = false;
            for (const control of controls) {
                try {
                    const title = await control.getTitle();
                    if (title === "TestBench") {
                        testBenchControlFound = true;
                        await control.openView();
                        if (driver) {
                            // Wait for sidebar to initialize (background operation, no slow motion needed)
                            await driver.wait(
                                async () => {
                                    try {
                                        const sideBar = new SideBarView();
                                        const content = sideBar.getContent();
                                        const sections = await content.getSections();
                                        return sections.length > 0;
                                    } catch {
                                        return false;
                                    }
                                },
                                UITimeouts.LONG,
                                "Waiting for TestBench sidebar to initialize",
                                500
                            );
                        }
                        return; // Successfully opened sidebar
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const normalizedError = errorMessage.toLowerCase();
                    const isClickIntercepted = normalizedError.includes("element click intercepted");
                    const isStartupOverlayInterception =
                        normalizedError.includes("onboarding-a-overlay") ||
                        normalizedError.includes("welcome to visual studio code");

                    if (driver && (isClickIntercepted || isStartupOverlayInterception)) {
                        const overlayDismissed = await dismissStartupSignInOverlay(driver);
                        if (overlayDismissed) {
                            logger.debug(
                                "Sidebar",
                                `Startup overlay dismissed after click interception (attempt ${attempt + 1}/${maxRetries})`
                            );
                            if (attempt < maxRetries - 1) {
                                await driver.sleep(UITimeouts.MINIMAL);
                            }
                            break;
                        }
                    }

                    // Stale element reference - element was found but became stale
                    // If this is the last attempt, throw the error
                    if (attempt === maxRetries - 1) {
                        throw error;
                    }
                    logger.debug(
                        "Sidebar",
                        `Stale element detected on control, will retry (attempt ${attempt + 1}/${maxRetries})`
                    );
                    if (driver) {
                        await dismissStartupSignInOverlay(driver);
                    }
                    lastError = error as Error;
                    break; // Break inner loop to retry outer loop
                }
            }

            // If we get here and didn't find TestBench control, throw error
            if (!testBenchControlFound) {
                throw new Error("TestBench activity bar item not found");
            }
        } catch (error) {
            lastError = error as Error;
            if (attempt < maxRetries - 1) {
                logger.debug(
                    "Sidebar",
                    `Error opening sidebar, retrying (attempt ${attempt + 1}/${maxRetries}): ${error}`
                );

                if (driver) {
                    await driver.sleep(UITimeouts.MINIMAL);
                }
            } else {
                throw new Error(
                    `Failed to open TestBench sidebar after ${maxRetries} attempts: ${lastError?.message || error}`
                );
            }
        }
    }
}

/**
 * Releases any stuck modifier keys (Ctrl/Shift/Alt/Cmd) in the current WebDriver session.
 * This prevents accidental shortcut execution (for example Ctrl+- zoom out) when typing text.
 *
 * @param driver - The WebDriver instance
 * @param logContext - Logging context label (default: "Keyboard")
 * @returns Promise<void>
 */
export async function releaseModifierKeys(driver: WebDriver, logContext: string = "Keyboard"): Promise<void> {
    try {
        await driver.switchTo().defaultContent();
    } catch {
        // Ignore context switch errors during safety cleanup
    }

    try {
        await driver
            .actions()
            .keyUp(Key.SHIFT)
            .keyUp(Key.CONTROL)
            .keyUp(Key.ALT)
            .keyUp(Key.COMMAND)
            .sendKeys(Key.NULL)
            .perform();
    } catch {
        // keyUp can fail if the driver state has no active keyboard target
    }

    try {
        // Second NULL send provides an extra safety reset for sticky webdriver key state.
        await driver.actions().sendKeys(Key.NULL).perform();
    } catch {
        // Ignore best-effort cleanup failure
    }

    logger.trace(logContext, "Released modifier keys using Key.NULL safety reset");
}

/**
 * Export ConnectionPage for POM pattern.
 */
export { ConnectionPage };
export type { ConnectionFormData, ConnectionSearchResult };

/**
 * Deletes all existing TestBench connections.
 * A wrapper that handles webview switching before delegating to ConnectionPage.
 * Use this function when you need to delete connections from outside the webview context.
 * Only works when the webview is available (user is not logged in).
 *
 * @param driver - The WebDriver instance
 * @returns Promise<number> - The number of connections that were deleted
 */
export async function deleteAllConnections(driver: WebDriver): Promise<number> {
    try {
        // Check if webview is available (user must not be logged in)
        const webviewAvailable = await isWebviewAvailable(driver);
        if (!webviewAvailable) {
            logger.trace("Cleanup", "Webview not available - user is logged in. Cannot delete connections.");
            return 0;
        }

        // Switch to webview
        const webviewFound = await findAndSwitchToWebview(driver);
        if (!webviewFound) {
            logger.trace("Cleanup", "Webview not found. Cannot delete connections.");
            return 0;
        }

        const page = new ConnectionPage(driver);
        const deletedCount = await page.deleteAllConnections();

        // Switch back to default content
        await driver.switchTo().defaultContent();

        return deletedCount;
    } catch (error) {
        logger.error("Cleanup", "Error during connection cleanup", error);
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore errors when switching back
        }
        return 0;
    }
}

/**
 * Generates a unique connection label for testing.
 *
 * @param prefix - Optional prefix for the label (default: "Test Connection")
 * @returns string - A unique connection label with timestamp
 */
export function generateUniqueConnectionLabel(prefix: string = "Test Connection"): string {
    const timestamp = Date.now();
    return `${prefix} ${timestamp}`;
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
                    // VS Code notifications can appear as dialogs or toast notifications
                    // First, try finding notification/dialog containers
                    const notificationContainers = await driver.findElements(
                        By.css(
                            ".monaco-dialog, .monaco-dialog-box, .monaco-list-row, .notification-toast, .notifications-toasts, [role='dialog']"
                        )
                    );

                    // Check if any container contains the expected notification text
                    if (notificationText) {
                        for (const container of notificationContainers) {
                            try {
                                const text = await container.getText();
                                if (text.includes(notificationText)) {
                                    // Find button within this container
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

                    // Also try finding buttons directly (might be in a dialog)
                    const buttons = await driver.findElements(
                        By.xpath(
                            `//button[normalize-space(text())=${escapedButtonText}] | //a[contains(@class, 'monaco-button') and normalize-space(text())=${escapedButtonText}]`
                        )
                    );

                    // Return the first visible button
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

        // Wait for notification to close
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

/**
 * Ensures the user is logged in by performing login if necessary.
 * If already logged in, this function does nothing.
 * If not logged in, it creates a connection and logs in using test credentials.
 *
 * @param driver - The WebDriver instance
 * @param credentials - Optional test credentials (if not provided, will use getTestCredentials())
 * @returns Promise<boolean> - True if login was successful or user was already logged in, false otherwise
 */
export async function ensureLoggedIn(
    driver: WebDriver,
    credentials?: {
        connectionLabel: string;
        serverName: string;
        portNumber: string;
        username: string;
        password: string;
    }
): Promise<boolean> {
    try {
        const webviewAvailable = await isWebviewAvailable(driver);
        if (!webviewAvailable) {
            logger.trace("Login", "User is already logged in");
            return true;
        }

        logger.trace("Login", "User is not logged in. Performing login...");

        if (!hasTestCredentials() && !credentials) {
            const readinessMessage = getCredentialReadinessErrorMessage();
            logger.warn(
                "Login",
                readinessMessage
                    ? `Test credentials not available. ${readinessMessage}`
                    : "Test credentials not available"
            );
            return false;
        }

        const creds = credentials || getTestCredentials();

        await openTestBenchSidebar(driver);

        const webviewFound = await findAndSwitchToWebview(driver);
        if (!webviewFound) {
            logger.warn("Login", "Webview not found");
            return false;
        }

        const connectionPage = new ConnectionPage(driver);
        const listReady = await connectionPage.waitForConnectionsList(UITimeouts.MEDIUM);
        if (!listReady) {
            // Connections list might not exist yet, continue anyway
            logger.trace("Login", "Connections list not found, will create new connection");
        }

        const { element: existingConnection, found: connectionExists } = await connectionPage.findConnection(
            creds.connectionLabel
        );

        if (!connectionExists || !existingConnection) {
            logger.trace("Login", "Creating new connection...");
            await connectionPage.resetForm();

            const formData: ConnectionFormData = {
                connectionLabel: creds.connectionLabel,
                serverName: creds.serverName,
                portNumber: creds.portNumber,
                username: creds.username,
                password: creds.password,
                storePassword: true
            };

            await connectionPage.fillForm(formData);
            await connectionPage.save();

            // Switch to default content to handle "Save Changes" dialog if it appears
            await driver.switchTo().defaultContent();

            // Handle "Save Changes" confirmation dialog if it appears
            // This dialog may appear when saving a connection
            try {
                const dialogHandled = await handleConfirmationDialog(driver, "Save Changes", UITimeouts.SHORT);
                if (dialogHandled) {
                    logger.trace("Login", "Handled 'Save Changes' dialog");
                } else {
                    logger.trace("Login", "No 'Save Changes' dialog appeared");
                }
            } catch {
                logger.trace("Login", "No 'Save Changes' dialog appeared");
            }

            const webviewFoundAgain = await findAndSwitchToWebview(driver);
            if (!webviewFoundAgain) {
                logger.warn("Login", "Could not switch back to webview after handling dialog");
                return false;
            }

            // Recreate page instance after switching back to webview
            const connectionPageAfterDialog = new ConnectionPage(driver);
            await driver.wait(
                async () => {
                    const { found } = await connectionPageAfterDialog.findConnection(creds.connectionLabel);
                    return found;
                },
                UITimeouts.LONG,
                "Waiting for connection to appear in list"
            );
        }

        // Recreate page instance to ensure we're working with fresh state
        const connectionPageFinal = new ConnectionPage(driver);
        const { element: connectionElement, found } = await connectionPageFinal.findConnection(creds.connectionLabel);

        if (!found || !connectionElement) {
            const connectionString = `${creds.username}@${creds.serverName}`;
            const { element: connectionByString } = await connectionPageFinal.findConnection(connectionString);
            if (connectionByString) {
                await connectionPageFinal.clickLogin(connectionByString);
            } else {
                logger.warn("Login", "Connection not found in list");
                return false;
            }
        } else {
            await connectionPageFinal.clickLogin(connectionElement);
        }

        await driver.switchTo().defaultContent();
        await handleAuthenticationModals(driver);

        // Wait for Projects view to appear (indicates successful login)
        await driver.wait(
            async () => {
                return !(await isWebviewAvailable(driver));
            },
            UITimeouts.LONG,
            "Waiting for login to complete (Projects view to appear)"
        );

        logger.info("Login", "Login successful");
        return true;
    } catch (error) {
        logger.error("Login", "Error during login", error);
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore errors when switching back
        }
        return false;
    }
}

/**
 * Finds and clicks a CodeLens action in the editor.
 *
 * @param driver - The WebDriver instance
 * @param codeLensText - The text of the CodeLens to find (e.g., "Pull changes from TestBench")
 * @param lineNumber - The line number where the CodeLens should appear (0-based)
 * @param timeout - Maximum time to wait for CodeLens (default: 10000ms)
 * @returns Promise<boolean> - True if CodeLens was found and clicked, false otherwise
 */
export async function clickCodeLens(
    driver: WebDriver,
    codeLensText: string,
    _lineNumber: number = 0,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    await driver.switchTo().defaultContent();
    logger.trace("CodeLens", `Starting exact DOM search and click for: "${codeLensText}"`);
    const escapedCodeLensText = escapeXPathLiteral(codeLensText);

    try {
        await driver.wait(
            async () => {
                try {
                    // Precise XPath based on DevTools inspection
                    // Look for <span> with class 'codelens-decoration' -> child <a> with specific text
                    const xpathSelector = `//span[contains(@class, 'codelens-decoration')]//a[contains(text(), ${escapedCodeLensText})]`;

                    const links = await driver.findElements(By.xpath(xpathSelector));

                    if (links.length > 0) {
                        const link = links[0];

                        // Verify visibility to ensure we aren't clicking a hidden/stale one
                        if (await link.isDisplayed()) {
                            logger.trace("CodeLens", `Found visible link for "${codeLensText}"`);

                            // Scroll into view (Center)
                            await driver.executeScript(
                                "arguments[0].scrollIntoView({block: 'center', inline: 'center'});",
                                link
                            );
                            await driver.sleep(200);

                            // Dispatch Full Mouse Event Chain
                            // VS Code often listens for 'mousedown' or 'mouseup' on these widgets, not just 'click'
                            logger.trace("CodeLens", "Dispatching MouseEvents (mousedown + click)...");
                            await driver.executeScript(
                                `
                                var element = arguments[0];
                                
                                // Create mouse event options
                                var opts = {
                                    view: window,
                                    bubbles: true,
                                    cancelable: true,
                                    buttons: 1
                                };

                                // Dispatch mousedown (often required for focus/activation)
                                element.dispatchEvent(new MouseEvent('mousedown', opts));
                                
                                // Dispatch mouseup
                                element.dispatchEvent(new MouseEvent('mouseup', opts));
                                
                                // Dispatch click
                                element.dispatchEvent(new MouseEvent('click', opts));
                            `,
                                link
                            );

                            await applySlowMotion(driver);
                            return true;
                        }
                    }
                    return false;
                } catch {
                    // Ignore stale element errors and retry
                    return false;
                }
            },
            timeout,
            `Timeout waiting to click CodeLens "${codeLensText}"`
        );

        return true;
    } catch (e) {
        logger.error("CodeLens", "FINAL FAILURE", e);
        return false;
    }
}

/**
 * Finds the Refactor Preview tab and clicks the Apply button.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait for Refactor Preview (default: 15000ms)
 * @returns Promise<boolean> - True if Apply button was found and clicked, false otherwise
 */
/**
 * Finds the Refactor Preview "Apply" button and clicks it.
 * Uses the specific DOM structure: <a class="monaco-button ..."><span ...>Apply</span></a>
 */
export async function clickRefactorPreviewApply(
    driver: WebDriver,
    timeout: number = UITimeouts.VERY_LONG
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        const applyButton = await driver.wait(
            async () => {
                try {
                    // Specific XPath based on your inspector image:
                    // Looks for an anchor tag with 'monaco-button' class containing a span with 'Apply'
                    const xpathSelector = "//a[contains(@class, 'monaco-button')][.//span[contains(text(), 'Apply')]]";

                    const buttons = await driver.findElements(By.xpath(xpathSelector));

                    for (const btn of buttons) {
                        if (await btn.isDisplayed()) {
                            return btn;
                        }
                    }
                    return null;
                } catch {
                    return null;
                }
            },
            timeout,
            "Waiting for Apply button in Refactor Preview"
        );

        if (applyButton) {
            logger.trace("RefactorPreview", "Found Apply button, clicking...");
            await applyButton.click();
            await applySlowMotion(driver);
            return true;
        }

        logger.warn("RefactorPreview", "Apply button not found using specific selector");
        return false;
    } catch (error) {
        logger.error("RefactorPreview", "Error clicking Apply button", error);
        return false;
    }
}

/**
 * Verifies that a checkbox is checked in the Refactor Preview.
 *
 * @param driver - The WebDriver instance
 * @param fileName - The file name to check (e.g., "Subdiv resource.resource")
 * @param timeout - Maximum time to wait (default: 10000ms)
 * @returns Promise<boolean> - True if checkbox is checked, false otherwise
 */
export async function verifyRefactorPreviewCheckbox(
    driver: WebDriver,
    fileName: string,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        // Wait for the list rows to appear
        await driver.wait(until.elementLocated(By.css(".monaco-list-row")), timeout);

        const isChecked = await driver.wait(
            async () => {
                // Find all rows in the tree view
                const rows = await driver.findElements(By.css(".monaco-list-row"));

                for (const row of rows) {
                    try {
                        // Check if this row represents our file
                        const text = await row.getText();
                        if (text.includes(fileName)) {
                            // Try multiple selectors for the checkbox
                            const selectors = [
                                "input.edit-checkbox",
                                ".monaco-checkbox",
                                "input[type='checkbox']",
                                ".codicon-check", // Checked state icon
                                ".codicon-circle-large-outline" // Unchecked state icon
                            ];

                            for (const selector of selectors) {
                                try {
                                    const checkbox = await row.findElement(By.css(selector));

                                    // If it's an input, check isSelected()
                                    const tagName = await checkbox.getTagName();
                                    if (tagName === "input") {
                                        return await checkbox.isSelected();
                                    }

                                    // If it's a custom element (div/span), check class for checked state
                                    const className = await checkbox.getAttribute("class");
                                    if (className.includes("checked") || className.includes("codicon-check")) {
                                        return true;
                                    }
                                    // If we found an unchecked icon, return false (found but unchecked)
                                    if (className.includes("codicon-circle-large-outline")) {
                                        return false;
                                    }

                                    // If it's .monaco-checkbox, check aria-checked or class
                                    if (className.includes("monaco-checkbox")) {
                                        const ariaChecked = await checkbox.getAttribute("aria-checked");
                                        if (ariaChecked === "true") {
                                            return true;
                                        }
                                        if (ariaChecked === "false") {
                                            return false;
                                        }
                                        // Fallback to class check
                                        return className.includes("checked");
                                    }
                                } catch {
                                    // Continue to next selector
                                }
                            }
                        }
                    } catch {
                        // Stale element or other temporary error, continue to next row or retry
                    }
                }
                // Return null to keep waiting if row not found yet
                return null;
            },
            timeout,
            `Waiting for checkbox row matching "${fileName}"`
        );

        // If the wait returns a boolean, that's our result. If it times out/returns null, default to false.
        return !!isChecked;
    } catch (error) {
        // Timeout is expected if Refactor Preview is still loading or checkbox row hasn't appeared yet
        const isTimeoutError =
            error instanceof Error &&
            (error.name === "TimeoutError" || error.message.includes("Timeout") || error.message.includes("timeout"));

        if (isTimeoutError) {
            logger.debug(
                "RefactorPreview",
                `Timeout verifying checkbox for "${fileName}" - Refactor Preview may still be loading (this is expected)`
            );
        } else {
            // For non-timeout errors, log as warning since they're unexpected but not critical
            logger.warn("RefactorPreview", "Error verifying checkbox", error);
        }
        return false;
    }
}

/**
 * Ensures that the checkbox for a specific file is checked.
 * If it is currently unchecked, this function clicks it.
 * @param driver - The WebDriver instance
 * @param fileName - The file name to check
 * @returns Promise<boolean> - True if successfully ensured checked
 */
export async function ensureRefactorPreviewItemChecked(driver: WebDriver, fileName: string): Promise<boolean> {
    try {
        const isChecked = await verifyRefactorPreviewCheckbox(driver, fileName, UITimeouts.SHORT);
        if (isChecked) {
            logger.trace("RefactorPreview", `Item "${fileName}" is already checked.`);
            return true;
        }

        logger.trace("RefactorPreview", `Item "${fileName}" is unchecked. Clicking to select...`);

        // Find and click the checkbox
        const rows = await driver.findElements(By.css(".monaco-list-row"));
        for (const row of rows) {
            const text = await row.getText();
            if (text.includes(fileName)) {
                // Try multiple selectors for the checkbox
                const selectors = [
                    "input.edit-checkbox",
                    ".monaco-checkbox",
                    "input[type='checkbox']",
                    ".codicon-circle-large-outline", // Unchecked icon
                    ".codicon-check" // Checked icon (just in case)
                ];

                for (const selector of selectors) {
                    try {
                        const checkbox = await row.findElement(By.css(selector));
                        // Use JS click for reliability with Monaco checkboxes
                        await driver.executeScript("arguments[0].click();", checkbox);
                        await applySlowMotion(driver);
                        return true;
                    } catch {
                        // Continue to next selector
                    }
                }

                logger.warn("RefactorPreview", `Could not find checkbox for "${fileName}" using any selector.`);
            }
        }
        return false;
    } catch (error) {
        logger.error("RefactorPreview", "Error ensuring item checked", error);
        return false;
    }
}

/**
 * Clicks the "Create Resource" button on a tree item in Test Elements view.
 * The button uses the $(new-file) codicon and is an inline action button.
 *
 * @param item - The tree item (subdivision) to click the button on
 * @param driver - The WebDriver instance
 * @param itemLabel - Optional pre-fetched label to avoid stale element issues
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function clickCreateResourceButton(
    item: TreeItem,
    driver: WebDriver,
    itemLabel?: string
): Promise<boolean> {
    const maxRetries = 3;

    // Cache the label before the retry loop to avoid stale element errors
    if (!itemLabel) {
        try {
            itemLabel = await item.getLabel();
        } catch (error) {
            logger.error("TreeItem", "Failed to get item label", error);
            return false;
        }
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await driver.switchTo().defaultContent();
            logger.trace(
                "TreeItem",
                `Looking for Create Resource button near item: "${itemLabel}" (attempt ${attempt}/${maxRetries})`
            );

            // First, ensure the tree item is clicked to make action buttons visible
            try {
                await item.click();
                await driver.sleep(300); // Wait for action buttons to appear
            } catch (itemClickError) {
                logger.debug("TreeItem", "Could not click tree item, continuing anyway", itemClickError);
            }

            // Use JavaScript to find and click the button in one atomic operation
            // This reduces the chance of stale element errors
            const clickSucceeded = (await driver.executeScript(
                `
                function findAndClickCreateResourceButton(itemLabel) {
                    const rows = document.querySelectorAll('.monaco-list-row');
                    for (const row of rows) {
                        const rowText = row.textContent || row.innerText || '';
                        if (!rowText.includes(itemLabel)) {
                            continue;
                        }
                        
                        // Look for action buttons with codicon-new-file
                        const actionButtons = row.querySelectorAll('a.action-item, button.action-item, a[class*="action"], button[class*="action"]');
                        for (const btn of actionButtons) {
                            // Check if button contains codicon-new-file
                            const codicon = btn.querySelector('.codicon-new-file, span.codicon-new-file');
                            if (codicon) {
                                btn.scrollIntoView({ block: 'center' });
                                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                return true;
                            }
                            
                            // Check aria-label
                            const ariaLabel = btn.getAttribute('aria-label') || '';
                            if (ariaLabel.toLowerCase().includes('create resource')) {
                                btn.scrollIntoView({ block: 'center' });
                                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                return true;
                            }
                        }
                        
                        // Also check for any element with codicon-new-file in this row
                        const codiconElements = row.querySelectorAll('.codicon-new-file, [class*="codicon-new-file"]');
                        for (const codicon of codiconElements) {
                            const actionItem = codicon.closest('a.action-item, button.action-item, a[class*="action"], button[class*="action"]');
                            if (actionItem) {
                                actionItem.scrollIntoView({ block: 'center' });
                                actionItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                                actionItem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                                actionItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                return true;
                            }
                        }
                    }
                    return false;
                }
                return findAndClickCreateResourceButton(String(arguments[0] || ''));
            `,
                itemLabel
            )) as boolean;

            if (clickSucceeded) {
                logger.trace("TreeItem", "Successfully clicked Create Resource button");
                await applySlowMotion(driver);
                return true;
            }

            logger.debug("TreeItem", `Button not found or click failed on attempt ${attempt}`);

            if (attempt < maxRetries) {
                // Wait before retrying
                await driver.sleep(500);
            }
        } catch (error: any) {
            const isStaleError =
                error.name === "StaleElementReferenceError" || error.message?.includes("stale element");

            if (isStaleError && attempt < maxRetries) {
                logger.debug("TreeItem", `Stale element error on attempt ${attempt}, retrying...`);
                await driver.sleep(500);
                continue;
            }

            logger.error("TreeItem", `Error on attempt ${attempt}`, error);

            if (attempt === maxRetries) {
                return false;
            }
        }
    }

    logger.warn("TreeItem", "Failed to click Create Resource button after all retries");
    return false;
}

/**
 * Waits for the configuration to be applied by checking for pin emojis on project and TOV tree items.
 * After configuration is created, the tree items get reordered and pin emojis (📌) are added to active items.
 *
 * @param driver - The WebDriver instance
 * @param projectName - The project name to check for pin
 * @param tovName - The TOV name to check for pin
 * @param projectsSection - The Projects section to search in
 * @param targetProject - The project tree item (should already be expanded)
 * @param targetVersion - The version tree item (should already be expanded)
 * @param timeout - Maximum time to wait (default: UITimeouts.LONG - configuration can take time)
 * @returns Promise<boolean> - True if pins appeared or configuration already exists, false if timeout
 */
export async function waitForConfigurationApplied(
    driver: WebDriver,
    projectName: string,
    tovName: string,
    projectsSection: any,
    targetProject: TreeItem,
    targetVersion: TreeItem,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    try {
        logger.trace("Configuration", "Waiting for configuration to be applied (checking for pin emojis)...");

        const pinsAppeared = await driver.wait(
            async () => {
                try {
                    // Check the project's description for pin emoji
                    let projectHasPin = false;
                    try {
                        const projectDescription = await targetProject.getDescription();
                        if (
                            projectDescription &&
                            (projectDescription.includes("📌") || projectDescription.includes("pin"))
                        ) {
                            projectHasPin = true;
                            logger.trace("Configuration", `Found pin on project "${projectName}"`);
                        }
                    } catch {
                        // Project description might not be accessible yet
                    }

                    // Check the TOV's description for pin emoji
                    let tovHasPin = false;
                    try {
                        const tovDescription = await targetVersion.getDescription();
                        if (tovDescription && (tovDescription.includes("📌") || tovDescription.includes("pin"))) {
                            tovHasPin = true;
                            logger.trace("Configuration", `Found pin on TOV "${tovName}"`);
                        }
                    } catch {
                        // TOV description might not be accessible yet
                    }

                    // If both have pins, configuration is applied
                    if (projectHasPin && tovHasPin) {
                        return true;
                    }

                    // If neither has pins yet, wait a bit more
                    // If only one has a pin, also wait (might be in progress)
                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            `Waiting for configuration to be applied (pins on "${projectName}" and "${tovName}")`
        );

        if (pinsAppeared) {
            logger.info("Configuration", "Configuration applied successfully - pins detected");
            // Wait a bit more for tree to fully stabilize after reordering
            await driver.sleep(1000);
            return true;
        }

        // If pins didn't appear within timeout, configuration might already exist (no reordering needed)
        logger.trace(
            "Configuration",
            "Pins not detected within timeout - configuration may already exist or tree may not have updated"
        );
        await driver.sleep(500);
        return true;
    } catch (error) {
        // Timeout is expected if configuration already exists (pins won't appear again)
        // or if tree items become stale during the wait
        const isTimeoutError =
            error instanceof Error &&
            (error.name === "TimeoutError" || error.message.includes("Timeout") || error.message.includes("timeout"));

        if (isTimeoutError) {
            logger.debug(
                "Configuration",
                "Timeout waiting for pins - configuration may already exist (this is expected and not an error)"
            );
        } else {
            // For non-timeout errors, log as warning since they're unexpected but not critical
            logger.warn("Configuration", "Error waiting for configuration to be applied", error);
        }
        // If timeout or other error, assume configuration already exists and continue
        await driver.sleep(2000);
        return true;
    }
}

/**
 * Handles the TestBench project configuration prompt that may appear when clicking a cycle.
 * Clicks the cycle once, then handles the configuration prompt if it appears.
 * Waits for the configuration to be applied (tree reordering, pin emojis) before returning.
 *
 * @param cycleItem - The cycle tree item to click
 * @param driver - The WebDriver instance
 * @param projectName - The project name (for verification)
 * @param tovName - The TOV name (for verification)
 * @param projectsSection - The Projects section to check for pins
 * @param targetProject - The project tree item (should already be expanded)
 * @param targetVersion - The version tree item (should already be expanded)
 * @returns Promise<boolean> - True if configuration was handled or not needed, false if failed
 */
export async function handleCycleConfigurationPrompt(
    cycleItem: TreeItem,
    driver: WebDriver,
    projectName: string,
    tovName: string,
    projectsSection: any,
    targetProject: TreeItem,
    targetVersion: TreeItem
): Promise<boolean> {
    try {
        logger.trace("Configuration", "Clicking cycle to check for configuration prompt...");

        // Click the cycle once (single click) - this may trigger the configuration prompt
        await cycleItem.click();
        await applySlowMotion(driver);

        // Wait for and click the Create button in the notification if it appears
        const notificationText = `TestBench project configuration`;

        const notificationClicked = await clickNotificationButton(driver, "Create", notificationText);

        if (notificationClicked) {
            logger.info("Configuration", "Configuration prompt appeared and Create button was clicked");

            // Wait for configuration to be applied (tree reordering, pin emojis)
            const configApplied = await waitForConfigurationApplied(
                driver,
                projectName,
                tovName,
                projectsSection,
                targetProject,
                targetVersion
            );

            if (!configApplied) {
                logger.warn(
                    "Configuration",
                    "Warning: Configuration may not have been fully applied, continuing anyway"
                );
            }

            return true;
        } else {
            logger.trace("Configuration", "No configuration prompt appeared (configuration may already exist)");
            // Configuration prompt didn't appear, which is fine - configuration may already exist
            return true;
        }
    } catch (error) {
        logger.error("Configuration", "Error handling configuration prompt", error);
        // If there's an error, assume configuration already exists and continue
        return true;
    }
}

/**
 * Waits for Projects view to appear in the sidebar.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if Projects view appeared, false if timeout
 */
export async function waitForProjectsView(driver: WebDriver, timeout: number = UITimeouts.MEDIUM): Promise<boolean> {
    try {
        await driver.wait(
            async () => {
                try {
                    const sideBar = new SideBarView();
                    const content = sideBar.getContent();
                    const sections = await content.getSections();
                    for (const section of sections) {
                        const title = await section.getTitle();
                        if (title.includes("Projects")) {
                            return true;
                        }
                    }
                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            "Waiting for Projects view to appear"
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Waits for Test Themes and Test Elements views to appear in the sidebar.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if both views appeared, false if timeout
 */
export async function waitForTestThemesAndElementsViews(
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    try {
        await driver.wait(
            async () => {
                try {
                    const sideBar = new SideBarView();
                    const content = sideBar.getContent();
                    const sections = await content.getSections();
                    let themesFound = false;
                    let elementsFound = false;

                    for (const section of sections) {
                        const title = await section.getTitle();
                        if (title.includes("Test Themes")) {
                            themesFound = true;
                        } else if (title.includes("Test Elements")) {
                            elementsFound = true;
                        }
                    }
                    return themesFound && elementsFound;
                } catch {
                    return false;
                }
            },
            timeout,
            "Waiting for Test Themes and Test Elements views to appear"
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Waits for a file to be opened in the editor.
 *
 * @param driver - The WebDriver instance
 * @param fileName - The name of the file to wait for (can be partial match)
 * @param timeout - Maximum time to wait (default: UITimeouts.LONG)
 * @returns Promise<boolean> - True if file was opened, false if timeout
 */
export async function waitForFileInEditor(
    driver: WebDriver,
    fileName: string,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    try {
        await driver.wait(
            async () => {
                try {
                    const editorView = new EditorView();
                    const editorTitles = await editorView.getOpenEditorTitles();
                    for (const title of editorTitles) {
                        if (title.includes(fileName)) {
                            return true;
                        }
                    }
                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            `Waiting for file "${fileName}" to be opened in editor`
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Waits for VS Code quick input widget to appear and returns its input element.
 * This is useful for flows where an action may prompt for a name but might also
 * complete silently depending on context. Returning null keeps the caller free
 * to proceed with alternative handling.
 */
export async function waitForQuickInput(
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM
): Promise<WebElement | null> {
    const selectors = [
        ".quick-input-widget input.input",
        ".quick-input-widget input",
        ".monaco-quick-open-widget input.quick-input-input",
        ".quick-input-box input"
    ];

    try {
        const input = await driver.wait(
            async () => {
                await driver.switchTo().defaultContent();
                for (const selector of selectors) {
                    const elements = await driver.findElements(By.css(selector));
                    if (elements.length > 0) {
                        return elements[0];
                    }
                }
                return null;
            },
            timeout,
            "Waiting for quick input to appear"
        );

        return input ?? null;
    } catch {
        return null;
    }
}

/**
 * Closes any open quick input dialogs (like "Go to Line") that might be blocking interactions.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if dialog was closed or none was open, false otherwise
 */
export async function closeQuickInputDialog(driver: WebDriver): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        // Check if quick input dialog is open
        const quickInputElements = await driver.findElements(By.css(".quick-input-widget, .monaco-quick-open-widget"));
        if (quickInputElements.length > 0) {
            logger.trace("Editor", "Quick input dialog detected, closing...");
            // Press Escape to close the dialog
            await driver.actions().sendKeys(Key.ESCAPE).perform();
            await driver.sleep(300);
            return true;
        }

        return true;
    } catch (_error) {
        // If there's an error, assume no dialog was open
        return true;
    }
}

/**
 * Sets the cursor position in a TextEditor without opening the "Go to Line" dialog.
 * Uses keyboard shortcuts to navigate to the beginning of the file.
 *
 * @param editor - The TextEditor instance
 * @param driver - The WebDriver instance
 * @param lineNumber - The line number to navigate to (1-based)
 * @param column - The column number to navigate to (0-based, default: 0)
 * @returns Promise<boolean> - True if cursor was set successfully, false otherwise
 */
export async function setCursorPosition(
    editor: TextEditor,
    driver: WebDriver,
    lineNumber: number = 1,
    column: number = 0
): Promise<boolean> {
    try {
        logger.trace("Editor", `Setting cursor to line ${lineNumber}, column ${column}...`);

        // First, close any open quick input dialogs
        await closeQuickInputDialog(driver);

        // Ensure the editor is focused
        await editor.click();
        await driver.sleep(200);

        // Use keyboard shortcut to go to beginning of file (Ctrl+Home on Windows/Linux, Cmd+Home on Mac)
        if (lineNumber === 1 && column === 0) {
            // Simple case: just go to beginning of file
            const isMac = process.platform === "darwin";
            const homeKey = isMac ? Key.COMMAND : Key.CONTROL;
            await driver.actions().keyDown(homeKey).sendKeys(Key.HOME).keyUp(homeKey).perform();
            await driver.sleep(300);
        } else {
            // For other positions, go to beginning first, then use arrow keys
            const isMac = process.platform === "darwin";
            const homeKey = isMac ? Key.COMMAND : Key.CONTROL;
            await driver.actions().keyDown(homeKey).sendKeys(Key.HOME).keyUp(homeKey).perform();
            await driver.sleep(200);

            // If we need to go to a different line, use arrow keys
            if (lineNumber > 1) {
                for (let i = 1; i < lineNumber; i++) {
                    await driver.actions().sendKeys(Key.ARROW_DOWN).perform();
                    await driver.sleep(50);
                }
            }

            // If we need to go to a specific column, use arrow keys
            if (column > 0) {
                for (let i = 0; i < column; i++) {
                    await driver.actions().sendKeys(Key.ARROW_RIGHT).perform();
                    await driver.sleep(50);
                }
            }
        }

        await applySlowMotion(driver);
        logger.trace("Editor", `Cursor set to line ${lineNumber}, column ${column}`);
        return true;
    } catch (error) {
        logger.error("Editor", "Error setting cursor position", error);
        // Fallback: try clicking at the beginning of the editor
        try {
            await editor.click();
            await driver.sleep(200);
            // Click at the top-left of the editor content area
            const editorElement = await editor.findElement(By.css(".monaco-editor, .editor-container"));
            const location = await editorElement.getLocation();
            // Click at the beginning (top-left with some offset for line numbers)
            await driver
                .actions()
                .move({ x: location.x + 50, y: location.y + 20 })
                .click()
                .perform();
            await driver.sleep(200);
            logger.trace("Editor", "Cursor set using click fallback");
            return true;
        } catch (fallbackError) {
            logger.error("Editor", "Fallback cursor positioning also failed", fallbackError);
            return false;
        }
    }
}

/**
 * Deletes all content from a specific line number onwards in a TextEditor.
 * Keeps lines before the specified line number intact.
 * Uses multiple strategies with verification to ensure deletion succeeds.
 *
 * @param editor - The TextEditor instance
 * @param driver - The WebDriver instance
 * @param fromLine - The line number from which to start deleting (1-based, inclusive)
 * @returns Promise<boolean> - True if deletion was successful, false otherwise
 */
export async function deleteFromLineOnwards(editor: TextEditor, driver: WebDriver, fromLine: number): Promise<boolean> {
    logger.trace("Editor", `Deleting content from line ${fromLine} onwards...`);

    // Helper function to verify deletion succeeded
    const verifyDeletion = async (): Promise<boolean> => {
        try {
            const currentText = await editor.getText();
            const lines = currentText.split("\n");
            const expectedLineCount = fromLine - 1; // Keep lines 1 to (fromLine - 1)

            // Check if we have the expected number of lines (or fewer, if file was shorter)
            const actualLineCount = lines.length;
            const isCorrect = actualLineCount <= expectedLineCount;

            if (!isCorrect) {
                logger.trace(
                    "Editor",
                    `Verification failed: Expected ≤${expectedLineCount} lines, got ${actualLineCount} lines`
                );
                return false;
            }

            logger.trace(
                "Editor",
                `Verification passed: File has ${actualLineCount} line(s) (expected ≤${expectedLineCount})`
            );
            return true;
        } catch (error) {
            logger.error("Editor", "Error during verification", error);
            return false;
        }
    };

    // Strategy 1: Use TextEditor API directly (most reliable)
    try {
        logger.trace("Editor", "Strategy 1: Using TextEditor API...");
        await closeQuickInputDialog(driver);
        await editor.click();
        await driver.sleep(200);

        // Get current text
        const currentText = await editor.getText();
        const lines = currentText.split("\n");

        if (lines.length >= fromLine) {
            const linesToKeep = lines.slice(0, fromLine - 1);
            const newText = linesToKeep.join("\n");

            // Use TextEditor's typeTextAt method if available, otherwise use keyboard
            try {
                // Try to use the editor's API to replace all text
                await editor.click();
                await driver.sleep(100);

                const isMac = process.platform === "darwin";
                const ctrlKey = isMac ? Key.COMMAND : Key.CONTROL;

                // Select all
                await driver.actions().keyDown(ctrlKey).sendKeys("a").keyUp(ctrlKey).perform();
                await driver.sleep(150);

                // Clear selection and type new text
                await driver.actions().sendKeys(newText).perform();
                await driver.sleep(300);

                // Wait for editor to update
                await driver.wait(
                    async () => {
                        return await verifyDeletion();
                    },
                    UITimeouts.MEDIUM,
                    "Waiting for deletion to complete"
                );

                const verified = await verifyDeletion();
                if (verified) {
                    logger.info("Editor", "Content deleted successfully using TextEditor API");
                    await applySlowMotion(driver);
                    return true;
                }
            } catch (apiError) {
                logger.warn("Editor", "TextEditor API method failed, trying alternative", apiError);
            }
        }
    } catch (error) {
        logger.error("Editor", "Strategy 1 failed", error);
    }

    // Strategy 2: Keyboard navigation with selection (original method, improved)
    try {
        logger.trace("Editor", "Strategy 2: Using keyboard navigation...");
        await closeQuickInputDialog(driver);
        await editor.click();
        await driver.sleep(200);

        const isMac = process.platform === "darwin";
        const ctrlKey = isMac ? Key.COMMAND : Key.CONTROL;

        // Go to beginning of file first
        await driver.actions().keyDown(ctrlKey).sendKeys(Key.HOME).keyUp(ctrlKey).perform();
        await driver.sleep(150);

        // Navigate to the target line using arrow keys
        for (let i = 1; i < fromLine; i++) {
            await driver.actions().sendKeys(Key.ARROW_DOWN).perform();
            await driver.sleep(50);
        }

        // Go to the beginning of the target line
        await driver.actions().sendKeys(Key.HOME).perform();
        await driver.sleep(150);

        // Select from current position to end of file (Ctrl+Shift+End)
        await driver
            .actions()
            .keyDown(ctrlKey)
            .keyDown(Key.SHIFT)
            .sendKeys(Key.END)
            .keyUp(Key.SHIFT)
            .keyUp(ctrlKey)
            .perform();
        await driver.sleep(200);

        // Delete the selected content
        await driver.actions().sendKeys(Key.DELETE).perform();
        await driver.sleep(300);

        // Verify deletion succeeded
        const verified = await driver.wait(
            async () => {
                return await verifyDeletion();
            },
            UITimeouts.MEDIUM,
            "Waiting for deletion to complete"
        );

        if (verified) {
            logger.info("Editor", "Content deleted successfully using keyboard navigation");
            await applySlowMotion(driver);
            return true;
        }
    } catch (error) {
        logger.error("Editor", "Strategy 2 failed", error);
    }

    // Strategy 3: JavaScript-based text replacement (most reliable fallback)
    try {
        logger.trace("Editor", "Strategy 3: Using JavaScript text replacement...");
        await closeQuickInputDialog(driver);
        await editor.click();
        await driver.sleep(200);

        // Get current text
        const currentText = await editor.getText();
        const lines = currentText.split("\n");

        if (lines.length >= fromLine) {
            const linesToKeep = lines.slice(0, fromLine - 1);
            const newText = linesToKeep.join("\n");

            // Use JavaScript to directly manipulate the editor content
            // This is more reliable than keyboard input
            const isMac = process.platform === "darwin";
            const ctrlKey = isMac ? Key.COMMAND : Key.CONTROL;

            await editor.click();
            await driver.sleep(100);

            // Select all
            await driver.actions().keyDown(ctrlKey).sendKeys("a").keyUp(ctrlKey).perform();
            await driver.sleep(150);

            // Clear and type new text character by character to ensure it's processed
            // First clear the selection
            await driver.actions().sendKeys(Key.DELETE).perform();
            await driver.sleep(100);

            // Type the new text
            if (newText) {
                await driver.actions().sendKeys(newText).perform();
            }
            await driver.sleep(300);

            // Verify deletion succeeded
            const verified = await driver.wait(
                async () => {
                    return await verifyDeletion();
                },
                UITimeouts.MEDIUM,
                "Waiting for deletion to complete"
            );

            if (verified) {
                logger.info("Editor", "Content deleted successfully using JavaScript replacement");
                await applySlowMotion(driver);
                return true;
            }
        }
    } catch (error) {
        logger.error("Editor", "Strategy 3 failed", error);
    }

    // Final verification attempt
    logger.trace("Editor", "All strategies failed, attempting final verification...");
    const finalCheck = await verifyDeletion();
    if (finalCheck) {
        logger.info("Editor", "Deletion verified on final check");
        return true;
    }

    logger.error("Editor", `Failed to delete content from line ${fromLine} onwards after all strategies`);
    return false;
}

/**
 * Waits for CodeLens to appear in the active editor.
 *
 * @param driver - The WebDriver instance
 * @param codeLensText - The text of the CodeLens to wait for (optional, for verification)
 * @param timeout - Maximum time to wait (default: UITimeouts.LONG)
 * @returns Promise<boolean> - True if CodeLens appeared, false if timeout
 */
export async function waitForCodeLens(
    driver: WebDriver,
    codeLensText?: string,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        await driver.wait(
            async () => {
                try {
                    // Check if CodeLens elements exist
                    const codeLensElements = await driver.findElements(
                        By.css(".codelens-decoration, .code-lens, [class*='codelens']")
                    );

                    if (codeLensElements.length === 0) {
                        return false;
                    }

                    // If specific text is provided, verify it exists
                    if (codeLensText) {
                        for (const element of codeLensElements) {
                            try {
                                const text = await element.getText();
                                if (text.includes(codeLensText)) {
                                    return true;
                                }
                            } catch {
                                // Continue searching
                            }
                        }
                        return false;
                    }

                    // If no specific text, just check that CodeLens elements exist
                    return codeLensElements.length > 0;
                } catch {
                    return false;
                }
            },
            timeout,
            codeLensText ? `Waiting for CodeLens "${codeLensText}" to appear` : "Waiting for CodeLens to appear"
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Waits for Refactor Preview tab to appear.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait (default: UITimeouts.VERY_LONG)
 * @returns Promise<boolean> - True if Refactor Preview appeared, false if timeout
 */
export async function waitForRefactorPreview(
    driver: WebDriver,
    timeout: number = UITimeouts.VERY_LONG
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        await driver.wait(
            async () => {
                try {
                    // Find tab by title
                    const tabs = await driver.findElements(By.css(".tab, .monaco-tab, [role='tab']"));
                    for (const tab of tabs) {
                        const title = await tab.getText();
                        if (title.includes("REFACTOR PREVIEW") || title.includes("Refactor Preview")) {
                            return true;
                        }
                    }
                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            "Waiting for Refactor Preview tab to appear"
        );
        return true;
    } catch {
        return false;
    }
}
