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

export interface RobotFileInfo {
    exists: boolean;
    filePath?: string;
    fileName?: string;
    hierarchicalPath?: string;
    duplicateFiles?: string[];
}

export class RobotFileService {
    constructor(private readonly logger: TestBenchLogger) {}

    /**
     * Checks if a robot file exists locally for a given test theme or test case set
     * @param item The test theme or test case set tree item
     * @returns Promise resolving to RobotFileInfo with existence status and file path
     */
    public async checkRobotFileExists(item: TestThemesTreeItem): Promise<RobotFileInfo> {
        try {
            const workspaceLocation = await validateAndReturnWorkspaceLocation();
            if (!workspaceLocation) {
                this.logger.error("[RobotFileService] Workspace location not found");
                return { exists: false };
            }

            const generatedRobotFilesOutputDirectory = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_OUTPUT_DIR);
            if (!generatedRobotFilesOutputDirectory) {
                this.logger.error("[RobotFileService] Output directory not configured");
                return { exists: false };
            }

            const hierarchicalPath = this.buildHierarchicalPath(item);
            const robotFileName = this.generateRobotFileName(item.data.base.name, item.data.base.numbering);
            const robotFilePath = path.join(
                workspaceLocation,
                generatedRobotFilesOutputDirectory,
                hierarchicalPath,
                robotFileName
            );

            this.logger.debug(`[RobotFileService] Checking for robot file: ${robotFilePath}`);
            this.logger.debug(
                `[RobotFileService] Item: ${item.data.base.name}, Type: ${item.data.elementType}, Hierarchical path: ${hierarchicalPath}, File name: ${robotFileName}`
            );
            this.logger.debug(
                `[RobotFileService] Workspace: ${workspaceLocation}, Output dir: ${generatedRobotFilesOutputDirectory}`
            );

            const outputDirPath = path.join(workspaceLocation, generatedRobotFilesOutputDirectory);
            try {
                const outputDirStats = await fs.promises.stat(outputDirPath);
                this.logger.debug(
                    `[RobotFileService] Output directory exists: ${outputDirPath} (isDirectory: ${outputDirStats.isDirectory()})`
                );
            } catch {
                this.logger.debug(`[RobotFileService] Output directory does not exist: ${outputDirPath}`);
            }

            const actualFolderName = await this.findActualFolderPath(
                workspaceLocation,
                generatedRobotFilesOutputDirectory,
                hierarchicalPath
            );
            const actualHierarchicalPath = actualFolderName;
            const actualRobotFilePath = path.join(
                workspaceLocation,
                generatedRobotFilesOutputDirectory,
                actualHierarchicalPath,
                robotFileName
            );

            this.logger.debug(`[RobotFileService] Actual hierarchical path: ${actualHierarchicalPath}`);
            this.logger.debug(`[RobotFileService] Actual robot file path: ${actualRobotFilePath}`);

            const hierarchicalDirPath = path.join(
                workspaceLocation,
                generatedRobotFilesOutputDirectory,
                actualHierarchicalPath
            );
            try {
                const hierarchicalDirStats = await fs.promises.stat(hierarchicalDirPath);
                this.logger.debug(
                    `[RobotFileService] Hierarchical directory exists: ${hierarchicalDirPath} (isDirectory: ${hierarchicalDirStats.isDirectory()})`
                );
            } catch {
                this.logger.debug(`[RobotFileService] Hierarchical directory does not exist: ${hierarchicalDirPath}`);
            }

            try {
                await fs.promises.access(actualRobotFilePath, fs.constants.F_OK);
                this.logger.debug(`[RobotFileService] Robot file exists at exact path: ${actualRobotFilePath}`);

                const duplicateFiles = await this.findDuplicateRobotFiles(
                    workspaceLocation,
                    generatedRobotFilesOutputDirectory,
                    robotFileName
                );

                return {
                    exists: true,
                    filePath: actualRobotFilePath,
                    fileName: robotFileName,
                    hierarchicalPath: actualHierarchicalPath,
                    duplicateFiles: duplicateFiles.length > 0 ? duplicateFiles : undefined
                };
            } catch {
                this.logger.debug(`[RobotFileService] Robot file does not exist at exact path: ${actualRobotFilePath}`);
            }

            // If exact path not found, try to find files with different numbering patterns
            this.logger.debug(
                `[RobotFileService] Searching for robot files with different numbering patterns for: ${item.data.base.name}`
            );
            const foundFiles = await this.findRobotFilesWithDifferentNumbering(
                workspaceLocation,
                generatedRobotFilesOutputDirectory,
                item.data.base.name,
                item.data.base.numbering
            );

            if (foundFiles.length > 0) {
                // Use the first found file
                const foundFilePath = foundFiles[0];
                const foundFileName = path.basename(foundFilePath);
                this.logger.debug(`[RobotFileService] Found robot file with different numbering: ${foundFilePath}`);

                return {
                    exists: true,
                    filePath: foundFilePath,
                    fileName: foundFileName,
                    hierarchicalPath: actualHierarchicalPath,
                    duplicateFiles: foundFiles.length > 1 ? foundFiles : undefined
                };
            }

            this.logger.debug(`[RobotFileService] No robot file found for: ${item.data.base.name}`);
            return {
                exists: false,
                hierarchicalPath: actualHierarchicalPath,
                fileName: robotFileName
            };
        } catch (error) {
            this.logger.error(`[RobotFileService] Error checking robot file existence:`, error);
            return { exists: false };
        }
    }

    /**
     * Builds the hierarchical path for a test theme or test case set based on its position in the tree.
     * When tests are generated for a specific item, that item becomes the root of the generated structure.
     * @param item The tree item to build the path for
     * @returns The hierarchical path with numbered prefixes
     */
    private buildHierarchicalPath(item: TestThemesTreeItem): string {
        const pathParts: string[] = [];

        if (item.data.elementType === "TestThemeNode") {
            const itemName = item.data.base.name;
            const numbering = item.data.base.numbering;

            const lastNumberingPart = numbering ? numbering.split(".").pop() || numbering : "";
            const prefix = lastNumberingPart ? `${lastNumberingPart}_` : "";
            pathParts.push(`${prefix}${itemName}`);
        } else if (item.data.elementType === "TestCaseSetNode") {
            const parent = item.parent as TestThemesTreeItem | null;

            if (parent && parent.data.elementType === "TestThemeNode") {
                const parentName = parent.data.base.name;
                const parentNumbering = parent.data.base.numbering;

                const parentLastNumberingPart = parentNumbering
                    ? parentNumbering.split(".").pop() || parentNumbering
                    : "";
                const parentPrefix = parentLastNumberingPart ? `${parentLastNumberingPart}_` : "";
                pathParts.push(`${parentPrefix}${parentName}`);
            } else {
                const itemName = item.data.base.name;
                const numbering = item.data.base.numbering;

                const lastNumberingPart = numbering ? numbering.split(".").pop() || numbering : "";
                const prefix = lastNumberingPart ? `${lastNumberingPart}_` : "";
                pathParts.push(`${prefix}${itemName}`);
            }
        }

        return pathParts.join(path.sep);
    }

    /**
     * Finds the actual folder path that exists in the filesystem
     * This handles cases where the folder name might have different numbering patterns
     * @param workspaceLocation The workspace root location
     * @param outputDirectory The output directory for robot files
     * @param expectedFolderName The expected folder name
     * @returns The actual folder path if found, or the expected path if not found
     */
    private async findActualFolderPath(
        workspaceLocation: string,
        outputDirectory: string,
        expectedFolderName: string
    ): Promise<string> {
        const outputPath = path.join(workspaceLocation, outputDirectory);
        const expectedPath = path.join(outputPath, expectedFolderName);

        try {
            await fs.promises.access(expectedPath, fs.constants.F_OK);
            return expectedFolderName;
        } catch {
            // Expected path doesn't exist, try to find similar folders using regex
            try {
                const outputDirectoryFiles = await fs.promises.readdir(outputPath, { withFileTypes: true });
                const match = expectedFolderName.match(/^(\d+)_(.+)$/);
                if (match) {
                    const [, numberingStr, folderName] = match;
                    const numberingNum = parseInt(numberingStr, 10);

                    if (!isNaN(numberingNum)) {
                        // Create a regex pattern that matches any number of leading zeros followed by the numbering part
                        // This will match: 1_FolderName, 01_FolderName, 001_FolderName, etc.
                        const regexPattern = new RegExp(
                            `^0*${numberingNum}_${folderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
                        );
                        this.logger.debug(
                            `[RobotFileService] Using regex pattern for folder search: ${regexPattern.source}`
                        );

                        for (const file of outputDirectoryFiles) {
                            if (file.isDirectory() && regexPattern.test(file.name)) {
                                this.logger.debug(
                                    `[RobotFileService] Found matching folder with regex: ${file.name} (expected: ${expectedFolderName})`
                                );
                                return file.name;
                            }
                        }
                    } else {
                        // Edge case: non-numeric numbering
                        for (const file of outputDirectoryFiles) {
                            if (file.isDirectory()) {
                                const folderNameWithoutNumbering = file.name.replace(/^\d+_/, "");
                                const expectedNameWithoutNumbering = expectedFolderName.replace(/^\d+_/, "");

                                if (folderNameWithoutNumbering === expectedNameWithoutNumbering) {
                                    this.logger.debug(
                                        `[RobotFileService] Found matching folder: ${file.name} (expected: ${expectedFolderName})`
                                    );
                                    return file.name;
                                }
                            }
                        }
                    }
                } else {
                    // No numbering found, use exact match
                    for (const file of outputDirectoryFiles) {
                        if (file.isDirectory() && file.name === expectedFolderName) {
                            this.logger.debug(`[RobotFileService] Found exact folder match: ${file.name}`);
                            return file.name;
                        }
                    }
                }
            } catch (error) {
                this.logger.debug(`[RobotFileService] Error searching for folder:`, error);
            }
        }

        return expectedFolderName;
    }

    /**
     * Finds duplicate robot files with the same name in different folders
     * @param workspaceLocation The workspace root location
     * @param outputDirectory The output directory for robot files
     * @param fileName The robot file name to search for
     * @returns Array of duplicate file paths
     */
    private async findDuplicateRobotFiles(
        workspaceLocation: string,
        outputDirectory: string,
        fileName: string
    ): Promise<string[]> {
        const outputPath = path.join(workspaceLocation, outputDirectory);
        const duplicateFiles: string[] = [];

        try {
            const allFiles = await this.findAllRobotFiles(outputPath, fileName);
            if (allFiles.length > 1) {
                duplicateFiles.push(...allFiles);
            }
        } catch (error) {
            this.logger.error(`[RobotFileService] Error finding duplicate files:`, error);
        }

        return duplicateFiles;
    }

    /**
     * Recursively finds all robot files with the given name in the output directory
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
        } catch (error) {
            this.logger.debug(`[RobotFileService] Could not read directory ${searchPath}:`, error);
        }

        return foundFiles;
    }

    /**
     * Recursively finds all robot files that match a regex pattern in the output directory
     * @param searchPath The path to search in
     * @param regexPattern The regex pattern to match against file names
     * @returns Array of found file paths
     */
    private async findAllRobotFilesByRegex(searchPath: string, regexPattern: RegExp): Promise<string[]> {
        const foundFiles: string[] = [];

        try {
            const items = await fs.promises.readdir(searchPath, { withFileTypes: true });

            for (const item of items) {
                const itemPath = path.join(searchPath, item.name);

                if (item.isDirectory()) {
                    const subFiles = await this.findAllRobotFilesByRegex(itemPath, regexPattern);
                    foundFiles.push(...subFiles);
                } else if (item.isFile() && regexPattern.test(item.name)) {
                    foundFiles.push(itemPath);
                }
            }
        } catch (error) {
            this.logger.debug(`[RobotFileService] Could not read directory ${searchPath}:`, error);
        }

        return foundFiles;
    }

    /**
     * Opens a robot file in VS Code editor
     * @param filePath The path of the robot file to open
     * @returns Promise that resolves when the file is opened
     */
    public async openRobotFile(filePath: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
            this.logger.debug(`[RobotFileService] Opened robot file: ${filePath}`);
        } catch (error) {
            this.logger.error(`[RobotFileService] Error opening robot file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Generates a robot file name based on the item name and numbering to generate the correct file suffix.
     * @param treeItemName The name of the test theme or test case set
     * @param treeItemNumbering The numbering prefix for the tree item
     * @returns The generated robot file name
     */
    private generateRobotFileName(treeItemName: string, treeItemNumbering: string): string {
        const lastNumberingPart = treeItemNumbering ? treeItemNumbering.split(".")?.pop() || treeItemNumbering : "";
        const prefixOfFileName = lastNumberingPart ? `${lastNumberingPart}_` : "";
        // Normalize whitespace to underscores for file name matching
        const normalizedName = treeItemName.replace(/\s+/g, "_");
        this.logger.debug(
            `[RobotFileService] generateRobotFileName: original numbering="${treeItemNumbering}", last part="${lastNumberingPart}", prefix="${prefixOfFileName}", tree item name="${treeItemName}", normalized name="${normalizedName}"`
        );
        return `${prefixOfFileName}${normalizedName}.robot`;
    }

    /**
     * Finds robot files that might exist with different numbering patterns using regex
     * @param workspaceLocation The workspace root location
     * @param outputDirectory The output directory for robot files
     * @param itemName The name of the item
     * @param numbering The numbering prefix for the item
     * @returns Array of possible robot file paths
     */
    private async findRobotFilesWithDifferentNumbering(
        workspaceLocation: string,
        outputDirectory: string,
        itemName: string,
        numbering: string
    ): Promise<string[]> {
        // Extract the last part of the numbering (e.g. "1.2.2.1.1" will become "1")
        const lastNumberingPart = numbering ? numbering.split(".")?.pop() || numbering : "";
        // Normalize whitespace to underscores for file name matching
        const normalizedName = itemName.replace(/\s+/g, "_");
        this.logger.debug(
            `[RobotFileService] findRobotFilesWithDifferentNumbering: item="${itemName}", normalized name="${normalizedName}", original numbering="${numbering}", last part="${lastNumberingPart}"`
        );

        const foundRobotFiles: string[] = [];
        const outputPath = path.join(workspaceLocation, outputDirectory);

        if (lastNumberingPart) {
            const numberingNum = parseInt(lastNumberingPart, 10);
            if (!isNaN(numberingNum)) {
                // Create a regex pattern that matches any number of leading zeros followed by the numbering part
                // This matches: 1_, 01_, 001_, 0001_, etc.
                const regexPattern = new RegExp(
                    `^0*${numberingNum}_${normalizedName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\.robot$`
                );
                this.logger.debug(`[RobotFileService] Using regex pattern: ${regexPattern.source}`);

                try {
                    const allRegexMatchingRobotFiles = await this.findAllRobotFilesByRegex(outputPath, regexPattern);
                    foundRobotFiles.push(...allRegexMatchingRobotFiles);
                    if (allRegexMatchingRobotFiles.length > 0) {
                        this.logger.debug(
                            `[RobotFileService] Found files with regex: ${allRegexMatchingRobotFiles.join(", ")}`
                        );
                    }
                } catch (error) {
                    this.logger.debug(`[RobotFileService] Error searching with regex:`, error);
                }
            } else {
                // Numbering is not numeric, try searching with exact matching
                const exactFileName = `${lastNumberingPart}_${normalizedName}.robot`;
                try {
                    const allRobotFiles = await this.findAllRobotFiles(outputPath, exactFileName);
                    foundRobotFiles.push(...allRobotFiles);
                    if (allRobotFiles.length > 0) {
                        this.logger.debug(
                            `[RobotFileService] Found files for ${exactFileName}: ${allRobotFiles.join(", ")}`
                        );
                    }
                } catch (error) {
                    this.logger.debug(`[RobotFileService] Error searching for ${exactFileName}:`, error);
                }
            }
        } else {
            // No numbering found, try searching for just the item name
            const exactFileName = `${normalizedName}.robot`;
            try {
                const allRobotFiles = await this.findAllRobotFiles(outputPath, exactFileName);
                foundRobotFiles.push(...allRobotFiles);
                if (allRobotFiles.length > 0) {
                    this.logger.debug(
                        `[RobotFileService] Found files for ${exactFileName}: ${allRobotFiles.join(", ")}`
                    );
                }
            } catch (error) {
                this.logger.debug(`[RobotFileService] Error searching for ${exactFileName}:`, error);
            }
        }

        return foundRobotFiles;
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
     * Shows a warning dialog if duplicate robot files are found.
     * This can happen when the test generation path is not cleared before generating new tests.
     * @param duplicateFiles Array of duplicate file paths
     * @param targetFilePath The target file path that was requested to be opened
     * @returns Promise that resolves when the user makes a selection
     */
    public async showDuplicateFileWarning(
        duplicateFiles: string[],
        targetFilePath: string
    ): Promise<string | undefined> {
        try {
            const workspaceLocation = await validateAndReturnWorkspaceLocation();
            if (!workspaceLocation) {
                this.logger.error(
                    "[RobotFileService] Cannot show duplicate file warning: workspace location not available"
                );
                return undefined;
            }

            const relativePaths = duplicateFiles.map((filePath) => {
                return path.relative(workspaceLocation, filePath);
            });

            const options = relativePaths.map((relativePath, index) => ({
                label: relativePath,
                description: duplicateFiles[index] === targetFilePath ? "(Expected location)" : "",
                detail: duplicateFiles[index]
            }));

            const selected = await vscode.window.showQuickPick(options, {
                placeHolder: "Select a file to open",
                ignoreFocusOut: true
            });

            return selected?.detail;
        } catch (error) {
            this.logger.error("[RobotFileService] Error showing duplicate file warning:", error);
            return undefined;
        }
    }
}
