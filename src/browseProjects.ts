import * as vscode from 'vscode';
import { Connection } from './connection';
import { TestBenchTreeDataProvider } from './explorer';

export async function browseProjects(context: vscode.ExtensionContext, connection: Connection | null) {
    if (!connection) {
        vscode.window.showInformationMessage('No connection available. Please login first.');
        return;
    }

    const treeDataProvider = new TestBenchTreeDataProvider(connection);
    vscode.window.createTreeView('testBenchProjects', { treeDataProvider });

    // Refresh the tree view when necessary
    treeDataProvider.refresh();
}
