import * as vscode from "vscode";
import { baseKeyOfExtension, ConfigKeys } from "./constants";
import { sanitizeFilePath } from "./utils";

let extensionConfiguration = vscode.workspace.getConfiguration(baseKeyOfExtension);

/**
 * Resolves the default workspace-folder scope for configuration access.
 * Prefers the workspace folder of the active editor, otherwise falls back
 * to the first workspace folder.
 * @returns The URI of the default workspace folder, or undefined if no workspace is open.
 */
function getDefaultConfigurationScope(): vscode.Uri | undefined {
    const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
    if (activeEditorUri) {
        const activeEditorWorkspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditorUri);
        if (activeEditorWorkspaceFolder) {
            return activeEditorWorkspaceFolder.uri;
        }
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/**
 * Resolves a configuration scope from either a URI or a filesystem path.
 * If the provided target belongs to a workspace folder, the workspace folder
 * URI is returned so workspace-folder settings are applied correctly.
 * @param scope Optional scope provided as a URI or filesystem path.
 * @returns A scope URI for `vscode.workspace.getConfiguration`, or undefined.
 */
function resolveConfigurationScope(scope?: vscode.Uri | string): vscode.Uri | undefined {
    if (!scope) {
        return undefined;
    }

    const candidateUri = typeof scope === "string" ? vscode.Uri.file(scope) : scope;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(candidateUri);

    return workspaceFolder?.uri ?? candidateUri;
}

/**
 * Returns the extension configuration object for the requested scope.
 * If no scope is provided, a default workspace is selected.
 * @param scope Optional scope provided as a URI or filesystem path.
 * @returns The extension workspace configuration resolved for the given scope.
 */
export function getExtensionConfiguration(scope?: vscode.Uri | string): vscode.WorkspaceConfiguration {
    const scopeUri = resolveConfigurationScope(scope);
    if (scopeUri) {
        return vscode.workspace.getConfiguration(baseKeyOfExtension, scopeUri);
    }

    const defaultScopeUri = getDefaultConfigurationScope();
    if (defaultScopeUri) {
        return vscode.workspace.getConfiguration(baseKeyOfExtension, defaultScopeUri);
    }

    return extensionConfiguration;
}

/**
 * Reads a single extension setting value for an optional scope.
 * @param key Setting key without extension prefix.
 * @param scope Optional URI or path used for scoped settings resolution.
 * @returns The configured value if present, otherwise undefined.
 */
export function getExtensionSetting<T>(key: string, scope?: vscode.Uri | string): T | undefined {
    return getExtensionConfiguration(scope).get<T>(key);
}

/**
 * Refreshes the cached extension configuration used as fallback.
 */
export function refreshConfig() {
    console.log("[configuration] Refreshing config...");
    extensionConfiguration = vscode.workspace.getConfiguration(baseKeyOfExtension);
}

/**
 * Sanitizes and updates a setting value for a specific configuration target.
 * @param key Setting key without extension prefix.
 * @param currentValue Current value to sanitize.
 * @param config Configuration object used for updates.
 * @param target Configuration target to update.
 * @returns A promise that resolves when update checks/operations complete.
 */
async function sanitizeAndUpdateIfNeeded(
    key: string,
    currentValue: unknown,
    config: vscode.WorkspaceConfiguration,
    target: vscode.ConfigurationTarget
): Promise<void> {
    if (typeof currentValue !== "string") {
        return;
    }

    const sanitized = sanitizeFilePath(currentValue);
    if (sanitized !== currentValue) {
        await config.update(key, sanitized, target);
    }
}

/**
 * Sanitizes a path-like extension setting across global, workspace,
 * and workspace-folder targets.
 * @param key Setting key without extension prefix.
 * @returns A promise that resolves after all applicable targets are processed.
 */
async function sanitizePathSettingAcrossTargets(key: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(baseKeyOfExtension);
    // Only sanitize if the setting exists in at least one scope
    const inspection = config.inspect<string>(key);

    if (!inspection) {
        return;
    }

    await sanitizeAndUpdateIfNeeded(key, inspection.globalValue, config, vscode.ConfigurationTarget.Global);
    await sanitizeAndUpdateIfNeeded(key, inspection.workspaceValue, config, vscode.ConfigurationTarget.Workspace);

    for (const folder of vscode.workspace.workspaceFolders || []) {
        const folderConfig = vscode.workspace.getConfiguration(baseKeyOfExtension, folder.uri);
        const folderInspection = folderConfig.inspect<string>(key);
        if (!folderInspection) {
            continue;
        }

        await sanitizeAndUpdateIfNeeded(
            key,
            folderInspection.workspaceFolderValue,
            folderConfig,
            vscode.ConfigurationTarget.WorkspaceFolder
        );
    }
}

/**
 * Initializes configuration listeners and keeps path-like settings sanitized
 * across all available configuration scopes.
 */
export function initializeConfigurationWatcher() {
    vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration(baseKeyOfExtension)) {
            refreshConfig();
        }

        const outputDirKey = `${baseKeyOfExtension}.${ConfigKeys.TB2ROBOT_OUTPUT_DIR}`;
        if (event.affectsConfiguration(outputDirKey)) {
            await sanitizePathSettingAcrossTargets(ConfigKeys.TB2ROBOT_OUTPUT_DIR);
        }

        const resourceDirKey = `${baseKeyOfExtension}.${ConfigKeys.TB2ROBOT_RESOURCE_DIR}`;
        if (event.affectsConfiguration(resourceDirKey)) {
            await sanitizePathSettingAcrossTargets(ConfigKeys.TB2ROBOT_RESOURCE_DIR);
        }
    });
}
