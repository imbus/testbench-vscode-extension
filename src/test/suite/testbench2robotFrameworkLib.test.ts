import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as assert from "assert";
import * as vscode from "vscode";
import { tb2robotLib } from "../../testbench2robotframeworkLib";
import * as commandBuilder from "../../pyCommandBuilder";
import { PythonExtension } from "@vscode/python-extension";
import { exec } from "child_process";
import { VSCodeCommandError } from "@vscode/test-electron";
import { info } from "console";

const mockPath = path.resolve(__dirname, "../src/test/mocks");

export async function sleep(timeout: number): Promise<number> {
    return new Promise<number>((resolve) => {
        setTimeout(() => resolve(timeout), timeout);
    });
}

suite("tb2robotWrite", async function () {
    let context: vscode.ExtensionContext;
    let execStub: sinon.SinonStub;
    let buildTb2RobotCommandStub: sinon.SinonStub;

    this.timeout(60000);

    setup(async () => {
        execStub = sinon.stub(require("child_process"), "exec");
        buildTb2RobotCommandStub = sinon.stub(commandBuilder, "buildTb2RobotCommand");

        let ext = vscode.extensions.getExtension("ms-python.python");
        if (ext) {
            console.log("Extension was installed");
            await ext.activate();
        }
    });

    teardown(() => {
        sinon.restore();
    });

    test("should execute the correct command without optional parameters", async () => {
        execStub.yields(null, "Success");
        buildTb2RobotCommandStub.resolves("commandBase");

        await tb2robotLib.tb2robotWrite(context, "workingDirectory", "reportPath");

        assert.ok(execStub.calledOnce, "exec should be called once");
        assert.strictEqual(
            execStub.firstCall.args[0],
            "commandBase write reportPath",
            "The command should match the expected command string"
        );
    });

    test("should execute the correct command with configJSONPath", async () => {
        execStub.yields(null, "Success");
        buildTb2RobotCommandStub.resolves("commandBase");

        await tb2robotLib.tb2robotWrite(context, "workingDirectory", "reportPath", "configJSONPath");

        assert.ok(execStub.calledOnce, "exec should be called once");
        assert.strictEqual(
            execStub.firstCall.args[0],
            "commandBase write -c configJSONPath reportPath",
            "The command should include the configJSONPath when provided"
        );
    });

    test("should reject with stderr if exec returns an error", async () => {
        execStub.yields(new Error("Execution failed"), "", "stderr");

        try {
            await tb2robotLib.tb2robotWrite(context, "workingDirectory", "reportPath");
            assert.fail("Expected function to throw");
        } catch (error) {
            assert.strictEqual(error, "stderr", "The error message should match");
        }
    });

    test("should reject with stdout if exec returns an error", async () => {
        execStub.yields(new Error("Execution failed"), "stdout", "");

        try {
            await tb2robotLib.tb2robotWrite(context, "workingDirectory", "reportPath");
            assert.fail("Expected function to throw");
        } catch (error) {
            assert.strictEqual(error, "stdout", "The error message should match");
        }
    });

    test("should reject with default if exec returns an error", async () => {
        execStub.yields(new Error("Execution failed"), "", "");

        try {
            await tb2robotLib.tb2robotWrite(context, "workingDirectory", "reportPath");
            assert.fail("Expected function to throw");
        } catch (error) {
            assert.strictEqual(error, "An unknown Error occurred.", "The error message should match");
        }
    });

    test("should generate correct JSON output, with result path", async () => {
        //assert.strictEqual('Installed extensions:', vscode.extensions.all.map(ext => ext.id));
        const pythonExtension = vscode.extensions.getExtension("ms-python.python");
        if (!pythonExtension) {
            assert.fail("Python extension is not installed or could not be found");
        }

        const pythonApi: PythonExtension = await PythonExtension.api();

        console.log("await python ext ready");
        await pythonApi.ready;

        //assert.ok(pythonApi, '1 not found')
        let environmentPath = pythonApi?.environments.getActiveEnvironmentPath();
        environmentPath = pythonApi?.environments.getActiveEnvironmentPath();
        //assert.ok(environmentPath, '2 not found')
        console.log("EnviromenrPath: " + environmentPath.path);
        const enviroment = await pythonApi?.environments.resolveEnvironment(environmentPath);
        assert.ok(enviroment, "3 not found");
        const pythonPath = enviroment?.executable.uri?.fsPath;
        if (pythonPath) {
            assert.match(pythonPath, /python\.exe/, "Did not find python.exe");
        } else {
            assert.fail("pythonPath was undefined");
        }
        const tb2robMain = path.join(process.cwd(), "bundled", "tools", "tb2robot", "__main__.py");
        const commandBase = `python -u ${tb2robMain}`;
        assert.strictEqual("this is fake", commandBase);
        /*const outputXmlPath = './src/test/mocks/expected/XMLOutput/output.xml';
        const reportPath = './src/test/mocks/expected/JSONRepWithoutRes';
        const resultPath = './src/test/mocks/results/JSONRepWithRes';

        let testpath =process.cwd();
        assert.strictEqual('path', testpath);

        await tb2r.tb2robotRead('comBase', 'workingDir', outputXmlPath, reportPath, resultPath, 'config.json');

        const generatedFilePath = path.join(resultPath, 'expected-output.json');
        const generatedData = JSON.parse(fs.readFileSync(generatedFilePath, 'utf-8'));

        const expectedFilePath = path.join(__dirname, 'expected-output.json');
        const expectedData = JSON.parse(fs.readFileSync(expectedFilePath, 'utf-8'));


        assert.deepStrictEqual(generatedData, expectedData);*/
    });
});

