import * as vscode from "vscode";
import { exec } from "child_process";
import { pyCommandBuilder } from "./pyCommandBuilder";

export class tb2robotLib {
    /**
     * Generates Robot Framework Testsuites.
     * @param {vscode.ExtensionContext} context - The ExtensionContext.
     * @param {string} workingDirectory - Directory in which the command is to be executed.
     * @param {string} reportPath - Path to a folder or ZIP file containing TestBench JSON reports.
     * @param {string} configJSONPath - Path to a JSON file, for the configuration of the output. If not provided, a config.json will be automatically generated.
     */
    public static tb2robotWrite(
        context: vscode.ExtensionContext,
        workingDirectory: string,
        reportPath: string,
        configJSONPath?: string
    ): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const commandBase: string = await pyCommandBuilder.buildTb2RobotCommand(context);

            let command: string = `${commandBase} write ${reportPath}`;
            if (configJSONPath) {
                command = `${commandBase} write -c ${configJSONPath} ${reportPath}`;
            }

            console.log(`Executing command: ${command}`);

            exec(command, { cwd: workingDirectory }, (error, stdout, stderr) => {
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
    public static tb2robotRead(
        context: vscode.ExtensionContext,
        workingDirectory: string,
        outputXmlPath: string,
        reportWithoutResultsPath: string,
        resultPath?: string,
        configJSONPath?: string
    ): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const commandBase: string = await pyCommandBuilder.buildTb2RobotCommand(context);

            // OVerwrite the results in the reportPath if no resultPath is provided.
            let command: string = `${commandBase} read -o ${outputXmlPath} ${reportWithoutResultsPath}`;

            // Write the results to the resultPath if provided.
            if (resultPath) {
                command = `${commandBase} read -o ${outputXmlPath} -r ${resultPath} ${reportWithoutResultsPath}`;
            }

            // Use the provided config file if provided.
            if (configJSONPath) {
                command = `${commandBase} read -c ${configJSONPath} -o ${outputXmlPath} -r ${resultPath} ${reportWithoutResultsPath}`;
            }

            console.log(`Executing command: ${command}`);
            exec(command, { cwd: workingDirectory }, (error, stdout, stderr) => {
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
    public static robotGenerateXMLResults(
        workingDirectory: string,
        outputResultDir: string,
        robotFilesPath: string
    ): Promise<boolean> {
        return new Promise(async (resolve, reject) => {
            const commandBase: string = await pyCommandBuilder.buildRobotCommand();

            let command: string = `${commandBase} -d ${outputResultDir} --dryrun ${robotFilesPath}`;

            exec(command, { cwd: workingDirectory }, (error, stdout, stderr) => {
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
    public static async startTb2robotWrite(
        context: vscode.ExtensionContext,
        workingDirectory: string,
        reportPath: string,
        configJSONPath?: string
    ): Promise<boolean> {
        let res: boolean = true;

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
    public static async startTb2robotRead(
        context: vscode.ExtensionContext,
        workingDirectory: string,
        outputXmlPath: string,
        reportPath: string,
        resultPath?: string,
        configJSONPath?: string
    ): Promise<boolean> {
        let res: boolean = true;

        await this.tb2robotRead(context, workingDirectory, outputXmlPath, reportPath, resultPath, configJSONPath)
            .then(() => {
                let providedPath: string = "none";
                let providedConfig = "";
                if (resultPath) {
                    providedPath = resultPath;
                }
                if (configJSONPath) {
                    providedConfig = `, ${configJSONPath}`;
                }

                console.log(
                    `tb2robot read-generation completed using ${outputXmlPath}${providedConfig} and ${reportPath}. Provided path for results: ${providedPath}.`
                );
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
    public static async startRobotGenerateXMLResults(
        workingDirectory: string,
        outputResultDir: string,
        reportPath: string
    ): Promise<boolean> {
        let res:boolean = true;

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
