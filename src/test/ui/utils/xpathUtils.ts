/**
 * @file src/test/ui/utils/xpathUtils.ts
 * @description Utilities for safely building dynamic XPath expressions.
 */

/**
 * Escapes a dynamic value for use as an XPath string literal.
 *
 * XPath 1.0 has no escape syntax inside string literals. If both quote types
 * are present, we must compose the value with concat(...).
 *
 * @param value - Raw string value to embed in an XPath expression.
 * @returns A valid XPath string literal expression (single-quoted,
 * double-quoted, or concat(...)).
 */
export function escapeXPathLiteral(value: string): string {
    if (!value.includes("'")) {
        return `'${value}'`;
    }

    if (!value.includes('"')) {
        return `"${value}"`;
    }

    const quotedSegments = value.split("'").map((part) => `'${part}'`);
    return `concat(${quotedSegments.join(`, "'", `)})`;
}
