/**
 * @file src/test/ui/treeExpansionPersistence.ui.test.ts
 * @description UI tests for tree item expansion state persistence across:
 * - Logout/login cycles
 * - VS Code window reload
 * - Tree view refresh
 */

import { expect } from "chai";
import { SideBarView, TreeItem, ViewSection, Workbench, By, until, WebDriver } from "vscode-extension-tester";
import { getTestLogger } from "./utils/testLogger";
import {
    applySlowMotion,
    waitForTreeItems,
    waitForProjectsView,
    waitForTestThemesAndElementsViews,
    handleCycleConfigurationPrompt,
    UITimeouts,
    attemptLogout,
    ensureLoggedIn,
    openTestBenchSidebar
} from "./utils/testUtils";
import { clickToolbarButton } from "./utils/toolbarUtils";
import { getTestData, logTestDataConfig, hasTestCredentials } from "./config/testConfig";
import { TestContext, setupTestHooks } from "./utils/testHooks";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";
import { TestThemesPage } from "./pages/TestThemesPage";
import { TestElementsPage } from "./pages/TestElementsPage";

const logger = getTestLogger();

const TOGGLE_ITEM_COUNT = 3;
const STATE_RESTORE_DELAY = 2000;
const REFRESH_DELAY = 3000;
const TEST_ELEMENTS_REFRESH_DELAY = 5000;
const TEST_ELEMENTS_REFRESH_TIMEOUT = 180000;

type ViewName = "Projects" | "Test Themes" | "Test Elements";
type PersistenceAction = "logout/login" | "reload" | "refresh";

interface TreeItemExpansionState {
    label: string;
    isExpanded: boolean;
    hasChildren: boolean;
}

interface TreeViewExpansionState {
    viewName: string;
    items: Map<string, TreeItemExpansionState>;
}

/**
 * Ensures VS Code is stable and ready for interaction.
 * Checks that key UI elements are present and responsive.
 */
async function ensureVSCodeStable(driver: WebDriver): Promise<void> {
    logger.debug("Stability", "Checking VS Code stability...");

    // Wait for workbench to be present
    await driver.wait(
        until.elementLocated(By.className("monaco-workbench")),
        UITimeouts.MEDIUM,
        "Waiting for workbench"
    );

    // Wait for activity bar to be present
    await driver.wait(
        async () => {
            try {
                const activityBar = await driver.findElement(By.id("workbench.parts.activitybar"));
                return activityBar !== null;
            } catch {
                return false;
            }
        },
        UITimeouts.MEDIUM,
        "Waiting for activity bar"
    );

    // Wait for status bar
    await driver.wait(
        until.elementLocated(By.id("workbench.parts.statusbar")),
        UITimeouts.MEDIUM,
        "Waiting for status bar"
    );

    // Brief pause for any pending UI updates
    await driver.sleep(500);
    logger.debug("Stability", "VS Code appears stable");
}

async function captureTreeExpansionState(section: ViewSection, viewName: string): Promise<TreeViewExpansionState> {
    const state: TreeViewExpansionState = { viewName, items: new Map() };

    try {
        const items = (await section.getVisibleItems()) as TreeItem[];
        logger.debug("ExpansionState", `Capturing state for ${items.length} visible items in ${viewName}`);

        for (const item of items) {
            try {
                const label = await item.getLabel();
                const hasChildren = await item.hasChildren();
                const isExpanded = hasChildren ? await item.isExpanded() : false;

                state.items.set(label, { label, isExpanded, hasChildren });

                if (hasChildren) {
                    logger.trace("ExpansionState", `  ${label}: ${isExpanded ? "EXPANDED" : "COLLAPSED"}`);
                }
            } catch (error) {
                logger.debug("ExpansionState", `Error capturing state for item: ${error}`);
            }
        }
    } catch (error) {
        logger.error("ExpansionState", `Error capturing tree state for ${viewName}:`, error);
    }

    return state;
}

