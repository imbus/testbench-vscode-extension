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
        const use_config_file: boolean | undefined = getExtensionSetting<boolean>(ConfigKeys.USE_CONFIG_FILE_SETTING);
        const clean: boolean | undefined = getExtensionSetting<boolean>(ConfigKeys.TB2ROBOT_CLEAN);
        const compound_interaction_logging: string | undefined = getExtensionSetting<string>(
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
        const resourceDirectory: string | undefined = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_DIR);
        const resourceMapping: string[] | undefined = getExtensionSetting<string[]>(
            ConfigKeys.TB2ROBOT_RESOURCE_MAPPING
        );
        const resourceMarker: string | undefined = getExtensionSetting<string>(ConfigKeys.TB2ROBOT_RESOURCE_MARKER);
        const resourceRoot: string[] | undefined = getExtensionSetting<string[]>(ConfigKeys.TB2ROBOT_RESOURCE_ROOT);

        try {
            logger.debug(
                `Test generation command parameters: output_directory=${outputDirectory}, resource_directory=${resourceDirectory}, use_config_file=${use_config_file}, clean=${clean}, report path: ${reportPath}`
            );

            const result = await vscode.commands.executeCommand("testbench_ls.generateTestSuites", {
                use_config_file: use_config_file,
                clean: clean,
                compound_interaction_logging: compound_interaction_logging,
                config: use_config_file,
                fully_qualified: fully_qualified,
                library_marker: libraryMarker,
                library_root: libraryRoot,
                log_suite_numbering: logSuiteNumbering,
                output_directory: outputDirectory,
                resource_directory: resourceDirectory,
                resource_marker: resourceMarker,
                resource_root: resourceRoot,
                library_mapping: libraryMapping,
                resource_mapping: resourceMapping,
                testbench_report: reportPath
            });

            if (result === true) {
                isGenerateTestsCommandSuccessful = true;
            } else if (result === false) {
                isGenerateTestsCommandSuccessful = false;
            } else if (result === null || result === undefined) {
                // Command executed successfully but returned no value
                isGenerateTestsCommandSuccessful = true;
            } else {
                // Handle any other value as success
                logger.debug(`Unexpected command result: ${result}, treating as success`);
                isGenerateTestsCommandSuccessful = true;
            }
        } catch (error) {
            logger.error("Error executing testbench2robotframework test generation command:", error);
            logger.error(`Error details: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                logger.error(`Error stack: ${error.stack}`);
            }
            isGenerateTestsCommandSuccessful = false;
        }

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
        logger.debug(`Starting tb2robot ${fetchResultsCommand} command.`);
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
