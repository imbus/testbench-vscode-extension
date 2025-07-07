/**
 * @file src/test/suite/index.ts
 * @description This script is used to run tests for the VS Code extension.
 */

import * as path from "path";
import Mocha from "mocha";
import { glob } from "glob";

export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: "tdd",
        color: true,
        timeout: 60000,
        reporter: "spec" // spec reporter for clearer output
    });

    const testsRoot: string = path.resolve(__dirname, "..");

    try {
        const testFiles: string[] = await glob("**/suite/**/*.test.js", {
            cwd: testsRoot,
            absolute: false,
            ignore: ["**/node_modules/**", "**/out/**", "**/.vscode-test/**"]
        });

        console.log(`\nFound ${testFiles.length} test file(s):`);
        testFiles.forEach((f) => console.log(`  - ${f}`));

        testFiles.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

        return new Promise((resolve, reject) => {
            try {
                mocha.run((failures: number) => {
                    if (failures > 0) {
                        reject(new Error(`${failures} tests failed.`));
                    } else {
                        console.log("\nAll tests passed!");
                        resolve();
                    }
                });
            } catch (err) {
                console.error("Error during test execution:", err);
                reject(err);
            }
        });
    } catch (err) {
        console.error("Error finding test files:", err);
        throw err;
    }
}
