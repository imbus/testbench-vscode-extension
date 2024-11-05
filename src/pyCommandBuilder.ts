import * as vscode from "vscode";
import * as path from "path";
import { EnvironmentPath, PythonExtension } from "@vscode/python-extension";

export function getActiveWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
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

async function getPythonEnviromentExe(
    activeWorkspace: vscode.WorkspaceFolder | undefined
): Promise<string | undefined> {
    let res: string | undefined;

    const pythonApi: PythonExtension = await PythonExtension.api();

    let environmentPath: EnvironmentPath | undefined;
    if (activeWorkspace) {
        environmentPath = pythonApi?.environments.getActiveEnvironmentPath(activeWorkspace);
    } else {
        environmentPath = pythonApi?.environments.getActiveEnvironmentPath();
    }

    if (environmentPath === undefined) {
        return undefined;
    }

    const enviroment = await pythonApi?.environments.resolveEnvironment(environmentPath);
    res = enviroment?.executable.uri?.fsPath;

    return res;
}

export async function buildTb2RobotCommand(extensionContext: vscode.ExtensionContext): Promise<string> {
    let res = "";

    const tb2robMain = extensionContext.asAbsolutePath(path.join("bundled", "tools", "tb2robot", "__main__.py"));
    console.log(tb2robMain);

    const folder = getActiveWorkspaceFolder();

    let pythonExe = await getPythonEnviromentExe(folder);
    console.log(pythonExe);

    if (pythonExe === undefined) {
        return res;
    }

    res = pythonExe + " -u " + tb2robMain;
    console.log(res);

    return res;
}

export async function buildRobotCommand(): Promise<string | undefined> {
    let res = "";

    const folder = getActiveWorkspaceFolder();

    let pythonExe = await getPythonEnviromentExe(folder);
    console.log(pythonExe);

    if (pythonExe === undefined) {
        return undefined;
    }

    res = pythonExe + " -m robot";
    console.log(res);

    return res;
}
