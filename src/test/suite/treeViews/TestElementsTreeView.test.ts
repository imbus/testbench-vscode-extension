/**
 * @file src/test/suite/treeViews/TestElementsTreeView.test.ts
 * @description Tests for TestElementsTreeView functionality
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { TestElementsTreeView } from "../../../treeViews/implementations/testElements/TestElementsTreeView";
import {
    TestElementsTreeItem,
    TestElementType
} from "../../../treeViews/implementations/testElements/TestElementsTreeItem";
import { PlayServerConnection } from "../../../testBenchConnection";
import { TestBenchLogger } from "../../../testBenchLogger";
import { EventBus } from "../../../treeViews/utils/EventBus";
import { StateManager } from "../../../treeViews/state/StateManager";
import { ResourceFileService } from "../../../treeViews/implementations/testElements/ResourceFileService";
import { testElementsConfig } from "../../../treeViews/implementations/testElements/TestElementsConfig";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";

suite("TestElementsTreeView", function () {
    let testEnv: TestEnvironment;
    let treeView: TestElementsTreeView;
    let mockConnection: sinon.SinonStubbedInstance<PlayServerConnection>;
    let mockLogger: sinon.SinonStubbedInstance<TestBenchLogger>;
    let mockEventBus: sinon.SinonStubbedInstance<EventBus>;
    let mockStateManager: sinon.SinonStubbedInstance<StateManager>;
    let mockResourceFileService: sinon.SinonStubbedInstance<ResourceFileService>;
    let getConnectionStub: sinon.SinonStub;
    let mockVSCodeTreeView: vscode.TreeView<any>;

    const createMockTestElementData = (overrides: Partial<any> = {}) => ({
        id: "test-item-1",
        parentId: null,
        name: "TestResource [Robot-Resource]",
        hierarchicalName: "TestFolder/TestResource [Robot-Resource]",
        testElementType: TestElementType.Subdivision,
        uniqueID: "test-uid-123",
        libraryKey: null,
        jsonString: "{}",
        details: {},
        directRegexMatch: false,
        isLocallyAvailable: false,
        localPath: undefined,
        ...overrides
    });

    const createMockTestElementItem = (data: any, parent?: TestElementsTreeItem) => {
        return new TestElementsTreeItem(data, testEnv.mockContext, parent, treeView.eventBus!);
    };

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockConnection = testEnv.sandbox.createStubInstance(PlayServerConnection);
        mockLogger = testEnv.sandbox.createStubInstance(TestBenchLogger);
        mockEventBus = testEnv.sandbox.createStubInstance(EventBus);
        mockStateManager = testEnv.sandbox.createStubInstance(StateManager);
        mockResourceFileService = testEnv.sandbox.createStubInstance(ResourceFileService);

        mockStateManager.getState.returns({
            loading: false,
            error: null,
            initialized: false,
            lastRefresh: Date.now(),
            items: new Map(),
            rootItems: [],
            customRoot: null,
            marking: null,
            expansion: null,
            filtering: null,
            selectedItemId: null,
            selectedProjectKey: null,
            selectedCycleKey: null,
            selectedTovKey: null,
            metadata: {}
        });

        getConnectionStub = testEnv.sandbox.stub().returns(mockConnection);

        treeView = new TestElementsTreeView(testEnv.mockContext, getConnectionStub);

        mockVSCodeTreeView = {
            title: testElementsConfig.title,
            visible: true,
            onDidChangeVisibility: new vscode.EventEmitter<vscode.TreeViewVisibilityChangeEvent>().event,
            onDidChangeSelection: new vscode.EventEmitter<vscode.TreeViewSelectionChangeEvent<any>>().event,
            onDidExpandElement: new vscode.EventEmitter<vscode.TreeViewExpansionEvent<any>>().event,
            onDidCollapseElement: new vscode.EventEmitter<vscode.TreeViewExpansionEvent<any>>().event,
            reveal: testEnv.sandbox.stub().resolves(),
            dispose: testEnv.sandbox.stub()
        } as any;

        treeView.setTreeView(mockVSCodeTreeView);

        // Mocked dependencies
        (treeView as any).eventBus = mockEventBus;
        (treeView as any).stateManager = mockStateManager;
        (treeView as any).logger = mockLogger;
        (treeView as any).resourceFileService = mockResourceFileService;

        mockResourceFileService.constructAbsolutePath.resolves(undefined);
        mockResourceFileService.pathExists.resolves(false);
        mockResourceFileService.directoryExists.resolves(false);

        (treeView as any).registerEventHandlers();
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    test("should initialize with correct dependencies", function () {
        assert.ok(treeView, "TreeView should be created");
        assert.ok((treeView as any).eventBus, "EventBus should be initialized");
        assert.ok((treeView as any).stateManager, "StateManager should be initialized");
        assert.ok((treeView as any).resourceFileService, "ResourceFileService should be initialized");
    });

    test("should register event handlers on initialization", function () {
        const eventHandlerCalls = mockEventBus.on.getCalls();

        const eventTypes = eventHandlerCalls.map((call) => call.args[0]);

        const expectedEventTypes = [
            "testElements:fetched",
            "testElements:error",
            "tov:loaded",
            "connection:changed",
            "testElement:updated"
        ];

        for (const expectedType of expectedEventTypes) {
            if (expectedEventTypes.includes(expectedType)) {
                assert.ok(eventTypes.includes(expectedType), `Should handle ${expectedType}`);
            }
        }
    });

    suite("Resource File Operations", function () {
        test("openAvailableResource should create file when it doesn't exist", async function () {
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.pathExists.resolves(false);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/TestResource");
            mockResourceFileService.ensureFileExists.resolves();

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            const updateParentIconsStub = testEnv.sandbox.stub(treeView as any, "updateParentIcons").resolves();

            await treeView.openAvailableResource(mockItem);

            assert.strictEqual(mockItem.data.isLocallyAvailable, true);
            assert.strictEqual(mockItem.data.localPath, "/test/path/TestResource.resource");
            assert.ok(mockResourceFileService.ensureFileExists.called, "Should create file");
            assert.ok(updateParentIconsStub.called, "Should update parent icons");
        });

        test("openAvailableResource should open existing file without creating", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    name: "ExistingResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ExistingResource [Robot-Resource]"
                })
            );

            mockResourceFileService.pathExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ExistingResource.resource");

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await treeView.openAvailableResource(mockItem);

            assert.ok(mockResourceFileService.pathExists.called, "Should check if file exists");
            assert.ok(!mockResourceFileService.ensureFileExists.called, "Should not create file");
            assert.ok(
                testEnv.vscodeMocks.executeCommandStub.calledWith("revealInExplorer"),
                "Should call revealInExplorer command"
            );
        });

        test("openAvailableResource should handle missing hierarchical name", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    hierarchicalName: undefined
                })
            );

            await treeView.openAvailableResource(mockItem);

            assert.ok(!mockResourceFileService.pathExists.called, "Should not check file existence");
            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show an error message");
        });

        test("openAvailableResource should handle workspace path construction failure", async function () {
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.constructAbsolutePath.resolves(undefined);

            await treeView.openAvailableResource(mockItem);

            assert.ok(!mockResourceFileService.pathExists.called, "Should not check file existence");
            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show an error message");
        });

        test("createMissingResource should create file and open it", async function () {
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.constructAbsolutePath.resolves("/test/path/CreateResource.resource");
            mockResourceFileService.ensureFileExists.resolves();

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            const updateParentIconsStub = testEnv.sandbox.stub(treeView as any, "updateParentIcons").resolves();

            await treeView.createMissingResource(mockItem);

            assert.strictEqual(mockItem.data.isLocallyAvailable, true);
            assert.strictEqual(mockItem.data.localPath, "/test/path/CreateResource.resource");
            assert.ok(mockResourceFileService.ensureFileExists.called, "Should create file");
            assert.ok(updateParentIconsStub.called, "Should update parent icons");
            assert.ok(
                testEnv.vscodeMocks.executeCommandStub.calledWith("revealInExplorer"),
                "Should call revealInExplorer command"
            );
        });

        test("createMissingResource should handle file creation failure", async function () {
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.constructAbsolutePath.resolves("/test/path/CreateResource");
            mockResourceFileService.ensureFileExists.rejects(new Error("File system error"));

            await treeView.createMissingResource(mockItem);

            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show error message");
            assert.strictEqual(mockItem.data.isLocallyAvailable, false, "Should not update availability");
        });
    });

    suite("Folder Operations", function () {
        test("openFolderInExplorer should reveal existing folder", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestFolder",
                    hierarchicalName: "TestFolder",
                    isLocallyAvailable: true,
                    localPath: "/workspace/TestFolder"
                })
            );

            mockResourceFileService.pathExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/workspace/TestFolder");

            await treeView.openFolderInExplorer(mockItem);

            assert.ok(
                testEnv.vscodeMocks.executeCommandStub.calledWith("revealInExplorer"),
                "Should execute reveal command"
            );
        });

        test("openFolderInExplorer should create folder when it doesn't exist", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    name: "NewFolder",
                    hierarchicalName: "NewFolder"
                })
            );

            mockResourceFileService.pathExists.resolves(false);
            mockResourceFileService.constructAbsolutePath.resolves("/workspace/NewFolder");
            mockResourceFileService.ensureFolderPathExists.resolves();

            const updateParentIconsStub = testEnv.sandbox.stub(treeView as any, "updateParentIcons").resolves();

            await treeView.openFolderInExplorer(mockItem);

            assert.ok(mockResourceFileService.ensureFolderPathExists.called, "Should create folder");
            assert.ok(
                testEnv.vscodeMocks.executeCommandStub.calledWith("revealInExplorer"),
                "Should execute reveal command"
            );
            assert.ok(updateParentIconsStub.called, "Should update parent icons");
        });

        test("openFolderInExplorer should handle folder creation failure", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestFolder",
                    hierarchicalName: "TestFolder" // No resource marker, this is a folder
                })
            );

            mockResourceFileService.pathExists.resolves(false);
            mockResourceFileService.constructAbsolutePath.resolves("/workspace/NewFolder");
            mockResourceFileService.ensureFolderPathExists.rejects(new Error("Permission denied"));

            await treeView.openFolderInExplorer(mockItem);

            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show error message");
        });
    });
    suite("Keyword Resource Operations", function () {
        test("goToKeywordResource should create parent resource when missing", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]"
                })
            );

            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestKeyword",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestKeyword",
                    testElementType: TestElementType.Keyword
                }),
                mockParent
            );

            mockResourceFileService.pathExists.resolves(false);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ParentResource.resource");
            mockResourceFileService.ensureFileExists.resolves();

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            const updateParentIconsStub = testEnv.sandbox.stub(treeView as any, "updateParentIcons").resolves();

            await treeView.goToKeywordResource(mockKeyword);

            assert.strictEqual(mockParent.data.isLocallyAvailable, true);
            assert.strictEqual(mockParent.data.localPath, "/test/path/ParentResource.resource");
            assert.ok(mockResourceFileService.ensureFileExists.called, "Should create parent resource");
            assert.ok(updateParentIconsStub.called, "Should update parent icons");
        });

        test("goToKeywordResource should open existing parent resource", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ExistingParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ExistingParentResource [Robot-Resource]",
                    isLocallyAvailable: true,
                    localPath: "/test/path/ExistingParentResource.resource"
                })
            );

            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "ExistingKeyword",
                    hierarchicalName: "TestFolder/ExistingParentResource [Robot-Resource]/ExistingKeyword",
                    testElementType: TestElementType.Keyword
                }),
                mockParent
            );

            mockResourceFileService.pathExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ExistingParentResource.resource");

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await treeView.goToKeywordResource(mockKeyword);

            assert.ok(mockResourceFileService.pathExists.called, "Should check if parent resource exists");
            assert.ok(!mockResourceFileService.ensureFileExists.called, "Should not create parent resource");
        });

        test("goToKeywordResource should handle missing parent", async function () {
            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestKeyword",
                    hierarchicalName: "TestFolder/TestKeyword",
                    testElementType: TestElementType.Keyword
                })
            );

            await treeView.goToKeywordResource(mockKeyword);

            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show error message for missing parent");
        });

        test("goToKeywordResource should reveal file in explorer after opening", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]"
                })
            );

            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestKeyword",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestKeyword",
                    testElementType: TestElementType.Keyword
                }),
                mockParent
            );

            mockResourceFileService.pathExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ParentResource.resource");

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await treeView.goToKeywordResource(mockKeyword);

            assert.ok(
                testEnv.vscodeMocks.executeCommandStub.calledWith("revealInExplorer"),
                "Should call revealInExplorer command"
            );
        });
    });

    suite("Keyword Click Handlers", function () {
        test("handleKeywordClick should handle keyword clicks via click handler", async function () {
            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestKeyword",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestKeyword",
                    testElementType: TestElementType.Keyword
                })
            );

            const handleClickStub = testEnv.sandbox
                .stub((treeView as any).keywordClickHandler, "handleClick")
                .resolves();

            await treeView.handleKeywordClick(mockKeyword);

            assert.ok(handleClickStub.calledWith(mockKeyword, mockKeyword.id, mockLogger), "Should call click handler");
        });

        test("handleKeywordSingleClick should not create file if it does not exist", async function () {
            const mockParent = createMockTestElementItem(createMockTestElementData());
            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({ testElementType: TestElementType.Keyword }),
                mockParent
            );

            mockResourceFileService.constructAbsolutePath.resolves("/test/path/resource.resource");
            mockResourceFileService.pathExists.resolves(false);

            await (treeView as any).handleKeywordSingleClick(mockKeyword);

            assert.ok(!mockResourceFileService.ensureFileExists.called, "Should not create file on single click");
            assert.ok(testEnv.vscodeMocks.showInformationMessageStub.called, "Should show info message");
            assert.ok(
                testEnv.vscodeMocks.showInformationMessageStub.calledWithMatch("Resource file does not exist inside"),
                "Should include resource directory information in info message"
            );
        });

        test("handleKeywordDoubleClick should create file and reveal in explorer", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]"
                })
            );

            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestKeyword",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestKeyword",
                    testElementType: TestElementType.Keyword
                }),
                mockParent
            );

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;

            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ParentResource.resource");
            mockResourceFileService.pathExists.resolves(false);
            mockResourceFileService.ensureFileExists.resolves();
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            const showTextDocumentStub = testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await (treeView as any).handleKeywordDoubleClick(mockKeyword);

            assert.ok(mockResourceFileService.ensureFileExists.called, "Should create file if it doesn't exist");
            assert.ok(showTextDocumentStub.called, "Should open file in editor");
            assert.ok(
                testEnv.vscodeMocks.executeCommandStub.calledWith("revealInExplorer"),
                "Should reveal file in explorer"
            );
        });
    });

    suite("Parent Icon Updates", function () {
        test("updateParentIcons should update parent folder icons when resource file is created", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestFolder",
                    hierarchicalName: "TestFolder"
                })
            );

            const mockChild = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/TestResource [Robot-Resource]"
                }),
                mockParent
            );

            mockResourceFileService.directoryExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/TestFolder");

            const result = await (treeView as any).updateParentIcons(mockChild);

            assert.strictEqual(result, true, "updateParentIcons should return true");
            assert.strictEqual(mockParent.data.isLocallyAvailable, true);
            assert.strictEqual(mockParent.data.localPath, "/test/path/TestFolder");
        });
    });
});
