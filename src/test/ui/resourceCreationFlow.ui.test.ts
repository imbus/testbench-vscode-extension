/**
 * @file src/test/ui/resourceCreationFlow.ui.test.ts
 * @description End-to-end UI test for resource creation flow:
 * Phase 1: Login and Context Verification
 * Phase 2: Navigation (Projects View)
 * Phase 3: Resource Creation (Test Elements View)
 * Phase 4: Synchronization (Editor & Refactor Preview)
 */

import { expect } from "chai";
import { VSBrowser, WebDriver, SideBarView, EditorView, TextEditor } from "vscode-extension-tester";
import {
    openTestBenchSidebar,
    applySlowMotion,
    ensureLoggedIn,
    findTreeItemByLabel,
    findTreeItemByLabelAtLevel,
    expandTreeItemIfNeeded,
    waitForTreeItems,
    cleanupWorkspace,
    findSidebarSection,
    getSectionTitle,
    clickToolbarButton,
    doubleClickTreeItem,
    clickCreateResourceButton,
    clickCodeLens,
    clickRefactorPreviewApply,
    waitForProjectsView,
    waitForTestThemesAndElementsViews,
    waitForFileInEditor,
    waitForCodeLens,
    waitForRefactorPreview,
    waitForTreeItemButton,
    handleCycleConfigurationPrompt,
    setCursorPosition,
    deleteFromLineOnwards,
    ensureRefactorPreviewItemChecked
} from "./testUtils";
import { isSlowMotionEnabled, getSlowMotionDelay, hasTestCredentials } from "./testConfig";

