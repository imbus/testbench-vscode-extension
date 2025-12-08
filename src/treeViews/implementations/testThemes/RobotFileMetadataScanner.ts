/**
 * @file src/treeViews/implementations/testThemes/RobotFileMetadataScanner.ts
 * @description Captures generation metadata by scanning the generated output directory
 * and extracting UniqueID from robot files to map them to tree items.
 */

import * as fs from "fs";
import * as path from "path";
import { TestBenchLogger } from "../../../testBenchLogger";
import { GeneratedFileMapper } from "./GeneratedFileMapper";
import { validateAndReturnWorkspaceLocation } from "../../../utils";

export class RobotFileMetadataScanner {
    constructor(
        private readonly logger: TestBenchLogger,
        private readonly metadataService: GeneratedFileMapper
    ) {}

    /**
     * Scans the output directory after test generation and captures metadata
     * @param outputDirectory The output directory (relative to workspace)
     * @param logSuiteNumbering Whether log suite numbering was enabled
     * @returns Promise that resolves to the number of items captured
     */
    public async captureGenerationMetadata(outputDirectory: string, logSuiteNumbering: boolean): Promise<number> {
        this.logger.debug(`[RobotFileMetadataScanner] Starting metadata capture for directory: ${outputDirectory}`);

        const workspaceLocation = await validateAndReturnWorkspaceLocation();
        if (!workspaceLocation) {
            this.logger.warn("[RobotFileMetadataScanner] No workspace location available");
            return 0;
        }

        await this.metadataService.startMetadataGeneration(outputDirectory, logSuiteNumbering);

        const absoluteOutputPath = path.join(workspaceLocation, outputDirectory);
        if (!fs.existsSync(absoluteOutputPath)) {
            this.logger.warn(`[RobotFileMetadataScanner] Output directory does not exist: ${absoluteOutputPath}`);
            return 0;
        }

        let capturedCount = 0;
        await this.scanDirectory(absoluteOutputPath, workspaceLocation, outputDirectory, (_itemData) => {
            capturedCount++;
        });

        this.logger.info(`[RobotFileMetadataScanner] Captured metadata for ${capturedCount} generated items`);
        return capturedCount;
    }

    /**
     * Recursively scans a directory for robot files and folders and captures metadata
     * @param dirPath Absolute path to the directory
     * @param workspaceLocation Absolute workspace location
     * @param relativeBasePath Relative path from workspace to output directory
     * @param onItemFound Callback when an item is found and processed
     */
    private async scanDirectory(
        dirPath: string,
        workspaceLocation: string,
        relativeBasePath: string,
        onItemFound: (itemData: { uniqueID: string; name: string; type: "file" | "folder" }) => void
    ): Promise<void> {
        try {
            const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
            const robotFiles: fs.Dirent[] = [];
            const subDirs: fs.Dirent[] = [];

            // Separate files and directories
            for (const item of items) {
                if (item.isFile() && item.name.endsWith(".robot")) {
                    robotFiles.push(item);
                } else if (item.isDirectory()) {
                    subDirs.push(item);
                }
            }

            for (const file of robotFiles) {
                const filePath = path.join(dirPath, file.name);
                const uniqueID = await this.extractUniqueIDFromRobotFile(filePath);

                if (uniqueID) {
                    const relativePath = path.relative(workspaceLocation, filePath);
                    const { name, numbering } = await this.extractMetadataFromRobotFile(filePath);

                    await this.metadataService.recordGeneratedFile(uniqueID, name, numbering, relativePath);

                    onItemFound({ uniqueID, name, type: "file" });
                    this.logger.trace(`[RobotFileMetadataScanner] Captured file: ${file.name} -> ${uniqueID}`);
                }
            }

            // Process subdirectories (test themes)
            for (const dir of subDirs) {
                const subDirPath = path.join(dirPath, dir.name);
                const relativePath = path.relative(workspaceLocation, subDirPath);

                // Try to find a representative robot file in this directory to get the theme's uniqueID
                const themeUniqueID = await this.findThemeUniqueID(subDirPath);

                if (themeUniqueID) {
                    const allChildRobotFiles = await this.collectChildRobotFiles(subDirPath, workspaceLocation);
                    const { name, numbering } = await this.extractInfoFromFolder(subDirPath, dir.name);

                    await this.metadataService.recordGeneratedFolder(
                        themeUniqueID,
                        name,
                        numbering,
                        relativePath,
                        allChildRobotFiles
                    );

                    onItemFound({ uniqueID: themeUniqueID, name, type: "folder" });
                    this.logger.trace(`[RobotFileMetadataScanner] Captured folder: ${dir.name} -> ${themeUniqueID}`);
                }

                await this.scanDirectory(subDirPath, workspaceLocation, relativeBasePath, onItemFound);
            }
        } catch (error) {
            this.logger.error(`[RobotFileMetadataScanner] Error scanning directory ${dirPath}:`, error);
        }
    }

