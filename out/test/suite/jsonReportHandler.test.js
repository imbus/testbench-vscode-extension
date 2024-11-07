"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const sinon = __importStar(require("sinon"));
const vscode = __importStar(require("vscode"));
const jsonReportHandler = __importStar(require("../../jsonReportHandler"));
const axios_1 = __importDefault(require("axios"));
const testbenchConnection_1 = require("../../testbenchConnection");
suite("jsonReportHandler Tests", () => {
    let sandbox;
    let context;
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
            workspaceState: {},
            globalState: {},
            extensionUri: {},
            extensionPath: "",
            environmentVariableCollection: {},
            storagePath: "",
            globalStoragePath: "",
            logPath: "",
            logUri: {},
            storageUri: {},
            globalStorageUri: {},
            logLevel: vscode.LogLevel.Info,
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (relativePath) => relativePath,
        };
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
        const jobStatus = {
            completion: {
                result: {
                    ReportingSuccess: {
                        reportName: "report.zip",
                    },
                },
            },
        };
        const result = jsonReportHandler.isReportJobCompletedSuccessfully(jobStatus);
        assert.strictEqual(result, true);
    });
    test("isReportJobCompletedSuccessfully should return false for unsuccessful report job", () => {
        const jobStatus = {
            completion: {
                result: {},
            },
        };
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
        const connection = new testbenchConnection_1.PlayServerConnection(context, url, port, sessionToken);
        const cancellationToken = { isCancellationRequested: true };
        try {
            await jsonReportHandler.pollJobStatus(connection, projectKey, "jobId", "report", undefined, cancellationToken);
            assert.fail("Expected error was not thrown");
        }
        catch (error) {
            assert.ok(error instanceof vscode.CancellationError);
        }
    });
    test("getJobId should return job ID from server", async () => {
        const connection = new testbenchConnection_1.PlayServerConnection(context, url, port, sessionToken);
        const jobIdResponse = { data: { jobID: "jobId" }, status: 200 };
        sandbox.stub(axios_1.default, "post").resolves(jobIdResponse);
        const result = await jsonReportHandler.getJobId(connection, projectKey, cycleKey);
        assert.strictEqual(result, "jobId");
    });
    test("getJobStatus should return job status from server", async () => {
        const connection = new testbenchConnection_1.PlayServerConnection(context, url, port, sessionToken);
        const jobStatusResponse = { data: { completion: { result: {} } }, status: 200 };
        sandbox.stub(axios_1.default, "get").resolves(jobStatusResponse);
        const result = await jsonReportHandler.getJobStatus(connection, projectKey, "jobId", "report");
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
//# sourceMappingURL=jsonReportHandler.test.js.map