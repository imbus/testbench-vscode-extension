/**
 * @file src/test/utils/stubHelpers.ts
 * @description Reusable helper functions for creating sinon stubs.
 * This file contains helper functions for creating common stubs, like a WorkspaceConfiguration object, reducing boilerplate in test files.
 */

import * as vscode from "vscode";
import * as sinon from "sinon";

/**
 * Creates a mock VS Code WorkspaceConfiguration object.
 * @param sandbox - The Sinon sandbox.
 * @param initialConfig - An optional map of configuration keys and their initial values.
 * @returns A Sinon-stubbed WorkspaceConfiguration object.
 */
export function createMockWorkspaceConfiguration(
    sandbox: sinon.SinonSandbox,
    initialConfig: Record<string, any> = {}
): vscode.WorkspaceConfiguration {
    const config = { ...initialConfig };

    const getStub = sandbox.stub().callsFake((key: string, defaultValue?: any) => {
        return config[key] !== undefined ? config[key] : defaultValue;
    });

    const updateStub = sandbox.stub().callsFake(async (key: string, value: any) => {
        config[key] = value;
    });

    return {
        get: getStub,
        has: sandbox.stub().callsFake((key: string) => key in config),
        inspect: sandbox.stub(),
        update: updateStub
    } as unknown as vscode.WorkspaceConfiguration;
}
