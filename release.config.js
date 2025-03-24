module.exports = {
    branches: ["main"],
    preset: "conventionalcommits", // Use conventional commits preset for analysis
    plugins: [
        // Analyze commits to determine version bump
        "@semantic-release/commit-analyzer",

        // Generate release notes
        "@semantic-release/release-notes-generator",

        // Update CHANGELOG.md file
        [
            "@semantic-release/changelog",
            {
                changelogFile: "CHANGELOG.md",
                changelogTitle: "# Changelog"
            }
        ],

        // Update package.json version (but don't publish to npm)
        [
            "@semantic-release/npm",
            {
                npmPublish: false, // VS Code extensions aren't published to npm
                pkgRoot: "." // Look for package.json in root
            }
        ],

        // Commit version changes (CHANGELOG.md and package.json)
        [
            "@semantic-release/git",
            {
                assets: ["CHANGELOG.md", "package.json"],
                message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
            }
        ],

        // Create GitHub release and upload assets
        [
            "@semantic-release/github",
            {
                assets: [
                    {
                        path: "*.vsix", // Package the VSIX file
                        label: "VSIX Extension (v${nextRelease.version})"
                    }
                ]
            }
        ],

        // Build the VSIX package with the new version
        [
            "@semantic-release/exec",
            {
                prepareCmd: "vsce package -o ${name}-v${nextRelease.version}.vsix",
                successCmd: "echo Successfully packaged VSIX extension"
            }
        ]
    ]
};
