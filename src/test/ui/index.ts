/**
 * @file src/test/ui/index.ts
 * @description Test loader for UI tests
 */

import * as path from "path";
import Mocha from "mocha";
import { glob } from "glob";

// Load environment variables from .env files if they exist
// This allows using .env files for test credentials without hardcoding
// Supports both .env and testBenchConnection.env files
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dotenv = require("dotenv");
    // Load standard .env file first
    dotenv.config();
    // Also try loading testBenchConnection.env if it exists
    dotenv.config({ path: path.resolve(__dirname, "../../../testBenchConnection.env") });
} catch {
    // dotenv is optional - if not installed, environment variables must be set manually
}

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: "bdd",
        color: true,
        timeout: 60000
    });

    const testsRoot = path.resolve(__dirname);

    return new Promise((resolve, reject) => {
        glob("**/**.ui.test.js", { cwd: testsRoot })
            .then((files) => {
                // Add files to the test suite
                files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

                try {
                    // Run the mocha test
                    mocha.run((failures) => {
                        if (failures > 0) {
                            reject(new Error(`${failures} tests failed.`));
                        } else {
                            resolve();
                        }
                    });
                } catch (err) {
                    console.error(err);
                    reject(err);
                }
            })
            .catch((err) => {
                reject(err);
            });
    });
}
