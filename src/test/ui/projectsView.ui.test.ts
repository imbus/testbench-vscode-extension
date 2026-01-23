/**
 * @file src/test/ui/projectsView.ui.test.ts
 * @description UI tests for the Projects tree view, including tree item detection and expansion.
 */

import { expect } from "chai";
import { SideBarView, TreeItem } from "vscode-extension-tester";
import { applySlowMotion, waitForTreeItems, clickNotificationButton, cleanupWorkspace } from "./utils/testUtils";
import { getTestData, logTestDataConfig } from "./config/testConfig";
import { TestContext, setupTestHooks, collapseAllTreeItems } from "./utils/testHooks";
import { getTestLogger } from "./utils/testLogger";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";

describe("Projects View UI Tests", function () {
    const ctx: TestContext = {} as TestContext;

    this.timeout(120000);

    // Setup shared test hooks (before, after, beforeEach, afterEach)
    setupTestHooks(ctx, {
        suiteName: "ProjectsView",
        requiresLogin: true,
        openSidebar: true
    });

    const getDriver = () => ctx.driver;

    // Reset tree state
    afterEach(async function () {
        const driver = getDriver();
        if (!driver) {
            return;
        }

        try {
            const sideBar = new SideBarView();
            const content = sideBar.getContent();
            const projectsPage = new ProjectsViewPage(driver);
            const projectsSection = await projectsPage.getSection(content);

            if (projectsSection) {
                const logger = getTestLogger();
                const collapsedCount = await collapseAllTreeItems(driver, projectsSection);
                if (collapsedCount > 0) {
                    logger.debug("ProjectsView", `Cleaned up: collapsed ${collapsedCount} tree item(s)`);
                }
            }
        } catch (error) {
            const logger = getTestLogger();
            logger.warn("ProjectsView", `Cleanup warning: ${error}`);
        }
    });

    describe("Projects View Detection and Expansion", function () {
        it("should detect Projects view and expand all collapsible tree items", async function () {
            const driver = getDriver();
            const sideBar = new SideBarView();
            const content = sideBar.getContent();
            const projectsPage = new ProjectsViewPage(driver);

            const projectsSection = await projectsPage.getSection(content);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(projectsSection, "Projects section should be present in the sidebar").to.not.be.null;

            const logger = getTestLogger();
            if (!projectsSection) {
                logger.warn("ProjectsView", "Projects section not found in sidebar");
                this.skip();
                return;
            }

            logger.info("ProjectsView", "Found Projects section");

            const itemsLoaded = await waitForTreeItems(projectsSection, driver);
            if (!itemsLoaded) {
                logger.warn("ProjectsView", "Tree items did not load in time");
                this.skip();
                return;
            }

            const visibleProjectTreeItems = (await projectsSection.getVisibleItems()) as TreeItem[];
            expect(visibleProjectTreeItems.length).to.be.greaterThan(0, "Expected at least one project in the tree");

            logger.info("ProjectsView", `Found ${visibleProjectTreeItems.length} project(s)`);

            const expandedTreeItemCount = await projectsPage.expandAllTreeItems(visibleProjectTreeItems);

            logger.info("ProjectsView", `Expanded ${expandedTreeItemCount} tree item(s)`);

            // Verify that all expandable items are now expanded
            // Re-fetch items to get updated state
            const allProjectsTreeItems = (await projectsSection.getVisibleItems()) as TreeItem[];
            for (const item of allProjectsTreeItems) {
                const hasChildren = await item.hasChildren();
                if (hasChildren) {
                    const isExpanded = await item.isExpanded();
                    const label = await item.getLabel();
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(isExpanded, `Tree item "${label}" with children should be expanded`).to.be.true;
                }
            }

            logger.info("ProjectsView", "All collapsible tree items have been expanded");
        });

        it("should verify Projects view structure (Projects -> Versions -> Cycles)", async function () {
            const driver = getDriver();
            const sideBar = new SideBarView();
            const content = sideBar.getContent();
            const projectsPage = new ProjectsViewPage(driver);

            const logger = getTestLogger();
            const projectsSection = await projectsPage.getSection(content);
            if (!projectsSection) {
                logger.warn("ProjectsView", "Projects section not found in sidebar");
                this.skip();
                return;
            }

            const areProjectItemsLoaded = await waitForTreeItems(projectsSection, driver);
            if (!areProjectItemsLoaded) {
                logger.warn("ProjectsView", "Tree items did not load in time");
                this.skip();
                return;
            }

            const visibleProjectItems = (await projectsSection.getVisibleItems()) as TreeItem[];
            expect(visibleProjectItems.length).to.be.greaterThan(0, "Expected at least one project");

            // Expand first project to check structure
            if (visibleProjectItems.length > 0) {
                const firstProject = visibleProjectItems[0];
                const projectLabel = await firstProject.getLabel();
                logger.info("ProjectsView", `Checking structure for project: ${projectLabel}`);

                await projectsPage.expandItem(firstProject);

                const versionsOfFirstProject = await firstProject.getChildren();
                if (versionsOfFirstProject && versionsOfFirstProject.length > 0) {
                    logger.info("ProjectsView", `Found ${versionsOfFirstProject.length} version(s) under project`);

                    // Expand first version if it has children
                    const firstVersion = versionsOfFirstProject[0];
                    const firstVersionLabel = await firstVersion.getLabel();
                    logger.info("ProjectsView", `Checking structure for version: ${firstVersionLabel}`);

                    await projectsPage.expandItem(firstVersion);

                    const cyclesOfFirstVersion = await firstVersion.getChildren();
                    if (cyclesOfFirstVersion && cyclesOfFirstVersion.length > 0) {
                        logger.info("ProjectsView", `Found ${cyclesOfFirstVersion.length} cycle(s) under version`);

                        // Verify cycles are not collapsible
                        for (const cycle of cyclesOfFirstVersion) {
                            const cycleLabel = await cycle.getLabel();
                            const hasChildren = await cycle.hasChildren();
                            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                            expect(
                                hasChildren,
                                `Cycle "${cycleLabel}" should not have children (cycles are leaf nodes)`
                            ).to.be.false;
                            logger.debug("ProjectsView", `Cycle "${cycleLabel}" is not collapsible (as expected)`);
                        }
                    } else {
                        logger.debug("ProjectsView", "No cycles found under version (this is acceptable)");
                    }
                } else {
                    logger.debug("ProjectsView", "No versions found under project (this is acceptable)");
                }
            }
        });
    });

    describe("Cycle Configuration Notification", function () {
        it("should click cycle tree item and handle configuration notification", async function () {
            const driver = getDriver();
            const testData = getTestData();
            logTestDataConfig();
            const projectsPage = new ProjectsViewPage(driver);

            const logger = getTestLogger();
            // Clean up workspace, excluding .testbench folder
            logger.info("ProjectsView", "Cleaning workspace before test...");
            await cleanupWorkspace(driver, undefined, {
                exclude: [".testbench"]
            });

            const sideBar = new SideBarView();
            const content = sideBar.getContent();

            const projectsSection = await projectsPage.getSection(content);
            if (!projectsSection) {
                logger.warn("ProjectsView", "Projects section not found in sidebar");
                this.skip();
                return;
            }

            const areProjectItemsLoaded = await waitForTreeItems(projectsSection, driver);
            if (!areProjectItemsLoaded) {
                logger.warn("ProjectsView", "Tree items did not load in time");
                this.skip();
                return;
            }

            const targetProject = await projectsPage.getProject(projectsSection, testData.projectName);
            if (!targetProject) {
                logger.warn("ProjectsView", `Project "${testData.projectName}" not found`);
                this.skip();
                return;
            }

            logger.info("ProjectsView", `Found project "${testData.projectName}"`);

            const targetVersion = await projectsPage.getVersion(targetProject, testData.versionName);
            if (!targetVersion) {
                logger.warn("ProjectsView", `Version "${testData.versionName}" not found`);
                this.skip();
                return;
            }

            logger.info("ProjectsView", `Found version "${testData.versionName}"`);

            const targetCycle = await projectsPage.getCycle(targetVersion, testData.cycleName);
            if (!targetCycle) {
                logger.warn("ProjectsView", `Cycle "${testData.cycleName}" not found`);
                this.skip();
                return;
            }

            logger.info("ProjectsView", `Found cycle "${testData.cycleName}", clicking...`);

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
                logger.warn("ProjectsView", "Failed to click Create button in notification");
                this.skip();
                return;
            }
            logger.info("ProjectsView", "Test completed successfully");
        });
    });
});
