/**
 * @file src/serverVersionCheck.ts
 * @description Checks the version of the connected TestBench server against the version range
 * this extension supports. A server older than the supported range is known not to work
 * and blocks the connection. A server newer than the supported range is simply unknown to
 * this extension, so it only produces a warning and work continues.
 */

import * as vscode from "vscode";
import { logger } from "./extension";
import { DependencyVersionError } from "./errors";
import { EXTENSION_ID } from "./constants";

// Supported TestBench server versions (major.minor, inclusive on both ends).
// Report compatibility is checked separately by testbench2robotframework via the report's formatVersion.
/** The oldest TestBench server version (major.minor) this extension supports. */
export const MIN_TESTBENCH_SERVER_VERSION = "4.1";
/** The newest TestBench server version (major.minor) this extension is built against. */
export const MAX_TESTBENCH_SERVER_VERSION = "4.2";
const SUPPORTED_TESTBENCH_SERVER_VERSIONS = `${MIN_TESTBENCH_SERVER_VERSION} - ${MAX_TESTBENCH_SERVER_VERSION}`;

/** Label of the notification action that runs VS Code's own extension update check. */
export const CHECK_FOR_UPDATES_ACTION = "Check for Extension Updates";

/** Last extension version that supported a TestBench version which is no longer supported. */
const LAST_COMPATIBLE_EXTENSION_VERSION: Record<string, string> = {
    "4.0": "0.6.2"
};

export type ServerVersionVerdict = "unknown" | "older" | "supported" | "newer";

/** Server versions already warned about, so the warning appears once per window session. */
const warnedServerVersions = new Set<string>();

/**
 * Splits a version into its numeric major and minor part; the patch version is ignored,
 * so an expected version of "4.1" also accepts a server version of "4.1.03".
 * @param version The version string to parse.
 * @returns The major and minor version, or undefined if they cannot be determined.
 */
function parseMajorMinor(version: string): [number, number] | undefined {
    const [major, minor] = version.trim().split(".");
    if (!/^\d+$/.test(major ?? "") || !/^\d+$/.test(minor ?? "")) {
        return undefined;
    }
    return [Number(major), Number(minor)];
}

/**
 * Formats a version as "major.minor", used for lookups and log output.
 * @param version The version string to shorten.
 * @returns The major.minor version, or the trimmed input if it cannot be parsed.
 */
function toMajorMinor(version: string): string {
    const parsed = parseMajorMinor(version);
    return parsed ? `${parsed[0]}.${parsed[1]}` : version.trim();
}

/**
 * Compares two parsed versions by major, then minor version.
 * @returns A negative number if a < b, 0 if equal, a positive number if a > b.
 */
