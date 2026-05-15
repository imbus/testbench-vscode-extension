/**
 * @file src/test/ui/pages/TestThemesPage.ts
 * @description Page Object Model for the Test Themes View.
 * Encapsulates interactions with the Test Themes tree view.
 */

import { WebDriver, TreeItem, ViewSection } from "vscode-extension-tester";
import { BasePage } from "./BasePage";

export class TestThemesPage extends BasePage {
    private sectionTitle = "Test Themes";

    constructor(driver: WebDriver) {
        super(driver);
    }

    /**
     * Checks if the Test Themes view is visible.
     */
    public async isTestThemesViewVisible(): Promise<boolean> {
        const { SideBarView } = await import("vscode-extension-tester");
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        const section = await this.getSection(content);
        return section !== null;
    }

    /**
     * Clicks the "Open Projects View" toolbar action.
     */
    public async clickOpenProjectsView(): Promise<boolean> {
        const { SideBarView } = await import("vscode-extension-tester");
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        const section = await this.getSection(content);
        if (section) {
            return await this.clickToolbarAction(section, "Open Projects View");
        }
        return false;
    }

    /**
     * Finds the Test Themes section in the sidebar.
     * @param content - The sidebar content object
     */
    public async getSection(content: any): Promise<ViewSection | null> {
        return await this.findSection(content, this.sectionTitle);
    }

    /**
     * Gets the title of the Test Themes section.
     * @param section - The Test Themes view section
     */
    public async getTitle(section: ViewSection): Promise<string | null> {
        return await this.getSectionTitle(section);
    }

    /**
     * Finds a tree item in the Test Themes view.
     * @param section - The Test Themes view section
     * @param label - The label of the item to find
     */
    public async getItem(section: ViewSection, label: string): Promise<TreeItem | null> {
        const items = await section.getVisibleItems();
        const found = await this.findTreeItem(items as TreeItem[], label);
        return found || null;
    }

    /**
     * Clicks an action button on a tree item (e.g. Generate, Upload).
     * @param item - The tree item
     * @param buttonLabel - The label/tooltip of the button
     */
    public async clickItemAction(item: TreeItem, buttonLabel: string): Promise<boolean> {
        return await this.clickTreeItemAction(item, buttonLabel);
    }
}
