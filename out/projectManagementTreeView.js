"use strict";
/**
 * @file projectManagementTreeView.ts
 * @description Provides the data provider and view management for the project management tree and test theme tree.
 * Project management tree displays the selected project and its test object versions and cycles.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseTestBenchTreeItem = exports.ProjectManagementTreeDataProvider = void 0;
exports.findProjectKeyOfCycleElement = findProjectKeyOfCycleElement;
exports.findCycleKeyOfTreeElement = findCycleKeyOfTreeElement;
exports.setupProjectTreeViewEventListeners = setupProjectTreeViewEventListeners;
exports.hideProjectManagementTreeView = hideProjectManagementTreeView;
exports.displayProjectManagementTreeView = displayProjectManagementTreeView;
exports.findProjectKeyForElement = findProjectKeyForElement;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const server_1 = require("./server");
const extension_1 = require("./extension");
const constants_1 = require("./constants");
const testThemeTreeView_1 = require("./testThemeTreeView");
const testElementsTreeView_1 = require("./testElementsTreeView");
/**
 * Provides data for the project management tree view.
 * This tree view displays the selected project, its test object versions, and cycles.
 * When a test cycle element is clicked, its children (test themes and test case sets) are offloaded to the test theme tree view.
 */
class ProjectManagementTreeDataProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    _onDidPrepareCycleDataForThemeTree = new vscode.EventEmitter();
    onDidPrepareCycleDataForThemeTree = this._onDidPrepareCycleDataForThemeTree.event;
    // Callback for message updates
    updateMessageCallback;
    testThemeTreeDataProvider;
    // Variables to temporarily set a custom root item in the tree view.
    customRootKey = null;
    customRootJsonData = null;
    customRootItemInstance = null;
    originalCustomRootContextValue = null;
    // Store keys of expanded tree nodes to restore expansion state of collapsible elements after a refresh.
    expandedTreeItems = new Set();
    /**
     * Constructs a new ProjectManagementTreeDataProvider.
     * @param {function} updateMessageCallback Callback to update the message in the tree view.
     * @param {TestThemeTreeDataProvider} testThemeTreeDataProviderInstance Instance of the TestThemeTreeDataProvider.
     */
    constructor(updateMessageCallback, testThemeTreeDataProviderInstance) {
        this.updateMessageCallback = updateMessageCallback;
        this.testThemeTreeDataProvider = testThemeTreeDataProviderInstance;
        vscode.commands.executeCommand("setContext", constants_1.ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false);
        extension_1.logger.trace("ProjectManagementTreeDataProvider initialized.");
    }
    /**
     * Refreshes the tree view.
     * If isHardRefresh is true, it resets the custom root item.
     * @param {boolean} isHardRefresh Optional flag to force a hard refresh.
     */
    refresh(isHardRefresh = false) {
        extension_1.logger.debug(`Refreshing project management tree view. Hard refresh: ${isHardRefresh}`);
        if (isHardRefresh && this.customRootKey !== null) {
            this.resetCustomRootInternally();
        }
        if (!extension_1.connection) {
            this.updateMessageCallback("Not connected to TestBench. Please log in.");
        }
        else if (this.customRootKey && this.customRootJsonData) {
            this.updateMessageCallback(undefined);
        }
        else {
            this.updateMessageCallback("Loading projects...");
        }
        this._onDidChangeTreeData.fire(undefined);
        extension_1.logger.trace("Project management tree view refresh triggered.");
    }
    /**
     * Returns the parent of a given tree item.
     *
     * @param {BaseTestBenchTreeItem} element The tree item.
     * @returns {BaseTestBenchTreeItem | null} The parent tree item or null.
     */
    getParent(element) {
        if (this.customRootItemInstance && element.parent === this.customRootItemInstance) {
            return this.customRootItemInstance;
        }
        if (this.customRootItemInstance && element === this.customRootItemInstance) {
            return null;
        }
        return element.parent;
    }
    /**
     * Fetches the raw json data for a specific test cycle from the server.
     *
     * @param {BaseTestBenchTreeItem} cycleElement The tree item representing the cycle.
     * @returns {Promise<CycleStructure | null>} A promise that resolves to a `CycleStructure` object or `null` if an error occurs.
     */
    async getCycleJSONData(cycleElement) {
        const cycleElementLabel = typeof cycleElement.label === "string" ? cycleElement.label : "N/A";
        extension_1.logger.trace("Fetching raw cycle data for element:", cycleElementLabel);
        if (cycleElement.contextValue !== constants_1.TreeItemContextValues.CYCLE) {
            extension_1.logger.warn(`getRawCycleData called on non-Cycle item: ${cycleElementLabel}`);
            return null;
        }
        const cycleKey = cycleElement.item?.key;
        if (!cycleKey) {
            extension_1.logger.error("Cycle key is missing from the provided cycleElement item data.");
            return null;
        }
        const projectKey = this.getProjectKeyForTreeItem(cycleElement);
        if (!projectKey) {
            extension_1.logger.warn("Project key of cycle not found (getRawCycleData).");
            return null;
        }
        if (!extension_1.connection) {
            extension_1.logger.warn("No connection available (getRawCycleData).");
            return null;
        }
        const cycleData = await extension_1.connection.fetchCycleStructureOfCycleInProject(projectKey, cycleKey);
        if (!cycleData) {
            extension_1.logger.trace("No cycle structure data returned from server (getRawCycleData).");
            return null;
        }
        if (!cycleData.nodes || !cycleData.root?.base?.key) {
            extension_1.logger.error(`Fetched cycle structure for ${cycleElementLabel} is missing nodes or root key.`);
            return null;
        }
        return cycleData;
    }
    /**
     * Gets the project key for a given tree node, considering the custom root state.
     * @param {BaseTestBenchTreeItem} treeItem The tree item.
     * @returns The project key string or null.
     */
    getProjectKeyForTreeItem(treeItem) {
        extension_1.logger.trace(`Provider: Getting project key for node: ${treeItem.label}`);
        let currentTreeItem = treeItem;
        while (currentTreeItem) {
            const isTheCustomRoot = this.customRootItemInstance === currentTreeItem;
            const originalContext = isTheCustomRoot
                ? this.originalCustomRootContextValue
                : currentTreeItem.contextValue;
            if (originalContext === constants_1.TreeItemContextValues.PROJECT) {
                extension_1.logger.trace(`Provider: Found project key '${currentTreeItem.item.key}' for node '${treeItem.label}' via item '${currentTreeItem.label}'`);
                return currentTreeItem.item.key;
            }
            currentTreeItem = currentTreeItem.parent;
        }
        extension_1.logger.warn(`Provider: Project key not found for node '${treeItem.label}' by traversing up.`);
        return null;
    }
    /**
     * Gets the TOV (Version) key for a given tree node.
     * @param {BaseTestBenchTreeItem} treeItem The tree item.
     * @returns The TOV key string or null.
     */
    getTovKeyForNode(treeItem) {
        extension_1.logger.trace(`Provider: Getting TOV key for node: ${treeItem.label}`);
        let currentTreeItem = treeItem;
        while (currentTreeItem) {
            const isTheCustomRoot = this.customRootItemInstance === currentTreeItem;
            const originalContext = isTheCustomRoot
                ? this.originalCustomRootContextValue
                : currentTreeItem.contextValue;
            if (originalContext === constants_1.TreeItemContextValues.VERSION) {
                extension_1.logger.trace(`Provider: Found TOV key '${currentTreeItem.item.key}' for node '${treeItem.label}' via item '${currentTreeItem.label}'`);
                return currentTreeItem.item.key;
            }
            if (originalContext === constants_1.TreeItemContextValues.PROJECT) {
                break;
            }
            currentTreeItem = currentTreeItem.parent;
        }
        extension_1.logger.trace(`Provider: TOV key not found for node '${treeItem.label}' by traversing up to a TOV.`);
        return null;
    }
    /**
     * Determines the project name and TOV name for a given tree item, considering custom root.
     * @param {BaseTestBenchTreeItem} selectedTreeItem The BaseTestBenchTreeItem.
     * @returns An object with projectName and tovName.
     */
    getProjectAndTovNamesForItem(selectedTreeItem) {
        let projectName;
        let tovName;
        let currentTreeItem = selectedTreeItem;
        while (currentTreeItem) {
            const isTheCustomRoot = this.customRootItemInstance === currentTreeItem;
            const originalContext = isTheCustomRoot
                ? this.originalCustomRootContextValue
                : currentTreeItem.contextValue;
            if (originalContext === constants_1.TreeItemContextValues.PROJECT) {
                projectName = currentTreeItem.item.name;
            }
            else if (originalContext === constants_1.TreeItemContextValues.VERSION) {
                tovName = currentTreeItem.item.name;
            }
            if (projectName && tovName) {
                break;
            }
            currentTreeItem = currentTreeItem.parent;
        }
        if (tovName && !projectName && selectedTreeItem.parent) {
            const parentItem = selectedTreeItem.parent;
            const parentIsCustomProjectRoot = this.customRootItemInstance === parentItem &&
                this.originalCustomRootContextValue === constants_1.TreeItemContextValues.PROJECT;
            if (parentItem.contextValue === constants_1.TreeItemContextValues.PROJECT || parentIsCustomProjectRoot) {
                projectName = parentItem.item.name;
            }
        }
        extension_1.logger.trace(`Provider.getProjectAndTovNamesForItem called for '${selectedTreeItem.label}': Project='${projectName}', TOV='${tovName}'`);
        return { projectName, tovName };
    }
    /**
     * Creates a TestbenchTreeItem from raw JSON data.
     * Handles expansion state restoration for collapsible items.
     *
     * @param {any} jsonData The raw JSON data.
     * @param {string} contextValue An explicit context value if jsonData.nodeType is not reliable.
     * @param {BaseTestBenchTreeItem | null} parent The parent tree item.
     * @returns {BaseTestBenchTreeItem | null} A new TestbenchTreeItem or null.
     */
    createTreeItem(jsonData, contextValue, parent) {
        if (!jsonData) {
            extension_1.logger.warn("Attempted to create tree item with invalid jsonData (null or undefined).");
            return null;
        }
        const itemData = jsonData;
        let defaultCollapsibleState;
        if (!itemData || typeof itemData.key === "undefined" || typeof itemData.name === "undefined") {
            extension_1.logger.warn(`Attempted to create project/version/cycle tree item with invalid data structure for context ${contextValue}:`, jsonData);
            return null;
        }
        const itemKey = itemData.key;
        const itemName = itemData.name;
        const label = itemName;
        if (itemKey === undefined || itemName === undefined) {
            extension_1.logger.warn(`Attempted to create tree item with missing key or name. Context: ${contextValue}, Key: ${itemKey}, Name: ${itemName}`, jsonData);
            return null;
        }
        // Determine default collapsible state based on type and potential children
        switch (contextValue) {
            case constants_1.TreeItemContextValues.PROJECT: {
                const projectData = itemData;
                const hasProjectChildren = (projectData.tovsCount && projectData.tovsCount > 0) ||
                    (projectData.cyclesCount && projectData.cyclesCount > 0);
                defaultCollapsibleState = hasProjectChildren
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
                break;
            }
            case constants_1.TreeItemContextValues.VERSION: {
                const versionData = itemData;
                defaultCollapsibleState =
                    versionData.children && versionData.children.length > 0
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None;
                break;
            }
            case constants_1.TreeItemContextValues.CYCLE:
                // Cycles in this tree are not directly expandable to show themes
                defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
                break;
            default:
                extension_1.logger.warn(`Unexpected contextValue '${contextValue}' in ProjectManagementTreeDataProvider.createTreeItem`);
                defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
        }
        const treeItem = new BaseTestBenchTreeItem(label, contextValue, defaultCollapsibleState, itemData, parent);
        // Restore Expansion State
        const itemKeyForExpansion = treeItem.item?.key;
        if (itemKeyForExpansion &&
            this.expandedTreeItems.has(itemKeyForExpansion) &&
            treeItem.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            extension_1.logger.trace(`Restoring expanded state for item: ${treeItem.label} (Key: ${itemKeyForExpansion})`);
        }
        return treeItem;
    }
    /**
     * Fetches and returns the children (Test Object Versions) for a given Project element.
     * @param {BaseTestBenchTreeItem} projectElement The parent Project element.
     * @returns {Promise<BaseTestBenchTreeItem[]>}
     * @private
     */
    async getChildrenForProject(projectElement) {
        extension_1.logger.debug(`Fetching children (TOVs) for project: ${projectElement.label}`);
        const projectKey = projectElement.item.key;
        if (!projectKey) {
            extension_1.logger.error(`Project key is missing for project item: ${projectElement.label}`);
            return [];
        }
        const projectTree = await extension_1.connection.getProjectTreeOfProject(projectKey);
        if (projectTree && projectTree.children && projectTree.children.length > 0) {
            return projectTree.children
                .map((tovNode // tovNode is testBenchTypes.TreeNode
            ) => this.createTreeItem(tovNode, tovNode.nodeType, projectElement) // tovNode.nodeType should be "Version"
            )
                .filter((item) => item !== null);
        }
        extension_1.logger.debug(`No children (TOVs) found for project: ${projectElement.label}`);
        return [];
    }
    /**
     * Returns the children (Cycles) for a given Version (TOV) element.
     * These are typically pre-loaded as part of the Version's data.
     * @param {BaseTestBenchTreeItem} versionElement The parent Version element.
     * @returns {BaseTestBenchTreeItem[]}
     * @private
     */
    getChildrenForVersion(versionElement) {
        extension_1.logger.debug(`Fetching children (Cycles) for TOV: ${versionElement.label}`);
        // element.item is testBenchTypes.TreeNode representing a TOV
        // Its children array contains the Cycle nodes.
        const cycleNodes = versionElement.item.children ?? [];
        return cycleNodes
            .map((cycleNode // cycleNode is a testBenchTypes.TreeNode
        ) => this.createTreeItem(cycleNode, cycleNode.nodeType, versionElement) // cycleNode.nodeType should be "Cycle"
        )
            .filter((item) => item !== null);
    }
    /**
     * Fetches and returns the root projects for the tree view.
     * This is called when no custom root is set and the tree should display all projects.
     * @private
     */
    async getRootProjects() {
        extension_1.logger.debug("Fetching all projects for the root of Project Management Tree.");
        const projectList = await extension_1.connection.getProjectsList();
        if (projectList && projectList.length > 0) {
            this.updateMessageCallback(undefined);
            return projectList
                .map((project) => this.createTreeItem(project, constants_1.TreeItemContextValues.PROJECT, null))
                .filter((item) => item !== null);
        }
        else if (projectList) {
            extension_1.logger.debug("No projects found on the server.");
            this.updateMessageCallback("No projects found on the server. Create a project in TestBench or check permissions.");
            return [];
        }
        else {
            extension_1.logger.error("Failed to fetch project list from the server.");
            this.updateMessageCallback("Error fetching projects. Please check connection or try refreshing.");
            vscode.window.showErrorMessage("Failed to fetch project list from TestBench. Check logs for details.");
            return [];
        }
    }
    /**
     * Handles the expansion of a Cycle element.
     * For the project management tree, cycles do not directly show children here.
     * The actual children (test themes, etc.) are intended for the TestThemeTree.
     * This method could be simplified or removed if cycle expansion in this tree
     * should not trigger data loading for another tree directly.
     * @param {BaseTestBenchTreeItem} cycleElement The Cycle element.
     * @returns {Promise<BaseTestBenchTreeItem[]>}
     * @private
     */
    async handleCycleExpansion(cycleElement) {
        extension_1.logger.trace(`Cycle node ${typeof cycleElement.label === "string" ? cycleElement.label : "N/A"} expanded in Project Tree.`);
        return [];
    }
    /**
     * Gets the children of a given tree item.
     * If no element is provided, it returns the root project.
     * Called when the tree view is first loaded or refreshed.
     *
     * @param {BaseTestBenchTreeItem} treeElement Optional parent tree item.
     * @returns {Promise<BaseTestBenchTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    async getChildren(treeElement) {
        if (!extension_1.connection) {
            this.updateMessageCallback("Not connected to TestBench. Please log in.");
            return [];
        }
        try {
            if (!treeElement) {
                // Requesting root level items
                if (this.customRootItemInstance) {
                    if (this.customRootItemInstance.collapsibleState === vscode.TreeItemCollapsibleState.None) {
                        const originalContext = this.originalCustomRootContextValue;
                        if (originalContext === constants_1.TreeItemContextValues.PROJECT ||
                            originalContext === constants_1.TreeItemContextValues.VERSION) {
                            this.customRootItemInstance.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                        }
                    }
                    else {
                        this.customRootItemInstance.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                    }
                    return [this.customRootItemInstance];
                }
                return await this.getRootProjects();
            }
            if (this.customRootItemInstance && treeElement.item.key === this.customRootItemInstance.item.key) {
                extension_1.logger.debug(`Fetching children for custom root item: ${treeElement.label} (Original type: ${this.originalCustomRootContextValue})`);
                if (this.originalCustomRootContextValue === constants_1.TreeItemContextValues.PROJECT) {
                    return await this.getChildrenForProject(treeElement);
                }
                else if (this.originalCustomRootContextValue === constants_1.TreeItemContextValues.VERSION) {
                    return this.getChildrenForVersion(treeElement);
                }
                else if (this.originalCustomRootContextValue === constants_1.TreeItemContextValues.CYCLE) {
                    return [];
                }
                extension_1.logger.warn(`Custom root item ${treeElement.label} is of unhandled original type: ${this.originalCustomRootContextValue}`);
                return [];
            }
            if (treeElement.contextValue === constants_1.TreeItemContextValues.PROJECT) {
                return await this.getChildrenForProject(treeElement);
            }
            if (treeElement.contextValue === constants_1.TreeItemContextValues.VERSION) {
                return this.getChildrenForVersion(treeElement);
            }
            // Cycles do not show children directly in this tree
            if (treeElement.contextValue === constants_1.TreeItemContextValues.CYCLE) {
                return await this.handleCycleExpansion(treeElement);
            }
            // Fallback for unexpected element types or elements with pre-loaded children.
            if (treeElement.children) {
                extension_1.logger.warn(`Returning pre-loaded children for element: ${treeElement.label}.`);
                return treeElement.children;
            }
        }
        catch (error) {
            extension_1.logger.error(`Error in getChildren for element ${treeElement?.label || "root"}:`, error);
            vscode.window.showErrorMessage(`Error fetching tree data: ${error instanceof Error ? error.message : "Unknown error"}`);
            this.updateMessageCallback("An error occurred while loading tree items.");
            return [];
        }
        extension_1.logger.warn(`getChildren reached end without returning for element: ${treeElement?.label}`);
        return [];
    }
    /**
     * Adds the key of an expanded element to the set used for state preservation.
     * Called by the tree view's onDidExpandElement listener.
     * @param {BaseTestBenchTreeItem} element The element that was expanded.
     */
    rememberExpandedItem(element) {
        if (element && element.item && element.item.key) {
            this.expandedTreeItems.add(element.item.key);
            extension_1.logger.trace(`Remembered expanded item: ${element.label} (Key: ${element.item.key})`);
        }
    }
    /**
     * Removes the key of a collapsed element from the set used for state preservation.
     * Called by the tree view's onDidCollapseElement listener.
     * @param {BaseTestBenchTreeItem} element The element that was collapsed.
     */
    forgetExpandedItem(element) {
        if (element && element.item && element.item.key) {
            this.expandedTreeItems.delete(element.item.key);
            extension_1.logger.trace(`Forgot expanded item: ${element.label} (Key: ${element.item.key})`);
        }
    }
    /**
     * Predicate function to determine if a raw cycle node should be visible in the Test Theme tree.
     * @param {CycleNodeData} nodeData The raw data for a node from the cycle structure.
     * @returns {boolean} True if the node should be visible, false otherwise.
     * @private
     */
    isCycleNodeVisibleInTestThemeTree(nodeData) {
        // Exclude test cases from the Test Theme tree view
        if (nodeData.elementType === constants_1.TreeItemContextValues.TEST_CASE_NODE) {
            return false;
        }
        // Filter out non-executable elements and elements that are locked by the system
        if (nodeData.exec?.status === "NotPlanned" || nodeData.exec?.locker === "-2") {
            return false;
        }
        return true;
    }
    /**
     * Fetches the sub-elements of a cycle element and builds the test theme tree.
     *
     * @param {BaseTestBenchTreeItem} cycleElement The cycle tree item.
     * @returns {Promise<BaseTestBenchTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    async getChildrenOfCycle(cycleElement) {
        const cycleElementLabel = typeof cycleElement.label === "string" ? cycleElement.label : "N/A";
        extension_1.logger.trace("Fetching children of cycle element:", cycleElementLabel);
        if (cycleElement.contextValue !== constants_1.TreeItemContextValues.CYCLE) {
            extension_1.logger.warn(`getChildrenOfCycle called on non-Cycle item: ${cycleElementLabel}`);
            return [];
        }
        const cycleKey = cycleElement.item?.key;
        if (!cycleKey) {
            extension_1.logger.error("Cycle key is missing from the provided cycleElement item data.");
            return [];
        }
        const projectKey = findProjectKeyOfCycleElement(cycleElement);
        if (!projectKey) {
            extension_1.logger.warn("Project key of cycle not found (getChildrenOfCycle).");
            return [];
        }
        if (!extension_1.connection) {
            extension_1.logger.warn("No connection available (getChildrenOfCycle).");
            return [];
        }
        const cycleData = await extension_1.connection.fetchCycleStructureOfCycleInProject(projectKey, cycleKey);
        if (!cycleData || !cycleData.nodes?.length) {
            extension_1.logger.trace("Cycle has no sub-elements (getChildrenOfCycle).");
            return [];
        }
        if (!cycleData.nodes || !cycleData.nodes?.length || !cycleData.root?.base?.key) {
            extension_1.logger.error(`Cycle structure for ${cycleElementLabel} has no nodes or root key. Displaying placeholder.`);
            return [];
        }
        const elementsByKey = new Map();
        cycleData.nodes.forEach((data) => {
            const cycleNode = data;
            if (cycleNode?.base?.key) {
                elementsByKey.set(cycleNode.base.key, cycleNode);
            }
            else {
                extension_1.logger.warn("Found node without base.key in cycle structure:", cycleNode);
            }
        });
        if (elementsByKey.size === 0 && cycleData.nodes.length > 0) {
            extension_1.logger.error(`No nodes with base.key were found in the cycle structure data, cannot build tree.`);
            return [];
        }
        const buildTestThemeTreeRecursive = (parentItemKey, parentTreeItem) => {
            const potentialChildrenData = Array.from(elementsByKey.values()).filter((node) => node?.base?.parentKey === parentItemKey && this.isCycleNodeVisibleInTestThemeTree(node));
            const childTreeItems = potentialChildrenData.map((nodeData) => {
                // Determine if this nodeData itself will have children in the theme tree
                const hasVisibleChildren = Array.from(elementsByKey.values()).some((childNodeCandidate) => childNodeCandidate?.base?.parentKey === nodeData.base.key &&
                    this.isCycleNodeVisibleInTestThemeTree(childNodeCandidate));
                const treeItem = this.createTreeItem(nodeData, nodeData.elementType, parentTreeItem);
                if (!treeItem) {
                    return null;
                }
                treeItem.item = nodeData;
                if (nodeData.elementType === constants_1.TreeItemContextValues.TEST_CASE_SET_NODE) {
                    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
                }
                else {
                    treeItem.collapsibleState = hasVisibleChildren
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None;
                }
                if (hasVisibleChildren) {
                    treeItem.children = buildTestThemeTreeRecursive(nodeData.base.key, treeItem);
                }
                else {
                    treeItem.children = [];
                }
                return treeItem;
            });
            return childTreeItems.filter((item) => item !== null);
        };
        const rootCycleKey = cycleData.root.base.key;
        const childrenOfCycleToReturn = buildTestThemeTreeRecursive(rootCycleKey, cycleElement);
        return childrenOfCycleToReturn;
    }
    /**
     * Returns a TreeItem representation for the given element.
     *
     * @param {BaseTestBenchTreeItem} element The tree item.
     * @returns {vscode.TreeItem} The tree item.
     */
    getTreeItem(element) {
        return element;
    }
    /**
     * Sets the selected tree item as the root and refreshes the tree.
     *
     * @param {BaseTestBenchTreeItem} treeItem The tree item to set as root.
     */
    makeRoot(treeItem) {
        extension_1.logger.debug("Setting selected element as a temporary root:", treeItem.label);
        if (treeItem && treeItem.item && treeItem.item.key && treeItem.contextValue) {
            if (this.customRootItemInstance &&
                this.customRootItemInstance !== treeItem &&
                this.originalCustomRootContextValue) {
                this.customRootItemInstance.contextValue = this.originalCustomRootContextValue;
            }
            this.customRootKey = treeItem.item.key;
            this.customRootJsonData = { ...treeItem.item };
            this.customRootItemInstance = treeItem;
            this.originalCustomRootContextValue = treeItem.contextValue;
            treeItem.contextValue = constants_1.TreeItemContextValues.CUSTOM_ROOT_PROJECT;
            if (this.originalCustomRootContextValue === constants_1.TreeItemContextValues.PROJECT ||
                this.originalCustomRootContextValue === constants_1.TreeItemContextValues.VERSION) {
                treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            }
            else {
                treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
            }
            treeItem.parent = null;
            vscode.commands.executeCommand("setContext", constants_1.ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, true);
            extension_1.logger.debug(`Item "${typeof treeItem.label === "string" ? treeItem.label : treeItem.item.name}" (Key: ${this.customRootKey}) is now set as custom root.`);
        }
        else {
            this.resetCustomRootInternally();
            extension_1.logger.debug("Custom root cleared due to invalid item for makeRoot.");
        }
        this._onDidChangeTreeData.fire(undefined);
    }
    /**
     * Resets the custom root configuration internally.
     * Clears any custom root settings, restores the original context
     * if applicable, and updates the UI to reflect that no custom root is active.
     * It also clears the record of expanded tree items and updates any associated messages.
     */
    resetCustomRootInternally() {
        const oldCustomRootInstance = this.customRootItemInstance;
        if (oldCustomRootInstance && this.originalCustomRootContextValue) {
            oldCustomRootInstance.contextValue = this.originalCustomRootContextValue;
        }
        this.customRootKey = null;
        this.customRootJsonData = null;
        this.customRootItemInstance = null;
        this.originalCustomRootContextValue = null;
        this.expandedTreeItems.clear();
        vscode.commands.executeCommand("setContext", constants_1.ContextKeys.PROJECT_TREE_HAS_CUSTOM_ROOT, false);
        this.updateMessageCallback(undefined);
    }
    /**
     * Resets the custom root, restoring the tree to display all projects.
     */
    resetCustomRoot() {
        extension_1.logger.debug("Resetting custom root for Project Management Tree.");
        if (this.customRootKey !== null) {
            this.resetCustomRootInternally();
            this._onDidChangeTreeData.fire(undefined);
            const itemThatWasRoot = this.customRootItemInstance;
            if (itemThatWasRoot) {
                this._onDidChangeTreeData.fire(itemThatWasRoot);
            }
            extension_1.logger.info("Project Management Tree custom root has been reset.");
        }
        else {
            extension_1.logger.trace("No custom root was active in Project Management Tree to reset.");
        }
    }
    /**
     * Handles expansion and collapse of a tree item.
     *
     * @param {BaseTestBenchTreeItem} element The tree item.
     * @param {boolean} expanded True if the item is expanded, false otherwise.
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
     */
    async handleExpansion(element, expanded) {
        extension_1.logger.trace(`Setting expansion state of ${element.label} to ${expanded ? "expanded" : "collapsed"}.`);
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();
        if (expanded) {
            this.expandedTreeItems.add(element.item.key);
        }
        else {
            this.expandedTreeItems.delete(element.item.key);
        }
    }
    /**
     * Handles a click on a test cycle element.
     * Prepares data for the Test Theme tree and fires an event,
     * and handles Test Elements tree population.
     *
     * @param {BaseTestBenchTreeItem} projectsTreeViewItem The clicked tree item in the projects tree view.
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
     */
    async handleTestCycleClick(projectsTreeViewItem) {
        const currentCycleLabel = typeof projectsTreeViewItem.label === "string" ? projectsTreeViewItem.label : "N/A";
        extension_1.logger.trace("Handling tree item click for:", currentCycleLabel);
        if (projectsTreeViewItem.contextValue !== constants_1.TreeItemContextValues.CYCLE) {
            extension_1.logger.error("Clicked tree item is not a cycle. Cannot proceed.");
            return;
        }
        const cycleKey = projectsTreeViewItem.item.key;
        if (!cycleKey) {
            extension_1.logger.error("Cycle key is missing from clicked item. Cannot proceed.");
            return;
        }
        const projectKey = this.getProjectKeyForTreeItem(projectsTreeViewItem);
        if (!projectKey) {
            extension_1.logger.error(`Project key could not be determined for cycle: ${projectsTreeViewItem.label}. Item parent: ${projectsTreeViewItem.parent?.label}, Custom root: ${this.customRootItemInstance?.label}`);
            vscode.window.showErrorMessage(`Could not determine project context for cycle '${projectsTreeViewItem.label}'.`);
            return;
        }
        const currentThemeTreeView = (0, extension_1.getTestThemeTreeViewInstance)();
        const currentElementTreeView = (0, extension_1.getTestElementTreeView)();
        const currentElementsProvider = (0, extension_1.getTestElementsTreeDataProvider)();
        if (currentThemeTreeView && this.testThemeTreeDataProvider) {
            this.testThemeTreeDataProvider.setTreeViewStatusMessage(`Loading test themes for cycle: ${currentCycleLabel}...`);
        }
        if (currentElementTreeView && currentElementsProvider) {
            const tovParent = projectsTreeViewItem.parent;
            const tovLabel = tovParent && typeof tovParent.label === "string" ? tovParent.label : "selected TOV";
            currentElementsProvider.setTreViewMessage(`Loading test elements for ${tovLabel}...`);
            currentElementsProvider.refresh([]);
        }
        // Hide the project management tree view and show the test theme tree and test elements tree views
        // BEFORE fetching data for responsiveness
        await hideProjectManagementTreeView();
        await (0, testThemeTreeView_1.displayTestThemeTreeView)();
        if ((0, extension_1.getTestElementsTreeDataProvider)()) {
            await (0, testElementsTreeView_1.displayTestElementsTreeView)();
        }
        const tovKeyOfSelectedCycleElement = this.getTovKeyForNode(projectsTreeViewItem);
        const tovLabel = tovKeyOfSelectedCycleElement
            ? projectsTreeViewItem.parent?.item.name
            : undefined;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Fetching data for cycle: ${currentCycleLabel}`,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: "Fetching test themes..." });
            const rawCycleData = await this.getCycleJSONData(projectsTreeViewItem);
            progress.report({ increment: 40, message: "Preparing views..." });
            this._onDidPrepareCycleDataForThemeTree.fire({
                projectKey: projectKey,
                cycleKey: cycleKey,
                cycleLabel: currentCycleLabel,
                rawCycleStructure: rawCycleData
            });
            progress.report({ increment: 60, message: "Fetching test elements..." });
            if (currentElementsProvider) {
                if (tovKeyOfSelectedCycleElement) {
                    extension_1.logger.trace(`Clicked cycle's parent TOV key: ${tovKeyOfSelectedCycleElement}. Fetching test elements.`);
                    const areTestElementsFetched = await currentElementsProvider.fetchTestElements(tovKeyOfSelectedCycleElement, tovLabel);
                    if (!areTestElementsFetched) {
                        currentElementsProvider.refresh([]);
                    }
                }
                else {
                    extension_1.logger.warn("Parent TOV key not found for the clicked cycle. Clearing test elements.");
                    currentElementsProvider.refresh([]);
                }
            }
            else {
                extension_1.logger.error("TestElementsTreeDataProvider is not available for fetching elements.");
            }
            progress.report({ increment: 100, message: "Data loaded." });
        });
    }
    /**
     * Clears the project management tree.
     */
    clearTree() {
        extension_1.logger.trace("Clearing project management tree.");
        this.resetCustomRootInternally();
        if (!extension_1.connection) {
            this.updateMessageCallback("Not connected to TestBench. Please log in.");
        }
        else {
            this.updateMessageCallback("Project data cleared. Refresh or select a project.");
        }
        this._onDidChangeTreeData.fire(undefined);
    }
}
exports.ProjectManagementTreeDataProvider = ProjectManagementTreeDataProvider;
/**
 * Finds the project key (serial) for a given cycle element by traversing upward in the tree hierarchy.
 *
 * @param {BaseTestBenchTreeItem} element The cycle tree item.
 * @returns {string | null} The project key as a string if found; otherwise null.
 */
