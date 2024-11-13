import * as vscode from "vscode";
import * as path from "path";
import { EnvironmentPath, PythonExtension, ResolvedEnvironment } from "@vscode/python-extension";
import { logger } from "./extension";

export class pyCommandBuilder {
    public static getActiveWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        const workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders;

        if (workspaceFolders && workspaceFolders.length > 0) {
            if (workspaceFolders.length === 1) {
                return workspaceFolders[0];
            }
            const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
            if (activeEditor) {
                const activeDocumentUri: vscode.Uri = activeEditor.document.uri;
                return vscode.workspace.getWorkspaceFolder(activeDocumentUri);
            }
        }
        return undefined;
    }

    public static async getPythonEnviromentExe(
        activeWorkspace: vscode.WorkspaceFolder | undefined
    ): Promise<string | undefined> {
        let res: string | undefined;

        const pythonApi: PythonExtension = await PythonExtension.api();

        if (pythonApi === undefined) {
            return undefined;
        }

        let environmentPath: EnvironmentPath | undefined;
        if (activeWorkspace) {
            environmentPath = pythonApi?.environments.getActiveEnvironmentPath(activeWorkspace);
        } else {
            environmentPath = pythonApi?.environments.getActiveEnvironmentPath();
        }

        const enviroment: ResolvedEnvironment | undefined = await pythonApi?.environments.resolveEnvironment(
            environmentPath
        );
        res = enviroment?.executable.uri?.fsPath;

        return res;
    }

    public static async buildTb2RobotCommand(extensionContext: vscode.ExtensionContext): Promise<string> {
        let res: string = "";

        const tb2robMain: string = extensionContext.asAbsolutePath(
            path.join("bundled", "tools", "tb2robot", "__main__.py")
        );
        //logger.debug("rb2robot main path:", tb2robMain);

        const folder: vscode.WorkspaceFolder | undefined = this.getActiveWorkspaceFolder();

        let pythonExe: string | undefined = await this.getPythonEnviromentExe(folder);
        // logger.debug(`python.exe Path: ${pythonExe}`);

        if (pythonExe === undefined) {
            return res;
        }

        res = pythonExe + " -u " + tb2robMain;
        // logger.debug(res);

        return res;
    }

    public static async buildRobotCommand(): Promise<string> {
        let res: string = "";

        const folder: vscode.WorkspaceFolder | undefined = this.getActiveWorkspaceFolder();

        let pythonExe: string | undefined = await this.getPythonEnviromentExe(folder);
        // logger.debug(`python.exe Path: ${pythonExe}`);

        if (pythonExe === undefined) {
            return res;
        }

        res = pythonExe + " -m robot";
        // logger.debug(res);

        return res;
    }
}
