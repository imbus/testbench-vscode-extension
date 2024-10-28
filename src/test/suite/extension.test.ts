import * as assert from "assert";
import * as vscode from "vscode";
import { activate, deactivate } from "../../extension";

suite("Extension Test Suite", () => {
    suiteTeardown(() => {
        vscode.window.showInformationMessage("All tests done!");
    });

    vscode.window.showInformationMessage("Start all tests.");

    test("Extension should be present", () => {
        assert.ok(vscode.extensions.getExtension("imbus.testbench-visual-studio-code-extension"));
    });

    test("Extension should be active after activation", async () => {
        const extension = vscode.extensions.getExtension("imbus.testbench-visual-studio-code-extension");
        if (!extension) {
            assert.fail("Extension not found");
        }

        await extension?.activate();
        assert.strictEqual(extension?.isActive, true, "Extension should be active");
    });

    test("Activate should register commands", async () => {
        const context = {
            subscriptions: [],
            secrets: {
                delete: async () => {},
            },
        } as unknown as vscode.ExtensionContext;

        activate(context);

        const registeredCommands = await vscode.commands.getCommands(true);
        const expectedCommands = [
            "testbenchExtension.displayCommands",
            "testbenchExtension.login",
            "testbenchExtension.changeConnection",
            "testbenchExtension.logout",
            "testbenchExtension.generateTestCases",
            "testbenchExtension.makeRoot",
            "testbenchExtension.showExtensionSettings",
            "testbenchExtension.selectAndLoadProject",
            "testbenchExtension.refreshProjectTreeView",
            "testbenchExtension.refreshTestTreeView",
            "testbenchExtension.setWorkspaceLocation",
        ];

        console.log("registeredCommands: ", registeredCommands);
        console.log("expectedCommands: ", expectedCommands);

        expectedCommands.forEach((command) => {
            assert.ok(registeredCommands.includes(command), `Command ${command} is not registered`);
        });
    });

    test("Configuration should be loaded correctly", async () => {
        const context = {
            subscriptions: [],
            secrets: {
                delete: async () => {},
            },
        } as unknown as vscode.ExtensionContext;

        activate(context);

        const config = vscode.workspace.getConfiguration("testbenchExtension");
        assert.strictEqual(config.get("serverName"), "testbench");
        assert.strictEqual(config.get("portNumber"), 9445);
        assert.strictEqual(config.get("storePasswordAfterLogin"), false);
    });

    test("Updating configuration should change setting variable", async () => {
        const context = {
            subscriptions: [],
            secrets: {
                delete: async () => {},
            },
        } as unknown as vscode.ExtensionContext;

        activate(context);

        const config = vscode.workspace.getConfiguration("testbenchExtension");
        await config.update("serverName", "newServerName", vscode.ConfigurationTarget.Global);
        assert.strictEqual(config.get("serverName", vscode.ConfigurationTarget.Global), "newServerName");
    });

    test("Deactivate should not throw", () => {
        assert.doesNotThrow(() => deactivate());
    });
});
