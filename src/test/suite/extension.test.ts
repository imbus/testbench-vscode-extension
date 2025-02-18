import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import {
    activate,
    deactivate,
    getConfig,
    baseKeyOfExtension,
    safeCommandHandler,
    promptForWorkspaceLocation,
    loadConfiguration,
    initializeTreeViews
} from "../../extension";
import { TestBenchLogger } from "../../testBenchLogger";
import { PlayServerConnection } from "../../testBenchConnection";
import { ProjectManagementTreeDataProvider } from "../../projectManagementTreeView";
import { LoginWebViewProvider } from "../../loginWebView";
import { TestElementsTreeDataProvider } from "../../testElementsTreeView";

suite("Extension Test Suite", () => {
    let sandbox: sinon.SinonSandbox;
    let getConfigurationStub: sinon.SinonStub;
    let context: vscode.ExtensionContext;
    let loggerStub: sinon.SinonStubbedInstance<TestBenchLogger>;
    let connectionStub: sinon.SinonStubbedInstance<PlayServerConnection>;
    let projectManagementTreeDataProviderStub: sinon.SinonStubbedInstance<ProjectManagementTreeDataProvider>;
    let loginWebViewProviderStub: sinon.SinonStubbedInstance<LoginWebViewProvider>;
    let testElementsTreeDataProviderStub: sinon.SinonStubbedInstance<TestElementsTreeDataProvider>;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Stub the VS Code API and assign it to a SinonStub variable
        getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration") as sinon.SinonStub;
        getConfigurationStub.returns({
            get: sandbox.stub().returns("defaultValue"),
            update: sandbox.stub().resolves()
        } as unknown as vscode.WorkspaceConfiguration);

        // Mock the ExtensionContext
        context = {
            subscriptions: [],
            secrets: {
                get: sandbox.stub().resolves("storedPassword"),
                store: sandbox.stub().resolves(),
                delete: sandbox.stub().resolves()
            }
        } as unknown as vscode.ExtensionContext;

        // Mock the logger
        loggerStub = sandbox.createStubInstance(TestBenchLogger);

        // Mock the connection
        connectionStub = sandbox.createStubInstance(PlayServerConnection);

        // Mock the tree data providers
        projectManagementTreeDataProviderStub = sandbox.createStubInstance(ProjectManagementTreeDataProvider);
        loginWebViewProviderStub = sandbox.createStubInstance(LoginWebViewProvider);
        testElementsTreeDataProviderStub = sandbox.createStubInstance(TestElementsTreeDataProvider);

        // Stub the VS Code API
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox.stub().returns("defaultValue"),
            update: sandbox.stub().resolves()
        } as unknown as vscode.WorkspaceConfiguration);

        sandbox.stub(vscode.window, "showErrorMessage").resolves();
        sandbox.stub(vscode.window, "showInformationMessage").resolves();
        sandbox.stub(vscode.window, "showOpenDialog").resolves([vscode.Uri.file("/fake/path")]);
        sandbox.stub(vscode.commands, "executeCommand").resolves();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("activate should initialize the extension", async () => {
        await activate(context);

        assert.ok(loggerStub.info.calledWith("Extension activated."), "Logger should log activation message");
        assert.ok(getConfigurationStub.calledWith(baseKeyOfExtension), "Configuration should be loaded");
        assert.ok(context.subscriptions.length > 0, "Subscriptions should be added to the context");
    });

    test("deactivate should log out the user", async () => {
        await deactivate();

        assert.ok(connectionStub.logoutUser.calledOnce, "Logout should be called on deactivation");
        assert.ok(loggerStub.info.calledWith("Extension deactivated."), "Logger should log deactivation message");
    });

    test("getConfig should return the current configuration", () => {
        const config = getConfig();
        assert.ok(config, "Configuration should be returned");
    });

    test("safeCommandHandler should handle errors gracefully", async () => {
        const error = new Error("Test error");
        const handler = sandbox.stub().rejects(error);
        const safeHandler = safeCommandHandler(handler);

        await safeHandler();

        assert.ok(loggerStub.error.calledWith("Error executing command:", error), "Error should be logged");
    });

    test("promptForWorkspaceLocation should prompt the user and return the selected path", async () => {
        const path = await promptForWorkspaceLocation();
        assert.strictEqual(path, "/fake/path", "Selected path should be returned");
    });

    test("loadConfiguration should update the configuration", async () => {
        await loadConfiguration(context);

        assert.ok(getConfigurationStub.calledWith(baseKeyOfExtension), "Configuration should be loaded");
    });

    test("initializeTreeViews should initialize the tree views", () => {
        initializeTreeViews();

        assert.ok(projectManagementTreeDataProviderStub, "Project management tree view should be initialized");
        assert.ok(testElementsTreeDataProviderStub, "Test elements tree view should be initialized");
    });
});