function compareExpansionStates(expected: TreeViewExpansionState, actual: TreeViewExpansionState): string[] {
    const differences: string[] = [];

    for (const [label, expectedState] of expected.items) {
        if (!expectedState.hasChildren) {
            continue;
        }

        const actualState = actual.items.get(label);
        if (!actualState) {
            differences.push(`Item "${label}" not found in ${actual.viewName} after restoration`);
            continue;
        }

        if (expectedState.isExpanded !== actualState.isExpanded) {
            const expectedStr = expectedState.isExpanded ? "EXPANDED" : "COLLAPSED";
            const actualStr = actualState.isExpanded ? "EXPANDED" : "COLLAPSED";
            differences.push(`Item "${label}" expansion state mismatch: expected ${expectedStr}, got ${actualStr}`);
        }
    }

    return differences;
}

async function toggleRandomTreeItems(
    section: ViewSection,
    driver: WebDriver,
    maxItems: number = TOGGLE_ITEM_COUNT
): Promise<number> {
    let toggledCount = 0;

    try {
        const items = (await section.getVisibleItems()) as TreeItem[];
        const expandableItems: TreeItem[] = [];

        for (const item of items) {
            try {
                if (await item.hasChildren()) {
                    expandableItems.push(item);
                }
            } catch {
                // Item may have become stale
            }
        }

        if (expandableItems.length === 0) {
            logger.warn("Toggle", "No expandable items found in tree");
            return 0;
        }

        const shuffled = expandableItems.sort(() => Math.random() - 0.5);
        const itemsToToggle = shuffled.slice(0, Math.min(maxItems, shuffled.length));

        for (const item of itemsToToggle) {
            try {
                const label = await item.getLabel();
                const wasExpanded = await item.isExpanded();

                if (wasExpanded) {
                    await item.collapse();
                    logger.info("Toggle", `Collapsed: "${label}"`);
                } else {
                    await item.expand();
                    logger.info("Toggle", `Expanded: "${label}"`);
                }

                await applySlowMotion(driver);
                toggledCount++;
            } catch (error) {
                logger.debug("Toggle", `Error toggling item: ${error}`);
            }
        }
    } catch (error) {
        logger.error("Toggle", `Error toggling tree items: ${error}`);
    }

    return toggledCount;
}

async function expandAllItems(section: ViewSection, driver: WebDriver): Promise<number> {
    let expandedCount = 0;

    try {
        const items = (await section.getVisibleItems()) as TreeItem[];

        for (const item of items) {
            try {
                const hasChildren = await item.hasChildren();
                if (hasChildren && !(await item.isExpanded())) {
                    await item.expand();
                    await driver.sleep(100);
                    expandedCount++;
                }
            } catch {
                // Continue with next item
            }
        }

        if (expandedCount > 0) {
            const newItems = (await section.getVisibleItems()) as TreeItem[];
            if (newItems.length > items.length) {
                expandedCount += await expandAllItems(section, driver);
            }
        }
    } catch (error) {
        logger.error("Expand", `Error expanding items: ${error}`);
    }

    return expandedCount;
}

async function reloadVSCodeWindow(driver: WebDriver): Promise<boolean> {
    logger.info("Reload", "Reloading VS Code window...");

    try {
        // Capture reference to current workbench to detect when reload starts
        let oldWorkbench: any;
        try {
            oldWorkbench = await driver.findElement(By.className("monaco-workbench"));
        } catch {
            // Element might not exist
        }

        // Open command palette with retry logic
        let commandPalette;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const workbench = new Workbench();
                commandPalette = await workbench.openCommandPrompt();
                break;
            } catch (error) {
                logger.warn("Reload", `Command palette open attempt ${attempt} failed: ${error}`);
                if (attempt === 3) {
                    throw error;
                }
                await driver.sleep(1000);
            }
        }

        if (!commandPalette) {
            logger.error("Reload", "Failed to open command palette");
            return false;
        }

        await commandPalette.setText(">Developer: Reload Window");

        // Wait for quick picks to populate
        await driver.wait(
            async () => {
                try {
                    const picks = await commandPalette!.getQuickPicks();
                    return picks.length > 0;
                } catch {
                    return false;
                }
            },
            UITimeouts.MEDIUM,
            "Waiting for quick picks to populate"
        );

        const picks = await commandPalette.getQuickPicks();
        let reloadCommandFound = false;

        for (const pick of picks) {
            try {
                const text = await pick.getText();
                if (text.includes("Reload Window") || text.includes("Developer: Reload Window")) {
                    reloadCommandFound = true;
                    await pick.select();
                    break;
                }
            } catch (error) {
                logger.debug("Reload", `Error reading pick: ${error}`);
            }
        }

        if (!reloadCommandFound) {
            logger.warn("Reload", "Reload Window command not found in quick picks");
            try {
                await commandPalette.cancel();
            } catch {
                // Ignore cancel errors
            }
            return false;
        }

        // Wait for reload to start (old workbench becomes stale)
        if (oldWorkbench) {
            try {
                await driver.wait(until.stalenessOf(oldWorkbench), UITimeouts.LONG);
                logger.debug("Reload", "Old workbench became stale - reload started");
            } catch {
                logger.warn("Reload", "Staleness wait timed out, continuing...");
            }
        }

        // Wait for new workbench to appear
        await driver.wait(
            until.elementLocated(By.className("monaco-workbench")),
            UITimeouts.WORKSPACE_LOAD,
            "Waiting for workbench to reload"
        );

        // Wait for status bar to appear (indicates UI is ready)
        await driver.wait(
            until.elementLocated(By.id("workbench.parts.statusbar")),
            UITimeouts.VERY_LONG,
            "Waiting for status bar"
        );

        // Wait for activity bar to be interactive (better indicator than hard sleep)
        await driver.wait(
            async () => {
                try {
                    const activityBar = await driver.findElement(By.id("workbench.parts.activitybar"));
                    return activityBar !== null;
                } catch {
                    return false;
                }
            },
            UITimeouts.LONG,
            "Waiting for activity bar"
        );

        // Small delay for extensions to finish activating
        await driver.sleep(1500);

        logger.info("Reload", "VS Code window reloaded successfully");
        return true;
    } catch (error) {
        logger.error("Reload", `Error reloading VS Code window: ${error}`);
        return false;
    }
}

