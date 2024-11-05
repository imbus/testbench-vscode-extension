import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { getActiveWorkspaceFolder } from '../../pyCommandBuilder';
import * as fs from 'fs';
import * as os from 'os';

function createTemporaryFolder(): string {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-workspace-'));
    return tempDir;
}

function createFileInFolder(folder: string, filename: string): string {
    const filePath = path.join(folder, filename);
    fs.writeFileSync(filePath, 'test content');
    return filePath;
}

suite('getActiveWorkspaceFolder Tests', () => {
    

    setup(() => {
        /*workspace1 = createTemporaryFolder();
        workspace2 = createTemporaryFolder();

        createFileInFolder(workspace1, 'testFile1.txt');
        createFileInFolder(workspace2, 'testFile2.txt');*/
    });

    teardown(() => {
        /*fs.rmSync(workspace1, { recursive: true, force: true });
        fs.rmSync(workspace2, { recursive: true, force: true });*/
    });

    test('Should return undefined when no workspace is open', async () => {
        const workspaceFolder = getActiveWorkspaceFolder();
        assert.strictEqual(workspaceFolder, undefined, 'Expected no active workspace folder');
    });

    /*test('Should return the single workspace folder when only one is open', async () => {
        let workspace1: string;

        workspace1 = createTemporaryFolder();
        createFileInFolder(workspace1, 'testFile1.txt');

        await vscode.workspace.updateWorkspaceFolders(0, null, { uri: vscode.Uri.file(workspace1) });
        
        const workspaceFolder = getActiveWorkspaceFolder();
        const activeWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        assert.strictEqual(workspaceFolder?.uri.fsPath, activeWorkspacePath, 'Expected the single open workspace folder');

        fs.rmSync(workspace1, { recursive: true, force: true });
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