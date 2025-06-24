/**
 * @file src/treeViews/implementations/projects/ProjectsTreeItem.ts
 * @description Tree item implementation for projects in the projects tree view.
 */

import * as vscode from "vscode";
import { TreeItemBase } from "../../core/TreeItemBase";
import { allExtensionCommands } from "../../../constants";

export interface ProjectData {
    key: string;
    name: string;
    description?: string;
    type: "project" | "version" | "cycle";
    parentKey?: string;
    metadata?: Record<string, any>;
}

export class ProjectsTreeItem extends TreeItemBase {
    public readonly data: ProjectData;

    constructor(data: ProjectData, extensionContext: vscode.ExtensionContext, parent?: ProjectsTreeItem) {
        const label = data.name || data.key;

        const collapsibleState =
            data.type === "cycle" ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed;

        super(label, undefined, data.type, collapsibleState, extensionContext, parent);

        this.data = data;
        this.id = this.generateUniqueId();

        // Set metadata from data.metadata into internal _metadata map
        if (data.metadata) {
            Object.entries(data.metadata).forEach(([key, value]) => {
                this.setMetadata(key, value);
            });
        }

        this.tooltip = this.generateTooltip();

        // Set context and command based on type
        switch (this.data.type) {
            case "project":
                this.contextValue = "Project";
                break;
            case "version":
                this.contextValue = "Version";
                this.command = {
                    command: allExtensionCommands.handleProjectVersionClick,
                    title: "Select Version",
                    arguments: [this]
                };
                break;
            case "cycle":
                this.contextValue = "Cycle";
                this.command = {
                    command: allExtensionCommands.handleProjectCycleClick,
                    title: "Select Cycle",
                    arguments: [this]
                };
                break;
        }
    }

    /**
     * Generates a unique identifier for this tree item
     * @return A unique string identifier combining type, parent path, and key
     */
    protected generateUniqueId(): string {
        const parentPath = this.parent ? (this.parent as ProjectsTreeItem).data.key : "";
        return `${this.data.type}:${parentPath}:${this.data.key}`;
    }

    /**
     * Updates the ID when context changes
     */
    public updateId(): void {
        (this as any).id = this.generateUniqueId();
    }

    /**
     * Generates a tooltip string for this tree item
     * @return A formatted tooltip string with item information
     */
    private generateTooltip(): string {
        const tooltipContentLines: string[] = [];

        tooltipContentLines.push(`Type: ${this.data.type}`);

        if (this.data.name) {
            tooltipContentLines.push(`Name: ${this.data.name}`);
        }

        if (this.data.key) {
            tooltipContentLines.push(`Key: ${this.data.key}`);
        }

        if (this.data.type === "project") {
            const tovsCount = this.getMetadata("tovsCount") || 0;
            const cyclesCount = this.getMetadata("cyclesCount") || 0;
            tooltipContentLines.push(`TOVs: ${tovsCount}`);
            tooltipContentLines.push(`Cycles: ${cyclesCount}`);
        }

        if (this.data.description && this.data.description.trim() !== "") {
            tooltipContentLines.push(`Description: ${this.data.description}`);
        }

        return tooltipContentLines.join("\n");
    }

    /**
     * Gets the project key for this tree item
     * @return The project key if this is a project or has a project ancestor, null otherwise
     */
    public getProjectKey(): string | null {
        if (this.data.type === "project") {
            return this.data.key;
        }

        // For non project items, navigate up the tree to find its parent project.
        let current: TreeItemBase | null = this.parent;
        while (current) {
            if (current instanceof ProjectsTreeItem && current.data.type === "project") {
                return current.data.key;
            }
            current = current.parent;
        }

        return null;
    }

    /**
     * Gets the version key for this tree item
     * @return The version key if this is a version or has a version ancestor, null otherwise
     */
    public getVersionKey(): string | null {
        if (this.data.type === "version") {
            return this.data.key;
        }

        // Navigate up the tree to find version
        let current: TreeItemBase | null = this.parent;
        while (current) {
            if (current instanceof ProjectsTreeItem && current.data.type === "version") {
                return current.data.key;
            }
            current = current.parent;
        }

        return null;
    }

