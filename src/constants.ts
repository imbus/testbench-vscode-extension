/**
 * @file src/constants.ts
 * @description This file contains constants used throughout the extension such as
 * configuration keys, command names, context keys, and other static values.
 */

import * as path from "path";

export const EXTENSION_ROOT_DIR: string = path.dirname(__dirname);
export const BUNDLED_PYTHON_SCRIPTS_DIR: string = path.join(EXTENSION_ROOT_DIR, "bundled");
export const LANGUAGE_SERVER_SCRIPT_PATH: string = path.join(
    BUNDLED_PYTHON_SCRIPTS_DIR,
    "libs",
    "testbench_ls",
    "extension_entry.py"
);

export const LANGUAGE_SERVER_DEBUG_PATH: string = path.join(
    BUNDLED_PYTHON_SCRIPTS_DIR,
    "libs",
    "testbench_ls",
    "extension_debug_entry.py"
);

// Prefix of the extension commands and settings in package.json
export const baseKeyOfExtension: string = "testbenchExtension";

// --- Webview Message Commands ---
export const WebviewMessageCommands = {
    LOGIN: "login",
    UPDATE_SETTING: "updateSetting",
    SHOW_ERROR: "showError",
    UPDATE_CONTENT: "updateContent",
    TRIGGER_COMMAND: "triggerCommand",

    // Connection Management UI
    CONNECTION_UI_LOADED: "connectionUiLoaded",
    LOGIN_WITH_CONNECTION: "loginWithConnection",
    SAVE_NEW_CONNECTION: "saveNewConnection",
    REQUEST_DELETE_CONFIRMATION: "requestDeleteConfirmation",
    // Edit connection functionality
    EDIT_CONNECTION: "editConnection",
    UPDATE_CONNECTION: "updateConnection",
    CANCEL_EDIT_CONNECTION: "cancelEditConnection",

    // Host to Webview communication
    DISPLAY_CONNECTIONS_IN_WEBVIEW: "displayConnectionsInWebview",
    SHOW_WEBVIEW_MESSAGE: "showWebviewMessage"
} as const;

// --- Extension Configuration Setting Keys ---
export const ConfigKeys = {
    AUTO_LOGIN: "automaticLoginAfterExtensionActivation",
    CLEAR_INTERNAL_DIR: "clearInternalTestbenchDirectoryBeforeTestGeneration",
    CLEAR_REPORT_AFTER_PROCESSING: "clearReportAfterProcessing",
    LOGGER_LEVEL: "testBenchLogger",
    USE_CONFIG_FILE_SETTING: "UseConfigurationFile",
    TB2ROBOT_CLEAN: "cleanFilesBeforeTestGeneration",
    TB2ROBOT_FULLY_QUALIFIED: "fullyQualifiedKeywords",
    TB2ROBOT_OUTPUT_DIR: "outputDirectory",
    TB2ROBOT_COMPOUND_LOGGING: "compoundInteractionLogging",
    TB2ROBOT_LOG_SUITE_NUMBERING: "logSuiteNumbering",
    TB2ROBOT_RESOURCE_DIR: "resourceDirectoryPath",
    TB2ROBOT_LIBRARY_MARKER: "libraryMarker",
    TB2ROBOT_LIBRARY_ROOT: "libraryRoot",
    TB2ROBOT_RESOURCE_MARKER: "resourceMarker",
    TB2ROBOT_RESOURCE_ROOT: "resourceRoot",
    TB2ROBOT_LIBRARY_MAPPING: "libraryMapping",
    TB2ROBOT_RESOURCE_MAPPING: "resourceMapping",
    TB2ROBOT_OUTPUT_XML_PATH: "outputXmlFilePath"
} as const;

