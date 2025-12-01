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
import { UserSessionManager } from "../../../userSessionManager";
import * as extension from "../../../extension";
import * as configuration from "../../../configuration";

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
    let userSessionManager: UserSessionManager;

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
        mockResourceFileService.validateResourceFileUid.resolves({
            isValid: false,
            fileExists: false,
            isMismatch: false
        });
        mockResourceFileService.readUidFromResourceFile.resolves(undefined);
        mockResourceFileService.constructAlternativePathWithUid.returns("/test/path/Resource_uid.resource");

        // Setup userSessionManager mock
        userSessionManager = new UserSessionManager(testEnv.mockContext);
        testEnv.sandbox.stub(userSessionManager, "getCurrentUserId").returns("test-user-id");
        testEnv.sandbox.stub(userSessionManager, "hasValidUserSession").returns(true);
        (extension as any).userSessionManager = userSessionManager;

        // Mock workspaceState for alternative paths persistence
        testEnv.mockContext.workspaceState.get = testEnv.sandbox.stub().returns(undefined);
        testEnv.mockContext.workspaceState.update = testEnv.sandbox.stub().resolves();

        // Mock configuration for ResourceFileService.hasResourceMarker static method
        testEnv.sandbox.stub(configuration, "getExtensionSetting").callsFake((key: string) => {
            if (key === "resourceMarker" || key.includes("resourceMarker")) {
                return ["[Robot-Resource]"];
            }
            return undefined;
        });

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

    suite("Name Conflict Detection", function () {
        test("validateAndHandleUidConflict should return alternative path when conflict detected and user chooses to create with UID", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    uniqueID: "test-uid-123",
                    hierarchicalName: "TestFolder/TestResource [Robot-Resource]"
                })
            );

            // File exists with different UID
            mockResourceFileService.pathExists.resolves(true);
            mockResourceFileService.validateResourceFileUid.resolves({
                isValid: false,
                fileExists: true,
                isMismatch: true,
                fileUid: "different-uid-456"
            });
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/TestResource.resource");
            mockResourceFileService.constructAlternativePathWithUid.returns(
                "/test/path/TestResource_test-uid-123.resource"
            );

            // User chooses "Create with UID in Filename"
            testEnv.vscodeMocks.showWarningMessageStub.resolves("Create with UID in Filename");

            const result = await (treeView as any).validateAndHandleUidConflict(
                "/test/path/TestResource.resource",
                mockItem
            );

            assert.strictEqual(result.canProceed, true, "Should allow proceeding");
            assert.strictEqual(
                result.resolvedPath,
                "/test/path/TestResource_test-uid-123.resource",
                "Should return alternative path with UID"
            );
            // Verify alternative path was stored
            const alternativePaths = (treeView as any).alternativeResourcePaths;
            assert.strictEqual(alternativePaths.get("test-uid-123"), "/test/path/TestResource_test-uid-123.resource");
        });

        test("validateAndHandleUidConflict should proceed when user chooses to open existing file", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    uniqueID: "test-uid-123"
                })
            );

            mockResourceFileService.pathExists.resolves(true);
            mockResourceFileService.validateResourceFileUid.resolves({
                isValid: false,
                fileExists: true,
                isMismatch: true,
                fileUid: "different-uid-456"
            });

            // User chooses "Open Existing File"
            testEnv.vscodeMocks.showWarningMessageStub.resolves("Open Existing File");

            const result = await (treeView as any).validateAndHandleUidConflict(
                "/test/path/TestResource.resource",
                mockItem
            );

            assert.strictEqual(result.canProceed, true, "Should allow proceeding to open existing file");
            assert.strictEqual(result.resolvedPath, undefined, "Should not return alternative path");
        });

        test("validateAndHandleUidConflict should use existing alternative path if available", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    uniqueID: "test-uid-123",
                    hierarchicalName: "TestFolder/TestResource [Robot-Resource]"
                })
            );

            // Set alternative path in the map
            (treeView as any).alternativeResourcePaths.set(
                "test-uid-123",
                "/test/path/TestResource_test-uid-123.resource"
            );

            mockResourceFileService.pathExists.resolves(true);
            mockResourceFileService.validateResourceFileUid.resolves({
                isValid: true,
                fileExists: true,
                isMismatch: false,
                fileUid: "test-uid-123"
            });

            const result = await (treeView as any).validateAndHandleUidConflict(
                "/test/path/TestResource.resource",
                mockItem
            );

            assert.strictEqual(result.canProceed, true, "Should allow proceeding");
            assert.strictEqual(
                result.resolvedPath,
                "/test/path/TestResource_test-uid-123.resource",
                "Should return existing alternative path"
            );
        });

        test("validateAndHandleUidConflict should proceed when file has matching UID", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    uniqueID: "test-uid-123"
                })
            );

            mockResourceFileService.pathExists.resolves(true);
            mockResourceFileService.validateResourceFileUid.resolves({
                isValid: true,
                fileExists: true,
                isMismatch: false,
                fileUid: "test-uid-123"
            });

            const result = await (treeView as any).validateAndHandleUidConflict(
                "/test/path/TestResource.resource",
                mockItem
            );

            assert.strictEqual(result.canProceed, true, "Should allow proceeding");
            assert.strictEqual(result.resolvedPath, undefined, "Should not return alternative path when UID matches");
        });

        test("validateAndHandleUidConflict should handle file without UID metadata", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    uniqueID: "test-uid-123"
                })
            );

            mockResourceFileService.pathExists.resolves(true);
            mockResourceFileService.validateResourceFileUid.resolves({
                isValid: false,
                fileExists: true,
                isMismatch: false,
                fileUid: undefined
            });

            // User chooses to overwrite metadata
            testEnv.vscodeMocks.showWarningMessageStub.resolves("Overwrite with New Metadata");

            // Mock vscode.workspace.fs as an object
            const mockWorkspaceFs = {
                readFile: testEnv.sandbox.stub().resolves(new Uint8Array(Buffer.from("*** Settings ***\n", "utf-8"))),
                writeFile: testEnv.sandbox.stub().resolves()
            };
            testEnv.sandbox.stub(vscode.workspace, "fs").value(mockWorkspaceFs);

            const result = await (treeView as any).validateAndHandleUidConflict(
                "/test/path/TestResource.resource",
                mockItem
            );

            assert.strictEqual(result.canProceed, true, "Should allow proceeding after metadata update");
        });

        test("validateAndHandleUidConflict should cancel when user cancels conflict resolution", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    uniqueID: "test-uid-123"
                })
            );

            mockResourceFileService.pathExists.resolves(true);
            mockResourceFileService.validateResourceFileUid.resolves({
                isValid: false,
                fileExists: true,
                isMismatch: true,
                fileUid: "different-uid-456"
            });

            // User cancels
            testEnv.vscodeMocks.showWarningMessageStub.resolves(undefined);

            const result = await (treeView as any).validateAndHandleUidConflict(
                "/test/path/TestResource.resource",
                mockItem
            );

            assert.strictEqual(result.canProceed, false, "Should not proceed when user cancels");
        });

        test("validateAndHandleUidConflict should handle item without UID", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    uniqueID: undefined
                })
            );

            const result = await (treeView as any).validateAndHandleUidConflict(
                "/test/path/TestResource.resource",
                mockItem
            );

            assert.strictEqual(result.canProceed, true, "Should allow proceeding when no UID present");
        });

        test("detectNameConflict should identify when multiple subdivisions map to same path", async function () {
            const mockItem1 = createMockTestElementItem(
                createMockTestElementData({
                    uniqueID: "uid-1",
                    hierarchicalName: "Folder/Resource [Robot-Resource]",
                    displayName: "Resource [Robot-Resource]",
                    testElementType: TestElementType.Subdivision
                })
            );

            const mockItem2 = createMockTestElementItem(
                createMockTestElementData({
                    uniqueID: "uid-2",
                    hierarchicalName: "Folder/Resource [Robot-Resource]",
                    displayName: "Resource [Robot-Resource]",
                    testElementType: TestElementType.Subdivision
                })
            );

            (treeView as any).rootItems = [mockItem1, mockItem2];

            // Mock constructAbsolutePath to return the same path for both items
            // The method removes resource markers from hierarchicalName before calling constructAbsolutePath
            // "Folder/Resource [Robot-Resource]" becomes "Folder/Resource"
            mockResourceFileService.constructAbsolutePath.callsFake(async (name: string) => {
                const trimmedName = name.trim();
                if (trimmedName === "Folder/Resource" || trimmedName.includes("Folder/Resource")) {
                    return "/test/path/Resource";
                }
                return undefined;
            });

            const result = await (treeView as any).detectNameConflict("/test/path/Resource.resource", "uid-1");

            assert.strictEqual(result, true, "Should detect name conflict when multiple subdivisions map to same path");
        });

        test("detectNameConflict should return false when no conflict exists", async function () {
            const mockItem = createMockTestElementItem(
                createMockTestElementData({
                    uniqueID: "uid-1",
                    hierarchicalName: "Folder/Resource1 [Robot-Resource]"
                })
            );

            (treeView as any).rootItems = [mockItem];
            mockResourceFileService.constructAbsolutePath.resolves("/test/path/Resource1.resource");

            const result = await (treeView as any).detectNameConflict("/test/path/Resource2.resource", "uid-1");

            assert.strictEqual(result, false, "Should not detect conflict when paths differ");
        });

        test("loadAlternativeResourcePaths should load and validate persisted paths", async function () {
            const storedPaths: Array<[string, string]> = [
                ["uid-1", "/test/path/Resource1_uid-1.resource"],
                ["uid-2", "/test/path/Resource2_uid-2.resource"]
            ];

            testEnv.mockContext.workspaceState.get = testEnv.sandbox.stub().returns(storedPaths);
            mockResourceFileService.pathExists.resolves(true);
            mockResourceFileService.validateResourceFileUid.callsFake(async (path: string, uid: string) => {
                const expectedUid = storedPaths.find(([u]) => path.includes(u))?.[0];
                return {
                    isValid: expectedUid === uid,
                    fileExists: true,
                    isMismatch: expectedUid !== uid,
                    fileUid: expectedUid
                };
            });

            await (treeView as any).loadAlternativeResourcePaths();

            const alternativePaths = (treeView as any).alternativeResourcePaths;
            assert.strictEqual(alternativePaths.size, 2, "Should load all valid alternative paths");
            assert.strictEqual(alternativePaths.get("uid-1"), "/test/path/Resource1_uid-1.resource");
            assert.strictEqual(alternativePaths.get("uid-2"), "/test/path/Resource2_uid-2.resource");
        });

        test("loadAlternativeResourcePaths should filter out invalid paths", async function () {
            const storedPaths: Array<[string, string]> = [
                ["uid-1", "/test/path/Resource1_uid-1.resource"], // Valid
                ["uid-2", "/test/path/Resource2_uid-2.resource"] // File doesn't exist
            ];

            testEnv.mockContext.workspaceState.get = testEnv.sandbox.stub().returns(storedPaths);
            mockResourceFileService.pathExists.callsFake(async (path: string) => {
                return path.includes("Resource1");
            });
            mockResourceFileService.validateResourceFileUid.resolves({
                isValid: true,
                fileExists: true,
                isMismatch: false,
                fileUid: "uid-1"
            });

            await (treeView as any).loadAlternativeResourcePaths();

            const alternativePaths = (treeView as any).alternativeResourcePaths;
            assert.strictEqual(alternativePaths.size, 1, "Should only load valid paths");
            assert.strictEqual(alternativePaths.get("uid-1"), "/test/path/Resource1_uid-1.resource");
            assert.strictEqual(alternativePaths.get("uid-2"), undefined, "Should not load non-existent paths");
        });

        test("saveAlternativeResourcePaths should save paths to workspace storage", async function () {
            (treeView as any).alternativeResourcePaths.set("uid-1", "/test/path/Resource1_uid-1.resource");
            (treeView as any).alternativeResourcePaths.set("uid-2", "/test/path/Resource2_uid-2.resource");

            await (treeView as any).saveAlternativeResourcePaths();

            const updateCall = testEnv.mockContext.workspaceState.update as sinon.SinonStub;
            assert.ok(updateCall.called, "Should call workspaceState.update");
            const [storageKey, data] = updateCall.firstCall.args;
            assert.ok(storageKey.includes("alternativeResourcePaths"), "Should use correct storage key");
            assert.ok(Array.isArray(data), "Should save as array");
            assert.strictEqual(data.length, 2, "Should save all alternative paths");
        });

        test("saveAlternativeResourcePaths should not save when no user session", async function () {
            (userSessionManager.hasValidUserSession as sinon.SinonStub).returns(false);
            (treeView as any).alternativeResourcePaths.set("uid-1", "/test/path/Resource1_uid-1.resource");

            await (treeView as any).saveAlternativeResourcePaths();

            const updateCall = testEnv.mockContext.workspaceState.update as sinon.SinonStub;
            assert.ok(!updateCall.called, "Should not save when no valid user session");

            // Restore the original return value for other tests
            (userSessionManager.hasValidUserSession as sinon.SinonStub).returns(true);
        });
    });
});
