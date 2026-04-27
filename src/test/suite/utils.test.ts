import * as assert from "assert";
import { sanitizeFilePath } from "../../utils";

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
});
