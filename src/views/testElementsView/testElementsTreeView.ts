/**
 * @file src/views/testEleemntsView/testElementsTreeView.ts
 * @description Provides a VS Code TreeDataProvider implementation to display test elements
 * retrieved from the TestBench server.
 */

import * as vscode from "vscode";
import { logger, testElementsTreeDataProvider, testElementTreeView } from "../../extension";
import { ConfigKeys, TreeItemContextValues } from "../../constants";
import { getExtensionConfiguration } from "../../configuration";
import { TestElementDataService } from "../../services/testElementDataService";
import { ResourceFileService } from "../../services/resourceFileService";
import { TestElementTreeBuilder } from "./testElementTreeBuilder";

export type TestElementType = "Subdivision" | "DataType" | "Interaction" | "Condition" | "Other";
export const fileContentOfRobotResourceSubdivisionFile = `*** Settings ***\nDocumentation    tb:uid:`;

/**
 * Interface representing a test element from the json response of the server.
 * @property id Unique identifier computed from the key properties.
 * @property parentId Identifier of the parent element (derived from the "parent" or, if missing, use the "libraryKey").
 * @property name Display name.
 * @property uniqueID The uniqueID string.
 * @property libraryKey Processed libraryKey (if originally an object, its serial is used).
 * @property jsonString Pretty-printed JSON representation.
 * @property details The original JSON object.
 * @property elementType The computed type of the element.
 * @property directRegexMatch Indicates whether this element directly passed the regex filter.
 * @property children An array of child test elements.
 * @property hierarchicalName The hierarchical name of the element (e.g., "Root/Child").
 * @property parent The parent element
 */
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

/**
 * Mapping from element types to icon file names. *
 */
const iconMapping: Record<string, { light: string; dark: string }> = {
    DataType: { light: "dataType-light.svg", dark: "dataType-dark.svg" },
    Interaction: { light: "testStep-light.svg", dark: "testStep-dark.svg" },
    Condition: { light: "condition-light.svg", dark: "condition-dark.svg" },
    Subdivision: { light: "missingSubdivision-light.svg", dark: "missingSubdivision-dark.svg" },
    MissingSubdivision: { light: "missingSubdivision-light.svg", dark: "missingSubdivision-dark.svg" },
    LocalSubdivision: { light: "localSubdivision-light.svg", dark: "localSubdivision-dark.svg" },
    Other: { light: "other-light.svg", dark: "other-dark.svg" }
};

/**
 * TestElementTreeItem represents a test element in the VS Code tree view.
 */
export class TestElementTreeItem extends vscode.TreeItem {
    public readonly testElementData: TestElementData;
    private readonly extensionContext: vscode.ExtensionContext;

    /**
     * Constructs a new TestElementTreeItem.
     * @param {TestElementData} elementData The test element.
     */
    constructor(elementData: TestElementData, extensionContext: vscode.ExtensionContext) {
        const label: string = elementData?.name || "Placeholder";
        const collapsibleState =
            elementData?.children && elementData.children.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;

        super(label, collapsibleState);
        this.testElementData = elementData || ({} as TestElementData);
        this.extensionContext = extensionContext;

        // Context value is used in package.json to enable context menu contributions.
        switch (elementData.elementType) {
            case "Subdivision":
                this.contextValue = TreeItemContextValues.SUBDIVISION;
                break;
            case "Interaction":
                this.contextValue = TreeItemContextValues.INTERACTION;
                break;
            case "DataType":
                this.contextValue = TreeItemContextValues.DATA_TYPE;
                break;
            case "Condition":
                this.contextValue = TreeItemContextValues.CONDITION;
                break;
            default:
                this.contextValue = TreeItemContextValues.TEST_ELEMENT;
                break;
        }

        const tooltipLines: string[] = [
            `Type: ${this.testElementData.elementType || "N/A"}`,
            `Name: ${elementData.name || label}`
        ];
        if (elementData.uniqueID) {
            tooltipLines.push(`UniqueID: ${this.testElementData.uniqueID}`);
        }
        if (elementData.libraryKey) {
            tooltipLines.push(`LibraryKey: ${elementData.libraryKey}`);
        }
        if (elementData.details?.hasVersion !== undefined) {
            tooltipLines.push(`Has Version: ${elementData.details.hasVersion}`);
        }
        if (elementData.details?.status !== undefined) {
            tooltipLines.push(`Status: ${elementData.details.status}`);
        }
        // Include raw JSON (Useful for debugging)
        // if (elementData.jsonString) { tooltipLines.push(`\nJSON Data:\n${elementData.jsonString}`); }

        this.tooltip = new vscode.MarkdownString(tooltipLines.join("\n"));

        // Display the uniqueID as a description next to the label.
        this.description = elementData.uniqueID || "";

        this.updateIcon();
    }

