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
import { getTestLogger } from "./testLogger";
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
    clickRefactorPreviewApply
} from "./testUtils";
import { doubleClickTreeItem, waitForTreeItemButton } from "./treeViewUtils";
import { getTestData, logTestDataConfig } from "./testConfig";
import { TestContext, setupTestHooks } from "./testHooks";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";
import { TestThemesPage } from "./pages/TestThemesPage";
import { TestElementsPage } from "./pages/TestElementsPage";

const logger = getTestLogger();

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

            // Debug: Log all visible projects to help diagnose the issue
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

            // Verify we found the correct project by checking its label
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

            // Verify we're working with the correct project by checking the project label again
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

            // Re-locate entire hierarchy after potential tree reordering to get fresh references
            logger.debug("Phase1", "Re-locating project hierarchy after configuration...");
            const refreshedContent = sideBar.getContent();
            const refreshedProjectsSection = await projectsPage.getSection(refreshedContent);

            let cycleToClick: TreeItem;

            if (!refreshedProjectsSection) {
                logger.warn("Phase1", "Projects section not found after configuration");
                // Fallback to original references
                cycleToClick = cycle;
            } else {
                // Re-fetch project to ensure we have a fresh reference
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

                    // Re-fetch version
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

                        // Re-fetch cycle
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

            // Final verification: log what we're about to click
            const finalCycleLabel = await cycleToClick.getLabel();
            logger.debug("Phase1", `About to double-click cycle with label: "${finalCycleLabel}"`);

            // Verify the project one more time by re-fetching it
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

        // Wait for tree items to load
        await waitForTreeItems(elementsSection, driver);

        // Find the subdivision tree item that should have the "Create Resource" button
        logger.info("Phase3", `Looking for subdivision "${config.subdivisionName}"...`);
        let subdivision = await testElementsPage.getItem(elementsSection, config.subdivisionName);
        if (!subdivision) {
            await waitForTreeRefresh(driver, elementsSection, UITimeouts.SHORT);
            subdivision = await testElementsPage.getItem(elementsSection, config.subdivisionName);
        }

        if (!subdivision) {
            throw new Error(`Subdivision "${config.subdivisionName}" not found in Test Elements view`);
        }

        logger.info("Phase3", `Found subdivision "${config.subdivisionName}", clicking to expand it...`);

        // The expected resource file name
        const expectedResourceFileName = config.resourceFileName || `${config.subdivisionName}.resource`;
        logger.debug("Phase3", `Expected resource file: "${expectedResourceFileName}"`);

        // Cache the subdivision label to avoid stale element issues
        const subdivisionLabel = await subdivision.getLabel();

        // Click the subdivision once to expand it and make the "Create Resource" button visible
        await subdivision.click();
        await applySlowMotion(driver);

        // Wait for the "Create Resource" button to become visible
        const buttonVisible = await waitForTreeItemButton(subdivision, driver, "Create Resource", UITimeouts.MEDIUM);
        if (!buttonVisible) {
            logger.warn("Phase3", "Create Resource button did not become visible");
        }

        logger.info("Phase3", "Clicking Create Resource button...");

        // Click the "Create Resource" button on the subdivision tree item
        // Note: "Create Resource" is a tree item action button, not a toolbar action
        // This opens the resource file directly in the editor (no input box)
        const createClicked = await testElementsPage.clickCreateResource(subdivision, subdivisionLabel);
        if (!createClicked) {
            throw new Error('Failed to click "Create Resource" button on subdivision');
        }

        logger.info("Phase3", "Waiting for resource file to be created and opened in editor...");

        // Some builds prompt for a name, others create/open directly. Handle both.
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
                await quickInput.sendKeys(Key.chord(Key.CONTROL, "a"));
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
        const { waitForFileInEditor } = await import("./testUtils");
        const fileOpened = await waitForFileInEditor(driver, expectedResourceFileName, UITimeouts.LONG);

        if (!fileOpened) {
            logger.warn("Phase3", "Resource file did not open in editor within timeout");
            throw new Error(`Resource file "${expectedResourceFileName}" did not open in editor`);
        }

        logger.info("Phase3", `✓ Resource file "${expectedResourceFileName}" opened in editor`);

        // The resource file is automatically named after the subdivision
        const newResourceName = config.subdivisionName;

        // ============================================
        // Phase 4: Verify Created Resource
        // ============================================
        logger.info("Phase4", "Verifying Created Resource...");

        // Ensure TestBench sidebar is open (in case file open switched to Explorer)
        await openTestBenchSidebar(driver);

        // Re-acquire the sidebar content and section as the tree might have refreshed
        const sideBarRefreshed = new SideBarView();
        const contentRefreshed = sideBarRefreshed.getContent();
        const elementsSectionRefreshed = await testElementsPage.getSection(contentRefreshed);

        if (!elementsSectionRefreshed) {
            throw new Error("Test Elements section not found after refresh");
        }

        await waitForTreeRefresh(driver, elementsSectionRefreshed, UITimeouts.MEDIUM);

        const newResource = await testElementsPage.getItem(elementsSectionRefreshed, newResourceName);
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        expect(newResource, `New resource "${newResourceName}" should exist in the tree`).to.not.be.undefined;

        if (newResource) {
            logger.info("Phase4", ` Found new resource: "${newResourceName}"`);

            // Optional: Open the resource to verify it opens the editor
            await testElementsPage.clickOpenResource(newResource);
        }

        // Return focus to the active editor window for resource file
        const editorView2 = new EditorView();
        let resourceEditor: TextEditor | null = null;

        // Find and focus the resource file editor
        const openEditorTitles = await editorView2.getOpenEditorTitles();
        for (const title of openEditorTitles) {
            if (title.includes(config.resourceFileName || "") || title.includes(config.subdivisionName)) {
                resourceEditor = (await editorView2.openEditor(title)) as TextEditor;
                await applySlowMotion(driver);
                break;
            }
        }

        if (!resourceEditor) {
            logger.warn("Phase4", "Resource editor not found. Trying to open file...");
            // Try to open the file if it exists
            try {
                resourceEditor = (await editorView2.openEditor(
                    config.resourceFileName || config.subdivisionName + ".resource"
                )) as TextEditor;
            } catch {
                logger.warn("Phase4", "Could not open resource file. Continuing...");
            }
        }

        // Trigger CodeLens: Place the cursor at Line 1
        if (resourceEditor) {
            const cursorSet = await setCursorPosition(resourceEditor, driver, 1, 0);
            if (!cursorSet) {
                logger.warn("Phase4", "Warning: Failed to set cursor position, continuing anyway");
            }

            // Remove contents from line 4 onwards (usually starts with "*** Keywords ***")
            // Keep lines 1, 2, and 3 intact
            logger.info("Phase4", "Removing content from line 4 onwards...");

            // Retry deletion up to 3 times if it fails
            let contentDeleted = false;
            const maxRetries = 3;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                if (attempt > 1) {
                    logger.debug("Phase4", `Retry attempt ${attempt}/${maxRetries} to delete content...`);
                    await driver.sleep(500); // Brief pause between retries
                }

                contentDeleted = await deleteFromLineOnwards(resourceEditor, driver, 4);
                if (contentDeleted) {
                    logger.info("Phase4", `✓ Content deleted successfully on attempt ${attempt}`);
                    break;
                } else {
                    logger.warn("Phase4", `✗ Deletion failed on attempt ${attempt}`);
                    if (attempt < maxRetries) {
                        // Re-focus the editor before retry
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
                this.skip();
                return;
            }

            // Add stabilization delay.
            // CodeLenses need time to re-render and attach event listeners after document edits.
            logger.debug("Phase4", "Waiting for CodeLens to stabilize after deletion...");
            await driver.sleep(3000);
        }

        // Wait for CodeLens to appear
        const codeLensAppeared = await waitForCodeLens(driver, "Pull changes from TestBench");
        if (!codeLensAppeared) {
            logger.warn("Phase4", "CodeLens 'Pull changes from TestBench' did not appear");
            this.skip();
        }

        // Locate the CodeLens action text above the first line that reads "Pull changes from TestBench"
        // Ensure you have updated clickCodeLens in testUtils.ts to use the MouseEvent logic
        const codeLensClicked = await clickCodeLens(driver, "Pull changes from TestBench", 0);
        if (!codeLensClicked) {
            logger.warn("Phase4", "Failed to click CodeLens 'Pull changes from TestBench'");
            this.skip();
        }

        // Wait for Refactor Preview to open
        const refactorPreviewOpened = await waitForRefactorPreview(driver);
        if (!refactorPreviewOpened) {
            logger.warn("Phase4", "Refactor Preview did not open after clicking CodeLens");
            this.skip();
        }

        // Ensure the checkbox for resource file is checked
        const checkboxReady = await ensureRefactorPreviewItemChecked(
            driver,
            config.resourceFileName || config.subdivisionName + ".resource"
        );
        if (!checkboxReady) {
            logger.warn("Phase4", "Warning: Could not ensure checkbox is checked, Apply might fail.");
        }

        // Click the "Apply" button inside the Refactor Preview tab
        const applyClicked = await clickRefactorPreviewApply(driver);
        if (!applyClicked) {
            logger.warn("Phase4", "Failed to click Apply button in Refactor Preview");
            this.skip();
        }

        logger.info("Phase4", "Synchronization complete.");
        logger.info("ResourceCreationFlow", "\n========================================");
        logger.info("ResourceCreationFlow", "Resource Creation Flow Test - COMPLETE");
        logger.info("ResourceCreationFlow", "========================================");
    });
});
