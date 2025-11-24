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
    const result1 = dotenv.config();
    if (result1.error) {
        console.log("[Env] No .env file found or error loading it");
    } else {
        console.log("[Env] Loaded .env file");
    }

    // Try multiple possible paths for testBenchConnection.env
    const possiblePaths = [
        path.resolve(__dirname, "../../../testBenchConnection.env"), // Project root (from compiled out/test/ui)
        path.resolve(process.cwd(), "testBenchConnection.env"), // Current working directory
        path.resolve(process.cwd(), ".testbenchConnection.env"), // Alternative name
        path.resolve(__dirname, "../../testBenchConnection.env") // Alternative relative path
    ];

    let loaded = false;
    for (const envPath of possiblePaths) {
        const result = dotenv.config({ path: envPath });
        if (!result.error) {
            console.log(`[Env] Loaded testBenchConnection.env from: ${envPath}`);
            loaded = true;
            break;
        }
    }

    if (!loaded) {
        console.log("[Env] testBenchConnection.env not found in any of the expected locations");
        console.log(`[Env] Tried paths: ${possiblePaths.join(", ")}`);
    }

    // Log slow motion config for debugging
    const slowMotion = process.env.UI_TEST_SLOW_MOTION;
    const slowMotionDelay = process.env.UI_TEST_SLOW_MOTION_DELAY;
    console.log(`[Env] UI_TEST_SLOW_MOTION=${slowMotion || "not set"}`);
    console.log(`[Env] UI_TEST_SLOW_MOTION_DELAY=${slowMotionDelay || "not set"}`);
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
