import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { pyCommandBuilder } from '../../pyCommandBuilder';
import * as sinon from 'sinon';
import { PythonExtension, EnvironmentPath, Environment, ResolvedEnvironment } from '@vscode/python-extension'; // Adjust this path

suite('getActiveWorkspaceFolder tests', () => {
    let workspaceFoldersStub: sinon.SinonStub;
    let workspaceFolder1Stub: sinon.SinonStubbedInstance<vscode.WorkspaceFolder>;
    let workspaceFolder2Stub: sinon.SinonStubbedInstance<vscode.WorkspaceFolder>;

    setup(() => {
        workspaceFoldersStub = sinon.stub(vscode.workspace, 'workspaceFolders');
    });

    teardown(() => {
    });

    test('Should return undefined when no workspace is open', async () => {
        const workspaceFolder = pyCommandBuilder.getActiveWorkspaceFolder();
        assert.strictEqual(workspaceFolder, undefined, 'Expected no active workspace folder');
    });

    /*test('Should return the single workspace folder when only one is open', async () => {
        await vscode.workspace.updateWorkspaceFolders(0, null, { uri: vscode.Uri.file(workspace1) });
        
        const workspaceFolder = getActiveWorkspaceFolder();
        const activeWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        assert.strictEqual(workspaceFolder?.uri.fsPath, activeWorkspacePath, 'Expected the single open workspace folder');

        vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length || 0);
    });*/

    /*test('Should return the workspace folder of the active file when multiple are open', async () => {
        let workspace1: string;
        let workspace2: string;

        workspace1 = createTemporaryFolder();
        workspace2 = createTemporaryFolder();

        createFileInFolder(workspace1, 'testFile1.txt');
        createFileInFolder(workspace2, 'testFile2.txt');

        try{
        await vscode.workspace.updateWorkspaceFolders(0, null, { uri: vscode.Uri.file(workspace1) }, { uri: vscode.Uri.file(workspace2) });

        const testFileUri = vscode.Uri.file(path.join(workspace2, 'testFile2.txt'));
        await new Promise(resolve => setTimeout(resolve, 1000));
        try{
        const document = await vscode.workspace.openTextDocument(testFileUri);
        await vscode.window.showTextDocument(document);
        } catch(e) {console.log(e)}

        const workspaceFolder = getActiveWorkspaceFolder();
        //assert.strictEqual(true, true, 'example 2');
        assert.strictEqual(workspaceFolder?.uri.fsPath, workspace2, 'Expected the workspace folder of the active file');
        } finally {

        fs.rmSync(workspace1, { recursive: true, force: true });
        fs.rmSync(workspace2, { recursive: true, force: true });

        }
    });*/
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