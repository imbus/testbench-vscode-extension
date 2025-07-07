/**
 * @file src/treeViews/core/ModuleRegistry.ts
 * @description Registry for managing tree view modules.
 */

import { TreeViewModule } from "./TreeViewModule";
import { CustomRootModule } from "../features/CustomRootModule";
import { MarkingModule } from "../features/MarkingModule";
import { PersistenceModule } from "../features/PersistenceModule";
import { ExpansionModule } from "../features/ExpansionModule";
import { IconModule } from "../features/IconModule";
import { FilteringModule } from "../features/FilteringModule";

/**
 * Module factory function type
 */
export type ModuleFactory = () => TreeViewModule;

/**
 * Registry of all available modules
 */
export class ModuleRegistry {
    private static factories: Map<string, ModuleFactory> = ModuleRegistry.initializeFactories();

    /**
     * Initialize the factories map
     */
    private static initializeFactories(): Map<string, ModuleFactory> {
        const map = new Map<string, ModuleFactory>();

        map.set("customRoot", () => new CustomRootModule());
        map.set("marking", () => new MarkingModule());
        map.set("persistence", () => new PersistenceModule());
        map.set("expansion", () => new ExpansionModule());
        map.set("icons", () => new IconModule());
        map.set("filtering", () => new FilteringModule());

        return map;
    }

    /**
     * Register a new module factory
     */
    public static register(name: string, factory: ModuleFactory): void {
        this.factories.set(name, factory);
    }

    /**
     * Creates a new module instance using the factory for the given module name.
     * @param name - The name of the module to create
     * @returns The created module instance or null if creation fails
     */
    public static create(name: string): TreeViewModule | null {
        const factory = this.factories.get(name);
        if (!factory) {
            console.warn(`Module factory not found: ${name}`);
            return null;
        }

        try {
            return factory();
        } catch (error) {
            console.error(`Failed to create module ${name}:`, error);
            return null;
        }
    }

    /**
     * Retrieves all registered module names
     * @return Array of module names that are currently registered
     */
    public static getRegisteredModules(): string[] {
        return Array.from(this.factories.keys());
    }

    /**
     * Checks if a module is registered
     * @param name The name of the module to check
     * @return true if the module is registered, false otherwise
     */
    public static hasModule(name: string): boolean {
        return this.factories.has(name);
    }

    /**
     * Creates module instances for enabled features
     * @param features - Configuration object mapping feature names to enabled state
     * @return Map of feature names to their corresponding module instances
     */
    public static createEnabledModules(features: Record<string, boolean>): Map<string, TreeViewModule> {
        const modules = new Map<string, TreeViewModule>();

        for (const [featureName, isEnabled] of Object.entries(features)) {
            if (isEnabled && this.hasModule(featureName)) {
                const module = this.create(featureName);
                if (module) {
                    modules.set(featureName, module);
                }
            }
        }

        return modules;
    }
}
