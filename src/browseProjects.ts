import * as vscode from "vscode";
import { PlayServerConnection } from "./testbenchConnection";
import { TestBenchTreeDataProvider } from "./treeView";

// TODO: Move this file to treeView.ts and remove this file?
// Creates a fresh tree view to browse projects
export async function initializeTreeView(
    context: vscode.ExtensionContext,
    connection: PlayServerConnection | null
): Promise<TestBenchTreeDataProvider | null> {
    if (!connection) {
        vscode.window.showInformationMessage("No connection available. Please login first.");
        return null;
    }

    // Create the tree view with the connection
    const treeDataProvider = new TestBenchTreeDataProvider(connection);
    // Create the tree view
    const treeView = vscode.window.createTreeView("testBenchProjects", {
        treeDataProvider,
    });

    // Handle expansion and collapse events for dynamic icon change of tree view items
    treeView.onDidExpandElement((e) => {
        treeDataProvider.handleExpansion(e.element, true);
    });
    treeView.onDidCollapseElement((e) => {
        treeDataProvider.handleExpansion(e.element, false);
    });

    /*
    // TODO: Collapse all tree elements recursively when the tree view is created, this would fix the icon issue after resfreshing the tree view
    async function collapseAllElements(element: TreeItem) {
        treeDataProvider.handleExpansion(element, false); // Collapse the current element
        const children = await treeDataProvider.getChildren(element); // Get children of the element
        if (children) {
            for (const child of children) {
                await collapseAllElements(child); // Recursively collapse all child elements
            }
        }
    }

    // Collapse all root elements and their children recursively        
    const rootElements = await treeDataProvider.getChildren();
    if (rootElements) {
        for (const rootElement of rootElements) {
            await collapseAllElements(rootElement); // Start recursion from root elements
        }
    }
    */

    treeDataProvider.refresh();
    context.subscriptions.push(treeView);

    vscode.window.showInformationMessage("Tree view created successfully.");
    return treeDataProvider;
}
