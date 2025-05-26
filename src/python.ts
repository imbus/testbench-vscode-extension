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
    logger.trace("[getPythonExtensionAPI] Attempting to get PythonExtension API.");
    if (_pythonExtensionApi) {
        logger.trace("[getPythonExtensionAPI] Returning cached PythonExtension API.");
        return _pythonExtensionApi;
    }
    try {
        _pythonExtensionApi = await PythonExtension.api();
        if (_pythonExtensionApi) {
            logger.info("[getPythonExtensionAPI] Successfully acquired PythonExtension API.");
        } else {
            logger.warn(
                "[getPythonExtensionAPI] PythonExtension.api() returned undefined. Python extension might not be available or activated."
            );
        }
    } catch (error) {
        logger.error(`[getPythonExtensionAPI] Error acquiring PythonExtension API: ${(error as Error).message}`, error);
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
    logger.info("[getInterpreterPath] Attempting to get interpreter path.");
    const api: PythonExtension | undefined = await getPythonExtensionAPI();
    if (!api) {
        logger.error("[getInterpreterPath] PythonExtension API not available. Cannot resolve interpreter path.");
        return undefined;
    }

    try {
        logger.trace("[getInterpreterPath] Resolving active environment path.");
        const activeEnvPath = api.environments.getActiveEnvironmentPath(resource);
        logger.info(
            `[getInterpreterPath] Active environment path object for resource '${resource?.fsPath || "default"}': ${JSON.stringify(activeEnvPath)}`
        );

        if (!activeEnvPath || !activeEnvPath.path) {
            logger.warn(
                `[getInterpreterPath] No active Python environment path found for resource '${resource?.fsPath || "default"}'.`
            );
            return undefined;
        }
        logger.trace(`[getInterpreterPath] Attempting to resolve environment details for: ${activeEnvPath.path}`);
        const environment: ResolvedEnvironment | undefined = await api.environments.resolveEnvironment(activeEnvPath);

        if (!environment) {
            logger.warn(`[getInterpreterPath] Could not resolve environment details for path: ${activeEnvPath.path}`);
            return undefined;
        }
        logger.info(
            `[getInterpreterPath] Resolved environment: Name: ${environment.id}, Path: ${environment.path}, Executable: ${environment.executable.uri?.fsPath}, Version: ${environment.version?.major}.${environment.version?.minor}.${environment.version?.micro}`
        );

        if (environment.executable?.uri && checkPythonCompatibility(environment)) {
            logger.info(`[getInterpreterPath] Compatible interpreter found: ${environment.executable.uri.fsPath}`);
            return environment.executable.uri.fsPath;
        } else {
            logger.warn(
                `[getInterpreterPath] No compatible interpreter found or executable URI is missing for resolved environment: ${environment.id}`
            );
            if (environment.executable?.uri) {
                logger.warn(
                    `[getInterpreterPath] Executable URI was ${environment.executable.uri.fsPath} but compatibility check failed.`
                );
            } else {
                logger.warn(`[getInterpreterPath] Executable URI was missing.`);
            }
        }
    } catch (error) {
        logger.error(`[getInterpreterPath] Error resolving interpreter path: ${(error as Error).message}`, error);
    }

    logger.warn("[getInterpreterPath] Interpreter path could not be determined or was incompatible.");
    return undefined;
}

/**
 * Checks if the resolved Python environment is compatible with the language server requirements.
 * Requires Python 3.9 or newer.
 * @param {ResolvedEnvironment | undefined} resolvedEnv - The resolved Python environment.
 * @returns {boolean} True if the environment is compatible, false otherwise.
 */
export function checkPythonCompatibility(resolvedEnv: ResolvedEnvironment | undefined): boolean {
    logger.trace("[checkPythonCompatibility] Checking Python compatibility.");
    if (!resolvedEnv) {
        logger.warn("[checkPythonCompatibility] Compatibility check: Resolved environment is undefined.");
        return false;
    }

    const version = resolvedEnv.version;
    if (!version) {
        logger.warn(
            `[checkPythonCompatibility] Compatibility check: Version information is missing for environment: ${resolvedEnv.executable.uri?.fsPath}`
        );
        return false;
    }

    if (version.major === 3 && version.minor >= 9) {
        logger.info(
            `[checkPythonCompatibility] Python version ${version.major}.${version.minor}.${version.micro} is compatible for path: ${resolvedEnv.executable.uri?.fsPath}`
        );
        return true;
    }

    const versionString: string = `${version.major}.${version.minor}.${version.micro}`;
    logger.error(`[checkPythonCompatibility] Python version ${versionString} is not supported.`);
    logger.error(`[checkPythonCompatibility] Selected Python path: ${resolvedEnv.executable.uri?.fsPath}`);
    logger.error(`[checkPythonCompatibility] Supported versions are 3.9 and above.`);
    return false;
}
