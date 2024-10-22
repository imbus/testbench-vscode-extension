import * as assert from "assert";
import * as vscode from "vscode";
import * as testBenchConnection from "../testBenchConnection";
import { ProjectManagementTreeDataProvider } from "../projectManagementTreeView";
import { TestThemeTreeDataProvider } from "../testThemeTreeView";

suite("Project Management Tree View Tests", function () {
    this.timeout(10000); // Increase timeout to 10 seconds
    // Mock Variables
    const context = {} as vscode.ExtensionContext;
    const serverName = "testbench";
    const port = 9445;
    const projectKey = "26";
    const sessionToken = "sessionToken";  // Fake session token

    test("Tree Data Provider Initialization", async () => {
        const connection = new testBenchConnection.PlayServerConnection(context, serverName, port, sessionToken);
        const testThemeDataProvider = new TestThemeTreeDataProvider();
        const treeDataProvider = new ProjectManagementTreeDataProvider(connection, projectKey, testThemeDataProvider);

        assert.ok(treeDataProvider);
        assert.strictEqual(treeDataProvider.currentProjectKeyInView, projectKey);
    });

    test("Tree Item Creation", () => {
        const connection = new testBenchConnection.PlayServerConnection(context, serverName, port, sessionToken);
        const testThemeDataProvider = new TestThemeTreeDataProvider();
        const treeDataProvider = new ProjectManagementTreeDataProvider(connection, projectKey, testThemeDataProvider);

        const data = { name: "Test Project", nodeType: "project" };
        const treeItem = treeDataProvider["createTreeItem"](data, null, true);

        assert.ok(treeItem);
        assert.strictEqual(treeItem?.label, "Test Project");
        assert.strictEqual(treeItem?.contextValue, "project");
    });

    test("Get Children of Root", async () => {
        const connection = new testBenchConnection.PlayServerConnection(context, serverName, port, sessionToken);
        const testThemeDataProvider = new TestThemeTreeDataProvider();
        const treeDataProvider = new ProjectManagementTreeDataProvider(connection, projectKey, testThemeDataProvider);

        const children = await treeDataProvider.getChildren();

        assert.ok(children);
        assert.strictEqual(Array.isArray(children), true);
    });

    test("Get Parent of Tree Item", () => {
        const connection = new testBenchConnection.PlayServerConnection(context, serverName, port, sessionToken);
        const testThemeDataProvider = new TestThemeTreeDataProvider();
        const treeDataProvider = new ProjectManagementTreeDataProvider(connection, projectKey, testThemeDataProvider);

        const parentData = { name: "Parent Project", nodeType: "project" };
        const parentItem = treeDataProvider["createTreeItem"](parentData, null, true);

        const childData = { name: "Child Project", nodeType: "project" };
        const childItem = treeDataProvider["createTreeItem"](childData, parentItem, false);

        const parent = treeDataProvider.getParent(childItem!);

        assert.strictEqual(parent, parentItem);
    });

    test("Clear Tree", () => {
        const connection = new testBenchConnection.PlayServerConnection(context, serverName, port, sessionToken);
        const testThemeDataProvider = new TestThemeTreeDataProvider();
        const treeDataProvider = new ProjectManagementTreeDataProvider(connection, projectKey, testThemeDataProvider);

        treeDataProvider.clearTree();

        assert.strictEqual(treeDataProvider["rootItem"], null);
        assert.strictEqual(treeDataProvider["connection"], null);
    });
});
