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
        let pythonExecutablePath: string | undefined;

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
        pythonExecutablePath = enviroment?.executable.uri?.fsPath;

        return pythonExecutablePath;
    }

    public static async buildTb2RobotCommand(extensionContext: vscode.ExtensionContext): Promise<string> {
        let resultString: string = "";

        const tb2robMain: string = extensionContext.asAbsolutePath(
            path.join("bundled", "tools", "tb2robot", "__main__.py")
        );
        logger.trace("rb2robot main path set to:", tb2robMain);

        const folder: vscode.WorkspaceFolder | undefined = this.getActiveWorkspaceFolder();

        let pythonExe: string | undefined = await this.getPythonEnviromentExe(folder);
        logger.trace(`python.exe Path: ${pythonExe}`);

        if (pythonExe === undefined) {
            return resultString;
        }

        resultString = pythonExe + " -u " + tb2robMain;
        logger.trace(`Built tb2robot command: ${resultString}`);

        return resultString;
    }

    public static async buildRobotCommand(): Promise<string> {
        let resultString: string = "";

        const folder: vscode.WorkspaceFolder | undefined = this.getActiveWorkspaceFolder();

        let pythonExe: string | undefined = await this.getPythonEnviromentExe(folder);
        logger.trace(`python.exe Path: ${pythonExe}`);

        if (pythonExe === undefined) {
            return resultString;
        }

        resultString = pythonExe + " -m robot";
        logger.trace(`Built robot command: ${resultString}`);

        return resultString;
    }
}