async function navigateToTestThemesAndElements(driver: WebDriver): Promise<boolean> {
    try {
        const config = getTestData();
        const projectsPage = new ProjectsViewPage(driver);
        const sideBar = new SideBarView();
        const content = sideBar.getContent();

        const projectsSection = await projectsPage.getSection(content);
        if (!projectsSection) {
            logger.warn("Navigation", "Projects section not found");
            return false;
        }

        await waitForTreeItems(projectsSection, driver);

        const project = await projectsPage.getProject(projectsSection, config.projectName);
        if (!project) {
            logger.warn("Navigation", `Project "${config.projectName}" not found`);
            return false;
        }

        const version = await projectsPage.getVersion(project, config.versionName);
        if (!version) {
            logger.warn("Navigation", `Version "${config.versionName}" not found`);
            return false;
        }

        const cycle = await projectsPage.getCycle(version, config.cycleName);
        if (!cycle) {
            logger.warn("Navigation", `Cycle "${config.cycleName}" not found`);
            return false;
        }

        await cycle.click();
        await cycle.click();
        await driver.sleep(500);

        const viewsReady = await waitForTestThemesAndElementsViews(driver, UITimeouts.LONG);
        if (!viewsReady) {
            logger.warn("Navigation", "Test Themes/Elements views did not appear");
            return false;
        }

        logger.info("Navigation", "Successfully navigated to Test Themes/Elements views");
        return true;
    } catch (error) {
        logger.error("Navigation", `Error navigating to Test Themes/Elements: ${error}`);
        return false;
    }
}

async function getSection(
    page: ProjectsViewPage | TestThemesPage | TestElementsPage,
    _driver: WebDriver
): Promise<ViewSection | null> {
    const sideBar = new SideBarView();
    const content = sideBar.getContent();
    return await page.getSection(content);
}

async function prepareTreeState(
    section: ViewSection,
    driver: WebDriver,
    viewName: ViewName
): Promise<TreeViewExpansionState> {
    await expandAllItems(section, driver);
    await applySlowMotion(driver);

    const page =
        viewName === "Projects"
            ? new ProjectsViewPage(driver)
            : viewName === "Test Themes"
              ? new TestThemesPage(driver)
              : new TestElementsPage(driver);

    const refreshedSection = await getSection(page, driver);
    if (!refreshedSection) {
        throw new Error(`${viewName} section not found after expansion`);
    }

    await toggleRandomTreeItems(refreshedSection, driver, TOGGLE_ITEM_COUNT);
    await applySlowMotion(driver);

    const finalSection = await getSection(page, driver);
    if (!finalSection) {
        throw new Error(`${viewName} section not found before capturing state`);
    }

    return await captureTreeExpansionState(finalSection, viewName);
}

