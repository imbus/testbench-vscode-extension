/**
 * @file testBenchTypes.ts
 * @description This file contains TypeScript interfaces and type definitions
 * used throughout the project. These interfaces define the structure
 * of various data types, server response formats, API request parameters,
 * and other project-related types.
 *
 * The purpose of this file is to centralize and organize commonly used
 * type definitions for better code reusability, consistency, and maintainability.
 */

export interface TestBenchProfile {
    id: string; // Unique identifier for the profile
    label: string; // User-friendly name for the profile (e.g., "Dev Server")
    serverName: string;
    portNumber: number;
    username: string;
}

// Internal session representation
export interface ActiveTestBenchSessionInfo extends TestBenchProfile {
    sessionToken: string; // The TestBench API session token
}

export interface Testbench2robotframeworkConfiguration {
    "library-root": string[];
    "resource-root": string[];
    "fully-qualified": boolean;
    "output-directory": string;
    "log-suite-numbering": boolean;
    "resource-directory": string;
    clean: boolean;
    "compound-interaction-logging": string;
    "library-mapping": { [key: string]: string };
    "resource-mapping": { [key: string]: string };
    forcedImport: {
        libraries: string[];
        resources: string[];
        variables: string[];
    };
    testCaseSplitPathRegEx: string;
    "console-logging": {
        logLevel: string;
    };
    "file-logging": {
        logLevel: string;
    };
}

// Default configuration for Testbench2robotframework
export const defaultTestbench2robotframeworkConfig: Testbench2robotframeworkConfiguration = {
    "library-root": ["Interactions", "RF-Library"],
    "resource-root": ["RF-Resource"],
    "fully-qualified": false,
    "output-directory": "{workspaceFolder}/Generated",
    "log-suite-numbering": true,
    "resource-directory": "{workspaceFolder}/Resources",
    clean: true,
    "compound-interaction-logging": "GROUP",
    "library-mapping": {
        SeleniumLibrary: "SeleniumLibrary    timeout=10    implicit_wait=1    run_on_failure=Capture Page Screenshot",
        SuperRemoteLibrary: "Remote    http://127.0.0.1:8270       WITH NAME    SuperRemoteLibrary"
    },
    "resource-mapping": {
        MyKeywords: "{root}/../MyKeywords.resource",
        MyOtherKeywords: "{resourceDirectory}/subdir/MyOtherKeywords.resource"
    },
    forcedImport: {
        libraries: [],
        resources: [],
        variables: []
    },
    testCaseSplitPathRegEx: "^StopWithRestart\\..*",
    "console-logging": {
        logLevel: "debug"
    },
    "file-logging": {
        logLevel: "info"
    }
};

// Store the last successfully generated report parameters for test generation to be able to fetch the report again for read command
export interface LastGeneratedReportParams {
    UID: string;
    projectKey: string;
    cycleKey: string;
    executionBased: boolean;
    timestamp: number;
    alreadyImported: boolean;
}

export interface LastImportedReportDetails {
    outputXmlPath: string; // Path to the Robot Framework output.xml
    baseReportPath: string; // Path to the base report (without results)
    targetProjectKey: string;
    targetCycleKey: string;
    timestamp: number;
}

export interface CycleStructure {
    root: {
        base: {
            key: string;
            numbering: string;
            parentKey: string;
            name: string;
            uniqueID: string;
            matchesFilter: boolean;
        };
        filters: any[];
        elementType: string;
    };
    nodes: Array<{
        base: {
            key: string;
            numbering: string;
            parentKey: string;
            name: string;
            uniqueID: string;
            matchesFilter: boolean;
        };
        spec: {
            key: string;
            locker: string | null;
            status: string;
        };
        aut: {
            key: string;
            locker: string | null;
            status: string;
        };
        exec: {
            status: string;
            execStatus: string;
            verdict: string;
            key: string;
            locker: string | null;
        };
        filters: any[];
        elementType: string;
    }>;
}

