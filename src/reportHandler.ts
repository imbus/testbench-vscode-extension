/**
 * @file reportHandler.ts
 * @description Contains functions to fetch, process, and import TestBench reports,
 * generate Robot Framework tests, and clean up temporary files.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as fsPromise from "fs/promises";
import * as path from "path";
import * as os from "os";
import axios, { AxiosResponse } from "axios";
import * as testBenchTypes from "./testBenchTypes";
import * as projectManagementTreeView from "./projectManagementTreeView";
import * as testbench2robotframeworkLib from "./testbench2robotframeworkLib";
import * as utils from "./utils";
import {
    getConfig,
    connection,
    logger,
    getProjectManagementTreeDataProvider,
    getTestThemeTreeDataProvider
} from "./extension";
import {
    ConfigKeys,
    StorageKeys,
    JobTypes,
    TreeItemContextValues,
    folderNameOfInternalTestbenchFolder
} from "./constants";
import { importReportWithResultsToTestbench } from "./testBenchConnection";

/**
 * Prompts the user to select the report export method in quick pick format (Execution based or Specification based).
 * @returns {Promise<boolean | null>} A promise resolving to true for "Execution based", false for "Specification based",
 * or null if the user cancels.
 */
export async function promptForReportGenerationMethodAndCheckIfExecBasedChosen(): Promise<boolean | null> {
    return new Promise((resolve) => {
        const quickPick = vscode.window.createQuickPick();
        quickPick.items = [{ label: "Execution based" }, { label: "Specification based" }, { label: "Cancel" }];
        quickPick.title = "Select Export Option";
        quickPick.placeholder = "Select the export option for the reports.";

        // Handle the user selection
        quickPick.onDidChangeSelection((selection) => {
            if (selection[0]) {
                if (selection[0].label === "Cancel") {
                    logger.debug("User canceled the export method selection.");
                    resolve(null);
                } else {
                    logger.debug(`Export method selected: ${selection[0].label}`);
                    resolve(selection[0].label === "Execution based");
                }
                quickPick.hide(); // Close the quick pick after selection
            }
        });

        // Handle case when the quick pick is hidden without user selection (e.g., if user clicks away)
        quickPick.onDidHide(() => {
            logger.debug("Export method selection dialog closed by the user.");
            resolve(null);
            quickPick.dispose(); // Clean up resources after closing
        });

        quickPick.show();
    });
}

/**
 * Saves the last generated report parameters to workspace storage.
 *
 * @param {vscode.ExtensionContext} context The extension context providing access to workspaceState.
 * @param {string} UID The unique ID of the root element used for generation.
 * @param {string} projectKey The project key used.
 * @param {string} cycleKey The cycle key used.
 * @param {boolean} executionBased Whether the report was execution-based.
 */
async function saveLastGeneratedReportParams(
    context: vscode.ExtensionContext, // Added context parameter
    UID: string,
    projectKey: string,
    cycleKey: string,
    executionBased: boolean
): Promise<void> {
    // Construct the object to save
    const paramsToSave: testBenchTypes.LastGeneratedReportParams = {
        UID,
        projectKey,
        cycleKey,
        executionBased,
        // Timestamp for context or potential cleanup
        timestamp: Date.now()
    };

    try {
        // Data stored here persists across VS Code sessions for this specific workspace
        await context.workspaceState.update(StorageKeys.LAST_GENERATED_PARAMS, paramsToSave);
        logger.debug(
            `Saved last generated report params to workspace state: UID=${UID}, projectKey=${projectKey}, cycleKey=${cycleKey}, executionBased=${executionBased}.`
        );
    } catch (error) {
        logger.error("Failed to save last generated report params to workspace state:", error);
        // Optionally show an error message, though this is less critical than retrieval failure
        // vscode.window.showErrorMessage("Failed to save report generation context.");
    }
}

/**
 * Retrieves the last generated report parameters from workspace storage.
 *
 * @param {vscode.ExtensionContext} context The extension context providing access to workspaceState.
 * @returns {testBenchTypes.LastGeneratedReportParams | undefined} The retrieved parameters or undefined if not found/invalid.
 */
function getLastGeneratedReportParams(
    context: vscode.ExtensionContext // Added context parameter
): testBenchTypes.LastGeneratedReportParams | undefined {
    try {
        // Retrieve the data from workspaceState using the key
        const storedParams: testBenchTypes.LastGeneratedReportParams | undefined =
            context.workspaceState.get<testBenchTypes.LastGeneratedReportParams>(StorageKeys.LAST_GENERATED_PARAMS);

        // Basic validation to ensure the retrieved object looks correct
        if (
            storedParams &&
            storedParams.UID &&
            storedParams.projectKey &&
            storedParams.cycleKey &&
            storedParams.executionBased !== undefined
        ) {
            logger.debug("Retrieved last generated report params from workspace state:", storedParams);
            return storedParams;
        } else {
            logger.warn("No valid last generated report params found in workspace state.");
            return undefined;
        }
    } catch (error) {
        logger.error("Failed to retrieve last generated report params from workspace state:", error);
        return undefined;
    }
}

/**
 * Checks if the report job has completed successfully.
 * @param jobStatus The job status response object.
 * @returns {boolean} True if the job completed successfully; otherwise false.
 */
export function isReportJobCompletedSuccessfully(jobStatus: testBenchTypes.JobStatusResponse): boolean {
    const success = !!jobStatus?.completion?.result?.ReportingSuccess?.reportName;
    logger.trace(`isReportJobCompletedSuccessfully: ${success}`);
    return success;
}

/**
 * Checks if the import job has completed successfully.
 * @param jobStatus The job status response object.
 * @returns {boolean} True if the import job completed successfully; otherwise false.
 */
export function isImportJobCompletedSuccessfully(jobStatus: testBenchTypes.JobStatusResponse): boolean {
    const success = !!jobStatus?.completion?.result?.ExecutionImportingSuccess;
    logger.trace(`isImportJobCompletedSuccessfully: ${success}`);
    return success;
}

/**
 * Checks if the import job has failed.
 * @param jobStatus The job status response object.
 * @returns {boolean} True if the import job failed; otherwise false.
 */
export function isImportJobFailed(jobStatus: testBenchTypes.JobStatusResponse): boolean {
    const failed = !!jobStatus?.completion?.result?.ExecutionImportingFailure;
    logger.trace(`isImportJobFailed: ${failed}`);
    return failed;
}

/**
 * Polls the server for the status of a report or import job until the job is completed successfully or failed.
 *
 * @param {string} projectKey The project key.
 * @param {string} jobId The job ID received from the server.
 * @param {"report" | "import"} jobType The type of job ("report" or "import").
 * @param {vscode.Progress} progress Optional progress reporter.
 * @param {vscode.CancellationToken} cancellationToken Optional cancellation token.
 * @param {number} maxPollingTimeMs Optional maximum polling time in milliseconds.
 * @returns {Promise<testBenchTypes.JobStatusResponse | null>} The job status response if completed successfully; otherwise null.
 */
