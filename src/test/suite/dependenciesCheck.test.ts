import * as sinon from 'sinon';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as extension from '../../extension';
import { dependenciesCheck } from '../../dependenciesCheck';
import { TestBenchLogger } from "../../testBenchLogger";

const proxyquire = require('proxyquire');

/*
suite('checkVSCodeVersion test', () => {
    let showErrorMessageStub: sinon.SinonStub;
    let getLoggerStub: sinon.SinonStub;
    let loggerStub: sinon.SinonStubbedInstance<TestBenchLogger>;

    setup(() => {
        showErrorMessageStub = sinon.stub(vscode.window, 'showErrorMessage');
    });

    teardown(() => {
        sinon.restore();
    });

    test('Should return true on version above 1.86', async () => {
        const result = await dependenciesCheck.isVSCodeVersionValid('1.88.6');
        assert.strictEqual(result, true, 'Expected checkVSCodeVersion to return true on version above 1.86');
        assert.strictEqual(showErrorMessageStub.called, false, 'Expected no error to be displayed');
        assert.ok(loggerStub.info.called, 'Expected loggerStub.info to be called');
    });

    test('Should return true on version equal 1.86', async () => {
        const result = await dependenciesCheck.isVSCodeVersionValid('1.86.0');
        assert.strictEqual(result, true, 'Expected checkVSCodeVersion to return true on version equal 1.86');
        assert.strictEqual(showErrorMessageStub.called, false, 'Expected no error to be displayed');
        assert.ok(loggerStub.info.called, 'Expected loggerStub.info to be called');
    });

    test('Should return false on version below 1.86', async () => {
        const result = await dependenciesCheck.isVSCodeVersionValid('1.79.88');
        assert.strictEqual(result, false, 'Expected checkVSCodeVersion to return false on version below 1.86');
        assert.strictEqual(showErrorMessageStub.called, true, 'Expected one error to be displayed');
        assert.ok(loggerStub.error.called, 'Expected loggerStub.error to be called');
    });
});

suite('checkPythonExtension test', () => {
    let showErrorMessageStub: sinon.SinonStub;
    let getLoggerStub: sinon.SinonStub;
    let loggerStub: sinon.SinonStubbedInstance<TestBenchLogger>;

    setup(() => {
        showErrorMessageStub = sinon.stub(vscode.window, 'showErrorMessage');
    });

    teardown(() => {
        sinon.restore();
    });

    test('Should return true if installed', async () => {
        const result = await dependenciesCheck.isPythonExtensionInstalled(vscode.extensions.getExtension('ms-python.python'));
        assert.strictEqual(result, true, 'Expected checkPythonExtension to return true with extension found');
        assert.strictEqual(showErrorMessageStub.called, false, 'Expected no error to be displayed');
        assert.ok(loggerStub.info.called, 'Expected loggerStub.info to be called');
    });

    test('Should return false if not installed', async () => {
        const result = await dependenciesCheck.isPythonExtensionInstalled(vscode.extensions.getExtension('This extension does to 100% not exist.'));
        assert.strictEqual(result, false, 'Expected checkPythonExtension to return false with no extension found');
        assert.strictEqual(showErrorMessageStub.called, true, 'Expected one error to be displayed');
        assert.ok(loggerStub.error.called, 'Expected loggerStub.error to be called');
    });
});

suite('checkRobotFramework test', () => {
    let execStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let getLoggerStub: sinon.SinonStub;
    let loggerStub: sinon.SinonStubbedInstance<TestBenchLogger>;

    setup(() => {
        execStub = sinon.stub(require('child_process'), 'exec');
        showErrorMessageStub = sinon.stub(vscode.window, 'showErrorMessage');
    });

    teardown(() => {
        sinon.restore();
    });

    test('Should return true on stdout', async () => {
        execStub.yields(null, 'Name: robotframework\nVersion: 4.0.1', '');

        const result = await dependenciesCheck.isRobotFrameworkInstalled();
        assert.ok(execStub.calledOnce, 'Expected stub to be called once')
        assert.strictEqual(result, true, 'Expected checkRobotFramework to return true on stdout');
        assert.strictEqual(showErrorMessageStub.called, false, 'Expected no error to be displayed');
        assert.ok(loggerStub.info.called, 'Expected loggerStub.info to be called');
    });

    test('Should return false on stderr', async () => {
        execStub.yields(null, '', 'stderr');

        const result = await dependenciesCheck.isRobotFrameworkInstalled();
        assert.ok(execStub.calledOnce, 'Expected stub to be called once')
        assert.strictEqual(result, false, 'Expected checkRobotFramework to return false on stderr');
        assert.strictEqual(showErrorMessageStub.calledOnce, true, 'Expected one error to be displayed');
        assert.ok(loggerStub.error.called, 'Expected loggerStub.error to be called');
    });

    test('Should return false on error', async () => {
        execStub.yields(new Error('Error'), '', '');

        const result = await dependenciesCheck.isRobotFrameworkInstalled();
        assert.ok(execStub.calledOnce, 'Expected stub to be called once')
        assert.strictEqual(result, false, 'Expected checkRobotFramework to return false on error');
        assert.strictEqual(showErrorMessageStub.calledOnce, true, 'Expected one error to be displayed');
        assert.ok(loggerStub.error.called, 'Expected loggerStub.error to be called');
    });
});

suite('checkPythonVersion tests', () => {
    let execStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub
    let depPrQr: any;
    let getLoggerStub: sinon.SinonStub;
    let loggerStub: sinon.SinonStubbedInstance<TestBenchLogger>;

    setup(() => {
        execStub = sinon.stub();
        showErrorMessageStub = sinon.stub(vscode.window, 'showErrorMessage');
        
        depPrQr = proxyquire('../../dependenciesCheck', {
            'child_process': { exec: execStub }
        });
    });

    teardown(() => {
        sinon.restore();
    });

    test('Should return true on stdout and version above 3.8', async () => {
        execStub.callsFake((cmd, callback) => {
            callback(null, '3.11.8', '');
        });

        const result = await depPrQr.dependenciesCheck.checkPythonVersion();
        assert.strictEqual(result, true, 'Expected checkPythonVersion to return true on version above 3.8');
        assert.strictEqual(showErrorMessageStub.called, false, 'Expected no error to be displayed');
        assert.ok(loggerStub.info.called, 'Expected loggerStub.info to be called');
    });

    test('Should return true on stdout and version equal to 3.8', async () => {
        execStub.callsFake((cmd, callback) => {
            callback(null, '3.8.0', '');
        });

        const result = await depPrQr.dependenciesCheck.checkPythonVersion();
        assert.strictEqual(result, true, 'Expected checkPythonVersion to return true on version equal 3.8');
        assert.strictEqual(showErrorMessageStub.called, false, 'Expected no error to be displayed');
        assert.ok(loggerStub.info.called, 'Expected loggerStub.info to be called');
    });

    test('Should return false on stdout and version below 3.8', async () => {
        execStub.callsFake((cmd, callback) => {
            callback(null, '3.6.9', '');
        });

        const result = await depPrQr.dependenciesCheck.checkPythonVersion();
        assert.strictEqual(result, false, 'Expected checkPythonVersion to return false on version below 3.8');
        assert.strictEqual(showErrorMessageStub.called, true, 'Expected one error to be displayed');
        assert.ok(loggerStub.error.called, 'Expected loggerStub.error to be called');
    });

    test('Should return false on stderr', async () => {
        execStub.callsFake((cmd, callback) => {
            callback(null, '', 'Stderr');
        });

        const result = await depPrQr.dependenciesCheck.checkPythonVersion();
        assert.strictEqual(result, false, 'Expected checkPythonVersion to return false on stderr');
        assert.strictEqual(showErrorMessageStub.called, true, 'Expected one error to be displayed');
        assert.ok(loggerStub.error.called, 'Expected loggerStub.error to be called');
    });

    test('Should return false on error', async () => {
        execStub.callsFake((cmd, callback) => {
            callback(new Error('Error'), '', '');
        });

        const result = await depPrQr.dependenciesCheck.checkPythonVersion();
        assert.strictEqual(result, false, 'Expected checkPythonVersion to return false on error');
        assert.strictEqual(showErrorMessageStub.called, true, 'Expected one error to be displayed');
        assert.ok(loggerStub.error.called, 'Expected loggerStub.error to be called');
    });
})

suite('checkDependencies tests', () => {
    let checkVSCodeVersionStub: sinon.SinonStub;
    let checkPythonExtensionStub: sinon.SinonStub;
    let checkPythonVersionStub: sinon.SinonStub;
    let checkRobotFrameworkStub: sinon.SinonStub;

    setup(() => {
        checkVSCodeVersionStub = sinon.stub(dependenciesCheck, 'checkVSCodeVersion');
        checkPythonExtensionStub = sinon.stub(dependenciesCheck, 'checkPythonExtension');
        checkPythonVersionStub = sinon.stub(dependenciesCheck, 'checkPythonVersion');
        checkRobotFrameworkStub = sinon.stub(dependenciesCheck, 'checkRobotFramework');
    });

    teardown(() => {
        sinon.restore();
    });

    test('Should resturn true when all pass', async () => {
        checkVSCodeVersionStub.returns(true);
        checkPythonExtensionStub.returns(true);
        checkPythonVersionStub.resolves(true);
        checkRobotFrameworkStub.resolves(true);

        let result = await dependenciesCheck.verifyRequiredDependencies();
        assert.ok(checkVSCodeVersionStub.calledOnce, 'Expected stub to be called once');

        assert.strictEqual(result, true, 'Expected checkDependencies to return true on all pass');
    });

    test('Should resturn true when all fail', async () => {
        checkVSCodeVersionStub.returns(false);
        checkPythonExtensionStub.returns(false);
        checkPythonVersionStub.resolves(false);
        checkRobotFrameworkStub.resolves(false);

        let result = await dependenciesCheck.verifyRequiredDependencies();
        assert.ok(checkVSCodeVersionStub.calledOnce, 'Expected stub to be called once');

        assert.strictEqual(result, false, 'Expected checkDependencies to return false on all fail');
    });

    test('Should resturn true when checkVSCodeVersion fails', async () => {
        checkVSCodeVersionStub.returns(false);
        checkPythonExtensionStub.returns(true);
        checkPythonVersionStub.resolves(true);
        checkRobotFrameworkStub.resolves(true);

        let result = await dependenciesCheck.verifyRequiredDependencies();
        assert.ok(checkVSCodeVersionStub.calledOnce, 'Expected stub to be called once');

        assert.strictEqual(result, false, 'Expected checkDependencies to return false on checkVSCodeVersion fail');
    });

    test('Should resturn true when checkPythonExtension fails', async () => {
        checkVSCodeVersionStub.returns(true);
        checkPythonExtensionStub.returns(false);
        checkPythonVersionStub.resolves(true);
        checkRobotFrameworkStub.resolves(true);

        let result = await dependenciesCheck.verifyRequiredDependencies();
        assert.ok(checkVSCodeVersionStub.calledOnce, 'Expected stub to be called once');

        assert.strictEqual(result, false, 'Expected checkDependencies to return false on checkPythonExtension fail');
    });

    test('Should resturn true when checkPythonVersion fails', async () => {
        checkVSCodeVersionStub.returns(true);
        checkPythonExtensionStub.returns(true);
        checkPythonVersionStub.resolves(false);
        checkRobotFrameworkStub.resolves(true);

        let result = await dependenciesCheck.verifyRequiredDependencies();
        assert.ok(checkVSCodeVersionStub.calledOnce, 'Expected stub to be called once');

        assert.strictEqual(result, false, 'Expected checkDependencies to return false on checkPythonVersion fail');
    });

    test('Should resturn true when checkRobotFramework fails', async () => {
        checkVSCodeVersionStub.returns(true);
        checkPythonExtensionStub.returns(true);
        checkPythonVersionStub.resolves(true);
        checkRobotFrameworkStub.resolves(false);

        let result = await dependenciesCheck.verifyRequiredDependencies();
        assert.ok(checkVSCodeVersionStub.calledOnce, 'Expected stub to be called once');

        assert.strictEqual(result, false, 'Expected checkDependencies to return false on checkRobotFramework fail');
    });
});
*/