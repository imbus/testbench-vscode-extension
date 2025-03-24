"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const sinon = __importStar(require("sinon"));
const vscode = __importStar(require("vscode"));
const testThemeTreeView_1 = require("../../testThemeTreeView");
const projectManagementTreeView_1 = require("../../projectManagementTreeView");
suite("TestThemeTreeDataProvider Tests", () => {
    let treeDataProvider;
    let sandbox;
    setup(() => {
        treeDataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider();
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
        const parent = new projectManagementTreeView_1.ProjectManagementTreeItem("Parent", "contextValue", vscode.TreeItemCollapsibleState.None, {});
        const child = new projectManagementTreeView_1.ProjectManagementTreeItem("Child", "contextValue", vscode.TreeItemCollapsibleState.None, {}, parent);
        assert.strictEqual(treeDataProvider.getParent(child), parent);
    });
    test("getChildren should return root elements if no element is passed", async () => {
        const rootElements = [
            new projectManagementTreeView_1.ProjectManagementTreeItem("Root1", "contextValue", vscode.TreeItemCollapsibleState.None, {}),
            new projectManagementTreeView_1.ProjectManagementTreeItem("Root2", "contextValue", vscode.TreeItemCollapsibleState.None, {}),
        ];
        treeDataProvider.setRoots(rootElements);
        const children = await treeDataProvider.getChildren();
        assert.deepStrictEqual(children, rootElements);
    });
    test("getChildren should return children of the element", async () => {
        let child1 = new projectManagementTreeView_1.ProjectManagementTreeItem("Child1", "contextValue", vscode.TreeItemCollapsibleState.None, {});
        let child2 = new projectManagementTreeView_1.ProjectManagementTreeItem("Child2", "contextValue", vscode.TreeItemCollapsibleState.None, {});
        let parent = new projectManagementTreeView_1.ProjectManagementTreeItem("Parent", "contextValue", vscode.TreeItemCollapsibleState.None, {
            children: [child1, child2],
        });
        child1.parent = parent;
        child2.parent = parent;
        parent.children = [child1, child2];
        const children = await treeDataProvider.getChildren(parent);
        assert.deepStrictEqual(children, [child1, child2]);
    });
    test("getTreeItem should return the element itself", () => {
        const element = new projectManagementTreeView_1.ProjectManagementTreeItem("Element", "contextValue", vscode.TreeItemCollapsibleState.None, {});
        assert.strictEqual(treeDataProvider.getTreeItem(element), element);
    });
    test("setRoots should set root elements and refresh the tree", () => {
        const rootElements = [
            new projectManagementTreeView_1.ProjectManagementTreeItem("Root1", "contextValue", vscode.TreeItemCollapsibleState.None, {}),
            new projectManagementTreeView_1.ProjectManagementTreeItem("Root2", "contextValue", vscode.TreeItemCollapsibleState.None, {}),
        ];
        const spy = sandbox.spy(treeDataProvider, "refresh");
        treeDataProvider.setRoots(rootElements);
        assert.deepStrictEqual(treeDataProvider.rootElements, rootElements);
        assert.strictEqual(spy.calledOnce, true);
    });
    test("makeRoot should set the selected element as the only root element and refresh the tree", () => {
        const element = new projectManagementTreeView_1.ProjectManagementTreeItem("Element", "contextValue", vscode.TreeItemCollapsibleState.None, {});
        const spy = sandbox.spy(treeDataProvider, "refresh");
        treeDataProvider.makeRoot(element);
        assert.deepStrictEqual(treeDataProvider.rootElements, [element]);
        assert.strictEqual(spy.calledOnce, true);
    });
    test("handleExpansion should update the collapsible state and icon of the element", () => {
        const element = new projectManagementTreeView_1.ProjectManagementTreeItem("Element", "contextValue", vscode.TreeItemCollapsibleState.None, {});
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
//# sourceMappingURL=testThemeTreeView.test.js.map