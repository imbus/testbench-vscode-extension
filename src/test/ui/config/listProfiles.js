#!/usr/bin/env node

/**
 * @file src/test/ui/listProfiles.js
 * @description Utility script to list all available test profiles.
 * Usage: node src/test/ui/listProfiles.js
 */

// Simple script to list profiles without TypeScript compilation
const profiles = [
    {
        name: "default",
        description: "Default extension settings (baseline configuration)"
    },
    {
        name: "fully-qualified-keywords",
        description: "Tests with fully qualified keywords enabled"
    },
    {
        name: "clean-files-disabled",
        description: "Tests without cleaning files before generation"
    },
    {
        name: "custom-output-path",
        description: "Tests with custom output directory"
    },
    {
        name: "suite-logging",
        description: "Tests with different compound keyword logging"
    },
    /*
    {
        name: "config-file-mode",
        description: "Tests using configuration file"
    },
    */
    {
        name: "open-testing-view",
        description: "Tests with automatic testing view opening"
    },
    {
        name: "clear-internal-directory",
        description: "Tests with internal directory clearing enabled"
    }
];

console.log("\n" + "=".repeat(80));
console.log("Available Test Profiles");
console.log("=".repeat(80) + "\n");

profiles.forEach((profile, index) => {
    console.log(`${index + 1}. ${profile.name}`);
    console.log(`   ${profile.description}\n`);
});

console.log("Usage:");
console.log("  npm run test:ui-profile -- --profile=<name>");
console.log("  npm run test:ui-all-profiles\n");
console.log("Example:");
console.log("  npm run test:ui-profile -- --profile=fully-qualified-keywords\n");
