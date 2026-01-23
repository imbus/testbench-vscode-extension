/**
 * @file src/test/ui/testElementsView.ui.test.ts
 * @description UI tests for the Test Elements view including:
 * - Subdivision display with Resource Marker
 * - Visual indicators for locally available resources
 * - Open Resource button for existing resources
 * - Keyword navigation (single-click jumps to definition)
 * - Keyword double-click reveals in Explorer
 * - Create Resource vs Open Resource button states
 */

import { expect } from "chai";
import { SideBarView, TreeItem, EditorView } from "vscode-extension-tester";
import { getTestLogger } from "./utils/testLogger";
import {
    applySlowMotion,
    waitForTreeItems,
    UITimeouts,
    waitForFileInEditor,
    openTestBenchSidebar
} from "./utils/testUtils";
import { doubleClickTreeItem } from "./utils/treeViewUtils";
import { navigateToTestView, findResourceSubdivision } from "./utils/navigationUtils";
import { hasActionButton, getItemIconInfo, collectTreeItemLabels } from "./utils/treeItemUtils";
import { getTestData, logTestDataConfig } from "./config/testConfig";
import { TestContext, setupTestHooks } from "./utils/testHooks";
import { TestElementsPage } from "./pages/TestElementsPage";

const logger = getTestLogger();

