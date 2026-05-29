#!/usr/bin/env node

/**
 * @file scripts/run-profile-test.js
 * @description Interactive helper to run UI tests with profiles.
 * Simplifies the command-line interface for multi-configuration testing.
 */

const { execSync } = require("child_process");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

function getProfilesFromConfig() {
    try {
        const configPath = path.join(__dirname, "../src/test/ui/config/testConfigurations.ts");
        const content = fs.readFileSync(configPath, "utf8");

        // Remove comments to avoid matching commented-out profiles
        const contentWithoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

        const profiles = [];
        const regex = /name:\s*"([^"]+)"/g;
        let match;

        while ((match = regex.exec(contentWithoutComments)) !== null) {
            profiles.push(match[1]);
        }

        return profiles;
    } catch (error) {
        console.warn("Could not read profiles from config, falling back to default list.", error.message);
        return [
            "default",
            "fully-qualified-keywords",
            "clean-files-disabled",
            "custom-output-path",
            "suite-logging",
            "open-testing-view",
            "clear-internal-directory"
        ];
    }
}

function getTestFiles() {
    try {
        const testDir = path.join(__dirname, "../src/test/ui");
        if (fs.existsSync(testDir)) {
            return fs.readdirSync(testDir).filter((file) => file.endsWith(".ui.test.ts"));
        }
    } catch (error) {
        console.warn("Could not list test files, falling back to default list.", error.message);
    }

    return [
        "loginWebview.ui.test.ts",
        "projectsView.ui.test.ts",
        "testThemesView.ui.test.ts",
        "resourceCreationFlow.ui.test.ts"
    ];
}

const profiles = getProfilesFromConfig();
const testFiles = getTestFiles();

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
        console.log("\nWill run with ALL profiles");
    } else if (profileIndex >= 0 && profileIndex < profiles.length) {
        selectedProfile = profiles[profileIndex];
        console.log(`\nSelected profile: ${selectedProfile}`);
    } else {
        console.log("\nInvalid selection");
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
        console.log("\nWill run ALL tests");
    } else if (fileIndex >= 0 && fileIndex < testFiles.length) {
        selectedFile = testFiles[fileIndex];
        console.log(`\nSelected test: ${selectedFile}`);
    } else {
        console.log("\nInvalid selection");
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
        console.log("\nTests completed successfully!");
    } catch (error) {
        console.log("\nTests failed!");
        process.exit(1);
    }
}

main();
