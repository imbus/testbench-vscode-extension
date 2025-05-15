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
import * as testBenchTypes from "./testBenchTypes";
import * as projectManagementTreeView from "./projectManagementTreeView";
import * as utils from "./utils";
import * as testbench2robotframeworkLib from "./testbench2robotframeworkLib";
import JSZip from "jszip";
import axios, { AxiosResponse } from "axios";
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
import { importReportWithResultsToTestbench, withRetry } from "./testBenchConnection";

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
 * @param {boolean} alreadyImported Whether the report was already imported.
 */
async function saveLastGeneratedReportParams(
    context: vscode.ExtensionContext,
    UID: string,
    projectKey: string,
    cycleKey: string,
    executionBased: boolean,
    alreadyImported: boolean
): Promise<void> {
    const paramsToSave: testBenchTypes.LastGeneratedReportParams = {
        UID,
        projectKey,
        cycleKey,
        executionBased,
        // Timestamp for context or potential cleanup
        timestamp: Date.now(),
        alreadyImported
    };

    try {
        // Data stored here persists across VS Code sessions for this specific workspace
        await context.workspaceState.update(StorageKeys.LAST_GENERATED_PARAMS, paramsToSave);
        logger.debug(
            `Saved last generated report params to workspace state: UID=${UID}, projectKey=${projectKey}, cycleKey=${cycleKey}, executionBased=${executionBased}, alreadyImported=${alreadyImported}.`
        );
    } catch (error) {
        logger.error("Failed to save last generated report params to workspace state:", error);
    }
}

/**
 * Updates only the alreadyImported flag in the last generated report parameters stored in workspaceState.
 *
 * @param {vscode.ExtensionContext} context The extension context providing access to workspaceState.
 * @param {boolean} alreadyImported The new alreadyImported flag value.
 */
async function updateAlreadyImportedFlagOfLastImportedReport(
    context: vscode.ExtensionContext,
    alreadyImported: boolean
): Promise<void> {
    try {
        const existingParams = context.workspaceState.get<testBenchTypes.LastGeneratedReportParams>(
            StorageKeys.LAST_GENERATED_PARAMS
        );
        if (!existingParams) {
            logger.warn(
                "No last generated report parameters found in workspace state. Cannot update alreadyImported flag."
            );
            return;
        }
        existingParams.alreadyImported = alreadyImported;
        await context.workspaceState.update(StorageKeys.LAST_GENERATED_PARAMS, existingParams);
        logger.debug(`Updated alreadyImported flag to ${alreadyImported} in workspace state.`);
    } catch (error) {
        logger.error("Failed to update alreadyImported flag in workspace state:", error);
    }
}

/**
 * Saves the last imported report details to workspace storage.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {testBenchTypes.LastImportedReportDetails} details The report details to save.
 */
async function saveLastImportedReportDetails(
    context: vscode.ExtensionContext,
    details: testBenchTypes.LastImportedReportDetails
): Promise<void> {
    try {
        if (!details.outputXmlPath || !details.baseReportPath || !details.targetProjectKey || !details.targetCycleKey) {
            logger.error("Attempted to save incomplete LastImportedReportDetails. Aborting save.", details);
            return;
        }
        await context.workspaceState.update(StorageKeys.LAST_IMPORTED_REPORT_DETAILS, details);
        logger.debug(
            `Saved last imported report details: outputXml='${details.outputXmlPath}', baseReport='${details.baseReportPath}', targetProject='${details.targetProjectKey}', targetCycle='${details.targetCycleKey}'.`
        );
    } catch (error) {
        logger.error("Failed to save last imported report details to workspace state:", error);
    }
}

/**
 * Retrieves the last generated report parameters from workspace storage.
 *
 * @param {vscode.ExtensionContext} context The extension context providing access to workspaceState.
 * @returns {testBenchTypes.LastGeneratedReportParams | undefined} The retrieved parameters or undefined if not found/invalid.
 */
