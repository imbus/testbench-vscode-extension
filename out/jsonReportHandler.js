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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExecutionBasedReportSelected = isExecutionBasedReportSelected;
exports.isReportJobCompletedSuccessfully = isReportJobCompletedSuccessfully;
exports.isImportJobCompletedSuccessfully = isImportJobCompletedSuccessfully;
exports.isImportJobFailed = isImportJobFailed;
exports.fetchZipFile = fetchZipFile;
exports.pollJobStatus = pollJobStatus;
exports.getJobId = getJobId;
exports.getJobStatus = getJobStatus;
exports.downloadReport = downloadReport;
exports.delay = delay;
exports.testBenchToRobotFramework = testBenchToRobotFramework;
exports.startTestGenerationProcess = startTestGenerationProcess;
exports.saveTestbench2RobotConfigurationAsJson = saveTestbench2RobotConfigurationAsJson;
exports.deleteConfigurationFile = deleteConfigurationFile;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const projectManagementTreeView_1 = require("./projectManagementTreeView");
/**
 * Prompt the user to select the export report method in quick pick format (Execution based or Specification based).
 * @returns Promise<boolean | null> - Resolves with the selected option (true for Execution based, false for Specification based) or null if the user cancels the selection.
 */
async function isExecutionBasedReportSelected() {
    // Return a Promise, which will resolve with the result after user interaction
    return new Promise((resolve) => {
        // Create the quick pick input
        const quickPick = vscode.window.createQuickPick();
        quickPick.items = [{ label: "Execution based" }, { label: "Specification based" }, { label: "Cancel" }];
        quickPick.title = "Select Export Option";
        quickPick.placeholder = "Select the export option for the reports.";
        // Handle the user selection
        quickPick.onDidChangeSelection((selection) => {
            if (selection[0]) {
                if (selection[0].label === "Cancel") {
                    resolve(null); // Resolve with null if the user selects "Cancel"
                }
                else {
                    resolve(selection[0].label === "Execution based"); // Resolve with the selected option
                }
                quickPick.hide(); // Close the quick pick after selection
            }
        });
        // Handle case when the quick pick is hidden without user selection (e.g., if user clicks away)
        quickPick.onDidHide(() => {
            resolve(null);
            quickPick.dispose(); // Clean up resources after closing
        });
        quickPick.show(); // Show the quick pick to the user
    });
}
// Checks if the report job has completed successfully.
function isReportJobCompletedSuccessfully(jobStatus) {
    return !!jobStatus?.completion?.result?.ReportingSuccess?.reportName;
}
// Checks if the import job has completed successfully.
function isImportJobCompletedSuccessfully(jobStatus) {
    return !!jobStatus?.completion?.result?.ExecutionImportingSuccess;
}
// Checks if the import job has failed.
function isImportJobFailed(jobStatus) {
    return !!jobStatus?.completion?.result?.ExecutionImportingFailure;
}
/**
 * Fetch the TestBench JSON report (ZIP Archive) from the server.
 * 3 Calls are needed to download the zip report:
 * 1. Get the job ID
 * 2. Get the job status (polling until the job is completed)
 * 3. Download the report zip file.
 *
 * @param connection Connection object to the server
 * @param baseKey The base key of the extension
 * @param projectKey The project key
 * @param cycleKey The cycle key
 * @param progress Progress bar to show the poll attempts to the user
 * @param folderNameToDownloadReport The folder name to save the downloaded report
 * @param requestParams Optional request parameters (exec/spec based, root UID) for the job ID request
 * @param cancellationToken Cancellation token to be able to cancel the polling by clicking cancel button
 * @returns The path of the downloaded zip file if the download was successful, otherwise undefined
 */