export async function pollJobStatus(
    projectKey: string,
    jobId: string,
    jobType: "report" | "import",
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken?: vscode.CancellationToken,
    maxPollingTimeMs?: number // Optional timeout, disabled by default so that the user can cancel manually
): Promise<testBenchTypes.JobStatusResponse | null> {
    const startTime = Date.now(); // Start time for the polling to adjust the polling interval after 10 seconds
    let pollingAttemptAmount: number = 0;
    let jobStatus: testBenchTypes.JobStatusResponse | null = null;
    let lastProgressIncrement: number = 0;

    // Poll the job status until the job is completed with either success or failure.
    while (true) {
        if (cancellationToken?.isCancellationRequested) {
            const cancellationMsg = "Job status polling cancelled by the user.";
            logger.debug(cancellationMsg);
            vscode.window.showInformationMessage(cancellationMsg);
            throw new vscode.CancellationError();
        }
        if (!connection) {
            logger.error("Connection object is missing, cannot poll job status.");
            return null;
        }
        pollingAttemptAmount++;

        try {
            jobStatus = await getJobStatus(projectKey, jobId, jobType);
            if (!jobStatus) {
                logger.error("Job status not received from server.");
                return null;
            }

            // Display the job status progress in the progressbar text if counts are available
            const totalItems = jobStatus?.progress?.totalItemsCount;
            const handledItems = jobStatus?.progress?.handledItemsCount;
            if (totalItems && handledItems) {
                const percentage = Math.round((handledItems / totalItems) * 100);
                progress?.report({
                    message: `Fetching job status (${handledItems}/${totalItems}).`,
                    increment: (percentage - lastProgressIncrement) / 3
                });
                logger.debug(`Polling attempt ${pollingAttemptAmount}: Progress ${percentage}%`);
                lastProgressIncrement = percentage;
            } else {
                logger.debug(`Polling attempt ${pollingAttemptAmount}: Job status fetched.`);
            }

            if (jobType === JobTypes.REPORT && isReportJobCompletedSuccessfully(jobStatus)) {
                logger.debug("Report job completed successfully.");
                return jobStatus;
            } else if (jobType === JobTypes.IMPORT) {
                if (isImportJobCompletedSuccessfully(jobStatus)) {
                    logger.debug("Import job completed successfully.");
                    return jobStatus;
                } else if (isImportJobFailed(jobStatus)) {
                    return null;
                }
            }
        } catch (error) {
            logger.error(`Polling attempt ${pollingAttemptAmount}: Failed to get job status.`, error);
        }

        // (Optional) Check if the maximum polling time has been exceeded.
        if (maxPollingTimeMs !== undefined && Date.now() - startTime >= maxPollingTimeMs) {
            logger.warn("Maximum polling time exceeded. Aborting job status polling.");
            break;
        }

        // Adjust polling interval based on elapsed time.
        // For the first 10 seconds, poll every 200 ms, then poll every 1 second.
        const elapsedTime: number = Date.now() - startTime;
        const delayMs: number = elapsedTime < 10000 ? 200 : 1000;
        await utils.delay(delayMs);
    }

    logger.trace("Final job status:", jobStatus);
    return jobStatus;
}

/**
 * Retrieves the job ID from the server for a report or import job.
 *
 * @param {string} projectKey The project key.
 * @param {string} cycleKey The cycle key.
 * @param {testBenchTypes.OptionalJobIDRequestParameter} requestParams Optional request parameters.
 * @returns {Promise<string | null>} The job ID as a string or null if not found.
 */
export async function getJobId(
    projectKey: string,
    cycleKey: string,
    requestParams?: testBenchTypes.OptionalJobIDRequestParameter // TODO: Execution mode is added in new branch, project tree is also changed? ExecutionImportingSuccess
): Promise<string | null> {
    if (!connection) {
        logger.error("Connection object is missing, cannot get job ID.");
        return null;
    }

    const getJobIDUrl: string = `${connection.getBaseURL()}/projects/${projectKey}/cycles/${cycleKey}/report/v1`;
    logger.debug(`Fetching job ID from URL: ${getJobIDUrl}`);
    try {
        const jobIdResponse: AxiosResponse<testBenchTypes.JobIdResponse> = await axios.post(
            getJobIDUrl,
            requestParams,
            {
                headers: {
                    accept: "application/json",
                    Authorization: connection.getSessionToken(),
                    "Content-Type": "application/json"
                }
            }
        );
        logger.trace("Job ID response:", jobIdResponse.data);
        if (jobIdResponse.status !== 200) {
            logger.error(`Failed to fetch job ID, status code: ${jobIdResponse.status}`);
            return null;
        }
        return jobIdResponse.data.jobID;
    } catch (error) {
        logger.error("Error fetching job ID:", error);
        return null;
    }
}

/**
 * Retrieves the job status from the server.
 *
 * @param {string} projectKey The project key.
 * @param {string} jobId The job ID.
 * @param {string} jobType The type of job
 * @returns {Promise<testBenchTypes.JobStatusResponse | null>} The job status response object, or throws an error if not successful.
 */
export async function getJobStatus(
    projectKey: string,
    jobId: string,
    jobType: string
): Promise<testBenchTypes.JobStatusResponse | null> {
    if (!connection) {
        logger.error("Connection object is missing, cannot get job status.");
        return null;
    }
    const getJobStatusUrl: string = `${connection.getBaseURL()}/projects/${projectKey}/${jobType}/job/${jobId}/v1`;
    logger.debug(`Checking job status at: ${getJobStatusUrl}`);
    const jobStatusResponse: AxiosResponse<testBenchTypes.JobStatusResponse> = await axios.get(getJobStatusUrl, {
        headers: {
            accept: "application/vnd.testbench+json",
            Authorization: connection.getSessionToken()
        }
    });
    logger.trace("Job status response:", jobStatusResponse.data);
    if (jobStatusResponse.status !== 200) {
        logger.error(`Failed to fetch job status, status code: ${jobStatusResponse.status}`);
        throw new Error(`Failed to fetch job status, status code: ${jobStatusResponse.status}`);
    }
    return jobStatusResponse.data;
}

/**
 * Downloads the report zip file from the server and returns the path of the downloaded file.
 * This function performs the following steps:
 * 1. Validates the connection to the server.
 * 2. Constructs the download URL using the project key and file name.
 * 3. Sends a GET request to download the report as a binary file.
 * 4. Validates the workspace location and saves the file locally.
 * 5. If the workspace location is invalid, prompts the user to select a save location.
 *
 * @param {string} projectKey The project key.
 * @param {string} fileNameToDownload The name of the report file.
 * @param {string} folderNameToDownloadReport The folder name where the report will be saved.
 * @returns {Promise<string | null>} The absolute path of the downloaded file if successful, otherwise null.
 * @throws {Error} If the download fails or the server returns a non-200 status code.
 */
export async function downloadReport(
    projectKey: string,
    fileNameToDownload: string,
    folderNameToDownloadReport: string
): Promise<string | null> {
    try {
        if (!connection) {
            const missingConnectionError: string = "Connection object is missing, cannot download report.";
            logger.error(missingConnectionError);
            vscode.window.showErrorMessage(missingConnectionError);
            return null;
        }
        const downloadReportUrl: string = `${connection.getBaseURL()}/projects/${projectKey}/report/${fileNameToDownload}/v1`;
        logger.debug(`Downloading report "${fileNameToDownload}" from URL: ${downloadReportUrl}`);

        const downloadZipResponse: AxiosResponse<any> = await axios.get(downloadReportUrl, {
            responseType: "arraybuffer", // Expecting binary data
            headers: {
                accept: "application/vnd.testbench+json",
                Authorization: connection.getSessionToken()
            }
        });

        if (downloadZipResponse.status !== 200) {
            const downloadReportErrorMessage: string = `Failed to download report, status code: ${downloadZipResponse.status}`;
            logger.error(downloadReportErrorMessage);
            throw new Error(downloadReportErrorMessage);
        }

        const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation || !fs.existsSync(workspaceLocation)) {
            const invalidWorkspaceLocationError: string = `Workspace location is not valid: ${workspaceLocation}`;
            logger.error(invalidWorkspaceLocationError);
            return await promptUserForSaveLocationAndSaveReportToFile(fileNameToDownload, downloadZipResponse);
        }
        return await storeReportFileLocally(
            workspaceLocation,
            folderNameToDownloadReport,
            fileNameToDownload,
            downloadZipResponse
        );
    } catch (error) {
        const downloadReportErrorMessage: string = `Failed to download report: ${(error as Error).message}`;
        logger.error(downloadReportErrorMessage);
        vscode.window.showErrorMessage(downloadReportErrorMessage);
        return null;
    }
}

