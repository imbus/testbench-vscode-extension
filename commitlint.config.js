module.exports = {
    extends: ["@commitlint/config-conventional"],
    rules: {
        "header-max-length": [2, "always", 150] // Increase character limit of commits from 100 (default) to 150
    },
    ignores: [(commit) => commit.includes("[skip ci]")] // Don't lint commit messages that include [skip ci]
};
