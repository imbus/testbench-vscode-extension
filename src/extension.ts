import * as vscode from 'vscode';
import { TreeItem } from 'vscode';
import { performLogin } from './login';
import { Connection } from './connection';
import { browseProjects } from './browseProjects';
import { TestBenchTreeDataProvider } from './explorer';

export function activate(context: vscode.ExtensionContext) {

    let connection: Connection | null = null;
        
    let loginDisposable = vscode.commands.registerCommand('testbenchExtension.login', async () => {
        connection = await performLogin(context);
        if (connection) {
            // Delay the Tree View Initialization to initialize the tree view only after a successful connection is established
            const treeDataProvider = new TestBenchTreeDataProvider(connection);
            vscode.window.registerTreeDataProvider('testBenchProjects', treeDataProvider);

            const nextAction = await vscode.window.showQuickPick(
                ["Browse Projects", "Change connection", "Quit"],
                { placeHolder: "What do you want to do?" }
            );

            switch (nextAction) {
                case "Browse Projects":
                    // Call a function to fetch projects and update the tree view
                    browseProjects(context, connection);                    
                    break;
                case "Change connection":
                    connection = await performLogin(context, true);  // Refresh the connection
                    if (connection) {
                        treeDataProvider.refresh();  // Refresh the tree view with the new connection
                    }
                    break;
                case "Quit":
                    return;
            }
        }
    });
    context.subscriptions.push(loginDisposable);

    context.subscriptions.push(
        vscode.commands.registerCommand('testbenchExtension.browseProjects', () => browseProjects(context, connection))
    );

    // Register the "Generate" command
    context.subscriptions.push(
        vscode.commands.registerCommand('testbenchExtension.generate', (item: TreeItem) => {
            vscode.window.showInformationMessage(`Generate action triggered for ${item.label}`);
        })
    );

    // Register the "Refresh tree" command
    context.subscriptions.push(
        vscode.commands.registerCommand('testbenchExtension.refreshTreeView', () => {
            browseProjects(context, connection);
        })
    );

    // Optionally, automatically prompt the user to log in when the extension activates
    // vscode.commands.executeCommand('testbenchExtension.login');
}

export function deactivate() {}
