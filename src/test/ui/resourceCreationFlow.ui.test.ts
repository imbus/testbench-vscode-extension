/**
 * @file src/test/ui/resourceCreationFlow.ui.test.ts
 * @description UI tests for the resource creation flow including:
 * - Navigation to Test Themes view
 * - Selection of a Test Theme
 * - Creation of a new Test Element (Resource)
 * - Verification of the created resource
 */

import { expect } from "chai";
import { SideBarView, TreeItem, Key, EditorView, TextEditor } from "vscode-extension-tester";
import { getTestLogger } from "./utils/testLogger";
import {
    applySlowMotion,
    waitForTreeItems,
    waitForProjectsView,
    waitForTestThemesAndElementsViews,
    handleCycleConfigurationPrompt,
    UITimeouts,
    waitForTreeRefresh,
    waitForQuickInput,
    openTestBenchSidebar,
    setCursorPosition,
    deleteFromLineOnwards,
    waitForCodeLens,
    clickCodeLens,
    waitForRefactorPreview,
    ensureRefactorPreviewItemChecked,
    clickRefactorPreviewApply,
    releaseModifierKeys
} from "./utils/testUtils";
import { doubleClickTreeItem, waitForTreeItemButton } from "./utils/treeViewUtils";
import { getTestData, logTestDataConfig } from "./config/testConfig";
import { TestContext, setupTestHooks } from "./utils/testHooks";
import { findResourceSubdivision } from "./utils/navigationUtils";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";
import { TestThemesPage } from "./pages/TestThemesPage";
import { TestElementsPage } from "./pages/TestElementsPage";

const logger = getTestLogger();

