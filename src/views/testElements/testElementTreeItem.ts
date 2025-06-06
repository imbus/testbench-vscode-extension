/**
 * @file src/views/testElements/testElementTreeItem.ts
 * @description Test element tree item with proper inheritance
 */

import * as vscode from "vscode";
import { BaseTreeItem } from "../common/baseTreeItem";
import { TreeItemContextValues } from "../../constants";
import { IconContext, IconManagementService } from "../common/iconManagementService";
import { TestBenchLogger } from "../../testBenchLogger";

// Extend TreeItemState interface for test elements
declare module "../common/baseTreeItem" {
    interface TreeItemState {
        subdivisionIconType?: "LocalSubdivision" | "MissingSubdivision";
    }
}

export type TestElementType = "Subdivision" | "DataType" | "Interaction" | "Condition" | "Other";

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
    hierarchicalName?: string;
    parent?: TestElementData;
}

export class TestElementTreeItem extends BaseTreeItem {
    public readonly testElementData: TestElementData;

    constructor(
        testElementData: TestElementData,
        extensionContext: vscode.ExtensionContext,
        logger: TestBenchLogger,
        iconService: IconManagementService,
        parent: TestElementTreeItem | null = null
    ) {
        const label = testElementData?.name || "Placeholder";
        const collapsibleState =
            testElementData?.children && testElementData.children.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
        super(
            label,
            TestElementTreeItem.getContextValueForElementType(testElementData.testElementType),
            collapsibleState,
            testElementData,
            extensionContext,
            logger,
            iconService,
            parent
        );

        this.testElementData = testElementData;
        this.contextValue = TestElementTreeItem.getContextValueForElementType(testElementData.testElementType);

        // Display the uniqueID as a description next to the label
        this.description = testElementData.uniqueID || "";
    }

    /**
     * Override icon update to handle test element specific logic
     */
    public updateIcon(): void {
        // testElementData might not be initialized yet during constructor
        if (!this.testElementData) {
            this.logger.warn(
                `[TestElementTreeItem] Skipping icon update - testElementData not initialized yet for: ${this.label}`
            );
            super.updateIcon(); // Fall back to base implementation
            return;
        }

        this.logger.trace(
            `[TestElementTreeItem] Updating icon for test element: ${this.label}, type: ${this.testElementData.testElementType}`
        );

        try {
            const contextValue = this.getIconContextValue();
            const status = String(this.state.status || "default");

            const iconContext: IconContext = {
                contextValue: contextValue,
                status: status,
                isMarked: this.state.isMarked,
                isCustomRoot: this.state.isCustomRoot,
                originalContextValue: this.originalContextValue
            };

            this.iconPath = this.iconService.getIconUris(iconContext, "testElement");

            this.logger.trace(`[TestElementTreeItem] Icon path set successfully for ${this.label}:`, this.iconPath);
        } catch (error) {
            this.logger.error(`Error updating icon for test element ${this.label}:`, error);
            this.setFallbackIcon();
        }
    }

    /**
     * Get the correct context value for icon lookup
     */
    private getIconContextValue(): string {
        if (!this.testElementData) {
            return "Other";
        }

        if (this.testElementData.testElementType === "Subdivision") {
            return this.state.subdivisionIconType || "MissingSubdivision";
        }

        return this.testElementData.testElementType;
    }

    protected extractStatus(): string {
        const data = this.itemData as TestElementData;
        return data.details?.status || "None";
    }

    protected buildTooltipContent(): vscode.MarkdownString {
        const data = this.itemData as TestElementData;
        const lines: string[] = [`Type: ${data.testElementType || "N/A"}`, `Name: ${data.name || this.label}`];

        if (data.uniqueID) {
            lines.push(`UniqueID: ${data.uniqueID}`);
        }

        if (data.libraryKey) {
            lines.push(`LibraryKey: ${data.libraryKey}`);
        }

        if (data.details) {
            if (data?.details?.hasVersion !== undefined) {
                lines.push(`Has Version: ${data?.details?.hasVersion}`);
            }
            if (data?.details?.status !== undefined) {
                lines.push(`Status: ${data?.details?.status}`);
            }
        } else {
            lines.push("Details: Not available");
        }

        return new vscode.MarkdownString(lines.join("\n"));
    }

    protected getIconCategory(): string {
        return "testElement";
    }

    private static getContextValueForElementType(testElementType: TestElementType): string {
        switch (testElementType) {
            case "Subdivision":
                return TreeItemContextValues.SUBDIVISION;
            case "Interaction":
                return TreeItemContextValues.INTERACTION;
            case "DataType":
                return TreeItemContextValues.DATA_TYPE;
            case "Condition":
                return TreeItemContextValues.CONDITION;
            default:
                return TreeItemContextValues.TEST_ELEMENT;
        }
    }

    /**
     * Update icon for subdivision based on file existence
     */
    public updateSubdivisionIcon(iconType: "LocalSubdivision" | "MissingSubdivision"): void {
        if (this.testElementData.testElementType === "Subdivision") {
            this.updateState({ subdivisionIconType: iconType });
        }
    }

    /**
     * Get hierarchical name, computing it if not available
     */
    public getHierarchicalName(): string {
        if (this.testElementData.hierarchicalName) {
            return this.testElementData.hierarchicalName;
        }

        // Compute hierarchical name from parent chain
        const pathSegments: string[] = [this.testElementData.name];
        let currentParent = this.parent as TestElementTreeItem | null;

        while (currentParent) {
            pathSegments.unshift(currentParent.testElementData.name);
            currentParent = currentParent.parent as TestElementTreeItem | null;
        }

        this.testElementData.hierarchicalName = pathSegments.join("/");
        return this.testElementData.hierarchicalName;
    }

    /**
     * Check if this is a final subdivision (has no subdivision children)
     */
    public isFinalSubdivision(): boolean {
        if (this.testElementData.testElementType !== "Subdivision") {
            return false;
        }

        if (!this.testElementData.children) {
            return true;
        }

        return !this.testElementData.children.some((child) => child.testElementType === "Subdivision");
    }

    /**
     * Find the nearest Robot Resource ancestor
     */
    public getRobotResourceAncestor(): TestElementTreeItem | null {
        let current = this.parent as TestElementTreeItem | null;

        while (current) {
            if (current.testElementData.testElementType === "Subdivision" && current.testElementData.directRegexMatch) {
                return current;
            }
            current = current.parent as TestElementTreeItem | null;
        }

        return null;
    }

    /**
     * Find the nearest subdivision ancestor
     */
    public getSubdivisionAncestor(): TestElementTreeItem | null {
        let current = this.parent as TestElementTreeItem | null;

        while (current) {
            if (current.testElementData.testElementType === "Subdivision") {
                return current;
            }
            current = current.parent as TestElementTreeItem | null;
        }

        return null;
    }

    /**
     * Find the nearest final subdivision ancestor
     */
    public getFinalSubdivisionAncestor(): TestElementTreeItem | null {
        let current = this.parent as TestElementTreeItem | null;

        while (current) {
            if (current.testElementData.testElementType === "Subdivision" && current.isFinalSubdivision()) {
                return current;
            }
            current = current.parent as TestElementTreeItem | null;
        }

        return null;
    }
}