function compareMajorMinor(a: [number, number], b: [number, number]): number {
    return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

/**
 * Compares a server version against the supported TestBench version range.
 * @param serverVersion The version reported by the TestBench server.
 * @param minVersion The oldest version supported by this extension (inclusive).
 * @param maxVersion The newest version supported by this extension (inclusive).
 * @returns Whether the server is unknown, older than, within, or newer than the supported range.
 */
export function classifyServerVersion(
    serverVersion: string,
    minVersion: string = MIN_TESTBENCH_SERVER_VERSION,
    maxVersion: string = MAX_TESTBENCH_SERVER_VERSION
): ServerVersionVerdict {
    const server = parseMajorMinor(serverVersion);
    const min = parseMajorMinor(minVersion);
    const max = parseMajorMinor(maxVersion);

    if (!server || !min || !max) {
        return "unknown";
    }
    if (compareMajorMinor(server, min) < 0) {
        return "older";
    }
    if (compareMajorMinor(server, max) > 0) {
        return "newer";
    }
    return "supported";
}

/**
 * Validates the TestBench server version.
 * Blocks (by throwing) if the server version is older than or cannot be compared to the
 * supported version, and only warns if it is newer.
 * @param serverVersion The server version returned from the server version endpoint.
 * @param modal Whether to show a modal dialog (true) or a regular notification (false).
 *              Only applies to the blocking cases; the warning is never modal.
 */
export async function validateServerVersion(serverVersion: string, modal: boolean = true): Promise<void> {
    switch (classifyServerVersion(serverVersion)) {
        case "supported":
            logger.debug(`[serverVersionCheck] Server version validated successfully: ${serverVersion}`);
            return;
        case "newer":
            warnAboutNewerServer(serverVersion);
            return;
        case "older":
            await blockOlderServer(serverVersion, modal);
            return;
        case "unknown":
            await blockUndeterminedServer(serverVersion, modal);
            return;
    }
}

/**
 * Clears the record of already warned server versions. Intended for tests.
 */
export function resetServerVersionWarnings(): void {
    warnedServerVersions.clear();
}

/**
 * Shows a non-blocking warning that the server is newer than the supported version and
 * offers to run VS Code's own extension update check. The extension itself does not query
 * the Marketplace: at this point a compatible extension version usually does not exist yet.
 * @param serverVersion The server version that is newer than the supported one.
 */
function warnAboutNewerServer(serverVersion: string): void {
    const extensionVersion: string = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON?.version ?? "unknown";
    const warningKey = `${extensionVersion}|${toMajorMinor(serverVersion)}`;

    if (warnedServerVersions.has(warningKey)) {
        logger.debug(`[serverVersionCheck] Already warned about TestBench server version ${serverVersion}.`);
        return;
    }
    warnedServerVersions.add(warningKey);

    logger.warn(
        `[serverVersionCheck] Server version ${serverVersion} is newer than the supported versions ${SUPPORTED_TESTBENCH_SERVER_VERSIONS}.`
    );

    // Deliberately not awaited: the notification must never delay the login flow.
    void vscode.window
        .showWarningMessage(
            `Connected TestBench server ${serverVersion} is newer than TestBench ${MAX_TESTBENCH_SERVER_VERSION}, the newest version supported by TestBench extension ${extensionVersion}. You can keep working; if something behaves unexpectedly, an extension update may be required.`,
            CHECK_FOR_UPDATES_ACTION
        )
        .then(async (choice) => {
            if (choice !== CHECK_FOR_UPDATES_ACTION) {
                return;
            }
            await vscode.commands.executeCommand("workbench.extensions.action.checkForUpdates");
            await vscode.commands.executeCommand("extension.open", EXTENSION_ID);
        });
}

/**
 * Reports that the server is older than the supported version and aborts the connection.
 * @param serverVersion The server version that is older than the supported one.
 * @param modal Whether to show a modal dialog.
 */
async function blockOlderServer(serverVersion: string, modal: boolean): Promise<void> {
    logger.warn(
        `[serverVersionCheck] Unsupported server version. Supported: ${SUPPORTED_TESTBENCH_SERVER_VERSIONS}, Got: ${serverVersion}`
    );

    const compatibleExtensionVersion = LAST_COMPATIBLE_EXTENSION_VERSION[toMajorMinor(serverVersion)];
    const compatibleExtensionVersionText = compatibleExtensionVersion
        ? `The compatible version of VS Code TestBench Extension is: ${compatibleExtensionVersion}`
        : "No compatible extension version available.";

    await vscode.window.showErrorMessage(`Incompatible TestBench server version: ${serverVersion}`, {
        modal,
        detail: `This extension supports TestBench server versions ${SUPPORTED_TESTBENCH_SERVER_VERSIONS}

${compatibleExtensionVersionText}`
    });

    throw new DependencyVersionError("TestBench server", SUPPORTED_TESTBENCH_SERVER_VERSIONS, serverVersion);
}

/**
 * Reports that the server version could not be determined and aborts the connection.
 * @param serverVersion The unusable server version, possibly empty.
 * @param modal Whether to show a modal dialog.
 */
async function blockUndeterminedServer(serverVersion: string, modal: boolean): Promise<void> {
    logger.warn(`[serverVersionCheck] Server version '${serverVersion}' is empty or cannot be interpreted.`);

    await vscode.window.showErrorMessage(
        `Could not determine the TestBench server version. Please check your connection details.`,
        { modal }
    );

    throw new DependencyVersionError("TestBench server", SUPPORTED_TESTBENCH_SERVER_VERSIONS, "unknown");
}