suite("robotGenerateXMLResults", () => {
    let execStub: sinon.SinonStub;
    let buildRobotCommandStub: sinon.SinonStub;

    setup(() => {
        execStub = sinon.stub(require("child_process"), "exec");
        buildRobotCommandStub = sinon.stub(commandBuilder, "buildRobotCommand");
    });

    teardown(() => {
        sinon.restore();
    });

    test("should execute the correct command", async () => {
        execStub.yields(null, "Success");
        buildRobotCommandStub.resolves("commandBase");

        await tb2robotLib.robotGenerateXMLResults("workingDirectory", "outputResultDir", "robotFilesPath");

        assert.ok(execStub.calledOnce, "exec should be called once");
        assert.strictEqual(
            execStub.firstCall.args[0],
            "commandBase -d outputResultDir --dryrun robotFilesPath",
            "The command should match the expected command string"
        );
    });

    test("should reject with stderr if exec returns an error", async () => {
        execStub.yields(new Error("Execution failed"), "", "stderr");

        try {
            await tb2robotLib.robotGenerateXMLResults("workingDirectory", "outputResultDir", "robotFilesPath");
            assert.fail("Expected function to throw");
        } catch (error) {
            assert.strictEqual(error, "stderr", "The error message should match");
        }
    });

    test("should reject with stdout if exec returns an error", async () => {
        execStub.yields(new Error("Execution failed"), "stdout", "");

        try {
            await tb2robotLib.robotGenerateXMLResults("workingDirectory", "outputResultDir", "robotFilesPath");
            assert.fail("Expected function to throw");
        } catch (error) {
            assert.strictEqual(error, "stdout", "The error message should match");
        }
    });

    test("should reject with default if exec returns an error", async () => {
        execStub.yields(new Error("Execution failed"), "", "");

        try {
            await tb2robotLib.robotGenerateXMLResults("workingDirectory", "outputResultDir", "robotFilesPath");
            assert.fail("Expected function to throw");
        } catch (error) {
            assert.strictEqual(error, "An unknown Error occurred.", "The error message should match");
        }
    });

    /*test('should generate correct JSON output, with result path', async () => {
        assert.strictEqual('Installed extensions:', vscode.extensions.all.map(ext => ext.id));
        const pythonExtension = vscode.extensions.getExtension('ms-python.python');
        if (!pythonExtension) {
            assert.fail('Python extension is not installed or could not be found');
        } else {
            if (!pythonExtension.isActive) {
                await pythonExtension.activate();
            }
        }
        
        const pythonApi: PythonExtension = await PythonExtension.api();
        const environmentPath = pythonApi?.environments.getActiveEnvironmentPath();
        const enviroment = await pythonApi?.environments.resolveEnvironment(environmentPath);
        const pythonPath = enviroment?.executable.uri?.fsPath;
        if (pythonPath) {
            assert.match(pythonPath, /python\.exe/, 'Did not find python.exe')
        }
        else {
            assert.fail('pythonPath was undefined')
        }
        const tb2robMain = path.join(process.cwd(), "bundled", "tools", "tb2robot", "__main__.py");
        const commandBase = `${pythonPath} -u ${tb2robMain}`
        assert.strictEqual('this is fake', commandBase);
        /*const outputXmlPath = './src/test/mocks/expected/XMLOutput/output.xml';
        const reportPath = './src/test/mocks/expected/JSONRepWithoutRes';
        const resultPath = './src/test/mocks/results/JSONRepWithRes';

        let testpath =process.cwd();
        assert.strictEqual('path', testpath);

        await tb2r.tb2robotRead('comBase', 'workingDir', outputXmlPath, reportPath, resultPath, 'config.json');

        const generatedFilePath = path.join(resultPath, 'expected-output.json');
        const generatedData = JSON.parse(fs.readFileSync(generatedFilePath, 'utf-8'));

        const expectedFilePath = path.join(__dirname, 'expected-output.json');
        const expectedData = JSON.parse(fs.readFileSync(expectedFilePath, 'utf-8'));


        assert.deepStrictEqual(generatedData, expectedData);
    });*/
});

