import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.commands.registerCommand('testbench-visual-studio-code-extension.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from TestBench Visual Studio Code Extension!');
	}));
}

export function deactivate() {}
