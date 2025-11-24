/**
 * @file src/test/ui/loginWebview.ui.test.ts
 * @description Focused UI tests for login webview functionality: creating, editing, removing connections, and logging in
 */

import { expect } from "chai";
import { VSBrowser, WebDriver, EditorView, By } from "vscode-extension-tester";
import {
    handleAuthenticationModals,
    openTestBenchSidebar,
    findAndSwitchToWebview,
    isWebviewAvailable,
    attemptLogout,
    fillConnectionForm,
    findConnectionInList,
    getConnectionCount,
    saveConnection,
    createConnection,
    clickEditConnection,
    clickDeleteConnection,
    clickLoginConnection,
    handleConfirmationDialog,
    getMessageText,
    resetConnectionForm,
    isEditMode,
    generateUniqueConnectionLabel,
    applySlowMotion,
    deleteAllConnections,
    ConnectionFormData,
    ConnectionFormElements,
    UITimeouts
} from "./testUtils";
import { getTestCredentials, hasTestCredentials } from "./testConfig";

/**
 * Wrapper function to execute test code within webview context with proper cleanup.
 * Handles webview switching, credential checking, and cleanup automatically.
 *
 * @param driver - The WebDriver instance
 * @param testFn - The test function to execute within webview context
 * @param requireCredentials - Whether test credentials are required (default: true)
 * @returns Promise<void>
 */
async function withWebviewContext(
    driver: WebDriver,
    testFn: (driver: WebDriver) => Promise<void>,
    requireCredentials: boolean = true
): Promise<void> {
    try {
        // Check if webview is available (user is not logged in)
        const webviewAvailable = await isWebviewAvailable(driver);
        if (!webviewAvailable) {
            console.log("Webview not available - user is logged in. Test requires webview to be visible.");
            throw new Error("Webview not available - user is logged in - test skipped");
        }

        const webviewFound = await findAndSwitchToWebview(driver);
        if (!webviewFound) {
            console.log("Webview not found");
            throw new Error("Webview not found - test skipped");
        }

        if (requireCredentials && !hasTestCredentials()) {
            throw new Error("Test credentials not available - test skipped");
        }

        await testFn(driver);
    } finally {
        await driver.switchTo().defaultContent();
    }
}

