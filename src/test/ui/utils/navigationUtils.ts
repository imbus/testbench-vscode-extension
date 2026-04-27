/**
 * @file src/test/ui/utils/navigationUtils.ts
 * @description Shared navigation utilities for UI tests.
 * Provides common functions for navigating between views.
 */

import { SideBarView, TreeItem } from "vscode-extension-tester";
import { getTestLogger } from "./testLogger";
import {
    waitForTreeItems,
    waitForTestThemesAndElementsViews,
    handleCycleConfigurationPrompt,
    waitForProjectsView,
    openTestBenchSidebar,
    ensureLoggedIn
} from "./testUtils";
import { doubleClickTreeItem } from "./treeViewUtils";
import { getTestData } from "../config/testConfig";
import { ProjectsViewPage } from "../pages/ProjectsViewPage";
import { TestThemesPage } from "../pages/TestThemesPage";
import { TestElementsPage } from "../pages/TestElementsPage";

const logger = getTestLogger();

/**
 * Navigation target for the navigateToView function.
 */
export type NavigationTarget = "testThemes" | "testElements" | "projects";

/**
 * Result of a navigation operation.
 */
export interface NavigationResult {
    success: boolean;
    section: any | null;
    error?: string;
}

/**
 * Navigates to the Test Themes/Elements view from any starting view.
 * Handles login verification and cycle configuration automatically.
 *
 * @param driver - The WebDriver instance
 * @param target - The target view ("testThemes" or "testElements")
 * @returns Promise<NavigationResult> - Navigation result with section if successful
 */
export async function navigateToTestView(
    driver: any,
    target: NavigationTarget = "testThemes"
): Promise<NavigationResult> {
    const config = getTestData();
    const projectsPage = new ProjectsViewPage(driver);
    const testThemesPage = new TestThemesPage(driver);
    const testElementsPage = new TestElementsPage(driver);
    const logPrefix = target === "testThemes" ? "TestThemes" : target === "testElements" ? "TestElements" : "Projects";

    // Ensure user is logged in
    logger.info(logPrefix, "Ensuring user is logged in...");
    const loggedIn = await ensureLoggedIn(driver);
    if (!loggedIn) {
        return { success: false, section: null, error: "Failed to log in" };
    }
    logger.info(logPrefix, "User is logged in");

    const sideBar = new SideBarView();
    let content = sideBar.getContent();

    // If target is "projects", navigate directly to Projects View
    if (target === "projects") {
        // Check if we're in Test Themes view
        const testThemesSection = await testThemesPage.getSection(content);
        if (testThemesSection) {
            logger.info(logPrefix, "In Test Themes view, clicking Open Projects View button...");
            const clicked = await testThemesPage.clickOpenProjectsView();
            if (clicked) {
                await driver.sleep(1000);
                content = sideBar.getContent();
            }
        }

        // Get Projects section
        let projectsSection = await projectsPage.getSection(content);
        if (!projectsSection) {
            await openTestBenchSidebar(driver);
            await driver.sleep(1000);
            content = sideBar.getContent();
            projectsSection = await projectsPage.getSection(content);
        }

        if (projectsSection) {
            await waitForTreeItems(projectsSection, driver);
            logger.info(logPrefix, "Successfully navigated to Projects View");
            return { success: true, section: projectsSection };
        }
        return { success: false, section: null, error: "Projects section not found" };
    }

    // Check if already in target view with correct context (for testThemes/testElements)
    const testThemesSection = await testThemesPage.getSection(content);
    if (testThemesSection) {
        const title = await testThemesPage.getTitle(testThemesSection);
        if (title && title.includes(config.cycleName)) {
            logger.info(logPrefix, "Already in correct view context");
            if (target === "testThemes") {
                return { success: true, section: testThemesSection };
            }
            // For test elements, get that section
            const elementsSection = await testElementsPage.getSection(content);
            return { success: true, section: elementsSection };
        }
        // Wrong context, navigate back to Projects View
        logger.info(logPrefix, "In Test Themes view but wrong context, navigating to Projects View...");
        await testThemesPage.clickToolbarAction(testThemesSection, "Open Projects View");
        await driver.sleep(1000);
    }

    // Navigate from Projects View
    logger.info(logPrefix, "Navigating from Projects View...");
    content = sideBar.getContent();
    let projectsSection = await projectsPage.getSection(content);

    if (!projectsSection) {
        // Try to open the sidebar
        await openTestBenchSidebar(driver);
        await driver.sleep(1000);
        content = sideBar.getContent();
        projectsSection = await projectsPage.getSection(content);
        if (!projectsSection) {
            return { success: false, section: null, error: "Projects section not found" };
        }
    }

    await waitForTreeItems(projectsSection, driver);

    // Navigate through Project -> Version -> Cycle
    const project = await projectsPage.getProject(projectsSection, config.projectName);
    if (!project) {
        return { success: false, section: null, error: `Project "${config.projectName}" not found` };
    }
    logger.info(logPrefix, `Found project: "${config.projectName}"`);

    const version = await projectsPage.getVersion(project, config.versionName);
    if (!version) {
        return { success: false, section: null, error: `Version "${config.versionName}" not found` };
    }
    logger.info(logPrefix, `Found version: "${config.versionName}"`);

    const cycle = await projectsPage.getCycle(version, config.cycleName);
    if (!cycle) {
        return { success: false, section: null, error: `Cycle "${config.cycleName}" not found` };
    }
    logger.info(logPrefix, `Found cycle: "${config.cycleName}"`);

    // Handle configuration prompt
    await handleCycleConfigurationPrompt(
        cycle,
        driver,
        config.projectName,
        config.versionName,
        projectsSection,
        project,
        version
    );

    //  Re-fetch cycle with fresh reference after configuration
    content = sideBar.getContent();
    const refreshedProjectsSection = await projectsPage.getSection(content);
    if (!refreshedProjectsSection) {
        return { success: false, section: null, error: "Projects section not found after configuration" };
    }

    const refreshedProject = await projectsPage.getProject(refreshedProjectsSection, config.projectName);
    if (!refreshedProject) {
        return { success: false, section: null, error: `Project not found after configuration` };
    }

    const refreshedVersion = await projectsPage.getVersion(refreshedProject, config.versionName);
    if (!refreshedVersion) {
        return { success: false, section: null, error: `Version not found after configuration` };
    }

    const refreshedCycle = await projectsPage.getCycle(refreshedVersion, config.cycleName);
    if (!refreshedCycle) {
        return { success: false, section: null, error: `Cycle not found after configuration` };
    }

    // Open Test Themes/Elements views
    logger.info(logPrefix, "Double-clicking cycle to open views...");
    await doubleClickTreeItem(refreshedCycle, driver);

    const viewsAppeared = await waitForTestThemesAndElementsViews(driver);
    if (!viewsAppeared) {
        return { success: false, section: null, error: "Views did not appear after double-click" };
    }

    // Return the requested section
    content = sideBar.getContent();
    const targetSection =
        target === "testThemes" ? await testThemesPage.getSection(content) : await testElementsPage.getSection(content);

    logger.info(logPrefix, "Successfully navigated");
    return { success: true, section: targetSection };
}

