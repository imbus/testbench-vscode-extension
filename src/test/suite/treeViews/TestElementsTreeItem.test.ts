import * as assert from "assert";
import * as sinon from "sinon";
import {
    TestElementsTreeItem,
    TestElementType
} from "../../../treeViews/implementations/testElements/TestElementsTreeItem";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { EventBus } from "../../../treeViews/utils/EventBus";

suite("TestElementsTreeItem", function () {
    let testEnv: TestEnvironment;
    let mockEventBus: sinon.SinonStubbedInstance<EventBus>;

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
        return new TestElementsTreeItem(data, testEnv.mockContext, parent, mockEventBus);
    };

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockEventBus = testEnv.sandbox.createStubInstance(EventBus);
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
                name: "ChildItem",
                testElementType: TestElementType.Interaction
            });
            const child = new TestElementsTreeItem(childData, testEnv.mockContext, parent, mockEventBus);

            assert.strictEqual(child.parent, parent);
        });
    });

    suite("Context Value Management", function () {
        test("should set correct context value for subdivision resource", function () {
            const data = createMockTestElementData({
                name: "TestResource [Robot-Resource]",
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: true
            });
            const item = new TestElementsTreeItem(data, testEnv.mockContext, undefined, mockEventBus);

            assert.strictEqual(item.contextValue, "testElement.subdivision.resource.available");
        });

        test("should set correct context value for missing subdivision resource", function () {
            const data = createMockTestElementData({
                name: "TestResource [Robot-Resource]",
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: false
            });
            const item = new TestElementsTreeItem(data, testEnv.mockContext, undefined, mockEventBus);

            assert.strictEqual(item.contextValue, "testElement.subdivision.resource.missing");
        });

        test("should set correct context value for subdivision folder", function () {
            const data = createMockTestElementData({
                name: "TestFolder",
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: false
            });
            const item = new TestElementsTreeItem(data, testEnv.mockContext, undefined, mockEventBus);

            assert.strictEqual(item.contextValue, "testElement.subdivision.folder");
        });

        test("should set correct context value for interaction with available parent", function () {
            const parentData = createMockTestElementData({
                name: "ParentResource [Robot-Resource]",
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: true
            });
            const parent = new TestElementsTreeItem(parentData, testEnv.mockContext, undefined, mockEventBus);

            const interactionData = createMockTestElementData({
                name: "TestInteraction",
                testElementType: TestElementType.Interaction,
                isLocallyAvailable: true
            });
            const interaction = new TestElementsTreeItem(interactionData, testEnv.mockContext, parent, mockEventBus);

            assert.strictEqual(interaction.contextValue, "testElement.interaction.resource.available");
        });

        test("should set correct context value for interaction with missing parent", function () {
            const parentData = createMockTestElementData({
                name: "ParentResource [Robot-Resource]",
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: false
            });
            const parent = new TestElementsTreeItem(parentData, testEnv.mockContext, undefined, mockEventBus);

            const interactionData = createMockTestElementData({
                name: "TestInteraction",
                testElementType: TestElementType.Interaction,
                isLocallyAvailable: false
            });
            const interaction = new TestElementsTreeItem(interactionData, testEnv.mockContext, parent, mockEventBus);

            assert.strictEqual(interaction.contextValue, "testElement.interaction.resource.missing");
        });
    });

    suite("Interaction Context Value Updates", function () {
        test("should update interaction context value when parent resource becomes available", function () {
            const parentResource = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]",
                    testElementType: TestElementType.Subdivision,
                    isLocallyAvailable: false
                })
            );

            const interaction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction,
                    isLocallyAvailable: false
                }),
                parentResource
            );
            assert.strictEqual(interaction.contextValue, "testElement.interaction.resource.missing");

            parentResource.updateLocalAvailability(true, "/test/path/ParentResource.resource");
            assert.strictEqual(interaction.contextValue, "testElement.interaction.resource.available");
        });

        test("should update interaction context value when parent resource becomes unavailable", function () {
            const parentResource = createMockTestElementItem(
                createMockTestElementData({
                    name: "ParentResource [Robot-Resource]",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]",
                    testElementType: TestElementType.Subdivision,
                    isLocallyAvailable: true
                })
            );

            const interaction = createMockTestElementItem(
                createMockTestElementData({
                    name: "TestInteraction",
                    hierarchicalName: "TestFolder/ParentResource [Robot-Resource]/TestInteraction",
                    testElementType: TestElementType.Interaction,
                    isLocallyAvailable: true
                }),
                parentResource
            );

            assert.strictEqual(interaction.contextValue, "testElement.interaction.resource.available");

            parentResource.updateLocalAvailability(false);
            assert.strictEqual(interaction.contextValue, "testElement.interaction.resource.missing");
        });
    });

    suite("Availability Updates", function () {
        test("should update local availability and trigger child updates", function () {
            const parentData = createMockTestElementData({
                name: "ParentResource [Robot-Resource]",
                testElementType: TestElementType.Subdivision,
                isLocallyAvailable: false
            });
            const parent = new TestElementsTreeItem(parentData, testEnv.mockContext, undefined, mockEventBus);

            const childData = createMockTestElementData({
                name: "TestInteraction",
                testElementType: TestElementType.Interaction,
                isLocallyAvailable: false
            });
            const child = new TestElementsTreeItem(childData, testEnv.mockContext, parent, mockEventBus);

            assert.strictEqual(parent.data.isLocallyAvailable, false);
            assert.strictEqual(child.data.isLocallyAvailable, false);
            assert.strictEqual(child.contextValue, "testElement.interaction.resource.missing");

            parent.updateLocalAvailability(true, "/test/path/ParentResource.resource");

            assert.strictEqual(parent.data.isLocallyAvailable, true);
            assert.strictEqual(child.data.isLocallyAvailable, true);
            assert.strictEqual(child.contextValue, "testElement.interaction.resource.available");
        });
    });

    suite("Utility Methods", function () {
        test("should generate unique ID", function () {
            const data = createMockTestElementData({
                hierarchicalName: "TestFolder/TestResource"
            });
            const item = new TestElementsTreeItem(data, testEnv.mockContext, undefined, mockEventBus);

            assert.strictEqual(item.id, "testElement:TestFolder/TestResource");
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
