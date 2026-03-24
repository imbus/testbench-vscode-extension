/**
 * @file src/extensionCommands.ts
 * @description Command handlers for the TestBench VS Code extension.
 * All extension commands are registered and organized here by logical groupings.
 */

import * as vscode from "vscode";
import { allExtensionCommands, ConfigKeys, folderNameOfInternalTestbenchFolder } from "./constants";
import { TESTBENCH_AUTH_PROVIDER_ID } from "./testBenchAuthenticationProvider";
import { TestBenchConnectionError } from "./testBenchConnection";
import { getExtensionConfiguration } from "./configuration";
import { TestThemesTreeItem } from "./treeViews/implementations/testThemes/TestThemesTreeItem";
import { MarkingModule } from "./treeViews/features/MarkingModule";
import { TestElementsTreeItem } from "./treeViews/implementations/testElements/TestElementsTreeItem";
import { ProjectsTreeItem } from "./treeViews/implementations/projects/ProjectsTreeItem";
import * as reportHandler from "./reportHandler";
import * as utils from "./utils";
import path from "path";
import { TreeViewBase } from "./treeViews/core/TreeViewBase";
import { TreeItemBase } from "./treeViews/core/TreeItemBase";
import { TextFilterOptions } from "./treeViews/features/FilteringModule";
import { updateOrRestartLS, prepareLanguageServerForTreeItemOperation } from "./languageServer/server";
import {
    hasLsConfig,
    writeLsConfig,
    readLsConfig,
    validateAndFixLsConfigInteractively,
    LanguageServerConfig,
    promptCreateLsConfigIfMissing
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
import * as testBenchLogger from "./testBenchLogger";
import {
    getLogger,
    connection,
    getConnection,
    treeViews,
    extensionContext,
    getAuthProvider,
    isTestOperationInProgress,
    setIsTestOperationInProgress,
    getIsHandlingSessionChange,
    setIsHandlingSessionChange,
    clearAllExtensionData,
    handleTestBenchSessionChange,
    handleNoSession
} from "./extension";

/* =============================================================================
   Utility Functions
   ============================================================================= */

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
            getLogger()?.warn("[extensionCommands] Attempted to start a test operation while another is in progress");
            vscode.window.showWarningMessage(
                "Another test operation is already in progress. Please wait for it to complete."
            );
            return;
        }
        setIsTestOperationInProgress(true);
        try {
            await handler(...args);
        } finally {
            setIsTestOperationInProgress(false);
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
            getLogger().error(`[extensionCommands] Command ${commandId} error: ${error.message}`, error);
            vscode.window.showErrorMessage(`Command ${commandId} failed: ${error.message}`);
        }
    });
    context.subscriptions.push(disposable);
}

/* =============================================================================
   Authentication Commands
   ============================================================================= */

const handleLogin = async () => {
    getLogger().trace(`[extensionCommands] Command called: ${allExtensionCommands.login}`);
    const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
        createIfNone: true
    });
    if (session) {
        await handleTestBenchSessionChange(extensionContext, session);
    }
};

const handleLogout = async () => {
    getLogger().trace(`[extensionCommands] Command called: ${allExtensionCommands.logout}.`);

    if (getIsHandlingSessionChange()) {
        return;
    }

    setIsHandlingSessionChange(true);
    try {
        const session = await vscode.authentication.getSession(TESTBENCH_AUTH_PROVIDER_ID, ["api_access"], {
            silent: true
        });

        const authProviderInstance = getAuthProvider();
        if (session && authProviderInstance) {
            await authProviderInstance.removeSession(session.id);
        }

        await handleNoSession();
    } finally {
        setIsHandlingSessionChange(false);
    }
};

/* =============================================================================
   Tree Navigation Commands
   ============================================================================= */

