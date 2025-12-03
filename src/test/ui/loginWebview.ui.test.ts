/**
 * @file src/test/ui/loginWebview.ui.test.ts
 * @description Focused UI tests for login webview functionality: creating, editing, removing connections, and logging in
 */

import { expect } from "chai";
import { WebDriver, By, until, SideBarView } from "vscode-extension-tester";
import {
    handleAuthenticationModals,
    openTestBenchSidebar,
    findAndSwitchToWebview,
    isWebviewAvailable,
    attemptLogout,
    generateUniqueConnectionLabel,
    applySlowMotion,
    deleteAllConnections,
    ConnectionPage,
    ConnectionFormData,
    ConnectionFormElements,
    UITimeouts
} from "./testUtils";
import { getTestCredentials, hasTestCredentials } from "./testConfig";
import { TestContext, createBeforeHook, createAfterHook, logSlowMotionStatus } from "./testHooks";

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
    const ctx: TestContext = {} as TestContext;

    this.timeout(120000);

    before(createBeforeHook(ctx, { suiteName: "LoginWebview" }));
    after(createAfterHook({ suiteName: "LoginWebview" }));

    // Custom beforeEach for login webview tests - requires logged OUT state
    beforeEach(async function () {
        logSlowMotionStatus();

        const driver = ctx.driver;
        await openTestBenchSidebar(driver);
        await attemptLogout(driver);
        await deleteAllConnections(driver);
        await driver.switchTo().defaultContent();

        await driver.wait(
            until.elementLocated(By.css(".monaco-workbench")),
            UITimeouts.MEDIUM,
            "Waiting for workbench to be ready"
        );

        await driver.wait(
            async () => {
                try {
                    return await isWebviewAvailable(driver);
                } catch {
                    return false;
                }
            },
            UITimeouts.MEDIUM,
            "Waiting for webview to be available after cleanup"
        );
    });

    // Convenience getter for driver (for use in tests)
    const getDriver = () => ctx.driver;

    describe("View Structure", function () {
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

        it("should have 'Store Password' checked by default", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    await connectionPage.resetForm();

                    const storePasswordCheckbox = await driver.findElement(
                        By.id(ConnectionFormElements.STORE_PASSWORD_CHECKBOX)
                    );
                    const isChecked = await storePasswordCheckbox.isSelected();
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    expect(isChecked).to.be.true;
                },
                false // No credentials needed for this check
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });
    });

    describe("Form Validation", function () {
        it("should show validation error when required fields are missing", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    await connectionPage.resetForm();

                    const saveButton = await driver.findElement(By.id(ConnectionFormElements.SAVE_BUTTON));
                    await saveButton.click();

                    const messageText = await connectionPage.getErrorMessage();
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

                    const saveButton = await driver.findElement(By.id(ConnectionFormElements.SAVE_BUTTON));
                    await saveButton.click();

                    // Wait for specific port validation error
                    const messageText = await connectionPage.getErrorMessage();
                    expect(messageText.toLowerCase()).to.include("port");
                },
                true // requires credentials for other fields
            ).catch((error) => {
                if (error.message.includes("skipped")) {
                    this.skip();
                } else {
                    throw error;
                }
            });
        });
    });

    describe("Creating Connections", function () {
        it("should show validation error when required fields are missing (duplicate)", async function () {
            await withWebviewContext(
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    await connectionPage.resetForm();

                    const saveButton = await driver.findElement(By.id(ConnectionFormElements.SAVE_BUTTON));
                    await saveButton.click();

                    const messageText = await connectionPage.getErrorMessage();
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

                    const { found } = await connectionPage.findConnection(connectionLabel);
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
                getDriver(),
                async (driver) => {
                    const connectionPage = new ConnectionPage(driver);
                    const credentials = getTestCredentials();

                    const formData: ConnectionFormData = {
                        connectionLabel: "",
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };

                    await connectionPage.fillForm(formData);
                    await connectionPage.save();

                    const expectedConnectionString = `${credentials.username}@${credentials.serverName}`;
                    const { found } = await connectionPage.findConnection(expectedConnectionString);
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
    });

    describe("Editing Connections", function () {
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

                    const { element, found } = await connectionPage.findConnection(connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await connectionPage.clickEdit(element);

                        const inEditMode = await connectionPage.isEditMode();
                        expect(inEditMode).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

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

                    const { element, found } = await connectionPage.findConnection(originalLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await connectionPage.clickEdit(element);

                        const labelInput = await driver.findElement(By.id(ConnectionFormElements.CONNECTION_LABEL));
                        await labelInput.clear();
                        await labelInput.sendKeys(updatedLabel);
                        await applySlowMotion(driver);

                        // Let the POM handle the dialog and wait for UI update
                        await connectionPage.save(true);

                        // Wait for connection to be updated with new label
                        await driver.wait(
                            async () => {
                                const { found } = await connectionPage.findConnection(updatedLabel);
                                return found;
                            },
                            UITimeouts.LONG,
                            "Waiting for connection to be updated with new label"
                        );

                        const { found: updatedFound } = await connectionPage.findConnection(updatedLabel);
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

                    const { element, found } = await connectionPage.findConnection(connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await connectionPage.clickEdit(element);

                        const labelInput = await driver.findElement(By.id(ConnectionFormElements.CONNECTION_LABEL));
                        await labelInput.clear();
                        await labelInput.sendKeys("This should be cancelled");
                        await applySlowMotion(driver);

                        await connectionPage.cancelEdit();

                        const sectionTitle = await driver.findElement(By.id(ConnectionFormElements.SECTION_TITLE));
                        const titleText = await sectionTitle.getText();
                        expect(titleText).to.include("Add New Connection");

                        const { found: originalFound } = await connectionPage.findConnection(connectionLabel);
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

                    const initialCount = await connectionPage.getConnectionCount();

                    const { element, found } = await connectionPage.findConnection(connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        // Use the high-level delete method that handles the dialog
                        const deleted = await connectionPage.deleteConnection(element);
                        expect(deleted).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                        await driver.wait(
                            async () => {
                                const count = await connectionPage.getConnectionCount();
                                return count < initialCount;
                            },
                            UITimeouts.LONG,
                            "Waiting for connection to be deleted"
                        );

                        const finalCount = await connectionPage.getConnectionCount();
                        expect(finalCount).to.be.lessThan(initialCount);

                        const { found: deletedFound } = await connectionPage.findConnection(connectionLabel);
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

                    const { element, found } = await connectionPage.findConnection(connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await connectionPage.clickLogin(element);

                        await driver.switchTo().defaultContent();
                        await handleAuthenticationModals(driver);
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

                    const { element, found } = await connectionPage.findConnection(connection1Label);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await connectionPage.clickEdit(element);

                        const { element: connection2Element } = await connectionPage.findConnection(connection2Label);
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

                    const { element, found } = await connectionPage.findConnection(connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await connectionPage.clickEdit(element);

                        const buttonText = await connectionPage.getSaveButtonText();
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