    private getIconUris(iconKey: TestElementType | "LocalSubdivision" | "MissingSubdivision"): {
        light: vscode.Uri;
        dark: vscode.Uri;
    } {
        const iconFileNames = iconMapping[iconKey] || iconMapping["Other"];
        return {
            light: vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", iconFileNames.light),
            dark: vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", iconFileNames.dark)
        };
    }

    /**
     * Updates the item's icon based on the provided key or its element type.
     * @param iconKey Optional specific key (e.g., "LocalSubdivision"). Uses elementType if not provided.
     */
    public updateIcon(iconKey?: TestElementType | "LocalSubdivision" | "MissingSubdivision"): void {
        const keyToUse = iconKey || this.testElementData.elementType;
        try {
            this.iconPath = this.getIconUris(keyToUse);
        } catch (e) {
            logger.error(`Error setting icon for key ${keyToUse} on item ${this.label}:`, e);
            // Fallback icon if URI construction fails for some reason
            const fallbackIcons = iconMapping["Other"];
            this.iconPath = {
                light: vscode.Uri.joinPath(
                    this.extensionContext.extensionUri,
                    "resources",
                    "icons",
                    fallbackIcons.light
                ),
                dark: vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", fallbackIcons.dark)
            };
        }
    }
}

/**
 * TestElementsTreeDataProvider implements the VS Code TreeDataProvider interface for test elements.
 */
export class TestElementsTreeDataProvider implements vscode.TreeDataProvider<TestElementTreeItem> {
    public _onDidChangeTreeDataEmitter: vscode.EventEmitter<TestElementTreeItem | undefined> = new vscode.EventEmitter<
        TestElementTreeItem | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<TestElementTreeItem | undefined> =
        this._onDidChangeTreeDataEmitter.event;
    private currentTreeData: TestElementData[] = [];

    private currentSelectedTovKey: string = "";
    public getCurrentTovKey(): string {
        return this.currentSelectedTovKey;
    }
    public setCurrentTovKey(tovKey: string): void {
        this.currentSelectedTovKey = tovKey;
    }

    // Flag to be able to set a proper tree view message
    public isDataFetchAttempted: boolean = false;

    private treeViewMessageUpdater: (message: string | undefined) => void;
    private readonly testElementDataService: TestElementDataService;
    private readonly resourceFileService: ResourceFileService;
    private readonly extensionContext: vscode.ExtensionContext;
    private readonly testElementTreeBuilder: TestElementTreeBuilder;

    constructor(
        updateTreeViewMessageCallback: (message: string | undefined) => void,
        testElementDataService: TestElementDataService,
        resourceFileService: ResourceFileService,
        extensionContext: vscode.ExtensionContext,
        testElementTreeBuilder: TestElementTreeBuilder
    ) {
        this.treeViewMessageUpdater = updateTreeViewMessageCallback;
        this.testElementDataService = testElementDataService;
        this.resourceFileService = resourceFileService;
        this.extensionContext = extensionContext;
        this.testElementTreeBuilder = testElementTreeBuilder;
    }

    public setTreeViewMessage(message: string | undefined): void {
        this.treeViewMessageUpdater(message);
    }

    public updateTreeViewStatusMessage(): void {
        if (this.isTreeDataEmpty()) {
            if (!this.isDataFetchAttempted) {
                this.setTreeViewMessage(
                    "Select a Test Object Version (TOV) from the 'Projects' view to load test elements."
                );
            } else {
                const filterPatterns: string[] = getExtensionConfiguration().get(
                    ConfigKeys.TB2ROBOT_RESOURCE_MARKER,
                    []
                );
                if (filterPatterns && filterPatterns.length > 0) {
                    this.setTreeViewMessage("No test elements match the current filter criteria.");
                } else {
                    this.setTreeViewMessage("No test elements found for the selected Test Object Version (TOV).");
                }
            }
        } else {
            this.setTreeViewMessage(undefined);
        }
    }

