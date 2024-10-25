/*
# - Launches VS Code Extension Host
# - Loads the extension at <EXTENSION-ROOT-PATH>
# - Executes the test runner script at <TEST-RUNNER-SCRIPT-PATH>
code \
--extensionDevelopmentPath=<EXTENSION-ROOT-PATH> \
--extensionTestsPath=<src/test/suite/index.ts>

--extensionTestsPath points to the test runner script (src/test/suite/index.ts

Starting point. Replacing mocha possible. 

*/

// Simplify the process of downloading, unzipping, and launching VS Code with extension test parameters

import * as path from "path";

import { runTests } from "@vscode/test-electron";

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, "../../");

		// The path to the extension test script
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, "./suite/index");

		// Download VS Code, unzip it and run the integration test
		await runTests({ 
			extensionDevelopmentPath, 
			extensionTestsPath,
			// launchArgs: ['--disable-extensions']
		});
	} catch (err) {
		console.error(err);
		console.error("Failed to run tests");
		process.exit(1);
	}
}

main();
