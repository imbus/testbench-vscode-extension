/**
 * @file src/extension.ts
 * @description Main entry point for the TestBench VS Code extension.
 */

// Before releasing the extension:
// TODO: Add License.md to the extension
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
    StorageKeys
} from "./constants";
import {
    TestBenchAuthenticationProvider,
    TESTBENCH_AUTH_PROVIDER_ID,
    TESTBENCH_AUTH_PROVIDER_LABEL,
    getSessionToProcess
} from "./testBenchAuthenticationProvider";
import * as connectionManager from "./connectionManager";
import { PlayServerConnection, TestBenchConnectionError } from "./testBenchConnection";
import { getExtensionConfiguration, initializeConfigurationWatcher } from "./configuration";
import { TestThemesTreeItem } from "./treeViews/implementations/testThemes/TestThemesTreeItem";
import { MarkingModule } from "./treeViews/features/MarkingModule";
import { TestElementsTreeItem } from "./treeViews/implementations/testElements/TestElementsTreeItem";
import { TreeViews } from "./treeViews/TreeViewFactory";
import { ProjectsTreeItem } from "./treeViews/implementations/projects/ProjectsTreeItem";
import * as reportHandler from "./reportHandler";
import * as utils from "./utils";
import path from "path";
import { TreeViewBase } from "./treeViews/core/TreeViewBase";
import { TreeItemBase } from "./treeViews/core/TreeItemBase";
import { TextFilterOptions } from "./treeViews/features/FilteringModule";
import {
    updateOrRestartLS,
    stopLanguageClient,
    client,
    handleLanguageServerRestartOnSessionChange,
    prepareLanguageServerForTreeItemOperation,
    setIsHandlingLogout,
    configureLanguageServerIntegration
} from "./languageServer/server";
import {
    hasLsConfig,
    writeLsConfig,
    readLsConfig,
    validateAndFixLsConfigInteractively,
    LanguageServerConfig
} from "./languageServer/lsConfig";
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
import { UserSessionManager } from "./userSessionManager";
import { SharedSessionManager } from "./sharedSessionManager";
import { v4 as uuidv4 } from "uuid";
import { activeConfigService } from "./languageServer/activeConfigService";

/* =============================================================================
   Constants, Global Variables & Exports
   ============================================================================= */

// Global logger instance.
export let logger: testBenchLogger.TestBenchLogger;
export function setLogger(newLogger: testBenchLogger.TestBenchLogger): void {
    logger = newLogger;
}
export function getLogger(): testBenchLogger.TestBenchLogger {
    return logger;
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

// Global variable to store the authentication provider instance
let authProviderInstance: TestBenchAuthenticationProvider | null = null;
export function getAuthProvider(): TestBenchAuthenticationProvider | null {
    return authProviderInstance;
}

// Prevent multiple session change handling simultaneously
let isHandlingSessionChange: boolean = false;

// Prevent multiple test generation or import operations simultaneously
let isTestOperationInProgress: boolean = false;

export let userSessionManager: UserSessionManager;

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
            logger.error(`[extension] Error executing command: ${errorMessage}`, error);
            vscode.window.showErrorMessage(`Error executing command: ${errorMessage}`);
        }
    };
}

/**
 * Wraps a (test generation or import) command handler to make sure only one test operation (generation/import) runs at a time.
 * If another operation is in progress, shows a warning and does not execute the handler.
 * @param handler The async function to execute
 * @returns A new async function with single operation protection
 */
function withSingleTestOperation<T extends any[]>(
    handler: (...args: T) => Promise<void>
): (...args: T) => Promise<void> {
    return async (...args: T) => {
        if (isTestOperationInProgress) {
            logger?.warn("[extension] Attempted to start a test operation while another is in progress");
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
            logger.error(`[extension] Command ${commandId} error: ${error.message}`, error);
            vscode.window.showErrorMessage(`Command ${commandId} failed: ${error.message}`);
        }
    });
    context.subscriptions.push(disposable);
}

