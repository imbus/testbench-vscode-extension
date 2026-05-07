/**
 * @file src/test/ui/loginWebview.ui.test.ts
 * @description Focused UI tests for login webview functionality: creating, editing, removing connections, and logging in
 */

import { expect } from "chai";
import { WebDriver, SideBarView, By } from "vscode-extension-tester";
import { handleAuthenticationModals, generateUniqueConnectionLabel } from "./utils/testUtils";
import { findAndSwitchToWebview, isWebviewAvailable } from "./utils/webviewUtils";
import { ConnectionPage, ConnectionFormData } from "./pages/ConnectionPage";
import { UITimeouts } from "./utils/waitHelpers";
import { getTestCredentials, getCredentialReadinessErrorMessage, hasTestCredentials } from "./config/testConfig";
import { TestContext, setupLoginWebviewTestHooks, skipTest } from "./utils/testHooks";
import { getTestLogger } from "./utils/testLogger";

function handleWebviewPreconditionSkip(context: Mocha.Context, error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("skipped")) {
        return skipTest(context, "precondition", message);
    }

    throw error;
}

/**
 * Wrapper function to execute test code within webview context with proper cleanup.
 * Handles webview switching, credential checking, and cleanup automatically.
 * Ensures clean state by verifying no connections exist before test execution.
 *
 * @param driver - The WebDriver instance
 * @param testFn - The test function to execute within webview context
 * @param requireCredentials - Whether test credentials are required (default: true)
 * @param skipCleanStateCheck - Whether to skip the clean state verification (default: false)
 * @returns Promise<void>
 */
async function withWebviewContext(
    driver: WebDriver,
    testFn: (driver: WebDriver) => Promise<void>,
    requireCredentials: boolean = true,
    skipCleanStateCheck: boolean = false
): Promise<void> {
    const logger = getTestLogger();
    try {
        const webviewAvailable = await isWebviewAvailable(driver);
        if (!webviewAvailable) {
            logger.warn("Webview", "Webview not available - user is logged in. Test requires webview to be visible.");
            throw new Error("Webview not available - user is logged in - test skipped");
        }

        const isWebviewPresent = await findAndSwitchToWebview(driver);
        if (!isWebviewPresent) {
            logger.warn("Webview", "Webview not found");
            throw new Error("Webview not found - test skipped");
        }

        if (requireCredentials && !hasTestCredentials()) {
            const readinessMessage = getCredentialReadinessErrorMessage();
            if (readinessMessage) {
                throw new Error(`Test credentials not available - test skipped: ${readinessMessage}`);
            }
            throw new Error("Test credentials not available - test skipped");
        }

        // Verify clean state before test execution
        if (!skipCleanStateCheck) {
            const connectionPage = new ConnectionPage(driver);
            const connectionCount = await connectionPage.getConnectionCount();
            if (connectionCount > 0) {
                logger.warn("TestIsolation", `Found ${connectionCount} existing connection(s) - expected 0`);
            }
        }

        await testFn(driver);
    } finally {
        await driver.switchTo().defaultContent();
    }
}

