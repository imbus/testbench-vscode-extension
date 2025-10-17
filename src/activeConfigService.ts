import * as vscode from "vscode";
import { LanguageServerConfig, readLsConfig, hasLsConfig, getLsConfigFilePath } from "./lsConfig";
import { logger } from "./extension";

class ActiveConfigService {
    private _activeConfig: LanguageServerConfig | null = null;
    private _watcher: vscode.FileSystemWatcher | undefined;

    private readonly _onDidChangeActiveConfig = new vscode.EventEmitter<LanguageServerConfig | null>();
    public readonly onDidChangeActiveConfig = this._onDidChangeActiveConfig.event;

    public async initialize(context: vscode.ExtensionContext): Promise<void> {
        await this.loadActiveConfig();
        await this.setupWatcher(context);
    }

    public getActiveConfig(): LanguageServerConfig | null {
        return this._activeConfig;
    }

    private async loadActiveConfig(): Promise<void> {
        if (await hasLsConfig()) {
            this._activeConfig = await readLsConfig();
        } else {
            this._activeConfig = null;
        }
        this._onDidChangeActiveConfig.fire(this._activeConfig);
    }

    private async setupWatcher(context: vscode.ExtensionContext): Promise<void> {
        const configFilePath = await getLsConfigFilePath();
        if (configFilePath) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(configFilePath));
            if (workspaceFolder) {
                const relativePath = vscode.workspace.asRelativePath(configFilePath, false);
                this._watcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(workspaceFolder, relativePath)
                );

                const refreshConfig = () => {
                    logger.trace("[ActiveConfigService] ls.config.json changed, reloading.");
                    this.loadActiveConfig();
                };

                this._watcher.onDidChange(refreshConfig);
                this._watcher.onDidCreate(refreshConfig);
                this._watcher.onDidDelete(() => {
                    logger.trace("[ActiveConfigService] ls.config.json deleted, clearing active config.");
                    this._activeConfig = null;
                    this._onDidChangeActiveConfig.fire(null);
                });

                context.subscriptions.push(this._watcher);
            }
        }
    }

    public dispose(): void {
        this._watcher?.dispose();
        this._onDidChangeActiveConfig.dispose();
    }
}

export const activeConfigService = new ActiveConfigService();
