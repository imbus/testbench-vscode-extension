"use strict";
/**
 * @file src/extension.ts
 * @description Main entry point for the TestBench VS Code extension.
 */
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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOW_PERSISTENT_IMPORT_BUTTON = exports.ENABLE_ICON_MARKING_ON_TEST_GENERATION = exports.connection = exports.logger = void 0;
exports.setLogger = setLogger;
exports.setConnection = setConnection;
exports.getConnection = getConnection;
exports.getLoginWebViewProvider = getLoginWebViewProvider;
exports.safeCommandHandler = safeCommandHandler;
exports.initializeTreeViews = initializeTreeViews;
exports.activate = activate;
exports.updateOrRestartLS = updateOrRestartLS;
exports.deactivate = deactivate;
exports.clearAllExtensionData = clearAllExtensionData;
// Before releasing the extension:
// TODO: Add License.md to the extension
// TODO: Set logger level to info or debug in production, remove too detailed logs.
// TODO: In production, remove process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; in connection class.
// Note: A virtual python environment is required for the extension to work + an empty pyproject.toml in workspace root.
const vscode = __importStar(require("vscode"));
const testBenchLogger = __importStar(require("./testBenchLogger"));
const loginWebView = __importStar(require("./loginWebView"));
const constants_1 = require("./constants");
const server_1 = require("./server");
const node_1 = require("vscode-languageclient/node");
const testBenchAuthenticationProvider_1 = require("./testBenchAuthenticationProvider");
const connectionManager = __importStar(require("./connectionManager"));
const testBenchConnection_1 = require("./testBenchConnection");
const configuration_1 = require("./configuration");
const treeViews_1 = require("./treeViews");
const reportHandler = __importStar(require("./reportHandler"));
const utils = __importStar(require("./utils"));
const path_1 = __importDefault(require("path"));
const FilterService_1 = require("./treeViews/utils/FilterService");
function setLogger(newLogger) {
    exports.logger = newLogger;
}
// Global connection to the (new) TestBench Play server.
exports.connection = null;
function setConnection(newConnection) {
    exports.connection = newConnection;
}
function getConnection() {
    return exports.connection;
}
// Login webview provider instance.
let loginWebViewProvider = null;
function getLoginWebViewProvider() {
    return loginWebViewProvider;
}
// Global tree views instance
let treeViews = null;
let extensionContext;
// Double-click handling
let lastCycleClick = { id: "", timestamp: 0 };
// Global variable to store the authentication provider instance
let authProviderInstance = null;
// Prevent multiple session change handling simultaneously
let isHandlingSessionChange = false;
// Determines if the icon of the tree item should be changed after generating tests for that item.
exports.ENABLE_ICON_MARKING_ON_TEST_GENERATION = true;
// Determines if the import button of the tree item should still persist after importing test results for that item.
exports.ALLOW_PERSISTENT_IMPORT_BUTTON = true;
/**
 * Wraps a command handler with error handling to prevent the extension from crashing due to unhandled exceptions in commands.
 * It takes a handler function as input and returns a new function that executes the original handler inside a try/catch block.
 *
 * @param handler The async function to execute.
 * @returns A new async function that wraps the handler with try/catch.
 */
function safeCommandHandler(handler) {
    return async (...args) => {
        try {
            await handler(...args);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
            exports.logger.error(`Error executing command: ${errorMessage}`, error);
            vscode.window.showErrorMessage(`An error occurred: ${errorMessage}`);
        }
    };
}
/**
 * Registers a command with error handling.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {string} commandId The command ID string.
 * @param {(...args: any[]) => any} callback The command handler function.
 */
function registerSafeCommand(context, commandId, callback) {
    const disposable = vscode.commands.registerCommand(commandId, async (...args) => {
        try {
            await callback(...args);
        }
        catch (error) {
            // Errors expected in silent auto-login, dont show error message to user.
            if (commandId === constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation) {
                exports.logger.warn(`Command ${commandId} error (expected for silent auto-login if conditions not met): ${error.message}`);
            }
            else {
                exports.logger.error(`Command ${commandId} error: ${error.message}`, error);
                vscode.window.showErrorMessage(`Command ${commandId} failed: ${error.message}`);
            }
        }
    });
    context.subscriptions.push(disposable);
}
/**
 * Utility functions for tree view visibility management
 */
async function hideProjectManagementTreeView() {
    if (!treeViews) {
        return;
    }
    vscode.commands.executeCommand("setContext", constants_1.ContextKeys.SHOW_PROJECTS_TREE, false);
}
async function displayProjectManagementTreeView() {
    if (!treeViews) {
        return;
    }
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.SHOW_PROJECTS_TREE, true);
    // Set the active tree view for filtering
    const filterService = FilterService_1.FilterService.getInstance();
    filterService.setActiveTreeViewByContext(treeViews, "testbenchExtension.showProjectsTree");
}
async function hideTestThemeTreeView() {
    if (!treeViews) {
        return;
    }
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.SHOW_TEST_THEMES_TREE, false);
}
async function displayTestThemeTreeView() {
    if (!treeViews) {
        return;
    }
    vscode.commands.executeCommand("setContext", constants_1.ContextKeys.SHOW_TEST_THEMES_TREE, true);
    // Set the active tree view for filtering
    const filterService = FilterService_1.FilterService.getInstance();
    filterService.setActiveTreeViewByContext(treeViews, "testbenchExtension.showTestThemesTree");
}
async function hideTestElementsTreeView() {
    if (!treeViews) {
        return;
    }
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.SHOW_TEST_ELEMENTS_TREE, false);
}
async function displayTestElementsTreeView() {
    if (!treeViews) {
        return;
    }
    vscode.commands.executeCommand("setContext", constants_1.ContextKeys.SHOW_TEST_ELEMENTS_TREE, true);
    // Set the active tree view for filtering
    const filterService = FilterService_1.FilterService.getInstance();
    filterService.setActiveTreeViewByContext(treeViews, "testbenchExtension.showTestElementsTree");
}
/**
 * Initializes all tree views using the new tree framework.
 */
