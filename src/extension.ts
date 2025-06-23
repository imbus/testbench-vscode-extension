/**
 * @file src/extension.ts
 * @description Main entry point for the TestBench VS Code extension.
 */

// Before releasing the extension:
// TODO: Add License.md to the extension
// TODO: Set logger level to info or debug in production, remove too detailed logs.
// TODO: In production, remove process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; in connection class.
// Note: A virtual python environment is required for the extension to work + an empty pyproject.toml in workspace root.

import * as vscode from "vscode";
import * as testBenchLogger from "./testBenchLogger";
import * as testBenchConnection from "./testBenchConnection";
import * as loginWebView from "./loginWebView";
import {
    allExtensionCommands,
    ConfigKeys,
    ContextKeys,
    folderNameOfInternalTestbenchFolder,
    StorageKeys,
    TreeViewTiming
} from "./constants";
import { client, restartLanguageClient, stopLanguageClient, getLanguageClientInstance } from "./server";
import { State } from "vscode-languageclient/node";
import {
    TestBenchAuthenticationProvider,
    TESTBENCH_AUTH_PROVIDER_ID,
    TESTBENCH_AUTH_PROVIDER_LABEL
} from "./testBenchAuthenticationProvider";
import * as connectionManager from "./connectionManager";
import { PlayServerConnection } from "./testBenchConnection";
import { getExtensionConfiguration, initializeConfigurationWatcher } from "./configuration";
import { TestThemesTreeItem } from "./treeViews/implementations/testThemes/TestThemesTreeItem";
import { createAllTreeViews, TestElementsTreeItem, TreeViewBase, TreeViews } from "./treeViews";
import { ProjectsTreeItem } from "./treeViews/implementations/projects/ProjectsTreeItem";
import * as reportHandler from "./reportHandler";
import * as utils from "./utils";
import path from "path";
import { FilterService } from "./treeViews/utils/FilterService";

/* =============================================================================
   Constants, Global Variables & Exports
   ============================================================================= */

// Global logger instance.
export let logger: testBenchLogger.TestBenchLogger;
export function setLogger(newLogger: testBenchLogger.TestBenchLogger): void {
    logger = newLogger;
}

// Global connection to the (new) TestBench Play server.
export let connection: testBenchConnection.PlayServerConnection | null = null;
export function setConnection(newConnection: testBenchConnection.PlayServerConnection | null): void {
    connection = newConnection;
}
export function getConnection(): testBenchConnection.PlayServerConnection | null {
    return connection;
}

// Login webview provider instance.
let loginWebViewProvider: loginWebView.LoginWebViewProvider | null = null;
export function getLoginWebViewProvider(): loginWebView.LoginWebViewProvider | null {
    return loginWebViewProvider;
}

// Global tree views instance
let treeViews: TreeViews | null = null;
let extensionContext: vscode.ExtensionContext;

// Double-click handling
let lastCycleClick = { id: "", timestamp: 0 };

// Global variable to store the authentication provider instance
let authProviderInstance: TestBenchAuthenticationProvider | null = null;

// Prevent multiple session change handling simultaneously
let isHandlingSessionChange: boolean = false;

// Determines if the icon of the tree item should be changed after generating tests for that item.
export const ENABLE_ICON_MARKING_ON_TEST_GENERATION: boolean = true;
// Determines if the import button of the tree item should still persist after importing test results for that item.
export const ALLOW_PERSISTENT_IMPORT_BUTTON: boolean = true;

/**
 * Wraps a command handler with error handling to prevent the extension from crashing due to unhandled exceptions in commands.
 * It takes a handler function as input and returns a new function that executes the original handler inside a try/catch block.
 *
 * @param handler The async function to execute.
 * @returns A new async function that wraps the handler with try/catch.
 */
export function safeCommandHandler(handler: (...args: any[]) => any): (...args: any[]) => Promise<void> {
    return async (...args: any[]) => {
        try {
            await handler(...args);
        } catch (error) {
            const errorMessage: string = error instanceof Error ? error.message : "An unknown error occurred";
            logger.error(`Error executing command: ${errorMessage}`, error);
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
function registerSafeCommand(
    context: vscode.ExtensionContext,
    commandId: string,
    callback: (...args: any[]) => any
): void {
    const disposable: vscode.Disposable = vscode.commands.registerCommand(commandId, async (...args: any[]) => {
        try {
            await callback(...args);
        } catch (error: any) {
            // Errors expected in silent auto-login, dont show error message to user.
            if (commandId === allExtensionCommands.automaticLoginAfterExtensionActivation) {
                logger.warn(
                    `Command ${commandId} error (expected for silent auto-login if conditions not met): ${error.message}`
                );
            } else {
                logger.error(`Command ${commandId} error: ${error.message}`, error);
                vscode.window.showErrorMessage(`Command ${commandId} failed: ${error.message}`);
            }
        }
    });
    context.subscriptions.push(disposable);
}

/**
 * Utility functions for tree view visibility management
 */
async function hideProjectManagementTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    vscode.commands.executeCommand("setContext", ContextKeys.SHOW_PROJECTS_TREE, false);
}

async function displayProjectManagementTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_PROJECTS_TREE, true);
    // Set the active tree view for filtering
    const filterService = FilterService.getInstance();
    filterService.setActiveTreeViewByContext(treeViews, "testbenchExtension.showProjectsTree");
}

