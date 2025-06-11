/**
 * @file src/test/suite/treeProviders/testThemeTreeDataProvider.test.ts
 * @description Tests for TestThemeTreeDataProvider.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { TestThemeTreeDataProvider } from "../../../views/testTheme/testThemeTreeDataProvider";
import { TestThemeTreeItem } from "../../../views/testTheme/testThemeTreeItem";
import { MarkedItemStateService } from "../../../views/testTheme/markedItemStateService";
import { ProjectDataService } from "../../../views/projectManagement/projectDataService";
import { DataForThemeTreeEvent } from "../../../views/projectManagement/projectManagementTreeDataProvider";
import { TestStructure } from "../../../testBenchTypes";
import { TreeViewEmptyState } from "../../../views/common/treeViewStateTypes";
import { TreeItemContextValues } from "../../../constants";

suite("TestThemeTreeDataProvider Tests", () => {
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

    test("should start in an empty state with a 'no data source' message", async () => {
        // Arrange
        // Spy on the state manager to verify its behavior
        const setEmptyStub = testEnv.sandbox.spy(provider["unifiedStateManager"], "setEmpty");

        // Act: Get root elements when no data has been populated yet
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems.length, 0, "Provider should have no items initially");
        assert.ok(
            setEmptyStub.calledOnceWith(TreeViewEmptyState.NO_DATA_SOURCE),
            "Provider should be in a 'no data source' state"
        );
    });

    test("should populate a hierarchical tree from flat cycle data", async () => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: {
                base: {
                    key: "cycle_1",
                    name: "Root Cycle",
                    uniqueID: "uid-cycle-1",
                    numbering: "",
                    parentKey: "",
                    matchesFilter: false
                },
                elementType: "Cycle",
                filters: []
            },
            nodes: [
                // This is a flat list, the provider must build the hierarchy
                {
                    base: {
                        key: "theme_1",
                        parentKey: "cycle_1",
                        name: "Theme A",
                        uniqueID: "uid-theme-1",
                        numbering: "",
                        matchesFilter: false
                    },
                    spec: { key: "spec_1", locker: null, status: "active" },
                    aut: { key: "aut_1", locker: null, status: "active" },
                    exec: { key: "exec_1", locker: null, status: "active", execStatus: "pending", verdict: "not_run" },
                    filters: [],
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                },
                {
                    base: {
                        key: "set_1",
                        parentKey: "theme_1",
                        name: "Set A.1",
                        uniqueID: "uid-set-1",
                        numbering: "",
                        matchesFilter: false
                    },
                    spec: { key: "spec_2", locker: null, status: "active" },
                    aut: { key: "aut_2", locker: null, status: "active" },
                    exec: { key: "exec_2", locker: null, status: "active", execStatus: "pending", verdict: "not_run" },
                    filters: [],
                    elementType: TreeItemContextValues.TEST_CASE_SET_TREE_ITEM
                }
            ]
        };
        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Root Cycle",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };
        // Ensure the marked state service returns false for these items
        mockMarkedItemStateService.getItemImportState.returns({ shouldShow: false });

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);

        // Assert
        // Check root level
        assert.strictEqual(rootItems.length, 1, "Should be one root item (Theme A)");
        const rootTheme = rootItems[0];
        assert.strictEqual(rootTheme.label, "Theme A");
        assert.strictEqual(rootTheme.originalContextValue, TreeItemContextValues.TEST_THEME_TREE_ITEM);

        // Check children (second level)
        const children = await provider.getChildren(rootTheme);
        assert.strictEqual(children.length, 1, "Theme A should have one child");
        const childSet = children[0];
        assert.strictEqual(childSet.label, "Set A.1");
        assert.strictEqual(childSet.originalContextValue, TreeItemContextValues.TEST_CASE_SET_TREE_ITEM);
    });

    test("should query MarkedItemStateService to set item context", async () => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: {
                base: {
                    key: "cycle_1",
                    name: "Root Cycle",
                    uniqueID: "uid-cycle-1",
                    numbering: "",
                    parentKey: "",
                    matchesFilter: false
                },
                elementType: "Cycle",
                filters: []
            },
            nodes: [
                {
                    base: {
                        key: "theme_1",
                        parentKey: "cycle_1",
                        name: "Theme To Mark",
                        uniqueID: "uid-theme-1",
                        numbering: "",
                        matchesFilter: false
                    },
                    spec: { key: "spec_1", locker: null, status: "active" },
                    aut: { key: "aut_1", locker: null, status: "active" },
                    exec: { key: "exec_1", locker: null, status: "active", execStatus: "pending", verdict: "not_run" },
                    filters: [],
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                },
                {
                    base: {
                        key: "theme_2",
                        parentKey: "cycle_1",
                        name: "Theme To Not Mark",
                        uniqueID: "uid-theme-2",
                        numbering: "",
                        matchesFilter: false
                    },
                    spec: { key: "spec_2", locker: null, status: "active" },
                    aut: { key: "aut_2", locker: null, status: "active" },
                    exec: { key: "exec_2", locker: null, status: "active", execStatus: "pending", verdict: "not_run" },
                    filters: [],
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                }
            ]
        };
        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "p1",
            key: "c1",
            label: "L1",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };

        // Configure the service to "mark" the first theme but not the second
        mockMarkedItemStateService.getItemImportState
            .withArgs("theme_1", "uid-theme-1", "p1", "c1")
            .returns({ shouldShow: true });
        mockMarkedItemStateService.getItemImportState
            .withArgs("theme_2", "uid-theme-2", "p1", "c1")
            .returns({ shouldShow: false });

        // Spy on the item's method that changes its context value
        const updateContextSpy = testEnv.sandbox.spy(TestThemeTreeItem.prototype, "updateContextForMarking");

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);

        // Assert
        // 1. Verify the service was called for each item being created.
        assert.ok(
            mockMarkedItemStateService.getItemImportState.calledTwice,
            "getItemImportState should be called for each theme"
        );

        // 2. Verify the items have the correct, final contextValue.
        const markedItem = rootItems.find((item) => item.label === "Theme To Mark");
        const unmarkedItem = rootItems.find((item) => item.label === "Theme To Not Mark");

        assert.ok(markedItem, "Marked item should be found");
        assert.ok(unmarkedItem, "Unmarked item should be found");
        assert.strictEqual(
            markedItem?.contextValue,
            TreeItemContextValues.MARKED_TEST_THEME_TREE_ITEM,
            "Item should have the 'marked' context value"
        );
        assert.strictEqual(
            unmarkedItem?.contextValue,
            TreeItemContextValues.TEST_THEME_TREE_ITEM,
            "Item should have its original context value"
        );

        // 3. Verify the spy to confirm the internal method was called correctly.
        assert.ok(updateContextSpy.calledWith(true), "updateContextForMarking should have been called with 'true'");
        assert.ok(updateContextSpy.calledWith(false), "updateContextForMarking should have been called with 'false'");
    });
});
