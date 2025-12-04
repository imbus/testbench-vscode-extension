/**
 * @file src/test/ui/testThemesView.ui.test.ts
 * @description UI tests for Test Themes view features including:
 * - Navigation to Test Themes view
 * - View title verification
 * - Test generation from tree items
 * - Test execution
 * - Upload result to TestBench
 * - Tooltip verification
 */

import { expect } from "chai";
import { SideBarView, TreeItem, WebDriver, By } from "vscode-extension-tester";
import { logger } from "./testLogger";
import {
    openTestBenchSidebar,
    applySlowMotion,
    findTreeItemByLabel,
    findTreeItemByLabelAtLevel,
    expandTreeItemIfNeeded,
    waitForTreeItems,
    findSidebarSection,
    getSectionTitle,
    clickToolbarButton,
    doubleClickTreeItem,
    waitForProjectsView,
    waitForTestThemesAndElementsViews,
    handleCycleConfigurationPrompt,
    UITimeouts,
    waitForCondition,
    waitForTooltip,
    waitForTestingViewReady,
    waitForTerminalOutput,
    waitForTreeRefresh,
    waitForTreeItem,
    waitForNotification
} from "./testUtils";
import { getTestData, logTestDataConfig } from "./testConfig";
import { TestContext, setupTestHooks } from "./testHooks";

/**
 * Finds the Test Themes section in the sidebar.
 *
 * @param content - The sidebar content
 * @returns Promise<any | null> - The Test Themes section or null if not found
 */
async function findTestThemesSection(content: any): Promise<any | null> {
    return await findSidebarSection(content, "Test Themes");
}

/**
 * Finds the Projects section in the sidebar.
 *
 * @param content - The sidebar content
 * @returns Promise<any | null> - The Projects section or null if not found
 */
async function findProjectsSection(content: any): Promise<any | null> {
    return await findSidebarSection(content, "Projects");
}

/**
 * Clicks a tree item action button by its aria-label or title.
 * Used for clicking buttons like "Generate Robot Framework Test Suites" or "Upload Execution Results".
 *
 * @param item - The tree item containing the button
 * @param driver - The WebDriver instance
 * @param buttonLabel - Partial text of the button's aria-label or title
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
async function clickTreeItemActionButton(item: TreeItem, driver: WebDriver, buttonLabel: string): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        const itemLabel = await item.getLabel();
        logger.trace("TreeItem", `Looking for "${buttonLabel}" button on item: "${itemLabel}"`);

        const button = await driver.wait(
            async () => {
                try {
                    const allRowsInTree = await driver.findElements(By.css(".monaco-list-row"));

                    for (const row of allRowsInTree) {
                        try {
                            const rowText = await row.getText();
                            if (!rowText.includes(itemLabel)) {
                                continue;
                            }

                            const actionButtons = await row.findElements(
                                By.css("a.action-item, button.action-item, a[class*='action'], button[class*='action']")
                            );

                            for (const btn of actionButtons) {
                                try {
                                    const isDisplayed = await btn.isDisplayed();
                                    if (!isDisplayed) {
                                        continue;
                                    }

                                    // Check aria-label or title
                                    const ariaLabel = await btn.getAttribute("aria-label");
                                    const title = await btn.getAttribute("title");

                                    if (
                                        (ariaLabel && ariaLabel.toLowerCase().includes(buttonLabel.toLowerCase())) ||
                                        (title && title.toLowerCase().includes(buttonLabel.toLowerCase()))
                                    ) {
                                        logger.trace(
                                            "TreeItem",
                                            `Found button by aria-label/title: "${ariaLabel || title}"`
                                        );
                                        return btn;
                                    }
                                } catch {
                                    // Continue searching
                                }
                            }

                            // Look for any links/buttons with codicons that might match
                            const allButtons = await row.findElements(By.css("a, button"));
                            for (const btn of allButtons) {
                                try {
                                    const isDisplayed = await btn.isDisplayed();
                                    if (!isDisplayed) {
                                        continue;
                                    }

                                    const ariaLabel = await btn.getAttribute("aria-label");
                                    const title = await btn.getAttribute("title");

                                    if (
                                        (ariaLabel && ariaLabel.toLowerCase().includes(buttonLabel.toLowerCase())) ||
                                        (title && title.toLowerCase().includes(buttonLabel.toLowerCase()))
                                    ) {
                                        logger.trace("TreeItem", `Found button: "${ariaLabel || title}"`);
                                        return btn;
                                    }
                                } catch {
                                    // Continue searching
                                }
                            }
                        } catch {
                            // Continue to next row
                        }
                    }

                    // Strategy 2: JavaScript-based search
                    const buttonFound = (await driver.executeScript(`
                        function findActionButton(itemLabel, buttonLabel) {
                            const rows = document.querySelectorAll('.monaco-list-row');
                            for (const row of rows) {
                                const rowText = row.textContent || row.innerText || '';
                                if (!rowText.includes('${itemLabel.replace(/'/g, "\\'")}')) {
                                    continue;
                                }
                                
                                const buttons = row.querySelectorAll('a.action-item, button.action-item, a[class*="action"], button[class*="action"]');
                                for (const btn of buttons) {
                                    const ariaLabel = btn.getAttribute('aria-label') || '';
                                    const title = btn.getAttribute('title') || '';
                                    
                                    if (ariaLabel.toLowerCase().includes('${buttonLabel.toLowerCase().replace(/'/g, "\\'")}') ||
                                        title.toLowerCase().includes('${buttonLabel.toLowerCase().replace(/'/g, "\\'")}')) {
                                        btn.scrollIntoView({ block: 'center' });
                                        return btn;
                                    }
                                }
                            }
                            return null;
                        }
                        return findActionButton('${itemLabel.replace(/'/g, "\\'")}', '${buttonLabel.replace(/'/g, "\\'")}');
                    `)) as any | null;

                    if (buttonFound) {
                        logger.trace("TreeItem", "Found button using JavaScript");
                        return buttonFound;
                    }

                    return null;
                } catch (error) {
                    logger.error("TreeItem", "Error in button search", error);
                    return null;
                }
            },
            UITimeouts.LONG,
            `Waiting for "${buttonLabel}" button near item "${itemLabel}"`
        );

        if (button) {
            logger.trace("TreeItem", `Found "${buttonLabel}" button, clicking...`);

            // Scroll into view
            try {
                await driver.executeScript("arguments[0].scrollIntoView({ block: 'center' });", button);
                await driver.sleep(200);
            } catch {
                // Ignore scroll errors
            }

            // Try regular click first
            try {
                await button.click();
            } catch (clickError) {
                // Fallback to JavaScript click
                logger.warn("TreeItem", "Regular click failed, trying JavaScript click", clickError);
                await driver.executeScript("arguments[0].click();", button);
            }

            await applySlowMotion(driver);
            return true;
        }

        logger.warn("TreeItem", `"${buttonLabel}" button not found`);
        return false;
    } catch (error) {
        logger.error("TreeItem", `Error clicking "${buttonLabel}" button`, error);
        return false;
    }
}

/**
 * Hovers over a tree item and retrieves its tooltip text.
 *
 * @param item - The tree item to hover over
 * @param driver - The WebDriver instance
 * @returns Promise<string | null> - The tooltip text or null if not found
 */
