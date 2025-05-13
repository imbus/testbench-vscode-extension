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
    isCurrentCycle(cycleKey) {
        return this._currentCycleKey === cycleKey;
    }
    _currentProjectKey = null;
    /** Root elements for the Test Theme Tree view */
    rootElements = [];
    /** Set to store keys of expanded items so that refresh can restore expansion state */
    expandedTreeItems = new Set();
    // Callback for message updates
    updateMessageCallback;
    // Constructor to accept the callback
    constructor(updateMessageCallback) {
        this.updateMessageCallback = updateMessageCallback;
    }
    // Public method to set message via callback
    setMessage(message) {
        this.updateMessageCallback(message);
    }
    /**
     * Refreshes the test theme tree view.
     */
    refresh() {
        extension_1.logger.debug("Refreshing test theme tree view.");
        // Store the keys of the expanded items to preserve state on refresh.
        this.storeExpandedTreeItems(this.rootElements);
        const currentThemeTreeView = (0, extension_1.getTestThemeTreeViewInstance)();
        // Update message in the test theme tree view
        // Check if the view instance is available
        if (this.rootElements.length === 0) {
            if (this._currentCycleKey) {
                this.updateMessageCallback("No test themes found for the current cycle.");
            }
            else {
                this.updateMessageCallback("Select a cycle to see test themes.");
            }
            extension_1.logger.trace(`Test Themes view message set: ${currentThemeTreeView?.message}`);
        }
        else {
            this.updateMessageCallback(undefined); // Clear message
            extension_1.logger.trace("Test Themes view message cleared.");
        }
        // Explicitly fire with undefined to ensure a full refresh from the root.
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
            if (!this.rootElements || this.rootElements.length === 0) {
                extension_1.logger.trace("TestThemeTreeDataProvider: No root elements found, returning empty. Message should be set.");
                // Message is set by refresh() or when setRoots() is called if children are empty.
                return [];
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
     * @param {BaseTestBenchTreeItem[]} roots An array of TestbenchTreeItems to set as roots.
     * @param {string} cycleKey The key of the cycle these roots belong to.
     */
    setRoots(roots, cycleKey) {
        // Output of roots is circular and large, so it is commented out.
        // logger.trace("Setting root elements of the test theme tree to:", roots);
        this._currentCycleKey = cycleKey;
        this.rootElements = roots;
        this.refresh(); // This will call _onDidChangeTreeData.fire(undefined)
    }
    /**
     * Sets the selected tree item as the sole root of the test theme tree and refreshes the view.
     * @param {BaseTestBenchTreeItem} element The TestbenchTreeItem to set as root.
     */
    makeRoot(element) {
        extension_1.logger.debug("Setting the selected element as the root of the test theme tree view:", element);
        // Find the cycle key for the new root element if it's part of a cycle.
        let newCycleKey = null;
        if (element.parent && element.parent.contextValue === constants_1.TreeItemContextValues.CYCLE) {
            newCycleKey = element.parent.item?.key;
        }
        else if (element.contextValue === constants_1.TreeItemContextValues.CYCLE) {
            newCycleKey = element.item?.key;
        }
        // If a cycle key is found and is different, or if we are making a non-cycle element root, update _currentCycleKey.
        if (newCycleKey) {
            this._currentCycleKey = newCycleKey;
        }
        else {
            // If the new root isn't directly tied to a known cycle in its parentage here,
            // it might be an implicit change of context.
        }
        this.rootElements = [element];
        this.refresh();
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
        // Store the key of the expanded item in the set.
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
        this.rootElements = [];
        this.updateMessageCallback("Select a cycle from the 'Projects' view to see test themes.");
        this.expandedTreeItems.clear();
        this._onDidChangeTreeData.fire();
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
                this.rootElements = this.buildThemeTreeRecursive(rootCycleNodeKey, null, elementsByKey, eventData.rawCycleStructure.root.base.name);
            }
        }
        this.refresh(); // Refresh the view with new elements
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
    buildThemeTreeRecursive(parentItemKey, parentTreeItem, elementsByKey, parentNameForLogging) {
        extension_1.logger.trace(`TestThemeTreeDataProvider: Building children for parentKey: ${parentItemKey} ('${parentNameForLogging}')`);
        const potentialChildrenData = Array.from(elementsByKey.values()).filter((node) => node?.base?.parentKey === parentItemKey && this.isCycleNodeVisibleInTestThemeTree(node));
        const childTreeItems = potentialChildrenData.map((nodeData) => {
            const hasVisibleChildren = Array.from(elementsByKey.values()).some((childNodeCandidate) => childNodeCandidate?.base?.parentKey === nodeData.base.key &&
                this.isCycleNodeVisibleInTestThemeTree(childNodeCandidate));
            const treeItem = this.createThemeTreeItem(nodeData, nodeData.elementType, parentTreeItem, hasVisibleChildren);
            if (!treeItem) {
                return null;
            }
            // Recursively build children if this node has visible children
            if (hasVisibleChildren) {
                treeItem.children = this.buildThemeTreeRecursive(nodeData.base.key, treeItem, elementsByKey, nodeData.base.name);
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
    createThemeTreeItem(nodeData, // Raw data for the theme item
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
                defaultCollapsibleState = hasVisibleChildren // if TEST_CASE_NODE were included and visible
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
    // testThemeTree is the ID of the tree view in package.json
    await vscode.commands.executeCommand("testThemeTree.removeView");
}
/**
 * Displays the test theme tree view.
 */
async function displayTestThemeTreeView() {
    await vscode.commands.executeCommand("testThemeTree.focus");
}
//# sourceMappingURL=testThemeTreeView.js.map