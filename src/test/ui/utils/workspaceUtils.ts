/**
 * @file src/test/ui/utils/workspaceUtils.ts
 * @description Workspace setup and cleanup helpers for UI tests.
 */

import { TEST_PATHS } from "../config/testConfig";
import { getTestLogger } from "./testLogger";
import { UITimeouts, waitForCondition } from "./waitHelpers";
import * as path from "path";
import * as fs from "fs";
import { VSBrowser, WebDriver, By, until, WebElement } from "vscode-extension-tester";

const logger = getTestLogger();
const DEFAULT_WORKSPACE_RELATIVE_PATH = `${TEST_PATHS.BASE_STORAGE}/${TEST_PATHS.WORKSPACE}`;

/**
 * Configuration options for opening a workspace.
 */
export interface WorkspaceConfig {
    /** Workspace path to open (relative to project root). Default: '.test-resources/workspace' */
    workspaceName?: string;
    /** If true, deletes the folder contents before opening. Default: false */
    cleanStart?: boolean;
}

/**
 * Configuration options for cleaning a workspace.
 */
export interface WorkspaceCleanupConfig {
    /** Array of file/folder names or paths to exclude from deletion (relative to workspace root) */
    exclude?: string[];
    /** Whether to exclude hidden files/folders (starting with .) by default. Default: false */
    excludeHidden?: boolean;
}

/**
 * Ensures a specific workspace folder is open in VS Code.
 * Handles creation, cleaning, and window reloading logic.
 *
 * @param config Configuration object for the workspace
 */
export async function ensureWorkspaceIsOpen(config: WorkspaceConfig = {}): Promise<void> {
    const { workspaceName = DEFAULT_WORKSPACE_RELATIVE_PATH, cleanStart = false } = config;
    const browser = VSBrowser.instance;
    const driver = browser.driver;

    // Resolve path relative to project root
    const projectRoot = path.resolve(__dirname, "../../../../");
    const workspacePath = path.resolve(projectRoot, workspaceName);

    if (cleanStart && fs.existsSync(workspacePath)) {
        logger.trace("Workspace", `Cleaning existing workspace: ${workspacePath}`);
        fs.rmSync(workspacePath, { recursive: true, force: true });
    }

    if (!fs.existsSync(workspacePath)) {
        logger.trace("Workspace", `Creating folder: ${workspacePath}`);
        fs.mkdirSync(workspacePath, { recursive: true });
    }

    // Check if the specific workspace is already open
    try {
        const title = await driver.getTitle();
        const folderName = path.basename(workspaceName);
        logger.trace("Workspace", `Current window title: '${title}'`);

        if (title && (title.includes(folderName) || title.includes(workspaceName))) {
            logger.trace("Workspace", `'${folderName}' appears to be already open.`);
            return;
        }
    } catch (error) {
        logger.debug("Workspace", `Could not check if workspace is open: ${error}`);
    }

    logger.trace("Workspace", `Opening folder: ${workspacePath}`);

    // Get current workbench element to detect staleness (reload)
    let oldWorkbench: WebElement | undefined;
    try {
        oldWorkbench = await driver.findElement(By.className("monaco-workbench"));
    } catch {
        // Element might not exist
    }

    await browser.openResources(workspacePath);

    // Wait for the old workbench to become stale (reload started)
    if (oldWorkbench) {
        try {
            await driver.wait(until.stalenessOf(oldWorkbench), UITimeouts.LONG, "Waiting for VS Code reload to start");
        } catch {
            logger.warn("Workspace", "Window reload detected via staleness timed out or was too fast.");
        }
    }

    // Ensure driver context is correct
    await driver.switchTo().defaultContent();

    logger.trace("Workspace", "Waiting for workbench to load...");

    // Wait for the workbench to fully reload.
    // Using generic class selector which is more stable than ID
    const workbenchLoaded = await waitForCondition(
        driver,
        async () => {
            try {
                const workbenches = await driver.findElements(By.className("monaco-workbench"));
                return workbenches.length > 0;
            } catch {
                return false;
            }
        },
        UITimeouts.WORKSPACE_LOAD,
        200,
        `workspace "${workspaceName}" workbench to load`
    );
    if (!workbenchLoaded) {
        throw new Error(`Timeout waiting for workspace '${workspaceName}' to load`);
    }

    const statusBarReady = await waitForCondition(
        driver,
        async () => {
            try {
                const statusBars = await driver.findElements(By.id("workbench.parts.statusbar"));
                return statusBars.length > 0;
            } catch {
                return false;
            }
        },
        UITimeouts.VERY_LONG,
        200,
        `workspace "${workspaceName}" status bar readiness`
    );
    if (!statusBarReady) {
        logger.warn("Workspace", "Status bar not found, proceeding anyway.");
    }

    logger.trace("Workspace", `Workspace '${workspaceName}' loaded successfully.`);
}

