/**
 * @file src/test/ui/utils/filesystemUtils.ts
 * @description Filesystem verification helpers for generated Robot Framework artifacts.
 */

import * as fs from "fs";
import * as path from "path";
import { getRobotOutputDirectory } from "../config/testConfig";
import { getTestLogger } from "./testLogger";

const logger = getTestLogger();

/**
 * Result of filesystem verification for generated Robot Framework files.
 */
export interface FilesystemVerificationResult {
    /** Whether the verification was successful */
    success: boolean;
    /** List of .robot files found in the output directory */
    foundFiles: string[];
    /** List of expected files that were not found (if patterns provided) */
    missingFiles: string[];
    /** Total count of .robot files found */
    totalCount: number;
    /** Whether an __init__.robot file was found (indicates test suite folder) */
    hasInitFile: boolean;
    /** The output directory that was checked */
    outputDirectory: string;
    /** Error message if verification failed */
    error?: string;
}

/**
 * Recursively finds all files matching a pattern in a directory.
 *
 * @param dir - The directory to search
 * @param pattern - Regular expression pattern to match file names
 * @param results - Array to collect results (used for recursion)
 * @returns Array of absolute file paths
 */
function findFilesRecursive(dir: string, pattern: RegExp, results: string[] = []): string[] {
    try {
        if (!fs.existsSync(dir)) {
            return results;
        }

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                findFilesRecursive(fullPath, pattern, results);
            } else if (pattern.test(entry.name)) {
                results.push(fullPath);
            }
        }
    } catch (error) {
        logger.debug("Filesystem", `Error scanning directory ${dir}: ${error}`);
    }
    return results;
}

/**
 * Verifies that generated Robot Framework files exist on the filesystem.
 * This function checks the output directory for .robot files after test generation.
 *
 * @param workspaceRoot - Optional workspace root path. If not provided, uses default test workspace.
 * @param expectedPatterns - Optional array of file name patterns to verify exist (e.g., ["TestTheme", "__init__"])
 * @returns Promise<FilesystemVerificationResult> - Verification result with found/missing files
 */
export async function verifyGeneratedFilesExist(
    workspaceRoot?: string,
    expectedPatterns?: string[]
): Promise<FilesystemVerificationResult> {
    const outputDir = getRobotOutputDirectory(workspaceRoot);
    const result: FilesystemVerificationResult = {
        success: false,
        foundFiles: [],
        missingFiles: [],
        totalCount: 0,
        hasInitFile: false,
        outputDirectory: outputDir
    };

    try {
        logger.info("Filesystem", `Verifying generated files in: ${outputDir}`);

        if (!fs.existsSync(outputDir)) {
            result.error = `Output directory does not exist: ${outputDir}`;
            logger.warn("Filesystem", result.error);
            return result;
        }

        // Find all .robot files recursively
        const robotFiles = findFilesRecursive(outputDir, /\.robot$/i);
        result.foundFiles = robotFiles;
        result.totalCount = robotFiles.length;

        // Check for __init__.robot
        result.hasInitFile = robotFiles.some((f) => path.basename(f) === "__init__.robot");

        logger.info("Filesystem", `Found ${result.totalCount} .robot file(s)`);
        if (result.hasInitFile) {
            logger.info("Filesystem", "__init__.robot file found (test suite folder structure)");
        }

        // Log found files
        for (const file of robotFiles) {
            const relativePath = path.relative(outputDir, file);
            logger.debug("Filesystem", `  Found: ${relativePath}`);
        }

        // Check for expected patterns if provided
        if (expectedPatterns && expectedPatterns.length > 0) {
            for (const pattern of expectedPatterns) {
                const patternRegex = new RegExp(pattern, "i");
                const matchFound = robotFiles.some((f) => patternRegex.test(path.basename(f)));
                if (!matchFound) {
                    result.missingFiles.push(pattern);
                    logger.warn("Filesystem", `No file matching pattern "${pattern}" found`);
                } else {
                    logger.info("Filesystem", `File matching pattern "${pattern}" found`);
                }
            }
        }

        result.success = result.totalCount > 0 && result.missingFiles.length === 0;

        if (result.success) {
            logger.info("Filesystem", "Filesystem verification passed");
        } else if (result.totalCount === 0) {
            result.error = "No .robot files found in output directory";
            logger.warn("Filesystem", result.error);
        } else if (result.missingFiles.length > 0) {
            result.error = `Missing expected files: ${result.missingFiles.join(", ")}`;
            logger.warn("Filesystem", result.error);
        }

        return result;
    } catch (error) {
        result.error = `Error verifying files: ${error}`;
        logger.error("Filesystem", result.error);
        return result;
    }
}

/**
 * Reads the content of a generated .robot file from the filesystem.
 *
 * @param filePath - Absolute path to the .robot file
 * @returns File content as string, or null if file doesn't exist or can't be read
 */
export function readRobotFileContent(filePath: string): string | null {
    try {
        if (!fs.existsSync(filePath)) {
            logger.warn("Filesystem", `File does not exist: ${filePath}`);
            return null;
        }
        const content = fs.readFileSync(filePath, "utf-8");
        logger.debug("Filesystem", `Read ${content.length} bytes from ${path.basename(filePath)}`);
        return content;
    } catch (error) {
        logger.error("Filesystem", `Error reading file ${filePath}: ${error}`);
        return null;
    }
}

