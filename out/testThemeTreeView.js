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
const extension_1 = require("./extension");
7;
/**
 * TestThemeTreeDataProvider implements the TreeDataProvider interface to display
 * TestTheme items in the Test Theme Tree view.
 */
class TestThemeTreeDataProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    /** Root elements for the Test Theme Tree view */
    rootElements = [];
    /** Set to store keys of expanded items so that refresh can restore expansion state */
    expandedTreeItems = new Set();
    /**
     * Refreshes the test theme tree view.
     */
    refresh() {
        extension_1.logger.trace("Refreshing test theme tree view.");
        // Store the keys of the expanded items to preserve state on refresh.
        this.storeExpandedTreeItems(this.rootElements);
        this._onDidChangeTreeData.fire();
    }
    /**
     * Returns the parent of a given tree item.
     * @param element The tree item.
     * @returns The parent TestbenchTreeItem or null.
     */
    getParent(element) {
        return element.parent;
    }
    /**
     * Returns the children of a given tree item. If no element is provided,
     * returns the root elements.
     * @param element Optional parent tree item.
     * @returns A promise resolving to an array of TestbenchTreeItems.
     */
    async getChildren(element) {
        if (!element) {
            return this.rootElements;
        }
        return element.children || [];
    }
    /**
     * Returns the TreeItem representation for a given element.
     * @param element The TestbenchTreeItem.
     * @returns The corresponding vscode.TreeItem.
     */
    getTreeItem(element) {
        return element;
    }
    /**
     * Sets the root elements of the test theme tree and refreshes the view.
     * @param roots An array of TestbenchTreeItems to set as roots.
     */
    setRoots(roots) {
        extension_1.logger.trace("Setting root elements of the test theme tree to:", roots);
        this.rootElements = roots;
        this.refresh();
    }
    /**
     * Sets the selected tree item as the sole root of the test theme tree and refreshes the view.
     * @param element The TestbenchTreeItem to set as root.
     */
    makeRoot(element) {
        extension_1.logger.trace("Setting the selected element as the root of the test theme tree view:", element);
        this.rootElements = [element];
        this.refresh();
    }
    /**
     * Handles expansion or collapse of a tree item and updates its icon.
     * @param element The TestbenchTreeItem.
     * @param expanded True if the item is expanded; false if collapsed.
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
     * @param elements An array of TestbenchTreeItems or null.
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
        this.rootElements = [];
        this.refresh();
    }
}
exports.TestThemeTreeDataProvider = TestThemeTreeDataProvider;
//# sourceMappingURL=testThemeTreeView.js.map