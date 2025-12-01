/**
 * @file src/treeViews/implementations/testElements/ResourceFileService.ts
 * @description Service for managing resource files related to Test Elements Tree.
 */

import * as vscode from "vscode";
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
    constructor(private readonly logger: TestBenchLogger) {}

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
        const workspaceRootPath = await validateAndReturnWorkspaceLocation();
        if (!workspaceRootPath) {
            return undefined;
        }

        if (!hierarchicalName.trim()) {
            this.logger.error("[ResourceFileService] Hierarchical name is empty. Cannot construct absolute path.");
            return undefined;
        }

        const resourceDirRelativeToWorkspace = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_DIR) || "";
        const resourceDirectoryMarker =
            getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_DIRECTORY_MARKER) || "";

        const cleanedHierarchical = this.removeResourceMarkersFromPathString(hierarchicalName);
        const splitPathComponents = cleanedHierarchical.split("/");
        const normalizedPathComponents = splitPathComponents.map((component) =>
            ResourceFileService.normalizePath(component)
        );

        let relativePathComponents: string[];

        if (resourceDirectoryMarker) {
            const resourceDirectoryMarkerIndex: number = await vscode.commands.executeCommand(
                "testbench_ls.get_resource_directory_subdivision_index",
                {
                    subdivision_parts: normalizedPathComponents,
                    resource_directory_regex: resourceDirectoryMarker
                }
            );

            if (resourceDirectoryMarkerIndex !== -1) {
                // Marker is found, ignore everything up to and including the marker itself
                relativePathComponents = normalizedPathComponents.slice(resourceDirectoryMarkerIndex + 1);
            } else {
                // No marker match, create resource file directly under resource directory without subdivision folder hierarchy
                relativePathComponents = [normalizedPathComponents[normalizedPathComponents.length - 1]];
            }
        } else {
            relativePathComponents = normalizedPathComponents;
        }

        // Filter out empty components that might result from normalization
        relativePathComponents = relativePathComponents.filter((component) => component.length > 0);

        const absolutePathOfResourceFile = path.join(
            workspaceRootPath,
            resourceDirRelativeToWorkspace, // Will be empty if no resource directory is configured
            ...relativePathComponents
        );

        this.logger.trace(
            `[ResourceFileService] Constructed absolute path for '${hierarchicalName}' with marker='${resourceDirectoryMarker}' and resourceDir='${resourceDirRelativeToWorkspace}' -> ${absolutePathOfResourceFile}`
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
            if (err.code === "EACCES") {
                this.logger.warn(`[ResourceFileService] Permission denied accessing path: ${cleanedPath}`);
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
        if (!dirPath.trim()) {
            this.logger.warn("[ResourceFileService] Invalid directory path provided to directoryExists");
            return false;
        }

        const cleanedPath = this.removeResourceMarkersFromPathString(dirPath);
        try {
            const stats = await fs.promises.stat(cleanedPath);
            return stats.isDirectory();
        } catch (err: any) {
            if (err.code === "ENOENT") {
                this.logger.debug(`[ResourceFileService] Directory does not exist: ${cleanedPath}`);
                return false;
            }
            if (err.code === "EACCES") {
                this.logger.warn(`[ResourceFileService] Permission denied accessing directory: ${cleanedPath}`);
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
        if (!filePath.trim()) {
            this.logger.warn("[ResourceFileService] Invalid file path provided to fileExists");
            return false;
        }

        const cleanedPath = this.removeResourceMarkersFromPathString(filePath);
        try {
            const stats = await fs.promises.stat(cleanedPath);
            return stats.isFile();
        } catch (err: any) {
            if (err.code === "ENOENT") {
                this.logger.debug(`[ResourceFileService] File does not exist: ${cleanedPath}`);
                return false;
            }
            if (err.code === "EACCES") {
                this.logger.warn(`[ResourceFileService] Permission denied accessing file: ${cleanedPath}`);
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
        if (!folderPath.trim()) {
            throw new Error("Folder path must be a non-empty string");
        }

        const cleanedPath = this.removeResourceMarkersFromPathString(folderPath);

        try {
            await fs.promises.mkdir(cleanedPath, { recursive: true });
        } catch (error: any) {
            if (error.code === "EACCES") {
                this.logger.error(`[ResourceFileService] Permission denied while creating folder: "${cleanedPath}"`);
                throw new Error(`Permission denied while creating folder: ${cleanedPath}`);
            }
            this.logger.error(
                `[ResourceFileService] Failed to create folder path: "${cleanedPath}": ${error.message}`,
                error
            );
            throw new Error(`Failed to create folder: ${error.message}`);
        }
    }

    /**
     * Reads the UID from a resource file's metadata.
     * The metadata is expected to be in the format: `tb:uid:<uid>` on the first line.
     * @param filePath The absolute path to the resource file.
     * @returns Promise resolving to the UID string if found, or undefined if not found or file doesn't exist.
     */
    public async readUidFromResourceFile(filePath: string): Promise<string | undefined> {
        try {
            if (!(await this.fileExists(filePath))) {
                return undefined;
            }

            const fileContent: string = await fs.promises.readFile(filePath, "utf-8");
            const uidMatch: RegExpMatchArray | null = fileContent.match(/^tb:uid:(.+)$/m);
            if (uidMatch) {
                return uidMatch[1].trim();
            }
            return undefined;
        } catch (error: any) {
            this.logger.warn(
                `[ResourceFileService] Error reading UID from resource file ${filePath}: ${error.message}`
            );
            return undefined;
        }
    }

    /**
     * Validates that a resource file matches the expected UID.
     * @param filePath The absolute path to the resource file.
     * @param expectedUid The expected UID.
     * @returns Promise resolving to an object with validation result and details.
     */
    public async validateResourceFileUid(
        filePath: string,
        expectedUid: string
    ): Promise<{ isValid: boolean; fileUid?: string; isMismatch: boolean; fileExists: boolean }> {
        const fileExists: boolean = await this.fileExists(filePath);
        if (!fileExists) {
            return { isValid: false, fileExists: false, isMismatch: false };
        }

        const fileUid: string | undefined = await this.readUidFromResourceFile(filePath);
        if (!fileUid) {
            // File exists but has no UID metadata
            return { isValid: false, fileExists: true, isMismatch: false, fileUid: undefined };
        }

        const isMismatch: boolean = fileUid !== expectedUid;
        return {
            isValid: !isMismatch,
            fileExists: true,
            isMismatch,
            fileUid
        };
    }

    /**
     * Constructs an alternative path for a resource file when a name conflict is detected.
     * Appends the UID to the filename to ensure uniqueness.
     * @param originalPath The original path that has a conflict.
     * @param uid The UID to append to the filename.
     * @returns The alternative path with UID appended before the file extension.
     */
    public constructAlternativePathWithUid(originalPath: string, uid: string): string {
        const extensionOfOriginalPath: string = path.extname(originalPath);
        const basePath: string = originalPath.slice(0, originalPath.length - extensionOfOriginalPath.length);
        return `${basePath}_${uid}${extensionOfOriginalPath}`;
    }
}
