/**
 * @file src/test/ui/pages/TestElementsPage.ts
 * @description Page Object Model for the Test Elements View.
 * Encapsulates interactions with the Test Elements tree view.
 */

import { WebDriver, TreeItem, ViewSection } from "vscode-extension-tester";
import { BasePage } from "./BasePage";

export class TestElementsPage extends BasePage {
    private sectionTitle = "Test Elements";

    constructor(driver: WebDriver) {
        super(driver);
    }

    /**
     * Finds the Test Elements section in the sidebar.
     * @param content - The sidebar content object
     */
    public async getSection(content: any): Promise<ViewSection | null> {
        return await this.findSection(content, this.sectionTitle);
    }

    /**
     * Gets the title of the Test Elements section.
     * @param section - The Test Elements view section
     */
    public async getTitle(section: ViewSection): Promise<string | null> {
        return await this.getSectionTitle(section);
    }

    /**
     * Finds a tree item in the Test Elements view.
     * @param section - The Test Elements view section
     * @param label - The label of the item to find
     */
    public async getItem(section: ViewSection, label: string): Promise<TreeItem | null> {
        const items = await section.getVisibleItems();
        const found = await this.findInItems(items as TreeItem[], label);
        if (found) {
            return found;
        }

        // Fallback: expand collapsed parents to find nested items that are not yet materialized.
        return await this.findTreeItemWithExpansion(items as TreeItem[], label);
    }

    private async findInItems(items: TreeItem[], targetLabel: string): Promise<TreeItem | null> {
        for (const item of items) {
            try {
                const label = await item.getLabel();
                if (label === targetLabel || label.includes(targetLabel)) {
                    return item;
                }
            } catch {
                // Ignore stale items and continue.
            }
        }

        return null;
    }

    private async withTimeout<T>(operation: () => Promise<T>, timeoutMs: number = 2500): Promise<T | null> {
        return await Promise.race([
            operation(),
            new Promise<null>((resolve) => {
                setTimeout(() => resolve(null), timeoutMs);
            })
        ]);
    }

    /**
     * Searches with bounded expansion depth to discover nested items without traversing huge trees.
     */
    private async findTreeItemWithExpansion(items: TreeItem[], targetLabel: string): Promise<TreeItem | null> {
        const maxDepth = 2;
        return await this.findTreeItemWithExpansionAtDepth(items, targetLabel, 0, maxDepth);
    }

    private async findTreeItemWithExpansionAtDepth(
        items: TreeItem[],
        targetLabel: string,
        currentDepth: number,
        maxDepth: number
    ): Promise<TreeItem | null> {
        for (const item of items) {
            try {
                const label = await item.getLabel();
                if (label === targetLabel || label.includes(targetLabel)) {
                    return item;
                }

                if (currentDepth >= maxDepth) {
                    continue;
                }

                const hasChildren = await this.withTimeout(() => item.hasChildren());
                if (!hasChildren) {
                    continue;
                }

                const isExpanded = await this.withTimeout(() => item.isExpanded());
                if (isExpanded === null) {
                    continue;
                }

                if (!isExpanded) {
                    const expanded = await this.withTimeout(async () => {
                        await item.expand();
                        return true;
                    });
                    if (!expanded) {
                        continue;
                    }
                }

                const children = await this.withTimeout(() => item.getChildren());
                if (!children || children.length === 0) {
                    continue;
                }

                const found = await this.findTreeItemWithExpansionAtDepth(
                    children,
                    targetLabel,
                    currentDepth + 1,
                    maxDepth
                );
                if (found) {
                    return found;
                }
            } catch {
                // Ignore stale/missing tree items and continue searching.
            }
        }

        return null;
    }

    /**
     * Clicks the "Create Resource" button on a subdivision tree item.
     * Note: "Create Resource" is a tree item action button, not a toolbar action.
     * @param item - The subdivision tree item that should have the "Create Resource" button
     * @param itemLabel - Optional pre-fetched label to avoid stale element issues
     */
    public async clickCreateResource(item: TreeItem, itemLabel?: string): Promise<boolean> {
        // Import the utility function to avoid circular dependencies
        const { clickCreateResourceButton } = await import("../utils/testUtils");
        return await clickCreateResourceButton(item, this.driver, itemLabel);
    }

    /**
     * Clicks the "Open Resource" button on a tree item.
     * @param item - The tree item
     * @return True if the action was successful, false otherwise
     */
    public async clickOpenResource(item: TreeItem): Promise<boolean> {
        return await this.clickTreeItemAction(item, "Open Resource");
    }
}