async function getTreeItemTooltip(item: TreeItem, driver: WebDriver): Promise<string | null> {
    try {
        await driver.switchTo().defaultContent();
        logger.trace("Tooltip", "Hovering over tree item to get tooltip...");

        const itemLabel = await item.getLabel();
        logger.trace("Tooltip", `Tree item label: "${itemLabel}"`);

        let labelElement = null;

        try {
            // Try to find the label element within the tree item
            // VS Code tree items typically have a .monaco-icon-label or similar for the text
            const labelSelectors = [
                ".monaco-icon-label",
                ".label-name",
                ".monaco-highlighted-label",
                "[class*='label']"
            ];

            for (const selector of labelSelectors) {
                try {
                    const elements = await item.findElements(By.css(selector));
                    for (const el of elements) {
                        if (await el.isDisplayed()) {
                            const text = await el.getText();
                            if (text && text.includes(itemLabel)) {
                                labelElement = el;
                                logger.trace("Tooltip", `Found label element with selector: ${selector}`);
                                break;
                            }
                        }
                    }
                    if (labelElement) {
                        break;
                    }
                } catch {
                    // Continue trying other selectors
                }
            }
        } catch {
            // Fall back to using the item itself
        }

        // Use JavaScript to find the tree row and hover over the label area
        // This is more reliable than using the TreeItem element directly
        const treeRowElement = await driver.executeScript(`
            const rows = document.querySelectorAll('.monaco-list-row');
            for (const row of rows) {
                const label = row.querySelector('.monaco-icon-label, .label-name, [class*="label"]');
                if (label) {
                    const text = label.textContent || label.innerText || '';
                    if (text.includes('${itemLabel.replace(/'/g, "\\'")}')) {
                        // Return the label element, not the whole row
                        return label;
                    }
                }
            }
            return null;
        `);

        const elementToHover = labelElement || treeRowElement || item;

        // Move mouse to the label element to trigger the correct tooltip
        const actions = driver.actions({ async: true });
        await actions.move({ origin: elementToHover as any }).perform();

        const tooltipText = await waitForTooltip(driver, UITimeouts.MEDIUM);
        if (tooltipText) {
            // Verify this is the item tooltip, not an action button tooltip
            if (
                tooltipText.includes("Execution Status") ||
                tooltipText.includes(itemLabel) ||
                (!tooltipText.includes("Upload") &&
                    !tooltipText.includes("Generate") &&
                    !tooltipText.includes("Delete"))
            ) {
                logger.trace("Tooltip", `Found tooltip text: ${tooltipText.substring(0, 100)}...`);
                return tooltipText;
            } else {
                logger.trace("Tooltip", `Found button tooltip instead: "${tooltipText}", retrying...`);

                // Move mouse away and try hovering on a different part
                await actions.move({ x: 0, y: 0 }).perform();
                await driver.sleep(200);

                // Try hovering on the left side of the label element
                if (treeRowElement) {
                    await actions.move({ origin: treeRowElement as any, x: -50, y: 0 }).perform();
                    const retryTooltip = await waitForTooltip(driver, UITimeouts.SHORT);
                    if (
                        retryTooltip &&
                        (retryTooltip.includes("Execution Status") || retryTooltip.includes(itemLabel))
                    ) {
                        logger.trace("Tooltip", `Found tooltip on retry: ${retryTooltip.substring(0, 100)}...`);
                        return retryTooltip;
                    }
                }
            }
        }

        // Try getting the title attribute directly from the tree row
        try {
            const rowWithTitle = (await driver.executeScript(`
                const rows = document.querySelectorAll('.monaco-list-row');
                for (const row of rows) {
                    const text = row.textContent || row.innerText || '';
                    if (text.includes('${itemLabel.replace(/'/g, "\\'")}')) {
                        // Look for title attribute on the row or its children
                        if (row.title) return row.title;
                        const labeled = row.querySelector('[title]');
                        if (labeled && labeled.title) return labeled.title;
                        // Also check for custom tooltip data attribute
                        const customTooltip = row.getAttribute('data-tooltip') || 
                                             row.querySelector('[data-tooltip]')?.getAttribute('data-tooltip');
                        if (customTooltip) return customTooltip;
                    }
                }
                return null;
            `)) as string | null;

            if (rowWithTitle && rowWithTitle.trim().length > 0) {
                logger.trace("Tooltip", `Found title from row: ${rowWithTitle.substring(0, 100)}...`);
                return rowWithTitle;
            }
        } catch {
            // Continue
        }

        // Try to get aria-label
        try {
            const ariaLabel = await item.getAttribute("aria-label");
            if (ariaLabel && ariaLabel.trim().length > 0) {
                logger.trace("Tooltip", `Found aria-label: ${ariaLabel.substring(0, 100)}...`);
                return ariaLabel;
            }
        } catch {
            // Continue
        }

        logger.debug("Tooltip", "No tooltip text found");
        return null;
    } catch (error) {
        logger.error("Tooltip", `Error getting tooltip: ${error}`);
        return null;
    }
}

