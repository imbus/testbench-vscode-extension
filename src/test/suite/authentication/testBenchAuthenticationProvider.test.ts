/**
 * @file src/test/suite/authentication/testBenchAuthenticationProvider.test.ts
 * @description This file contains unit tests for the TestBenchAuthenticationProvider class.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import * as connectionManager from "../../../connectionManager";
import { StorageKeys } from "../../../constants";
import { setLogger } from "../../../extension";
import { TestBenchAuthenticationProvider } from "../../../testBenchAuthenticationProvider";
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

        test("should not persist password fields in global state", async () => {
            (testEnv.mockContext.globalState.get as sinon.SinonStub)
                .withArgs(StorageKeys.CONNECTIONS_STORAGE_KEY, [])
                .returns([
                    {
                        id: "existing-connection",
                        label: "Existing Connection",
                        serverName: "existing.example.com",
                        portNumber: 9443,
                        username: "existing-user",
                        password: "previously-leaked-secret",
                        keepExistingPassword: true
                    }
                ]);

            await connectionManager.saveConnection(testEnv.mockContext, {
                label: "Secret Connection",
                serverName: "testbench.example.com",
                portNumber: 9443,
                username: "test-user",
                password: "secret"
            });

            const updateGlobalState = testEnv.mockContext.globalState.update as sinon.SinonStub;
            const persistedConnections = updateGlobalState.firstCall.args[1];

            assert.strictEqual(persistedConnections.length, 2, "Existing and new connections should be persisted");
            for (const persistedConnection of persistedConnections) {
                assert.strictEqual(
                    Object.prototype.hasOwnProperty.call(persistedConnection, "password"),
                    false,
                    "Password should not be persisted in globalState"
                );
                assert.strictEqual(
                    Object.prototype.hasOwnProperty.call(persistedConnection, "keepExistingPassword"),
                    false,
                    "Password control flag should not be persisted in globalState"
                );
            }
        });

        test("should use stored empty password without prompting", async () => {
            const provider = new TestBenchAuthenticationProvider(testEnv.mockContext, "test-instance");
            const getPasswordStub = testEnv.sandbox.stub(connectionManager, "getPasswordForConnection").resolves("");

            const result = await (provider as any).resolvePasswordForConnection(
                {
                    id: "conn-1",
                    label: "Empty Password Connection",
                    serverName: "testbench.example.com",
                    portNumber: 9443,
                    username: "test-user"
                },
                undefined,
                true
            );

            assert.strictEqual(result.password, "", "Stored empty password should be reused as-is");
            assert.strictEqual(result.wasManuallyProvided, false, "Stored password should not be treated as manual");
            assert.strictEqual(result.hadStoredPassword, true, "Stored empty password should count as existing");
            assert.strictEqual(getPasswordStub.calledOnce, true, "Password lookup should happen exactly once");
        });
    });
});
