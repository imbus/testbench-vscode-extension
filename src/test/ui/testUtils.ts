/**
 * @file src/test/ui/testUtils.ts
 * @description Utility functions and constants for UI tests
 */

import { WebDriver, Workbench, By, ActivityBar, SideBarView } from "vscode-extension-tester";

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

/**
 * Attempts to logout from TestBench if a session is active.
 * Uses the command palette to execute the logout command.
 * TODO: Expose logout command to users?
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if logout was attempted, false if no active session
 */
export async function attemptLogout(driver: WebDriver): Promise<boolean> {
    try {
        const workbench = new Workbench();
        const commandPalette = await workbench.openCommandPrompt();

        // Search for logout command
        await commandPalette.setText(">TestBench: Logout");
        await driver.sleep(1000);

        const picks = await commandPalette.getQuickPicks();

        // Check if logout command is available (indicates active session)
        let logoutCommandFound = false;
        for (const pick of picks) {
            const text = await pick.getText();
            if (text.includes("Logout")) {
                logoutCommandFound = true;
                await pick.select();
                await driver.sleep(2000); // Wait for logout to complete
                break;
            }
        }

        if (!logoutCommandFound) {
            await commandPalette.cancel();
        }

        return logoutCommandFound;
    } catch (error) {
        // If command palette fails or logout command not found, assume no active session
        console.log("Logout attempt failed or no active session:", error);
        return false;
    }
}

/**
 * Handles authentication modal by clicking the "Allow" button if present.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait for the button (default: 5000ms)
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function handleAllowButton(driver: WebDriver, timeout: number = 5000): Promise<boolean> {
    try {
        await driver.sleep(2000); // Wait for modal to appear
        const allowButtons = await driver.wait(async () => {
            const elements = await driver.findElements(By.xpath(ModalButtonSelectors.ALLOW));
            return elements.length > 0 ? elements : null;
        }, timeout);

        if (allowButtons && allowButtons.length > 0) {
            await allowButtons[0].click();
            console.log(`Clicked ${ModalButtonTexts.ALLOW} button`);
            await driver.sleep(3000); // Wait for action to complete
            return true;
        }

        return false;
    } catch (error) {
        console.log(`Could not find or click ${ModalButtonTexts.ALLOW} button:`, error);
        return false;
    }
}

/**
 * Handles certificate warning modal by clicking the "Proceed Anyway" button if present.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait for the button (default: 5000ms)
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function handleProceedAnywayButton(driver: WebDriver, timeout: number = 5000): Promise<boolean> {
    try {
        console.log("Checking for certificate warning...");
        const proceedButtons = await driver.wait(async () => {
            const elements = await driver.findElements(By.xpath(ModalButtonSelectors.PROCEED_ANYWAY));
            return elements.length > 0 ? elements : null;
        }, timeout);

        if (proceedButtons && proceedButtons.length > 0) {
            await proceedButtons[0].click();
            console.log(`Clicked ${ModalButtonTexts.PROCEED_ANYWAY} button for untrusted certificate`);
            await driver.sleep(2000); // Wait for action to complete
            return true;
        }

        return false;
    } catch (error) {
        console.log(`Could not find or click ${ModalButtonTexts.PROCEED_ANYWAY} button:`, error);
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
 * Opens the TestBench sidebar by finding and clicking the TestBench activity bar item.
 *
 * @param driver - The WebDriver instance (optional, for waiting)
 * @returns Promise<void>
 */
export async function openTestBenchSidebar(driver?: WebDriver): Promise<void> {
    const activityBar = new ActivityBar();
    const controls = await activityBar.getViewControls();

    for (const control of controls) {
        const title = await control.getTitle();
        if (title === "TestBench") {
            await control.openView();
            if (driver) {
                // Wait for sidebar to initialize instead of fixed sleep
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
                    10000,
                    "Waiting for TestBench sidebar to initialize",
                    500
                );
            }
            return;
        }
    }
    throw new Error("TestBench activity bar item not found");
}

/**
 * Finds and switches to the webview iframe in the shadow DOM.
 * Returns true if successful, false otherwise.
 *
 * @param driver - The WebDriver instance
 * @param markAttribute - Optional attribute name to mark the iframe (default: 'data-test-webview')
 * @param timeout - Maximum time to wait for webview (default: 15000ms)
 * @returns Promise<boolean> - True if webview was found and switched to, false otherwise
 */
export async function findAndSwitchToWebview(
    driver: WebDriver,
    markAttribute: string = "data-test-webview",
    timeout: number = 15000
): Promise<boolean> {
    try {
        // Wait for webview to be available with a single attempt using proper waits
        const iframeFound: boolean = await driver.wait(
            async (): Promise<boolean> => {
                const result = (await driver.executeScript(`
                function findIframesInShadowDOM(root) {
                    const iframes = [];
                    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
                    let node;
                    while (node = walker.nextNode()) {
                        if (node.shadowRoot) {
                            const shadowIframes = node.shadowRoot.querySelectorAll('iframe');
                            iframes.push(...shadowIframes);
                            iframes.push(...findIframesInShadowDOM(node.shadowRoot));
                        }
                        if (node.tagName === 'IFRAME') {
                            iframes.push(node);
                        }
                    }
                    return iframes;
                }
                const allIframes = findIframesInShadowDOM(document.body);
                if (allIframes.length > 0) {
                    allIframes[allIframes.length - 1].setAttribute('${markAttribute}', 'true');
                    return true;
                }
                return false;
            `)) as boolean;
                return result;
            },
            timeout,
            "Waiting for webview iframe",
            1000
        );

        if (!iframeFound) {
            return false;
        }

        // Find and switch to the marked iframe
        const markedIframes = await driver.findElements(By.css(`iframe[${markAttribute}="true"]`));
        if (markedIframes.length === 0) {
            return false;
        }

        await driver.switchTo().frame(markedIframes[0]);

        // Wait for active-frame to load content
        const contentLoaded = await driver.wait(
            async () => {
                const result = (await driver.executeScript(`
                const activeFrame = document.getElementById('active-frame');
                if (!activeFrame) return { loaded: false, reason: 'no active-frame' };
                
                const contentDocument = activeFrame.contentDocument || activeFrame.contentWindow?.document;
                if (!contentDocument) return { loaded: false, reason: 'no contentDocument' };
                
                const form = contentDocument.getElementById('addConnectionForm');
                const serverField = contentDocument.getElementById('serverName');
                const forms = contentDocument.querySelectorAll('form').length;
                
                return {
                    loaded: !!(form || serverField || forms > 0),
                    hasForm: !!form,
                    hasServerField: !!serverField,
                    forms: forms
                };
            `)) as { loaded: boolean; hasForm?: boolean; hasServerField?: boolean; forms?: number; reason?: string };
                return result.loaded;
            },
            10000,
            "Waiting for content to load in active-frame",
            1000
        );

        if (!contentLoaded) {
            await driver.switchTo().defaultContent();
            return false;
        }

        // Switch to the active-frame iframe inside the webview iframe
        const activeFrame = await driver.findElement(By.id("active-frame"));
        await driver.switchTo().frame(activeFrame);

        // Verify form is accessible
        const forms = await driver.findElements(By.id("addConnectionForm"));
        const serverFields = await driver.findElements(By.id("serverName"));

        if (forms.length === 0 && serverFields.length === 0) {
            await driver.switchTo().defaultContent();
            return false;
        }

        return true;
    } catch (error) {
        console.log("Error finding webview:", error);
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore errors when switching back
        }
        return false;
    }
}
