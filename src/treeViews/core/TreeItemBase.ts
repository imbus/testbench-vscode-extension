/**
 * @file src/treeViews/core/TreeItemBase.ts
 * @description Base class for all tree items in the VS Code extension framework.
 */

import * as vscode from "vscode";

/**
 * Base class for all tree items.
 * Provides the base functionality for all tree items.
 */
export abstract class TreeItemBase extends vscode.TreeItem {
    protected _children: TreeItemBase[] = [];
    protected _parent: TreeItemBase | null = null;
    protected _metadata: Map<string, any> = new Map();
    protected _originalContextValue: string;
    protected _disposed: boolean = false;

    constructor(
        label: string,
        description: string | undefined,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
        protected extensionContext: vscode.ExtensionContext,
        parent?: TreeItemBase
    ) {
        super(label, collapsibleState);
        this.description = description;
        this._originalContextValue = contextValue;
        this.contextValue = contextValue;
        this._parent = parent || null;
        // The ID will be set by subclasses.
    }

    // Getters and Setters
    get children(): TreeItemBase[] {
        return this._children;
    }

    set children(value: TreeItemBase[]) {
        this._children = value;
    }

    get parent(): TreeItemBase | null {
        return this._parent;
    }

    set parent(value: TreeItemBase | null) {
        this._parent = value;
    }

    get originalContextValue(): string {
        return this._originalContextValue;
    }

    get disposed(): boolean {
        return this._disposed;
    }

    /**
     * Set metadata value for a given key
     * @param key The metadata key
     * @param value The metadata value
     */
    public setMetadata(key: string, value: any): void {
        this._metadata.set(key, value);
    }

    /**
     * Get metadata value for a given key
     * @param key The metadata key
     * @returns The metadata value or undefined if not found
     */
    public getMetadata(key: string): any {
        return this._metadata.get(key);
    }

    /**
     * Check if metadata exists for a given key
     * @param key The metadata key
     * @returns True if metadata exists, false otherwise
     */
    public hasMetadata(key: string): boolean {
        return this._metadata.has(key);
    }

    /**
     * Clear all metadata
     */
    public clearMetadata(): void {
        this._metadata.clear();
    }

    /**
     * Get all ancestor items from root to parent
     * @returns Array of ancestor items
     */
    public getAncestors(): TreeItemBase[] {
        const ancestors: TreeItemBase[] = [];
        let currentParent = this.parent;

        while (currentParent) {
            ancestors.push(currentParent);
            currentParent = currentParent.parent;
        }

        return ancestors;
    }

    /**
     * Get the depth of this item in the tree
     * @returns The depth level (0 for root)
     */
    public getDepth(): number {
        return this.getAncestors().length;
    }

    /**
     * Get the root item of this tree.
     * If there are ancestors, returns the last one (the root).
     * Otherwise, returns this item (it's the root).
     * @returns The root item or this item if it's the root
     */
    public getRoot(): TreeItemBase {
        const ancestors = this.getAncestors();
        return ancestors.length > 0 ? ancestors[ancestors.length - 1] : this;
    }

    /**
     * Gets all descendant tree items.
     * Uses a stack to traverse the tree in depth-first order,
     * starting from the current item's children until all items are processed.
     * @returns Array of all descendant items
     */
    public getDescendants(): TreeItemBase[] {
        const descendants: TreeItemBase[] = [];
        const stack: TreeItemBase[] = [...this.children];

        while (stack.length > 0) {
            const currentItem = stack.pop()!;
            descendants.push(currentItem);
            stack.push(...currentItem.children);
        }

        return descendants;
    }

    /**
     * Finds a descendant item that matches the predicate.
     * @param predicate Function to test each item
     * @returns The matching item or null if not found
     */
    public findDescendant(predicate: (item: TreeItemBase) => boolean): TreeItemBase | null {
        const stack: TreeItemBase[] = [...this.children];

        while (stack.length > 0) {
            const item = stack.pop()!;
            if (predicate(item)) {
                return item;
            }
            stack.push(...item.children);
        }

        return null;
    }

    /**
     * Gets sibling items (items with the same parent)
     * @returns Array of sibling items
     */
    public getSiblings(): TreeItemBase[] {
        if (!this.parent) {
            return [];
        }

        return this.parent.children.filter((child) => child !== this);
    }