const handleCycleClick = async (cycleItem: ProjectsTreeItem) => {
    getLogger().trace(
        `[extensionCommands] Command called: ${allExtensionCommands.handleCycleClick} for item ${cycleItem.label}`
    );

    if (!connection) {
        getLogger().warn(
            `[extensionCommands] Command ${allExtensionCommands.handleCycleClick} called without active connection.`
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
    getLogger().trace(
        `[extensionCommands] Command called: ${allExtensionCommands.handleTOVClick} for item ${versionItem.label}`
    );

    if (!connection) {
        getLogger().warn(
            `[extensionCommands] Command ${allExtensionCommands.handleTOVClick} called without active connection.`
        );
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
        getLogger().error(`[extensionCommands] ${errorMessage}`);
        return;
    }

    // Prompt to create LS config if missing on TOV click
    await promptCreateLsConfigIfMissing(projectName, tovName);
};

const handleOpenTOV = async (tovItem: ProjectsTreeItem) => {
    if (!treeViews?.testThemesTree) {
        return;
    }

    if (!connection) {
        getLogger().warn(`[extensionCommands] handleOpenTOV called without active connection.`);
        vscode.window.showWarningMessage("No active connection available. Please log in first.");
        return;
    }

    const projectKey = tovItem.getProjectKey();
    const tovKey = tovItem.getVersionKey();
    const projectName = tovItem.parent?.label?.toString();
    const tovName = tovItem.label?.toString();

    if (projectKey && tovKey && projectName && tovName) {
        await treeViews.saveUIContext("testThemes", { isCycle: false, projectKey, tovKey, projectName, tovName });

        if (treeViews.testThemesTree) {
            treeViews.testThemesTree.prepareForContextSwitchLoading();
        }
        if (treeViews.testElementsTree) {
            treeViews.testElementsTree.prepareForContextSwitchLoading();
        }

        await displayTestThemeTreeView();
        await displayTestElementsTreeView();
        await hideProjectManagementTreeView();

        await promptCreateLsConfigIfMissing(projectName, tovName);
        const cfg = await readLsConfig();
        if (!cfg || !cfg.projectName || cfg.projectName.trim() === "" || cfg.tovName === undefined) {
            await validateAndFixLsConfigInteractively(cfg || undefined);
        }
        await treeViews.testThemesTree.loadTov(projectKey, tovKey, projectName, tovName);
        if (treeViews.testElementsTree) {
            await treeViews.testElementsTree.loadTov(tovKey, tovItem.label?.toString(), projectName, tovName);
        }
        getLogger().info(
            `[extensionCommands] Successfully opened Test Object Version '${tovName}' in project '${projectName}'.`
        );
    }
};

const handleOpenCycle = async (cycleItem: ProjectsTreeItem) => {
    if (!treeViews?.projectsTree) {
        return;
    }

    const openedCycleResult = await treeViews.projectsTree.openCycle(cycleItem);
    if (!openedCycleResult) {
        if (!getConnection()) {
            getLogger().warn(`[extensionCommands] handleOpenCycle called without active connection.`);
            vscode.window.showWarningMessage("No active connection available. Please log in first.");
            return;
        }
        throw new Error("Invalid cycle item: missing project, cycle, or version key");
    }

    await treeViews.saveUIContext("testThemes", {
        isCycle: true,
        projectKey: openedCycleResult.projectKey,
        cycleKey: openedCycleResult.cycleKey,
        tovKey: openedCycleResult.tovKey,
        projectName: openedCycleResult.projectName,
        tovName: openedCycleResult.tovName,
        cycleLabel: openedCycleResult.cycleLabel
    });

    await promptCreateLsConfigIfMissing(openedCycleResult.projectName, openedCycleResult.tovName);
    const cfg = await readLsConfig();
    if (!cfg || !cfg.projectName || cfg.projectName.trim() === "" || cfg.tovName === undefined) {
        await validateAndFixLsConfigInteractively(cfg || undefined);
    }

    getLogger().info(
        `[extensionCommands] Successfully opened Test Cycle '${openedCycleResult.cycleLabel}' for TOV '${openedCycleResult.tovName}' in project '${openedCycleResult.projectName}'.`
    );
};

/* =============================================================================
   Test Generation Commands
   ============================================================================= */

const _handleGenerateTestCasesForTOV = async (tovItem: ProjectsTreeItem) => {
    if (!tovItem) {
        getLogger().error(`[extensionCommands] _handleGenerateTestCasesForTOV called with undefined item`);
        vscode.window.showErrorMessage("Invalid item: Cannot generate test cases for undefined item");
        return;
    }

    if (!treeViews?.projectsTree) {
        getLogger().warn(`[extensionCommands] _handleGenerateTestCasesForTOV called before tree views are initialized`);
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
            getLogger().debug(
                `[extensionCommands] Test generation for TOV cancelled due to TestBench connection error: ${error.message}`
            );
            return;
        }
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("cancelled")) {
            getLogger().debug(`[extensionCommands] Language server wait operation was cancelled by user`);
            vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
        } else {
            getLogger().error(`[extensionCommands] Error in generateTestCasesForTOV: ${errorMessage}`, error);
            vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
        }
    }
};
const handleGenerateTestCasesForTOV = withSingleTestOperation(_handleGenerateTestCasesForTOV);

