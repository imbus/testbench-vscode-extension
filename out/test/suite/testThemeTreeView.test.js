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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const testThemeTreeView_1 = require("../../testThemeTreeView");
const projectManagementTreeView_1 = require("../../projectManagementTreeView");
suite("TestThemeTreeDataProvider Tests", () => {
    suiteTeardown(() => {
        vscode.window.showInformationMessage('All tests done!');
    });
    let dataProvider;
    let rootItem;
    let childItem;
    setup(() => {
        dataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider();
        rootItem = new projectManagementTreeView_1.ProjectManagementTreeItem("Label Root", "Project", vscode.TreeItemCollapsibleState.Collapsed, undefined);
        childItem = new projectManagementTreeView_1.ProjectManagementTreeItem("Label Child", "Version", vscode.TreeItemCollapsibleState.Collapsed, rootItem);
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
//# sourceMappingURL=testThemeTreeView.test.js.map