async function initializeTreeViews(context) {
    extensionContext = context;
    if (treeViews) {
        treeViews.dispose();
    }
    try {
        treeViews = (0, treeViews_1.createAllTreeViews)(extensionContext, getConnection);
        await treeViews.initialize();
        // Check for saved view state before setting default visibility
        const savedViewId = context.workspaceState.get(constants_1.StorageKeys.VISIBLE_VIEWS_STORAGE_KEY);
        const savedCycleContext = context.workspaceState.get(constants_1.StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY);
        const savedTovContext = context.workspaceState.get(constants_1.StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY);
        const savedContext = savedCycleContext || savedTovContext;
        // Determine initial visibility based on saved state
        let showProjects = true;
        let showTestThemes = false;
        let showTestElements = false;
        if (savedViewId && savedViewId !== "projects" && savedContext) {
            // Validate that the saved context has the required fields
            const hasValidProjectName = savedContext.projectName && typeof savedContext.projectName === "string";
            const hasValidTovName = savedContext.tovName && typeof savedContext.tovName === "string";
            if (hasValidProjectName && hasValidTovName) {
                showProjects = false;
                showTestThemes = savedViewId === "testThemes" || savedViewId === "testElements";
                showTestElements = savedViewId === "testElements";
            }
        }
        await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.SHOW_PROJECTS_TREE, showProjects);
        await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.SHOW_TEST_THEMES_TREE, showTestThemes);
        await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.SHOW_TEST_ELEMENTS_TREE, showTestElements);
        exports.logger.info("Tree views initialized successfully");
    }
    catch (error) {
        exports.logger.error("Failed to initialize tree views:", error);
        vscode.window.showErrorMessage("Failed to initialize tree views. Please reload the window.");
        throw error;
    }
}
/**
 * Restores a previously saved view state.
 * Updates the language server, loads data into the tree views based on the saved context,
 * and adjusts the visibility of the tree views accordingly.
 *
 * @param context The VS Code extension context.
 * @param savedViewId The identifier of the view to restore.
 * @param savedContext An object containing the saved view information (project, TOV, cycle data).
 * @returns A promise that resolves to true if the view was successfully restored, false otherwise.
 */
