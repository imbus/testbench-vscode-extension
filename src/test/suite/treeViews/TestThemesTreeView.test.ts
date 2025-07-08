/**
 * @file src/test/suite/treeViews/TestThemesTreeView.test.ts
 * @description Tests for the TestThemesTreeView class
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { TestThemesTreeView } from "../../../treeViews/implementations/testThemes/TestThemesTreeView";
import { PlayServerConnection } from "../../../testBenchConnection";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { testThemesConfig } from "../../../treeViews/implementations/testThemes/TestThemesConfig";

suite("TestThemesTreeView", function () {
    let testEnv: TestEnvironment;
    let mockContext: vscode.ExtensionContext;
    let treeView: TestThemesTreeView;
    let mockConnection: sinon.SinonStubbedInstance<PlayServerConnection>;
    let mockVSCodeTreeView: vscode.TreeView<any>;

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockContext = testEnv.mockContext;
        mockConnection = testEnv.sandbox.createStubInstance(PlayServerConnection);
        const getConnection = () => mockConnection;

        treeView = new TestThemesTreeView(mockContext, getConnection, testThemesConfig);
        mockVSCodeTreeView = {
            title: testThemesConfig.title,
            visible: true,
            onDidChangeVisibility: new vscode.EventEmitter<vscode.TreeViewVisibilityChangeEvent>().event,
            onDidChangeSelection: new vscode.EventEmitter<vscode.TreeViewSelectionChangeEvent<any>>().event,
            onDidExpandElement: new vscode.EventEmitter<vscode.TreeViewExpansionEvent<any>>().event,
            onDidCollapseElement: new vscode.EventEmitter<vscode.TreeViewExpansionEvent<any>>().event,
            reveal: testEnv.sandbox.stub().resolves(),
            dispose: testEnv.sandbox.stub()
        } as any;

        treeView.setTreeView(mockVSCodeTreeView);
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("Title Update Functionality", function () {
        test("should update title correctly when loading test theme from a cycle", async function () {
            const projectKey = "project-123";
            const cycleKey = "cycle-456";
            const projectName = "Test Project";
            const tovName = "Test TOV";
            const cycleLabel = "Test Cycle";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchCycleStructure: testEnv.sandbox.stub().resolves({
                    nodes: [],
                    root: { base: { key: "root" } }
                })
            };
            (treeView as any).dataProvider = mockDataProvider;

            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).buildTreeRecursively = testEnv.sandbox.stub().returns([]);
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadCycle(projectKey, cycleKey, projectName, tovName, cycleLabel);
            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Themes (Test Project, Test TOV, Test Cycle)",
                "Title should be formatted correctly with correct context information"
            );
        });

        test("should update title correctly when loading from cycle with cycle name missing", async function () {
            const projectKey = "project-123";
            const cycleKey = "cycle-456";
            const projectName = "Test Project";
            const tovName = "Test TOV";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchCycleStructure: testEnv.sandbox.stub().resolves({
                    nodes: [],
                    root: { base: { key: "root" } }
                })
            };
            (treeView as any).dataProvider = mockDataProvider;

            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).buildTreeRecursively = testEnv.sandbox.stub().returns([]);
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadCycle(projectKey, cycleKey, projectName, tovName);
            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Themes (Test Project, Test TOV)",
                "Title should be formatted correctly without cycle name"
            );
        });

        test("should update title correctly when loading from cycle with tov name missing", async function () {
            const projectKey = "project-123";
            const cycleKey = "cycle-456";
            const projectName = "Test Project";
            const tovName = "";
            const cycleLabel = "Test Cycle";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchCycleStructure: testEnv.sandbox.stub().resolves({
                    nodes: [],
                    root: { base: { key: "root" } }
                })
            };
            (treeView as any).dataProvider = mockDataProvider;
            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).buildTreeRecursively = testEnv.sandbox.stub().returns([]);
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadCycle(projectKey, cycleKey, projectName, tovName, cycleLabel);

            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Themes (Test Project, Test Cycle)",
                "Title should be formatted correctly for cycle with only project name"
            );
        });

        test("should update title correctly when loading test themes from TOV", async function () {
            const projectKey = "project-123";
            const tovKey = "tov-456";
            const projectName = "Test Project";
            const tovName = "Test TOV";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchTovStructure: testEnv.sandbox.stub().resolves({
                    nodes: [],
                    root: { base: { key: "root" } }
                })
            };
            (treeView as any).dataProvider = mockDataProvider;
            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).buildTreeRecursively = testEnv.sandbox.stub().returns([]);
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadTov(projectKey, tovKey, projectName, tovName);

            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Themes (Test Project, Test TOV)",
                "Title should be formatted correctly for TOV with all parameters"
            );
        });

        test("should update title correctly when loading test themes from TOV with missing project name", async function () {
            const projectKey = "project-123";
            const tovKey = "tov-456";
            const projectName = "";
            const tovName = "Test TOV";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchTovStructure: testEnv.sandbox.stub().resolves({
                    nodes: [],
                    root: { base: { key: "root" } }
                })
            };
            (treeView as any).dataProvider = mockDataProvider;
            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).buildTreeRecursively = testEnv.sandbox.stub().returns([]);
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadTov(projectKey, tovKey, projectName, tovName);

            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Themes (Test TOV)",
                "Title should be formatted correctly for TOV with only TOV name"
            );
        });

        test("should reset title to default when clearing tree", function () {
            treeView.updateTitle("Custom Title");
            assert.strictEqual(mockVSCodeTreeView.title, "Custom Title");
            treeView.clearTree();

            assert.strictEqual(
                mockVSCodeTreeView.title,
                testThemesConfig.title,
                "Title should be reset to default when clearing tree"
            );
        });

        test("should handle empty or undefined parameters gracefully", async function () {
            const projectKey = "project-123";
            const cycleKey = "cycle-456";
            const projectName = "";
            const tovName = "";
            const cycleLabel = "";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchCycleStructure: testEnv.sandbox.stub().resolves({
                    nodes: [],
                    root: { base: { key: "root" } }
                })
            };
            (treeView as any).dataProvider = mockDataProvider;
            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).buildTreeRecursively = testEnv.sandbox.stub().returns([]);
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadCycle(projectKey, cycleKey, projectName, tovName, cycleLabel);

            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Themes",
                "Title should fall back to base title when all parameters are empty"
            );
        });

        test("should update title correctly when loading TOV with null as parameters", async function () {
            const projectKey = "project-123";
            const tovKey = "tov-456";
            const projectName = null as any;
            const tovName = null as any;

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchTovStructure: testEnv.sandbox.stub().resolves({
                    nodes: [],
                    root: { base: { key: "root" } }
                })
            };
            (treeView as any).dataProvider = mockDataProvider;
            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).buildTreeRecursively = testEnv.sandbox.stub().returns([]);
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadTov(projectKey, tovKey, projectName, tovName);

            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Themes",
                "Title should fall back to base title when parameters are null"
            );
        });
    });

    suite("State Management", function () {
        test("should set correct state when loading cycle", async function () {
            const projectKey = "project-123";
            const cycleKey = "cycle-456";
            const projectName = "Test Project";
            const tovName = "Test TOV";
            const cycleLabel = "Test Cycle";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchCycleStructure: testEnv.sandbox.stub().resolves({
                    nodes: [],
                    root: { base: { key: "root" } }
                })
            };
            (treeView as any).dataProvider = mockDataProvider;
            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).buildTreeRecursively = testEnv.sandbox.stub().returns([]);
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadCycle(projectKey, cycleKey, projectName, tovName, cycleLabel);

            assert.strictEqual(treeView.getCurrentProjectKey(), projectKey);
            assert.strictEqual(treeView.getCurrentCycleKey(), cycleKey);
            assert.strictEqual(treeView.getCurrentCycleLabel(), cycleLabel);
            assert.strictEqual(treeView.getCurrentProjectName(), projectName);
            assert.strictEqual(treeView.getCurrentTovName(), tovName);
            assert.strictEqual((treeView as any).isOpenedFromCycle, true);
        });

        test("should set correct state when loading TOV", async function () {
            const projectKey = "project-123";
            const tovKey = "tov-456";
            const projectName = "Test Project";
            const tovName = "Test TOV";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchTovStructure: testEnv.sandbox.stub().resolves({
                    nodes: [],
                    root: { base: { key: "root" } }
                })
            };
            (treeView as any).dataProvider = mockDataProvider;
            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).buildTreeRecursively = testEnv.sandbox.stub().returns([]);
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadTov(projectKey, tovKey, projectName, tovName);

            assert.strictEqual(treeView.getCurrentProjectKey(), projectKey);
            assert.strictEqual((treeView as any).currentTovKey, tovKey);
            assert.strictEqual(treeView.getCurrentProjectName(), projectName);
            assert.strictEqual(treeView.getCurrentTovName(), tovName);
            assert.strictEqual((treeView as any).isOpenedFromCycle, false);
        });

        test("should clear state when clearing tree", function () {
            (treeView as any).currentProjectKey = "test-project";
            (treeView as any).currentCycleKey = "test-cycle";
            (treeView as any).currentCycleLabel = "test-cycle-label";
            (treeView as any).currentTovKey = "test-tov";
            (treeView as any).isOpenedFromCycle = true;

            treeView.clearTree();

            assert.strictEqual(treeView.getCurrentProjectKey(), null);
            assert.strictEqual(treeView.getCurrentCycleKey(), null);
            assert.strictEqual(treeView.getCurrentCycleLabel(), null);
            assert.strictEqual((treeView as any).currentTovKey, null);
            assert.strictEqual((treeView as any).isOpenedFromCycle, false);
        });
    });
});
