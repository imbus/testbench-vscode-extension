import * as testBenchConnection from "../../testBenchConnection";
import * as python from "../../python";
import { setLogger, setConnection } from "../../extension";
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";

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
        mockConnection.getServerName.returns("test-server");
        mockConnection.getServerPort.returns("8080");
        mockConnection.getUsername.returns("testuser");
        mockConnection.getSessionToken.returns("test-token");
        setConnection(mockConnection as any);

        testEnv.sandbox.stub(python, "getInterpreterPath").resolves("/usr/bin/python3");
    });

    this.afterEach(() => {
        testEnv.sandbox.restore();
    });
});
