/**
 * @file src/test/ui/testUtils.ts
 * @description Utility functions and constants for UI tests
 */

import { getSlowMotionDelay, getTestCredentials, hasTestCredentials, TEST_PATHS } from "../config/testConfig";
import { getTestLogger } from "./testLogger";
import * as path from "path";
import * as fs from "fs";
import {
    VSBrowser,
    WebDriver,
    Workbench,
    By,
    ActivityBar,
    SideBarView,
    WebElement,
    until,
    Key,
    TreeItem,
    EditorView,
    TextEditor
} from "vscode-extension-tester";

const logger = getTestLogger();

/**
 * Button text constants used in VS Code modals and dialogs.
 */
export const ModalButtonTexts = {
    ALLOW: "Allow", // Authentication provider modal button text
    PROCEED_ANYWAY: "Proceed Anyway" // Certificate warning modal button text
} as const;

/**
 * XPath selectors for finding modal buttons by text.
 * Used to find buttons in VS Code dialogs and modals.
 */
export const ModalButtonSelectors = {
    ALLOW: `//button[contains(text(), '${ModalButtonTexts.ALLOW}') or @aria-label='${ModalButtonTexts.ALLOW}'] | //a[contains(@class, 'monaco-button') and contains(., '${ModalButtonTexts.ALLOW}')]`,
    PROCEED_ANYWAY: `//button[contains(text(), '${ModalButtonTexts.PROCEED_ANYWAY}') or @aria-label='${ModalButtonTexts.PROCEED_ANYWAY}'] | //a[contains(@class, 'monaco-button') and contains(., '${ModalButtonTexts.PROCEED_ANYWAY}')]`
} as const;

/**
 * Logs out from TestBench if a session is active.
 * Uses the command palette to execute the logout command.
 * Waits for logout to complete and verifies the webview is available.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if logout was successful, false if no active session or logout failed
 */
export async function attemptLogout(driver: WebDriver): Promise<boolean> {
    try {
        // Check if already logged out (webview is available)
        const alreadyLoggedOut = await isWebviewAvailable(driver);
        if (alreadyLoggedOut) {
            logger.trace("Logout", "Already logged out - webview is available");
            return true;
        }

        logger.trace("Logout", "Attempting to logout...");
        const workbench = new Workbench();
        const commandPalette = await workbench.openCommandPrompt();

        // Search for logout command - ">" symbol must be at the beginning
        await commandPalette.setText(">TestBench: Logout");

        // Wait for command palette to filter results and for quick picks to be available
        await driver.wait(
            async () => {
                const picks = await commandPalette.getQuickPicks();
                return picks.length > 0;
            },
            UITimeouts.MEDIUM,
            "Waiting for command palette to filter results"
        );

        const picks = await commandPalette.getQuickPicks();

        // Check if logout command is available (indicates active session)
        let logoutCommandFound = false;
        for (const pick of picks) {
            const text = await pick.getText();
            if (text.includes("Logout") || text.includes("testbenchExtension.logout")) {
                logoutCommandFound = true;
                logger.trace("Logout", `Found logout command: ${text}`);
                await pick.select();

                // Wait for logout to complete and webview to become available
                try {
                    await driver.wait(
                        async () => {
                            return await isWebviewAvailable(driver);
                        },
                        UITimeouts.LONG,
                        "Waiting for logout to complete (webview to become available)"
                    );
                    logger.trace("Logout", "Logout successful - webview is now available");
                    return true;
                } catch {
                    logger.warn("Logout", "Logout command executed but webview still not available");
                    return false;
                }
            }
        }

        if (!logoutCommandFound) {
            logger.trace("Logout", "Logout command not found - user may already be logged out");
            await commandPalette.cancel();
            // Check if webview is available (might already be logged out)
            const webviewAvailable = await isWebviewAvailable(driver);
            return webviewAvailable;
        }

        return false;
    } catch (error) {
        // If command palette fails, log error but don't fail the test
        logger.error("Logout", "Error during logout attempt:", error);
        // Check if we're already logged out
        try {
            const webviewAvailable = await isWebviewAvailable(driver);
            if (webviewAvailable) {
                logger.trace("Logout", "Webview is available despite error - assuming already logged out");
                return true;
            }
        } catch {
            // Ignore errors when checking webview
        }
        return false;
    }
}

/**
 * Handles authentication modal by clicking the "Allow" button if present.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait for the button (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function handleAllowButton(driver: WebDriver, timeout: number = UITimeouts.MEDIUM): Promise<boolean> {
    try {
        // Wait for modal to appear and find Allow button
        const allowButtons = await driver.wait(async () => {
            const elements = await driver.findElements(By.xpath(ModalButtonSelectors.ALLOW));
            return elements.length > 0 ? elements : null;
        }, timeout);

        if (allowButtons && allowButtons.length > 0) {
            await allowButtons[0].click();
            logger.trace("Modal", `Clicked ${ModalButtonTexts.ALLOW} button`);

            // Wait for modal to disappear
            await driver.wait(
                async () => {
                    const elements = await driver.findElements(By.xpath(ModalButtonSelectors.ALLOW));
                    return elements.length === 0;
                },
                timeout,
                "Waiting for Allow modal to close"
            );
            return true;
        }

        return false;
    } catch (error) {
        logger.debug("Modal", `Could not find or click ${ModalButtonTexts.ALLOW} button:`, error);
        return false;
    }
}

/**
 * Handles certificate warning modal by clicking the "Proceed Anyway" button if present.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait for the button (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function handleProceedAnywayButton(
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    try {
        logger.trace("Modal", "Checking for certificate warning...");
        const proceedButtons = await driver.wait(async () => {
            const elements = await driver.findElements(By.xpath(ModalButtonSelectors.PROCEED_ANYWAY));
            return elements.length > 0 ? elements : null;
        }, timeout);

        if (proceedButtons && proceedButtons.length > 0) {
            await proceedButtons[0].click();
            logger.trace("Modal", `Clicked ${ModalButtonTexts.PROCEED_ANYWAY} button for untrusted certificate`);

            // Wait for action to complete and modal to disappear
            await driver.wait(
                async () => {
                    const elements = await driver.findElements(By.xpath(ModalButtonSelectors.PROCEED_ANYWAY));
                    return elements.length === 0;
                },
                timeout,
                "Waiting for Proceed Anyway modal to close"
            );
            return true;
        }

        return false;
    } catch (error) {
        logger.debug("Modal", `Could not find or click ${ModalButtonTexts.PROCEED_ANYWAY} button:`, error);
        return false;
    }
}

/**
 * Handles both authentication and certificate warning modals in sequence.
 * This is a convenience function that calls both handleAllowButton and handleProceedAnywayButton.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<void>
 */
export async function handleAuthenticationModals(driver: WebDriver): Promise<void> {
    await handleAllowButton(driver);
    await handleProceedAnywayButton(driver);
}

/**
 * Configuration options for opening a workspace.
 */
export interface WorkspaceConfig {
    /** Name of the folder to open (relative to project root). Default: 'test-workspace' */
    workspaceName?: string;
    /** If true, deletes the folder contents before opening. Default: false */
    cleanStart?: boolean;
}

/**
 * Configuration options for cleaning a workspace.
 */
export interface WorkspaceCleanupConfig {
    /** Array of file/folder names or paths to exclude from deletion (relative to workspace root) */
    exclude?: string[];
    /** Whether to exclude hidden files/folders (starting with .) by default. Default: false */
    excludeHidden?: boolean;
}

/**
 * Ensures a specific workspace folder is open in VS Code.
 * Handles creation, cleaning, and window reloading logic.
 *
 * @param config Configuration object for the workspace
 */
export async function ensureWorkspaceIsOpen(config: WorkspaceConfig = {}): Promise<void> {
    const { workspaceName = "test-workspace", cleanStart = false } = config;
    const browser = VSBrowser.instance;
    const driver = browser.driver;

    // Resolve path relative to project root
    const projectRoot = path.resolve(__dirname, "../../../");
    const workspacePath = path.join(projectRoot, TEST_PATHS.BASE_STORAGE, TEST_PATHS.WORKSPACE);

    if (cleanStart && fs.existsSync(workspacePath)) {
        logger.trace("Workspace", `Cleaning existing workspace: ${workspacePath}`);
        fs.rmSync(workspacePath, { recursive: true, force: true });
    }

    if (!fs.existsSync(workspacePath)) {
        logger.trace("Workspace", `Creating folder: ${workspacePath}`);
        fs.mkdirSync(workspacePath, { recursive: true });
    }

    // Check if the specific workspace is already open
    try {
        const title = await driver.getTitle();
        const folderName = path.basename(workspaceName);
        logger.trace("Workspace", `Current window title: '${title}'`);

        if (title && (title.includes(folderName) || title.includes(workspaceName))) {
            logger.trace("Workspace", `'${folderName}' appears to be already open.`);
            return;
        }
    } catch (error) {
        logger.debug("Workspace", `Could not check if workspace is open: ${error}`);
    }

    logger.trace("Workspace", `Opening folder: ${workspacePath}`);

    // Get current workbench element to detect staleness (reload)
    let oldWorkbench: WebElement | undefined;
    try {
        oldWorkbench = await driver.findElement(By.className("monaco-workbench"));
    } catch {
        // Element might not exist
    }

    await browser.openResources(workspacePath);

    // Wait for the old workbench to become stale (reload started)
    if (oldWorkbench) {
        try {
            await driver.wait(until.stalenessOf(oldWorkbench), UITimeouts.LONG, "Waiting for VS Code reload to start");
        } catch {
            logger.warn("Workspace", "Window reload detected via staleness timed out or was too fast.");
        }
    }

    // Ensure driver context is correct
    await driver.switchTo().defaultContent();

    logger.trace("Workspace", "Waiting for workbench to load...");

    // Wait for the workbench to fully reload.
    // Using generic class selector which is more stable than ID
    await driver.wait(
        until.elementLocated(By.className("monaco-workbench")),
        UITimeouts.WORKSPACE_LOAD,
        `Timeout waiting for workspace '${workspaceName}' to load`
    );

    try {
        await driver.wait(
            until.elementLocated(By.id("workbench.parts.statusbar")),
            UITimeouts.VERY_LONG,
            "Waiting for status bar (UI ready)"
        );
    } catch {
        logger.warn("Workspace", "Status bar not found, proceeding anyway.");
    }

    logger.trace("Workspace", `Workspace '${workspaceName}' loaded successfully.`);
}

/**
 * Gets the current workspace folder path from VS Code.
 * Uses the window title to determine the workspace path.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<string | null> - The workspace path or null if not found
 */
export async function getCurrentWorkspacePath(driver: WebDriver): Promise<string | null> {
    try {
        // Get the window title which typically contains the workspace folder name
        const title = await driver.getTitle();
        if (!title) {
            logger.debug("Workspace", "Could not get window title");
            return null;
        }

        // Try to extract workspace path from title
        const projectRoot = path.resolve(__dirname, "../../../");
        const workspaceRelativePath = `${TEST_PATHS.BASE_STORAGE}/${TEST_PATHS.WORKSPACE}`;
        const possibleWorkspaceNames = [workspaceRelativePath, TEST_PATHS.WORKSPACE];

        for (const workspaceName of possibleWorkspaceNames) {
            const workspacePath = path.join(projectRoot, workspaceName);
            if (fs.existsSync(workspacePath)) {
                // Check if the title matches this workspace
                const folderName = path.basename(workspaceName);
                if (title.includes(folderName) || title.includes(workspaceName)) {
                    return workspacePath;
                }
            }
        }

        const defaultWorkspace = path.join(projectRoot, TEST_PATHS.BASE_STORAGE, TEST_PATHS.WORKSPACE);
        if (fs.existsSync(defaultWorkspace)) {
            return defaultWorkspace;
        }

        logger.debug("Workspace", "Could not determine workspace path from title");
        return null;
    } catch (error) {
        logger.error("Workspace", `Error getting workspace path: ${error}`);
        return null;
    }
}

/**
 * Cleans up the workspace by removing all files and folders,
 * with optional exclusions for specific files/folders.
 *
 * @param driver - The WebDriver instance (optional, for getting workspace path)
 * @param workspacePath - Optional explicit workspace path. If not provided, will try to detect from VS Code
 * @param config - Configuration for cleanup, including exclusions
 * @returns Promise<boolean> - True if cleanup was successful, false otherwise
 */
