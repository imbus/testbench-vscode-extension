/**
 * @file src/test/ui/testUtils.ts
 * @description Utility functions and constants for UI tests
 */

import { getSlowMotionDelay } from "./testConfig";
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
    Key
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
 * Ensures a specific workspace folder is open in VS Code.
 * Handles creation, cleaning, and window reloading logic.
 * * @param config Configuration object for the workspace
 */
export async function ensureWorkspaceIsOpen(config: WorkspaceConfig = {}): Promise<void> {
    const { workspaceName = "test-workspace", cleanStart = false } = config;
    const browser = VSBrowser.instance;

    // Resolve path relative to project root
    // Adjust "../../../" if testUtils.ts location changes
    const projectRoot = path.resolve(__dirname, "../../../");
    const workspacePath = path.join(projectRoot, workspaceName);

    if (cleanStart && fs.existsSync(workspacePath)) {
        console.log(`[Workspace] Cleaning existing workspace: ${workspacePath}`);
        fs.rmSync(workspacePath, { recursive: true, force: true });
    }

    if (!fs.existsSync(workspacePath)) {
        console.log(`[Workspace] Creating folder: ${workspacePath}`);
        fs.mkdirSync(workspacePath, { recursive: true });
    }

    // Check if the specific workspace is already open to prevent unnecessary reloads
    const title = await browser.driver.getTitle();
    if (title.includes(workspaceName)) {
        console.log(`[Workspace] '${workspaceName}' is already open.`);
        return;
    }

    console.log(`[Workspace] Opening folder: ${workspacePath}`);
    await browser.openResources(workspacePath);

    // Opening a folder refreshes the window, wait for window reload
    await browser.driver.wait(
        until.elementLocated(By.id("workbench.main.container")),
        15000,
        `Timeout waiting for workspace '${workspaceName}' to load`
    );
}

/**
 * Opens the TestBench sidebar by finding and clicking the TestBench activity bar item.
 *
 * @param driver - The WebDriver instance (optional, for waiting)
 * @returns Promise<void>
 */
export async function openTestBenchSidebar(driver?: WebDriver): Promise<void> {
    const activityBar = new ActivityBar();
    const controls = await activityBar.getViewControls();

    for (const control of controls) {
        const title = await control.getTitle();
        if (title === "TestBench") {
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
            return;
        }
    }
    throw new Error("TestBench activity bar item not found");
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
 * Timeout constants for UI operations (in milliseconds).
 */
export const UITimeouts = {
    SHORT: 2000,
    MEDIUM: 5000,
    LONG: 10000,
    VERY_LONG: 15000
} as const;

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
        // or for a connection to appear in the list
        await driver.wait(
            async () => {
                try {
                    // Check if form is reset (not in edit mode)
                    const sectionTitle = await driver.findElement(By.id(ConnectionFormElements.SECTION_TITLE));
                    const titleText = await sectionTitle.getText();
                    const isReset = titleText.toLowerCase().includes("add new connection");

                    // Also verify connections list has items (if we just saved)
                    const connections = await getAllConnections(driver);
                    return isReset || connections.length > 0;
                } catch {
                    return false;
                }
            },
            UITimeouts.MEDIUM,
            "Waiting for UI to settle after save"
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
