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

export interface TestBenchConnection {
    id: string; // Unique identifier for the connection
    label: string; // User-friendly name for the connection (e.g., "Dev Server")
    serverName: string;
    portNumber: number;
    username: string;
}

// Store the last successfully generated report parameters for test generation to be able to fetch the report again for read command
export interface LastGeneratedReportParams {
    UID: string;
    projectKey: string;
    cycleKey: string;
    executionMode: ExecutionMode;
    timestamp: number;
    // Track if the report has already been imported
    // to avoid re-importing the same report multiple times
    alreadyImported: boolean;
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
        key: string;
        locker: string | null;
        status: string;
    };
    aut?: {
        key: string;
        locker: string | null;
        status: string;
    };
    exec?: {
        status: string;
        execStatus: string;
        verdict: string;
        key: string;
        locker: string | null;
    };
    filters?: any[];
    elementType: string; // e.g., TestThemeNode, TestCaseSetNode, TestCaseNode
};

export interface OptionalJobIDRequestParameter {
    treeRootUID?: string;
    executionMode?: ExecutionMode;
    suppressFilteredData?: boolean;
    suppressNotExecutable?: boolean;
    suppressEmptyTestThemes?: boolean;
    filters?: {
        name: string;
        filterType: "TestTheme";
        testThemeUID: string;
    }[];
}

export enum ExecutionMode {
    Execute = "execute",
    Continue = "continue",
    View = "view",
    Simulate = "simulate"
}

export interface JobIdResponse {
    jobID: string;
}

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

export interface TreeNode {
    nodeType: string;
    key: string;
    name: string;
    creationTime: string;
    status: string;
    visibility: boolean;
    children?: TreeNode[]; // Not all nodes have children
}

export interface ImportData {
    fileName: string;
    reportRootUID: string;
    useExistingDefect: boolean;
    discardTesterInformation: boolean;
    defaultTester?: string;
    filters: ImportDataFilter[];
}

export interface ImportDataFilter {
    name: string;
    filterType: string;
    testThemeUID: string;
}

export interface LoginRequestBody {
    login: string;
    password: string;
    force: boolean;
}

export interface LoginResponse {
    userKey: string;
    login: string;
    sessionToken: string;
    globalRoles: string[];
    internalUserManagement: boolean;
    serverVersion: string;
    licenseWarning: string | null;
}

export interface TovStructureOptions {
    treeRootUID?: string;
    suppressFilteredData: boolean;
    suppressEmptyTestThemes: boolean;
    filters: TovFilter[];
}

export interface TovFilter {
    name: string;
    filterType: "TestTheme";
    testThemeUID: string;
}

export interface TovStructureNode {
    [key: string]: any;
}

export interface TovStructureItem {
    root: TovStructureNode;
    nodes: TovStructureNode[];
}

export type TovStructure = TovStructureItem[];
