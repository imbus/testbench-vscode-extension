/**
 * @file src/test/ui/loginFlow.ui.test.ts
 * @description End-to-end login flow test with webview interaction
 */

import { expect } from "chai";
import { VSBrowser, WebDriver, SideBarView, EditorView, By, until } from "vscode-extension-tester";
import { handleAuthenticationModals, openTestBenchSidebar, findAndSwitchToWebview } from "./testUtils";
import { getTestCredentials } from "./testConfig";

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
                const serverInput = await driver.findElement(By.id("serverName"));
                await serverInput.clear();

                const usernameInput = await driver.findElement(By.id("username"));
                await usernameInput.clear();

                // Try to save without filling required fields
                const saveButton = await driver.findElement(By.id("saveConnectionBtn"));
                await saveButton.click();

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
                const serverInput = await driver.findElement(By.id("serverName"));
                await serverInput.sendKeys("test.server.com");

                const usernameInput = await driver.findElement(By.id("username"));
                await usernameInput.sendKeys("testuser");

                // Enter non-numeric port
                const portInput = await driver.findElement(By.id("portNumber"));
                await portInput.clear();
                await portInput.sendKeys("abc");

                // Try to save
                const saveButton = await driver.findElement(By.id("saveConnectionBtn"));
                await saveButton.click();

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
                const addConnectionForm = await driver.wait(until.elementLocated(By.id("addConnectionForm")), 5000);
                await driver.executeScript("arguments[0].reset();", addConnectionForm);

                // Fill in connection details
                console.log("Filling in connection details...");

                // Get credentials from environment variables or test configuration
                const credentials = getTestCredentials();

                // Wait for and fill Connection Label
                const labelInput = await driver.wait(until.elementLocated(By.id("connectionLabel")), 5000);
                await labelInput.clear();
                await labelInput.sendKeys(credentials.connectionLabel);

                // Wait for and fill Server Name
                const serverInput = await driver.wait(until.elementLocated(By.id("serverName")), 5000);
                await serverInput.clear();
                await serverInput.sendKeys(credentials.serverName);

                // Wait for and fill Port Number
                const portInput = await driver.wait(until.elementLocated(By.id("portNumber")), 5000);
                await portInput.clear();
                await portInput.sendKeys(credentials.portNumber);

                // Wait for and fill Username
                const usernameInput = await driver.wait(until.elementLocated(By.id("username")), 5000);
                await usernameInput.clear();
                await usernameInput.sendKeys(credentials.username);

                // Wait for and fill Password
                const passwordInput = await driver.wait(until.elementLocated(By.id("password")), 5000);
                await passwordInput.clear();
                await passwordInput.sendKeys(credentials.password);

                // Verify "Store password" checkbox is checked
                const storePasswordCheckbox = await driver.findElement(By.id("storePasswordCheckbox"));
                const isChecked = await storePasswordCheckbox.isSelected();
                expect(isChecked).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                // Click "Save New Connection" button
                console.log("Clicking Save New Connection button...");
                const saveButton = await driver.findElement(By.id("saveConnectionBtn"));
                await saveButton.click();

                // Wait for connection to be saved - wait for connections list to update
                await driver.wait(
                    until.elementLocated(By.id("connectionsList")),
                    10000,
                    "Waiting for connections list to appear"
                );

                // Verify connection appears in connections list
                console.log("Verifying connection in list...");
                const connectionsList = await driver.findElement(By.id("connectionsList"));
                const connectionsItems = await connectionsList.findElements(By.css("li"));

                expect(connectionsItems.length).to.be.greaterThan(0);

                // Find the created test connection
                let testConnectionFound = false;
                let loginButton = null;

                for (const item of connectionsItems) {
                    const text = await item.getText();
                    const expectedLabel = credentials.connectionLabel;
                    const expectedConnectionString = `${credentials.username}@${credentials.serverName}`;
                    if (text.includes(expectedLabel) || text.includes(expectedConnectionString)) {
                        testConnectionFound = true;
                        // Find the login button for this connection
                        const buttons = await item.findElements(By.css("button.login-btn"));
                        if (buttons.length > 0) {
                            loginButton = buttons[0];
                        }
                        break;
                    }
                }

                expect(testConnectionFound).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
                expect(loginButton).to.not.be.null; // eslint-disable-line @typescript-eslint/no-unused-expressions

                //  Click "Login with this connection" button
                console.log("Clicking login button...");
                if (loginButton) {
                    await loginButton.click();
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
