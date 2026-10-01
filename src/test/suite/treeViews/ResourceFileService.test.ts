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

    suite("normalizePath", function () {
        test("should handle various special characters and preserve valid characters", function () {
            const testCases = [
                { input: "Test:Name", expected: "Test_Name", description: "colon" },
                { input: "Test<Name>", expected: "Test_Name_", description: "less than" },
                { input: "Test>Name>", expected: "Test_Name_", description: "greater than" },
                { input: 'Test"Name"', expected: "Test_Name_", description: "double quote" },
                { input: "Test/Name", expected: "Test_Name", description: "forward slash" },
                { input: "Test\\Name", expected: "Test_Name", description: "backslash" },
                { input: "Test|Name", expected: "Test_Name", description: "pipe" },
                { input: "Test?Name", expected: "Test_Name", description: "question mark" },
                { input: "Test*Name", expected: "Test_Name", description: "asterisk" },
                { input: "Test,Name", expected: "Test,Name", description: "comma is preserved" },
                { input: "Test Name", expected: "Test Name", description: "space is preserved" },
                {
                    input: "Test: Multiples/|,",
                    expected: "Test_ Multiples__,"
                },
                { input: "NoSpecialChars", expected: "NoSpecialChars", description: "no special chars" },
                { input: "", expected: "", description: "empty string" }
            ];

            for (const { input, expected, description } of testCases) {
                const result = ResourceFileService.normalizePath(input);
                assert.strictEqual(result, expected, `Failed on: ${description}`);
            }
        });
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
                    expectedComponent: "Test,Theme",
                    description: "comma is preserved"
                },
                {
                    input: "Test Theme with Spaces",
                    expectedComponent: "Test Theme with Spaces",
                    description: "spaces are preserved"
                },
                {
                    input: "Test:Theme\\With\\Special*Chars?",
                    expectedComponent: "Test_Theme_With_Special_Chars_",
                    description: "multiple special characters become underscores"
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
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(undefined);

            const testCases = [
                {
                    input: "Test/Theme",
                    expectedComponents: ["Test", "Theme"],
                    description: "forward slash treated as path separator"
                },
                {
                    input: "Folder/SubFolder/Test:Resource,Special",
                    expectedComponents: ["Folder", "SubFolder", "Test_Resource,Special"],
                    description: "hierarchical path with special characters in components"
                },
                {
                    input: "Special Chars_-\\|?,\\/?_-\\|, Child 1",
                    expectedComponents: ["Special Chars_-___,_", "__-__, Child 1"],
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
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(undefined);

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

        test("should return undefined when hierarchical name is only whitespace", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");

            const result = await resourceFileService.constructAbsolutePath("   \t  \n  ");

            assert.strictEqual(result, undefined, "Should return undefined when hierarchical name is only whitespace");
        });

        test("should filter out empty components after normalization", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(undefined);

            const result = await resourceFileService.constructAbsolutePath("Folder///SubFolder//Resource");

            const expectedPath = path.join("/test/workspace", "Folder", "SubFolder", "Resource");
            assert.strictEqual(result, expectedPath, "Should filter out empty components");
        });

        test("should map path under resourceDirectoryPath starting from marker", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").callsFake((key: string) => {
                if (key === "resourceDirectoryPath") {
                    return "rf_resources" as any;
                }
                if (key === "resourceRootRegex") {
                    return "resources" as any;
                }
                if (key === "resourceMarker") {
                    return undefined as any;
                }
                return undefined as any;
            });

            testEnv.vscodeMocks.executeCommandStub
                .withArgs("testbench_ls.get_resource_directory_subdivision_index")
                .resolves(2);

            const result = await resourceFileService.constructAbsolutePath(
                "Root/Project/resources/Sub/Folder/MyResource"
            );
            const expectedPath = path.join("/test/workspace", "rf_resources", "Sub", "Folder", "MyResource");

            assert.strictEqual(
                result,
                expectedPath,
                `Expected mapping below marker into resourceDirectoryPath: "${expectedPath}", got "${result}"`
            );
        });

        test("should create file directly under resourceDirectoryPath when marker is missing", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").callsFake((key: string) => {
                if (key === "resourceDirectoryPath") {
                    return "rf_resources" as any;
                }
                if (key === "resourceRootRegex") {
                    return "resources" as any;
                }
                if (key === "resourceMarker") {
                    return undefined as any;
                }
                return undefined as any;
            });

            // Return -1 (marker not found)
            testEnv.vscodeMocks.executeCommandStub
                .withArgs("testbench_ls.get_resource_directory_subdivision_index")
                .resolves(-1);

            const result = await resourceFileService.constructAbsolutePath("Root/Project/Sub/Folder/MyResource");
            const expectedPath = path.join("/test/workspace", "rf_resources", "MyResource");

            assert.strictEqual(
                result,
                expectedPath,
                `Expected file to be created directly under resourceDirectoryPath when marker missing: "${expectedPath}", got "${result}"`
            );
        });

        test("should handle marker at root and slice correctly", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").callsFake((key: string) => {
                if (key === "resourceDirectoryPath") {
                    return "rf" as any;
                }
                if (key === "resourceRootRegex") {
                    return "resources" as any;
                }
                if (key === "resourceMarker") {
                    return undefined as any;
                }
                return undefined as any;
            });

            // Return 0 (marker is the first component)
            testEnv.vscodeMocks.executeCommandStub
                .withArgs("testbench_ls.get_resource_directory_subdivision_index")
                .resolves(0);

            const result = await resourceFileService.constructAbsolutePath("resources/Sub/Res");
            const expectedPath = path.join("/test/workspace", "rf", "Sub", "Res");

            assert.strictEqual(
                result,
                expectedPath,
                `Expected slicing after root marker: "${expectedPath}", got "${result}"`
            );
        });

        test("should leave relative path empty when marker is the last component", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").callsFake((key: string) => {
                if (key === "resourceDirectoryPath") {
                    return "rf" as any;
                }
                if (key === "resourceRootRegex") {
                    return "resources" as any;
                }
                if (key === "resourceMarker") {
                    return undefined as any;
                }
                return undefined as any;
            });

            testEnv.vscodeMocks.executeCommandStub
                .withArgs("testbench_ls.get_resource_directory_subdivision_index")
                .resolves(2);

            const result = await resourceFileService.constructAbsolutePath("Root/Project/resources");
            const expectedPath = path.join("/test/workspace", "rf");

            assert.strictEqual(
                result,
                expectedPath,
                `Expected mapping exact marker to resource directory: "${expectedPath}", got "${result}"`
            );
        });

        test("should preserve folder hierarchy when marker is not configured", async function () {
            testEnv.sandbox.stub(utils, "validateAndReturnWorkspaceLocation").resolves("/test/workspace");
            testEnv.sandbox.stub(configuration, "getExtensionSetting").callsFake((key: string) => {
                if (key === "resourceDirectoryPath") {
                    return "my_resources" as any;
                }
                if (key === "resourceDirectoryMarker") {
                    return undefined as any;
                }
                if (key === "resourceMarker") {
                    return undefined as any;
                }
                return undefined as any;
            });

            const result = await resourceFileService.constructAbsolutePath("Project/MyResource");
            const expectedPath = path.join("/test/workspace", "my_resources", "Project", "MyResource");

            assert.strictEqual(
                result,
                expectedPath,
                `Expected full folder hierarchy to be preserved when no marker is configured: "${expectedPath}", got "${result}"`
            );
        });
    });

    suite("ensureFileExists", function () {
        test("should create file when it doesn't exist", async function () {
            testEnv.sandbox.stub(resourceFileService, "pathExists").resolves(false);
            testEnv.sandbox.stub(resourceFileService, "ensureFolderPathExists").resolves();
            const writeFileStub = testEnv.sandbox.stub(fs.promises, "writeFile").resolves();

            await resourceFileService.ensureFileExists("/test/path/file.resource", "*** Settings ***");

            assert(writeFileStub.calledOnce, "Should call writeFile once");
            assert(writeFileStub.calledWith("/test/path/file.resource", "*** Settings ***", { encoding: "utf8" }));
        });

        test("should not overwrite existing file", async function () {
            testEnv.sandbox.stub(resourceFileService, "pathExists").resolves(true);
            const writeFileStub = testEnv.sandbox.stub(fs.promises, "writeFile").resolves();

            await resourceFileService.ensureFileExists("/test/path/file.resource", "*** Settings ***");

            assert(writeFileStub.notCalled, "Should not call writeFile when file exists");
        });

        test("should create parent directories if they don't exist", async function () {
            testEnv.sandbox.stub(resourceFileService, "pathExists").resolves(false);
            const ensureFolderStub = testEnv.sandbox.stub(resourceFileService, "ensureFolderPathExists").resolves();
            testEnv.sandbox.stub(fs.promises, "writeFile").resolves();

            await resourceFileService.ensureFileExists("/test/path/file.resource", "*** Settings ***");

            assert(ensureFolderStub.calledOnce, "Should call ensureFolderPathExists once");
            assert(ensureFolderStub.calledWith("/test/path"));
        });

        test("should handle file creation errors gracefully", async function () {
            testEnv.sandbox.stub(resourceFileService, "pathExists").resolves(false);
            testEnv.sandbox.stub(resourceFileService, "ensureFolderPathExists").resolves();
            testEnv.sandbox.stub(fs.promises, "writeFile").rejects(new Error("Permission denied"));

            await assert.rejects(
                resourceFileService.ensureFileExists("/test/path/file.resource", "content"),
                /Failed to create resource file: Permission denied/
            );
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

        test("should handle invalid marker configurations gracefully", async function () {
            const invalidMarkers = [null, undefined, "", 123, {}, []] as any[];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(invalidMarkers);
            testEnv.sandbox.stub(fs.promises, "stat").rejects({ code: "ENOENT" });

            const result = await resourceFileService.pathExists("TestTheme [RF-Resource]");

            assert.strictEqual(result, false, "Should handle invalid marker configurations gracefully");
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

    suite("hasResourceMarker method", function () {
        test("should return false when no markers configured", function () {
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(undefined);
            assert.strictEqual(ResourceFileService.hasResourceMarker("TestTheme"), false);
        });

        test("should return false when markers array is empty", function () {
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns([]);
            assert.strictEqual(ResourceFileService.hasResourceMarker("TestTheme"), false);
        });

        test("should return false when configured marker is present but not as suffix", function () {
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(["[Robot-Resource]", "rf_resource"]);
            const result = ResourceFileService.hasResourceMarker("TestTheme [Robot-Resource] suffix");
            assert.strictEqual(result, false, "Should return false when marker is not at the end");
        });

        test("should return true when configured marker is exact suffix string", function () {
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(["[Robot-Resource]", "rf_resource"]);
            const result = ResourceFileService.hasResourceMarker("TestTheme [Robot-Resource]");
            assert.strictEqual(result, true, "Should return true for exact suffix match");
        });

        test("should return true when configured marker has trailing whitespace", function () {
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(["[Robot-Resource]", "rf_resource"]);
            const result = ResourceFileService.hasResourceMarker("TestTheme [Robot-Resource]   \t");
            assert.strictEqual(result, true, "Should ignore trailing whitespace when matching suffix marker");
        });

        test("should handle invalid marker types gracefully", function () {
            const invalidMarkers = [null, undefined, "", 123, {}, []] as any[];
            testEnv.sandbox.stub(configuration, "getExtensionSetting").returns(invalidMarkers);
            assert.strictEqual(ResourceFileService.hasResourceMarker("TestTheme"), false);
        });
    });
});
