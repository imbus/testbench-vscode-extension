import * as vscode from "vscode";
import * as fs from "fs";
import * as fsPromise from "fs/promises";
import * as path from "path";
import * as types from "./types";
import axios, { AxiosResponse } from "axios";
import * as projectManagementTreeView from "./projectManagementTreeView";
import * as testbench2robotframeworkLib from "./testbench2robotframeworkLib";
import { connection, baseKey, lastGeneratedReportParams } from "./extension";
import { importReportWithResultsToTestbench } from "./testBenchConnection";

/**
 * Prompt the user to select the export report method in quick pick format (Execution based or Specification based).
 * @returns Promise<boolean | null> - Resolves with the selected option (true for Execution based, false for Specification based) or null if the user cancels the selection.
 */
export async function isExecutionBasedReportSelected(): Promise<boolean | null> {
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
                } else {
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
export function isReportJobCompletedSuccessfully(jobStatus: types.JobStatusResponse): boolean {
    return !!jobStatus?.completion?.result?.ReportingSuccess?.reportName;
}

// Checks if the import job has completed successfully.
export function isImportJobCompletedSuccessfully(jobStatus: types.JobStatusResponse): boolean {
    return !!jobStatus?.completion?.result?.ExecutionImportingSuccess;
}

// Checks if the import job has failed.
export function isImportJobFailed(jobStatus: types.JobStatusResponse): boolean {
    return !!jobStatus?.completion?.result?.ExecutionImportingFailure;
}

/**
 * Fetch the TestBench JSON report (ZIP Archive) from the server.
 * 3 Calls are needed to download the zip report:
 * 1. Get the job ID
 * 2. Get the job status (polling until the job is completed)
 * 3. Download the report zip file.
 *
 * @param baseKey The base key of the extension
 * @param projectKey The project key
 * @param cycleKey The cycle key
 * @param progress Progress bar to show the poll attempts to the user
 * @param folderNameToDownloadReport The folder name to save the downloaded report
 * @param requestParams Optional request parameters (exec/spec based, root UID) for the job ID request
 * @param cancellationToken Cancellation token to be able to cancel the polling by clicking cancel button
 * @returns The path of the downloaded zip file if the download was successful, otherwise undefined
 */
export async function fetchZipFile(
    baseKey: string,
    projectKey: string,
    cycleKey: string,
    folderNameToDownloadReport: string,
    requestParams?: types.OptionalJobIDRequestParameter,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken?: vscode.CancellationToken
): Promise<string | undefined> {
    try {
        if (!connection) {
            console.error("Connection object is missing.");
            return undefined;
        }

        console.log(
            `Fetching report for projectKey: ${projectKey}, cycleKey: ${cycleKey}, requestParams: ${requestParams}, folderNameToDownloadReport: ${folderNameToDownloadReport}.`
        );
        console.log("requestParams", requestParams);

        const jobId = await getJobId(projectKey, cycleKey, requestParams);
        if (!jobId) {
            console.warn("Job ID not received.");
            return undefined;
        }
        console.log(`Job ID (${jobId}) fetched successfully.`);

        const jobStatus = await pollJobStatus(projectKey, jobId, "report", progress, cancellationToken);

        if (!jobStatus || !isReportJobCompletedSuccessfully(jobStatus)) {
            console.warn("Report generation was unsuccessful.");
            vscode.window.showErrorMessage("Report generation was unsuccessful.");
            return undefined;
        }

        const fileName = jobStatus.completion.result.ReportingSuccess!.reportName;
        console.log(`Report name: ${fileName}`);

        const outputPath = await downloadReport(baseKey, projectKey, fileName, folderNameToDownloadReport);
        if (outputPath) {
            console.log(`Report downloaded and saved to: ${outputPath}`);
            return outputPath;
        } else {
            console.warn("Download canceled or failed.");
        }
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            console.log("Operation cancelled by the user.");
            vscode.window.showInformationMessage("Operation cancelled by the user.");
            return undefined;
        } else {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                throw new Error("Resource not found.");
            } else {
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

// TODO: totalitemcount handled item count in Jobprogress for ReportingJob
export async function pollJobStatus(
    projectKey: string,
    jobId: string,
    jobType: "report" | "import",
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken?: vscode.CancellationToken,
    maxPollingTimeMs?: number // Optional timeout, disabled by default so that the user can cancel manually
): Promise<types.JobStatusResponse | null> {
    const startTime = Date.now(); // Start time for the polling to adjust the polling interval after 10 seconds
    let attempt = 0;
    let jobStatus: types.JobStatusResponse | null = null;
    let lastIncrement = 0;

    // Poll the job status until the job is completed with either success or failure
    while (true) {
        if (cancellationToken?.isCancellationRequested) {
            console.log("Operation cancelled by the user.");
            vscode.window.showInformationMessage("Operation cancelled by the user.");
            throw new vscode.CancellationError();
        }

        if (!connection) {
            console.error("Connection object is missing.");
            return null;
        }

        attempt++;

        try {
            jobStatus = await getJobStatus(projectKey, jobId, jobType);
            if (!jobStatus) {
                console.warn("Job status not received.");
                return null;
            }

            let jobStatusResponseTotalItemsCount = jobStatus?.progress?.totalItemsCount;
            let jobStatusResponseHandledItemsCount = jobStatus?.progress?.handledItemsCount;
            if (jobStatusResponseTotalItemsCount && jobStatusResponseHandledItemsCount) {
                let roundedProgressPercentage = Math.round(
                    (jobStatusResponseHandledItemsCount / jobStatusResponseTotalItemsCount) * 100
                );

                progress?.report({
                    message: `Fetching job status (${jobStatusResponseHandledItemsCount}/${jobStatusResponseTotalItemsCount}).`,
                    increment: (roundedProgressPercentage - lastIncrement) / 3,
                });
                console.log(`Attempt ${attempt}: Job Status fetched. Progress: ${roundedProgressPercentage}%`);

                lastIncrement = roundedProgressPercentage;
            } else {
                console.log(`Attempt ${attempt}: Job Status fetched.`);
            }

            if (jobType === "report") {
                if (isReportJobCompletedSuccessfully(jobStatus)) {
                    console.log("Report job completed successfully.");
                    return jobStatus;
                } else {
                    // console.log("Job not yet completed.");
                }
            } else if (jobType === "import") {
                if (isImportJobCompletedSuccessfully(jobStatus)) {
                    console.log("Import job completed successfully.");
                    return jobStatus;
                } else if (isImportJobFailed(jobStatus)) {
                    return null;
                }
            }
        } catch (error) {
            console.error(`Attempt ${attempt}: Failed to get job status. Error: ${error}`);
        }

        // Update the progress bar, if provided
        // progress?.report({ message: `Fetching job status. Attempt ${attempt}.` });

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
 * Get the job ID from server for the report or import job.
 * @param projectKey The project key
 * @param cycleKey The cycle key
 * @param requestParams Optional request parameters (exec/spec based, root UID) for the job ID request
 * @returns The job ID received from the server
 */
export async function getJobId(
    projectKey: string,
    cycleKey: string,
    requestParams?: types.OptionalJobIDRequestParameter // TODO: Execution mode is added in new branch, project tree is also changed? ExecutionImportingSuccess
): Promise<string | null> {
    if (!connection) {
        console.error("Connection object is missing.");
        return "";
    }

    const url = `${connection.getBaseURL()}/projects/${projectKey}/cycles/${cycleKey}/report/v1`;

    console.log(
        `Sending request to fetch job ID for projectKey: ${projectKey}, cycleKey: ${cycleKey} to the URL ${url}.`
    );

    const jobIdResponse: AxiosResponse<types.JobIdResponse> = await axios.post(url, requestParams, {
        headers: {
            accept: "application/json",
            Authorization: connection.getSessionToken(), // Include session token for authorization
            "Content-Type": "application/json",
        },
    });

    console.log("jobIdResponse:", jobIdResponse);

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
export async function getJobStatus(
    projectKey: string,
    jobId: string,
    jobType: "report" | "import"
): Promise<types.JobStatusResponse | null> {
    if (!connection) {
        console.error("Connection object is missing.");
        return null;
    }

    const url = `${connection.getBaseURL()}/projects/${projectKey}/${jobType}/job/${jobId}/v1`;

    console.log(`Checking job status: ${url}`);

    const jobStatusResponse: AxiosResponse<types.JobStatusResponse> = await axios.get(url, {
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
 * Downloads the report zip file from the server to local storage and returns the path of the downloaded file.
 * @param baseKey The base key of the extension
 * @param projectKey The project key
 * @param fileName The name of the report file to download
 * @param folderNameToDownloadReport The folder name to save the downloaded report
 * @returns The path of the downloaded zip file if successful, otherwise undefined
 */
export async function downloadReport(
    baseKey: string,
    projectKey: string,
    fileName: string,
    folderNameToDownloadReport: string
): Promise<string | undefined> {
    try {
        // Ensure the connection object is available
        if (!connection) {
            console.error("Connection object is missing.");
            return undefined;
        }

        // Construct the download URL
        const url = `${connection.getBaseURL()}/projects/${projectKey}/report/${fileName}/v1`;
        console.log(`Sending request to download report ${fileName} from URL ${url}.`);

        // Fetch the report from the server
        const downloadZipResponse = await axios.get(url, {
            responseType: "arraybuffer", // Expecting binary data
            headers: {
                accept: "application/vnd.testbench+json",
                Authorization: connection.getSessionToken(),
            },
        });

        // Check for successful response
        if (downloadZipResponse.status !== 200) {
            throw new Error(`Failed to download report, status code: ${downloadZipResponse.status}`);
        }

        // Get the workspace configuration
        const config = vscode.workspace.getConfiguration(baseKey);
        const workspaceLocation = config.get<string>("workspaceLocation");

        if (workspaceLocation && fs.existsSync(workspaceLocation)) {
            // Save report to the specified workspace location
            return await saveReportToFile(workspaceLocation, folderNameToDownloadReport, fileName, downloadZipResponse);
        } else if (workspaceLocation) {
            console.error(`The configured download location does not exist: ${workspaceLocation}`);
            vscode.window.showErrorMessage(`The configured workspace location does not exist: ${workspaceLocation}`);
        }

        // If no valid workspace location, prompt the user to choose a save location
        return await promptUserForSaveLocationAndSaveReportToFile(fileName, downloadZipResponse);
    } catch (error) {
        console.error(`Error downloading the report: ${(error as Error).message}`);
        vscode.window.showErrorMessage(`Error downloading the report: ${(error as Error).message}`);
        return undefined;
    }
}

/**
 * Saves the report file to the specified location.
 * @param workspaceLocation The workspace location to save the file
 * @param folderName The folder name for saving the report
 * @param fileName The name of the file to save
 * @param downloadResponse The Axios response containing the file data
 * @returns The path of the saved file
 */
async function saveReportToFile(
    workspaceLocation: string,
    folderName: string,
    fileName: string,
    downloadResponse: AxiosResponse<any>
): Promise<string | undefined> {
    try {
        const filePath = path.join(workspaceLocation, folderName, fileName);
        const uri = vscode.Uri.file(filePath);

        // Write the file to the specified location
        await vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadResponse.data));
        console.log(`Report downloaded successfully to ${uri.fsPath}`);
        return uri.fsPath;
    } catch (error) {
        console.error(`Failed to save report to file: ${(error as Error).message}`);
        vscode.window.showErrorMessage(`Failed to save report: ${(error as Error).message}`);
        return undefined;
    }
}

/**
 * Prompts the user to choose a save location and writes the file there.
 * @param fileName The name of the file to save
 * @param downloadResponse The Axios response containing the file data
 * @returns The path of the saved file if successful, otherwise undefined
 */
async function promptUserForSaveLocationAndSaveReportToFile(
    fileName: string,
    downloadResponse: AxiosResponse<any>
): Promise<string | undefined> {
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileName),
        filters: { "Zip Files": ["zip"] },
    });

    if (uri) {
        try {
            // Check if the file already exists
            try {
                await vscode.workspace.fs.stat(uri);

                // Prompt user for overwrite confirmation
                const overwriteOption = await vscode.window.showWarningMessage(
                    `The file "${fileName}" already exists. Do you want to overwrite it?`,
                    { modal: true },
                    "Overwrite",
                    "Skip"
                );

                if (overwriteOption === "Skip") {
                    vscode.window.showInformationMessage("File download skipped.");
                    return undefined;
                }
            } catch (error) {
                // If file does not exist, proceed
                if ((error as vscode.FileSystemError).code !== "FileNotFound") {
                    throw error;
                }
            }

            // Write the file to the chosen location
            await vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadResponse.data));
            console.log(`Report downloaded successfully to ${uri.fsPath}`);
            return uri.fsPath;
        } catch (error) {
            console.error(`Failed to save file: ${(error as Error).message}`);
            vscode.window.showErrorMessage(`Failed to save file: ${(error as Error).message}`);
        }
    }
    return undefined;
}

// Utility function for adding delay in milliseconds
export function delay(ms: number): Promise<void> {
    // console.log(`Waiting for ${ms} milliseconds for Job completion.`);
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches and downloads a report in ZIP format for a selected tree view element.
 * @param treeItem - The selected tree item in the project management tree.
 * @param projectManagementTreeViewOfExtension - The project management tree data provider.
 * @param workingDirectory - The directory where the ZIP file should be downloaded.
 */
export async function callFetchReportForTreeElement(
    treeItem: projectManagementTreeView.TestbenchTreeItem,
    projectManagementTreeViewOfExtension: projectManagementTreeView.ProjectManagementTreeDataProvider | null,
    workingDirectory: string
): Promise<void> {
    // Show progress in VS Code
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Fetching Report for ${treeItem.label}`,
            cancellable: true,
        },
        async (progress, cancellationToken) => {
            try {
                // Report initial progress
                progress?.report({ increment: 30, message: "Selecting report parameters." });
                console.log("Fetching report for the selected tree item:", treeItem);

                // Validate the connection
                if (!connection) {
                    throw new Error("No connection available. Please log in first.");
                }

                // Validate the project management tree view
                if (!projectManagementTreeViewOfExtension) {
                    throw new Error("Project management tree is not initialized. Please select a project first.");
                }

                // Get the current project key
                const projectKey = projectManagementTreeViewOfExtension.currentProjectKeyInView;
                if (!projectKey) {
                    throw new Error("No project selected. Please select a project first.");
                }

                // Find the cycle key associated with the tree item
                const cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
                if (!cycleKey) {
                    throw new Error("No cycle selected. Please select a cycle first.");
                }

                // Get the unique ID of the tree element
                const treeElementUniqueID = treeItem.item?.base?.uniqueID;

                // Check if the report should be based on execution
                const executionBased = true; // await isExecutionBasedReportSelected();  // TODO: Add this later
                if (executionBased === null) {
                    console.log("Export method is not selected. Fetching report for the selected tree item.");
                    return;
                }

                // Set up the request parameters
                // TODO: For now use executionBased, remove selection dialog
                const cycleStructureOptionsRequestParameter: types.OptionalJobIDRequestParameter = {
                    basedOnExecution: executionBased,
                    treeRootUID: treeElementUniqueID,
                };

                console.log(
                    `Started fetching report for projectKey: ${projectKey}, cycleKey: ${cycleKey}, uniqueID: ${treeElementUniqueID}.`
                );

                // Report progress for fetching the report
                progress?.report({ increment: 30, message: "Fetching report." });

                // Fetch the ZIP file, handle potential cancellation
                const downloadedReportZipFilePath = await fetchZipFile(
                    baseKey,
                    projectKey,
                    cycleKey,
                    workingDirectory,
                    cycleStructureOptionsRequestParameter
                );

                console.log(`Report successfully downloaded to: ${downloadedReportZipFilePath}.`);
            } catch (error) {
                // Handle errors and show an error message to the user
                vscode.window.showErrorMessage((error as Error).message);
                console.error("Error fetching report:", error);
            }
        }
    );
}

async function handleExecutionError(
    workingDirectoryFullPath: string,
    isExecutionSuccessfull: boolean,
    downloadedReportZipFileFullPath: string
): Promise<boolean> {
    if (!isExecutionSuccessfull) {
        await deleteConfigurationFile(getConfigurationFilePath(workingDirectoryFullPath)); // Delete created json config file after usage
        if (vscode.workspace.getConfiguration(baseKey).get<boolean>("clearReportAfterProcessing")) {
            await removeReportZipFile(downloadedReportZipFileFullPath);
        }
        console.error(`Test generation failed.`);
        // vscode.window.showErrorMessage(`Test generation failed.`);
    }
    return isExecutionSuccessfull;
}

/**
 * Generate test cases for the selected TestThemeNode or TestCaseSetNode.
 * @param context VS Code extension context
 * @param treeItem The selected tree item
 * @param folderNameOfTestbenchWorkingDirectory The folder name of the testbench working directory
 * @returns 
 */
export async function generateTestCasesForTestThemeOrTestCaseSet(
    context: vscode.ExtensionContext,
    treeItem: projectManagementTreeView.TestbenchTreeItem,
    folderNameOfTestbenchWorkingDirectory: string
): Promise<void> {
    console.log("Generating tests for:", treeItem);

    let treeElementUniqueID = treeItem.item?.base?.uniqueID;
    let cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
    let projectKey = projectManagementTreeView.findProjectKeyOfCycleElement(treeItem.parent!);

    if (!projectKey || !cycleKey || !treeElementUniqueID) {
        console.error("Error when finding project key, cycle key, test theme or unique ID.");
        return;
    }

    generateTestsWithTestBenchToRobotFramework(
        context,
        treeItem,
        typeof treeItem.label === "string" ? treeItem.label : "", // Label might be undefined
        baseKey,
        projectKey,
        cycleKey,
        folderNameOfTestbenchWorkingDirectory,
        treeElementUniqueID
    );
}

/**
 * Generate Robot Framework test cases from the TestBench JSON report.
 * @param context - VS Code extension context
 * @param treeItem - The selected tree item
 * @param itemLabel - The label of the selected tree item
 * @param baseKey - The base key of the extension
 * @param projectKey - The project key
 * @param cycleKey - The cycle key
 * @param workingDirectory - The path to save the downloaded report
 * @param UIDofTestThemeElementToGenerateTestsFor - (Optional) The unique ID of the clicked TestThemeNode element to generate tests for
 */
export async function generateTestsWithTestBenchToRobotFramework(
    context: vscode.ExtensionContext,
    treeItem: projectManagementTreeView.TestbenchTreeItem,
    itemLabel: string,
    baseKey: string,
    projectKey: string,
    cycleKey: string,
    workingDirectory: string,
    UIDofTestThemeElementToGenerateTestsFor?: string
): Promise<void> {
    try {
        const executionBased = true; // await isExecutionBasedReportSelected();  // TODO: For QS day, use true for this value.
        if (executionBased === null) {
            vscode.window.showInformationMessage("Test generation aborted.");
            return;
        }

        const UIDofSelectedElement =
            UIDofTestThemeElementToGenerateTestsFor || (await displayAndSelectTestThemeNode(treeItem));
        if (!UIDofSelectedElement) {
            console.error("Test theme selection was empty.");
            return;
        }

        const cycleReportOptions: types.OptionalJobIDRequestParameter = {
            basedOnExecution: executionBased,
            treeRootUID: UIDofSelectedElement === "Generate all" ? "" : UIDofSelectedElement,
        };

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Generating Tests for ${itemLabel}`,
                cancellable: true,
            },
            async (progress, cancellationToken) => {
                await runTestGenerationProcess(
                    context,
                    baseKey,
                    projectKey,
                    cycleKey,
                    executionBased,
                    workingDirectory,
                    UIDofSelectedElement,
                    cycleReportOptions,
                    progress,
                    cancellationToken
                );
            }
        );
    } catch (error: any) {
        handleError(error);
    }
}

