/**
 * @file src/test/ui/config/testConfigurations.ts
 * @description Defines multiple test configuration profiles for UI testing.
 * Each profile represents a different combination of extension settings.
 */

export interface ExtensionSettingsProfile {
    name: string;
    description: string;
    settings: Record<string, any>;
}

export interface ProfileSummary {
    /** Profile identifier used by CLI flags (for example: --profile=<name>). */
    name: string;
    /** Human-readable profile description displayed in logs/listing output. */
    description: string;
}

/**
 * Base settings common to all profiles (non-extension specific settings).
 */
const BASE_VSCODE_SETTINGS = {
    "security.workspace.trust.enabled": false,
    "files.autoSave": "afterDelay",
    "files.autoSaveDelay": 100,
    "window.titleBarStyle": "custom",
    "workbench.colorTheme": "Default Dark+",
    "update.mode": "none",
    "update.showReleaseNotes": false,
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "telemetry.telemetryLevel": "off",
    "workbench.enableExperiments": false,
    "git.enabled": false,
    "editor.minimap.enabled": false,
    "editor.hover.enabled": false,
    "editor.cursorBlinking": "solid",
    "workbench.reduceMotion": "on",
    "editor.renderIndentGuides": false,
    "editor.matchBrackets": "never",
    "editor.acceptSuggestionOnEnter": "off",
    "editor.quickSuggestions": {
        other: false,
        comments: false,
        strings: false
    },
    "editor.parameterHints.enabled": false,
    "window.restoreWindows": "none",
    "files.hotExit": "off"
};

/**
 * Default extension settings used as baseline.
 */
const DEFAULT_EXTENSION_SETTINGS = {
    "testbenchExtension.automaticLoginAfterExtensionActivation": false,
    "testbenchExtension.testbenchLogLevel": "Trace",
    // "testbenchExtension.UseConfigurationFile": false,
    "testbenchExtension.cleanFilesBeforeTestGeneration": true,
    "testbenchExtension.fullyQualifiedKeywords": false,
    "testbenchExtension.outputDirectory": "tests",
    "testbenchExtension.compoundKeywordLogging": "GROUP",
    "testbenchExtension.logSuiteNumbering": true,
    "testbenchExtension.resourceDirectoryPath": "resources",
    "testbenchExtension.libraryMarker": ["[Robot-Library]"],
    "testbenchExtension.libraryRoot": ["RF", "RF-Library"],
    "testbenchExtension.resourceRootRegex": "resources",
    "testbenchExtension.resourceMarker": ["[Robot-Resource]"],
    "testbenchExtension.resourceRoot": ["RF-Resource"],
    "testbenchExtension.libraryMapping": [],
    "testbenchExtension.resourceMapping": [],
    "testbenchExtension.outputXmlFilePath": "results/output.xml",
    "testbenchExtension.clearInternalTestbenchDirectoryBeforeTestGeneration": false,
    "testbenchExtension.openTestingViewAfterTestGeneration": false,
    "testbenchExtension.certificatePath": ""
};

/**
 * Predefined test configuration profiles.
 * Add new profiles here to test different setting combinations.
 */