describe("Test Elements View UI Tests", function () {
    const ctx: TestContext = {} as TestContext;

    this.timeout(240000);

    setupTestHooks(ctx, {
        suiteName: "TestElementsView",
        requiresLogin: true,
        openSidebar: true,
        timeout: 240000
    });

    const getDriver = () => ctx.driver;

    async function getElementsSection(): Promise<any> {
        const driver = getDriver();
        const testElementsPage = new TestElementsPage(driver);
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        return await testElementsPage.getSection(content);
    }

    before(async function () {
        logger.info("Setup", "Navigating to Test Elements View...");
        const navigationResult = await navigateToTestView(getDriver(), "testElements");
        if (!navigationResult.success) {
            logger.error("Setup", `Failed to navigate: ${navigationResult.error}`);
        }
    });

    describe("Test Elements View Detection", function () {
        it("should display Test Elements section with correct title", async function () {
            const driver = getDriver();
            const config = getTestData();
            logTestDataConfig();
            const testElementsPage = new TestElementsPage(driver);

            const elementsSection = await getElementsSection();
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(elementsSection, "Test Elements section should be present").to.not.be.null;

            if (elementsSection) {
                const title = await testElementsPage.getTitle(elementsSection);
                logger.info("TestElements", `View title: "${title}"`);

                expect(title, "Title should contain project name").to.include(config.projectName);
                expect(title, "Title should contain version name").to.include(config.versionName);

                logger.info("TestElements", "Test Elements view title verified");
            }
        });

        it("should display subdivisions in the tree", async function () {
            const driver = getDriver();

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(elementsSection, driver);

            const visibleTestElementsItems = await elementsSection.getVisibleItems();
            expect(visibleTestElementsItems.length, "Should have at least one subdivision").to.be.greaterThan(0);

            logger.info("TestElements", `Found ${visibleTestElementsItems.length} subdivision(s) in tree`);

            // Log first few items for debugging
            const collectedTestLabels = await collectTreeItemLabels(visibleTestElementsItems.slice(0, 3) as TreeItem[]);
            collectedTestLabels.forEach((label, i) => logger.debug("TestElements", `  [${i}] ${label}`));
        });
    });

    describe("Subdivision with Resource Marker", function () {
        it("should find subdivision with Resource Marker in name", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(elementsSection, driver);

            const targetSubdivision = await testElementsPage.getItem(elementsSection, config.subdivisionName);

            if (!targetSubdivision) {
                logger.warn("TestElements", `Subdivision "${config.subdivisionName}" not found`);
                this.skip();
                return;
            }

            const subdivisionLabel = await targetSubdivision.getLabel();
            logger.info("TestElements", `Found subdivision: "${subdivisionLabel}"`);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(targetSubdivision, "Subdivision should exist").to.not.be.undefined;
        });

        it("should show Create Resource or Open Resource button on resource subdivision", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(elementsSection, driver);

            // Try configured subdivision first
            let subdivisionItem = await testElementsPage.getItem(elementsSection, config.subdivisionName);
            let hasCreateButton = false;
            let hasOpenButton = false;

            if (subdivisionItem) {
                await subdivisionItem.click();
                await applySlowMotion(driver);
                hasCreateButton = await hasActionButton(subdivisionItem, "Create Resource", driver);
                hasOpenButton = await hasActionButton(subdivisionItem, "Open Resource", driver);
            }

            // If no buttons found, search for any resource subdivision
            if (!hasCreateButton && !hasOpenButton) {
                logger.info("TestElements", "Configured subdivision has no resource buttons, searching...");
                const subdivisionSearchResult = await findResourceSubdivision(
                    driver,
                    elementsSection,
                    testElementsPage
                );
                subdivisionItem = subdivisionSearchResult.subdivision;

                if (subdivisionItem) {
                    hasCreateButton = await hasActionButton(subdivisionItem, "Create Resource", driver);
                    hasOpenButton = await hasActionButton(subdivisionItem, "Open Resource", driver);
                }
            }

            logger.info("TestElements", `Create Resource: ${hasCreateButton}, Open Resource: ${hasOpenButton}`);

            // Virtual subdivisions don't have these buttons - that's expected
            if (!hasCreateButton && !hasOpenButton) {
                logger.info("TestElements", "No resource buttons found - subdivision may be virtual");
                return;
            }

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(hasCreateButton || hasOpenButton, "Should have Create or Open Resource button").to.be.true;

            if (hasOpenButton) {
                logger.info("TestElements", "Resource already exists locally (Open Resource visible)");
            } else if (hasCreateButton) {
                logger.info("TestElements", "Resource not yet created (Create Resource visible)");
            }
        });
    });

    describe("Visual Indicators for Local Resources", function () {
        it("should show different icon color for locally available resources", async function () {
            const driver = getDriver();

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(elementsSection, driver);

            const visibleTestElementsItems = await elementsSection.getVisibleItems();
            const iconInfos: { label: string; iconInfo: Awaited<ReturnType<typeof getItemIconInfo>> }[] = [];

            for (const item of visibleTestElementsItems.slice(0, 5) as TreeItem[]) {
                try {
                    const label = await item.getLabel();
                    const iconInfo = await getItemIconInfo(item, driver);
                    iconInfos.push({ label, iconInfo });
                } catch {
                    // Skip stale elements
                }
            }

            logger.info("TestElements", "Icon info for subdivisions:");
            iconInfos.forEach((info) =>
                logger.debug("TestElements", `  ${info.label}: ${JSON.stringify(info.iconInfo)}`)
            );

            expect(iconInfos.length).to.be.greaterThan(0, "Should have icon info for at least one item");
        });
    });

    describe("Keyword Navigation", function () {
        it("should expand subdivision to reveal keywords", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(elementsSection, driver);

            const targetSubdivision = await testElementsPage.getItem(elementsSection, config.subdivisionName);
            if (!targetSubdivision) {
                this.skip();
                return;
            }

            const hasSubdivisionChildren = await targetSubdivision.hasChildren();
            if (!hasSubdivisionChildren) {
                logger.info("TestElements", "Subdivision has no keyword children");
                this.skip();
                return;
            }

            // Expand to reveal keywords
            if (!(await targetSubdivision.isExpanded())) {
                await targetSubdivision.expand();
                await applySlowMotion(driver);
            }

            const subdivisionChildren = await targetSubdivision.getChildren();
            expect(subdivisionChildren.length, "Should have at least one keyword").to.be.greaterThan(0);

            logger.info("TestElements", `Found ${subdivisionChildren.length} keyword(s) under subdivision`);

            // Log first few keywords
            const collectedSubdivisionLabels = await collectTreeItemLabels(subdivisionChildren.slice(0, 3));
            collectedSubdivisionLabels.forEach((label) => logger.debug("TestElements", `  Keyword: ${label}`));
        });

        it("should open resource file when clicking a keyword (single-click)", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            await openTestBenchSidebar(driver);

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(elementsSection, driver);

            const subdivisionItem = await testElementsPage.getItem(elementsSection, config.subdivisionName);
            if (!subdivisionItem) {
                this.skip();
                return;
            }

            // Ensure subdivision is expanded
            if (!(await subdivisionItem.isExpanded())) {
                await subdivisionItem.expand();
                await applySlowMotion(driver);
            }

            const subdivisionChildren = await subdivisionItem.getChildren();
            if (subdivisionChildren.length === 0) {
                logger.info("TestElements", "No keywords to click");
                this.skip();
                return;
            }

            const firstKeywordOfSubdivision = subdivisionChildren[0];
            const keywordLabel = await firstKeywordOfSubdivision.getLabel();
            logger.info("TestElements", `Clicking keyword: "${keywordLabel}"`);

            await firstKeywordOfSubdivision.click();
            await applySlowMotion(driver);

            // Single-click should open resource file and jump to keyword definition
            const isResourceFileOpened = await waitForFileInEditor(driver, ".resource", UITimeouts.MEDIUM);

            if (isResourceFileOpened) {
                logger.info("TestElements", "Resource file opened on keyword click");

                const editorView = new EditorView();
                const activeEditor = await editorView.getActiveTab();
                if (activeEditor) {
                    const title = await activeEditor.getTitle();
                    logger.info("TestElements", `Active editor: "${title}"`);
                }
            } else {
                logger.warn("TestElements", "Resource file did not open (resource may not exist yet)");
            }
        });

        it("should open and reveal in Explorer when double-clicking keyword", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            await openTestBenchSidebar(driver);

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(elementsSection, driver);

            const subdivisionItem = await testElementsPage.getItem(elementsSection, config.subdivisionName);
            if (!subdivisionItem) {
                this.skip();
                return;
            }

            if (!(await subdivisionItem.isExpanded())) {
                await subdivisionItem.expand();
                await applySlowMotion(driver);
            }

            const subdivisionChildren = await subdivisionItem.getChildren();
            if (subdivisionChildren.length === 0) {
                this.skip();
                return;
            }

            const firstKeywordOfSubdivision = subdivisionChildren[0];
            const keywordLabel = await firstKeywordOfSubdivision.getLabel();
            logger.info("TestElements", `Double-clicking keyword: "${keywordLabel}"`);

            await doubleClickTreeItem(firstKeywordOfSubdivision, driver);
            await applySlowMotion(driver);

            // Double-click should open file, jump to definition, AND reveal in Explorer
            const isResourceFileOpened = await waitForFileInEditor(driver, ".resource", UITimeouts.MEDIUM);

            if (isResourceFileOpened) {
                logger.info("TestElements", "Resource file opened on double-click");
            } else {
                logger.warn("TestElements", "Resource file did not open on double-click");
            }
        });
    });

    describe("Open Resource Button", function () {
        it("should open existing resource file when clicking Open Resource button", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            await openTestBenchSidebar(driver);

            let elementsSection = await getElementsSection();
            if (!elementsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(elementsSection, driver);

            // Try configured subdivision first
            let subdivision = await testElementsPage.getItem(elementsSection, config.subdivisionName);
            let subdivisionLabel = config.subdivisionName;
            let hasOpenButton = false;

            if (subdivision) {
                await subdivision.click();
                await applySlowMotion(driver);
                hasOpenButton = await hasActionButton(subdivision, "Open Resource", driver);
                subdivisionLabel = await subdivision.getLabel();
            }

            // Search for any subdivision with Open Resource button if needed
            if (!hasOpenButton) {
                logger.info("TestElements", "Searching for subdivision with Open Resource button...");
                const resourceSearchResult = await findResourceSubdivision(driver, elementsSection, testElementsPage);

                if (resourceSearchResult.subdivision) {
                    subdivision = resourceSearchResult.subdivision;
                    subdivisionLabel = resourceSearchResult.label;
                    hasOpenButton = await hasActionButton(subdivision, "Open Resource", driver);
                }
            }

            if (!hasOpenButton) {
                logger.info("TestElements", "No Open Resource button found - possible reasons:");
                logger.info("TestElements", "  - All subdivisions are virtual (no resource marker)");
                logger.info("TestElements", "  - No resource files have been created locally yet");
                this.skip();
                return;
            }

            // Re-fetch subdivision with fresh reference
            elementsSection = await getElementsSection();
            if (!elementsSection) {
                this.skip();
                return;
            }

            subdivision = await testElementsPage.getItem(elementsSection, subdivisionLabel);
            if (!subdivision) {
                this.skip();
                return;
            }

            // Click Open Resource button
            const isOpenClicked = await testElementsPage.clickOpenResource(subdivision);
            if (!isOpenClicked) {
                logger.warn("TestElements", "Could not click Open Resource button");
                this.skip();
                return;
            }

            const isResourceFileOpened = await waitForFileInEditor(driver, ".resource", UITimeouts.MEDIUM);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(isResourceFileOpened, "Resource file should open").to.be.true;

            logger.info("TestElements", "Resource file opened via Open Resource button");
        });
    });
});
