/**
 * @file src/views/projectManagement/projectManagementTreeItem.ts
 * @description Specialized tree item for project management tree
 */

import * as vscode from "vscode";
import { BaseTreeItem } from "../common/baseTreeItem";
import { TreeItemContextValues } from "../../constants";
import { IconManagementService } from "../common/iconManagementService";
import { TestBenchLogger } from "../../testBenchLogger";

export class ProjectManagementTreeItem extends BaseTreeItem {
    constructor(
        label: string,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        itemData: any,
        extensionContext: vscode.ExtensionContext,
        private readonly loggerFromFactory: TestBenchLogger,
        private readonly iconServiceFromFactory: IconManagementService,
        parent: ProjectManagementTreeItem | null = null
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
    }

    protected buildTooltipContent(): string {
        const itemDataForTooltip = this.itemData?.base || this.itemData;
        const tooltipContentLines: string[] = [];

        // Add type information
        tooltipContentLines.push(`Type: ${this.originalContextValue}`);

        if (itemDataForTooltip.name) {
            tooltipContentLines.push(`Name: ${itemDataForTooltip.name}`);
        }

        tooltipContentLines.push(`Status: ${this.state.status}`);

        if (itemDataForTooltip.key) {
            tooltipContentLines.push(`Key: ${itemDataForTooltip.key}`);
        }

        // Add project-specific information
        if (this.originalContextValue === TreeItemContextValues.PROJECT && this.itemData) {
            tooltipContentLines.push(`TOVs: ${this.itemData.tovsCount || 0}`);
            tooltipContentLines.push(`Cycles: ${this.itemData.cyclesCount || 0}`);
        }

        // Add unique ID for cycles and versions
        if (itemDataForTooltip.uniqueID) {
            tooltipContentLines.push(`Unique ID: ${itemDataForTooltip.uniqueID}`);
        }

        return tooltipContentLines.join("\n");
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
