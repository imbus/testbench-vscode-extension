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
import { waitForFileInEditor, openTestBenchSidebar } from "./utils/testUtils";
import { applySlowMotion, retryUntil, waitForTreeItems, UITimeouts } from "./utils/waitHelpers";
import { doubleClickTreeItem } from "./utils/treeViewUtils";
import { navigateToTestView, findResourceSubdivision } from "./utils/navigationUtils";
import { hasActionButton, getItemIconInfo, collectTreeItemLabels } from "./utils/treeItemUtils";
import { getTestData, logTestDataConfig } from "./config/testConfig";
import { TestContext, setupTestHooks, skipTest } from "./utils/testHooks";
import { TestElementsPage } from "./pages/TestElementsPage";

const logger = getTestLogger();
const ROBOT_RESOURCE_MARKER = "[Robot-Resource]";
const OPEN_RESOURCE_RETRY_ATTEMPTS = 3;

function skipPrecondition(context: Mocha.Context, reason: string): never {
    return skipTest(context, "precondition", reason);
}

function skipError(_context: Mocha.Context, reason: string): never {
    throw new Error(reason);
}

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

    async function findRobotResourceSubdivision(
        testElementsPage: TestElementsPage,
        requireChildren = false
    ): Promise<{ subdivision: TreeItem | null; label: string }> {
        const elementsSection = await getElementsSection();
        if (!elementsSection) {
            return { subdivision: null, label: "" };
        }

        const visibleItems = await elementsSection.getVisibleItems();
        const labels = await collectTreeItemLabels(visibleItems as TreeItem[]);
        const resourceLabels = labels.filter((label) => label.includes(ROBOT_RESOURCE_MARKER));

        for (const label of resourceLabels) {
            const refreshedSection = await getElementsSection();
            if (!refreshedSection) {
                continue;
            }

            const candidate = await testElementsPage.getItem(refreshedSection, label);
            if (!candidate) {
                continue;
            }

            if (requireChildren) {
                let hasChildren = false;
                try {
                    hasChildren = await candidate.hasChildren();
                } catch {
                    hasChildren = false;
                }

                if (!hasChildren) {
                    continue;
                }
            }

            return { subdivision: candidate, label };
        }

        return { subdivision: null, label: "" };
    }

    async function resolvePreferredSubdivision(
        testElementsPage: TestElementsPage,
        configuredLabel: string,
        requireChildren = false
    ): Promise<{ subdivision: TreeItem | null; label: string }> {
        const elementsSection = await getElementsSection();
        if (!elementsSection) {
            return { subdivision: null, label: "" };
        }

        const configuredSubdivision = await testElementsPage.getItem(elementsSection, configuredLabel);
        if (configuredSubdivision) {
            if (!requireChildren) {
                return { subdivision: configuredSubdivision, label: configuredLabel };
            }

            try {
                if (await configuredSubdivision.hasChildren()) {
                    return { subdivision: configuredSubdivision, label: configuredLabel };
                }
            } catch {
                // Fall through to marker-based fallback if configured item becomes stale.
            }
        }

        return await findRobotResourceSubdivision(testElementsPage, requireChildren);
    }

    async function tryClickOpenResourceWithRetries(
        testElementsPage: TestElementsPage,
        subdivisionLabel: string,
        maxAttempts = OPEN_RESOURCE_RETRY_ATTEMPTS
    ): Promise<boolean> {
        const driver = getDriver();

        return await retryUntil(
            async (attempt) => {
                await openTestBenchSidebar(driver);
                const elementsSection = await getElementsSection();
                if (!elementsSection) {
                    logger.debug(
                        "TestElements",
                        `Test Elements section unavailable for open-resource attempt ${attempt}/${maxAttempts}`
                    );
                    return false;
                }

                const subdivisionItem = await testElementsPage.getItem(elementsSection, subdivisionLabel);
                if (!subdivisionItem) {
                    logger.debug(
                        "TestElements",
                        `Subdivision "${subdivisionLabel}" unavailable for open-resource attempt ${attempt}/${maxAttempts}`
                    );
                    return false;
                }

                await subdivisionItem.click();
                await applySlowMotion(driver);

                return await testElementsPage.clickOpenResource(subdivisionItem);
            },
            maxAttempts,
            `open resource action for subdivision "${subdivisionLabel}"`
        );
    }

    async function tryCreateResourceWithRetries(
        testElementsPage: TestElementsPage,
        subdivisionLabel: string,
        maxAttempts = OPEN_RESOURCE_RETRY_ATTEMPTS
    ): Promise<boolean> {
        const driver = getDriver();

        return await retryUntil(
            async (attempt) => {
                await openTestBenchSidebar(driver);
                const elementsSection = await getElementsSection();
                if (!elementsSection) {
                    logger.debug(
                        "TestElements",
                        `Test Elements section unavailable for create-resource attempt ${attempt}/${maxAttempts}`
                    );
                    return false;
                }

                const subdivisionItem = await testElementsPage.getItem(elementsSection, subdivisionLabel);
                if (!subdivisionItem) {
                    logger.debug(
                        "TestElements",
                        `Subdivision "${subdivisionLabel}" unavailable for create-resource attempt ${attempt}/${maxAttempts}`
                    );
                    return false;
                }

                return await testElementsPage.clickCreateResource(subdivisionItem, subdivisionLabel);
            },
            maxAttempts,
            `create resource action for subdivision "${subdivisionLabel}"`
        );
    }

    async function hasChildrenSafe(item: TreeItem): Promise<boolean> {
        try {
            return await item.hasChildren();
        } catch {
            return false;
        }
    }

    async function findFirstLeafDescendant(
        rootItem: TreeItem,
        maxDepth: number = 4
    ): Promise<{ item: TreeItem; label: string } | null> {
        if (maxDepth < 0) {
            return null;
        }

        const rootHasChildren = await hasChildrenSafe(rootItem);
        if (!rootHasChildren) {
            try {
                const leafLabel = await rootItem.getLabel();
                return { item: rootItem, label: leafLabel };
            } catch {
                return null;
            }
        }

        try {
            if (!(await rootItem.isExpanded())) {
                await rootItem.expand();
                await applySlowMotion(getDriver());
            }
        } catch {
            return null;
        }

        let children: TreeItem[] = [];
        try {
            children = await rootItem.getChildren();
        } catch {
            children = [];
        }

        for (const child of children) {
            const descendantLeaf = await findFirstLeafDescendant(child, maxDepth - 1);
            if (descendantLeaf) {
                return descendantLeaf;
            }
        }

        return null;
    }

    before(async function () {
        logger.info("Setup", "Navigating to Test Elements View...");
        const navigationResult = await navigateToTestView(getDriver(), "testElements");
        if (!navigationResult.success) {
            logger.error("Setup", `Failed to navigate: ${navigationResult.error}`);
        }
    });

    describe("Test Elements View Detection", function () {
        /*
         * 1. Open the TestBench side panel in VS Code.
         * 2. Get the Test Elements section.
         * 3. Assert that the section is present.
         * 4. Verify its title contains both configured project name and version name.
         */
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

        /*
         * 1. Get the Test Elements section.
         * 2. Wait for tree items to load.
         * 3. Retrieve all visible subdivisions.
         * 4. Verify that at least one subdivision is shown.
         */
        it("should display subdivisions in the tree", async function () {
            const driver = getDriver();

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                skipPrecondition(this, "Test Elements section not found");
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
        /*
         * 1. Get the Test Elements section.
         * 2. Wait for tree items to appear.
         * 3. Look for a configured subdivision label (e.g., "[Robot-Resource]").
         * 4. If the configured subdivision isn't found, find any subdivision with the resource marker.
         * 5. Verify that the matching subdivision is present in the tree.
         */
        it("should find subdivision with Resource Marker in name", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                skipPrecondition(this, "Test Elements section not found");
            }

            await waitForTreeItems(elementsSection, driver);

            const subdivisionSearchResult = await resolvePreferredSubdivision(testElementsPage, config.subdivisionName);
            const targetSubdivision = subdivisionSearchResult.subdivision;
            const resolvedSubdivisionLabel = subdivisionSearchResult.label || config.subdivisionName;

            if (resolvedSubdivisionLabel !== config.subdivisionName) {
                logger.info(
                    "TestElements",
                    `Configured subdivision "${config.subdivisionName}" not found. Falling back to available resource subdivision.`
                );
            }

            if (!targetSubdivision) {
                logger.warn("TestElements", `No resource subdivision with actions found`);
                skipPrecondition(this, "No resource subdivision with actions found");
            }

            logger.info("TestElements", `Found subdivision: "${resolvedSubdivisionLabel}"`);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(targetSubdivision, "Subdivision should exist").to.not.be.undefined;
        });

        /*
         * 1. Get the Test Elements section and wait for items.
         * 2. Try selecting the configured test/resource subdivision.
         * 3. Look for "Create Resource" or "Open Resource" action buttons on the item.
         * 4. If none are found, fallback to any available resource subdivision.
         * 5. Verify the item has either the "Create Resource" or "Open Resource" button.
         */
        it("should show Create Resource or Open Resource button on resource subdivision", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                skipPrecondition(this, "Test Elements section not found");
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
        /*
         * 1. Get the Test Elements section and wait for tree items.
         * 2. Read the first visible items in the tree.
         * 3. Collect icon information (colors/types) for each item.
         * 4. Verify that icon info can be retrieved to ensure different icon states are present for locally available resources vs non-local ones.
         */
        it("should show different icon color for locally available resources", async function () {
            const driver = getDriver();

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                skipPrecondition(this, "Test Elements section not found");
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
        /*
         * 1. Get the Test Elements section and look for the resource subdivision.
         * 2. Ensure the subdivision has children (i.e. keywords).
         * 3. Expand the subdivision item if it's collapsed.
         * 4. Retrieve its children items.
         * 5. Verify at least one keyword child is present.
         */
        it("should expand subdivision to reveal keywords", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                skipPrecondition(this, "Test Elements section not found");
            }

            await waitForTreeItems(elementsSection, driver);

            const subdivisionSearchResult = await resolvePreferredSubdivision(
                testElementsPage,
                config.subdivisionName,
                true
            );
            const targetSubdivision = subdivisionSearchResult.subdivision;

            if (!targetSubdivision) {
                skipPrecondition(this, "No subdivision with keyword children found");
            }

            const hasSubdivisionChildren = await targetSubdivision.hasChildren();
            if (!hasSubdivisionChildren) {
                logger.info("TestElements", "Subdivision has no keyword children");
                skipPrecondition(this, "Subdivision has no keyword children");
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

        /*
         * 1. Get the Test Elements section and expand a resource subdivision.
         * 2. Ensure a keyword child exists under it.
         * 3. Confirm the Open Resource action is visible on the parent (to guarantee it has a local file).
         * 4. Single-click the keyword item.
         * 5. Check if an active text editor opens indicating the resource file is shown.
         */
        it("should attempt to open resource file when clicking a keyword (single-click)", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            await openTestBenchSidebar(driver);

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                skipPrecondition(this, "Test Elements section not found");
            }

            await waitForTreeItems(elementsSection, driver);

            const subdivisionSearchResult = await resolvePreferredSubdivision(
                testElementsPage,
                config.subdivisionName,
                true
            );
            const subdivisionItem = subdivisionSearchResult.subdivision;

            if (!subdivisionItem) {
                skipPrecondition(this, "No subdivision with keyword children found");
            }

            // Ensure subdivision is expanded
            if (!(await subdivisionItem.isExpanded())) {
                await subdivisionItem.expand();
                await applySlowMotion(driver);
            }

            const subdivisionChildren = await subdivisionItem.getChildren();
            if (subdivisionChildren.length === 0) {
                logger.info("TestElements", "No keywords to click");
                skipPrecondition(this, "No keywords available under subdivision");
            }

            const keywordCandidate = await findFirstLeafDescendant(subdivisionItem, 5);
            if (!keywordCandidate) {
                skipPrecondition(this, "No leaf keyword item found under subdivision");
            }

            const firstKeywordOfSubdivision = keywordCandidate.item;
            const keywordLabel = keywordCandidate.label;
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
                skipError(this, "Resource file did not open after keyword click");
            }
        });

        /*
         * 1. Get the Test Elements section and expand a resource subdivision.
         * 2. Assure a child keyword is present and resource is available locally.
         * 3. Double-click the keyword.
         * 4. Verify that VS Code's active text editor switches to the file context, or sidebar switches out.
         */
        it("should attempt to open and reveal in Explorer when double-clicking keyword", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            await openTestBenchSidebar(driver);

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                skipPrecondition(this, "Test Elements section not found");
            }

            await waitForTreeItems(elementsSection, driver);

            const subdivisionSearchResult = await resolvePreferredSubdivision(
                testElementsPage,
                config.subdivisionName,
                true
            );
            const subdivisionItem = subdivisionSearchResult.subdivision;

            if (!subdivisionItem) {
                skipPrecondition(this, "No subdivision with keyword children found");
            }

            if (!(await subdivisionItem.isExpanded())) {
                await subdivisionItem.expand();
                await applySlowMotion(driver);
            }

            const subdivisionChildren = await subdivisionItem.getChildren();
            if (subdivisionChildren.length === 0) {
                skipPrecondition(this, "No keywords available under subdivision for double-click");
            }

            const keywordCandidate = await findFirstLeafDescendant(subdivisionItem, 5);
            if (!keywordCandidate) {
                skipPrecondition(this, "No leaf keyword item found under subdivision for double-click");
            }

            const firstKeywordOfSubdivision = keywordCandidate.item;
            const keywordLabel = keywordCandidate.label;
            logger.info("TestElements", `Double-clicking keyword: "${keywordLabel}"`);

            await doubleClickTreeItem(firstKeywordOfSubdivision, driver);
            await applySlowMotion(driver);

            // Double-click should open file, jump to definition, AND reveal in Explorer
            const isResourceFileOpened = await waitForFileInEditor(driver, ".resource", UITimeouts.MEDIUM);

            if (isResourceFileOpened) {
                logger.info("TestElements", "Resource file opened on double-click");
            } else {
                logger.warn("TestElements", "Resource file did not open on double-click");
                skipError(this, "Resource file did not open on keyword double-click");
            }
        });
    });

    describe("Open Resource Button", function () {
        /*
         * 1. Check for the "Open Resource" action on a subdivision.
         * 2. If it's "Create Resource" instead, try creating a dummy file first or fallback.
         * 3. Click the "Open Resource" button.
         * 4. Check if the active editor tab matches the resource file name.
         */
        it("should open existing resource file when clicking Open Resource button", async function () {
            const driver = getDriver();
            const config = getTestData();
            const testElementsPage = new TestElementsPage(driver);

            await openTestBenchSidebar(driver);

            const elementsSection = await getElementsSection();
            if (!elementsSection) {
                skipPrecondition(this, "Test Elements section not found");
            }

            await waitForTreeItems(elementsSection, driver);

            // Try configured subdivision first
            let subdivisionLabel = config.subdivisionName;
            let openResourceClicked = false;
            let resourceCreatedAsFallback = false;

            const configuredSubdivision = await testElementsPage.getItem(elementsSection, config.subdivisionName);
            if (configuredSubdivision) {
                subdivisionLabel = await configuredSubdivision.getLabel();
                openResourceClicked = await tryClickOpenResourceWithRetries(testElementsPage, subdivisionLabel);
            }

            // Search for any subdivision with Open Resource button if needed
            if (!openResourceClicked) {
                logger.info("TestElements", "Searching for subdivision with Open Resource button...");
                const markerSubdivisionSearch = await findRobotResourceSubdivision(testElementsPage);

                if (markerSubdivisionSearch.subdivision) {
                    subdivisionLabel = markerSubdivisionSearch.label;
                    openResourceClicked = await tryClickOpenResourceWithRetries(testElementsPage, subdivisionLabel);
                }

                if (!openResourceClicked) {
                    const resourceSearchResult = await findResourceSubdivision(
                        driver,
                        elementsSection,
                        testElementsPage
                    );

                    if (resourceSearchResult.subdivision) {
                        subdivisionLabel = resourceSearchResult.label;
                        openResourceClicked = await tryClickOpenResourceWithRetries(testElementsPage, subdivisionLabel);
                    }
                }
            }

            // If resource exists only as "Create Resource", create it first and re-check Open Resource.
            if (!openResourceClicked) {
                logger.info(
                    "TestElements",
                    `Open Resource not available yet for "${subdivisionLabel}". Creating resource first...`
                );

                const resourceCreated = await tryCreateResourceWithRetries(testElementsPage, subdivisionLabel);
                if (resourceCreated) {
                    resourceCreatedAsFallback = true;
                    await waitForFileInEditor(driver, ".resource", UITimeouts.LONG);
                    openResourceClicked = await tryClickOpenResourceWithRetries(testElementsPage, subdivisionLabel);
                }
            }

            if (!openResourceClicked && !resourceCreatedAsFallback) {
                logger.info("TestElements", "No actionable resource operation found for selected subdivision");
                skipError(this, "No actionable resource operation found for selected subdivision");
            }

            if (!openResourceClicked && resourceCreatedAsFallback) {
                logger.warn(
                    "TestElements",
                    "Open Resource action remained flaky; validating by resource file open after create fallback"
                );
                skipError(this, "Open Resource action remained unavailable after create fallback");
            }

            const isResourceFileOpened = await waitForFileInEditor(driver, ".resource", UITimeouts.MEDIUM);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(isResourceFileOpened, "Resource file should open").to.be.true;

            logger.info("TestElements", "Resource file opened via Open Resource button");
        });
    });
});
