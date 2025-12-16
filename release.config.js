module.exports = {
    branches: [
        "main",
        { name: "prerelease", prerelease: true },
        { name: "feature", prerelease: true },
        { name: "feature/**", prerelease: true }
    ],
    preset: "conventionalcommits",
    plugins: [
        // Analyze commits to determine version bump
        [
            "@semantic-release/commit-analyzer",
            {
                preset: "conventionalcommits"
                // Default behavior:
                // - feat: minor
                // - fix: patch
                // - perf: patch
                // - BREAKING CHANGE: major
                // - Other types (docs, chore, style, etc.) will not trigger a release.
                // Can be overridden with releaseRules array if needed.
            }
        ],

        // Generate release notes
        [
            "@semantic-release/release-notes-generator",
            {
                preset: "conventionalcommits",
                presetConfig: {
                    types: [
                        { type: "feat", section: "Features" },
                        { type: "fix", section: "Bug Fixes" },
                        { type: "perf", section: "Performance Improvements" },
                        { type: "revert", section: "Reverts" },
                        { type: "docs", section: "Documentation" },
                        { type: "style", section: "Styles" },
                        { type: "chore", section: "Miscellaneous Chores" },
                        { type: "refactor", section: "Code Refactoring" },
                        { type: "test", section: "Tests" },
                        { type: "build", section: "Build System" },
                        { type: "ci", section: "Continuous Integration" }
                    ]
                }
            }
        ],

        // Update CHANGELOG.md file
        [
            "@semantic-release/changelog",
            {
                changelogFile: "CHANGELOG.md",
                changelogTitle:
                    "# Changelog\n\nAll notable changes to this project will be documented in this file. See [Conventional Commits](https://conventionalcommits.org) for commit guidelines."
            }
        ],

        // Update package.json version (but don't publish to npm)
        [
            "@semantic-release/npm",
            {
                npmPublish: false, // VS Code extensions aren't published to npm
                pkgRoot: "."
            }
        ],

        // Build the VSIX package with the new version
        [
            "@semantic-release/exec",
            {
                prepareCmd: "npm run package && vsce package -o testbench-extension-v${nextRelease.version}.vsix"
            }
        ],

        // Create GitHub release and upload assets
        [
            "@semantic-release/github",
            {
                assets: [
                    {
                        path: "testbench-extension-v${nextRelease.version}.vsix",
                        label: "VSIX Extension (v${nextRelease.version})"
                    }
                ]
            }
        ],

        // Commit version changes (CHANGELOG.md and package.json)
        [
            "@semantic-release/git",
            {
                assets: ["CHANGELOG.md", "package.json"],
                message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
            }
        ]
    ]
};
