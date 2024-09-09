import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';  // Run shell commands from within the application.
import { Connection } from './connection';
import * as unzipper from 'unzipper'; // npm install unzipper

// Configuration interface
export interface Configuration {
  generationDirectory: string;
  clearGenerationDirectory: boolean;
  createOutputZip: boolean;
}

// Interface for Test Case
export interface TestCase {
  uniqueID: string;
  name: string;
  steps: string[];
}

// Interface for Test Suite containing Test Cases
export interface TestSuite {
  themeID: string;
  testCases: TestCase[];
}

// Optional Cycle Options request body parameter for the TestBench API
interface CycleOptions {
  treeRootUID?: string;
  basedOnExecution?: boolean;
  suppressFilteredData?: boolean;
  suppressNotExecutable?: boolean;
  suppressEmptyTestThemes?: boolean;
  filters?: {
      name: string;
      filterType: 'TestTheme';
      testThemeUID: string;
  }[];
}

// Fetch the TestBench JSON report from the server
export async function fetchZipFile(baseURL: string, projectKey: number, cycleKey: number, options?: CycleOptions): Promise<Blob> {
  try {
      console.debug(`Fetching zip file for projectKey: ${projectKey}, cycleKey: ${cycleKey}, options: ${JSON.stringify(options)}`);

      const url = `${baseURL}/api/projects/${projectKey}/${cycleKey}`;  // TODO: Update the URL
      const response = await axios.get(url, {
          responseType: 'blob', // We expect a binary response
          params: options, // Pass cycle options as query parameters
      });

      console.debug(`Zip file fetched successfully for projectKey: ${projectKey}, cycleKey: ${cycleKey}`);
      return response.data;
  } catch (error) {
      console.error(`Error fetching zip file for projectKey: ${projectKey}, cycleKey: ${cycleKey}`, error);
      throw error; // Re-throw error for higher-level handling if needed
  }
}

export async function extractZip(
  zipFilePath: string,
  outputDir: string,
  extractOnlyJson = true // Optional parameter, defaults to false
): Promise<void> {
  try {
    console.debug(`Starting extraction of ${zipFilePath} to ${outputDir}`);

    // 1. Check if the ZIP file exists
    if (!fs.existsSync(zipFilePath)) {
      throw new Error(`ZIP file not found: ${zipFilePath}`);
    }
    console.debug(`ZIP file exists`);

    // 2. Create the output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.debug(`Created output directory: ${outputDir}`);
    } else {
      console.debug(`Output directory already exists: ${outputDir}`);
    }

    // 3. Open the ZIP file as a read stream
    const readStream = fs.createReadStream(zipFilePath);
    console.debug(`Opened ZIP file stream`);

    // 4. Parse the ZIP stream and handle entries
    await new Promise<void>((resolve, reject) => {
      readStream
        .pipe(unzipper.Parse())
        .on('entry', (entry: unzipper.Entry) => {
          const extractedPath = path.join(outputDir, entry.path);
          const directoryPath = path.dirname(extractedPath);

          // 5. Check if the entry is a JSON file (if extractOnlyJson is true)
          if (extractOnlyJson && !entry.path.toLowerCase().endsWith('.json')) {
            console.debug(`Skipping non-JSON file: ${entry.path}`);
            entry.autodrain();
            return; // Skip this entry
          }

          if (entry.type === 'Directory') {
            // 6. Create directories if encountered
            fs.mkdirSync(extractedPath, { recursive: true });
            console.debug(`Created directory: ${extractedPath}`);
            entry.autodrain();
          } else {
            // 7. Ensure the directory for the file exists before extracting
            if (!fs.existsSync(directoryPath)) {
              fs.mkdirSync(directoryPath, { recursive: true });
              console.debug(`Created directory for file: ${directoryPath}`);
            }

            // 8. Extract files
            entry.pipe(fs.createWriteStream(extractedPath))
              .on('finish', () => console.debug(`Extracted file: ${extractedPath}`))
              .on('error', (err) => {
                console.error(`Error extracting file ${extractedPath}: ${err}`);
                reject(err);
              });
          }
        })
        .on('close', () => {
          console.debug(`Finished processing all entries`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`Error parsing ZIP: ${err}`);
          reject(err);
        });
    });

    console.debug(`Extraction completed successfully`);
  } catch (err) {
    console.error(`Extraction failed: ${err}`);
    throw err;
  }
}

// Function to load JSON files from extracted directory
export function loadJsonFilesFromDirectory(dir: string): string[] {
  try {
    console.debug(`Attempting to read JSON files from directory: ${dir}`);

    const files = fs.readdirSync(dir);
    const jsonFiles = files
      .filter(file => file.endsWith('.json'))
      .map(file => path.join(dir, file));

    console.debug(`Found ${jsonFiles.length} JSON files in the directory.`);
    return jsonFiles;
  } catch (error) {
    console.error(`Error loading JSON files from directory: ${error}`);
    // Re-throwing the error or returning an empty array
    throw error; 
  }
}

// Function to parse JSON content
export function parseJsonFile(filePath: string): any {
  try {
    console.debug(`Attempting to parse JSON file: ${filePath}`);

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsedData = JSON.parse(content);

    console.debug(`Successfully parsed JSON file: ${filePath}`);
    return parsedData;
  } catch (error) {
    console.error(`Error parsing JSON file ${filePath}: ${error}`);
    // Re-throwing the error or returning null
    throw error; 
  }
}

