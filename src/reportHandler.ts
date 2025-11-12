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
import { AxiosResponse, AxiosInstance } from "axios";
import { connection, logger, treeViews, userSessionManager } from "./extension";
import {
    ConfigKeys,
    StorageKeys,
    JobTypes,
    folderNameOfInternalTestbenchFolder,
    ProjectItemTypes,
    TestThemeItemTypes,
    INTERNAL_REPORTS_SUBFOLDER_NAME
} from "./constants";
import { extractDataFromReport, PlayServerConnection, withRetry, RetryPredicateFactory } from "./testBenchConnection";
import { ExecutionMode } from "./testBenchTypes";
import { getExtensionConfiguration } from "./configuration";
import { TestThemesTreeItem } from "./treeViews/implementations/testThemes/TestThemesTreeItem";
import { ProjectsTreeItem } from "./treeViews/implementations/projects/ProjectsTreeItem";
import { TreeItemBase } from "./treeViews/core/TreeItemBase";
import { TestThemesTreeView } from "./treeViews/implementations/testThemes/TestThemesTreeView";

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
        if (!userSessionManager.hasValidUserSession()) {
            logger.debug("[reportHandler] No user session active, skipping last generated params storage");
            return;
        }

        const storageKey = userSessionManager.getUserStorageKey(StorageKeys.LAST_GENERATED_PARAMS);
        if (!storageKey) {
            logger.debug("[reportHandler] Failed to generate storage key, skipping last generated params storage");
            return;
        }
        await context.workspaceState.update(storageKey, paramsToSave);
        logger.debug(
            `[reportHandler] Saving 'last generated report' parameters to current workspace state for user ${userSessionManager.getCurrentUserId()}: UID=${UID}, projectKey=${projectKey}, cycleKey=${cycleKey}, executionMode=${executionMode}, alreadyImported=${alreadyImported}.`
        );
    } catch (error) {
        logger.error("[reportHandler] Failed to save 'last generated report' parameters to workspace state:", error);
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
        if (!userSessionManager.hasValidUserSession()) {
            logger.debug("[reportHandler] No user session active, cannot retrieve last generated params");
            return undefined;
        }

        const storageKey = userSessionManager.getUserStorageKey(StorageKeys.LAST_GENERATED_PARAMS);
        if (!storageKey) {
            logger.debug("[reportHandler] Failed to generate storage key, cannot retrieve last generated params");
            return undefined;
        }
        const storedParams: testBenchTypes.LastGeneratedReportParams | undefined =
            context.workspaceState.get<testBenchTypes.LastGeneratedReportParams>(storageKey);

        if (
            storedParams &&
            storedParams.UID &&
            storedParams.projectKey &&
            storedParams.cycleKey &&
            storedParams.executionMode !== undefined &&
            storedParams.alreadyImported !== undefined
        ) {
            logger.debug("[reportHandler] Retrieved last generated report params from workspace state:", storedParams);
            return storedParams;
        } else {
            logger.warn("[reportHandler] No valid last generated report params found in workspace state.");
            return undefined;
        }
    } catch (error) {
        logger.error("[reportHandler] Failed to retrieve last generated report params from workspace state:", error);
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
    return success;
}

/**
 * Checks if the import job has completed successfully.
 * @param {testBenchTypes.JobStatusResponse} jobStatus The job status response object.
 * @returns {boolean} True if the import job completed successfully; otherwise false.
 */
export function isImportJobCompletedSuccessfully(jobStatus: testBenchTypes.JobStatusResponse): boolean {
    const success = !!jobStatus?.completion?.result?.ExecutionImportingSuccess;
    if (success) {
        logger.debug(`[reportHandler] Successfully uploaded TestBench report.`);
    }
    return success;
}

/**
 * Checks if the import job has failed.
 * @param {testBenchTypes.JobStatusResponse} jobStatus The job status response object.
 * @returns {boolean} True if the import job failed; otherwise false.
 */
