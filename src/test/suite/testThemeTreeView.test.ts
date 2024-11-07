import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { TestThemeTreeDataProvider } from "../../testThemeTreeView";
import { TestbenchTreeItem } from "../../projectManagementTreeView";

suite("TestThemeTreeDataProvider Tests", () => {
    let treeDataProvider: TestThemeTreeDataProvider;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        treeDataProvider = new TestThemeTreeDataProvider();
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("refresh should fire onDidChangeTreeData event", () => {
        const spy = sandbox.spy(treeDataProvider["_onDidChangeTreeData"], "fire");
        treeDataProvider.refresh();
        assert.strictEqual(spy.calledOnce, true);
    });

    test("getParent should return the parent of the element", () => {
        const parent = new TestbenchTreeItem("Parent", "contextValue", vscode.TreeItemCollapsibleState.None, {});
        const child = new TestbenchTreeItem("Child", "contextValue", vscode.TreeItemCollapsibleState.None, {}, parent);
        assert.strictEqual(treeDataProvider.getParent(child), parent);
    });

    test("getChildren should return root elements if no element is passed", async () => {
        const rootElements: TestbenchTreeItem[] = [
            new TestbenchTreeItem("Root1", "contextValue", vscode.TreeItemCollapsibleState.None, {}),
            new TestbenchTreeItem("Root2", "contextValue", vscode.TreeItemCollapsibleState.None, {}),
        ];
        treeDataProvider.setRoots(rootElements);
        const children: TestbenchTreeItem[] = await treeDataProvider.getChildren();
        assert.deepStrictEqual(children, rootElements);
    });

    test("getChildren should return children of the element", async () => {
        let child1 = new TestbenchTreeItem("Child1", "contextValue", vscode.TreeItemCollapsibleState.None, {});
        let child2 = new TestbenchTreeItem("Child2", "contextValue", vscode.TreeItemCollapsibleState.None, {});
        let parent = new TestbenchTreeItem("Parent", "contextValue", vscode.TreeItemCollapsibleState.None, {
            children: [child1, child2],
        });
        child1.parent = parent;
        child2.parent = parent;
        parent.children = [child1, child2];
        const children = await treeDataProvider.getChildren(parent);
        assert.deepStrictEqual(children, [child1, child2]);
    });

    test("getTreeItem should return the element itself", () => {
        const element = new TestbenchTreeItem("Element", "contextValue", vscode.TreeItemCollapsibleState.None, {});
        assert.strictEqual(treeDataProvider.getTreeItem(element), element);
    });

    test("setRoots should set root elements and refresh the tree", () => {
        const rootElements = [
            new TestbenchTreeItem("Root1", "contextValue", vscode.TreeItemCollapsibleState.None, {}),
            new TestbenchTreeItem("Root2", "contextValue", vscode.TreeItemCollapsibleState.None, {}),
        ];
        const spy = sandbox.spy(treeDataProvider, "refresh");
        treeDataProvider.setRoots(rootElements);
        assert.deepStrictEqual(treeDataProvider.rootElements, rootElements);
        assert.strictEqual(spy.calledOnce, true);
    });

    test("makeRoot should set the selected element as the only root element and refresh the tree", () => {
        const element = new TestbenchTreeItem("Element", "contextValue", vscode.TreeItemCollapsibleState.None, {});
        const spy = sandbox.spy(treeDataProvider, "refresh");
        treeDataProvider.makeRoot(element);
        assert.deepStrictEqual(treeDataProvider.rootElements, [element]);
        assert.strictEqual(spy.calledOnce, true);
    });

    test("handleExpansion should update the collapsible state and icon of the element", () => {
        const element = new TestbenchTreeItem("Element", "contextValue", vscode.TreeItemCollapsibleState.None, {});
        const updateIconSpy = sandbox.spy(element, "updateIcon");
        treeDataProvider.handleExpansion(element, true);
        assert.strictEqual(element.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
        assert.strictEqual(updateIconSpy.calledOnce, true);

        treeDataProvider.handleExpansion(element, false);
        assert.strictEqual(element.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        assert.strictEqual(updateIconSpy.calledTwice, true);
    });

    test("clearTree should clear root elements and refresh the tree", () => {
        const spy = sandbox.spy(treeDataProvider, "refresh");
        treeDataProvider.clearTree();
        assert.deepStrictEqual(treeDataProvider.rootElements, []);
        assert.strictEqual(spy.calledOnce, true);
    });
});
