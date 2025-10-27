import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { LS_CONFIG_FILE_NAME, folderNameOfInternalTestbenchFolder } from "../constants";
import { logger, getConnection } from "../extension";
import { validateAndReturnWorkspaceLocation } from "../utils";
import { isHandlingLogout } from "./server";

export interface LanguageServerConfig {
    projectName: string;
    tovName: string;
}

export async function getLsConfigFolderPath(): Promise<string | undefined> {
    const workspace = await validateAndReturnWorkspaceLocation();
    if (!workspace) {
        return undefined;
    }
    return path.join(workspace, folderNameOfInternalTestbenchFolder);
}

export async function getLsConfigFilePath(): Promise<string | undefined> {
    const folder = await getLsConfigFolderPath();
    if (!folder) {
        return undefined;
    }
    return path.join(folder, LS_CONFIG_FILE_NAME);
}

export async function ensureLsFolderExists(): Promise<boolean> {
    try {
        const folder = await getLsConfigFolderPath();
        if (!folder) {
            return false;
        }
        await fsPromises.mkdir(folder, { recursive: true });
        return true;
    } catch (error) {
        logger.error("[lsConfig] Failed to ensure LS folder exists:", error);
        return false;
    }
}

export async function hasLsConfig(): Promise<boolean> {
    try {
        const filePath = await getLsConfigFilePath();
        if (!filePath) {
            return false;
        }
        await fsPromises.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

export async function readLsConfig(): Promise<LanguageServerConfig | null> {
    try {
        const filePath = await getLsConfigFilePath();
        if (!filePath) {
            return null;
        }
        const content = await fsPromises.readFile(filePath, "utf-8");
        const trimmed = content.trim();
        if (trimmed.length === 0) {
            // Empty file, allow interactive fix
            return { projectName: "", tovName: "" };
        }
        let parsed: any;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            logger.warn("[lsConfig] Failed to parse LS config JSON. Will prompt user to fix.");
            return { projectName: "", tovName: "" };
        }
        if (!parsed || typeof parsed !== "object") {
            return { projectName: "", tovName: "" };
        }
        const projectName = typeof parsed.projectName === "string" ? parsed.projectName.trim() : "";
        const tovName = typeof parsed.tovName === "string" ? parsed.tovName.trim() : "";
        return { projectName, tovName };
    } catch {
        logger.warn("[lsConfig] Failed to read LS config. Will prompt user to fix.");
        return { projectName: "", tovName: "" };
    }
}

export async function writeLsConfig(data: LanguageServerConfig): Promise<boolean> {
    try {
        const ok = await ensureLsFolderExists();
        if (!ok) {
            vscode.window.showErrorMessage("Failed to create .testbench folder in the workspace.");
            return false;
        }
        const filePath = await getLsConfigFilePath();
        if (!filePath) {
            return false;
        }
        await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
        logger.info(`[lsConfig] Saved language server config to ${filePath}`);
        return true;
    } catch (error) {
        logger.error("[lsConfig] Failed to write LS config:", error);
        return false;
    }
}

/**
 * Validates and when possible fixes the LS config file by checking against the server.
 * - Ensures projectName exists on the server. If not, prompts user to select a project.
 * - Ensures tovName exists for the project. If missing or invalid, prompts user to select a TOV
 *   (auto selects when there is exactly one).
 * Returns the validated or fixed config, or null if user cancels or no connection.
 */
export async function validateAndFixLsConfigInteractively(
    currentCfg?: LanguageServerConfig
): Promise<LanguageServerConfig | null> {
    try {
        if (isHandlingLogout) {
            logger.trace("[lsConfig] Skipping LS config validation during logout.");
            return currentCfg || (await readLsConfig());
        }

        const connection = getConnection();
        if (!connection) {
            logger.warn("[lsConfig] No active connection while validating LS config.");
            return currentCfg || (await readLsConfig());
        }
        const initialSessionToken = connection.getSessionToken();

        const config = currentCfg ? { ...currentCfg } : await readLsConfig();
        if (!config) {
            return null;
        }

        let configChanged = false;

        const projects = await connection.getProjectsList();
        if (!projects || !Array.isArray(projects) || projects.length === 0) {
            vscode.window.showWarningMessage("No projects available on server. Cannot validate LS config.");
            return config;
        }

        // Validate project name
        let selectedProject = projects.find((p: any) => p.name === config.projectName);
        if (!selectedProject) {
            if (isHandlingLogout || !getConnection() || getConnection()!.getSessionToken() !== initialSessionToken) {
                logger.trace(
                    "[lsConfig] Connection changed or logout in progress before project selection. Aborting prompts."
                );
                return config;
            }

            configChanged = true;
            const picked = await vscode.window.showQuickPick(
                projects.map((p: any) => p.name),
                {
                    title: "Select TestBench Project (config is invalid)",
                    placeHolder: "Choose a project for LS configuration"
                }
            );
            if (!picked) {
                return null;
            }
            config.projectName = picked;
            selectedProject = projects.find((p: any) => p.name === picked);
        }

        // Validate TOV name
        const projectKey = selectedProject!.key;
        const currentConn = getConnection();
        if (!currentConn || currentConn.getSessionToken() !== initialSessionToken || isHandlingLogout) {
            logger.trace("[lsConfig] Connection changed or logout in progress before fetching TOVs. Skipping prompts.");
            return config;
        }

        const projectTree = await currentConn.getProjectTreeOfProject(projectKey);
        const versions = (projectTree?.children || []).filter((n: any) => n.nodeType === "Version");
        const tovNames = versions.map((v: any) => v.name || v.label).filter(Boolean);

        if (!tovNames || tovNames.length === 0) {
            logger.warn("[lsConfig] No TOVs available or failed to fetch versions. Skipping interactive TOV prompt.");
            return config;
        }

        if (!config.tovName || !tovNames.includes(config.tovName)) {
            if (isHandlingLogout || !getConnection() || getConnection()!.getSessionToken() !== initialSessionToken) {
                logger.trace(
                    "[lsConfig] Connection changed or logout in progress before TOV selection. Aborting prompts."
                );
                return config;
            }

            configChanged = true;
            if (tovNames.length === 1) {
                config.tovName = tovNames[0];
            } else {
                const pickedTov = await vscode.window.showQuickPick(tovNames, {
                    title: `Select Test Object Version for project "${config.projectName}"`,
                    placeHolder: "Choose a TOV for LS configuration"
                });
                if (!pickedTov) {
                    return null;
                }
                config.tovName = pickedTov;
            }
        }

        if (configChanged) {
            await writeLsConfig(config);
        }
        logger.info(`[lsConfig] Validated and saved LS config: ${config.projectName} / ${config.tovName}`);
        return config;
    } catch (error) {
        logger.error("[lsConfig] Error validating LS config:", error);
        return null;
    }
}

/**
 * Prompts the user to create `ls.config.json` when it is missing and a project/TOV context is known.
 * If the user selects "Create", the configuration is written using the provided context.
 *
 * This helper centralizes the repeated UX flow used across the extension.
 *
 * @param projectName The TestBench project name to set in the configuration
 * @param tovName The Test Object Version name to set in the configuration
 */
export async function promptCreateLsConfigIfMissing(projectName: string, tovName: string): Promise<void> {
    try {
        const workspaceLocation = await validateAndReturnWorkspaceLocation(false);
        if (!workspaceLocation) {
            logger.trace("[lsConfig] Skipping LS config creation prompt: no active workspace.");
            return;
        }

        const exists = await hasLsConfig();
        if (exists) {
            return;
        }

        const choice = await vscode.window.showInformationMessage(
            `No TestBench project configuration found. Create configuration for "${projectName} / ${tovName}"?`,
            "Create",
            "Cancel"
        );
        if (choice === "Create") {
            await writeLsConfig({ projectName, tovName });
        }
    } catch (error) {
        logger.error("[lsConfig] Error prompting to create LS config:", error);
    }
}