suite("tb2robotRead", () => {
    let context: vscode.ExtensionContext;
    let execStub: sinon.SinonStub;
    let buildTb2RobotCommandStub: sinon.SinonStub;

    setup(() => {
        execStub = sinon.stub(require("child_process"), "exec");
        buildTb2RobotCommandStub = sinon.stub(commandBuilder, "buildTb2RobotCommand");
    });

    teardown(() => {
        sinon.restore();
    });

    test("should execute the correct command without optional parameters", async () => {
        execStub.yields(null, "Success");
        buildTb2RobotCommandStub.resolves("commandBase");

        await tb2robotLib.tb2robotRead(context, "workingDirectory", "outputXmlPath", "reportWithoutResultsPath");

        assert.ok(execStub.calledOnce, "exec should be called once");
        assert.strictEqual(
            execStub.firstCall.args[0],
            "commandBase read -o outputXmlPath -r reportWithoutResultsPath",
            "The command should match the expected command string"
        );
    });

    test("should execute the correct command with resultPath", async () => {
        execStub.yields(null, "Success");
        buildTb2RobotCommandStub.resolves("commandBase");

        await tb2robotLib.tb2robotRead(
            context,
            "workingDirectory",
            "outputXmlPath",
            "reportWithoutResultsPath",
            "resultPath"
        );

        assert.ok(execStub.calledOnce, "exec should be called once");
        assert.strictEqual(
            execStub.firstCall.args[0],
            "commandBase read -o outputXmlPath -r resultPath reportWithoutResultsPath",
            "The command should include the resultPath when provided"
        );
    });

    test("should execute the correct command with configJSONPath", async () => {
        execStub.yields(null, "Success");
        buildTb2RobotCommandStub.resolves("commandBase");

        await tb2robotLib.tb2robotRead(
            context,
            "workingDirectory",
            "outputXmlPath",
            "reportWithoutResultsPath",
            "resultPath",
            "configJSONPath"
        );

        assert.ok(execStub.calledOnce, "exec should be called once");
        assert.strictEqual(
            execStub.firstCall.args[0],
            "commandBase read -c configJSONPath -o outputXmlPath -r resultPath reportWithoutResultsPath",
            "The command should include the configJSONPath when provided"
        );
    });

    test("should reject with stderr if exec returns an error", async () => {
        execStub.yields(new Error("Execution failed"), "", "stderr");

        try {
            await tb2robotLib.tb2robotRead(context, "workingDirectory", "outputXmlPath", "reportWithoutResultsPath");
            assert.fail("Expected function to throw");
        } catch (error) {
            assert.strictEqual(error, "stderr", "The error message should match");
        }
    });

    test("should reject with stdout if exec returns an error", async () => {
        execStub.yields(new Error("Execution failed"), "stdout", "");

        try {
            await tb2robotLib.tb2robotRead(context, "workingDirectory", "outputXmlPath", "reportWithoutResultsPath");
            assert.fail("Expected function to throw");
        } catch (error) {
            assert.strictEqual(error, "stdout", "The error message should match");
        }
    });

    test("should reject with default if exec returns an error", async () => {
        execStub.yields(new Error("Execution failed"), "", "");

        try {
            await tb2robotLib.tb2robotRead(context, "workingDirectory", "outputXmlPath", "reportWithoutResultsPath");
            assert.fail("Expected function to throw");
        } catch (error) {
            assert.strictEqual(error, "An unknown Error occurred.", "The error message should match");
        }
    });

    /*test('should generate correct JSON output, with result path', async () => {
        assert.strictEqual('Installed extensions:', vscode.extensions.all.map(ext => ext.id));
        const pythonExtension = vscode.extensions.getExtension('ms-python.python');
        if (!pythonExtension) {
            assert.fail('Python extension is not installed or could not be found');
        } else {
            if (!pythonExtension.isActive) {
                await pythonExtension.activate();
            }
        }
        
        const pythonApi: PythonExtension = await PythonExtension.api();
        const environmentPath = pythonApi?.environments.getActiveEnvironmentPath();
        const enviroment = await pythonApi?.environments.resolveEnvironment(environmentPath);
        const pythonPath = enviroment?.executable.uri?.fsPath;
        if (pythonPath) {
            assert.match(pythonPath, /python\.exe/, 'Did not find python.exe')
        }
        else {
            assert.fail('pythonPath was undefined')
        }
        const tb2robMain = path.join(process.cwd(), "bundled", "tools", "tb2robot", "__main__.py");
        const commandBase = `${pythonPath} -u ${tb2robMain}`
        assert.strictEqual('this is fake', commandBase);
        /*const outputXmlPath = './src/test/mocks/expected/XMLOutput/output.xml';
        const reportWithoutResultsPath = './src/test/mocks/expected/JSONRepWithoutRes';
        const resultPath = './src/test/mocks/results/JSONRepWithRes';

        let testpath =process.cwd();
        assert.strictEqual('path', testpath);

        await tb2r.tb2robotRead('comBase', 'workingDir', outputXmlPath, reportWithoutResultsPath, resultPath, 'configJSONPath');

        const generatedFilePath = path.join(resultPath, 'expected-output.json');
        const generatedData = JSON.parse(fs.readFileSync(generatedFilePath, 'utf-8'));

        const expectedFilePath = path.join(__dirname, 'expected-output.json');
        const expectedData = JSON.parse(fs.readFileSync(expectedFilePath, 'utf-8'));


        assert.deepStrictEqual(generatedData, expectedData);
    });*/
});