/**
 * Navigates back to Projects View from Test Themes/Elements view.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<NavigationResult> - Navigation result
 */
export async function navigateToProjectsView(driver: any): Promise<NavigationResult> {
    const testThemesPage = new TestThemesPage(driver);
    const projectsPage = new ProjectsViewPage(driver);

    const sideBar = new SideBarView();
    let content = sideBar.getContent();

    // Check if already in Projects View
    const projectsSection = await projectsPage.getSection(content);
    if (projectsSection) {
        return { success: true, section: projectsSection };
    }

    // Click "Open Projects View" in Test Themes toolbar
    const testThemesSection = await testThemesPage.getSection(content);
    if (testThemesSection) {
        await testThemesPage.clickToolbarAction(testThemesSection, "Open Projects View");
        await waitForProjectsView(driver);
        content = sideBar.getContent();
        const section = await projectsPage.getSection(content);
        return { success: section !== null, section };
    }

    return { success: false, section: null, error: "No view found to navigate from" };
}

/**
 * Gets the appropriate page object for a view section.
 *
 * @param driver - The WebDriver instance
 * @param viewType - The type of view
 * @returns Page object instance
 */
export function getPageObject(
    driver: any,
    viewType: "projects" | "testThemes" | "testElements"
): ProjectsViewPage | TestThemesPage | TestElementsPage {
    switch (viewType) {
        case "projects":
            return new ProjectsViewPage(driver);
        case "testThemes":
            return new TestThemesPage(driver);
        case "testElements":
            return new TestElementsPage(driver);
    }
}

/**
 * Finds a subdivision that has resource action buttons.
 * Used when the configured subdivision is virtual and doesn't have Create/Open Resource buttons.
 *
 * @param driver - The WebDriver instance
 * @param elementsSection - The Test Elements section
 * @param testElementsPage - The Test Elements page object
 * @returns Promise<TreeItem | null> - The subdivision with resource buttons, or null
 */
export async function findResourceSubdivision(
    driver: any,
    elementsSection: any,
    testElementsPage: TestElementsPage
): Promise<{ subdivision: TreeItem | null; label: string }> {
    const { hasActionButton } = await import("./treeItemUtils");

    // Collect labels first to avoid stale element issues
    let items: TreeItem[] = [];
    const sideBar = new SideBarView();

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            items = (await elementsSection.getVisibleItems()) as TreeItem[];
            break;
        } catch (error) {
            logger.debug(
                "Navigation",
                `Failed to read visible test element items (attempt ${attempt}/3): ${String(error)}`
            );

            const content = sideBar.getContent();
            const refreshedSection = await testElementsPage.getSection(content);
            if (refreshedSection) {
                elementsSection = refreshedSection;
            }

            if (attempt < 3) {
                await driver.sleep(200);
            }
        }
    }

    if (items.length === 0) {
        return { subdivision: null, label: "" };
    }

    const labels: string[] = [];

    for (const item of items) {
        try {
            const label = await (item as TreeItem).getLabel();
            labels.push(label);
        } catch {
            // Skip stale elements
        }
    }

    // Check each item for resource buttons
    for (const label of labels) {
        try {
            const content = sideBar.getContent();
            const section = await testElementsPage.getSection(content);
            if (!section) {
                continue;
            }

            const item = await testElementsPage.getItem(section, label);
            if (!item) {
                continue;
            }

            await item.click();
            await driver.sleep(200);

            const hasCreate = await hasActionButton(item, "Create Resource", driver);
            const hasOpen = await hasActionButton(item, "Open Resource", driver);

            if (hasCreate || hasOpen) {
                logger.info("Navigation", `Found resource subdivision: "${label}"`);
                return { subdivision: item, label };
            }
        } catch {
            // Element became stale, continue
        }
    }

    return { subdivision: null, label: "" };
}
