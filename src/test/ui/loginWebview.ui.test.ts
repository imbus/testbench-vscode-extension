/**
 * @file src/test/ui/loginWebview.ui.test.ts
 * @description UI tests for TestBench extension integration and commands
 */

import { expect } from "chai";
import { VSBrowser, WebDriver, ActivityBar, SideBarView, EditorView, Workbench } from "vscode-extension-tester";

describe("TestBench Extension UI Tests", function () {
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

    describe("Activity Bar Integration", function () {
        it("should have TestBench activity bar item", async function () {
            const activityBar = new ActivityBar();
            const controls = await activityBar.getViewControls();

            let testbenchControl = null;
            for (const control of controls) {
                const title = await control.getTitle();
                if (title === "TestBench") {
                    testbenchControl = control;
                    break;
                }
            }

            expect(testbenchControl).to.not.be.null; // eslint-disable-line @typescript-eslint/no-unused-expressions
        });

        it("should open TestBench sidebar", async function () {
            const activityBar = new ActivityBar();
            const controls = await activityBar.getViewControls();

            for (const control of controls) {
                const title = await control.getTitle();
                if (title === "TestBench") {
                    await control.openView();
                    break;
                }
            }

            await driver.sleep(1000);

            const sideBar = new SideBarView();
            const titlePart = await sideBar.getTitlePart();
            const title = await titlePart.getTitle();

            expect(title.toUpperCase()).to.include("TESTBENCH");
        });
    });

    describe("Command Palette", function () {
        it("should have TestBench commands available", async function () {
            const workbench = new Workbench();
            const commandPalette = await workbench.openCommandPrompt();

            await commandPalette.setText(">TestBench");
            await driver.sleep(1000);

            const picks = await commandPalette.getQuickPicks();
            expect(picks.length).to.be.greaterThan(0);

            await commandPalette.cancel();
        });

        /*
        it("should find login-related commands", async function () {
            const workbench = new Workbench();
            const commandPalette = await workbench.openCommandPrompt();
            
            await commandPalette.setText(">TestBench: Login");
            await driver.sleep(500);
            
            const picks = await commandPalette.getQuickPicks();
            let foundCommand = false;
            
            for (const pick of picks) {
                const text = await pick.getText();
                if (text.includes("Login") || text.includes("Switch Connection")) {
                    foundCommand = true;
                    break;
                }
            }
            
            await commandPalette.cancel();
            expect(foundCommand).to.be.true; // eslint-disable-line @typescript-eslint/no-unused-expressions
        });
        */
    });
});
