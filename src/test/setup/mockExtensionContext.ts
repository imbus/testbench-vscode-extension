/**
 * @file src/test/setup/mockExtensionContext.ts
 * @description This file provides a reusable function to create a mock vscode.ExtensionContext, which is required by many of the extension's core components.
 */

import * as vscode from "vscode";
import * as sinon from "sinon";

/**
 * Creates a mock VS Code ExtensionContext object for use in tests.
 * @param sandbox - The Sinon sandbox to create stubs within.
 * @returns A mock vscode.ExtensionContext object.
 */
export function createMockExtensionContext(sandbox: sinon.SinonSandbox): vscode.ExtensionContext {
    // The detailed context from the user's reportHandler.test.ts was a great reference.
    // This function generalizes it for reuse across all test suites.
    return {
        subscriptions: [],
        workspaceState: {
            get: sandbox.stub().callsFake((key: string, defaultValue?: any) => defaultValue),
            update: sandbox.stub().resolves(),
            keys: sandbox.stub().returns([])
        } as unknown as vscode.Memento & { keys: () => readonly string[] },
        globalState: {
            get: sandbox.stub(),
            update: sandbox.stub().resolves(),
            keys: sandbox.stub().returns([])
        } as any, // Cast to any to satisfy Memento & { keys }
        secrets: {
            get: sandbox.stub().resolves(undefined),
            store: sandbox.stub().resolves(),
            delete: sandbox.stub().resolves(),
            onDidChange: sandbox.stub().returns({ dispose: () => {} })
        },
        extensionUri: vscode.Uri.file("/mock/extension/path"),
        extensionPath: "/mock/extension/path",
        storageUri: vscode.Uri.file("/mock/storage/path"),
        globalStorageUri: vscode.Uri.file("/mock/globalstorage/path"),
        logUri: vscode.Uri.file("/mock/log/path"),
        environmentVariableCollection: {} as any, // Not typically used in unit tests
        extensionMode: vscode.ExtensionMode.Test,
        asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`
    } as unknown as vscode.ExtensionContext;
}