// --- Context Keys ---
export const ContextKeys = {
    CONNECTION_ACTIVE: "testbenchExtension.connectionActive",
    PROJECT_TREE_HAS_CUSTOM_ROOT: "testbenchExtension.projectTreeHasCustomRoot",
    THEME_TREE_HAS_CUSTOM_ROOT: "testbenchExtension.themeTreeHasCustomRoot",
    IS_TT_OPENED_FROM_CYCLE: "testbenchExtension.isTestThemeOpenedFromCycle",
    SHOW_PROJECTS_TREE: "testbenchExtension.showProjectsTree",
    SHOW_TEST_THEMES_TREE: "testbenchExtension.showTestThemesTree",
    SHOW_TEST_ELEMENTS_TREE: "testbenchExtension.showTestElementsTree",
    // Filter diff mode context keys
    FILTER_DIFF_MODE_ENABLED: "testbenchExtension.filterDiffModeEnabled",
    FILTER_DIFF_MODE_ENABLED_PROJECTS: "testbenchExtension.filterDiffModeEnabledProjects",
    FILTER_DIFF_MODE_ENABLED_TEST_THEMES: "testbenchExtension.filterDiffModeEnabledTestThemes",
    FILTER_DIFF_MODE_ENABLED_TEST_ELEMENTS: "testbenchExtension.filterDiffModeEnabledTestElements"
} as const;

// --- Storage Keys ---
export const StorageKeys = {
    SESSION_TOKEN: "sessionToken", // Secret Storage
    /**
     * Workspace state storage key for the last generated report parameters
     * to be able to use the report without the user selecting the report again while importing the report.
     */
    LAST_GENERATED_PARAMS: "testbenchExtension.lastGeneratedReportParams",
    // AuthenticationProvider constants
    CONNECTIONS_STORAGE_KEY: "testbenchExtension.connections",
    ACTIVE_CONNECTION_ID_KEY: "testbenchExtension.activeConnectionId",
    CONNECTION_PASSWORD_SECRET_PREFIX: "testbenchExtension.connection.password.",
    MARKED_TEST_GENERATION_ITEM: "testbenchExtension.markedTestGenerationItem",
    SUB_TREE_ITEM_IMPORT_STORAGE_KEY: "testbenchExtension.importedSubTreeItems",
    // Persistent tree view storage for tree view restoration
    VISIBLE_VIEWS_STORAGE_KEY: "testbenchExtension.visibleTreeViews",
    LAST_ACTIVE_CYCLE_CONTEXT_KEY: "testbenchExtension.lastActiveCycleContext",
    LAST_ACTIVE_TOV_CONTEXT_KEY: "testbenchExtension.lastActiveTovContext",
    // Custom root persistence
    CUSTOM_ROOT_PROJECT_TREE: "testbenchExtension.customRoot.projectTree",
    CUSTOM_ROOT_TEST_THEME_TREE: "testbenchExtension.customRoot.testThemeTree",
    CUSTOM_ROOT_TEST_ELEMENTS_TREE: "testbenchExtension.customRoot.testElementsTree",
    IS_TT_OPENED_FROM_CYCLE_STORAGE_KEY: "testbenchExtension.isTestThemeOpenedFromCycleStorageKey",
    HAS_USED_EXTENSION_BEFORE: "testbenchExtension.hasUsedExtensionBefore"
} as const;

// --- Tree Item Context Values ---
export const ProjectItemTypes = {
    PROJECT: "Project",
    CUSTOM_ROOT_PROJECT: "customRoot.project",
    VERSION: "Version",
    CYCLE: "Cycle",
    OTHER: "Other"
} as const;

export const TestThemeItemTypes = {
    TEST_THEME: "TestThemeNode",
    CUSTOM_ROOT_TEST_THEME: "customRoot.testTheme",
    TEST_CASE_SET: "TestCaseSetNode",
    TEST_CASE: "TestCaseNode",
    MARKED_TEST_THEME_TREE_ITEM: "MarkedForImport.TestThemeNode",
    MARKED_TEST_CASE_SET_TREE_ITEM: "MarkedForImport.TestCaseSetNode",
    MARKED_CUSTOM_ROOT_TEST_THEME: "MarkedForImport.customRoot.testTheme",
    OTHER: "Other"
} as const;

