import * as vscode from "vscode";
import * as fs from "fs";
import * as fsPromise from "fs/promises";
import * as path from "path";
import * as testBenchTypes from "./testBenchTypes";
import axios, { AxiosResponse } from "axios";
import * as projectManagementTreeView from "./projectManagementTreeView";
import * as testbench2robotframeworkLib from "./testbench2robotframeworkLib";
import { getConfig, connection, baseKeyOfExtension, lastGeneratedReportParams, logger } from "./extension";
import { importReportWithResultsToTestbench } from "./testBenchConnection";

/**
 * Prompt the user to select the export report method in quick pick format (Execution based or Specification based).
 * @returns {Promise<boolean | null>} - Resolves with the selected option (true for Execution based, false for Specification based) or null if the user cancels the selection.
 */
export async function promptForReportGenerationMethodAndCheckIfExecBasedChosen(): Promise<boolean | null> {
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
            logger.debug("Export method selection dialog closed by the user.");
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
    const isReportJobCompletedSuccessfully: boolean = !!jobStatus?.completion?.result?.ReportingSuccess?.reportName;

    logger.trace(`isReportJobCompletedSuccessfully resulted in ${isReportJobCompletedSuccessfully}`);
    return isReportJobCompletedSuccessfully;
}

/**
 * Checks if the import job has completed successfully.
 * @param {testBenchTypes.JobStatusResponse} jobStatus The job status response object
 * @returns {boolean} True if the import job has completed successfully, otherwise false
 */
export function isImportJobCompletedSuccessfully(jobStatus: testBenchTypes.JobStatusResponse): boolean {
    const isImportJobCompletedSuccessfully: boolean = !!jobStatus?.completion?.result?.ExecutionImportingSuccess;

    logger.trace(`isImportJobCompletedSuccessfully resulted in ${isImportJobCompletedSuccessfully}`);
    return isImportJobCompletedSuccessfully;
}

/**
 * Checks if the import job has failed.
 * @param {testBenchTypes.JobStatusResponse} jobStatus The job status response object
 * @returns {boolean} True if the import job has failed, otherwise false
 */
export function isImportJobFailed(jobStatus: testBenchTypes.JobStatusResponse): boolean {
    const isImportJobFailed: boolean = !!jobStatus?.completion?.result?.ExecutionImportingFailure;

    logger.trace(`isImportJobFailed resulted in ${isImportJobFailed}`);
    return isImportJobFailed;
}

/**
 * Fetch the TestBench JSON report (ZIP Archive) for the selected item from the server.
 * 3 Calls are needed to download the zip report:
 * 1. Get the job ID
 * 2. Get the job status of that job ID (Polling until the job is completed)
 * 3. Download the report zip file when the job is complete.
 *
 * @param projectKey The project key
 * @param cycleKey The cycle key
 * @param progress Progress bar to show the poll attempts to the user
 * @param folderNameToDownloadReport The folder name to save the downloaded report
 * @param requestParameters Optional request parameters (exec/spec based, root UID) for the job ID request
 * @param cancellationToken Cancellation token to be able to cancel the polling by clicking cancel button
 * @returns {Promise<string | null>} The path of the downloaded zip file if the download was successful, otherwise null
 */