/**
 * Registers all extension commands.
 * Defines all commands handlers separately and associates them with the corresponding command IDs.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
async function registerExtensionCommands(context: vscode.ExtensionContext): Promise<void> {
    if (!treeViews) {
        logger.warn("[extension] Tree views not initialized. Skipping command registration.");
        return;
    }

    const handleLogin = async () => {
        logger.trace(`[extension] Command called: ${allExtensionCommands.login}`);
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: true
        });
        if (session) {
            await handleTestBenchSessionChange(context, session);
        }
    };

    const handleLogout = async () => {
        logger.trace(`[extension] Command called: ${allExtensionCommands.logout}.`);

        if (isHandlingSessionChange) {
            return;
        }

        setIsHandlingLogout(true);
        isHandlingSessionChange = true;
        try {
            const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                silent: true
            });

            if (session && authProviderInstance) {
                await authProviderInstance.removeSession(session.id);
            }

            await handleNoSession();
        } finally {
            isHandlingSessionChange = false;
            setIsHandlingLogout(false);
        }
    };

    const handleCycleClick = async (cycleItem: ProjectsTreeItem) => {
        logger.trace(
            `[extension] Command called: ${allExtensionCommands.handleCycleClick} for item ${cycleItem.label}`
        );

        if (!connection) {
            logger.warn(
                `[extension] Command ${allExtensionCommands.handleCycleClick} called without active connection.`
            );
            vscode.window.showWarningMessage("No active connection available. Please log in first.");
            return;
        }

        // Save UI context for restoration
        const projectKey = cycleItem.getProjectKey();
        const cycleKey = cycleItem.getCycleKey();
        const versionKey = cycleItem.getVersionKey();
        const projectName = cycleItem.parent?.parent?.label?.toString();
        const tovName = cycleItem.parent?.label?.toString();

        if (projectKey && cycleKey && versionKey && projectName && tovName && treeViews) {
            await treeViews.saveUIContext("testThemes", {
                isCycle: true,
                projectKey,
                cycleKey,
                tovKey: versionKey,
                projectName,
                tovName,
                cycleLabel: cycleItem.label?.toString()
            });
        }

        if (treeViews?.projectsTree && cycleItem.id) {
            await treeViews.projectsTree.handleCycleClick(cycleItem);
        }
    };

    const handleTOVClick = async (versionItem: ProjectsTreeItem) => {
        logger.trace(
            `[extension] Command called: ${allExtensionCommands.handleTOVClick} for item ${versionItem.label}`
        );

        if (!connection) {
            logger.warn(`[extension] Command ${allExtensionCommands.handleTOVClick} called without active connection.`);
            vscode.window.showWarningMessage("No active connection available. Please log in first.");
            return;
        }

        const projectKey = versionItem.getProjectKey();
        const tovKey = versionItem.getVersionKey();
        const projectName = versionItem.parent?.label?.toString();
        const tovName = versionItem.label?.toString();

        if (!(projectKey && tovKey && projectName && tovName)) {
            const errorMessage = `Cannot update language server: Invalid project or TOV values. Project name: ${projectName}, TOV name: ${tovName}`;
            vscode.window.showErrorMessage(errorMessage);
            logger.error(`[extension] ${errorMessage}`);
            return;
        }

        // Prompt to create LS config if missing on TOV click
        const configExists = await hasLsConfig();
        if (!configExists) {
            const choice = await vscode.window.showInformationMessage(
                `No TestBench project configuration found. Create configuration for "${projectName} / ${tovName}"?`,
                "Create",
                "Cancel"
            );
            if (choice === "Create") {
                await writeLsConfig({ projectName, tovName });
            }
        }
    };

    const handleOpenTOV = async (tovItem: ProjectsTreeItem) => {
        if (!treeViews?.testThemesTree) {
            return;
        }

        if (!connection) {
            logger.warn(`[extension] handleOpenTOV called without active connection.`);
            vscode.window.showWarningMessage("No active connection available. Please log in first.");
            return;
        }

        const projectKey = tovItem.getProjectKey();
        const tovKey = tovItem.getVersionKey();
        const projectName = tovItem.parent?.label?.toString();
        const tovName = tovItem.label?.toString();

        if (projectKey && tovKey && projectName && tovName) {
            await treeViews.saveUIContext("testThemes", { isCycle: false, projectKey, tovKey, projectName, tovName });
            await displayTestThemeTreeView();
            await displayTestElementsTreeView();
            await hideProjectManagementTreeView();

            const configExists = await hasLsConfig();
            if (!configExists) {
                const choice = await vscode.window.showInformationMessage(
                    `No TestBench project configuration found. Create configuration for "${projectName} / ${tovName}"?`,
                    "Create",
                    "Cancel"
                );
                if (choice === "Create") {
                    await writeLsConfig({ projectName, tovName });
                }
            } else {
                const cfg = await readLsConfig();
                if (!cfg || !cfg.projectName || cfg.projectName.trim() === "" || cfg.tovName === undefined) {
                    await validateAndFixLsConfigInteractively(cfg || undefined);
                }
            }
            await treeViews.testThemesTree.loadTov(projectKey, tovKey, projectName, tovName);
            if (treeViews.testElementsTree) {
                await treeViews.testElementsTree.loadTov(tovKey, tovItem.label?.toString(), projectName, tovName);
            }
            logger.info(
                `[extension] Successfully opened Test Object Version '${tovName}' in project '${projectName}'.`
            );
        }
    };

    const handleOpenCycle = async (cycleItem: ProjectsTreeItem) => {
        if (!treeViews?.testThemesTree) {
            return;
        }

        if (!connection) {
            logger.warn(`[extension] handleOpenCycle called without active connection.`);
            vscode.window.showWarningMessage("No active connection available. Please log in first.");
            return;
        }

        const projectKey = cycleItem.getProjectKey();
        const cycleKey = cycleItem.getCycleKey();
        const versionKey = cycleItem.getVersionKey();
        const projectName = cycleItem.parent?.parent?.label?.toString();
        const tovName = cycleItem.parent?.label?.toString();

        if (projectKey && cycleKey && versionKey && projectName && tovName) {
            await treeViews.saveUIContext("testThemes", {
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

            const configExists = await hasLsConfig();
            if (!configExists) {
                const choice = await vscode.window.showInformationMessage(
                    `No TestBench project configuration found. Create configuration for "${projectName} / ${tovName}"?`,
                    "Create",
                    "Cancel"
                );
                if (choice === "Create") {
                    await writeLsConfig({ projectName, tovName });
                }
            } else {
                const cfg = await readLsConfig();
                if (!cfg || !cfg.projectName || cfg.projectName.trim() === "" || cfg.tovName === undefined) {
                    await validateAndFixLsConfigInteractively(cfg || undefined);
                }
            }
            await treeViews.testThemesTree.loadCycle(
                projectKey,
                cycleKey,
                versionKey,
                projectName,
                tovName,
                cycleItem.label?.toString()
            );
            if (treeViews.testElementsTree) {
                await treeViews.testElementsTree.loadTov(versionKey, cycleItem.label?.toString(), projectName, tovName);
            }
            logger.info(
                `[extension] Successfully opened Test Cycle '${cycleItem.label?.toString()}' for TOV '${tovName}' in project '${projectName}'.`
            );
        } else {
            throw new Error("Invalid cycle item: missing project, cycle, or version key");
        }
    };

    const clearInternalFolder = async () => {
        logger.trace(`[extension] Command called: ${allExtensionCommands.clearInternalTestbenchFolder}`);
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

    // Test Generation Handlers
    const _handleGenerateTestCasesForTOV = async (tovItem: ProjectsTreeItem) => {
        if (!tovItem) {
            logger.error(`[extension] _handleGenerateTestCasesForTOV called with undefined item`);
            vscode.window.showErrorMessage("Invalid item: Cannot generate test cases for undefined item");
            return;
        }

        if (!treeViews?.projectsTree) {
            logger.warn(`[extension] _handleGenerateTestCasesForTOV called before tree views are initialized`);
            vscode.window.showWarningMessage("Tree views are not ready. Please wait a moment and try again.");
            return;
        }

        try {
            if (treeViews?.testThemesTree) {
                const markingModule = treeViews.testThemesTree.getModule("marking") as MarkingModule | undefined;
                if (markingModule) {
                    markingModule.clearAllMarkings(false);
                }
            }

            await prepareLanguageServerForTreeItemOperation("generate test cases for TOV");
            await treeViews.projectsTree.generateTestCasesForTOV(tovItem);
        } catch (error) {
            if (error instanceof TestBenchConnectionError) {
                logger.debug(
                    `[extension] Test generation for TOV cancelled due to TestBench connection error: ${error.message}`
                );
                return;
            }
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            if (errorMessage.includes("cancelled")) {
                logger.debug(`[extension] Language server wait operation was cancelled by user`);
                vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
            } else {
                logger.error(`[extension] Error in generateTestCasesForTOV: ${errorMessage}`, error);
                vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
            }
        }
    };
    const handleGenerateTestCasesForTOV = withSingleTestOperation(_handleGenerateTestCasesForTOV);

    const _handleGenerateTestCasesForCycle = async (cycleItem: ProjectsTreeItem) => {
        if (!cycleItem) {
            logger.error(`[extension] _handleGenerateTestCasesForCycle called with undefined item`);
            vscode.window.showErrorMessage("Invalid item: Cannot generate test cases for undefined cycle item");
            return;
        }

        if (!connection) {
            logger.error(`[extension] _handleGenerateTestCasesForCycle called without active connection.`);
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

            await prepareLanguageServerForTreeItemOperation("generate test cases for cycle");
            await reportHandler.startTestGenerationForCycle(context, cycleItem);
        } catch (error) {
            if (error instanceof TestBenchConnectionError) {
                logger.debug(
                    `[extension] Test generation for cycle cancelled due to TestBench connection error: ${error.message}`
                );
                return;
            }
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            if (errorMessage.includes("cancelled")) {
                logger.debug(`[extension] Language server wait operation was cancelled by user`);
                vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
            } else {
                logger.error(`[extension] Error in generateTestCasesForCycle: ${errorMessage}`, error);
                vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
            }
        }
    };
    const handleGenerateTestCasesForCycle = withSingleTestOperation(_handleGenerateTestCasesForCycle);

    const _handleGenerateTestCasesForTestThemeOrTestCaseSet = async (testThemeTreeItem: TestThemesTreeItem) => {
        if (!testThemeTreeItem) {
            logger.error(`[extension] _handleGenerateTestCasesForTestThemeOrTestCaseSet called with undefined item`);
            vscode.window.showErrorMessage("Invalid item: Cannot generate test cases for undefined test theme item");
            return;
        }

        if (!treeViews?.testThemesTree) {
            logger.warn(
                `[extension] _handleGenerateTestCasesForTestThemeOrTestCaseSet called before tree views are initialized`
            );
            vscode.window.showWarningMessage("Tree views are not ready. Please wait a moment and try again.");
            return;
        }

        try {
            await prepareLanguageServerForTreeItemOperation("generate test cases for test theme or test case set");
            await treeViews.testThemesTree.generateTestCases(testThemeTreeItem);
        } catch (error) {
            if (error instanceof TestBenchConnectionError) {
                logger.debug(
                    `[extension] Test generation cancelled cancelled due to TestBench connection error: ${error.message}`
                );
                return;
            }
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            if (errorMessage.includes("cancelled")) {
                logger.debug(`[extension] Language server wait operation was cancelled by user`);
                vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
            } else {
                logger.error(`[extension] Error in generateTestCasesForTestThemeOrTestCaseSet: ${errorMessage}`, error);
                vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
            }
        }
    };
    const handleGenerateTestCasesForTestThemeOrTestCaseSet = withSingleTestOperation(
        _handleGenerateTestCasesForTestThemeOrTestCaseSet
    );

    const _handleGenerateTestsForTestThemeTreeItemFromTOV = async (testThemeTreeItem: TestThemesTreeItem) => {
        if (!testThemeTreeItem) {
            logger.error(`[extension] _handleGenerateTestsForTestThemeTreeItemFromTOV called with undefined item`);
            vscode.window.showErrorMessage("Tree item is invalid, cannot generate test cases");
            return;
        }

        if (!treeViews?.testThemesTree) {
            logger.warn(
                `[extension] _handleGenerateTestsForTestThemeTreeItemFromTOV called before tree views are initialized`
            );
            vscode.window.showWarningMessage("Tree views are not ready. Please wait a moment and try again.");
            return;
        }

        try {
            await prepareLanguageServerForTreeItemOperation("generate test cases for test theme tree item");
            await treeViews.testThemesTree.generateTestCases(testThemeTreeItem);
        } catch (error) {
            if (error instanceof TestBenchConnectionError) {
                logger.debug(
                    `[extension] Test generation for test theme tree item cancelled due to TestBench connection error: ${error.message}`
                );
                return;
            }
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            if (errorMessage.includes("cancelled")) {
                logger.debug(`[extension] Language server wait operation was cancelled by user`);
                vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
            } else {
                logger.error(`[extension] Error in generateTestsForTestThemeTreeItemFromTOV: ${errorMessage}`, error);
                vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
            }
        }
    };
    const handleGenerateTestsForTestThemeTreeItemFromTOV = withSingleTestOperation(
        _handleGenerateTestsForTestThemeTreeItemFromTOV
    );

    const _handleReadAndImportTestResultsToTestbench = async (testThemeTreeItem: TestThemesTreeItem) => {
        if (!testThemeTreeItem) {
            logger.error(`[extension] _handleReadAndImportTestResultsToTestbench called with undefined item`);
            vscode.window.showErrorMessage("Tree item is invalid, cannot import test results");
            return;
        }

        if (!treeViews?.testThemesTree) {
            logger.warn(
                `[extension] _handleReadAndImportTestResultsToTestbench called before tree views are initialized`
            );
            vscode.window.showWarningMessage("Tree views are not ready. Please wait a moment and try again.");
            return;
        }

        try {
            await prepareLanguageServerForTreeItemOperation("import test results");
            await treeViews.testThemesTree.importTestResultsForTestThemeTreeItem(testThemeTreeItem);
        } catch (error) {
            if (error instanceof TestBenchConnectionError) {
                logger.debug(
                    `[extension] Test result import cancelled due to TestBench connection error: ${error.message}`
                );
                return;
            }
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            if (errorMessage.includes("cancelled")) {
                logger.debug(`[extension] Language server wait operation was cancelled by user`);
                vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
            } else {
                logger.error(`[extension] Error in readAndImportTestResultsToTestbench: ${errorMessage}`, error);
                vscode.window.showErrorMessage(`Failed to import test results: ${errorMessage}`);
            }
        }
    };
    const handleReadAndImportTestResultsToTestbench = withSingleTestOperation(
        _handleReadAndImportTestResultsToTestbench
    );

    // Tree View Management Handlers
    const handleDisplayAllProjects = async () => {
        if (treeViews?.projectsTree) {
            treeViews.projectsTree.refresh();
        }
        displayProjectManagementTreeView();
        hideTestThemeTreeView();
        hideTestElementsTreeView();
        if (treeViews) {
            await treeViews.saveUIContext("projects");
        }
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

    const handleCreateMissingParentResourceForInteraction = (item: TestElementsTreeItem) => {
        treeViews?.testElementsTree.createMissingParentResourceForInteraction(item);
    };

    const handleUpdateOrRestartLS = () => {
        updateOrRestartLS();
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

    const handleDisplayFiltersForTestThemeTree = async () => {
        if (!treeViews?.testThemesTree) {
            logger.warn("[extension] Test themes tree not available to display filters.");
            return;
        }

        const connection = getConnection();
        if (!connection) {
            vscode.window.showErrorMessage("No connection available to fetch filters.");
            return;
        }

        try {
            const serverFilters = await connection.getFiltersFromOldPlayServer();
            if (!serverFilters || !Array.isArray(serverFilters)) {
                vscode.window.showWarningMessage("Could not fetch filters from the server.");
                return;
            }

            const quickPick = vscode.window.createQuickPick();
            quickPick.canSelectMany = true;
            quickPick.title = "Select filters to apply to the Test Themes tree";

            type FilterQuickPickItem = vscode.QuickPickItem & { filterObject?: any; picked?: boolean };

            const quickPickItems: FilterQuickPickItem[] = serverFilters.map((filter: any) => ({
                label: filter.name,
                description: `Type: ${filter.type}`,
                picked: treeViews?.testThemesTree
                    .getSavedFilters()
                    .some((savedFilter) => savedFilter.key?.serial === filter.key?.serial),
                filterObject: filter
            }));

            if (treeViews.testThemesTree.getSavedFilters().length > 0) {
                quickPickItems.push({
                    label: "Actions",
                    kind: vscode.QuickPickItemKind.Separator
                });
                quickPickItems.push({
                    label: "$(clear-all) Clear filters",
                    description: "Clear all active filters",
                    filterObject: "clear-filters-action",
                    picked: false
                });
            }

            quickPick.items = quickPickItems;
            quickPick.selectedItems = quickPickItems.filter((item) => item.picked);

            const disposables: vscode.Disposable[] = [];

            disposables.push(
                quickPick.onDidChangeSelection(async (selection) => {
                    if (
                        selection.some((item) => (item as FilterQuickPickItem).filterObject === "clear-filters-action")
                    ) {
                        if (treeViews?.testThemesTree) {
                            await treeViews.testThemesTree.clearFiltersAndRefresh();
                        }
                        quickPick.hide();
                    }
                })
            );

            disposables.push(
                quickPick.onDidAccept(async () => {
                    const selectedItems = quickPick.selectedItems;

                    if (!treeViews?.testThemesTree) {
                        logger.warn("[extension] Test themes tree became unavailable during filter selection.");
                        quickPick.hide();
                        return;
                    }

                    const selectedFilters = selectedItems
                        .filter((item) => (item as FilterQuickPickItem).filterObject !== "clear-filters-action")
                        .map((item) => (item as FilterQuickPickItem).filterObject);

                    await treeViews.testThemesTree.applyFiltersAndRefresh(selectedFilters);
                    quickPick.hide();
                })
            );

            disposables.push(
                quickPick.onDidHide(() => {
                    disposables.forEach((d) => d.dispose());
                    quickPick.dispose();
                })
            );

            quickPick.show();
        } catch (error) {
            const errorMessage = `Error displaying filters: ${error instanceof Error ? error.message : "Unknown error"}`;
            logger.error(`[extension] ${errorMessage}`);
            vscode.window.showErrorMessage(errorMessage);
        }
    };

    const handleEnableFilterDiffMode = async () => {
        if (treeViews?.testThemesTree) {
            await treeViews.testThemesTree.enableFilterDiffMode();
        } else {
            logger.warn("[extension] Test themes tree not available to enable filter diff mode.");
        }
    };

    const handleDisableFilterDiffMode = async () => {
        if (treeViews?.testThemesTree) {
            await treeViews.testThemesTree.disableFilterDiffMode();
        } else {
            logger.warn("[extension] Test themes tree not available to disable filter diff mode.");
        }
    };

    const handleResetProjectTreeViewRoot = () => {
        treeViews?.projectsTree.resetCustomRoot();
    };

    const handleResetTestThemeTreeViewRoot = () => {
        treeViews?.testThemesTree.resetCustomRoot();
    };

    const handleInteractionClick = (item: TestElementsTreeItem) => {
        treeViews?.testElementsTree.handleInteractionClick(item);
    };

    const handleOpenAndRevealGeneratedRobotFile = async (item: TestThemesTreeItem) => {
        if (!item) {
            logger.error(`[extension] handleOpenAndRevealGeneratedRobotFile called with undefined item`);
            vscode.window.showErrorMessage("Tree item is invalid, cannot open robot file");
            return;
        }

        await item.openGeneratedRobotFile();
        const robotFilePath = item.getRobotFilePath();
        if (robotFilePath) {
            const uri = vscode.Uri.file(robotFilePath);
            await vscode.commands.executeCommand("revealInExplorer", uri);
        }
    };

    const handleCheckForTestCaseSetDoubleClick = async (item: TestThemesTreeItem) => {
        if (treeViews?.testThemesTree && item.id) {
            await treeViews.testThemesTree.testCaseSetClickHandler.handleClick(item, item.id, logger);
        }
    };

    const handleOpenIssueReporter = async () => {
        logger.trace(`[extension] Command called: ${allExtensionCommands.openIssueReporter}`);
        try {
            await vscode.commands.executeCommand("workbench.action.openIssueReporter", {
                extensionId: "imbus.testbench-extension"
            });
            logger.trace(`[extension] Opened VS Code issue reporter with TestBench extension preselected`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.error(`[extension] Error opening issue reporter: ${errorMessage}`, error);
            vscode.window.showErrorMessage(`Failed to open issue reporter: ${errorMessage}`);
        }
    };

    /**
     * Handles the search functionality for a given tree view.
     * Provides a live search within an input box,
     * and a button to configure search options.
     * @param treeView The tree view instance to perform the search on.
     */
    const handleSearchInTreeView = async (treeView: TreeViewBase<TreeItemBase>): Promise<void> => {
        logger.trace(`[extension] Initiating search for tree view: ${treeView.config.id}`);
        const filteringModule = treeView.getModule("filtering");
        if (!filteringModule) {
            logger.warn(`[extension] Search cancelled: FilteringModule not found for tree view ${treeView.config.id}.`);
            vscode.window.showWarningMessage("Search functionality is not available for this view.");
            return;
        }

        const currentFilter = filteringModule.getTextFilter();
        logger.trace(`[extension] Current text filter: ${JSON.stringify(currentFilter)}`);
        const treeViewId = treeView.config.id;
        const isProjectsTree = treeViewId === "testbench.projects";

        // Use existing filter options or defaults.
        let searchOptionsToUse = {
            searchInName: currentFilter?.searchInName ?? true,
            searchInDescription: currentFilter?.searchInDescription ?? !isProjectsTree,
            searchInTooltip: currentFilter?.searchInTooltip ?? true,
            caseSensitive: currentFilter?.caseSensitive ?? false,
            exactMatch: currentFilter?.exactMatch ?? false,
            showChildrenOfMatches: currentFilter?.showChildrenOfMatches ?? true
        };

        const inputBox = vscode.window.createInputBox();
        inputBox.title = `Search in ${treeView.config.title}`;
        inputBox.value = currentFilter?.searchText || "";
        inputBox.prompt = "Enter search text.";

        // Button to configure search options on top right of the input box.
        const configureButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon("settings-gear"),
            tooltip: "Configure Search Options"
        };
        inputBox.buttons = [configureButton];

        const disposables: vscode.Disposable[] = [];

        /**
         * Applies the text filter to the tree view based on the current search text and options.
         * @param searchText The text to search for.
         */
        const performSearch = (searchText: string) => {
            if (!searchText.trim()) {
                if (filteringModule.getTextFilter() !== null) {
                    logger.trace("[extension] Search text is empty, clearing filter.");
                    filteringModule.setTextFilter(null);
                }
                return;
            }

            const newFilterOptions: TextFilterOptions = {
                searchText: searchText,
                ...searchOptionsToUse,
                searchInId: false,
                searchInType: false,
                showParentsOfMatches: true
            };

            logger.trace(`[extension] Applying text filter: ${JSON.stringify(newFilterOptions)}`);
            filteringModule.setTextFilter(newFilterOptions);
        };

        const showOptionsQuickPick = async (): Promise<void> => {
            inputBox.hide();

            const searchCriteria: (vscode.QuickPickItem & { id: string; picked?: boolean })[] = [
                {
                    id: "Name",
                    label: "Name",
                    description: "Search in item's name",
                    picked: searchOptionsToUse.searchInName
                }
            ];

            if (!isProjectsTree) {
                searchCriteria.push({
                    id: "Description",
                    label: "UID",
                    description: "Search in item's unique ID",
                    picked: searchOptionsToUse.searchInDescription
                });
            }

            searchCriteria.push({
                id: "Tooltip",
                label: "Tooltip",
                description: "Search in all available item fields",
                picked: searchOptionsToUse.searchInTooltip
            });

            // Define search option items for the quick pick.
            const quickPickSearchOptions: (vscode.QuickPickItem & { id: string; picked?: boolean })[] = [
                {
                    id: "CaseSensitive",
                    label: "Case Sensitive",
                    description: "Perform a case-sensitive search",
                    picked: searchOptionsToUse.caseSensitive
                },
                {
                    id: "ExactMatch",
                    label: "Exact Match",
                    description: "Perform an exact match search",
                    picked: searchOptionsToUse.exactMatch
                },
                {
                    id: "ShowChildren",
                    label: "Show Children of Matches",
                    description: "Show all children of matching items",
                    picked: searchOptionsToUse.showChildrenOfMatches
                }
            ];

            const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { id: string }>();
            quickPick.canSelectMany = true;
            quickPick.placeholder = "Select search criteria and options";
            quickPick.title = `Search Options for ${treeView.config.title}`;

            const quickPickItems: (vscode.QuickPickItem & { id: string })[] = [
                { id: "separator-criteria", label: "Search Criteria", kind: vscode.QuickPickItemKind.Separator },
                ...searchCriteria,
                { id: "separator-options", label: "Options", kind: vscode.QuickPickItemKind.Separator },
                ...quickPickSearchOptions
            ];

            quickPick.items = quickPickItems;
            quickPick.selectedItems = quickPickItems.filter((item) => (item as any).picked);

            const quickPickDisposables: vscode.Disposable[] = [];

            // Update search options when selection confirmed
            quickPickDisposables.push(
                quickPick.onDidAccept(() => {
                    const selectedItems = quickPick.selectedItems;
                    searchOptionsToUse = {
                        searchInName: selectedItems.some((i) => i.id === "Name"),
                        searchInDescription: selectedItems.some((i) => i.id === "Description"),
                        searchInTooltip: selectedItems.some((i) => i.id === "Tooltip"),
                        caseSensitive: selectedItems.some((i) => i.id === "CaseSensitive"),
                        exactMatch: selectedItems.some((i) => i.id === "ExactMatch"),
                        showChildrenOfMatches: selectedItems.some((i) => i.id === "ShowChildren")
                    };
                    quickPick.hide();
                })
            );

            quickPickDisposables.push(
                quickPick.onDidHide(() => {
                    quickPickDisposables.forEach((d) => d.dispose());
                    quickPick.dispose();
                    inputBox.show();
                    performSearch(inputBox.value);
                })
            );

            quickPick.show();
        };

        // Perform live search when input box value changes.
        disposables.push(
            inputBox.onDidChangeValue((searchText) => {
                performSearch(searchText);
            })
        );

        // Show search options when configure button is clicked.
        disposables.push(
            inputBox.onDidTriggerButton(async (button) => {
                if (button === configureButton) {
                    await showOptionsQuickPick();
                }
            })
        );

        // Hide the input box when the user presses Enter.
        disposables.push(
            inputBox.onDidAccept(async () => {
                inputBox.hide();
            })
        );

        disposables.push(
            inputBox.onDidHide(() => {
                disposables.forEach((d) => d.dispose());
                inputBox.dispose();
            })
        );

        inputBox.show();
        // Perform initial search if there is text in the input box (from a previous search).
        if (inputBox.value) {
            performSearch(inputBox.value);
        }
    };

    const handleSearchInProjectsTree = async () => {
        if (treeViews?.projectsTree) {
            await handleSearchInTreeView(treeViews.projectsTree);
        }
    };

    const handleSearchInTestThemesTree = async () => {
        if (treeViews?.testThemesTree) {
            await handleSearchInTreeView(treeViews.testThemesTree);
        }
    };

    const handleSearchInTestElementsTree = async () => {
        if (treeViews?.testElementsTree) {
            await handleSearchInTreeView(treeViews.testElementsTree);
        }
    };

    const handleSetActiveProject = async (item: ProjectsTreeItem) => {
        logger.trace(`[extension] Command called: ${allExtensionCommands.setActiveProject}`);
        if (!item) {
            logger.warn("[extension] 'Set as Active Project' called without an item.");
            return;
        }

        const languageServerParams = item.getLanguageServerParameters();
        if (!languageServerParams) {
            vscode.window.showErrorMessage("Could not determine configuration from the selected item.");
            return;
        }

        const { projectName } = languageServerParams;

        const choice = await vscode.window.showInformationMessage(
            `Set '${projectName}' as the active project? The currently active TOV will be kept if it belongs to this project.`,
            { modal: true },
            "Set Active Project"
        );
        if (choice !== "Set Active Project") {
            return;
        }

        const currentConfig = await readLsConfig();
        const newConfig: LanguageServerConfig = {
            projectName: projectName,
            tovName: currentConfig?.tovName || ""
        };

        await writeLsConfig(newConfig);
        vscode.window.showInformationMessage(`Active project set to: ${newConfig.projectName}`);
    };

    const handleSetActiveTOV = async (item: ProjectsTreeItem) => {
        logger.trace(`[extension] Command called: ${allExtensionCommands.setActiveTOV}`);
        if (!item) {
            logger.warn("[extension] 'Set as Active TOV' called without an item.");
            return;
        }

        const languageServerParams = item.getLanguageServerParameters();
        if (!languageServerParams) {
            vscode.window.showErrorMessage("Could not determine configuration from the selected item.");
            return;
        }

        const { projectName, tovName } = languageServerParams;
        if (!tovName) {
            vscode.window.showErrorMessage("Could not determine TOV from the selected item.");
            return;
        }

        const newConfig: LanguageServerConfig = {
            projectName: projectName,
            tovName: tovName
        };

        await writeLsConfig(newConfig);
        vscode.window.showInformationMessage(
            `Active configuration set to: ${newConfig.projectName} / ${newConfig.tovName}`
        );
    };

    const handleValidateAndFixLsConfig = async () => {
        logger.trace(`[extension] Command called: ${allExtensionCommands.validateAndFixLsConfig}`);
        if (!(await hasLsConfig())) {
            vscode.window.showInformationMessage("No TestBench project configuration file found to validate.");
            return;
        }
        await validateAndFixLsConfigInteractively(undefined);
    };

    // --- Command Registry ---
    const commandRegistry = [
        // Authentication and Session
        { id: allExtensionCommands.login, handler: handleLogin },
        { id: allExtensionCommands.logout, handler: handleLogout },

        // Tree Interaction and Navigation
        { id: allExtensionCommands.handleCycleClick, handler: handleCycleClick },
        { id: allExtensionCommands.handleTOVClick, handler: handleTOVClick },
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
        { id: allExtensionCommands.displayFiltersForTestThemeTree, handler: handleDisplayFiltersForTestThemeTree },
        {
            id: allExtensionCommands.displayFiltersForTestThemeTreeEnabled,
            handler: handleDisplayFiltersForTestThemeTree
        },
        {
            id: allExtensionCommands.displayFiltersForTestThemeTreeDisabled,
            handler: handleDisplayFiltersForTestThemeTree
        },
        { id: allExtensionCommands.enableFilterDiffMode, handler: handleEnableFilterDiffMode },
        { id: allExtensionCommands.disableFilterDiffMode, handler: handleDisableFilterDiffMode },
        {
            id: allExtensionCommands.makeRoot,
            handler: handleMakeRoot
        },
        { id: allExtensionCommands.resetProjectTreeViewRoot, handler: handleResetProjectTreeViewRoot },
        {
            id: allExtensionCommands.resetTestThemeTreeViewRoot,
            handler: handleResetTestThemeTreeViewRoot
        },

        // Other extension commands
        { id: allExtensionCommands.clearInternalTestbenchFolder, handler: clearInternalFolder },
        { id: allExtensionCommands.clearAllExtensionData, handler: () => clearAllExtensionData(context, true) },
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
        },
        {
            id: allExtensionCommands.createMissingParentResourceForInteraction,
            handler: handleCreateMissingParentResourceForInteraction
        },
        {
            id: allExtensionCommands.handleInteractionClick,
            handler: handleInteractionClick
        },
        {
            id: allExtensionCommands.openAndRevealGeneratedRobotFile,
            handler: handleOpenAndRevealGeneratedRobotFile
        },
        {
            id: allExtensionCommands.checkForTestCaseSetDoubleClick,
            handler: handleCheckForTestCaseSetDoubleClick
        },
        {
            id: allExtensionCommands.openIssueReporter,
            handler: handleOpenIssueReporter
        },
        { id: allExtensionCommands.searchInProjectsTreeOn, handler: handleSearchInProjectsTree },
        { id: allExtensionCommands.searchInProjectsTreeOff, handler: handleSearchInProjectsTree },
        { id: allExtensionCommands.searchInTestThemesTreeOn, handler: handleSearchInTestThemesTree },
        { id: allExtensionCommands.searchInTestThemesTreeOff, handler: handleSearchInTestThemesTree },
        { id: allExtensionCommands.searchInTestElementsTreeOn, handler: handleSearchInTestElementsTree },
        { id: allExtensionCommands.searchInTestElementsTreeOff, handler: handleSearchInTestElementsTree },
        { id: allExtensionCommands.setActiveProject, handler: handleSetActiveProject },
        { id: allExtensionCommands.setActiveTOV, handler: handleSetActiveTOV },
        { id: allExtensionCommands.validateAndFixLsConfig, handler: handleValidateAndFixLsConfig }
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
 * @param context - The extension context.
 * @returns The new connection.
 */
