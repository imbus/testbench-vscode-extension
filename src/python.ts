import { PythonExtension, ResolvedEnvironment } from "@vscode/python-extension";
import { logger } from "./extension";
import { Uri } from "vscode";

let _pythonExtensionApi: PythonExtension | undefined;

/**
 * Retrieves the Python extension API.
 * Ensures the API is fetched only once.
 * @returns {Promise<PythonExtension | undefined>} The Python extension API, or undefined if it cannot be accessed.
 * @async
 */
async function getPythonExtensionAPI(): Promise<PythonExtension | undefined> {
    if (_pythonExtensionApi) {
        return _pythonExtensionApi;
    }
    try {
        _pythonExtensionApi = await PythonExtension.api();
        if (_pythonExtensionApi) {
            logger.debug("[python] Successfully acquired PythonExtension API.");
        } else {
            logger.warn(
                "[python] PythonExtension.api() returned undefined. Python extension might not be available or activated."
            );
        }
    } catch (error) {
        logger.error(`[python] Error acquiring PythonExtension API: ${(error as Error).message}`, error);
        _pythonExtensionApi = undefined;
    }
    return _pythonExtensionApi;
}

/**
 * Gets the file system path of a compatible Python interpreter.
 * @param {Uri | undefined} resource - The resource for which to get the interpreter (e.g., workspace folder).
 * @returns {Promise<string | undefined>} The path to the Python interpreter, or undefined if not found or incompatible.
 * @async
 */
export async function getInterpreterPath(resource?: Uri): Promise<string | undefined> {
    const api: PythonExtension | undefined = await getPythonExtensionAPI();
    if (!api) {
        logger.error("[python] PythonExtension API not available. Cannot resolve interpreter path.");
        return undefined;
    }

    try {
        const activeEnvPath = api.environments.getActiveEnvironmentPath(resource);
        logger.debug(
            `[python] Active environment path object for resource '${resource?.fsPath || "default"}': ${JSON.stringify(activeEnvPath)}`
        );

        if (!activeEnvPath || !activeEnvPath.path) {
            logger.warn(
                `[python] No active Python environment path found for resource '${resource?.fsPath || "default"}'.`
            );
            return undefined;
        }
        const environment: ResolvedEnvironment | undefined = await api.environments.resolveEnvironment(activeEnvPath);

        if (!environment) {
            logger.warn(`[python] Could not resolve environment details for path: ${activeEnvPath.path}`);
            return undefined;
        }
        logger.debug(
            `[python] Resolved environment: Name: ${environment.id}, Path: ${environment.path}, Executable: ${environment.executable.uri?.fsPath}, Version: ${environment.version?.major}.${environment.version?.minor}.${environment.version?.micro}`
        );

        if (environment.executable?.uri && checkPythonCompatibility(environment)) {
            logger.debug(`[python] Compatible interpreter found: ${environment.executable.uri.fsPath}`);
            return environment.executable.uri.fsPath;
        } else {
            logger.warn(
                `[python] No compatible interpreter found or executable URI is missing for resolved environment: ${environment.id}`
            );
            if (environment.executable?.uri) {
                logger.warn(
                    `[python] Executable URI was ${environment.executable.uri.fsPath} but compatibility check failed.`
                );
            } else {
                logger.warn(`[python] Executable URI is missing.`);
            }
        }
    } catch (error) {
        logger.error(`[python] Error resolving interpreter path: ${(error as Error).message}`, error);
    }

    logger.warn("[python] Interpreter path could not be determined or was incompatible.");
    return undefined;
}

/**
 * Checks if the resolved Python environment is compatible with the language server requirements.
 * Requires Python 3.9 or newer.
 * @param {ResolvedEnvironment | undefined} resolvedEnv - The resolved Python environment.
 * @returns {boolean} True if the environment is compatible, false otherwise.
 */
export function checkPythonCompatibility(resolvedEnv: ResolvedEnvironment | undefined): boolean {
    if (!resolvedEnv) {
        logger.warn("[python] Resolved environment is undefined while checking compatibility.");
        return false;
    }

    const version = resolvedEnv.version;
    if (!version) {
        logger.warn(`[python] Version information is missing for environment: ${resolvedEnv.executable.uri?.fsPath}`);
        return false;
    }

    if (version.major === 3 && version.minor >= 9) {
        return true;
    }

    const versionString: string = `${version.major}.${version.minor}.${version.micro}`;
    logger.error(`[python] Python version ${versionString} is not supported. Supported versions are 3.9 and above.`);
    return false;
}
