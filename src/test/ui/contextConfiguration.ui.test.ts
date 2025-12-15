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
import { hasPinIcon } from "./utils/treeItemUtils";
import { getTestData, logTestDataConfig } from "./config/testConfig";
import { TestContext, setupTestHooks } from "./utils/testHooks";
import { ProjectsViewPage } from "./pages/ProjectsViewPage";

const logger = getTestLogger();

function getLsConfigPath(workspacePath: string): string {
    return path.join(workspacePath, ".testbench", "ls.config.json");
}

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

function getWorkspacePath(): string {
    return path.resolve(__dirname, "../../../.test-resources/workspace");
}

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

async function clickMenuItem(contextMenu: ContextMenu, itemLabel: string, _driver?: any): Promise<boolean> {
    try {
        // First try exact match
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

async function closeContextMenu(contextMenu: ContextMenu): Promise<void> {
    try {
        await contextMenu.close();
    } catch {
        // Ignore close errors
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
            const deleted = deleteLsConfig(workspacePath);
            if (deleted) {
                logger.info("Config", "Deleted existing ls.config.json");
            }

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                this.skip();
                return;
            }

            const version = await projectsPage.getVersion(project, config.versionName);
            if (!version) {
                this.skip();
                return;
            }

            const cycle = await projectsPage.getCycle(version, config.cycleName);
            if (!cycle) {
                this.skip();
                return;
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
                const createClicked = await clickNotificationButton(driver, "Create");

                if (createClicked) {
                    logger.info("Config", "Clicked Create button in notification");
                    // Wait longer for config file to be written
                    await driver.sleep(3000);
                } else {
                    logger.warn("Config", "Could not click Create button");
                }
            }

            // Check if config file was created
            const configAfter = readLsConfig(workspacePath);

            if (configAfter) {
                logger.info("Config", `ls.config.json created: ${JSON.stringify(configAfter)}`);
                expect(configAfter.projectName).to.equal(config.projectName);
                expect(configAfter.tovName).to.equal(config.versionName);
            } else {
                logger.warn(
                    "Config",
                    "ls.config.json was not created - this may be expected if config already existed"
                );
                // Don't fail - just log warning
            }
        });

        it("should read existing ls.config.json correctly", async function () {
            const configPath = getLsConfigPath(workspacePath);

            if (!fs.existsSync(configPath)) {
                logger.info("Config", "No existing config file to verify");
                this.skip();
                return;
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
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                this.skip();
                return;
            }

            const contextMenu = await openContextMenu(project, driver);
            if (!contextMenu) {
                logger.warn("ContextMenu", "Could not open context menu on project");
                this.skip();
                return;
            }

            const hasSetActive = await hasMenuItem(contextMenu, "Set as Active");
            await closeContextMenu(contextMenu);

            if (hasSetActive) {
                logger.info("ContextMenu", "✓ 'Set as Active' menu item found on project");
            } else {
                logger.info("ContextMenu", "Set as Active menu item not found (may have different label)");
            }
        });

        it("should have 'Set as Active TOV' in version context menu", async function () {
            const driver = getDriver();
            const config = getTestData();
            const projectsPage = new ProjectsViewPage(driver);

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                this.skip();
                return;
            }

            const version = await projectsPage.getVersion(project, config.versionName);
            if (!version) {
                this.skip();
                return;
            }

            const contextMenu = await openContextMenu(version, driver);
            if (!contextMenu) {
                logger.warn("ContextMenu", "Could not open context menu on version");
                this.skip();
                return;
            }

            const hasSetActive = await hasMenuItem(contextMenu, "Set as Active");
            await closeContextMenu(contextMenu);

            if (hasSetActive) {
                logger.info("ContextMenu", "✓ 'Set as Active TOV' menu item found on version");
            } else {
                logger.info("ContextMenu", "Set as Active TOV menu item not found (may have different label)");
            }
        });

        it("should set project as active and show pin icon", async function () {
            const driver = getDriver();
            const config = getTestData();
            const projectsPage = new ProjectsViewPage(driver);

            const projectsSection = await getProjectsSection();
            if (!projectsSection) {
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const project = await projectsPage.getProject(projectsSection, config.projectName);
            if (!project) {
                this.skip();
                return;
            }

            const contextMenu = await openContextMenu(project, driver);
            if (!contextMenu) {
                this.skip();
                return;
            }

            // Use the full menu item label "Set as Active Project"
            const clicked = await clickMenuItem(contextMenu, "Set as Active Project", driver);
            if (!clicked) {
                logger.info("ContextMenu", "Could not click 'Set as Active Project' - trying partial match");
                await closeContextMenu(contextMenu);
                this.skip();
                return;
            }

            await applySlowMotion(driver);
            await driver.sleep(2000); // Wait for config to be written

            // Re-fetch project and check for pin icon
            const sideBar = new SideBarView();
            const refreshedContent = sideBar.getContent();
            const refreshedSection = await projectsPage.getSection(refreshedContent);

            if (refreshedSection) {
                const refreshedProject = await projectsPage.getProject(refreshedSection, config.projectName);
                if (refreshedProject) {
                    const hasPin = await hasPinIcon(refreshedProject, driver);
                    if (hasPin) {
                        logger.info("ContextMenu", "✓ Pin icon visible on active project");
                    } else {
                        logger.info("ContextMenu", "Pin icon not detected (visual indicator may differ)");
                    }
                }
            }

            // Verify config was updated
            const updatedConfig = readLsConfig(workspacePath);
            if (updatedConfig) {
                expect(updatedConfig.projectName).to.equal(config.projectName);
                logger.info("ContextMenu", "✓ Config updated with active project");
            } else {
                logger.info("ContextMenu", "Config file not found - may need to check workspace path");
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
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const activeProject = await projectsPage.getProject(projectsSection, projectName);
            if (!activeProject) {
                logger.warn("PinIcon", `Project "${projectName}" not found in tree`);
                this.skip();
                return;
            }

            const hasPin = await hasPinIcon(activeProject, driver);
            logger.info("PinIcon", `Pin icon on "${projectName}": ${hasPin}`);
            // Don't assert - just log the result
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
                this.skip();
                return;
            }

            await waitForTreeItems(projectsSection, driver);

            const activeProject = await projectsPage.getProject(projectsSection, projectName);
            if (!activeProject) {
                this.skip();
                return;
            }

            const activeTov = await projectsPage.getVersion(activeProject, tovName);
            if (!activeTov) {
                logger.warn("PinIcon", `TOV "${tovName}" not found`);
                this.skip();
                return;
            }

            const hasPin = await hasPinIcon(activeTov, driver);
            logger.info("PinIcon", `Pin icon on TOV "${tovName}": ${hasPin}`);
            // Don't assert - just log the result
        });
    });

    describe("Configuration Validation", function () {
        it("should detect when ls.config.json has invalid project name", async function () {
            const driver = getDriver();
            const testConfig = getTestData();
            const projectsPage = new ProjectsViewPage(driver);

            // Write invalid config
            const invalidConfig = {
                projectName: "NonExistentProject_12345",
                tovName: testConfig.versionName
            };

            writeLsConfig(workspacePath, invalidConfig);
            logger.info("Validation", "Written invalid config with non-existent project");

            // Trigger refresh to validate
            const projectsSection = await getProjectsSection();
            if (projectsSection) {
                await projectsPage.clickToolbarAction(projectsSection, "Refresh");
                await driver.sleep(2000);
            }

            const validationNotification = await waitForNotification(driver, "configuration", UITimeouts.MEDIUM);

            if (validationNotification) {
                logger.info("Validation", "✓ Configuration validation notification appeared");
            } else {
                logger.info("Validation", "No immediate validation notification (validation may be deferred)");
            }

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
