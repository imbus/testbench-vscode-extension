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
            connectionStub,
            "projectKey",
            testThemeDataProviderStub
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("getChildren should return root project when no element is provided", async () => {
        const projectTree = {
            name: "Project",
            nodeType: "Project",
            children: [],
            key: "projectKey",
            creationTime: new Date().toISOString(),
            status: "active",
            visibility: true,
        };
        connectionStub.getProjectTreeOfProject.resolves(projectTree);

        const children = await treeDataProvider.getChildren();

        assert.strictEqual(children.length, 1);
        assert.strictEqual(children[0].label, "Project");
    });

    test("getChildren should return empty array when no connection is available", async () => {
        treeDataProvider = new ProjectManagementTreeDataProvider(null, "projectKey", testThemeDataProviderStub);

        const children = await treeDataProvider.getChildren();

        assert.strictEqual(children.length, 0);
    });

    test("getChildren should return children of the provided element", async () => {
        const element = new ProjectManagementTreeItem("Project", "Project", vscode.TreeItemCollapsibleState.Collapsed, {
            children: [{ name: "Version", nodeType: "Version" }],
        });
        const children = await treeDataProvider.getChildren(element);

        assert.strictEqual(children.length, 1);
        assert.strictEqual(children[0].label, "Version");
    });

    /*
    // TODO: Create a cycleElement mock data so that findProjectKeyOfCycle can work on the cycleElement without any errors.
    test("getChildrenOfCycle should return children of a cycle element", async () => {
        const cycleElement = new ProjectManagementTreeItem("Cycle", "Cycle", vscode.TreeItemCollapsibleState.Collapsed, { key: "cycleKey" });
        const cycleData = {
            root: { base: { key: "rootKey" } },
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
        const projectElement = new ProjectManagementTreeItem(
            "Project",
            "Project",
            vscode.TreeItemCollapsibleState.Collapsed,
            { key: "projectKey" }
        );
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
        const cycleElement = new ProjectManagementTreeItem(
            "Cycle",
            "Cycle",
            vscode.TreeItemCollapsibleState.Collapsed,
            { key: "cycleKey" }
        );
        const cycleData = {
            root: { base: { key: "rootKey" } },
            nodes: [
                {
                    base: { key: "childKey", parentKey: "rootKey", numbering: "1", name: "Test Theme" },
                    elementType: "TestThemeNode",
                },
            ],
        };
        connectionStub.fetchCycleStructure.resolves(cycleData);

        await treeDataProvider.handleTestCycleClick(cycleElement);

        assert(testThemeDataProviderStub.clearTree.calledOnce);
        assert(testThemeDataProviderStub.setRoots.calledOnce);
    });
});