async function performDeferredViewRestoration(context, savedViewId, savedContext) {
    if (!treeViews) {
        return false;
    }
    try {
        exports.logger.info(`Performing deferred view restoration for: ${savedViewId}`);
        await updateOrRestartLS(savedContext.projectName, savedContext.tovName);
        if (savedContext.isCycle) {
            await treeViews.testThemesTree.loadCycle(savedContext.projectKey, savedContext.cycleKey, savedContext.cycleLabel);
        }
        else {
            await treeViews.testThemesTree.loadTov(savedContext.projectKey, savedContext.tovKey);
        }
        await treeViews.testElementsTree.loadTov(savedContext.tovKey, savedContext.tovName);
        // Update visibility to show the restored views
        await displayTestThemeTreeView();
        await displayTestElementsTreeView();
        await hideProjectManagementTreeView();
        exports.logger.info(`Successfully restored view to context of TOV: ${savedContext.tovName}`);
        return true;
    }
    catch (error) {
        exports.logger.error("Failed to restore view state:", error);
        return false;
    }
}
/**
 * Registers all extension commands.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function registerExtensionCommands(context) {
    if (!treeViews) {
        exports.logger.warn("Tree views not initialized. Skipping command registration.");
        return;
    }
    // --- Command Handlers ---
    const handleAutomaticLogin = async () => {
        exports.logger.debug(`[Cmd] Called: ${constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation}`);
        const config = (0, configuration_1.getExtensionConfiguration)();
        if (config.get(constants_1.ConfigKeys.AUTO_LOGIN)) {
            const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                createIfNone: true
            });
            if (session) {
                await handleTestBenchSessionChange(context, session);
            }
        }
    };
    const handleLogin = async () => {
        exports.logger.debug(`[Cmd] Called: ${constants_1.allExtensionCommands.login}`);
        const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: true
        });
        if (session) {
            await handleTestBenchSessionChange(context, session);
        }
    };
    const handleLogout = async () => {
        exports.logger.debug("[Cmd] Called: logout");
        const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            silent: true
        });
        if (session && authProviderInstance) {
            // Remove the session to fire onDidChangeSessions and trigger proper UI cleanup.
            await authProviderInstance.removeSession(session.id);
            exports.logger.info(`[Cmd] Session ${session.id} removed by logout command.`);
        }
        // Fallback to ensure UI is reset if a connection object still exists without a session.
        if (exports.connection !== null) {
            await handleTestBenchSessionChange(context, undefined);
        }
    };
    const handleProjectCycleClick = async (cycleItem) => {
        exports.logger.debug(`[Cmd] Called: ${constants_1.allExtensionCommands.handleProjectCycleClick} for item ${cycleItem.label}`);
        const now = Date.now();
        const isDoubleClick = lastCycleClick.id === cycleItem.id &&
            now - lastCycleClick.timestamp < constants_1.TreeViewTiming.DOUBLE_CLICK_THRESHOLD_MS;
        if (isDoubleClick) {
            exports.logger.debug(`Cycle item double-clicked: ${cycleItem.label}`);
            await displayTestThemeTreeView();
            await displayTestElementsTreeView();
            await hideProjectManagementTreeView();
            lastCycleClick = { id: "", timestamp: 0 };
        }
        else {
            if (cycleItem.id) {
                lastCycleClick = { id: cycleItem.id, timestamp: now };
            }
            exports.logger.debug(`Cycle item single-clicked: ${cycleItem.label}`);
            const projectKey = cycleItem.getProjectKey();
            const cycleKey = cycleItem.getCycleKey();
            const versionKey = cycleItem.getVersionKey();
            const projectName = cycleItem.parent?.parent?.label?.toString();
            const tovName = cycleItem.parent?.label?.toString();
            if (projectKey && cycleKey && versionKey && projectName && tovName) {
                await saveUIContext(context, "testThemes", {
                    isCycle: true,
                    projectKey,
                    cycleKey,
                    tovKey: versionKey,
                    projectName,
                    tovName,
                    cycleLabel: cycleItem.label?.toString()
                });
                await updateOrRestartLS(projectName, tovName);
                if (treeViews?.testThemesTree) {
                    await treeViews.testThemesTree.loadCycle(projectKey, cycleKey, cycleItem.label?.toString());
                }
                if (treeViews?.testElementsTree) {
                    exports.logger.debug(`Loading test elements for TOV ${versionKey} (from cycle ${cycleKey})`);
                    await treeViews.testElementsTree.loadTov(versionKey, tovName);
                }
            }
            else {
                throw new Error("Invalid cycle item: missing project, cycle, or version key");
            }
        }
    };
    const handleOpenTOV = async (tovItem) => {
        if (!treeViews?.testThemesTree) {
            return;
        }
        const projectKey = tovItem.getProjectKey();
        const tovKey = tovItem.getVersionKey();
        const projectName = tovItem.parent?.label?.toString();
        const tovName = tovItem.label?.toString();
        if (projectKey && tovKey && projectName && tovName) {
            await saveUIContext(context, "testThemes", { isCycle: false, projectKey, tovKey, projectName, tovName });
            await displayTestThemeTreeView();
            await displayTestElementsTreeView();
            await hideProjectManagementTreeView();
            await updateOrRestartLS(projectName, tovName);
            await treeViews.testThemesTree.loadTov(projectKey, tovKey);
            if (treeViews.testElementsTree) {
                await treeViews.testElementsTree.loadTov(tovKey, tovItem.label?.toString());
            }
        }
    };
    const handleOpenCycle = async (cycleItem) => {
        if (!treeViews?.testThemesTree) {
            return;
        }
        const projectKey = cycleItem.getProjectKey();
        const cycleKey = cycleItem.getCycleKey();
        const versionKey = cycleItem.getVersionKey();
        const projectName = cycleItem.parent?.parent?.label?.toString();
        const tovName = cycleItem.parent?.label?.toString();
        if (projectKey && cycleKey && versionKey && projectName && tovName) {
            await displayTestThemeTreeView();
            await displayTestElementsTreeView();
            await hideProjectManagementTreeView();
            await updateOrRestartLS(projectName, tovName);
            await treeViews.testThemesTree.loadCycle(projectKey, cycleKey, cycleItem.label?.toString());
            if (treeViews.testElementsTree) {
                await treeViews.testElementsTree.loadTov(versionKey, cycleItem.label?.toString());
            }
        }
        else {
            throw new Error("Invalid cycle item: missing project, cycle, or version key");
        }
    };
    const handleGenerateForCycle = async (cycleItem) => {
        const projectName = cycleItem.parent?.parent?.label?.toString();
        const tovName = cycleItem.parent?.label?.toString();
        await updateOrRestartLS(projectName, tovName);
        await reportHandler.startTestGenerationForCycle(context, cycleItem);
    };
    const clearInternalFolder = async () => {
        exports.logger.debug(`Command Called: ${constants_1.allExtensionCommands.clearInternalTestbenchFolder}`);
        const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return;
        }
        const testbenchWorkingDirectoryPath = path_1.default.join(workspaceLocation, constants_1.folderNameOfInternalTestbenchFolder);
        await utils.clearInternalTestbenchFolder(testbenchWorkingDirectoryPath, [testBenchLogger.folderNameOfLogs], !(0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.CLEAR_INTERNAL_DIR));
    };
    const setFilterForView = async (treeView) => {
        if (!treeView) {
            return;
        }
        const filterService = FilterService_1.FilterService.getInstance();
        filterService.setActiveTreeView(treeView);
        await filterService.showTextFilterDialog();
    };
    const clearFilterForView = async (treeView) => {
        if (!treeView) {
            return;
        }
        const filterService = FilterService_1.FilterService.getInstance();
        filterService.setActiveTreeView(treeView);
        await filterService.clearTextFilter();
    };
    const toggleDiffModeForView = async (treeView) => {
        if (!treeView) {
            return;
        }
        const filterService = FilterService_1.FilterService.getInstance();
        filterService.setActiveTreeView(treeView);
        await filterService.toggleFilterDiffMode();
    };
    const clearAllFiltersForView = async (treeView) => {
        if (!treeView) {
            return;
        }
        const filterService = FilterService_1.FilterService.getInstance();
        filterService.setActiveTreeView(treeView);
        await filterService.clearAllFilters();
    };
    // --- Command Registry ---
    const commandRegistry = [
        // Authentication and Session
        { id: constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation, handler: handleAutomaticLogin },
        { id: constants_1.allExtensionCommands.login, handler: handleLogin },
        { id: constants_1.allExtensionCommands.logout, handler: handleLogout },
        // Tree Interaction & Navigation
        { id: constants_1.allExtensionCommands.handleProjectCycleClick, handler: handleProjectCycleClick },
        { id: constants_1.allExtensionCommands.openTOVFromProjectsView, handler: handleOpenTOV },
        { id: constants_1.allExtensionCommands.openCycleFromProjectsView, handler: handleOpenCycle },
        {
            id: constants_1.allExtensionCommands.displayAllProjects,
            handler: async () => {
                displayProjectManagementTreeView();
                hideTestThemeTreeView();
                hideTestElementsTreeView();
                await saveUIContext(context, "projects");
            }
        },
        // Test Generation
        {
            id: constants_1.allExtensionCommands.generateTestCasesForTOV,
            handler: (item) => treeViews?.projectsTree.generateTestCasesForTOV(item)
        },
        { id: constants_1.allExtensionCommands.generateTestCasesForCycle, handler: handleGenerateForCycle },
        {
            id: constants_1.allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet,
            handler: (item) => treeViews?.testThemesTree.generateTestCases(item)
        },
        {
            id: constants_1.allExtensionCommands.generateTestsForTestThemeTreeItemFromTOV,
            handler: (item) => treeViews?.testThemesTree.generateTestCases(item)
        },
        // Read and Import Test Results for Test Theme Tree Item
        {
            id: constants_1.allExtensionCommands.readAndImportTestResultsToTestbench,
            handler: (item) => treeViews?.testThemesTree.importTestResultsForTestThemeTreeItem(item)
        },
        // Tree View Management
        { id: constants_1.allExtensionCommands.refreshProjectTreeView, handler: () => treeViews?.projectsTree.refresh() },
        { id: constants_1.allExtensionCommands.refreshTestThemeTreeView, handler: () => treeViews?.testThemesTree.refresh() },
        { id: constants_1.allExtensionCommands.refreshTestElementsTree, handler: () => treeViews?.testElementsTree.refresh() },
        {
            id: constants_1.allExtensionCommands.makeRoot,
            handler: (item) => {
                if (treeViews?.projectsTree && item.data?.type === "project") {
                    treeViews?.projectsTree.makeRoot(item);
                }
                else if (treeViews?.testThemesTree && item.data?.type?.includes("TestTheme")) {
                    treeViews?.testThemesTree.makeRoot(item);
                }
            }
        },
        { id: constants_1.allExtensionCommands.resetProjectTreeViewRoot, handler: () => treeViews?.projectsTree.resetCustomRoot() },
        {
            id: constants_1.allExtensionCommands.resetTestThemeTreeViewRoot,
            handler: () => treeViews?.testThemesTree.resetCustomRoot()
        },
        // Tree View Filtering Commands
        { id: constants_1.allExtensionCommands.setTextFilterForProjects, handler: () => setFilterForView(treeViews?.projectsTree) },
        {
            id: constants_1.allExtensionCommands.setTextFilterForTestThemes,
            handler: () => setFilterForView(treeViews?.testThemesTree)
        },
        {
            id: constants_1.allExtensionCommands.setTextFilterForTestElements,
            handler: () => setFilterForView(treeViews?.testElementsTree)
        },
        {
            id: constants_1.allExtensionCommands.clearTextFilterForProjects,
            handler: () => clearFilterForView(treeViews?.projectsTree)
        },
        {
            id: constants_1.allExtensionCommands.clearTextFilterForTestThemes,
            handler: () => clearFilterForView(treeViews?.testThemesTree)
        },
        {
            id: constants_1.allExtensionCommands.clearTextFilterForTestElements,
            handler: () => clearFilterForView(treeViews?.testElementsTree)
        },
        {
            id: constants_1.allExtensionCommands.toggleFilterDiffModeForProjects,
            handler: () => toggleDiffModeForView(treeViews?.projectsTree)
        },
        {
            id: constants_1.allExtensionCommands.toggleFilterDiffModeForProjectsEnabled,
            handler: () => toggleDiffModeForView(treeViews?.projectsTree)
        },
        {
            id: constants_1.allExtensionCommands.toggleFilterDiffModeForTestThemes,
            handler: () => toggleDiffModeForView(treeViews?.testThemesTree)
        },
        {
            id: constants_1.allExtensionCommands.toggleFilterDiffModeForTestThemesEnabled,
            handler: () => toggleDiffModeForView(treeViews?.testThemesTree)
        },
        {
            id: constants_1.allExtensionCommands.toggleFilterDiffModeForTestElements,
            handler: () => toggleDiffModeForView(treeViews?.testElementsTree)
        },
        {
            id: constants_1.allExtensionCommands.toggleFilterDiffModeForTestElementsEnabled,
            handler: () => toggleDiffModeForView(treeViews?.testElementsTree)
        },
        {
            id: constants_1.allExtensionCommands.clearAllFiltersForProjects,
            handler: () => clearAllFiltersForView(treeViews?.projectsTree)
        },
        {
            id: constants_1.allExtensionCommands.clearAllFiltersForTestThemes,
            handler: () => clearAllFiltersForView(treeViews?.testThemesTree)
        },
        {
            id: constants_1.allExtensionCommands.clearAllFiltersForTestElements,
            handler: () => clearAllFiltersForView(treeViews?.testElementsTree)
        },
        // Other commands
        { id: constants_1.allExtensionCommands.clearInternalTestbenchFolder, handler: clearInternalFolder },
        { id: constants_1.allExtensionCommands.clearAllExtensionData, handler: () => clearAllExtensionData(context, true) },
        {
            id: constants_1.allExtensionCommands.showExtensionSettings,
            handler: () => vscode.commands.executeCommand("workbench.action.openSettings", "@ext:imbus.testbench-extension")
        },
        {
            id: constants_1.allExtensionCommands.updateOrRestartLS,
            handler: (projectName, tovName) => updateOrRestartLS(projectName, tovName)
        },
        {
            id: constants_1.allExtensionCommands.openOrCreateRobotResourceFile,
            handler: (item) => treeViews?.testElementsTree.openOrCreateRobotResourceFile(item)
        },
        {
            id: constants_1.allExtensionCommands.createInteractionUnderSubdivision,
            handler: (item) => treeViews?.testElementsTree.createInteraction(item)
        }
    ];
    // Registration Loop
    const existingCommands = await vscode.commands.getCommands();
    for (const { id, handler } of commandRegistry) {
        if (!existingCommands.includes(id)) {
            registerSafeCommand(context, id, handler);
        }
    }
}
/**
 * Handles changes in the TestBench authentication session with centralized tree management.
 *
 * @param {vscode.ExtensionContext} context - The VS Code extension context.
 * @param {vscode.AuthenticationSession} existingSession - An optional existing authentication session to process.
 */
