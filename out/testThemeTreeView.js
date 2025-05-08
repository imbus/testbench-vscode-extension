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
    isCurrentCycle(cycleKey) {
        return this._currentCycleKey === cycleKey;
    }
    /** Root elements for the Test Theme Tree view */
    rootElements = [];
    /** Set to store keys of expanded items so that refresh can restore expansion state */
    expandedTreeItems = new Set();
    /**
     * Refreshes the test theme tree view.
     */
    refresh() {
        extension_1.logger.debug("Refreshing test theme tree view.");
        // Store the keys of the expanded items to preserve state on refresh.
        this.storeExpandedTreeItems(this.rootElements);
        // Update message in the test theme tree view
        if (extension_1.testThemeTreeViewInstance) {
            // Check if the view instance is available
            if (this.rootElements.length === 0) {
                if (this._currentCycleKey) {
                    extension_1.testThemeTreeViewInstance.message = "No test themes found for the current cycle.";
                }
                else if (extension_1.testThemeTreeViewInstance.message && extension_1.testThemeTreeViewInstance.message.startsWith("Refreshing")) {
                    // Keep the "Refreshing..." message if it was set by the command
                }
                else {
                    extension_1.testThemeTreeViewInstance.message = "Select a cycle to see test themes.";
                }
                extension_1.logger.trace(`Test Themes view message set: ${extension_1.testThemeTreeViewInstance.message}`);
            }
            else {
                extension_1.testThemeTreeViewInstance.message = undefined; // Clear message
                extension_1.logger.trace("Test Themes view message cleared.");
            }
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
        if (extension_1.testThemeTreeViewInstance) {
            // Only set default message if not already in a loading state from command
            if (!(extension_1.testThemeTreeViewInstance.message && extension_1.testThemeTreeViewInstance.message.startsWith("Refreshing"))) {
                extension_1.testThemeTreeViewInstance.message = "Select a cycle from the 'Projects' view to see test themes.";
            }
        }
        // TODO: Clear the expanded set items after clear command if needed.
        // this.expandedTreeItems.clear();
        this._onDidChangeTreeData.fire();
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