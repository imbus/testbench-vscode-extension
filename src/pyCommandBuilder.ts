/**
 * @file pyCommandBuilder.ts
 * @description Provides functions to build command-line strings for executing tb2robot commands,
 * leveraging the active Python environment detected by the Python extension.
 */

import * as vscode from "vscode";
import * as path from "path";
import { EnvironmentPath, PythonExtension, ResolvedEnvironment } from "@vscode/python-extension";
import { logger } from "./extension";

/**
 * PyCommandBuilder provides methods to build command strings for tb2robot.
 */
export class PyCommandBuilder {
    /**
     * Retrieves the active workspace folder.
     * If multiple workspace folders exist, returns the one associated with the active editor.
     * @returns The active workspace folder, or undefined if none is found.
     */
    public static getActiveWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            if (workspaceFolders.length === 1) {
                return workspaceFolders[0];
            }
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const activeDocumentUri = activeEditor.document.uri;
                return vscode.workspace.getWorkspaceFolder(activeDocumentUri);
            }
        }
        return undefined;
    }

    /**
     * Retrieves the Python executable path from the active Python environment.
     *
     * @param activeWorkspace The active workspace folder.
     * @returns A promise resolving to the full path of the Python executable, or undefined if not found.
     */
    public static async getPythonEnvironmentExe(
        activeWorkspace: vscode.WorkspaceFolder | undefined
    ): Promise<string | undefined> {
        try {
            const pythonApi: PythonExtension = await PythonExtension.api();
            if (!pythonApi) {
                logger.error("Python extension API is unavailable.");
                return undefined;
            }

            // Get the active environment path based on the workspace.
            const environmentPath: EnvironmentPath | undefined = activeWorkspace
                ? pythonApi.environments.getActiveEnvironmentPath(activeWorkspace)
                : pythonApi.environments.getActiveEnvironmentPath();

            // Resolve the environment details.
            const environment: ResolvedEnvironment | undefined = await pythonApi.environments.resolveEnvironment(
                environmentPath
            );
            const pythonExecutablePath = environment?.executable.uri?.fsPath;
            if (!pythonExecutablePath) {
                logger.error("Failed to resolve Python executable path from the active environment.");
            }
            return pythonExecutablePath;
        } catch (error) {
            logger.error("Error in getPythonEnvironmentExe:", error);
            return undefined;
        }
    }

    /**
     * Builds the command string to execute the tb2robot (Testbench2Robotframework) main script.
     *
     * @param extensionContext The extension context.
     * @returns A promise resolving to the full command string.
     */
    public static async buildTb2RobotCommand(extensionContext: vscode.ExtensionContext): Promise<string> {
        // Construct the absolute path to the tb2robot main script.
        const tb2RobotMainFile: string = extensionContext.asAbsolutePath(
            path.join("bundled", "tools", "tb2robot", "__main__.py")
        );
        logger.trace("tb2robot main path set to:", tb2RobotMainFile);

        const activeWorkspace = this.getActiveWorkspaceFolder();
        const pythonExe = await this.getPythonEnvironmentExe(activeWorkspace);
        logger.trace(`Python executable path: ${pythonExe}`);

        if (!pythonExe) {
            // Return an empty string if the Python executable cannot be determined.
            return "";
        }

        const commandString = `${pythonExe} -u ${tb2RobotMainFile}`;
        logger.trace(`Built tb2robot command: ${commandString}`);
        return commandString;
    }    
}
