/**
 * @file src/treeViews/implementations/testElements/TestElementsTreeItem.ts
 * @description Tree item implementation for test elements.
 */

import * as vscode from "vscode";
import { TreeItemBase } from "../../core/TreeItemBase";
import { EventBus } from "../../utils/EventBus";

export enum TestElementType {
    Subdivision = "Subdivision",
    Interaction = "Interaction",
    DataType = "DataType",
    Condition = "Condition",
    Other = "Other"
}

export interface TestElementData {
    id: string;
    parentId: string | null;
    name: string;
    uniqueID: string;
    libraryKey: string | null;
    jsonString: string;
    details: any;
    testElementType: TestElementType;
    directRegexMatch: boolean;
    children?: TestElementData[];
    hierarchicalName: string;
    parent?: TestElementData;
}

// Extended interface for tree item specific data
export interface TestElementItemData extends TestElementData {
    tovKey?: string;
    resourceFiles?: string[];
    isLocallyAvailable?: boolean;
    localPath?: string;
}

export class TestElementsTreeItem extends TreeItemBase {
    public readonly data: TestElementItemData;
    private _resourceStatus: "none" | "available" | "missing" | "partial" = "none";
    private eventBus: EventBus;
    private _isLocallyAvailable: boolean = false;
    protected _children: TreeItemBase[] = [];

    constructor(
        data: TestElementItemData,
        extensionContext: vscode.ExtensionContext,
        parent?: TestElementsTreeItem,
        eventBus?: EventBus
    ) {
        const label = TestElementsTreeItem.extractLabel(data.hierarchicalName || data.name);
        const description = TestElementsTreeItem.buildDescription(data);
        const collapsibleState = TestElementsTreeItem.getInitialCollapsibleState(data);
        const contextValue = TestElementsTreeItem.getContextValue(data.testElementType);

        super(label, description, contextValue, collapsibleState, extensionContext, parent);
        this.data = data;
        this._isLocallyAvailable = data.isLocallyAvailable || false;
        this.eventBus = eventBus || new EventBus();

        this.id = this.generateUniqueId();
        this.updateResourceStatus();
        this.tooltip = this.generateTooltip();
        this.registerEventHandlers();

        // Set resource URI for theme integration
        if (this.data.hierarchicalName) {
            this.resourceUri = vscode.Uri.parse(`testElement:${this.data.hierarchicalName}`);
        }
    }

    /**
     * Registers event handlers for resource file updates and availability changes.
     * Listens for events from the event bus and updates the tree item accordingly.
     */
    private registerEventHandlers(): void {
        // Listen for resource file updates
        this.eventBus.on("resourceFiles:updated", (event) => {
            const { elementId, files } = event.data;
            if (elementId === this.data.id) {
                this.updateResourceFiles(files);
                this.updateResourceStatus();
                this.tooltip = this.generateTooltip();
                this.eventBus.emit({
                    type: "testElement:updated",
                    source: "testElement",
                    data: { id: this.id },
                    timestamp: Date.now()
                });
            }
        });

        // Listen for availability updates
        this.eventBus.on("resource:availabilityChanged", (event) => {
            const { elementId, isAvailable, localPath } = event.data;
            if (elementId === this.data.id) {
                this.updateAvailability(isAvailable, localPath);
                this.updateResourceStatus();
                this.tooltip = this.generateTooltip();
                this.eventBus.emit({
                    type: "testElement:updated",
                    source: "testElement",
                    data: { id: this.id },
                    timestamp: Date.now()
                });
            }
        });
    }

    /**
     * Generates a unique identifier for this tree item.
     * Uses hierarchical name if available, otherwise constructs from parent path and name.
     * @returns A unique string identifier for this tree item.
     */
    protected generateUniqueId(): string {
        // Use hierarchical name as unique ID, or fallback to name + parent path
        if (this.data.hierarchicalName) {
            return `testElement:${this.data.hierarchicalName}`;
        }

        const parentPath = this.parent ? (this.parent as TestElementsTreeItem).id : "";
        return `testElement:${parentPath}/${this.data.name}`;
    }

    /**
     * Updates the ID when context changes
     */
    public updateId(): void {
        (this as any).id = this.generateUniqueId();
    }

    /**
     * Extracts the display label from a hierarchical name.
     * @param hierarchicalName The hierarchical name to extract the label from.
     * @returns The last part of the hierarchical name, or "Unknown" if empty.
     */
    private static extractLabel(hierarchicalName: string): string {
        if (!hierarchicalName) {
            return "Unknown";
        }

        // Extract last part of hierarchical name (after last /)
        const parts = hierarchicalName.split("/");
        return parts[parts.length - 1] || hierarchicalName;
    }

    /**
     * Builds a description string for the tree item.
     * @param data The test element data containing information to display.
     * @returns A formatted description string with unique ID and other relevant information.
     */
    private static buildDescription(data: TestElementItemData): string {
        if (data.uniqueID) {
            return data.uniqueID;
        }

        return "";
    }

