/**
 * @file src/test/suite/treeViews/TestThemesTreeView.test.ts
 * @description Tests for the TestThemesTreeView class
 */

import assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { TestThemesTreeView } from "../../../treeViews/implementations/testThemes/TestThemesTreeView";
import { PlayServerConnection } from "../../../testBenchConnection";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { testThemesConfig } from "../../../treeViews/implementations/testThemes/TestThemesConfig";
import { TestThemeItemTypes } from "../../../constants";

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
            const tovKey = "tov-123";
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

            await treeView.loadCycle(projectKey, cycleKey, tovKey, projectName, tovName, cycleLabel);
            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Themes (Test Project, Test TOV, Test Cycle)",
                "Title should be formatted correctly with correct context information"
            );
        });

        test("should update title correctly when loading from cycle with cycle name missing", async function () {
            const projectKey = "project-123";
            const cycleKey = "cycle-456";
            const tovKey = "tov-789";
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

            await treeView.loadCycle(projectKey, cycleKey, tovKey, projectName, tovName);
            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Themes (Test Project, Test TOV)",
                "Title should be formatted correctly without cycle name"
            );
        });

        test("should update title correctly when loading from cycle with tov name missing", async function () {
            const projectKey = "project-123";
            const cycleKey = "cycle-456";
            const tovKey = "tov-456";
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

            await treeView.loadCycle(projectKey, cycleKey, tovKey, projectName, tovName, cycleLabel);

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
            const tovKey = "tov-789";
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

            await treeView.loadCycle(projectKey, cycleKey, tovKey, projectName, tovName, cycleLabel);

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
            const tovKey = "tov-101";
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

            await treeView.loadCycle(projectKey, cycleKey, tovKey, projectName, tovName, cycleLabel);

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

    suite("Import Scope Resolution", function () {
        test("should keep clicked UID for TestCaseSet imports", function () {
            const itemUID = "clicked-uid";
            const item = {
                id: "descendant-id",
                label: "Clicked Test Case Set",
                data: {
                    elementType: TestThemeItemTypes.TEST_CASE_SET
                }
            } as any;

            const markingModule = {
                getRootIDForDescendant: testEnv.sandbox.stub().returns("root-id"),
                getMarkingInfo: testEnv.sandbox.stub().returns({ metadata: { uniqueID: "root-uid" } })
            } as any;

            const result = (treeView as any).resolveImportScope(item, itemUID, markingModule);

            assert.strictEqual(result.importUID, itemUID);
            assert.strictEqual(result.rootId, "root-id");
            assert.strictEqual(markingModule.getRootIDForDescendant.calledOnce, true);
            assert.strictEqual(markingModule.getMarkingInfo.called, false);
        });

        test("should keep clicked UID for TestTheme descendants", function () {
            const itemUID = "clicked-uid";
            const item = {
                id: "descendant-id",
                label: "Clicked Test Theme",
                data: {
                    elementType: TestThemeItemTypes.TEST_THEME
                }
            } as any;

            const markingModule = {
                getRootIDForDescendant: testEnv.sandbox.stub().returns("root-id"),
                getMarkingInfo: testEnv.sandbox.stub().returns({ metadata: { uniqueID: "root-uid" } })
            } as any;

            const result = (treeView as any).resolveImportScope(item, itemUID, markingModule);

            assert.strictEqual(result.importUID, itemUID);
            assert.strictEqual(result.rootId, "root-id");
            assert.strictEqual(markingModule.getRootIDForDescendant.calledOnce, true);
            assert.strictEqual(markingModule.getMarkingInfo.called, false);
        });

        test("should return clicked UID with null rootId when no hierarchy root exists", function () {
            const itemUID = "clicked-uid";
            const item = {
                id: "standalone-id",
                label: "Standalone Item",
                data: {
                    elementType: TestThemeItemTypes.TEST_THEME
                }
            } as any;

            const markingModule = {
                getRootIDForDescendant: testEnv.sandbox.stub().returns(null),
                getMarkingInfo: testEnv.sandbox.stub()
            } as any;

            const result = (treeView as any).resolveImportScope(item, itemUID, markingModule);

            assert.strictEqual(result.importUID, itemUID);
            assert.strictEqual(result.rootId, null);
            assert.strictEqual(markingModule.getRootIDForDescendant.calledOnce, true);
            assert.strictEqual(markingModule.getMarkingInfo.called, false);
        });
    });

    suite("Click Handler Functionality", function () {
        let mockTestThemesTreeItem: any;

        this.beforeEach(function () {
            mockTestThemesTreeItem = {
                id: "test-item-id",
                label: "Test Case Set",
                data: {
                    elementType: "TestCaseSetNode",
                    base: {
                        key: "test-case-set-123",
                        name: "Test Case Set",
                        uniqueID: "uid-123"
                    }
                },
                hasGeneratedRobotFile: testEnv.sandbox.stub().returns(true),
                getRobotFilePath: testEnv.sandbox.stub().returns("/path/to/test.robot"),
                openGeneratedRobotFile: testEnv.sandbox.stub().resolves()
            };
        });

        test("should handle single click on test case set item", async function () {
            mockTestThemesTreeItem.hasGeneratedRobotFile.returns(false);

            await (treeView as any).handleTestCaseSetSingleClick(mockTestThemesTreeItem);
            assert(
                !mockTestThemesTreeItem.openGeneratedRobotFile.called,
                "Robot file should not be opened when it doesn't exist"
            );
        });

        test("should open robot file on single click when file exists", async function () {
            mockTestThemesTreeItem.hasGeneratedRobotFile.returns(true);

            await (treeView as any).handleTestCaseSetSingleClick(mockTestThemesTreeItem);

            assert(
                mockTestThemesTreeItem.openGeneratedRobotFile.calledOnce,
                "Robot file should be opened when it exists"
            );
        });

        test("should handle double click on test case set item", async function () {
            mockTestThemesTreeItem.hasGeneratedRobotFile.returns(false);

            await (treeView as any).handleTestCaseSetDoubleClick(mockTestThemesTreeItem);

            assert(
                !testEnv.vscodeMocks.showWarningMessageStub.called,
                "No warning message should be shown when no robot file exists (implementation is silent)"
            );

            assert(
                !mockTestThemesTreeItem.openGeneratedRobotFile.called,
                "Robot file should not be opened when it doesn't exist"
            );
        });

        test("should not reveal in explorer when robot file path is undefined", async function () {
            mockTestThemesTreeItem.hasGeneratedRobotFile.returns(true);
            mockTestThemesTreeItem.getRobotFilePath.returns(undefined);

            await (treeView as any).handleTestCaseSetDoubleClick(mockTestThemesTreeItem);

            assert(
                mockTestThemesTreeItem.openGeneratedRobotFile.calledOnce,
                "Robot file should be opened when it exists"
            );
            assert(
                !testEnv.vscodeMocks.executeCommandStub.calledWith("revealInExplorer"),
                "revealInExplorer should not be called when path is undefined"
            );
        });

        test("should set up click handlers correctly", function () {
            assert(treeView.testCaseSetClickHandler, "Click handler should be initialized");

            const handlers = (treeView.testCaseSetClickHandler as any).handlers;
            assert(handlers.onSingleClick, "Single click handler should be set");
            assert(handlers.onDoubleClick, "Double click handler should be set");
        });

        test("should handle click events through the click handler", async function () {
            mockTestThemesTreeItem.hasGeneratedRobotFile.returns(true);

            const mockHandleSingleClick = testEnv.sandbox
                .stub(treeView as any, "handleTestCaseSetSingleClick")
                .resolves();

            await treeView.testCaseSetClickHandler.handleClick(mockTestThemesTreeItem, "test-item-id", testEnv.logger);

            assert(mockHandleSingleClick.calledOnce, "Single click handler should be called for single click");
        });

        test("should handle double click events through the click handler", async function () {
            mockTestThemesTreeItem.hasGeneratedRobotFile.returns(true);

            const mockHandleDoubleClick = testEnv.sandbox
                .stub(treeView as any, "handleTestCaseSetDoubleClick")
                .resolves();

            await treeView.testCaseSetClickHandler.handleClick(mockTestThemesTreeItem, "test-item-id", testEnv.logger);
            await treeView.testCaseSetClickHandler.handleClick(mockTestThemesTreeItem, "test-item-id", testEnv.logger);

            assert(mockHandleDoubleClick.calledOnce, "Double click handler should be called for double click");
        });
    });

    suite("Generation Lock Independence", function () {
        let mockGenerationItem: any;
        let executeClearInternalDirIfNeededStub: sinon.SinonStub;

        this.beforeEach(function () {
            (treeView as any).currentProjectKey = "project-1";
            (treeView as any).currentCycleKey = "cycle-1";
            (treeView as any).currentTovKey = "tov-1";
            (treeView as any).isOpenedFromCycle = true;

            mockGenerationItem = {
                id: "item-1",
                label: "Theme A",
                lockedByOther: false,
                data: {
                    base: {
                        key: "key-1",
                        uniqueID: "uid-1",
                        name: "Theme A"
                    },
                    elementType: TestThemeItemTypes.TEST_THEME
                }
            };

            executeClearInternalDirIfNeededStub = testEnv.sandbox
                .stub(treeView as any, "executeClearInternalDirIfNeeded")
                .resolves();
            testEnv.sandbox.stub(treeView as any, "handleSuccessfulGeneration").resolves();
        });

        test("should generate tests even when selected scope is locked by another user", async function () {
            mockGenerationItem.lockedByOther = true;
            const performTestGenerationStub = testEnv.sandbox
                .stub(treeView as any, "performTestGeneration")
                .resolves(true);

            await treeView.generateTestCases(mockGenerationItem);

            assert(
                testEnv.vscodeMocks.showWarningMessageStub.notCalled,
                "No lock warning should be shown for test generation"
            );
            assert(performTestGenerationStub.calledOnce, "Generation should proceed for locked tree items");
            assert(
                executeClearInternalDirIfNeededStub.calledOnce,
                "Internal directory cleanup should run when generation starts"
            );
        });
    });
});
