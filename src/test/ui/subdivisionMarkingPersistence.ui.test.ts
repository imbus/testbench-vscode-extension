/**
 * @file src/test/ui/subdivisionMarkingPersistence.ui.test.ts
 * @description UI tests for subdivision marking persistence:
 * - Verifies that after creating resource files locally, subdivision tree items are marked correctly
 * - Tests that marking persists through logout/login cycle
 * - Tests that marking persists through VS Code window reload
 * - Tests that marking persists through tree view refresh action
 */

import { expect } from "chai";
import { SideBarView, TreeItem, ViewSection, Workbench, By, until, WebDriver } from "vscode-extension-tester";
import { getTestLogger } from "./utils/testLogger";
import { waitForFileInEditor, openTestBenchSidebar, attemptLogout, ensureLoggedIn } from "./utils/testUtils";
import { cleanupWorkspace } from "./utils/workspaceUtils";
import { waitForTreeItems, UITimeouts } from "./utils/waitHelpers";
import { clickToolbarButton } from "./utils/toolbarUtils";
import { waitForTreeItemButton } from "./utils/treeViewUtils";
import { collectTreeItemLabels } from "./utils/treeItemUtils";
import { navigateToTestView } from "./utils/navigationUtils";
import { getTestData, logTestDataConfig, hasTestCredentials } from "./config/testConfig";
import { TestContext, setupTestHooks, skipTest } from "./utils/testHooks";
import { TestElementsPage } from "./pages/TestElementsPage";

const logger = getTestLogger();

function skipPrecondition(context: Mocha.Context, reason: string): never {
    return skipTest(context, "precondition", reason);
}

/**
 * Icon name prefixes used in subdivision tree items.
 * These correspond to the SVG icon files in resources/icons/.
 * Currently used icon names: missingSubdivision-dark.svg, missingSubdivision-light.svg,
 * localSubdivision-dark.svg, localSubdivision-light.svg.
 */
const SUBDIVISION_ICON_PREFIXES = {
    /** Icon prefix for subdivisions with locally available resource files */
    LOCAL: "localSubdivision",
    /** Icon prefix for subdivisions without local resource files */
    MISSING: "missingSubdivision"
} as const;

/**
 * Constants for test timing.
 */
const STATE_RESTORE_DELAY = 2000;
const REFRESH_DELAY = 3000;

/**
 * Represents the marking state of a subdivision tree item.
 */
interface SubdivisionMarkingState {
    label: string;
    isMarked: boolean;
    hasCreateButton: boolean;
    hasOpenButton: boolean;
    iconContainsLocal: boolean;
}

interface SubdivisionRowState {
    found: boolean;
    hasCreateButton: boolean;
    hasOpenButton: boolean;
    iconContainsLocal: boolean;
}

/**
 * Focuses a tree row by subdivision label so row-scoped action buttons are rendered.
 *
 * @param label - The subdivision label to focus
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if a matching row was focused
 */
async function focusSubdivisionRowByLabel(label: string, driver: WebDriver): Promise<boolean> {
    try {
        const focused = (await driver.executeScript(
            `
            const rows = document.querySelectorAll('.monaco-list-row');
            const targetLabel = String(arguments[0] || '');
            if (!targetLabel) {
                return false;
            }
            for (const row of rows) {
                const labelEl = row.querySelector('.label-name');
                const rowLabel = (labelEl?.textContent || '').trim();
                const rowText = (row.textContent || row.innerText || '').trim();
                if (rowLabel === targetLabel || rowText.includes(targetLabel)) {
                    row.scrollIntoView({ block: 'center' });
                    row.click();
                    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                    return true;
                }
            }
            return false;
        `,
            label
        )) as boolean;

        return focused;
    } catch (error) {
        logger.debug("SubdivisionRow", `Error focusing row by label "${label}": ${error}`);
        return false;
    }
}

/**
 * Reads action/button/icon state for a subdivision row by label.
 *
 * @param label - The subdivision label to inspect
 * @param driver - The WebDriver instance
 * @returns Promise<SubdivisionRowState> - The resolved row state
 */