    /**
     * Determines the initial collapsible state for a tree item based on its data.
     * @param data The test element data containing type and children information.
     * @returns The appropriate collapsible state for the tree item.
     */
    private static getInitialCollapsibleState(data: TestElementItemData): vscode.TreeItemCollapsibleState {
        // Only subdivisions can have children in the test element hierarchy
        if (data.testElementType === TestElementType.Subdivision) {
            if (data.children && data.children.length > 0) {
                return vscode.TreeItemCollapsibleState.Collapsed;
            }
            return vscode.TreeItemCollapsibleState.None;
        }

        return vscode.TreeItemCollapsibleState.None;
    }

    /**
     * Creates a context value string for the given element type.
     * @param elementType The type of test element.
     * @returns A context value string for commands and when clauses.
     */
    private static getContextValue(elementType: TestElementType): string {
        return `testElement.${elementType.toLowerCase()}`;
    }

    /**
     * Generates a tooltip string containing detailed information about the tree item.
     * @returns A formatted tooltip string with type, name, and additional details.
     */
    private generateTooltip(): string {
        const tooltipLines: string[] = [`Type: ${this.data.testElementType}`, `Name: ${this.data.name}`];

        if (this.data.uniqueID) {
            tooltipLines.push(`UniqueID: ${this.data.uniqueID}`);
        }

        if (this.data.libraryKey) {
            tooltipLines.push(`LibraryKey: ${this.data.libraryKey}`);
        }

        if (this.data.details) {
            if (this.data.details.hasVersion !== undefined) {
                tooltipLines.push(`Has Version: ${this.data.details.hasVersion}`);
            }
            if (this.data.details.status !== undefined) {
                const status = this.data.details.status;
                tooltipLines.push(`Status: ${typeof status === "string" ? status : String(status)}`);
            }
        } else {
            tooltipLines.push("Details: Not available");
        }

        return tooltipLines.join("\n");
    }

    /**
     * Updates the resource status based on available resource files and local availability.
     */
    private updateResourceStatus(): void {
        if (!this.data.resourceFiles || this.data.resourceFiles.length === 0) {
            this._resourceStatus = "none";
            return;
        }

        if (this.data.isLocallyAvailable) {
            this._resourceStatus = "available";
        } else {
            this._resourceStatus = "missing";
        }
    }

    /**
     * Updates the availability status and local path of the test element.
     * @param {boolean} isAvailable - Whether the element is locally available.
     * @param {string} [localPath] - Optional local file path.
     */
    public updateAvailability(isAvailable: boolean, localPath?: string): void {
        this.data.isLocallyAvailable = isAvailable;
        this.data.localPath = localPath;

        // Update visual indicators
        this.updateResourceStatus();
        this.tooltip = this.generateTooltip();
        // Notify tree view of the change
        this.eventBus.emit({
            type: "testElement:updated",
            source: "testElement",
            data: { id: this.id },
            timestamp: Date.now()
        });
    }

    /**
     * Updates the resource files associated with this test element.
     * @param {string[]} files - Array of resource file paths.
     */
    public updateResourceFiles(files: string[]): void {
        this.data.resourceFiles = files;
        this.updateResourceStatus();
        this.tooltip = this.generateTooltip();

        // Notify tree view of the change
        this.eventBus.emit({
            type: "testElement:updated",
            source: "testElement",
            data: { id: this.id },
            timestamp: Date.now()
        });
    }

    /**
     * Gets the full path to this test element.
     * @returns {string} The full path, constructed from local path, hierarchical name, or parent hierarchy.
     */
    public getFullPath(): string {
        if (this.data.localPath) {
            return this.data.localPath;
        }

        if (this.data.hierarchicalName) {
            return this.data.hierarchicalName;
        }

        // Fallback: build path from parent hierarchy
        return this.buildPathFromAncestors();
    }

    /**
     * Builds a path string by traversing up the parent hierarchy and collecting ancestor names.
     * @returns {string} A slash-separated path constructed from the current item and all its ancestors.
     */
    private buildPathFromAncestors(): string {
        const pathParts: string[] = [this.data.name];

        let parentItem = this.parent as TestElementsTreeItem | null;

        while (parentItem) {
            pathParts.unshift(parentItem.data.name);
            parentItem = parentItem.parent as TestElementsTreeItem | null;
        }

        return pathParts.join("/");
    }

    /**
     * Determines whether this test element can have child elements.
     * @returns {boolean} True if this element can have children, false otherwise.
     */
    public canHaveChildren(): boolean {
        // Only subdivisions can have children in the test element hierarchy
        return this.data.testElementType === TestElementType.Subdivision;
    }

    /**
     * Checks if this test element currently has any child elements.
     * @returns {boolean} True if this element has children, false otherwise.
     */
    public hasChildren(): boolean {
        return this.data.children !== undefined && this.data.children.length > 0;
    }

    /**
     * Gets the current resource status of this test element.
     * @returns {"none" | "available" | "missing" | "partial"} The resource status.
     */
    public get resourceStatus(): "none" | "available" | "missing" | "partial" {
        return this._resourceStatus;
    }

    /**
     * Gets the type of this test element.
     * @returns {TestElementType} The test element type.
     */
    public get elementType(): TestElementType {
        return this.data.testElementType;
    }

