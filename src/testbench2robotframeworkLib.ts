import * as vscode from "vscode";
import { exec } from "child_process";
import { pyCommandBuilder } from "./pyCommandBuilder";
import { logger } from "./extension";

export class tb2robotLib {
    /**
     * Generates Robot Framework Testsuites.
     * @param {vscode.ExtensionContext} context - The ExtensionContext.
     * @param {string} commandExecutionDirectory - Directory in which the command is to be executed.
     * @param {string} reportPath - Path to a folder or ZIP file containing TestBench JSON reports.
     * @param {string} configJSONPath - Path to a JSON file, for the configuration of the output. If not provided, a config.json will be automatically generated.
     */
    public static executeTb2robotGenerateTestsCommand(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        reportPath: string,
        configJSONPath?: string
    ): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const commandBase: string = await pyCommandBuilder.buildTb2RobotCommand(context);
            const generateTestsCommand = `generate-tests`;

            let command = `${commandBase} ${generateTestsCommand} ${reportPath}`;
            if (configJSONPath) {
                command = `${commandBase} ${generateTestsCommand} -c ${configJSONPath} ${reportPath}`;
            }

            logger.debug(`Executing command: ${command}`);

            exec(command, { cwd: commandExecutionDirectory }, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr || stdout || "An unknown Error occurred.");
                    logger.error("Error while executing command:", error);
                    return;
                }
                logger.debug("Output of command execution:", stdout || stderr);
                resolve();
            });
        });
    }

    /**
     * Prints the version of the tb2robot library in stdout.
     * @param @param {vscode.ExtensionContext} context - The ExtensionContext.
     * @param {string} commandExecutionDirectory - Directory in which the command is to be executed.     
     */
    public static executeTb2robotVersionCommand(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string
    ): Promise<void> {
        return new Promise(async (resolve, reject) => {
            logger.trace(`Checking the version of the tb2robot library.`);

            const commandBase: string = await pyCommandBuilder.buildTb2RobotCommand(context);

            let command: string = `${commandBase} --version`;
           
            logger.debug(`Executing command inside ${commandExecutionDirectory}: ${command}`);

            // Execute the command inside the working directory.
            // { cwd: workingDirectory } sets the current working directory of the child process to workingDirectory.
            // It will be as if you changed directories into workingDirectory before executing the command.
            exec(command, { cwd: commandExecutionDirectory }, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr || stdout || "An unknown Error occurred.");
                    return;
                }
                logger.debug("Output of --version command execution:", stdout || stderr);
                resolve();
            });
        });
    }

    /**
     * Writes XML test results back to the TestBench Json report.
     * @param @param {vscode.ExtensionContext} context - The ExtensionContext.
     * @param {string} commandExecutionDirectory - Directory in which the command is to be executed.
     * @param {string} outputXmlPath - Absolute path to a Robot Framework XML result file.
     * @param {string} reportWithoutResultsPath - Absolute path to a folder or ZIP file containing TestBench JSON reports (without results).
     * @param {string} resultPath - Path to a folder or ZIP file to save the results to. If not provided, reports provided in reportPath will be overritten.
     */
    public static executeTb2robotFetchResultsCommand(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        outputXmlPath: string,
        reportWithoutResultsPath: string,
        resultPath?: string,
        configJSONPath?: string
    ): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const commandBase: string = await pyCommandBuilder.buildTb2RobotCommand(context);
            const fetchResultsCommand: string = `fetch-results`;
            const outputDirOptionCommand: string = `--output-directory`;  // Same as -d
            const configOptionCommand: string = `--config`;  // Same as -c

            // TODO: -o and -r doesnt exist anymore

            // Overwrite the results in the reportPath if no resultPath is provided.
            let command: string = `${commandBase} ${fetchResultsCommand} ${outputDirOptionCommand} ${outputXmlPath} ${reportWithoutResultsPath}`;

            // Write the results to the resultPath if provided.
            if (resultPath) {
                command = `${commandBase} ${fetchResultsCommand} ${outputDirOptionCommand} ${resultPath} ${outputXmlPath} ${reportWithoutResultsPath}`;
            }

            // Use the provided config file if provided.
            if (configJSONPath) {
                command = `${commandBase} ${fetchResultsCommand} ${configOptionCommand} ${configJSONPath} ${outputDirOptionCommand} ${resultPath} ${outputXmlPath} ${reportWithoutResultsPath}`;
            }

            logger.debug(`Executing command inside ${commandExecutionDirectory}: ${command}`);

            // Execute the command inside the working directory.
            // { cwd: workingDirectory } sets the current working directory of the child process to workingDirectory.
            // It will be as if you changed directories into workingDirectory before executing the command.
            exec(command, { cwd: commandExecutionDirectory }, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr || stdout || "An unknown Error occurred.");
                    return;
                }
                resolve();
            });
        });
    }

    /**
     * Entry point for the Testbench2Robotframework write command.
     * @param @param {vscode.ExtensionContext} context - The ExtensionContext.
     * @param {string} commandExecutionDirectory The directory in which the command is to be executed.
     * @param {string} reportPath Path to a folder or ZIP file containing TestBench JSON reports.
     * @param {string} configJSONPath Path to a JSON configuration file. If not provided, a config.json will be automatically generated.
     * @returns {Promise<boolean>} True if the command was executed successfully, false otherwise.
     */
    public static async startTb2robotframeworkTestGeneration(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        reportPath: string,
        configJSONPath?: string
    ): Promise<boolean> {
        const generateTestsCommand = `generate-tests`;
        logger.debug(
            `Calling testbench2robotframework ${generateTestsCommand} command with working directory ${commandExecutionDirectory}, report path ${reportPath}, JSON config path ${configJSONPath}.`
        );
        let isGenerateTestsCommandSuccessful: boolean = true;

        await this.executeTb2robotGenerateTestsCommand(context, commandExecutionDirectory, reportPath, configJSONPath)
            .then(() => {
                let config = "no";
                if (configJSONPath) {
                    config = configJSONPath;
                }

                logger.debug(
                    `tb2robot ${generateTestsCommand} completed using ${reportPath}, ${config} config file provided.`
                );
            })
            .catch((err) => {
                logger.error(`Error in testbench2robotframework ${generateTestsCommand}:`, err);
                vscode.window.showErrorMessage(`Error in testbench2robotframework ${generateTestsCommand}: ${err}`);
                isGenerateTestsCommandSuccessful = false;
            });

        logger.debug(
            `testbench2robotframework ${generateTestsCommand} command executed with success variable: ${isGenerateTestsCommandSuccessful}`
        );
        return isGenerateTestsCommandSuccessful;
    }

    /**
     * Entry point for the Testbench2Robotframework read command.
     * @param @param {vscode.ExtensionContext} context - The ExtensionContext.
     * @param {string} commandExecutionDirectory The directory in which the command is to be executed.
     * @param {string} outputXmlPath Path to a Robot Framework XML resultfile.
     * @param {string} reportPath Path to a folder or ZIP file containing TestBench JSON reports. *
     * @param {string} resultPath  Path to a folder or ZIP file to save the results to. If not provided, reports provided in reportPath will be overritten.
     * @returns {Promise<boolean>} True if the command was executed successfully, false otherwise.
     */
    public static async startTb2robotFetchResults(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        outputXmlPath: string,
        reportPath: string,
        resultPath?: string,
        configJSONPath?: string
    ): Promise<boolean> {
        const fetchResultsCommand = `fetch-results`;
        logger.debug(`Calling testbench2robotframework ${fetchResultsCommand} command.`);
        let isFetchResultsCommandSuccessful: boolean = true;

        await this.executeTb2robotFetchResultsCommand(
            context,
            commandExecutionDirectory,
            outputXmlPath,
            reportPath,
            resultPath,
            configJSONPath
        )
            .then(() => {
                let providedPath = "none";
                let providedConfig = "";
                if (resultPath) {
                    providedPath = resultPath;
                }
                if (configJSONPath) {
                    providedConfig = `, ${configJSONPath}`;
                }

                logger.debug(
                    `tb2robot ${fetchResultsCommand} completed using ${outputXmlPath}${providedConfig} and ${reportPath}. Provided path for results: ${providedPath}.`
                );
            })
            .catch((err) => {
                logger.error(`Error in testbench2robotframework ${fetchResultsCommand}:`, err);
                vscode.window.showErrorMessage(`Error in testbench2robotframework ${fetchResultsCommand}: ${err}`);
                isFetchResultsCommandSuccessful = false;
            });

        logger.debug(`startTb2robotFetchResults executed with success variable: ${isFetchResultsCommandSuccessful}`);
        return isFetchResultsCommandSuccessful;
    }
}
