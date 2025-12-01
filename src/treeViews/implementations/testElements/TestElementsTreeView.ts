/**
 * @file src/treeViews/implementations/testElements/TestElementsTreeView.ts
 * @description Tree view implementation for managing test elements.
 */

import * as vscode from "vscode";
import { TreeViewBase, RefreshOptions } from "../../core/TreeViewBase";
import { TestElementData, TestElementItemData, TestElementsTreeItem, TestElementType } from "./TestElementsTreeItem";
import { TreeViewConfig } from "../../core/TreeViewConfig";
import { TestElementsDataProvider } from "./TestElementsDataProvider";
import { testElementsConfig } from "./TestElementsConfig";
import { PlayServerConnection } from "../../../testBenchConnection";
import { ResourceFileService } from "./ResourceFileService";
import { ContextKeys, TestElementItemTypes } from "../../../constants";
import { treeViews, userSessionManager } from "../../../extension";
import { ClickHandler } from "../../core/ClickHandler";
import {
    findKeywordPositionInResourceFile,
    isLanguageServerRunning,
    waitForLanguageServerReady,
    updateOrRestartLS
} from "../../../languageServer/server";
import { hasLsConfig } from "../../../languageServer/lsConfig";
import { getExtensionSetting } from "../../../configuration";
import { ConfigKeys } from "../../../constants";

/**
 * Local interface for configuring the generic resource handler.
 */
interface ResourceOperationConfig {
    operationType: "open" | "create" | "folder" | "keyword";
    createMissing: boolean;
    revealInExplorer: boolean;
    targetItem: TestElementsTreeItem;
    keywordItem?: TestElementsTreeItem;
    errorMessages: {
        noHierarchicalName: string;
        noPath: string;
        noParent: string;
        noUid: string;
        fileNotFound: string;
        folderNotFound: string;
    };
}

/**
 * When enabled, parent subdivision items are visually marked when any child subdivision
 * or keyword resource is created locally.
 */
const ENABLE_PARENT_MARKING = true;

export class TestElementsTreeView extends TreeViewBase<TestElementsTreeItem> {
    private dataProvider: TestElementsDataProvider;
    private disposables: vscode.Disposable[] = [];
    private currentTovKey: string | null = null;
    private currentTovLabel: string | null = null;
    private currentProjectName: string | null = null;
    private currentTovName: string | null = null;
    private resourceFiles: Map<string, string[]> = new Map();
    private resourceFileService: ResourceFileService;
    private keywordClickHandler: ClickHandler<TestElementsTreeItem>;
    private resourceFilesWatcher: vscode.FileSystemWatcher | undefined;
    private resourceAvailabilityRefreshDebounceHandle: NodeJS.Timeout | undefined;
    // Maps subdivision UID to alternative file path (when resource file is created with UID in filename to avoid name conflicts)
    private alternativeResourcePaths: Map<string, string> = new Map();
    private readonly ALTERNATIVE_RESOURCE_PATHS_STORAGE_KEY =
        "testbenchExtension.testElements.alternativeResourcePaths";
    private alternativeResourcePathsSaveTimeout: NodeJS.Timeout | null = null;

    constructor(
        extensionContext: vscode.ExtensionContext,
        private getConnection: () => PlayServerConnection | null,
        config?: Partial<TreeViewConfig>
    ) {
        const fullConfig = { ...testElementsConfig, ...config };
        super(extensionContext, fullConfig);

        this.dataProvider = new TestElementsDataProvider(this.logger, getConnection, this.eventBus);
        this.resourceFileService = new ResourceFileService(this.logger);
        this.keywordClickHandler = new ClickHandler<TestElementsTreeItem>();

        this.registerEventHandlers();
        this.setupKeywordClickHandlers();
        this.setupResourceFilesWatcher();
        this.loadAlternativeResourcePaths();
    }

    /**
     * Sets up click handlers for keyword items using the generalized click handler
     */
    private setupKeywordClickHandlers(): void {
        this.keywordClickHandler.updateHandlers({
            onSingleClick: async (item: TestElementsTreeItem) => {
                if (item.data.testElementType === TestElementType.Keyword) {
                    await this.handleKeywordSingleClick(item);
                }
            },
            onDoubleClick: async (item: TestElementsTreeItem) => {
                if (item.data.testElementType === TestElementType.Keyword) {
                    await this.handleKeywordDoubleClick(item);
                }
            }
        });
    }

    /**
     * Registers event handlers (listeners) for various tree view events.
     */
    private registerEventHandlers(): void {
        this.eventBus.on("testElements:fetched", (event) => {
            const { tovKey, count } = event.data;
            if (tovKey === this.currentTovKey) {
                this.logger.trace(
                    `[TestElementsTreeView] Received 'test elements fetched' event for TOV ${tovKey} with ${count} elements.`
                );
            }
        });

        this.eventBus.on("testElements:error", (event) => {
            const { tovKey, error } = event.data;
            if (tovKey === this.currentTovKey) {
                this.logger.error(
                    `[TestElementsTreeView] Received test elements error event for TOV ${tovKey}: ${error}`
                );
            }
        });

        this.eventBus.on("tov:loaded", async (event) => {
            const { tovKey, tovLabel } = event.data;
            if (tovKey && tovKey !== this.currentTovKey) {
                this.logger.debug(`[TestElementsTreeView] Received TOV loaded event for TOV ${tovKey}`);
                await this.loadTov(
                    tovKey,
                    tovLabel,
                    this.currentProjectName || undefined,
                    this.currentTovName || undefined
                );
            }
        });

        this.eventBus.on("connection:changed", async (event) => {
            const { connected } = event.data;
            if (connected && this.currentTovKey) {
                // Reload alternative paths in case a different user logged in
                this.alternativeResourcePaths.clear();
                await this.loadAlternativeResourcePaths();
                this.refresh();
            } else if (!connected) {
                this.clearTree();
            }
        });

        this.eventBus.on("testElement:updated", (event) => {
            const { item } = event.data;
            if (item) {
                this.refreshItemWithParents(item);
            }
        });

        this.eventBus.on("testElements:configurationChanged", () => {
            this.logger.debug("[TestElementsTreeView] Resource marker configuration changed, refreshing tree view");
            // Clear cache and refresh to apply new filtering
            if (this.currentTovKey) {
                this.dataProvider.clearCache(this.currentTovKey);
                this.refresh();
            }
        });

        // Check icons for newly expanded items to support lazy loading
        this.eventBus.on("tree:itemExpanded", async (event) => {
            const item = event.data.item;
            if (item instanceof TestElementsTreeItem && item.data.testElementType === TestElementType.Subdivision) {
                await this.updateSubdivisionIcons([item], false);
                this._onDidChangeTreeData.fire(item);
            }
        });
    }

    /**
     * Sets up a workspace watcher for .resource files and schedules a debounced
     * refresh to update tree item availability and icons.
     */
    private setupResourceFilesWatcher(): void {
        try {
            // Watch all .resource files in the workspace
            this.resourceFilesWatcher = vscode.workspace.createFileSystemWatcher("**/*.resource");

            const schedule = () => this.scheduleResourceAvailabilityRefresh();
            this.disposables.push(
                this.resourceFilesWatcher.onDidCreate(schedule),
                this.resourceFilesWatcher.onDidChange(schedule),
                this.resourceFilesWatcher.onDidDelete(schedule),
                this.resourceFilesWatcher
            );
        } catch (error) {
            this.logger.error("[TestElementsTreeView] Error setting up .resource files watcher:", error);
        }
    }

    /**
     * Debounces and schedules a refresh of resource availability state across the tree.
     */
    private scheduleResourceAvailabilityRefresh(): void {
        if (this.resourceAvailabilityRefreshDebounceHandle) {
            clearTimeout(this.resourceAvailabilityRefreshDebounceHandle);
        }
        this.resourceAvailabilityRefreshDebounceHandle = setTimeout(async () => {
            try {
                await this.refreshResourceAvailabilityFromWorkspace();
                await this.updateAllParentMarkings();
            } catch (error) {
                this.logger.error(
                    "[TestElementsTreeView] Error during debounced resource availability refresh:",
                    error
                );
            }
        }, 500);
    }

