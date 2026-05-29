/**
 * @file src/test/ui/index.ts
 * @description Test loader for UI tests.
 */

import * as path from "path";
import Mocha from "mocha";
import { glob } from "glob";
import { loadEnv } from "./config/testConfig";

export async function run(): Promise<void> {
    const projectRoot = path.resolve(__dirname, "../../../");
    loadEnv(projectRoot);

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
