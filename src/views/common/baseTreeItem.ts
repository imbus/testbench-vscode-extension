/**
 * @file src/views/common/baseTreeItem.ts
 * @description Base class for all tree items with centralized icon and state management
 */

import * as vscode from "vscode";
import { IconManagementService } from "./iconManagementService";
import { TestBenchLogger } from "../../testBenchLogger";

export interface TreeItemIconConfig {
    light: string;
    dark: string;
    markedLight?: string;
    markedDark?: string;
}

export interface TreeItemState {
    isMarked?: boolean;
    isExpanded?: boolean;
    isCustomRoot?: boolean;
    status?: string;
}

/**
 * Base class for all tree items providing common functionality
 */
export abstract class BaseTreeItem extends vscode.TreeItem implements vscode.Disposable {
    public parent: BaseTreeItem | null;
    public children?: BaseTreeItem[];
    public readonly originalContextValue: string;
    public state: TreeItemState = {};
    public itemData: any;

    // Store unique ID separately to survive disposal
    private readonly _uniqueId: string;

    // Dependencies
    protected readonly logger: TestBenchLogger;
    protected readonly iconService: IconManagementService;
    protected readonly extensionContext: vscode.ExtensionContext;

    // Resource management
    private _isDisposed = false;
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        label: string,
        contextValue: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        itemData: any,
        extensionContext: vscode.ExtensionContext,
        logger: TestBenchLogger,
        iconService: IconManagementService,
        parent: BaseTreeItem | null = null
    ) {
        super(label, collapsibleState);
        this.originalContextValue = contextValue;
        this.contextValue = contextValue;
        this.itemData = itemData;
        this.extensionContext = extensionContext;
        this.logger = logger;
        this.iconService = iconService;
        this.parent = parent;

        // Extract and store unique ID immediately, before any potential disposal
        this._uniqueId = this.extractUniqueId();

        this.initializeState();
        this.setupTooltip();
        this.updateIcon();
    }

    /**
     * Extract unique ID from item data
     */
    private extractUniqueId(): string {
        return (
            this.itemData?.key ||
            this.itemData?.base?.key ||
            this.itemData?.uniqueID ||
            this.itemData?.base?.uniqueID ||
            `fallback_${Date.now()}`
        );
    }

    /**
     * Registers a disposable resource to be cleaned up when this item is disposed
     * @param disposable The resource to register for cleanup
     * @returns The disposable for chaining
     */
    protected registerDisposable<T extends vscode.Disposable>(disposable: T): T {
        if (this._isDisposed) {
            this.logger.warn(`[BaseTreeItem] Attempting to register disposable on disposed item: ${this.label}`);
            disposable.dispose();
            return disposable;
        }
        this._disposables.push(disposable);
        return disposable;
    }

    /**
     * Safely disposes of this tree item and all its resources
     * Breaks circular references and cleans up child items
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;

        try {
            // Dispose all registered disposables
            this._disposables.forEach((disposable) => {
                try {
                    disposable.dispose();
                } catch (error) {
                    this.logger.error(`[BaseTreeItem] Error disposing resource for ${this.label}:`, error);
                }
            });
            this._disposables.length = 0;

            // Recursively dispose children to prevent memory leaks
            if (this.children) {
                this.children.forEach((child) => {
                    if (child && typeof child.dispose === "function") {
                        try {
                            child.dispose();
                        } catch (error) {
                            this.logger.error(`[BaseTreeItem] Error disposing child ${child.label}:`, error);
                        }
                    }
                });
                this.children = undefined;
            }

            // Break parent reference to prevent circular references
            this.parent = null;

            // Clear item data reference
            this.itemData = null;
            // NOTE: We intentionally keep _uniqueId intact to support disposed item identification

            this.logger.trace(`[BaseTreeItem] Successfully disposed: ${this.label}`);
        } catch (error) {
            this.logger.error(`[BaseTreeItem] Error during disposal of ${this.label}:`, error);
        }
    }

    /**
     * Checks if this item has been disposed
     * @returns True if the item has been disposed
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Throws an error if this item has been disposed
     * @param operation The operation being attempted
     */
    protected throwIfDisposed(operation: string): void {
        if (this._isDisposed) {
            throw new Error(`[BaseTreeItem] Cannot ${operation} on disposed item: ${this.label}`);
        }
    }

    /**
     * Initialize the tree item state from item data
     */
    protected initializeState(): void {
        this.state = {
            isMarked: false,
            isExpanded: this.collapsibleState === vscode.TreeItemCollapsibleState.Expanded,
            isCustomRoot: false,
            status: this.extractStatus()
        };
    }

    /**
     * Extract status from item data
     */
    protected extractStatus(): string {
        return this.itemData?.exec?.status || this.itemData?.status || this.itemData?.base?.status || "None";
    }

    /**
     * Setup tooltip
     */
    protected setupTooltip(): void {
        this.tooltip = this.buildTooltipContent();
    }

    /**
     * Build tooltip content
     */
    protected abstract buildTooltipContent(): string | vscode.MarkdownString;

    /**
     * Get icon category for this tree item type
     */
    protected abstract getIconCategory(): string;

    /**
     * Update the icon based on current state with disposal check
     */
    public updateIcon(): void {
        this.throwIfDisposed("update icon");

        try {
            if (!this.iconService) {
                this.logger.warn(`[BaseTreeItem] IconService not available for ${String(this.label)}`);
                this.setFallbackIcon();
                return;
            }
            const iconContext = {
                contextValue: this.contextValue!,
                status: this.state.status,
                isMarked: this.state.isMarked,
                isCustomRoot: this.state.isCustomRoot,
                originalContextValue: this.originalContextValue
            };
            this.iconPath = this.iconService.getIconUris(iconContext, this.getIconCategory());
        } catch (error) {
            this.logger.error(`Error updating icon for ${String(this.label)}:`, error);
            this.setFallbackIcon();
        }
    }

    /**
     * Set fallback icon when icon update fails
     */
    protected setFallbackIcon(): void {
        if (this.iconService) {
            this.iconPath = this.iconService.getIconUris({ contextValue: "default", status: "default" }, "default");
        } else {
            const fallbackIconName = "other.svg";
            this.iconPath = {
                light: vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", fallbackIconName),
                dark: vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", fallbackIconName)
            };
        }
    }

    /**
     * Update tree item state with disposal check
     */
    public updateState(newState: Partial<TreeItemState>): void {
        this.throwIfDisposed("update state");
        this.state = { ...this.state, ...newState };
        this.updateIcon();

        if (newState.isExpanded !== undefined) {
            this.collapsibleState = newState.isExpanded
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed;
        }
    }

    /**
     * Get current state
     */
    public getState(): Readonly<TreeItemState> {
        return { ...this.state };
    }

    /**
     * Mark/unmark the item
     */
    public setMarked(marked: boolean): void {
        this.updateState({ isMarked: marked });
    }

    /**
     * Check if item is marked
     */
    public isMarked(): boolean {
        return this.state.isMarked || false;
    }

    /**
     * Set as custom root
     */
    public setAsCustomRoot(isRoot: boolean): void {
        this.updateState({ isCustomRoot: isRoot });
        if (isRoot) {
            this.parent = null;
        }
    }

    /**
     * Get unique identifier for this item
     * This now returns the preserved unique ID that survives disposal
     */
    public getUniqueId(): string {
        return this._uniqueId;
    }

    /**
     * Get UID if available
     */
    public getUID(): string | undefined {
        if (this._isDisposed) {
            // For disposed items, we can't access itemData, so return undefined
            return undefined;
        }
        return this.itemData?.base?.uniqueID || this.itemData?.uniqueID;
    }

    /**
     * Handle expansion state change
     */
    public handleExpansion(expanded: boolean): void {
        this.updateState({ isExpanded: expanded });
    }
}
