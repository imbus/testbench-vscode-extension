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
const vscode = __importStar(require("vscode"));
const projectManagementTreeView_1 = require("./projectManagementTreeView");
const extension_1 = require("./extension");
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
        // Explicitly fire with undefined to ensure a full refresh from the root.
        this._onDidChangeTreeData.fire(undefined);
    }
    /**
     * Returns the parent of a given tree item.
     * @param {ProjectManagementTreeItem} element The tree item.
     * @returns {ProjectManagementTreeItem | null} The parent TestbenchTreeItem or null.
     */
    getParent(element) {
        return element.parent;
    }
    /**
     * Returns the children of a given tree item. If no element is provided,
     * returns the root elements.
     * @param {ProjectManagementTreeItem} element Optional parent tree item.
     * @returns {Promise<ProjectManagementTreeItem[]>} A promise resolving to an array of TestbenchTreeItems.
     */
    async getChildren(element) {
        if (!element) {
            if (!this.rootElements || this.rootElements.length === 0) {
                extension_1.logger.trace("TestThemeTreeDataProvider: No root elements found, returning placeholder.");
                // If no root elements are found, return a placeholder item.
                return [
                    new projectManagementTreeView_1.ProjectManagementTreeItem("No test themes found for this cycle", "placeholder", vscode.TreeItemCollapsibleState.None, {}, null)
                ];
            }
            return this.rootElements;
        }
        return element.children || [];
    }
    /**
     * Returns the TreeItem representation for a given element.
     * @param {ProjectManagementTreeItem[]} element The TestbenchTreeItem.
     * @returns {vscode.TreeItem} The corresponding vscode.TreeItem.
     */
    getTreeItem(element) {
        return element;
    }
    /**
     * Sets the root elements of the test theme tree and refreshes the view.
     * @param {ProjectManagementTreeItem[]} roots An array of TestbenchTreeItems to set as roots.
     */
    setRoots(roots, cycleKey) {
        // Output of roots is circular and large, so it is commented out.
        // logger.trace("Setting root elements of the test theme tree to:", roots);
        this._currentCycleKey = cycleKey;
        this.rootElements = roots;
        this._onDidChangeTreeData.fire();
        this.refresh();
    }
    /**
     * Sets the selected tree item as the sole root of the test theme tree and refreshes the view.
     * @param {ProjectManagementTreeItem} element The TestbenchTreeItem to set as root.
     */
    makeRoot(element) {
        extension_1.logger.debug("Setting the selected element as the root of the test theme tree view:", element);
        this.rootElements = [element];
        this.refresh();
    }
    /**
     * Handles expansion or collapse of a tree item and updates its icon.
     * @param {ProjectManagementTreeItem} element The TestbenchTreeItem.
     * @param {boolean} expanded True if the item is expanded; false if collapsed.
     */
    handleExpansion(element, expanded) {
        extension_1.logger.trace(`Setting expansion state of "${element.label}" to ${expanded ? "expanded" : "collapsed"} in test theme tree.`);
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        if (expanded) {
            this.expandedTreeItems.add(element.item.key);
        }
        else {
            this.expandedTreeItems.delete(element.item.key);
        }
        element.updateIcon();
    }
    /**
     * Recursively stores the keys of expanded nodes.
     * @param {ProjectManagementTreeItem[] | null} elements An array of TestbenchTreeItems or null.
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
        // this.expandedTreeItems.clear();
        this._onDidChangeTreeData.fire();
        // this.refresh();
    }
}
exports.TestThemeTreeDataProvider = TestThemeTreeDataProvider;
//# sourceMappingURL=testThemeTreeView.js.map