/**
 * @file src/treeViews/features/ActiveItemMarkerModule.ts
 * @description Tree view module for marking active project/TOV items.
 */

import { TreeViewModule } from "../core/TreeViewModule";
import { TreeViewContext } from "../core/TreeViewContext";
import { ProjectsTreeItem } from "../implementations/projects/ProjectsTreeItem";
import { LanguageServerConfig } from "../../languageServer/lsConfig";
import { activeConfigService } from "../../languageServer/activeConfigService";
import * as vscode from "vscode";

/**
 * A tree view module that decorates tree items to indicate
 * whether they correspond to the active project and TOV
 * as defined in `ls.config.json`.
 */
export class ActiveItemMarkerModule implements TreeViewModule {
    public readonly id = "activeItemMarker";
    private _context: TreeViewContext | undefined;
    private _activeConfig: LanguageServerConfig | null = null;
    private _disposables: vscode.Disposable[] = [];

    /**
     * Initializes the module by subscribing to configuration changes.
     * @param context The context for the tree view.
     */
    async initialize(context: TreeViewContext): Promise<void> {
        this._context = context;
        this._activeConfig = activeConfigService.getActiveConfig();

        const configChangeSubscription = activeConfigService.onDidChangeActiveConfig((config) => {
            this._activeConfig = config;
            this._context?.refresh();
        });
        this._disposables.push(configChangeSubscription);
    }

    /**
     * Decorates a `ProjectsTreeItem` with a pin icon in its description
     * if it matches the active project or TOV.
     * @param item The tree item to potentially decorate.
     */
    public decorateItem(item: ProjectsTreeItem): void {
        if (!this._activeConfig || !(item instanceof ProjectsTreeItem)) {
            return;
        }

        const isProjectMatch = item.data.type === "project" && item.data.name.trim() === this._activeConfig.projectName;
        const isTovMatch =
            item.data.type === "version" &&
            item.parent instanceof ProjectsTreeItem &&
            item.parent.data.type === "project" &&
            item.parent.data.name.trim() === this._activeConfig.projectName &&
            item.data.name.trim() === this._activeConfig.tovName;

        if (isProjectMatch || isTovMatch) {
            const pinIcon = "📌";
            item.description = item.description ? `${pinIcon} ${item.description}` : pinIcon;
        }
    }

    /**
     * Disposes of the resources used by the module, such as event subscriptions.
     */
    dispose(): void {
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._disposables = [];
    }
}
