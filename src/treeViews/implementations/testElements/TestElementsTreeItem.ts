/**
 * @file src/treeViews/implementations/testElements/TestElementsTreeItem.ts
 * @description Tree item implementation for test elements.
 */

import * as vscode from "vscode";
import { TreeItemBase } from "../../core/TreeItemBase";
import { EventBus } from "../../utils/EventBus";
import { allExtensionCommands } from "../../../constants";
import { userSessionManager } from "../../../extension";
import { ResourceFileService } from "./ResourceFileService";

export enum TestElementType {
    Subdivision = "Subdivision",
    Keyword = "Keyword",
    DataType = "DataType",
    Condition = "Condition",
    Other = "Other"
}

export interface TestElementData {
    id: string;
    parentId: string | null;
    displayName: string;
    originalName: string;
    uniqueID: string;
    libraryKey: string | null;
    jsonString: string;
    details: any;
    testElementType: TestElementType;
    directRegexMatch: boolean;
    children?: TestElementData[];
    hierarchicalName: string;
    parent?: TestElementData;
    isVirtual?: boolean;
    hasResourceDescendant?: boolean;
}

// Extended interface for tree item specific data
export interface TestElementItemData extends TestElementData {
    tovKey?: string;
    resourceFiles?: string[];
    isLocallyAvailable?: boolean;
    localPath?: string;
    hasLocalChildren?: boolean;
}

export class TestElementsTreeItem extends TreeItemBase {
    public readonly data: TestElementItemData;
    private _resourceStatus: "none" | "available" | "missing" | "partial" = "none";
    private _hasLocalChildren: boolean = false;
    private eventBus: EventBus;

    constructor(
        data: TestElementItemData,
        extensionContext: vscode.ExtensionContext,
        parent?: TestElementsTreeItem,
        eventBus?: EventBus,
        /**
         * If false, prevents this item from being added to its parent's children.
         * Used by the `clone` method to avoid modifying the original tree, which
         * caused an infinite loop during filtering.
         */
        addToParent: boolean = true
    ) {
        const label = TestElementsTreeItem.extractLabel(data.hierarchicalName || data.displayName);
        const description = TestElementsTreeItem.buildDescription(data);
        const collapsibleState = TestElementsTreeItem.getInitialCollapsibleState(data);
        const initialContextValue = TestElementsTreeItem.getInitialContextValue(data);

        super(label, description, initialContextValue, collapsibleState, extensionContext, parent);

        this.data = data;
        this.eventBus = eventBus || new EventBus();
        this.id = this.generateUniqueId();
        this.tooltip = this.generateTooltip();
        this.registerEventHandlers();

        if (parent && addToParent) {
            parent.addChild(this);
        }

        // Re-evaluate context after parent linkage so keyword context can use actual tree ancestry.
        this.updateContextValue();

        if (this.data.testElementType === TestElementType.Keyword) {
            this.command = {
                command: allExtensionCommands.handleKeywordClick,
                title: "Open Resource",
                arguments: [this]
            };
        }

        if (this.data.hierarchicalName) {
            this.resourceUri = vscode.Uri.parse(`testElement:${this.data.hierarchicalName}`);
        }
    }

    /**
     * Determines the initial context value for a tree item based on its data.
     * @param data The test element data.
     * @returns The context value string.
     */
    private static getInitialContextValue(data: TestElementItemData): string {
        const elementType = data.testElementType;

        if (elementType === TestElementType.Subdivision) {
            if (data.displayName === undefined || data.displayName === null) {
                return "testElement.subdivision.folder";
            }
            const isResource = ResourceFileService.hasResourceMarker(data.displayName);
            if (isResource) {
                return data.isLocallyAvailable
                    ? "testElement.subdivision.resource.available"
                    : "testElement.subdivision.resource.missing";
            } else {
                if (data.isVirtual) {
                    return "testElement.subdivision.virtualFolder";
                }

                if (data.hasResourceDescendant) {
                    return "testElement.subdivision.folder";
                }

                return "testElement.subdivision.plain";
            }
        }

        if (elementType === TestElementType.Keyword) {
            if (!this.hasResourceSubdivisionInDataHierarchy(data)) {
                return "testElement.keyword";
            }
            const parentResource = this.getParentResourceAvailability(data);
            return parentResource ? "testElement.keyword.resource.available" : "testElement.keyword.resource.missing";
        }

        return `testElement.${elementType.toLowerCase()}`;
    }

