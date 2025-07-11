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
import * as utils from "./utils";
import * as testbench2robotframeworkLib from "./testbench2robotframeworkLib";
import axios, { AxiosResponse } from "axios";
import { connection, logger, ALLOW_PERSISTENT_IMPORT_BUTTON } from "./extension";
import {
    ConfigKeys,
    StorageKeys,
    JobTypes,
    folderNameOfInternalTestbenchFolder,
    ProjectItemTypes,
    TestThemeItemTypes
} from "./constants";
import { extractDataFromReport, PlayServerConnection, withRetry } from "./testBenchConnection";
import { ExecutionMode } from "./testBenchTypes";
import { getExtensionConfiguration } from "./configuration";
import { TestThemesTreeItem } from "./treeViews/implementations/testThemes/TestThemesTreeItem";
import { ProjectsTreeItem } from "./treeViews/implementations/projects/ProjectsTreeItem";
import { TreeItemBase } from "./treeViews/core/TreeItemBase";

/**
 * Saves the last generated report parameters to workspace storage.
 *
 * @param {vscode.ExtensionContext} context The extension context providing access to workspaceState.
 * @param {string} UID The unique ID of the root tree item used for generation.
 * @param {string} projectKey The project key used.
 * @param {string} cycleKey The cycle key used.
 * @param {ExecutionMode} executionMode Whether the report was execution-based.
 * @param {boolean} alreadyImported Whether the report was already imported.
 */
