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
import {
    TestBenchAuthenticationProvider,
    TESTBENCH_AUTH_PROVIDER_ID,
    TESTBENCH_AUTH_PROVIDER_LABEL,
    getSessionToProcess
} from "./testBenchAuthenticationProvider";
import * as connectionManager from "./connectionManager";
import { PlayServerConnection } from "./testBenchConnection";
import { getExtensionConfiguration, initializeConfigurationWatcher } from "./configuration";
import { TestThemesTreeItem } from "./treeViews/implementations/testThemes/TestThemesTreeItem";
import { MarkingModule, TestElementsTreeItem, TreeViewBase, TreeViews } from "./treeViews";
import { ProjectsTreeItem } from "./treeViews/implementations/projects/ProjectsTreeItem";
import * as reportHandler from "./reportHandler";
import * as utils from "./utils";
import path from "path";
import { FilterService } from "./treeViews/utils/FilterService";
import {
    updateOrRestartLS,
    stopLanguageClient,
    client,
    waitForLanguageServerReady,
    handleLanguageServerRestartOnSessionChange
} from "./server";
import { TreeItemBase } from "./treeViews/core/TreeItemBase";
import {
    hideProjectManagementTreeView,
    displayProjectManagementTreeView
} from "./treeViews/implementations/projects/ProjectsTreeView";
import {
    displayTestElementsTreeView,
    hideTestElementsTreeView
} from "./treeViews/implementations/testElements/TestElementsTreeView";
import {
    displayTestThemeTreeView,
    hideTestThemeTreeView
} from "./treeViews/implementations/testThemes/TestThemesTreeView";
import { initializeTreeViews } from "./treeViews/TreeViewFactory";

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
export let treeViews: TreeViews | null = null;
export function setTreeViews(newTreeViews: TreeViews | null): void {
    treeViews = newTreeViews;
}

export let extensionContext: vscode.ExtensionContext;
export function setExtensionContext(context: vscode.ExtensionContext): void {
    extensionContext = context;
}

// Double-click handling
let lastCycleClick = { id: "", timestamp: 0 };

// Global variable to store the authentication provider instance
let authProviderInstance: TestBenchAuthenticationProvider | null = null;

// Prevent multiple session change handling simultaneously
let isHandlingSessionChange: boolean = false;

// Prevent multiple test generation or import operations simultaneously
let isTestOperationInProgress: boolean = false;

// Determines if the icon of the tree item should be changed after generating tests for that item.
export const ENABLE_ICON_MARKING_ON_TEST_GENERATION: boolean = true;
// Determines if the import button of the tree item should still persist after importing test results for that item.
export const ALLOW_PERSISTENT_IMPORT_BUTTON: boolean = true;

/**
 * Extracts project and TOV names from different tree item types (projects or test theme tree items),
 * retrieves language server parameters and initializes or updates the language server.
 *
 * @param item The tree item that extends TreeItemBase and implements LanguageServerParameterProvider
 * @param operationName Human readable name of the operation for error messages
 * @returns Promise that resolves to the extracted project and TOV names, or throws an error
 */
async function prepareLanguageServerForTreeItemOperation(
    item: TreeItemBase,
    operationName: string
): Promise<{ projectName: string; tovName: string }> {
    const timeOutMs = 30000;
    const checkIntervallMs = 100;
    const languageServerParams = item.getLanguageServerParameters?.();

    if (!languageServerParams) {
        const errorMessage = `Cannot ${operationName}: invalid tree item. Missing project or TOV information.`;
        logger.error(`[Cmd] ${errorMessage}`);
        vscode.window.showErrorMessage(`Invalid tree item: ${errorMessage}`);
        throw new Error(errorMessage);
    }

    const { projectName: projectNameOfTreeItem, tovName: tovNameOfTreeItem } = languageServerParams;
    await updateOrRestartLS(projectNameOfTreeItem, tovNameOfTreeItem);

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Waiting for Language Server",
            cancellable: true
        },
        async (progress, cancellationToken) => {
            progress.report({ message: "Waiting for language server to be ready...", increment: 0 });
            await waitForLanguageServerReady(timeOutMs, checkIntervallMs, cancellationToken);
        }
    );

    return { projectName: projectNameOfTreeItem, tovName: tovNameOfTreeItem };
}

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
 * Wraps a (test generation or import) command handler to make sure only one test operation (generation/import) runs at a time.
 * If another operation is in progress, shows a warning and does not execute the handler.
 * @param handler The async function to execute
 * @returns A new async function with single-operation protection
 */
