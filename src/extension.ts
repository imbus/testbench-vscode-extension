import * as vscode from "vscode";
import * as jsonReportHandler from "./jsonReportHandler";
import { TreeItem, makeRoot } from "./treeView";
import { PlayServerConnection, performLogin, changeConnection } from "./testbenchConnection";
import { initializeTreeView } from "./browseProjects";
import { TestBenchTreeDataProvider } from "./treeView";
import { startTestExecution } from "./executeRobotFrameworkTests";

export function activate(context: vscode.ExtensionContext) {
    // TODO: Remember the set root tree item after logging in, store it in VS Code storage and fetch it on login, check if it's still valid.

    // Store the connection to server
    let connection: PlayServerConnection | null = null;
    // Store the tree data provider to be able to clear it on logout
    let treeDataProvider: TestBenchTreeDataProvider | null = null;

    let loginDisposable = vscode.commands.registerCommand("testbenchExtension.login", async () => {
        connection = await performLogin(context);
        if (!connection) {
            return;
        }
        treeDataProvider = await initializeTreeView(context, connection);

        const nextAction = await vscode.window.showQuickPick(
            ["Browse Projects", "Change connection", "Logout", "Cancel"],
            {
                placeHolder: "What do you want to do?",
            }
        );

        switch (nextAction) {
            case "Browse Projects":
                treeDataProvider = await initializeTreeView(context, connection);
                break;
            case "Change connection":
                changeConnection(context, connection!);
                break;
            case "Logout":
                if (connection) {
                    connection.logoutUser(context, treeDataProvider!);
                } else {
                    vscode.window.showInformationMessage("No connection available. Please log in first.");
                }
                break;
            case "Cancel":
                return;
        }
    });
    context.subscriptions.push(loginDisposable);

    // Register the "Browse Projects" command
    context.subscriptions.push(
        vscode.commands.registerCommand("testbenchExtension.browseProjects", async () => {
            treeDataProvider = await initializeTreeView(context, connection);
        })
    );

    // Register the "Logout" command
    context.subscriptions.push(
        vscode.commands.registerCommand("testbenchExtension.logout", async () => {
            if (connection) {
                await connection.logoutUser(context, treeDataProvider!);
            } else {
                vscode.window.showInformationMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Change Connection" command
    context.subscriptions.push(
        vscode.commands.registerCommand("testbenchExtension.changeConnection", async () => {
            let conn = await changeConnection(context, connection!);
            if (conn) {
                initializeTreeView(context, conn);
            }
        })
    );

    // Register the "Generate" command
    context.subscriptions.push(
        vscode.commands.registerCommand("testbenchExtension.generate", async (item: TreeItem) => {
            if (connection) {
                jsonReportHandler.startTestGenerationProcess(item, connection);
            } else {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Refresh tree" command
    context.subscriptions.push(
        vscode.commands.registerCommand("testbenchExtension.refreshTreeView", () => {
            // FIXME: Refresh command changes the folder icons to collapsed state although they are expanded, probably bcs getChildren() sets it to collapsed.
            initializeTreeView(context, connection);
        })
    );

    // Register the "Make Root" command
    context.subscriptions.push(
        vscode.commands.registerCommand("testbenchExtension.makeRoot", (treeItem: TreeItem) => {
            makeRoot(connection!, treeItem);
        })
    );

    // Register the "Run Robot Tests" command
    context.subscriptions.push(
        vscode.commands.registerCommand("extension.runRobotTests", async () => {
            startTestExecution();
        })
    );

    // Register the "getCycleStructure" command
    context.subscriptions.push(
        vscode.commands.registerCommand("extension.getCycleStructure", async () => {
            let cycleStructureResponse2 = await connection!.fetchCycleStructure("26", "168");
        })
    );

    // Uncomment this if you want to prompt the user to log in when the extension activates
    // vscode.commands.executeCommand('testbenchExtension.login');
}

export function deactivate() {}
