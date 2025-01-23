import * as vscode from "vscode";
import { exec } from "child_process";
import { pyCommandBuilder } from "./pyCommandBuilder";
import { getConfig, logger } from "./extension";

export class tb2robotLib {
    /**
     * Generates Robot Framework Testsuites.
     * @param {vscode.ExtensionContext} context - The ExtensionContext.
     * @param {string} commandExecutionDirectory - Directory in which the command is to be executed.
     * @param {string} reportPath - Path to a folder or ZIP file containing TestBench JSON reports.
     */
    public static executeTb2robotGenerateTestsCommand(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        reportPath: string
    ): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const commandBase: string = await pyCommandBuilder.buildTb2RobotCommand(context);
            const generateTestsCommand: string = `generate-tests`;

            // Get the options from the extension settings
            const options = this.getTb2RobotGenerateTestOptionsFromSettings();

            let command = `${commandBase} ${generateTestsCommand} ${this.buildOptionsStringForTestGeneration(
                options
            )} ${reportPath}`;
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
        resultPath?: string
    ): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const commandBase: string = await pyCommandBuilder.buildTb2RobotCommand(context);
            const fetchResultsCommand: string = `fetch-results`;
            const outputDirOptionCommand: string = `--output-directory`; // Same as -d

            // Overwrite the results in the reportPath if no resultPath is provided.
            let command: string = `${commandBase} ${fetchResultsCommand} ${outputDirOptionCommand} ${outputXmlPath} ${reportWithoutResultsPath}`;

            // Write the results to the resultPath if provided.
            if (resultPath) {
                command = `${commandBase} ${fetchResultsCommand} ${outputDirOptionCommand} ${resultPath} ${outputXmlPath} ${reportWithoutResultsPath}`;
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
     * @returns {Promise<boolean>} True if the command was executed successfully, false otherwise.
     */
    public static async startTb2robotframeworkTestGeneration(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        reportPath: string
    ): Promise<boolean> {
        const generateTestsCommand: string = `generate-tests`;
        logger.debug(
            `Calling testbench2robotframework ${generateTestsCommand} command with working directory ${commandExecutionDirectory}, report path ${reportPath}.`
        );
        let isGenerateTestsCommandSuccessful: boolean = true;

        await this.executeTb2robotGenerateTestsCommand(context, commandExecutionDirectory, reportPath)
            .then(() => {
                let config = "no";

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
        resultPath?: string
    ): Promise<boolean> {
        const fetchResultsCommand: string = `fetch-results`;
        logger.debug(`Calling testbench2robotframework ${fetchResultsCommand} command.`);
        let isFetchResultsCommandSuccessful: boolean = true;

        await this.executeTb2robotFetchResultsCommand(
            context,
            commandExecutionDirectory,
            outputXmlPath,
            reportPath,
            resultPath
        )
            .then(() => {
                let providedPath: string = "none";
                let providedConfig: string = "";
                if (resultPath) {
                    providedPath = resultPath;
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

    /**
     * Builds a string of options for the tb2robot command.
     * @param options The options to be added to the command.
     * @returns A string of options for the tb2robot command.
     */
    public static buildOptionsStringForTestGeneration(options: { [key: string]: string | string[] | boolean }): string {
        let optionsString: string = "";
        for (const [key, value] of Object.entries(options)) {
            // For boolean options, add the option without a value if true
            optionsString += ` --${key}`;
            if (typeof value === "string") {
                optionsString += ` \"${value}\"`;
            } else if (Array.isArray(value)) {
                for (const item of value) {
                    optionsString += ` --${key} ${item}`;
                }
            }
        }

        logger.trace("Built options string for tb2robot command:", optionsString);
        return optionsString;
    }

    /**
     * Retrieves tb2robot options from the extension settings, excluding those with default values.
     * @returns An object containing the tb2robot options.
     */
    private static getTb2RobotGenerateTestOptionsFromSettings(): { [key: string]: string | string[] | boolean } {
        const optionsInExtensionSettings: { [key: string]: string | string[] | boolean } = {};

        const addBooleanOptionIfSet = (optionName: string, configKey: string, defaultValue: boolean) => {
            const value = getConfig().get<boolean>(configKey);
            // TODO: Removed from all ifs below: && value !== defaultValue
            if (value !== undefined && value !== defaultValue) {
                if (value) {
                    // Add the option without a value if true
                    optionsInExtensionSettings[optionName] = value;
                }
            }
        };

        addBooleanOptionIfSet("clean", "cleanFilesBeforeTestGenerationInTestbench2robotframework", false);
        addBooleanOptionIfSet("fully-qualified", "fullyQualifiedKeywordsInTestbench2robotframework", false);
        addBooleanOptionIfSet("log-suite-numbering", "logSuiteNumberingInTestbench2robotframework", false);

        // Include the option only if the user has set a value different from the default
        const addOptionIfSet = (optionName: string, configName: string, defaultValue: any) => {
            const value = getConfig().get(configName);
            if (value !== undefined && value !== defaultValue) {
                optionsInExtensionSettings[optionName] = value as string | string[];
            }
        };

        addOptionIfSet("compound-interaction-logging", "compoundInteractionLoggingInTestbench2robotframework", "GROUP");
        addOptionIfSet("resource-directory", "resourceDirectoryPathInTestbench2robotframework", "");

        // Include the option only if the user has set a value different from the default
        const addArrayOptionIfSet = (optionName: string, configName: string, defaultValue: string[]) => {
            const value = getConfig().get<string[]>(configName);
            // TODO: Removed from if: && JSON.stringify(value) !== JSON.stringify(defaultValue)
            if (value !== undefined && JSON.stringify(value) !== JSON.stringify(defaultValue)) {
                optionsInExtensionSettings[optionName] = value;
            }
        };

        addArrayOptionIfSet("library-regex", "libraryRegexInTestbench2robotframework", [
            "(?:.*.)?(?P<resourceName>[^.]+?)s*[Robot-Library].*",
        ]);
        addArrayOptionIfSet("library-root", "libraryRootInTestbench2robotframework", ["RF", "RF-Library"]);
        addArrayOptionIfSet("resource-regex", "resourceRegexInTestbench2robotframework", [
            "(?:.*.)?(?P<resourceName>[^.]+?)s*[Robot-Resource].*",
        ]);
        addArrayOptionIfSet("resource-root", "resourceRootInTestbench2robotframework", ["RF-Resource"]);
        addArrayOptionIfSet("library-mapping", "libraryMappingInTestbench2robotframework", []);
        addArrayOptionIfSet("resource-mapping", "resourceMappingInTestbench2robotframework", []);

        logger.trace("tb2robot options in extension settings:", optionsInExtensionSettings);
        return optionsInExtensionSettings;
    }
}
