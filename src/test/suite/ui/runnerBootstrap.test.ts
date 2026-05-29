/**
 * @file src/test/suite/ui/runnerBootstrap.test.ts
 * @description Smoke tests for shared UI runner bootstrap integration.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { createRunnerPaths } from "../../../test/ui/runners/runnerBootstrap";
import { TEST_PATHS } from "../../../test/ui/config/testConfig";

suite("UI Runner Bootstrap", () => {
    test("creates stable canonical runner paths", () => {
        const projectRoot = path.resolve(__dirname, "../../../../");
        const paths = createRunnerPaths(projectRoot);

        assert.strictEqual(paths.baseStoragePath, path.resolve(projectRoot, TEST_PATHS.BASE_STORAGE));
        assert.strictEqual(paths.testStoragePath, path.join(paths.baseStoragePath, TEST_PATHS.VSCODE_DATA));
        assert.strictEqual(paths.extensionsPath, path.join(paths.baseStoragePath, TEST_PATHS.EXTENSIONS));
        assert.strictEqual(paths.runtimeWorkspacePath, path.join(paths.baseStoragePath, TEST_PATHS.WORKSPACE));
        assert.strictEqual(paths.fixturesPath, path.resolve(projectRoot, TEST_PATHS.FIXTURES));
        assert.strictEqual(paths.packageJsonPath, path.join(projectRoot, TEST_PATHS.PACKAGE_JSON));
    });

    test("both runner entry points reference shared bootstrap helpers", () => {
        const projectRoot = path.resolve(__dirname, "../../../../");
        const runUiPath = path.join(projectRoot, "src/test/ui/runners/runUITests.ts");
        const runProfilesPath = path.join(projectRoot, "src/test/ui/runners/runUITestsWithProfiles.ts");

        const runUiSource = fs.readFileSync(runUiPath, "utf-8");
        const runProfilesSource = fs.readFileSync(runProfilesPath, "utf-8");

        assert.ok(
            runUiSource.includes('from "./runnerBootstrap"'),
            "runUITests.ts should import shared runnerBootstrap helpers"
        );
        assert.ok(
            runProfilesSource.includes('from "./runnerBootstrap"'),
            "runUITestsWithProfiles.ts should import shared runnerBootstrap helpers"
        );

        const expectedHelperCalls = ["prepareRuntimeWorkspace", "ensureVsixPackage", "setupExTesterEnvironment"];
        for (const helperName of expectedHelperCalls) {
            assert.ok(runUiSource.includes(helperName), `runUITests.ts should use ${helperName}`);
            assert.ok(runProfilesSource.includes(helperName), `runUITestsWithProfiles.ts should use ${helperName}`);
        }
    });
});
