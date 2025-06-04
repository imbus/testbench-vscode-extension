/**
 * @file src/views/testElements/testElementTreeItem.ts
 * @description Test element tree item with proper inheritance
 */

import * as vscode from "vscode";
import { BaseTreeItem } from "../common/baseTreeItem";
import { TreeItemContextValues } from "../../constants";

export type TestElementType = "Subdivision" | "DataType" | "Interaction" | "Condition" | "Other";

export interface TestElementData {
    id: string;
    parentId: string | null;
    name: string;
    uniqueID: string;
    libraryKey: string | null;
    jsonString: string;
    details: any;
    elementType: TestElementType;
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
        parent: TestElementTreeItem | null = null
    ) {
        const label = testElementData?.name || "Placeholder";
        const collapsibleState =
            testElementData?.children && testElementData.children.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;

        super(label, testElementData.elementType, collapsibleState, testElementData, extensionContext, parent);

        this.testElementData = testElementData;

        // Set context value based on element type
        this.contextValue = this.getContextValueForElementType(testElementData.elementType);

        // Display the uniqueID as a description next to the label
        this.description = testElementData.uniqueID || "";
    }

    protected extractStatus(): string {
        return this.testElementData.details?.status || "None";
    }

    protected buildTooltipContent(): vscode.MarkdownString {
        const lines: string[] = [
            `Type: ${this.testElementData.elementType || "N/A"}`,
            `Name: ${this.testElementData.name || this.label}`
        ];

        if (this.testElementData.uniqueID) {
            lines.push(`UniqueID: ${this.testElementData.uniqueID}`);
        }

        if (this.testElementData.libraryKey) {
            lines.push(`LibraryKey: ${this.testElementData.libraryKey}`);
        }

        if (this.testElementData.details?.hasVersion !== undefined) {
            lines.push(`Has Version: ${this.testElementData.details.hasVersion}`);
        }

        if (this.testElementData.details?.status !== undefined) {
            lines.push(`Status: ${this.testElementData.details.status}`);
        }

        return new vscode.MarkdownString(lines.join("\n"));
    }

    protected getIconCategory(): string {
        return "testElement";
    }

    private getContextValueForElementType(elementType: TestElementType): string {
        switch (elementType) {
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
        if (this.testElementData.elementType === "Subdivision") {
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
        if (this.testElementData.elementType !== "Subdivision") {
            return false;
        }

        if (!this.testElementData.children) {
            return true;
        }

        return !this.testElementData.children.some((child) => child.elementType === "Subdivision");
    }

    /**
     * Find the nearest Robot Resource ancestor
     */
    public getRobotResourceAncestor(): TestElementTreeItem | null {
        let current = this.parent as TestElementTreeItem | null;

        while (current) {
            if (current.testElementData.elementType === "Subdivision" && current.testElementData.directRegexMatch) {
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
            if (current.testElementData.elementType === "Subdivision") {
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
            if (current.testElementData.elementType === "Subdivision" && current.isFinalSubdivision()) {
                return current;
            }
            current = current.parent as TestElementTreeItem | null;
        }

        return null;
    }
}

// Extend TreeItemState interface for test elements
declare module "../common/baseTreeItem" {
    interface TreeItemState {
        subdivisionIconType?: "LocalSubdivision" | "MissingSubdivision";
    }
}
