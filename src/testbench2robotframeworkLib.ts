/**
 * @file testbench2robotframeworkLib.ts
 * @description Provides functions for executing Testbench2Robotframework commands:
 * generating tests, fetching results, and displaying version information.
 */

import * as vscode from "vscode";
import { logger } from "./extension";
import { ConfigKeys } from "./constants";
import { getExtensionSetting } from "./configuration";

/**
 * Class representing the Testbench2Robotframework library wrapper.
 */
export class tb2robotLib {
    /**
     * Entry point for starting test generation via tb2robot.
     *
     * @param {string} reportPath - Path to a folder or ZIP file containing TestBench JSON reports.
     * @returns {Promise<boolean>} A promise that resolves to true if test generation succeeds, false otherwise.
     */
    public static async startTb2robotframeworkTestGeneration(reportPath: string): Promise<boolean> {
        let isGenerateTestsCommandSuccessful: boolean = false;
        const configurationScope = reportPath ? vscode.Uri.file(reportPath) : undefined;
        // use_config_file temporarily disabled (tbe-162)
        const use_config_file: boolean | undefined = false; // getExtensionSetting<boolean>(ConfigKeys.USE_CONFIG_FILE_SETTING);
        const clean: boolean | undefined = getExtensionSetting<boolean>(ConfigKeys.TB2ROBOT_CLEAN, configurationScope);
        const compound_keyword_logging: string | undefined = getExtensionSetting<string>(
            ConfigKeys.TB2ROBOT_COMPOUND_LOGGING,
            configurationScope
        );
        const fully_qualified: boolean | undefined = getExtensionSetting<boolean>(
            ConfigKeys.TB2ROBOT_FULLY_QUALIFIED,
            configurationScope
        );
        const libraryMapping: string[] | undefined = getExtensionSetting<string[]>(
            ConfigKeys.TB2ROBOT_LIBRARY_MAPPING,
            configurationScope
        );
        const libraryMarker: string | undefined = getExtensionSetting<string>(
            ConfigKeys.TB2ROBOT_LIBRARY_MARKER,
            configurationScope
        );
        const libraryRoot: string[] | undefined = getExtensionSetting<string[]>(
            ConfigKeys.TB2ROBOT_LIBRARY_ROOT,
            configurationScope
        );
        const logSuiteNumbering: boolean | undefined = getExtensionSetting<boolean>(
            ConfigKeys.TB2ROBOT_LOG_SUITE_NUMBERING,
            configurationScope
        );
        const outputDirectory: string | undefined = getExtensionSetting<string>(
            ConfigKeys.TB2ROBOT_OUTPUT_DIR,
            configurationScope
        );
        const resourceDirectoryRegex: string | undefined = getExtensionSetting<string>(
            ConfigKeys.TB2ROBOT_RESOURCE_DIRECTORY_MARKER,
            configurationScope
        );
        const resourceDirectory: string | undefined = getExtensionSetting<string>(
            ConfigKeys.TB2ROBOT_RESOURCE_DIR,
            configurationScope
        );
        const resourceMapping: string[] | undefined = getExtensionSetting<string[]>(
            ConfigKeys.TB2ROBOT_RESOURCE_MAPPING,
            configurationScope
        );
        const resourceMarker: string | undefined = getExtensionSetting<string>(
            ConfigKeys.TB2ROBOT_RESOURCE_MARKER,
            configurationScope
        );
        const resourceRoot: string[] | undefined = getExtensionSetting<string[]>(
            ConfigKeys.TB2ROBOT_RESOURCE_ROOT,
            configurationScope
        );
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

        return isGenerateTestsCommandSuccessful;
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