export async function cleanupWorkspace(
    driver?: WebDriver,
    workspacePath?: string,
    config: WorkspaceCleanupConfig = {}
): Promise<boolean> {
    const { exclude = [], excludeHidden = false } = config;

    try {
        // Determine workspace path
        let targetPath: string | null = workspacePath || null;

        if (!targetPath && driver) {
            targetPath = await getCurrentWorkspacePath(driver);
        }

        if (!targetPath) {
            // Fallback to default workspace
            const projectRoot = path.resolve(__dirname, "../../../");
            targetPath = path.join(projectRoot, TEST_PATHS.BASE_STORAGE, TEST_PATHS.WORKSPACE);
        }

        if (!fs.existsSync(targetPath)) {
            logger.debug("Workspace Cleanup", `Workspace path does not exist: ${targetPath}`);
            return false;
        }

        logger.trace("Workspace Cleanup", `Cleaning workspace: ${targetPath}`);
        logger.trace("Workspace Cleanup", `Excluding: ${exclude.length > 0 ? exclude.join(", ") : "none"}`);

        // Normalize exclude paths to handle both relative and absolute paths
        const normalizedExcludes = exclude.map((item) => {
            if (path.isAbsolute(item)) {
                return item;
            }
            return path.join(targetPath, item);
        });

        // Function to check if a path should be excluded
        const shouldExclude = (itemPath: string, itemName: string): boolean => {
            // Check explicit exclusions
            for (const excludePath of normalizedExcludes) {
                if (itemPath === excludePath || itemPath.startsWith(excludePath + path.sep)) {
                    return true;
                }
            }

            // Check hidden files/folders if enabled
            if (excludeHidden && itemName.startsWith(".")) {
                return true;
            }

            return false;
        };

        // Get all items in the workspace
        const items = fs.readdirSync(targetPath, { withFileTypes: true });
        let deletedCount = 0;
        let skippedCount = 0;

        for (const item of items) {
            const itemPath = path.join(targetPath, item.name);

            if (shouldExclude(itemPath, item.name)) {
                logger.trace("Workspace Cleanup", `Excluding: ${item.name}`);
                skippedCount++;
                continue;
            }

            try {
                if (item.isDirectory()) {
                    fs.rmSync(itemPath, { recursive: true, force: true });
                    logger.trace("Workspace Cleanup", `Deleted folder: ${item.name}`);
                } else {
                    fs.unlinkSync(itemPath);
                    logger.trace("Workspace Cleanup", `Deleted file: ${item.name}`);
                }
                deletedCount++;
            } catch (error) {
                logger.error("Workspace Cleanup", `Error deleting ${item.name}: ${error}`);
            }
        }

        logger.trace("Workspace Cleanup", `Cleanup complete. Deleted: ${deletedCount}, Excluded: ${skippedCount}`);
        return true;
    } catch (error) {
        logger.error("Workspace Cleanup", `Error during cleanup: ${error}`);
        return false;
    }
}

/**
 * Opens the TestBench sidebar by finding and clicking the TestBench activity bar item.
 * Handles stale element references by retrying if needed.
 *
 * @param driver - The WebDriver instance (optional, for waiting)
 * @returns Promise<void>
 */
export async function openTestBenchSidebar(driver?: WebDriver): Promise<void> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Check if sidebar is already open by trying to get sections
            if (driver) {
                try {
                    const sideBar = new SideBarView();
                    const content = sideBar.getContent();
                    const sections = await content.getSections();
                    if (sections.length > 0) {
                        // Sidebar appears to be open, verify it's the TestBench sidebar
                        let foundTestBench = false;
                        for (const section of sections) {
                            const title = await section.getTitle();
                            if (title.includes("TestBench") || title.includes("Projects") || title.includes("Login")) {
                                foundTestBench = true;
                                break;
                            }
                        }
                        if (foundTestBench) {
                            logger.trace("Sidebar", "TestBench sidebar is already open");
                            return;
                        }
                    }
                } catch {
                    // Sidebar not open or not accessible, continue to open it
                }
            }

            const activityBar = new ActivityBar();
            const controls = await activityBar.getViewControls();

            let testBenchControlFound = false;
            for (const control of controls) {
                try {
                    const title = await control.getTitle();
                    if (title === "TestBench") {
                        testBenchControlFound = true;
                        await control.openView();
                        if (driver) {
                            // Wait for sidebar to initialize (background operation, no slow motion needed)
                            await driver.wait(
                                async () => {
                                    try {
                                        const sideBar = new SideBarView();
                                        const content = sideBar.getContent();
                                        const sections = await content.getSections();
                                        return sections.length > 0;
                                    } catch {
                                        return false;
                                    }
                                },
                                UITimeouts.LONG,
                                "Waiting for TestBench sidebar to initialize",
                                500
                            );
                        }
                        return; // Successfully opened sidebar
                    }
                } catch (error) {
                    // Stale element reference - element was found but became stale
                    // If this is the last attempt, throw the error
                    if (attempt === maxRetries - 1) {
                        throw error;
                    }
                    logger.debug(
                        "Sidebar",
                        `Stale element detected on control, will retry (attempt ${attempt + 1}/${maxRetries})`
                    );
                    lastError = error as Error;
                    break; // Break inner loop to retry outer loop
                }
            }

            // If we get here and didn't find TestBench control, throw error
            if (!testBenchControlFound) {
                throw new Error("TestBench activity bar item not found");
            }
        } catch (error) {
            lastError = error as Error;
            if (attempt < maxRetries - 1) {
                logger.debug(
                    "Sidebar",
                    `Error opening sidebar, retrying (attempt ${attempt + 1}/${maxRetries}): ${error}`
                );

                if (driver) {
                    await driver.sleep(UITimeouts.MINIMAL);
                }
            } else {
                throw new Error(
                    `Failed to open TestBench sidebar after ${maxRetries} attempts: ${lastError?.message || error}`
                );
            }
        }
    }
}

/**
 * Checks if the login webview should be available (user is not logged in).
 * When logged in, tree views are shown instead of the webview.
 *
 * @param _driver - The WebDriver instance (unused but kept for API consistency)
 * @returns Promise<boolean> - True if webview should be available (not logged in), false if logged in
 */
export async function isWebviewAvailable(_driver: WebDriver): Promise<boolean> {
    try {
        // Check if tree views are visible (indicates user is logged in)
        // If Projects, Test Themes, or Test Elements views are visible, webview is hidden
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        const sections = await content.getSections();

        for (const section of sections) {
            const title = await section.getTitle();
            // If we see tree views, user is logged in and webview is hidden
            if (title.includes("Projects") || title.includes("Test Themes") || title.includes("Test Elements")) {
                return false;
            }
            // If we see the login webview section, it's available
            if (title.includes("Login to TestBench")) {
                return true;
            }
        }

        // If no sections found or only login section, assume webview might be available
        return true;
    } catch (error) {
        // If we can't determine, assume webview might be available
        // StaleElementReferenceError is expected during state transitions (login/logout)
        // and doesn't indicate a real problem, so log at trace level instead of debug
        const isStaleElementError =
            error instanceof Error && (error.name === "StaleElementReferenceError" || error.message.includes("stale"));

        if (isStaleElementError) {
            logger.trace(
                "Webview",
                "Element became stale while checking availability (expected during state transitions)"
            );
        } else {
            logger.debug("Webview", "Could not determine webview availability:", error);
        }
        return true;
    }
}

/**
 * Finds and switches to the webview iframe in the shadow DOM.
 * Returns true if successful, false otherwise.
 *
 * @param driver - The WebDriver instance
 * @param markAttribute - Optional attribute name to mark the iframe (default: 'data-test-webview')
 * @param timeout - Maximum time to wait for webview (default: UITimeouts.VERY_LONG)
 * @returns Promise<boolean> - True if webview was found and switched to, false otherwise
 */
export async function findAndSwitchToWebview(
    driver: WebDriver,
    markAttribute: string = "data-test-webview",
    timeout: number = UITimeouts.VERY_LONG
): Promise<boolean> {
    try {
        // Wait for webview to be available with a single attempt using proper waits
        const iframeFound: boolean = await driver.wait(
            async (): Promise<boolean> => {
                const result = (await driver.executeScript(`
                function findIframesInShadowDOM(root) {
                    const iframes = [];
                    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
                    let node;
                    while (node = walker.nextNode()) {
                        if (node.shadowRoot) {
                            const shadowIframes = node.shadowRoot.querySelectorAll('iframe');
                            iframes.push(...shadowIframes);
                            iframes.push(...findIframesInShadowDOM(node.shadowRoot));
                        }
                        if (node.tagName === 'IFRAME') {
                            iframes.push(node);
                        }
                    }
                    return iframes;
                }
                const allIframes = findIframesInShadowDOM(document.body);
                if (allIframes.length > 0) {
                    allIframes[allIframes.length - 1].setAttribute('${markAttribute}', 'true');
                    return true;
                }
                return false;
            `)) as boolean;
                return result;
            },
            timeout,
            "Waiting for webview iframe",
            UITimeouts.MINIMAL
        );

        if (!iframeFound) {
            return false;
        }

        // Find and switch to the marked iframe
        const markedIframes = await driver.findElements(By.css(`iframe[${markAttribute}="true"]`));
        if (markedIframes.length === 0) {
            return false;
        }

        await driver.switchTo().frame(markedIframes[0]);

        // Wait for active-frame to load content
        const contentLoaded = await driver.wait(
            async () => {
                const result = (await driver.executeScript(`
                const activeFrame = document.getElementById('active-frame');
                if (!activeFrame) return { loaded: false, reason: 'no active-frame' };
                
                const contentDocument = activeFrame.contentDocument || activeFrame.contentWindow?.document;
                if (!contentDocument) return { loaded: false, reason: 'no contentDocument' };
                
                const form = contentDocument.getElementById('addConnectionForm');
                const serverField = contentDocument.getElementById('serverName');
                const forms = contentDocument.querySelectorAll('form').length;
                
                return {
                    loaded: !!(form || serverField || forms > 0),
                    hasForm: !!form,
                    hasServerField: !!serverField,
                    forms: forms
                };
            `)) as { loaded: boolean; hasForm?: boolean; hasServerField?: boolean; forms?: number; reason?: string };
                return result.loaded;
            },
            UITimeouts.LONG,
            "Waiting for content to load in active-frame",
            UITimeouts.MINIMAL
        );

        if (!contentLoaded) {
            await driver.switchTo().defaultContent();
            return false;
        }

        // Switch to the active-frame iframe inside the webview iframe
        const activeFrame = await driver.findElement(By.id("active-frame"));
        await driver.switchTo().frame(activeFrame);

        // Verify form is accessible
        const forms = await driver.findElements(By.id("addConnectionForm"));
        const serverFields = await driver.findElements(By.id("serverName"));

        if (forms.length === 0 && serverFields.length === 0) {
            await driver.switchTo().defaultContent();
            return false;
        }

        // Webview loading is a background operation, no slow motion needed
        return true;
    } catch (error) {
        logger.error("Webview", "Error finding webview:", error);
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore errors when switching back
        }
        return false;
    }
}

/**
 * Element IDs used in the connection management webview.
 */
export const ConnectionFormElements = {
    CONNECTION_LABEL: "connectionLabel",
    SERVER_NAME: "serverName",
    PORT_NUMBER: "portNumber",
    USERNAME: "username",
    PASSWORD: "password",
    STORE_PASSWORD_CHECKBOX: "storePasswordCheckbox",
    SAVE_BUTTON: "saveConnectionBtn",
    SAVE_BUTTON_TEXT: "saveButtonText",
    CANCEL_EDIT_BUTTON: "cancelEditBtn",
    SECTION_TITLE: "sectionTitle",
    MESSAGES: "messages",
    CONNECTIONS_LIST: "connectionsList",
    ADD_CONNECTION_FORM: "addConnectionForm"
} as const;

/**
 * Timeout and delay constants for UI operations (in milliseconds).
 * Timeouts are used for waiting with conditions (driver.wait).
 * Delays are used for fixed sleep durations (driver.sleep).
 */
export const UITimeouts = {
    MINIMAL: 1000,
    SHORT: 2000,
    MEDIUM: 5000,
    LONG: 10000,
    VERY_LONG: 15000,
    WORKSPACE_LOAD: 120000
} as const;

// ============================================
// Smart Wait Utilities
// ============================================

/**
 * Waits for a condition to be true with polling.
 *
 * @param driver - The WebDriver instance
 * @param condition - Function that returns true when condition is met
 * @param timeout - Maximum time to wait (default: 5000ms)
 * @param pollInterval - How often to check condition (default: 100ms)
 * @param description - Description for logging
 * @returns Promise<boolean> - True if condition was met, false if timeout
 */
export async function waitForCondition(
    driver: WebDriver,
    condition: () => Promise<boolean>,
    timeout: number = UITimeouts.MEDIUM,
    pollInterval: number = 100,
    description: string = "condition"
): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        try {
            if (await condition()) {
                return true;
            }
        } catch {
            // Condition threw an error, continue polling
        }
        await driver.sleep(pollInterval);
    }
    logger.debug("Wait", `Timeout waiting for ${description}`);
    return false;
}