async function createNewConnection(
    activeConnection: connectionManager.TestBenchConnection,
    session: vscode.AuthenticationSession,
    currentConnection: PlayServerConnection | null,
    context: vscode.ExtensionContext,
    isInsecure: boolean
): Promise<PlayServerConnection> {
    if (currentConnection) {
        logger.warn(
            "[extension] A different connection was active. Logging out from previous server session before establishing new one."
        );
        await currentConnection.teardownAfterLogout();
    }

    const newConnection = new PlayServerConnection(
        activeConnection.serverName,
        activeConnection.portNumber,
        activeConnection.username,
        session.accessToken,
        context,
        isInsecure
    );
    await newConnection.initialize();
    setConnection(newConnection);
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, true);
    getLoginWebViewProvider()?.updateWebviewHTMLContent();
    return newConnection;
}

/**
 * Handles the case when there's no active connection but a session exists. *
 */
async function handleNoActiveConnection(): Promise<void> {
    if (connection) {
        await connection.teardownAfterLogout();
    }

    if (treeViews) {
        treeViews.clear();
        await treeViews.loadDefaultViewsUI();
    }
}

/**
 * Handles the case when there's no session (logout).
 */
async function handleNoSession(): Promise<void> {
    if (connection) {
        await connection.teardownAfterLogout();
    }
    setConnection(null);
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);

    // Save current state before ending session to ensure persistence
    if (treeViews) {
        await treeViews.saveCurrentState();
    }

    userSessionManager.endSession();

    // Clear tree data but preserve persistent state (expansion, marking, etc.)
    if (treeViews) {
        treeViews.projectsTree.clearTree();
        treeViews.testThemesTree.clearTree();
        treeViews.testElementsTree.clearTree();
        await treeViews.loadDefaultViewsUI();
    }

    await stopLanguageClient();
    getLoginWebViewProvider()?.updateWebviewHTMLContent();
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
    logger.trace(`[extension] Handling session change`);

    const sessionToProcess = await getSessionToProcess(existingSession);
    const wasPreviouslyConnected = !!connection;
    const previousSessionToken = connection?.getSessionToken();

    if (sessionToProcess?.accessToken) {
        // Clear previous logout signals on new login
        await context.globalState.update(StorageKeys.LOGOUT_SIGNAL_KEY, undefined);
        logger.trace("[extension] Cleared logout signal due to new session.");

        getLoginWebViewProvider()?.resetEditMode();
        setIsHandlingLogout(false);
        const previousUserId = userSessionManager.getCurrentUserId();
        const newUserId = sessionToProcess.account.id;
        const wasNewSessionStarted = previousUserId !== newUserId;
        const sharedSessionManager = SharedSessionManager.getInstance(context);
        const sharedSession = await sharedSessionManager.getSharedSession();
        let isInsecure = false;
        if (sharedSession && sharedSession.sessionToken === sessionToProcess.accessToken) {
            isInsecure = sharedSession.isInsecure;
        }

        // If switching to a different user, reset state for the previous user's data
        if (wasNewSessionStarted && previousUserId !== "global_fallback" && treeViews) {
            logger.trace(
                `[extension] Switching from user ${previousUserId} to ${newUserId}, clearing previous user's tree state`
            );
            await treeViews.resetForNewUser();
        }

        userSessionManager.startSession({
            userKey: sessionToProcess.account.id,
            login: sessionToProcess.account.label
        });

        if (treeViews) {
            const reason = wasNewSessionStarted ? "New user session" : "Session restored/relogged";
            logger.trace(`[extension] ${reason} for ${sessionToProcess.account.label}. Reloading persistent UI state.`);
            await treeViews.reloadAllTreeViewsStateFromPersistence();
        }
        const activeConnection = await connectionManager.getActiveConnection(context);

        if (!activeConnection) {
            await handleNoActiveConnection();
            return;
        }

        if (connectionManager.isConnectionAlreadyActive(connection, sessionToProcess, activeConnection)) {
            logger.trace(
                `[extension] Connection for '${activeConnection.label}' and current session token is already active. Skipping re-initialization.`
            );
            return;
        }
        const newConnection = await createNewConnection(
            activeConnection,
            sessionToProcess,
            connection,
            context,
            isInsecure
        );
        await handleLanguageServerRestartOnSessionChange(previousSessionToken, newConnection.getSessionToken());

        const isNewConnection =
            !wasPreviouslyConnected ||
            !!(connection && connection.getSessionToken() !== newConnection.getSessionToken());

        if (isNewConnection && treeViews) {
            logger.trace("[extension] New connection established.");
            await treeViews.restoreViewsState();
        }
    } else {
        setIsHandlingLogout(true);
        await handleNoSession();
        setIsHandlingLogout(false);
    }
}

