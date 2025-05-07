/**
 * @file testbench2robotframeworkLib.ts
 * @description Provides functions for executing Testbench2Robotframework commands:
 * generating tests, fetching results, and displaying version information.
 */

import * as vscode from "vscode";
import { logger } from "./extension";

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
            await vscode.commands.executeCommand("testbench_ls.generateTestSuites", {
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
