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
const extension_1 = require("./extension");
const constants_1 = require("./constants");
const configuration_1 = require("./configuration");
/**
 * Class representing the Testbench2Robotframework library wrapper.
 */
class tb2robotLib {
    /**
     * Entry point for starting test generation via tb2robot.
     *
     * @param {string} reportPath - Path to a folder or ZIP file containing TestBench JSON reports.
     * @returns {Promise<boolean>} A promise that resolves to true if test generation succeeds, false otherwise.
     */
    static async startTb2robotframeworkTestGeneration(reportPath) {
        let isGenerateTestsCommandSuccessful = false;
        try {
            const use_config_file = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.USE_CONFIG_FILE_SETTING);
            const clean = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_CLEAN);
            const compound_interaction_logging = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_COMPOUND_LOGGING);
            const fully_qualified = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_FULLY_QUALIFIED);
            const libraryMapping = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_LIBRARY_MAPPING);
            const libraryMarker = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_LIBRARY_MARKER);
            const libraryRoot = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_LIBRARY_ROOT);
            const logSuiteNumbering = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_LOG_SUITE_NUMBERING);
            const outputDirectory = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_OUTPUT_DIR);
            const resourceDirectory = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_RESOURCE_DIR);
            const resourceMapping = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_RESOURCE_MAPPING);
            const resourceMarker = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_RESOURCE_MARKER);
            const resourceRoot = (0, configuration_1.getExtensionSetting)(constants_1.ConfigKeys.TB2ROBOT_RESOURCE_ROOT);
            await vscode.commands.executeCommand("testbench_ls.generateTestSuites", {
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
            isGenerateTestsCommandSuccessful = true;
        }
        catch (error) {
            isGenerateTestsCommandSuccessful = false;
            const errorMessage = error instanceof Error ? error.message : String(error);
            extension_1.logger.error(`Language Server command 'generateTestSuites' failed: ${errorMessage}`, error);
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
    static async startTb2robotFetchResults(outputXmlPath, reportPath, resultPath) {
        const fetchResultsCommand = `fetch-results`;
        extension_1.logger.debug(`Starting tb2robot ${fetchResultsCommand} command.`);
        let isFetchResultsCommandSuccessful = true;
        try {
            await vscode.commands.executeCommand("testbench_ls.fetchResults", {
                robot_result: outputXmlPath,
                output_directory: resultPath,
                testbench_report: reportPath
            });
            isFetchResultsCommandSuccessful = true;
        }
        catch (error) {
            isFetchResultsCommandSuccessful = false;
            const errorMessage = error instanceof Error ? error.message : String(error);
            extension_1.logger.error(`Language Server command 'fetchResults' failed: ${errorMessage}`, error);
        }
        extension_1.logger.debug(`startTb2robotFetchResults success: ${isFetchResultsCommandSuccessful}`);
        return isFetchResultsCommandSuccessful;
    }
}
exports.tb2robotLib = tb2robotLib;
//# sourceMappingURL=testbench2robotframeworkLib.js.map