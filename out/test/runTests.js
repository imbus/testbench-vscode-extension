"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require('vscode');
const path = require('path');
async function runTests() {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname);
    try {
        const testOptions = {
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: ['--disable-extensions']
        };
        await vscode.test.runTests(testOptions);
    }
    catch (err) {
        console.error('Failed to run tests', err);
        process.exit(1);
    }
}
runTests();
//# sourceMappingURL=runTests.js.map