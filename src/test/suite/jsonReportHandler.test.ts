import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as jsonReportHandler from "../../reportHandler";
import * as types from "../../types";
import axios from "axios";
import * as fs from "fs";
import { PlayServerConnection } from "../../testBenchConnection";
import { ProjectManagementTreeItem } from "../../projectManagementTreeView";

suite("jsonReportHandler Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let context: vscode.ExtensionContext;
    let url = "http://example.com";
    let port = 1234;
    let sessionToken = "mockSessionToken";
    let projectKey = "30";
    let cycleKey = "179";

    setup(() => {
        sandbox = sinon.createSandbox();

        context = {
            secrets: {
                get: sinon.stub().resolves("mockSessionToken"),
                store: sinon.stub().resolves(),
                delete: sinon.stub().resolves(),
            },
            subscriptions: [],
            workspaceState: {} as any,
            globalState: {} as any,
            extensionUri: {} as any,
            extensionPath: "",
            environmentVariableCollection: {} as any,
            storagePath: "",
            globalStoragePath: "",
            logPath: "",
            logUri: {} as any,
            storageUri: {} as any,
            globalStorageUri: {} as any,
            logLevel: vscode.LogLevel.Info,
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (relativePath: string) => relativePath,
        } as unknown as vscode.ExtensionContext;
    });

    teardown(() => {
        sandbox.restore();
        vscode.window.showInformationMessage("All tests done!");
    });

    /*
    test("isExecutionBasedReportSelected should return false for Specification based", async () => {
        const result = await jsonReportHandler.isExecutionBasedReportSelected();
        assert.strictEqual(result, false);
    });

    test("isExecutionBasedReportSelected should return null for Cancel", async () => {
        const result = await jsonReportHandler.isExecutionBasedReportSelected();
        assert.strictEqual(result, null);
    });
    */

    test("isReportJobCompletedSuccessfully should return true for successful report job", () => {
        const jobStatus: types.JobStatusResponse = {
            completion: {
                result: {
                    ReportingSuccess: {
                        reportName: "report.zip",
                    },
                },
            },
        } as any;

        const result = jsonReportHandler.isReportJobCompletedSuccessfully(jobStatus);
        assert.strictEqual(result, true);
    });

    test("isReportJobCompletedSuccessfully should return false for unsuccessful report job", () => {
        const jobStatus: types.JobStatusResponse = {
            completion: {
                result: {},
            },
        } as any;

        const result = jsonReportHandler.isReportJobCompletedSuccessfully(jobStatus);
        assert.strictEqual(result, false);
    });

    /*
    test("fetchZipFile should return undefined if report generation is unsuccessful", async () => {
        const connection = new PlayServerConnection(context, url, port, sessionToken);
        const progress = { report: sinon.stub() };
        const jobStatus: types.JobStatusResponse = {
            completion: {
                result: {},
            },
        } as any;

        sandbox.stub(jsonReportHandler, "getJobId").resolves("jobId");
        sandbox.stub(jsonReportHandler, "pollJobStatus").resolves(jobStatus);
        sandbox.stub(vscode.window, "showErrorMessage").resolves();

        const result = await jsonReportHandler.fetchZipFile(
            connection,
            "baseKey",
            projectKey,
            cycleKey,
            progress as any,
            "folderNameToDownloadReport"
        );

        assert.strictEqual(result, undefined);
    });

    test("fetchZipFile should return the path of the downloaded zip file if successful", async () => {
        const connection = new PlayServerConnection(context, url, port, sessionToken);
        const progress = { report: sinon.stub() };
        const jobStatus: types.JobStatusResponse = {
            completion: {
                result: {
                    ReportingSuccess: {
                        reportName: "report.zip",
                    },
                },
            },
        } as any;

        sandbox.stub(jsonReportHandler, "getJobId").resolves("jobId");
        sandbox.stub(jsonReportHandler, "pollJobStatus").resolves(jobStatus);
        sandbox.stub(jsonReportHandler, "downloadReport").resolves("path/to/report.zip");

        const result = await jsonReportHandler.fetchZipFile(
            connection,
            "baseKey",
            projectKey,
            cycleKey,
            progress as any,
            "folderNameToDownloadReport"
        );

        assert.strictEqual(result, "path/to/report.zip");
    });

    test("pollJobStatus should return job status if job is completed successfully", async () => {
        const context = {
            secrets: {
                get: sinon.stub().resolves("mockSessionToken"),
                store: sinon.stub().resolves(),
                delete: sinon.stub().resolves(),
            },
        } as unknown as vscode.ExtensionContext;

        const connection = new PlayServerConnection(context, url, port, sessionToken);
        const jobStatus: types.JobStatusResponse = {
            completion: {
                result: {
                    ReportingSuccess: {
                        reportName: "report.zip",
                    },
                },
            },
        } as any;

        sandbox.stub(jsonReportHandler, "getJobStatus").resolves(jobStatus);

        const result = await jsonReportHandler.pollJobStatus(connection, "projectKey", "jobId", "report");

        assert.strictEqual(result, jobStatus);
    });
    */
    test("pollJobStatus should throw CancellationError if operation is cancelled", async () => {
        const connection = new PlayServerConnection(context, url, port, sessionToken);
        const cancellationToken = { isCancellationRequested: true } as vscode.CancellationToken;

        try {
            await jsonReportHandler.pollJobStatus(projectKey, "jobId", "report", undefined, cancellationToken);
            assert.fail("Expected error was not thrown");
        } catch (error) {
            assert.ok(error instanceof vscode.CancellationError);
        }
    });

    test("getJobId should return job ID from server", async () => {
        const connection = new PlayServerConnection(context, url, port, sessionToken);
        const jobIdResponse = { data: { jobID: "jobId" }, status: 200 } as any;

        sandbox.stub(axios, "post").resolves(jobIdResponse);

        const result = await jsonReportHandler.getJobId(projectKey, cycleKey);

        assert.strictEqual(result, "jobId");
    });

    test("getJobStatus should return job status from server", async () => {
        const connection = new PlayServerConnection(context, url, port, sessionToken);
        const jobStatusResponse = { data: { completion: { result: {} } }, status: 200 } as any;

        sandbox.stub(axios, "get").resolves(jobStatusResponse);

        const result = await jsonReportHandler.getJobStatus(projectKey, "jobId", "report");

        assert.deepStrictEqual(result, jobStatusResponse.data);
    });
    /*
    test("downloadReport should return the path of the downloaded file", async () => {
        const connection = new PlayServerConnection(context, url, port, sessionToken);
        const downloadZipResponse = { data: new ArrayBuffer(8), status: 200 } as any;

        sandbox.stub(axios, "get").resolves(downloadZipResponse);
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sinon.stub().returns("workspaceLocation"),
        } as any);
        sandbox.stub(fs, "existsSync").returns(true);
        sandbox.stub(vscode.workspace.fs, "writeFile").resolves();

        const result = await jsonReportHandler.downloadReport(
            connection,
            "baseKey",
            projectKey,
            "report.zip",
            "folderNameToDownloadReport"
        );

        assert.strictEqual(result, "workspaceLocation/folderNameToDownloadReport/report.zip");
    });*/
});
