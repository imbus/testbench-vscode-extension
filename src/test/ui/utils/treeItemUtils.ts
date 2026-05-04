/**
 * @file src/test/ui/utils/treeItemUtils.ts
 * @description Utilities for interacting with tree items in VS Code views.
 * Provides functions for checking action buttons, icons, and other tree item properties.
 */

import { TreeItem, By } from "vscode-extension-tester";
import { getTestLogger } from "./testLogger";
import { applySlowMotion } from "./testUtils";

const logger = getTestLogger();

/**
 * Checks if a tree item has a specific action button visible.
 * Uses the same approach as BasePage.clickTreeItemAction for consistency.
 *
 * @param item - The tree item to check
 * @param buttonName - Part of the button name to search for (case-insensitive)
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if the button exists
 */
export async function hasActionButton(item: TreeItem, buttonName: string, driver: any): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        // Click item to show action buttons (same as BasePage approach)
        await item.click();
        await driver.sleep(200);

        // Use the same approach as BasePage.clickTreeItemAction
        const actionButtons = await item.findElements(By.className("action-label"));

        for (const btn of actionButtons) {
            const title = await btn.getAttribute("title");
            const ariaLabel = await btn.getAttribute("aria-label");

            if (
                (title && title.toLowerCase().includes(buttonName.toLowerCase())) ||
                (ariaLabel && ariaLabel.toLowerCase().includes(buttonName.toLowerCase()))
            ) {
                return true;
            }
        }

        return false;
    } catch (error) {
        logger.debug("TreeItem", `Error checking action button "${buttonName}": ${error}`);
        return false;
    }
}

/**
 * Gets all action button labels for a tree item.
 *
 * @param item - The tree item
 * @param driver - The WebDriver instance
 * @returns Promise<string[]> - Array of button labels/titles
 */
export async function getActionButtonLabels(item: TreeItem, driver: any): Promise<string[]> {
    try {
        await driver.switchTo().defaultContent();
        await item.click();
        await driver.sleep(200);

        const actionButtons = await item.findElements(By.className("action-label"));
        const labels: string[] = [];

        for (const btn of actionButtons) {
            const title = await btn.getAttribute("title");
            const ariaLabel = await btn.getAttribute("aria-label");
            const label = title || ariaLabel || "";
            if (label) {
                labels.push(label);
            }
        }

        return labels;
    } catch (error) {
        logger.debug("TreeItem", `Error getting action buttons: ${error}`);
        return [];
    }
}

/**
 * Gets icon information for a tree item (class, color, etc.).
 * Useful for verifying visual indicators.
 *
 * @param item - The tree item
 * @param driver - The WebDriver instance
 * @returns Promise<IconInfo | null> - Icon information or null
 */
export interface IconInfo {
    className: string;
    color: string;
    backgroundColor: string;
}

export async function getItemIconInfo(item: TreeItem, driver: any): Promise<IconInfo | null> {
    try {
        const itemLabel = await item.getLabel();

        const iconInfoJson = await driver.executeScript(
            `
            const rows = document.querySelectorAll('.monaco-list-row');
            const targetLabel = String(arguments[0] || '');
            for (const row of rows) {
                const labelEl = row.querySelector('.label-name');
                if (labelEl && (labelEl.textContent || '').includes(targetLabel)) {
                    const icon = row.querySelector('.monaco-icon-label-container .codicon, .custom-view-tree-node-item-icon');
                    if (icon) {
                        const style = window.getComputedStyle(icon);
                        return JSON.stringify({
                            className: icon.className,
                            color: style.color,
                            backgroundColor: style.backgroundColor
                        });
                    }
                }
            }
            return null;
        `,
            itemLabel
        );

        return iconInfoJson ? JSON.parse(iconInfoJson) : null;
    } catch (error) {
        logger.debug("TreeItem", `Error getting icon info: ${error}`);
        return null;
    }
}

/**
 * Checks if a tree item has a pin icon (indicating it's active/selected).
 *
 * @param item - The tree item to check
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if the item has a pin icon
 */
export async function hasPinIcon(item: TreeItem, driver: any): Promise<boolean> {
    try {
        const itemLabel = await item.getLabel();

        const hasPin = await driver.executeScript(
            `
            const targetLabel = String(arguments[0] || '').trim();
            const rows = document.querySelectorAll('.monaco-list-row');

            for (const row of rows) {
                const labelEl = row.querySelector('.label-name');
                const rowLabel = (labelEl?.textContent || '').trim();
                if (!rowLabel || rowLabel !== targetLabel) {
                    continue;
                }

                // Current implementation decorates active items using a description marker: "📌".
                const rowText = (row.textContent || '').trim();
                if (rowText.includes('📌')) {
                    return true;
                }

                // Keep codicon-based checks for compatibility with other icon styles.
                const pinIcons = row.querySelectorAll(
                    '.codicon-pin, .codicon-pinned, [class*="codicon-pin"], .tree-item-active, [class*=" pin"]'
                );
                if (pinIcons.length > 0) {
                    return true;
                }

                const decorations = row.querySelectorAll('.monaco-icon-label-container .file-icon');
                for (const decoration of decorations) {
                    const className = decoration.className || '';
                    if (className.includes('active') || className.includes('pin')) {
                        return true;
                    }
                }
            }

            return false;
        `,
            itemLabel
        );

        return hasPin as boolean;
    } catch (error) {
        logger.debug("TreeItem", `Error checking pin icon: ${error}`);
        return false;
    }
}

/**
 * Clicks an action button on a tree item.
 * This is a utility version that doesn't require a page object.
 *
 * @param item - The tree item
 * @param buttonName - The button name to click (partial match, case-insensitive)
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if the button was clicked
 */
export async function clickActionButton(item: TreeItem, buttonName: string, driver: any): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();
        await item.click();
        await driver.sleep(200);

        const actionButtons = await item.findElements(By.className("action-label"));

        for (const btn of actionButtons) {
            const title = await btn.getAttribute("title");
            const ariaLabel = await btn.getAttribute("aria-label");

            if (
                (title && title.toLowerCase().includes(buttonName.toLowerCase())) ||
                (ariaLabel && ariaLabel.toLowerCase().includes(buttonName.toLowerCase()))
            ) {
                await btn.click();
                await applySlowMotion(driver);
                return true;
            }
        }

        logger.warn("TreeItem", `Action button "${buttonName}" not found`);
        return false;
    } catch (error) {
        logger.debug("TreeItem", `Error clicking action button "${buttonName}": ${error}`);
        return false;
    }
}

/**
 * Collects labels from tree items to avoid stale element issues.
 * Use this before iterating and clicking on items.
 *
 * @param items - Array of tree items
 * @returns Promise<string[]> - Array of labels
 */
export async function collectTreeItemLabels(items: TreeItem[]): Promise<string[]> {
    const labels: string[] = [];
    for (const item of items) {
        try {
            const label = await item.getLabel();
            labels.push(label);
        } catch {
            // Skip stale elements
        }
    }
    return labels;
}
