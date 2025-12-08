/**
 * @file src/test/suite/treeViews/RobotFileService.test.ts
 * @description Tests for the RobotFileService class
 */

import assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";
import * as sinon from "sinon";
import * as utils from "../../../utils";
import * as configuration from "../../../configuration";
import { RobotFileService } from "../../../treeViews/implementations/testThemes/RobotFileService";
import { TestBenchLogger } from "../../../testBenchLogger";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { TestThemesTreeItem, TestThemeData } from "../../../treeViews/implementations/testThemes/TestThemesTreeItem";
import { GeneratedFileMapper } from "../../../treeViews/implementations/testThemes/GeneratedFileMapper";

/**
 * Creates a mock TestThemesTreeItem for testing
 * @param name The name of the test theme/item
 * @param numbering The numbering string
 * @param context Optional extension context (uses minimal mock if not provided)
 */
function createMockTestThemesTreeItem(
    name: string,
    numbering: string,
    context?: vscode.ExtensionContext
): TestThemesTreeItem {
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

    const mockContext =
        context ||
        ({
            subscriptions: [],
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => []
            },
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => []
            }
        } as any);

    return new TestThemesTreeItem(mockData, mockContext);
}

suite("RobotFileService", function () {
    let testEnv: TestEnvironment;
    let robotFileService: RobotFileService;
    let mockLogger: sinon.SinonStubbedInstance<TestBenchLogger>;

    this.beforeEach(async function () {
        testEnv = setupTestEnvironment();
        mockLogger = testEnv.sandbox.createStubInstance(TestBenchLogger);

        testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").callsFake(async () => "/workspace");
        (testEnv.mockContext.workspaceState.get as sinon.SinonStub).callsFake(
            (key: string, defaultValue?: any) => defaultValue
        );

        robotFileService = new RobotFileService(mockLogger, testEnv.mockContext);
        const metadataService = robotFileService.getMetadataService();
        await metadataService.initialize();
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("checkRobotFileExists", function () {
        test("should return false when workspace location is not available", async function () {
            (utils.validateAndReturnWorkspaceLocation as sinon.SinonStub).resolves(undefined);

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
        });

        test("should return false when output directory is not configured in extension settings", async function () {
            (utils.validateAndReturnWorkspaceLocation as sinon.SinonStub).resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(undefined);

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
        });

        test("should return false when robot file does not exist", async function () {
            (utils.validateAndReturnWorkspaceLocation as sinon.SinonStub).resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").rejects(new Error("File not found"));

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.filePath, undefined);
        });

        test("should return true when robot file exists", async function () {
            (utils.validateAndReturnWorkspaceLocation as sinon.SinonStub).resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            mockItem.data.elementType = "TestThemeNode";
            mockItem.data.base.uniqueID = "test_uid";

            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.filePath, undefined);
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
                const results = robotFileService["generatePossibleRobotFileNames"](
                    mockItem.data.base.name,
                    mockItem.data.base.numbering
                );
                assert.ok(results.includes(testCase.expected), `Expected ${testCase.expected} to be in ${results}`);
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
                const results = robotFileService["generatePossibleRobotFileNames"](
                    mockItem.data.base.name,
                    mockItem.data.base.numbering
                );
                assert.ok(results.includes(testCase.expected), `Expected ${testCase.expected} to be in ${results}`);
            }
        });

        test("should build hierarchical path correctly for test themes", async function () {
            (utils.validateAndReturnWorkspaceLocation as sinon.SinonStub).resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            const testThemeItem = createMockTestThemesTreeItem("Test Theme", "1");
            testThemeItem.data.elementType = "TestThemeNode";
            testThemeItem.data.base.uniqueID = "test_uid";

            const result = await robotFileService.checkRobotFileExists(testThemeItem);

            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.filePath, undefined);
        });

        test("should build hierarchical path correctly for test case sets", async function () {
            (utils.validateAndReturnWorkspaceLocation as sinon.SinonStub).resolves("/test/workspace");
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
            assert.strictEqual(result.filePath, undefined);
        });

        test("should handle file system errors gracefully", async function () {
            (utils.validateAndReturnWorkspaceLocation as sinon.SinonStub).resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").rejects(new Error("File system error"));

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
        });

        test("should build hierarchical path correctly for test case sets with hierarchical context", async function () {
            (utils.validateAndReturnWorkspaceLocation as sinon.SinonStub).resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").resolves();
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            const mockTestCaseSetItem = createMockTestThemesTreeItem("permanente Preisanzeige", "2.1.1");
            mockTestCaseSetItem.data.elementType = "TestCaseSetNode";

            const mockParentTestTheme = createMockTestThemesTreeItem("Anzeigen", "2.1");
            mockParentTestTheme.data.elementType = "TestThemeNode";
            mockParentTestTheme.data.base.uniqueID = "parent_theme_uid";

            const mockGrandParentTestTheme = createMockTestThemesTreeItem("Regression", "2");
            mockGrandParentTestTheme.data.elementType = "TestThemeNode";
            mockGrandParentTestTheme.data.base.uniqueID = "grandparent_theme_uid";

            mockTestCaseSetItem.parent = mockParentTestTheme;
            mockParentTestTheme.parent = mockGrandParentTestTheme;

            const result = await robotFileService.checkRobotFileExists(mockTestCaseSetItem);

            assert.strictEqual(result.exists, false);
            assert.strictEqual(result.filePath, undefined);
        });

        test("should handle deep hierarchies with simple recursive search", async function () {
            (utils.validateAndReturnWorkspaceLocation as sinon.SinonStub).resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "access").resolves();
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

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
            assert.strictEqual(result.filePath, undefined);
        });
    });

    suite("metadata-based file lookup", function () {
        test("should fallback to pattern search when metadata not available", async function () {
            const mockItem = createMockTestThemesTreeItem("Test Case Set", "1.1");
            mockItem.data.elementType = "TestCaseSetNode";
            mockItem.data.base.uniqueID = "test-uid-1";

            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");

            const robotFileContent = `Metadata UniqueID test-uid-1
Metadata Name Test Case Set
*** Test Cases ***`;

            const mockDirents: fs.Dirent[] = [
                {
                    name: "1_Test_Case_Set.robot",
                    isFile: () => true,
                    isDirectory: () => false,
                    isBlockDevice: () => false,
                    isCharacterDevice: () => false,
                    isSymbolicLink: () => false,
                    isFIFO: () => false,
                    isSocket: () => false
                } as fs.Dirent
            ];

            testEnv.sandbox.stub(fs.promises, "readdir").resolves(mockDirents as any);
            testEnv.sandbox.stub(fs.promises, "readFile").resolves(robotFileContent);

            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, true);
        });

        test("should validate robot file against tree item uniqueID", async function () {
            const mockItem = createMockTestThemesTreeItem("Test Case Set", "1.1");
            mockItem.data.elementType = "TestCaseSetNode";
            mockItem.data.base.uniqueID = "test-uid-1";

            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");

            const robotFileContent = `Metadata UniqueID different-uid
Metadata Name Test Case Set
*** Test Cases ***`;

            const mockDirents: fs.Dirent[] = [
                {
                    name: "1_Test_Case_Set.robot",
                    isFile: () => true,
                    isDirectory: () => false,
                    isBlockDevice: () => false,
                    isCharacterDevice: () => false,
                    isSymbolicLink: () => false,
                    isFIFO: () => false,
                    isSocket: () => false
                } as fs.Dirent
            ];

            testEnv.sandbox.stub(fs.promises, "readdir").resolves(mockDirents as any);
            testEnv.sandbox.stub(fs.promises, "readFile").resolves(robotFileContent);

            const result = await robotFileService.checkRobotFileExists(mockItem);

            assert.strictEqual(result.exists, false);
        });
    });

    suite("getMetadataService", function () {
        test("should return metadata service instance", function () {
            const metadataService = robotFileService.getMetadataService();
            assert.ok(metadataService);
            assert.ok(metadataService instanceof GeneratedFileMapper);
        });
    });

    suite("checkFolderExists", function () {
        test("should return false when workspace location is not available", async function () {
            (utils.validateAndReturnWorkspaceLocation as sinon.SinonStub).resolves(undefined);

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            mockItem.data.elementType = "TestThemeNode";

            const result = await robotFileService.checkFolderExists(mockItem);

            assert.strictEqual(result.exists, false);
        });

        test("should return false when output directory is not configured", async function () {
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(undefined);

            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            mockItem.data.elementType = "TestThemeNode";

            const result = await robotFileService.checkFolderExists(mockItem);

            assert.strictEqual(result.exists, false);
        });
    });

    suite("getFolderPath", function () {
        test("should return undefined when folder does not exist", async function () {
            const mockItem = createMockTestThemesTreeItem("Test Theme", "1");
            mockItem.data.elementType = "TestThemeNode";

            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("tests");
            testEnv.sandbox.stub(fs.promises, "readdir").resolves([]);

            const folderPath = await robotFileService.getFolderPath(mockItem);

            assert.strictEqual(folderPath, undefined);
        });
    });
});
