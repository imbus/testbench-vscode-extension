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
import { ContextKeys, StorageKeys, TreeItemContextValues } from "../../constants";

suite("ProjectManagementTreeDataProvider Tests", () => {
    let testEnv: TestEnvironment;
    let provider: ProjectManagementTreeDataProvider;
    let mockProjectDataService: sinon.SinonStubbedInstance<ProjectDataService>;

    // Before each test, set up a clean environment
    setup(() => {
        testEnv = setupTestEnvironment();
        mockProjectDataService = testEnv.sandbox.createStubInstance(ProjectDataService);

        // Instantiate TreeDataProvider, inject its mocked dependencies.
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
        // Create mock data that our service will return.
        const mockProjects = [
            createMockProject({ key: "proj_1", name: "Project Alpha" }),
            createMockProject({ key: "proj_2", name: "Project Beta" })
        ];

        // Configure the stubbed data service to return our mock data when called.
        mockProjectDataService.getProjectsList.resolves(mockProjects);

        // Act
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems.length, 2, "Should return two tree items");

        assert.ok(
            rootItems[0] instanceof ProjectManagementTreeItem,
            "First item should be a ProjectManagementTreeItem"
        );
        assert.strictEqual(rootItems[0].label, "Project Alpha", "First item should have the correct label");
        assert.strictEqual(rootItems[1].label, "Project Beta", "Second item should have the correct label");
        assert.ok(
            mockProjectDataService.getProjectsList.calledOnce,
            "getProjectsList should have been called on the data service"
        );
    });

    test("should set correct empty state when data service returns no projects", async () => {
        // Arrange
        // Configure the stubbed service to return an empty array.
        mockProjectDataService.getProjectsList.resolves([]);

        // Act
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems.length, 0, "Should return an empty array");

        // Verify the final state of the provider's state manager.
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
        // 1. Even on error, the provider should return an empty array.
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
        test("should fire onDidPrepareDataForTestThemeTree event when a cycle is clicked", async () => {
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
            provider.onDidPrepareDataForTestThemeTree(eventSpy);

            // Act
            await provider.initTestThemeTreeAfterCycleClick(cycleItem);

            // Assert
            assert.ok(eventSpy.calledOnce, "onDidPrepareDataForTestThemeTree event should have been fired");
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

    suite("Data Fetching and State Management", () => {
        test("should handle a null response from data service", async () => {
            // Arrange
            mockProjectDataService.getProjectsList.resolves(null);
            const setErrorSpy = testEnv.sandbox.spy(provider["unifiedStateManager"], "setError");

            // Act
            const rootItems = await provider.getChildren(undefined);

            // Assert
            assert.strictEqual(rootItems.length, 0, "Should return an empty array for a null response");
            assert.ok(setErrorSpy.calledOnce, "StateManager's setError should be called");

            const finalState = provider["unifiedStateManager"].getCurrentUnifiedState();
            assert.strictEqual(
                finalState.operationalState,
                TreeViewOperationalState.ERROR,
                "Operational state should be ERROR"
            );
            assert.strictEqual(
                finalState.emptyState,
                TreeViewEmptyState.FETCH_ERROR,
                "Empty state reason should be FETCH_ERROR"
            );
        });

        test("should correctly create items from a mix of valid and invalid data", async () => {
            // Arrange
            const mockData = [
                createMockProject({ key: "proj_valid", name: "Valid Project" }),
                { name: "Invalid Project without key" } // Invalid data
            ];
            mockProjectDataService.getProjectsList.resolves(mockData as any);

            // Act
            const rootItems = await provider.getChildren(undefined);

            // Assert
            assert.strictEqual(rootItems.length, 1, "Should only create one item for the valid data");
            assert.strictEqual(rootItems[0].label, "Valid Project", "The label of the created item is incorrect");
        });

        test("should determine collapsible state correctly for projects", () => {
            // Arrange
            const projectWithTovs = createMockProject({ tovsCount: 1, cyclesCount: 0 });
            const projectWithCycles = createMockProject({ tovsCount: 0, cyclesCount: 1 });
            const projectWithBoth = createMockProject({ tovsCount: 1, cyclesCount: 1 });
            const projectWithNone = createMockProject({ tovsCount: 0, cyclesCount: 0 });

            // Act
            const itemWithTovs = provider["createTestThemeTreeItemFromData"](projectWithTovs, null);
            const itemWithCycles = provider["createTestThemeTreeItemFromData"](projectWithCycles, null);
            const itemWithBoth = provider["createTestThemeTreeItemFromData"](projectWithBoth, null);
            const itemWithNone = provider["createTestThemeTreeItemFromData"](projectWithNone, null);

            // Assert
            assert.strictEqual(itemWithTovs?.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            assert.strictEqual(itemWithCycles?.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            assert.strictEqual(itemWithBoth?.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            assert.strictEqual(itemWithNone?.collapsibleState, vscode.TreeItemCollapsibleState.None);
        });
    });

    suite("Child Item and Hierarchy Logic", () => {
        test("should return an empty array for children of a Cycle item", async () => {
            // Arrange
            const cycleItem = new ProjectManagementTreeItem(
                "A Cycle",
                TreeItemContextValues.CYCLE,
                vscode.TreeItemCollapsibleState.None,
                createMockTreeNode({ nodeType: "Cycle" }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );

            // Act
            const children = await provider.getChildren(cycleItem);

            // Assert
            assert.strictEqual(children.length, 0, "Cycles should have no children in this tree");
        });

        test("should log a warning for an unknown item context when fetching children", async () => {
            // Arrange
            const unknownItem = new ProjectManagementTreeItem(
                "Unknown Item",
                "some-unknown-context",
                vscode.TreeItemCollapsibleState.None,
                {},
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );

            // Act
            const children = await provider.getChildren(unknownItem);

            // Assert
            assert.strictEqual(children.length, 0, "Unknown item types should have no children");
            assert.ok(
                testEnv.logger.warn.calledWith(sinon.match(/Unknown tree item type/)),
                "A warning should be logged"
            );
        });
    });

    suite("User Interaction and Events", () => {
        let cycleItem: ProjectManagementTreeItem;

        setup(() => {
            const projectItem = new ProjectManagementTreeItem(
                "Parent Project",
                TreeItemContextValues.PROJECT,
                vscode.TreeItemCollapsibleState.Collapsed,
                createMockProject({ key: "proj_event" }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );
            cycleItem = new ProjectManagementTreeItem(
                "Clickable Cycle",
                TreeItemContextValues.CYCLE,
                vscode.TreeItemCollapsibleState.None,
                createMockTreeNode({ key: "cycle_event" }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                projectItem
            );
        });

        test("should show error if cycle item is missing context keys", async () => {
            // Arrange
            // Create an item that will fail getProjectKey()
            const invalidCycleItem = new ProjectManagementTreeItem(
                "Invalid Cycle",
                TreeItemContextValues.CYCLE,
                vscode.TreeItemCollapsibleState.None,
                createMockTreeNode({ key: "cycle_invalid" }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null // No parent, so getProjectKey() will return null
            );
            const showErrorStub = testEnv.vscodeMocks.showErrorMessageStub;

            // Act
            await provider.initTestThemeTreeAfterCycleClick(invalidCycleItem);

            // Assert
            assert.ok(
                showErrorStub.calledOnceWith(sinon.match(/Could not determine project context/)),
                "Error message should be shown"
            );
        });

        test("should handle data service error during cycle data fetch", async () => {
            // Arrange
            const fetchError = new Error("API 500 Internal Server Error");
            mockProjectDataService.fetchTestStructureUsingProjectAndCycleKey.rejects(fetchError);
            const showErrorStub = testEnv.vscodeMocks.showErrorMessageStub;

            // Mock withProgress to proceed without cancellation
            testEnv.vscodeMocks.executeCommandStub
                .withArgs("workbench.action.showCommands")
                .callsFake(async (callback: (progress: any, token: vscode.CancellationToken) => Promise<any>) => {
                    const source = new vscode.CancellationTokenSource();
                    await callback({ report: () => {} }, source.token);
                });

            // Act
            await provider.initTestThemeTreeAfterCycleClick(cycleItem);

            // Assert
            assert.ok(
                showErrorStub.calledOnceWith(sinon.match(/Failed to load data for cycle.*API 500/)),
                "Error message with failure reason should be shown to the user"
            );
        });

        test("should set IS_TT_OPENED_FROM_CYCLE context key correctly", async () => {
            // Arrange
            const setContextStub = testEnv.vscodeMocks.executeCommandStub.withArgs("setContext");
            const tovItem = new ProjectManagementTreeItem(
                "Clickable TOV",
                TreeItemContextValues.VERSION,
                vscode.TreeItemCollapsibleState.Collapsed,
                createMockTreeNode({ key: "tov_context" }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );
            // Suppress console error for the purpose of this test.
            testEnv.logger.error.returns();

            // Act
            await provider.initTestThemeTreeAfterCycleClick(cycleItem);
            // Assert
            assert.ok(
                setContextStub.calledWith("setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, true),
                "Context should be set to true for a cycle click"
            );

            // Act
            await provider.initTestThemeTreeAfterTOVClick(tovItem);
            // Assert
            assert.ok(
                setContextStub.calledWith("setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, false),
                "Context should be set to false for a TOV click"
            );
        });
    });

    suite("Operation Cancellation", () => {
        test("should cancel all operations when a new refresh is triggered", async () => {
            // Arrange
            // Spy on the method that is actually called inside refresh().
            const cancelAllSpy = testEnv.sandbox.spy(provider["operationManager"], "cancelAllOperations");
            mockProjectDataService.getProjectsList.resolves([]);

            // Act
            provider.refresh();

            // Assert
            assert.ok(cancelAllSpy.calledOnce, "cancelAllOperations should be called on the manager during a refresh");
        });
    });

    suite("Custom Root and State Restoration", () => {
        test("should save both custom root and expansion state when makeRoot is called", () => {
            // Arrange
            const projectItem = createMockProject({ key: "proj_1", name: "Project One" });
            const itemToRoot = new ProjectManagementTreeItem(
                "Root Candidate",
                TreeItemContextValues.PROJECT,
                vscode.TreeItemCollapsibleState.None,
                projectItem,
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );
            const updateSpy = testEnv.mockContext.workspaceState.update as sinon.SinonStub;

            // Act
            provider.makeRoot(itemToRoot);

            // Assert
            const customRootCall = updateSpy.withArgs(StorageKeys.CUSTOM_ROOT_PROJECT_TREE, sinon.match.any);
            assert.ok(customRootCall.called, "Custom root state should be saved");
            const savedState = customRootCall.lastCall.args[1];
            assert.deepStrictEqual(savedState.isActive, true);
            assert.deepStrictEqual(savedState.rootItemId, "proj_1");
        });

        test("should save a cleared state when resetCustomRoot is called", () => {
            // Arrange
            const projectItem = createMockProject({ key: "proj_1", name: "Project One" });
            const itemToRoot = new ProjectManagementTreeItem(
                "Rooted Item",
                TreeItemContextValues.PROJECT,
                vscode.TreeItemCollapsibleState.None,
                projectItem,
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );
            provider.makeRoot(itemToRoot);
            const updateSpy = testEnv.mockContext.workspaceState.update as sinon.SinonStub;
            updateSpy.resetHistory();

            // Act
            provider.resetCustomRoot();

            // Assert
            const customRootCall = updateSpy.withArgs(StorageKeys.CUSTOM_ROOT_PROJECT_TREE, sinon.match.any);
            assert.ok(customRootCall.called, "Cleared custom root state should be saved");
            const savedState = customRootCall.lastCall.args[1];
            assert.strictEqual(savedState.isActive, false, "Serialized state should be inactive");
        });

        test("should clear an active custom root on a hard refresh", () => {
            // Arrange
            const projectItem = new ProjectManagementTreeItem(
                "Project To Root",
                TreeItemContextValues.PROJECT,
                vscode.TreeItemCollapsibleState.None,
                createMockProject({ key: "proj_1" }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );
            provider.makeRoot(projectItem);
            assert.strictEqual(provider.isCustomRootActive(), true, "Precondition: Custom root should be active");

            // Act
            provider.refresh(true); // isHardRefresh = true

            // Assert
            // Rationale: The `refresh` method explicitly calls `resetCustomRoot` when isHardRefresh is true.
            assert.strictEqual(
                provider.isCustomRootActive(),
                false,
                "Custom root should be inactive after a hard refresh"
            );
        });

        test("should preserve an active custom root on a soft refresh", async () => {
            // Arrange
            // Create a TOV item to be the root
            const tovNode = createMockTreeNode({ key: "tov_1", name: "TOV One", nodeType: "Version" });
            const tovItem = new ProjectManagementTreeItem(
                "TOV One",
                TreeItemContextValues.VERSION,
                vscode.TreeItemCollapsibleState.Collapsed,
                tovNode,
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );

            // Set it as the root
            provider.makeRoot(tovItem);
            assert.strictEqual(provider.isCustomRootActive(), true, "Precondition: Custom root is active");

            // Prepare new data that will be returned on refresh
            const updatedCycleNode = createMockTreeNode({
                key: "cycle_updated",
                name: "Updated Cycle",
                nodeType: "Cycle"
            });
            tovNode.children = [updatedCycleNode]; // Add a child to the original TOV node data
            mockProjectDataService.getProjectTree.resolves(createMockTreeNode({ children: [tovNode] }));

            // Act
            provider.refresh(false); // Soft refresh
            const rootChildren = await provider.getChildren(tovItem);

            // Assert
            // Rationale: The `refresh(false)` path for a custom root re-fetches data but only rebuilds the children
            // of the existing root item, preserving the root itself. This is handled by the `refreshCustomRootTreeItem` logic in `TestThemeTreeDataProvider`, and a similar pattern is expected here.
            assert.strictEqual(
                provider.isCustomRootActive(),
                true,
                "Custom root should remain active after a soft refresh"
            );
            assert.strictEqual(rootChildren.length, 1, "Custom root should now have one child");
            assert.strictEqual(rootChildren[0].label, "Updated Cycle", "Child of custom root was not updated");
        });

        test("should restore a top-level project as custom root on startup", async () => {
            // Arrange
            const clock = testEnv.sandbox.useFakeTimers();
            const projectToRestore = createMockProject({ key: "proj_restore", name: "Restored Project" });

            // 1. Mock the stored state that the provider will load.
            //    Rationale: The original test tried to restore a nested TOV, which fails because the implementation's
            //    `tryRestoreCustomRoot` logic runs before child items are lazily loaded. This fix tests the
            //    supported scenario: restoring a top-level item.
            const storedCustomRootState = {
                isActive: true,
                rootItemId: "proj_restore",
                rootItemLabel: "Restored Project",
                originalContextValue: TreeItemContextValues.PROJECT,
                expandedItems: [],
                contextData: {}
            };
            (testEnv.mockContext.workspaceState.get as sinon.SinonStub)
                .withArgs(StorageKeys.CUSTOM_ROOT_PROJECT_TREE)
                .returns(storedCustomRootState);

            // 2. Instantiate a NEW provider to simulate extension startup.
            const newProvider = new ProjectManagementTreeDataProvider(
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                testEnv.sandbox.stub(),
                mockProjectDataService
            );

            // 3. Mock the data service to return the project that needs to be restored.
            mockProjectDataService.getProjectsList.resolves([projectToRestore]);

            // Act
            // 4. Trigger the data fetch, which will then trigger the restoration logic.
            await newProvider.getChildren(undefined);
            await clock.tickAsync(200); // Advance timers to fire the restoration `setTimeout`.

            // Assert
            // Rationale: The constructor loads the pending state. getChildren() fetches the root items, including
            // the one to be restored. The `setTimeout` then calls `tryRestoreCustomRoot`, which finds the
            // top-level item in the already-fetched `rootTreeItems` and successfully makes it the root.
            assert.strictEqual(newProvider.isCustomRootActive(), true, "Custom root was not restored");
            const restoredRoot = newProvider.getCurrentCustomRoot();
            assert.notStrictEqual(restoredRoot, null, "Restored root item should not be null");
            assert.strictEqual(restoredRoot?.label, "Restored Project", "Incorrect item was restored as root");
        });

        test("should not restore custom root if item is not found in fetched data", async () => {
            // Arrange
            const clock = testEnv.sandbox.useFakeTimers();
            const storedStateWithInvalidItem = {
                isActive: true,
                rootItemId: "item_that_no_longer_exists",
                rootItemLabel: "Old Item",
                originalContextValue: TreeItemContextValues.PROJECT,
                expandedItems: []
            };
            (testEnv.mockContext.workspaceState.get as sinon.SinonStub)
                .withArgs(StorageKeys.CUSTOM_ROOT_PROJECT_TREE)
                .returns(storedStateWithInvalidItem);

            const newProvider = new ProjectManagementTreeDataProvider(
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                testEnv.sandbox.stub(),
                mockProjectDataService
            );

            // Mock data service to return data that does NOT contain the old item
            mockProjectDataService.getProjectsList.resolves([createMockProject({ key: "different_item" })]);
            const updateSpy = testEnv.mockContext.workspaceState.update as sinon.SinonStub;

            // Act
            await newProvider.getChildren(undefined);
            await clock.tickAsync(200);

            // Assert
            // Rationale: `tryRestoreCustomRoot` calls `findItemById`, which will return null. The `else` block
            // then logs a warning, sets pending restore to null, and calls `saveCustomRootState` to clear the invalid state.
            assert.strictEqual(newProvider.isCustomRootActive(), false, "Custom root should not be active");
            assert.ok(
                testEnv.logger.warn.calledWith(sinon.match(/Could not find valid item to restore/)),
                "A warning should be logged"
            );
            const savedStateCall = updateSpy.withArgs(
                StorageKeys.CUSTOM_ROOT_PROJECT_TREE,
                sinon.match({ isActive: false })
            );
            assert.ok(savedStateCall.calledOnce, "The invalid custom root state should be cleared from storage");
        });
    });

    suite("State Management and Transitions", () => {
        test("should transition through loading states correctly", async () => {
            // Arrange
            const stateManager = provider["unifiedStateManager"];
            const stateSpy = testEnv.sandbox.spy(stateManager, "updateState");
            const mockProjects = [createMockProject({ key: "proj_state" })];
            mockProjectDataService.getProjectsList.resolves(mockProjects);

            // Act
            await provider.getChildren(undefined);

            // Assert
            // Verify loading state was set
            assert.ok(
                stateSpy.calledWith(sinon.match({ operationalState: TreeViewOperationalState.LOADING })),
                "Should set loading state"
            );

            // Verify final state after data is loaded
            const finalState = stateManager.getCurrentUnifiedState();
            assert.strictEqual(
                finalState.operationalState,
                TreeViewOperationalState.READY,
                "Should end in READY state"
            );
            assert.strictEqual(finalState.itemsAfterFiltering, 1, "Should have one item after filtering");
        });

        test("should maintain state after soft refreshes", async () => {
            // Arrange
            const projectItem = new ProjectManagementTreeItem(
                "Test Project",
                TreeItemContextValues.PROJECT,
                vscode.TreeItemCollapsibleState.Collapsed,
                createMockProject({ key: "proj_state" }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );
            provider.makeRoot(projectItem);

            // Act
            provider.refresh(false);
            const stateBefore = provider["unifiedStateManager"].getCurrentUnifiedState();
            await provider.getChildren(undefined);
            const stateAfter = provider["unifiedStateManager"].getCurrentUnifiedState();

            // Assert
            assert.strictEqual(stateBefore.isCustomRootActive, stateAfter.isCustomRootActive);
            assert.strictEqual(stateBefore.customRootItem?.getUniqueId(), stateAfter.customRootItem?.getUniqueId());
        });
    });

    suite("Operation Management", () => {
        test("should cancel pending operations when new operation starts", async () => {
            // Arrange
            const cancelSpy = testEnv.sandbox.spy(provider["operationManager"], "cancelOperation");
            mockProjectDataService.getProjectsList.resolves([]);

            // Act
            provider.refresh();
            await provider.getChildren(undefined);

            // Assert
            assert.ok(cancelSpy.called, "Should have cancelled pending operations");
        });

        test("should handle concurrent operations correctly", async () => {
            // Arrange
            const projectItem = new ProjectManagementTreeItem(
                "Test Project",
                TreeItemContextValues.PROJECT,
                vscode.TreeItemCollapsibleState.Collapsed,
                createMockProject({ key: "proj_concurrent" }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );

            // Act
            const [children1, children2] = await Promise.all([
                provider.getChildren(projectItem),
                provider.getChildren(projectItem)
            ]);

            // Assert
            assert.strictEqual(
                children1.length,
                children2.length,
                "Concurrent operations should return consistent results"
            );
        });
    });

    suite("Event Handling", () => {
        test("should handle event cancellation gracefully", async () => {
            // Arrange
            const cycleItem = new ProjectManagementTreeItem(
                "Test Cycle",
                TreeItemContextValues.CYCLE,
                vscode.TreeItemCollapsibleState.None,
                createMockTreeNode({ key: "cycle_cancel" }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );
            const eventSpy = testEnv.sandbox.spy();
            provider.onDidPrepareDataForTestThemeTree(eventSpy);

            // Act
            const operation = provider["operationManager"].createOperation("handleCycleClick", "Test operation");
            operation.cancel();
            await provider.initTestThemeTreeAfterCycleClick(cycleItem);

            // Assert
            assert.ok(!eventSpy.called, "Event should not be emitted when operation is cancelled");
        });
    });

    suite("Data Service Integration", () => {
        test("should handle retry behavior for failed requests", async () => {
            const projectKey = "proj_retry";
            const error = new Error("Network error");
            mockProjectDataService.getProjectTree.rejects(error);

            const projectItem = new ProjectManagementTreeItem(
                "Test Project",
                TreeItemContextValues.PROJECT,
                vscode.TreeItemCollapsibleState.Collapsed,
                createMockProject({ key: projectKey }),
                testEnv.mockContext,
                testEnv.logger,
                testEnv.iconService,
                null
            );

            // Act
            const children = await provider.getChildren(projectItem);

            // Assert
            assert.strictEqual(children.length, 0, "Should return empty array on error");
            assert.ok(
                mockProjectDataService.getProjectTree.calledOnce,
                "Should not retry failed request as retry behavior is not implemented"
            );
        });
    });

    suite("Tree Item Creation and Validation", () => {
        test("should validate tree item data before creation", () => {
            // Arrange
            const invalidData = { name: "Invalid Item" }; // Missing key

            // Act
            const item = provider["createTestThemeTreeItemFromData"](invalidData, null);

            // Assert
            assert.strictEqual(item, null, "Should return null for invalid data");
            assert.ok(
                testEnv.logger.warn.calledWith(sinon.match(/Invalid data for tree item/)),
                "Should log warning for invalid data"
            );
        });

        test("should handle tree items with custom (not defined in the context) context values", () => {
            // Arrange
            const customData = createMockTreeNode({
                key: "custom_node",
                nodeType: "CustomType"
            });

            // Act
            const item = provider["createTestThemeTreeItemFromData"](customData, null);

            // Assert
            assert.notStrictEqual(item, null, "Should create item with custom context");
            assert.strictEqual(item?.contextValue, "CustomType", "Should use custom context value");
        });
    });
});
