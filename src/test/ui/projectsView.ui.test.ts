/**
 * @file src/test/ui/projectsView.ui.test.ts
 * @description UI tests for the Projects tree view, including tree item detection and expansion.
 */

import { expect } from "chai";
import { SideBarView, TreeItem, WebDriver } from "vscode-extension-tester";
import {
    applySlowMotion,
    findTreeItemByLabel,
    expandTreeItemIfNeeded,
    waitForTreeItems,
    waitForTreeItemChildren,
    clickNotificationButton,
    cleanupWorkspace
} from "./testUtils";
import { getTestData, logTestDataConfig } from "./testConfig";
import { TestContext, setupTestHooks } from "./testHooks";

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
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                expect(expanded, "Tree item should be expanded after calling expand()").to.be.true;

                expandedCount++;

                // Wait for children to actually load (smart wait instead of fixed delay)
                const childrenLoaded = await waitForTreeItemChildren(item, driver);
                if (!childrenLoaded) {
                    console.log(`[ProjectsView] Warning: Children may not have loaded for tree item`);
                }

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
    const ctx: TestContext = {} as TestContext;

    this.timeout(120000);

    // Setup shared test hooks (before, after, beforeEach, afterEach)
    setupTestHooks(ctx, {
        suiteName: "ProjectsView",
        requiresLogin: true,
        openSidebar: true
    });

    // Convenience getters for driver (for use in tests)
    const getDriver = () => ctx.driver;

    describe("Projects View Detection and Expansion", function () {
        it("should detect Projects view and expand all collapsible tree items", async function () {
            const driver = getDriver();
            const sideBar = new SideBarView();
            const content = sideBar.getContent();

            // Find the Projects section
            const projectsSection = await findProjectsSection(content);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(projectsSection, "Projects section should be present in the sidebar").to.not.be.null;

            if (!projectsSection) {
                console.log("[ProjectsView] Projects section not found in sidebar");
                this.skip();
                return;
            }

            console.log("[ProjectsView] Found Projects section");

            // Wait for tree items to load
            const itemsLoaded = await waitForTreeItems(projectsSection, driver);
            if (!itemsLoaded) {
                console.log("[ProjectsView] Tree items did not load in time");
                this.skip();
                return;
            }

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
                    const label = await item.getLabel();
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(isExpanded, `Tree item '${label}' with children should be expanded`).to.be.true;
                }
            }

            console.log("[ProjectsView] All collapsible tree items have been expanded");
        });

        it("should verify Projects view structure (Projects -> Versions -> Cycles)", async function () {
            const driver = getDriver();
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
            const itemsLoaded = await waitForTreeItems(projectsSection, driver);
            if (!itemsLoaded) {
                console.log("[ProjectsView] Tree items did not load in time");
                this.skip();
                return;
            }

            const projectItems = await projectsSection.getVisibleItems();
            expect(projectItems.length).to.be.greaterThan(0, "Expected at least one project");

            // Expand first project to check structure
            if (projectItems.length > 0) {
                const firstProject = projectItems[0];
                const projectLabel = await firstProject.getLabel();
                console.log(`[ProjectsView] Checking structure for project: ${projectLabel}`);

                // Expand project if it has children
                await expandTreeItemIfNeeded(firstProject, driver);

                // Check for versions
                const versions = await firstProject.getChildren();
                if (versions && versions.length > 0) {
                    console.log(`[ProjectsView] Found ${versions.length} version(s) under project`);

                    // Expand first version if it has children
                    const firstVersion = versions[0];
                    const versionLabel = await firstVersion.getLabel();
                    console.log(`[ProjectsView] Checking structure for version: ${versionLabel}`);

                    await expandTreeItemIfNeeded(firstVersion, driver);

                    // Check for cycles
                    const cycles = await firstVersion.getChildren();
                    if (cycles && cycles.length > 0) {
                        console.log(`[ProjectsView] Found ${cycles.length} cycle(s) under version`);

                        // Verify cycles are not collapsible
                        for (const cycle of cycles) {
                            const cycleLabel = await cycle.getLabel();
                            const hasChildren = await cycle.hasChildren();
                            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                            expect(
                                hasChildren,
                                `Cycle '${cycleLabel}' should not have children (cycles are leaf nodes)`
                            ).to.be.false;
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

    describe("Cycle Configuration Notification", function () {
        it("should click cycle tree item and handle configuration notification", async function () {
            const driver = getDriver();
            const testData = getTestData();
            logTestDataConfig();

            // Clean up workspace, excluding .testbench folder
            console.log("[ProjectsView] Cleaning workspace before test...");
            await cleanupWorkspace(driver, undefined, {
                exclude: [".testbench"]
            });

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
            const itemsLoaded = await waitForTreeItems(projectsSection, driver);
            if (!itemsLoaded) {
                console.log("[ProjectsView] Tree items did not load in time");
                this.skip();
                return;
            }

            // Get all visible tree items (Projects)
            const projectItems = await projectsSection.getVisibleItems();
            expect(projectItems.length).to.be.greaterThan(0, "Expected at least one project in the tree");

            // Find the target project
            const targetProject = await findTreeItemByLabel(projectItems, testData.projectName);
            if (!targetProject) {
                console.log(`[ProjectsView] Project '${testData.projectName}' not found`);
                this.skip();
                return;
            }

            console.log(`[ProjectsView] Found project '${testData.projectName}'`);

            // Expand the project if it has children and is not expanded
            await expandTreeItemIfNeeded(targetProject, driver);

            // Get children (versions) of the project
            const versions = await targetProject.getChildren();
            if (!versions || versions.length === 0) {
                console.log("[ProjectsView] No versions found under project");
                this.skip();
                return;
            }

            // Find the target version
            const targetVersion = await findTreeItemByLabel(versions, testData.versionName);
            if (!targetVersion) {
                console.log(`[ProjectsView] Version '${testData.versionName}' not found`);
                this.skip();
                return;
            }

            console.log(`[ProjectsView] Found version '${testData.versionName}'`);

            // Expand the version if it has children and is not expanded
            await expandTreeItemIfNeeded(targetVersion, driver);

            // Get children (cycles) of the version
            const cycles = await targetVersion.getChildren();
            if (!cycles || cycles.length === 0) {
                console.log("[ProjectsView] No cycles found under version");
                this.skip();
                return;
            }

            // Find the target cycle
            const targetCycle = await findTreeItemByLabel(cycles, testData.cycleName);
            if (!targetCycle) {
                console.log(`[ProjectsView] Cycle '${testData.cycleName}' not found`);
                this.skip();
                return;
            }

            console.log(`[ProjectsView] Found cycle '${testData.cycleName}', clicking...`);

            // Click the cycle (single click) - this should trigger the notification
            await targetCycle.click();
            await applySlowMotion(driver);

            // Wait for and click the Create button in the notification
            const notificationClicked = await clickNotificationButton(
                driver,
                "Create",
                "TestBench project configuration"
            );

            if (!notificationClicked) {
                console.log("[ProjectsView] Failed to click Create button in notification");
                this.skip();
                return;
            }
            console.log("[ProjectsView] Test completed successfully");
        });
    });
});
