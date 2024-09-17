import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as utils from "./utils";
import * as unzipper from "unzipper"; // npm install unzipper
import axios, { AxiosResponse } from "axios";
import { OldPlayServerConnection } from "./testbenchConnection";
import { TreeItem } from "./explorer";

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

// Fetch the TestBench JSON report from the server (ZIP Archive).
// 3 Calls are needed to download the zip report:
// 1. Get the job ID
// 2. Get the job status
// 3. Download the report zip file.
export async function fetchZipFile(
    connection: OldPlayServerConnection,
    projectKey: string,
    cycleKey: string,
    requestParams?: ReportRequestParams
): Promise<string | undefined> {
    try {
        console.log(`Fetching zip file for projectKey: ${projectKey}, cycleKey: ${cycleKey}.`);

        const jobId = await getJobId(connection, projectKey, cycleKey, requestParams);
        console.log(`Job ID (${jobId}) fetched successfully.`);

        await delay(15000); // Give the server time to process the job

        const jobStatus = await getJobStatus(connection, projectKey, jobId);
        console.log("Job Status fetched successfully:", jobStatus);

        if (jobStatus.completion.result.Success && jobStatus.completion.result.Success.reportName) {
            const fileName = jobStatus.completion.result.Success.reportName;
            console.log(`Report name: ${fileName}`);

            const outputPath = await downloadReport(connection, projectKey, fileName);
            if (outputPath) {
                console.log(`Report downloaded and saved to: ${outputPath}`);
                return outputPath;
            } else {
                console.log("Download canceled or failed.");
            }
        } else {
            console.warn("Report generation not completed or failed. Check job status later.");
        }
    } catch (error) {
        handleError(error, projectKey, cycleKey);
    }
}

// Function to get the Job ID
async function getJobId(
    connection: OldPlayServerConnection,
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

// Function to get the Job Status
async function getJobStatus(
    connection: OldPlayServerConnection,
    projectKey: string,
    jobId: string
): Promise<JobStatusResponse> {
    const url = `${connection.newPlayServerBaseUrl}/projects/${projectKey}/report/job/${jobId}/v1`;

    console.log(`Sending request to check job status for job ID ${jobId} to URL ${url}.`);

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

// Function to download the report zip file
async function downloadReport(
    connection: OldPlayServerConnection,
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
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileName),
        filters: { "Zip Files": ["zip"] },
    });

    if (uri) {
        await vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadZipResponse.data));
        vscode.window.showInformationMessage(`Report downloaded successfully to ${uri.fsPath}`);
        return uri.fsPath; // Return the path of the saved file
    }
    return undefined; // Return undefined if no file was saved
}

