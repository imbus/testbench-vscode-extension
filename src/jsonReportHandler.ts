import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as unzipper from "unzipper"; // npm install unzipper
import * as cheerio from "cheerio"; // To parse HTML  npm install --save-dev @types/cheerio
import axios, { AxiosResponse } from "axios";
import { PlayServerConnection } from "./testbenchConnection";
import { TestThemeTreeItem, findProjectKeyOfCycle } from "./testThemeTreeView";

// Configuration interface
export interface Configuration {
    generationDirectory: string;
    clearGenerationDirectory: boolean;
    createOutputZip: boolean;
    removeExtractedFiles: boolean; // Option to remove extracted files after processing
}

// Interface for Test Case
export interface TestCase {
    uniqueID: string;
    name: string;
    steps: string[];
}

// Interface for Test Suite containing Test Cases
export interface TestSuite {
    themeID: string;
    testCases: TestCase[];
}

// Optional Cycle Options request body parameter for the TestBench API
interface CycleOptions {
    treeRootUID?: string;
    basedOnExecution?: boolean;
    suppressFilteredData?: boolean;
    suppressNotExecutable?: boolean;
    suppressEmptyTestThemes?: boolean;
    filters?: {
        name: string;
        filterType: "TestTheme";
        testThemeUID: string;
    }[];
}

// Interface representing the optional request body parameters.
interface ReportRequestParams {
    treeRootUID?: string;
    basedOnExecution?: boolean;
    suppressFilteredData?: boolean;
    suppressNotExecutable?: boolean;
    suppressEmptyTestThemes?: boolean;
    filters?: {
        name: string;
        filterType: "TestTheme";
        testThemeUID: string;
    }[];
}

// Interface representing the successful response from the server.
interface JobIdResponse {
    jobID: string;
}

// Interface representing the successful response from the job status GET request.
interface JobStatusResponse {
    id: string;
    projectKey: string;
    owner: string;
    start: string;
    completion: {
        time: string;
        result: {
            Success?: {
                reportName: string;
            };
        };
    };
}

// Prompt the user to select the export report method (Execution based or Specification based)
async function selectExecutionOrSpecificationBased(): Promise<boolean | null> {
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
                } else {
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
function extractTextFromHtml(htmlContent: string): string {
    if (!htmlContent || typeof htmlContent !== "string") {
        return "";
    }

    try {
        const $ = cheerio.load(htmlContent);
        const text = $("body").text(); // Select the body element and extract text content
        // Replace newlines and extra spaces with a single space
        return text.replace(/\s+/g, " ").trim();
    } catch (error) {
        console.error("Error parsing HTML content:", error);
        return "";
    }
}

// Helper function to check if the job has completed successfully.
function isJobCompletedSuccessfully(jobStatus: JobStatusResponse): boolean {
    return !!jobStatus?.completion?.result?.Success?.reportName;
}

// Fetch the TestBench JSON report from the server (ZIP Archive).
// 3 Calls are needed to download the zip report:
// 1. Get the job ID
// 2. Get the job status (polling until the job is completed)
// 3. Download the report zip file.
export async function fetchZipFile(
    connection: PlayServerConnection,
    baseKey: string,
    projectKey: string,
    cycleKey: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    requestParams?: ReportRequestParams,
    cancellationToken?: vscode.CancellationToken
): Promise<string | undefined> {
    try {
        console.log(`Fetching zip file for projectKey: ${projectKey}, cycleKey: ${cycleKey}.`);

        const jobId = await getJobId(connection, projectKey, cycleKey, requestParams);
        console.log(`Job ID (${jobId}) fetched successfully.`);

        const jobStatus = await pollJobStatus(connection, projectKey, jobId, progress, cancellationToken);

        if (!jobStatus || !isJobCompletedSuccessfully(jobStatus)) {
            console.warn("Report generation not completed or failed.");
            vscode.window.showErrorMessage("Report generation not completed or failed.");
            return undefined;
        }

        const fileName = jobStatus.completion.result.Success!.reportName;
        console.log(`Report name: ${fileName}`);

        const outputPath = await downloadReport(connection, baseKey, projectKey, fileName);
        if (outputPath) {
            console.log(`Report downloaded and saved to: ${outputPath}`);
            return outputPath;
        } else {
            console.log("Download canceled or failed.");
        }
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            console.log("Operation cancelled by the user.");
            vscode.window.showInformationMessage("Operation cancelled by the user.");
            return undefined;
        } else {
            console.error(`Error in fetchZipFile: ${error}`);
            handleError(error, projectKey, cycleKey);
        }
    }
}

