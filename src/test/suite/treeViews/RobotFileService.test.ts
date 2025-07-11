/**
 * @file src/test/suite/treeViews/RobotFileService.test.ts
 * @description Tests for the RobotFileService class
 */

import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as utils from "../../../utils";
import * as configuration from "../../../configuration";
import { RobotFileService } from "../../../treeViews/implementations/testThemes/RobotFileService";
import { TestBenchLogger } from "../../../testBenchLogger";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { TestThemesTreeItem, TestThemeData } from "../../../treeViews/implementations/testThemes/TestThemesTreeItem";

/**
 * Creates a mock TestThemesTreeItem for testing
 */
function createMockTestThemesTreeItem(name: string, numbering: string): TestThemesTreeItem {
    const mockData: TestThemeData = {
        type: "TestThemeNode",
        base: {
            key: "test-key",
            name: name,
            numbering: numbering,
            parentKey: "",
            uniqueID: "test-uid",
            matchesFilter: false
        },
        spec: {
            key: "",
            locker: null,
            status: "None"
        },
        aut: {
            key: "",
            locker: null,
            status: "None"
        },
        filters: [],
        elementType: "TestThemeNode",
        hasChildren: false
    };

    const mockContext = {
        subscriptions: [],
        workspaceState: {
            get: () => undefined,
            update: () => Promise.resolve()
        },
        globalState: {
            get: () => undefined,
            update: () => Promise.resolve()
        }
    } as any;

    return new TestThemesTreeItem(mockData, mockContext);
}

suite("RobotFileService", function () {
    let testEnv: TestEnvironment;
    let robotFileService: RobotFileService;
    let mockLogger: sinon.SinonStubbedInstance<TestBenchLogger>;

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockLogger = testEnv.sandbox.createStubInstance(TestBenchLogger);
        robotFileService = new RobotFileService(mockLogger);
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("checkRobotFileExists", function () {
        test("should return false when workspace location is not available", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves(undefined);

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
        });

        test("should return false when output directory is not configured in extension settings", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(undefined);

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
        });

        test("should return false when robot file does not exist", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").rejects(new Error("File not found"));

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.fileName, "1_Test_Theme.robot");
        });

        test("should return true when robot file exists", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").resolves();
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.fileName, "1_Test_Theme.robot");
            const expectedPath = path.join("/test/workspace", "tests", "1_Test Theme", "1_Test_Theme.robot");
            assert.strictEqual(result.filePath, expectedPath);
        });

        test("should generate robot file name correctly with numbering", async function () {
            const testCases = [
                { name: "Simple Test Theme", numbering: "1", expected: "1_Simple_Test_Theme.robot" },
                { name: "Complex Test Theme", numbering: "2", expected: "2_Complex_Test_Theme.robot" },
                { name: "Test Theme", numbering: "", expected: "Test_Theme.robot" },
                { name: "Test Theme with Spaces", numbering: "3", expected: "3_Test_Theme_with_Spaces.robot" }
            ];

            for (const testCase of testCases) {
                const mockItem = createMockTestThemesTreeItem(testCase.name, testCase.numbering);
                const result = await robotFileService.checkRobotFileExists(mockItem);
                assert.strictEqual(result.fileName, testCase.expected);
            }
        });

        test("should build hierarchical path correctly for test themes", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").resolves();
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            const testThemeItem = createMockTestThemesTreeItem("Test Theme", "1");
            testThemeItem.data.elementType = "TestThemeNode";

            const result = await robotFileService.checkRobotFileExists(testThemeItem);

            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.hierarchicalPath, "1_Test Theme");
            const expectedPath = path.join("/test/workspace", "tests", "1_Test Theme", "1_Test_Theme.robot");
            assert.strictEqual(result.filePath, expectedPath);
        });

        test("should build hierarchical path correctly for test case sets", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").resolves();
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            const parentTheme = createMockTestThemesTreeItem("Parent Theme", "1");
            parentTheme.data.elementType = "TestThemeNode";

            const testCaseSet = createMockTestThemesTreeItem("Child Test Case Set", "2");
            testCaseSet.data.elementType = "TestCaseSetNode";
            testCaseSet.parent = parentTheme;

            const result = await robotFileService.checkRobotFileExists(testCaseSet);

            assert.strictEqual(result.exists, true);
            assert.strictEqual(result.hierarchicalPath, "1_Parent Theme");
            const expectedPath = path.join("/test/workspace", "tests", "1_Parent Theme", "2_Child_Test_Case_Set.robot");
            assert.strictEqual(result.filePath, expectedPath);
        });

        test("should handle file system errors gracefully", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").rejects(new Error("File system error"));

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
        });
    });
});
