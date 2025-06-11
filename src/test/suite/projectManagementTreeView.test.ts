/**
 * @file src/test/suite/projectManagementTreeView.test.ts
 * @description This file contains unit tests for the Project Management Tree Data Provider.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";
import { ProjectManagementTreeDataProvider } from "../../views/projectManagement/projectManagementTreeDataProvider";
import { ProjectManagementTreeItem } from "../../views/projectManagement/projectManagementTreeItem";
import { ProjectDataService } from "../../views/projectManagement/projectDataService";
import { createMockProject, createMockTreeNode } from "../utils/mockDataFactory";
import { TreeViewEmptyState, TreeViewOperationalState } from "../../views/common/treeViewStateTypes";
import { TreeItemContextValues } from "../../constants";

suite("ProjectManagementTreeDataProvider Tests", () => {
    let testEnv: TestEnvironment;
    let provider: ProjectManagementTreeDataProvider;
    let mockProjectDataService: sinon.SinonStubbedInstance<ProjectDataService>;

    // Before each test, set up a clean environment
    setup(() => {
        testEnv = setupTestEnvironment();
        mockProjectDataService = testEnv.sandbox.createStubInstance(ProjectDataService);

        // Instantiate the real TreeDataProvider, but inject its mocked dependencies.
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

    test("should set correct empty state when data service returns no projects", async () => {
        // Arrange
        // 1. Configure the stubbed service to return an empty array.
        mockProjectDataService.getProjectsList.resolves([]);

        // Act
        // 1. Call getChildren, which triggers the fetch and state update.
        const rootItems = await provider.getChildren(undefined);

        // Assert
        // 1. The provider should return an empty array of UI items.
        assert.strictEqual(rootItems.length, 0, "Should return an empty array");

        // 2. Verify the final state of the provider's state manager. This is more robust
        //    than spying on a specific method call.
        const finalState = provider["unifiedStateManager"].getCurrentUnifiedState();
        assert.strictEqual(
            finalState.operationalState,
            TreeViewOperationalState.EMPTY,
            "Operational state should be EMPTY"
        );
        assert.strictEqual(
            finalState.emptyState,
            TreeViewEmptyState.SERVER_NO_DATA,
            "Empty state reason should be SERVER_NO_DATA"
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

    test("should return TOV and Cycle items as children of a Project", async () => {
        // Arrange
        const projectItem = new ProjectManagementTreeItem(
            "Project Gamma",
            TreeItemContextValues.PROJECT,
            1, // Collapsed
            createMockProject({ key: "proj_3", tovsCount: 1 }),
            testEnv.mockContext,
            testEnv.logger,
            testEnv.iconService,
            null
        );

        const mockTree = createMockTreeNode({
            key: "proj_3_root",
            children: [
                createMockTreeNode({ key: "tov_1", name: "TOV 1", nodeType: "Version" }),
                createMockTreeNode({ key: "cycle_1", name: "Cycle 1", nodeType: "Cycle" })
            ]
        });
        mockProjectDataService.getProjectTree.resolves(mockTree);

        // Act
        const children = await provider.getChildren(projectItem);

        // Assert
        assert.strictEqual(children.length, 2, "Should return two child items");
        assert.strictEqual(children[0].label, "TOV 1", "First child should be the TOV");
        assert.strictEqual(children[0].contextValue, "Version", "First child context should be 'Version'");
        assert.strictEqual(children[1].label, "Cycle 1", "Second child should be the Cycle");
        assert.strictEqual(children[1].contextValue, "Cycle", "Second child context should be 'Cycle'");
        assert.ok(
            mockProjectDataService.getProjectTree.calledOnceWith("proj_3"),
            "getProjectTree should be called with the project key"
        );
    });

    test("should return empty array when fetching children fails", async () => {
        // Arrange
        const projectItem = new ProjectManagementTreeItem(
            "Project Delta",
            TreeItemContextValues.PROJECT,
            1,
            createMockProject({ key: "proj_4" }),
            testEnv.mockContext,
            testEnv.logger,
            testEnv.iconService,
            null
        );

        const childFetchError = new Error("Failed to fetch project tree");
        mockProjectDataService.getProjectTree.rejects(childFetchError);

        // Act
        const children = await provider.getChildren(projectItem);

        // Assert
        assert.strictEqual(children.length, 0, "Should return an empty array on child fetch error");
        assert.ok(
            testEnv.logger.error.calledWith(sinon.match.string, childFetchError),
            "Logger should have recorded the child fetch error"
        );
    });

    test("should correctly set and reset a custom root", async () => {
        // Arrange
        const projectItem = new ProjectManagementTreeItem(
            "Project Epsilon",
            TreeItemContextValues.PROJECT,
            1,
            createMockProject({ key: "proj_5" }),
            testEnv.mockContext,
            testEnv.logger,
            testEnv.iconService,
            null
        );

        // Act & Assert (Set Root)
        assert.strictEqual(provider.isCustomRootActive(), false, "Custom root should not be active initially");
        provider.makeRoot(projectItem);
        assert.strictEqual(provider.isCustomRootActive(), true, "Custom root should be active after makeRoot");
        assert.strictEqual(
            provider.getCurrentCustomRoot()?.label,
            "Project Epsilon",
            "The correct item should be set as custom root"
        );
        const rootChildren = await provider.getChildren(undefined);
        assert.strictEqual(rootChildren.length, 1, "The tree should only show the custom root item");

        // Act & Assert (Reset Root)
        provider.resetCustomRoot();
        assert.strictEqual(provider.isCustomRootActive(), false, "Custom root should be inactive after reset");
        assert.strictEqual(provider.getCurrentCustomRoot(), null, "Current custom root should be null after reset");
    });

    test("should set collapsibleState based on child counts", () => {
        // Arrange
        const projectWithChildren = createMockProject({ tovsCount: 1, cyclesCount: 1 });
        const projectWithoutChildren = createMockProject({ tovsCount: 0, cyclesCount: 0 });

        // Act
        const itemWithChildren = provider["createTestThemeTreeItemFromData"](projectWithChildren, null);
        const itemWithoutChildren = provider["createTestThemeTreeItemFromData"](projectWithoutChildren, null);

        // Assert
        assert.strictEqual(itemWithChildren?.collapsibleState, 1, "Project with children should be collapsible"); // 1 is Collapsed
        assert.strictEqual(
            itemWithoutChildren?.collapsibleState,
            0,
            "Project without children should not be collapsible"
        ); // 0 is None
    });

    test("should correctly fetch children in a multi-level hierarchy", async () => {
        // Arrange
        const mockCycleNode = createMockTreeNode({ key: "cycle_1", name: "Cycle 1.1", nodeType: "Cycle" });
        const mockTovNode = createMockTreeNode({
            key: "tov_1",
            name: "TOV 1",
            nodeType: "Version",
            children: [mockCycleNode]
        });
        const mockProjectTree = createMockTreeNode({
            key: "proj_root_1",
            children: [mockTovNode]
        });

        mockProjectDataService.getProjectTree.resolves(mockProjectTree);

        const projectItem = new ProjectManagementTreeItem(
            "Project with Depth",
            TreeItemContextValues.PROJECT,
            1,
            createMockProject({ key: "proj_deep" }),
            testEnv.mockContext,
            testEnv.logger,
            testEnv.iconService,
            null
        );

        // Act
        const tovs = await provider.getChildren(projectItem);
        assert.strictEqual(tovs.length, 1, "Should find one TOV under the project");
        const tovItem = tovs[0];
        assert.strictEqual(tovItem.label, "TOV 1", "The child item should be the TOV");

        const cycles = await provider.getChildren(tovItem);

        // Assert
        assert.strictEqual(cycles.length, 1, "Should find one Cycle under the TOV");
        const cycleItem = cycles[0];
        assert.strictEqual(cycleItem.label, "Cycle 1.1", "The grandchild item should be the Cycle");
        assert.strictEqual(cycleItem.contextValue, "Cycle", "Grandchild item context should be 'Cycle'");
    });

    test("should fetch correct children when getChildren is called on a custom root", async () => {
        // Arrange
        const mockCycleNode1 = createMockTreeNode({ key: "cycle_2", name: "Cycle 2.1", nodeType: "Cycle" });
        const mockCycleNode2 = createMockTreeNode({ key: "cycle_3", name: "Cycle 2.2", nodeType: "Cycle" });
        const mockTovNode = createMockTreeNode({
            key: "tov_2",
            name: "Complex TOV",
            nodeType: "Version",
            children: [mockCycleNode1, mockCycleNode2]
        });
        const mockProjectTree = createMockTreeNode({ key: "proj_root_2", children: [mockTovNode] });

        mockProjectDataService.getProjectTree.resolves(mockProjectTree);

        const rootProjectItem = new ProjectManagementTreeItem(
            "Project for Custom Root",
            TreeItemContextValues.PROJECT,
            1,
            createMockProject({ key: "proj_custom_root" }),
            testEnv.mockContext,
            testEnv.logger,
            testEnv.iconService,
            null
        );

        const tovItems = await provider.getChildren(rootProjectItem);
        const tovToMakeRoot = tovItems[0];

        // Act
        provider.makeRoot(tovToMakeRoot);
        const childrenOfRoot = await provider.getChildren(tovToMakeRoot);

        // Assert
        assert.strictEqual(childrenOfRoot.length, 2, "Should return the children of the custom root item");
        assert.strictEqual(childrenOfRoot[0].label, "Cycle 2.1", "First child of custom root is incorrect");
        assert.strictEqual(childrenOfRoot[1].label, "Cycle 2.2", "Second child of custom root is incorrect");
    });

    suite("getProjectAndTovNamesFromProjectTreeItem Tests", () => {
        let projectItem: ProjectManagementTreeItem;
        let tovItem: ProjectManagementTreeItem;
        let cycleItem: ProjectManagementTreeItem;

        setup(() => {
            // Create a nested structure for tests
            const projectData = createMockProject({ key: "p1", name: "MyProject" });
            projectItem = new ProjectManagementTreeItem(
                "MyProject",
                TreeItemContextValues.PROJECT,
                1,
                projectData,
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );

            const tovData = createMockTreeNode({ key: "t1", name: "MyTOV" });
            tovItem = new ProjectManagementTreeItem(
                "MyTOV",
                TreeItemContextValues.VERSION,
                1,
                tovData,
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                projectItem
            );
            projectItem.children = [tovItem];

            const cycleData = createMockTreeNode({ key: "c1", name: "MyCycle" });
            cycleItem = new ProjectManagementTreeItem(
                "MyCycle",
                TreeItemContextValues.CYCLE,
                0,
                cycleData,
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                tovItem
            );
            tovItem.children = [cycleItem];
        });

        test("should resolve project and TOV names from a Cycle item", () => {
            // Act
            const result = provider.getProjectAndTovNamesFromProjectTreeItem(cycleItem);

            // Assert
            assert.deepStrictEqual(result, { projectName: "MyProject", tovName: "MyTOV" });
        });

        test("should resolve project and TOV names from a TOV item", () => {
            // Act
            const result = provider.getProjectAndTovNamesFromProjectTreeItem(tovItem);

            // Assert
            assert.deepStrictEqual(result, { projectName: "MyProject", tovName: "MyTOV" });
        });

        test("should resolve only project name from a Project item", () => {
            // Act
            const result = provider.getProjectAndTovNamesFromProjectTreeItem(projectItem);

            // Assert
            assert.deepStrictEqual(result, { projectName: "MyProject", tovName: undefined });
        });
    });

    suite("Custom Root State Management", () => {
        test("should correctly save the state when makeRoot is called", () => {
            // Arrange
            const tovItem = new ProjectManagementTreeItem(
                "TOV for Serialization",
                TreeItemContextValues.VERSION,
                1,
                createMockTreeNode({ key: "tov_serialize" }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );
            const updateStub = testEnv.mockContext.workspaceState.update as sinon.SinonStub;

            testEnv.iconService.getIconUris.returns({
                light: vscode.Uri.file("resources/icons/robot-light.svg"),
                dark: vscode.Uri.file("resources/icons/robot-light.svg")
            });

            // Act
            provider.makeRoot(tovItem);

            // Assert
            // workspaceState.update is called 2 times: once for the custom root and once for expansion state
            assert.ok(updateStub.called, "workspaceState.update should have been called at least once");

            const [storageKey, savedState] = updateStub.firstCall.args;
            assert.strictEqual(
                storageKey,
                "testbenchExtension.customRoot.projectTree",
                "State saved with incorrect key"
            );
            assert.strictEqual(savedState.isActive, true, "Serialized state should be active");
            assert.strictEqual(savedState.rootItemId, "tov_serialize", "Serialized state has incorrect rootItemId");
        });

        test("should restore a pending custom root after a refresh", async () => {
            // Arrange
            const sandbox = testEnv.sandbox;
            // Use fake timers to control the setTimeout in the source code.
            const clock = sandbox.useFakeTimers();

            provider.pendingCustomRootRestore = {
                isActive: true,
                rootItemId: "proj_restore",
                rootItemLabel: "Restored Project",
                originalContextValue: TreeItemContextValues.PROJECT,
                expandedItems: []
            };

            const mockProjects = [createMockProject({ key: "proj_restore", name: "Restored Project" })];
            mockProjectDataService.getProjectsList.resolves(mockProjects);

            // Icon URI of the item being restored
            testEnv.iconService.getIconUris.returns({
                light: vscode.Uri.file("resources/icons/robot-light.svg"),
                dark: vscode.Uri.file("resources/icons/robot-light.svg")
            });

            // Act
            provider.refresh();
            await provider.getChildren(undefined);

            // Advance the fake clock to execute the code inside the setTimeout.
            await clock.tickAsync(200);

            // Assert
            assert.strictEqual(provider.isCustomRootActive(), true, "Custom root should be active after restoration");
            const rootItems = await provider.getChildren(undefined);
            assert.strictEqual(rootItems.length, 1, "Tree should only show the one restored root item");
        });
    });

    suite("Event and Command Interactions", () => {
        test("should fire onDidPrepareDataForThemeTree event when a cycle is clicked", async () => {
            // Arrange
            const projectItem = new ProjectManagementTreeItem(
                "Parent Project",
                TreeItemContextValues.PROJECT,
                1,
                createMockProject({ key: "proj_event" }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );

            const cycleItem = new ProjectManagementTreeItem(
                "Clickable Cycle",
                TreeItemContextValues.CYCLE,
                0,
                { ...createMockTreeNode({ key: "cycle_event" }), base: { parentKey: "tov_parent" } },
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                projectItem // Set parent to allow getProjectKey() to work
            );

            const mockCycleStructure = { root: { base: { key: "cycle_event_root" } }, nodes: [] } as any;
            mockProjectDataService.fetchTestStructureUsingProjectAndCycleKey.resolves(mockCycleStructure);

            const eventSpy = testEnv.sandbox.spy();
            provider.onDidPrepareDataForThemeTree(eventSpy);

            // Act
            await provider.initTestThemeTreeAfterCycleClick(cycleItem);

            // Assert
            assert.ok(eventSpy.calledOnce, "onDidPrepareDataForThemeTree event should have been fired");
            const eventData = eventSpy.firstCall.args[0];
            assert.strictEqual(eventData.projectKey, "proj_event", "Event data has incorrect projectKey");
            assert.strictEqual(eventData.key, "cycle_event", "Event data has incorrect cycleKey");
            assert.deepStrictEqual(
                eventData.rawTestStructure,
                mockCycleStructure,
                "Event data has incorrect rawTestStructure"
            );
        });
    });
});
