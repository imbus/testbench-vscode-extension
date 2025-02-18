"use strict";
/**
 * @file testbench2robotframeworkLib.ts
 * @description Provides functions for executing Testbench2Robotframework commands:
 * generating tests, fetching results, and displaying version information.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.tb2robotLib = void 0;
const vscode = __importStar(require("vscode"));
const utils = __importStar(require("./utils"));
const child_process_1 = require("child_process");
const pyCommandBuilder_1 = require("./pyCommandBuilder");
const extension_1 = require("./extension");
/**
 * Class representing the Testbench2Robotframework library wrapper.
 */
class tb2robotLib {
    /**
     * Executes the "generate-tests" command to generate Robot Framework testsuites.
     *
     * @param {vscode.ExtensionContext} context - The VS Code extension context.
     * @param {string} commandExecutionDirectory - The directory where the command is executed.
     * @param {string} reportPath - The path to a folder or ZIP file containing TestBench JSON reports.
     * @returns A promise that resolves when the command completes.
     */
    static executeTb2robotGenerateTestsCommand(context, commandExecutionDirectory, reportPath) {
        return new Promise(async (resolve, reject) => {
            try {
                const commandBase = await pyCommandBuilder_1.PyCommandBuilder.buildTb2RobotCommand(context);
                const generateTestsCommand = `generate-tests`;
                // Get the options from extension settings.
                const options = await this.getTb2RobotGenerateTestOptionsFromSettings();
                const optionsString = this.buildOptionsStringForTestGeneration(options);
                const commandToExecute = `${commandBase} ${generateTestsCommand} ${optionsString} ${reportPath}`;
                extension_1.logger.debug(`Executing generate-tests command: ${commandToExecute}`);
                // { cwd: commandExecutionDirectory } sets the current working directory of the child process to commandExecutionDirectory.
                // It will be as if you changed directories into commandExecutionDirectory before executing the command.
                (0, child_process_1.exec)(commandToExecute, { cwd: commandExecutionDirectory }, (error, stdout, stderr) => {
                    if (error) {
                        extension_1.logger.error("Error while executing generate-tests command:", error);
                        reject(stderr || stdout || "An unknown error occurred.");
                        return;
                    }
                    extension_1.logger.debug("Output of generate-tests command:", stdout || stderr);
                    resolve();
                });
            }
            catch (error) {
                extension_1.logger.error("Exception in executeTb2robotGenerateTestsCommand:", error);
                reject(error);
            }
        });
    }
    /**
     * Executes the "--version" command to print the version of the tb2robot library.
     *
     * @param {vscode.ExtensionContext} context - The VS Code extension context.
     * @param {string} commandExecutionDirectory - The directory in which to execute the command.
     * @returns A promise that resolves when the version command completes.
     */
    static executeTb2robotVersionCommand(context, commandExecutionDirectory) {
        return new Promise(async (resolve, reject) => {
            try {
                extension_1.logger.trace("Checking the version of the tb2robot library.");
                const commandBase = await pyCommandBuilder_1.PyCommandBuilder.buildTb2RobotCommand(context);
                const commandToExecute = `${commandBase} --version`;
                extension_1.logger.debug(`Executing version command in ${commandExecutionDirectory}: ${commandToExecute}`);
                (0, child_process_1.exec)(commandToExecute, { cwd: commandExecutionDirectory }, (error, stdout, stderr) => {
                    if (error) {
                        reject(stderr || stdout || "An unknown error occurred.");
                        return;
                    }
                    extension_1.logger.debug("Output of --version command:", stdout || stderr);
                    resolve();
                });
            }
            catch (error) {
                extension_1.logger.error("Exception in executeTb2robotVersionCommand:", error);
                reject(error);
            }
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
    static executeTb2robotFetchResultsCommand(context, commandExecutionDirectory, robotOutputXmlPath, testbenchReportWithoutResultsPath, resultPath // Name of the result file will be already generated by calling function, no need to use --output-directory option
    ) {
        return new Promise(async (resolve, reject) => {
            try {
                const commandBase = await pyCommandBuilder_1.PyCommandBuilder.buildTb2RobotCommand(context);
                const fetchResultsCommand = `fetch-results`;
                let options = "";
                // To use relative paths to workspace location in extension settings, we need to get the workspace location to construct the full path.
                const relativeTb2robotConfigPath = (0, extension_1.getConfig)().get("configurationPathInTestbench2robotframework");
                if (!relativeTb2robotConfigPath) {
                    extension_1.logger.warn("Relative Tb2robot Config path is not set in extension settings.");
                }
                else {
                    extension_1.logger.trace(`Relative Tb2robot Config path: ${relativeTb2robotConfigPath}`);
                    const absoluteTb2robotConfigPath = await utils.constructAbsolutePathFromRelativePath(relativeTb2robotConfigPath, true);
                    // Construct the absolute path of the configuration file and verify its existence.
                    if (absoluteTb2robotConfigPath) {
                        options += ` --config ${absoluteTb2robotConfigPath}`;
                    }
                }
                if (resultPath) {
                    options += ` --output-directory ${resultPath}`;
                }
                extension_1.logger.trace(`Options for fetch-results command: ${options}`);
                const commandToExecute = `${commandBase} ${fetchResultsCommand} ${options} ${robotOutputXmlPath} ${testbenchReportWithoutResultsPath}`;
                extension_1.logger.debug(`Executing fetch-results command in ${commandExecutionDirectory}: ${commandToExecute}`);
                (0, child_process_1.exec)(commandToExecute, { cwd: commandExecutionDirectory }, (error, stdout, stderr) => {
                    if (error) {
                        reject(stderr || stdout || "An unknown error occurred.");
                        return;
                    }
                    resolve();
                });
            }
            catch (error) {
                extension_1.logger.error("Exception in executeTb2robotFetchResultsCommand:", error);
                reject(error);
            }
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
    static async startTb2robotframeworkTestGeneration(context, commandExecutionDirectory, reportPath) {
        const generateTestsCommand = `generate-tests`;
        extension_1.logger.debug(`Starting tb2robot ${generateTestsCommand} with directory ${commandExecutionDirectory} and report path ${reportPath}.`);
        let isGenerateTestsCommandSuccessful = true;
        await this.executeTb2robotGenerateTestsCommand(context, commandExecutionDirectory, reportPath)
            .then(() => {
            extension_1.logger.debug(`tb2robot ${generateTestsCommand} completed successfully.`);
        })
            .catch((err) => {
            extension_1.logger.error(`Error in tb2robot ${generateTestsCommand}:`, err);
            vscode.window.showErrorMessage(`Error in tb2robot ${generateTestsCommand}: ${err}`);
            isGenerateTestsCommandSuccessful = false;
        });
        extension_1.logger.debug(`startTb2robotframeworkTestGeneration success: ${isGenerateTestsCommandSuccessful}`);
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
    static async startTb2robotFetchResults(context, commandExecutionDirectory, outputXmlPath, reportPath, resultPath) {
        const fetchResultsCommand = `fetch-results`;
        extension_1.logger.debug(`Starting tb2robot ${fetchResultsCommand} command.`);
        let isFetchResultsCommandSuccessful = true;
        await this.executeTb2robotFetchResultsCommand(context, commandExecutionDirectory, outputXmlPath, reportPath, resultPath)
            .then(() => {
            const providedPath = resultPath ? resultPath : "none";
            extension_1.logger.debug(`tb2robot ${fetchResultsCommand} completed. Provided output directory: ${providedPath}.`);
        })
            .catch((err) => {
            extension_1.logger.error(`Error in tb2robot ${fetchResultsCommand}:`, err);
            vscode.window.showErrorMessage(`Error in tb2robot ${fetchResultsCommand}: ${err}`);
            isFetchResultsCommandSuccessful = false;
        });
        extension_1.logger.debug(`startTb2robotFetchResults success: ${isFetchResultsCommandSuccessful}`);
        return isFetchResultsCommandSuccessful;
    }
    /**
     * Builds a string of options for the tb2robot generate-tests command.
     *
     * @param options - An object containing options.
     * @returns {string} A string of command-line options.
     */
    static buildOptionsStringForTestGeneration(options) {
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
        extension_1.logger.trace("Built options string for generate-tests:", optionsString);
        return optionsString;
    }
    /**
     * Retrieves tb2robot generate-tests options from extension settings, excluding those with default values.
     *
     * @returns An object containing the options.
     */
    static async getTb2RobotGenerateTestOptionsFromSettings() {
        const generateTestsSettingsOfExtension = {};
        const addBooleanOptionIfSet = (optionName, configName, defaultValue) => {
            const value = (0, extension_1.getConfig)().get(configName);
            // Add the option without a value if true
            if (value !== undefined && value !== defaultValue && value) {
                generateTestsSettingsOfExtension[optionName] = value;
            }
            else {
                extension_1.logger.warn(`Option for ${configName} is not set or is default. ${optionName} not included.`);
            }
        };
        addBooleanOptionIfSet("clean", "cleanFilesBeforeTestGenerationInTestbench2robotframework", false);
        addBooleanOptionIfSet("fully-qualified", "fullyQualifiedKeywordsInTestbench2robotframework", false);
        addBooleanOptionIfSet("log-suite-numbering", "logSuiteNumberingInTestbench2robotframework", false);
        // Include the option only if the user has set a value different from the default
        const addStringOptionIfSet = (optionName, configName, defaultValue) => {
            const value = (0, extension_1.getConfig)().get(configName);
            if (value !== undefined && value !== defaultValue) {
                generateTestsSettingsOfExtension[optionName] = value;
            }
            else {
                extension_1.logger.warn(`Option for ${configName} is not set or is default. ${optionName} not included.`);
            }
        };
        addStringOptionIfSet("compound-interaction-logging", "compoundInteractionLoggingInTestbench2robotframework", "GROUP");
        // Include the option only if the user has set a value different from the default
        async function addStringOptionWithRelativePathIfSet(optionName, configName, defaultValue) {
            const relativePath = (0, extension_1.getConfig)().get(configName);
            if (!relativePath) {
                extension_1.logger.warn(`Relative path for ${configName} not set. ${optionName} not included.`);
                return;
            }
            const absolutePath = await utils.constructAbsolutePathFromRelativePath(relativePath, true);
            if (absolutePath && relativePath !== defaultValue) {
                generateTestsSettingsOfExtension[optionName] = absolutePath;
                extension_1.logger.trace(`Added ${optionName}:`, absolutePath);
            }
            else {
                extension_1.logger.warn(`Could not construct absolute path for ${configName}. ${optionName} not included.`);
            }
        }
        // Include the option only if the user has set a value different from the default
        async function addOutputDirectoryOptionWithRelativePathIfSet(optionName, configName, defaultValue) {
            const relativePath = (0, extension_1.getConfig)().get(configName);
            if (!relativePath) {
                extension_1.logger.warn(`Relative path for ${configName} not set. ${optionName} not included.`);
                return;
            }
            const absolutePath = await utils.constructAbsolutePathFromRelativePath(relativePath, false);
            if (absolutePath && relativePath !== defaultValue) {
                generateTestsSettingsOfExtension[optionName] = absolutePath;
                extension_1.logger.trace(`Added ${optionName}:`, absolutePath);
            }
            else {
                extension_1.logger.warn(`Could not construct absolute path for ${configName}. ${optionName} not included.`);
            }
        }
        // To use relative paths to workspace location in extension settings,
        // we need to get the workspace location to construct the full path of resourceDirectoryPathInTestbench2robotframework.
        await addStringOptionWithRelativePathIfSet("resource-directory", "resourceDirectoryPathInTestbench2robotframework", "");
        await addStringOptionWithRelativePathIfSet("config", "configurationPathInTestbench2robotframework", "");
        // output directory path is not created until this point bcs generate-tests is not executed,
        // so the isAbsolutePathAndExists check will fail and the option wont be included.
        await addOutputDirectoryOptionWithRelativePathIfSet("output-directory", "outputDirectoryInTestbench2robotframework", ""); // Note: This option also exists in the fetch-results command with a different meaning.
        const addArrayOptionIfSet = (optionName, configName, defaultValue) => {
            const value = (0, extension_1.getConfig)().get(configName);
            if (value !== undefined && JSON.stringify(value) !== JSON.stringify(defaultValue)) {
                // Store the array directly, without adding the --optionName prefix here
                generateTestsSettingsOfExtension[optionName] = value;
            }
            else {
                extension_1.logger.warn(`Option for ${configName} is default or not set. ${optionName} not included.`);
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
        extension_1.logger.trace("tb2robot generate-tests options in extension settings:", generateTestsSettingsOfExtension);
        return generateTestsSettingsOfExtension;
    }
    /**
     * Builds a string of options for the tb2robot fetch-results command.
     *
     * @param options - An object containing options.
     * @returns A string of command-line options.
     */
    static buildOptionsStringForFetchResults(options) {
        let fetchResultsOptionsString = "";
        for (const [key, value] of Object.entries(options)) {
            fetchResultsOptionsString += ` --${key}`;
            // For boolean options, add the option without a value if true
            if (typeof value === "string") {
                fetchResultsOptionsString += ` "${value}"`;
            }
            else if (Array.isArray(value)) {
                for (const item of value) {
                    fetchResultsOptionsString += ` --${key} ${item}`;
                }
            }
        }
        extension_1.logger.trace("Built options string for tb2robot fetch-results:", fetchResultsOptionsString);
        return fetchResultsOptionsString;
    }
}
exports.tb2robotLib = tb2robotLib;
//# sourceMappingURL=testbench2robotframeworkLib.js.map