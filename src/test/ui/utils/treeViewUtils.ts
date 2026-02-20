/**
 * @file src/test/ui/treeViewUtils.ts
 * @description Shared utilities for tree view operations across Projects, Test Themes, and Test Elements views.
 * Provides functions for tree structure analysis, navigation, and item finding.
 */

import { TreeItem, WebDriver, ViewSection, By, SideBarView } from "vscode-extension-tester";
import { getTestLogger } from "./testLogger";
import { applySlowMotion, waitForTreeItems, UITimeouts, waitForCondition } from "./testUtils";

const logger = getTestLogger();

/**
 * Represents the hierarchy level of a tree item.
 */
export enum TreeItemLevel {
    /** Root level - top-level item with no parent in visible tree */
    ROOT = "root",
    /** Middle level - nested item with both parent and children */
    MIDDLE = "middle",
    /** Leaf level - item with no children */
    LEAF = "leaf"
}

/**
 * Analysis result of tree structure.
 */
export interface TreeStructureAnalysis {
    /** Whether root-level items exist */
    hasRoot: boolean;
    /** Whether middle-level items exist */
    hasMiddle: boolean;
    /** Whether leaf items exist */
    hasLeaf: boolean;
    /** Total number of root items */
    totalItems: number;
}

/**
 * Analyzes the tree structure to determine which hierarchy levels are available.
 * Works with any tree view (Projects, Test Themes, Test Elements).
 *
 * @param section - The view section to analyze
 * @param driver - The WebDriver instance
 * @param viewName - Optional name of the view (for logging purposes)
 * @returns Promise<TreeStructureAnalysis> - Analysis of available levels
 */
export async function analyzeTreeStructure(
    section: ViewSection,
    driver: WebDriver,
    viewName: string = "Tree View"
): Promise<TreeStructureAnalysis> {
    await waitForTreeItems(section, driver);
    const allItems = await section.getVisibleItems();

    if (allItems.length === 0) {
        logger.warn("TreeAnalysis", `No items found in ${viewName}`);
        return { hasRoot: false, hasMiddle: false, hasLeaf: false, totalItems: 0 };
    }

    const analysis: TreeStructureAnalysis = {
        hasRoot: false,
        hasMiddle: false,
        hasLeaf: false,
        totalItems: allItems.length
    };

    if (allItems.length > 0) {
        analysis.hasRoot = true;
    }

    const checkItemRecursive = async (items: TreeItem[], depth: number = 0): Promise<void> => {
        for (const item of items) {
            try {
                const hasChildren = await item.hasChildren();

                if (hasChildren) {
                    if (depth > 0) {
                        analysis.hasMiddle = true;
                    }

                    const isExpanded = await item.isExpanded();
                    if (!isExpanded) {
                        await item.expand();
                        await applySlowMotion(driver);
                        await waitForTreeItems(section, driver);
                    }

                    const children = await item.getChildren();
                    if (children.length > 0) {
                        await checkItemRecursive(children, depth + 1);
                    }
                } else {
                    analysis.hasLeaf = true;
                }
            } catch (error) {
                logger.debug("TreeAnalysis", `Error analyzing item: ${error}`);
                continue;
            }
        }
    };

    const rootItems = allItems as TreeItem[];
    await checkItemRecursive(rootItems, 0);

    logger.info(
        "TreeAnalysis",
        `${viewName} structure analysis: Root=${analysis.hasRoot}, Middle=${analysis.hasMiddle}, Leaf=${analysis.hasLeaf}, Total=${analysis.totalItems}`
    );

    return analysis;
}

/**
 * Logs the tree structure for debugging purposes.
 * Works with any tree view (Projects, Test Themes, Test Elements).
 *
 * @param section - The view section to log
 * @param driver - The WebDriver instance
 * @param viewName - Name of the view (for logging purposes)
 */
