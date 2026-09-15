/**
 * @file src/serverVersionCheck.ts
 * @description Checks the version of the connected TestBench server against the version
 * this extension supports. A server older than the supported version is known not to work
 * and blocks the connection. A server newer than the supported version is simply unknown to
 * this extension, so it only produces a warning and work continues.
 */

import * as vscode from "vscode";
import { logger } from "./extension";
import { DependencyVersionError } from "./errors";
import { EXTENSION_ID } from "./constants";

/** The TestBench server version (major.minor) this extension is built against. */
export const SUPPORTED_TESTBENCH_SERVER_VERSION = "4.1";

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
 * Compares a server version against the supported TestBench version.
 * @param serverVersion The version reported by the TestBench server.
 * @param supportedVersion The version supported by this extension.
 * @returns Whether the server is unknown, older than, equal to, or newer than the supported version.
 */
export function classifyServerVersion(
    serverVersion: string,
    supportedVersion: string = SUPPORTED_TESTBENCH_SERVER_VERSION
): ServerVersionVerdict {
    const server = parseMajorMinor(serverVersion);
    const supported = parseMajorMinor(supportedVersion);

    if (!server || !supported) {
        return "unknown";
    }
    if (server[0] !== supported[0]) {
        return server[0] < supported[0] ? "older" : "newer";
    }
    if (server[1] !== supported[1]) {
        return server[1] < supported[1] ? "older" : "newer";
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
        `[serverVersionCheck] Server version ${serverVersion} is newer than the supported version ${SUPPORTED_TESTBENCH_SERVER_VERSION}.`
    );

    // Deliberately not awaited: the notification must never delay the login flow.
    void vscode.window
        .showWarningMessage(
            `Connected TestBench server ${serverVersion} is newer than TestBench ${SUPPORTED_TESTBENCH_SERVER_VERSION}, the version supported by TestBench extension ${extensionVersion}. You can keep working; if something behaves unexpectedly, an extension update may be required.`,
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
        `[serverVersionCheck] Server version mismatch. Expected: ${SUPPORTED_TESTBENCH_SERVER_VERSION}, Got: ${serverVersion}`
    );

    const compatibleExtensionVersion = LAST_COMPATIBLE_EXTENSION_VERSION[toMajorMinor(serverVersion)];
    const compatibleExtensionVersionText = compatibleExtensionVersion
        ? `The compatible version of VS Code TestBench Extension is: ${compatibleExtensionVersion}`
        : "No compatible extension version available.";

    await vscode.window.showErrorMessage(`Incompatible TestBench server version: ${serverVersion}`, {
        modal,
        detail: `This extension expects TestBench server version ${SUPPORTED_TESTBENCH_SERVER_VERSION}

${compatibleExtensionVersionText}`
    });

    throw new DependencyVersionError("TestBench server", SUPPORTED_TESTBENCH_SERVER_VERSION, serverVersion);
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

    throw new DependencyVersionError("TestBench server", SUPPORTED_TESTBENCH_SERVER_VERSION, "unknown");
}
