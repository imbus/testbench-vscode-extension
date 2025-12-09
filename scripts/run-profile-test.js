#!/usr/bin/env node

/**
 * @file scripts/run-profile-test.js
 * @description Interactive helper to run UI tests with profiles.
 * Simplifies the command-line interface for multi-configuration testing.
 */

const { execSync } = require("child_process");
const readline = require("readline");

const profiles = [
    "default",
    "fully-qualified-keywords",
    "clean-files-disabled",
    "custom-output-path",
    "suite-logging",
    "config-file-mode",
    "open-testing-view",
    "clear-internal-directory"
];

const testFiles = [
    "loginWebview.ui.test.ts",
    "projectsView.ui.test.ts",
    "testThemesView.ui.test.ts",
    "resourceCreationFlow.ui.test.ts"
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function main() {
    console.log("\n" + "=".repeat(80));
    console.log("UI Test Runner - Profile Selection");
    console.log("=".repeat(80) + "\n");

    // Profile selection
    console.log("Available profiles:");
    profiles.forEach((profile, index) => {
        console.log(`  ${index + 1}. ${profile}`);
    });
    console.log(`  ${profiles.length + 1}. ALL PROFILES`);

    const profileChoice = await question("\nSelect profile (1-" + (profiles.length + 1) + "): ");
    const profileIndex = parseInt(profileChoice) - 1;

    let selectedProfile = null;
    let runAllProfiles = false;

    if (profileIndex === profiles.length) {
        runAllProfiles = true;
        console.log("\n✓ Will run with ALL profiles");
    } else if (profileIndex >= 0 && profileIndex < profiles.length) {
        selectedProfile = profiles[profileIndex];
        console.log(`\n✓ Selected profile: ${selectedProfile}`);
    } else {
        console.log("\n✗ Invalid selection");
        rl.close();
        process.exit(1);
    }

    // Test file selection
    console.log("\nAvailable test files:");
    testFiles.forEach((file, index) => {
        console.log(`  ${index + 1}. ${file}`);
    });
    console.log(`  ${testFiles.length + 1}. ALL TESTS`);

    const fileChoice = await question("\nSelect test file (1-" + (testFiles.length + 1) + "): ");
    const fileIndex = parseInt(fileChoice) - 1;

    let selectedFile = null;

    if (fileIndex === testFiles.length) {
        console.log("\n✓ Will run ALL tests");
    } else if (fileIndex >= 0 && fileIndex < testFiles.length) {
        selectedFile = testFiles[fileIndex];
        console.log(`\n✓ Selected test: ${selectedFile}`);
    } else {
        console.log("\n✗ Invalid selection");
        rl.close();
        process.exit(1);
    }

    // Skip setup option
    const skipSetup = await question("\nSkip VS Code setup (faster if already set up)? (y/N): ");
    const shouldSkipSetup = skipSetup.toLowerCase() === "y" || skipSetup.toLowerCase() === "yes";

    // Build command
    let command;

    if (runAllProfiles) {
        command = "npm run test:ui-all-profiles";
        if (selectedFile) {
            command += ` -- --test=${selectedFile}`;
        }
    } else {
        command = "npm run test:ui-profile -- --profile=" + selectedProfile;
        if (selectedFile) {
            command += ` --test=${selectedFile}`;
        }
    }

    if (shouldSkipSetup) {
        command += " --skip-setup";
    }

    console.log("\n" + "=".repeat(80));
    console.log("Running command:");
    console.log("  " + command);
    console.log("=".repeat(80) + "\n");

    rl.close();

    try {
        execSync(command, { stdio: "inherit" });
        console.log("\n✓ Tests completed successfully!");
    } catch (error) {
        console.log("\n✗ Tests failed!");
        process.exit(1);
    }
}

main();