async function verifyStatePreserved(
    stateBefore: TreeViewExpansionState,
    page: ProjectsViewPage | TestThemesPage | TestElementsPage,
    driver: WebDriver,
    viewName: ViewName,
    action: PersistenceAction
): Promise<void> {
    const section = await getSection(page, driver);
    if (!section) {
        throw new Error(`${viewName} section not found after ${action}`);
    }

    await waitForTreeItems(section, driver);
    const stateAfter = await captureTreeExpansionState(section, viewName);
    logger.info("Persistence", `Captured state of ${stateAfter.items.size} items after ${action}`);

    const differences = compareExpansionStates(stateBefore, stateAfter);

    if (differences.length > 0) {
        logger.error("Persistence", "Expansion state differences found:");
        differences.forEach((diff) => logger.error("Persistence", `  - ${diff}`));
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    expect(differences, `${viewName} expansion state should be preserved after ${action}`).to.be.empty;
    logger.info("Persistence", `${viewName} expansion state preserved after ${action} ✓`);
}

async function navigateToTestView(driver: WebDriver, viewName: "Test Themes" | "Test Elements"): Promise<void> {
    const sideBar = new SideBarView();
    const content = sideBar.getContent();
    const sections = await content.getSections();

    for (const section of sections) {
        const title = await section.getTitle();
        if (title.includes(viewName)) {
            logger.info("Persistence", `Already in ${viewName} view`);
            return;
        }
    }

    const config = getTestData();
    const projectsPage = new ProjectsViewPage(driver);

    const projectsSection = await projectsPage.getSection(new SideBarView().getContent());
    if (!projectsSection) {
        logger.warn("Persistence", "Projects section not found, skipping navigation");
        return;
    }

    await waitForTreeItems(projectsSection, driver);

    const project = await projectsPage.getProject(projectsSection, config.projectName);
    if (!project) {
        return;
    }

    const version = await projectsPage.getVersion(project, config.versionName);
    if (!version) {
        return;
    }

    let cycle = await projectsPage.getCycle(version, config.cycleName);
    if (!cycle) {
        return;
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

    // Re-fetch cycle after configuration (reference may be stale)
    const refreshedSection = await projectsPage.getSection(new SideBarView().getContent());
    if (refreshedSection) {
        const refreshedProject = await projectsPage.getProject(refreshedSection, config.projectName);
        if (refreshedProject) {
            const refreshedVersion = await projectsPage.getVersion(refreshedProject, config.versionName);
            if (refreshedVersion) {
                const refreshedCycle = await projectsPage.getCycle(refreshedVersion, config.cycleName);
                if (refreshedCycle) {
                    cycle = refreshedCycle;
                }
            }
        }
    }

    await cycle.click();
    await cycle.click();
    await driver.sleep(500);

    const viewsReady = await waitForTestThemesAndElementsViews(driver, UITimeouts.LONG);
    if (!viewsReady) {
        logger.warn("Persistence", `${viewName} view did not appear`);
    }
}

/* eslint-disable @typescript-eslint/no-unused-expressions */
describe("Tree Expansion State Persistence Tests", function () {
    const ctx: TestContext = {} as TestContext;

    this.timeout(300000);

    setupTestHooks(ctx, {
        suiteName: "TreeExpansionPersistence",
        requiresLogin: true,
        openSidebar: true,
        timeout: 300000
    });

    const getDriver = () => ctx.driver;

    // =========================================================================
    // Projects View Tests
    // =========================================================================

    describe("Projects View Expansion State Persistence", function () {
        it("should preserve expansion state after logout/login", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                this.skip();
                return;
            }

            const projectsPage = new ProjectsViewPage(driver);
            const section = await getSection(projectsPage, driver);
            if (!section) {
                throw new Error("Projects section not found");
            }

            await waitForTreeItems(section, driver);
            logger.info("Persistence", "Preparing tree state for Projects view...");
            const stateBefore = await prepareTreeState(section, driver, "Projects");
            logger.info("Persistence", `Captured state of ${stateBefore.items.size} items before logout`);

            logger.info("Persistence", "Logging out...");
            const loggedOut = await attemptLogout(driver);
            expect(loggedOut, "Logout should be successful").to.be.true;

            logger.info("Persistence", "Logging back in...");
            const loggedIn = await ensureLoggedIn(driver);
            expect(loggedIn, "Login should be successful").to.be.true;

            await openTestBenchSidebar(driver);
            await waitForProjectsView(driver, UITimeouts.LONG);
            await driver.sleep(STATE_RESTORE_DELAY);

            await verifyStatePreserved(stateBefore, projectsPage, driver, "Projects", "logout/login");
        });

        it("should preserve expansion state after VS Code reload", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                this.skip();
                return;
            }

            const projectsPage = new ProjectsViewPage(driver);
            const section = await getSection(projectsPage, driver);
            if (!section) {
                throw new Error("Projects section not found");
            }

            await waitForTreeItems(section, driver);
            logger.info("Persistence", "Preparing tree state for Projects view...");
            const stateBefore = await prepareTreeState(section, driver, "Projects");

            const reloaded = await reloadVSCodeWindow(driver);
            expect(reloaded, "VS Code reload should be successful").to.be.true;

            await openTestBenchSidebar(driver);
            await waitForProjectsView(driver, UITimeouts.VERY_LONG);
            await driver.sleep(STATE_RESTORE_DELAY);

            await verifyStatePreserved(stateBefore, projectsPage, driver, "Projects", "reload");
        });

        it("should preserve expansion state after tree view refresh", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                this.skip();
                return;
            }

            const projectsPage = new ProjectsViewPage(driver);
            const section = await getSection(projectsPage, driver);
            if (!section) {
                throw new Error("Projects section not found");
            }

            await waitForTreeItems(section, driver);
            logger.info("Persistence", "Preparing tree state for Projects view...");
            const stateBefore = await prepareTreeState(section, driver, "Projects");

            logger.info("Persistence", "Clicking Refresh Projects button...");
            const currentSection = await getSection(projectsPage, driver);
            const refreshClicked = await clickToolbarButton(currentSection!, "Refresh Projects", driver);
            expect(refreshClicked, "Refresh Projects button should be clicked").to.be.true;

            await driver.sleep(REFRESH_DELAY);
            await waitForProjectsView(driver, UITimeouts.LONG);

            await verifyStatePreserved(stateBefore, projectsPage, driver, "Projects", "refresh");
        });
    });

    // =========================================================================
    // Test Themes View Tests
    // =========================================================================

    describe("Test Themes View Expansion State Persistence", function () {
        beforeEach(async function () {
            const driver = getDriver();
            logTestDataConfig();
            await ensureVSCodeStable(driver);
            await navigateToTestView(driver, "Test Themes");
        });

        it("should preserve expansion state after logout/login", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                this.skip();
                return;
            }

            const testThemesPage = new TestThemesPage(driver);
            const section = await getSection(testThemesPage, driver);
            if (!section) {
                this.skip();
                return;
            }

            await waitForTreeItems(section, driver);
            logger.info("Persistence", "Preparing tree state for Test Themes view...");
            const stateBefore = await prepareTreeState(section, driver, "Test Themes");

            logger.info("Persistence", "Logging out...");
            await attemptLogout(driver);

            logger.info("Persistence", "Logging back in...");
            await ensureLoggedIn(driver);

            await openTestBenchSidebar(driver);
            const navigated = await navigateToTestThemesAndElements(driver);
            expect(navigated, "Should navigate back to Test Themes view").to.be.true;
            await driver.sleep(STATE_RESTORE_DELAY);

            await verifyStatePreserved(stateBefore, testThemesPage, driver, "Test Themes", "logout/login");
        });

        it("should preserve expansion state after VS Code reload", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                this.skip();
                return;
            }

            const testThemesPage = new TestThemesPage(driver);
            const section = await getSection(testThemesPage, driver);
            if (!section) {
                this.skip();
                return;
            }

            await waitForTreeItems(section, driver);
            logger.info("Persistence", "Preparing tree state for Test Themes view...");
            const stateBefore = await prepareTreeState(section, driver, "Test Themes");

            const reloaded = await reloadVSCodeWindow(driver);
            expect(reloaded, "VS Code reload should be successful").to.be.true;

            await openTestBenchSidebar(driver);
            await waitForTestThemesAndElementsViews(driver, UITimeouts.VERY_LONG);
            await driver.sleep(STATE_RESTORE_DELAY);

            await verifyStatePreserved(stateBefore, testThemesPage, driver, "Test Themes", "reload");
        });

        it("should preserve expansion state after tree view refresh", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                this.skip();
                return;
            }

            const testThemesPage = new TestThemesPage(driver);
            const section = await getSection(testThemesPage, driver);
            if (!section) {
                this.skip();
                return;
            }

            await waitForTreeItems(section, driver);
            logger.info("Persistence", "Preparing tree state for Test Themes view...");
            const stateBefore = await prepareTreeState(section, driver, "Test Themes");

            logger.info("Persistence", "Clicking Refresh Test Themes button...");
            const currentSection = await getSection(testThemesPage, driver);
            const refreshClicked = await clickToolbarButton(currentSection!, "Refresh Test Themes", driver);
            expect(refreshClicked, "Refresh Test Themes button should be clicked").to.be.true;

            await driver.sleep(REFRESH_DELAY);
            await waitForTestThemesAndElementsViews(driver, UITimeouts.LONG);

            await verifyStatePreserved(stateBefore, testThemesPage, driver, "Test Themes", "refresh");
        });
    });

    // =========================================================================
    // Test Elements View Tests
    // =========================================================================

    describe("Test Elements View Expansion State Persistence", function () {
        beforeEach(async function () {
            const driver = getDriver();
            await ensureVSCodeStable(driver);
            await navigateToTestView(driver, "Test Elements");
        });

        it("should preserve expansion state after logout/login", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                this.skip();
                return;
            }

            const testElementsPage = new TestElementsPage(driver);
            const section = await getSection(testElementsPage, driver);
            if (!section) {
                this.skip();
                return;
            }

            await waitForTreeItems(section, driver);
            logger.info("Persistence", "Preparing tree state for Test Elements view...");
            const stateBefore = await prepareTreeState(section, driver, "Test Elements");

            await attemptLogout(driver);
            await ensureLoggedIn(driver);

            await openTestBenchSidebar(driver);
            const navigated = await navigateToTestThemesAndElements(driver);
            expect(navigated, "Should navigate back to Test Elements view").to.be.true;
            await driver.sleep(STATE_RESTORE_DELAY);

            await verifyStatePreserved(stateBefore, testElementsPage, driver, "Test Elements", "logout/login");
        });

        it("should preserve expansion state after VS Code reload", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                this.skip();
                return;
            }

            const testElementsPage = new TestElementsPage(driver);
            const section = await getSection(testElementsPage, driver);
            if (!section) {
                this.skip();
                return;
            }

            await waitForTreeItems(section, driver);
            logger.info("Persistence", "Preparing tree state for Test Elements view...");
            const stateBefore = await prepareTreeState(section, driver, "Test Elements");

            const reloaded = await reloadVSCodeWindow(driver);
            expect(reloaded, "VS Code reload should be successful").to.be.true;

            await openTestBenchSidebar(driver);
            await waitForTestThemesAndElementsViews(driver, UITimeouts.VERY_LONG);
            await driver.sleep(STATE_RESTORE_DELAY);

            await verifyStatePreserved(stateBefore, testElementsPage, driver, "Test Elements", "reload");
        });

        it("should preserve expansion state after tree view refresh", async function () {
            this.timeout(TEST_ELEMENTS_REFRESH_TIMEOUT);

            const driver = getDriver();
            if (!hasTestCredentials()) {
                this.skip();
                return;
            }

            const testElementsPage = new TestElementsPage(driver);
            const section = await getSection(testElementsPage, driver);
            if (!section) {
                this.skip();
                return;
            }

            await waitForTreeItems(section, driver);
            logger.info("Persistence", "Preparing tree state for Test Elements view...");
            const stateBefore = await prepareTreeState(section, driver, "Test Elements");

            logger.info("Persistence", "Clicking Refresh Test Elements button...");
            const currentSection = await getSection(testElementsPage, driver);
            const refreshClicked = await clickToolbarButton(currentSection!, "Refresh Test Elements", driver);
            expect(refreshClicked, "Refresh Test Elements button should be clicked").to.be.true;

            await driver.sleep(TEST_ELEMENTS_REFRESH_DELAY);
            await waitForTestThemesAndElementsViews(driver, UITimeouts.VERY_LONG);

            await verifyStatePreserved(stateBefore, testElementsPage, driver, "Test Elements", "refresh");
        });
    });
});
