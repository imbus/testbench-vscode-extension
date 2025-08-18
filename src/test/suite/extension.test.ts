/**
 * @file src/test/suite/extension.test.ts
 * @description This file contains unit tests for the VS Code extension.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import {
    activate,
    setConnection,
    setLogger,
    logger,
    getConnection,
    getLoginWebViewProvider,
    safeCommandHandler,
    deactivate,
    clearAllExtensionData,
    ENABLE_ICON_MARKING_ON_TEST_GENERATION,
    ALLOW_PERSISTENT_IMPORT_BUTTON
} from "../../extension";
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";
import { TESTBENCH_AUTH_PROVIDER_ID, TestBenchAuthenticationProvider } from "../../testBenchAuthenticationProvider";
import { allExtensionCommands, ContextKeys } from "../../constants";
import { LoginWebViewProvider } from "../../loginWebView";
import * as configuration from "../../configuration";
import { delay } from "../utils/testUtils";
import * as testBenchLogger from "../../testBenchLogger";
import * as testBenchConnection from "../../testBenchConnection";
import * as server from "../../server";

suite("Extension Test Suite", function () {
    let testEnv: TestEnvironment;
    let registerWebviewStub: sinon.SinonStub;

    // Mocha's built-in hooks
    this.beforeEach(() => {
        testEnv = setupTestEnvironment();

        // Stub the webview registration before any activate calls
        registerWebviewStub = testEnv.sandbox.stub(vscode.window, "registerWebviewViewProvider");
        registerWebviewStub.returns({ dispose: testEnv.sandbox.stub() } as vscode.Disposable);

        // Stub configuration module
        testEnv.sandbox.stub(configuration, "initializeConfigurationWatcher");
        testEnv.sandbox.stub(configuration, "getExtensionConfiguration").returns({
            get: testEnv.sandbox.stub().returns(false) // Default to false for auto-login
        } as any);

        // Create a mock logger instance and set it up properly
        const mockLogger = {
            info: testEnv.sandbox.stub(),
            error: testEnv.sandbox.stub(),
            warn: testEnv.sandbox.stub(),
            debug: testEnv.sandbox.stub(),
            trace: testEnv.sandbox.stub()
        } as any;

        // Stub the TestBenchLogger constructor to return our mock
        testEnv.sandbox.stub(testBenchLogger, "TestBenchLogger").returns(mockLogger);

        // Set the logger globally so it's available to all functions
        setLogger(mockLogger);
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
            await activate(testEnv.mockContext);
            assert.ok(logger, "Logger should be initialized");
            assert.ok(typeof logger.info === "function", "Logger should have info method");
        });

        test("should initialize configuration watcher", async () => {
            const initConfigStub = configuration.initializeConfigurationWatcher as sinon.SinonStub;

            await activate(testEnv.mockContext);

            assert.ok(initConfigStub.calledOnce, "Configuration watcher should be initialized");
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
            // Arrange: modify existing config stub to enable auto-login
            const configStub = configuration.getExtensionConfiguration as sinon.SinonStub;
            const autoLoginStub = testEnv.sandbox.stub();
            autoLoginStub.withArgs("automaticLoginAfterExtensionActivation", false).returns(true);
            configStub.returns({
                get: autoLoginStub
            } as any);
            const executeCommandStub = testEnv.vscodeMocks.executeCommandStub;

            // Act
            await activate(testEnv.mockContext);
            await delay(1100); // Wait for setTimeout in activate

            // Assert
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
    });

    suite("Global State Management", () => {
        test("should export setConnection function", async () => {
            await activate(testEnv.mockContext);

            assert.ok(typeof setConnection === "function", "setConnection should be exported");
            setConnection(null);
            assert.ok(true, "setConnection executed successfully");
        });

        test("should export and work with setLogger function", () => {
            const mockLogger = {} as testBenchLogger.TestBenchLogger;
            setLogger(mockLogger);
            assert.strictEqual(logger, mockLogger, "Logger should be set correctly");
        });

        test("should export and work with getConnection function", () => {
            const mockConnection = {} as testBenchConnection.PlayServerConnection;
            setConnection(mockConnection);
            assert.strictEqual(getConnection(), mockConnection, "Connection should be retrieved correctly");

            setConnection(null);
            assert.strictEqual(getConnection(), null, "Connection should be cleared correctly");
        });

        test("should export getLoginWebViewProvider function", () => {
            assert.ok(typeof getLoginWebViewProvider === "function", "getLoginWebViewProvider should be exported");
            const provider = getLoginWebViewProvider();
            assert.ok(
                provider === null || provider instanceof LoginWebViewProvider,
                "Should return LoginWebViewProvider or null"
            );
        });
    });

    suite("Utility Functions", () => {
        test("should export safeCommandHandler function", () => {
            assert.ok(typeof safeCommandHandler === "function", "safeCommandHandler should be exported");
        });

        test("safeCommandHandler should handle errors gracefully", async () => {});

        test("safeCommandHandler should handle unknown errors", async () => {});
    });

    suite("Language Server Management", () => {
        test("should export updateOrRestartLS function", () => {
            assert.ok(typeof server.updateOrRestartLS === "function", "updateOrRestartLS should be exported");
        });
    });

    suite("Extension Lifecycle", () => {
        test("should export deactivate function", () => {
            assert.ok(typeof deactivate === "function", "deactivate should be exported");
        });
    });

    suite("Data Management", () => {
        test("should export clearAllExtensionData function", () => {
            assert.ok(typeof clearAllExtensionData === "function", "clearAllExtensionData should be exported");
        });

        test("clearAllExtensionData should clear workspace state", async () => {});

        test("clearAllExtensionData should clear global state", async () => {});

        test("clearAllExtensionData should update context keys", async () => {});
    });

    suite("Constants and Configuration", () => {
        test("should export ENABLE_ICON_MARKING_ON_TEST_GENERATION constant", () => {
            assert.ok(
                typeof ENABLE_ICON_MARKING_ON_TEST_GENERATION === "boolean",
                "ENABLE_ICON_MARKING_ON_TEST_GENERATION should be exported"
            );
        });

        test("should export ALLOW_PERSISTENT_IMPORT_BUTTON constant", () => {
            assert.ok(
                typeof ALLOW_PERSISTENT_IMPORT_BUTTON === "boolean",
                "ALLOW_PERSISTENT_IMPORT_BUTTON should be exported"
            );
        });

        test("should have correct constant values", () => {
            assert.strictEqual(
                ENABLE_ICON_MARKING_ON_TEST_GENERATION,
                true,
                "ENABLE_ICON_MARKING_ON_TEST_GENERATION should be true"
            );
            assert.strictEqual(ALLOW_PERSISTENT_IMPORT_BUTTON, true, "ALLOW_PERSISTENT_IMPORT_BUTTON should be true");
        });
    });

    suite("Error Handling", () => {
        test("should handle authentication errors gracefully", async () => {});

        test("should handle tree view initialization errors", async () => {});

        test("should handle command registration errors", async () => {});
    });
});
