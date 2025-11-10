/**
 * @file src/treeViews/implementations/testThemes/TestThemesTreeItem.ts
 * @description Tree item implementation for test themes and test cases.
 */

import * as vscode from "vscode";
import { TreeItemBase } from "../../core/TreeItemBase";
import { logger, treeViews, userSessionManager } from "../../../extension";
import { TestThemeItemTypes, allExtensionCommands } from "../../../constants";
import { MarkingInfo } from "../../state/StateTypes";
import { RobotFileService } from "./RobotFileService";

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
    private robotFileService: RobotFileService;
    private robotFileExists: boolean = false;
    private robotFilePath?: string;
    private folderExists: boolean = false;
    private folderPath?: string;
    public isFilteredOutInDiffMode = false;

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
        this.robotFileService = new RobotFileService(this.logger);
        this.tooltip = this.generateTooltip();
        this.description = data.base.uniqueID;
        this.updateContextValue();

        if (data.elementType === TestThemeItemTypes.TEST_CASE_SET) {
            this.command = {
                command: allExtensionCommands.checkForTestCaseSetDoubleClick,
                title: "Open Robot File",
                arguments: [this]
            };
        }

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
        // (e.g. a test theme tree view opened from a cycle vs TOV)
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
        const userId = userSessionManager.getCurrentUserId();

        return `${userId}:${contextType}:${projectKey}:${contextKey}`;
    }

    /**
     * Determines the initial collapsible state based on item type and children
     * @param data The test theme data containing type and children information
     * @return TreeItemCollapsibleState indicating if item should be collapsed, expanded, or none
     */
    private static getInitialCollapsibleState(data: TestThemeData): vscode.TreeItemCollapsibleState {
        switch (data.elementType) {
            case "TestThemeNode":
                return data.hasChildren
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
            case "TestCaseSetNode":
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

        if (this.robotFileExists && this.data.elementType === TestThemeItemTypes.TEST_CASE_SET) {
            contextValue = `${contextValue}.hasRobotFile`;
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
     * Checks if a robot file exists locally for this test case set tree item.
     * @returns Promise that resolves to true if the robot file exists
     */
    public async checkRobotFileExists(): Promise<boolean> {
        if (!this.canHaveRobotFile()) {
            return false;
        }

        try {
            const fileInfo = await this.robotFileService.checkRobotFileExists(this);
            this.robotFileExists = fileInfo.exists;
            this.robotFilePath = fileInfo.filePath;

            return fileInfo.exists;
        } catch (error) {
            this.logger.error(
                `[TestThemesTreeItem] Error checking robot file existence for ${this.data.base.name}:`,
                error
            );
            return false;
        }
    }

    /**
     * Gets the robot file path if it exists
     * @returns The robot file path or undefined if it doesn't exist
     */
    public getRobotFilePath(): string | undefined {
        return this.robotFilePath;
    }

    /**
     * Checks if this item has a generated robot file
     * @returns True if the robot file exists locally
     */
    public hasGeneratedRobotFile(): boolean {
        return this.robotFileExists;
    }

    /**
     * Checks if a folder exists locally for this test theme tree item.
     * @returns Promise that resolves to true if the folder exists
     */
    public async checkFolderExists(): Promise<boolean> {
        if (this.data.elementType !== TestThemeItemTypes.TEST_THEME) {
            return false;
        }

        try {
            const folderInfo = await this.robotFileService.checkFolderExists(this);
            this.folderExists = folderInfo.exists;
            this.folderPath = folderInfo.folderPath;

            return folderInfo.exists;
        } catch (error) {
            this.logger.error(
                `[TestThemesTreeItem] Error checking folder existence for ${this.data.base.name}:`,
                error
            );
            return false;
        }
    }

    /**
     * Gets the folder path if it exists
     * @returns The folder path or undefined if it doesn't exist
     */
    public getFolderPath(): string | undefined {
        return this.folderPath;
    }

    /**
     * Checks if this item has a generated folder
     * @returns True if the folder exists locally
     */
    public hasGeneratedFolder(): boolean {
        return this.folderExists;
    }

    /**
     * Opens the generated robot file in VS Code editor
     * @returns Promise that resolves when the file is opened
     */
    public async openGeneratedRobotFile(): Promise<void> {
        if (!this.canHaveRobotFile()) {
            this.logger.debug(
                `[TestThemesTreeItem] Cannot open robot file: Item type ${this.data.elementType} cannot have a robot file`
            );
            return;
        }

        if (!this.robotFilePath) {
            this.logger.debug(
                `[TestThemesTreeItem] Cannot open robot file: No robot file path available for ${this.data.base.name}`
            );
            return;
        }

        await this.robotFileService.openRobotFileInVSCodeEditor(this.robotFilePath, this);
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
        const baseSerialized = super.serialize();
        return {
            ...baseSerialized,
            data: this.data
        };
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
     * Checks if the item can have a robot file.
     * Test case sets can have robot files, test themes represent folders.
     * @return True if the item type can have a robot file
     */
    public canHaveRobotFile(): boolean {
        return this.data.elementType === TestThemeItemTypes.TEST_CASE_SET;
    }

    /**
     * Checks if the item can be marked based on file/folder existence.
     * Test case sets are marked if their robot file exists.
     * Test themes are marked if their folder exists.
     * @return True if the item type can be marked
     */
    public canBeMarked(): boolean {
        return (
            this.data.elementType === TestThemeItemTypes.TEST_CASE_SET ||
            this.data.elementType === TestThemeItemTypes.TEST_THEME
        );
    }

    /**
     * Checks if this item has generated content (robot file for test case sets, folder for test themes).
     * @returns True if the item has generated content locally
     */
    public hasGeneratedContent(): boolean {
        if (this.data.elementType === TestThemeItemTypes.TEST_CASE_SET) {
            return this.robotFileExists;
        } else if (this.data.elementType === TestThemeItemTypes.TEST_THEME) {
            return this.folderExists;
        }
        return false;
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

    /**
     * Gets the language server parameters (project and TOV names) for this tree item
     * @returns The project and TOV names, or undefined if they cannot be determined
     */
    public getLanguageServerParameters(): { projectName: string; tovName: string } | undefined {
        // Try to get project and TOV names from parent hierarchy first
        const projectName = this.getProjectNameFromHierarchy();
        const tovName = this.getTovNameFromHierarchy();

        if (projectName && tovName) {
            return { projectName, tovName };
        }

        if (!treeViews) {
            this.logger.error(
                "[TestThemesTreeItem] Tree views are not initialized, cannot get language server parameters."
            );
            return undefined;
        }

        const globalProjectName = treeViews.testThemesTree.getCurrentProjectName();
        const globalTovName = treeViews.testThemesTree.getCurrentTovName();
        if (!globalProjectName || !globalTovName) {
            return undefined;
        }
        return { projectName: globalProjectName, tovName: globalTovName };
    }

    /**
     * Gets the project name by traversing up the parent hierarchy
     * @returns The project name or undefined if not found
     */
    private getProjectNameFromHierarchy(): string | undefined {
        let currentParent = this.parent;

        while (currentParent) {
            if (currentParent instanceof TestThemesTreeItem) {
                const parentData = currentParent.data;
                if (parentData.elementType === "ProjectNode") {
                    return parentData.base.name || this.getLabelAsString(currentParent.label);
                }
            }
            currentParent = currentParent.parent;
        }

        return undefined;
    }

    /**
     * Gets the TOV name by traversing up the parent hierarchy
     * @returns The TOV name or undefined if not found
     */
    private getTovNameFromHierarchy(): string | undefined {
        let currentParent = this.parent;

        while (currentParent) {
            if (currentParent instanceof TestThemesTreeItem) {
                const parentData = currentParent.data;
                if (parentData.elementType === "TOVNode") {
                    return parentData.base.name || this.getLabelAsString(currentParent.label);
                }
            }
            currentParent = currentParent.parent;
        }

        return undefined;
    }

    /**
     * Converts a TreeItemLabel to a string
     * @param label The label to convert
     * @returns The string representation of the label
     */
    private getLabelAsString(label: string | vscode.TreeItemLabel | undefined): string | undefined {
        if (typeof label === "string") {
            return label;
        }
        if (label && typeof label === "object" && "label" in label) {
            return label.label;
        }
        return undefined;
    }
}