function findProjectKeyOfCycleElement(element) {
    extension_1.logger.trace("Finding project key for cycle element:", element.label);
    if (element.contextValue !== constants_1.TreeItemContextValues.CYCLE &&
        element.contextValue !== constants_1.TreeItemContextValues.TEST_THEME_NODE &&
        element.contextValue !== constants_1.TreeItemContextValues.TEST_CASE_SET_NODE) {
        extension_1.logger.error(`Element ${element.label} is not a cycle or descendant; cannot find project key.`);
    }
    let current = element;
    while (current) {
        const pmProvider = (0, extension_1.getProjectManagementTreeDataProvider)();
        const isCustomProjectRoot = pmProvider?.customRootItemInstance === current &&
            pmProvider?.originalCustomRootContextValue === constants_1.TreeItemContextValues.PROJECT;
        if (current.contextValue === constants_1.TreeItemContextValues.PROJECT || isCustomProjectRoot) {
            extension_1.logger.trace(`Found project key for cycle element: ${current.item.key} (Item: ${current.label})`);
            return current.item.key;
        }
        current = current.parent;
    }
    const projectKeyNotFoundErrorMessage = `Project key not found for cycle element: ${element.label}`;
    extension_1.logger.error(projectKeyNotFoundErrorMessage);
    return null;
}
/**
 * Finds the cycle key (serial) for a given tree element by traversing upward in the tree hierarchy.
 *
 * @param {BaseTestBenchTreeItem} element The tree item.
 * @returns {string | null} The cycle key as a string if found; otherwise null.
 */
