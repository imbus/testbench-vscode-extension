/**
 * @file src/test/ui/projectsView.ui.test.ts
 * @description UI tests for the Projects tree view, including tree item detection and expansion.
 */

import { expect } from "chai";
import { VSBrowser, WebDriver, SideBarView, EditorView, TreeItem } from "vscode-extension-tester";
import { openTestBenchSidebar, applySlowMotion, UITimeouts, ensureLoggedIn } from "./testUtils";
import { isSlowMotionEnabled, getSlowMotionDelay, hasTestCredentials } from "./testConfig";

/**
 * Recursively expands all collapsible tree items in a tree section.
 * Projects and Versions are collapsible, Cycles are not.
 *
 * @param items - Array of tree items to expand
 * @param driver - The WebDriver instance for slow motion
 * @returns Promise<number> - Total number of items expanded
 */
async function expandAllTreeItems(items: TreeItem[], driver: WebDriver): Promise<number> {
    let expandedCount = 0;

    for (const item of items) {
        try {
            const hasChildren = await item.hasChildren();
            const isExpanded = await item.isExpanded();

            if (hasChildren && !isExpanded) {
                await item.expand();
                await applySlowMotion(driver); // Visible: expanding tree item

                // Verify it's expanded
                const expanded = await item.isExpanded();
                expect(expanded).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                expandedCount++;

                // Wait a bit for children to load
                await driver.sleep(500);

                // Recursively expand children
                const children = await item.getChildren();
                if (children && children.length > 0) {
                    const childExpandedCount = await expandAllTreeItems(children, driver);
                    expandedCount += childExpandedCount;
                }
            } else if (hasChildren && isExpanded) {
                // Item is already expanded, but we should still check children
                const children = await item.getChildren();
                if (children && children.length > 0) {
                    const childExpandedCount = await expandAllTreeItems(children, driver);
                    expandedCount += childExpandedCount;
                }
            }
        } catch (error) {
            // Log error but continue with other items
            console.log(`[ProjectsView] Error expanding tree item: ${error}`);
        }
    }

    return expandedCount;
}

/**
 * Finds the Projects section in the sidebar.
 *
 * @param content - The sidebar content
 * @returns Promise<any | null> - The Projects section or null if not found
 */
async function findProjectsSection(content: any): Promise<any | null> {
    const sections = await content.getSections();

    for (const section of sections) {
        const title = await section.getTitle();
        if (title === "Projects" || title.includes("Projects")) {
            return section;
        }
    }

    return null;
}