    /**
     * Updates parent marking flags for all subdivision items in the tree.
     * This is called after file system changes to ensure parent markings are accurate.
     */
    private async updateAllParentMarkings(): Promise<void> {
        if (!ENABLE_PARENT_MARKING || !this.rootItems || this.rootItems.length === 0) {
            return;
        }

        try {
            const subdivisionItems: TestElementsTreeItem[] = [];
            const collectSubdivisions = (currentItems: TestElementsTreeItem[]) => {
                for (const item of currentItems) {
                    if (item.data.testElementType === TestElementType.Subdivision) {
                        subdivisionItems.push(item);
                    }
                    if (item.children) {
                        collectSubdivisions(item.children as TestElementsTreeItem[]);
                    }
                }
            };
            collectSubdivisions(this.rootItems);

            // Update hasLocalChildren flag for each subdivision
            for (const item of subdivisionItems) {
                const hasLocalChildren = await this.hasAnyLocalChildResources(item);
                item.hasLocalChildren = hasLocalChildren;
            }
        } catch (error) {
            this.logger.error("[TestElementsTreeView] Error updating all parent markings:", error);
        }
    }

    /**
     * Recomputes resource availability for subdivision items and updates icons and keywords.
     */
    private async refreshResourceAvailabilityFromWorkspace(): Promise<void> {
        try {
            if (!this.rootItems || this.rootItems.length === 0) {
                return;
            }
            await this.updateSubdivisionIcons(this.rootItems, false);
            this._onDidChangeTreeData.fire(undefined);
        } catch (error) {
            this.logger.error("[TestElementsTreeView] Error refreshing resource availability from workspace:", error);
        }
    }

    /**
     * Refreshes a specific tree item and all of its parent items.
     * @param item The item to start the refresh from.
     */
    private refreshItemWithParents(item: TestElementsTreeItem): void {
        this._onDidChangeTreeData.fire(item);
        let parent = item.parent as TestElementsTreeItem | null;
        while (parent) {
            this._onDidChangeTreeData.fire(parent);
            parent = parent.parent as TestElementsTreeItem | null;
        }
    }

    /**
     * Handler for resource file related operations.
     * @param config The configuration object defining the operation to perform.
     */
    private async _handleResourceOperation(config: ResourceOperationConfig): Promise<void> {
        try {
            await this.ensureLanguageServerReady();

            const resourcePath = await this.resolveResourcePathForTreeItem(config.targetItem, config.errorMessages);
            if (!resourcePath) {
                return;
            }

            // Validate UID for resource file operation
            if (resourcePath.isResourceFile) {
                const uidValidation = await this.validateAndHandleUidConflict(
                    resourcePath.finalPath,
                    config.targetItem
                );
                if (!uidValidation.canProceed) {
                    return;
                }
                // Use the validated path (might be different if conflict was resolved)
                if (uidValidation.resolvedPath) {
                    resourcePath.finalPath = uidValidation.resolvedPath;
                }
            }

            const resourcePathExists = await this.resourceFileService.pathExists(resourcePath.finalPath);

            if (!resourcePathExists) {
                const createdResource = await this.handleMissingResource(
                    resourcePath,
                    config.targetItem,
                    config.createMissing,
                    config.errorMessages
                );
                if (!createdResource) {
                    return;
                }
            }

            await this.executeResourceOperation(
                config.operationType,
                resourcePath.finalPath,
                config.keywordItem,
                config.revealInExplorer
            );
        } catch (error) {
            this.handleResourceOperationError(config.operationType, error);
        }
    }

    /**
     * Detects name conflicts and renames of a resource file.
     * Validates UID and handles conflicts when a resource file exists with a different UID.
     * @param filePath The path to the resource file
     * @param targetItem The tree item representing the resource
     * @returns Object indicating whether to proceed and the resolved path (if different)
     */
    private async validateAndHandleUidConflict(
        filePath: string,
        targetItem: TestElementsTreeItem
    ): Promise<{ canProceed: boolean; resolvedPath?: string }> {
        const expectedUid: string = targetItem.data.uniqueID;
        if (!expectedUid) {
            this.logger.warn(
                `[TestElementsTreeView] Cannot validate UID conflict: item ${targetItem.label} has no UID`
            );
            return { canProceed: true };
        }

        // Check if there's a stored alternative path for this UID (created with UID in filename)
        const alternativeResourcePath: string | undefined = this.alternativeResourcePaths.get(expectedUid);
        if (alternativeResourcePath && (await this.resourceFileService.pathExists(alternativeResourcePath))) {
            const altValidation = await this.resourceFileService.validateResourceFileUid(
                alternativeResourcePath,
                expectedUid
            );
            if (altValidation.isValid) {
                this.logger.debug(
                    `[TestElementsTreeView] Found existing alternative path for UID ${expectedUid}: ${alternativeResourcePath}`
                );
                return { canProceed: true, resolvedPath: alternativeResourcePath };
            }
        }

        const validation = await this.resourceFileService.validateResourceFileUid(filePath, expectedUid);

        if (!validation.fileExists) {
            // Check for potential name conflicts with other subdivisions
            const conflictDetected: boolean = await this.detectNameConflict(filePath, expectedUid);
            if (conflictDetected) {
                this.logger.warn(
                    `[TestElementsTreeView] Name conflict detected: another subdivision with different UID maps to the same path: ${filePath}`
                );
                // TODO: suggest using UID in filename?
                return { canProceed: true };
            }
            return { canProceed: true };
        }

        // File exists but has no UID metadata
        if (!validation.fileUid) {
            const selectedPromptAction: string | undefined = await vscode.window.showWarningMessage(
                `Resource file exists at "${filePath}" but has no UID metadata. This might be an old file or was created manually.\n\n` +
                    `Expected UID: ${expectedUid}\n\n` +
                    `What would you like to do?`,
                { modal: true },
                "Overwrite with New Metadata",
                "Cancel"
            );

            if (selectedPromptAction === "Overwrite with New Metadata") {
                // Update the file with correct metadata
                const context: string = this.buildContextMetadata();
                try {
                    const existingContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                    const existingText = Buffer.from(existingContent).toString("utf-8");
                    // Preserve existing content but update metadata
                    const lines = existingText.split("\n");
                    const newLines = lines.filter((line) => !line.trim().startsWith("tb:uid:"));
                    const updatedContent = `tb:uid:${expectedUid}\n${context}${newLines.join("\n")}`;
                    await vscode.workspace.fs.writeFile(
                        vscode.Uri.file(filePath),
                        Buffer.from(updatedContent, "utf-8")
                    );
                    this.logger.info(`[TestElementsTreeView] Updated resource file metadata with UID: ${expectedUid}`);
                    return { canProceed: true };
                } catch (error) {
                    this.logger.error(`[TestElementsTreeView] Error updating file metadata:`, error);
                    vscode.window.showErrorMessage("Failed to update file metadata.");
                    return { canProceed: false };
                }
            }
            return { canProceed: false };
        }

        // File exists with different UID: conflict or rename detected
        if (validation.isMismatch) {
            const selectedPromptAction: string | undefined = await vscode.window.showWarningMessage(
                `Resource file conflict detected!\n\n` +
                    `File: ${filePath}\n` +
                    `File UID: ${validation.fileUid}\n` +
                    `Expected UID: ${expectedUid}\n\n` +
                    `This usually means:\n` +
                    `- The subdivision was renamed in TestBench, or\n` +
                    `- Multiple subdivisions have the same name (name conflict)\n\n` +
                    `What would you like to do?`,
                { modal: true },
                "Create with UID in Filename",
                "Open Existing File"
            );

            if (selectedPromptAction === "Create with UID in Filename") {
                const alternativeResourcePath: string = this.resourceFileService.constructAlternativePathWithUid(
                    filePath,
                    expectedUid
                );
                this.alternativeResourcePaths.set(expectedUid, alternativeResourcePath);
                this.debouncedSaveAlternativeResourcePaths();
                this.logger.info(
                    `[TestElementsTreeView] Creating resource file with UID in filename to avoid conflict: ${alternativeResourcePath}`
                );
                return { canProceed: true, resolvedPath: alternativeResourcePath };
            } else if (selectedPromptAction === "Open Existing File") {
                this.logger.info(
                    `[TestElementsTreeView] Opening existing file with different UID: ${validation.fileUid}`
                );
                return { canProceed: true };
            }
            return { canProceed: false };
        }

        // File exists with matching UID
        return { canProceed: true };
    }

