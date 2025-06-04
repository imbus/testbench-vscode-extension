/**
 * @file src/views/testTheme/testThemeTreeItem.ts
 * @description Specialized tree item for test theme tree
 */

import * as vscode from "vscode";
import { BaseTreeItem } from "../common/baseTreeItem";
import { TreeItemContextValues } from "../../constants";

export class TestThemeTreeItem extends BaseTreeItem {
    constructor(
        label: string,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        itemData: any,
        extensionContext: vscode.ExtensionContext,
        parent: TestThemeTreeItem | null = null
    ) {
        super(label, contextValue, collapsibleState, itemData, extensionContext, parent);

        // Set description to show unique ID
        this.description = this.getUID() || "";
    }

    protected buildTooltipContent(): string {
        const itemDataForTooltip = this.itemData?.base || this.itemData;
        const lines: string[] = [];

        // Add numbering if available
        if (itemDataForTooltip?.numbering) {
            lines.push(`Numbering: ${itemDataForTooltip.numbering}`);
        }

        // Add type information
        lines.push(`Type: ${itemDataForTooltip.elementType || this.originalContextValue}`);

        // Add name
        if (itemDataForTooltip.name) {
            lines.push(`Name: ${itemDataForTooltip.name}`);
        }

        // Add status
        lines.push(`Status: ${this.state.status}`);

        // Add unique ID
        const uid = this.getUID();
        if (uid) {
            lines.push(`ID: ${uid}`);
        }

        return lines.join("\n");
    }

    protected getIconCategory(): string {
        return "testTheme";
    }

    /**
     * Update context value for marked state
     */
    public updateContextForMarking(marked: boolean): void {
        if (marked) {
            // Update context value for marked state
            if (this.originalContextValue === TreeItemContextValues.TEST_THEME_NODE) {
                this.contextValue = TreeItemContextValues.MARKED_TEST_THEME_NODE;
            } else if (this.originalContextValue === TreeItemContextValues.TEST_CASE_SET_NODE) {
                this.contextValue = TreeItemContextValues.MARKED_TEST_CASE_SET_NODE;
            }
        } else {
            // Restore original context value
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
            this.originalContextValue === TreeItemContextValues.TEST_THEME_NODE ||
            this.originalContextValue === TreeItemContextValues.TEST_CASE_SET_NODE
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
