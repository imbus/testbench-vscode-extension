"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTestbench2robotframework = startTestbench2robotframework;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
// Check if testbench2robotframework is installed
function isTestbench2robotframeworkInstalled() {
    return new Promise((resolve) => {
        let robotPath = "tb2robot";
        const robotProcess = (0, child_process_1.spawn)(robotPath, ["--version"]);
        robotProcess.stdout.on("data", (data) => {
            const output = data.toString();
            console.log("stdout:", output);
            if (output.includes("TestBench2RobotFramework")) {
                resolve(true);
            }
            else {
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
function testbench2robotframeworkWrite(configurationJSONFile, reportZipPath) {
    return new Promise((resolve, reject) => {
        const command = `tb2robot write -c ${configurationJSONFile} ${reportZipPath}`;
        (0, child_process_1.exec)(command, (error, stdout, stderr) => {
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
function testbench2robotframeworkRead(resultXMLPath, testResultsPath, jsonReportPath) {
    return new Promise((resolve, reject) => {
        let command = `tb2robot read ${resultXMLPath}`;
        if (testResultsPath) {
            command += ` ${testResultsPath}`;
        }
        if (jsonReportPath) {
            command += ` ${jsonReportPath}`;
        }
        (0, child_process_1.exec)(command, (error, stdout, stderr) => {
            if (error) {
                reject(stderr || stdout);
                return;
            }
            resolve();
        });
    });
}
async function startTestbench2robotframework(configurationJSONFile, reportZipPath) {
    const isInstalled = await isTestbench2robotframeworkInstalled();
    if (!isInstalled) {
        vscode.window.showErrorMessage("testbench2robotframework is not installed. Please install it to run the commands.");
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
//# sourceMappingURL=testbench2robotframeworkLib.js.map