export function isImportJobFailed(jobStatus: testBenchTypes.JobStatusResponse): boolean {
    const failed = !!jobStatus?.completion?.result?.ExecutionImportingFailure;
    logger.debug(`[reportHandler] Is import job failed: ${failed}`);
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
            logger.debug(`[reportHandler] ${cancellationMsg}`);
            vscode.window.showInformationMessage(cancellationMsg);
            throw new vscode.CancellationError();
        }
        if (!connection) {
            logger.error("[reportHandler] No connection available, cannot poll job status.");
            return null;
        }
        pollingAttemptAmount++;

        try {
            jobStatus = await getJobStatus(projectKey, jobId, jobType);
            if (!jobStatus) {
                logger.error("[reportHandler] Job status not received from server.");
                return null;
            }

            // Display the job status progress in the progress bar text if counts are available
            const totalItems: number | undefined = jobStatus?.progress?.totalItemsCount;
            const handledItems: number | undefined = jobStatus?.progress?.handledItemsCount;
            if (totalItems && handledItems) {
                const percentage: number = Math.round((handledItems / totalItems) * 100);
                progress?.report({
                    message: `Downloading TestBench report (${handledItems}/${totalItems}).`,
                    increment: (percentage - lastProgressIncrement) / 3
                });
                logger.trace(`[reportHandler] Polling attempt ${pollingAttemptAmount}: Progress ${percentage}%`);
                lastProgressIncrement = percentage;
            } else {
                logger.trace(`[reportHandler] Polling attempt ${pollingAttemptAmount}: Job status fetched.`);
            }

            if (jobType === JobTypes.REPORT && isReportJobCompletedSuccessfully(jobStatus)) {
                return jobStatus;
            } else if (jobType === JobTypes.IMPORT) {
                if (isImportJobCompletedSuccessfully(jobStatus)) {
                    return jobStatus;
                } else if (isImportJobFailed(jobStatus)) {
                    return null;
                }
            }
        } catch (error) {
            logger.error(`[reportHandler] Failed to get job status at polling attempt ${pollingAttemptAmount}:`, error);
        }

        // Check if the maximum polling time has been exceeded.
        if (maxPollingTimeMs !== undefined && Date.now() - startTime >= maxPollingTimeMs) {
            logger.warn("[reportHandler] Maximum polling time exceeded. Aborting job status polling.");
            break;
        }

        // Adjust polling interval based on elapsed time.
        // For the first 10 seconds, poll every 200 ms, then poll every 1 second.
        const elapsedTime: number = Date.now() - startTime;
        const delayMs: number = elapsedTime < 10000 ? 200 : 1000;
        await utils.delay(delayMs);
    }
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
        logger.error("[reportHandler] No connection available, cannot get job ID.");
        return null;
    }

    const getJobIDUrl: string = `${connection.getBaseURL()}/projects/${projectKey}/cycles/${cycleKey}/report/v1`;
    logger.trace(`[reportHandler] Fetching job ID of cycle report from URL: ${getJobIDUrl}`);
    try {
        const apiClient: AxiosInstance = connection.getApiClient();
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
            RetryPredicateFactory.createDefaultPredicate()
        );

        logger.trace(`[reportHandler] Job ID response status for URL: ${getJobIDUrl}:`, jobIdResponse.status);
        logger.trace(`[reportHandler] Job ID response data for URL: ${getJobIDUrl}:`, jobIdResponse.data);

        if (jobIdResponse.status !== 200) {
            const errorMsg: string = `[reportHandler] Failed to fetch job ID, status code: ${jobIdResponse.status}`;
            logger.error(errorMsg);
            return null;
        }

        return jobIdResponse.data.jobID;
    } catch (error: any) {
        const errorMsg: string = `Error fetching job ID: ${error.message}`;
        logger.error("[reportHandler] " + errorMsg);
        vscode.window.showErrorMessage(errorMsg);
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
        logger.error("[reportHandler] No connection available, cannot get job status.");
        return null;
    }
    const getJobStatusUrl: string = `${connection.getBaseURL()}/projects/${projectKey}/${jobType}/job/${jobId}/v1`;
    logger.trace(`[reportHandler] Fetching job status at: ${getJobStatusUrl}`);

    const apiClient: AxiosInstance = connection.getApiClient();
    const jobStatusResponse: AxiosResponse<testBenchTypes.JobStatusResponse> = await withRetry(
        () =>
            apiClient.get(getJobStatusUrl, {
                headers: {
                    accept: "application/vnd.testbench+json"
                },
                proxy: false
            }),
        3, // max retries
        2000, // delay in ms between retries
        RetryPredicateFactory.createDefaultPredicate()
    );

    logger.trace(`[reportHandler] Job status response status for URL: ${getJobStatusUrl}:`, jobStatusResponse.status);
    logger.trace(`[reportHandler] Job status response data for URL: ${getJobStatusUrl}:`, jobStatusResponse.data);
    if (jobStatusResponse.status !== 200) {
        const errorMsg: string = `[reportHandler] Failed to fetch job status, status code: ${jobStatusResponse.status}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
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
            const missingConnectionError: string = "No connection available, cannot download report.";
            logger.error(`[reportHandler] ${missingConnectionError}`);
            vscode.window.showErrorMessage(missingConnectionError);
            return null;
        }
        const downloadReportUrl: string = `${connection.getBaseURL()}/projects/${projectKey}/report/${fileNameToDownload}/v1`;
        logger.debug(`[reportHandler] Downloading report "${fileNameToDownload}" from URL: ${downloadReportUrl}`);

        const apiClient: AxiosInstance = connection.getApiClient();
        const downloadZipResponse: AxiosResponse<any> = await withRetry(
            () =>
                apiClient.get(downloadReportUrl, {
                    responseType: "arraybuffer", // Expecting binary data
                    headers: {
                        accept: "application/vnd.testbench+json"
                    },
                    proxy: false
                }),
            3, // maxRetries
            2000, // delayMs
            RetryPredicateFactory.createDefaultPredicate()
        );

        if (downloadZipResponse.status !== 200) {
            const downloadReportErrorMessage: string = `Failed to download report, status code: ${downloadZipResponse.status}`;
            logger.error(`[reportHandler] ${downloadReportErrorMessage}`);
            throw new Error(downloadReportErrorMessage);
        }

        const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation || !fs.existsSync(workspaceLocation)) {
            const invalidWorkspaceLocationError: string = `[reportHandler] Workspace location is not valid: ${workspaceLocation}`;
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
        logger.error(`[reportHandler] ${downloadReportErrorMessage}`);
        vscode.window.showErrorMessage(downloadReportErrorMessage);
        return null;
    }
}

/**
 * Saves the downloaded report file locally inside the internal .testbench folder's reports subfolder.
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
        const dirPath: string = path.dirname(filePath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
        const uri: vscode.Uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadResponse.data));
        logger.debug(`[reportHandler] Report file saved to '${uri.fsPath}'.`);
        return uri.fsPath;
    } catch (error) {
        const failedReportSaveMessage: string = `Failed to save report file: ${(error as Error).message}`;
        logger.error(`[reportHandler] ${failedReportSaveMessage}`);
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
    const zipUri: vscode.Uri | undefined = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileNameOfReport),
        filters: { "Zip Files": ["zip"] },
        title: "Select a location to save the report file"
    });
    if (!zipUri) {
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
                logger.error(
                    `[reportHandler] Error checking file existence while prompting user for save location: ${(error as Error).message}`
                );
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
                const skipDownloadMsg: string = "[reportHandler] File download skipped by the user.";
                logger.debug(skipDownloadMsg);
                return null;
            }
        }

        await vscode.workspace.fs.writeFile(zipUri, new Uint8Array(downloadResponse.data));
        logger.debug(`[reportHandler] Report file saved to '${zipUri.fsPath}'.`);
        return zipUri.fsPath;
    } catch (error) {
        const failedReportSaveMessage: string = `Failed to save report file: ${(error as Error).message}`;
        logger.error(`[reportHandler] ${failedReportSaveMessage}`);
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
            logger.error("[reportHandler] No connection available, cannot fetch report.");
            return null;
        }

        logger.trace(
            `[reportHandler] Fetching report zip for projectKey: ${projectKey}, cycleKey: ${cycleKey}, folder: ${folderNameToDownloadReport} and request parameters:`,
            requestParameters
        );

        const jobId: string | null = await getJobIdOfCycleReport(projectKey, cycleKey, requestParameters);
        if (!jobId) {
            return null;
        }

        const jobStatus: testBenchTypes.JobStatusResponse | null = await pollJobStatus(
            projectKey,
            jobId,
            JobTypes.REPORT,
            progress,
            cancellationToken
        );
        if (!jobStatus || !isReportJobCompletedSuccessfully(jobStatus)) {
            const reportGenerationErrorMsg: string = "TestBench report generation failed.";
            logger.error(`[reportHandler] ${reportGenerationErrorMsg}`);
            vscode.window.showErrorMessage(reportGenerationErrorMsg);
            return null;
        }
        logger.debug(`[reportHandler] Successfully finished TestBench report generation.`);
        const reportName: string = jobStatus.completion.result.ReportingSuccess!.reportName;
        const downloadedFilePath: string | null = await downloadReport(
            projectKey,
            reportName,
            folderNameToDownloadReport
        );
        if (downloadedFilePath) {
            return downloadedFilePath;
        } else {
            logger.warn("[reportHandler] Downloading report failed or was canceled.");
            return null;
        }
    } catch (error) {
        logger.error(`[reportHandler] Error while fetching report zip from server: ${error}`);
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
        if (!userSessionManager.hasValidUserSession()) {
            logger.debug("[reportHandler] No user session active, skipping last imported item tracking");
            return;
        }

        const storageKey = userSessionManager.getUserStorageKey(StorageKeys.SUB_TREE_ITEM_IMPORT_STORAGE_KEY);
        if (!storageKey) {
            logger.debug("[reportHandler] Failed to generate storage key, skipping last imported item tracking");
            return;
        }
        await context.workspaceState.update(storageKey, reportRootUID);
        logger.debug(
            `[reportHandler] Set last imported item UID to ${reportRootUID} for user ${userSessionManager.getCurrentUserId()}.`
        );
    } catch (error) {
        logger.error(`[reportHandler] Error setting last imported item UID: ${error}`);
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
        const defaultExecutionMode: testBenchTypes.ExecutionMode = testBenchTypes.ExecutionMode.Execute;
        let UIDforRequest: string;

        const effectiveContext: string | undefined = selectedTreeItem.originalContextValue;

        if (effectiveContext?.toLowerCase() === ProjectItemTypes.CYCLE.toLowerCase()) {
            logger.debug(`[reportHandler] Generating Robot Framework test suites for test cycle '${itemLabel}'.`);
            UIDforRequest = "";
        } else if (
            effectiveContext === TestThemeItemTypes.TEST_THEME ||
            effectiveContext === TestThemeItemTypes.TEST_CASE_SET
        ) {
            logger.debug(`[reportHandler] Generating Robot Framework test suites from ${treeItemUID} (${itemLabel}).`);
            UIDforRequest = treeItemUID;
        } else {
            logger.error(
                `[reportHandler] Unsupported test structure element type for test generation: '${effectiveContext}'.`
            );
            vscode.window.showErrorMessage(
                `Unsupported test structure element type for test generation: '${effectiveContext}'.`
            );
            return false;
        }

        const currentFilters = await TestThemesTreeView.getValidatedFiltersForTreeItem(selectedTreeItem);
        const cycleReportOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter = {
            basedOnExecution: defaultExecutionMode === testBenchTypes.ExecutionMode.Execute,
            treeRootUID: UIDforRequest,
            suppressFilteredData: true, // Hides tree items after filtering
            suppressNotExecutable: true, // Exclude not executable tests (including NotPlanned)
            suppressEmptyTestThemes: false,
            filters: currentFilters
        };
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Generating Robot Framework test suites`,
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
                "[reportHandler] Robot Framework test suite generation has been cancelled by user.";
            logger.debug(testGenerationCancelledMessage);
            vscode.window.showInformationMessage(testGenerationCancelledMessage);
            return false;
        } else {
            logger.error("[reportHandler] Error during Robot Framework test suite generation:", error);
            vscode.window.showErrorMessage(
                `Error during Robot Framework test suite generation. Check the logs for more details.`
            );
            return false;
        }
    }

    if (testGenerationSuccessful) {
        if (getExtensionConfiguration().get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false)) {
            await vscode.commands.executeCommand("workbench.view.extension.test");
        }

        let successfulTestGenerationMessage: string = `Successfully generated Robot Framework test suites from ${treeItemUID} ('${itemLabel}').`;
        const effectiveContext: string | undefined = selectedTreeItem.originalContextValue;

        if (effectiveContext?.toLowerCase() === ProjectItemTypes.CYCLE.toLowerCase()) {
            successfulTestGenerationMessage = `Successfully generated Robot Framework test suites from Test Cycle '${itemLabel}'.`;
        }
        vscode.window.showInformationMessage(successfulTestGenerationMessage);
        logger.info(`[reportHandler] ${successfulTestGenerationMessage}`);
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
        path.join(folderNameOfInternalTestbenchFolder, INTERNAL_REPORTS_SUBFOLDER_NAME),
        cycleStructureOptionsRequestParams,
        progress,
        cancellationToken
    );
    if (!downloadedReportZipPath) {
        logger.warn("[reportHandler] Download cancelled or failed.");
        return false;
    }

    progress.report({ increment: 30, message: "Generating Robot Framework test suites from TestBench report." });
    const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
    if (!workspaceLocation) {
        const workspaceLocationMissingErrorMessage: string =
            "[reportHandler] Workspace location not configured, cannot generate tests.";
        const workspaceLocationMissingErrorMessageForUser: string =
            "Workspace location not configured, cannot generate tests.";
        logger.warn(workspaceLocationMissingErrorMessage);
        vscode.window.showWarningMessage(workspaceLocationMissingErrorMessageForUser);
        return false;
    }

    const isTb2RobotframeworkGenerateTestsCommandSuccessful: boolean =
        await testbench2robotframeworkLib.tb2robotLib.startTb2robotframeworkTestGeneration(downloadedReportZipPath);
    if (!isTb2RobotframeworkGenerateTestsCommandSuccessful) {
        return false;
    }

    // Update the last generated report parameters workspaceState to be able to import the generated tests later
    await saveLastGeneratedReportParams(context, treeItemUID, projectKey, cycleKey, executionMode, false);

    logger.debug("[reportHandler] Test generation process completed successfully.");
    return true;
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
    logger.debug(`[reportHandler] Removing report zip file: ${zipFileFullPath}`);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Check if the file exists (throws error if not)
            await fsPromise.access(zipFileFullPath);
            if (path.extname(zipFileFullPath) !== ".zip") {
                throw new Error(`Invalid file type: ${path.extname(zipFileFullPath)}. Only zip files can be removed.`);
            }

            await fsPromise.unlink(zipFileFullPath);
            logger.debug(`[reportHandler] Zip file removed: ${zipFileFullPath}`);
            return;
        } catch (error: any) {
            if (error.code === "ENOENT") {
                const fileNotFoundMsg: string = `File not found: ${zipFileFullPath}`;
                logger.error(`[reportHandler] ${fileNotFoundMsg}`);
                vscode.window.showWarningMessage(fileNotFoundMsg);
                return;
            } else if (error.code === "EBUSY" && attempt < maxRetries) {
                logger.warn(`[reportHandler] Attempt ${attempt} failed due to EBUSY. Retrying in ${delayMs}ms...`);
                await utils.delay(delayMs);
            } else {
                logger.error(`[reportHandler] Error removing file ${zipFileFullPath}:`, error);
                vscode.window.showErrorMessage(`Error removing file ${zipFileFullPath}: ${(error as Error).message}`);
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
    logger.debug(`[reportHandler] Searching output XML file using working directory: ${workingDirectoryPath}`);

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
        logger.debug(`[reportHandler] Using output XML file from extension settings: ${outputXMLFileAbsolutePath}`);
        return outputXMLFileAbsolutePath;
    }

    const firstWorkspaceFolderPath: string | undefined = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // Determine which path to use as the default URI for the file selection dialog
    const defaultUri: vscode.Uri = firstWorkspaceFolderPath
        ? vscode.Uri.file(firstWorkspaceFolderPath) // Try first workspace folder
        : workingDirectoryPath
          ? vscode.Uri.file(workingDirectoryPath) // Try working directory
          : vscode.Uri.file(os.homedir()); // Fallback to the user's home directory
    const selectedXMLFileUri: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
        defaultUri: defaultUri,
        canSelectFiles: true,
        canSelectMany: false,
        title: "Select Output XML File",
        openLabel: "Select Output XML File",
        filters: { "XML Files": ["xml"] }
    });

    if (selectedXMLFileUri && selectedXMLFileUri.length > 0) {
        logger.debug(`[reportHandler] Output XML file selected by user: ${selectedXMLFileUri[0].fsPath}`);
        return selectedXMLFileUri[0].fsPath;
    }

    logger.warn("[reportHandler] No output.xml file selected.");
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
        logger.debug(`[reportHandler] Report zip file without results selected by user: ${selectedFiles[0].fsPath}`);
        return selectedFiles[0].fsPath;
    }
    logger.warn("[reportHandler] No report zip file selected for the results zip file.");
    return null;
}