/**
 * Show a QuickPick for selecting a TestThemeNode.
 * @param treeItem - The tree item to search for TestThemeNodes
 * @returns The unique ID of the selected TestThemeNode or 'Generate all'
 */
async function displayAndSelectTestThemeNode(treeItem: any): Promise<string | undefined> {
    const testThemeNodes = findTestThemeNodes(treeItem);

    const quickPickItems = [
        { label: "Generate all", description: "Generate All Tests Under The Test Cycle" },
        ...testThemeNodes.map((node) => ({
            label: node.numbering ? `${node.numbering} ${node.name}` : node.name,
            description: `ID: ${node.uniqueID}`,
            uniqueID: node.uniqueID,
        })),
    ];

    const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: 'Select a test theme or "Generate all" to generate all tests under the cycle.',
    });

    return selected?.label === "Generate all" ? "Generate all" : (selected as { uniqueID: string })?.uniqueID;
}

/**
 * Find all TestThemeNode elements recursively.
 * @param node - The node to search
 * @param results - An array to collect the results
 * @returns An array of found TestThemeNodes
 */
function findTestThemeNodes(
    node: any,
    results: { name: string; uniqueID: string; numbering?: string }[] = []
): typeof results {
    if (node.item?.elementType === "TestThemeNode") {
        const { name = "Unnamed", uniqueID = "No ID", numbering } = node.item.base || {};
        results.push({ name, uniqueID, numbering });
    }

    if (Array.isArray(node.children)) {
        node.children.forEach((child: projectManagementTreeView.TestbenchTreeItem) =>
            findTestThemeNodes(child, results)
        );
    }

    return results;
}

