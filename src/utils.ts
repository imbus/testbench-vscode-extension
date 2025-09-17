/**
 * @file utils.ts
 * @description Utility functions for the TestBench VS Code extension.
 */

import { logger } from "./extension";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import JSZip from "jszip";
import { folderNameOfInternalTestbenchFolder } from "./constants";

// Module-level variable to cache the workspace location selection.
let cachedWorkspaceLocation: string | undefined;

/**
 * Delays execution for a given number of milliseconds.
 *
 * @param {number} milliseconds - The number of milliseconds to delay.
 * @returns A promise that resolves after the delay.
 */
export function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Checks whether a given path is absolute and, optionally, whether it exists.
 *
 * @param {string} filePath - The path to check.
 * @param {boolean} verifyExistenceOfFile - If true, verifies that the path exists.
 * @returns {Promise<boolean>} A promise that resolves to true if the path is absolute (and exists when required), otherwise false.
 */
export async function isAbsolutePath(filePath: string, verifyExistenceOfFile: boolean = false): Promise<boolean> {
    try {
        if (!path.isAbsolute(filePath)) {
            logger.warn(`[utils] File path "${filePath}" is not absolute.`);
            return false;
        }
        if (verifyExistenceOfFile) {
            await fsPromises.access(filePath);
        }
        logger.trace(`[utils] File path "${filePath}" is absolute.`);
        return true;
    } catch (error) {
        logger.trace(`[utils] Error while checking if file path "${filePath}" is absolute:`, error);
        return false;
    }
}

/**
 * Constructs an absolute path from a relative path based on the workspace location.
 *
 * @param {string | undefined} relativePath - The relative path.
 * @param {boolean} verifyExistenceOfFile - If true, verifies that the constructed path exists.
 * @returns {Promise<string | null>} A promise that resolves to the absolute path string, or null if the relative path or workspace location is not set or invalid.
 */
export async function constructAbsolutePathFromRelativePath(
    relativePath: string | undefined,
    verifyExistenceOfFile: boolean = false
): Promise<string | null> {
    if (!relativePath) {
        logger.error("[utils] Relative path is not set while constructing an absolute path.");
        return null;
    }

    const workspaceLocation: string | undefined = await validateAndReturnWorkspaceLocation();
    if (!workspaceLocation) {
        return null;
    }

    const absolutePath: string = path.join(workspaceLocation, relativePath);

    if (!(await isAbsolutePath(absolutePath, verifyExistenceOfFile))) {
        return null;
    }

    logger.trace(`[utils] Constructed absolute path "${absolutePath}" from relative path "${relativePath}"`);
    return absolutePath;
}

/**
 * Recursively deletes a directory and its contents, excluding specified folders.
 *
 * @param {string} directoryPathToDelete - The directory path to delete.
 * @param {string[]} excludedFoldersFromDeletion - An array of folder names to exclude from deletion.
 * @returns {Promise<void | null>} A promise that resolves when deletion is complete, or null if an error occurs.
 */
export async function deleteDirectoryRecursively(
    directoryPathToDelete: string,
    excludedFoldersFromDeletion: string[]
): Promise<void | null> {
    logger.debug(
        `[utils] Deleting directory recursively: "${directoryPathToDelete}", excluded folders from recursive deletion: ${excludedFoldersFromDeletion}`
    );

    try {
        const files: string[] = await fsPromises.readdir(directoryPathToDelete);

        for (const file of files) {
            const currentPath: string = path.join(directoryPathToDelete, file);

            if (excludedFoldersFromDeletion.includes(file)) {
                continue;
            }

            const fileStats: fs.Stats = await fsPromises.stat(currentPath);
            if (fileStats.isDirectory()) {
                await deleteDirectoryRecursively(currentPath, excludedFoldersFromDeletion);
            } else {
                logger.debug(`[utils] Deleting file: "${currentPath}"`);
                await fsPromises.unlink(currentPath);
            }
        }

        // Remove the directory itself
        const folderName: string = path.basename(directoryPathToDelete);
        if (!excludedFoldersFromDeletion.includes(folderName)) {
            logger.debug(`[utils] Deleting directory: "${directoryPathToDelete}"`);
            await fsPromises.rmdir(directoryPathToDelete);
        }
    } catch (error: any) {
        logger.error(`[utils] Failed to delete directory "${directoryPathToDelete}": ${error.message}`);
        return null;
    }
}

