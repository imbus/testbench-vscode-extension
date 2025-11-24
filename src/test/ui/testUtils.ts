/**
 * @file src/test/ui/testUtils.ts
 * @description Utility functions and constants for UI tests
 */

import { WebDriver, Workbench, By, ActivityBar, SideBarView, WebElement, until } from "vscode-extension-tester";
import { getSlowMotionDelay } from "./testConfig";

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
 * Attempts to logout from TestBench if a session is active.
 * Uses the command palette to execute the logout command.
 * TODO: Expose logout command to users?
 *
 * @param driver - The WebDriver instance
 * @returns Promise<boolean> - True if logout was attempted, false if no active session
 */
export async function attemptLogout(driver: WebDriver): Promise<boolean> {
    try {
        const workbench = new Workbench();
        const commandPalette = await workbench.openCommandPrompt();

        // Search for logout command
        await commandPalette.setText(">TestBench: Logout");
        await driver.sleep(1000);

        const picks = await commandPalette.getQuickPicks();

        // Check if logout command is available (indicates active session)
        let logoutCommandFound = false;
        for (const pick of picks) {
            const text = await pick.getText();
            if (text.includes("Logout")) {
                logoutCommandFound = true;
                await pick.select();
                await driver.sleep(2000); // Wait for logout to complete
                break;
            }
        }

        if (!logoutCommandFound) {
            await commandPalette.cancel();
        }

        return logoutCommandFound;
    } catch (error) {
        // If command palette fails or logout command not found, assume no active session
        console.log("Logout attempt failed or no active session:", error);
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
        await driver.sleep(2000); // Wait for modal to appear
        const allowButtons = await driver.wait(async () => {
            const elements = await driver.findElements(By.xpath(ModalButtonSelectors.ALLOW));
            return elements.length > 0 ? elements : null;
        }, timeout);

        if (allowButtons && allowButtons.length > 0) {
            await allowButtons[0].click();
            console.log(`Clicked ${ModalButtonTexts.ALLOW} button`);
            await driver.sleep(3000); // Wait for action to complete
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
            await driver.sleep(2000); // Wait for action to complete
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

        // Small delay to ensure the clear operation completes
        await driver.sleep(50);
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
                        await driver.sleep(UITimeouts.SHORT);
                        // Re-fetch connections after canceling edit
                        continue;
                    } catch {
                        console.log("[Cleanup] Could not cancel edit mode. Skipping cleanup.");
                        break;
                    }
                }

                // Click delete button
                await clickDeleteConnection(driver, firstConnection);

                // Handle confirmation dialog
                await handleConfirmationDialog(driver, "Delete");

                // Switch back to webview to continue deleting
                await findAndSwitchToWebview(driver);
                await driver.sleep(UITimeouts.SHORT);

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
        // Additional small wait for UI to settle (background operation, no slow motion)
        await driver.sleep(UITimeouts.SHORT);
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
    // Small wait for UI to update (background operation, no slow motion)
    await driver.sleep(UITimeouts.SHORT);
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
        await driver.switchTo().defaultContent();
        await driver.sleep(UITimeouts.SHORT);

        // Try to find the confirmation button by text
        const confirmButton = await driver.wait(
            async () => {
                const buttons = await driver.findElements(By.xpath(`//button[contains(text(), '${buttonText}')]`));
                return buttons.length > 0 ? buttons[0] : null;
            },
            timeout,
            `Waiting for confirmation dialog with button: ${buttonText}`
        );

        if (confirmButton) {
            await confirmButton.click();
            await applySlowMotion(driver); // Visible: clicking confirmation dialog button
            return true;
        }
        return false;
    } catch {
        // Dialog might have different structure, try alternative approach
        try {
            const allButtons = await driver.findElements(By.css("button"));
            for (const button of allButtons) {
                const text = await button.getText();
                if (text.includes(buttonText)) {
                    await button.click();
                    await applySlowMotion(driver); // Visible: clicking confirmation dialog button
                    return true;
                }
            }
        } catch {
            // No dialog found
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