    /**
     * Adds a child item to the current item.
     * @param child The child item to add
     */
    public addChild(child: TreeItemBase): void {
        if (!this._children.includes(child)) {
            this._children.push(child);
            child.parent = this;
        }
    }

    /**
     * Removes a child item from the current item.
     * @param child The child item to remove
     * @returns True if removed, false if not found
     */
    public removeChild(child: TreeItemBase): boolean {
        const index = this._children.indexOf(child);
        if (index > -1) {
            this._children.splice(index, 1);
            child.parent = null;
            return true;
        }
        return false;
    }

    /**
     * Removes all child items from the current item.
     */
    public removeAllChildren(): void {
        for (const child of this._children) {
            child.parent = null;
        }
        this._children = [];
    }

    /**
     * Sorts child items using a comparison function.
     * @param compareFn Function to compare two items
     */
    public sortChildren(compareFn: (a: TreeItemBase, b: TreeItemBase) => number): void {
        this._children.sort(compareFn);
    }

    /**
     * Updates the context value by adding or removing a suffix.
     * @param suffix The suffix to add or remove
     * @param add True to add suffix, false to remove
     */
    public updateContextValue(suffix: string, add: boolean = true): void {
        if (add) {
            this.addSuffixToContextValue(suffix);
        } else {
            this.removeSuffixFromContextValue(suffix);
        }
    }

    /**
     * Adds a suffix to the context value with proper dot separation.
     * @param suffix The suffix to add to the context value
     */
    private addSuffixToContextValue(suffix: string): void {
        if (!this.contextValue) {
            this.contextValue = suffix;
            return;
        }

        if (this.contextValue.includes(suffix)) {
            return;
        }

        const hasDotSeparator = this.contextValue.includes(".");
        this.contextValue = hasDotSeparator ? `${suffix}${this.contextValue}` : `${this.contextValue}.${suffix}`;
    }

    /**
     * Removes a suffix from the context value by splitting on dots and filtering.
     * @param suffix The suffix to remove from the context value
     */
    private removeSuffixFromContextValue(suffix: string): void {
        if (!this.contextValue?.includes(suffix)) {
            return;
        }

        const contextParts = this.contextValue.split(".");
        const filteredParts = contextParts.filter((part) => part !== suffix);
        this.contextValue = filteredParts.join(".");
    }

    /**
     * Reset context value to its original value
     */
    public resetContextValue(): void {
        this.contextValue = this._originalContextValue;
    }

    /**
     * Disposes this item and all its children.
     * Children are disposed first, then the current item.
     * Clears references to parent, children, and metadata.
     */
    public dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;

        for (const child of this.children) {
            if (child && !child.disposed) {
                child.dispose();
            }
        }

        this._children = [];
        this._parent = null;
        this._metadata.clear();
    }

    /**
     * Generates a unique identifier for this item.
     * @returns The unique identifier
     */
    protected abstract generateUniqueId(): string;

    /**
     * Creates a clone of this item.
     * @returns A new instance of this item
     */
    public abstract clone(): TreeItemBase;

    /**
     * Serializes this item to a plain object.
     * Subclasses overrides this, call super.serialize(), and add their specific data.
     * @returns A base serialized object.
     */
    public serialize(): any {
        return {
            id: this.id,
            label: this.label,
            description: this.description,
            contextValue: this.contextValue,
            collapsibleState: this.collapsibleState,
            metadata: Array.from(this._metadata.entries())
        };
    }

    /**
     * Deserializes data into a tree item instance.
     * This generic static method can be used by all subclasses.
     * @param data Serialized data
     * @param extensionContext VS Code extension context
     * @param createInstance Factory function to create the specific instance
     * @returns The deserialized instance
     */
    public static deserialize<T extends TreeItemBase>(
        data: any,
        extensionContext: vscode.ExtensionContext,
        createInstance: (data: any) => T
    ): T {
        const instance = createInstance(data);

        if (data.metadata) {
            data.metadata.forEach(([key, value]: [string, any]) => {
                instance.setMetadata(key, value);
            });
        }

        if (data.collapsibleState !== undefined) {
            instance.collapsibleState = data.collapsibleState;
        }

        if (data.tooltip) {
            instance.tooltip = data.tooltip;
        }

        return instance;
    }
}