/**
 * Run the test generation process with progress and cancellation support.
 * @param context - VS Code extension context
 * @param baseKey - The base key of the extension
 * @param projectKey - The project key
 * @param cycleKey - The cycle key
 * @param workingDirectory - The working directory path
 * @param UIDofSelectedElement - The unique ID of the selected element
 * @param cycleStructureOptions - Request parameters for cycle structure
 * @param progress - VS Code progress reporter
 * @param cancellationToken - VS Code cancellation token
 */
async function runTestGenerationProcess(
    context: vscode.ExtensionContext,
    baseKey: string,
    projectKey: string,
    cycleKey: string,
    executionBased: boolean,
    workingDirectory: string,
    UIDofSelectedElement: string,
    cycleStructureOptions: types.OptionalJobIDRequestParameter,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken: vscode.CancellationToken
) {
    progress.report({ increment: 30, message: "Fetching JSON Report from the server." });

    const downloadedReportZipFilePath = await fetchZipFile(
        baseKey,
        projectKey,
        cycleKey,
        workingDirectory,
        cycleStructureOptions,
        progress,
        cancellationToken
    );

    if (!downloadedReportZipFilePath) {
        console.warn("Download canceled or failed.");
        return;
    }

    progress.report({ increment: 30, message: "Generating test cases with testbench2robotframework." });

    const workspacePath = vscode.workspace.getConfiguration(baseKey).get<string>("workspaceLocation")!;
    const workingDirectoryFullPath = path.join(workspacePath, workingDirectory);

    const configFilePath = await saveTestbench2RobotConfigurationAsJson(baseKey, workingDirectoryFullPath);
    if (!configFilePath) {
        console.error("Failed to save configuration file.");
        return;
    }

    // console.log("Calling startTb2robotWrite.");
    const isSuccess = await testbench2robotframeworkLib.tb2robotLib.startTb2robotWrite(
        context,
        workingDirectoryFullPath,
        downloadedReportZipFilePath,
        configFilePath
    );
    // console.log("startTb2robotWrite executed with success variable:", isSuccess);

    if (!(await handleExecutionError(workingDirectoryFullPath, isSuccess, downloadedReportZipFilePath))) {
        return;
    }

    updateLastGeneratedReportParams(UIDofSelectedElement, projectKey, cycleKey, executionBased);
    await cleanUp(configFilePath, downloadedReportZipFilePath, baseKey);
    // Open the Testing view of VS Code after generating the tests
    vscode.commands.executeCommand("workbench.view.extension.test");
}

