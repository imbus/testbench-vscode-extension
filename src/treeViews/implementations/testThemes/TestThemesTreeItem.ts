/**
 * @file src/treeViews/implementations/testThemes/TestThemesTreeItem.ts
 * @description Tree item implementation for test themes and test cases.
 */

import * as vscode from "vscode";
import { TreeItemBase } from "../../core/TreeItemBase";
import { logger } from "../../../extension";
import { TestThemeItemTypes } from "../../../constants";
import { MarkingInfo } from "../../state/StateTypes";

export type TestThemeType =
    | "TestThemeNode"
    | "TestCaseSetNode"
    | "TestCaseNode"
    | `MarkedForImport.${string}`
    | `MarkedForGeneration.${string}`
    | `customRoot.${string}`
    | `openedFromCycle.${string}`;

export interface TestThemeData {
    type: TestThemeType;
    base: {
        key: string;
        numbering: string;
        parentKey: string;
        name: string;
        uniqueID: string;
        matchesFilter: boolean;
    };
    spec: {
        key: string;
        locker: string | null;
        status: string;
    };
    aut: {
        key: string;
        locker: string | null;
        status: string;
    };
    exec?: {
        status?: string;
        execStatus?: string;
        verdict?: string;
        key?: string;
        locker?: string | null;
    } | null;
    filters: any[];
    elementType: string;
    hasChildren: boolean;
    projectKey?: string;
    cycleKey?: string;
    isGenerated?: boolean;
    isImported?: boolean;
    level?: number;
    label?: string;
    description?: string;
    elementKey?: string;
}

export class TestThemesTreeItem extends TreeItemBase {
    public readonly data: TestThemeData;
    protected currentCycleKey?: string;
    protected currentProjectKey?: string;
    protected logger = logger;
    protected rootItems?: TestThemesTreeItem[];
    protected dataProvider: any;

    constructor(data: TestThemeData, extensionContext: vscode.ExtensionContext, parent?: TestThemesTreeItem) {
        super(
            data.base.name,
            data.base.numbering,
            data.elementType,
            TestThemesTreeItem.getInitialCollapsibleState(data),
            extensionContext,
            parent
        );

        this.data = data;

        this.tooltip = this.generateTooltip();
        this.description = data.base.uniqueID;
        this.updateContextValue();

        (this as any).id = this.generateUniqueId();
    }

    /**
     * Updates the ID when context changes (e.g., when openedFromCycle metadata is set)
     */
    public updateId(): void {
        (this as any).id = this.generateUniqueId();
    }

    /**
     * Generates a unique identifier for the tree item.
     * @return Unique identifier string combining context, type, parent path, and key
     */
    public generateUniqueId(): string {
        let parentPath = "";
        if (this.parent && this.parent instanceof TestThemesTreeItem) {
            try {
                parentPath = this.parent.generateUniqueId() || "";
            } catch {
                // If parent ID access fails, use empty string to avoid infinite recursion
                parentPath = "";
            }
        }

        // Include context information to make IDs unique across different contexts
        // (e.g. a test theme tree view opened from a  cycle vs TOV)
        const contextInfo = this.getContextIdentifier();

        return `${contextInfo}:${this.data.elementType}:${parentPath}:${this.data.base.key}`;
    }

    /**
     * Generates a context identifier that includes project, cycle/TOV, and context type
     * @return Context identifier string
     */
    private getContextIdentifier(): string {
        const projectKey = this.data.projectKey || "unknown-project";
        const contextKey = this.data.cycleKey || "unknown-context";
        const isOpenedFromCycle = this.getMetadata("openedFromCycle") === true;
        const contextType = isOpenedFromCycle ? "cycle" : "tov";

        return `${contextType}:${projectKey}:${contextKey}`;
    }

    /**
     * Determines the initial collapsible state based on item type and children
     * @param data The test theme data containing type and children information
     * @return TreeItemCollapsibleState indicating if item should be collapsed, expanded, or none
     */
    private static getInitialCollapsibleState(data: TestThemeData): vscode.TreeItemCollapsibleState {
        switch (data.elementType) {
            case "TestThemeNode":
            case "TestCaseSetNode":
                return data.hasChildren
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
            case "TestCaseNode":
                return vscode.TreeItemCollapsibleState.None;
            default:
                return vscode.TreeItemCollapsibleState.None;
        }
    }

    /**
     * Builds the context value string for the tree item based on its state and metadata.
     * @return Context value string with appropriate prefixes for custom root, marking, and cycle context
     */
    private getContextValue(): string {
        let contextValue = this.originalContextValue;

        if (this.getMetadata("isCustomRoot") === true) {
            contextValue = `customRoot.${contextValue}`;
        }

        const markingInfo = this.getMetadata("markingInfo") as MarkingInfo | undefined;
        if (markingInfo) {
            if (markingInfo.type === "import") {
                contextValue = `MarkedForImport.${contextValue}`;
            } else if (markingInfo.type === "generation") {
                contextValue = `MarkedForGeneration.${contextValue}`;
            }
        }

        if (this.getMetadata("openedFromCycle")) {
            contextValue = `openedFromCycle.${contextValue}`;
        }

        return contextValue;
    }