suite("startTb2robotWrite", () => {
    let context: vscode.ExtensionContext;
    let tb2robotWriteStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;
    let consoleErrorStub: sinon.SinonStub;

    setup(() => {
        tb2robotWriteStub = sinon.stub(tb2robotLib, "tb2robotWrite");
        showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");
        consoleLogStub = sinon.stub(console, "log");
        consoleErrorStub = sinon.stub(console, "error");
    });

    teardown(() => {
        sinon.restore();
    });

    test("should return true and log correct message when tb2robotWrite resolves without config", async () => {
        tb2robotWriteStub.resolves();
        const result = await tb2robotLib.startTb2robotWrite(context, "workingDirectory", "reportPath");
        assert.ok(tb2robotWriteStub.called);

        assert.strictEqual(true, result, "Expected the function to return true on success");
        //assert.ok(consoleLogStub.calledOnce, 'Expected console.log to be called once');
        /*assert.strictEqual(
            consoleLogStub.firstCall.args[0],
            'tb2robot write-generation completed using reportPath, no config file provided.',
            'Expected log message to include "write-generation completed"'
        );*/
    });

    test("should return true and log correct message when tb2robotWrite resolves with config", async () => {
        tb2robotWriteStub.resolves();

        const result = await tb2robotLib.startTb2robotWrite(
            context,
            "workingDirectory",
            "reportPath",
            "configJSONPath"
        );
        assert.ok(tb2robotWriteStub.called);

        assert.strictEqual(true, result, "Expected the function to return true on success");
        //assert.ok(consoleLogStub.calledOnce, 'Expected console.log to be called once');
        /*assert.strictEqual(
            consoleLogStub.firstCall.args[0],
            'tb2robot write-generation completed using reportPath, configJSONPath config file provided.',
            'Expected log message to include "write-generation completed"'
        );*/
    });

    test("should return false and show error message when tb2robotWrite rejects", async () => {
        const errorMessage = "An error occurred";
        tb2robotWriteStub.rejects(new Error(errorMessage));

        const result = await tb2robotLib.startTb2robotWrite(context, "workingDirectory", "reportPath");
        assert.ok(tb2robotWriteStub.called);

        assert.strictEqual(false, result, "Expected the function to return false on failure");
        //assert.ok(consoleErrorStub.calledOnce, 'Expected console.error to be called once');
        /*assert.strictEqual(
            consoleErrorStub.firstCall.args[1],
            errorMessage,
            'Expected error log to match the simulated error'
        );*/
        assert.ok(showErrorMessageStub.calledOnce, "Expected showErrorMessage to be called once");
        assert.strictEqual(
            showErrorMessageStub.firstCall.args[0],
            `testbench2robotframework Error: ${errorMessage}`,
            "Expected error message to match the simulated error"
        );
    });
});

