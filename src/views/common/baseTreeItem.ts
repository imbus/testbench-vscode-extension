/**
 * @file src/views/common/baseTreeItem.ts
 * @description Base class for all tree items with centralized icon and state management
 */

import * as vscode from "vscode";
import { IconManagementService } from "../../services/iconManagementService";
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
export abstract class BaseTreeItem extends vscode.TreeItem {
    public parent: BaseTreeItem | null;
    public children?: BaseTreeItem[];
    public readonly originalContextValue: string;
    public state: TreeItemState = {};
    public itemData: any;

    // Dependencies are injected
    protected readonly logger: TestBenchLogger;
    protected readonly iconService: IconManagementService;
    protected readonly extensionContext: vscode.ExtensionContext;

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

        this.initializeState();
        this.setupTooltip();
        this.updateIcon();
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
     * Update the icon based on current state using icon management service
     */
    public updateIcon(): void {
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
            // Fallback
            const fallbackIconName = "other.svg";
            this.iconPath = {
                light: vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", fallbackIconName),
                dark: vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", fallbackIconName)
            };
        }
    }

    /**
     * Update tree item state
     */
    public updateState(newState: Partial<TreeItemState>): void {
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
     */
    public getUniqueId(): string {
        return (
            this.itemData?.key ||
            this.itemData?.base?.key ||
            this.itemData?.uniqueID ||
            this.itemData?.base?.uniqueID ||
            `fallback_${Date.now()}`
        );
    }

    /**
     * Get UID if available
     */
    public getUID(): string | undefined {
        return this.itemData?.base?.uniqueID || this.itemData?.uniqueID;
    }

    /**
     * Handle expansion state change
     */
    public handleExpansion(expanded: boolean): void {
        this.updateState({ isExpanded: expanded });
    }
}
