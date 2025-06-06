/**
 * @file src/test/suite/projectManagementTreeView.test.ts
 * @description This file contains unit tests for the Project Management Tree Data Provider.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";
import { ProjectManagementTreeDataProvider } from "../../views/projectManagement/projectManagementTreeDataProvider";
import { ProjectManagementTreeItem } from "../../views/projectManagement/projectManagementTreeItem";
import { ProjectDataService } from "../../views/projectManagement/projectDataService";
import { createMockProject } from "../utils/mockDataFactory";
import { TreeViewEmptyState } from "../../views/common/treeViewStateTypes";

suite("ProjectManagementTreeDataProvider Tests", () => {
    let testEnv: TestEnvironment;
    let provider: ProjectManagementTreeDataProvider;
    let mockProjectDataService: sinon.SinonStubbedInstance<ProjectDataService>;

    // Before each test, set up a clean environment
    setup(() => {
        testEnv = setupTestEnvironment();

        // Create a stubbed instance of the data service this provider depends on
        mockProjectDataService = testEnv.sandbox.createStubInstance(ProjectDataService);

        // Instantiate the real TreeDataProvider, but inject its mocked dependencies.
        // This allows us to test the provider's logic in isolation.
        // We provide a simple stub for the `updateMessageCallback`.
        provider = new ProjectManagementTreeDataProvider(
            testEnv.mockContext,
            testEnv.logger,
            testEnv.iconService,
            testEnv.sandbox.stub(),
            mockProjectDataService
        );
    });

    // After each test, restore the sandbox
    teardown(() => {
        testEnv.sandbox.restore();
    });

    test("should return project items when data service provides projects", async () => {
        // Arrange:
        // 1. Create mock data that our service will return.
        const mockProjects = [
            createMockProject({ key: "proj_1", name: "Project Alpha" }),
            createMockProject({ key: "proj_2", name: "Project Beta" })
        ];

        // 2. Configure the stubbed data service to return our mock data when called.
        mockProjectDataService.getProjectsList.resolves(mockProjects);

        // Act:
        // 1. Call getChildren without an element to fetch the root items.
        const rootItems = await provider.getChildren(undefined);

        // Assert:
        // 1. Check that the provider returned the correct number of items.
        assert.strictEqual(rootItems.length, 2, "Should return two tree items");

        // 2. Verify that the returned items are of the correct type and have the correct labels.
        assert.ok(
            rootItems[0] instanceof ProjectManagementTreeItem,
            "First item should be a ProjectManagementTreeItem"
        );
        assert.strictEqual(rootItems[0].label, "Project Alpha", "First item should have the correct label");
        assert.strictEqual(rootItems[1].label, "Project Beta", "Second item should have the correct label");

        // 3. Ensure the underlying data service method was called.
        assert.ok(
            mockProjectDataService.getProjectsList.calledOnce,
            "getProjectsList should have been called on the data service"
        );
    });

    test("should return an empty array when data service returns no projects", async () => {
        // Arrange:
        // 1. Configure the stubbed service to return an empty array.
        mockProjectDataService.getProjectsList.resolves([]);
        // 2. Spy on the state manager to ensure it's updated correctly.
        const setEmptyStub = testEnv.sandbox.spy(provider["unifiedStateManager"], "setEmpty");

        // Act:
        const rootItems = await provider.getChildren(undefined);

        // Assert:
        // 1. The provider should return an empty array.
        assert.strictEqual(rootItems.length, 0, "Should return an empty array");

        // 2. The provider should have updated its internal state to reflect that the server returned no data.
        assert.ok(
            setEmptyStub.calledOnceWith(TreeViewEmptyState.SERVER_NO_DATA),
            "UnifiedStateManager should be set to the correct empty state"
        );
    });

    test("should handle errors gracefully when data service fails", async () => {
        // Arrange:
        // 1. Configure the stubbed service to throw an error.
        const apiError = new Error("Network request failed");
        mockProjectDataService.getProjectsList.rejects(apiError);

        // 2. Spy on the state manager's error handling.
        const setErrorStub = testEnv.sandbox.spy(provider["unifiedStateManager"], "setError");

        // Act:
        const rootItems = await provider.getChildren(undefined);

        // Assert:
        // 1. Even on error, the provider should return an empty array to prevent the UI from crashing.
        assert.strictEqual(rootItems.length, 0, "Should return an empty array on error");

        // 2. The provider should have called the logger to record the error.
        assert.ok(
            testEnv.logger.error.calledWith(sinon.match.string, apiError),
            "Logger should have been called with the error"
        );

        // 3. The provider should have updated its internal state to an error state.
        assert.ok(setErrorStub.calledOnceWith(apiError), "UnifiedStateManager should be set to an error state");
    });
});