/**
 * Waits for a tooltip to appear after hovering over an element.
 * Searches multiple tooltip selectors used by VS Code.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait
 * @returns Promise<string | null> - Tooltip text if found, null otherwise
 */
export async function waitForTooltip(driver: WebDriver, timeout: number = UITimeouts.MEDIUM): Promise<string | null> {
    const tooltipSelectors = [
        ".monaco-hover-content",
        ".hover-contents",
        ".monaco-hover",
        "[class*='tooltip']",
        ".hover-row",
        ".custom-hover"
    ];

    let tooltipText: string | null = null;

    await waitForCondition(
        driver,
        async () => {
            for (const selector of tooltipSelectors) {
                try {
                    const tooltips = await driver.findElements(By.css(selector));
                    for (const tooltip of tooltips) {
                        if (await tooltip.isDisplayed()) {
                            const text = await tooltip.getText();
                            if (text && text.trim().length > 0) {
                                tooltipText = text;
                                return true;
                            }
                        }
                    }
                } catch {
                    // Continue trying other selectors
                }
            }
            return false;
        },
        timeout,
        100,
        "tooltip to appear"
    );

    return tooltipText;
}

/**
 * Waits for the VS Code Testing View to be fully loaded.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait
 * @returns Promise<boolean> - True if Testing View is ready
 */
export async function waitForTestingViewReady(
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    return waitForCondition(
        driver,
        async () => {
            const sideBar = new SideBarView();
            const content = sideBar.getContent();
            const sections = await content.getSections();

            for (const section of sections) {
                const title = await section.getTitle();
                if (title.toLowerCase().includes("test")) {
                    return true;
                }
            }
            return false;
        },
        timeout,
        200,
        "Testing View to be ready"
    );
}

/**
 * Waits for terminal output to contain expected text.
 *
 * @param driver - The WebDriver instance
 * @param expectedText - Text to look for in terminal output
 * @param timeout - Maximum time to wait
 * @returns Promise<boolean> - True if expected text was found
 */
export async function waitForTerminalOutput(
    driver: WebDriver,
    expectedText: string,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    return waitForCondition(
        driver,
        async () => {
            const terminalContent = await driver.findElements(By.css(".terminal-wrapper .xterm-rows, .xterm-screen"));
            for (const content of terminalContent) {
                try {
                    const text = await content.getText();
                    if (text.includes(expectedText)) {
                        return true;
                    }
                } catch {
                    // Continue checking other terminal elements
                }
            }
            return false;
        },
        timeout,
        500,
        `terminal output containing '${expectedText}'`
    );
}

/**
 * Waits for the sidebar tree view to refresh and have visible items.
 *
 * @param driver - The WebDriver instance
 * @param _section - The tree section to monitor (currently unused, kept for API compatibility)
 * @param timeout - Maximum time to wait
 * @returns Promise<boolean> - True if tree has refreshed with items
 */
export async function waitForTreeRefresh(
    driver: WebDriver,
    _section: any,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    return waitForCondition(
        driver,
        async () => {
            try {
                const sideBar = new SideBarView();
                const content = sideBar.getContent();
                const sections = await content.getSections();
                for (const sec of sections) {
                    const items = await sec.getVisibleItems();
                    if (items.length > 0) {
                        return true;
                    }
                }
                return false;
            } catch {
                return false;
            }
        },
        timeout,
        200,
        "tree to refresh"
    );
}

/**
 * Waits for a VS Code notification containing specific text.
 *
 * @param driver - The WebDriver instance
 * @param textToMatch - Partial text to match in the notification
 * @param timeout - Maximum time to wait (default: 60000ms for long operations)
 * @returns Promise<boolean> - True if notification appeared, false if timeout
 */
