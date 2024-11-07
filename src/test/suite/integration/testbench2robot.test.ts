import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as assert from 'assert';
import * as vscode from 'vscode'
import { tb2robotLib} from '../../../testbench2robotframeworkLib';
import { compareDirectories, copyFolderSync } from './comparisonHelper';

const rootPath = path.resolve(__dirname, '../../../../')

async function checkPythonExtension() {
    let ext = vscode.extensions.getExtension('ms-python.python');
    if (ext) {
        if (!ext.isActive) {
            await ext.activate();
        }
    }
    else {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-python.python');
    }
}

suite('tb2robot -w integration test', async function () {
    let context: vscode.ExtensionContext;

    this.timeout(50000);

    setup(async () => {
        context = {
            secrets: {
                get: sinon.stub().resolves("mockSessionToken"),
                store: sinon.stub().resolves(),
                delete: sinon.stub().resolves(),
            },
            subscriptions: [],
            workspaceState: {} as any,
            globalState: {} as any,
            extensionUri: {} as any,
            extensionPath: "",
            environmentVariableCollection: {} as any,
            storagePath: "",
            globalStoragePath: "",
            logPath: "",
            logUri: {} as any,
            storageUri: {} as any,
            globalStorageUri: {} as any,
            logLevel: vscode.LogLevel.Info,
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (relativePath: string) => path.join(rootPath, "bundled", "tools", "tb2robot", "__main__.py"),
        } as unknown as vscode.ExtensionContext;

        await checkPythonExtension();
    });

    teardown(() => {
        sinon.restore();

        const resultFolderPath = path.join(rootPath, 'src/test/mocks/results')
        if (fs.existsSync(resultFolderPath)) {
            fs.rmSync(resultFolderPath, { recursive: true });
        }

        const bt2robotLogPath = path.join(rootPath, 'testbench2robotframework.log');
        if(fs.existsSync(bt2robotLogPath)){
            fs.rmSync(bt2robotLogPath);
        }
    });

    test('should return true and generate correct robot files, with config', async () => {
        const reportPath = path.join(rootPath, 'src/test/mocks/expected/JSONRepWithoutRes');
        const configJSONPath = path.join(rootPath, 'src/test/mocks/expected/config.json');
        const expectedGeneration = path.join(rootPath, 'src/test/mocks/expected/RobFraTestsuites');
        const createdGeneration = path.join(rootPath, 'src/test/mocks/results/Generated');

        const res = await tb2robotLib.startTb2robotWrite(context, rootPath, reportPath, configJSONPath);

        const contentComparison = compareDirectories(expectedGeneration, createdGeneration);
        assert.ok(contentComparison, 'Expected content of generated folder to match exisitng mock');

        const createdContent = fs.readFileSync(path.join(createdGeneration, '2_Regression/__init__.robot'), 'utf-8');
        const expectedContent = fs.readFileSync(path.join(expectedGeneration, '2_Regression/__init__.robot'), 'utf-8');
        assert.strictEqual(createdContent, expectedContent, 'Expected content to be equal');
        assert.strictEqual(res, true, 'Expected startTb2robotWrite to return true')
    });

    test('should return false and call error message', async () => {
        const spy = sinon.spy(vscode.window, 'showErrorMessage');
        let res = false;

        res = await tb2robotLib.startTb2robotWrite(context, '', '', '');

        assert.ok(spy.called, 'Expected showErrorMessage to be called');
        assert.strictEqual(res, false, 'Expected startTb2robotWrite to return false')

    });
});

