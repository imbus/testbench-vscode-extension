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
        const found = await this.findTreeItem(items as TreeItem[], label);
        return found || null;
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
