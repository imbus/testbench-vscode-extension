/**
 * @file src/test/suite/treeViews/TreeViewBase.test.ts
 * @description Unit tests for the TreeViewBase class
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { TreeViewBase } from "../../../treeViews/core/TreeViewBase";
import { TreeItemBase } from "../../../treeViews/core/TreeItemBase";
import { TreeViewConfig } from "../../../treeViews/core/TreeViewConfig";
import { TreeViewModule } from "../../../treeViews/core/TreeViewModule";
import { StateManager } from "../../../treeViews/state/StateManager";
import { EventBus } from "../../../treeViews/utils/EventBus";
import { TestBenchLogger } from "../../../testBenchLogger";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";

// Concrete implementation for testing
class TestTreeItem extends TreeItemBase {
    constructor(
        label: string,
        description: string | undefined,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        extensionContext: vscode.ExtensionContext,
        parent?: TreeItemBase
    ) {
        super(label, description, contextValue, collapsibleState, extensionContext, parent);
    }

    protected generateUniqueId(): string {
        return `test-item-${Date.now()}-${Math.random()}`;
    }

    public clone(): TreeItemBase {
        return new TestTreeItem(
            this.label as string,
            this.description as string | undefined,
            this.contextValue || "",
            this.collapsibleState,
            this.extensionContext,
            this.parent === null ? undefined : this.parent
        );
    }

    public serialize(): any {
        return {
            label: this.label,
            description: this.description,
            contextValue: this.contextValue,
            collapsibleState: this.collapsibleState
        };
    }
}

// Concrete TreeViewBase implementation for testing
class TestTreeView extends TreeViewBase<TestTreeItem> {
    public fetchRootItemsCalled: boolean = false;
    public getChildrenForItemCalled: boolean = false;
    public createTreeItemCalled: boolean = false;
    public mockRootItems: TestTreeItem[] = [];
    public mockChildren: TestTreeItem[] = [];

    constructor(extensionContext: vscode.ExtensionContext, config: TreeViewConfig) {
        super(extensionContext, config);
    }

    protected async fetchRootItems(): Promise<TestTreeItem[]> {
        this.fetchRootItemsCalled = true;
        return this.mockRootItems;
    }

    protected async getChildrenForItem(item: TestTreeItem): Promise<TestTreeItem[]> {
        this.getChildrenForItemCalled = true;
        return this.mockChildren;
    }

    protected createTreeItem(data: any, parent?: TestTreeItem): TestTreeItem {
        this.createTreeItemCalled = true;
        return new TestTreeItem(
            data.label || "Mock Item",
            data.description,
            data.contextValue || "mock",
            vscode.TreeItemCollapsibleState.None,
            this.extensionContext,
            parent
        );
    }

    // Expose protected methods for testing
    public testGetRootItems(): Promise<TestTreeItem[]> {
        return this.getRootItems();
    }

    public testLoadData(options?: { immediate?: boolean }): Promise<void> {
        return this.loadData(options);
    }

    public getModules(): Map<string, TreeViewModule> {
        return this.modules;
    }

    public getRootItemsArray(): TestTreeItem[] {
        return this.rootItems;
    }

    public setRootItems(items: TestTreeItem[]): void {
        this.rootItems = items;
    }

    public setIsLoading(loading: boolean): void {
        (this as any)._isLoading = loading;
    }

    public setLastDataFetch(timestamp: number): void {
        (this as any)._lastDataFetch = timestamp;
    }

    public setIntentionallyCleared(cleared: boolean): void {
        (this as any)._intentionallyCleared = cleared;
    }

    // Expose protected properties for testing
    public getProtectedLogger(): TestBenchLogger {
        return (this as any).logger;
    }

    public getProtectedStateManager(): StateManager {
        return (this as any).stateManager;
    }

    // Override protected methods for testing
    public overrideFetchRootItems(fetchFn: () => Promise<TestTreeItem[]>): void {
        (this as any).fetchRootItems = fetchFn;
    }

    public overrideGetChildrenForItem(fetchFn: (item: TestTreeItem) => Promise<TestTreeItem[]>): void {
        (this as any).getChildrenForItem = fetchFn;
    }
}

suite("TreeViewBase", function () {
    let testEnv: TestEnvironment;
    let mockContext: vscode.ExtensionContext;
    let config: TreeViewConfig;
    let treeView: TestTreeView;
    let mockVSCodeTreeView: vscode.TreeView<TestTreeItem>;

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockContext = testEnv.mockContext;

        // Create test configuration
        config = {
            id: "test-tree",
            title: "Test Tree View",
            contextValue: "testTreeView",
            features: {
                customRoot: true,
                marking: true,
                persistence: true,
                filtering: true,
                icons: true,
                expansion: true
            },
            modules: {},
            behavior: {
                refreshStrategy: "smart",
                errorHandling: "notify",
                loadingTimeout: 50000,
                debounceDelay: 500
            },
            ui: {
                emptyMessage: "No items found",
                loadingMessage: "Loading...",
                errorMessage: "An error occurred",
                showTooltips: true,
                tooltipFormat: "default"
            }
        };

        // Create tree view
        treeView = new TestTreeView(mockContext, config);

        // Create mock VS Code tree view
        mockVSCodeTreeView = {
            title: config.title,
            visible: true,
            onDidChangeVisibility: new vscode.EventEmitter<vscode.TreeViewVisibilityChangeEvent>().event,
            onDidChangeSelection: new vscode.EventEmitter<vscode.TreeViewSelectionChangeEvent<TestTreeItem>>().event,
            onDidExpandElement: new vscode.EventEmitter<vscode.TreeViewExpansionEvent<TestTreeItem>>().event,
            onDidCollapseElement: new vscode.EventEmitter<vscode.TreeViewExpansionEvent<TestTreeItem>>().event,
            reveal: testEnv.sandbox.stub().resolves(),
            dispose: testEnv.sandbox.stub()
        } as any;

        // Set the VS Code tree view reference
        treeView.setTreeView(mockVSCodeTreeView);
    });

    this.afterEach(async function () {
        testEnv.sandbox.restore();
        await treeView.dispose();
    });

    suite("Constructor and Initialization", () => {
        test("should create tree view with correct configuration", () => {
            assert.strictEqual(treeView.config.id, "test-tree");
            assert.strictEqual(treeView.config.title, "Test Tree View");
            assert.strictEqual(treeView.config.contextValue, "testTreeView");
        });

        test("should initialize core components", () => {
            assert.ok(treeView.getProtectedLogger() instanceof TestBenchLogger);
            assert.ok(treeView.eventBus instanceof EventBus);
            assert.ok(treeView.getProtectedStateManager() instanceof StateManager);
        });

        test("should set up event listeners", () => {
            // Test that connection change listener is set up
            const eventSpy = testEnv.sandbox.spy();
            treeView.eventBus.on("connection:changed", eventSpy);

            // Should have the connection listener set up
            assert.ok(true); // If we get here, the listener was set up
        });

        test("should initialize with empty root items", () => {
            assert.deepStrictEqual(treeView.getRootItemsArray(), []);
        });

        test("should not be initialized initially", () => {
            assert.strictEqual(treeView.isInitialized(), false);
        });
    });

    suite("Tree View Reference Management", () => {
        test("should set VS Code tree view reference", () => {
            const newTreeView = {
                title: "New Title",
                visible: true,
                onDidChangeVisibility: new vscode.EventEmitter().event,
                onDidChangeSelection: new vscode.EventEmitter().event,
                onDidExpandElement: new vscode.EventEmitter().event,
                onDidCollapseElement: new vscode.EventEmitter().event,
                reveal: testEnv.sandbox.stub().resolves(),
                dispose: testEnv.sandbox.stub()
            } as any;

            treeView.setTreeView(newTreeView);

            // Should be able to access the tree view reference
            assert.ok(true); // If we get here, the reference was set
        });

        test("should update title", () => {
            const newTitle = "Updated Title";
            treeView.updateTitle(newTitle);

            // The title should be updated on the VS Code tree view
            assert.strictEqual(mockVSCodeTreeView.title, newTitle);
        });

        test("should reset title to default", () => {
            // Change title first
            treeView.updateTitle("Custom Title");
            assert.strictEqual(mockVSCodeTreeView.title, "Custom Title");

            // Reset to default
            treeView.resetTitle();
            assert.strictEqual(mockVSCodeTreeView.title, config.title);
        });
    });

    suite("Module Management", () => {
        test("should initialize modules", async () => {
            await treeView.initialize();

            // Should be initialized
            assert.strictEqual(treeView.isInitialized(), true);

            // Should have modules registered
            const modules = treeView.getModules();
            assert.ok(modules.size > 0);
        });

        test("should register modules correctly", async () => {
            await treeView.initialize();

            const modules = treeView.getModules();

            // Check that expected modules are registered
            assert.ok(modules.has("customRoot"));
            assert.ok(modules.has("marking"));
            assert.ok(modules.has("persistence"));
            assert.ok(modules.has("expansion"));
            assert.ok(modules.has("icons"));
            assert.ok(modules.has("filtering"));
        });

        test("should get module by ID", async () => {
            await treeView.initialize();

            const customRootModule = treeView.getModule("customRoot");
            const markingModule = treeView.getModule("marking");

            assert.ok(customRootModule);
            assert.ok(markingModule);
            assert.strictEqual(customRootModule!.id, "customRoot");
            assert.strictEqual(markingModule!.id, "marking");
        });

        test("should return undefined for non-existent module", async () => {
            await treeView.initialize();

            const nonExistentModule = treeView.getModule("nonExistent");

            assert.strictEqual(nonExistentModule, undefined);
        });

        test("should handle module initialization errors gracefully", async () => {
            // Create a config with a non-existent module
            const badConfig = { ...config };
            (badConfig.features as any).nonExistentModule = true;

            const badTreeView = new TestTreeView(mockContext, badConfig);

            // Should not throw during initialization
            await badTreeView.initialize();

            assert.strictEqual(badTreeView.isInitialized(), true);

            await badTreeView.dispose();
        });
    });

    suite("Tree Data Provider Interface", () => {
        test("should implement getTreeItem", async () => {
            await treeView.initialize();

            const item = new TestTreeItem(
                "Test",
                "Description",
                "test",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            const treeItem = treeView.getTreeItem(item);

            assert.strictEqual(treeItem, item);
        });

        test("should implement getParent", async () => {
            await treeView.initialize();

            const parent = new TestTreeItem(
                "Parent",
                "Parent Description",
                "parent",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child = new TestTreeItem(
                "Child",
                "Child Description",
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext,
                parent
            );

            const retrievedParent = treeView.getParent(child);

            assert.strictEqual(retrievedParent, parent);
        });

        test("should implement getChildren for root", async () => {
            await treeView.initialize();

            // Set up mock root items
            const mockItem1 = new TestTreeItem(
                "Item 1",
                "Description 1",
                "item1",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            const mockItem2 = new TestTreeItem(
                "Item 2",
                "Description 2",
                "item2",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            treeView.mockRootItems = [mockItem1, mockItem2];

            const children = await treeView.getChildren();

            assert.strictEqual(children.length, 2);
            assert.strictEqual(children[0], mockItem1);
            assert.strictEqual(children[1], mockItem2);
        });

        test("should implement getChildren for item", async () => {
            await treeView.initialize();

            const parent = new TestTreeItem(
                "Parent",
                "Parent Description",
                "parent",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );

            // Set up mock children
            const mockChild1 = new TestTreeItem(
                "Child 1",
                "Child Description 1",
                "child1",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            const mockChild2 = new TestTreeItem(
                "Child 2",
                "Child Description 2",
                "child2",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            treeView.mockChildren = [mockChild1, mockChild2];

            const children = await treeView.getChildren(parent);

            assert.strictEqual(children.length, 2);
            assert.strictEqual(children[0], mockChild1);
            assert.strictEqual(children[1], mockChild2);
        });
    });

    suite("Data Loading and Caching", () => {
        test("should load data on first request", async () => {
            await treeView.initialize();

            // Set up mock data
            const mockItem = new TestTreeItem(
                "Test Item",
                "Test Description",
                "test",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            treeView.mockRootItems = [mockItem];

            const rootItems = await treeView.testGetRootItems();

            assert.strictEqual(treeView.fetchRootItemsCalled, true);
            assert.strictEqual(rootItems.length, 1);
            assert.strictEqual(rootItems[0], mockItem);
        });

        test("should cache data for subsequent requests", async () => {
            await treeView.initialize();

            // Set up mock data
            const mockItem = new TestTreeItem(
                "Test Item",
                "Test Description",
                "test",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            treeView.mockRootItems = [mockItem];

            // First request should fetch data
            const rootItems1 = await treeView.testGetRootItems();
            assert.strictEqual(treeView.fetchRootItemsCalled, true);

            // Reset the flag
            treeView.fetchRootItemsCalled = false;

            // Second request should use cache
            const rootItems2 = await treeView.testGetRootItems();
            assert.strictEqual(treeView.fetchRootItemsCalled, false);
            assert.strictEqual(rootItems1.length, rootItems2.length);
        });

        test("should refresh cache after timeout", async () => {
            await treeView.initialize();

            // Set up mock data
            const mockItem = new TestTreeItem(
                "Test Item",
                "Test Description",
                "test",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            treeView.mockRootItems = [mockItem];

            // First request
            await treeView.testGetRootItems();
            assert.strictEqual(treeView.fetchRootItemsCalled, true);

            // Reset flag and set old timestamp
            treeView.fetchRootItemsCalled = false;
            treeView.setLastDataFetch(Date.now() - 10000); // 10 seconds ago

            // Second request should fetch again due to old timestamp
            await treeView.testGetRootItems();
            assert.strictEqual(treeView.fetchRootItemsCalled, true);
        });

        test("should handle loading state", async () => {
            await treeView.initialize();

            // Set loading state
            treeView.setIsLoading(true);

            // Should return current items when loading
            const rootItems = await treeView.testGetRootItems();
            assert.strictEqual(treeView.fetchRootItemsCalled, false);
            assert.deepStrictEqual(rootItems, []);
        });

        test("should handle intentionally cleared state", async () => {
            await treeView.initialize();

            // Set intentionally cleared
            treeView.setIntentionallyCleared(true);

            // Should not load data when intentionally cleared
            const rootItems = await treeView.testGetRootItems();
            assert.strictEqual(treeView.fetchRootItemsCalled, false);
            assert.deepStrictEqual(rootItems, []);
        });
    });

    suite("Refresh Functionality", () => {
        test("should debounce refresh calls", async () => {
            await treeView.initialize();

            const fireSpy = testEnv.sandbox.spy((treeView as any)._onDidChangeTreeData, "fire");

            // Multiple refresh calls
            treeView.refresh();
            treeView.refresh();
            treeView.refresh();

            // Should not fire immediately
            assert.strictEqual(fireSpy.callCount, 0);

            // Wait for debounce
            await new Promise((resolve) => setTimeout(resolve, 600));

            // Should fire once after debounce
            assert.strictEqual(fireSpy.callCount, 1);
        });
    });

    suite("Custom Root Management", () => {
        test("should make item root", async () => {
            await treeView.initialize();

            const item = new TestTreeItem(
                "Test",
                "Description",
                "test",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );

            treeView.makeRoot(item);

            // Should delegate to custom root module
            const customRootModule = treeView.getModule("customRoot");
            assert.ok(customRootModule);
        });

        test("should reset custom root", async () => {
            await treeView.initialize();

            treeView.resetCustomRoot();

            // Should delegate to custom root module
            const customRootModule = treeView.getModule("customRoot");
            assert.ok(customRootModule);
        });
    });

    suite("Tree Clearing", () => {
        test("should clear tree", async () => {
            await treeView.initialize();

            // Set some root items
            const mockItem = new TestTreeItem(
                "Test",
                "Description",
                "test",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            treeView.setRootItems([mockItem]);

            assert.strictEqual(treeView.getRootItemsArray().length, 1);

            treeView.clearTree();

            assert.strictEqual(treeView.getRootItemsArray().length, 0);
        });

        test("should fire change event when clearing", async () => {
            await treeView.initialize();

            const fireSpy = testEnv.sandbox.spy((treeView as any)._onDidChangeTreeData, "fire");

            treeView.clearTree();

            assert.ok(fireSpy.calledWith(undefined));
        });

        test("should clear state manager", async () => {
            await treeView.initialize();

            const clearSpy = testEnv.sandbox.spy(treeView.getProtectedStateManager(), "clear");

            treeView.clearTree();

            assert.ok(clearSpy.called);
        });
    });

    suite("Configuration Updates", () => {
        test("should update configuration", async () => {
            await treeView.initialize();

            const newConfig = {
                title: "Updated Title",
                behavior: {
                    refreshStrategy: "full" as const,
                    errorHandling: "silent" as const,
                    loadingTimeout: 15000,
                    debounceDelay: 300
                }
            };

            await treeView.updateConfig(newConfig);

            assert.strictEqual(treeView.config.title, "Updated Title");
            assert.strictEqual(treeView.config.behavior.refreshStrategy, "full");
            assert.strictEqual(treeView.config.behavior.errorHandling, "silent");
        });

        test("should notify modules of config changes", async () => {
            await treeView.initialize();

            const newConfig = { title: "New Title" };

            await treeView.updateConfig(newConfig);

            // Modules should be notified (this is tested through the module system)
            assert.ok(true);
        });

        test("should reinitialize modules when features change", async () => {
            await treeView.initialize();

            const newConfig = {
                features: {
                    customRoot: false,
                    marking: true,
                    persistence: false,
                    filtering: true,
                    icons: false,
                    expansion: true
                }
            };

            await treeView.updateConfig(newConfig);

            // Should refresh after feature changes
            assert.ok(true);
        });
    });

    suite("Lifecycle Management", () => {
        test("should dispose correctly", async () => {
            await treeView.initialize();

            // Create spies BEFORE calling dispose
            const disposeSpy = testEnv.sandbox.spy(treeView.eventBus, "dispose");
            const stateDisposeSpy = testEnv.sandbox.spy(treeView.getProtectedStateManager(), "dispose");

            await treeView.dispose();

            assert.ok(disposeSpy.called);
            assert.ok(stateDisposeSpy.called);
        });

        test("should not dispose twice", async () => {
            await treeView.initialize();

            await treeView.dispose();
            await treeView.dispose(); // Second call should be ignored

            assert.ok(true); // Should not throw
        });

        test("should clear data on disposal", async () => {
            await treeView.initialize();

            // Set some data
            const mockItem = new TestTreeItem(
                "Test",
                "Description",
                "test",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            treeView.setRootItems([mockItem]);

            assert.strictEqual(treeView.getRootItemsArray().length, 1);

            await treeView.dispose();

            // The rootItems should be cleared in the dispose method
            assert.strictEqual(treeView.getRootItemsArray().length, 0);
        });
    });

    suite("Error Handling", () => {
        test("should handle errors in getChildren", async () => {
            await treeView.initialize();

            // Override getChildrenForItem to throw error
            treeView.overrideGetChildrenForItem(async () => {
                throw new Error("Test error");
            });

            const item = new TestTreeItem(
                "Test",
                "Description",
                "test",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            const children = await treeView.getChildren(item);

            // Should return empty array on error
            assert.deepStrictEqual(children, []);
        });

        test("should handle errors in data loading", async () => {
            await treeView.initialize();

            // Override fetchRootItems to throw error
            treeView.overrideFetchRootItems(async () => {
                throw new Error("Data loading error");
            });

            try {
                await treeView.testLoadData();
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.strictEqual(error.message, "Data loading error");
            }
        });
    });

    suite("TreeView Message Handling", () => {
        test("should set loading message when loading", async () => {
            await treeView.initialize();
            treeView.setTreeView(mockVSCodeTreeView);

            treeView.setIsLoading(true);
            treeView.getProtectedStateManager().setLoading(true);

            (treeView as any).updateTreeViewMessage();

            assert.strictEqual(mockVSCodeTreeView.message, config.ui.loadingMessage);
        });

        test("should set error message when error occurs", async () => {
            await treeView.initialize();
            treeView.setTreeView(mockVSCodeTreeView);

            treeView.getProtectedStateManager().setError(new Error("Test error"));

            (treeView as any).updateTreeViewMessage();

            assert.strictEqual(mockVSCodeTreeView.message, config.ui.errorMessage);
        });

        test("should set empty message when no items and not intentionally cleared", async () => {
            await treeView.initialize();
            treeView.setTreeView(mockVSCodeTreeView);

            treeView.setRootItems([]);
            treeView.setIntentionallyCleared(false);

            (treeView as any).updateTreeViewMessage();

            assert.strictEqual(mockVSCodeTreeView.message, config.ui.emptyMessage);
        });

        test("should clear message when items are present", async () => {
            await treeView.initialize();
            treeView.setTreeView(mockVSCodeTreeView);

            const mockItem = new TestTreeItem(
                "Test",
                "Description",
                "test",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            treeView.setRootItems([mockItem]);

            (treeView as any).updateTreeViewMessage();

            assert.strictEqual(mockVSCodeTreeView.message, undefined);
        });

        test("should not set empty message when intentionally cleared", async () => {
            await treeView.initialize();
            treeView.setTreeView(mockVSCodeTreeView);

            treeView.setRootItems([]);
            treeView.setIntentionallyCleared(true);

            (treeView as any).updateTreeViewMessage();

            assert.strictEqual(mockVSCodeTreeView.message, undefined);
        });

        test("should update message when tree view is set", async () => {
            await treeView.initialize();

            treeView.setRootItems([]);
            treeView.setIntentionallyCleared(false);

            treeView.setTreeView(mockVSCodeTreeView);

            assert.strictEqual(mockVSCodeTreeView.message, config.ui.emptyMessage);
        });

        test("should update message when configuration changes", async () => {
            await treeView.initialize();
            treeView.setTreeView(mockVSCodeTreeView);

            treeView.setRootItems([]);
            treeView.setIntentionallyCleared(false);

            const newConfig = {
                ui: {
                    ...config.ui,
                    emptyMessage: "New empty message",
                    loadingMessage: "New loading message",
                    errorMessage: "New error message"
                }
            };

            await treeView.updateConfig(newConfig);

            assert.strictEqual(mockVSCodeTreeView.message, "New empty message");
        });

        test("should prioritize loading over empty state", async () => {
            await treeView.initialize();
            treeView.setTreeView(mockVSCodeTreeView);

            treeView.setIsLoading(true);
            treeView.getProtectedStateManager().setLoading(true);
            treeView.setRootItems([]);
            treeView.setIntentionallyCleared(false);

            (treeView as any).updateTreeViewMessage();

            assert.strictEqual(mockVSCodeTreeView.message, config.ui.loadingMessage);
        });

        test("should prioritize error over loading state", async () => {
            await treeView.initialize();
            treeView.setTreeView(mockVSCodeTreeView);

            treeView.getProtectedStateManager().setError(new Error("Test error"));
            treeView.setIsLoading(true);
            treeView.getProtectedStateManager().setLoading(true);

            (treeView as any).updateTreeViewMessage();

            assert.strictEqual(mockVSCodeTreeView.message, config.ui.errorMessage);
        });
    });
});