function skipError(_context: Mocha.Context, reason: string): never {
    throw new Error(reason);
}

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

    /*
     * Helper Steps:
     * 1. Run a UI action.
     * 2. Stop waiting if it takes too long.
     * 3. Return null on timeout so the test can continue safely.
     */
    const withTimeout = async <T>(operation: () => Promise<T>, timeoutMs: number = 2500): Promise<T | null> => {
        return await Promise.race([
            operation(),
            new Promise<null>((resolve) => {
                setTimeout(() => resolve(null), timeoutMs);
            })
        ]);
    };

    /*
     * Helper Steps:
     * 1. Compare a tree label with an expected name.
     * 2. Accept exact match.
     * 3. Also accept labels that include the expected name.
     */
    const isLabelMatch = (actualLabel: string, expectedLabel: string): boolean => {
        return actualLabel === expectedLabel || actualLabel.includes(expectedLabel);
    };

    /*
     * Helper Steps:
     * 1. Read labels from a list of tree items.
     * 2. Find the first item that matches the target name.
     * 3. Ignore temporary/stale UI errors and keep searching.
     */
    const findMatchingItem = async (items: TreeItem[], expectedLabel: string): Promise<TreeItem | null> => {
        for (const item of items) {
            try {
                const label = await withTimeout(() => item.getLabel(), 1200);
                if (typeof label === "string" && isLabelMatch(label, expectedLabel)) {
                    return item;
                }
            } catch {
                // Continue on stale items
            }
        }

        return null;
    };

    /*
     * Helper Steps:
     * 1. Look for the target subdivision in currently visible items.
     * 2. If not found, expand parent nodes step by step.
     * 3. Search children and grandchildren until a match is found.
     * 4. Return null if the subdivision cannot be found.
     */
    const resolveSubdivisionFromSection = async (
        section: any,
        expectedLabel: string,
        driver: any
    ): Promise<TreeItem | null> => {
        let topLevelItems: TreeItem[] = [];
        for (let attempt = 1; attempt <= 3 && topLevelItems.length === 0; attempt++) {
            try {
                topLevelItems = (await section.getVisibleItems()) as TreeItem[];
            } catch {
                if (attempt < 3) {
                    await driver.sleep(200);
                }
            }
        }

        if (topLevelItems.length === 0) {
            return null;
        }

        const direct = await findMatchingItem(topLevelItems, expectedLabel);
        if (direct) {
            return direct;
        }

        // Expand top-level nodes (bounded) and inspect children/grandchildren for nested subdivisions.
        for (const rootItem of topLevelItems.slice(0, 12)) {
            try {
                const rootHasChildren = await withTimeout(() => rootItem.hasChildren(), 1200);
                if (!rootHasChildren) {
                    continue;
                }

                const rootExpanded = await withTimeout(() => rootItem.isExpanded(), 1200);
                if (rootExpanded === false) {
                    const expanded = await withTimeout(async () => {
                        await rootItem.expand();
                        await applySlowMotion(driver);
                        return true;
                    }, 2000);

                    if (!expanded) {
                        continue;
                    }
                }

                const children = await withTimeout(() => rootItem.getChildren(), 2500);
                if (!children || children.length === 0) {
                    continue;
                }

                const childMatch = await findMatchingItem(children, expectedLabel);
                if (childMatch) {
                    return childMatch;
                }

                for (const child of children.slice(0, 20)) {
                    const childHasChildren = await withTimeout(() => child.hasChildren(), 1000);
                    if (!childHasChildren) {
                        continue;
                    }

                    const childExpanded = await withTimeout(() => child.isExpanded(), 1000);
                    if (childExpanded === false) {
                        await withTimeout(async () => {
                            await child.expand();
                            return true;
                        }, 1800);
                    }

                    const grandChildren = await withTimeout(() => child.getChildren(), 2200);
                    if (!grandChildren || grandChildren.length === 0) {
                        continue;
                    }

                    const grandChildMatch = await findMatchingItem(grandChildren, expectedLabel);
                    if (grandChildMatch) {
                        return grandChildMatch;
                    }
                }
            } catch {
                // Ignore stale/unavailable tree nodes and keep searching.
            }
        }

        return null;
    };

    /*
     * 1. Open the TestBench sidebar.
     * 2. Re-find the target subdivision by label.
     * 3. Try clicking Open Resource.
     * 4. Retry several times to survive flaky UI timing.
     */
    const clickOpenResourceByLabelWithRetries = async (
        testElementsPage: TestElementsPage,
        subdivisionLabel: string,
        driver: any,
        maxAttempts = 3
    ): Promise<boolean> => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await openTestBenchSidebar(driver);

                const sideBar = new SideBarView();
                const content = sideBar.getContent();
                const elementsSection = await testElementsPage.getSection(content);
                if (!elementsSection) {
                    continue;
                }

                await waitForTreeRefresh(driver, elementsSection, UITimeouts.SHORT);

                const resourceItem = await testElementsPage.getItem(elementsSection, subdivisionLabel);
                if (!resourceItem) {
                    continue;
                }

                await resourceItem.click();
                await applySlowMotion(driver);

                const openClicked = await testElementsPage.clickOpenResource(resourceItem);
                if (openClicked) {
                    return true;
                }
            } catch (error) {
                logger.debug(
                    "Phase4",
                    `Open Resource retry failed for "${subdivisionLabel}" (attempt ${attempt}/${maxAttempts}): ${String(error)}`
                );
            }

            if (attempt < maxAttempts) {
                await driver.sleep(250);
            }
        }

        return false;
    };

    /*
     * 1. Open the TestBench sidebar.
     * 2. Try to locate the Test Elements section.
     * 3. Retry a few times while the UI is still loading.
     */
    const getElementsSectionWithRetries = async (
        testElementsPage: TestElementsPage,
        sideBar: SideBarView,
        driver: any,
        maxAttempts = 4
    ) => {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await openTestBenchSidebar(driver);

            const content = sideBar.getContent();
            const section = await testElementsPage.getSection(content);
            if (section) {
                return section;
            }

            if (attempt < maxAttempts) {
                logger.debug("Phase3", `Test Elements section lookup retry ${attempt}/${maxAttempts}`);
                await driver.sleep(250);
            }
        }

        return null;
    };

    /*
     * 1. Open the configured project, version, and cycle in TestBench views.
     * 2. Navigate to Test Themes and select the configured test theme.
     * 3. In Test Elements, find the target subdivision (or a fallback).
     * 4. Create a new resource file from that subdivision.
     * 5. Confirm the resource file opens in the editor.
     * 6. Verify the new resource appears in the Test Elements tree.
     * 7. Trigger "Pull changes from TestBench" and apply the refactor preview.
     */
    it("should navigate to Test Elements view and create a resource", async function () {
        const driver = getDriver();
        const config = getTestData();
        logTestDataConfig();

        const projectsPage = new ProjectsViewPage(driver);
        const testThemesPage = new TestThemesPage(driver);
        const testElementsPage = new TestElementsPage(driver);

        logger.info("Phase1", "Starting Navigation to Test Themes View...");

        const sideBar = new SideBarView();
        const content = sideBar.getContent();

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
            const projectsSection = await projectsPage.getSection(content);
            if (!projectsSection) {
                throw new Error("Projects View not found");
            }

            await waitForTreeItems(projectsSection, driver);

            const allProjects = await projectsSection.getVisibleItems();
            logger.debug("Phase1", `All visible projects (${allProjects.length}):`);
            for (let i = 0; i < allProjects.length; i++) {
                try {
                    const projLabel = await (allProjects[i] as TreeItem).getLabel();
                    logger.debug("Phase1", `  [${i}] "${projLabel}"`);
                } catch (e) {
                    logger.debug("Phase1", `  [${i}] <error getting label: ${e}>`);
                }
            }

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                throw new Error(`Project "${config.projectName}" not found`);
            }

            const foundProjectLabel = await project.getLabel();
            logger.debug("Phase1", `Found project with label: "${foundProjectLabel}"`);
            if (foundProjectLabel !== config.projectName) {
                throw new Error(
                    `Project label mismatch: expected "${config.projectName}", but found "${foundProjectLabel}"`
                );
            }

            logger.info("Phase1", `Found project "${config.projectName}", expanding...`);
            const version = await projectsPage.getVersion(project, config.versionName);
            if (!version) {
                throw new Error(`Version "${config.versionName}" not found`);
            }

            const foundVersionLabel = await version.getLabel();
            logger.debug("Phase1", `Found version with label: "${foundVersionLabel}"`);
            logger.info("Phase1", `Found version "${config.versionName}", expanding...`);

            const cycle = await projectsPage.getCycle(version, config.cycleName);
            if (!cycle) {
                throw new Error(`Cycle "${config.cycleName}" not found`);
            }

            const foundCycleLabel = await cycle.getLabel();
            logger.debug("Phase1", `Found cycle with label: "${foundCycleLabel}"`);

            const verifiedProjectLabel = await project.getLabel();
            if (verifiedProjectLabel !== config.projectName) {
                throw new Error(
                    `CRITICAL: Project label changed to "${verifiedProjectLabel}", expected "${config.projectName}"`
                );
            }

            logger.info("Phase1", `Found cycle "${config.cycleName}"`);

            await handleCycleConfigurationPrompt(
                cycle,
                driver,
                config.projectName,
                config.versionName,
                projectsSection,
                project,
                version
            );

            logger.debug("Phase1", "Re-locating project hierarchy after configuration...");
            const refreshedContent = sideBar.getContent();
            const refreshedProjectsSection = await projectsPage.getSection(refreshedContent);

            let cycleToClick: TreeItem;

            if (!refreshedProjectsSection) {
                logger.warn("Phase1", "Projects section not found after configuration");
                cycleToClick = cycle;
            } else {
                const refreshedProject = await projectsPage.getProject(refreshedProjectsSection, config.projectName);
                if (!refreshedProject) {
                    logger.warn(
                        "Phase1",
                        `Project "${config.projectName}" not found after configuration, using original reference`
                    );
                    cycleToClick = cycle;
                } else {
                    const refreshedProjectLabel = await refreshedProject.getLabel();
                    logger.debug("Phase1", `Re-located project: "${refreshedProjectLabel}"`);

                    if (refreshedProjectLabel !== config.projectName) {
                        throw new Error(
                            `CRITICAL: After refresh, project label is "${refreshedProjectLabel}", expected "${config.projectName}"`
                        );
                    }

                    const refreshedVersion = await projectsPage.getVersion(refreshedProject, config.versionName);
                    if (!refreshedVersion) {
                        logger.warn(
                            "Phase1",
                            `Version "${config.versionName}" not found after configuration, using original reference`
                        );
                        cycleToClick = cycle;
                    } else {
                        const refreshedVersionLabel = await refreshedVersion.getLabel();
                        logger.debug("Phase1", `Re-located version: "${refreshedVersionLabel}"`);

                        const refreshedCycle = await projectsPage.getCycle(refreshedVersion, config.cycleName);
                        if (!refreshedCycle) {
                            logger.warn(
                                "Phase1",
                                `Cycle "${config.cycleName}" not found after configuration, using original reference`
                            );
                            cycleToClick = cycle;
                        } else {
                            const refreshedCycleLabel = await refreshedCycle.getLabel();
                            logger.debug("Phase1", `Re-located cycle: "${refreshedCycleLabel}"`);
                            cycleToClick = refreshedCycle;
                        }
                    }
                }
            }

            const finalCycleLabel = await cycleToClick.getLabel();
            logger.debug("Phase1", `About to double-click cycle with label: "${finalCycleLabel}"`);

            const finalProjectsSection = sideBar.getContent();
            const finalProjectsSectionObj = await projectsPage.getSection(finalProjectsSection);
            if (finalProjectsSectionObj) {
                const finalProject = await projectsPage.getProject(finalProjectsSectionObj, config.projectName);
                if (finalProject) {
                    const finalProjectLabel = await finalProject.getLabel();
                    logger.debug("Phase1", `Final project verification: "${finalProjectLabel}"`);
                    if (finalProjectLabel !== config.projectName) {
                        logger.error(
                            "Phase1",
                            `CRITICAL: Final project check failed - found "${finalProjectLabel}" instead of "${config.projectName}"`
                        );
                    }
                }
            }

            logger.info("Phase1", `Double-clicking cycle "${config.cycleName}"...`);
            await doubleClickTreeItem(cycleToClick, driver);

            const viewsAppeared = await waitForTestThemesAndElementsViews(driver);
            if (!viewsAppeared) {
                throw new Error("Test Themes view did not appear after double-clicking cycle");
            }
        }

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

        logger.info("Phase3", "Creating New Resource...");

        const elementsSection = await getElementsSectionWithRetries(testElementsPage, sideBar, driver);
        if (!elementsSection) {
            throw new Error("Test Elements section not found");
        }

        await waitForTreeItems(elementsSection, driver);

        logger.info("Phase3", `Looking for subdivision "${config.subdivisionName}"...`);
        let subdivision = await resolveSubdivisionFromSection(elementsSection, config.subdivisionName, driver);
        let subdivisionLabelForActions = config.subdivisionName;
        let subdivisionCandidateResolved = false;
        if (!subdivision) {
            await waitForTreeRefresh(driver, elementsSection, UITimeouts.SHORT);
            subdivision = await resolveSubdivisionFromSection(elementsSection, config.subdivisionName, driver);
        }

        if (subdivision) {
            // Keep a stable label and avoid depending on this potentially stale TreeItem instance later.
            subdivisionLabelForActions = config.subdivisionName;
            subdivisionCandidateResolved = true;
        }

        if (!subdivision) {
            logger.warn(
                "Phase3",
                `Configured subdivision "${config.subdivisionName}" not found. Falling back to first subdivision with resource actions.`
            );

            let fallbackSection = elementsSection;
            for (let attempt = 1; attempt <= 3 && !subdivision; attempt++) {
                const contentForFallback = sideBar.getContent();
                const sectionForFallback = await testElementsPage.getSection(contentForFallback);
                if (sectionForFallback) {
                    fallbackSection = sectionForFallback;
                }

                const fallback = await findResourceSubdivision(driver, fallbackSection, testElementsPage);
                subdivision = fallback.subdivision;
                if (subdivision) {
                    subdivisionLabelForActions = fallback.label || config.subdivisionName;
                    subdivisionCandidateResolved = true;
                    logger.info(
                        "Phase3",
                        `Using fallback subdivision "${subdivisionLabelForActions}" for resource creation.`
                    );
                    break;
                }

                if (attempt < 3) {
                    logger.debug("Phase3", `Fallback subdivision lookup attempt ${attempt}/3 failed; retrying...`);
                    await waitForTreeRefresh(driver, fallbackSection, UITimeouts.SHORT);
                }
            }

            if (!subdivisionCandidateResolved) {
                logger.warn(
                    "Phase3",
                    "Fallback lookup with action buttons did not find a subdivision. Trying label-based fallback."
                );

                let visibleItems: TreeItem[] = [];
                for (let attempt = 1; attempt <= 3 && visibleItems.length === 0; attempt++) {
                    try {
                        const contentForLabelFallback = sideBar.getContent();
                        const sectionForLabelFallback = await testElementsPage.getSection(contentForLabelFallback);
                        if (!sectionForLabelFallback) {
                            continue;
                        }

                        visibleItems = (await sectionForLabelFallback.getVisibleItems()) as TreeItem[];
                    } catch (error) {
                        logger.debug(
                            "Phase3",
                            `Label-based fallback failed to read visible items (attempt ${attempt}/3): ${String(error)}`
                        );
                        await waitForTreeRefresh(driver, elementsSection, UITimeouts.SHORT);
                    }
                }

                for (const item of visibleItems.slice(0, 40)) {
                    try {
                        const label = await withTimeout(() => item.getLabel(), 1200);
                        if (typeof label === "string" && /\[Robot-Resource\]/i.test(label)) {
                            subdivisionLabelForActions = label;
                            subdivisionCandidateResolved = true;
                            logger.info(
                                "Phase3",
                                `Using label-based fallback subdivision "${label}" for resource creation.`
                            );
                            break;
                        }
                    } catch {
                        // Ignore stale item labels and keep scanning.
                    }
                }
            }
        }

        if (!subdivisionCandidateResolved) {
            throw new Error(`Subdivision "${config.subdivisionName}" not found in Test Elements view`);
        }

        logger.info("Phase3", `Found subdivision "${subdivisionLabelForActions}", clicking to expand it...`);

        const selectedSubdivisionBaseName = subdivisionLabelForActions.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
        const usingConfiguredSubdivision = subdivisionLabelForActions === config.subdivisionName;
        const expectedResourceFileName = usingConfiguredSubdivision
            ? config.resourceFileName || `${selectedSubdivisionBaseName}.resource`
            : `${selectedSubdivisionBaseName}.resource`;
        logger.debug("Phase3", `Expected resource file: "${expectedResourceFileName}"`);

        // Re-resolve a fresh tree item by label immediately before interacting to avoid stale references.
        const elementsSectionForAction = await getElementsSectionWithRetries(testElementsPage, sideBar, driver);
        if (!elementsSectionForAction) {
            throw new Error("Test Elements section not found before resource creation action");
        }

        await waitForTreeItems(elementsSectionForAction, driver);

        let freshSubdivision = await testElementsPage.getItem(elementsSectionForAction, subdivisionLabelForActions);
        if (!freshSubdivision) {
            freshSubdivision = await resolveSubdivisionFromSection(
                elementsSectionForAction,
                subdivisionLabelForActions,
                driver
            );
        }

        if (!freshSubdivision) {
            throw new Error(`Subdivision "${subdivisionLabelForActions}" not found for resource creation action`);
        }

        await freshSubdivision.click();
        await applySlowMotion(driver);

        const buttonVisible = await waitForTreeItemButton(
            freshSubdivision,
            driver,
            "Create Resource",
            UITimeouts.MEDIUM
        );
        if (!buttonVisible) {
            logger.warn("Phase3", "Create Resource button did not become visible");
        }

        logger.info("Phase3", "Clicking Create Resource button...");

        const createClicked = await testElementsPage.clickCreateResource(freshSubdivision, subdivisionLabelForActions);
        if (!createClicked) {
            throw new Error('Failed to click "Create Resource" button on subdivision');
        }

        logger.info("Phase3", "Waiting for resource file to be created and opened in editor...");

        const quickInput = await waitForQuickInput(driver, UITimeouts.SHORT);
        if (quickInput) {
            logger.info("Phase3", "Quick input appeared; confirming resource name...");
            try {
                await quickInput.click();
                try {
                    await quickInput.clear();
                } catch (_err) {
                    // clear can fail on some widgets; continue with select-all overwrite
                }

                // Use explicit key down/up plus safety reset to avoid sticky Ctrl state in later tests.
                await releaseModifierKeys(driver, "QuickInput");
                try {
                    await driver.actions().keyDown(Key.CONTROL).sendKeys("a").keyUp(Key.CONTROL).perform();
                } finally {
                    await releaseModifierKeys(driver, "QuickInput");
                }

                await quickInput.sendKeys(expectedResourceFileName);
                await quickInput.sendKeys(Key.ENTER);
                await applySlowMotion(driver);
            } catch (inputError) {
                logger.warn("Phase3", `Unable to fill quick input: ${inputError}`);
            }
        } else {
            logger.debug("Phase3", "No quick input appeared; assuming resource opens directly");
        }

        // Wait for the resource file to be opened in the editor
        const { waitForFileInEditor } = await import("./utils/testUtils");
        const fileOpened = await waitForFileInEditor(driver, expectedResourceFileName, UITimeouts.LONG);

        if (!fileOpened) {
            logger.warn("Phase3", "Resource file did not open in editor within timeout");
            throw new Error(`Resource file "${expectedResourceFileName}" did not open in editor`);
        }

        logger.info("Phase3", `Resource file "${expectedResourceFileName}" opened in editor`);

        const newResourceName = selectedSubdivisionBaseName;

        logger.info("Phase4", "Verifying Created Resource...");

        await openTestBenchSidebar(driver);

        const sideBarRefreshed = new SideBarView();
        const elementsSectionRefreshed = await getElementsSectionWithRetries(
            testElementsPage,
            sideBarRefreshed,
            driver
        );

        if (!elementsSectionRefreshed) {
            throw new Error("Test Elements section not found after refresh");
        }

        await waitForTreeRefresh(driver, elementsSectionRefreshed, UITimeouts.MEDIUM);

        const newResource = await testElementsPage.getItem(elementsSectionRefreshed, newResourceName);
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        expect(newResource, `New resource "${newResourceName}" should exist in the tree`).to.not.be.undefined;

        const editorView2 = new EditorView();
        const openEditorTitlesBeforeOpen = await editorView2.getOpenEditorTitles();
        const resourceAlreadyOpen = openEditorTitlesBeforeOpen.some(
            (title) => title.includes(expectedResourceFileName) || title.includes(newResourceName)
        );

        if (newResource) {
            logger.info("Phase4", ` Found new resource: "${newResourceName}"`);
            if (resourceAlreadyOpen) {
                logger.debug("Phase4", "Resource editor already open; skipping Open Resource tree action");
            } else {
                const openClicked = await clickOpenResourceByLabelWithRetries(
                    testElementsPage,
                    newResourceName,
                    driver
                );
                if (!openClicked) {
                    logger.warn("Phase4", `Could not click Open Resource for "${newResourceName}" after retries`);
                }
            }
        }

        let resourceEditor: TextEditor | null = null;

        const openEditorTitles = await editorView2.getOpenEditorTitles();
        for (const title of openEditorTitles) {
            if (title.includes(expectedResourceFileName) || title.includes(newResourceName)) {
                resourceEditor = (await editorView2.openEditor(title)) as TextEditor;
                await applySlowMotion(driver);
                break;
            }
        }

        if (!resourceEditor) {
            logger.warn("Phase4", "Resource editor not found. Trying to open file...");
            try {
                resourceEditor = (await editorView2.openEditor(expectedResourceFileName)) as TextEditor;
            } catch {
                logger.warn("Phase4", "Could not open resource file. Continuing...");
            }
        }

        if (resourceEditor) {
            const cursorSet = await setCursorPosition(resourceEditor, driver, 1, 0);
            if (!cursorSet) {
                logger.warn("Phase4", "Warning: Failed to set cursor position, continuing anyway");
            }

            logger.info("Phase4", "Removing content from line 4 onwards...");

            let contentDeleted = false;
            const maxRetries = 3;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                if (attempt > 1) {
                    logger.debug("Phase4", `Retry attempt ${attempt}/${maxRetries} to delete content...`);
                    await driver.sleep(500); // Brief pause between retries
                }

                contentDeleted = await deleteFromLineOnwards(resourceEditor, driver, 4);
                if (contentDeleted) {
                    logger.info("Phase4", `Content deleted successfully on attempt ${attempt}`);
                    break;
                } else {
                    logger.warn("Phase4", `Deletion failed on attempt ${attempt}`);
                    if (attempt < maxRetries) {
                        try {
                            await resourceEditor.click();
                            await driver.sleep(200);
                        } catch {
                            // Ignore focus errors
                        }
                    }
                }
            }

            if (!contentDeleted) {
                logger.error("Phase4", "ERROR: Failed to delete content after all retry attempts");
                skipError(this, "Failed to delete content after all retry attempts");
            }

            logger.debug("Phase4", "Waiting for CodeLens to stabilize after deletion...");
            await driver.sleep(3000);
        }

        const codeLensAppeared = await waitForCodeLens(driver, "Pull changes from TestBench");
        if (!codeLensAppeared) {
            logger.warn("Phase4", "CodeLens 'Pull changes from TestBench' did not appear");
            skipError(this, "CodeLens 'Pull changes from TestBench' did not appear");
        }

        const codeLensClicked = await clickCodeLens(driver, "Pull changes from TestBench", 0);
        if (!codeLensClicked) {
            logger.warn("Phase4", "Failed to click CodeLens 'Pull changes from TestBench'");
            skipError(this, "Failed to click CodeLens 'Pull changes from TestBench'");
        }

        const refactorPreviewOpened = await waitForRefactorPreview(driver);
        if (!refactorPreviewOpened) {
            logger.warn("Phase4", "Refactor Preview did not open after clicking CodeLens");
            skipError(this, "Refactor Preview did not open after clicking CodeLens");
        }

        const checkboxReady = await ensureRefactorPreviewItemChecked(driver, expectedResourceFileName);
        if (!checkboxReady) {
            logger.warn("Phase4", "Warning: Could not ensure checkbox is checked, Apply might fail.");
        }

        const applyClicked = await clickRefactorPreviewApply(driver);
        if (!applyClicked) {
            logger.warn("Phase4", "Failed to click Apply button in Refactor Preview");
            skipError(this, "Failed to click Apply button in Refactor Preview");
        }

        logger.info("Phase4", "Synchronization complete.");
        logger.info("ResourceCreationFlow", "\n========================================");
        logger.info("ResourceCreationFlow", "Resource Creation Flow Test - COMPLETE");
        logger.info("ResourceCreationFlow", "========================================");
    });
});
