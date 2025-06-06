"use strict";
/**
 * @file src/test/suite/extension.test.ts
 * @description This file contains unit tests for the VS Code extension.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const extension_1 = require("../../extension"); // The function we want to test
const testSetup_1 = require("../setup/testSetup");
const testBenchAuthenticationProvider_1 = require("../../testBenchAuthenticationProvider");
suite("Extension Test Suite", () => {
    // Declare a variable to hold our test environment
    let testEnv;
    // Use a beforeEach hook to set up a clean, sandboxed environment for each test
    setup(() => {
        testEnv = (0, testSetup_1.setupTestEnvironment)();
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
            assert.ok(registerStub.notCalled, "Pre-condition failed: registerAuthenticationProvider should not have been called yet");
            // Act:
            // 1. Call the activate function with our mock context.
            await (0, extension_1.activate)(testEnv.mockContext);
            // Assert:
            // 1. Verify that registerAuthenticationProvider was called exactly once.
            assert.ok(registerStub.calledOnce, "registerAuthenticationProvider should have been called once");
            // 2. Get the arguments from the call to inspect them.
            const [id, label, providerInstance] = registerStub.firstCall.args;
            // 3. Verify the provider was registered with the correct ID and label.
            assert.strictEqual(id, testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, "Authentication provider registered with incorrect ID");
            assert.strictEqual(label, "TestBench", "Authentication provider registered with incorrect label");
            // 4. Verify that the object passed as the provider is indeed an instance of our class.
            assert.ok(providerInstance instanceof testBenchAuthenticationProvider_1.TestBenchAuthenticationProvider, "The registered provider is not an instance of TestBenchAuthenticationProvider");
            // 5. Verify that the new provider instance was added to the context's subscriptions for proper disposal.
            assert.ok(testEnv.mockContext.subscriptions.length > 0, "A disposable should have been added to the context subscriptions");
        });
    });
});
//# sourceMappingURL=extension.test.js.map