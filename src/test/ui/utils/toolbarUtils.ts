/**
 * @file src/test/ui/utils/toolbarUtils.ts
 * @description Utilities for interacting with view toolbars in VS Code.
 * Provides functions for clicking toolbar buttons and reading toolbar state.
 */

import { getTestLogger } from "./testLogger";
import { applySlowMotion, waitForCondition, UITimeouts } from "./testUtils";

const logger = getTestLogger();

/**
 * Clicks a toolbar action button by aria-label or title.
 *
 * @param section - The view section containing the toolbar
 * @param actionName - Part of the action button label (case-insensitive)
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if button was clicked
 */
export async function clickToolbarButton(section: any, actionName: string, driver: any): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        // Get the section title to identify the correct view
        let sectionTitle = "";
        try {
            sectionTitle = await section.getTitle();
        } catch {
            // Section title not available
        }

        const buttonClicked = await driver.executeScript(
            `
            const sectionTitle = arguments[0];
            const actionName = arguments[1].toLowerCase();

            // Find all view panes
            const panes = document.querySelectorAll('.pane, .split-view-view');
            for (const pane of panes) {
                // Check if this is the right pane by looking at the header title
                const header = pane.querySelector('.pane-header, .title');
                if (header) {
                    const titleText = header.textContent || '';
                    // Look in toolbar actions
                    const toolbarSelectors = [
                        '.pane-header .actions',
                        '.title-actions',
                        '.actions-container',
                        '.monaco-action-bar'
                    ];

                    for (const selector of toolbarSelectors) {
                        const toolbar = pane.querySelector(selector);
                        if (toolbar) {
                            const buttons = toolbar.querySelectorAll('a.action-item, li.action-item a, .action-label');
                            for (const btn of buttons) {
                                const label = btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
                                if (label.toLowerCase().includes(actionName)) {
                                    btn.click();
                                    return true;
                                }
                            }
                        }
                    }
                }
            }

            // Fallback: search all action items in the sidebar
            const allActions = document.querySelectorAll('.sidebar .action-item a, .sidebar .action-label');
            for (const btn of allActions) {
                const label = btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
                if (label.toLowerCase().includes(actionName)) {
                    btn.click();
                    return true;
                }
            }

            return false;
        `,
            sectionTitle,
            actionName
        );

        if (buttonClicked) {
            await applySlowMotion(driver);
        }

        return buttonClicked as boolean;
    } catch (error) {
        logger.debug("Toolbar", `Error clicking toolbar button "${actionName}": ${error}`);
        return false;
    }
}

/**
 * Gets all toolbar button labels for a view section.
 *
 * @param section - The view section
 * @param driver - The WebDriver instance
 * @returns Promise<string[]> - Array of button labels
 */
export async function getToolbarButtonLabels(section: any, driver: any): Promise<string[]> {
    try {
        // Get the section title to identify the correct view
        let sectionTitle = "";
        try {
            sectionTitle = await section.getTitle();
        } catch {
            // Section title not available
        }

        const labels = await driver.executeScript(
            `
            const sectionTitle = arguments[0];
            const result = [];

            // Find all view panes
            const panes = document.querySelectorAll('.pane, .split-view-view');
            for (const pane of panes) {
                // Check the pane header
                const header = pane.querySelector('.pane-header, .title');
                if (header) {
                    const titleText = header.textContent || '';

                    // If sectionTitle is provided, only look in matching pane
                    // Otherwise, collect from all panes
                    if (!sectionTitle || titleText.includes(sectionTitle)) {
                        const toolbarSelectors = [
                            '.pane-header .actions',
                            '.title-actions',
                            '.actions-container',
                            '.monaco-action-bar'
                        ];

                        for (const selector of toolbarSelectors) {
                            const toolbar = pane.querySelector(selector);
                            if (toolbar) {
                                const buttons = toolbar.querySelectorAll('a.action-item, li.action-item a, .action-label');
                                for (const btn of buttons) {
                                    const label = btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
                                    if (label && !result.includes(label)) {
                                        result.push(label);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Fallback: search all action items in the sidebar if no results
            if (result.length === 0) {
                const allActions = document.querySelectorAll('.sidebar .action-item a, .sidebar .action-label');
                for (const btn of allActions) {
                    const label = btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
                    if (label && !result.includes(label)) {
                        result.push(label);
                    }
                }
            }

            return result;
        `,
            sectionTitle
        );

        return (labels as string[]) || [];
    } catch (error) {
        logger.debug("Toolbar", `Error getting toolbar buttons: ${error}`);
        return [];
    }
}

/**
 * Checks if a toolbar has a specific button.
 *
 * @param section - The view section
 * @param buttonName - Part of the button name to search for
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if button exists
 */
export async function hasToolbarButton(section: any, buttonName: string, driver: any): Promise<boolean> {
    const labels = await getToolbarButtonLabels(section, driver);
    return labels.some((label) => label.toLowerCase().includes(buttonName.toLowerCase()));
}

