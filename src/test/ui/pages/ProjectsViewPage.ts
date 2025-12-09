/**
 * @file src/test/ui/pages/ProjectsViewPage.ts
 * @description Page Object Model for the Projects View.
 * Encapsulates interactions with the Projects tree view, including finding items, expanding nodes, and navigation.
 */

import { WebDriver, TreeItem, ViewSection } from "vscode-extension-tester";
import { applySlowMotion } from "../utils/testUtils";
import { waitForTreeItemChildren } from "../utils/treeViewUtils";
import { getTestLogger } from "../utils/testLogger";
import { BasePage } from "./BasePage";

export class ProjectsViewPage extends BasePage {
    private sectionTitle = "Projects";

    constructor(driver: WebDriver) {
        super(driver);
    }

    /**
     * Checks if the Projects view is visible.
     */
    public async isProjectsViewVisible(): Promise<boolean> {
        const { SideBarView } = await import("vscode-extension-tester");
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        const section = await this.getSection(content);
        return section !== null;
    }

    /**
     * Finds the Projects section in the sidebar.
     * @param content - The sidebar content object
     */
    public async getSection(content: any): Promise<ViewSection | null> {
        return await this.findSection(content, this.sectionTitle);
    }

    /**
     * Finds a specific project in the tree.
     * @param section - The Projects view section
     * @param projectName - The name of the project to find
     */
    public async getProject(section: ViewSection, projectName: string): Promise<TreeItem | undefined> {
        const items = await section.getVisibleItems();
        // Use exact match to avoid matching similar project names
        return await this.findTreeItem(items as TreeItem[], projectName, true);
    }

    /**
     * Expands a project and finds a specific version (TOV).
     * @param projectItem - The project tree item
     * @param versionName - The name of the version to find
     */
    public async getVersion(projectItem: TreeItem, versionName: string): Promise<TreeItem | undefined> {
        await this.expandItem(projectItem);
        await waitForTreeItemChildren(projectItem, this.driver);

        const children = await projectItem.getChildren();
        for (const child of children) {
            const label = await child.getLabel();
            if (label === versionName) {
                return child;
            }
        }
        return undefined;
    }

    /**
     * Expands a version and finds a specific cycle.
     * @param versionItem - The version tree item
     * @param cycleName - The name of the cycle to find
     */
    public async getCycle(versionItem: TreeItem, cycleName: string): Promise<TreeItem | undefined> {
        await this.expandItem(versionItem);
        await waitForTreeItemChildren(versionItem, this.driver);

        const children = await versionItem.getChildren();
        for (const child of children) {
            const label = await child.getLabel();
            if (label === cycleName) {
                return child;
            }
        }
        return undefined;
    }

    /**
     * Recursively expands all collapsible tree items in a tree section.
     * @param items - Array of tree items to expand
     */
    public async expandAllTreeItems(items: TreeItem[]): Promise<number> {
        let expandedCount = 0;
        const logger = getTestLogger();

        for (const item of items) {
            try {
                const hasChildren = await item.hasChildren();
                const isExpanded = await item.isExpanded();

                if (hasChildren && !isExpanded) {
                    await item.expand();
                    await applySlowMotion(this.driver);

                    const expanded = await item.isExpanded();
                    if (expanded) {
                        expandedCount++;

                        // Recursively expand children
                        const children = await item.getChildren();
                        if (children.length > 0) {
                            expandedCount += await this.expandAllTreeItems(children);
                        }
                    }
                } else if (hasChildren && isExpanded) {
                    // Already expanded, check children
                    const children = await item.getChildren();
                    if (children.length > 0) {
                        expandedCount += await this.expandAllTreeItems(children);
                    }
                }
            } catch (error) {
                logger.warn("ProjectsViewPage", `Error expanding item: ${error}`);
            }
        }

        return expandedCount;
    }
}
