import * as vscode from "vscode";
import * as fs from "fs";
import * as fsPromise from "fs/promises";
import * as path from "path";
import * as testBenchTypes from "./testBenchTypes";
import axios, { AxiosResponse } from "axios";
import * as projectManagementTreeView from "./projectManagementTreeView";
import * as testbench2robotframeworkLib from "./testbench2robotframeworkLib";
import { connection, baseKey, lastGeneratedReportParams, logger } from "./extension";
import { importReportWithResultsToTestbench } from "./testBenchConnection";

/**
 * Prompt the user to select the export report method in quick pick format (Execution based or Specification based).
 * @returns {Promise<boolean | null>} - Resolves with the selected option (true for Execution based, false for Specification based) or null if the user cancels the selection.
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
                    logger.debug("User canceled the export method selection.");
                } else {
                    resolve(selection[0].label === "Execution based"); // Resolve with the selected option
                    logger.debug(`Export method selected: ${selection[0].label}`);
                }
                quickPick.hide(); // Close the quick pick after selection
            }
        });

        // Handle case when the quick pick is hidden without user selection (e.g., if user clicks away)
        quickPick.onDidHide(() => {
            resolve(null);
            logger.debug("User closed the export method selection dialog.");
            quickPick.dispose(); // Clean up resources after closing
        });

        quickPick.show(); // Show the quick pick to the user
    });
}

/**
 * Checks if the report job has completed successfully.
 * @param {testBenchTypes.JobStatusResponse} jobStatus The job status response object
 * @returns {boolean} True if the report job has completed successfully, otherwise false
 */
export function isReportJobCompletedSuccessfully(jobStatus: testBenchTypes.JobStatusResponse): boolean {
    logger.debug(
        `isReportJobCompletedSuccessfully resulted in ${!!jobStatus?.completion?.result?.ReportingSuccess?.reportName}`
    );
    return !!jobStatus?.completion?.result?.ReportingSuccess?.reportName;
}

/**
 * Checks if the import job has completed successfully.
 * @param {testBenchTypes.JobStatusResponse} jobStatus The job status response object
 * @returns {boolean} True if the import job has completed successfully, otherwise false
 */
export function isImportJobCompletedSuccessfully(jobStatus: testBenchTypes.JobStatusResponse): boolean {
    logger.debug(
        `isImportJobCompletedSuccessfully resulted in ${!!jobStatus?.completion?.result?.ExecutionImportingSuccess}`
    );
    return !!jobStatus?.completion?.result?.ExecutionImportingSuccess;
}

/**
 * Checks if the import job has failed.
 * @param {testBenchTypes.JobStatusResponse} jobStatus The job status response object
 * @returns {boolean} True if the import job has failed, otherwise false
 */
export function isImportJobFailed(jobStatus: testBenchTypes.JobStatusResponse): boolean {
    logger.debug(`isImportJobFailed resulted in ${!!jobStatus?.completion?.result?.ExecutionImportingFailure}`);
    return !!jobStatus?.completion?.result?.ExecutionImportingFailure;
}

/**
 * Fetch the TestBench JSON report (ZIP Archive) for the selected item from the server.
 * 3 Calls are needed to download the zip report:
 * 1. Get the job ID
 * 2. Get the job status of that job ID (Polling until the job is completed)
 * 3. Download the report zip file.
 *
 * @param baseKey The base key of the extension
 * @param projectKey The project key
 * @param cycleKey The cycle key
 * @param progress Progress bar to show the poll attempts to the user
 * @param folderNameToDownloadReport The folder name to save the downloaded report
 * @param requestParams Optional request parameters (exec/spec based, root UID) for the job ID request
 * @param cancellationToken Cancellation token to be able to cancel the polling by clicking cancel button
 * @returns {Promise<string | undefined>} The path of the downloaded zip file if the download was successful, otherwise undefined
 */
export async function fetchZipFile(
    baseKey: string,
    projectKey: string,
    cycleKey: string,
    folderNameToDownloadReport: string,
    requestParams?: testBenchTypes.OptionalJobIDRequestParameter,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken?: vscode.CancellationToken
): Promise<string | undefined> {
    try {
        if (!connection) {
            logger.error("Connection object is missing.");
            return undefined;
        }

        logger.debug(
            `Fetching report for projectKey: ${projectKey}, cycleKey: ${cycleKey}, folderNameToDownloadReport: ${folderNameToDownloadReport}.`
        );
        logger.trace(`Fetching report with requestParams:`, requestParams);

        const jobId: string | null = await getJobId(projectKey, cycleKey, requestParams);
        if (!jobId) {
            console.warn("Job ID not received.");
            return undefined;
        }
        logger.debug(`Job ID (${jobId}) fetched successfully.`);

        const jobStatus: testBenchTypes.JobStatusResponse | null = await pollJobStatus(
            projectKey,
            jobId,
            "report",
            progress,
            cancellationToken
        );

        if (!jobStatus || !isReportJobCompletedSuccessfully(jobStatus)) {
            logger.warn("Report generation was unsuccessful.");
            vscode.window.showErrorMessage("Report generation was unsuccessful.");
            return undefined;
        }

        const fileName: string = jobStatus.completion.result.ReportingSuccess!.reportName;
        logger.debug(`Report name to download: ${fileName}`);

        const outputPath: string | undefined = await downloadReport(
            baseKey,
            projectKey,
            fileName,
            folderNameToDownloadReport
        );
        if (outputPath) {
            return outputPath;
        } else {
            logger.warn("Download canceled or failed.");
        }
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            logger.debug("Operation cancelled by the user.");
            vscode.window.showInformationMessage("Operation cancelled by the user.");
            return undefined;
        } else {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                throw new Error("Resource not found.");
            } else {
                logger.error(`Error fetching the report for project ${projectKey} and cycle ${cycleKey}: ${error}`);
                throw error;
            }
        }
    }
}