/**
 * Saves the downloaded report file locally.
 *
 * @param {string} workspaceLocation The workspace location.
 * @param {string} folderNameOfReport The folder name for saving the report.
 * @param {string} fileNameOfReport The name of the report file.
 * @param {AxiosResponse<any>} downloadResponse The Axios response containing the file data.
 * @returns {Promise<string | null>} The absolute file path if successful, otherwise null.
 */
async function storeReportFileLocally(
    workspaceLocation: string,
    folderNameOfReport: string,
    fileNameOfReport: string,
    downloadResponse: AxiosResponse<any>
): Promise<string | null> {
    try {
        const filePath: string = path.join(workspaceLocation, folderNameOfReport, fileNameOfReport);
        const uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadResponse.data));
        logger.debug(`Report saved to ${uri.fsPath}`);
        return uri.fsPath;
    } catch (error) {
        const failedReportSaveMessage: string = `Failed to save report file: ${(error as Error).message}`;
        logger.error(failedReportSaveMessage);
        vscode.window.showErrorMessage(failedReportSaveMessage);
        return null;
    }
}

/**
 * Prompts the user to select a save location and stores the report file.
 *
 * @param {string} fileNameOfReport The name of the report file.
 * @param {AxiosResponse<any>} downloadResponse The Axios response containing the file data.
 * @returns The absolute file path if successful, otherwise null.
 */
async function promptUserForSaveLocationAndSaveReportToFile(
    fileNameOfReport: string,
    downloadResponse: AxiosResponse<any>
): Promise<string | null> {
    logger.debug("Prompting user to select a save location for the report file.");
    const zipUri: vscode.Uri | undefined = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileNameOfReport),
        filters: { "Zip Files": ["zip"] },
        title: "Select a location to save the report file"
    });
    if (!zipUri) {
        logger.debug("User cancelled save location selection.");
        return null;
    }
    try {
        let fileExists: boolean = false;
        try {
            await vscode.workspace.fs.stat(zipUri);
            fileExists = true;
        } catch (error) {
            // If the file does not exist, ignore; otherwise, rethrow
            if ((error as vscode.FileSystemError).code !== "FileNotFound") {
                logger.error(`Error checking file existence: ${(error as Error).message}`);
                throw error;
            }
        }

        // If file exists, prompt for overwrite confirmation
        if (fileExists) {
            const overwrite = await vscode.window.showWarningMessage(
                `The file "${fileNameOfReport}" already exists. Overwrite?`,
                { modal: true },
                "Overwrite",
                "Skip"
            );
            if (overwrite === "Skip") {
                const skipDownloadMsg: string = "File download skipped by the user.";
                vscode.window.showInformationMessage(skipDownloadMsg);
                logger.debug(skipDownloadMsg);
                return null;
            }
        }

        // Write the file to the chosen location
        await vscode.workspace.fs.writeFile(zipUri, new Uint8Array(downloadResponse.data));
        logger.debug(`Report saved to ${zipUri.fsPath}`);
        return zipUri.fsPath;
    } catch (error) {
        const failedReportSaveMessage: string = `Failed to save report: ${(error as Error).message}`;
        logger.error(failedReportSaveMessage);
        vscode.window.showErrorMessage(failedReportSaveMessage);
        return null;
    }
}

/* =============================================================================
   Report & Test Generation Functions
   ============================================================================= */

/**
 * Fetch the TestBench JSON report as ZIP Archive for the selected tree item from the server.
 * This function performs three steps:
 *   1. Retrieves a job ID using getJobId.
 *   2. Polls the job status until the job is completed (using pollJobStatus).
 *   3. Downloads the report zip file (using downloadReport).
 *
 * @param {string} projectKey The project key.
 * @param {string} cycleKey The cycle key.
 * @param {string} folderNameToDownloadReport The folder name where the report should be saved.
 * @param {testBenchTypes.OptionalJobIDRequestParameter} requestParameters Optional request parameters (e.g. execution-based, tree root UID).
 * @param {vscode.Progress} progress Optional VS Code progress reporter.
 * @param {vscode.CancellationToken} cancellationToken Optional cancellation token.
 * @returns {Promise<string | null>} A promise that resolves with the absolute path of the downloaded zip file or null if unsuccessful.
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
            logger.error("Connection object is missing, cannot fetch report.");
            return null;
        }

        logger.debug(
            `Fetching report zip for projectKey: ${projectKey}, cycleKey: ${cycleKey}, folder: ${folderNameToDownloadReport}.`
        );
        logger.trace("Request parameters:", requestParameters);

        // Step 1: Get Job ID
        const jobId: string | null = await getJobId(projectKey, cycleKey, requestParameters);
        if (!jobId) {
            logger.error("Job ID not received from server.");
            return null;
        }
        logger.debug(`Job ID received: ${jobId}`);

        // Step 2: Poll Job Status
        const jobStatus: testBenchTypes.JobStatusResponse | null = await pollJobStatus(
            projectKey,
            jobId,
            JobTypes.REPORT,
            progress,
            cancellationToken
        );
        if (!jobStatus || !isReportJobCompletedSuccessfully(jobStatus)) {
            const reportGenerationErrorMsg: string = "Report generation was unsuccessful.";
            logger.error(reportGenerationErrorMsg);
            vscode.window.showErrorMessage(reportGenerationErrorMsg);
            return null;
        }
        const reportName: string = jobStatus.completion.result.ReportingSuccess!.reportName;
        logger.debug(`Report name to download: ${reportName}`);

        // Step 3: Download the report ZIP file
        const downloadedFilePath: string | null = await downloadReport(
            projectKey,
            reportName,
            folderNameToDownloadReport
        );
        if (downloadedFilePath) {
            logger.debug(`Report downloaded successfully to: ${downloadedFilePath}`);
            return downloadedFilePath;
        } else {
            logger.warn("Report download failed or was canceled.");
            return null;
        }
    } catch (error) {
        logger.error("Error in fetchReportZipFromServer:", error);
        return null;
    }
}

/**
 * Fetches the report zip for a selected tree element.
 *
 * @param selectedProjectTreeItem The selected tree item.
 * @param projectManagementTreeDataProvider The project management tree data provider.
 * @param workingDirectoryToStoreReport The directory where the report will be stored.
 * @returns {Promise<void | null>} Resolves when the report is successfully downloaded, otherwise null
 */
