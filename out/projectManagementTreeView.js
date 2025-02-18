"use strict";
/**
 * @file projectManagementTreeView.ts
 * @description Provides the data provider and view management for the project management tree and test theme tree.
 * Project management tree displays the selected project and its test object versions and cycles.
 * Upon clicking on a test cycle element in project management tree, a test theme tree view is created under the project tree view
 * and the children elements of the test cycle (test themes and test case sets) are displayed in the test theme tree.
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
exports.ProjectManagementTreeItem = exports.ProjectManagementTreeDataProvider = exports.testThemeTreeView = exports.projectManagementDataProvider = exports.projectManagementTreeView = void 0;
exports.getProjectManagementTreeView = getProjectManagementTreeView;
exports.setProjectManagementTreeView = setProjectManagementTreeView;
exports.getProjectManagementDataProvider = getProjectManagementDataProvider;
exports.setProjectManagementDataProvider = setProjectManagementDataProvider;
exports.getTestThemeTreeView = getTestThemeTreeView;
exports.setTestThemeTreeView = setTestThemeTreeView;
exports.findProjectKeyOfCycleElement = findProjectKeyOfCycleElement;
exports.findCycleKeyOfTreeElement = findCycleKeyOfTreeElement;
exports.initializeTreeViews = initializeTreeViews;
exports.hideProjectManagementTreeView = hideProjectManagementTreeView;
exports.displayProjectManagementTreeView = displayProjectManagementTreeView;
exports.hideTestThemeTreeView = hideTestThemeTreeView;
exports.toggleProjectManagementTreeViewVisibility = toggleProjectManagementTreeViewVisibility;
exports.toggleTestThemeTreeViewVisibility = toggleTestThemeTreeViewVisibility;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const testThemeTreeView_1 = require("./testThemeTreeView");
const extension_1 = require("./extension");
// Global references to the tree views and data provider with getters and setters.
exports.projectManagementTreeView = null;
function getProjectManagementTreeView() {
    return exports.projectManagementTreeView;
}
function setProjectManagementTreeView(view) {
    exports.projectManagementTreeView = view;
}
exports.projectManagementDataProvider = null;
function getProjectManagementDataProvider() {
    return exports.projectManagementDataProvider;
}
function setProjectManagementDataProvider(provider) {
    exports.projectManagementDataProvider = provider;
}
exports.testThemeTreeView = null;
function getTestThemeTreeView() {
    return exports.testThemeTreeView;
}
function setTestThemeTreeView(view) {
    exports.testThemeTreeView = view;
}
/**
 * ProjectManagementTreeDataProvider
 * Implements the VS Code TreeDataProvider interface to display the selected project and its test object versions and cycles.
 * When a test cycle element is clicked, its children (test themes and test case sets) are offloaded to the test theme tree view.
 */
class ProjectManagementTreeDataProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    // The root item (a project) of the project management tree view.
    rootItem = null;
    // The project key currently in view.
    currentProjectKeyInView;
    // The test theme tree data provider used to display test themes.
    testThemeDataProvider;
    // Store keys of expanded nodes to restore expansion state of collapsible elements after the refresh button is clicked.
    expandedTreeItems = new Set();
    /**
     * Constructs a new ProjectManagementTreeDataProvider.
     *
     * @param projectKey Optional project key.
     * @param testThemeDataProvider Optional test theme tree data provider.
     */
    constructor(projectKey, testThemeDataProvider) {
        this.currentProjectKeyInView = projectKey ?? null;
        this.testThemeDataProvider = testThemeDataProvider;
    }
    /**
     * Refreshes the tree view.
     */
    refresh() {
        extension_1.logger.trace("Refreshing project management tree view.");
        this.storeExpandedTreeItems(this.rootItem);
        this.rootItem = null;
        this._onDidChangeTreeData.fire();
    }
    /**
     * Recursively stores the keys of expanded tree items.
     * Used to restore expansion state of collapsible elements after the refresh button is clicked.
     *
     * @param element The tree item to store.
     */
    storeExpandedTreeItems(element) {
        if (element) {
            if (element.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
                this.expandedTreeItems.add(element.item.key);
            }
            // Recursively check child elements
            if (element.children) {
                element.children.forEach((child) => this.storeExpandedTreeItems(child));
            }
        }
    }
    /**
     * Returns the parent of a given tree item.
     *
     * @param element The tree item.
     * @returns The parent tree item or null.
     */
    getParent(element) {
        return element.parent;
    }
    /**
     * Creates a TestbenchTreeItem from raw JSON data.
     *
     * @param jsonData The raw JSON data.
     * @param parent The parent tree item.
     * @param isRoot Indicates if this item is the root.
     * @returns A new TestbenchTreeItem or null.
     */
    createTreeItem(jsonData, parent, isRoot = false) {
        if (!jsonData) {
            return null;
        }
        // Use the nodeType from the json data as contextValue.
        // contextValue can be one of these types, which can be found in the response from the server:
        // Project, Version, Cycle, TestThemeNode, TestCaseSetNode, TestCaseNode
        const contextValue = jsonData.nodeType;
        // For Cycle elements, we set collapsibleState to None since children of test cycles are shown in the Test Theme Tree.
        const collapsibleState = contextValue === "Cycle" ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed;
        const treeItem = new ProjectManagementTreeItem(jsonData.name, contextValue, collapsibleState, jsonData, parent);
        // Restore expansion state (after a refresh) if the node was previously expanded.
        // Cycles are not expandable in tree view, so only expand other elements.
        if (this.expandedTreeItems.has(treeItem.item.key) && contextValue !== "Cycle") {
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }
        return treeItem;
    }
    /**
     * Gets the children of a given tree item.
     * If no element is provided, it returns the root project.
     * Called when the tree view is first loaded or refreshed.
     *
     * @param element Optional parent tree item.
     * @returns A promise that resolves to an array of TestbenchTreeItems.
     */
    async getChildren(element) {
        if (!extension_1.connection) {
            return [];
        }
        if (!element) {
            // If a root item is set, return its children
            if (this.rootItem) {
                return await this.getChildren(this.rootItem);
            }
            // No parent provided; load the root project.
            const projectTree = await extension_1.connection.getProjectTreeOfProject(this.currentProjectKeyInView);
            const rootItem = this.createTreeItem(projectTree, null, true);
            return rootItem ? [rootItem] : [];
        }
        if (element.contextValue === "Cycle") {
            // When a cycle is clicked, clear the old test theme tree and offload cycle's children to the test theme tree view.
            this.testThemeDataProvider.clearTree();
            this.testThemeDataProvider.setRoots(await this.getChildrenOfCycle(element));
            return []; // Return an empty array to prevent expansion in the Project Management Tree
        }
        else if (element.children) {
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
    /**
     * Fetches the sub-elements of a cycle element and builds the test theme tree.
     *
     * @param element The cycle tree item.
     * @returns A promise that resolves to an array of TestbenchTreeItems.
     */
    async getChildrenOfCycle(element) {
        extension_1.logger.trace("Fetching children of cycle element:", element.label);
        const cycleKey = element.item.key;
        const projectKey = findProjectKeyOfCycleElement(element);
        if (!projectKey) {
            extension_1.logger.warn("Project key of cycle not found (getChildrenOfCycle).");
            return [];
        }
        if (!extension_1.connection) {
            extension_1.logger.warn("No connection available (getChildrenOfCycle).");
            return [];
        }
        const cycleData = await extension_1.connection.fetchCycleStructureOfCycleInProject(projectKey, cycleKey);
        // If the cycle has no sub-elements, return an empty array
        if (!cycleData || !cycleData.nodes?.length) {
            extension_1.logger.warn("Cycle has no sub-elements (getChildrenOfCycle).");
            return [];
        }
        // Create a map to store elements by their key. A key identifies an element uniquely.
        const elementsByKey = new Map();
        cycleData.nodes.forEach((data) => {
            elementsByKey.set(data.base.key, data);
        });
        // Recursively build the tree starting from a given parent cycle key.
        const buildTestThemeTree = (parentCycleKey) => {
            return (Array.from(elementsByKey.values())
                // Filter elements that have the current parentKey and are not TestCaseNode elements
                .filter((data) => data.base.parentKey === parentCycleKey && data.elementType !== "TestCaseNode")
                // Filter out non-executable elements and elements that are locked by the system
                .filter((data) => data.exec?.status !== "NotPlanned" && data.exec?.locker?.key !== "-2")
                .map((data) => {
                const hasChildren = Array.from(elementsByKey.values()).some((childData) => childData.base.parentKey === data.base.key);
                const treeItem = new ProjectManagementTreeItem(`${data.base.numbering} ${data.base.name}`, data.elementType, 
                // TestCaseSetNode are the last level of the tree, so they are not collapsible.
                // Only show the expand icon if the element has children.
                data.elementType === "TestCaseSetNode"
                    ? vscode.TreeItemCollapsibleState.None
                    : hasChildren
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None, data, element);
                // Maintain expansion state after a refresh if the element was expanded before
                if (this.expandedTreeItems.has(treeItem.item.key)) {
                    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                }
                // If the current element has children, recursively build their tree items
                if (hasChildren) {
                    treeItem.children = buildTestThemeTree(data.base.key);
                }
                return treeItem;
            }));
        };
        const rootCycleKey = cycleData.root.base.key;
        // Build the tree starting from the root key
        const childrenOfCycle = buildTestThemeTree(rootCycleKey);
        // Assign the built children to the current element
        element.children = childrenOfCycle;
        // Display the test theme tree view if not already displayed
        await vscode.commands.executeCommand("testThemeTree.focus");
        // Update the title of the test theme tree view
        if (exports.testThemeTreeView) {
            exports.testThemeTreeView.title = `Test Theme Tree (${element.label})`;
        }
        return childrenOfCycle;
    }
    /**
     * Returns a TreeItem representation for the given element.
     *
     * @param element The tree item.
     * @returns The tree item.
     */
    getTreeItem(element) {
        return element;
    }
    /**
     * Sets the selected tree item as the root and refreshes the tree.
     *
     * @param treeItem The tree item to set as root.
     */
    makeRoot(treeItem) {
        extension_1.logger.trace("Setting selected element as root:", treeItem);
        this.rootItem = treeItem;
        this.refresh();
    }
    /**
     * Handles expansion and collapse of a tree item.
     *
     * @param element The tree item.
     * @param expanded True if the item is expanded, false otherwise.
     */
    async handleExpansion(element, expanded) {
        extension_1.logger.trace(`Setting expansion state of ${element.label} to ${expanded ? "expanded" : "collapsed"}.`);
        element.collapsibleState = expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed;
        element.updateIcon();
        // Store the expanded nodes to restore the expansion state after refreshing the tree
        if (expanded) {
            this.expandedTreeItems.add(element.item.key);
        }
        else {
            this.expandedTreeItems.delete(element.item.key);
        }
        // The test Cycles are not expandable anymore, but this code is left to be able to switch back to expandable cycles.
        // If the element is a test cycle, expanding it initializes the test theme tree
        if (expanded) {
            await this.handleTestCycleClick(element);
        }
    }
    /**
     * Handles a click on a test cycle element to initialize the test theme tree.
     *
     * @param treeItem The clicked tree item.
     */
    async handleTestCycleClick(treeItem) {
        extension_1.logger.trace("Handling test cycle click for:", treeItem.label);
        if (treeItem.contextValue === "Cycle") {
            this.testThemeDataProvider.clearTree();
            this.testThemeDataProvider.setRoots(await this.getChildrenOfCycle(treeItem));
        }
    }
    /**
     * Clears the entire project management tree.
     */
    clearTree() {
        extension_1.logger.trace("Clearing project management tree.");
        if (this.testThemeDataProvider) {
            this.testThemeDataProvider.clearTree();
        }
        this.rootItem = null;
        this.refresh();
    }
}
exports.ProjectManagementTreeDataProvider = ProjectManagementTreeDataProvider;
/**
 * Finds the project key (serial) for a given cycle element by traversing upward in the tree hierarchy.
 *
 * @param element The cycle tree item.
 * @returns The project key if found; otherwise null.
 */
function findProjectKeyOfCycleElement(element) {
    extension_1.logger.trace("Finding project key for cycle element:", element.label);
    if (element.contextValue !== "Cycle") {
        extension_1.logger.error("Element is not a cycle; cannot find project key.");
        return null;
    }
    let current = element;
    while (current) {
        if (current.contextValue === "Project") {
            return current.item.key;
        }
        current = current.parent;
    }
    extension_1.logger.error("Project key not found in tree hierarchy.");
    return null;
}
/**
 * Finds the cycle key (serial) for a given tree element by traversing upward in the tree hierarchy.
 *
 * @param element The tree item.
 * @returns The cycle key if found; otherwise null.
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
    extension_1.logger.error("Cycle key not found in tree element.");
    return null;
}
// TODO: The name ProjectManagementTreeItem is not quite right since this is also used for test theme tree items.
/**
 * Represents a tree item (Project, TOV, Cycle, TestThemeNode, TestCaseSetNode, etc.) in the tree view.
 */
class ProjectManagementTreeItem extends vscode.TreeItem {
    item;
    parent;
    children;
    statusOfTreeItem;
    /**
     * Constructs a new TestbenchTreeItem.
     *
     * @param label The label to display.
     * @param contextValue The type of the tree item.
     * @param collapsibleState The initial collapsible state.
     * @param item The original data of the tree item.
     * @param parent The parent tree item.
     */
    constructor(label, contextValue, collapsibleState, item, parent = null) {
        super(label, collapsibleState);
        this.item = item;
        this.contextValue = contextValue;
        this.parent = parent;
        this.updateIcon();
        this.statusOfTreeItem = item.exec?.status || item.status || "None"; // Possible values: Active, Planned, Finished, Closed, etc.
        // Set the tooltip based on the context value.
        // Tooltip for project, TOV and cycle elements looks like this: Type, Name, Status, Key
        if (contextValue === "Project" || contextValue === "Version" || contextValue === "Cycle") {
            this.tooltip = `Type: ${contextValue}\nName: ${item.name}\nStatus: ${this.statusOfTreeItem}\nKey: ${item.key}`;
        }
        // Tooltip for test theme, test case set and test case looks like this: Numbering, Type, Name, Status, ID
        else if (contextValue === "TestThemeNode" ||
            contextValue === "TestCaseSetNode" ||
            contextValue === "TestCaseNode") {
            if (item?.base?.numbering) {
                this.tooltip = `Numbering: ${item.base.numbering}\nType: ${item.elementType}\nName: ${item.base.name}\nStatus: ${this.statusOfTreeItem}\nID: ${item.base.uniqueID}`;
            }
        }
    }
    /**
     * Determines the icon path for the tree item based on its type and status.
     * Currently this is not used fully, but it allows to have different icons for different statuses of the tree items like the TestBench Client.
     *
     * @returns The absolute path to the icon file.
     */
    getIconPath() {
        const iconFolderPath = path.join(__dirname, "..", "resources", "icons");
        const status = this.item.status || "default"; // (Active, Planned, Finished, Closed etc.)
        const type = this.contextValue; // (Project, TOV, Cycle etc.)
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
                default: "TBU_Logo_cropped.svg",
            },
        };
        const typeIcons = iconMap[type] || iconMap["default"];
        const iconFileName = typeIcons[status] || typeIcons["default"] || iconMap.default.default;
        return path.join(iconFolderPath, iconFileName);
    }
    /**
     * Updates the tree item's icon.
     */
    updateIcon() {
        this.iconPath = this.getIconPath();
    }
}
exports.ProjectManagementTreeItem = ProjectManagementTreeItem;
/**
 * Initializes the project management tree view and test theme tree view.
 *
 * @param context The VS Code extension context.
 * @param connection The active TestBench connection.
 * @param selectedProjectKey Optional project key.
 * @returns A promise resolving with an array containing the project management and test theme data providers.
 */
