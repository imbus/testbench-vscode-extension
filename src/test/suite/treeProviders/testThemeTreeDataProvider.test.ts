/**
 * @file src/test/suite/treeProviders/testThemeTreeDataProvider.test.ts
 * @description Tests for TestThemeTreeDataProvider.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { TestThemeTreeDataProvider } from "../../../views/testTheme/testThemeTreeDataProvider";
import { MarkedItemStateService } from "../../../views/testTheme/markedItemStateService";
import { ProjectDataService } from "../../../views/projectManagement/projectDataService";
import { DataForThemeTreeEvent } from "../../../views/projectManagement/projectManagementTreeDataProvider";
import { TestStructure } from "../../../testBenchTypes";
import { TreeItemContextValues } from "../../../constants";

suite("TestThemeTreeDataProvider Foundational Tests", () => {
    let testEnv: TestEnvironment;
    let provider: TestThemeTreeDataProvider;
    let mockProjectDataService: sinon.SinonStubbedInstance<ProjectDataService>;
    let mockMarkedItemStateService: sinon.SinonStubbedInstance<MarkedItemStateService>;

    setup(() => {
        testEnv = setupTestEnvironment();
        mockProjectDataService = testEnv.sandbox.createStubInstance(ProjectDataService);
        mockMarkedItemStateService = testEnv.sandbox.createStubInstance(MarkedItemStateService);

        provider = new TestThemeTreeDataProvider(
            testEnv.mockContext,
            testEnv.logger,
            testEnv.sandbox.stub(),
            mockProjectDataService,
            mockMarkedItemStateService,
            testEnv.iconService
        );
    });

    teardown(() => {
        testEnv.sandbox.restore();
    });

    // Verify that the provider correctly updates its internal state.
    test("should set the current project and cycle key when populated", () => {
        // Arrange
        // Create a minimal mock event. The rawCycleStructure can be empty for this test.
        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_42",
            key: "cycle_101",
            label: "Cycle 101",
            rawTestStructure: { nodes: [] } as any // Type cast to avoid filling out all properties
        };

        // Act
        // Call the method that populates the provider.
        provider.loadTestThemesDataFromCycleData(mockEventData);

        // Assert
        // Check that the provider's internal state was updated correctly.
        assert.strictEqual(provider.getCurrentProjectKey(), "proj_42", "The project key was not set correctly");
        assert.strictEqual(provider.getCurrentCycleKey(), "cycle_101", "The cycle key was not set correctly");
    });

    // Test 3: Verify the most basic data-to-UI transformation.
    test("should create a single root item from simple cycle data", async () => {
        // Arrange
        // Create a mock structure with only one valid node.
        const mockCycleStructure: TestStructure = {
            root: { base: { key: "cycle_1", name: "Root Cycle", uniqueID: "uid-cycle-1" } } as any,
            nodes: [
                {
                    base: { key: "theme_1", parentKey: "cycle_1", name: "My First Theme", uniqueID: "uid-theme-1" },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                }
            ]
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Root Cycle",
            rawTestStructure: mockCycleStructure
        };

        // Ensure the dependency returns a default "unmarked" state.
        mockMarkedItemStateService.getItemImportState.returns({ shouldShow: false });

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems.length, 1, "Provider should display exactly one item");
        const item = rootItems[0];
        assert.strictEqual(item.label, "My First Theme", "The item's label is incorrect");
        assert.strictEqual(
            item.originalContextValue,
            TreeItemContextValues.TEST_THEME_TREE_ITEM,
            "The item's context value is incorrect"
        );
    });
});
