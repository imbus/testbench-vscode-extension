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

/**
 * Delays execution for a given number of milliseconds.
 *
 * @param {number} milliseconds - The number of milliseconds to delay.
 * @returns A promise that resolves after the delay.
 */
export function delay(milliseconds: number): Promise<void> {
    logger.trace(`Waiting for ${milliseconds} milliseconds for job completion.`);
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
        if (verifyExistenceOfFile) {
            logger.trace(`Checking if "${filePath}" is an absolute path and verifying it exists.`);
        } else {
            logger.trace(`Checking if "${filePath}" is an absolute path.`);
        }
        if (!path.isAbsolute(filePath)) {
            logger.trace(`"${filePath}" is not an absolute path.`);
            return false;
        }
        if (verifyExistenceOfFile) {
            await fsPromises.access(filePath);
        }

        if (verifyExistenceOfFile) {
            logger.trace(`"${filePath}" is an absolute path and it exists.`);
        } else {
            logger.trace(`"${filePath}" is an absolute path.`);
        }
        return true;
    } catch {
        if (!verifyExistenceOfFile) {
            logger.trace(`"${filePath}" is not an absolute path.`);
        } else {
            logger.trace(`"${filePath}" is not an absolute path or the file does not exist.`);
        }
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
        logger.error("Relative path is not set while constructing an absolute path.");
        return null;
    }

    const workspaceLocation: string | undefined = await validateAndReturnWorkspaceLocation();
    if (!workspaceLocation) {
        logger.error("Workspace location was not set while constructing an absolute path.");
        return null;
    }

    const absolutePath: string = path.join(workspaceLocation, relativePath);

    if (!(await isAbsolutePath(absolutePath, verifyExistenceOfFile))) {
        return null;
    }

    logger.trace(`Constructed absolute path: "${absolutePath}"`);
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
    logger.debug(`Deleting directory recursively: "${directoryPathToDelete}"`);
    logger.debug("Excluded folders:", excludedFoldersFromDeletion);

    try {
        const files = await fsPromises.readdir(directoryPathToDelete);

        for (const file of files) {
            const currentPath: string = path.join(directoryPathToDelete, file);

            // Skip files or folders that are excluded.
            if (excludedFoldersFromDeletion.includes(file)) {
                logger.trace(`Skipped deleting excluded item: "${file}"`);
                continue;
            }

            const fileStats = await fsPromises.stat(currentPath);
            if (fileStats.isDirectory()) {
                // Recursively delete subdirectories.
                await deleteDirectoryRecursively(currentPath, excludedFoldersFromDeletion);
            } else {
                logger.debug(`Deleting file: "${currentPath}"`);
                await fsPromises.unlink(currentPath);
            }
        }

        // Remove the directory itself unless it is excluded.
        const folderName: string = path.basename(directoryPathToDelete);
        if (!excludedFoldersFromDeletion.includes(folderName)) {
            logger.debug(`Deleting directory: "${directoryPathToDelete}"`);
            await fsPromises.rmdir(directoryPathToDelete);
        }
    } catch (error: any) {
        logger.error(
            `Failed to delete directory "${directoryPathToDelete}": ${error.message} (deleteDirectoryRecursively)`
        );
        return null;
    }
}

/**
 * Clears the contents of a workspace folder after user confirmation, excluding specified folders.
 *
 * @param workspaceLocationToClear - The absolute path of the workspace folder to clear.
 * @param excludedFoldersFromDeletion - An array of folder names to exclude from deletion.
 * @param promptForConfirmation - If true, prompts the user for confirmation before deletion.
 * @returns A promise that resolves when the folder is cleared, or null if an error occurs or the operation is cancelled.
 */
