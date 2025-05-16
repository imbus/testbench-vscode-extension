import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { activate, getConfig, loadConfiguration, initializeTreeViews } from "../../extension";
import { TestBenchLogger } from "../../testBenchLogger";
import { ProjectManagementTreeDataProvider } from "../../projectManagementTreeView";
import { TestElementsTreeDataProvider } from "../../testElementsTreeView";
import { baseKeyOfExtension } from "../../constants";

suite("Extension Test Suite", () => {
    let sandbox: sinon.SinonSandbox;
    let getConfigurationStub: sinon.SinonStub;
    let context: vscode.ExtensionContext;
    let loggerStub: sinon.SinonStubbedInstance<TestBenchLogger>;
    let projectManagementTreeDataProviderStub: sinon.SinonStubbedInstance<ProjectManagementTreeDataProvider>;
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

        // Mock the tree data providers
        projectManagementTreeDataProviderStub = sandbox.createStubInstance(ProjectManagementTreeDataProvider);
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

    test("getConfig should return the current configuration", () => {
        const config = getConfig();
        assert.ok(config, "Configuration should be returned");
    });

    test("loadConfiguration should update the configuration", async () => {
        await loadConfiguration(context);

        assert.ok(getConfigurationStub.calledWith(baseKeyOfExtension), "Configuration should be loaded");
    });

    test("initializeTreeViews should initialize the tree views", () => {
        initializeTreeViews(context);

        assert.ok(projectManagementTreeDataProviderStub, "Project management tree view should be initialized");
        assert.ok(testElementsTreeDataProviderStub, "Test elements tree view should be initialized");
    });
});
