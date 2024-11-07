"use strict";
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tb2robotLib = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const pyCommandBuilder_1 = require("./pyCommandBuilder");
class tb2robotLib {
    /**
     * Generates Robot Framework Testsuites.
     * @param {vscode.ExtensionContext} context - The ExtensionContext.
     * @param {string} workingDirectory - Directory in which the command is to be executed.
     * @param {string} reportPath - Path to a folder or ZIP file containing TestBench JSON reports.
     * @param {string} configJSONPath - Path to a JSON file, for the configuration of the output. If not provided, a config.json will be automatically generated.
     */
    static tb2robotWrite(context, workingDirectory, reportPath, configJSONPath) {
        return new Promise(async (resolve, reject) => {
            const commandBase = await pyCommandBuilder_1.pyCommandBuilder.buildTb2RobotCommand(context);
            let command = `${commandBase} write ${reportPath}`;
            if (configJSONPath) {
                command = `${commandBase} write -c ${configJSONPath} ${reportPath}`;
            }
            console.log(`Executing command: ${command}`);
            (0, child_process_1.exec)(command, { cwd: workingDirectory }, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr || stdout || "An unknown Error occurred.");
                    console.log(error.message);
                    return;
                }
                console.log(stdout || stderr);
                resolve();
            });
        });
    }
    /**
     * Writes XML test results back to the TestBench Json report.
     * @param @param {vscode.ExtensionContext} context - The ExtensionContext.
     * @param {string} workingDirectory - Directory in which the command is to be executed.
     * @param {string} outputXmlPath - Path to a Robot Framework XML resultfile.
     * @param {string} reportWithoutResultsPath - Path to a folder or ZIP file containing TestBench JSON reports (without results).
     * @param {string} resultPath - Path to a folder or ZIP file to save the results to. If not provided, reports provided in reportPath will be overritten.
     */
    static tb2robotRead(context, workingDirectory, outputXmlPath, reportWithoutResultsPath, resultPath, configJSONPath) {
        return new Promise(async (resolve, reject) => {
            const commandBase = await pyCommandBuilder_1.pyCommandBuilder.buildTb2RobotCommand(context);
            // OVerwrite the results in the reportPath if no resultPath is provided.
            let command = `${commandBase} read -o ${outputXmlPath} ${reportWithoutResultsPath}`;
            // Write the results to the resultPath if provided.
            if (resultPath) {
                command = `${commandBase} read -o ${outputXmlPath} -r ${resultPath} ${reportWithoutResultsPath}`;
            }
            // Use the provided config file if provided.
            if (configJSONPath) {
                command = `${commandBase} read -c ${configJSONPath} -o ${outputXmlPath} -r ${resultPath} ${reportWithoutResultsPath}`;
            }
            console.log(`Executing command: ${command}`);
            (0, child_process_1.exec)(command, { cwd: workingDirectory }, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr || stdout || "An unknown Error occurred.");
                    return;
                }
                resolve();
            });
        });
    }
    /**
     * Generates XML resultfiles from TestBench JSON reports.
     * @param {string} workingDirectory - Directory in which the command is to be executed.
     * @param {string} outputResultDir - Directory in which the result is to be stored..
     * @param {string} robotFilesPath - Path to a folder containing the robotframework tests.
     * @returns {Promise<boolean>} True if the command was executed successfully, false otherwise.
     */
    static robotGenerateXMLResults(workingDirectory, outputResultDir, robotFilesPath) {
        return new Promise(async (resolve, reject) => {
            const commandBase = await pyCommandBuilder_1.pyCommandBuilder.buildRobotCommand();
            let command = `${commandBase} -d ${outputResultDir} --dryrun ${robotFilesPath}`;
            (0, child_process_1.exec)(command, { cwd: workingDirectory }, (error, stdout, stderr) => {
                if (error) {
                    reject(stderr || stdout || "An unknown Error occurred.");
                    resolve(false);
                }
                resolve(true);
            });
        });
    }
    /**
     * Entry point for the Testbench2Robotframework write command.
     * @param @param {vscode.ExtensionContext} context - The ExtensionContext.
     * @param {string} workingDirectory The directory in which the command is to be executed.
     * @param {string} reportPath Path to a folder or ZIP file containing TestBench JSON reports.
     * @param {string} configJSONPath Path to a JSON configuration file. If not provided, a config.json will be automatically generated.
     * @returns {Promise<boolean>} True if the command was executed successfully, false otherwise.
     */
    static async startTb2robotWrite(context, workingDirectory, reportPath, configJSONPath) {
        let res = true;
        await this.tb2robotWrite(context, workingDirectory, reportPath, configJSONPath)
            .then(() => {
            let config = "no";
            if (configJSONPath) {
                config = configJSONPath;
            }
            console.log(`tb2robot write-generation completed using ${reportPath}, ${config} config file provided.`);
        })
            .catch((err) => {
            console.error("Error:", err);
            vscode.window.showErrorMessage(`testbench2robotframework ${err}`);
            res = false;
        });
        return res;
    }
    /**
     * Entry point for the Testbench2Robotframework read command.
     * @param @param {vscode.ExtensionContext} context - The ExtensionContext.
     * @param {string} workingDirectory The directory in which the command is to be executed.
     * @param {string} outputXmlPath Path to a Robot Framework XML resultfile.
     * @param {string} reportPath Path to a folder or ZIP file containing TestBench JSON reports. *
     * @param {string} resultPath  Path to a folder or ZIP file to save the results to. If not provided, reports provided in reportPath will be overritten.
     * @returns {Promise<boolean>} True if the command was executed successfully, false otherwise.
     */
    static async startTb2robotRead(context, workingDirectory, outputXmlPath, reportPath, resultPath, configJSONPath) {
        let res = true;
        await this.tb2robotRead(context, workingDirectory, outputXmlPath, reportPath, resultPath, configJSONPath)
            .then(() => {
            let providedPath = "none";
            let providedConfig = "";
            if (resultPath) {
                providedPath = resultPath;
            }
            if (configJSONPath) {
                providedConfig = `, ${configJSONPath}`;
            }
            console.log(`tb2robot read-generation completed using ${outputXmlPath}${providedConfig} and ${reportPath}. Provided path for results: ${providedPath}.`);
        })
            .catch((err) => {
            console.error("Error:", err);
            vscode.window.showErrorMessage(`testbench2robotframework ${err}`);
            res = false;
        });
        return res;
    }
    /**
     * Entry point for the Robot Framework XML generation command.
     * @param {string} workingDirectory The directory in which the command is to be executed.
     * @param {string} outputResultDir The directory in which the result is to be stored.
     * @param {string} reportPath Path to a folder containing the robotframework tests.
     * @returns {Promise<boolean>} True if the command was executed successfully, false otherwise.
     */
    static async startRobotGenerateXMLResults(workingDirectory, outputResultDir, reportPath) {
        let res = true;
        await this.robotGenerateXMLResults(workingDirectory, outputResultDir, reportPath)
            .then(() => {
            console.log(`Robot Framework generation completed using ${outputResultDir} and ${reportPath}.`);
        })
            .catch((err) => {
            console.error("Error:", err);
            vscode.window.showErrorMessage(`Robot Framework ${err}`);
            res = false;
        });
        return res;
    }
}
exports.tb2robotLib = tb2robotLib;
//# sourceMappingURL=testbench2robotframeworkLib.js.map