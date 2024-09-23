import * as vscode from "vscode";
import * as jsonReportHandler from "./jsonReportHandler";
import { TreeItem, makeRoot } from "./treeView";
import { PlayServerConnection, performLogin, changeConnection } from "./testbenchConnection";
import { TestBenchTreeDataProvider, initializeTreeView } from "./treeView";
import { startTestExecution } from "./executeRobotFrameworkTests";

export function activate(context: vscode.ExtensionContext) {
    // TODO: Remember the set root tree item after logging in, store it in VS Code storage and fetch it on login, check if it's still valid.
    // TODO: A new command to clear stored login data? (logout doesnt do that)

    const commands = {
        displayCommands: "testbenchExtension.displayCommands",
        login: "testbenchExtension.login",
        changeConnection: "testbenchExtension.changeConnection",
        logout: "testbenchExtension.logout",
        displayTestThemeTree: "testbenchExtension.initTestThemeTree",
        executeRobotTests: "testbenchExtension.runRobotTests",
        generateTestCases: "testbenchExtension.generateTestCases",
        makeRoot: "testbenchExtension.makeRoot",
        getCycleStructure: "testbenchExtension.getCycleStructure",
    };

    // Store the connection to server
    let connection: PlayServerConnection | null = null;
    // Store the tree data provider to be able to clear it on logout
    let treeDataProvider: TestBenchTreeDataProvider | null = null;

    let loginDisposable = vscode.commands.registerCommand(commands.login, async () => {
        connection = await performLogin(context);
        if (!connection) {
            return;
        }
        treeDataProvider = await initializeTreeView(context, connection);

        // Display the commands after logging in
        vscode.commands.executeCommand(commands.displayCommands);
    });
    context.subscriptions.push(loginDisposable);

    // Register the "Display Commands" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.displayCommands, async () => {
            // Display the commands based on the connection status. (Logout etc. is only available if connection is active)
            let commandMenuOptions = [];
            if (connection) {
                commandMenuOptions = [
                    // "Login", (Not needed as the user is already logged in)
                    "Logout",
                    "Change connection",
                    "Display Test Theme Tree",
                    "Execute Robotframework Test Cases",
                    "Cancel",
                ];
            } else {
                commandMenuOptions = ["Login", "Execute Robotframework Test Cases", "Cancel"];
            }

            const nextAction = await vscode.window.showQuickPick(commandMenuOptions, {
                placeHolder: "What do you want to do?",
            });

            switch (nextAction) {
                case "Login":
                    vscode.commands.executeCommand(commands.login);
                    break;
                case "Logout":
                    vscode.commands.executeCommand(commands.logout);
                    break;
                case "Change connection":
                    vscode.commands.executeCommand(commands.changeConnection);
                    break;
                case "Display Test Theme Tree":
                    vscode.commands.executeCommand(commands.displayTestThemeTree);
                    break;
                case "Execute Robotframework Test Cases":
                    vscode.commands.executeCommand(commands.executeRobotTests);
                    break;
                case "Cancel":
                    return;
            }
        })
    );

    // Register the "Display Test Theme Tree" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.displayTestThemeTree, async () => {
            // FIXME: This command changes the folder icons to collapsed state although they are expanded, probably bcs getChildren() sets it to collapsed.
            treeDataProvider = await initializeTreeView(context, connection);
        })
    );

    // Register the "Logout" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.logout, async () => {
            if (connection) {
                await connection.logoutUser(context, treeDataProvider!);
                connection = null; // Clear the connection
            } else {
                vscode.window.showInformationMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Change Connection" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.changeConnection, async () => {
            let { newConnection, newTreeDataProvider } = await changeConnection(context, connection!);
            if (newConnection) {
                connection = newConnection; // Update the connection
                if (treeDataProvider) {
                    treeDataProvider = newTreeDataProvider; // Update the tree data provider
                } else {
                    vscode.window.showErrorMessage("Error: TreeDataProvider is null.");
                }
            } else {
                vscode.window.showInformationMessage("Connection change cancelled.");
            }
        })
    );

    // Register the "Generate Test Cases" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.generateTestCases, async (item: TreeItem) => {
            if (connection) {
                jsonReportHandler.startTestGenerationProcess(item, connection);
            } else {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
            }
        })
    );

    // Register the "Make Root" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.makeRoot, (treeItem: TreeItem) => {
            if (treeDataProvider) {
                makeRoot(treeItem, treeDataProvider);
            }
        })
    );

    // Register the "Run Robot Tests" command
    context.subscriptions.push(
        vscode.commands.registerCommand(commands.executeRobotTests, async () => {
            startTestExecution();
        })
    );

    // Uncomment this if you want to prompt the user to log in when the extension activates
    // vscode.commands.executeCommand('testbenchExtension.login');
}

export function deactivate() {}
