import * as assert from "assert";
import * as vscode from "vscode";
import { TestThemeTreeDataProvider } from "../../testThemeTreeView";
import { ProjectManagementTreeItem } from "../../projectManagementTreeView";

suite("TestThemeTreeDataProvider Tests", () => {

    suiteTeardown(() => {
        vscode.window.showInformationMessage('All tests done!');
      });

    let dataProvider: TestThemeTreeDataProvider;
    let rootItem: ProjectManagementTreeItem;
    let childItem: ProjectManagementTreeItem;

    setup(() => {
        dataProvider = new TestThemeTreeDataProvider();
        rootItem = new ProjectManagementTreeItem("Label Root", "Project", vscode.TreeItemCollapsibleState.Collapsed, undefined);
        childItem = new ProjectManagementTreeItem("Label Child", "Version", vscode.TreeItemCollapsibleState.Collapsed, rootItem);
        rootItem.children = [childItem];
    });
    
    test("Set and get root elements", async () => {
        dataProvider.setRoots([rootItem]);
        const children = await dataProvider.getChildren();
        assert.deepStrictEqual(children, [rootItem]);
    });    

    test("Get children of a root element", async () => {
        dataProvider.setRoots([rootItem]);
        const children = await dataProvider.getChildren(rootItem);
        assert.deepStrictEqual(children, [childItem]);
    });

    test("Get parent of a child element", () => {
        assert.strictEqual(dataProvider.getParent(childItem), rootItem);
    });

    test("Get tree item", () => {
        assert.strictEqual(dataProvider.getTreeItem(rootItem), rootItem);
    });

    test("Make root element", async () => {
        dataProvider.setRoots([rootItem]);
        dataProvider.makeRoot(childItem);
        const children = await dataProvider.getChildren();
        assert.deepStrictEqual(children, [childItem]);
    });

    test("Handle expansion", () => {
        dataProvider.handleExpansion(rootItem, true);
        assert.strictEqual(rootItem.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);

        dataProvider.handleExpansion(rootItem, false);
        assert.strictEqual(rootItem.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    });

    test("Clear tree", async () => {
        dataProvider.setRoots([rootItem]);
        dataProvider.clearTree();
        const children = await dataProvider.getChildren();
        assert.deepStrictEqual(children, []);
    });
});