    /**
     * Generates a detailed tooltip for the tree item
     * @return Formatted tooltip string containing item information and status details
     */
    private generateTooltip(): string {
        const tooltipContextLines: string[] = [];
        if (this.data.base.numbering && this.data.base.numbering.trim() !== "") {
            tooltipContextLines.push(`Numbering: ${this.data.base.numbering}`);
        }

        tooltipContextLines.push(`Type: ${this.data.elementType}`);
        if (this.data.base.name && this.data.base.name.trim() !== "") {
            tooltipContextLines.push(`Name: ${this.data.base.name}`);
        }

        const status = this.data.isGenerated ? "Generated" : this.data.isImported ? "Imported" : "Not Generated";
        tooltipContextLines.push(`Status: ${status}`);

        if (this.data.exec) {
            if (this.data.exec.status) {
                tooltipContextLines.push(`Execution Status: ${this.data.exec.status}`);
            }
            if (this.data.exec.verdict) {
                tooltipContextLines.push(`Verdict: ${this.data.exec.verdict}`);
            }
        }

        if (this.data.spec.status) {
            tooltipContextLines.push(`Specification Status: ${this.data.spec.status}`);
        }

        if (this.data.aut.status) {
            tooltipContextLines.push(`Automation Status: ${this.data.aut.status}`);
        }

        if (this.data.base.uniqueID) {
            tooltipContextLines.push(`ID: ${this.data.base.uniqueID}`);
        }

        return tooltipContextLines.join("\n");
    }

    /**
     * Updates the context value of the tree item by recalculating it from its current state.
     */
    public updateContextValue(): void {
        this.contextValue = this.getContextValue();
    }

    /**
     * Creates a deep copy of the tree item
     * @return A new TestThemesTreeItem instance with copied data and state
     */
    public clone(): TestThemesTreeItem {
        const cloned = new TestThemesTreeItem(this.data, this.extensionContext, this.parent as TestThemesTreeItem);
        cloned._metadata = new Map(this._metadata);
        return cloned;
    }

    /**
     * Serializes the tree item to a plain object
     * @return Object containing all serializable item data
     */
    public serialize(): any {
        return {
            data: this.data,
            id: this.generateUniqueId(),
            label: this.label,
            description: this.description,
            tooltip: this.tooltip instanceof vscode.MarkdownString ? this.tooltip.value : this.tooltip,
            contextValue: this.contextValue,
            collapsibleState: this.collapsibleState,
            metadata: Array.from(this._metadata.entries())
        };
    }

    /**
     * Deserializes data into a tree item instance
     * @param data The serialized data to deserialize
     * @param extensionContext The VS Code extension context
     * @param createInstance Function to create the instance
     * @return The deserialized tree item instance
     */
    public static deserialize<T extends TreeItemBase = TestThemesTreeItem>(
        data: any,
        extensionContext: vscode.ExtensionContext,
        createInstance: (data: any) => T
    ): T {
        const instance = createInstance(data);
        return instance;
    }

    /**
     * Creates a deserializer function for tree items
     * @param parent Optional parent tree item
     * @param extensionContext The VS Code extension context
     * @return Function that can deserialize tree item data
     */
    public static createDeserializer(parent?: TestThemesTreeItem, extensionContext?: vscode.ExtensionContext) {
        return (data: any) => {
            if (!extensionContext) {
                throw new Error("Extension context is required for deserialization");
            }
            return new TestThemesTreeItem(data.data, extensionContext, parent);
        };
    }

    /**
     * Deserializes a tree item with parent context
     * @param serialized The serialized tree item data
     * @param extensionContext The VS Code extension context
     * @param parent Optional parent tree item
     * @return The deserialized tree item instance
     */
    public static deserializeWithParent(
        serialized: any,
        extensionContext: vscode.ExtensionContext,
        parent?: TestThemesTreeItem
    ): TestThemesTreeItem {
        return this.deserialize(serialized, extensionContext, this.createDeserializer(parent, extensionContext));
    }

    /**
     * Updates the status of the tree item
     * @param status Object containing optional isGenerated and isImported flags
     */
    public updateStatus(status: { isGenerated?: boolean; isImported?: boolean }): void {
        if (status.isGenerated !== undefined) {
            this.data.isGenerated = status.isGenerated;
        }
        if (status.isImported !== undefined) {
            this.data.isImported = status.isImported;
        }
        this.tooltip = this.generateTooltip();
    }

    /**
     * Checks if the item can generate tests
     * @return True if the item type allows test generation
     */
    public canGenerateTests(): boolean {
        return (
            this.data.elementType === TestThemeItemTypes.TEST_THEME ||
            this.data.elementType === TestThemeItemTypes.TEST_CASE_SET
        );
    }

    /**
     * Checks if the item can be imported
     * @return True if the item type allows import and the tree view was opened from a cycle
     */
    public canImport(): boolean {
        const openedFromCycle = this.getMetadata("openedFromCycle");
        if (!openedFromCycle) {
            return false;
        }

        return (
            this.data.elementType === TestThemeItemTypes.TEST_THEME ||
            this.data.elementType === TestThemeItemTypes.TEST_CASE_SET
        );
    }

    /**
     * Collects all descendant UIDs recursively
     * @return Array of unique IDs from all descendants
     */
    public getDescendantUIDs(): string[] {
        const uids: string[] = [];
        const collectUIDs = (item: TestThemesTreeItem) => {
            if (item.data.base.uniqueID) {
                uids.push(item.data.base.uniqueID);
            }
            if (item.children) {
                for (const child of item.children as TestThemesTreeItem[]) {
                    collectUIDs(child);
                }
            }
        };
        collectUIDs(this);
        return uids;
    }

    /**
     * Gets children for a given tree item
     * @param item The tree item to get children for
     * @return Promise resolving to array of child tree items
     */
    protected async getChildrenForItem(item: TestThemesTreeItem): Promise<TestThemesTreeItem[]> {
        if (!item) {
            return this.rootItems || [];
        }
        return item.children as TestThemesTreeItem[];
    }

    /**
     * Fetches root items for the tree
     * @return Promise resolving to array of root tree items
     */
    protected async fetchRootItems(): Promise<TestThemesTreeItem[]> {
        return this.rootItems || [];
    }
}
