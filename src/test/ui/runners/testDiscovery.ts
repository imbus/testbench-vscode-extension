/**
 * @file src/test/ui/runners/testDiscovery.ts
 * @description Shared UI test discovery and selection utilities for all UI runners.
 */

import * as fs from "fs";
import * as path from "path";

/** Canonical source suffix for UI test files. */
const UI_TEST_SUFFIX = ".ui.test.ts";

/**
 * Metadata describing one discovered UI test source file and its compiled artifact.
 */
export interface DiscoveredUiTestFile {
    /** Source-relative path from src/test/ui (always slash-normalized). */
    sourceRelativePath: string;
    /** Basename of the source file (e.g. loginWebview.ui.test.ts). */
    sourceFileName: string;
    /** Absolute path to the compiled JS test file under out/test/ui. */
    compiledAbsolutePath: string;
    /** Compact display name for summary output. */
    summaryName: string;
}

/**
 * Normalizes path separators to forward slashes for stable matching and logging.
 *
 * @param value Path string to normalize.
 * @returns Path with slash separators.
 */
function normalizePath(value: string): string {
    return value.replace(/\\/g, "/");
}

/**
 * Recursively scans for UI tests and collects source-relative file paths.
 *
 * @param sourceRoot Root source directory (src/test/ui).
 * @param currentDir Directory currently being scanned.
 * @param collected Mutable collection for discovered relative paths.
 */
function collectUiTestsRecursive(sourceRoot: string, currentDir: string, collected: string[]): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            collectUiTestsRecursive(sourceRoot, absolutePath, collected);
            continue;
        }

        if (entry.isFile() && entry.name.endsWith(UI_TEST_SUFFIX)) {
            const relativePath = path.relative(sourceRoot, absolutePath);
            collected.push(normalizePath(relativePath));
        }
    }
}

/**
 * Converts user input to a normalized UI test source file shape.
 * Accepts bare names and common extensions (.ts/.js/.ui.test) for convenience.
 *
 * @param requestedTestFile User-provided test selector.
 * @returns Normalized source-style test filename/path.
 */
function normalizeRequestedTestFileName(requestedTestFile: string): string {
    const trimmed = normalizePath(requestedTestFile.trim());

    if (!trimmed) {
        return "";
    }

    if (trimmed.endsWith(".ui.test.ts")) {
        return trimmed;
    }

    if (trimmed.endsWith(".ui.test.js")) {
        return trimmed.slice(0, -3) + ".ts";
    }

    if (trimmed.endsWith(".ui.test")) {
        return `${trimmed}.ts`;
    }

    if (trimmed.endsWith(".js")) {
        return trimmed.slice(0, -3) + ".ts";
    }

    if (trimmed.endsWith(".ts")) {
        return trimmed;
    }

    return `${trimmed}${UI_TEST_SUFFIX}`;
}

/**
 * Discovers all UI test source files and maps them to expected compiled outputs.
 *
 * @param projectRoot Repository root path.
 * @param compiledUiRoot Root directory for compiled UI tests (usually out/test/ui).
 * @returns Sorted list of discovered UI test metadata.
 */
export function discoverUiTestFiles(projectRoot: string, compiledUiRoot: string): DiscoveredUiTestFile[] {
    const sourceUiRoot = path.join(projectRoot, "src/test/ui");
    if (!fs.existsSync(sourceUiRoot)) {
        return [];
    }

    const discoveredRelativePaths: string[] = [];
    collectUiTestsRecursive(sourceUiRoot, sourceUiRoot, discoveredRelativePaths);
    discoveredRelativePaths.sort((a, b) => a.localeCompare(b));

    return discoveredRelativePaths.map((sourceRelativePath) => {
        const sourceFileName = path.basename(sourceRelativePath);
        const compiledRelativePath = sourceRelativePath.replace(/\.ts$/, ".js");
        const compiledAbsolutePath = path.join(compiledUiRoot, compiledRelativePath);
        const summaryName = sourceFileName.replace(UI_TEST_SUFFIX, "");

        return {
            sourceRelativePath,
            sourceFileName,
            compiledAbsolutePath,
            summaryName
        };
    });
}

/**
 * Selects a concrete subset of discovered tests based on optional user input.
 *
 * Matching rules:
 * - No selector: returns all discovered tests.
 * - Exact relative path match (from src/test/ui) or basename match, case-insensitive.
 * - Throws on ambiguity or no match to avoid silent mis-selection.
 *
 * @param discoveredTests All discovered tests.
 * @param requestedTestFile Optional user selector for a specific test file.
 * @returns Filtered list of tests to execute.
 */
export function selectUiTestFiles(
    discoveredTests: DiscoveredUiTestFile[],
    requestedTestFile?: string
): DiscoveredUiTestFile[] {
    if (!requestedTestFile) {
        return discoveredTests;
    }

    const normalizedRequest = normalizeRequestedTestFileName(requestedTestFile);
    if (!normalizedRequest) {
        return discoveredTests;
    }

    const candidates = discoveredTests.filter((test) => {
        const relativeMatch = test.sourceRelativePath.toLowerCase() === normalizedRequest.toLowerCase();
        const fileMatch = test.sourceFileName.toLowerCase() === normalizedRequest.toLowerCase();
        return relativeMatch || fileMatch;
    });

    if (candidates.length === 1) {
        return candidates;
    }

    if (candidates.length > 1) {
        const matches = candidates.map((test) => test.sourceRelativePath).join(", ");
        throw new Error(`Ambiguous test file '${requestedTestFile}'. Matches: ${matches}`);
    }

    const availableTests = discoveredTests.map((test) => test.sourceRelativePath).join(", ");
    throw new Error(`Test file '${requestedTestFile}' not found. Available: ${availableTests}`);
}