suite('tb2robot -r integration test', async function () {
    let context: vscode.ExtensionContext;
    const reportPath = path.join(rootPath, 'src/test/mocks/expected/JSONRepWithoutRes');
    const outputXmlPath = path.join(rootPath, 'src/test/mocks/expected/XMLOutput/output.xml');
    const configJSONPath = path.join(rootPath, 'src/test/mocks/expected/config.json');
    const resultPath = path.join(rootPath, 'src/test/mocks/results/JSONRepWithRes');
    const expectedGeneration = path.join(rootPath, 'src/test/mocks/expected/JSONRepWithRes');

    this.timeout(50000);

    setup(async () => {
        context = {
            secrets: {
                get: sinon.stub().resolves("mockSessionToken"),
                store: sinon.stub().resolves(),
                delete: sinon.stub().resolves(),
            },
            subscriptions: [],
            workspaceState: {} as any,
            globalState: {} as any,
            extensionUri: {} as any,
            extensionPath: "",
            environmentVariableCollection: {} as any,
            storagePath: "",
            globalStoragePath: "",
            logPath: "",
            logUri: {} as any,
            storageUri: {} as any,
            globalStorageUri: {} as any,
            logLevel: vscode.LogLevel.Info,
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (relativePath: string) => path.join(rootPath, "bundled", "tools", "tb2robot", "__main__.py"),
        } as unknown as vscode.ExtensionContext;

        await checkPythonExtension();
    });

    teardown(() => {
        sinon.restore();

        const resultFolderPath = path.join(rootPath, 'src/test/mocks/results')
        if (fs.existsSync(resultFolderPath)) {
            fs.rmSync(resultFolderPath, { recursive: true });
        }

        const bt2robotLogPath = path.join(rootPath, 'testbench2robotframework.log');
        if(fs.existsSync(bt2robotLogPath)){
            fs.rmSync(bt2robotLogPath);
        }
    });

    test('should return true and generate correct json results, with resultPath and config', async () => {
        const createdGeneration = resultPath;

        const res = await tb2robotLib.startTb2robotRead(context, rootPath, outputXmlPath, reportPath, resultPath, configJSONPath);

        const contentComparison = compareDirectories(expectedGeneration, createdGeneration);
        assert.ok(contentComparison, 'Expected content of generated folder to match exisitng mock');

        const createdContent = fs.readFileSync(path.join(createdGeneration, 'iTB-TC-318.json'), 'utf-8');
        const expectedContent = fs.readFileSync(path.join(expectedGeneration, 'iTB-TC-318.json'), 'utf-8');
        assert.strictEqual(createdContent, expectedContent, 'Expected content to be equal');
        assert.strictEqual(res, true, 'Expected startTb2robotRead to return true')
    });

    test('should return true and generate correct json results, with resultPath', async () => {
        const createdGeneration = resultPath;

        const res = await tb2robotLib.startTb2robotRead(context, rootPath, outputXmlPath, reportPath, resultPath);

        const contentComparison = compareDirectories(expectedGeneration, createdGeneration);
        assert.ok(contentComparison, 'Expected content of generated folder to match exisitng mock');

        const createdContent = fs.readFileSync(path.join(createdGeneration, 'iTB-TC-318.json'), 'utf-8');
        const expectedContent = fs.readFileSync(path.join(expectedGeneration, 'iTB-TC-318.json'), 'utf-8');
        assert.strictEqual(createdContent, expectedContent, 'Expected content to be equal');
        assert.strictEqual(res, true, 'Expected startTb2robotRead to return true')
    });

    test('should return true and generate correct json results, without optional parameters', async () => {
        const copiedReportPath = path.join(rootPath, 'src/test/mocks/results/JSONRepWithoutRes');
        const createdGeneration = copiedReportPath;

        copyFolderSync(reportPath, copiedReportPath);

        const res = await tb2robotLib.startTb2robotRead(context, rootPath, outputXmlPath, copiedReportPath);

        const contentComparison = compareDirectories(expectedGeneration, createdGeneration);
        assert.ok(contentComparison, 'Expected content of generated folder to match exisitng mock');

        const createdContent = fs.readFileSync(path.join(createdGeneration, 'iTB-TC-318.json'), 'utf-8');
        const expectedContent = fs.readFileSync(path.join(expectedGeneration, 'iTB-TC-318.json'), 'utf-8');
        assert.strictEqual(createdContent, expectedContent, 'Expected content to be equal');
        assert.strictEqual(res, true, 'Expected startTb2robotRead to return true')
    });

    test('should return false and call error message', async () => {
        const spy = sinon.spy(vscode.window, 'showErrorMessage');
        let res = false;

        res = await tb2robotLib.startTb2robotRead(context, '', '', '');

        assert.ok(spy.called, 'Expected showErrorMessage to be called');
        assert.strictEqual(res, false, 'Expected startTb2robotRead to return false')

    });
});

suite('XML generation integration test', async function () {
    const robotFilesPath = path.join(rootPath, 'src/test/mocks/expected/RobFraTestsuites');
    const outputResultDir = path.join(rootPath, 'src/test/mocks/results/XMLOutput');
    const expectedGeneration = path.join(rootPath, 'src/test/mocks/expected/XMLOutput');

    this.timeout(50000);

    setup(async () => {
        await checkPythonExtension();
    });

    teardown(() => {
        sinon.restore();

        const resultFolderPath = path.join(rootPath, 'src/test/mocks/results')
        if (fs.existsSync(resultFolderPath)) {
            fs.rmSync(resultFolderPath, { recursive: true });
        }
    });

    test('should return true and generate correct output.xml', async () => {
        const createdGeneration = outputResultDir;

        if (!fs.existsSync(outputResultDir)) {
            fs.mkdirSync(outputResultDir, { recursive: true });
        }

        const res = await tb2robotLib.startRobotGenerateXMLResults(rootPath, outputResultDir, robotFilesPath);

        const contentComparison = compareDirectories(expectedGeneration, createdGeneration);
        assert.ok(contentComparison, 'Expected content of generated folder to match exisitng mock');

        const createdContent = fs.readFileSync(path.join(createdGeneration, 'report.html'), 'utf-8');
        assert.ok(createdContent.includes('"fail":0,"label":"All Tests","pass":54,"skip":0'), 'Expected report to include paassed results');
        assert.strictEqual(res, true, 'Expected startRobotGenerateXMLResults to return true')

    });

    test('should return false and call error message', async () => {
        const spy = sinon.spy(vscode.window, 'showErrorMessage');

        const res = await tb2robotLib.startRobotGenerateXMLResults('', '', '');

        assert.ok(spy.called, 'Expected showErrorMessage to be called');
        assert.strictEqual(res, false, 'Expected startRobotGenerateXMLResults to return false')

    });
});

