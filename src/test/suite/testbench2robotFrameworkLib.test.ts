import * as path from 'path';
import * as sinon from 'sinon';
import * as assert from 'assert';
import * as vscode from 'vscode'
import { tb2robotLib} from '../../testbench2robotframeworkLib';
import { pyCommandBuilder } from '../../pyCommandBuilder';

const rootPath = path.resolve(__dirname, '../../../')

suite('tb2robotWrite unit test', () => {
    let context: vscode.ExtensionContext;
    let execStub: sinon.SinonStub;
    let buildTb2RobotCommandStub: sinon.SinonStub;

    setup(() => {
        execStub = sinon.stub(require('child_process'), 'exec');
        buildTb2RobotCommandStub = sinon.stub(pyCommandBuilder, 'buildTb2RobotCommand');
    });

    teardown(() => {
        sinon.restore();
    });

    test('should execute the correct command without optional parameters', async () => {
        execStub.yields(null, 'Success');
        buildTb2RobotCommandStub.resolves('commandBase');

        await tb2robotLib.tb2robotWrite(context, 'workingDirectory', 'reportPath');

        assert.ok(execStub.calledOnce, 'exec should be called once');
        assert.strictEqual(
            execStub.firstCall.args[0],
            'commandBase write reportPath',
            'The command should match the expected command string'
        );
    });

    test('should execute the correct command with configJSONPath', async () => {
        execStub.yields(null, 'Success');
        buildTb2RobotCommandStub.resolves('commandBase');

        await tb2robotLib.tb2robotWrite(context, 'workingDirectory', 'reportPath', 'configJSONPath');

        assert.ok(execStub.calledOnce, 'exec should be called once');
        assert.strictEqual(
            execStub.firstCall.args[0],
            'commandBase write -c configJSONPath reportPath',
            'The command should include the configJSONPath when provided'
        );
    });

    test('should reject with stderr if exec returns an error', async () => {
        execStub.yields(new Error('Execution failed'), '', 'stderr');

        try {
            await tb2robotLib.tb2robotWrite(context, 'workingDirectory', 'reportPath');
            assert.fail('Expected function to throw');
        } catch (error) {
            assert.strictEqual(error, 'stderr', 'The error message should match');
        }
    });

    test('should reject with stdout if exec returns an error', async () => {
        execStub.yields(new Error('Execution failed'), 'stdout', '');

        try {
            await tb2robotLib.tb2robotWrite(context, 'workingDirectory', 'reportPath');
            assert.fail('Expected function to throw');
        } catch (error) {
            assert.strictEqual(error, 'stdout', 'The error message should match');
        }
    });

    test('should reject with default if exec returns an error', async () => {
        execStub.yields(new Error('Execution failed'), '', '');

        try {
            await tb2robotLib.tb2robotWrite(context, 'workingDirectory', 'reportPath');
            assert.fail('Expected function to throw');
        } catch (error) {
            assert.strictEqual(error, 'An unknown Error occurred.', 'The error message should match');
        }
    });
});

suite('robotGenerateXMLResults unit test', () => {
    let execStub: sinon.SinonStub;
    let buildRobotCommandStub: sinon.SinonStub;

    setup(() => {
        execStub = sinon.stub(require('child_process'), 'exec');
        buildRobotCommandStub = sinon.stub(pyCommandBuilder, 'buildRobotCommand');
    });

    teardown(() => {
        sinon.restore();
    });

    test('should execute the correct command', async () => {
        execStub.yields(null, 'Success');
        buildRobotCommandStub.resolves('commandBase');

        await tb2robotLib.robotGenerateXMLResults('workingDirectory', 'outputResultDir', 'robotFilesPath');

        assert.ok(execStub.calledOnce, 'exec should be called once');
        assert.strictEqual(
            execStub.firstCall.args[0],
            'commandBase -d outputResultDir --dryrun robotFilesPath',
            'The command should match the expected command string'
        );
    });

    test('should reject with stderr if exec returns an error', async () => {
        execStub.yields(new Error('Execution failed'), '', 'stderr');

        try {
            await tb2robotLib.robotGenerateXMLResults('workingDirectory', 'outputResultDir', 'robotFilesPath');
            assert.fail('Expected function to throw');
        } catch (error) {
            assert.strictEqual(error, 'stderr', 'The error message should match');
        }
    });

    test('should reject with stdout if exec returns an error', async () => {
        execStub.yields(new Error('Execution failed'), 'stdout', '');

        try {
            await tb2robotLib.robotGenerateXMLResults('workingDirectory', 'outputResultDir', 'robotFilesPath');
            assert.fail('Expected function to throw');
        } catch (error) {
            assert.strictEqual(error, 'stdout', 'The error message should match');
        }
    });

    test('should reject with default if exec returns an error', async () => {
        execStub.yields(new Error('Execution failed'), '', '');

        try {
            await tb2robotLib.robotGenerateXMLResults('workingDirectory', 'outputResultDir', 'robotFilesPath');
            assert.fail('Expected function to throw');
        } catch (error) {
            assert.strictEqual(error, 'An unknown Error occurred.', 'The error message should match');
        }
    });
});