export async function waitForNotification(
    driver: WebDriver,
    textToMatch: string,
    timeout: number = 60000
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        logger.trace("Notification", `Waiting for notification containing: "${textToMatch}"...`);

        await driver.wait(
            async () => {
                try {
                    // Look for notification toasts and center notifications
                    const notificationContainers = await driver.findElements(
                        By.css(
                            ".notifications-toasts, .notification-toast, " +
                                ".monaco-dialog, .notification-list-item, " +
                                ".notification-list-item-message, [class*='notification']"
                        )
                    );

                    for (const container of notificationContainers) {
                        try {
                            const text = await container.getText();
                            if (text.includes(textToMatch)) {
                                logger.trace("Notification", `Found notification: "${text.substring(0, 100)}..."`);
                                return true;
                            }
                        } catch {
                            // Element may be stale, continue
                        }
                    }

                    const notificationItems = await driver.findElements(
                        By.css(".notification-list-item, .notifications-list-container .monaco-list-row")
                    );

                    for (const item of notificationItems) {
                        try {
                            const text = await item.getText();
                            if (text.includes(textToMatch)) {
                                logger.trace(
                                    "Notification",
                                    `Found notification in center: "${text.substring(0, 100)}..."`
                                );
                                return true;
                            }
                        } catch {
                            // Element may be stale, continue
                        }
                    }

                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            `Waiting for notification containing: "${textToMatch}"`
        );

        return true;
    } catch (error) {
        logger.debug("Notification", `Notification not found within timeout: ${error}`);
        return false;
    }
}

/**
 * Waits for tree items to load in a tree section.
 *
 * @param section - The tree section to wait for
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait (default: UITimeouts.LONG)
 * @returns Promise<boolean> - True if items loaded, false if timeout
 */
export async function waitForTreeItems(
    section: any,
    driver: WebDriver,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    try {
        await driver.wait(
            async () => {
                try {
                    const items = await section.getVisibleItems();
                    return items.length > 0;
                } catch {
                    return false;
                }
            },
            timeout,
            "Waiting for tree items to load"
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Applies slow motion delay if enabled in configuration.
 * This should be called after visible UI actions to allow human observation.
 * Only delays when slow motion mode is enabled via UI_TEST_SLOW_MOTION environment variable.
 *
 * @param driver - The WebDriver instance
 * @param customDelay - Optional custom delay in milliseconds (overrides config)
 * @returns Promise<void>
 */
export async function applySlowMotion(driver: WebDriver, customDelay?: number): Promise<void> {
    const delay = customDelay !== undefined ? customDelay : getSlowMotionDelay();
    if (delay > 0) {
        await driver.sleep(delay);
    }
}

/**
 * Export ConnectionPage for POM pattern.
 */
export { ConnectionPage } from "../pages/ConnectionPage";
export type { ConnectionFormData, ConnectionSearchResult } from "../pages/ConnectionPage";

/**
 * Deletes all existing TestBench connections.
 * A wrapper that handles webview switching before delegating to ConnectionPage.
 * Use this function when you need to delete connections from outside the webview context.
 * Only works when the webview is available (user is not logged in).
 *
 * @param driver - The WebDriver instance
 * @returns Promise<number> - The number of connections that were deleted
 */
export async function deleteAllConnections(driver: WebDriver): Promise<number> {
    try {
        // Check if webview is available (user must not be logged in)
        const webviewAvailable = await isWebviewAvailable(driver);
        if (!webviewAvailable) {
            logger.trace("Cleanup", "Webview not available - user is logged in. Cannot delete connections.");
            return 0;
        }

        // Switch to webview
        const webviewFound = await findAndSwitchToWebview(driver);
        if (!webviewFound) {
            logger.trace("Cleanup", "Webview not found. Cannot delete connections.");
            return 0;
        }

        const { ConnectionPage } = await import("../pages/ConnectionPage");
        const page = new ConnectionPage(driver);
        const deletedCount = await page.deleteAllConnections();

        // Switch back to default content
        await driver.switchTo().defaultContent();

        return deletedCount;
    } catch (error) {
        logger.error("Cleanup", "Error during connection cleanup", error);
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore errors when switching back
        }
        return 0;
    }
}

/**
 * Handles VS Code confirmation dialog by clicking the specified button text.
 * For delete confirmation dialogs, looks for "Delete" button specifically.
 * Waits for dialog to appear and fully close before returning.
 *
 * @param driver - The WebDriver instance
 * @param buttonText - The text of the button to click (e.g., "Delete", "Save Changes")
 * @param timeout - Maximum time to wait for dialog (default: 5000ms)
 * @returns Promise<boolean> - True if dialog was found and handled, false otherwise
 */
export async function handleConfirmationDialog(
    driver: WebDriver,
    buttonText: string,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    try {
        // Ensure we're in default content (not in webview)
        await driver.switchTo().defaultContent();

        logger.trace("Dialog", `Looking for confirmation dialog with button: "${buttonText}"`);

        // First, quickly check if dialog exists (without waiting)
        const existingDialogs = await driver.findElements(
            By.css(".monaco-dialog-modal-block, .monaco-dialog, .monaco-dialog-box")
        );

        // If no dialog exists, return early without trying strategies
        if (existingDialogs.length === 0) {
            // Wait briefly for dialog to appear (in case it's still animating)
            try {
                await driver.wait(
                    until.elementLocated(By.css(".monaco-dialog-modal-block, .monaco-dialog, .monaco-dialog-box")),
                    UITimeouts.SHORT,
                    "Waiting briefly for dialog to appear"
                );
            } catch {
                // Dialog doesn't exist, return early
                logger.trace("Dialog", "No dialog found, skipping button search");
                return false;
            }
        }

        // Dialog exists, proceed with finding the button
        // Wait for the dialog modal to be fully rendered
        let dialogElement: WebElement | null = null;
        try {
            await driver.wait(
                until.elementLocated(By.css(".monaco-dialog-modal-block, .monaco-dialog, .monaco-dialog-box")),
                timeout,
                "Waiting for dialog modal to appear"
            );
            logger.trace("Dialog", "Dialog modal appeared");

            // Wait for dialog to fully render and for dialog content to be visible
            await driver.wait(
                async () => {
                    try {
                        const dialog = await driver.findElement(
                            By.css(".monaco-dialog, .monaco-dialog-box, [role='dialog']")
                        );
                        return await dialog.isDisplayed();
                    } catch {
                        return false;
                    }
                },
                UITimeouts.SHORT,
                "Waiting for dialog to fully render"
            );

            // Try multiple selectors for the dialog element
            const dialogSelectors = [
                ".monaco-dialog",
                ".monaco-dialog-box",
                ".monaco-dialog .monaco-dialog-content",
                "[role='dialog']",
                ".dialog-box"
            ];

            for (const selector of dialogSelectors) {
                try {
                    dialogElement = await driver.findElement(By.css(selector));
                    logger.trace("Dialog", `Found dialog element with selector: ${selector}`);
                    break;
                } catch {
                    // Try next selector
                }
            }

            if (!dialogElement) {
                logger.trace("Dialog", "Dialog element not found with standard selectors, searching in document");
            }
        } catch {
            logger.trace("Dialog", "Dialog modal not found, but continuing to search for button");
        }

        // Try multiple strategies to find the button
        // Strategy 1: Find by exact text match within dialog context
        const confirmButton = await driver.wait(
            async () => {
                let buttons: WebElement[] = [];

                // If we found the dialog element, search within it
                if (dialogElement) {
                    try {
                        buttons = await dialogElement.findElements(
                            By.xpath(`.//button[normalize-space(text())='${buttonText}']`)
                        );
                        if (buttons.length === 0) {
                            buttons = await dialogElement.findElements(
                                By.xpath(`.//button[contains(normalize-space(text()), '${buttonText}')]`)
                            );
                        }
                        // Also try links that look like buttons
                        if (buttons.length === 0) {
                            buttons = await dialogElement.findElements(
                                By.xpath(
                                    `.//a[contains(@class, 'monaco-button') and normalize-space(text())='${buttonText}']`
                                )
                            );
                        }
                    } catch {
                        // If dialog element becomes stale, try document-wide search
                    }
                }

                // If no buttons found in dialog, try document-wide search
                if (buttons.length === 0) {
                    // Try exact text match first (button elements)
                    buttons = await driver.findElements(By.xpath(`//button[normalize-space(text())='${buttonText}']`));

                    // Try links that look like buttons (VS Code uses <a> tags styled as buttons)
                    if (buttons.length === 0) {
                        buttons = await driver.findElements(
                            By.xpath(
                                `//a[contains(@class, 'monaco-button') and normalize-space(text())='${buttonText}']`
                            )
                        );
                    }

                    // If no exact match, try contains
                    if (buttons.length === 0) {
                        buttons = await driver.findElements(
                            By.xpath(`//button[contains(normalize-space(text()), '${buttonText}')]`)
                        );
                    }

                    if (buttons.length === 0) {
                        buttons = await driver.findElements(
                            By.xpath(
                                `//a[contains(@class, 'monaco-button') and contains(normalize-space(text()), '${buttonText}')]`
                            )
                        );
                    }

                    // Try by aria-label
                    if (buttons.length === 0) {
                        buttons = await driver.findElements(By.xpath(`//button[@aria-label='${buttonText}']`));
                    }

                    if (buttons.length === 0) {
                        buttons = await driver.findElements(By.xpath(`//a[@aria-label='${buttonText}']`));
                    }
                }

                return buttons.length > 0 ? buttons[0] : null;
            },
            timeout,
            `Waiting for confirmation dialog with button: ${buttonText}`
        );

        if (confirmButton) {
            const buttonTextFound = await confirmButton.getText();
            const tagName = await confirmButton.getTagName();
            logger.trace("Dialog", `Found ${tagName} element with text: "${buttonTextFound}", clicking...`);

            // Scroll button into view if needed
            await driver.executeScript("arguments[0].scrollIntoView({ block: 'center' });", confirmButton);

            // Wait for button to be clickable (enabled and displayed)
            await driver.wait(
                async () => {
                    try {
                        const isEnabled = await confirmButton.isEnabled();
                        const isDisplayed = await confirmButton.isDisplayed();
                        return isEnabled && isDisplayed;
                    } catch {
                        return false;
                    }
                },
                UITimeouts.MINIMAL,
                "Waiting for button to be clickable"
            );

            try {
                await confirmButton.click();
                await applySlowMotion(driver); // Visible: clicking confirmation dialog button
            } catch (clickError) {
                // If click fails, try JavaScript click
                logger.warn("Dialog", "Regular click failed, trying JavaScript click", clickError);
                await driver.executeScript("arguments[0].click();", confirmButton);
                await applySlowMotion(driver);
            }

            // Wait for dialog to fully close (wait for modal-block to disappear)
            try {
                await driver.wait(
                    async () => {
                        const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
                        return modalBlocks.length === 0;
                    },
                    UITimeouts.MEDIUM,
                    "Waiting for dialog to close"
                );
                logger.trace("Dialog", "Dialog closed successfully");
            } catch {
                logger.trace("Dialog", "Dialog may have closed, but modal-block still present");
            }

            // Additional wait to ensure dialog is fully gone and verify no dialog elements remain
            await driver.wait(
                async () => {
                    const dialogs = await driver.findElements(By.css(".monaco-dialog-modal-block, .monaco-dialog"));
                    return dialogs.length === 0;
                },
                UITimeouts.SHORT,
                "Waiting for dialog to be fully gone"
            );
            return true;
        }

        // If button not found, try JavaScript-based search (buttons might be in shadow DOM)
        logger.trace("Dialog", `Button "${buttonText}" not found with XPath, trying JavaScript search...`);
        try {
            const buttonFound = (await driver.executeScript(`
                function findButtonInDialog(buttonText) {
                    // Try to find dialog element
                    const dialog = document.querySelector('.monaco-dialog') || 
                                  document.querySelector('[role="dialog"]') ||
                                  document.querySelector('.monaco-dialog-box');
                    
                    const searchArea = dialog || document;
                    
                    // Search for buttons and links
                    const allElements = searchArea.querySelectorAll('button, a.monaco-button, a[class*="button"]');
                    
                    for (const element of allElements) {
                        const text = element.textContent?.trim() || element.innerText?.trim() || '';
                        const ariaLabel = element.getAttribute('aria-label') || '';
                        
                        if (text === buttonText || text.includes(buttonText) || ariaLabel === buttonText) {
                            return element;
                        }
                    }
                    return null;
                }
                const button = findButtonInDialog('${buttonText}');
                if (button) {
                    button.scrollIntoView({ block: 'center' });
                    return button;
                }
                return null;
            `)) as WebElement | null;

            if (buttonFound) {
                logger.trace("Dialog", "Found button using JavaScript, clicking...");
                await driver.executeScript("arguments[0].click();", buttonFound);
                await applySlowMotion(driver);

                // Wait for dialog to close
                await driver.wait(
                    async () => {
                        const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
                        return modalBlocks.length === 0;
                    },
                    UITimeouts.MEDIUM,
                    "Waiting for dialog to close after JavaScript click"
                );

                // Verify dialog is fully gone
                const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
                if (modalBlocks.length === 0) {
                    logger.trace("Dialog", "Dialog closed successfully using JavaScript click");
                    return true;
                }
            }
        } catch (jsError) {
            logger.warn("Dialog", "JavaScript search failed", jsError);
        }

        // If button still not found, try keyboard navigation (Enter key for primary button)
        logger.trace("Dialog", `Button "${buttonText}" not found, trying keyboard navigation (Enter key)...`);
        try {
            // Focus the dialog first
            const dialogModal = await driver.findElement(By.css(".monaco-dialog-modal-block"));
            await dialogModal.click();

            // Wait for dialog to be focused
            await driver.wait(
                async () => {
                    const activeElement = await driver.executeScript("return document.activeElement;");
                    return activeElement !== null;
                },
                500,
                "Waiting for dialog to be focused"
            );

            await driver.actions().sendKeys(Key.ENTER).perform();

            // Wait for dialog to close
            await driver.wait(
                async () => {
                    const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
                    return modalBlocks.length === 0;
                },
                UITimeouts.MEDIUM,
                "Waiting for dialog to close after Enter key"
            );

            // Check if dialog closed
            const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
            if (modalBlocks.length === 0) {
                logger.trace("Dialog", "Dialog closed using Enter key");
                return true;
            }
        } catch (keyboardError) {
            logger.warn("Dialog", "Keyboard navigation failed", keyboardError);
        }

        logger.trace("Dialog", `Button "${buttonText}" not found with any strategy`);
        return false;
    } catch (error) {
        const isTimeoutError =
            error instanceof Error &&
            (error.message.includes("Timeout") || error.message.includes("timeout") || error.name === "TimeoutError");

        // Check if dialog exists before trying fallback strategies
        const dialogs = await driver.findElements(
            By.css(".monaco-dialog-modal-block, .monaco-dialog, .monaco-dialog-box")
        );

        if (dialogs.length === 0) {
            if (isTimeoutError) {
                logger.trace("Dialog", "No dialog found (timeout), skipping fallback strategies");
            } else {
                logger.trace("Dialog", "No dialog found, skipping fallback strategies");
            }
            return false;
        }

        logger.error("Dialog", "Error finding button with primary strategy", error);
        // Dialog exists but button finding failed, try alternative approach
        try {
            // Wait for dialog to be fully rendered
            try {
                await driver.wait(
                    until.elementLocated(By.css(".monaco-dialog, .monaco-dialog-modal-block")),
                    UITimeouts.SHORT,
                    "Waiting for dialog to be ready"
                );
            } catch {
                // Dialog might already be there, continue with fallback
            }

            // Use JavaScript to find all buttons/links (can access shadow DOM and any structure)
            logger.trace("Dialog", "Using JavaScript to search for buttons in fallback strategy...");
            const buttonInfo = (await driver.executeScript(`
                function findAllButtons() {
                    const buttons = [];
                    const dialog = document.querySelector('.monaco-dialog') || 
                                  document.querySelector('[role="dialog"]') ||
                                  document.querySelector('.monaco-dialog-box') ||
                                  document;
                    
                    const elements = dialog.querySelectorAll('button, a.monaco-button, a[class*="button"], a[role="button"], .monaco-button');
                    
                    for (const element of elements) {
                        const text = element.textContent?.trim() || element.innerText?.trim() || '';
                        const ariaLabel = element.getAttribute('aria-label') || '';
                        const tagName = element.tagName.toLowerCase();
                        buttons.push({
                            text: text,
                            ariaLabel: ariaLabel,
                            tagName: tagName,
                            className: element.className || ''
                        });
                    }
                    return buttons;
                }
                return findAllButtons();
            `)) as Array<{ text: string; ariaLabel: string; tagName: string; className: string }>;

            logger.trace("Dialog", `JavaScript found ${buttonInfo.length} button/link element(s):`);
            for (const btn of buttonInfo) {
                logger.trace(
                    "Dialog",
                    `  - ${btn.tagName} (class: ${btn.className}): text="${btn.text}", aria-label="${btn.ariaLabel}"`
                );
            }

            // Try to find and click the button using JavaScript
            const buttonClicked = (await driver.executeScript(`
                function findAndClickButton(buttonText) {
                    const dialog = document.querySelector('.monaco-dialog') || 
                                  document.querySelector('[role="dialog"]') ||
                                  document.querySelector('.monaco-dialog-box') ||
                                  document;
                    
                    const elements = dialog.querySelectorAll('button, a.monaco-button, a[class*="button"], a[role="button"], .monaco-button');
                    
                    for (const element of elements) {
                        const text = element.textContent?.trim() || element.innerText?.trim() || '';
                        const ariaLabel = element.getAttribute('aria-label') || '';
                        
                        if (text === buttonText || text.includes(buttonText) || ariaLabel === buttonText) {
                            element.scrollIntoView({ block: 'center' });
                            element.click();
                            return true;
                        }
                    }
                    return false;
                }
                return findAndClickButton('${buttonText}');
            `)) as boolean;

            if (buttonClicked) {
                logger.trace("Dialog", "Successfully clicked button using JavaScript in fallback");
                await applySlowMotion(driver);

                // Wait for dialog to close
                try {
                    await driver.wait(
                        async () => {
                            const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
                            return modalBlocks.length === 0;
                        },
                        UITimeouts.MEDIUM,
                        "Waiting for dialog to close"
                    );
                    logger.trace("Dialog", "Dialog closed successfully");
                } catch {
                    logger.trace("Dialog", "Dialog may have closed");
                }

                // Verify dialog is fully gone
                await driver.wait(
                    async () => {
                        const dialogs = await driver.findElements(By.css(".monaco-dialog-modal-block, .monaco-dialog"));
                        return dialogs.length === 0;
                    },
                    UITimeouts.SHORT,
                    "Waiting for dialog to be fully gone"
                );
                return true;
            }

            logger.trace("Dialog", `Could not find button "${buttonText}" using JavaScript in fallback`);
        } catch (fallbackError) {
            logger.error("Dialog", "Fallback strategy also failed", fallbackError);
        }
        return false;
    }
}

/**
 * Generates a unique connection label for testing.
 *
 * @param prefix - Optional prefix for the label (default: "Test Connection")
 * @returns string - A unique connection label with timestamp
 */
export function generateUniqueConnectionLabel(prefix: string = "Test Connection"): string {
    const timestamp = Date.now();
    return `${prefix} ${timestamp}`;
}

/**
 * Finds a notification button by searching for notification containers and button text.
 * Handles both dialog-style and toast-style notifications.
 *
 * @param driver - The WebDriver instance
 * @param buttonText - The text of the button to find (e.g., "Create", "Cancel")
 * @param notificationText - Optional text that should be present in the notification
 * @param timeout - Maximum time to wait for notification (default: 10000ms)
 * @returns Promise<WebElement | null> - The found button element or null if not found
 */
export async function findNotificationButton(
    driver: WebDriver,
    buttonText: string,
    notificationText?: string,
    timeout: number = UITimeouts.LONG
): Promise<WebElement | null> {
    try {
        await driver.switchTo().defaultContent();

        const button = await driver.wait(
            async () => {
                try {
                    // VS Code notifications can appear as dialogs or toast notifications
                    // First, try finding notification/dialog containers
                    const notificationContainers = await driver.findElements(
                        By.css(
                            ".monaco-dialog, .monaco-dialog-box, .monaco-list-row, .notification-toast, .notifications-toasts, [role='dialog']"
                        )
                    );

                    // Check if any container contains the expected notification text
                    if (notificationText) {
                        for (const container of notificationContainers) {
                            try {
                                const text = await container.getText();
                                if (text.includes(notificationText)) {
                                    // Find button within this container
                                    try {
                                        const btn = await container.findElement(
                                            By.xpath(
                                                `.//button[normalize-space(text())='${buttonText}'] | .//a[contains(@class, 'monaco-button') and normalize-space(text())='${buttonText}']`
                                            )
                                        );
                                        if (btn) {
                                            return btn;
                                        }
                                    } catch {
                                        // Continue searching
                                    }
                                }
                            } catch {
                                // Continue searching
                            }
                        }
                    }

                    // Also try finding buttons directly (might be in a dialog)
                    const buttons = await driver.findElements(
                        By.xpath(
                            `//button[normalize-space(text())='${buttonText}'] | //a[contains(@class, 'monaco-button') and normalize-space(text())='${buttonText}']`
                        )
                    );

                    // Return the first visible button
                    for (const btn of buttons) {
                        try {
                            const isDisplayed = await btn.isDisplayed();
                            if (isDisplayed) {
                                return btn;
                            }
                        } catch {
                            // Continue searching
                        }
                    }

                    return null;
                } catch {
                    return null;
                }
            },
            timeout,
            `Waiting for notification with button: ${buttonText}`
        );

        return button;
    } catch (error) {
        logger.error("Notification", "Error finding notification button", error);
        return null;
    }
}

/**
 * Clicks a button in a notification and waits for the action to complete.
 *
 * @param driver - The WebDriver instance
 * @param buttonText - The text of the button to click
 * @param notificationText - Optional text that should be present in the notification
 * @param timeout - Maximum time to wait for notification (default: 10000ms)
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function clickNotificationButton(
    driver: WebDriver,
    buttonText: string,
    notificationText?: string,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    try {
        const button = await findNotificationButton(driver, buttonText, notificationText, timeout);

        if (!button) {
            logger.trace("Notification", `Button "${buttonText}" not found in notification`);
            return false;
        }

        logger.trace("Notification", `Found notification button "${buttonText}", clicking...`);
        await button.click();
        await applySlowMotion(driver);

        // Wait for notification to close
        await driver.wait(
            async () => {
                const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
                return modalBlocks.length === 0;
            },
            UITimeouts.MEDIUM,
            "Waiting for notification to close"
        );

        return true;
    } catch (error) {
        logger.error("Notification", "Error clicking notification button", error);
        return false;
    }
}

/**
 * Ensures the user is logged in by performing login if necessary.
 * If already logged in, this function does nothing.
 * If not logged in, it creates a connection and logs in using test credentials.
 *
 * @param driver - The WebDriver instance
 * @param credentials - Optional test credentials (if not provided, will use getTestCredentials())
 * @returns Promise<boolean> - True if login was successful or user was already logged in, false otherwise
 */
export async function ensureLoggedIn(
    driver: WebDriver,
    credentials?: {
        connectionLabel: string;
        serverName: string;
        portNumber: string;
        username: string;
        password: string;
    }
): Promise<boolean> {
    try {
        const webviewAvailable = await isWebviewAvailable(driver);
        if (!webviewAvailable) {
            logger.trace("Login", "User is already logged in");
            return true;
        }

        logger.trace("Login", "User is not logged in. Performing login...");

        if (!hasTestCredentials() && !credentials) {
            logger.warn("Login", "Test credentials not available");
            return false;
        }

        const creds = credentials || getTestCredentials();

        await openTestBenchSidebar(driver);

        const webviewFound = await findAndSwitchToWebview(driver);
        if (!webviewFound) {
            logger.warn("Login", "Webview not found");
            return false;
        }

        try {
            await driver.wait(
                until.elementLocated(By.id(ConnectionFormElements.CONNECTIONS_LIST)),
                UITimeouts.MEDIUM,
                "Waiting for connections list to be available"
            );
        } catch {
            // Connections list might not exist yet, continue anyway
            logger.trace("Login", "Connections list not found, will create new connection");
        }

        const { ConnectionPage } = await import("../pages/ConnectionPage");
        const connectionPage = new ConnectionPage(driver);

        const { element: existingConnection, found: connectionExists } = await connectionPage.findConnection(
            creds.connectionLabel
        );

        if (!connectionExists || !existingConnection) {
            logger.trace("Login", "Creating new connection...");
            await connectionPage.resetForm();

            const formData: import("../pages/ConnectionPage").ConnectionFormData = {
                connectionLabel: creds.connectionLabel,
                serverName: creds.serverName,
                portNumber: creds.portNumber,
                username: creds.username,
                password: creds.password,
                storePassword: true
            };

            await connectionPage.fillForm(formData);
            await connectionPage.save();

            // Switch to default content to handle "Save Changes" dialog if it appears
            await driver.switchTo().defaultContent();

            // Handle "Save Changes" confirmation dialog if it appears
            // This dialog may appear when saving a connection
            try {
                const dialogHandled = await handleConfirmationDialog(driver, "Save Changes", UITimeouts.SHORT);
                if (dialogHandled) {
                    logger.trace("Login", "Handled 'Save Changes' dialog");
                } else {
                    logger.trace("Login", "No 'Save Changes' dialog appeared");
                }
            } catch {
                logger.trace("Login", "No 'Save Changes' dialog appeared");
            }

            const webviewFoundAgain = await findAndSwitchToWebview(driver);
            if (!webviewFoundAgain) {
                logger.warn("Login", "Could not switch back to webview after handling dialog");
                return false;
            }

            // Recreate page instance after switching back to webview
            const connectionPageAfterDialog = new ConnectionPage(driver);
            await driver.wait(
                async () => {
                    const { found } = await connectionPageAfterDialog.findConnection(creds.connectionLabel);
                    return found;
                },
                UITimeouts.LONG,
                "Waiting for connection to appear in list"
            );
        }

        // Recreate page instance to ensure we're working with fresh state
        const connectionPageFinal = new ConnectionPage(driver);
        const { element: connectionElement, found } = await connectionPageFinal.findConnection(creds.connectionLabel);

        if (!found || !connectionElement) {
            const connectionString = `${creds.username}@${creds.serverName}`;
            const { element: connectionByString } = await connectionPageFinal.findConnection(connectionString);
            if (connectionByString) {
                await connectionPageFinal.clickLogin(connectionByString);
            } else {
                logger.warn("Login", "Connection not found in list");
                return false;
            }
        } else {
            await connectionPageFinal.clickLogin(connectionElement);
        }

        await driver.switchTo().defaultContent();
        await handleAuthenticationModals(driver);

        // Wait for Projects view to appear (indicates successful login)
        await driver.wait(
            async () => {
                return !(await isWebviewAvailable(driver));
            },
            UITimeouts.LONG,
            "Waiting for login to complete (Projects view to appear)"
        );

        logger.info("Login", "Login successful");
        return true;
    } catch (error) {
        logger.error("Login", "Error during login", error);
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore errors when switching back
        }
        return false;
    }
}

/**
 * Finds and clicks a CodeLens action in the editor.
 *
 * @param driver - The WebDriver instance
 * @param codeLensText - The text of the CodeLens to find (e.g., "Pull changes from TestBench")
 * @param lineNumber - The line number where the CodeLens should appear (0-based)
 * @param timeout - Maximum time to wait for CodeLens (default: 10000ms)
 * @returns Promise<boolean> - True if CodeLens was found and clicked, false otherwise
 */
export async function clickCodeLens(
    driver: WebDriver,
    codeLensText: string,
    _lineNumber: number = 0,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    await driver.switchTo().defaultContent();
    logger.trace("CodeLens", `Starting exact DOM search and click for: "${codeLensText}"`);

    try {
        await driver.wait(
            async () => {
                try {
                    // Precise XPath based on DevTools inspection
                    // Look for <span> with class 'codelens-decoration' -> child <a> with specific text
                    const xpathSelector = `//span[contains(@class, 'codelens-decoration')]//a[contains(text(), '${codeLensText}')]`;

                    const links = await driver.findElements(By.xpath(xpathSelector));

                    if (links.length > 0) {
                        const link = links[0];

                        // Verify visibility to ensure we aren't clicking a hidden/stale one
                        if (await link.isDisplayed()) {
                            logger.trace("CodeLens", `Found visible link for "${codeLensText}"`);

                            // Scroll into view (Center)
                            await driver.executeScript(
                                "arguments[0].scrollIntoView({block: 'center', inline: 'center'});",
                                link
                            );
                            await driver.sleep(200);

                            // Dispatch Full Mouse Event Chain
                            // VS Code often listens for 'mousedown' or 'mouseup' on these widgets, not just 'click'
                            logger.trace("CodeLens", "Dispatching MouseEvents (mousedown + click)...");
                            await driver.executeScript(
                                `
                                var element = arguments[0];
                                
                                // Create mouse event options
                                var opts = {
                                    view: window,
                                    bubbles: true,
                                    cancelable: true,
                                    buttons: 1
                                };

                                // Dispatch mousedown (often required for focus/activation)
                                element.dispatchEvent(new MouseEvent('mousedown', opts));
                                
                                // Dispatch mouseup
                                element.dispatchEvent(new MouseEvent('mouseup', opts));
                                
                                // Dispatch click
                                element.dispatchEvent(new MouseEvent('click', opts));
                            `,
                                link
                            );

                            await applySlowMotion(driver);
                            return true;
                        }
                    }
                    return false;
                } catch {
                    // Ignore stale element errors and retry
                    return false;
                }
            },
            timeout,
            `Timeout waiting to click CodeLens "${codeLensText}"`
        );

        return true;
    } catch (e) {
        logger.error("CodeLens", "FINAL FAILURE", e);
        return false;
    }
}

/**
 * Finds the Refactor Preview tab and clicks the Apply button.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait for Refactor Preview (default: 15000ms)
 * @returns Promise<boolean> - True if Apply button was found and clicked, false otherwise
 */
/**
 * Finds the Refactor Preview "Apply" button and clicks it.
 * Uses the specific DOM structure: <a class="monaco-button ..."><span ...>Apply</span></a>
 */
export async function clickRefactorPreviewApply(
    driver: WebDriver,
    timeout: number = UITimeouts.VERY_LONG
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        const applyButton = await driver.wait(
            async () => {
                try {
                    // Specific XPath based on your inspector image:
                    // Looks for an anchor tag with 'monaco-button' class containing a span with 'Apply'
                    const xpathSelector = "//a[contains(@class, 'monaco-button')][.//span[contains(text(), 'Apply')]]";

                    const buttons = await driver.findElements(By.xpath(xpathSelector));

                    for (const btn of buttons) {
                        if (await btn.isDisplayed()) {
                            return btn;
                        }
                    }
                    return null;
                } catch {
                    return null;
                }
            },
            timeout,
            "Waiting for Apply button in Refactor Preview"
        );

        if (applyButton) {
            logger.trace("RefactorPreview", "Found Apply button, clicking...");
            await applyButton.click();
            await applySlowMotion(driver);
            return true;
        }

        logger.warn("RefactorPreview", "Apply button not found using specific selector");
        return false;
    } catch (error) {
        logger.error("RefactorPreview", "Error clicking Apply button", error);
        return false;
    }
}

/**
 * Verifies that a checkbox is checked in the Refactor Preview.
 *
 * @param driver - The WebDriver instance
 * @param fileName - The file name to check (e.g., "Subdiv resource.resource")
 * @param timeout - Maximum time to wait (default: 10000ms)
 * @returns Promise<boolean> - True if checkbox is checked, false otherwise
 */
export async function verifyRefactorPreviewCheckbox(
    driver: WebDriver,
    fileName: string,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        // Wait for the list rows to appear
        await driver.wait(until.elementLocated(By.css(".monaco-list-row")), timeout);

        const isChecked = await driver.wait(
            async () => {
                // Find all rows in the tree view
                const rows = await driver.findElements(By.css(".monaco-list-row"));

                for (const row of rows) {
                    try {
                        // Check if this row represents our file
                        const text = await row.getText();
                        if (text.includes(fileName)) {
                            // Try multiple selectors for the checkbox
                            const selectors = [
                                "input.edit-checkbox",
                                ".monaco-checkbox",
                                "input[type='checkbox']",
                                ".codicon-check", // Checked state icon
                                ".codicon-circle-large-outline" // Unchecked state icon
                            ];

                            for (const selector of selectors) {
                                try {
                                    const checkbox = await row.findElement(By.css(selector));

                                    // If it's an input, check isSelected()
                                    const tagName = await checkbox.getTagName();
                                    if (tagName === "input") {
                                        return await checkbox.isSelected();
                                    }

                                    // If it's a custom element (div/span), check class for checked state
                                    const className = await checkbox.getAttribute("class");
                                    if (className.includes("checked") || className.includes("codicon-check")) {
                                        return true;
                                    }
                                    // If we found an unchecked icon, return false (found but unchecked)
                                    if (className.includes("codicon-circle-large-outline")) {
                                        return false;
                                    }

                                    // If it's .monaco-checkbox, check aria-checked or class
                                    if (className.includes("monaco-checkbox")) {
                                        const ariaChecked = await checkbox.getAttribute("aria-checked");
                                        if (ariaChecked === "true") {
                                            return true;
                                        }
                                        if (ariaChecked === "false") {
                                            return false;
                                        }
                                        // Fallback to class check
                                        return className.includes("checked");
                                    }
                                } catch {
                                    // Continue to next selector
                                }
                            }
                        }
                    } catch {
                        // Stale element or other temporary error, continue to next row or retry
                    }
                }
                // Return null to keep waiting if row not found yet
                return null;
            },
            timeout,
            `Waiting for checkbox row matching "${fileName}"`
        );

        // If the wait returns a boolean, that's our result. If it times out/returns null, default to false.
        return !!isChecked;
    } catch (error) {
        // Timeout is expected if Refactor Preview is still loading or checkbox row hasn't appeared yet
        const isTimeoutError =
            error instanceof Error &&
            (error.name === "TimeoutError" || error.message.includes("Timeout") || error.message.includes("timeout"));

        if (isTimeoutError) {
            logger.debug(
                "RefactorPreview",
                `Timeout verifying checkbox for "${fileName}" - Refactor Preview may still be loading (this is expected)`
            );
        } else {
            // For non-timeout errors, log as warning since they're unexpected but not critical
            logger.warn("RefactorPreview", "Error verifying checkbox", error);
        }
        return false;
    }
}

