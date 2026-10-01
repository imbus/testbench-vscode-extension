import * as vscode from "vscode";
import { baseKeyOfExtension } from "./constants";

let extensionConfiguration = vscode.workspace.getConfiguration(baseKeyOfExtension);

export function getExtensionConfiguration(): vscode.WorkspaceConfiguration {
    return extensionConfiguration;
}

export function getExtensionSetting<T>(key: string): T | undefined {
    return extensionConfiguration.get<T>(key);
}

export function refreshConfig() {
    console.log("[configuration] Refreshing config...");
    extensionConfiguration = vscode.workspace.getConfiguration(baseKeyOfExtension);
}

export function initializeConfigurationWatcher() {
    vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(baseKeyOfExtension)) {
            refreshConfig();
        }
    });
}
