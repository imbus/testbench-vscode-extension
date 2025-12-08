/**
 * @file src/test/ui/pages/BasePage.ts
 * @description Base Page Object containing common methods for all views.
 */

import { WebDriver, ViewSection, TreeItem, By } from "vscode-extension-tester";
import { logger } from "../testLogger";
import { applySlowMotion } from "../testUtils";

export abstract class BasePage {
    protected driver: WebDriver;

    constructor(driver: WebDriver) {
        this.driver = driver;
    }

    /**
     * Finds a section in the sidebar by title.
     * @param content - The sidebar content object
     * @param title - The title of the section to find
     */
    protected async findSection(content: any, title: string): Promise<ViewSection | null> {
        try {
            const sections = await content.getSections();
            for (const section of sections) {
                const sectionTitle = await section.getTitle();
                if (sectionTitle.includes(title)) {
                    return section;
                }
            }
            return null;
        } catch (error) {
            logger.error("BasePage", `Error finding section "${title}"`, error);
            return null;
        }
    }

    /**
     * Gets the title of a section.
     * @param section - The view section
     */
    public async getSectionTitle(section: ViewSection): Promise<string> {
        try {
            return await section.getTitle();
        } catch (error) {
            logger.error("BasePage", "Error getting section title", error);
            return "";
        }
    }

    /**
     * Clicks a toolbar action button in a section.
     * @param section - The view section
     * @param title - The title/tooltip of the action
     */
    public async clickToolbarAction(section: ViewSection, title: string): Promise<boolean> {
        try {
            const actions = await section.getActions();
            logger.debug("BasePage", `Found ${actions.length} toolbar actions`);

            for (let i = 0; i < actions.length; i++) {
                const action = actions[i];
                let actionTitle: string | null = null;

                try {
                    // Try getTitle() first (most common method)
                    if (typeof (action as any).getTitle === "function") {
                        actionTitle = await (action as any).getTitle();
                    }
                    // Try getLabel() as fallback
                    else if (typeof (action as any).getLabel === "function") {
                        actionTitle = await (action as any).getLabel();
                    }
                    // Try getText() as another fallback
                    else if (typeof (action as any).getText === "function") {
                        actionTitle = await (action as any).getText();
                    }
                    // Try getting title attribute
                    else if (typeof (action as any).getAttribute === "function") {
                        actionTitle = await (action as any).getAttribute("title");
                        if (!actionTitle) {
                            actionTitle = await (action as any).getAttribute("aria-label");
                        }
                    }

                    logger.debug("BasePage", `Action [${i}] title: "${actionTitle}"`);

                    if (actionTitle && actionTitle.includes(title)) {
                        logger.debug("BasePage", `Found matching action: "${actionTitle}", clicking...`);
                        await action.click();
                        await applySlowMotion(this.driver);
                        return true;
                    }
                } catch (actionError) {
                    // Log but continue to next action
                    logger.debug("BasePage", `Error getting title for action [${i}]: ${actionError}`);
                    continue;
                }
            }

            logger.warn("BasePage", `Toolbar action "${title}" not found among ${actions.length} actions`);
            return false;
        } catch (error) {
            logger.error("BasePage", `Error clicking toolbar action "${title}"`, error);
            return false;
        }
    }

    /**
     * Finds a tree item by label in a list of items (recursive).
     * @param items - The list of tree items
     * @param targetLabel - The label to search for
     * @param exactMatch - Whether to match exactly or partially
     */
    protected async findTreeItem(
        items: TreeItem[],
        targetLabel: string,
        exactMatch: boolean = false
    ): Promise<TreeItem | undefined> {
        for (const item of items) {
            try {
                const label = await item.getLabel();
                const matches = exactMatch
                    ? label === targetLabel
                    : label === targetLabel || label.includes(targetLabel);

                if (matches) {
                    return item;
                }

                // If item has children, search recursively
                if (await item.hasChildren()) {
                    const children = await item.getChildren();
                    if (children && children.length > 0) {
                        const found = await this.findTreeItem(children, targetLabel, exactMatch);
                        if (found) {
                            return found;
                        }
                    }
                }
            } catch (error) {
                // Log error but continue searching
                logger.debug("BasePage", `Error checking tree item: ${error}`);
            }
        }
        return undefined;
    }

    /**
     * Clicks an action button on a tree item.
     * @param item - The tree item
     * @param buttonLabel - The label/tooltip of the button
     */
    public async clickTreeItemAction(item: TreeItem, buttonLabel: string): Promise<boolean> {
        try {
            await this.driver.switchTo().defaultContent();

            // We need to hover over the item to make actions visible
            // Sometimes clicking selects it and shows actions
            await item.click();

            // Find action buttons within the tree item row
            const actionButtons = await item.findElements(By.className("action-label"));

            for (const btn of actionButtons) {
                const title = await btn.getAttribute("title");
                const ariaLabel = await btn.getAttribute("aria-label");

                if ((title && title.includes(buttonLabel)) || (ariaLabel && ariaLabel.includes(buttonLabel))) {
                    await btn.click();
                    await applySlowMotion(this.driver);
                    return true;
                }
            }

            return false;
        } catch (error) {
            logger.error("BasePage", `Error clicking tree item action "${buttonLabel}"`, error);
            return false;
        }
    }

    /**
     * Expands a tree item if it is collapsed.
     * @param item - The tree item to expand
     */
    public async expandItem(item: TreeItem): Promise<void> {
        try {
            if ((await item.hasChildren()) && !(await item.isExpanded())) {
                await item.expand();
                await applySlowMotion(this.driver);
            }
        } catch (error) {
            logger.error("BasePage", "Error expanding item", error);
        }
    }
}
