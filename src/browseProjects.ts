import * as vscode from "vscode";
import { PlayServerConnection } from "./testbenchConnection";
import { TestBenchTreeDataProvider } from "./explorer";

// Creates a fresh tree view to browse projects
export async function browseProjects(context: vscode.ExtensionContext, connection: PlayServerConnection | null) {
    if (!connection) {
        vscode.window.showInformationMessage("No connection available. Please login first.");
        return;
    }

    // Create the tree view with the connection
    const treeDataProvider = new TestBenchTreeDataProvider(connection);
    // Create the tree view
    const treeView = vscode.window.createTreeView("testBenchProjects", {
        treeDataProvider,
    });

    // Refresh the tree view when necessary
    treeDataProvider.refresh();

    // Handle expansion and collapse events for dynamic icon change of tree view items
    treeView.onDidExpandElement((e) => {
        treeDataProvider.handleExpansion(e.element, true);
    });
    treeView.onDidCollapseElement((e) => {
        treeDataProvider.handleExpansion(e.element, false);
    });
}
