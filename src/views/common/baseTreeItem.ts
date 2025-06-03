/**
 * @file src/views/common/baseTreeItem.ts
 * @description Base class for TestBench tree items, providing common properties and methods.
 */

import * as vscode from "vscode";
import { logger, ENABLE_ICON_MARKING_ON_GENERATE } from "../../extension";
import { allExtensionCommands, TreeItemContextValues } from "../../constants";

export class BaseTestBenchTreeItem extends vscode.TreeItem {
    public parent: BaseTestBenchTreeItem | null;
    public children?: BaseTestBenchTreeItem[];
    public statusOfTreeItem: string;
    public originalContextValue?: string;
    public _isMarkedForImport: boolean = false;
    private readonly extensionContext: vscode.ExtensionContext;

    constructor(
        label: string,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public item: any,
        extensionContext: vscode.ExtensionContext,
        parent: BaseTestBenchTreeItem | null = null
    ) {
        super(label, collapsibleState);
        this.extensionContext = extensionContext;
        this.contextValue = contextValue;
        this.originalContextValue = contextValue;
        this.parent = parent;
        this.statusOfTreeItem = item.exec?.status || item.status || "None";

        const itemDataForTooltip = item?.base || item;

        if (
            contextValue === TreeItemContextValues.PROJECT ||
            contextValue === TreeItemContextValues.VERSION ||
            contextValue === TreeItemContextValues.CYCLE ||
            (this.originalContextValue &&
                (
                    [
                        TreeItemContextValues.PROJECT,
                        TreeItemContextValues.VERSION,
                        TreeItemContextValues.CYCLE
                    ] as string[]
                ).includes(this.originalContextValue))
        ) {
            this.tooltip = `Type: ${this.originalContextValue || contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nKey: ${itemDataForTooltip.key}`;
            if (
                (this.originalContextValue === TreeItemContextValues.PROJECT ||
                    contextValue === TreeItemContextValues.PROJECT) &&
                item
            ) {
                this.tooltip += `\nTOVs: ${item.tovsCount || 0}\nCycles: ${item.cyclesCount || 0}`;
            }
        } else if (
            contextValue === TreeItemContextValues.TEST_THEME_NODE ||
            contextValue === TreeItemContextValues.TEST_CASE_SET_NODE ||
            contextValue === TreeItemContextValues.TEST_CASE_NODE ||
            (this.originalContextValue &&
                (
                    [TreeItemContextValues.TEST_THEME_NODE, TreeItemContextValues.TEST_CASE_SET_NODE] as string[]
                ).includes(this.originalContextValue))
        ) {
            if (itemDataForTooltip?.numbering) {
                this.tooltip = `Numbering: ${itemDataForTooltip.numbering}\nType: ${itemDataForTooltip.elementType || this.originalContextValue || contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nID: ${itemDataForTooltip.uniqueID}`;
            } else {
                this.tooltip = `Type: ${itemDataForTooltip.elementType || this.originalContextValue || contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nID: ${itemDataForTooltip.uniqueID}`;
            }
            this.description = itemDataForTooltip?.uniqueID || "";
        } else if (
            contextValue === TreeItemContextValues.CUSTOM_ROOT_PROJECT ||
            contextValue === TreeItemContextValues.CUSTOM_ROOT_TEST_THEME
        ) {
            this.tooltip = `Custom Root View\nType: ${this.originalContextValue || "N/A"}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}`;
        }

        if (contextValue === TreeItemContextValues.CYCLE) {
            this.command = {
                command: allExtensionCommands.handleProjectCycleClick,
                title: "Show Test Themes",
                arguments: [this]
            };
        }
        this.updateIcon();
    }

    private getIconUris(): { light: vscode.Uri; dark: vscode.Uri } {
        const baseIconUri = this.extensionContext.extensionUri;

        let contextValueForIconLookup: string | undefined = this.contextValue;
        let isTreeItemMarkedForImport: boolean = false;

        if (
            this.contextValue === TreeItemContextValues.MARKED_TEST_THEME_NODE ||
            this.contextValue === TreeItemContextValues.MARKED_TEST_CASE_SET_NODE
        ) {
            contextValueForIconLookup = this.originalContextValue;
            isTreeItemMarkedForImport = true;
        } else if (
            (this.contextValue === TreeItemContextValues.CUSTOM_ROOT_PROJECT ||
                this.contextValue === TreeItemContextValues.CUSTOM_ROOT_TEST_THEME) &&
            this._isMarkedForImport
        ) {
            contextValueForIconLookup = this.originalContextValue;
            isTreeItemMarkedForImport = true;
        } else {
            contextValueForIconLookup = this.originalContextValue || this.contextValue;
        }

        const status: string = this.statusOfTreeItem?.toLowerCase() || "default";

        const iconMap: Record<
            string,
            Record<string, { light: string; dark: string; markedLight?: string; markedDark?: string }>
        > = {
            [TreeItemContextValues.PROJECT]: {
                active: { light: "project-light.svg", dark: "project-dark.svg" },
                default: { light: "project-light.svg", dark: "project-dark.svg" }
            },
            [TreeItemContextValues.VERSION]: {
                default: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" }
            },
            [TreeItemContextValues.CYCLE]: {
                default: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" }
            },
            [TreeItemContextValues.TEST_THEME_NODE]: {
                default: {
                    light: "TestThemeOriginal-light.svg",
                    dark: "TestThemeOriginal-dark.svg",
                    markedLight: "TestThemeOriginal-marked-light.svg",
                    markedDark: "TestThemeOriginal-marked-dark.svg"
                }
            },
            [TreeItemContextValues.TEST_CASE_SET_NODE]: {
                default: {
                    light: "TestCaseSetOriginal-light.svg",
                    dark: "TestCaseSetOriginal-dark.svg",
                    markedLight: "TestCaseSetOriginal-marked-light.svg",
                    markedDark: "TestCaseSetOriginal-marked-dark.svg"
                }
            },
            [TreeItemContextValues.TEST_CASE_NODE]: {
                default: { light: "TestCase-light.svg", dark: "TestCase-dark.svg" }
            },
            default: {
                default: { light: "testbench-logo.svg", dark: "testbench-logo.svg" }
            }
        };

        const typeIcons = iconMap[contextValueForIconLookup as keyof typeof iconMap] || iconMap["default"];
        let iconFileNames = typeIcons[status] || typeIcons["default"] || iconMap.default.default;

        if (ENABLE_ICON_MARKING_ON_GENERATE && (this._isMarkedForImport || isTreeItemMarkedForImport)) {
            if (iconFileNames.markedLight && iconFileNames.markedDark) {
                iconFileNames = { light: iconFileNames.markedLight, dark: iconFileNames.markedDark };
            } else {
                logger.warn(`[getIconUris] Marked icons not defined for type: ${contextValueForIconLookup}`);
            }
        }

        return {
            light: vscode.Uri.joinPath(baseIconUri, "resources", "icons", iconFileNames.light),
            dark: vscode.Uri.joinPath(baseIconUri, "resources", "icons", iconFileNames.dark)
        };
    }

    public updateIcon(): void {
        this.iconPath = this.getIconUris();
    }
}