async function handleTestBenchSessionChange(context, existingSession) {
    exports.logger.info(`[handleTestBenchSessionChange] Session changed. Processing... Has session: ${!!existingSession}`);
    let sessionToProcess = existingSession;
    if (!sessionToProcess) {
        try {
            sessionToProcess = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                createIfNone: false,
                silent: true
            });
        }
        catch (error) {
            exports.logger.warn("[Extension] Error getting current session during handleTestBenchSessionChange:", error);
            sessionToProcess = undefined;
        }
    }
    const wasPreviouslyConnected = !!exports.connection;
    if (sessionToProcess && sessionToProcess.accessToken) {
        const activeConnection = await connectionManager.getActiveConnection(context);
        if (activeConnection) {
            // Check if a connection for this session and connection already exists
            if (exports.connection &&
                exports.connection.getSessionToken() === sessionToProcess.accessToken &&
                exports.connection.getUsername() === activeConnection.username &&
                exports.connection.getServerName() === activeConnection.serverName &&
                exports.connection.getServerPort() === activeConnection.portNumber.toString()) {
                exports.logger.info(`[Extension] Connection for connection '${activeConnection.label}' and current session token is already active. Skipping re-initialization.`);
                return;
            }
            exports.logger.info(`[Extension] TestBench session active for connection: ${activeConnection.label}. Initializing PlayServerConnection.`);
            if (exports.connection) {
                exports.logger.warn("[Extension] A different connection was active. Logging out from previous server session before establishing new one.");
                await exports.connection.logoutUserOnServer();
            }
            const newConnection = new testBenchConnection_1.PlayServerConnection(activeConnection.serverName, activeConnection.portNumber, activeConnection.username, sessionToProcess.accessToken);
            setConnection(newConnection);
            await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, true);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
            // Refresh tree providers as the session has changed.
            if (!wasPreviouslyConnected ||
                (exports.connection && exports.connection.getSessionToken() !== newConnection.getSessionToken())) {
                exports.logger.info("[Extension] New session established. Refreshing project data.");
                try {
                    if (!treeViews) {
                        throw new Error("Tree views not initialized");
                    }
                    treeViews.clear();
                    treeViews.projectsTree.refresh();
                    // Check if we need to restore a view
                    const savedViewId = context.workspaceState.get(constants_1.StorageKeys.VISIBLE_VIEWS_STORAGE_KEY);
                    const savedCycleContext = context.workspaceState.get(constants_1.StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY);
                    const savedTovContext = context.workspaceState.get(constants_1.StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY);
                    const savedContext = savedCycleContext || savedTovContext;
                    let areViewsRestored = false;
                    if (savedViewId && savedViewId !== "projects" && savedContext) {
                        // Validate that the saved context has the required fields
                        const hasValidProjectName = savedContext.projectName && typeof savedContext.projectName === "string";
                        const hasValidTovName = savedContext.tovName && typeof savedContext.tovName === "string";
                        if (!hasValidProjectName || !hasValidTovName) {
                            exports.logger.warn(`Cannot restore view state: invalid context data. ` +
                                `projectName: ${savedContext.projectName}, tovName: ${savedContext.tovName}. ` +
                                `Clearing invalid state and loading default view.`);
                            // Clear the invalid state
                            await context.workspaceState.update(constants_1.StorageKeys.VISIBLE_VIEWS_STORAGE_KEY, undefined);
                            await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, undefined);
                            await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, undefined);
                        }
                        else {
                            // Attempt restoration after a short delay to ensure data is loaded
                            exports.logger.info(`Attempting to restore previous view: ${savedViewId}`);
                            try {
                                areViewsRestored = await performDeferredViewRestoration(context, savedViewId, savedContext);
                            }
                            catch (error) {
                                exports.logger.error("Failed to restore view state:", error);
                                areViewsRestored = false;
                            }
                        }
                    }
                    if (!areViewsRestored) {
                        // Fallback: Load default project view if no state or if restoration fails
                        exports.logger.info("Loading default projects view.");
                        treeViews.projectsTree.refresh();
                        await displayProjectManagementTreeView();
                        await hideTestThemeTreeView();
                        await hideTestElementsTreeView();
                    }
                }
                catch (error) {
                    exports.logger.warn("[Extension] Error managing trees during session change:", error);
                    // Ensure we have a working state even after error
                    if (treeViews) {
                        treeViews.projectsTree.refresh();
                        await displayProjectManagementTreeView();
                        await hideTestThemeTreeView();
                        await hideTestElementsTreeView();
                    }
                }
            }
        }
        else {
            exports.logger.warn("[Extension] Session exists, but no active connection. Clearing connection.");
            if (exports.connection) {
                await exports.connection.logoutUserOnServer();
            }
            exports.logger.debug("[Extension] No active connection. Clearing tree data.");
            if (treeViews) {
                treeViews.clear();
            }
        }
    }
    else {
        exports.logger.info("[Extension] No active session. Clearing connection.");
        if (exports.connection) {
            await exports.connection.logoutUserOnServer();
        }
        exports.logger.debug("[Extension] No active connection. Clearing tree data.");
        if (treeViews) {
            treeViews.clear();
        }
    }
}
/**
 * Saves the UI context to the workspace state for later restoration.
 * @param context The extension context.
 * @param viewId The ID of the currently visible primary view.
 * @param contextData The data required to restore the view (e.g., keys and names).
 */
