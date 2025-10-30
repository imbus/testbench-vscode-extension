import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import tsParser from "@typescript-eslint/parser";

/** @type {import('eslint').Linter.Config[]} */
export default [
    // Define which files to lint
    { files: ["**/*.{js,mjs,cjs,ts}"] },

    // Add ignore patterns
    {
        ignores: ["**/out", "**/node_modules", "**/dist", "**/*.d.ts", "**/*.js", ".vscode-test/**"]
    },

    // Set language options, including globals and parser options
    {
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 6,
            sourceType: "module",
            globals: globals.browser
        }
    },

    // Include the recommended configuration for plain JavaScript
    pluginJs.configs.recommended,

    // Include the recommended configuration for TypeScript
    ...tseslint.configs.recommended,

    // Add custom rules
    {
        rules: {
            "@typescript-eslint/naming-convention": [
                "warn",
                {
                    selector: "import",
                    format: ["camelCase", "PascalCase"]
                }
            ],
            curly: "warn",
            eqeqeq: "warn",
            "no-throw-literal": "warn",
            semi: "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_"
                }
            ]
        }
    }
];