function findCycleKeyOfTreeElement(element) {
    extension_1.logger.trace("Finding cycle key for tree element:", element.label);
    let current = element;
    while (current) {
        if (current.contextValue === "Cycle") {
            extension_1.logger.trace("Found cycle key:", current.item.key);
            return current.item.key;
        }
        current = current.parent;
    }
    const cycleKeyNotFoundErrorMessage = `Cycle key not found in tree element: ${element.label}`;
    extension_1.logger.error(cycleKeyNotFoundErrorMessage);
    vscode.window.showErrorMessage(cycleKeyNotFoundErrorMessage);
    return null;
}
/**
 * Represents a tree item (Project, TOV, Cycle, TestThemeNode, TestCaseSetNode, etc.) in the tree view.
 */
class BaseTestBenchTreeItem extends vscode.TreeItem {
    item;
    parent;
    children;
    statusOfTreeItem;
    originalContextValue;
    /**
     * Constructs a new TestbenchTreeItem.
     *
     * @param {string} label The label to display.
     * @param {string} contextValue The type of the tree item.
     * @param {vscode.TreeItemCollapsibleState} collapsibleState The initial collapsible state.
     * @param {any} item The original data of the tree item.
     * @param {BaseTestBenchTreeItem | null} parent The parent tree item.
     */
    constructor(label, contextValue, collapsibleState, item, parent = null) {
        super(label, collapsibleState);
        this.item = item;
        this.contextValue = contextValue;
        this.originalContextValue = contextValue;
        this.parent = parent;
        this.statusOfTreeItem = item.exec?.status || item.status || "None"; // Possible values: Active, Planned, Finished, Closed, etc.
        // item.base is specific to CycleStructure nodes (TestThemes, TestCaseSets)
        const itemDataForTooltip = item?.base || item;
        // Set the tooltip based on the context value.
        if (contextValue === constants_1.TreeItemContextValues.PROJECT ||
            contextValue === constants_1.TreeItemContextValues.VERSION ||
            contextValue === constants_1.TreeItemContextValues.CYCLE ||
            (this.originalContextValue &&
                [
                    constants_1.TreeItemContextValues.PROJECT,
                    constants_1.TreeItemContextValues.VERSION,
                    constants_1.TreeItemContextValues.CYCLE
                ].includes(this.originalContextValue))) {
            this.tooltip = `Type: ${this.originalContextValue || contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nKey: ${itemDataForTooltip.key}`;
            if ((this.originalContextValue === constants_1.TreeItemContextValues.PROJECT ||
                contextValue === constants_1.TreeItemContextValues.PROJECT) &&
                item) {
                this.tooltip += `\nTOVs: ${item.tovsCount || 0}\nCycles: ${item.cyclesCount || 0}`;
            }
        }
        else if (contextValue === constants_1.TreeItemContextValues.TEST_THEME_NODE ||
            contextValue === constants_1.TreeItemContextValues.TEST_CASE_SET_NODE ||
            contextValue === constants_1.TreeItemContextValues.TEST_CASE_NODE ||
            (this.originalContextValue &&
                [constants_1.TreeItemContextValues.TEST_THEME_NODE, constants_1.TreeItemContextValues.TEST_CASE_SET_NODE].includes(this.originalContextValue))) {
            if (itemDataForTooltip?.numbering) {
                this.tooltip = `Numbering: ${itemDataForTooltip.numbering}\nType: ${itemDataForTooltip.elementType || this.originalContextValue || contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nID: ${itemDataForTooltip.uniqueID}`;
            }
            else {
                this.tooltip = `Type: ${itemDataForTooltip.elementType || this.originalContextValue || contextValue}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}\nID: ${itemDataForTooltip.uniqueID}`;
            }
            this.description = itemDataForTooltip?.uniqueID || "";
        }
        else if (contextValue === constants_1.TreeItemContextValues.CUSTOM_ROOT_PROJECT ||
            contextValue === constants_1.TreeItemContextValues.CUSTOM_ROOT_THEME) {
            this.tooltip = `Custom Root View\nType: ${this.originalContextValue || "N/A"}\nName: ${itemDataForTooltip.name}\nStatus: ${this.statusOfTreeItem}`;
        }
        // Set the command to be executed when the tree item is clicked.
        // Without this command, an already clicked cycle item is not clickable again.
        if (contextValue === constants_1.TreeItemContextValues.CYCLE) {
            this.command = {
                command: constants_1.allExtensionCommands.handleProjectCycleClick,
                title: "Show Test Themes",
                arguments: [this]
            };
        }
        this.updateIcon();
    }
    /**
     * Determines the icon path for the tree item based on its type and status.
     * Currently this is not used fully, but it allows to have different icons for different statuses of the tree items like the TestBench Client.
     *
     * @returns The absolute icon path to the icon file.
     */
    getIconPath() {
        const iconFolderPath = path.join(__dirname, "..", "resources", "icons");
        let typeForIconLookup = this.contextValue;
        if (this.contextValue === constants_1.TreeItemContextValues.CUSTOM_ROOT_PROJECT ||
            this.contextValue === constants_1.TreeItemContextValues.CUSTOM_ROOT_THEME) {
            typeForIconLookup = this.originalContextValue || this.contextValue;
        }
        const status = this.statusOfTreeItem?.toLowerCase() || "default"; // (Active, Planned, Finished, Closed etc.)
        // Map the context and status to the corresponding icon file name
        const iconMap = {
            [constants_1.TreeItemContextValues.PROJECT]: {
                active: { light: "project-light.svg", dark: "project-dark.svg" },
                planned: { light: "project-light.svg", dark: "project-dark.svg" },
                finished: { light: "project-light.svg", dark: "project-dark.svg" },
                closed: { light: "project-light.svg", dark: "project-dark.svg" },
                default: { light: "project-light.svg", dark: "project-dark.svg" }
            },
            [constants_1.TreeItemContextValues.VERSION]: {
                active: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                planned: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                finished: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                closed: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" },
                default: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" }
            },
            [constants_1.TreeItemContextValues.CYCLE]: {
                active: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                planned: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                finished: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                closed: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" },
                default: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" }
            },
            [constants_1.TreeItemContextValues.TEST_THEME_NODE]: {
                default: { light: "TestThemeOriginal-light.svg", dark: "TestThemeOriginal-dark.svg" }
            },
            [constants_1.TreeItemContextValues.TEST_CASE_SET_NODE]: {
                default: { light: "TestCaseSetOriginal-light.svg", dark: "TestCaseSetOriginal-dark.svg" }
            },
            [constants_1.TreeItemContextValues.TEST_CASE_NODE]: {
                default: { light: "TestCase-light.svg", dark: "TestCase-dark.svg" }
            },
            default: {
                default: { light: "TBU_Logo_cropped.svg", dark: "TBU_Logo_cropped.svg" }
            }
        };
        // Map the context and status to the corresponding icon file name
        const typeIcons = iconMap[typeForIconLookup] || iconMap["default"];
        const iconFileNames = typeIcons[status] || typeIcons["default"] || iconMap.default.default;
        return {
            light: path.join(iconFolderPath, iconFileNames.light),
            dark: path.join(iconFolderPath, iconFileNames.dark)
        };
    }
    /**
     * Updates the tree item's icon.
     */
    updateIcon() {
        const iconPaths = this.getIconPath();
        this.iconPath = {
            light: vscode.Uri.file(iconPaths.light),
            dark: vscode.Uri.file(iconPaths.dark)
        };
    }
}
exports.BaseTestBenchTreeItem = BaseTestBenchTreeItem;
/**
 * Sets up event listeners for the project tree view to handle expand/collapse and selection events.
 * These events update the expansion state, icons dynamically, and initialize the test theme tree on cycle click.
 * @param {vscode.TreeView<BaseTestBenchTreeItem>} projectTreeView The project tree view instance.
 * @param {ProjectManagementTreeDataProvider} projectManagementProvider The project management data provider instance.
 */