suite('tb2robotRead unit test', () => {
    let context: vscode.ExtensionContext;
    let execStub: sinon.SinonStub;
    let buildTb2RobotCommandStub: sinon.SinonStub;

    setup(() => {
        execStub = sinon.stub(require('child_process'), 'exec');
        buildTb2RobotCommandStub = sinon.stub(pyCommandBuilder, 'buildTb2RobotCommand');
    });

    teardown(() => {
        sinon.restore();
    });

    test('should execute the correct command without optional parameters', async () => {
        execStub.yields(null, 'Success');
        buildTb2RobotCommandStub.resolves('commandBase');

        await tb2robotLib.tb2robotRead(context, 'workingDirectory', 'outputXmlPath', 'reportWithoutResultsPath');

        assert.ok(execStub.calledOnce, 'exec should be called once');
        assert.strictEqual(
            execStub.firstCall.args[0],
            'commandBase read -o outputXmlPath reportWithoutResultsPath',
            'The command should match the expected command string'
        );
    });

    test('should execute the correct command with resultPath', async () => {
        execStub.yields(null, 'Success');
        buildTb2RobotCommandStub.resolves('commandBase');

        await tb2robotLib.tb2robotRead(context, 'workingDirectory', 'outputXmlPath', 'reportWithoutResultsPath', 'resultPath');

        assert.ok(execStub.calledOnce, 'exec should be called once');
        assert.strictEqual(
            execStub.firstCall.args[0],
            'commandBase read -o outputXmlPath -r resultPath reportWithoutResultsPath',
            'The command should include the resultPath when provided'
        );
    });

    test('should execute the correct command with configJSONPath', async () => {
        execStub.yields(null, 'Success');
        buildTb2RobotCommandStub.resolves('commandBase');

        await tb2robotLib.tb2robotRead(
            context,
            'workingDirectory',
            'outputXmlPath',
            'reportWithoutResultsPath',
            'resultPath',
            'configJSONPath'
        );

        assert.ok(execStub.calledOnce, 'exec should be called once');
        assert.strictEqual(
            execStub.firstCall.args[0],
            'commandBase read -c configJSONPath -o outputXmlPath -r resultPath reportWithoutResultsPath',
            'The command should include the configJSONPath when provided'
        );
    });

    test('should reject with stderr if exec returns an error', async () => {
        execStub.yields(new Error('Execution failed'), '', 'stderr');

        try {
            await tb2robotLib.tb2robotRead(context, 'workingDirectory', 'outputXmlPath', 'reportWithoutResultsPath');
            assert.fail('Expected function to throw');
        } catch (error) {
            assert.strictEqual(error, 'stderr', 'The error message should match');
        }
    });

    test('should reject with stdout if exec returns an error', async () => {
        execStub.yields(new Error('Execution failed'), 'stdout', '');

        try {
            await tb2robotLib.tb2robotRead(context, 'workingDirectory', 'outputXmlPath', 'reportWithoutResultsPath');
            assert.fail('Expected function to throw');
        } catch (error) {
            assert.strictEqual(error, 'stdout', 'The error message should match');
        }
    });

    test('should reject with default if exec returns an error', async () => {
        execStub.yields(new Error('Execution failed'), '', '');

        try {
            await tb2robotLib.tb2robotRead(context, 'workingDirectory', 'outputXmlPath', 'reportWithoutResultsPath');
            assert.fail('Expected function to throw');
        } catch (error) {
            assert.strictEqual(error, 'An unknown Error occurred.', 'The error message should match');
        }
    });
});

