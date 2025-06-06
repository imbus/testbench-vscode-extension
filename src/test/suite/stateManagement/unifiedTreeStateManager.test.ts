/**
 * @file src/test/suite/stateManagement/unifiedTreeStateManager.test.ts
 * @description Tests for the UnifiedTreeStateManager.
 */

import * as assert from "assert";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { UnifiedTreeStateManager } from "../../../views/common/unifiedTreeStateManager";
import { BaseTreeItem } from "../../../views/common/baseTreeItem";
import { TreeViewOperationalState, TreeViewType } from "../../../views/common/treeViewStateTypes";
import { MarkdownString } from "vscode";

// A concrete implementation of BaseTreeItem for testing purposes
class TestTreeItem extends BaseTreeItem {
    // Implement the required methods for BaseTreeItem
    protected buildTooltipContent(): string | MarkdownString {
        throw new Error("Method not implemented.");
    }
    protected getIconCategory(): string {
        throw new Error("Method not implemented.");
    }
}

suite("UnifiedTreeStateManager Tests", () => {
    let testEnv: TestEnvironment;
    let manager: UnifiedTreeStateManager<TestTreeItem>;

    setup(() => {
        testEnv = setupTestEnvironment();

        // Instantiate the manager we want to test
        manager = new UnifiedTreeStateManager<TestTreeItem>(
            testEnv.logger,
            {
                treeViewId: "testTree",
                treeViewType: TreeViewType.PROJECT_MANAGEMENT
            },
            testEnv.sandbox.stub(), // Mock callback for messages
            "testTree.hasCustomRoot",
            "customRoot.test"
        );
    });

    teardown(() => {
        testEnv.sandbox.restore();
    });

    test("should initialize with a default loading state", () => {
        // Arrange & Act
        // Get the state immediately after construction
        const initialState = manager.getCurrentUnifiedState();

        // Assert
        // Verify that the initial combined state is correct
        assert.strictEqual(
            initialState.operationalState,
            TreeViewOperationalState.LOADING,
            "Should be in LOADING state initially"
        );
        assert.strictEqual(initialState.isCustomRootActive, false, "Custom root should not be active initially");
        assert.strictEqual(initialState.itemsAfterFiltering, 0, "Item count should be zero initially");
    });
});