async function fetchZipFile(connection, baseKey, projectKey, cycleKey, progress, folderNameToDownloadReport, requestParams, cancellationToken) {
    try {
        console.log(`Fetching report for projectKey: ${projectKey}, cycleKey: ${cycleKey}.`);
        const jobId = await getJobId(connection, projectKey, cycleKey, requestParams);
        console.log(`Job ID (${jobId}) fetched successfully.`);
        const jobStatus = await pollJobStatus(connection, projectKey, jobId, "report", progress, cancellationToken);
        if (!jobStatus || !isReportJobCompletedSuccessfully(jobStatus)) {
            console.warn("Report generation was unsuccessful.");
            vscode.window.showErrorMessage("Report generation was unsuccessful.");
            return undefined;
        }
        const fileName = jobStatus.completion.result.ReportingSuccess.reportName;
        console.log(`Report name: ${fileName}`);
        const outputPath = await downloadReport(connection, baseKey, projectKey, fileName, folderNameToDownloadReport);
        if (outputPath) {
            console.log(`Report downloaded and saved to: ${outputPath}`);
            return outputPath;
        }
        else {
            console.warn("Download canceled or failed.");
        }
    }
    catch (error) {
        if (error instanceof vscode.CancellationError) {
            console.log("Operation cancelled by the user.");
            vscode.window.showInformationMessage("Operation cancelled by the user.");
            return undefined;
        }
        else {
            if (axios_1.default.isAxiosError(error) && error.response?.status === 404) {
                throw new Error("Resource not found.");
            }
            else {
                console.error(`Error fetching the report for project ${projectKey} and cycle ${cycleKey}: ${error}`);
                throw error;
            }
        }
    }
}
/**
 * Poll the job status (Either report of import job) until the job is completed.
 * @param connection Connection object to the server
 * @param projectKey Project key
 * @param jobId Job ID received from the server
 * @param jobType Type of job (report or import)
 * @param progress Progress bar to show the poll attempts to the user
 * @param cancellationToken Cancellation token to be able to cancel the polling by clicking cancel button
 * @param maxPollingTimeMs Maximum time to poll the job status, after which the polling will be stopped
 * @returns Job status response object if the job is completed, otherwise null
 */
async function pollJobStatus(connection, projectKey, jobId, jobType, progress, cancellationToken, maxPollingTimeMs // Optional timeout, disabled by default so that the user can cancel manually
) {
    const startTime = Date.now(); // Start time for the polling to adjust the polling interval after 10 seconds
    let attempt = 0;
    let jobStatus = null;
    // Poll the job status until the job is completed with either success or failure
    while (true) {
        if (cancellationToken?.isCancellationRequested) {
            console.log("Operation cancelled by the user.");
            vscode.window.showInformationMessage("Operation cancelled by the user.");
            throw new vscode.CancellationError();
        }
        attempt++;
        try {
            jobStatus = await getJobStatus(connection, projectKey, jobId, jobType);
            console.log(`Attempt ${attempt}: Job Status fetched.`);
            if (jobType === "report") {
                if (isReportJobCompletedSuccessfully(jobStatus)) {
                    console.log("Report job completed successfully.");
                    return jobStatus;
                }
                else {
                    // console.log("Job not yet completed.");
                }
            }
            else if (jobType === "import") {
                if (isImportJobCompletedSuccessfully(jobStatus)) {
                    console.log("Import job completed successfully.");
                    return jobStatus;
                }
                else if (isImportJobFailed(jobStatus)) {
                    return null;
                }
            }
        }
        catch (error) {
            console.error(`Attempt ${attempt}: Failed to get job status. Error: ${error}`);
        }
        if (progress) {
            progress.report({
                message: `Fetching Job status. Attempt ${attempt}.`,
            });
        }
        // (Optional) Check if the maximum polling time has been exceeded.
        if (maxPollingTimeMs !== undefined) {
            const elapsedTime = Date.now() - startTime;
            if (elapsedTime >= maxPollingTimeMs) {
                console.warn("Maximum polling time exceeded. Aborting job status polling.");
                break;
            }
        }
        // Adjust polling interval based on elapsed time.
        // For the first 10 seconds, poll every 200 ms, then poll every 1 second.
        const elapsedTime = Date.now() - startTime;
        const delayMs = elapsedTime < 10000 ? 200 : 1000;
        // console.log(`Waiting ${delayMs} ms before next attempt.`);
        await delay(delayMs);
    }
    return jobStatus;
}
/**
 * Get the job ID from server
 * @param connection Connection object to the server
 * @param projectKey The project key
 * @param cycleKey The cycle key
 * @param requestParams Optional request parameters (exec/spec based, root UID) for the job ID request
 * @returns The job ID received from the server
 */