async function hideTestThemeTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_THEMES_TREE, false);
}

async function displayTestThemeTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_THEMES_TREE, true);
    // Set the active tree view for filtering
    const filterService = FilterService.getInstance();
    filterService.setActiveTreeViewByContext(treeViews, "testbenchExtension.showTestThemesTree");
}

async function hideTestElementsTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_ELEMENTS_TREE, false);
}

async function displayTestElementsTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_ELEMENTS_TREE, true);
    // Set the active tree view for filtering
    const filterService = FilterService.getInstance();
    filterService.setActiveTreeViewByContext(treeViews, "testbenchExtension.showTestElementsTree");
}

/**
 * Initializes all tree views using the new tree framework.
 */
export async function initializeTreeViews(context: vscode.ExtensionContext): Promise<void> {
    extensionContext = context;

    if (treeViews) {
        treeViews.dispose();
    }

    try {
        treeViews = createAllTreeViews(extensionContext, getConnection);
        await treeViews.initialize();

        // Check for saved view state before setting default visibility
        const savedViewId = context.workspaceState.get<string>(StorageKeys.VISIBLE_VIEWS_STORAGE_KEY);
        const savedCycleContext = context.workspaceState.get<any>(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY);
        const savedTovContext = context.workspaceState.get<any>(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY);
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

        await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_PROJECTS_TREE, showProjects);
        await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_THEMES_TREE, showTestThemes);
        await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_ELEMENTS_TREE, showTestElements);

        logger.info("Tree views initialized successfully");
    } catch (error) {
        logger.error("Failed to initialize tree views:", error);
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
async function performDeferredViewRestoration(
    context: vscode.ExtensionContext,
    savedViewId: string,
    savedContext: any
): Promise<boolean> {
    if (!treeViews) {
        return false;
    }

    try {
        logger.info(`Performing deferred view restoration for: ${savedViewId}`);

        await updateOrRestartLS(savedContext.projectName, savedContext.tovName);

        if (savedContext.isCycle) {
            await treeViews.testThemesTree.loadCycle(
                savedContext.projectKey,
                savedContext.cycleKey,
                savedContext.cycleLabel
            );
        } else {
            await treeViews.testThemesTree.loadTov(savedContext.projectKey, savedContext.tovKey);
        }

        await treeViews.testElementsTree.loadTov(savedContext.tovKey, savedContext.tovName);

        // Update visibility to show the restored views
        await displayTestThemeTreeView();
        await displayTestElementsTreeView();
        await hideProjectManagementTreeView();

        logger.info(`Successfully restored view to context of TOV: ${savedContext.tovName}`);
        return true;
    } catch (error) {
        logger.error("Failed to restore view state:", error);
        return false;
    }
}

/**
 * Registers all extension commands.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function registerExtensionCommands(context: vscode.ExtensionContext): Promise<void> {
    if (!treeViews) {
        logger.warn("Tree views not initialized. Skipping command registration.");
        return;
    }

    // --- Command Handlers ---
    const handleAutomaticLogin = async () => {
        logger.debug(`[Cmd] Called: ${allExtensionCommands.automaticLoginAfterExtensionActivation}`);
        const config = getExtensionConfiguration();
        if (config.get(ConfigKeys.AUTO_LOGIN)) {
            const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                createIfNone: true
            });
            if (session) {
                await handleTestBenchSessionChange(context, session);
            }
        }
    };

    const handleLogin = async () => {
        logger.debug(`[Cmd] Called: ${allExtensionCommands.login}`);
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: true
        });
        if (session) {
            await handleTestBenchSessionChange(context, session);
        }
    };

    const handleLogout = async () => {
        logger.debug("[Cmd] Called: logout");
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            silent: true
        });
        if (session && authProviderInstance) {
            // Remove the session to fire onDidChangeSessions and trigger proper UI cleanup.
            await authProviderInstance.removeSession(session.id);
            logger.info(`[Cmd] Session ${session.id} removed by logout command.`);
        }
        // Fallback to ensure UI is reset if a connection object still exists without a session.
        if (connection !== null) {
            await handleTestBenchSessionChange(context, undefined);
        }
    };

    const handleProjectCycleClick = async (cycleItem: ProjectsTreeItem) => {
        logger.debug(`[Cmd] Called: ${allExtensionCommands.handleProjectCycleClick} for item ${cycleItem.label}`);
        const now = Date.now();
        const isDoubleClick =
            lastCycleClick.id === cycleItem.id &&
            now - lastCycleClick.timestamp < TreeViewTiming.DOUBLE_CLICK_THRESHOLD_MS;

        if (isDoubleClick) {
            logger.debug(`Cycle item double-clicked: ${cycleItem.label}`);
            await displayTestThemeTreeView();
            await displayTestElementsTreeView();
            await hideProjectManagementTreeView();
            lastCycleClick = { id: "", timestamp: 0 };
        } else {
            if (cycleItem.id) {
                lastCycleClick = { id: cycleItem.id, timestamp: now };
            }
            logger.debug(`Cycle item single-clicked: ${cycleItem.label}`);

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
                    logger.debug(`Loading test elements for TOV ${versionKey} (from cycle ${cycleKey})`);
                    await treeViews.testElementsTree.loadTov(versionKey, tovName);
                }
            } else {
                throw new Error("Invalid cycle item: missing project, cycle, or version key");
            }
        }
    };

    const handleOpenTOV = async (tovItem: ProjectsTreeItem) => {
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

    const handleOpenCycle = async (cycleItem: ProjectsTreeItem) => {
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
        } else {
            throw new Error("Invalid cycle item: missing project, cycle, or version key");
        }
    };

    const handleGenerateForCycle = async (cycleItem: ProjectsTreeItem) => {
        const projectName = cycleItem.parent?.parent?.label?.toString();
        const tovName = cycleItem.parent?.label?.toString();
        await updateOrRestartLS(projectName, tovName);
        await reportHandler.startTestGenerationForCycle(context, cycleItem);
    };

    const clearInternalFolder = async () => {
        logger.debug(`Command Called: ${allExtensionCommands.clearInternalTestbenchFolder}`);
        const workspaceLocation = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            return;
        }
        const testbenchWorkingDirectoryPath = path.join(workspaceLocation, folderNameOfInternalTestbenchFolder);
        await utils.clearInternalTestbenchFolder(
            testbenchWorkingDirectoryPath,
            [testBenchLogger.folderNameOfLogs],
            !getExtensionConfiguration().get<boolean>(ConfigKeys.CLEAR_INTERNAL_DIR)
        );
    };

    const setFilterForView = async (treeView: TreeViewBase<any> | undefined) => {
        if (!treeView) {
            return;
        }
        const filterService = FilterService.getInstance();
        filterService.setActiveTreeView(treeView);
        await filterService.showTextFilterDialog();
    };

    const clearFilterForView = async (treeView: TreeViewBase<any> | undefined) => {
        if (!treeView) {
            return;
        }
        const filterService = FilterService.getInstance();
        filterService.setActiveTreeView(treeView);
        await filterService.clearTextFilter();
    };

    const toggleDiffModeForView = async (treeView: TreeViewBase<any> | undefined) => {
        if (!treeView) {
            return;
        }
        const filterService = FilterService.getInstance();
        filterService.setActiveTreeView(treeView);
        await filterService.toggleFilterDiffMode();
    };

    const clearAllFiltersForView = async (treeView: TreeViewBase<any> | undefined) => {
        if (!treeView) {
            return;
        }
        const filterService = FilterService.getInstance();
        filterService.setActiveTreeView(treeView);
        await filterService.clearAllFilters();
    };

    // --- Command Registry ---
    const commandRegistry = [
        // Authentication and Session
        { id: allExtensionCommands.automaticLoginAfterExtensionActivation, handler: handleAutomaticLogin },
        { id: allExtensionCommands.login, handler: handleLogin },
        { id: allExtensionCommands.logout, handler: handleLogout },

        // Tree Interaction & Navigation
        { id: allExtensionCommands.handleProjectCycleClick, handler: handleProjectCycleClick },
        { id: allExtensionCommands.openTOVFromProjectsView, handler: handleOpenTOV },
        { id: allExtensionCommands.openCycleFromProjectsView, handler: handleOpenCycle },
        {
            id: allExtensionCommands.displayAllProjects,
            handler: async () => {
                displayProjectManagementTreeView();
                hideTestThemeTreeView();
                hideTestElementsTreeView();
                await saveUIContext(context, "projects");
            }
        },

        // Test Generation
        {
            id: allExtensionCommands.generateTestCasesForTOV,
            handler: (item: ProjectsTreeItem) => treeViews?.projectsTree.generateTestCasesForTOV(item)
        },
        { id: allExtensionCommands.generateTestCasesForCycle, handler: handleGenerateForCycle },
        {
            id: allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet,
            handler: (item: TestThemesTreeItem) => treeViews?.testThemesTree.generateTestCases(item)
        },
        {
            id: allExtensionCommands.generateTestsForTestThemeTreeItemFromTOV,
            handler: (item: TestThemesTreeItem) => treeViews?.testThemesTree.generateTestCases(item)
        },

        // Read and Import Test Results for Test Theme Tree Item
        {
            id: allExtensionCommands.readAndImportTestResultsToTestbench,
            handler: (item: TestThemesTreeItem) => treeViews?.testThemesTree.importTestResultsForTestThemeTreeItem(item)
        },

        // Tree View Management
        { id: allExtensionCommands.refreshProjectTreeView, handler: () => treeViews?.projectsTree.refresh() },
        { id: allExtensionCommands.refreshTestThemeTreeView, handler: () => treeViews?.testThemesTree.refresh() },
        { id: allExtensionCommands.refreshTestElementsTree, handler: () => treeViews?.testElementsTree.refresh() },
        {
            id: allExtensionCommands.makeRoot,
            handler: (item: any) => {
                if (treeViews?.projectsTree && item.data?.type === "project") {
                    treeViews?.projectsTree.makeRoot(item);
                } else if (treeViews?.testThemesTree && item.data?.type?.includes("TestTheme")) {
                    treeViews?.testThemesTree.makeRoot(item);
                }
            }
        },
        { id: allExtensionCommands.resetProjectTreeViewRoot, handler: () => treeViews?.projectsTree.resetCustomRoot() },
        {
            id: allExtensionCommands.resetTestThemeTreeViewRoot,
            handler: () => treeViews?.testThemesTree.resetCustomRoot()
        },

        // Tree View Filtering Commands
        { id: allExtensionCommands.setTextFilterForProjects, handler: () => setFilterForView(treeViews?.projectsTree) },
        {
            id: allExtensionCommands.setTextFilterForTestThemes,
            handler: () => setFilterForView(treeViews?.testThemesTree)
        },
        {
            id: allExtensionCommands.setTextFilterForTestElements,
            handler: () => setFilterForView(treeViews?.testElementsTree)
        },
        {
            id: allExtensionCommands.clearTextFilterForProjects,
            handler: () => clearFilterForView(treeViews?.projectsTree)
        },
        {
            id: allExtensionCommands.clearTextFilterForTestThemes,
            handler: () => clearFilterForView(treeViews?.testThemesTree)
        },
        {
            id: allExtensionCommands.clearTextFilterForTestElements,
            handler: () => clearFilterForView(treeViews?.testElementsTree)
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForProjects,
            handler: () => toggleDiffModeForView(treeViews?.projectsTree)
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForProjectsEnabled,
            handler: () => toggleDiffModeForView(treeViews?.projectsTree)
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForTestThemes,
            handler: () => toggleDiffModeForView(treeViews?.testThemesTree)
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForTestThemesEnabled,
            handler: () => toggleDiffModeForView(treeViews?.testThemesTree)
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForTestElements,
            handler: () => toggleDiffModeForView(treeViews?.testElementsTree)
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForTestElementsEnabled,
            handler: () => toggleDiffModeForView(treeViews?.testElementsTree)
        },
        {
            id: allExtensionCommands.clearAllFiltersForProjects,
            handler: () => clearAllFiltersForView(treeViews?.projectsTree)
        },
        {
            id: allExtensionCommands.clearAllFiltersForTestThemes,
            handler: () => clearAllFiltersForView(treeViews?.testThemesTree)
        },
        {
            id: allExtensionCommands.clearAllFiltersForTestElements,
            handler: () => clearAllFiltersForView(treeViews?.testElementsTree)
        },

        // Other commands
        { id: allExtensionCommands.clearInternalTestbenchFolder, handler: clearInternalFolder },
        { id: allExtensionCommands.clearAllExtensionData, handler: () => clearAllExtensionData(context, true) },
        {
            id: allExtensionCommands.showExtensionSettings,
            handler: () =>
                vscode.commands.executeCommand("workbench.action.openSettings", "@ext:imbus.testbench-extension")
        },
        {
            id: allExtensionCommands.updateOrRestartLS,
            handler: (projectName: string | undefined, tovName: string | undefined) =>
                updateOrRestartLS(projectName, tovName)
        },
        {
            id: allExtensionCommands.openOrCreateRobotResourceFile,
            handler: (item: TestElementsTreeItem) => treeViews?.testElementsTree.openOrCreateRobotResourceFile(item)
        },
        {
            id: allExtensionCommands.createInteractionUnderSubdivision,
            handler: (item: TestElementsTreeItem) => treeViews?.testElementsTree.createInteraction(item)
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
async function handleTestBenchSessionChange(
    context: vscode.ExtensionContext,
    existingSession?: vscode.AuthenticationSession
): Promise<void> {
    logger.info(`[handleTestBenchSessionChange] Session changed. Processing... Has session: ${!!existingSession}`);
    let sessionToProcess = existingSession;
    if (!sessionToProcess) {
        try {
            sessionToProcess = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                createIfNone: false,
                silent: true
            });
        } catch (error) {
            logger.warn("[Extension] Error getting current session during handleTestBenchSessionChange:", error);
            sessionToProcess = undefined;
        }
    }

    const wasPreviouslyConnected = !!connection;

    if (sessionToProcess && sessionToProcess.accessToken) {
        const activeConnection = await connectionManager.getActiveConnection(context);
        if (activeConnection) {
            // Check if a connection for this session and connection already exists
            if (
                connection &&
                connection.getSessionToken() === sessionToProcess.accessToken &&
                connection.getUsername() === activeConnection.username &&
                connection.getServerName() === activeConnection.serverName &&
                connection.getServerPort() === activeConnection.portNumber.toString()
            ) {
                logger.info(
                    `[Extension] Connection for connection '${activeConnection.label}' and current session token is already active. Skipping re-initialization.`
                );
                return;
            }

            logger.info(
                `[Extension] TestBench session active for connection: ${activeConnection.label}. Initializing PlayServerConnection.`
            );

            if (connection) {
                logger.warn(
                    "[Extension] A different connection was active. Logging out from previous server session before establishing new one."
                );
                await connection.logoutUserOnServer();
            }

            const newConnection = new PlayServerConnection(
                activeConnection.serverName,
                activeConnection.portNumber,
                activeConnection.username,
                sessionToProcess.accessToken
            );
            setConnection(newConnection);
            await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, true);
            getLoginWebViewProvider()?.updateWebviewHTMLContent();

            // Refresh tree providers as the session has changed.
            if (
                !wasPreviouslyConnected ||
                (connection && connection.getSessionToken() !== newConnection.getSessionToken())
            ) {
                logger.info("[Extension] New session established. Refreshing project data.");
                try {
                    if (!treeViews) {
                        throw new Error("Tree views not initialized");
                    }

                    treeViews.clear();
                    treeViews.projectsTree.refresh();

                    // Check if we need to restore a view
                    const savedViewId = context.workspaceState.get<string>(StorageKeys.VISIBLE_VIEWS_STORAGE_KEY);
                    const savedCycleContext = context.workspaceState.get<any>(
                        StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY
                    );
                    const savedTovContext = context.workspaceState.get<any>(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY);
                    const savedContext = savedCycleContext || savedTovContext;

                    let areViewsRestored = false;
                    if (savedViewId && savedViewId !== "projects" && savedContext) {
                        // Validate that the saved context has the required fields
                        const hasValidProjectName =
                            savedContext.projectName && typeof savedContext.projectName === "string";
                        const hasValidTovName = savedContext.tovName && typeof savedContext.tovName === "string";

                        if (!hasValidProjectName || !hasValidTovName) {
                            logger.warn(
                                `Cannot restore view state: invalid context data. ` +
                                    `projectName: ${savedContext.projectName}, tovName: ${savedContext.tovName}. ` +
                                    `Clearing invalid state and loading default view.`
                            );
                            // Clear the invalid state
                            await context.workspaceState.update(StorageKeys.VISIBLE_VIEWS_STORAGE_KEY, undefined);
                            await context.workspaceState.update(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, undefined);
                            await context.workspaceState.update(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, undefined);
                        } else {
                            // Attempt restoration after a short delay to ensure data is loaded
                            logger.info(`Attempting to restore previous view: ${savedViewId}`);
                            try {
                                areViewsRestored = await performDeferredViewRestoration(
                                    context,
                                    savedViewId,
                                    savedContext
                                );
                            } catch (error) {
                                logger.error("Failed to restore view state:", error);
                                areViewsRestored = false;
                            }
                        }
                    }

                    if (!areViewsRestored) {
                        // Fallback: Load default project view if no state or if restoration fails
                        logger.info("Loading default projects view.");
                        treeViews.projectsTree.refresh();
                        await displayProjectManagementTreeView();
                        await hideTestThemeTreeView();
                        await hideTestElementsTreeView();
                    }
                } catch (error) {
                    logger.warn("[Extension] Error managing trees during session change:", error);
                    // Ensure we have a working state even after error
                    if (treeViews) {
                        treeViews.projectsTree.refresh();
                        await displayProjectManagementTreeView();
                        await hideTestThemeTreeView();
                        await hideTestElementsTreeView();
                    }
                }
            }
        } else {
            logger.warn("[Extension] Session exists, but no active connection. Clearing connection.");
            if (connection) {
                await connection.logoutUserOnServer();
            }

            logger.debug("[Extension] No active connection. Clearing tree data.");
            if (treeViews) {
                treeViews.clear();
            }
        }
    } else {
        logger.info("[Extension] No active session. Clearing connection.");
        if (connection) {
            await connection.logoutUserOnServer();
        }

        logger.debug("[Extension] No active connection. Clearing tree data.");
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
async function saveUIContext(
    context: vscode.ExtensionContext,
    viewId: "projects" | "testThemes" | "testElements",
    contextData?: any
) {
    await context.workspaceState.update(StorageKeys.VISIBLE_VIEWS_STORAGE_KEY, viewId);

    if (viewId === "projects") {
        // Clear context if the main project view is active
        await context.workspaceState.update(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, undefined);
        await context.workspaceState.update(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, undefined);
    } else if (contextData) {
        // Validate contextData before saving
        const hasValidProjectName = contextData.projectName && typeof contextData.projectName === "string";
        const hasValidTovName = contextData.tovName && typeof contextData.tovName === "string";

        if (!hasValidProjectName || !hasValidTovName) {
            logger.warn(
                `Cannot save UI context: invalid contextData. ` +
                    `projectName: ${contextData.projectName}, tovName: ${contextData.tovName}. ` +
                    `Clearing context state.`
            );
            // Clear context state instead of saving invalid data
            await context.workspaceState.update(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, undefined);
            await context.workspaceState.update(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, undefined);
            return;
        }

        // Differentiate between cycle and TOV context
        if (contextData.isCycle) {
            await context.workspaceState.update(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, contextData);
            await context.workspaceState.update(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, undefined);
        } else {
            await context.workspaceState.update(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, contextData);
            await context.workspaceState.update(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, undefined);
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
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger = new testBenchLogger.TestBenchLogger();
    logger.info("Extension activated.");
    initializeConfigurationWatcher();

    // Register AuthenticationProvider
    authProviderInstance = new TestBenchAuthenticationProvider(context);
    context.subscriptions.push(
        vscode.authentication.registerAuthenticationProvider(
            TESTBENCH_AUTH_PROVIDER_ID,
            TESTBENCH_AUTH_PROVIDER_LABEL,
            authProviderInstance,
            { supportsMultipleAccounts: false }
        )
    );
    logger.info("TestBenchAuthenticationProvider registered.");

    // Session Change Listener
    context.subscriptions.push(
        vscode.authentication.onDidChangeSessions(async (e) => {
            if (e.provider.id === TESTBENCH_AUTH_PROVIDER_ID) {
                if (isHandlingSessionChange) {
                    logger.trace(
                        "[Extension] onDidChangeSessions: Already handling a session change, skipping this invocation."
                    );
                    return;
                }
                isHandlingSessionChange = true;
                logger.info("[Extension] TestBench authentication sessions changed.");
                try {
                    const currentSession = await vscode.authentication.getSession(
                        TESTBENCH_AUTH_PROVIDER_ID,
                        ["api_access"],
                        { createIfNone: false, silent: true }
                    );
                    logger.info(
                        `[Extension] Fetched current session in onDidChangeSessions: ${currentSession ? currentSession.id : "undefined"}`
                    );
                    await handleTestBenchSessionChange(context, currentSession);
                } catch (error) {
                    logger.error("[Extension] Error getting session in onDidChangeSessions listener:", error);
                    await handleTestBenchSessionChange(context, undefined);
                } finally {
                    isHandlingSessionChange = false;
                }
            }
        })
    );

    // Initialize tree views
    await initializeTreeViews(context);

    // Set the initial connection context state
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, connection !== null);
    logger.trace(`Initial connectionActive context set to: ${connection !== null}`);

    await vscode.commands.executeCommand("setContext", ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false);
    await vscode.commands.executeCommand("setContext", ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);

    // Initialize filter diff mode context keys
    await vscode.commands.executeCommand("setContext", ContextKeys.FILTER_DIFF_MODE_ENABLED, false);
    await vscode.commands.executeCommand("setContext", ContextKeys.FILTER_DIFF_MODE_ENABLED_PROJECTS, false);
    await vscode.commands.executeCommand("setContext", ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_THEMES, false);
    await vscode.commands.executeCommand("setContext", ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_ELEMENTS, false);

    const isTTOpenedFromCycle = context.globalState.get<string | undefined>(
        StorageKeys.IS_TT_OPENED_FROM_CYCLE_STORAGE_KEY
    );
    await vscode.commands.executeCommand("setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, isTTOpenedFromCycle);

    // Initialize login webview first
    loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Register all commands
    await registerExtensionCommands(context);

    // Attempt to restore session on activation
    logger.trace("[Extension] Attempting to silently restore existing TestBench session on activation...");
    try {
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: false,
            silent: true
        });
        if (session) {
            logger.info("[Extension] Found existing VS Code AuthenticationSession for TestBench during initial check.");
            await handleTestBenchSessionChange(context, session);
        } else {
            logger.info("[Extension] No existing TestBench session found during initial check.");
            if (!getExtensionConfiguration().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
                await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
                getLoginWebViewProvider()?.updateWebviewHTMLContent();
            }
        }
    } catch (error) {
        logger.warn("[Extension] Error trying to get initial session silently:", error);
        await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
    }

    // Trigger Automatic Login Command if configured
    if (getExtensionConfiguration().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
        logger.info("[Extension] Auto-login configured. Scheduling automatic login command.");
        // Short delay to ensure webview is loaded
        setTimeout(async () => {
            try {
                await vscode.commands.executeCommand(allExtensionCommands.automaticLoginAfterExtensionActivation);
            } catch (error) {
                logger.warn("[Extension] Error during automatic login:", error);
            }
        }, TreeViewTiming.WEBVIEW_LOAD_DELAY_MS);
    } else {
        logger.info("[Extension] Auto-login is disabled. Skipping automatic login command.");
    }

    logger.info("Extension activated successfully.");
}

/**
 * Updates or restarts the language server based on the current state.
 * @param projectName the name of the project to update or restart the language server for.
 * @param tovName the name of the TOV to update or restart the language server for.
 */
export async function updateOrRestartLS(projectName: string | undefined, tovName: string | undefined): Promise<void> {
    if (!projectName || !tovName) {
        logger.error("[Cmd] updateOrRestartLS called with invalid project or TOV name.");
        vscode.window.showErrorMessage("Invalid project or TOV name provided for language server update.");
        return;
    }

    const existingClient = getLanguageClientInstance();
    logger.debug(
        `[Cmd] updateOrRestartLS called with projectName: ${projectName}, tovName: ${tovName}, existingClient state: ${existingClient ? existingClient.state : "none"}`
    );
    if (existingClient && existingClient.state !== State.Stopped && existingClient.state !== State.Starting) {
        logger.debug(`[Cmd] Updating language client with project name: ${projectName}, TOV name: ${tovName}`);
        await vscode.commands.executeCommand("testbench_ls.updateProject", projectName);
        await vscode.commands.executeCommand("testbench_ls.updateTov", tovName);
    } else {
        await restartLanguageClient(projectName, tovName);
    }
}

/**
 * Called when the extension is deactivated.
 */
export async function deactivate(): Promise<void> {
    try {
        if (connection) {
            logger.info("[Extension] Performing server logout on deactivation.");
            await connection.logoutUserOnServer();
        }
        if (client) {
            logger.info("[Extension] Attempting to stop language server on deactivation.");
            await stopLanguageClient(true);
            logger.info("[Extension] Language server stopped on deactivation.");
        }
        if (treeViews) {
            logger.info("[Extension] Disposing TreeViews on deactivation.");
            treeViews.projectsTree.dispose();
            treeViews.testThemesTree.dispose();
            treeViews.testElementsTree.dispose();
            treeViews = null;
        }
        logger.info("Extension deactivated.");
    } catch (error) {
        logger.error("Error during deactivation:", error);
    }
}

/**
 * Utility function to clear all extension data.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 * @param {boolean} showConfirmation Whether to show a confirmation dialog (default: false for programmatic calls).
 * @returns {Promise<boolean>} True if data was cleared successfully, false if cancelled or failed.
 */
export async function clearAllExtensionData(
    context: vscode.ExtensionContext,
    showConfirmation: boolean = false
): Promise<boolean> {
    try {
        if (showConfirmation) {
            const confirmation = await vscode.window.showWarningMessage(
                "This will clear ALL TestBench extension data including:\n\n" +
                    "• All saved connections and passwords\n" +
                    "• Current login session\n" +
                    "• Tree view states and custom roots\n" +
                    "• Test generation history\n" +
                    "• Import tracking data\n" +
                    "• All persistent settings\n\n" +
                    "This action cannot be undone. Are you sure you want to continue?",
                { modal: true },
                "Clear All Data",
                "Cancel"
            );

            if (confirmation !== "Clear All Data") {
                logger.info("[clearAllExtensionData] User cancelled clear all extension data operation.");
                return false;
            }
        }

        logger.info("[clearAllExtensionData] Starting comprehensive extension data cleanup...");

        // Logout user and clear connection
        if (connection) {
            logger.debug("[clearAllExtensionData] Logging out from server...");
            try {
                await connection.logoutUserOnServer();
            } catch (error) {
                logger.warn("[clearAllExtensionData] Error logging out from server:", error);
            }
            setConnection(null);
        }

        // Clear all VS Code authentication sessions
        try {
            logger.debug("[clearAllExtensionData] Clearing VS Code authentication sessions...");
            const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, [], {
                createIfNone: false,
                silent: true
            });
            if (session && authProviderInstance) {
                await authProviderInstance.removeSession(session.id);
            }
        } catch (error) {
            logger.warn("[clearAllExtensionData] Error clearing authentication session:", error);
        }

        // Clear all workspace state storage
        logger.debug("[clearAllExtensionData] Clearing workspace state storage...");
        const workspaceStateKeys = [
            StorageKeys.LAST_GENERATED_PARAMS,
            StorageKeys.MARKED_TEST_GENERATION_ITEM,
            StorageKeys.SUB_TREE_ITEM_IMPORT_STORAGE_KEY,
            `${StorageKeys.SUB_TREE_ITEM_IMPORT_STORAGE_KEY}_last`,
            StorageKeys.VISIBLE_VIEWS_STORAGE_KEY,
            StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY,
            StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY,
            StorageKeys.CUSTOM_ROOT_PROJECT_TREE,
            StorageKeys.CUSTOM_ROOT_TEST_THEME_TREE,
            StorageKeys.CUSTOM_ROOT_TEST_ELEMENTS_TREE,
            StorageKeys.IS_TT_OPENED_FROM_CYCLE_STORAGE_KEY,
            StorageKeys.HAS_USED_EXTENSION_BEFORE,
            `${StorageKeys.MARKED_TEST_GENERATION_ITEM}_hierarchies`
        ];

        for (const key of workspaceStateKeys) {
            try {
                await context.workspaceState.update(key, undefined);
            } catch (error) {
                logger.warn(`[clearAllExtensionData] Error clearing workspace state key ${key}:`, error);
            }
        }

        // Clear all global state storage (connections, active connection)
        logger.debug("[clearAllExtensionData] Clearing global state storage...");
        const globalStateKeys = [StorageKeys.CONNECTIONS_STORAGE_KEY, StorageKeys.ACTIVE_CONNECTION_ID_KEY];

        for (const key of globalStateKeys) {
            try {
                await context.globalState.update(key, undefined);
            } catch (error) {
                logger.warn(`[clearAllExtensionData] Error clearing global state key ${key}:`, error);
            }
        }

        // Clear all connection passwords from secret storage
        logger.debug("[clearAllExtensionData] Clearing connection passwords from secret storage...");
        try {
            const connections = await connectionManager.getConnections(context);
            for (const conn of connections) {
                try {
                    await context.secrets.delete(StorageKeys.CONNECTION_PASSWORD_SECRET_PREFIX + conn.id);
                    logger.trace(`[clearAllExtensionData] Cleared password for connection: ${conn.label}`);
                } catch (error) {
                    logger.warn(`[clearAllExtensionData] Error clearing password for connection ${conn.label}:`, error);
                }
            }
        } catch (error) {
            logger.warn("[clearAllExtensionData] Error clearing connection passwords:", error);
        }

        // Clear tree data and state
        if (treeViews) {
            logger.debug("[clearAllExtensionData] Clearing tree data and state...");
            try {
                treeViews.clear();
            } catch (error) {
                logger.warn("[clearAllExtensionData] Error clearing tree data:", error);
            }
        }

        // Update UI state by updating context keys
        logger.debug("[clearAllExtensionData] Updating UI state...");
        const contextUpdates = [
            ["setContext", ContextKeys.CONNECTION_ACTIVE, false],
            ["setContext", ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false],
            ["setContext", ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false],
            ["setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, false]
        ];

        for (const [command, key, value] of contextUpdates) {
            try {
                await vscode.commands.executeCommand(command as string, key, value);
            } catch (error) {
                logger.warn(`[clearAllExtensionData] Error updating context ${key}:`, error);
            }
        }

        // Update login webview to reflect the new clean state
        logger.debug("[clearAllExtensionData] Updating login webview...");
        try {
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
        } catch (error) {
            logger.warn("[clearAllExtensionData] Error updating login webview:", error);
        }

        // Stop language client if running
        if (client) {
            logger.debug("[clearAllExtensionData] Stopping language client...");
            try {
                await stopLanguageClient(true);
            } catch (error) {
                logger.warn("[clearAllExtensionData] Error stopping language client:", error);
            }
        }

        // Clear internal testbench folder
        logger.debug("[clearAllExtensionData] Clearing internal testbench folder...");
        try {
            const workspaceLocation: string | undefined = await utils.validateAndReturnWorkspaceLocation();
            if (workspaceLocation) {
                const testbenchWorkingDirectoryPath: string = path.join(
                    workspaceLocation,
                    folderNameOfInternalTestbenchFolder
                );
                await utils.clearInternalTestbenchFolder(
                    testbenchWorkingDirectoryPath,
                    [testBenchLogger.folderNameOfLogs], // Exclude logs folder
                    false
                );
            }
        } catch (error) {
            logger.warn("[clearAllExtensionData] Error clearing internal testbench folder:", error);
        }

        // Show projects view and hide other views to ensure proper UI state
        try {
            await displayProjectManagementTreeView();
            await hideTestThemeTreeView();
            await hideTestElementsTreeView();
        } catch (error) {
            logger.warn("[clearAllExtensionData] Error managing view visibility:", error);
        }

        logger.info("[clearAllExtensionData] All extension data cleared successfully.");

        if (showConfirmation) {
            vscode.window.showInformationMessage(
                "All TestBench extension data has been cleared successfully. You will need to log in again to use the extension."
            );
        }

        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(`[clearAllExtensionData] Error during clear all extension data operation: ${errorMessage}`, error);

        if (showConfirmation) {
            vscode.window.showErrorMessage(`Error clearing extension data: ${errorMessage}`);
        }

        return false;
    }
}