async function pollJobStatus(
    connection: PlayServerConnection,
    projectKey: string,
    jobId: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken?: vscode.CancellationToken,
    maxPollingTimeMs?: number // Optional timeout, disabled by default so that the user can cancel manually
): Promise<JobStatusResponse | null> {
    const startTime = Date.now(); // Start time for the polling to adjust the polling interval after 10 seconds
    let attempt = 0;
    let jobStatus: JobStatusResponse | null = null;

    while (true) {
        if (cancellationToken?.isCancellationRequested) {
            console.log("Operation cancelled by the user.");
            vscode.window.showInformationMessage("Operation cancelled by the user.");
            throw new vscode.CancellationError();
        }

        attempt++;

        try {
            jobStatus = await getJobStatus(connection, projectKey, jobId);
            // console.log(`Attempt ${attempt}: Job Status fetched.`);

            if (isJobCompletedSuccessfully(jobStatus)) {
                console.log("Job completed successfully.");
                return jobStatus;
            } else {
                // console.log("Job not yet completed.");
            }
        } catch (error) {
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
async function getJobId(
    connection: PlayServerConnection,
    projectKey: string,
    cycleKey: string,
    requestParams?: ReportRequestParams
): Promise<string> {
    const url = `${connection.newPlayServerBaseUrl}/projects/${projectKey}/cycles/${cycleKey}/report/v1`;

    console.log(
        `Sending request to fetch job ID for projectKey: ${projectKey}, cycleKey: ${cycleKey} to the URL ${url}.`
    );

    const jobIdResponse: AxiosResponse<JobIdResponse> = await axios.post(url, requestParams, {
        headers: {
            accept: "application/json",
            Authorization: connection.sessionToken, // Include session token for authorization
            "Content-Type": "application/json",
        },
    });

    if (jobIdResponse.status !== 200) {
        throw new Error(`Failed to fetch job ID, status code: ${jobIdResponse.status}`);
    }

    return jobIdResponse.data.jobID;
}

// Get the job status from server
async function getJobStatus(
    connection: PlayServerConnection,
    projectKey: string,
    jobId: string
): Promise<JobStatusResponse> {
    const url = `${connection.newPlayServerBaseUrl}/projects/${projectKey}/report/job/${jobId}/v1`;

    // console.log(`Checking job status: ${url}`);

    const jobStatusResponse: AxiosResponse<JobStatusResponse> = await axios.get(url, {
        headers: {
            accept: "application/vnd.testbench+json",
            Authorization: connection.sessionToken,
        },
    });

    if (jobStatusResponse.status !== 200) {
        throw new Error(`Failed to fetch job status, status code: ${jobStatusResponse.status}`);
    }

    return jobStatusResponse.data;
}

// Download the report zip file
async function downloadReport(
    connection: PlayServerConnection,
    baseKey: string,
    projectKey: string,
    fileName: string
): Promise<string | undefined> {
    const url = `${connection.newPlayServerBaseUrl}/projects/${projectKey}/report/${fileName}/v1`;

    console.log(`Sending request to download report ${fileName} to URL ${url}.`);

    const downloadZipResponse = await axios.get(url, {
        responseType: "arraybuffer", // Expecting binary data
        headers: {
            accept: "application/vnd.testbench+json",
            Authorization: connection.sessionToken,
        },
    });

    if (downloadZipResponse.status !== 200) {
        throw new Error(`Failed to download report, status code: ${downloadZipResponse.status}`);
    }

    // Select the output directory to save the report
    const config = vscode.workspace.getConfiguration(baseKey);
    const workspaceLocation = config.get<string>("workspaceLocation");

    if (workspaceLocation) {
        if (fs.existsSync(workspaceLocation)) {
            console.log(`Using configuration as download location: ${workspaceLocation}`);
            async function saveReportToFile(
                downloadZipResponse: AxiosResponse<any>,
                workspaceLocation: string,
                fileName: string
            ): Promise<string | undefined> {
                const uri = vscode.Uri.file(path.join(workspaceLocation, fileName));
                return vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadZipResponse.data)).then(() => {
                    vscode.window.showInformationMessage(`Report downloaded successfully to ${uri.fsPath}`);
                    return uri.fsPath;
                });
            }

            return await saveReportToFile(downloadZipResponse, workspaceLocation, fileName);
        } else {
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
            const overwriteOption = await vscode.window.showWarningMessage(
                `The file "${fileName}" already exists. Do you want to overwrite it?`,
                { modal: true },
                "Overwrite",
                "Skip"
            );

            if (overwriteOption === "Skip") {
                vscode.window.showInformationMessage("File download skipped.");
                return undefined; // Return if the user chooses to skip
            }
        } catch (error) {
            // If the error is because the file does not exist, we proceed with writing
            if ((error as vscode.FileSystemError).code !== "FileNotFound") {
                throw error; // Re-throw any other errors
            }
        }

        await vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadZipResponse.data));
        vscode.window.showInformationMessage(`Report downloaded successfully to ${uri.fsPath}`);
        return uri.fsPath; // Return the path of the saved file
    }
    return undefined; // Return undefined if no file was saved
}

