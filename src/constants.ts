/**
 * @file constants.ts
 * @description This file contains constants used throughout the extension such as
 * configuration keys, command names, context keys, and other static values.
 */

import * as path from "path";

export const EXTENSION_ID: string = "imbus.testbench-visual-studio-code-extension";
export const EXTENSION_ROOT_DIR: string = path.dirname(__dirname);
export const PACKAGES_DIR: string = path.join(EXTENSION_ROOT_DIR, "packages");
export const LANGUAGE_SERVER_SCRIPT_PATH: string = path.join(
    PACKAGES_DIR,
    "testbench-ls",
    "testbench_ls",
    "__main__.py"
);

/*
export const BUNDLED_PYTHON_SCRIPTS_DIR: string = path.join(EXTENSION_ROOT_DIR, "bundled");
export const LANGUAGE_SERVER_SCRIPT_PATH: string = path.join(
    BUNDLED_PYTHON_SCRIPTS_DIR,
    "libs",
    "testbench_ls",
    "__main__.py"
);
*/

/** Prefix of the extension commands and settings in package.json*/
export const baseKeyOfExtension: string = "testbenchExtension";

// --- Webview Message Commands ---
export const WebviewMessageCommands = {
    LOGIN: "login",
    UPDATE_SETTING: "updateSetting",
    SHOW_ERROR: "showError",
    UPDATE_CONTENT: "updateContent"
} as const; // 'as const' makes properties readonly and literal types

// --- Configuration Setting Keys ---
export const ConfigKeys = {
    SERVER_NAME: "serverName",
    PORT_NUMBER: "portNumber",
    USERNAME: "username",
    STORE_PASSWORD_AFTER_LOGIN: "storePasswordAfterLogin",
    AUTO_LOGIN: "automaticLoginAfterExtensionActivation",
    PROJECT: "project",
    TOV: "tov",
    CLEAR_INTERNAL_DIR: "clearInternalTestbenchDirectoryBeforeTestGeneration",
    CLEAR_REPORT_AFTER_PROCESSING: "clearReportAfterProcessing",
    LOGGER_LEVEL: "testBenchLogger",
    // Config keys used from package.json
    TB2ROBOT_CONFIG_PATH: "configurationPathInTestbench2robotframework",
    TB2ROBOT_CLEAN: "cleanFilesBeforeTestGenerationInTestbench2robotframework",
    TB2ROBOT_FULLY_QUALIFIED: "fullyQualifiedKeywordsInTestbench2robotframework",
    TB2ROBOT_OUTPUT_DIR: "outputDirectoryInTestbench2robotframework",
    TB2ROBOT_COMPOUND_LOGGING: "compoundInteractionLoggingInTestbench2robotframework",
    TB2ROBOT_LOG_SUITE_NUMBERING: "logSuiteNumberingInTestbench2robotframework",
    TB2ROBOT_RESOURCE_DIR: "resourceDirectoryPathInTestbench2robotframework",
    TB2ROBOT_LIBRARY_REGEX: "libraryRegexInTestbench2robotframework",
    TB2ROBOT_LIBRARY_ROOT: "libraryRootInTestbench2robotframework",
    TB2ROBOT_RESOURCE_REGEX: "resourceRegexInTestbench2robotframework",
    TB2ROBOT_RESOURCE_ROOT: "resourceRootInTestbench2robotframework",
    TB2ROBOT_LIBRARY_MAPPING: "libraryMappingInTestbench2robotframework",
    TB2ROBOT_RESOURCE_MAPPING: "resourceMappingInTestbench2robotframework",
    TB2ROBOT_OUTPUT_XML_PATH: "outputXmlFilePath"
} as const;

// --- Context Keys ---
export const ContextKeys = {
    CONNECTION_ACTIVE: "testbenchExtension.connectionActive"
} as const;

// --- Storage Keys ---
export const StorageKeys = {
    SESSION_TOKEN: "sessionToken", // Secret Storage
    PASSWORD: "password", // Secret Storage
    /**
     * Workspace state storage key for the last generated report parameters
     * to be able to use the report without the user selecting the report again while importing the report.
     */
    LAST_GENERATED_PARAMS: "testbenchExtension.lastGeneratedReportParams"
} as const;

