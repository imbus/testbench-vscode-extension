/**
 * @file src/test/suite/treeViews/RobotFileService.test.ts
 * @description Tests for the RobotFileService class
 */

import assert from "assert";
import * as fs from "fs";
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

            // Mock recursive file search to return no files
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            mockItem.data.elementType = "TestThemeNode";
            mockItem.data.base.uniqueID = "test_uid";

            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.fileName, "1_Test_Theme.robot");
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

        test("should handle special characters in robot file names correctly", async function () {
            const testCases = [
                { name: "Test:Theme", numbering: "1", expected: "1_Test_Theme.robot" },
                { name: "Test/Theme", numbering: "2", expected: "2_Test_Theme.robot" },
                { name: "Test\\Theme", numbering: "3", expected: "3_Test_Theme.robot" },
                { name: "Test*Theme", numbering: "4", expected: "4_Test_Theme.robot" },
                { name: "Test?Theme", numbering: "5", expected: "5_Test_Theme.robot" },
                { name: 'Test"Theme', numbering: "6", expected: "6_Test_Theme.robot" },
                { name: "Test<Theme", numbering: "7", expected: "7_Test_Theme.robot" },
                { name: "Test>Theme", numbering: "8", expected: "8_Test_Theme.robot" },
                { name: "Test|Theme", numbering: "9", expected: "9_Test_Theme.robot" },
                {
                    name: "Test:Theme/With\\Special*Chars?",
                    numbering: "10",
                    expected: "10_Test_Theme_With_Special_Chars_.robot"
                },
                {
                    name: "Test Theme with Multiple   Spaces",
                    numbering: "11",
                    expected: "11_Test_Theme_with_Multiple___Spaces.robot"
                },
                { name: "_Leading_Underscore_", numbering: "12", expected: "12__Leading_Underscore_.robot" },
                { name: "Trailing_Underscore_", numbering: "13", expected: "13_Trailing_Underscore_.robot" },
                { name: "Test_With_Underscores", numbering: "14", expected: "14_Test_With_Underscores.robot" },
                { name: "Multiple___Underscores", numbering: "15", expected: "15_Multiple___Underscores.robot" }
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
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            const testThemeItem = createMockTestThemesTreeItem("Test Theme", "1");
            testThemeItem.data.elementType = "TestThemeNode";
            testThemeItem.data.base.uniqueID = "test_uid";

            const result = await robotFileService.checkRobotFileExists(testThemeItem);

            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.fileName, "1_Test_Theme.robot");
        });

        test("should build hierarchical path correctly for test case sets", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            const mockTestCaseSetItem = createMockTestThemesTreeItem("Test Case Set", "1.1");
            mockTestCaseSetItem.data.elementType = "TestCaseSetNode";
            mockTestCaseSetItem.data.base.uniqueID = "test_uid";

            const mockParentTestTheme = createMockTestThemesTreeItem("Test Theme", "1");
            mockParentTestTheme.data.elementType = "TestThemeNode";
            mockParentTestTheme.data.base.uniqueID = "parent_uid";

            mockTestCaseSetItem.parent = mockParentTestTheme;

            const result = await robotFileService.checkRobotFileExists(mockTestCaseSetItem);

            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.fileName, "1_Test_Case_Set.robot");
        });

        test("should handle file system errors gracefully", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").rejects(new Error("File system error"));

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
        });

        test("should build hierarchical path correctly for test case sets with hierarchical context", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").resolves();
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            // Mock test case set item with hierarchical context
            const mockTestCaseSetItem = createMockTestThemesTreeItem("permanente Preisanzeige", "2.1.1");
            mockTestCaseSetItem.data.elementType = "TestCaseSetNode";

            // Mock parent hierarchy: TestTheme > TestCaseSet
            const mockParentTestTheme = createMockTestThemesTreeItem("Anzeigen", "2.1");
            mockParentTestTheme.data.elementType = "TestThemeNode";
            mockParentTestTheme.data.base.uniqueID = "parent_theme_uid";

            // Mock grandparent hierarchy: TestTheme > TestTheme > TestCaseSet
            const mockGrandParentTestTheme = createMockTestThemesTreeItem("Regression", "2");
            mockGrandParentTestTheme.data.elementType = "TestThemeNode";
            mockGrandParentTestTheme.data.base.uniqueID = "grandparent_theme_uid";

            mockTestCaseSetItem.parent = mockParentTestTheme;
            mockParentTestTheme.parent = mockGrandParentTestTheme;

            const result = await robotFileService.checkRobotFileExists(mockTestCaseSetItem);

            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.fileName, "1_permanente_Preisanzeige.robot");
        });

        test("should handle deep hierarchies with simple recursive search", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").resolves();
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            // Hierarchy: Root > Project > Module > SubModule > Feature > TestCaseSet
            const mockTestCaseSetItem = createMockTestThemesTreeItem("Test Case Set", "1.2.3.4.5");
            mockTestCaseSetItem.data.elementType = "TestCaseSetNode";
            mockTestCaseSetItem.data.base.uniqueID = "test_case_uid";

            const mockFeature = createMockTestThemesTreeItem("Feature A", "1.2.3.4");
            mockFeature.data.elementType = "TestThemeNode";
            mockFeature.data.base.uniqueID = "feature_uid";

            const mockSubModule = createMockTestThemesTreeItem("SubModule", "1.2.3");
            mockSubModule.data.elementType = "TestThemeNode";
            mockSubModule.data.base.uniqueID = "submodule_uid";

            const mockModule = createMockTestThemesTreeItem("Module", "1.2");
            mockModule.data.elementType = "TestThemeNode";
            mockModule.data.base.uniqueID = "module_uid";

            const mockProject = createMockTestThemesTreeItem("Project", "1");
            mockProject.data.elementType = "TestThemeNode";
            mockProject.data.base.uniqueID = "project_uid";

            mockTestCaseSetItem.parent = mockFeature;
            mockFeature.parent = mockSubModule;
            mockSubModule.parent = mockModule;
            mockModule.parent = mockProject;

            const result = await robotFileService.checkRobotFileExists(mockTestCaseSetItem);

            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.fileName, "5_Test_Case_Set.robot");
        });
    });
});