export async function logTreeStructure(
    section: ViewSection,
    driver: WebDriver,
    viewName: string = "Tree View"
): Promise<void> {
    await waitForTreeItems(section, driver);
    const allItems = await section.getVisibleItems();

    if (allItems.length === 0) {
        logger.info("TreeStructure", `${viewName} is empty - no items to log`);
        return;
    }

    logger.info("TreeStructure", `\n=== ${viewName} Tree Structure (${allItems.length} root items) ===`);

    const logItemRecursive = async (item: TreeItem, prefix: string = "", depth: number = 0): Promise<void> => {
        try {
            const label = await item.getLabel();
            const hasChildren = await item.hasChildren();
            const icon = hasChildren ? "📁" : "📄";
            logger.info("TreeStructure", `${prefix}${icon} ${label}${hasChildren ? "" : " (leaf)"}`);

            if (hasChildren) {
                const isExpanded = await item.isExpanded();
                if (!isExpanded) {
                    await item.expand();
                    await applySlowMotion(driver);
                    await waitForTreeItems(section, driver);
                }

                const children = await item.getChildren();
                const childPrefix = prefix + (depth === 0 ? "  " : "│  ");
                const lastChildPrefix = prefix + (depth === 0 ? "  " : "   ");

                for (let i = 0; i < children.length; i++) {
                    const isLast = i === children.length - 1;
                    const currentPrefix = isLast ? lastChildPrefix : childPrefix;
                    await logItemRecursive(children[i], currentPrefix, depth + 1);
                }
            }
        } catch (error) {
            logger.debug("TreeStructure", `Error logging item: ${error}`);
        }
    };

    const rootItems = allItems as TreeItem[];
    for (let i = 0; i < rootItems.length; i++) {
        const isLast = i === rootItems.length - 1;
        const prefix = isLast ? "└─ " : "├─ ";
        await logItemRecursive(rootItems[i], prefix, 0);
    }

    logger.info("TreeStructure", `=== End of ${viewName} Tree Structure ===\n`);
}

/**
 * Finds a root-level item (top-level item with no parent in visible tree).
 * Works with any tree view.
 *
 * @param section - The view section
 * @param driver - The WebDriver instance
 * @param specificName - Optional specific name to find, otherwise returns first root item
 * @returns Promise<TreeItem | null> - The root item or null if not found
 */
export async function findRootItem(
    section: ViewSection,
    driver: WebDriver,
    specificName?: string
): Promise<TreeItem | null> {
    await waitForTreeItems(section, driver);
    const allItems = await section.getVisibleItems();

    for (const item of allItems) {
        try {
            const label = await (item as TreeItem).getLabel();
            if (specificName) {
                if (label === specificName) {
                    logger.info("TreeNavigation", `Found root item: "${label}"`);
                    return item as TreeItem;
                }
            } else {
                logger.info("TreeNavigation", `Using first root item: "${label}"`);
                return item as TreeItem;
            }
        } catch (error) {
            logger.debug("TreeNavigation", `Error checking item: ${error}`);
            continue;
        }
    }

    logger.warn("TreeNavigation", "No root item found");
    return null;
}

/**
 * Finds a middle-level item (nested item with both parent and children).
 * Works with any tree view.
 *
 * @param section - The view section
 * @param driver - The WebDriver instance
 * @param specificName - Optional specific name to find
 * @returns Promise<TreeItem | null> - The middle-level item or null if not found
 */
export async function findMiddleItem(
    section: ViewSection,
    driver: WebDriver,
    specificName?: string
): Promise<TreeItem | null> {
    await waitForTreeItems(section, driver);

    const allItems = await section.getVisibleItems();
    const rootItems: TreeItem[] = [];

    for (const item of allItems) {
        try {
            const hasChildren = await (item as TreeItem).hasChildren();
            if (hasChildren) {
                rootItems.push(item as TreeItem);
            }
        } catch {
            continue;
        }
    }

    for (const rootItem of rootItems) {
        try {
            const isExpanded = await rootItem.isExpanded();
            if (!isExpanded) {
                await rootItem.expand();
                await applySlowMotion(driver);
                await waitForTreeItems(section, driver);
            }

            const children = await rootItem.getChildren();
            for (const child of children) {
                try {
                    const label = await child.getLabel();
                    const hasChildren = await child.hasChildren();

                    if (hasChildren) {
                        if (specificName) {
                            if (label === specificName) {
                                logger.info("TreeNavigation", `Found middle item: "${label}"`);
                                return child;
                            }
                        } else {
                            logger.info("TreeNavigation", `Using first middle item: "${label}"`);
                            return child;
                        }
                    }
                } catch (error) {
                    logger.debug("TreeNavigation", `Error checking child: ${error}`);
                    continue;
                }
            }
        } catch (error) {
            logger.debug("TreeNavigation", `Error expanding root item: ${error}`);
            continue;
        }
    }

    logger.warn("TreeNavigation", "No middle-level item found");
    return null;
}