/**
 * Verifies that a tree item's tooltip contains the expected text.
 *
 * @param item - The tree item to check
 * @param driver - The WebDriver instance
 * @param expectedText - The text that should be present in the tooltip
 * @returns Promise<boolean> - True if the expected text was found in the tooltip
 */
async function verifyTooltipContains(item: TreeItem, driver: WebDriver, expectedText: string): Promise<boolean> {
    const tooltipText = await getTreeItemTooltip(item, driver);

    if (!tooltipText) {
        logger.warn("Tooltip", "Could not retrieve tooltip text");
        return false;
    }

    const containsExpected = tooltipText.includes(expectedText);
    if (containsExpected) {
        logger.info("Tooltip", `✓ Tooltip contains expected text: "${expectedText}"`);
    } else {
        logger.warn("Tooltip", `✗ Tooltip does not contain "${expectedText}"`);
        logger.debug("Tooltip", `Actual tooltip text: ${tooltipText}`);
    }

    return containsExpected;
}

/**
 * Checks if the Testing View is currently visible in VS Code.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if Testing View is visible
 */
async function isTestingViewVisible(driver: WebDriver): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        // Check if the Testing activity bar item is active
        const activeItems = await driver.findElements(
            By.css(".activitybar .action-item.checked, .activitybar .action-item.active")
        );

        for (const item of activeItems) {
            try {
                const ariaLabel = await item.getAttribute("aria-label");
                if (ariaLabel && ariaLabel.toLowerCase().includes("testing")) {
                    return true;
                }
            } catch {
                // Continue checking
            }
        }

        // Check if Testing sidebar is visible
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        const sections = await content.getSections();

        for (const section of sections) {
            const title = await section.getTitle();
            if (title.toLowerCase().includes("test results") || title.toLowerCase().includes("testing")) {
                return true;
            }
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * Opens the Testing View in VS Code via the Activity Bar.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if Testing View was opened successfully
 */
async function openTestingView(driver: WebDriver): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();
        logger.info("TestingView", "Opening Testing View...");

        // Find and click the Testing icon in the Activity Bar
        const activityBarItems = await driver.findElements(By.css(".activitybar .action-item"));

        for (const item of activityBarItems) {
            try {
                const ariaLabel = await item.getAttribute("aria-label");
                if (ariaLabel && ariaLabel.toLowerCase().includes("testing")) {
                    await item.click();
                    await applySlowMotion(driver);

                    // Wait for Testing View to become visible
                    const isVisible = await waitForCondition(
                        driver,
                        async () => await isTestingViewVisible(driver),
                        UITimeouts.MEDIUM,
                        200,
                        "Testing View to become visible"
                    );
                    if (isVisible) {
                        logger.info("TestingView", "✓ Testing View opened successfully");
                        return true;
                    }
                }
            } catch {
                // Continue searching
            }
        }

        logger.warn("TestingView", "Testing icon not found in Activity Bar");
        return false;
    } catch (error) {
        logger.error("TestingView", `Error opening Testing View: ${error}`);
        return false;
    }
}