async function getJobId(connection, projectKey, cycleKey, requestParams) {
    const url = `${connection.getBaseURL()}/projects/${projectKey}/cycles/${cycleKey}/report/v1`;
    // console.log(`Sending request to fetch job ID for projectKey: ${projectKey}, cycleKey: ${cycleKey} to the URL ${url}.`);
    const jobIdResponse = await axios_1.default.post(url, requestParams, {
        headers: {
            accept: "application/json",
            Authorization: connection.getSessionToken(), // Include session token for authorization
            "Content-Type": "application/json",
        },
    });
    if (jobIdResponse.status !== 200) {
        throw new Error(`Failed to fetch job ID, status code: ${jobIdResponse.status}`);
    }
    return jobIdResponse.data.jobID;
}
/**
 * Get the job status from server
 * @param connection Connection object to the server
 * @param projectKey The project key
 * @param jobId The job ID received from the server
 * @param jobType The type of job (report or import)
 * @returns The job status response object
 */
async function getJobStatus(connection, projectKey, jobId, jobType) {
    const url = `${connection.getBaseURL()}/projects/${projectKey}/${jobType}/job/${jobId}/v1`;
    console.log(`Checking job status: ${url}`);
    const jobStatusResponse = await axios_1.default.get(url, {
        headers: {
            accept: "application/vnd.testbench+json",
            Authorization: connection.getSessionToken(),
        },
    });
    console.log("jobStatusResponse:", jobStatusResponse);
    if (jobStatusResponse.status !== 200) {
        throw new Error(`Failed to fetch job status, status code: ${jobStatusResponse.status}`);
    }
    return jobStatusResponse.data;
}
/**
 * Download the report zip file from the server to local storage and return the path of the downloaded file.
 * @param connection Connection object to the server
 * @param baseKey  The base key of the extension
 * @param projectKey The project key
 * @param fileName The name of the report file to download
 * @param folderNameToDownloadReport  The folder name to save the downloaded report
 * @returns The path of the downloaded zip file if the download was successful, otherwise undefined
 */
