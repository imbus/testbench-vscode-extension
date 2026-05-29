/**
 * @file src/test/ui/runners/runnerBootstrap.ts
 * @description Shared bootstrap/setup helpers used by all UI test runners.
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import { ExTester, ReleaseQuality } from "vscode-extension-tester";
import { TEST_PATHS } from "../config/testConfig";

/**
 * Logger contract used by runner bootstrap helpers.
 */
export interface RunnerBootstrapLogger {
    /**
     * Logs an informational message.
     *
     * @param prefix Short area/category label.
     * @param message Human-readable log message.
     */
    info(prefix: string, message: string): void;
    /**
     * Logs a warning message.
     *
     * @param prefix Short area/category label.
     * @param message Human-readable warning message.
     */
    warn(prefix: string, message: string): void;
    /**
     * Logs an error message.
     *
     * @param prefix Short area/category label.
     * @param message Human-readable error message.
     */
    error(prefix: string, message: string): void;
}

/**
 * Common path set used by UI runners.
 */
export interface RunnerPaths {
    /** Root directory for transient test artifacts. */
    baseStoragePath: string;
    /** Directory used by ExTester to store VS Code binaries. */
    testStoragePath: string;
    /** Directory for extension artifacts used during test runs. */
    extensionsPath: string;
    /** Runtime workspace copied from fixtures for each run. */
    runtimeWorkspacePath: string;
    /** Source fixtures directory copied into runtime workspace. */
    fixturesPath: string;
    /** Absolute path to package.json used for VSIX metadata. */
    packageJsonPath: string;
}

/**
 * VSIX artifact metadata.
 */
export interface VsixArtifact {
    /** Computed VSIX filename using package name/version. */
    vsixName: string;
    /** Absolute path to the VSIX file on disk. */
    vsixPath: string;
}

/**
 * Options for one setup pass of ExTester assets.
 */
export interface SetupExTesterEnvironmentOptions {
    /** Directory used by ExTester for VS Code binaries. */
    testStoragePath: string;
    /** Directory where extensions are installed for test runs. */
    extensionsPath: string;
    /** Absolute path to the extension VSIX file. */
    vsixPath: string;
    /** Logger implementation used for setup diagnostics. */
    logger: RunnerBootstrapLogger;
    /** When true, remove existing VS Code data before setup. */
    forceClean?: boolean;
    /** When true, skip VS Code and ChromeDriver download steps. */
    skipVsCodeDownloadAndDriver?: boolean;
    /** When true, install the extension VSIX after setup. */
    installVsix?: boolean;
}

const ARCHIVE_CORRUPTION_TOKENS: string[] = ["FILE_ENDED", "end of central directory", "invalid signature"];

interface PackageManifest {
    name: string;
    version: string;
}

/**
 * Builds the standard runner paths for a project root.
 *
 * @param projectRoot Repository root directory.
 * @returns Normalized path structure used by UI runners.
 */
export function createRunnerPaths(projectRoot: string): RunnerPaths {
    const baseStoragePath = path.resolve(projectRoot, TEST_PATHS.BASE_STORAGE);

    return {
        baseStoragePath,
        testStoragePath: path.join(baseStoragePath, TEST_PATHS.VSCODE_DATA),
        extensionsPath: path.join(baseStoragePath, TEST_PATHS.EXTENSIONS),
        runtimeWorkspacePath: path.join(baseStoragePath, TEST_PATHS.WORKSPACE),
        fixturesPath: path.resolve(projectRoot, TEST_PATHS.FIXTURES),
        packageJsonPath: path.join(projectRoot, TEST_PATHS.PACKAGE_JSON)
    };
}

/**
 * Recreates the runtime workspace from fixtures (or creates an empty workspace).
 *
 * @param paths Standard runner paths.
 * @param logger Logger used for workspace preparation diagnostics.
 */
export function prepareRuntimeWorkspace(paths: RunnerPaths, logger: RunnerBootstrapLogger): void {
    if (fs.existsSync(paths.runtimeWorkspacePath)) {
        fs.rmSync(paths.runtimeWorkspacePath, { recursive: true, force: true });
    }

    if (fs.existsSync(paths.fixturesPath)) {
        logger.info("Setup", `Copying fixtures from '${paths.fixturesPath}' to '${paths.runtimeWorkspacePath}'...`);
        fs.cpSync(paths.fixturesPath, paths.runtimeWorkspacePath, { recursive: true });
    } else {
        logger.warn("Setup", `No fixtures found at '${paths.fixturesPath}'. Creating empty workspace.`);
        fs.mkdirSync(paths.runtimeWorkspacePath, { recursive: true });
    }
}

