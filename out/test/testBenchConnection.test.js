"use strict";
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const testBenchConnection_1 = require("../testBenchConnection"); // Adjust the path as needed
const sinon = __importStar(require("sinon"));
suite('TestBenchConnection Test Suite', () => {
    let connection;
    let context;
    setup(() => {
        context = {
            secrets: {
                delete: async () => { },
                get: async () => undefined,
                store: async () => { },
            },
            subscriptions: [],
        };
        connection = new testBenchConnection_1.PlayServerConnection(context, 'testserver', 9445, 'session-token');
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
//# sourceMappingURL=testBenchConnection.test.js.map