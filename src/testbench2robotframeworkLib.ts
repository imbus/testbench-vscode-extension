/**
 * @file testbench2robotframeworkLib.ts
 * @description Provides functions for executing Testbench2Robotframework commands:
 * generating tests, fetching results, and displaying version information.
 */

import * as vscode from "vscode";
import * as fsPromise from "fs/promises";
import type { Dirent } from "fs";
import * as path from "path";
import { logger } from "./extension";
import { ConfigKeys } from "./constants";
import { getExtensionSetting } from "./configuration";
import { validateAndReturnWorkspaceLocation } from "./utils";

/**
 * Result of a test generation operation, indicating both command success
 * and whether any .robot files were actually created or modified.
 */
export interface TestGenerationResult {
    /** Whether the language server command completed successfully */
    commandSucceeded: boolean;
    /** Whether any .robot files were actually created or modified in the output directory */
    testsWereGenerated: boolean;
}

interface RobotFileSnapshot {
    mtimeMs: number;
    ctimeMs: number;
    size: number;
}

const ROBOT_SCAN_MAX_CONCURRENCY = 16;

class AsyncSemaphore {
    private readonly waitQueue: Array<() => void> = [];
    private activeCount = 0;

    constructor(private readonly maxConcurrency: number) {}

    public async run<T>(task: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await task();
        } finally {
            this.release();
        }
    }

    private acquire(): Promise<void> {
        if (this.activeCount < this.maxConcurrency) {
            this.activeCount++;
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            this.waitQueue.push(() => {
                this.activeCount++;
                resolve();
            });
        });
    }

    private release(): void {
        this.activeCount--;
        const next = this.waitQueue.shift();
        if (next) {
            next();
        }
    }
}

/**
 * Collects .robot file paths and their modification times from a directory recursively.
 *
 * @param {string} dir Root directory to scan recursively for `.robot` files.
 * @returns {Promise<Map<string, RobotFileSnapshot>>} A map of absolute `.robot` file paths to file metadata snapshots.
 */
async function collectRobotFileTimestamps(
    dir: string,
    semaphore: AsyncSemaphore = new AsyncSemaphore(ROBOT_SCAN_MAX_CONCURRENCY)
): Promise<Map<string, RobotFileSnapshot>> {
    const files = new Map<string, RobotFileSnapshot>();
    let entries: Dirent[] = [];
    try {
        entries = await semaphore.run(() => fsPromise.readdir(dir, { withFileTypes: true }));
    } catch {
        // Directory doesn't exist or can't be read.
        return files;
    }

    const tasks = entries.map(async (entry) => {
        const entryPath = path.join(dir, entry.name);
        try {
            if (entry.isDirectory()) {
                const subFiles = await collectRobotFileTimestamps(entryPath, semaphore);
                subFiles.forEach((snapshot, filePath) => files.set(filePath, snapshot));
            } else if (entry.isFile() && entry.name.endsWith(".robot")) {
                const stats = await semaphore.run(() => fsPromise.stat(entryPath));
                files.set(entryPath, {
                    mtimeMs: stats.mtimeMs,
                    ctimeMs: stats.ctimeMs,
                    size: stats.size
                });
            }
        } catch {
            // Skip unreadable entries so one file does not abort the whole snapshot.
        }
    });

    await Promise.all(tasks);

    return files;
}

/**
 * Checks if any .robot files were created or modified by comparing before/after snapshots.
 *
 * @param {Map<string, RobotFileSnapshot>} before Snapshot collected before generation, keyed by absolute file path.
 * @param {Map<string, RobotFileSnapshot>} after Snapshot collected after generation, keyed by absolute file path.
 * @returns {boolean} `true` if at least one `.robot` file is new or has changed metadata.
 */
