/**
 * @file src/test/ui/pages/ConnectionPage.ts
 * @description Page Object Model for the Connection Management Webview.
 * Encapsulates all connection form interactions, connection list operations, and related UI elements.
 */

import { WebDriver, By, WebElement, until } from "vscode-extension-tester";
import { ConnectionFormElements } from "../utils/testUtils";
import { UITimeouts, applySlowMotion } from "../utils/waitHelpers";
import { getTestLogger } from "../utils/testLogger";

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
 * Page Object Model for the Connection Management Webview.
 * Encapsulates all interactions with the connection form and connection list.
 */
export class ConnectionPage {
    private driver: WebDriver;
    private locators = {
        labelInput: By.id(ConnectionFormElements.CONNECTION_LABEL),
        serverInput: By.id(ConnectionFormElements.SERVER_NAME),
        portInput: By.id(ConnectionFormElements.PORT_NUMBER),
        usernameInput: By.id(ConnectionFormElements.USERNAME),
        passwordInput: By.id(ConnectionFormElements.PASSWORD),
        storePasswordCheckbox: By.id(ConnectionFormElements.STORE_PASSWORD_CHECKBOX),
        saveButton: By.id(ConnectionFormElements.SAVE_BUTTON),
        saveButtonText: By.id(ConnectionFormElements.SAVE_BUTTON_TEXT),
        cancelEditButton: By.id(ConnectionFormElements.CANCEL_EDIT_BUTTON),
        sectionTitle: By.id(ConnectionFormElements.SECTION_TITLE),
        messages: By.id(ConnectionFormElements.MESSAGES),
        connectionsList: By.id(ConnectionFormElements.CONNECTIONS_LIST),
        addConnectionForm: By.id(ConnectionFormElements.ADD_CONNECTION_FORM)
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
        const saveButton = await this.driver.findElement(this.locators.saveButton);
        await saveButton.click();
        await applySlowMotion(this.driver);

        // Handle "Save Changes" overwrite confirmation dialog if it appears
        // This dialog appears when saving a connection with a name that already exists
        try {
            // Switch to default content to check for dialog (dialog is in main VS Code window, not webview)
            await this.driver.switchTo().defaultContent();

            // Check if dialog appeared (with short timeout since it may not appear)
            try {
                const dialogElement = await this.driver.wait(
                    until.elementLocated(By.css(".monaco-dialog-modal-block, .monaco-dialog, .monaco-dialog-box")),
                    UITimeouts.SHORT,
                    "Checking for Save Changes dialog"
                );

                // Verify dialog is actually visible
                const isVisible = await dialogElement.isDisplayed();
                if (!isVisible) {
                    // Dialog element exists but is not visible, skip handling
                    return;
                }

                // Dialog appeared and is visible, handle it using dynamic import to avoid circular dependency
                const logger = getTestLogger();
                const { handleConfirmationDialog } = await import("../utils/testUtils");
                const dialogHandled = await handleConfirmationDialog(this.driver, "Save Changes", UITimeouts.SHORT);
                if (dialogHandled) {
                    logger.info("ConnectionPage", "Handled 'Save Changes' overwrite dialog");
                } else {
                    logger.warn("ConnectionPage", "'Save Changes' dialog appeared but could not be handled");
                }

                // Wait for dialog to fully close
                await this.driver.wait(
                    async () => {
                        const modalBlocks = await this.driver.findElements(By.css(".monaco-dialog-modal-block"));
                        return modalBlocks.length === 0;
                    },
                    UITimeouts.SHORT,
                    "Waiting for Save Changes dialog to close"
                );
            } catch {
                // Dialog didn't appear, which is fine - continue normally
            }

            // Switch back to webview to continue
            const { findAndSwitchToWebview } = await import("../utils/testUtils");
            await findAndSwitchToWebview(this.driver);
        } catch (error) {
            // If dialog handling fails, try to switch back to webview and continue
            const logger = getTestLogger();
            logger.warn("ConnectionPage", "Error handling Save Changes dialog, continuing anyway:", error);
            try {
                const { findAndSwitchToWebview } = await import("../utils/testUtils");
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
            await this.driver.wait(
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
                "Waiting for UI to settle after save and connection to appear in list"
            );
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
     * Verifies that the form is in edit mode.
     *
     * @returns True if in edit mode, false otherwise
     */
    public async isEditMode(): Promise<boolean> {
        try {
            const sectionTitle = await this.driver.findElement(this.locators.sectionTitle);
            const titleText = await sectionTitle.getText();
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
        await this.driver.wait(
            async () => {
                try {
                    const sectionTitle = await this.driver.findElement(this.locators.sectionTitle);
                    const titleText = await sectionTitle.getText();
                    return titleText.toLowerCase().includes("add new connection");
                } catch {
                    return false;
                }
            },
            UITimeouts.MEDIUM,
            "Waiting for form to reset after canceling edit"
        );
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
     * Clicks the edit button for a connection found in the list.
     *
     * @param connectionElement - The connection list item element
     */
    public async clickEdit(connectionElement: WebElement): Promise<void> {
        const editButton = await connectionElement.findElement(By.css("button.edit-btn"));
        await editButton.click();
        await applySlowMotion(this.driver);

        // Wait for UI to update and for form to enter edit mode
        await this.driver.wait(
            async () => {
                return await this.isEditMode();
            },
            UITimeouts.MEDIUM,
            "Waiting for form to enter edit mode"
        );
    }

    /**
     * Clicks the delete button for a connection found in the list.
     *
     * @param connectionElement - The connection list item element
     */
    public async clickDelete(connectionElement: WebElement): Promise<void> {
        const deleteButton = await connectionElement.findElement(By.css("button.delete-btn"));
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

            // Wait for dialog to appear
            await this.driver.wait(
                until.elementLocated(By.css(".monaco-dialog-modal-block, .monaco-dialog, .monaco-dialog-box")),
                UITimeouts.MEDIUM,
                "Waiting for confirmation dialog to appear"
            );

            // Handle confirmation dialog using dynamic import to avoid circular dependency
            const { handleConfirmationDialog } = await import("../utils/testUtils");
            const dialogHandled = await handleConfirmationDialog(this.driver, "Delete");

            if (!dialogHandled) {
                logger.warn("ConnectionPage", "Failed to handle confirmation dialog");
                return false;
            }

            // Wait for dialog to be fully closed
            await this.driver.wait(
                async () => {
                    const modalBlocks = await this.driver.findElements(By.css(".monaco-dialog-modal-block"));
                    return modalBlocks.length === 0;
                },
                UITimeouts.MEDIUM,
                "Waiting for dialog to close"
            );

            // Switch back to webview
            const { findAndSwitchToWebview } = await import("../utils/testUtils");
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
                const { findAndSwitchToWebview } = await import("../utils/testUtils");
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
        const loginButton = await connectionElement.findElement(By.css("button.login-btn"));
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
            let iterations = 0;

            // Delete connections until none remain
            while (iterations < maxIterations) {
                iterations++;

                // Get all connections
                const connections = await this.getAllConnections();

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
                        logger.info("ConnectionPage", "Connection is being edited. Canceling edit mode first...");
                        try {
                            await this.cancelEdit();
                            // Re-fetch connections after canceling edit
                            continue;
                        } catch {
                            logger.warn("ConnectionPage", "Could not cancel edit mode. Skipping cleanup.");
                            break;
                        }
                    }

                    // Click delete button (this will open confirmation dialog)
                    await this.clickDelete(firstConnection);

                    // Switch to default content BEFORE handling dialog (dialog blocks webview)
                    await this.driver.switchTo().defaultContent();

                    // Wait for dialog to appear
                    await this.driver.wait(
                        until.elementLocated(By.css(".monaco-dialog-modal-block, .monaco-dialog, .monaco-dialog-box")),
                        UITimeouts.MEDIUM,
                        "Waiting for confirmation dialog to appear"
                    );

                    // Handle confirmation dialog using dynamic import to avoid circular dependency
                    const { handleConfirmationDialog } = await import("../utils/testUtils");
                    const dialogHandled = await handleConfirmationDialog(this.driver, "Delete");

                    if (!dialogHandled) {
                        logger.warn("ConnectionPage", "Failed to handle confirmation dialog, skipping this connection");
                        // Try to cancel the dialog if it's still open
                        try {
                            await this.driver.switchTo().defaultContent();
                            const cancelButtons = await this.driver.findElements(
                                By.xpath("//button[contains(text(), 'Cancel') or contains(text(), 'No')]")
                            );
                            if (cancelButtons.length > 0) {
                                await cancelButtons[0].click();

                                // Wait for dialog to disappear
                                await this.driver.wait(
                                    async () => {
                                        const modalBlocks = await this.driver.findElements(
                                            By.css(".monaco-dialog-modal-block")
                                        );
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

                    // Wait for dialog to be fully closed
                    await this.driver.wait(
                        async () => {
                            const modalBlocks = await this.driver.findElements(By.css(".monaco-dialog-modal-block"));
                            return modalBlocks.length === 0;
                        },
                        UITimeouts.MEDIUM,
                        "Waiting for dialog to close"
                    );

                    // Switch back to webview to continue deleting connections
                    try {
                        const { findAndSwitchToWebview } = await import("../utils/testUtils");
                        const webviewFound = await findAndSwitchToWebview(this.driver);
                        if (!webviewFound) {
                            logger.warn("ConnectionPage", "Could not switch back to webview after dialog");
                            break;
                        }
                    } catch (error) {
                        logger.error("ConnectionPage", `Error switching back to webview: ${error}`);
                        break;
                    }

                    deletedCount++;
                } catch (error) {
                    logger.error("ConnectionPage", `Error deleting connection: ${error}`);
                    // Try to switch back to webview and continue
                    try {
                        const { findAndSwitchToWebview } = await import("../utils/testUtils");
                        await findAndSwitchToWebview(this.driver);
                    } catch {
                        // If we can't switch back, break the loop
                        break;
                    }
                }
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
            await this.driver.wait(
                async () => {
                    const value = await element.getAttribute("value");
                    return value === null || value === "";
                },
                1000,
                "Waiting for input field to be cleared"
            );
        } catch (error) {
            const logger = getTestLogger();
            logger.warn("ConnectionPage", "Warning: Could not fully clear input field:", error);
        }
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
}