/**
 * Poll the job status (Either report of import job) until the job is completed successfully or failed.
 * @param connection Connection object to the server
 * @param projectKey Project key
 * @param jobId Job ID received from the server
 * @param jobType Type of job (report or import)
 * @param progress Progress bar to show the poll attempts to the user
 * @param cancellationToken Cancellation token to be able to cancel the polling by clicking cancel button
 * @param maxPollingTimeMs Maximum time to poll the job status, after which the polling will be stopped
 * @returns {Promise<testBenchTypes.JobStatusResponse | null>} Job status response object if the job is completed, otherwise null
 */
export async function pollJobStatus(
    projectKey: string,
    jobId: string,
    jobType: "report" | "import",
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken?: vscode.CancellationToken,
    maxPollingTimeMs?: number // Optional timeout, disabled by default so that the user can cancel manually
): Promise<testBenchTypes.JobStatusResponse | null> {
    const startTime: number = Date.now(); // Start time for the polling to adjust the polling interval after 10 seconds
    let attempt: number = 0;
    let jobStatus: testBenchTypes.JobStatusResponse | null = null;
    let lastIncrement: number = 0;

    // Poll the job status until the job is completed with either success or failure
    while (true) {
        if (cancellationToken?.isCancellationRequested) {
            logger.debug("Polling operation cancelled by the user.");
            vscode.window.showInformationMessage("Polling operation cancelled by the user.");
            throw new vscode.CancellationError();
        }

        if (!connection) {
            logger.error("Connection object is missing (pollJobStatus).");
            return null;
        }

        attempt++;

        try {
            jobStatus = await getJobStatus(projectKey, jobId, jobType);
            if (!jobStatus) {
                logger.warn("Job status not received.");
                return null;
            }

            // Display the job status progress in the progress bar text
            let jobStatusResponseTotalItemsCount: number | undefined = jobStatus?.progress?.totalItemsCount;
            let jobStatusResponseHandledItemsCount: number | undefined = jobStatus?.progress?.handledItemsCount;
            if (jobStatusResponseTotalItemsCount && jobStatusResponseHandledItemsCount) {
                let roundedProgressPercentage: number = Math.round(
                    (jobStatusResponseHandledItemsCount / jobStatusResponseTotalItemsCount) * 100
                );

                progress?.report({
                    message: `Fetching job status (${jobStatusResponseHandledItemsCount}/${jobStatusResponseTotalItemsCount}).`,
                    increment: (roundedProgressPercentage - lastIncrement) / 3,
                });
                logger.debug(`Attempt ${attempt}: Job Status fetched. Progress: ${roundedProgressPercentage}%`);

                lastIncrement = roundedProgressPercentage;
            } else {
                logger.debug(`Attempt ${attempt}: Job Status fetched.`);
            }

            if (jobType === "report") {
                if (isReportJobCompletedSuccessfully(jobStatus)) {
                    logger.debug("Report job completed successfully.");
                    return jobStatus;
                } else {
                    // logger.debug("Job not yet completed.");
                }
            } else if (jobType === "import") {
                if (isImportJobCompletedSuccessfully(jobStatus)) {
                    logger.debug("Import job completed successfully.");
                    return jobStatus;
                } else if (isImportJobFailed(jobStatus)) {
                    return null;
                }
            }
        } catch (error) {
            logger.error(`Attempt ${attempt}: Failed to get job status.`, error);
        }

        // Update the progress bar, if provided
        // progress?.report({ message: `Fetching job status. Attempt ${attempt}.` });

        // (Optional) Check if the maximum polling time has been exceeded.
        if (maxPollingTimeMs !== undefined) {
            const elapsedTime: number = Date.now() - startTime;
            if (elapsedTime >= maxPollingTimeMs) {
                logger.warn("Maximum polling time exceeded. Aborting job status polling.");
                break;
            }
        }

        // Adjust polling interval based on elapsed time.
        // For the first 10 seconds, poll every 200 ms, then poll every 1 second.
        const elapsedTime: number = Date.now() - startTime;
        const delayMs: number = elapsedTime < 10000 ? 200 : 1000;
        // console.log(`Waiting ${delayMs} ms before next attempt.`);
        await delay(delayMs);
    }

    logger.trace("Job Status:", jobStatus);
    return jobStatus;
}

/**
 * Get the job ID from server for the report or import job.
 * @param projectKey The project key
 * @param cycleKey The cycle key
 * @param requestParams Optional request parameters (exec/spec based, root UID) for the job ID request
 * @returns {Promise<string | null>} The job ID received from the server
 */
