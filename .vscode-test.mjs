import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
    tests: [
        {
            files: "out/test/**/*.test.js",
            version: "stable",
            launchArgs: ["--disable-extensions", "--disable-workspace-trust", "--disable-telemetry"],
            mocha: {
                ui: "tdd",
                timeout: 60000,
                color: true
            }
        }
    ],
    // Coverage relies on c8's default include/exclude rules, which correctly skip
    // *.test.ts and node_modules. Setting `exclude` here would replace those
    // defaults rather than extend them, so it is deliberately left unset.
    coverage: {
        reporter: ["text-summary", "lcovonly", "html"]
    }
});
