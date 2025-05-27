/**
 * @file testbench2robotframeworkLib.ts
 * @description Provides functions for executing Testbench2Robotframework commands:
 * generating tests, fetching results, and displaying version information.
 */

import * as vscode from "vscode";
import { getConfig, logger } from "./extension";
import { ConfigKeys } from "./constants";
import { log } from "console";

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
        try {
            const testbench2robotframeworkConfiguration = getConfig();
            const clean: boolean | undefined = testbench2robotframeworkConfiguration.get<boolean>(
                ConfigKeys.TB2ROBOT_CLEAN
            );
            const compound_interaction_logging: string | undefined = testbench2robotframeworkConfiguration.get<string>(
                ConfigKeys.TB2ROBOT_COMPOUND_LOGGING
            );
            const configFile: string | undefined = testbench2robotframeworkConfiguration.get<string>(
                ConfigKeys.TB2ROBOT_CONFIG_PATH
            );
            const fully_qualified: boolean | undefined = testbench2robotframeworkConfiguration.get<boolean>(
                ConfigKeys.TB2ROBOT_FULLY_QUALIFIED
            );
            const libraryMapping: Record<string, string> | undefined = testbench2robotframeworkConfiguration.get<
                Record<string, string>
            >(ConfigKeys.TB2ROBOT_LIBRARY_MAPPING);
            const libraryRegex: string | undefined = testbench2robotframeworkConfiguration.get<string>(
                ConfigKeys.TB2ROBOT_LIBRARY_REGEX
            );
            const libraryRoot: string[] | undefined = testbench2robotframeworkConfiguration.get<string[]>(
                ConfigKeys.TB2ROBOT_LIBRARY_ROOT
            );
            const logSuiteNumbering: boolean | undefined = testbench2robotframeworkConfiguration.get<boolean>(
                ConfigKeys.TB2ROBOT_LOG_SUITE_NUMBERING
            );
            const outputDirectory: string | undefined = testbench2robotframeworkConfiguration.get<string>(
                ConfigKeys.TB2ROBOT_OUTPUT_DIR
            );
            const resourceDirectory: string | undefined = testbench2robotframeworkConfiguration.get<string>(
                ConfigKeys.TB2ROBOT_RESOURCE_DIR
            );
            const resourceMapping: Record<string, string> | undefined = testbench2robotframeworkConfiguration.get<
                Record<string, string>
            >(ConfigKeys.TB2ROBOT_RESOURCE_MAPPING);
            const resourceRegex: string | undefined = testbench2robotframeworkConfiguration.get<string>(
                ConfigKeys.TB2ROBOT_RESOURCE_REGEX
            );
            const resourceRoot: string[] | undefined = testbench2robotframeworkConfiguration.get<string[]>(
                ConfigKeys.TB2ROBOT_RESOURCE_ROOT
            );

            logger.info(`clean parameter: clean=${clean}`);
            logger.info(
                `compound_interaction_logging parameter: compound_interaction_logging=${compound_interaction_logging}`
            );
            logger.info(`config parameter: configFile=${configFile}`);
            logger.info(`fully_qualified parameter: fully_qualified=${fully_qualified}`);
            logger.info(`library_regex parameter: libraryRegex=${libraryRegex}`);
            logger.info(`library_root parameter: libraryRoot=${libraryRoot}`);
            logger.info(`log_suite_numbering parameter: logSuiteNumbering=${logSuiteNumbering}`);
            logger.info(`output_directory parameter: outputDirectory=${outputDirectory}`);
            logger.info(`resource_directory parameter: resourceDirectory=${resourceDirectory}`);
            logger.info(`resource_regex parameter: resourceRegex=${resourceRegex}`);
            logger.info(`resource_root parameter: resourceRoot=${resourceRoot}`);
            logger.info(`library_mapping parameter: libraryMapping=${JSON.stringify(libraryMapping)}`);
            logger.info(`resource_mapping parameter: resourceMapping=${JSON.stringify(resourceMapping)}`);
            logger.info(`report_path parameter: reportPath=${reportPath}`);

            await vscode.commands.executeCommand("testbench_ls.generateTestSuites", {
                clean: clean,
                compound_interaction_logging: compound_interaction_logging,
                config: configFile,
                fully_qualified: fully_qualified,
                library_regex: libraryRegex,
                library_root: libraryRoot,
                log_suite_numbering: logSuiteNumbering,
                output_directory: outputDirectory,
                resource_directory: resourceDirectory,
                resource_regex: resourceRegex,
                resource_root: resourceRoot,
                library_mapping: libraryMapping,
                resource_mapping: resourceMapping,
                testbench_report: reportPath
            });
            isGenerateTestsCommandSuccessful = true;
        } catch (error) {
            isGenerateTestsCommandSuccessful = false;
            const errorMessage: string = error instanceof Error ? error.message : String(error);
            logger.error(`Language Server command 'generateTestSuites' failed: ${errorMessage}`, error);
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
        } catch (error) {
            isFetchResultsCommandSuccessful = false;
            const errorMessage: string = error instanceof Error ? error.message : String(error);
            logger.error(`Language Server command 'fetchResults' failed: ${errorMessage}`, error);
        }
        logger.debug(`startTb2robotFetchResults success: ${isFetchResultsCommandSuccessful}`);
        return isFetchResultsCommandSuccessful;
    }
}