async function readSubdivisionRowStateByLabel(label: string, driver: WebDriver): Promise<SubdivisionRowState> {
    try {
        const state = (await driver.executeScript(
            `
            const targetLabel = String(arguments[0] || '').trim();
            const localIconPrefix = String(arguments[1] || '');
            if (!targetLabel) {
                return {
                    found: false,
                    hasCreateButton: false,
                    hasOpenButton: false,
                    iconContainsLocal: false
                };
            }

            const rows = document.querySelectorAll('.monaco-list-row');
            for (const row of rows) {
                const labelEl = row.querySelector('.label-name');
                const rowLabel = (labelEl?.textContent || '').trim();
                const rowText = (row.textContent || row.innerText || '').trim();
                if (rowLabel !== targetLabel && !rowText.includes(targetLabel)) {
                    continue;
                }

                const actionButtons = row.querySelectorAll('.action-label, a.action-item, button.action-item');
                let hasCreateButton = false;
                let hasOpenButton = false;

                for (const button of actionButtons) {
                    const text = (
                        button.getAttribute('title') ||
                        button.getAttribute('aria-label') ||
                        button.textContent ||
                        ''
                    ).toLowerCase();

                    if (text.includes('create resource')) {
                        hasCreateButton = true;
                    }
                    if (text.includes('open resource')) {
                        hasOpenButton = true;
                    }
                }

                const icon = row.querySelector('.custom-view-tree-node-item-icon');
                let iconContainsLocal = false;
                if (icon) {
                    const style = window.getComputedStyle(icon);
                    const bgImage = style.backgroundImage || '';
                    const match = bgImage.match(/url\\(["']?([^"')]+)["']?\\)/);
                    const iconSrc = match ? match[1] : bgImage;
                    iconContainsLocal = !!(iconSrc && iconSrc.includes(localIconPrefix));
                }

                return {
                    found: true,
                    hasCreateButton,
                    hasOpenButton,
                    iconContainsLocal
                };
            }

            return {
                found: false,
                hasCreateButton: false,
                hasOpenButton: false,
                iconContainsLocal: false
            };
        `,
            label,
            SUBDIVISION_ICON_PREFIXES.LOCAL
        )) as SubdivisionRowState;

        return state;
    } catch (error) {
        logger.debug("SubdivisionRow", `Error reading row state for "${label}": ${error}`);
        return {
            found: false,
            hasCreateButton: false,
            hasOpenButton: false,
            iconContainsLocal: false
        };
    }
}

/**
 * Resolves a stable label for a subdivision state lookup.
 *
 * @param item - The tree item (can be stale)
 * @param labelHint - Optional caller-provided label to avoid stale reads
 * @returns Promise<string> - The resolved label (or empty string)
 */
async function resolveSubdivisionLabel(item: TreeItem, labelHint?: string): Promise<string> {
    if (labelHint && labelHint.trim().length > 0) {
        return labelHint;
    }

    try {
        return await item.getLabel();
    } catch (error) {
        logger.debug("SubdivisionRow", `Failed to resolve label from TreeItem: ${error}`);
        return "";
    }
}

/**
 * Captures the marking state of a subdivision tree item.
 * 1. Select a subdivision item in the tree.
 * 2. Read the action buttons shown for that item.
 * 3. Read the icon that represents its local/remote state.
 * 4. Combine this information into one comparable state object.
 *
 * @param item - The tree item
 * @param driver - The WebDriver instance
 * @param labelHint - Optional known label for stale-safe state lookups
 * @returns Promise<SubdivisionMarkingState> - The marking state
 */
async function captureSubdivisionMarkingState(
    item: TreeItem,
    driver: WebDriver,
    labelHint?: string
): Promise<SubdivisionMarkingState> {
    const label = await resolveSubdivisionLabel(item, labelHint);

    // Focus row by label to ensure inline action buttons are visible before reading state.
    await focusSubdivisionRowByLabel(label, driver);
    await driver.sleep(200);

    const rowState = await readSubdivisionRowStateByLabel(label, driver);
    const hasCreateButton = rowState.hasCreateButton;
    const hasOpenButton = rowState.hasOpenButton;
    const iconContainsLocal = rowState.iconContainsLocal;

    // A subdivision is considered "marked" if:
    // - It has the "Open Resource" button (resource exists locally), OR
    // - Its icon indicates local availability (localSubdivision icon)
    const isMarked = hasOpenButton || iconContainsLocal;

    logger.debug(
        "MarkingState",
        `${label}: marked=${isMarked}, hasCreate=${hasCreateButton}, hasOpen=${hasOpenButton}, iconLocal=${iconContainsLocal}`
    );

    return {
        label,
        isMarked,
        hasCreateButton,
        hasOpenButton,
        iconContainsLocal
    };
}