/**
 * Update the parameters for the last generated report.
 */
function updateLastGeneratedReportParams(UID: string, projectKey: string, cycleKey: string, executionBased: boolean) {
    lastGeneratedReportParams.UID = UID;
    lastGeneratedReportParams.projectKey = projectKey;
    lastGeneratedReportParams.cycleKey = cycleKey;
    lastGeneratedReportParams.executionBased = executionBased;
}

/**
 * Clean up temporary files and configurations.
 * @param configFilePath The path of the testbench2robotframework configuration file
 * @param reportZipFileFullPath The path of the report ZIP file
 * @param baseKey The base key of the extension
 */
async function cleanUp(configFilePath: string, reportZipFileFullPath: string, baseKey: string) {
    await deleteConfigurationFile(configFilePath);

    if (vscode.workspace.getConfiguration(baseKey).get<boolean>("clearReportAfterProcessing")) {
        await removeReportZipFile(reportZipFileFullPath);
    }

    vscode.window.showInformationMessage("Test generation done.");
}

/**
 * Handle errors gracefully.
 */
function handleError(error: any) {
    if (error instanceof vscode.CancellationError) {
        console.log("Process cancelled by the user.");
        vscode.window.showInformationMessage("Process cancelled by the user.");
    } else {
        console.error("An error occurred:", error);
        vscode.window.showErrorMessage(`An error occurred: ${error.message || error}`);
    }
}