export async function fetchReportForTreeElement(
    selectedProjectTreeItem: projectManagementTreeView.BaseTestBenchTreeItem,
    projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null,
    workingDirectoryToStoreReport: string
): Promise<void | null> {
    logger.debug(`Fetch Report called for ${selectedProjectTreeItem.label}.`);
    // Show progress bar in VS Code
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Fetching Report for ${selectedProjectTreeItem.label}`,
            cancellable: true
        },
        async (progress) => {
            progress.report({ increment: 30, message: "Selecting report parameters." });
            logger.debug("Fetching report for tree item:", selectedProjectTreeItem);

            try {
                if (!connection) {
                    logger.error("No connection available, cannot fetch report.");
                    return null;
                }
                if (!projectManagementTreeDataProvider) {
                    logger.error("Project management tree not initialized, cannot fetch report.");
                    return null;
                }

                const projectKeyOfSelectedTreeItem: string | null =
                    findProjectKeyOfProjectTreeItem(selectedProjectTreeItem);
                if (!projectKeyOfSelectedTreeItem) {
                    logger.error("Project key not found, cannot fetch report.");
                    return null;
                }

                // Find the cycle key associated with the selected tree item to fetch the report
                const cycleKey: string | null =
                    projectManagementTreeView.findCycleKeyOfTreeElement(selectedProjectTreeItem);
                if (!cycleKey) {
                    logger.error("Cycle key not found, cannot fetch report.");
                    return null;
                }
                const treeElementUID = selectedProjectTreeItem.item?.base?.uniqueID;
                const executionBased: boolean = true; // For now, defaulting to execution based
                const cycleStructureOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter = {
                    basedOnExecution: executionBased,
                    treeRootUID: treeElementUID
                };

                progress.report({ increment: 30, message: "Fetching report." });
                const downloadedReportZipFilePath: string | null = await fetchReportZipFromServer(
                    projectKeyOfSelectedTreeItem,
                    cycleKey,
                    workingDirectoryToStoreReport,
                    cycleStructureOptionsRequestParams
                );
                if (downloadedReportZipFilePath) {
                    logger.debug(`Report downloaded to: ${downloadedReportZipFilePath}`);
                } else {
                    logger.warn("Download cancelled or failed.");
                    return null;
                }
            } catch (error) {
                vscode.window.showErrorMessage((error as Error).message);
                logger.error("Error fetching report:", error);
                return null;
            }
        }
    );
}

/**
 * Generates Robot Framework test cases for a selected TestThemeNode or TestCaseSetNode.
 *
 * @param {vscode.ExtensionContext} context The VS Code extension context.
 * @param {projectManagementTreeView.BaseTestBenchTreeItem} selectedTreeItem The selected tree item.
 * @returns {Promise<void | null>} Resolves when test generation is complete, or null if errors occur.
 */
export async function generateRobotFrameworkTestsForTestThemeOrTestCaseSet(
    context: vscode.ExtensionContext,
    selectedTreeItem: projectManagementTreeView.BaseTestBenchTreeItem,
    providedCycleKey?: string
): Promise<void | null> {
    logger.debug("Generating tests for non-cycle element:", selectedTreeItem);
    const treeElementUID = selectedTreeItem.item?.base?.uniqueID;
    let cycleKey: string | null = providedCycleKey || null;
    let projectKey: string | null = null;

    if (!cycleKey) {
        // If cycleKey wasn't provided by the caller
        // attempt to find it by traversing parent.
        logger.warn(`CycleKey not provided for ${selectedTreeItem.label}, attempting to find via parent traversal.`);
        cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(selectedTreeItem);
    }

    if (!cycleKey) {
        logger.error(
            `generateRobotFrameworkTestsForTestThemeOrTestCaseSet: Cycle key not found for item ${selectedTreeItem.label}.`
        );
        vscode.window.showErrorMessage(`Error: Cycle key could not be determined for '${selectedTreeItem.label}'.`);
        return null;
    }

    const pmProvider = getProjectManagementTreeDataProvider();
    if (pmProvider) {
        const ttProvider = getTestThemeTreeDataProvider();
        if (ttProvider && ttProvider["_currentCycleKey"] === cycleKey && ttProvider["_currentProjectKey"]) {
            projectKey = ttProvider["_currentProjectKey"];
        }
    }

    if (!projectKey) {
        // Fallback: Try to find it via selectedTreeItem if it has enough context
        projectKey = projectManagementTreeView.findProjectKeyForElement(selectedTreeItem);
    }

    if (!projectKey) {
        logger.error(
            `generateRobotFrameworkTestsForTestThemeOrTestCaseSet: Project key not found for cycle ${cycleKey}.`
        );
        vscode.window.showErrorMessage(`Error: Project key could not be determined for the current cycle.`);
        return null;
    }

    if (!treeElementUID) {
        logger.error(`Cannot generate RF Tests. Missing UID for item ${selectedTreeItem.label}.`);
        return null;
    }

    await generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
        context,
        selectedTreeItem,
        typeof selectedTreeItem.label === "string" ? selectedTreeItem.label : "",
        projectKey,
        cycleKey,
        treeElementUID
    );
}

/**
 * Generates Robot Framework tests using testbench2robotframework library.
 *
 * @param {vscode.ExtensionContext} context The VS Code extension context.
 * @param {projectManagementTreeView.BaseTestBenchTreeItem} selectedTreeItem The selected tree item.
 * @param {string} itemLabel The label of the selected item.
 * @param {string} projectKey The project key.
 * @param {string} cycleKey The cycle key.
 * @param {string} UIDofTestThemeElementToGenerateTestsFor Optional unique ID for the test theme element.
 * @returns {Promise<void | null>} Resolves when tests are generated, or null if an error occurs.
 */
export async function generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
    context: vscode.ExtensionContext,
    selectedTreeItem: projectManagementTreeView.BaseTestBenchTreeItem,
    itemLabel: string,
    projectKey: string,
    cycleKey: string,
    UIDofTestThemeElementToGenerateTestsFor?: string
): Promise<void | null> {
    try {
        logger.debug("Generating tests for:", selectedTreeItem);
        const isReportGenerationExecutionBased: boolean = true; // Defaulting to execution based for now.
        const UIDofSelectedTreeElement: string | undefined =
            UIDofTestThemeElementToGenerateTestsFor ||
            (await promptForTestThemeNodeSelectionAndReturnUIDOfNode(selectedTreeItem));
        if (!UIDofSelectedTreeElement) {
            logger.error("No UID selected for test theme.");
            return null;
        }
        const cycleReportOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter = {
            basedOnExecution: isReportGenerationExecutionBased,
            treeRootUID: UIDofSelectedTreeElement === "Generate all" ? "" : UIDofSelectedTreeElement
        };

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Generating Tests for ${itemLabel}`,
                cancellable: true
            },
            async (progress, cancellationToken) =>
                runRobotFrameworkTestGenerationProcess(
                    context,
                    projectKey,
                    cycleKey,
                    isReportGenerationExecutionBased,
                    UIDofSelectedTreeElement,
                    cycleReportOptionsRequestParams,
                    progress,
                    cancellationToken
                )
        );
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            logger.debug("Test generation cancelled by the user.");
            vscode.window.showInformationMessage("Test generation cancelled by the user.");
            return null;
        } else {
            logger.error("Error during test generation:", error);
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : error}`);
            return null;
        }
    }
}

/**
 * Prompts the user to select a TestThemeNode and returns its UID.
 *
 * @param treeItem The tree item to search for TestThemeNodes.
 * @returns {Promise<string | undefined>} The UID of the selected node, or "Generate all" if selected.
 */
async function promptForTestThemeNodeSelectionAndReturnUIDOfNode(treeItem: any): Promise<string | undefined> {
    const testThemeNodes: { name: string; uniqueID: string; numbering?: string }[] =
        findAllTestThemeNodesOfTreeItem(treeItem);
    const quickPickItems = [
        { label: "Generate all", description: "Generate All Tests Under The Test Cycle" },
        ...testThemeNodes.map((node) => ({
            label: node.numbering ? `${node.numbering} ${node.name}` : node.name,
            description: `ID: ${node.uniqueID}`,
            uniqueID: node.uniqueID
        }))
    ];
    const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: 'Select a test theme or "Generate all" to generate all tests under the cycle.'
    });
    return selected?.label === "Generate all" ? "Generate all" : (selected as any)?.uniqueID;
}

/**
 * Recursively finds all TestThemeNode elements from a tree item.
 *
 * @param treeItem The tree item to search.
 * @param foundTestThemes Array to accumulate found nodes.
 * @returns An array of objects containing name, uniqueID, and optional numbering.
 */
function findAllTestThemeNodesOfTreeItem(
    treeItem: any,
    foundTestThemes: { name: string; uniqueID: string; numbering?: string }[] = []
): typeof foundTestThemes {
    // Check if the tree item is a TestThemeNode, and if so, add it to the results
    if (treeItem.item?.elementType === TreeItemContextValues.TEST_THEME_NODE) {
        // Extract the name, unique ID, and numbering of the TestThemeNode
        const { name = "Unnamed", uniqueID = "No ID", numbering } = treeItem.item.base || {};
        foundTestThemes.push({ name, uniqueID, numbering });
    }
    // Recursively search for TestThemeNodes in the children of the tree item
    if (Array.isArray(treeItem.children)) {
        treeItem.children.forEach((child: projectManagementTreeView.BaseTestBenchTreeItem) =>
            findAllTestThemeNodesOfTreeItem(child, foundTestThemes)
        );
    }
    return foundTestThemes;
}

/**
 * Runs the Robot Framework test generation process with progress reporting.
 *
 * @param {vscode.ExtensionContext} context The VS Code extension context.
 * @param {string} projectKey The project key.
 * @param {string} cycleKey The cycle key.
 * @param {boolean} executionBased Whether the report is execution-based.
 * @param {string} UID The UID of the selected element.
 * @param {testBenchTypes.OptionalJobIDRequestParameter} cycleStructureOptionsRequestParams Request parameters for the cycle report.
 * @param {vscode.Progress} progress The VS Code progress reporter.
 * @param {vscode.CancellationToken} cancellationToken The cancellation token.
 * @returns {Promise<void | null>} Resolves when the process completes, or null if errors occur.
 */
async function runRobotFrameworkTestGenerationProcess(
    context: vscode.ExtensionContext,
    projectKey: string,
    cycleKey: string,
    executionBased: boolean,
    UID: string,
    cycleStructureOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken: vscode.CancellationToken
): Promise<void | null> {
    progress.report({ increment: 30, message: "Fetching JSON Report from the server." });
    const downloadedZip: string | null = await fetchReportZipFromServer(
        projectKey,
        cycleKey,
        folderNameOfInternalTestbenchFolder,
        cycleStructureOptionsRequestParams,
        progress,
        cancellationToken
    );
    if (!downloadedZip) {
        logger.warn("Download cancelled or failed.");
        return null;
    }

    progress.report({ increment: 30, message: "Generating tests via testbench2robotframework." });
    const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
    if (!workspaceLocation) {
        const workspaceLocationMissingErrorMessage: string = "Workspace location not configured.";
        logger.error(workspaceLocationMissingErrorMessage);
        vscode.window.showErrorMessage(workspaceLocationMissingErrorMessage);
        return null;
    }

    const isTb2RobotframeworkGenerateTestsCommandSuccessful: boolean =
        await testbench2robotframeworkLib.tb2robotLib.startTb2robotframeworkTestGeneration(downloadedZip);
    await cleanUpReportFileIfConfiguredInSettings(downloadedZip);
    if (!isTb2RobotframeworkGenerateTestsCommandSuccessful) {
        const testGenerationFailedMessage: string = "Test generation failed.";
        logger.error(testGenerationFailedMessage);
        vscode.window.showErrorMessage(testGenerationFailedMessage);
        return null;
    }

    // Update the last generated report parameters workspaceState
    await saveLastGeneratedReportParams(context, UID, projectKey, cycleKey, executionBased);

    vscode.window.showInformationMessage("Robot Framework test generation successful.");
    logger.debug("Test generation successful.");
    await vscode.commands.executeCommand("workbench.view.extension.test");
    return;
}

/**
 * Removes the report zip file if configured in the extension settings.
 *
 * @param {string} reportZipFilePath The path of the report zip file.
 */
export async function cleanUpReportFileIfConfiguredInSettings(reportZipFilePath: string): Promise<void> {
    if (getConfig().get<boolean>(ConfigKeys.CLEAR_REPORT_AFTER_PROCESSING)) {
        await removeReportZipFile(reportZipFilePath);
    } else {
        logger.debug("Report ZIP file removal skipped per the extension settings.");
    }
}

/**
 * Removes the specified zip file with retry logic.
 *
 * @param {string} zipFileFullPath The full path of the zip file.
 * @param {number} maxRetries Maximum number of retries.
 * @param {number} delayMs Delay between retries in milliseconds.
 * @returns {Promise<void>} A promise that resolves when the file is removed successfully, or rejects with an error.
 */
export async function removeReportZipFile(
    zipFileFullPath: string,
    maxRetries: number = 5,
    delayMs: number = 500
): Promise<void> {
    logger.debug(`Removing report zip file: ${zipFileFullPath}`);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        logger.debug(`Attempt ${attempt} to delete ${zipFileFullPath}`);
        try {
            // Check if the file exists
            await fsPromise.access(zipFileFullPath);
            // Validate that the file is a zip file
            if (path.extname(zipFileFullPath) !== ".zip") {
                throw new Error(`Invalid file type: ${path.extname(zipFileFullPath)}. Only zip files can be removed.`);
            }
            // Remove the file
            await fsPromise.unlink(zipFileFullPath);
            logger.debug(`Zip file removed: ${zipFileFullPath}`);
            return;
        } catch (error: any) {
            if (error.code === "ENOENT") {
                const fileNotFoundMsg: string = `File not found: ${zipFileFullPath}`;
                logger.error(fileNotFoundMsg);
                vscode.window.showWarningMessage(fileNotFoundMsg);
                return;
            } else if (error.code === "EBUSY" && attempt < maxRetries) {
                logger.warn(`Attempt ${attempt} failed due to EBUSY. Retrying in ${delayMs}ms...`);
                await utils.delay(delayMs);
            } else {
                logger.error(`Error removing file ${zipFileFullPath}:`, error);
                vscode.window.showErrorMessage(`Error removing file: ${(error as Error).message}`);
                return;
            }
        }
    }
}

/* =============================================================================
   File & Path Helper Functions
   ============================================================================= */

/**
 * Recursively searches for a file within a directory.
 *
 * @param {string} directoryToSearchInside The directory to search.
 * @param {string} fileNameToSearch The file name to search for.
 * @returns {string | null} The full path of the file if found, otherwise null.
 */
export async function findFileRecursivelyInDirectory(
    directoryToSearchInside: string,
    fileNameToSearch: string
): Promise<string | null> {
    try {
        logger.debug(`Searching for "${fileNameToSearch}" in "${directoryToSearchInside}" recursively.`);
        const allFileNamesInsideDirectory: string[] = await fsPromise.readdir(directoryToSearchInside);
        for (const currentFileName of allFileNamesInsideDirectory) {
            const pathOfCurrentFile: string = path.join(directoryToSearchInside, currentFileName);
            const stat = await fsPromise.stat(pathOfCurrentFile);
            if (stat.isDirectory()) {
                const foundSearchResult: string | null = await findFileRecursivelyInDirectory(
                    pathOfCurrentFile,
                    fileNameToSearch
                );
                if (foundSearchResult) {
                    return foundSearchResult;
                }
            }
            // Check if the current file is not a folder and it is the file we are looking for
            else if (stat.isFile() && currentFileName === fileNameToSearch) {
                logger.debug(`File found: ${pathOfCurrentFile}`);
                return pathOfCurrentFile;
            }
        }
    } catch (error) {
        logger.error(`Error searching for file: ${error instanceof Error ? error.message : String(error)}`);
    }
    logger.warn(`File "${fileNameToSearch}" not found in "${directoryToSearchInside}"`);
    return null;
}

/**
 * Prompts the user to select the Robot Framework output XML file if not set in settings.
 * The default URI for the file selection dialog is determined in the following order of precedence:
 * the first workspace folder (if available), the path specified in the extension settings (if valid),
 * the provided workingDirectoryPath, and finally the user's home directory as the fallback.
 *
 * @param {string} workingDirectoryPath The working directory path.
 * @returns {Promise<string | null>} The absolute path of the selected output XML file, or null if none selected.
 */
async function chooseRobotOutputXMLFileIfNotSet(workingDirectoryPath: string): Promise<string | null> {
    logger.debug(`Choosing output XML file using working directory: ${workingDirectoryPath}`);

    // Open file selection dialog to select the output xml file, display only XML files in the selection.
    // To use relative paths to workspace location in extension settings,
    // get the workspace location to construct the full path of outputXmlFilePath.
    const outputXMLFileRelativePathInExtensionSettings: string | undefined =
        getConfig().get<string>("outputXmlFilePath");
    const outputXMLFileAbsolutePath: string | null = await utils.constructAbsolutePathFromRelativePath(
        outputXMLFileRelativePathInExtensionSettings,
        true
    );
    if (outputXMLFileAbsolutePath) {
        return outputXMLFileAbsolutePath;
    }
    logger.trace("Prompting user to select output XML file manually.");
    // Get the first workspace folder path, if available
    const firstWorkspaceFolderPath: string | undefined = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // Determine which path to use as the default URI for the file selection dialog
    const defaultUri: vscode.Uri = firstWorkspaceFolderPath
        ? vscode.Uri.file(firstWorkspaceFolderPath) // Try using the first workspace folder first
        : workingDirectoryPath
          ? vscode.Uri.file(workingDirectoryPath) // Fall back to the working directory
          : vscode.Uri.file(os.homedir()); // Final fallback to the user's home directory if none of the above are available
    logger.trace(`Default URI for XML selection: ${defaultUri.fsPath}`);

    // Output XML was not set in the extension settings. Open file selection dialog.
    const selectedXMLFileUri: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
        defaultUri: defaultUri,
        canSelectFiles: true,
        canSelectMany: false,
        title: "Select Output XML File",
        openLabel: "Select Output XML File",
        filters: { "XML Files": ["xml"] }
    });
    // Return the selected file path if a file was chosen
    if (selectedXMLFileUri && selectedXMLFileUri.length > 0) {
        logger.debug(`Output XML file selected: ${selectedXMLFileUri[0].fsPath}`);
        return selectedXMLFileUri[0].fsPath;
    }
    const xmlFileNotSelectedError: string = "No output XML file selected.";
    logger.error(xmlFileNotSelectedError);
    vscode.window.showErrorMessage(xmlFileNotSelectedError);
    return null;
}

/**
 * Prompts the user to select a report zip file (without test results).
 *
 * @param {string} workingDirectoryPath The working directory.
 * @returns {Promise<string | null>} The absolute path of the selected zip file, or null if none selected.
 */
async function chooseReportWithoutResultsZipFile(workingDirectoryPath: string): Promise<string | null> {
    const selectedFiles = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(workingDirectoryPath),
        title: "Select Report Zip File",
        openLabel: "Select Report Zip File",
        canSelectFiles: true,
        canSelectMany: false,
        filters: { "Zip Files": ["zip"] }
    });
    if (selectedFiles && selectedFiles.length > 0) {
        return selectedFiles[0].fsPath;
    }
    logger.error("No report zip file selected for the results zip file.");
    return null;
}

/* =============================================================================
   Test Results & Import Functions
   ============================================================================= */

/**
 * Reads test results using testbench2robotframework library and creates a report zip file.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {vscode.Progress} currentProgress Optional progress reporter.
 * @returns {Promise<string | undefined>} The absolute path of the created report zip file, or undefined on error.
 * Undefined is returned (and not null) due to the usage of VSCode progress bar.
 */
export async function fetchTestResultsAndCreateReportWithResultsWithTb2Robot(
    context: vscode.ExtensionContext,
    currentProgress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string | undefined> {
    try {
        logger.debug("Started fetching test results and creating report with results.");

        const executeWithProgress = async (
            progress: vscode.Progress<{ message?: string; increment?: number }>
        ): Promise<string | undefined> => {
            const reportIncrement: number = currentProgress ? 6 : 20;
            const reportProgress = (msg: string, inc: number) => progress.report({ message: msg, increment: inc });

            reportProgress("Choosing result XML file.", reportIncrement);
            // Add a timestamp to the report zip file name
            const reportWithResultsZipName: string = `ReportWithResults_${Date.now()}.zip`;
            const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
            if (!workspaceLocation) {
                logger.error("Workspace location not configured.");
                return undefined;
            }
            const testbenchWorkingDirectoryPathInsideWorkspace: string = path.join(
                workspaceLocation,
                folderNameOfInternalTestbenchFolder
            );
            const outputXMLPath: string | null = await chooseRobotOutputXMLFileIfNotSet(workspaceLocation);
            if (!outputXMLPath) {
                return undefined;
            }
            logger.debug(`Report zip file will be named ${reportWithResultsZipName}`);
            reportProgress("Fetching report.", reportIncrement);

            // TODO: Currently we are using the last generated report parameters to create the report with results,
            // these are used to fetch the report without results from the server.
            // Later we can make this process independent of the last generated report parameters.
            // Retrieve parameters from workspace state instead of global variable
            const retrievedParams: testBenchTypes.LastGeneratedReportParams | undefined =
                getLastGeneratedReportParams(context);

            if (!retrievedParams) {
                const missingParamsError: string =
                    "Could not find parameters from previous test generation. Please generate tests first in this workspace.";
                logger.error(missingParamsError);
                vscode.window.showErrorMessage(missingParamsError);
                return undefined; // Stop the process
            }
            const { executionBased, projectKey, cycleKey, UID } = retrievedParams;

            // Double check retrieved parameters validity (already done inside getLastGeneratedReportParams)
            if (!executionBased || !projectKey || !cycleKey || !UID) {
                const invalidParamsError: string = "Retrieved parameters from previous test generation are invalid.";
                logger.error(invalidParamsError);
                vscode.window.showErrorMessage(invalidParamsError);
                return undefined;
            }

            const cycleStructureOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter = {
                basedOnExecution: executionBased,
                treeRootUID: UID
            };

            const downloadedReportWithoutResultsZip: string | null = await fetchReportZipFromServer(
                projectKey,
                cycleKey,
                folderNameOfInternalTestbenchFolder,
                cycleStructureOptionsRequestParams
            );

            // If fetching the report failed, we need the user to select it manually
            const finalReportPath: string | null =
                downloadedReportWithoutResultsZip ??
                (await chooseReportWithoutResultsZipFile(testbenchWorkingDirectoryPathInsideWorkspace));

            if (!finalReportPath) {
                logger.error("Report without results could not be obtained.");
                vscode.window.showErrorMessage("Could not obtain the necessary report file (without results).");
                return undefined;
            }

            reportProgress("Working on report.", reportIncrement / 2);
            const reportWithResultsZipFullPath: string = path.join(
                testbenchWorkingDirectoryPathInsideWorkspace,
                reportWithResultsZipName
            );
            const isTb2RobotFetchResultsExecutionSuccessful: boolean =
                await testbench2robotframeworkLib.tb2robotLib.startTb2robotFetchResults(
                    outputXMLPath,
                    finalReportPath,
                    reportWithResultsZipFullPath
                );

            // Clean up the downloaded report after it has been used
            if (downloadedReportWithoutResultsZip) {
                await cleanUpReportFileIfConfiguredInSettings(downloadedReportWithoutResultsZip);
            }

            if (!isTb2RobotFetchResultsExecutionSuccessful) {
                const testResultsImportError: string =
                    "Fetching test results failed. Please check the output.xml file.";
                logger.error(testResultsImportError);
                vscode.window.showErrorMessage(testResultsImportError);
                return undefined;
            }
            const successMessage: string = `Report with results created at: ${reportWithResultsZipFullPath}`;
            logger.debug(successMessage);
            // Since the created report file might be deleted after the import to TestBench, dont display a message
            // vscode.window.showInformationMessage(successMessage);
            return reportWithResultsZipFullPath;
        };

        if (currentProgress) {
            return await executeWithProgress(currentProgress);
        } else {
            return await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Reading Test Results and Creating Report",
                    cancellable: true
                },
                executeWithProgress
            );
        }
    } catch (error) {
        const fetchResultsErrorMessage: string = `An error occurred while fetching test results: ${(error as Error).message}`;
        vscode.window.showErrorMessage(fetchResultsErrorMessage);
        logger.error(`An error occurred while fetching test results: ${(error as Error).message}`);
        return undefined;
    }
}

/**
 * Reads test results, creates a report zip with test results, and imports it to the TestBench server.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function fetchTestResultsAndCreateResultsAndImportToTestbench(
    context: vscode.ExtensionContext
): Promise<void | null> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Reading Test Results and Creating Report",
            cancellable: true
        },
        async (progress) => {
            progress.report({ message: "Reading Test Results and Creating Report.", increment: 25 });

            // Get the parameters needed for import
            const retrievedParams: testBenchTypes.LastGeneratedReportParams | undefined =
                getLastGeneratedReportParams(context);
            if (!retrievedParams || !retrievedParams.projectKey || !retrievedParams.cycleKey) {
                logger.error("Missing or invalid last generated params needed for import.");
                vscode.window.showErrorMessage(
                    "Cannot import results: context information missing. Please generate tests first."
                );
                return null;
            }
            const { projectKey, cycleKey } = retrievedParams;

            const pathOfCreatedReportWithResults: string | undefined =
                await fetchTestResultsAndCreateReportWithResultsWithTb2Robot(context, progress);
            if (!pathOfCreatedReportWithResults) {
                logger.error("Error creating report with results.");
                return null;
            }
            progress.report({ message: "Importing report to TestBench.", increment: 25 });
            await importReportWithResultsToTestbench(connection!, projectKey, cycleKey, pathOfCreatedReportWithResults);
            progress.report({ message: "Cleaning up.", increment: 25 });
            await cleanUpReportFileIfConfiguredInSettings(pathOfCreatedReportWithResults);
        }
    );
}

/**
 * Starts robotframework test generation for a cycle element.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {projectManagementTreeView.BaseTestBenchTreeItem} selectedCycleTreeItem The selected cycle tree item.
 */
export async function startTestGenerationForCycle(
    context: vscode.ExtensionContext,
    selectedCycleTreeItem: projectManagementTreeView.BaseTestBenchTreeItem
): Promise<void | null> {
    try {
        if (!connection) {
            const connectionErrorMessage: string = "No connection available. Cannot generate tests for cycle.";
            vscode.window.showErrorMessage(connectionErrorMessage);
            logger.error(connectionErrorMessage);
            return null;
        }
        const cycleKey = selectedCycleTreeItem.item.key;
        if (!cycleKey) {
            const cycleKeyMissingMessage: string = "Cycle key is missing for test generation.";
            logger.error(cycleKeyMissingMessage);
            return null;
        }
        const projectKey: string | null = projectManagementTreeView.findProjectKeyOfCycleElement(selectedCycleTreeItem);
        if (!projectKey) {
            const projectKeyMissingMessage = "Project key of cycle is missing.";
            logger.error(projectKeyMissingMessage);
            return null;
        }
        if (typeof selectedCycleTreeItem.label !== "string") {
            const invalidLabelTypeMessage: string = "Invalid label type. Test generation aborted.";
            logger.error(invalidLabelTypeMessage);
            return null;
        }
        const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return null;
        }
        await generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
            context,
            selectedCycleTreeItem,
            selectedCycleTreeItem.label,
            projectKey,
            cycleKey,
            undefined // UIDofTestThemeElementToGenerateTestsFor is undefined for a test cycle
        );
    } catch (error) {
        logger.error("Error in startTestGenerationForCycle:", (error as Error).message);
        vscode.window.showErrorMessage((error as Error).message);
    }
}

/* =============================================================================
   File Deletion & Cleanup Functions
   ============================================================================= */

/**
 * Deletes the testbench2robotframework configuration file.
 * Retries the operation in case the file is busy with small delays.
 *
 * @param {string} configFilePath The full path of the configuration file.
 * @param {number} maxRetries Maximum number of retries.
 * @param {number} delayMs Delay between retries in milliseconds.
 */
export async function deleteTb2RobotConfigurationFile(
    configFilePath: string,
    maxRetries: number = 5,
    delayMs: number = 500
): Promise<void> {
    logger.debug(`Deleting configuration file at: ${configFilePath}`);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Check if the file exists before attempting to delete
            await fsPromise.access(configFilePath);
            await fsPromise.unlink(configFilePath);
            logger.debug(`Configuration file deleted from: ${configFilePath}`);
            return;
        } catch (error: any) {
            if (error.code === "ENOENT") {
                vscode.window.showErrorMessage(`Configuration file not found: ${configFilePath}`);
                return;
            } else if (error.code === "EBUSY" && attempt < maxRetries) {
                logger.warn(`Attempt ${attempt} failed due to EBUSY. Retrying in ${delayMs}ms...`);
                vscode.window.showErrorMessage(`Failed to delete file due to EBUSY. Retrying in ${delayMs}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
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

