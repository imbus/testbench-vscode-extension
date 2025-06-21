/**
 * @file src/test/suite/treeViews/ModuleRegistry.test.ts
 * @description Unit tests for the ModuleRegistry class
 */

import * as assert from "assert";
import { ModuleRegistry, ModuleFactory } from "../../../treeViews/core/ModuleRegistry";
import { TreeViewModule } from "../../../treeViews/core/TreeViewModule";
import { TreeViewContext } from "../../../treeViews/core/TreeViewContext";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";

// Mock module for testing
class MockModule implements TreeViewModule {
    public readonly id: string;
    private _initialized: boolean = false;
    private _disposed: boolean = false;

    constructor(id: string) {
        this.id = id;
    }

    public async initialize(context: TreeViewContext): Promise<void> {
        this._initialized = true;
    }

    public dispose(): void {
        this._disposed = true;
    }

    public get initialized(): boolean {
        return this._initialized;
    }

    public get disposed(): boolean {
        return this._disposed;
    }
}

// Mock module factory for testing
class MockModuleFactory {
    public static createModule(id: string): MockModule {
        return new MockModule(id);
    }

    public static createFailingModule(id: string): MockModule {
        throw new Error(`Failed to create module: ${id}`);
    }
}

suite("ModuleRegistry", function () {
    let testEnv: TestEnvironment;

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("Module Registry Initialization", () => {
        test("should have built-in modules registered", () => {
            const registeredModules = ModuleRegistry.getRegisteredModules();

            // Check that built-in modules are registered
            assert.ok(registeredModules.includes("customRoot"), "customRoot module should be registered");
            assert.ok(registeredModules.includes("marking"), "marking module should be registered");
            assert.ok(registeredModules.includes("persistence"), "persistence module should be registered");
            assert.ok(registeredModules.includes("expansion"), "expansion module should be registered");
            assert.ok(registeredModules.includes("icons"), "icons module should be registered");
            assert.ok(registeredModules.includes("filtering"), "filtering module should be registered");
        });

        test("should have correct number of built-in modules", () => {
            const registeredModules = ModuleRegistry.getRegisteredModules();

            // Should have 6 built-in modules
            assert.strictEqual(registeredModules.length, 6);
        });

        test("should check if modules are registered", () => {
            assert.strictEqual(ModuleRegistry.hasModule("customRoot"), true);
            assert.strictEqual(ModuleRegistry.hasModule("marking"), true);
            assert.strictEqual(ModuleRegistry.hasModule("persistence"), true);
            assert.strictEqual(ModuleRegistry.hasModule("expansion"), true);
            assert.strictEqual(ModuleRegistry.hasModule("icons"), true);
            assert.strictEqual(ModuleRegistry.hasModule("filtering"), true);

            // Non-existent modules should return false
            assert.strictEqual(ModuleRegistry.hasModule("nonExistentModule"), false);
        });
    });

    suite("Module Registration", () => {
        test("should register new module factory", () => {
            const moduleName = "test-module";
            const factory: ModuleFactory = () => MockModuleFactory.createModule(moduleName);

            // Initially not registered
            assert.strictEqual(ModuleRegistry.hasModule(moduleName), false);

            // Register the module
            ModuleRegistry.register(moduleName, factory);

            // Should now be registered
            assert.strictEqual(ModuleRegistry.hasModule(moduleName), true);
            assert.ok(ModuleRegistry.getRegisteredModules().includes(moduleName));
        });

        test("should override existing module factory", () => {
            const moduleName = "customRoot"; // Use existing module name
            const customFactory: ModuleFactory = () => MockModuleFactory.createModule("custom-root-override");

            // Should be registered initially
            assert.strictEqual(ModuleRegistry.hasModule(moduleName), true);

            // Register custom factory
            ModuleRegistry.register(moduleName, customFactory);

            // Should still be registered
            assert.strictEqual(ModuleRegistry.hasModule(moduleName), true);

            // Create module should use custom factory
            const module = ModuleRegistry.create(moduleName);
            assert.ok(module);
            assert.strictEqual(module!.id, "custom-root-override");
        });

        test("should register multiple modules", () => {
            const modules = ["module1", "module2", "module3"];

            modules.forEach((moduleName, index) => {
                const factory: ModuleFactory = () => MockModuleFactory.createModule(`${moduleName}-${index}`);
                ModuleRegistry.register(moduleName, factory);
            });

            modules.forEach((moduleName) => {
                assert.strictEqual(ModuleRegistry.hasModule(moduleName), true);
            });
        });
    });

    suite("Module Creation", () => {
        test("should create module instance", () => {
            const moduleName = "test-create";
            const factory: ModuleFactory = () => MockModuleFactory.createModule(moduleName);

            ModuleRegistry.register(moduleName, factory);

            const module = ModuleRegistry.create(moduleName);

            assert.ok(module);
            assert.ok(module instanceof MockModule);
            assert.strictEqual(module!.id, moduleName);
        });

        test("should return null for non-existent module", () => {
            const module = ModuleRegistry.create("non-existent-module");

            assert.strictEqual(module, null);
        });

        test("should handle factory errors gracefully", () => {
            const moduleName = "failing-module";
            const failingFactory: ModuleFactory = () => MockModuleFactory.createFailingModule(moduleName);

            ModuleRegistry.register(moduleName, failingFactory);

            const module = ModuleRegistry.create(moduleName);

            assert.strictEqual(module, null);
        });

        test("should create different instances for each call", () => {
            const moduleName = "unique-module";
            const factory: ModuleFactory = () => MockModuleFactory.createModule(moduleName);

            ModuleRegistry.register(moduleName, factory);

            const module1 = ModuleRegistry.create(moduleName);
            const module2 = ModuleRegistry.create(moduleName);

            assert.ok(module1);
            assert.ok(module2);
            assert.notStrictEqual(module1, module2); // Different instances
            assert.strictEqual(module1!.id, module2!.id); // Same ID
        });

        test("should create built-in modules", () => {
            const builtInModules = ["customRoot", "marking", "persistence", "expansion", "icons", "filtering"];

            builtInModules.forEach((moduleName) => {
                const module = ModuleRegistry.create(moduleName);
                assert.ok(module, `Should create ${moduleName} module`);
                assert.strictEqual(typeof module!.initialize, "function");
                assert.strictEqual(typeof module!.dispose, "function");
            });
        });
    });

    suite("Module Factory Management", () => {
        test("should store and retrieve factory functions", () => {
            const moduleName = "factory-test";
            let factoryCalled = false;

            const factory: ModuleFactory = () => {
                factoryCalled = true;
                return MockModuleFactory.createModule(moduleName);
            };

            ModuleRegistry.register(moduleName, factory);

            // Factory should not be called yet
            assert.strictEqual(factoryCalled, false);

            // Create module should call factory
            const module = ModuleRegistry.create(moduleName);

            assert.strictEqual(factoryCalled, true);
            assert.ok(module);
        });

        test("should handle factory that returns null", () => {
            const moduleName = "null-factory";
            const nullFactory: ModuleFactory = () => null as any;

            ModuleRegistry.register(moduleName, nullFactory);

            const module = ModuleRegistry.create(moduleName);

            assert.strictEqual(module, null);
        });

        test("should handle factory that throws error", () => {
            const moduleName = "error-factory";
            const errorFactory: ModuleFactory = () => {
                throw new Error("Factory error");
            };

            ModuleRegistry.register(moduleName, errorFactory);

            const module = ModuleRegistry.create(moduleName);

            assert.strictEqual(module, null);
        });
    });

    suite("Enabled Modules Creation", () => {
        test("should create enabled modules from feature configuration", () => {
            const features = {
                customRoot: true,
                marking: true,
                persistence: false,
                filtering: true,
                icons: false,
                expansion: true
            };

            const modules = ModuleRegistry.createEnabledModules(features);

            // Should create modules for enabled features
            assert.strictEqual(modules.size, 4);
            assert.ok(modules.has("customRoot"));
            assert.ok(modules.has("marking"));
            assert.ok(modules.has("filtering"));
            assert.ok(modules.has("expansion"));

            // Should not create modules for disabled features
            assert.ok(!modules.has("persistence"));
            assert.ok(!modules.has("icons"));
        });

        test("should create all modules when all features enabled", () => {
            const features = {
                customRoot: true,
                marking: true,
                persistence: true,
                filtering: true,
                icons: true,
                expansion: true
            };

            const modules = ModuleRegistry.createEnabledModules(features);

            assert.strictEqual(modules.size, 6);
            assert.ok(modules.has("customRoot"));
            assert.ok(modules.has("marking"));
            assert.ok(modules.has("persistence"));
            assert.ok(modules.has("filtering"));
            assert.ok(modules.has("icons"));
            assert.ok(modules.has("expansion"));
        });

        test("should create no modules when all features disabled", () => {
            const features = {
                customRoot: false,
                marking: false,
                persistence: false,
                filtering: false,
                icons: false,
                expansion: false
            };

            const modules = ModuleRegistry.createEnabledModules(features);

            assert.strictEqual(modules.size, 0);
        });

        test("should handle non-existent modules in feature configuration", () => {
            const features = {
                customRoot: true,
                marking: true,
                nonExistentModule: true, // This module doesn't exist
                filtering: true
            };

            const modules = ModuleRegistry.createEnabledModules(features);

            // Should only create existing modules
            assert.strictEqual(modules.size, 3);
            assert.ok(modules.has("customRoot"));
            assert.ok(modules.has("marking"));
            assert.ok(modules.has("filtering"));
            assert.ok(!modules.has("nonExistentModule"));
        });

        test("should handle mixed enabled/disabled features", () => {
            const features = {
                customRoot: true,
                marking: false,
                persistence: true,
                filtering: false,
                icons: true,
                expansion: false
            };

            const modules = ModuleRegistry.createEnabledModules(features);

            assert.strictEqual(modules.size, 3);
            assert.ok(modules.has("customRoot"));
            assert.ok(modules.has("persistence"));
            assert.ok(modules.has("icons"));

            assert.ok(!modules.has("marking"));
            assert.ok(!modules.has("filtering"));
            assert.ok(!modules.has("expansion"));
        });
    });

    suite("Module Registry Information", () => {
        test("should get all registered module names", () => {
            const registeredModules = ModuleRegistry.getRegisteredModules();

            assert.ok(Array.isArray(registeredModules));
            assert.ok(registeredModules.length > 0);

            // All module names should be strings
            registeredModules.forEach((moduleName) => {
                assert.strictEqual(typeof moduleName, "string");
                assert.ok(moduleName.length > 0);
            });
        });

        test("should return unique module names", () => {
            const registeredModules = ModuleRegistry.getRegisteredModules();
            const uniqueModules = new Set(registeredModules);

            assert.strictEqual(registeredModules.length, uniqueModules.size);
        });

        test("should handle empty registry", () => {
            // This test is theoretical since the registry is pre-populated
            // But we can test the behavior with a fresh registry concept
            const registeredModules = ModuleRegistry.getRegisteredModules();

            // Should at least have the built-in modules
            assert.ok(registeredModules.length >= 6);
        });
    });

    suite("Error Handling", () => {
        test("should handle factory that creates invalid module", () => {
            const moduleName = "invalid-module";
            const invalidFactory: ModuleFactory = () => {
                return {} as TreeViewModule; // Invalid module without required properties
            };

            ModuleRegistry.register(moduleName, invalidFactory);

            const module = ModuleRegistry.create(moduleName);

            // Should return the module even if it's invalid
            assert.ok(module);
            assert.strictEqual(typeof module!.id, "undefined"); // Missing id property
        });

        test("should handle factory that creates module with missing methods", () => {
            const moduleName = "incomplete-module";
            const incompleteFactory: ModuleFactory = () => {
                return {
                    id: moduleName
                    // Missing initialize and dispose methods
                } as TreeViewModule;
            };

            ModuleRegistry.register(moduleName, incompleteFactory);

            const module = ModuleRegistry.create(moduleName);

            assert.ok(module);
            assert.strictEqual(module!.id, moduleName);
            assert.strictEqual(typeof module!.initialize, "undefined");
            assert.strictEqual(typeof module!.dispose, "undefined");
        });
    });

    suite("Module Registry Persistence", () => {
        test("should maintain registered modules across calls", () => {
            const moduleName = "persistent-module";
            const factory: ModuleFactory = () => MockModuleFactory.createModule(moduleName);

            // Register module
            ModuleRegistry.register(moduleName, factory);
            assert.strictEqual(ModuleRegistry.hasModule(moduleName), true);

            // Check again
            assert.strictEqual(ModuleRegistry.hasModule(moduleName), true);

            // Create module
            const module = ModuleRegistry.create(moduleName);
            assert.ok(module);

            // Should still be registered
            assert.strictEqual(ModuleRegistry.hasModule(moduleName), true);
        });

        test("should maintain built-in modules", () => {
            const builtInModules = ["customRoot", "marking", "persistence", "expansion", "icons", "filtering"];

            // Check that built-in modules are always available
            builtInModules.forEach((moduleName) => {
                assert.strictEqual(ModuleRegistry.hasModule(moduleName), true);
            });

            // Check again after some operations
            builtInModules.forEach((moduleName) => {
                assert.strictEqual(ModuleRegistry.hasModule(moduleName), true);
            });
        });
    });
});