export async function clearInternalTestbenchFolder(
    workspaceLocationToClear: string,
    excludedFoldersFromDeletion: string[] = [],
    promptForConfirmation: boolean = true
): Promise<void | null> {
    logger.debug(`Clearing workspace folder: "${workspaceLocationToClear}"`);

    try {
        // Verify that the given path exists and is a directory.
        try {
            const stats = await fsPromises.stat(workspaceLocationToClear);
            if (!stats.isDirectory()) {
                const notADirectoryMsg: string = `The path "${workspaceLocationToClear}" is not a directory. Cannot clear workspace folder.`;
                vscode.window.showErrorMessage(notADirectoryMsg);
                logger.error(notADirectoryMsg);
                return null;
            }
        } catch {
            const folderNotExistMsg: string = `The folder at path "${workspaceLocationToClear}" does not exist. Cannot clear workspace folder.`;
            vscode.window.showErrorMessage(folderNotExistMsg);
            logger.error(folderNotExistMsg);
            return null;
        }

        // Optionally prompt the user for confirmation.
        if (promptForConfirmation) {
            const userResponse = await vscode.window.showWarningMessage(
                "Are you sure you want to delete all contents of the testbench folder? Log files will not be deleted.",
                { modal: true },
                "Yes",
                "No"
            );
            if (userResponse !== "Yes") {
                logger.debug("User cancelled the clear workspace folder operation.");
                return null;
            }
        }

        // Process the contents of the folder.
        const files: string[] = await fsPromises.readdir(workspaceLocationToClear);
        for (const file of files) {
            const filePath: string = path.join(workspaceLocationToClear, file);

            if (excludedFoldersFromDeletion.includes(file)) {
                logger.trace(`Skipped deleting excluded item: "${file}"`);
                continue;
            }

            const fileStats = await fsPromises.stat(filePath);
            if (fileStats.isDirectory()) {
                await deleteDirectoryRecursively(filePath, excludedFoldersFromDeletion);
            } else {
                await fsPromises.unlink(filePath);
            }
        }

        logger.debug(`Workspace folder cleared successfully: "${workspaceLocationToClear}"`);
    } catch (error: any) {
        const errorMsg: string = `An error occurred while clearing the workspace folder: ${error.message}`;
        vscode.window.showErrorMessage(errorMsg);
        logger.error(errorMsg);
        return null;
    }
}

/**
 * Validates and returns the active workspace location.
 *
 * If a file is active in the editor, returns the workspace folder associated with that file.
 * Otherwise falls back to the first available workspace folder, and if still unavailable, uses the user's home directory.
 *
 * @param {boolean} enableLogging - Whether to output trace logging (defaults to true).
 * @returns {Promise<string | undefined>} A promise that resolves to the workspace location string, or undefined if nothing is found.
 */
export async function validateAndReturnWorkspaceLocation(enableLogging: boolean = true): Promise<string | undefined> {
    if (logger && enableLogging) {
        logger.trace("Validating and returning active workspace location.");
    }

    // Check for an active editor and its workspace folder.
    const activeEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
    if (activeEditor) {
        const workspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(
            activeEditor.document.uri
        );
        if (workspaceFolder) {
            if (logger && enableLogging) {
                logger.trace(`Active workspace found: "${workspaceFolder.uri.fsPath}"`);
            }
            return workspaceFolder.uri.fsPath;
        }
    }

    // Fallback: use the first workspace folder in the array.
    const workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        if (logger && enableLogging) {
            logger.trace(
                `No active editor; falling back to first workspace folder: "${workspaceFolders[0].uri.fsPath}"`
            );
        }
        return workspaceFolders[0].uri.fsPath;
    }

    // Fallback: use the user's home directory as a safe option.
    const homeDirectory: string = os.homedir();
    if (logger && enableLogging) {
        logger.trace(`No workspace available; falling back to user's home directory: "${homeDirectory}"`);
    }

    if (!homeDirectory) {
        const workspaceLocationMissingError: string = "Unable to determine workspace location or home directory.";
        logger.error(workspaceLocationMissingError);
        vscode.window.showErrorMessage(workspaceLocationMissingError);
        return undefined;
    }

    return homeDirectory;
}

/**
 * Checks asynchronously whether a file exists at the given path.
 *
 * @param {string} filePath - The file path to check.
 * @returns {Promise<boolean>} A promise that resolves to true if the file exists, otherwise false.
 */
export async function fileExistsAsync(filePath: string): Promise<boolean> {
    try {
        await fsPromises.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Saves JSON data to a file.
 * Useful for analyzing server responses.
 *
 * @param {string} filePath - The file path to save the JSON data.
 * @param {any} data - The JSON data to save.
 */
export function saveJsonDataToFile(filePath: string, data: any): void {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        logger.trace(`JSON data saved to file: ${filePath}`);
    } catch (error: any) {
        logger.error(`Error saving JSON data to ${filePath}: ${error.message}`);
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
        logger.error(`Error reading or parsing ${fileName}:`, error);
        return null;
    }
}
