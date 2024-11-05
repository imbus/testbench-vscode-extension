import * as vscode from "vscode";
import { exec } from "child_process";

export abstract class dependenciesCheck {

    public static checkVSCodeVersion(vsCodeVersion: string): boolean {
        const [major, minor] = vsCodeVersion.split('.').map(Number);
        console.log(`Current VS-Code version: ${vsCodeVersion}`);

        if (major > 1 || major === 1 && minor >= 86) {
            console.log(`Current version is at least 1.86.`);
            return true;
        }
        else {
            console.log(`Current version is below 1.86.`);
            vscode.window.showErrorMessage(`Current VS-Code version: ${vsCodeVersion}. Required minimum version: 1.86.`);
            return false;
        }
    }

    public static checkPythonExtension(pythonExtension: vscode.Extension<any> | undefined): boolean {
        if (pythonExtension) {
            console.log(`Python Extension is installed.`);
            return true;
        } else {
            console.log(`Python Extension is not installed.`);
            vscode.window.showErrorMessage('Python Extension is not installed.');
            return false;
        }
    }

    public static checkRobotFramework(): Promise<boolean> {
        return new Promise((resolve) => {
            exec('pip show robotframework', (error, stdout, stderr) => {
                if (error) {
                    console.log(`Error: ${error.message}`);
                    vscode.window.showErrorMessage(`Robot Framework Error: ${error.message}`);
                    resolve(false);
                    return;
                }
                if (stderr) {
                    console.log(`Stderr: ${stderr}`);
                    vscode.window.showErrorMessage(`Robot Framework Stderr: ${stderr}`);
                    resolve(false);
                    return;
                }
                if (stdout) {
                    console.log(`Robot Framework version: ${stdout.split('\n')[1].trim().split(' ')[1]}`);
                    resolve(true);
                    return;
                }
            });
        });
    }

    public static async checkPythonVersion(): Promise<boolean> {
        return new Promise((resolve) => {
            exec('python -c "import sys; print(\'.\'.join(map(str, sys.version_info[:3])))"', (error, stdout, stderr) => {
                if (error) {
                    console.log(`Error: ${error.message}`);
                    vscode.window.showErrorMessage(`Error checking Python version: ${error.message}`);
                    resolve(false);
                    return;
                }
                if (stderr) {
                    console.log(`stderr: ${stderr}`);
                    vscode.window.showErrorMessage(`Stderr checking Python version: ${stderr}`);
                    resolve(false);
                    return;
                }

                const version = stdout.trim();
                const [major, minor] = version.split('.').map(Number);
                console.log(`Python version installed: ${version}`);

                if (major > 3 || (major === 3 && minor >= 8)) {
                    console.log('Python version is at least 3.8');
                    resolve(true);
                } else {
                    console.log('Python version is below 3.8');
                    vscode.window.showErrorMessage(`Current Python version: ${version}. Required minimum version: 3.8.`);
                    resolve(false);
                }
            });
        });
    }

    public static async checkDependencies(): Promise<boolean> {
        let res = true;

        if (!this.checkVSCodeVersion(vscode.version)) {
            res = false;
        }

        if (!this.checkPythonExtension(vscode.extensions.getExtension('ms-python.python'))) {
            res = false;
        }

        await this.checkPythonVersion().then((successful) => {
            if (!successful) {
                res = false;
            }
        });

        await this.checkRobotFramework().then((successful) => {
            if (!successful) {
                res = false;
            }
        });

        return res;
    }
}