/**
 * @file src/test/suite/services/treeServiceManager.test.ts
 * @description Tests for the central TreeServiceManager.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { TreeServiceManager, TreeServiceDependencies } from "../../../services/treeServiceManager";
import { MarkedItemStateService } from "../../../views/testTheme/markedItemStateService";

suite("TreeServiceManager Implementation Tests", () => {
    let testEnv: TestEnvironment;
    let dependencies: TreeServiceDependencies;
    let manager: TreeServiceManager;

    // Before each test, set up a fresh environment and a new TreeServiceManager instance
    setup(() => {
        testEnv = setupTestEnvironment();
        dependencies = {
            extensionContext: testEnv.mockContext,
            logger: testEnv.logger,
            getConnection: () => null // Provide a simple function for the getter
        };
        manager = new TreeServiceManager(dependencies);

        // Stub the createTreeView API. The sandbox ensures this is fresh for each test.
        testEnv.sandbox.stub(vscode.window, "createTreeView").returns({
            reveal: sinon.stub(),
            dispose: sinon.stub()
            // Add any other properties your code might access on the TreeView object
        } as any);
    });

    teardown(() => {
        testEnv.sandbox.restore();
    });

    suite("Initialization", () => {
        test("should initialize all core services on initialize()", async () => {
            // Arrange
            // Stub the initialize method on the prototype to verify it gets called.
            const markedItemServiceInitializeStub = testEnv.sandbox
                .stub(MarkedItemStateService.prototype, "initialize")
                .resolves();

            // Act
            await manager.initialize();

            // Assert
            // Use the public getters on the manager to confirm that each service was instantiated.
            assert.ok(manager.projectDataService, "ProjectDataService should be created");
            assert.ok(manager.iconManagementService, "IconManagementService should be created");
            assert.ok(manager.markedItemStateService, "MarkedItemStateService should be created");

            // Verify that the async initialize method on the service was called.
            assert.ok(
                markedItemServiceInitializeStub.calledOnce,
                "MarkedItemStateService.initialize() should be called"
            );
            assert.strictEqual(manager.getInitializationStatus(), true, "Initialization status should be true");
        });
    });
});
