/**
 * @file src/test/suite/authentication/testBenchAuthenticationProvider.test.ts
 * @description This file contains unit tests for the TestBenchAuthenticationProvider class.
 */

import * as assert from "assert";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { compareMajorMinorVersions, validateServerVersion } from "../../../testBenchAuthenticationProvider";
import { DependencyVersionError } from "../../../errors";

suite("TestBenchAuthenticationProvider Test Suite", function () {
    let testEnv: TestEnvironment;

    this.beforeEach(() => {
        testEnv = setupTestEnvironment();
    });

    this.afterEach(() => {
        testEnv.sandbox.restore();
    });

    suite("compareMajorMinorVersions", () => {
        test("should ignore the bugfix part", () => {
            assert.strictEqual(compareMajorMinorVersions("4.1.03", "4.1"), 0);
        });

        test("should compare minor versions numerically", () => {
            assert.ok(compareMajorMinorVersions("4.10", "4.9") > 0);
        });

        test("should compare major versions first", () => {
            assert.ok(compareMajorMinorVersions("5.0", "4.9") > 0);
            assert.ok(compareMajorMinorVersions("3.9", "4.0") < 0);
        });

        test("should return NaN for unparsable versions", () => {
            assert.ok(Number.isNaN(compareMajorMinorVersions("abc", "4.1")));
        });
    });

    suite("validateServerVersion", () => {
        for (const version of ["4.1", "4.1.03", "4.2", "4.2.1"]) {
            test(`should accept supported version ${version}`, async () => {
                await validateServerVersion(version, false);
                assert.ok(testEnv.vscodeMocks.showErrorMessageStub.notCalled);
            });
        }

        for (const version of ["4.0.5", "4.3", "5.0", "invalid"]) {
            test(`should reject unsupported version ${version}`, async () => {
                await assert.rejects(validateServerVersion(version, false), DependencyVersionError);
                assert.ok(testEnv.vscodeMocks.showErrorMessageStub.calledOnce);
            });
        }

        test("should suggest the compatible extension version for older servers", async () => {
            await assert.rejects(validateServerVersion("4.0.5", false), DependencyVersionError);
            const options = testEnv.vscodeMocks.showErrorMessageStub.firstCall.args[1];
            assert.ok(options.detail.includes("0.6.2"));
        });

        test("should point to a newer extension for newer servers", async () => {
            await assert.rejects(validateServerVersion("4.3", false), DependencyVersionError);
            const options = testEnv.vscodeMocks.showErrorMessageStub.firstCall.args[1];
            assert.ok(options.detail.includes("newer version"));
        });

        test("should reject an empty version", async () => {
            await assert.rejects(validateServerVersion("  ", false), DependencyVersionError);
        });
    });
});
