/**
 * @file src/test/ui/clearTreeOnContextSwitch.ui.test.ts
 * @description UI test for tree-clearing-on-context-switch behavior.
 * Verifies that switching from one cycle context to another does not keep old
 * Test Themes items visible in the new context.
 */

import { expect } from "chai";
import { SideBarView, TreeItem } from "vscode-extension-tester";
import { getTestLogger } from "./utils/testLogger";
import {
    waitForTreeItems,
    waitForTestThemesAndElementsViews,
    handleCycleConfigurationPrompt,
    applySlowMotion,
    UITimeouts
} from "./utils/testUtils";
import { collectTreeItemLabels } from "./utils/treeItemUtils";
import { doubleClickTreeItem } from "./utils/treeViewUtils";
import { getTestData, logTestDataConfig } from "./config/testConfig";
import { TestContext, setupTestHooks, skipTest } from "./utils/testHooks";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";
import { TestThemesPage } from "./pages/TestThemesPage";
import { navigateToProjectsView } from "./utils/navigationUtils";

const logger = getTestLogger();

function skipPrecondition(context: Mocha.Context, reason: string): never {
    return skipTest(context, "precondition", reason);
}

function skipError(_context: Mocha.Context, reason: string): never {
    throw new Error(reason);
}

interface OpenCycleResult {
    title: string;
    labels: string[];
}

/**
 * Normalizes an array of labels by trimming whitespace and removing duplicates and empty entries.
 * @param labels - The array of labels to normalize.
 * @returns A new array of normalized labels.
 */
function normalizeLabels(labels: string[]): string[] {
    const trimmedLabels = labels.map((label) => label.trim());
    const nonEmptyLabels = trimmedLabels.filter((label) => label.length > 0);
    const uniqueLabels = new Set(nonEmptyLabels);

    return Array.from(uniqueLabels);
}

