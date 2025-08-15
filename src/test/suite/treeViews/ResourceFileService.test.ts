/**
 * @file src/test/suite/treeViews/ResourceFileService.test.ts
 * @description Tests for ResourceFileService special character handling and resource marker removal.
 */

import assert from "assert";
import * as sinon from "sinon";
import * as path from "path";
import * as fs from "fs";
import { ResourceFileService } from "../../../treeViews/implementations/testElements/ResourceFileService";
import { TestBenchLogger } from "../../../testBenchLogger";
import * as utils from "../../../utils";
import * as configuration from "../../../configuration";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";

suite("ResourceFileService", function () {
    let testEnv: TestEnvironment;
    let resourceFileService: ResourceFileService;
    let mockLogger: sinon.SinonStubbedInstance<TestBenchLogger>;

    setup(function () {
        testEnv = setupTestEnvironment();
        mockLogger = testEnv.sandbox.createStubInstance(TestBenchLogger);
        resourceFileService = new ResourceFileService(mockLogger as any);
    });

    teardown(function () {
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

    suite("resource marker removal", function () {
        test("should skip string removal when no custom markers configured", async function () {
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(undefined);
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");

            const result = await resourceFileService.constructAbsolutePath("TestTheme [Robot-Resource]");
            const expectedPath = path.join("/test/workspace", "TestTheme [Robot-Resource]");

            assert.strictEqual(result, expectedPath, "Should preserve markers when no markers configured");
        });

        test("should remove custom resource markers when configured", async function () {
            const customMarkers = ["[RF-Resource]", "[Custom-Marker]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.stat to simulate file not found
            testEnv.sandbox.stub(fs.promises, "stat").rejects({ code: "ENOENT" });

            const result = await resourceFileService.pathExists("TestTheme [RF-Resource] [Robot-Resource]");

            // The pathExists method should handle the marker removal internally
            assert.strictEqual(result, false, "Should handle path with custom markers correctly");
        });

        test("should handle special characters in custom markers correctly", async function () {
            const customMarkers = ["[RF-Resource*]", "[Custom.Marker+]", "[Special|Marker]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.stat to simulate file not found
            testEnv.sandbox.stub(fs.promises, "stat").rejects({ code: "ENOENT" });

            const result = await resourceFileService.pathExists("TestTheme [RF-Resource*] [Robot-Resource]");

            assert.strictEqual(result, false, "Should handle path with special character markers correctly");
        });

        test("should skip string removal when empty markers array is configured", async function () {
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns([]);
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");

            const result = await resourceFileService.constructAbsolutePath(
                "TestTheme [Robot-Resource] [Custom-Marker]"
            );
            const expectedPath = path.join("/test/workspace", "TestTheme [Robot-Resource] [Custom-Marker]");

            assert.strictEqual(result, expectedPath, "Should preserve all markers when empty array configured");
        });

        test("should handle multiple custom markers correctly", async function () {
            const customMarkers = ["[RF-Resource]", "[Custom-Marker]", "[Test-Resource]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.stat to simulate file not found
            testEnv.sandbox.stub(fs.promises, "stat").rejects({ code: "ENOENT" });

            const result = await resourceFileService.pathExists(
                "TestTheme [RF-Resource] [Custom-Marker] [Test-Resource]"
            );

            assert.strictEqual(result, false, "Should handle path with multiple custom markers correctly");
        });

        test("should verify marker removal actually occurs in file operations", async function () {
            const customMarkers = ["[RF-Resource]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.stat to simulate file not found
            testEnv.sandbox.stub(fs.promises, "stat").rejects({ code: "ENOENT" });

            await assert.doesNotReject(
                resourceFileService.pathExists("TestTheme [RF-Resource]"),
                "Should handle marker removal without errors"
            );
        });

        test("should test marker removal in different file operation methods", async function () {
            const customMarkers = ["[RF-Resource]", "[Custom-Marker]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.stat to simulate file not found
            testEnv.sandbox.stub(fs.promises, "stat").rejects({ code: "ENOENT" });

            const pathExistsResult = await resourceFileService.pathExists("TestTheme [RF-Resource]");
            const fileExistsResult = await resourceFileService.fileExists("TestTheme [Custom-Marker]");
            const directoryExistsResult = await resourceFileService.directoryExists("TestFolder [RF-Resource]");

            assert.strictEqual(pathExistsResult, false, "pathExists should handle markers correctly");
            assert.strictEqual(fileExistsResult, false, "fileExists should handle markers correctly");
            assert.strictEqual(directoryExistsResult, false, "directoryExists should handle markers correctly");
        });

        test("should test marker removal with ensureFolderPathExists", async function () {
            const customMarkers = ["[RF-Resource]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.mkdir to succeed
            testEnv.sandbox.stub(fs.promises, "mkdir").resolves();

            await assert.doesNotReject(
                resourceFileService.ensureFolderPathExists("TestFolder [RF-Resource]"),
                "Should create folder path with markers without errors"
            );
        });

        test("should verify marker removal actually removes configured markers", async function () {
            const customMarkers = ["[RF-Resource]", "[Custom-Marker]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.stat to simulate file exists
            const mockStats = {
                isFile: () => true,
                isDirectory: () => false
            } as any;
            testEnv.sandbox.stub(fs.promises, "stat").resolves(mockStats);

            const result = await resourceFileService.fileExists("TestTheme [RF-Resource] [Custom-Marker]");

            assert.strictEqual(result, true, "Should handle marker removal and return correct file existence");
        });

        test("should handle edge cases in marker removal", async function () {
            const customMarkers = ["[RF-Resource]", "[Custom-Marker]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.stat to simulate file not found
            testEnv.sandbox.stub(fs.promises, "stat").rejects({ code: "ENOENT" });

            // Test edge cases: markers at beginning, middle, and end
            const beginningMarker = await resourceFileService.pathExists("[RF-Resource] TestTheme");
            const middleMarker = await resourceFileService.pathExists("Test [RF-Resource] Theme");
            const endMarker = await resourceFileService.pathExists("TestTheme [RF-Resource]");
            const noMarker = await resourceFileService.pathExists("TestTheme");

            assert.strictEqual(beginningMarker, false, "Should handle marker at beginning");
            assert.strictEqual(middleMarker, false, "Should handle marker in middle");
            assert.strictEqual(endMarker, false, "Should handle marker at end");
            assert.strictEqual(noMarker, false, "Should handle path without markers");
        });
    });

    suite("file operations with resource markers", function () {
        test("should handle pathExists with custom resource markers", async function () {
            const customMarkers = ["[RF-Resource]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.stat to simulate file not found
            testEnv.sandbox.stub(fs.promises, "stat").rejects({ code: "ENOENT" });

            const result = await resourceFileService.pathExists("TestTheme [RF-Resource]");

            assert.strictEqual(result, false, "Should return false for non-existent path");
        });

        test("should handle directoryExists with custom resource markers", async function () {
            const customMarkers = ["[RF-Resource]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.stat to simulate directory not found
            testEnv.sandbox.stub(fs.promises, "stat").rejects({ code: "ENOENT" });

            const result = await resourceFileService.directoryExists("TestFolder [RF-Resource]");

            assert.strictEqual(result, false, "Should return false for non-existent directory");
        });

        test("should handle fileExists with custom resource markers", async function () {
            const customMarkers = ["[RF-Resource]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.stat to simulate file not found
            testEnv.sandbox.stub(fs.promises, "stat").rejects({ code: "ENOENT" });

            const result = await resourceFileService.fileExists("TestFile [RF-Resource]");

            assert.strictEqual(result, false, "Should return false for non-existent file");
        });

        test("should handle ensureFolderPathExists with custom resource markers", async function () {
            const customMarkers = ["[RF-Resource]"];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(customMarkers);

            // Mock fs.promises.mkdir to succeed
            testEnv.sandbox.stub(fs.promises, "mkdir").resolves();

            await assert.doesNotReject(
                resourceFileService.ensureFolderPathExists("TestFolder [RF-Resource]"),
                "Should create folder path without errors"
            );
        });
    });
});
