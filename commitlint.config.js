module.exports = {
    extends: ["@commitlint/config-conventional"],
    rules: {
        "header-max-length": [2, "always", 150] // Increase character limit of commits from 100 (default) to 150
    }
};
