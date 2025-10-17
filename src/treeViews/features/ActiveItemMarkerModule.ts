import { TreeViewModule } from "../core/TreeViewModule";
import { TreeViewContext } from "../core/TreeViewContext";
import { ProjectsTreeItem } from "../implementations/projects/ProjectsTreeItem";
import { LanguageServerConfig } from "../../lsConfig";
import { activeConfigService } from "../../activeConfigService";
import * as vscode from "vscode";

export class ActiveItemMarkerModule implements TreeViewModule {
    public readonly id = "activeItemMarker";
    private _context: TreeViewContext | undefined;
    private _activeConfig: LanguageServerConfig | null = null;
    private _disposables: vscode.Disposable[] = [];

    async initialize(context: TreeViewContext): Promise<void> {
        this._context = context;
        this._activeConfig = activeConfigService.getActiveConfig();

        const configChangeSubscription = activeConfigService.onDidChangeActiveConfig((config) => {
            this._activeConfig = config;
            this._context?.refresh();
        });
        this._disposables.push(configChangeSubscription);
    }

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

    dispose(): void {
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._disposables = [];
    }
}
