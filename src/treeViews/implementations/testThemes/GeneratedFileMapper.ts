/**
 * @file src/treeViews/implementations/testThemes/GeneratedFileMapper.ts
 * @description Service for managing generation metadata that maps tree items to generated files.
 * Uses VS Code's workspace state storage for reliability.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { TestBenchLogger } from "../../../testBenchLogger";
import { validateAndReturnWorkspaceLocation } from "../../../utils";

export interface GeneratedItemMetadata {
    type: "TestCaseSet" | "TestTheme";
    name: string;
    numbering: string;
    generatedFile?: string; // For TestCaseSet
    generatedFolder?: string; // For TestTheme
    generationTimestamp: string;
    childFiles?: string[]; // For TestTheme list of all child robot files
}

export interface GenerationMetadata {
    lastGenerationTimestamp: string;
    logSuiteNumbering: boolean;
    outputDirectory: string;
    items: {
        [uniqueID: string]: GeneratedItemMetadata;
    };
}

export class GeneratedFileMapper {
    private static readonly STORAGE_KEY = "testbench.generationMetadata";
    private metadata: GenerationMetadata | null = null;
    private workspaceState: vscode.Memento | null = null;

    constructor(
        private readonly logger: TestBenchLogger,
        private readonly context?: vscode.ExtensionContext
    ) {
        this.workspaceState = context?.workspaceState ?? null;
    }

    /**
     * Initializes the metadata service by loading existing metadata
     * @returns Promise that resolves when initialization is complete
     */
    public async initialize(): Promise<void> {
        await this.loadMetadata();
    }

    /**
     * Loads metadata from VS Code workspace state
     * @returns Promise that resolves when metadata is loaded
     */
    private async loadMetadata(): Promise<void> {
        if (!this.workspaceState) {
            this.logger.trace("[GeneratedFileMapper] No workspace state available");
            return;
        }

        try {
            const storedMetadata = this.workspaceState.get<GenerationMetadata>(GeneratedFileMapper.STORAGE_KEY);
            if (storedMetadata) {
                // Validate that referenced files still exist
                this.metadata = await this.validateMetadata(storedMetadata);
                this.logger.trace(
                    `[GeneratedFileMapper] Loaded metadata with ${Object.keys(this.metadata?.items || {}).length} items`
                );
            } else {
                this.logger.trace("[GeneratedFileMapper] No existing metadata found in workspace state");
                this.metadata = null;
            }
        } catch (error) {
            this.logger.error("[GeneratedFileMapper] Error loading metadata:", error);
            this.metadata = null;
        }
    }

    /**
     * Validates metadata by checking if referenced files still exist
     * @param metadata The metadata to validate
     * @returns Validated metadata with stale entries removed
     */
    private async validateMetadata(metadata: GenerationMetadata): Promise<GenerationMetadata> {
        const workspaceLocation = await validateAndReturnWorkspaceLocation(false);
        if (!workspaceLocation) {
            return metadata;
        }

        const validatedItems: { [uniqueID: string]: GeneratedItemMetadata } = {};
        let removedCount = 0;

        for (const [uniqueID, item] of Object.entries(metadata.items)) {
            let isValid = false;

            if (item.generatedFile) {
                const filePath = item.generatedFile.startsWith(workspaceLocation)
                    ? item.generatedFile
                    : `${workspaceLocation}\\${item.generatedFile}`;
                isValid = fs.existsSync(filePath);
            } else if (item.generatedFolder) {
                const folderPath = item.generatedFolder.startsWith(workspaceLocation)
                    ? item.generatedFolder
                    : `${workspaceLocation}\\${item.generatedFolder}`;
                isValid = fs.existsSync(folderPath);
            }

            if (isValid) {
                validatedItems[uniqueID] = item;
            } else {
                removedCount++;
            }
        }

        if (removedCount > 0) {
            this.logger.debug(`[GeneratedFileMapper] Removed ${removedCount} stale metadata entries`);
        }

        return {
            ...metadata,
            items: validatedItems
        };
    }

    /**
     * Saves metadata to VS Code workspace state
     * @param metadata The metadata to save
     * @returns Promise that resolves when metadata is saved
     */
    private async saveMetadata(metadata: GenerationMetadata): Promise<void> {
        if (!this.workspaceState) {
            this.logger.warn("[GeneratedFileMapper] Cannot save metadata: no workspace state available");
            return;
        }

        try {
            await this.workspaceState.update(GeneratedFileMapper.STORAGE_KEY, metadata);
            this.metadata = metadata;
            this.logger.debug(`[GeneratedFileMapper] Saved metadata with ${Object.keys(metadata.items).length} items`);
        } catch (error) {
            this.logger.error("[GeneratedFileMapper] Error saving metadata:", error);
        }
    }

    /**
     * Records a new test generation
     * @param outputDirectory The output directory used for generation
     * @param logSuiteNumbering Whether log suite numbering was enabled
     */
    public async startMetadataGeneration(outputDirectory: string, logSuiteNumbering: boolean): Promise<void> {
        const newMetadata: GenerationMetadata = {
            lastGenerationTimestamp: new Date().toISOString(),
            logSuiteNumbering,
            outputDirectory,
            items: {}
        };

        await this.saveMetadata(newMetadata);
    }

    /**
     * Records a generated file for a test case set into metadata
     * @param uniqueID The unique ID of the test case set
     * @param name The name of the test case set
     * @param numbering The numbering of the test case set
     * @param generatedFilePath The path to the generated .robot file (relative to workspace)
     */
    public async recordGeneratedFile(
        uniqueID: string,
        name: string,
        numbering: string,
        generatedFilePath: string
    ): Promise<void> {
        if (!this.metadata) {
            this.logger.warn("[GeneratedFileMapper] Cannot record file: no active metadata session");
            return;
        }

        this.metadata.items[uniqueID] = {
            type: "TestCaseSet",
            name,
            numbering,
            generatedFile: generatedFilePath,
            generationTimestamp: new Date().toISOString()
        };

        await this.saveMetadata(this.metadata);
    }

    /**
     * Records a generated folder for a test theme into metadata
     * @param uniqueID The unique ID of the test theme
     * @param name The name of the test theme
     * @param numbering The numbering of the test theme
     * @param generatedFolderPath The path to the generated folder (relative to workspace)
     * @param childFiles Optional array of child robot file paths
     */
    public async recordGeneratedFolder(
        uniqueID: string,
        name: string,
        numbering: string,
        generatedFolderPath: string,
        childFiles?: string[]
    ): Promise<void> {
        if (!this.metadata) {
            this.logger.warn("[GeneratedFileMapper] Cannot record folder: no active metadata session");
            return;
        }

        this.metadata.items[uniqueID] = {
            type: "TestTheme",
            name,
            numbering,
            generatedFolder: generatedFolderPath,
            generationTimestamp: new Date().toISOString(),
            childFiles
        };

        await this.saveMetadata(this.metadata);
    }

    /**
     * Updates the file path in metadata for a test case set (e.g., after rename detection)
     * @param uniqueID The unique ID of the test case set
     * @param newFilePath The new relative file path
     * @returns Promise that resolves when update is complete
     */
    public async updateMetadataFilePath(uniqueID: string, newFilePath: string): Promise<void> {
        if (!this.metadata) {
            this.logger.warn("[GeneratedFileMapper] Cannot update file path - no metadata initialized");
            return;
        }

        const item = this.metadata.items[uniqueID];
        if (!item || item.type !== "TestCaseSet") {
            this.logger.warn(
                `[GeneratedFileMapper] Cannot update file path - item ${uniqueID} not found or not a TestCaseSet`
            );
            return;
        }

        const oldPath = item.generatedFile;
        item.generatedFile = newFilePath;
        item.generationTimestamp = new Date().toISOString();

        await this.saveMetadata(this.metadata);
        this.logger.debug(`[GeneratedFileMapper] Updated file path for ${uniqueID}: ${oldPath} → ${newFilePath}`);
    }

    /**
     * Updates the folder path in metadata for a test theme (e.g., after rename detection)
     * @param uniqueID The unique ID of the test theme
     * @param newFolderPath The new relative folder path
     * @returns Promise that resolves when update is complete
     */
    public async updateFolderPath(uniqueID: string, newFolderPath: string): Promise<void> {
        if (!this.metadata) {
            this.logger.warn("[GeneratedFileMapper] Cannot update folder path - no metadata initialized");
            return;
        }

        const item = this.metadata.items[uniqueID];
        if (!item || item.type !== "TestTheme") {
            this.logger.warn(
                `[GeneratedFileMapper] Cannot update folder path - item ${uniqueID} not found or not a TestTheme`
            );
            return;
        }

        const oldPath = item.generatedFolder;
        item.generatedFolder = newFolderPath;
        item.generationTimestamp = new Date().toISOString();

        await this.saveMetadata(this.metadata);
        this.logger.debug(`[GeneratedFileMapper] Updated folder path for ${uniqueID}: ${oldPath} → ${newFolderPath}`);
    }

    /**
     * Gets the generated file path for a test case set
     * @param uniqueID The unique ID of the test case set
     * @returns The absolute file path if found and exists, undefined otherwise
     */
    public async getGeneratedFilePath(uniqueID: string): Promise<string | undefined> {
        if (!this.metadata) {
            return undefined;
        }

        const item = this.metadata.items[uniqueID];
        if (!item || item.type !== "TestCaseSet" || !item.generatedFile) {
            return undefined;
        }

        const workspaceLocation = await validateAndReturnWorkspaceLocation(false);
        if (!workspaceLocation) {
            return undefined;
        }

        const absolutePath = path.isAbsolute(item.generatedFile)
            ? item.generatedFile
            : path.join(workspaceLocation, item.generatedFile);

        // Verify the file still exists
        if (fs.existsSync(absolutePath)) {
            return absolutePath;
        }

        this.logger.trace(`[GeneratedFileMapper] File in metadata no longer exists: ${absolutePath}`);
        return undefined;
    }

    /**
     * Gets the generated folder path for a test theme
     * @param uniqueID The unique ID of the test theme
     * @returns The absolute folder path if found and exists, undefined otherwise
     */
    public async getGeneratedFolderPath(uniqueID: string): Promise<string | undefined> {
        if (!this.metadata) {
            return undefined;
        }

        const item = this.metadata.items[uniqueID];
        if (!item || item.type !== "TestTheme" || !item.generatedFolder) {
            return undefined;
        }

        const workspaceLocation = await validateAndReturnWorkspaceLocation(false);
        if (!workspaceLocation) {
            return undefined;
        }

        const absolutePath = path.isAbsolute(item.generatedFolder)
            ? item.generatedFolder
            : path.join(workspaceLocation, item.generatedFolder);

        // Verify the folder still exists
        if (fs.existsSync(absolutePath)) {
            return absolutePath;
        }

        this.logger.trace(`[GeneratedFileMapper] Folder in metadata no longer exists: ${absolutePath}`);
        return undefined;
    }

    /**
     * Checks if an item has generation metadata
     * @param uniqueID The unique ID to check
     * @returns True if metadata exists for this item
     */
    public hasMetadata(uniqueID: string): boolean {
        return this.metadata !== null && uniqueID in this.metadata.items;
    }

    /**
     * Gets all unique IDs that have generation metadata
     * @returns Array of unique IDs
     */
    public getAllGeneratedItemUIDs(): string[] {
        if (!this.metadata) {
            return [];
        }
        return Object.keys(this.metadata.items);
    }

    /**
     * Removes metadata for a specific item
     * @param uniqueID The unique ID to remove
     */
    public async removeMetadata(uniqueID: string): Promise<void> {
        if (!this.metadata || !(uniqueID in this.metadata.items)) {
            return;
        }

        delete this.metadata.items[uniqueID];
        await this.saveMetadata(this.metadata);
    }

    /**
     * Clears all metadata from workspace state
     */
    public async clearAllMetadata(): Promise<void> {
        if (!this.workspaceState) {
            return;
        }

        try {
            await this.workspaceState.update(GeneratedFileMapper.STORAGE_KEY, undefined);
            this.metadata = null;
            this.logger.debug("[GeneratedFileMapper] Cleared all metadata");
        } catch (error) {
            this.logger.error("[GeneratedFileMapper] Error clearing metadata:", error);
        }
    }

    /**
     * Gets the current metadata
     * @returns The current metadata or null if not loaded
     */
    public getMetadata(): GenerationMetadata | null {
        return this.metadata;
    }

    /**
     * Validates and cleans up metadata by removing entries for files/folders that no longer exist
     * @returns Promise that resolves to the number of entries removed
     */
    public async validateAndCleanup(): Promise<number> {
        if (!this.metadata) {
            return 0;
        }

        const workspaceLocation = await validateAndReturnWorkspaceLocation(false);
        if (!workspaceLocation) {
            return 0;
        }

        let removedCount = 0;
        const itemsToRemove: string[] = [];

        for (const [uniqueID, item] of Object.entries(this.metadata.items)) {
            let exists = false;

            if (item.type === "TestCaseSet" && item.generatedFile) {
                const absolutePath = path.isAbsolute(item.generatedFile)
                    ? item.generatedFile
                    : path.join(workspaceLocation, item.generatedFile);
                exists = fs.existsSync(absolutePath);
            } else if (item.type === "TestTheme" && item.generatedFolder) {
                const absolutePath = path.isAbsolute(item.generatedFolder)
                    ? item.generatedFolder
                    : path.join(workspaceLocation, item.generatedFolder);
                exists = fs.existsSync(absolutePath);
            }

            if (!exists) {
                itemsToRemove.push(uniqueID);
            }
        }

        for (const uniqueID of itemsToRemove) {
            delete this.metadata.items[uniqueID];
            removedCount++;
        }

        if (removedCount > 0) {
            await this.saveMetadata(this.metadata);
            this.logger.debug(`[GeneratedFileMapper] Cleaned up ${removedCount} stale metadata entries`);
        }

        return removedCount;
    }
}