async function downloadReport(connection, baseKey, projectKey, fileName, folderNameToDownloadReport) {
    const url = `${connection.getBaseURL()}/projects/${projectKey}/report/${fileName}/v1`;
    console.log(`Sending request to download report ${fileName} to URL ${url}.`);
    const downloadZipResponse = await axios_1.default.get(url, {
        responseType: "arraybuffer", // Expecting binary data
        headers: {
            accept: "application/vnd.testbench+json",
            Authorization: connection.getSessionToken(),
        },
    });
    if (downloadZipResponse.status !== 200) {
        throw new Error(`Failed to download report, status code: ${downloadZipResponse.status}`);
    }
    // Select the output directory to save the report
    const config = vscode.workspace.getConfiguration(baseKey);
    const workspaceLocation = config.get("workspaceLocation");
    if (workspaceLocation) {
        if (fs.existsSync(workspaceLocation)) {
            // console.log(`Using configuration as download location: ${workspaceLocation}`);
            async function saveReportToFile(downloadZipResponse, workspaceLocation, fileName) {
                const uri = vscode.Uri.file(path.join(workspaceLocation, folderNameToDownloadReport, fileName));
                return vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadZipResponse.data)).then(() => {
                    // vscode.window.showInformationMessage(`Report downloaded successfully to ${uri.fsPath}`);
                    return uri.fsPath;
                });
            }
            return await saveReportToFile(downloadZipResponse, workspaceLocation, fileName);
        }
        else {
            console.error(`The configured download location does not exist: ${workspaceLocation}`);
            vscode.window.showErrorMessage(`The configured workspace location does not exist: ${workspaceLocation}`);
        }
    }
    console.log(`Using download location manually selected by the user.`);
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileName),
        filters: { "Zip Files": ["zip"] },
    });
    if (uri) {
        try {
            // Check if the file already exists
            await vscode.workspace.fs.stat(uri);
            // If file exists, ask user if they want to overwrite or skip
            const overwriteOption = await vscode.window.showWarningMessage(`The file "${fileName}" already exists. Do you want to overwrite it?`, { modal: true }, "Overwrite", "Skip");
            if (overwriteOption === "Skip") {
                vscode.window.showInformationMessage("File download skipped.");
                return undefined; // Return if the user chooses to skip
            }
        }
        catch (error) {
            // If the error is because the file does not exist, we proceed with writing
            if (error.code !== "FileNotFound") {
                throw error; // Re-throw any other errors
            }
        }
        await vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadZipResponse.data));
        // vscode.window.showInformationMessage(`Report downloaded successfully to ${uri.fsPath}`);
        return uri.fsPath; // Return the path of the saved file
    }
    return undefined; // Return undefined if no file was saved
}
// Utility function for adding delay in milliseconds
function delay(ms) {
    // console.log(`Waiting for ${ms} milliseconds for Job completion.`);
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Generate Robot Framework test cases from the TestBench JSON report.
 * @param treeItem The selected tree item
 * @param itemLabel The label of the selected tree item
 * @param baseKey The base key of the extension
 * @param projectKey The project key
 * @param cycleKey The cycle key
 * @param connection Connection object to the server
 * @param workingDirectory The path to save the downloaded report
 * @returns Promise<void>
 */
async function testBenchToRobotFramework(treeItem, itemLabel, baseKey, projectKey, cycleKey, connection, workingDirectory) {
    // Execution based or specification based request parameter
    const executionBased = await isExecutionBasedReportSelected();
    // console.log("executionBased value set to:", executionBased);
    if (executionBased === null) {
        console.log(`Test generation aborted.`);
        vscode.window.showInformationMessage(`Test generation aborted.`);
        return;
    }
    /*
    Code for storing treeItem variable as a json file to analyze its structure while removing its parent property to avoid circular reference
    // Function to remove the parent property from an object recursively
    function removeParentProperty(obj: any): any {
        if (Array.isArray(obj)) {
            return obj.map(removeParentProperty);
        } else if (obj !== null && typeof obj === "object") {
            const newObj: any = {};
            for (const key in obj) {
                if (key !== "parent") {
                    newObj[key] = removeParentProperty(obj[key]);
                }
            }
            return newObj;
        }
        return obj;
    }
    // Remove the parent property from treeItem
    const treeItemWithoutParent = removeParentProperty(treeItem);
    // Save the contents of the variable called treeItemWithoutParent to a file called treeItem.json
    const treeItemJsonPath = path.join(getWorkspaceFolder(), "treeItem.json");
    await fs.promises.writeFile(treeItemJsonPath, JSON.stringify(treeItemWithoutParent, null, 2), "utf8");
    */
    // Display all TestThemeNode elements in a QuickPick and return the uniqueID of the selected item
    // to generate tests for only that item or generate all tests.
    async function showTestThemeNodes(treeItem) {
        // Recursively find all TestThemeNode elements in treeItem
        function findTestThemeNodes(node, results = []) {
            if (node.item?.elementType === "TestThemeNode") {
                const name = node.item.base?.name || "Unnamed";
                const uniqueID = node.item.base?.uniqueID || "No ID";
                const numbering = node.item.base?.numbering;
                results.push({ name, uniqueID, numbering });
            }
            if (Array.isArray(node.children)) {
                node.children.forEach((child) => findTestThemeNodes(child, results));
            }
            return results;
        }
        const testThemeNodes = findTestThemeNodes(treeItem);
        // Map the found nodes to a QuickPick items array
        const quickPickItems = [
            { label: "Generate all", description: "Generate All Tests Under The Test Cycle" }, // "Generate all" option is displayed first
            ...testThemeNodes.map((node) => ({
                label: node.numbering ? `${node.numbering} ${node.name}` : node.name,
                description: `ID: ${node.uniqueID}`,
                uniqueID: node.uniqueID,
            })),
        ];
        // Show the QuickPick prompt and return the uniqueID of the selected item
        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select a test theme or select "Generate all" to generate all tests under the cycle.',
        });
        if (!selected) {
            return undefined;
        }
        // Return "Generate all" if that option was selected, otherwise the uniqueID
        return selected?.label === "Generate all" ? "Generate all" : selected.uniqueID;
    }
    const UIDofSelectedElement = await showTestThemeNodes(treeItem);
    if (!UIDofSelectedElement) {
        console.error(`Test theme selection was empty.`);
        // vscode.window.showWarningMessage(`Test theme selection was empty.`);
        return;
    }
    const cycleStructureOptionsRequestParameter = {
        basedOnExecution: executionBased,
        treeRootUID: UIDofSelectedElement === "Generate all" ? "" : UIDofSelectedElement,
    };
    // console.log(`Started Test generation.`);
    // vscode.window.showInformationMessage(`Started Test generation.`);
    // Show a progress bar while the process is running, since this process takes time
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Generating Tests for ${itemLabel}`,
        cancellable: true,
    }, async (progress, cancellationToken) => {
        try {
            if (progress) {
                progress.report({
                    increment: 10,
                    message: `Fetching JSON Report from the server.`,
                });
            }
            // Fetch the ZIP file from the server, passing the cancellationToken
            const downloadedZipFilePath = await fetchZipFile(connection, baseKey, projectKey, cycleKey, progress, workingDirectory, cycleStructureOptionsRequestParameter, cancellationToken // Pass the cancellationToken here
            );
            if (!downloadedZipFilePath) {
                console.warn("Download canceled or failed.");
                return; // Exit if the download was canceled or failed
            }
            if (progress) {
                progress.report({
                    increment: 10,
                    message: `Generating test cases with testbench2robotframework.`,
                });
            }
            // Create configuration json object called testbench2robotframeworkConfig.json
            await saveTestbench2RobotConfigurationAsJson(baseKey);
            // @@ Start of testbench2robotframework library
            /*

            TODO: Call the testbench2robotframework library functions to write (and read for an automated process?) here.
            tb2robot write -c testbench2robotframeworkConfig.json ReportWithoutResultsForTb2robot.zip (zip Path can be accessed with downloadedZipFilePath)
            tb2robot read -o output\output.xml -r ReportWithResults.zip ReportWithoutResultsForTb2robot.zip (ReportWithResults.zip is a configurable name)

            */
            // @@ End of testbench2robotframework library
            // Delete created json config file after usage
            deleteConfigurationFile();
            vscode.window.showInformationMessage(`Test generation done.`);
        }
        catch (error) {
            if (error instanceof vscode.CancellationError) {
                console.log("Process cancelled by the user.");
                vscode.window.showInformationMessage("Process cancelled by the user.");
            }
            else {
                console.error("An error occurred:", error);
                vscode.window.showErrorMessage(`An error occurred: ${error.message || error}`);
            }
            return; // Exit the progress function
        }
    });
}
/**
 * Entry point for the robotframework test generation process from the TestBench JSON report.
 * @param treeItem The selected tree item
 * @param connection Connection object to the server
 * @param baseKey The base key of the extension
 * @param workingDirectory The path to save the downloaded report
 * @returns Promise<void>
 */
async function startTestGenerationProcess(treeItem, connection, baseKey, workingDirectory) {
    // Check if the cycle key is available
    const cycleKey = treeItem.item.key;
    if (cycleKey) {
        const projectKeyOfCycle = (0, projectManagementTreeView_1.findProjectKeyOfCycle)(treeItem);
        if (!projectKeyOfCycle) {
            console.error("Project key of cycle not found.");
            return Promise.resolve([]);
        }
        if (projectKeyOfCycle) {
            // Check if the user is logged in
            if (connection) {
                // Start the generation process
                if (typeof treeItem.label === "string") {
                    testBenchToRobotFramework(treeItem, treeItem.label, baseKey, projectKeyOfCycle, cycleKey, connection, workingDirectory);
                }
                else {
                    vscode.window.showErrorMessage("Invalid label type. Test generation aborted.");
                }
            }
            else {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
            }
        }
        else {
            console.error("Project key of cycle is unidentified!");
            vscode.window.showErrorMessage("Project key of cycle is unidentified!");
            return;
        }
    }
    else {
        console.error("Cycle key is unidentified!");
        vscode.window.showErrorMessage("Cycle key is unidentified!");
        return;
    }
}
/**
 * Writes the testbench2robotframework configuration to a JSON file in workspace folder.
 * @param baseKey The base key of the extension
 */
async function saveTestbench2RobotConfigurationAsJson(baseKey) {
    try {
        const config = vscode.workspace.getConfiguration(baseKey);
        const generationConfig = config.get("testbench2robotframeworkConfig");
        if (!generationConfig) {
            throw new Error("Configuration not found.");
        }
        const jsonContent = JSON.stringify(generationConfig, null, 2);
        const filePath = await getConfigurationFilePath();
        fs.writeFile(filePath, jsonContent, "utf8", (err) => {
            if (err) {
                throw err;
            }
        });
        // vscode.window.showInformationMessage(`Configuration file created at: ${filePath}`);
    }
    catch (error) {
        if (error instanceof Error) {
            vscode.window.showErrorMessage(`Failed to write configuration file: ${error.message}`);
        }
        else {
            vscode.window.showErrorMessage("An unknown error occurred while writing the configuration file.");
        }
    }
}
/**
 * Determines the file path where the testbench2robotframework configuration file will be saved.
 * @returns The file path of the configuration file.
 */
async function getConfigurationFilePath() {
    const workspaceFolder = getWorkspaceFolder();
    const fileName = "testbench2robotframeworkConfig.json";
    const filePath = path.join(workspaceFolder, fileName);
    return filePath;
}
/**
 * Retrieves the path of the currently opened workspace folder.
 * @returns The path of the currently opened workspace folder.
 */
function getWorkspaceFolder() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error("No workspace folder is open. Please open a workspace to save the configuration file.");
    }
    // Handle multiple workspace folders differently
    return workspaceFolders[0].uri.fsPath;
}
/**
 * Deletes the testbench2robotframework configuration file from the workspace folder.
 */
async function deleteConfigurationFile() {
    try {
        const filePath = await getConfigurationFilePath();
        fs.unlink(filePath, (err) => {
            if (err) {
                throw err;
            }
        });
        // vscode.window.showInformationMessage(`Configuration file deleted: ${filePath}`);
    }
    catch (error) {
        if (error.code === "ENOENT") {
            vscode.window.showErrorMessage(`Configuration file not found: ${error.path}`);
        }
        else {
            vscode.window.showErrorMessage(`Failed to delete configuration file: ${error.message}`);
            console.error(error);
        }
    }
}
//# sourceMappingURL=jsonReportHandler.js.map