async function saveUIContext(context, viewId, contextData) {
    await context.workspaceState.update(constants_1.StorageKeys.VISIBLE_VIEWS_STORAGE_KEY, viewId);
    if (viewId === "projects") {
        // Clear context if the main project view is active
        await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, undefined);
        await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, undefined);
    }
    else if (contextData) {
        // Validate contextData before saving
        const hasValidProjectName = contextData.projectName && typeof contextData.projectName === "string";
        const hasValidTovName = contextData.tovName && typeof contextData.tovName === "string";
        if (!hasValidProjectName || !hasValidTovName) {
            exports.logger.warn(`Cannot save UI context: invalid contextData. ` +
                `projectName: ${contextData.projectName}, tovName: ${contextData.tovName}. ` +
                `Clearing context state.`);
            // Clear context state instead of saving invalid data
            await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, undefined);
            await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, undefined);
            return;
        }
        // Differentiate between cycle and TOV context
        if (contextData.isCycle) {
            await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, contextData);
            await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, undefined);
        }
        else {
            await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, contextData);
            await context.workspaceState.update(constants_1.StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, undefined);
        }
    }
}
/* =============================================================================
   Extension Activation & Deactivation
   ============================================================================= */
/**
 * Called when the extension is activated.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function activate(context) {
    exports.logger = new testBenchLogger.TestBenchLogger();
    exports.logger.info("Extension activated.");
    (0, configuration_1.initializeConfigurationWatcher)();
    // Register AuthenticationProvider
    authProviderInstance = new testBenchAuthenticationProvider_1.TestBenchAuthenticationProvider(context);
    context.subscriptions.push(vscode.authentication.registerAuthenticationProvider(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_LABEL, authProviderInstance, { supportsMultipleAccounts: false }));
    exports.logger.info("TestBenchAuthenticationProvider registered.");
    // Session Change Listener
    context.subscriptions.push(vscode.authentication.onDidChangeSessions(async (e) => {
        if (e.provider.id === testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID) {
            if (isHandlingSessionChange) {
                exports.logger.trace("[Extension] onDidChangeSessions: Already handling a session change, skipping this invocation.");
                return;
            }
            isHandlingSessionChange = true;
            exports.logger.info("[Extension] TestBench authentication sessions changed.");
            try {
                const currentSession = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], { createIfNone: false, silent: true });
                exports.logger.info(`[Extension] Fetched current session in onDidChangeSessions: ${currentSession ? currentSession.id : "undefined"}`);
                await handleTestBenchSessionChange(context, currentSession);
            }
            catch (error) {
                exports.logger.error("[Extension] Error getting session in onDidChangeSessions listener:", error);
                await handleTestBenchSessionChange(context, undefined);
            }
            finally {
                isHandlingSessionChange = false;
            }
        }
    }));
    // Initialize tree views
    await initializeTreeViews(context);
    // Set the initial connection context state
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, exports.connection !== null);
    exports.logger.trace(`Initial connectionActive context set to: ${exports.connection !== null}`);
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false);
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);
    // Initialize filter diff mode context keys
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.FILTER_DIFF_MODE_ENABLED, false);
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.FILTER_DIFF_MODE_ENABLED_PROJECTS, false);
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_THEMES, false);
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_ELEMENTS, false);
    const isTTOpenedFromCycle = context.globalState.get(constants_1.StorageKeys.IS_TT_OPENED_FROM_CYCLE_STORAGE_KEY);
    await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.IS_TT_OPENED_FROM_CYCLE, isTTOpenedFromCycle);
    // Initialize login webview first
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));
    // Register all commands
    await registerExtensionCommands(context);
    // Attempt to restore session on activation
    exports.logger.trace("[Extension] Attempting to silently restore existing TestBench session on activation...");
    try {
        const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: false,
            silent: true
        });
        if (session) {
            exports.logger.info("[Extension] Found existing VS Code AuthenticationSession for TestBench during initial check.");
            await handleTestBenchSessionChange(context, session);
        }
        else {
            exports.logger.info("[Extension] No existing TestBench session found during initial check.");
            if (!(0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.AUTO_LOGIN, false)) {
                await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, false);
                getLoginWebViewProvider()?.updateWebviewHTMLContent();
            }
        }
    }
    catch (error) {
        exports.logger.warn("[Extension] Error trying to get initial session silently:", error);
        await vscode.commands.executeCommand("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, false);
    }
    // Trigger Automatic Login Command if configured
    if ((0, configuration_1.getExtensionConfiguration)().get(constants_1.ConfigKeys.AUTO_LOGIN, false)) {
        exports.logger.info("[Extension] Auto-login configured. Scheduling automatic login command.");
        // Short delay to ensure webview is loaded
        setTimeout(async () => {
            try {
                await vscode.commands.executeCommand(constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation);
            }
            catch (error) {
                exports.logger.warn("[Extension] Error during automatic login:", error);
            }
        }, constants_1.TreeViewTiming.WEBVIEW_LOAD_DELAY_MS);
    }
    else {
        exports.logger.info("[Extension] Auto-login is disabled. Skipping automatic login command.");
    }
    exports.logger.info("Extension activated successfully.");
}
/**
 * Updates or restarts the language server based on the current state.
 * @param projectName the name of the project to update or restart the language server for.
 * @param tovName the name of the TOV to update or restart the language server for.
 */
