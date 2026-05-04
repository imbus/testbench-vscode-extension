/**
 * @file src/test/ui/contextConfiguration.ui.test.ts
 * @description UI tests for Context Configuration features including:
 * - Active Project/TOV marking with pin icons
 * - Right-click context menu "Set as Active Project/TOV"
 * - ls.config.json file creation and updates
 * - Configuration validation and quick fix
 * - Pin icon visibility for active items
 */

import { expect } from "chai";
import { SideBarView, ContextMenu } from "vscode-extension-tester";
import * as fs from "fs";
import * as path from "path";
import { getTestLogger } from "./utils/testLogger";
import { applySlowMotion, waitForTreeItems, UITimeouts, waitForNotification } from "./utils/testUtils";
import { clickToolbarButton } from "./utils/toolbarUtils";
import { hasPinIcon } from "./utils/treeItemUtils";
import { getTestData, logTestDataConfig } from "./config/testConfig";
import { TestContext, setupTestHooks, skipTest } from "./utils/testHooks";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";

const logger = getTestLogger();

function skipPrecondition(context: Mocha.Context, reason: string): never {
    return skipTest(context, "precondition", reason);
}

function skipError(_context: Mocha.Context, reason: string): never {
    throw new Error(reason);
}

/**
 * Gets the path to the ls.config.json file in the given workspace.
 * @param workspacePath - The path to the workspace
 * @return The full path to the ls.config.json file
 */
function getLsConfigPath(workspacePath: string): string {
    return path.join(workspacePath, ".testbench", "ls.config.json");
}

/**
 * Reads the ls.config.json file from the given workspace.
 * @param workspacePath - The path to the workspace
 * @return The parsed config object, or null if not found or invalid
 */
