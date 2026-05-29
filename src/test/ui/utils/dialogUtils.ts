/**
 * @file src/test/ui/utils/dialogUtils.ts
 * @description VS Code host dialog interaction helpers for UI tests.
 */

import { getTestLogger } from "./testLogger";
import { escapeXPathLiteral } from "./xpathUtils";
import { UITimeouts, applySlowMotion, waitForCondition } from "./waitHelpers";
import { WebDriver, By, WebElement, Key } from "vscode-extension-tester";

const logger = getTestLogger();
const DIALOG_SELECTORS = ".monaco-dialog-modal-block, .monaco-dialog, .monaco-dialog-box";

/**
 * Checks whether any known VS Code dialog surface is currently visible.
 *
 * @param driver - WebDriver instance used to inspect dialog DOM nodes
 * @returns Promise<boolean> - True when at least one visible dialog is present
 */
async function hasVisibleDialog(driver: WebDriver): Promise<boolean> {
    const dialogs = await driver.findElements(By.css(DIALOG_SELECTORS));
    for (const dialog of dialogs) {
        try {
            if (await dialog.isDisplayed()) {
                return true;
            }
        } catch {
            // Ignore stale nodes and continue checking remaining candidates.
        }
    }

    return false;
}

/**
 * Waits for a visible dialog surface to appear.
 *
 * @param driver - WebDriver instance used for polling
 * @param timeout - Maximum wait duration in milliseconds
 * @param context - Timeout context description for diagnostics
 * @returns Promise<boolean> - True if a dialog appeared before timeout
 */
async function waitForDialogPresent(driver: WebDriver, timeout: number, context: string): Promise<boolean> {
    return await waitForCondition(driver, async () => await hasVisibleDialog(driver), timeout, 100, context);
}

/**
 * Waits for all visible dialog surfaces to disappear.
 *
 * @param driver - WebDriver instance used for polling
 * @param timeout - Maximum wait duration in milliseconds
 * @param context - Timeout context description for diagnostics
 * @returns Promise<boolean> - True when no visible dialogs remain before timeout
 */
async function waitForDialogGone(driver: WebDriver, timeout: number, context: string): Promise<boolean> {
    return await waitForCondition(driver, async () => !(await hasVisibleDialog(driver)), timeout, 100, context);
}

/**
 * Resolves a confirmation button element using dialog-scoped and fallback searches.
 *
 * @param driver - WebDriver instance used to execute searches
 * @param escapedButtonText - XPath-safe confirmation button text value
 * @param dialogElement - Optional dialog root element to prioritize scoped queries
 * @returns Promise<WebElement | null> - Resolved button element, or null if not found
 */
async function findConfirmationButton(
    driver: WebDriver,
    escapedButtonText: string,
    dialogElement: WebElement | null
): Promise<WebElement | null> {
    let buttons: WebElement[] = [];

    // If we found the dialog element, search within it first.
    if (dialogElement) {
        try {
            buttons = await dialogElement.findElements(
                By.xpath(`.//button[normalize-space(text())=${escapedButtonText}]`)
            );
            if (buttons.length === 0) {
                buttons = await dialogElement.findElements(
                    By.xpath(`.//button[contains(normalize-space(text()), ${escapedButtonText})]`)
                );
            }
            // Try links similar to buttons
            if (buttons.length === 0) {
                buttons = await dialogElement.findElements(
                    By.xpath(`.//a[contains(@class, 'monaco-button') and normalize-space(text())=${escapedButtonText}]`)
                );
            }
        } catch {
            // If dialog element becomes stale, fall back to document-wide search.
        }
    }

    // If no buttons found in dialog, try document-wide search.
    if (buttons.length === 0) {
        // Try exact text match first (button elements).
        buttons = await driver.findElements(By.xpath(`//button[normalize-space(text())=${escapedButtonText}]`));

        // Try links that look like buttons (VS Code uses <a> tags styled as buttons).
        if (buttons.length === 0) {
            buttons = await driver.findElements(
                By.xpath(`//a[contains(@class, 'monaco-button') and normalize-space(text())=${escapedButtonText}]`)
            );
        }

        // If no exact match, try contains.
        if (buttons.length === 0) {
            buttons = await driver.findElements(
                By.xpath(`//button[contains(normalize-space(text()), ${escapedButtonText})]`)
            );
        }

        if (buttons.length === 0) {
            buttons = await driver.findElements(
                By.xpath(
                    `//a[contains(@class, 'monaco-button') and contains(normalize-space(text()), ${escapedButtonText})]`
                )
            );
        }

        // Try by aria-label.
        if (buttons.length === 0) {
            buttons = await driver.findElements(By.xpath(`//button[@aria-label=${escapedButtonText}]`));
        }

        if (buttons.length === 0) {
            buttons = await driver.findElements(By.xpath(`//a[@aria-label=${escapedButtonText}]`));
        }
    }

    return buttons.length > 0 ? buttons[0] : null;
}

