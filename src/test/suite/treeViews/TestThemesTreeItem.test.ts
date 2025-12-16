/**
 * @file src/test/suite/treeViews/TestThemesTreeItem.test.ts
 * @description Tests for the TestThemesTreeItem class
 */

import assert from "assert";
import * as vscode from "vscode";
import { TestThemesTreeItem, TestThemeData } from "../../../treeViews/implementations/testThemes/TestThemesTreeItem";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { UserSessionManager } from "../../../userSessionManager";
import * as extension from "../../../extension";

suite("TestThemesTreeItem", function () {
    let testEnv: TestEnvironment;
    let mockContext: vscode.ExtensionContext;
    let userSessionManager: UserSessionManager;

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockContext = testEnv.mockContext;
        userSessionManager = new UserSessionManager(mockContext);
        testEnv.sandbox.stub(userSessionManager, "getCurrentUserId").returns("test-user-id");
        (extension as any).userSessionManager = userSessionManager;
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
            tovKey: "tov-1"
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
        assert.ok(
            cycleId && cycleId.includes("cycle:project-1:unknown-tov:cycle-1"),
            "Cycle item ID should contain cycle context"
        );
        assert.ok(tovId && tovId.includes("tov:project-1:tov-1:tov-1"), "TOV item ID should contain TOV context");
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

    suite("Language Server Parameter Extraction", () => {
        test("should return project and TOV names for test theme items with proper hierarchy", () => {
            // Create project parent (grandparent of test theme)
            const projectData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "project-key",
                    name: "Test Project",
                    numbering: "",
                    parentKey: "",
                    uniqueID: "project-uid",
                    matchesFilter: false
                },
                spec: { key: "", locker: null, status: "None" },
                aut: { key: "", locker: null, status: "None" },
                filters: [],
                elementType: "ProjectNode",
                hasChildren: true,
                projectKey: "project-1"
            };

            // Create TOV parent (parent of test theme)
            const tovData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "tov-key",
                    name: "Test TOV",
                    numbering: "",
                    parentKey: "project-key",
                    uniqueID: "tov-uid",
                    matchesFilter: false
                },
                spec: { key: "", locker: null, status: "None" },
                aut: { key: "", locker: null, status: "None" },
                filters: [],
                elementType: "TOVNode",
                hasChildren: true,
                projectKey: "project-1",
                cycleKey: "tov-1"
            };

            // Create test theme item
            const testThemeData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "theme-key",
                    name: "Test Theme",
                    numbering: "1.1",
                    parentKey: "tov-key",
                    uniqueID: "theme-uid",
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

            const project = new TestThemesTreeItem(projectData, mockContext);
            const tov = new TestThemesTreeItem(tovData, mockContext, project);
            const testTheme = new TestThemesTreeItem(testThemeData, mockContext, tov);

            const params = testTheme.getLanguageServerParameters();

            assert.deepStrictEqual(params, {
                projectName: "Test Project",
                tovName: "Test TOV"
            });
        });

        test("should return undefined for test theme items without proper parent hierarchy", () => {
            const testThemeData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "theme-key",
                    name: "Test Theme",
                    numbering: "1.1",
                    parentKey: "",
                    uniqueID: "theme-uid",
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

            const testTheme = new TestThemesTreeItem(testThemeData, mockContext);
            const params = testTheme.getLanguageServerParameters();

            assert.strictEqual(params, undefined);
        });

        test("should return undefined for test theme items with only one parent level", () => {
            // Create TOV parent but no grandparent (project)
            const tovData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "tov-key",
                    name: "Test TOV",
                    numbering: "",
                    parentKey: "",
                    uniqueID: "tov-uid",
                    matchesFilter: false
                },
                spec: { key: "", locker: null, status: "None" },
                aut: { key: "", locker: null, status: "None" },
                filters: [],
                elementType: "TOVNode",
                hasChildren: true,
                projectKey: "project-1",
                cycleKey: "tov-1"
            };

            const testThemeData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "theme-key",
                    name: "Test Theme",
                    numbering: "1.1",
                    parentKey: "tov-key",
                    uniqueID: "theme-uid",
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

            const tov = new TestThemesTreeItem(tovData, mockContext);
            const testTheme = new TestThemesTreeItem(testThemeData, mockContext, tov);

            const params = testTheme.getLanguageServerParameters();

            assert.strictEqual(params, undefined);
        });

        test("should handle missing labels gracefully", () => {
            // Create project parent with undefined label
            const projectData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "project-key",
                    name: "", // Empty name which will result in undefined label
                    numbering: "",
                    parentKey: "",
                    uniqueID: "project-uid",
                    matchesFilter: false
                },
                spec: { key: "", locker: null, status: "None" },
                aut: { key: "", locker: null, status: "None" },
                filters: [],
                elementType: "ProjectNode",
                hasChildren: true,
                projectKey: "project-1"
            };

            const tovData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "tov-key",
                    name: "Test TOV",
                    numbering: "",
                    parentKey: "project-key",
                    uniqueID: "tov-uid",
                    matchesFilter: false
                },
                spec: { key: "", locker: null, status: "None" },
                aut: { key: "", locker: null, status: "None" },
                filters: [],
                elementType: "TOVNode",
                hasChildren: true,
                projectKey: "project-1",
                cycleKey: "tov-1"
            };

            const testThemeData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "theme-key",
                    name: "Test Theme",
                    numbering: "1.1",
                    parentKey: "tov-key",
                    uniqueID: "theme-uid",
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

            const project = new TestThemesTreeItem(projectData, mockContext);
            const tov = new TestThemesTreeItem(tovData, mockContext, project);
            const testTheme = new TestThemesTreeItem(testThemeData, mockContext, tov);

            // Simulating missing labels
            (project as any).label = undefined;

            const params = testTheme.getLanguageServerParameters();

            assert.strictEqual(params, undefined);
        });

        test("should work for test case set items with proper hierarchy", () => {
            const projectData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "project-key",
                    name: "Test Project",
                    numbering: "",
                    parentKey: "",
                    uniqueID: "project-uid",
                    matchesFilter: false
                },
                spec: { key: "", locker: null, status: "None" },
                aut: { key: "", locker: null, status: "None" },
                filters: [],
                elementType: "ProjectNode",
                hasChildren: true,
                projectKey: "project-1"
            };

            const tovData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "tov-key",
                    name: "Test TOV",
                    numbering: "",
                    parentKey: "project-key",
                    uniqueID: "tov-uid",
                    matchesFilter: false
                },
                spec: { key: "", locker: null, status: "None" },
                aut: { key: "", locker: null, status: "None" },
                filters: [],
                elementType: "TOVNode",
                hasChildren: true,
                projectKey: "project-1",
                cycleKey: "tov-1"
            };

            const testCaseSetData: TestThemeData = {
                type: "TestCaseSetNode",
                base: {
                    key: "tcs-key",
                    name: "Test Case Set",
                    numbering: "1.1.1",
                    parentKey: "tov-key",
                    uniqueID: "tcs-uid",
                    matchesFilter: false
                },
                spec: { key: "", locker: null, status: "None" },
                aut: { key: "", locker: null, status: "None" },
                filters: [],
                elementType: "TestCaseSetNode",
                hasChildren: false,
                projectKey: "project-1",
                cycleKey: "tov-1"
            };

            const project = new TestThemesTreeItem(projectData, mockContext);
            const tov = new TestThemesTreeItem(tovData, mockContext, project);
            const testCaseSet = new TestThemesTreeItem(testCaseSetData, mockContext, tov);

            const params = testCaseSet.getLanguageServerParameters();

            assert.deepStrictEqual(params, {
                projectName: "Test Project",
                tovName: "Test TOV"
            });
        });
    });

    suite("Command Functionality", function () {
        test("should set command property for test case set items", function () {
            const testCaseSetData: TestThemeData = {
                type: "TestCaseSetNode",
                base: {
                    key: "test-case-set-123",
                    name: "Test Case Set",
                    numbering: "1.1",
                    parentKey: "",
                    uniqueID: "uid-123",
                    matchesFilter: false
                },
                spec: { key: "", locker: null, status: "None" },
                aut: { key: "", locker: null, status: "None" },
                filters: [],
                elementType: "TestCaseSetNode",
                hasChildren: false,
                projectKey: "project-1",
                cycleKey: "cycle-1"
            };

            const item = new TestThemesTreeItem(testCaseSetData, mockContext);

            assert(item.command, "Test case set item should have a command property");
            assert.strictEqual(
                item.command?.command,
                "testbenchExtension.checkForTestCaseSetDoubleClick",
                "Command should be set to checkForTestCaseSetDoubleClick"
            );
            assert.strictEqual(item.command?.title, "Open Robot File", "Command title should be 'Open Robot File'");
            assert.deepStrictEqual(item.command?.arguments, [item], "Command arguments should include the item itself");
        });

        test("should not set command property for non-test case set items", function () {
            const testThemeData: TestThemeData = {
                type: "TestThemeNode",
                base: {
                    key: "test-theme-123",
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

            const item = new TestThemesTreeItem(testThemeData, mockContext);

            assert(!item.command, "Non-test case set items should not have a command property");
        });
    });
});