    /**
     * Checks if the current tree data is empty.
     * @returns {boolean} True if the tree data is empty; false otherwise.
     */
    public isTreeDataEmpty(): boolean {
        return !this.currentTreeData || this.currentTreeData.length === 0;
    }

    /**
     * Gets the TestElementTreeItem representation for the given TestElementData.
     * @param {TestElementTreeItem} item The TestElementTreeItem from getChildren.
     * @returns The same item.
     */
    getTreeItem(item: TestElementTreeItem): vscode.TreeItem {
        return item;
    }

    /**
     * Returns the children for a given test element.
     * @param {TestElementTreeItem} parentTestElement Optional parent TestElementTreeItem.
     * @returns {Thenable<TestElementTreeItem[]>} A promise resolving to an array of TestElementTreeItems.
     */
    async getChildren(parentTestElement?: TestElementTreeItem): Promise<TestElementTreeItem[]> {
        if (parentTestElement) {
            const childrenData: TestElementData[] = parentTestElement.testElementData.children || [];
            const childItems: TestElementTreeItem[] = await Promise.all(
                childrenData.map(async (childData: any) => {
                    const childItem = new TestElementTreeItem(childData, this.extensionContext);
                    await this.updateItemIconVisuals(childItem);
                    return childItem;
                })
            );
            return childItems;
        } else {
            if (this.isTreeDataEmpty()) {
                logger.trace(
                    "[getChildren] TestElementsTreeDataProvider: No tree data found for root, returning empty. Message should be set."
                );
                return [];
            }

            const rootTreeItems: TestElementTreeItem[] = await Promise.all(
                this.currentTreeData.map(async (rootData) => {
                    const rootTestElementItem = new TestElementTreeItem(rootData, this.extensionContext);
                    await this.updateItemIconVisuals(rootTestElementItem);
                    return rootTestElementItem;
                })
            );
            return rootTreeItems;
        }
    }

    /**
     * Refreshes the tree view with new data.
     * Handles message updates based on the presence of data.
     * @param {any} flatTestElementsJsonData A flat array of JSON objects representing test elements.
     */
    refresh(flatTestElementsJsonData: any[]): void {
        this.currentTreeData = this.testElementTreeBuilder.build(flatTestElementsJsonData);
        this.updateTreeViewStatusMessage();
        this._onDidChangeTreeDataEmitter.fire(undefined);
    }

    /**
     * Fetches test elements using a TOV key and updates the tree view.
     * @param {string} tovKey The TOV key.
     * @param {string} newTestElementsTreeViewTitle Optional new title for the tree view.
     * @returns {Promise<boolean>} A promise that resolves to true if test elements were fetched and displayed, false otherwise.
     */
    async fetchTestElements(tovKey: string, newTestElementsTreeViewTitle?: string): Promise<boolean> {
        // For testing with a local JSON file.
        // const jsonPath = "ABSOLUTE-PATH-TO-JSON-FILE";
        // const testElementsJsonData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

        this.isDataFetchAttempted = true;
        const tovLabel: string = newTestElementsTreeViewTitle || tovKey;
        this.treeViewMessageUpdater(`Loading test elements for TOV: ${tovLabel}...`);

        // Clear current data and trigger UI update to show loading message
        this.currentTreeData = [];
        this._onDidChangeTreeDataEmitter.fire(undefined);

        try {
            const testElementsJsonData = await this.testElementDataService.getTestElements(tovKey);

            if (testElementsJsonData) {
                this.currentSelectedTovKey = tovKey;
                this.refresh(testElementsJsonData);

                if (newTestElementsTreeViewTitle && vscode.window.activeTextEditor) {
                    logger.info(
                        `[TestElementsTreeDataProvider] Request to update title to: Test Elements (${newTestElementsTreeViewTitle}).`
                    );
                }
                return true;
            } else {
                this.handleFetchTestElementsFailure(tovLabel);
                return false;
            }
        } catch (error) {
            this.handleFetchTestElementsFailure(tovLabel, error);
            return false;
        }
    }

