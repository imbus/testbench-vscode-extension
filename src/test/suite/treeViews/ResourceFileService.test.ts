/**
 * @file src/test/suite/treeViews/ResourceFileService.test.ts
 * @description Tests for ResourceFileService special character handling.
 */

import assert from "assert";
import * as sinon from "sinon";
import * as path from "path";
import { ResourceFileService } from "../../../treeViews/implementations/testElements/ResourceFileService";
import { TestBenchLogger } from "../../../testBenchLogger";
import * as utils from "../../../utils";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";

suite("ResourceFileService", function () {
    let testEnv: TestEnvironment;
    let resourceFileService: ResourceFileService;
    let mockLogger: sinon.SinonStubbedInstance<TestBenchLogger>;

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockLogger = testEnv.sandbox.createStubInstance(TestBenchLogger);
        resourceFileService = new ResourceFileService(mockLogger as any);
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("constructAbsolutePath", function () {
        test("should normalize single component names with special characters correctly", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");

            const testCases = [
                {
                    input: "Test:Theme",
                    expectedComponent: "Test_Theme",
                    description: "colon becomes underscore"
                },
                {
                    input: "Test\\Theme",
                    expectedComponent: "Test_Theme",
                    description: "backslash becomes underscore"
                },
                {
                    input: "Test*Theme",
                    expectedComponent: "Test_Theme",
                    description: "asterisk becomes underscore"
                },
                {
                    input: "Test?Theme",
                    expectedComponent: "Test_Theme",
                    description: "question mark becomes underscore"
                },
                {
                    input: 'Test"Theme',
                    expectedComponent: "Test_Theme",
                    description: "quote becomes underscore"
                },
                {
                    input: "Test<Theme",
                    expectedComponent: "Test_Theme",
                    description: "less than becomes underscore"
                },
                {
                    input: "Test>Theme",
                    expectedComponent: "Test_Theme",
                    description: "greater than becomes underscore"
                },
                {
                    input: "Test|Theme",
                    expectedComponent: "Test_Theme",
                    description: "pipe becomes underscore"
                },
                {
                    input: "Test,Theme",
                    expectedComponent: "Test_Theme",
                    description: "comma becomes underscore"
                },
                {
                    input: "Test Theme with Spaces",
                    expectedComponent: "Test Theme with Spaces",
                    description: "spaces are preserved"
                },
                {
                    input: "Test:Theme\\With\\Special*Chars?,",
                    expectedComponent: "Test_Theme_With_Special_Chars__",
                    description: "multiple special characters including comma become underscores"
                },
                {
                    input: "_Leading_Underscore_",
                    expectedComponent: "_Leading_Underscore_",
                    description: "existing underscores are preserved"
                },
                {
                    input: "Multiple___Underscores",
                    expectedComponent: "Multiple___Underscores",
                    description: "multiple consecutive underscores are preserved"
                }
            ];

            for (const testCase of testCases) {
                const result = await resourceFileService.constructAbsolutePath(testCase.input);
                const expectedPath = path.join("/test/workspace", testCase.expectedComponent);

                assert.strictEqual(
                    result,
                    expectedPath,
                    `${testCase.description}: Expected "${expectedPath}", got "${result}"`
                );
            }
        });

        test("should normalize hierarchical names with special characters correctly", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");

            const testCases = [
                {
                    input: "Test/Theme",
                    expectedComponents: ["Test", "Theme"],
                    description: "forward slash treated as path separator"
                },
                {
                    input: "Folder/SubFolder/Test:Resource,Special",
                    expectedComponents: ["Folder", "SubFolder", "Test_Resource_Special"],
                    description: "hierarchical path with special characters in components"
                },
                {
                    input: "Special Chars_-\\|?,/?_-\\|, Child 1",
                    expectedComponents: ["Special Chars_-____", "__-___ Child 1"],
                    description: "complex hierarchical path with special characters"
                }
            ];

            for (const testCase of testCases) {
                const result = await resourceFileService.constructAbsolutePath(testCase.input);
                const expectedPath = path.join("/test/workspace", ...testCase.expectedComponents);

                assert.strictEqual(
                    result,
                    expectedPath,
                    `${testCase.description}: Expected "${expectedPath}", got "${result}"`
                );
            }
        });

        test("should construct correct path components regardless of platform", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");

            const result = await resourceFileService.constructAbsolutePath("Folder/SubFolder/Resource");

            const pathParts = result?.split(path.sep) || [];
            assert.strictEqual(
                pathParts[pathParts.length - 1],
                "Resource",
                "Last component should be normalized correctly"
            );
            assert.strictEqual(
                pathParts[pathParts.length - 2],
                "SubFolder",
                "Second-to-last component should be normalized correctly"
            );
            assert.strictEqual(
                pathParts[pathParts.length - 3],
                "Folder",
                "Third-to-last component should be normalized correctly"
            );

            assert(result?.includes("workspace"), "Should include workspace path");
        });

        test("should return undefined when workspace location is not available", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves(undefined);

            const result = await resourceFileService.constructAbsolutePath("Test:Theme");

            assert.strictEqual(result, undefined, "Should return undefined when workspace location is not available");
        });

        test("should return undefined when hierarchical name is empty", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");

            const result = await resourceFileService.constructAbsolutePath("");

            assert.strictEqual(result, undefined, "Should return undefined when hierarchical name is empty");
        });
    });
});