// Utility function for adding delay
function delay(ms: number): Promise<void> {
    console.log(`Waiting for ${ms} milliseconds for Job completion.`);
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

// Extract the ZIP file to a directory
export async function extractZip(
    zipFilePath: string,
    outputDir: string,
    extractOnlyJson = true // Optional parameter to extract only JSON files (The zip file may contain other files like images)
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

        // 3. Open the ZIP file as a read stream
        const readStream = fs.createReadStream(zipFilePath);
        console.debug(`Opened ZIP file stream`);

        // 4. Parse the ZIP stream and handle entries
        await new Promise<void>((resolve, reject) => {
            readStream
                .pipe(unzipper.Parse())
                .on("entry", (entry: unzipper.Entry) => {
                    const extractedPath = path.join(outputDir, entry.path);
                    const directoryPath = path.dirname(extractedPath);

                    // 5. Check if the entry is a JSON file (if extractOnlyJson is true)
                    if (extractOnlyJson && !entry.path.toLowerCase().endsWith(".json")) {
                        console.debug(`Skipping non-JSON file: ${entry.path}`);
                        entry.autodrain();
                        return; // Skip this entry
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

                        // 8. Extract files
                        entry
                            .pipe(fs.createWriteStream(extractedPath))
                            .on("finish", () => console.debug(`Extracted file: ${extractedPath}`))
                            .on("error", (err) => {
                                console.error(`Error extracting file ${extractedPath}: ${err}`);
                                reject(err);
                            });
                    }
                })
                .on("close", () => {
                    console.debug(`Finished processing all entries`);
                    resolve();
                })
                .on("error", (err) => {
                    console.error(`Error parsing ZIP: ${err}`);
                    reject(err);
                });
        });

        console.debug(`Extraction completed successfully`);
    } catch (err) {
        console.error(`Extraction failed: ${err}`);
        throw err;
    }
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
            if (filePath.includes("iTB-TC-")) {
                // TODO: Check if this is needed
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
        // Re-throwing or return an empty array
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
async function selectOutputFolder(): Promise<string | undefined> {
    // Show a dialog to select a folder
    const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false, // Only allow folder selection
        canSelectFolders: true, // Allow selecting folders
        canSelectMany: false, // Only allow one folder to be selected
        openLabel: "Select Output Folder", // Custom label for the open button
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
    projectKey: string,
    cycleKey: string,
    connection: OldPlayServerConnection
): Promise<void> {
    // Show a progress bar while the process is running, since this process takes time
    // TODO: result variable is not used. Check if it is needed.
    const result = vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification, // You can also use ProgressLocation.Window or ProgressLocation.SourceControl
            title: `Generating Test Suites for ${itemLabel}`,
            cancellable: true, // Make it cancellable
        },
        async (progress, token) => {
            token.onCancellationRequested(() => {
                console.log("Process cancelled.");
            });

            // TODO: Adjust progress increments and messages
            if (progress) {
                progress.report({
                    increment: 30,
                    message: `Fetching JSON Report from the server.`,
                });
            }

            // Fetch the ZIP file from the server
            const outputPathOfZip = await fetchZipFile(connection, projectKey, cycleKey, {});

            if (outputPathOfZip) {
                const zipFileDirectory: string = outputPathOfZip; // "C:/RobotCode/RobotCodeLiveDemo/report-from-tb.zip";
                // Select the output folder to generate the test suites
                const testSuitesOutputDirectory = await selectOutputFolder(); // "C:/VSCodeTestBench/GeneratedSuites";

                if (testSuitesOutputDirectory) {
                    vscode.window.showInformationMessage(`Selected output folder: ${testSuitesOutputDirectory}`);

                    // Configuration for the test suite generation
                    const config: Configuration = {
                        generationDirectory: testSuitesOutputDirectory,
                        clearGenerationDirectory: true,
                        createOutputZip: false,
                        removeExtractedFiles: false, // Enable the removal of extracted files after processing
                    };

                    // TODO: This creates a new directory inside the selected directory. Check if it is needed.
                    const extractDir = path.join(config.generationDirectory, "extracted");

                    if (progress) {
                        progress.report({
                            increment: 15,
                            message: `Extracting ZIP file to: ${extractDir}.`,
                        });
                    }

                    // Step 1: Extract ZIP file
                    await extractZip(zipFileDirectory, extractDir);
                    console.log(`ZIP file extracted to: ${extractDir}`);

                    if (progress) {
                        progress.report({
                            increment: 15,
                            message: `Loading JSON files.`,
                        });
                    }

                    /* Commented out to try out the new RF Code generation implementation

                    // Step 2: Load JSON files from extracted directory
                    const jsonFiles = loadJsonFilesFromDirectory(extractDir);
                    console.log(`JSON files loaded: ${jsonFiles.length}.`);

                    if (progress) {
                        progress.report({
                            increment: 15,
                            message: `Creating test suites.`,
                        });
                    }

                    // Step 3: Create Test Suites from Test Case files
                    const testSuites = createTestSuitesFromFiles(jsonFiles);
                    // vscode.window.showInformationMessage(`Test suites created: ${testSuites.length}`);
                    console.log(`Test suites created: ${testSuites.length}`);

                    // Step 4: Write the test suites to Robot Framework files
                    // Use await to not to cancel progress bar
                    await writeRobotFrameworkTestSuites(testSuites, config);
                    // vscode.window.showInformationMessage(`Test suites written to the file system.`);
                    console.log(`Test suites written to the file system.`);
                    */

                    // New Implementation
                    const folderPath = extractDir; // "C:/VSCodeTestBench/ExportJSONReport"; // Folder containing JSON files
                    const outputFolder = "C:/VSCodeTestBench/ExportJSONReport";
                    console.log(`Starting processTestCasesFromFolder with path: ${folderPath}`);
                    processTestCasesFromFolder(folderPath, outputFolder);

                    // Optional Step: Remove extracted files if configured
                    // TODO: This is somehow called before the extraction is completed, which causes issues?
                    if (config.removeExtractedFiles) {
                        if (progress) {
                            progress.report({
                                increment: 15,
                                message: `Removing extracted files.`,
                            });
                        }
                        removeExtractedFiles(extractDir);
                    }

                    vscode.window.showInformationMessage(`Test suite generation done.`);

                    // You can check if the user canceled the task
                    if (token.isCancellationRequested) {
                        return "Canceled";
                    }

                    return "Completed!";
                } else {
                    vscode.window.showErrorMessage("No folder selected.");
                }
            } else {
                console.log("Download canceled or failed.");
            }
        }
    );
}

// Entry point for the test generation process
export async function startTestGenerationProcess(item: TreeItem, connection: OldPlayServerConnection) {
    // Check if the cycle key is available
    if (item?.item?.key?.serial) {
        const cycleKey = item.item.key.serial;
        console.log(`Started Test generation for Cycle key: ${cycleKey}`);
        vscode.window.showInformationMessage(`Started Test generation for Cycle key: ${cycleKey}`);

        // Get all projects from the server
        const allProjects = await connection?.getAllProjects();
        if (allProjects) {
            // Find the project key of the cycle
            const projectKeyOfCycle = utils.findProjectKeyOfCycle(allProjects, cycleKey);
            if (projectKeyOfCycle) {
                // Check if the user is logged in
                if (connection) {
                    // Start the generation process
                    testBenchToRobotFramework(item.label, projectKeyOfCycle, cycleKey, connection);
                } else {
                    vscode.window.showErrorMessage("No connection available. Please log in first.");
                }
            } else {
                console.error("Project key of cycle is unidentified!");
                vscode.window.showErrorMessage("Project key of cycle is unidentified!");
                return;
            }
        } else {
            console.error("No projects found!");
            vscode.window.showErrorMessage("No projects found!");
            return;
        }
    } else {
        console.error("Cycle key is unidentified!");
        vscode.window.showErrorMessage("Cycle key is unidentified!");
        return;
    }
}

