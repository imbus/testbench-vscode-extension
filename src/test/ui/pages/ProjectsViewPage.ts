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
     * Normalizes a tree item label by replacing multiple whitespace characters with a single space
     * and trimming leading/trailing whitespace and converting to lowercase for case-insensitive comparison.
     * @param label - The label string to normalize
     * @returns The normalized label
     */
    private normalizeLabel(label: string): string {
        return label.replace(/\s+/g, " ").trim().toLowerCase();
    }

    /**
     * Compares two labels using tolerant matching rules:
     * - Exact match after normalization is preferred.
     * - If exact match fails, checks if one label includes the other to handle cases where the UI appends metadata to labels.
     *
     * @param actual - The actual label string
     * @param expected - The expected label string
     * @returns True if the labels match, false otherwise
     */
    private isFlexibleLabelMatch(actual: string, expected: string): boolean {
        const normalizedActualLabel = this.normalizeLabel(actual);
        const normalizedExpectedLabel = this.normalizeLabel(expected);

        return (
            normalizedActualLabel === normalizedExpectedLabel ||
            normalizedActualLabel.includes(normalizedExpectedLabel) ||
            normalizedExpectedLabel.includes(normalizedActualLabel)
        );
    }

    /**
     * Finds a direct child item by label with retry support.
     *
     * First attempts exact normalized matching, then falls back to
     * tolerant matching to handle labels that include metadata.
     *
     * @param parentItem - The parent tree item whose direct children are searched
     * @param labelToFind - Target label to locate
     * @returns The matching child item, or undefined if none was found
     */
    private async findChildByLabel(parentItem: TreeItem, labelToFind: string): Promise<TreeItem | undefined> {
        const logger = getTestLogger();
        const maxAttempts = 8;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const children = await parentItem.getChildren();

            // Prefer exact normalized match first
            for (const child of children) {
                const label = await child.getLabel();
                if (this.normalizeLabel(label) === this.normalizeLabel(labelToFind)) {
                    return child;
                }
            }

            // Fall back to tolerant matching for labels with additional metadata
            for (const child of children) {
                const label = await child.getLabel();
                if (this.isFlexibleLabelMatch(label, labelToFind)) {
                    logger.debug(
                        "ProjectsViewPage",
                        `Using tolerant label match. Expected: "${labelToFind}", Actual: "${label}"`
                    );
                    return child;
                }
            }

            if (attempt < maxAttempts - 1) {
                await this.driver.sleep(500);
            }
        }

        return undefined;
    }

    /**
     * Finds a specific project in the tree.
     * Prefers exact matching first to keep selection deterministic,
     * and falls back to partial matching.
     *
     * @param section - The Projects view section
     * @param projectName - The name of the project to find
     * @returns The matching project tree item, or undefined if not found
     */
    public async getProject(section: ViewSection, projectName: string): Promise<TreeItem | undefined> {
        const items = await section.getVisibleItems();

        // Prefer exact first for deterministic behavior
        const exact = await this.findTreeItem(items as TreeItem[], projectName, true);
        if (exact) {
            return exact;
        }

        // Fallback to tolerant matching for labels with additional metadata
        return await this.findTreeItem(items as TreeItem[], projectName, false);
    }

    /**
     * Expands a project and finds a specific version (TOV).
     * @param projectItem - The project tree item
     * @param versionName - The name of the version to find
     * @returns The matching version tree item, or undefined if not found
     */
    public async getVersion(projectItem: TreeItem, versionName: string): Promise<TreeItem | undefined> {
        await this.expandItem(projectItem);
        await waitForTreeItemChildren(projectItem, this.driver);
        return await this.findChildByLabel(projectItem, versionName);
    }

    /**
     * Expands a version and finds a specific cycle.
     * @param versionItem - The version tree item
     * @param cycleName - The name of the cycle to find
     * @returns The matching cycle tree item, or undefined if not found
     */
    public async getCycle(versionItem: TreeItem, cycleName: string): Promise<TreeItem | undefined> {
        await this.expandItem(versionItem);
        await waitForTreeItemChildren(versionItem, this.driver);
        return await this.findChildByLabel(versionItem, cycleName);
    }

    /**
     * Gets the first available direct child item from a tree item.
     * Useful as a fallback when configured labels are not present.
     * @param parentItem - Parent tree item to inspect
     * @returns The first direct child item, or undefined if no child exists
     */
    public async getFirstChild(parentItem: TreeItem): Promise<TreeItem | undefined> {
        await this.expandItem(parentItem);
        await waitForTreeItemChildren(parentItem, this.driver);

        const children = await parentItem.getChildren();
        if (!children || children.length === 0) {
            return undefined;
        }

        return children[0];
    }

    /**
     * Recursively expands all collapsible tree items in a tree section.
     *
     * @param items - Array of tree items to expand
     * @returns Number of tree items that were expanded during traversal
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