    /**
     * Identifies name conflicts for resource files.
     * Detects if there are other subdivisions in the tree that would map to the same file path.
     * @param filePath The file path to check for conflicts
     * @param currentUid The UID of the current subdivision (to exclude from conflict check)
     * @returns True if a conflict is detected, false otherwise
     */
    private async detectNameConflict(filePath: string, currentUid: string): Promise<boolean> {
        if (!this.rootItems || this.rootItems.length === 0) {
            return false;
        }

        const allResourceSubdivisions: TestElementsTreeItem[] = [];
        const collectResourceSubdivisions = (items: TestElementsTreeItem[]): void => {
            for (const item of items) {
                if (
                    item.data.testElementType === TestElementType.Subdivision &&
                    item.data.displayName &&
                    ResourceFileService.hasResourceMarker(item.data.displayName) &&
                    item.data.uniqueID !== currentUid
                ) {
                    allResourceSubdivisions.push(item);
                }
                if (item.children) {
                    collectResourceSubdivisions(item.children as TestElementsTreeItem[]);
                }
            }
        };
        collectResourceSubdivisions(this.rootItems);

        // Check if any other subdivision would map to the same path
        for (const subdivision of allResourceSubdivisions) {
            if (!subdivision.data.hierarchicalName) {
                continue;
            }
            const cleanedResourceName: string = this.removeResourceMarkersFromHierarchicalName(
                subdivision.data.hierarchicalName
            ).trim();
            const otherResourceAbsolutePath: string | undefined =
                await this.resourceFileService.constructAbsolutePath(cleanedResourceName);
            if (otherResourceAbsolutePath && !otherResourceAbsolutePath.endsWith(".resource")) {
                const otherResourcePathWithExtension: string = `${otherResourceAbsolutePath}.resource`;
                if (otherResourcePathWithExtension === filePath) {
                    this.logger.warn(
                        `[TestElementsTreeView] Name conflict detected: subdivision "${subdivision.data.displayName}" (UID: ${subdivision.data.uniqueID}) maps to same path as current subdivision (UID: ${currentUid})`
                    );
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Ensures the language server is running and ready for resource operations.
     * @throws Error if language server configuration is missing
     */
    private async ensureLanguageServerReady(): Promise<void> {
        if (isLanguageServerRunning()) {
            return;
        }

        const cfgExists = await hasLsConfig();
        if (!cfgExists) {
            vscode.window.showWarningMessage(
                "Language server is not available because no project configuration was found (.testbench/ls.config.json). Create it first."
            );
            throw new Error("Language server configuration missing");
        }

        await updateOrRestartLS();
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Waiting for Language Server",
                cancellable: true
            },
            async (progress, cancellationToken) => {
                progress.report({ message: "Waiting for language server to be ready...", increment: 0 });
                await waitForLanguageServerReady(30000, 100, cancellationToken);
            }
        );
    }

    /**
     * Resolves and validates the resource path for a given tree item.
     * Checks for alternative paths (with UID in filename) first.
     * @param targetItem The tree item to resolve the path for
     * @param errorMessages Error messages to display if resolution fails
     * @returns Resolved resource path information or null if resolution fails
     */
    private async resolveResourcePathForTreeItem(
        targetItem: TestElementsTreeItem,
        errorMessages: ResourceOperationConfig["errorMessages"]
    ): Promise<{ finalPath: string; isResourceFile: boolean } | null> {
        const hierarchicalName = targetItem.data.hierarchicalName;
        if (!hierarchicalName) {
            vscode.window.showErrorMessage(errorMessages.noHierarchicalName);
            return null;
        }

        const isResourceFile = ResourceFileService.hasResourceMarker(hierarchicalName);

        // Check for alternative path first (if file was created with UID in filename)
        if (isResourceFile && targetItem.data.uniqueID) {
            const alternativePath = this.alternativeResourcePaths.get(targetItem.data.uniqueID);
            if (alternativePath && (await this.resourceFileService.pathExists(alternativePath))) {
                const validation = await this.resourceFileService.validateResourceFileUid(
                    alternativePath,
                    targetItem.data.uniqueID
                );
                if (validation.isValid) {
                    this.logger.debug(
                        `[TestElementsTreeView] Using alternative path for UID ${targetItem.data.uniqueID}: ${alternativePath}`
                    );
                    return { finalPath: alternativePath, isResourceFile: true };
                }
            }
        }

        const cleanName = this.removeResourceMarkersFromHierarchicalName(hierarchicalName).trim();
        const absolutePath = await this.resourceFileService.constructAbsolutePath(cleanName);
        if (!absolutePath) {
            vscode.window.showErrorMessage(errorMessages.noPath);
            return null;
        }

        const finalPath =
            isResourceFile && !absolutePath.endsWith(".resource") ? `${absolutePath}.resource` : absolutePath;

        return { finalPath, isResourceFile };
    }

    /**
     * Handles the creation of missing resources (files or folders).
     * @param resourcePath The resolved resource path information
     * @param targetItem The tree item representing the resource
     * @param createMissing Whether to create the missing resource
     * @param errorMessages Error messages to display
     * @returns True if the resource was created or creation was not needed, false otherwise
     */
    private async handleMissingResource(
        resourcePath: { finalPath: string; isResourceFile: boolean },
        targetItem: TestElementsTreeItem,
        createMissing: boolean,
        errorMessages: ResourceOperationConfig["errorMessages"]
    ): Promise<boolean> {
        if (!createMissing) {
            vscode.window.showWarningMessage(
                resourcePath.isResourceFile ? errorMessages.fileNotFound : errorMessages.folderNotFound
            );
            return false;
        }

        if (resourcePath.isResourceFile) {
            const created = await this.createResourceFile(resourcePath.finalPath, targetItem, errorMessages);
            if (!created) {
                return false;
            }
        } else {
            const created = await this.createResourceFolder(resourcePath.finalPath);
            if (!created) {
                return false;
            }
        }

        targetItem.updateLocalAvailability(true, resourcePath.finalPath);
        await this.updateParentIcons(targetItem);
        await this.markParentSubdivisions(targetItem);
        this.refreshItemWithParents(targetItem);

        return true;
    }

    /**
     * Creates a resource file with appropriate metadata.
     * @param filePath The path where the resource file should be created
     * @param targetItem The tree item representing the resource
     * @param errorMessages Error messages to display if creation fails
     * @returns True if the file was created successfully, false otherwise
     */
    private async createResourceFile(
        filePath: string,
        targetItem: TestElementsTreeItem,
        errorMessages: ResourceOperationConfig["errorMessages"]
    ): Promise<boolean> {
        const uid = targetItem.data.uniqueID;
        if (!uid) {
            vscode.window.showErrorMessage(errorMessages.noUid.replace("{label}", targetItem.label as string));
            return false;
        }

        const context = this.buildContextMetadata();
        const content = `tb:uid:${uid}\n${context}\n`;

        await this.resourceFileService.ensureFileExists(filePath, content);

        const uri = vscode.Uri.file(filePath);
        vscode.commands.executeCommand("testbench_ls.pullSubdivision", uri.toString(), uid, false);

        return true;
    }

    /**
     * Creates a resource folder.
     * @param folderPath The path where the folder should be created
     * @returns True if the folder was created successfully, false otherwise
     */
    private async createResourceFolder(folderPath: string): Promise<boolean> {
        try {
            await this.resourceFileService.ensureFolderPathExists(folderPath);
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to create folder: ${error instanceof Error ? error.message : "Unknown error"}`
            );
            return false;
        }
    }

    /**
     * Builds context metadata string for resource file content.
     * @returns Context metadata string or empty string if context is not available
     */
    private buildContextMetadata(): string {
        if (this.currentProjectName && this.currentTovName) {
            return `tb:context:${this.currentProjectName}/${this.currentTovName}\n`;
        }
        return "";
    }

    /**
     * Executes the requested resource operation (open file, jump to keyword, reveal in explorer).
     * @param operationType The type of operation to perform
     * @param resourcePath The path to the resource
     * @param keywordItem Optional keyword item for keyword jump operations
     * @param revealInExplorer Whether to reveal the resource in VS Code explorer
     */
    private async executeResourceOperation(
        operationType: ResourceOperationConfig["operationType"],
        resourcePath: string,
        keywordItem?: TestElementsTreeItem,
        revealInExplorer?: boolean
    ): Promise<void> {
        if (operationType === "keyword" && keywordItem) {
            await this.openFileAndJumpToKeyword(resourcePath, keywordItem.data.originalName, keywordItem.data.uniqueID);
        } else if (operationType !== "folder") {
            await this.openFileInVSCodeEditor(resourcePath);
        }

        if (revealInExplorer) {
            await this.revealFileInVSCodeExplorer(resourcePath);
        }
    }

    /**
     * Handles errors that occur during resource operations.
     * @param operationType The type of operation that failed
     * @param error The error that occurred
     */
    private handleResourceOperationError(operationType: string, error: unknown): void {
        this.logger.error(`[TestElementsTreeView] Error during resource operation '${operationType}':`, error);
        vscode.window.showErrorMessage(`Operation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    /**
     * Loads test elements data.
     *
     * @param tovKey - The unique identifier for the TOV to load.
     * @param tovLabel - Optional label for the TOV to display in the title.
     * @param projectName - The name of the project containing the TOV.
     * @param tovName - The name of the TOV.
     * @param preserveExistingData - Whether to preserve existing data during loading.
     * @returns Promise that resolves when the TOV data is loaded.
     */
    private async loadTovWithProgress(
        tovKey: string,
        tovLabel?: string,
        projectName?: string,
        tovName?: string
    ): Promise<void> {
        const startTime = Date.now();
        this.logger.debug(`[TestElementsTreeView] Loading Test Object Version '${tovName}'...`);

        try {
            this.stateManager.setLoading(true);
            (this as any).updateTreeViewMessage();

            const fetchedHierarchicalTestElements = await this.dataProvider.fetchTestElements(tovKey);
            const newRootItems = fetchedHierarchicalTestElements.map((element) => this._buildTreeItems(element));

            this.rootItems = newRootItems;
            this.currentTovKey = tovKey;
            this.currentTovLabel = tovLabel || null;
            this.currentProjectName = projectName || null;
            this.currentTovName = tovName || null;
            this.resourceFiles.clear();

            // Update title with format: Test Elements (Project Name, TOV Name)
            const titleParts = ["Test Elements"];
            if (projectName) {
                titleParts.push(projectName);
            }
            if (tovName) {
                titleParts.push(tovName);
            }

            if (titleParts.length > 1) {
                this.updateTitle(`${titleParts[0]} (${titleParts.slice(1).join(", ")})`);
            } else {
                this.updateTitle(titleParts[0]);
            }

            (this as any)._lastDataFetch = Date.now();
            (this as any)._intentionallyCleared = false;
            this.stateManager.setLoading(false);
            (this as any).updateTreeViewMessage();

            this._onDidChangeTreeData.fire(undefined);
            // Only check visible items initially
            await this.updateSubdivisionIcons(newRootItems, true);

            const loadTime = Date.now() - startTime;
            this.logger.debug(
                `[TestElementsTreeView] Successfully loaded ${newRootItems.length} test elements of Test Object Version '${tovName}'.`
            );

            this.eventBus.emit({
                type: "tov:loaded",
                source: this.config.id,
                data: {
                    tovKey,
                    tovLabel: this.currentTovLabel,
                    loadTime
                },
                timestamp: Date.now()
            });
        } catch (error) {
            this.logger.error(
                `[TestElementsTreeView] Error loading test elements of Test Object Version '${tovName}':`,
                error
            );
            this.stateManager.setLoading(false);
            this.stateManager.setError(error as Error);
            (this as any).updateTreeViewMessage();
            throw error;
        }
    }

    /**
     * Loads test elements for a specific TOV (Test Object Version).
     *
     * @param tovKey - The unique identifier for the TOV to load.
     * @param tovLabel - Optional label for the TOV to display in the title.
     * @param projectName - The name of the project containing the TOV.
     * @param tovName - The name of the TOV.
     * @param clearFirst - Whether to clear the tree before loading new data. Defaults to true.
     * @returns Promise that resolves when the TOV is loaded.
     */
    public async loadTov(
        tovKey: string,
        tovLabel?: string,
        projectName?: string,
        tovName?: string,
        clearFirst: boolean = true
    ): Promise<void> {
        try {
            // Load alternative resource paths if not already loaded and user session is available
            if (this.alternativeResourcePaths.size === 0 && userSessionManager.hasValidUserSession()) {
                await this.loadAlternativeResourcePaths();
            }

            this.logger.debug(
                `[TestElementsTreeView] Loading Test Element information for Test Object Version '${tovName}' from project '${projectName}'...`
            );
            this.stateManager.setLoading(true);

            if (clearFirst || this.currentTovKey !== tovKey) {
                // Preserve UI state (expansion, marking, etc.) during data reload
                this.clearTreeDataOnly();
                // Only clear cache when TOV actually changes
                this.dataProvider.clearCache(tovKey);
            }

            this.currentTovKey = tovKey;
            this.currentTovLabel = tovLabel || null;
            this.currentProjectName = projectName || null;
            this.currentTovName = tovName || null;
            this.resourceFiles.clear();

            // Update title with format: Test Elements (Project Name, TOV Name)
            const titleParts = ["Test Elements"];
            if (projectName) {
                titleParts.push(projectName);
            }
            if (tovName) {
                titleParts.push(tovName);
            }

            if (titleParts.length > 1) {
                this.updateTitle(`${titleParts[0]} (${titleParts.slice(1).join(", ")})`);
            } else {
                this.updateTitle(titleParts[0]);
            }

            const fetchedHierarchicalTestElements = await this.dataProvider.fetchTestElements(tovKey);

            this.rootItems = fetchedHierarchicalTestElements.map((element) => this._buildTreeItems(element));

            // Only check icons for visible/expanded items initially for better performance
            // Remaining items will be checked when expanded
            await this.updateSubdivisionIcons(this.rootItems, true);

            // Set the last data fetch timestamp to prevent infinite loading
            // This is important even for empty results to prevent the tree from continuously trying to load data
            (this as any)._lastDataFetch = Date.now();
            (this as any)._intentionallyCleared = false;
            this.stateManager.setLoading(false);
            this._onDidChangeTreeData.fire(undefined);
            (this as any).updateTreeViewMessage();

            this.eventBus.emit({
                type: "tov:loaded",
                source: this.config.id,
                data: {
                    tovKey,
                    tovLabel: this.currentTovLabel
                },
                timestamp: Date.now()
            });
            this.logger.info(
                `[TestElementsTreeView] Successfully loaded Test Element information for '${tovName}' from project '${projectName}'.`
            );
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Error loading TOV:`, error);

            this.rootItems = [];
            (this as any)._lastDataFetch = Date.now();
            (this as any)._intentionallyCleared = false;
            this.stateManager.setLoading(false);
            this._onDidChangeTreeData.fire(undefined);
            (this as any).updateTreeViewMessage();

            this.logger.error("[TestElementsTreeView] Failed to load test elements", error as Error);
            throw error;
        }
    }

    /**
     * Clears the tree view and resets all associated state.
     */
    public clearTree(): void {
        super.clearTree();
        this.currentTovKey = null;
        this.currentTovLabel = null;
        this.currentProjectName = null;
        this.currentTovName = null;
        this.resourceFiles.clear();
        // Note: We keep alternativeResourcePaths across tree clears to maintain
        // the mapping of UID -> alternative path for files created with UID in filename.
        // This ensures that when reopening a subdivision, we can find the correct file.
        // The mapping will be cleared when the extension is deactivated or workspace changes.
        this.resetTitle();
    }

    /**
     * Recursively builds tree items from hierarchical test element data.
     *
     * @param data - The test element data to build the tree item from
     * @param parent - Optional parent tree item
     * @returns The constructed tree item with its children
     */
    private _buildTreeItems(data: TestElementData, parent?: TestElementsTreeItem): TestElementsTreeItem {
        const item = this.createTreeItem(data, parent);
        if (data.children && data.children.length > 0) {
            const childItems = data.children.map((childData) => this._buildTreeItems(childData, item));
            item.children = childItems;
        }

        return item;
    }

    /**
     * Fetches and builds the root items for the test elements tree view.
     *
     * @returns Promise that resolves to an array of root tree items
     */
    protected async fetchRootItems(): Promise<TestElementsTreeItem[]> {
        if (!this.currentTovKey) {
            this.logger.debug("[TestElementsTreeView] TOV key not set, cannot fetch root items");
            return [];
        }

        if (this.rootItems.length > 0) {
            const dataIsFresh = Date.now() - (this as any)._lastDataFetch < 60000;
            if (dataIsFresh) {
                this.logger.debug(
                    `[TestElementsTreeView] Returning cached root items for TOV with key ${this.currentTovKey}`
                );
                return this.rootItems;
            }
        }

        try {
            const hierarchicalTestElementsData = await this.dataProvider.fetchTestElements(this.currentTovKey);
            const rootTestElementItems = hierarchicalTestElementsData.map((data) => this._buildTreeItems(data));

            this.rootItems = rootTestElementItems;
            (this as any)._lastDataFetch = Date.now();

            // Async icon updates for visible items only
            this.updateSubdivisionIcons(rootTestElementItems, true).then(() => {
                this._onDidChangeTreeData.fire(undefined);
            });

            return rootTestElementItems;
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Failed to fetch root tree items and build tree items:`, error);
            return [];
        }
    }

    /**
     * Updates all subdivision icons by checking for their existence on the local file system
     * @param items Array of tree items to process
     * @param onlyVisible If true, only checks visible/expanded items to save performance
     * @returns Promise that resolves when all icon updates are complete
     */
    private async updateSubdivisionIcons(items: TestElementsTreeItem[], onlyVisible: boolean = false): Promise<void> {
        // The python regex processing is done in language server via testbench_ls.get_resource_directory_subdivision_index command.
        // Language server initialization should be awaited here to prevent error logs caused by this command call.
        if (!isLanguageServerRunning()) {
            const cfgExists = await hasLsConfig();
            if (cfgExists) {
                try {
                    await updateOrRestartLS();
                    await waitForLanguageServerReady(5000, 100);
                } catch {
                    this.logger.trace("[TestElementsTreeView] LS not ready, proceeding with icon updates.");
                }
            } else {
                this.logger.trace("[TestElementsTreeView] No LS config present; proceeding with icon updates.");
            }
        }

        const subdivisionItems: TestElementsTreeItem[] = [];
        const collectSubdivisions = (currentItems: TestElementsTreeItem[], checkExpanded: boolean) => {
            for (const item of currentItems) {
                if (item.data.testElementType === TestElementType.Subdivision) {
                    if (!checkExpanded || item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                        subdivisionItems.push(item);
                    }
                }
                if (
                    item.children &&
                    (!checkExpanded || item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded)
                ) {
                    collectSubdivisions(item.children as TestElementsTreeItem[], checkExpanded);
                }
            }
        };
        collectSubdivisions(items, onlyVisible);

        // Process file checks in batches to yield to UI thread
        const BATCH_SIZE = 20;
        for (let i = 0; i < subdivisionItems.length; i += BATCH_SIZE) {
            const batch = subdivisionItems.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map(async (subdivisionItem) => {
                    try {
                        if (subdivisionItem.data.isVirtual) {
                            return;
                        }
                        const hierarchicalName = subdivisionItem.data.hierarchicalName;
                        if (hierarchicalName) {
                            const isResourceFile = ResourceFileService.hasResourceMarker(hierarchicalName);
                            const cleanName = this.removeResourceMarkersFromHierarchicalName(hierarchicalName).trim();
                            let resourcePath = await this.resourceFileService.constructAbsolutePath(cleanName);

                            if (resourcePath) {
                                if (isResourceFile && !resourcePath.endsWith(".resource")) {
                                    resourcePath += ".resource";
                                }

                                // Check for alternative path first (if file was created with UID in filename)
                                let finalResourcePath = resourcePath;
                                let isAvailable = false;

                                if (isResourceFile && subdivisionItem.data.uniqueID) {
                                    const alternativePath = this.alternativeResourcePaths.get(
                                        subdivisionItem.data.uniqueID
                                    );
                                    if (
                                        alternativePath &&
                                        (await this.resourceFileService.pathExists(alternativePath))
                                    ) {
                                        const altValidation = await this.resourceFileService.validateResourceFileUid(
                                            alternativePath,
                                            subdivisionItem.data.uniqueID
                                        );
                                        if (altValidation.isValid) {
                                            // Use alternative path
                                            finalResourcePath = alternativePath;
                                            isAvailable = true;
                                        }
                                    }
                                }

                                // If no alternative path found or not valid, check standard path
                                if (!isAvailable) {
                                    const resourcePathExists = await this.resourceFileService.pathExists(resourcePath);

                                    // For resource files, validate UID to ensure the file belongs to this subdivision
                                    isAvailable = resourcePathExists;
                                    if (isResourceFile && resourcePathExists && subdivisionItem.data.uniqueID) {
                                        const validation = await this.resourceFileService.validateResourceFileUid(
                                            resourcePath,
                                            subdivisionItem.data.uniqueID
                                        );
                                        // Only mark as available if UID matches (or file has no UID metadata yet)
                                        isAvailable = validation.isValid || !validation.fileUid;
                                        if (validation.isMismatch) {
                                            this.logger.warn(
                                                `[TestElementsTreeView] Resource file at ${resourcePath} has UID mismatch. ` +
                                                    `File UID: ${validation.fileUid}, Expected: ${subdivisionItem.data.uniqueID}. ` +
                                                    `This indicates a name conflict or rename.`
                                            );
                                        }
                                    }
                                }

                                subdivisionItem.updateLocalAvailability(isAvailable, finalResourcePath);

                                if (isAvailable) {
                                    await this.markParentSubdivisions(subdivisionItem);
                                }
                            }
                        }
                    } catch (error) {
                        this.logger.error(
                            `[TestElementsTreeView] Error updating subdivision icon for tree item ${subdivisionItem.label}:`,
                            error
                        );
                    }
                })
            );
            // Yield to UI thread between batches to keep UI responsive
            if (i + BATCH_SIZE < subdivisionItems.length) {
                await new Promise((resolve) => setImmediate(resolve));
            }
        }
    }

    /**
     * Checks if a subdivision item has any locally available child resources.
     * This recursively checks all descendants to see if any resource files exist.
     * @param item The subdivision item to check
     * @returns True if any child resources exist locally, false otherwise
     */
    private async hasAnyLocalChildResources(item: TestElementsTreeItem): Promise<boolean> {
        if (item.data.isLocallyAvailable) {
            return true;
        }

        if (item.children && item.children.length > 0) {
            for (const child of item.children as TestElementsTreeItem[]) {
                if (child.data.testElementType === TestElementType.Subdivision) {
                    const hasLocal = await this.hasAnyLocalChildResources(child);
                    if (hasLocal) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Marks parent subdivision items to indicate they have locally available child resources.
     * This is called when a resource is created to visually mark the parent hierarchy.
     * @param item The tree item whose parents should be marked
     */
    private async markParentSubdivisions(item: TestElementsTreeItem): Promise<void> {
        if (!ENABLE_PARENT_MARKING) {
            return;
        }

        try {
            let parent = item.parent as TestElementsTreeItem | null;
            while (parent) {
                if (parent.data.testElementType === TestElementType.Subdivision) {
                    parent.hasLocalChildren = true;
                    this.logger.trace(
                        `[TestElementsTreeView] Marked parent subdivision '${parent.label}' as having local children`
                    );
                }
                parent = parent.parent as TestElementsTreeItem | null;
            }
        } catch (error) {
            this.logger.error(
                `[TestElementsTreeView] Error marking parent subdivisions for item ${item.label}:`,
                error
            );
        }
    }

    /**
     * Unmarks parent subdivision items if they no longer have any locally available child resources.
     * This is called when a resource is deleted to update the parent hierarchy marking.
     * @param item The tree item whose parents should be checked and potentially unmarked
     */
    private async unmarkParentSubdivisionsIfNeeded(item: TestElementsTreeItem): Promise<void> {
        if (!ENABLE_PARENT_MARKING) {
            return;
        }

        try {
            let parent = item.parent as TestElementsTreeItem | null;
            while (parent) {
                if (parent.data.testElementType === TestElementType.Subdivision) {
                    // Check if this parent still has any local child resources
                    const hasLocalChildren = await this.hasAnyLocalChildResources(parent);
                    parent.hasLocalChildren = hasLocalChildren;

                    if (!hasLocalChildren) {
                        this.logger.trace(
                            `[TestElementsTreeView] Unmarked parent subdivision '${parent.label}' - no local children remaining`
                        );
                    }
                }
                parent = parent.parent as TestElementsTreeItem | null;
            }
        } catch (error) {
            this.logger.error(
                `[TestElementsTreeView] Error unmarking parent subdivisions for item ${item.label}:`,
                error
            );
        }
    }

    /**
     * Updates the icons of parent items in the tree hierarchy.
     * This is called when a resource file is created or opened to update parent tree item icons
     * to reflect their availability in tree view.
     * @param item The tree item whose parents should be updated
     * @returns Promise that resolves when all parent icon updates are complete
     */
    private async updateParentIcons(item: TestElementsTreeItem): Promise<boolean> {
        try {
            let parent = item.parent as TestElementsTreeItem | null;
            let updated = false;
            while (parent) {
                if (parent.data.isVirtual) {
                    parent = parent.parent as TestElementsTreeItem | null;
                    continue;
                }
                if (parent.data.testElementType === TestElementType.Subdivision) {
                    const hierarchicalName = parent.data.hierarchicalName;
                    const isResourceFile = hierarchicalName && ResourceFileService.hasResourceMarker(hierarchicalName);
                    if (hierarchicalName && isResourceFile) {
                        const cleanName = this.removeResourceMarkersFromHierarchicalName(hierarchicalName).trim();
                        let resourcePath = await this.resourceFileService.constructAbsolutePath(cleanName);
                        if (resourcePath) {
                            if (!resourcePath.endsWith(".resource")) {
                                resourcePath += ".resource";
                            }
                            const exists = await this.resourceFileService.pathExists(resourcePath);
                            parent.updateLocalAvailability(exists, resourcePath);
                            updated = true;
                        }
                    } else {
                        const parentHierarchicalName = parent.data.hierarchicalName || parent.data.displayName;
                        const cleanName = this.removeResourceMarkersFromHierarchicalName(parentHierarchicalName).trim();
                        const folderPath = await this.resourceFileService.constructAbsolutePath(cleanName);
                        if (folderPath) {
                            const exists = await this.resourceFileService.directoryExists(folderPath);
                            parent.updateLocalAvailability(exists, folderPath);
                            updated = true;
                        }
                    }
                }
                parent = parent.parent as TestElementsTreeItem | null;
            }
            this._onDidChangeTreeData.fire(undefined);
            return updated;
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Error updating parent icons for item ${item.label}:`, error);
            return false;
        }
    }

    /**
     * Retrieves the children for a given tree item.
     * @param item The tree item to get children for
     * @returns Promise resolving to an array of child tree items
     */
    protected async getChildrenForItem(item: TestElementsTreeItem): Promise<TestElementsTreeItem[]> {
        if (item.children && item.children.length > 0) {
            return item.children as TestElementsTreeItem[];
        }
        return [];
    }

    /**
     * Creates a new tree item from test element data.
     * @param data The test element data to create the item from
     * @param parent Optional parent tree item
     * @returns The created tree item
     */
    protected createTreeItem(data: TestElementData, parent?: TestElementsTreeItem): TestElementsTreeItem {
        const testElementType = data.testElementType;

        // Convert TestElementData to the extended TestElementItemData
        const itemData: TestElementItemData = {
            ...data,
            testElementType,
            tovKey: this.currentTovKey || undefined,
            resourceFiles: this.resourceFiles.get(data.id) || [],
            isLocallyAvailable: false,
            localPath: undefined
        };

        // Check if parent resource is locally available for keywords
        if (testElementType === TestElementType.Keyword && parent) {
            itemData.isLocallyAvailable = parent.data.isLocallyAvailable || false;
        }

        const item = new TestElementsTreeItem(itemData, this.extensionContext, parent, this.eventBus);
        item.updateId();
        this.applyModulesToTestElementsItem(item);

        return item;
    }

    /**
     * Converts a string literal test element type to its corresponding enum value.
     * @param type The string literal type to convert
     * @returns The corresponding TestElementType enum value
     */
    private convertToTestElementTypeEnum(type: string): TestElementType {
        switch (type) {
            case TestElementItemTypes.SUBDIVISION:
                return TestElementType.Subdivision;
            case TestElementItemTypes.KEYWORD:
                return TestElementType.Keyword;
            case TestElementItemTypes.DATA_TYPE:
                return TestElementType.DataType;
            case TestElementItemTypes.CONDITION:
                return TestElementType.Condition;
            case TestElementItemTypes.OTHER:
            default:
                return TestElementType.Other;
        }
    }

    /**
     * Applies modules to a test elements tree item.
     * @param item The test elements tree item to apply modules to
     */
    private applyModulesToTestElementsItem(item: TestElementsTreeItem): void {
        const expansionModule = this.getModule("expansion");
        if (expansionModule) {
            expansionModule.applyExpansionState(item);
        }

        const filterModule = this.getModule("filtering");
        if (filterModule && filterModule.isActive()) {
            // Filtering will be applied at the getChildren level
        }
    }

    /**
     * Gets the current TOV key.
     * @returns The current TOV key or null if not set
     */
    public getCurrentTovKey(): string | null {
        return this.currentTovKey;
    }

    /**
     * Gets the current project name.
     * @returns The current project name or null if not set
     */
    public getCurrentProjectName(): string | null {
        return this.currentProjectName;
    }

    /**
     * Gets the current TOV name.
     * @returns The current TOV name or null if not set
     */
    public getCurrentTovName(): string | null {
        return this.currentTovName;
    }

    /**
     * Returns the test elements provider.
     * @returns The tree data provider for test elements
     */
    public getTestElementsProvider(): vscode.TreeDataProvider<TestElementsTreeItem> {
        return this;
    }

    /**
     * Removes all occurrences of configured resource markers from a given hierarchical name.
     * @param hierarchicalName The hierarchical name to clean
     * @returns The cleaned hierarchical name with resource markers removed
     */
    private removeResourceMarkersFromHierarchicalName(hierarchicalName: string): string {
        const resourceMarkers = getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_RESOURCE_MARKER);
        if (!resourceMarkers || resourceMarkers.length === 0) {
            return hierarchicalName;
        }

        let cleanedName = hierarchicalName;
        for (const marker of resourceMarkers) {
            const escapedMarker = marker.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            const regex = new RegExp(escapedMarker, "g");
            cleanedName = cleanedName.replace(regex, "");
        }
        return cleanedName;
    }

    /**
     * Opens a file in VS Code editor.
     * @param filePath The path of the file to open
     */
    private async openFileInVSCodeEditor(filePath: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Error opening file in VS Code editor:`, error);
            vscode.window.showErrorMessage(
                `Error opening file: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Reveals a file in VS Code's explorer view.
     * @param filePath The path of the file to reveal
     */
    private async revealFileInVSCodeExplorer(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            await vscode.commands.executeCommand("revealInExplorer", uri);
            this.logger.debug(`[TestElementsTreeView] Revealing selected item in VS Code explorer: '${filePath}'`);
        } catch (error) {
            this.logger.warn(
                `[TestElementsTreeView] Failed to reveal file in VS Code explorer: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Opens a resource file in VS Code editor and positions cursor at a specific keyword.
     * @param resourcePath The path of the resource file
     * @param keywordName The name of the keyword to find and position cursor at
     * @param uid The unique identifier of the tree item
     */
    private async openFileAndJumpToKeyword(resourcePath: string, keywordName: string, uid: string): Promise<void> {
        let textDocument: vscode.TextDocument;
        let textEditor: vscode.TextEditor;

        this.logger.trace(
            `[TestElementsTreeView] openFileAndJumpToKeyword called: resourcePath=${resourcePath}, keywordName=${keywordName}, uid=${uid}`
        );

        try {
            textDocument = await vscode.workspace.openTextDocument(resourcePath);
            textEditor = await vscode.window.showTextDocument(textDocument);
            this.logger.debug(`[TestElementsTreeView] Successfully opened resource file: ${resourcePath}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            this.logger.error(
                `[TestElementsTreeView] Failed to open resource file at path ${resourcePath}: ${errorMessage}`,
                error
            );
            vscode.window.showErrorMessage(`Failed to open resource file at path ${resourcePath}: ${errorMessage}`);
            return;
        }
        try {
            const keywordLineNumber = await findKeywordPositionInResourceFile(textDocument.uri, keywordName, uid);
            if (keywordLineNumber !== undefined) {
                this.logger.trace(
                    `[TestElementsTreeView] Found keyword at line ${keywordLineNumber}, positioning cursor`
                );
                const position = new vscode.Position(keywordLineNumber, 0);
                textEditor.selection = new vscode.Selection(position, position);
                textEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            } else {
                this.logger.warn(
                    `[TestElementsTreeView] Keyword '${keywordName}' with UID ${uid} not found in resource file ${resourcePath}`
                );
            }
        } catch (positioningError) {
            const errorMessage = positioningError instanceof Error ? positioningError.message : "Unknown error";
            this.logger.warn(
                `[TestElementsTreeView] Failed to position cursor for keyword '${keywordName}' in resource file at path ${resourcePath}: ${errorMessage}`,
                positioningError
            );
        }
    }

    /**
     * Opens a resource file in VS Code's editor and reveals the opened file in the VS Code explorer view.
     * If the file doesn't exist, it will create the file first.
     * @param item The tree item representing a resource.
     */
    public async openAvailableResource(item: TestElementsTreeItem): Promise<void> {
        await this._handleResourceOperation({
            operationType: "open",
            createMissing: true,
            revealInExplorer: true,
            targetItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine resource path: item has no hierarchical name.",
                noPath: "Cannot construct resource path: workspace location not found.",
                noParent: "",
                noUid: "Subdivision {label} has no UID.",
                fileNotFound: "Resource file does not exist: {path}.",
                folderNotFound: ""
            }
        });
    }

    /**
     * Creates a missing resource file, opens it in VS Code editor and reveals it in the VS Code explorer view.
     * @param item The tree item representing a missing resource.
     */
    public async createMissingResource(item: TestElementsTreeItem): Promise<void> {
        await this._handleResourceOperation({
            operationType: "create",
            createMissing: true,
            revealInExplorer: true,
            targetItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine resource path: item has no hierarchical name.",
                noPath: "Cannot construct resource path: workspace location not found.",
                noParent: "",
                noUid: "Subdivision {label} has no UID.",
                fileNotFound: "",
                folderNotFound: ""
            }
        });
    }

    /**
     * Reveals a subdivision folder in VS Code's file explorer.
     * If the folder doesn't exist, it will create the folder first.
     * @param item The tree item representing a folder.
     */
    public async openFolderInExplorer(item: TestElementsTreeItem): Promise<void> {
        await this._handleResourceOperation({
            operationType: "folder",
            createMissing: true,
            revealInExplorer: true,
            targetItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine folder path: item has no hierarchical name.",
                noPath: "Cannot construct folder path: workspace location not found.",
                noParent: "",
                noUid: "",
                fileNotFound: "",
                folderNotFound: "Folder does not exist: {path}"
            }
        });
    }

    /**
     * Finds and opens the robot resource of an keyword and reveals the opened file in the VS Code explorer view.
     * Also jumps to the keyword position in the file.
     * If the parent resource file doesn't exist, it will create the file first.
     * @param item The tree item representing an keyword.
     */
    public async goToKeywordResource(item: TestElementsTreeItem): Promise<void> {
        const parentResource = item.parent as TestElementsTreeItem;
        if (!parentResource) {
            vscode.window.showErrorMessage(`Could not find the parent resource for keyword ${item.label}`);
            return;
        }

        await this._handleResourceOperation({
            operationType: "keyword",
            createMissing: true,
            revealInExplorer: true,
            targetItem: parentResource,
            keywordItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine resource path: parent has no hierarchical name.",
                noPath: "Cannot construct resource path: workspace location not found.",
                noParent: "Cannot find parent resource for keyword.",
                noUid: "Parent resource {label} has no UID.",
                fileNotFound: "Parent resource file does not exist: {path}.",
                folderNotFound: "Parent resource folder does not exist: {path}."
            }
        });
    }

    /**
     * Creates a missing parent resource for an keyword, opens it and
     * reveals the opened file in the VS Code explorer view.
     * @param item The keyword tree item
     */
    public async createMissingParentResourceForKeyword(item: TestElementsTreeItem): Promise<void> {
        const parentResource = item.parent as TestElementsTreeItem;
        if (!parentResource) {
            vscode.window.showErrorMessage(`Could not find the parent resource for keyword ${item.label}`);
            return;
        }

        await this._handleResourceOperation({
            operationType: "create",
            createMissing: true,
            revealInExplorer: true,
            targetItem: parentResource,
            keywordItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine resource path: parent has no hierarchical name.",
                noPath: "Cannot construct resource path: workspace location not found.",
                noParent: "Cannot find parent resource for keyword.",
                noUid: "Parent resource {label} has no UID.",
                fileNotFound: "Parent resource file does not exist: {path}.",
                folderNotFound: "Parent resource folder does not exist: {path}."
            }
        });
    }

    /**
     * Handles keyword single click events.
     * Opens the .resource file in the editor and jumps to the keyword only if it exists.
     * @param item The keyword tree item that was single clicked
     */
    private async handleKeywordSingleClick(item: TestElementsTreeItem): Promise<void> {
        this.logger.debug(
            `[TestElementsTreeView] handleKeywordSingleClick called for keyword: ${item.label}, type: ${item.data.testElementType}, uid: ${item.data.uniqueID}`
        );
        const parentResource = item.parent as TestElementsTreeItem;
        if (!parentResource) {
            this.logger.error(`[TestElementsTreeView] Could not find parent resource for keyword ${item.label}`);
            vscode.window.showErrorMessage(`Could not find the parent resource for keyword ${item.label}`);
            return;
        }
        await this._handleResourceOperation({
            operationType: "keyword",
            createMissing: false,
            revealInExplorer: false,
            targetItem: parentResource,
            keywordItem: item,
            errorMessages: {
                noHierarchicalName: "Cannot determine resource path: parent has no hierarchical name.",
                noPath: "Cannot construct resource path: workspace location not found.",
                noParent: "Cannot find parent resource for keyword.",
                noUid: "Parent resource {label} has no UID.",
                fileNotFound:
                    "Resource file does not exist. Use double-click or 'Create Resource' button to create it.",
                folderNotFound: "Parent resource folder does not exist: {path}."
            }
        });
    }

    /**
     * Handles keyword double click events.
     * Creates/opens the resource file, jumps to the keyword position, and reveals the file in explorer.
     * @param item The keyword tree item that was double clicked
     */
    private async handleKeywordDoubleClick(item: TestElementsTreeItem): Promise<void> {
        this.logger.debug(`[TestElementsTreeView] Keyword tree item double clicked: ${item.label}`);
        await this.goToKeywordResource(item);
    }

    /**
     * Handles keyword clicks from external commands
     * @param item The keyword item that was clicked
     */
    public async handleKeywordClick(item: TestElementsTreeItem): Promise<void> {
        this.logger.debug(
            `[TestElementsTreeView] handleKeywordClick called for item: ${item.label}, type: ${item.data.testElementType}, id: ${item.id}, uid: ${item.data.uniqueID}`
        );
        if (!item.id) {
            this.logger.warn(`[TestElementsTreeView] handleKeywordClick called for item without ID: ${item.label}`);
            return;
        }

        await this.keywordClickHandler.handleClick(item, item.id, this.logger);
    }

    /**
     * Loads persisted alternative resource paths from storage.
     * Validates that the files still exist before adding them to the map.
     */
    private async loadAlternativeResourcePaths(): Promise<void> {
        if (!userSessionManager.hasValidUserSession()) {
            this.logger.trace(
                "[TestElementsTreeView] No valid user session for loading alternative resource paths, skipping"
            );
            return;
        }

        try {
            const userId: string = userSessionManager.getCurrentUserId();
            const storageKey: string = `${this.ALTERNATIVE_RESOURCE_PATHS_STORAGE_KEY}.${userId}`;
            const storedData = this.extensionContext.workspaceState.get<Array<[string, string]>>(storageKey);

            if (!storedData || !Array.isArray(storedData)) {
                this.logger.trace("[TestElementsTreeView] No persisted alternative resource paths found");
                return;
            }

            // Validate and load paths that still exist
            let loadedAltResourcePathCount: number = 0;
            for (const [uid, path] of storedData) {
                if (await this.resourceFileService.pathExists(path)) {
                    // Validate UID matches the file
                    const validation = await this.resourceFileService.validateResourceFileUid(path, uid);
                    if (validation.isValid) {
                        this.alternativeResourcePaths.set(uid, path);
                        loadedAltResourcePathCount++;
                    } else {
                        this.logger.debug(
                            `[TestElementsTreeView] Skipping persisted alternative path for UID ${uid}: UID mismatch in file ${path}`
                        );
                    }
                } else {
                    this.logger.debug(
                        `[TestElementsTreeView] Skipping persisted alternative path for UID ${uid}: file no longer exists at ${path}`
                    );
                }
            }

            if (loadedAltResourcePathCount > 0) {
                this.logger.info(
                    `[TestElementsTreeView] Loaded ${loadedAltResourcePathCount} persisted alternative resource path(s) for user ${userId}`
                );
            } else {
                this.logger.trace("[TestElementsTreeView] No valid alternative resource paths found in storage");
            }
        } catch (error) {
            this.logger.error("[TestElementsTreeView] Error loading alternative resource paths:", error);
        }
    }

    /**
     * Saves alternative resource paths to storage with debouncing.
     * Debounce saves to avoid excessive writes when multiple updates occur in quick succession.
     */
    private debouncedSaveAlternativeResourcePaths(): void {
        if (this.alternativeResourcePathsSaveTimeout) {
            clearTimeout(this.alternativeResourcePathsSaveTimeout);
        }

        this.alternativeResourcePathsSaveTimeout = setTimeout(() => {
            this.saveAlternativeResourcePaths();
        }, 500);
    }

    /**
     * Saves alternative resource paths to workspace storage.
     * Uses user-specific storage keys to maintain separate mappings per user.
     */
    private async saveAlternativeResourcePaths(): Promise<void> {
        if (!userSessionManager.hasValidUserSession()) {
            this.logger.trace(
                "[TestElementsTreeView] No valid user session for saving alternative resource paths, skipping"
            );
            return;
        }

        try {
            const userId: string = userSessionManager.getCurrentUserId();
            const storageKey: string = `${this.ALTERNATIVE_RESOURCE_PATHS_STORAGE_KEY}.${userId}`;

            // Convert Map to array for storage
            const dataToSave = Array.from(this.alternativeResourcePaths.entries());

            await this.extensionContext.workspaceState.update(storageKey, dataToSave);
            this.logger.debug(
                `[TestElementsTreeView] Saved ${dataToSave.length} alternative resource path(s) for user ${userId}`
            );
        } catch (error) {
            this.logger.error("[TestElementsTreeView] Error saving alternative resource paths:", error);
        }
    }

    /**
     * Disposes of all resources and cleans up the tree view.
     */
    public async dispose(): Promise<void> {
        // Clear save timeout and force save before disposing
        if (this.alternativeResourcePathsSaveTimeout) {
            clearTimeout(this.alternativeResourcePathsSaveTimeout);
            this.alternativeResourcePathsSaveTimeout = null;
        }
        await this.saveAlternativeResourcePaths();

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];

        // Dispose of the data provider to clean up configuration listeners
        if (this.dataProvider) {
            this.dataProvider.dispose();
        }

        await super.dispose();
    }

    /**
     * Fetch data from the server and refresh tree view
     *
     * @param item Optional specific item to refresh
     * @param options Optional refresh options
     */
    public override refresh(item?: TestElementsTreeItem, options?: RefreshOptions): void {
        this.logger.debug(
            `[TestElementsTreeView] Refreshing test elements tree view${item ? ` for tree item: ${item.label}` : ""}`
        );

        if (item) {
            super.refresh(item, options);
            return;
        }

        // If skipDataReload is true (e.g., when filtering/searching), delegate to parent
        // to avoid fetching data from server and just update the UI
        if (options?.skipDataReload) {
            super.refresh(undefined, options);
            return;
        }

        if (this.currentTovKey) {
            this.dataProvider.clearCache(this.currentTovKey);

            this.loadTovWithProgress(
                this.currentTovKey,
                this.currentTovLabel || undefined,
                this.currentProjectName || undefined,
                this.currentTovName || undefined
            );
        } else {
            this.logger.trace("[TestElementsTreeView] No TOV key available while refreshing, clearing tree");
            this.clearTree();
        }
    }
}

export async function hideTestElementsTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    await vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_ELEMENTS_TREE, false);
}

export async function displayTestElementsTreeView(): Promise<void> {
    if (!treeViews) {
        return;
    }
    vscode.commands.executeCommand("setContext", ContextKeys.SHOW_TEST_ELEMENTS_TREE, true);
}