export async function getJobId(
    projectKey: string,
    cycleKey: string,
    requestParams?: testBenchTypes.OptionalJobIDRequestParameter // TODO: Execution mode is added in new branch, project tree is also changed? ExecutionImportingSuccess
): Promise<string | null> {
    if (!connection) {
        logger.error("Connection object is missing.");
        return "";
    }

    const url: string = `${connection.getBaseURL()}/projects/${projectKey}/cycles/${cycleKey}/report/v1`;

    logger.debug(
        `Sending request to fetch job ID for projectKey: ${projectKey}, cycleKey: ${cycleKey} to the URL ${url}.`
    );

    const jobIdResponse: AxiosResponse<testBenchTypes.JobIdResponse> = await axios.post(url, requestParams, {
        headers: {
            accept: "application/json",
            Authorization: connection.getSessionToken(), // Include session token for authorization
            "Content-Type": "application/json",
        },
    });

    logger.trace("jobIdResponse received from server:", jobIdResponse);

    if (jobIdResponse.status !== 200) {
        logger.error(`Failed to fetch job ID, status code: ${jobIdResponse.status}`);
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
 * @returns {Promise<testBenchTypes.JobStatusResponse | null>} The job status response object
 */
export async function getJobStatus(
    projectKey: string,
    jobId: string,
    jobType: "report" | "import"
): Promise<testBenchTypes.JobStatusResponse | null> {
    if (!connection) {
        logger.error("Connection object is missing (getJobStatus).");
        return null;
    }

    const url: string = `${connection.getBaseURL()}/projects/${projectKey}/${jobType}/job/${jobId}/v1`;

    logger.debug(`Checking job status: ${url}`);

    const jobStatusResponse: AxiosResponse<testBenchTypes.JobStatusResponse> = await axios.get(url, {
        headers: {
            accept: "application/vnd.testbench+json",
            Authorization: connection.getSessionToken(),
        },
    });

    logger.trace("jobStatusResponse:", jobStatusResponse.data);

    if (jobStatusResponse.status !== 200) {
        logger.error(`Failed to fetch job status, status code: ${jobStatusResponse.status}`);
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
 * @returns {Promise<string | undefined>} The path of the downloaded zip file if successful, otherwise undefined
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
            logger.error("Connection object is missing (downloadReport).");
            return undefined;
        }

        // Construct the download URL
        const url: string = `${connection.getBaseURL()}/projects/${projectKey}/report/${fileName}/v1`;
        logger.debug(`Sending request to download report ${fileName} from URL ${url}.`);

        // Fetch the report from the server
        const downloadZipResponse: AxiosResponse<any> = await axios.get(url, {
            responseType: "arraybuffer", // Expecting binary data
            headers: {
                accept: "application/vnd.testbench+json",
                Authorization: connection.getSessionToken(),
            },
        });

        // Check for successful response
        if (downloadZipResponse.status !== 200) {
            logger.error(`Failed to download report, status code: ${downloadZipResponse.status}`);
            throw new Error(`Failed to download report, status code: ${downloadZipResponse.status}`);
        }

        // Get the workspace configuration
        const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKey);
        const workspaceLocation: string | undefined = config.get<string>("workspaceLocation");

        if (workspaceLocation && fs.existsSync(workspaceLocation)) {
            // Save report to the specified workspace location
            return await saveReportToFile(workspaceLocation, folderNameToDownloadReport, fileName, downloadZipResponse);
        } else if (workspaceLocation) {
            logger.error(`The configured download location does not exist: ${workspaceLocation}`);
            vscode.window.showErrorMessage(`The configured workspace location does not exist: ${workspaceLocation}`);
        }

        // If no valid workspace location, prompt the user to choose a save location
        return await promptUserForSaveLocationAndSaveReportToFile(fileName, downloadZipResponse);
    } catch (error) {
        logger.error(`Error downloading the report: ${(error as Error).message}`);
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
 * @returns {Promise<string | undefined>} The path of the saved file
 */
async function saveReportToFile(
    workspaceLocation: string,
    folderName: string,
    fileName: string,
    downloadResponse: AxiosResponse<any>
): Promise<string | undefined> {
    try {
        const filePath: string = path.join(workspaceLocation, folderName, fileName);
        const uri: vscode.Uri = vscode.Uri.file(filePath);

        // Write the file to the specified location
        await vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadResponse.data));
        logger.debug(`Report downloaded successfully to ${uri.fsPath}`);
        return uri.fsPath;
    } catch (error) {
        logger.error(`Failed to save report to file: ${(error as Error).message}`);
        vscode.window.showErrorMessage(`Failed to save report: ${(error as Error).message}`);
        return undefined;
    }
}

/**
 * Prompts the user to choose a save location and writes the file there.
 * @param fileName The name of the file to save
 * @param downloadResponse The Axios response containing the file data
 * @returns {Promise<string | undefined>} The path of the saved file if successful, otherwise undefined
 */