const _handleGenerateTestCasesForCycle = async (cycleItem: ProjectsTreeItem) => {
    if (!cycleItem) {
        getLogger().error(`[extensionCommands] _handleGenerateTestCasesForCycle called with undefined item`);
        vscode.window.showErrorMessage("Invalid item: Cannot generate test cases for undefined cycle item");
        return;
    }

    if (!connection) {
        getLogger().error(`[extensionCommands] _handleGenerateTestCasesForCycle called without active connection.`);
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
        await reportHandler.startTestGenerationForCycle(extensionContext, cycleItem);
    } catch (error) {
        if (error instanceof TestBenchConnectionError) {
            getLogger().debug(
                `[extensionCommands] Test generation for cycle cancelled due to TestBench connection error: ${error.message}`
            );
            return;
        }
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("cancelled")) {
            getLogger().debug(`[extensionCommands] Language server wait operation was cancelled by user`);
            vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
        } else {
            getLogger().error(`[extensionCommands] Error in generateTestCasesForCycle: ${errorMessage}`, error);
            vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
        }
    }
};
const handleGenerateTestCasesForCycle = withSingleTestOperation(_handleGenerateTestCasesForCycle);

const _handleGenerateTestCasesForTestThemeOrTestCaseSet = async (testThemeTreeItem: TestThemesTreeItem) => {
    if (!testThemeTreeItem) {
        getLogger().error(
            `[extensionCommands] _handleGenerateTestCasesForTestThemeOrTestCaseSet called with undefined item`
        );
        vscode.window.showErrorMessage("Invalid item: Cannot generate test cases for undefined test theme item");
        return;
    }

    if (!treeViews?.testThemesTree) {
        getLogger().warn(
            `[extensionCommands] _handleGenerateTestCasesForTestThemeOrTestCaseSet called before tree views are initialized`
        );
        vscode.window.showWarningMessage("Tree views are not ready. Please wait a moment and try again.");
        return;
    }

    try {
        await prepareLanguageServerForTreeItemOperation("generate test cases for test theme or test case set");
        await treeViews.testThemesTree.generateTestCases(testThemeTreeItem);
    } catch (error) {
        if (error instanceof TestBenchConnectionError) {
            getLogger().debug(
                `[extensionCommands] Test generation cancelled cancelled due to TestBench connection error: ${error.message}`
            );
            return;
        }
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("cancelled")) {
            getLogger().debug(`[extensionCommands] Language server wait operation was cancelled by user`);
            vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
        } else {
            getLogger().error(
                `[extensionCommands] Error in generateTestCasesForTestThemeOrTestCaseSet: ${errorMessage}`,
                error
            );
            vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
        }
    }
};
const handleGenerateTestCasesForTestThemeOrTestCaseSet = withSingleTestOperation(
    _handleGenerateTestCasesForTestThemeOrTestCaseSet
);

const _handleGenerateTestsForTestThemeTreeItemFromTOV = async (testThemeTreeItem: TestThemesTreeItem) => {
    if (!testThemeTreeItem) {
        getLogger().error(
            `[extensionCommands] _handleGenerateTestsForTestThemeTreeItemFromTOV called with undefined item`
        );
        vscode.window.showErrorMessage("Tree item is invalid, cannot generate test cases");
        return;
    }

    if (!treeViews?.testThemesTree) {
        getLogger().warn(
            `[extensionCommands] _handleGenerateTestsForTestThemeTreeItemFromTOV called before tree views are initialized`
        );
        vscode.window.showWarningMessage("Tree views are not ready. Please wait a moment and try again.");
        return;
    }

    try {
        await prepareLanguageServerForTreeItemOperation("generate test cases for test theme tree item");
        await treeViews.testThemesTree.generateTestCases(testThemeTreeItem);
    } catch (error) {
        if (error instanceof TestBenchConnectionError) {
            getLogger().debug(
                `[extensionCommands] Test generation for test theme tree item cancelled due to TestBench connection error: ${error.message}`
            );
            return;
        }
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("cancelled")) {
            getLogger().debug(`[extensionCommands] Language server wait operation was cancelled by user`);
            vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
        } else {
            getLogger().error(
                `[extensionCommands] Error in generateTestsForTestThemeTreeItemFromTOV: ${errorMessage}`,
                error
            );
            vscode.window.showErrorMessage(`Failed to generate test cases: ${errorMessage}`);
        }
    }
};
const handleGenerateTestsForTestThemeTreeItemFromTOV = withSingleTestOperation(
    _handleGenerateTestsForTestThemeTreeItemFromTOV
);

/* =============================================================================
   Test Result Import Commands
   ============================================================================= */

