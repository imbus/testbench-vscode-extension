import * as assert from 'assert';
import * as vscode from 'vscode';
import { PlayServerConnection } from '../../testBenchConnection';
import * as sinon from 'sinon';
import axios from 'axios';

suite('TestBenchConnection Test Suite', () => {

    suiteTeardown(() => {
        vscode.window.showInformationMessage('All tests done!');
      });

    let connection: PlayServerConnection;
    let context: vscode.ExtensionContext;

    setup(() => {
        context = {
            secrets: {
                delete: async () => {},
                get: async () => undefined,
                store: async () => {},
            },
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;
        connection = new PlayServerConnection(context, 'testserver', 9445, 'session-token');
    });

    teardown(() => {
        sinon.restore();
    });

    test('should initialize with the correct values', () => {
        assert.strictEqual(connection.getBaseURL(), 'https://testserver:9445/api');
        assert.strictEqual(connection.getSessionToken(), 'session-token');
    });

    /*
    test('should login successfully', async () => {
        const response = { data: { sessionToken: 'new-token' }, status: 201 };
        sinon.stub(axios, 'post').resolves(response);

        const loginResponse = await connection.login();
        assert.strictEqual(loginResponse.sessionToken, 'new-token');
    });

    test('should handle login failure', async () => {
        sinon.stub(axios, 'post').rejects(new Error('Login failed'));

        try {
            await connection.login();
            assert.fail('Expected an error');
        } catch (error: any) {
            assert.strictEqual(error.message, 'Login failed');
        }
    });

    test('should send keep-alive request', async () => {
        sinon.stub(axios, 'get').resolves({ status: 200 });

        await connection.sendKeepAliveRequest();
        assert.ok(true); // No error means the test passed
    });

    test('should handle keep-alive failure', async () => {
        sinon.stub(axios, 'get').rejects(new Error('Keep-alive failed'));

        await connection.sendKeepAliveRequest();
        assert.ok(true); // No error means the test passed, failure is logged
    });

    test('should logout successfully', async () => {
        const deleteStub = sinon.stub(axios, 'delete').resolves({ status: 204 });

        await connection.logout();
        assert.ok(deleteStub.calledOnce);
    });

    test('should handle logout failure', async () => {
        sinon.stub(axios, 'delete').rejects(new Error('Logout failed'));

        await connection.logout();
        assert.ok(true); // No error means the test passed, failure is logged
    });
    */
});