async function promptUserForSaveLocationAndSaveReportToFile(
    fileName: string,
    downloadResponse: AxiosResponse<any>
): Promise<string | undefined> {
    const zipUri: vscode.Uri | undefined = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileName),
        filters: { "Zip Files": ["zip"] },
    });

    if (zipUri) {
        try {
            // Check if the file already exists
            try {
                await vscode.workspace.fs.stat(zipUri);

                // Prompt user for overwrite confirmation
                const overwriteOption: string | undefined = await vscode.window.showWarningMessage(
                    `The file "${fileName}" already exists. Do you want to overwrite it?`,
                    { modal: true },
                    "Overwrite",
                    "Skip"
                );

                if (overwriteOption === "Skip") {
                    vscode.window.showInformationMessage("File download skipped by the user.");
                    logger.debug("File download skipped by the user.");
                    return undefined;
                }
            } catch (error) {
                // If file does not exist, proceed
                if ((error as vscode.FileSystemError).code !== "FileNotFound") {
                    throw error;
                }
            }

            // Write the file to the chosen location
            await vscode.workspace.fs.writeFile(zipUri, new Uint8Array(downloadResponse.data));
            logger.debug(`Report downloaded successfully to ${zipUri.fsPath}`);
            return zipUri.fsPath;
        } catch (error) {
            logger.error(`Failed to save file: ${(error as Error).message}`);
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
export async function fetchReportForTreeElement(
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
                logger.debug("Fetching report for the selected tree item:", treeItem);

                // Validate the connection
                if (!connection) {
                    logger.warn("No connection available (callFetchReportForTreeElement)");
                    throw new Error("No connection available. Please log in first.");
                }

                // Validate the project management tree view
                if (!projectManagementTreeViewOfExtension) {
                    logger.warn("Project management tree is not initialized. (callFetchReportForTreeElement)");
                    throw new Error("Project management tree is not initialized. Please select a project first.");
                }

                // Get the key of the current project that is displayed in the project managemement tree view
                const projectKey: string | null = projectManagementTreeViewOfExtension.currentProjectKeyInView;
                if (!projectKey) {
                    logger.warn("No project selected. (callFetchReportForTreeElement)");
                    throw new Error("No project selected. Please select a project first.");
                }

                // Find the cycle key associated with the selected tree item to fetch the report
                const cycleKey: string | undefined = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
                if (!cycleKey) {
                    logger.warn("Cycle key for the selected tree element not found. (callFetchReportForTreeElement)");
                    throw new Error("Cycle key for the selected tree element not found. Please select a cycle first.");
                }

                // Get the unique ID of the tree element
                const treeElementUniqueID: string | undefined = treeItem.item?.base?.uniqueID;

                // Check if the report should be based on execution
                const executionBased: boolean = true; // await isExecutionBasedReportSelected();  // TODO: Using execution based for QS day by default.
                if (executionBased === null) {
                    logger.debug("Export method is not selected. Fetching report for the selected tree item.");
                    return;
                }

                // Set up the request parameters
                // TODO: For QS Day, executionBased is used by default without asking the user.
                const cycleStructureOptionsRequestParameter: testBenchTypes.OptionalJobIDRequestParameter = {
                    basedOnExecution: executionBased,
                    treeRootUID: treeElementUniqueID,
                };

                logger.debug(
                    `Started fetching report for projectKey: ${projectKey}, cycleKey: ${cycleKey}, uniqueID: ${treeElementUniqueID}.`
                );

                // Report progress for fetching the report
                progress?.report({ increment: 30, message: "Fetching report." });

                // Fetch the ZIP file, handle potential cancellation
                const downloadedReportZipFilePath: string | undefined = await fetchZipFile(
                    baseKey,
                    projectKey,
                    cycleKey,
                    workingDirectory,
                    cycleStructureOptionsRequestParameter
                );

                logger.debug(`Report successfully downloaded to: ${downloadedReportZipFilePath}.`);
            } catch (error) {
                // Handle errors and show an error message to the user
                vscode.window.showErrorMessage((error as Error).message);
                console.error("Error fetching report:", error);
            }
        }
    );
}

/**
 * Generate test cases for the selected TestThemeNode or TestCaseSetNode.
 * @param context VS Code extension context
 * @param treeItem The selected tree item
 * @param folderNameOfTestbenchWorkingDirectory The folder name of the testbench working directory
 */