describe("Login Webview - Connection Management Tests", function () {
    const ctx: TestContext = {} as TestContext;

    this.timeout(120000);
    setupLoginWebviewTestHooks(ctx, {
        suiteName: "LoginWebview"
    });

    const getDriver = () => ctx.driver;

    describe("View Structure", function () {
        /*
         * 1. Open the TestBench side panel in VS Code.
         * 2. Read the visible sections in that panel.
         * 3. Confirm that a section named "Login to TestBench" is shown.
         */
        it("should display login section when not connected", async function () {
            const driver = getDriver();
            // Ensure we are in default content to interact with VS Code UI (Sidebar)
            await driver.switchTo().defaultContent();

            const sideBar = new SideBarView();
            const content = sideBar.getContent();
            const sections = await content.getSections();

            expect(sections.length).to.be.greaterThan(0);

            let foundLoginSection = false;
            for (const section of sections) {
                const title = await section.getTitle();
                if (title.includes("Login to TestBench")) {
                    foundLoginSection = true;
                    break;
                }
            }

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(foundLoginSection).to.be.true;
        });

        /*
         * 1. Open the login webview.
         * 2. Reset the form to a clean state.
         * 3. Check the "Store Password" option.
         * 4. Verify it is enabled by default.
         */
        it("should have 'Store Password' checked by default", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    await connectionPage.resetForm();

                    const isChecked = await connectionPage.isStorePasswordChecked();
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(isChecked).to.be.true;
                },
                false // No credentials needed for this check
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });
    });

    describe("Form Validation", function () {
        /*
         * 1. Open the login webview and clear all form fields.
         * 2. Try to save an empty connection.
         * 3. Verify an error appears saying required data is missing.
         */
        it("should show validation error when required fields are missing", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    await connectionPage.resetForm();

                    await connectionPage.clickPrimarySaveButton();

                    const messageText = await connectionPage.getErrorMessage();
                    expect(messageText.toLowerCase()).to.include("required");
                },
                false
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });

        /*
         * 1. Open the login form and enter connection details.
         * 2. Enter an invalid port value (letters instead of numbers).
         * 3. Try to save the connection.
         * 4. Verify a port-related validation error is shown.
         */
        it("should validate port number is numeric", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    await connectionPage.resetForm();
                    const credentials = getTestCredentials();

                    // Create form data with invalid port "abc"
                    const formData: ConnectionFormData = {
                        connectionLabel: "",
                        serverName: credentials.serverName,
                        portNumber: "abc",
                        username: credentials.username,
                        password: credentials.password
                    };

                    await connectionPage.fillForm(formData);

                    await connectionPage.clickPrimarySaveButton();

                    // Wait for specific port validation error
                    const messageText = await connectionPage.getErrorMessage();
                    expect(messageText.toLowerCase()).to.include("port");
                },
                true // requires credentials for other fields
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });
    });

    describe("Creating Connections", function () {
        /*
         * 1. Open the login webview.
         * 2. Fill in all connection fields, including a custom label.
         * 3. Save the connection.
         * 4. Verify the list now contains one more entry.
         * 5. Confirm the new connection appears with the expected label.
         */
        it("should create a new connection with all fields", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel(credentials.connectionLabel);

                    const initialCount = await connectionPage.getConnectionCount();

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password,
                        storePassword: true
                    };

                    await connectionPage.fillForm(formData);
                    await connectionPage.save();

                    await driver.wait(
                        async () => {
                            const count = await connectionPage.getConnectionCount();
                            return count > initialCount;
                        },
                        UITimeouts.LONG,
                        "Waiting for connection to be saved"
                    );

                    const { found: isConnectionFound } = await connectionPage.findConnection(connectionLabel);
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(isConnectionFound, `Connection '${connectionLabel}' should exist in the list after saving`)
                        .to.be.true;
                },
                true
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });

        /*
         * 1. Open the login webview.
         * 2. Fill required fields but leave the optional label empty.
         * 3. Save the connection.
         * 4. Verify the connection still appears using its default display format.
         */
        it("should create a connection without optional label", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    const credentials = getTestCredentials();

                    const formData: ConnectionFormData = {
                        connectionLabel: "", // No label provided
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };

                    await connectionPage.fillForm(formData);
                    await connectionPage.save();

                    const expectedConnectionString = `${credentials.username}@${credentials.serverName}`;
                    const { found: isConnectionFound } = await connectionPage.findConnection(expectedConnectionString);
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(
                        isConnectionFound,
                        `Connection '${expectedConnectionString}' should exist in the list when created without label`
                    ).to.be.true;
                },
                true
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });
    });

    describe("Editing Connections", function () {
        /*
         * 1. Create a sample connection.
         * 2. Find that connection in the list.
         * 3. Click its edit action.
         * 4. Verify the form switches to edit mode.
         * 5. Confirm the cancel-edit button becomes visible.
         */
        it("should enter edit mode when edit button is clicked", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel("Edit Test Connection");

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await connectionPage.createConnection(formData);

                    const { element: foundConnectionElement, found: isConnectionFound } =
                        await connectionPage.findConnection(connectionLabel);
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(isConnectionFound, `Connection '${connectionLabel}' should exist before editing`).to.be.true;

                    if (isConnectionFound && foundConnectionElement) {
                        await connectionPage.clickEdit(foundConnectionElement);

                        const isInEditMode = await connectionPage.isEditMode();
                        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                        expect(isInEditMode, "Form should be in edit mode after clicking edit button").to.be.true;

                        const isCancelButtonDisplayed = await connectionPage.isCancelEditButtonVisible();
                        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                        expect(isCancelButtonDisplayed, "Cancel button should be visible in edit mode").to.be.true;
                    }
                },
                true
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });

        /*
         * 1. Create a connection with an initial label.
         * 2. Open edit mode for that connection.
         * 3. Change the label to a new value.
         * 4. Save the changes.
         * 5. Verify the updated label is shown in the list.
         */
        it("should update connection when changes are saved", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    const credentials = getTestCredentials();
                    const originalLabel = generateUniqueConnectionLabel("Update Test Connection");
                    const updatedLabel = generateUniqueConnectionLabel("Updated Connection Label");

                    const formData: ConnectionFormData = {
                        connectionLabel: originalLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await connectionPage.createConnection(formData);

                    const { element: foundConnection, found: isConnectionFound } =
                        await connectionPage.findConnection(originalLabel);
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(isConnectionFound, `Connection '${originalLabel}' should exist before updating`).to.be.true;

                    if (isConnectionFound && foundConnection) {
                        await connectionPage.clickEdit(foundConnection);

                        await connectionPage.setConnectionLabel(updatedLabel);

                        // Let the POM handle the dialog and wait for UI update
                        await connectionPage.save(true);

                        // Wait for connection to be updated with new label
                        await driver.wait(
                            async () => {
                                const { found: foundConnection } = await connectionPage.findConnection(updatedLabel);
                                return foundConnection;
                            },
                            UITimeouts.LONG,
                            "Waiting for connection to be updated with new label"
                        );

                        const { found: updatedFoundConnection } = await connectionPage.findConnection(updatedLabel);
                        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                        expect(updatedFoundConnection, `Connection should have updated label '${updatedLabel}'`).to.be
                            .true;
                    }
                },
                true
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });

        /*
         * 1. Create a connection and open it in edit mode.
         * 2. Type a temporary change in the form.
         * 3. Cancel the edit instead of saving.
         * 4. Verify the form returns to "Add New Connection" mode.
         * 5. Confirm the original connection remains unchanged.
         */
        it("should cancel edit mode and reset form", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel("Cancel Edit Test");

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await connectionPage.createConnection(formData);

                    const { element: connectionElement, found: isConnectionFound } =
                        await connectionPage.findConnection(connectionLabel);
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(isConnectionFound, `Connection '${connectionLabel}' should exist before testing cancel`).to
                        .be.true;

                    if (isConnectionFound && connectionElement) {
                        await connectionPage.clickEdit(connectionElement);

                        await connectionPage.setConnectionLabel("This should be cancelled");

                        await connectionPage.cancelEdit();

                        const titleText = await connectionPage.getSectionTitle();
                        expect(titleText).to.include("Add New Connection");

                        const { found: isOriginalConnectionFound } =
                            await connectionPage.findConnection(connectionLabel);
                        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                        expect(
                            isOriginalConnectionFound,
                            `Original connection '${connectionLabel}' should still exist after canceling edit`
                        ).to.be.true;
                    }
                },
                true
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });
    });

    describe("Removing Connections", function () {
        /*
         * 1. Create a sample connection.
         * 2. Confirm it appears in the list.
         * 3. Trigger delete and confirm the deletion dialog.
         * 4. Verify the total number of connections decreases.
         * 5. Confirm the deleted connection is no longer present.
         */
        it("should delete a connection when delete button is clicked and confirmed", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel("Delete Test Connection");

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await connectionPage.createConnection(formData);

                    const initialConnectionCount = await connectionPage.getConnectionCount();

                    const { element, found: isConnectionFound } = await connectionPage.findConnection(connectionLabel);
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(isConnectionFound, `Connection '${connectionLabel}' should exist before deletion`).to.be
                        .true;

                    if (isConnectionFound && element) {
                        // Use the high-level delete method that handles the dialog
                        const isDeleted = await connectionPage.deleteConnection(element);
                        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                        expect(isDeleted, "Delete operation should complete successfully").to.be.true;

                        await driver.wait(
                            async () => {
                                const count = await connectionPage.getConnectionCount();
                                return count < initialConnectionCount;
                            },
                            UITimeouts.LONG,
                            "Waiting for connection to be deleted"
                        );

                        const finalConnectionCount = await connectionPage.getConnectionCount();
                        expect(finalConnectionCount).to.be.lessThan(initialConnectionCount);

                        const { found: isDeletedConnectionFound } =
                            await connectionPage.findConnection(connectionLabel);
                        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                        expect(
                            isDeletedConnectionFound,
                            `Connection '${connectionLabel}' should not exist after deletion`
                        ).to.be.false;
                    }
                },
                true
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });
    });

    describe("Logging In", function () {
        /*
         * 1. Create a valid saved connection.
         * 2. Start login using that connection.
         * 3. Handle security/authorization prompts if they appear.
         * 4. Complete the login flow without errors.
         */
        it("should login with an existing connection", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel(credentials.connectionLabel);

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await connectionPage.createConnection(formData);

                    const { element: connectionElement, found: isConnectionFound } =
                        await connectionPage.findConnection(connectionLabel);
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(isConnectionFound, `Connection '${connectionLabel}' should exist before login attempt`).to.be
                        .true;

                    if (isConnectionFound && connectionElement) {
                        await connectionPage.clickLogin(connectionElement);

                        await driver.switchTo().defaultContent();
                        await handleAuthenticationModals(driver);
                    }
                },
                true
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });
    });

    describe("Form State Management", function () {
        /*
         * 1. Create two separate connections.
         * 2. Start editing the first connection.
         * 3. Check action buttons on the second connection.
         * 4. Verify conflicting actions (like delete) are disabled during edit mode.
         */
        it("should disable other actions when editing a connection", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    const credentials = getTestCredentials();
                    const connection1Label = generateUniqueConnectionLabel("Connection 1");
                    const connection2Label = generateUniqueConnectionLabel("Connection 2");

                    const formData1: ConnectionFormData = {
                        connectionLabel: connection1Label,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await connectionPage.createConnection(formData1);

                    const formData2: ConnectionFormData = {
                        connectionLabel: connection2Label,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username + "2",
                        password: credentials.password
                    };
                    await connectionPage.createConnection(formData2);

                    const { element: connectionElement, found: isConnectionFound } =
                        await connectionPage.findConnection(connection1Label);
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(isConnectionFound, `First connection '${connection1Label}' should exist`).to.be.true;

                    if (isConnectionFound && connectionElement) {
                        await connectionPage.clickEdit(connectionElement);

                        const { element: connection2Element } = await connectionPage.findConnection(connection2Label);
                        if (connection2Element) {
                            const deleteButton = await connection2Element.findElement(By.css("button.delete-btn"));
                            const isDisabled = await deleteButton.getAttribute("disabled");
                            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                            expect(isDisabled, "Delete button on other connections should be disabled during edit mode")
                                .to.not.be.null;
                        }
                    }
                },
                true
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });

        /*
         * 1. Create a sample connection.
         * 2. Open that connection in edit mode.
         * 3. Read the primary save button text.
         * 4. Verify the button communicates update behavior ("Save Changes").
         */
        it("should show correct button text in edit mode", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel("Button Text Test");

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await connectionPage.createConnection(formData);

                    const { element: connectionElement, found: isConnectionFound } =
                        await connectionPage.findConnection(connectionLabel);
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(
                        isConnectionFound,
                        `Connection '${connectionLabel}' should exist before checking button text`
                    ).to.be.true;

                    if (isConnectionFound && connectionElement) {
                        await connectionPage.clickEdit(connectionElement);

                        const buttonText = await connectionPage.getSaveButtonText();
                        expect(buttonText).to.include("Save Changes");
                    }
                },
                true
            ).catch((error) => {
                handleWebviewPreconditionSkip(this, error);
            });
        });
    });
});
