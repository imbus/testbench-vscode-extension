/**
 * @file src/activeConfigService.ts
 * @description Service for managing the active TestBench project configuration from ls.config.json.
 */

import * as vscode from "vscode";
import {
    LanguageServerConfig,
    readLsConfig,
    hasLsConfig,
    getLsConfigFilePath,
    validateAndFixLsConfigInteractively
} from "./lsConfig";
import { logger } from "../extension";
import { updateOrRestartLS, stopLanguageClient } from "../languageServer/server";

const AUTO_VALIDATE_CONFIG_ON_CHANGE = true;

/**
 * Manages reading and monitoring the `ls.config.json` file.
 * It provides a centralized service for accessing the active project configuration
 * and notifies listeners when the configuration changes.
 */
class ActiveConfigService {
    private _activeConfig: LanguageServerConfig | null = null;
    private _watcher: vscode.FileSystemWatcher | undefined;
    private isAutoFixing = false;

    private readonly _onDidChangeActiveConfig = new vscode.EventEmitter<LanguageServerConfig | null>();
    /**
     * An event that fires when the active configuration changes.
     */
    public readonly onDidChangeActiveConfig = this._onDidChangeActiveConfig.event;

    /**
     * Initializes the service by loading the configuration and setting up a file watcher.
     * @param context The extension context.
     */
    public async initialize(context: vscode.ExtensionContext): Promise<void> {
        await this.loadActiveConfig();
        await this.setupWatcher(context);
    }

    /**
     * Gets the currently active language server configuration.
     * @returns The active configuration, or null if not available.
     */
    public getActiveConfig(): LanguageServerConfig | null {
        return this._activeConfig;
    }

    /**
     * Loads the `ls.config.json` file from disk and updates the internal state.
     * Fires the `onDidChangeActiveConfig` event with the new configuration.
     */
    private async loadActiveConfig(): Promise<void> {
        if (this.isAutoFixing) {
            return;
        }

        if (await hasLsConfig()) {
            this._activeConfig = await readLsConfig();
            const shouldValidate = AUTO_VALIDATE_CONFIG_ON_CHANGE;
            if (shouldValidate && this._activeConfig) {
                this.isAutoFixing = true;
                try {
                    const fixedConfig = await validateAndFixLsConfigInteractively(this._activeConfig);
                    if (fixedConfig) {
                        this._activeConfig = fixedConfig;
                    }
                } finally {
                    this.isAutoFixing = false;
                }
            }
        } else {
            this._activeConfig = null;
        }
        this._onDidChangeActiveConfig.fire(this._activeConfig);
    }

    /**
     * Sets up a file system watcher to monitor changes to `ls.config.json`.
     * @param context The extension context to which the watcher disposable will be added.
     */
    private async setupWatcher(context: vscode.ExtensionContext): Promise<void> {
        const configFilePath = await getLsConfigFilePath();
        if (configFilePath) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(configFilePath));
            if (workspaceFolder) {
                const relativePath = vscode.workspace.asRelativePath(configFilePath, false);
                this._watcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(workspaceFolder, relativePath)
                );

                const refreshConfig = async () => {
                    logger.trace("[ActiveConfigService] ls.config.json changed, reloading.");
                    await this.loadActiveConfig();
                    await updateOrRestartLS();
                };

                this._watcher.onDidChange(refreshConfig);
                this._watcher.onDidCreate(refreshConfig);
                this._watcher.onDidDelete(async () => {
                    logger.trace("[ActiveConfigService] ls.config.json deleted, clearing active config.");
                    this._activeConfig = null;
                    this._onDidChangeActiveConfig.fire(null);
                    await stopLanguageClient();
                });

                context.subscriptions.push(this._watcher);
            }
        }
    }

    /**
     * Disposes of the file watcher and event emitter.
     */
    public dispose(): void {
        this._watcher?.dispose();
        this._onDidChangeActiveConfig.dispose();
    }
}

/**
 * Singleton instance of the ActiveConfigService.
 */
export const activeConfigService = new ActiveConfigService();
