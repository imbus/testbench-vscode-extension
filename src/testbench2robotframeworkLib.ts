/**
 * @file testbench2robotframeworkLib.ts
 * @description Provides functions for executing Testbench2Robotframework commands:
 * generating tests, fetching results, and displaying version information.
 */

import * as vscode from "vscode";
import * as utils from "./utils";
import { exec } from "child_process";
import { PyCommandBuilder } from "./pyCommandBuilder";
import { getConfig, logger } from "./extension";

/**
 * Class representing the Testbench2Robotframework library wrapper.
 */
export class tb2robotLib {
    /**
     * Executes the "generate-tests" command to generate Robot Framework testsuites.
     * This function performs the following steps:
     * 1. Builds the base command using the PyCommandBuilder.
     * 2. Retrieves the options for testbench2robotframework library from extension settings.
     * 3. Constructs the full command string with options and report path.
     * 4. Executes the command in the specified directory.
     * 5. Handles errors and logs the output.
     *
     * @param {vscode.ExtensionContext} context - The VS Code extension context.
     * @param {string} commandExecutionDirectory - The directory where the command is executed.
     * @param {string} reportPath - The path to a folder or ZIP file containing TestBench JSON reports.
     * @returns A promise that resolves when the command completes.
     */
    public static executeTb2robotGenerateTestsCommand(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        reportPath: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            (async () => {
                try {
                    const commandBase: string = await PyCommandBuilder.buildTb2RobotCommand(context);
                    const generateTestsCommand: string = `generate-tests`;

                    // Get the options from extension settings.
                    const options = await this.getTb2RobotGenerateTestOptionsFromSettings();

                    const optionsString: string = this.buildOptionsStringForTestGeneration(options);
                    const commandToExecute: string = `${commandBase} ${generateTestsCommand} ${optionsString} ${reportPath}`;
                    logger.debug(`Executing generate-tests command: ${commandToExecute}`);

                    // { cwd: commandExecutionDirectory } sets the current working directory of the child process to commandExecutionDirectory.
                    // It will be as if you changed directories into commandExecutionDirectory before executing the command.
                    exec(commandToExecute, { cwd: commandExecutionDirectory }, (error, stdout, stderr) => {
                        if (error) {
                            const errorMsg: string = `Error while executing generate-tests command: ${error.message}`;
                            logger.error(errorMsg);
                            reject(stderr || stdout || errorMsg);
                            return;
                        }
                        resolve();
                    });
                } catch (error) {
                    logger.error("Exception in executeTb2robotGenerateTestsCommand:", error);
                    reject(error);
                }
            })();
        });
    }

    /**
     * Executes the "--version" command to print the version of the tb2robot library.
     *
     * @param {vscode.ExtensionContext} context - The VS Code extension context.
     * @param {string} commandExecutionDirectory - The directory in which to execute the command.
     * @returns A promise that resolves when the version command completes.
     */
    public static executeTb2robotVersionCommand(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            (async () => {
                try {
                    logger.trace("Checking the version of the tb2robot library.");
                    const commandBase: string = await PyCommandBuilder.buildTb2RobotCommand(context);
                    const commandToExecute: string = `${commandBase} --version`;

                    logger.debug(`Executing version command in ${commandExecutionDirectory}: ${commandToExecute}`);

                    exec(commandToExecute, { cwd: commandExecutionDirectory }, (error, stdout, stderr) => {
                        if (error) {
                            const errorMsg: string = `Error while executing version command: ${error.message}`;
                            logger.error(errorMsg);
                            reject(stderr || stdout || errorMsg);
                            return;
                        }
                        logger.debug("Output of --version command:", stdout || stderr);
                        resolve();
                    });
                } catch (error) {
                    logger.error("Exception in executeTb2robotVersionCommand:", error);
                    reject(error);
                }
            })();
        });
    }

    /**
     * Executes the "fetch-results" command to write XML test results back into the TestBench JSON report.
     *
     * @param {vscode.ExtensionContext} context - The VS Code extension context.
     * @param {string} commandExecutionDirectory - The directory where the command is executed.
     * @param {string} robotOutputXmlPath - Absolute path to the Robot Framework XML result file.
     * @param {string} testbenchReportWithoutResultsPath - Absolute path to a folder or ZIP file containing TestBench JSON reports (without results).
     * @param {string} resultPath - (Optional) Path to a folder or ZIP file to save the results to.
     * @returns A promise that resolves when the command completes.
     */
    public static executeTb2robotFetchResultsCommand(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        robotOutputXmlPath: string,
        testbenchReportWithoutResultsPath: string,
        resultPath?: string // Name of the result file will be already generated by calling function, no need to use --output-directory option
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            (async () => {
                try {
                    const commandBase: string = await PyCommandBuilder.buildTb2RobotCommand(context);
                    const fetchResultsCommand: string = `fetch-results`;
                    let options = "";

                    // To use relative paths to workspace location in extension settings, we need to get the workspace location to construct the full path.
                    const relativeTb2robotConfigPath: string | undefined = getConfig().get<string>(
                        "configurationPathInTestbench2robotframework"
                    );
                    if (!relativeTb2robotConfigPath) {
                        logger.warn("Relative Tb2robot Config path is not set in extension settings.");
                    } else {
                        logger.trace(`Relative Tb2robot Config path: ${relativeTb2robotConfigPath}`);
                        const absoluteTb2robotConfigPath: string | null =
                            await utils.constructAbsolutePathFromRelativePath(relativeTb2robotConfigPath, true);
                        // Construct the absolute path of the configuration file and verify its existence.
                        if (absoluteTb2robotConfigPath) {
                            options += ` --config ${absoluteTb2robotConfigPath}`;
                        }
                    }

                    if (resultPath) {
                        options += ` --output-directory ${resultPath}`;
                    }

                    logger.trace(`Options for fetch-results command: ${options}`);

                    const commandToExecute: string = `${commandBase} ${fetchResultsCommand} ${options} ${robotOutputXmlPath} ${testbenchReportWithoutResultsPath}`;
                    logger.debug(
                        `Executing fetch-results command in ${commandExecutionDirectory}: ${commandToExecute}`
                    );

                    exec(commandToExecute, { cwd: commandExecutionDirectory }, (error, stdout, stderr) => {
                        if (error) {
                            const errorMsg: string = `Error while executing fetch-results command: ${error.message}`;
                            logger.error(errorMsg);
                            reject(stderr || stdout || errorMsg);
                            return;
                        }
                        resolve();
                    });
                } catch (error) {
                    logger.error("Exception in executeTb2robotFetchResultsCommand:", error);
                    reject(error);
                }
            })();
        });
    }

    /**
     * Entry point for starting test generation via tb2robot.
     *
     * @param {vscode.ExtensionContext} context - The VS Code extension context.
     * @param {string} commandExecutionDirectory - The directory where the command is executed.
     * @param {string} reportPath - Path to a folder or ZIP file containing TestBench JSON reports.
     * @returns {Promise<boolean>} A promise that resolves to true if test generation succeeds, false otherwise.
     */
    public static async startTb2robotframeworkTestGeneration(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        reportPath: string
    ): Promise<boolean> {
        const generateTestsCommand: string = `generate-tests`;
        logger.debug(
            `Starting tb2robot ${generateTestsCommand} with directory ${commandExecutionDirectory} and report path ${reportPath}.`
        );
        let isGenerateTestsCommandSuccessful = true;

        await this.executeTb2robotGenerateTestsCommand(context, commandExecutionDirectory, reportPath)
            .then(() => {
                logger.debug(`tb2robot ${generateTestsCommand} completed successfully.`);
            })
            .catch((err) => {
                logger.error(`Error in tb2robot ${generateTestsCommand}:`, err);
                vscode.window.showErrorMessage(`Error in tb2robot ${generateTestsCommand}: ${err}`);
                isGenerateTestsCommandSuccessful = false;
            });

        logger.debug(`startTb2robotframeworkTestGeneration success: ${isGenerateTestsCommandSuccessful}`);
        return isGenerateTestsCommandSuccessful;
    }

    /**
     * Entry point for starting the tb2robot fetch-results command.
     *
     * @param {vscode.ExtensionContext} context - The VS Code extension context.
     * @param {string} commandExecutionDirectory - The directory where the command is executed.
     * @param {string} outputXmlPath - Path to the Robot Framework XML result file.
     * @param {string} reportPath - Path to a folder or ZIP file containing TestBench JSON reports.
     * @param {string} resultPath - (Optional) Path to save the results to.
     * @returns {Promise<boolean>} A promise that resolves to true if the command succeeds, false otherwise.
     */
    public static async startTb2robotFetchResults(
        context: vscode.ExtensionContext,
        commandExecutionDirectory: string,
        outputXmlPath: string,
        reportPath: string,
        resultPath?: string
    ): Promise<boolean> {
        const fetchResultsCommand: string = `fetch-results`;
        logger.debug(`Starting tb2robot ${fetchResultsCommand} command.`);
        let isFetchResultsCommandSuccessful = true;

        await this.executeTb2robotFetchResultsCommand(
            context,
            commandExecutionDirectory,
            outputXmlPath,
            reportPath,
            resultPath
        )
            .then(() => {
                const providedPath = resultPath ? resultPath : "none";
                logger.debug(`tb2robot ${fetchResultsCommand} completed. Provided output directory: ${providedPath}.`);
            })
            .catch((err) => {
                logger.error(`Error in tb2robot ${fetchResultsCommand}:`, err);
                vscode.window.showErrorMessage(`Error in tb2robot ${fetchResultsCommand}: ${err}`);
                isFetchResultsCommandSuccessful = false;
            });

        logger.debug(`startTb2robotFetchResults success: ${isFetchResultsCommandSuccessful}`);
        return isFetchResultsCommandSuccessful;
    }

    /**
     * Builds a string of options for the tb2robot generate-tests command.
     *
     * @param options - An object containing options.
     * @returns {string} A string of command-line options.
     */
    public static buildOptionsStringForTestGeneration(options: { [key: string]: string | string[] | boolean }): string {
        let optionsString = "";
        for (const [key, value] of Object.entries(options)) {
            // Handle booleans
            if (typeof value === "boolean") {
                // Only add the option if the value is true
                if (value) {
                    optionsString += ` --${key}`;
                }
            }
            // Handle single string value
            else if (typeof value === "string") {
                optionsString += ` --${key} "${value}"`;
            }
            // Handle array of strings
            else if (Array.isArray(value)) {
                for (const item of value) {
                    // Each item becomes its own --key <item> entry
                    // Quote `item` in case it can contain spaces
                    optionsString += ` --${key} "${item}"`;
                }
            }
        }
        logger.trace("Built options string for generate-tests:", optionsString);
        return optionsString;
    }

    /**
     * Adds a boolean option to the options object if the value is set and different from the default.
     * @param {{ [key: string]: string | boolean | string[] }} options The options object to add the option to.
     * @param {string} optionName The name of the option to add.
     * @param {string} configName The name of the configuration setting to check.
     * @param {boolean} defaultValue The default value of the option.
     */
    private static addBooleanOptionIfSet(
        options: { [key: string]: string | boolean | string[] },
        optionName: string,
        configName: string,
        defaultValue: boolean
    ): void {
        const value = getConfig().get<boolean>(configName);
        // Add the option without a value if true
        if (value !== undefined && value !== defaultValue && value) {
            options[optionName] = value;
        } else {
            logger.warn(`Option for ${configName} is not set or is default. ${optionName} not included.`);
        }
    }

    /**
     * Retrieves tb2robot generate-tests options from extension settings, excluding those with default values.
     *
     * @returns An object containing the options.
     */
    private static async getTb2RobotGenerateTestOptionsFromSettings(): Promise<{
        [key: string]: string | boolean | string[];
    }> {
        const generateTestsSettingsOfExtension: { [key: string]: string | string[] | boolean } = {};

        this.addBooleanOptionIfSet(
            generateTestsSettingsOfExtension,
            "clean",
            "cleanFilesBeforeTestGenerationInTestbench2robotframework",
            false
        );
        this.addBooleanOptionIfSet(
            generateTestsSettingsOfExtension,
            "fully-qualified",
            "fullyQualifiedKeywordsInTestbench2robotframework",
            false
        );
        this.addBooleanOptionIfSet(
            generateTestsSettingsOfExtension,
            "log-suite-numbering",
            "logSuiteNumberingInTestbench2robotframework",
            false
        );

        // Include the option only if the user has set a value different from the default
        const addStringOptionIfSet = (optionName: string, configName: string, defaultValue: any) => {
            const value = getConfig().get(configName);
            if (value !== undefined && value !== defaultValue) {
                generateTestsSettingsOfExtension[optionName] = value as string | string[];
            } else {
                logger.warn(`Option for ${configName} is not set or is default. ${optionName} not included.`);
            }
        };

        addStringOptionIfSet(
            "compound-interaction-logging",
            "compoundInteractionLoggingInTestbench2robotframework",
            "GROUP"
        );

        // Include the option only if the user has set a value different from the default
        async function addStringOptionWithRelativePathIfSet(optionName: string, configName: string, defaultValue: any) {
            const relativePath: string | undefined = getConfig().get(configName);
            if (!relativePath) {
                logger.warn(`Relative path for ${configName} not set. ${optionName} not included.`);
                return;
            }
            const absolutePath: string | null = await utils.constructAbsolutePathFromRelativePath(relativePath, true);
            if (absolutePath && relativePath !== defaultValue) {
                generateTestsSettingsOfExtension[optionName] = absolutePath;
                logger.trace(`Added ${optionName}:`, absolutePath);
            } else {
                logger.warn(`Could not construct absolute path for ${configName}. ${optionName} not included.`);
            }
        }

        // Include the option only if the user has set a value different from the default
        async function addOutputDirectoryOptionWithRelativePathIfSet(
            optionName: string,
            configName: string,
            defaultValue: any
        ) {
            const relativePath: string | undefined = getConfig().get(configName);
            if (!relativePath) {
                logger.warn(`Relative path for ${configName} not set. ${optionName} not included.`);
                return;
            }
            const absolutePath: string | null = await utils.constructAbsolutePathFromRelativePath(relativePath, false);
            if (absolutePath && relativePath !== defaultValue) {
                generateTestsSettingsOfExtension[optionName] = absolutePath;
                logger.trace(`Added ${optionName}:`, absolutePath);
            } else {
                logger.warn(`Could not construct absolute path for ${configName}. ${optionName} not included.`);
            }
        }

        // To use relative paths to workspace location in extension settings,
        // we need to get the workspace location to construct the full path of resourceDirectoryPathInTestbench2robotframework.
        await addStringOptionWithRelativePathIfSet(
            "resource-directory",
            "resourceDirectoryPathInTestbench2robotframework",
            ""
        );
        await addStringOptionWithRelativePathIfSet("config", "configurationPathInTestbench2robotframework", "");

        // output directory path is not created until this point bcs generate-tests is not executed,
        // so the isAbsolutePathAndExists check will fail and the option wont be included.
        await addOutputDirectoryOptionWithRelativePathIfSet(
            "output-directory",
            "outputDirectoryInTestbench2robotframework",
            ""
        ); // Note: This option also exists in the fetch-results command with a different meaning.

        const addArrayOptionIfSet = (optionName: string, configName: string, defaultValue: string[]) => {
            const value = getConfig().get<string[]>(configName);
            if (value !== undefined && JSON.stringify(value) !== JSON.stringify(defaultValue)) {
                // Store the array directly, without adding the --optionName prefix here
                generateTestsSettingsOfExtension[optionName] = value;
            } else {
                logger.warn(`Option for ${configName} is default or not set. ${optionName} not included.`);
            }
        };

        addArrayOptionIfSet("library-regex", "libraryRegexInTestbench2robotframework", [
            "(?:.*.)?(?P<resourceName>[^.]+?)s*[Robot-Library].*"
        ]);
        addArrayOptionIfSet("library-root", "libraryRootInTestbench2robotframework", ["RF", "RF-Library"]);
        addArrayOptionIfSet("resource-regex", "resourceRegexInTestbench2robotframework", [
            "(?:.*.)?(?P<resourceName>[^.]+?)s*[Robot-Resource].*"
        ]);
        addArrayOptionIfSet("resource-root", "resourceRootInTestbench2robotframework", ["RF-Resource"]);
        addArrayOptionIfSet("library-mapping", "libraryMappingInTestbench2robotframework", []);
        addArrayOptionIfSet("resource-mapping", "resourceMappingInTestbench2robotframework", []);

        logger.trace("tb2robot generate-tests options in extension settings:", generateTestsSettingsOfExtension);
        return generateTestsSettingsOfExtension;
    }

    /**
     * Builds a string of options for the tb2robot fetch-results command.
     *
     * @param options - An object containing options.
     * @returns A string of command-line options.
     */
    public static buildOptionsStringForFetchResults(options: { [key: string]: string | string[] | boolean }): string {
        let fetchResultsOptionsString = "";
        for (const [key, value] of Object.entries(options)) {
            fetchResultsOptionsString += ` --${key}`;
            // For boolean options, add the option without a value if true
            if (typeof value === "string") {
                fetchResultsOptionsString += ` "${value}"`;
            } else if (Array.isArray(value)) {
                for (const item of value) {
                    fetchResultsOptionsString += ` --${key} ${item}`;
                }
            }
        }
        logger.trace("Built options string for tb2robot fetch-results:", fetchResultsOptionsString);
        return fetchResultsOptionsString;
    }
}
