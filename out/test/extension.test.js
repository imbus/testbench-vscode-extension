"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const extension_1 = require("../extension");
const path_1 = __importDefault(require("path"));
suite('Extension Test Suite', () => {
    suiteTeardown(() => {
        vscode.window.showInformationMessage('All tests done!');
    });
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
                delete: async () => { },
            },
        };
        (0, extension_1.activate)(context);
        const registeredCommands = await vscode.commands.getCommands(true);
        const expectedCommands = [
            'testbenchExtension.displayCommands',
            'testbenchExtension.login',
            'testbenchExtension.changeConnection',
            'testbenchExtension.logout',
            'testbenchExtension.generateTestCases',
            'testbenchExtension.makeRoot',
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
                delete: async () => { },
            },
        };
        (0, extension_1.activate)(context);
        const config = vscode.workspace.getConfiguration('testbenchExtension');
        assert.strictEqual(config.get('serverName'), 'testbench');
        assert.strictEqual(config.get('portNumber'), 9445);
        assert.strictEqual(config.get('storePasswordAfterLogin'), false);
    });
    test('Updating configuration should change setting variable', async () => {
        const workspaceUri = vscode.Uri.file(path_1.default.join(__dirname, '..', '..'));
        vscode.workspace.updateWorkspaceFolders(0, 0, { uri: workspaceUri });
        const context = {
            subscriptions: [],
            secrets: {
                delete: async () => { },
            },
        };
        (0, extension_1.activate)(context);
        const config = vscode.workspace.getConfiguration('testbenchExtension');
        await config.update('serverName', 'newServerName', vscode.ConfigurationTarget.Global);
        assert.strictEqual(config.get('serverName'), 'newServerName');
    });
    test('Deactivate should not throw', () => {
        assert.doesNotThrow(() => (0, extension_1.deactivate)());
    });
});
//# sourceMappingURL=extension.test.js.map