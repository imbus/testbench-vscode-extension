/**
 * @file src/test/setup/mockVSCodeAPI.ts
 * @description Sets up mocks for the core VS Code API (window, workspace, commands).
 */

import * as vscode from "vscode";
import * as sinon from "sinon";
import { createMockWorkspaceConfiguration } from "../utils/stubHelpers";

// Define an interface for the returned mock objects for type safety
export interface VSCodeAPIMocks {
    getConfigurationStub: sinon.SinonStub;
    showInformationMessageStub: sinon.SinonStub;
    showErrorMessageStub: sinon.SinonStub;
    showWarningMessageStub: sinon.SinonStub;
    showQuickPickStub: sinon.SinonStub;
    showOpenDialogStub: sinon.SinonStub;
    executeCommandStub: sinon.SinonStub;
    registerCommandStub: sinon.SinonStub;
    setContextStub: sinon.SinonStub;
    registerAuthenticationProviderStub: sinon.SinonStub;
}

/**
 * Sets up stubs for the `vscode` API namespace.
 * @param sandbox - The Sinon sandbox to create the stubs in.
 * @returns An object containing all the created stubs for manipulation in tests.
 */
export function setupVSCodeMocks(sandbox: sinon.SinonSandbox): VSCodeAPIMocks {
    // --- vscode.workspace ---
    const getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration");
    getConfigurationStub.returns(createMockWorkspaceConfiguration(sandbox));

    // --- vscode.window ---
    const showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
    const showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
    const showWarningMessageStub = sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);
    const showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);
    const showOpenDialogStub = sandbox.stub(vscode.window, "showOpenDialog").resolves(undefined);

    // --- vscode.commands ---
    const executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves(undefined);
    const registeredCommands = new Map<string, (...args: any[]) => any>();
    const registerCommandStub = sandbox.stub(vscode.commands, "registerCommand").callsFake((command, callback) => {
        registeredCommands.set(command, callback);
        return { dispose: () => registeredCommands.delete(command) };
    });
    const setContextStub = executeCommandStub.withArgs("setContext");

    // Add stubs for the vscode.authentication namespace
    // --- vscode.authentication ---
    const registerAuthenticationProviderStub = sandbox.stub(vscode.authentication, "registerAuthenticationProvider");
    // Stub other methods used by the activate function to prevent runtime errors in tests
    sandbox.stub(vscode.authentication, "getSession").resolves(undefined);
    sandbox.stub(vscode.authentication, "onDidChangeSessions").returns({ dispose: () => {} } as vscode.Disposable);

    return {
        getConfigurationStub,
        showInformationMessageStub,
        showErrorMessageStub,
        showWarningMessageStub,
        showQuickPickStub,
        showOpenDialogStub,
        executeCommandStub,
        registerCommandStub,
        setContextStub,
        registerAuthenticationProviderStub
    };
}