/**
 * Handles VS Code confirmation dialog by clicking the specified button text.
 * For delete confirmation dialogs, looks for "Delete" button specifically.
 * Waits for dialog to appear and fully close before returning.
 *
 * @param driver - The WebDriver instance
 * @param buttonText - The text of the button to click (e.g., "Delete", "Save Changes")
 * @param timeout - Maximum time to wait for dialog (default: 5000ms)
 * @returns Promise<boolean> - True if dialog was found and handled, false otherwise
 */
export async function handleConfirmationDialog(
    driver: WebDriver,
    buttonText: string,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    try {
        // Ensure we're in default content (not in webview)
        await driver.switchTo().defaultContent();

        logger.trace("Dialog", `Looking for confirmation dialog with button: "${buttonText}"`);
        const escapedButtonText = escapeXPathLiteral(buttonText);

        // First, quickly check if dialog exists (without waiting)
        const dialogAlreadyVisible = await hasVisibleDialog(driver);

        // If no dialog exists, return early without trying strategies
        if (!dialogAlreadyVisible) {
            // Wait briefly for dialog to appear (in case it's still animating)
            const appeared = await waitForDialogPresent(
                driver,
                UITimeouts.SHORT,
                `brief confirmation dialog appearance check for button "${buttonText}"`
            );
            if (!appeared) {
                // Dialog doesn't exist, return early
                logger.trace("Dialog", "No dialog found, skipping button search");
                return false;
            }
        }

        // Dialog exists, proceed with finding the button
        // Wait for the dialog modal to be fully rendered
        let dialogElement: WebElement | null = null;
        const dialogAppeared = await waitForDialogPresent(
            driver,
            timeout,
            `confirmation dialog modal to appear for button "${buttonText}"`
        );
        if (dialogAppeared) {
            logger.trace("Dialog", "Dialog modal appeared");

            // Wait for dialog to fully render and for dialog content to be visible
            await waitForCondition(
                driver,
                async () => {
                    try {
                        const dialog = await driver.findElement(
                            By.css(".monaco-dialog, .monaco-dialog-box, [role='dialog']")
                        );
                        return await dialog.isDisplayed();
                    } catch {
                        return false;
                    }
                },
                UITimeouts.SHORT,
                100,
                `dialog content to be displayed before searching for button "${buttonText}"`
            );

            // Try multiple selectors for the dialog element
            const dialogSelectors = [
                ".monaco-dialog",
                ".monaco-dialog-box",
                ".monaco-dialog .monaco-dialog-content",
                "[role='dialog']",
                ".dialog-box"
            ];

            for (const selector of dialogSelectors) {
                try {
                    dialogElement = await driver.findElement(By.css(selector));
                    logger.trace("Dialog", `Found dialog element with selector: ${selector}`);
                    break;
                } catch {
                    // Try next selector
                }
            }

            if (!dialogElement) {
                logger.trace("Dialog", "Dialog element not found with standard selectors, searching in document");
            }
        } else {
            logger.trace("Dialog", "Dialog modal not found, but continuing to search for button");
        }

        // Try multiple strategies to find the button.
        // Strategy 1: Find by text/aria-label within dialog, then document-wide.
        let confirmButton: WebElement | null = null;
        const confirmButtonFound = await waitForCondition(
            driver,
            async () => {
                confirmButton = await findConfirmationButton(driver, escapedButtonText, dialogElement);
                return confirmButton !== null;
            },
            timeout,
            100,
            `confirmation dialog button "${buttonText}" to appear`
        );

        if (confirmButtonFound && confirmButton) {
            const resolvedConfirmButton: WebElement = confirmButton;
            const buttonTextFound = await resolvedConfirmButton.getText();
            const tagName = await resolvedConfirmButton.getTagName();
            logger.trace("Dialog", `Found ${tagName} element with text: "${buttonTextFound}", clicking...`);

            // Scroll button into view if needed
            await driver.executeScript("arguments[0].scrollIntoView({ block: 'center' });", resolvedConfirmButton);

            // Wait for button to be clickable (enabled and displayed)
            const buttonClickable = await waitForCondition(
                driver,
                async () => {
                    try {
                        const isEnabled = await resolvedConfirmButton.isEnabled();
                        const isDisplayed = await resolvedConfirmButton.isDisplayed();
                        return isEnabled && isDisplayed;
                    } catch {
                        return false;
                    }
                },
                UITimeouts.MINIMAL,
                100,
                `confirmation dialog button "${buttonText}" to become clickable`
            );
            if (!buttonClickable) {
                throw new Error(`Timed out waiting for confirmation button "${buttonText}" to become clickable`);
            }

            try {
                await resolvedConfirmButton.click();
                await applySlowMotion(driver); // Visible: clicking confirmation dialog button
            } catch (clickError) {
                // If click fails, try JavaScript click
                logger.warn("Dialog", "Regular click failed, trying JavaScript click", clickError);
                await driver.executeScript("arguments[0].click();", resolvedConfirmButton);
                await applySlowMotion(driver);
            }

            // Wait for dialog to fully close (wait for modal-block to disappear)
            const dialogClosed = await waitForDialogGone(
                driver,
                UITimeouts.MEDIUM,
                `confirmation dialog to close after clicking "${buttonText}"`
            );
            if (dialogClosed) {
                logger.trace("Dialog", "Dialog closed successfully");
            } else {
                logger.trace("Dialog", "Dialog may have closed, but modal-block still present");
            }

            // Additional wait to ensure dialog is fully gone and verify no dialog elements remain
            await waitForDialogGone(
                driver,
                UITimeouts.SHORT,
                `confirmation dialog to be fully gone after clicking "${buttonText}"`
            );
            return true;
        }

        // If button not found, try JavaScript-based search (buttons might be in shadow DOM)
        logger.trace("Dialog", `Button "${buttonText}" not found with XPath, trying JavaScript search...`);
        try {
            const buttonFound = (await driver.executeScript(
                `
                function findButtonInDialog(buttonText) {
                    // Try to find dialog element
                    const dialog = document.querySelector('.monaco-dialog') || 
                                  document.querySelector('[role="dialog"]') ||
                                  document.querySelector('.monaco-dialog-box');
                    
                    const searchArea = dialog || document;
                    
                    // Search for buttons and links
                    const allElements = searchArea.querySelectorAll('button, a.monaco-button, a[class*="button"]');
                    
                    for (const element of allElements) {
                        const text = element.textContent?.trim() || element.innerText?.trim() || '';
                        const ariaLabel = element.getAttribute('aria-label') || '';
                        
                        if (text === buttonText || text.includes(buttonText) || ariaLabel === buttonText) {
                            return element;
                        }
                    }
                    return null;
                }
                const button = findButtonInDialog(String(arguments[0] || ''));
                if (button) {
                    button.scrollIntoView({ block: 'center' });
                    return button;
                }
                return null;
            `,
                buttonText
            )) as WebElement | null;

            if (buttonFound) {
                logger.trace("Dialog", "Found button using JavaScript, clicking...");
                await driver.executeScript("arguments[0].click();", buttonFound);
                await applySlowMotion(driver);

                // Wait for dialog to close
                await waitForDialogGone(
                    driver,
                    UITimeouts.MEDIUM,
                    `confirmation dialog to close after JavaScript click for "${buttonText}"`
                );

                // Verify dialog is fully gone
                const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
                if (modalBlocks.length === 0) {
                    logger.trace("Dialog", "Dialog closed successfully using JavaScript click");
                    return true;
                }
            }
        } catch (jsError) {
            logger.warn("Dialog", "JavaScript search failed", jsError);
        }

        // If button still not found, try keyboard navigation (Enter key for primary button)
        logger.trace("Dialog", `Button "${buttonText}" not found, trying keyboard navigation (Enter key)...`);
        try {
            // Focus the dialog first
            const dialogModal = await driver.findElement(By.css(".monaco-dialog-modal-block"));
            await dialogModal.click();

            // Wait for dialog to be focused
            await waitForCondition(
                driver,
                async () => {
                    const activeElement = await driver.executeScript("return document.activeElement;");
                    return activeElement !== null;
                },
                500,
                100,
                "dialog to be focused before Enter key confirmation"
            );

            await driver.actions().sendKeys(Key.ENTER).perform();

            // Wait for dialog to close
            await waitForDialogGone(
                driver,
                UITimeouts.MEDIUM,
                `confirmation dialog to close after Enter key for "${buttonText}"`
            );

            // Check if dialog closed
            const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
            if (modalBlocks.length === 0) {
                logger.trace("Dialog", "Dialog closed using Enter key");
                return true;
            }
        } catch (keyboardError) {
            logger.warn("Dialog", "Keyboard navigation failed", keyboardError);
        }

        logger.trace("Dialog", `Button "${buttonText}" not found with any strategy`);
        return false;
    } catch (error) {
        const isTimeoutError =
            error instanceof Error &&
            (error.message.includes("Timeout") || error.message.includes("timeout") || error.name === "TimeoutError");

        // Check if dialog exists before trying fallback strategies
        const dialogVisible = await hasVisibleDialog(driver);

        if (!dialogVisible) {
            if (isTimeoutError) {
                logger.trace("Dialog", "No dialog found (timeout), skipping fallback strategies");
            } else {
                logger.trace("Dialog", "No dialog found, skipping fallback strategies");
            }
            return false;
        }

        logger.error("Dialog", "Error finding button with primary strategy", error);
        // Dialog exists but button finding failed, try alternative approach
        try {
            // Wait for dialog to be fully rendered
            await waitForDialogPresent(
                driver,
                UITimeouts.SHORT,
                `dialog to be ready before fallback search for "${buttonText}"`
            );

            // Use JavaScript to find all buttons/links (can access shadow DOM and any structure)
            logger.trace("Dialog", "Using JavaScript to search for buttons in fallback strategy...");
            const buttonInfo = (await driver.executeScript(`
                function findAllButtons() {
                    const buttons = [];
                    const dialog = document.querySelector('.monaco-dialog') || 
                                  document.querySelector('[role="dialog"]') ||
                                  document.querySelector('.monaco-dialog-box') ||
                                  document;
                    
                    const elements = dialog.querySelectorAll('button, a.monaco-button, a[class*="button"], a[role="button"], .monaco-button');
                    
                    for (const element of elements) {
                        const text = element.textContent?.trim() || element.innerText?.trim() || '';
                        const ariaLabel = element.getAttribute('aria-label') || '';
                        const tagName = element.tagName.toLowerCase();
                        buttons.push({
                            text: text,
                            ariaLabel: ariaLabel,
                            tagName: tagName,
                            className: element.className || ''
                        });
                    }
                    return buttons;
                }
                return findAllButtons();
            `)) as Array<{ text: string; ariaLabel: string; tagName: string; className: string }>;

            logger.trace("Dialog", `JavaScript found ${buttonInfo.length} button/link element(s):`);
            for (const btn of buttonInfo) {
                logger.trace(
                    "Dialog",
                    `  - ${btn.tagName} (class: ${btn.className}): text="${btn.text}", aria-label="${btn.ariaLabel}"`
                );
            }

            // Try to find and click the button using JavaScript
            const buttonClicked = (await driver.executeScript(
                `
                function findAndClickButton(buttonText) {
                    const dialog = document.querySelector('.monaco-dialog') || 
                                  document.querySelector('[role="dialog"]') ||
                                  document.querySelector('.monaco-dialog-box') ||
                                  document;
                    
                    const elements = dialog.querySelectorAll('button, a.monaco-button, a[class*="button"], a[role="button"], .monaco-button');
                    
                    for (const element of elements) {
                        const text = element.textContent?.trim() || element.innerText?.trim() || '';
                        const ariaLabel = element.getAttribute('aria-label') || '';
                        
                        if (text === buttonText || text.includes(buttonText) || ariaLabel === buttonText) {
                            element.scrollIntoView({ block: 'center' });
                            element.click();
                            return true;
                        }
                    }
                    return false;
                }
                return findAndClickButton(String(arguments[0] || ''));
            `,
                buttonText
            )) as boolean;

            if (buttonClicked) {
                logger.trace("Dialog", "Successfully clicked button using JavaScript in fallback");
                await applySlowMotion(driver);

                // Wait for dialog to close
                const fallbackClosed = await waitForDialogGone(
                    driver,
                    UITimeouts.MEDIUM,
                    `confirmation dialog to close after fallback click for "${buttonText}"`
                );
                if (fallbackClosed) {
                    logger.trace("Dialog", "Dialog closed successfully");
                } else {
                    logger.trace("Dialog", "Dialog may have closed");
                }

                // Verify dialog is fully gone
                await waitForDialogGone(
                    driver,
                    UITimeouts.SHORT,
                    `confirmation dialog to be fully gone after fallback click for "${buttonText}"`
                );
                return true;
            }

            logger.trace("Dialog", `Could not find button "${buttonText}" using JavaScript in fallback`);
        } catch (fallbackError) {
            logger.error("Dialog", "Fallback strategy also failed", fallbackError);
        }
        return false;
    }
}
