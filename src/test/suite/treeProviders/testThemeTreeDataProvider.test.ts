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
import { TreeViewEmptyState } from "../../../views/common/treeViewStateTypes";
import { TestThemeTreeItem } from "../../../views/testTheme/testThemeTreeItem";

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

    // Verify that the provider correctly updates its internal state.
    test("should set the current project and cycle key when populated", () => {
        // Arrange
        // Create a minimal mock event. The rawCycleStructure can be empty for this test.
        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_42",
            key: "cycle_101",
            label: "Cycle 101",
            rawTestStructure: { nodes: [] } as any, // Type cast to avoid filling out all properties
            isFromCycle: true
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
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
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

    test("should filter out items with NotPlanned status", async () => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: { base: { key: "cycle_1", name: "Root Cycle", uniqueID: "uid-cycle-1" } } as any,
            nodes: [
                {
                    base: { key: "theme_1", parentKey: "cycle_1", name: "Active Theme", uniqueID: "uid-theme-1" },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM,
                    exec: { status: "Active" }
                },
                {
                    base: { key: "theme_2", parentKey: "cycle_1", name: "Not Planned Theme", uniqueID: "uid-theme-2" },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM,
                    exec: { status: "NotPlanned" }
                }
            ]
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Root Cycle",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };

        mockMarkedItemStateService.getItemImportState.returns({ shouldShow: false });

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems.length, 1, "Should only show one item (NotPlanned should be filtered)");
        assert.strictEqual(rootItems[0].label, "Active Theme", "Should only show the active theme");
    });

    test("should filter out items locked by system (locker === '-2')", async () => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: { base: { key: "cycle_1", name: "Root Cycle", uniqueID: "uid-cycle-1" } } as any,
            nodes: [
                {
                    base: { key: "theme_1", parentKey: "cycle_1", name: "User Locked Theme", uniqueID: "uid-theme-1" },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM,
                    exec: { locker: "123" }
                },
                {
                    base: {
                        key: "theme_2",
                        parentKey: "cycle_1",
                        name: "System Locked Theme",
                        uniqueID: "uid-theme-2"
                    },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM,
                    exec: { locker: "-2" }
                }
            ]
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Root Cycle",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };

        mockMarkedItemStateService.getItemImportState.returns({ shouldShow: false });

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems.length, 1, "Should filter out system locked item");
        assert.strictEqual(rootItems[0].label, "User Locked Theme", "Should only show user locked theme");
    });

    test("should include numbering in label when present", async () => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: { base: { key: "cycle_1", name: "Root Cycle", uniqueID: "uid-cycle-1" } } as any,
            nodes: [
                {
                    base: {
                        key: "theme_1",
                        parentKey: "cycle_1",
                        name: "Numbered Theme",
                        uniqueID: "uid-theme-1",
                        numbering: "1.2.3"
                    },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                }
            ]
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Root Cycle",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };

        mockMarkedItemStateService.getItemImportState.returns({ shouldShow: false });

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems[0].label, "1.2.3 Numbered Theme", "Should include numbering in label");
    });

    test("should build hierarchical tree structure correctly", async () => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: { base: { key: "cycle_1", name: "Root Cycle", uniqueID: "uid-cycle-1" } } as any,
            nodes: [
                {
                    base: { key: "theme_1", parentKey: "cycle_1", name: "Parent Theme", uniqueID: "uid-theme-1" },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                },
                {
                    base: { key: "set_1", parentKey: "theme_1", name: "Child Set", uniqueID: "uid-set-1" },
                    elementType: TreeItemContextValues.TEST_CASE_SET_TREE_ITEM
                },
                {
                    base: { key: "case_1", parentKey: "set_1", name: "Test Case", uniqueID: "uid-case-1" },
                    elementType: TreeItemContextValues.TEST_CASE_TREE_ITEM
                }
            ]
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Root Cycle",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };

        mockMarkedItemStateService.getItemImportState.returns({ shouldShow: false });

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);
        const parentTheme = rootItems[0];
        const childrenOfParent = await provider.getChildren(parentTheme);

        // Assert
        assert.strictEqual(rootItems.length, 1, "Should have one root item");
        assert.strictEqual(parentTheme.label, "Parent Theme", "Root item should be Parent Theme");
        assert.strictEqual(childrenOfParent.length, 1, "Parent should have one child");
        assert.strictEqual(childrenOfParent[0].label, "Child Set", "Child should be Child Set");

        // Test cases should be filtered out
        const grandChildren = await provider.getChildren(childrenOfParent[0]);
        assert.strictEqual(grandChildren.length, 0, "Test cases should be filtered out");
    });

    test("should update context value for marked items", async () => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: { base: { key: "cycle_1", name: "Root Cycle", uniqueID: "uid-cycle-1" } } as any,
            nodes: [
                {
                    base: { key: "theme_1", parentKey: "cycle_1", name: "Marked Theme", uniqueID: "uid-theme-1" },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                }
            ]
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Root Cycle",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };

        // Configure marked item service to return true for this item
        mockMarkedItemStateService.getItemImportState.returns({ shouldShow: true });

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(
            rootItems[0].contextValue,
            TreeItemContextValues.MARKED_TEST_THEME_TREE_ITEM,
            "Marked item should have marked context value"
        );
        assert.ok(rootItems[0].isMarked(), "Item should be marked");
    });

    test("should handle empty cycle structure gracefully", async () => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: { base: { key: "cycle_1", name: "Root Cycle", uniqueID: "uid-cycle-1" } } as any,
            nodes: []
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Empty Cycle",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems.length, 0, "Should return empty array for empty cycle");
    });

    test("should handle invalid cycle structure gracefully", async () => {
        // Arrange
        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Invalid Cycle",
            rawTestStructure: null as any, // Invalid structure
            isFromCycle: true
        };

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems.length, 0, "Should return empty array for invalid structure");
    });

    test("should support custom root functionality", async () => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: { base: { key: "cycle_1", name: "Root Cycle", uniqueID: "uid-cycle-1" } } as any,
            nodes: [
                {
                    base: { key: "theme_1", parentKey: "cycle_1", name: "Theme 1", uniqueID: "uid-theme-1" },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                },
                {
                    base: { key: "theme_2", parentKey: "cycle_1", name: "Theme 2", uniqueID: "uid-theme-2" },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                }
            ]
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Root Cycle",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };

        mockMarkedItemStateService.getItemImportState.returns({ shouldShow: false });

        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);

        // Act
        provider.makeRoot(rootItems[0]);
        const customRootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(customRootItems.length, 1, "Should only show custom root");
        assert.strictEqual(customRootItems[0].label, "Theme 1", "Custom root should be Theme 1");
        assert.ok(provider.isCustomRootActive(), "Custom root should be active");
    });

    test("should refresh tree and maintain state", async () => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: { base: { key: "cycle_1", name: "Root Cycle", uniqueID: "uid-cycle-1" } } as any,
            nodes: [
                {
                    base: { key: "theme_1", parentKey: "cycle_1", name: "Theme 1", uniqueID: "uid-theme-1" },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                }
            ]
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Root Cycle",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };

        mockMarkedItemStateService.getItemImportState.returns({ shouldShow: false });
        mockProjectDataService.fetchTestStructureUsingProjectAndCycleKey.resolves(mockCycleStructure);

        provider.loadTestThemesDataFromCycleData(mockEventData);

        // Act
        await provider.refresh();
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems.length, 1, "Should maintain items after refresh");
        assert.strictEqual(provider.getCurrentProjectKey(), "proj_1", "Should maintain project key");
        assert.strictEqual(provider.getCurrentCycleKey(), "cycle_1", "Should maintain cycle key");
    });

    test("should handle refresh with no active cycle", async () => {
        // Act: refresh without setting any cycle
        await provider.refresh();
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems.length, 0, "Should return empty when no cycle is active");
    });

    test("should properly dispose tree items when updating", async () => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: { base: { key: "cycle_1", name: "Root Cycle", uniqueID: "uid-cycle-1" } } as any,
            nodes: [
                {
                    base: { key: "theme_1", parentKey: "cycle_1", name: "Theme 1", uniqueID: "uid-theme-1" },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                }
            ]
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Root Cycle",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };

        mockMarkedItemStateService.getItemImportState.returns({ shouldShow: false });

        // Load initial data
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const initialItems = await provider.getChildren(undefined);
        const disposeStub = testEnv.sandbox.stub(initialItems[0], "dispose");

        // Act - Load new data which should dispose old items
        const newStructure = { ...mockCycleStructure };
        newStructure.nodes = [
            {
                base: {
                    key: "theme_2",
                    parentKey: "cycle_1",
                    name: "Theme 2",
                    uniqueID: "uid-theme-2",
                    numbering: "",
                    matchesFilter: false
                },
                elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM,
                spec: {
                    key: "",
                    locker: null,
                    status: ""
                },
                aut: {
                    key: "",
                    locker: null,
                    status: ""
                },
                exec: {
                    status: "",
                    execStatus: "",
                    verdict: "",
                    key: "",
                    locker: null
                },
                filters: []
            }
        ];

        provider.loadTestThemesDataFromCycleData({
            ...mockEventData,
            rawTestStructure: newStructure
        });

        // Assert
        assert.ok(disposeStub.calledOnce, "Old tree items should be disposed when loading new data");
    });

    test("should handle TOV data loading (isFromCycle = false)", async () => {
        // Arrange
        const mockTovStructure: TestStructure = {
            root: { base: { key: "tov_1", name: "Test TOV", uniqueID: "uid-tov-1" } } as any,
            nodes: [
                {
                    base: { key: "theme_1", parentKey: "tov_1", name: "TOV Theme", uniqueID: "uid-theme-1" },
                    elementType: TreeItemContextValues.TEST_THEME_TREE_ITEM
                }
            ]
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "tov_1",
            label: "Test TOV",
            rawTestStructure: mockTovStructure,
            isFromCycle: false // TOV instead of cycle
        };

        mockMarkedItemStateService.getItemImportState.returns({ shouldShow: false });

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
        const rootItems = await provider.getChildren(undefined);

        // Assert
        assert.strictEqual(rootItems.length, 1, "Should load themes from TOV");
        assert.strictEqual(rootItems[0].label, "TOV Theme", "Should show TOV theme");
        assert.strictEqual(provider.isTestThemeOpenedFromACycle, false, "Should track that it's from TOV");
    });

    test("should fire onDidChangeTreeData event when data changes", (done) => {
        // Arrange
        const mockCycleStructure: TestStructure = {
            root: { base: { key: "cycle_1", name: "Root Cycle", uniqueID: "uid-cycle-1" } } as any,
            nodes: []
        } as any;

        const mockEventData: DataForThemeTreeEvent = {
            projectKey: "proj_1",
            key: "cycle_1",
            label: "Root Cycle",
            rawTestStructure: mockCycleStructure,
            isFromCycle: true
        };

        // Listen for the event
        provider.onDidChangeTreeData(() => {
            done(); // Test passes when event fires
        });

        // Act
        provider.loadTestThemesDataFromCycleData(mockEventData);
    });

    test("should correctly return the report root UID from the state service", () => {
        // Arrange
        const mockItem = {
            getUniqueId: () => "item_key_1",
            getUID: () => "item_uid_1"
        } as TestThemeTreeItem;
        provider.loadTestThemesDataFromCycleData({
            projectKey: "p1",
            key: "c1",
            label: "C1",
            rawTestStructure: { nodes: [] } as any,
            isFromCycle: true
        });
        mockMarkedItemStateService.getReportRootUID
            .withArgs("item_key_1", "item_uid_1", "p1", "c1")
            .returns("report_root_uid_123");

        // Act
        const reportRootUID = provider.getReportRootUIDForItem(mockItem);

        // Assert
        assert.strictEqual(reportRootUID, "report_root_uid_123", "Should return the UID provided by the state service");
        assert.ok(
            mockMarkedItemStateService.getReportRootUID.calledOnce,
            "The state service method should have been called"
        );
    });

    test("should enter an error state if refresh fails during data fetch", async () => {
        // Arrange
        const initialStructure: TestStructure = {
            root: { base: { key: "c1" } } as any,
            nodes: [
                {
                    base: { key: "t1", parentKey: "c1", name: "Initial Theme", uniqueID: "uid-t1" },
                    elementType: "TestThemeNode"
                }
            ]
        } as any;
        provider.loadTestThemesDataFromCycleData({
            projectKey: "p1",
            key: "c1",
            label: "C1",
            rawTestStructure: initialStructure,
            isFromCycle: true
        });

        mockProjectDataService.fetchTestStructureUsingProjectAndCycleKey.rejects(new Error("Network Error"));
        const setErrorStub = testEnv.sandbox.spy(provider["unifiedStateManager"], "setError");

        // Act
        await provider.refresh(false);

        // Assert
        assert.ok(
            setErrorStub.calledOnceWith(sinon.match.instanceOf(Error), TreeViewEmptyState.FETCH_ERROR),
            "Provider should enter an error state on fetch failure"
        );
        assert.strictEqual(
            setErrorStub.firstCall.args[0].message,
            "Network Error",
            "The correct error should be propagated"
        );
    });
});
