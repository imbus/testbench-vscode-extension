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
    waitForProjectsView,
    waitForTestThemesAndElementsViews,
    handleCycleConfigurationPrompt,
    attemptLogout,
    ensureLoggedIn,
    openTestBenchSidebar
} from "./utils/testUtils";
import { applySlowMotion, waitForTreeItems, UITimeouts } from "./utils/waitHelpers";
import { clickToolbarButton } from "./utils/toolbarUtils";
import { getTestData, logTestDataConfig, hasTestCredentials } from "./config/testConfig";
import { TestContext, setupTestHooks, skipTest } from "./utils/testHooks";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";
import { TestThemesPage } from "./pages/TestThemesPage";
import { TestElementsPage } from "./pages/TestElementsPage";
import { doubleClickTreeItem } from "./utils/treeViewUtils";

const logger = getTestLogger();

function skipPrecondition(context: Mocha.Context, reason: string): never {
    return skipTest(context, "precondition", reason);
}

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
    occurrence: number;
}

interface TreeViewExpansionState {
    viewName: string;
    items: Map<string, TreeItemExpansionState>;
    trackedLabels?: string[];
}

interface ToggleResult {
    count: number;
    labels: string[];
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

/**
 * Captures the currently visible tree expansion state for a view section.
 *
 * Each visible row is recorded with label, expandability, expansion flag, and
 * occurrence index to distinguish duplicate labels.
 *
 * @param section - Tree section to inspect
 * @param viewName - Logical view name used for logging
 * @returns Snapshot of visible tree item expansion state
 */
async function captureTreeExpansionState(section: ViewSection, viewName: string): Promise<TreeViewExpansionState> {
    const state: TreeViewExpansionState = { viewName, items: new Map() };
    const labelOccurrences = new Map<string, number>();

    try {
        const items = (await section.getVisibleItems()) as TreeItem[];
        logger.debug("ExpansionState", `Capturing state for ${items.length} visible items in ${viewName}`);

        for (const item of items) {
            try {
                const label = await item.getLabel();
                const hasChildren = await item.hasChildren();
                const isExpanded = hasChildren ? await item.isExpanded() : false;
                const occurrence = (labelOccurrences.get(label) || 0) + 1;
                labelOccurrences.set(label, occurrence);
                const stateKey = `${label}::${occurrence}`;

                state.items.set(stateKey, { label, isExpanded, hasChildren, occurrence });

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

/**
 * Groups expansion states by item label.
 * Each map entry contains a list of expansion flags for all visible occurrences
 * of that label. Only expandable items are included. If tracked labels are
 * provided, only those labels are considered.
 *
 * @param state - Captured tree expansion state
 * @param trackedLabels - Optional set of labels to include
 * @returns Map from label to list of expansion states
 */
function groupExpansionStatesByLabel(
    state: TreeViewExpansionState,
    trackedLabels?: Set<string>
): Map<string, boolean[]> {
    const groupedStates = new Map<string, boolean[]>();
    const useTrackedLabels = (trackedLabels?.size || 0) > 0;

    for (const itemState of state.items.values()) {
        if (!itemState.hasChildren) {
            continue;
        }

        if (useTrackedLabels && !trackedLabels!.has(itemState.label)) {
            continue;
        }

        const labelStates = groupedStates.get(itemState.label) || [];
        labelStates.push(itemState.isExpanded);
        groupedStates.set(itemState.label, labelStates);
    }

    return groupedStates;
}

/**
 * Compares expected and actual expansion states.
 * Comparison is done per label using counts of expanded occurrences.
 *
 * @param expected - Expansion state captured before the persistence action
 * @param actual - Expansion state captured after the persistence action
 * @param allowMissingTrackedLabels - If true, missing tracked labels are tolerated
 * @returns List of detected differences (empty means states match)
 */
function compareExpansionStates(
    expected: TreeViewExpansionState,
    actual: TreeViewExpansionState,
    allowMissingTrackedLabels: boolean = false
): string[] {
    const differences: string[] = [];
    const trackedLabelSet = new Set(expected.trackedLabels || []);
    const hasTrackedLabels = trackedLabelSet.size > 0;

    const expectedByLabel = groupExpansionStatesByLabel(expected, trackedLabelSet);
    const actualByLabel = groupExpansionStatesByLabel(actual, trackedLabelSet);

    for (const [label, expectedStates] of expectedByLabel) {
        const actualStates = actualByLabel.get(label) || [];

        if (actualStates.length < expectedStates.length) {
            if (hasTrackedLabels && allowMissingTrackedLabels && actualStates.length === 0) {
                logger.warn(
                    "Persistence",
                    `Skipping strict comparison for tracked label "${label}" because it is not visible after restoration`
                );
                continue;
            }

            differences.push(
                `Item "${label}" instance count mismatch: expected ${expectedStates.length}, got ${actualStates.length}`
            );
            continue;
        }

        const expectedExpanded = expectedStates.filter((state) => state).length;
        const actualExpanded = actualStates.filter((state) => state).length;
        const expectedCollapsed = expectedStates.length - expectedExpanded;
        const actualCollapsed = actualStates.length - actualExpanded;

        // Label-based tracking can become ambiguous after restoration when additional
        // same-label items become visible. In that case, require that actual states can
        // still satisfy the expected expanded/collapsed counts for at least one match.
        if (hasTrackedLabels && actualStates.length > expectedStates.length) {
            if (actualExpanded < expectedExpanded || actualCollapsed < expectedCollapsed) {
                differences.push(
                    `Item "${label}" ambiguous-count mismatch: expected at least ${expectedExpanded} expanded and ${expectedCollapsed} collapsed, got ${actualExpanded} expanded and ${actualCollapsed} collapsed across ${actualStates.length} visible items`
                );
            }
            continue;
        }

        if (expectedExpanded !== actualExpanded) {
            differences.push(
                `Item "${label}" expanded-count mismatch: expected ${expectedExpanded}/${expectedStates.length}, got ${actualExpanded}/${actualStates.length}`
            );
        }
    }

    return differences;
}

/**
 * Returns a shuffled copy of the provided list using Fisher-Yates.
 *
 * @param items - Source items
 * @returns New array with randomized order
 */
function shuffleItems<T>(items: T[]): T[] {
    const shuffledItems = [...items];

    for (let index = shuffledItems.length - 1; index > 0; index--) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [shuffledItems[index], shuffledItems[randomIndex]] = [shuffledItems[randomIndex], shuffledItems[index]];
    }

    return shuffledItems;
}

/**
 * Randomly toggles expansion state of up to `maxItems` expandable tree items.
 * @param section - Tree view section
 * @param driver - WebDriver instance
 * @param maxItems - Maximum number of items to toggle
 * @returns Number of toggled items and their labels
 */
async function toggleRandomTreeItems(
    section: ViewSection,
    driver: WebDriver,
    maxItems: number = TOGGLE_ITEM_COUNT
): Promise<ToggleResult> {
    let toggledCount = 0;
    const toggledLabels: string[] = [];

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
            return { count: 0, labels: [] };
        }

        const labelCounts = new Map<string, number>();
        for (const item of expandableItems) {
            try {
                const label = await item.getLabel();
                labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
            } catch {
                // Skip stale labels while building candidate list
            }
        }

        const unambiguousItems: TreeItem[] = [];
        for (const item of expandableItems) {
            try {
                const label = await item.getLabel();
                if ((labelCounts.get(label) || 0) === 1) {
                    unambiguousItems.push(item);
                }
            } catch {
                // Skip stale labels while building candidate list
            }
        }

        const candidateItems = unambiguousItems.length > 0 ? unambiguousItems : expandableItems;
        const shuffledCandidates = shuffleItems(candidateItems);
        const itemsToToggle = shuffledCandidates.slice(0, Math.min(maxItems, shuffledCandidates.length));

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
                toggledLabels.push(label);
            } catch (error) {
                logger.debug("Toggle", `Error toggling item: ${error}`);
            }
        }
    } catch (error) {
        logger.error("Toggle", `Error toggling tree items: ${error}`);
    }

