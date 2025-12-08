/**
 * @file src/test/suite/treeViews/RobotFileMetadataScanner.test.ts
 * @description Tests for the RobotFileMetadataScanner class that scans generated files and extracts metadata
 */

import assert from "assert";
import * as sinon from "sinon";
import { RobotFileMetadataScanner } from "../../../treeViews/implementations/testThemes/RobotFileMetadataScanner";
import { GeneratedFileMapper } from "../../../treeViews/implementations/testThemes/GeneratedFileMapper";
import { TestBenchLogger } from "../../../testBenchLogger";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import * as utils from "../../../utils";

suite("RobotFileMetadataScanner", function () {
    let testEnv: TestEnvironment;
    let scanner: RobotFileMetadataScanner;
    let metadataService: GeneratedFileMapper;
    let mockLogger: sinon.SinonStubbedInstance<TestBenchLogger>;

    this.beforeEach(async function () {
        testEnv = setupTestEnvironment();
        mockLogger = testEnv.sandbox.createStubInstance(TestBenchLogger);
        metadataService = new GeneratedFileMapper(mockLogger, testEnv.mockContext);
        await metadataService.initialize();
        scanner = new RobotFileMetadataScanner(mockLogger, metadataService);
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("captureGenerationMetadata", function () {
        test("should return 0 when workspace location is not available", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves(undefined);

            const count = await scanner.captureGenerationMetadata("tests", true);

            assert.strictEqual(count, 0);
        });
    });
});
