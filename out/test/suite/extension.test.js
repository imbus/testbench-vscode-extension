"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const sinon = __importStar(require("sinon"));
const extension_1 = require("../../extension");
const testBenchLogger_1 = require("../../testBenchLogger");
const testBenchConnection_1 = require("../../testBenchConnection");
const projectManagementTreeView_1 = require("../../projectManagementTreeView");
const testElementsTreeView_1 = require("../../testElementsTreeView");
suite("Extension Test Suite", () => {
    let sandbox;
    let getConfigurationStub;
    let context;
    let loggerStub;
    let connectionStub;
    let projectManagementTreeDataProviderStub;
    let testElementsTreeDataProviderStub;
    setup(() => {
        sandbox = sinon.createSandbox();
        // Stub the VS Code API and assign it to a SinonStub variable
        getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration");
        getConfigurationStub.returns({
            get: sandbox.stub().returns("defaultValue"),
            update: sandbox.stub().resolves()
        });
        // Mock the ExtensionContext
        context = {
            subscriptions: [],
            secrets: {
                get: sandbox.stub().resolves("storedPassword"),
                store: sandbox.stub().resolves(),
                delete: sandbox.stub().resolves()
            }
        };
        // Mock the logger
        loggerStub = sandbox.createStubInstance(testBenchLogger_1.TestBenchLogger);
        // Mock the connection
        connectionStub = sandbox.createStubInstance(testBenchConnection_1.PlayServerConnection);
        // Mock the tree data providers
        projectManagementTreeDataProviderStub = sandbox.createStubInstance(projectManagementTreeView_1.ProjectManagementTreeDataProvider);
        testElementsTreeDataProviderStub = sandbox.createStubInstance(testElementsTreeView_1.TestElementsTreeDataProvider);
        // Stub the VS Code API
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox.stub().returns("defaultValue"),
            update: sandbox.stub().resolves()
        });
        sandbox.stub(vscode.window, "showErrorMessage").resolves();
        sandbox.stub(vscode.window, "showInformationMessage").resolves();
        sandbox.stub(vscode.window, "showOpenDialog").resolves([vscode.Uri.file("/fake/path")]);
        sandbox.stub(vscode.commands, "executeCommand").resolves();
    });
    teardown(() => {
        sandbox.restore();
    });
    test("activate should initialize the extension", async () => {
        await (0, extension_1.activate)(context);
        assert.ok(loggerStub.info.calledWith("Extension activated."), "Logger should log activation message");
        assert.ok(getConfigurationStub.calledWith(extension_1.baseKeyOfExtension), "Configuration should be loaded");
        assert.ok(context.subscriptions.length > 0, "Subscriptions should be added to the context");
    });
    test("deactivate should log out the user", async () => {
        await (0, extension_1.deactivate)();
        assert.ok(connectionStub.logoutUser.calledOnce, "Logout should be called on deactivation");
        assert.ok(loggerStub.info.calledWith("Extension deactivated."), "Logger should log deactivation message");
    });
    test("getConfig should return the current configuration", () => {
        const config = (0, extension_1.getConfig)();
        assert.ok(config, "Configuration should be returned");
    });
    test("safeCommandHandler should handle errors gracefully", async () => {
        const error = new Error("Test error");
        const handler = sandbox.stub().rejects(error);
        const safeHandler = (0, extension_1.safeCommandHandler)(handler);
        await safeHandler();
        assert.ok(loggerStub.error.calledWith("Error executing command:", error), "Error should be logged");
    });
    test("promptForWorkspaceLocation should prompt the user and return the selected path", async () => {
        const path = await (0, extension_1.promptForWorkspaceLocation)();
        assert.strictEqual(path, "/fake/path", "Selected path should be returned");
    });
    test("loadConfiguration should update the configuration", async () => {
        await (0, extension_1.loadConfiguration)(context);
        assert.ok(getConfigurationStub.calledWith(extension_1.baseKeyOfExtension), "Configuration should be loaded");
    });
    test("initializeTreeViews should initialize the tree views", () => {
        (0, extension_1.initializeTreeViews)();
        assert.ok(projectManagementTreeDataProviderStub, "Project management tree view should be initialized");
        assert.ok(testElementsTreeDataProviderStub, "Test elements tree view should be initialized");
    });
});
//# sourceMappingURL=extension.test.js.map