/**
 * @file src/test/suite/ui/testConfigurations.test.ts
 * @description Unit tests for UI test profile configuration helpers.
 */

import * as assert from "assert";
import {
    TEST_PROFILES,
    getAvailableProfiles,
    getProfileSummaries,
    validateProfileConfiguration,
    assertValidProfileConfiguration,
    type ExtensionSettingsProfile
} from "../../../test/ui/config/testConfigurations";

suite("UI Test Profile Configuration", () => {
    test("uses one source of truth for profile names", () => {
        const namesFromProfiles = TEST_PROFILES.map((profile) => profile.name);
        const namesFromAccessor = getAvailableProfiles();
        const namesFromSummaries = getProfileSummaries().map((profile) => profile.name);

        assert.deepStrictEqual(namesFromAccessor, namesFromProfiles);
        assert.deepStrictEqual(namesFromSummaries, namesFromProfiles);
    });

    test("default profile configuration is valid", () => {
        assert.deepStrictEqual(validateProfileConfiguration(), []);
        assert.doesNotThrow(() => assertValidProfileConfiguration());
    });

    test("reports duplicate profile names", () => {
        const duplicateProfiles: ExtensionSettingsProfile[] = [
            {
                name: "duplicate",
                description: "First profile",
                settings: {}
            },
            {
                name: "duplicate",
                description: "Second profile",
                settings: {}
            }
        ];

        const errors = validateProfileConfiguration(duplicateProfiles);
        assert.ok(errors.some((error) => error.includes("Duplicate profile name detected")));

        assert.throws(
            () => assertValidProfileConfiguration(duplicateProfiles),
            (error: unknown) => error instanceof Error && error.message.includes("Duplicate profile name detected")
        );
    });

    test("reports missing profile description", () => {
        const invalidProfiles: ExtensionSettingsProfile[] = [
            {
                name: "profile-without-description",
                description: "   ",
                settings: {}
            }
        ];

        const errors = validateProfileConfiguration(invalidProfiles);
        assert.ok(errors.some((error) => error.includes("must include a description")));
    });

    test("reports empty profile name", () => {
        const invalidProfiles: ExtensionSettingsProfile[] = [
            {
                name: "   ",
                description: "Has description",
                settings: {}
            }
        ];

        const errors = validateProfileConfiguration(invalidProfiles);
        assert.ok(errors.some((error) => error.includes("Profile name must not be empty")));
    });

    test("reports empty profile set", () => {
        const errors = validateProfileConfiguration([]);
        assert.ok(errors.some((error) => error.includes("At least one test profile must be configured")));
    });
});