describe("Projects View UI Tests", function () {
    let browser: VSBrowser;
    let driver: WebDriver;

    this.timeout(120000);

    before(async function () {
        browser = VSBrowser.instance;
        driver = browser.driver;
        await new EditorView().closeAllEditors();
    });

    after(async function () {
        await new EditorView().closeAllEditors();
    });

    beforeEach(async function () {
        if (isSlowMotionEnabled()) {
            console.log(`[Slow Motion] Enabled with ${getSlowMotionDelay()}ms delay`);
        } else {
            console.log("[Slow Motion] Disabled");
        }

        await openTestBenchSidebar(driver);

        // Ensure user is logged in before running Projects View tests
        if (hasTestCredentials()) {
            const loggedIn = await ensureLoggedIn(driver);
            if (!loggedIn) {
                console.log("[ProjectsView] Failed to login. Skipping tests.");
                this.skip();
            }
        } else {
            console.log("[ProjectsView] Test credentials not available. Skipping tests.");
            this.skip();
        }
    });

    describe("Projects View Detection and Expansion", function () {
        it("should detect Projects view and expand all collapsible tree items", async function () {
            const sideBar = new SideBarView();
            const content = sideBar.getContent();

            // Find the Projects section
            const projectsSection = await findProjectsSection(content);
            expect(projectsSection).to.not.be.null; // eslint-disable-line @typescript-eslint/no-unused-expressions

            if (!projectsSection) {
                console.log("[ProjectsView] Projects section not found in sidebar");
                this.skip();
                return;
            }

            console.log("[ProjectsView] Found Projects section");

            // Wait for tree items to load
            await driver.wait(
                async () => {
                    try {
                        const items = await projectsSection.getVisibleItems();
                        return items.length > 0;
                    } catch {
                        return false;
                    }
                },
                UITimeouts.LONG,
                "Waiting for Projects tree items to load"
            );

            // Get all visible tree items (Projects)
            const projectItems = await projectsSection.getVisibleItems();
            expect(projectItems.length).to.be.greaterThan(0, "Expected at least one project in the tree");

            console.log(`[ProjectsView] Found ${projectItems.length} project(s)`);

            // Expand all collapsible tree items recursively
            const expandedCount = await expandAllTreeItems(projectItems, driver);

            console.log(`[ProjectsView] Expanded ${expandedCount} tree item(s)`);

            // Verify that all expandable items are now expanded
            // Re-fetch items to get updated state
            const allItems = await projectsSection.getVisibleItems();
            for (const item of allItems) {
                const hasChildren = await item.hasChildren();
                if (hasChildren) {
                    const isExpanded = await item.isExpanded();
                    expect(isExpanded).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
                }
            }

            console.log("[ProjectsView] All collapsible tree items have been expanded");
        });

        it("should verify Projects view structure (Projects -> Versions -> Cycles)", async function () {
            const sideBar = new SideBarView();
            const content = sideBar.getContent();

            // Find the Projects section
            const projectsSection = await findProjectsSection(content);
            if (!projectsSection) {
                console.log("[ProjectsView] Projects section not found in sidebar");
                this.skip();
                return;
            }

            // Wait for tree items to load
            await driver.wait(
                async () => {
                    try {
                        const items = await projectsSection.getVisibleItems();
                        return items.length > 0;
                    } catch {
                        return false;
                    }
                },
                UITimeouts.LONG,
                "Waiting for Projects tree items to load"
            );

            const projectItems = await projectsSection.getVisibleItems();
            expect(projectItems.length).to.be.greaterThan(0, "Expected at least one project");

            // Expand first project to check structure
            if (projectItems.length > 0) {
                const firstProject = projectItems[0];
                const projectLabel = await firstProject.getLabel();
                console.log(`[ProjectsView] Checking structure for project: ${projectLabel}`);

                // Expand project if it has children
                if ((await firstProject.hasChildren()) && !(await firstProject.isExpanded())) {
                    await firstProject.expand();
                    await applySlowMotion(driver);
                    await driver.sleep(500); // Wait for versions to load
                }

                // Check for versions
                const versions = await firstProject.getChildren();
                if (versions && versions.length > 0) {
                    console.log(`[ProjectsView] Found ${versions.length} version(s) under project`);

                    // Expand first version if it has children
                    const firstVersion = versions[0];
                    const versionLabel = await firstVersion.getLabel();
                    console.log(`[ProjectsView] Checking structure for version: ${versionLabel}`);

                    if ((await firstVersion.hasChildren()) && !(await firstVersion.isExpanded())) {
                        await firstVersion.expand();
                        await applySlowMotion(driver);
                        await driver.sleep(500); // Wait for cycles to load
                    }

                    // Check for cycles
                    const cycles = await firstVersion.getChildren();
                    if (cycles && cycles.length > 0) {
                        console.log(`[ProjectsView] Found ${cycles.length} cycle(s) under version`);

                        // Verify cycles are not collapsible
                        for (const cycle of cycles) {
                            const hasChildren = await cycle.hasChildren();
                            expect(hasChildren).to.be.false; // eslint-disable-line @typescript-eslint/no-unused-expressions
                            const cycleLabel = await cycle.getLabel();
                            console.log(`[ProjectsView] Cycle '${cycleLabel}' is not collapsible (as expected)`);
                        }
                    } else {
                        console.log("[ProjectsView] No cycles found under version (this is acceptable)");
                    }
                } else {
                    console.log("[ProjectsView] No versions found under project (this is acceptable)");
                }
            }
        });
    });
});