    /**
     * Creates a deep copy of this test element tree item.
     * @returns {TestElementsTreeItem} A new instance with copied data, metadata, and state.
     */
    public clone(): TestElementsTreeItem {
        const cloned = new TestElementsTreeItem(
            {
                ...this.data,
                resourceFiles: [...(this.data.resourceFiles || [])],
                children: [...(this.data.children || [])]
            },
            this.extensionContext,
            this.parent as TestElementsTreeItem
        );

        // Copy metadata
        this._metadata.forEach((value, key) => {
            cloned.setMetadata(key, value);
        });

        // Copy state
        cloned.collapsibleState = this.collapsibleState;
        cloned._resourceStatus = this._resourceStatus;

        return cloned;
    }

    /**
     * Serializes this test element tree item to a plain object for storage or transmission.
     * Excludes children and parent references to avoid circular references.
     * @returns {any} A serialized representation of this tree item.
     */
    public serialize(): any {
        return {
            data: {
                ...this.data,
                resourceFiles: [...(this.data.resourceFiles || [])],
                // Don't serialize children to avoid circular references because of child and parent references
                children: undefined,
                parent: undefined
            },
            id: this.id,
            label: this.label,
            description: this.description,
            contextValue: this.contextValue,
            collapsibleState: this.collapsibleState,
            resourceStatus: this._resourceStatus,
            metadata: Array.from(this._metadata.entries())
        };
    }

    /**
     * Deserializes a test element tree item from serialized data.
     * @param {any} data - The serialized data to deserialize.
     * @param {vscode.ExtensionContext} extensionContext - The extension context.
     * @param {(data: any) => T} createInstance - Function to create the instance.
     * @returns {T} The deserialized tree item instance.
     */
    public static deserialize<T extends TreeItemBase = TestElementsTreeItem>(
        data: any,
        extensionContext: vscode.ExtensionContext,
        createInstance: (data: any) => T
    ): T {
        const instance = createInstance(data);

        // Restore metadata
        if (data.metadata) {
            data.metadata.forEach(([key, value]: [string, any]) => {
                instance.setMetadata(key, value);
            });
        }

        // Restore state
        if (instance instanceof TestElementsTreeItem) {
            if (data.collapsibleState !== undefined) {
                instance.collapsibleState = data.collapsibleState;
            }

            if (data.resourceStatus) {
                instance._resourceStatus = data.resourceStatus;
            }
        }

        return instance;
    }

    /**
     * Creates a deserializer function for TestElementsTreeItem instances.
     * @param {TestElementsTreeItem} [parent] - Optional parent tree item.
     * @param {vscode.ExtensionContext} [extensionContext] - Optional extension context.
     * @returns {(data: any) => TestElementsTreeItem} A function that creates TestElementsTreeItem instances.
     */
    public static createDeserializer(
        parent?: TestElementsTreeItem,
        extensionContext?: vscode.ExtensionContext
    ): (data: any) => TestElementsTreeItem {
        return (data: any) => {
            const ctx = extensionContext || (parent?.extensionContext as vscode.ExtensionContext);
            return new TestElementsTreeItem(data.data || data, ctx, parent);
        };
    }

    /**
     * Updates the local availability status of this test element.
     * @param {boolean} isAvailable - Whether the element is locally available.
     */
    public updateLocalAvailability(isAvailable: boolean): void {
        this._isLocallyAvailable = isAvailable;
        this.data.isLocallyAvailable = isAvailable;

        this.tooltip = this.generateTooltip();
        // Notify tree view of the change
        this.eventBus.emit({
            type: "testElement:updated",
            source: "testElement",
            data: { id: this.id },
            timestamp: Date.now()
        });
    }

    /**
     * Adds a child tree item to this test element.
     * @param {TreeItemBase} child - The child tree item to add.
     */
    public addChild(child: TreeItemBase): void {
        this._children.push(child);
        this.updateCollapsibleState();
    }

    /**
     * Removes a child tree item from this test element.
     * @param {TreeItemBase} child - The child tree item to remove.
     * @returns {boolean} True if the child was found and removed, false otherwise.
     */
    public removeChild(child: TreeItemBase): boolean {
        const index = this._children.indexOf(child);
        if (index !== -1) {
            this._children.splice(index, 1);
            this.updateCollapsibleState();
            return true;
        }
        return false;
    }

    /**
     * Updates the collapsible state based on the number of children.
     * For subdivisions, sets to collapsed if there are children, none otherwise.
     */
    private updateCollapsibleState(): void {
        if (this.data.testElementType === TestElementType.Subdivision) {
            if (this._children.length > 0) {
                this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            } else {
                this.collapsibleState = vscode.TreeItemCollapsibleState.None;
            }
        }
    }

    /**
     * Gets the children of this test element.
     * @returns {TreeItemBase[]} Array of child tree items.
     */
    public get children(): TreeItemBase[] {
        return this._children;
    }

    /**
     * Sets the children of this test element.
     * @param {TreeItemBase[]} value - Array of child tree items.
     */
    public set children(value: TreeItemBase[]) {
        this._children = value;
        this.updateCollapsibleState();
    }
}