/**
 * Clears the contents of a workspace folder after user confirmation, excluding specified folders.
 *
 * @param {string} workspaceLocationToClear - The absolute path of the workspace folder to clear.
 * @param {string[]} excludedFoldersFromDeletion - An array of folder names to exclude from deletion.
 * @param {boolean} promptForConfirmation - If true, prompts the user for confirmation before deletion.
 * @returns {Promise<void | null>} A promise that resolves when the folder is cleared, or null if an error occurs or the operation is cancelled.
 */
export async function clearInternalTestbenchFolder(
    workspaceLocationToClear: string,
    excludedFoldersFromDeletion: string[] = [],
    promptForConfirmation: boolean = true
): Promise<void | null> {
    try {
        try {
            const stats: fs.Stats = await fsPromises.stat(workspaceLocationToClear);
            if (!stats.isDirectory()) {
                const notADirectoryMsg: string = `The path "${workspaceLocationToClear}" is not a directory. Cannot clear workspace folder.`;
                vscode.window.showErrorMessage(notADirectoryMsg);
                logger.error(`[utils] ${notADirectoryMsg}`);
                return null;
            }
        } catch {
            const folderNotExistMsg: string = `The folder at path "${workspaceLocationToClear}" does not exist. Cannot clear workspace folder.`;
            vscode.window.showErrorMessage(folderNotExistMsg);
            logger.error(`[utils] ${folderNotExistMsg}`);
            return null;
        }

        if (promptForConfirmation) {
            const userResponse = await vscode.window.showWarningMessage(
                `Are you sure you want to delete all contents of the ${folderNameOfInternalTestbenchFolder} folder? Log files will not be deleted.`,
                { modal: true },
                "Yes",
                "No"
            );
            if (userResponse !== "Yes") {
                return null;
            }
        }

        const clearFolderOperation = async (progress?: vscode.Progress<{ increment?: number; message?: string }>) => {
            const files: string[] = await fsPromises.readdir(workspaceLocationToClear);
            const totalFiles: number = files.length;
            let processedFiles: number = 0;

            for (const file of files) {
                processedFiles++;
                const increment: number = (1 / totalFiles) * 100;
                progress?.report({
                    increment,
                    message: `Processing ${file}... (${processedFiles}/${totalFiles})`
                });

                const filePath: string = path.join(workspaceLocationToClear, file);

                if (excludedFoldersFromDeletion.includes(file)) {
                    continue;
                }

                const fileStats: fs.Stats = await fsPromises.stat(filePath);
                if (fileStats.isDirectory()) {
                    await deleteDirectoryRecursively(filePath, excludedFoldersFromDeletion);
                } else {
                    await fsPromises.unlink(filePath);
                }
            }
        };

        const useProgressBarWhileClearing = false;
        if (useProgressBarWhileClearing) {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Clearing ${folderNameOfInternalTestbenchFolder}`,
                    cancellable: true
                },
                clearFolderOperation
            );
        } else {
            await clearFolderOperation();
        }

        logger.debug(`[utils] Internal testbench folder "${workspaceLocationToClear}" cleared successfully`);
        // vscode.window.showInformationMessage(`${folderNameOfInternalTestbenchFolder} folder cleared successfully.`);
    } catch (error: any) {
        const errorMsg: string = `An error occurred while clearing the workspace folder: ${error.message}`;
        vscode.window.showErrorMessage(errorMsg);
        logger.error(`[utils] ${errorMsg}`);
        return null;
    }
}

/**
 * Validates and returns the active workspace location.
 *
 * This function attempts to determine the current workspace in the following order:
 * 1. The workspace folder containing the currently active text editor.
 * 2. A previously cached workspace location, if it still exists.
 * 3. The first workspace folder if multiple are open and no active editor or cache is available.
 * 4. The user's home directory as a last resort.
 *
 * If a workspace location is found, it is cached for subsequent calls.
 * If no workspace or home directory can be determined, an error is logged and displayed,
 * and the function returns `undefined`.
 *
 * The user can set workspace manually using the 'Set Workspace' command.
 *
 * @param enableLogging - Optional. If `true` (default), logs trace, warning, and error messages during execution.
 * @returns A promise that resolves to the file system path of the determined workspace location,
 * or `undefined` if no suitable location can be found.
 */
export async function validateAndReturnWorkspaceLocation(enableLogging: boolean = false): Promise<string | undefined> {
    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (activeEditor) {
        const workspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(
            activeEditor.document.uri
        );
        if (workspaceFolder) {
            if (logger && enableLogging) {
                logger.trace(`[utils] Active workspace found: "${workspaceFolder.uri.fsPath}"`);
            }
            cachedWorkspaceLocation = workspaceFolder.uri.fsPath;
            return workspaceFolder.uri.fsPath;
        }
    }

    if (cachedWorkspaceLocation) {
        const isWorkspaceFolderPresent: boolean | undefined = vscode.workspace.workspaceFolders?.some(
            (folder) => folder.uri.fsPath === cachedWorkspaceLocation
        );
        if (isWorkspaceFolderPresent) {
            if (logger && enableLogging) {
                logger.trace(`[utils] Returning cached workspace location: "${cachedWorkspaceLocation}"`);
            }
            return cachedWorkspaceLocation;
        } else {
            if (logger && enableLogging) {
                logger.warn(
                    `[utils] Cached workspace location "${cachedWorkspaceLocation}" no longer exists. Clearing cache.`
                );
            }
            cachedWorkspaceLocation = undefined;
        }
    }

    const workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        if (workspaceFolders.length >= 1) {
            cachedWorkspaceLocation = workspaceFolders[0].uri.fsPath;
            if (logger && enableLogging) {
                if (workspaceFolders.length > 1) {
                    logger.trace(
                        `[utils] Multiple workspaces found and no active/cached preference; defaulting to first workspace: "${cachedWorkspaceLocation}"`
                    );
                } else {
                    logger.trace(`[utils] Using single available workspace folder: "${cachedWorkspaceLocation}"`);
                }
            }
            return cachedWorkspaceLocation;
        }
    }

    const homeDirectory: string = os.homedir();
    if (logger && enableLogging) {
        logger.trace(`[utils] No workspace available; falling back to user's home directory: "${homeDirectory}"`);
    }

    if (!homeDirectory) {
        const workspaceLocationMissingError: string = "Unable to determine workspace location or home directory.";
        logger.error(`[utils] ${workspaceLocationMissingError}`);
        vscode.window.showErrorMessage(workspaceLocationMissingError);
        return undefined;
    }

    return homeDirectory;
}

/**
 * Saves JSON data to a file.
 * Used for analyzing server responses.
 *
 * @param {string} filePath - The file path to save the JSON data.
 * @param {any} data - The JSON data to save.
 */
export function saveJsonDataToFile(filePath: string, data: any): void {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        logger.trace(`[utils] JSON data saved to file: ${filePath}`);
    } catch (error: any) {
        logger.error(`[utils] Error saving JSON data to ${filePath}: ${error.message}`);
    }
}

/**
 * Extracts and parses JSON content from a zip file.
 *
 * @param {JSZip} zipContents - The loaded JSZip object.
 * @param {string} fileName - The file name to extract.
 * @returns {Promise<any>} The parsed JSON content, or null if an error occurs.
 */
export async function extractAndParseJsonContent(zipContents: JSZip, fileName: string): Promise<any> {
    try {
        const fileData: string | undefined = await zipContents.file(fileName)?.async("string");
        return fileData ? JSON.parse(fileData) : null;
    } catch (error) {
        logger.error(`[utils] Error reading or parsing file "${fileName}":`, error);
        return null;
    }
}

/**
 * For windows systems, sanitizes a file path string by replacing invalid characters with underscores.
 * Special characters are technically allowed in file names on Unix-based systems.
 *
 * @param {string} filePath - The file path to sanitize.
 * @returns {string} The sanitized file path.
 */
export function sanitizeFilePath(filePath: string): string {
    if (!filePath) {
        return "";
    }
    if (os.platform() === "win32") {
        const sanitizedPath = filePath.replace(/[<>:"/\\|?*]/g, "_");
        return sanitizedPath;
    }
    return filePath;
}
