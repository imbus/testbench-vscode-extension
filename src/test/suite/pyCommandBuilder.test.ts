import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { pyCommandBuilder } from '../../pyCommandBuilder';
import * as sinon from 'sinon';
import { PythonExtension, EnvironmentPath, Environment, ResolvedEnvironment } from '@vscode/python-extension';

suite('getActiveWorkspaceFolder tests', () => {
    let workspaceFoldersStub: sinon.SinonStub;
    let workspaceFolder1: vscode.WorkspaceFolder
    let workspaceFolder2: vscode.WorkspaceFolder
    let activeTextEditorStub: sinon.SinonStub;

    setup(() => {
        workspaceFoldersStub = sinon.stub(vscode.workspace, 'workspaceFolders');
        activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor');
    });

    teardown(() => {
        sinon.restore();
    });

    test('Should return undefined when no workspace is open', async () => {
        workspaceFoldersStub.value([]);

        const workspaceFolder = pyCommandBuilder.getActiveWorkspaceFolder();
        assert.strictEqual(workspaceFolder, undefined, 'Expected no active workspace folder');
    });

    test('Should return the single workspace folder when only one is open', async () => {
        workspaceFolder1 = {
            uri: vscode.Uri.parse('workspaceFolder1Path'),
            name: 'workspaceFolder1',
            index: 0
        }

        workspaceFoldersStub.value([workspaceFolder1]);

        const workspaceFolder = pyCommandBuilder.getActiveWorkspaceFolder();
        assert.strictEqual(workspaceFolder, workspaceFolder1, 'Expected to return workspaceFolder1');
    });

    //TODO: vscode.workspace.getWorkspaceFolder(passed Test value) returns undefined
    test('Should return the correct workspace folder when multiple are open', async () => {
        workspaceFolder1 = {
            uri: vscode.Uri.parse('file:///workspaceFolder1Path'),
            name: 'workspaceFolder1',
            index: 0
        }

        workspaceFolder2 = {
            uri: vscode.Uri.parse('file:///workspaceFolder2Path'),
            name: 'workspaceFolder2',
            index: 1
        }

        workspaceFoldersStub.value([workspaceFolder1, workspaceFolder2]);

        activeTextEditorStub.get(() => {
            return {
                document: {
                    uri: workspaceFolder2.uri,
                    fileName: 'stubFile',
                    languageId: 'plaintext',
                    getText: () => 'stubFile content',
                    lineCount: 10,
                },
                selection: new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)),
            } as unknown as vscode.TextEditor;
        });

        const workspaceFolder = pyCommandBuilder.getActiveWorkspaceFolder();
        assert.strictEqual(workspaceFolder, workspaceFolder2, 'Expected to return workspaceFolder2Stub');
    });
});