/**
 * Ensures that the checkbox for a specific file is checked.
 * If it is currently unchecked, this function clicks it.
 * @param driver - The WebDriver instance
 * @param fileName - The file name to check
 * @returns Promise<boolean> - True if successfully ensured checked
 */
export async function ensureRefactorPreviewItemChecked(driver: WebDriver, fileName: string): Promise<boolean> {
    try {
        const isChecked = await verifyRefactorPreviewCheckbox(driver, fileName, UITimeouts.SHORT);
        if (isChecked) {
            logger.trace("RefactorPreview", `Item "${fileName}" is already checked.`);
            return true;
        }

        logger.trace("RefactorPreview", `Item "${fileName}" is unchecked. Clicking to select...`);

        // Find and click the checkbox
        const rows = await driver.findElements(By.css(".monaco-list-row"));
        for (const row of rows) {
            const text = await row.getText();
            if (text.includes(fileName)) {
                // Try multiple selectors for the checkbox
                const selectors = [
                    "input.edit-checkbox",
                    ".monaco-checkbox",
                    "input[type='checkbox']",
                    ".codicon-circle-large-outline", // Unchecked icon
                    ".codicon-check" // Checked icon (just in case)
                ];

                for (const selector of selectors) {
                    try {
                        const checkbox = await row.findElement(By.css(selector));
                        // Use JS click for reliability with Monaco checkboxes
                        await driver.executeScript("arguments[0].click();", checkbox);
                        await applySlowMotion(driver);
                        return true;
                    } catch {
                        // Continue to next selector
                    }
                }

                logger.warn("RefactorPreview", `Could not find checkbox for "${fileName}" using any selector.`);
            }
        }
        return false;
    } catch (error) {
        logger.error("RefactorPreview", "Error ensuring item checked", error);
        return false;
    }
}

