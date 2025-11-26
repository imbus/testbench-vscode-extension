/**
 * @file src/test/ui/testUtils.ts
 * @description Utility functions and constants for UI tests
 */

import { getSlowMotionDelay, getTestCredentials, hasTestCredentials, TEST_PATHS } from "./testConfig";
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
            console.log("[Logout] Already logged out - webview is available");
            return true;
        }

        console.log("[Logout] Attempting to logout...");
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
                console.log(`[Logout] Found logout command: ${text}`);
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
                    console.log("[Logout] Logout successful - webview is now available");
                    return true;
                } catch {
                    console.log("[Logout] Warning: Logout command executed but webview still not available");
                    return false;
                }
            }
        }

        if (!logoutCommandFound) {
            console.log("[Logout] Logout command not found - user may already be logged out");
            await commandPalette.cancel();
            // Check if webview is available (might already be logged out)
            const webviewAvailable = await isWebviewAvailable(driver);
            return webviewAvailable;
        }

        return false;
    } catch (error) {
        // If command palette fails, log error but don't fail the test
        console.log("[Logout] Error during logout attempt:", error);
        // Check if we're already logged out
        try {
            const webviewAvailable = await isWebviewAvailable(driver);
            if (webviewAvailable) {
                console.log("[Logout] Webview is available despite error - assuming already logged out");
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
 * @param timeout - Maximum time to wait for the button (default: 5000ms)
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function handleAllowButton(driver: WebDriver, timeout: number = 5000): Promise<boolean> {
    try {
        // Wait for modal to appear and find Allow button
        const allowButtons = await driver.wait(async () => {
            const elements = await driver.findElements(By.xpath(ModalButtonSelectors.ALLOW));
            return elements.length > 0 ? elements : null;
        }, timeout);

        if (allowButtons && allowButtons.length > 0) {
            await allowButtons[0].click();
            console.log(`Clicked ${ModalButtonTexts.ALLOW} button`);

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
        console.log(`Could not find or click ${ModalButtonTexts.ALLOW} button:`, error);
        return false;
    }
}

/**
 * Handles certificate warning modal by clicking the "Proceed Anyway" button if present.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait for the button (default: 5000ms)
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function handleProceedAnywayButton(driver: WebDriver, timeout: number = 5000): Promise<boolean> {
    try {
        console.log("Checking for certificate warning...");
        const proceedButtons = await driver.wait(async () => {
            const elements = await driver.findElements(By.xpath(ModalButtonSelectors.PROCEED_ANYWAY));
            return elements.length > 0 ? elements : null;
        }, timeout);

        if (proceedButtons && proceedButtons.length > 0) {
            await proceedButtons[0].click();
            console.log(`Clicked ${ModalButtonTexts.PROCEED_ANYWAY} button for untrusted certificate`);

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
        console.log(`Could not find or click ${ModalButtonTexts.PROCEED_ANYWAY} button:`, error);
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
        console.log(`[Workspace] Cleaning existing workspace: ${workspacePath}`);
        fs.rmSync(workspacePath, { recursive: true, force: true });
    }

    if (!fs.existsSync(workspacePath)) {
        console.log(`[Workspace] Creating folder: ${workspacePath}`);
        fs.mkdirSync(workspacePath, { recursive: true });
    }

    // Check if the specific workspace is already open
    try {
        const title = await driver.getTitle();
        const folderName = path.basename(workspaceName);
        console.log(`[Workspace] Current window title: '${title}'`);

        if (title && (title.includes(folderName) || title.includes(workspaceName))) {
            console.log(`[Workspace] '${folderName}' appears to be already open.`);
            return;
        }
    } catch (error) {
        console.log(`[Workspace] Could not check if workspace is open: ${error}`);
    }

    console.log(`[Workspace] Opening folder: ${workspacePath}`);

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
            await driver.wait(until.stalenessOf(oldWorkbench), 10000, "Waiting for VS Code reload to start");
        } catch {
            console.log("[Workspace] Warning: Window reload detected via staleness timed out or was too fast.");
        }
    }

    // Ensure driver context is correct
    await driver.switchTo().defaultContent();

    console.log("[Workspace] Waiting for workbench to load...");

    // Wait for the workbench to fully reload.
    // Using generic class selector which is more stable than ID
    await driver.wait(
        until.elementLocated(By.className("monaco-workbench")),
        120000,
        `Timeout waiting for workspace '${workspaceName}' to load`
    );

    try {
        await driver.wait(
            until.elementLocated(By.id("workbench.parts.statusbar")),
            15000,
            "Waiting for status bar (UI ready)"
        );
    } catch {
        console.log("[Workspace] Warning: Status bar not found, proceeding anyway.");
    }

    console.log(`[Workspace] Workspace '${workspaceName}' loaded successfully.`);
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
            console.log("[Workspace] Could not get window title");
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

        // Fallback
        const defaultWorkspace = path.join(projectRoot, TEST_PATHS.BASE_STORAGE, TEST_PATHS.WORKSPACE);
        if (fs.existsSync(defaultWorkspace)) {
            return defaultWorkspace;
        }

        console.log("[Workspace] Could not determine workspace path from title");
        return null;
    } catch (error) {
        console.log(`[Workspace] Error getting workspace path: ${error}`);
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
            console.log(`[Workspace Cleanup] Workspace path does not exist: ${targetPath}`);
            return false;
        }

        console.log(`[Workspace Cleanup] Cleaning workspace: ${targetPath}`);
        console.log(`[Workspace Cleanup] Excluding: ${exclude.length > 0 ? exclude.join(", ") : "none"}`);

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
                console.log(`[Workspace Cleanup] Excluding: ${item.name}`);
                skippedCount++;
                continue;
            }

            try {
                if (item.isDirectory()) {
                    fs.rmSync(itemPath, { recursive: true, force: true });
                    console.log(`[Workspace Cleanup] Deleted folder: ${item.name}`);
                } else {
                    fs.unlinkSync(itemPath);
                    console.log(`[Workspace Cleanup] Deleted file: ${item.name}`);
                }
                deletedCount++;
            } catch (error) {
                console.log(`[Workspace Cleanup] Error deleting ${item.name}: ${error}`);
            }
        }

        console.log(`[Workspace Cleanup] Cleanup complete. Deleted: ${deletedCount}, Excluded: ${skippedCount}`);
        return true;
    } catch (error) {
        console.log(`[Workspace Cleanup] Error during cleanup: ${error}`);
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
                            console.log("[Sidebar] TestBench sidebar is already open");
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
                                10000,
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
                    console.log(
                        `[Sidebar] Stale element detected on control, will retry (attempt ${attempt + 1}/${maxRetries})`
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
                console.log(
                    `[Sidebar] Error opening sidebar, retrying (attempt ${attempt + 1}/${maxRetries}): ${error}`
                );

                if (driver) {
                    await driver.sleep(1000);
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
        console.log("Could not determine webview availability:", error);
        return true;
    }
}

/**
 * Finds and switches to the webview iframe in the shadow DOM.
 * Returns true if successful, false otherwise.
 *
 * @param driver - The WebDriver instance
 * @param markAttribute - Optional attribute name to mark the iframe (default: 'data-test-webview')
 * @param timeout - Maximum time to wait for webview (default: 15000ms)
 * @returns Promise<boolean> - True if webview was found and switched to, false otherwise
 */
export async function findAndSwitchToWebview(
    driver: WebDriver,
    markAttribute: string = "data-test-webview",
    timeout: number = 15000
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
            1000
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
            10000,
            "Waiting for content to load in active-frame",
            1000
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
        console.log("Error finding webview:", error);
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
    SHORT: 2000,
    MEDIUM: 5000,
    LONG: 10000,
    VERY_LONG: 15000
} as const;

/**
 * Finds a tree item by its label name, searching only at the current level (non-recursive).
 * This is more efficient and avoids expanding unrelated items.
 *
 * @param items - Array of tree items to search
 * @param targetLabel - The label text to find (exact or partial match)
 * @param exactMatch - If true, requires exact match; if false, uses partial match (default: false)
 * @returns Promise<TreeItem | null> - The found tree item or null if not found
 */
export async function findTreeItemByLabelAtLevel(
    items: TreeItem[],
    targetLabel: string,
    exactMatch: boolean = false
): Promise<TreeItem | null> {
    for (const item of items) {
        try {
            const label = await item.getLabel();
            const matches = exactMatch ? label === targetLabel : label === targetLabel || label.includes(targetLabel);

            if (matches) {
                return item;
            }
        } catch (error) {
            // Log error but continue searching
            console.log(`[TreeItem] Error checking tree item: ${error}`);
        }
    }

    return null;
}

/**
 * Finds a tree item by its label name, searching recursively through children.
 * Note: This may expand items while searching. Use findTreeItemByLabelAtLevel for non-recursive search.
 *
 * @param items - Array of tree items to search
 * @param targetLabel - The label text to find (exact or partial match)
 * @param exactMatch - If true, requires exact match; if false, uses partial match (default: false)
 * @returns Promise<TreeItem | null> - The found tree item or null if not found
 */
export async function findTreeItemByLabel(
    items: TreeItem[],
    targetLabel: string,
    exactMatch: boolean = false
): Promise<TreeItem | null> {
    for (const item of items) {
        try {
            const label = await item.getLabel();
            const matches = exactMatch ? label === targetLabel : label === targetLabel || label.includes(targetLabel);

            if (matches) {
                return item;
            }

            // If item has children, search recursively
            if (await item.hasChildren()) {
                const children = await item.getChildren();
                if (children && children.length > 0) {
                    const found = await findTreeItemByLabel(children, targetLabel, exactMatch);
                    if (found) {
                        return found;
                    }
                }
            }
        } catch (error) {
            // Log error but continue searching
            console.log(`[TreeItem] Error checking tree item: ${error}`);
        }
    }

    return null;
}

/**
 * Waits for tree item children to be loaded after expansion.
 * Checks that the item is expanded and children are available.
 *
 * @param item - The tree item to wait for
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if children are loaded, false if timeout
 */
export async function waitForTreeItemChildren(
    item: TreeItem,
    driver: WebDriver,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    try {
        await driver.wait(
            async () => {
                try {
                    // Check that item is expanded
                    const isExpanded = await item.isExpanded();
                    if (!isExpanded) {
                        return false;
                    }

                    // Check that children are available
                    const children = await item.getChildren();
                    return children !== null && children.length >= 0; // Allow empty children array (item might have no children)
                } catch {
                    return false;
                }
            },
            timeout,
            "Waiting for tree item children to load"
        );
        return true;
    } catch (error) {
        console.log(`[TreeItem] Timeout waiting for children to load: ${error}`);
        return false;
    }
}

/**
 * Safely expands a tree item if it has children and is not already expanded.
 * Waits for children to load after expansion using smart wait.
 *
 * @param item - The tree item to expand
 * @param driver - The WebDriver instance for slow motion
 * @returns Promise<boolean> - True if item was expanded or already expanded, false otherwise
 */
export async function expandTreeItemIfNeeded(item: TreeItem, driver: WebDriver): Promise<boolean> {
    try {
        const hasChildren = await item.hasChildren();
        if (!hasChildren) {
            return false;
        }

        const isExpanded = await item.isExpanded();
        if (isExpanded) {
            return true; // Already expanded
        }

        await item.expand();
        await applySlowMotion(driver);

        // Wait for children to actually load (smart wait instead of fixed delay)
        const childrenLoaded = await waitForTreeItemChildren(item, driver);
        if (!childrenLoaded) {
            console.log(`[TreeItem] Warning: Children may not have loaded for tree item`);
        }

        // Verify it's expanded
        const expanded = await item.isExpanded();
        return expanded;
    } catch (error) {
        console.log(`[TreeItem] Error expanding tree item: ${error}`);
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
 * Interface for connection form data.
 */
export interface ConnectionFormData {
    connectionLabel?: string;
    serverName: string;
    portNumber: string;
    username: string;
    password?: string;
    storePassword?: boolean;
}

/**
 * Result of finding a connection in the list.
 */
export interface ConnectionSearchResult {
    element: WebElement | null;
    found: boolean;
}

/**
 * Clears an input field thoroughly, handling default values and edge cases.
 * Uses multiple strategies to ensure the field is completely cleared.
 * This is especially important for fields with default values (like port="9445").
 *
 * @param driver - The WebDriver instance
 * @param element - The input element to clear
 * @returns Promise<void>
 */
async function clearInputField(driver: WebDriver, element: WebElement): Promise<void> {
    try {
        // Strategy 1: Use JavaScript to directly set value to empty (most reliable)
        // This bypasses any default values set in HTML
        await driver.executeScript("arguments[0].value = '';", element);

        // Strategy 2: Standard clear as backup
        await element.clear();

        // Strategy 3: Trigger input event to ensure UI updates
        await driver.executeScript("arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", element);

        // Wait for the field to be cleared and verify value is empty
        await driver.wait(
            async () => {
                const value = await element.getAttribute("value");
                return value === null || value === "";
            },
            1000,
            "Waiting for input field to be cleared"
        );
    } catch (error) {
        // If all strategies fail, log but continue
        console.log("Warning: Could not fully clear input field:", error);
    }
}

/**
 * Fills the connection form with the provided data.
 * Ensures fields are properly cleared before filling, especially to handle default values.
 *
 * @param driver - The WebDriver instance
 * @param formData - The connection form data to fill
 * @returns Promise<void>
 */
export async function fillConnectionForm(driver: WebDriver, formData: ConnectionFormData): Promise<void> {
    const { connectionLabel = "", serverName, portNumber, username, password = "", storePassword = true } = formData;

    const labelInput = await driver.findElement(By.id(ConnectionFormElements.CONNECTION_LABEL));
    await clearInputField(driver, labelInput);
    if (connectionLabel) {
        await labelInput.sendKeys(connectionLabel);
        await applySlowMotion(driver); // Visible: typing in label field
    }

    const serverInput = await driver.findElement(By.id(ConnectionFormElements.SERVER_NAME));
    await clearInputField(driver, serverInput);
    await serverInput.sendKeys(serverName);
    await applySlowMotion(driver); // Visible: typing in server field

    const portInput = await driver.findElement(By.id(ConnectionFormElements.PORT_NUMBER));
    await clearInputField(driver, portInput);
    await portInput.sendKeys(portNumber);
    await applySlowMotion(driver); // Visible: typing in port field

    const usernameInput = await driver.findElement(By.id(ConnectionFormElements.USERNAME));
    await clearInputField(driver, usernameInput);
    await usernameInput.sendKeys(username);
    await applySlowMotion(driver); // Visible: typing in username field

    const passwordInput = await driver.findElement(By.id(ConnectionFormElements.PASSWORD));
    await clearInputField(driver, passwordInput);
    if (password) {
        await passwordInput.sendKeys(password);
        await applySlowMotion(driver); // Visible: typing in password field
    }

    const storePasswordCheckbox = await driver.findElement(By.id(ConnectionFormElements.STORE_PASSWORD_CHECKBOX));
    const isChecked = await storePasswordCheckbox.isSelected();
    if (storePassword !== isChecked) {
        await storePasswordCheckbox.click();
        await applySlowMotion(driver); // Visible: clicking checkbox
    }
}

/**
 * Finds a connection in the connections list by label or connection string.
 *
 * @param driver - The WebDriver instance
 * @param searchText - The text to search for (label or connection string)
 * @returns Promise<ConnectionSearchResult> - The search result with element and found flag
 */
export async function findConnectionInList(driver: WebDriver, searchText: string): Promise<ConnectionSearchResult> {
    try {
        const connectionsList = await driver.findElement(By.id(ConnectionFormElements.CONNECTIONS_LIST));
        const connectionsItems = await connectionsList.findElements(By.css("li"));

        for (const item of connectionsItems) {
            const text = await item.getText();
            if (text.includes(searchText)) {
                return { element: item, found: true };
            }
        }
        return { element: null, found: false };
    } catch {
        return { element: null, found: false };
    }
}

/**
 * Gets the current count of connections in the list.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<number> - The number of connections
 */
export async function getConnectionCount(driver: WebDriver): Promise<number> {
    try {
        const connectionsList = await driver.findElement(By.id(ConnectionFormElements.CONNECTIONS_LIST));
        const connectionsItems = await connectionsList.findElements(By.css("li"));
        return connectionsItems.length;
    } catch {
        return 0;
    }
}

/**
 * Gets all connection list items from the connections list.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<WebElement[]> - Array of connection list item elements
 */
export async function getAllConnections(driver: WebDriver): Promise<WebElement[]> {
    try {
        const connectionsList = await driver.findElement(By.id(ConnectionFormElements.CONNECTIONS_LIST));
        const connectionsItems = await connectionsList.findElements(By.css("li"));
        return connectionsItems;
    } catch {
        return [];
    }
}

/**
 * Deletes all existing TestBench connections.
 * This is useful for cleaning up test state before running tests.
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
            console.log("[Cleanup] Webview not available - user is logged in. Cannot delete connections.");
            return 0;
        }

        // Switch to webview
        const webviewFound = await findAndSwitchToWebview(driver);
        if (!webviewFound) {
            console.log("[Cleanup] Webview not found. Cannot delete connections.");
            return 0;
        }

        let deletedCount = 0;
        const maxIterations = 50; // Safety limit to prevent infinite loops
        let iterations = 0;

        // Delete connections until none remain
        while (iterations < maxIterations) {
            iterations++;

            // Get all connections
            const connections = await getAllConnections(driver);

            if (connections.length === 0) {
                // No more connections to delete
                break;
            }

            // Delete the first connection (we'll keep deleting until all are gone)
            const firstConnection = connections[0];

            try {
                // Check if delete button is enabled (not disabled during edit mode)
                const deleteButton = await firstConnection.findElement(By.css("button.delete-btn"));
                const isDisabled = await deleteButton.getAttribute("disabled");

                if (isDisabled !== null) {
                    // Connection is being edited - cancel edit mode first
                    console.log("[Cleanup] Connection is being edited. Canceling edit mode first...");
                    try {
                        const cancelButton = await driver.findElement(By.id(ConnectionFormElements.CANCEL_EDIT_BUTTON));
                        await cancelButton.click();

                        // Wait for form to reset (section title should change back to "Add New Connection")
                        await driver.wait(
                            async () => {
                                try {
                                    const sectionTitle = await driver.findElement(
                                        By.id(ConnectionFormElements.SECTION_TITLE)
                                    );
                                    const titleText = await sectionTitle.getText();
                                    return titleText.toLowerCase().includes("add new connection");
                                } catch {
                                    return false;
                                }
                            },
                            UITimeouts.MEDIUM,
                            "Waiting for form to reset after canceling edit"
                        );
                        // Re-fetch connections after canceling edit
                        continue;
                    } catch {
                        console.log("[Cleanup] Could not cancel edit mode. Skipping cleanup.");
                        break;
                    }
                }

                // Click delete button (this will open confirmation dialog)
                await clickDeleteConnection(driver, firstConnection);

                // Switch to default content BEFORE handling dialog (dialog blocks webview)
                await driver.switchTo().defaultContent();

                // Wait for dialog to appear
                await driver.wait(
                    until.elementLocated(By.css(".monaco-dialog-modal-block, .monaco-dialog, .monaco-dialog-box")),
                    UITimeouts.MEDIUM,
                    "Waiting for confirmation dialog to appear"
                );

                // Handle confirmation dialog (this will switch to default content internally)
                const dialogHandled = await handleConfirmationDialog(driver, "Delete");

                if (!dialogHandled) {
                    console.log("[Cleanup] Failed to handle confirmation dialog, skipping this connection");
                    // Try to cancel the dialog if it's still open
                    try {
                        await driver.switchTo().defaultContent();
                        const cancelButtons = await driver.findElements(
                            By.xpath("//button[contains(text(), 'Cancel') or contains(text(), 'No')]")
                        );
                        if (cancelButtons.length > 0) {
                            await cancelButtons[0].click();

                            // Wait for dialog to disappear
                            await driver.wait(
                                async () => {
                                    const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
                                    return modalBlocks.length === 0;
                                },
                                UITimeouts.MEDIUM,
                                "Waiting for dialog to close after cancel"
                            );
                        }
                    } catch {
                        // Ignore errors when trying to cancel
                    }
                    continue; // Skip this connection and try next
                }

                // Wait for dialog to be fully closed and webview to be accessible
                await driver.wait(
                    async () => {
                        const modalBlocks = await driver.findElements(By.css(".monaco-dialog-modal-block"));
                        if (modalBlocks.length > 0) {
                            return false;
                        }
                        // Try to switch back to webview to verify it's accessible
                        try {
                            return await findAndSwitchToWebview(driver);
                        } catch {
                            return false;
                        }
                    },
                    UITimeouts.MEDIUM,
                    "Waiting for dialog to close and webview to be accessible"
                );

                deletedCount++;
            } catch (error) {
                console.log(`[Cleanup] Error deleting connection: ${error}`);
                // Try to switch back to webview and continue
                try {
                    await findAndSwitchToWebview(driver);
                } catch {
                    // If we can't switch back, break the loop
                    break;
                }
            }
        }

        // Switch back to default content
        await driver.switchTo().defaultContent();

        if (deletedCount > 0) {
            console.log(`[Cleanup] Deleted ${deletedCount} connection(s)`);
        }

        return deletedCount;
    } catch (error) {
        console.log(`[Cleanup] Error during connection cleanup: ${error}`);
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore errors when switching back
        }
        return 0;
    }
}

/**
 * Clicks the save connection button and waits for the operation to complete.
 *
 * @param driver - The WebDriver instance
 * @param waitForUpdate - Whether to wait for the connections list to update (default: true)
 * @param timeout - Maximum time to wait (default: 10000ms)
 * @returns Promise<void>
 */
export async function saveConnection(
    driver: WebDriver,
    waitForUpdate: boolean = true,
    timeout: number = UITimeouts.LONG
): Promise<void> {
    const saveButton = await driver.findElement(By.id(ConnectionFormElements.SAVE_BUTTON));
    await saveButton.click();
    await applySlowMotion(driver); // Visible: clicking save button

    if (waitForUpdate) {
        // Wait for connections list to be present and updated (background operation)
        await driver.wait(
            until.elementLocated(By.id(ConnectionFormElements.CONNECTIONS_LIST)),
            timeout,
            "Waiting for connections list to update"
        );

        // Wait for UI to settle and for form to reset (section title changes back to "Add New Connection")
        // Also wait for connections list to be updated (connection items to appear)
        await driver.wait(
            async () => {
                try {
                    // Check if form is reset (not in edit mode)
                    const sectionTitle = await driver.findElement(By.id(ConnectionFormElements.SECTION_TITLE));
                    const titleText = await sectionTitle.getText();
                    const isReset = titleText.toLowerCase().includes("add new connection");

                    // Verify connections list has items (connection was saved)
                    const connections = await getAllConnections(driver);
                    const hasConnections = connections.length > 0;
                    return isReset && hasConnections;
                } catch {
                    return false;
                }
            },
            UITimeouts.MEDIUM,
            "Waiting for UI to settle after save and connection to appear in list"
        );
    }
}

/**
 * Creates a new connection using the provided form data.
 *
 * @param driver - The WebDriver instance
 * @param formData - The connection form data
 * @returns Promise<number> - The connection count after creation
 */
export async function createConnection(driver: WebDriver, formData: ConnectionFormData): Promise<number> {
    await fillConnectionForm(driver, formData);
    await saveConnection(driver);
    return await getConnectionCount(driver);
}

/**
 * Clicks the edit button for a connection found in the list.
 *
 * @param driver - The WebDriver instance
 * @param connectionElement - The connection list item element
 * @returns Promise<void>
 */
export async function clickEditConnection(driver: WebDriver, connectionElement: WebElement): Promise<void> {
    const editButton = await connectionElement.findElement(By.css("button.edit-btn"));
    await editButton.click();
    await applySlowMotion(driver); // Visible: clicking edit button

    // Wait for UI to update and for form to enter edit mode
    await driver.wait(
        async () => {
            return await isEditMode(driver);
        },
        UITimeouts.MEDIUM,
        "Waiting for form to enter edit mode"
    );
}

/**
 * Clicks the delete button for a connection found in the list.
 *
 * @param driver - The WebDriver instance
 * @param connectionElement - The connection list item element
 * @returns Promise<void>
 */
export async function clickDeleteConnection(driver: WebDriver, connectionElement: WebElement): Promise<void> {
    const deleteButton = await connectionElement.findElement(By.css("button.delete-btn"));
    await deleteButton.click();
    await applySlowMotion(driver); // Visible: clicking delete button
}

/**
 * Clicks the login button for a connection found in the list.
 *
 * @param driver - The WebDriver instance
 * @param connectionElement - The connection list item element
 * @returns Promise<void>
 */
export async function clickLoginConnection(driver: WebDriver, connectionElement: WebElement): Promise<void> {
    const loginButton = await connectionElement.findElement(By.css("button.login-btn"));
    await loginButton.click();
    await applySlowMotion(driver); // Visible: clicking login button
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

        console.log(`[Dialog] Looking for confirmation dialog with button: "${buttonText}"`);

        // First, wait for the dialog modal to appear (monaco-dialog-modal-block or monaco-dialog)
        let dialogElement: WebElement | null = null;
        try {
            await driver.wait(
                until.elementLocated(By.css(".monaco-dialog-modal-block, .monaco-dialog, .monaco-dialog-box")),
                timeout,
                "Waiting for dialog modal to appear"
            );
            console.log("[Dialog] Dialog modal appeared");

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
                2000,
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
                    console.log(`[Dialog] Found dialog element with selector: ${selector}`);
                    break;
                } catch {
                    // Try next selector
                }
            }

            if (!dialogElement) {
                console.log("[Dialog] Dialog element not found with standard selectors, searching in document");
            }
        } catch {
            console.log("[Dialog] Dialog modal not found, but continuing to search for button");
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

                    // Also try by aria-label
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
            console.log(`[Dialog] Found ${tagName} element with text: "${buttonTextFound}", clicking...`);

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
                1000,
                "Waiting for button to be clickable"
            );

            try {
                await confirmButton.click();
                await applySlowMotion(driver); // Visible: clicking confirmation dialog button
            } catch (clickError) {
                // If click fails, try JavaScript click
                console.log(`[Dialog] Regular click failed, trying JavaScript click: ${clickError}`);
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
                console.log("[Dialog] Dialog closed successfully");
            } catch {
                console.log("[Dialog] Dialog may have closed, but modal-block still present");
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
        console.log(`[Dialog] Button "${buttonText}" not found with XPath, trying JavaScript search...`);
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
                console.log(`[Dialog] Found button using JavaScript, clicking...`);
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
                    console.log("[Dialog] Dialog closed successfully using JavaScript click");
                    return true;
                }
            }
        } catch (jsError) {
            console.log(`[Dialog] JavaScript search failed: ${jsError}`);
        }

        // If button still not found, try keyboard navigation (Enter key for primary button)
        console.log(`[Dialog] Button "${buttonText}" not found, trying keyboard navigation (Enter key)...`);
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

            // Press Enter to activate the primary button (Delete is highlighted/primary)
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
                console.log("[Dialog] Dialog closed using Enter key");
                return true;
            }
        } catch (keyboardError) {
            console.log(`[Dialog] Keyboard navigation failed: ${keyboardError}`);
        }

        console.log(`[Dialog] Button "${buttonText}" not found with any strategy`);
        return false;
    } catch (error) {
        console.log(`[Dialog] Error finding button with primary strategy: ${error}`);
        // Dialog might have different structure, try alternative approach
        try {
            // Wait for dialog to appear first
            try {
                await driver.wait(
                    until.elementLocated(By.css(".monaco-dialog, .monaco-dialog-modal-block")),
                    2000,
                    "Waiting for dialog"
                );
            } catch {
                // Dialog might already be there or not appear
            }

            // Use JavaScript to find all buttons/links (can access shadow DOM and any structure)
            console.log("[Dialog] Using JavaScript to search for buttons in fallback strategy...");
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

            console.log(`[Dialog] JavaScript found ${buttonInfo.length} button/link element(s):`);
            for (const btn of buttonInfo) {
                console.log(
                    `[Dialog]   - ${btn.tagName} (class: ${btn.className}): text="${btn.text}", aria-label="${btn.ariaLabel}"`
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
                console.log(`[Dialog] Successfully clicked button using JavaScript in fallback`);
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
                    console.log("[Dialog] Dialog closed successfully");
                } catch {
                    console.log("[Dialog] Dialog may have closed");
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

            console.log(`[Dialog] Could not find button "${buttonText}" using JavaScript in fallback`);
        } catch (fallbackError) {
            console.log(`[Dialog] Fallback strategy also failed: ${fallbackError}`);
        }
        return false;
    }
}

/**
 * Gets the message text from the messages div.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait for message (default: 5000ms)
 * @returns Promise<string> - The message text
 */
export async function getMessageText(driver: WebDriver, timeout: number = UITimeouts.MEDIUM): Promise<string> {
    const messagesDiv = await driver.wait(
        until.elementLocated(By.id(ConnectionFormElements.MESSAGES)),
        timeout,
        "Waiting for message to appear"
    );
    return await messagesDiv.getText();
}

/**
 * Resets the connection form to its initial state.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<void>
 */
export async function resetConnectionForm(driver: WebDriver): Promise<void> {
    const form = await driver.findElement(By.id(ConnectionFormElements.ADD_CONNECTION_FORM));
    await driver.executeScript("arguments[0].reset();", form);
}

/**
 * Verifies that the form is in edit mode.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if in edit mode, false otherwise
 */
export async function isEditMode(driver: WebDriver): Promise<boolean> {
    try {
        const sectionTitle = await driver.findElement(By.id(ConnectionFormElements.SECTION_TITLE));
        const titleText = await sectionTitle.getText();
        return titleText.toLowerCase().includes("edit");
    } catch {
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
        console.log(`[Notification] Error finding notification button: ${error}`);
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
            console.log(`[Notification] Button "${buttonText}" not found in notification`);
            return false;
        }

        console.log(`[Notification] Found notification button "${buttonText}", clicking...`);
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
        console.log(`[Notification] Error clicking notification button: ${error}`);
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
            console.log("[Login] User is already logged in");
            return true;
        }

        console.log("[Login] User is not logged in. Performing login...");

        if (!hasTestCredentials() && !credentials) {
            console.log("[Login] Test credentials not available");
            return false;
        }

        const creds = credentials || getTestCredentials();

        await openTestBenchSidebar(driver);

        const webviewFound = await findAndSwitchToWebview(driver);
        if (!webviewFound) {
            console.log("[Login] Webview not found");
            return false;
        }

        // Wait for connections list to be available
        try {
            await driver.wait(
                until.elementLocated(By.id(ConnectionFormElements.CONNECTIONS_LIST)),
                UITimeouts.MEDIUM,
                "Waiting for connections list to be available"
            );
        } catch {
            // Connections list might not exist yet, continue anyway
            console.log("[Login] Connections list not found, will create new connection");
        }

        const { element: existingConnection, found: connectionExists } = await findConnectionInList(
            driver,
            creds.connectionLabel
        );

        if (!connectionExists || !existingConnection) {
            console.log("[Login] Creating new connection...");
            await resetConnectionForm(driver);

            const formData: ConnectionFormData = {
                connectionLabel: creds.connectionLabel,
                serverName: creds.serverName,
                portNumber: creds.portNumber,
                username: creds.username,
                password: creds.password,
                storePassword: true
            };

            await fillConnectionForm(driver, formData);
            await saveConnection(driver);

            // Switch to default content to handle "Save Changes" dialog if it appears
            await driver.switchTo().defaultContent();

            // Handle "Save Changes" confirmation dialog if it appears
            // This dialog may appear when saving a connection
            try {
                await handleConfirmationDialog(driver, "Save Changes", UITimeouts.SHORT);
                console.log("[Login] Handled 'Save Changes' dialog");
            } catch {
                console.log("[Login] No 'Save Changes' dialog appeared");
            }

            const webviewFoundAgain = await findAndSwitchToWebview(driver);
            if (!webviewFoundAgain) {
                console.log("[Login] Could not switch back to webview after handling dialog");
                return false;
            }

            await driver.wait(
                async () => {
                    const { found } = await findConnectionInList(driver, creds.connectionLabel);
                    return found;
                },
                UITimeouts.LONG,
                "Waiting for connection to appear in list"
            );
        }

        const { element: connectionElement, found } = await findConnectionInList(driver, creds.connectionLabel);

        if (!found || !connectionElement) {
            const connectionString = `${creds.username}@${creds.serverName}`;
            const { element: connectionByString } = await findConnectionInList(driver, connectionString);
            if (connectionByString) {
                await clickLoginConnection(driver, connectionByString);
            } else {
                console.log("[Login] Connection not found in list");
                return false;
            }
        } else {
            await clickLoginConnection(driver, connectionElement);
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

        console.log("[Login] Login successful");
        return true;
    } catch (error) {
        console.log(`[Login] Error during login: ${error}`);
        try {
            await driver.switchTo().defaultContent();
        } catch {
            // Ignore errors when switching back
        }
        return false;
    }
}

