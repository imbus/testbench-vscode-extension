/**
 * @file src/treeViews/implementations/testElements/ResourceFileService.ts
 * @description Service for managing resource files related to Test Elements Tree.
 */

import * as fs from "fs";
import * as path from "path";
import { TestBenchLogger } from "../../../testBenchLogger";
import { validateAndReturnWorkspaceLocation } from "../../../utils";
import { getExtensionSetting } from "../../../configuration";
import { ConfigKeys } from "../../../constants";
import { TestElementsTreeItem } from "./TestElementsTreeItem";

/**
 * Configuration for resource operations
 */
export interface ResourceOperationConfig {
    operationType: "open" | "create" | "folder" | "interaction";
    createMissing: boolean;
    targetItem: TestElementsTreeItem;
    parentItem?: TestElementsTreeItem;
    errorMessages: {
        noHierarchicalName: string;
        noPath: string;
        noParent: string;
        noUid: string;
        fileNotFound: string;
        folderNotFound: string;
    };
    successMessages?: {
        created?: string;
    };
}

export class ResourceFileService {
    constructor(private readonly logger: TestBenchLogger) {}

    /**
     * Normalizes a hierarchical name by replacing invalid file path characters with underscores.
     * @param component The path component to normalize
     * @returns The normalized component with special characters replaced by underscores
     */
    private normalizePathComponent(component: string): string {
        return component.replace(/[<>:"/\\|?*,]/g, "_");
    }

    /**
     * Converts a hierarchical name to an array of normalized path components.
     * @param hierarchicalName The hierarchical name (e.g., "Folder/SubFolder/Resource")
     * @returns Array of normalized path components ready for file system operations
     */
    private hierarchicalNameToPathComponents(hierarchicalName: string): string[] {
        const components = hierarchicalName.split("/");
        return components.map((component) => this.normalizePathComponent(component));
    }

    /**
     * Removes all occurrences of configured resource markers from a given path string.
     * @param pathStr The path string to clean
     * @returns The cleaned path string with resource markers removed
     */
    private removeResourceMarkersFromPathString(pathStr: string): string {
        const resourceMarkers = getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_RESOURCE_MARKER);
        if (!resourceMarkers || resourceMarkers.length === 0) {
            return pathStr;
        }

        let cleanedPath = pathStr;
        for (const marker of resourceMarkers) {
            const escapedMarker = marker.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
            const regex = new RegExp(escapedMarker, "g");
            cleanedPath = cleanedPath.replace(regex, "");
        }
        return cleanedPath;
    }

    /**
     * Checks if a string contains any configured resource markers.
     * @param str The string to check for resource markers
     * @returns True if the string contains any configured resource markers
     */
    public static hasResourceMarker(str: string): boolean {
        const resourceMarkers = getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_RESOURCE_MARKER);
        if (!resourceMarkers || resourceMarkers.length === 0) {
            return false;
        }

        return resourceMarkers.some((marker) => str.includes(marker));
    }

    /**
     * Ensures a file exists at the specified path, creating it with initial content if it doesn't.
     * Parent directories will also be created if they don't exist.
     * @param filePath The absolute path of the file to ensure.
     * @param initialContent The content to write if the file is created.
     */
    public async ensureFileExists(filePath: string, initialContent: string): Promise<void> {
        if (!(await this.pathExists(filePath))) {
            this.logger.debug(`[ResourceFileService] Resource file not found. Creating: ${filePath}`);
            const dirName = path.dirname(filePath);
            await this.ensureFolderPathExists(dirName);
            try {
                await fs.promises.writeFile(filePath, initialContent, { encoding: "utf8" });
                this.logger.info(`[ResourceFileService] Resource file created at ${filePath}`);
            } catch (writeError) {
                this.logger.error(`[ResourceFileService] Error writing to resource file ${filePath}:`, writeError);
                throw writeError;
            }
        } else {
            this.logger.debug(
                `[ResourceFileService] Resource file already exists, content not overwritten: ${filePath}`
            );
        }
    }

