/**
 * @file src/test/setup/testSetup.ts
 * @description Main entry point for test suite setup.
 * It creates a comprehensive "test environment" object that will be used in beforeEach hooks in the test suites.
 * Global test setup that initializes all mocks and stubs.
 */

import * as sinon from "sinon";
import { setupVSCodeMocks, VSCodeAPIMocks } from "./mockVSCodeAPI";
import { createMockExtensionContext } from "./mockExtensionContext";
import { TestBenchLogger } from "../../testBenchLogger";
import { ProjectManagementTreeDataProvider } from "../../views/projectManagement/projectManagementTreeDataProvider";
import { TestThemeTreeDataProvider } from "../../views/testTheme/testThemeTreeDataProvider";
import { TestElementsTreeDataProvider } from "../../views/testElements/testElementsTreeDataProvider";
import { IconManagementService } from "../../views/common/iconManagementService";
import { MarkedItemStateService } from "../../views/testTheme/markedItemStateService";
import * as vscode from "vscode";

// A single context object containing all mocks for a test suite
export interface TestEnvironment {
    sandbox: sinon.SinonSandbox;
    vscodeMocks: VSCodeAPIMocks;
    mockContext: vscode.ExtensionContext;
    logger: sinon.SinonStubbedInstance<TestBenchLogger>;
    projectProvider: sinon.SinonStubbedInstance<ProjectManagementTreeDataProvider>;
    testThemeProvider: sinon.SinonStubbedInstance<TestThemeTreeDataProvider>;
    testElementsProvider: sinon.SinonStubbedInstance<TestElementsTreeDataProvider>;
    iconService: sinon.SinonStubbedInstance<IconManagementService>;
    markedItemService: sinon.SinonStubbedInstance<MarkedItemStateService>;
}

/**
 * Creates a fully mocked test environment for a test suite.
 * This should be called in a `beforeEach` or `setup` block.
 * @returns A TestEnvironment object.
 */
export function setupTestEnvironment(): TestEnvironment {
    const sandbox = sinon.createSandbox();

    // Mock all external dependencies (VS Code API)
    const vscodeMocks = setupVSCodeMocks(sandbox);
    const mockContext = createMockExtensionContext(sandbox);

    // Create stubs for the extension's internal classes/dependencies
    const logger = sandbox.createStubInstance(TestBenchLogger);
    const iconService = sandbox.createStubInstance(IconManagementService);
    const markedItemService = sandbox.createStubInstance(MarkedItemStateService);

    // For providers, we need to stub the event emitters as well
    const projectProvider = sandbox.createStubInstance(ProjectManagementTreeDataProvider);
    (projectProvider as any)._onDidChangeTreeData = { event: sandbox.stub(), fire: sandbox.stub() };

    const testThemeProvider = sandbox.createStubInstance(TestThemeTreeDataProvider);
    (testThemeProvider as any)._onDidChangeTreeData = { event: sandbox.stub(), fire: sandbox.stub() };

    const testElementsProvider = sandbox.createStubInstance(TestElementsTreeDataProvider);
    (testElementsProvider as any)._onDidChangeTreeData = { event: sandbox.stub(), fire: sandbox.stub() };

    return {
        sandbox,
        vscodeMocks,
        mockContext,
        logger,
        projectProvider,
        testThemeProvider,
        testElementsProvider,
        iconService,
        markedItemService
    };
}
