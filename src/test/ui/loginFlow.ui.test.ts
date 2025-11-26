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
    resetConnectionForm,
    deleteAllConnections,
    attemptLogout,
    ConnectionFormData,
    ConnectionFormElements,
    ensureWorkspaceIsOpen
} from "./testUtils";
import { getTestCredentials, isSlowMotionEnabled, getSlowMotionDelay } from "./testConfig";

describe("Login Flow E2E Tests", function () {
    let browser: VSBrowser;
    let driver: WebDriver;

    this.timeout(120000);

    before(async function () {
        browser = VSBrowser.instance;
        await ensureWorkspaceIsOpen();
        driver = browser.driver;
        await new EditorView().closeAllEditors();
    });

    after(async function () {
        await attemptLogout(driver);
        await new EditorView().closeAllEditors();
    });

    beforeEach(async function () {
        if (isSlowMotionEnabled()) {
            console.log(`[Slow Motion] Enabled with ${getSlowMotionDelay()}ms delay`);
        } else {
            console.log("[Slow Motion] Disabled");
        }

        await openTestBenchSidebar(driver);
        await attemptLogout(driver);
        await deleteAllConnections(driver);
    });

    describe("Complete Login Scenario", function () {
        it("should create a new connection and login with test credentials", async function () {
            const sideBar = new SideBarView();
            const content = sideBar.getContent();
            const sections = await content.getSections();

            expect(sections.length).to.be.greaterThan(0);

            try {
                const webviewFound = await findAndSwitchToWebview(driver);

                if (!webviewFound) {
                    console.log("Webview not found");
                    this.skip();
                    return;
                }

                console.log("Resetting form to clean state...");
                await resetConnectionForm(driver);

                console.log("Filling in connection details...");

                const credentials = getTestCredentials();

                const formData: ConnectionFormData = {
                    connectionLabel: credentials.connectionLabel,
                    serverName: credentials.serverName,
                    portNumber: credentials.portNumber,
                    username: credentials.username,
                    password: credentials.password,
                    storePassword: true
                };

                await fillConnectionForm(driver, formData);

                const storePasswordCheckbox = await driver.findElement(
                    By.id(ConnectionFormElements.STORE_PASSWORD_CHECKBOX)
                );
                const isChecked = await storePasswordCheckbox.isSelected();
                expect(isChecked).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions

                console.log("Clicking Save New Connection button...");
                await saveConnection(driver);

                console.log("Verifying connection in list...");
                const connectionsList = await driver.wait(
                    until.elementLocated(By.id(ConnectionFormElements.CONNECTIONS_LIST)),
                    10000,
                    "Waiting for connections list to appear"
                );

                // Wait for at least one connection item to appear in the list
                await driver.wait(
                    async () => {
                        const connectionsItems = await connectionsList.findElements(By.css("li"));
                        return connectionsItems.length > 0;
                    },
                    10000,
                    "Waiting for connection to appear in list after save"
                );

                await applySlowMotion(driver);

                const connectionsItems = await connectionsList.findElements(By.css("li"));
                expect(connectionsItems.length).to.be.greaterThan(0);

                const expectedLabel = credentials.connectionLabel;
                const { element: connectionElement, found: testConnectionFound } = await findConnectionInList(
                    driver,
                    expectedLabel
                );

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

                console.log("Clicking login button...");
                if (foundConnection) {
                    await clickLoginConnection(driver, foundConnection);
                }

                await driver.switchTo().defaultContent();
                console.log("Looking for authentication prompt...");
                await handleAuthenticationModals(driver);
                console.log("Login flow completed");
            } catch (error) {
                console.error("Error during login flow test:", error);
                throw error;
            } finally {
                await driver.switchTo().defaultContent();
            }
        });
    });
});
