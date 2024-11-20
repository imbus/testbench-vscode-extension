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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const sinon = __importStar(require("sinon"));
const vscode = __importStar(require("vscode"));
const projectManagementTreeView_1 = require("../../projectManagementTreeView");
const testBenchConnection_1 = require("../../testBenchConnection");
const testThemeTreeView_1 = require("../../testThemeTreeView");
suite("ProjectManagementTreeDataProvider Tests", () => {
    let sandbox;
    let connectionStub;
    let testThemeDataProviderStub;
    let treeDataProvider;
    setup(() => {
        sandbox = sinon.createSandbox();
        connectionStub = sandbox.createStubInstance(testBenchConnection_1.PlayServerConnection);
        testThemeDataProviderStub = sandbox.createStubInstance(testThemeTreeView_1.TestThemeTreeDataProvider);
        treeDataProvider = new projectManagementTreeView_1.ProjectManagementTreeDataProvider(connectionStub, "projectKey", testThemeDataProviderStub);
    });
    teardown(() => {
        sandbox.restore();
    });
    test("getChildren should return empty array when no connection is available", async () => {
        treeDataProvider = new projectManagementTreeView_1.ProjectManagementTreeDataProvider(null, "projectKey", testThemeDataProviderStub);
        const children = await treeDataProvider.getChildren();
        assert_1.default.strictEqual(children.length, 0);
    });
    /*
    // TODO: getChildren returns [] when connection is null.
    test("getChildren should return children of the provided element", async () => {
        const element = new TestbenchTreeItem("Project", "Project", vscode.TreeItemCollapsibleState.Collapsed, {
            children: [{ name: "Version", nodeType: "Version" }],
        });
        const children: TestbenchTreeItem[] = await treeDataProvider.getChildren(element);

        assert.strictEqual(children.length, 1);
        assert.strictEqual(children[0].label, "Version");
    });
    */
    /*
    // TODO: Create a cycleElement mock data so that findProjectKeyOfCycle can work on the cycleElement without any errors.
    test("getChildrenOfCycle should return children of a cycle element", async () => {
        const cycleElement = new ProjectManagementTreeItem("Cycle", "Cycle", vscode.TreeItemCollapsibleState.Collapsed, { key: "cycleKey" });
        const cycleData = {
            root: { base: { key: "rootKey", numbering: "1", parentKey: "parentKey", name: "Root Name", uniqueID: "uniqueID", matchesFilter: true } },
            nodes: [
                { base: { key: "childKey", parentKey: "rootKey", numbering: "1", name: "Test Theme" }, elementType: "TestThemeNode" }
            ]
        };
        connectionStub.fetchCycleStructure.resolves(cycleData);

        const children = await treeDataProvider.getChildrenOfCycle(cycleElement);

        assert.strictEqual(children.length, 1);
        assert.strictEqual(children[0].label, "1 Test Theme");
    });
    */
    test("findProjectKeyOfCycle should return project key of a cycle element", () => {
        const projectElement = new projectManagementTreeView_1.TestbenchTreeItem("Project", "Project", vscode.TreeItemCollapsibleState.Collapsed, {
            key: "projectKey",
        });
        const cycleElement = new projectManagementTreeView_1.TestbenchTreeItem("Cycle", "Cycle", vscode.TreeItemCollapsibleState.Collapsed, { key: "cycleKey" }, projectElement);
        const projectKey = (0, projectManagementTreeView_1.findProjectKeyOfCycleElement)(cycleElement);
        assert_1.default.strictEqual(projectKey, "projectKey");
    });
    test("handleTestCycleClick should initialize test theme tree", async () => {
        const cycleElement = new projectManagementTreeView_1.TestbenchTreeItem("Cycle Label", "Cycle", vscode.TreeItemCollapsibleState.None, {
            key: "cycleKey",
        });
        const cycleData = {
            root: {
                base: {
                    key: "rootKey",
                    numbering: "1",
                    parentKey: "parentKey",
                    name: "Root Name",
                    uniqueID: "uniqueID",
                    matchesFilter: true,
                },
                filters: [],
                elementType: "RootElementType",
            },
            nodes: [
                {
                    base: {
                        key: "childKey",
                        parentKey: "rootKey",
                        numbering: "1",
                        name: "Test Theme",
                        uniqueID: "uniqueID",
                        matchesFilter: true,
                    },
                    elementType: "TestThemeNode",
                    spec: { key: "specKey", locker: null, status: "active" },
                    aut: { key: "autKey", locker: null, status: "active" },
                    exec: { key: "execKey", locker: null, status: "active", execStatus: "pending", verdict: "none" },
                    filters: [],
                },
            ],
        };
        connectionStub.fetchCycleStructure.resolves(cycleData);
        await treeDataProvider.handleTestCycleClick(cycleElement);
        (0, assert_1.default)(testThemeDataProviderStub.clearTree.calledOnce);
        (0, assert_1.default)(testThemeDataProviderStub.setRoots.calledOnce);
    });
});
//# sourceMappingURL=projectManagementTreeView.test.js.map