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
import { PlayServerConnection, PlayServerHttpError } from "../../../testBenchConnection";
import { ResourceFileService } from "./ResourceFileService";
import { ContextKeys, TestElementItemTypes } from "../../../constants";
import { treeViews } from "../../../extension";
import { ClickHandler } from "../../core/ClickHandler";
import {
    findKeywordPositionInResourceFile,
    ensureLanguageServerReady,
    isLanguageServerRunning,
    updateOrRestartLS,
    waitForLanguageServerReady
} from "../../../languageServer/server";
import { hasLsConfig } from "../../../languageServer/lsConfig";
import { getExtensionSetting } from "../../../configuration";
import { ConfigKeys } from "../../../constants";
import { v4 as uuidv4 } from "uuid";

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
    private currentProjectKey: string | null = null;
    private currentTovName: string | null = null;
    private resourceFiles: Map<string, string[]> = new Map();
    private resourceFileService: ResourceFileService;
    private keywordClickHandler: ClickHandler<TestElementsTreeItem>;
    private resourceFilesWatcher: vscode.FileSystemWatcher | undefined;
    private resourceAvailabilityRefreshDebounceHandle: NodeJS.Timeout | undefined;
    private deferredPostFetchAvailabilityHandle: NodeJS.Timeout | undefined;
    private postFetchAvailabilityRunId: number = 0;
    private testElementIndexByDataId: Map<string, TestElementsTreeItem[]> = new Map();
    private testElementIndexByTreeItemId: Map<string, TestElementsTreeItem> = new Map();

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
                await this.loadTov(tovKey, {
                    tovLabel,
                    projectName: this.currentProjectName || undefined,
                    tovName: this.currentTovName || undefined
                });
            }
        });

        this.eventBus.on("connection:changed", async (event) => {
            const { connected } = event.data;
            if (connected && this.currentTovKey) {
                this.refresh();
            } else if (!connected) {
                this.clearTree();
            }
        });

        this.eventBus.on("resourceFiles:updated", (event) => {
            const { elementId, files } = event.data || {};
            if (typeof elementId !== "string") {
                return;
            }

            const matchingItems = this.testElementIndexByDataId.get(elementId);
            if (!matchingItems || matchingItems.length === 0) {
                return;
            }

            const normalizedFiles = Array.isArray(files) ? files : [];
            matchingItems.forEach((item) => item.updateResourceFiles(normalizedFiles));
        });

        this.eventBus.on("resource:availabilityChanged", (event) => {
            const { elementId, isAvailable, localPath } = event.data || {};
            if (typeof elementId !== "string") {
                return;
            }

            const matchingItems = this.testElementIndexByDataId.get(elementId);
            if (!matchingItems || matchingItems.length === 0) {
                return;
            }

            matchingItems.forEach((item) => item.updateAvailability(Boolean(isAvailable), localPath));
        });

        this.eventBus.on("testElement:updated", (event) => {
            const { item, id } = event.data || {};
            if (item) {
                this.refreshItemWithParents(item);
                return;
            }

            if (typeof id === "string") {
                const indexedItem = this.testElementIndexByTreeItemId.get(id);
                if (indexedItem) {
                    this.refreshItemWithParents(indexedItem);
                }
            }
        });

        this.eventBus.on("testElements:configurationChanged", () => {
            this.logger.debug("[TestElementsTreeView] Resource marker configuration changed, refreshing tree view");
            this.resourceFileService.clearConstructedPathCache();
            // Clear filtered cache and refresh to apply new filtering
            if (this.currentTovKey) {
                this.refresh(undefined, { clearRawCache: false, immediate: true });
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
                this._onDidChangeTreeData.fire(undefined);
            } catch (error) {
                this.logger.error(
                    "[TestElementsTreeView] Error during debounced resource availability refresh:",
                    error
                );
            }
        }, 500);
    }

    /**
     * Cancels any pending or ongoing post-fetch availability work.
     */
    private cancelPostFetchAvailabilityWork(): void {
        this.postFetchAvailabilityRunId += 1;
        if (this.deferredPostFetchAvailabilityHandle) {
            clearTimeout(this.deferredPostFetchAvailabilityHandle);
            this.deferredPostFetchAvailabilityHandle = undefined;
        }
    }

    /**
     * Starts a new post-fetch availability run and returns its run id.
     */
    private beginPostFetchAvailabilityRun(): number {
        this.cancelPostFetchAvailabilityWork();
        return this.postFetchAvailabilityRunId;
    }

    /**
     * Determines whether the given post-fetch availability run is stale.
     */
    private isPostFetchAvailabilityRunCancelled(runId: number, rootItems: TestElementsTreeItem[]): boolean {
        return runId !== this.postFetchAvailabilityRunId || rootItems !== this.rootItems;
    }

    /**
     * Updates parent marking flags for all subdivision items in the tree.
     * This is called after file system changes to ensure parent markings are accurate.
     * Parents are only marked if all their child resources are locally available.
     */
    private async updateAllParentMarkings(): Promise<void> {
        if (!ENABLE_PARENT_MARKING || !this.rootItems || this.rootItems.length === 0) {
            return;
        }

        try {
            this.recomputeAllParentMarkingsBottomUp(this.rootItems);
        } catch (error) {
            this.logger.error("[TestElementsTreeView] Error updating all parent markings:", error);
        }
    }

    /**
     * Recomputes parent marking flags bottom-up (post-order) for the provided subtree roots.
     * @param rootItems The root items of the subtree to recompute markings for.
     */
    private recomputeAllParentMarkingsBottomUp(rootItems: TestElementsTreeItem[]): void {
        const postOrderStack: Array<{ item: TestElementsTreeItem; visited: boolean }> = [];

        for (const rootItem of rootItems) {
            if (rootItem.data.testElementType === TestElementType.Subdivision) {
                postOrderStack.push({ item: rootItem, visited: false });
            }
        }

        while (postOrderStack.length > 0) {
            const stackEntry = postOrderStack.pop();
            if (!stackEntry) {
                continue;
            }

            const { item, visited } = stackEntry;
            if (!visited) {
                // Re-add current node as visited so it is evaluated after its children.
                postOrderStack.push({ item, visited: true });

                const children = item.children as TestElementsTreeItem[] | undefined;
                if (children && children.length > 0) {
                    for (const child of children) {
                        if (child.data.testElementType === TestElementType.Subdivision) {
                            postOrderStack.push({ item: child, visited: false });
                        }
                    }
                }
                continue;
            }

            if (!item.data.directRegexMatch) {
                // Only folders/non-resource subdivisions derive marking from descendants.
                item.hasLocalChildren = this.computeAllChildResourcesAvailableFromCachedState(item);
            }
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
     * Ensure Language Server readiness for availability/icon checks.
     */
    private async ensureLanguageServerReadyForAvailabilityChecks(): Promise<void> {
        await ensureLanguageServerReady();
    }

    private isResourceSubdivision(item: TestElementsTreeItem): boolean {
        if (item.data.testElementType !== TestElementType.Subdivision || item.data.isVirtual) {
            return false;
        }
        const subdivisionName = item.data.displayName || item.data.originalName || "";
        return ResourceFileService.hasResourceMarker(subdivisionName);
    }

    private collectSubdivisionItems(
        items: TestElementsTreeItem[],
        options: {
            onlyVisible: boolean;
            filter?: (item: TestElementsTreeItem) => boolean;
        }
    ): TestElementsTreeItem[] {
        const subdivisionItems: TestElementsTreeItem[] = [];
        const { onlyVisible, filter } = options;

        const collect = (currentItems: TestElementsTreeItem[]) => {
            for (const item of currentItems) {
                const isExpanded = item.collapsibleState === vscode.TreeItemCollapsibleState.Expanded;
                const shouldRecurse = !onlyVisible || isExpanded;

                if (item.data.testElementType === TestElementType.Subdivision) {
                    const passesVisibility = !onlyVisible || isExpanded;
                    const passesFilter = filter ? filter(item) : true;
                    if (passesVisibility && passesFilter) {
                        subdivisionItems.push(item);
                    }
                }

                if (item.children && shouldRecurse) {
                    collect(item.children as TestElementsTreeItem[]);
                }
            }
        };
        collect(items);
        return subdivisionItems;
    }

    private async updateSubdivisionAvailability(
        subdivisionItems: TestElementsTreeItem[],
        options: {
            updateParentMarkingOnAvailableResource: boolean;
            cancelCheck?: () => boolean;
        }
    ): Promise<void> {
        if (options.cancelCheck?.()) {
            return;
        }

        await this.ensureLanguageServerReadyForAvailabilityChecks();

        if (options.cancelCheck?.()) {
            return;
        }

        // Process file checks in batches to yield to UI thread
        const BATCH_SIZE = 20;
        for (let i = 0; i < subdivisionItems.length; i += BATCH_SIZE) {
            if (options.cancelCheck?.()) {
                return;
            }

            const batch = subdivisionItems.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map(async (subdivisionItem) => {
                    if (options.cancelCheck?.()) {
                        return;
                    }

                    try {
                        if (subdivisionItem.data.isVirtual) {
                            return;
                        }

                        const hierarchicalName = subdivisionItem.data.hierarchicalName;
                        if (!hierarchicalName) {
                            return;
                        }

                        const isResourceFile = this.isResourceSubdivision(subdivisionItem);
                        if (!isResourceFile) {
                            subdivisionItem.updateLocalAvailability(false, undefined);
                            return;
                        }

                        const cleanName = this.removeResourceMarkersFromHierarchicalName(hierarchicalName).trim();
                        let resourcePath = await this.resourceFileService.constructAbsolutePath(cleanName);

                        if (!resourcePath) {
                            return;
                        }

                        if (isResourceFile && !resourcePath.endsWith(".resource")) {
                            resourcePath += ".resource";
                        }

                        const exists = await this.resourceFileService.pathExists(resourcePath);
                        subdivisionItem.updateLocalAvailability(exists, resourcePath);

                        if (options.updateParentMarkingOnAvailableResource && exists && isResourceFile) {
                            await this.updateParentSubdivisionMarking(subdivisionItem);
                        }
                    } catch (error) {
                        this.logger.error(
                            `[TestElementsTreeView] Error updating subdivision availability for tree item ${subdivisionItem.label}:`,
                            error
                        );
                    }
                })
            );

            if (i + BATCH_SIZE < subdivisionItems.length) {
                await new Promise((resolve) => setImmediate(resolve));
            }
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

        const cleanName = this.removeResourceMarkersFromHierarchicalName(hierarchicalName).trim();
        const absolutePath = await this.resourceFileService.constructAbsolutePath(cleanName);
        if (!absolutePath) {
            vscode.window.showErrorMessage(errorMessages.noPath);
            return null;
        }

        const isResourceFile = ResourceFileService.hasResourceMarker(hierarchicalName);
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
            const message = resourcePath.isResourceFile ? errorMessages.fileNotFound : errorMessages.folderNotFound;
            if (message) {
                if (resourcePath.isResourceFile) {
                    vscode.window.showInformationMessage(message);
                } else {
                    vscode.window.showWarningMessage(message);
                }
            }
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
        await this.updateParentSubdivisionMarking(targetItem);
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
     * Returns the configured Resource Directory Path label for user-facing messages.
     */
    private getResourceDirectoryPathLabel(): string {
        const configuredPath = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_DIR)?.trim();
        return configuredPath && configuredPath.length > 0 ? configuredPath : "workspace";
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
     * Updates the Test Elements view title based on the current project/TOV context.
     *
     * @param projectName Optional project name to include in the title.
     * @param tovName Optional Test Object Version name to include in the title.
     * @returns {void}
     */
    private updateTitleForContext(projectName?: string, tovName?: string): void {
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
    }

    /**
     * Loads test elements for a specific Test Object Version (TOV), updates the tree state,
     * and triggers deferred availability/icon updates.
     *
     * @param tovKey The unique identifier of the TOV to load.
     * @param options Optional loading options.
     * @param options.tovLabel Optional label used for event payload/context display.
     * @param options.projectName Optional project name associated with the TOV.
     * @param options.tovName Optional TOV name for title/context metadata.
     * @param options.clearFirst Whether to clear and prepare loading state before fetching. Defaults to true.
     * @param options.projectKey Optional project key stored as current context.
     * @param options.includeLoadTimeInEvent Whether to include load duration in emitted `tov:loaded` event data.
     * @returns A promise that resolves when structural loading and event emission complete.
     */
    public async loadTov(
        tovKey: string,
        options?: {
            tovLabel?: string;
            projectName?: string;
            tovName?: string;
            clearFirst?: boolean;
            projectKey?: string;
            includeLoadTimeInEvent?: boolean;
        }
    ): Promise<void> {
        const {
            tovLabel,
            projectName,
            tovName,
            clearFirst = true,
            projectKey,
            includeLoadTimeInEvent = false
        } = options ?? {};

        const startTime = includeLoadTimeInEvent ? Date.now() : 0;

        this.logger.debug(
            `[TestElementsTreeView] Loading Test Element information for Test Object Version '${tovName}' from project '${projectName}'...`
        );

        this.cancelPostFetchAvailabilityWork();

        try {
            const isContextSwitch = this.currentTovKey !== tovKey;
            if (clearFirst || isContextSwitch) {
                this.prepareForContextSwitchLoading();
                this.dataProvider.clearCache(tovKey);
                this.resourceFileService.clearConstructedPathCache();
            } else {
                this.stateManager.setError(null);
                this.stateManager.setLoading(true);
                (this as any).updateTreeViewMessage();
            }

            this.currentTovKey = tovKey;
            this.currentTovLabel = tovLabel || null;
            this.currentProjectName = projectName || null;
            this.currentProjectKey = projectKey ?? this.currentProjectKey;
            this.currentTovName = tovName || null;
            this.resourceFiles.clear();
            this.updateTitleForContext(projectName, tovName);

            const fetchedHierarchicalTestElements = await this.dataProvider.fetchTestElements(tovKey);
            const newRootItems = fetchedHierarchicalTestElements.map((element) => this._buildTreeItems(element));

            this.rootItems = newRootItems;
            (this as any)._lastDataFetch = Date.now();
            (this as any)._intentionallyCleared = false;
            this.stateManager.setLoading(false);
            (this as any).updateTreeViewMessage();

            this._onDidChangeTreeData.fire(undefined);
            void this.runPostFetchAvailabilityUpdates(newRootItems);

            const eventData: { tovKey: string; tovLabel: string | null; loadTime?: number } = {
                tovKey,
                tovLabel: this.currentTovLabel
            };
            if (includeLoadTimeInEvent) {
                eventData.loadTime = Date.now() - startTime;
            }

            this.eventBus.emit({
                type: "tov:loaded",
                source: this.config.id,
                data: eventData,
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
        this.cancelPostFetchAvailabilityWork();
        super.clearTree();
        this.resourceFileService.clearConstructedPathCache();
        this.testElementIndexByDataId.clear();
        this.testElementIndexByTreeItemId.clear();
        this.currentTovKey = null;
        this.currentTovLabel = null;
        this.currentProjectName = null;
        this.currentProjectKey = null;
        this.currentTovName = null;
        this.resourceFiles.clear();
        this.resetTitle();
    }

    /**
     * Gets the current project key.
     * @returns The current project key or null if not set
     */
    public getCurrentProjectKey(): string | null {
        return this.currentProjectKey;
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
                if (this.testElementIndexByDataId.size === 0) {
                    this.rebuildTestElementIndex(this.rootItems);
                }
                return this.rootItems;
            }
        }

        try {
            const hierarchicalTestElementsData = await this.dataProvider.fetchTestElements(this.currentTovKey);
            const rootTestElementItems = hierarchicalTestElementsData.map((data) => this._buildTreeItems(data));
            this.rebuildTestElementIndex(rootTestElementItems);

            this.rootItems = rootTestElementItems;
            (this as any)._lastDataFetch = Date.now();

            // Run availability/icon updates in the background
            void this.runPostFetchAvailabilityUpdates(rootTestElementItems);

            return rootTestElementItems;
        } catch (error) {
            this.logger.error(`[TestElementsTreeView] Failed to fetch root tree items and build tree items:`, error);
            return [];
        }
    }

    /**
     * Post-fetch availability updates:
     * - fast pass for visible/expanded subdivisions
     * - deferred background pass for remaining resource subdivisions
     * - cancellation checks prevent stale runs from updating current context
     */
    private async runPostFetchAvailabilityUpdates(rootItems: TestElementsTreeItem[]): Promise<void> {
        const runId = this.beginPostFetchAvailabilityRun();

        try {
            const visibleSubdivisionItems = this.collectSubdivisionItems(rootItems, { onlyVisible: true });
            await this.updateSubdivisionAvailability(visibleSubdivisionItems, {
                updateParentMarkingOnAvailableResource: false,
                cancelCheck: () => this.isPostFetchAvailabilityRunCancelled(runId, rootItems)
            });

            if (this.isPostFetchAvailabilityRunCancelled(runId, rootItems)) {
                return;
            }

            await this.updateAllParentMarkings();

            if (this.isPostFetchAvailabilityRunCancelled(runId, rootItems)) {
                return;
            }

            this._onDidChangeTreeData.fire(undefined);

            const deferredSubdivisionItems = this.collectDeferredResourceSubdivisionItems(
                rootItems,
                visibleSubdivisionItems
            );

            if (deferredSubdivisionItems.length === 0) {
                return;
            }

            this.deferredPostFetchAvailabilityHandle = setTimeout(() => {
                void this.runDeferredPostFetchAvailabilityUpdates(runId, rootItems, deferredSubdivisionItems);
            }, 0);
        } catch (error) {
            this.logger.error("[TestElementsTreeView] Error during post-fetch availability updates:", error);
        }
    }

    /**
     * Runs deferred background availability updates for non-visible resource subdivisions.
     */
    private async runDeferredPostFetchAvailabilityUpdates(
        runId: number,
        rootItems: TestElementsTreeItem[],
        deferredSubdivisionItems: TestElementsTreeItem[]
    ): Promise<void> {
        this.deferredPostFetchAvailabilityHandle = undefined;

        if (this.isPostFetchAvailabilityRunCancelled(runId, rootItems)) {
            return;
        }

        try {
            await this.updateSubdivisionAvailability(deferredSubdivisionItems, {
                updateParentMarkingOnAvailableResource: false,
                cancelCheck: () => this.isPostFetchAvailabilityRunCancelled(runId, rootItems)
            });

            if (this.isPostFetchAvailabilityRunCancelled(runId, rootItems)) {
                return;
            }

            await this.updateAllParentMarkings();

            if (this.isPostFetchAvailabilityRunCancelled(runId, rootItems)) {
                return;
            }

            this._onDidChangeTreeData.fire(undefined);
        } catch (error) {
            if (!this.isPostFetchAvailabilityRunCancelled(runId, rootItems)) {
                this.logger.error(
                    "[TestElementsTreeView] Error during deferred post-fetch availability updates:",
                    error
                );
            }
        }
    }

    /**
     * Collects resource subdivision targets for deferred post-fetch availability checks.
     * Excludes items already processed in the fast pass.
     */
    private collectDeferredResourceSubdivisionItems(
        items: TestElementsTreeItem[],
        alreadyProcessedItems: TestElementsTreeItem[]
    ): TestElementsTreeItem[] {
        const processedIds = new Set(alreadyProcessedItems.map((item) => item.data.id));
        const resourceSubdivisionItems = this.collectSubdivisionItems(items, {
            onlyVisible: false,
            filter: (item) => this.isResourceSubdivision(item)
        });

        return resourceSubdivisionItems.filter((item) => !processedIds.has(item.data.id));
    }

    /**
     * Rebuilds the lookup index used for centralized EventBus dispatch.
     * @param rootItems The root items of the tree to index
     */
    private rebuildTestElementIndex(rootItems: TestElementsTreeItem[]): void {
        this.testElementIndexByDataId.clear();
        this.testElementIndexByTreeItemId.clear();

        /**
         * Recursively indexes tree items by their data ID and tree item ID.
         * @param treeItems The tree items to index
         */
        const indexTestElements = (treeItems: TestElementsTreeItem[]) => {
            for (const item of treeItems) {
                const existingItems = this.testElementIndexByDataId.get(item.data.id);
                if (existingItems) {
                    existingItems.push(item);
                } else {
                    this.testElementIndexByDataId.set(item.data.id, [item]);
                }

                if (item.id) {
                    this.testElementIndexByTreeItemId.set(item.id, item);
                }

                if (item.children && item.children.length > 0) {
                    indexTestElements(item.children as TestElementsTreeItem[]);
                }
            }
        };

        indexTestElements(rootItems);
    }

    /**
     * Updates all subdivision icons by checking for their existence on the local file system
     * @param items Array of tree items to process
     * @param onlyVisible If true, only checks visible/expanded items to save performance
     * @returns Promise that resolves when all icon updates are complete
     */
    private async updateSubdivisionIcons(items: TestElementsTreeItem[], onlyVisible: boolean = false): Promise<void> {
        const subdivisionItems = this.collectSubdivisionItems(items, { onlyVisible });
        await this.updateSubdivisionAvailability(subdivisionItems, {
            updateParentMarkingOnAvailableResource: true
        });
    }

    /**
     * Computes whether all descendant resource subdivisions are available using cached child states.
     * Returns true when there are no descendant resource subdivisions.
     */
    private computeAllChildResourcesAvailableFromCachedState(parentSubdivision: TestElementsTreeItem): boolean {
        const childSubdivisions = parentSubdivision.children as TestElementsTreeItem[] | undefined;
        if (!childSubdivisions || childSubdivisions.length === 0) {
            return true;
        }

        for (const childSubdivision of childSubdivisions) {
            if (childSubdivision.data.testElementType !== TestElementType.Subdivision) {
                continue;
            }

            // Direct resource subdivision: its own availability decides the branch.
            if (childSubdivision.data.directRegexMatch) {
                if (!childSubdivision.data.isLocallyAvailable) {
                    return false;
                }
                continue;
            }

            // Pure structural folder without resource descendants does not affect marking.
            if (!childSubdivision.data.hasResourceDescendant) {
                continue;
            }

            // Folder with resource descendants must already be marked as locally complete.
            if (!childSubdivision.hasLocalChildren) {
                return false;
            }
        }

        return true;
    }

    /**
     * Updates parent subdivision marking based on whether all child resources are locally available.
     * Parents are only marked when ALL their descendant resources are available.
     * This is called when a resource is created or deleted to update the parent hierarchy.
     * @param item The tree item whose parents should be checked and updated
     */
    private async updateParentSubdivisionMarking(item: TestElementsTreeItem): Promise<void> {
        if (!ENABLE_PARENT_MARKING) {
            return;
        }

        try {
            let parent = item.parent as TestElementsTreeItem | null;
            while (parent) {
                if (parent.data.testElementType === TestElementType.Subdivision) {
                    const allChildrenAvailable = this.computeAllChildResourcesAvailableFromCachedState(parent);
                    const previousHasLocalChildren = parent.hasLocalChildren;
                    parent.hasLocalChildren = allChildrenAvailable;
                    this.logger.trace(
                        `[TestElementsTreeView] Parent '${parent.label}' marking updated: ${allChildrenAvailable}`
                    );

                    // Stop climbing when state no longer changes, higher ancestors remain unaffected.
                    if (previousHasLocalChildren === allChildrenAvailable) {
                        break;
                    }
                }
                parent = parent.parent as TestElementsTreeItem | null;
            }
        } catch (error) {
            this.logger.error(
                `[TestElementsTreeView] Error updating parent subdivision marking for item ${item.label}:`,
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
                    const isResourceFile = this.isResourceSubdivision(parent);
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
                        parent.updateLocalAvailability(false, undefined);
                        updated = true;
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
        if (this.shouldIgnoreNonResourceKeywordAction(item, "goToKeywordResource")) {
            return;
        }

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
        if (this.shouldIgnoreNonResourceKeywordAction(item, "createMissingParentResourceForKeyword")) {
            return;
        }

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
        const resourceDirectoryPath = this.getResourceDirectoryPathLabel();
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
                fileNotFound: `Resource file does not exist inside "${resourceDirectoryPath}". Use double-click or 'Create Resource' button to create it.`,
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

        if (this.shouldIgnoreNonResourceKeywordAction(item, "handleKeywordClick")) {
            return;
        }

        if (!item.id) {
            this.logger.warn(`[TestElementsTreeView] handleKeywordClick called for item without ID: ${item.label}`);
            return;
        }

        await this.keywordClickHandler.handleClick(item, item.id, this.logger);
    }

    /**
     * Determines whether an operation on a keyword should be ignored because the keyword
     * is not under a resource subdivision hierarchy.
     *
     * @param item The keyword tree item that triggered the action.
     * @param actionName The action name used for trace logging.
     * @returns True when the action should be ignored, otherwise false.
     */
    private shouldIgnoreNonResourceKeywordAction(item: TestElementsTreeItem, actionName: string): boolean {
        if (item.parent && !item.isKeywordUnderResourceHierarchy()) {
            this.logger.debug(
                `[TestElementsTreeView] Ignoring ${actionName} for non-resource keyword: ${item.label} (id: ${item.id})`
            );
            return true;
        }

        return false;
    }

    /**
     * Creates a Robot Resource subdivision either under the selected subdivision item
     * or at root level when no item is provided. User is prompted to enter the subdivision name
     * and an optional description. The configured resource marker suffix is appended
     * automatically to the subdivision name if missing.
     *
     * @param item Optional parent subdivision tree item.
     */
    public async promptAndCreateRobotResourceSubdivision(
        item?: TestElementsTreeItem,
        options?: { autoAppendResourceMarker?: boolean }
    ): Promise<void> {
        const resourceMarkers = this.getConfiguredResourceMarkers();
        const autoAppendedMarker = resourceMarkers[0];
        const shouldAutoAppendResourceMarker =
            options?.autoAppendResourceMarker ?? this.shouldAutoAppendResourceMarker();
        const autoAppendHintInPrompt =
            shouldAutoAppendResourceMarker && autoAppendedMarker
                ? ` Resource suffix '${autoAppendedMarker}' is appended automatically if missing.`
                : "";

        const subdivisionName = await vscode.window.showInputBox({
            title: item ? "Create Subdivision" : "Create Root Subdivision",
            prompt: item
                ? `Enter subdivision name under '${item.label?.toString() || "selected parent"}'.${autoAppendHintInPrompt}`
                : `Enter root subdivision name.${autoAppendHintInPrompt}`,
            placeHolder:
                shouldAutoAppendResourceMarker && autoAppendedMarker
                    ? "Subdivision name (resource suffix will be auto-appended)"
                    : "Subdivision name",
            validateInput: (value) => this.validateSubdivisionName(value)
        });

        if (subdivisionName === undefined) {
            return;
        }

        const trimmedName = subdivisionName.trim();
        const normalizedName = shouldAutoAppendResourceMarker
            ? this.ensureSubdivisionNameHasResourceMarker(trimmedName)
            : trimmedName;
        const normalizedNameValidationError = this.validateSubdivisionName(normalizedName);
        if (normalizedNameValidationError) {
            vscode.window.showErrorMessage(normalizedNameValidationError);
            return;
        }

        if (normalizedName !== trimmedName) {
            this.logger.trace(
                `[TestElementsTreeView] Auto-appended resource marker to subdivision name: original='${trimmedName}', normalized='${normalizedName}'.`
            );
        }

        const promptDescriptionText = await vscode.window.showInputBox({
            title: "Create Subdivision",
            prompt: "Optional description (plain text)",
            placeHolder: "Description (optional)",
            value: ""
        });

        if (promptDescriptionText === undefined) {
            return;
        }

        const connection = this.getConnection();
        if (!connection) {
            vscode.window.showErrorMessage("No active TestBench connection available.");
            return;
        }

        const projectKey = this.currentProjectKey;
        const tovKey = this.currentTovKey;
        if (!projectKey || !tovKey) {
            vscode.window.showErrorMessage("Cannot create subdivision: missing project or TOV context.");
            return;
        }

        const parentKey = this.resolveParentKeyForSubdivisionCreation(item);
        if (parentKey === undefined) {
            vscode.window.showErrorMessage("Cannot create subdivision: selected parent has no valid key.");
            return;
        }

        const generatedSubdivisionUid = this.generateSubdivisionUid();
        const subdivisionCreationRequestBody = this.buildSubdivisionCreationRequestPayload(
            parentKey,
            normalizedName,
            generatedSubdivisionUid,
            promptDescriptionText
        );

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: item ? "Creating subdivision" : "Creating root subdivision",
                    cancellable: false
                },
                async () => {
                    this.logger.trace(
                        `[TestElementsTreeView] Creating subdivision (projectKey=${projectKey}, tovKey=${tovKey}, parentKey='${parentKey}', name='${normalizedName}', uid='${generatedSubdivisionUid}', uidLength=${generatedSubdivisionUid.length}, autoAppendResourceMarker=${shouldAutoAppendResourceMarker}).`
                    );
                    await connection.createSubdivisionOnServer(projectKey, tovKey, subdivisionCreationRequestBody);
                }
            );

            this.refresh();
            vscode.window.showInformationMessage(`Subdivision '${normalizedName}' created successfully.`);
        } catch (error) {
            if (error instanceof PlayServerHttpError) {
                this.handleSubdivisionCreationHttpError(error);
                return;
            }

            this.logger.error("[TestElementsTreeView] Unexpected error while creating subdivision:", error);
            vscode.window.showErrorMessage(
                `Failed to create subdivision: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Resolves the parent key for subdivision creation.
     * Root subdivisions use null, child subdivisions use the selected item's key.
     *
     * @param treeItem Optional selected subdivision item.
     * @returns null for root creation, subdivision key for child creation, or undefined for invalid parent item.
     */
    private resolveParentKeyForSubdivisionCreation(treeItem?: TestElementsTreeItem): string | null | undefined {
        if (!treeItem) {
            return null;
        }

        if (treeItem.data.testElementType !== TestElementType.Subdivision) {
            return undefined;
        }

        const parentKey = this.extractSubdivisionKey(treeItem);
        return parentKey && parentKey.trim().length > 0 ? parentKey : undefined;
    }

    /**
     * Builds the create subdivision request body payload sent to the server.
     * @param parentKey The parent subdivision key or null for root subdivisions.
     * @param name The name of the new subdivision.
     * @param uid The unique identifier for the new subdivision.
     * @param descriptionText The plain text description entered by the user.
     * @returns The request body object for subdivision creation API call.
     */
    private buildSubdivisionCreationRequestPayload(
        parentKey: string | null,
        name: string,
        uid: string,
        descriptionText: string
    ) {
        return {
            parentKey,
            name,
            uid,
            description: {
                html: this.buildDescriptionHtml(descriptionText),
                images: []
            }
        };
    }

    /**
     * Generates a short UID format that fits TestBench server constraints.
     * @returns A compact, foreign-style UID for subdivision creation.
     */
    private generateSubdivisionUid(): string {
        const compactUID = uuidv4().replace(/-/g, "").slice(0, 16);
        return `vsc-${compactUID}`;
    }

    /**
     * Ensures newly created subdivision names end with one of the configured resource markers.
     * If no marker is configured, the name is returned unchanged.
     *
     * @param subdivisionName Raw user-entered subdivision name.
     * @returns Name with resource marker suffix when needed.
     */
    private ensureSubdivisionNameHasResourceMarker(subdivisionName: string): string {
        const resourceMarkers = this.getConfiguredResourceMarkers();

        if (resourceMarkers.length === 0) {
            return subdivisionName;
        }

        const nameAlreadyHasSuffix = resourceMarkers.some((marker) => subdivisionName.endsWith(marker));
        if (nameAlreadyHasSuffix) {
            return subdivisionName;
        }

        const markerToAppend = resourceMarkers[0];
        const separator = subdivisionName.endsWith(" ") ? "" : " ";
        return `${subdivisionName}${separator}${markerToAppend}`;
    }

    /**
     * Returns non-empty configured resource markers.
     */
    private getConfiguredResourceMarkers(): string[] {
        return (
            getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_RESOURCE_MARKER)?.filter(
                (marker) => typeof marker === "string" && marker.trim().length > 0
            ) || []
        );
    }

    /**
     * Determines whether subdivision creation should auto-append the configured resource marker.
     * Marker appending is enabled only in resource-only visibility mode to preserve legacy behavior.
     */
    private shouldAutoAppendResourceMarker(): boolean {
        const configuredMode = getExtensionSetting<string>(ConfigKeys.TEST_ELEMENTS_VISIBILITY_MODE);
        return configuredMode !== "allSubdivisions";
    }

    /**
     * Extracts the subdivision key expected by the create subdivision endpoint.
     *
     * @param subdivisionTreeItem The subdivision tree item.
     * @returns The subdivision key, if available.
     */
    private extractSubdivisionKey(subdivisionTreeItem: TestElementsTreeItem): string | undefined {
        const subdivisionDetails = subdivisionTreeItem.data.details as {
            key?: string;
            Subdivision_key?: { serial?: string };
        };

        const keyFromDetails = subdivisionDetails?.key;
        if (keyFromDetails && keyFromDetails.trim().length > 0) {
            return keyFromDetails;
        }

        const serialFromDetails = subdivisionDetails?.Subdivision_key?.serial;
        if (serialFromDetails && serialFromDetails.trim().length > 0) {
            return serialFromDetails;
        }

        if (typeof subdivisionTreeItem.data.id === "string" && subdivisionTreeItem.data.id.includes("_")) {
            const [prefix] = subdivisionTreeItem.data.id.split("_", 1);
            if (prefix && prefix.trim().length > 0) {
                return prefix;
            }
        }

        return undefined;
    }

    /**
     * Validates subdivision names against server-side constraints.
     *
     * @param nameToValidate The name to validate.
     * @returns Validation message or undefined when valid.
     */
    private validateSubdivisionName(nameToValidate: string): string | undefined {
        const trimmedName = nameToValidate.trim();
        if (trimmedName.length < 1) {
            return "Subdivision name must not be empty.";
        }

        if (trimmedName.length > 255) {
            return "Subdivision name must be at most 255 characters.";
        }

        if (/[/.',<;>&]/.test(trimmedName)) {
            return "Subdivision name contains invalid characters: / . ' , < ; > &";
        }

        return undefined;
    }

    /**
     * Builds safe HTML for subdivision description from plain text.
     *
     * @param descriptionText Plain text entered by the user.
     * @returns HTML content for API payload.
     */
    private buildDescriptionHtml(descriptionText: string): string {
        const sanitizedDescription = descriptionText
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

        return `<html><body>${sanitizedDescription}</body></html>`;
    }

    /**
     * Maps subdivision creation API errors to user-facing messages based on TestBench API specifications.
     *
     * @param error The API error.
     */
    private handleSubdivisionCreationHttpError(error: PlayServerHttpError): void {
        this.logger.error(
            `[TestElementsTreeView] createSubdivision HTTP error status=${error.statusCode}, message='${error.message}', response=${JSON.stringify(error.responseData)}`
        );

        switch (error.statusCode) {
            case 400:
                vscode.window.showErrorMessage(`Subdivision creation failed (400): ${error.message || "Bad request."}`);
                return;
            case 403:
                vscode.window.showErrorMessage(
                    "Subdivision creation failed (403): You need administrator, manager, or designer rights in this project."
                );
                return;
            case 404:
                vscode.window.showErrorMessage(
                    "Subdivision creation failed (404): Project, TOV, or parent subdivision was not found."
                );
                return;
            case 409:
                vscode.window.showErrorMessage(
                    "Subdivision creation failed (409): Name/UID conflict or parent subdivision is not lockable."
                );
                return;
            case 422:
                vscode.window.showErrorMessage(
                    "Subdivision creation failed (422): Name must be 1-255 chars and must not contain / . ' , < ; > &."
                );
                return;
            default:
                vscode.window.showErrorMessage(`Subdivision creation failed (${error.statusCode}): ${error.message}`);
        }
    }

    /**
     * Disposes of all resources and cleans up the tree view.
     */
    public async dispose(): Promise<void> {
        this.cancelPostFetchAvailabilityWork();
        this.testElementIndexByDataId.clear();
        this.testElementIndexByTreeItemId.clear();

        if (this.resourceAvailabilityRefreshDebounceHandle) {
            clearTimeout(this.resourceAvailabilityRefreshDebounceHandle);
            this.resourceAvailabilityRefreshDebounceHandle = undefined;
        }

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
            if (options?.clearRawCache === false) {
                this.dataProvider.clearFilteredCache(this.currentTovKey);
            } else {
                this.dataProvider.clearCache(this.currentTovKey);
            }

            this.loadTov(this.currentTovKey, {
                tovLabel: this.currentTovLabel || undefined,
                projectName: this.currentProjectName || undefined,
                tovName: this.currentTovName || undefined,
                clearFirst: false,
                projectKey: this.currentProjectKey || undefined,
                includeLoadTimeInEvent: true
            });
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