/** Sets up and registers the authentication provider and its listeners.
 * @param context The extension context.
 * @param instanceId A unique identifier for this extension instance.
 * @returns The initialized TestBenchAuthenticationProvider instance.
 */
function initializeAuthentication(
    context: vscode.ExtensionContext,
    instanceId: string
): TestBenchAuthenticationProvider {
    const authProviderInstance = new TestBenchAuthenticationProvider(context, instanceId);
    context.subscriptions.push(
        vscode.authentication.registerAuthenticationProvider(
            TESTBENCH_AUTH_PROVIDER_ID,
            TESTBENCH_AUTH_PROVIDER_LABEL,
            authProviderInstance,
            { supportsMultipleAccounts: false }
        )
    );

    context.subscriptions.push(
        vscode.authentication.onDidChangeSessions(async (e) => {
            if (e.provider.id !== TESTBENCH_AUTH_PROVIDER_ID || isHandlingSessionChange) {
                return;
            }

            isHandlingSessionChange = true;
            logger.trace("[extension] TestBench authentication sessions changed.");
            try {
                const currentSession = await vscode.authentication.getSession(
                    TESTBENCH_AUTH_PROVIDER_ID,
                    ["api_access"],
                    { createIfNone: false, silent: true }
                );
                await handleTestBenchSessionChange(context, currentSession);
            } catch (error) {
                logger.error("[extension] Error getting session in onDidChangeSessions listener:", error);
                await handleTestBenchSessionChange(context, undefined);
            } finally {
                isHandlingSessionChange = false;
            }
        })
    );

    logger.trace("[extension] TestBenchAuthenticationProvider registered.");
    return authProviderInstance;
}