/**
 * Tries to find 'output.xml' recursively in the current workspace directory.
 * If not found, returns the location of the currently opened file.
 * @returns {Promise<string | undefined>} Full path of 'output.xml' or the currently opened file's location.
 */
export async function findOutputXml(): Promise<string | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage("No workspace folder is open.");
        return undefined;
    }

    const rootFolder = workspaceFolders[0].uri.fsPath;

    // Search recursively for 'output.xml'
    const outputFilePath = findFileRecursively(rootFolder, "output.xml");

    if (outputFilePath) {
        return outputFilePath;
    }

    // Fallback: return the path of the currently opened file if no 'output.xml' is found
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        return activeEditor.document.uri.fsPath;
    }

    vscode.window.showWarningMessage("No output.xml file found and no file is currently open.");
    return undefined;
}

/**
 * Removes the specified zip file from the system if it exists and is a valid zip file.
 * @param zipFileFullPath The path of the zip file to be removed
 * @returns Promise<void>
 */
export async function removeReportZipFile(zipFileFullPath: string): Promise<void> {
    try {
        // Check if the file exists
        await fsPromise.access(zipFileFullPath);

        const fileName = path.basename(zipFileFullPath);
        const fileExtension = path.extname(zipFileFullPath);

        // Validate that the file is a zip file
        if (fileExtension !== ".zip") {
            throw new Error(`Invalid file type: ${fileExtension}. Only zip files can be removed.`);
        }

        // Remove the file
        await fsPromise.unlink(zipFileFullPath);
        console.log(`Zip file ${fileName} successfully removed.`);
    } catch (error: any) {
        if (error.code === "ENOENT") {
            vscode.window.showWarningMessage(`File not found: ${zipFileFullPath}`);
        } else {
            vscode.window.showErrorMessage(`Error removing the file: ${(error as Error).message}`);
            console.error(`Error removing file at ${zipFileFullPath}:`, error);
        }
    }
}