    private handleFetchTestElementsFailure(tovLabel: string, error?: any) {
        this.currentSelectedTovKey = "";
        const errorMessage = error instanceof Error ? error.message : "Unknown error during fetch";
        logger.error(`[fetchTestElements] Failed to fetch test elements for TOV "${tovLabel}": ${errorMessage}`, error);
        vscode.window.showErrorMessage(`Failed to fetch test elements for TOV "${tovLabel}".`);
        this.setTreeViewMessage(`Error fetching elements for TOV "${tovLabel}". Check logs or try again.`);
        this.currentTreeData = [];
        this._onDidChangeTreeDataEmitter.fire(undefined);
    }

    /**
     * Computes the hierarchical path for a given TestElementData.
     * This is a simplified version, assuming parent has its path.
     */
    private computePathForElement(
        elementData: TestElementData,
        knownElementsMap?: Map<string, TestElementData>
    ): string {
        if (elementData.hierarchicalName) {
            return elementData.hierarchicalName;
        }

        if (!elementData.parentId) {
            return elementData.name;
        }

        // Attempt to find parent in map if provided, otherwise uses direct .parent
        const parentElement = knownElementsMap?.get(elementData.parentId) || elementData.parent;

        if (parentElement) {
            const parentPath = this.computePathForElement(parentElement, knownElementsMap);
            return `${parentPath}/${elementData.name}`;
        }
        // Fallback if parent not found (should not happen in a well-formed tree)
        logger.warn(
            `[computePathForElement] Parent with ID ${elementData.parentId} not found for element ${elementData.name}.`
        );
        return elementData.name;
    }

    /**
     * Updates the icon of a TestElementTreeItem, typically a Subdivision,
     * based on whether its corresponding resource file/folder exists locally.
     */
    public async updateItemIconVisuals(item: TestElementTreeItem): Promise<void> {
        const elementData = item.testElementData;
        if (!elementData.hierarchicalName) {
            elementData.hierarchicalName = this.computePathForElement(elementData);
        }
        const absolutePath = await this.resourceFileService.constructAbsolutePath(elementData.hierarchicalName!);

        let iconKeyToUse: TestElementType | "LocalSubdivision" | "MissingSubdivision" = elementData.elementType;

        if (elementData.elementType === "Subdivision") {
            if (absolutePath) {
                const isFinal = isFinalSubdivisionInTree(elementData);
                let pathToCheck = removeRobotResourceFromPathString(absolutePath);
                if (isFinal) {
                    pathToCheck = appendResourceExtensionAndTrimPath(pathToCheck);
                }
                const exists = await this.resourceFileService.pathExists(pathToCheck);
                iconKeyToUse = exists ? "LocalSubdivision" : "MissingSubdivision";
            } else {
                iconKeyToUse = "MissingSubdivision";
                logger.warn(
                    `[updateItemIconVisuals] Cannot determine icon for Subdivision "${item.label}" due to missing absolute path.`
                );
            }
        }
        item.updateIcon(iconKeyToUse);
    }

