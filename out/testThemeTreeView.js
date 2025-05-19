"use strict";
/**
 * @file testThemeTreeView.ts
 * @description Provides a VS Code TreeDataProvider implementation for the Test Theme Tree view.
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
exports.TestThemeTreeDataProvider = void 0;
exports.hideTestThemeTreeView = hideTestThemeTreeView;
exports.displayTestThemeTreeView = displayTestThemeTreeView;
const vscode = __importStar(require("vscode"));
const projectManagementTreeView_1 = require("./projectManagementTreeView");
const extension_1 = require("./extension");
const constants_1 = require("./constants");
/**
 * TestThemeTreeDataProvider implements the TreeDataProvider interface to display
 * TestTheme items in the Test Theme Tree view.
 */
class TestThemeTreeDataProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    _currentCycleKey = null;
    getCurrentCycleKey() {
        return this._currentCycleKey;
    }
    _currentProjectKey = null;
    getCurrentProjectKey() {
        return this._currentProjectKey;
    }
    _currentCycleLabel = null;
    isCustomRootActive = false;
    customRootItemInstance = null;
    originalCustomRootContextValue = null;
    /** Root elements for the Test Theme Tree view */
    rootElements = [];
    /** Set to store keys of expanded items so that refresh can restore expansion state */
    expandedTreeItems = new Set();
    updateTreeViewStatusMessageCallback;
    constructor(updateMessageCallback) {
        this.updateTreeViewStatusMessageCallback = updateMessageCallback;
        vscode.commands.executeCommand("setContext", constants_1.ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);
    }
    setTreeViewStatusMessage(message) {
        this.updateTreeViewStatusMessageCallback(message);
    }
    /**
     * Refreshes the test theme tree view.
     * Fetches fresh data from the server for the current cycle,
     * clears any custom root, and updates tree view messages.
     * @param {boolean} isHardRefresh - If true, implies a user-initiated refresh (refresh button)) and not an internal refresh.
     */
    async refresh(isHardRefresh = false) {
        extension_1.logger.debug(`Refreshing test theme tree view. Hard refresh: ${isHardRefresh}, Custom root active: ${this.isCustomRootActive}`);
        const currentCustomRootKeyBeforeRefresh = this.isCustomRootActive && this.customRootItemInstance ? this.customRootItemInstance.item.base.key : null;
        if (isHardRefresh && this.isCustomRootActive) {
            extension_1.logger.trace("Hard refresh requested with active custom root. Resetting to full cycle view.");
            this.resetCustomRootInternally();
        }
        this.storeExpandedTreeItems(this.rootElements);
        if (!this._currentCycleKey || !this._currentProjectKey) {
            extension_1.logger.warn("TestThemeTreeDataProvider: Cannot refresh without a current cycle and project key.");
            this.clearTree();
            this._onDidChangeTreeData.fire(undefined);
            return;
        }
        const initialLoadingMessage = this.isCustomRootActive && this.customRootItemInstance && !isHardRefresh
            ? `Refreshing: ${this.customRootItemInstance.label}...`
            : `Loading test themes for cycle: ${this._currentCycleLabel || this._currentCycleKey}...`;
        this.setTreeViewStatusMessage(initialLoadingMessage);
        if (!(this.isCustomRootActive && !isHardRefresh)) {
            this.rootElements = [];
        }
        this._onDidChangeTreeData.fire(undefined);
        let rawCycleStructure = null;
        let operationSuccessful = false;
        try {
            if (!extension_1.connection) {
                extension_1.logger.error("TestThemeTreeDataProvider: No active connection to TestBench server.");
                this.setTreeViewStatusMessage("Error: Not connected to TestBench server.");
                if (!this.isCustomRootActive) {
                    this.rootElements = [];
                }
                return;
            }
            rawCycleStructure = await extension_1.connection.fetchCycleStructureOfCycleInProject(this._currentProjectKey, this._currentCycleKey);
            if (rawCycleStructure) {
                operationSuccessful = true;
                if (this.isCustomRootActive &&
                    this.customRootItemInstance &&
                    !isHardRefresh &&
                    currentCustomRootKeyBeforeRefresh) {
                    extension_1.logger.debug(`Soft refreshing custom root: ${this.customRootItemInstance.label} (Key: ${currentCustomRootKeyBeforeRefresh})`);
                    const elementsByKey = new Map();
                    rawCycleStructure.nodes.forEach((node) => {
                        if (node?.base?.key) {
                            elementsByKey.set(node.base.key, node);
                        }
                    });
                    const updatedCustomRootNodeData = elementsByKey.get(currentCustomRootKeyBeforeRefresh);
                    if (updatedCustomRootNodeData && this.customRootItemInstance) {
                        this.customRootItemInstance.item = updatedCustomRootNodeData;
                        const newLabel = updatedCustomRootNodeData.base.numbering
                            ? `${updatedCustomRootNodeData.base.numbering} ${updatedCustomRootNodeData.base.name}`
                            : updatedCustomRootNodeData.base.name;
                        if (this.customRootItemInstance.label !== newLabel) {
                            this.customRootItemInstance.label = newLabel;
                        }
                        this.customRootItemInstance.statusOfTreeItem = updatedCustomRootNodeData.exec?.status || "None";
                        this.customRootItemInstance.updateIcon();
                        this.customRootItemInstance.children = this.buildThemeTreeRecursively(currentCustomRootKeyBeforeRefresh, this.customRootItemInstance, elementsByKey, updatedCustomRootNodeData.base.name);
                        if (this.customRootItemInstance.children && this.customRootItemInstance.children.length > 0) {
                            this.customRootItemInstance.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                        }
                        else {
                            this.customRootItemInstance.collapsibleState = vscode.TreeItemCollapsibleState.None;
                        }
                        this.rootElements = [this.customRootItemInstance];
                        this._onDidChangeTreeData.fire(this.customRootItemInstance);
                    }
                    else {
                        extension_1.logger.warn(`Custom root item (Key: ${currentCustomRootKeyBeforeRefresh}) not found in refreshed cycle structure. Resetting to full view.`);
                        this.resetCustomRootInternally();
                        this.populateFromCycleData({
                            projectKey: this._currentProjectKey,
                            cycleKey: this._currentCycleKey,
                            cycleLabel: this._currentCycleLabel || this._currentCycleKey,
                            rawCycleStructure: rawCycleStructure
                        });
                        operationSuccessful = true;
                    }
                }
                else {
                    this.populateFromCycleData({
                        projectKey: this._currentProjectKey,
                        cycleKey: this._currentCycleKey,
                        cycleLabel: this._currentCycleLabel || this._currentCycleKey,
                        rawCycleStructure: rawCycleStructure
                    });
                    operationSuccessful = true;
                }
            }
            else {
                extension_1.logger.warn(`Failed to fetch cycle structure for cycle ${this._currentCycleKey} during refresh.`);
                if (!this.isCustomRootActive) {
                    this.rootElements = [];
                }
            }
        }
        catch (error) {
            extension_1.logger.error(`Error during refresh data fetch for cycle ${this._currentCycleKey}:`, error);
            if (!this.isCustomRootActive) {
                this.rootElements = [];
            }
            rawCycleStructure = null;
        }
        finally {
            if (!this._currentCycleKey) {
                this.setTreeViewStatusMessage("Select a cycle from the 'Projects' view to see test themes.");
            }
            else if (operationSuccessful && this.rootElements.length === 0) {
                this.setTreeViewStatusMessage(this._currentCycleLabel
                    ? `No test themes found for cycle ${this._currentCycleLabel}.`
                    : "No test themes found for the current cycle.");
            }
            else if (!operationSuccessful && extension_1.connection) {
                this.setTreeViewStatusMessage(`Error loading themes for ${this._currentCycleLabel || this._currentCycleKey}.`);
            }
            else if (!extension_1.connection) {
                this.setTreeViewStatusMessage("Error: Not connected to TestBench server.");
            }
            else {
                this.setTreeViewStatusMessage(undefined);
            }
            const alreadyFired = this.isCustomRootActive && !isHardRefresh && operationSuccessful;
            const isDataFullyLoaded = operationSuccessful && (!this.isCustomRootActive || isHardRefresh) && rawCycleStructure;
            if (!alreadyFired && !isDataFullyLoaded) {
                this._onDidChangeTreeData.fire(undefined);
            }
        }
    }
    /**
     * Internal refresh logic after data population, to update messages and fire data change.
     * Avoids re-fetching if called from populateFromCycleData.
     */
    internalRefreshAfterPopulate() {
        extension_1.logger.debug("TestThemeTreeDataProvider: Internal refresh after populating data.");
        this.storeExpandedTreeItems(this.rootElements);
        const currentThemeTreeView = (0, extension_1.getTestThemeTreeViewInstance)();
        if (this.rootElements.length === 0) {
            if (this._currentCycleKey) {
                this.updateTreeViewStatusMessageCallback(this._currentCycleLabel
                    ? `No test themes found for cycle ${this._currentCycleLabel}.`
                    : "No test themes found for the current cycle.");
            }
            else {
                this.updateTreeViewStatusMessageCallback("Select a cycle to see test themes.");
            }
            if (currentThemeTreeView) {
                extension_1.logger.trace(`Test Themes view message set: ${currentThemeTreeView.message}`);
            }
        }
        else {
            this.updateTreeViewStatusMessageCallback(undefined);
            if (currentThemeTreeView) {
                extension_1.logger.trace("Test Themes view message cleared.");
            }
        }
        this._onDidChangeTreeData.fire(undefined);
    }
    /**
     * Returns the parent of a given tree item.
     * @param {BaseTestBenchTreeItem} element The tree item.
     * @returns {BaseTestBenchTreeItem | null} The parent TestbenchTreeItem or null.
     */
    getParent(element) {
        return element.parent;
    }
    /**
     * Returns the children of a given tree item. If no element is provided,
     * returns the root elements.
     * @param {BaseTestBenchTreeItem} element Optional parent tree item.
     * @returns {Promise<BaseTestBenchTreeItem[]>} A promise resolving to an array of TestbenchTreeItems.
     */
    async getChildren(element) {
        if (!element) {
            if (this.isCustomRootActive && this.customRootItemInstance) {
                if (this.customRootItemInstance.collapsibleState === vscode.TreeItemCollapsibleState.None &&
                    this.customRootItemInstance.children &&
                    this.customRootItemInstance.children.length > 0) {
                    this.customRootItemInstance.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                }
                else if (this.customRootItemInstance.children && this.customRootItemInstance.children.length > 0) {
                    this.customRootItemInstance.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                }
                return [this.customRootItemInstance];
            }
            return this.rootElements;
        }
        return element.children || [];
    }
    /**
     * Returns the TreeItem representation for a given element.
     * @param {BaseTestBenchTreeItem[]} element The TestbenchTreeItem.
     * @returns {vscode.TreeItem} The corresponding vscode.TreeItem.
     */
    getTreeItem(element) {
        return element;
    }
    /**
     * Sets the root elements of the test theme tree and refreshes the view.
     * This method is typically called when initially populating from cycle data.
     * @param {BaseTestBenchTreeItem[]} roots An array of TestbenchTreeItems to set as roots.
     * @param {string} projectKey The key of the project this cycle belongs to.
     * @param {string} cycleKey The key of the cycle these roots belong to.
     * @param {string} cycleLabel The label/name of the cycle.
     */
    setRoots(roots, projectKey, cycleKey, cycleLabel) {
        extension_1.logger.trace(`TestThemeTreeDataProvider: Setting roots for projectKey: ${projectKey}, cycleKey: ${cycleKey}, cycleLabel: ${cycleLabel}`);
        this._currentProjectKey = projectKey;
        this._currentCycleKey = cycleKey;
        this._currentCycleLabel = cycleLabel;
        this.rootElements = roots;
        const currentThemeTreeView = (0, extension_1.getTestThemeTreeViewInstance)();
        if (this.rootElements.length === 0) {
            if (this._currentCycleKey) {
                this.updateTreeViewStatusMessageCallback(this._currentCycleLabel
                    ? `No test themes found for cycle ${this._currentCycleLabel}.`
                    : "No test themes found for the current cycle.");
            }
            else {
                this.updateTreeViewStatusMessageCallback("Select a cycle to see test themes.");
            }
            if (currentThemeTreeView) {
                extension_1.logger.trace(`Test Themes view message set: ${currentThemeTreeView.message}`);
            }
        }
        else {
            this.updateTreeViewStatusMessageCallback(undefined);
            if (currentThemeTreeView) {
                extension_1.logger.trace("Test Themes view message cleared.");
            }
        }
        this._onDidChangeTreeData.fire(undefined);
    }
    /**
     * Sets the selected tree item as the sole root of the test theme tree and refreshes the view.
     * This implements the "Make Root" button functionality.
     * Make Root" only changes what's immediately displayed.
     * @param {BaseTestBenchTreeItem} element The TestbenchTreeItem to set as root.
     */
    makeRoot(element) {
        extension_1.logger.debug("Setting the selected element as the root of the test theme tree view:", element);
        if (this.customRootItemInstance &&
            this.customRootItemInstance !== element &&
            this.originalCustomRootContextValue) {
            this.customRootItemInstance.contextValue = this.originalCustomRootContextValue;
        }
        this.rootElements = [element];
        this.isCustomRootActive = true;
        this.customRootItemInstance = element;
        this.originalCustomRootContextValue = element.contextValue ?? null;
        element.contextValue = constants_1.TreeItemContextValues.CUSTOM_ROOT_THEME;
        if (element.children && element.children.length > 0) {
            element.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }
        else {
            element.collapsibleState = vscode.TreeItemCollapsibleState.None;
        }
        element.parent = null;
        vscode.commands.executeCommand("setContext", constants_1.ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, true);
        this._onDidChangeTreeData.fire(undefined);
        extension_1.logger.info(`Item "${element.label}" is now set as custom root for Test Themes.`);
    }
    /**
     * Resets the custom root, restoring the tree to display the full data for the current cycle.
     */
    async resetCustomRoot() {
        extension_1.logger.debug("Resetting custom root for Test Theme Tree.");
        if (this.isCustomRootActive) {
            const itemThatWasRoot = this.customRootItemInstance;
            this.resetCustomRootInternally();
            await this.refresh(true);
            if (itemThatWasRoot) {
                this._onDidChangeTreeData.fire(itemThatWasRoot);
            }
            extension_1.logger.info("Test Theme Tree custom root has been reset.");
        }
        else {
            extension_1.logger.trace("No custom root was active in Test Theme Tree to reset.");
        }
    }
    /**
     * Resets the custom root item for the theme tree view.
     *
     * This method restores the original context value of the custom root item if it exists,
     * clears the custom root state, and updates the relevant VS Code context key.
     */
    resetCustomRootInternally() {
        if (this.customRootItemInstance && this.originalCustomRootContextValue) {
            this.customRootItemInstance.contextValue = this.originalCustomRootContextValue;
        }
        this.isCustomRootActive = false;
        this.customRootItemInstance = null;
        this.originalCustomRootContextValue = null;
        vscode.commands.executeCommand("setContext", constants_1.ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);
    }
    /**
     * Handles expansion or collapse of a tree item and updates its icon.
     * @param {BaseTestBenchTreeItem} element The TestbenchTreeItem.
     * @param {boolean} expanded True if the item is expanded; false if collapsed.
     */
    handleExpansion(element, expanded) {
        extension_1.logger.trace(`Setting expansion state of "${element.label}" to ${expanded ? "expanded" : "collapsed"} in test theme tree.`);
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        if (expanded && element.item?.key) {
            this.expandedTreeItems.add(element.item.key);
        }
        else if (element.item?.key) {
            this.expandedTreeItems.delete(element.item.key);
        }
        element.updateIcon();
    }
    /**
     * Recursively stores the keys of expanded nodes.
     * @param {BaseTestBenchTreeItem[] | null} elements An array of TestbenchTreeItems or null.
     */
    storeExpandedTreeItems(elements) {
        if (elements) {
            elements.forEach((element) => {
                if (element.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                    this.expandedTreeItems.add(element.item.key);
                }
                if (element.children) {
                    this.storeExpandedTreeItems(element.children);
                }
            });
        }
    }
    /**
     * Clears the test theme tree by resetting the root elements and refreshing the view.
     */
    clearTree() {
        extension_1.logger.trace("Clearing the test theme tree.");
        this._currentCycleKey = null;
        this._currentProjectKey = null;
        this._currentCycleLabel = null;
        this.resetCustomRootInternally();
        this.rootElements = [];
        this.updateTreeViewStatusMessageCallback("Select a cycle from the 'Projects' view to see test themes.");
        this.expandedTreeItems.clear();
        this._onDidChangeTreeData.fire(undefined);
    }
    /**
     * Populates the tree view with data from a specific cycle.
     *
     * Processes the provided cycle data, builds a tree structure
     * from its nodes, and then refreshes the tree view to display the new data.
     * If the provided data is invalid or incomplete, the tree view will be cleared.
     *
     * @param {CycleDataForThemeTreeEvent} eventData - The cycle data used to populate the tree.
     *                    It includes the cycle key, label, and raw node structure.
     */
    populateFromCycleData(eventData) {
        extension_1.logger.trace(`TestThemeTreeDataProvider: Populating from cycle data for cycleKey: ${eventData.cycleKey}`);
        this._currentCycleKey = eventData.cycleKey;
        this._currentProjectKey = eventData.projectKey;
        this._currentCycleLabel = eventData.cycleLabel;
        if (this.isCustomRootActive) {
            this.resetCustomRootInternally();
        }
        if (!eventData.rawCycleStructure ||
            !eventData.rawCycleStructure.nodes?.length ||
            !eventData.rawCycleStructure.root?.base?.key) {
            extension_1.logger.warn(`No valid raw cycle structure data provided for cycle ${eventData.cycleLabel}. Clearing tree.`);
            this.rootElements = [];
        }
        else {
            const elementsByKey = new Map();
            eventData.rawCycleStructure.nodes.forEach((node) => {
                if (node?.base?.key) {
                    elementsByKey.set(node.base.key, node);
                }
                else {
                    extension_1.logger.warn("TestThemeTreeDataProvider: Found node without base.key in cycle structure:", node);
                }
            });
            if (elementsByKey.size === 0 && eventData.rawCycleStructure.nodes.length > 0) {
                extension_1.logger.error(`TestThemeTreeDataProvider: No nodes with base.key were found in the cycle structure data for cycle ${eventData.cycleLabel}, cannot build tree.`);
                this.rootElements = [];
            }
            else {
                const rootCycleNodeKey = eventData.rawCycleStructure.root.base.key;
                this.rootElements = this.buildThemeTreeRecursively(rootCycleNodeKey, null, elementsByKey, eventData.rawCycleStructure.root.base.name);
            }
        }
        this.isCustomRootActive = false;
        vscode.commands.executeCommand("setContext", constants_1.ContextKeys.THEME_TREE_HAS_CUSTOM_ROOT, false);
        this.internalRefreshAfterPopulate();
    }
    /**
     * Checks if a cycle node is visible in the test theme tree.
     * @param {CycleNodeData} nodeData The cycle node data.
     * @returns {boolean} True if the node is visible; false otherwise.
     */
    isCycleNodeVisibleInTestThemeTree(nodeData) {
        if (nodeData.elementType === constants_1.TreeItemContextValues.TEST_CASE_NODE) {
            return false;
        }
        if (nodeData.exec?.status === "NotPlanned" || nodeData.exec?.locker === "-2") {
            return false;
        }
        return true;
    }
    /**
     * Recursively builds a theme tree structure.
     *
     * @param {string} parentItemKey - The key of the parent item for which to find children.
     * @param {BaseTestBenchTreeItem | null} parentTreeItem - The parent tree item in the current recursion level, or null for the root.
     * @param {Map<string, CycleNodeData>} elementsByKey - A map containing all available cycle node data, keyed by their unique keys.
     * @param {string} parentNameForLogging - The name of the parent item, used for logging purposes.
     * @returns {BaseTestBenchTreeItem[]} An array of `BaseTestBenchTreeItem` representing the children of the specified parent.
     */
    buildThemeTreeRecursively(parentItemKey, parentTreeItem, elementsByKey, parentNameForLogging) {
        extension_1.logger.trace(`TestThemeTreeDataProvider: Building children for parentKey: ${parentItemKey} ('${parentNameForLogging}')`);
        const potentialChildrenData = Array.from(elementsByKey.values()).filter((node) => node?.base?.parentKey === parentItemKey && this.isCycleNodeVisibleInTestThemeTree(node));
        const childTreeItems = potentialChildrenData.map((nodeData) => {
            const hasVisibleChildren = Array.from(elementsByKey.values()).some((childNodeCandidate) => childNodeCandidate?.base?.parentKey === nodeData.base.key &&
                this.isCycleNodeVisibleInTestThemeTree(childNodeCandidate));
            const treeItem = this.createThemeTreeItem(nodeData, nodeData.elementType, parentTreeItem, hasVisibleChildren);
            if (!treeItem) {
                return null;
            }
            if (hasVisibleChildren) {
                treeItem.children = this.buildThemeTreeRecursively(nodeData.base.key, treeItem, elementsByKey, nodeData.base.name);
            }
            else {
                treeItem.children = [];
            }
            return treeItem;
        });
        return childTreeItems.filter((item) => item !== null);
    }
    /**
     * Creates a tree item for the Test Theme view.
     *
     * @param {CycleNodeData} nodeData - The raw data for the theme item.
     * @param {string} contextValue - The context value determining the item's type and behavior.
     * @param {BaseTestBenchTreeItem | null} parent - The parent tree item, or null if it's a root item.
     * @param {boolean} hasVisibleChildren - Indicates if the item has children that are currently visible in the tree.
     * @returns A new {@link BaseTestBenchTreeItem} instance, or null if `nodeData` is invalid.
     */
    createThemeTreeItem(nodeData, // Raw data for the test theme item
    contextValue, parent, hasVisibleChildren) {
        if (!nodeData ||
            !nodeData.base ||
            typeof nodeData.base.key === "undefined" ||
            typeof nodeData.base.name === "undefined") {
            extension_1.logger.warn(`TestThemeTreeDataProvider: Attempted to create theme tree item with invalid data structure for context ${contextValue}:`, nodeData);
            return null;
        }
        const itemName = nodeData.base.name;
        const label = nodeData.base.numbering ? `${nodeData.base.numbering} ${itemName}` : itemName;
        let defaultCollapsibleState;
        switch (contextValue) {
            case constants_1.TreeItemContextValues.TEST_THEME_NODE:
                defaultCollapsibleState = hasVisibleChildren
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
                break;
            case constants_1.TreeItemContextValues.TEST_CASE_SET_NODE:
                defaultCollapsibleState = hasVisibleChildren
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
                break;
            // TEST_CASE_NODE is filtered out by isCycleNodeVisibleInTestThemeTree
            default:
                extension_1.logger.warn(`TestThemeTreeDataProvider: Unexpected contextValue '${contextValue}' during item creation.`);
                defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
        }
        const treeItem = new projectManagementTreeView_1.BaseTestBenchTreeItem(label, contextValue, defaultCollapsibleState, nodeData, parent);
        // Restore Expansion State
        const itemKeyForExpansion = treeItem.item?.base?.key; // Key is in item.base for CycleStructure nodes
        if (itemKeyForExpansion &&
            this.expandedTreeItems.has(itemKeyForExpansion) &&
            treeItem.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            extension_1.logger.trace(`TestThemeTreeDataProvider: Restoring expanded state for item: ${treeItem.label} (Key: ${itemKeyForExpansion})`);
        }
        return treeItem;
    }
}
exports.TestThemeTreeDataProvider = TestThemeTreeDataProvider;
/**
 * Hides the test theme tree view.
 */
async function hideTestThemeTreeView() {
    if ((0, extension_1.getTestThemeTreeViewInstance)()) {
        await vscode.commands.executeCommand("testThemeTree.removeView");
    }
    else {
        extension_1.logger.debug("Test Theme Tree View instance not found; 'removeView' command not executed.");
    }
}
/**
 * Displays the test theme tree view.
 */
async function displayTestThemeTreeView() {
    if ((0, extension_1.getTestThemeTreeViewInstance)()) {
        await vscode.commands.executeCommand("testThemeTree.focus");
    }
    else {
        extension_1.logger.debug("Test Theme Tree View instance not found; 'removeView' command not executed.");
    }
}
//# sourceMappingURL=testThemeTreeView.js.map