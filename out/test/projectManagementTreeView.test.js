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
const testBenchConnection = __importStar(require("../testBenchConnection"));
const projectManagementTreeView_1 = require("../projectManagementTreeView");
const testThemeTreeView_1 = require("../testThemeTreeView");
suite("Project Management Tree View Tests", function () {
    this.timeout(10000); // Increase timeout to 10 seconds
    // Mock Variables
    const context = {};
    const serverName = "testbench";
    const port = 9445;
    const projectKey = "26";
    const sessionToken = "sessionToken"; // Fake session token
    test("Tree Data Provider Initialization", async () => {
        const connection = new testBenchConnection.PlayServerConnection(context, serverName, port, sessionToken);
        const testThemeDataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider();
        const treeDataProvider = new projectManagementTreeView_1.ProjectManagementTreeDataProvider(connection, projectKey, testThemeDataProvider);
        assert.ok(treeDataProvider);
        assert.strictEqual(treeDataProvider.currentProjectKeyInView, projectKey);
    });
    test("Tree Item Creation", () => {
        const connection = new testBenchConnection.PlayServerConnection(context, serverName, port, sessionToken);
        const testThemeDataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider();
        const treeDataProvider = new projectManagementTreeView_1.ProjectManagementTreeDataProvider(connection, projectKey, testThemeDataProvider);
        const data = { name: "Test Project", nodeType: "project" };
        const treeItem = treeDataProvider["createTreeItem"](data, null, true);
        assert.ok(treeItem);
        assert.strictEqual(treeItem?.label, "Test Project");
        assert.strictEqual(treeItem?.contextValue, "project");
    });
    test("Get Children of Root", async () => {
        const connection = new testBenchConnection.PlayServerConnection(context, serverName, port, sessionToken);
        const testThemeDataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider();
        const treeDataProvider = new projectManagementTreeView_1.ProjectManagementTreeDataProvider(connection, projectKey, testThemeDataProvider);
        const children = await treeDataProvider.getChildren();
        assert.ok(children);
        assert.strictEqual(Array.isArray(children), true);
    });
    test("Get Parent of Tree Item", () => {
        const connection = new testBenchConnection.PlayServerConnection(context, serverName, port, sessionToken);
        const testThemeDataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider();
        const treeDataProvider = new projectManagementTreeView_1.ProjectManagementTreeDataProvider(connection, projectKey, testThemeDataProvider);
        const parentData = { name: "Parent Project", nodeType: "project" };
        const parentItem = treeDataProvider["createTreeItem"](parentData, null, true);
        const childData = { name: "Child Project", nodeType: "project" };
        const childItem = treeDataProvider["createTreeItem"](childData, parentItem, false);
        const parent = treeDataProvider.getParent(childItem);
        assert.strictEqual(parent, parentItem);
    });
    test("Clear Tree", () => {
        const connection = new testBenchConnection.PlayServerConnection(context, serverName, port, sessionToken);
        const testThemeDataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider();
        const treeDataProvider = new projectManagementTreeView_1.ProjectManagementTreeDataProvider(connection, projectKey, testThemeDataProvider);
        treeDataProvider.clearTree();
        assert.strictEqual(treeDataProvider["rootItem"], null);
        assert.strictEqual(treeDataProvider["connection"], null);
    });
});
//# sourceMappingURL=projectManagementTreeView.test.js.map