export const TestElementItemTypes = {
    SUBDIVISION: "Subdivision",
    INTERACTION: "Interaction",
    DATA_TYPE: "DataType",
    CONDITION: "Condition",
    OTHER: "Other"
} as const;

// --- Job Types ---
export const JobTypes = {
    REPORT: "report",
    IMPORT: "import"
} as const;

// Internal folder name used to store and process files internally.
export const folderNameOfInternalTestbenchFolder: string = ".testbench";

// --- Tree View Timing Constants ---
export const TreeViewTiming = {
    // Data freshness and caching
    DATA_FRESHNESS_THRESHOLD_MS: 5000,
    DATA_STALE_THRESHOLD_MS: 5000,

    // UI refresh and debouncing
    UI_REFRESH_DEBOUNCE_MS: 500,
    EVENT_DEBOUNCE_MS: 500,

    // Configuration defaults
    DEFAULT_DEBOUNCE_DELAY_MS: 300,

    DOUBLE_CLICK_THRESHOLD_MS: 800,

    // Loading and initialization
    WEBVIEW_LOAD_DELAY_MS: 1000,

    // Event handling
    EVENT_HISTORY_MAX_SIZE: 100,
    ERROR_HISTORY_MAX_SIZE: 100,

    // State management
    STATE_SAVE_DELAY_MS: 1000,

    // Framework cache
    DEFAULT_CACHE_TTL_MS: 5 * 60 * 1000
} as const;

/**
 * All extension commands as defined in package.json.
 */