// Utility function for adding delay
function delay(ms: number): Promise<void> {
    // console.log(`Waiting for ${ms} milliseconds for Job completion.`);
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Error handling function
function handleError(error: unknown, projectKey: string, cycleKey: string): void {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
        console.error("Project, cycle, tree root UID, filter, or test theme UID not found.", error);
        throw new Error("Resource not found.");
    } else {
        console.error(`Error fetching zip file for projectKey: ${projectKey}, cycleKey: ${cycleKey}`, error);
        throw error;
    }
}

// Extract the ZIP file to an output directory
export async function extractZip(
    zipFilePath: string,
    outputDir: string,
    extractOnlyJson = true // Optional parameter to extract only JSON files
): Promise<void> {
    try {
        console.debug(`Starting extraction of ${zipFilePath} to ${outputDir}`);

        // 1. Check if the ZIP file exists
        if (!fs.existsSync(zipFilePath)) {
            throw new Error(`ZIP file not found: ${zipFilePath}`);
        }
        console.debug(`ZIP file exists`);

        // 2. Create the output directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
            console.debug(`Created output directory: ${outputDir}`);
        } else {
            console.debug(`Output directory already exists: ${outputDir}`);
        }

        // Flags to track user decisions for overwriting or skipping
        let overwriteAll = false;
        let skipAll = false;

        // 3. Open the ZIP file as a read stream
        const readStream = fs.createReadStream(zipFilePath);
        console.debug(`Opened ZIP file stream`);

        // 4. Parse the ZIP stream and handle entries sequentially
        const zip = readStream.pipe(unzipper.Parse({ forceStream: true }));
        console.debug(`Started parsing ZIP stream`);

        for await (const entry of zip) {
            const extractedPath = path.join(outputDir, entry.path);
            const directoryPath = path.dirname(extractedPath);

            // 5. Check if the entry is a JSON file (if extractOnlyJson is true)
            if (extractOnlyJson && !entry.path.toLowerCase().endsWith(".json")) {
                console.debug(`Skipping non-JSON file: ${entry.path}`);
                entry.autodrain();
                continue; // Skip this entry
            }

            if (entry.type === "Directory") {
                // 6. Create directories if encountered
                fs.mkdirSync(extractedPath, { recursive: true });
                console.debug(`Created directory: ${extractedPath}`);
                entry.autodrain();
            } else {
                // 7. Ensure the directory for the file exists before extracting
                if (!fs.existsSync(directoryPath)) {
                    fs.mkdirSync(directoryPath, { recursive: true });
                    console.debug(`Created directory for file: ${directoryPath}`);
                }

                // Check if the file already exists
                if (fs.existsSync(extractedPath)) {
                    if (!overwriteAll && !skipAll) {
                        // Prompt the user for overwrite or skip options
                        const options = ["Overwrite", "Skip", "Overwrite All", "Skip All"];
                        const result = await vscode.window.showWarningMessage(
                            `The file "${entry.path}" already exists. What would you like to do?`,
                            { modal: true }, // Modal dialog
                            ...options
                        );

                        // Handle the user's response and update flags accordingly
                        switch (result) {
                            case "Overwrite":
                                await writeFile(entry, extractedPath);
                                break;
                            case "Skip":
                                console.debug(`Skipped file: ${extractedPath}`);
                                entry.autodrain();
                                break;
                            case "Overwrite All":
                                overwriteAll = true;
                                await writeFile(entry, extractedPath);
                                break;
                            case "Skip All":
                                skipAll = true;
                                console.debug(`Skipped file: ${extractedPath}`);
                                entry.autodrain();
                                break;
                            default: // Handle undefined result (e.g., if dialog is closed)
                                entry.autodrain();
                        }
                    } else if (overwriteAll) {
                        // If user chose to overwrite all, directly overwrite
                        await writeFile(entry, extractedPath);
                    } else if (skipAll) {
                        // If user chose to skip all, directly skip
                        console.debug(`Skipped file: ${extractedPath}`);
                        entry.autodrain();
                    }
                } else {
                    // Extract file if it doesn't exist
                    await writeFile(entry, extractedPath);
                }
            }
        }

        console.debug(`Extraction completed successfully`);
    } catch (err) {
        console.error(`Extraction failed: ${err}`);
        throw err;
    }
}