suite("startRobotGenerateXMLResults", () => {
    let robotGenerateXMLResultsStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;
    let consoleErrorStub: sinon.SinonStub;

    setup(() => {
        robotGenerateXMLResultsStub = sinon.stub(tb2robotLib, "robotGenerateXMLResults");
        showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");
        consoleLogStub = sinon.stub(console, "log");
        consoleErrorStub = sinon.stub(console, "error");
    });

    teardown(() => {
        sinon.restore();
    });

    test("should return true and log correct message", async () => {
        robotGenerateXMLResultsStub.resolves();
        const result = await tb2robotLib.startRobotGenerateXMLResults(
            "workingDirectory",
            "outputResultDir",
            "reportPath"
        );
        assert.ok(robotGenerateXMLResultsStub.called);

        assert.strictEqual(true, result, "Expected the function to return true on success");
        //assert.ok(consoleLogStub.calledOnce, 'Expected console.log to be called once');
        /*assert.strictEqual(
            consoleLogStub.firstCall.args[0],
            'tb2robot write-generation completed using reportPath, no config file provided.',
            'Expected log message to include "write-generation completed"'
        );*/
    });

    test("should return false and show error message when robotGenerateXMLResults rejects", async () => {
        const errorMessage = "An error occurred";
        robotGenerateXMLResultsStub.rejects(new Error(errorMessage));

        const result = await tb2robotLib.startRobotGenerateXMLResults(
            "workingDirectory",
            "outputResultDir",
            "reportPath"
        );
        assert.ok(robotGenerateXMLResultsStub.called);

        assert.strictEqual(false, result, "Expected the function to return false on failure");
        //assert.ok(consoleErrorStub.calledOnce, 'Expected console.error to be called once');
        /*assert.strictEqual(
            consoleErrorStub.firstCall.args[1],
            errorMessage,
            'Expected error log to match the simulated error'
        );*/
        assert.ok(showErrorMessageStub.calledOnce, "Expected showErrorMessage to be called once");
        assert.strictEqual(
            showErrorMessageStub.firstCall.args[0],
            `Robot Framework Error: ${errorMessage}`,
            "Expected error message to match the simulated error"
        );
    });
});

