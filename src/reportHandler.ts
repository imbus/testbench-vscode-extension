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
import { getConfig, connection, logger } from "./extension";
import { importReportWithResultsToTestbench } from "./testBenchConnection";

/**
 * Global object to store parameters from the last fethed report file,
 * to be able to use the report without the user selecting the report again while uploading the report.
 * Declaring it as const does not prevent changing the properties of the object.
 */
export const lastGeneratedReportParams: testBenchTypes.LastGeneratedReportParams = {
    executionBased: undefined,
    projectKey: undefined,
    cycleKey: undefined,
    UID: undefined
};

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
 * @param projectKey The project key.
 * @param jobId The job ID received from the server.
 * @param jobType The type of job ("report" or "import").
 * @param progress Optional progress reporter.
 * @param cancellationToken Optional cancellation token.
 * @param maxPollingTimeMs Optional maximum polling time in milliseconds.
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
    let pollingAttemptAmount = 0;
    let jobStatus: testBenchTypes.JobStatusResponse | null = null;
    let lastProgressIncrement = 0;

    // Poll the job status until the job is completed with either success or failure.
    while (true) {
        if (cancellationToken?.isCancellationRequested) {
            logger.debug("Job status polling cancelled by the user.");
            vscode.window.showInformationMessage("Job status polling cancelled by the user.");
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
                logger.warn("Job status not received from server.");
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

            if (jobType === "report" && isReportJobCompletedSuccessfully(jobStatus)) {
                logger.debug("Report job completed successfully.");
                return jobStatus;
            } else if (jobType === "import") {
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
        const elapsedTime = Date.now() - startTime;
        const delayMs = elapsedTime < 10000 ? 200 : 1000;
        await utils.delay(delayMs);
    }

    logger.trace("Final job status:", jobStatus);
    return jobStatus;
}

/**
 * Retrieves the job ID from the server for a report or import job.
 *
 * @param projectKey The project key.
 * @param cycleKey The cycle key.
 * @param requestParams Optional request parameters.
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

    const getJobIDUrl = `${connection.getBaseURL()}/projects/${projectKey}/cycles/${cycleKey}/report/v1`;
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
 * @param projectKey The project key.
 * @param jobId The job ID.
 * @param jobType The type of job ("report" or "import").
 * @returns {Promise<testBenchTypes.JobStatusResponse | null>} The job status response object, or throws an error if not successful.
 */
export async function getJobStatus(
    projectKey: string,
    jobId: string,
    jobType: "report" | "import"
): Promise<testBenchTypes.JobStatusResponse | null> {
    if (!connection) {
        logger.error("Connection object is missing, cannot get job status.");
        return null;
    }
    const getJobStatusUrl = `${connection.getBaseURL()}/projects/${projectKey}/${jobType}/job/${jobId}/v1`;
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
 *
 * @param projectKey The project key.
 * @param fileNameToDownload The name of the report file.
 * @param folderNameToDownloadReport The folder name where the report will be saved.
 * @returns {Promise<string | null>} The absolute path of the downloaded file if successful, otherwise null.
 */
export async function downloadReport(
    projectKey: string,
    fileNameToDownload: string,
    folderNameToDownloadReport: string
): Promise<string | null> {
    try {
        if (!connection) {
            logger.error("Connection object is missing, cannot download report.");
            return null;
        }
        const downloadReportUrl = `${connection.getBaseURL()}/projects/${projectKey}/report/${fileNameToDownload}/v1`;
        logger.debug(`Downloading report "${fileNameToDownload}" from URL: ${downloadReportUrl}`);

        const downloadZipResponse: AxiosResponse<any> = await axios.get(downloadReportUrl, {
            responseType: "arraybuffer", // Expecting binary data
            headers: {
                accept: "application/vnd.testbench+json",
                Authorization: connection.getSessionToken()
            }
        });

        if (downloadZipResponse.status !== 200) {
            const msg = `Failed to download report, status code: ${downloadZipResponse.status}`;
            logger.error(msg);
            throw new Error(msg);
        }

        const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
        if (workspaceLocation && fs.existsSync(workspaceLocation)) {
            return await storeReportFileLocally(
                workspaceLocation,
                folderNameToDownloadReport,
                fileNameToDownload,
                downloadZipResponse
            );
        } else {
            logger.error(`Workspace location is not valid: ${workspaceLocation}`);
            return await promptUserForSaveLocationAndSaveReportToFile(fileNameToDownload, downloadZipResponse);
        }
    } catch (error) {
        const msg = `Failed to download report: ${(error as Error).message}`;
        logger.error(msg);
        vscode.window.showErrorMessage(msg);
        return null;
    }
}

/**
 * Saves the downloaded report file locally.
 *
 * @param workspaceLocation The workspace location.
 * @param folderNameOfReport The folder name for saving the report.
 * @param fileNameOfReport The name of the report file.
 * @param downloadResponse The Axios response containing the file data.
 * @returns {Promise<string | null>} The absolute file path if successful, otherwise null.
 */
async function storeReportFileLocally(
    workspaceLocation: string,
    folderNameOfReport: string,
    fileNameOfReport: string,
    downloadResponse: AxiosResponse<any>
): Promise<string | null> {
    try {
        const filePath = path.join(workspaceLocation, folderNameOfReport, fileNameOfReport);
        const uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.writeFile(uri, new Uint8Array(downloadResponse.data));
        logger.debug(`Report saved to ${uri.fsPath}`);
        return uri.fsPath;
    } catch (error) {
        const msg = `Failed to save report file: ${(error as Error).message}`;
        logger.error(msg);
        vscode.window.showErrorMessage(msg);
        return null;
    }
}

/**
 * Prompts the user to select a save location and stores the report file.
 *
 * @param fileNameOfReport The name of the report file.
 * @param downloadResponse The Axios response containing the file data.
 * @returns The absolute file path if successful, otherwise null.
 */
async function promptUserForSaveLocationAndSaveReportToFile(
    fileNameOfReport: string,
    downloadResponse: AxiosResponse<any>
): Promise<string | null> {
    logger.debug("Prompting user to select a save location for the report file.");
    const zipUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(fileNameOfReport),
        filters: { "Zip Files": ["zip"] },
        title: "Select a location to save the report file"
    });
    if (!zipUri) {
        logger.debug("User cancelled save location selection.");
        return null;
    }
    try {
        let fileExists = false;
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
                const msg = "File download skipped by the user.";
                vscode.window.showInformationMessage(msg);
                logger.debug(msg);
                return null;
            }
        }

        // Write the file to the chosen location
        await vscode.workspace.fs.writeFile(zipUri, new Uint8Array(downloadResponse.data));
        logger.debug(`Report saved to ${zipUri.fsPath}`);
        return zipUri.fsPath;
    } catch (error) {
        const msg = `Failed to save report: ${(error as Error).message}`;
        logger.error(msg);
        vscode.window.showErrorMessage(msg);
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
 * @param projectKey The project key.
 * @param cycleKey The cycle key.
 * @param folderNameToDownloadReport The folder name where the report should be saved.
 * @param requestParameters Optional request parameters (e.g. execution-based, tree root UID).
 * @param progress Optional VS Code progress reporter.
 * @param cancellationToken Optional cancellation token.
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
            "report",
            progress,
            cancellationToken
        );
        if (!jobStatus || !isReportJobCompletedSuccessfully(jobStatus)) {
            const msg = "Report generation was unsuccessful.";
            logger.warn(msg);
            vscode.window.showErrorMessage(msg);
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
 * @param selectedProjectManagementTreeItem The selected tree item.
 * @param projectManagementTreeDataProvider The project management tree data provider.
 * @param workingDirectoryToStoreReport The directory where the report will be stored.
 * @returns {Promise<void | null>} Resolves when the report is successfully downloaded, otherwise null
 */
export async function fetchReportForTreeElement(
    selectedProjectManagementTreeItem: projectManagementTreeView.ProjectManagementTreeItem,
    projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null,
    workingDirectoryToStoreReport: string
): Promise<void | null> {
    logger.debug(`Fetch Report called for ${selectedProjectManagementTreeItem.label}.`);
    // Show progress bar in VS Code
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Fetching Report for ${selectedProjectManagementTreeItem.label}`,
            cancellable: true
        },
        async (progress) => {
            progress.report({ increment: 30, message: "Selecting report parameters." });
            logger.debug("Fetching report for tree item:", selectedProjectManagementTreeItem);

            try {
                if (!connection) {
                    logger.warn("No connection available, cannot fetch report.");
                    return null;
                }
                if (!projectManagementTreeDataProvider) {
                    logger.warn("Project management tree not initialized, cannot fetch report.");
                    return null;
                }
                const projectKeyOfProjectInView = projectManagementTreeDataProvider.currentProjectKeyInView;
                if (!projectKeyOfProjectInView) {
                    logger.warn("No project selected, cannot fetch report.");
                    return null;
                }
                // Find the cycle key associated with the selected tree item to fetch the report
                const cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(selectedProjectManagementTreeItem);
                if (!cycleKey) {
                    logger.warn("Cycle key not found, cannot fetch report.");
                    return null;
                }
                const treeElementUID = selectedProjectManagementTreeItem.item?.base?.uniqueID;
                const executionBased = true; // For now, defaulting to execution based
                // await isExecutionBasedReportSelected();
                const cycleStructureOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter = {
                    basedOnExecution: executionBased,
                    treeRootUID: treeElementUID
                };

                progress.report({ increment: 30, message: "Fetching report." });
                const downloadedReportZipFilePath = await fetchReportZipFromServer(
                    projectKeyOfProjectInView,
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
 * @param context The VS Code extension context.
 * @param selectedTreeItem The selected tree item.
 * @param folderNameOfTestbenchWorkingDirectory The testbench working directory folder name.
 * @returns {Promise<void | null>} Resolves when test generation is complete, or null if errors occur.
 */
export async function generateRobotFrameworkTestsForTestThemeOrTestCaseSet(
    context: vscode.ExtensionContext,
    selectedTreeItem: projectManagementTreeView.ProjectManagementTreeItem,
    folderNameOfTestbenchWorkingDirectory: string
): Promise<void | null> {
    logger.debug("Generating tests for non-cycle element:", selectedTreeItem);
    const treeElementUID = selectedTreeItem.item?.base?.uniqueID;
    const cycleKey = projectManagementTreeView.findCycleKeyOfTreeElement(selectedTreeItem);
    const projectKey = projectManagementTreeView.findProjectKeyOfCycleElement(selectedTreeItem.parent!);

    if (!projectKey || !cycleKey || !treeElementUID) {
        logger.error(`Missing project key (${projectKey}), cycle key (${cycleKey}) or UID (${treeElementUID}).`);
        return null;
    }

    const workspace = await utils.validateAndReturnWorkspaceLocation();
    if (!workspace) {
        return null;
    }

    await generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
        context,
        selectedTreeItem,
        typeof selectedTreeItem.label === "string" ? selectedTreeItem.label : "", // Label might be undefined
        projectKey,
        cycleKey,
        folderNameOfTestbenchWorkingDirectory,
        treeElementUID
    );
}

/**
 * Generates Robot Framework tests using testbench2robotframework library.
 *
 * @param context The VS Code extension context.
 * @param selectedTreeItem The selected tree item.
 * @param itemLabel The label of the selected item.
 * @param projectKey The project key.
 * @param cycleKey The cycle key.
 * @param folderNameOfTestbenchWorkingDirectory The working directory folder name.
 * @param UIDofTestThemeElementToGenerateTestsFor Optional unique ID for the test theme element.
 * @returns {Promise<void | null>} Resolves when tests are generated, or null if an error occurs.
 */
export async function generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
    context: vscode.ExtensionContext,
    selectedTreeItem: projectManagementTreeView.ProjectManagementTreeItem,
    itemLabel: string,
    projectKey: string,
    cycleKey: string,
    folderNameOfTestbenchWorkingDirectory: string,
    UIDofTestThemeElementToGenerateTestsFor?: string
): Promise<void | null> {
    try {
        logger.debug("Generating tests for:", selectedTreeItem);
        const isReportGenerationExecutionBased = true; // Defaulting to execution based for now.
        const UIDofSelectedTreeElement =
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
                    folderNameOfTestbenchWorkingDirectory,
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
    if (treeItem.item?.elementType === "TestThemeNode") {
        // Extract the name, unique ID, and numbering of the TestThemeNode
        const { name = "Unnamed", uniqueID = "No ID", numbering } = treeItem.item.base || {};
        foundTestThemes.push({ name, uniqueID, numbering });
    }
    // Recursively search for TestThemeNodes in the children of the tree item
    if (Array.isArray(treeItem.children)) {
        treeItem.children.forEach((child: projectManagementTreeView.ProjectManagementTreeItem) =>
            findAllTestThemeNodesOfTreeItem(child, foundTestThemes)
        );
    }
    return foundTestThemes;
}

/**
 * Runs the Robot Framework test generation process with progress reporting.
 *
 * @param context The VS Code extension context.
 * @param projectKey The project key.
 * @param cycleKey The cycle key.
 * @param executionBased Whether the report is execution-based.
 * @param folderNameOfTestbenchWorkingDirectory The working directory folder name.
 * @param UID The UID of the selected element.
 * @param cycleStructureOptionsRequestParams Request parameters for the cycle report.
 * @param progress The VS Code progress reporter.
 * @param cancellationToken The cancellation token.
 * @returns {Promise<void | null>} Resolves when the process completes, or null if errors occur.
 */
async function runRobotFrameworkTestGenerationProcess(
    context: vscode.ExtensionContext,
    projectKey: string,
    cycleKey: string,
    executionBased: boolean,
    folderNameOfTestbenchWorkingDirectory: string,
    UID: string,
    cycleStructureOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken: vscode.CancellationToken
): Promise<void | null> {
    progress.report({ increment: 30, message: "Fetching JSON Report from the server." });
    const downloadedZip = await fetchReportZipFromServer(
        projectKey,
        cycleKey,
        folderNameOfTestbenchWorkingDirectory,
        cycleStructureOptionsRequestParams,
        progress,
        cancellationToken
    );
    if (!downloadedZip) {
        logger.warn("Download cancelled or failed.");
        return null;
    }
    progress.report({ increment: 30, message: "Generating tests via testbench2robotframework." });

    const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
    if (!workspaceLocation) {
        const workspaceLocationMissingErrorMessage = "Workspace location not configured.";
        logger.error(workspaceLocationMissingErrorMessage);
        vscode.window.showErrorMessage(workspaceLocationMissingErrorMessage);
        return null;
    }
    const testbenchWorkingDirectoryPathInsideWorkspace = path.join(
        workspaceLocation,
        folderNameOfTestbenchWorkingDirectory
    );
    const isTb2RobotframeworkGenerateTestsCommandSuccessful =
        await testbench2robotframeworkLib.tb2robotLib.startTb2robotframeworkTestGeneration(
            context,
            testbenchWorkingDirectoryPathInsideWorkspace,
            downloadedZip
        );
    await cleanUpReportFileIfConfiguredInSettings(downloadedZip);
    if (!isTb2RobotframeworkGenerateTestsCommandSuccessful) {
        const testGenerationFailedMessage = "Test generation failed.";
        logger.error(testGenerationFailedMessage);
        vscode.window.showErrorMessage(testGenerationFailedMessage);
        return null;
    }
    updateLastGeneratedReportParams(UID, projectKey, cycleKey, executionBased);
    vscode.window.showInformationMessage("Robot Framework test generation successful.");
    logger.debug("Test generation successful.");
    await vscode.commands.executeCommand("workbench.view.extension.test");
}

/**
 * Updates the last generated report parameters.
 *
 * @param UID The unique ID.
 * @param projectKey The project key.
 * @param cycleKey The cycle key.
 * @param executionBased Whether the report is execution-based.
 */
function updateLastGeneratedReportParams(
    UID: string,
    projectKey: string,
    cycleKey: string,
    executionBased: boolean
): void {
    logger.debug(
        `Updating last generated report params: UID=${UID}, projectKey=${projectKey}, cycleKey=${cycleKey}, executionBased=${executionBased}.`
    );
    lastGeneratedReportParams.UID = UID;
    lastGeneratedReportParams.projectKey = projectKey;
    lastGeneratedReportParams.cycleKey = cycleKey;
    lastGeneratedReportParams.executionBased = executionBased;
}

/**
 * Removes the report zip file if configured in the extension settings.
 *
 * @param reportZipFilePath The path of the report zip file.
 */
export async function cleanUpReportFileIfConfiguredInSettings(reportZipFilePath: string): Promise<void> {
    if (getConfig().get<boolean>("clearReportAfterProcessing")) {
        await removeReportZipFile(reportZipFilePath);
    } else {
        logger.debug("Report ZIP file removal skipped per the extension settings.");
    }
}

/**
 * Removes the specified zip file with retry logic.
 *
 * @param zipFileFullPath The full path of the zip file.
 * @param maxRetries Maximum number of retries.
 * @param delayMs Delay between retries in milliseconds.
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
                logger.error(`File not found: ${zipFileFullPath}`);
                vscode.window.showWarningMessage(`File not found: ${zipFileFullPath}`);
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
 * @param directoryToSearchInside The directory to search.
 * @param fileNameToSearch The file name to search for.
 * @returns {string | null} The full path of the file if found, otherwise null.
 */
export async function findFileRecursivelyInDirectory(
    directoryToSearchInside: string,
    fileNameToSearch: string
): Promise<string | null> {
    try {
        logger.debug(`Searching for "${fileNameToSearch}" in "${directoryToSearchInside}" recursively.`);
        const allFileNamesInsideDirectory = await fsPromise.readdir(directoryToSearchInside);
        for (const currentFileName of allFileNamesInsideDirectory) {
            const pathOfCurrentFile = path.join(directoryToSearchInside, currentFileName);
            const stat = await fsPromise.stat(pathOfCurrentFile);
            if (stat.isDirectory()) {
                const foundSearchResult = await findFileRecursivelyInDirectory(pathOfCurrentFile, fileNameToSearch);
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
 * @param workingDirectoryPath The working directory path.
 * @returns {Promise<string | null>} The absolute path of the selected output XML file, or null if none selected.
 */
async function chooseRobotOutputXMLFileIfNotSet(workingDirectoryPath: string): Promise<string | null> {
    logger.debug(`Choosing output XML file using working directory: ${workingDirectoryPath}`);

    // Open file selection dialog to select the output xml file, display only XML files in the selection.
    // To use relative paths to workspace location in extension settings,
    // we need to get the workspace location to construct the full path of outputXmlFilePath.
    const outputXMLFileRelativePathInExtensionSettings = getConfig().get<string>("outputXmlFilePath");
    const outputXMLFileAbsolutePath = await utils.constructAbsolutePathFromRelativePath(
        outputXMLFileRelativePathInExtensionSettings,
        true
    );
    if (outputXMLFileAbsolutePath) {
        return outputXMLFileAbsolutePath;
    }
    logger.trace("Prompting user to select output XML file manually.");
    // Get the first workspace folder path, if available
    const firstWorkspaceFolderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // Determine which path to use as the default URI for the file selection dialog
    const defaultUri = firstWorkspaceFolderPath
        ? vscode.Uri.file(firstWorkspaceFolderPath) // Try using the first workspace folder first
        : workingDirectoryPath
          ? vscode.Uri.file(workingDirectoryPath) // Fall back to the working directory
          : vscode.Uri.file(os.homedir()); // Final fallback to the user's home directory if none of the above are available
    logger.trace(`Default URI for XML selection: ${defaultUri.fsPath}`);

    // Output XML was not set in the extension settings. Open file selection dialog.
    const selected = await vscode.window.showOpenDialog({
        defaultUri: defaultUri,
        canSelectFiles: true,
        canSelectMany: false,
        title: "Select Output XML File",
        openLabel: "Select Output XML File",
        filters: { "XML Files": ["xml"] }
    });
    // Return the selected file path if a file was chosen
    if (selected && selected.length > 0) {
        logger.debug(`Output XML file selected: ${selected[0].fsPath}`);
        return selected[0].fsPath;
    }
    logger.error("No output XML file selected.");
    return null;
}

/**
 * Checks if the given file path is absolute and exists.
 *
 * @param filePath The file path.
 * @returns {Promise<boolean>} True if the file path is absolute and exists; otherwise false.
 */
export async function isAbsolutePathAndExists(filePath: string): Promise<boolean> {
    try {
        logger.trace(`Checking if "${filePath}" is absolute and exists.`);
        if (path.isAbsolute(filePath)) {
            await fsPromise.access(filePath);
            logger.trace(`"${filePath}" is absolute and exists.`);
            return true;
        }
        logger.trace(`"${filePath}" is not absolute or does not exist.`);
        return false;
    } catch {
        logger.trace(`"${filePath}" is not absolute or does not exist.`);
        return false;
    }
}

/**
 * Checks if the given file path is absolute.
 *
 * @param filePath The file path.
 * @returns {Promise<boolean>} True if the file path is absolute; otherwise false.
 */
export async function isAbsolutePath(filePath: string): Promise<boolean> {
    try {
        logger.trace(`Checking if "${filePath}" is absolute.`);
        const absolute = path.isAbsolute(filePath);
        logger.trace(`"${filePath}" is ${absolute ? "" : "not "}an absolute path.`);
        return absolute;
    } catch {
        logger.trace(`"${filePath}" is not an absolute path.`);
        return false;
    }
}

/**
 * Prompts the user to select a report zip file (without test results).
 *
 * @param workingDirectoryPath The working directory.
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
 * @param context The extension context.
 * @param folderNameOfTestbenchWorkingDirectory The testbench working directory folder name.
 * @param currentProgress Optional progress reporter.
 * @returns {Promise<string | undefined>} The absolute path of the created report zip file, or undefined on error.
 * Undefined is returned (and not null) due to the usage of VSCode progress bar.
 */
export async function fetchTestResultsAndCreateReportWithResultsWithTb2Robot(
    context: vscode.ExtensionContext,
    folderNameOfTestbenchWorkingDirectory: string,
    currentProgress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<string | undefined> {
    try {
        logger.debug("Started fetching test results and creating report with results.");

        const executeWithProgress = async (
            progress: vscode.Progress<{ message?: string; increment?: number }>
        ): Promise<string | undefined> => {
            const reportIncrement = currentProgress ? 6 : 20;
            const reportProgress = (msg: string, inc: number) => progress.report({ message: msg, increment: inc });

            reportProgress("Choosing result XML file.", reportIncrement);
            const reportWithResultsZipName = `ReportWithResults_${Date.now()}.zip`;
            const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
            if (!workspaceLocation) {
                logger.error("Workspace location not configured.");
                return undefined;
            }
            const testbenchWorkingDirectoryPathInsideWorkspace = path.join(
                workspaceLocation,
                folderNameOfTestbenchWorkingDirectory
            );
            const outputXMLPath = await chooseRobotOutputXMLFileIfNotSet(workspaceLocation);
            if (!outputXMLPath) {
                return undefined;
            }
            logger.debug(`Report zip file will be named ${reportWithResultsZipName}`);
            reportProgress("Fetching report.", reportIncrement);

            if (
                !lastGeneratedReportParams.executionBased ||
                !lastGeneratedReportParams.projectKey ||
                !lastGeneratedReportParams.cycleKey ||
                !lastGeneratedReportParams.UID
            ) {
                logger.error("Last generated report parameters are missing.");
                return undefined;
            }

            const cycleStructureOptionsRequestParams: testBenchTypes.OptionalJobIDRequestParameter = {
                basedOnExecution: lastGeneratedReportParams.executionBased,
                treeRootUID: lastGeneratedReportParams.UID
            };

            const downloadedReportWithoutResultsZip = await fetchReportZipFromServer(
                lastGeneratedReportParams.projectKey,
                lastGeneratedReportParams.cycleKey,
                folderNameOfTestbenchWorkingDirectory,
                cycleStructureOptionsRequestParams
            );
            reportProgress("Working on report.", reportIncrement / 2);
            const reportWithResultsZipFullPath = path.join(
                testbenchWorkingDirectoryPathInsideWorkspace,
                reportWithResultsZipName
            );
            const isTb2RobotFetchResultsExecutionSuccessful =
                await testbench2robotframeworkLib.tb2robotLib.startTb2robotFetchResults(
                    context,
                    testbenchWorkingDirectoryPathInsideWorkspace,
                    outputXMLPath,
                    downloadedReportWithoutResultsZip ??
                        (await chooseReportWithoutResultsZipFile(testbenchWorkingDirectoryPathInsideWorkspace))!,
                    reportWithResultsZipFullPath
                );
            await cleanUpReportFileIfConfiguredInSettings(downloadedReportWithoutResultsZip!);
            if (!isTb2RobotFetchResultsExecutionSuccessful) {
                const testResultsImportError = "Fetching test results failed. Please check the output.xml file.";
                logger.error(testResultsImportError);
                vscode.window.showErrorMessage(testResultsImportError);
                return undefined;
            }
            logger.debug(`Report with results created at: ${reportWithResultsZipFullPath}`);
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
        const msg = `An error occurred: ${(error as Error).message}`;
        vscode.window.showErrorMessage(msg);
        logger.error("Error in fetchTestResultsAndCreateReportWithResultsWithTb2Robot:", error);
        return undefined;
    }
}

/**
 * Reads test results, creates a report zip with results, and imports it to the TestBench server.
 *
 * @param context The extension context.
 * @param folderNameOfTestbenchWorkingDirectory The testbench working directory folder name.
 * @param projectManagementTreeDataProvider The project management tree data provider.
 */
export async function fetchTestResultsAndCreateResultsAndImportToTestbench(
    context: vscode.ExtensionContext,
    folderNameOfTestbenchWorkingDirectory: string,
    projectManagementTreeDataProvider: projectManagementTreeView.ProjectManagementTreeDataProvider | null
): Promise<void | null> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Reading Test Results and Creating Report",
            cancellable: true
        },
        async (progress) => {
            if (!connection) {
                const msg = "No connection available. Cannot import report.";
                vscode.window.showErrorMessage(msg);
                logger.warn(msg);
                return null;
            }
            if (!projectManagementTreeDataProvider || !projectManagementTreeDataProvider.currentProjectKeyInView) {
                const msg = "Project key is missing. Cannot import report.";
                vscode.window.showErrorMessage(msg);
                logger.warn(msg);
                return null;
            }
            progress.report({ message: "Reading Test Results and Creating Report.", increment: 25 });
            const pathOfCreatedReportWithResults = await fetchTestResultsAndCreateReportWithResultsWithTb2Robot(
                context,
                folderNameOfTestbenchWorkingDirectory,
                progress
            );
            if (!pathOfCreatedReportWithResults) {
                logger.error("Error creating report with results.");
                return null;
            }
            progress.report({ message: "Importing report to TestBench.", increment: 25 });
            await importReportWithResultsToTestbench(
                connection,
                projectManagementTreeDataProvider,
                pathOfCreatedReportWithResults
            );
            progress.report({ message: "Cleaning up.", increment: 25 });
            await cleanUpReportFileIfConfiguredInSettings(pathOfCreatedReportWithResults);
        }
    );
}

/**
 * Starts test generation for a cycle.
 *
 * @param context The extension context.
 * @param selectedCycleTreeItem The selected cycle tree item.
 * @param baseKey The extension base key.
 */
export async function startTestGenerationForCycle(
    context: vscode.ExtensionContext,
    selectedCycleTreeItem: projectManagementTreeView.ProjectManagementTreeItem,
    folderName: string
): Promise<void | null> {
    try {
        if (!connection) {
            const connectionErrorMessage = "No connection available. Cannot generate tests for cycle.";
            vscode.window.showErrorMessage(connectionErrorMessage);
            logger.warn(connectionErrorMessage);
            return null;
        }
        const cycleKey = selectedCycleTreeItem.item.key;
        if (!cycleKey) {
            const cycleKeyMissingMessage = "Cycle key is missing for test generation.";
            logger.error(cycleKeyMissingMessage);
            return null;
        }
        const projectKey = projectManagementTreeView.findProjectKeyOfCycleElement(selectedCycleTreeItem);
        if (!projectKey) {
            const projectKeyMissingMessage = "Project key of cycle is missing.";
            logger.error(projectKeyMissingMessage);
            return null;
        }
        if (typeof selectedCycleTreeItem.label !== "string") {
            const invalidLabelTypeMessage = "Invalid label type. Test generation aborted.";
            logger.error(invalidLabelTypeMessage);
            return null;
        }
        const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return null;
        }
        await generateRobotFrameworkTestsWithTestBenchToRobotFrameworkLibrary(
            context,
            selectedCycleTreeItem,
            selectedCycleTreeItem.label,
            projectKey,
            cycleKey,
            folderName,
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
 * @param configFilePath The full path of the configuration file.
 * @param maxRetries Maximum number of retries.
 * @param delayMs Delay between retries in milliseconds.
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
