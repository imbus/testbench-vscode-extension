import * as vscode from 'vscode';
import { TreeItem } from './explorer';  // changed from vscode
import { performLogin } from './login';
import { Connection } from './connection';
import { browseProjects } from './browseProjects';
import { TestBenchTreeDataProvider } from './explorer';

export function activate(context: vscode.ExtensionContext) {

    // TODO: When initializing the tree view, set the root from VS Code storage.

    // Store the connection to server
    let connection: Connection | null = null;    
        
    let loginDisposable = vscode.commands.registerCommand('testbenchExtension.login', async () => {
        connection = await performLogin(context);
        if (connection) {
            // Delay the Tree View Initialization to initialize the tree view only after a successful connection is established
            const treeDataProvider = new TestBenchTreeDataProvider(connection);
            // Create the tree view
            const treeView = vscode.window.createTreeView('testBenchProjects', {
                treeDataProvider
            });
            context.subscriptions.push(treeView);

            // Handle expansion and collapse events for dynamic icon change of tree view items
            treeView.onDidExpandElement(e => {
                treeDataProvider.handleExpansion(e.element, true);
            });
            treeView.onDidCollapseElement(e => {
                treeDataProvider.handleExpansion(e.element, false);
            });

            const nextAction = await vscode.window.showQuickPick(
                ["Browse Projects", "Change connection", "Quit"],
                { placeHolder: "What do you want to do?" }
            );

            switch (nextAction) {
                case "Browse Projects":
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

    // Register the "Browse Projects" command	
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

    // Register the "Make Root" command
    context.subscriptions.push(
        vscode.commands.registerCommand('testbenchExtension.makeRoot', (treeItem: TreeItem) => {
            if (connection) {
                const treeDataProvider = new TestBenchTreeDataProvider(connection);
                treeDataProvider.makeRoot(treeItem);
                vscode.window.showInformationMessage(`"${treeItem.label}" is now the root.`);
                vscode.window.registerTreeDataProvider('testBenchProjects', treeDataProvider);
            } else {
                vscode.window.showErrorMessage('No connection available. Please log in first.');
            }
        })
    );

    // Uncomment this if you want to prompt the user to log in when the extension activates
    // vscode.commands.executeCommand('testbenchExtension.login');
}

export function deactivate() {}