suite("startTb2robotRead", () => {
    let context: vscode.ExtensionContext;
    let tb2robotReadStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;
    let consoleErrorStub: sinon.SinonStub;
    let sandbox: sinon.SinonSandbox;

    setup(async () => {
        tb2robotReadStub = sinon.stub(tb2robotLib, "tb2robotRead");
        showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");
        consoleLogStub = sinon.stub(global.console, "log");
        consoleErrorStub = sinon.stub(global.console, "error");
        sandbox = sinon.createSandbox();
    });

    teardown(async () => {
        sinon.restore();
    });

    test("should return true and log correct message with all optional arguments", async () => {
        const spy = sinon.spy(console, "log");
        tb2robotReadStub.resolves();
        const result = await tb2robotLib.startTb2robotRead(
            context,
            "workingDirectory",
            "outputXmlPath",
            "reportPath",
            "resultPath",
            "configJSONPath"
        );
        assert.ok(tb2robotReadStub.called);

        assert.strictEqual(true, result, "Expected the function to return true on success");
        assert.ok(spy.calledOnce, "Expected console.log to be called once");
        /*assert.strictEqual(
            consoleLogStub.firstCall.args[0],
            'tb2robot write-generation completed using reportPath, no config file provided.',
            'Expected log message to include "write-generation completed"'
        );*/
    });

    test("should return true and log correct message with no optional arguments", async () => {
        tb2robotReadStub.resolves();
        const result = await tb2robotLib.startTb2robotRead(context, "workingDirectory", "outputXmlPath", "reportPath");
        assert.ok(tb2robotReadStub.called);

        assert.strictEqual(true, result, "Expected the function to return true on success");
        //assert.ok(consoleLogStub.calledOnce, 'Expected console.log to be called once');
        /*assert.strictEqual(
            consoleLogStub.firstCall.args[0],
            'tb2robot write-generation completed using reportPath, no config file provided.',
            'Expected log message to include "write-generation completed"'
        );*/
    });

    test("should return false and show error message when tb2robotRead rejects", async () => {
        const errorMessage = "An error occurred";
        tb2robotReadStub.rejects(new Error(errorMessage));

        const result = await tb2robotLib.startTb2robotRead(context, "workingDirectory", "outputXmlPath", "reportPath");
        assert.ok(tb2robotReadStub.called);

        assert.strictEqual(false, result, "Expected the function to return false on failure");
        //assert.ok(consoleErrorStub.calledOnce, 'Expected console.error to be called once');
        /*assert.strictEqual(
            consoleErrorStub.firstCall.args[1],
            errorMessage,
            'Expected error log to match the simulated error'
        );*/
        assert.ok(showErrorMessageStub.calledOnce, "Expected showErrorMessage to be called once");
        assert.strictEqual(
            showErrorMessageStub.firstCall.args[0],
            `testbench2robotframework Error: ${errorMessage}`,
            "Expected error message to match the simulated error"
        );
    });
});
