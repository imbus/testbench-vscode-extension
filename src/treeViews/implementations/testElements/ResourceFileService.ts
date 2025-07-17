/**
 * @file src/treeViews/implementations/testElements/ResourceFileService.ts
 * @description Service for managing resource files related to Test Elements Tree.
 */

import * as fs from "fs";
import * as path from "path";
import { TestBenchLogger } from "../../../testBenchLogger";
import { validateAndReturnWorkspaceLocation } from "../../../utils";
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
     * Removes all occurrences of "[Robot-Resource]" from a given path string.
     */
    private removeRobotResourceFromPathString(pathStr: string): string {
        const cleanedPath: string = pathStr.replace(/\[Robot-Resource\]/g, "");
        return cleanedPath;
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
                this.logger.info(`[ResourceFileService] Resource file with initial content created: ${filePath}`);
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
     * Constructs an absolute path for a resource given its hierarchical name.
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
        const absolutePath = path.join(workspaceRootPath, hierarchicalName);
        this.logger.trace(`[ResourceFileService] Constructed absolute path for '${hierarchicalName}': ${absolutePath}`);
        return absolutePath;
    }

    /**
     * Checks if a file or directory exists at the given path.
     * @param filePath The absolute path to check.
     * @param caseSensitiveCheck If true, performs a more rigorous case-sensitive check (mainly for non-Windows).
     * @returns {Promise<boolean>} True if the path exists (respecting case sensitivity if checked).
     */
    public async pathExists(filePath: string, caseSensitiveCheck: boolean = false): Promise<boolean> {
        // Remove [Robot-Resource] suffix before checking
        const cleanedPath = this.removeRobotResourceFromPathString(filePath);
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
                this.logger.debug(`[ResourceFileService] Path does not exist: ${cleanedPath}`);
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
        const cleanedPath = this.removeRobotResourceFromPathString(dirPath);
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
        const cleanedPath = this.removeRobotResourceFromPathString(filePath);
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
        // Remove [Robot-Resource] suffix before creating folder
        const cleanedPath = this.removeRobotResourceFromPathString(folderPath);

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