const _handleReadAndImportTestResultsToTestbench = async (testThemeTreeItem: TestThemesTreeItem) => {
    if (!testThemeTreeItem) {
        getLogger().error(`[extensionCommands] _handleReadAndImportTestResultsToTestbench called with undefined item`);
        vscode.window.showErrorMessage("Tree item is invalid, cannot import test results");
        return;
    }

    if (!treeViews?.testThemesTree) {
        getLogger().warn(
            `[extensionCommands] _handleReadAndImportTestResultsToTestbench called before tree views are initialized`
        );
        vscode.window.showWarningMessage("Tree views are not ready. Please wait a moment and try again.");
        return;
    }

    try {
        await prepareLanguageServerForTreeItemOperation("import test results");
        await treeViews.testThemesTree.importTestResultsForTestThemeTreeItem(testThemeTreeItem);
    } catch (error) {
        if (error instanceof TestBenchConnectionError) {
            getLogger().debug(
                `[extensionCommands] Test result import cancelled due to TestBench connection error: ${error.message}`
            );
            return;
        }
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        if (errorMessage.includes("cancelled")) {
            getLogger().debug(`[extensionCommands] Language server wait operation was cancelled by user`);
            vscode.window.showInformationMessage("Operation cancelled while waiting for language server.");
        } else {
            getLogger().error(
                `[extensionCommands] Error in readAndImportTestResultsToTestbench: ${errorMessage}`,
                error
            );
            vscode.window.showErrorMessage(`Failed to import test results: ${errorMessage}`);
        }
    }
};
const handleReadAndImportTestResultsToTestbench = withSingleTestOperation(_handleReadAndImportTestResultsToTestbench);

/* =============================================================================
   Tree View Management Commands
   ============================================================================= */

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

const handleRefreshProjectTreeView = () => {
    treeViews?.projectsTree.refresh();
};

const handleRefreshTestThemeTreeView = async () => {
    if (!treeViews?.testThemesTree) {
        return;
    }
    await treeViews.testThemesTree.refreshWithCacheClear();
};

const handleRefreshTestElementsTree = () => {
    treeViews?.testElementsTree.refresh();
};