/** Initializes context keys. */
async function initializeContextValues(context: vscode.ExtensionContext): Promise<void> {
    // Set initial context states
    const initialContexts = [
        { key: ContextKeys.CONNECTION_ACTIVE, value: false },
        { key: ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, value: false },
        { key: ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, value: false },
        { key: ContextKeys.FILTER_DIFF_MODE_ENABLED, value: false },
        { key: ContextKeys.FILTER_DIFF_MODE_ENABLED_PROJECTS, value: false },
        { key: ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_THEMES, value: false },
        { key: ContextKeys.FILTER_DIFF_MODE_ENABLED_TEST_ELEMENTS, value: false },
        { key: ContextKeys.TEST_THEME_TREE_HAS_FILTERS, value: false }
    ];

    for (const ctx of initialContexts) {
        await vscode.commands.executeCommand("setContext", ctx.key, ctx.value);
    }

    const isTTOpenedFromCycle = context.globalState.get<string | undefined>(
        StorageKeys.IS_TT_OPENED_FROM_CYCLE_STORAGE_KEY
    );
    await vscode.commands.executeCommand("setContext", ContextKeys.IS_TT_OPENED_FROM_CYCLE, isTTOpenedFromCycle);
}

/**
 * Validates a stored session by attempting to use it to fetch a simple endpoint.
 * This prevents creating connections and opening tree views with expired tokens.
 * @param context The extension context
 * @param session The session to validate
 * @returns True if the session is valid, false otherwise
 */
