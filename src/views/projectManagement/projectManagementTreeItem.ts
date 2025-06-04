/**
 * @file src/views/projectManagement/projectManagementTreeItem.ts
 * @description Specialized tree item for project management tree
 */

import * as vscode from "vscode";
import { BaseTreeItem } from "../common/baseTreeItem";
import { TreeItemContextValues, allExtensionCommands } from "../../constants";

export class ProjectManagementTreeItem extends BaseTreeItem {
    constructor(
        label: string,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        itemData: any,
        extensionContext: vscode.ExtensionContext,
        parent: ProjectManagementTreeItem | null = null
    ) {
        super(label, contextValue, collapsibleState, itemData, extensionContext, parent);

        // Set command for cycle items
        if (contextValue === TreeItemContextValues.CYCLE) {
            this.command = {
                command: allExtensionCommands.handleProjectCycleClick,
                title: "Show Test Themes",
                arguments: [this]
            };
        }
    }

    protected buildTooltipContent(): string {
        const itemDataForTooltip = this.itemData?.base || this.itemData;
        const lines: string[] = [];

        // Add type information
        lines.push(`Type: ${this.originalContextValue}`);

        // Add name
        if (itemDataForTooltip.name) {
            lines.push(`Name: ${itemDataForTooltip.name}`);
        }

        // Add status
        lines.push(`Status: ${this.state.status}`);

        // Add key
        if (itemDataForTooltip.key) {
            lines.push(`Key: ${itemDataForTooltip.key}`);
        }

        // Add project-specific information
        if (this.originalContextValue === TreeItemContextValues.PROJECT && this.itemData) {
            lines.push(`TOVs: ${this.itemData.tovsCount || 0}`);
            lines.push(`Cycles: ${this.itemData.cyclesCount || 0}`);
        }

        // Add unique ID for cycles and versions
        if (itemDataForTooltip.uniqueID) {
            lines.push(`Unique ID: ${itemDataForTooltip.uniqueID}`);
        }

        return lines.join("\n");
    }

    protected getIconCategory(): string {
        return "projectManagement";
    }

    /**
     * Get project key from this item or traverse up to find it
     */
    public getProjectKey(): string | null {
        if (
            this.originalContextValue === TreeItemContextValues.PROJECT ||
            this.contextValue === TreeItemContextValues.PROJECT
        ) {
            return this.getUniqueId();
        }

        let current = this.parent as ProjectManagementTreeItem | null;
        while (current) {
            if (
                current.originalContextValue === TreeItemContextValues.PROJECT ||
                current.contextValue === TreeItemContextValues.PROJECT
            ) {
                return current.getUniqueId();
            }
            current = current.parent as ProjectManagementTreeItem | null;
        }

        return null;
    }

    /**
     * Get TOV key from this item or traverse up to find it
     */
    public getTovKey(): string | null {
        if (
            this.originalContextValue === TreeItemContextValues.VERSION ||
            this.contextValue === TreeItemContextValues.VERSION
        ) {
            return this.getUniqueId();
        }

        let current = this.parent as ProjectManagementTreeItem | null;
        while (current) {
            if (
                current.originalContextValue === TreeItemContextValues.VERSION ||
                current.contextValue === TreeItemContextValues.VERSION
            ) {
                return current.getUniqueId();
            }
            // Stop at project level
            if (current.originalContextValue === TreeItemContextValues.PROJECT) {
                break;
            }
            current = current.parent as ProjectManagementTreeItem | null;
        }

        return null;
    }

    /**
     * Get cycle key from this item or traverse up to find it
     */
    public getCycleKey(): string | null {
        if (
            this.originalContextValue === TreeItemContextValues.CYCLE ||
            this.contextValue === TreeItemContextValues.CYCLE
        ) {
            return this.getUniqueId();
        }

        let current = this.parent as ProjectManagementTreeItem | null;
        while (current) {
            if (
                current.originalContextValue === TreeItemContextValues.CYCLE ||
                current.contextValue === TreeItemContextValues.CYCLE
            ) {
                return current.getUniqueId();
            }
            current = current.parent as ProjectManagementTreeItem | null;
        }

        return null;
    }
}
