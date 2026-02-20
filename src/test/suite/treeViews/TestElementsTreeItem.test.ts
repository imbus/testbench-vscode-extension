import * as assert from "assert";
import * as sinon from "sinon";
import {
    TestElementsTreeItem,
    TestElementType
} from "../../../treeViews/implementations/testElements/TestElementsTreeItem";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { EventBus } from "../../../treeViews/utils/EventBus";
import { UserSessionManager } from "../../../userSessionManager";
import * as extension from "../../../extension";
import { getExtensionSetting } from "../../../configuration";
import { ConfigKeys } from "../../../constants";

suite("TestElementsTreeItem", function () {
    let testEnv: TestEnvironment;
    let mockEventBus: sinon.SinonStubbedInstance<EventBus>;
    let userSessionManager: UserSessionManager;

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
        displayName: withResourceMarker("TestResource"),
        originalName: withResourceMarker("TestResource"),
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
        return new TestElementsTreeItem(data, testEnv.mockContext, parent, mockEventBus);
    };

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockEventBus = testEnv.sandbox.createStubInstance(EventBus);
        userSessionManager = new UserSessionManager(testEnv.mockContext);
        testEnv.sandbox.stub(userSessionManager, "getCurrentUserId").returns("test-user-id");
        (extension as any).userSessionManager = userSessionManager;
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("Constructor and Initialization", function () {
        test("should create tree item with correct data", function () {
            const data = createMockTestElementData();
            const item = new TestElementsTreeItem(data, testEnv.mockContext, undefined, mockEventBus);

            assert.strictEqual(item.data, data);
            assert.strictEqual(item.data.testElementType, TestElementType.Subdivision);
        });

        test("should create tree item with parent", function () {
            const parentData = createMockTestElementData();
            const parent = new TestElementsTreeItem(parentData, testEnv.mockContext, undefined, mockEventBus);

            const childData = createMockTestElementData({
                displayName: "ChildItem",
                testElementType: TestElementType.Keyword
            });
            const child = new TestElementsTreeItem(childData, testEnv.mockContext, parent, mockEventBus);

            assert.strictEqual(child.parent, parent);
        });
    });

    suite("Context Value Management", function () {
        test("should set correct context value for subdivision resource", function () {
            const data = createMockTestElementData({
                displayName: withResourceMarker("TestResource"),
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: true
            });
            const item = new TestElementsTreeItem(data, testEnv.mockContext, undefined, mockEventBus);

            assert.strictEqual(item.contextValue, "testElement.subdivision.resource.available");
        });

        test("should set correct context value for missing subdivision resource", function () {
            const data = createMockTestElementData({
                displayName: withResourceMarker("TestResource"),
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: false
            });
            const item = new TestElementsTreeItem(data, testEnv.mockContext, undefined, mockEventBus);

            assert.strictEqual(item.contextValue, "testElement.subdivision.resource.missing");
        });

        test("should set correct context value for subdivision folder", function () {
            const data = createMockTestElementData({
                displayName: "TestFolder",
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: false
            });
            const item = new TestElementsTreeItem(data, testEnv.mockContext, undefined, mockEventBus);

            assert.strictEqual(item.contextValue, "testElement.subdivision.folder");
        });

        test("should set correct context value for keyword with available parent", function () {
            const parentData = createMockTestElementData({
                displayName: withResourceMarker("ParentResource"),
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: true
            });
            const parent = new TestElementsTreeItem(parentData, testEnv.mockContext, undefined, mockEventBus);

            const keywordData = createMockTestElementData({
                displayName: "TestKeyword",
                testElementType: TestElementType.Keyword,
                isLocallyAvailable: true
            });
            const keyword = new TestElementsTreeItem(keywordData, testEnv.mockContext, parent, mockEventBus);

            assert.strictEqual(keyword.contextValue, "testElement.keyword.resource.available");
        });

        test("should set correct context value for keyword with missing parent", function () {
            const parentData = createMockTestElementData({
                displayName: withResourceMarker("ParentResource"),
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: false
            });
            const parent = new TestElementsTreeItem(parentData, testEnv.mockContext, undefined, mockEventBus);

            const keywordData = createMockTestElementData({
                displayName: "TestKeyword",
                testElementType: TestElementType.Keyword,
                isLocallyAvailable: false
            });
            const keyword = new TestElementsTreeItem(keywordData, testEnv.mockContext, parent, mockEventBus);

            assert.strictEqual(keyword.contextValue, "testElement.keyword.resource.missing");
        });
    });

    suite("Keyword Context Value Updates", function () {
        test("should update keyword context value when parent resource becomes available", function () {
            const parentResource = createMockTestElementItem(
                createMockTestElementData({
                    displayName: withResourceMarker("ParentResource"),
                    hierarchicalName: `TestFolder/${withResourceMarker("ParentResource")}`,
                    testElementType: TestElementType.Subdivision,
                    isLocallyAvailable: false
                })
            );

            const keyword = createMockTestElementItem(
                createMockTestElementData({
                    displayName: "TestKeyword",
                    hierarchicalName: `TestFolder/${withResourceMarker("ParentResource")}/TestKeyword`,
                    testElementType: TestElementType.Keyword,
                    isLocallyAvailable: false
                }),
                parentResource
            );
            assert.strictEqual(keyword.contextValue, "testElement.keyword.resource.missing");

            parentResource.updateLocalAvailability(true, "/test/path/ParentResource.resource");
            assert.strictEqual(keyword.contextValue, "testElement.keyword.resource.available");
        });

        test("should update keyword context value when parent resource becomes unavailable", function () {
            const parentResource = createMockTestElementItem(
                createMockTestElementData({
                    displayName: withResourceMarker("ParentResource"),
                    hierarchicalName: `TestFolder/${withResourceMarker("ParentResource")}`,
                    testElementType: TestElementType.Subdivision,
                    isLocallyAvailable: true
                })
            );

            const keyword = createMockTestElementItem(
                createMockTestElementData({
                    displayName: "TestKeyword",
                    hierarchicalName: `TestFolder/${withResourceMarker("ParentResource")}/TestKeyword`,
                    testElementType: TestElementType.Keyword,
                    isLocallyAvailable: true
                }),
                parentResource
            );

            assert.strictEqual(keyword.contextValue, "testElement.keyword.resource.available");

            parentResource.updateLocalAvailability(false);
            assert.strictEqual(keyword.contextValue, "testElement.keyword.resource.missing");
        });
    });

    suite("Availability Updates", function () {
        test("should update local availability and trigger child updates", function () {
            const parentData = createMockTestElementData({
                displayName: withResourceMarker("ParentResource"),
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: false
            });
            const parent = new TestElementsTreeItem(parentData, testEnv.mockContext, undefined, mockEventBus);

            const childData = createMockTestElementData({
                displayName: "TestKeyword",
                testElementType: TestElementType.Keyword,
                isLocallyAvailable: false
            });
            const child = new TestElementsTreeItem(childData, testEnv.mockContext, parent, mockEventBus);

            assert.strictEqual(parent.data.isLocallyAvailable, false);
            assert.strictEqual(child.data.isLocallyAvailable, false);
            assert.strictEqual(child.contextValue, "testElement.keyword.resource.missing");

            parent.updateLocalAvailability(true, "/test/path/ParentResource.resource");

            assert.strictEqual(parent.data.isLocallyAvailable, true);
            assert.strictEqual(child.data.isLocallyAvailable, true);
            assert.strictEqual(child.contextValue, "testElement.keyword.resource.available");
        });
    });

    suite("Utility Methods", function () {
        test("should generate unique ID", function () {
            const data = createMockTestElementData({
                hierarchicalName: "TestFolder/TestResource"
            });
            const item = new TestElementsTreeItem(data, testEnv.mockContext, undefined, mockEventBus);

            assert.strictEqual(item.id, "test-user-id:testElement:TestFolder/TestResource");
        });

        test("should extract label from hierarchical name", function () {
            const data = createMockTestElementData({
                hierarchicalName: "TestFolder/TestResource"
            });
            const item = new TestElementsTreeItem(data, testEnv.mockContext, undefined, mockEventBus);

            assert.strictEqual(item.label, "TestResource");
        });

        test("should build description with unique ID", function () {
            const data = createMockTestElementData({
                uniqueID: "test-uid-123"
            });
            const item = new TestElementsTreeItem(data, testEnv.mockContext, undefined, mockEventBus);

            if (typeof item.description === "string") {
                assert.ok(item.description.includes("test-uid-123"));
            } else {
                assert.strictEqual(item.description, false);
            }
        });
    });
});
