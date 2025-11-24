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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");

    // Get project root (where package.json is located)
    // __dirname will be out/test/ui when compiled, so go up 3 levels
    const projectRoot = path.resolve(__dirname, "../../../");

    // Try to load .env file from project root
    const envPath = path.join(projectRoot, ".env");
    if (fs.existsSync(envPath)) {
        const result = dotenv.config({ path: envPath, override: false });
        if (!result.error) {
            console.log(`[Env] Loaded .env from: ${envPath}`);
        }
    }

    // Try to load testBenchConnection.env from project root
    const testBenchEnvPath = path.join(projectRoot, "testBenchConnection.env");
    if (fs.existsSync(testBenchEnvPath)) {
        const result = dotenv.config({ path: testBenchEnvPath, override: false });
        if (!result.error) {
            console.log(`[Env] Loaded testBenchConnection.env from: ${testBenchEnvPath}`);
        }
    } else {
        // Try alternative locations
        const alternativePaths = [
            path.resolve(process.cwd(), "testBenchConnection.env"), // Current working directory
            path.resolve(process.cwd(), ".testbenchConnection.env") // Alternative name
        ];

        for (const altPath of alternativePaths) {
            if (fs.existsSync(altPath)) {
                const result = dotenv.config({ path: altPath, override: false });
                if (!result.error) {
                    console.log(`[Env] Loaded testBenchConnection.env from: ${altPath}`);
                    break;
                }
            }
        }
    }

    // Log loaded values for debugging
    console.log(`[Env] TESTBENCH_TEST_SERVER_NAME=${process.env.TESTBENCH_TEST_SERVER_NAME || "not set"}`);
    console.log(`[Env] TESTBENCH_TEST_USERNAME=${process.env.TESTBENCH_TEST_USERNAME || "not set"}`);
    console.log(`[Env] TESTBENCH_TEST_PORT_NUMBER=${process.env.TESTBENCH_TEST_PORT_NUMBER || "not set"}`);
    console.log(`[Env] UI_TEST_SLOW_MOTION=${process.env.UI_TEST_SLOW_MOTION || "not set"}`);
    console.log(`[Env] UI_TEST_SLOW_MOTION_DELAY=${process.env.UI_TEST_SLOW_MOTION_DELAY || "not set"}`);
} catch (error) {
    // dotenv is optional - if not installed, environment variables must be set manually
    console.log("[Env] Error loading .env files:", error);
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