    /**
     * Constructs an absolute file system path for a TestBench hierarchical name,
     * respecting the configured Resource Directory Marker and Resource Directory Path.
     *
     * Below the "Resource Directory Marker" subdivision, folder structure matches the file system, everything above is ignored.
     * Folder structure under "Resource Directory Path" mirrors the TestBench subdivisions starting at the marker.
     * File path when creating: resourceDirectoryPath + subdivision path starting from the marker.
     * @param hierarchicalName The slash-separated hierarchical name (e.g., "Folder/SubFolder/MyResource").
     * @returns {Promise<string | undefined>} The absolute path or undefined if workspace root is not found.
     */
    public async constructAbsolutePath(hierarchicalName: string): Promise<string | undefined> {
        const workspaceRootPath = await validateAndReturnWorkspaceLocation();
        if (!workspaceRootPath) {
            return undefined;
        }
        if (!hierarchicalName) {
            this.logger.error("[ResourceFileService] Hierarchical name is empty. Cannot construct absolute path.");
            return undefined;
        }

        const resourceDirRelative = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_DIR) || "";
        const resourceDirectoryMarker = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_DIRECTORY_REGEX) || "";

        const cleanedHierarchical = this.removeResourceMarkersFromPathString(hierarchicalName);
        const splitPathComponents = cleanedHierarchical.split("/");
        const normalizedPathComponents = splitPathComponents.map((c) => this.normalizePathComponent(c));

        // Find index of the resource directory marker (exact match)
        let resourceFileSliceStartIndex = 0;
        if (resourceDirectoryMarker) {
            const resourceDirectoryMarkerIndex = splitPathComponents.findIndex((c) => c === resourceDirectoryMarker);
            if (resourceDirectoryMarkerIndex !== -1) {
                // Ignore everything up to and including the marker itself
                resourceFileSliceStartIndex = resourceDirectoryMarkerIndex + 1;
            }
        }

        const relativePathUnderMarker = normalizedPathComponents.slice(resourceFileSliceStartIndex);
        const absolutePath = path.join(workspaceRootPath, resourceDirRelative, ...relativePathUnderMarker);

        this.logger.trace(
            `[ResourceFileService] Constructed absolute path for '${hierarchicalName}' with marker='${resourceDirectoryMarker}' and resourceDir='${resourceDirRelative}' -> ${absolutePath}`
        );
        return absolutePath;
    }

    /**
     * Checks if a file or directory exists at the given path.
     * @param filePath The absolute path to check.
     * @param caseSensitiveCheck If true, performs a more rigorous case-sensitive check (mainly for non-Windows).
     * @returns {Promise<boolean>} True if the path exists (respecting case sensitivity if checked).
     */
    public async pathExists(filePath: string, caseSensitiveCheck: boolean = false): Promise<boolean> {
        const cleanedPath = this.removeResourceMarkersFromPathString(filePath);
        try {
            await fs.promises.stat(cleanedPath);

            if (process.platform === "win32" || !caseSensitiveCheck) {
                return true;
            }

            // For case-sensitive systems, verify the exact filename
            const dir = path.dirname(cleanedPath);
            const filename = path.basename(cleanedPath);
            const filesInDir = await fs.promises.readdir(dir);
            return filesInDir.includes(filename);
        } catch (err: any) {
            if (err.code === "ENOENT") {
                this.logger.trace(`[ResourceFileService] Path does not exist: ${cleanedPath}`);
                return false;
            }
            this.logger.error(`[ResourceFileService] Error stating file/dir "${cleanedPath}": ${err.message}`);
            throw err;
        }
    }

    /**
     * Checks if a directory exists at the given path.
     * @param dirPath The absolute path to check.
     * @returns {Promise<boolean>} True if the directory exists.
     */
    public async directoryExists(dirPath: string): Promise<boolean> {
        const cleanedPath = this.removeResourceMarkersFromPathString(dirPath);
        try {
            const stats = await fs.promises.stat(cleanedPath);
            return stats.isDirectory();
        } catch (err: any) {
            if (err.code === "ENOENT") {
                this.logger.debug(`[ResourceFileService] Directory does not exist: ${cleanedPath}`);
                return false;
            }
            this.logger.error(`[ResourceFileService] Error stating directory "${cleanedPath}": ${err.message}`);
            throw err;
        }
    }

    /**
     * Checks if a file exists at the given path.
     * @param filePath The absolute path to check.
     * @returns {Promise<boolean>} True if the file exists.
     */
    public async fileExists(filePath: string): Promise<boolean> {
        const cleanedPath = this.removeResourceMarkersFromPathString(filePath);
        try {
            const stats = await fs.promises.stat(cleanedPath);
            return stats.isFile();
        } catch (err: any) {
            if (err.code === "ENOENT") {
                this.logger.debug(`[ResourceFileService] File does not exist: ${cleanedPath}`);
                return false;
            }
            this.logger.error(`[ResourceFileService] Error stating file "${cleanedPath}": ${err.message}`);
            throw err;
        }
    }

    /**
     * Ensures that a folder exists at the specified path, creating it if necessary.
     * @param folderPath The absolute path of the folder to ensure.
     * @returns {Promise<void>}
     */
    public async ensureFolderPathExists(folderPath: string): Promise<void> {
        const cleanedPath = this.removeResourceMarkersFromPathString(folderPath);

        try {
            await fs.promises.mkdir(cleanedPath, { recursive: true });
        } catch (error: any) {
            this.logger.error(
                `[ResourceFileService] Failed to check if folder path exists: "${cleanedPath}": ${error.message}`,
                error
            );
            throw error;
        }
    }
}
