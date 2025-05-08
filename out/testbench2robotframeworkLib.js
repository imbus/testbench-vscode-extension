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
            await vscode.commands.executeCommand("testbench_ls.generateTestSuites", {
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