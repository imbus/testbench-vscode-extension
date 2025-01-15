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
    public static executeTb2robotWriteCommand(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        reportPath: string,
        configJSONPath?: string
    ): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const commandBase: string = await pyCommandBuilder.buildTb2RobotCommand(context);

            let command = `${commandBase} write ${reportPath}`;
            if (configJSONPath) {
                command = `${commandBase} write -c ${configJSONPath} ${reportPath}`;
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
    public static executeTb2robotReadCommand(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        outputXmlPath: string,
        reportWithoutResultsPath: string,
        resultPath?: string,
        configJSONPath?: string
    ): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const commandBase: string = await pyCommandBuilder.buildTb2RobotCommand(context);

            // Overwrite the results in the reportPath if no resultPath is provided.
            let command: string = `${commandBase} read -o ${outputXmlPath} ${reportWithoutResultsPath}`;

            // Write the results to the resultPath if provided.
            if (resultPath) {
                command = `${commandBase} read -o ${outputXmlPath} -r ${resultPath} ${reportWithoutResultsPath}`;
            }

            // Use the provided config file if provided.
            if (configJSONPath) {
                command = `${commandBase} read -c ${configJSONPath} -o ${outputXmlPath} -r ${resultPath} ${reportWithoutResultsPath}`;
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
    public static async startTb2robotframeworkWrite(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        reportPath: string,
        configJSONPath?: string
    ): Promise<boolean> {
        logger.debug(
            `Calling testbench2robotframework write command with working directory ${commandExecutionDirectory}, report path ${reportPath}, JSON config path ${configJSONPath}.`
        );
        let isWriteCommandSuccessful: boolean = true;

        await this.executeTb2robotWriteCommand(context, commandExecutionDirectory, reportPath, configJSONPath)
            .then(() => {
                let config = "no";
                if (configJSONPath) {
                    config = configJSONPath;
                }

                logger.debug(`tb2robot write completed using ${reportPath}, ${config} config file provided.`);
            })
            .catch((err) => {
                logger.error(`Error in testbench2robotframework write:`, err);
                vscode.window.showErrorMessage(`Error in testbench2robotframework write: ${err}`);
                isWriteCommandSuccessful = false;
            });

        logger.debug(
            `testbench2robotframework write command executed with success variable: ${isWriteCommandSuccessful}`
        );
        return isWriteCommandSuccessful;
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
    public static async startTb2robotRead(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        outputXmlPath: string,
        reportPath: string,
        resultPath?: string,
        configJSONPath?: string
    ): Promise<boolean> {
        logger.debug("Calling startTb2robotRead.");
        let isReadCommandSuccessful: boolean = true;

        await this.executeTb2robotReadCommand(
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
                    `tb2robot read completed using ${outputXmlPath}${providedConfig} and ${reportPath}. Provided path for results: ${providedPath}.`
                );
            })
            .catch((err) => {
                logger.error(`Error in testbench2robotframework read:`, err);
                vscode.window.showErrorMessage(`Error in testbench2robotframework read: ${err}`);
                isReadCommandSuccessful = false;
            });

        logger.debug(`startTb2robotRead executed with success variable: ${isReadCommandSuccessful}`);
        return isReadCommandSuccessful;
    }
}
