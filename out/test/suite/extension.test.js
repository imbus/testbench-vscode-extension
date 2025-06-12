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
suite("Extension Test Suite", function () {
    let testEnv;
    let registerWebviewStub;
    // Mocha's built-in hooks
    this.beforeEach(() => {
        testEnv = (0, testSetup_1.setupTestEnvironment)();
        // Stub the webview registration before any activate calls
        registerWebviewStub = testEnv.sandbox.stub(vscode.window, "registerWebviewViewProvider");
        registerWebviewStub.returns({ dispose: testEnv.sandbox.stub() });
        // Create stubs for TreeServiceManager
        testEnv.sandbox.stub(treeServiceManager_1.TreeServiceManager.prototype, "initialize").resolves();
        testEnv.sandbox.stub(treeServiceManager_1.TreeServiceManager.prototype, "initializeTreeViews").resolves();
        testEnv.sandbox.stub(treeServiceManager_1.TreeServiceManager.prototype, "getInitializationStatus").returns(true);
        testEnv.sandbox.stub(treeServiceManager_1.TreeServiceManager.prototype, "dispose");
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
        // Stub the logger constructor to prevent console output during tests
        testEnv.sandbox.stub(testBenchLogger_1.TestBenchLogger.prototype, "info");
        testEnv.sandbox.stub(testBenchLogger_1.TestBenchLogger.prototype, "error");
        testEnv.sandbox.stub(testBenchLogger_1.TestBenchLogger.prototype, "warn");
        testEnv.sandbox.stub(testBenchLogger_1.TestBenchLogger.prototype, "debug");
        testEnv.sandbox.stub(testBenchLogger_1.TestBenchLogger.prototype, "trace");
    });
    this.afterEach(() => {
        testEnv.sandbox.restore();
    });
    suite("Activation", () => {
        test("should register the TestBenchAuthenticationProvider on activation", async () => {
            const registerStub = testEnv.vscodeMocks.registerAuthenticationProviderStub;
            assert.ok(registerStub.notCalled, "Pre-condition failed: registerAuthenticationProvider should not have been called yet");
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(registerStub.calledOnce, "registerAuthenticationProvider should have been called once");
            const [id, label, providerInstance] = registerStub.firstCall.args;
            assert.strictEqual(id, testBenchAuthenticationProvider_1.TESTBENCH_AUTH_PROVIDER_ID, "Authentication provider registered with incorrect ID");
            assert.strictEqual(label, "TestBench", "Authentication provider registered with incorrect label");
            assert.ok(providerInstance instanceof testBenchAuthenticationProvider_1.TestBenchAuthenticationProvider, "The registered provider is not an instance of TestBenchAuthenticationProvider");
        });
        test("should initialize logger on activation", async () => {
            const loggerInfoStub = testBenchLogger_1.TestBenchLogger.prototype.info;
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(loggerInfoStub.called, "Logger should have been initialized and used");
            assert.ok(loggerInfoStub.calledWith("Extension activated."), "Logger should log activation message");
        });
        test("should initialize configuration watcher", async () => {
            const initConfigStub = configuration.initializeConfigurationWatcher;
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(initConfigStub.calledOnce, "Configuration watcher should be initialized");
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
            assert.ok(executeCommandStub.calledWith("setContext", constants_1.ContextKeys.CONNECTION_ACTIVE, false), "Should set connection active context to false");
            assert.ok(executeCommandStub.calledWith("setContext", constants_1.ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false), "Should set project tree custom root context to false");
            assert.ok(executeCommandStub.calledWith("setContext", constants_1.ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false), "Should set theme tree custom root context to false");
        });
        test("should register login webview provider", async () => {
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(registerWebviewStub.calledOnce, "Webview provider should be registered");
            const [viewId, provider] = registerWebviewStub.firstCall.args;
            assert.strictEqual(viewId, loginWebView_1.LoginWebViewProvider.viewId, "Webview registered with correct view ID");
            assert.ok(provider instanceof loginWebView_1.LoginWebViewProvider, "Provider should be LoginWebViewProvider instance");
        });
        test("should register all extension commands", async () => {
            const registerCommandStub = testEnv.vscodeMocks.registerCommandStub;
            await (0, extension_1.activate)(testEnv.mockContext);
            const registeredCommands = registerCommandStub.getCalls().map((call) => call.args[0]);
            assert.ok(registeredCommands.includes(constants_1.allExtensionCommands.login), "Login command should be registered");
            assert.ok(registeredCommands.includes(constants_1.allExtensionCommands.logout), "Logout command should be registered");
            assert.ok(registeredCommands.includes(constants_1.allExtensionCommands.showExtensionSettings), "Settings command should be registered");
            assert.ok(registeredCommands.includes(constants_1.allExtensionCommands.refreshProjectTreeView), "Refresh project command should be registered");
            assert.ok(registeredCommands.includes(constants_1.allExtensionCommands.displayAllProjects), "Display projects command should be registered");
        });
        test("should trigger auto-login command when auto-login is enabled", async () => {
            const getConfigStub = configuration.getExtensionConfiguration;
            getConfigStub.returns({
                get: testEnv.sandbox.stub().withArgs(constants_1.ConfigKeys.AUTO_LOGIN, false).returns(true)
            });
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;
            await (0, extension_1.activate)(testEnv.mockContext);
            // Wait a bit for the command to be executed
            await new Promise((resolve) => setTimeout(resolve, 50));
            assert.ok(executeCommandStub.calledWith(constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation), "Auto-login command should be triggered when enabled");
        });
        test("should not trigger auto-login command when auto-login is disabled", async () => {
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;
            await (0, extension_1.activate)(testEnv.mockContext);
            // Wait a bit to ensure no command is executed
            await new Promise((resolve) => setTimeout(resolve, 50));
            assert.ok(!executeCommandStub.calledWith(constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation), "Auto-login command should not be triggered when disabled");
        });
        test("should handle TreeServiceManager initialization failure gracefully", async () => {
            // Override the stub for this specific test
            const initStub = treeServiceManager_1.TreeServiceManager.prototype.initialize;
            initStub.rejects(new Error("Service initialization failed"));
            const showErrorStub = testEnv.vscodeMocks.showErrorMessageStub;
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(showErrorStub.calledWith("TestBench Extension critical services failed to initialize. Some features may be unavailable."), "Should show error message when TreeServiceManager fails to initialize");
        });
    });
    suite("Global State Management", () => {
        test("should export setConnection function", async () => {
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(typeof extension_1.setConnection === "function", "setConnection should be exported");
            (0, extension_1.setConnection)(null);
            assert.ok(true, "setConnection executed successfully");
        });
    });
});
//# sourceMappingURL=extension.test.js.map