    /**
     * Extracts UniqueID from a robot file
     * @param filePath Absolute path to the robot file
     * @returns The UniqueID or null if not found
     */
    private async extractUniqueIDFromRobotFile(filePath: string): Promise<string | null> {
        try {
            const content = await fs.promises.readFile(filePath, "utf-8");
            const match = content.match(/Metadata\s+UniqueID\s+(.+)/);
            return match ? match[1].trim() : null;
        } catch (error) {
            this.logger.error(`[RobotFileMetadataScanner] Error reading file ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Extracts name and numbering from a robot file
     * @param filePath Absolute path to the robot file
     * @returns Object with name and numbering
     */
    private async extractMetadataFromRobotFile(filePath: string): Promise<{ name: string; numbering: string }> {
        try {
            const content = await fs.promises.readFile(filePath, "utf-8");

            const nameMatch = content.match(/Metadata\s+Name\s+(.+)/);
            const numberingMatch = content.match(/Metadata\s+Numbering\s+(.+)/);

            return {
                name: nameMatch ? nameMatch[1].trim() : path.basename(filePath, ".robot"),
                numbering: numberingMatch ? numberingMatch[1].trim() : ""
            };
        } catch (error) {
            this.logger.error(`[RobotFileMetadataScanner] Error extracting metadata from ${filePath}:`, error);
            return {
                name: path.basename(filePath, ".robot"),
                numbering: ""
            };
        }
    }

    /**
     * Attempts to find a theme's uniqueID by looking for a __init__.robot file
     * @param dirPath Absolute path to the theme directory
     * @returns The theme's uniqueID or null if not found
     */
    private async findThemeUniqueID(dirPath: string): Promise<string | null> {
        try {
            const initFilePath = path.join(dirPath, "__init__.robot");
            if (fs.existsSync(initFilePath)) {
                const uniqueID = await this.extractUniqueIDFromRobotFile(initFilePath);
                if (uniqueID) {
                    return uniqueID;
                }
            }

            return null;
        } catch (error) {
            this.logger.error(`[RobotFileMetadataScanner] Error finding theme uniqueID in ${dirPath}:`, error);
            return null;
        }
    }

    /**
     * Collects all robot file paths within a directory tree
     * @param dirPath Absolute path to search
     * @param workspaceLocation Workspace location for relative path calculation
     * @returns Array of relative paths to robot files
     */
    private async collectChildRobotFiles(dirPath: string, workspaceLocation: string): Promise<string[]> {
        const robotFiles: string[] = [];

        const scan = async (currentPath: string): Promise<void> => {
            try {
                const items = await fs.promises.readdir(currentPath, { withFileTypes: true });

                for (const item of items) {
                    const fullPath = path.join(currentPath, item.name);

                    if (item.isFile() && item.name.endsWith(".robot")) {
                        const relativePath = path.relative(workspaceLocation, fullPath);
                        robotFiles.push(relativePath);
                    } else if (item.isDirectory()) {
                        await scan(fullPath);
                    }
                }
            } catch (error) {
                this.logger.error(`[RobotFileMetadataScanner] Error scanning ${currentPath}:`, error);
            }
        };

        await scan(dirPath);
        return robotFiles;
    }

    /**
     * Extracts name and numbering from a folder by reading robot files inside it
     * Falls back to parsing folder name if metadata not available
     * @param folderPath Absolute path to the folder
     * @param folderName The folder name as fallback
     * @returns Object with name and numbering
     */
    private async extractInfoFromFolder(
        folderPath: string,
        folderName: string
    ): Promise<{ name: string; numbering: string }> {
        try {
            // Read metadata from __init__.robot or first robot file
            const initFilePath = path.join(folderPath, "__init__.robot");
            let metadataSource: string | null = null;

            if (fs.existsSync(initFilePath)) {
                metadataSource = initFilePath;
            } else {
                // Find first .robot file
                const items = await fs.promises.readdir(folderPath, { withFileTypes: true });
                const firstRobotFile = items.find((item) => item.isFile() && item.name.endsWith(".robot"));
                if (firstRobotFile) {
                    metadataSource = path.join(folderPath, firstRobotFile.name);
                }
            }

            if (metadataSource) {
                const metadata = await this.extractMetadataFromRobotFile(metadataSource);
                if (metadata.name && metadata.numbering) {
                    return metadata;
                }
            }
        } catch (error) {
            this.logger.trace(`[RobotFileMetadataScanner] Could not extract metadata from folder contents: ${error}`);
        }

        // Fallback: Parse folder name
        // Pattern: "1_Name" or "1__Name" or "1.2_Name" etc.
        const match = folderName.match(/^([\d.]+)_+(.+)$/);

        if (match) {
            return {
                numbering: match[1],
                name: match[2].replace(/_/g, " ") // Convert underscores back to spaces
            };
        }

        return {
            name: folderName,
            numbering: ""
        };
    }
}
