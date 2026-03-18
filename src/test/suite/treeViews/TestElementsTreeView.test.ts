/**
 * @file src/test/suite/treeViews/TestElementsTreeView.test.ts
 * @description Tests for TestElementsTreeView functionality
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { TestElementsTreeView } from "../../../treeViews/implementations/testElements/TestElementsTreeView";
import {
    TestElementData,
    TestElementsTreeItem,
    TestElementType
} from "../../../treeViews/implementations/testElements/TestElementsTreeItem";
import { PlayServerConnection, PlayServerHttpError } from "../../../testBenchConnection";
import { TestBenchLogger } from "../../../testBenchLogger";
import { EventBus } from "../../../treeViews/utils/EventBus";
import { StateManager } from "../../../treeViews/state/StateManager";
import { ResourceFileService } from "../../../treeViews/implementations/testElements/ResourceFileService";
import { testElementsConfig } from "../../../treeViews/implementations/testElements/TestElementsConfig";
import { getExtensionSetting } from "../../../configuration";
import { ConfigKeys } from "../../../constants";
import * as languageServer from "../../../languageServer/server";
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

    const REVEAL_IN_EXPLORER_COMMAND = "revealInExplorer";
    const getPrimaryResourceMarker = (): string => {
        const configuredResourceMarker = getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_RESOURCE_MARKER)?.find(
            (marker) => typeof marker === "string" && marker.trim().length > 0
        );

        return configuredResourceMarker ?? "[Robot-Resource]";
    };
    const withResourceMarker = (name: string): string => `${name} ${getPrimaryResourceMarker()}`;

    const createMockTestElementData = (overrides: Partial<any> = {}) => ({
        id: "test-item-1",
        parentId: null,
        name: withResourceMarker("TestResource"),
        hierarchicalName: `TestFolder/${withResourceMarker("TestResource")}`,
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

    suite("Subdivision Creation", function () {
        test("createSubdivision should use null parentKey for root subdivision", async function () {
            (treeView as any).currentProjectKey = "PROJ-1";
            (treeView as any).currentTovKey = "TOV-1";

            const showInputBoxStub = testEnv.sandbox.stub(vscode.window, "showInputBox");
            showInputBoxStub.onFirstCall().resolves("Root Subdivision");
            showInputBoxStub.onSecondCall().resolves("");

            mockConnection.createSubdivisionOnServer.resolves({
                key: "SUB-ROOT",
                name: "Root Subdivision",
                uniqueID: "UID-ROOT",
                locker: { key: "", name: "" },
                description: "",
                parentUniqueID: "",
                libraryKey: "",
                path: "",
                references: []
            } as any);

            const refreshStub = testEnv.sandbox.stub(treeView, "refresh");

            await treeView.promptAndCreateRobotResourceSubdivision();

            assert.ok(mockConnection.createSubdivisionOnServer.calledOnce, "Should call createSubdivision API");
            const [projectKeyArg, tovKeyArg, payloadArg] = mockConnection.createSubdivisionOnServer.firstCall.args;
            assert.strictEqual(projectKeyArg, "PROJ-1");
            assert.strictEqual(tovKeyArg, "TOV-1");
            assert.strictEqual(payloadArg.parentKey, null);
            assert.ok(refreshStub.calledOnce, "Should refresh tree after successful creation");
        });

        test("createSubdivision should create subdivision in testbench server and refresh tree", async function () {
            const parentItem = createMockTestElementItem(
                createMockTestElementData({
                    details: {
                        Subdivision_key: {
                            serial: "PARENT-123"
                        }
                    }
                })
            );

            (treeView as any).currentProjectKey = "PROJ-1";
            (treeView as any).currentTovKey = "TOV-1";

            const showInputBoxStub = testEnv.sandbox.stub(vscode.window, "showInputBox");
            showInputBoxStub.onFirstCall().resolves("Child Subdivision");
            showInputBoxStub.onSecondCall().resolves("My description");

            mockConnection.createSubdivisionOnServer.resolves({
                key: "SUB-NEW",
                name: "Child Subdivision",
                uniqueID: "UID-NEW",
                locker: { key: "", name: "" },
                description: "",
                parentUniqueID: "",
                libraryKey: "",
                path: "",
                references: []
            } as any);

            const refreshStub = testEnv.sandbox.stub(treeView, "refresh");

            await treeView.promptAndCreateRobotResourceSubdivision(parentItem);

            assert.ok(mockConnection.createSubdivisionOnServer.calledOnce, "Should call createSubdivision API");
            const [projectKeyArg, tovKeyArg, payloadArg] = mockConnection.createSubdivisionOnServer.firstCall.args;
            assert.strictEqual(projectKeyArg, "PROJ-1");
            assert.strictEqual(tovKeyArg, "TOV-1");
            assert.strictEqual(payloadArg.parentKey, "PARENT-123");
            const configuredResourceMarker = (
                getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_RESOURCE_MARKER) || []
            ).find((marker) => typeof marker === "string" && marker.trim().length > 0);
            const expectedName = configuredResourceMarker
                ? `Child Subdivision ${configuredResourceMarker}`
                : "Child Subdivision";
            assert.strictEqual(payloadArg.name, expectedName);
            assert.ok(typeof payloadArg.uid === "string" && payloadArg.uid.length > 0, "Should generate UID");
            assert.ok(refreshStub.calledOnce, "Should refresh tree after successful creation");
            assert.ok(testEnv.vscodeMocks.showInformationMessageStub.calledOnce, "Should show success message");
        });

        test("createSubdivision should not auto-append marker when marker auto-append is disabled", async function () {
            const parentItem = createMockTestElementItem(
                createMockTestElementData({
                    details: {
                        Subdivision_key: {
                            serial: "PARENT-123"
                        }
                    }
                })
            );

            (treeView as any).currentProjectKey = "PROJ-1";
            (treeView as any).currentTovKey = "TOV-1";

            const showInputBoxStub = testEnv.sandbox.stub(vscode.window, "showInputBox");
            showInputBoxStub.onFirstCall().resolves("Child Subdivision");
            showInputBoxStub.onSecondCall().resolves("My description");

            testEnv.sandbox.stub(treeView as any, "shouldAutoAppendResourceMarker").returns(false);

            mockConnection.createSubdivisionOnServer.resolves({
                key: "SUB-NEW",
                name: "Child Subdivision",
                uniqueID: "UID-NEW",
                locker: { key: "", name: "" },
                description: "",
                parentUniqueID: "",
                libraryKey: "",
                path: "",
                references: []
            } as any);

            const refreshStub = testEnv.sandbox.stub(treeView, "refresh");

            await treeView.promptAndCreateRobotResourceSubdivision(parentItem);

            assert.ok(mockConnection.createSubdivisionOnServer.calledOnce, "Should call createSubdivision API");
            const [projectKeyArg, tovKeyArg, payloadArg] = mockConnection.createSubdivisionOnServer.firstCall.args;
            assert.strictEqual(projectKeyArg, "PROJ-1");
            assert.strictEqual(tovKeyArg, "TOV-1");
            assert.strictEqual(payloadArg.parentKey, "PARENT-123");
            assert.strictEqual(payloadArg.name, "Child Subdivision");
            assert.ok(refreshStub.calledOnce, "Should refresh tree after successful creation");
        });

        test("createSubdivision should show conflict error message on status 409", async function () {
            const parentItem = createMockTestElementItem(
                createMockTestElementData({
                    details: {
                        Subdivision_key: {
                            serial: "PARENT-123"
                        }
                    }
                })
            );

            (treeView as any).currentProjectKey = "PROJ-1";
            (treeView as any).currentTovKey = "TOV-1";

            const showInputBoxStub = testEnv.sandbox.stub(vscode.window, "showInputBox");
            showInputBoxStub.onFirstCall().resolves("Existing Name");
            showInputBoxStub.onSecondCall().resolves("");

            mockConnection.createSubdivisionOnServer.rejects(
                new PlayServerHttpError("Conflict", 409, { message: "Name exists" })
            );

            await treeView.promptAndCreateRobotResourceSubdivision(parentItem);

            assert.ok(testEnv.vscodeMocks.showErrorMessageStub.called, "Should show error message");
            const firstErrorMessageArg = testEnv.vscodeMocks.showErrorMessageStub.firstCall.args[0];
            assert.ok(
                typeof firstErrorMessageArg === "string" && firstErrorMessageArg.includes("409"),
                "Should include 409 status in error message"
            );
        });
    });

    suite("Resource File Operations", function () {
        test("updateSubdivisionAvailability should keep non-resource subdivision as missing", async function () {
            const nonResourceSubdivision = createMockTestElementItem(
                createMockTestElementData({
                    displayName: "Plain Subdivision",
                    originalName: "Plain Subdivision",
                    hierarchicalName: "Root/Plain Subdivision",
                    directRegexMatch: false,
                    isLocallyAvailable: true
                })
            );

            testEnv.sandbox.stub(languageServer, "ensureLanguageServerReady").resolves(true);

            mockResourceFileService.constructAbsolutePath.resolves("/workspace/Root/Plain Subdivision");
            mockResourceFileService.pathExists.resolves(true);

            await (treeView as any).updateSubdivisionAvailability([nonResourceSubdivision], {
                updateParentMarkingOnAvailableResource: false
            });

            assert.strictEqual(nonResourceSubdivision.data.isLocallyAvailable, false);
            assert.ok(
                !mockResourceFileService.constructAbsolutePath.called,
                "Should not resolve resource path for non-resource subdivisions"
            );
            assert.ok(
                !mockResourceFileService.pathExists.called,
                "Should not check file existence for non-resource subdivisions"
            );
        });

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
                    name: withResourceMarker("ExistingResource"),
                    hierarchicalName: `TestFolder/${withResourceMarker("ExistingResource")}`
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
                testEnv.vscodeMocks.executeCommandStub.calledWith(REVEAL_IN_EXPLORER_COMMAND),
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
                testEnv.vscodeMocks.executeCommandStub.calledWith(REVEAL_IN_EXPLORER_COMMAND),
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
                testEnv.vscodeMocks.executeCommandStub.calledWith(REVEAL_IN_EXPLORER_COMMAND),
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
                testEnv.vscodeMocks.executeCommandStub.calledWith(REVEAL_IN_EXPLORER_COMMAND),
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
        test("goToKeywordResource should create parent resource if missing", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: withResourceMarker("ParentResource"),
                    hierarchicalName: `TestFolder/${withResourceMarker("ParentResource")}`
                })
            );

            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestKeyword",
                    hierarchicalName: `TestFolder/${withResourceMarker("ParentResource")}/TestKeyword`,
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
                    name: withResourceMarker("ExistingParentResource"),
                    hierarchicalName: `TestFolder/${withResourceMarker("ExistingParentResource")}`,
                    isLocallyAvailable: true,
                    localPath: "/test/path/ExistingParentResource.resource"
                })
            );

            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "ExistingKeyword",
                    hierarchicalName: `TestFolder/${withResourceMarker("ExistingParentResource")}/ExistingKeyword`,
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
                    name: withResourceMarker("ParentResource"),
                    hierarchicalName: `TestFolder/${withResourceMarker("ParentResource")}`
                })
            );

            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestKeyword",
                    hierarchicalName: `TestFolder/${withResourceMarker("ParentResource")}/TestKeyword`,
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
                testEnv.vscodeMocks.executeCommandStub.calledWith(REVEAL_IN_EXPLORER_COMMAND),
                "Should call revealInExplorer command"
            );
        });
    });

    suite("Initial Load and Refresh Marking Correctness", function () {
        /**
         * Builds a hierarchical TestElementData structure with a parent folder
         * containing two resource subdivisions and one keyword.
         */
        const buildHierarchicalTestData = (): TestElementData[] => {
            const child1: TestElementData = {
                id: "res-1",
                parentId: "folder-1",
                displayName: "Resource1 [Robot-Resource]",
                originalName: "Resource1 [Robot-Resource]",
                hierarchicalName: "ParentFolder/Resource1 [Robot-Resource]",
                uniqueID: "uid-res-1",
                libraryKey: null,
                jsonString: "{}",
                details: {},
                testElementType: TestElementType.Subdivision,
                directRegexMatch: true,
                isVirtual: false
            };

            const child2: TestElementData = {
                id: "res-2",
                parentId: "folder-1",
                displayName: "Resource2 [Robot-Resource]",
                originalName: "Resource2 [Robot-Resource]",
                hierarchicalName: "ParentFolder/Resource2 [Robot-Resource]",
                uniqueID: "uid-res-2",
                libraryKey: null,
                jsonString: "{}",
                details: {},
                testElementType: TestElementType.Subdivision,
                directRegexMatch: true,
                isVirtual: false
            };

            const keyword: TestElementData = {
                id: "kw-1",
                parentId: "res-1",
                displayName: "TestKeyword",
                originalName: "TestKeyword",
                hierarchicalName: "ParentFolder/Resource1 [Robot-Resource]/TestKeyword",
                uniqueID: "uid-kw-1",
                libraryKey: null,
                jsonString: "{}",
                details: {},
                testElementType: TestElementType.Keyword,
                directRegexMatch: false,
                isVirtual: false
            };

            child1.children = [keyword];

            const parentFolder: TestElementData = {
                id: "folder-1",
                parentId: null,
                displayName: "ParentFolder",
                originalName: "ParentFolder",
                hierarchicalName: "ParentFolder",
                uniqueID: "uid-folder-1",
                libraryKey: null,
                jsonString: "{}",
                details: {},
                testElementType: TestElementType.Subdivision,
                directRegexMatch: false,
                isVirtual: false,
                children: [child1, child2]
            };

            return [parentFolder];
        };

        /**
         * Stubs the data provider and resource file service for loadTov tests.
         * @param allAvailable If true, all resource paths exist. If false, none exist.
         */
        const setupLoadTovStubs = (allAvailable: boolean) => {
            const hierarchicalData = buildHierarchicalTestData();
            const dataProvider = (treeView as any).dataProvider;
            testEnv.sandbox.stub(dataProvider, "fetchTestElements").resolves(hierarchicalData);
            testEnv.sandbox.stub(dataProvider, "clearCache").returns(undefined);

            mockResourceFileService.constructAbsolutePath.callsFake(async (name: string) => {
                return `/workspace/${name}`;
            });
            mockResourceFileService.pathExists.resolves(allAvailable);
        };

        test("loadTov should set hasLocalChildren=true on parent when all child resources are available", async function () {
            setupLoadTovStubs(true);

            await treeView.loadTov("tov-1", "TOV Label", "ProjectName", "TOVName");

            const rootItems = (treeView as any).rootItems as TestElementsTreeItem[];
            assert.ok(rootItems.length > 0, "Should have root items after loading");

            const parentFolder = rootItems[0];
            assert.strictEqual(
                parentFolder.data.testElementType,
                TestElementType.Subdivision,
                "Root item should be a Subdivision"
            );
            assert.strictEqual(
                parentFolder.hasLocalChildren,
                true,
                "Parent folder should have hasLocalChildren=true when all child resources are available"
            );

            // Verify child resources are marked as available
            const children = parentFolder.children as TestElementsTreeItem[];
            assert.ok(children.length >= 2, "Parent folder should have at least 2 children");

            const resourceChild1 = children.find((c) => c.data.id === "res-1");
            const resourceChild2 = children.find((c) => c.data.id === "res-2");
            assert.ok(resourceChild1, "Should find resource child 1");
            assert.ok(resourceChild2, "Should find resource child 2");
            assert.strictEqual(resourceChild1!.data.isLocallyAvailable, true, "Resource 1 should be locally available");
            assert.strictEqual(resourceChild2!.data.isLocallyAvailable, true, "Resource 2 should be locally available");
        });

        test("loadTov should set hasLocalChildren=false on parent when not all child resources are available", async function () {
            const hierarchicalData = buildHierarchicalTestData();
            const dataProvider = (treeView as any).dataProvider;
            testEnv.sandbox.stub(dataProvider, "fetchTestElements").resolves(hierarchicalData);
            testEnv.sandbox.stub(dataProvider, "clearCache").returns(undefined);

            mockResourceFileService.constructAbsolutePath.callsFake(async (name: string) => {
                return `/workspace/${name}`;
            });
            // Only res-1 path exists, res-2 does not
            mockResourceFileService.pathExists.callsFake(async (p: string) => {
                return p.includes("Resource1");
            });

            await treeView.loadTov("tov-2", "TOV Label", "ProjectName", "TOVName");

            const rootItems = (treeView as any).rootItems as TestElementsTreeItem[];
            const parentFolder = rootItems[0];

            assert.strictEqual(
                parentFolder.hasLocalChildren,
                false,
                "Parent folder should have hasLocalChildren=false when not all child resources are available"
            );
        });

        test("loadTov should handle collapsed branches correctly for parent markings", async function () {
            setupLoadTovStubs(true);

            await treeView.loadTov("tov-3", "TOV Label", "ProjectName", "TOVName");

            const rootItems = (treeView as any).rootItems as TestElementsTreeItem[];
            const parentFolder = rootItems[0];

            // Even though children may be in collapsed state, parent marking should still be correct
            assert.strictEqual(
                parentFolder.hasLocalChildren,
                true,
                "Parent marking should be correct even for collapsed branches"
            );
        });

        test("refresh should recompute hasLocalChildren correctly after data reload", async function () {
            // First load: all available
            setupLoadTovStubs(true);
            await treeView.loadTov("tov-4", "TOV Label", "ProjectName", "TOVName");

            const rootItemsAfterLoad = (treeView as any).rootItems as TestElementsTreeItem[];
            assert.strictEqual(
                rootItemsAfterLoad[0].hasLocalChildren,
                true,
                "After initial load, parent should have hasLocalChildren=true"
            );

            // Restore stubs for second load with different availability
            testEnv.sandbox.restore();
            testEnv = setupTestEnvironment();

            // Re-create treeView for fresh stubs
            treeView = new TestElementsTreeView(testEnv.mockContext, getConnectionStub);
            treeView.setTreeView(mockVSCodeTreeView);
            (treeView as any).eventBus = testEnv.sandbox.createStubInstance(EventBus);
            (treeView as any).stateManager = testEnv.sandbox.createStubInstance(StateManager);
            (treeView as any).stateManager.getState.returns({
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
            (treeView as any).logger = testEnv.sandbox.createStubInstance(TestBenchLogger);
            (treeView as any).resourceFileService = testEnv.sandbox.createStubInstance(ResourceFileService);

            const newResourceFileService = (treeView as any)
                .resourceFileService as sinon.SinonStubbedInstance<ResourceFileService>;
            const hierarchicalData2 = buildHierarchicalTestData();
            const dataProvider2 = (treeView as any).dataProvider;
            testEnv.sandbox.stub(dataProvider2, "fetchTestElements").resolves(hierarchicalData2);
            testEnv.sandbox.stub(dataProvider2, "clearCache").returns(undefined);

            newResourceFileService.constructAbsolutePath.callsFake(async (name: string) => {
                return `/workspace/${name}`;
            });
            // Now no resources are available
            newResourceFileService.pathExists.resolves(false);

            await treeView.loadTov("tov-4", "TOV Label", "ProjectName", "TOVName");

            const rootItemsAfterRefresh = (treeView as any).rootItems as TestElementsTreeItem[];
            assert.strictEqual(
                rootItemsAfterRefresh[0].hasLocalChildren,
                false,
                "After refresh with no resources available, parent should have hasLocalChildren=false"
            );
        });

        test("keyword context value should reflect parent resource availability", async function () {
            setupLoadTovStubs(true);

            await treeView.loadTov("tov-5", "TOV Label", "ProjectName", "TOVName");

            const rootItems = (treeView as any).rootItems as TestElementsTreeItem[];
            const parentFolder = rootItems[0];
            const resourceChild = (parentFolder.children as TestElementsTreeItem[]).find((c) => c.data.id === "res-1");
            assert.ok(resourceChild, "Should find resource child");

            const keywordChild = (resourceChild!.children as TestElementsTreeItem[]).find(
                (c) => c.data.testElementType === TestElementType.Keyword
            );
            assert.ok(keywordChild, "Should find keyword child");
            assert.strictEqual(
                keywordChild!.data.isLocallyAvailable,
                true,
                "Keyword should inherit parent availability"
            );
        });
    });

    suite("Keyword Click Handlers", function () {
        test("handleKeywordClick should handle keyword clicks via click handler", async function () {
            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestKeyword",
                    hierarchicalName: `TestFolder/${withResourceMarker("ParentResource")}/TestKeyword`,
                    testElementType: TestElementType.Keyword
                })
            );

            const handleClickStub = testEnv.sandbox
                .stub((treeView as any).keywordClickHandler, "handleClick")
                .resolves();

            await treeView.handleKeywordClick(mockKeyword);

            assert.ok(handleClickStub.calledWith(mockKeyword, mockKeyword.id, mockLogger), "Should call click handler");
        });

        test("handleKeywordClick should ignore keyword under non-resource subdivision", async function () {
            const nonResourceParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "Plain Subdivision",
                    displayName: "Plain Subdivision",
                    hierarchicalName: "Root/Plain Subdivision",
                    testElementType: TestElementType.Subdivision,
                    directRegexMatch: false
                })
            );

            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "Plain Keyword",
                    displayName: "Plain Keyword",
                    hierarchicalName: "Root/Plain Subdivision/Plain Keyword",
                    testElementType: TestElementType.Keyword,
                    directRegexMatch: false
                }),
                nonResourceParent
            );

            const handleClickStub = testEnv.sandbox
                .stub((treeView as any).keywordClickHandler, "handleClick")
                .resolves();

            await treeView.handleKeywordClick(mockKeyword);

            assert.ok(!handleClickStub.called, "Should not call click handler for non-resource keyword");
            assert.ok(
                !testEnv.vscodeMocks.showWarningMessageStub.called,
                "Should not show warning for non-resource keyword click"
            );
            assert.ok(
                !testEnv.vscodeMocks.showErrorMessageStub.called,
                "Should not show error for non-resource keyword click"
            );
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
                    name: withResourceMarker("ParentResource"),
                    hierarchicalName: `TestFolder/${withResourceMarker("ParentResource")}`
                })
            );

            const mockKeyword = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestKeyword",
                    hierarchicalName: `TestFolder/${withResourceMarker("ParentResource")}/TestKeyword`,
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
                testEnv.vscodeMocks.executeCommandStub.calledWith(REVEAL_IN_EXPLORER_COMMAND),
                "Should reveal file in explorer"
            );
        });
    });

    suite("Parent Icon Updates", function () {
        test("updateParentIcons should keep non-resource parent folders as missing", async function () {
            const mockParent = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestFolder",
                    hierarchicalName: "TestFolder"
                })
            );

            const mockChild = createMockTestElementItem(
                createMockTestElementData({
                    name: withResourceMarker("TestResource"),
                    hierarchicalName: `TestFolder/${withResourceMarker("TestResource")}`
                }),
                mockParent
            );

            const result = await (treeView as any).updateParentIcons(mockChild);

            assert.strictEqual(result, true, "updateParentIcons should return true");
            assert.strictEqual(mockParent.data.isLocallyAvailable, false);
            assert.strictEqual(mockParent.data.localPath, undefined);
            assert.ok(!mockResourceFileService.directoryExists.called, "Should not check folder existence");
            assert.ok(
                !mockResourceFileService.constructAbsolutePath.called,
                "Should not construct folder path for non-resource parent"
            );
        });
    });
});
