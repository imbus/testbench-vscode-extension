#!/usr/bin/env node
/**
 * @file scripts/clean-tests.js
 * @description Cleans compiled test files to prevent stale artifacts.
 */

import { existsSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testOutputDir = join(__dirname, "..", "out", "test");

if (existsSync(testOutputDir)) {
    rmSync(testOutputDir, { recursive: true, force: true });
    console.log(`Cleaned: ${testOutputDir}`);
} else {
    console.log(`Already clean: ${testOutputDir}`);
}