async function updateOrRestartLS(projectName, tovName) {
    if (!projectName || !tovName) {
        exports.logger.error("[Cmd] updateOrRestartLS called with invalid project or TOV name.");
        vscode.window.showErrorMessage("Invalid project or TOV name provided for language server update.");
        return;
    }
    const existingClient = (0, server_1.getLanguageClientInstance)();
    exports.logger.debug(`[Cmd] updateOrRestartLS called with projectName: ${projectName}, tovName: ${tovName}, existingClient state: ${existingClient ? existingClient.state : "none"}`);
    if (existingClient && existingClient.state !== node_1.State.Stopped && existingClient.state !== node_1.State.Starting) {
        exports.logger.debug(`[Cmd] Updating language client with project name: ${projectName}, TOV name: ${tovName}`);
        await vscode.commands.executeCommand("testbench_ls.updateProject", projectName);
        await vscode.commands.executeCommand("testbench_ls.updateTov", tovName);
    }
    else {
        await (0, server_1.restartLanguageClient)(projectName, tovName);
    }
}
/**
 * Called when the extension is deactivated.
 */
async function deactivate() {
    try {
        if (exports.connection) {
            exports.logger.info("[Extension] Performing server logout on deactivation.");
            await exports.connection.logoutUserOnServer();
        }
        if (server_1.client) {
            exports.logger.info("[Extension] Attempting to stop language server on deactivation.");
            await (0, server_1.stopLanguageClient)(true);
            exports.logger.info("[Extension] Language server stopped on deactivation.");
        }
        if (treeViews) {
            exports.logger.info("[Extension] Disposing TreeViews on deactivation.");
            treeViews.projectsTree.dispose();
            treeViews.testThemesTree.dispose();
            treeViews.testElementsTree.dispose();
            treeViews = null;
        }
        exports.logger.info("Extension deactivated.");
    }
    catch (error) {
        exports.logger.error("Error during deactivation:", error);
    }
}
/**
 * Utility function to clear all extension data.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {boolean} showConfirmation Whether to show a confirmation dialog (default: false for programmatic calls).
 * @returns {Promise<boolean>} True if data was cleared successfully, false if cancelled or failed.
 */
