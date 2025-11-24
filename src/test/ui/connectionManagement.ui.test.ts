/**
 * @file src/test/ui/connectionManagement.ui.test.ts
 * @description Tests that verify the presence of UI elements without direct webview interaction.
 */

import { expect } from "chai";
import { VSBrowser, WebDriver, SideBarView, EditorView } from "vscode-extension-tester";
import { openTestBenchSidebar } from "./testUtils";

describe("Connection Management UI Tests", function () {
    let browser: VSBrowser;
    let driver: WebDriver;

    this.timeout(60000);

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
    });

    describe("Login Webview Structure", function () {
        it("should display login section when not connected", async function () {
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

            expect(foundLoginSection).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
        });
    });
});
