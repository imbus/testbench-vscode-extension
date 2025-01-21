import * as vscode from "vscode";
import { exec } from "child_process";
import { logger } from "./extension";

// Not used in the current version of the extension. Can be used to debug / check if the required dependencies are met.
export class dependenciesCheck {
    public static isVSCodeVersionValid(vsCodeVersion: string): boolean {
        const [major, minor] = vsCodeVersion.split(".").map(Number);

        if (major > 1 || (major === 1 && minor >= 86)) {
            logger.debug(`Current VS Code version is at least 1.86.`);
            return true;
        } else {
            logger.error(`Current VS Code version is below 1.86.`);
            vscode.window.showErrorMessage(
                `Current VS-Code version: ${vsCodeVersion}. Required minimum version: 1.86.`
            );
            return false;
        }
    }

    public static isPythonExtensionInstalled(pythonExtension: vscode.Extension<any> | undefined): boolean {
        if (pythonExtension) {
            logger.debug(`Python Extension is installed in VS Code.`);
            return true;
        } else {
            const pythonExtensionNotInstalledErrorMessage = "Python Extension is not installed in VS Code.";
            logger.error(pythonExtensionNotInstalledErrorMessage);
            vscode.window.showErrorMessage(pythonExtensionNotInstalledErrorMessage);
            return false;
        }
    }

    public static isRobotFrameworkInstalled(): Promise<boolean> {
        return new Promise((resolve) => {
            exec("pip show robotframework", (error, stdout, stderr) => {
                if (error) {
                    const errorWhenCheckingRFMessage = `Error when checking Robot Framework installation: ${error.message}`;
                    logger.error(errorWhenCheckingRFMessage);
                    vscode.window.showErrorMessage(errorWhenCheckingRFMessage);
                    resolve(false);
                    return;
                }
                if (stderr) {
                    const stderrWhenCheckingRFMessage = `Stderr when checking Robot Framework installation: ${stderr}`;
                    logger.error(stderrWhenCheckingRFMessage);
                    vscode.window.showErrorMessage(stderrWhenCheckingRFMessage);
                    resolve(false);
                    return;
                }
                if (stdout) {
                    logger.debug(`Robot Framework version: ${stdout.split("\n")[1].trim().split(" ")[1]}`);
                    resolve(true);
                    return;
                }
            });
        });
    }

    public static async isPythonVersionCompatible(): Promise<boolean> {
        return new Promise((resolve) => {
            exec(
                "python -c \"import sys; print('.'.join(map(str, sys.version_info[:3])))\"",
                (error, stdout, stderr) => {
                    if (error) {
                        logger.error(`Error: ${error.message}`);
                        vscode.window.showErrorMessage(`Error checking Python version: ${error.message}`);
                        resolve(false);
                        return;
                    }
                    if (stderr) {
                        logger.error(`stderr: ${stderr}`);
                        vscode.window.showErrorMessage(`Stderr checking Python version: ${stderr}`);
                        resolve(false);
                        return;
                    }

                    const version = stdout.trim();
                    const [major, minor] = version.split(".").map(Number);

                    if (major > 3 || (major === 3 && minor >= 8)) {
                        logger.debug("Python version is at least 3.8: ", version);
                        resolve(true);
                    } else {
                        const pythonVersionErrorMessage = `Current Python version: ${version}. Required minimum version: 3.8.`;
                        logger.error(pythonVersionErrorMessage);
                        vscode.window.showErrorMessage(pythonVersionErrorMessage);
                        resolve(false);
                    }
                }
            );
        });
    }

    public static async areRequiredDependenciesMet(): Promise<boolean> {
        let areDependenciesMet: boolean = true;

        if (!this.isVSCodeVersionValid(vscode.version)) {
            areDependenciesMet = false;
        }

        if (!this.isPythonExtensionInstalled(vscode.extensions.getExtension("ms-python.python"))) {
            areDependenciesMet = false;
        }

        await this.isPythonVersionCompatible().then((successful) => {
            if (!successful) {
                areDependenciesMet = false;
            }
        });

        await this.isRobotFrameworkInstalled().then((successful) => {
            if (!successful) {
                areDependenciesMet = false;
            }
        });

        return areDependenciesMet;
    }
}