async function clearAllExtensionData(context, showConfirmation = false) {
    try {
        if (showConfirmation) {
            const confirmation = await vscode.window.showWarningMessage("This will clear ALL TestBench extension data including:\n\n" +
                "• All saved connections and passwords\n" +
                "• Current login session\n" +
                "• Tree view states and custom roots\n" +
                "• Test generation history\n" +
                "• Import tracking data\n" +
                "• All persistent settings\n\n" +
                "This action cannot be undone. Are you sure you want to continue?", { modal: true }, "Clear All Data", "Cancel");
            if (confirmation !== "Clear All Data") {
                exports.logger.info("[clearAllExtensionData] User cancelled clear all extension data operation.");
                return false;
            }
        }
        exports.logger.info("[clearAllExtensionData] Starting comprehensive extension data cleanup...");
        // Logout user and clear connection
        if (exports.connection) {
            exports.logger.debug("[clearAllExtensionData] Logging out from server...");
            try {
                await exports.connection.logoutUserOnServer();
            }
            catch (error) {
                exports.logger.warn("[clearAllExtensionData] Error logging out from server:", error);
            }
            setConnection(null);
        }
        // Clear all VS Code authentication sessions
        try {
            exports.logger.debug("[clearAllExtensionData] Clearing VS Code authentication sessions...");
            const session = await vscode.authentication.getSession(testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, [], {
                createIfNone: false,
                silent: true
            });
            if (session && authProviderInstance) {
                await authProviderInstance.removeSession(session.id);
            }
        }
        catch (error) {
            exports.logger.warn("[clearAllExtensionData] Error clearing authentication session:", error);
        }
        // Clear all workspace state storage
        exports.logger.debug("[clearAllExtensionData] Clearing workspace state storage...");
        const workspaceStateKeys = [
            constants_1.StorageKeys.LAST_GENERATED_PARAMS,
            constants_1.StorageKeys.MARKED_TEST_GENERATION_ITEM,
            constants_1.StorageKeys.SUB_TREE_ITEM_IMPORT_STORAGE_KEY,
            `${constants_1.StorageKeys.SUB_TREE_ITEM_IMPORT_STORAGE_KEY}_last`,
            constants_1.StorageKeys.VISIBLE_VIEWS_STORAGE_KEY,
            constants_1.StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY,
            constants_1.StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY,
            constants_1.StorageKeys.CUSTOM_ROOT_PROJECT_TREE,
            constants_1.StorageKeys.CUSTOM_ROOT_TEST_THEME_TREE,
            constants_1.StorageKeys.CUSTOM_ROOT_TEST_ELEMENTS_TREE,
            constants_1.StorageKeys.IS_TT_OPENED_FROM_CYCLE_STORAGE_KEY,
            constants_1.StorageKeys.HAS_USED_EXTENSION_BEFORE,
            `${constants_1.StorageKeys.MARKED_TEST_GENERATION_ITEM}_hierarchies`
        ];
        for (const key of workspaceStateKeys) {
            try {
                await context.workspaceState.update(key, undefined);
            }
            catch (error) {
                exports.logger.warn(`[clearAllExtensionData] Error clearing workspace state key ${key}:`, error);
            }
        }
        // Clear all global state storage (connections, active connection)
        exports.logger.debug("[clearAllExtensionData] Clearing global state storage...");
        const globalStateKeys = [constants_1.StorageKeys.CONNECTIONS_STORAGE_KEY, constants_1.StorageKeys.ACTIVE_CONNECTION_ID_KEY];
        for (const key of globalStateKeys) {
            try {
                await context.globalState.update(key, undefined);
            }
            catch (error) {
                exports.logger.warn(`[clearAllExtensionData] Error clearing global state key ${key}:`, error);
            }
        }
        // Clear all connection passwords from secret storage
        exports.logger.debug("[clearAllExtensionData] Clearing connection passwords from secret storage...");
        try {
            const connections = await connectionManager.getConnections(context);
            for (const conn of connections) {
                try {
                    await context.secrets.delete(constants_1.StorageKeys.CONNECTION_PASSWORD_SECRET_PREFIX + conn.id);
                    exports.logger.trace(`[clearAllExtensionData] Cleared password for connection: ${conn.label}`);
                }
                catch (error) {
                    exports.logger.warn(`[clearAllExtensionData] Error clearing password for connection ${conn.label}:`, error);
                }
            }
        }
        catch (error) {
            exports.logger.warn("[clearAllExtensionData] Error clearing connection passwords:", error);
        }
        // Clear tree data and state
        if (treeViews) {
            exports.logger.debug("[clearAllExtensionData] Clearing tree data and state...");
            try {
                treeViews.clear();
            }
            catch (error) {
                exports.logger.warn("[clearAllExtensionData] Error clearing tree data:", error);
            }
        }
        // Update UI state by updating context keys
        exports.logger.debug("[clearAllExtensionData] Updating UI state...");
        const contextUpdates = [
            ["setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, false],
            ["setContext", constants_1.ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false],
            ["setContext", constants_1.ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false],
            ["setContext", constants_1.ContextKeys.IS_TT_OPENED_FROM_CYCLE, false]
        ];
        for (const [command, key, value] of contextUpdates) {
            try {
                await vscode.commands.executeCommand(command, key, value);
            }
            catch (error) {
                exports.logger.warn(`[clearAllExtensionData] Error updating context ${key}:`, error);
            }
        }
        // Update login webview to reflect the new clean state
        exports.logger.debug("[clearAllExtensionData] Updating login webview...");
        try {
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
        }
        catch (error) {
            exports.logger.warn("[clearAllExtensionData] Error updating login webview:", error);
        }
        // Stop language client if running
        if (server_1.client) {
            exports.logger.debug("[clearAllExtensionData] Stopping language client...");
            try {
                await (0, server_1.stopLanguageClient)(true);
            }
            catch (error) {
                exports.logger.warn("[clearAllExtensionData] Error stopping language client:", error);
            }
        }
        // Clear internal testbench folder
        exports.logger.debug("[clearAllExtensionData] Clearing internal testbench folder...");
        try {
            const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
            if (workspaceLocation) {
                const testbenchWorkingDirectoryPath = path_1.default.join(workspaceLocation, constants_1.folderNameOfInternalTestbenchFolder);
                await utils.clearInternalTestbenchFolder(testbenchWorkingDirectoryPath, [testBenchLogger.folderNameOfLogs], // Exclude logs folder
                false);
            }
        }
        catch (error) {
            exports.logger.warn("[clearAllExtensionData] Error clearing internal testbench folder:", error);
        }
        // Show projects view and hide other views to ensure proper UI state
        try {
            await displayProjectManagementTreeView();
            await hideTestThemeTreeView();
            await hideTestElementsTreeView();
        }
        catch (error) {
            exports.logger.warn("[clearAllExtensionData] Error managing view visibility:", error);
        }
        exports.logger.info("[clearAllExtensionData] All extension data cleared successfully.");
        if (showConfirmation) {
            vscode.window.showInformationMessage("All TestBench extension data has been cleared successfully. You will need to log in again to use the extension.");
        }
        return true;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        exports.logger.error(`[clearAllExtensionData] Error during clear all extension data operation: ${errorMessage}`, error);
        if (showConfirmation) {
            vscode.window.showErrorMessage(`Error clearing extension data: ${errorMessage}`);
        }
        return false;
    }
}
//# sourceMappingURL=extension.js.map