// --- Tree Item Context Values ---
export const TreeItemContextValues = {
    PROJECT: "Project",
    VERSION: "Version",
    CYCLE: "Cycle",
    TEST_THEME_NODE: "TestThemeNode",
    TEST_CASE_SET_NODE: "TestCaseSetNode",
    TEST_CASE_NODE: "TestCaseNode",
    SUBDIVISION: "subdivision",
    INTERACTION: "interaction",
    DATA_TYPE: "dataType",
    CONDITION: "condition",
    TEST_ELEMENT: "testElement"
} as const;

// --- Job Types ---
export const JobTypes = {
    REPORT: "report",
    IMPORT: "import"
} as const;

/** Name of the working folder (inside the workspace folder) used by TestBench to store and process files internally. */
export const folderNameOfInternalTestbenchFolder: string = ".testbench";

/**
 * All extension commands (as defined in package.json) to avoid typos.
 * Each command can be extended later with additional metadata such as description.
 */
export const allExtensionCommands = {
    setWorkspace: `${baseKeyOfExtension}.setWorkspace`,
    displayCommand: `${baseKeyOfExtension}.displayCommands`,
    login: `${baseKeyOfExtension}.login`,
    logout: `${baseKeyOfExtension}.logout`,
    generateTestCasesForCycle: `${baseKeyOfExtension}.generateTestCasesForCycle`,
    generateTestCasesForTestThemeOrTestCaseSet: `${baseKeyOfExtension}.generateTestCasesForTestThemeOrTestCaseSet`,
    readRFTestResultsAndCreateReportWithResults: `${baseKeyOfExtension}.readRFTestResultsAndCreateReportWithResults`,
    makeRoot: `${baseKeyOfExtension}.makeRoot`,
    getServerVersions: `${baseKeyOfExtension}.getServerVersions`,
    showExtensionSettings: `${baseKeyOfExtension}.showExtensionSettings`,
    fetchReportForSelectedTreeItem: `${baseKeyOfExtension}.fetchReportForSelectedTreeItem`,
    selectAndLoadProject: `${baseKeyOfExtension}.selectAndLoadProject`,
    importTestResultsToTestbench: `${baseKeyOfExtension}.importTestResultsToTestbench`,
    readAndImportTestResultsToTestbench: `${baseKeyOfExtension}.readAndImportTestResultsToTestbench`,
    executeRobotFrameworkTests: `${baseKeyOfExtension}.executeRobotFrameworkTests`,
    refreshProjectTreeView: `${baseKeyOfExtension}.refreshProjectTreeView`,
    refreshTestThemeTreeView: `${baseKeyOfExtension}.refreshTestThemeTreeView`,
    clearInternalTestbenchFolder: `${baseKeyOfExtension}.clearInternalTestbenchFolder`,
    toggleProjectManagementTreeViewVisibility: `${baseKeyOfExtension}.toggleProjectManagementTreeViewVisibility`,
    toggleTestThemeTreeViewVisibility: `${baseKeyOfExtension}.toggleTestThemeTreeViewVisibility`,
    automaticLoginAfterExtensionActivation: `${baseKeyOfExtension}.automaticLoginAfterExtensionActivation`,
    refreshTestElementsTree: `${baseKeyOfExtension}.refreshTestElementsTree`,
    displayInteractionsForSelectedTOV: `${baseKeyOfExtension}.displayInteractionsForSelectedTOV`,
    openOrCreateRobotResourceFile: `${baseKeyOfExtension}.openOrCreateRobotResourceFile`,
    createInteractionUnderSubdivision: `${baseKeyOfExtension}.createInteractionUnderSubdivision`,
    openIssueReporter: `${baseKeyOfExtension}.openIssueReporter`,
    modifyReportWithResultsZip: `${baseKeyOfExtension}.modifyReportWithResultsZip`
};
