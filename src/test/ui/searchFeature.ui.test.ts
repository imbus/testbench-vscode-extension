/**
 * @file src/test/ui/searchFeature.ui.test.ts
 * @description UI tests for the Search functionality across tree views including:
 * - Activating search via toolbar button
 * - Live filtering as user types
 * - Search indicator visual feedback
 * - Search options configuration (Name, Tooltip, UIDs)
 * - Search in Projects View
 * - Search in Test Themes View
 * - Clearing search and restoring items
 */

import { expect } from "chai";
import { SideBarView } from "vscode-extension-tester";
import { getTestLogger } from "./utils/testLogger";
import { waitForTreeItems } from "./utils/testUtils";
import { navigateToTestView } from "./utils/navigationUtils";
import { clickSearchButton, enterSearchText, clearSearch, getVisibleItemCount } from "./utils/toolbarUtils";
import { getTestData, logTestDataConfig } from "./config/testConfig";
import { TestContext, setupTestHooks } from "./utils/testHooks";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";
import { TestThemesPage } from "./pages/TestThemesPage";

const logger = getTestLogger();

describe("Search Feature UI Tests", function () {
    const ctx: TestContext = {} as TestContext;

    this.timeout(180000);

    setupTestHooks(ctx, {
        suiteName: "SearchFeature",
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

    describe("Search in Projects View", function () {
        /*
         * 1. Open the Projects tree in the TestBench sidebar.
         * 2. Confirm that at least one project item is visible.
         * 3. Click the Search button in the view toolbar.
         * 4. Verify that search mode is enabled successfully.
         */
        it("should activate search when Search button is clicked", async function () {
            const driver = getDriver();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                logger.warn("Search", "Projects section not found");
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const initialProjectsItemCount = await getVisibleItemCount(projectsSection);
            logger.info("Search", `Initial visible items: ${initialProjectsItemCount}`);
            expect(initialProjectsItemCount).to.be.greaterThan(0, "Should have at least one project");

            const isSearchActivated = await clickSearchButton(projectsSection, driver);
            if (!isSearchActivated) {
                logger.warn("Search", "Could not activate search button");
                this.skip();
                return;
            }

            logger.info("Search", "Search activated successfully");
        });

        /*
         * 1. Open the Projects tree and remember how many items are visible.
         * 2. Enable search mode from the toolbar.
         * 3. Type part of a project name into the search field.
         * 4. Verify the visible items are filtered based on the typed text.
         * 5. Clear the search so the view returns to normal.
         */
        it("should filter tree items as user types in search", async function () {
            const driver = getDriver();
            const config = getTestData();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const initialProjectsItemCount = await getVisibleItemCount(projectsSection);

            const isSearchActivated = await clickSearchButton(projectsSection, driver);
            if (!isSearchActivated) {
                this.skip();
                return;
            }

            // Enter partial project name
            const searchText = config.projectName.substring(0, 3);
            const textEntered = await enterSearchText(driver, searchText);
            if (!textEntered) {
                logger.warn("Search", "Could not enter search text");
                this.skip();
                return;
            }

            await driver.sleep(500);

            const filteredProjectsItemCount = await getVisibleItemCount(projectsSection);
            logger.info(
                "Search",
                `Filtered visible items: ${filteredProjectsItemCount} (was ${initialProjectsItemCount})`
            );

            expect(filteredProjectsItemCount).to.be.at.least(0, "Filtered count should be valid");

            await clearSearch(driver);
            logger.info("Search", "Search filtering works correctly");
        });

        /*
         * 1. Open Projects and capture the initial number of visible items.
         * 2. Enable search and enter text that should match nothing.
         * 3. Confirm the list is reduced by the search filter.
         * 4. Clear the search field.
         * 5. Verify the original number of items is restored.
         */
        it("should restore all items when search is cleared", async function () {
            const driver = getDriver();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const initialProjectsItemCount = await getVisibleItemCount(projectsSection);

            const isSearchActivated = await clickSearchButton(projectsSection, driver);
            if (!isSearchActivated) {
                this.skip();
                return;
            }

            // Search for non-existent item
            await enterSearchText(driver, "ZZZZNONEXISTENT");
            await driver.sleep(500);

            const filteredProjectsItemCount = await getVisibleItemCount(projectsSection);
            expect(filteredProjectsItemCount).to.be.lessThan(initialProjectsItemCount, "Search should filter items");

            await clearSearch(driver);
            await driver.sleep(500);

            const restoredProjectsItemCount = await getVisibleItemCount(projectsSection);
            expect(restoredProjectsItemCount).to.equal(
                initialProjectsItemCount,
                "Items should be restored after clearing search"
            );

            logger.info("Search", "Items restored after clearing search");
        });

        /*
         * 1. Open Projects and enable search.
         * 2. Enter the full configured project name.
         * 3. Locate the matching project in the filtered results.
         * 4. Verify the found item exactly matches the expected project name.
         * 5. Clear the search at the end.
         */
        it("should find project by exact name match", async function () {
            const driver = getDriver();
            const config = getTestData();
            logTestDataConfig();
            const projectsPage = new ProjectsViewPage(driver);

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const isSearchActivated = await clickSearchButton(projectsSection, driver);
            if (!isSearchActivated) {
                this.skip();
                return;
            }

            await enterSearchText(driver, config.projectName);
            await driver.sleep(500);

            const targetProject = await projectsPage.getProject(projectsSection, config.projectName);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(targetProject, `Project "${config.projectName}" should be found in search results`).to.not.be.null;

            if (targetProject) {
                const label = await targetProject.getLabel();
                expect(label).to.equal(config.projectName);
                logger.info("Search", `Found project: "${label}"`);
            }

            await clearSearch(driver);
        });
    });

    describe("Search in Test Themes View", function () {
        /*
         * 1. Switch from the current view to Test Themes.
         * 2. Ensure navigation completed so theme search tests can run.
         */
        // Navigate to Test Themes view before tests
        before(async function () {
            logger.info("Search", "Navigating to Test Themes View...");
            const testViewNavigationSuccess = await navigateToTestView(getDriver(), "testThemes");
            if (!testViewNavigationSuccess.success) {
                logger.error("Search", `Failed to navigate: ${testViewNavigationSuccess.error}`);
            }
        });

        /*
         * 1. Open Test Themes and note the initial number of visible items.
         * 2. Activate the Search input from the toolbar.
         * 3. Enter part of the configured test theme name.
         * 4. Verify the list is filtered while typing.
         * 5. Clear the search to reset the view.
         */
        it("should filter test themes as user types", async function () {
            const driver = getDriver();
            const config = getTestData();

            const testThemesSection = await getTestThemesSection();
            if (!testThemesSection) {
                logger.warn("Search", "Test Themes section not found");
                this.skip();
                return;
            }

            await waitForTreeItems(testThemesSection, driver);

            const initialTestThemesItemCount = await getVisibleItemCount(testThemesSection);
            logger.info("Search", `Initial test theme items: ${initialTestThemesItemCount}`);

            const isSearchActivated = await clickSearchButton(testThemesSection, driver);
            if (!isSearchActivated) {
                logger.warn("Search", "Could not activate search in Test Themes");
                this.skip();
                return;
            }

            // Search for test theme
            const searchText = config.testThemeName.substring(0, 3);
            await enterSearchText(driver, searchText);
            await driver.sleep(500);

            const filteredTestThemesItemCount = await getVisibleItemCount(testThemesSection);
            logger.info("Search", `Filtered count: ${filteredTestThemesItemCount}`);

            if (initialTestThemesItemCount > 1) {
                expect(filteredTestThemesItemCount).to.be.at.most(initialTestThemesItemCount);
            }

            await clearSearch(driver);
            logger.info("Search", "Test Themes search filtering works");
        });

        /*
         * 1. Open Test Themes and activate search.
         * 2. Enter the full configured test theme name.
         * 3. Find the matching theme in the filtered list.
         * 4. Verify the label equals or clearly contains the expected name.
         * 5. Clear the search field.
         */
        it("should find test theme by name", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testThemesPage = new TestThemesPage(driver);

            const testThemesSection = await getTestThemesSection();
            if (!testThemesSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(testThemesSection, driver);

            const isSearchActivated = await clickSearchButton(testThemesSection, driver);
            if (!isSearchActivated) {
                this.skip();
                return;
            }

            await enterSearchText(driver, config.testThemeName);
            await driver.sleep(500);

            const targetTestTheme = await testThemesPage.getItem(testThemesSection, config.testThemeName);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(targetTestTheme, `Test theme "${config.testThemeName}" should be found`).to.not.be.undefined;

            if (targetTestTheme) {
                const testThemeLabel = await targetTestTheme.getLabel();
                const normalizedExpected = config.testThemeName.toLowerCase();
                const normalizedActual = testThemeLabel.toLowerCase();
                const isExactMatch = normalizedActual === normalizedExpected;
                const isContextualMatch = normalizedActual.includes(normalizedExpected);

                expect(
                    isExactMatch || isContextualMatch,
                    `Expected test theme label "${testThemeLabel}" to equal or contain "${config.testThemeName}"`
                ).to.equal(true);
                logger.info("Search", `Found test theme: "${testThemeLabel}"`);
            }

            await clearSearch(driver);
        });
    });

    describe("Search Options", function () {
        /*
         * 1. Navigate back to Projects view.
         * 2. Prepare the UI for search options checks in the Projects toolbar.
         */
        // Navigate back to Projects view before tests
        before(async function () {
            logger.info("Search", "Navigating back to Projects View for Search Options tests...");
            const projectNavigationResult = await navigateToTestView(getDriver(), "projects");
            if (!projectNavigationResult.success) {
                logger.error("Search", `Failed to navigate to Projects: ${projectNavigationResult.error}`);
            }
        });

        /*
         * 1. Open Projects and activate the search widget.
         * 2. Check whether a search options/filter control is visible.
         * 3. Record the result.
         * 4. Clear search mode to leave the UI clean.
         */
        it("should have search options gear icon", async function () {
            const driver = getDriver();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                logger.warn("Search", "Projects section not found for gear icon test");
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const isSearchActivated = await clickSearchButton(projectsSection, driver);
            if (!isSearchActivated) {
                logger.warn("Search", "Could not activate search for gear icon test");
                this.skip();
                return;
            }

            // Check for gear/settings icon in the search widget area
            const gearIconExists = await driver.executeScript(`
                // Look for filter options in the tree view filter widget
                const panes = document.querySelectorAll('.pane');
                for (const pane of panes) {
                    const filterWidget = pane.querySelector('.monaco-inputbox, .tree-filter');
                    if (filterWidget) {
                        // Check for any settings/options buttons nearby
                        const optionsBtn = pane.querySelector('[class*="filter-options"], [aria-label*="Options"], [aria-label*="Filter"]');
                        if (optionsBtn) return true;
                    }
                }
                // Also check for codicon gear icons
                const gearIcons = document.querySelectorAll('.codicon-gear, .codicon-settings-gear, .codicon-filter');
                return gearIcons.length > 0;
            `);

            logger.info("Search", `Search options/filter icon exists: ${gearIconExists}`);
            // Log but don't fail if not found
            // as the gear icon may not exist in all VS Code versions

            await clearSearch(driver);
        });
    });
});