/**
 * Finds a specific section in the sidebar by title.
 *
 * @param content - The sidebar content
 * @param sectionTitle - The title of the section to find (can be partial match)
 * @returns Promise<any | null> - The section or null if not found
 */
export async function findSidebarSection(content: any, sectionTitle: string): Promise<any | null> {
    try {
        const sections = await content.getSections();
        for (const section of sections) {
            const title = await section.getTitle();
            if (title.includes(sectionTitle)) {
                return section;
            }
        }
        return null;
    } catch (error) {
        console.log(`[Sidebar] Error finding section "${sectionTitle}": ${error}`);
        return null;
    }
}

/**
 * Gets the title of a sidebar section.
 *
 * @param section - The sidebar section
 * @returns Promise<string | null> - The section title or null if not found
 */
export async function getSectionTitle(section: any): Promise<string | null> {
    try {
        return await section.getTitle();
    } catch (error) {
        console.log(`[Sidebar] Error getting section title: ${error}`);
        return null;
    }
}

/**
 * Clicks a toolbar button in a sidebar section by title.
 *
 * @param section - The sidebar section
 * @param buttonTitle - The title/aria-label of the button to click
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function clickToolbarButton(section: any, buttonTitle: string, driver: WebDriver): Promise<boolean> {
    try {
        // Get the toolbar actions
        const actions = await section.getActions();
        for (const action of actions) {
            const title = await action.getTitle();
            if (title.includes(buttonTitle)) {
                await action.click();
                await applySlowMotion(driver);
                return true;
            }
        }
        console.log(`[Toolbar] Button "${buttonTitle}" not found in toolbar`);
        return false;
    } catch (error) {
        console.log(`[Toolbar] Error clicking toolbar button "${buttonTitle}": ${error}`);
        return false;
    }
}

/**
 * Double-clicks a tree item.
 *
 * @param item - The tree item to double-click
 * @param driver - The WebDriver instance
 * @returns Promise<void>
 */
