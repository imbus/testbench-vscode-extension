import * as vscode from "vscode";
import { PlayServerConnection } from "./testBenchConnection.ts";
import { ProjectManagementTreeItem } from "./projectManagementTreeView.ts";
export interface Configuration {
    generationDirectory: string;
    clearGenerationDirectory: boolean;
    createOutputZip: boolean;
    removeExtractedFiles: boolean;
}
export interface TestCase {
    uniqueID: string;
    name: string;
    steps: string[];
}
export interface TestSuite {
    themeID: string;
    testCases: TestCase[];
}
interface ReportRequestParams {
    treeRootUID?: string;
    basedOnExecution?: boolean;
    suppressFilteredData?: boolean;
    suppressNotExecutable?: boolean;
    suppressEmptyTestThemes?: boolean;
    filters?: {
        name: string;
        filterType: "TestTheme";
        testThemeUID: string;
    }[];
}
export interface JobStatusResponse {
    id: string;
    projectKey: string;
    owner: string;
    start: string;
    completion: {
        time: string;
        result: {
            Success?: {
                reportName: string;
            };
        };
    };
}
export declare function extractTextFromHtml(htmlContent: string): string;
export declare function isJobCompletedSuccessfully(jobStatus: JobStatusResponse): boolean;
export declare function fetchZipFile(connection: PlayServerConnection, baseKey: string, projectKey: string, cycleKey: string, progress: vscode.Progress<{
    message?: string;
    increment?: number;
}>, requestParams?: ReportRequestParams, cancellationToken?: vscode.CancellationToken): Promise<string | undefined>;
export declare function delay(ms: number): Promise<void>;
export declare function extractZip(zipFilePath: string, outputDir: string, extractOnlyJson?: boolean): Promise<void>;
export declare function loadJsonFilesFromDirectory(dir: string): string[];
export declare function parseJsonFile(filePath: string): any;
export declare function processTestCaseFile(filePath: string): TestCase | null;
export declare function createTestSuitesFromFiles(files: string[]): TestSuite[];
export declare function writeRobotFrameworkTestSuites(testSuites: TestSuite[], config: Configuration): Promise<void>;
export declare function testBenchToRobotFramework(itemLabel: string, baseKey: string, projectKey: string, cycleKey: string, connection: PlayServerConnection): Promise<void>;
export declare function startTestGenerationProcess(treeItem: ProjectManagementTreeItem, connection: PlayServerConnection, baseKey: string): Promise<never[] | undefined>;
export declare function isValidTestJSON(jsonData: any): boolean;
export declare function createOutputFolderIfNotExists(outputFolder: string): void;
export {};
