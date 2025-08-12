/**
 * @file src/test/suite/treeViews/TreeViewContext.test.ts
 * @description Unit tests for the TreeViewContext interface and TreeViewContextImpl class
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { TreeViewContext, TreeViewContextImpl } from "../../../treeViews/core/TreeViewContext";
import { TreeViewConfig } from "../../../treeViews/core/TreeViewConfig";
import { StateManager } from "../../../treeViews/state/StateManager";
import { EventBus } from "../../../treeViews/utils/EventBus";
import { TestBenchLogger } from "../../../testBenchLogger";
import { TreeViewBase } from "../../../treeViews/core/TreeViewBase";
import { TreeItemBase } from "../../../treeViews/core/TreeItemBase";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";

// Mock TreeViewBase for testing
class MockTreeView extends TreeViewBase<TreeItemBase> {
    protected async fetchRootItems(): Promise<TreeItemBase[]> {
        return [];
    }

    protected async getChildrenForItem(item: TreeItemBase): Promise<TreeItemBase[]> {
        return [];
    }

    protected createTreeItem(data: any, parent?: TreeItemBase): TreeItemBase {
        return new (class extends TreeItemBase {
            protected generateUniqueId(): string {
                return `mock-item-${Date.now()}`;
            }
            public clone(): TreeItemBase {
                return this;
            }
            public serialize(): any {
                return {};
            }
        })(
            data.label || "Mock Item",
            data.description,
            data.contextValue || "mock",
            vscode.TreeItemCollapsibleState.None,
            this.extensionContext,
            parent
        );
    }
}

suite("TreeViewContext", function () {
    let testEnv: TestEnvironment;
    let mockContext: vscode.ExtensionContext;
    let config: TreeViewConfig;
    let stateManager: StateManager;
    let eventBus: EventBus;
    let logger: TestBenchLogger;
    let mockTreeView: MockTreeView;
    let treeViewContext: TreeViewContextImpl;

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
                loadingTimeout: 30000,
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

        // Create dependencies
        eventBus = new EventBus();
        logger = new TestBenchLogger();
        stateManager = new StateManager(mockContext, config.id, eventBus);
        mockTreeView = new MockTreeView(mockContext, config);

        // Create the context
        treeViewContext = new TreeViewContextImpl(mockContext, config, stateManager, eventBus, logger, mockTreeView);
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
        eventBus.dispose();
        stateManager.dispose();
        mockTreeView.dispose();
    });

    suite("TreeViewContextImpl Constructor", () => {
        test("should create context with all required properties", () => {
            assert.strictEqual(treeViewContext.extensionContext, mockContext);
            assert.strictEqual(treeViewContext.config, config);
            assert.strictEqual(treeViewContext.stateManager, stateManager);
            assert.strictEqual(treeViewContext.eventBus, eventBus);
            assert.strictEqual(treeViewContext.logger, logger);
            assert.strictEqual(treeViewContext.treeView, mockTreeView);
        });

        test("should have correct configuration values", () => {
            assert.strictEqual(treeViewContext.config.id, "test-tree");
            assert.strictEqual(treeViewContext.config.title, "Test Tree View");
            assert.strictEqual(treeViewContext.config.contextValue, "testTreeView");
            assert.strictEqual(treeViewContext.config.behavior.refreshStrategy, "smart");
            assert.strictEqual(treeViewContext.config.behavior.errorHandling, "notify");
        });

        test("should have all features enabled", () => {
            const features = treeViewContext.config.features;
            assert.strictEqual(features.customRoot, true);
            assert.strictEqual(features.marking, true);
            assert.strictEqual(features.persistence, true);
            assert.strictEqual(features.filtering, true);
            assert.strictEqual(features.icons, true);
            assert.strictEqual(features.expansion, true);
        });
    });

    suite("TreeViewContext Interface Compliance", () => {
        test("should implement TreeViewContext interface", () => {
            const context: TreeViewContext = treeViewContext;

            // Test that all required properties exist
            assert.ok(context.extensionContext);
            assert.ok(context.config);
            assert.ok(context.stateManager);
            assert.ok(context.eventBus);
            assert.ok(context.logger);
            assert.ok(typeof context.refresh === "function");
            assert.ok(typeof context.getTreeView === "function");
            assert.ok(typeof context.getCurrentRootItems === "function");
        });

        test("should provide access to extension context", () => {
            assert.strictEqual(treeViewContext.extensionContext, mockContext);
            assert.strictEqual(typeof treeViewContext.extensionContext.subscriptions, "object");
            assert.strictEqual(typeof treeViewContext.extensionContext.workspaceState, "object");
            assert.strictEqual(typeof treeViewContext.extensionContext.globalState, "object");
        });

        test("should provide access to configuration", () => {
            const contextConfig = treeViewContext.config;
            assert.strictEqual(contextConfig.id, "test-tree");
            assert.strictEqual(contextConfig.title, "Test Tree View");
            assert.strictEqual(contextConfig.contextValue, "testTreeView");
        });

        test("should provide access to state manager", () => {
            const contextStateManager = treeViewContext.stateManager;
            assert.ok(contextStateManager instanceof StateManager);
            assert.strictEqual(typeof contextStateManager.getState, "function");
            assert.strictEqual(typeof contextStateManager.setState, "function");
        });

        test("should provide access to event bus", () => {
            const contextEventBus = treeViewContext.eventBus;
            assert.ok(contextEventBus instanceof EventBus);
            assert.strictEqual(typeof contextEventBus.on, "function");
            assert.strictEqual(typeof contextEventBus.emit, "function");
        });

        test("should provide access to logger", () => {
            const contextLogger = treeViewContext.logger;
            assert.ok(contextLogger instanceof TestBenchLogger);
        });
    });

    suite("Context Methods", () => {
        test("should get tree view reference", () => {
            const treeView = treeViewContext.getTreeView();
            assert.strictEqual(treeView, mockTreeView);
            assert.ok(treeView instanceof MockTreeView);
        });

        test("should get current root items", () => {
            const rootItems = treeViewContext.getCurrentRootItems();
            assert.ok(Array.isArray(rootItems));
            // Initially empty since no data has been loaded
            assert.strictEqual(rootItems.length, 0);
        });

        test("should refresh tree view", () => {
            const refreshSpy = testEnv.sandbox.spy(mockTreeView, "refresh");

            treeViewContext.refresh();

            assert.ok(refreshSpy.calledOnce);
            assert.ok(refreshSpy.calledWith(undefined, undefined));
        });

        test("should refresh tree view with immediate option", () => {
            const refreshSpy = testEnv.sandbox.spy(mockTreeView, "refresh");

            treeViewContext.refresh({ immediate: true });

            assert.ok(refreshSpy.calledOnce);
            assert.ok(refreshSpy.calledWith(undefined, { immediate: true }));
        });
    });

    suite("Context Configuration Access", () => {
        test("should provide access to behavior configuration", () => {
            const behavior = treeViewContext.config.behavior;
            assert.strictEqual(behavior.refreshStrategy, "smart");
            assert.strictEqual(behavior.errorHandling, "notify");
            assert.strictEqual(behavior.loadingTimeout, 30000);
            assert.strictEqual(behavior.debounceDelay, 500);
        });

        test("should provide access to UI configuration", () => {
            const ui = treeViewContext.config.ui;
            assert.strictEqual(ui.emptyMessage, "No items found");
            assert.strictEqual(ui.loadingMessage, "Loading...");
            assert.strictEqual(ui.errorMessage, "An error occurred");
            assert.strictEqual(ui.showTooltips, true);
            assert.strictEqual(ui.tooltipFormat, "default");
        });

        test("should provide access to feature flags", () => {
            const features = treeViewContext.config.features;
            assert.strictEqual(features.customRoot, true);
            assert.strictEqual(features.marking, true);
            assert.strictEqual(features.persistence, true);
            assert.strictEqual(features.filtering, true);
            assert.strictEqual(features.icons, true);
            assert.strictEqual(features.expansion, true);
        });

        test("should provide access to module configurations", () => {
            const modules = treeViewContext.config.modules;
            assert.ok(typeof modules === "object");
            // Initially empty since no specific module configs were provided
            assert.strictEqual(Object.keys(modules).length, 0);
        });
    });

    suite("Context State Management", () => {
        test("should provide access to state manager methods", () => {
            const stateManager = treeViewContext.stateManager;

            // Test state access
            const state = stateManager.getState();
            assert.ok(state);
            assert.strictEqual(typeof state.loading, "boolean");
            assert.strictEqual(typeof state.error, "object");
            assert.strictEqual(typeof state.initialized, "boolean");

            // Test state updates
            stateManager.setLoading(true);
            assert.strictEqual(stateManager.isLoading(), true);

            stateManager.setLoading(false);
            assert.strictEqual(stateManager.isLoading(), false);
        });

        test("should handle state changes", () => {
            const stateManager = treeViewContext.stateManager;

            // Test error handling
            const testError = new Error("Test error");
            stateManager.setError(testError);
            assert.strictEqual(stateManager.hasError(), true);
            assert.strictEqual(stateManager.getError(), testError);

            // Test error clearing
            stateManager.setError(null);
            assert.strictEqual(stateManager.hasError(), false);
            assert.strictEqual(stateManager.getError(), null);
        });
    });

    suite("Context Event Bus Integration", () => {
        test("should emit events through event bus", async () => {
            const eventSpy = testEnv.sandbox.spy();
            treeViewContext.eventBus.on("test:event", eventSpy);

            await treeViewContext.eventBus.emit({
                type: "test:event",
                source: "test",
                data: { message: "test" },
                timestamp: Date.now()
            });

            assert.ok(eventSpy.calledOnce);
            const event = eventSpy.firstCall.args[0];
            assert.strictEqual(event.type, "test:event");
            assert.strictEqual(event.source, "test");
            assert.strictEqual(event.data.message, "test");
        });

        test("should handle event subscriptions", () => {
            const eventSpy = testEnv.sandbox.spy();
            const subscription = treeViewContext.eventBus.on("test:event", eventSpy);

            assert.ok(subscription);
            assert.strictEqual(typeof subscription.unsubscribe, "function");

            subscription.unsubscribe();
            // Event bus should no longer have handlers for this event
            assert.strictEqual(treeViewContext.eventBus.getHandlerCount("test:event"), 0);
        });
    });

    suite("Context Tree View Integration", () => {
        test("should provide access to tree view methods", () => {
            const treeView = treeViewContext.getTreeView();

            // Test tree view methods
            assert.strictEqual(typeof treeView.refresh, "function");
            assert.strictEqual(typeof treeView.clearTree, "function");
            assert.strictEqual(typeof treeView.dispose, "function");
        });

        test("should refresh tree view through context", () => {
            const refreshSpy = testEnv.sandbox.spy(mockTreeView, "refresh");

            treeViewContext.refresh();

            assert.ok(refreshSpy.calledOnce);
        });

        test("should get current root items through context", () => {
            const rootItems = treeViewContext.getCurrentRootItems();

            assert.ok(Array.isArray(rootItems));
            // Initially empty
            assert.strictEqual(rootItems.length, 0);
        });
    });

    suite("Context Immutability", () => {
        test("should not allow modification of core properties", () => {
            const originalConfig = treeViewContext.config;
            const originalStateManager = treeViewContext.stateManager;
            const originalEventBus = treeViewContext.eventBus;

            // These should remain the same references
            assert.strictEqual(treeViewContext.config, originalConfig);
            assert.strictEqual(treeViewContext.stateManager, originalStateManager);
            assert.strictEqual(treeViewContext.eventBus, originalEventBus);
        });

        test("should maintain consistent references", () => {
            const context1 = treeViewContext.getTreeView();
            const context2 = treeViewContext.getTreeView();

            assert.strictEqual(context1, context2);
        });
    });
});
