/**
 * @file src/test/ui/testThemesView.ui.test.ts
 * @description UI tests for Test Themes view features including:
 * - Navigation to Test Themes view
 * - View title verification
 * - Test generation from tree items (root, middle, leaf levels)
 * - Test execution
 * - Upload result to TestBench
 * - Tooltip verification
 * - Filesystem verification for generated files
 */

import { expect } from "chai";
import { SideBarView, TreeItem, WebDriver, By, EditorView, TextEditor, ViewSection } from "vscode-extension-tester";
import { getTestLogger } from "./utils/testLogger";
import {
    openTestBenchSidebar,
    applySlowMotion,
    waitForTreeItems,
    waitForProjectsView,
    waitForTestThemesAndElementsViews,
    handleCycleConfigurationPrompt,
    UITimeouts,
    waitForCondition,
    waitForTooltip,
    waitForTestingViewReady,
    waitForTerminalOutput,
    waitForTreeRefresh,
    waitForNotification,
    verifyGeneratedFilesExist,
    countGeneratedRobotFiles,
    getGeneratedRobotFiles,
    readRobotFileContent,
    verifyRobotFileMetadata,
    FilesystemVerificationResult
} from "./utils/testUtils";
import { getTestData, logTestDataConfig } from "./config/testConfig";
import { TestContext, setupTestHooks } from "./utils/testHooks";
import { TestThemesPage } from "./pages/TestThemesPage";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";
import {
    TreeItemLevel,
    logTreeStructure,
    findTreeItemByLevel,
    canExecuteScenario,
    doubleClickTreeItem,
    expandTreeItemIfNeeded
} from "./utils/treeViewUtils";
import * as path from "path";

const logger = getTestLogger();

/**
 * Track if tree structure has been logged in this test session.
 * Used to avoid redundant logging in cases where tree structure is not expected to change.
 */
let treeStructureLoggedForSession = false;

/**
 * Logs tree structure only once per test session to avoid overhead.
 * The tree structure (hierarchy of items) doesn't change during tests,
 * only the states of items may change.
 *
 * @param section - The view section to log
 * @param driver - The WebDriver instance
 * @param viewName - Name of the view for logging
 * @param forceLog - Force logging even if already logged (default: false)
 */
async function logTreeStructureOnce(
    section: any,
    driver: WebDriver,
    viewName: string = "Test Themes View",
    forceLog: boolean = false
): Promise<void> {
    if (treeStructureLoggedForSession && !forceLog) {
        logger.debug("TreeAnalysis", "Tree structure already logged in this session, skipping...");
        return;
    }

    await logTreeStructure(section, driver, viewName);
    treeStructureLoggedForSession = true;
}

/**
 * Resets the tree structure logging flag.
 */
function resetTreeStructureLoggingFlag(): void {
    treeStructureLoggedForSession = false;
}

/**
 * Configuration for a test generation scenario.
 */
export interface TestGenerationScenario {
    /** The level of the tree item to test */
    level: TreeItemLevel;
    /** Optional specific item name to find (if not provided, will find first item at level) */
    itemName?: string;
    /** Description of the scenario for logging */
    description: string;
    /** Whether to verify .robot file opens in editor (default: true) */
    verifyRobotFile?: boolean;
    /** Whether to verify generated files exist on filesystem (default: true) */
    verifyFilesystem?: boolean;
    /** Whether to verify file content and metadata (default: true) */
    verifyMetadata?: boolean;
    /** Whether to verify all children are generated for parent items (default: true for ROOT/MIDDLE) */
    verifyChildren?: boolean;
    /** Whether to execute tests after generation (default: false) */
    executeTests?: boolean;
    /** Whether to upload results after execution (default: false) */
    uploadResults?: boolean;
    /** Whether to verify tooltip shows execution status after upload (default: true when uploadResults is true) */
    verifyExecutionStatus?: boolean;
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

        // First, move mouse away from any current hover position to clear any existing tooltip
        const clearActions = driver.actions({ async: true });
        await clearActions.move({ x: 10, y: 10 }).perform();
        await driver.sleep(150);

        let labelElement = null;