suite('startTb2robotWrite unit test', () => {
    let context: vscode.ExtensionContext;
    let tb2robotWriteStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;
    let consoleErrorStub: sinon.SinonStub;

    setup(() => {
        tb2robotWriteStub = sinon.stub(tb2robotLib, 'tb2robotWrite');
        showErrorMessageStub = sinon.stub(vscode.window, 'showErrorMessage');
        consoleLogStub = sinon.stub(console, 'log');
        consoleErrorStub = sinon.stub(console, 'error');
    });

    teardown(() => {
        sinon.restore();
    });

    test('should return true and log correct message when tb2robotWrite resolves without config', async () => {
        tb2robotWriteStub.resolves();
        const result = await tb2robotLib.startTb2robotWrite(context, 'workingDirectory', 'reportPath');
        assert.ok(tb2robotWriteStub.called);

        assert.strictEqual(true, result, 'Expected the function to return true on success');
        //assert.ok(consoleLogStub.calledOnce, 'Expected console.log to be called once');
        /*assert.strictEqual(
            consoleLogStub.firstCall.args[0],
            'tb2robot write-generation completed using reportPath, no config file provided.',
            'Expected log message to include "write-generation completed"'
        );*/
    });

    test('should return true and log correct message when tb2robotWrite resolves with config', async () => {
        tb2robotWriteStub.resolves();

        const result = await tb2robotLib.startTb2robotWrite(context, 'workingDirectory', 'reportPath', 'configJSONPath');
        assert.ok(tb2robotWriteStub.called);

        assert.strictEqual(true, result, 'Expected the function to return true on success');
        //assert.ok(consoleLogStub.calledOnce, 'Expected console.log to be called once');
        /*assert.strictEqual(
            consoleLogStub.firstCall.args[0],
            'tb2robot write-generation completed using reportPath, configJSONPath config file provided.',
            'Expected log message to include "write-generation completed"'
        );*/
    });

    test('should return false and show error message when tb2robotWrite rejects', async () => {
        const errorMessage = 'An error occurred';
        tb2robotWriteStub.rejects(new Error(errorMessage));

        const result = await tb2robotLib.startTb2robotWrite(context, 'workingDirectory', 'reportPath');
        assert.ok(tb2robotWriteStub.called);

        assert.strictEqual(false, result, 'Expected the function to return false on failure');
        //assert.ok(consoleErrorStub.calledOnce, 'Expected console.error to be called once');
        /*assert.strictEqual(
            consoleErrorStub.firstCall.args[1],
            errorMessage,
            'Expected error log to match the simulated error'
        );*/
        assert.ok(showErrorMessageStub.calledOnce, 'Expected showErrorMessage to be called once');
        assert.strictEqual(
            showErrorMessageStub.firstCall.args[0],
            `testbench2robotframework Error: ${errorMessage}`,
            'Expected error message to match the simulated error'
        );
    });
});

