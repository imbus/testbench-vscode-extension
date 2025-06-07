/**
 * @file src/views/testElements/resourceFileService.ts
 * @description Service for managing resource files related to Test Elements Tree.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { TestBenchLogger } from "../../testBenchLogger";
import * as utils from "../../utils";

export class ResourceFileService {
    constructor(private readonly logger: TestBenchLogger) {}

    /**
     * Gets the validated workspace root path.
     * @returns {Promise<string | undefined>} The workspace path or undefined if not available.
     */
    private async getWorkspaceRootPath(): Promise<string | undefined> {
        const workspaceRoot = await utils.validateAndReturnWorkspaceLocation();
        if (!workspaceRoot) {
            this.logger.error("[ResourceFileService] Workspace root path not found.");
            vscode.window.showErrorMessage("Workspace root not found. Please open a folder or workspace.");
        }
        return workspaceRoot;
    }

    /**
     * Constructs an absolute path for a resource given its hierarchical name.
     * Based on original `constructAbsolutePathForTestElement`
     * @param hierarchicalName The slash-separated hierarchical name (e.g., "Folder/SubFolder/MyResource").
     * @returns {Promise<string | undefined>} The absolute path or undefined if workspace root is not found.
     */
    public async constructAbsolutePath(hierarchicalName: string): Promise<string | undefined> {
        const workspaceRootPath = await this.getWorkspaceRootPath();
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
     * Offers case-sensitive check primarily for non-Windows systems if strictness is needed.
     * Based on original `isFilePresentLocally`
     * @param filePath The absolute path to check.
     * @param caseSensitiveCheck If true, performs a more rigorous case-sensitive check (mainly for non-Windows).
     * @returns {Promise<boolean>} True if the path exists (respecting case sensitivity if checked).
     */
    public async pathExists(filePath: string, caseSensitiveCheck: boolean = false): Promise<boolean> {
        this.logger.trace(
            `[ResourceFileService] Checking if path exists: ${filePath}, CaseSensitive: ${caseSensitiveCheck}`
        );
        try {
            await fs.promises.stat(filePath);
            if (process.platform === "win32" || !caseSensitiveCheck) {
                // this.logger.trace(`[ResourceFileService] Path exists (basic check): ${filePath}`);
                return true;
            }

            const dir = path.dirname(filePath);
            const filename = path.basename(filePath);
            const filesInDir = await fs.promises.readdir(dir);
            const existsWithCorrectCase = filesInDir.includes(filename);
            // this.logger.trace(`[ResourceFileService] Path exists (case-sensitive check: ${existsWithCorrectCase}): ${filePath}`);
            return existsWithCorrectCase;
        } catch (err: any) {
            if (err.code === "ENOENT") {
                this.logger.trace(`[ResourceFileService] Path does not exist: ${filePath}`);
                return false;
            }
            this.logger.error(`[ResourceFileService] Error stating file/dir "${filePath}": ${err.message}`);
            throw err;
        }
    }

    /**
     * Ensures that a folder exists at the specified path, creating it if necessary.
     * Based on original `createFolderStructure`
     * @param folderPath The absolute path of the folder to ensure.
     * @returns {Promise<void>}
     */
    public async ensureFolderPathExists(folderPath: string): Promise<void> {
        // this.logger.trace(`[ResourceFileService] Ensuring folder path exists: ${folderPath}`);
        try {
            // `recursive: true` will not throw an error if the directory already exists.
            // It will also create parent directories if they don't exist.
            await fs.promises.mkdir(folderPath, { recursive: true });
            // this.logger.trace(`[ResourceFileService] Folder path ensured (created or already existed): ${folderPath}`);
        } catch (error: any) {
            this.logger.error(
                `[ResourceFileService] Failed to ensure folder path "${folderPath}": ${error.message}`,
                error
            );
            throw error;
        }
    }

    /**
     * Ensures a file exists at the specified path, creating it with initial content if it doesn't.
     * Parent directories will also be created if they don't exist.
     * @param filePath The absolute path of the file to ensure.
     * @param initialContent The content to write if the file is created.
     * @returns {Promise<void>}
     */
    public async ensureFileExists(filePath: string, initialContent: string): Promise<void> {
        // this.logger.trace(`[ResourceFileService] Ensuring file exists: ${filePath}`);
        // this.logger.trace(`[ResourceFileService] Initial content for new file (length ${initialContent.length}):\n${initialContent.substring(0, 100)}...`);

        if (!(await this.pathExists(filePath))) {
            this.logger.debug(`[ResourceFileService] File not found. Creating: ${filePath}`);
            const dirName = path.dirname(filePath);
            await this.ensureFolderPathExists(dirName);
            try {
                // this.logger.trace(`[ResourceFileService] Attempting to write file: ${filePath}`);
                await fs.promises.writeFile(filePath, initialContent, { encoding: "utf8" });
                this.logger.info(`[ResourceFileService] File created and content written: ${filePath}`);
            } catch (writeError) {
                this.logger.error(`[ResourceFileService] Error writing file ${filePath}:`, writeError);
                throw writeError;
            }
        } else {
            this.logger.trace(
                `[ResourceFileService] File already exists, content not overwritten by ensureFileExists: ${filePath}`
            );
        }
    }

    /**
     * Opens the specified file in the VS Code editor.
     * @param filePath The absolute path of the file to open.
     * @returns {Promise<void>}
     */
    public async openFileInEditor(filePath: string): Promise<void> {
        // this.logger.trace(`[ResourceFileService] Opening file in editor: ${filePath}`);
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(document);
        } catch (error: any) {
            this.logger.error(
                `[ResourceFileService] Failed to open file "${filePath}" in editor: ${error.message}`,
                error
            );
            vscode.window.showErrorMessage(`Failed to open file: ${path.basename(filePath)}`);
        }
    }
}