function readLsConfig(workspacePath: string): { projectName?: string; tovName?: string } | null {
    const configPath = getLsConfigPath(workspacePath);
    if (!fs.existsSync(configPath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
        return null;
    }
}

/**
 * Writes the ls.config.json file to the given workspace.
 * @param workspacePath - The path to the workspace
 * @param config - The config object to write
 * @return True if write was successful, false otherwise
 */
function writeLsConfig(workspacePath: string, config: { projectName?: string; tovName?: string }): boolean {
    const configPath = getLsConfigPath(workspacePath);
    const configDir = path.dirname(configPath);
    try {
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        return true;
    } catch {
        return false;
    }
}

/**
 * Deletes the ls.config.json file from the given workspace.
 * @param workspacePath - The path to the workspace
 * @return True if deletion was successful, false otherwise
 */
function deleteLsConfig(workspacePath: string): boolean {
    const configPath = getLsConfigPath(workspacePath);
    if (fs.existsSync(configPath)) {
        try {
            fs.unlinkSync(configPath);
            return true;
        } catch {
            return false;
        }
    }
    return false;
}

/**
 * Gets the path to the test workspace.
 * @returns The absolute path to the test workspace
 */
function getWorkspacePath(): string {
    return path.resolve(__dirname, "../../../.test-resources/workspace");
}

/**
 * Opens the context menu on a tree item.
 * @param item - The tree item
 * @param driver - The WebDriver instance
 * @return The opened ContextMenu, or null if failed
 */
async function openContextMenu(item: any, driver: any): Promise<ContextMenu | null> {
    try {
        await item.click();
        await applySlowMotion(driver);
        return await item.openContextMenu();
    } catch (error) {
        logger.debug("ContextMenu", `Error opening context menu: ${error}`);
        return null;
    }
}

/**
 * Clicks a menu item in the context menu.
 * @param contextMenu - The context menu
 * @param itemLabel - The label of the menu item to click
 * @param _driver - The WebDriver instance (optional)
 * @return True if the item was clicked, false otherwise
 */
async function clickMenuItem(contextMenu: ContextMenu, itemLabel: string, _driver?: any): Promise<boolean> {
    try {
        // Try exact match
        const menuItem = await contextMenu.getItem(itemLabel);
        if (menuItem) {
            await menuItem.select();
            return true;
        }

        // Try partial match
        const items = await contextMenu.getItems();
        for (const item of items) {
            const label = await item.getLabel();
            if (label.includes(itemLabel)) {
                await item.select();
                return true;
            }
        }
        return false;
    } catch (error) {
        logger.debug("ContextMenu", `Error clicking menu item: ${error}`);
        return false;
    }
}

/**
 * Checks if a context menu has a specific menu item.
 * @param contextMenu - The context menu
 * @param itemLabel - The label of the menu item to check
 * @return True if the menu item exists, false otherwise
 */
async function hasMenuItem(contextMenu: ContextMenu, itemLabel: string): Promise<boolean> {
    try {
        const items = await contextMenu.getItems();
        for (const item of items) {
            const label = await item.getLabel();
            if (label.includes(itemLabel)) {
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Closes the context menu.
 * @param contextMenu - The context menu to close
 * @return Promise that resolves when the menu is closed
 */
async function closeContextMenu(contextMenu: ContextMenu): Promise<void> {
    try {
        await contextMenu.close();
    } catch {
        // Ignore close errors
    }
}

/**
 * Waits for the quick-pick prompt shown by ls.config validation flow.
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait
 * @returns True when validation quick-pick is visible
 */
async function waitForValidationQuickPick(driver: any, timeout: number = UITimeouts.LONG): Promise<boolean> {
    try {
        await driver.wait(
            async () => {
                const promptVisible = await driver.executeScript(`
                    const quickInput = document.querySelector('.quick-input-widget');
                    if (!quickInput) {
                        return false;
                    }

                    const style = window.getComputedStyle(quickInput);
                    if (style.display === 'none' || style.visibility === 'hidden') {
                        return false;
                    }

                    const text = (quickInput.textContent || '').toLowerCase();
                    return (
                        text.includes('select testbench project') ||
                        text.includes('config is invalid') ||
                        text.includes('choose a project')
                    );
                `);

                return Boolean(promptVisible);
            },
            timeout,
            "Waiting for ls.config validation quick-pick"
        );
        return true;
    } catch {
        return false;
    }
}

describe("Context Configuration UI Tests", function () {
    const ctx: TestContext = {} as TestContext;
    let workspacePath: string;

    this.timeout(180000);

    setupTestHooks(ctx, {
        suiteName: "ContextConfiguration",
        requiresLogin: true,
        openSidebar: true,
        timeout: 180000
    });

    before(function () {
        workspacePath = getWorkspacePath();
        logger.info("Setup", `Workspace path: ${workspacePath}`);
    });

    const getDriver = () => ctx.driver;

    /**
     * Gets Projects section from sidebar.
     */
    async function getProjectsSection(): Promise<any> {
        const driver = getDriver();
        const projectsPage = new ProjectsViewPage(driver);
        const sideBar = new SideBarView();
        const content = sideBar.getContent();
        return await projectsPage.getSection(content);
    }

    describe("ls.config.json File Management", function () {
        it("should create ls.config.json when opening a cycle for the first time", async function () {
            const driver = getDriver();
            const config = getTestData();
            logTestDataConfig();
            const projectsPage = new ProjectsViewPage(driver);

            // Delete existing config to simulate first-time scenario
            const isConfigDeleted = deleteLsConfig(workspacePath);
            if (isConfigDeleted) {
                logger.info("Config", "Deleted existing ls.config.json");
            }

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                skipPrecondition(this, `Project '${config.projectName}' not found`);
            }

            const version = await projectsPage.getVersion(project, config.versionName);
            if (!version) {
                skipPrecondition(this, `Version '${config.versionName}' not found`);
            }

            const cycle = await projectsPage.getCycle(version, config.cycleName);
            if (!cycle) {
                skipPrecondition(this, `Cycle '${config.cycleName}' not found`);
            }

            // Click cycle to trigger configuration prompt
            await cycle.click();
            await applySlowMotion(driver);

            const notificationAppeared = await waitForNotification(
                driver,
                "TestBench project configuration",
                UITimeouts.LONG
            );

            if (notificationAppeared) {
                logger.info("Config", "Configuration notification appeared");

                // Use clickNotificationButton utility for better reliability
                const { clickNotificationButton } = await import("./utils/testUtils");
                const createButtonClicked = await clickNotificationButton(driver, "Create");

                expect(createButtonClicked, "Should click Create button in configuration notification").to.equal(true);
                logger.info("Config", "Clicked Create button in notification");
                // Wait longer for config file to be written
                await driver.sleep(3000);
            }

            expect(
                notificationAppeared,
                "Configuration notification should appear when opening an unconfigured cycle"
            ).to.equal(true);

            // Check if config file was created
            const configAfter = readLsConfig(workspacePath);

            if (configAfter) {
                logger.info("Config", `ls.config.json created: ${JSON.stringify(configAfter)}`);
                expect(configAfter.projectName).to.equal(config.projectName);
                expect(configAfter.tovName).to.equal(config.versionName);
            } else {
                throw new Error("ls.config.json should be created after accepting configuration prompt");
            }
        });

        it("should read existing ls.config.json correctly", async function () {
            const configPath = getLsConfigPath(workspacePath);

            if (!fs.existsSync(configPath)) {
                logger.info("Config", "No existing config file to verify");
                skipPrecondition(this, "No existing ls.config.json file to verify");
            }

            const config = readLsConfig(workspacePath);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(config, "Config should be readable").to.not.be.null;

            if (config) {
                logger.info(
                    "Config",
                    `Current config: projectName="${config.projectName}", tovName="${config.tovName}"`
                );
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                expect(config.projectName, "Should have projectName").to.not.be.undefined;
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                expect(config.tovName, "Should have tovName").to.not.be.undefined;
            }
        });
    });

    describe("Active Project/TOV Context Menu", function () {
        it("should have 'Set as Active Project' in project context menu", async function () {
            const driver = getDriver();
            const config = getTestData();
            const projectsPage = new ProjectsViewPage(driver);

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                skipPrecondition(this, `Project '${config.projectName}' not found`);
            }

            const contextMenu = await openContextMenu(project, driver);
            if (!contextMenu) {
                logger.warn("ContextMenu", "Could not open context menu on project");
                skipError(this, "Could not open context menu on project");
            }

            const hasSetActive = await hasMenuItem(contextMenu, "Set as Active");
            await closeContextMenu(contextMenu);

            expect(hasSetActive, "Project context menu should include 'Set as Active' action").to.equal(true);
            logger.info("ContextMenu", "'Set as Active' menu item found on project");
        });

        it("should have 'Set as Active TOV' in version context menu", async function () {
            const driver = getDriver();
            const config = getTestData();
            const projectsPage = new ProjectsViewPage(driver);

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                skipPrecondition(this, `Project '${config.projectName}' not found`);
            }

            const version = await projectsPage.getVersion(project, config.versionName);
            if (!version) {
                skipPrecondition(this, `Version '${config.versionName}' not found`);
            }

            const contextMenu = await openContextMenu(version, driver);
            if (!contextMenu) {
                logger.warn("ContextMenu", "Could not open context menu on version");
                skipError(this, "Could not open context menu on version");
            }

            const hasSetActive = await hasMenuItem(contextMenu, "Set as Active");
            await closeContextMenu(contextMenu);

            expect(hasSetActive, "Version context menu should include 'Set as Active' action").to.equal(true);
            logger.info("ContextMenu", "'Set as Active TOV' menu item found on version");
        });

        it("should set project as active and show pin icon", async function () {
            const driver = getDriver();
            const config = getTestData();
            const projectsPage = new ProjectsViewPage(driver);

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                skipPrecondition(this, `Project '${config.projectName}' not found`);
            }

            const contextMenu = await openContextMenu(project, driver);
            if (!contextMenu) {
                skipError(this, "Could not open context menu for active project selection");
            }

            // Use the full menu item label "Set as Active Project"
            const projectActivationClicked = await clickMenuItem(contextMenu, "Set as Active Project", driver);
            if (!projectActivationClicked) {
                logger.info("ContextMenu", "Could not click 'Set as Active Project' - trying partial match");
                await closeContextMenu(contextMenu);
                skipError(this, "Could not click 'Set as Active Project' context menu item");
            }

            await applySlowMotion(driver);
            await driver.sleep(2000); // Wait for config to be written

            // Re-fetch project and check for pin icon
            const sideBar = new SideBarView();
            const refreshedContent = sideBar.getContent();
            const refreshedSection = await projectsPage.getSection(refreshedContent);

            expect(
                refreshedSection !== null && refreshedSection !== undefined,
                "Projects section should refresh"
            ).to.equal(true);

            if (refreshedSection) {
                const refreshedProject = await projectsPage.getProject(refreshedSection, config.projectName);
                expect(
                    refreshedProject !== null && refreshedProject !== undefined,
                    "Active project should still be visible after activation"
                ).to.equal(true);

                if (refreshedProject) {
                    const hasPin = await hasPinIcon(refreshedProject, driver);
                    expect(hasPin, "Pin icon should be visible on active project").to.equal(true);
                    logger.info("ContextMenu", "Pin icon visible on active project");
                }
            }

            // Verify config was updated
            const updatedConfig = readLsConfig(workspacePath);
            expect(updatedConfig !== null, "Config file should exist after setting active project").to.equal(true);
            if (updatedConfig) {
                expect(updatedConfig.projectName).to.equal(config.projectName);
                logger.info("ContextMenu", "Config updated with active project");
            }
        });
    });

    describe("Pin Icon Display", function () {
        // Ensure configuration exists before pin icon tests
        before(async function () {
            const currentConfig = readLsConfig(workspacePath);
            if (!currentConfig || !currentConfig.projectName) {
                logger.info("PinIcon", "No config file - creating one via Set as Active Project");
                const driver = ctx.driver;
                const config = getTestData();
                const projectsPage = new ProjectsViewPage(driver);

                const sideBar = new SideBarView();
                const content = sideBar.getContent();
                const projectsSection = await projectsPage.getSection(content);

                if (projectsSection) {
                    await waitForTreeItems(projectsSection, driver);
                    const project = await projectsPage.getProject(projectsSection, config.projectName);
                    if (project) {
                        const contextMenu = await openContextMenu(project, driver);
                        if (contextMenu) {
                            await clickMenuItem(contextMenu, "Set as Active Project", driver);
                            await driver.sleep(2000);
                        }
                    }
                }
            }
        });

        it("should show pin icon on active project", async function () {
            const driver = getDriver();
            const projectsPage = new ProjectsViewPage(driver);
            const config = getTestData();

            const currentConfig = readLsConfig(workspacePath);
            const projectName = currentConfig?.projectName || config.projectName;

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            await waitForTreeItems(projectsSection, driver);

            const activeProject = await projectsPage.getProject(projectsSection, projectName);
            if (!activeProject) {
                logger.warn("PinIcon", `Project "${projectName}" not found in tree`);
                skipPrecondition(this, `Project '${projectName}' not found in tree`);
            }

            const hasPin = await hasPinIcon(activeProject, driver);
            logger.info("PinIcon", `Pin icon on "${projectName}": ${hasPin}`);
            expect(hasPin, `Pin icon should be visible on active project '${projectName}'`).to.equal(true);
        });

        it("should show pin icon on active TOV", async function () {
            const driver = getDriver();
            const projectsPage = new ProjectsViewPage(driver);
            const config = getTestData();

            const currentConfig = readLsConfig(workspacePath);
            const projectName = currentConfig?.projectName || config.projectName;
            const tovName = currentConfig?.tovName || config.versionName;

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                skipPrecondition(this, "Projects section not found");
            }

            await waitForTreeItems(projectsSection, driver);

            const activeProject = await projectsPage.getProject(projectsSection, projectName);
            if (!activeProject) {
                skipPrecondition(this, `Project '${projectName}' not found in tree`);
            }

            const activeTov = await projectsPage.getVersion(activeProject, tovName);
            if (!activeTov) {
                logger.warn("PinIcon", `TOV "${tovName}" not found`);
                skipPrecondition(this, `TOV '${tovName}' not found`);
            }

            const hasPin = await hasPinIcon(activeTov, driver);
            logger.info("PinIcon", `Pin icon on TOV "${tovName}": ${hasPin}`);
            expect(hasPin, `Pin icon should be visible on active TOV '${tovName}'`).to.equal(true);
        });
    });

    describe("Configuration Validation", function () {
        it("should detect when ls.config.json has invalid project name", async function () {
            const driver = getDriver();
            const projectsPage = new ProjectsViewPage(driver);
            const testConfig = getTestData();

            const invalidConfig = {
                projectName: "NonExistentProject_12345",
                tovName: testConfig.versionName
            };

            writeLsConfig(workspacePath, invalidConfig);
            logger.info("Validation", "Written invalid config with non-existent project");

            // Trigger refresh to validate
            const projectsSection = await getProjectsSection();
            if (projectsSection) {
                let refreshClicked = await projectsPage.clickToolbarAction(projectsSection, "Refresh");
                if (!refreshClicked) {
                    refreshClicked = await clickToolbarButton(projectsSection, "Refresh Projects", driver);
                }
                if (!refreshClicked) {
                    refreshClicked = await clickToolbarButton(projectsSection, "Refresh", driver);
                }

                expect(refreshClicked, "Refresh action should be clickable to trigger validation").to.equal(true);
                await driver.sleep(2000);
            } else {
                skipPrecondition(this, "Projects section not found for validation test");
            }

            const validationNotification = await waitForNotification(driver, "configuration", UITimeouts.LONG);
            const validationQuickPick = validationNotification ? false : await waitForValidationQuickPick(driver);

            expect(
                validationNotification || validationQuickPick,
                "Validation UI feedback should appear for invalid configuration"
            ).to.equal(true);
            logger.info(
                "Validation",
                validationNotification
                    ? "Configuration validation notification appeared"
                    : "Configuration validation quick-pick appeared"
            );

            // Restore valid config
            const validConfig = {
                projectName: testConfig.projectName,
                tovName: testConfig.versionName
            };
            writeLsConfig(workspacePath, validConfig);
            logger.info("Validation", "Restored valid config");
        });
    });
});
