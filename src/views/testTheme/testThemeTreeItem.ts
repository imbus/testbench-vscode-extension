/**
 * @file src/views/testTheme/testThemeTreeItem.ts
 * @description Specialized tree item for test theme tree
 */

import * as vscode from "vscode";
import { BaseTreeItem } from "../common/baseTreeItem";
import { TreeItemContextValues } from "../../constants";
import { IconManagementService } from "../common/iconManagementService";
import { TestBenchLogger } from "../../testBenchLogger";

export class TestThemeTreeItem extends BaseTreeItem {
    constructor(
        label: string,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        itemData: any,
        extensionContext: vscode.ExtensionContext,
        private readonly loggerFromFactory: TestBenchLogger,
        private readonly iconServiceFromFactory: IconManagementService,
        parent: TestThemeTreeItem | null = null
    ) {
        super(
            label,
            contextValue,
            collapsibleState,
            itemData,
            extensionContext,
            loggerFromFactory,
            iconServiceFromFactory,
            parent
        );
        this.description = this.getUID() || "";
    }

    protected buildTooltipContent(): string {
        const itemDataForTooltip = this.itemData?.base || this.itemData;
        const tooltipContextLines: string[] = [];

        if (itemDataForTooltip?.numbering) {
            tooltipContextLines.push(`Numbering: ${itemDataForTooltip.numbering}`);
        }

        tooltipContextLines.push(`Type: ${itemDataForTooltip.elementType || this.originalContextValue}`);

        if (itemDataForTooltip.name) {
            tooltipContextLines.push(`Name: ${itemDataForTooltip.name}`);
        }

        tooltipContextLines.push(`Status: ${this.state.status}`);

        const uid = this.getUID();
        if (uid) {
            tooltipContextLines.push(`ID: ${uid}`);
        }

        return tooltipContextLines.join("\n");
    }

    protected getIconCategory(): string {
        return "testTheme";
    }

    /**
     * Update context value for marked state, preserving custom root context.
     */
    /**
     * Update context value for marked state, correctly handling custom roots.
     */
    public updateContextForMarking(marked: boolean): void {
        const isCustomRoot =
            this.contextValue === TreeItemContextValues.CUSTOM_ROOT_TEST_THEME ||
            this.contextValue === TreeItemContextValues.MARKED_CUSTOM_ROOT_TEST_THEME;

        if (isCustomRoot) {
            // If the item is a custom root, toggle between the two custom root context values.
            this.contextValue = marked
                ? TreeItemContextValues.MARKED_CUSTOM_ROOT_TEST_THEME
                : TreeItemContextValues.CUSTOM_ROOT_TEST_THEME;
        } else if (marked) {
            // If it's a regular item being marked, set the appropriate marked context.
            if (this.originalContextValue === TreeItemContextValues.TEST_THEME_TREE_ITEM) {
                this.contextValue = TreeItemContextValues.MARKED_TEST_THEME_TREE_ITEM;
            } else if (this.originalContextValue === TreeItemContextValues.TEST_CASE_SET_TREE_ITEM) {
                this.contextValue = TreeItemContextValues.MARKED_TEST_CASE_SET_TREE_ITEM;
            }
        } else {
            // If it's a regular item being unmarked, revert to its original context.
            this.contextValue = this.originalContextValue;
        }

        this.setMarked(marked);
    }

    /**
     * Get the hierarchical path of this item
     */
    public getHierarchicalPath(): string {
        const pathSegments: string[] = [];

        // Use a recursive helper function to build the path
        const buildPath = (item: TestThemeTreeItem | null): void => {
            if (item) {
                // First build the parent path, then add current item
                if (item.parent) {
                    buildPath(item.parent as TestThemeTreeItem);
                }
                pathSegments.push(item.label as string);
            }
        };

        buildPath(this);
        return pathSegments.join(" > ");
    }

    /**
     * Check if this item can be a target for test generation
     */
    public canGenerateTests(): boolean {
        return (
            this.originalContextValue === TreeItemContextValues.TEST_THEME_TREE_ITEM ||
            this.originalContextValue === TreeItemContextValues.TEST_CASE_SET_TREE_ITEM
        );
    }

    /**
     * Get all descendant UIDs for hierarchy tracking
     */
    public getDescendantUIDs(): string[] {
        const uids: string[] = [];

        const collectUIDs = (item: TestThemeTreeItem) => {
            if (item.children) {
                for (const child of item.children as TestThemeTreeItem[]) {
                    const uid = child.getUID();
                    if (uid) {
                        uids.push(uid);
                    }
                    collectUIDs(child);
                }
            }
        };

        collectUIDs(this);
        return uids;
    }

    /**
     * Get descendant keys with UIDs for tracking
     */
    public getDescendantKeysWithUIDs(): Array<[string, string]> {
        const keysWithUIDs: Array<[string, string]> = [];

        const collectKeysWithUIDs = (item: TestThemeTreeItem) => {
            if (item.children) {
                for (const child of item.children as TestThemeTreeItem[]) {
                    const key = child.getUniqueId();
                    const uid = child.getUID();
                    if (key && uid) {
                        keysWithUIDs.push([key, uid]);
                    }
                    collectKeysWithUIDs(child);
                }
            }
        };

        collectKeysWithUIDs(this);
        return keysWithUIDs;
    }
}