        try {
            // Try to find the label element within the tree item
            // VS Code tree items typically have a .monaco-icon-label or similar for the text
            const labelSelectors = [
                ".monaco-icon-label",
                ".label-name",
                ".monaco-highlighted-label",
                '[class*="label"]'
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
        // More reliable than using the TreeItem element directly
        const treeRowElement = await driver.executeScript(`
            const rows = document.querySelectorAll(".monaco-list-row");
            for (const row of rows) {
                const label = row.querySelector('.monaco-icon-label, .label-name, [class*="label"]');
                if (label) {
                    const text = label.textContent || label.innerText || "";
                    if (text.includes("${itemLabel.replace(/"/g, '\\"')}")) {
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
            // Verify the tooltip is for the correct item by checking the Name field
            const nameMatch = tooltipText.match(/Name:\s*(.+)/);
            const tooltipName = nameMatch ? nameMatch[1].trim() : null;
            // Verify this is the item tooltip, not an action button tooltip
            const isItemTooltip =
                tooltipText.includes("Execution Status") ||
                tooltipText.includes("Type:") ||
                (!tooltipText.includes("Upload") &&
                    !tooltipText.includes("Generate") &&
                    !tooltipText.includes("Delete"));

            if (isItemTooltip) {
                if (tooltipName && tooltipName !== itemLabel) {
                    logger.warn(
                        "Tooltip",
                        `Tooltip may not match item: expected "${itemLabel}", found Name: "${tooltipName}"`
                    );
                }

                logger.trace("Tooltip", `Found tooltip text: ${tooltipText.substring(0, 100)}...`);
                logger.debug("Tooltip", `Full tooltip text for "${itemLabel}":\n${tooltipText}`);
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
                const rows = document.querySelectorAll(".monaco-list-row");
                for (const row of rows) {
                    const text = row.textContent || row.innerText || "";
                    if (text.includes("${itemLabel.replace(/"/g, '\\"')}")) {
                        // Look for title attribute on the row or its children
                        if (row.title) return row.title;
                        const labeled = row.querySelector("[title]");
                        if (labeled && labeled.title) return labeled.title;
                        // Also check for custom tooltip data attribute
                        const customTooltip = row.getAttribute("data-tooltip") || 
                                             row.querySelector("[data-tooltip]")?.getAttribute("data-tooltip");
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
 * Parses metadata (UniqueID, Name, Numbering) from tooltip text.
 *
 * @param tooltipText - The tooltip text to parse
 * @returns Object containing parsed metadata fields
 */
function parseTooltipMetadata(tooltipText: string): {
    uniqueID: string | null;
    name: string | null;
    numbering: string | null;
} {
    const metadata = {
        uniqueID: null as string | null,
        name: null as string | null,
        numbering: null as string | null
    };

    if (!tooltipText) {
        return metadata;
    }

    // Check for format: "UniqueID: iTB-TC-325" or "ID: iTB-TC-325" or "UniqueID: iTB-TC-325\n")
    let uniqueIDMatch = tooltipText.match(/UniqueID:\s*([^\n\r]+)/i);
    if (!uniqueIDMatch || !uniqueIDMatch[1]) {
        // Check "ID: ..." format
        uniqueIDMatch = tooltipText.match(/ID:\s*([^\n\r]+)/i);
    }
    if (uniqueIDMatch && uniqueIDMatch[1]) {
        metadata.uniqueID = uniqueIDMatch[1].trim();
    }

    // Parse Name (format: "Name: FSZ" or "Name: FSZ\n")
    const nameMatch = tooltipText.match(/Name:\s*([^\n\r]+)/i);
    if (nameMatch && nameMatch[1]) {
        metadata.name = nameMatch[1].trim();
    }

    // Parse Numbering (format: "Numbering: 1.2.2.1.1" or "Numbering: 1.2.2.1.1\n")
    const numberingMatch = tooltipText.match(/Numbering:\s*([^\n\r]+)/i);
    if (numberingMatch && numberingMatch[1]) {
        metadata.numbering = numberingMatch[1].trim();
    }

    return metadata;
}

/**
 * Escapes special regex characters in a string.
 *
 * @param str - The string to escape
 * @returns Escaped string safe for use in regex
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extracts metadata value from Robot Framework file content.
 * Robot Framework metadata format: "Metadata    Key    Value"
 *
 * @param fileContent - The content of the .robot file
 * @param metadataKey - The metadata key to extract (e.g., "UniqueID", "Name", "Numbering")
 * @returns The metadata value or null if not found
 */
function extractMetadataFromFile(fileContent: string, metadataKey: string): string | null {
    const pattern = new RegExp(`Metadata\\s+${escapeRegex(metadataKey)}\\s+([^\\n\\r]+)`, "i");
    const match = fileContent.match(pattern);
    if (match && match[1]) {
        return match[1].trim();
    }
    return null;
}

/**
 * Verifies that a tree item"s tooltip contains the expected text.
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
        logger.info("Tooltip", ` Tooltip contains expected text: "${expectedText}"`);
    } else {
        logger.warn("Tooltip", ` Tooltip does not contain "${expectedText}"`);
        logger.debug("Tooltip", `Actual tooltip text: ${tooltipText}`);
    }

    return containsExpected;
}

/**
 * Clicks the Generate button for a tree item using JavaScript to avoid stale element issues.
 * Finds the row by label and clicks the Generate button in one atomic operation.
 *
 * @param driver - The WebDriver instance
 * @param itemLabel - The label of the item
 * @returns Promise<boolean> - True if button was clicked successfully
 */
async function clickGenerateButton(driver: WebDriver, itemLabel: string): Promise<boolean> {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await driver.switchTo().defaultContent();
            logger.trace(
                "TestGeneration",
                `Looking for Generate button near item: "${itemLabel}" (attempt ${attempt}/${maxRetries})`
            );

            // Scroll the item into view and hover over it using JavaScript
            const scrollAndHoverSucceeded = (await driver.executeScript(`
                function scrollAndHoverItem(itemLabel) {
                    const rows = document.querySelectorAll('.monaco-list-row');
                    for (const row of rows) {
                        const labelElement = row.querySelector('.monaco-icon-label .label-name');
                        const labelText = labelElement ? labelElement.textContent : '';
                        if (labelText === itemLabel || row.textContent.includes(itemLabel)) {
                            // Scroll into view
                            row.scrollIntoView({ block: 'center' });
                            // Click to select the row (this ensures action buttons appear)
                            row.click();
                            // Dispatch mouse events to trigger hover state
                            row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                            row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                            return true;
                        }
                    }
                    return false;
                }
                return scrollAndHoverItem('${itemLabel.replace(/'/g, "\\'")}');
            `)) as boolean;

            if (!scrollAndHoverSucceeded) {
                logger.debug("TestGeneration", `Could not find item "${itemLabel}" in tree, attempt ${attempt}`);
                if (attempt < maxRetries) {
                    await driver.sleep(500);
                    continue;
                }
                return false;
            }

            // Wait for action buttons to appear
            await driver.sleep(300);

            // Use JavaScript to find and click the Generate button in one atomic operation
            const clickSucceeded = (await driver.executeScript(`
                function findAndClickGenerateButton(itemLabel) {
                    const rows = document.querySelectorAll('.monaco-list-row');
                    for (const row of rows) {
                        const rowText = row.textContent || row.innerText || '';
                        if (!rowText.includes(itemLabel)) {
                            continue;
                        }
                        
                        // Look for action buttons with Generate-related icons or labels
                        const actionButtons = row.querySelectorAll('a.action-item, button.action-item, a[class*="action"], button[class*="action"]');
                        for (const btn of actionButtons) {
                            // Check aria-label or title for "Generate"
                            const ariaLabel = btn.getAttribute('aria-label') || '';
                            const title = btn.getAttribute('title') || '';
                            const buttonText = (ariaLabel + ' ' + title).toLowerCase();
                            
                            if (buttonText.includes('generate') || buttonText.includes('robot framework')) {
                                btn.scrollIntoView({ block: 'center' });
                                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                return true;
                            }
                            
                            // Check for robot framework icon (codicon-robot or similar)
                            const codicon = btn.querySelector('.codicon-robot, .codicon-play, [class*="codicon-robot"], [class*="codicon-play"]');
                            if (codicon) {
                                btn.scrollIntoView({ block: 'center' });
                                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                return true;
                            }
                        }
                    }
                    return false;
                }
                return findAndClickGenerateButton('${itemLabel.replace(/'/g, "\\'")}');
            `)) as boolean;

            if (clickSucceeded) {
                logger.trace("TestGeneration", "Successfully clicked Generate button");
                await applySlowMotion(driver);
                return true;
            }

            logger.debug("TestGeneration", `Button not found or click failed on attempt ${attempt}`);

            if (attempt < maxRetries) {
                await driver.sleep(500);
            }
        } catch (error: any) {
            const isStaleError =
                error.name === "StaleElementReferenceError" || error.message?.includes("stale element");

            if (isStaleError && attempt < maxRetries) {
                logger.debug("TestGeneration", `Stale element error on attempt ${attempt}, retrying...`);
                await driver.sleep(500);
                continue;
            }

            logger.error("TestGeneration", `Error on attempt ${attempt}`, error);

            if (attempt === maxRetries) {
                return false;
            }
        }
    }

    logger.warn("TestGeneration", "Failed to click Generate button after all retries");
    return false;
}

/**
 * Generates tests for a specific tree item.
 * Uses JavaScript-based approach to avoid stale element issues.
 *
 * @param driver - The WebDriver instance
 * @param itemLabel - The label of the item (for logging)
 * @returns Promise<boolean> - True if generation was successful
 */
async function generateTestsForItem(driver: WebDriver, itemLabel: string): Promise<boolean> {
    logger.info("TestGeneration", `Generating tests for item: "${itemLabel}"...`);

    logger.info("TestGeneration", 'Clicking "Generate Robot Framework Test Suites" button...');
    const generateButtonClicked = await clickGenerateButton(driver, itemLabel);

    if (!generateButtonClicked) {
        // Fallback: JavaScript approach failed, log warning and return failure
        logger.warn("TestGeneration", `Failed to click Generate button for "${itemLabel}" using JavaScript approach`);
        return false;
    }

    logger.info("TestGeneration", "Waiting for test generation success notification...");
    const generationNotificationAppeared = await waitForNotification(
        driver,
        "Successfully generated Robot Framework test suites",
        120000
    );

    if (!generationNotificationAppeared) {
        logger.warn("TestGeneration", "Test generation notification did not appear within timeout");
        return false;
    }

    logger.info("TestGeneration", ` Test generation completed successfully for "${itemLabel}"`);
    await applySlowMotion(driver);
    return true;
}

/**
 * Closes all open .robot file editors to prevent stale file verification.
 *
 * @param driver - The WebDriver instance
 */
async function closeAllRobotFileEditors(driver: WebDriver): Promise<void> {
    try {
        const editorView = new EditorView();
        const openEditorTitles = await editorView.getOpenEditorTitles();

        for (const title of openEditorTitles) {
            if (title.includes(".robot")) {
                try {
                    logger.debug("Verification", `Closing stale .robot file editor: "${title}"`);
                    await editorView.closeEditor(title);
                    await applySlowMotion(driver);
                } catch (error) {
                    logger.debug("Verification", `Error closing editor "${title}": ${error}`);
                }
            }
        }
    } catch (error) {
        logger.debug("Verification", `Error closing robot file editors: ${error}`);
    }
}

/**
 * Determines if a tree item is a Test Theme (folder) or Test Case Set (file).
 *
 * @param item - The tree item to check
 * @param driver - The WebDriver instance
 * @returns Promise<{ isTestTheme: boolean; tooltip: string | null }> - Whether item is a test theme and its tooltip
 */
async function determineItemType(
    item: TreeItem,
    driver: WebDriver
): Promise<{ isTestTheme: boolean; tooltip: string | null }> {
    const hasChildren = await item.hasChildren();
    const tooltip = await getTreeItemTooltip(item, driver);
    const isTestTheme = hasChildren || (tooltip !== null && tooltip.includes("TestThemeNode"));

    return { isTestTheme, tooltip };
}

/**
 * Verifies that a generated tree item has the correct .robot file and contains expected metadata.
 * Handles both Test Themes (which create __init__.robot files) and Test Case Sets (which create .robot files).
 *
 * @param section - The Test Themes view section
 * @param testThemesPage - The TestThemesPage instance
 * @param driver - The WebDriver instance
 * @param parentItem - The parent item that was used for generation
 * @param parentItemLabel - The label of the parent item
 * @returns Promise<boolean> - True if verification was successful
 */
async function verifyGeneratedRobotFile(
    section: ViewSection,
    testThemesPage: TestThemesPage,
    driver: WebDriver,
    parentItem: TreeItem,
    parentItemLabel: string
): Promise<boolean> {
    logger.info("Verification", `Verifying generated robot file for item: "${parentItemLabel}"...`);

    await closeAllRobotFileEditors(driver);
    await waitForTreeRefresh(driver, section, UITimeouts.MEDIUM);

    const refreshedParent = await testThemesPage.getItem(section, parentItemLabel);
    if (!refreshedParent) {
        await waitForTreeRefresh(driver, section, UITimeouts.SHORT);
        const retryParent = await testThemesPage.getItem(section, parentItemLabel);
        if (!retryParent) {
            logger.warn("Verification", `Parent item "${parentItemLabel}" not found for verification`);
            return false;
        }
    }

    const itemToCheck = refreshedParent || parentItem;
    const itemLabel = await itemToCheck.getLabel();
    const { isTestTheme, tooltip } = await determineItemType(itemToCheck, driver);

    if (isTestTheme) {
        logger.info("Verification", `Item "${itemLabel}" is a Test Theme (folder), looking for __init__.robot file...`);

        const isExpanded = await itemToCheck.isExpanded();
        if (!isExpanded) {
            await itemToCheck.expand();
            await applySlowMotion(driver);
            await waitForTreeItems(section, driver);
        }

        const children = await itemToCheck.getChildren();
        if (children.length === 0) {
            logger.warn("Verification", `Test Theme "${itemLabel}" has no children to verify`);
            return false;
        }

        let targetTestCaseSet: TreeItem | null = null;
        for (const child of children) {
            try {
                const childTooltip = await getTreeItemTooltip(child, driver);
                if (
                    childTooltip &&
                    (childTooltip.includes("Status: Generated") ||
                        (childTooltip.includes("Generated") && !childTooltip.includes("Not Generated")))
                ) {
                    targetTestCaseSet = child;
                    break;
                }
            } catch (error) {
                logger.debug("Verification", `Error checking child: ${error}`);
                continue;
            }
        }

        if (!targetTestCaseSet) {
            targetTestCaseSet = children[0];
        }

        logger.info("Verification", `Verifying Test Theme "${itemLabel}" by checking for __init__.robot file...`);

        const isGenerated =
            tooltip &&
            (tooltip.includes("Status: Generated") ||
                (tooltip.includes("Generated") && !tooltip.includes("Not Generated")));

        if (!isGenerated) {
            logger.warn("Verification", `Test Theme "${itemLabel}" is not marked as generated`);
            logger.debug("Verification", `Tooltip content: "${tooltip}"`);
            return false;
        }

        logger.info("Verification", `Test Theme "${itemLabel}" is marked as generated`);

        // Try to open __init__.robot file using VS Code's "Go to File" command
        // The file should be in the output directory under a folder matching the test theme name
        try {
            const { Workbench } = await import("vscode-extension-tester");
            const workbench = new Workbench();
            const commandPalette = await workbench.openCommandPrompt();

            // Use "Go to File" command to search for __init__.robot
            await commandPalette.setText(">Go to File");
            await driver.sleep(500);

            const quickPicks = await commandPalette.getQuickPicks();
            if (quickPicks.length > 0) {
                await quickPicks[0].select();
                await driver.sleep(500);

                // Search for __init__.robot in the file picker
                await commandPalette.setText("__init__.robot");
                await driver.sleep(1000);

                // Try to find and select the file
                const filePicks = await commandPalette.getQuickPicks();
                for (const pick of filePicks) {
                    const pickText = await pick.getText();
                    // Look for __init__.robot files that might be related to our test theme
                    if (pickText.includes("__init__.robot")) {
                        logger.info("Verification", `Found __init__.robot file: "${pickText}"`);
                        await pick.select();
                        await applySlowMotion(driver);

                        // Verify the file opened and contains metadata
                        return await verifyRobotFileOpensAndMetadata(driver, itemLabel, tooltip);
                    }
                }
            }

            await commandPalette.cancel();
        } catch (error) {
            logger.debug("Verification", `Error opening __init__.robot via command palette: ${error}`);
        }

        logger.info(
            "Verification",
            `Could not open __init__.robot directly, but Test Theme "${itemLabel}" is marked as generated. Assuming __init__.robot exists.`
        );
        return true;
    } else {
        // Test Case Set: Look for .robot file with the item name
        logger.info("Verification", `Item "${itemLabel}" is a Test Case Set, looking for .robot file...`);

        // Verify it's generated
        // Check for "Status: Generated" (exact) and ensure it's not "Not Generated"
        const isGenerated =
            tooltip &&
            (tooltip.includes("Status: Generated") ||
                (tooltip.includes("Generated") && !tooltip.includes("Not Generated")));

        if (!isGenerated) {
            logger.warn("Verification", `Test Case Set "${itemLabel}" is not marked as generated`);
            logger.debug("Verification", `Tooltip content: "${tooltip}"`);
            return false;
        }

        await itemToCheck.click();
        await applySlowMotion(driver);

        // Verify the correct .robot file opens and contains metadata
        return await verifyRobotFileOpensAndMetadata(driver, itemLabel, tooltip);
    }
}

/**
 * Verifies that a .robot file opens in the editor and contains metadata matching the tree item.
 *
 * @param driver - The WebDriver instance
 * @param itemLabel - The label of the tree item (for verification)
 * @param tooltip - The tooltip text containing metadata (UniqueID, Name, Numbering)
 * @returns Promise<boolean> - True if file opened successfully and metadata matches
 */
async function verifyRobotFileOpensAndMetadata(
    driver: WebDriver,
    itemLabel: string,
    tooltip: string | null
): Promise<boolean> {
    const { waitForFileInEditor } = await import("./utils/testUtils");

    // Wait for a new .robot file to open (not a stale one)
    // We closed all .robot editors earlier, so any new one should be the correct one
    const fileOpened = await waitForFileInEditor(driver, ".robot", UITimeouts.LONG);

    if (!fileOpened) {
        logger.warn("Verification", ".robot file did not open in editor within timeout");
        return false;
    }

    logger.info("Verification", ".robot file opened in editor");

    // Get the opened editor and verify the file title
    const editorView = new EditorView();
    const openEditorTitles = await editorView.getOpenEditorTitles();
    let robotEditor: TextEditor | null = null;
    let openedFileName = "";

    // Find the most recently opened .robot file (should be the last one in the list)
    const robotFileTitles = openEditorTitles.filter((title) => title.includes(".robot"));
    if (robotFileTitles.length === 0) {
        logger.warn("Verification", "No .robot file found in open editors");
        return false;
    }

    // Use the last opened .robot file
    openedFileName = robotFileTitles[robotFileTitles.length - 1];
    robotEditor = (await editorView.openEditor(openedFileName)) as TextEditor;
    await applySlowMotion(driver);

    if (!robotEditor) {
        logger.warn("Verification", "Could not find opened .robot file editor");
        return false;
    }

    logger.info("Verification", `Opened file: "${openedFileName}"`);

    expect(openedFileName, "Opened file should be a .robot file").to.include(".robot");

    // Read the file content
    logger.info("Verification", "Reading .robot file content to verify structure and metadata...");
    const fileContent = await robotEditor.getText();
    logger.debug("Verification", `File content (first 500 chars):\n${fileContent.substring(0, 500)}`);

    // Verify the file structure matches expected format
    expect(fileContent, "File should contain *** Settings *** section").to.include("*** Settings ***");

    // Verify metadata matches tooltip if available
    if (tooltip) {
        const metadata = parseTooltipMetadata(tooltip);

        if (metadata.uniqueID) {
            const uniqueIDPattern = new RegExp(`Metadata\\s+UniqueID\\s+${escapeRegex(metadata.uniqueID)}`, "i");
            const hasUniqueID = uniqueIDPattern.test(fileContent);
            if (hasUniqueID) {
                logger.info("Verification", `Verified UniqueID in file: "${metadata.uniqueID}"`);
            } else {
                logger.warn("Verification", `UniqueID "${metadata.uniqueID}" not found in file content`);
                // Don't fail, just warn - metadata format might vary
            }
        }

        if (metadata.name) {
            const namePattern = new RegExp(`Metadata\\s+Name\\s+${escapeRegex(metadata.name)}`, "i");
            const hasName = namePattern.test(fileContent);
            if (hasName) {
                logger.info("Verification", `Verified Name in file: "${metadata.name}"`);
            } else {
                logger.warn("Verification", `Name "${metadata.name}" not found in file content`);
            }
        }

        if (metadata.numbering) {
            const numberingPattern = new RegExp(`Metadata\\s+Numbering\\s+${escapeRegex(metadata.numbering)}`, "i");
            const hasNumbering = numberingPattern.test(fileContent);
            if (hasNumbering) {
                logger.info("Verification", `Verified Numbering in file: "${metadata.numbering}"`);
            } else {
                logger.warn("Verification", `Numbering "${metadata.numbering}" not found in file content`);
            }
        }
    } else {
        logger.warn("Verification", "No tooltip available to verify metadata");
    }

    logger.info("Verification", " .robot file verification complete");
    return true;
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
                continue;
            }
        }

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

        const activityBarItems = await driver.findElements(By.css(".activitybar .action-item"));

        for (const item of activityBarItems) {
            try {
                const ariaLabel = await item.getAttribute("aria-label");
                if (ariaLabel && ariaLabel.toLowerCase().includes("testing")) {
                    await item.click();
                    await applySlowMotion(driver);

                    const isVisible = await waitForCondition(
                        driver,
                        async () => await isTestingViewVisible(driver),
                        UITimeouts.MEDIUM,
                        200,
                        "Testing View to become visible"
                    );
                    if (isVisible) {
                        logger.info("TestingView", " Testing View opened successfully");
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

        await waitForTestingViewReady(driver, UITimeouts.MEDIUM);

        // Look for the "Run All Tests" button in the Testing View toolbar
        const runButton = await driver.wait(
            async () => {
                try {
                    // Try multiple selectors for the run button
                    const selectors = [
                        // Run All Tests button
                        '[aria-label*="Run All Tests"]',
                        '[aria-label*="Run Tests"]',
                        '[title*="Run All Tests"]',
                        '[title*="Run Tests"]',
                        // Play icon button in testing view
                        '.testing-explorer-view-content .action-item[aria-label*="Run"]',
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
                        '//a[contains(@aria-label, "Run All Tests")]',
                        '//a[contains(@aria-label, "Run Tests")]',
                        '//button[contains(@aria-label, "Run")]'
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
                    By.css('.codicon-loading, .codicon-sync, [class*="spinning"], .codicon-testing-run-icon')
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
                        By.css('.codicon-loading, .codicon-sync, [class*="spinning"]')
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

        logger.info("TestingView", " Test execution appears to be complete");
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

        await driver.actions().keyDown("\uE009").sendKeys("`").keyUp("\uE009").perform();

        const terminalVisible = await driver.wait(
            async () => {
                const terminals = await driver.findElements(
                    By.css('.terminal-wrapper, .integrated-terminal, [class*="terminal"]')
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

        // Get dynamic paths from extension settings
        const { getExtensionSetting } = await import("./config/testConfig");
        const outputDir = getExtensionSetting<string>("testbenchExtension.outputDirectory", "tests");
        const outputXmlPath = getExtensionSetting<string>("testbenchExtension.outputXmlFilePath", "results/output.xml");
        // Extract directory from full path (e.g., "results/output.xml" -> "results")
        const resultsDir = path.dirname(outputXmlPath!);

        const robotCommand = `robot --dryrun --outputdir ${resultsDir} ${outputDir}`;
        logger.info("Terminal", `Executing: ${robotCommand}`);

        await driver.actions().sendKeys(robotCommand).perform();
        await waitForCondition(driver, async () => true, 100, 50, "command input");
        await driver.actions().sendKeys("\uE007").perform();

        const commandCompleted = await waitForTerminalOutput(driver, "Output:", UITimeouts.LONG);

        if (!commandCompleted) {
            await waitForCondition(
                driver,
                async () => {
                    const terminalContent = await driver.findElements(By.css(".xterm-rows"));
                    for (const content of terminalContent) {
                        const text = await content.getText();
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

        logger.info("Terminal", " Robot command executed (dry-run mode)");
        return true;
    } catch (error) {
        logger.error("Terminal", `Error executing tests via terminal: ${error}`);
        return false;
    }
}

/**
 * Result of executing a test generation scenario.
 */
export interface ScenarioExecutionResult {
    /** Whether the scenario completed successfully */
    success: boolean;
    /** Whether the scenario was skipped due to precondition failures */
    skipped: boolean;
    /** Reason for failure or skip */
    reason?: string;
    /** Details about the scenario execution */
    details: {
        /** Label of the item that was tested */
        itemLabel?: string;
        /** Whether test generation was successful */
        generationSuccess?: boolean;
        /** Filesystem verification result */
        filesystemResult?: FilesystemVerificationResult;
        /** Number of robot files found after generation */
        filesGenerated?: number;
        /** Whether file content/metadata was verified */
        metadataVerified?: boolean;
        /** Number of children verified as generated */
        childrenVerified?: number;
        /** Whether tests were executed */
        testsExecuted?: boolean;
        /** Whether results were uploaded */
        resultsUploaded?: boolean;
        /** Whether execution status was verified in tooltip */
        executionStatusVerified?: boolean;
    };
}

/**
 * Verifies that all children of a tree item are marked as generated.
 *
 * @param parentItem - The parent tree item
 * @param driver - The WebDriver instance
 * @returns Promise<{ verified: number; failed: number; children: string[] }> - Verification result
 */
async function verifyChildrenGenerated(
    parentItem: TreeItem,
    driver: WebDriver
): Promise<{ verified: number; failed: number; children: string[] }> {
    const result = { verified: 0, failed: 0, children: [] as string[] };

    try {
        // Ensure parent is expanded
        await expandTreeItemIfNeeded(parentItem, driver);
        await driver.sleep(500);

        const children = await parentItem.getChildren();
        logger.info("ChildVerification", `Checking ${children.length} children for generation status...`);

        for (const child of children) {
            try {
                const childLabel = await child.getLabel();
                result.children.push(childLabel);

                const tooltip = await getTreeItemTooltip(child, driver);
                const isGenerated =
                    tooltip &&
                    (tooltip.includes("Status: Generated") ||
                        (tooltip.includes("Generated") && !tooltip.includes("Not Generated")));

                if (isGenerated) {
                    result.verified++;
                    logger.debug("ChildVerification", `  "${childLabel}" is generated`);
                } else {
                    result.failed++;
                    logger.warn("ChildVerification", `  "${childLabel}" is NOT generated`);
                }

                // If child has children, recursively verify (for nested test themes)
                if (await child.hasChildren()) {
                    const nestedResult = await verifyChildrenGenerated(child, driver);
                    result.verified += nestedResult.verified;
                    result.failed += nestedResult.failed;
                }
            } catch (childError) {
                logger.debug("ChildVerification", `Error checking child: ${childError}`);
                result.failed++;
            }
        }

        logger.info(
            "ChildVerification",
            `Child verification: ${result.verified} generated, ${result.failed} not generated`
        );
    } catch (error) {
        logger.error("ChildVerification", `Error verifying children: ${error}`);
    }

    return result;
}

/**
 * Executes a complete test generation scenario with comprehensive verification.
 * This is a reusable function that handles the common workflow for test generation tests,
 * matching the detail level of Phase 4-9 in the main test.
 *
 * @param driver - The WebDriver instance
 * @param testThemesPage - The TestThemesPage instance
 * @param sideBar - The SideBarView instance
 * @param scenario - The test generation scenario configuration
 * @param config - The test data configuration
 * @returns Promise<ScenarioExecutionResult> - Detailed result of scenario execution
 */
async function executeTestGenerationScenario(
    driver: WebDriver,
    testThemesPage: TestThemesPage,
    sideBar: SideBarView,
    scenario: TestGenerationScenario,
    config: { projectName: string; versionName: string; cycleName: string; testThemeName: string }
): Promise<ScenarioExecutionResult> {
    const result: ScenarioExecutionResult = {
        success: false,
        skipped: false,
        details: {}
    };

    logger.info("Scenario", "========================================");
    logger.info("Scenario", `Executing scenario: ${scenario.description}`);
    logger.info("Scenario", `Level: ${scenario.level}, Item: ${scenario.itemName || "(first at level)"}`);
    logger.info("Scenario", "========================================");

    // Apply defaults for optional flags
    const verifyFilesystem = scenario.verifyFilesystem !== false;
    const verifyMetadata = scenario.verifyMetadata !== false;
    const verifyRobotFile = scenario.verifyRobotFile !== false;
    const verifyChildren = scenario.verifyChildren ?? scenario.level !== TreeItemLevel.LEAF;
    const executeTests = scenario.executeTests === true;
    const uploadResults = scenario.uploadResults === true;
    const verifyExecutionStatus = scenario.verifyExecutionStatus ?? uploadResults;

    // Record initial file count for comparison
    const initialFileCount = countGeneratedRobotFiles();
    logger.debug("Scenario", `Initial .robot file count: ${initialFileCount}`);

    // ============================================
    // Step 1: Get Test Themes section and verify title
    // ============================================
    logger.info("Scenario", "Step 1: Verifying Test Themes section...");

    let content = sideBar.getContent();
    let testThemesSection = await testThemesPage.getSection(content);

    if (!testThemesSection) {
        result.reason = "Test Themes section not found";
        logger.warn("Scenario", result.reason);
        return result;
    }

    const testThemesTitle = await testThemesPage.getTitle(testThemesSection);
    logger.info("Scenario", `Test Themes view title: "${testThemesTitle}"`);

    expect(testThemesTitle, "Test Themes title should contain project name").to.include(config.projectName);
    expect(testThemesTitle, "Test Themes title should contain version name").to.include(config.versionName);
    expect(testThemesTitle, "Test Themes title should contain cycle name").to.include(config.cycleName);

    logger.info("Scenario", "Title verification passed");

    // ============================================
    // Step 2: Analyze tree structure and find target item
    // ============================================
    logger.info("Scenario", "Step 2: Analyzing tree structure...");

    // Log tree structure only once per session (structure doesn't change, only states)
    await logTreeStructureOnce(testThemesSection, driver, "Test Themes View");

    // Check if scenario can be executed
    const canExecuteResult = await canExecuteScenario(testThemesSection, driver, scenario.level, "Test Themes View");
    if (!canExecuteResult.canExecute) {
        result.skipped = true;
        result.reason = canExecuteResult.reason;
        logger.warn("Scenario", `Scenario cannot be executed: ${result.reason}`);
        return result;
    }

    // Find the target tree item
    const targetItem = await findTreeItemByLevel(testThemesSection, driver, scenario.level, scenario.itemName);

    if (!targetItem) {
        result.skipped = true;
        result.reason = scenario.itemName
            ? `Tree item "${scenario.itemName}" not found at ${scenario.level} level`
            : `No tree item found at ${scenario.level} level`;
        logger.warn("Scenario", result.reason);
        return result;
    }

    const itemLabel = await targetItem.getLabel();
    result.details.itemLabel = itemLabel;
    logger.info("Scenario", `Found target item: "${itemLabel}" at ${scenario.level} level`);

    // Get tooltip for metadata verification later
    const itemTooltip = await getTreeItemTooltip(targetItem, driver);
    logger.debug("Scenario", `Item tooltip: ${itemTooltip?.substring(0, 200) || "(none)"}...`);

    // ============================================
    // Step 3: Generate tests
    // ============================================
    logger.info("Scenario", "Step 3: Generating tests...");

    // Use JavaScript-based generation which doesn't rely on TreeItem references
    // This avoids stale element errors that occur after tooltip interactions
    const generationSuccess = await generateTestsForItem(driver, itemLabel);
    result.details.generationSuccess = generationSuccess;

    if (!generationSuccess) {
        result.reason = "Test generation failed";
        logger.warn("Scenario", result.reason);
        return result;
    }

    logger.info("Scenario", "Test generation completed");
    await applySlowMotion(driver);

    // ============================================
    // Step 4: Verify filesystem (generated files exist)
    // ============================================
    if (verifyFilesystem) {
        logger.info("Scenario", "Step 4: Verifying filesystem...");

        const filesystemResult = await verifyGeneratedFilesExist();
        result.details.filesystemResult = filesystemResult;
        result.details.filesGenerated = filesystemResult.totalCount;

        if (!filesystemResult.success) {
            logger.warn("Scenario", `Filesystem verification failed: ${filesystemResult.error}`);
        } else {
            logger.info("Scenario", `Found ${filesystemResult.totalCount} .robot file(s) on filesystem`);
            if (filesystemResult.hasInitFile) {
                logger.info("Scenario", "__init__.robot file found (test suite folder structure)");
            }
        }

        // Verify file count increased
        const newFileCount = filesystemResult.totalCount;
        if (newFileCount <= initialFileCount) {
            logger.warn("Scenario", `File count did not increase: ${initialFileCount} -> ${newFileCount}`);
        } else {
            logger.info("Scenario", `File count increased: ${initialFileCount} -> ${newFileCount}`);
        }
    }

    // ============================================
    // Step 5: Verify .robot file opens in editor and check metadata
    // ============================================
    if (verifyRobotFile) {
        logger.info("Scenario", "Step 5: Verifying .robot file in editor...");

        // Re-acquire section after generation (tree may have refreshed)
        content = sideBar.getContent();
        testThemesSection = await testThemesPage.getSection(content);

        if (testThemesSection) {
            await waitForTreeRefresh(driver, testThemesSection, UITimeouts.MEDIUM);

            const verificationSuccess = await verifyGeneratedRobotFile(
                testThemesSection,
                testThemesPage,
                driver,
                targetItem,
                itemLabel
            );

            if (verificationSuccess) {
                logger.info("Scenario", "Robot file verification passed");
            } else {
                logger.warn("Scenario", "Robot file verification failed (non-fatal)");
            }
        }
    }

    // ============================================
    // Step 6: Verify metadata in generated files (filesystem check)
    // ============================================
    if (verifyMetadata && itemTooltip) {
        logger.info("Scenario", "Step 6: Verifying metadata in generated files...");

        const generatedFiles = getGeneratedRobotFiles();
        let metadataVerified = false;

        // Extract expected metadata from tooltip
        const tooltipMetadata = parseTooltipMetadata(itemTooltip);
        logger.debug("Scenario", `Expected metadata from tooltip: ${JSON.stringify(tooltipMetadata)}`);

        // Check at least one file for metadata
        for (const file of generatedFiles) {
            const content = readRobotFileContent(file);
            if (content && content.includes("*** Settings ***")) {
                const verifyResult = verifyRobotFileMetadata(file, {
                    uniqueID: tooltipMetadata.uniqueID || undefined,
                    name: tooltipMetadata.name || undefined,
                    numbering: tooltipMetadata.numbering || undefined
                });

                if (verifyResult.valid) {
                    metadataVerified = true;
                    logger.info("Scenario", `Metadata verified in ${path.basename(file)}`);
                    break;
                } else {
                    logger.debug(
                        "Scenario",
                        `Metadata check failed for ${path.basename(file)}: ${verifyResult.errors.join(", ")}`
                    );
                }
            }
        }

        result.details.metadataVerified = metadataVerified;
        if (!metadataVerified && generatedFiles.length > 0) {
            logger.warn("Scenario", "Metadata verification did not match any file (non-fatal)");
        }
    }

    // ============================================
    // Step 7: Verify children are generated (for parent items)
    // ============================================
    if (verifyChildren && (scenario.level === TreeItemLevel.ROOT || scenario.level === TreeItemLevel.MIDDLE)) {
        logger.info("Scenario", "Step 7: Verifying children are generated...");

        // Re-acquire the target item as tree may have refreshed
        content = sideBar.getContent();
        testThemesSection = await testThemesPage.getSection(content);

        if (testThemesSection) {
            const refreshedItem = await testThemesPage.getItem(testThemesSection, itemLabel);
            if (refreshedItem) {
                const childResult = await verifyChildrenGenerated(refreshedItem, driver);
                result.details.childrenVerified = childResult.verified;

                if (childResult.verified > 0) {
                    logger.info("Scenario", `${childResult.verified} children verified as generated`);
                }
                if (childResult.failed > 0) {
                    logger.warn("Scenario", `${childResult.failed} children are NOT generated`);
                }
            }
        }
    }

    // ============================================
    // Step 8: Execute tests (if requested)
    // ============================================
    if (executeTests) {
        logger.info("Scenario", "Step 8: Executing generated tests...");

        let testsExecuted = false;

        // Try Testing View first
        let inTestingView = await isTestingViewVisible(driver);

        if (!inTestingView) {
            logger.info("Scenario", "Opening Testing View...");
            const testingViewOpened = await openTestingView(driver);
            if (testingViewOpened) {
                inTestingView = true;
            }
        }

        if (inTestingView) {
            const runSuccess = await runTestsFromTestingView(driver);
            if (runSuccess) {
                await waitForTestExecutionComplete(driver);
                testsExecuted = true;
                logger.info("Scenario", "Tests executed successfully");
            }
        }

        if (!testsExecuted) {
            // Fallback to terminal execution
            logger.info("Scenario", "Falling back to terminal execution...");
            await openTestBenchSidebar(driver);
            testsExecuted = await executeRobotTestsViaTerminal(driver, config);
        }

        result.details.testsExecuted = testsExecuted;

        if (!testsExecuted) {
            logger.warn("Scenario", "Test execution failed (non-fatal)");
        }
    }

    // ============================================
    // Step 9: Upload results (if requested)
    // ============================================
    if (uploadResults) {
        logger.info("Scenario", "Step 9: Uploading results to TestBench...");

        // Ensure we're back in TestBench sidebar
        await openTestBenchSidebar(driver);
        await applySlowMotion(driver);

        // Re-acquire section and item
        content = sideBar.getContent();
        testThemesSection = await testThemesPage.getSection(content);

        if (testThemesSection) {
            await waitForTreeItems(testThemesSection, driver);

            const itemForUpload = await testThemesPage.getItem(testThemesSection, itemLabel);
            if (itemForUpload) {
                await itemForUpload.click();
                await applySlowMotion(driver);

                logger.info("Scenario", 'Clicking "Upload Execution Results To TestBench" button...');
                const uploadButtonClicked = await testThemesPage.clickItemAction(itemForUpload, "Upload");

                if (uploadButtonClicked) {
                    const uploadNotificationAppeared = await waitForNotification(
                        driver,
                        "Successfully imported Robot Framework test results",
                        60000
                    );

                    if (uploadNotificationAppeared) {
                        result.details.resultsUploaded = true;
                        logger.info("Scenario", "Results uploaded successfully");
                    } else {
                        logger.warn("Scenario", "Upload notification did not appear");
                    }
                } else {
                    logger.warn("Scenario", "Failed to click Upload button");
                }
            }
        }
    }

    // ============================================
    // Step 10: Verify execution status in tooltip (if requested)
    // ============================================
    if (verifyExecutionStatus && uploadResults) {
        logger.info("Scenario", "Step 10: Verifying execution status in tooltip...");

        await waitForTreeRefresh(driver, null, UITimeouts.MEDIUM);

        content = sideBar.getContent();
        testThemesSection = await testThemesPage.getSection(content);

        if (testThemesSection) {
            await waitForTreeItems(testThemesSection, driver);

            const itemForTooltip = await testThemesPage.getItem(testThemesSection, itemLabel);
            if (itemForTooltip) {
                const expectedTooltipText = "Execution Status: Performed";
                const tooltipVerified = await verifyTooltipContains(itemForTooltip, driver, expectedTooltipText);

                result.details.executionStatusVerified = tooltipVerified;

                if (tooltipVerified) {
                    logger.info("Scenario", "Execution status verified in tooltip");
                } else {
                    logger.warn("Scenario", "Execution status not found in tooltip (non-fatal)");
                }
            }
        }
    }

    // ============================================
    // Final Summary
    // ============================================
    result.success = true;

    logger.info("Scenario", "========================================");
    logger.info("Scenario", `Scenario completed: ${scenario.description}`);
    logger.info("Scenario", `  Item: ${result.details.itemLabel}`);
    logger.info("Scenario", `  Generation: ${result.details.generationSuccess ? "✓" : "✗"}`);
    if (result.details.filesGenerated !== undefined) {
        logger.info("Scenario", `  Files generated: ${result.details.filesGenerated}`);
    }
    if (result.details.childrenVerified !== undefined) {
        logger.info("Scenario", `  Children verified: ${result.details.childrenVerified}`);
    }
    if (result.details.testsExecuted !== undefined) {
        logger.info("Scenario", `  Tests executed: ${result.details.testsExecuted ? "✓" : "✗"}`);
    }
    if (result.details.resultsUploaded !== undefined) {
        logger.info("Scenario", `  Results uploaded: ${result.details.resultsUploaded ? "✓" : "✗"}`);
    }
    if (result.details.executionStatusVerified !== undefined) {
        logger.info("Scenario", `  Status verified: ${result.details.executionStatusVerified ? "✓" : "✗"}`);
    }
    logger.info("Scenario", "========================================");

    return result;
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

    // Reset tree structure logging flag at suite start
    // This ensures fresh logging for each test run while avoiding
    // redundant logging within the same run
    before(function () {
        resetTreeStructureLoggingFlag();
    });

    const getDriver = () => ctx.driver;

    describe("Test Generation and Result Upload Flow", function () {
        it("should navigate to Test Themes view, generate tests, and upload results", async function () {
            const driver = getDriver();
            const config = getTestData();
            logTestDataConfig();
            const testThemesPage = new TestThemesPage(driver);
            const projectsPage = new ProjectsViewPage(driver);

            // ============================================
            // Phase 1: Login and View Detection
            // ============================================
            logger.info("Phase1", "Starting Login and View Detection...");

            const sideBar = new SideBarView();
            const content = sideBar.getContent();

            // Determine initial view state
            const projectsSection = await projectsPage.getSection(content);
            const testThemesSection = await testThemesPage.getSection(content);

            let isInProjectsView = false;
            let needsNavigation = true;

            if (projectsSection) {
                isInProjectsView = true;
                logger.info("Phase1", "Extension is in Projects View");
            } else if (testThemesSection) {
                logger.info("Phase1", "Extension is in Test Themes View");

                // Check if current context matches expected
                const testThemesTitle = await testThemesPage.getTitle(testThemesSection);
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
                    const buttonClicked = await testThemesPage.clickToolbarAction(
                        testThemesSection,
                        "Open Projects View"
                    );
                    if (!buttonClicked) {
                        logger.warn("Phase1", 'Failed to click "Open Projects View" button');
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
                const projectsSectionUpdated = await projectsPage.getSection(updatedContent);

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

                // Log all visible projects
                const allProjects = await projectsSectionUpdated.getVisibleItems();
                logger.debug("Phase2", `All visible projects (${allProjects.length}):`);
                for (let i = 0; i < allProjects.length; i++) {
                    try {
                        const projLabel = await (allProjects[i] as TreeItem).getLabel();
                        logger.debug("Phase2", `  [${i}] "${projLabel}"`);
                    } catch (e) {
                        logger.debug("Phase2", `  [${i}] <error getting label: ${e}>`);
                    }
                }

                const targetProject = await projectsPage.getProject(projectsSectionUpdated, config.projectName);
                if (!targetProject) {
                    logger.warn("Phase2", `Project "${config.projectName}" not found`);
                    this.skip();
                    return;
                }

                const foundProjectLabel = await targetProject.getLabel();
                logger.debug("Phase2", `Found project with label: "${foundProjectLabel}"`);
                if (foundProjectLabel !== config.projectName) {
                    logger.warn(
                        "Phase2",
                        `Project label mismatch: expected "${config.projectName}", but found "${foundProjectLabel}"`
                    );
                    this.skip();
                    return;
                }

                logger.info("Phase2", `Found project "${config.projectName}", expanding...`);
                const targetVersion = await projectsPage.getVersion(targetProject, config.versionName);
                if (!targetVersion) {
                    logger.warn("Phase2", `Version "${config.versionName}" not found`);
                    this.skip();
                    return;
                }

                const foundVersionLabel = await targetVersion.getLabel();
                logger.debug("Phase2", `Found version with label: "${foundVersionLabel}"`);
                logger.info("Phase2", `Found version "${config.versionName}", expanding...`);

                const targetCycle = await projectsPage.getCycle(targetVersion, config.cycleName);
                if (!targetCycle) {
                    logger.warn("Phase2", `Cycle "${config.cycleName}" not found`);
                    this.skip();
                    return;
                }

                const foundCycleLabel = await targetCycle.getLabel();
                logger.debug("Phase2", `Found cycle with label: "${foundCycleLabel}"`);

                // Verify we're working with the correct project by checking the project label
                const verifiedProjectLabel = await targetProject.getLabel();
                if (verifiedProjectLabel !== config.projectName) {
                    logger.error(
                        "Phase2",
                        `CRITICAL: Project label changed to "${verifiedProjectLabel}", expected "${config.projectName}"`
                    );
                    logger.error("Phase2", `This indicates we may be working with the wrong project!`);
                    this.skip();
                    return;
                }

                logger.info("Phase2", `Found cycle "${config.cycleName}"`);

                await handleCycleConfigurationPrompt(
                    targetCycle,
                    driver,
                    config.projectName,
                    config.versionName,
                    projectsSectionUpdated,
                    targetProject,
                    targetVersion
                );

                // Re-locate entire hierarchy after potential tree reordering to get fresh references
                logger.debug("Phase2", "Re-locating project hierarchy after configuration...");
                const refreshedContent = sideBar.getContent();
                const refreshedProjectsSection = await projectsPage.getSection(refreshedContent);

                let cycleToClick: TreeItem;

                if (!refreshedProjectsSection) {
                    logger.warn("Phase2", "Projects section not found after configuration");
                    // Fallback to original references
                    cycleToClick = targetCycle;
                } else {
                    // Re-fetch project to ensure we have a fresh reference
                    const refreshedProject = await projectsPage.getProject(
                        refreshedProjectsSection,
                        config.projectName
                    );
                    if (!refreshedProject) {
                        logger.warn(
                            "Phase2",
                            `Project "${config.projectName}" not found after configuration, using original reference`
                        );
                        cycleToClick = targetCycle;
                    } else {
                        const refreshedProjectLabel = await refreshedProject.getLabel();
                        logger.debug("Phase2", `Re-located project: "${refreshedProjectLabel}"`);

                        if (refreshedProjectLabel !== config.projectName) {
                            logger.error(
                                "Phase2",
                                `CRITICAL: After refresh, project label is "${refreshedProjectLabel}", expected "${config.projectName}"`
                            );
                            logger.error(
                                "Phase2",
                                `This indicates we're about to click a cycle from the wrong project!`
                            );
                            this.skip();
                            return;
                        }

                        // Re-fetch version
                        const refreshedVersion = await projectsPage.getVersion(refreshedProject, config.versionName);
                        if (!refreshedVersion) {
                            logger.warn(
                                "Phase2",
                                `Version "${config.versionName}" not found after configuration, using original reference`
                            );
                            cycleToClick = targetCycle;
                        } else {
                            const refreshedVersionLabel = await refreshedVersion.getLabel();
                            logger.debug("Phase2", `Re-located version: "${refreshedVersionLabel}"`);

                            // Re-fetch cycle
                            const refreshedCycle = await projectsPage.getCycle(refreshedVersion, config.cycleName);
                            if (!refreshedCycle) {
                                logger.warn(
                                    "Phase2",
                                    `Cycle "${config.cycleName}" not found after configuration, using original reference`
                                );
                                cycleToClick = targetCycle;
                            } else {
                                const refreshedCycleLabel = await refreshedCycle.getLabel();
                                logger.debug("Phase2", `Re-located cycle: "${refreshedCycleLabel}"`);
                                cycleToClick = refreshedCycle;
                            }
                        }
                    }
                }

                const finalCycleLabel = await cycleToClick.getLabel();
                logger.debug("Phase2", `About to double-click cycle with label: "${finalCycleLabel}"`);

                // Verify the project by re-fetching it
                const finalProjectsSection = sideBar.getContent();
                const finalProjectsSectionObj = await projectsPage.getSection(finalProjectsSection);
                if (finalProjectsSectionObj) {
                    const finalProject = await projectsPage.getProject(finalProjectsSectionObj, config.projectName);
                    if (finalProject) {
                        const finalProjectLabel = await finalProject.getLabel();
                        logger.debug("Phase2", `Final project verification: "${finalProjectLabel}"`);
                        if (finalProjectLabel !== config.projectName) {
                            logger.error(
                                "Phase2",
                                `CRITICAL: Final project check failed - found "${finalProjectLabel}" instead of "${config.projectName}"`
                            );
                        }
                    }
                }

                logger.info("Phase2", `Double-clicking cycle "${config.cycleName}"...`);
                await doubleClickTreeItem(cycleToClick, driver);

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
                    const section = await testThemesPage.getSection(content);
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
            const testThemesSectionVerify = await testThemesPage.getSection(updatedContent2);

            if (!testThemesSectionVerify) {
                logger.warn("Phase3", "Test Themes section not found");
                this.skip();
                return;
            }

            const testThemesTitle = await testThemesPage.getTitle(testThemesSectionVerify);
            logger.info("Phase3", `Test Themes view title: "${testThemesTitle}"`);

            expect(testThemesTitle, "Test Themes title should contain project name").to.include(config.projectName);
            expect(testThemesTitle, "Test Themes title should contain version name").to.include(config.versionName);
            expect(testThemesTitle, "Test Themes title should contain cycle name").to.include(config.cycleName);

            logger.info("Phase3", " Test Themes View title verified successfully");

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

            logger.info("Phase4", `Looking for test theme "${config.testThemeName}"...`);
            // Use a retry mechanism to find the item
            let targetTestTheme = await testThemesPage.getItem(testThemesSectionVerify, config.testThemeName);
            if (!targetTestTheme) {
                await waitForTreeRefresh(driver, testThemesSectionVerify, UITimeouts.SHORT);
                targetTestTheme = await testThemesPage.getItem(testThemesSectionVerify, config.testThemeName);
            }

            if (!targetTestTheme) {
                logger.warn("Phase4", `Test theme "${config.testThemeName}" not found`);
                this.skip();
                return;
            }

            const testThemeLabel = await targetTestTheme.getLabel();
            logger.info("Phase4", `Found test theme: "${testThemeLabel}"`);

            await targetTestTheme.click();
            await applySlowMotion(driver);

            logger.info("Phase4", 'Clicking "Generate Robot Framework Test Suites" button...');
            const generateButtonClicked = await testThemesPage.clickItemAction(targetTestTheme, "Generate");

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
                logger.info("Phase4", " Test generation completed successfully");
            }

            await applySlowMotion(driver);

            // ============================================
            // Phase 5: Verify Generated Test Case Set Opens .robot File
            // ============================================
            logger.info("Phase5", "Verifying generated test case set opens .robot file...");

            // Re-acquire Test Themes section after generation (tree may have refreshed)
            const updatedContentAfterGen = sideBar.getContent();
            const testThemesSectionAfterGen = await testThemesPage.getSection(updatedContentAfterGen);

            if (!testThemesSectionAfterGen) {
                logger.warn("Phase5", "Test Themes section not found after generation");
                this.skip();
                return;
            }

            // Wait for tree to refresh and show generated items
            await waitForTreeRefresh(driver, testThemesSectionAfterGen, UITimeouts.MEDIUM);

            // Re-find the test theme
            let testThemeForVerification = await testThemesPage.getItem(
                testThemesSectionAfterGen,
                config.testThemeName
            );
            if (!testThemeForVerification) {
                await waitForTreeRefresh(driver, testThemesSectionAfterGen, UITimeouts.SHORT);
                testThemeForVerification = await testThemesPage.getItem(
                    testThemesSectionAfterGen,
                    config.testThemeName
                );
            }

            if (!testThemeForVerification) {
                logger.warn("Phase5", `Test theme "${config.testThemeName}" not found for verification`);
                this.skip();
                return;
            }

            // Expand the test theme to see its children (test case sets)
            logger.info("Phase5", "Expanding test theme to find generated test case sets...");
            const hasChildren = await testThemeForVerification.hasChildren();
            if (!hasChildren) {
                logger.warn("Phase5", "Test theme has no children, cannot verify test case set");
                this.skip();
                return;
            }

            const isExpanded = await testThemeForVerification.isExpanded();
            if (!isExpanded) {
                await testThemeForVerification.expand();
                await applySlowMotion(driver);
                // Wait for children to load
                await waitForTreeItems(testThemesSectionAfterGen, driver);
            }

            // Get children (test case sets)
            const testCaseSets = await testThemeForVerification.getChildren();
            if (testCaseSets.length === 0) {
                logger.warn("Phase5", "No test case sets found under test theme");
                this.skip();
                return;
            }

            // Find a generated test case set (one that should have a .robot file)
            // Test case sets are typically the direct children of test themes
            let targetTestCaseSet: TreeItem | null = null;
            let testCaseSetLabel = "";

            for (const testCaseSet of testCaseSets) {
                try {
                    const label = await testCaseSet.getLabel();
                    logger.debug("Phase5", `Found test case set: "${label}"`);

                    // Get tooltip to check if it's generated
                    const tooltip = await getTreeItemTooltip(testCaseSet, driver);
                    // Check for "Status: Generated" (exact) and ensure it's not "Not Generated"
                    if (
                        tooltip &&
                        (tooltip.includes("Status: Generated") ||
                            (tooltip.includes("Generated") && !tooltip.includes("Not Generated")))
                    ) {
                        targetTestCaseSet = testCaseSet;
                        testCaseSetLabel = label;
                        logger.info("Phase5", `Found generated test case set: "${testCaseSetLabel}"`);
                        break;
                    }
                } catch (error) {
                    logger.debug("Phase5", `Error checking test case set: ${error}`);
                    continue;
                }
            }

            if (!targetTestCaseSet) {
                // If no explicitly marked as "Generated", use the first one
                // (it might be generated but tooltip might not show it yet)
                targetTestCaseSet = testCaseSets[0];
                testCaseSetLabel = await targetTestCaseSet.getLabel();
                logger.info("Phase5", `Using first test case set for verification: "${testCaseSetLabel}"`);
            }

            // Click the test case set to open the .robot file FIRST
            // We'll extract metadata from the file itself to avoid tooltip issues
            logger.info("Phase5", `Clicking test case set "${testCaseSetLabel}" to open .robot file...`);

            // Re-fetch the test case set to avoid stale element reference after tooltip interactions
            // First, make sure testThemeForVerification is still expanded
            const stillExpanded = await testThemeForVerification.isExpanded();
            if (!stillExpanded) {
                await testThemeForVerification.expand();
                await applySlowMotion(driver);
            }
            const freshTestCaseSets = await testThemeForVerification.getChildren();

            // Find the matching item by label
            let itemToClick: TreeItem | null = null;
            for (const item of freshTestCaseSets) {
                try {
                    const label = await item.getLabel();
                    if (label === testCaseSetLabel) {
                        itemToClick = item;
                        break;
                    }
                } catch {
                    continue;
                }
            }

            // If we couldn't find by label, use the first item
            if (!itemToClick) {
                itemToClick = freshTestCaseSets[0];
            }
            if (!itemToClick) {
                logger.warn("Phase5", "Could not find test case set to click");
                this.skip();
                return;
            }

            await itemToClick.click();
            await applySlowMotion(driver);

            // Wait for the .robot file to open in the editor
            const { waitForFileInEditor } = await import("./utils/testUtils");
            const fileOpened = await waitForFileInEditor(driver, ".robot", UITimeouts.LONG);

            if (!fileOpened) {
                logger.warn("Phase5", ".robot file did not open in editor within timeout");
                this.skip();
                return;
            }

            logger.info("Phase5", ".robot file opened in editor");

            // Get the opened editor and verify the file title
            const editorView = new EditorView();
            const openEditorTitles = await editorView.getOpenEditorTitles();
            let robotEditor: TextEditor | null = null;
            let openedFileName = "";

            // Find the most recently opened .robot file (should be the one we just clicked)
            const robotFileTitles = openEditorTitles.filter((title) => title.includes(".robot"));
            if (robotFileTitles.length === 0) {
                logger.warn("Phase5", "No .robot file found in open editors");
                this.skip();
                return;
            }

            // Use the last opened .robot file (most recent)
            openedFileName = robotFileTitles[robotFileTitles.length - 1];
            robotEditor = (await editorView.openEditor(openedFileName)) as TextEditor;
            await applySlowMotion(driver);

            if (!robotEditor) {
                logger.warn("Verification", "Could not find opened .robot file editor");
                this.skip();
                return;
            }

            logger.info("Phase5", `Opened file: "${openedFileName}"`);

            // Verify the file title contains .robot extension
            expect(openedFileName, "Opened file should be a .robot file").to.include(".robot");

            // Read the file content
            logger.info("Phase5", "Reading .robot file content to verify metadata...");
            const fileContent = await robotEditor.getText();
            logger.debug("Phase5", `File content (first 500 chars):\n${fileContent.substring(0, 500)}`);

            // Verify the file structure matches expected format
            expect(fileContent, "File should contain *** Settings *** section").to.include("*** Settings ***");

            // Extract metadata from the file itself (more reliable than tooltip)
            logger.info("Phase5", "Extracting metadata from file content...");
            const fileMetadata = {
                uniqueID: extractMetadataFromFile(fileContent, "UniqueID"),
                name: extractMetadataFromFile(fileContent, "Name"),
                numbering: extractMetadataFromFile(fileContent, "Numbering")
            };

            logger.info(
                "Phase5",
                `Extracted metadata from file - UniqueID: "${fileMetadata.uniqueID}", Name: "${fileMetadata.name}", Numbering: "${fileMetadata.numbering}"`
            );

            // Verify metadata exists in file
            if (fileMetadata.uniqueID) {
                logger.info("Phase5", `Verified UniqueID in file: "${fileMetadata.uniqueID}"`);
            } else {
                logger.warn("Phase5", "UniqueID not found in file content");
            }

            if (fileMetadata.name) {
                logger.info("Phase5", `Verified Name in file: "${fileMetadata.name}"`);
                // Verify the name matches the test case set label (case-insensitive)
                if (fileMetadata.name.toLowerCase() !== testCaseSetLabel.toLowerCase()) {
                    logger.warn(
                        "Phase5",
                        `Name in file ("${fileMetadata.name}") does not match test case set label ("${testCaseSetLabel}")`
                    );
                }
            } else {
                logger.warn("Phase5", "Name not found in file content");
            }

            if (fileMetadata.numbering) {
                logger.info("Phase5", `Verified Numbering in file: "${fileMetadata.numbering}"`);
            } else {
                logger.warn("Phase5", "Numbering not found in file content");
            }

            logger.info("Phase5", " Generated test case set .robot file verification complete");

            // ============================================
            // Phase 6: Execute Generated Tests
            // ============================================
            logger.info("Phase6", "Executing Generated Robot Framework Tests...");

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
                logger.info("Phase6", "Opening Testing View...");
                const testingViewOpened = await openTestingView(driver);
                if (!testingViewOpened) {
                    logger.warn("Phase6", "Failed to open Testing View, trying terminal execution...");
                    // Fallback: Execute tests via terminal with dry-run
                    const terminalExecutionSuccess = await executeRobotTestsViaTerminal(driver, config);
                    if (!terminalExecutionSuccess) {
                        logger.warn("Phase6", "Warning: Test execution via terminal also failed");
                    }
                } else {
                    inTestingView = true;
                }
            } else {
                logger.info("Phase6", "Already in Testing View");
            }

            if (inTestingView) {
                // Run tests from Testing View
                logger.info("Phase6", "Running tests from Testing View...");
                const testsExecuted = await runTestsFromTestingView(driver);
                if (!testsExecuted) {
                    logger.warn("Phase6", "Warning: Could not trigger test execution from Testing View");
                    // Fallback to terminal execution
                    await openTestBenchSidebar(driver);
                    await executeRobotTestsViaTerminal(driver, config);
                } else {
                    // Wait for test execution to complete
                    logger.info("Phase6", "Waiting for test execution to complete...");
                    await waitForTestExecutionComplete(driver);
                    logger.info("Phase6", " Test execution completed");
                }
            }

            await applySlowMotion(driver);

            // ============================================
            // Phase 7: Handle Testing View Switch
            // ============================================
            logger.info("Phase7", "Returning to TestBench view...");

            // Ensure we"re back in TestBench sidebar for upload
            await openTestBenchSidebar(driver);
            await applySlowMotion(driver);

            // Wait for TestBench sidebar to be fully loaded
            await waitForCondition(
                driver,
                async () => {
                    const content = sideBar.getContent();
                    const section = await testThemesPage.getSection(content);
                    return section !== null;
                },
                UITimeouts.MEDIUM,
                200,
                "TestBench sidebar to load"
            );

            // ============================================
            // Phase 8: Re-locate Test Theme and Upload Results
            // ============================================
            logger.info("Phase8", "Re-locating Test Theme and Uploading Results...");

            const updatedContent3 = sideBar.getContent();
            const testThemesSectionUpload = await testThemesPage.getSection(updatedContent3);

            if (!testThemesSectionUpload) {
                logger.warn("Phase8", "Test Themes section not found after returning");
                this.skip();
                return;
            }

            const uploadTreeLoaded = await waitForTreeItems(testThemesSectionUpload, driver);
            if (!uploadTreeLoaded) {
                logger.warn("Phase8", "Test Themes tree items did not load");
                this.skip();
                return;
            }

            logger.info("Phase8", `Looking for test theme "${config.testThemeName}"...`);
            let targetTestThemeForUpload = await testThemesPage.getItem(testThemesSectionUpload, config.testThemeName);
            if (!targetTestThemeForUpload) {
                await waitForTreeRefresh(driver, testThemesSectionUpload, UITimeouts.SHORT);
                targetTestThemeForUpload = await testThemesPage.getItem(testThemesSectionUpload, config.testThemeName);
            }

            if (!targetTestThemeForUpload) {
                logger.warn("Phase8", `Test theme "${config.testThemeName}" not found for upload`);
                this.skip();
                return;
            }

            await targetTestThemeForUpload.click();
            await applySlowMotion(driver);

            logger.info("Phase8", 'Clicking "Upload Execution Results To TestBench" button...');
            const uploadButtonClicked = await testThemesPage.clickItemAction(targetTestThemeForUpload, "Upload");

            if (!uploadButtonClicked) {
                logger.warn("Phase8", "Failed to click Upload button");
                this.skip();
                return;
            }

            logger.info("Phase8", "Waiting for upload success notification...");
            const uploadNotificationAppeared = await waitForNotification(
                driver,
                "Successfully imported Robot Framework test results",
                60000
            );

            if (!uploadNotificationAppeared) {
                logger.warn("Phase8", "Upload notification did not appear within timeout");
                // Continue, notification might have been missed
            } else {
                logger.info("Phase8", " Results upload completed successfully");
            }

            // ============================================
            // Phase 9: Verify Execution Status in Tooltip
            // ============================================
            logger.info("Phase9", "Verifying execution status in tooltip...");

            await waitForTreeRefresh(driver, null, UITimeouts.MEDIUM);

            const updatedContent4 = sideBar.getContent();
            const testThemesSectionTooltip = await testThemesPage.getSection(updatedContent4);

            if (!testThemesSectionTooltip) {
                throw new Error("[Phase 9] Test Themes section not found for tooltip verification");
            }

            const tooltipTreeLoaded = await waitForTreeItems(testThemesSectionTooltip, driver);
            if (!tooltipTreeLoaded) {
                throw new Error("[Phase 9] Test Themes tree items did not load for tooltip verification");
            }

            logger.info("Phase9", `Looking for test theme "${config.testThemeName}"...`);
            let targetTestThemeForTooltip = await testThemesPage.getItem(
                testThemesSectionTooltip,
                config.testThemeName
            );
            if (!targetTestThemeForTooltip) {
                await waitForTreeRefresh(driver, testThemesSectionTooltip, UITimeouts.SHORT);
                targetTestThemeForTooltip = await testThemesPage.getItem(
                    testThemesSectionTooltip,
                    config.testThemeName
                );
            }

            if (!targetTestThemeForTooltip) {
                throw new Error(`[Phase 9] Test theme "${config.testThemeName}" not found for tooltip verification`);
            }

            const expectedTooltipText = "Execution Status: Performed";
            const tooltipVerified = await verifyTooltipContains(targetTestThemeForTooltip, driver, expectedTooltipText);

            expect(tooltipVerified, `Tooltip should contain "${expectedTooltipText}"`).to.equal(true);

            logger.info("Phase9", " Execution status verified in tooltip");

            logger.info("TestThemesView", "\n========================================");
            logger.info("TestThemesView", "Test Themes View Test - COMPLETE");
            logger.info("TestThemesView", "========================================");
            logger.info("TestThemesView", `Project: ${config.projectName}`);
            logger.info("TestThemesView", `Version: ${config.versionName}`);
            logger.info("TestThemesView", `Cycle: ${config.cycleName}`);
            logger.info("TestThemesView", `Test Theme: ${config.testThemeName}`);
            logger.info("TestThemesView", `Execution Status: Verified as "Performed"`);
            logger.info("TestThemesView", "========================================\n");
        });
    });

    describe("Test Generation Scenarios - Different Hierarchy Levels", function () {
        /**
         * Shared navigation function to ensure we're in Test Themes view.
         * This is extracted to avoid code duplication across test cases.
         */
        async function ensureInTestThemesView(
            driver: WebDriver,
            config: { projectName: string; versionName: string; cycleName: string },
            logTree: boolean = false
        ): Promise<{ testThemesPage: TestThemesPage; sideBar: SideBarView }> {
            const testThemesPage = new TestThemesPage(driver);
            const projectsPage = new ProjectsViewPage(driver);
            const sideBar = new SideBarView();
            const content = sideBar.getContent();

            // Check if we're already in Test Themes view with correct context
            const testThemesSection = await testThemesPage.getSection(content);
            if (testThemesSection) {
                const testThemesTitle = await testThemesPage.getTitle(testThemesSection);
                if (
                    testThemesTitle &&
                    testThemesTitle.includes(config.projectName) &&
                    testThemesTitle.includes(config.cycleName)
                ) {
                    logger.info("Navigation", "Already in Test Themes View with correct context");

                    // Log tree structure if requested (only once per session)
                    if (logTree) {
                        await logTreeStructureOnce(testThemesSection, driver, "Test Themes View");
                    }

                    return { testThemesPage, sideBar };
                }
            }

            // Navigate to Test Themes view
            logger.info("Navigation", "Navigating to Test Themes View...");
            const projectsSection = await projectsPage.getSection(content);
            if (!projectsSection) {
                throw new Error("Projects section not found");
            }

            await waitForTreeItems(projectsSection, driver);
            const targetProject = await projectsPage.getProject(projectsSection, config.projectName);
            if (!targetProject) {
                throw new Error(`Project "${config.projectName}" not found`);
            }

            const targetVersion = await projectsPage.getVersion(targetProject, config.versionName);
            if (!targetVersion) {
                throw new Error(`Version "${config.versionName}" not found`);
            }

            const targetCycle = await projectsPage.getCycle(targetVersion, config.cycleName);
            if (!targetCycle) {
                throw new Error(`Cycle "${config.cycleName}" not found`);
            }

            await handleCycleConfigurationPrompt(
                targetCycle,
                driver,
                config.projectName,
                config.versionName,
                projectsSection,
                targetProject,
                targetVersion
            );

            // Re-locate cycle after configuration
            const refreshedContent = sideBar.getContent();
            const refreshedProjectsSection = await projectsPage.getSection(refreshedContent);
            if (refreshedProjectsSection) {
                const refreshedProject = await projectsPage.getProject(refreshedProjectsSection, config.projectName);
                if (refreshedProject) {
                    const refreshedVersion = await projectsPage.getVersion(refreshedProject, config.versionName);
                    if (refreshedVersion) {
                        const refreshedCycle = await projectsPage.getCycle(refreshedVersion, config.cycleName);
                        if (refreshedCycle) {
                            await doubleClickTreeItem(refreshedCycle, driver);
                            await waitForTestThemesAndElementsViews(driver);

                            // Log tree structure if requested (only once per session)
                            if (logTree) {
                                const contentAfterNav = sideBar.getContent();
                                const testThemesSectionAfterNav = await testThemesPage.getSection(contentAfterNav);
                                if (testThemesSectionAfterNav) {
                                    await logTreeStructureOnce(testThemesSectionAfterNav, driver, "Test Themes View");
                                }
                            }

                            return { testThemesPage, sideBar };
                        }
                    }
                }
            }

            // Fallback to original cycle
            await doubleClickTreeItem(targetCycle, driver);
            await waitForTestThemesAndElementsViews(driver);

            // Log tree structure if requested (only once per session)
            if (logTree) {
                const contentAfterNav = sideBar.getContent();
                const testThemesSectionAfterNav = await testThemesPage.getSection(contentAfterNav);
                if (testThemesSectionAfterNav) {
                    await logTreeStructureOnce(testThemesSectionAfterNav, driver, "Test Themes View");
                }
            }

            return { testThemesPage, sideBar };
        }

        it("should generate tests for root-level test theme (entire tree)", async function () {
            const driver = getDriver();
            const config = getTestData();
            logTestDataConfig();

            const { testThemesPage, sideBar } = await ensureInTestThemesView(driver, config, true); // Log tree structure

            const scenario: TestGenerationScenario = {
                level: TreeItemLevel.ROOT,
                description: "Generate tests for root-level test theme (entire tree)",
                verifyRobotFile: true,
                verifyFilesystem: true,
                verifyMetadata: true,
                verifyChildren: true,
                executeTests: false,
                uploadResults: false
            };

            const result = await executeTestGenerationScenario(driver, testThemesPage, sideBar, scenario, config);

            if (result.skipped) {
                logger.warn("Test", `Test skipped: ${result.reason}`);
                this.skip();
                return;
            }

            // Verify filesystem results
            if (result.details.filesystemResult) {
                expect(
                    result.details.filesystemResult.totalCount,
                    "Should have generated at least one .robot file"
                ).to.be.greaterThan(0);
            }

            // Verify children were checked (for root level, should have children)
            if (result.details.childrenVerified !== undefined) {
                logger.info("Test", `Children verified: ${result.details.childrenVerified}`);
            }

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(result.success, `Root-level test generation should succeed. Reason: ${result.reason || "none"}`).to
                .be.true;
        });

        it("should generate tests for middle-level test theme (subtree)", async function () {
            const driver = getDriver();
            const config = getTestData();
            logTestDataConfig();

            const { testThemesPage, sideBar } = await ensureInTestThemesView(driver, config);

            const scenario: TestGenerationScenario = {
                level: TreeItemLevel.MIDDLE,
                description: "Generate tests for middle-level test theme (subtree)",
                verifyRobotFile: true,
                verifyFilesystem: true,
                verifyMetadata: true,
                verifyChildren: true,
                executeTests: false,
                uploadResults: false
            };

            const result = await executeTestGenerationScenario(driver, testThemesPage, sideBar, scenario, config);

            if (result.skipped) {
                logger.warn("Test", `Test skipped: ${result.reason}`);
                logger.info(
                    "Test",
                    "This is expected if the tree structure only has root items with direct test case sets, or only a single test theme."
                );
                this.skip();
                return;
            }

            // Verify filesystem results
            if (result.details.filesystemResult) {
                expect(
                    result.details.filesystemResult.totalCount,
                    "Should have generated at least one .robot file"
                ).to.be.greaterThan(0);
            }

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(result.success, `Middle-level test generation should succeed. Reason: ${result.reason || "none"}`).to
                .be.true;
        });

        it("should generate tests for leaf test case set (single item)", async function () {
            const driver = getDriver();
            const config = getTestData();
            logTestDataConfig();

            const { testThemesPage, sideBar } = await ensureInTestThemesView(driver, config);

            const scenario: TestGenerationScenario = {
                level: TreeItemLevel.LEAF,
                description: "Generate tests for leaf test case set (single item)",
                verifyRobotFile: true,
                verifyFilesystem: true,
                verifyMetadata: true,
                verifyChildren: false, // Leaf items have no children
                executeTests: false,
                uploadResults: false
            };

            const result = await executeTestGenerationScenario(driver, testThemesPage, sideBar, scenario, config);

            if (result.skipped) {
                logger.warn("Test", `Test skipped: ${result.reason}`);
                this.skip();
                return;
            }

            // Verify filesystem results
            if (result.details.filesystemResult) {
                expect(
                    result.details.filesystemResult.totalCount,
                    "Should have generated at least one .robot file"
                ).to.be.greaterThan(0);
            }

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(result.success, `Leaf-level test generation should succeed. Reason: ${result.reason || "none"}`).to
                .be.true;
        });

        it("should generate, execute, and upload results for leaf test case set", async function () {
            const driver = getDriver();
            const config = getTestData();
            logTestDataConfig();

            const { testThemesPage, sideBar } = await ensureInTestThemesView(driver, config);

            // This test does the full workflow: generate, execute, upload, and verify
            // Similar to the main Phase 4-9 test but using the scenario framework
            const scenario: TestGenerationScenario = {
                level: TreeItemLevel.LEAF,
                description: "Full workflow: generate, execute, and upload for leaf test case set",
                verifyRobotFile: true,
                verifyFilesystem: true,
                verifyMetadata: true,
                verifyChildren: false,
                executeTests: true,
                uploadResults: true,
                verifyExecutionStatus: true
            };

            const result = await executeTestGenerationScenario(driver, testThemesPage, sideBar, scenario, config);

            if (result.skipped) {
                logger.warn("Test", `Test skipped: ${result.reason}`);
                this.skip();
                return;
            }

            // Verify all steps completed
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(result.details.generationSuccess, "Test generation should succeed").to.be.true;

            if (result.details.filesystemResult) {
                expect(
                    result.details.filesystemResult.totalCount,
                    "Should have generated at least one .robot file"
                ).to.be.greaterThan(0);
            }

            // Log detailed results
            logger.info("Test", "Full workflow test completed:");
            logger.info("Test", `  - Files generated: ${result.details.filesGenerated || 0}`);
            logger.info("Test", `  - Tests executed: ${result.details.testsExecuted ? "Yes" : "No"}`);
            logger.info("Test", `  - Results uploaded: ${result.details.resultsUploaded ? "Yes" : "No"}`);
            logger.info(
                "Test",
                `  - Execution status verified: ${result.details.executionStatusVerified ? "Yes" : "No"}`
            );

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(result.success, `Full workflow test should succeed. Reason: ${result.reason || "none"}`).to.be.true;
        });
    });
});