async function validateStoredSession(
    context: vscode.ExtensionContext,
    session: vscode.AuthenticationSession
): Promise<boolean> {
    logger.trace("[extension] Validating stored session before restoration...");

    try {
        const sharedSessionManager = SharedSessionManager.getInstance(context);
        const sharedSession = await sharedSessionManager.getSharedSession();

        if (!sharedSession || sharedSession.sessionToken !== session.accessToken) {
            logger.debug("[extension] No matching shared session data found for validation.");
            return false;
        }

        const tempConnection = new PlayServerConnection(
            sharedSession.serverName,
            sharedSession.portNumber,
            sharedSession.username,
            sharedSession.sessionToken,
            context,
            sharedSession.isInsecure
        );

        await tempConnection.initialize();
        const isValid = await sharedSessionManager.validateSession(tempConnection);
        await tempConnection.teardownAfterLogout();

        if (!isValid) {
            logger.debug("[extension] Stored session validation failed, session is expired or invalid.");
            await sharedSessionManager.clearSharedSession();
        }

        return isValid;
    } catch (error: any) {
        logger.warn("[extension] Session validation failed:", error.message || error);
        const sharedSessionManager = SharedSessionManager.getInstance(context);
        await sharedSessionManager.clearSharedSession();
        return false;
    }
}