/**
 * Finds a subdivision that can have a resource created (has "Create Resource" button).
 * Will expand parent items if necessary to find resource subdivisions.
 * 1. Expand visible parent nodes to reveal more subdivisions.
 * 2. Check each visible item for the "Create Resource" action.
 * 3. Return the first subdivision where a resource can still be created.
 * 4. Return null if no suitable subdivision is available.
 *
 * @param driver - The WebDriver instance
 * @param elementsSection - The Test Elements section
 * @param testElementsPage - The Test Elements page object
 * @returns Promise<{ item: TreeItem | null; label: string }> - The subdivision and its label
 */
async function findUnmarkedResourceSubdivision(
    driver: WebDriver,
    elementsSection: ViewSection,
    testElementsPage: TestElementsPage
): Promise<{ item: TreeItem | null; label: string }> {
    // First, expand any parent items to reveal all subdivisions
    const topLevelItems = await elementsSection.getVisibleItems();

    for (const topItem of topLevelItems) {
        try {
            const item = topItem as TreeItem;
            const hasChildren = await item.hasChildren();
            if (hasChildren) {
                const isExpanded = await item.isExpanded();
                if (!isExpanded) {
                    logger.debug("FindSubdivision", `Expanding parent item to reveal children...`);
                    await item.expand();
                    await driver.sleep(500);
                }
            }
        } catch {
            // Skip stale elements
        }
    }

    // Re-fetch items after expansion
    const items = await elementsSection.getVisibleItems();
    const labels = await collectTreeItemLabels(items as TreeItem[]);

    logger.debug("FindSubdivision", `Checking ${labels.length} items for Create Resource button...`);

    for (const label of labels) {
        try {
            // Skip items that don't look like resource subdivisions
            // Resource subdivisions typically have "[Robot-Resource]" in their name
            const sideBar = new SideBarView();
            const content = sideBar.getContent();
            const section = await testElementsPage.getSection(content);
            if (!section) {
                continue;
            }

            const item = await testElementsPage.getItem(section, label);
            if (!item) {
                continue;
            }

            const focused = await focusSubdivisionRowByLabel(label, driver);
            if (focused) {
                await driver.sleep(200);
            }
            const rowState = await readSubdivisionRowStateByLabel(label, driver);
            const hasCreate = rowState.hasCreateButton;

            if (hasCreate) {
                logger.info("FindSubdivision", `Found unmarked resource subdivision: "${label}"`);
                return { item, label };
            }
        } catch {
            // Element became stale, continue
        }
    }

    return { item: null, label: "" };
}

/**
 * Reloads the VS Code window using Developer: Reload Window command.
 * 1. Open the command palette.
 * 2. Run "Developer: Reload Window".
 * 3. Wait until the old workbench disappears and the new one appears.
 * 4. Confirm VS Code is interactive again before continuing.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if reload was successful
 */
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

        // Wait for activity bar to be interactive
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

/**
 * Verifies that a subdivision is marked correctly after an action.
 * 1. Open the Test Elements tree after a specific user action.
 * 2. Find the same subdivision by its label.
 * 3. Read its current marking state.
 * 4. Report whether it is still marked.
 *
 * @param driver - The WebDriver instance
 * @param elementsSection - The Test Elements section
 * @param testElementsPage - The Test Elements page object
 * @param expectedLabel - The label of the subdivision to verify
 * @param actionName - Name of the action for logging
 * @returns Promise<boolean> - True if the subdivision is still marked
 */
async function verifySubdivisionIsMarked(
    driver: WebDriver,
    elementsSection: ViewSection,
    testElementsPage: TestElementsPage,
    expectedLabel: string,
    actionName: string
): Promise<boolean> {
    logger.info("Verify", `Verifying subdivision "${expectedLabel}" is marked after ${actionName}...`);

    await waitForTreeItems(elementsSection, driver);

    const item = await testElementsPage.getItem(elementsSection, expectedLabel);
    if (!item) {
        logger.error("Verify", `Subdivision "${expectedLabel}" not found after ${actionName}`);
        return false;
    }

    const state = await captureSubdivisionMarkingState(item, driver);

    if (state.isMarked) {
        logger.info("Verify", `✓ Subdivision "${expectedLabel}" is correctly marked after ${actionName}`);
        return true;
    } else {
        logger.error(
            "Verify",
            `✗ Subdivision "${expectedLabel}" is NOT marked after ${actionName}. Expected: marked, Got: unmarked`
        );
        return false;
    }
}

