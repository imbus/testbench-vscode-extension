/**
 * @file src/test/suite/treeViews/GeneratedFileMapper.test.ts
 * @description Tests for the GeneratedFileMapper class that manages generation metadata
 */

import assert from "assert";
import * as sinon from "sinon";
import { GeneratedFileMapper } from "../../../treeViews/implementations/testThemes/GeneratedFileMapper";
import { TestBenchLogger } from "../../../testBenchLogger";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import * as utils from "../../../utils";

suite("GeneratedFileMapper", function () {
    let testEnv: TestEnvironment;
    let mapper: GeneratedFileMapper;
    let mockLogger: sinon.SinonStubbedInstance<TestBenchLogger>;

    this.beforeEach(async function () {
        testEnv = setupTestEnvironment();
        mockLogger = testEnv.sandbox.createStubInstance(TestBenchLogger);

        (testEnv.mockContext.workspaceState.get as sinon.SinonStub).callsFake(
            (key: string, defaultValue?: any) => defaultValue
        );

        mapper = new GeneratedFileMapper(mockLogger, testEnv.mockContext);
        await mapper.initialize();
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("initialize", function () {
        test("should handle missing workspace state gracefully", async function () {
            (testEnv.mockContext.workspaceState.get as sinon.SinonStub).returns(undefined);

            const newMapper = new GeneratedFileMapper(mockLogger, testEnv.mockContext);
            await newMapper.initialize();

            const metadata = newMapper.getMetadata();
            assert.strictEqual(metadata, null);
        });
    });

    suite("startMetadataGeneration", function () {
        test("should create new metadata session", async function () {
            await mapper.startMetadataGeneration("tests", true);

            const metadata = mapper.getMetadata();
            assert.ok(metadata);
            assert.strictEqual(metadata?.outputDirectory, "tests");
            assert.strictEqual(metadata?.logSuiteNumbering, true);
            assert.ok(metadata?.lastGenerationTimestamp);
            assert.strictEqual(Object.keys(metadata?.items || {}).length, 0);
        });

        test("should clear existing metadata when starting new generation", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFile("uid-1", "Test 1", "1.1", "tests/test1.robot");

            await mapper.startMetadataGeneration("output", false);

            const metadata = mapper.getMetadata();
            assert.ok(metadata);
            assert.strictEqual(metadata?.outputDirectory, "output");
            assert.strictEqual(metadata?.logSuiteNumbering, false);
            assert.strictEqual(Object.keys(metadata?.items || {}).length, 0);
        });
    });

    suite("recordGeneratedFile", function () {
        test("should record a test case set file", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFile("uid-1", "Test Case Set", "1.1", "tests/test1.robot");

            const metadata = mapper.getMetadata();
            assert.ok(metadata);
            const item = metadata?.items["uid-1"];
            assert.ok(item);
            assert.strictEqual(item?.type, "TestCaseSet");
            assert.strictEqual(item?.name, "Test Case Set");
            assert.strictEqual(item?.numbering, "1.1");
            assert.strictEqual(item?.generatedFile, "tests/test1.robot");
            assert.ok(item?.generationTimestamp);
        });

        test("should not record file if no active metadata session", async function () {
            await mapper.recordGeneratedFile("uid-1", "Test Case Set", "1.1", "tests/test1.robot");

            const metadata = mapper.getMetadata();
            assert.strictEqual(metadata, null);
        });

        test("should update existing file record", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFile("uid-1", "Test Case Set 1", "1.1", "tests/test1.robot");
            await mapper.recordGeneratedFile("uid-1", "Test Case Set 1 Updated", "1.1", "tests/test1_updated.robot");

            const metadata = mapper.getMetadata();
            const item = metadata?.items["uid-1"];
            assert.ok(item);
            assert.strictEqual(item?.name, "Test Case Set 1 Updated");
            assert.strictEqual(item?.generatedFile, "tests/test1_updated.robot");
        });
    });

    suite("recordGeneratedFolder", function () {
        test("should record a test theme folder", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFolder("uid-1", "Test Theme", "1", "tests/theme1", [
                "tests/theme1/test1.robot"
            ]);

            const metadata = mapper.getMetadata();
            assert.ok(metadata);
            const item = metadata?.items["uid-1"];
            assert.ok(item);
            assert.strictEqual(item?.type, "TestTheme");
            assert.strictEqual(item?.name, "Test Theme");
            assert.strictEqual(item?.numbering, "1");
            assert.strictEqual(item?.generatedFolder, "tests/theme1");
            assert.deepStrictEqual(item?.childFiles, ["tests/theme1/test1.robot"]);
        });

        test("should not record folder if no active metadata session", async function () {
            await mapper.recordGeneratedFolder("uid-1", "Test Theme", "1", "tests/theme1");

            const metadata = mapper.getMetadata();
            assert.strictEqual(metadata, null);
        });

        test("should record folder without child files", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFolder("uid-1", "Test Theme", "1", "tests/theme1");

            const metadata = mapper.getMetadata();
            const item = metadata?.items["uid-1"];
            assert.ok(item);
            assert.strictEqual(item?.type, "TestTheme");
            assert.strictEqual(item?.childFiles, undefined);
        });
    });

    suite("getGeneratedFilePath", function () {
        test("should return undefined for non-existent uniqueID", async function () {
            await mapper.startMetadataGeneration("tests", true);

            const filePath = await mapper.getGeneratedFilePath("uid-nonexistent");
            assert.strictEqual(filePath, undefined);
        });

        test("should return undefined for test theme (not a file)", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFolder("uid-1", "Test Theme", "1", "tests/theme1");

            const filePath = await mapper.getGeneratedFilePath("uid-1");
            assert.strictEqual(filePath, undefined);
        });

        test("should return undefined if no workspace location", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFile("uid-1", "Test Case Set", "1.1", "tests/test1.robot");

            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves(undefined);

            const filePath = await mapper.getGeneratedFilePath("uid-1");
            assert.strictEqual(filePath, undefined);
        });
    });

    suite("getGeneratedFolderPath", function () {
        test("should return undefined for non-existent uniqueID", async function () {
            await mapper.startMetadataGeneration("tests", true);

            const folderPath = await mapper.getGeneratedFolderPath("uid-nonexistent");
            assert.strictEqual(folderPath, undefined);
        });

        test("should return undefined for test case set (not a folder)", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFile("uid-1", "Test Case Set", "1.1", "tests/test1.robot");

            const folderPath = await mapper.getGeneratedFolderPath("uid-1");
            assert.strictEqual(folderPath, undefined);
        });
    });

    suite("hasMetadata", function () {
        test("should return true if metadata exists", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFile("uid-1", "Test Case Set", "1.1", "tests/test1.robot");

            assert.strictEqual(mapper.hasMetadata("uid-1"), true);
        });

        test("should return false if metadata does not exist", async function () {
            await mapper.startMetadataGeneration("tests", true);

            assert.strictEqual(mapper.hasMetadata("uid-nonexistent"), false);
        });

        test("should return false if no metadata session", function () {
            assert.strictEqual(mapper.hasMetadata("uid-1"), false);
        });
    });

    suite("getAllGeneratedItemUIDs", function () {
        test("should return all unique IDs", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFile("uid-1", "Test 1", "1.1", "tests/test1.robot");
            await mapper.recordGeneratedFile("uid-2", "Test 2", "1.2", "tests/test2.robot");
            await mapper.recordGeneratedFolder("uid-3", "Theme 1", "1", "tests/theme1");

            const uids = mapper.getAllGeneratedItemUIDs();
            assert.strictEqual(uids.length, 3);
            assert.ok(uids.includes("uid-1"));
            assert.ok(uids.includes("uid-2"));
            assert.ok(uids.includes("uid-3"));
        });

        test("should return empty array if no metadata", function () {
            const uids = mapper.getAllGeneratedItemUIDs();
            assert.deepStrictEqual(uids, []);
        });
    });

    suite("removeMetadata", function () {
        test("should remove metadata for specific uniqueID", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFile("uid-1", "Test 1", "1.1", "tests/test1.robot");
            await mapper.recordGeneratedFile("uid-2", "Test 2", "1.2", "tests/test2.robot");

            await mapper.removeMetadata("uid-1");

            assert.strictEqual(mapper.hasMetadata("uid-1"), false);
            assert.strictEqual(mapper.hasMetadata("uid-2"), true);
        });

        test("should handle removing non-existent metadata gracefully", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.removeMetadata("uid-nonexistent");

            assert.ok(true);
        });
    });

    suite("clearAllMetadata", function () {
        test("should clear all metadata", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFile("uid-1", "Test 1", "1.1", "tests/test1.robot");
            await mapper.recordGeneratedFile("uid-2", "Test 2", "1.2", "tests/test2.robot");

            await mapper.clearAllMetadata();

            const metadata = mapper.getMetadata();
            assert.strictEqual(metadata, null);
        });

        test("should handle clearing when no metadata exists", async function () {
            await mapper.clearAllMetadata();
            assert.ok(true);
        });
    });

    suite("validateAndCleanup", function () {
        test("should return 0 if no metadata", async function () {
            const removedCount = await mapper.validateAndCleanup();
            assert.strictEqual(removedCount, 0);
        });

        test("should return 0 if no workspace location", async function () {
            await mapper.startMetadataGeneration("tests", true);
            await mapper.recordGeneratedFile("uid-1", "Test 1", "1.1", "tests/test1.robot");

            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves(undefined);

            const removedCount = await mapper.validateAndCleanup();
            assert.strictEqual(removedCount, 0);
        });
    });
});
