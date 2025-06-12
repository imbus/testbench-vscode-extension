/**
 * @file src/test/suite/extension.test.ts
 * @description This file contains unit tests for the VS Code extension.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { activate, setConnection } from "../../extension";
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";
import { TESTBENCH_AUTH_PROVIDER_ID, TestBenchAuthenticationProvider } from "../../testBenchAuthenticationProvider";
import { allExtensionCommands, ConfigKeys, ContextKeys } from "../../constants";
import { TestBenchLogger } from "../../testBenchLogger";
import { TreeServiceManager } from "../../services/treeServiceManager";
import { LoginWebViewProvider } from "../../loginWebView";
import * as configuration from "../../configuration";

suite("Extension Test Suite", function () {
    let testEnv: TestEnvironment;
    let registerWebviewStub: sinon.SinonStub;

    // Mocha's built-in hooks
    this.beforeEach(() => {
        testEnv = setupTestEnvironment();

        // Stub the webview registration before any activate calls
        registerWebviewStub = testEnv.sandbox.stub(vscode.window, "registerWebviewViewProvider");
        registerWebviewStub.returns({ dispose: testEnv.sandbox.stub() } as vscode.Disposable);

        // Create stubs for TreeServiceManager
        testEnv.sandbox.stub(TreeServiceManager.prototype, "initialize").resolves();
        testEnv.sandbox.stub(TreeServiceManager.prototype, "initializeTreeViews").resolves();
        testEnv.sandbox.stub(TreeServiceManager.prototype, "getInitializationStatus").returns(true);
        testEnv.sandbox.stub(TreeServiceManager.prototype, "dispose");

        testEnv.sandbox.stub(TreeServiceManager.prototype, "getProjectManagementProvider").returns({
            refresh: testEnv.sandbox.stub()
        } as any);
        testEnv.sandbox.stub(TreeServiceManager.prototype, "getTestThemeProvider").returns({
            clearTree: testEnv.sandbox.stub()
        } as any);

        // Stub configuration module
        testEnv.sandbox.stub(configuration, "initializeConfigurationWatcher");
        testEnv.sandbox.stub(configuration, "getExtensionConfiguration").returns({
            get: testEnv.sandbox.stub().returns(false) // Default to false for auto-login
        } as any);

        // Stub the logger constructor to prevent console output during tests
        testEnv.sandbox.stub(TestBenchLogger.prototype, "info");
        testEnv.sandbox.stub(TestBenchLogger.prototype, "error");
        testEnv.sandbox.stub(TestBenchLogger.prototype, "warn");
        testEnv.sandbox.stub(TestBenchLogger.prototype, "debug");
        testEnv.sandbox.stub(TestBenchLogger.prototype, "trace");
    });

    this.afterEach(() => {
        testEnv.sandbox.restore();
    });

    suite("Activation", () => {
        test("should register the TestBenchAuthenticationProvider on activation", async () => {
            const registerStub = testEnv.vscodeMocks.registerAuthenticationProviderStub;

            assert.ok(
                registerStub.notCalled,
                "Pre-condition failed: registerAuthenticationProvider should not have been called yet"
            );

            await activate(testEnv.mockContext);
            assert.ok(registerStub.calledOnce, "registerAuthenticationProvider should have been called once");

            const [id, label, providerInstance] = registerStub.firstCall.args;
            assert.strictEqual(id, TESTBENCH_AUTH_PROVIDER_ID, "Authentication provider registered with incorrect ID");
            assert.strictEqual(label, "TestBench", "Authentication provider registered with incorrect label");
            assert.ok(
                providerInstance instanceof TestBenchAuthenticationProvider,
                "The registered provider is not an instance of TestBenchAuthenticationProvider"
            );
        });

        test("should initialize logger on activation", async () => {
            const loggerInfoStub = TestBenchLogger.prototype.info as sinon.SinonStub;

            await activate(testEnv.mockContext);

            assert.ok(loggerInfoStub.called, "Logger should have been initialized and used");
            assert.ok(loggerInfoStub.calledWith("Extension activated."), "Logger should log activation message");
        });

        test("should initialize configuration watcher", async () => {
            const initConfigStub = configuration.initializeConfigurationWatcher as sinon.SinonStub;

            await activate(testEnv.mockContext);

            assert.ok(initConfigStub.calledOnce, "Configuration watcher should be initialized");
        });

        test("should initialize TreeServiceManager", async () => {
            const initializeStub = TreeServiceManager.prototype.initialize as sinon.SinonStub;
            const initTreeViewsStub = TreeServiceManager.prototype.initializeTreeViews as sinon.SinonStub;

            await activate(testEnv.mockContext);

            assert.ok(initializeStub.calledOnce, "TreeServiceManager should be initialized");
            assert.ok(initTreeViewsStub.calledOnce, "Tree views should be initialized");
        });

        test("should set initial connection context states", async () => {
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;

            await activate(testEnv.mockContext);

            assert.ok(
                executeCommandStub.calledWith("setContext", ContextKeys.CONNECTION_ACTIVE, false),
                "Should set connection active context to false"
            );
            assert.ok(
                executeCommandStub.calledWith("setContext", ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false),
                "Should set project tree custom root context to false"
            );
            assert.ok(
                executeCommandStub.calledWith("setContext", ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false),
                "Should set theme tree custom root context to false"
            );
        });

        test("should register login webview provider", async () => {
            await activate(testEnv.mockContext);

            assert.ok(registerWebviewStub.calledOnce, "Webview provider should be registered");
            const [viewId, provider] = registerWebviewStub.firstCall.args;
            assert.strictEqual(viewId, LoginWebViewProvider.viewId, "Webview registered with correct view ID");
            assert.ok(provider instanceof LoginWebViewProvider, "Provider should be LoginWebViewProvider instance");
        });

        test("should register all extension commands", async () => {
            const registerCommandStub = testEnv.vscodeMocks.registerCommandStub;

            await activate(testEnv.mockContext);

            const registeredCommands = registerCommandStub.getCalls().map((call) => call.args[0]);
            assert.ok(registeredCommands.includes(allExtensionCommands.login), "Login command should be registered");
            assert.ok(registeredCommands.includes(allExtensionCommands.logout), "Logout command should be registered");
            assert.ok(
                registeredCommands.includes(allExtensionCommands.showExtensionSettings),
                "Settings command should be registered"
            );
            assert.ok(
                registeredCommands.includes(allExtensionCommands.refreshProjectTreeView),
                "Refresh project command should be registered"
            );
            assert.ok(
                registeredCommands.includes(allExtensionCommands.displayAllProjects),
                "Display projects command should be registered"
            );
        });

        test("should trigger auto-login command when auto-login is enabled", async () => {
            const getConfigStub = configuration.getExtensionConfiguration as sinon.SinonStub;
            getConfigStub.returns({
                get: testEnv.sandbox.stub().withArgs(ConfigKeys.AUTO_LOGIN, false).returns(true)
            } as any);

            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;

            await activate(testEnv.mockContext);

            // Wait a bit for the command to be executed
            await new Promise((resolve) => setTimeout(resolve, 50));

            assert.ok(
                executeCommandStub.calledWith(allExtensionCommands.automaticLoginAfterExtensionActivation),
                "Auto-login command should be triggered when enabled"
            );
        });

        test("should not trigger auto-login command when auto-login is disabled", async () => {
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;

            await activate(testEnv.mockContext);

            // Wait a bit to ensure no command is executed
            await new Promise((resolve) => setTimeout(resolve, 50));

            assert.ok(
                !executeCommandStub.calledWith(allExtensionCommands.automaticLoginAfterExtensionActivation),
                "Auto-login command should not be triggered when disabled"
            );
        });

        test("should handle TreeServiceManager initialization failure gracefully", async () => {
            // Override the stub for this specific test
            const initStub = TreeServiceManager.prototype.initialize as sinon.SinonStub;
            initStub.rejects(new Error("Service initialization failed"));

            const showErrorStub = testEnv.vscodeMocks.showErrorMessageStub;

            await activate(testEnv.mockContext);

            assert.ok(
                showErrorStub.calledWith(
                    "TestBench Extension critical services failed to initialize. Some features may be unavailable."
                ),
                "Should show error message when TreeServiceManager fails to initialize"
            );
        });
    });

    suite("Global State Management", () => {
        test("should export setConnection function", async () => {
            await activate(testEnv.mockContext);

            assert.ok(typeof setConnection === "function", "setConnection should be exported");
            setConnection(null);
            assert.ok(true, "setConnection executed successfully");
        });
    });
});