// Helper function to write a file
async function writeFile(entry: unzipper.Entry, extractedPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        entry
            .pipe(fs.createWriteStream(extractedPath))
            .on("finish", () => {
                console.debug(`Extracted file: ${extractedPath}`);
                resolve();
            })
            .on("error", (err) => {
                console.error(`Error extracting file ${extractedPath}: ${err}`);
                reject(err);
            });
    });
}

// Function to load JSON files from extracted directory
export function loadJsonFilesFromDirectory(dir: string): string[] {
    try {
        console.debug(`Attempting to read JSON files from directory: ${dir}`);

        const files = fs.readdirSync(dir);
        const jsonFiles = files.filter((file) => file.endsWith(".json")).map((file) => path.join(dir, file));

        console.debug(`Found ${jsonFiles.length} JSON files in the directory.`);
        return jsonFiles;
    } catch (error) {
        console.error(`Error loading JSON files from directory: ${error}`);
        // Re-throwing the error or returning an empty array
        throw error;
    }
}

// Function to parse JSON content
export function parseJsonFile(filePath: string): any {
    try {
        console.debug(`Attempting to parse JSON file: ${filePath}`);

        const content = fs.readFileSync(filePath, "utf-8");
        const parsedData = JSON.parse(content);

        console.debug(`Successfully parsed JSON file: ${filePath}`);
        return parsedData;
    } catch (error) {
        console.error(`Error parsing JSON file ${filePath}: ${error}`);
        // Re-throwing the error or returning null
        throw error;
    }
}

// Function to process the Test Case files
export function processTestCaseFile(filePath: string): TestCase | null {
    try {
        console.debug(`Processing test case file: ${filePath}`);

        const data = parseJsonFile(filePath);

        // Check if interactions exist and if any of them have 'sequencePhase' = 'TestStep'
        if (data.interactions && Array.isArray(data.interactions)) {
            console.debug(`Found test case with steps in file: ${filePath}`);
            const testSteps = data.interactions
                .filter((interaction: any) => interaction.spec?.sequencePhase === "TestStep")
                .map((interaction: any) => interaction.name);

            if (testSteps.length > 0) {
                return {
                    uniqueID: data.uniqueID || "UnnamedTest",
                    name: data.uniqueID || "UnnamedTest",
                    steps: testSteps.map((step: string) => `    ${step}`), // Format steps for Robot Framework
                };
            }
        }

        console.debug(`No test case found in file: ${filePath}`);
        return null;
    } catch (error) {
        console.error(`Error processing test case file ${filePath}: ${error}`);
        // Re-throwing or returning null
        throw error;
    }
}

// Function to extract the theme ID or grouping identifier from a Test Case JSON file
function extractThemeIDFromTestCaseFile(filePath: string): string {
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
    } catch (error) {
        console.error(`Error extracting theme ID from ${filePath}: ${error}`);
        // Consider re-throwing or returning a default value
        throw error;
    }
}