/**
 * Recursively searches for a file within a directory.
 * @param {string} dir - The directory to search in.
 * @param {string} fileName - The name of the file to search for.
 * @returns {string | undefined} The full path of the file if found, otherwise undefined.
 */
export async function findFileRecursively(dir: string, fileName: string): Promise<string | undefined> {
    try {
        const files = await fsPromise.readdir(dir);

        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = await fsPromise.stat(fullPath);

            if (stat.isDirectory()) {
                // Recursively search in subdirectories
                const result = await findFileRecursively(fullPath, fileName);
                if (result) {
                    return result;
                }
            } else if (stat.isFile() && file === fileName) {
                console.log(`File found: ${fullPath}`);
                return fullPath;
            }
        }
    } catch (error) {
        console.error(`Error searching for file: ${error instanceof Error ? error.message : String(error)}`);
    }

    return undefined;
}

async function chooseRobotXMLFile(workingDirectoryFullPath: string): Promise<string | undefined> {
    // Open file selection dialog, filtered for XML files

    const config = vscode.workspace.getConfiguration(baseKey);
    let outputXMLFolderFullPath = config.get<string>("outputXMLPath");
    if (!outputXMLFolderFullPath) {
        console.warn("Output XML path is not configured.");
    } else {
        const outputXmlFilePath = await findFileRecursively(outputXMLFolderFullPath, "output.xml");
        if (outputXmlFilePath) {
            return outputXmlFilePath;
        }
    }

    const selectedFiles = await vscode.window.showOpenDialog({
        defaultUri: outputXMLFolderFullPath
            ? vscode.Uri.file(outputXMLFolderFullPath)
            : vscode.Uri.file(workingDirectoryFullPath),
        canSelectFiles: true,
        canSelectMany: false,
        title: "Select Output XML File",
        openLabel: "Select Output XML File",
        filters: { "XML Files": ["xml"] },
    });

    // Return the selected file path if a file was chosen
    if (selectedFiles && selectedFiles.length > 0) {
        return selectedFiles[0].fsPath;
    }
    return undefined;
}

async function chooseReportWithouResultsZipFile(workingDirectoryFullPath: string): Promise<string | undefined> {
    // Open file selection dialog, filtered for XML files
    const selectedFiles = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(workingDirectoryFullPath),
        title: "Select Report Zip File",
        openLabel: "Select Report Zip File",
        canSelectFiles: true,
        canSelectMany: false,
        filters: { "Zip Files": ["zip"] },
    });

    // Return the selected file path if a file was chosen
    if (selectedFiles && selectedFiles.length > 0) {
        return selectedFiles[0].fsPath;
    }
    return undefined;
}

/**
 * Reads test results and creates a report with the results, using VS Code's progress API.
 * @param context - The extension context.
 * @param workingDirectory - The working directory path.
 * @param currentProgress - Optional existing progress instance to report updates.
 * @returns The full path of the created report with results zip, or null if an error occurs.
 */