export const TEST_PROFILES: ExtensionSettingsProfile[] = [
    {
        name: "default",
        description: "Default extension settings (baseline configuration)",
        settings: { ...DEFAULT_EXTENSION_SETTINGS }
    },
    {
        name: "fully-qualified-keywords",
        description: "Tests with fully qualified keywords enabled",
        settings: {
            ...DEFAULT_EXTENSION_SETTINGS,
            "testbenchExtension.fullyQualifiedKeywords": true
        }
    },
    {
        name: "clean-files-disabled",
        description: "Tests without cleaning files before generation",
        settings: {
            ...DEFAULT_EXTENSION_SETTINGS,
            "testbenchExtension.cleanFilesBeforeTestGeneration": false
        }
    },
    {
        name: "custom-output-path",
        description: "Tests with custom output directory",
        settings: {
            ...DEFAULT_EXTENSION_SETTINGS,
            "testbenchExtension.outputDirectory": "custom-tests",
            "testbenchExtension.resourceDirectoryPath": "custom-resources",
            "testbenchExtension.outputXmlFilePath": "custom-results/output.xml"
        }
    },
    {
        name: "suite-logging",
        description: "Tests with COMMENT-level compound keyword logging",
        settings: {
            ...DEFAULT_EXTENSION_SETTINGS,
            "testbenchExtension.compoundKeywordLogging": "COMMENT",
            "testbenchExtension.logSuiteNumbering": false
        }
    },
    /*
    {
        name: "config-file-mode",
        description: "Tests using configuration file",
        settings: {
            ...DEFAULT_EXTENSION_SETTINGS,
            "testbenchExtension.UseConfigurationFile": true
        }
    },
    */
    {
        name: "open-testing-view",
        description: "Tests with automatic testing view opening",
        settings: {
            ...DEFAULT_EXTENSION_SETTINGS,
            "testbenchExtension.openTestingViewAfterTestGeneration": true
        }
    },
    {
        name: "clear-internal-directory",
        description: "Tests with internal directory clearing enabled",
        settings: {
            ...DEFAULT_EXTENSION_SETTINGS,
            "testbenchExtension.clearInternalTestbenchDirectoryBeforeTestGeneration": true
        }
    }
];

/**
 * Returns profile names and descriptions for display/reporting use-cases.
 *
 * @returns Profile summaries derived from the single TEST_PROFILES source.
 */
export function getProfileSummaries(): ProfileSummary[] {
    return TEST_PROFILES.map((profile) => ({
        name: profile.name,
        description: profile.description
    }));
}

/**
 * Validates profile metadata and returns human-readable issues.
 *
 * @param profiles - Optional profile set to validate. Defaults to TEST_PROFILES.
 * @returns Array of validation error messages. Empty array means valid metadata.
 */
export function validateProfileConfiguration(profiles: ExtensionSettingsProfile[] = TEST_PROFILES): string[] {
    const errors: string[] = [];
    const seenProfileNames = new Set<string>();

    if (profiles.length === 0) {
        errors.push("At least one test profile must be configured.");
        return errors;
    }

    for (const profile of profiles) {
        const trimmedName = profile.name.trim();
        const trimmedDescription = profile.description.trim();

        if (!trimmedName) {
            errors.push("Profile name must not be empty.");
            continue;
        }

        if (!trimmedDescription) {
            errors.push(`Profile '${trimmedName}' must include a description.`);
        }

        if (seenProfileNames.has(trimmedName)) {
            errors.push(`Duplicate profile name detected: '${trimmedName}'.`);
        } else {
            seenProfileNames.add(trimmedName);
        }
    }

    return errors;
}

/**
 * Throws when profile metadata is invalid.
 *
 * @param profiles - Optional profile set to validate. Defaults to TEST_PROFILES.
 * @throws Error when one or more profile validation issues are found.
 */
export function assertValidProfileConfiguration(profiles: ExtensionSettingsProfile[] = TEST_PROFILES): void {
    const validationErrors = validateProfileConfiguration(profiles);
    if (validationErrors.length === 0) {
        return;
    }

    throw new Error(`Invalid test profile configuration:\n- ${validationErrors.join("\n- ")}`);
}

/**
 * Gets a test profile by name.
 *
 * @param profileName - Name of the profile to retrieve
 * @returns The profile object or undefined if not found
 */
export function getProfileByName(profileName: string): ExtensionSettingsProfile | undefined {
    return TEST_PROFILES.find((profile) => profile.name === profileName);
}

/**
 * Gets all available profile names.
 *
 * @returns Array of profile names
 */
export function getAvailableProfiles(): string[] {
    return TEST_PROFILES.map((profile) => profile.name);
}

/**
 * Merges base settings with profile-specific settings.
 *
 * @param profile - The test profile to merge
 * @returns Complete settings object
 */
export function getCompleteSettings(profile: ExtensionSettingsProfile): Record<string, any> {
    return {
        ...BASE_VSCODE_SETTINGS,
        ...profile.settings
    };
}

/**
 * Validates a profile name.
 *
 * @param profileName - Name to validate
 * @returns True if profile exists, false otherwise
 */
export function isValidProfile(profileName: string): boolean {
    return TEST_PROFILES.some((profile) => profile.name === profileName);
}
