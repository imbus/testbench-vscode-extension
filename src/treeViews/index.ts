/**
 * @file src/treeViews/index.ts
 * @description Main entry point for the tree framework. Exports all public APIs.
 */

// Core exports
export { TreeViewBase } from "./core/TreeViewBase";
export { TreeItemBase } from "./core/TreeItemBase";
export { TreeViewConfig } from "./core/TreeViewConfig";
export { TreeViewContext, TreeViewContextImpl } from "./core/TreeViewContext";
export { TreeViewModule } from "./core/TreeViewModule";
export { ModuleRegistry } from "./core/ModuleRegistry";

// Implementation exports
export { ProjectsTreeView } from "./implementations/projects/ProjectsTreeView";
export { ProjectsTreeItem } from "./implementations/projects/ProjectsTreeItem";
export { projectsConfig } from "./implementations/projects/ProjectsConfig";

export { TestThemesTreeView } from "./implementations/testThemes/TestThemesTreeView";
export { TestThemesTreeItem } from "./implementations/testThemes/TestThemesTreeItem";
export { testThemesConfig } from "./implementations/testThemes/TestThemesConfig";

export { TestElementsTreeView } from "./implementations/testElements/TestElementsTreeView";
export { TestElementsTreeItem } from "./implementations/testElements/TestElementsTreeItem";
export { testElementsConfig } from "./implementations/testElements/TestElementsConfig";

// State exports
export { StateManager } from "./state/StateManager";
export * from "./state/StateTypes";

// Utility exports
export { ErrorHandler } from "./utils/ErrorHandler";
export { EventBus } from "./utils/EventBus";
export type { TreeViewEvent, EventHandler } from "./utils/EventBus";

// Feature module exports
export { CustomRootModule } from "./features/customRoot/CustomRootModule";
export { MarkingModule } from "./features/marking/MarkingModule";
export { PersistenceModule } from "./features/persistence/PersistenceModule";
export { ExpansionModule } from "./features/expansion/ExpansionModule";
export { IconModule } from "./features/icons/IconModule";
export { FilteringModule } from "./features/filtering/FilteringModule";

// Factory exports
export { TreeViewFactory } from "./TreeViewFactory";
export type { TreeViews, TreeViewFactoryOptions } from "./TreeViewFactory";

// Type exports
export * from "../testBenchTypes";

// Helper function to create all tree views
import * as vscode from "vscode";
import { PlayServerConnection } from "../testBenchConnection";
import { TreeViewFactory, TreeViewFactoryOptions, TreeViews } from "./TreeViewFactory";

export function createAllTreeViews(
    context: vscode.ExtensionContext,
    getConnection: () => PlayServerConnection | null,
    options?: TreeViewFactoryOptions
): TreeViews {
    const factory = new TreeViewFactory();
    return factory.createTreeViews(context, getConnection, options);
}
