/**
 * @file src/test/ui/loginWebview.ui.test.ts
 * @description Focused UI tests for login webview functionality: creating, editing, removing connections, and logging in
 */

import { expect } from "chai";
import { VSBrowser, WebDriver, EditorView, By, until, SideBarView } from "vscode-extension-tester";
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

    describe("View Structure", function () {
        it("should display login section when not connected", async function () {
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

                    await driver.wait(
                        async () => {
                            const count = await getConnectionCount(driver);
                            return count > initialCount;
                        },
                        UITimeouts.LONG,
                        "Waiting for connection to be saved"
                    );

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

                    const saveButton = await driver.findElement(By.id(ConnectionFormElements.SAVE_BUTTON));
                    await saveButton.click();

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
    });

    describe("Editing Connections", function () {
        it("should enter edit mode when edit button is clicked", async function () {
            await withWebviewContext(
                driver,
                async (driver) => {
                    const credentials = getTestCredentials();
                    const connectionLabel = generateUniqueConnectionLabel("Edit Test Connection");

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData);

                    const { element, found } = await findConnectionInList(driver, connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickEditConnection(driver, element);

                        const inEditMode = await isEditMode(driver);
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
                driver,
                async (driver) => {
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
                    await createConnection(driver, formData);

                    const { element, found } = await findConnectionInList(driver, originalLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickEditConnection(driver, element);

                        const labelInput = await driver.findElement(By.id(ConnectionFormElements.CONNECTION_LABEL));
                        await labelInput.clear();
                        await labelInput.sendKeys(updatedLabel);
                        await applySlowMotion(driver);
                        await saveConnection(driver);
                        await handleConfirmationDialog(driver, "Save Changes");

                        await findAndSwitchToWebview(driver);

                        await driver.wait(
                            async () => {
                                const { found } = await findConnectionInList(driver, updatedLabel);
                                return found;
                            },
                            UITimeouts.LONG,
                            "Waiting for connection to be updated with new label"
                        );

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

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData);

                    const { element, found } = await findConnectionInList(driver, connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickEditConnection(driver, element);

                        const labelInput = await driver.findElement(By.id(ConnectionFormElements.CONNECTION_LABEL));
                        await labelInput.clear();
                        await labelInput.sendKeys("This should be cancelled");
                        await applySlowMotion(driver);

                        const cancelButton = await driver.findElement(By.id(ConnectionFormElements.CANCEL_EDIT_BUTTON));
                        await cancelButton.click();
                        await applySlowMotion(driver);

                        // Wait for UI to update and for form to reset (section title should be back to "Add New Connection")
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
                            "Waiting for form to reset after cancel"
                        );

                        const sectionTitle = await driver.findElement(By.id(ConnectionFormElements.SECTION_TITLE));
                        const titleText = await sectionTitle.getText();
                        expect(titleText).to.include("Add New Connection");

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

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData);

                    const initialCount = await getConnectionCount(driver);

                    const { element, found } = await findConnectionInList(driver, connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickDeleteConnection(driver, element);
                        await handleConfirmationDialog(driver, "Delete");
                        await findAndSwitchToWebview(driver);

                        await driver.wait(
                            async () => {
                                const count = await getConnectionCount(driver);
                                return count < initialCount;
                            },
                            UITimeouts.LONG,
                            "Waiting for connection to be deleted"
                        );

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

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData);

                    const { element, found } = await findConnectionInList(driver, connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickLoginConnection(driver, element);

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
                driver,
                async (driver) => {
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
                    await createConnection(driver, formData1);

                    const formData2: ConnectionFormData = {
                        connectionLabel: connection2Label,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username + "2",
                        password: credentials.password
                    };
                    await createConnection(driver, formData2);

                    const { element, found } = await findConnectionInList(driver, connection1Label);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickEditConnection(driver, element);

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

                    const formData: ConnectionFormData = {
                        connectionLabel,
                        serverName: credentials.serverName,
                        portNumber: credentials.portNumber,
                        username: credentials.username,
                        password: credentials.password
                    };
                    await createConnection(driver, formData);

                    const { element, found } = await findConnectionInList(driver, connectionLabel);
                    expect(found).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                    if (found && element) {
                        await clickEditConnection(driver, element);

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