/**
 * Displays a Quick Pick menu with multi-select options including control items "Select All" and "Clear All".
 * All regular items are pre-selected by default.
 *
 * @param {string[]} regularItemLabels - An array of strings representing the labels for the regular items.
 * @param {string} placeholder - (Optional) The placeholder text for the quick pick menu.
 * @returns {Promise<string[]>} A promise that resolves with an array of selected regular item labels, or an empty array if cancelled or an error occurs.
 */
export async function showMultiSelectQuickPick(
    regularItemLabels: string[],
    placeholder: string = "Select items (use Select All/Clear All)"
): Promise<string[]> {
    return new Promise<string[]>((resolve) => {
        let quickPick: vscode.QuickPick<vscode.QuickPickItem> | undefined;
        let isResolved: boolean = false; // Flag to prevent double resolution/disposal

        try {
            quickPick = vscode.window.createQuickPick();
            quickPick.canSelectMany = true;
            quickPick.placeholder = placeholder;
            quickPick.ignoreFocusOut = true; // Optional: keep open if focus moves

            // Select All and Clear All buttons that will be displayed above the regular items
            // These are not selectable items, but control items to select/deselect all
            const selectAllLabel: string = "$(check-all) Select All";
            const clearAllLabel: string = "$(clear-all) Clear All";

            // Create QuickPickItem objects for regular items
            const regularItems: vscode.QuickPickItem[] = regularItemLabels.map((label) => ({ label }));

            // Create QuickPickItem objects for control items
            const selectAllItem: vscode.QuickPickItem = { label: selectAllLabel, alwaysShow: true };
            const clearAllItem: vscode.QuickPickItem = { label: clearAllLabel, alwaysShow: true };

            // Separator for visual grouping (optional but recommended)
            const separator: vscode.QuickPickItem = {
                label: "Actions",
                kind: vscode.QuickPickItemKind.Separator
            };

            // Set the items in the Quick Pick
            // Place actions first, then separator, then regular items
            quickPick.items = [selectAllItem, clearAllItem, separator, ...regularItems];

            // Pre-select all regular items initially
            if (quickPick) {
                quickPick.selectedItems = [...regularItems];
            }

            // --- Event Listeners ---

            let ignoreSelectionChange: boolean = false;
            quickPick.onDidChangeSelection((selection) => {
                if (ignoreSelectionChange || isResolved) {
                    return;
                } // Prevent updates if flagged or after resolution

                // Check if a control item was just selected
                const selectedLabels: string[] = selection.map((item) => item.label);
                const isSelectAllTriggered: boolean = selectedLabels.includes(selectAllLabel);
                const isClearAllTriggered: boolean = selectedLabels.includes(clearAllLabel);

                if (isSelectAllTriggered || isClearAllTriggered) {
                    ignoreSelectionChange = true;
                    if (isSelectAllTriggered) {
                        // Select all regular items
                        if (quickPick) {
                            quickPick.selectedItems = [...regularItems];
                        }
                    } else {
                        // Deselect all regular items
                        if (quickPick) {
                            quickPick.selectedItems = [];
                        }
                    }
                    // Re-enable the listener after a brief moment
                    setTimeout(() => {
                        ignoreSelectionChange = false;
                    }, 10);
                }
            });

            quickPick.onDidAccept(() => {
                if (isResolved || !quickPick) {
                    return;
                }
                isResolved = true;
                try {
                    // Filter out control items and map to labels
                    const selectedRegularLabels: string[] = quickPick.selectedItems
                        .filter(
                            (item) =>
                                item.label !== selectAllLabel &&
                                item.label !== clearAllLabel &&
                                item.kind !== vscode.QuickPickItemKind.Separator
                        )
                        .map((item) => item.label);
                    resolve(selectedRegularLabels);
                } catch (err) {
                    logger.error("Error processing Quick Pick acceptance:", err);
                    resolve([]); // Resolve with empty on error during processing
                } finally {
                    quickPick.dispose(); // Dispose on accept
                }
            });

            quickPick.onDidHide(() => {
                // Important: onDidHide fires even after onDidAccept.
                // The isResolved flag prevents resolving twice.
                if (isResolved || !quickPick) {
                    return;
                }
                isResolved = true;
                resolve([]); // User cancelled
                quickPick.dispose(); // Dispose on hide/cancel
            });

            quickPick.show();
        } catch (error) {
            logger.error("Error creating or displaying Quick Pick:", error);
            if (quickPick && !isResolved) {
                // Ensure disposal if error happens after creation but before hide/accept
                quickPick.dispose();
            }
            isResolved = true;
            resolve([]); // Resolve with empty array on error
        }
    });
}

