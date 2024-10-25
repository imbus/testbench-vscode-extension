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
exports.extractTextFromHtml = extractTextFromHtml;
exports.isReportJobCompletedSuccessfully = isReportJobCompletedSuccessfully;
exports.isImportJobCompletedSuccessfully = isImportJobCompletedSuccessfully;
exports.isImportJobFailed = isImportJobFailed;
exports.fetchZipFile = fetchZipFile;
exports.pollJobStatus = pollJobStatus;
exports.delay = delay;
exports.extractZip = extractZip;
exports.loadJsonFilesFromDirectory = loadJsonFilesFromDirectory;
exports.parseJsonFile = parseJsonFile;
exports.processTestCaseFile = processTestCaseFile;
exports.createTestSuitesFromFiles = createTestSuitesFromFiles;
exports.writeRobotFrameworkTestSuites = writeRobotFrameworkTestSuites;
exports.testBenchToRobotFramework = testBenchToRobotFramework;
exports.startTestGenerationProcess = startTestGenerationProcess;
exports.isValidTestJSON = isValidTestJSON;
exports.createOutputFolderIfNotExists = createOutputFolderIfNotExists;
exports.saveTestbench2RobotConfigurationAsJson = saveTestbench2RobotConfigurationAsJson;
exports.deleteConfigurationFile = deleteConfigurationFile;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const JSZip = __importStar(require("jszip")); // npm install jszip
const cheerio = __importStar(require("cheerio")); // To parse HTML  npm install --save-dev @types/cheerio
const axios_1 = __importDefault(require("axios"));
const projectManagementTreeView_1 = require("./projectManagementTreeView");
const extension_1 = require("./extension");
// Prompt the user to select the export report method (Execution based or Specification based)
async function selectExecutionOrSpecificationBased() {
    let executionBased = true; // Default value is "Execution based"
    // We return a new Promise here, which will resolve with the result after user interaction
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
                    executionBased = selection[0].label === "Execution based";
                    resolve(executionBased); // Resolve with the selected option
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
// Function to extract text content from HTML
function extractTextFromHtml(htmlContent) {
    if (!htmlContent || typeof htmlContent !== "string") {
        return "";
    }
    try {
        const $ = cheerio.load(htmlContent);
        const text = $("body").text(); // Select the body element and extract text content
        // Replace newlines and extra spaces with a single space
        return text.replace(/\s+/g, " ").trim();
    }
    catch (error) {
        console.error("Error parsing HTML content:", error);
        return "";
    }
}
// Helper function to check if the job has completed successfully.
function isReportJobCompletedSuccessfully(jobStatus) {
    return !!jobStatus?.completion?.result?.ReportingSuccess?.reportName;
}
function isImportJobCompletedSuccessfully(jobStatus) {
    return !!jobStatus?.completion?.result?.ExecutionImportingSuccess;
}
function isImportJobFailed(jobStatus) {
    return !!jobStatus?.completion?.result?.ExecutionImportingFailure;
}
// Fetch the TestBench JSON report from the server (ZIP Archive).
// 3 Calls are needed to download the zip report:
// 1. Get the job ID
// 2. Get the job status (polling until the job is completed)
// 3. Download the report zip file.
async function fetchZipFile(connection, baseKey, projectKey, cycleKey, progress, folderNameToDownloadReport, requestParams, cancellationToken) {
    try {
        console.log(`Fetching zip file for projectKey: ${projectKey}, cycleKey: ${cycleKey}.`);
        const jobId = await getJobId(connection, projectKey, cycleKey, requestParams);
        console.log(`Job ID (${jobId}) fetched successfully.`);
        const jobStatus = await pollJobStatus(connection, projectKey, jobId, "report", progress, cancellationToken);
        if (!jobStatus || !isReportJobCompletedSuccessfully(jobStatus)) {
            console.warn("Report generation not completed or failed.");
            vscode.window.showErrorMessage("Report generation not completed or failed.");
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
            console.log("Download canceled or failed.");
        }
    }
    catch (error) {
        if (error instanceof vscode.CancellationError) {
            console.log("Operation cancelled by the user.");
            vscode.window.showInformationMessage("Operation cancelled by the user.");
            return undefined;
        }
        else {
            console.error(`Error in fetchZipFile: ${error}`);
            handleError(error, projectKey, cycleKey);
        }
    }
}
// TODO : Create separate polls/interfaces for report and import job status?
async function pollJobStatus(connection, projectKey, jobId, jobType, progress, cancellationToken, maxPollingTimeMs // Optional timeout, disabled by default so that the user can cancel manually
) {
    const startTime = Date.now(); // Start time for the polling to adjust the polling interval after 10 seconds
    let attempt = 0;
    let jobStatus = null;
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
// Get the job ID from server
async function getJobId(connection, projectKey, cycleKey, requestParams) {
    const url = `${connection.getBaseURL()}/projects/${projectKey}/cycles/${cycleKey}/report/v1`;
    console.log(`Sending request to fetch job ID for projectKey: ${projectKey}, cycleKey: ${cycleKey} to the URL ${url}.`);
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
// Get the job status from server
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
// Download the report zip file
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
            console.log(`Using configuration as download location: ${workspaceLocation}`);
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
// Utility function for adding delay
function delay(ms) {
    // console.log(`Waiting for ${ms} milliseconds for Job completion.`);
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// Error handling function
function handleError(error, projectKey, cycleKey) {
    if (axios_1.default.isAxiosError(error) && error.response?.status === 404) {
        console.error("Project, cycle, tree root UID, filter, or test theme UID not found.", error);
        throw new Error("Resource not found.");
    }
    else {
        console.error(`Error fetching zip file for projectKey: ${projectKey}, cycleKey: ${cycleKey}`, error);
        throw error;
    }
}
// Extract the ZIP file to an output directory
async function extractZip(zipFilePath, outputDir, extractOnlyJson = true // Optional parameter to extract only JSON files
) {
    try {
        // console.debug(`Starting extraction of ${zipFilePath} to ${outputDir}`);
        // 1. Check if the ZIP file exists
        if (!fs.existsSync(zipFilePath)) {
            throw new Error(`ZIP file not found: ${zipFilePath}`);
        }
        // 2. Create the output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
            // console.debug(`Created output directory: ${outputDir}`);
        }
        // 3. Read the ZIP file
        const zipFileContent = await fs.promises.readFile(zipFilePath);
        const zip = await JSZip.loadAsync(zipFileContent);
        // Flags to track user decisions for overwriting or skipping
        let overwriteAll = false;
        let skipAll = false;
        // 4. Iterate through the files in the ZIP archive
        for (const fileName in zip.files) {
            const file = zip.files[fileName];
            const extractedPath = path.join(outputDir, fileName);
            // 5. Check if the entry is a JSON file (if extractOnlyJson is true)
            if (extractOnlyJson && !fileName.toLowerCase().endsWith(".json")) {
                continue; // Skip this entry
            }
            // Check if the file is a directory
            if (file.dir) {
                // Create directories
                fs.mkdirSync(extractedPath, { recursive: true });
            }
            else {
                // Extract the file
                const fileContent = await file.async("nodebuffer");
                // Check if the file already exists
                if (fs.existsSync(extractedPath)) {
                    // Prompt the user until all files are processed or until user chooses to overwrite/skip all
                    if (!overwriteAll && !skipAll) {
                        // Prompt the user for overwrite or skip options
                        const options = ["Overwrite", "Skip", "Overwrite All", "Skip All"];
                        const result = await vscode.window.showWarningMessage(`The file "${fileName}" already exists. What would you like to do?`, { modal: true }, // Modal dialog
                        ...options);
                        // Handle the user's response and update flags accordingly
                        switch (result) {
                            case "Overwrite":
                                await fs.promises.writeFile(extractedPath, fileContent);
                                break;
                            case "Skip":
                                break;
                            case "Overwrite All":
                                overwriteAll = true;
                                await fs.promises.writeFile(extractedPath, fileContent);
                                break;
                            case "Skip All":
                                skipAll = true;
                                break;
                            default: // Handle undefined result (e.g., if dialog is closed)
                                // No action needed
                                break;
                        }
                    }
                    else if (overwriteAll) {
                        // If user chose to overwrite all, directly overwrite
                        await fs.promises.writeFile(extractedPath, fileContent);
                    }
                    else if (skipAll) {
                        // If user chose to skip all, directly skip
                        // No action needed
                    }
                }
                else {
                    // Extract file if it doesn't exist
                    await fs.promises.writeFile(extractedPath, fileContent);
                }
            }
        }
    }
    catch (err) {
        console.error(`Extraction failed: ${err}`);
        throw err;
    }
}
// Function to load JSON files from extracted directory
function loadJsonFilesFromDirectory(dir) {
    try {
        console.debug(`Attempting to read JSON files from directory: ${dir}`);
        const files = fs.readdirSync(dir);
        const jsonFiles = files.filter((file) => file.endsWith(".json")).map((file) => path.join(dir, file));
        console.debug(`Found ${jsonFiles.length} JSON files in the directory.`);
        return jsonFiles;
    }
    catch (error) {
        console.error(`Error loading JSON files from directory: ${error}`);
        // Re-throwing the error or returning an empty array
        throw error;
    }
}
// Function to parse JSON content
function parseJsonFile(filePath) {
    try {
        console.debug(`Attempting to parse JSON file: ${filePath}`);
        const content = fs.readFileSync(filePath, "utf-8");
        const parsedData = JSON.parse(content);
        console.debug(`Successfully parsed JSON file: ${filePath}`);
        return parsedData;
    }
    catch (error) {
        console.error(`Error parsing JSON file ${filePath}: ${error}`);
        // Re-throwing the error or returning null
        throw error;
    }
}
// Function to process the Test Case files
function processTestCaseFile(filePath) {
    try {
        console.debug(`Processing test case file: ${filePath}`);
        const data = parseJsonFile(filePath);
        // Check if interactions exist and if any of them have 'sequencePhase' = 'TestStep'
        if (data.interactions && Array.isArray(data.interactions)) {
            console.debug(`Found test case with steps in file: ${filePath}`);
            const testSteps = data.interactions
                .filter((interaction) => interaction.spec?.sequencePhase === "TestStep")
                .map((interaction) => interaction.name);
            if (testSteps.length > 0) {
                return {
                    uniqueID: data.uniqueID || "UnnamedTest",
                    name: data.uniqueID || "UnnamedTest",
                    steps: testSteps.map((step) => `    ${step}`), // Format steps for Robot Framework
                };
            }
        }
        console.debug(`No test case found in file: ${filePath}`);
        return null;
    }
    catch (error) {
        console.error(`Error processing test case file ${filePath}: ${error}`);
        // Re-throwing or returning null
        throw error;
    }
}
// Function to extract the theme ID or grouping identifier from a Test Case JSON file
function extractThemeIDFromTestCaseFile(filePath) {
    try {
        console.debug(`Extracting theme ID from test case file: ${filePath}`);
        const data = parseJsonFile(filePath);
        if (data.numbering) {
            console.debug(`Using 'numbering' field as theme ID: ${data.numbering}`);
            return data.numbering;
        }
        if (data.spec && data.spec.key) {
            console.debug(`Using 'spec.key' field as theme ID: Spec-${data.spec.key}`);
            return `Spec-${data.spec.key}`;
        }
        if (data.uniqueID) {
            console.debug(`Using 'uniqueID' field as theme ID: UniqueID-${data.uniqueID}`);
            return `UniqueID-${data.uniqueID}`;
        }
        console.debug(`No suitable theme ID found, using default: UnknownTheme`);
        return "UnknownTheme";
    }
    catch (error) {
        console.error(`Error extracting theme ID from ${filePath}: ${error}`);
        // Consider re-throwing or returning a default value
        throw error;
    }
}
// Function to create Test Suites based on themes and test cases
function createTestSuitesFromFiles(files) {
    try {
        console.debug(`Creating test suites from ${files.length} files`);
        const testSuites = [];
        files.forEach((filePath) => {
            // Process the files that begins with iTB-TC-
            if (filePath.includes("iTB-TC-")) {
                // Process the Test Case file
                const testCase = processTestCaseFile(filePath);
                if (testCase) {
                    const themeID = extractThemeIDFromTestCaseFile(filePath);
                    let testSuite = testSuites.find((suite) => suite.themeID === themeID);
                    if (!testSuite) {
                        testSuite = { themeID, testCases: [] };
                        testSuites.push(testSuite);
                    }
                    testSuite.testCases.push(testCase);
                }
            }
        });
        console.debug(`Created ${testSuites.length} test suites`);
        return testSuites;
    }
    catch (error) {
        console.error(`Error creating test suites: ${error}`);
        throw error;
    }
}
// Function to write Robot Framework test suites to files
async function writeRobotFrameworkTestSuites(testSuites, config) {
    let overwriteAll = false;
    let ignoreAll = false;
    for (const suite of testSuites) {
        const suiteDir = path.join(config.generationDirectory, suite.themeID);
        if (!fs.existsSync(suiteDir)) {
            fs.mkdirSync(suiteDir, { recursive: true });
        }
        const filePath = path.join(suiteDir, `${suite.themeID}.robot`);
        const fileContent = `*** Test Cases ***\n`;
        if (fs.existsSync(filePath)) {
            if (ignoreAll) {
                console.log(`Ignoring ${filePath}`);
                continue;
            }
            if (!overwriteAll) {
                // Display a modal dialog with more space for the message
                const userResponse = await vscode.window.showInformationMessage(`The file ${filePath} already exists. What would you like to do?`, { modal: true }, "Overwrite", "Overwrite All", "Ignore", "Ignore All");
                if (userResponse === "Overwrite All") {
                    overwriteAll = true;
                }
                else if (userResponse === "Ignore All") {
                    ignoreAll = true;
                    console.log(`Ignoring all future occurrences.`);
                    continue;
                }
                else if (userResponse === "Ignore") {
                    console.log(`Ignoring ${filePath}`);
                    continue;
                }
            }
        }
        // Overwrite file (clear old contents)
        fs.writeFileSync(filePath, fileContent);
        // Append new test cases
        suite.testCases.forEach((testCase) => {
            const caseContent = `${testCase.name}\n${testCase.steps.join("\n")}\n`;
            fs.appendFileSync(filePath, caseContent);
        });
        console.log(`Test suite written to ${filePath}`);
    }
}
// Function to delete files and directories recursively
function removeDirectoryRecursively(directoryPath) {
    if (fs.existsSync(directoryPath)) {
        fs.readdirSync(directoryPath).forEach((file) => {
            const currentPath = path.join(directoryPath, file);
            if (fs.lstatSync(currentPath).isDirectory()) {
                // Recursively remove directories
                removeDirectoryRecursively(currentPath);
            }
            else {
                // Remove files
                fs.unlinkSync(currentPath);
            }
        });
        fs.rmdirSync(directoryPath); // Remove the directory itself
        console.log(`Directory removed: ${directoryPath}`);
    }
}
// Function to clean up the extracted files
function removeExtractedFiles(extractDir) {
    console.log(`Removing extracted files from: ${extractDir}`);
    removeDirectoryRecursively(extractDir);
}
// Select an output folder inside VS Code
async function selectOutputFolder(baseKey) {
    const config = vscode.workspace.getConfiguration(baseKey);
    let workspaceLocation = config.get("workspaceLocation");
    if (workspaceLocation) {
        if (fs.existsSync(workspaceLocation)) {
            console.log(`Using configuration as output folder: ${workspaceLocation}`);
            return workspaceLocation;
        }
        else {
            console.error(`The configured output folder does not exist: ${workspaceLocation}`);
            vscode.window.showErrorMessage(`The configured output folder does not exist: ${workspaceLocation}`);
        }
    }
    // Show a dialog to select a folder
    const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false, // Only allow folder selection
        canSelectFolders: true, // Allow selecting folders
        canSelectMany: false, // Only allow one folder to be selected
        openLabel: "Select Output Folder zip extraction", // Custom label for the open button
    });
    if (folderUri && folderUri.length > 0) {
        // Return the path of the selected folder
        return folderUri[0].fsPath;
    }
    // Return undefined if no folder is selected
    return undefined;
}
// Main function to handle the process
async function testBenchToRobotFramework(treeItem, itemLabel, baseKey, projectKey, cycleKey, connection, workingDirectory) {
    // Execution based or specification based request parameter
    const executionBased = await selectExecutionOrSpecificationBased();
    console.log("executionBased value set to:", executionBased);
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
            ...testThemeNodes.map(node => ({
                label: node.numbering ? `${node.numbering} ${node.name}` : node.name,
                description: `ID: ${node.uniqueID}`,
                uniqueID: node.uniqueID
            }))
        ];
        // Show the QuickPick prompt and return the uniqueID of the selected item
        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select a test theme or "Generate all" to generate all tests under the cycle.',
        });
        if (!selected) {
            return undefined;
        }
        // Return "Generate all" if that option was selected, otherwise the uniqueID
        return selected?.label === "Generate all" ? "Generate all" : selected.uniqueID;
    }
    const UIDofSelectedElement = await showTestThemeNodes(treeItem);
    if (!UIDofSelectedElement) {
        console.log(`Test theme selection is empty.`);
        vscode.window.showInformationMessage(`Test theme selection is empty.`);
        return;
    }
    const cycleStructureOptionsRequestParameter = {
        basedOnExecution: executionBased,
        treeRootUID: UIDofSelectedElement === "Generate all" ? "" : UIDofSelectedElement,
    };
    console.log(`Started Test generation.`);
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
                console.log("Download canceled or failed.");
                return; // Exit if the download was canceled or failed
            }
            if (progress) {
                progress.report({
                    increment: 10,
                    message: `Extracting ZIP file.`,
                });
            }
            // Select the output folder to generate the test suites
            const chosenOutputFolderForZipExtraction = await selectOutputFolder(baseKey);
            if (!chosenOutputFolderForZipExtraction) {
                vscode.window.showErrorMessage("No folder selected.");
                return;
            }
            // Create configuration json object called testbench2robotframeworkConfig.json
            await saveTestbench2RobotConfigurationAsJson();
            // tb2robot write -c testbench2robotframeworkConfig.json ReportWithoutResultsForTb2robot.zip (zip Path is downloadedZipFilePath)
            // tb2robot read -o output\output.xml -r ReportWithResults.zip ReportWithoutResultsForTb2robot.zip (ReportWithResults.zip is a configurable name)
            // @@ Start of testbench2robotframework library
            // TODO: Replace all the code between start and end with testbench2robotframework library usage
            // Paths for extracted files and generated test cases
            const folderNameOfExtractedZip = `Extracted Files`;
            const zipExtractionFolderPath = path.join(chosenOutputFolderForZipExtraction, folderNameOfExtractedZip);
            const folderNameOfRobotFiles = `Generated Test Cases`;
            const robotFilesFolderPath = path.join(chosenOutputFolderForZipExtraction, folderNameOfRobotFiles);
            // Extract ZIP file
            // TODO: Extracting (and removeExtractedFiles) is not needed if testbench2robotframework library can use the zip file directly
            await extractZip(downloadedZipFilePath, zipExtractionFolderPath);
            console.log(`ZIP file extracted to: ${zipExtractionFolderPath}`);
            if (progress) {
                progress.report({
                    increment: 10,
                    message: `Processing JSON files to create test cases.`,
                });
            }
            console.log(`Starting convertJSONsIntoTestCases with path: ${zipExtractionFolderPath}`);
            await convertJSONsIntoTestCases(zipExtractionFolderPath, robotFilesFolderPath);
            let removeExtractedFilesFlag = false;
            if (removeExtractedFilesFlag) {
                if (progress) {
                    progress.report({
                        increment: 10,
                        message: `Removing extracted files.`,
                    });
                }
                removeExtractedFiles(zipExtractionFolderPath);
            }
            // @@ End of testbench2robotframework library
            // Delete created json config file after usage
            deleteConfigurationFile();
            vscode.window.showInformationMessage(`Test suite generation done.`);
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
// Entry point for the test generation process
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
// Function to read and parse a JSON file asynchronously
async function readJSONFile(filePath) {
    try {
        const data = await fs.promises.readFile(filePath, "utf8");
        return JSON.parse(data);
    }
    catch (error) {
        throw new Error(`Error reading JSON file at ${filePath}: ${error.message}`);
    }
}
// Writes content to a file asynchronously
async function writeContentToFile(filePath, content) {
    console.log(`Writing content to file: ${filePath}`);
    try {
        await fs.promises.writeFile(filePath, content, "utf8");
    }
    catch (error) {
        throw new Error(`Error writing to file at ${filePath}: ${error.message}`);
    }
}
// Generates Robot Framework test case steps from interactions
function generateTestCaseSection(interactions) {
    return interactions.reduce((testCase, interaction) => {
        if (interaction.spec.sequencePhase === "TestStep") {
            testCase += processTestStepInteraction(interaction);
        }
        if (interaction.interactions && interaction.interactions.length > 0) {
            testCase += generateTestCaseSection(interaction.interactions);
        }
        return testCase;
    }, "");
}
// Generates the Settings section for the Robot Framework test case
function generateSettingsSection(jsonData) {
    let settings = "*** Settings ***\n";
    settings += "\n";
    return settings;
}
// Processes an individual test step interaction
function processTestStepInteraction(interaction) {
    if (interaction.interactionType === "Textual") {
        return processTextualInteraction(interaction);
    }
    else if (interaction.interactionType === "Atomic") {
        return processAtomicInteraction(interaction);
    }
    return "";
}
// Processes textual test step interactions
function processTextualInteraction(interaction) {
    const descriptionText = extractTextFromHtml(interaction.spec.description);
    const commentsText = extractTextFromHtml(interaction.spec.comments);
    return descriptionText ? `    ${descriptionText}    # ${commentsText || ""}\n` : "";
}
// Processes atomic test step interactions
function processAtomicInteraction(interaction) {
    let step = `    ${interaction.name}`;
    if (interaction.parameters && interaction.parameters.length > 0) {
        interaction.parameters.forEach((parameter) => {
            step += `    ${parameter.name}: ${parameter.value}`;
        });
    }
    return `${step}\n`;
}
// Function to validate JSON structure for the required fields to generate Robot Framework test case
function isValidTestJSON(jsonData) {
    return jsonData && Array.isArray(jsonData.interactions);
}
// TODO: Rewrite this function after testbench2robotframework library is updated.
// use startTestbench2robotframework function
// Converts JSON files in a directory to Robot Framework test cases
async function convertJSONsIntoTestCases(folderPathOfJSONFiles, outputFolderOfTestSuites) {
    createOutputFolderIfNotExists(outputFolderOfTestSuites);
    const allJSONFilePaths = await getAllJSONFilePathsFromFolder(folderPathOfJSONFiles);
    if (allJSONFilePaths.length === 0) {
        console.log("No JSON files found.");
        return;
    }
    await Promise.all(allJSONFilePaths.map((jsonFile) => processSingleJSONFile(jsonFile, outputFolderOfTestSuites)));
}
// Ensures the output folder exists
function createOutputFolderIfNotExists(outputFolder) {
    if (!fs.existsSync(outputFolder)) {
        fs.mkdirSync(outputFolder);
        console.log(`Created output folder: ${outputFolder}`);
    }
}
// Retrieves a list of JSON files from the folder
async function getAllJSONFilePathsFromFolder(folderPathOfJSONFiles) {
    try {
        const files = await fs.promises.readdir(folderPathOfJSONFiles);
        // Filter non JSON files and return the full path for each file as a string array
        return files.filter((file) => file.endsWith(".json")).map((file) => path.join(folderPathOfJSONFiles, file));
    }
    catch (error) {
        throw new Error(`Error reading folder ${folderPathOfJSONFiles}: ${error.message}`);
    }
}
// Processes a single JSON file and generates a Robot Framework test case
async function processSingleJSONFile(jsonFilePath, outputFolder) {
    try {
        const jsonData = await readJSONFile(jsonFilePath);
        if (!isValidTestJSON(jsonData)) {
            console.warn(`Invalid test structure in file: ${jsonFilePath}`);
            return;
        }
        const testCaseName = jsonData.uniqueID || path.basename(jsonFilePath, ".json");
        let robotFileContent = "";
        // Generate Settings Section
        robotFileContent += generateSettingsSection(jsonData);
        // Generate Test Cases Section
        robotFileContent += `*** Test Cases ***\n${testCaseName}\n`;
        robotFileContent += generateTestCaseSection(jsonData.interactions);
        // robotFile = generateTestSuite(jsonData);
        const generatedRobotFilePath = path.join(outputFolder, `${testCaseName}.robot`);
        await writeContentToFile(generatedRobotFilePath, `${robotFileContent}`);
        console.log(`Generated Robot Framework test case: ${generatedRobotFilePath}`);
    }
    catch (error) {
        console.error(`Error processing file ${jsonFilePath}: ${error.message}`);
    }
}
/**
 * Main function to write the generation configuration to a JSON file.
 */
async function saveTestbench2RobotConfigurationAsJson() {
    try {
        const generationConfig = (0, extension_1.getGenerationConfiguration)();
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
 * Determines the file path where the configuration file will be saved.
 */
async function getConfigurationFilePath() {
    const workspaceFolder = getWorkspaceFolder();
    const fileName = "testbench2robotframeworkConfig.json";
    const filePath = path.join(workspaceFolder, fileName);
    return filePath;
}
/**
 * Retrieves the path of the currently opened workspace folder.
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
 * Main function to delete the configuration JSON file.
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