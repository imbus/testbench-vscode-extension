import * as vscode from "vscode";
import * as jsonReportHandler from "./jsonReportHandler";
import { TreeItem, makeRoot } from "./treeView";
import { PlayServerConnection, performLogin, changeConnection } from "./testbenchConnection";
import { TestBenchTreeDataProvider, initializeTreeView } from "./treeView";
import { startTestExecution } from "./executeRobotFrameworkTests";

export function activate(context: vscode.ExtensionContext) {
    // TODO: Remember the set root tree item after logging in, store it in VS Code storage and fetch it on login, check if it's still valid.
    // TODO: A new command to clear stored login data? (logout doesnt do that)

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

        // Display the commands after logging in
        vscode.commands.executeCommand("testbenchExtension.displayCommands");
        
    });
    context.subscriptions.push(loginDisposable);

    // Register the "Display Commands" command
    context.subscriptions.push(
        vscode.commands.registerCommand("testbenchExtension.displayCommands", async () => {

            // Display the commands based on the connection status. (Logout etc. is only available if connection is active)
            let commands = [];
            if (connection){
                commands = [
                    "Login",
                    "Change connection",
                    "Logout",
                    "Display Test Theme Tree",
                    "Execute Robotframework Test Cases",
                    "Cancel"
                ];
            } else {
                commands = [
                    "Login",
                    "Execute Robotframework Test Cases",
                    "Cancel"];
            }

            const nextAction = await vscode.window.showQuickPick(commands, {
                placeHolder: "What do you want to do?",
            });
   
            // TODO: Pack the command strings into a string list to avoid typos?
            switch (nextAction) {
                case "Login":                
                    vscode.commands.executeCommand("testbenchExtension.login");
                    break;
                case "Change connection":
                    vscode.commands.executeCommand("testbenchExtension.changeConnection");
                    break;
                case "Logout":
                    vscode.commands.executeCommand("testbenchExtension.logout");
                    break;
                case "Display Test Theme Tree":                
                    vscode.commands.executeCommand("testbenchExtension.initTestThemeTree");
                    break;                
                case "Execute Robotframework Test Cases":
                    vscode.commands.executeCommand("testbenchExtension.runRobotTests");
                    break;
                case "Cancel":
                    return;
            }
        })
    );

    // Register the "Browse Projects" command
    context.subscriptions.push(
        vscode.commands.registerCommand("testbenchExtension.initTestThemeTree", async () => {
            treeDataProvider = await initializeTreeView(context, connection);
        })
    );

    // Register the "Logout" command
    context.subscriptions.push(
        vscode.commands.registerCommand("testbenchExtension.logout", async () => {
            if (connection) {
                await connection.logoutUser(context, treeDataProvider!);
                connection = null;  // Clear the connection
            } else {
                vscode.window.showInformationMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Change Connection" command
    context.subscriptions.push(
        vscode.commands.registerCommand("testbenchExtension.changeConnection", async () => {
            let conn = await changeConnection(context, connection!);
            connection = conn;  // Update the connection
            if (conn) {
                treeDataProvider = await initializeTreeView(context, conn); // TODO: changeConnection already calls initializeTreeView, also return a treeDataProvider?
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
        vscode.commands.registerCommand("testbenchExtension.runRobotTests", async () => {
            startTestExecution();
        })
    );

    // Register the "getCycleStructure" command
    context.subscriptions.push(
        vscode.commands.registerCommand("testbenchExtension.getCycleStructure", async () => {
            let cycleStructureResponse2 = await connection!.fetchCycleStructure("26", "168");
        })
    );

    // Uncomment this if you want to prompt the user to log in when the extension activates
    // vscode.commands.executeCommand('testbenchExtension.login');
}

export function deactivate() {}
