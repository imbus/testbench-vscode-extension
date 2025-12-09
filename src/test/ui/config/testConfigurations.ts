/**
 * @file src/test/ui/testConfigurations.ts
 * @description Defines multiple test configuration profiles for UI testing.
 * Each profile represents a different combination of extension settings.
 */

export interface ExtensionSettingsProfile {
    name: string;
    description: string;
    settings: Record<string, any>;
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
    "testbenchExtension.UseConfigurationFile": false,
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
            "testbenchExtension.resourceDirectoryPath": "custom-resources"
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
    {
        name: "config-file-mode",
        description: "Tests using configuration file",
        settings: {
            ...DEFAULT_EXTENSION_SETTINGS,
            "testbenchExtension.UseConfigurationFile": true
        }
    },
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