describe("Login Webview - Connection Management Tests", function () {
    let browser: VSBrowser;
    let driver: WebDriver;

    // Extended timeout for E2E tests
    this.timeout(120000);

    before(async function () {
        browser = VSBrowser.instance;
        driver = browser.driver;
        await new EditorView().closeAllEditors();
    });

    after(async function () {
        await new EditorView().closeAllEditors();
    });

    beforeEach(async function () {
        // Open TestBench sidebar and wait for it to initialize
        await openTestBenchSidebar(driver);

        // Attempt to logout if logged in to ensure clean state (webview must be available for these tests)
        await attemptLogout(driver);

        // Clean up any existing connections from previous test runs
        await deleteAllConnections(driver);

        await driver.sleep(UITimeouts.SHORT);
    });

    describe("Creating Connections", function () {
        it("should create a new connection with all fields", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel(credentials.connectionLabel);

                    const initialCount = await getConnectionCount(driver);

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password,
                        storePassword: true
                    };

                    await fillConnectionForm(driver, formData);
                    await saveConnection(driver);

                    // Wait for connection count to increase
                    await driver.wait(
                        async () => {
                            const count = await getConnectionCount(driver);
                            return count > initialCount;
                        },
                        UITimeouts.LONG,
                        "Waiting for connection to be saved"
                    );

                    // Verify connection appears in list
                    const { found } = await findConnectionInList(driver, connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
                },
                true
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });

        it("should create a connection without optional label", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    const credentials = getTestCredentials();

                    const formData: ConnectionFormData = {
                        connectionLabel: "",
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };

                    await fillConnectionForm(driver, formData);
                    await saveConnection(driver);

                    // Verify connection appears with auto-generated label (username@servername format)
                    const expectedConnectionString = `${credentials.username}@${credentials.serverName}`;
                    const { found } = await findConnectionInList(driver, expectedConnectionString);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
                },
                true
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });

        it("should show validation error when required fields are missing", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    await resetConnectionForm(driver);

                    // Try to save without filling required fields
                    const saveButton = await driver.findElement(By.id(ConnectionFormElements.SAVE_BUTTON));
                    await saveButton.click();

                    // Wait for error message
                    const messageText = await getMessageText(driver);
                    expect(messageText.toLowerCase()).to.include("required");
                },
                false
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });

        it("should validate port number is numeric", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    const credentials = getTestCredentials();

                    const formData: ConnectionFormData = {
                        connectionLabel: "Test Connection",
                        serverName: credentials.serverName,
                        portNumber: "abc", // Invalid port
                        username: credentials.username,
                        password: credentials.password
                    };

                    await fillConnectionForm(driver, formData);

                    // Try to save
                    const saveButton = await driver.findElement(By.id(ConnectionFormElements.SAVE_BUTTON));
                    await saveButton.click();

                    // Wait for error message
                    const messageText = await getMessageText(driver);
                    expect(messageText.toLowerCase()).to.include("port");
                },
                true
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });
    });

    describe("Editing Connections", function () {
        it("should enter edit mode when edit button is clicked", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel("Edit Test Connection");

                    // Create a connection to edit
                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData);

                    // Find the connection and click edit button
                    const { element, found } = await findConnectionInList(driver, connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickEditConnection(driver, element);

                        // Verify form is in edit mode
                        const inEditMode = await isEditMode(driver);
                        expect(inEditMode).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                        // Verify cancel button is visible
                        const cancelButton = await driver.findElement(By.id(ConnectionFormElements.CANCEL_EDIT_BUTTON));
                        const isDisplayed = await cancelButton.isDisplayed();
                        expect(isDisplayed).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
                    }
                },
                true
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });

        it("should update connection when changes are saved", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    const credentials = getTestCredentials();
                    const originalLabel = generateUniqueConnectionLabel("Update Test Connection");
                    const updatedLabel = generateUniqueConnectionLabel("Updated Connection Label");

                    // Create a connection first
                    const formData: ConnectionFormData = {
                        connectionLabel: originalLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData);

                    // Find and edit the connection
                    const { element, found } = await findConnectionInList(driver, originalLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickEditConnection(driver, element);

                        // Modify the connection label
                        const labelInput = await driver.findElement(By.id(ConnectionFormElements.CONNECTION_LABEL));
                        await labelInput.clear();
                        await labelInput.sendKeys(updatedLabel);
                        await applySlowMotion(driver); // Visible: modifying form field

                        // Save changes
                        await saveConnection(driver);

                        // Handle confirmation dialog if it appears
                        await handleConfirmationDialog(driver, "Save Changes");

                        // Switch back to webview
                        await findAndSwitchToWebview(driver);

                        // Wait for update to complete
                        await driver.sleep(UITimeouts.SHORT);

                        // Verify updated connection appears
                        const { found: updatedFound } = await findConnectionInList(driver, updatedLabel);
                        expect(updatedFound).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
                    }
                },
                true
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });

        it("should cancel edit mode and reset form", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel("Cancel Edit Test");

                    // Create a connection first
                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData);

                    // Find and edit the connection
                    const { element, found } = await findConnectionInList(driver, connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickEditConnection(driver, element);

                        // Modify form
                        const labelInput = await driver.findElement(By.id(ConnectionFormElements.CONNECTION_LABEL));
                        await labelInput.clear();
                        await labelInput.sendKeys("This should be cancelled");
                        await applySlowMotion(driver); // Visible: modifying form field

                        // Click cancel
                        const cancelButton = await driver.findElement(By.id(ConnectionFormElements.CANCEL_EDIT_BUTTON));
                        await cancelButton.click();
                        await applySlowMotion(driver); // Visible: clicking cancel button
                        // Small wait for UI to update (background operation, no slow motion)
                        await driver.sleep(UITimeouts.SHORT);

                        // Verify form is reset (section title should be back to "Add New Connection")
                        const sectionTitle = await driver.findElement(By.id(ConnectionFormElements.SECTION_TITLE));
                        const titleText = await sectionTitle.getText();
                        expect(titleText).to.include("Add New Connection");

                        // Verify original connection still exists with original label
                        const { found: originalFound } = await findConnectionInList(driver, connectionLabel);
                        expect(originalFound).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
                    }
                },
                true
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });
    });

    describe("Removing Connections", function () {
        it("should delete a connection when delete button is clicked and confirmed", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel("Delete Test Connection");

                    // Create a connection to delete
                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData);

                    const initialCount = await getConnectionCount(driver);

                    // Find and delete the connection
                    const { element, found } = await findConnectionInList(driver, connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickDeleteConnection(driver, element);

                        // Handle confirmation dialog
                        await handleConfirmationDialog(driver, "Delete");

                        // Switch back to webview
                        await findAndSwitchToWebview(driver);
                        await driver.sleep(UITimeouts.SHORT);

                        // Verify connection is deleted
                        const finalCount = await getConnectionCount(driver);
                        expect(finalCount).to.be.lessThan(initialCount);

                        const { found: deletedFound } = await findConnectionInList(driver, connectionLabel);
                        expect(deletedFound).to.be.false; // eslint-disable-line @typescript-eslint/no-unused-expressions
                    }
                },
                true
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });
    });

    describe("Logging In", function () {
        it("should login with an existing connection", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel(credentials.connectionLabel);

                    // Create a connection first
                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData);

                    // Find the connection and click login button
                    const { element, found } = await findConnectionInList(driver, connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickLoginConnection(driver, element);

                        // Switch back to default content to handle authentication modals
                        await driver.switchTo().defaultContent();

                        // Handle authentication modal and certificate prompts
                        await handleAuthenticationModals(driver);

                        // Note: Actual login success verification would require checking
                        // if the webview content changed to logged-in state, which is
                        // tested in loginFlow.ui.test.ts
                    }
                },
                true
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });
    });

    describe("Form State Management", function () {
        it("should disable other actions when editing a connection", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    const credentials = getTestCredentials();
                    const connection1Label = generateUniqueConnectionLabel("Connection 1");
                    const connection2Label = generateUniqueConnectionLabel("Connection 2");

                    // Create two connections
                    const formData1: ConnectionFormData = {
                        connectionLabel: connection1Label,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData1);

                    const formData2: ConnectionFormData = {
                        connectionLabel: connection2Label,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username + "2",
                        password: credentials.password
                    };
                    await createConnection(driver, formData2);

                    // Edit first connection
                    const { element, found } = await findConnectionInList(driver, connection1Label);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickEditConnection(driver, element);

                        // Verify other connections' buttons are disabled
                        const { element: connection2Element } = await findConnectionInList(driver, connection2Label);
                        if (connection2Element) {
                            const deleteButton = await connection2Element.findElement(By.css("button.delete-btn"));
                            const isDisabled = await deleteButton.getAttribute("disabled");
                            expect(isDisabled).to.not.be.null; // eslint-disable-line @typescript-eslint/no-unused-expressions
                        }
                    }
                },
                true
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });

        it("should show correct button text in edit mode", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel("Button Text Test");

                    // Create a connection
                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData);

                    // Edit the connection
                    const { element, found } = await findConnectionInList(driver, connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickEditConnection(driver, element);

                        // Verify button text changed
                        const saveButtonText = await driver.findElement(By.id(ConnectionFormElements.SAVE_BUTTON_TEXT));
                        const buttonText = await saveButtonText.getText();
                        expect(buttonText).to.include("Save Changes");
                    }
                },
                true
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });
    });
});
