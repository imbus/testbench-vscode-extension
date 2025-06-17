/**
 * @file src/test/suite/treeProviders/testElementsTreeDataProvider.test.ts
 * @description Tests for TestElementsTreeDataProvider.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { TestElementsTreeDataProvider } from "../../../views/testElements/testElementsTreeDataProvider";
import { TestElementData } from "../../../views/testElements/testElementTreeItem";
import { TestElementDataService } from "../../../views/testElements/testElementDataService";
import { ResourceFileService } from "../../../views/testElements/resourceFileService";
import { TestElementTreeBuilder } from "../../../views/testElements/testElementTreeBuilder";
import { createMockTestElementData } from "../../utils/mockDataFactory";
import { TreeViewOperationalState, TreeViewEmptyState } from "../../../views/common/treeViewStateTypes";

suite("TestElementsTreeDataProvider Tests", () => {
    let testEnv: TestEnvironment;
    let provider: TestElementsTreeDataProvider;
    let mockDataService: sinon.SinonStubbedInstance<TestElementDataService>;
    let mockResourceFileService: sinon.SinonStubbedInstance<ResourceFileService>;
    let mockTreeBuilder: sinon.SinonStubbedInstance<TestElementTreeBuilder>;

    setup(() => {
        testEnv = setupTestEnvironment();
        mockDataService = testEnv.sandbox.createStubInstance(TestElementDataService);
        mockResourceFileService = testEnv.sandbox.createStubInstance(ResourceFileService);
        mockTreeBuilder = testEnv.sandbox.createStubInstance(TestElementTreeBuilder);

        provider = new TestElementsTreeDataProvider(
            testEnv.mockContext,
            testEnv.logger,
            testEnv.sandbox.stub(),
            mockDataService,
            mockResourceFileService,
            testEnv.iconService,
            mockTreeBuilder
        );
    });

    teardown(() => {
        testEnv.sandbox.restore();
    });

    test("should fetch data, build a tree, and display items", async () => {
        // Arrange
        const flatListData = [createMockTestElementData({ id: "elem_1" })];
        const hierarchicalData = [{ ...createMockTestElementData({ id: "elem_1" }), children: [] }];

        // Configure the mocked dependencies
        mockDataService.getTestElements.withArgs("tov_123").resolves(flatListData);
        mockTreeBuilder.build.withArgs(flatListData).returns(hierarchicalData as TestElementData[]);

        // Act
        // fetchTestElements is the main entry point for this provider
        const success = await provider.fetchTestElements("tov_123", "My Test Object");
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.ok(success, "fetchTestElements should return true on success");
        assert.strictEqual(rootItems.length, 1, "Provider should display one root item");
        assert.strictEqual(rootItems[0].testElementData.id, "elem_1", "The correct tree item should be displayed");

        // Verify that the dependencies were called correctly
        assert.ok(
            mockDataService.getTestElements.calledOnceWith("tov_123"),
            "Data service should be called with the correct TOV key"
        );
        assert.ok(
            mockTreeBuilder.build.calledOnceWith(flatListData),
            "Tree builder should be called with the flat data from the service"
        );
    });

    test("should handle empty test elements data", async () => {
        // Arrange
        mockDataService.getTestElements.withArgs("tov_123").resolves([]);
        mockTreeBuilder.build.withArgs([]).returns([]);

        // Act
        const success = await provider.fetchTestElements("tov_123", "My Test Object");
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.ok(success, "fetchTestElements should return true even with empty data");
        assert.strictEqual(rootItems.length, 0, "Provider should display no items for empty data");
    });

    test("should handle null test elements data", async () => {
        // Arrange
        mockDataService.getTestElements.withArgs("tov_123").resolves(null);

        // Act
        const success = await provider.fetchTestElements("tov_123", "My Test Object");
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.ok(!success, "fetchTestElements should return false when data service returns null");
        assert.strictEqual(rootItems.length, 0, "Provider should display no items when data is null");
    });

    test("should handle hierarchical test elements data", async () => {
        // Arrange
        const parentData = createMockTestElementData({ id: "parent_1", testElementType: "Subdivision" });
        const childData = createMockTestElementData({ id: "child_1", parentId: "parent_1" });
        const flatListData = [parentData, childData];
        const hierarchicalData = [
            {
                ...parentData,
                children: [childData]
            }
        ];

        mockDataService.getTestElements.withArgs("tov_123").resolves(flatListData);
        mockTreeBuilder.build.withArgs(flatListData).returns(hierarchicalData as TestElementData[]);

        // Act
        const success = await provider.fetchTestElements("tov_123", "My Test Object");
        const rootItems = await provider.getChildren(undefined);
        const childItems = await provider.getChildren(rootItems[0]);

        // Assert
        assert.ok(success, "fetchTestElements should return true for hierarchical data");
        assert.strictEqual(rootItems.length, 1, "Provider should display one root item");
        assert.strictEqual(childItems.length, 1, "Provider should display one child item");
        assert.strictEqual(rootItems[0].testElementData.id, "parent_1", "Root item should be the parent");
        assert.strictEqual(childItems[0].testElementData.id, "child_1", "Child item should be correct");
    });

    test("should handle error when fetching test elements", async () => {
        // Arrange
        mockDataService.getTestElements.withArgs("tov_123").rejects(new Error("Network error"));

        // Act
        const success = await provider.fetchTestElements("tov_123", "My Test Object");
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.ok(!success, "fetchTestElements should return false on error");
        assert.strictEqual(rootItems.length, 0, "Provider should display no items on error");
    });

    test("should handle different test element types", async () => {
        // Arrange
        const subdivisionData = createMockTestElementData({ id: "sub_1", testElementType: "Subdivision" });
        const interactionData = createMockTestElementData({ id: "int_1", testElementType: "Interaction" });
        const dataTypeData = createMockTestElementData({ id: "dt_1", testElementType: "DataType" });
        const conditionData = createMockTestElementData({ id: "cond_1", testElementType: "Condition" });

        const flatListData = [subdivisionData, interactionData, dataTypeData, conditionData];
        // Add children to the subdivision data
        const hierarchicalData = [
            {
                ...subdivisionData,
                children: [interactionData, dataTypeData, conditionData]
            }
        ];

        mockDataService.getTestElements.withArgs("tov_123").resolves(flatListData);
        mockTreeBuilder.build.withArgs(flatListData).returns(hierarchicalData as TestElementData[]);

        // Act
        const success = await provider.fetchTestElements("tov_123", "My Test Object");
        const rootItems = await provider.getChildren(undefined);
        const childItems = await provider.getChildren(rootItems[0]);

        // Assert
        assert.ok(success, "fetchTestElements should return true for mixed element types");
        assert.strictEqual(rootItems.length, 1, "Provider should display one root item");
        assert.strictEqual(childItems.length, 3, "Provider should display all child items");
        assert.strictEqual(rootItems[0].testElementData.testElementType, "Subdivision", "Root should be a subdivision");
        assert.strictEqual(
            childItems[0].testElementData.testElementType,
            "Interaction",
            "First child should be an interaction"
        );
        assert.strictEqual(
            childItems[1].testElementData.testElementType,
            "DataType",
            "Second child should be a data type"
        );
        assert.strictEqual(
            childItems[2].testElementData.testElementType,
            "Condition",
            "Third child should be a condition"
        );
    });

    test("should update tree view title when provided", async () => {
        // Arrange
        const flatListData = [createMockTestElementData({ id: "elem_1" })];
        const hierarchicalData = [{ ...createMockTestElementData({ id: "elem_1" }), children: [] }];
        const newTitle = "New Test Object View";

        mockDataService.getTestElements.withArgs("tov_123").resolves(flatListData);
        mockTreeBuilder.build.withArgs(flatListData).returns(hierarchicalData as TestElementData[]);

        // Act
        await provider.fetchTestElements("tov_123", newTitle);
        const state = provider.getUnifiedStateManager().getCurrentUnifiedState();

        // Assert
        assert.strictEqual(state.dataSourceDisplayName, newTitle, "Tree view title should be updated");
    });

    test("should use TOV key as title when not provided", async () => {
        // Arrange
        const flatListData = [createMockTestElementData({ id: "elem_1" })];
        const hierarchicalData = [{ ...createMockTestElementData({ id: "elem_1" }), children: [] }];
        const tovKey = "tov_123";

        mockDataService.getTestElements.withArgs(tovKey).resolves(flatListData);
        mockTreeBuilder.build.withArgs(flatListData).returns(hierarchicalData as TestElementData[]);

        // Act
        await provider.fetchTestElements(tovKey);
        const state = provider.getUnifiedStateManager().getCurrentUnifiedState();

        // Assert
        assert.strictEqual(
            state.dataSourceDisplayName,
            tovKey,
            "Tree view title should use TOV key when no title is provided"
        );
    });

    test("should handle filtered data from tree builder", async () => {
        // Arrange
        const subdivisionData = createMockTestElementData({ id: "sub_1", testElementType: "Subdivision" });
        const interactionData = createMockTestElementData({ id: "int_1", testElementType: "Interaction" });
        const dataTypeData = createMockTestElementData({ id: "dt_1", testElementType: "DataType" });
        const conditionData = createMockTestElementData({ id: "cond_1", testElementType: "Condition" });

        const flatListData = [subdivisionData, interactionData, dataTypeData, conditionData];
        // Tree builder should filter out DataType and Condition
        const filteredHierarchicalData = [
            {
                ...subdivisionData,
                children: [interactionData] // Only Interaction remains after filtering
            }
        ];

        mockDataService.getTestElements.withArgs("tov_123").resolves(flatListData);
        mockTreeBuilder.build.withArgs(flatListData).returns(filteredHierarchicalData as TestElementData[]);

        // Act
        const success = await provider.fetchTestElements("tov_123", "My Test Object");
        const rootItems = await provider.getChildren(undefined);
        const childItems = await provider.getChildren(rootItems[0]);

        // Assert
        assert.ok(success, "fetchTestElements should return true");
        assert.strictEqual(rootItems.length, 1, "Provider should display one root item");
        assert.strictEqual(childItems.length, 1, "Provider should display only filtered child items");
        assert.strictEqual(
            childItems[0].testElementData.testElementType,
            "Interaction",
            "Only Interaction type should be displayed"
        );
    });

    test("should handle subdivision with no valid children", async () => {
        // Arrange
        const subdivisionData = createMockTestElementData({
            id: "sub_1",
            testElementType: "Subdivision",
            directRegexMatch: false
        });
        const dataTypeData = createMockTestElementData({ id: "dt_1", testElementType: "DataType" });
        const conditionData = createMockTestElementData({ id: "cond_1", testElementType: "Condition" });

        const flatListData = [subdivisionData, dataTypeData, conditionData];
        // Tree builder should filter out the subdivision as it has no valid children
        const filteredHierarchicalData: TestElementData[] = [];

        mockDataService.getTestElements.withArgs("tov_123").resolves(flatListData);
        mockTreeBuilder.build.withArgs(flatListData).returns(filteredHierarchicalData);

        // Act
        const success = await provider.fetchTestElements("tov_123", "My Test Object");
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.ok(success, "fetchTestElements should return true");
        assert.strictEqual(
            rootItems.length,
            0,
            "Provider should display no items when subdivision has no valid children"
        );
    });

    test("should handle subdivision with direct regex match", async () => {
        // Arrange
        const subdivisionData = createMockTestElementData({
            id: "sub_1",
            testElementType: "Subdivision",
            directRegexMatch: true // Direct regex match should keep this subdivision
        });
        const dataTypeData = createMockTestElementData({ id: "dt_1", testElementType: "DataType" });
        const conditionData = createMockTestElementData({ id: "cond_1", testElementType: "Condition" });

        const flatListData = [subdivisionData, dataTypeData, conditionData];
        // Tree builder should keep the subdivision due to direct regex match
        const filteredHierarchicalData = [
            {
                ...subdivisionData,
                children: [] // No valid children but subdivision is kept due to direct regex match
            }
        ];

        mockDataService.getTestElements.withArgs("tov_123").resolves(flatListData);
        mockTreeBuilder.build.withArgs(flatListData).returns(filteredHierarchicalData as TestElementData[]);

        // Act
        const success = await provider.fetchTestElements("tov_123", "My Test Object");
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.ok(success, "fetchTestElements should return true");
        assert.strictEqual(rootItems.length, 1, "Provider should display subdivision with direct regex match");
        assert.strictEqual(rootItems[0].testElementData.testElementType, "Subdivision", "Root should be a subdivision");
        assert.strictEqual(
            rootItems[0].testElementData.directRegexMatch,
            true,
            "Subdivision should have direct regex match"
        );
    });

    test("should update operational state based on data", async () => {
        // Arrange
        const flatListData = [createMockTestElementData({ id: "elem_1" })];
        const hierarchicalData = [{ ...createMockTestElementData({ id: "elem_1" }), children: [] }];

        mockDataService.getTestElements.withArgs("tov_123").resolves(flatListData);
        mockTreeBuilder.build.withArgs(flatListData).returns(hierarchicalData as TestElementData[]);

        // Act
        await provider.fetchTestElements("tov_123", "My Test Object");
        const state = provider.getUnifiedStateManager().getCurrentUnifiedState();

        // Assert
        assert.strictEqual(state.operationalState, TreeViewOperationalState.READY, "Operational state should be READY");
        assert.strictEqual(state.itemsBeforeFiltering, 1, "Should track items before filtering");
        assert.strictEqual(state.itemsAfterFiltering, 1, "Should track items after filtering");
        assert.strictEqual(state.isServerDataReceived, true, "Should indicate server data was received");
    });

    test("should update operational state for empty data", async () => {
        // Arrange
        mockDataService.getTestElements.withArgs("tov_123").resolves([]);
        mockTreeBuilder.build.withArgs([]).returns([]);

        // Act
        await provider.fetchTestElements("tov_123", "My Test Object");
        const state = provider.getUnifiedStateManager().getCurrentUnifiedState();

        // Assert
        assert.strictEqual(state.operationalState, TreeViewOperationalState.EMPTY, "Operational state should be EMPTY");
        assert.strictEqual(state.emptyState, TreeViewEmptyState.SERVER_NO_DATA, "Empty state should be SERVER_NO_DATA");
        assert.strictEqual(state.itemsBeforeFiltering, 0, "Should track zero items before filtering");
        assert.strictEqual(state.itemsAfterFiltering, 0, "Should track zero items after filtering");
    });
});
