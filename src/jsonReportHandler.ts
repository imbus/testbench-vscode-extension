import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as utils from "./utils";
import * as unzipper from "unzipper"; // npm install unzipper
import axios, { AxiosResponse } from "axios";
import { Connection } from "./connection";
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

// Fetch the TestBench JSON report from the server.
// 3 Calls are needed to download the zip the report, first to get the job ID, then to get the job status, and finally to download the report.
export async function fetchZipFile(
    connection: Connection,
    projectKey: string,
    cycleKey: string,
    requestParams?: ReportRequestParams // Can be left empty // TODO: Actually cant, but can be sent as empty object like {}
): Promise<void> {
    try {
        console.log(`Fetching zip file for projectKey: ${projectKey}, cycleKey: ${cycleKey}.`);
        const url = `/api/projects/${projectKey}/cycles/${cycleKey}/report/v1`; // TODO: Check/Update the URL

        // Send post request to get the job ID
        const response: AxiosResponse<JobIdResponse> = await connection.session.post(url, requestParams);

        if (response.status === 200) {
            const jobId = response.data.jobID;
            console.log(`Job ID (${jobId}) fetched successfully for projectKey: ${projectKey}, cycleKey: ${cycleKey}.`);

            // Send a get request to get the job status string
            const statusResponse: AxiosResponse<JobStatusResponse> = await connection.session.get(
                `/api/projects/${projectKey}/report/job/${jobId}/v1` // TODO: Check/Update the URL
            );

            if (statusResponse.status === 200) {
                const { completion } = statusResponse.data;
                console.log(`Job Status (${completion}) fetched successfully for job ID ${jobId}.`);

                if (completion.result.Success && completion.result.Success.reportName) {
                    const fileName = completion.result.Success.reportName;
                    console.log("Report name fetched from server:", fileName);

                    // Download the report
                    try {
                        const downloadResponse = await connection.session.get(
                            `/api/projects/${projectKey}/report/${fileName}/v1`,
                            { responseType: "blob" } // Indicate that we expect a binary response
                        );

                        if (downloadResponse.status === 200) {
                            // 1. Get the user's desired save location
                            const uri = await vscode.window.showSaveDialog({
                                defaultUri: vscode.Uri.file(fileName), // Suggest the filename from the response
                                filters: {
                                    "Zip Files": ["zip"],
                                },
                            });

                            if (uri) {
                                // 2. Write the downloaded data to the chosen file
                                await vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadResponse.data));

                                // 3. Optionally, show a success message
                                vscode.window.showInformationMessage(`Report downloaded successfully to ${uri.fsPath}`);
                            }
                        } else {
                            throw new Error(`Unexpected status code during download: ${downloadResponse.status}`);
                        }
                    } catch (downloadError) {
                        if (axios.isAxiosError(downloadError) && downloadError.response?.status === 404) {
                            throw new Error("Project or file not found during download.");
                        } else {
                            throw downloadError;
                        }
                    }
                } else {
                    // Handle cases where the job is not yet completed or has failed
                    console.warn("Report generation not yet completed or has failed. Check job status later.");
                }
            } else {
                throw new Error(`Unexpected status code: ${statusResponse.status}`);
            }

            // Old code continues
        } else {
            throw new Error(`Unexpected status code: ${response.status}`);
        }
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            throw new Error("Project, cycle, tree root UID, filter, or test theme UID not found.");
        } else {
            console.error(`Error fetching zip file for projectKey: ${projectKey}, cycleKey: ${cycleKey}`, error);
            throw error; // Re-throw error for higher-level handling if needed
        }
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

// Main function to handle the process
export async function testBenchToRobotFramework(
    itemLabel: string,
    projectKey: string,
    cycleKey: string,
    connection: Connection
): Promise<void> {
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

            // TODO: Adjust progress increments etc.
            if (progress) {
                progress.report({
                    increment: 30,
                    message: `Initializing configuration.`,
                });
            }

            // Fetch the ZIP file from the server
            // fetchZipFile(connection, projectKey, cycleKey, {});  // TODO: Uncomment after refactoring login and connection

            const testSuitesOutputDirectory: string = "C:/VSCodeTestBench/GeneratedSuites"; // TODO: Update the output directory
            const zipFileDirectory: string = "C:/RobotCode/RobotCodeLiveDemo/report-from-tb.zip"; // For now assume the zip file is already downloaded

            // Example configuration
            const config: Configuration = {
                generationDirectory: testSuitesOutputDirectory,
                clearGenerationDirectory: true,
                createOutputZip: false,
                removeExtractedFiles: true, // Enable the removal of extracted files after processing
            };

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

            if (progress) {
                progress.report({
                    increment: 10,
                    message: `Removing extracted files.`,
                });
            }

            // Optional Step: Remove extracted files if configured
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
        }
    );
}

// Entry point for the test generation process
export async function startTestGenerationProcess(item: TreeItem, connection: Connection) {
    // Check if the cycle key is available
    if (item?.item?.key?.serial) {
        console.log(`Started Test generation for Cycle key: ${item.item.key.serial}`);
        const cycleKey = item.item.key.serial;

        // Get all projects from the server
        const allProjects = await connection?.getAllProjects();
        if (allProjects) {
            // Find the project key of the cycle
            const projectKeyOfCycle = utils.findProjectKeyOfCycle(allProjects, cycleKey);
            if (projectKeyOfCycle) {
                // Check if the user is logged in
                if (connection) {
                    // Start the generation process
                    testBenchToRobotFramework(item.label, projectKeyOfCycle, cycleKey, connection); // Commented out for debugging
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