    /**
     * Gets the cycle key for this tree item
     * @return The cycle key if this is a cycle, null otherwise
     */
    public getCycleKey(): string | null {
        if (this.data.type === "cycle") {
            return this.data.key;
        }
        return null;
    }

    /**
     * Creates a deep copy of this tree item
     * @return A new ProjectsTreeItem instance with copied data and metadata
     */
    public clone(): ProjectsTreeItem {
        const clonedTreeItem = new ProjectsTreeItem(
            { ...this.data },
            this.extensionContext,
            this.parent as ProjectsTreeItem
        );
        this._metadata.forEach((value, key) => {
            clonedTreeItem.setMetadata(key, value);
        });

        clonedTreeItem.collapsibleState = this.collapsibleState;

        return clonedTreeItem;
    }

    /**
     * Serializes this tree item to a plain object
     * @return A serialized representation of the tree item
     */
    public serialize(): any {
        return {
            data: this.data,
            id: this.id,
            label: this.label,
            description: this.description,
            contextValue: this.contextValue,
            collapsibleState: this.collapsibleState,
            metadata: Array.from(this._metadata.entries())
        };
    }

    /**
     * Deserialize a ProjectsTreeItem from saved data
     * @param data The serialized data to deserialize
     * @param extensionContext The VS Code extension context
     * @param createInstance Factory function to create the instance
     * @returns The deserialized tree item instance
     */
    public static deserialize<T extends TreeItemBase = ProjectsTreeItem>(
        data: any,
        extensionContext: vscode.ExtensionContext,
        createInstance: (data: any) => T
    ): T {
        // Create the instance using the provided factory function
        const instance = createInstance(data);

        // Restore metadata
        if (data.metadata) {
            data.metadata.forEach(([key, value]: [string, any]) => {
                instance.setMetadata(key, value);
            });
        }

        // Restore state if it's a ProjectsTreeItem
        if (instance instanceof ProjectsTreeItem) {
            if (data.collapsibleState !== undefined) {
                instance.collapsibleState = data.collapsibleState;
            }
        }

        return instance;
    }

    /**
     * Helper method to create a deserializer function for ProjectsTreeItem
     * @param parent Optional parent tree item
     * @param extensionContext Optional extension context
     * @returns A factory function for creating ProjectsTreeItem instances
     */
    public static createDeserializer(parent?: ProjectsTreeItem, extensionContext?: vscode.ExtensionContext) {
        return (data: any) => {
            const context = extensionContext || (parent?.extensionContext as vscode.ExtensionContext);
            return new ProjectsTreeItem(data.data || data, context, parent);
        };
    }

    /**
     * Helper method for deserializing with a parent
     * @param serialized The serialized data
     * @param extensionContext The VS Code extension context
     * @param parent Optional parent tree item
     * @returns The deserialized ProjectsTreeItem
     */
    public static deserializeWithParent(
        serialized: any,
        extensionContext: vscode.ExtensionContext,
        parent?: ProjectsTreeItem
    ): ProjectsTreeItem {
        return ProjectsTreeItem.deserialize(
            serialized,
            extensionContext,
            ProjectsTreeItem.createDeserializer(parent, extensionContext)
        );
    }

    /**
     * Update the tree item data with new values if provided
     * @param newData Partial data to update the tree item with
     */
    public updateData(newData: Partial<ProjectData>): void {
        Object.assign(this.data, newData);
        if (newData.name) {
            this.label = newData.name;
        }

        if (newData.description !== undefined) {
            this.description = newData.description;
        }

        this.tooltip = this.generateTooltip();
    }

    /**
     * Updates the context value based on the current state of the item
     */
    public updateContextValue(): void {
        let contextValue =
            this.data.type === "project"
                ? "Project"
                : this.data.type === "version"
                  ? "Version"
                  : this.data.type === "cycle"
                    ? "Cycle"
                    : "Other";

        // Add custom root context if this is a custom root
        if (this._metadata.has("isCustomRoot") && this._metadata.get("isCustomRoot") === true) {
            contextValue = `customRoot.${contextValue}`;
        }

        this.contextValue = contextValue;
    }
}