// New functions to create test suites with parameters

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
async function readJSONFileAsync(filePath: string): Promise<any> {
    try {
        const data = await fs.promises.readFile(filePath, "utf8");
        return JSON.parse(data);
    } catch (err) {
        throw err; // Re-throw the error to be handled by the caller
    }
}

// Function to write a Robot Framework test case asynchronously
function writeRobotTestCaseAsync(outputFilePath: string, content: string): Promise<void> {
    console.log(`writeRobotTestCaseAsync Writing to file: ${outputFilePath}`);
    return new Promise((resolve, reject) => {
        fs.writeFile(outputFilePath, content, "utf8", (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}
// Function to generate Robot Framework test case from JSON interactions
function generateRobotTestCase(interactions: Interaction[]): string {
    let testCase = "";

    interactions.forEach((interaction) => {
        // Check if sequencePhase is TestStep and generate test step
        if (interaction.spec.sequencePhase === "TestStep") {
            testCase += `    ${interaction.name}`;
            if (interaction.parameters && interaction.parameters.length > 0) {
                interaction.parameters.forEach((parameter) => {
                    testCase += `    ${parameter.name}: ${parameter.value}`;
                });
            }
            testCase += "\n";
        }

        // Recursively process nested interactions if they exist
        if (interaction.interactions && interaction.interactions.length > 0) {
            testCase += generateRobotTestCase(interaction.interactions);
        }
    });

    return testCase;
}

// Function to validate JSON structure for the required fields to generate Robot Framework test case
function isValidTestJSON(jsonData: any): boolean {
    return jsonData && Array.isArray(jsonData.interactions);
}
// Process a single JSON file asynchronously
async function processTestCase(filePath: string, outputFolder: string): Promise<void> {
    try {
        const testData = await readJSONFileAsync(filePath);
        if (!isValidTestJSON(testData)) {
            console.warn(`Skipping file due to invalid test structure: ${filePath}`);
            return;
        }
        else{
            console.log(`Not skipped file: ${filePath}`);
        }

        const testCaseName = testData.uniqueID || path.basename(filePath, ".json");
        let robotTestCase = `*** Test Cases ***\n${testCaseName}\n`;

        // Generate Robot Framework test case steps
        robotTestCase += generateRobotTestCase(testData.interactions);

        const outputFilePath = path.join(`${outputFolder}`, `${testCaseName}.robot`);
        console.log(`Calling writeRobotTestCaseAsync with outputFilePath: ${outputFilePath}`);
        await writeRobotTestCaseAsync(outputFilePath, robotTestCase);
        console.log(`Generated Robot Framework test case: ${outputFilePath}`);
    } catch (error) {
        console.error(`Error processing file: ${filePath}`, error);
    }
}
// Function to process all JSON files in a directory asynchronously
async function processTestCasesFromFolder(folderPath: string, outputFolder: string): Promise<void> {
    console.log(`Inside processTestCasesFromFolder with folderPath: ${folderPath}`);

    // Create the output folder if it doesn't exist
    if (!fs.existsSync(outputFolder)) {
        fs.mkdirSync(outputFolder);
        console.log(`Created output folder: ${outputFolder}`);
    }

    console.log(`processTestCasesFromFolder Reading all files in the folder: ${folderPath}`);

    // Read all files in the folder asynchronously
    try {
        const files = await fs.promises.readdir(folderPath);
        console.log(`processTestCasesFromFolder Found ${files.length} files in the folder ${folderPath}.`);

        // Process each JSON file asynchronously, wait for all to complete
        const jsonFiles = files.filter((file) => file.endsWith(".json"));
        console.log(`processTestCasesFromFolder Found ${jsonFiles.length} JSON files in the folder.`);
        if (jsonFiles.length === 0) { 
            console.log(`No JSON files found in the folder.`);
            return;
        }
        const processPromises = jsonFiles.map((file) => {
            const filePath = path.join(folderPath, file);
            console.log(`processTestCasesFromFolder Processing file: ${filePath}`);
            return processTestCase(filePath, outputFolder); // Return the promise
        });

        try {
            await Promise.all(processPromises); // Wait for all promises to resolve
        } catch (error) {
            console.error(`Error processing files:`, error);
        }
    } catch (err) {
        console.error(`Error reading folder: ${folderPath}`, err);
    }
}
