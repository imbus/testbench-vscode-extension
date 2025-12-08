/**
 * @file src/treeViews/implementations/testThemes/RobotFileService.ts
 * @description Manages robot file operations related to Test Themes Tree.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { TestBenchLogger } from "../../../testBenchLogger";
import { validateAndReturnWorkspaceLocation } from "../../../utils";
import { getExtensionSetting } from "../../../configuration";
import { ConfigKeys } from "../../../constants";
import { TestThemesTreeItem } from "./TestThemesTreeItem";
import { treeViews } from "../../../extension";
import { MarkingModule } from "../../features/MarkingModule";
import { GeneratedFileMapper } from "./GeneratedFileMapper";

export interface RobotFileInfo {
    exists: boolean;
    filePath?: string;
}

export interface FolderInfo {
    exists: boolean;
    folderPath?: string;
}

export class RobotFileService {
    private generationMetadataService: GeneratedFileMapper;

    constructor(
        private readonly logger: TestBenchLogger,
        private readonly context?: vscode.ExtensionContext
    ) {
        this.generationMetadataService = new GeneratedFileMapper(logger, context);
        this.generationMetadataService.initialize().catch((error) => {
            this.logger.error("[RobotFileService] Failed to initialize metadata service:", error);
        });
    }

    /**
     * Gets the metadata service instance
     * @returns The generation metadata service
     */
    public getMetadataService(): GeneratedFileMapper {
        return this.generationMetadataService;
    }

    /**
     * Checks if a robot file exists locally for a given test theme or test case set.
     * Checks metadata first and falls back to pattern-based search.
     * @param item The test theme or test case set tree item
     * @returns Promise resolving to RobotFileInfo with existence status and file path
     */
    public async checkRobotFileExists(item: TestThemesTreeItem): Promise<RobotFileInfo> {
        try {
            const metadataFilePath = await this.generationMetadataService.getGeneratedFilePath(item.data.base.uniqueID);
            if (metadataFilePath && fs.existsSync(metadataFilePath)) {
                this.logger.trace(
                    `[RobotFileService] Found robot file via metadata for "${item.data.base.name}": ${metadataFilePath}`
                );
                return {
                    exists: true,
                    filePath: metadataFilePath
                };
            }

            // Fallback to pattern-based search
            this.logger.trace(
                `[RobotFileService] No metadata found for "${item.data.base.name}", trying pattern-based search`
            );

            const workspaceLocation = await validateAndReturnWorkspaceLocation();
            if (!workspaceLocation) {
                return { exists: false };
            }

            const outputDirectory = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_OUTPUT_DIR);
            if (!outputDirectory) {
                return { exists: false };
            }

            const possibleRobotFileNames = this.generatePossibleRobotFileNames(
                item.data.base.name,
                item.data.base.numbering
            );
            const outputPath = path.join(workspaceLocation, outputDirectory);

            for (const fileName of possibleRobotFileNames) {
                const foundFiles = await this.findAllRobotFiles(outputPath, fileName);

                // Validate each found file against the tree item's UniqueID
                for (const filePath of foundFiles) {
                    if (await this.validateRobotFileForTreeItem(filePath, item)) {
                        this.logger.trace(`[RobotFileService] Found valid file via pattern search: ${filePath}`);

                        // Update metadata with new path if file was renamed
                        if (metadataFilePath && metadataFilePath !== filePath) {
                            this.logger.info(
                                `[RobotFileService] Detected renamed file for "${item.data.base.name}": ${path.basename(metadataFilePath)} → ${path.basename(filePath)}`
                            );
                            const relativePath = path.relative(workspaceLocation, filePath);
                            await this.generationMetadataService.updateMetadataFilePath(
                                item.data.base.uniqueID,
                                relativePath
                            );
                        }

                        return {
                            exists: true,
                            filePath
                        };
                    }
                }
            }

            // Fallback: Search by UniqueID to handle arbitrary renames
            this.logger.trace(
                `[RobotFileService] Pattern search failed for "${item.data.base.name}", trying deep UniqueID search`
            );
            const foundByUniqueID = await this.findRobotFileByUniqueID(outputPath, item.data.base.uniqueID);
            if (foundByUniqueID) {
                this.logger.info(
                    `[RobotFileService] Found renamed file via UniqueID search for "${item.data.base.name}": ${path.basename(foundByUniqueID)}`
                );
                const relativePath = path.relative(workspaceLocation, foundByUniqueID);
                await this.generationMetadataService.updateMetadataFilePath(item.data.base.uniqueID, relativePath);
                return {
                    exists: true,
                    filePath: foundByUniqueID
                };
            }

            return { exists: false };
        } catch (error) {
            this.logger.error(`[RobotFileService] Error checking robot file existence:`, error);
            return { exists: false };
        }
    }

    /**
     * Searches for a robot file by its UniqueID metadata recursively
     * @param searchPath The path to search in
     * @param uniqueID The UniqueID to search for
     * @returns Path to the file if found, undefined otherwise
     */
    private async findRobotFileByUniqueID(searchPath: string, uniqueID: string): Promise<string | undefined> {
        try {
            const directoryContents = await fs.promises.readdir(searchPath, { withFileTypes: true });

            for (const item of directoryContents) {
                const itemPath = path.join(searchPath, item.name);

                if (item.isDirectory()) {
                    const foundRobotFile = await this.findRobotFileByUniqueID(itemPath, uniqueID);
                    if (foundRobotFile) {
                        return foundRobotFile;
                    }
                } else if (item.isFile() && item.name.endsWith(".robot")) {
                    try {
                        const contentOfRobotFile = await fs.promises.readFile(itemPath, "utf-8");
                        const uniqueIdMatch = contentOfRobotFile.match(/Metadata\s+UniqueID\s+(.+)/);
                        if (uniqueIdMatch && uniqueIdMatch[1].trim() === uniqueID) {
                            return itemPath;
                        }
                    } catch (readError) {
                        // Skip files that can't be read
                        this.logger.trace(`[RobotFileService] Could not read ${itemPath}: ${readError}`);
                    }
                }
            }
        } catch (error: any) {
            if (error.code !== "ENOENT") {
                this.logger.error(`[RobotFileService] Error in UniqueID search at ${searchPath}:`, error);
            }
        }

        return undefined;
    }

    /**
     * Recursively finds all robot files with the given filename in the output directory
     * @param searchPath The path to search in
     * @param fileName The file name to search for
     * @returns Array of found file paths
     */
    private async findAllRobotFiles(searchPath: string, fileName: string): Promise<string[]> {
        const foundFiles: string[] = [];
        try {
            const items = await fs.promises.readdir(searchPath, { withFileTypes: true });

            for (const item of items) {
                const itemPath = path.join(searchPath, item.name);

                if (item.isDirectory()) {
                    const subFiles = await this.findAllRobotFiles(itemPath, fileName);
                    foundFiles.push(...subFiles);
                } else if (item.isFile() && item.name === fileName) {
                    foundFiles.push(itemPath);
                }
            }
        } catch (error: any) {
            if (error.code === "ENOENT") {
                this.logger.trace(
                    `[RobotFileService] Search directory not found: ${searchPath}. This is expected if tests have not been generated yet.`
                );
            } else {
                this.logger.error(
                    `[RobotFileService] Error while searching for robot files in "${searchPath}" for file name "${fileName}":`,
                    error
                );
            }
        }

        return foundFiles;
    }

    /**
     * Opens a robot file in VS Code editor
     * @param filePath The path of the robot file to open
     * @param item Optional tree item to validate the robot file against
     * @returns Promise that resolves when the file is opened
     */
    public async openRobotFileInVSCodeEditor(filePath: string, item?: TestThemesTreeItem): Promise<void> {
        try {
            // If the file doesn't exist, show an error and refresh the tree item to remove the "Open" button
            if (!fs.existsSync(filePath)) {
                this.logger.warn(`[RobotFileService] Attempted to open non-existent robot file: ${filePath}`);
                if (item) {
                    await item.checkRobotFileExists();
                    item.updateContextValue();
                    if (treeViews && treeViews.testThemesTree) {
                        treeViews.testThemesTree.refresh(item);
                        // If file is gone, unmark the item to keep icon/marking in sync
                        const markingModule = treeViews.testThemesTree.getModule("marking") as
                            | MarkingModule
                            | undefined;
                        if (markingModule && item.id) {
                            markingModule.unmarkItemByID(item.id);
                        }
                    }
                }
                vscode.window.showErrorMessage(`Failed to open robot file. File not found: ${path.basename(filePath)}`);
                return;
            }

            if (item) {
                const isValid = await this.validateRobotFileForTreeItem(filePath, item);
                if (!isValid) {
                    this.logger.trace(
                        `[RobotFileService] Attempted to open robot file that doesn't match tree item ${item.data.base.name} (UniqueID: ${item.data.base.uniqueID})`
                    );

                    const correctFilePath = await this.getRobotFilePath(item);
                    if (correctFilePath && correctFilePath !== filePath) {
                        this.logger.trace(
                            `[RobotFileService] Found correct robot file for item ${item.data.base.name}: ${correctFilePath}`
                        );
                        const document = await vscode.workspace.openTextDocument(correctFilePath);
                        await vscode.window.showTextDocument(document);
                        return;
                    } else {
                        this.logger.trace(
                            `[RobotFileService] No correct robot file found for item ${item.data.base.name}`
                        );
                    }
                }
            }

            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            this.logger.error(`[RobotFileService] Error while opening robot file "${filePath}":`, error);
            vscode.window.showErrorMessage(
                `Failed to open robot file ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    /**
     * Generates possible name patterns based on the item name and numbering.
     * Returns an array of possible names to account for different logSuiteNumbering settings:
     * - When logSuiteNumbering is true: "1_Name" (single underscore)
     * - When logSuiteNumbering is false: "1__Name" (double underscore)
     * testbench2robotframework replaces invalid file path characters with underscores:
     * < > : " / \ | ? * and spaces.
     * @param treeItemName The name of the test theme or test case set
     * @param treeItemNumbering The numbering prefix for the tree item
     * @param suffix Optional suffix to append (e.g., ".robot" for files)
     * @returns Array of possible names
     */
    private generatePossibleNames(treeItemName: string, treeItemNumbering: string, suffix: string = ""): string[] {
        // Find the last part of the numbering after the last dot. ("1.2.3" -> "3")
        const lastNumberOfItemNumbering = treeItemNumbering
            ? treeItemNumbering.split(".")?.pop() || treeItemNumbering
            : "";
        // Characters to replace with underscore:
        // ["<", ">", ":", "\"", "/", "\\", "|", "?", "*", " "]
        const safeFileName = treeItemName.replace(/[<>:"/\\|?*\s]/g, "_");

        if (!lastNumberOfItemNumbering) {
            return [`${safeFileName}${suffix}`];
        }

        // Generate both possible patterns:
        // - Single underscore (logSuiteNumbering = true): "1_Name"
        // - Double underscore (logSuiteNumbering = false): "1__Name"
        return [
            `${lastNumberOfItemNumbering}_${safeFileName}${suffix}`,
            `${lastNumberOfItemNumbering}__${safeFileName}${suffix}`
        ];
    }

    /**
     * Generates possible robot file name patterns based on the item name and numbering.
     * @param treeItemName The name of the test theme or test case set
     * @param treeItemNumbering The numbering prefix for the tree item
     * @returns Array of possible robot file names
     */
    private generatePossibleRobotFileNames(treeItemName: string, treeItemNumbering: string): string[] {
        return this.generatePossibleNames(treeItemName, treeItemNumbering, ".robot");
    }

    /**
     * Validates that a robot file is the correct one for a given tree item by checking its metadata
     * @param robotFilePath The path to the robot file to validate
     * @param item The tree item to validate against
     * @returns Promise resolving to true if the robot file is valid for the item
     */
    private async validateRobotFileForTreeItem(robotFilePath: string, item: TestThemesTreeItem): Promise<boolean> {
        try {
            const fileContent = await fs.promises.readFile(robotFilePath, "utf-8");

            const uniqueIdMatch = fileContent.match(/Metadata\s+UniqueID\s+(.+)/);
            if (!uniqueIdMatch) {
                this.logger.trace(`[RobotFileService] Robot file ${robotFilePath} does not contain UniqueID metadata`);
                return false;
            }

            const fileUniqueId = uniqueIdMatch[1].trim();
            const itemUniqueId = item.data.base.uniqueID;

            if (fileUniqueId === itemUniqueId) {
                this.logger.trace(
                    `[RobotFileService] Robot file ${robotFilePath} is valid for item ${item.data.base.name} (UniqueID: ${itemUniqueId})`
                );
                return true;
            } else {
                this.logger.trace(
                    `[RobotFileService] Robot file ${robotFilePath} UniqueID mismatch: expected ${itemUniqueId}, found ${fileUniqueId}`
                );
                return false;
            }
        } catch (error: any) {
            if (error.code === "ENOENT") {
                this.logger.trace(`[RobotFileService] Robot file not found during validation: ${robotFilePath}`);
            } else {
                this.logger.error(`[RobotFileService] Error validating robot file ${robotFilePath}:`, error);
            }
            return false;
        }
    }

    /**
     * Gets the robot file path for a given item
     * @param item The test theme or test case set tree item
     * @returns Promise resolving to the robot file path or undefined if not found
     */
    public async getRobotFilePath(item: TestThemesTreeItem): Promise<string | undefined> {
        const fileInfo = await this.checkRobotFileExists(item);
        return fileInfo.exists ? fileInfo.filePath : undefined;
    }

    /**
     * Checks if a folder exists locally for a given test theme.
     * First uses metadata approach and fallsback to pattern-based search.
     * @param item The test theme tree item
     * @returns Promise resolving to FolderInfo with existence status and folder path
     */
    public async checkFolderExists(item: TestThemesTreeItem): Promise<FolderInfo> {
        try {
            const metadataFolderPath = await this.generationMetadataService.getGeneratedFolderPath(
                item.data.base.uniqueID
            );
            if (metadataFolderPath && fs.existsSync(metadataFolderPath)) {
                this.logger.trace(
                    `[RobotFileService] Found folder via metadata for "${item.data.base.name}": ${metadataFolderPath}`
                );
                return {
                    exists: true,
                    folderPath: metadataFolderPath
                };
            }

            this.logger.trace(
                `[RobotFileService] No metadata found for "${item.data.base.name}", trying pattern-based search`
            );

            const workspaceLocation = await validateAndReturnWorkspaceLocation();
            if (!workspaceLocation) {
                return { exists: false };
            }

            const outputDirectory = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_OUTPUT_DIR);
            if (!outputDirectory) {
                return { exists: false };
            }

            const possibleFolderNames = this.generatePossibleFolderNames(item.data.base.name, item.data.base.numbering);
            const outputPath = path.join(workspaceLocation, outputDirectory);

            // Try to find folder matching any pattern
            for (const folderName of possibleFolderNames) {
                const foundFolders = await this.findAllFolders(outputPath, folderName);
                if (foundFolders.length > 0) {
                    const folderPath = foundFolders[0]; // Use first match
                    this.logger.trace(`[RobotFileService] Found folder via pattern search: ${folderPath}`);

                    // Update metadata with new path if folder was renamed
                    if (metadataFolderPath && metadataFolderPath !== folderPath) {
                        this.logger.info(
                            `[RobotFileService] Detected renamed folder for "${item.data.base.name}": ${path.basename(metadataFolderPath)} → ${path.basename(folderPath)}`
                        );
                        const relativePath = path.relative(workspaceLocation, folderPath);
                        await this.generationMetadataService.updateFolderPath(item.data.base.uniqueID, relativePath);
                    }

                    return {
                        exists: true,
                        folderPath
                    };
                }
            }

            return { exists: false };
        } catch (error) {
            this.logger.error(`[RobotFileService] Error checking folder existence:`, error);
            return { exists: false };
        }
    }

    /**
     * Recursively finds all folders with the given name in the output directory
     * @param searchPath The path to search in
     * @param folderName The folder name to search for
     * @returns Array of found folder paths
     */
    private async findAllFolders(searchPath: string, folderName: string): Promise<string[]> {
        const foundFolders: string[] = [];
        try {
            const items = await fs.promises.readdir(searchPath, { withFileTypes: true });

            for (const item of items) {
                const fullPath = path.join(searchPath, item.name);

                if (item.isDirectory()) {
                    // Check if this directory matches the folder name
                    if (item.name === folderName) {
                        foundFolders.push(fullPath);
                    }
                    // Recursively search in subdirectories
                    const subFolders = await this.findAllFolders(fullPath, folderName);
                    foundFolders.push(...subFolders);
                }
            }
        } catch (error: any) {
            if (error.code === "ENOENT") {
                // Directory doesn't exist, which is fine - return empty array
                this.logger.trace(`[RobotFileService] Directory does not exist: ${searchPath}`);
            } else {
                this.logger.error(`[RobotFileService] Error reading directory ${searchPath}:`, error);
            }
        }

        return foundFolders;
    }

    /**
     * Generates possible folder name patterns based on the test theme name and numbering.
     * @param treeItemName The name of the test theme
     * @param treeItemNumbering The numbering prefix for the tree item
     * @returns Array of possible folder names
     */
    private generatePossibleFolderNames(treeItemName: string, treeItemNumbering: string): string[] {
        return this.generatePossibleNames(treeItemName, treeItemNumbering);
    }

    /**
     * Gets the folder path for a given test theme item
     * @param item The test theme tree item
     * @returns Promise resolving to the folder path or undefined if not found
     */
    public async getFolderPath(item: TestThemesTreeItem): Promise<string | undefined> {
        const folderInfo = await this.checkFolderExists(item);
        return folderInfo.exists ? folderInfo.folderPath : undefined;
    }
}
