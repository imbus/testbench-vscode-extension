/**
 * @file src/treeViews/core/TreeViewModule.ts
 * @description  Interface for tree view modules.
 */

import { TreeViewContext } from "./TreeViewContext";

export interface TreeViewModule {
    readonly id: string;

    initialize(context: TreeViewContext): Promise<void>;
    dispose(): void;

    // Optional lifecycle hooks
    onConfigChange?(config: any): Promise<void>;
    onStateChange?(state: any): void;

    // Module-specific API (defined by each module)
    [key: string]: any;
}
