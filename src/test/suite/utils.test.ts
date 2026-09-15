import * as assert from "assert";
import {
    getFirstInvalidWindowsPathCharacter,
    validateAndReturnPathSettingError,
    validateGenerationPathSettingsAndReturnError,
    sanitizeFilePath
} from "../../utils";

suite("Utils Test Suite", () => {
    suite("sanitizeFilePath", () => {
        let originalPlatform: string;

        setup(() => {
            // Mock process.platform to return 'win32' to test Windows-specific behavior
            originalPlatform = process.platform;
            Object.defineProperty(process, "platform", {
                value: "win32"
            });
        });

        teardown(() => {
            // Restore original platform
            Object.defineProperty(process, "platform", {
                value: originalPlatform
            });
        });

        test("should return empty string for empty input", () => {
            assert.strictEqual(sanitizeFilePath(""), "");
        });

        test("should preserve separators", () => {
            assert.strictEqual(sanitizeFilePath("foo/bar\\baz"), "foo/bar\\baz");
        });

        test("should sanitize invalid windows characters", () => {
            assert.strictEqual(sanitizeFilePath('folder<>/file"|?*.txt'), "folder__/file____.txt");
        });

        test("should preserve valid drive prefix", () => {
            assert.strictEqual(sanitizeFilePath("C:\\foo\\bar"), "C:\\foo\\bar");
            assert.strictEqual(sanitizeFilePath("d:/foo/bar"), "d:/foo/bar");
        });

        test("should preserve valid drive prefix when path starts with separator", () => {
            assert.strictEqual(sanitizeFilePath("/C:/foo/bar"), "/C:/foo/bar");
        });

        test("should sanitize colons that are not in the drive prefix", () => {
            assert.strictEqual(sanitizeFilePath("C:\\foo:bar\\baz"), "C:\\foo_bar\\baz");
            assert.strictEqual(sanitizeFilePath("/C:/foo:bar"), "/C:/foo_bar");
            assert.strictEqual(sanitizeFilePath("foo\\C:\\bar"), "foo\\C_\\bar");
        });

        test("should skip processing for non-windows platforms", () => {
            Object.defineProperty(process, "platform", {
                value: "linux"
            });
            const invalidWindowsPath = 'folder<>/file"|?*:C:.txt';
            assert.strictEqual(sanitizeFilePath(invalidWindowsPath), invalidWindowsPath);
        });
    });

    suite("path setting validation", () => {
        let originalPlatform: string;

        setup(() => {
            originalPlatform = process.platform;
            Object.defineProperty(process, "platform", {
                value: "win32"
            });
        });

        teardown(() => {
            Object.defineProperty(process, "platform", {
                value: originalPlatform
            });
        });

        test("should return undefined when path is valid on windows", () => {
            assert.strictEqual(getFirstInvalidWindowsPathCharacter("resources/sub/folder"), undefined);
            assert.strictEqual(
                validateAndReturnPathSettingError("Resource Directory Path", "resources/sub/folder"),
                undefined
            );
        });

        test("should detect invalid windows path characters", () => {
            assert.strictEqual(getFirstInvalidWindowsPathCharacter("resources?/sub"), "?");
            const err = validateAndReturnPathSettingError("Resource Directory Path", "resources?/sub");
            assert.ok(err?.includes("Resource Directory Path"));
            assert.ok(err?.includes("'?'"));
        });

        test("should allow drive prefix and flag non-prefix colons", () => {
            assert.strictEqual(getFirstInvalidWindowsPathCharacter("C:\\temp\\resources"), undefined);
            assert.strictEqual(getFirstInvalidWindowsPathCharacter("resources:temp"), ":");
        });

        test("should skip windows validation on non-windows platforms", () => {
            Object.defineProperty(process, "platform", {
                value: "linux"
            });

            assert.strictEqual(getFirstInvalidWindowsPathCharacter("resources?/sub"), undefined);
            assert.strictEqual(
                validateAndReturnPathSettingError("Resource Directory Path", "resources?/sub"),
                undefined
            );
        });

        test("should return first generation path setting error in output/resource order", () => {
            const outputError = validateGenerationPathSettingsAndReturnError("tests?", "resources");
            assert.ok(outputError?.includes("Output Directory"));

            const resourceError = validateGenerationPathSettingsAndReturnError("tests", "resources?");
            assert.ok(resourceError?.includes("Resource Directory Path"));

            const noError = validateGenerationPathSettingsAndReturnError("tests", "resources");
            assert.strictEqual(noError, undefined);
        });
    });
});