export async function doubleClickTreeItem(item: TreeItem, driver: WebDriver): Promise<void> {
    try {
        // Get the element and perform double-click
        const element = await item.findElement(By.css(".monaco-icon-name-container"));
        await driver.actions().doubleClick(element).perform();
        await applySlowMotion(driver);
    } catch (error) {
        // Fallback: try clicking twice
        console.log(`[TreeItem] Double-click failed, trying alternative method: ${error}`);
        try {
            await item.click();
            await driver.sleep(100);
            await item.click();
            await applySlowMotion(driver);
        } catch (fallbackError) {
            console.log(`[TreeItem] Alternative double-click also failed: ${fallbackError}`);
            throw fallbackError;
        }
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
    console.log(`[CodeLens] Starting exact DOM search and click for: "${codeLensText}"`);

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
                            console.log(`[CodeLens] Found visible link for "${codeLensText}"`);

                            // 2. Scroll into view (Center)
                            await driver.executeScript(
                                "arguments[0].scrollIntoView({block: 'center', inline: 'center'});",
                                link
                            );
                            await driver.sleep(200); // Stabilization pause

                            // 3. Dispatch Full Mouse Event Chain
                            // VS Code often listens for 'mousedown' or 'mouseup' on these widgets, not just 'click'
                            console.log(`[CodeLens] Dispatching MouseEvents (mousedown + click)...`);
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
        console.log(`[CodeLens] FINAL FAILURE: ${e}`);
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
            console.log("[RefactorPreview] Found Apply button, clicking...");
            await applyButton.click();
            await applySlowMotion(driver);
            return true;
        }

        console.log("[RefactorPreview] Apply button not found using specific selector");
        return false;
    } catch (error) {
        console.log(`[RefactorPreview] Error clicking Apply button: ${error}`);
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
                            // Find the specific checkbox input within this row
                            // Structure: row -> content -> input.edit-checkbox
                            const checkbox = await row.findElement(By.css("input.edit-checkbox"));
                            const selected = await checkbox.isSelected();

                            // If we found the correct row, return its state
                            return selected;
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
        console.log(`[RefactorPreview] Error verifying checkbox: ${error}`);
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
        const isChecked = await verifyRefactorPreviewCheckbox(driver, fileName, 2000);
        if (isChecked) {
            console.log(`[RefactorPreview] Item "${fileName}" is already checked.`);
            return true;
        }

        console.log(`[RefactorPreview] Item "${fileName}" is unchecked. Clicking to select...`);

        // Find and click the checkbox
        const rows = await driver.findElements(By.css(".monaco-list-row"));
        for (const row of rows) {
            const text = await row.getText();
            if (text.includes(fileName)) {
                const checkbox = await row.findElement(By.css("input.edit-checkbox"));

                // Use JS click for reliability with Monaco checkboxes
                await driver.executeScript("arguments[0].click();", checkbox);
                await applySlowMotion(driver);
                return true;
            }
        }
        return false;
    } catch (error) {
        console.log(`[RefactorPreview] Error ensuring item checked: ${error}`);
        return false;
    }
}

