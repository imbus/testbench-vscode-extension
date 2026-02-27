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
    operationType: "open" | "create" | "folder" | "keyword";
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
    private static readonly MAX_CONSTRUCTED_PATH_CACHE_ENTRIES = 5000;
    private readonly constructedPathCache = new Map<string, string>();

    constructor(private readonly logger: TestBenchLogger) {}

    /**
     * Clears the cached absolute path resolutions.
     */
    public clearConstructedPathCache(): void {
        this.constructedPathCache.clear();
    }

    /**
     * Reads and normalizes all path-resolution related settings.
     * @returns {{resourceDirRelativeToWorkspace: string; resourceDirectoryMarker: string; resourceMarkers: string[]}}
     * An object containing resource directory path, marker regex, and configured resource markers.
     */
    private getPathResolutionSettings(): {
        resourceDirRelativeToWorkspace: string;
        resourceDirectoryMarker: string;
        resourceMarkers: string[];
    } {
        const resourceDirRelativeToWorkspace = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_DIR) || "";
        const resourceDirectoryMarker =
            getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_DIRECTORY_MARKER) || "";
        const resourceMarkers = getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_RESOURCE_MARKER) || [];

        return {
            resourceDirRelativeToWorkspace,
            resourceDirectoryMarker,
            resourceMarkers: resourceMarkers.filter((marker): marker is string => typeof marker === "string")
        };
    }

    /**
     * Builds a stable cache key for an absolute-path resolution request.
     * @param hierarchicalName The hierarchical resource name to resolve.
     * @param settings The normalized path-resolution settings used for this resolution.
     * @returns {string} A serialized cache key.
     */
    private buildConstructedPathCacheKey(
        hierarchicalName: string,
        settings: {
            resourceDirRelativeToWorkspace: string;
            resourceDirectoryMarker: string;
            resourceMarkers: string[];
        }
    ): string {
        return JSON.stringify({
            hierarchicalName,
            resourceDirRelativeToWorkspace: settings.resourceDirRelativeToWorkspace,
            resourceDirectoryMarker: settings.resourceDirectoryMarker,
            resourceMarkers: settings.resourceMarkers
        });
    }

    /**
     * Prunes the absolute path cache to its maximum configured size.
     * Removes oldest entries first.
     * @returns {void}
     */
    private pruneConstructedPathCache(): void {
        while (this.constructedPathCache.size > ResourceFileService.MAX_CONSTRUCTED_PATH_CACHE_ENTRIES) {
            const oldestKey = this.constructedPathCache.keys().next().value;
            if (!oldestKey) {
                return;
            }
            this.constructedPathCache.delete(oldestKey);
        }
    }

    /**
     * Normalizes a path by replacing these file path characters with underscores:
     * ["<", ">", ":", "\"", "/", "|", "?", "*"].
     * Does not replace spaces unlike .robot file creation process.
     * @param path The path component to normalize
     * @returns The normalized path with special characters replaced by underscores
     */
    public static normalizePath(path: string): string {
        return path.replace(/[<>:"/\\|?*]/g, "_");
    }

    /**
     * Finds the index of the first subdivision part that matches the resource directory regex.
     * Replicates the behavior of the language server command
     * `testbench_ls.get_resource_directory_subdivision_index` in TypeScript to avoid overhead.
     *
     * @example
     * subdivisionParts: ["Project", "Module", "[Robot-Resources]", "Login"]
     * resourceDirectoryRegex: ".*\\[Robot-Resources\\].*"
     * returns 2 (the index of "[Robot-Resources]").
     * Everything before index 2 is ignored, everything after (["Login"]) becomes
     * the relative path under the configured resource directory.
     *
     * @param subdivisionParts Array of path components to search through
     * @param resourceDirectoryRegex The regex pattern string to match against each part
     * @returns The index of the first matching part, or -1 if no match is found
     */
    public static findResourceDirectoryMarkerIndex(subdivisionParts: string[], resourceDirectoryRegex: string): number {
        if (!subdivisionParts || subdivisionParts.length === 0) {
            return -1;
        }
        if (!resourceDirectoryRegex) {
            return -1;
        }
        try {
            // Anchor at start, matches from beginning of string
            const pattern = resourceDirectoryRegex.startsWith("^")
                ? resourceDirectoryRegex
                : `^(?:${resourceDirectoryRegex})`;
            const regex = new RegExp(pattern, "i");
            for (let i = 0; i < subdivisionParts.length; i++) {
                if (regex.test(subdivisionParts[i])) {
                    return i;
                }
            }
        } catch {
            // Invalid regex pattern — treat as no match
        }
        return -1;
    }

    /**
     * Removes all occurrences of configured resource markers from a given path string.
     * @param pathStr The path string to clean
     * @param configuredResourceMarkers Optional marker list to use instead of reading settings.
     * @returns The cleaned path string with resource markers removed
     */
    private removeResourceMarkersFromPathString(pathStr: string, configuredResourceMarkers?: string[]): string {
        const resourceMarkers =
            configuredResourceMarkers ?? getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_RESOURCE_MARKER);
        if (!resourceMarkers || resourceMarkers.length === 0) {
            return pathStr;
        }

        let cleanedPath = pathStr;
        for (const marker of resourceMarkers) {
            if (typeof marker === "string" && marker.length > 0) {
                try {
                    const escapedMarker = marker.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
                    const regex = new RegExp(escapedMarker, "g");
                    cleanedPath = cleanedPath.replace(regex, "");
                } catch (regexError) {
                    this.logger.warn(
                        `[ResourceFileService] Invalid regex pattern for marker "${marker}": ${regexError}`
                    );
                    // Fallback to simple string replacement
                    try {
                        const fallbackRegex = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
                        cleanedPath = cleanedPath.replace(fallbackRegex, "");
                    } catch (fallbackError) {
                        this.logger.warn(
                            `[ResourceFileService] Fallback regex also failed for marker "${marker}": ${fallbackError}`
                        );
                        // Skip this marker if fallback fails
                    }
                }
            }
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

        return resourceMarkers.some(
            (marker) => typeof marker === "string" && marker.length > 0 && str.includes(marker)
        );
    }

    /**
     * Ensures a file exists at the specified path, creating it with initial content if it doesn't.
     * Parent directories will also be created if they don't exist.
     * @param filePath The absolute path of the file to ensure.
     * @param initialContent The content to write if the file is created.
     */
    public async ensureFileExists(filePath: string, initialContent: string): Promise<void> {
        if (!(await this.pathExists(filePath))) {
            this.logger.debug(`[ResourceFileService] Resource file not found. Starting creation at '${filePath}'.`);
            const dirName = path.dirname(filePath);
            await this.ensureFolderPathExists(dirName);
            try {
                await fs.promises.writeFile(filePath, initialContent, { encoding: "utf8" });
                this.logger.info(`[ResourceFileService] Robot Framework resource file created at '${filePath}'.`);
            } catch (writeError: any) {
                this.logger.error(`[ResourceFileService] Error writing to resource file ${filePath}:`, writeError);
                throw new Error(`Failed to create resource file: ${writeError.message}`);
            }
        } else {
            this.logger.debug(
                `[ResourceFileService] Resource file already exists, content not overwritten: ${filePath}`
            );
        }
    }

    /**
     * Constructs the absolute for the resource file to be created using the hierarchical name of tree,
     * respecting the configured Resource Directory Marker and Resource Directory Path.
     *
     * When a Resource Directory Marker is found in the hierarchical name, the folder structure below the marker
     * is preserved and mapped under the Resource Directory Path.
     * When a marker is configured but not found in the hierarchical name, the resource file is created directly
     * under the Resource Directory Path without preserving the folder hierarchy.
     * When no marker is configured at all, the full folder hierarchy is preserved under the Resource Directory Path.
     * @param hierarchicalName The slash-separated hierarchical name (e.g., "Folder/SubFolder/MyResource").
     * @returns {Promise<string | undefined>} The absolute path or undefined if workspace root is not found.
     */
    public async constructAbsolutePath(hierarchicalName: string): Promise<string | undefined> {
        if (!hierarchicalName.trim()) {
            this.logger.error("[ResourceFileService] Hierarchical name is empty. Cannot construct absolute path.");
            return undefined;
        }

        const settings = this.getPathResolutionSettings();
        const cacheKey = this.buildConstructedPathCacheKey(hierarchicalName, settings);
        const cachedPath = this.constructedPathCache.get(cacheKey);
        if (cachedPath) {
            return cachedPath;
        }

        const workspaceRootPath = await validateAndReturnWorkspaceLocation();
        if (!workspaceRootPath) {
            return undefined;
        }

        const cleanedHierarchical = this.removeResourceMarkersFromPathString(
            hierarchicalName,
            settings.resourceMarkers
        );
        const splitPathComponents = cleanedHierarchical.split("/");
        const normalizedPathComponents = splitPathComponents.map((component) =>
            ResourceFileService.normalizePath(component)
        );

        let relativePathComponents: string[];

        if (!settings.resourceDirectoryMarker) {
            // No marker configured, preserve full folder hierarchy
            relativePathComponents = normalizedPathComponents;
        } else {
            const resourceDirectoryMarkerIndex = ResourceFileService.findResourceDirectoryMarkerIndex(
                normalizedPathComponents,
                settings.resourceDirectoryMarker
            );

            if (resourceDirectoryMarkerIndex !== -1) {
                // Marker is found, ignore everything up to and including the marker itself
                relativePathComponents = normalizedPathComponents.slice(resourceDirectoryMarkerIndex + 1);
            } else {
                // Marker configured but not found, create resource file directly under resource directory
                relativePathComponents = [normalizedPathComponents[normalizedPathComponents.length - 1]];
            }
        }

        // Filter out empty components that might result from normalization
        relativePathComponents = relativePathComponents.filter((component) => component.length > 0);

        const absolutePathOfResourceFile = path.join(
            workspaceRootPath,
            settings.resourceDirRelativeToWorkspace, // Will be empty if no resource directory is configured
            ...relativePathComponents
        );

        this.constructedPathCache.set(cacheKey, absolutePathOfResourceFile);
        this.pruneConstructedPathCache();

        this.logger.trace(
            `[ResourceFileService] Constructed absolute path for '${hierarchicalName}' with marker='${settings.resourceDirectoryMarker}' and resourceDir='${settings.resourceDirRelativeToWorkspace}' -> ${absolutePathOfResourceFile}`
        );
        return absolutePathOfResourceFile;
    }

    /**
     * Checks if a file or directory exists at the given path.
     * @param filePath The absolute path to check.
     * @param caseSensitiveCheck If true, performs a more rigorous case-sensitive check (mainly for non-Windows).
     * @returns {Promise<boolean>} True if the path exists (respecting case sensitivity if checked).
     */
    public async pathExists(filePath: string, caseSensitiveCheck: boolean = false): Promise<boolean> {
        if (!filePath.trim()) {
            this.logger.warn("[ResourceFileService] Invalid file path provided to pathExists");
            return false;
        }

        try {
            await fs.promises.stat(filePath);

            if (process.platform === "win32" || !caseSensitiveCheck) {
                return true;
            }

            // For case-sensitive systems, verify the exact filename
            const dir = path.dirname(filePath);
            const filename = path.basename(filePath);
            const filesInDir = await fs.promises.readdir(dir);
            return filesInDir.includes(filename);
        } catch (err: any) {
            if (err.code === "ENOENT") {
                this.logger.trace(`[ResourceFileService] Path does not exist: ${filePath}`);
                return false;
            }
            if (err.code === "EACCES") {
                this.logger.warn(`[ResourceFileService] Permission denied accessing path: ${filePath}`);
                return false;
            }
            this.logger.error(`[ResourceFileService] Error stating file/dir "${filePath}": ${err.message}`);
            throw err;
        }
    }

    /**
     * Checks if a directory exists at the given path.
     * @param dirPath The absolute path to check.
     * @returns {Promise<boolean>} True if the directory exists.
     */
    public async directoryExists(dirPath: string): Promise<boolean> {
        if (!dirPath.trim()) {
            this.logger.warn("[ResourceFileService] Invalid directory path provided to directoryExists");
            return false;
        }

        try {
            const stats = await fs.promises.stat(dirPath);
            return stats.isDirectory();
        } catch (err: any) {
            if (err.code === "ENOENT") {
                this.logger.debug(`[ResourceFileService] Directory does not exist: ${dirPath}`);
                return false;
            }
            if (err.code === "EACCES") {
                this.logger.warn(`[ResourceFileService] Permission denied accessing directory: ${dirPath}`);
                return false;
            }
            this.logger.error(`[ResourceFileService] Error stating directory "${dirPath}": ${err.message}`);
            throw err;
        }
    }

    /**
     * Checks if a file exists at the given path.
     * @param filePath The absolute path to check.
     * @returns {Promise<boolean>} True if the file exists.
     */
    public async fileExists(filePath: string): Promise<boolean> {
        if (!filePath.trim()) {
            this.logger.warn("[ResourceFileService] Invalid file path provided to fileExists");
            return false;
        }

        try {
            const stats = await fs.promises.stat(filePath);
            return stats.isFile();
        } catch (err: any) {
            if (err.code === "ENOENT") {
                this.logger.debug(`[ResourceFileService] File does not exist: ${filePath}`);
                return false;
            }
            if (err.code === "EACCES") {
                this.logger.warn(`[ResourceFileService] Permission denied accessing file: ${filePath}`);
                return false;
            }
            this.logger.error(`[ResourceFileService] Error stating file "${filePath}": ${err.message}`);
            throw err;
        }
    }

    /**
     * Ensures that a folder exists at the specified path, creating it if necessary.
     * @param folderPath The absolute path of the folder to ensure.
     * @returns {Promise<void>}
     */
    public async ensureFolderPathExists(folderPath: string): Promise<void> {
        if (!folderPath.trim()) {
            throw new Error("Folder path must be a non-empty string");
        }

        try {
            await fs.promises.mkdir(folderPath, { recursive: true });
        } catch (error: any) {
            if (error.code === "EACCES") {
                this.logger.error(`[ResourceFileService] Permission denied while creating folder: "${folderPath}"`);
                throw new Error(`Permission denied while creating folder: ${folderPath}`);
            }
            this.logger.error(
                `[ResourceFileService] Failed to create folder path: "${folderPath}": ${error.message}`,
                error
            );
            throw new Error(`Failed to create folder: ${error.message}`);
        }
    }
}
