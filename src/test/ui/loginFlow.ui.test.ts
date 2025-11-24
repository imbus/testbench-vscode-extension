/**
 * @file src/test/ui/loginFlow.ui.test.ts
 * @description End-to-end login flow test with webview interaction
 */

import { expect } from "chai";
import { VSBrowser, WebDriver, SideBarView, EditorView, By, until } from "vscode-extension-tester";
import {
    handleAuthenticationModals,
    openTestBenchSidebar,
    findAndSwitchToWebview,
    fillConnectionForm,
    saveConnection,
    clickLoginConnection,
    findConnectionInList,
    applySlowMotion,
    ConnectionFormData,
    ConnectionFormElements
} from "./testUtils";
import { getTestCredentials, isSlowMotionEnabled, getSlowMotionDelay } from "./testConfig";

describe("Login Flow E2E Tests", function () {
    let browser: VSBrowser;
    let driver: WebDriver;

    // Timeout for E2E tests
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
        // Log slow motion status for debugging
        if (isSlowMotionEnabled()) {
            console.log(`[Slow Motion] Enabled with ${getSlowMotionDelay()}ms delay`);
        } else {
            console.log("[Slow Motion] Disabled");
        }

        // Open TestBench sidebar and wait for it to initialize
        await openTestBenchSidebar(driver);
    });

    describe("Webview Form Validation", function () {
        it("should show validation error for missing required fields", async function () {
            try {
                // Find and switch to webview using helper function with shorter timeout
                const webviewFound = await findAndSwitchToWebview(driver, "data-test-validation", 5000);

                if (!webviewFound) {
                    console.log("Webview not found for validation test");
                    this.skip();
                    return;
                }

                // Clear all required fields
                const serverInput = await driver.findElement(By.id(ConnectionFormElements.SERVER_NAME));
                await serverInput.clear();
                await applySlowMotion(driver); // Visible: clearing server field

                const usernameInput = await driver.findElement(By.id(ConnectionFormElements.USERNAME));
                await usernameInput.clear();
                await applySlowMotion(driver); // Visible: clearing username field

                // Try to save without filling required fields
                const saveButton = await driver.findElement(By.id(ConnectionFormElements.SAVE_BUTTON));
                await saveButton.click();
                await applySlowMotion(driver); // Visible: clicking save button

                // Wait for error message to appear
                const messagesDiv = await driver.wait(
                    until.elementLocated(By.id("messages")),
                    5000,
                    "Waiting for validation error message"
                );
                const messageText = await messagesDiv.getText();

                expect(messageText).to.include("required");
            } finally {
                await driver.switchTo().defaultContent();
            }
        });

        it("should validate port number is numeric", async function () {
            try {
                // Find and switch to webview using helper function with shorter timeout
                const webviewFound = await findAndSwitchToWebview(driver, "data-test-port", 5000);

                if (!webviewFound) {
                    console.log("Webview not found for port validation test");
                    this.skip();
                    return;
                }

                // Fill required fields with valid data
                const serverInput = await driver.findElement(By.id(ConnectionFormElements.SERVER_NAME));
                await serverInput.sendKeys("test.server.com");
                await applySlowMotion(driver); // Visible: typing in server field

                const usernameInput = await driver.findElement(By.id(ConnectionFormElements.USERNAME));
                await usernameInput.sendKeys("testuser");
                await applySlowMotion(driver); // Visible: typing in username field

                // Enter non-numeric port
                const portInput = await driver.findElement(By.id(ConnectionFormElements.PORT_NUMBER));
                await portInput.clear();
                await portInput.sendKeys("abc");
                await applySlowMotion(driver); // Visible: typing in port field

                // Try to save
                const saveButton = await driver.findElement(By.id(ConnectionFormElements.SAVE_BUTTON));
                await saveButton.click();
                await applySlowMotion(driver); // Visible: clicking save button

                // Wait for error message to appear
                const messagesDiv = await driver.wait(
                    until.elementLocated(By.id("messages")),
                    5000,
                    "Waiting for port validation error message"
                );
                const messageText = await messagesDiv.getText();

                expect(messageText.toLowerCase()).to.include("port");
            } finally {
                await driver.switchTo().defaultContent();
            }
        });
    });

    describe("Complete Login Scenario", function () {
        it("should create a new connection and login with test credentials", async function () {
            // Verify login page is open
            const sideBar = new SideBarView();
            const content = sideBar.getContent();
            const sections = await content.getSections();

            expect(sections.length).to.be.greaterThan(0);

            try {
                // Find and switch to webview using helper function
                const webviewFound = await findAndSwitchToWebview(driver);

                if (!webviewFound) {
                    console.log("Webview not found");
                    this.skip();
                    return;
                }

                // Reset form to ensure clean state (in case previous tests left data)
                console.log("Resetting form to clean state...");
                const addConnectionForm = await driver.wait(
                    until.elementLocated(By.id(ConnectionFormElements.ADD_CONNECTION_FORM)),
                    5000
                );
                await driver.executeScript("arguments[0].reset();", addConnectionForm);
                await applySlowMotion(driver); // Visible: form reset

                // Fill in connection details
                console.log("Filling in connection details...");

                // Get credentials from environment variables or test configuration
                const credentials = getTestCredentials();

                // Use the helper function that includes slow motion
                const formData: ConnectionFormData = {
                    connectionLabel: credentials.connectionLabel,
                    serverName: credentials.serverName,
                    portNumber: credentials.portNumber,
                    username: credentials.username,
                    password: credentials.password,
                    storePassword: true
                };

                await fillConnectionForm(driver, formData);

                // Verify "Store password" checkbox is checked
                const storePasswordCheckbox = await driver.findElement(
                    By.id(ConnectionFormElements.STORE_PASSWORD_CHECKBOX)
                );
                const isChecked = await storePasswordCheckbox.isSelected();
                expect(isChecked).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                // Click "Save New Connection" button (with slow motion)
                console.log("Clicking Save New Connection button...");
                await saveConnection(driver);

                // Verify connection appears in connections list
                console.log("Verifying connection in list...");
                const connectionsList = await driver.wait(
                    until.elementLocated(By.id(ConnectionFormElements.CONNECTIONS_LIST)),
                    10000,
                    "Waiting for connections list to appear"
                );
                await applySlowMotion(driver); // Visible: connections list updated

                const connectionsItems = await connectionsList.findElements(By.css("li"));
                expect(connectionsItems.length).to.be.greaterThan(0);

                // Find the created test connection using helper function
                const expectedLabel = credentials.connectionLabel;
                const { element: connectionElement, found: testConnectionFound } = await findConnectionInList(
                    driver,
                    expectedLabel
                );

                // Fallback: try finding by connection string if label not found
                let foundConnection = connectionElement;
                if (!testConnectionFound) {
                    const expectedConnectionString = `${credentials.username}@${credentials.serverName}`;
                    const { element: connectionByString } = await findConnectionInList(
                        driver,
                        expectedConnectionString
                    );
                    foundConnection = connectionByString;
                }

                expect(foundConnection).to.not.be.null; // eslint-disable-line @typescript-eslint/no-unused-expressions

                // Click "Login with this connection" button (with slow motion)
                console.log("Clicking login button...");
                if (foundConnection) {
                    await clickLoginConnection(driver, foundConnection);
                }

                // Switch back to default content to handle modal prompt interaction
                await driver.switchTo().defaultContent();

                // Handle authentication modal and (possible) certificate prompts
                console.log("Looking for authentication prompt...");
                await handleAuthenticationModals(driver);
                console.log("Login flow completed");
            } catch (error) {
                console.error("Error during login flow test:", error);
                throw error;
            } finally {
                // Always switch back to default content
                await driver.switchTo().defaultContent();
            }
        });
    });
});