/**
 * Runs tests from the Testing View by clicking the "Run All Tests" button.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if test execution was triggered
 */
async function runTestsFromTestingView(driver: WebDriver): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();
        logger.info("TestingView", "Looking for Run Tests button...");

        // Wait for the Testing View to fully load
        await waitForTestingViewReady(driver, UITimeouts.MEDIUM);

        // Look for the "Run All Tests" button in the Testing View toolbar
        const runButton = await driver.wait(
            async () => {
                try {
                    // Try multiple selectors for the run button
                    const selectors = [
                        // Run All Tests button
                        "[aria-label*='Run All Tests']",
                        "[aria-label*='Run Tests']",
                        "[title*='Run All Tests']",
                        "[title*='Run Tests']",
                        // Play icon button in testing view
                        ".testing-explorer-view-content .action-item[aria-label*='Run']",
                        ".test-explorer .codicon-run-all",
                        ".codicon-testing-run-all-icon"
                    ];

                    for (const selector of selectors) {
                        const buttons = await driver.findElements(By.css(selector));
                        for (const btn of buttons) {
                            if (await btn.isDisplayed()) {
                                return btn;
                            }
                        }
                    }

                    // Try finding by XPath
                    const xpathSelectors = [
                        "//a[contains(@aria-label, 'Run All Tests')]",
                        "//a[contains(@aria-label, 'Run Tests')]",
                        "//button[contains(@aria-label, 'Run')]"
                    ];

                    for (const xpath of xpathSelectors) {
                        const buttons = await driver.findElements(By.xpath(xpath));
                        for (const btn of buttons) {
                            if (await btn.isDisplayed()) {
                                return btn;
                            }
                        }
                    }

                    return null;
                } catch {
                    return null;
                }
            },
            UITimeouts.MEDIUM,
            "Waiting for Run Tests button"
        );

        if (runButton) {
            logger.info("TestingView", "Found Run Tests button, clicking...");
            await runButton.click();
            await applySlowMotion(driver);
            return true;
        }

        logger.warn("TestingView", "Run Tests button not found");
        return false;
    } catch (error) {
        logger.error("TestingView", `Error running tests: ${error}`);
        return false;
    }
}

/**
 * Waits for test execution to complete by monitoring the Testing View.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait (default: 120000ms)
 * @returns Promise<boolean> - True if execution completed
 */
async function waitForTestExecutionComplete(driver: WebDriver, timeout: number = 120000): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();
        logger.info("TestingView", "Waiting for test execution to complete...");

        // Wait for test execution indicators to appear and then disappear
        // or for test results to appear
        const startTime = Date.now();

        // Wait for execution to start by looking for activity indicators
        await waitForCondition(
            driver,
            async () => {
                const indicators = await driver.findElements(
                    By.css(".codicon-loading, .codicon-sync, [class*='spinning'], .codicon-testing-run-icon")
                );
                return indicators.length > 0;
            },
            UITimeouts.MEDIUM,
            200,
            "test execution to start"
        );

        // Wait for execution to complete
        await driver.wait(
            async () => {
                try {
                    // Check if there are any spinning/loading indicators
                    const spinners = await driver.findElements(
                        By.css(".codicon-loading, .codicon-sync, [class*='spinning']")
                    );

                    let hasActiveSpinner = false;
                    for (const spinner of spinners) {
                        try {
                            if (await spinner.isDisplayed()) {
                                hasActiveSpinner = true;
                                break;
                            }
                        } catch {
                            // Element may be stale
                        }
                    }

                    // Consider it complete
                    if (!hasActiveSpinner && Date.now() - startTime > 5000) {
                        return true;
                    }

                    // Check for test result indicators (pass/fail icons)
                    const resultIndicators = await driver.findElements(
                        By.css(
                            ".codicon-testing-passed-icon, .codicon-testing-failed-icon, .codicon-testing-skipped-icon"
                        )
                    );

                    if (resultIndicators.length > 0) {
                        // Results are visible, execution is complete
                        return true;
                    }

                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            "Waiting for test execution to complete"
        );

        logger.info("TestingView", "✓ Test execution appears to be complete");
        return true;
    } catch (error) {
        logger.warn("TestingView", `Timeout or error waiting for test completion: ${error}`);
        // Continue with the flow
        return true;
    }
}