/**
 * Finds a leaf item (item with no children).
 * Works with any tree view.
 *
 * @param section - The view section
 * @param driver - The WebDriver instance
 * @param specificName - Optional specific name to find
 * @returns Promise<TreeItem | null> - The leaf item or null if not found
 */
export async function findLeafItem(
    section: ViewSection,
    driver: WebDriver,
    specificName?: string
): Promise<TreeItem | null> {
    await waitForTreeItems(section, driver);

    const findLeafRecursive = async (items: TreeItem[]): Promise<TreeItem | null> => {
        for (const item of items) {
            let itemLabel = "";
            try {
                const hasChildren = await item.hasChildren();
                itemLabel = await item.getLabel();

                if (!hasChildren) {
                    if (specificName) {
                        if (itemLabel === specificName) {
                            logger.info("TreeNavigation", `Found leaf item: "${itemLabel}"`);
                            return item;
                        }
                    } else {
                        logger.info("TreeNavigation", `Using first leaf item: "${itemLabel}"`);
                        return item;
                    }
                } else {
                    const isExpanded = await item.isExpanded();
                    if (!isExpanded) {
                        await item.expand();
                        await applySlowMotion(driver);
                        await waitForTreeItems(section, driver);
                    }

                    const children = await item.getChildren();
                    const found = await findLeafRecursive(children);
                    if (found) {
                        return found;
                    }
                }
            } catch (error) {
                logger.debug("TreeNavigation", `Error checking item "${itemLabel}": ${error}`);
                continue;
            }
        }
        return null;
    };

    const allItems = (await section.getVisibleItems()) as TreeItem[];
    return await findLeafRecursive(allItems);
}

/**
 * Finds a tree item based on the specified level and optional name.
 * Works with any tree view.
 *
 * @param section - The view section
 * @param driver - The WebDriver instance
 * @param level - The hierarchy level to search for
 * @param itemName - Optional specific item name to find
 * @returns Promise<TreeItem | null> - The found tree item or null
 */
export async function findTreeItemByLevel(
    section: ViewSection,
    driver: WebDriver,
    level: TreeItemLevel,
    itemName?: string
): Promise<TreeItem | null> {
    logger.info(
        "TreeNavigation",
        `Finding tree item at ${level} level${itemName ? ` with name "${itemName}"` : ""}...`
    );

    switch (level) {
        case TreeItemLevel.ROOT:
            return await findRootItem(section, driver, itemName);
        case TreeItemLevel.MIDDLE:
            return await findMiddleItem(section, driver, itemName);
        case TreeItemLevel.LEAF:
            return await findLeafItem(section, driver, itemName);
        default:
            logger.warn("TreeNavigation", `Unknown level: ${level}`);
            return null;
    }
}

/**
 * Checks if a scenario can be executed based on the tree structure.
 * Works with any tree view.
 *
 * @param section - The view section
 * @param driver - The WebDriver instance
 * @param level - The hierarchy level required for the scenario
 * @param viewName - Optional name of the view (for error messages)
 * @returns Promise<{ canExecute: boolean; reason?: string }> - Whether scenario can execute and reason if not
 */