// Function to create Test Suites based on themes and test cases
export function createTestSuitesFromFiles(files: string[]): TestSuite[] {
    try {
        console.debug(`Creating test suites from ${files.length} files`);

        const testSuites: TestSuite[] = [];

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
    } catch (error) {
        console.error(`Error creating test suites: ${error}`);
        throw error;
    }
}

// Function to write Robot Framework test suites to files
export async function writeRobotFrameworkTestSuites(testSuites: TestSuite[], config: Configuration): Promise<void> {
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
                const userResponse = await vscode.window.showInformationMessage(
                    `The file ${filePath} already exists. What would you like to do?`,
                    { modal: true },
                    "Overwrite",
                    "Overwrite All",
                    "Ignore",
                    "Ignore All"
                );

                if (userResponse === "Overwrite All") {
                    overwriteAll = true;
                } else if (userResponse === "Ignore All") {
                    ignoreAll = true;
                    console.log(`Ignoring all future occurrences.`);
                    continue;
                } else if (userResponse === "Ignore") {
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
function removeDirectoryRecursively(directoryPath: string): void {
    if (fs.existsSync(directoryPath)) {
        fs.readdirSync(directoryPath).forEach((file) => {
            const currentPath = path.join(directoryPath, file);
            if (fs.lstatSync(currentPath).isDirectory()) {
                // Recursively remove directories
                removeDirectoryRecursively(currentPath);
            } else {
                // Remove files
                fs.unlinkSync(currentPath);
            }
        });
        fs.rmdirSync(directoryPath); // Remove the directory itself
        console.log(`Directory removed: ${directoryPath}`);
    }
}

// Function to clean up the extracted files
function removeExtractedFiles(extractDir: string): void {
    console.log(`Removing extracted files from: ${extractDir}`);
    removeDirectoryRecursively(extractDir);
}

// Select an output folder inside VS Code
async function selectOutputFolder(baseKey: string): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration(baseKey);
    let workspaceLocation = config.get<string>("workspaceLocation");
    if (workspaceLocation) {
        if (fs.existsSync(workspaceLocation)) {
            console.log(`Using configuration as output folder: ${workspaceLocation}`);
            return workspaceLocation;
        } else {
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
export async function testBenchToRobotFramework(
    itemLabel: string,
    baseKey: string,
    projectKey: string,
    cycleKey: string,
    connection: PlayServerConnection
): Promise<void> {
    // Execution based or specification based request parameter
    const executionBased = await selectExecutionOrSpecificationBased();
    console.log("executionBased value set to:", executionBased);
    if (executionBased === null) {
        console.log(`Test generation aborted.`);
        vscode.window.showInformationMessage(`Test generation aborted.`);
        return;
    }

    const cycleStructureOptionsRequestParameter: ReportRequestParams = {
        basedOnExecution: executionBased,
    };

    console.log(`Started Test generation for Cycle key: ${cycleKey}`);
    vscode.window.showInformationMessage(`Started Test generation for Cycle key: ${cycleKey}`);

    // Show a progress bar while the process is running, since this process takes time
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Generating Tests for ${itemLabel} (Cycle key ${cycleKey})`,
            cancellable: true,
        },
        async (progress, cancellationToken) => {
            try {
                if (progress) {
                    progress.report({
                        increment: 10,
                        message: `Fetching JSON Report from the server.`,
                    });
                }

                // Fetch the ZIP file from the server, passing the cancellationToken
                const downloadedZipFilePath = await fetchZipFile(
                    connection,
                    baseKey,
                    projectKey,
                    cycleKey,
                    progress,
                    cycleStructureOptionsRequestParameter,
                    cancellationToken // Pass the cancellationToken here
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

                vscode.window.showInformationMessage(
                    `Selected output folder for zip extraction: ${chosenOutputFolderForZipExtraction}`
                );

                // Configuration for the test suite generation
                const config = vscode.workspace.getConfiguration(baseKey);
                const testbench2robotframeworkConfig: Configuration = config.get<Configuration>(
                    "reportGenerationConfig",
                    {
                        generationDirectory: config.get<string>("workspaceLocation", ""),
                        clearGenerationDirectory: true,
                        createOutputZip: false,
                        removeExtractedFiles: false,
                    }
                );

                // Paths for extracted files and generated test cases
                const folderNameOfExtractedZip = `Extracted Files`;
                const zipExtractionFolderPath = path.join(chosenOutputFolderForZipExtraction, folderNameOfExtractedZip);
                const folderNameOfRobotFiles = `Generated Test Cases`;
                const robotFilesFolderPath = path.join(chosenOutputFolderForZipExtraction, folderNameOfRobotFiles);

                // Extract ZIP file
                await extractZip(downloadedZipFilePath, zipExtractionFolderPath);
                console.log(`ZIP file extracted to: ${zipExtractionFolderPath}`);

                if (progress) {
                    progress.report({
                        increment: 10,
                        message: `Processing JSON files to create test cases.`,
                    });
                }

                // TODO: use testbench2robotframework library instead of doing this manually
                console.log(`Starting convertJSONsIntoTestCases with path: ${zipExtractionFolderPath}`);
                await convertJSONsIntoTestCases(zipExtractionFolderPath, robotFilesFolderPath);
                if (testbench2robotframeworkConfig.removeExtractedFiles) {
                    if (progress) {
                        progress.report({
                            increment: 10,
                            message: `Removing extracted files.`,
                        });
                    }
                    removeExtractedFiles(zipExtractionFolderPath);
                }
                // End of testbench2robotframework library work

                vscode.window.showInformationMessage(`Test suite generation done.`);
            } catch (error: any) {
                if (error instanceof vscode.CancellationError) {
                    console.log("Process cancelled by the user.");
                    vscode.window.showInformationMessage("Process cancelled by the user.");
                } else {
                    console.error("An error occurred:", error);
                    vscode.window.showErrorMessage(`An error occurred: ${error.message || error}`);
                }
                return; // Exit the progress function
            }
        }
    );
}

// Entry point for the test generation process
export async function startTestGenerationProcess(
    treeItem: TestThemeTreeItem,
    connection: PlayServerConnection,
    baseKey: string
) {
    // Check if the cycle key is available
    const cycleKey = treeItem.item.key;
    if (cycleKey) {
        const projectKeyOfCycle = findProjectKeyOfCycle(treeItem);
        if (!projectKeyOfCycle) {
            console.error("Project key of cycle not found.");
            return Promise.resolve([]);
        }

        if (projectKeyOfCycle) {
            // Check if the user is logged in
            if (connection) {
                // Start the generation process
                testBenchToRobotFramework(treeItem.label, baseKey, projectKeyOfCycle, cycleKey, connection);
            } else {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
            }
        } else {
            console.error("Project key of cycle is unidentified!");
            vscode.window.showErrorMessage("Project key of cycle is unidentified!");
            return;
        }
    } else {
        console.error("Cycle key is unidentified!");
        vscode.window.showErrorMessage("Cycle key is unidentified!");
        return;
    }
}

// Interfaces for JSON structure
interface Interaction {
    key: string;
    uniqueID: string;
    name: string;
    interactionType: string;
    path: string;
    spec: {
        callKey: string;
        sequencePhase: string;
        callType: string;
        description: string;
        comments: string;
        references: any[];
        preConditions: any[];
        postConditions: any[];
    };
    exec: {
        verdict: string;
        time: string;
        duration: number;
        currentUser: { key: string; name: string };
        tester: string | null;
        comments: string;
        references: any[];
    };
    parameters: Parameter[];
    interactions?: Interaction[];
}

interface Parameter {
    dataType: {
        key: string;
        kind: string;
        name: string;
        path: string;
        uniqueID: string;
        version: string | null;
    };
    definitionType: string;
    key: string;
    name: string;
    evaluationType: string;
    value: string;
    valueType: string;
}

// Function to read and parse a JSON file asynchronously
async function readJSONFile(filePath: string): Promise<any> {
    try {
        const data = await fs.promises.readFile(filePath, "utf8");
        return JSON.parse(data);
    } catch (error: any) {
        throw new Error(`Error reading JSON file at ${filePath}: ${error.message}`);
    }
}

// Writes content to a file asynchronously
async function writeContentToFile(filePath: string, content: string): Promise<void> {
    console.log(`Writing content to file: ${filePath}`);
    try {
        await fs.promises.writeFile(filePath, content, "utf8");
    } catch (error: any) {
        throw new Error(`Error writing to file at ${filePath}: ${error.message}`);
    }
}

// Generates Robot Framework test case steps from interactions
function generateTestCaseSection(interactions: Interaction[]): string {
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
function generateSettingsSection(jsonData: string): string {
    let settings = "*** Settings ***\n";

    /*
    // Add Metadata (uniqueID, version, status)
    settings += `Metadata    UniqueID    ${testCase.uniqueID}\n`;
    if (testCase.spec.version) {
        settings += `Metadata    Version    ${testCase.spec.version}\n`;
    }
    settings += `Metadata    Status    ${testCase.exec.status}\n`;

    // Add Resources (if applicable, this can be extended later)
    // settings += 'Resource    path/to/resource.file\n';
    */

    settings += "\n";
    return settings;
}

// Processes an individual test step interaction
function processTestStepInteraction(interaction: Interaction): string {
    if (interaction.interactionType === "Textual") {
        return processTextualInteraction(interaction);
    } else if (interaction.interactionType === "Atomic") {
        return processAtomicInteraction(interaction);
    }
    return "";
}

// Processes textual test step interactions
function processTextualInteraction(interaction: Interaction): string {
    const descriptionText = extractTextFromHtml(interaction.spec.description);
    const commentsText = extractTextFromHtml(interaction.spec.comments);
    return descriptionText ? `    ${descriptionText}    # ${commentsText || ""}\n` : "";
}

// Processes atomic test step interactions
function processAtomicInteraction(interaction: Interaction): string {
    let step = `    ${interaction.name}`;
    if (interaction.parameters && interaction.parameters.length > 0) {
        interaction.parameters.forEach((parameter) => {
            step += `    ${parameter.name}: ${parameter.value}`;
        });
    }
    return `${step}\n`;
}

// Function to validate JSON structure for the required fields to generate Robot Framework test case
function isValidTestJSON(jsonData: any): boolean {
    return jsonData && Array.isArray(jsonData.interactions);
}

// Converts JSON files in a directory to Robot Framework test cases
// TODO: Rewrite this function after testbench2robotframework library is updated.
// tb2robot --version
// TestBench2RobotFramework 0.7.0 with [Robot Framework 7.1 (Python 3.12.6 on win32)]
// tb2robot write -c .\Konfigurationsdatei.json E:\TestBench\report.zip
async function convertJSONsIntoTestCases(
    folderPathOfJSONFiles: string,
    outputFolderOfTestSuites: string
): Promise<void> {
    createOutputFolderIfNotExists(outputFolderOfTestSuites);

    const allJSONFilePaths = await getAllJSONFilePathsFromFolder(folderPathOfJSONFiles);
    if (allJSONFilePaths.length === 0) {
        console.log("No JSON files found.");
        return;
    }

    await Promise.all(allJSONFilePaths.map((jsonFile) => processSingleJSONFile(jsonFile, outputFolderOfTestSuites)));
}

// Ensures the output folder exists
function createOutputFolderIfNotExists(outputFolder: string): void {
    if (!fs.existsSync(outputFolder)) {
        fs.mkdirSync(outputFolder);
        console.log(`Created output folder: ${outputFolder}`);
    }
}

// Retrieves a list of JSON files from the folder
async function getAllJSONFilePathsFromFolder(folderPathOfJSONFiles: string): Promise<string[]> {
    try {
        const files = await fs.promises.readdir(folderPathOfJSONFiles);
        // Filter non JSON files and return the full path for each file as a string array
        return files.filter((file) => file.endsWith(".json")).map((file) => path.join(folderPathOfJSONFiles, file));
    } catch (error: any) {
        throw new Error(`Error reading folder ${folderPathOfJSONFiles}: ${error.message}`);
    }
}

// Processes a single JSON file and generates a Robot Framework test case
async function processSingleJSONFile(jsonFilePath: string, outputFolder: string): Promise<void> {
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
    } catch (error: any) {
        console.error(`Error processing file ${jsonFilePath}: ${error.message}`);
    }
}
