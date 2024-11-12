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
exports.TestbenchTreeItem = exports.ProjectManagementTreeDataProvider = void 0;
exports.findProjectKeyOfCycleElement = findProjectKeyOfCycleElement;
exports.findCycleKeyOfTreeElement = findCycleKeyOfTreeElement;
exports.initializeTreeView = initializeTreeView;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const testThemeTreeView_1 = require("./testThemeTreeView");
const extension_1 = require("./extension");
// Project management tree view that displays projects, versions and cycles.
// Upon clicking on a cycle element, the remaining children elements are displayed in test theme tree (test themes and test case sets).
class ProjectManagementTreeDataProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    // The root item (A project) of the tree view
    rootItem = null;
    // The key of the project currently in view in the tree
    currentProjectKeyInView;
    // The test theme tree data provider to offload the test theme tree data
    testThemeDataProvider;
    constructor(connection, projectKey, testThemeDataProvider) {
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
        const contextValue = data.nodeType; // Project, Version, Cycle, testthemenode, TestCaseSetNode, TestCaseNode
        const collapsibleState = contextValue === "Cycle"
            ? vscode.TreeItemCollapsibleState.None // Test cycles are set to none to be non expandable, the user can click on it to see the test themes
            : vscode.TreeItemCollapsibleState.Collapsed; // Set collapsibleState to Collapsed to make items clickable to trigger getChildren when expanded
        const treeItem = new TestbenchTreeItem(data.name, contextValue, collapsibleState, data, parent);
        return treeItem;
    }
    async getChildren(element) {
        if (!extension_1.connection) {
            // vscode.window.showWarningMessage("No connection available for tree view.");            
            return [];
        }
        if (!element) {
            if (this.rootItem) {
                // If a root item is set, return its children
                return await this.getChildren(this.rootItem);
            }
            // No parent element provided, return the root project (single selected project)
            const projectTree = await extension_1.connection.getProjectTreeOfProject(this.currentProjectKeyInView);
            const rootItem = this.createTreeItem(projectTree, null, true);
            return rootItem ? [rootItem] : [];
        }
        if (element.contextValue === "Cycle") {
            // Clear the test theme tree when a cycle is expanded so that clicking on a new test cycle will not show the old test themes
            this.testThemeDataProvider.clearTree();
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
        const projectKey = findProjectKeyOfCycleElement(element);
        if (!projectKey) {
            // console.warn("Project key of cycle not found.");
            extension_1.logger.warn("Project key of cycle not found (getChildrenOfCycle).");
            return [];
        }
        if (!extension_1.connection) {
            // console.warn("No connection available for tree view.");
            extension_1.logger.warn("No connection available for tree view (getChildrenOfCycle).");
            return [];
        }
        const cycleData = await extension_1.connection.fetchCycleStructure(projectKey, cycleKey);
        if (!cycleData || !cycleData.nodes?.length) {
            // console.warn("Cycle has no sub-elements.");
            extension_1.logger.warn("Cycle has no sub-elements (getChildrenOfCycle).");
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
                // Filter elements that have the current parentKey and are not TestCaseNode elements
                .filter((data) => data.base.parentKey === parentKey && data.elementType !== "TestCaseNode")
                // Filter out not executable elements and elements that are locked by the system
                .filter((data) => data.exec?.status !== "NotPlanned" && data.exec?.locker?.key !== "-2")
                .map((data) => {
                const hasChildren = Array.from(elementsByKey.values()).some((childData) => childData.base.parentKey === data.base.key);
                const treeItem = new TestbenchTreeItem(`${data.base.numbering} ${data.base.name}`, data.elementType, 
                // TestCaseSetNode are the last level of the tree, so they are not collapsible.
                // Only show the expand icon if the element has children.
                data.elementType === "TestCaseSetNode"
                    ? vscode.TreeItemCollapsibleState.None
                    : hasChildren
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
    async handleExpansion(element, expanded) {
        // console.log(`@@ Element ${element.label} is expanded: ${expanded}`);
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();
        // The test Cycles are not expandable anymore, but this code is left to be able to switch back to expandable cycles.
        // If the element is a test cycle and expanding it, initialize the test theme tree
        if (expanded) {
            await this.handleTestCycleClick(element);
        }
    }
    // Trigger initialization of test theme tree when a test cycle is clicked
    async handleTestCycleClick(testCycleItem) {
        // console.log(`Element ${testCycleItem.label} is clicked.`);
        if (testCycleItem.contextValue === "Cycle") {
            // Use the existing refresh or data loading function for initializing the test theme tree
            this.testThemeDataProvider.clearTree();
            this.testThemeDataProvider.setRoots(await this.getChildrenOfCycle(testCycleItem));
        }
    }
    clearTree() {
        this.testThemeDataProvider.clearTree();
        this.rootItem = null;
        this.refresh();
    }
}
exports.ProjectManagementTreeDataProvider = ProjectManagementTreeDataProvider;
// Function to find the serial key of the project of a cycle element in the tree hierarchy
function findProjectKeyOfCycleElement(element) {
    if (element.contextValue !== "Cycle") {
        // console.error("Element is not a cycle.");
        extension_1.logger.error("Element is not a cycle (findProjectKeyOfCycleElement).");
        return undefined;
    }
    let currentElement = element;
    while (currentElement) {
        if (currentElement.contextValue === "Project") {
            return currentElement.item.key;
        }
        currentElement = currentElement.parent;
    }
    // console.error("Project key not found.");
    extension_1.logger.error("Project key not found (findProjectKeyOfCycleElement).");
    return undefined;
}
// Function to find the serial key of the project of a cycle element in the tree hierarchy
function findCycleKeyOfTreeElement(element) {
    /*
    if ((element.contextValue !== "TestThemeNode") && (element.contextValue !== "TestCaseSetNode")) {
        console.error("Invalid tree element type.");
        return undefined;
    }*/
    let currentElement = element;
    while (currentElement) {
        if (currentElement.contextValue === "Cycle") {
            return currentElement?.item?.key;
        }
        currentElement = currentElement?.parent;
    }
    // console.error("Cycle key not found.");
    extension_1.logger.error("Cycle key not found (findCycleKeyOfTreeElement).");
    return undefined;
}
// Represents a tree item (Project, TOV, Cycle, etc) in the tree view
class TestbenchTreeItem extends vscode.TreeItem {
    item;
    parent;
    children;
    statusOfTreeItem;
    constructor(label, contextValue, // The type of the tree item (Project, TOV, Cycle etc.)
    collapsibleState, item, // The original data of the tree item
    parent = null) {
        super(label, collapsibleState);
        this.item = item;
        this.contextValue = contextValue;
        this.parent = parent;
        this.updateIcon();
        this.statusOfTreeItem = item.exec?.status || item.status || "None"; // (Active, Planned, Finished, Closed etc.)
        // Set the tooltip based on the context value
        // Tooltip for project, TOV, cycle: Type, Name, Status, Key
        if (contextValue === "Project" || contextValue === "Version" || contextValue === "Cycle") {
            this.tooltip = `Type: ${contextValue}, Name: ${item.name}, Status: ${this.statusOfTreeItem}, Key: ${item.key}`;
        }
        // Tooltip for test theme, test case set, test case: Numbering, Type, Name, Status, ID
        else if (contextValue === "TestThemeNode" ||
            contextValue === "TestCaseSetNode" ||
            contextValue === "TestCaseNode") {
            if (item?.base?.numbering) {
                this.tooltip = `Numbering: ${item.base.numbering}, Type: ${item.elementType}, Name: ${item.base.name}, Status: ${this.statusOfTreeItem}, ID: ${item.base.uniqueID}`;
            }
        }
    }
    getIconPath() {
        const iconFolderPath = path.join(__dirname, "..", "resources", "icons");
        const statusOfTreeItem = this.item.status || "default"; // (Active, Planned, Finished, Closed etc.)
        const treeItemType = this.contextValue; // (Project, TOV, Cycle etc.)
        // Map the context and status to the corresponding icon file name
        const iconMap = {
            Project: {
                active: "projects.svg",
                planned: "projects.svg",
                finished: "projects.svg",
                closed: "projects.svg",
                default: "projects.svg",
            },
            Version: {
                active: "TOV-specification.svg",
                planned: "TOV-specification.svg",
                finished: "TOV-specification.svg",
                closed: "TOV-specification.svg",
                default: "TOV-specification.svg",
            },
            Cycle: {
                active: "Cycle-execution.svg",
                planned: "Cycle-execution.svg",
                finished: "Cycle-execution.svg",
                closed: "Cycle-execution.svg",
                default: "Cycle-execution.svg",
            },
            TestThemeNode: {
                default: "TestThemeOriginal.svg",
            },
            TestCaseSetNode: {
                default: "TestCaseSetOriginal.svg",
            },
            TestCaseNode: {
                default: "TestCase.svg",
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
exports.TestbenchTreeItem = TestbenchTreeItem;
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
    projectManagementTreeView.onDidExpandElement(async (event) => {
        await projectManagementDataProvider.handleExpansion(event.element, true);
    });
    projectManagementTreeView.onDidCollapseElement(async (event) => {
        await projectManagementDataProvider.handleExpansion(event.element, false);
    });
    // Handle click events to trigger test theme tree initialization on test cycle click
    projectManagementTreeView.onDidChangeSelection(async (event) => {
        //  Retrieve the currently selected element in the tree view
        const selectedElement = event.selection[0];
        if (selectedElement && selectedElement.contextValue === "Cycle") {
            await projectManagementDataProvider.handleTestCycleClick(selectedElement);
        }
    });
    context.subscriptions.push(testThemeTreeView);
    testThemeDataProvider.refresh();
    return [projectManagementDataProvider, testThemeDataProvider];
}
//# sourceMappingURL=projectManagementTreeView.js.map