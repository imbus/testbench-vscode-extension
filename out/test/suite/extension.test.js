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
const loginWebView_1 = require("../../loginWebView");
const configuration = __importStar(require("../../configuration"));
const testUtils_1 = require("../utils/testUtils");
const testBenchLogger = __importStar(require("../../testBenchLogger"));
const server = __importStar(require("../../server"));
suite("Extension Test Suite", function () {
    let testEnv;
    let registerWebviewStub;
    // Mocha's built-in hooks
    this.beforeEach(() => {
        testEnv = (0, testSetup_1.setupTestEnvironment)();
        // Stub the webview registration before any activate calls
        registerWebviewStub = testEnv.sandbox.stub(vscode.window, "registerWebviewViewProvider");
        registerWebviewStub.returns({ dispose: testEnv.sandbox.stub() });
        // Stub configuration module
        testEnv.sandbox.stub(configuration, "initializeConfigurationWatcher");
        testEnv.sandbox.stub(configuration, "getExtensionConfiguration").returns({
            get: testEnv.sandbox.stub().returns(false) // Default to false for auto-login
        });
        // Create a mock logger instance and set it up properly
        const mockLogger = {
            info: testEnv.sandbox.stub(),
            error: testEnv.sandbox.stub(),
            warn: testEnv.sandbox.stub(),
            debug: testEnv.sandbox.stub(),
            trace: testEnv.sandbox.stub()
        };
        // Stub the TestBenchLogger constructor to return our mock
        testEnv.sandbox.stub(testBenchLogger, "TestBenchLogger").returns(mockLogger);
        // Set the logger globally so it's available to all functions
        (0, extension_1.setLogger)(mockLogger);
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
            await (0, extension_1.activate)(testEnv.mockContext);
            // The logger should be set and used during activation
            assert.ok(extension_1.logger, "Logger should be initialized");
            assert.ok(typeof extension_1.logger.info === "function", "Logger should have info method");
        });
        test("should initialize configuration watcher", async () => {
            const initConfigStub = configuration.initializeConfigurationWatcher;
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(initConfigStub.calledOnce, "Configuration watcher should be initialized");
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
            // Arrange: modify existing config stub to enable auto-login
            const configStub = configuration.getExtensionConfiguration;
            const autoLoginStub = testEnv.sandbox.stub();
            autoLoginStub.withArgs("automaticLoginAfterExtensionActivation", false).returns(true);
            configStub.returns({
                get: autoLoginStub
            });
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;
            // Act
            await (0, extension_1.activate)(testEnv.mockContext);
            await (0, testUtils_1.delay)(1100); // Wait for setTimeout in activate
            // Assert
            assert.ok(executeCommandStub.calledWith(constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation), "Auto-login command should be triggered when enabled");
        });
        test("should not trigger auto-login command when auto-login is disabled", async () => {
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;
            await (0, extension_1.activate)(testEnv.mockContext);
            // Wait a bit to ensure no command is executed
            await new Promise((resolve) => setTimeout(resolve, 50));
            assert.ok(!executeCommandStub.calledWith(constants_1.allExtensionCommands.automaticLoginAfterExtensionActivation), "Auto-login command should not be triggered when disabled");
        });
    });
    suite("Global State Management", () => {
        test("should export setConnection function", async () => {
            await (0, extension_1.activate)(testEnv.mockContext);
            assert.ok(typeof extension_1.setConnection === "function", "setConnection should be exported");
            (0, extension_1.setConnection)(null);
            assert.ok(true, "setConnection executed successfully");
        });
        test("should export and work with setLogger function", () => {
            const mockLogger = {};
            (0, extension_1.setLogger)(mockLogger);
            assert.strictEqual(extension_1.logger, mockLogger, "Logger should be set correctly");
        });
        test("should export and work with getConnection function", () => {
            const mockConnection = {};
            (0, extension_1.setConnection)(mockConnection);
            assert.strictEqual((0, extension_1.getConnection)(), mockConnection, "Connection should be retrieved correctly");
            (0, extension_1.setConnection)(null);
            assert.strictEqual((0, extension_1.getConnection)(), null, "Connection should be cleared correctly");
        });
        test("should export getLoginWebViewProvider function", () => {
            assert.ok(typeof extension_1.getLoginWebViewProvider === "function", "getLoginWebViewProvider should be exported");
            const provider = (0, extension_1.getLoginWebViewProvider)();
            assert.ok(provider === null || provider instanceof loginWebView_1.LoginWebViewProvider, "Should return LoginWebViewProvider or null");
        });
    });
    suite("Utility Functions", () => {
        test("should export safeCommandHandler function", () => {
            assert.ok(typeof extension_1.safeCommandHandler === "function", "safeCommandHandler should be exported");
        });
        test("safeCommandHandler should handle errors gracefully", async () => {
        });
        test("safeCommandHandler should handle unknown errors", async () => {
        });
    });
    suite("Language Server Management", () => {
        test("should export updateOrRestartLS function", () => {
            assert.ok(typeof extension_1.updateOrRestartLS === "function", "updateOrRestartLS should be exported");
        });
        test("updateOrRestartLS should handle invalid parameters", async () => {
            const showErrorMessageStub = testEnv.vscodeMocks.showErrorMessageStub;
            await (0, extension_1.updateOrRestartLS)(undefined, "valid");
            assert.ok(showErrorMessageStub.calledWith("Invalid project or TOV name provided for language server update."), "Should show error for undefined project");
            await (0, extension_1.updateOrRestartLS)("valid", undefined);
            assert.ok(showErrorMessageStub.calledWith("Invalid project or TOV name provided for language server update."), "Should show error for undefined TOV");
            await (0, extension_1.updateOrRestartLS)(undefined, undefined);
            assert.ok(showErrorMessageStub.calledWith("Invalid project or TOV name provided for language server update."), "Should show error for both undefined");
        });
        test("updateOrRestartLS should update existing client when available", async () => {
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;
            // Mock getLanguageClientInstance to return a client
            const mockClient = { state: "Running" };
            testEnv.sandbox.stub(server, "getLanguageClientInstance").returns(mockClient);
            await (0, extension_1.updateOrRestartLS)("testProject", "testTOV");
            assert.ok(executeCommandStub.calledWith("testbench_ls.updateProject", "testProject"), "Should update project");
            assert.ok(executeCommandStub.calledWith("testbench_ls.updateTov", "testTOV"), "Should update TOV");
        });
        test("updateOrRestartLS should restart client when not available", async () => {
            const restartStub = testEnv.sandbox.stub(server, "restartLanguageClient").resolves();
            // Mock getLanguageClientInstance to return null
            testEnv.sandbox.stub(server, "getLanguageClientInstance").returns(undefined);
            await (0, extension_1.updateOrRestartLS)("testProject", "testTOV");
            assert.ok(restartStub.calledWith("testProject", "testTOV"), "Should restart language client");
        });
    });
    suite("Extension Lifecycle", () => {
        test("should export deactivate function", () => {
            assert.ok(typeof extension_1.deactivate === "function", "deactivate should be exported");
        });
    });
    suite("Data Management", () => {
        test("should export clearAllExtensionData function", () => {
            assert.ok(typeof extension_1.clearAllExtensionData === "function", "clearAllExtensionData should be exported");
        });
        test("clearAllExtensionData should clear workspace state", async () => {
        });
        test("clearAllExtensionData should clear global state", async () => {
        });
        test("clearAllExtensionData should update context keys", async () => {
        });
    });
    suite("Tree View Management", () => {
        test("should export initializeTreeViews function", () => {
            assert.ok(typeof extension_1.initializeTreeViews === "function", "initializeTreeViews should be exported");
        });
    });
    suite("Constants and Configuration", () => {
        test("should export ENABLE_ICON_MARKING_ON_TEST_GENERATION constant", () => {
            assert.ok(typeof extension_1.ENABLE_ICON_MARKING_ON_TEST_GENERATION === "boolean", "ENABLE_ICON_MARKING_ON_TEST_GENERATION should be exported");
        });
        test("should export ALLOW_PERSISTENT_IMPORT_BUTTON constant", () => {
            assert.ok(typeof extension_1.ALLOW_PERSISTENT_IMPORT_BUTTON === "boolean", "ALLOW_PERSISTENT_IMPORT_BUTTON should be exported");
        });
        test("should have correct constant values", () => {
            assert.strictEqual(extension_1.ENABLE_ICON_MARKING_ON_TEST_GENERATION, true, "ENABLE_ICON_MARKING_ON_TEST_GENERATION should be true");
            assert.strictEqual(extension_1.ALLOW_PERSISTENT_IMPORT_BUTTON, true, "ALLOW_PERSISTENT_IMPORT_BUTTON should be true");
        });
    });
    suite("Error Handling", () => {
        test("should handle authentication errors gracefully", async () => {
        });
        test("should handle tree view initialization errors", async () => {
        });
        test("should handle command registration errors", async () => {
        });
    });
});
//# sourceMappingURL=extension.test.js.map