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
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const jsonReportHandler = __importStar(require("../../jsonReportHandler"));
const vscode = __importStar(require("vscode"));
// Mock data for testing
const mockHtmlContent = "<html><body><p>Test Content</p></body></html>";
const mockJobStatusResponse = {
    id: "1",
    projectKey: "projectKey",
    owner: "owner",
    start: "start",
    progress: {
        totalItemsCount: 0,
        handledItemsCount: 0
    },
    completion: {
        time: "time",
        result: {
            ReportingSuccess: {
                reportName: "reportName"
            }
        }
    }
};
suite('jsonReportHandler Tests', () => {
    suiteTeardown(() => {
        vscode.window.showInformationMessage('All tests done!');
    });
    test('extractTextFromHtml should extract text content from HTML', () => {
        const result = jsonReportHandler.extractTextFromHtml(mockHtmlContent);
        assert.strictEqual(result, "Test Content");
    });
    test('isJobCompletedSuccessfully should return true for successful job status', () => {
        const result = jsonReportHandler.isJobCompletedSuccessfully(mockJobStatusResponse);
        assert.strictEqual(result, true);
    });
    test('isJobCompletedSuccessfully should return false for unsuccessful job status', () => {
        const incompleteJobStatusResponse = { ...mockJobStatusResponse, completion: { time: "time", result: {} } };
        const result = jsonReportHandler.isJobCompletedSuccessfully(incompleteJobStatusResponse);
        assert.strictEqual(result, false);
    });
    test('delay should delay execution for specified time', async () => {
        const start = Date.now();
        await jsonReportHandler.delay(100);
        const end = Date.now();
        assert.ok(end - start >= 100);
    });
    /*
    test('createOutputFolderIfNotExists should create folder if it does not exist', () => {
        const testFolderPath = 'C:\\tmp\\testFolder';
        jsonReportHandler.createOutputFolderIfNotExists(testFolderPath);
        assert.ok(fs.existsSync(testFolderPath));
        fs.rmdirSync(testFolderPath);
    });
    */
    test('isValidTestJSON should validate JSON structure', () => {
        const validJson = { interactions: [], parameters: [] };
        const invalidJson = { invalidField: [] };
        assert.strictEqual(jsonReportHandler.isValidTestJSON(validJson), true);
        assert.strictEqual(jsonReportHandler.isValidTestJSON(invalidJson), false);
    });
});
//# sourceMappingURL=jsonReportHandler.test.js.map