/**
 * Reads test results using testbench2robotframework library and creates a report zip file with results.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {vscode.Progress} currentProgress Optional progress reporter.
 * @param {vscode.CancellationToken} cancellationToken Optional cancellation token.
 * @param {string} reportRootUID Optional report root UID to use instead of the stored UID from last generation.
 * @returns {Promise<{createdReportPath: string; outputXmlPathUsed: string; baseReportPathUsed: string} | undefined>}
 * An object with paths, or undefined on error.
 */
export async function fetchTestResultsAndCreateReportWithResultsWithTb2Robot(
    context: vscode.ExtensionContext,
    currentProgress?: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken?: vscode.CancellationToken,
    reportRootUID?: string
): Promise<{ createdReportPath: string; outputXmlPathUsed: string; baseReportPathUsed: string } | undefined> {
    try {
        logger.trace("[reportHandler] Fetching test results and creating report with results.");
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
                logger.error("[reportHandler] Workspace location not configured for report creation.");
                vscode.window.showErrorMessage("Workspace location not configured. Cannot create report.");
                return undefined;
            }
            const testbenchWorkingDirectoryPathInsideWorkspace: string = path.join(
                workspaceLocation,
                folderNameOfInternalTestbenchFolder,
                INTERNAL_REPORTS_SUBFOLDER_NAME
            );
            try {
                await vscode.workspace.fs.createDirectory(
                    vscode.Uri.file(testbenchWorkingDirectoryPathInsideWorkspace)
                );
            } catch (e) {
                logger.warn(
                    `[reportHandler] Failed to ensure reports directory exists at ${testbenchWorkingDirectoryPathInsideWorkspace}: ${e}`
                );
            }

            const outputXMLPath: string | null = await chooseRobotOutputXMLFileIfNotSet(workspaceLocation);
            if (!outputXMLPath) {
                return undefined;
            }

            reportProgress("Fetching base report structure.", reportIncrement);
            const retrievedParams: testBenchTypes.LastGeneratedReportParams | undefined =
                getLastGeneratedReportParams(context);
            if (!retrievedParams) {
                const missingParamsErrorForUser: string =
                    "Could not find parameters from previous test generation required for base report. Please generate tests first in this workspace.";
                const missingParamsError: string =
                    "[reportHandler] Could not find parameters from previous test generation required for base report.";
                logger.error(missingParamsError);
                vscode.window.showErrorMessage(missingParamsErrorForUser);
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
                    "[reportHandler] Previous test generation parameters are invalid for fetching report.";
                const invalidParamsErrorForUser: string =
                    "Previous test generation parameters are invalid for fetching report.";
                logger.error(invalidParamsError);
                vscode.window.showErrorMessage(invalidParamsErrorForUser);
                return undefined;
            }

            // Use the provided reportRootUID if available (for specific tree item imports),
            // otherwise use the UID from last generation (for full cycle imports)
            const effectiveUID = reportRootUID !== undefined ? reportRootUID : UID;
            logger.debug(
                `[reportHandler] Using treeRootUID for import: ${effectiveUID} (provided: ${reportRootUID !== undefined}, stored: ${UID})`
            );

            const currentFiltersForImport = await TestThemesTreeView.getValidatedFiltersForApiRequest();
            const cycleStructureOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter = {
                basedOnExecution: executionBased === testBenchTypes.ExecutionMode.Execute,
                treeRootUID: effectiveUID,
                filters: currentFiltersForImport
            };

            const downloadedReportWithoutResultsZip: string | null = await fetchReportZipOfCycleFromServer(
                projectKey,
                cycleKey,
                path.join(folderNameOfInternalTestbenchFolder, INTERNAL_REPORTS_SUBFOLDER_NAME),
                cycleStructureOptionsRequestParams,
                progress,
                cancellationToken
            );

            // If report fetching fails, prompt user to select the report zip file manually
            const finalBaseReportPath: string | null =
                downloadedReportWithoutResultsZip ??
                (await chooseReportWithoutResultsZipFile(testbenchWorkingDirectoryPathInsideWorkspace));

            if (!finalBaseReportPath) {
                const baseReportNotObtainedError: string =
                    "[reportHandler] Could not obtain the necessary base report file without results. Process aborted.";
                logger.error(baseReportNotObtainedError);
                vscode.window.showErrorMessage("Could not obtain the necessary report file. Process aborted.");
                return undefined;
            }

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

            if (!isTb2RobotFetchResultsExecutionSuccessful) {
                const testResultsImportError: string =
                    "[reportHandler] Parsing Robot Framework results with testbench2robotframework failed.";
                const testResultsImportErrorForUser: string =
                    "Parsing Robot Framework results with testbench2robotframework failed.";
                logger.error(testResultsImportError);
                vscode.window.showErrorMessage(testResultsImportErrorForUser);
                return undefined;
            }
            const successMessage: string = `[reportHandler] Report with results created: ${reportWithResultsZipFullPath}`;
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
                    title: "Creating TestBench report containing execution results",
                    cancellable: true
                },
                executeWithProgress
            );
        }
    } catch (error) {
        const fetchResultsErrorMessage: string = `[reportHandler] Error while creating TestBench report with execution results: ${error instanceof Error ? error.message : String(error)}`;
        const fetchResultsErrorMessageForUser: string = "Error while creating TestBench report with execution results.";
        logger.error(fetchResultsErrorMessage);
        vscode.window.showErrorMessage(fetchResultsErrorMessageForUser);
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
    reportRootUID: string,
    cancellationToken?: vscode.CancellationToken
): Promise<void | null> {
    try {
        logger.debug(
            `[reportHandler] Starting import for specific UID: ${reportRootUID}, Report file: ${reportWithResultsZipFilePath}, Project key: ${projectKeyString}, Cycle key: ${cycleKeyString}`
        );
        const { uniqueID } = await extractDataFromReport(reportWithResultsZipFilePath);
        if (!uniqueID) {
            const extractionErrorMsg: string = "[reportHandler] Error extracting unique ID from the zip file.";
            const extractionErrorMsgForUser: string = "Error extracting unique ID from the zip file.";
            vscode.window.showErrorMessage(extractionErrorMsgForUser);
            logger.error(extractionErrorMsg);
            return null;
        }

        logger.trace(`[reportHandler] Extracted report cycle root UID from zip: ${uniqueID}`);
        const projectKey: number = Number(projectKeyString);
        const cycleKey: number = Number(cycleKeyString);

        if (isNaN(projectKey) || isNaN(cycleKey)) {
            const invalidProjectOrCycleKeyError: string = `[reportHandler] Invalid projectKey (${projectKeyString}) or cycleKey (${cycleKeyString}) provided for import.`;
            const invalidProjectOrCycleKeyErrorForUser: string = "Invalid project or cycle identifier for import.";
            logger.error(invalidProjectOrCycleKeyError);
            vscode.window.showErrorMessage(invalidProjectOrCycleKeyErrorForUser);
            return null;
        }

        const zipFilenameFromServer: string = await connection.importExecutionResultsAndReturnImportedFileName(
            projectKey,
            reportWithResultsZipFilePath
        );

        if (!zipFilenameFromServer) {
            const importErrorMessage: string = "[reportHandler] Error importing the result file to the server.";
            const importErrorMessageForUser: string = "Error importing the result file to the server.";
            logger.error(importErrorMessage);
            vscode.window.showErrorMessage(importErrorMessageForUser);
            return null;
        }

        const importData: testBenchTypes.ImportData = {
            fileName: zipFilenameFromServer,
            treeRootUID: reportRootUID,
            useExistingDefect: true,
            discardTesterInformation: false,
            filters: []
        };

        try {
            const importJobID: string = await connection.getJobIDOfImportJob(projectKey, cycleKey, importData);
            const importJobStatus: testBenchTypes.JobStatusResponse | null = await pollJobStatus(
                projectKeyString,
                importJobID,
                JobTypes.IMPORT,
                undefined,
                cancellationToken
            );

            if (!importJobStatus || isImportJobFailed(importJobStatus)) {
                const importJobFailedMessageForUser: string = "Import job could not be completed.";
                vscode.window.showErrorMessage(importJobFailedMessageForUser);
                return null;
            } else if (!isImportJobCompletedSuccessfully(importJobStatus)) {
                logger.warn("[reportHandler] Import job finished polling but status is unknown.", importJobStatus);
            }
        } catch (error: any) {
            logger.error(
                `[reportHandler] Error during import job for specific tree item UID ${reportRootUID}:`,
                error.message
            );
            return null;
        }
    } catch (error: any) {
        logger.error("[reportHandler] Error importing report:", error.message);
        vscode.window.showErrorMessage(`Error importing report: ${error.message}`);
        return null;
    }
}

