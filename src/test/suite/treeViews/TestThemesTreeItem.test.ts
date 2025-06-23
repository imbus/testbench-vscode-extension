/**
 * @file src/test/suite/treeViews/TestThemesTreeItem.test.ts
 * @description Tests for the TestThemesTreeItem class
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { TestThemesTreeItem, TestThemeData } from "../../../treeViews/implementations/testThemes/TestThemesTreeItem";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";

suite("TestThemesTreeItem", function () {
    let testEnv: TestEnvironment;
    let mockContext: vscode.ExtensionContext;

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockContext = testEnv.mockContext;
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    test("should generate different IDs for same item in different contexts", () => {
        // Create test data for the same item in cycle context
        const cycleData: TestThemeData = {
            type: "TestThemeNode",
            base: {
                key: "test-key-123",
                name: "Test Theme",
                numbering: "1.1",
                parentKey: "",
                uniqueID: "uid-123",
                matchesFilter: false
            },
            spec: { key: "", locker: null, status: "None" },
            aut: { key: "", locker: null, status: "None" },
            filters: [],
            elementType: "TestThemeNode",
            hasChildren: false,
            projectKey: "project-1",
            cycleKey: "cycle-1"
        };

        // Create test data for the same item in TOV context
        const tovData: TestThemeData = {
            type: "TestThemeNode",
            base: {
                key: "test-key-123",
                name: "Test Theme",
                numbering: "1.1",
                parentKey: "",
                uniqueID: "uid-123",
                matchesFilter: false
            },
            spec: { key: "", locker: null, status: "None" },
            aut: { key: "", locker: null, status: "None" },
            filters: [],
            elementType: "TestThemeNode",
            hasChildren: false,
            projectKey: "project-1",
            cycleKey: "tov-1"
        };

        const cycleItem = new TestThemesTreeItem(cycleData, mockContext);
        cycleItem.setMetadata("openedFromCycle", true);
        cycleItem.updateId();

        const tovItem = new TestThemesTreeItem(tovData, mockContext);
        tovItem.setMetadata("openedFromCycle", false);
        tovItem.updateId();

        const cycleId = cycleItem.id;
        const tovId = tovItem.id;

        assert.notStrictEqual(cycleId, tovId, "Items from different contexts should have different IDs");

        assert.ok(cycleId && cycleId.includes("cycle:project-1:cycle-1"), "Cycle item ID should contain cycle context");
        assert.ok(tovId && tovId.includes("tov:project-1:tov-1"), "TOV item ID should contain TOV context");
    });

    test("should generate same ID for same item in same context", () => {
        const data: TestThemeData = {
            type: "TestThemeNode",
            base: {
                key: "test-key-123",
                name: "Test Theme",
                numbering: "1.1",
                parentKey: "",
                uniqueID: "uid-123",
                matchesFilter: false
            },
            spec: { key: "", locker: null, status: "None" },
            aut: { key: "", locker: null, status: "None" },
            filters: [],
            elementType: "TestThemeNode",
            hasChildren: false,
            projectKey: "project-1",
            cycleKey: "cycle-1"
        };

        const item1 = new TestThemesTreeItem(data, mockContext);
        const item2 = new TestThemesTreeItem(data, mockContext);

        item1.setMetadata("openedFromCycle", true);
        item1.updateId();
        item2.setMetadata("openedFromCycle", true);
        item2.updateId();

        assert.strictEqual(item1.id, item2.id, "Same items in same context should have same ID");
    });
});