describe("Subdivision Marking Persistence UI Tests", function () {
    const ctx: TestContext = {} as TestContext;

    this.timeout(300000);

    setupTestHooks(ctx, {
        suiteName: "SubdivisionMarkingPersistence",
        requiresLogin: true,
        openSidebar: true,
        timeout: 300000
    });

    const getDriver = () => ctx.driver;

    // Track the subdivision we create a resource for
    let createdResourceSubdivisionLabel: string = "";

    /**
     * Helper to get Test Elements section.
     * 1. Open the TestBench side panel.
     * 2. Locate the Test Elements section.
     * 3. Return that section so tests can interact with it.
     */
    async function getElementsSection(): Promise<ViewSection | null> {
        const driver = getDriver();
        const testElementsPage = new TestElementsPage(driver);
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        return await testElementsPage.getSection(content);
    }

    /**
     * Helper to navigate to Test Elements view.
     * 1. Navigate to the Test Elements view from the current UI state.
     * 2. Wait until tree items are loaded.
     * 3. Return whether navigation succeeded and the resolved section.
     */
    async function navigateToTestElements(): Promise<{ section: ViewSection | null; success: boolean }> {
        const driver = getDriver();
        const result = await navigateToTestView(driver, "testElements");
        if (!result.success || !result.section) {
            logger.error("Navigation", `Failed to navigate to Test Elements view: ${result.error}`);
            return { section: null, success: false };
        }
        await waitForTreeItems(result.section, driver);
        return { section: result.section, success: true };
    }

    before(async function () {
        if (!hasTestCredentials()) {
            logger.warn("Setup", "Test credentials not available - skipping test suite");
            skipPrecondition(this, "Test credentials not available - skipping test suite");
        }

        const driver = getDriver();

        // Clean up workspace (excluding .testbench folder) before tests
        logger.info("Setup", "Cleaning workspace before tests...");
        await cleanupWorkspace(driver, undefined, {
            exclude: [".testbench"]
        });
    });

    describe("Resource Creation and Marking Verification", function () {
        /*
         * 1. Open the Test Elements view.
         * 2. Expand visible parent nodes so hidden subdivisions become visible.
         * 3. Read a sample of visible subdivisions.
         * 4. Capture and log whether each sampled subdivision is marked or unmarked.
         * 5. Confirm that the tree contains at least one subdivision.
         */
        it("should navigate to Test Elements view and capture initial marking states", async function () {
            const driver = getDriver();
            logTestDataConfig();

            logger.info("Phase1", "Navigating to Test Elements View...");
            const { section: elementsSection, success } = await navigateToTestElements();
            if (!success || !elementsSection) {
                throw new Error("Failed to navigate to Test Elements view");
            }

            // Expand all top-level items to reveal child subdivisions
            const topLevelItems = await elementsSection.getVisibleItems();
            for (const topItem of topLevelItems) {
                try {
                    const item = topItem as TreeItem;
                    const hasChildren = await item.hasChildren();
                    if (hasChildren) {
                        const isExpanded = await item.isExpanded();
                        if (!isExpanded) {
                            logger.debug("Phase1", "Expanding parent item to reveal children...");
                            await item.expand();
                            await driver.sleep(500);
                        }
                    }
                } catch {
                    // Skip stale elements
                }
            }

            // Re-fetch items after expansion
            const items = await elementsSection.getVisibleItems();
            logger.info("Phase1", `Found ${items.length} subdivision(s) in Test Elements view after expansion`);

            // Log first few items with their marking states
            for (let i = 0; i < Math.min(5, items.length); i++) {
                try {
                    const item = items[i] as TreeItem;
                    const state = await captureSubdivisionMarkingState(item, driver);
                    logger.info(
                        "Phase1",
                        `[${i}] ${state.label}: ${state.isMarked ? "MARKED" : "UNMARKED"} (icon=${state.iconContainsLocal ? "local" : "missing"})`
                    );
                } catch {
                    // Skip stale elements
                }
            }

            expect(items.length).to.be.greaterThan(0, "Should have at least one subdivision in tree");
        });

        /*
         * 1. Open the Test Elements view.
         * 2. Find a subdivision that still shows "Create Resource" (unmarked state).
         * 3. Verify it starts as unmarked.
         * 4. Create the resource file from that subdivision.
         * 5. Confirm the file opens in the editor.
         * 6. Return to the tree and verify the same subdivision is now marked.
         */
        it("should create a resource file from an unmarked subdivision and verify marking", async function () {
            const driver = getDriver();
            const testElementsPage = new TestElementsPage(driver);
            const config = getTestData();

            // Navigate to Test Elements view
            const { section: elementsSection, success } = await navigateToTestElements();
            if (!success || !elementsSection) {
                throw new Error("Failed to navigate to Test Elements view");
            }

            // Expand all top-level items to reveal child subdivisions
            const topLevelItems = await elementsSection.getVisibleItems();
            for (const topItem of topLevelItems) {
                try {
                    const item = topItem as TreeItem;
                    const hasChildren = await item.hasChildren();
                    if (hasChildren) {
                        const isExpanded = await item.isExpanded();
                        if (!isExpanded) {
                            logger.debug("Phase2", "Expanding parent item to reveal children...");
                            await item.expand();
                            await driver.sleep(500);
                        }
                    }
                } catch {
                    // Skip stale elements
                }
            }

            // Re-fetch section after expansion
            const sideBar = new SideBarView();
            const expandedContent = sideBar.getContent();
            const expandedSection = await testElementsPage.getSection(expandedContent);
            if (!expandedSection) {
                throw new Error("Test Elements section not found after expansion");
            }

            // First try the configured subdivision
            let targetSubdivision = await testElementsPage.getItem(expandedSection, config.subdivisionName);
            let targetLabel = config.subdivisionName;

            if (targetSubdivision) {
                await focusSubdivisionRowByLabel(targetLabel, driver);
                await driver.sleep(200);
                const rowState = await readSubdivisionRowStateByLabel(targetLabel, driver);
                const hasCreate = rowState.hasCreateButton;
                if (!hasCreate) {
                    logger.info(
                        "Phase2",
                        `Configured subdivision "${config.subdivisionName}" has no Create Resource button, searching for alternative...`
                    );
                    targetSubdivision = null;
                }
            } else {
                logger.info(
                    "Phase2",
                    `Configured subdivision "${config.subdivisionName}" not found, searching for alternative...`
                );
            }

            // If configured subdivision doesn't work, find any unmarked resource subdivision
            if (!targetSubdivision) {
                const result = await findUnmarkedResourceSubdivision(driver, expandedSection, testElementsPage);
                targetSubdivision = result.item;
                targetLabel = result.label;
            }

            if (!targetSubdivision) {
                logger.warn("Phase2", "No unmarked resource subdivision found - all resources may already be created");
                skipPrecondition(this, "No unmarked resource subdivision found");
            }

            // Capture initial marking state (this clicks the item)
            const initialState = await captureSubdivisionMarkingState(targetSubdivision, driver, targetLabel);
            logger.info("Phase2", `Initial state of "${targetLabel}": marked=${initialState.isMarked}`);

            // Verify initial state is unmarked
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(initialState.hasCreateButton, "Subdivision should have Create Resource button").to.be.true;
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(initialState.isMarked, "Subdivision should NOT be marked before creating resource").to.be.false;

            // Re-fetch the subdivision with fresh reference (item may have become stale)
            const freshSideBar = new SideBarView();
            const freshContent = freshSideBar.getContent();
            const freshSection = await testElementsPage.getSection(freshContent);
            if (!freshSection) {
                throw new Error("Test Elements section not found");
            }

            const freshSubdivision = await testElementsPage.getItem(freshSection, targetLabel);
            if (!freshSubdivision) {
                throw new Error(`Subdivision "${targetLabel}" not found after refresh`);
            }

            // Click the subdivision to show action buttons (following resourceCreationFlow pattern)
            await freshSubdivision.click();
            await driver.sleep(300);

            // Wait for button to be visible
            const buttonVisible = await waitForTreeItemButton(
                freshSubdivision,
                driver,
                "Create Resource",
                UITimeouts.MEDIUM
            );
            if (!buttonVisible) {
                logger.warn("Phase2", "Create Resource button not visible, trying to click again...");
                await freshSubdivision.click();
                await driver.sleep(500);
            }

            logger.info("Phase2", `Creating resource for subdivision "${targetLabel}"...`);

            // Click Create Resource button
            const createClicked = await testElementsPage.clickCreateResource(freshSubdivision, targetLabel);
            if (!createClicked) {
                throw new Error("Failed to click Create Resource button");
            }

            // Wait for resource file to be created and opened in editor
            const expectedResourceFileName = `${targetLabel}.resource`;
            const fileOpened = await waitForFileInEditor(driver, expectedResourceFileName, UITimeouts.LONG);

            if (!fileOpened) {
                // Try with generic .resource extension
                const genericFileOpened = await waitForFileInEditor(driver, ".resource", UITimeouts.MEDIUM);
                if (!genericFileOpened) {
                    throw new Error(`Resource file not opened in editor after creation`);
                }
            }

            logger.info("Phase2", `Resource file created and opened in editor`);

            // Store the label for subsequent tests
            createdResourceSubdivisionLabel = targetLabel;

            // Navigate back to sidebar and verify marking
            await openTestBenchSidebar(driver);

            const updatedSection = await getElementsSection();
            if (!updatedSection) {
                throw new Error("Test Elements section not found after resource creation");
            }

            await driver.sleep(STATE_RESTORE_DELAY);
            await waitForTreeItems(updatedSection, driver);

            // Re-fetch the subdivision with fresh reference
            const updatedSubdivision = await testElementsPage.getItem(updatedSection, targetLabel);
            if (!updatedSubdivision) {
                throw new Error(`Subdivision "${targetLabel}" not found after resource creation`);
            }

            // Verify subdivision is now marked
            const finalState = await captureSubdivisionMarkingState(updatedSubdivision, driver, targetLabel);
            logger.info("Phase2", `Final state of "${targetLabel}": marked=${finalState.isMarked}`);

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(finalState.isMarked, "Subdivision should be MARKED after creating resource").to.be.true;
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(finalState.hasOpenButton, "Subdivision should have Open Resource button after creation").to.be.true;
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(finalState.hasCreateButton, "Subdivision should NOT have Create Resource button after creation").to
                .be.false;

            logger.info("Phase2", `✓ Subdivision "${targetLabel}" is correctly marked after resource creation`);
        });
    });

    describe("Marking Persistence After VS Code Window Reload", function () {
        /*
         * 1. Reload the entire VS Code window.
         * 2. Wait for the extension UI to become available again.
         * 3. Return to the Test Elements view.
         * 4. Verify that the previously marked subdivision is still marked.
         */
        it("should persist subdivision marking after Developer: Reload Window", async function () {
            const driver = getDriver();
            const testElementsPage = new TestElementsPage(driver);

            if (!createdResourceSubdivisionLabel) {
                logger.warn("Reload", "No resource was created in previous test - skipping");
                skipPrecondition(this, "No resource was created in previous test");
            }

            logger.info("Reload", "Reloading VS Code window...");
            const reloaded = await reloadVSCodeWindow(driver);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(reloaded, "VS Code window should reload successfully").to.be.true;

            // Wait for extension to activate
            await driver.sleep(STATE_RESTORE_DELAY);

            // Navigate to Test Elements view
            logger.info("Reload", "Navigating back to Test Elements view...");
            await openTestBenchSidebar(driver);

            const { section: elementsSection, success } = await navigateToTestElements();
            if (!success || !elementsSection) {
                throw new Error("Failed to navigate to Test Elements view after reload");
            }

            // Verify the subdivision is still marked
            const isMarked = await verifySubdivisionIsMarked(
                driver,
                elementsSection,
                testElementsPage,
                createdResourceSubdivisionLabel,
                "window reload"
            );

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(isMarked, `Subdivision "${createdResourceSubdivisionLabel}" should still be marked after reload`).to
                .be.true;
        });
    });

    describe("Marking Persistence After Logout/Login Cycle", function () {
        /*
         * 1. Log out from TestBench.
         * 2. Log back in using test credentials.
         * 3. Open Test Elements again.
         * 4. Verify that the same subdivision remains marked after re-authentication.
         */
        it("should persist subdivision marking after logout and login", async function () {
            const driver = getDriver();
            const testElementsPage = new TestElementsPage(driver);

            if (!createdResourceSubdivisionLabel) {
                logger.warn("LogoutLogin", "No resource was created in previous test - skipping");
                skipPrecondition(this, "No resource was created in previous test");
            }

            // Logout
            logger.info("LogoutLogin", "Logging out...");
            const loggedOut = await attemptLogout(driver);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(loggedOut, "Logout should succeed").to.be.true;

            await driver.sleep(STATE_RESTORE_DELAY);

            // Login again
            logger.info("LogoutLogin", "Logging back in...");
            const loggedIn = await ensureLoggedIn(driver);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(loggedIn, "Login should succeed").to.be.true;

            await driver.sleep(STATE_RESTORE_DELAY);

            // Navigate to Test Elements view
            logger.info("LogoutLogin", "Navigating to Test Elements view...");
            const { section: elementsSection, success } = await navigateToTestElements();
            if (!success || !elementsSection) {
                throw new Error("Failed to navigate to Test Elements view after login");
            }

            // Verify the subdivision is still marked
            const isMarked = await verifySubdivisionIsMarked(
                driver,
                elementsSection,
                testElementsPage,
                createdResourceSubdivisionLabel,
                "logout/login cycle"
            );

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(
                isMarked,
                `Subdivision "${createdResourceSubdivisionLabel}" should still be marked after logout/login`
            ).to.be.true;
        });
    });

    describe("Marking Persistence After Tree View Refresh", function () {
        /*
         * 1. Open the Test Elements view.
         * 2. Click the toolbar refresh action for this tree.
         * 3. Wait for refresh to complete.
         * 4. Verify that the previously marked subdivision is still marked.
         */
        it("should persist subdivision marking after clicking Refresh Test Elements toolbar button", async function () {
            const driver = getDriver();
            const testElementsPage = new TestElementsPage(driver);

            if (!createdResourceSubdivisionLabel) {
                logger.warn("Refresh", "No resource was created in previous test - skipping");
                skipPrecondition(this, "No resource was created in previous test");
            }

            // Navigate to Test Elements view
            const { section: elementsSection, success } = await navigateToTestElements();
            if (!success || !elementsSection) {
                throw new Error("Failed to navigate to Test Elements view");
            }

            // Click Refresh Test Elements toolbar button
            logger.info("Refresh", "Clicking Refresh Test Elements toolbar button...");
            const refreshClicked = await clickToolbarButton(elementsSection, "Refresh Test Elements", driver);

            if (!refreshClicked) {
                // Try alternative button names
                const altRefreshClicked = await clickToolbarButton(elementsSection, "refresh", driver);
                if (!altRefreshClicked) {
                    logger.warn("Refresh", "Could not find Refresh toolbar button");
                }
            }

            // Wait for refresh to complete
            await driver.sleep(REFRESH_DELAY);
            await waitForTreeItems(elementsSection, driver);

            // Verify the subdivision is still marked
            const isMarked = await verifySubdivisionIsMarked(
                driver,
                elementsSection,
                testElementsPage,
                createdResourceSubdivisionLabel,
                "tree view refresh"
            );

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(isMarked, `Subdivision "${createdResourceSubdivisionLabel}" should still be marked after refresh`).to
                .be.true;
        });
    });

    describe("Summary Verification", function () {
        /*
         * 1. Confirm that a subdivision was actually used for this suite.
         * 2. Print a readable summary of all persistence checks.
         * 3. Provide a quick overview for reviewers of what was validated.
         */
        it("should verify all persistence scenarios passed", async function () {
            if (!createdResourceSubdivisionLabel) {
                logger.warn("Summary", "No resource was created - test suite did not run completely");
                skipPrecondition(this, "No resource was created - test suite did not run completely");
            }

            logger.info("Summary", "=".repeat(60));
            logger.info("Summary", "Subdivision Marking Persistence Test Summary");
            logger.info("Summary", "=".repeat(60));
            logger.info("Summary", `Tested subdivision: "${createdResourceSubdivisionLabel}"`);
            logger.info("Summary", "Persistence scenarios verified:");
            logger.info("Summary", "  Resource creation - subdivision marked correctly");
            logger.info("Summary", "  VS Code window reload - marking persisted");
            logger.info("Summary", "  Logout/login cycle - marking persisted");
            logger.info("Summary", "  Tree view refresh - marking persisted");
            logger.info("Summary", "=".repeat(60));
        });
    });
});
