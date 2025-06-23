/**
 * @file src/treeViews/core/TreeViewContext.ts
 * @description Context object for tree views that provides access to shared resources and utilities.
 */

import * as vscode from "vscode";
import { TreeViewConfig } from "./TreeViewConfig";
import { StateManager } from "../state/StateManager";
import { EventBus } from "../utils/EventBus";
import { ErrorHandler } from "../utils/ErrorHandler";
import { TreeViewBase } from "./TreeViewBase";
import { TestBenchLogger } from "../../testBenchLogger";

/**
 * Context object that provides access to tree view resources
 */
export interface TreeViewContext {
    // Core components
    readonly extensionContext: vscode.ExtensionContext;
    readonly config: TreeViewConfig;
    readonly stateManager: StateManager;
    readonly eventBus: EventBus;
    readonly logger: TestBenchLogger;
    readonly errorHandler: ErrorHandler;

    // Tree view reference
    readonly refresh: (options?: { immediate?: boolean }) => void;
    readonly getTreeView: () => TreeViewBase<any>;
    readonly getCurrentRootItems: () => any[];
}

/**
 * Implementation of TreeViewContext
 */
export class TreeViewContextImpl implements TreeViewContext {
    constructor(
        public readonly extensionContext: vscode.ExtensionContext,
        public readonly config: TreeViewConfig,
        public readonly stateManager: StateManager,
        public readonly eventBus: EventBus,
        public readonly logger: TestBenchLogger,
        public readonly errorHandler: ErrorHandler,
        public readonly treeView: TreeViewBase<any>
    ) {}

    public refresh(options?: { immediate?: boolean }): void {
        // A refresh from the context is always a full refresh of the tree.
        // Pass "undefined" for the item and forward the options.
        this.treeView.refresh(undefined, options);
    }

    public getTreeView(): TreeViewBase<any> {
        return this.treeView;
    }

    public getCurrentRootItems(): any[] {
        return this.treeView.getCurrentRootItems();
    }
}
