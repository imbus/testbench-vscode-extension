"use strict";
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestThemeTreeDataProvider = void 0;
const vscode = __importStar(require("vscode"));
class TestThemeTreeDataProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    rootElements = [];
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getParent(element) {
        return element.parent;
    }
    async getChildren(element) {
        if (!element) {
            return this.rootElements;
        }
        return element.children || [];
    }
    getTreeItem(element) {
        return element;
    }
    // Set the root elements of the tree
    setRoots(roots) {
        this.rootElements = roots;
        this.refresh();
    }
    // Set the selected element as the only root element
    makeRoot(element) {
        this.rootElements = [element]; // Set the selected element as the root
        this.refresh(); // Refresh the tree to display the new root
    }
    handleExpansion(element, expanded) {
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();
    }
    // Clear the tree
    clearTree() {
        this.rootElements = [];
        this.refresh();
    }
}
exports.TestThemeTreeDataProvider = TestThemeTreeDataProvider;
//# sourceMappingURL=testThemeTreeView.js.map