// Function to process the Test Case files
export function processTestCaseFile(filePath: string): TestCase | null {
  try {
    console.debug(`Processing test case file: ${filePath}`);

    const data = parseJsonFile(filePath);

      // Check if interactions exist and if any of them have 'sequencePhase' = 'TestStep'
    if (data.interactions && Array.isArray(data.interactions)) {
      console.debug(`Found test case with steps in file: ${filePath}`);
      const testSteps = data.interactions
        .filter((interaction: any) => interaction.spec?.sequencePhase === "TestStep")
        .map((interaction: any) => interaction.name);

      if (testSteps.length > 0) {
        return {
          uniqueID: data.uniqueID || "UnnamedTest",
          name: data.uniqueID || "UnnamedTest",
          steps: testSteps.map((step: string) => `    ${step}`) // Format steps for Robot Framework
        };
      }
    }

    console.debug(`No test case found in file: ${filePath}`);
    return null;
  } catch (error) {
    console.error(`Error processing test case file ${filePath}: ${error}`);
    // Re-throwing or returning null
    throw error;
  }
}

// Function to extract the theme ID or grouping identifier from a Test Case JSON file
function extractThemeIDFromTestCaseFile(filePath: string): string {
  try {
    console.debug(`Extracting theme ID from test case file: ${filePath}`);

    const data = parseJsonFile(filePath);

    if (data.numbering) {
      console.debug(`Using 'numbering' field as theme ID: ${data.numbering}`);
      return data.numbering;
    }

    if (data.spec && data.spec.key) {
      console.debug(`Using 'spec.key' field as theme ID: Spec-${data.spec.key}`);
      return `Spec-${data.spec.key}`;
    }

    if (data.uniqueID) {
      console.debug(`Using 'uniqueID' field as theme ID: UniqueID-${data.uniqueID}`);
      return `UniqueID-${data.uniqueID}`;
    }

    console.debug(`No suitable theme ID found, using default: UnknownTheme`);
    return 'UnknownTheme';
  } catch (error) {
    console.error(`Error extracting theme ID from ${filePath}: ${error}`);
    // Consider re-throwing or returning a default value
    throw error;
  }
}

// Function to create Test Suites based on themes and test cases
export function createTestSuitesFromFiles(files: string[]): TestSuite[] {
  try {
    console.debug(`Creating test suites from ${files.length} files`);

    const testSuites: TestSuite[] = [];

    files.forEach(filePath => {
      if (filePath.includes('iTB-TC-')) {  // TODO: Check if this is needed
        // Process the Test Case file
        const testCase = processTestCaseFile(filePath);
        if (testCase) {
          const themeID = extractThemeIDFromTestCaseFile(filePath);
          let testSuite = testSuites.find(suite => suite.themeID === themeID);

          if (!testSuite) {
            testSuite = { themeID, testCases: [] };
            testSuites.push(testSuite);
          }
          testSuite.testCases.push(testCase);
        }
      }
    });

    console.debug(`Created ${testSuites.length} test suites`);
    return testSuites;

  } catch (error) {
    console.error(`Error creating test suites: ${error}`);
    // Re-throwing or return an empty array
    throw error;
  }
}

// Function to write Robot Framework Test Suites to files
export function writeRobotFrameworkTestSuites(testSuites: TestSuite[], config: Configuration): void {
  testSuites.forEach(suite => {
    const suiteDir = path.join(config.generationDirectory, suite.themeID);
    if (!fs.existsSync(suiteDir)) {
      fs.mkdirSync(suiteDir, { recursive: true });
    }

    const filePath = path.join(suiteDir, `${suite.themeID}.robot`);
    const fileContent = `*** Test Cases ***\n`;

    suite.testCases.forEach(testCase => {
      const caseContent = `${testCase.name}\n${testCase.steps.join('\n')}\n`;
      fs.appendFileSync(filePath, fileContent + caseContent);
    });

    console.log(`Test suite written to ${filePath}`);
  });
}

// Main function to handle the process
export async function testBenchToRobotFramework(zipFilePath: string, config: Configuration): Promise<void> {
  const extractDir = path.join(config.generationDirectory, 'extracted');
  // vscode.window.showInformationMessage(`Extracted directory: ${extractDir}`);
  console.log(`Extracted directory: ${extractDir}`);
  
  // vscode.window.showInformationMessage(`Before extractZip`);
  // Step 1: Extract ZIP file
  await extractZip(zipFilePath, extractDir);
  // vscode.window.showInformationMessage(`ZIP file extracted to: ${extractDir}`);
  console.log(`ZIP file extracted to: ${extractDir}`);

  // Step 2: Load JSON files from extracted directory
  const jsonFiles = loadJsonFilesFromDirectory(extractDir);
  // vscode.window.showInformationMessage(`JSON files loaded: ${jsonFiles.length}`);
  console.log(`JSON files loaded: ${jsonFiles.length}`);

  // Step 3: Create Test Suites from Test Case files
  const testSuites = createTestSuitesFromFiles(jsonFiles);
  // vscode.window.showInformationMessage(`Test suites created: ${testSuites.length}`);
  console.log(`Test suites created: ${testSuites.length}`);

  // Step 4: Write the test suites to Robot Framework files
  writeRobotFrameworkTestSuites(testSuites, config);
  // vscode.window.showInformationMessage(`Test suites written to the file system.`);
  console.log(`Test suites written to the file system.`);
}
