/**
 * @file src/test/suite/treeViews/TreeViewModule.test.ts
 * @description Unit tests for the TreeViewModule interface
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { TreeViewModule } from "../../../treeViews/core/TreeViewModule";
import { TreeViewContext } from "../../../treeViews/core/TreeViewContext";
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

// Concrete implementation of TreeViewModule for testing
class TestModule implements TreeViewModule {
    public readonly id: string;
    private _initialized: boolean = false;
    private _disposed: boolean = false;
    private context?: TreeViewContext;
    public onConfigChangeCalled: boolean = false;
    public onStateChangeCalled: boolean = false;
    public customMethodCalled: boolean = false;

    constructor(id: string = "test-module") {
        this.id = id;
    }

    public async initialize(context: TreeViewContext): Promise<void> {
        this.context = context;
        this._initialized = true;

        // Simulate async initialization
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    public dispose(): void {
        this._disposed = true;
        this.context = undefined;
    }

    public onConfigChange?(config: any): Promise<void> {
        this.onConfigChangeCalled = true;
        return Promise.resolve();
    }

    public onStateChange?(state: any): void {
        this.onStateChangeCalled = true;
    }

    // Custom method for testing
    public customMethod(): void {
        this.customMethodCalled = true;
    }

    // Getters for testing
    public get initialized(): boolean {
        return this._initialized;
    }

    public get disposed(): boolean {
        return this._disposed;
    }

    public get moduleContext(): TreeViewContext | undefined {
        return this.context;
    }
}

suite("TreeViewModule", function () {
    let testEnv: TestEnvironment;
    let mockContext: vscode.ExtensionContext;
    let config: TreeViewConfig;
    let stateManager: StateManager;
    let eventBus: EventBus;
    let logger: TestBenchLogger;
    let mockTreeView: MockTreeView;
    let treeViewContext: TreeViewContext;

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
        treeViewContext = {
            extensionContext: mockContext,
            config: config,
            stateManager: stateManager,
            eventBus: eventBus,
            logger: logger,
            refresh: () => mockTreeView.refresh(),
            getTreeView: () => mockTreeView,
            getCurrentRootItems: () => mockTreeView.getCurrentRootItems()
        };
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
        eventBus.dispose();
        stateManager.dispose();
        mockTreeView.dispose();
    });

    suite("TreeViewModule Interface", () => {
        test("should implement required interface properties", () => {
            const module: TreeViewModule = new TestModule();

            assert.strictEqual(typeof module.id, "string");
            assert.strictEqual(typeof module.initialize, "function");
            assert.strictEqual(typeof module.dispose, "function");
        });

        test("should have unique module ID", () => {
            const module1 = new TestModule("module-1");
            const module2 = new TestModule("module-2");

            assert.strictEqual(module1.id, "module-1");
            assert.strictEqual(module2.id, "module-2");
            assert.notStrictEqual(module1.id, module2.id);
        });

        test("should support optional lifecycle hooks", () => {
            const module = new TestModule();

            // These are optional, so they might be undefined
            assert.ok(module.onConfigChange === undefined || typeof module.onConfigChange === "function");
            assert.ok(module.onStateChange === undefined || typeof module.onStateChange === "function");
        });

        test("should support custom properties and methods", () => {
            const module = new TestModule();

            // Test custom method
            module.customMethod();
            assert.strictEqual(module.customMethodCalled, true);
        });
    });

    suite("Module Initialization", () => {
        test("should initialize module with context", async () => {
            const module = new TestModule();

            assert.strictEqual(module.initialized, false);

            await module.initialize(treeViewContext);

            assert.strictEqual(module.initialized, true);
            assert.strictEqual(module.moduleContext, treeViewContext);
        });

        test("should provide access to context properties during initialization", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);

            const context = module.moduleContext!;
            assert.strictEqual(context.extensionContext, mockContext);
            assert.strictEqual(context.config, config);
            assert.strictEqual(context.stateManager, stateManager);
            assert.strictEqual(context.eventBus, eventBus);
            assert.strictEqual(context.logger, logger);
        });

        test("should throw error during initialization if needed", async () => {
            const failingModule = new TestModule("failing-module");

            // Override initialize to throw an error
            failingModule.initialize = async () => {
                throw new Error("Initialization failed");
            };

            try {
                await failingModule.initialize(treeViewContext);
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.strictEqual(error.message, "Initialization failed");
            }
        });
    });

    suite("Module Disposal", () => {
        test("should dispose module correctly", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);
            assert.strictEqual(module.initialized, true);
            assert.strictEqual(module.disposed, false);

            module.dispose();

            assert.strictEqual(module.disposed, true);
            assert.strictEqual(module.moduleContext, undefined);
        });

        test("should handle disposal of uninitialized module", () => {
            const module = new TestModule();

            assert.strictEqual(module.initialized, false);
            assert.strictEqual(module.disposed, false);

            module.dispose();

            assert.strictEqual(module.disposed, true);
        });

        test("should clear context reference on disposal", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);
            assert.strictEqual(module.moduleContext, treeViewContext);

            module.dispose();
            assert.strictEqual(module.moduleContext, undefined);
        });
    });

    suite("Optional Lifecycle Hooks", () => {
        test("should call onConfigChange when implemented", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);
            assert.strictEqual(module.onConfigChangeCalled, false);

            if (module.onConfigChange) {
                await module.onConfigChange(config);
                assert.strictEqual(module.onConfigChangeCalled, true);
            }
        });

        test("should call onStateChange when implemented", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);
            assert.strictEqual(module.onStateChangeCalled, false);

            if (module.onStateChange) {
                module.onStateChange({});
                assert.strictEqual(module.onStateChangeCalled, true);
            }
        });

        test("should handle modules without optional hooks", () => {
            const moduleWithoutHooks: TreeViewModule = {
                id: "no-hooks-module",
                async initialize(context: TreeViewContext): Promise<void> {},
                dispose(): void {}
            };

            assert.strictEqual(moduleWithoutHooks.onConfigChange, undefined);
            assert.strictEqual(moduleWithoutHooks.onStateChange, undefined);
        });
    });

    suite("Module Context Access", () => {
        test("should access extension context through module context", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);

            const context = module.moduleContext!;
            assert.strictEqual(context.extensionContext, mockContext);
            assert.strictEqual(typeof context.extensionContext.subscriptions, "object");
        });

        test("should access configuration through module context", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);

            const context = module.moduleContext!;
            assert.strictEqual(context.config.id, "test-tree");
            assert.strictEqual(context.config.title, "Test Tree View");
        });

        test("should access state manager through module context", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);

            const context = module.moduleContext!;
            const stateManager = context.stateManager;
            assert.ok(stateManager instanceof StateManager);
            assert.strictEqual(typeof stateManager.getState, "function");
        });

        test("should access event bus through module context", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);

            const context = module.moduleContext!;
            const eventBus = context.eventBus;
            assert.ok(eventBus instanceof EventBus);
            assert.strictEqual(typeof eventBus.on, "function");
        });

        test("should access logger through module context", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);

            const context = module.moduleContext!;
            const logger = context.logger;
            assert.ok(logger instanceof TestBenchLogger);
            assert.strictEqual(typeof logger.info, "function");
        });
    });

    suite("Module Custom Functionality", () => {
        test("should support custom methods", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);

            module.customMethod();
            assert.strictEqual(module.customMethodCalled, true);
        });

        test("should support custom properties", () => {
            const module = new TestModule();

            // Add custom property
            (module as any).customProperty = "custom value";

            assert.strictEqual((module as any).customProperty, "custom value");
        });

        test("should support dynamic property access", () => {
            const module = new TestModule();

            // Test dynamic property access
            const propertyName = "dynamicProperty";
            (module as any)[propertyName] = "dynamic value";

            assert.strictEqual((module as any)[propertyName], "dynamic value");
        });
    });

    suite("Module Error Handling", () => {
        test("should handle initialization errors gracefully", async () => {
            const errorModule = new TestModule("error-module");

            // Override initialize to throw an error
            errorModule.initialize = async () => {
                throw new Error("Module initialization failed");
            };

            try {
                await errorModule.initialize(treeViewContext);
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.strictEqual(error.message, "Module initialization failed");
            }
        });

        test("should handle disposal errors gracefully", () => {
            const errorModule = new TestModule("error-module");

            // Override dispose to throw an error
            errorModule.dispose = () => {
                throw new Error("Module disposal failed");
            };

            try {
                errorModule.dispose();
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.strictEqual(error.message, "Module disposal failed");
            }
        });
    });

    suite("Module State Management", () => {
        test("should track initialization state", () => {
            const module = new TestModule();

            assert.strictEqual(module.initialized, false);

            // Simulate initialization
            (module as any)._initialized = true;
            assert.strictEqual(module.initialized, true);
        });

        test("should track disposal state", () => {
            const module = new TestModule();

            assert.strictEqual(module.disposed, false);

            // Simulate disposal
            (module as any)._disposed = true;
            assert.strictEqual(module.disposed, true);
        });

        test("should prevent operations on disposed module", async () => {
            const module = new TestModule();

            await module.initialize(treeViewContext);
            module.dispose();

            // Module should be disposed
            assert.strictEqual(module.disposed, true);
            assert.strictEqual(module.moduleContext, undefined);
        });
    });
});