/**
 * Verifies that a specific .robot file exists and contains expected metadata.
 *
 * @param filePath - Absolute path to the .robot file
 * @param expectedMetadata - Object with expected metadata keys and values
 * @returns Object with verification results
 */
export function verifyRobotFileMetadata(
    filePath: string,
    expectedMetadata: { uniqueID?: string; name?: string; numbering?: string }
): { valid: boolean; foundMetadata: Record<string, string | null>; errors: string[] } {
    const result = {
        valid: true,
        foundMetadata: {} as Record<string, string | null>,
        errors: [] as string[]
    };

    const content = readRobotFileContent(filePath);
    if (!content) {
        result.valid = false;
        result.errors.push(`Could not read file: ${filePath}`);
        return result;
    }

    // Verify *** Settings *** section exists
    if (!content.includes("*** Settings ***")) {
        result.valid = false;
        result.errors.push("File does not contain *** Settings *** section");
    }

    // Extract and verify metadata
    const extractMetadata = (key: string): string | null => {
        const pattern = new RegExp(`Metadata\\s+${key}\\s+([^\\n\\r]+)`, "i");
        const match = content.match(pattern);
        return match && match[1] ? match[1].trim() : null;
    };

    result.foundMetadata["UniqueID"] = extractMetadata("UniqueID");
    result.foundMetadata["Name"] = extractMetadata("Name");
    result.foundMetadata["Numbering"] = extractMetadata("Numbering");

    // Verify expected values match
    if (expectedMetadata.uniqueID && result.foundMetadata["UniqueID"] !== expectedMetadata.uniqueID) {
        result.valid = false;
        result.errors.push(
            `UniqueID mismatch: expected "${expectedMetadata.uniqueID}", found "${result.foundMetadata["UniqueID"]}"`
        );
    }

    if (expectedMetadata.name && result.foundMetadata["Name"] !== expectedMetadata.name) {
        result.valid = false;
        result.errors.push(
            `Name mismatch: expected "${expectedMetadata.name}", found "${result.foundMetadata["Name"]}"`
        );
    }

    if (expectedMetadata.numbering && result.foundMetadata["Numbering"] !== expectedMetadata.numbering) {
        result.valid = false;
        result.errors.push(
            `Numbering mismatch: expected "${expectedMetadata.numbering}", found "${result.foundMetadata["Numbering"]}"`
        );
    }

    if (result.valid) {
        logger.info("Filesystem", `Metadata verification passed for ${path.basename(filePath)}`);
    } else {
        logger.warn("Filesystem", `Metadata verification failed: ${result.errors.join("; ")}`);
    }

    return result;
}

/**
 * Counts the total number of .robot files in the output directory.
 * Useful for verifying expected file count after generation.
 *
 * @param workspaceRoot - Optional workspace root path
 * @returns Number of .robot files found
 */
export function countGeneratedRobotFiles(workspaceRoot?: string): number {
    const outputDir = getRobotOutputDirectory(workspaceRoot);
    if (!fs.existsSync(outputDir)) {
        return 0;
    }
    const robotFiles = findFilesRecursive(outputDir, /\.robot$/i);
    return robotFiles.length;
}

/**
 * Gets a list of all generated .robot file paths.
 *
 * @param workspaceRoot - Optional workspace root path
 * @returns Array of absolute file paths
 */
export function getGeneratedRobotFiles(workspaceRoot?: string): string[] {
    const outputDir = getRobotOutputDirectory(workspaceRoot);
    if (!fs.existsSync(outputDir)) {
        return [];
    }
    return findFilesRecursive(outputDir, /\.robot$/i);
}

/**
 * Clears all generated .robot files from the output directory.
 * Useful for test cleanup.
 *
 * @param workspaceRoot - Optional workspace root path
 * @returns Number of files deleted
 */
export function clearGeneratedRobotFiles(workspaceRoot?: string): number {
    const outputDir = getRobotOutputDirectory(workspaceRoot);
    if (!fs.existsSync(outputDir)) {
        return 0;
    }

    let deletedCount = 0;
    const robotFiles = findFilesRecursive(outputDir, /\.robot$/i);

    for (const file of robotFiles) {
        try {
            fs.unlinkSync(file);
            deletedCount++;
            logger.debug("Filesystem", `Deleted: ${path.basename(file)}`);
        } catch (error) {
            logger.warn("Filesystem", `Failed to delete ${file}: ${error}`);
        }
    }

    // Also try to remove empty directories
    try {
        const dirs = fs.readdirSync(outputDir, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const dir of dirs) {
            const dirPath = path.join(outputDir, dir.name);
            const contents = fs.readdirSync(dirPath);
            if (contents.length === 0) {
                fs.rmdirSync(dirPath);
                logger.debug("Filesystem", `Removed empty directory: ${dir.name}`);
            }
        }
    } catch {
        // Ignore directory cleanup errors
    }

    logger.info("Filesystem", `Cleared ${deletedCount} .robot file(s) from output directory`);
    return deletedCount;
}
