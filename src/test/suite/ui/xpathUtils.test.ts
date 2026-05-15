/**
 * @file src/test/suite/ui/xpathUtils.test.ts
 * @description Unit tests for XPath literal escaping helpers used by UI tests.
 */

import * as assert from "assert";
import { escapeXPathLiteral } from "../../../test/ui/utils/xpathUtils";

suite("XPath Utils", () => {
    test("escapes empty string values", () => {
        const escaped = escapeXPathLiteral("");
        assert.strictEqual(escaped, "''");
    });

    test("escapes values that are only a single quote", () => {
        const escaped = escapeXPathLiteral("'");
        assert.strictEqual(escaped, '"\'"');
    });

    test("escapes labels containing single quotes", () => {
        const escaped = escapeXPathLiteral("Don't click");
        assert.strictEqual(escaped, '"Don\'t click"');
    });

    test("escapes labels containing double quotes", () => {
        const escaped = escapeXPathLiteral('Click "Allow"');
        assert.strictEqual(escaped, `'Click "Allow"'`);
    });

    test("escapes labels containing both quote types", () => {
        const escaped = escapeXPathLiteral('He said "don\'t"');
        assert.strictEqual(escaped, `concat('He said "don', "'", 't"')`);
    });
});