export async function generateTestCasesForTestThemeOrTestCaseSet(
    context: vscode.ExtensionContext,
    treeItem: projectManagementTreeView.TestbenchTreeItem,
    folderNameOfTestbenchWorkingDirectory: string
): Promise<void> {
    logger.trace("Generating tests for non cycle element:", treeItem);

    let treeElementUniqueID: string | undefined = treeItem.item?.base?.uniqueID;
    let cycleKey: string | undefined = projectManagementTreeView.findCycleKeyOfTreeElement(treeItem);
    let projectKey: string | undefined = projectManagementTreeView.findProjectKeyOfCycleElement(treeItem.parent!);

    if (!projectKey || !cycleKey || !treeElementUniqueID) {
        logger.error("Error when finding project key, cycle key, test theme or unique ID.");
        return;
    }

    await generateTestsWithTestBenchToRobotFramework(
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
 * @param folderNameOfTestbenchWorkingDirectory - The path to save the downloaded report
 * @param UIDofTestThemeElementToGenerateTestsFor - (Optional) The unique ID of the clicked TestThemeNode element to generate tests for
 */
export async function generateTestsWithTestBenchToRobotFramework(
    context: vscode.ExtensionContext,
    treeItem: projectManagementTreeView.TestbenchTreeItem,
    itemLabel: string,
    baseKey: string,
    projectKey: string,
    cycleKey: string,
    folderNameOfTestbenchWorkingDirectory: string,
    UIDofTestThemeElementToGenerateTestsFor?: string
): Promise<void> {
    try {
        const executionBased: boolean = true; // await isExecutionBasedReportSelected();  // TODO: For QS day, use true for this value.
        if (executionBased === null) {
            vscode.window.showInformationMessage("Test generation aborted.");
            logger.debug("Test generation aborted.");
            return;
        }

        const UIDofSelectedElement: string | undefined =
            UIDofTestThemeElementToGenerateTestsFor || (await displayAndSelectTestThemeNode(treeItem));
        if (!UIDofSelectedElement) {
            logger.error("Test theme selection was empty.");
            return;
        }

        const cycleReportOptions: testBenchTypes.OptionalJobIDRequestParameter = {
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
                    folderNameOfTestbenchWorkingDirectory,
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
 * @returns {Promise<string | undefined>} The unique ID of the selected TestThemeNode or 'Generate all'
 */
async function displayAndSelectTestThemeNode(treeItem: any): Promise<string | undefined> {
    const testThemeNodes: { name: string; uniqueID: string; numbering?: string }[] = findTestThemeNodes(treeItem);

    const quickPickItems: { label: string; description: string; uniqueID?: string }[] = [
        { label: "Generate all", description: "Generate All Tests Under The Test Cycle" },
        ...testThemeNodes.map((node) => ({
            label: node.numbering ? `${node.numbering} ${node.name}` : node.name,
            description: `ID: ${node.uniqueID}`,
            uniqueID: node.uniqueID,
        })),
    ];

    const selected: { label: string; uniqueID?: string } | undefined = await vscode.window.showQuickPick(
        quickPickItems,
        {
            placeHolder: 'Select a test theme or "Generate all" to generate all tests under the cycle.',
        }
    );

    return selected?.label === "Generate all" ? "Generate all" : selected?.uniqueID;
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
 * @param folderNameOfTestbenchWorkingDirectory - The working directory path
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
    folderNameOfTestbenchWorkingDirectory: string,
    UIDofSelectedElement: string,
    cycleStructureOptions: testBenchTypes.OptionalJobIDRequestParameter,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken: vscode.CancellationToken
): Promise<void> {
    progress.report({ increment: 30, message: "Fetching JSON Report from the server." });

    const downloadedReportZipFilePath: string | undefined = await fetchZipFile(
        baseKey,
        projectKey,
        cycleKey,
        folderNameOfTestbenchWorkingDirectory, // The (.testbench) folder name we process files in
        cycleStructureOptions,
        progress,
        cancellationToken
    );

    if (!downloadedReportZipFilePath) {
        logger.warn("Download canceled or failed.");
        return;
    }

    progress.report({ increment: 30, message: "Generating test cases with testbench2robotframework." });

    // Workspace path is the folder we are working in, workingDirectoryPath is the (.testbench) folder path we process files in.
    const workspacePath: string = vscode.workspace.getConfiguration(baseKey).get<string>("workspaceLocation")!;
    const workingDirectoryPath: string = path.join(workspacePath, folderNameOfTestbenchWorkingDirectory);

    const tb2robotConfigFilePath: string | null = await saveTestbench2RobotConfigurationAsJson(
        baseKey,
        workingDirectoryPath
    );
    if (!tb2robotConfigFilePath) {
        logger.error("Failed to save configuration file.");
        return;
    }

    logger.debug("Calling testbench2robotframework write command");
    const isTb2RobotExecutionSuccessful: boolean = await testbench2robotframeworkLib.tb2robotLib.startTb2robotWrite(
        context,
        workingDirectoryPath,
        downloadedReportZipFilePath,
        tb2robotConfigFilePath
    );
    logger.debug(
        `testbench2robotframework write command executed with success variable: ${isTb2RobotExecutionSuccessful}`
    );

    if (!isTb2RobotExecutionSuccessful) {
        await cleanUpConfigAndReportFiles(
            getConfigurationFilePath(workingDirectoryPath),
            downloadedReportZipFilePath,
            baseKey
        );
        logger.error(`Test generation failed. Please make sure that your tests can be automated.`);
        vscode.window.showErrorMessage(`Test generation failed. Please make sure that your tests can be automated.`);
        return;
    }

    updateLastGeneratedReportParams(UIDofSelectedElement, projectKey, cycleKey, executionBased);
    await cleanUpConfigAndReportFiles(tb2robotConfigFilePath, downloadedReportZipFilePath, baseKey);

    vscode.window.showInformationMessage("Test generation done.");
    logger.debug("Test generation done.");

    // Open the Testing view of VS Code after generating the tests
    vscode.commands.executeCommand("workbench.view.extension.test");
}

/**
 * Update the parameters for the last generated report.
 */
function updateLastGeneratedReportParams(
    UID: string,
    projectKey: string,
    cycleKey: string,
    executionBased: boolean
): void {
    lastGeneratedReportParams.UID = UID;
    lastGeneratedReportParams.projectKey = projectKey;
    lastGeneratedReportParams.cycleKey = cycleKey;
    lastGeneratedReportParams.executionBased = executionBased;
}

/**
 * Clean up temporary files and configurations.
 * @param tb2robotConfigFilePath The path of the testbench2robotframework configuration file
 * @param reportZipFilePath The path of the report ZIP file
 * @param baseKey The base key of the extension
 */
async function cleanUpConfigAndReportFiles(
    tb2robotConfigFilePath: string,
    reportZipFilePath: string,
    baseKey: string
): Promise<void> {
    await deleteTb2RobotConfigurationFile(tb2robotConfigFilePath);

    if (vscode.workspace.getConfiguration(baseKey).get<boolean>("clearReportAfterProcessing")) {
        await removeReportZipFile(reportZipFilePath);
    }
    logger.debug("Cleanup done.");
}

/**
 * Handle errors gracefully.
 */
function handleError(error: any): void {
    if (error instanceof vscode.CancellationError) {
        logger.debug("Process cancelled by the user.");
        vscode.window.showInformationMessage("Process cancelled by the user.");
    } else {
        logger.error("An error occurred:", error);
        vscode.window.showErrorMessage(`An error occurred: ${error.message || error}`);
    }
}

/**
 * Removes the specified zip file from the system if it exists and is a valid zip file.
 * @param zipFileFullPath The path of the zip file to be removed
 * @returns Promise<void>
 */
export async function removeReportZipFile(
    zipFileFullPath: string,
    maxRetries: number = 5,
    delay: number = 500
): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Check if the file exists
            await fsPromise.access(zipFileFullPath);

            const fileName: string = path.basename(zipFileFullPath);
            const fileExtension: string = path.extname(zipFileFullPath);

            // Validate that the file is a zip file
            if (fileExtension !== ".zip") {
                throw new Error(`Invalid file type: ${fileExtension}. Only zip files can be removed.`);
            }

            // Remove the file
            await fsPromise.unlink(zipFileFullPath);
            logger.debug(`Zip file successfully removed: ${fileName} `);
            return;
        } catch (error: any) {
            if (error.code === "ENOENT") {
                logger.error(`File not found: ${zipFileFullPath}`);
                vscode.window.showWarningMessage(`File not found: ${zipFileFullPath}`);
                return;
            } else if (error.code === "EBUSY" && attempt < maxRetries) {
                logger.warn(
                    `Attempt ${attempt} to delete file ${zipFileFullPath} failed due to "EBUSY". Retrying in ${delay}ms...`
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            } else {
                logger.error(`Error removing file at ${zipFileFullPath}:`, error);
                vscode.window.showErrorMessage(`Error removing the file: ${(error as Error).message}`);
                return;
            }
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
        const files: string[] = await fsPromise.readdir(dir);

        for (const file of files) {
            const fullPath: string = path.join(dir, file);
            const stat: fs.Stats = await fsPromise.stat(fullPath);

            if (stat.isDirectory()) {
                // Recursively search in subdirectories
                const result: string | undefined = await findFileRecursively(fullPath, fileName);
                if (result) {
                    return result;
                }
            } else if (stat.isFile() && file === fileName) {
                logger.debug(`File found: ${fullPath}`);
                return fullPath;
            }
        }
    } catch (error) {
        logger.error(`Error searching for file: ${error instanceof Error ? error.message : String(error)}`);
    }

    return undefined;
}

/**
 * Opens a file selection dialog for the user to choose the output XML file.
 * Note: If multiple output XML files are present, the first one found will be returned.
 * If the wrong file is selected automatically, the upload process will fail. To avoid this, set the output XML path in the settings correctly
 * @param workingDirectoryFullPath The full path of the working directory.
 * @returns {Promise<string | undefined>} The full path of the selected output XML file, or undefined if no file is selected.
 */
async function chooseRobotXMLFile(workingDirectoryFullPath: string): Promise<string | undefined> {
    // Open file selection dialog, filtered for XML files
    const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKey);
    let outputXMLFolderFullPath: string | undefined = config.get<string>("outputXMLPath");
    if (!outputXMLFolderFullPath) {
        logger.warn("Output XML path is not configured.");
    } else {
        const fileName = "output.xml";
        logger.debug(`Searching for ${fileName} in ${outputXMLFolderFullPath}`);
        const outputXmlFilePath: string | undefined = await findFileRecursively(outputXMLFolderFullPath, fileName);
        if (outputXmlFilePath) {
            return outputXmlFilePath;
        }
    }

    const selectedFiles: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
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

/**
 * Opens a file selection dialog for the user to choose the report zip file.
 * @param workingDirectoryFullPath The full path of the working directory.
 * @returns {Promise<string | undefined>} The full path of the selected report zip file, or undefined if no file is selected.
 */
async function chooseReportWithouResultsZipFile(workingDirectoryFullPath: string): Promise<string | undefined> {
    // Open file selection dialog, filtered for XML files
    const selectedFiles: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
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
 * @returns {Promise<string | null>} The full path of the created report with results zip, or null if an error occurs.
 */
export async function readTestResultsAndCreateReportWithResults(
    context: vscode.ExtensionContext,
    workingDirectory: string,
    currentProgress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string | null> {
    try {
        logger.debug("Started reading test results and creating report with results.");

        let fullPathOfReportWithResultsZip: string | null = null;

        // Main execution logic encapsulated in a function for use with progress
        const executeWithProgress = async (
            progress: vscode.Progress<{ message?: string; increment?: number }>,
            cancellationToken: vscode.CancellationToken
        ) => {
            const reportIncrement: number = currentProgress ? 6 : 20;

            // Helper function to report progress updates
            const reportProgress = (message: string, increment: number) => {
                progress.report({ message, increment });
            };

            reportProgress(`Choosing result XML file.`, reportIncrement);

            const reportFileWithResultsZipName: string = `ReportWithResults_${Date.now()}.zip`;
            const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKey);
            const workspacePath: string | undefined = config.get<string>("workspaceLocation");
            if (!workspacePath) {
                throw new Error("Workspace location is not configured.");
            }

            const workingDirectoryPath: string = path.join(workspacePath, workingDirectory);

            const robotResultXMLFile: string | undefined = await chooseRobotXMLFile(workspacePath);
            if (!robotResultXMLFile) {
                throw new Error("No XML file selected.");
            }

            logger.debug(`The report with result zip file will be named ${reportFileWithResultsZipName}`);

            reportProgress(`Fetching report.`, reportIncrement);

            if (
                !lastGeneratedReportParams.executionBased ||
                !lastGeneratedReportParams.projectKey ||
                !lastGeneratedReportParams.cycleKey ||
                !lastGeneratedReportParams.UID
            ) {
                throw new Error("Last generated report parameters are missing.");
            }

            const cycleStructureOptionsRequestParameter: testBenchTypes.OptionalJobIDRequestParameter = {
                basedOnExecution: lastGeneratedReportParams.executionBased,
                treeRootUID: lastGeneratedReportParams.UID,
            };

            const downloadedReportZipFilePath: string | undefined = await fetchZipFile(
                baseKey,
                lastGeneratedReportParams.projectKey,
                lastGeneratedReportParams.cycleKey,
                workingDirectory,
                cycleStructureOptionsRequestParameter
            );

            reportProgress(`Working on report.`, reportIncrement);

            // Either use the downloaded report zip file or prompt the user to select one
            const reportWithResultsZipFilePath: string | undefined =
                downloadedReportZipFilePath ?? (await chooseReportWithouResultsZipFile(workingDirectoryPath));
            if (!reportWithResultsZipFilePath) {
                throw new Error("No report file selected.");
            }

            logger.debug(`Report with results is saved to ${reportWithResultsZipFilePath}`);

            reportProgress(`Preparing configuration for testbench2robotframework.`, reportIncrement / 2);

            const tb2robotConfigFileFullPath: string | null = await saveTestbench2RobotConfigurationAsJson(
                baseKey,
                workingDirectoryPath
            );
            if (!tb2robotConfigFileFullPath) {
                throw new Error("Failed to create configuration file.");
            }

            reportProgress(`Reading test results and creating report.`, reportIncrement / 2);

            fullPathOfReportWithResultsZip = path.join(workingDirectoryPath, reportFileWithResultsZipName);

            logger.debug("Calling startTb2robotRead.");
            const isTb2RobotExecutionSuccessful: boolean =
                await testbench2robotframeworkLib.tb2robotLib.startTb2robotRead(
                    context,
                    workingDirectoryPath,
                    robotResultXMLFile,
                    reportWithResultsZipFilePath,
                    fullPathOfReportWithResultsZip,
                    tb2robotConfigFileFullPath
                );
            logger.debug(`startTb2robotRead executed with success variable: ${isTb2RobotExecutionSuccessful}`);

            if (!isTb2RobotExecutionSuccessful) {
                await cleanUpConfigAndReportFiles(
                    getConfigurationFilePath(workingDirectoryPath),
                    reportWithResultsZipFilePath,
                    baseKey
                );
                logger.error(
                    `Importing test results failed. Please make sure you are using the correct output.xml path in the extension settings.`
                );
                vscode.window.showErrorMessage(
                    `Importing test results failed. Please make sure you are using the correct output.xml path in the extension settings.`
                );
                return;
            }

            await cleanUpConfigAndReportFiles(tb2robotConfigFileFullPath, reportWithResultsZipFilePath, baseKey);

            logger.debug(`tb2robot read executed successfully.`);

            // When reading results and importing are automated together, this info message is not needed.
            // vscode.window.showInformationMessage(`Test results read and report created.`);
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
        logger.error(`Error in readTestResultsAndCreateReportWithResults:`, error);
        return null;
    }
}

/**
 * Executes the testbench2robotframework read command to create a report zip with results and imports it to TestBench server.
 * @param connection - The TestBench connection
 * @param projectManagementTreeDataProvider - The project management tree data provider
 * @param reportWithResultsZipFilePath - The full path of the report with results zip file
 */
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
                logger.warn("No connection available (readTestsAndCreateResultsAndImportToTestbench).");
                return;
            }

            if (!projectManagementTreeDataProvider || !projectManagementTreeDataProvider.currentProjectKeyInView) {
                vscode.window.showErrorMessage("No project selected. Please select a project first.");
                logger.warn("No project selected (readTestsAndCreateResultsAndImportToTestbench).");
                return;
            }

            progress.report({
                message: `Reading Test Results and Creating Report.`,
                increment: 25,
            });

            let createdReportWithResultsFullPath: string | null = await readTestResultsAndCreateReportWithResults(
                context,
                folderNameOfTestbenchWorkingDirectory,
                progress
            );
            if (!createdReportWithResultsFullPath) {
                logger.error("Error when reading test results and creating report with results.");
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

            const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(baseKey);
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
            logger.warn("No connection available (startTestGenerationProcessForCycle).");
            return;
        }

        const cycleKey: string | undefined = treeItem.item.key;
        if (!cycleKey) {
            logger.error("Cycle key is unidentified for test generation process.");
            throw new Error("Cycle key is unidentified for test generation process.");
        }

        const projectKeyOfCycle: string | undefined = projectManagementTreeView.findProjectKeyOfCycleElement(treeItem);
        if (!projectKeyOfCycle) {
            logger.error("Project key of cycle is unidentified for test generation process.");
            throw new Error("Project key of cycle is unidentified for test generation process.");
        }

        if (typeof treeItem.label !== "string") {
            logger.error("Invalid label type. Test generation aborted.");
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
        logger.error("Error in startTestGenerationProcessForCycle:", error.message);
        vscode.window.showErrorMessage(error.message);
    }
}

/**
 * Writes the testbench2robotframework configuration to a JSON file in workspace folder.
 * @param baseKey The base key of the extension
 * @param folderPathToStoreTb2robotConfig The folder path to store the configuration file
 * @returns {Promise<string | null>} The full path of the configuration file, or null if an error occurs
 */
export async function saveTestbench2RobotConfigurationAsJson(
    baseKey: string,
    folderPathToStoreTb2robotConfig: string
): Promise<string | null> {
    try {
        const config = vscode.workspace.getConfiguration(baseKey);
        const generationConfig = config.get<testBenchTypes.Testbench2robotframeworkConfiguration>(
            "testbench2robotframeworkConfig"
        );
        if (!generationConfig) {
            logger.error("Configuration object is missing.");
            return null;
        }

        const jsonContent: string = JSON.stringify(generationConfig, null, 2);
        const tb2robotConfigFilePath: string = getConfigurationFilePath(folderPathToStoreTb2robotConfig);

        // Write file, overwriting if it already exists
        await fsPromise.writeFile(tb2robotConfigFilePath, jsonContent, "utf8");
        logger.debug(`Tb2robot configuration file created or overwritten at: ${tb2robotConfigFilePath}`);

        return tb2robotConfigFilePath;
    } catch (error) {
        const errorMessage =
            error instanceof Error
                ? `Failed to write configuration file: ${error.message}`
                : "An unknown error occurred while writing the configuration file.";

        vscode.window.showErrorMessage(errorMessage);
        logger.error("Error inside saveTestbench2RobotConfigurationAsJson:", errorMessage);
        return null;
    }
}

/**
 * Get the full path of the testbench2robotframework configuration file.
 * @param folderPathToJsonConfig The folder path to store the configuration file
 * @returns {string} The full path of the configuration file
 */
function getConfigurationFilePath(folderPathToJsonConfig: string): string {
    const fileName: string = "testbench2robotframeworkConfig.json";
    const filePath: string = path.join(folderPathToJsonConfig, fileName);
    return filePath;
}

/**
 * Deletes the testbench2robotframework configuration file.
 * @param configFilePath The full path of the configuration file
 * @param maxRetries The maximum number of retries to delete the file
 * @param delay The delay in milliseconds between retries
 */
export async function deleteTb2RobotConfigurationFile(
    configFilePath: string,
    maxRetries: number = 5,
    delay: number = 500
): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Check if the file exists before attempting to delete
            await fsPromise.access(configFilePath);

            // Delete the file
            await fsPromise.unlink(configFilePath);
            logger.debug(`Configuration file deleted from: ${configFilePath}`);
            return;
        } catch (error: any) {
            if (error.code === "ENOENT") {
                vscode.window.showErrorMessage(`Configuration file not found: ${configFilePath}`);
                return;
            } else if (error.code === "EBUSY" && attempt < maxRetries) {
                logger.warn(`Attempt ${attempt} to delete file failed due to "EBUSY". Retrying in ${delay}ms...`);
                vscode.window.showErrorMessage(
                    `Failed to delete configuration file due to "EBUSY". Retrying in ${delay}ms...`
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            } else {
                vscode.window.showErrorMessage(
                    `Failed to delete configuration file after ${attempt} attempts: ${error.message}`
                );
                logger.error(`Error deleting file at ${configFilePath}:`, error);
                return;
            }
        }
    }
}
