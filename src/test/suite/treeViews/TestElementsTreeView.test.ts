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
import { ErrorHandler } from "../../../treeViews/utils/ErrorHandler";
import { ResourceFileService } from "../../../treeViews/implementations/testElements/ResourceFileService";
import { testElementsConfig } from "../../../treeViews/implementations/testElements/TestElementsConfig";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";

suite("TestElementsTreeView", function () {
    let testEnv: TestEnvironment;
    let treeView: TestElementsTreeView;
    let mockConnection: sinon.SinonStubbedInstance<PlayServerConnection>;
    let mockLogger: sinon.SinonStubbedInstance<TestBenchLogger>;
    let mockErrorHandler: sinon.SinonStubbedInstance<ErrorHandler>;
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
        mockErrorHandler = testEnv.sandbox.createStubInstance(ErrorHandler);
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
        (treeView as any).errorHandler = mockErrorHandler;
        (treeView as any).resourceFileService = mockResourceFileService;

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
            "cycle:selected",
            "tov:loaded",
            "connection:changed",
            "testElement:updated"
        ];

        for (const expectedType of expectedEventTypes) {
            assert.ok(eventTypes.includes(expectedType), `Should handle ${expectedType}`);
        }
    });

    suite("Resource File Operations", function () {
        test("openAvailableResource should create file when it doesn't exist", async function () {
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.fileExists.resolves(false);
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

            mockResourceFileService.fileExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ExistingResource");

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await treeView.openAvailableResource(mockItem);

            assert.ok(mockResourceFileService.fileExists.called, "Should check if file exists");
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

            assert.ok(!mockResourceFileService.fileExists.called, "Should not check file existence");
        });

        test("openAvailableResource should handle workspace path construction failure", async function () {
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.constructAbsolutePath.resolves(undefined);

            await treeView.openAvailableResource(mockItem);

            assert.ok(!mockResourceFileService.fileExists.called, "Should not check file existence");
        });

        test("createMissingResource should create file and open it", async function () {
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.constructAbsolutePath.resolves("/test/path/CreateResource");
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

            mockResourceFileService.directoryExists.resolves(true);
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

            mockResourceFileService.directoryExists.resolves(false);
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
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.directoryExists.resolves(false);
            mockResourceFileService.constructAbsolutePath.resolves("/workspace/NewFolder");
            mockResourceFileService.ensureFolderPathExists.rejects(new Error("Permission denied"));

            await treeView.openFolderInExplorer(mockItem);

            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show error message");
        });
    });
    suite("Interaction Resource Operations", function () {
        test("goToInteractionResource should create parent resource when missing", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]"
                })
            );

            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction
                }),
                mockParent
            );

            mockResourceFileService.fileExists.resolves(false);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ParentResource");
            mockResourceFileService.ensureFileExists.resolves();

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            const updateParentIconsStub = testEnv.sandbox.stub(treeView as any, "updateParentIcons").resolves();

            await treeView.goToInteractionResource(mockInteraction);

            assert.strictEqual(mockParent.data.isLocallyAvailable, true);
            assert.strictEqual(mockParent.data.localPath, "/test/path/ParentResource.resource");
            assert.ok(mockResourceFileService.ensureFileExists.called, "Should create parent resource");
            assert.ok(updateParentIconsStub.called, "Should update parent icons");
        });

        test("goToInteractionResource should open existing parent resource", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ExistingParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ExistingParentResource [Robot-Resource]",
                    isLocallyAvailable: true,
                    localPath: "/test/path/ExistingParentResource.resource"
                })
            );

            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "ExistingInteraction",
                    hierarchicalName: "TestFolder/ExistingParentResource [Robot-Resource]/ExistingInteraction",
                    testElementType: TestElementType.Interaction
                }),
                mockParent
            );

            mockResourceFileService.fileExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ExistingParentResource");

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await treeView.goToInteractionResource(mockInteraction);

            assert.ok(mockResourceFileService.fileExists.called, "Should check if parent resource exists");
            assert.ok(!mockResourceFileService.ensureFileExists.called, "Should not create parent resource");
        });

        test("goToInteractionResource should handle missing parent", async function () {
            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/TestInteraction",
                    testElementType: TestElementType.Interaction
                })
            );

            await treeView.goToInteractionResource(mockInteraction);

            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show error message for missing parent");
        });

        test("goToInteractionResource should reveal file in explorer after opening", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]"
                })
            );

            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction
                }),
                mockParent
            );

            mockResourceFileService.fileExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ParentResource");

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await treeView.goToInteractionResource(mockInteraction);

            assert.ok(
                testEnv.vscodeMocks.executeCommandStub.calledWith("revealInExplorer"),
                "Should call revealInExplorer command"
            );
        });

        test("openInteractionResource should open parent resource", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]"
                })
            );

            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction
                }),
                mockParent
            );

            mockResourceFileService.fileExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ParentResource");

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await treeView.openInteractionResource(mockInteraction);

            assert.ok(mockResourceFileService.fileExists.called, "Should check if parent resource exists");
        });

        test("openInteractionResource should create parent resource when missing", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]"
                })
            );

            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction
                }),
                mockParent
            );

            mockResourceFileService.fileExists.resolves(false);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ParentResource");
            mockResourceFileService.ensureFileExists.resolves();

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            const updateParentIconsStub = testEnv.sandbox.stub(treeView as any, "updateParentIcons").resolves();

            await treeView.openInteractionResource(mockInteraction);

            assert.strictEqual(mockParent.data.isLocallyAvailable, true);
            assert.strictEqual(mockParent.data.localPath, "/test/path/ParentResource.resource");
            assert.ok(mockResourceFileService.ensureFileExists.called, "Should create parent resource");
            assert.ok(updateParentIconsStub.called, "Should update parent icons");
        });

        test("openInteractionResource should handle missing parent", async function () {
            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/TestInteraction",
                    testElementType: TestElementType.Interaction
                })
            );

            await treeView.openInteractionResource(mockInteraction);

            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show error message for missing parent");
        });

        test("openInteractionResource should handle file opening errors", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]"
                })
            );

            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction
                }),
                mockParent
            );

            mockResourceFileService.fileExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ParentResource");
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").rejects(new Error("File not found"));

            await treeView.openInteractionResource(mockInteraction);

            assert.ok(
                testEnv.vscodeMocks.showErrorMessageStub.called,
                "Should show error message for file opening failure"
            );
        });
    });

    suite("Interaction Click Handlers", function () {
        test("handleInteractionSingleClick should call openInteractionResource", async function () {
            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction
                })
            );

            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]"
                })
            );
            mockInteraction.parent = mockParent;

            mockResourceFileService.fileExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ParentResource");

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await (treeView as any).handleInteractionSingleClick(mockInteraction);

            assert.ok(
                mockLogger.debug.calledWith("Interaction item single clicked: TestInteraction"),
                "Should log single click"
            );
        });

        test("handleInteractionDoubleClick should call goToInteractionResource", async function () {
            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction
                })
            );

            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]"
                })
            );
            mockInteraction.parent = mockParent;

            mockResourceFileService.fileExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ParentResource");

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await (treeView as any).handleInteractionDoubleClick(mockInteraction);

            assert.ok(
                mockLogger.debug.calledWith("Interaction item double clicked: TestInteraction"),
                "Should log double click"
            );
        });

        test("handleInteractionClick should handle interaction clicks via click handler", async function () {
            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction
                })
            );

            const handleClickStub = testEnv.sandbox
                .stub((treeView as any).interactionClickHandler, "handleClick")
                .resolves();

            await treeView.handleInteractionClick(mockInteraction);

            assert.ok(
                handleClickStub.calledWith(mockInteraction, mockInteraction.id, mockLogger),
                "Should call click handler"
            );
        });

        test("handleInteractionClick should handle items without ID", async function () {
            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction
                })
            );

            (mockInteraction as any).id = undefined;

            const handleClickStub = testEnv.sandbox
                .stub((treeView as any).interactionClickHandler, "handleClick")
                .resolves();

            await treeView.handleInteractionClick(mockInteraction);
            assert.ok(!handleClickStub.called, "Should not call click handler when item has no ID");
        });

        test("both single and double click should jump to interaction", async function () {
            const mockInteraction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction
                })
            );

            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]"
                })
            );
            mockInteraction.parent = mockParent;

            mockResourceFileService.fileExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/ParentResource");

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await (treeView as any).handleInteractionSingleClick(mockInteraction);
            assert.ok(
                mockLogger.debug.calledWith("Interaction item single clicked: TestInteraction"),
                "Should log single click"
            );

            await (treeView as any).handleInteractionDoubleClick(mockInteraction);
            assert.ok(
                mockLogger.debug.calledWith("Interaction item double clicked: TestInteraction"),
                "Should log double click"
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

            await (treeView as any).updateParentIcons(mockChild);

            assert.strictEqual(mockParent.data.isLocallyAvailable, true);
            assert.strictEqual(mockParent.data.localPath, "/test/path/TestFolder");
        });

        test("updateParentIcons should handle missing parent directory", async function () {
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

            mockResourceFileService.directoryExists.resolves(false);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/TestFolder");

            await (treeView as any).updateParentIcons(mockChild);

            assert.strictEqual(mockParent.data.isLocallyAvailable, false, "Should not update availability");
        });
    });

    suite("Error Handling", function () {
        test("should handle file opening errors gracefully", async function () {
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.fileExists.resolves(true);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/TestResource");

            const mockError = new Error("File not found");
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").rejects(mockError);

            await treeView.openAvailableResource(mockItem);

            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show error message");
            assert.ok(mockLogger.error.called, "Should log error");
        });

        test("should handle resource file service errors", async function () {
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.fileExists.rejects(new Error("File system error"));

            await treeView.openAvailableResource(mockItem);

            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show error message");
        });

        test("should handle missing UID in resource creation", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    uniqueID: undefined
                })
            );

            mockResourceFileService.constructAbsolutePath.resolves("/test/path/TestResource");

            await treeView.createMissingResource(mockItem);

            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show error message for missing UID");
        });
    });

    suite("Event Handling", function () {
        test("should handle testElements:fetched event", function () {
            const eventData = { tovKey: "test-tov", count: 5 };

            (treeView as any).currentTovKey = "test-tov";

            const eventHandlerCalls = mockEventBus.on.getCalls();
            const fetchedHandlerCall = eventHandlerCalls.find((call) => call.args[0] === "testElements:fetched");

            if (fetchedHandlerCall) {
                const handler = fetchedHandlerCall.args[1];
                handler({
                    type: "testElements:fetched",
                    source: "testElements",
                    data: eventData,
                    timestamp: Date.now()
                });
            }

            assert.ok(mockLogger.debug.called, "Should log debug message");
        });

        test("should handle testElements:error event", function () {
            const eventData = { tovKey: "test-tov", error: "Network error" };

            (treeView as any).currentTovKey = "test-tov";

            const eventHandlerCalls = mockEventBus.on.getCalls();
            const errorHandlerCall = eventHandlerCalls.find((call) => call.args[0] === "testElements:error");

            if (errorHandlerCall) {
                const handler = errorHandlerCall.args[1];
                handler({
                    type: "testElements:error",
                    source: "testElements",
                    data: eventData,
                    timestamp: Date.now()
                });
            }

            assert.ok(mockLogger.error.called, "Should log error");
            assert.ok(mockErrorHandler.handleVoid.called, "Should handle error");
        });

        test("should handle connection:changed event", function () {
            const connectedEvent = {
                type: "connection:changed",
                source: "connection",
                data: { connected: true },
                timestamp: Date.now()
            };
            const disconnectedEvent = {
                type: "connection:changed",
                source: "connection",
                data: { connected: false },
                timestamp: Date.now()
            };

            (treeView as any).currentTovKey = "test-tov";

            const eventHandlerCalls = mockEventBus.on.getCalls();
            const connectionHandlerCall = eventHandlerCalls.find((call) => call.args[0] === "connection:changed");

            if (connectionHandlerCall) {
                const handler = connectionHandlerCall.args[1];
                handler(connectedEvent);
                handler(disconnectedEvent);
            }

            assert.ok(mockLogger.debug.called, "Should log debug messages");
        });
    });

    suite("Utility Methods", function () {
        test("getCurrentTovKey should return current TOV key", function () {
            (treeView as any).currentTovKey = "test-tov-key";

            const result = treeView.getCurrentTovKey();

            assert.strictEqual(result, "test-tov-key");
        });

        test("getCurrentTovKey should return null when no TOV is loaded", function () {
            (treeView as any).currentTovKey = null;

            const result = treeView.getCurrentTovKey();

            assert.strictEqual(result, null);
        });

        test("clearTree should reset state", function () {
            (treeView as any).currentTovKey = "test-tov";
            (treeView as any).currentTovLabel = "Test TOV";
            (treeView as any).resourceFiles.set("test", []);

            treeView.clearTree();

            assert.strictEqual((treeView as any).currentTovKey, null);
            assert.strictEqual((treeView as any).currentTovLabel, null);
            assert.strictEqual((treeView as any).resourceFiles.size, 0);
        });
    });

    suite("Integration Scenarios", function () {
        test("should handle complete resource creation workflow", async function () {
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.fileExists.resolves(false);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/TestResource");
            mockResourceFileService.ensureFileExists.resolves();

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            const updateParentIconsStub = testEnv.sandbox.stub(treeView as any, "updateParentIcons").resolves();
            const refreshItemStub = testEnv.sandbox.stub(treeView as any, "refreshItemWithParents");

            await treeView.openAvailableResource(mockItem);

            assert.strictEqual(mockItem.data.isLocallyAvailable, true);
            assert.strictEqual(mockItem.data.localPath, "/test/path/TestResource.resource");
            assert.ok(mockResourceFileService.ensureFileExists.called, "Should create file");
            assert.ok(updateParentIconsStub.called, "Should update parent icons");
            assert.ok(refreshItemStub.called, "Should refresh item");
        });

        test("should handle error recovery in resource operations", async function () {
            const mockItem = createMockTestElementItem(createMockTestElementData());

            mockResourceFileService.fileExists.onFirstCall().rejects(new Error("Network error"));
            mockResourceFileService.fileExists.onSecondCall().resolves(false);
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/TestResource");
            mockResourceFileService.ensureFileExists.resolves();

            const mockDocument = {} as vscode.TextDocument;
            const mockEditor = {} as vscode.TextEditor;
            testEnv.sandbox.stub(vscode.workspace, "openTextDocument").resolves(mockDocument);
            testEnv.sandbox.stub(vscode.window, "showTextDocument").resolves(mockEditor);

            await treeView.openAvailableResource(mockItem);

            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show error message on failure");
        });
    });

    suite("Title Update Functionality", function () {
        test("should update title correctly opening test elements view from TOV", async function () {
            const tovKey = "tov-456";
            const tovLabel = "Test TOV Label";
            const projectName = "Test Project";
            const tovName = "Test TOV";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchTestElements: testEnv.sandbox.stub().resolves([])
            };
            (treeView as any).dataProvider = mockDataProvider;

            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadTov(tovKey, tovLabel, projectName, tovName);

            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Elements (Test Project, Test TOV)",
                "Title should be formatted correctly with all parameters"
            );
        });

        test("should update title correctly when opening test elements view from TOV with missing project name", async function () {
            const tovKey = "tov-456";
            const tovLabel = "Test TOV Label";
            const projectName = "";
            const tovName = "Test TOV";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchTestElements: testEnv.sandbox.stub().resolves([])
            };
            (treeView as any).dataProvider = mockDataProvider;

            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadTov(tovKey, tovLabel, projectName, tovName);

            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Elements (Test TOV)",
                "Title should be formatted correctly with only TOV name"
            );
        });

        test("should update title correctly when opening test elements view from TOV with missing TOV name", async function () {
            const tovKey = "tov-456";
            const tovLabel = "Test TOV Label";
            const projectName = "Test Project";
            const tovName = "";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchTestElements: testEnv.sandbox.stub().resolves([])
            };
            (treeView as any).dataProvider = mockDataProvider;

            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadTov(tovKey, tovLabel, projectName, tovName);

            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Elements (Test Project)",
                "Title should be formatted correctly with only project name"
            );
        });

        test("should update title correctly when opening test elements view from TOV with null as parameters", async function () {
            const tovKey = "tov-456";
            const tovLabel = "Test TOV Label";
            const projectName = null as any;
            const tovName = null as any;

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchTestElements: testEnv.sandbox.stub().resolves([])
            };
            (treeView as any).dataProvider = mockDataProvider;

            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadTov(tovKey, tovLabel, projectName, tovName);

            assert.strictEqual(
                mockVSCodeTreeView.title,
                "Test Elements",
                "Title should fall back to base title when parameters are null"
            );
        });

        test("should reset title to default when clearing tree", function () {
            treeView.updateTitle("Custom Title");
            assert.strictEqual(mockVSCodeTreeView.title, "Custom Title");

            treeView.clearTree();

            assert.strictEqual(
                mockVSCodeTreeView.title,
                testElementsConfig.title,
                "Title should be reset to default when clearing tree"
            );
        });
    });

    suite("State Management", function () {
        test("should set correct state when loading TOV", async function () {
            const tovKey = "tov-456";
            const tovLabel = "Test TOV Label";
            const projectName = "Test Project";
            const tovName = "Test TOV";

            const mockDataProvider = {
                clearCache: testEnv.sandbox.stub(),
                fetchTestElements: testEnv.sandbox.stub().resolves([])
            };
            (treeView as any).dataProvider = mockDataProvider;

            const mockFire = testEnv.sandbox.stub();
            (treeView as any)._onDidChangeTreeData = { fire: mockFire };
            (treeView as any).updateTreeViewMessage = testEnv.sandbox.stub();

            await treeView.loadTov(tovKey, tovLabel, projectName, tovName);

            assert.strictEqual(treeView.getCurrentTovKey(), tovKey);
            assert.strictEqual((treeView as any).currentTovLabel, tovLabel);
            assert.strictEqual((treeView as any).currentProjectName, projectName);
            assert.strictEqual((treeView as any).currentTovName, tovName);
        });

        test("should clear state when clearing tree", function () {
            (treeView as any).currentTovKey = "test-tov";
            (treeView as any).currentTovLabel = "Test TOV";
            (treeView as any).currentProjectName = "Test Project";
            (treeView as any).currentTovName = "Test TOV";
            (treeView as any).resourceFiles.set("test", []);

            treeView.clearTree();

            assert.strictEqual((treeView as any).currentTovKey, null);
            assert.strictEqual((treeView as any).currentTovLabel, null);
            assert.strictEqual((treeView as any).currentProjectName, null);
            assert.strictEqual((treeView as any).currentTovName, null);
            assert.strictEqual((treeView as any).resourceFiles.size, 0);
        });
    });
});
