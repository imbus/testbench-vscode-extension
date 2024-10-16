import * as assert from 'assert';
import * as jsonReportHandler from '../jsonReportHandler';
import * as fs from "fs";

// Mock data for testing
const mockHtmlContent = "<html><body><p>Test Content</p></body></html>";
const mockJobStatusResponse: jsonReportHandler.JobStatusResponse = {
    id: "1",
    projectKey: "projectKey",
    owner: "owner",
    start: "start",
    completion: {
        time: "time",
        result: {
            Success: {
                reportName: "reportName"
            }
        }
    }
};

suite('jsonReportHandler Tests', () => {
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

    test('createOutputFolderIfNotExists should create folder if it does not exist', () => {
        const testFolderPath = '/tmp/testFolder';
        jsonReportHandler.createOutputFolderIfNotExists(testFolderPath);
        assert.ok(fs.existsSync(testFolderPath));
        fs.rmdirSync(testFolderPath);
    });

    test('isValidTestJSON should validate JSON structure', () => {
        const validJson = { interactions: [], parameters: [] };
        const invalidJson = { invalidField: [] };
        assert.strictEqual(jsonReportHandler.isValidTestJSON(validJson), true);
        assert.strictEqual(jsonReportHandler.isValidTestJSON(invalidJson), false);
    });
});
