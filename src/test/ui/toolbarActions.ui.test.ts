/**
 * @file src/test/ui/toolbarActions.ui.test.ts
 * @description UI tests for toolbar button functionality across views including:
 * - Projects View toolbar: Logout, Refresh Projects, Search, Open Extension Settings
 * - Test Themes View toolbar: Refresh Test Themes, Open Projects View, Search
 * - TOV/Cycle action buttons: Open in Test Themes View, Generate Tests
 * - State persistence after re-login
 */

import { expect } from "chai";
import { SideBarView } from "vscode-extension-tester";
import { getTestLogger } from "./utils/testLogger";
import { waitForProjectsView, attemptLogout } from "./utils/testUtils";
import { isWebviewAvailable } from "./utils/webviewUtils";
import { applySlowMotion, waitForTreeItems, UITimeouts, waitForCondition } from "./utils/waitHelpers";
import { navigateToTestView } from "./utils/navigationUtils";
import { clickToolbarButton, getToolbarButtonLabels, hasToolbarButton } from "./utils/toolbarUtils";
import { getActionButtonLabels } from "./utils/treeItemUtils";
import { getTestData, logTestDataConfig, hasTestCredentials } from "./config/testConfig";
import { TestContext, setupTestHooks, ensureLoggedInOrSkip, skipTest } from "./utils/testHooks";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";
import { TestThemesPage } from "./pages/TestThemesPage";

const logger = getTestLogger();

function skipPrecondition(context: Mocha.Context, reason: string): never {
    return skipTest(context, "precondition", reason);
}