suite('getPythonEnviromentExe tests', () => {
    let pythonApiStub: sinon.SinonStubbedInstance<PythonExtension>;

    setup(() => {
        pythonApiStub = {
            environments: {
                getActiveEnvironmentPath: Function,
                resolveEnvironment: Function,
            }
        } as any;
    });

    teardown(() => {
        sinon.restore();
    });

    test('should return pythonPath with activeWorkspace', async () => {
        const mockWorkspace = {} as vscode.WorkspaceFolder;
        const mockEnvironmentPath = {} as EnvironmentPath;
        const mockEnvironment = { executable: { uri: { fsPath: 'pythonPath' } } } as ResolvedEnvironment;
        sinon.stub(PythonExtension, 'api').resolves(pythonApiStub);

        const getActiveEnvironmentPathStub = sinon.stub(pythonApiStub.environments, 'getActiveEnvironmentPath');
        getActiveEnvironmentPathStub.withArgs(mockWorkspace).returns(mockEnvironmentPath);

        const resolveEnvironmentStub = sinon.stub(pythonApiStub.environments, 'resolveEnvironment');
        resolveEnvironmentStub.withArgs(mockEnvironmentPath).resolves(mockEnvironment);

        const result = await pyCommandBuilder.getPythonEnviromentExe(mockWorkspace);
        assert.strictEqual(result, 'pythonPath', 'Expected getPythonEnviromentExe to return pythonPath');
    });

    test('should return pythonPath without activeWorkspace', async () => {
        const mockEnvironmentPath = {} as EnvironmentPath;
        const mockEnvironment = { executable: { uri: { fsPath: 'pythonPath' } } } as ResolvedEnvironment;
        sinon.stub(PythonExtension, 'api').resolves(pythonApiStub);

        const getActiveEnvironmentPathStub = sinon.stub(pythonApiStub.environments, 'getActiveEnvironmentPath');
        getActiveEnvironmentPathStub.returns(mockEnvironmentPath);

        const resolveEnvironmentStub = sinon.stub(pythonApiStub.environments, 'resolveEnvironment');
        resolveEnvironmentStub.withArgs(mockEnvironmentPath).resolves(mockEnvironment);

        const result = await pyCommandBuilder.getPythonEnviromentExe(undefined);
        assert.strictEqual(result, 'pythonPath', 'Expected getPythonEnviromentExe to return pythonPath');
    });

    test('should return undefined if pythonApi is undefined', async () => {
        sinon.stub(PythonExtension, 'api').resolves(undefined);

        const result = await pyCommandBuilder.getPythonEnviromentExe(undefined);
        assert.strictEqual(result, undefined, 'Expected getPythonEnviromentExe to return undefined when no environment path is found');
    });

    test('should return undefined if resolveEnvironment resolves undefined', async () => {
        const mockEnvironmentPath = {} as EnvironmentPath;
        sinon.stub(PythonExtension, 'api').resolves(pythonApiStub);

        const getActiveEnvironmentPathStub = sinon.stub(pythonApiStub.environments, 'getActiveEnvironmentPath');
        getActiveEnvironmentPathStub.returns(mockEnvironmentPath);

        const resolveEnvironmentStub = sinon.stub(pythonApiStub.environments, 'resolveEnvironment');
        resolveEnvironmentStub.withArgs(mockEnvironmentPath).resolves(undefined);

        const result = await pyCommandBuilder.getPythonEnviromentExe(undefined);
        assert.strictEqual(result, undefined, 'Expected getPythonEnviromentExe to return undefined when environment resolution fails');
    });
});

suite('buildTb2RobotCommand tests', function () {
    let context: vscode.ExtensionContext;
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
        asAbsolutePath: (relativePath: string) => path.join("rootPath", "bundled", "tools", "tb2robot", "__main__.py"),
    } as unknown as vscode.ExtensionContext;

    this.timeout(5000);

    setup(() => {
    });

    teardown(() => {
        sinon.restore();
    });

    test('should return commandBase if getPythonEnviromentExe resolves defined', async () => {
        const getPythonEnviromentExeStub = sinon.stub(pyCommandBuilder, 'getPythonEnviromentExe');
        getPythonEnviromentExeStub.resolves('pythonpath');

        const result = await pyCommandBuilder.buildTb2RobotCommand(context);
        assert.strictEqual(result, 'pythonpath -u rootPath\\bundled\\tools\\tb2robot\\__main__.py', 'Expected buildTb2RobotCommand to return correct base command');
    });

    test('should return empty string if getPythonEnviromentExe resolves undefined', async () => {
        const getPythonEnviromentExeStub = sinon.stub(pyCommandBuilder, 'getPythonEnviromentExe');
        getPythonEnviromentExeStub.resolves(undefined);

        const result = await pyCommandBuilder.buildTb2RobotCommand(context);
        assert.strictEqual(result, '', 'Expected buildTb2RobotCommand to return empty string');
    });
});

suite('buildRobotCommand tests', function () {
    this.timeout(5000);

    setup(() => {
    });

    teardown(() => {
        sinon.restore();
    });

    test('should return commandBase if getPythonEnviromentExe resolves defined', async () => {
        const getPythonEnviromentExeStub = sinon.stub(pyCommandBuilder, 'getPythonEnviromentExe');
        getPythonEnviromentExeStub.resolves('pythonpath');

        const result = await pyCommandBuilder.buildRobotCommand();
        assert.strictEqual(result, 'pythonpath -m robot', 'Expected buildRobotCommand to return correct base command');
    });

    test('should return empty string if getPythonEnviromentExe resolves undefined', async () => {
        const getPythonEnviromentExeStub = sinon.stub(pyCommandBuilder, 'getPythonEnviromentExe');
        getPythonEnviromentExeStub.resolves(undefined);

        const result = await pyCommandBuilder.buildRobotCommand();
        assert.strictEqual(result, '', 'Expected buildRobotCommand to return empty string');
    });
});