/**
 * Gets the current workspace folder path from VS Code.
 * Uses the window title to determine the workspace path.
 *
 * @param driver - The WebDriver instance
 * @returns Promise<string | null> - The workspace path or null if not found
 */
export async function getCurrentWorkspacePath(driver: WebDriver): Promise<string | null> {
    try {
        // Get the window title which typically contains the workspace folder name
        const title = await driver.getTitle();
        if (!title) {
            logger.debug("Workspace", "Could not get window title");
            return null;
        }

        // Try to extract workspace path from title
        const projectRoot = path.resolve(__dirname, "../../../../");
        const possibleWorkspaceNames = [DEFAULT_WORKSPACE_RELATIVE_PATH, TEST_PATHS.WORKSPACE];

        for (const workspaceName of possibleWorkspaceNames) {
            const workspacePath = path.join(projectRoot, workspaceName);
            if (fs.existsSync(workspacePath)) {
                // Check if the title matches this workspace
                const folderName = path.basename(workspaceName);
                if (title.includes(folderName) || title.includes(workspaceName)) {
                    return workspacePath;
                }
            }
        }

        const defaultWorkspace = path.resolve(projectRoot, DEFAULT_WORKSPACE_RELATIVE_PATH);
        if (fs.existsSync(defaultWorkspace)) {
            return defaultWorkspace;
        }

        logger.debug("Workspace", "Could not determine workspace path from title");
        return null;
    } catch (error) {
        logger.error("Workspace", `Error getting workspace path: ${error}`);
        return null;
    }
}

/**
 * Cleans up the workspace by removing all files and folders,
 * with optional exclusions for specific files/folders.
 *
 * @param driver - The WebDriver instance (optional, for getting workspace path)
 * @param workspacePath - Optional explicit workspace path. If not provided, will try to detect from VS Code
 * @param config - Configuration for cleanup, including exclusions
 * @returns Promise<boolean> - True if cleanup was successful, false otherwise
 */
export async function cleanupWorkspace(
    driver?: WebDriver,
    workspacePath?: string,
    config: WorkspaceCleanupConfig = {}
): Promise<boolean> {
    const { exclude = [], excludeHidden = false } = config;

    try {
        // Determine workspace path
        let targetPath: string | null = workspacePath || null;

        if (!targetPath && driver) {
            targetPath = await getCurrentWorkspacePath(driver);
        }

        if (!targetPath) {
            // Fallback to default workspace
            const projectRoot = path.resolve(__dirname, "../../../../");
            targetPath = path.resolve(projectRoot, DEFAULT_WORKSPACE_RELATIVE_PATH);
        }

        if (!fs.existsSync(targetPath)) {
            logger.debug("Workspace Cleanup", `Workspace path does not exist: ${targetPath}`);
            return false;
        }

        logger.trace("Workspace Cleanup", `Cleaning workspace: ${targetPath}`);
        logger.trace("Workspace Cleanup", `Excluding: ${exclude.length > 0 ? exclude.join(", ") : "none"}`);

        // Normalize exclude paths to handle both relative and absolute paths
        const normalizedExcludes = exclude.map((item) => {
            if (path.isAbsolute(item)) {
                return item;
            }
            return path.join(targetPath, item);
        });

        // Function to check if a path should be excluded
        const shouldExclude = (itemPath: string, itemName: string): boolean => {
            // Check explicit exclusions
            for (const excludePath of normalizedExcludes) {
                if (itemPath === excludePath || itemPath.startsWith(excludePath + path.sep)) {
                    return true;
                }
            }

            // Check hidden files/folders if enabled
            if (excludeHidden && itemName.startsWith(".")) {
                return true;
            }

            return false;
        };

        // Get all items in the workspace
        const items = fs.readdirSync(targetPath, { withFileTypes: true });
        let deletedCount = 0;
        let skippedCount = 0;

        for (const item of items) {
            const itemPath = path.join(targetPath, item.name);

            if (shouldExclude(itemPath, item.name)) {
                logger.trace("Workspace Cleanup", `Excluding: ${item.name}`);
                skippedCount++;
                continue;
            }

            try {
                if (item.isDirectory()) {
                    fs.rmSync(itemPath, { recursive: true, force: true });
                    logger.trace("Workspace Cleanup", `Deleted folder: ${item.name}`);
                } else {
                    fs.unlinkSync(itemPath);
                    logger.trace("Workspace Cleanup", `Deleted file: ${item.name}`);
                }
                deletedCount++;
            } catch (error) {
                logger.error("Workspace Cleanup", `Error deleting ${item.name}: ${error}`);
            }
        }

        logger.trace("Workspace Cleanup", `Cleanup complete. Deleted: ${deletedCount}, Excluded: ${skippedCount}`);
        return true;
    } catch (error) {
        logger.error("Workspace Cleanup", `Error during cleanup: ${error}`);
        return false;
    }
}