import JSZip from "jszip";
import { findProjectKeyOfProjectTreeItem } from "./projectManagementTreeView";

/**
 * Reads a zip file and extracts unique quick pick items based on the file names.
 *
 * 1. Reads the zip file from disk.
 * 2. Loads the zip file using JSZip.
 * 3. Iterates over all file entries and checks for files with names starting with "iTB-TC-" and ending with ".json".
 * 4. Uses a regular expression to capture the common prefix (e.g. "iTB-TC-325") from each file.
 * 5. Adds the common identifier to a set to ensure uniqueness.
 *
 * @param {string} zipFilePath - The path to the zip file.
 * @param {boolean} groupByPrefix - (Optinal) When true, related JSON files sharing the same prefix (e.g., "iTB-TC-325")
 *                        are combined into a single quick pick item. When false, every file is
 *                        returned as an individual item. Default is true.
 * @returns {Promise<string[]>} A promise that resolves with an array of unique quick pick item labels.
 */
export async function getQuickPickItemsFromReportZipWithResults(
    zipFilePath: string,
    groupByPrefix: boolean = true
): Promise<string[]> {
    logger.trace(`Reading JSON's from zip file: ${zipFilePath}`);
    try {
        // Read the zip file as binary data.
        const data: Buffer<ArrayBufferLike> = fs.readFileSync(zipFilePath);
        // Load the zip file using JSZip.
        const zip = await JSZip.loadAsync(data);

        if (groupByPrefix) {
            logger.trace("Grouping JSON files by prefix.");
            const uniqueItems: Set<string> = new Set<string>();
            Object.keys(zip.files).forEach((fileName) => {
                if (isCandidateJsonFile(fileName)) {
                    const prefix: string | null = extractPrefix(fileName);
                    if (prefix) {
                        uniqueItems.add(prefix);
                    }
                }
            });
            logger.trace(`Unique items found: ${Array.from(uniqueItems)}`);
            return Array.from(uniqueItems);
        } else {
            logger.trace("Returning all JSON files as individual items.");
            const items: string[] = [];
            Object.keys(zip.files).forEach((fileName) => {
                if (isCandidateJsonFile(fileName)) {
                    items.push(fileName);
                }
            });
            logger.trace(`Items found: ${items}`);
            return items;
        }
    } catch (error) {
        logger.error("Error processing the zip file:", error);
        return [];
    }
}