/** Attempts to restore a previous session or perform an automatic login. */
async function handleInitialSession(context: vscode.ExtensionContext): Promise<void> {
    logger.trace("[extension] Checking for existing TestBench session to restore...");
    try {
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: false,
            silent: true
        });

        if (session) {
            // Validate the session before using it
            const isSessionValid = await validateStoredSession(context, session);

            if (isSessionValid) {
                await handleTestBenchSessionChange(context, session);
                logger.debug("[extension] Successfully restored previous TestBench session.");
                return; // Session restored, no need for auto-login
            } else {
                logger.debug("[extension] Stored session is no longer valid. Clearing session and showing login.");
                // Remove the invalid session
                if (authProviderInstance) {
                    await authProviderInstance.removeSession(session.id);
                }
                getLoginWebViewProvider()?.updateWebviewHTMLContent();
                return;
            }
        }

        logger.debug("[extension] No previous session found. Checking for auto-login config.");
        if (getExtensionConfiguration().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
            logger.debug("[extension] Auto-login is enabled. Attempting silent login.");
            performAutomaticLogin(context);
        } else {
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
        }
    } catch (error) {
        logger.warn("[extension] Error trying to get initial TestBench session silently:", error);
        getLoginWebViewProvider()?.updateWebviewHTMLContent();
    }
}

/** Performs a silent, automatic login if configured. */
async function performAutomaticLogin(context: vscode.ExtensionContext): Promise<void> {
    logger.trace(`[extension] Performing automatic login on activation.`);
    try {
        authProviderInstance?.markNextLoginAsSilent();
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: true
        });

        if (session) {
            await handleTestBenchSessionChange(context, session);
        }
    } catch (error) {
        logger.trace("[extension] Automatic login failed silently:", error);
    }
}

/** Sets up the polling mechanism to sync logout across multiple windows.
 * @param context The extension context.
 * @param instanceId A unique identifier for this extension instance. *
 */
function initializeCrossWindowStateSync(context: vscode.ExtensionContext, instanceId: string): void {
    let lastProcessedLogoutTimestamp = 0;
    const logoutPollInterval = setInterval(async () => {
        const signal = context.globalState.get<{ initiatorId: string; timestamp: number }>(
            StorageKeys.LOGOUT_SIGNAL_KEY
        );

        if (signal && signal.initiatorId !== instanceId && signal.timestamp > lastProcessedLogoutTimestamp) {
            logger.trace(
                `[extension] Detected logout signal from instance (${signal.initiatorId}). Logging out this instance (${instanceId}).`
            );
            lastProcessedLogoutTimestamp = signal.timestamp;

            if (connection) {
                await vscode.commands.executeCommand(allExtensionCommands.logout);
            }
        }
    }, 3000); // Poll every 3 seconds

    context.subscriptions.push({
        dispose: () => clearInterval(logoutPollInterval)
    });
}