export type CycleNodeData = {
    base: {
        key: string;
        numbering: string;
        parentKey: string;
        name: string;
        uniqueID: string;
        matchesFilter: boolean;
    };
    spec?: {
        // Optional
        key: string;
        locker: string | null;
        status: string;
    };
    aut?: {
        // Optional
        key: string;
        locker: string | null;
        status: string;
    };
    exec?: {
        // Optional
        status: string;
        execStatus: string;
        verdict: string;
        key: string;
        locker: string | null;
    };
    filters?: any[]; // Optional
    elementType: string; // e.g., TestThemeNode, TestCaseSetNode, TestCaseNode
};

// Interface for Test Case
export interface TestCase {
    uniqueID: string;
    name: string;
    steps: string[];
}

// Interface for Test Suite containing Test Cases
export interface TestSuite {
    themeID: string;
    testCases: TestCase[];
}

// Interface representing the optional request body parameters.
export interface OptionalJobIDRequestParameter {
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

// Interface representing the successful response from the server.
export interface JobIdResponse {
    jobID: string;
}

// Interface representing the successful response from the job status GET request.
export interface JobStatusResponse {
    id: string;
    projectKey: string;
    owner: string;
    start: string;
    progress?: {
        totalItemsCount: number;
        handledItemsCount: number;
    } | null;
    completion: {
        time: string;
        result: {
            ReportingSuccess?: {
                reportName: string;
            };
            ExecutionImportingFailure?: {
                error: {
                    code: number;
                    message: string;
                    description: string;
                };
            };
            ExecutionImportingSuccess?: {
                testCaseSets: Array<{
                    key: string;
                    executionKey: string;
                    finished: boolean;
                    error: {
                        code: number;
                        message: string;
                        description: string;
                    };
                    testCases: any[];
                }>;
            };
        };
    };
}

export interface Interaction {
    key: string;
    uniqueID: string;
    name: string;
    interactionType: string;
    path: string;
    spec: {
        callKey: string;
        sequencePhase: string;
        callType: string;
        description: string;
        comments: string;
        references: any[];
        preConditions: any[];
        postConditions: any[];
    };
    exec: {
        verdict: string;
        time: string;
        duration: number;
        currentUser: { key: string; name: string };
        tester: string | null;
        comments: string;
        references: any[];
    };
    parameters: ParameterOfInteraction[];
    interactions?: Interaction[];
}

export interface ParameterOfInteraction {
    dataType: {
        key: string;
        kind: string;
        name: string;
        path: string;
        uniqueID: string;
        version: string | null;
    };
    definitionType: string;
    key: string;
    name: string;
    evaluationType: string;
    value: string;
    valueType: string;
}

// New play server Project structure
export interface Project {
    key: string;
    creationTime: string;
    name: string;
    status: string;
    visibility: boolean;
    tovsCount: number;
    cyclesCount: number;
    description: string;
    lockerKey: string | null;
    startDate: string | null;
    endDate: string | null;
}

// New play server Tree node structure
export interface TreeNode {
    nodeType: string;
    key: string;
    name: string;
    creationTime: string;
    status: string;
    visibility: boolean;
    children?: TreeNode[]; // Not all nodes have children
}

// Define an interface for the server versions response
export interface ServerVersionsResponse {
    releaseVersion: string;
    databaseVersion: string;
    revision: string;
}

// Data structure for the import request body for importing test results from a file.
export interface ImportData {
    fileName: string;
    reportRootUID: string;
    useExistingDefect: boolean;
    ignoreNonExecutedTestCases: boolean;
    checkPaths: boolean;
    discardTesterInformation: boolean;
    defaultTester?: string;
    filters: ImportDataFilter[];
}

export interface ImportDataFilter {
    name: string;
    filterType: string;
    testThemeUID: string;
}

// Request body structure for the login request
export interface LoginRequestBody {
    login: string;
    password: string;
    force: boolean;
}

// Response body structure for the login request
export interface LoginResponse {
    userKey: string;
    login: string;
    sessionToken: string;
    globalRoles: string[];
    internalUserManagement: boolean;
    serverVersion: string;
    licenseWarning: string | null;
}