async function initializeTreeViews(context, connection, selectedProjectKey) {
    extension_1.logger.trace("Initializing project management and test theme tree views.");
    if (!connection) {
        const msg = "No connection available. Please log in first.";
        vscode.window.showErrorMessage(msg);
        extension_1.logger.error(msg);
        return [null, null];
    }
    const testThemeDataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider();
    exports.testThemeTreeView = vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: testThemeDataProvider,
    });
    exports.projectManagementDataProvider = new ProjectManagementTreeDataProvider(selectedProjectKey, testThemeDataProvider);
    (0, extension_1.setProjectTreeView)(vscode.window.createTreeView("projectManagementTree", {
        treeDataProvider: exports.projectManagementDataProvider,
    }));
    // Handle expand/collapse events to update expansion state and icons dynamically.
    extension_1.projectTreeView.onDidExpandElement(async (event) => {
        await exports.projectManagementDataProvider.handleExpansion(event.element, true);
    });
    extension_1.projectTreeView.onDidCollapseElement(async (event) => {
        await exports.projectManagementDataProvider.handleExpansion(event.element, false);
    });
    // Handle selection changes (click events) to trigger test theme tree initialization on cycle click.
    extension_1.projectTreeView.onDidChangeSelection(async (event) => {
        //  Retrieve the currently selected element in the tree view
        const selectedElement = event.selection[0];
        if (selectedElement && selectedElement.contextValue === "Cycle") {
            await exports.projectManagementDataProvider.handleTestCycleClick(selectedElement);
        }
    });
    context.subscriptions.push(exports.testThemeTreeView);
    testThemeDataProvider.refresh();
    // Display the project management tree view if not displayed already
    await vscode.commands.executeCommand("projectManagementTree.focus");
    // Return both data providers
    return [exports.projectManagementDataProvider, testThemeDataProvider];
}
/**
 * Hides the project management tree view.
 */
