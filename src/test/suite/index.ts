import * as path from "path";
//import * as Mocha from "mocha";
import Mocha from "mocha"; // Corrected import
import { glob } from "glob";

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: "tdd",
        color: true,
        timeout: 50000,
    });

    const testsRoot = path.resolve(__dirname, "..");

    try {
        const files = await glob("**/**.test.js", { cwd: testsRoot });

        // Add files to the test suite
        files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

        return new Promise((resolve, reject) => {
            try {
                // Run the mocha test
                mocha.run((failures: any) => {
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
        });
    } catch (err) {
        console.error(err);
        throw err;
    }
}
