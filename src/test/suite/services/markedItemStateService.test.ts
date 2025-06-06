/**
 * @file src/test/suite/services/markedItemStateService.test.ts
 * @description Tests for MarkedItemStateService.
 */

import * as assert from "assert";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { MarkedItemStateService } from "../../../views/testTheme/markedItemStateService";

suite("MarkedItemStateService Tests", () => {
    let testEnv: TestEnvironment;
    let service: MarkedItemStateService;

    // Common data for tests
    const testData = {
        projectKey: "proj1",
        cycleKey: "cycle1",
        rootKey: "item_root",
        rootUID: "uid_root",
        descendantUIDs: ["uid_child1", "uid_child2"],
        descendantKeysWithUIDs: [
            ["key_child1", "uid_child1"],
            ["key_child2", "uid_child2"]
        ] as [string, string][]
    };

    setup(() => {
        testEnv = setupTestEnvironment();
        service = new MarkedItemStateService(testEnv.mockContext, testEnv.logger);
    });

    teardown(() => {
        testEnv.sandbox.restore();
    });

    test("should correctly mark an item and trigger a state save", async () => {
        // Arrange
        // Spy on the private _saveState method to ensure it's called.
        const saveStateSpy = testEnv.sandbox.spy(service as any, "_saveState");

        // Act
        await service.markItem(
            testData.rootKey,
            testData.rootUID,
            testData.projectKey,
            testData.cycleKey,
            "TestThemeNode",
            true,
            testData.descendantUIDs,
            testData.descendantKeysWithUIDs
        );

        // Assert
        const activeItem = service.getActiveMarkedItemInfo();
        assert.ok(activeItem, "An active item should be set");
        assert.strictEqual(activeItem?.key, testData.rootKey, "The correct item key should be stored");
        assert.strictEqual(activeItem?.uniqueID, testData.rootUID, "The correct item UID should be stored");
        assert.ok(saveStateSpy.calledOnce, "_saveState should be called to persist the new state");
    });

    test("getItemImportState should return true for the directly marked root item", async () => {
        // Arrange
        await service.markItem(
            testData.rootKey,
            testData.rootUID,
            testData.projectKey,
            testData.cycleKey,
            "TestThemeNode",
            true,
            [],
            []
        );

        // Act
        const state = service.getItemImportState(
            testData.rootKey,
            testData.rootUID,
            testData.projectKey,
            testData.cycleKey
        );

        // Assert
        assert.strictEqual(state.shouldShow, true, "The root item itself should be marked for import");
    });

    test("getItemImportState should return true for a descendant of the marked item", async () => {
        // Arrange
        await service.markItem(
            testData.rootKey,
            testData.rootUID,
            testData.projectKey,
            testData.cycleKey,
            "TestThemeNode",
            true,
            testData.descendantUIDs,
            testData.descendantKeysWithUIDs
        );

        // Act
        // Check the state of one of the descendants
        const state = service.getItemImportState("key_child1", "uid_child1", testData.projectKey, testData.cycleKey);

        // Assert
        assert.strictEqual(state.shouldShow, true, "A descendant item should be marked for import");
    });

    test("getItemImportState should return false for an unrelated item", async () => {
        // Arrange
        await service.markItem(
            testData.rootKey,
            testData.rootUID,
            testData.projectKey,
            testData.cycleKey,
            "TestThemeNode",
            true,
            [],
            []
        );

        // Act
        // Check an item that is not the root and not in the descendant list
        const state = service.getItemImportState(
            "unrelated_key",
            "unrelated_uid",
            testData.projectKey,
            testData.cycleKey
        );

        // Assert
        assert.strictEqual(state.shouldShow, false, "An unrelated item should not be marked for import");
    });

    test("clearMarking should reset all state", async () => {
        // Arrange
        await service.markItem(
            testData.rootKey,
            testData.rootUID,
            testData.projectKey,
            testData.cycleKey,
            "TestThemeNode",
            true,
            [],
            []
        );
        assert.ok(service.getActiveMarkedItemInfo(), "Pre-condition: An item should be marked");

        const saveStateSpy = testEnv.sandbox.spy(service as any, "_saveState");

        // Act
        await service.clearMarking();

        // Assert
        assert.strictEqual(service.getActiveMarkedItemInfo(), null, "Active marked item should be null after clearing");
        const state = service.getItemImportState(
            testData.rootKey,
            testData.rootUID,
            testData.projectKey,
            testData.cycleKey
        );
        assert.strictEqual(state.shouldShow, false, "Previously marked item should no longer be marked");
        assert.ok(saveStateSpy.calledOnce, "_saveState should be called to persist the cleared state");
    });
});