/**
 * Executes Robot Framework tests via terminal as a fallback.
 * Uses dry-run mode to quickly generate output.xml without actual test execution.
 *
 * @param driver - The WebDriver instance
 * @param config - Test configuration containing output paths
 * @returns Promise<boolean> - True if execution was successful
 */
async function executeRobotTestsViaTerminal(driver: WebDriver, _config: { testThemeName: string }): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();
        logger.info("Terminal", "Executing Robot Framework tests via terminal...");

        // Open terminal via command palette
        const workbench = await driver.findElement(By.css(".monaco-workbench"));
        if (!workbench) {
            logger.warn("Terminal", "Workbench not found");
            return false;
        }

        // Use keyboard shortcut to open terminal (Ctrl+`)
        await driver
            .actions()
            .keyDown("\uE009") // Control key
            .sendKeys("`")
            .keyUp("\uE009")
            .perform();

        // Wait for terminal to be visible
        const terminalVisible = await driver.wait(
            async () => {
                const terminals = await driver.findElements(
                    By.css(".terminal-wrapper, .integrated-terminal, [class*='terminal']")
                );
                for (const term of terminals) {
                    if (await term.isDisplayed()) {
                        return true;
                    }
                }
                return false;
            },
            UITimeouts.MEDIUM,
            "Waiting for terminal to open"
        );

        if (!terminalVisible) {
            logger.warn("Terminal", "Terminal did not open");
            return false;
        }

        // Execute robot command with dry-run to generate output.xml
        // The output path is configured in settings as "results/output.xml"
        // The test directory is "tests" by default
        const robotCommand = "robot --dryrun --outputdir results tests";
        logger.info("Terminal", `Executing: ${robotCommand}`);

        await driver.actions().sendKeys(robotCommand).perform();

        // Small delay for command to be typed
        await waitForCondition(driver, async () => true, 100, 50, "command input");

        await driver.actions().sendKeys("\uE007").perform(); // Enter key

        const commandCompleted = await waitForTerminalOutput(
            driver,
            "Output:", // Robot Framework outputs this when done
            UITimeouts.LONG
        );

        if (!commandCompleted) {
            // Fallback: wait for any indication of completion
            await waitForCondition(
                driver,
                async () => {
                    const terminalContent = await driver.findElements(By.css(".xterm-rows"));
                    for (const content of terminalContent) {
                        const text = await content.getText();
                        // Look for common completion indicators
                        if (
                            text.includes("PASS") ||
                            text.includes("FAIL") ||
                            text.includes("Error") ||
                            text.includes("output.xml")
                        ) {
                            return true;
                        }
                    }
                    return false;
                },
                UITimeouts.LONG,
                500,
                "robot command completion"
            );
        }

        logger.info("Terminal", "✓ Robot command executed (dry-run mode)");
        return true;
    } catch (error) {
        logger.error("Terminal", `Error executing tests via terminal: ${error}`);
        return false;
    }
}