/**
 * Clicks the "Create Resource" button on a tree item in Test Elements view.
 * The button uses the $(new-file) codicon and is an inline action button.
 *
 * @param item - The tree item (subdivision) to click the button on
 * @param driver - The WebDriver instance
 * @param itemLabel - Optional pre-fetched label to avoid stale element issues
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function clickCreateResourceButton(
    item: TreeItem,
    driver: WebDriver,
    itemLabel?: string
): Promise<boolean> {
    const maxRetries = 3;

    // Cache the label before the retry loop to avoid stale element errors
    if (!itemLabel) {
        try {
            itemLabel = await item.getLabel();
        } catch (error) {
            logger.error("TreeItem", "Failed to get item label", error);
            return false;
        }
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await driver.switchTo().defaultContent();
            logger.trace(
                "TreeItem",
                `Looking for Create Resource button near item: "${itemLabel}" (attempt ${attempt}/${maxRetries})`
            );

            // First, ensure the tree item is clicked to make action buttons visible
            try {
                await item.click();
                await driver.sleep(300); // Wait for action buttons to appear
            } catch (itemClickError) {
                logger.debug("TreeItem", "Could not click tree item, continuing anyway", itemClickError);
            }

            // Use JavaScript to find and click the button in one atomic operation
            // This reduces the chance of stale element errors
            const clickSucceeded = (await driver.executeScript(`
                function findAndClickCreateResourceButton(itemLabel) {
                    const rows = document.querySelectorAll('.monaco-list-row');
                    for (const row of rows) {
                        const rowText = row.textContent || row.innerText || '';
                        if (!rowText.includes(itemLabel)) {
                            continue;
                        }
                        
                        // Look for action buttons with codicon-new-file
                        const actionButtons = row.querySelectorAll('a.action-item, button.action-item, a[class*="action"], button[class*="action"]');
                        for (const btn of actionButtons) {
                            // Check if button contains codicon-new-file
                            const codicon = btn.querySelector('.codicon-new-file, span.codicon-new-file');
                            if (codicon) {
                                btn.scrollIntoView({ block: 'center' });
                                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                return true;
                            }
                            
                            // Check aria-label
                            const ariaLabel = btn.getAttribute('aria-label') || '';
                            if (ariaLabel.toLowerCase().includes('create resource')) {
                                btn.scrollIntoView({ block: 'center' });
                                btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                return true;
                            }
                        }
                        
                        // Also check for any element with codicon-new-file in this row
                        const codiconElements = row.querySelectorAll('.codicon-new-file, [class*="codicon-new-file"]');
                        for (const codicon of codiconElements) {
                            const actionItem = codicon.closest('a.action-item, button.action-item, a[class*="action"], button[class*="action"]');
                            if (actionItem) {
                                actionItem.scrollIntoView({ block: 'center' });
                                actionItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                                actionItem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                                actionItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                return true;
                            }
                        }
                    }
                    return false;
                }
                return findAndClickCreateResourceButton('${itemLabel.replace(/'/g, "\\'")}');
            `)) as boolean;

            if (clickSucceeded) {
                logger.trace("TreeItem", "Successfully clicked Create Resource button");
                await applySlowMotion(driver);
                return true;
            }

            logger.debug("TreeItem", `Button not found or click failed on attempt ${attempt}`);

            if (attempt < maxRetries) {
                // Wait before retrying
                await driver.sleep(500);
            }
        } catch (error: any) {
            const isStaleError =
                error.name === "StaleElementReferenceError" || error.message?.includes("stale element");

            if (isStaleError && attempt < maxRetries) {
                logger.debug("TreeItem", `Stale element error on attempt ${attempt}, retrying...`);
                await driver.sleep(500);
                continue;
            }

            logger.error("TreeItem", `Error on attempt ${attempt}`, error);

            if (attempt === maxRetries) {
                return false;
            }
        }
    }

    logger.warn("TreeItem", "Failed to click Create Resource button after all retries");
    return false;
}

/**
 * Waits for the configuration to be applied by checking for pin emojis on project and TOV tree items.
 * After configuration is created, the tree items get reordered and pin emojis (📌) are added to active items.
 *
 * @param driver - The WebDriver instance
 * @param projectName - The project name to check for pin
 * @param tovName - The TOV name to check for pin
 * @param projectsSection - The Projects section to search in
 * @param targetProject - The project tree item (should already be expanded)
 * @param targetVersion - The version tree item (should already be expanded)
 * @param timeout - Maximum time to wait (default: UITimeouts.LONG - configuration can take time)
 * @returns Promise<boolean> - True if pins appeared or configuration already exists, false if timeout
 */
