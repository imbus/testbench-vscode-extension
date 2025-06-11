"use strict";
/**
 * @file src/test/suite/extension.test.ts
 * @description This file contains unit tests for the VS Code extension.
 */
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
const extension_1 = require("../../extension");
const testSetup_1 = require("../setup/testSetup");
const testBenchAuthenticationProvider_1 = require("../../testBenchAuthenticationProvider");
const constants_1 = require("../../constants");
const testBenchLogger_1 = require("../../testBenchLogger");
const treeServiceManager_1 = require("../../services/treeServiceManager");
const loginWebView_1 = require("../../loginWebView");
const configuration = __importStar(require("../../configuration"));
suite("Extension Test Suite", () => {
    let testEnv;
    /* eslint-disable @typescript-eslint/no-unused-vars */
    let loggerStub;
    let treeServiceManagerStub;
    let loginWebViewProviderStub;
    setup(() => {
        testEnv = (0, testSetup_1.setupTestEnvironment)();
        // Create stubs
        loggerStub = testEnv.sandbox.createStubInstance(testBenchLogger_1.TestBenchLogger);
        treeServiceManagerStub = testEnv.sandbox.createStubInstance(treeServiceManager_1.TreeServiceManager);
        loginWebViewProviderStub = testEnv.sandbox.createStubInstance(loginWebView_1.LoginWebViewProvider);
        // Stub the TreeServiceManager constructor
        testEnv.sandbox.stub(treeServiceManager_1.TreeServiceManager.prototype, "initialize").resolves();
        testEnv.sandbox.stub(treeServiceManager_1.TreeServiceManager.prototype, "initializeTreeViews").resolves();
        testEnv.sandbox.stub(treeServiceManager_1.TreeServiceManager.prototype, "getProjectManagementProvider").returns({
            refresh: testEnv.sandbox.stub()
        });
        testEnv.sandbox.stub(treeServiceManager_1.TreeServiceManager.prototype, "getTestThemeProvider").returns({
            clearTree: testEnv.sandbox.stub()
        });
        // Stub configuration module
        testEnv.sandbox.stub(configuration, "initializeConfigurationWatcher");
        testEnv.sandbox.stub(configuration, "getExtensionConfiguration").returns({
            get: testEnv.sandbox.stub().returns(false) // Default to false for auto-login
        });
    });
    teardown(() => {
        testEnv.sandbox.restore();
    });
    suite("Activation", () => {
        test("should register the TestBenchAuthenticationProvider on activation", async () => {
            // Arrange:
            // 1. Get the stub for the vscode.authentication.registerAuthenticationProvider function.
            //    This stub was created for us by setupTestEnvironment().
            const registerStub = testEnv.vscodeMocks.registerAuthenticationProviderStub;
            // 2. Ensure the stub has not been called before the test.
            assert.ok(registerStub.notCalled, "Pre-condition failed: registerAuthenticationProvider should not have been called yet");
            // Act:
            // 1. Call the activate function with our mock context.
            await (0, extension_1.activate)(testEnv.mockContext);
            // Assert:
            // 1. Verify that registerAuthenticationProvider was called exactly once.
            assert.ok(registerStub.calledOnce, "registerAuthenticationProvider should have been called once");
            // 2. Get the arguments from the call to inspect them.
            const [id, label, providerInstance] = registerStub.firstCall.args;
            // 3. Verify the provider was registered with the correct ID and label.
            assert.strictEqual(id, testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, "Authentication provider registered with incorrect ID");
            assert.strictEqual(label, "TestBench", "Authentication provider registered with incorrect label");
            // 4. Verify that the object passed as the provider is indeed an instance of our class.
            assert.ok(providerInstance instanceof testBenchAuthenticationProvider_1.TestBenchAuthenticationProvider, "The registered provider is not an instance of TestBenchAuthenticationProvider");
        });
        test("should initialize logger on activation", async () => {
            // Stub the TestBenchLogger constructor
            const loggerConstructorStub = testEnv.sandbox.stub(testBenchLogger_1.TestBenchLogger.prototype, "info");
            await (0, extension_1.activate)(testEnv.mockContext);
            // Verify logger was initialized and used
            assert.ok(loggerConstructorStub.called, "Logger should have been initialized and used");
            assert.ok(loggerConstructorStub.calledWith("Extension activated."), "Logger should log activation message");
        });
        test("should initialize configuration watcher", async () => {
            const initConfigStub = configuration.initializeConfigurationWatcher;
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(initConfigStub.calledOnce, "Configuration watcher should be initialized");
        });
        test("should set up session change listener", async () => {
            const onDidChangeSessionsStub = vscode.authentication.onDidChangeSessions;
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(onDidChangeSessionsStub.calledOnce, "Session change listener should be registered");
            const callback = onDidChangeSessionsStub.firstCall.args[0];
            assert.ok(typeof callback === "function", "Should register a callback function");
            assert.ok(testEnv.mockContext.subscriptions.length > 0, "Session listener disposable should be added to subscriptions");
        });
        test("should initialize TreeServiceManager", async () => {
            const initializeStub = treeServiceManager_1.TreeServiceManager.prototype.initialize;
            const initTreeViewsStub = treeServiceManager_1.TreeServiceManager.prototype.initializeTreeViews;
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(initializeStub.calledOnce, "TreeServiceManager should be initialized");
            assert.ok(initTreeViewsStub.calledOnce, "Tree views should be initialized");
        });
        test("should set initial connection context states", async () => {
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;
            await (0, extension_1.activate)(testEnv.mockContext);
            // Check that connection context was set to false (no connection initially)
            assert.ok(executeCommandStub.calledWith("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, false), "Should set connection active context to false");
            assert.ok(executeCommandStub.calledWith("setContext", constants_1.ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false), "Should set project tree custom root context to false");
            assert.ok(executeCommandStub.calledWith("setContext", constants_1.ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false), "Should set theme tree custom root context to false");
        });
        test("should register login webview provider", async () => {
            const registerWebviewStub = testEnv.sandbox.stub(vscode.window, "registerWebviewViewProvider");
            const disposable = { dispose: testEnv.sandbox.stub() };
            registerWebviewStub.returns(disposable);
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(registerWebviewStub.calledOnce, "Webview provider should be registered");
            const [viewId, provider] = registerWebviewStub.firstCall.args;
            assert.strictEqual(viewId, loginWebView_1.LoginWebViewProvider.viewId, "Webview registered with correct view ID");
            assert.ok(provider instanceof loginWebView_1.LoginWebViewProvider, "Provider should be LoginWebViewProvider instance");
        });
        test("should register all extension commands", async () => {
            const registerCommandStub = testEnv.vscodeMocks.registerCommandStub;
            await (0, extension_1.activate)(testEnv.mockContext);
            // Check that key commands are registered
            const registeredCommands = registerCommandStub.getCalls().map((call) => call.args[0]);
            assert.ok(registeredCommands.includes(constants_1.allExtensionCommands.login), "Login command should be registered");
            assert.ok(registeredCommands.includes(constants_1.allExtensionCommands.logout), "Logout command should be registered");
            assert.ok(registeredCommands.includes(constants_1.allExtensionCommands.showExtensionSettings), "Settings command should be registered");
            assert.ok(registeredCommands.includes(constants_1.allExtensionCommands.refreshProjectTreeView), "Refresh project command should be registered");
            assert.ok(registeredCommands.includes(constants_1.allExtensionCommands.displayAllProjects), "Display projects command should be registered");
        });
        test("should trigger auto-login command when auto-login is enabled", async () => {
            // Configure auto-login to be enabled
            const getConfigStub = configuration.getExtensionConfiguration;
            getConfigStub.returns({
                get: testEnv.sandbox.stub().withArgs(constants_1.ConfigKeys.AUTO_LOGIN, false).returns(true)
            });
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;
            await (0, extension_1.activate)(testEnv.mockContext);
            // Give time for async command execution
            await new Promise((resolve) => setTimeout(resolve, 10));
            assert.ok(executeCommandStub.calledWith(constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation), "Auto-login command should be triggered when enabled");
        });
        test("should not trigger auto-login command when auto-login is disabled", async () => {
            // Configure auto-login to be disabled (default in our setup)
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;
            await (0, extension_1.activate)(testEnv.mockContext);
            // Give time for async command execution
            await new Promise((resolve) => setTimeout(resolve, 10));
            assert.ok(!executeCommandStub.calledWith(constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation), "Auto-login command should not be triggered when disabled");
        });
        test("should handle TreeServiceManager initialization failure gracefully", async () => {
            const initializeStub = treeServiceManager_1.TreeServiceManager.prototype.initialize;
            initializeStub.rejects(new Error("Service initialization failed"));
            const showErrorStub = testEnv.vscodeMocks.showErrorMessageStub;
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(showErrorStub.calledWith("TestBench Extension critical services failed to initialize. Some features may be unavailable."), "Should show error message when TreeServiceManager fails to initialize");
        });
    });
    suite("Global State Management", () => {
        test("should export setLogger function that updates global logger", async () => {
            const newLogger = testEnv.sandbox.createStubInstance(testBenchLogger_1.TestBenchLogger);
            await (0, extension_1.activate)(testEnv.mockContext);
            // Verify setLogger is exported and functional
            assert.ok(typeof extension_1.setLogger === "function", "setLogger should be exported");
            (0, extension_1.setLogger)(newLogger);
        });
        test("should export setConnection function", async () => {
            await (0, extension_1.activate)(testEnv.mockContext);
            // Verify setConnection is exported and functional
            assert.ok(typeof extension_1.setConnection === "function", "setConnection should be exported");
            (0, extension_1.setConnection)(null);
        });
    });
});
//# sourceMappingURL=extension.test.js.map