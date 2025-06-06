/**
 * @file src/test/suite/extension.test.ts
 * @description This file contains unit tests for the VS Code extension.
 */

import * as assert from "assert";
import { activate } from "../../extension"; // The function we want to test
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";
import { TESTBENCH_AUTH_PROVIDER_ID, TestBenchAuthenticationProvider } from "../../testBenchAuthenticationProvider";

suite("Extension Test Suite", () => {
    // Declare a variable to hold our test environment
    let testEnv: TestEnvironment;

    // Use a beforeEach hook to set up a clean, sandboxed environment for each test
    setup(() => {
        testEnv = setupTestEnvironment();
    });

    // Use an afterEach hook to restore all stubs and mocks after each test
    teardown(() => {
        testEnv.sandbox.restore();
    });

    suite("Activation", () => {
        test("should register the TestBenchAuthenticationProvider on activation", async () => {
            // Arrange:
            // 1. Get the stub for the vscode.authentication.registerAuthenticationProvider function.
            //    This stub was created for us by setupTestEnvironment().
            const registerStub = testEnv.vscodeMocks.registerAuthenticationProviderStub;

            // 2. Ensure the stub has not been called before the test.
            assert.ok(
                registerStub.notCalled,
                "Pre-condition failed: registerAuthenticationProvider should not have been called yet"
            );

            // Act:
            // 1. Call the activate function with our mock context.
            await activate(testEnv.mockContext);

            // Assert:
            // 1. Verify that registerAuthenticationProvider was called exactly once.
            assert.ok(registerStub.calledOnce, "registerAuthenticationProvider should have been called once");

            // 2. Get the arguments from the call to inspect them.
            const [id, label, providerInstance] = registerStub.firstCall.args;

            // 3. Verify the provider was registered with the correct ID and label.
            assert.strictEqual(id, TESTBENCH_AUTH_PROVIDER_ID, "Authentication provider registered with incorrect ID");
            assert.strictEqual(label, "TestBench", "Authentication provider registered with incorrect label");

            // 4. Verify that the object passed as the provider is indeed an instance of our class.
            assert.ok(
                providerInstance instanceof TestBenchAuthenticationProvider,
                "The registered provider is not an instance of TestBenchAuthenticationProvider"
            );

            // 5. Verify that the new provider instance was added to the context's subscriptions for proper disposal.
            assert.ok(
                testEnv.mockContext.subscriptions.length > 0,
                "A disposable should have been added to the context subscriptions"
            );
        });
    });
});
