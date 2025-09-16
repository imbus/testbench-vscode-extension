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
                this.logger.error(
                    "[RobotFileService] Workspace location is not available while checking robot file existence"
                );
                return { exists: false };
            }

            const generatedRobotFilesOutputDirectory = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_OUTPUT_DIR);
            if (!generatedRobotFilesOutputDirectory) {
                this.logger.error(
                    "[RobotFileService] Output directory is not configured while checking robot file existence"
                );
                return { exists: false };
            }

            const robotFileName = this.generateRobotFileName(item.data.base.name, item.data.base.numbering);
            const outputPath = path.join(workspaceLocation, generatedRobotFilesOutputDirectory);

            // this.logger.trace(`[RobotFileService] Searching for robot file "${robotFileName}" in output directory: ${outputPath}`);

            // Recursively search for robot files
            const foundRobotFiles = await this.findAllRobotFiles(outputPath, robotFileName);

            if (foundRobotFiles.length === 0) {
                // this.logger.trace(`[RobotFileService] No robot files found for item "${item.data.base.name}"`);
                return {
                    exists: false,
                    fileName: robotFileName
                };
            }

            if (foundRobotFiles.length === 1) {
                const robotFilePath = foundRobotFiles[0];
                if (await this.validateRobotFileForTreeItem(robotFilePath, item)) {
                    this.logger.trace(
                        `[RobotFileService] Found single valid robot file for item "${item.data.base.name}": ${robotFilePath}`
                    );
                    return {
                        exists: true,
                        filePath: robotFilePath,
                        fileName: robotFileName
                    };
                } else {
                    this.logger.trace(
                        `[RobotFileService] Found robot file but validation failed for item "${item.data.base.name}": ${robotFilePath}`
                    );
                    return {
                        exists: false,
                        fileName: robotFileName
                    };
                }
            }

            // Multiple .robot files found, determine correct / best one based on metadata validation
            this.logger.trace(
                `[RobotFileService] Found ${foundRobotFiles.length} robot files for item "${item.data.base.name}", validating to find correct match`
            );

            const validFiles: string[] = [];
            for (const filePath of foundRobotFiles) {
                if (await this.validateRobotFileForTreeItem(filePath, item)) {
                    validFiles.push(filePath);
                }
            }

            if (validFiles.length === 1) {
                this.logger.trace(
                    `[RobotFileService] Found single valid robot file among multiple candidates for item "${item.data.base.name}": ${validFiles[0]}`
                );
                return {
                    exists: true,
                    filePath: validFiles[0],
                    fileName: robotFileName,
                    duplicateFiles: foundRobotFiles
                };
            } else if (validFiles.length > 1) {
                this.logger.warn(
                    `[RobotFileService] Multiple valid robot files found for item "${item.data.base.name}": ${validFiles.join(", ")}`
                );
                // Fallback: Return the first valid file
                return {
                    exists: true,
                    filePath: validFiles[0],
                    fileName: robotFileName,
                    duplicateFiles: foundRobotFiles
                };
            } else {
                this.logger.warn(
                    `[RobotFileService] Found ${foundRobotFiles.length} robot files but none are valid for item "${item.data.base.name}"`
                );
                return {
                    exists: false,
                    fileName: robotFileName,
                    duplicateFiles: foundRobotFiles
                };
            }
        } catch (error) {
            this.logger.error(`[RobotFileService] Error checking robot file existence:`, error);
            return { exists: false };
        }
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
     * Generates a robot file name based on the item name and numbering to generate the correct file suffix.
     * Replaces invalid file path characters with underscores because
     * testbench2robotframework replaces following special characters of a test theme / test case set name:
     * < > : " / \ | ? * and spaces.
     * @param treeItemName The name of the test theme or test case set
     * @param treeItemNumbering The numbering prefix for the tree item
     * @returns The generated robot file name
     */
    private generateRobotFileName(treeItemName: string, treeItemNumbering: string): string {
        const lastNumberingPart = treeItemNumbering ? treeItemNumbering.split(".")?.pop() || treeItemNumbering : "";
        const prefixOfFileName = lastNumberingPart ? `${lastNumberingPart}_` : "";
        // Characters to replace with underscore:
        // ["<", ">", ":", "\"", "/", "\\", "|", "?", "*", " "]
        const normalizedName = treeItemName.replace(/[<>:"/\\|?*\s]/g, "_");

        return `${prefixOfFileName}${normalizedName}.robot`;
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
                    "[RobotFileService] Workspace location is not available. Cannot show duplicate file warning."
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
