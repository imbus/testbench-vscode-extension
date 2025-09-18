/**
 * @file src/extension.ts
 * @description Main entry point for the TestBench VS Code extension.
 */

// Before releasing the extension:
// TODO: Add License.md to the extension
// TODO: Set logger level to info or debug in production, remove too detailed logs.
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
import { PlayServerConnection } from "./testBenchConnection";
import { getExtensionConfiguration, initializeConfigurationWatcher } from "./configuration";
import { TestThemesTreeItem } from "./treeViews/implementations/testThemes/TestThemesTreeItem";
import { MarkingModule } from "./treeViews/features/MarkingModule";
import { TestElementsTreeItem } from "./treeViews/implementations/testElements/TestElementsTreeItem";
import { TreeViews } from "./treeViews/TreeViewFactory";
import { ProjectsTreeItem } from "./treeViews/implementations/projects/ProjectsTreeItem";
import * as reportHandler from "./reportHandler";
import * as utils from "./utils";
import path from "path";
import {
    updateOrRestartLS,
    stopLanguageClient,
    client,
    handleLanguageServerRestartOnSessionChange,
    prepareLanguageServerForTreeItemOperation,
    setIsHandlingLogout
} from "./server";
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
        logger.trace(`[extension] Command called: ${allExtensionCommands.logout}`);

        if (connection) {
            await connection.logoutUserOnServer();
        }

        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            silent: true
        });
        if (session && authProviderInstance) {
            // Removing the session fires onDidChangeSessions and triggers proper UI cleanup.
            await authProviderInstance.removeSession(session.id);
        }

        await stopLanguageClient();

        // Fallback to ensure UI is reset if a connection object still exists without a session.
        if (connection !== null) {
            await handleTestBenchSessionChange(context, undefined);
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

        if (projectKey && tovKey && projectName && tovName) {
            await updateOrRestartLS(projectName, tovName);
        } else {
            const errorMessage = `Cannot update language server: Invalid project or TOV values. Project name: ${projectName}, TOV name: ${tovName}`;
            vscode.window.showErrorMessage(errorMessage);
            logger.error(`[extension] ${errorMessage}`);
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
            await updateOrRestartLS(projectName, tovName);
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
            await updateOrRestartLS(projectName, tovName);
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

            await prepareLanguageServerForTreeItemOperation(tovItem, "generate test cases for TOV");
            await treeViews.projectsTree.generateTestCasesForTOV(tovItem);
        } catch (error) {
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

            await prepareLanguageServerForTreeItemOperation(cycleItem, "generate test cases for cycle");
            await reportHandler.startTestGenerationForCycle(context, cycleItem);
        } catch (error) {
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
            await prepareLanguageServerForTreeItemOperation(
                testThemeTreeItem,
                "generate test cases for test theme or test case set"
            );
            await treeViews.testThemesTree.generateTestCases(testThemeTreeItem);
        } catch (error) {
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
            await prepareLanguageServerForTreeItemOperation(
                testThemeTreeItem,
                "generate test cases for test theme tree item"
            );
            await treeViews.testThemesTree.generateTestCases(testThemeTreeItem);
        } catch (error) {
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
            await prepareLanguageServerForTreeItemOperation(testThemeTreeItem, "import test results");
            await treeViews.testThemesTree.importTestResultsForTestThemeTreeItem(testThemeTreeItem);
        } catch (error) {
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

    const handleDisplayFiltersForTestThemeTree = async () => {
        logger.debug(`[extension] Command called: testbenchExtension.displayFiltersForTestThemeTree ON or OFF`);

        if (!treeViews?.testThemesTree) {
            logger.warn(
                `[extension] testbenchExtension.displayFiltersForTestThemeTree ON or OFF called before test themes tree is initialized`
            );
            return;
        }

        if (!connection) {
            logger.warn(
                `[extension] testbenchExtension.displayFiltersForTestThemeTree ON or OFF called without active connection.`
            );
            vscode.window.showWarningMessage("No active connection available. Please log in first.");
            return;
        }

        try {
            const filters = await connection.getFiltersFromOldPlayServer();
            if (!filters) {
                return;
            }

            const quickPickItems: vscode.QuickPickItem[] = filters.map((filter: any) => {
                let iconPath: { light: vscode.Uri; dark: vscode.Uri } | undefined;

                switch (filter.type) {
                    case "TestTheme":
                        iconPath = {
                            light: vscode.Uri.file(
                                path.join(extensionContext.extensionPath, "resources/icons/TestThemeOriginal-light.svg")
                            ),
                            dark: vscode.Uri.file(
                                path.join(extensionContext.extensionPath, "resources/icons/TestThemeOriginal-dark.svg")
                            )
                        };
                        break;

                    case "TestCaseSet":
                        iconPath = {
                            light: vscode.Uri.file(
                                path.join(
                                    extensionContext.extensionPath,
                                    "resources/icons/TestCaseSetOriginal-light.svg"
                                )
                            ),

                            dark: vscode.Uri.file(
                                path.join(
                                    extensionContext.extensionPath,
                                    "resources/icons/TestCaseSetOriginal-dark.svg"
                                )
                            )
                        };
                        break;

                    case "TestCase":
                        iconPath = {
                            light: vscode.Uri.file(
                                path.join(extensionContext.extensionPath, "resources/icons/testCase-light.svg")
                            ),
                            dark: vscode.Uri.file(
                                path.join(extensionContext.extensionPath, "resources/icons/testCase-dark.svg")
                            )
                        };
                        break;

                    default:
                        iconPath = undefined;
                        break;
                }

                return {
                    label: filter.name,
                    description: `Type: ${filter.type}`,
                    picked: false,
                    iconPath: iconPath,
                    filterData: filter
                } as vscode.QuickPickItem & { filterData: any };
            });

            const savedFilters = treeViews?.testThemesTree?.getSavedFilters() || [];
            const savedFilterIds = new Set(savedFilters.map((f: any) => f.key?.serial || f.name));
            // Mark currently applied filters as picked
            quickPickItems.forEach((item: any) => {
                const filterId = item.filterData.key?.serial || item.filterData.name;

                item.picked = savedFilterIds.has(filterId);
            });

            const quickPick = vscode.window.createQuickPick();
            quickPick.title = "Select Filters for Test Theme Tree";
            quickPick.placeholder =
                savedFilters.length > 0
                    ? `${savedFilters.length} filter(s) currently applied. Choose filters to apply`
                    : "Choose one or more filters to apply";
            quickPick.items = quickPickItems;
            quickPick.canSelectMany = true;
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;
            quickPick.selectedItems = quickPickItems.filter((item: any) => item.picked);

            quickPick.onDidAccept(() => {
                const selectedFilters = quickPick.selectedItems.map((item: any) => item.filterData);
                logger.trace(
                    `[extension] Selected ${selectedFilters.length} filters:`,

                    selectedFilters.map((f: any) => f.name)
                );

                if (selectedFilters.length > 0) {
                    vscode.window.showInformationMessage(
                        `Selected ${selectedFilters.length} filter(s): ${selectedFilters.map((f: any) => f.name).join(", ")}`
                    );
                    treeViews?.testThemesTree?.applyFiltersAndRefresh(selectedFilters).catch((error) => {
                        logger.error(`[extension] Error applying test theme filters:`, error);

                        vscode.window.showErrorMessage(`Failed to apply filters: ${error.message}`);
                    });
                } else {
                    treeViews?.testThemesTree?.clearFiltersAndRefresh().catch((error) => {
                        logger.error(`[extension] Error clearing test theme filters:`, error);
                    });
                }

                quickPick.dispose();
            });
            quickPick.onDidHide(() => {
                quickPick.dispose();
            });
            quickPick.show();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.error(`[extension] Error when displaying filters: ${errorMessage}`, error);
            vscode.window.showErrorMessage(`Failed to display filters: ${errorMessage}`);
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
        { id: allExtensionCommands.displayFiltersForTestThemeTreeON, handler: handleDisplayFiltersForTestThemeTree },
        { id: allExtensionCommands.displayFiltersForTestThemeTreeOFF, handler: handleDisplayFiltersForTestThemeTree },
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
 * @param context - The extension context.
 * @returns The new connection.
 */
async function createNewConnection(
    activeConnection: connectionManager.TestBenchConnection,
    session: vscode.AuthenticationSession,
    currentConnection: PlayServerConnection | null,
    context: vscode.ExtensionContext
): Promise<PlayServerConnection> {
    if (currentConnection) {
        logger.warn(
            "[extension] A different connection was active. Logging out from previous server session before establishing new one."
        );
        await currentConnection.logoutUserOnServer();
    }

    const newConnection = new PlayServerConnection(
        activeConnection.serverName,
        activeConnection.portNumber,
        activeConnection.username,
        session.accessToken,
        context
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
        await connection.logoutUserOnServer();
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
        await connection.logoutUserOnServer();
    }

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
        getLoginWebViewProvider()?.resetEditMode();
        setIsHandlingLogout(false);
        const previousUserId = userSessionManager.getCurrentUserId();
        const newUserId = sessionToProcess.account.id;
        const wasNewSessionStarted = previousUserId !== newUserId;

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
        const newConnection = await createNewConnection(activeConnection, sessionToProcess, connection, context);
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
    logger.info("[extension] Activating extension.");
    initializeConfigurationWatcher();

    const handleAutomaticLogin = async () => {
        logger.trace(`[extension] Performing automatic login on activation.`);
        const config = getExtensionConfiguration();
        if (config.get(ConfigKeys.AUTO_LOGIN)) {
            try {
                authProviderInstance?.prepareForSilentAutoLogin();
                const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
                    createIfNone: true
                });

                if (session) {
                    await handleTestBenchSessionChange(context, session);
                }
            } catch (error) {
                // Errors are expected if auto-login fails silently
                logger.trace("[extension] Automatic login failed:", error);
            }
        }
    };

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
    logger.trace("[extension] TestBenchAuthenticationProvider registered.");

    // Session Change Listener
    context.subscriptions.push(
        vscode.authentication.onDidChangeSessions(async (e) => {
            if (e.provider.id === TESTBENCH_AUTH_PROVIDER_ID) {
                if (isHandlingSessionChange) {
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
            }
        })
    );

    userSessionManager = new UserSessionManager(context);

    // Initialize tree views
    await initializeTreeViews(context);

    // Set the initial connection context state
    await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, connection !== null);

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
    logger.trace("[extension] Checking if previous TestBench session should be restored...");
    try {
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            createIfNone: false,
            silent: true
        });
        if (session) {
            await handleTestBenchSessionChange(context, session);
            logger.debug("[extension] Successfully restored previous TestBench session.");
        } else {
            logger.debug("[extension] No previous TestBench session found for restoration.");
            if (!getExtensionConfiguration().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
                await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
                getLoginWebViewProvider()?.updateWebviewHTMLContent();
            }
        }
    } catch (error) {
        logger.warn("[extension] Error trying to get initial TestBench session silently:", error);
        await vscode.commands.executeCommand("setContext", ContextKeys.CONNECTION_ACTIVE, false);
    }

    if (getExtensionConfiguration().get<boolean>(ConfigKeys.AUTO_LOGIN, false)) {
        logger.debug("[extension] Auto-login is enabled. Scheduling automatic login.");
        handleAutomaticLogin();
    }

    logger.info("[extension] Extension activated successfully.");
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
                await connection.logoutUserOnServer();
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