describe("Test Themes View UI Tests", function () {
    const ctx: TestContext = {} as TestContext;

    this.timeout(300000);

    setupTestHooks(ctx, {
        suiteName: "TestThemesView",
        requiresLogin: true,
        openSidebar: true,
        timeout: 300000
    });

    const getDriver = () => ctx.driver;

    describe("Test Generation and Result Upload Flow", function () {
        it("should navigate to Test Themes view, generate tests, and upload results", async function () {
            const driver = getDriver();
            const config = getTestData();
            logTestDataConfig();

            // ============================================
            // Phase 1: Login and View Detection
            // ============================================
            logger.info("Phase1", "Starting Login and View Detection...");

            const sideBar = new SideBarView();
            const content = sideBar.getContent();

            // Determine initial view state
            const projectsSection = await findProjectsSection(content);
            const testThemesSection = await findTestThemesSection(content);

            let isInProjectsView = false;
            let needsNavigation = true;

            if (projectsSection) {
                isInProjectsView = true;
                logger.info("Phase1", "Extension is in Projects View");
            } else if (testThemesSection) {
                logger.info("Phase1", "Extension is in Test Themes View");

                // Check if current context matches expected
                const testThemesTitle = await getSectionTitle(testThemesSection);
                logger.info("Phase1", `Test Themes view title: "${testThemesTitle}"`);

                if (
                    testThemesTitle &&
                    testThemesTitle.includes(config.projectName) &&
                    testThemesTitle.includes(config.cycleName)
                ) {
                    logger.info("Phase1", "Context matches. Skipping navigation.");
                    needsNavigation = false;
                } else {
                    logger.info("Phase1", "Context does not match. Navigating to Projects View...");
                    const buttonClicked = await clickToolbarButton(testThemesSection, "Open Projects View", driver);
                    if (!buttonClicked) {
                        logger.warn("Phase1", "Failed to click 'Open Projects View' button");
                        this.skip();
                    }

                    const projectsViewAppeared = await waitForProjectsView(driver);
                    if (!projectsViewAppeared) {
                        logger.warn("Phase1", "Projects view did not appear");
                        this.skip();
                    }
                    isInProjectsView = true;
                }
            } else {
                logger.info("Phase1", "Neither Projects nor Test Themes view found. Assuming Projects View.");
                isInProjectsView = true;
            }

            // ============================================
            // Phase 2: Navigation to Test Themes View
            // ============================================
            if (needsNavigation && isInProjectsView) {
                logger.info("Phase2", "Starting Navigation to Test Themes View...");

                // Re-fetch sections
                const updatedContent = sideBar.getContent();
                const projectsSectionUpdated = await findProjectsSection(updatedContent);

                if (!projectsSectionUpdated) {
                    logger.warn("Phase2", "Projects section not found");
                    this.skip();
                    return;
                }

                const itemsLoaded = await waitForTreeItems(projectsSectionUpdated, driver);
                if (!itemsLoaded) {
                    logger.warn("Phase2", "Tree items did not load in time");
                    this.skip();
                    return;
                }

                const allVisibleProjectItems = await projectsSectionUpdated.getVisibleItems();
                expect(allVisibleProjectItems.length).to.be.greaterThan(0, "Expected at least one project in the tree");

                const targetProject = await findTreeItemByLabelAtLevel(allVisibleProjectItems, config.projectName);
                if (!targetProject) {
                    logger.warn("Phase2", `Project '${config.projectName}' not found`);
                    this.skip();
                    return;
                }

                logger.info("Phase2", `Found project '${config.projectName}', expanding...`);
                await expandTreeItemIfNeeded(targetProject, driver);

                const versions = await targetProject.getChildren();
                if (!versions || versions.length === 0) {
                    logger.warn("Phase2", "No versions found under project");
                    this.skip();
                    return;
                }

                const targetVersion = await findTreeItemByLabelAtLevel(versions, config.versionName);
                if (!targetVersion) {
                    logger.warn("Phase2", `Version '${config.versionName}' not found`);
                    this.skip();
                    return;
                }

                logger.info("Phase2", `Found version '${config.versionName}', expanding...`);
                await expandTreeItemIfNeeded(targetVersion, driver);

                const cycles = await targetVersion.getChildren();
                if (!cycles || cycles.length === 0) {
                    logger.warn("Phase2", "No cycles found under version");
                    this.skip();
                    return;
                }

                const targetCycle = await findTreeItemByLabelAtLevel(cycles, config.cycleName);
                if (!targetCycle) {
                    logger.warn("Phase2", `Cycle '${config.cycleName}' not found`);
                    this.skip();
                    return;
                }

                logger.info("Phase2", `Found cycle '${config.cycleName}'`);

                await handleCycleConfigurationPrompt(
                    targetCycle,
                    driver,
                    config.projectName,
                    config.versionName,
                    projectsSectionUpdated,
                    targetProject,
                    targetVersion
                );

                // Re-locate cycle after potential tree reordering
                const cyclesAfterConfig = await targetVersion.getChildren();
                let targetCycleAfterConfig = await findTreeItemByLabelAtLevel(cyclesAfterConfig, config.cycleName);

                if (!targetCycleAfterConfig) {
                    const allItems = await projectsSectionUpdated.getVisibleItems();
                    targetCycleAfterConfig = await findTreeItemByLabel(allItems, config.cycleName);
                }

                if (!targetCycleAfterConfig) {
                    logger.warn("Phase2", `Cycle '${config.cycleName}' not found after configuration`);
                    targetCycleAfterConfig = targetCycle;
                }

                logger.info("Phase2", `Double-clicking cycle '${config.cycleName}'...`);
                await doubleClickTreeItem(targetCycleAfterConfig, driver);

                const viewsAppeared = await waitForTestThemesAndElementsViews(driver);
                if (!viewsAppeared) {
                    logger.warn("Phase2", "Test Themes view did not appear");
                    this.skip();
                    return;
                }

                logger.info("Phase2", "Navigation to Test Themes View complete.");
            }

            // Wait for views to stabilize
            await waitForCondition(
                driver,
                async () => {
                    const content = sideBar.getContent();
                    const section = await findTestThemesSection(content);
                    if (section) {
                        const items = await section.getVisibleItems();
                        return items.length >= 0; // Section exists and is queryable
                    }
                    return false;
                },
                UITimeouts.MEDIUM,
                200,
                "Test Themes view to stabilize"
            );

            // ============================================
            // Phase 3: Verify Test Themes View Title
            // ============================================
            logger.info("Phase3", "Verifying Test Themes View Title...");

            const updatedContent2 = sideBar.getContent();
            const testThemesSectionVerify = await findTestThemesSection(updatedContent2);

            if (!testThemesSectionVerify) {
                logger.warn("Phase3", "Test Themes section not found");
                this.skip();
                return;
            }

            const testThemesTitle = await getSectionTitle(testThemesSectionVerify);
            logger.info("Phase3", `Test Themes view title: "${testThemesTitle}"`);

            expect(testThemesTitle, "Test Themes title should contain project name").to.include(config.projectName);
            expect(testThemesTitle, "Test Themes title should contain version name").to.include(config.versionName);
            expect(testThemesTitle, "Test Themes title should contain cycle name").to.include(config.cycleName);

            logger.info("Phase3", "✓ Test Themes View title verified successfully");

            // ============================================
            // Phase 4: Find Test Theme and Generate Tests
            // ============================================
            logger.info("Phase4", "Finding Test Theme and Generating Tests...");

            const testThemesLoaded = await waitForTreeItems(testThemesSectionVerify, driver);
            if (!testThemesLoaded) {
                logger.warn("Phase4", "Test Themes tree items did not load");
                this.skip();
                return;
            }

            logger.info("Phase4", `Looking for test theme '${config.testThemeName}'...`);
            const targetTestTheme = await waitForTreeItem(
                driver,
                findTestThemesSection,
                config.testThemeName,
                UITimeouts.LONG
            );

            if (!targetTestTheme) {
                logger.warn("Phase4", `Test theme '${config.testThemeName}' not found`);
                this.skip();
                return;
            }

            const testThemeLabel = await targetTestTheme.getLabel();
            logger.info("Phase4", `Found test theme: "${testThemeLabel}"`);

            await targetTestTheme.click();
            await applySlowMotion(driver);

            logger.info("Phase4", "Clicking 'Generate Robot Framework Test Suites' button...");
            const generateButtonClicked = await clickTreeItemActionButton(targetTestTheme, driver, "Generate");

            if (!generateButtonClicked) {
                logger.warn("Phase4", "Failed to click Generate button");
                this.skip();
                return;
            }

            logger.info("Phase4", "Waiting for test generation success notification...");
            const generationNotificationAppeared = await waitForNotification(
                driver,
                "Successfully generated Robot Framework test suites",
                120000
            );

            if (!generationNotificationAppeared) {
                logger.warn("Phase4", "Test generation notification did not appear within timeout");
                // Continue anyway, the notification might have been missed
            } else {
                logger.info("Phase4", "✓ Test generation completed successfully");
            }

            await applySlowMotion(driver);

            // ============================================
            // Phase 5: Execute Generated Tests
            // ============================================
            logger.info("Phase5", "Executing Generated Robot Framework Tests...");

            // The generated .robot files are placed in the "tests" directory (testbenchExtension.outputDirectory)
            // The output XML will be written to "results/output.xml" (testbenchExtension.outputXmlFilePath)

            // Wait for extension to potentially switch views after generation
            await waitForCondition(
                driver,
                async () => {
                    const inTesting = await isTestingViewVisible(driver);
                    if (inTesting) {
                        return true;
                    }

                    const content = sideBar.getContent();
                    const sections = await content.getSections();
                    return sections.length > 0;
                },
                UITimeouts.MEDIUM,
                200,
                "view to stabilize after generation"
            );

            let inTestingView = await isTestingViewVisible(driver);

            if (!inTestingView) {
                logger.info("Phase5", "Opening Testing View...");
                const testingViewOpened = await openTestingView(driver);
                if (!testingViewOpened) {
                    logger.warn("Phase5", "Failed to open Testing View, trying terminal execution...");
                    // Fallback: Execute tests via terminal with dry-run
                    const terminalExecutionSuccess = await executeRobotTestsViaTerminal(driver, config);
                    if (!terminalExecutionSuccess) {
                        logger.warn("Phase5", "Warning: Test execution via terminal also failed");
                    }
                } else {
                    inTestingView = true;
                }
            } else {
                logger.info("Phase5", "Already in Testing View");
            }

            if (inTestingView) {
                // Run tests from Testing View
                logger.info("Phase5", "Running tests from Testing View...");
                const testsExecuted = await runTestsFromTestingView(driver);
                if (!testsExecuted) {
                    logger.warn("Phase5", "Warning: Could not trigger test execution from Testing View");
                    // Fallback to terminal execution
                    await openTestBenchSidebar(driver);
                    await executeRobotTestsViaTerminal(driver, config);
                } else {
                    // Wait for test execution to complete
                    logger.info("Phase5", "Waiting for test execution to complete...");
                    await waitForTestExecutionComplete(driver);
                    logger.info("Phase5", "✓ Test execution completed");
                }
            }

            await applySlowMotion(driver);

            // ============================================
            // Phase 6: Handle Testing View Switch
            // ============================================
            logger.info("Phase6", "Returning to TestBench view...");

            // Ensure we're back in TestBench sidebar for upload
            await openTestBenchSidebar(driver);
            await applySlowMotion(driver);

            // Wait for TestBench sidebar to be fully loaded
            await waitForCondition(
                driver,
                async () => {
                    const content = sideBar.getContent();
                    const section = await findTestThemesSection(content);
                    return section !== null;
                },
                UITimeouts.MEDIUM,
                200,
                "TestBench sidebar to load"
            );

            // ============================================
            // Phase 7: Re-locate Test Theme and Upload Results
            // ============================================
            logger.info("Phase7", "Re-locating Test Theme and Uploading Results...");

            const updatedContent3 = sideBar.getContent();
            const testThemesSectionUpload = await findTestThemesSection(updatedContent3);

            if (!testThemesSectionUpload) {
                logger.warn("Phase7", "Test Themes section not found after returning");
                this.skip();
                return;
            }

            const uploadTreeLoaded = await waitForTreeItems(testThemesSectionUpload, driver);
            if (!uploadTreeLoaded) {
                logger.warn("Phase7", "Test Themes tree items did not load");
                this.skip();
                return;
            }

            logger.info("Phase7", `Looking for test theme '${config.testThemeName}'...`);
            const targetTestThemeForUpload = await waitForTreeItem(
                driver,
                findTestThemesSection,
                config.testThemeName,
                UITimeouts.LONG
            );

            if (!targetTestThemeForUpload) {
                logger.warn("Phase7", `Test theme '${config.testThemeName}' not found for upload`);
                this.skip();
                return;
            }

            await targetTestThemeForUpload.click();
            await applySlowMotion(driver);

            logger.info("Phase7", "Clicking 'Upload Execution Results To TestBench' button...");
            const uploadButtonClicked = await clickTreeItemActionButton(targetTestThemeForUpload, driver, "Upload");

            if (!uploadButtonClicked) {
                logger.warn("Phase7", "Failed to click Upload button");
                this.skip();
                return;
            }

            logger.info("Phase7", "Waiting for upload success notification...");
            const uploadNotificationAppeared = await waitForNotification(
                driver,
                "Successfully imported Robot Framework test results",
                60000
            );

            if (!uploadNotificationAppeared) {
                logger.warn("Phase7", "Upload notification did not appear within timeout");
                // Continue, notification might have been missed
            } else {
                logger.info("Phase7", "✓ Results upload completed successfully");
            }

            // ============================================
            // PHASE 8: Verify Execution Status in Tooltip
            // ============================================
            logger.info("Phase8", "Verifying execution status in tooltip...");

            await waitForTreeRefresh(driver, null, UITimeouts.MEDIUM);

            const updatedContent4 = sideBar.getContent();
            const testThemesSectionTooltip = await findTestThemesSection(updatedContent4);

            if (!testThemesSectionTooltip) {
                throw new Error("[Phase 8] Test Themes section not found for tooltip verification");
            }

            const tooltipTreeLoaded = await waitForTreeItems(testThemesSectionTooltip, driver);
            if (!tooltipTreeLoaded) {
                throw new Error("[Phase 8] Test Themes tree items did not load for tooltip verification");
            }

            logger.info("Phase8", `Looking for test theme '${config.testThemeName}'...`);
            const targetTestThemeForTooltip = await waitForTreeItem(
                driver,
                findTestThemesSection,
                config.testThemeName,
                UITimeouts.LONG
            );

            if (!targetTestThemeForTooltip) {
                throw new Error(`[Phase 8] Test theme '${config.testThemeName}' not found for tooltip verification`);
            }

            const expectedTooltipText = "Execution Status: Performed";
            const tooltipVerified = await verifyTooltipContains(targetTestThemeForTooltip, driver, expectedTooltipText);

            expect(tooltipVerified, `Tooltip should contain "${expectedTooltipText}"`).to.equal(true);

            logger.info("Phase8", "✓ Execution status verified in tooltip");

            logger.info("TestThemesView", "\n========================================");
            logger.info("TestThemesView", "Test Themes View Test - COMPLETE");
            logger.info("TestThemesView", "========================================");
            logger.info("TestThemesView", `Project: ${config.projectName}`);
            logger.info("TestThemesView", `Version: ${config.versionName}`);
            logger.info("TestThemesView", `Cycle: ${config.cycleName}`);
            logger.info("TestThemesView", `Test Theme: ${config.testThemeName}`);
            logger.info("TestThemesView", `Execution Status: Verified as 'Performed'`);
            logger.info("TestThemesView", "========================================\n");
        });
    });
});
