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

    const workspaceLocation: string | undefined = getConfig().get<string>("workspaceLocation");
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
 * Checks if the workspace location is set in the extension settings.
 * If not, prompts the user to set it.
 *
 * @returns A Promise that resolves to `true` if the workspace location is valid or has been set successfully,
 *          or `false` if the user cancels the prompt, chooses not to set it, or there is an error.
 */
export async function ensureWorkspaceLocation(): Promise<boolean> {
    try {
        const workspaceLocationInExtensionSettings: string = getConfig().get<string>("workspaceLocation")!;

        // If workspace location is not set, prompt the user
        if (!workspaceLocationInExtensionSettings) {
            logger.warn("Workspace location is not set in the extension settings.");

            const selectedOption = await vscode.window.showInformationMessage(
                "Invalid workspace location. Would you like to set the workspace path?",
                { modal: true },
                "Yes",
                "No"
            );

            logger.trace(`User selected ${selectedOption} option for setting the workspace location.`);

            switch (selectedOption) {
                case "Yes":
                    // Execute the command to set the workspace location
                    await vscode.commands.executeCommand(`${allExtensionCommands.setWorkspaceLocation.command}`);

                    // Note: No need to check that the workspace location is valid and exists since its a VS Code file selection dialog.

                    // Check if the workspace location is now set after executing the command
                    const newWorkspaceLocation: string = getConfig().get<string>("workspaceLocation")!;
                    if (newWorkspaceLocation) {
                        logger.trace("Workspace location has been set successfully to:", newWorkspaceLocation);
                        return true;
                    } else {
                        logger.error("Failed to set the workspace location.");
                        vscode.window.showErrorMessage("Failed to set the workspace location. See logs for details.");
                        return false;
                    }
                case "No":
                    // User chose not to set the location
                    logger.warn("User chose not to set the workspace location.");
                    return false;
                default:
                    // User canceled the prompt
                    logger.trace("User canceled the prompt to set the workspace location.");
                    return false;
            }
        }

        // Workspace location is already set
        logger.trace("Workspace location is valid.");
        return true;
    } catch (error: any) {
        // Handle potential errors (e.g., accessing configuration)
        logger.error(`Error checking workspace location: ${error.message}`);
        vscode.window.showErrorMessage("Error checking workspace location. See logs for details.");
        return false;
    }
}