export async function readTestResultsAndCreateReportWithResults(
    context: vscode.ExtensionContext,
    workingDirectory: string,
    currentProgress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string | null> {
    try {
        let fullPathOfReportWithResultsZip: string | null = null;

        // Main execution logic encapsulated in a function for use with progress
        const executeWithProgress = async (
            progress: vscode.Progress<{ message?: string; increment?: number }>,
            cancellationToken: vscode.CancellationToken
        ) => {
            const reportIncrement = currentProgress ? 6 : 20;

            // Helper function to report progress updates
            const reportProgress = (message: string, increment: number) => {
                progress.report({ message, increment });
            };

            reportProgress(`Choosing result XML file.`, reportIncrement);

            const reportFileWithResultsZipName = `ReportWithResults_${Date.now()}.zip`;
            const config = vscode.workspace.getConfiguration(baseKey);
            const workspacePath = config.get<string>("workspaceLocation");
            if (!workspacePath) {
                throw new Error("Workspace location is not configured.");
            }

            const workingDirectoryFullPath = path.join(workspacePath, workingDirectory);

            const robotResultXMLFile = await chooseRobotXMLFile(workspacePath);
            if (!robotResultXMLFile) {
                throw new Error("No XML file selected.");
            }

            reportProgress(`Fetching report.`, reportIncrement);

            if (
                !lastGeneratedReportParams.executionBased ||
                !lastGeneratedReportParams.projectKey ||
                !lastGeneratedReportParams.cycleKey ||
                !lastGeneratedReportParams.UID
            ) {
                throw new Error("Last generated report parameters are missing.");
            }

            const cycleStructureOptionsRequestParameter: types.OptionalJobIDRequestParameter = {
                basedOnExecution: lastGeneratedReportParams.executionBased,
                treeRootUID: lastGeneratedReportParams.UID,
            };

            const downloadedReportZipFilePath = await fetchZipFile(
                baseKey,
                lastGeneratedReportParams.projectKey,
                lastGeneratedReportParams.cycleKey,
                workingDirectory,
                cycleStructureOptionsRequestParameter
            );

            reportProgress(`Working on report.`, reportIncrement);

            const reportWithResultsZipFileFullPath =
                downloadedReportZipFilePath ?? (await chooseReportWithouResultsZipFile(workingDirectoryFullPath));
            if (!reportWithResultsZipFileFullPath) {
                throw new Error("No report file selected.");
            }

            reportProgress(`Preparing configuration for testbench2robotframework.`, reportIncrement / 2);

            const tb2robotConfigFileFullPath = await saveTestbench2RobotConfigurationAsJson(
                baseKey,
                workingDirectoryFullPath
            );
            if (!tb2robotConfigFileFullPath) {
                throw new Error("Failed to create configuration file.");
            }

            reportProgress(`Reading test results and creating report.`, reportIncrement / 2);

            fullPathOfReportWithResultsZip = path.join(workingDirectoryFullPath, reportFileWithResultsZipName);

            // console.log("Calling startTb2robotRead.");
            const isExecutionSuccessful = await testbench2robotframeworkLib.tb2robotLib.startTb2robotRead(
                context,
                workingDirectoryFullPath,
                robotResultXMLFile,
                reportWithResultsZipFileFullPath,
                fullPathOfReportWithResultsZip,
                tb2robotConfigFileFullPath
            );
            // console.log("startTb2robotRead executed with success variable:", isSuccess);

            if (
                !(await handleExecutionError(
                    workingDirectoryFullPath,
                    isExecutionSuccessful,
                    reportWithResultsZipFileFullPath
                ))
            ) {
                return;
            }

            if (config.get<boolean>("clearReportAfterProcessing")) {
                await removeReportZipFile(reportWithResultsZipFileFullPath);
            }

            console.log(`tb2robot read executed successfully.`);
            vscode.window.showInformationMessage(`Test results read and report created.`);
        };

        // Use provided progress or create a new one
        if (currentProgress) {
            await executeWithProgress(currentProgress, {} as vscode.CancellationToken);
        } else {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Reading Test Results and Creating Report`,
                    cancellable: true,
                },
                executeWithProgress
            );
        }

        return fullPathOfReportWithResultsZip;
    } catch (error) {
        vscode.window.showErrorMessage(`An error occurred: ${(error as Error).message}`);
        console.error(`Error in readTestResultsAndCreateReportWithResults:`, error);
        return null;
    }
}

export async function readTestsAndCreateResultsAndImportToTestbench(
    context: vscode.ExtensionContext,
    folderNameOfTestbenchWorkingDirectory: string,
    projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null
): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Reading Test Results and Creating Report`,
            cancellable: true,
        },
        async (progress, cancellationToken) => {
            if (!connection) {
                vscode.window.showErrorMessage("No connection available. Please log in first.");
                return;
            }

            if (!projectManagementTreeDataProvider || !projectManagementTreeDataProvider.currentProjectKeyInView) {
                vscode.window.showErrorMessage("No project selected. Please select a project first.");
                return;
            }

            progress.report({
                message: `Reading Test Results and Creating Report.`,
                increment: 25,
            });

            let createdReportWithResultsFullPath = await readTestResultsAndCreateReportWithResults(
                context,
                folderNameOfTestbenchWorkingDirectory,
                progress
            );
            if (!createdReportWithResultsFullPath) {
                console.error("Error when reading test results and creating report with results.");
                return;
            }

            progress.report({
                message: `Importing report with results to TestBench.`,
                increment: 25,
            });

            await importReportWithResultsToTestbench(
                connection,
                projectManagementTreeDataProvider,
                createdReportWithResultsFullPath
            );

            progress.report({
                message: `Cleaning up.`,
                increment: 25,
            });

            const config = vscode.workspace.getConfiguration(baseKey);
            if (config.get<boolean>("clearReportAfterProcessing")) {
                // Remove the report zip file after usage
                await removeReportZipFile(createdReportWithResultsFullPath);
            }
        }
    );
}

/**
 * Entry point for the Robot Framework test generation process from the TestBench JSON report.
 * @param context The VS Code extension context
 * @param treeItem The selected tree item
 * @param baseKey The base key of the extension
 * @param workingDirectory The path to save the downloaded report
 * @returns Promise<void>
 */
export async function startTestGenerationProcessForCycle(
    context: vscode.ExtensionContext,
    treeItem: projectManagementTreeView.TestbenchTreeItem,
    baseKey: string,
    workingDirectory: string
): Promise<void> {
    try {
        if (!connection) {
            vscode.window.showErrorMessage("No connection available. Please log in first.");
            return;
        }

        const cycleKey = treeItem.item.key;
        if (!cycleKey) {
            throw new Error("Cycle key is unidentified!");
        }

        const projectKeyOfCycle = projectManagementTreeView.findProjectKeyOfCycleElement(treeItem);
        if (!projectKeyOfCycle) {
            throw new Error("Project key of cycle is unidentified!");
        }

        if (typeof treeItem.label !== "string") {
            throw new Error("Invalid label type. Test generation aborted.");
        }

        // Start the test generation process
        await generateTestsWithTestBenchToRobotFramework(
            context,
            treeItem,
            treeItem.label,
            baseKey,
            projectKeyOfCycle,
            cycleKey,
            workingDirectory,
            undefined // UIDofTestThemeElementToGenerateTestsFor is undefined for a test cycle
        );
    } catch (error: any) {
        console.error(error.message);
        vscode.window.showErrorMessage(error.message);
    }
}

/**
 * Writes the testbench2robotframework configuration to a JSON file in workspace folder.
 * @param baseKey The base key of the extension
 */
export async function saveTestbench2RobotConfigurationAsJson(
    baseKey: string,
    pathToJsonConfig: string
): Promise<string | null> {
    try {
        const config = vscode.workspace.getConfiguration(baseKey);
        const generationConfig = config.get<types.Testbench2robotframeworkConfiguration>(
            "testbench2robotframeworkConfig"
        );
        if (!generationConfig) {
            console.error("Configuration object is missing.");
            return null;
        }

        const jsonContent = JSON.stringify(generationConfig, null, 2);
        const filePath = getConfigurationFilePath(pathToJsonConfig);

        // Write file, overwriting if it already exists
        await fsPromise.writeFile(filePath, jsonContent, "utf8");
        console.log(`Configuration file created or overwritten at: ${filePath}`);

        return filePath;
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? `Failed to write configuration file: ${error.message}`
                : "An unknown error occurred while writing the configuration file.";

        vscode.window.showErrorMessage(errorMessage);
        console.error(errorMessage);
        return null;
    }
}

/**
 * Determines the file path where the testbench2robotframework configuration file will be saved.
 * @returns The file path of the configuration file.
 */
function getConfigurationFilePath(fullPathToJsonConfig: string): string {
    const fileName = "testbench2robotframeworkConfig.json";
    const filePath = path.join(fullPathToJsonConfig, fileName);
    return filePath;
}

/**
 * Deletes a file from the system if it exists.
 * @param configFilePath The path to the configuration file to be deleted
 * @returns Promise<void>
 */
export async function deleteConfigurationFile(configFilePath: string): Promise<void> {
    try {
        // Check if the file exists before attempting to delete
        await fsPromise.access(configFilePath);

        // Delete the file
        await fsPromise.unlink(configFilePath);
        console.log(`Configuration file deleted from: ${configFilePath}`);
    } catch (error: any) {
        if (error.code === "ENOENT") {
            vscode.window.showErrorMessage(`Configuration file not found: ${configFilePath}`);
        } else {
            vscode.window.showErrorMessage(`Failed to delete configuration file: ${error.message}`);
            console.error(`Error deleting file at ${configFilePath}:`, error);
        }
    }
}

// TEST CODE FOR AUTOMATING THE WHOLE PROCESS

/**
 * Retrieves an existing terminal or creates a new one if it doesn't exist.
 * @param terminalName - The name of the terminal.
 * @returns The VS Code Terminal instance.
 */
function getOrCreateTerminal(terminalName: string): vscode.Terminal {
    // Find an existing terminal with the specified name
    const existingTerminal = vscode.window.terminals.find((t) => t.name === terminalName);

    // If terminal exists, return it; otherwise, create a new one
    return existingTerminal ?? vscode.window.createTerminal(terminalName);
}

/**
 * Executes the 'robot -d output --dryrun Generated' command in the VS Code terminal.
 * @param outputDirOfRobotframeworkResults - The directory for Robot Framework output.
 * @param pathOfRobotFrameworkTests - The name of the file or directory to dry run.
 */
export async function executeRobotDryRunCommand(
    terminal: vscode.Terminal,
    outputDirOfRobotframeworkResults: string,
    pathOfRobotFrameworkTests: string
): Promise<void> {
    return new Promise(async (resolve, reject) => {
        try {
            // Validate input parameters to ensure they are non-empty strings
            if (!outputDirOfRobotframeworkResults || typeof outputDirOfRobotframeworkResults !== "string") {
                throw new Error("Invalid output directory provided.");
            }
            if (!pathOfRobotFrameworkTests || typeof pathOfRobotFrameworkTests !== "string") {
                throw new Error("Invalid generated file or directory provided.");
            }

            // Create or get an existing terminal named 'robot-dryrun'
            // const terminal = getOrCreateTerminal("robot-dryrun");

            // Execute the command in the terminal
            const command = `robot -d ${outputDirOfRobotframeworkResults} --dryrun ${pathOfRobotFrameworkTests}`;
            terminal.show(true); // Show the terminal and focus on it
            terminal.sendText(command);

            // Inform the user the command was executed
            console.log(`Executing command: ${command}`);
        } catch (error) {
            console.error("Failed to execute command robot --dryrun:", error);
            // Display any errors encountered during execution
            vscode.window.showErrorMessage(`Failed to execute command robot --dryrun:: ${error}`);
        } finally {
            resolve(); // Resolve promise when terminal execution is complete
        }
    });
}

/**
 * Executes the three required commands in sequence in the same terminal.
 * @param reportWithoutResultsZipFilePath - The name of the cycle zip file to be processed.
 * @param outputDirOfRobotframeworkResults - The directory for Robot Framework output.
 * @param pathOfRobotFrameworkTests - The file or directory to dry run.
 * @param robotResultXMLFile - The output file path (default is 'output/output.xml').
 * @param reportWithResultsZipFilePath - The report file to be generated (default is 'ReportWithResults.zip').
 */
export async function generateTestsExecuteTestsReadResults(
    terminalCodeExecutionPath: string,
    outputDirOfRobotframeworkResults: string = "output",
    pathOfRobotFrameworkTests: string = "Generated" // Use generationDirectory ordner of robot2robotframework
): Promise<void> {
    return new Promise(async (resolve, reject) => {
        const terminal = getOrCreateTerminal("generate-tests");
        terminal.sendText(`cd ${terminalCodeExecutionPath}`); // Execute terminal commands inside this directory

        try {
            // Step 2: Execute 'robot -d output --dryrun Generated'
            await executeRobotDryRunCommand(terminal, outputDirOfRobotframeworkResults, pathOfRobotFrameworkTests);
            console.log(
                `Successfully executed: robot -d ${outputDirOfRobotframeworkResults} --dryrun ${pathOfRobotFrameworkTests}`
            );
        } catch (error) {
            console.error(`Error executing commands in sequence: ${error}`);
            vscode.window.showErrorMessage(`Error executing commands in sequence: ${error}`);
        } finally {
            resolve(); // Resolve promise when terminal execution is complete
        }
    });
}