function wereRobotFilesCreatedOrModified(
    before: Map<string, RobotFileSnapshot>,
    after: Map<string, RobotFileSnapshot>
): boolean {
    for (const [filePath, currentSnapshot] of after) {
        const previousSnapshot = before.get(filePath);
        if (previousSnapshot === undefined) {
            return true;
        }

        if (
            currentSnapshot.mtimeMs !== previousSnapshot.mtimeMs ||
            currentSnapshot.ctimeMs !== previousSnapshot.ctimeMs ||
            currentSnapshot.size !== previousSnapshot.size
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Resolves the configured output directory to a full filesystem path.
 * The extension setting is intended to be relative to the workspace root.
 *
 * @param {string} workspaceLocation Absolute workspace root path.
 * @param {string} outputDirectory Configured output directory from extension settings.
 * @returns {string} Absolute output directory path used for file-system checks.
 */
function resolveOutputDirectoryPath(workspaceLocation: string, outputDirectory: string): string {
    if (path.isAbsolute(outputDirectory)) {
        logger.warn(
            "[testbench2robotframeworkLib] testbenchExtension.outputDirectory is configured as an absolute path, but the setting is intended to be workspace-relative."
        );
    }
    return path.resolve(workspaceLocation, outputDirectory);
}

/**
 * Class representing the Testbench2Robotframework library wrapper.
 */
export class tb2robotLib {
    /**
     * Entry point for starting test generation via tb2robot.
     *
     * @param {string} reportPath - Path to a folder or ZIP file containing TestBench JSON reports.
     * @returns {Promise<TestGenerationResult>} A promise that resolves with the generation outcome.
     */
    public static async startTb2robotframeworkTestGeneration(reportPath: string): Promise<TestGenerationResult> {
        let isGenerateTestsCommandSuccessful: boolean = false;
        // use_config_file temporarily disabled (tbe-162)
        const use_config_file: boolean | undefined = false; // getExtensionSetting<boolean>(ConfigKeys.USE_CONFIG_FILE_SETTING);
        const clean: boolean | undefined = getExtensionSetting<boolean>(ConfigKeys.TB2ROBOT_CLEAN);
        const compound_keyword_logging: string | undefined = getExtensionSetting<string>(
            ConfigKeys.TB2ROBOT_COMPOUND_LOGGING
        );
        const fully_qualified: boolean | undefined = getExtensionSetting<boolean>(ConfigKeys.TB2ROBOT_FULLY_QUALIFIED);
        const libraryMapping: string[] | undefined = getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_LIBRARY_MAPPING);
        const libraryMarker: string | undefined = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_LIBRARY_MARKER);
        const libraryRoot: string[] | undefined = getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_LIBRARY_ROOT);
        const logSuiteNumbering: boolean | undefined = getExtensionSetting<boolean>(
            ConfigKeys.TB2ROBOT_LOG_SUITE_NUMBERING
        );
        const outputDirectory: string | undefined = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_OUTPUT_DIR);
        const resourceDirectoryRegex: string | undefined = getExtensionSetting<string>(
            ConfigKeys.TB2ROBOT_RESOURCE_DIRECTORY_MARKER
        );
        const resourceDirectory: string | undefined = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_DIR);
        const resourceMapping: string[] | undefined = getExtensionSetting<string[]>(
            ConfigKeys.TB2ROBOT_RESOURCE_MAPPING
        );
        const resourceMarker: string | undefined = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_MARKER);
        const resourceRoot: string[] | undefined = getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_RESOURCE_ROOT);

        // Snapshot .robot files in output directory before generation.
        let robotFilesBefore = new Map<string, RobotFileSnapshot>();
        let outputDirFullPath: string | undefined;
        if (outputDirectory) {
            const workspaceLocation = await validateAndReturnWorkspaceLocation();
            if (workspaceLocation) {
                outputDirFullPath = resolveOutputDirectoryPath(workspaceLocation, outputDirectory);
                robotFilesBefore = await collectRobotFileTimestamps(outputDirFullPath);
            }
        }

        isGenerateTestsCommandSuccessful = await vscode.commands.executeCommand("testbench_ls.generateTestSuites", {
            use_config_file: use_config_file,
            clean: clean,
            compound_keyword_logging: compound_keyword_logging,
            config: use_config_file,
            fully_qualified: fully_qualified,
            library_marker: libraryMarker,
            library_root: libraryRoot,
            log_suite_numbering: logSuiteNumbering,
            output_directory: outputDirectory,
            resource_directory: resourceDirectory,
            resource_directory_regex: resourceDirectoryRegex,
            resource_marker: resourceMarker,
            resource_root: resourceRoot,
            library_mapping: libraryMapping,
            resource_mapping: resourceMapping,
            testbench_report: reportPath
        });

        if (!isGenerateTestsCommandSuccessful) {
            return { commandSucceeded: false, testsWereGenerated: false };
        }

        // Check if any .robot files were actually created or modified.
        let testsWereGenerated = true; // Default true when we cannot verify.
        if (outputDirFullPath) {
            const robotFilesAfter = await collectRobotFileTimestamps(outputDirFullPath);
            testsWereGenerated = wereRobotFilesCreatedOrModified(robotFilesBefore, robotFilesAfter);
            if (!testsWereGenerated) {
                logger.warn(
                    "[testbench2robotframeworkLib] Test generation command succeeded but no .robot files were created or modified in the output directory."
                );
            }
        }

        return { commandSucceeded: true, testsWereGenerated };
    }

    /**
     * Entry point for starting the tb2robot fetch-results command.
     *
     * @param {string} outputXmlPath - Path to the Robot Framework XML result file.
     * @param {string} reportPath - Path to a folder or ZIP file containing TestBench JSON reports.
     * @param {string} resultPath - (Optional) Path to save the results to.
     * @returns {Promise<boolean>} A promise that resolves to true if the command succeeds, false otherwise.
     */
    public static async startTb2robotFetchResults(
        outputXmlPath: string,
        reportPath: string,
        resultPath?: string
    ): Promise<boolean> {
        const fetchResultsCommand: string = `fetch-results`;
        logger.debug(`[testbench2robotframeworkLib] Starting tb2robot ${fetchResultsCommand} command.`);
        let isFetchResultsCommandSuccessful: boolean = true;
        try {
            await vscode.commands.executeCommand("testbench_ls.fetchResults", {
                robot_result: outputXmlPath,
                output_directory: resultPath,
                testbench_report: reportPath
            });
            isFetchResultsCommandSuccessful = true;
        } catch {
            isFetchResultsCommandSuccessful = false;
        }
        return isFetchResultsCommandSuccessful;
    }
}