/**
 * Clicks the Search button in a tree view toolbar.
 *
 * @param section - The view section containing the toolbar
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if search was activated
 */
export async function clickSearchButton(section: any, driver: any): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        const searchClicked = await driver.executeScript(`
            const sections = document.querySelectorAll('.pane-body');
            for (const section of sections) {
                const toolbar = section.closest('.pane')?.querySelector('.pane-header .actions');
                if (toolbar) {
                    const searchBtn = toolbar.querySelector('[class*="search"], [aria-label*="Search"], [title*="Search"]');
                    if (searchBtn) {
                        searchBtn.click();
                        return true;
                    }
                }
            }
            return false;
        `);

        if (searchClicked) {
            await applySlowMotion(driver);
        }

        return searchClicked as boolean;
    } catch (error) {
        logger.debug("Toolbar", `Error clicking search button: ${error}`);
        return false;
    }
}

/**
 * CSS selectors for tree view search input.
 * VS Code tree views use a custom filter widget in the pane header.
 */
const TREE_SEARCH_INPUT_SELECTORS = [
    // Tree filter widget input (primary - used by tree views)
    ".pane .tree-explorer-viewlet-tree-view .monaco-inputbox input",
    ".pane .monaco-list .monaco-inputbox input",
    ".pane-header .monaco-inputbox input",
    // Custom view tree search
    ".custom-tree-filter-container input",
    ".tree-filter input",
    // Fallback selectors
    ".monaco-inputbox.synthetic-focus input",
    ".monaco-inputbox input.input",
    // Quick input (for other dialogs)
    ".quick-input-box input"
].join(", ");

/**
 * Types search text into the search input box.
 * Handles the VS Code tree view filter widget which appears in the pane header.
 * Uses JavaScript to set input value directly to avoid ElementNotInteractableError.
 *
 * @param driver - The WebDriver instance
 * @param searchText - Text to type in search
 * @returns Promise<boolean> - True if text was entered
 */
export async function enterSearchText(driver: any, searchText: string): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        // Wait for search input to appear
        const inputAppeared = await waitForCondition(
            driver,
            async () => {
                const hasInput = await driver.executeScript(
                    `
                    const selectors = String(arguments[0] || '');
                    const inputs = document.querySelectorAll(selectors);
                    for (const input of inputs) {
                        if (input.offsetParent !== null) {
                            return true;
                        }
                    }
                    return false;
                `,
                    TREE_SEARCH_INPUT_SELECTORS
                );
                return hasInput as boolean;
            },
            UITimeouts.MEDIUM,
            100,
            "search input to appear"
        );

        if (!inputAppeared) {
            logger.warn("Toolbar", "Search input did not appear");
            return false;
        }

        // Use JavaScript to set the input value directly (avoids ElementNotInteractableError)
        const success = await driver.executeScript(
            `
            const selectors = String(arguments[0] || '');
            const nextValue = String(arguments[1] ?? '');
            const inputs = document.querySelectorAll(selectors);
            for (const input of inputs) {
                if (input.offsetParent !== null) {
                    // Focus and set value
                    input.focus();
                    input.value = nextValue;
                    // Dispatch input event to trigger VS Code's filtering
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        `,
            TREE_SEARCH_INPUT_SELECTORS,
            searchText
        );

        if (!success) {
            logger.warn("Toolbar", "Could not set search text via JavaScript");
            return false;
        }

        await applySlowMotion(driver);
        return true;
    } catch (error) {
        logger.debug("Toolbar", `Error entering search text: ${error}`);
        return false;
    }
}

/**
 * Clears the search input by setting it to an empty string.
 * Uses JavaScript to set the value directly to avoid ElementNotInteractableError.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if search was cleared
 */
export async function clearSearch(driver: any): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        // Use JavaScript to clear the input value directly (avoids ElementNotInteractableError)
        const cleared = await driver.executeScript(
            `
            const selectors = String(arguments[0] || '');
            const inputs = document.querySelectorAll(selectors);
            for (const input of inputs) {
                if (input.offsetParent !== null) {
                    // Clear the value
                    input.focus();
                    input.value = '';
                    // Dispatch input event to trigger VS Code's filtering reset
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        `,
            TREE_SEARCH_INPUT_SELECTORS
        );

        if (cleared) {
            await applySlowMotion(driver);
            return true;
        }

        // Fallback: Press Escape to close any open search widget
        const { Key } = await import("vscode-extension-tester");
        const body = await driver.findElement({ css: "body" });
        await body.sendKeys(Key.ESCAPE);
        await applySlowMotion(driver);

        return true;
    } catch (error) {
        logger.debug("Toolbar", `Error clearing search: ${error}`);
        return false;
    }
}

/**
 * Gets the count of visible tree items in a section.
 *
 * @param section - The view section
 * @returns Promise<number> - Count of visible items
 */
export async function getVisibleItemCount(section: any): Promise<number> {
    try {
        const items = await section.getVisibleItems();
        return items.length;
    } catch {
        return 0;
    }
}
