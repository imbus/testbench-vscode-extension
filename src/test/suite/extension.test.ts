/**
 * @file src/test/suite/extension.test.ts
 * @description This file contains unit tests for the VS Code extension.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { activate, setLogger, setConnection } from "../../extension";
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";
import { TESTBENCH_AUTH_PROVIDER_ID, TestBenchAuthenticationProvider } from "../../testBenchAuthenticationProvider";
import { allExtensionCommands, ConfigKeys, ContextKeys } from "../../constants";
import { TestBenchLogger } from "../../testBenchLogger";
import { TreeServiceManager } from "../../services/treeServiceManager";
import { LoginWebViewProvider } from "../../loginWebView";
import * as configuration from "../../configuration";

suite("Extension Test Suite", () => {
    let testEnv: TestEnvironment;
    /* eslint-disable @typescript-eslint/no-unused-vars */
    let loggerStub: sinon.SinonStubbedInstance<TestBenchLogger>;
    let treeServiceManagerStub: sinon.SinonStubbedInstance<TreeServiceManager>;
    let loginWebViewProviderStub: sinon.SinonStubbedInstance<LoginWebViewProvider>;

    setup(() => {
        testEnv = setupTestEnvironment();

        // Create stubs
        loggerStub = testEnv.sandbox.createStubInstance(TestBenchLogger);
        treeServiceManagerStub = testEnv.sandbox.createStubInstance(TreeServiceManager);
        loginWebViewProviderStub = testEnv.sandbox.createStubInstance(LoginWebViewProvider);

        // Stub the TreeServiceManager constructor
        testEnv.sandbox.stub(TreeServiceManager.prototype, "initialize").resolves();
        testEnv.sandbox.stub(TreeServiceManager.prototype, "initializeTreeViews").resolves();
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
            assert.ok(
                registerStub.notCalled,
                "Pre-condition failed: registerAuthenticationProvider should not have been called yet"
            );

            // Act:
            // 1. Call the activate function with our mock context.
            await activate(testEnv.mockContext);

            // Assert:
            // 1. Verify that registerAuthenticationProvider was called exactly once.
            assert.ok(registerStub.calledOnce, "registerAuthenticationProvider should have been called once");

            // 2. Get the arguments from the call to inspect them.
            const [id, label, providerInstance] = registerStub.firstCall.args;

            // 3. Verify the provider was registered with the correct ID and label.
            assert.strictEqual(id, TESTBENCH_AUTH_PROVIDER_ID, "Authentication provider registered with incorrect ID");
            assert.strictEqual(label, "TestBench", "Authentication provider registered with incorrect label");

            // 4. Verify that the object passed as the provider is indeed an instance of our class.
            assert.ok(
                providerInstance instanceof TestBenchAuthenticationProvider,
                "The registered provider is not an instance of TestBenchAuthenticationProvider"
            );
        });

        test("should initialize logger on activation", async () => {
            // Stub the TestBenchLogger constructor
            const loggerConstructorStub = testEnv.sandbox.stub(TestBenchLogger.prototype, "info");

            await activate(testEnv.mockContext);

            // Verify logger was initialized and used
            assert.ok(loggerConstructorStub.called, "Logger should have been initialized and used");
            assert.ok(loggerConstructorStub.calledWith("Extension activated."), "Logger should log activation message");
        });

        test("should initialize configuration watcher", async () => {
            const initConfigStub = configuration.initializeConfigurationWatcher as sinon.SinonStub;

            await activate(testEnv.mockContext);

            assert.ok(initConfigStub.calledOnce, "Configuration watcher should be initialized");
        });

        test("should set up session change listener", async () => {
            const onDidChangeSessionsStub = vscode.authentication.onDidChangeSessions as sinon.SinonStub;
            await activate(testEnv.mockContext);

            assert.ok(onDidChangeSessionsStub.calledOnce, "Session change listener should be registered");

            const callback = onDidChangeSessionsStub.firstCall.args[0];
            assert.ok(typeof callback === "function", "Should register a callback function");

            assert.ok(
                testEnv.mockContext.subscriptions.length > 0,
                "Session listener disposable should be added to subscriptions"
            );
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

            // Check that connection context was set to false (no connection initially)
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
            const registerWebviewStub = testEnv.sandbox.stub(vscode.window, "registerWebviewViewProvider");
            const disposable = { dispose: testEnv.sandbox.stub() };
            registerWebviewStub.returns(disposable as vscode.Disposable);

            await activate(testEnv.mockContext);

            assert.ok(registerWebviewStub.calledOnce, "Webview provider should be registered");
            const [viewId, provider] = registerWebviewStub.firstCall.args;
            assert.strictEqual(viewId, LoginWebViewProvider.viewId, "Webview registered with correct view ID");
            assert.ok(provider instanceof LoginWebViewProvider, "Provider should be LoginWebViewProvider instance");
        });

        test("should register all extension commands", async () => {
            const registerCommandStub = testEnv.vscodeMocks.registerCommandStub;

            await activate(testEnv.mockContext);

            // Check that key commands are registered
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
            // Configure auto-login to be enabled
            const getConfigStub = configuration.getExtensionConfiguration as sinon.SinonStub;
            getConfigStub.returns({
                get: testEnv.sandbox.stub().withArgs(ConfigKeys.AUTO_LOGIN, false).returns(true)
            } as any);

            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;

            await activate(testEnv.mockContext);

            // Give time for async command execution
            await new Promise((resolve) => setTimeout(resolve, 10));

            assert.ok(
                executeCommandStub.calledWith(allExtensionCommands.automaticLoginAfterExtensionActivation),
                "Auto-login command should be triggered when enabled"
            );
        });

        test("should not trigger auto-login command when auto-login is disabled", async () => {
            // Configure auto-login to be disabled (default in our setup)
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;

            await activate(testEnv.mockContext);

            // Give time for async command execution
            await new Promise((resolve) => setTimeout(resolve, 10));

            assert.ok(
                !executeCommandStub.calledWith(allExtensionCommands.automaticLoginAfterExtensionActivation),
                "Auto-login command should not be triggered when disabled"
            );
        });

        test("should handle TreeServiceManager initialization failure gracefully", async () => {
            const initializeStub = TreeServiceManager.prototype.initialize as sinon.SinonStub;
            initializeStub.rejects(new Error("Service initialization failed"));

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
        test("should export setLogger function that updates global logger", async () => {
            const newLogger = testEnv.sandbox.createStubInstance(TestBenchLogger);

            await activate(testEnv.mockContext);

            // Verify setLogger is exported and functional
            assert.ok(typeof setLogger === "function", "setLogger should be exported");
            setLogger(newLogger);
        });

        test("should export setConnection function", async () => {
            await activate(testEnv.mockContext);

            // Verify setConnection is exported and functional
            assert.ok(typeof setConnection === "function", "setConnection should be exported");
            setConnection(null);
        });
    });
});