export async function canExecuteScenario(
    section: ViewSection,
    driver: WebDriver,
    level: TreeItemLevel,
    viewName: string = "Tree View"
): Promise<{ canExecute: boolean; reason?: string }> {
    const analysis = await analyzeTreeStructure(section, driver, viewName);

    if (analysis.totalItems === 0) {
        return {
            canExecute: false,
            reason: `No items found in ${viewName}. Cannot execute any scenarios.`
        };
    }

    switch (level) {
        case TreeItemLevel.ROOT:
            if (!analysis.hasRoot) {
                return {
                    canExecute: false,
                    reason: `No root-level items found in ${viewName}. Cannot execute root-level scenarios.`
                };
            }
            break;
        case TreeItemLevel.MIDDLE:
            if (!analysis.hasMiddle) {
                return {
                    canExecute: false,
                    reason: `No middle-level items found in ${viewName}. The tree structure may only have root items with direct children, or only a single item. Cannot execute middle-level scenarios.`
                };
            }
            break;
        case TreeItemLevel.LEAF:
            if (!analysis.hasLeaf) {
                return {
                    canExecute: false,
                    reason: `No leaf items found in ${viewName}. All items may have children. Cannot execute leaf-level scenarios.`
                };
            }
            break;
    }

    return { canExecute: true };
}

/**
 * Finds a tree item by label, searching recursively through the tree.
 * Works with any tree view.
 *
 * @param items - Array of tree items to search
 * @param targetLabel - The label to search for
 * @param exactMatch - Whether to match exactly or use partial match (default: false)
 * @returns Promise<TreeItem | null> - The found item or null if not found
 */
export async function findTreeItemByLabel(
    items: TreeItem[],
    targetLabel: string,
    exactMatch: boolean = false
): Promise<TreeItem | null> {
    for (const item of items) {
        try {
            const label = await item.getLabel();
            const matches = exactMatch ? label === targetLabel : label === targetLabel || label.includes(targetLabel);

            if (matches) {
                return item;
            }

            // If item has children, search recursively
            if (await item.hasChildren()) {
                const children = await item.getChildren();
                if (children && children.length > 0) {
                    const found = await findTreeItemByLabel(children, targetLabel, exactMatch);
                    if (found) {
                        return found;
                    }
                }
            }
        } catch (error) {
            // Log error but continue searching
            logger.debug("TreeItem", `Error checking tree item: ${error}`);
        }
    }

    return null;
}

/**
 * Waits for a specific tree item to appear in a section, with automatic expansion.
 * Works with any tree view.
 *
 * @param driver - The WebDriver instance
 * @param sectionFinder - Function to find the target section from sidebar content
 * @param itemLabel - Label of the item to find
 * @param timeout - Maximum time to wait (default: UITimeouts.LONG)
 * @returns Promise<TreeItem | null> - The found item or null if not found
 */
export async function waitForTreeItem(
    driver: WebDriver,
    sectionFinder: (content: any) => Promise<any | null>,
    itemLabel: string,
    timeout: number = UITimeouts.LONG
): Promise<TreeItem | null> {
    let foundItem: TreeItem | null = null;

    await waitForCondition(
        driver,
        async () => {
            try {
                const sideBar = new SideBarView();
                const content = sideBar.getContent();
                const section = await sectionFinder(content);

                if (!section) {
                    return false;
                }

                const items = await section.getVisibleItems();

                foundItem = await findTreeItemByLabel(items, itemLabel);
                if (foundItem) {
                    return true;
                }

                // If not found, expand items that have children
                for (const item of items) {
                    try {
                        if (await item.hasChildren()) {
                            await expandTreeItemIfNeeded(item, driver);
                        }
                    } catch {
                        // Continue expanding other items
                    }
                }

                const expandedItems = await section.getVisibleItems();
                foundItem = await findTreeItemByLabel(expandedItems, itemLabel);
                return foundItem !== null;
            } catch {
                return false;
            }
        },
        timeout,
        500,
        `tree item '${itemLabel}' to appear`
    );

    return foundItem;
}

/**
 * Waits for tree item children to be loaded after expansion.
 * Checks that the item is expanded and children are available.
 * Works with any tree view.
 *
 * @param item - The tree item to wait for
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if children are loaded, false if timeout
 */