/**
 * Clicks the "Create Resource" button on a tree item in Test Elements view.
 * The button uses the $(new-file) codicon and is an inline action button.
 *
 * @param item - The tree item (subdivision) to click the button on
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if button was found and clicked, false otherwise
 */
export async function clickCreateResourceButton(item: TreeItem, driver: WebDriver): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        // Get the tree item label for matching
        const itemLabel = await item.getLabel();
        console.log(`[TreeItem] Looking for Create Resource button near item: "${itemLabel}"`);

        // Find the button in the same row as the tree item
        const button = await driver.wait(
            async () => {
                try {
                    // Strategy 1: Find the tree item row first, then look for inline action buttons
                    const allRows = await driver.findElements(By.css(".monaco-list-row"));

                    for (const row of allRows) {
                        try {
                            const rowText = await row.getText();
                            // Check if this row contains our tree item
                            if (!rowText.includes(itemLabel)) {
                                continue;
                            }

                            // Look for inline action buttons in this row
                            // Inline action buttons are typically <a> elements with action-item class
                            // or buttons with codicon classes
                            const actionButtons = await row.findElements(
                                By.css("a.action-item, button.action-item, a[class*='action'], button[class*='action']")
                            );

                            // Also look for elements containing the codicon-new-file icon
                            const codiconButtons = await row.findElements(
                                By.css(".codicon-new-file, [class*='codicon-new-file'], span.codicon-new-file")
                            );

                            // Combine both sets
                            const allButtons = [...actionButtons, ...codiconButtons];

                            for (const btn of allButtons) {
                                try {
                                    // Get the actual clickable element (might be the button itself or its parent)
                                    let clickableElement: WebElement = btn;

                                    // If it's a span with codicon, find the parent action-item
                                    const tagName = await btn.getTagName();
                                    if (tagName === "span") {
                                        try {
                                            const parent = await btn.findElement(
                                                By.xpath(
                                                    "./ancestor::a[contains(@class, 'action-item')] | ./ancestor::button[contains(@class, 'action-item')]"
                                                )
                                            );
                                            clickableElement = parent;
                                        } catch {
                                            // If no parent action-item found, try clicking the span itself
                                        }
                                    }

                                    const isDisplayed = await clickableElement.isDisplayed();
                                    if (!isDisplayed) {
                                        continue;
                                    }

                                    // Check by icon class (codicon-new-file)
                                    const className = await btn.getAttribute("class");
                                    if (className && className.includes("codicon-new-file")) {
                                        console.log(`[TreeItem] Found button by codicon-new-file class`);
                                        return clickableElement;
                                    }

                                    // Check by aria-label or title
                                    const ariaLabel = await clickableElement.getAttribute("aria-label");
                                    const title = await clickableElement.getAttribute("title");

                                    if (
                                        (ariaLabel &&
                                            (ariaLabel.includes("Create Resource") || ariaLabel.includes("Create"))) ||
                                        (title && (title.includes("Create Resource") || title.includes("Create")))
                                    ) {
                                        console.log(
                                            `[TreeItem] Found button by aria-label/title: "${ariaLabel || title}"`
                                        );
                                        return clickableElement;
                                    }

                                    // Check if button contains codicon-new-file as a child
                                    try {
                                        const codiconChild = await clickableElement.findElement(
                                            By.css(".codicon-new-file, span.codicon-new-file")
                                        );
                                        if (codiconChild) {
                                            console.log(`[TreeItem] Found button containing codicon-new-file icon`);
                                            return clickableElement;
                                        }
                                    } catch {
                                        // No codicon child found
                                    }
                                } catch {
                                    // Continue searching
                                }
                            }

                            // Strategy 2: Look for any button/action in the row and check if it has the new-file icon
                            const anyButtons = await row.findElements(By.css("a, button"));
                            for (const btn of anyButtons) {
                                try {
                                    const isDisplayed = await btn.isDisplayed();
                                    if (!isDisplayed) {
                                        continue;
                                    }

                                    // Check if button contains codicon-new-file
                                    const hasCodicon = await btn.findElements(
                                        By.css(".codicon-new-file, span.codicon-new-file")
                                    );
                                    if (hasCodicon.length > 0) {
                                        console.log(`[TreeItem] Found button with codicon-new-file child`);
                                        return btn;
                                    }

                                    // Check aria-label
                                    const ariaLabel = await btn.getAttribute("aria-label");
                                    if (ariaLabel && ariaLabel.toLowerCase().includes("create resource")) {
                                        console.log(`[TreeItem] Found button by aria-label: "${ariaLabel}"`);
                                        return btn;
                                    }
                                } catch {
                                    // Continue searching
                                }
                            }
                        } catch {
                            // Continue to next row
                            continue;
                        }
                    }

                    // Strategy 3: Use JavaScript to find the button
                    console.log("[TreeItem] Trying JavaScript-based search...");
                    const buttonFound = (await driver.executeScript(`
                        function findCreateResourceButton(itemLabel) {
                            const rows = document.querySelectorAll('.monaco-list-row');
                            for (const row of rows) {
                                const rowText = row.textContent || row.innerText || '';
                                if (!rowText.includes('${itemLabel}')) {
                                    continue;
                                }
                                
                                // Look for action buttons with codicon-new-file
                                const actionButtons = row.querySelectorAll('a.action-item, button.action-item, a[class*="action"], button[class*="action"]');
                                for (const btn of actionButtons) {
                                    // Check if button contains codicon-new-file
                                    const codicon = btn.querySelector('.codicon-new-file, span.codicon-new-file');
                                    if (codicon) {
                                        return btn;
                                    }
                                    
                                    // Check aria-label
                                    const ariaLabel = btn.getAttribute('aria-label') || '';
                                    if (ariaLabel.toLowerCase().includes('create resource')) {
                                        return btn;
                                    }
                                }
                                
                                // Also check for any element with codicon-new-file in this row
                                const codiconElements = row.querySelectorAll('.codicon-new-file, [class*="codicon-new-file"]');
                                for (const codicon of codiconElements) {
                                    const actionItem = codicon.closest('a.action-item, button.action-item, a[class*="action"], button[class*="action"]');
                                    if (actionItem) {
                                        return actionItem;
                                    }
                                }
                            }
                            return null;
                        }
                        const btn = findCreateResourceButton('${itemLabel}');
                        if (btn) {
                            btn.scrollIntoView({ block: 'center' });
                            return btn;
                        }
                        return null;
                    `)) as WebElement | null;

                    if (buttonFound) {
                        console.log("[TreeItem] Found button using JavaScript");
                        return buttonFound;
                    }

                    return null;
                } catch (error) {
                    console.log(`[TreeItem] Error in button search: ${error}`);
                    return null;
                }
            },
            UITimeouts.LONG,
            `Waiting for Create Resource button near item "${itemLabel}"`
        );

        if (button) {
            console.log("[TreeItem] Found Create Resource button, clicking...");
            // Scroll button into view if not already done
            try {
                await driver.executeScript("arguments[0].scrollIntoView({ block: 'center' });", button);
            } catch {
                // Ignore scroll errors
            }

            // Try regular click first
            try {
                await button.click();
            } catch (clickError) {
                // Fallback to JavaScript click
                console.log(`[TreeItem] Regular click failed, trying JavaScript click: ${clickError}`);
                await driver.executeScript("arguments[0].click();", button);
            }

            await applySlowMotion(driver);
            return true;
        }

        console.log("[TreeItem] Create Resource button not found");
        return false;
    } catch (error) {
        console.log(`[TreeItem] Error clicking Create Resource button: ${error}`);
        return false;
    }
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
 * @param timeout - Maximum time to wait (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if pins appeared or configuration already exists, false if timeout
 */
export async function waitForConfigurationApplied(
    driver: WebDriver,
    projectName: string,
    tovName: string,
    projectsSection: any,
    targetProject: TreeItem,
    targetVersion: TreeItem,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    try {
        console.log("[Configuration] Waiting for configuration to be applied (checking for pin emojis)...");

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
                            console.log(`[Configuration] Found pin on project "${projectName}"`);
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
                            console.log(`[Configuration] Found pin on TOV "${tovName}"`);
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
            console.log("[Configuration] Configuration applied successfully - pins detected");
            // Wait a bit more for tree to fully stabilize after reordering
            await driver.sleep(1000);
            return true;
        }

        // If pins didn't appear within timeout, configuration might already exist (no reordering needed)
        console.log(
            "[Configuration] Pins not detected within timeout - configuration may already exist or tree may not have updated"
        );
        // Still wait a bit for tree to stabilize
        await driver.sleep(500);
        return true;
    } catch (error) {
        console.log(`[Configuration] Error waiting for configuration to be applied: ${error}`);
        // If timeout, assume configuration already exists and continue
        // Still wait a bit for tree to stabilize
        await driver.sleep(500);
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
        console.log("[Configuration] Clicking cycle to check for configuration prompt...");

        // Click the cycle once (single click) - this may trigger the configuration prompt
        await cycleItem.click();
        await applySlowMotion(driver);

        // Wait for and click the Create button in the notification if it appears
        const notificationText = `TestBench project configuration`;

        const notificationClicked = await clickNotificationButton(driver, "Create", notificationText);

        if (notificationClicked) {
            console.log("[Configuration] Configuration prompt appeared and Create button was clicked");

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
                console.log(
                    "[Configuration] Warning: Configuration may not have been fully applied, continuing anyway"
                );
            }

            return true;
        } else {
            console.log("[Configuration] No configuration prompt appeared (configuration may already exist)");
            // Configuration prompt didn't appear, which is fine - configuration may already exist
            return true;
        }
    } catch (error) {
        console.log(`[Configuration] Error handling configuration prompt: ${error}`);
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
                    const projectsSection = await findSidebarSection(content, "Projects");
                    return projectsSection !== null;
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
                    const testThemesSection = await findSidebarSection(content, "Test Themes");
                    const testElementsSection = await findSidebarSection(content, "Test Elements");
                    return testThemesSection !== null && testElementsSection !== null;
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
            console.log("[Editor] Quick input dialog detected, closing...");
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
        console.log(`[Editor] Setting cursor to line ${lineNumber}, column ${column}...`);

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
        console.log(`[Editor] Cursor set to line ${lineNumber}, column ${column}`);
        return true;
    } catch (error) {
        console.log(`[Editor] Error setting cursor position: ${error}`);
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
            console.log(`[Editor] Cursor set using click fallback`);
            return true;
        } catch (fallbackError) {
            console.log(`[Editor] Fallback cursor positioning also failed: ${fallbackError}`);
            return false;
        }
    }
}