/**
 * Updates the zip file by removing the unselected JSON files.
 *
 * Only candidate JSON files (those starting with the specified prefixes and ending with ".json") are considered.
 * When grouping is enabled, each file is removed if its extracted prefix is not among the selected items.
 * When grouping is disabled, only files whose full names do not appear in the selected list are removed.
 *
 * @param {string} zipFilePath - The path to the zip file.
 * @param {string[]} selectedItems - The array of labels representing the selected items from the quick pick.
 *                        For grouped mode these are prefixes (e.g., "iTB-TC-325") and for non-grouped mode
 *                        these are full file names.
 * @param {boolean} groupByPrefix - (Optinal) Flag indicating the grouping behavior; should be the same used for the quick pick.
 *                        Default is true.
 */
export async function createNewReportWithSelectedItems(
    zipFilePath: string,
    selectedItems: string[],
    groupByPrefix: boolean = true
): Promise<void> {
    logger.trace(`Updating zip file: ${zipFilePath} with selected items: ${selectedItems}`);
    try {
        // Read the zip file as binary data.
        const data: Buffer<ArrayBufferLike> = fs.readFileSync(zipFilePath);
        // Load the zip file using JSZip.
        const zip: JSZip = await JSZip.loadAsync(data);

        // Process each file in the zip.
        Object.keys(zip.files).forEach((fileName) => {
            // Only consider JSON files with the matching prefix.
            if (isCandidateJsonFile(fileName)) {
                if (groupByPrefix) {
                    const prefix: string | null = extractPrefix(fileName);
                    if (prefix && !selectedItems.includes(prefix)) {
                        zip.remove(fileName);
                    }
                } else {
                    if (!selectedItems.includes(fileName)) {
                        zip.remove(fileName);
                    }
                }
            }
        });

        // Generate a new file name with a suffix appended before the extension.
        const filePathWithoutExtension: string = zipFilePath.substring(0, zipFilePath.lastIndexOf("."));
        const fileExtension: string = path.extname(zipFilePath);
        const newZipFilePath: string = `${filePathWithoutExtension}-MODIFIED${fileExtension}`;
        // Generate the new zip archive as a Node.js buffer.
        const newZipData: Buffer<ArrayBufferLike> = await zip.generateAsync({ type: "nodebuffer" });
        // Write the new zip archive to the new file.
        fs.writeFileSync(newZipFilePath, newZipData);

        const zipUpdateSuccessMessage: string = `Modified report file created at: ${newZipFilePath}`;
        logger.debug(zipUpdateSuccessMessage);
        vscode.window.showInformationMessage(zipUpdateSuccessMessage);
    } catch (error) {
        logger.error("Error updating zip file:", error);
    }
}

