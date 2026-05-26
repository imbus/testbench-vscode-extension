/**
 * @file src/test/suite/authentication/testBenchAuthenticationProvider.test.ts
 * @description This file contains unit tests for the TestBenchAuthenticationProvider class.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import * as connectionManager from "../../../connectionManager";
import { StorageKeys } from "../../../constants";
import { setLogger } from "../../../extension";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";

suite("TestBenchAuthenticationProvider Test Suite", function () {
    let testEnv: TestEnvironment;

    this.beforeEach(() => {
        testEnv = setupTestEnvironment();
        setLogger(testEnv.logger as any);
        (testEnv.mockContext.globalState.get as sinon.SinonStub).callsFake(
            (_key: string, defaultValue?: any) => defaultValue
        );
    });

    this.afterEach(() => {
        testEnv.sandbox.restore();
    });

    suite("Password handling", () => {
        test("should store an explicitly empty password", async () => {
            const connectionId = await connectionManager.saveConnection(testEnv.mockContext, {
                label: "Empty Password Connection",
                serverName: "testbench.example.com",
                portNumber: 9443,
                username: "test-user",
                password: ""
            });
            const storeSecret = testEnv.mockContext.secrets.store as sinon.SinonStub;
            const deleteSecret = testEnv.mockContext.secrets.delete as sinon.SinonStub;

            assert.ok(connectionId, "Connection ID should be returned");
            assert.ok(
                storeSecret.calledWith(StorageKeys.CONNECTION_PASSWORD_SECRET_PREFIX + connectionId, ""),
                "Empty password should be persisted as a valid password value"
            );
            assert.strictEqual(deleteSecret.called, false, "Empty password should not delete the stored password");
        });
    });
});