function withSingleTestOperation<T extends any[]>(
    handler: (...args: T) => Promise<void>
): (...args: T) => Promise<void> {
    return async (...args: T) => {
        if (isTestOperationInProgress) {
            logger?.warn("[TestOperation] Attempted to start a test operation while another is in progress");
            vscode.window.showWarningMessage(
                "Another test operation is already in progress. Please wait for it to complete."
            );
            return;
        }
        isTestOperationInProgress = true;
        try {
            await handler(...args);
        } finally {
            isTestOperationInProgress = false;
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
        logger.debug(`Performing deferred view restoration for: ${savedViewId}`);
        if (savedContext.isCycle) {
            await treeViews.testThemesTree.loadCycle(
                savedContext.projectKey,
                savedContext.cycleKey,
                savedContext.projectName,
                savedContext.tovName,
                savedContext.cycleLabel
            );
        } else {
            await treeViews.testThemesTree.loadTov(
                savedContext.projectKey,
                savedContext.tovKey,
                savedContext.projectName,
                savedContext.tovName
            );
        }

        await treeViews.testElementsTree.loadTov(savedContext.tovKey, savedContext.tovName);

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
 * Defines all commands handlers separately and associates them with the corresponding command IDs.
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
            // Removing the session fires onDidChangeSessions and triggers proper UI cleanup.
            await authProviderInstance.removeSession(session.id);
            logger.info(`[Cmd] Session ${session.id} removed by logout command.`);
        }

        await stopLanguageClient();

        // Fallback to ensure UI is reset if a connection object still exists without a session.
        if (connection !== null) {
            await handleTestBenchSessionChange(context, undefined);
        }
    };

    const handleProjectCycleClick = async (cycleItem: ProjectsTreeItem) => {
        logger.debug(`[Cmd] Called: ${allExtensionCommands.handleProjectCycleClick} for item ${cycleItem.label}`);

        if (!connection) {
            logger.warn("[Cmd] handleProjectCycleClick called without active connection.");
            vscode.window.showWarningMessage("No active connection available. Please log in first.");
            return;
        }

        const now = Date.now();
        const isDoubleClick =
            lastCycleClick.id === cycleItem.id &&
            now - lastCycleClick.timestamp < TreeViewTiming.DOUBLE_CLICK_THRESHOLD_MS;

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
        }

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

            if (projectKey && cycleKey && versionKey && projectName && tovName) {
                await updateOrRestartLS(projectName, tovName);
                if (treeViews?.testThemesTree) {
                    await treeViews.testThemesTree.loadCycle(
                        projectKey,
                        cycleKey,
                        projectName,
                        tovName,
                        cycleItem.label?.toString()
                    );
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

    const handleProjectVersionClick = async (versionItem: ProjectsTreeItem) => {
        logger.debug(`[Cmd] Called: ${allExtensionCommands.handleProjectVersionClick} for item ${versionItem.label}`);

        if (!connection) {
            logger.warn("[Cmd] handleProjectVersionClick called without active connection.");
            vscode.window.showWarningMessage("No active connection available. Please log in first.");
            return;
        }

        const projectKey = versionItem.getProjectKey();
        const tovKey = versionItem.getVersionKey();
        const projectName = versionItem.parent?.label?.toString();
        const tovName = versionItem.label?.toString();

        if (projectKey && tovKey && projectName && tovName) {
            logger.debug(`Version item clicked: ${tovName} in project ${projectName}`);

            await updateOrRestartLS(projectName, tovName);
        } else {
            const errorMessage = `Cannot update language server: invalid project or TOV information. Project: ${projectName}, TOV: ${tovName}`;
            vscode.window.showErrorMessage(errorMessage);
            logger.error(errorMessage);
        }
    };

    const handleOpenTOV = async (tovItem: ProjectsTreeItem) => {
        if (!treeViews?.testThemesTree) {
            return;
        }

        if (!connection) {
            logger.warn("[Cmd] handleOpenTOV called without active connection.");
            vscode.window.showWarningMessage("No active connection available. Please log in first.");
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
            await treeViews.testThemesTree.loadTov(projectKey, tovKey, projectName, tovName);
            if (treeViews.testElementsTree) {
                await treeViews.testElementsTree.loadTov(tovKey, tovItem.label?.toString());
            }
        }
    };

    const handleOpenCycle = async (cycleItem: ProjectsTreeItem) => {
        if (!treeViews?.testThemesTree) {
            return;
        }

        if (!connection) {
            logger.warn("[Cmd] handleOpenCycle called without active connection.");
            vscode.window.showWarningMessage("No active connection available. Please log in first.");
            return;
        }

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
            await displayTestThemeTreeView();
            await displayTestElementsTreeView();
            await hideProjectManagementTreeView();
            await updateOrRestartLS(projectName, tovName);
            await treeViews.testThemesTree.loadCycle(
                projectKey,
                cycleKey,
                projectName,
                tovName,
                cycleItem.label?.toString()
            );
            if (treeViews.testElementsTree) {
                await treeViews.testElementsTree.loadTov(versionKey, cycleItem.label?.toString());
            }
        } else {
            throw new Error("Invalid cycle item: missing project, cycle, or version key");
        }
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

    // Test Generation Handlers
    const _handleGenerateTestCasesForTOV = async (tovItem: ProjectsTreeItem) => {
        if (!tovItem) {
            logger.error("[Cmd] handleGenerateTestCasesForTOV called with undefined item");
            vscode.window.showErrorMessage("Invalid item: Cannot generate test cases for undefined item");
            return;
        }

        if (!treeViews?.projectsTree) {
            logger.error("[Cmd] handleGenerateTestCasesForTOV called before tree views are initialized");
            vscode.window.showErrorMessage("Tree views are not ready. Please wait a moment and try again.");
            return;
        }

        try {
            if (treeViews?.testThemesTree) {
                const markingModule = treeViews.testThemesTree.getModule("marking") as MarkingModule | undefined;
                if (markingModule) {
                    markingModule.clearAllMarkings(false);
                }
            }

            await prepareLanguageServerForTreeItemOperation(tovItem, "generate test cases for TOV");
            await treeViews.projectsTree.generateTestCasesForTOV(tovItem);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            if (errorMessage.includes("cancelled")) {
                logger.info("[Cmd] Language server wait operation was cancelled by user");
                vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
            } else {
                logger.error(`[Cmd] Error in generateTestCasesForTOV: ${errorMessage}`, error);
                vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
            }
        }
    };
    const handleGenerateTestCasesForTOV = withSingleTestOperation(_handleGenerateTestCasesForTOV);

    const _handleGenerateTestCasesForCycle = async (cycleItem: ProjectsTreeItem) => {
        if (!cycleItem) {
            logger.error("[Cmd] handleGenerateTestCasesForCycle called with undefined item");
            vscode.window.showErrorMessage("Invalid item: Cannot generate test cases for undefined cycle item");
            return;
        }

        if (!connection) {
            logger.warn("[Cmd] handleGenerateForCycle called without active connection.");
            vscode.window.showWarningMessage("No active connection available. Please log in first.");
            return;
        }

        try {
            if (treeViews?.testThemesTree) {
                const markingModule = treeViews.testThemesTree.getModule("marking") as MarkingModule | undefined;
                if (markingModule) {
                    markingModule.clearAllMarkings(false);
                }
            }

            await prepareLanguageServerForTreeItemOperation(cycleItem, "generate test cases for cycle");
            await reportHandler.startTestGenerationForCycle(context, cycleItem);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            if (errorMessage.includes("cancelled")) {
                logger.info("[Cmd] Language server wait operation was cancelled by user");
                vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
            } else {
                logger.error(`[Cmd] Error in generateTestCasesForCycle: ${errorMessage}`, error);
                vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
            }
        }
    };
    const handleGenerateTestCasesForCycle = withSingleTestOperation(_handleGenerateTestCasesForCycle);

    const _handleGenerateTestCasesForTestThemeOrTestCaseSet = async (testThemeTreeItem: TestThemesTreeItem) => {
        if (!testThemeTreeItem) {
            logger.error("[Cmd] handleGenerateTestCasesForTestThemeOrTestCaseSet called with undefined item");
            vscode.window.showErrorMessage("Invalid item: Cannot generate test cases for undefined test theme item");
            return;
        }

        if (!treeViews?.testThemesTree) {
            logger.error(
                "[Cmd] handleGenerateTestCasesForTestThemeOrTestCaseSet called before tree views are initialized"
            );
            vscode.window.showErrorMessage("Tree views are not ready. Please wait a moment and try again.");
            return;
        }

        try {
            await prepareLanguageServerForTreeItemOperation(
                testThemeTreeItem,
                "generate test cases for test theme or test case set"
            );
            await treeViews.testThemesTree.generateTestCases(testThemeTreeItem);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            if (errorMessage.includes("cancelled")) {
                logger.info("[Cmd] Language server wait operation was cancelled by user");
                vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
            } else {
                logger.error(`[Cmd] Error in generateTestCasesForTestThemeOrTestCaseSet: ${errorMessage}`, error);
                vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
            }
        }
    };
    const handleGenerateTestCasesForTestThemeOrTestCaseSet = withSingleTestOperation(
        _handleGenerateTestCasesForTestThemeOrTestCaseSet
    );

    const _handleGenerateTestsForTestThemeTreeItemFromTOV = async (testThemeTreeItem: TestThemesTreeItem) => {
        if (!testThemeTreeItem) {
            logger.error("[Cmd] handleGenerateTestsForTestThemeTreeItemFromTOV called with undefined item");
            vscode.window.showErrorMessage("Invalid item: Cannot generate test cases for undefined test theme item");
            return;
        }

        if (!treeViews?.testThemesTree) {
            logger.error(
                "[Cmd] handleGenerateTestsForTestThemeTreeItemFromTOV called before tree views are initialized"
            );
            vscode.window.showErrorMessage("Tree views are not ready. Please wait a moment and try again.");
            return;
        }

        try {
            await prepareLanguageServerForTreeItemOperation(
                testThemeTreeItem,
                "generate test cases for test theme tree item"
            );
            await treeViews.testThemesTree.generateTestCases(testThemeTreeItem);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            if (errorMessage.includes("cancelled")) {
                logger.info("[Cmd] Language server wait operation was cancelled by user");
                vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
            } else {
                logger.error(`[Cmd] Error in generateTestsForTestThemeTreeItemFromTOV: ${errorMessage}`, error);
                vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
            }
        }
    };
    const handleGenerateTestsForTestThemeTreeItemFromTOV = withSingleTestOperation(
        _handleGenerateTestsForTestThemeTreeItemFromTOV
    );

    const _handleReadAndImportTestResultsToTestbench = async (testThemeTreeItem: TestThemesTreeItem) => {
        if (!testThemeTreeItem) {
            logger.error("[Cmd] handleReadAndImportTestResultsToTestbench called with undefined item");
            vscode.window.showErrorMessage("Invalid item: Cannot import test results for undefined test theme item");
            return;
        }

        if (!treeViews?.testThemesTree) {
            logger.error("[Cmd] handleReadAndImportTestResultsToTestbench called before tree views are initialized");
            vscode.window.showErrorMessage("Tree views are not ready. Please wait a moment and try again.");
            return;
        }

        try {
            await prepareLanguageServerForTreeItemOperation(testThemeTreeItem, "import test results");
            await treeViews.testThemesTree.importTestResultsForTestThemeTreeItem(testThemeTreeItem);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            if (errorMessage.includes("cancelled")) {
                logger.info("[Cmd] Language server wait operation was cancelled by user");
                vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
            } else {
                logger.error(`[Cmd] Error in readAndImportTestResultsToTestbench: ${errorMessage}`, error);
                vscode.window.showErrorMessage(`Failed to import test results: ${errorMessage}`);
            }
        }
    };
    const handleReadAndImportTestResultsToTestbench = withSingleTestOperation(
        _handleReadAndImportTestResultsToTestbench
    );

    // Tree View Management Handlers
    const handleDisplayAllProjects = async () => {
        displayProjectManagementTreeView();
        hideTestThemeTreeView();
        hideTestElementsTreeView();
        await saveUIContext(context, "projects");
    };

    const handleMakeRoot = (item: any) => {
        if (treeViews?.projectsTree && item.data?.type === "project") {
            treeViews?.projectsTree.makeRoot(item);
        } else if (treeViews?.testThemesTree && item.data?.type?.includes("TestTheme")) {
            treeViews?.testThemesTree.makeRoot(item);
        }
    };

    const handleOpenAvailableResource = (item: TestElementsTreeItem) => {
        treeViews?.testElementsTree.openAvailableResource(item);
    };

    const handleCreateMissingResource = (item: TestElementsTreeItem) => {
        treeViews?.testElementsTree.createMissingResource(item);
    };

    const handleOpenFolderInExplorer = (item: TestElementsTreeItem) => {
        treeViews?.testElementsTree.openFolderInExplorer(item);
    };

    const handleGoToInteraction = (item: TestElementsTreeItem) => {
        treeViews?.testElementsTree.goToInteractionResource(item);
    };

    const handleUpdateOrRestartLS = (projectName: string | undefined, tovName: string | undefined) => {
        updateOrRestartLS(projectName, tovName);
    };

    const handleShowExtensionSettings = () => {
        vscode.commands.executeCommand("workbench.action.openSettings", "@ext:imbus.testbench-extension");
    };

    const handleRefreshProjectTreeView = () => {
        treeViews?.projectsTree.refresh();
    };

    const handleRefreshTestThemeTreeView = () => {
        treeViews?.testThemesTree.refresh();
    };

    const handleRefreshTestElementsTree = () => {
        treeViews?.testElementsTree.refresh();
    };

    const handleResetProjectTreeViewRoot = () => {
        treeViews?.projectsTree.resetCustomRoot();
    };

    const handleResetTestThemeTreeViewRoot = () => {
        treeViews?.testThemesTree.resetCustomRoot();
    };

    const handleSetTextFilterForProjects = () => {
        setFilterForView(treeViews?.projectsTree);
    };

    const handleSetTextFilterForTestThemes = () => {
        setFilterForView(treeViews?.testThemesTree);
    };

    const handleSetTextFilterForTestElements = () => {
        setFilterForView(treeViews?.testElementsTree);
    };

    const handleClearTextFilterForProjects = () => {
        clearFilterForView(treeViews?.projectsTree);
    };

    const handleClearTextFilterForTestThemes = () => {
        clearFilterForView(treeViews?.testThemesTree);
    };

    const handleClearTextFilterForTestElements = () => {
        clearFilterForView(treeViews?.testElementsTree);
    };

    const handleToggleFilterDiffModeForProjects = () => {
        toggleDiffModeForView(treeViews?.projectsTree);
    };

    const handleToggleFilterDiffModeForProjectsEnabled = () => {
        toggleDiffModeForView(treeViews?.projectsTree);
    };

    const handleToggleFilterDiffModeForTestThemes = () => {
        toggleDiffModeForView(treeViews?.testThemesTree);
    };

    const handleToggleFilterDiffModeForTestThemesEnabled = () => {
        toggleDiffModeForView(treeViews?.testThemesTree);
    };

    const handleToggleFilterDiffModeForTestElements = () => {
        toggleDiffModeForView(treeViews?.testElementsTree);
    };

    const handleToggleFilterDiffModeForTestElementsEnabled = () => {
        toggleDiffModeForView(treeViews?.testElementsTree);
    };

    const handleClearAllFiltersForProjects = () => {
        clearAllFiltersForView(treeViews?.projectsTree);
    };

    const handleClearAllFiltersForTestThemes = () => {
        clearAllFiltersForView(treeViews?.testThemesTree);
    };

    const handleClearAllFiltersForTestElements = () => {
        clearAllFiltersForView(treeViews?.testElementsTree);
    };

    // --- Command Registry ---
    const commandRegistry = [
        // Authentication and Session
        { id: allExtensionCommands.automaticLoginAfterExtensionActivation, handler: handleAutomaticLogin },
        { id: allExtensionCommands.login, handler: handleLogin },
        { id: allExtensionCommands.logout, handler: handleLogout },

        // Tree Interaction and Navigation
        { id: allExtensionCommands.handleProjectCycleClick, handler: handleProjectCycleClick },
        { id: allExtensionCommands.handleProjectVersionClick, handler: handleProjectVersionClick },
        { id: allExtensionCommands.openTOVFromProjectsView, handler: handleOpenTOV },
        { id: allExtensionCommands.openCycleFromProjectsView, handler: handleOpenCycle },
        {
            id: allExtensionCommands.displayAllProjects,
            handler: handleDisplayAllProjects
        },

        // Test Generation
        {
            id: allExtensionCommands.generateTestCasesForTOV,
            handler: handleGenerateTestCasesForTOV
        },
        {
            id: allExtensionCommands.generateTestCasesForCycle,
            handler: handleGenerateTestCasesForCycle
        },
        {
            id: allExtensionCommands.generateTestCasesForTestThemeOrTestCaseSet,
            handler: handleGenerateTestCasesForTestThemeOrTestCaseSet
        },
        {
            id: allExtensionCommands.generateTestsForTestThemeTreeItemFromTOV,
            handler: handleGenerateTestsForTestThemeTreeItemFromTOV
        },

        // Read and Import Test Results
        {
            id: allExtensionCommands.readAndImportTestResultsToTestbench,
            handler: handleReadAndImportTestResultsToTestbench
        },

        // Tree View Management
        { id: allExtensionCommands.refreshProjectTreeView, handler: handleRefreshProjectTreeView },
        { id: allExtensionCommands.refreshTestThemeTreeView, handler: handleRefreshTestThemeTreeView },
        { id: allExtensionCommands.refreshTestElementsTree, handler: handleRefreshTestElementsTree },
        {
            id: allExtensionCommands.makeRoot,
            handler: handleMakeRoot
        },
        { id: allExtensionCommands.resetProjectTreeViewRoot, handler: handleResetProjectTreeViewRoot },
        {
            id: allExtensionCommands.resetTestThemeTreeViewRoot,
            handler: handleResetTestThemeTreeViewRoot
        },

        // Tree View Filtering Commands
        { id: allExtensionCommands.setTextFilterForProjects, handler: handleSetTextFilterForProjects },
        {
            id: allExtensionCommands.setTextFilterForTestThemes,
            handler: handleSetTextFilterForTestThemes
        },
        {
            id: allExtensionCommands.setTextFilterForTestElements,
            handler: handleSetTextFilterForTestElements
        },
        {
            id: allExtensionCommands.clearTextFilterForProjects,
            handler: handleClearTextFilterForProjects
        },
        {
            id: allExtensionCommands.clearTextFilterForTestThemes,
            handler: handleClearTextFilterForTestThemes
        },
        {
            id: allExtensionCommands.clearTextFilterForTestElements,
            handler: handleClearTextFilterForTestElements
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForProjects,
            handler: handleToggleFilterDiffModeForProjects
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForProjectsEnabled,
            handler: handleToggleFilterDiffModeForProjectsEnabled
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForTestThemes,
            handler: handleToggleFilterDiffModeForTestThemes
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForTestThemesEnabled,
            handler: handleToggleFilterDiffModeForTestThemesEnabled
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForTestElements,
            handler: handleToggleFilterDiffModeForTestElements
        },
        {
            id: allExtensionCommands.toggleFilterDiffModeForTestElementsEnabled,
            handler: handleToggleFilterDiffModeForTestElementsEnabled
        },
        {
            id: allExtensionCommands.clearAllFiltersForProjects,
            handler: handleClearAllFiltersForProjects
        },
        {
            id: allExtensionCommands.clearAllFiltersForTestThemes,
            handler: handleClearAllFiltersForTestThemes
        },
        {
            id: allExtensionCommands.clearAllFiltersForTestElements,
            handler: handleClearAllFiltersForTestElements
        },

        // Other extension commands
        { id: allExtensionCommands.clearInternalTestbenchFolder, handler: clearInternalFolder },
        { id: allExtensionCommands.clearAllExtensionData, handler: clearAllExtensionData },
        {
            id: allExtensionCommands.showExtensionSettings,
            handler: handleShowExtensionSettings
        },
        {
            id: allExtensionCommands.updateOrRestartLS,
            handler: handleUpdateOrRestartLS
        },
        {
            id: allExtensionCommands.openAvailableSubdivisionInTestElementsView,
            handler: handleOpenAvailableResource
        },
        {
            id: allExtensionCommands.openMissingSubdivisionInTestElementsView,
            handler: handleCreateMissingResource
        },
        {
            id: allExtensionCommands.openSubdivisionFolderInExplorer,
            handler: handleOpenFolderInExplorer
        },
        {
            id: allExtensionCommands.openInteractionInTestElementsView,
            handler: handleGoToInteraction
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
 * Creates and initializes a new PlayServerConnection.
 * @param activeConnection - The active connection to use.
 * @param session - The session to use.
 * @param currentConnection - The current connection to use.
 * @returns The new connection.
 */
async function createNewConnection(
    activeConnection: connectionManager.TestBenchConnection,
    session: vscode.AuthenticationSession,
    currentConnection: PlayServerConnection | null
): Promise<PlayServerConnection> {
    if (currentConnection) {
        logger.warn(
            "[Extension] A different connection was active. Logging out from previous server session before establishing new one."
        );
        await currentConnection.logoutUserOnServer();
    }

    const newConnection = new PlayServerConnection(
        activeConnection.serverName,
        activeConnection.portNumber,
        activeConnection.username,
        session.accessToken
    );

    setConnection(newConnection);
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, true);
    getLoginWebViewProvider()?.updateWebviewHTMLContent();

    return newConnection;
}

/**
 * Validates saved context data for view restoration.
 * @param savedContext - The saved context to validate.
 * @returns True if the saved context is valid, false otherwise.
 */
function isValidSavedContext(savedContext: any): boolean {
    return !!(
        savedContext &&
        savedContext.projectName &&
        typeof savedContext.projectName === "string" &&
        savedContext.tovName &&
        typeof savedContext.tovName === "string"
    );
}

/**
 * Loads the default tree views where only projects tree view is visible.
 * @returns A promise that resolves when the default tree views are loaded.
 */
async function loadDefaultTreeViewsUI(): Promise<void> {
    logger.debug("Loading default tree views.");
    if (treeViews) {
        treeViews.projectsTree.refresh();
    }
    await displayProjectManagementTreeView();
    await hideTestThemeTreeView();
    await hideTestElementsTreeView();
}

/**
 * Refreshes tree views and attempts to restore previous view state.
 * @param context - The extension context.
 * @returns A promise that resolves when the tree views are refreshed and the previous view state is restored.
 */
async function restoreTreeViewsState(context: vscode.ExtensionContext): Promise<void> {
    logger.debug("[Extension] Restoring tree views state");

    if (!treeViews) {
        logger.error("Tree views not initialized, cannot restore view state.");
        return;
    }

    try {
        treeViews.clear();
        treeViews.projectsTree.refresh();

        const savedViewId = context.workspaceState.get<string>(StorageKeys.VISIBLE_VIEWS_STORAGE_KEY);
        const savedCycleContext = context.workspaceState.get<any>(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY);
        const savedTovContext = context.workspaceState.get<any>(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY);
        const savedContext = savedCycleContext || savedTovContext;

        logger.debug(
            `[Extension] Checking for saved view state: savedViewId=${savedViewId}, hasSavedContext=${!!savedContext}`
        );

        let viewRestored = false;

        if (savedContext && isValidSavedContext(savedContext)) {
            logger.info(
                `Found last-active context for ${savedContext.projectName}/${savedContext.tovName}. Initializing language server.`
            );
            await updateOrRestartLS(savedContext.projectName, savedContext.tovName);
        }

        if (savedViewId && savedViewId !== "projects" && savedContext) {
            if (!isValidSavedContext(savedContext)) {
                logger.warn(
                    `Cannot restore view state: invalid context data. ` +
                        `projectName: ${savedContext.projectName}, tovName: ${savedContext.tovName}. ` +
                        `Clearing invalid state and loading default view.`
                );
                await clearViewState(context);
            } else {
                logger.debug(`Attempting to restore previous view: ${savedViewId}`);
                try {
                    viewRestored = await performDeferredViewRestoration(context, savedViewId, savedContext);
                } catch (error) {
                    logger.error("Failed to restore view state:", error);
                    viewRestored = false;
                }
            }
        }

        if (!viewRestored) {
            logger.debug("Loading default projects view (no saved state to restore or restoration failed).");
            await loadDefaultTreeViewsUI();
        }
    } catch (error) {
        logger.warn("[Extension] Error managing trees during session change:", error);
        await loadDefaultTreeViewsUI();
    }
}

/**
 * Handles the case when there's no active connection but a session exists. *
 */
async function handleNoActiveConnection(): Promise<void> {
    logger.warn("[Extension] Session exists, but no active connection. Clearing connection.");

    if (connection) {
        await connection.logoutUserOnServer();
    }

    if (treeViews) {
        treeViews.clear();
    }

    await loadDefaultTreeViewsUI();
    logger.debug("[Extension] View state preserved for potential restoration on next login.");
}

/**
 * Handles the case when there's no session (logout).
 */
async function handleNoSession(): Promise<void> {
    logger.info("[Extension] No active session. Clearing connection.");

    if (connection) {
        await connection.logoutUserOnServer();
    }

    if (treeViews) {
        treeViews.clear();
    }

    await loadDefaultTreeViewsUI();
    logger.debug("[Extension] View state preserved for potential restoration on next login.");
}

/**
 * Handles changes in the TestBench authentication session.
 *
 * @param {vscode.ExtensionContext} context - The VS Code extension context.
 * @param {vscode.AuthenticationSession} existingSession - An optional existing authentication session to process.
 */
async function handleTestBenchSessionChange(
    context: vscode.ExtensionContext,
    existingSession?: vscode.AuthenticationSession
): Promise<void> {
    logger.info(`[handleTestBenchSessionChange] Session changed. Processing... Has session: ${!!existingSession}`);

    const sessionToProcess = await getSessionToProcess(existingSession);
    const wasPreviouslyConnected = !!connection;
    const previousSessionToken = connection?.getSessionToken();

    if (sessionToProcess?.accessToken) {
        const activeConnection = await connectionManager.getActiveConnection(context);

        if (!activeConnection) {
            await handleNoActiveConnection();
            return;
        }

        if (connectionManager.isConnectionAlreadyActive(connection, sessionToProcess, activeConnection)) {
            logger.info(
                `[Extension] Connection for '${activeConnection.label}' and current session token is already active. Skipping re-initialization.`
            );
            return;
        }

        logger.info(
            `[Extension] TestBench session active for connection: ${activeConnection.label}. Initializing PlayServerConnection.`
        );

        const newConnection = await createNewConnection(activeConnection, sessionToProcess, connection);

        await handleLanguageServerRestartOnSessionChange(previousSessionToken, newConnection.getSessionToken());

        const isNewConnection =
            !wasPreviouslyConnected ||
            !!(connection && connection.getSessionToken() !== newConnection.getSessionToken());

        if (isNewConnection) {
            logger.info("[Extension] New connection established. Restoring tree views state.");
            await restoreTreeViewsState(context);
        }
    } else {
        await handleNoSession();
    }
}

/**
 * Clears all view state storage. This function is used to clear invalid view state
 * when restoration fails, not for logout scenarios where view state should be preserved.
 * @param context The extension context
 */
async function clearViewState(context: vscode.ExtensionContext): Promise<void> {
    await context.workspaceState.update(StorageKeys.VISIBLE_VIEWS_STORAGE_KEY, "projects");
    await context.workspaceState.update(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, undefined);
    await context.workspaceState.update(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, undefined);
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

    if (contextData) {
        const hasValidProjectName = contextData.projectName && typeof contextData.projectName === "string";
        const hasValidTovName = contextData.tovName && typeof contextData.tovName === "string";

        if (!hasValidProjectName || !hasValidTovName) {
            logger.warn(
                `Cannot save UI context: invalid contextData. ` +
                    `projectName: ${contextData.projectName}, tovName: ${contextData.tovName}. ` +
                    `Clearing context state.`
            );
            await context.workspaceState.update(StorageKeys.LAST_ACTIVE_CYCLE_CONTEXT_KEY, undefined);
            await context.workspaceState.update(StorageKeys.LAST_ACTIVE_TOV_CONTEXT_KEY, undefined);
            return;
        }

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
            logger.debug(
                "[Extension] Found existing VS Code AuthenticationSession for TestBench during initial check."
            );
            await handleTestBenchSessionChange(context, session);
        } else {
            logger.debug("[Extension] No existing TestBench session found during initial check.");
            if (!getExtensionConfiguration().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
                await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
                getLoginWebViewProvider()?.updateWebviewHTMLContent();
            }
        }
    } catch (error) {
        logger.warn("[Extension] Error trying to get initial session silently:", error);
        await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
    }

    if (getExtensionConfiguration().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
        logger.debug("[Extension] Auto-login configured. Scheduling automatic login command.");
        // Short delay to ensure webview is loaded
        setTimeout(async () => {
            try {
                await vscode.commands.executeCommand(allExtensionCommands.automaticLoginAfterExtensionActivation);
            } catch (error) {
                logger.warn("[Extension] Error during automatic login:", error);
            }
        }, TreeViewTiming.WEBVIEW_LOAD_DELAY_MS);
    } else {
        logger.debug("[Extension] Auto-login is disabled. Skipping automatic login command.");
    }

    logger.info("Extension activated successfully.");
}

export async function clearAllExtensionData(
    context: vscode.ExtensionContext,
    showConfirmation: boolean = false
): Promise<boolean> {
    isTestOperationInProgress = false;
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
                "Clear All Data"
            );

            if (confirmation !== "Clear All Data") {
                logger.debug("[clearAllExtensionData] User cancelled clear all extension data operation.");
                return false;
            }
        }

        logger.debug("[clearAllExtensionData] Starting comprehensive extension data cleanup...");

        if (connection) {
            logger.debug("[clearAllExtensionData] Logging out from server...");
            try {
                await connection.logoutUserOnServer();
            } catch (error) {
                logger.warn("[clearAllExtensionData] Error logging out from server:", error);
            }
            setConnection(null);
        }

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

        // View state storage keys (dynamic keys based on tree view IDs)
        const treeViewIds = ["testbench.projects", "testbench.testThemes", "testbench.testElements"];
        for (const treeViewId of treeViewIds) {
            workspaceStateKeys.push(`treeState.${treeViewId}`);
            workspaceStateKeys.push(`treeView.state.${treeViewId}`);
        }

        for (const key of workspaceStateKeys) {
            try {
                await context.workspaceState.update(key, undefined);
            } catch (error) {
                logger.warn(`[clearAllExtensionData] Error clearing workspace state key ${key}:`, error);
            }
        }

        logger.debug("[clearAllExtensionData] Clearing global state storage...");
        const globalStateKeys: string[] = [StorageKeys.CONNECTIONS_STORAGE_KEY, StorageKeys.ACTIVE_CONNECTION_ID_KEY];

        for (const treeViewId of treeViewIds) {
            globalStateKeys.push(`treeView.state.${treeViewId}`);
        }

        for (const key of globalStateKeys) {
            try {
                await context.globalState.update(key, undefined);
            } catch (error) {
                logger.warn(`[clearAllExtensionData] Error clearing global state key ${key}:`, error);
            }
        }

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

        if (treeViews) {
            logger.debug("[clearAllExtensionData] Clearing tree data and state...");
            try {
                treeViews.clear();

                if (treeViews.projectsTree) {
                    const projectsPersistence = (treeViews.projectsTree as any).modules?.get("persistence");
                    if (projectsPersistence?.clear) {
                        await projectsPersistence.clear();
                    }

                    const projectsExpansion = (treeViews.projectsTree as any).modules?.get("expansion");
                    if (projectsExpansion?.reset) {
                        projectsExpansion.reset();
                    }

                    const projectsMarking = (treeViews.projectsTree as any).modules?.get("marking");
                    if (projectsMarking?.clearAllMarkings) {
                        projectsMarking.clearAllMarkings(false); // Don't emit global event during clear all
                    }

                    const projectsFiltering = (treeViews.projectsTree as any).modules?.get("filtering");
                    if (projectsFiltering?.clearAllFilters) {
                        projectsFiltering.clearAllFilters();
                    }

                    const projectsCustomRoot = (treeViews.projectsTree as any).modules?.get("customRoot");
                    if (projectsCustomRoot?.reset) {
                        projectsCustomRoot.reset();
                    }

                    const projectsStateManager = (treeViews.projectsTree as any).stateManager;
                    if (projectsStateManager?.setState) {
                        projectsStateManager.setState({
                            expansion: null,
                            marking: null,
                            customRoot: null,
                            filtering: null
                        });
                    }
                }
                if (treeViews.testThemesTree) {
                    const testThemesPersistence = (treeViews.testThemesTree as any).modules?.get("persistence");
                    if (testThemesPersistence?.clear) {
                        await testThemesPersistence.clear();
                    }

                    const testThemesExpansion = (treeViews.testThemesTree as any).modules?.get("expansion");
                    if (testThemesExpansion?.reset) {
                        testThemesExpansion.reset();
                    }

                    const testThemesMarking = (treeViews.testThemesTree as any).modules?.get("marking");
                    if (testThemesMarking?.clearAllMarkings) {
                        testThemesMarking.clearAllMarkings(false); // Don't emit global event during clear all
                    }

                    const testThemesFiltering = (treeViews.testThemesTree as any).modules?.get("filtering");
                    if (testThemesFiltering?.clearAllFilters) {
                        testThemesFiltering.clearAllFilters();
                    }

                    const testThemesCustomRoot = (treeViews.testThemesTree as any).modules?.get("customRoot");
                    if (testThemesCustomRoot?.reset) {
                        testThemesCustomRoot.reset();
                    }

                    const testThemesStateManager = (treeViews.testThemesTree as any).stateManager;
                    if (testThemesStateManager?.setState) {
                        testThemesStateManager.setState({
                            expansion: null,
                            marking: null,
                            customRoot: null,
                            filtering: null
                        });
                    }
                }
                if (treeViews.testElementsTree) {
                    const testElementsPersistence = (treeViews.testElementsTree as any).modules?.get("persistence");
                    if (testElementsPersistence?.clear) {
                        await testElementsPersistence.clear();
                    }

                    const testElementsExpansion = (treeViews.testElementsTree as any).modules?.get("expansion");
                    if (testElementsExpansion?.reset) {
                        testElementsExpansion.reset();
                    }

                    const testElementsMarking = (treeViews.testElementsTree as any).modules?.get("marking");
                    if (testElementsMarking?.clearAllMarkings) {
                        testElementsMarking.clearAllMarkings(false); // Don't emit global event during clear all
                    }

                    const testElementsFiltering = (treeViews.testElementsTree as any).modules?.get("filtering");
                    if (testElementsFiltering?.clearAllFilters) {
                        testElementsFiltering.clearAllFilters();
                    }

                    const testElementsCustomRoot = (treeViews.testElementsTree as any).modules?.get("customRoot");
                    if (testElementsCustomRoot?.reset) {
                        testElementsCustomRoot.reset();
                    }

                    const testElementsStateManager = (treeViews.testElementsTree as any).stateManager;
                    if (testElementsStateManager?.setState) {
                        testElementsStateManager.setState({
                            expansion: null,
                            marking: null,
                            customRoot: null,
                            filtering: null
                        });
                    }
                }

                if (treeViews.projectsTree) {
                    treeViews.projectsTree.refresh();
                }
                if (treeViews.testThemesTree) {
                    treeViews.testThemesTree.refresh();
                }
                if (treeViews.testElementsTree) {
                    treeViews.testElementsTree.refresh();
                }
            } catch (error) {
                logger.warn("[clearAllExtensionData] Error clearing tree data:", error);
            }
        }

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

        logger.debug("[clearAllExtensionData] Updating login webview...");
        try {
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
        } catch (error) {
            logger.warn("[clearAllExtensionData] Error updating login webview:", error);
        }

        if (client) {
            logger.debug("[clearAllExtensionData] Stopping language client...");
            try {
                await stopLanguageClient(true);
            } catch (error) {
                logger.warn("[clearAllExtensionData] Error stopping language client:", error);
            }
        }

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
                    [testBenchLogger.folderNameOfLogs],
                    false
                );
            }
        } catch (error) {
            logger.warn("[clearAllExtensionData] Error clearing internal testbench folder:", error);
        }

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

/**
 * Called when the extension is deactivated.
 */
export async function deactivate(): Promise<void> {
    try {
        isTestOperationInProgress = false;

        if (connection) {
            logger.debug("[Extension] Performing server logout on deactivation.");
            await connection.logoutUserOnServer();
        }
        if (client) {
            logger.debug("[Extension] Attempting to stop language server on deactivation.");
            await stopLanguageClient(true);
            logger.info("[Extension] Language server stopped on deactivation.");
        }
        if (treeViews) {
            logger.debug("[Extension] Disposing TreeViews on deactivation.");
            await treeViews.projectsTree.dispose();
            await treeViews.testThemesTree.dispose();
            await treeViews.testElementsTree.dispose();
            treeViews = null;
        }
        logger.info("Extension deactivated.");
    } catch (error) {
        logger.error("Error during deactivation:", error);
    }
}
