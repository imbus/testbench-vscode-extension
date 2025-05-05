import { PythonExtension, ResolvedEnvironment } from "@vscode/python-extension";
import { logger } from "./extension";
import { Uri } from "vscode";

let _pythonExtensionApi: PythonExtension | undefined;
async function getPythonExtensionAPI(): Promise<PythonExtension | undefined> {
    if (_pythonExtensionApi) {
        return _pythonExtensionApi;
    }
    _pythonExtensionApi = await PythonExtension.api();
    return _pythonExtensionApi;
}

export async function getInterpreterPath(resource?: Uri): Promise<string | undefined> {
    const api: PythonExtension | undefined = await getPythonExtensionAPI();
    const environment: ResolvedEnvironment | undefined = await api?.environments.resolveEnvironment(
        api?.environments.getActiveEnvironmentPath(resource)
    );
    if (environment?.executable.uri && checkPythonCompatibility(environment)) {
        return environment?.executable.uri.fsPath;
    }
    return undefined;
}

export function checkPythonCompatibility(resolved: ResolvedEnvironment | undefined): boolean {
    const version = resolved?.version;
    if (version?.major === 3 && version?.minor >= 9) {
        return true;
    }
    logger.error(`Python version ${version?.major}.${version?.minor} is not supported.`);
    logger.error(`Selected python path: ${resolved?.executable.uri?.fsPath}`);
    logger.error(`Supported versions are 3.9 and above.`);
    return false;
}
