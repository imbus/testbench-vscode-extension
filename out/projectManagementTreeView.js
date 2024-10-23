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
exports.ProjectManagementTreeItem = exports.ProjectManagementTreeDataProvider = void 0;
exports.findProjectKeyOfCycle = findProjectKeyOfCycle;
exports.makeRoot = makeRoot;
exports.initializeTreeView = initializeTreeView;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const testThemeTreeView_1 = require("./testThemeTreeView");
// Project management tree that displays projects, versions and cycles.
// Upon expanding a cycle element, the remaining children elements are displayed in test theme tree (test themes, test case sets, and test cases).
class ProjectManagementTreeDataProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    connection;
    rootItem = null;
    currentProjectKeyInView;
    testThemeDataProvider;
    constructor(connection, projectKey, testThemeDataProvider) {
        this.connection = connection;
        this.currentProjectKeyInView = projectKey ?? null;
        this.testThemeDataProvider = testThemeDataProvider;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getParent(element) {
        return element.parent;
    }
    createTreeItem(data, parent, isRoot = false) {
        if (!data) {
            return null;
        }
        const contextValue = data.nodeType.toLowerCase(); // project, version, cycle, testthemenode, testcasesetnode, testcasenode
        const collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        /*  TODO: Test cycle can be set to none to be non expandable and the user can click on it to see the test themes
            contextValue === "cycle"
                ? vscode.TreeItemCollapsibleState.None // TestCaseSet is the last level of the tree, so set collapsibleState to None
                : vscode.TreeItemCollapsibleState.Collapsed; // Set collapsibleState to Collapsed to make items clickable to trigger getChildren when expanded
        */
        const treeItem = new ProjectManagementTreeItem(data.name, contextValue, collapsibleState, data, parent);
        return treeItem;
    }
    async getChildren(element) {
        if (!this.connection) {
            // vscode.window.showInformationMessage("No connection available for tree view.");
            return [];
        }
        if (!element) {
            if (this.rootItem) {
                // If a root item is set, return its children
                return this.getChildren(this.rootItem);
            }
            // No parent element provided, return the root project (single selected project)
            const projectTree = await this.connection.getProjectTreeOfProject(this.currentProjectKeyInView);
            const rootItem = this.createTreeItem(projectTree, null, true);
            return rootItem ? [rootItem] : [];
        }
        if (element.contextValue === "cycle") {
            // Offload the children of the cycle to the Test Theme Tree
            this.testThemeDataProvider.setRoots(await this.getChildrenOfCycle(element));
            return []; // Return an empty array to prevent expansion in the Project Management Tree
        }
        else if (element && element.children) {
            // Return children directly if they exist (for elements under Test Cycle)
            return element.children;
        }
        const childrenData = element.item.children ?? [];
        // Create tree items for the children of the current element
        const children = childrenData
            .map((childData) => this.createTreeItem(childData, element))
            .filter((item) => item !== null);
        return children;
    }
    // Fetches the sub-elements of a cycle element and builds the tree structure
    async getChildrenOfCycle(element) {
        const cycleKey = element.item.key;
        const projectKey = findProjectKeyOfCycle(element);
        if (!projectKey) {
            console.error("Project key of cycle not found.");
            return [];
        }
        const cycleData = await this.connection?.fetchCycleStructure(projectKey, cycleKey);
        if (!cycleData || !cycleData.nodes?.length) {
            console.log("Cycle has no sub-elements.");
            return [];
        }
        // A key identifies an element uniquely.
        // Create a map to store elements by their key
        const elementsByKey = new Map();
        cycleData.nodes.forEach((data) => {
            elementsByKey.set(data.base.key, data);
        });
        // Recursively builds the tree structure starting from a given parent key.
        const buildTree = (parentKey) => {
            return (Array.from(elementsByKey.values())
                // Filter elements that have the current parentKey and are not TestCase elements
                .filter((data) => data.base.parentKey === parentKey && data.elementType !== "TestCase")
                .map((data) => {
                const hasChildren = Array.from(elementsByKey.values()).some((childData) => childData.base.parentKey === data.base.key);
                const treeItem = new ProjectManagementTreeItem(`${data.base.numbering} ${data.base.name}`, data.elementType.toLowerCase(), hasChildren
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None, data, element);
                // If the current element has children, recursively build their tree items
                if (hasChildren) {
                    treeItem.children = buildTree(data.base.key);
                }
                return treeItem;
            }));
        };
        const rootKey = cycleData.root.base.key;
        const children = buildTree(rootKey); // Build the tree starting from the root key
        element.children = children; // Assign the built children to the current element
        return children;
    }
    getTreeItem(element) {
        return element;
    }
    // Set the selected item as the root and refresh the tree view
    makeRoot(treeItem) {
        this.rootItem = treeItem;
        this.refresh();
    }
    handleExpansion(element, expanded) {
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();
    }
    clearTree() {
        this.testThemeDataProvider.clearTree();
        this.rootItem = null;
        this.connection = null;
        this.refresh();
    }
}
exports.ProjectManagementTreeDataProvider = ProjectManagementTreeDataProvider;
// Function to find the serial key of the project of a cycle element in the tree hierarchy
function findProjectKeyOfCycle(element) {
    let currentElement = element;
    while (currentElement) {
        if (currentElement.contextValue === "project") {
            return currentElement.item.key;
        }
        currentElement = currentElement.parent;
    }
    return undefined;
}
// Represents a tree item (Project, TOV, Cycle, etc) in the tree view
class ProjectManagementTreeItem extends vscode.TreeItem {
    item;
    parent;
    children;
    constructor(label, contextValue, // The type of the tree item (Project, TOV, Cycle etc.)
    collapsibleState, item, parent = null) {
        super(label, collapsibleState);
        this.item = item;
        this.contextValue = contextValue;
        this.parent = parent;
        this.updateIcon();
        // Tooltip for the test theme tree items
        if (item?.base?.numbering) {
            this.tooltip = `Numbering: ${item.base.numbering}, Type: ${item.elementType}, Name: ${item.base.name}, ID: ${item.base.uniqueID}`;
        }
    }
    getIconPath() {
        const iconFolderPath = path.join(__dirname, "..", "resources", "icons");
        const statusOfTreeItem = this.item.status?.toLowerCase() || "default"; // (Active, Planned, Finished, Closed etc.)
        const treeItemType = this.contextValue.toLowerCase(); // (Project, TOV, Cycle etc.)
        // Map the context and status to the corresponding icon file name
        // TODO: Replace the png icons with svg icons of web itorx
        const iconMap = {
            project: {
                active: "Project_B_Active.png",
                planned: "Project_B_Planned.png",
                finished: "Project_B_Finished.png",
                closed: "Project_B_Closed.png",
                default: "Project.png",
            },
            version: {
                active: "Testobject_B_Active.png",
                planned: "Testobject_B_Planned.png",
                finished: "Testobject_B_Finished.png",
                closed: "Testobject_B_Closed.png",
                default: "Testobject.png",
            },
            cycle: {
                active: "TestCycle_Active.png",
                planned: "TestCycle_Planned.png",
                finished: "TestCycle_Finished.png",
                closed: "TestCycle_Closed.png",
                default: "TestCycle.png",
            },
            testthemenode: {
                default: "TestTheme.svg",
            },
            testcasesetnode: {
                default: "TestCaseSet.svg",
            },
            testcasenode: {
                default: "TestCase.png",
            },
            default: {
                default: "iTB-EE-Logo.svg",
            },
        };
        const contextIcons = iconMap[treeItemType] || iconMap["default"];
        const iconFileName = contextIcons[statusOfTreeItem] || contextIcons["default"] || iconMap.default.default;
        return path.join(iconFolderPath, iconFileName);
    }
    updateIcon() {
        this.iconPath = this.getIconPath();
    }
}
exports.ProjectManagementTreeItem = ProjectManagementTreeItem;
function makeRoot(treeItem, treeDataProvider) {
    treeDataProvider.makeRoot(treeItem);
    vscode.window.showInformationMessage(`"${treeItem.label}" is now the root.`);
    vscode.window.registerTreeDataProvider("projectManagementTree", treeDataProvider);
}
async function initializeTreeView(context, connection, selectedProjectKey) {
    if (!connection) {
        vscode.window.showErrorMessage("No connection available. Please log in first.");
        return [null, null];
    }
    const testThemeDataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider();
    const testThemeTreeView = vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: testThemeDataProvider,
    });
    const projectManagementDataProvider = new ProjectManagementTreeDataProvider(connection, selectedProjectKey, testThemeDataProvider);
    const projectManagementTreeView = vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: projectManagementDataProvider,
    });
    // Handle expansion and collapse events to update icons dynamically
    projectManagementTreeView.onDidExpandElement((event) => {
        projectManagementDataProvider.handleExpansion(event.element, true);
    });
    projectManagementTreeView.onDidCollapseElement((event) => {
        projectManagementDataProvider.handleExpansion(event.element, false);
    });
    context.subscriptions.push(testThemeTreeView);
    testThemeDataProvider.refresh();
    return [projectManagementDataProvider, testThemeDataProvider];
}
//# sourceMappingURL=projectManagementTreeView.js.map