function setupProjectTreeViewEventListeners(projectTreeView, projectManagementProvider) {
    if (!projectTreeView) {
        extension_1.logger.error("Project tree view (projectTreeView) is not initialized. Cannot set up event listeners.");
        return;
    }
    if (!projectManagementProvider) {
        extension_1.logger.error("Project management data provider is not initialized. Cannot set up event listeners.");
        return;
    }
    projectTreeView.onDidExpandElement(async (event) => {
        await projectManagementProvider.handleExpansion(event.element, true);
        projectManagementProvider.rememberExpandedItem(event.element);
    });
    projectTreeView.onDidCollapseElement(async (event) => {
        await projectManagementProvider.handleExpansion(event.element, false);
        projectManagementProvider.forgetExpandedItem(event.element);
    });
    // React to selection changes in the project tree view
    const pmProvider = (0, extension_1.getProjectManagementTreeDataProvider)();
    if ((0, extension_1.getProjectTreeView)()) {
        (0, extension_1.getProjectTreeView)().onDidChangeSelection(async (event) => {
            if (event.selection.length > 0 && pmProvider) {
                const selectedElement = event.selection[0];
                extension_1.logger.trace(`Selection changed in Project Tree: ${typeof selectedElement.label === "string" ? selectedElement.label : "N/A"}, context: ${selectedElement.contextValue}`);
                const { projectName, tovName } = pmProvider.getProjectAndTovNamesForItem(selectedElement);
                extension_1.logger.trace(`Selected Project: ${projectName}, TOV: ${tovName}`);
                if (projectName && tovName) {
                    await (0, server_1.restartLanguageClient)(projectName, tovName);
                }
                else {
                    // If only a project is selected (tovName is undefined), stop the LS.
                    if (projectName && !tovName) {
                        extension_1.logger.info(`[ProjectSelect] Project '${projectName}' selected, but no TOV. Stopping active LS.`);
                        (0, server_1.setLatestLsContextRequestId)(server_1.latestLsContextRequestId + 1);
                        const thisStopOperationId = (0, server_1.getLatestLsContextRequestId)();
                        (0, server_1.setCurrentLsOperationId)(thisStopOperationId);
                        await (0, server_1.stopLanguageClient)();
                    }
                    else {
                        extension_1.logger.warn("Could not determine context for LS restart from selection (Project or TOV missing).");
                    }
                }
            }
        });
    }
}
/**
 * Hides the project management tree view.
 */