async function saveLastGeneratedReportParams(
    context: vscode.ExtensionContext,
    UID: string,
    projectKey: string,
    cycleKey: string,
    executionMode: ExecutionMode,
    alreadyImported: boolean
): Promise<void> {
    const paramsToSave: testBenchTypes.LastGeneratedReportParams = {
        UID,
        projectKey,
        cycleKey,
        executionMode: executionMode,
        timestamp: Date.now(),
        alreadyImported
    };

    try {
        await context.workspaceState.update(StorageKeys.LAST_GENERATED_PARAMS, paramsToSave);
        logger.debug(
            `Saved last generated report params to workspace state: UID=${UID}, projectKey=${projectKey}, cycleKey=${cycleKey}, executionMode=${executionMode}, alreadyImported=${alreadyImported}.`
        );
    } catch (error) {
        logger.error("Failed to save last generated report params to workspace state:", error);
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
        const storedParams: testBenchTypes.LastGeneratedReportParams | undefined =
            context.workspaceState.get<testBenchTypes.LastGeneratedReportParams>(StorageKeys.LAST_GENERATED_PARAMS);

        if (
            storedParams &&
            storedParams.UID &&
            storedParams.projectKey &&
            storedParams.cycleKey &&
            storedParams.executionMode !== undefined &&
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
 * @param {testBenchTypes.JobStatusResponse} jobStatus The job status response object.
 * @returns {boolean} True if the import job completed successfully; otherwise false.
 */
export function isImportJobCompletedSuccessfully(jobStatus: testBenchTypes.JobStatusResponse): boolean {
    const success = !!jobStatus?.completion?.result?.ExecutionImportingSuccess;
    logger.trace(`isImportJobCompletedSuccessfully: ${success}`);
    return success;
}

/**
 * Checks if the import job has failed.
 * @param {testBenchTypes.JobStatusResponse} jobStatus The job status response object.
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
    const startTime: number = Date.now(); // Start time for the polling to adjust the polling interval after 10 seconds
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

            // Display the job status progress in the progress bar text if counts are available
            const totalItems: number | undefined = jobStatus?.progress?.totalItemsCount;
            const handledItems: number | undefined = jobStatus?.progress?.handledItemsCount;
            if (totalItems && handledItems) {
                const percentage: number = Math.round((handledItems / totalItems) * 100);
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

        // Check if the maximum polling time has been exceeded.
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
export async function getJobIdOfCycleReport(
    projectKey: string,
    cycleKey: string,
    requestParams?: testBenchTypes.OptionalJobIDRequestParameter
): Promise<string | null> {
    if (!connection) {
        logger.error("Connection object is missing, cannot get job ID.");
        return null;
    }

    const getJobIDUrl: string = `${connection.getBaseURL()}/projects/${projectKey}/cycles/${cycleKey}/report/v1`;
    logger.debug(`Fetching job ID from URL: ${getJobIDUrl}`);
    try {
        const apiClient: axios.AxiosInstance = connection.getApiClient();
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
                    const nonRetryableStatusCodes = [400, 401, 403, 404, 422];
                    if (nonRetryableStatusCodes.includes(error.response.status)) {
                        logger.warn(
                            `[ReportHandler] Non-retryable error ${error.response.status} for getJobId. Not retrying.`
                        );
                        return false;
                    }
                }
                return true;
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
        vscode.window.showErrorMessage(`Failed to fetch job ID: ${error.message}`);
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

    const apiClient: axios.AxiosInstance = connection.getApiClient();
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

        const apiClient: axios.AxiosInstance = connection.getApiClient();
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
        const uri: vscode.Uri = vscode.Uri.file(filePath);
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

        if (fileExists) {
            const overwritePromptResult = await vscode.window.showWarningMessage(
                `The file "${fileNameOfReport}" already exists. Overwrite?`,
                { modal: true },
                "Overwrite",
                "Skip"
            );
            if (overwritePromptResult === "Skip") {
                const skipDownloadMsg: string = "File download skipped by the user.";
                vscode.window.showInformationMessage(skipDownloadMsg);
                logger.debug(skipDownloadMsg);
                return null;
            }
        }

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
export async function fetchReportZipOfCycleFromServer(
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

        const jobId: string | null = await getJobIdOfCycleReport(projectKey, cycleKey, requestParameters);
        if (!jobId) {
            logger.error("Job ID not received from server.");
            return null;
        }
        logger.debug(`Job ID received: ${jobId}`);

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
 * Sets the UID of the last imported tree item in storage, overwriting any previous value.
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} reportRootUID The UID of the successfully imported item.
 */
async function setLastImportedItem(context: vscode.ExtensionContext, reportRootUID: string): Promise<void> {
    try {
        await context.workspaceState.update(StorageKeys.SUB_TREE_ITEM_IMPORT_STORAGE_KEY, reportRootUID);
        logger.debug(`Set last imported item UID to ${reportRootUID}.`);
    } catch (error) {
        logger.error("Error setting last imported item UID:", error);
    }
}

/**
 * Generates Robot Framework tests using testbench2robotframework library.
 *
 * @param {vscode.ExtensionContext} context The VS Code extension context.
 * @param {TestThemeTreeItem | ProjectManagementTreeItem} selectedTreeItem The selected tree item (Union type for flexibility).
 * @param {string} itemLabel The label of the selected item.
 * @param {string} projectKey The project key.
 * @param {string} cycleKey The cycle key.
 * @param {string} treeItemUID Cycle UID or Theme/Set UID.
 * @returns {Promise<boolean>} Resolves with true if successful, false otherwise
 */
export async function generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
    context: vscode.ExtensionContext,
    selectedTreeItem: TestThemesTreeItem | ProjectsTreeItem,
    itemLabel: string,
    projectKey: string,
    cycleKey: string,
    treeItemUID: string
): Promise<boolean> {
    let testGenerationSuccessful: boolean = false;
    try {
        logger.debug("Generating tests for:", selectedTreeItem.label);
        const defaultExecutionMode: testBenchTypes.ExecutionMode = testBenchTypes.ExecutionMode.Execute;
        let UIDforRequest: string;

        const effectiveContext: string | undefined = selectedTreeItem.originalContextValue;

        if (effectiveContext?.toLowerCase() === ProjectItemTypes.CYCLE.toLowerCase()) {
            logger.debug("Generating tests for the entire cycle.");
            UIDforRequest = "";
        } else if (
            effectiveContext === TestThemeItemTypes.TEST_THEME ||
            effectiveContext === TestThemeItemTypes.TEST_CASE_SET
        ) {
            logger.debug(`Generating tests for specific tree item UID: ${treeItemUID}.`);
            UIDforRequest = treeItemUID;
        } else {
            logger.error(`Unsupported item type for test generation: ${effectiveContext}`);
            vscode.window.showErrorMessage(`Cannot generate tests for item type: ${effectiveContext}`);
            return false;
        }

        const cycleReportOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter = {
            executionMode: defaultExecutionMode,
            treeRootUID: UIDforRequest,
            suppressFilteredData: false,
            suppressNotExecutable: true, // Exclude not executable tests (including NotPlanned)
            suppressEmptyTestThemes: false,
            filters: []
        };
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Generating Tests for ${itemLabel}`,
                cancellable: true
            },
            async (progress, cancellationToken) => {
                const testGenerationResult: boolean = await runRobotFrameworkTestGenerationProcess(
                    context,
                    projectKey,
                    cycleKey,
                    defaultExecutionMode,
                    treeItemUID,
                    cycleReportOptionsRequestParams,
                    progress,
                    cancellationToken
                );
                if (testGenerationResult) {
                    testGenerationSuccessful = true;
                }
            }
        );
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            const testGenerationCancelledMessage: string =
                "[generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary] Test generation cancelled by the user.";
            logger.debug(testGenerationCancelledMessage);
            vscode.window.showInformationMessage(testGenerationCancelledMessage);
            return false;
        } else {
            logger.error(
                "[generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary] Error during test generation:",
                error
            );
            vscode.window.showErrorMessage(`Error: ${error instanceof Error ? error.message : error}`);
            return false;
        }
    }

    if (testGenerationSuccessful) {
        if (getExtensionConfiguration().get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false)) {
            await vscode.commands.executeCommand("workbench.view.extension.test");
            logger.debug("Testing view opened after successful test generation");
        }

        const successfulTestGenerationMessage: string = `Robot Framework tests generated successfully for: ${itemLabel}`;
        vscode.window.showInformationMessage(successfulTestGenerationMessage);
        logger.info(successfulTestGenerationMessage);
        return true;
    }
    return false;
}

/**
 * Runs the Robot Framework test generation process with progress reporting.
 *
 * @param {vscode.ExtensionContext} context The VS Code extension context.
 * @param {string} projectKey The project key.
 * @param {string} cycleKey The cycle key.
 * @param {ExecutionMode} executionMode Execution mode for the test generation.
 * @param {string} treeItemUID The UID of the selected tree item.
 * @param {testBenchTypes.OptionalJobIDRequestParameter} cycleStructureOptionsRequestParams Request parameters for the cycle report.
 * @param {vscode.Progress} progress The VS Code progress reporter.
 * @param {vscode.CancellationToken} cancellationToken The cancellation token.
 * @returns {Promise<void | null>} Resolves when the process completes, or null if errors occur.
 */
async function runRobotFrameworkTestGenerationProcess(
    context: vscode.ExtensionContext,
    projectKey: string,
    cycleKey: string,
    executionMode: ExecutionMode,
    treeItemUID: string,
    cycleStructureOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken: vscode.CancellationToken
): Promise<boolean> {
    progress.report({ increment: 30, message: "Fetching JSON Report from the server." });
    const downloadedReportZipPath: string | null = await fetchReportZipOfCycleFromServer(
        projectKey,
        cycleKey,
        folderNameOfInternalTestbenchFolder,
        cycleStructureOptionsRequestParams,
        progress,
        cancellationToken
    );
    if (!downloadedReportZipPath) {
        logger.warn("[runRobotFrameworkTestGenerationProcess] Download cancelled or failed.");
        return false;
    }

    progress.report({ increment: 30, message: "Generating tests via testbench2robotframework." });
    const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
    if (!workspaceLocation) {
        const workspaceLocationMissingErrorMessage: string =
            "[runRobotFrameworkTestGenerationProcess] Workspace location not configured.";
        logger.error(workspaceLocationMissingErrorMessage);
        vscode.window.showErrorMessage(workspaceLocationMissingErrorMessage);
        return false;
    }

    const isTb2RobotframeworkGenerateTestsCommandSuccessful: boolean =
        await testbench2robotframeworkLib.tb2robotLib.startTb2robotframeworkTestGeneration(downloadedReportZipPath);
    await cleanUpReportFileIfConfiguredInSettings(downloadedReportZipPath);
    if (!isTb2RobotframeworkGenerateTestsCommandSuccessful) {
        return false;
    }

    // Update the last generated report parameters workspaceState to be able to import the generated tests later
    await saveLastGeneratedReportParams(context, treeItemUID, projectKey, cycleKey, executionMode, false);

    logger.trace("[runRobotFrameworkTestGenerationProcess] Test generation process completed successfully.");
    return true;
}

/**
 * Removes the report zip file if configured in the extension settings.
 *
 * @param {string} reportZipFilePath The path of the report zip file.
 */
export async function cleanUpReportFileIfConfiguredInSettings(reportZipFilePath: string): Promise<void> {
    if (getExtensionConfiguration().get<boolean>(ConfigKeys.CLEAR_REPORT_AFTER_PROCESSING)) {
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
            // Check if the file exists (throws error if not)
            await fsPromise.access(zipFileFullPath);
            if (path.extname(zipFileFullPath) !== ".zip") {
                throw new Error(`Invalid file type: ${path.extname(zipFileFullPath)}. Only zip files can be removed.`);
            }

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

    // To use relative paths to the workspace root,
    // get the workspace location to construct the full path of outputXmlFilePath.
    const outputXMLFileRelativePathInExtensionSettings: string | undefined = getExtensionConfiguration().get<string>(
        ConfigKeys.TB2ROBOT_OUTPUT_XML_PATH
    );
    const outputXMLFileAbsolutePath: string | null = await utils.constructAbsolutePathFromRelativePath(
        outputXMLFileRelativePathInExtensionSettings,
        true
    );
    if (outputXMLFileAbsolutePath) {
        return outputXMLFileAbsolutePath;
    }

    logger.trace("outputXmlFilePath could not be constructred. Prompting user to select output XML file manually.");
    const firstWorkspaceFolderPath: string | undefined = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // Determine which path to use as the default URI for the file selection dialog
    const defaultUri: vscode.Uri = firstWorkspaceFolderPath
        ? vscode.Uri.file(firstWorkspaceFolderPath) // Try first workspace folder
        : workingDirectoryPath
          ? vscode.Uri.file(workingDirectoryPath) // Try working directory
          : vscode.Uri.file(os.homedir()); // Fallback to the user's home directory
    logger.trace(`Default URI for XML selection: ${defaultUri.fsPath}`);
    const selectedXMLFileUri: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
        defaultUri: defaultUri,
        canSelectFiles: true,
        canSelectMany: false,
        title: "Select Output XML File",
        openLabel: "Select Output XML File",
        filters: { "XML Files": ["xml"] }
    });

    if (selectedXMLFileUri && selectedXMLFileUri.length > 0) {
        logger.debug(`Output XML file selected: ${selectedXMLFileUri[0].fsPath}`);
        return selectedXMLFileUri[0].fsPath;
    }

    const xmlFileNotSelectedError: string = "No output.xml file selected.";
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
    const selectedFiles: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
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
            const timestampedResultsZipName: string = `ReportWithResults_${Date.now()}.zip`;
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

            logger.debug(`Generated report zip file will be named ${timestampedResultsZipName}`);
            reportProgress("Fetching base report structure.", reportIncrement);
            const retrievedParams: testBenchTypes.LastGeneratedReportParams | undefined =
                getLastGeneratedReportParams(context);
            if (!retrievedParams) {
                const missingParamsError: string =
                    "Could not find parameters from previous test generation required for base report. Please generate tests first in this workspace.";
                logger.error(missingParamsError);
                vscode.window.showErrorMessage(missingParamsError);
                return undefined;
            }

            const { executionMode: executionBased, projectKey, cycleKey, UID, alreadyImported } = retrievedParams;
            if (
                executionBased === undefined ||
                !projectKey ||
                !cycleKey ||
                UID === undefined || // UID can be empty string
                alreadyImported === undefined
            ) {
                const invalidParamsError: string =
                    "Retrieved parameters from previous test generation are incomplete/invalid for fetching base report.";
                logger.error(invalidParamsError);
                vscode.window.showErrorMessage(invalidParamsError);
                return undefined;
            }

            const cycleStructureOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter = {
                executionMode: executionBased,
                treeRootUID: UID
            };

            const downloadedReportWithoutResultsZip: string | null = await fetchReportZipOfCycleFromServer(
                projectKey,
                cycleKey,
                folderNameOfInternalTestbenchFolder,
                cycleStructureOptionsRequestParams,
                progress
            );

            // If report fetching fails, prompt user to select the report zip file manually
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
                timestampedResultsZipName
            );

            const isTb2RobotFetchResultsExecutionSuccessful: boolean =
                await testbench2robotframeworkLib.tb2robotLib.startTb2robotFetchResults(
                    outputXMLPath,
                    finalBaseReportPath,
                    reportWithResultsZipFullPath
                );

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
 * Imports a report with results to the TestBench server, using a specific UID for the report root.
 *
 * @param {PlayServerConnection} connection The connection to the TestBench server.
 * @param {string} projectKeyString The project key as a string.
 * @param {string} cycleKeyString The cycle key as a string.
 * @param {string} reportWithResultsZipFilePath The path to the report zip file with results.
 * @param {string} reportRootUID The specific UID for the report root tree item.
 * @returns {Promise<void | null>} Resolves when the import is complete, or null if an error occurs.
 */
async function importReportWithResultsToTestbenchWithSpecificUID(
    connection: PlayServerConnection,
    projectKeyString: string,
    cycleKeyString: string,
    reportWithResultsZipFilePath: string,
    reportRootUID: string
): Promise<void | null> {
    try {
        logger.debug(`[Import] Starting import for specific UID: ${reportRootUID}`);
        logger.debug(`[Import] Report file: ${reportWithResultsZipFilePath}`);
        logger.debug(`[Import] Target: Project ${projectKeyString}, Cycle ${cycleKeyString}`);

        const { uniqueID } = await extractDataFromReport(reportWithResultsZipFilePath);
        if (!uniqueID) {
            const extractionErrorMsg: string = "Error extracting unique ID from the zip file.";
            vscode.window.showErrorMessage(extractionErrorMsg);
            logger.error(extractionErrorMsg);
            return null;
        }

        logger.debug(`[Import] Extracted report cycle root UID from zip: ${uniqueID}`);
        logger.debug(`[Import] Using specific target UID for import: ${reportRootUID}`);

        const projectKey: number = Number(projectKeyString);
        const cycleKey: number = Number(cycleKeyString);

        if (isNaN(projectKey) || isNaN(cycleKey)) {
            logger.error(
                `Invalid projectKey (${projectKeyString}) or cycleKey (${cycleKeyString}) provided for import.`
            );
            vscode.window.showErrorMessage("Internal error: Invalid project or cycle identifier for import.");
            return null;
        }

        const zipFilenameFromServer: string = await connection.importExecutionResultsAndReturnImportedFileName(
            projectKey,
            reportWithResultsZipFilePath
        );

        if (!zipFilenameFromServer) {
            const importErrorMessage: string = "Error importing the result file to the server.";
            logger.error(importErrorMessage);
            vscode.window.showErrorMessage(importErrorMessage);
            return null;
        }

        const importData: testBenchTypes.ImportData = {
            fileName: zipFilenameFromServer,
            reportRootUID: reportRootUID,
            useExistingDefect: true,
            discardTesterInformation: false,
            filters: []
        };

        try {
            logger.debug(`Starting import execution results for specific tree item with UID: ${reportRootUID}`);
            const importJobID: string = await connection.getJobIDOfImportJob(projectKey, cycleKey, importData);
            const importJobStatus: testBenchTypes.JobStatusResponse | null = await pollJobStatus(
                projectKeyString,
                importJobID,
                JobTypes.IMPORT
            );

            if (!importJobStatus || isImportJobFailed(importJobStatus)) {
                const importJobFailedMessage: string = `Import job for tree item UID "${reportRootUID}" could not be completed.`;
                logger.warn(importJobFailedMessage);
                vscode.window.showErrorMessage(importJobFailedMessage);
                return null;
            } else if (isImportJobCompletedSuccessfully(importJobStatus)) {
                logger.debug(`Import job for specific tree item UID "${reportRootUID}" completed successfully.`);
            } else {
                logger.warn("Import job finished polling but status is unknown.", importJobStatus);
                vscode.window.showWarningMessage("Import job status unknown after polling.");
            }
        } catch (error: any) {
            logger.error(`Error during import job for specific tree item UID ${reportRootUID}:`, error.message);
            return null;
        }
    } catch (error: any) {
        logger.error("Error importing report for specific tree item:", error.message);
        vscode.window.showErrorMessage(`An unexpected error occurred: ${error.message}`);
        return null;
    }
}

/**
 * Clears the tracked UID of the last imported item.
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function clearImportedSubTreeItemsTracking(context: vscode.ExtensionContext): Promise<void> {
    try {
        await context.workspaceState.update(StorageKeys.SUB_TREE_ITEM_IMPORT_STORAGE_KEY, undefined);
        logger.debug("Cleared last imported item tracking.");
    } catch (error) {
        logger.error("Error clearing last imported item tracking:", error);
    }
}

/**
 * Reads test results, creates a report zip with test results, and imports it to the TestBench server.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {TestThemeTreeItem} invokedOnItem The selected tree item (using new type).
 * @param {string} resolvedTargetProjectKey The project key resolved by the command handler.
 * @param {string} resolvedTargetCycleKey The cycle key resolved by the command handler.
 * @param {string} resolvedReportRootUID The report root UID resolved by the command handler using MarkedItemStateService.
 */
export async function fetchTestResultsAndCreateResultsAndImportToTestbench(
    context: vscode.ExtensionContext,
    invokedOnItem: TestThemesTreeItem,
    resolvedTargetProjectKey: string,
    resolvedTargetCycleKey: string,
    resolvedReportRootUID: string
): Promise<boolean> {
    logger.trace("Starting: Read, Create, and Import Test Results to Testbench.");
    logger.trace(`Invoked on item: ${invokedOnItem.label}`);
    return vscode.window.withProgress(
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
                    return false;
                }

                progress.report({ message: "Step 1/4: Validating parameters...", increment: 10 });

                if (cancellationToken.isCancellationRequested) {
                    logger.trace("Cancelled after param retrieval.");
                    return false;
                }

                progress.report({ message: "Step 2/4: Creating report with local test results...", increment: 30 });
                const reportCreationDetails = await fetchTestResultsAndCreateReportWithResultsWithTb2Robot(
                    context,
                    progress
                );
                if (cancellationToken.isCancellationRequested || !reportCreationDetails?.createdReportPath) {
                    logger.error("Failed to create report with results, or process was cancelled. Aborting import.");
                    return false;
                }

                const { createdReportPath } = reportCreationDetails!;
                const reportFileNameForDisplay: string = path.basename(createdReportPath);
                progress.report({
                    message: `Step 3/4: Importing ${invokedOnItem.label} to TestBench...`,
                    increment: 30
                });
                const importTargetMessage: string = `Importing "${invokedOnItem.label}" from report '${reportFileNameForDisplay}' to TestBench Project: ${resolvedTargetProjectKey}, Cycle: ${resolvedTargetCycleKey}.`;
                logger.trace(importTargetMessage);

                await importReportWithResultsToTestbenchWithSpecificUID(
                    connection!,
                    resolvedTargetProjectKey,
                    resolvedTargetCycleKey,
                    createdReportPath,
                    resolvedReportRootUID
                );

                if (cancellationToken.isCancellationRequested) {
                    logger.trace("Cancelled after import to TestBench.");
                    return false;
                }

                progress.report({ message: "Step 4/4: Cleaning up and updating state...", increment: 30 });
                await setLastImportedItem(context, resolvedReportRootUID);

                await cleanUpReportFileIfConfiguredInSettings(createdReportPath);
                if (!ALLOW_PERSISTENT_IMPORT_BUTTON) {
                    logger.debug(
                        `[ReportHandler] Import successful. Command handler should clear marked state for item: ${invokedOnItem.label} if configured.`
                    );
                } else {
                    logger.debug(
                        `[ReportHandler] Import successful. Import command will persist on item: ${invokedOnItem.label} if configured.`
                    );
                }

                logger.trace(
                    "[ReportHandler] Process Completed: Read, Create, and Import specific tree item to Testbench."
                );
                return true;
            } catch (error) {
                const errorMsg: string = `An error occurred during the import process: ${
                    error instanceof Error ? error.message : String(error)
                }`;
                logger.error(errorMsg, error);
                vscode.window.showErrorMessage(errorMsg);
                return false;
            }
        }
    );
}

/**
 * Starts robotframework test generation for a cycle tree item.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {ProjectsTreeItem } selectedCycleTreeItem The selected cycle tree item.
 */
export async function startTestGenerationForCycle(
    context: vscode.ExtensionContext,
    selectedCycleTreeItem: ProjectsTreeItem
): Promise<void | null> {
    try {
        if (!connection) {
            const connectionErrorMessage: string = "No connection available. Cannot generate tests for cycle.";
            vscode.window.showErrorMessage(connectionErrorMessage);
            logger.error(connectionErrorMessage);
            return null;
        }
        const cycleKey = selectedCycleTreeItem.data.key;
        if (!cycleKey) {
            const cycleKeyMissingMessage: string = "Cycle key is missing for test generation.";
            logger.error(cycleKeyMissingMessage);
            return null;
        }
        const projectKey: string | null = selectedCycleTreeItem.getProjectKey();
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

        const cycleUID = selectedCycleTreeItem.data.key || "";
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

/**
 * Starts test generation for a Test Object Version (TOV).
 * This generates tests for all test themes within the TOV.
 *
 * @param {vscode.ExtensionContext} context - VS Code extension context
 * @param {ProjectsTreeItem} treeItem - The tree item
 * @param {string} projectKey - The project key
 * @param {string} tovKey - The TOV key
 * @returns {Promise<boolean>} True if generation was successful
 */
export async function startTestGenerationUsingTOV(
    context: vscode.ExtensionContext,
    treeItem: TreeItemBase,
    projectKey: string,
    tovKey: string,
    generateTestForSpecificTestThemeTreeItem: boolean = false
): Promise<boolean> {
    logger.debug(`[ReportHandler] Starting test generation for TOV: ${treeItem.label} (${tovKey})`);

    try {
        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Generating tests for TOV: ${treeItem.label}`,
                cancellable: true
            },
            async (progress, cancellationToken) => {
                progress.report({
                    increment: 0,
                    message: generateTestForSpecificTestThemeTreeItem
                        ? `Fetching TOV structure report for specific item: ${treeItem.label}...`
                        : "Fetching TOV structure report for entire TOV..."
                });

                if (!connection) {
                    throw new Error("No connection available");
                }

                // Use undefined for root when generating tests for all test themes in TOV
                const rootUIDToUse = generateTestForSpecificTestThemeTreeItem
                    ? (treeItem as any).data?.base?.uniqueID
                    : undefined;

                logger.debug(
                    `[ReportHandler] generateTestForSpecificTestThemeTreeItem: ${generateTestForSpecificTestThemeTreeItem}`
                );
                logger.debug(`[ReportHandler] Extracted root UID: ${rootUIDToUse}`);

                // Fetch TOV structure to get all test themes
                const tovStructureOptions: testBenchTypes.TovStructureOptions = {
                    treeRootUID: rootUIDToUse,
                    suppressFilteredData: false,
                    //suppressNotExecutable: true,
                    suppressEmptyTestThemes: false,
                    filters: []
                };

                logger.trace(
                    `Requesting TOV structure for project ${projectKey} with root UID ${rootUIDToUse} and options: ${JSON.stringify(tovStructureOptions)}`
                );

                const tovReportJobID = await connection.requestToPackageTovsInServerAndGetJobID(
                    projectKey,
                    tovKey,
                    tovStructureOptions
                );

                if (cancellationToken.isCancellationRequested) {
                    return false;
                }

                if (!tovReportJobID) {
                    logger.error("Failed to fetch TOV structure report");
                    throw new Error("Failed to fetch TOV structure report");
                }

                logger.debug(`TOV structure report job ID: ${tovReportJobID}`);

                // Poll job status until completed
                const tovReportJobStatus: testBenchTypes.JobStatusResponse | null = await pollJobStatus(
                    projectKey,
                    tovReportJobID,
                    JobTypes.REPORT,
                    progress,
                    cancellationToken
                );
                if (!tovReportJobStatus || !isReportJobCompletedSuccessfully(tovReportJobStatus)) {
                    const reportGenerationErrorMsg: string = "Report generation was unsuccessful.";
                    logger.error(reportGenerationErrorMsg);
                    vscode.window.showErrorMessage(reportGenerationErrorMsg);
                    return false;
                }
                const downloadedTovReportName: string =
                    tovReportJobStatus.completion.result.ReportingSuccess!.reportName;
                logger.debug(`Report name to download: ${downloadedTovReportName}`);

                const downloadedTovReportPath: string | null = await downloadReport(
                    projectKey,
                    downloadedTovReportName,
                    folderNameOfInternalTestbenchFolder
                );

                if (!downloadedTovReportPath) {
                    logger.warn("Report download failed or was canceled.");
                    return false;
                }

                logger.debug(`Report downloaded successfully to: ${downloadedTovReportPath}`);
                progress.report({ increment: 20, message: "Generating tests for TOV..." });

                const isTb2RobotframeworkGenerateTestsCommandSuccessful: boolean =
                    await testbench2robotframeworkLib.tb2robotLib.startTb2robotframeworkTestGeneration(
                        downloadedTovReportPath
                    );

                await cleanUpReportFileIfConfiguredInSettings(downloadedTovReportPath);
                if (!isTb2RobotframeworkGenerateTestsCommandSuccessful) {
                    return false;
                }

                progress.report({ increment: 30, message: "Test generation completed" });
                const tovTestGenerationSuccessMessage = generateTestForSpecificTestThemeTreeItem
                    ? `Test generation completed for specific item: ${treeItem.label}`
                    : `Test generation completed for entire TOV: ${treeItem.label}`;
                logger.info(`[ReportHandler] ${tovTestGenerationSuccessMessage}`);
                vscode.window.showInformationMessage(tovTestGenerationSuccessMessage);

                if (getExtensionConfiguration().get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_GENERATION, false)) {
                    await vscode.commands.executeCommand("workbench.view.extension.test");
                    logger.debug("Testing view opened after successful test generation");
                }

                return true;
            }
        );
    } catch (error) {
        const tovTestGenerationErrorMessage = generateTestForSpecificTestThemeTreeItem
            ? `Test generation failed for specific item ${treeItem.label}: ${error instanceof Error ? error.message : "Unknown error"}`
            : `Test generation failed for TOV ${treeItem.label}: ${error instanceof Error ? error.message : "Unknown error"}`;
        logger.error(`[ReportHandler] ${tovTestGenerationErrorMessage}`, error);
        vscode.window.showErrorMessage(tovTestGenerationErrorMessage);
        return false;
    }
}