export async function fetchReportZipFromServer(
    projectKey: string,
    cycleKey: string,
    folderNameToDownloadReport: string,
    requestParameters?: testBenchTypes.OptionalJobIDRequestParameter,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken?: vscode.CancellationToken
): Promise<string | null> {
    try {
        if (!connection) {
            logger.error("Connection object is missing, can't fetch report zip from server.");
            return null;
        }

        logger.debug(
            `Fetching report zip with projectKey: ${projectKey}, cycleKey: ${cycleKey}, folderNameToDownloadReport: ${folderNameToDownloadReport}.`
        );
        logger.trace(`Fetching report with optional request parameters:`, requestParameters);

        const jobId: string | null = await getJobId(projectKey, cycleKey, requestParameters);
        if (!jobId) {
            console.warn("Job ID not received from server.");
            return null;
        }
        logger.debug(`Job ID (${jobId}) fetched from server successfully.`);

        const jobStatus: testBenchTypes.JobStatusResponse | null = await pollJobStatus(
            projectKey,
            jobId,
            "report",
            progress,
            cancellationToken
        );

        if (!jobStatus || !isReportJobCompletedSuccessfully(jobStatus)) {
            const reportGenerationUnsuccesfullWarningMessage: string = "Report generation was unsuccessful.";
            logger.warn(reportGenerationUnsuccesfullWarningMessage);
            vscode.window.showErrorMessage(reportGenerationUnsuccesfullWarningMessage);
            return null;
        }

        const fileNameToDownload: string = jobStatus.completion.result.ReportingSuccess!.reportName;
        logger.debug(`Report name to download: ${fileNameToDownload}`);

        const pathOfDownloadedZipFile: string | null = await downloadReport(
            projectKey,
            fileNameToDownload,
            folderNameToDownloadReport
        );
        if (pathOfDownloadedZipFile) {
            logger.debug(`Report downloaded successfully to: ${pathOfDownloadedZipFile}`);
            return pathOfDownloadedZipFile;
        } else {
            logger.warn("Download canceled or failed.");
            return null;
        }
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            const operationCancelledMessage: string = "Fetch report operation cancelled by the user.";
            logger.debug(operationCancelledMessage);
            vscode.window.showInformationMessage(operationCancelledMessage);
            return null;
        } else {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return null;
            } else {
                logger.error(
                    `Error fetching the report with project key ${projectKey} and cycle key ${cycleKey}: ${error}`
                );
                return null;
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
    let attempt: number = 0; // Polling attempt counter
    let jobStatus: testBenchTypes.JobStatusResponse | null = null;
    let lastIncrement: number = 0;

    // Poll the job status until the job is completed with either success or failure
    while (true) {
        if (cancellationToken?.isCancellationRequested) {
            const jobStatusPollingCancelledMessage: string = "Job status polling operation cancelled by the user.";
            logger.debug(jobStatusPollingCancelledMessage);
            vscode.window.showInformationMessage(jobStatusPollingCancelledMessage);
            throw new vscode.CancellationError();
        }

        if (!connection) {
            logger.error("Connection object is missing, cannot proceed to poll job status.");
            return null;
        }

        attempt++;

        try {
            jobStatus = await getJobStatus(projectKey, jobId, jobType);
            if (!jobStatus) {
                logger.warn("Job status not received from server.");
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
                logger.debug(`Polling attempt ${attempt}: Job Status fetched. Progress: ${roundedProgressPercentage}%`);

                lastIncrement = roundedProgressPercentage;
            } else {
                logger.debug(`Polling attempt ${attempt}: Job Status fetched.`);
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
            logger.error(`Polling attempt ${attempt}: Failed to get job status.`, error);
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
 * @returns {Promise<string | null>} The job ID received from the server, otherwise null
 */
export async function getJobId(
    projectKey: string,
    cycleKey: string,
    requestParams?: testBenchTypes.OptionalJobIDRequestParameter // TODO: Execution mode is added in new branch, project tree is also changed? ExecutionImportingSuccess
): Promise<string | null> {
    if (!connection) {
        logger.error("Connection object is missing, cannot get the job ID from server.");
        return null;
    }

    const getJobIDUrl: string = `${connection.getBaseURL()}/projects/${projectKey}/cycles/${cycleKey}/report/v1`;

    logger.debug(
        `Sending request to fetch job ID with projectKey: ${projectKey}, cycleKey: ${cycleKey} to the URL ${getJobIDUrl}.`
    );

    const jobIdResponse: AxiosResponse<testBenchTypes.JobIdResponse> = await axios.post(getJobIDUrl, requestParams, {
        headers: {
            accept: "application/json",
            Authorization: connection.getSessionToken(), // Include session token for authorization
            "Content-Type": "application/json",
        },
    });

    logger.trace("jobIdResponse received from server:", jobIdResponse.data);

    if (jobIdResponse.status !== 200) {
        const jobIdFetchFailedMessage: string = `Failed to fetch job ID, status code: ${jobIdResponse.status}`;
        logger.error(jobIdFetchFailedMessage);
        return null;
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
        logger.error("Connection object is missing, cannot get job status from server.");
        return null;
    }

    const getJobStatusUrl: string = `${connection.getBaseURL()}/projects/${projectKey}/${jobType}/job/${jobId}/v1`;

    logger.debug(`Checking job status: ${getJobStatusUrl}`);

    const jobStatusResponse: AxiosResponse<testBenchTypes.JobStatusResponse> = await axios.get(getJobStatusUrl, {
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
 * @param projectKey The project key
 * @param fileNameToDownload The name of the report file to download
 * @param folderNameToDownloadReport The folder name to save the downloaded report
 * @returns {Promise<string | undefined>} The absolute path of the downloaded zip file if successful, otherwise undefined
 */
export async function downloadReport(
    projectKey: string,
    fileNameToDownload: string,
    folderNameToDownloadReport: string
): Promise<string | null> {
    try {
        // Ensure the connection object is available
        if (!connection) {
            logger.error("Connection object is missing, cannot download report from server.");
            return null;
        }

        // Construct the download URL
        const downloadReportUrl: string = `${connection.getBaseURL()}/projects/${projectKey}/report/${fileNameToDownload}/v1`;
        logger.debug(`Sending request to download report ${fileNameToDownload} from URL ${downloadReportUrl}.`);

        // Fetch the report from the server
        const downloadZipResponse: AxiosResponse<any> = await axios.get(downloadReportUrl, {
            responseType: "arraybuffer", // Expecting binary data
            headers: {
                accept: "application/vnd.testbench+json",
                Authorization: connection.getSessionToken(),
            },
        });

        // Check for successful response
        if (downloadZipResponse.status !== 200) {
            const downloadReportFailedMessage: string = `Failed to download report, status code: ${downloadZipResponse.status}`;
            logger.error(downloadReportFailedMessage);
            throw new Error(downloadReportFailedMessage);
        }

        // Get the workspace configuration
        const workspaceLocationInExtensionSettings: string | undefined = getConfig().get<string>("workspaceLocation");

        if (workspaceLocationInExtensionSettings && fs.existsSync(workspaceLocationInExtensionSettings)) {
            // Save report file to the specified workspace location and return the path of downloaded file
            return await storeReportFileLocally(
                workspaceLocationInExtensionSettings,
                folderNameToDownloadReport,
                fileNameToDownload,
                downloadZipResponse
            );
        } else if (workspaceLocationInExtensionSettings) {
            const workspaceLocationMissingErrorMessage: string = `The configured workspace location does not exist: ${workspaceLocationInExtensionSettings}`;
            logger.error(workspaceLocationMissingErrorMessage);
            vscode.window.showErrorMessage(workspaceLocationMissingErrorMessage);
        }

        // If workspace location is not valid or not set, prompt the user to choose a save location to store the report
        return await promptUserForSaveLocationAndSaveReportToFile(fileNameToDownload, downloadZipResponse);
    } catch (error) {
        const downloadReportErrorMessage: string = `Failed to download report: ${(error as Error).message}`;
        logger.error(downloadReportErrorMessage);
        vscode.window.showErrorMessage(downloadReportErrorMessage);
        return null;
    }
}

/**
 * Saves the report file to the specified location and returns the path of the saved file.
 * @param testbenchWorkspaceLocation The testbench workspace location to save the file
 * @param folderNameOfReport The folder name for saving the report file inside
 * @param fileNameOfReport The name of the file
 * @param downloadResponse The Axios response containing the file data
 * @returns {Promise<string | undefined>} The path of the saved file
 */
async function storeReportFileLocally(
    testbenchWorkspaceLocation: string,
    folderNameOfReport: string,
    fileNameOfReport: string,
    downloadResponse: AxiosResponse<any>
): Promise<string | null> {
    try {
        const filePathToSaveReport: string = path.join(
            testbenchWorkspaceLocation,
            folderNameOfReport,
            fileNameOfReport
        );
        const uri: vscode.Uri = vscode.Uri.file(filePathToSaveReport);

        // Write the file to the specified location
        await vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadResponse.data));
        logger.debug(`Report downloaded successfully to ${uri.fsPath}`);
        return uri.fsPath;
    } catch (error) {
        const saveReportToFileErrorMessage: string = `Failed to save report to file: ${(error as Error).message}`;
        logger.error(saveReportToFileErrorMessage);
        vscode.window.showErrorMessage(saveReportToFileErrorMessage);
        return null;
    }
}

/**
 * Prompts the user to choose a save location and store the file there.
 * @param fileNameOfReport The name of the file to save
 * @param downloadResponse The Axios response containing the file data
 * @returns {Promise<string | undefined>} The path of the saved file if successful, otherwise undefined
 */
async function promptUserForSaveLocationAndSaveReportToFile(
    fileNameOfReport: string,
    downloadResponse: AxiosResponse<any>
): Promise<string | null> {
    logger.debug("Prompting user to choose a save location for the report.");

    // Prompt the user to choose a save location
    const zipUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileNameOfReport),
        filters: { "Zip Files": ["zip"] },
    });

    // Return if the user cancels the dialog
    if (!zipUri) {
        logger.debug("User canceled the save report file dialog.");
        return null;
    }

    try {
        // Check if the file already exists
        let fileExists = false;

        try {
            await vscode.workspace.fs.stat(zipUri);
            fileExists = true;
        } catch (error) {
            // If the file does not exist, ignore; otherwise, rethrow
            if ((error as vscode.FileSystemError).code !== "FileNotFound") {
                logger.error(`Error checking if file exists: ${(error as Error).message}`);
                throw error;
            }
        }

        // If file exists, prompt for overwrite confirmation
        if (fileExists) {
            const overwriteOption = await vscode.window.showWarningMessage(
                `The file "${fileNameOfReport}" already exists. Do you want to overwrite it?`,
                { modal: true },
                "Overwrite",
                "Skip"
            );

            if (overwriteOption === "Skip") {
                const fileDownloadSkippedMessage: string = "File download skipped by the user.";
                vscode.window.showInformationMessage(fileDownloadSkippedMessage);
                logger.debug(fileDownloadSkippedMessage);
                return null;
            }
        }

        // Write the file to the chosen location
        await vscode.workspace.fs.writeFile(zipUri, new Uint8Array(downloadResponse.data));
        logger.debug(`Report downloaded successfully to ${zipUri.fsPath}`);
        return zipUri.fsPath;
    } catch (error) {
        const saveReportToFileErrorMessage: string = `Failed to save report to file: ${(error as Error).message}`;
        logger.error(saveReportToFileErrorMessage);
        vscode.window.showErrorMessage(saveReportToFileErrorMessage);
    }
    return null;
}

// Wait for a specified number of milliseconds.
export function delay(milliseconds: number): Promise<void> {
    logger.trace(`Waiting for ${milliseconds} milliseconds for Job completion.`);
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Fetches and downloads a report in ZIP format for a selected tree view element.
 * @param selectedProjectManagementTreeItem - The selected tree item in the project management tree.
 * @param projectManagementTreeViewOfExtension - The project management tree data provider.
 * @param workingDirectoryToStoreReport - The directory where the ZIP file should be downloaded.
 * @returns {Promise<void | null>} - Resolves when the report is successfully downloaded, otherwise null
 */
export async function fetchReportForTreeElement(
    selectedProjectManagementTreeItem: projectManagementTreeView.TestbenchTreeItem,
    projectManagementTreeViewOfExtension: projectManagementTreeView.ProjectManagementTreeDataProvider | null,
    workingDirectoryToStoreReport: string
): Promise<void | null> {
    // Show progress in VS Code
    logger.debug(`Fetch Report called for ${selectedProjectManagementTreeItem.label}.`);
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Fetching Report for ${selectedProjectManagementTreeItem.label}`,
            cancellable: true,
        },
        async (progress, cancellationToken) => {
            // Report initial progress
            progress?.report({ increment: 30, message: "Selecting report parameters." });
            logger.debug("Fetching report for the selected tree item:", selectedProjectManagementTreeItem);

            try {
                // Validate the connection
                if (!connection) {
                    const connectionMissingErrorMessage: string =
                        "No connection available, cannot fetch report. (callFetchReportForTreeElement)";
                    logger.warn(connectionMissingErrorMessage);
                    return null;
                }

                // Validate the project management tree view
                if (!projectManagementTreeViewOfExtension) {
                    const projectManagementTreeViewMissingErrorMessage: string =
                        "Project management tree is not initialized, cannot fetch report. (callFetchReportForTreeElement)";
                    logger.warn(projectManagementTreeViewMissingErrorMessage);
                    return null;
                }

                // Get the key of the current project that is displayed in the project managemement tree view
                const projectKeyOfProjectInView: string | null =
                    projectManagementTreeViewOfExtension.currentProjectKeyInView;
                if (!projectKeyOfProjectInView) {
                    const projectKeyMissingErrorMessage: string =
                        "No project selected, cannot fetch report. (callFetchReportForTreeElement)";
                    logger.warn(projectKeyMissingErrorMessage);
                    return null;
                }

                // Find the cycle key associated with the selected tree item to fetch the report
                const cycleKey: string | null = projectManagementTreeView.findCycleKeyOfTreeElement(
                    selectedProjectManagementTreeItem
                );
                if (!cycleKey) {
                    const cycleKeyMissingErrorMessage: string =
                        "Cycle key for the selected tree element not found, cannot fetch report. (callFetchReportForTreeElement)";
                    logger.warn(cycleKeyMissingErrorMessage);
                    return null;
                }

                // Get the unique ID of the tree element
                const treeElementUniqueID: string | undefined = selectedProjectManagementTreeItem.item?.base?.uniqueID;

                // Check if the report should be based on execution
                const executionBased: boolean = true; // await isExecutionBasedReportSelected();  // TODO: Using execution based for QS day by default.
                if (executionBased === null) {
                    logger.debug("Export method is not selected. Fetching report for the selected tree item.");
                    return null;
                }

                // Set up the request parameters
                // TODO: For QS Day, executionBased is used by default without asking the user.
                const cycleStructureOptionsRequestParameter: testBenchTypes.OptionalJobIDRequestParameter = {
                    basedOnExecution: executionBased,
                    treeRootUID: treeElementUniqueID,
                };

                logger.debug(
                    `Started fetching report with projectKey: ${projectKeyOfProjectInView}, cycleKey: ${cycleKey}, uniqueID: ${treeElementUniqueID}.`
                );

                // Report progress for fetching the report
                progress?.report({ increment: 30, message: "Fetching report." });

                // Fetch the ZIP file, handle potential cancellation
                const downloadedReportZipFilePath: string | null = await fetchReportZipFromServer(
                    projectKeyOfProjectInView,
                    cycleKey,
                    workingDirectoryToStoreReport,
                    cycleStructureOptionsRequestParameter
                );

                logger.debug(`Report successfully downloaded to: ${downloadedReportZipFilePath}.`);
            } catch (error) {
                // Handle errors and show an error message to the user
                vscode.window.showErrorMessage((error as Error).message);
                console.error("Error fetching report:", error);
                return null;
            }
        }
    );
}

/**
 * Generate robot framework test cases for the selected TestThemeNode or TestCaseSetNode item in the tree view.
 * @param context VS Code extension context
 * @param selectedTreeItem The selected tree item
 * @param folderNameOfTestbenchWorkingDirectory The folder name of the testbench working directory
 * @returns {Promise<void | null>} Resolves when the tests are generated successfully, otherwise null
 */
export async function generateRobotFrameworkTestsForTestThemeOrTestCaseSet(
    context: vscode.ExtensionContext,
    selectedTreeItem: projectManagementTreeView.TestbenchTreeItem,
    folderNameOfTestbenchWorkingDirectory: string
): Promise<void | null> {
    logger.trace("Generating tests for non cycle element:", selectedTreeItem);

    let treeElementUniqueID: string | undefined = selectedTreeItem.item?.base?.uniqueID;
    let cycleKey: string | null = projectManagementTreeView.findCycleKeyOfTreeElement(selectedTreeItem);
    let projectKey: string | null = projectManagementTreeView.findProjectKeyOfCycleElement(selectedTreeItem.parent!);

    if (!projectKey || !cycleKey || !treeElementUniqueID) {
        logger.error(
            `Project key (${projectKey}), cycle key (${cycleKey}) or unique ID (${treeElementUniqueID}) not found for the selected tree item.`
        );
        return null;
    }

    await generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
        context,
        selectedTreeItem,
        typeof selectedTreeItem.label === "string" ? selectedTreeItem.label : "", // Label might be undefined
        baseKeyOfExtension,
        projectKey,
        cycleKey,
        folderNameOfTestbenchWorkingDirectory,
        treeElementUniqueID
    );
}

/**
 * Generate Robot Framework test cases from the TestBench JSON report using testbench2robotframework library.
 * @param context - VS Code extension context
 * @param selectedTreeItem - The selected tree item
 * @param itemLabel - The label of the selected tree item
 * @param baseKey - The base key of the extension
 * @param projectKey - The project key
 * @param cycleKey - The cycle key
 * @param folderNameOfTestbenchWorkingDirectory - The path to save the downloaded report
 * @param UIDofTestThemeElementToGenerateTestsFor - (Optional) The unique ID of the clicked TestThemeNode element to generate tests for
 * @returns {Promise<void | null>} - Resolves when the tests are generated successfully, otherwise null
 */
export async function generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
    context: vscode.ExtensionContext,
    selectedTreeItem: projectManagementTreeView.TestbenchTreeItem,
    itemLabel: string,
    baseKey: string,
    projectKey: string,
    cycleKey: string,
    folderNameOfTestbenchWorkingDirectory: string,
    UIDofTestThemeElementToGenerateTestsFor?: string
): Promise<void | null> {
    try {
        const isReportGenerationExecutionBased: boolean = true; // await isExecutionBasedReportSelected();  // TODO: For QS day, use true for this value.
        if (isReportGenerationExecutionBased === null) {
            const testGenerationAbortedMessage: string = `Test generation method is invalid (${isReportGenerationExecutionBased}). Test generation aborted.`;
            vscode.window.showInformationMessage(testGenerationAbortedMessage);
            logger.debug(testGenerationAbortedMessage);
            return null;
        }

        // Prompt the user to select a TestThemeNode and get its UID if the unique ID is not provided already. Can be "Generate all" as well.
        const UIDofSelectedTreeElement: string | undefined =
            UIDofTestThemeElementToGenerateTestsFor ||
            (await promptForTestThemeNodeSelectionAndReturnUIDOfNode(selectedTreeItem));
        if (!UIDofSelectedTreeElement) {
            logger.error("Test theme selection was empty while generating tests.");
            return null;
        }

        // Set up the request parameters for the cycle report
        const cycleReportOptionsRequestParameter: testBenchTypes.OptionalJobIDRequestParameter = {
            basedOnExecution: isReportGenerationExecutionBased,
            // If the selected tree element is "Generate all", set the UID to empty string
            treeRootUID: UIDofSelectedTreeElement === "Generate all" ? "" : UIDofSelectedTreeElement,
        };

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Generating Tests for ${itemLabel}`,
                cancellable: true,
            },
            async (progress, cancellationToken) => {
                await runRobotFrameworkTestGenerationProcess(
                    context,
                    projectKey,
                    cycleKey,
                    isReportGenerationExecutionBased,
                    folderNameOfTestbenchWorkingDirectory,
                    UIDofSelectedTreeElement,
                    cycleReportOptionsRequestParameter,
                    progress,
                    cancellationToken
                );
            }
        );
    } catch (error: any) {
        if (error instanceof vscode.CancellationError) {
            const testGenerationCancelledByUserMessage: string = "Test generation process cancelled by the user.";
            logger.debug(testGenerationCancelledByUserMessage);
            vscode.window.showInformationMessage(testGenerationCancelledByUserMessage);
            return null;
        } else {
            logger.error("An error occurred:", error);
            vscode.window.showErrorMessage(`An error occurred: ${error.message || error}`);
            return null;
        }
    }
}

/**
 * Show a QuickPick for selecting a TestThemeNode.
 * @param treeItem - The tree item to search for TestThemeNodes
 * @returns {Promise<string | undefined>} The unique ID of the selected TestThemeNode or 'Generate all'
 */
async function promptForTestThemeNodeSelectionAndReturnUIDOfNode(treeItem: any): Promise<string | undefined> {
    const testThemeNodes: { name: string; uniqueID: string; numbering?: string }[] =
        findAllTestThemeNodesOfTreeItem(treeItem);

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
 * Find all TestThemeNode elements of the tree item recursively.
 * @param treeItem - The tree item to search
 * @param foundTestThemes - An array to collect the results
 * @returns An array of found TestThemeNodes
 */
function findAllTestThemeNodesOfTreeItem(
    treeItem: any,
    foundTestThemes: { name: string; uniqueID: string; numbering?: string }[] = []
): typeof foundTestThemes {
    // Check if the tree item is a TestThemeNode, and if so, add it to the results
    if (treeItem.item?.elementType === "TestThemeNode") {
        // Extract the name, unique ID, and numbering of the TestThemeNode
        const { name = "Unnamed", uniqueID = "No ID", numbering } = treeItem.item.base || {};
        foundTestThemes.push({ name, uniqueID, numbering });
    }

    // Recursively search for TestThemeNodes in the children of the tree item
    if (Array.isArray(treeItem.children)) {
        treeItem.children.forEach((child: projectManagementTreeView.TestbenchTreeItem) =>
            findAllTestThemeNodesOfTreeItem(child, foundTestThemes)
        );
    }

    return foundTestThemes;
}

/**
 * Run the test generation process with progress and cancellation support.
 * @param context - VS Code extension context
 * @param projectKey - The project key
 * @param cycleKey - The cycle key
 * @param folderNameOfTestbenchWorkingDirectory - The working directory path
 * @param UIDofSelectedElement - The unique ID of the selected element
 * @param cycleStructureOptionsRequestParameters - Request parameters for cycle structure
 * @param progress - VS Code progress reporter
 * @param cancellationToken - VS Code cancellation token
 * @returns {Promise<void | null>} Resolves when the test generation process is completed, otherwise null
 */
async function runRobotFrameworkTestGenerationProcess(
    context: vscode.ExtensionContext,
    projectKey: string,
    cycleKey: string,
    isReportGenerationExecutionBased: boolean,
    folderNameOfTestbenchWorkingDirectory: string,
    UIDofSelectedElement: string,
    cycleStructureOptionsRequestParameters: testBenchTypes.OptionalJobIDRequestParameter,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken: vscode.CancellationToken
): Promise<void | null> {
    progress.report({ increment: 30, message: "Fetching JSON Report from the server." });

    const downloadedReportZipFilePath: string | null = await fetchReportZipFromServer(
        projectKey,
        cycleKey,
        folderNameOfTestbenchWorkingDirectory, // The (.testbench) folder name we process files in
        cycleStructureOptionsRequestParameters,
        progress,
        cancellationToken
    );

    if (!downloadedReportZipFilePath) {
        logger.warn("Download cancelled or failed.");
        return null;
    }

    progress.report({ increment: 30, message: "Generating robot framework tests with testbench2robotframework." });

    // Workspace location is the folder we are working in, workingDirectoryPath is the (.testbench) folder path we process files in.
    const workspaceLocation: string = getConfig().get<string>("workspaceLocation")!;
    const testbenchWorkingDirectoryInsideWorkspace: string = path.join(
        workspaceLocation,
        folderNameOfTestbenchWorkingDirectory
    );

    const tb2robotConfigFilePath: string | null = await saveTestbench2RobotConfigurationAsJsonLocally(
        testbenchWorkingDirectoryInsideWorkspace
    );
    if (!tb2robotConfigFilePath) {
        logger.error("Failed to save configuration file.");
        return null;
    }

    const isTb2RobotframeworkWriteCommandSuccessful: boolean =
        await testbench2robotframeworkLib.tb2robotLib.startTb2robotframeworkWrite(
            context,
            testbenchWorkingDirectoryInsideWorkspace, // The command will be executed in this folder
            downloadedReportZipFilePath,
            tb2robotConfigFilePath
        );

    await cleanUpTb2robotConfigAndReportFiles(tb2robotConfigFilePath, downloadedReportZipFilePath);

    if (!isTb2RobotframeworkWriteCommandSuccessful) {
        const testGenerationFailedMessage: string =
            "Test generation failed. Please make sure that your tests can be automated.";
        logger.error(testGenerationFailedMessage);
        vscode.window.showErrorMessage(testGenerationFailedMessage);
        return null;
    }

    // If write command is successful, update the last generated report parameters to use in the next operations
    updateLastGeneratedReportParams(UIDofSelectedElement, projectKey, cycleKey, isReportGenerationExecutionBased);

    const testGenerationSuccessMessage: string = "Robotframework test generation is successful.";
    vscode.window.showInformationMessage(testGenerationSuccessMessage);
    logger.debug(testGenerationSuccessMessage);

    // Open the Testing view of VS Code after generating the tests to be able to run them directly in VS Code testing view.
    vscode.commands.executeCommand("workbench.view.extension.test");
}

/**
 * Update the parameters for the last generated report to use in the next operations.
 */
function updateLastGeneratedReportParams(
    UID: string,
    projectKey: string,
    cycleKey: string,
    executionBased: boolean
): void {
    logger.debug(
        `Updating the last generated report parameters with UID: ${UID}, projectKey: ${projectKey}, cycleKey: ${cycleKey}, executionBased: ${executionBased}.`
    );
    lastGeneratedReportParams.UID = UID;
    lastGeneratedReportParams.projectKey = projectKey;
    lastGeneratedReportParams.cycleKey = cycleKey;
    lastGeneratedReportParams.executionBased = executionBased;
}

/**
 * Clean up the testbench2robotframework configuration file after processing, and remove the report ZIP file if configured.
 * @param tb2robotConfigFilePath The path of the testbench2robotframework configuration file
 * @param reportZipFilePath The path of the report ZIP file
 */
async function cleanUpTb2robotConfigAndReportFiles(
    tb2robotConfigFilePath: string,
    reportZipFilePath: string
): Promise<void> {
    logger.debug("Cleaning up testbench2robotframework configuration and report files.");
    await deleteTb2RobotConfigurationFile(tb2robotConfigFilePath);

    // Only remove the report ZIP file if configured in extension settings
    if (getConfig().get<boolean>("clearReportAfterProcessing")) {
        await removeReportZipFile(reportZipFilePath);
    }
    logger.debug("Cleanup of testbench2robotframework config and report files are done.");
}

/**
 * Removes the specified zip file from the system if it exists and it is a valid zip file.
 * The function retries the operation in case the file is busy with small delays. Without the retries, the file might not be removed successfully.
 * @param zipFileFullPath The path of the zip file to be removed
 * @returns {Promise<void>} A promise that resolves when the file is removed successfully, or rejects with an error.
 */
export async function removeReportZipFile(
    zipFileFullPath: string,
    maxRetries: number = 5,
    delay: number = 500
): Promise<void> {
    logger.debug(`Removing report zip file: ${zipFileFullPath}`);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        logger.debug(`Attempt ${attempt} to delete file ${zipFileFullPath}.`);
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

// TODO: The extension settings is configured to accept an absolute folder path to serach for output.xml, maybe specify the absolute path of output.xml in the settings?
/**
 * Recursively searches for a file within a directory.
 * @param {string} directoryToSearchInside - The directory to search in.
 * @param {string} fileNametoSearch - The name of the file to search for.
 * @returns {string | null} The full path of the file if found, otherwise null.
 */
export async function findFileRecursivelyInDirectory(
    directoryToSearchInside: string,
    fileNametoSearch: string
): Promise<string | null> {
    try {
        logger.debug(`Searching for ${fileNametoSearch} in ${directoryToSearchInside} recursively`);

        // Read the contents of the directory
        // Retrieves a list of all file names present in the specified directory and stores them in the files array.
        const allFileNamesInsideDirectory: string[] = await fsPromise.readdir(directoryToSearchInside);

        for (const currentFileName of allFileNamesInsideDirectory) {
            // Construct the full absolute path of the current file
            const pathOfCurrentFile: string = path.join(directoryToSearchInside, currentFileName);
            const stat: fs.Stats = await fsPromise.stat(pathOfCurrentFile);

            // Recursively search in subdirectories
            if (stat.isDirectory()) {
                const searchResult: string | null = await findFileRecursivelyInDirectory(
                    pathOfCurrentFile,
                    fileNametoSearch
                );
                if (searchResult) {
                    return searchResult;
                }
            }
            // Check if the current file is not a folder and it is the file we are looking for
            else if (stat.isFile() && currentFileName === fileNametoSearch) {
                logger.debug(`File found recursively: ${pathOfCurrentFile}`);
                return pathOfCurrentFile;
            }
        }
    } catch (error) {
        logger.error(`Error searching for file: ${error instanceof Error ? error.message : String(error)}`);
    }
    logger.warn(`XML File ${fileNametoSearch} not found in ${directoryToSearchInside}`);
    return null;
}

/**
 * Opens a file selection dialog for the user to choose the output XML file.
 * Note: If multiple output XML files are present, the first one found will be returned.
 * If the wrong file is selected automatically, the upload process will fail. To avoid this, set the output XML path in the settings correctly
 * @param workingDirectoryPath The full (absolute) path of the working directory.
 * @returns {Promise<string | null>} The full (absolute) path of the selected output XML file, or undefined if no file is selected.
 */
async function chooseRobotOutputXMLFile(workingDirectoryPath: string): Promise<string | null> {
    logger.debug(`Choosing output XML file with working directory path ${workingDirectoryPath}.`);
    // Open file selection dialog to select the output xml file, display only XML files in the selection.
    let outputXMLFolderPathInExtensionSettings: string | undefined = getConfig().get<string>("outputXMLPath");
    if (!outputXMLFolderPathInExtensionSettings) {
        logger.warn("Output XML path is not configured in extension settings.");
    } else {
        const fileNameToSearchFor = "output.xml";
        logger.debug(`Searching for ${fileNameToSearchFor} in ${outputXMLFolderPathInExtensionSettings}`);
        const outputXmlFilePath: string | null = await findFileRecursivelyInDirectory(
            outputXMLFolderPathInExtensionSettings,
            fileNameToSearchFor
        );
        if (outputXmlFilePath) {
            return outputXmlFilePath;
        }
    }

    // Could not find any output XML in the search. Open file selection dialog
    const selectedFiles: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
        defaultUri: outputXMLFolderPathInExtensionSettings
            ? vscode.Uri.file(outputXMLFolderPathInExtensionSettings)
            : vscode.Uri.file(workingDirectoryPath),
        canSelectFiles: true,
        canSelectMany: false,
        title: "Select Output XML File",
        openLabel: "Select Output XML File",
        filters: { "XML Files": ["xml"] },
    });

    // Return the selected file path if a file was chosen
    if (selectedFiles && selectedFiles.length > 0) {
        logger.debug(`Found output XML file at location: ${selectedFiles[0].fsPath}`);
        return selectedFiles[0].fsPath;
    }
    logger.error(`No output XML file selected, returning null.`);
    return null;
}

/**
 * Opens a file selection dialog for the user to choose the report zip file that doesn't contain test results.
 * @param workingDirectoryPath The full path of the working directory.
 * @returns {Promise<string | null>} The full path of the selected report zip file, or null if no file is selected.
 */
async function chooseReportWithouResultsZipFile(workingDirectoryPath: string): Promise<string | null> {
    // Open file selection dialog, filtered for XML files
    const selectedFiles: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(workingDirectoryPath),
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
    return null;
}

/**
 * Reads robot framework test results and creates a report zip file with the results using testbench2robotframework library. Displays a progress bar using VS Code's progress API.
 * lastGeneratedReportParams must be initialized before calling this function, it is initialized in the test generation process.
 * @param context - The extension context.
 * @param folderNameOfTestbenchWorkingDirectory - The folder name of the testbench working directory (.testbench).
 * @param currentProgress - Optional existing progress instance to report updates.
 * @returns {Promise<string | null>} The full path of the created report with results zip, or null if an error occurs.
 */
export async function readTestResultsAndCreateReportWithResultsWithTb2Robot(
    context: vscode.ExtensionContext,
    folderNameOfTestbenchWorkingDirectory: string,
    currentProgress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string | null> {
    try {
        logger.debug("Started reading test results and creating report with results.");

        let pathOfReportWithResultsZip: string | null = null;

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

            const reportFileWithResultsZipName: string = `ReportWithResults_${Date.now()}.zip`; // Add a timestamp to the report name
            const workspaceLocationInExtensionSettings: string | undefined =
                getConfig().get<string>("workspaceLocation");
            if (!workspaceLocationInExtensionSettings) {
                const workspaceLocationNotConfiguredMessage: string = "Workspace location is not configured.";
                logger.error(workspaceLocationNotConfiguredMessage);
                throw new Error(workspaceLocationNotConfiguredMessage);
            }

            const testbenchWorkingDirectoryPath: string = path.join(
                workspaceLocationInExtensionSettings,
                folderNameOfTestbenchWorkingDirectory
            );

            const robotResultOutputXMLFilePath: string | null = await chooseRobotOutputXMLFile(
                workspaceLocationInExtensionSettings
            );
            if (!robotResultOutputXMLFilePath) {
                // Error logging is done in chooseRobotOutputXMLFile
                throw new Error("No XML file selected.");
            }

            logger.debug(`The report with result zip file will be named ${reportFileWithResultsZipName}`);

            reportProgress(`Fetching report.`, reportIncrement);

            // Check if the last generated report parameters are available
            if (
                !lastGeneratedReportParams.executionBased ||
                !lastGeneratedReportParams.projectKey ||
                !lastGeneratedReportParams.cycleKey ||
                !lastGeneratedReportParams.UID
            ) {
                const lastGeneratedReportParamsMissingMessage: string = "Last generated report parameters are missing.";
                logger.error(lastGeneratedReportParamsMissingMessage);
                throw new Error(lastGeneratedReportParamsMissingMessage);
            }

            const cycleStructureOptionsRequestParameter: testBenchTypes.OptionalJobIDRequestParameter = {
                basedOnExecution: lastGeneratedReportParams.executionBased,
                treeRootUID: lastGeneratedReportParams.UID,
            };

            const downloadedReportZipFilePath: string | null = await fetchReportZipFromServer(
                lastGeneratedReportParams.projectKey,
                lastGeneratedReportParams.cycleKey,
                folderNameOfTestbenchWorkingDirectory,
                cycleStructureOptionsRequestParameter
            );

            reportProgress(`Working on report.`, reportIncrement);

            // Either use the downloaded report zip file or prompt the user to select one
            const reportWithResultsZipFilePath: string | null =
                downloadedReportZipFilePath ?? (await chooseReportWithouResultsZipFile(testbenchWorkingDirectoryPath));
            if (!reportWithResultsZipFilePath) {
                throw new Error("No report file selected.");
            }

            logger.debug(`Report with results is saved to ${reportWithResultsZipFilePath}`);

            reportProgress(`Preparing configuration for testbench2robotframework.`, reportIncrement / 2);

            const tb2robotConfigFilePath: string | null = await saveTestbench2RobotConfigurationAsJsonLocally(
                testbenchWorkingDirectoryPath
            );
            if (!tb2robotConfigFilePath) {
                throw new Error("Failed to create configuration file.");
            }

            reportProgress(`Reading test results and creating report.`, reportIncrement / 2);

            pathOfReportWithResultsZip = path.join(testbenchWorkingDirectoryPath, reportFileWithResultsZipName);

            const isTb2RobotReadExecutionSuccessful: boolean =
                await testbench2robotframeworkLib.tb2robotLib.startTb2robotRead(
                    context,
                    testbenchWorkingDirectoryPath, // The command will be executed in this folder
                    robotResultOutputXMLFilePath,
                    reportWithResultsZipFilePath,
                    pathOfReportWithResultsZip,
                    tb2robotConfigFilePath
                );

            await cleanUpTb2robotConfigAndReportFiles(tb2robotConfigFilePath, reportWithResultsZipFilePath);

            if (!isTb2RobotReadExecutionSuccessful) {
                const importErrorMessage: string =
                    "Reading test results failed. Make sure you are using the correct output.xml file.";
                logger.error(importErrorMessage);
                vscode.window.showErrorMessage(importErrorMessage);
                return;
            }

            logger.debug(`tb2robot read executed successfully.`);

            // When reading results and importing are automated together in a function, this info message is not needed.
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

        return pathOfReportWithResultsZip;
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
): Promise<void | null> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Reading Test Results and Creating Report`,
            cancellable: true,
        },
        async (progress, cancellationToken) => {
            if (!connection) {
                const connectionErrorMessage: string =
                    "No connection available. Cannot read and import report to TestBench.";
                vscode.window.showErrorMessage(connectionErrorMessage);
                logger.warn(connectionErrorMessage);
                return null;
            }

            if (!projectManagementTreeDataProvider || !projectManagementTreeDataProvider.currentProjectKeyInView) {
                const projectKeyMissingMessage: string =
                    "Project key is missing. Cannot read and import report to TestBench.";
                vscode.window.showErrorMessage(projectKeyMissingMessage);
                logger.warn(projectKeyMissingMessage);
                return null;
            }

            progress.report({
                message: `Reading Test Results and Creating Report.`,
                increment: 25,
            });

            let pathOfCreatedReportWithResults: string | null =
                await readTestResultsAndCreateReportWithResultsWithTb2Robot(
                    context,
                    folderNameOfTestbenchWorkingDirectory,
                    progress
                );
            if (!pathOfCreatedReportWithResults) {
                logger.error("Error when reading test results and creating report with results.");
                return null;
            }

            progress.report({
                message: `Importing report with results to TestBench.`,
                increment: 25,
            });

            await importReportWithResultsToTestbench(
                connection,
                projectManagementTreeDataProvider,
                pathOfCreatedReportWithResults
            );

            progress.report({
                message: `Cleaning up.`,
                increment: 25,
            });

            if (getConfig().get<boolean>("clearReportAfterProcessing")) {
                // Remove the report zip file after usage
                await removeReportZipFile(pathOfCreatedReportWithResults);
            }
        }
    );
}

/**
 * Entry point for the Robot Framework test generation process from the TestBench JSON report.
 * @param context The VS Code extension context
 * @param selectedTestCycleTreeItem The selected cycle tree item
 * @param baseKey The base key of the extension
 * @param folderNameOfTestbenchWorkingDirectory The path to save the downloaded report
 */
export async function startTestGenerationForCycle(
    context: vscode.ExtensionContext,
    selectedTestCycleTreeItem: projectManagementTreeView.TestbenchTreeItem,
    baseKey: string,
    folderNameOfTestbenchWorkingDirectory: string
): Promise<void | null> {
    try {
        if (!connection) {
            const connectionErrorMessage: string = "No connection available. Cannot generate tests for cycle.";
            vscode.window.showErrorMessage(connectionErrorMessage);
            logger.warn(connectionErrorMessage);
            return null;
        }

        const cycleKey: string | undefined = selectedTestCycleTreeItem.item.key;
        if (!cycleKey) {
            const cycleKeyMissingMessage: string = "Cycle key is missing for test generation process.";
            logger.error(cycleKeyMissingMessage);
            return null;
        }

        const projectKeyOfCycle: string | null =
            projectManagementTreeView.findProjectKeyOfCycleElement(selectedTestCycleTreeItem);
        if (!projectKeyOfCycle) {
            const projectKeyMissingMessage: string = "Project key of cycle is missing for test generation process.";
            logger.error(projectKeyMissingMessage);
            return null;
        }

        if (typeof selectedTestCycleTreeItem.label !== "string") {
            const invalidLabelTypeMessage: string = "Invalid label type. Test generation aborted.";
            logger.error(invalidLabelTypeMessage);
            return null;
        }

        // Start the test generation process
        await generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
            context,
            selectedTestCycleTreeItem,
            selectedTestCycleTreeItem.label,
            baseKey,
            projectKeyOfCycle,
            cycleKey,
            folderNameOfTestbenchWorkingDirectory,
            undefined // UIDofTestThemeElementToGenerateTestsFor is undefined for a test cycle
        );
    } catch (error: any) {
        logger.error("Error in startTestGenerationForCycle:", error.message);
        vscode.window.showErrorMessage(error.message);
    }
}

/**
 * Writes the testbench2robotframework configuration to a JSON file in workspace folder.
 * @param folderPathToStoreTb2robotConfig The folder path to store the configuration file
 * @returns {Promise<string | null>} The full path of the configuration file, or null if an error occurs
 */
export async function saveTestbench2RobotConfigurationAsJsonLocally(
    folderPathToStoreTb2robotConfig: string
): Promise<string | null> {
    try {
        const generationConfig = getConfig().get<testBenchTypes.Testbench2robotframeworkConfiguration>(
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
        logger.trace(`Tb2robot configuration file content:`, jsonContent);

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
 * Deletes the testbench2robotframework configuration file. Retries the operation in case the file is busy with small delays.
 * @param configFilePath The full path of the configuration file
 * @param maxRetries The maximum number of retries to delete the file
 * @param delay The delay in milliseconds between retries
 */
export async function deleteTb2RobotConfigurationFile(
    configFilePath: string,
    maxRetries: number = 5,
    delay: number = 500
): Promise<void> {
    logger.debug(`Deleting testbench2robotframework configuration file at: ${configFilePath}`);
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
