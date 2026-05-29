/**
 * @file src/test/ui/config/listProfiles.ts
 * @description Utility script to list all available UI test profiles from the TypeScript profile source.
 */

import { assertValidProfileConfiguration, getProfileSummaries } from "./testConfigurations";

/**
 * Prints all configured profile names and descriptions in a CLI-friendly format.
 */
function printProfiles(): void {
    const profiles = getProfileSummaries();

    console.log("\n" + "=".repeat(80));
    console.log("Available Test Profiles");
    console.log("=".repeat(80) + "\n");

    for (const [index, profile] of profiles.entries()) {
        console.log(`${index + 1}. ${profile.name}`);
        console.log(`   ${profile.description}\n`);
    }

    console.log("Usage:");
    console.log("  npm run test:ui-profile -- --profile=<name>");
    console.log("  npm run test:ui-all-profiles\n");
    console.log("Example:");
    console.log("  npm run test:ui-profile -- --profile=fully-qualified-keywords\n");
}

/**
 * Entrypoint for listing profiles.
 * Validates profile metadata before printing to provide an actionable failure mode.
 */
function main(): void {
    try {
        assertValidProfileConfiguration();
        printProfiles();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to list profiles: ${message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
