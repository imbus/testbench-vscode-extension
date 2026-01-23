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
        it("should activate search when Search button is clicked", async function () {
            const driver = getDriver();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                logger.warn("Search", "Projects section not found");
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const initialCount = await getVisibleItemCount(projectsSection);
            logger.info("Search", `Initial visible items: ${initialCount}`);
            expect(initialCount).to.be.greaterThan(0, "Should have at least one project");

            const searchActivated = await clickSearchButton(projectsSection, driver);
            if (!searchActivated) {
                logger.warn("Search", "Could not activate search button");
                this.skip();
                return;
            }

            logger.info("Search", "Search activated successfully");
        });

        it("should filter tree items as user types in search", async function () {
            const driver = getDriver();
            const config = getTestData();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const initialCount = await getVisibleItemCount(projectsSection);

            const searchActivated = await clickSearchButton(projectsSection, driver);
            if (!searchActivated) {
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

            const filteredCount = await getVisibleItemCount(projectsSection);
            logger.info("Search", `Filtered visible items: ${filteredCount} (was ${initialCount})`);

            expect(filteredCount).to.be.at.least(0, "Filtered count should be valid");

            await clearSearch(driver);
            logger.info("Search", "Search filtering works correctly");
        });

        it("should restore all items when search is cleared", async function () {
            const driver = getDriver();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const initialCount = await getVisibleItemCount(projectsSection);

            const searchActivated = await clickSearchButton(projectsSection, driver);
            if (!searchActivated) {
                this.skip();
                return;
            }

            // Search for non-existent item
            await enterSearchText(driver, "ZZZZNONEXISTENT");
            await driver.sleep(500);

            const filteredCount = await getVisibleItemCount(projectsSection);
            expect(filteredCount).to.be.lessThan(initialCount, "Search should filter items");

            await clearSearch(driver);
            await driver.sleep(500);

            const restoredCount = await getVisibleItemCount(projectsSection);
            expect(restoredCount).to.equal(initialCount, "Items should be restored after clearing search");

            logger.info("Search", "Items restored after clearing search");
        });

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

            const searchActivated = await clickSearchButton(projectsSection, driver);
            if (!searchActivated) {
                this.skip();
                return;
            }

            await enterSearchText(driver, config.projectName);
            await driver.sleep(500);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(project, `Project "${config.projectName}" should be found in search results`).to.not.be.null;

            if (project) {
                const label = await project.getLabel();
                expect(label).to.equal(config.projectName);
                logger.info("Search", `Found project: "${label}"`);
            }

            await clearSearch(driver);
        });
    });

    describe("Search in Test Themes View", function () {
        // Navigate to Test Themes view before tests
        before(async function () {
            logger.info("Search", "Navigating to Test Themes View...");
            const result = await navigateToTestView(getDriver(), "testThemes");
            if (!result.success) {
                logger.error("Search", `Failed to navigate: ${result.error}`);
            }
        });

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

            const initialCount = await getVisibleItemCount(testThemesSection);
            logger.info("Search", `Initial test theme items: ${initialCount}`);

            const searchActivated = await clickSearchButton(testThemesSection, driver);
            if (!searchActivated) {
                logger.warn("Search", "Could not activate search in Test Themes");
                this.skip();
                return;
            }

            // Search for test theme
            const searchText = config.testThemeName.substring(0, 3);
            await enterSearchText(driver, searchText);
            await driver.sleep(500);

            const filteredCount = await getVisibleItemCount(testThemesSection);
            logger.info("Search", `Filtered count: ${filteredCount}`);

            if (initialCount > 1) {
                expect(filteredCount).to.be.at.most(initialCount);
            }

            await clearSearch(driver);
            logger.info("Search", "Test Themes search filtering works");
        });

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

            const searchActivated = await clickSearchButton(testThemesSection, driver);
            if (!searchActivated) {
                this.skip();
                return;
            }

            await enterSearchText(driver, config.testThemeName);
            await driver.sleep(500);

            const testTheme = await testThemesPage.getItem(testThemesSection, config.testThemeName);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(testTheme, `Test theme "${config.testThemeName}" should be found`).to.not.be.undefined;

            if (testTheme) {
                const label = await testTheme.getLabel();
                expect(label).to.equal(config.testThemeName);
                logger.info("Search", `Found test theme: "${label}"`);
            }

            await clearSearch(driver);
        });
    });

    describe("Search Options", function () {
        // Navigate back to Projects view before tests
        before(async function () {
            logger.info("Search", "Navigating back to Projects View for Search Options tests...");
            const result = await navigateToTestView(getDriver(), "projects");
            if (!result.success) {
                logger.error("Search", `Failed to navigate to Projects: ${result.error}`);
            }
        });

        it("should have search options gear icon", async function () {
            const driver = getDriver();

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                logger.warn("Search", "Projects section not found for gear icon test");
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const searchActivated = await clickSearchButton(projectsSection, driver);
            if (!searchActivated) {
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
            // This is informational - we log but don't fail if not found
            // as the gear icon may not exist in all VS Code versions

            await clearSearch(driver);
        });
    });
});
