import * as vscode from "vscode";
import { baseKeyOfExtension, ConfigKeys } from "./constants";
import { sanitizeFilePath } from "./utils";

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
    vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration(baseKeyOfExtension)) {
            refreshConfig();
        }

        const outputDirKey = `${baseKeyOfExtension}.${ConfigKeys.TB2ROBOT_OUTPUT_DIR}`;
        if (event.affectsConfiguration(outputDirKey)) {
            const config = vscode.workspace.getConfiguration(baseKeyOfExtension);
            const inspection = config.inspect<string>(ConfigKeys.TB2ROBOT_OUTPUT_DIR);

            // Sanitize User setting
            if (inspection && typeof inspection.globalValue === "string") {
                const sanitized = sanitizeFilePath(inspection.globalValue);
                if (sanitized !== inspection.globalValue) {
                    await config.update(ConfigKeys.TB2ROBOT_OUTPUT_DIR, sanitized, vscode.ConfigurationTarget.Global);
                }
            }

            // Sanitize Workspace setting
            if (inspection && typeof inspection.workspaceValue === "string") {
                const sanitized = sanitizeFilePath(inspection.workspaceValue);
                if (sanitized !== inspection.workspaceValue) {
                    await config.update(
                        ConfigKeys.TB2ROBOT_OUTPUT_DIR,
                        sanitized,
                        vscode.ConfigurationTarget.Workspace
                    );
                }
            }
        }

        const resourceDirKey = `${baseKeyOfExtension}.${ConfigKeys.TB2ROBOT_RESOURCE_DIR}`;
        if (event.affectsConfiguration(resourceDirKey)) {
            const config = vscode.workspace.getConfiguration(baseKeyOfExtension);
            const inspection = config.inspect<string>(ConfigKeys.TB2ROBOT_RESOURCE_DIR);

            // Sanitize User setting
            if (inspection && typeof inspection.globalValue === "string") {
                const sanitized = sanitizeFilePath(inspection.globalValue);
                if (sanitized !== inspection.globalValue) {
                    await config.update(ConfigKeys.TB2ROBOT_RESOURCE_DIR, sanitized, vscode.ConfigurationTarget.Global);
                }
            }

            // Sanitize Workspace setting
            if (inspection && typeof inspection.workspaceValue === "string") {
                const sanitized = sanitizeFilePath(inspection.workspaceValue);
                if (sanitized !== inspection.workspaceValue) {
                    await config.update(
                        ConfigKeys.TB2ROBOT_RESOURCE_DIR,
                        sanitized,
                        vscode.ConfigurationTarget.Workspace
                    );
                }
            }
        }
    });
}
