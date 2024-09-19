import * as vscode from "vscode";
import { exec, spawn } from "child_process";
import * as fs from "fs";

// Check if Robot Framework is installed
function isRobotFrameworkInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
        let robotPath = "robot";
        const robotProcess = spawn(robotPath, ["--version"]);

        robotProcess.stdout.on("data", (data) => {
            const output = data.toString();
            console.log("stdout:", output);
            if (output.includes("Robot Framework")) {
                resolve(true);
            } else {
                resolve(false);
            }
        });

        robotProcess.stderr.on("data", (data) => {
            console.error("stderr:", data.toString());
            resolve(false);
        });

        robotProcess.on("error", (error) => {
            console.error("Error executing command:", error);
            resolve(false);
        });
    });
}

// Run Robot Framework tests
function runRobotTests(robotFiles: string[], outputDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const command = `robot --outputdir "${outputDir}" ${robotFiles.map((file) => `"${file}"`).join(" ")}`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(stderr || stdout);
                return;
            }
            resolve();
        });
    });
}

export async function startTestExecution() {
    const isInstalled = await isRobotFrameworkInstalled();
    if (!isInstalled) {
        vscode.window.showErrorMessage("Robot Framework is not installed. Please install it to run tests.");
        return;
    }

    // Let the user select .robot files
    const selectedFiles = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: "Select Robot Files",
        filters: {
            "Robot Framework Files": ["robot"],
        },
    });

    if (!selectedFiles || selectedFiles.length === 0) {
        vscode.window.showInformationMessage("No .robot files selected.");
        return;
    }

    // Convert selected URIs to file paths
    const robotFilePaths = selectedFiles.map((uri) => uri.fsPath);

    // Ask the user to select an output directory for the results
    const outputFolderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        openLabel: "Select Output Folder For Test Results",
    });

    if (!outputFolderUri || outputFolderUri.length === 0) {
        vscode.window.showInformationMessage("No output folder selected.");
        return;
    }

    const outputFolder = outputFolderUri[0].fsPath;

    try {
        // Ensure the output directory exists
        if (!fs.existsSync(outputFolder)) {
            fs.mkdirSync(outputFolder, { recursive: true });
        }

        // Run Robot Framework tests and save the results
        vscode.window.showInformationMessage("Running Robot Framework tests...");

        await runRobotTests(robotFilePaths, outputFolder);

        vscode.window.showInformationMessage("Tests completed successfully. Results saved in: " + outputFolder);
    } catch (error) {
        vscode.window.showErrorMessage("Error running Robot Framework tests: " + error);
    }
}