    /**
     * Determines if the parent resource for an keyword is locally available.
     * @param data The test element data
     * @returns True if parent resource is locally available, false otherwise
     */
    private static getParentResourceAvailability(data: TestElementItemData): boolean {
        return data.isLocallyAvailable || false;
    }

    /**
     * Checks whether a subdivision entry qualifies as a resource subdivision.
     * @param type The element type.
     * @param directMatch Whether the element directly matched a resource regex pattern.
     * @param name Optional resolved name to check against resource markers.
     * @returns True when the element is a resource-marked subdivision.
     */
    private static isResourceMarkedSubdivision(type: TestElementType, directMatch: boolean, name?: string): boolean {
        return (
            type === TestElementType.Subdivision &&
            (directMatch || (name ? ResourceFileService.hasResourceMarker(name) : false))
        );
    }

    /**
     * Checks whether the keyword belongs to a hierarchy that contains a resource-marked subdivision.
     * @param data The keyword data.
     * @returns True when any ancestor subdivision is marked as resource, otherwise false.
     */
    private static hasResourceSubdivisionInDataHierarchy(data: TestElementItemData): boolean {
        let currentParent = data.parent;

        while (currentParent) {
            const subdivisionName = TestElementsTreeItem.resolveSubdivisionName(currentParent);
            if (
                TestElementsTreeItem.isResourceMarkedSubdivision(
                    currentParent.testElementType,
                    currentParent.directRegexMatch,
                    subdivisionName
                )
            ) {
                return true;
            }

            currentParent = currentParent.parent;
        }

        return false;
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
        const userId = userSessionManager.getCurrentUserId();
        // Use hierarchical name as unique ID, or fallback to name + parent path
        if (this.data.hierarchicalName) {
            return `${userId}:testElement:${this.data.hierarchicalName}`;
        }

        const parentPath = this.parent ? (this.parent as TestElementsTreeItem).id : "";
        return `${userId}:testElement:${parentPath}/${this.data.displayName}`;
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
     * Generates a tooltip string containing detailed information about the tree item.
     * @returns A formatted tooltip string with type, name, and additional details.
     */
    private generateTooltip(): string {
        const tooltipLines: string[] = [`Type: ${this.data.testElementType}`, `Name: ${this.data.displayName}`];

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
        this.updateContextValue();
        this.tooltip = this.generateTooltip();
        this.eventBus.emit({
            type: "testElement:updated",
            source: "testElement",
            data: { id: this.id },
            timestamp: Date.now()
        });

        if (
            this.data.testElementType === TestElementType.Subdivision &&
            this.data.displayName &&
            ResourceFileService.hasResourceMarker(this.data.displayName)
        ) {
            this.updateChildKeywords(isAvailable);
        }
    }

    /**
     * Updates child keywords when parent resource availability changes.
     * @param {boolean} parentAvailable - Whether the parent resource is available.
     */
    private updateChildKeywords(parentAvailable: boolean): void {
        if (this.children) {
            for (const child of this.children) {
                const childItem = child as TestElementsTreeItem;
                if (childItem.data.testElementType === TestElementType.Keyword) {
                    childItem.data.isLocallyAvailable = parentAvailable;
                    childItem.updateContextValue();
                    childItem.tooltip = childItem.generateTooltip();
                    childItem.eventBus.emit({
                        type: "testElement:updated",
                        source: "testElement",
                        data: { id: childItem.id },
                        timestamp: Date.now()
                    });
                }
            }
        }
    }

    /**
     * Updates the context value when the item's state changes dynamically.
     */
    public updateContextValue(): void {
        if (this.data.testElementType === TestElementType.Keyword) {
            if (!this.isKeywordUnderResourceHierarchy()) {
                this.contextValue = "testElement.keyword";
                return;
            }

            const parent = this.parent as TestElementsTreeItem | null;
            const parentAvailable = parent?.data.isLocallyAvailable || false;
            this.contextValue = parentAvailable
                ? "testElement.keyword.resource.available"
                : "testElement.keyword.resource.missing";
        } else {
            this.contextValue = TestElementsTreeItem.getInitialContextValue(this.data);
        }
    }

    /**
     * Checks whether this keyword item is under a resource-marked subdivision hierarchy.
     * @returns True if this is a keyword and at least one ancestor subdivision is resource-marked.
     */
    public isKeywordUnderResourceHierarchy(): boolean {
        if (this.data.testElementType !== TestElementType.Keyword) {
            return false;
        }

        return this.hasResourceSubdivisionInItemHierarchy();
    }

    /**
     * Checks whether this item is inside a hierarchy containing a resource-marked subdivision.
     */
    private hasResourceSubdivisionInItemHierarchy(): boolean {
        let currentParent: TestElementsTreeItem | null = this.parent as TestElementsTreeItem | null;

        while (currentParent) {
            const subdivisionName = TestElementsTreeItem.resolveSubdivisionName(currentParent.data);
            if (
                TestElementsTreeItem.isResourceMarkedSubdivision(
                    currentParent.data.testElementType,
                    currentParent.data.directRegexMatch,
                    subdivisionName
                )
            ) {
                return true;
            }

            currentParent = currentParent.parent as TestElementsTreeItem | null;
        }

        return false;
    }

    /**
     * Resolves a subdivision name for marker checks.
     * @param data The test element data to resolve the name from.
     * @returns The resolved name if valid, otherwise undefined.
     */
    private static resolveSubdivisionName(data: Partial<TestElementData> & { name?: string }): string | undefined {
        const nameCandidates = [data.displayName, data.originalName, data.name];
        for (const candidate of nameCandidates) {
            if (typeof candidate === "string" && candidate.trim().length > 0) {
                return candidate;
            }
        }

        return undefined;
    }

    /**
     * Updates the resource files associated with this test element.
     * @param {string[]} files - Array of resource file paths.
     */
    public updateResourceFiles(files: string[]): void {
        this.data.resourceFiles = files;
        this.updateResourceStatus();
        this.tooltip = this.generateTooltip();

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
        const pathParts: string[] = [this.data.displayName];

        let parentItem = this.parent as TestElementsTreeItem | null;

        while (parentItem) {
            pathParts.unshift(parentItem.data.displayName);
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
     * Gets whether this item has any locally available child resources.
     * @returns True if any child resources exist locally, false otherwise.
     */
    public get hasLocalChildren(): boolean {
        return this._hasLocalChildren;
    }

    /**
     * Sets whether this item has any locally available child resources.
     * This is used for parent marking when child resources are created/deleted.
     * @param value True if any child resources exist locally, false otherwise.
     */
    public set hasLocalChildren(value: boolean) {
        if (this._hasLocalChildren !== value) {
            this._hasLocalChildren = value;
            this.data.hasLocalChildren = value;
            this.updateContextValue();
        }
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
            this.parent as TestElementsTreeItem,
            this.eventBus,
            // Pass false to prevent the cloned item from being added to the original parent's children.
            false
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
            // When deserializing, we want to reconstruct the original tree, so we add items to their parents.
            return new TestElementsTreeItem(data.data || data, ctx, parent, undefined, true);
        };
    }

    /**
     * Updates the local availability status of this test element tree item.
     * @param {boolean} isAvailable - Whether the element is locally available.
     * @param {string} [localPath] - The absolute local file path.
     */
    public updateLocalAvailability(isAvailable: boolean, localPath?: string): void {
        this.data.isLocallyAvailable = isAvailable;
        this.data.localPath = localPath;
        this.updateContextValue();
        this.tooltip = this.generateTooltip();

        if (
            this.data.testElementType === TestElementType.Subdivision &&
            this.data.displayName &&
            ResourceFileService.hasResourceMarker(this.data.displayName)
        ) {
            this.updateChildKeywords(isAvailable);
        }

        this.eventBus.emit({
            type: "testElement:updated",
            source: "testElement",
            data: { item: this },
            timestamp: Date.now()
        });
    }
}
