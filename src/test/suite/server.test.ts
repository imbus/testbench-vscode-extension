import * as testBenchConnection from "../../testBenchConnection";
import * as python from "../../python";
import { setLogger, setConnection } from "../../extension";
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";

const MOCK_SERVER_NAME = "mock-language-server-host";
const MOCK_SERVER_PORT = "12345";
const MOCK_USERNAME = "mock-ls-user";
const MOCK_SESSION_TOKEN = "mock-ls-session-token";
const MOCK_PYTHON_INTERPRETER_PATH = "/mock/python";

suite("Language Server Management", function () {
    let testEnv: TestEnvironment;

    this.beforeEach(() => {
        testEnv = setupTestEnvironment();

        const mockLogger = {
            info: testEnv.sandbox.stub(),
            error: testEnv.sandbox.stub(),
            warn: testEnv.sandbox.stub(),
            debug: testEnv.sandbox.stub(),
            trace: testEnv.sandbox.stub()
        } as any;

        setLogger(mockLogger);

        const mockConnection = testEnv.sandbox.createStubInstance(testBenchConnection.PlayServerConnection);
        mockConnection.getServerName.returns(MOCK_SERVER_NAME);
        mockConnection.getServerPort.returns(MOCK_SERVER_PORT);
        mockConnection.getUsername.returns(MOCK_USERNAME);
        mockConnection.getSessionToken.returns(MOCK_SESSION_TOKEN);
        setConnection(mockConnection as any);

        testEnv.sandbox.stub(python, "getInterpreterPath").resolves(MOCK_PYTHON_INTERPRETER_PATH);
    });

    this.afterEach(() => {
        testEnv.sandbox.restore();
    });
});