/**
 * Ensures a VSIX package is available and returns its descriptor.
 *
 * @param projectRoot Repository root directory.
 * @param packageJsonPath Absolute path to package.json.
 * @param logger Logger used for setup diagnostics.
 * @returns VSIX filename and absolute path.
 */
export function ensureVsixPackage(
    projectRoot: string,
    packageJsonPath: string,
    logger: RunnerBootstrapLogger
): VsixArtifact {
    if (!fs.existsSync(packageJsonPath)) {
        throw new Error(`${TEST_PATHS.PACKAGE_JSON} not found at ${packageJsonPath}`);
    }

    const packageJson = readPackageManifest(packageJsonPath);
    const vsixName = `${packageJson.name}-${packageJson.version}.vsix`;
    const vsixPath = path.join(projectRoot, vsixName);

    if (fs.existsSync(vsixPath)) {
        logger.info("Setup", `Found existing VSIX: ${vsixName}. Skipping package creation.`);
    } else {
        logger.info("Setup", `VSIX not found (${vsixName}). Creating package...`);
        try {
            cp.execSync("npm run vsix-package", {
                cwd: projectRoot,
                stdio: "inherit"
            });
            logger.info("Setup", "VSIX package created successfully.");
        } catch (error) {
            logger.error("Setup", "Failed to create VSIX package.");
            throw error;
        }
    }

    return { vsixName, vsixPath };
}

/**
 * Returns true when an existing VS Code test binary already exists under test storage.
 *
 * @param testStoragePath ExTester VS Code data directory.
 * @returns True when a VS Code installation is detected.
 */
export function hasExistingVSCodeInstallation(testStoragePath: string): boolean {
    return (
        fs.existsSync(testStoragePath) &&
        fs.readdirSync(testStoragePath).some((fileName) => fileName.includes("vscode"))
    );
}

/**
 * Performs one setup pass for ExTester (download, driver, extension install).
 *
 * @param options Setup behavior and path options.
 * @returns Initialized ExTester instance for running tests.
 */
export async function setupExTesterEnvironment(options: SetupExTesterEnvironmentOptions): Promise<ExTester> {
    const {
        testStoragePath,
        extensionsPath,
        vsixPath,
        logger,
        forceClean = false,
        skipVsCodeDownloadAndDriver = false,
        installVsix = true
    } = options;

    if (forceClean) {
        logger.info("Setup", "Cleaning VS Code data...");
        if (fs.existsSync(testStoragePath)) {
            fs.rmSync(testStoragePath, { recursive: true, force: true });
        }
    }

    const tester = new ExTester(testStoragePath, ReleaseQuality.Stable, extensionsPath);

    if (skipVsCodeDownloadAndDriver) {
        logger.info("Setup", "Skipping VS Code and ChromeDriver download (--skip-setup flag)");
    } else {
        const hasExistingVSCode = hasExistingVSCodeInstallation(testStoragePath);

        if (hasExistingVSCode && !forceClean) {
            logger.info("Setup", "Detected existing VS Code. Skipping download.");
        } else {
            logger.info("Setup", "Downloading VS Code...");
            await tester.downloadCode();
        }

        await tester.downloadChromeDriver();
    }

    if (installVsix) {
        logger.info("Setup", `Installing extension from: ${vsixPath}`);
        await tester.installVsix({
            vsixFile: vsixPath,
            installDependencies: true
        });
    }

    return tester;
}

/**
 * Detects corrupted archive/download errors from ExTester setup operations.
 *
 * @param error Unknown error value caught from setup steps.
 * @returns True when the error matches known archive corruption signatures.
 */
export function isArchiveCorruptionError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    return ARCHIVE_CORRUPTION_TOKENS.some((token) => error.message.includes(token));
}

/**
 * Reads and validates the package.json manifest for VSIX packaging.
 * @param packageJsonPath Absolute path to the package.json file.
 * @returns Parsed package manifest with required fields.
 */
function readPackageManifest(packageJsonPath: string): PackageManifest {
    const parsedManifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as Partial<PackageManifest>;

    if (!parsedManifest.name || !parsedManifest.version) {
        throw new Error(`Invalid package metadata in ${packageJsonPath}. Expected 'name' and 'version'.`);
    }

    return {
        name: parsedManifest.name,
        version: parsedManifest.version
    };
}
