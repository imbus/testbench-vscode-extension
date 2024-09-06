// Requirement: robotframework is installed globally in your system

import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';  // Run shell commands from within the application.
import { Connection } from './connection';

// Configuration interface for the settings
export interface Configuration {
  generationDirectory: string;
  clearGenerationDirectory: boolean;
  createOutputZip: boolean;
  logSuiteNumbering: boolean;
}

// Placeholder interface for TestBench JSON structure (simplified)
interface TestBenchReport {
  testCases: TestCase[];
}

interface TestCase {
  id: string;
  name: string;
  steps: string[];
}

// Path resolver to organize the directory structure for Robot Framework.
// Determines where each test suite file should be written based on the configuration.
class PathResolver {
  private config: Configuration;
  
  constructor(config: Configuration) {
    this.config = config;
  }

  resolveTestSuitePath(testCaseId: string): string {
    return path.join(this.config.generationDirectory, `suite_${testCaseId}`);
  }
}

// Fetch the TestBench JSON report from the server
export async function fetchTestBenchReport(url: string, connection: Connection | null): Promise<TestBenchReport | undefined> {
    if (!connection) {
        vscode.window.showInformationMessage('No connection available. Please login first.');
        return;
    }
    console.log(`Checking connection to: ${connection.serverUrl}`); 
    try {        
        /*
        const response: AxiosResponse = await this.session.get("projects", {
                params: {
                    includeTOVs: "false",
                    includeCycles: "false",
                },
            });
        */
        const response = await axios.get<TestBenchReport>(url);
        console.log(`Response status: ${response.status}`);
        vscode.window.showInformationMessage(`TestBench JSON report is fetched.`);
        return response.data;
    } catch (error) {
        console.error('Error fetching TestBench report:', error);
        vscode.window.showInformationMessage(`Failed to fetch TestBench report.`);
        throw error;
    }
}

// Create Robot Framework test suites from the TestBench JSON report
export function createTestSuites(report: TestBenchReport, pathResolver: PathResolver): Map<string, string> {
  vscode.window.showInformationMessage('Creating Robot Framework test suites.');

  // Map key is the file path and the value is the test suite content.
  const testSuites: Map<string, string> = new Map();

  report.testCases.forEach(testCase => {
    // Constructing Robot Framework format
    const testSuiteContent = `*** Test Cases ***\n${testCase.name}\n` +
      testCase.steps.map(step => `    ${step}`).join('\n');

    // Resolve path for this test suite
    const testSuitePath = pathResolver.resolveTestSuitePath(testCase.id);
    
    testSuites.set(testSuitePath, testSuiteContent);
  });

  vscode.window.showInformationMessage('Test suites created.');

  return testSuites;
}

// Write the generated test suites to the file system
export function writeTestSuites(testSuites: Map<string, string>, config: Configuration): void {
  vscode.window.showInformationMessage('Writing test suites to the file system.');

  // Check if the output directory exists
  if (!fs.existsSync(config.generationDirectory)) {
    fs.mkdirSync(config.generationDirectory, { recursive: true });
  }

  // Optionally clear the directory
  if (config.clearGenerationDirectory) {
    fs.readdirSync(config.generationDirectory).forEach(file => {
      fs.unlinkSync(path.join(config.generationDirectory, file));
    });
  }

  // Write each test suite to the file system
  testSuites.forEach((content, filePath) => {
    fs.writeFileSync(`${filePath}.robot`, content);
    console.log(`Test suite written to: ${filePath}.robot`);
  });

  // Optionally create a ZIP file
  if (config.createOutputZip) {
    const outputZip = `${config.generationDirectory}.zip`;
    const archiver = require('archiver');
    const output = fs.createWriteStream(outputZip);
    const archive = archiver('zip');

    archive.pipe(output);
    archive.directory(config.generationDirectory, false);
    archive.finalize();

    console.log(`ZIP file created at: ${outputZip}`);
  }
  vscode.window.showInformationMessage('Test suites written to the file system.');
}

// Main function for fetching, processing, and writing test suites
export async function testBenchToRobotFramework(url: string, config: Configuration, connection: Connection | null): Promise<void> {
  // Fetch the TestBench JSON report
  const report = await fetchTestBenchReport(url, connection);
  if (!report) {
    console.error('TestBench JSON report does not exist.');
    return;
  }

  // Create a path resolver
  const pathResolver = new PathResolver(config);

  // Generate Robot Framework test suites
  const testSuites = createTestSuites(report, pathResolver);

  // Write the test suites to the file system
  writeTestSuites(testSuites, config);
}

// Function to execute the Robot Framework test suites
export function executeRobotFrameworkTests(suiteDirectory: string, outputDirectory: string): Promise<void> {
    vscode.window.showInformationMessage('Executing Robot Framework tests.');

    return new Promise((resolve, reject) => {
      // Ensure the output directory exists
      if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
      }
  
      // Construct the command to run Robot Framework
      const command = `robot --outputdir ${outputDirectory} ${suiteDirectory}`;
  
      // Execute the Robot Framework test suites using a child process
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing Robot Framework tests: ${error.message}`);
          reject(error);
          return;
        }
  
        console.log('Robot Framework test execution output:');
        console.log(stdout);
  
        if (stderr) {
          vscode.window.showInformationMessage(`Robot Framework test execution errors: ${stderr}`);	
          console.error('Robot Framework test execution errors:');
          console.error(stderr);
        }
  
        resolve();
      });
    });
}
  
// Main function to generate test suites and execute them
export async function executeTests(config: Configuration): Promise<void> {
    // Assume test suites have been generated and are located in the config.generationDirectory
    const suiteDirectory = path.resolve(config.generationDirectory);
    const outputDirectory = path.resolve(config.generationDirectory, 'test-results');
  
    try {
      // Execute the Robot Framework test suites
      await executeRobotFrameworkTests(suiteDirectory, outputDirectory);
      console.log('Robot Framework test execution completed.');
  
      const outputXML = path.join(outputDirectory, 'output.xml');
      const logHTML = path.join(outputDirectory, 'log.html');
      const reportHTML = path.join(outputDirectory, 'report.html');
  
      vscode.window.showInformationMessage(`Test results generated.`);	
      console.log(`Test results generated:`);
      console.log(`Output XML: ${outputXML}`);
      console.log(`Log HTML: ${logHTML}`);
      console.log(`Report HTML: ${reportHTML}`);
  
    } catch (error) {
      console.error('Error during test execution:', error);
    }
}