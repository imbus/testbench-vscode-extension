/**
 * @file src/test/suite/stateManagement/treeViewStateManager.test.ts
 * @description This file contains unit tests for the TreeViewStateManager class.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { TreeViewStateManager } from "../../../views/common/treeViewStateManager";
import { TreeViewType, TreeViewEmptyState, TreeViewStateConfig } from "../../../views/common/treeViewStateTypes";
import { testElementsTreeViewID, testThemeTreeViewID } from "../../../constants";

suite("TreeViewStateManager Tests", () => {
    let testEnv: TestEnvironment;
    let updateMessageCallback: sinon.SinonStub;

    setup(() => {
        testEnv = setupTestEnvironment();
        // Create a simple stub to act as the callback that updates the tree view's message.
        updateMessageCallback = testEnv.sandbox.stub();
    });

    teardown(() => {
        testEnv.sandbox.restore();
    });

    test("should generate a specific 'no data source' message when set to empty", () => {
        // Arrange
        const config: TreeViewStateConfig = {
            treeViewId: testThemeTreeViewID,
            treeViewType: TreeViewType.TEST_THEME,
            noDataSourceMessage: "Please select a cycle to begin." // Custom message
        };
        const manager = new TreeViewStateManager(testEnv.logger, config, updateMessageCallback);
        updateMessageCallback.resetHistory(); // Ignore the initial 'loading' message call

        // Act
        manager.setEmpty(TreeViewEmptyState.NO_DATA_SOURCE);

        // Assert
        assert.ok(updateMessageCallback.calledOnce, "Callback should be called when state is set to empty");
        const message = updateMessageCallback.firstCall.args[0];
        assert.strictEqual(
            message,
            "Please select a cycle to begin.",
            "Should use the custom 'no data source' message from config"
        );
    });

    test("should generate a formatted error message when set to an error state", () => {
        // Arrange
        const config: TreeViewStateConfig = {
            treeViewId: testElementsTreeViewID,
            treeViewType: TreeViewType.TEST_ELEMENTS
        };
        const manager = new TreeViewStateManager(testEnv.logger, config, updateMessageCallback);
        const mockError = new Error("API request timed out");
        manager.setDataSource("tov_123", "TOV 123", "My TOV"); // Set a data source for the message template
        updateMessageCallback.resetHistory();

        // Act
        manager.setError(mockError, TreeViewEmptyState.FETCH_ERROR);

        // Assert
        assert.ok(updateMessageCallback.calledOnce, "Callback should be called when state is set to error");
        const message = updateMessageCallback.firstCall.args[0];
        // Use assert.match to check that the message contains the key parts, as the exact format might change.
        assert.match(
            message,
            /Error fetching test elements for "My TOV"/,
            "Message should mention the action and data source"
        );
        assert.match(message, /API request timed out/, "Message should include the specific error text");
    });
});
