import { allExtensionCommands, getConfig, logger } from "./extension";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

// Wait for a specified number of milliseconds.
export function delay(milliseconds: number): Promise<void> {
    logger.trace(`Waiting for ${milliseconds} milliseconds for Job completion.`);
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Checks if a given path is absolute and optionally verifies its existence.
 * @param filePath The path to check.
 * @param verifyExistenceOfFile If true, verifies that the path exists.
 * @returns True if the path is absolute and (optionally) exists, otherwise false.
 */
export async function isAbsolutePath(filePath: string, verifyExistenceOfFile = false): Promise<boolean> {
    try {
        logger.trace(`Checking if ${filePath} is an absolute path ${verifyExistenceOfFile ? "and exists" : ""}.`);

        if (!path.isAbsolute(filePath)) {
            logger.trace(`${filePath} is not an absolute path.`);
            return false;
        }

        if (verifyExistenceOfFile) {
            await fsPromises.access(filePath);
        }

        logger.trace(`${filePath} is an absolute path ${verifyExistenceOfFile ? "and exists" : ""}.`);
        return true;
    } catch {
        logger.trace(`${filePath} is not an absolute path ${verifyExistenceOfFile ? "or does not exist" : ""}.`);
        return false;
    }
}

/**
 * Constructs an absolute path from a relative path. *
 * @param relativePath The relative path.
 * @param verifyExistenceOfFile If true, verifies that the constructed path exists.
 * @returns The absolute path, or null if the relative path or workspace location is not set
 *          or if the path is not valid or does not exist (if verifyExistence is true).
 */
export async function constructAbsolutePathFromRelativePath(
    relativePath: string | undefined,
    verifyExistenceOfFile = false
): Promise<string | null> {
    if (!relativePath) {
        logger.error("Relative path is not set while constructing absolute path.");
        return null;
    }

    const workspaceLocation: string | undefined = await validateAndReturnWorkspaceLocation();
    if (!workspaceLocation) {
        logger.error("Workspace location was not set while constructing absolute path.");
        return null;
    }

    const absolutePath: string = path.join(workspaceLocation, relativePath);

    if (!(await isAbsolutePath(absolutePath, verifyExistenceOfFile))) {
        return null;
    }

    logger.trace(`Constructed absolute path: ${absolutePath}`);
    return absolutePath;
}

/**
 * Recursively deletes a directory and its contents, excluding specified folders.
 * @param directoryPathToDelete - The directory path to delete.
 * @param excludedFoldersFromDeletion - A list of folder names to exclude from deletion.
 */
export async function deleteDirectoryRecursively(
    directoryPathToDelete: string,
    excludedFoldersFromDeletion: string[]
): Promise<void | null> {
    logger.debug(`Deleting directory recursively: ${directoryPathToDelete}`);
    logger.debug(`Excluded folders while deleting recursively:`, excludedFoldersFromDeletion);
    try {
        const files = await fsPromises.readdir(directoryPathToDelete);

        for (const file of files) {
            const currentPath = path.join(directoryPathToDelete, file);

            // Skip excluded folders
            if (excludedFoldersFromDeletion.includes(file)) {
                logger.trace(`Skipped deleting this excluded file in delete directory recursively: ${file}`);
                continue;
            }

            const fileStats = await fsPromises.stat(currentPath);
            if (fileStats.isDirectory()) {
                // Recursively delete subdirectories
                await deleteDirectoryRecursively(currentPath, excludedFoldersFromDeletion);
            } else {
                // Delete files
                logger.debug(`Deleting file: ${currentPath}`);
                await fsPromises.unlink(currentPath);
            }
        }

        // Remove the directory itself unless it's an excluded folder.
        const folderName = path.basename(directoryPathToDelete); // Get the last portion of the path
        if (!excludedFoldersFromDeletion.includes(folderName)) {
            logger.debug(`Deleting directory: ${directoryPathToDelete}`);
            await fsPromises.rmdir(directoryPathToDelete);
        }
    } catch (error: any) {
        logger.error(
            `Failed to delete directory ${directoryPathToDelete}: ${error.message} (deleteDirectoryRecursively)`
        );
        return null;
    }
}

/**
 * Deletes all contents of a workspace folder after user confirmation, excluding specified folders.
 * @param workspaceLocationToClear - The path of the workspace folder to be cleared.
 * @param excludedFoldersFromDeletion - A list of folder names to exclude from deletion.
 * @returns A promise that resolves when the workspace folder is cleared successfully, or null if an error occurs.
 */
export async function clearWorkspaceFolder(
    workspaceLocationToClear: string,
    excludedFoldersFromDeletion: string[] = [],
    promptForConfirmation: boolean = true
): Promise<void | null> {
    logger.debug(`Clearing workspace folder: ${workspaceLocationToClear}`);
    try {
        // Check if the workspaceLocation path exists and is a directory
        try {
            const stats = await fsPromises.stat(workspaceLocationToClear);
            if (!stats.isDirectory()) {
                const pathIsNotAFolderErorMessage = `The path "${workspaceLocationToClear}" is not a directory. Cannot clear workspace folder.`;
                vscode.window.showErrorMessage(pathIsNotAFolderErorMessage);
                logger.error(pathIsNotAFolderErorMessage);
                return null;
            }
        } catch {
            const pathDoesNotExistErrorMessage = `The folder at path "${workspaceLocationToClear}" does not exist. Cannot clear workspace folder.`;
            vscode.window.showErrorMessage(pathDoesNotExistErrorMessage);
            logger.error(pathDoesNotExistErrorMessage);
            return null;
        }

        if (promptForConfirmation) {
            // Prompt the user for confirmation
            const userResponse = await vscode.window.showWarningMessage(
                "Are you sure you want to delete all contents of the testbench folder? Log files will not be deleted.",
                { modal: true },
                "Yes",
                "No"
            );

            // Exit if the user selects "No" or closes the dialog
            if (userResponse !== "Yes") {
                logger.debug(`User cancelled the clear workspace folder operation.`);
                return null;
            }
        }

        // Read and process folder contents
        const files = await fsPromises.readdir(workspaceLocationToClear);
        for (const file of files) {
            const filePath = path.join(workspaceLocationToClear, file);

            // Skip excluded folders
            if (excludedFoldersFromDeletion.includes(file)) {
                // vscode.window.showInformationMessage(`Skipping excluded folder: ${file}`);
                logger.trace(`Skipped deleting this excluded file in clear workspace command: ${file}`);
                continue;
            }

            // Check if it's a directory or file and delete accordingly
            const fileStats = await fsPromises.stat(filePath);
            if (fileStats.isDirectory()) {
                await deleteDirectoryRecursively(filePath, excludedFoldersFromDeletion);
            } else {
                await fsPromises.unlink(filePath);
            }
        }

        const clearWorkspaceFolderSuccessMessage = `Workspace folder cleared successfully: ${workspaceLocationToClear}`;
        // vscode.window.showInformationMessage(clearWorkspaceFolderSuccessMessage);
        logger.debug(clearWorkspaceFolderSuccessMessage);
    } catch (error: any) {
        const clearWorkspaceFolderErrorMessage = `An error occurred while clearing the workspace folder: ${error.message}`;
        vscode.window.showErrorMessage(clearWorkspaceFolderErrorMessage);
        logger.error(clearWorkspaceFolderErrorMessage);
        return null;
    }
}

/**
 * Retrieves the workspace location by checking:
 * 1. The "workspaceLocation" setting in the extension configuration.
 * 2. The location of the currently opened workspace folder.
 * If neither is found, prompts the user to set a custom workspace location,
 * saves it in the extension configuration, and returns the newly set value.
 * Enable logging flag and logger checks are added because this function is also used in the logger constructor.
 *
 * @param enableLogging - Determines whether to log trace information. Defaults to `true`.
 * @returns A Promise that resolves to the workspace location string or `undefined` if the user canceled.
 */
export async function validateAndReturnWorkspaceLocation(enableLogging: boolean = true): Promise<string | undefined> {
    if (logger && enableLogging) {
        logger.trace("Validating and returning workspace location.");
    }

    // Check if the user has specified a workspace location in extension settings
    const workspaceLocationInExtensionSettings = getConfig().get<string>("workspaceLocation", "");
    if (workspaceLocationInExtensionSettings) {
        if (logger && enableLogging) {
            logger.trace(
                `Workspace location found in extension settings, returning: ${workspaceLocationInExtensionSettings}`
            );
        }
        return workspaceLocationInExtensionSettings;
    }

    // If no custom location is set, fall back to the currently opened workspace (if any)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        if (logger && enableLogging) {
            logger.trace(
                `Workspace location found in currently opened workspace folder, returning: ${workspaceFolders[0].uri.fsPath}`
            );
        }
        return workspaceFolders[0].uri.fsPath;
    }

    if (logger && enableLogging) {
        logger.trace(
            "No workspace location found in extension settings or currently opened workspace folder. Prompting user to set a new location."
        );
    }

    // If neither is available, prompt the user to set a new workspace location
    const newWorkspaceLocation = await vscode.window.showInputBox({
        placeHolder: "Enter the new workspace location...",
        prompt: "No workspace location found. Please set a workspace location or press Escape to cancel.",
    });

    if (newWorkspaceLocation && newWorkspaceLocation.trim()) {
        // Update the extension setting with the newly provided location
        await getConfig().update("workspaceLocation", newWorkspaceLocation, vscode.ConfigurationTarget.Global);
        if (logger && enableLogging) {
            logger.trace(`New workspace location set to: ${newWorkspaceLocation}`);
        }
        return newWorkspaceLocation;
    }

    if (logger && enableLogging) {
        logger.trace("User canceled the workspace location prompt. Returning undefined.");
    }

    // If the user canceled or entered an empty value, return undefined
    return undefined;
}