export async function waitForTreeItemChildren(
    item: TreeItem,
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    try {
        await driver.wait(
            async () => {
                try {
                    // Check that item is expanded
                    const isExpanded = await item.isExpanded();
                    if (!isExpanded) {
                        return false;
                    }

                    // Check that children are available.
                    // If the item reports children, wait for at least one child to appear.
                    // If it has no children, an empty array is valid.
                    const hasChildren = await item.hasChildren();
                    const children = await item.getChildren();
                    if (!children) {
                        return false;
                    }

                    return hasChildren ? children.length > 0 : children.length === 0;
                } catch {
                    return false;
                }
            },
            timeout,
            "Waiting for tree item children to load"
        );
        return true;
    } catch (error) {
        logger.debug("TreeItem", `Timeout waiting for children to load: ${error}`);
        return false;
    }
}

/**
 * Safely expands a tree item if it has children and is not already expanded.
 * Waits for children to load after expansion using smart wait.
 * Works with any tree view.
 *
 * @param item - The tree item to expand
 * @param driver - The WebDriver instance for slow motion
 * @returns Promise<boolean> - True if item was expanded or already expanded, false otherwise
 */
export async function expandTreeItemIfNeeded(item: TreeItem, driver: WebDriver): Promise<boolean> {
    try {
        const hasChildren = await item.hasChildren();
        if (!hasChildren) {
            return false;
        }

        const isExpanded = await item.isExpanded();
        if (isExpanded) {
            return true; // Already expanded
        }

        await item.expand();
        await applySlowMotion(driver);

        // Wait for children to actually load (smart wait instead of fixed delay)
        const childrenLoaded = await waitForTreeItemChildren(item, driver);
        if (!childrenLoaded) {
            logger.warn("TreeItem", "Children may not have loaded for tree item");
        }

        // Verify it's expanded
        const expanded = await item.isExpanded();
        return expanded;
    } catch (error) {
        logger.error("TreeItem", `Error expanding tree item: ${error}`);
        return false;
    }
}

/**
 * Double-clicks a tree item.
 * Works with any tree view.
 *
 * @param item - The tree item to double-click
 * @param driver - The WebDriver instance
 * @returns Promise<void>
 */
export async function doubleClickTreeItem(item: TreeItem, driver: WebDriver): Promise<void> {
    try {
        const element = await item.findElement(By.css(".monaco-icon-name-container"));
        await driver.actions().doubleClick(element).perform();
        await applySlowMotion(driver);
    } catch (error) {
        // Fallback: try clicking twice
        logger.warn("TreeItem", "Double-click failed, trying alternative method", error);
        try {
            await item.click();
            await driver.sleep(100);
            await item.click();
            await applySlowMotion(driver);
        } catch (fallbackError) {
            logger.error("TreeItem", "Alternative double-click also failed", fallbackError);
            throw fallbackError;
        }
    }
}

/**
 * Waits for a tree item's action button to become visible.
 * This is useful when a button only appears after expanding or interacting with a tree item.
 * Works with any tree view.
 *
 * @param item - The tree item
 * @param driver - The WebDriver instance
 * @param buttonText - The text/aria-label of the button to wait for (optional)
 * @param timeout - Maximum time to wait (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if button became visible, false if timeout
 */
export async function waitForTreeItemButton(
    item: TreeItem,
    driver: WebDriver,
    buttonText?: string,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        const itemLabel = await item.getLabel();

        await driver.wait(
            async () => {
                try {
                    // Try to find buttons near the tree item
                    const buttons = await driver.findElements(
                        By.xpath(
                            `//div[contains(@class, 'monaco-list-row')]//button[contains(@aria-label, '${buttonText || "Create"}') or contains(@title, '${buttonText || "Create"}')]`
                        )
                    );

                    // Filter buttons to find the one near our tree item
                    for (const btn of buttons) {
                        try {
                            const row = await btn.findElement(
                                By.xpath("./ancestor::div[contains(@class, 'monaco-list-row')]")
                            );
                            const rowText = await row.getText();
                            if (rowText.includes(itemLabel)) {
                                const isDisplayed = await btn.isDisplayed();
                                if (isDisplayed) {
                                    return true;
                                }
                            }
                        } catch {
                            // Continue searching
                        }
                    }

                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            `Waiting for button to become visible for tree item "${itemLabel}"`
        );
        return true;
    } catch {
        return false;
    }
}