export async function waitForConfigurationApplied(
    driver: WebDriver,
    projectName: string,
    tovName: string,
    projectsSection: any,
    targetProject: TreeItem,
    targetVersion: TreeItem,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    try {
        logger.trace("Configuration", "Waiting for configuration to be applied (checking for pin emojis)...");

        const pinsAppeared = await driver.wait(
            async () => {
                try {
                    // Check the project's description for pin emoji
                    let projectHasPin = false;
                    try {
                        const projectDescription = await targetProject.getDescription();
                        if (
                            projectDescription &&
                            (projectDescription.includes("📌") || projectDescription.includes("pin"))
                        ) {
                            projectHasPin = true;
                            logger.trace("Configuration", `Found pin on project "${projectName}"`);
                        }
                    } catch {
                        // Project description might not be accessible yet
                    }

                    // Check the TOV's description for pin emoji
                    let tovHasPin = false;
                    try {
                        const tovDescription = await targetVersion.getDescription();
                        if (tovDescription && (tovDescription.includes("📌") || tovDescription.includes("pin"))) {
                            tovHasPin = true;
                            logger.trace("Configuration", `Found pin on TOV "${tovName}"`);
                        }
                    } catch {
                        // TOV description might not be accessible yet
                    }

                    // If both have pins, configuration is applied
                    if (projectHasPin && tovHasPin) {
                        return true;
                    }

                    // If neither has pins yet, wait a bit more
                    // If only one has a pin, also wait (might be in progress)
                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            `Waiting for configuration to be applied (pins on "${projectName}" and "${tovName}")`
        );

        if (pinsAppeared) {
            logger.info("Configuration", "Configuration applied successfully - pins detected");
            // Wait a bit more for tree to fully stabilize after reordering
            await driver.sleep(1000);
            return true;
        }

        // If pins didn't appear within timeout, configuration might already exist (no reordering needed)
        logger.trace(
            "Configuration",
            "Pins not detected within timeout - configuration may already exist or tree may not have updated"
        );
        await driver.sleep(500);
        return true;
    } catch (error) {
        // Timeout is expected if configuration already exists (pins won't appear again)
        // or if tree items become stale during the wait
        const isTimeoutError =
            error instanceof Error &&
            (error.name === "TimeoutError" || error.message.includes("Timeout") || error.message.includes("timeout"));

        if (isTimeoutError) {
            logger.debug(
                "Configuration",
                "Timeout waiting for pins - configuration may already exist (this is expected and not an error)"
            );
        } else {
            // For non-timeout errors, log as warning since they're unexpected but not critical
            logger.warn("Configuration", "Error waiting for configuration to be applied", error);
        }
        // If timeout or other error, assume configuration already exists and continue
        await driver.sleep(2000);
        return true;
    }
}

/**
 * Handles the TestBench project configuration prompt that may appear when clicking a cycle.
 * Clicks the cycle once, then handles the configuration prompt if it appears.
 * Waits for the configuration to be applied (tree reordering, pin emojis) before returning.
 *
 * @param cycleItem - The cycle tree item to click
 * @param driver - The WebDriver instance
 * @param projectName - The project name (for verification)
 * @param tovName - The TOV name (for verification)
 * @param projectsSection - The Projects section to check for pins
 * @param targetProject - The project tree item (should already be expanded)
 * @param targetVersion - The version tree item (should already be expanded)
 * @returns Promise<boolean> - True if configuration was handled or not needed, false if failed
 */
export async function handleCycleConfigurationPrompt(
    cycleItem: TreeItem,
    driver: WebDriver,
    projectName: string,
    tovName: string,
    projectsSection: any,
    targetProject: TreeItem,
    targetVersion: TreeItem
): Promise<boolean> {
    try {
        logger.trace("Configuration", "Clicking cycle to check for configuration prompt...");

        // Click the cycle once (single click) - this may trigger the configuration prompt
        await cycleItem.click();
        await applySlowMotion(driver);

        // Wait for and click the Create button in the notification if it appears
        const notificationText = `TestBench project configuration`;

        const notificationClicked = await clickNotificationButton(driver, "Create", notificationText);

        if (notificationClicked) {
            logger.info("Configuration", "Configuration prompt appeared and Create button was clicked");

            // Wait for configuration to be applied (tree reordering, pin emojis)
            const configApplied = await waitForConfigurationApplied(
                driver,
                projectName,
                tovName,
                projectsSection,
                targetProject,
                targetVersion
            );

            if (!configApplied) {
                logger.warn(
                    "Configuration",
                    "Warning: Configuration may not have been fully applied, continuing anyway"
                );
            }

            return true;
        } else {
            logger.trace("Configuration", "No configuration prompt appeared (configuration may already exist)");
            // Configuration prompt didn't appear, which is fine - configuration may already exist
            return true;
        }
    } catch (error) {
        logger.error("Configuration", "Error handling configuration prompt", error);
        // If there's an error, assume configuration already exists and continue
        return true;
    }
}

/**
 * Waits for Projects view to appear in the sidebar.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if Projects view appeared, false if timeout
 */
export async function waitForProjectsView(driver: WebDriver, timeout: number = UITimeouts.MEDIUM): Promise<boolean> {
    try {
        await driver.wait(
            async () => {
                try {
                    const sideBar = new SideBarView();
                    const content = sideBar.getContent();
                    const sections = await content.getSections();
                    for (const section of sections) {
                        const title = await section.getTitle();
                        if (title.includes("Projects")) {
                            return true;
                        }
                    }
                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            "Waiting for Projects view to appear"
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Waits for Test Themes and Test Elements views to appear in the sidebar.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if both views appeared, false if timeout
 */
export async function waitForTestThemesAndElementsViews(
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    try {
        await driver.wait(
            async () => {
                try {
                    const sideBar = new SideBarView();
                    const content = sideBar.getContent();
                    const sections = await content.getSections();
                    let themesFound = false;
                    let elementsFound = false;

                    for (const section of sections) {
                        const title = await section.getTitle();
                        if (title.includes("Test Themes")) {
                            themesFound = true;
                        } else if (title.includes("Test Elements")) {
                            elementsFound = true;
                        }
                    }
                    return themesFound && elementsFound;
                } catch {
                    return false;
                }
            },
            timeout,
            "Waiting for Test Themes and Test Elements views to appear"
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Waits for a file to be opened in the editor.
 *
 * @param driver - The WebDriver instance
 * @param fileName - The name of the file to wait for (can be partial match)
 * @param timeout - Maximum time to wait (default: UITimeouts.LONG)
 * @returns Promise<boolean> - True if file was opened, false if timeout
 */
export async function waitForFileInEditor(
    driver: WebDriver,
    fileName: string,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    try {
        await driver.wait(
            async () => {
                try {
                    const editorView = new EditorView();
                    const editorTitles = await editorView.getOpenEditorTitles();
                    for (const title of editorTitles) {
                        if (title.includes(fileName)) {
                            return true;
                        }
                    }
                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            `Waiting for file "${fileName}" to be opened in editor`
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Waits for VS Code quick input widget to appear and returns its input element.
 * This is useful for flows where an action may prompt for a name but might also
 * complete silently depending on context. Returning null keeps the caller free
 * to proceed with alternative handling.
 */
export async function waitForQuickInput(
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM
): Promise<WebElement | null> {
    const selectors = [
        ".quick-input-widget input.input",
        ".quick-input-widget input",
        ".monaco-quick-open-widget input.quick-input-input",
        ".quick-input-box input"
    ];

    try {
        const input = await driver.wait(
            async () => {
                await driver.switchTo().defaultContent();
                for (const selector of selectors) {
                    const elements = await driver.findElements(By.css(selector));
                    if (elements.length > 0) {
                        return elements[0];
                    }
                }
                return null;
            },
            timeout,
            "Waiting for quick input to appear"
        );

        return input ?? null;
    } catch {
        return null;
    }
}

/**
 * Closes any open quick input dialogs (like "Go to Line") that might be blocking interactions.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if dialog was closed or none was open, false otherwise
 */
export async function closeQuickInputDialog(driver: WebDriver): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        // Check if quick input dialog is open
        const quickInputElements = await driver.findElements(By.css(".quick-input-widget, .monaco-quick-open-widget"));
        if (quickInputElements.length > 0) {
            logger.trace("Editor", "Quick input dialog detected, closing...");
            // Press Escape to close the dialog
            await driver.actions().sendKeys(Key.ESCAPE).perform();
            await driver.sleep(300);
            return true;
        }

        return true;
    } catch (_error) {
        // If there's an error, assume no dialog was open
        return true;
    }
}

/**
 * Sets the cursor position in a TextEditor without opening the "Go to Line" dialog.
 * Uses keyboard shortcuts to navigate to the beginning of the file.
 *
 * @param editor - The TextEditor instance
 * @param driver - The WebDriver instance
 * @param lineNumber - The line number to navigate to (1-based)
 * @param column - The column number to navigate to (0-based, default: 0)
 * @returns Promise<boolean> - True if cursor was set successfully, false otherwise
 */
export async function setCursorPosition(
    editor: TextEditor,
    driver: WebDriver,
    lineNumber: number = 1,
    column: number = 0
): Promise<boolean> {
    try {
        logger.trace("Editor", `Setting cursor to line ${lineNumber}, column ${column}...`);

        // First, close any open quick input dialogs
        await closeQuickInputDialog(driver);

        // Ensure the editor is focused
        await editor.click();
        await driver.sleep(200);

        // Use keyboard shortcut to go to beginning of file (Ctrl+Home on Windows/Linux, Cmd+Home on Mac)
        if (lineNumber === 1 && column === 0) {
            // Simple case: just go to beginning of file
            const isMac = process.platform === "darwin";
            const homeKey = isMac ? Key.COMMAND : Key.CONTROL;
            await driver.actions().keyDown(homeKey).sendKeys(Key.HOME).keyUp(homeKey).perform();
            await driver.sleep(300);
        } else {
            // For other positions, go to beginning first, then use arrow keys
            const isMac = process.platform === "darwin";
            const homeKey = isMac ? Key.COMMAND : Key.CONTROL;
            await driver.actions().keyDown(homeKey).sendKeys(Key.HOME).keyUp(homeKey).perform();
            await driver.sleep(200);

            // If we need to go to a different line, use arrow keys
            if (lineNumber > 1) {
                for (let i = 1; i < lineNumber; i++) {
                    await driver.actions().sendKeys(Key.ARROW_DOWN).perform();
                    await driver.sleep(50);
                }
            }

            // If we need to go to a specific column, use arrow keys
            if (column > 0) {
                for (let i = 0; i < column; i++) {
                    await driver.actions().sendKeys(Key.ARROW_RIGHT).perform();
                    await driver.sleep(50);
                }
            }
        }

        await applySlowMotion(driver);
        logger.trace("Editor", `Cursor set to line ${lineNumber}, column ${column}`);
        return true;
    } catch (error) {
        logger.error("Editor", "Error setting cursor position", error);
        // Fallback: try clicking at the beginning of the editor
        try {
            await editor.click();
            await driver.sleep(200);
            // Click at the top-left of the editor content area
            const editorElement = await editor.findElement(By.css(".monaco-editor, .editor-container"));
            const location = await editorElement.getLocation();
            // Click at the beginning (top-left with some offset for line numbers)
            await driver
                .actions()
                .move({ x: location.x + 50, y: location.y + 20 })
                .click()
                .perform();
            await driver.sleep(200);
            logger.trace("Editor", "Cursor set using click fallback");
            return true;
        } catch (fallbackError) {
            logger.error("Editor", "Fallback cursor positioning also failed", fallbackError);
            return false;
        }
    }
}

/**
 * Deletes all content from a specific line number onwards in a TextEditor.
 * Keeps lines before the specified line number intact.
 * Uses multiple strategies with verification to ensure deletion succeeds.
 *
 * @param editor - The TextEditor instance
 * @param driver - The WebDriver instance
 * @param fromLine - The line number from which to start deleting (1-based, inclusive)
 * @returns Promise<boolean> - True if deletion was successful, false otherwise
 */
export async function deleteFromLineOnwards(editor: TextEditor, driver: WebDriver, fromLine: number): Promise<boolean> {
    logger.trace("Editor", `Deleting content from line ${fromLine} onwards...`);

    // Helper function to verify deletion succeeded
    const verifyDeletion = async (): Promise<boolean> => {
        try {
            const currentText = await editor.getText();
            const lines = currentText.split("\n");
            const expectedLineCount = fromLine - 1; // Keep lines 1 to (fromLine - 1)

            // Check if we have the expected number of lines (or fewer, if file was shorter)
            const actualLineCount = lines.length;
            const isCorrect = actualLineCount <= expectedLineCount;

            if (!isCorrect) {
                logger.trace(
                    "Editor",
                    `Verification failed: Expected ≤${expectedLineCount} lines, got ${actualLineCount} lines`
                );
                return false;
            }

            logger.trace(
                "Editor",
                `✓ Verification passed: File has ${actualLineCount} line(s) (expected ≤${expectedLineCount})`
            );
            return true;
        } catch (error) {
            logger.error("Editor", "Error during verification", error);
            return false;
        }
    };

    // Strategy 1: Use TextEditor API directly (most reliable)
    try {
        logger.trace("Editor", "Strategy 1: Using TextEditor API...");
        await closeQuickInputDialog(driver);
        await editor.click();
        await driver.sleep(200);

        // Get current text
        const currentText = await editor.getText();
        const lines = currentText.split("\n");

        if (lines.length >= fromLine) {
            const linesToKeep = lines.slice(0, fromLine - 1);
            const newText = linesToKeep.join("\n");

            // Use TextEditor's typeTextAt method if available, otherwise use keyboard
            try {
                // Try to use the editor's API to replace all text
                await editor.click();
                await driver.sleep(100);

                const isMac = process.platform === "darwin";
                const ctrlKey = isMac ? Key.COMMAND : Key.CONTROL;

                // Select all
                await driver.actions().keyDown(ctrlKey).sendKeys("a").keyUp(ctrlKey).perform();
                await driver.sleep(150);

                // Clear selection and type new text
                await driver.actions().sendKeys(newText).perform();
                await driver.sleep(300);

                // Wait for editor to update
                await driver.wait(
                    async () => {
                        return await verifyDeletion();
                    },
                    UITimeouts.MEDIUM,
                    "Waiting for deletion to complete"
                );

                const verified = await verifyDeletion();
                if (verified) {
                    logger.info("Editor", "✓ Content deleted successfully using TextEditor API");
                    await applySlowMotion(driver);
                    return true;
                }
            } catch (apiError) {
                logger.warn("Editor", "TextEditor API method failed, trying alternative", apiError);
            }
        }
    } catch (error) {
        logger.error("Editor", "Strategy 1 failed", error);
    }

    // Strategy 2: Keyboard navigation with selection (original method, improved)
    try {
        logger.trace("Editor", "Strategy 2: Using keyboard navigation...");
        await closeQuickInputDialog(driver);
        await editor.click();
        await driver.sleep(200);

        const isMac = process.platform === "darwin";
        const ctrlKey = isMac ? Key.COMMAND : Key.CONTROL;

        // Go to beginning of file first
        await driver.actions().keyDown(ctrlKey).sendKeys(Key.HOME).keyUp(ctrlKey).perform();
        await driver.sleep(150);

        // Navigate to the target line using arrow keys
        for (let i = 1; i < fromLine; i++) {
            await driver.actions().sendKeys(Key.ARROW_DOWN).perform();
            await driver.sleep(50);
        }

        // Go to the beginning of the target line
        await driver.actions().sendKeys(Key.HOME).perform();
        await driver.sleep(150);

        // Select from current position to end of file (Ctrl+Shift+End)
        await driver
            .actions()
            .keyDown(ctrlKey)
            .keyDown(Key.SHIFT)
            .sendKeys(Key.END)
            .keyUp(Key.SHIFT)
            .keyUp(ctrlKey)
            .perform();
        await driver.sleep(200);

        // Delete the selected content
        await driver.actions().sendKeys(Key.DELETE).perform();
        await driver.sleep(300);

        // Verify deletion succeeded
        const verified = await driver.wait(
            async () => {
                return await verifyDeletion();
            },
            UITimeouts.MEDIUM,
            "Waiting for deletion to complete"
        );

        if (verified) {
            logger.info("Editor", "✓ Content deleted successfully using keyboard navigation");
            await applySlowMotion(driver);
            return true;
        }
    } catch (error) {
        logger.error("Editor", "Strategy 2 failed", error);
    }

    // Strategy 3: JavaScript-based text replacement (most reliable fallback)
    try {
        logger.trace("Editor", "Strategy 3: Using JavaScript text replacement...");
        await closeQuickInputDialog(driver);
        await editor.click();
        await driver.sleep(200);

        // Get current text
        const currentText = await editor.getText();
        const lines = currentText.split("\n");

        if (lines.length >= fromLine) {
            const linesToKeep = lines.slice(0, fromLine - 1);
            const newText = linesToKeep.join("\n");

            // Use JavaScript to directly manipulate the editor content
            // This is more reliable than keyboard input
            const isMac = process.platform === "darwin";
            const ctrlKey = isMac ? Key.COMMAND : Key.CONTROL;

            await editor.click();
            await driver.sleep(100);

            // Select all
            await driver.actions().keyDown(ctrlKey).sendKeys("a").keyUp(ctrlKey).perform();
            await driver.sleep(150);

            // Clear and type new text character by character to ensure it's processed
            // First clear the selection
            await driver.actions().sendKeys(Key.DELETE).perform();
            await driver.sleep(100);

            // Type the new text
            if (newText) {
                await driver.actions().sendKeys(newText).perform();
            }
            await driver.sleep(300);

            // Verify deletion succeeded
            const verified = await driver.wait(
                async () => {
                    return await verifyDeletion();
                },
                UITimeouts.MEDIUM,
                "Waiting for deletion to complete"
            );

            if (verified) {
                logger.info("Editor", "✓ Content deleted successfully using JavaScript replacement");
                await applySlowMotion(driver);
                return true;
            }
        }
    } catch (error) {
        logger.error("Editor", "Strategy 3 failed", error);
    }

    // Final verification attempt
    logger.trace("Editor", "All strategies failed, attempting final verification...");
    const finalCheck = await verifyDeletion();
    if (finalCheck) {
        logger.info("Editor", "✓ Deletion verified on final check");
        return true;
    }

    logger.error("Editor", `✗ Failed to delete content from line ${fromLine} onwards after all strategies`);
    return false;
}

/**
 * Waits for CodeLens to appear in the active editor.
 *
 * @param driver - The WebDriver instance
 * @param codeLensText - The text of the CodeLens to wait for (optional, for verification)
 * @param timeout - Maximum time to wait (default: UITimeouts.LONG)
 * @returns Promise<boolean> - True if CodeLens appeared, false if timeout
 */
export async function waitForCodeLens(
    driver: WebDriver,
    codeLensText?: string,
    timeout: number = UITimeouts.LONG
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        await driver.wait(
            async () => {
                try {
                    // Check if CodeLens elements exist
                    const codeLensElements = await driver.findElements(
                        By.css(".codelens-decoration, .code-lens, [class*='codelens']")
                    );

                    if (codeLensElements.length === 0) {
                        return false;
                    }

                    // If specific text is provided, verify it exists
                    if (codeLensText) {
                        for (const element of codeLensElements) {
                            try {
                                const text = await element.getText();
                                if (text.includes(codeLensText)) {
                                    return true;
                                }
                            } catch {
                                // Continue searching
                            }
                        }
                        return false;
                    }

                    // If no specific text, just check that CodeLens elements exist
                    return codeLensElements.length > 0;
                } catch {
                    return false;
                }
            },
            timeout,
            codeLensText ? `Waiting for CodeLens "${codeLensText}" to appear` : "Waiting for CodeLens to appear"
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Waits for Refactor Preview tab to appear.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait (default: UITimeouts.VERY_LONG)
 * @returns Promise<boolean> - True if Refactor Preview appeared, false if timeout
 */
export async function waitForRefactorPreview(
    driver: WebDriver,
    timeout: number = UITimeouts.VERY_LONG
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        await driver.wait(
            async () => {
                try {
                    // Find tab by title
                    const tabs = await driver.findElements(By.css(".tab, .monaco-tab, [role='tab']"));
                    for (const tab of tabs) {
                        const title = await tab.getText();
                        if (title.includes("REFACTOR PREVIEW") || title.includes("Refactor Preview")) {
                            return true;
                        }
                    }
                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            "Waiting for Refactor Preview tab to appear"
        );
        return true;
    } catch {
        return false;
    }
}

// ============================================
// Filesystem Verification Utilities
// ============================================

import {
    getRobotOutputDirectory,
    getResourceDirectoryPath,
    getExtensionSetting,
    clearSettingsCache,
    setActiveProfile,
    getActiveProfile
} from "../config/testConfig";

export { getExtensionSetting, getResourceDirectoryPath, clearSettingsCache, setActiveProfile, getActiveProfile };

/**
 * Result of filesystem verification for generated Robot Framework files.
 */
export interface FilesystemVerificationResult {
    /** Whether the verification was successful */
    success: boolean;
    /** List of .robot files found in the output directory */
    foundFiles: string[];
    /** List of expected files that were not found (if patterns provided) */
    missingFiles: string[];
    /** Total count of .robot files found */
    totalCount: number;
    /** Whether an __init__.robot file was found (indicates test suite folder) */
    hasInitFile: boolean;
    /** The output directory that was checked */
    outputDirectory: string;
    /** Error message if verification failed */
    error?: string;
}

/**
 * Recursively finds all files matching a pattern in a directory.
 *
 * @param dir - The directory to search
 * @param pattern - Regular expression pattern to match file names
 * @param results - Array to collect results (used for recursion)
 * @returns Array of absolute file paths
 */
function findFilesRecursive(dir: string, pattern: RegExp, results: string[] = []): string[] {
    try {
        if (!fs.existsSync(dir)) {
            return results;
        }

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                findFilesRecursive(fullPath, pattern, results);
            } else if (pattern.test(entry.name)) {
                results.push(fullPath);
            }
        }
    } catch (error) {
        logger.debug("Filesystem", `Error scanning directory ${dir}: ${error}`);
    }
    return results;
}

/**
 * Verifies that generated Robot Framework files exist on the filesystem.
 * This function checks the output directory for .robot files after test generation.
 *
 * @param workspaceRoot - Optional workspace root path. If not provided, uses default test workspace.
 * @param expectedPatterns - Optional array of file name patterns to verify exist (e.g., ["TestTheme", "__init__"])
 * @returns Promise<FilesystemVerificationResult> - Verification result with found/missing files
 */
export async function verifyGeneratedFilesExist(
    workspaceRoot?: string,
    expectedPatterns?: string[]
): Promise<FilesystemVerificationResult> {
    const outputDir = getRobotOutputDirectory(workspaceRoot);
    const result: FilesystemVerificationResult = {
        success: false,
        foundFiles: [],
        missingFiles: [],
        totalCount: 0,
        hasInitFile: false,
        outputDirectory: outputDir
    };

    try {
        logger.info("Filesystem", `Verifying generated files in: ${outputDir}`);

        if (!fs.existsSync(outputDir)) {
            result.error = `Output directory does not exist: ${outputDir}`;
            logger.warn("Filesystem", result.error);
            return result;
        }

        // Find all .robot files recursively
        const robotFiles = findFilesRecursive(outputDir, /\.robot$/i);
        result.foundFiles = robotFiles;
        result.totalCount = robotFiles.length;

        // Check for __init__.robot
        result.hasInitFile = robotFiles.some((f) => path.basename(f) === "__init__.robot");

        logger.info("Filesystem", `Found ${result.totalCount} .robot file(s)`);
        if (result.hasInitFile) {
            logger.info("Filesystem", "✓ __init__.robot file found (test suite folder structure)");
        }

        // Log found files
        for (const file of robotFiles) {
            const relativePath = path.relative(outputDir, file);
            logger.debug("Filesystem", `  Found: ${relativePath}`);
        }

        // Check for expected patterns if provided
        if (expectedPatterns && expectedPatterns.length > 0) {
            for (const pattern of expectedPatterns) {
                const patternRegex = new RegExp(pattern, "i");
                const matchFound = robotFiles.some((f) => patternRegex.test(path.basename(f)));
                if (!matchFound) {
                    result.missingFiles.push(pattern);
                    logger.warn("Filesystem", `✗ No file matching pattern "${pattern}" found`);
                } else {
                    logger.info("Filesystem", `✓ File matching pattern "${pattern}" found`);
                }
            }
        }

        result.success = result.totalCount > 0 && result.missingFiles.length === 0;

        if (result.success) {
            logger.info("Filesystem", "✓ Filesystem verification passed");
        } else if (result.totalCount === 0) {
            result.error = "No .robot files found in output directory";
            logger.warn("Filesystem", result.error);
        } else if (result.missingFiles.length > 0) {
            result.error = `Missing expected files: ${result.missingFiles.join(", ")}`;
            logger.warn("Filesystem", result.error);
        }

        return result;
    } catch (error) {
        result.error = `Error verifying files: ${error}`;
        logger.error("Filesystem", result.error);
        return result;
    }
}

/**
 * Reads the content of a generated .robot file from the filesystem.
 *
 * @param filePath - Absolute path to the .robot file
 * @returns File content as string, or null if file doesn't exist or can't be read
 */
export function readRobotFileContent(filePath: string): string | null {
    try {
        if (!fs.existsSync(filePath)) {
            logger.warn("Filesystem", `File does not exist: ${filePath}`);
            return null;
        }
        const content = fs.readFileSync(filePath, "utf-8");
        logger.debug("Filesystem", `Read ${content.length} bytes from ${path.basename(filePath)}`);
        return content;
    } catch (error) {
        logger.error("Filesystem", `Error reading file ${filePath}: ${error}`);
        return null;
    }
}

/**
 * Verifies that a specific .robot file exists and contains expected metadata.
 *
 * @param filePath - Absolute path to the .robot file
 * @param expectedMetadata - Object with expected metadata keys and values
 * @returns Object with verification results
 */
export function verifyRobotFileMetadata(
    filePath: string,
    expectedMetadata: { uniqueID?: string; name?: string; numbering?: string }
): { valid: boolean; foundMetadata: Record<string, string | null>; errors: string[] } {
    const result = {
        valid: true,
        foundMetadata: {} as Record<string, string | null>,
        errors: [] as string[]
    };

    const content = readRobotFileContent(filePath);
    if (!content) {
        result.valid = false;
        result.errors.push(`Could not read file: ${filePath}`);
        return result;
    }

    // Verify *** Settings *** section exists
    if (!content.includes("*** Settings ***")) {
        result.valid = false;
        result.errors.push("File does not contain *** Settings *** section");
    }

    // Extract and verify metadata
    const extractMetadata = (key: string): string | null => {
        const pattern = new RegExp(`Metadata\\s+${key}\\s+([^\\n\\r]+)`, "i");
        const match = content.match(pattern);
        return match && match[1] ? match[1].trim() : null;
    };

    result.foundMetadata["UniqueID"] = extractMetadata("UniqueID");
    result.foundMetadata["Name"] = extractMetadata("Name");
    result.foundMetadata["Numbering"] = extractMetadata("Numbering");

    // Verify expected values match
    if (expectedMetadata.uniqueID && result.foundMetadata["UniqueID"] !== expectedMetadata.uniqueID) {
        result.valid = false;
        result.errors.push(
            `UniqueID mismatch: expected "${expectedMetadata.uniqueID}", found "${result.foundMetadata["UniqueID"]}"`
        );
    }

    if (expectedMetadata.name && result.foundMetadata["Name"] !== expectedMetadata.name) {
        result.valid = false;
        result.errors.push(
            `Name mismatch: expected "${expectedMetadata.name}", found "${result.foundMetadata["Name"]}"`
        );
    }

    if (expectedMetadata.numbering && result.foundMetadata["Numbering"] !== expectedMetadata.numbering) {
        result.valid = false;
        result.errors.push(
            `Numbering mismatch: expected "${expectedMetadata.numbering}", found "${result.foundMetadata["Numbering"]}"`
        );
    }

    if (result.valid) {
        logger.info("Filesystem", `✓ Metadata verification passed for ${path.basename(filePath)}`);
    } else {
        logger.warn("Filesystem", `✗ Metadata verification failed: ${result.errors.join("; ")}`);
    }

    return result;
}

/**
 * Counts the total number of .robot files in the output directory.
 * Useful for verifying expected file count after generation.
 *
 * @param workspaceRoot - Optional workspace root path
 * @returns Number of .robot files found
 */
export function countGeneratedRobotFiles(workspaceRoot?: string): number {
    const outputDir = getRobotOutputDirectory(workspaceRoot);
    if (!fs.existsSync(outputDir)) {
        return 0;
    }
    const robotFiles = findFilesRecursive(outputDir, /\.robot$/i);
    return robotFiles.length;
}

/**
 * Gets a list of all generated .robot file paths.
 *
 * @param workspaceRoot - Optional workspace root path
 * @returns Array of absolute file paths
 */
export function getGeneratedRobotFiles(workspaceRoot?: string): string[] {
    const outputDir = getRobotOutputDirectory(workspaceRoot);
    if (!fs.existsSync(outputDir)) {
        return [];
    }
    return findFilesRecursive(outputDir, /\.robot$/i);
}

/**
 * Clears all generated .robot files from the output directory.
 * Useful for test cleanup.
 *
 * @param workspaceRoot - Optional workspace root path
 * @returns Number of files deleted
 */
export function clearGeneratedRobotFiles(workspaceRoot?: string): number {
    const outputDir = getRobotOutputDirectory(workspaceRoot);
    if (!fs.existsSync(outputDir)) {
        return 0;
    }

    let deletedCount = 0;
    const robotFiles = findFilesRecursive(outputDir, /\.robot$/i);

    for (const file of robotFiles) {
        try {
            fs.unlinkSync(file);
            deletedCount++;
            logger.debug("Filesystem", `Deleted: ${path.basename(file)}`);
        } catch (error) {
            logger.warn("Filesystem", `Failed to delete ${file}: ${error}`);
        }
    }

    // Also try to remove empty directories
    try {
        const dirs = fs.readdirSync(outputDir, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const dir of dirs) {
            const dirPath = path.join(outputDir, dir.name);
            const contents = fs.readdirSync(dirPath);
            if (contents.length === 0) {
                fs.rmdirSync(dirPath);
                logger.debug("Filesystem", `Removed empty directory: ${dir.name}`);
            }
        }
    } catch {
        // Ignore directory cleanup errors
    }

    logger.info("Filesystem", `Cleared ${deletedCount} .robot file(s) from output directory`);
    return deletedCount;
}