async function hideProjectManagementTreeView() {
    const projectTreeView = (0, extension_1.getProjectTreeView)();
    if (projectTreeView && projectTreeView.visible) {
        extension_1.logger.trace("Project management tree view is visible. Attempting to execute 'projectManagementTree.removeView'.");
        await vscode.commands.executeCommand("projectManagementTree.removeView");
    }
}
/**
 * Displays the project management tree view.
 */
async function displayProjectManagementTreeView() {
    if ((0, extension_1.getProjectTreeView)()) {
        await vscode.commands.executeCommand("projectManagementTree.focus");
    }
}
/**
 * Finds the project key (serial) for a given tree element by traversing upward in the tree hierarchy.
 *
 * @param {BaseTestBenchTreeItem} element The tree item.
 * @returns {string | null} The project key as a string if found; otherwise null.
 */
function findProjectKeyForElement(element) {
    extension_1.logger.trace("Finding project key for element:", element.label);
    let current = element;
    while (current) {
        if (current.contextValue === constants_1.TreeItemContextValues.PROJECT) {
            extension_1.logger.trace("Found project key for element:", current.item.key);
            return current.item.key;
        }
        current = current.parent;
    }
    const projectKeyNotFoundErrorMessage = `Project key not found traversing up from tree element: ${element.label}`;
    extension_1.logger.error(projectKeyNotFoundErrorMessage);
    return null;
}
//# sourceMappingURL=projectManagementTreeView.js.map