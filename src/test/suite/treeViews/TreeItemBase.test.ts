/**
 * @file src/test/suite/treeViews/TreeItemBase.test.ts
 * @description Unit tests for the TreeItemBase class
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { TreeItemBase } from "../../../treeViews/core/TreeItemBase";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";

// Concrete implementation for testing
class TestTreeItem extends TreeItemBase {
    constructor(
        label: string,
        description: string | undefined,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        extensionContext: vscode.ExtensionContext,
        parent?: TreeItemBase
    ) {
        super(label, description, contextValue, collapsibleState, extensionContext, parent);
    }

    protected generateUniqueId(): string {
        return `test-item-${Date.now()}-${Math.random()}`;
    }

    public clone(): TreeItemBase {
        return new TestTreeItem(
            this.label as string,
            this.description as string | undefined,
            this.contextValue || "",
            this.collapsibleState,
            this.extensionContext,
            this.parent === null ? undefined : this.parent
        );
    }

    public serialize(): any {
        return {
            label: this.label,
            description: this.description,
            contextValue: this.contextValue,
            collapsibleState: this.collapsibleState,
            metadata: Array.from(this._metadata.entries())
        };
    }
}

suite("TreeItemBase", function () {
    let testEnv: TestEnvironment;
    let mockContext: vscode.ExtensionContext;

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockContext = testEnv.mockContext;
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("Constructor and Basic Properties", () => {
        test("should create tree item with correct properties", () => {
            const item = new TestTreeItem(
                "Test Item",
                "Test Description",
                "testContext",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );

            assert.strictEqual(item.label, "Test Item");
            assert.strictEqual(item.description, "Test Description");
            assert.strictEqual(item.contextValue, "testContext");
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            assert.strictEqual(item.originalContextValue, "testContext");
            assert.strictEqual(item.disposed, false);
        });

        test("should set parent when provided", () => {
            const parent = new TestTreeItem(
                "Parent",
                undefined,
                "parent",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child = new TestTreeItem(
                "Child",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext,
                parent
            );

            assert.strictEqual(child.parent, parent);
        });
    });

    suite("Metadata Management", () => {
        test("should set and get metadata", () => {
            const item = new TestTreeItem("Test", undefined, "test", vscode.TreeItemCollapsibleState.None, mockContext);

            item.setMetadata("key1", "value1");
            item.setMetadata("key2", { nested: "value2" });

            assert.strictEqual(item.getMetadata("key1"), "value1");
            assert.deepStrictEqual(item.getMetadata("key2"), { nested: "value2" });
        });

        test("should check if metadata exists", () => {
            const item = new TestTreeItem("Test", undefined, "test", vscode.TreeItemCollapsibleState.None, mockContext);

            assert.strictEqual(item.hasMetadata("key1"), false);

            item.setMetadata("key1", "value1");
            assert.strictEqual(item.hasMetadata("key1"), true);
        });

        test("should clear metadata", () => {
            const item = new TestTreeItem("Test", undefined, "test", vscode.TreeItemCollapsibleState.None, mockContext);

            item.setMetadata("key1", "value1");
            item.setMetadata("key2", "value2");

            assert.strictEqual(item.hasMetadata("key1"), true);
            assert.strictEqual(item.hasMetadata("key2"), true);

            item.clearMetadata();

            assert.strictEqual(item.hasMetadata("key1"), false);
            assert.strictEqual(item.hasMetadata("key2"), false);
        });
    });

    suite("Tree Navigation", () => {
        test("should get ancestors", () => {
            const root = new TestTreeItem(
                "Root",
                undefined,
                "root",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child = new TestTreeItem(
                "Child",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext,
                root
            );
            const grandchild = new TestTreeItem(
                "Grandchild",
                undefined,
                "grandchild",
                vscode.TreeItemCollapsibleState.None,
                mockContext,
                child
            );

            const ancestors = grandchild.getAncestors();
            assert.strictEqual(ancestors.length, 2);
            assert.strictEqual(ancestors[0], child);
            assert.strictEqual(ancestors[1], root);
        });

        test("should get depth", () => {
            const root = new TestTreeItem(
                "Root",
                undefined,
                "root",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child = new TestTreeItem(
                "Child",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext,
                root
            );
            const grandchild = new TestTreeItem(
                "Grandchild",
                undefined,
                "grandchild",
                vscode.TreeItemCollapsibleState.None,
                mockContext,
                child
            );

            assert.strictEqual(root.getDepth(), 0);
            assert.strictEqual(child.getDepth(), 1);
            assert.strictEqual(grandchild.getDepth(), 2);
        });

        test("should get root", () => {
            const root = new TestTreeItem(
                "Root",
                undefined,
                "root",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child = new TestTreeItem(
                "Child",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext,
                root
            );
            const grandchild = new TestTreeItem(
                "Grandchild",
                undefined,
                "grandchild",
                vscode.TreeItemCollapsibleState.None,
                mockContext,
                child
            );

            assert.strictEqual(root.getRoot(), root);
            assert.strictEqual(child.getRoot(), root);
            assert.strictEqual(grandchild.getRoot(), root);
        });
    });

    suite("Child Management", () => {
        test("should add child", () => {
            const parent = new TestTreeItem(
                "Parent",
                undefined,
                "parent",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child = new TestTreeItem(
                "Child",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );

            parent.addChild(child);

            assert.strictEqual(parent.children.length, 1);
            assert.strictEqual(parent.children[0], child);
            assert.strictEqual(child.parent, parent);
        });

        test("should not add duplicate child", () => {
            const parent = new TestTreeItem(
                "Parent",
                undefined,
                "parent",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child = new TestTreeItem(
                "Child",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );

            parent.addChild(child);
            parent.addChild(child); // Try to add again

            assert.strictEqual(parent.children.length, 1);
        });

        test("should remove child", () => {
            const parent = new TestTreeItem(
                "Parent",
                undefined,
                "parent",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child = new TestTreeItem(
                "Child",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );

            parent.addChild(child);
            const removed = parent.removeChild(child);

            assert.strictEqual(removed, true);
            assert.strictEqual(parent.children.length, 0);
            assert.strictEqual(child.parent, null);
        });

        test("should return false when removing non-existent child", () => {
            const parent = new TestTreeItem(
                "Parent",
                undefined,
                "parent",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child = new TestTreeItem(
                "Child",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );

            const removed = parent.removeChild(child);

            assert.strictEqual(removed, false);
        });

        test("should remove all children", () => {
            const parent = new TestTreeItem(
                "Parent",
                undefined,
                "parent",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child1 = new TestTreeItem(
                "Child1",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            const child2 = new TestTreeItem(
                "Child2",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );

            parent.addChild(child1);
            parent.addChild(child2);
            parent.removeAllChildren();

            assert.strictEqual(parent.children.length, 0);
            assert.strictEqual(child1.parent, null);
            assert.strictEqual(child2.parent, null);
        });

        test("should sort children", () => {
            const parent = new TestTreeItem(
                "Parent",
                undefined,
                "parent",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child1 = new TestTreeItem(
                "Child1",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            const child2 = new TestTreeItem(
                "Child2",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );
            const child3 = new TestTreeItem(
                "Child3",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );

            parent.addChild(child3);
            parent.addChild(child1);
            parent.addChild(child2);

            parent.sortChildren((a, b) => (a.label as string).localeCompare(b.label as string));

            assert.strictEqual(parent.children[0], child1);
            assert.strictEqual(parent.children[1], child2);
            assert.strictEqual(parent.children[2], child3);
        });
    });

    suite("Context Value Management", () => {
        test("should update context value by adding suffix", () => {
            const item = new TestTreeItem("Test", undefined, "base", vscode.TreeItemCollapsibleState.None, mockContext);

            item.updateContextValue("marked", true);
            assert.strictEqual(item.contextValue, "base.marked");
        });

        test("should update context value when no existing context", () => {
            const item = new TestTreeItem("Test", undefined, "", vscode.TreeItemCollapsibleState.None, mockContext);

            item.updateContextValue("marked", true);
            assert.strictEqual(item.contextValue, "marked");
        });

        test("should not add duplicate suffix", () => {
            const item = new TestTreeItem(
                "Test",
                undefined,
                "base.marked",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );

            item.updateContextValue("marked", true);
            assert.strictEqual(item.contextValue, "base.marked");
        });

        test("should remove context value suffix", () => {
            const item = new TestTreeItem(
                "Test",
                undefined,
                "base.marked",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );

            item.updateContextValue("marked", false);
            assert.strictEqual(item.contextValue, "base");
        });
    });

    suite("Lifecycle", () => {
        test("should dispose correctly", () => {
            const parent = new TestTreeItem(
                "Parent",
                undefined,
                "parent",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child = new TestTreeItem(
                "Child",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );

            parent.addChild(child);
            parent.setMetadata("key", "value");

            parent.dispose();

            assert.strictEqual(parent.disposed, true);
            assert.strictEqual(parent.children.length, 0);
            assert.strictEqual(parent.parent, null);
            assert.strictEqual(parent.hasMetadata("key"), false);
        });

        test("should not dispose twice", () => {
            const item = new TestTreeItem("Test", undefined, "test", vscode.TreeItemCollapsibleState.None, mockContext);

            item.dispose();
            const disposed1 = item.disposed;

            item.dispose(); // Try to dispose again
            const disposed2 = item.disposed;

            assert.strictEqual(disposed1, true);
            assert.strictEqual(disposed2, true);
        });

        test("should dispose children when parent is disposed", () => {
            const parent = new TestTreeItem(
                "Parent",
                undefined,
                "parent",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            const child = new TestTreeItem(
                "Child",
                undefined,
                "child",
                vscode.TreeItemCollapsibleState.None,
                mockContext
            );

            parent.addChild(child);
            parent.dispose();

            assert.strictEqual(child.disposed, true);
        });
    });

    suite("Serialization", () => {
        test("should serialize correctly", () => {
            const item = new TestTreeItem(
                "Test",
                "Description",
                "context",
                vscode.TreeItemCollapsibleState.Collapsed,
                mockContext
            );
            item.setMetadata("key", "value");

            const serialized = item.serialize();

            assert.strictEqual(serialized.label, "Test");
            assert.strictEqual(serialized.description, "Description");
            assert.strictEqual(serialized.contextValue, "context");
            assert.strictEqual(serialized.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            assert.deepStrictEqual(serialized.metadata, [["key", "value"]]);
        });

        test("should deserialize correctly", () => {
            const data = {
                label: "Test",
                description: "Description",
                contextValue: "context",
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                metadata: [["key", "value"]]
            };

            const item = TestTreeItem.deserialize(
                data,
                mockContext,
                (d) => new TestTreeItem(d.label, d.description, d.contextValue, d.collapsibleState, mockContext)
            );

            assert.strictEqual(item.label, "Test");
            assert.strictEqual(item.description, "Description");
            assert.strictEqual(item.contextValue, "context");
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            assert.strictEqual(item.getMetadata("key"), "value");
        });
    });
});