async function hideProjectManagementTreeView() {
    // projectManagementTree is the ID of the tree view in package.json
    await vscode.commands.executeCommand("projectManagementTree.removeView");
}
/**
 * Displays the project management tree view.
 */
async function displayProjectManagementTreeView() {
    await vscode.commands.executeCommand("projectManagementTree.focus");
}
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
/**
 * Toggles the visibility of the project management tree view.
 */
async function toggleProjectManagementTreeViewVisibility() {
    extension_1.logger.debug("Toggling project management tree view visibility.");
    if (exports.projectManagementTreeView) {
        if (exports.projectManagementTreeView.visible) {
            extension_1.logger.trace("Project tree view is visible. Hiding it.");
            await hideProjectManagementTreeView();
            extension_1.logger.trace("Project tree view is now hidden.");
        }
        else {
            extension_1.logger.trace("Project tree view is hidden. Displaying it.");
            await displayProjectManagementTreeView();
            extension_1.logger.trace("Project tree view is now displayed.");
        }
    }
}
/**
 * Toggles the visibility of the test theme tree view.
 */
async function toggleTestThemeTreeViewVisibility() {
    extension_1.logger.debug("Toggling test theme tree view visibility.");
    if (exports.testThemeTreeView) {
        if (exports.testThemeTreeView.visible) {
            extension_1.logger.trace("Test theme tree view is visible. Hiding it.");
            await hideTestThemeTreeView();
            extension_1.logger.trace("Test theme tree view is now hidden.");
        }
        else {
            extension_1.logger.trace("Test theme tree view is hidden. Displaying it.");
            await displayTestThemeTreeView();
            extension_1.logger.trace("Test theme tree view is now displayed.");
        }
    }
}
//# sourceMappingURL=projectManagementTreeView.js.map