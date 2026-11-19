/**
 * @file src/test/suite/authentication/testBenchAuthenticationProvider.test.ts
 * @description This file contains unit tests for the TestBenchAuthenticationProvider class.
 */

import * as assert from "assert";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import {
    CHECK_FOR_UPDATES_ACTION,
    classifyServerVersion,
    resetServerVersionWarnings,
    validateServerVersion
} from "../../../serverVersionCheck";
import { DependencyVersionError } from "../../../errors";

suite("TestBenchAuthenticationProvider Test Suite", function () {
    let testEnv: TestEnvironment;

    this.beforeEach(() => {
        testEnv = setupTestEnvironment();
        resetServerVersionWarnings();
    });

    this.afterEach(() => {
        testEnv.sandbox.restore();
    });

    suite("classifyServerVersion", () => {
        test("should ignore the bugfix part", () => {
            assert.strictEqual(classifyServerVersion("4.1.03", "4.1", "4.1"), "supported");
        });

        test("should compare minor versions numerically", () => {
            assert.strictEqual(classifyServerVersion("4.10", "4.1", "4.9"), "newer");
        });

        test("should compare major versions first", () => {
            assert.strictEqual(classifyServerVersion("5.0", "4.1", "4.9"), "newer");
            assert.strictEqual(classifyServerVersion("3.9", "4.0", "4.2"), "older");
        });

        test("should treat both ends of the range as supported", () => {
            assert.strictEqual(classifyServerVersion("4.1", "4.1", "4.2"), "supported");
            assert.strictEqual(classifyServerVersion("4.2", "4.1", "4.2"), "supported");
        });

        test("should return unknown for unparsable versions", () => {
            assert.strictEqual(classifyServerVersion("abc"), "unknown");
        });
    });

    suite("validateServerVersion", () => {
        for (const version of ["4.1", "4.1.03", "4.2", "4.2.1"]) {
            test(`should accept supported version ${version}`, async () => {
                await validateServerVersion(version, false);
                assert.ok(testEnv.vscodeMocks.showErrorMessageStub.notCalled);
                assert.ok(testEnv.vscodeMocks.showWarningMessageStub.notCalled);
            });
        }

        for (const version of ["4.0.5", "3.9", "invalid"]) {
            test(`should reject unsupported version ${version}`, async () => {
                await assert.rejects(validateServerVersion(version, false), DependencyVersionError);
                assert.ok(testEnv.vscodeMocks.showErrorMessageStub.calledOnce);
            });
        }

        for (const version of ["4.3", "5.0"]) {
            test(`should only warn about newer version ${version}`, async () => {
                await validateServerVersion(version, false);
                assert.ok(testEnv.vscodeMocks.showErrorMessageStub.notCalled);
                assert.ok(testEnv.vscodeMocks.showWarningMessageStub.calledOnce);
            });
        }

        test("should suggest the compatible extension version for older servers", async () => {
            await assert.rejects(validateServerVersion("4.0.5", false), DependencyVersionError);
            const options = testEnv.vscodeMocks.showErrorMessageStub.firstCall.args[1];
            assert.ok(options.detail.includes("0.6.2"));
        });

        test("should offer an extension update check for newer servers", async () => {
            await validateServerVersion("4.3", false);
            const args = testEnv.vscodeMocks.showWarningMessageStub.firstCall.args;
            assert.ok(args[0].includes("4.3"));
            assert.strictEqual(args[1], CHECK_FOR_UPDATES_ACTION);
        });

        test("should warn about a newer server only once", async () => {
            await validateServerVersion("4.3", false);
            await validateServerVersion("4.3.1", false);
            assert.ok(testEnv.vscodeMocks.showWarningMessageStub.calledOnce);
        });

        test("should reject an empty version", async () => {
            await assert.rejects(validateServerVersion("  ", false), DependencyVersionError);
        });
    });
});