export const allExtensionCommands = {
    setWorkspace: `${baseKeyOfExtension}.setWorkspace`,
    login: `${baseKeyOfExtension}.login`,
    logout: `${baseKeyOfExtension}.logout`,
    generateTestCasesForCycle: `${baseKeyOfExtension}.generateTestCasesForCycle`,
    generateTestCasesForTestThemeOrTestCaseSet: `${baseKeyOfExtension}.generateTestCasesForTestThemeOrTestCaseSet`,
    generateTestsForTestThemeTreeItemFromTOV: `${baseKeyOfExtension}.generateTestsForTestThemeTreeItemFromTOV`,
    generateTestCasesForTOV: `${baseKeyOfExtension}.generateTestCasesForTOV`,
    readRFTestResultsAndCreateReportWithResults: `${baseKeyOfExtension}.readRFTestResultsAndCreateReportWithResults`,
    makeRoot: `${baseKeyOfExtension}.makeRoot`,
    showExtensionSettings: `${baseKeyOfExtension}.showExtensionSettings`,
    displayAllProjects: `${baseKeyOfExtension}.displayAllProjects`,
    importTestResultsToTestbench: `${baseKeyOfExtension}.importTestResultsToTestbench`,
    readAndImportTestResultsToTestbench: `${baseKeyOfExtension}.readAndImportTestResultsToTestbench`,
    refreshProjectTreeView: `${baseKeyOfExtension}.refreshProjectTreeView`,
    refreshTestThemeTreeView: `${baseKeyOfExtension}.refreshTestThemeTreeView`,
    refreshTestElementsTree: `${baseKeyOfExtension}.refreshTestElementsTree`,
    clearInternalTestbenchFolder: `${baseKeyOfExtension}.clearInternalTestbenchFolder`,
    automaticLoginAfterExtensionActivation: `${baseKeyOfExtension}.automaticLoginAfterExtensionActivation`,
    openTOVFromProjectsView: `${baseKeyOfExtension}.openTOVFromProjectsView`,
    openCycleFromProjectsView: `${baseKeyOfExtension}.openCycleFromProjectsView`,
    openIssueReporter: `${baseKeyOfExtension}.openIssueReporter`,
    modifyReportWithResultsZip: `${baseKeyOfExtension}.modifyReportWithResultsZip`,
    handleProjectCycleClick: `${baseKeyOfExtension}.handleProjectCycleClick`,
    handleProjectVersionClick: `${baseKeyOfExtension}.handleProjectVersionClick`,
    resetProjectTreeViewRoot: `${baseKeyOfExtension}.resetProjectTreeViewRoot`,
    resetTestThemeTreeViewRoot: `${baseKeyOfExtension}.resetTestThemeTreeViewRoot`,
    getFilters: `${baseKeyOfExtension}.getFilters`,
    fetchTovStructure: `${baseKeyOfExtension}.fetchTovStructure`,
    clearImportedSubTreeItemsTracking: `${baseKeyOfExtension}.clearImportedSubTreeItemsTracking`,
    checkForCycleDoubleClick: `${baseKeyOfExtension}.checkForCycleDoubleClick`,
    updateOrRestartLS: `${baseKeyOfExtension}.updateOrRestartLS`,
    markTestThemeForImport: "testbench.markTestThemeForImport",
    generateTestCasesForTestTheme: "testbench.generateTestCasesForTestTheme",
    refreshAllTrees: "testbench.refreshAllTrees",
    clearAllCustomRoots: "testbench.clearAllCustomRoots",
    clearAllMarks: "testbench.clearAllMarks",
    clearAllExtensionData: `${baseKeyOfExtension}.clearAllExtensionData`,

    // Tree View Filtering Commands
    setTextFilterForProjects: `${baseKeyOfExtension}.setTextFilterForProjects`,
    setTextFilterForTestThemes: `${baseKeyOfExtension}.setTextFilterForTestThemes`,
    setTextFilterForTestElements: `${baseKeyOfExtension}.setTextFilterForTestElements`,
    clearTextFilterForProjects: `${baseKeyOfExtension}.clearTextFilterForProjects`,
    clearTextFilterForTestThemes: `${baseKeyOfExtension}.clearTextFilterForTestThemes`,
    clearTextFilterForTestElements: `${baseKeyOfExtension}.clearTextFilterForTestElements`,
    toggleFilterDiffModeForProjects: `${baseKeyOfExtension}.toggleFilterDiffModeForProjects`,
    toggleFilterDiffModeForProjectsEnabled: `${baseKeyOfExtension}.toggleFilterDiffModeForProjectsEnabled`,
    toggleFilterDiffModeForTestThemes: `${baseKeyOfExtension}.toggleFilterDiffModeForTestThemes`,
    toggleFilterDiffModeForTestThemesEnabled: `${baseKeyOfExtension}.toggleFilterDiffModeForTestThemesEnabled`,
    toggleFilterDiffModeForTestElements: `${baseKeyOfExtension}.toggleFilterDiffModeForTestElements`,
    toggleFilterDiffModeForTestElementsEnabled: `${baseKeyOfExtension}.toggleFilterDiffModeForTestElementsEnabled`,
    clearAllFiltersForProjects: `${baseKeyOfExtension}.clearAllFiltersForProjects`,
    clearAllFiltersForTestThemes: `${baseKeyOfExtension}.clearAllFiltersForTestThemes`,
    clearAllFiltersForTestElements: `${baseKeyOfExtension}.clearAllFiltersForTestElements`,

    // Test elements tree item commands
    openAvailableSubdivisionInTestElementsView: `${baseKeyOfExtension}.openAvailableSubdivisionInTestElementsView`,
    openMissingSubdivisionInTestElementsView: `${baseKeyOfExtension}.openMissingSubdivisionInTestElementsView`,
    openSubdivisionFolderInExplorer: `${baseKeyOfExtension}.openSubdivisionFolderInExplorer`,
    openInteractionInTestElementsView: `${baseKeyOfExtension}.openInteractionInTestElementsView`,
    createMissingParentResourceForInteraction: `${baseKeyOfExtension}.createMissingParentResourceForInteraction`,
    handleInteractionClick: `${baseKeyOfExtension}.handleInteractionClick`
};