suite('startRobotGenerateXMLResults unit test', () => {
    let robotGenerateXMLResultsStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;
    let consoleErrorStub: sinon.SinonStub;

    setup(() => {
        robotGenerateXMLResultsStub = sinon.stub(tb2robotLib, 'robotGenerateXMLResults');
        showErrorMessageStub = sinon.stub(vscode.window, 'showErrorMessage');
        consoleLogStub = sinon.stub(console, 'log');
        consoleErrorStub = sinon.stub(console, 'error');
    });

    teardown(() => {
        sinon.restore();
    });

    test('should return true and log correct message', async () => {
        robotGenerateXMLResultsStub.resolves();
        const result = await tb2robotLib.startRobotGenerateXMLResults('workingDirectory', 'outputResultDir', 'reportPath');
        assert.ok(robotGenerateXMLResultsStub.called);

        assert.strictEqual(true, result, 'Expected the function to return true on success');
        //assert.ok(consoleLogStub.calledOnce, 'Expected console.log to be called once');
        /*assert.strictEqual(
            consoleLogStub.firstCall.args[0],
            'tb2robot write-generation completed using reportPath, no config file provided.',
            'Expected log message to include "write-generation completed"'
        );*/
    });

    test('should return false and show error message when robotGenerateXMLResults rejects', async () => {
        const errorMessage = 'An error occurred';
        robotGenerateXMLResultsStub.rejects(new Error(errorMessage));

        const result = await tb2robotLib.startRobotGenerateXMLResults('workingDirectory', 'outputResultDir', 'reportPath');
        assert.ok(robotGenerateXMLResultsStub.called);

        assert.strictEqual(false, result, 'Expected the function to return false on failure');
        //assert.ok(consoleErrorStub.calledOnce, 'Expected console.error to be called once');
        /*assert.strictEqual(
            consoleErrorStub.firstCall.args[1],
            errorMessage,
            'Expected error log to match the simulated error'
        );*/
        assert.ok(showErrorMessageStub.calledOnce, 'Expected showErrorMessage to be called once');
        assert.strictEqual(
            showErrorMessageStub.firstCall.args[0],
            `Robot Framework Error: ${errorMessage}`,
            'Expected error message to match the simulated error'
        );
    });
});

suite('startTb2robotRead unit test', () => {
    let context: vscode.ExtensionContext;
    let tb2robotReadStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;
    let consoleErrorStub: sinon.SinonStub;
    let sandbox: sinon.SinonSandbox;

    setup(async () => {
        tb2robotReadStub = sinon.stub(tb2robotLib, 'tb2robotRead');
        showErrorMessageStub = sinon.stub(vscode.window, 'showErrorMessage');
        consoleLogStub = sinon.stub(global.console, 'log');
        consoleErrorStub = sinon.stub(global.console, 'error');
        sandbox = sinon.createSandbox();
    });

    teardown(async () => {
        sinon.restore();
    });

    test('should return true and log correct message with all optional arguments', async () => {
        const spy = sinon.spy(console, 'log');
        tb2robotReadStub.resolves();
        const result = await tb2robotLib.startTb2robotRead(context, 'workingDirectory', 'outputXmlPath', 'reportPath', 'resultPath', 'configJSONPath');
        assert.ok(tb2robotReadStub.called);

        assert.strictEqual(true, result, 'Expected the function to return true on success');
        assert.ok(spy.calledOnce, 'Expected console.log to be called once');
        /*assert.strictEqual(
            consoleLogStub.firstCall.args[0],
            'tb2robot write-generation completed using reportPath, no config file provided.',
            'Expected log message to include "write-generation completed"'
        );*/
    });

    test('should return true and log correct message with no optional arguments', async () => {
        tb2robotReadStub.resolves();
        const result = await tb2robotLib.startTb2robotRead(context, 'workingDirectory', 'outputXmlPath', 'reportPath');
        assert.ok(tb2robotReadStub.called);

        assert.strictEqual(true, result, 'Expected the function to return true on success');
        //assert.ok(consoleLogStub.calledOnce, 'Expected console.log to be called once');
        /*assert.strictEqual(
            consoleLogStub.firstCall.args[0],
            'tb2robot write-generation completed using reportPath, no config file provided.',
            'Expected log message to include "write-generation completed"'
        );*/
    });

    test('should return false and show error message when tb2robotRead rejects', async () => {
        const errorMessage = 'An error occurred';
        tb2robotReadStub.rejects(new Error(errorMessage));

        const result = await tb2robotLib.startTb2robotRead(context, 'workingDirectory', 'outputXmlPath', 'reportPath');
        assert.ok(tb2robotReadStub.called);

        assert.strictEqual(false, result, 'Expected the function to return false on failure');
        //assert.ok(consoleErrorStub.calledOnce, 'Expected console.error to be called once');
        /*assert.strictEqual(
            consoleErrorStub.firstCall.args[1],
            errorMessage,
            'Expected error log to match the simulated error'
        );*/
        assert.ok(showErrorMessageStub.calledOnce, 'Expected showErrorMessage to be called once');
        assert.strictEqual(
            showErrorMessageStub.firstCall.args[0],
            `testbench2robotframework Error: ${errorMessage}`,
            'Expected error message to match the simulated error'
        );
    });
});
