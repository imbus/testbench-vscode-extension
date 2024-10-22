import * as assert from 'assert';
import * as vscode from 'vscode';
import { activate, deactivate } from '../extension';
import path from 'path';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Extension should be present', () => {
		assert.ok(vscode.extensions.getExtension('imbus.testbench-visual-studio-code-extension'));
	});

	test('Extension should be active after activation', async () => {
        const extension = vscode.extensions.getExtension('imbus.testbench-visual-studio-code-extension');
        if (!extension) {
            assert.fail('Extension not found');
        }

        await extension?.activate();
        assert.strictEqual(extension?.isActive, true, 'Extension should be active');
    });

	test('Activate should register commands', async () => {
		const context = {
			subscriptions: [],
			secrets: {
				delete: async () => {},
			},
		} as unknown as vscode.ExtensionContext;

		activate(context);

		const registeredCommands = await vscode.commands.getCommands(true);
		const expectedCommands = [
			'testbenchExtension.displayCommands',
			'testbenchExtension.login',
			'testbenchExtension.changeConnection',
			'testbenchExtension.logout',
			'testbenchExtension.generateTestCases',
			'testbenchExtension.makeRoot',
			'testbenchExtension.getCycleStructure',
			'testbenchExtension.getServerVersions',
			'testbenchExtension.showExtensionSettings',
			'testbenchExtension.selectAndLoadProject',
			'testbenchExtension.refreshTreeView',
			'testbenchExtension.setWorkspaceLocation',
		];

		expectedCommands.forEach(command => {
			assert.ok(registeredCommands.includes(command), `Command ${command} is not registered`);
		});
	});

	test('Configuration should be loaded correctly', async () => {
		const context = {
			subscriptions: [],
			secrets: {
				delete: async () => {},
			},
		} as unknown as vscode.ExtensionContext;

		activate(context);

		const config = vscode.workspace.getConfiguration('testbenchExtension');
		assert.strictEqual(config.get('serverName'), 'testbench');
		assert.strictEqual(config.get('portNumber'), 9445);
		assert.strictEqual(config.get('storePasswordAfterLogin'), false);
	});

	test('Updating configuration should change setting variable', async () => {
		const workspaceUri = vscode.Uri.file(path.join(__dirname, '..', '..', 'test-fixture'));
		await vscode.workspace.updateWorkspaceFolders(0, 0, { uri: workspaceUri });
		
		const context = {
			subscriptions: [],
			secrets: {
				delete: async () => {},
			},
		} as unknown as vscode.ExtensionContext;

		activate(context);

		const config = vscode.workspace.getConfiguration('testbenchExtension');
		await config.update('serverName', 'newServerName', vscode.ConfigurationTarget.Global);

		assert.strictEqual(config.get('serverName'), 'newServerName');
	});

	test('Deactivate should not throw', () => {
		assert.doesNotThrow(() => deactivate());
	});
});