/**
 * Helper function to determine if a file is a candidate JSON file based on its name.
 *
 * It checks (in a case-insensitive way) if the file name starts with either "itb-tc-" or "itb-tt-"
 * and ends with ".json".
 *
 * @param {string} fileName - The name of the file.
 * @returns {boolean} True if the file matches the criteria; otherwise, false.
 */
function isCandidateJsonFile(fileName: string): boolean {
    const lowerFileName: string = fileName.toLowerCase();
    return (
        (lowerFileName.startsWith("itb-tc-") || lowerFileName.startsWith("itb-tt-")) && lowerFileName.endsWith(".json")
    );
}

/**
 * Helper function to extract the grouping prefix from a filename.
 *
 * It uses a regular expression to capture the prefix such as "itb-tc-325" or "itb-tt-325"
 * in a case-insensitive way.
 *
 * @param {string} fileName - The name of the file.
 * @returns {string | null} The extracted prefix if found; otherwise, null.
 */
function extractPrefix(fileName: string): string | null {
    // This regex matches a string that starts with "itb-" followed by either "tc" or "tt",
    // then a hyphen and one or more digits.
    const prefixRegex: RegExp = /^(itb-(tc|tt)-\d+)/i;
    const match: RegExpMatchArray | null = fileName.match(prefixRegex);
    return match ? match[1] : null;
}
