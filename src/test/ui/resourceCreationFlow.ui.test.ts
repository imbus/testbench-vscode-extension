/**
 * @file src/test/ui/resourceCreationFlow.ui.test.ts
 * @description UI tests for the resource creation flow including:
 * - Navigation to Test Themes view
 * - Selection of a Test Theme
 * - Creation of a new Test Element (Resource)
 * - Verification of the created resource
 */

import { expect } from "chai";
import { SideBarView, InputBox } from "vscode-extension-tester";
import { logger } from "./testLogger";
import {
    applySlowMotion,
    waitForTreeItems,
    doubleClickTreeItem,
    waitForProjectsView,
    waitForTestThemesAndElementsViews,
    handleCycleConfigurationPrompt,
    UITimeouts,
    waitForNotification,
    waitForTreeRefresh
} from "./testUtils";
import { getTestData, logTestDataConfig } from "./testConfig";
import { TestContext, setupTestHooks } from "./testHooks";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";
import { TestThemesPage } from "./pages/TestThemesPage";
import { TestElementsPage } from "./pages/TestElementsPage";

describe("Resource Creation Flow UI Tests", function () {
    const ctx: TestContext = {} as TestContext;

    this.timeout(300000);

    setupTestHooks(ctx, {
        suiteName: "ResourceCreationFlow",
        requiresLogin: true,
        openSidebar: true,
        timeout: 300000
    });

    const getDriver = () => ctx.driver;

    it("should navigate to a Test Theme and create a new Test Element", async function () {
        const driver = getDriver();
        const config = getTestData();
        logTestDataConfig();

        const projectsPage = new ProjectsViewPage(driver);
        const testThemesPage = new TestThemesPage(driver);
        const testElementsPage = new TestElementsPage(driver);

        // ============================================
        // Phase 1: Navigation to Test Themes View
        // ============================================
        logger.info("Phase1", "Starting Navigation to Test Themes View...");

        const sideBar = new SideBarView();
        const content = sideBar.getContent();

        // Check if we are already in the Test Themes view
        const testThemesSection = await testThemesPage.getSection(content);
        let isInTestThemesView = false;

        if (testThemesSection) {
            const title = await testThemesPage.getTitle(testThemesSection);
            if (title && title.includes(config.cycleName)) {
                isInTestThemesView = true;
                logger.info("Phase1", "Already in Test Themes View for the correct cycle.");
            } else {
                logger.info("Phase1", "In Test Themes View but wrong cycle. Navigating back to Projects View...");
                await testThemesPage.clickToolbarAction(testThemesSection, "Open Projects View");
                await waitForProjectsView(driver);
            }
        }

        if (!isInTestThemesView) {
            // Navigate from Projects View
            const projectsSection = await projectsPage.getSection(content);
            if (!projectsSection) {
                throw new Error("Projects View not found");
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                throw new Error(`Project "${config.projectName}" not found`);
            }

            const version = await projectsPage.getVersion(project, config.versionName);
            if (!version) {
                throw new Error(`Version "${config.versionName}" not found`);
            }

            const cycle = await projectsPage.getCycle(version, config.cycleName);
            if (!cycle) {
                throw new Error(`Cycle "${config.cycleName}" not found`);
            }

            await handleCycleConfigurationPrompt(
                cycle,
                driver,
                config.projectName,
                config.versionName,
                projectsSection,
                project,
                version
            );

            // Re-fetch cycle after potential refresh
            const cycleToClick = (await projectsPage.getCycle(version, config.cycleName)) || cycle;
            await doubleClickTreeItem(cycleToClick, driver);

            const viewsAppeared = await waitForTestThemesAndElementsViews(driver);
            if (!viewsAppeared) {
                throw new Error("Test Themes view did not appear after double-clicking cycle");
            }
        }

        // ============================================
        // Phase 2: Select Test Theme
        // ============================================
        logger.info("Phase2", "Selecting Test Theme...");

        const updatedContent = sideBar.getContent();
        const themesSection = await testThemesPage.getSection(updatedContent);
        if (!themesSection) {
            throw new Error("Test Themes section not found");
        }

        await waitForTreeItems(themesSection, driver);

        let testTheme = await testThemesPage.getItem(themesSection, config.testThemeName);
        if (!testTheme) {
            await waitForTreeRefresh(driver, themesSection, UITimeouts.SHORT);
            testTheme = await testThemesPage.getItem(themesSection, config.testThemeName);
        }

        if (!testTheme) {
            throw new Error(`Test Theme "${config.testThemeName}" not found`);
        }

        await testTheme.click();
        await applySlowMotion(driver);

        // ============================================
        // Phase 3: Create New Resource (Test Element)
        // ============================================
        logger.info("Phase3", "Creating New Resource...");

        const elementsSection = await testElementsPage.getSection(updatedContent);
        if (!elementsSection) {
            throw new Error("Test Elements section not found");
        }

        // Click the "Create Resource" button in the Test Elements view title area
        const createClicked = await testElementsPage.clickCreateResource(elementsSection);
        if (!createClicked) {
            throw new Error('Failed to click "Create Resource" button');
        }

        // Handle Input Box for Resource Name
        const inputBox = await driver.wait(
            async () => {
                try {
                    const box = new InputBox();
                    if (await box.isDisplayed()) {
                        return box;
                    }
                    return null;
                } catch {
                    return null;
                }
            },
            UITimeouts.MEDIUM,
            "Waiting for Input Box"
        );

        if (!inputBox) {
            throw new Error("Input box for resource name did not appear");
        }

        const timestamp = new Date().getTime();
        const newResourceName = `AutoTest_Element_${timestamp}`;
        logger.info("Phase3", `Entering resource name: ${newResourceName}`);

        await inputBox.setText(newResourceName);
        await inputBox.confirm();

        // Wait for success notification
        const notificationAppeared = await waitForNotification(
            driver,
            "Successfully created test element",
            UITimeouts.LONG
        );

        if (!notificationAppeared) {
            logger.warn("Phase3", "Creation success notification did not appear");
        } else {
            logger.info("Phase3", " Resource creation notification received");
        }

        // ============================================
        // Phase 4: Verify Created Resource
        // ============================================
        logger.info("Phase4", "Verifying Created Resource...");

        await waitForTreeRefresh(driver, elementsSection, UITimeouts.MEDIUM);

        const newResource = await testElementsPage.getItem(elementsSection, newResourceName);
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        expect(newResource, `New resource "${newResourceName}" should exist in the tree`).to.not.be.undefined;

        if (newResource) {
            logger.info("Phase4", ` Found new resource: "${newResourceName}"`);

            // Optional: Open the resource to verify it opens the editor
            await testElementsPage.clickOpenResource(newResource);
        }

        logger.info("ResourceCreationFlow", "\n========================================");
        logger.info("ResourceCreationFlow", "Resource Creation Flow Test - COMPLETE");
        logger.info("ResourceCreationFlow", "========================================");
    });
});