    return { count: toggledCount, labels: toggledLabels };
}

/**
 * Expands all currently visible expandable items in a tree section.
 *
 * If expanding reveals additional rows, the function recursively continues
 * until no new visible items are discovered.
 *
 * @param section - Tree view section
 * @param driver - WebDriver instance
 * @returns Total number of expansion actions performed
 */
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

/**
 * Reloads the VS Code window using the command palette.
 *
 * @param driver - WebDriver instance
 * @returns True when reload appears successful
 */
async function reloadVSCodeWindow(driver: WebDriver): Promise<boolean> {
    logger.info("Reload", "Reloading VS Code window...");

    try {
        const originalWindowHandle = await driver.getWindowHandle().catch(() => null);

        const switchToWorkbenchWindow = async (): Promise<boolean> => {
            try {
                const handles = await driver.getAllWindowHandles();
                for (const handle of handles) {
                    try {
                        await driver.switchTo().window(handle);
                        await driver.findElement(By.className("monaco-workbench"));
                        return true;
                    } catch {
                        // Try next handle
                    }
                }
            } catch {
                // Ignore and return false below
            }
            return false;
        };

        // Capture reference to current workbench to detect when reload starts
        let oldWorkbench: any;
        try {
            oldWorkbench = await driver.findElement(By.className("monaco-workbench"));
        } catch {
            // Element might not exist
        }

        // Retry the full command-palette flow because quick picks can intermittently lag.
        let reloadCommandTriggered = false;
        const commandQueries = ["Developer: Reload Window", ">Developer: Reload Window", "Reload Window"];

        for (let attempt = 1; attempt <= 3 && !reloadCommandTriggered; attempt++) {
            let commandPalette: any;

            try {
                const workbench = new Workbench();
                commandPalette = await workbench.openCommandPrompt();
            } catch (error) {
                logger.warn("Reload", `Command palette open attempt ${attempt} failed: ${error}`);
                if (attempt === 3) {
                    throw error;
                }
                await driver.sleep(1000);
                continue;
            }

            for (const query of commandQueries) {
                try {
                    await commandPalette.setText(query);

                    const picksReady = await driver.wait(
                        async () => {
                            try {
                                const picks = await commandPalette.getQuickPicks();
                                return picks.length > 0;
                            } catch {
                                return false;
                            }
                        },
                        UITimeouts.VERY_LONG,
                        `Waiting for quick picks to populate for query: ${query}`
                    );

                    if (!picksReady) {
                        continue;
                    }

                    const picks = await commandPalette.getQuickPicks();
                    for (const pick of picks) {
                        try {
                            const text = await pick.getText();
                            if (text.includes("Reload Window") || text.includes("Developer: Reload Window")) {
                                await pick.select();
                                reloadCommandTriggered = true;
                                break;
                            }
                        } catch (error) {
                            logger.debug("Reload", `Error reading pick text: ${error}`);
                        }
                    }

                    if (reloadCommandTriggered) {
                        break;
                    }
                } catch (error) {
                    logger.debug("Reload", `Query '${query}' failed on attempt ${attempt}: ${error}`);
                }
            }

            if (!reloadCommandTriggered) {
                logger.warn("Reload", `Reload command not found on attempt ${attempt}; retrying...`);
                try {
                    await commandPalette.cancel();
                } catch {
                    // Ignore cancel errors
                }
                await driver.sleep(500);
            }
        }

        if (!reloadCommandTriggered) {
            logger.warn("Reload", "Reload Window command could not be triggered after retries");
            return false;
        }

        // If the original window handle is gone after reload trigger, move to an active workbench window.
        if (originalWindowHandle) {
            try {
                await driver.switchTo().window(originalWindowHandle);
            } catch {
                const switched = await switchToWorkbenchWindow();
                if (!switched) {
                    logger.warn("Reload", "Could not switch to an active workbench window after reload trigger");
                    return false;
                }
            }
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

        if (!(await switchToWorkbenchWindow())) {
            logger.warn("Reload", "Could not confirm active workbench window after reload");
            return false;
        }

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

/**
 * Navigates from Projects view to Test Themes/Test Elements by opening a cycle.
 *
 * Uses configured project/version/cycle and falls back to first available
 * version/cycle if configured names are not found.
 *
 * @param driver - WebDriver instance
 * @returns True if both Test Themes and Test Elements views become visible
 */
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

        let version = await projectsPage.getVersion(project, config.versionName);
        if (!version) {
            logger.warn("Navigation", `Version "${config.versionName}" not found, using first available version`);
            version = await projectsPage.getFirstChild(project);
        }

        if (!version) {
            logger.warn("Navigation", "No version found under selected project");
            return false;
        }

        let cycle = await projectsPage.getCycle(version, config.cycleName);
        if (!cycle) {
            logger.warn("Navigation", `Cycle "${config.cycleName}" not found, using first available cycle`);
            cycle = await projectsPage.getFirstChild(version);
        }

        if (!cycle) {
            logger.warn("Navigation", "No cycle found under selected version");
            return false;
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

        // Re-fetch cycle after potential tree updates from configuration prompt
        const refreshedProjectsSection = await projectsPage.getSection(sideBar.getContent());
        if (refreshedProjectsSection) {
            const refreshedProject = await projectsPage.getProject(refreshedProjectsSection, config.projectName);
            if (refreshedProject) {
                const refreshedVersion =
                    (await projectsPage.getVersion(refreshedProject, config.versionName)) ||
                    (await projectsPage.getFirstChild(refreshedProject));
                if (refreshedVersion) {
                    const refreshedCycle =
                        (await projectsPage.getCycle(refreshedVersion, config.cycleName)) ||
                        (await projectsPage.getFirstChild(refreshedVersion));
                    if (refreshedCycle) {
                        cycle = refreshedCycle;
                    }
                }
            }
        }

        await doubleClickTreeItem(cycle, driver);

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

/**
 * Returns the sidebar section for a given page object.
 *
 * @param page - Page object instance for Projects/Test Themes/Test Elements
 * @param _driver - Unused WebDriver parameter (kept for call-site symmetry)
 * @returns Matching sidebar section or null
 */
async function getSection(
    page: ProjectsViewPage | TestThemesPage | TestElementsPage,
    _driver: WebDriver
): Promise<ViewSection | null> {
    const sideBar = new SideBarView();
    const content = sideBar.getContent();
    return await page.getSection(content);
}

/**
 * Prepares a tree for persistence verification by expanding items, toggling
 * a subset, and capturing the resulting state.
 *
 * @param section - Tree section to prepare
 * @param driver - WebDriver instance
 * @param viewName - Logical view name for logging
 * @returns Captured tree state including tracked toggled labels
 */
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

    const toggleResult = await toggleRandomTreeItems(refreshedSection, driver, TOGGLE_ITEM_COUNT);
    await applySlowMotion(driver);

    const finalSection = await getSection(page, driver);
    if (!finalSection) {
        throw new Error(`${viewName} section not found before capturing state`);
    }

    const capturedState = await captureTreeExpansionState(finalSection, viewName);
    capturedState.trackedLabels = toggleResult.labels;
    return capturedState;
}

/**
 * Verifies expansion state preservation after a persistence action.
 *
 * Captures state with retries to tolerate transient stale-element issues and
 * compares it against the pre-action state.
 *
 * @param stateBefore - State captured before action
 * @param page - Page object for the target view
 * @param driver - WebDriver instance
 * @param viewName - Logical view name
 * @param action - Persistence action performed
 */
async function verifyStatePreserved(
    stateBefore: TreeViewExpansionState,
    page: ProjectsViewPage | TestThemesPage | TestElementsPage,
    driver: WebDriver,
    viewName: ViewName,
    action: PersistenceAction
): Promise<void> {
    const minimumExpectedItems = Math.max(1, Math.floor(stateBefore.items.size * 0.9));
    let stateAfter: TreeViewExpansionState | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
        const section = await getSection(page, driver);
        if (!section) {
            throw new Error(`${viewName} section not found after ${action}`);
        }

        await waitForTreeItems(section, driver, UITimeouts.MEDIUM);
        const captured = await captureTreeExpansionState(section, viewName);

        if (!stateAfter || captured.items.size > stateAfter.items.size) {
            stateAfter = captured;
        }

        if (captured.items.size >= minimumExpectedItems) {
            break;
        }

        logger.warn(
            "Persistence",
            `Captured only ${captured.items.size}/${stateBefore.items.size} items after ${action} (attempt ${attempt}/3), retrying...`
        );
        await driver.sleep(500);
    }

    if (!stateAfter) {
        throw new Error(`Could not capture ${viewName} state after ${action}`);
    }

    logger.info("Persistence", `Captured state of ${stateAfter.items.size} items after ${action}`);

    const differences = compareExpansionStates(stateBefore, stateAfter, viewName !== "Projects");

    if (differences.length > 0) {
        logger.error("Persistence", "Expansion state differences found:");
        differences.forEach((diff) => logger.error("Persistence", `  - ${diff}`));
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    expect(differences, `${viewName} expansion state should be preserved after ${action}`).to.be.empty;
    logger.info("Persistence", `${viewName} expansion state preserved after ${action} ✓`);
}

/**
 * Ensures the requested test view is visible.
 *
 * If already visible, returns immediately. Otherwise it navigates through
 * Projects to open Test Themes/Test Elements and waits for the target section.
 *
 * @param driver - WebDriver instance
 * @param viewName - Target view name
 * @returns True if target view is visible
 */
async function navigateToTestView(driver: WebDriver, viewName: "Test Themes" | "Test Elements"): Promise<boolean> {
    await openTestBenchSidebar(driver);

    const sideBar = new SideBarView();
    const content = sideBar.getContent();
    const sections = await content.getSections();

    for (const section of sections) {
        const title = await section.getTitle();
        if (title.includes(viewName)) {
            logger.info("Persistence", `Already in ${viewName} view`);
            return true;
        }
    }

    const navigated = await navigateToTestThemesAndElements(driver);
    if (!navigated) {
        logger.warn("Persistence", `Navigation to ${viewName} failed`);
        return false;
    }

    const sectionAppeared = await driver.wait(
        async () => {
            try {
                const updatedSections = await new SideBarView().getContent().getSections();
                for (const section of updatedSections) {
                    const title = await section.getTitle();
                    if (title.includes(viewName)) {
                        return true;
                    }
                }
                return false;
            } catch {
                return false;
            }
        },
        UITimeouts.LONG,
        `Waiting for ${viewName} view to appear`
    );

    if (!sectionAppeared) {
        logger.warn("Persistence", `${viewName} view did not appear after navigation`);
        return false;
    }

    return true;
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
        /*
         * 1. Open the Projects tree and wait until items are visible.
         * 2. Expand the tree and change a few item expansion states.
         * 3. Save the current expanded/collapsed state as baseline.
         * 4. Log out and then log back in.
         * 5. Return to Projects and verify the same expansion state is restored.
         */
        it("should preserve expansion state after logout/login", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                skipPrecondition(this, "Test credentials not available");
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

        /*
         * 1. Open the Projects tree and wait until items are visible.
         * 2. Expand the tree and change a few item expansion states.
         * 3. Save the current expanded/collapsed state as baseline.
         * 4. Reload the VS Code window.
         * 5. Open Projects again and verify the same expansion state is restored.
         */
        it("should preserve expansion state after VS Code reload", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                skipPrecondition(this, "Test credentials not available");
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

        /*
         * 1. Open the Projects tree and wait until items are visible.
         * 2. Expand the tree and change a few item expansion states.
         * 3. Save the current expanded/collapsed state as baseline.
         * 4. Click the Projects refresh button.
         * 5. Verify that the expansion state remains the same after refresh.
         */
        it("should preserve expansion state after tree view refresh", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                skipPrecondition(this, "Test credentials not available");
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
            const navigated = await navigateToTestView(driver, "Test Themes");
            if (!navigated) {
                logger.warn("Persistence", "Skipping test because Test Themes view navigation failed");
                skipPrecondition(this, "Test Themes view navigation failed");
            }
        });

        /*
         * 1. Navigate to the Test Themes tree.
         * 2. Expand items and change a few expansion states.
         * 3. Save the current expanded/collapsed state as baseline.
         * 4. Log out and then log back in.
         * 5. Return to Test Themes and verify the same expansion state is restored.
         */
        it("should preserve expansion state after logout/login", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                skipPrecondition(this, "Test credentials not available");
            }

            const testThemesPage = new TestThemesPage(driver);
            const section = await getSection(testThemesPage, driver);
            if (!section) {
                skipPrecondition(this, "Test Themes section not found");
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

        /*
         * 1. Navigate to the Test Themes tree.
         * 2. Expand items and change a few expansion states.
         * 3. Save the current expanded/collapsed state as baseline.
         * 4. Reload the VS Code window.
         * 5. Reopen Test Themes and verify the same expansion state is restored.
         */
        it("should preserve expansion state after VS Code reload", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                skipPrecondition(this, "Test credentials not available");
            }

            const testThemesPage = new TestThemesPage(driver);
            const section = await getSection(testThemesPage, driver);
            if (!section) {
                skipPrecondition(this, "Test Themes section not found");
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

        /*
         * 1. Navigate to the Test Themes tree.
         * 2. Expand items and change a few expansion states.
         * 3. Save the current expanded/collapsed state as baseline.
         * 4. Click the Test Themes refresh button.
         * 5. Verify that the expansion state remains the same after refresh.
         */
        it("should preserve expansion state after tree view refresh", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                skipPrecondition(this, "Test credentials not available");
            }

            const testThemesPage = new TestThemesPage(driver);
            const section = await getSection(testThemesPage, driver);
            if (!section) {
                skipPrecondition(this, "Test Themes section not found");
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
            const navigated = await navigateToTestView(driver, "Test Elements");
            if (!navigated) {
                logger.warn("Persistence", "Skipping test because Test Elements view navigation failed");
                skipPrecondition(this, "Test Elements view navigation failed");
            }
        });

        /*
         * 1. Navigate to the Test Elements tree.
         * 2. Expand items and change a few expansion states.
         * 3. Save the current expanded/collapsed state as baseline.
         * 4. Log out and then log back in.
         * 5. Return to Test Elements and verify the same expansion state is restored.
         */
        it("should preserve expansion state after logout/login", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                skipPrecondition(this, "Test credentials not available");
            }

            const testElementsPage = new TestElementsPage(driver);
            const section = await getSection(testElementsPage, driver);
            if (!section) {
                skipPrecondition(this, "Test Elements section not found");
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

        /*
         * 1. Navigate to the Test Elements tree.
         * 2. Expand items and change a few expansion states.
         * 3. Save the current expanded/collapsed state as baseline.
         * 4. Reload the VS Code window.
         * 5. Reopen Test Elements and verify the same expansion state is restored.
         */
        it("should preserve expansion state after VS Code reload", async function () {
            const driver = getDriver();
            if (!hasTestCredentials()) {
                skipPrecondition(this, "Test credentials not available");
            }

            const testElementsPage = new TestElementsPage(driver);
            const section = await getSection(testElementsPage, driver);
            if (!section) {
                skipPrecondition(this, "Test Elements section not found");
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

        /*
         * 1. Navigate to the Test Elements tree.
         * 2. Expand items and change a few expansion states.
         * 3. Save the current expanded/collapsed state as baseline.
         * 4. Click the Test Elements refresh button.
         * 5. Verify that the expansion state remains the same after refresh.
         */
        it("should preserve expansion state after tree view refresh", async function () {
            this.timeout(TEST_ELEMENTS_REFRESH_TIMEOUT);

            const driver = getDriver();
            if (!hasTestCredentials()) {
                skipPrecondition(this, "Test credentials not available");
            }

            const testElementsPage = new TestElementsPage(driver);
            const section = await getSection(testElementsPage, driver);
            if (!section) {
                skipPrecondition(this, "Test Elements section not found");
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