function getLastGeneratedReportParams(
    context: vscode.ExtensionContext
): testBenchTypes.LastGeneratedReportParams | undefined {
    try {
        // Retrieve the data from workspaceState
        const storedParams: testBenchTypes.LastGeneratedReportParams | undefined =
            context.workspaceState.get<testBenchTypes.LastGeneratedReportParams>(StorageKeys.LAST_GENERATED_PARAMS);

        if (
            storedParams &&
            storedParams.UID &&
            storedParams.projectKey &&
            storedParams.cycleKey &&
            storedParams.executionBased !== undefined &&
            storedParams.alreadyImported !== undefined
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
        // Use the apiClient from the global connection object.
        // It's already configured with the baseURL and Authorization header.
        const apiClient = connection.getApiClient();
        const jobIdResponse: AxiosResponse<testBenchTypes.JobIdResponse> = await withRetry(
            () =>
                apiClient.post<testBenchTypes.JobIdResponse>(getJobIDUrl, requestParams, {
                    headers: {
                        accept: "application/json",
                        "Content-Type": "application/json"
                    }
                }),
            3, // maxRetries
            2000, // delayMs
            (error: { response: { status: number } }) => {
                // shouldRetry predicate
                if (axios.isAxiosError(error) && error.response) {
                    const nonRetryableStatusCodes = [400, 401, 403, 404, 422]; // Common non-retryable client errors
                    if (nonRetryableStatusCodes.includes(error.response.status)) {
                        logger.warn(
                            `[ReportHandler] Non-retryable error ${error.response.status} for getJobId. Not retrying.`
                        );
                        return false;
                    }
                }
                return true; // Retry on other errors (e.g., network issues, 5xx server errors)
            }
        );

        logger.trace("[ReportHandler] Job ID response status:", jobIdResponse.status);
        logger.trace("[ReportHandler] Job ID response data:", jobIdResponse.data);

        if (jobIdResponse.status !== 200) {
            logger.error(`Failed to fetch job ID, status code: ${jobIdResponse.status}`);

            return null;
        }

        return jobIdResponse.data.jobID;
    } catch (error: any) {
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

    const apiClient = connection.getApiClient();
    const jobStatusResponse: AxiosResponse<testBenchTypes.JobStatusResponse> = await withRetry(
        () =>
            apiClient.get(getJobStatusUrl, {
                headers: {
                    accept: "application/vnd.testbench+json"
                }
            }),
        3, // max retries
        2000, // delay in ms between retries
        (error: { response: { status: number } }) => {
            if (axios.isAxiosError(error) && error.response) {
                const nonRetryableStatusCodes = [400, 401, 403, 404, 422];
                if (nonRetryableStatusCodes.includes(error.response.status)) {
                    logger.warn(
                        `[ReportHandler] Non-retryable error ${error.response.status} for getJobStatus. Not retrying.`
                    );
                    return false;
                }
            }
            return true;
        }
    );

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

        const apiClient = connection.getApiClient();
        const downloadZipResponse: AxiosResponse<any> = await withRetry(
            () =>
                apiClient.get(downloadReportUrl, {
                    responseType: "arraybuffer", // Expecting binary data
                    headers: {
                        accept: "application/vnd.testbench+json"
                    }
                }),
            3, // maxRetries
            2000, // delayMs
            (error: { response: { status: number } }) => {
                const nonRetryableStatusCodes = [400, 401, 403, 404, 422];
                if (
                    axios.isAxiosError(error) &&
                    error.response &&
                    nonRetryableStatusCodes.includes(error.response.status)
                ) {
                    logger.warn(
                        `[ReportHandler] Non-retryable error ${error.response.status} during report download. Not retrying.`
                    );
                    return false;
                }
                return true;
            }
        );

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
 * @param {string} elementUID Cycle UID or Theme/Set UID
 * @returns {Promise<void | null>} Resolves when tests are generated, or null if an error occurs.
 */
export async function generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
    context: vscode.ExtensionContext,
    selectedTreeItem: projectManagementTreeView.BaseTestBenchTreeItem,
    itemLabel: string,
    projectKey: string,
    cycleKey: string,
    elementUID: string
): Promise<void | null> {
    try {
        logger.debug("Generating tests for:", selectedTreeItem);
        const isReportGenerationExecutionBased: boolean = true; // Defaulting to execution based for now.
        let UIDforRequest: string;

        if (selectedTreeItem.contextValue === TreeItemContextValues.CYCLE) {
            // If the selected item is a Cycle, generate for the whole cycle.
            logger.debug("Generating tests for the entire cycle.");
            UIDforRequest = ""; // Empty string expected for root/all
        } else if (
            selectedTreeItem.contextValue === TreeItemContextValues.TEST_THEME_NODE ||
            selectedTreeItem.contextValue === TreeItemContextValues.TEST_CASE_SET_NODE
        ) {
            // If it's a test theme or test case set, use its specific UID passed as elementUID.
            logger.debug(`Generating tests for specific element UID: ${elementUID}.`);
            UIDforRequest = elementUID;
        } else {
            // Handle unsupported types
            logger.error(`Unsupported item type for test generation: ${selectedTreeItem.contextValue}`);
            vscode.window.showErrorMessage(`Cannot generate tests for item type: ${selectedTreeItem.contextValue}`);
            return null;
        }

        const cycleReportOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter = {
            basedOnExecution: isReportGenerationExecutionBased,
            treeRootUID: UIDforRequest
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
                    elementUID,
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
 * Runs the Robot Framework test generation process with progress reporting.
 *
 * @param {vscode.ExtensionContext} context The VS Code extension context.
 * @param {string} projectKey The project key.
 * @param {string} cycleKey The cycle key.
 * @param {boolean} executionBased Whether the report is execution-based.
 * @param {string} elementUID The UID of the selected element.
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
    elementUID: string,
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

    // Update the last generated report parameters workspaceState to be able to import the generated tests later
    await saveLastGeneratedReportParams(context, elementUID, projectKey, cycleKey, executionBased, false);

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
 * Reads test results using testbench2robotframework library and creates a report zip file with results.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {vscode.Progress} currentProgress Optional progress reporter.
 * @returns {Promise<{createdReportPath: string; outputXmlPathUsed: string; baseReportPathUsed: string} | undefined>}
 * An object with paths, or undefined on error.
 */
export async function fetchTestResultsAndCreateReportWithResultsWithTb2Robot(
    context: vscode.ExtensionContext,
    currentProgress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<{ createdReportPath: string; outputXmlPathUsed: string; baseReportPathUsed: string } | undefined> {
    try {
        logger.debug("Started fetching test results and creating report with results.");
        const executeWithProgress = async (
            progress: vscode.Progress<{ message?: string; increment?: number }>
        ): Promise<
            { createdReportPath: string; outputXmlPathUsed: string; baseReportPathUsed: string } | undefined
        > => {
            const reportIncrement: number = currentProgress ? 6 : 20;
            const reportProgress = (msg: string, inc: number) => progress.report({ message: msg, increment: inc });

            reportProgress("Choosing result XML file.", reportIncrement);
            // Add a timestamp to the report zip file name
            const reportWithResultsZipName: string = `ReportWithResults_${Date.now()}.zip`;
            const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
            if (!workspaceLocation) {
                logger.error("Workspace location not configured for report creation.");
                vscode.window.showErrorMessage("Workspace location not configured. Cannot create report.");
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
            logger.trace(`Using output XML file: ${outputXMLPath}`);

            logger.debug(`Generated report zip file will be named ${reportWithResultsZipName}`);
            reportProgress("Fetching base report structure.", reportIncrement);

            // TODO: Currently we are using the last generated report parameters to create the report with results,
            // these are used to fetch the report without results from the server.
            // Later we can make this process independent of the last generated report parameters.
            // Retrieve parameters from workspace state instead of global variable
            const retrievedParams: testBenchTypes.LastGeneratedReportParams | undefined =
                getLastGeneratedReportParams(context);
            if (!retrievedParams) {
                const missingParamsError: string =
                    "Could not find parameters from previous test generation required for base report. Please generate tests first in this workspace.";
                logger.error(missingParamsError);
                vscode.window.showErrorMessage(missingParamsError);
                return undefined;
            }

            const { executionBased, projectKey, cycleKey, UID, alreadyImported } = retrievedParams;
            if (
                executionBased === undefined ||
                !projectKey ||
                !cycleKey ||
                UID === undefined ||
                alreadyImported === undefined
            ) {
                // UID can be empty string
                const invalidParamsError: string =
                    "Retrieved parameters from previous test generation are incomplete/invalid for fetching base report.";
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
                cycleStructureOptionsRequestParams,
                progress
            );

            // If fetching the report failed, we need the user to select it manually
            const finalBaseReportPath: string | null =
                downloadedReportWithoutResultsZip ??
                (await chooseReportWithoutResultsZipFile(testbenchWorkingDirectoryPathInsideWorkspace));

            if (!finalBaseReportPath) {
                logger.error("Base report (without results) could not be obtained.");
                vscode.window.showErrorMessage(
                    "Could not obtain the necessary base report file (without results). Process aborted."
                );
                return undefined;
            }
            logger.trace(`Using base report file: ${finalBaseReportPath}`);

            reportProgress("Merging results with base report.", reportIncrement / 2);
            const reportWithResultsZipFullPath: string = path.join(
                testbenchWorkingDirectoryPathInsideWorkspace,
                reportWithResultsZipName
            );

            // Create the report with results
            const isTb2RobotFetchResultsExecutionSuccessful: boolean =
                await testbench2robotframeworkLib.tb2robotLib.startTb2robotFetchResults(
                    outputXMLPath,
                    finalBaseReportPath,
                    reportWithResultsZipFullPath
                );

            // Clean up the downloaded report after it has been used
            if (downloadedReportWithoutResultsZip) {
                await cleanUpReportFileIfConfiguredInSettings(downloadedReportWithoutResultsZip);
            }

            if (!isTb2RobotFetchResultsExecutionSuccessful) {
                const testResultsImportError: string =
                    "Merging test results with base report failed. Please check the output.xml and base report.";
                logger.error(testResultsImportError);
                vscode.window.showErrorMessage(testResultsImportError);
                return undefined;
            }
            const successMessage: string = `Report with results created: ${reportWithResultsZipFullPath}`;
            logger.debug(successMessage);

            return {
                createdReportPath: reportWithResultsZipFullPath,
                outputXmlPathUsed: outputXMLPath,
                baseReportPathUsed: finalBaseReportPath
            };
        };

        if (currentProgress) {
            return await executeWithProgress(currentProgress);
        } else {
            return await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Creating Report with Test Results",
                    cancellable: true
                },
                executeWithProgress
            );
        }
    } catch (error) {
        const fetchResultsErrorMessage: string = `An error occurred while creating report with results: ${error instanceof Error ? error.message : String(error)}`;
        vscode.window.showErrorMessage(fetchResultsErrorMessage);
        logger.error(fetchResultsErrorMessage, error);
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
    logger.trace("Starting: Read, Create, and Import Test Results to Testbench.");
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Reading Test Results and Creating Report",
            cancellable: true
        },
        async (progress, cancellationToken) => {
            try {
                if (cancellationToken.isCancellationRequested) {
                    logger.trace("User cancelled the import process at the beginning.");
                    vscode.window.showInformationMessage("Import process cancelled.");
                    return null;
                }

                progress.report({ message: "Step 1/4: Retrieving parameters for import target...", increment: 10 });
                logger.trace("Retrieving parameters for TestBench import target (Project/Cycle).");
                const retrievedParams: testBenchTypes.LastGeneratedReportParams | undefined =
                    getLastGeneratedReportParams(context);

                if (
                    !retrievedParams ||
                    !retrievedParams.projectKey ||
                    !retrievedParams.cycleKey ||
                    retrievedParams.alreadyImported === undefined
                ) {
                    const errorMsg: string =
                        "Cannot determine import target: Context information (project/cycle from last test generation) is missing. Please generate tests first in this workspace.";
                    logger.error(errorMsg);
                    vscode.window.showErrorMessage(errorMsg);
                    return null;
                }

                const {
                    projectKey: targetProjectKey,
                    cycleKey: targetCycleKey,
                    alreadyImported: alreadyImported
                } = retrievedParams;
                logger.trace(
                    `Target for TestBench import: Project Key '${targetProjectKey}', Cycle Key '${targetCycleKey}', already imported: ${alreadyImported}'.`
                );

                if (alreadyImported) {
                    logger.warn(
                        `Attempting to re-import same report. targetProject='${targetProjectKey}', targetCycle='${targetCycleKey}'.`
                    );
                    const userChoice = await vscode.window.showWarningMessage(
                        `You are about to import results to Project ${targetProjectKey}, Cycle ${targetCycleKey} again. This seems to be the same operation as before. Do you want to proceed?`,
                        { modal: true },
                        "Yes, Import Again",
                        "Cancel"
                    );
                    if (userChoice !== "Yes, Import Again") {
                        logger.trace("User cancelled re-import of the same data to the same target.");
                        return null;
                    }
                    logger.trace("User chose to proceed with re-importing.");
                }

                if (cancellationToken.isCancellationRequested) {
                    logger.trace("Cancelled after param retrieval.");
                    return null;
                }

                progress.report({ message: "Step 2/4: Creating report with local test results...", increment: 30 });
                logger.trace(
                    "Calling fetchTestResultsAndCreateReportWithResultsWithTb2Robot to get report sources and created path."
                );

                const reportCreationDetails = await fetchTestResultsAndCreateReportWithResultsWithTb2Robot(
                    context,
                    progress
                );

                if (cancellationToken.isCancellationRequested) {
                    logger.trace("Cancelled after report creation attempt.");
                    return null;
                }

                if (!reportCreationDetails || !reportCreationDetails.createdReportPath) {
                    logger.error("Failed to create report with results, or process was cancelled. Aborting import.");
                    return null;
                }
                const { createdReportPath, outputXmlPathUsed, baseReportPathUsed } = reportCreationDetails;
                logger.trace(
                    `Successfully created report with results: ${createdReportPath}. Based on output.xml: '${outputXmlPathUsed}' and base report: '${baseReportPathUsed}'.`
                );

                const reportFileNameForDisplay = path.basename(createdReportPath);

                if (cancellationToken.isCancellationRequested) {
                    logger.trace("Cancelled after re-import check.");
                    return null;
                }

                progress.report({ message: "Step 3/4: Importing to TestBench...", increment: 30 });

                const importTargetMessage: string = `Importing report '${reportFileNameForDisplay}' to TestBench Project: ${targetProjectKey}, Cycle: ${targetCycleKey}.`;
                logger.trace(importTargetMessage);
                vscode.window.showInformationMessage(importTargetMessage);

                await importReportWithResultsToTestbench(
                    connection!,
                    targetProjectKey,
                    targetCycleKey,
                    createdReportPath
                );

                // Save details of this successful import (using sources and target)
                // Note: This is not needed anymore but can be used for logging
                await saveLastImportedReportDetails(context, {
                    outputXmlPath: outputXmlPathUsed,
                    baseReportPath: baseReportPathUsed,
                    targetProjectKey: targetProjectKey,
                    targetCycleKey: targetCycleKey,
                    timestamp: Date.now()
                });

                if (cancellationToken.isCancellationRequested) {
                    logger.trace("Cancelled after import to TestBench.");
                    return null;
                }

                progress.report({ message: "Step 4/4: Cleaning up temporary files...", increment: 30 });
                logger.debug(`Cleaning up generated report file: ${createdReportPath}`);
                await cleanUpReportFileIfConfiguredInSettings(createdReportPath);

                // Set already imported to true in the last generated report parameters to prevent re-import
                await updateAlreadyImportedFlagOfLastImportedReport(context, true);

                logger.trace("Process Completed: Read, Create, and Import Test Results to Testbench.");
            } catch (error) {
                const errorMsg: string = `An error occurred during the main import process: ${error instanceof Error ? error.message : String(error)}`;
                logger.error(errorMsg, error);
                vscode.window.showErrorMessage(errorMsg);
                return null;
            }
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

        const cycleUID = selectedCycleTreeItem.item?.uniqueID || selectedCycleTreeItem.item?.key || "";
        if (!cycleUID) {
            logger.warn(
                `Could not determine UID or Key for cycle: ${selectedCycleTreeItem.label}. Using empty string.`
            );
        }

        await generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
            context,
            selectedCycleTreeItem,
            selectedCycleTreeItem.label,
            projectKey,
            cycleKey,
            cycleUID
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

/**
 * Reads a zip file and extracts unique quick pick items based on the file names.
 *
 * 1. Reads the zip file from disk.
 * 2. Loads the zip file using JSZip.
 * 3. Iterates over all file entries and checks for files with names starting with "iTB-TC-" or "iTB-TT-" and ending with ".json".
 * 4. Uses a regular expression to capture the common prefix (e.g. "iTB-TC-325") from each file.
 * 5. If groupByPrefix is true, it attempts to read the corresponding "{prefix}.json" file to extract a 'name' property
 * and formats the quick pick item label as "{prefix} (name)" or "{prefix}" if the name is not available.
 * 6. Adds the common identifier (or full filename if not grouping) to a set to ensure uniqueness.
 *
 * @param {string} zipFilePath - The path to the zip file.
 * @param {boolean} groupByPrefix - (Optional) When true, related JSON files sharing the same prefix (e.g., "iTB-TC-325")
 * are combined into a single quick pick item, potentially including a name from the JSON.
 * When false, every file is returned as an individual item label.
 * Default is true.
 * @returns {Promise<string[]>} A promise that resolves with an array of unique quick pick item labels.
 */
export async function getQuickPickItemsFromReportZipWithResults(
    zipFilePath: string,
    groupByPrefix: boolean = true
): Promise<string[]> {
    logger.trace(`Reading JSON's from zip file: ${zipFilePath}, groupByPrefix: ${groupByPrefix}`);
    try {
        // Read the zip file as binary data.
        const data: Buffer<ArrayBufferLike> = fs.readFileSync(zipFilePath);
        // Load the zip file using JSZip.
        const zip = await JSZip.loadAsync(data);
        // File names in the zip file
        const filesInZip: string[] = Object.keys(zip.files);

        if (groupByPrefix) {
            logger.trace("Grouping JSON files by prefix and fetching names.");
            const uniquePrefixes: Set<string> = new Set<string>();

            // Collect all unique prefixes
            for (const fileName of filesInZip) {
                if (isCandidateJsonFile(fileName)) {
                    const prefix: string | null = extractPrefix(fileName);
                    if (prefix) {
                        uniquePrefixes.add(prefix);
                    }
                }
            }

            const quickPickItemLabels: string[] = [];
            // For each unique prefix, try to fetch its name and construct label for quick pick
            for (const prefix of uniquePrefixes) {
                let nameProperty: string | null = null;
                // Attempt to find and read the specific file "{prefix}.json" (case-insensitive)
                const specificJsonFileNameToFind: string = `${prefix}.json`.toLowerCase();
                const actualFileNameInZip: string | undefined = filesInZip.find(
                    (fileName) => fileName.toLowerCase() === specificJsonFileNameToFind
                );

                if (actualFileNameInZip) {
                    const jsonFile: JSZip.JSZipObject | null = zip.file(actualFileNameInZip);
                    if (jsonFile) {
                        try {
                            const jsonString: string = await jsonFile.async("string");
                            const jsonData = JSON.parse(jsonString);
                            nameProperty = jsonData?.name || null;
                        } catch (error) {
                            logger.warn(
                                `Could not read or parse JSON for ${actualFileNameInZip} to get name property for prefix ${prefix}:`,
                                error
                            );
                        }
                    }
                }

                const displayLabel: string = nameProperty ? `${prefix} (${nameProperty})` : prefix;
                quickPickItemLabels.push(displayLabel);
            }

            logger.trace(`Unique item labels for quick pick (grouped by prefix): ${quickPickItemLabels}`);
            return quickPickItemLabels.sort(); // Sort for consistent order
        } else {
            logger.trace("Listing all candidate JSON files with their names if available.");
            const quickPickItemLabelsIndividual: string[] = [];

            for (const fileName of filesInZip) {
                if (isCandidateJsonFile(fileName)) {
                    let nameProperty: string | null = null;
                    const jsonFile: JSZip.JSZipObject | null = zip.file(fileName);
                    if (jsonFile) {
                        try {
                            const jsonString: string = await jsonFile.async("string");
                            const jsonData = JSON.parse(jsonString);
                            // Attempt to get the 'name' property as a top level property of the JSON structure
                            nameProperty = jsonData?.name || null;
                        } catch (e) {
                            logger.warn(`Could not read or parse JSON for ${fileName} to get name property:`, e);
                        }
                    }
                    const displayLabel: string = nameProperty ? `${fileName} (${nameProperty})` : fileName;
                    quickPickItemLabelsIndividual.push(displayLabel);
                }
            }
            logger.trace(`Item labels for quick pick (individual files): ${quickPickItemLabelsIndividual}`);
            return quickPickItemLabelsIndividual.sort(); // Sort for consistent order
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
        const zip: JSZip = await JSZip.loadAsync(data);

        Object.keys(zip.files).forEach((fileName) => {
            if (isCandidateJsonFile(fileName)) {
                if (groupByPrefix) {
                    // Extract the actual prefixes from the selected display labels
                    const selectedPrefixes: Set<string> = new Set(
                        selectedItems.map((label) => {
                            // Regex to extract prefix from "prefix (name)" or "prefix"
                            const match: RegExpMatchArray | null = label.match(/^(itb-(?:tc|tt)-\d+)/i);
                            // Fallback to the full label if no prefix pattern is matched (should ideally not happen for valid items)
                            return match ? match[1] : label;
                        })
                    );

                    const prefixFromFile: string | null = extractPrefix(fileName);
                    if (prefixFromFile && !selectedPrefixes.has(prefixFromFile)) {
                        logger.trace(
                            `Removing ${fileName} as its prefix ${prefixFromFile} was not selected (selected were: ${Array.from(selectedPrefixes).join(", ")})`
                        );
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