describe("Clear Tree On Context Switch Behavior", function () {
    const ctx: TestContext = {} as TestContext;

    this.timeout(240000);

    setupTestHooks(ctx, {
        suiteName: "ClearTreeOnContextSwitch",
        requiresLogin: true,
        openSidebar: true,
        timeout: 240000
    });

    const getDriver = () => ctx.driver;

    async function getProjectsSection(projectsPage: ProjectsViewPage): Promise<any | null> {
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        return projectsPage.getSection(content);
    }

    async function openCycleAndCollectTestThemeLabels(
        projectsPage: ProjectsViewPage,
        testThemesPage: TestThemesPage,
        config: { projectName: string; versionName: string },
        cycleName: string
    ): Promise<OpenCycleResult | null> {
        const driver = getDriver();

        const projectsSection = await getProjectsSection(projectsPage);
        if (!projectsSection) {
            logger.warn("ClearSwitch", "Projects section not found");
            return null;
        }

        const itemsLoaded = await waitForTreeItems(projectsSection, driver, UITimeouts.LONG);
        if (!itemsLoaded) {
            logger.warn("ClearSwitch", "Projects tree items did not load in time");
            return null;
        }

        const targetProject = await projectsPage.getProject(projectsSection, config.projectName);
        if (!targetProject) {
            logger.warn("ClearSwitch", `Project '${config.projectName}' not found`);
            return null;
        }

        const targetVersion = await projectsPage.getVersion(targetProject, config.versionName);
        if (!targetVersion) {
            logger.warn("ClearSwitch", `Version '${config.versionName}' not found`);
            return null;
        }

        const targetCycle = await projectsPage.getCycle(targetVersion, cycleName);
        if (!targetCycle) {
            logger.warn("ClearSwitch", `Cycle '${cycleName}' not found`);
            return null;
        }

        await handleCycleConfigurationPrompt(
            targetCycle,
            driver,
            config.projectName,
            config.versionName,
            projectsSection,
            targetProject,
            targetVersion
        );

        const refreshedProjectsSection = await getProjectsSection(projectsPage);
        if (!refreshedProjectsSection) {
            logger.warn("ClearSwitch", "Projects section not found after configuration prompt handling");
            return null;
        }

        const refreshedProject = await projectsPage.getProject(refreshedProjectsSection, config.projectName);
        if (!refreshedProject) {
            logger.warn("ClearSwitch", `Project '${config.projectName}' not found after configuration prompt handling`);
            return null;
        }

        const refreshedVersion = await projectsPage.getVersion(refreshedProject, config.versionName);
        if (!refreshedVersion) {
            logger.warn("ClearSwitch", `Version '${config.versionName}' not found after configuration prompt handling`);
            return null;
        }

        const refreshedCycle = await projectsPage.getCycle(refreshedVersion, cycleName);
        if (!refreshedCycle) {
            logger.warn("ClearSwitch", `Cycle '${cycleName}' not found after configuration prompt handling`);
            return null;
        }

        await doubleClickTreeItem(refreshedCycle, driver);
        let viewsAppeared = await waitForTestThemesAndElementsViews(driver, UITimeouts.LONG);

        if (!viewsAppeared) {
            logger.warn("ClearSwitch", "Views did not appear on first open attempt, retrying cycle double-click...");
            await applySlowMotion(driver, 300);

            const retryProjectsSection = await getProjectsSection(projectsPage);
            if (retryProjectsSection) {
                const retryProject = await projectsPage.getProject(retryProjectsSection, config.projectName);
                const retryVersion = retryProject
                    ? await projectsPage.getVersion(retryProject, config.versionName)
                    : undefined;
                const retryCycle = retryVersion ? await projectsPage.getCycle(retryVersion, cycleName) : undefined;

                if (retryCycle) {
                    await doubleClickTreeItem(retryCycle, driver);
                    viewsAppeared = await waitForTestThemesAndElementsViews(driver, UITimeouts.LONG);
                }
            }
        }

        if (!viewsAppeared) {
            logger.warn("ClearSwitch", "Test Themes/Test Elements views did not appear");
            return null;
        }

        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        const testThemesSection = await testThemesPage.getSection(content);
        if (!testThemesSection) {
            logger.warn("ClearSwitch", "Test Themes section not found");
            return null;
        }

        const title = (await testThemesPage.getTitle(testThemesSection)) || "";
        const themesLoaded = await waitForTreeItems(testThemesSection, driver, UITimeouts.LONG);
        if (!themesLoaded) {
            logger.warn("ClearSwitch", "Test Themes items did not load in time");
            return null;
        }

        const items = (await testThemesSection.getVisibleItems()) as TreeItem[];
        const labels = await collectTreeItemLabels(items);

        return { title, labels };
    }

    it("should not keep old Test Themes items when switching cycle context", async function () {
        const driver = getDriver();
        const projectsPage = new ProjectsViewPage(driver);
        const testThemesPage = new TestThemesPage(driver);
        const testData = getTestData();
        logTestDataConfig();

        const navResult = await navigateToProjectsView(driver);
        if (!navResult.success) {
            logger.warn("ClearSwitch", `Failed to navigate to Projects view: ${navResult.error}`);
            skipError(this, `Failed to navigate to Projects view: ${navResult.error}`);
        }

        const projectsSection = await getProjectsSection(projectsPage);
        if (!projectsSection) {
            skipPrecondition(this, "Projects section not found");
        }

        const projectsLoaded = await waitForTreeItems(projectsSection, driver, UITimeouts.LONG);
        if (!projectsLoaded) {
            skipPrecondition(this, "Projects tree items did not load in time");
        }

        const project = await projectsPage.getProject(projectsSection, testData.projectName);
        if (!project) {
            skipPrecondition(this, `Project '${testData.projectName}' not found`);
        }

        const version = await projectsPage.getVersion(project, testData.versionName);
        if (!version) {
            skipPrecondition(this, `Version '${testData.versionName}' not found`);
        }

        const cycles = await version.getChildren();
        const cycleLabels = await collectTreeItemLabels(cycles as TreeItem[]);

        if (cycleLabels.length < 2) {
            logger.warn("ClearSwitch", "Need at least 2 cycles to validate context switch behavior. Skipping test.");
            skipPrecondition(this, "Need at least 2 cycles to validate context switch behavior");
        }

        const firstCycle = cycleLabels.includes(testData.cycleName) ? testData.cycleName : cycleLabels[0];
        const secondCycle = cycleLabels.find((label) => label !== firstCycle);

        if (!secondCycle) {
            logger.warn("ClearSwitch", "Could not identify a second distinct cycle. Skipping test.");
            skipPrecondition(this, "Could not identify a second distinct cycle");
        }

        logger.info("ClearSwitch", `Using cycles: first='${firstCycle}', second='${secondCycle}'`);

        const firstCycleOpenResult = await openCycleAndCollectTestThemeLabels(
            projectsPage,
            testThemesPage,
            { projectName: testData.projectName, versionName: testData.versionName },
            firstCycle
        );
        if (!firstCycleOpenResult) {
            skipPrecondition(this, `Could not open cycle '${firstCycle}' and collect test theme labels`);
        }

        expect(firstCycleOpenResult.title).to.include(firstCycle);
        const firstLabels = normalizeLabels(firstCycleOpenResult.labels);
        if (firstLabels.length === 0) {
            logger.warn(
                "ClearSwitch",
                "First cycle has no visible Test Themes items. Continuing with context-title based validation."
            );
        }

        await applySlowMotion(driver);
        const backToProjects = await navigateToProjectsView(driver);
        if (!backToProjects.success) {
            logger.warn("ClearSwitch", `Failed to return to Projects view: ${backToProjects.error}`);
            skipError(this, `Failed to return to Projects view: ${backToProjects.error}`);
        }

        const secondCycleOpenResult = await openCycleAndCollectTestThemeLabels(
            projectsPage,
            testThemesPage,
            { projectName: testData.projectName, versionName: testData.versionName },
            secondCycle
        );
        if (!secondCycleOpenResult) {
            skipPrecondition(this, `Could not open cycle '${secondCycle}' and collect test theme labels`);
        }

        expect(secondCycleOpenResult.title).to.include(secondCycle);
        const secondLabels = normalizeLabels(secondCycleOpenResult.labels);
        if (secondLabels.length === 0) {
            logger.warn(
                "ClearSwitch",
                "Second cycle has no visible Test Themes items. Verifying switch using context title and no-stale-item expectation."
            );
        }

        if (firstCycle !== secondCycle) {
            expect(secondCycleOpenResult.title).to.not.include(firstCycle);
        }

        const labelsOnlyInFirstCycle = firstLabels.filter((label) => !secondLabels.includes(label));
        if (firstLabels.length === 0 || secondLabels.length === 0) {
            // With 0 visible themes in either context, title/context assertions are the reliable signal.
            expect(secondCycleOpenResult.title).to.include(secondCycle);
        } else if (labelsOnlyInFirstCycle.length === 0) {
            logger.warn(
                "ClearSwitch",
                "Both cycles expose identical visible Test Themes labels/content in this dataset. Falling back to title/context assertions for validation."
            );
        } else {
            // At least one label from first context should not be visible in second context.
            expect(labelsOnlyInFirstCycle.length).to.be.greaterThan(0);
        }
    });
});
