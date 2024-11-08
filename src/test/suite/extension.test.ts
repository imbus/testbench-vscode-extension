import * as assert from "assert";
import * as vscode from "vscode";
import { activate, deactivate } from "../../extension";

suite("Extension Test Suite", () => {
    suiteTeardown(() => {
        vscode.window.showInformationMessage("All tests done!");
    });

    test("Extension should be present", () => {
        assert.ok(vscode.extensions.getExtension("imbus.testbench-visual-studio-code-extension"));
    });

    test("Extension should be active after activation", async () => {
        const extension: vscode.Extension<any> | undefined = vscode.extensions.getExtension(
            "imbus.testbench-visual-studio-code-extension"
        );

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

        await activate(context);

        const registeredCommands: string[] = await vscode.commands.getCommands(true);
        const expectedCommands: string[] = [
            "testbenchExtension.login",
            "testbenchExtension.logout",
            "testbenchExtension.generateTestCasesForCycle",
            "testbenchExtension.generateTestCasesForTestThemeOrTestCaseSet",
            "testbenchExtension.readAndUploadTestResultsToTestbench",
            "testbenchExtension.showExtensionSettings",
            "testbenchExtension.selectAndLoadProject",
            "testbenchExtension.setWorkspaceLocation",
        ];

        console.log("registeredCommands: ", registeredCommands);
        console.log("expectedCommands: ", expectedCommands);

        expectedCommands.forEach((command) => {
            assert.ok(registeredCommands.includes(command), `Command ${command} is not registered`);
        });
    });

    test("Updating configuration should change setting variable", async () => {
        const context = {
            subscriptions: [],
            secrets: {
                delete: async () => {},
            },
        } as unknown as vscode.ExtensionContext;

        await activate(context);

        const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("testbenchExtension");
        await config.update("serverName", "newServerName", vscode.ConfigurationTarget.Global);
        assert.strictEqual(config.get("serverName", vscode.ConfigurationTarget.Global), "newServerName");
    });

    test("Deactivate should not throw", () => {
        assert.doesNotThrow(() => deactivate());
    });
});
