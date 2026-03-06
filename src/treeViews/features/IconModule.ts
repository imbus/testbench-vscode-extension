/**
 * @file src/treeViews/features/IconModule.ts
 * @description Module for managing tree item icons and themes.
 */

import * as vscode from "vscode";
import { TreeViewModule } from "../core/TreeViewModule";
import { TreeViewContext } from "../core/TreeViewContext";
import { TreeItemBase } from "../core/TreeItemBase";
import { IconConfig } from "../core/TreeViewConfig";
import { ProjectsTreeItem } from "../implementations/projects/ProjectsTreeItem";
import { TestThemesTreeItem } from "../implementations/testThemes/TestThemesTreeItem";
import { TestElementsTreeItem, TestElementType } from "../implementations/testElements/TestElementsTreeItem";
import { FilteringModule } from "./FilteringModule";

export type IconThemeName = "default" | "minimal" | "colorful" | "custom";
export interface IconTheme {
    name: string;
    icons: Map<string, vscode.ThemeIcon | string>;
    statusIcons: Map<string, vscode.ThemeIcon>;
    defaultIcon?: vscode.ThemeIcon;
}

export class IconModule implements TreeViewModule {
    readonly id = "icons";

    private context!: TreeViewContext;
    private config!: IconConfig;
    private themes = new Map<IconThemeName, IconTheme>();
    private currentTheme!: IconTheme;
    private customMappings = new Map<string, vscode.ThemeIcon | string>();

    constructor() {
        this.initializeThemes();
    }

    /**
     * Initializes the icon module with context and configuration
     * @param context The tree view context
     */
    async initialize(context: TreeViewContext): Promise<void> {
        this.context = context;
        this.config = context.config.modules.icons || this.getDefaultConfig();

        if (this.config.customMappings) {
            Object.entries(this.config.customMappings).forEach(([key, value]) => {
                this.customMappings.set(key, this.parseIconValue(value));
            });
        }

        this.currentTheme = this.themes.get(this.config.theme) || this.themes.get("default")!;
        // Listen for configuration changes
        context.eventBus.on("config:changed", (event) => {
            if (event.data.icons) {
                this.onConfigChange(event.data.icons);
            }
        });
        this.context.logger.trace(
            context.buildLogPrefix("IconModule", `Icon module initialized with theme '${this.config.theme}'.`)
        );
    }

    /**
     * Returns default icon configuration
     * @return Default icon configuration
     */
    private getDefaultConfig(): IconConfig {
        return {
            theme: "default",
            showStatusIcons: true,
            animateLoading: true
        };
    }