/**
 * Clears the tracked UID of the last imported item.
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function clearImportedSubTreeItemsTracking(context: vscode.ExtensionContext): Promise<void> {
    try {
        if (!userSessionManager.hasValidUserSession()) {
            logger.debug("[reportHandler] No user session active, skipping clear imported item tracking");
            return;
        }

        const storageKey = userSessionManager.getUserStorageKey(StorageKeys.SUB_TREE_ITEM_IMPORT_STORAGE_KEY);
        if (!storageKey) {
            logger.debug("[reportHandler] Failed to generate storage key, skipping clear imported item tracking");
            return;
        }
        await context.workspaceState.update(storageKey, undefined);
        logger.debug(
            `[reportHandler] Cleared last imported item tracking for user ${userSessionManager.getCurrentUserId()}.`
        );
    } catch (error) {
        logger.error("[reportHandler] Error clearing last imported item tracking:", error);
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
    logger.trace(`[reportHandler] Fetching results and importing to Testbench for tree item: ${invokedOnItem.label}`);
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Reading Test Results and Creating Report",
            cancellable: true
        },
        async (progress, cancellationToken) => {
            try {
                if (cancellationToken.isCancellationRequested) {
                    logger.debug("[reportHandler] User cancelled the fetch and import process.");
                    vscode.window.showInformationMessage("Import process cancelled.");
                    return false;
                }

                progress.report({ message: "Step 1/4: Validating parameters...", increment: 10 });

                if (cancellationToken.isCancellationRequested) {
                    return false;
                }

                progress.report({ message: "Step 2/4: Creating report with local test results...", increment: 30 });
                const reportCreationDetails = await fetchTestResultsAndCreateReportWithResultsWithTb2Robot(
                    context,
                    progress,
                    cancellationToken,
                    resolvedReportRootUID
                );
                if (cancellationToken.isCancellationRequested || !reportCreationDetails?.createdReportPath) {
                    logger.error("[reportHandler] Failed to create report with results, or process was cancelled.");
                    return false;
                }

                const { createdReportPath } = reportCreationDetails!;
                progress.report({
                    message: `Step 3/4: Importing ${invokedOnItem.label} to TestBench...`,
                    increment: 30
                });

                await importReportWithResultsToTestbenchWithSpecificUID(
                    connection!,
                    resolvedTargetProjectKey,
                    resolvedTargetCycleKey,
                    createdReportPath,
                    resolvedReportRootUID,
                    cancellationToken
                );

                if (cancellationToken.isCancellationRequested) {
                    logger.debug("[reportHandler] Fetch and import process cancelled.");
                    return false;
                }

                progress.report({ message: "Step 4/4: Cleaning up and updating state...", increment: 30 });
                await setLastImportedItem(context, resolvedReportRootUID);
                logger.debug("[reportHandler] Fetch and import process completed.");
                return true;
            } catch (error) {
                const fetchAndImportErrorMsg: string = `[reportHandler] Error during fetch and import process: ${
                    error instanceof Error ? error.message : String(error)
                }`;
                const fetchAndImportErrorMsgForUser: string = "Error during fetch and import process.";
                logger.error(fetchAndImportErrorMsg, error);
                vscode.window.showErrorMessage(fetchAndImportErrorMsgForUser);
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
            const connectionErrorMessage: string =
                "[reportHandler] No connection available. Cannot generate tests for cycle.";
            vscode.window.showErrorMessage(connectionErrorMessage);
            logger.error(connectionErrorMessage);
            return null;
        }
        const cycleKey = selectedCycleTreeItem.data.key;
        if (!cycleKey) {
            const cycleKeyMissingMessage: string = "[reportHandler] Cycle key is missing for test generation.";
            logger.error(cycleKeyMissingMessage);
            return null;
        }
        const projectKey: string | null = selectedCycleTreeItem.getProjectKey();
        if (!projectKey) {
            const projectKeyMissingMessage = "[reportHandler] Project key of cycle is missing.";
            logger.error(projectKeyMissingMessage);
            return null;
        }
        if (typeof selectedCycleTreeItem.label !== "string") {
            const invalidLabelTypeMessage: string = "[reportHandler] Invalid label type. Test generation aborted.";
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
                `[reportHandler] Could not determine UID or Key for cycle: ${selectedCycleTreeItem.label}. Using empty string.`
            );
        }

        const generationSuccessful = await generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
            context,
            selectedCycleTreeItem,
            selectedCycleTreeItem.label,
            projectKey,
            cycleKey,
            cycleUID
        );

        if (generationSuccessful && treeViews?.testThemesTree) {
            await treeViews.testThemesTree.markCycleGenerationFromProjectsView(selectedCycleTreeItem);
        } else if (generationSuccessful) {
            logger.warn(
                "[reportHandler] Test themes tree view is not available, cannot apply import markings after cycle generation."
            );
        }
    } catch (error) {
        logger.error(
            `[reportHandler] Error in startTestGenerationForCycle: ${error instanceof Error ? error.message : String(error)}`
        );
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
    logger.debug(
        `[reportHandler] Starting Robot Framework test suite generation from Test Object Version '${treeItem.label}' (${tovKey}).`
    );

    try {
        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Generating Robot Framework test suites from Test Object Version '${treeItem.label}'`,
                cancellable: true
            },
            async (progress, cancellationToken) => {
                progress.report({
                    increment: 0,
                    message: generateTestForSpecificTestThemeTreeItem
                        ? `Fetching TestBench TOV report from ${treeItem.label}...`
                        : "Fetching TestBench TOV report for Test Object Version..."
                });

                if (!connection) {
                    throw new Error(
                        "[reportHandler] No connection available. Cannot generate Robot Framework test suites for selected TOV."
                    );
                }

                // Use undefined for root when generating tests for all test themes in TOV
                const rootUIDToUse = generateTestForSpecificTestThemeTreeItem
                    ? (treeItem as any).data?.base?.uniqueID
                    : undefined;

                let tovFilters: any[] = [];

                if (treeItem instanceof ProjectsTreeItem || treeItem instanceof TestThemesTreeItem) {
                    tovFilters = await TestThemesTreeView.getValidatedFiltersForTreeItem(treeItem);
                }

                // Fetch TOV structure to get all test themes
                const tovStructureOptions: testBenchTypes.TovStructureOptions = {
                    treeRootUID: rootUIDToUse,
                    suppressFilteredData: true,
                    //suppressNotExecutable: true,
                    suppressEmptyTestThemes: false,
                    filters: tovFilters
                };

                const tovReportJobID = await connection.requestToPackageTovsInServerAndGetJobID(
                    projectKey,
                    tovKey,
                    tovStructureOptions
                );

                if (cancellationToken.isCancellationRequested) {
                    return false;
                }

                if (!tovReportJobID) {
                    throw new Error("[reportHandler] Failed to fetch TestBench TOV report.");
                }

                // Poll job status until completed
                const tovReportJobStatus: testBenchTypes.JobStatusResponse | null = await pollJobStatus(
                    projectKey,
                    tovReportJobID,
                    JobTypes.REPORT,
                    progress,
                    cancellationToken
                );
                if (!tovReportJobStatus || !isReportJobCompletedSuccessfully(tovReportJobStatus)) {
                    const reportGenerationErrorMsg: string = "TestBench TOV report generation failed.";
                    logger.error(`[reportHandler] ${reportGenerationErrorMsg}`);
                    vscode.window.showErrorMessage(reportGenerationErrorMsg);
                    return false;
                }
                logger.debug(`[reportHandler] Successfully finished TestBench report generation job.`);
                const downloadedTovReportName: string =
                    tovReportJobStatus.completion.result.ReportingSuccess!.reportName;

                const downloadedTovReportPath: string | null = await downloadReport(
                    projectKey,
                    downloadedTovReportName,
                    path.join(folderNameOfInternalTestbenchFolder, INTERNAL_REPORTS_SUBFOLDER_NAME)
                );

                if (!downloadedTovReportPath) {
                    logger.warn("[reportHandler] Failed to download TestBench TOV report.");
                    return false;
                }

                progress.report({ increment: 20, message: "Generating Robot Framework test suites..." });

                const isTb2RobotframeworkGenerateTestsCommandSuccessful: boolean =
                    await testbench2robotframeworkLib.tb2robotLib.startTb2robotframeworkTestGeneration(
                        downloadedTovReportPath
                    );

                if (!isTb2RobotframeworkGenerateTestsCommandSuccessful) {
                    return false;
                }

                progress.report({ increment: 30, message: "Test generation completed" });
                const tovTestGenerationSuccessMessage = generateTestForSpecificTestThemeTreeItem
                    ? `Successfully generated Robot Framework test suites from ${rootUIDToUse} ('${treeItem.label}').`
                    : `Successfully generated Robot Framework test suites from Test Object Version '${treeItem.label}'.`;
                vscode.window.showInformationMessage(tovTestGenerationSuccessMessage);

                if (
                    getExtensionConfiguration().get<boolean>(ConfigKeys.OPEN_TESTING_VIEW_AFTER_TEST_GENERATION, false)
                ) {
                    await vscode.commands.executeCommand("workbench.view.extension.test");
                }

                return true;
            }
        );
    } catch (error) {
        const tovTestGenerationErrorMessage = generateTestForSpecificTestThemeTreeItem
            ? `[reportHandler] Robot Framework test suite generation failed for tree item '${treeItem.label}'. ${error instanceof Error ? error.message : "Unknown error"}`
            : `[reportHandler] Robot Framework test suite generation failed for Test Object Version '${treeItem.label}'. ${error instanceof Error ? error.message : "Unknown error"}`;
        logger.error(`[reportHandler] ${tovTestGenerationErrorMessage}`);
        vscode.window.showErrorMessage(tovTestGenerationErrorMessage);
        return false;
    }
}