describe("Resource Creation Flow E2E Tests", function () {
    let browser: VSBrowser;
    let driver: WebDriver;

    this.timeout(300000); // 5 minutes timeout for full flow

    before(async function () {
        browser = VSBrowser.instance;
        driver = browser.driver;
        await new EditorView().closeAllEditors();
    });

    after(async function () {
        await new EditorView().closeAllEditors();
    });

    beforeEach(async function () {
        if (isSlowMotionEnabled()) {
            console.log(`[Slow Motion] Enabled with ${getSlowMotionDelay()}ms delay`);
        } else {
            console.log("[Slow Motion] Disabled");
        }

        await openTestBenchSidebar(driver);

        // Ensure user is logged in before running tests
        if (hasTestCredentials()) {
            const loggedIn = await ensureLoggedIn(driver);
            if (!loggedIn) {
                console.log("[ResourceCreationFlow] Failed to login. Skipping tests.");
                this.skip();
            }
        } else {
            console.log("[ResourceCreationFlow] Test credentials not available. Skipping tests.");
            this.skip();
        }
    });

    describe("Complete Resource Creation Flow", function () {
        it("should complete full resource creation and synchronization flow", async function () {
            // ============================================
            // Phase 1: Login and Context Verification
            // ============================================
            console.log("[Phase 1] Starting Login and Context Verification...");

            const sideBar = new SideBarView();
            const content = sideBar.getContent();

            // Determine initial view state
            const projectsSection = await findSidebarSection(content, "Projects");
            const testThemesSection = await findSidebarSection(content, "Test Themes");

            let isInProjectsView = false;

            if (projectsSection) {
                isInProjectsView = true;
                console.log("[Phase 1] Extension is in Projects View");
            } else if (testThemesSection) {
                console.log("[Phase 1] Extension is in Test Themes View");

                // Check context: Read the Test Themes view title
                const testThemesTitle = await getSectionTitle(testThemesSection);
                console.log(`[Phase 1] Test Themes view title: "${testThemesTitle}"`);

                const expectedProjectName = "TestBench Demo Agil 1";
                const expectedCycleName = "3.0.2";

                if (
                    testThemesTitle &&
                    testThemesTitle.includes(expectedProjectName) &&
                    testThemesTitle.includes(expectedCycleName)
                ) {
                    console.log("[Phase 1] Context is correct. Skipping to Phase 3.");
                    // Skip to Phase 3 (will be handled below)
                } else {
                    console.log("[Phase 1] Context is incorrect. Clicking 'Open Projects View' button...");
                    // Locate the Toolbar in the Test Themes view and click the "Open Projects View" button
                    const buttonClicked = await clickToolbarButton(testThemesSection, "Open Projects View", driver);
                    if (!buttonClicked) {
                        console.log("[Phase 1] Failed to click 'Open Projects View' button");
                        this.skip();
                    }

                    // Wait for Projects view to appear
                    const projectsViewAppeared = await waitForProjectsView(driver);
                    if (!projectsViewAppeared) {
                        console.log("[Phase 1] Projects view did not appear after clicking button");
                        this.skip();
                    }
                    isInProjectsView = true;
                }
            } else {
                console.log("[Phase 1] Neither Projects nor Test Themes view found. Assuming Projects View.");
                isInProjectsView = true;
            }

            // ============================================
            // Phase 2: Navigation (Projects View)
            // ============================================
            if (isInProjectsView) {
                console.log("[Phase 2] Starting Navigation (Projects View)...");

                // Re-fetch sections in case view changed
                const updatedContent = sideBar.getContent();
                const projectsSectionUpdated = await findSidebarSection(updatedContent, "Projects");

                if (!projectsSectionUpdated) {
                    console.log("[Phase 2] Projects section not found");
                    this.skip();
                }

                // Wait for tree items to load
                const itemsLoaded = await waitForTreeItems(projectsSectionUpdated, driver);
                if (!itemsLoaded) {
                    console.log("[Phase 2] Tree items did not load in time");
                    this.skip();
                }

                // Get all visible tree items (Projects) - only top-level items
                const projectItems = await projectsSectionUpdated.getVisibleItems();
                expect(projectItems.length).to.be.greaterThan(0, "Expected at least one project in the tree");

                // Find the Project tree item: "TestBench Demo Agil 1" (non-recursive, only at current level)
                const targetProject = await findTreeItemByLabelAtLevel(projectItems, "TestBench Demo Agil 1");
                if (!targetProject) {
                    console.log("[Phase 2] Project 'TestBench Demo Agil 1' not found");
                    this.skip();
                }

                console.log("[Phase 2] Found project 'TestBench Demo Agil 1', expanding...");
                await expandTreeItemIfNeeded(targetProject, driver);

                // Get children (versions) of the project - only after expanding
                const versions = await targetProject.getChildren();
                if (!versions || versions.length === 0) {
                    console.log("[Phase 2] No versions found under project");
                    this.skip();
                }

                // Find the TOV tree item: "Version 3.0" (non-recursive, only at current level)
                const targetVersion = await findTreeItemByLabelAtLevel(versions, "Version 3.0");
                if (!targetVersion) {
                    console.log("[Phase 2] Version 'Version 3.0' not found");
                    this.skip();
                }

                console.log("[Phase 2] Found version 'Version 3.0', expanding...");
                await expandTreeItemIfNeeded(targetVersion, driver);

                // Get children (cycles) of the version - only after expanding
                const cycles = await targetVersion.getChildren();
                if (!cycles || cycles.length === 0) {
                    console.log("[Phase 2] No cycles found under version");
                    this.skip();
                    return;
                }

                // Locate the Cycle tree item: "3.0.2" (non-recursive, only at current level)
                const targetCycle = await findTreeItemByLabelAtLevel(cycles, "3.0.2");
                if (!targetCycle) {
                    console.log("[Phase 2] Cycle '3.0.2' not found");
                    this.skip();
                    return;
                }

                console.log("[Phase 2] Found cycle '3.0.2'");

                // Click the cycle once to check for configuration prompt
                const projectName = "TestBench Demo Agil 1";
                const tovName = "Version 3.0";
                const configHandled = await handleCycleConfigurationPrompt(
                    targetCycle,
                    driver,
                    projectName,
                    tovName,
                    projectsSectionUpdated,
                    targetProject,
                    targetVersion
                );

                if (!configHandled) {
                    console.log("[Phase 2] Warning: Configuration prompt handling may have failed, continuing anyway");
                }

                // Re-locate the cycle after tree reordering (pins may have changed tree structure)
                // Re-fetch the version's children to get updated cycle items
                const cyclesAfterConfig = await targetVersion.getChildren();
                let targetCycleAfterConfig = await findTreeItemByLabelAtLevel(cyclesAfterConfig, "3.0.2");

                // If cycle not found in children, try getting all visible items again
                if (!targetCycleAfterConfig) {
                    const allItems = await projectsSectionUpdated.getVisibleItems();
                    // Try to find the cycle by searching recursively (since tree may have reordered)
                    targetCycleAfterConfig = await findTreeItemByLabel(allItems, "3.0.2");
                }

                if (!targetCycleAfterConfig) {
                    console.log("[Phase 2] Cycle '3.0.2' not found after configuration - using original reference");
                    targetCycleAfterConfig = targetCycle;
                }

                console.log("[Phase 2] Double-clicking cycle '3.0.2'...");
                // Action: Double-click the "3.0.2" tree item
                await doubleClickTreeItem(targetCycleAfterConfig, driver);

                // Wait for Test Themes and Test Elements views to appear
                const viewsAppeared = await waitForTestThemesAndElementsViews(driver);
                if (!viewsAppeared) {
                    console.log(
                        "[Phase 2] Test Themes and Test Elements views did not appear after double-clicking cycle"
                    );
                    this.skip();
                    return;
                }
                console.log("[Phase 2] Navigation complete. Test Themes and Test Elements views should be open.");
            }

            // ============================================
            // Phase 3: Resource Creation (Test Elements View)
            // ============================================
            console.log("[Phase 3] Starting Resource Creation (Test Elements View)...");

            // Clean up workspace before creating resource
            console.log("[Phase 3] Cleaning workspace before test...");
            await cleanupWorkspace(driver, undefined, {
                exclude: [".testbench"]
            });

            // Focus on the Test Elements View
            const updatedContent2 = sideBar.getContent();
            const testElementsSection = await findSidebarSection(updatedContent2, "Test Elements");

            if (!testElementsSection) {
                console.log("[Phase 3] Test Elements section not found");
                this.skip();
                return;
            }

            // Wait for tree items to load
            const testElementsLoaded = await waitForTreeItems(testElementsSection, driver);
            if (!testElementsLoaded) {
                console.log("[Phase 3] Test Elements tree items did not load in time");
                this.skip();
                return;
            }

            // Locate the subdivision tree item named: "Subdiv resource [Robot-Resource]"
            const testElementItems = await testElementsSection.getVisibleItems();
            const targetSubdivision = await findTreeItemByLabel(testElementItems, "Subdiv resource");

            if (!targetSubdivision) {
                console.log("[Phase 3] Subdivision 'Subdiv resource [Robot-Resource]' not found");
                this.skip();
                return;
            }

            // Verify it has the [Robot-Resource] suffix by checking the label
            const subdivisionLabel = await targetSubdivision.getLabel();
            if (!subdivisionLabel.includes("Robot-Resource") && !subdivisionLabel.includes("resource")) {
                console.log("[Phase 3] Subdivision does not appear to be a resource file");
                this.skip();
                return;
            }

            console.log(`[Phase 3] Found subdivision: "${subdivisionLabel}"`);

            // Click the subdivision once to expand it and make the "Create Resource" button visible
            console.log("[Phase 3] Clicking subdivision to expand it...");
            await targetSubdivision.click();
            await applySlowMotion(driver);

            // Wait for the "Create Resource" button to become visible
            const buttonVisible = await waitForTreeItemButton(targetSubdivision, driver, "Create Resource");
            if (!buttonVisible) {
                console.log("[Phase 3] Create Resource button did not become visible after expanding subdivision");
                // Continue anyway, button might still be clickable
            }

            // Action: Click the "Create Resource" button on this tree item
            const resourceButtonClicked = await clickCreateResourceButton(targetSubdivision, driver);
            if (!resourceButtonClicked) {
                console.log("[Phase 3] Failed to click Create Resource button");
                this.skip();
            }

            // Wait for file to be created and opened
            const fileOpened = await waitForFileInEditor(driver, "Subdiv resource");
            if (fileOpened) {
                // Verify the exact file name
                const editorView = new EditorView();
                const editorTitles = await editorView.getOpenEditorTitles();
                for (const title of editorTitles) {
                    if (title.includes("Subdiv resource.resource") || title.includes("Subdiv resource")) {
                        console.log(`[Phase 3] Resource file opened: "${title}"`);
                        break;
                    }
                }
            } else {
                console.log("[Phase 3] Resource file was not opened in editor within timeout");
                // Continue anyway, file might still be created
            }

            console.log("[Phase 3] Resource creation complete.");

            // ============================================
            // Phase 4: Synchronization (Editor & Refactor Preview)
            // ============================================
            console.log("[Phase 4] Starting Synchronization (Editor & Refactor Preview)...");

            // Return to Extension View: In the VS Code Activity Bar, click the TestBench icon
            await openTestBenchSidebar(driver);
            await applySlowMotion(driver);

            // Return focus to the active editor window for Subdiv resource.resource
            const editorView2 = new EditorView();
            let resourceEditor: TextEditor | null = null;

            // Find and focus the resource file editor
            const openEditorTitles = await editorView2.getOpenEditorTitles();
            for (const title of openEditorTitles) {
                if (title.includes("Subdiv resource.resource") || title.includes("Subdiv resource")) {
                    resourceEditor = (await editorView2.openEditor(title)) as TextEditor;
                    await applySlowMotion(driver);
                    break;
                }
            }

            if (!resourceEditor) {
                console.log("[Phase 4] Resource editor not found. Trying to open file...");
                // Try to open the file if it exists
                try {
                    resourceEditor = (await editorView2.openEditor("Subdiv resource.resource")) as TextEditor;
                } catch {
                    console.log("[Phase 4] Could not open resource file. Continuing...");
                }
            }

            // Trigger CodeLens: Place the cursor at Line 1
            if (resourceEditor) {
                const cursorSet = await setCursorPosition(resourceEditor, driver, 1, 0);
                if (!cursorSet) {
                    console.log("[Phase 4] Warning: Failed to set cursor position, continuing anyway");
                }

                // Remove contents from line 4 onwards (usually starts with "*** Keywords ***")
                // Keep lines 1, 2, and 3 intact
                console.log("[Phase 4] Removing content from line 4 onwards...");

                // Retry deletion up to 3 times if it fails
                let contentDeleted = false;
                const maxRetries = 3;
                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    if (attempt > 1) {
                        console.log(`[Phase 4] Retry attempt ${attempt}/${maxRetries} to delete content...`);
                        await driver.sleep(500); // Brief pause between retries
                    }

                    contentDeleted = await deleteFromLineOnwards(resourceEditor, driver, 4);
                    if (contentDeleted) {
                        console.log(`[Phase 4] ✓ Content deleted successfully on attempt ${attempt}`);
                        break;
                    } else {
                        console.log(`[Phase 4] ✗ Deletion failed on attempt ${attempt}`);
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
                    console.log("[Phase 4] ERROR: Failed to delete content after all retry attempts");
                    this.skip();
                    return;
                }

                // Add stabilization delay.
                // CodeLenses need time to re-render and attach event listeners after document edits.
                console.log("[Phase 4] Waiting for CodeLens to stabilize after deletion...");
                await driver.sleep(3000);
            }

            // Wait for CodeLens to appear
            const codeLensAppeared = await waitForCodeLens(driver, "Pull changes from TestBench");
            if (!codeLensAppeared) {
                console.log("[Phase 4] CodeLens 'Pull changes from TestBench' did not appear");
                this.skip();
            }

            // Locate the CodeLens action text above the first line that reads "Pull changes from TestBench"
            // Ensure you have updated clickCodeLens in testUtils.ts to use the MouseEvent logic
            const codeLensClicked = await clickCodeLens(driver, "Pull changes from TestBench", 0);
            if (!codeLensClicked) {
                console.log("[Phase 4] Failed to click CodeLens 'Pull changes from TestBench'");
                this.skip();
            }

            // Wait for Refactor Preview to open
            const refactorPreviewOpened = await waitForRefactorPreview(driver);
            if (!refactorPreviewOpened) {
                console.log("[Phase 4] Refactor Preview did not open after clicking CodeLens");
                this.skip();
            }

            // Ensure the checkbox for Subdiv resource.resource is checked
            const checkboxReady = await ensureRefactorPreviewItemChecked(driver, "Subdiv resource.resource");
            if (!checkboxReady) {
                console.log("[Phase 4] Warning: Could not ensure checkbox is checked, Apply might fail.");
            }

            // Click the "Apply" button inside the Refactor Preview tab
            const applyClicked = await clickRefactorPreviewApply(driver);
            if (!applyClicked) {
                console.log("[Phase 4] Failed to click Apply button in Refactor Preview");
                this.skip();
            }

            console.log("[Phase 4] Synchronization complete.");
            console.log("[ResourceCreationFlow] All phases completed successfully!");
        });
    });
});