    /**
     * Initializes all available icon themes
     */
    private initializeThemes(): void {
        // Default theme
        this.themes.set("default", {
            name: "Default",
            icons: new Map([
                // Projects tree
                ["project", new vscode.ThemeIcon("folder-library")],
                ["version", new vscode.ThemeIcon("versions")],
                ["cycle", new vscode.ThemeIcon("sync")],

                // Test themes tree
                ["TestThemeNode", new vscode.ThemeIcon("symbol-class")],
                ["TestCaseSetNode", new vscode.ThemeIcon("symbol-namespace")],
                ["TestCaseNode", new vscode.ThemeIcon("circle-outline")],

                // Test elements tree
                ["Subdivision", new vscode.ThemeIcon("symbol-namespace")],
                ["Keyword", new vscode.ThemeIcon("symbol-event")],
                ["DataType", new vscode.ThemeIcon("symbol-variable")],
                ["Condition", new vscode.ThemeIcon("symbol-boolean")],
                ["Other", new vscode.ThemeIcon("symbol-misc")]
            ]),
            statusIcons: new Map([
                ["loading", new vscode.ThemeIcon("sync~spin")],
                ["error", new vscode.ThemeIcon("error")],
                ["warning", new vscode.ThemeIcon("warning")],
                ["success", new vscode.ThemeIcon("pass")],
                ["imported", new vscode.ThemeIcon("cloud-download")],
                ["generated", new vscode.ThemeIcon("sparkle")],
                ["marked", new vscode.ThemeIcon("pin")]
            ]),
            defaultIcon: new vscode.ThemeIcon("file")
        });
        // Minimal theme
        this.themes.set("minimal", {
            name: "Minimal",
            icons: new Map([
                ["project", new vscode.ThemeIcon("folder")],
                ["version", new vscode.ThemeIcon("tag")],
                ["cycle", new vscode.ThemeIcon("refresh")],
                ["TestThemeNode", new vscode.ThemeIcon("file-code")],
                ["TestCaseSetNode", new vscode.ThemeIcon("file-submodule")],
                ["TestCaseNode", new vscode.ThemeIcon("file")],
                ["Subdivision", new vscode.ThemeIcon("folder")],
                ["Keyword", new vscode.ThemeIcon("play")],
                ["DataType", new vscode.ThemeIcon("symbol-key")],
                ["Condition", new vscode.ThemeIcon("question")],
                ["Other", new vscode.ThemeIcon("file")]
            ]),
            statusIcons: new Map([
                ["loading", new vscode.ThemeIcon("loading~spin")],
                ["error", new vscode.ThemeIcon("x")],
                ["warning", new vscode.ThemeIcon("alert")],
                ["success", new vscode.ThemeIcon("check")],
                ["imported", new vscode.ThemeIcon("arrow-down")],
                ["generated", new vscode.ThemeIcon("plus")],
                ["marked", new vscode.ThemeIcon("bookmark")]
            ]),
            defaultIcon: new vscode.ThemeIcon("file-text")
        });
        // Colorful theme
        this.themes.set("colorful", {
            name: "Colorful",
            icons: new Map([
                ["project", new vscode.ThemeIcon("folder-library", new vscode.ThemeColor("charts.blue"))],
                ["version", new vscode.ThemeIcon("versions", new vscode.ThemeColor("charts.green"))],
                ["cycle", new vscode.ThemeIcon("sync", new vscode.ThemeColor("charts.orange"))],
                ["TestThemeNode", new vscode.ThemeIcon("symbol-class", new vscode.ThemeColor("charts.purple"))],
                ["TestCaseSetNode", new vscode.ThemeIcon("symbol-namespace", new vscode.ThemeColor("charts.yellow"))],
                ["TestCaseNode", new vscode.ThemeIcon("circle-outline", new vscode.ThemeColor("charts.red"))],
                ["Subdivision", new vscode.ThemeIcon("symbol-namespace", new vscode.ThemeColor("charts.blue"))],
                ["Keyword", new vscode.ThemeIcon("symbol-event", new vscode.ThemeColor("charts.green"))],
                ["DataType", new vscode.ThemeIcon("symbol-variable", new vscode.ThemeColor("charts.orange"))],
                ["Condition", new vscode.ThemeIcon("symbol-boolean", new vscode.ThemeColor("charts.purple"))],
                ["Other", new vscode.ThemeIcon("symbol-misc", new vscode.ThemeColor("charts.yellow"))]
            ]),
            statusIcons: new Map([
                ["loading", new vscode.ThemeIcon("sync~spin", new vscode.ThemeColor("charts.blue"))],
                ["error", new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"))],
                ["warning", new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"))],
                ["success", new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"))],
                ["imported", new vscode.ThemeIcon("cloud-download", new vscode.ThemeColor("charts.green"))],
                ["generated", new vscode.ThemeIcon("sparkle", new vscode.ThemeColor("charts.yellow"))],
                ["marked", new vscode.ThemeIcon("pin", new vscode.ThemeColor("charts.red"))]
            ]),
            defaultIcon: new vscode.ThemeIcon("file", new vscode.ThemeColor("foreground"))
        });
        // Custom theme (Empty for custom icon mappings)
        this.themes.set("custom", {
            name: "Custom",
            icons: new Map(),
            statusIcons: new Map(),
            defaultIcon: new vscode.ThemeIcon("file")
        });
    }

    /**
     * Parses icon value string to ThemeIcon or returns as string
     * @param value The icon value string
     * @return Parsed icon value
     */
    private parseIconValue(value: string): vscode.ThemeIcon | string {
        if (value.includes("$(")) {
            // It's a codicon reference
            const match = value.match(/\$\((.+)\)/);
            if (match) {
                return new vscode.ThemeIcon(match[1]);
            }
        }
        return value;
    }

    /**
     * Gets the appropriate icon for a tree item.
     * @param item The tree item
     * @returns The resolved icon for the item (ThemeIcon, Uri, or light/dark pair)
     */
    public getIcon(
        item: TreeItemBase
    ): vscode.ThemeIcon | string | { light: vscode.Uri; dark: vscode.Uri } | undefined {
        const extensionUri = this.context.extensionContext.extensionUri;

        // Display blocked icon for filtered out items in filter diff mode
        if (item instanceof TestThemesTreeItem && item.isFilteredOutInDiffMode) {
            return {
                light: vscode.Uri.joinPath(extensionUri, "resources", "icons", "block-light.svg"),
                dark: vscode.Uri.joinPath(extensionUri, "resources", "icons", "block-dark.svg")
            };
        }

        if (item instanceof ProjectsTreeItem) {
            switch (item.data.type) {
                case "project":
                    return {
                        light: vscode.Uri.joinPath(extensionUri, "resources", "icons", "project-light.svg"),
                        dark: vscode.Uri.joinPath(extensionUri, "resources", "icons", "project-dark.svg")
                    };
                case "version":
                    return {
                        light: vscode.Uri.joinPath(extensionUri, "resources", "icons", "TOV-specification-light.svg"),
                        dark: vscode.Uri.joinPath(extensionUri, "resources", "icons", "TOV-specification-dark.svg")
                    };
                case "cycle":
                    return {
                        light: vscode.Uri.joinPath(extensionUri, "resources", "icons", "Cycle-execution-light.svg"),
                        dark: vscode.Uri.joinPath(extensionUri, "resources", "icons", "Cycle-execution-dark.svg")
                    };
            }
        }

        if (item instanceof TestThemesTreeItem) {
            const isMarkedForImport = !!item.getMetadata("marked");
            switch (item.data.elementType) {
                case "TestThemeNode":
                    return {
                        light: vscode.Uri.joinPath(
                            extensionUri,
                            "resources",
                            "icons",
                            isMarkedForImport ? "TestThemeOriginal-marked-light.svg" : "TestThemeOriginal-light.svg"
                        ),
                        dark: vscode.Uri.joinPath(
                            extensionUri,
                            "resources",
                            "icons",
                            isMarkedForImport ? "TestThemeOriginal-marked-dark.svg" : "TestThemeOriginal-dark.svg"
                        )
                    };
                case "TestCaseSetNode":
                    return {
                        light: vscode.Uri.joinPath(
                            extensionUri,
                            "resources",
                            "icons",
                            isMarkedForImport ? "TestCaseSetOriginal-marked-light.svg" : "TestCaseSetOriginal-light.svg"
                        ),
                        dark: vscode.Uri.joinPath(
                            extensionUri,
                            "resources",
                            "icons",
                            isMarkedForImport ? "TestCaseSetOriginal-marked-dark.svg" : "TestCaseSetOriginal-dark.svg"
                        )
                    };
                case "TestCaseNode": {
                    const iconColor = this.getTestThemeIconColor(item);
                    return new vscode.ThemeIcon("symbol-method", iconColor);
                }
            }
        }

        if (item instanceof TestElementsTreeItem) {
            switch (item.data.testElementType) {
                case TestElementType.Subdivision: {
                    // Determine icon based on the subdivision's own local resource availability.
                    const baseIconName = item.data.isLocallyAvailable ? "localSubdivision" : "missingSubdivision";
                    return {
                        light: vscode.Uri.joinPath(extensionUri, "resources", "icons", `${baseIconName}-light.svg`),
                        dark: vscode.Uri.joinPath(extensionUri, "resources", "icons", `${baseIconName}-dark.svg`)
                    };
                }
                case TestElementType.Keyword:
                    return {
                        light: vscode.Uri.joinPath(extensionUri, "resources", "icons", "testStep-light.svg"),
                        dark: vscode.Uri.joinPath(extensionUri, "resources", "icons", "testStep-dark.svg")
                    };
                // Handle other element types with ThemeIcons
                case TestElementType.DataType:
                    return new vscode.ThemeIcon("symbol-variable");
                case TestElementType.Condition:
                    return new vscode.ThemeIcon("question");
                default:
                    return new vscode.ThemeIcon("file-code");
            }
        }

        // Fallback for general icons or other types
        return this.getGenericIcon(item);
    }

    /**
     * Determines the icon color for a TestThemesTreeItem based on its state.
     * @param item The TestThemesTreeItem
     * @returns A ThemeColor or undefined.
     */
    private getTestThemeIconColor(item: TestThemesTreeItem): vscode.ThemeColor | undefined {
        if (item.getMetadata("marked")) {
            const markingInfo = item.getMetadata("markingInfo");
            if (markingInfo?.type === "import") {
                return new vscode.ThemeColor("charts.blue");
            }
            if (markingInfo?.type === "generation") {
                return new vscode.ThemeColor("charts.yellow");
            }
        }
        if (item.data.isGenerated) {
            return new vscode.ThemeColor("charts.green");
        }
        if (item.data.isImported) {
            return new vscode.ThemeColor("charts.purple");
        }
        return undefined;
    }

    /**
     * Gets a generic icon based on the item's context and status, using the configured theme.
     * @param item The tree item
     * @returns The resolved icon for the item
     */
    private getGenericIcon(item: TreeItemBase): vscode.ThemeIcon | string | undefined {
        const customIcon = this.customMappings.get(item.contextValue || "");
        if (customIcon) {
            return customIcon;
        }

        if (this.config.showStatusIcons) {
            const status = this.getItemStatus(item);
            if (status) {
                const statusIcon = this.currentTheme.statusIcons.get(status);
                if (statusIcon) {
                    return statusIcon;
                }
            }
        }

        const themeIcon = this.currentTheme.icons.get(item.originalContextValue);
        if (themeIcon) {
            return themeIcon;
        }

        return this.currentTheme.defaultIcon;
    }

    /**
     * Gets the status of a tree item based on its metadata
     * @param item The tree item to check
     * @return Status string or undefined if no status found
     */
    private getItemStatus(item: TreeItemBase): string | undefined {
        // Check various metadata for status
        if (item.getMetadata("loading")) {
            return "loading";
        }
        if (item.getMetadata("error")) {
            return "error";
        }
        if (item.getMetadata("warning")) {
            return "warning";
        }
        if (item.getMetadata("marked")) {
            return "marked";
        }
        if (item.getMetadata("generated")) {
            return "generated";
        }
        if (item.getMetadata("imported")) {
            return "imported";
        }
        if (item.getMetadata("success")) {
            return "success";
        }
        return undefined;
    }

    /**
     * Sets the icon for a tree item based on current theme and status
     * @param item The tree item to set icon for
     */
    public setItemIcon(item: TreeItemBase): void {
        // Check if filter diff mode is enabled and this item is filtered
        const treeView = this.context.getTreeView();
        const filteringModule = treeView.getModule("filtering") as FilteringModule | undefined;
        if (filteringModule && typeof filteringModule.getFilterDiffState === "function") {
            const filterDiffState = filteringModule.getFilterDiffState();
            if (filterDiffState.enabled && item.id && filterDiffState.filteredItems.has(item.id)) {
                // Skip setting icon for filtered items in diff mode - let the FilteringModule handle it
                return;
            }
        }

        const icon = this.getIcon(item);
        if (icon) {
            item.iconPath = icon;
        }
    }

    /**
     * Sets the active icon theme
     * @param themeName The name of the theme to set
     */
    public setTheme(themeName: string): void {
        if (!this.isValidThemeName(themeName)) {
            this.context.logger.warn(
                this.context.buildLogPrefix("IconModule", `Cannot set theme. Invalid theme name: ${themeName}`)
            );
            return;
        }

        const theme = this.themes.get(themeName);
        if (theme) {
            this.currentTheme = theme;
            this.config.theme = themeName;
            this.context.refresh();
            this.context.logger.debug(this.context.buildLogPrefix("IconModule", `Icon theme changed to: ${themeName}`));
        }
    }

    /**
     * Validates if theme name is valid
     * @param themeName The theme name to validate
     * @return True if theme name is valid
     */
    private isValidThemeName(themeName: string): themeName is IconThemeName {
        return ["default", "minimal", "colorful", "custom"].includes(themeName);
    }

    /**
     * Handles configuration changes for the icon module
     * @param config The new icon configuration
     */
    async onConfigChange(config: IconConfig): Promise<void> {
        this.config = config;
        // Update custom mappings
        this.customMappings.clear();
        if (config.customMappings) {
            Object.entries(config.customMappings).forEach(([key, value]) => {
                this.customMappings.set(key, this.parseIconValue(value));
            });
        }

        // Update theme
        if (config.theme !== this.currentTheme.name.toLowerCase()) {
            this.setTheme(config.theme);
        }
    }

    /**
     * Disposes the icon module and cleans up resources
     */
    dispose(): void {
        this.themes.clear();
        this.customMappings.clear();
    }
}
