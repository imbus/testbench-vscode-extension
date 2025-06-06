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
});
