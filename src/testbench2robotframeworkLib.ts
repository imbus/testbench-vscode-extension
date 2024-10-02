import * as vscode from "vscode";
import { exec, spawn } from "child_process";

// Check if testbench2robotframework is installed
function isTestbench2robotframeworkInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
        let robotPath = "tb2robot";
        const robotProcess = spawn(robotPath, ["--version"]);

        robotProcess.stdout.on("data", (data) => {
            const output = data.toString();
            console.log("stdout:", output);
            if (output.includes("TestBench2RobotFramework")) {
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

// testbench2robotframework: Convert JSONs to Robot Framework Testsuites
function testbench2robotframeworkWrite(configurationJSONFile: string, reportZipPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const command = `tb2robot write -c ${configurationJSONFile} ${reportZipPath}`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(stderr || stdout);
                return;
            }
            resolve();
        });
    });
}

// testbench2robotframework: Write test results back to the Tesbench Json report by reading an XML file and writing the results back to the JSON file
// (Optional parameter) testResultsPath can be a zip file or a folder containing the test results
// (Optional parameter) jsonReportPath can be a zip file or a folder containing the JSON report
// ?? tb2robot write -o .\output.xml -r .\ReportWithResults.zip E:\TestBench\report.zip
function testbench2robotframeworkRead(
    resultXMLPath: string,
    testResultsPath?: string,
    jsonReportPath?: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        let command = `tb2robot read ${resultXMLPath}`;
        if (testResultsPath) {
            command += ` ${testResultsPath}`;
        }
        if (jsonReportPath) {
            command += ` ${jsonReportPath}`;
        }

        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(stderr || stdout);
                return;
            }
            resolve();
        });
    });
}

export async function startTestbench2robotframework(configurationJSONFile: string, reportZipPath: string) {
    const isInstalled = await isTestbench2robotframeworkInstalled();
    if (!isInstalled) {
        vscode.window.showErrorMessage(
            "testbench2robotframework is not installed. Please install it to run the commands."
        );
        return;
    }

    await testbench2robotframeworkWrite(configurationJSONFile, reportZipPath);

    /*
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
    const outputFolderName = "Test Results";
    const outputFolderPath = path.join(outputFolder, outputFolderName);  // This folder will contain the robotframework test results
    */
}