/**
 * Deletes all content from a specific line number onwards in a TextEditor.
 * Keeps lines before the specified line number intact.
 *
 * @param editor - The TextEditor instance
 * @param driver - The WebDriver instance
 * @param fromLine - The line number from which to start deleting (1-based, inclusive)
 * @returns Promise<boolean> - True if deletion was successful, false otherwise
 */
export async function deleteFromLineOnwards(editor: TextEditor, driver: WebDriver, fromLine: number): Promise<boolean> {
    try {
        console.log(`[Editor] Deleting content from line ${fromLine} onwards...`);

        // Close any open quick input dialogs
        await closeQuickInputDialog(driver);

        // Ensure the editor is focused
        await editor.click();
        await driver.sleep(200);

        // Navigate to the start of the line from which we want to delete
        const isMac = process.platform === "darwin";
        const ctrlKey = isMac ? Key.COMMAND : Key.CONTROL;

        // Go to beginning of file first
        await driver.actions().keyDown(ctrlKey).sendKeys(Key.HOME).keyUp(ctrlKey).perform();
        await driver.sleep(100);

        // Navigate to the target line using arrow keys
        for (let i = 1; i < fromLine; i++) {
            await driver.actions().sendKeys(Key.ARROW_DOWN).perform();
            await driver.sleep(50);
        }

        // Go to the beginning of the target line
        await driver.actions().sendKeys(Key.HOME).perform();
        await driver.sleep(100);

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
        await driver.sleep(200);

        await applySlowMotion(driver);
        console.log(`[Editor] Content from line ${fromLine} onwards deleted`);
        return true;
    } catch (error) {
        console.log(`[Editor] Error deleting content from line ${fromLine}: ${error}`);

        // Fallback: Try using TextEditor's text manipulation methods
        try {
            const isMac = process.platform === "darwin";
            const ctrlKey = isMac ? Key.COMMAND : Key.CONTROL;

            // Get current text
            const currentText = await editor.getText();
            const lines = currentText.split("\n");

            // Keep only lines before fromLine
            if (lines.length >= fromLine) {
                const linesToKeep = lines.slice(0, fromLine - 1);
                const newText = linesToKeep.join("\n");

                // Select all and replace
                await editor.click();
                await driver.sleep(100);
                await driver.actions().keyDown(ctrlKey).sendKeys("a").keyUp(ctrlKey).perform();
                await driver.sleep(100);
                await driver.actions().sendKeys(newText).perform();
                await driver.sleep(200);

                console.log(`[Editor] Content deleted using fallback method`);
                return true;
            }
        } catch (fallbackError) {
            console.log(`[Editor] Fallback deletion also failed: ${fallbackError}`);
        }

        return false;
    }
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

/**
 * Waits for a tree item's action button to become visible.
 * This is useful when a button only appears after expanding or interacting with a tree item.
 *
 * @param item - The tree item
 * @param driver - The WebDriver instance
 * @param buttonText - The text/aria-label of the button to wait for (optional)
 * @param timeout - Maximum time to wait (default: UITimeouts.MEDIUM)
 * @returns Promise<boolean> - True if button became visible, false if timeout
 */
export async function waitForTreeItemButton(
    item: TreeItem,
    driver: WebDriver,
    buttonText?: string,
    timeout: number = UITimeouts.MEDIUM
): Promise<boolean> {
    try {
        await driver.switchTo().defaultContent();

        const itemLabel = await item.getLabel();

        await driver.wait(
            async () => {
                try {
                    // Try to find buttons near the tree item
                    const buttons = await driver.findElements(
                        By.xpath(
                            `//div[contains(@class, 'monaco-list-row')]//button[contains(@aria-label, '${buttonText || "Create"}') or contains(@title, '${buttonText || "Create"}')]`
                        )
                    );

                    // Filter buttons to find the one near our tree item
                    for (const btn of buttons) {
                        try {
                            const row = await btn.findElement(
                                By.xpath("./ancestor::div[contains(@class, 'monaco-list-row')]")
                            );
                            const rowText = await row.getText();
                            if (rowText.includes(itemLabel)) {
                                const isDisplayed = await btn.isDisplayed();
                                if (isDisplayed) {
                                    return true;
                                }
                            }
                        } catch {
                            // Continue searching
                        }
                    }

                    return false;
                } catch {
                    return false;
                }
            },
            timeout,
            `Waiting for button to become visible for tree item "${itemLabel}"`
        );
        return true;
    } catch {
        return false;
    }
}