describe("Toolbar Actions UI Tests", function () {
    const ctx: TestContext = {} as TestContext;

    this.timeout(180000);

    setupTestHooks(ctx, {
        suiteName: "ToolbarActions",
        requiresLogin: true,
        openSidebar: true,
        timeout: 180000
    });

    const getDriver = () => ctx.driver;

    async function getProjectsSection(): Promise<any> {
        const driver = getDriver();
        const projectsPage = new ProjectsViewPage(driver);
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        return await projectsPage.getSection(content);
    }

    async function getTestThemesSection(): Promise<any> {
        const driver = getDriver();
        const testThemesPage = new TestThemesPage(driver);
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        return await testThemesPage.getSection(content);
    }

    describe("Projects View Toolbar", function () {
        /*
         * 1. Open the Projects view toolbar in the TestBench sidebar.
         * 2. Read the visible toolbar button labels.
         * 3. Check whether a Logout action is present.
         * 4. Log the result
         */
        it("should have Logout button in toolbar", async function () {
            const driver = getDriver();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            const toolbarButtonLabelsOfProjects = await getToolbarButtonLabels(projectsSection, driver);
            logger.info("Toolbar", `Projects View toolbar buttons: ${toolbarButtonLabelsOfProjects.join(", ")}`);

            const hasLogoutByLabel = toolbarButtonLabelsOfProjects.some((l) => l.toLowerCase().includes("logout"));
            const hasLogoutBySelector = await hasToolbarButton(projectsSection, "logout", driver);
            const hasLogout = hasLogoutByLabel || hasLogoutBySelector;

            logger.info("Toolbar", `Logout button found: ${hasLogout}`);
            expect(hasLogout, "Projects View toolbar should expose a Logout action").to.equal(true);
            if (hasLogoutByLabel) {
                logger.info("Toolbar", "Logout button found in Projects View toolbar");
            }
        });

        /*
         * 1. Open the Projects view toolbar.
         * 2. Look for a Refresh action.
         * 3. Confirm whether the refresh control is available.
         */
        it("should have Refresh button in toolbar", async function () {
            const driver = getDriver();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            // Refresh button in projects view has title "Refresh Projects"
            const hasRefresh = await hasToolbarButton(projectsSection, "Refresh", driver);
            logger.info("Toolbar", `Refresh button found: ${hasRefresh}`);

            expect(hasRefresh, "Projects View toolbar should expose Refresh Projects action").to.equal(true);
            if (hasRefresh) {
                logger.info("Toolbar", "Refresh button found in Projects View toolbar");
            }
        });

        /*
         * 1. Open the Projects view toolbar.
         * 2. Look for a Search action.
         * 3. Confirm whether users can start a tree search from the toolbar.
         */
        it("should have Search button in toolbar", async function () {
            const driver = getDriver();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            // Search button in projects view has title "Search"
            const hasSearch = await hasToolbarButton(projectsSection, "Search", driver);
            logger.info("Toolbar", `Search button found: ${hasSearch}`);

            expect(hasSearch, "Projects View toolbar should expose a Search action").to.equal(true);
            if (hasSearch) {
                logger.info("Toolbar", "Search button found in Projects View toolbar");
            }
        });

        /*
         * 1. Open the Projects view toolbar.
         * 2. Read available toolbar button labels.
         * 3. Check whether a Settings/Extension Settings action exists.
         */
        it("should have Settings button in toolbar", async function () {
            const driver = getDriver();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            const toolbarButtonLabelsOfProjects = await getToolbarButtonLabels(projectsSection, driver);
            const hasSettingsByLabel = toolbarButtonLabelsOfProjects.some(
                (l) => l.toLowerCase().includes("setting") || l.toLowerCase().includes("extension")
            );
            const hasSettingsBySelector =
                (await hasToolbarButton(projectsSection, "setting", driver)) ||
                (await hasToolbarButton(projectsSection, "extension", driver));
            const hasSettings = hasSettingsByLabel || hasSettingsBySelector;

            logger.info("Toolbar", `Settings button found: ${hasSettings}`);
            expect(hasSettings, "Projects View toolbar should expose Open Extension Settings action").to.equal(true);
        });

        /*
         * 1. Open the Projects view and record the current visible items.
         * 2. Click the Refresh toolbar button.
         * 3. Wait until the tree finishes updating.
         * 4. Verify the Projects tree is still populated after refresh.
         */
        it("should refresh projects when Refresh button is clicked", async function () {
            const driver = getDriver();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            await waitForTreeItems(projectsSection, driver);
            const initialProjectsItemCount = (await projectsSection.getVisibleItems()).length;
            if (initialProjectsItemCount === 0) {
                skipPrecondition(this, "Projects tree has no items to validate refresh behavior");
            }

            const isRefreshButtonClicked = await clickToolbarButton(projectsSection, "refresh", driver);
            expect(isRefreshButtonClicked, "Refresh toolbar button should be clickable").to.equal(true);

            await applySlowMotion(driver);

            await waitForCondition(
                driver,
                async () => {
                    const items = await projectsSection.getVisibleItems();
                    return items.length >= 0;
                },
                UITimeouts.MEDIUM,
                200,
                "tree refresh"
            );

            const visibleProjectsItemsCount = (await projectsSection.getVisibleItems()).length;
            logger.info("Toolbar", `Items before: ${initialProjectsItemCount}, after: ${visibleProjectsItemsCount}`);

            expect(visibleProjectsItemsCount, "Tree should have items after refresh").to.be.greaterThan(0);
            logger.info("Toolbar", "Refresh completed successfully");
        });
    });

    describe("TOV and Cycle Action Buttons", function () {
        /*
         * 1. Open the configured project and test object version (TOV).
         * 2. Read action buttons shown on the TOV row.
         * 3. Verify an Open action is available to move into test themes.
         */
        it("should have 'Open' action button on TOV", async function () {
            const driver = getDriver();
            const config = getTestData();
            logTestDataConfig();
            const projectsPage = new ProjectsViewPage(driver);

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                skipPrecondition(this, `Project '${config.projectName}' not found`);
            }

            const version = await projectsPage.getVersion(project, config.versionName);
            if (!version) {
                skipPrecondition(this, `Version '${config.versionName}' not found`);
            }

            const actions = await getActionButtonLabels(version, driver);
            logger.info("Toolbar", `TOV action buttons: ${actions.join(", ")}`);

            const hasOpenAction = actions.some(
                (a) => a.toLowerCase().includes("open") || a.toLowerCase().includes("test themes")
            );
            expect(hasOpenAction, "TOV should have Open/Test Themes button").to.equal(true);

            logger.info("Toolbar", "Open action button found on TOV");
        });

        /*
         * 1. Open the configured project and test object version (TOV).
         * 2. Read action buttons shown on the TOV row.
         * 3. Verify a Generate action is available for creating Robot tests.
         */
        it("should have 'Generate' action button on TOV", async function () {
            const driver = getDriver();
            const config = getTestData();
            const projectsPage = new ProjectsViewPage(driver);

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                skipPrecondition(this, `Project '${config.projectName}' not found`);
            }

            const version = await projectsPage.getVersion(project, config.versionName);
            if (!version) {
                skipPrecondition(this, `Version '${config.versionName}' not found`);
            }

            const actions = await getActionButtonLabels(version, driver);
            const hasGenerateAction = actions.some(
                (a) => a.toLowerCase().includes("generate") || a.toLowerCase().includes("robot")
            );
            expect(hasGenerateAction, "TOV should have Generate button").to.equal(true);

            logger.info("Toolbar", "Generate action button found on TOV");
        });

        /*
         * 1. Open the configured project, version, and cycle.
         * 2. Read action buttons shown on the cycle row.
         * 3. Verify that at least one actionable button is present.
         */
        it("should have action buttons on Cycle", async function () {
            const driver = getDriver();
            const config = getTestData();
            const projectsPage = new ProjectsViewPage(driver);

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                skipPrecondition(this, `Project '${config.projectName}' not found`);
            }

            const version = await projectsPage.getVersion(project, config.versionName);
            if (!version) {
                skipPrecondition(this, `Version '${config.versionName}' not found`);
            }

            const cycle = await projectsPage.getCycle(version, config.cycleName);
            if (!cycle) {
                skipPrecondition(this, `Cycle '${config.cycleName}' not found`);
            }

            const actions = await getActionButtonLabels(cycle, driver);
            logger.info("Toolbar", `Cycle action buttons: ${actions.join(", ")}`);

            expect(actions.length).to.be.greaterThan(0, "Cycle should have action buttons");

            logger.info("Toolbar", "Action buttons found on Cycle");
        });
    });

    describe("Test Themes View Toolbar", function () {
        before(async function () {
            logger.info("Toolbar", "Navigating to Test Themes View...");
            const testViewNavigationResult = await navigateToTestView(getDriver(), "testThemes");
            if (!testViewNavigationResult.success) {
                skipPrecondition(this, `Failed to navigate to Test Themes View: ${testViewNavigationResult.error}`);
            }
        });

        /*
         * 1. Open the Test Themes view toolbar.
         * 2. Read visible toolbar button labels.
         * 3. Check whether an "Open Projects View" action exists.
         */
        it("should have 'Open Projects View' button in toolbar", async function () {
            const driver = getDriver();

            const testThemesSection = await getTestThemesSection();
            if (!testThemesSection) {
                logger.info("Toolbar", "Test Themes section not found");
                skipPrecondition(this, "Test Themes section not found");
            }

            const labels = await getToolbarButtonLabels(testThemesSection, driver);
            logger.info("Toolbar", `Test Themes View toolbar buttons: ${labels.join(", ")}`);

            const hasOpenProjects = labels.some(
                (l) => l.toLowerCase().includes("projects") || l.toLowerCase().includes("back")
            );
            logger.info("Toolbar", `Open Projects View button found: ${hasOpenProjects}`);

            expect(hasOpenProjects, "Test Themes toolbar should expose Open Projects View action").to.equal(true);
            if (hasOpenProjects) {
                logger.info("Toolbar", "Open Projects View button found");
            }
        });

        /*
         * 1. Open the Test Themes view toolbar.
         * 2. Look for a Refresh action
         * 3. Confirm whether the refresh control is available.
         */
        it("should have Refresh button in Test Themes toolbar", async function () {
            const driver = getDriver();

            const testThemesSection = await getTestThemesSection();
            if (!testThemesSection) {
                skipPrecondition(this, "Test Themes section not found");
            }

            const hasRefresh = await hasToolbarButton(testThemesSection, "Refresh", driver);
            logger.info("Toolbar", `Refresh button found: ${hasRefresh}`);

            expect(hasRefresh, "Test Themes toolbar should expose Refresh action").to.equal(true);
            if (hasRefresh) {
                logger.info("Toolbar", "Refresh button found in Test Themes toolbar");
            }
        });

        /*
         * 1. Start in Test Themes view.
         * 2. Click the "Open Projects View" toolbar action.
         * 3. Wait for the Projects view to appear.
         * 4. Confirm navigation back to Projects was successful.
         */
        it("should navigate back to Projects View when clicking 'Open Projects View'", async function () {
            const driver = getDriver();
            const projectsPage = new ProjectsViewPage(driver);
            const testThemesPage = new TestThemesPage(driver);

            const testThemesSection = await getTestThemesSection();
            if (!testThemesSection) {
                skipPrecondition(this, "Test Themes section not found");
            }

            const isOpenProjectsViewClicked = await testThemesPage.clickOpenProjectsView();
            if (!isOpenProjectsViewClicked) {
                // Fallback: try clicking toolbar button by name
                await clickToolbarButton(testThemesSection, "Open Projects View", driver);
            }

            await applySlowMotion(driver);
            await driver.sleep(1000);

            const projectsAppeared = await waitForProjectsView(driver);
            logger.info("Toolbar", `Projects View appeared: ${projectsAppeared}`);
            expect(projectsAppeared, "Projects View should appear after clicking Open Projects View").to.equal(true);

            const sideBar = new SideBarView();
            const content = sideBar.getContent();
            const projectsSection = await projectsPage.getSection(content);

            expect(projectsSection, "Projects section should be visible after navigation").to.satisfy(
                (section: unknown) => section !== undefined && section !== null
            );
            if (projectsSection) {
                logger.info("Toolbar", "Navigated back to Projects View");
            }
        });
    });

    describe("Logout and State Persistence", function () {
        /*
         * 1. Open the Projects view while logged in.
         * 2. Trigger Logout from the toolbar (or fallback logout flow).
         * 3. Wait for the login webview to become visible.
         * 4. Confirm the user is logged out.
         * 5. Log in again so other tests can continue.
         */
        it("should logout when Logout button is clicked", async function () {
            const driver = getDriver();

            if (!hasTestCredentials()) {
                logger.info("Toolbar", "No test credentials for logout test");
                skipPrecondition(this, "No test credentials for logout test");
            }

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            const logoutClicked = await clickToolbarButton(projectsSection, "logout", driver);
            if (!logoutClicked) {
                await attemptLogout(driver);
            }

            await applySlowMotion(driver);

            const webviewAppeared = await waitForCondition(
                driver,
                async () => await isWebviewAvailable(driver),
                UITimeouts.LONG,
                500,
                "login webview to appear"
            );

            expect(webviewAppeared, "Login webview should appear after logout").to.equal(true);

            if (webviewAppeared) {
                logger.info("Toolbar", "Logged out successfully - login page visible");
            }

            // Re-login for subsequent tests
            if (hasTestCredentials()) {
                await ensureLoggedInOrSkip(driver, "ToolbarActions", () => {});
            }
        });
    });
});