/**
 * Called when the extension is activated.
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        const instanceId = uuidv4();
        logger = new testBenchLogger.TestBenchLogger();
        logger.info(`[extension] Activating extension instance ${instanceId}.`);
        initializeConfigurationWatcher();

        // Initialize login webview
        loginWebViewProvider = new loginWebView.LoginWebViewProvider(context);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(loginWebView.LoginWebViewProvider.viewId, loginWebViewProvider, {
                webviewOptions: { retainContextWhenHidden: true }
            })
        );

        // Authentication and session management
        authProviderInstance = initializeAuthentication(context, instanceId);
        userSessionManager = new UserSessionManager(context);

        await initializeTreeViews(context);
        await initializeContextValues(context);
        await registerExtensionCommands(context);
        configureLanguageServerIntegration(context);
        await activeConfigService.initialize(context);

        // Handle session restoration and automatic login after everything is set up
        await handleInitialSession(context);

        // Start background tasks
        initializeCrossWindowStateSync(context, instanceId);

        logger.info(`[extension] Extension instance ${instanceId} activated successfully.`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        // Ensure logger is initialized, or fall back to console
        const log = logger ? logger.error : console.error;
        log(`[extension] Failed to activate extension. ${errorMessage}`, error);
        vscode.window.showErrorMessage(`TestBench Extension failed to activate: ${errorMessage}`);
    }
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
                    "• Import tracking data\n" +
                    "• All persistent settings\n\n" +
                    "This action cannot be undone. Are you sure you want to continue?",
                { modal: true },
                "Clear All Data"
            );

            if (confirmation !== "Clear All Data") {
                return false;
            }
        }

        if (connection) {
            try {
                await connection.teardownAfterLogout();
            } catch (error) {
                logger.error("[extension] Error logging out from server while clearing all extension data:", error);
            }
            setConnection(null);
        }

        logger.debug("[extension] Clearing connection passwords from secret storage...");
        try {
            const connections = await connectionManager.getConnections(context);
            for (const conn of connections) {
                try {
                    await context.secrets.delete(StorageKeys.CONNECTION_PASSWORD_SECRET_PREFIX + conn.id);
                    logger.debug(`[extension] Cleared password for connection: ${conn.label}`);
                } catch (error) {
                    logger.error(
                        `[extension] Error clearing password for connection ${conn.label} while clearing all extension data:`,
                        error
                    );
                }
            }
        } catch (error) {
            logger.error("[extension] Error clearing connection passwords while clearing all extension data:", error);
        }

        try {
            logger.debug("[extension] Clearing VS Code authentication sessions...");
            const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, [], {
                createIfNone: false,
                silent: true
            });
            if (session && authProviderInstance) {
                await authProviderInstance.removeSession(session.id);
            }
        } catch (error) {
            logger.error("[extension] Error clearing authentication session while clearing all extension data:", error);
        }

        // State Clearing Logic
        const extensionKeyPatterns = ["testbenchExtension.", "treeState.", "treeView.state."];

        logger.debug("[extension] Clearing workspace state storage for all users...");
        const allWorkspaceKeys = context.workspaceState.keys();
        const extensionWorkspaceKeys = allWorkspaceKeys.filter((key) =>
            extensionKeyPatterns.some((pattern) => key.includes(pattern))
        );

        for (const key of extensionWorkspaceKeys) {
            try {
                await context.workspaceState.update(key, undefined);
                logger.trace(`[extension] Cleared workspace state key: ${key}`);
            } catch (error) {
                logger.error(`[extension] Error clearing workspace state key ${key}:`, error);
            }
        }

        logger.debug("[extension] Clearing global state storage for all users...");
        const allGlobalKeys = context.globalState.keys();
        const extensionGlobalKeys = allGlobalKeys.filter((key) =>
            extensionKeyPatterns.some((pattern) => key.includes(pattern))
        );

        for (const key of extensionGlobalKeys) {
            try {
                await context.globalState.update(key, undefined);
                logger.trace(`[extension] Cleared global state key: ${key}`);
            } catch (error) {
                logger.error(`[extension] Error clearing global state key ${key}:`, error);
            }
        }

        if (treeViews) {
            logger.debug("[extension] Clearing tree data and state...");
            try {
                treeViews.clear();

                if (treeViews.projectsTree) {
                    await treeViews.projectsTree.clearAllModuleState();
                }
                if (treeViews.testThemesTree) {
                    await treeViews.testThemesTree.clearAllModuleState();
                }
                if (treeViews.testElementsTree) {
                    await treeViews.testElementsTree.clearAllModuleState();
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
                logger.error("[extension] Error clearing tree data while clearing all extension data:", error);
            }
        }

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
                logger.error(`[extension] Error updating context ${key}:`, error);
            }
        }

        try {
            getLoginWebViewProvider()?.updateWebviewHTMLContent();
        } catch (error) {
            logger.error("[extension] Error updating login webview while clearing all extension data:", error);
        }

        if (client) {
            logger.debug("[extension] Stopping language client...");
            try {
                await stopLanguageClient(true);
            } catch (error) {
                logger.error("[extension] Error stopping language client while clearing all extension data:", error);
            }
        }

        logger.debug("[extension] Clearing internal testbench folder...");
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
            logger.error(
                "[extension] Error clearing internal testbench folder while clearing all extension data:",
                error
            );
        }

        try {
            await treeViews?.testThemesTree.clearAllContextSpecificFilters();
        } catch (error) {
            logger.error("[extension] Error clearing saved test theme filters during clear all:", error);
        }

        try {
            await displayProjectManagementTreeView();
            await hideTestThemeTreeView();
            await hideTestElementsTreeView();
        } catch (error) {
            logger.error("[extension] Error managing view visibility while clearing all extension data:", error);
        }

        logger.info("[extension] All extension data cleared successfully.");

        if (showConfirmation) {
            vscode.window.showInformationMessage(
                "All TestBench extension data has been cleared successfully. You will need to log in again to use the extension."
            );
        }

        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(`[extension] Error during clear all extension data operation: ${errorMessage}`, error);

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
    logger.trace("[extension] Deactivating extension.");
    try {
        isTestOperationInProgress = false;

        // if (connection) {
        //     await connection.logoutUserOnServer();
        // }
        if (client) {
            await stopLanguageClient(true);
        }
        if (treeViews) {
            await treeViews.projectsTree.dispose();
            await treeViews.testThemesTree.dispose();
            await treeViews.testElementsTree.dispose();
            treeViews = null;
        }
        activeConfigService.dispose();
        logger.info("[extension] Extension deactivated");
        if (logger) {
            logger.dispose();
        }
    } catch (error) {
        logger.error("[extension] Error during deactivation:", error);
        if (logger) {
            logger.dispose();
        }
    }
}