const handleDisplayFiltersForTestThemeTree = async () => {
    if (!treeViews?.testThemesTree) {
        getLogger().warn("[extensionCommands] Test themes tree not available to display filters.");
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
                if (selection.some((item) => (item as FilterQuickPickItem).filterObject === "clear-filters-action")) {
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
                    getLogger().warn(
                        "[extensionCommands] Test themes tree became unavailable during filter selection."
                    );
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
        getLogger().error(`[extensionCommands] ${errorMessage}`);
        vscode.window.showErrorMessage(errorMessage);
    }
};

const handleEnableFilterDiffMode = async () => {
    if (treeViews?.testThemesTree) {
        await treeViews.testThemesTree.enableFilterDiffMode();
    } else {
        getLogger().warn("[extensionCommands] Test themes tree not available to enable filter diff mode.");
    }
};

const handleDisableFilterDiffMode = async () => {
    if (treeViews?.testThemesTree) {
        await treeViews.testThemesTree.disableFilterDiffMode();
    } else {
        getLogger().warn("[extensionCommands] Test themes tree not available to disable filter diff mode.");
    }
};

const handleResetProjectTreeViewRoot = () => {
    treeViews?.projectsTree.resetCustomRoot();
};

const handleResetTestThemeTreeViewRoot = () => {
    treeViews?.testThemesTree.resetCustomRoot();
};

const handleCheckForTestCaseSetDoubleClick = async (item: TestThemesTreeItem) => {
    if (treeViews?.testThemesTree && item.id) {
        await treeViews.testThemesTree.testCaseSetClickHandler.handleClick(item, item.id, getLogger());
    }
};

/* =============================================================================
   Test Elements/Resources Commands
   ============================================================================= */

const handleOpenAvailableResource = (item: TestElementsTreeItem) => {
    treeViews?.testElementsTree.openAvailableResource(item);
};

const handleCreateMissingResource = (item: TestElementsTreeItem) => {
    treeViews?.testElementsTree.createMissingResource(item);
};

const handleOpenFolderInExplorer = (item: TestElementsTreeItem) => {
    treeViews?.testElementsTree.openFolderInExplorer(item);
};

const handleGoToKeyword = (item: TestElementsTreeItem) => {
    treeViews?.testElementsTree.goToKeywordResource(item);
};

const handleCreateMissingParentResourceForKeyword = (item: TestElementsTreeItem) => {
    treeViews?.testElementsTree.createMissingParentResourceForKeyword(item);
};

const handleKeywordClick = (item: TestElementsTreeItem) => {
    treeViews?.testElementsTree.handleKeywordClick(item);
};

/* =============================================================================
   Robot File Commands
   ============================================================================= */

const handleOpenAndRevealGeneratedRobotFile = async (item: TestThemesTreeItem) => {
    if (!item) {
        getLogger().error(`[extensionCommands] handleOpenAndRevealGeneratedRobotFile called with undefined item`);
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

/* =============================================================================
   Search Commands
   ============================================================================= */

/**
 * Handles the search functionality for a given tree view.
 * Provides a live search within an input box,
 * and a button to configure search options.
 * @param treeView The tree view instance to perform the search on.
 */
const handleSearchInTreeView = async (treeView: TreeViewBase<TreeItemBase>): Promise<void> => {
    getLogger().trace(`[extensionCommands] Initiating search for tree view: ${treeView.config.id}`);
    const filteringModule = treeView.getModule("filtering");
    if (!filteringModule) {
        getLogger().warn(
            `[extensionCommands] Search cancelled: FilteringModule not found for tree view ${treeView.config.id}.`
        );
        vscode.window.showWarningMessage("Search functionality is not available for this view.");
        return;
    }

    const currentFilter = filteringModule.getTextFilter();
    getLogger().trace(`[extensionCommands] Current text filter: ${JSON.stringify(currentFilter)}`);
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
    // Note: VS Code adds this extra text after our prompt text by default:
    // (Press 'Enter' to confirm or 'Escape' to cancel)
    inputBox.prompt = "Enter search text. Clear input field to remove filter.";

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
                getLogger().trace("[extensionCommands] Search text is empty, clearing filter.");
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

        getLogger().trace(`[extensionCommands] Applying text filter: ${JSON.stringify(newFilterOptions)}`);
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

/* =============================================================================
   Configuration Commands
   ============================================================================= */

const handleSetActiveProject = async (item: ProjectsTreeItem) => {
    getLogger().trace(`[extensionCommands] Command called: ${allExtensionCommands.setActiveProject}`);
    if (!item) {
        getLogger().warn("[extensionCommands] 'Set as Active Project' called without an item.");
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
    getLogger().trace(`[extensionCommands] Command called: ${allExtensionCommands.setActiveTOV}`);
    if (!item) {
        getLogger().warn("[extensionCommands] 'Set as Active TOV' called without an item.");
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
    getLogger().trace(`[extensionCommands] Command called: ${allExtensionCommands.validateAndFixLsConfig}`);
    if (!(await hasLsConfig())) {
        vscode.window.showInformationMessage("No TestBench project configuration file found to validate.");
        return;
    }
    await validateAndFixLsConfigInteractively(undefined);
};

/* =============================================================================
   Utility Commands
   ============================================================================= */

const clearInternalFolder = async () => {
    getLogger().trace(`[extensionCommands] Command called: ${allExtensionCommands.clearInternalTestbenchFolder}`);
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

const handleUpdateOrRestartLS = () => {
    updateOrRestartLS();
};

const handleShowExtensionSettings = () => {
    vscode.commands.executeCommand("workbench.action.openSettings", "@ext:imbus.testbench");
};

const handleOpenIssueReporter = async () => {
    getLogger().trace(`[extensionCommands] Command called: ${allExtensionCommands.openIssueReporter}`);
    try {
        await vscode.commands.executeCommand("workbench.action.openIssueReporter", {
            extensionId: "imbus.testbench"
        });
        getLogger().trace(`[extensionCommands] Opened VS Code issue reporter with TestBench extension preselected`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        getLogger().error(`[extensionCommands] Error opening issue reporter: ${errorMessage}`, error);
        vscode.window.showErrorMessage(`Failed to open issue reporter: ${errorMessage}`);
    }
};

/* =============================================================================
   Command Registry and Registration
   ============================================================================= */

/**
 * Registers all extension commands.
 * Defines all commands handlers separately and associates them with the corresponding command IDs.
 *
 * @param {vscode.ExtensionContext} context The extension context.
 */
export async function registerExtensionCommands(context: vscode.ExtensionContext): Promise<void> {
    if (!treeViews) {
        getLogger().warn("[extensionCommands] Tree views not initialized. Skipping command registration.");
        return;
    }

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
            id: allExtensionCommands.openKeywordInTestElementsView,
            handler: handleGoToKeyword
        },
        {
            id: allExtensionCommands.createMissingParentResourceForKeyword,
            handler: handleCreateMissingParentResourceForKeyword
        },
        {
            id: allExtensionCommands.handleKeywordClick,
            handler: handleKeywordClick
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
