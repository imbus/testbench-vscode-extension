import assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
    ProjectManagementTreeDataProvider,
    ProjectManagementTreeItem,
    findProjectKeyOfCycleElement,
} from "../../projectManagementTreeView";
import { PlayServerConnection } from "../../testBenchConnection";
import { TestThemeTreeDataProvider } from "../../testThemeTreeView";
import * as testBenchTypes from "../../testBenchTypes";

suite("ProjectManagementTreeDataProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionStub: sinon.SinonStubbedInstance<PlayServerConnection>;
    let testThemeDataProviderStub: sinon.SinonStubbedInstance<TestThemeTreeDataProvider>;
    let treeDataProvider: ProjectManagementTreeDataProvider;

    setup(() => {
        sandbox = sinon.createSandbox();
        connectionStub = sandbox.createStubInstance(PlayServerConnection);
        testThemeDataProviderStub = sandbox.createStubInstance(TestThemeTreeDataProvider);
        treeDataProvider = new ProjectManagementTreeDataProvider(
            "projectKey",
            testThemeDataProviderStub
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("getChildren should return empty array when no connection is available", async () => {
        treeDataProvider = new ProjectManagementTreeDataProvider("projectKey", testThemeDataProviderStub);

        const children: ProjectManagementTreeItem[] = await treeDataProvider.getChildren();

        assert.strictEqual(children.length, 0);
    });

    /*
    // getChildren returns [] when connection is null.
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
        const projectElement = new ProjectManagementTreeItem("Project", "Project", vscode.TreeItemCollapsibleState.Collapsed, {
            key: "projectKey",
        });
        const cycleElement = new ProjectManagementTreeItem(
            "Cycle",
            "Cycle",
            vscode.TreeItemCollapsibleState.Collapsed,
            { key: "cycleKey" },
            projectElement
        );

        const projectKey = findProjectKeyOfCycleElement(cycleElement);

        assert.strictEqual(projectKey, "projectKey");
    });

    test("handleTestCycleClick should initialize test theme tree", async () => {
        const cycleElement = new ProjectManagementTreeItem("Cycle Label", "Cycle", vscode.TreeItemCollapsibleState.None, {
            key: "cycleKey",
        });
        const cycleData: testBenchTypes.CycleStructure = {
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
        connectionStub.fetchCycleStructureOfCycleInProject.resolves(cycleData);

        await treeDataProvider.handleTestCycleClick(cycleElement);

        assert(testThemeDataProviderStub.clearTree.calledOnce);
        assert(testThemeDataProviderStub.setRoots.calledOnce);
    });
});