    /**
     * Handles the "Go To Resource" command for a tree item.
     */
    public async handleGoToResourceCommand(item: TestElementTreeItem): Promise<void> {
        if (!item || !item.testElementData) {
            logger.trace("Invalid tree item or element in Go To Resource command.");
            return;
        }
        if (!item.testElementData.hierarchicalName) {
            item.testElementData.hierarchicalName = this.computePathForElement(item.testElementData);
            logger.trace(`Computed hierarchical name for GoToResource: ${item.testElementData.hierarchicalName}`);
        }

        const absolutePath = await this.resourceFileService.constructAbsolutePath(
            item.testElementData.hierarchicalName!
        );
        if (!absolutePath) {
            vscode.window.showErrorMessage(`Could not determine path for ${item.label}.`);
            return;
        }

        logger.trace(`Go To Resource: absolute path for ${item.label} is ${absolutePath}`);

        try {
            switch (item.testElementData.elementType) {
                case "Subdivision":
                    await this.handleSubdivisionFsLogic(item, absolutePath);
                    break;
                case "Interaction":
                    await this.handleInteractionFsLogic(item, absolutePath);
                    break;
                default:
                    logger.warn(
                        `Go To Resource: Element type ${item.testElementData.elementType} not handled for direct file creation/opening.`
                    );
                    vscode.window.showInformationMessage(
                        `No specific file action for type: ${item.testElementData.elementType}`
                    );
                    break;
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error in Go To Resource command: ${error.message}`);
            logger.error(`Go To Resource command failed for ${item.label}: ${error.message}`);
        }
    }

    private async handleSubdivisionFsLogic(
        subdivisionTreeItem: TestElementTreeItem,
        absolutePath: string
    ): Promise<void> {
        const processedPath = removeRobotResourceFromPathString(absolutePath);
        try {
            if (isFinalSubdivisionInTree(subdivisionTreeItem.testElementData)) {
                const resourcePath = appendResourceExtensionAndTrimPath(processedPath);
                const uniqueID = subdivisionTreeItem.testElementData.uniqueID;
                if (!uniqueID) {
                    logger.error(
                        `[handleSubdivisionFsLogic] Subdivision ${subdivisionTreeItem.label} has no uniqueID. Cannot create file content.`
                    );
                    vscode.window.showErrorMessage(
                        `Cannot create file for ${subdivisionTreeItem.label}: Missing Unique ID.`
                    );
                    return;
                }
                const initialContent = `${fileContentOfRobotResourceSubdivisionFile}${uniqueID}\n`;
                logger.debug(
                    `[handleSubdivisionFsLogic] For ${subdivisionTreeItem.label}, UniqueID: ${uniqueID}, InitialContent will be: "${initialContent.trim()}"`
                );
                await this.resourceFileService.ensureFileExists(resourcePath, initialContent);
                await this.resourceFileService.openFileInEditor(resourcePath);
            } else {
                await this.resourceFileService.ensureFolderPathExists(processedPath);
                await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(processedPath));
            }
            await this.updateItemIconVisuals(subdivisionTreeItem);
            this._onDidChangeTreeDataEmitter.fire(subdivisionTreeItem);
        } catch (error: any) {
            logger.error(`[handleSubdivisionFsLogic] Failed for ${subdivisionTreeItem.label}: ${error.message}`, error); //
            vscode.window.showErrorMessage(
                `Failed to handle subdivision ${subdivisionTreeItem.label}: ${error.message}`
            );
        }
    }

    private async handleInteractionFsLogic(
        interactionTreeItem: TestElementTreeItem,
        _interactionAbsolutePath: string
    ): Promise<void> {
        logger.trace(
            `[handleInteractionFsLogic] Processing interaction: ${interactionTreeItem.label} and absolute path: ${_interactionAbsolutePath}`
        );

        const interactionData = interactionTreeItem.testElementData;
        const robotResourceAncestor = getRobotResourceAncestor(interactionTreeItem, this.extensionContext);

        if (!robotResourceAncestor) {
            logger.warn(
                `Interaction '${interactionData.uniqueID}' has no Robot-Resource ancestor. Trying nearest Subdivision.`
            );
            const subdivisionAncestor = getSubdivisionAncestor(interactionTreeItem, this.extensionContext);
            if (subdivisionAncestor) {
                await this.handleGoToResourceCommand(subdivisionAncestor); // Treat as click on subdivision
                return;
            } else {
                vscode.window.showErrorMessage(
                    `Cannot determine resource file for interaction '${interactionData.name}'. No subdivision ancestor.`
                );
                logger.error(`No subdivision ancestor for interaction '${interactionData.name}'.`);
                return;
            }
        }

        if (!robotResourceAncestor.testElementData.hierarchicalName) {
            robotResourceAncestor.testElementData.hierarchicalName = this.computePathForElement(
                robotResourceAncestor.testElementData
            );
        }
        const ancestorAbsPath = await this.resourceFileService.constructAbsolutePath(
            robotResourceAncestor.testElementData.hierarchicalName!
        );
        if (!ancestorAbsPath) {
            vscode.window.showErrorMessage(`Could not determine path for resource: ${robotResourceAncestor.label}`);
            return;
        }

        let resourceFilePath = removeRobotResourceFromPathString(ancestorAbsPath);
        resourceFilePath = appendResourceExtensionAndTrimPath(resourceFilePath);

        try {
            const uniqueID = robotResourceAncestor.testElementData.uniqueID;
            if (!uniqueID) {
                logger.error(
                    `[handleInteractionFsLogic] Ancestor ${robotResourceAncestor.label} has no uniqueID. Cannot create file content.`
                );
                vscode.window.showErrorMessage(
                    `Cannot create file for ancestor ${robotResourceAncestor.label}: Missing Unique ID.`
                );
                return;
            }
            const initialContent = `${fileContentOfRobotResourceSubdivisionFile}${uniqueID}\n`;
            logger.debug(
                `[handleInteractionFsLogic] For ancestor ${robotResourceAncestor.label}, UniqueID: ${uniqueID}, InitialContent will be: "${initialContent.trim()}"`
            );
            await this.resourceFileService.ensureFileExists(resourceFilePath, initialContent);
            await this.resourceFileService.openFileInEditor(resourceFilePath);
            await this.updateItemIconVisuals(robotResourceAncestor);
            this._onDidChangeTreeDataEmitter.fire(robotResourceAncestor);
        } catch (error: any) {
            logger.error(`[handleInteractionFsLogic] Failed for ${interactionData.name}: ${error.message}`, error);
            vscode.window.showErrorMessage(
                `Failed to open/create resource for interaction '${interactionData.name}': ${error.message}`
            );
        }
    }

    // TODO: Implement this call after it is done in the backend.
    /**
     * Creates a new interaction under a subdivision.
     * @param {TestElementTreeItem} subdivisionTreeItem The subdivision tree item.
     * @param {string} interactionName The name of the new interaction.
     * @returns {Promise<TestElementData | null>} The created interaction data or null if failed.
     */
    public async createInteractionUnderSubdivision(
        subdivisionTreeItem: TestElementTreeItem,
        interactionName: string
    ): Promise<TestElementData | null> {
        if (subdivisionTreeItem.testElementData.elementType !== "Subdivision") {
            vscode.window.showErrorMessage("Can only create interactions under subdivisions.");
            return null;
        }
        if (!interactionName || interactionName.trim() === "") {
            vscode.window.showErrorMessage("Interaction name cannot be empty.");
            return null;
        }
        try {
            const newInteraction: any = {
                name: interactionName,
                elementType: "Interaction",
                uniqueID: `new-interaction-${Date.now()}`, // TODO: Test if this key generation is okay
                parent: {
                    serial: subdivisionTreeItem.testElementData.id.split("_")[0],
                    uniqueID: subdivisionTreeItem.testElementData.uniqueID
                },
                Interaction_key: {
                    serial: `new-interaction-key-${Date.now()}`
                }
            };
            if (!subdivisionTreeItem.testElementData.hierarchicalName) {
                subdivisionTreeItem.testElementData.hierarchicalName = this.computePathForElement(
                    subdivisionTreeItem.testElementData
                );
            }
            const interactionData: TestElementData = {
                id: this.testElementTreeBuilder.generateTestElementTreeItemId(
                    newInteraction,
                    "Interaction",
                    newInteraction.uniqueID
                ),
                parentId: subdivisionTreeItem.testElementData.id,
                name: interactionName,
                uniqueID: newInteraction.uniqueID,
                libraryKey: subdivisionTreeItem.testElementData.libraryKey,
                jsonString: JSON.stringify(newInteraction, null, 2),
                details: newInteraction,
                elementType: "Interaction",
                directRegexMatch: false, // New interactions are not regex matches by default
                children: [],
                parent: subdivisionTreeItem.testElementData,
                hierarchicalName: `${subdivisionTreeItem.testElementData.hierarchicalName}/${interactionName}`
            };
            if (!subdivisionTreeItem.testElementData.children) {
                subdivisionTreeItem.testElementData.children = [];
            }
            subdivisionTreeItem.testElementData.children.push(interactionData);
            this._onDidChangeTreeDataEmitter.fire(subdivisionTreeItem);
            return interactionData;
        } catch (error) {
            logger.error("[createInteractionUnderSubdivision] Error creating interaction tree item:", error);
            vscode.window.showErrorMessage("Failed to create interaction: " + (error as Error).message);
            return null;
        }
    }
}

/**
 * Hides the Test Elements tree view.
 */
export async function hideTestElementsTreeView(): Promise<void> {
    if (testElementTreeView) {
        await vscode.commands.executeCommand("testElementsView.removeView");
    } else {
        logger.warn("Test Elements view instance not found, 'removeView' command not executed.");
    }
}

/**
 * Displays the Test Elements tree view.
 */
export async function displayTestElementsTreeView(): Promise<void> {
    if (testElementTreeView) {
        await vscode.commands.executeCommand("testElementsView.focus");
    } else {
        logger.warn("Test Elements view instance not found, 'focus' command not executed.");
    }
}

/**
 * Normalizes a given base target path by making sure it ends with ".resource" and removing any
 * whitespace immediately preceding ".resource" as well as any trailing whitespace.
 *
 * @param {string} baseTargetPath - The input path string to normalize.
 * @returns {string} The normalized path string ending with ".resource" without extraneous whitespace.
 */
function appendResourceExtensionAndTrimPath(baseTargetPath: string): string {
    logger.trace(`Adding .resource extension and trimming the following path: ${baseTargetPath}`);
    let targetPath: string = baseTargetPath.endsWith(".resource") ? baseTargetPath : baseTargetPath + ".resource";

    // Remove any whitespace that appears immediately before ".resource" and trim trailing whitespace.
    targetPath = targetPath.replace(/\s+(\.resource)$/, "$1").replace(/\s+$/, "");

    // Remove any (one or more) whitespaces from the beginning of the string.
    targetPath = targetPath.replace(/^\s+/, "");

    logger.trace(`Normalized path after adding .resource and trimming : ${targetPath}`);
    return targetPath;
}

/**
 * Determines if a subdivision element is final (has no child subdivisions).
 * @param {TestElementData} element The test element to check.
 * @returns {boolean} True if the element is a final subdivision; false otherwise.
 */
export function isFinalSubdivisionInTree(element: TestElementData): boolean {
    if (element.elementType !== "Subdivision") {
        logger.trace(`[isFinalSubdivisionInTree] Element ${element.name} is not a subdivision.`);
        return false;
    }
    if (!element.children) {
        logger.trace(`[isFinalSubdivisionInTree] Element ${element.name} has no children and is final.`);
        return true;
    }
    const isFinalSubdivision: boolean = !element.children.some(
        (child: { elementType: string }) => child.elementType === "Subdivision"
    );

    if (isFinalSubdivision) {
        logger.trace(`[isFinalSubdivisionInTree] Test element ${element.name} is a final subdivision.`);
    } else {
        logger.trace(`[isFinalSubdivisionInTree] Test element ${element.name} is not a final subdivision.`);
    }

    return isFinalSubdivision;
}

/**
 * Traverses upward from an interaction element to find the nearest final subdivision.
 * @param {TestElementTreeItem} treeItem The test element tree item representing an interaction.
 * @returns {TestElementTreeItem | null} The nearest final subdivision ancestor, or null if not found.
 */
export function getFinalSubdivisionAncestor(
    treeItem: TestElementTreeItem,
    extensionContext: vscode.ExtensionContext
): TestElementTreeItem | null {
    const initialTestElementData: TestElementData = treeItem.testElementData;
    logger.trace(
        `[getFinalSubdivisionAncestor] Searching final subdivision ancestor for test element ${initialTestElementData.name}`
    );
    let currentAncestorData = initialTestElementData.parent;
    while (currentAncestorData) {
        if (currentAncestorData.elementType === "Subdivision" && isFinalSubdivisionInTree(currentAncestorData)) {
            logger.trace(
                `[getFinalSubdivisionAncestor] Found final subdivision ancestor for test element ${initialTestElementData.name}: ${currentAncestorData.name}`
            );
            return new TestElementTreeItem(currentAncestorData, extensionContext);
        }
        currentAncestorData = currentAncestorData.parent;
    }
    logger.trace(
        `[getFinalSubdivisionAncestor] No final subdivision ancestor found for test element ${initialTestElementData.name} with unique ID: ${initialTestElementData.uniqueID}`
    );
    return null;
}

/**
 * Checks if the given test element represents a robot resource subdivision
 * that directly matches a regular expression.
 *
 * @param {TestElementData} element The test element data to check.
 * @returns True if the element is a "Subdivision" type and has a direct regex match, false otherwise.
 */
function isRobotResourceSubdivision(element: TestElementData): boolean {
    if (element.elementType !== "Subdivision") {
        return false;
    }
    return element.directRegexMatch;
}

/**
 * Searches upwards from the given test element to find its nearest ancestor
 * that represents a "Robot-Resource" subdivision.
 *
 * @param {TestElementTreeItem} treeItem The starting `TestElementTreeItem` from which to begin the search.
 * @returns {TestElementTreeItem | null} The `TestElementTreeItem` representing the Robot-Resource subdivision ancestor if found,
 * otherwise `null`.
 */
export function getRobotResourceAncestor(
    treeItem: TestElementTreeItem,
    extensionContext: vscode.ExtensionContext
): TestElementTreeItem | null {
    const initialTestElementData = treeItem.testElementData;
    logger.trace(
        `[getRobotResourceAncestor] Searching Robot-Resource subdivision ancestor for test element ${initialTestElementData.name}`
    );
    let currentAncestorData = initialTestElementData.parent;
    while (currentAncestorData) {
        if (currentAncestorData.elementType === "Subdivision" && isRobotResourceSubdivision(currentAncestorData)) {
            logger.trace(
                `[getRobotResourceAncestor] Found Robot-Resource subdivision ancestor for test element ${initialTestElementData.name}: ${currentAncestorData.name}`
            );
            return new TestElementTreeItem(currentAncestorData, extensionContext);
        }
        currentAncestorData = currentAncestorData.parent;
    }
    logger.trace(
        `[getRobotResourceAncestor] No Robot-Resource subdivision ancestor found for test element ${initialTestElementData.name} with unique ID: ${initialTestElementData.uniqueID}`
    );
    return null;
}

/**
 * Traverses upward from an interaction element to find the nearest parent subdivision.
 * @param {TestElementTreeItem} treeItem The test element tree item representing an interaction.
 * @returns {TestElementTreeItem | null} The nearest subdivision ancestor, or null if not found.
 */
export function getSubdivisionAncestor(
    treeItem: TestElementTreeItem,
    extensionContext: vscode.ExtensionContext
): TestElementTreeItem | null {
    const initialTestElementData: TestElementData = treeItem.testElementData;
    logger.trace(
        `[getSubdivisionAncestor] Searching subdivision ancestor for test element ${initialTestElementData.name}`
    );
    let currentAncestorData: TestElementData | undefined = initialTestElementData.parent;
    while (currentAncestorData) {
        if (currentAncestorData.elementType === "Subdivision") {
            logger.trace(
                `[getSubdivisionAncestor] Found subdivision ancestor for test element ${initialTestElementData.name}: ${currentAncestorData.name}`
            );
            return new TestElementTreeItem(currentAncestorData, extensionContext);
        }
        currentAncestorData = currentAncestorData.parent;
    }
    logger.trace(
        `[getSubdivisionAncestor] No subdivision ancestor found for test element ${initialTestElementData.name} with unique ID: ${initialTestElementData.uniqueID}`
    );
    return null;
}

/**
 * Computes the hierarchical name of a test element by concatenating parent names.
 * @param {TestElementTreeItem} treeItem The test element tree item.
 * @returns {string} The hierarchical name (e.g., "Root/Child").
 */
export function computeHierarchicalName(
    treeItem: TestElementTreeItem,
    extensionContext: vscode.ExtensionContext
): string {
    const testElementData: TestElementData = treeItem.testElementData;
    if (testElementData.parent) {
        const parentTreeItem = new TestElementTreeItem(testElementData.parent, extensionContext);
        return `${computeHierarchicalName(parentTreeItem, extensionContext)}/${testElementData.name}`;
    }
    return testElementData.name;
}

/**
 * Removes all occurrences of "[Robot-Resource]" from a given path string.
 * @param {string} pathStr The original path string.
 * @returns {string} The cleaned path string.
 */
export function removeRobotResourceFromPathString(pathStr: string): string {
    const cleanedPath: string = pathStr.replace(/\[Robot-Resource\]/g, "");
    logger.trace(`[removeRobotResourceFromPathString] Removed [Robot-Resource] from path ${pathStr}: ${cleanedPath}`);
    return cleanedPath;
}

/**
 * Clears the test elements tree view by refreshing it with an empty array.
 */
export function clearTestElementsTreeView(): void {
    if (testElementsTreeDataProvider) {
        testElementsTreeDataProvider.setCurrentTovKey("");
        testElementsTreeDataProvider.isDataFetchAttempted = false;
        testElementsTreeDataProvider.refresh([]);
    }
}
