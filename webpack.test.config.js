//@ts-check
"use strict";

const path = require("path");

/** @type {import('webpack').Configuration} */
const testConfig = {
    target: "node",
    mode: "development",
    entry: "./src/test/runTest.ts",
    output: {
        path: path.resolve(__dirname, "out", "test"),
        filename: "runTest.js",
        libraryTarget: "commonjs2"
    },
    externals: {
        vscode: "commonjs vscode",
        mocha: "commonjs mocha"
    },
    resolve: {
        extensions: [".ts", ".js"]
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: ["ts-loader"]
            }
        ]
    },
    devtool: "source-map"
};

module.exports = testConfig;
