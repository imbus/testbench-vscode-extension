/**
 * @file src/test/ui/pages/ConnectionPage.ts
 * @description Page Object Model for the Connection Management Webview.
 * Encapsulates all connection form interactions, connection list operations, and related UI elements.
 */

import { WebDriver, By, WebElement, until } from "vscode-extension-tester";
import { handleConfirmationDialog } from "../utils/dialogUtils";
import { findAndSwitchToWebview } from "../utils/webviewUtils";
import { UITimeouts, applySlowMotion, waitForCondition, retryUntil } from "../utils/waitHelpers";
import { getTestLogger } from "../utils/testLogger";

const CONNECTION_FORM_ELEMENT_IDS = {
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

const DIALOG_SELECTORS = ".monaco-dialog-modal-block, .monaco-dialog, .monaco-dialog-box";
const DIALOG_MODAL_BLOCK_SELECTOR = ".monaco-dialog-modal-block";

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

type ConnectionListAction = "edit" | "delete" | "login";

/**
 * Page Object Model for the Connection Management Webview.
 * Encapsulates all interactions with the connection form and connection list.
 */
export class ConnectionPage {
    private driver: WebDriver;
    private locators = {
        labelInput: By.id(CONNECTION_FORM_ELEMENT_IDS.CONNECTION_LABEL),
        serverInput: By.id(CONNECTION_FORM_ELEMENT_IDS.SERVER_NAME),
        portInput: By.id(CONNECTION_FORM_ELEMENT_IDS.PORT_NUMBER),
        usernameInput: By.id(CONNECTION_FORM_ELEMENT_IDS.USERNAME),
        passwordInput: By.id(CONNECTION_FORM_ELEMENT_IDS.PASSWORD),
        storePasswordCheckbox: By.id(CONNECTION_FORM_ELEMENT_IDS.STORE_PASSWORD_CHECKBOX),
        saveButton: By.id(CONNECTION_FORM_ELEMENT_IDS.SAVE_BUTTON),
        saveButtonText: By.id(CONNECTION_FORM_ELEMENT_IDS.SAVE_BUTTON_TEXT),
        cancelEditButton: By.id(CONNECTION_FORM_ELEMENT_IDS.CANCEL_EDIT_BUTTON),
        sectionTitle: By.id(CONNECTION_FORM_ELEMENT_IDS.SECTION_TITLE),
        messages: By.id(CONNECTION_FORM_ELEMENT_IDS.MESSAGES),
        connectionsList: By.id(CONNECTION_FORM_ELEMENT_IDS.CONNECTIONS_LIST),
        addConnectionForm: By.id(CONNECTION_FORM_ELEMENT_IDS.ADD_CONNECTION_FORM)
    };
    private readonly connectionActionSelectors: Record<ConnectionListAction, string> = {
        edit: "button.edit-btn",
        delete: "button.delete-btn",
        login: "button.login-btn"
    };

    constructor(driver: WebDriver) {
        this.driver = driver;
    }

    /**
     * Fills the connection form with the provided data.
     * Ensures fields are properly cleared before filling, especially to handle default values.
     *
     * @param data - The connection form data to fill
     */
    public async fillForm(data: ConnectionFormData): Promise<void> {
        const { connectionLabel = "", serverName, portNumber, username, password = "", storePassword = true } = data;

        if (connectionLabel) {
            await this.clearAndType(this.locators.labelInput, connectionLabel);
        } else {
            await this.clearField(this.locators.labelInput);
        }

        await this.clearAndType(this.locators.serverInput, serverName);
        await this.clearAndType(this.locators.portInput, portNumber);
        await this.clearAndType(this.locators.usernameInput, username);

        if (password) {
            await this.clearAndType(this.locators.passwordInput, password);
        } else {
            await this.clearField(this.locators.passwordInput);
        }

        // Handle checkbox
        const checkbox = await this.driver.findElement(this.locators.storePasswordCheckbox);
        const isChecked = await checkbox.isSelected();
        if (storePassword !== isChecked) {
            await checkbox.click();
            await applySlowMotion(this.driver);
        }
    }

    /**
     * Clicks the save connection button and waits for the operation to complete.
     * Handles the "Save Changes" overwrite confirmation dialog if it appears.
     *
     * @param waitForUpdate - Whether to wait for the connections list to update (default: true)
     * @param timeout - Maximum time to wait (default: UITimeouts.LONG)
     */
    public async save(waitForUpdate: boolean = true, timeout: number = UITimeouts.LONG): Promise<void> {
        await this.clickPrimarySaveButton();

        // Handle "Save Changes" overwrite confirmation dialog if it appears
        // This dialog appears when saving a connection with a name that already exists
        try {
            // Switch to default content to check for dialog (dialog is in main VS Code window, not webview)
            await this.driver.switchTo().defaultContent();

            // Check if dialog appeared (with short timeout since it may not appear)
            const dialogAppeared = await this.waitForDialogPresent(
                '"Save Changes" dialog to appear after save',
                UITimeouts.SHORT
            );

            if (dialogAppeared) {
                // Dialog appeared and is visible, handle it via shared host-dialog helper
                const logger = getTestLogger();
                const dialogHandled = await handleConfirmationDialog(this.driver, "Save Changes", UITimeouts.SHORT);
                if (dialogHandled) {
                    logger.info("ConnectionPage", "Handled 'Save Changes' overwrite dialog");
                } else {
                    logger.warn("ConnectionPage", "'Save Changes' dialog appeared but could not be handled");
                }

                // Wait for dialog to fully close
                const dialogClosed = await this.waitForDialogClosed('"Save Changes" dialog to close', UITimeouts.SHORT);
                if (!dialogClosed) {
                    logger.warn("ConnectionPage", "Timed out waiting for 'Save Changes' dialog to close");
                }
            }

            // Switch back to webview to continue
            await findAndSwitchToWebview(this.driver);
        } catch (error) {
            // If dialog handling fails, try to switch back to webview and continue
            const logger = getTestLogger();
            logger.warn("ConnectionPage", "Error handling Save Changes dialog, continuing anyway:", error);
            try {
                await findAndSwitchToWebview(this.driver);
            } catch {
                // If we can't switch back, the waitForUpdate check below will likely fail
            }
        }

        if (waitForUpdate) {
            // Wait for connections list to be present and updated
            await this.driver.wait(
                until.elementLocated(this.locators.connectionsList),
                timeout,
                "Waiting for connections list to update"
            );

            // Wait for UI to settle and for form to reset (section title changes back to "Add New Connection")
            // Also wait for connections list to be updated (connection items to appear)
            const uiSettled = await waitForCondition(
                this.driver,
                async () => {
                    try {
                        // Check if form is reset (not in edit mode)
                        const sectionTitle = await this.driver.findElement(this.locators.sectionTitle);
                        const titleText = await sectionTitle.getText();
                        const isReset = titleText.toLowerCase().includes("add new connection");

                        // Verify connections list has items (connection was saved)
                        const connections = await this.getAllConnections();
                        const hasConnections = connections.length > 0;
                        return isReset && hasConnections;
                    } catch {
                        return false;
                    }
                },
                UITimeouts.MEDIUM,
                100,
                "connection form/list to settle after save"
            );
            if (!uiSettled) {
                throw new Error("Timed out waiting for connection form/list to settle after save");
            }
        }
    }

    /**
     * Creates a new connection using the provided form data.
     *
     * @param data - The connection form data
     * @returns The connection count after creation
     */
    public async createConnection(data: ConnectionFormData): Promise<number> {
        await this.fillForm(data);
        await this.save();
        return await this.getConnectionCount();
    }

    /**
     * Resets the connection form to its initial state.
     */
    public async resetForm(): Promise<void> {
        const form = await this.driver.findElement(this.locators.addConnectionForm);
        await this.driver.executeScript("arguments[0].reset();", form);
    }

    /**
     * Clicks the primary save button without additional save-flow handling.
     *
     * @returns Promise that resolves after the click and slow-motion delay complete
     */
    public async clickPrimarySaveButton(): Promise<void> {
        const saveButton = await this.driver.findElement(this.locators.saveButton);
        await saveButton.click();
        await applySlowMotion(this.driver);
    }

    /**
     * Returns whether the "Store Password" checkbox is currently selected.
     *
     * @returns True when the checkbox is checked, otherwise false
     */
    public async isStorePasswordChecked(): Promise<boolean> {
        const checkbox = await this.driver.findElement(this.locators.storePasswordCheckbox);
        return checkbox.isSelected();
    }

    /**
     * Clears and sets the connection label input.
     *
     * @param label - New value for the connection label field
     * @returns Promise that resolves once typing is complete
     */
    public async setConnectionLabel(label: string): Promise<void> {
        await this.clearAndType(this.locators.labelInput, label);
    }

    /**
     * Returns true when the cancel edit button is visible.
     *
     * @returns True if the cancel edit button can be located and is displayed
     */
    public async isCancelEditButtonVisible(): Promise<boolean> {
        try {
            const cancelButton = await this.driver.findElement(this.locators.cancelEditButton);
            return await cancelButton.isDisplayed();
        } catch {
            return false;
        }
    }

    /**
     * Reads the current section title text.
     *
     * @returns Section title text, or empty string if unavailable
     */
    public async getSectionTitle(): Promise<string> {
        try {
            const sectionTitle = await this.driver.findElement(this.locators.sectionTitle);
            return await sectionTitle.getText();
        } catch {
            return "";
        }
    }

    /**
     * Waits for the connections list to be present in the webview.
     *
     * @param timeout - Maximum wait time in milliseconds
     * @returns True if the list is found before timeout, otherwise false
     */
    public async waitForConnectionsList(timeout: number = UITimeouts.MEDIUM): Promise<boolean> {
        try {
            await this.driver.wait(
                until.elementLocated(this.locators.connectionsList),
                timeout,
                "Waiting for connections list to be available"
            );
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Verifies that the form is in edit mode.
     *
     * @returns True if in edit mode, false otherwise
     */
    public async isEditMode(): Promise<boolean> {
        try {
            const titleText = await this.getSectionTitle();
            return titleText.toLowerCase().includes("edit");
        } catch {
            return false;
        }
    }

    /**
     * Gets the current validation error message text.
     *
     * @param timeout - Maximum time to wait for message (default: UITimeouts.MEDIUM)
     * @returns The message text
     */
    public async getErrorMessage(timeout: number = UITimeouts.MEDIUM): Promise<string> {
        try {
            const messagesDiv = await this.driver.wait(
                until.elementLocated(this.locators.messages),
                timeout,
                "Waiting for message to appear"
            );
            return await messagesDiv.getText();
        } catch {
            return "";
        }
    }

    /**
     * Gets the save button text (useful for verifying edit mode).
     *
     * @returns The save button text
     */
    public async getSaveButtonText(): Promise<string> {
        try {
            const saveButtonText = await this.driver.findElement(this.locators.saveButtonText);
            return await saveButtonText.getText();
        } catch {
            return "";
        }
    }

    /**
     * Clicks the cancel edit button and waits for form to reset.
     */
    public async cancelEdit(): Promise<void> {
        const cancelButton = await this.driver.findElement(this.locators.cancelEditButton);
        await cancelButton.click();
        await applySlowMotion(this.driver);

        // Wait for form to reset (section title should change back to "Add New Connection")
        const reset = await waitForCondition(
            this.driver,
            async () => {
                const titleText = await this.getSectionTitle();
                return titleText.toLowerCase().includes("add new connection");
            },
            UITimeouts.MEDIUM,
            100,
            "connection form to reset after canceling edit"
        );
        if (!reset) {
            throw new Error("Timed out waiting for connection form to reset after canceling edit");
        }
    }

    /**
     * Finds a connection in the connections list by label or connection string.
     *
     * @param searchText - The text to search for (label or connection string)
     * @returns The search result with element and found flag
     */
    public async findConnection(searchText: string): Promise<ConnectionSearchResult> {
        try {
            const connectionsList = await this.driver.findElement(this.locators.connectionsList);
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
     * @returns The number of connections
     */
    public async getConnectionCount(): Promise<number> {
        try {
            const connectionsList = await this.driver.findElement(this.locators.connectionsList);
            const connectionsItems = await connectionsList.findElements(By.css("li"));
            return connectionsItems.length;
        } catch {
            return 0;
        }
    }

    /**
     * Gets all connection list items from the connections list.
     *
     * @returns Array of connection list item elements
     */
    public async getAllConnections(): Promise<WebElement[]> {
        try {
            const connectionsList = await this.driver.findElement(this.locators.connectionsList);
            const connectionsItems = await connectionsList.findElements(By.css("li"));
            return connectionsItems;
        } catch {
            return [];
        }
    }

    /**
     * Returns whether a connection list action button is disabled.
     *
     * @param connectionElement - The connection list item element
     * @param action - The action button to inspect
     * @returns True if the action is disabled, otherwise false
     */
    public async isActionDisabled(connectionElement: WebElement, action: ConnectionListAction): Promise<boolean> {
        const actionButton = await this.getConnectionActionButton(connectionElement, action);
        const isDisabled = await actionButton.getAttribute("disabled");
        return isDisabled !== null;
    }

    /**
     * Clicks the edit button for a connection found in the list.
     *
     * @param connectionElement - The connection list item element
     */
    public async clickEdit(connectionElement: WebElement): Promise<void> {
        const editButton = await this.getConnectionActionButton(connectionElement, "edit");
        await editButton.click();
        await applySlowMotion(this.driver);

        // Wait for UI to update and for form to enter edit mode
        const enteredEditMode = await waitForCondition(
            this.driver,
            async () => {
                return await this.isEditMode();
            },
            UITimeouts.MEDIUM,
            100,
            "connection form to enter edit mode"
        );
        if (!enteredEditMode) {
            throw new Error("Timed out waiting for connection form to enter edit mode");
        }
    }

    /**
     * Clicks the delete button for a connection found in the list.
     *
     * @param connectionElement - The connection list item element
     */
    public async clickDelete(connectionElement: WebElement): Promise<void> {
        const deleteButton = await this.getConnectionActionButton(connectionElement, "delete");
        await deleteButton.click();
        await applySlowMotion(this.driver);
    }

    /**
     * Deletes a connection and handles the confirmation dialog.
     * This is a high-level method that handles the complete delete flow.
     *
     * @param connectionElement - The connection list item element
     * @returns True if deletion was successful, false otherwise
     */
    public async deleteConnection(connectionElement: WebElement): Promise<boolean> {
        const logger = getTestLogger();
        try {
            // Click delete button (this will open confirmation dialog)
            await this.clickDelete(connectionElement);

            // Switch to default content BEFORE handling dialog (dialog blocks webview)
            await this.driver.switchTo().defaultContent();

            const dialogAppeared = await this.waitForDialogPresent(
                "delete confirmation dialog to appear",
                UITimeouts.MEDIUM
            );
            if (!dialogAppeared) {
                logger.warn("ConnectionPage", "Delete confirmation dialog did not appear in time");
                return false;
            }

            // Handle confirmation dialog using shared dialog helper
            const dialogHandled = await handleConfirmationDialog(this.driver, "Delete");

            if (!dialogHandled) {
                logger.warn("ConnectionPage", "Failed to handle confirmation dialog");
                return false;
            }

            const dialogClosed = await this.waitForDialogClosed(
                "delete confirmation dialog to close",
                UITimeouts.MEDIUM
            );
            if (!dialogClosed) {
                logger.warn("ConnectionPage", "Delete confirmation dialog did not close in time");
                return false;
            }

            // Switch back to webview
            const webviewFound = await findAndSwitchToWebview(this.driver);
            if (!webviewFound) {
                logger.warn("ConnectionPage", "Could not switch back to webview after delete");
                return false;
            }

            return true;
        } catch (error) {
            logger.error("ConnectionPage", `Error deleting connection: ${error}`);
            // Try to switch back to webview
            try {
                await findAndSwitchToWebview(this.driver);
            } catch {
                // Ignore errors when switching back
            }
            return false;
        }
    }

    /**
     * Clicks the login button for a connection found in the list.
     *
     * @param connectionElement - The connection list item element
     */
    public async clickLogin(connectionElement: WebElement): Promise<void> {
        const loginButton = await this.getConnectionActionButton(connectionElement, "login");
        await loginButton.click();
        await applySlowMotion(this.driver);
    }

    /**
     * Deletes all existing TestBench connections.
     * This is useful for cleaning up test state before running tests.
     * Only works when the webview is available (user is not logged in).
     *
     * @returns The number of connections that were deleted
     */
    public async deleteAllConnections(): Promise<number> {
        const logger = getTestLogger();
        try {
            let deletedCount = 0;
            const maxIterations = 50; // Safety limit to prevent infinite loops
            let stoppedEarly: boolean = false;
            let stopReason: string = "";

            const cleanupCompleted = await retryUntil(
                async (attempt) => {
                    // Get all connections
                    const connections = await this.getAllConnections();

                    if (connections.length === 0) {
                        // No more connections to delete
                        return true;
                    }

                    // Delete the first connection (we'll keep deleting until all are gone)
                    const firstConnection = connections[0];

                    try {
                        // Check if delete button is enabled (not disabled during edit mode)
                        const isDisabled = await this.isActionDisabled(firstConnection, "delete");

                        if (isDisabled) {
                            // Connection is being edited - cancel edit mode first
                            logger.info("ConnectionPage", "Connection is being edited. Canceling edit mode first...");
                            try {
                                await this.cancelEdit();
                                return false;
                            } catch {
                                stoppedEarly = true;
                                stopReason = "Could not cancel edit mode during bulk cleanup";
                                logger.warn("ConnectionPage", "Could not cancel edit mode. Stopping cleanup.");
                                return true;
                            }
                        }

                        // Click delete button (this will open confirmation dialog)
                        await this.clickDelete(firstConnection);

                        // Switch to default content BEFORE handling dialog (dialog blocks webview)
                        await this.driver.switchTo().defaultContent();

                        const dialogAppeared = await this.waitForDialogPresent(
                            "delete confirmation dialog to appear during bulk cleanup",
                            UITimeouts.MEDIUM
                        );
                        if (!dialogAppeared) {
                            logger.warn(
                                "ConnectionPage",
                                `Delete confirmation dialog did not appear during cleanup (attempt ${attempt}/${maxIterations})`
                            );
                            return false;
                        }

                        // Handle confirmation dialog using shared dialog helper
                        const dialogHandled = await handleConfirmationDialog(this.driver, "Delete");

                        if (!dialogHandled) {
                            logger.warn(
                                "ConnectionPage",
                                "Failed to handle confirmation dialog, skipping this connection"
                            );
                            // Try to cancel the dialog if it's still open
                            try {
                                await this.driver.switchTo().defaultContent();
                                const cancelButtons = await this.driver.findElements(
                                    By.xpath("//button[contains(text(), 'Cancel') or contains(text(), 'No')]")
                                );
                                if (cancelButtons.length > 0) {
                                    await cancelButtons[0].click();

                                    const dialogClosedAfterCancel = await this.waitForDialogClosed(
                                        "confirmation dialog to close after cancel during cleanup",
                                        UITimeouts.MEDIUM
                                    );
                                    if (!dialogClosedAfterCancel) {
                                        logger.warn("ConnectionPage", "Dialog did not close in time after cancel");
                                    }
                                }
                            } catch {
                                // Ignore errors when trying to cancel
                            }
                            return false;
                        }

                        const dialogClosed = await this.waitForDialogClosed(
                            "delete confirmation dialog to close during bulk cleanup",
                            UITimeouts.MEDIUM
                        );
                        if (!dialogClosed) {
                            logger.warn("ConnectionPage", "Delete confirmation dialog did not close during cleanup");
                            return false;
                        }

                        // Switch back to webview to continue deleting connections
                        try {
                            const webviewFound = await findAndSwitchToWebview(this.driver);
                            if (!webviewFound) {
                                stoppedEarly = true;
                                stopReason = "Could not switch back to webview after delete dialog during bulk cleanup";
                                logger.warn("ConnectionPage", stopReason);
                                return true;
                            }
                        } catch (error) {
                            stoppedEarly = true;
                            stopReason = `Error switching back to webview during bulk cleanup: ${String(error)}`;
                            logger.error("ConnectionPage", stopReason);
                            return true;
                        }

                        deletedCount++;
                        return false;
                    } catch (error) {
                        logger.error("ConnectionPage", `Error deleting connection: ${error}`);
                        // Try to switch back to webview and continue
                        try {
                            const webviewFound = await findAndSwitchToWebview(this.driver);
                            if (!webviewFound) {
                                stoppedEarly = true;
                                stopReason = "Could not switch back to webview after delete error during cleanup";
                                return true;
                            }
                        } catch {
                            // If we can't switch back, stop cleanup early
                            stoppedEarly = true;
                            stopReason = "Could not switch back to webview after delete error during cleanup";
                            return true;
                        }

                        return false;
                    }
                },
                maxIterations,
                "delete all saved TestBench connections"
            );

            if (!cleanupCompleted) {
                logger.warn(
                    "ConnectionPage",
                    `Reached cleanup iteration limit (${maxIterations}) while deleting TestBench connections`
                );
            }

            if (stoppedEarly && stopReason) {
                logger.warn("ConnectionPage", `Stopped bulk cleanup early: ${stopReason}`);
            }

            if (deletedCount > 0) {
                logger.info("ConnectionPage", `Deleted ${deletedCount} connection(s)`);
            }

            return deletedCount;
        } catch (error) {
            logger.error("ConnectionPage", `Error during connection cleanup: ${error}`);
            return 0;
        }
    }

    // --- Private Helpers ---

    /**
     * Clears an input field thoroughly, handling default values and edge cases.
     * Uses multiple strategies to ensure the field is completely cleared.
     *
     * @param locator - The locator for the input element
     */
    private async clearField(locator: By): Promise<void> {
        try {
            const element = await this.driver.findElement(locator);
            // Strategy 1: Use JavaScript to directly set value to empty (most reliable)
            await this.driver.executeScript("arguments[0].value = '';", element);
            // Strategy 2: Standard clear as backup
            await element.clear();
            // Strategy 3: Trigger input event to ensure UI updates
            await this.driver.executeScript(
                "arguments[0].dispatchEvent(new Event('input', { bubbles: true }));",
                element
            );

            // Wait for the field to be cleared and verify value is empty
            const cleared = await waitForCondition(
                this.driver,
                async () => {
                    const value = await element.getAttribute("value");
                    return value === null || value === "";
                },
                1000,
                100,
                "connection form input field to be cleared"
            );
            if (!cleared) {
                const logger = getTestLogger();
                logger.warn("ConnectionPage", "Input field clear verification timed out");
            }
        } catch (error) {
            const logger = getTestLogger();
            logger.warn("ConnectionPage", "Warning: Could not fully clear input field:", error);
        }
    }

    /**
     * Waits for any host dialog surface to appear.
     */
    private async waitForDialogPresent(context: string, timeout: number = UITimeouts.MEDIUM): Promise<boolean> {
        return await waitForCondition(
            this.driver,
            async () => {
                const dialogs = await this.driver.findElements(By.css(DIALOG_SELECTORS));
                for (const dialog of dialogs) {
                    try {
                        if (await dialog.isDisplayed()) {
                            return true;
                        }
                    } catch {
                        // Ignore stale dialog candidates and keep checking.
                    }
                }

                return false;
            },
            timeout,
            100,
            context
        );
    }

    /**
     * Waits for the host dialog modal block to be dismissed.
     * @param context - Description of the wait context for logging
     * @param timeout - Maximum time to wait for the dialog to close
     * @return True if the dialog is confirmed closed, false if timed out (dialog may still be present)
     */
    private async waitForDialogClosed(context: string, timeout: number = UITimeouts.MEDIUM): Promise<boolean> {
        return await waitForCondition(
            this.driver,
            async () => {
                const modalBlocks = await this.driver.findElements(By.css(DIALOG_MODAL_BLOCK_SELECTOR));
                for (const modalBlock of modalBlocks) {
                    try {
                        if (await modalBlock.isDisplayed()) {
                            return false;
                        }
                    } catch {
                        // Ignore stale modal block nodes.
                    }
                }

                return true;
            },
            timeout,
            100,
            context
        );
    }

    /**
     * Clears an input field and types text into it.
     *
     * @param locator - The locator for the input element
     * @param text - The text to type
     */
    private async clearAndType(locator: By, text: string): Promise<void> {
        await this.clearField(locator);
        if (text) {
            const element = await this.driver.findElement(locator);
            await element.sendKeys(text);
            await applySlowMotion(this.driver);
        }
    }

    /**
     * Locates an action button for one connection list item.
     *
     * @param connectionElement - The connection list item element
     * @param action - The action button to locate
     * @returns The action button element
     */
    private async getConnectionActionButton(
        connectionElement: WebElement,
        action: ConnectionListAction
    ): Promise<WebElement> {
        return connectionElement.findElement(By.css(this.connectionActionSelectors[action]));
    }
}
