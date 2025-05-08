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
exports.ProjectManagementTreeItem = exports.ProjectManagementTreeDataProvider = exports.testThemeTreeView = exports.projectManagementTreeView = void 0;
exports.getProjectManagementTreeView = getProjectManagementTreeView;
exports.setProjectManagementTreeView = setProjectManagementTreeView;
exports.getTestThemeTreeView = getTestThemeTreeView;
exports.setTestThemeTreeView = setTestThemeTreeView;
exports.findProjectKeyOfCycleElement = findProjectKeyOfCycleElement;
exports.findProjectKeyOfProjectTreeItem = findProjectKeyOfProjectTreeItem;
exports.findCycleKeyOfTreeElement = findCycleKeyOfTreeElement;
exports.initializeProjectAndTestThemeTrees = initializeProjectAndTestThemeTrees;
exports.hideProjectManagementTreeView = hideProjectManagementTreeView;
exports.displayProjectManagementTreeView = displayProjectManagementTreeView;
exports.hideTestThemeTreeView = hideTestThemeTreeView;
exports.toggleProjectManagementTreeViewVisibility = toggleProjectManagementTreeViewVisibility;
exports.toggleTestThemeTreeViewVisibility = toggleTestThemeTreeViewVisibility;
exports.findProjectKeyForElement = findProjectKeyForElement;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const testThemeTreeView_1 = require("./testThemeTreeView");
const extension_1 = require("./extension");
const extension_2 = require("./extension");
const constants_1 = require("./constants");
const testElementsTreeView_1 = require("./testElementsTreeView");
// Global references to the tree views and data provider with getters and setters.
exports.projectManagementTreeView = null;
function getProjectManagementTreeView() {
    return exports.projectManagementTreeView;
}
function setProjectManagementTreeView(view) {
    exports.projectManagementTreeView = view;
}
exports.testThemeTreeView = null;
function getTestThemeTreeView() {
    return exports.testThemeTreeView;
}
function setTestThemeTreeView(view) {
    exports.testThemeTreeView = view;
}
/**
 * Provides data for the project management tree view.
 * This tree view displays the selected project, its test object versions, and cycles.
 * When a test cycle element is clicked, its children (test themes and test case sets) are offloaded to the test theme tree view.
 */
class ProjectManagementTreeDataProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    // The test theme tree data provider used to display test themes.
    testThemeDataProvider;
    setTestThemeDataProvider(provider) {
        this.testThemeDataProvider = provider;
    }
    // Store keys of expanded nodes to restore expansion state of collapsible elements after a refresh.
    expandedTreeItems = new Set();
    /**
     * Constructs a new ProjectManagementTreeDataProvider.
     *
     * @param {TestThemeTreeDataProvider} testThemeDataProvider Optional test theme tree data provider.
     */
    constructor(testThemeDataProvider) {
        this.testThemeDataProvider = testThemeDataProvider;
    }
    /**
     * Refreshes the tree view.
     */
    refresh() {
        extension_1.logger.debug("Refreshing project management tree view.");
        this._onDidChangeTreeData.fire(undefined); // Fire with undefined to refresh from the root
        extension_1.logger.trace("Project management tree view refreshed.");
    }
    /**
     * Returns the parent of a given tree item.
     *
     * @param {ProjectManagementTreeItem} element The tree item.
     * @returns {ProjectManagementTreeItem | null} The parent tree item or null.
     */
    getParent(element) {
        return element.parent;
    }
    /**
     * Creates a TestbenchTreeItem from raw JSON data.
     *
     * @param {any} jsonData The raw JSON data.
     * @param {string} explicitContextValue An explicit context value if jsonData.nodeType is not reliable.
     * @param {ProjectManagementTreeItem | null} parent The parent tree item.
     * @returns {ProjectManagementTreeItem | null} A new TestbenchTreeItem or null.
     */
    createTreeItem(jsonData, explicitContextValue, parent) {
        if (!jsonData || !jsonData.key || !jsonData.name) {
            // Check for required properties for a valid tree item
            extension_1.logger.warn("Attempted to create tree item with invalid jsonData:", jsonData);
            return null;
        }
        // Extract key, name, and other base data
        let itemKey; // Key is also used for tracking expansion state
        let itemName;
        let itemBaseData; // To hold the object containing key/name
        if (explicitContextValue === constants_1.TreeItemContextValues.TEST_THEME_NODE ||
            explicitContextValue === constants_1.TreeItemContextValues.TEST_CASE_SET_NODE ||
            explicitContextValue === constants_1.TreeItemContextValues.TEST_CASE_NODE) {
            // Data comes from fetchCycleStructureOfCycleInProject.
            itemBaseData = jsonData;
            if (!itemBaseData) {
                extension_1.logger.warn("Tree item data missing 'base' property:", jsonData);
                return null;
            }
            itemKey = itemBaseData.key;
            itemName = itemBaseData.name;
            // Check if key or name are missing AFTER trying to access them
            if (!itemKey || itemName === undefined) {
                extension_1.logger.warn(`Attempted to create tree item with missing key or name. Key: ${itemKey}, Name: ${itemName}`, itemBaseData);
                return null;
            }
            // Adjust label specifically for these types if numbering exists
            if (itemBaseData.numbering) {
                itemName = `${itemBaseData.numbering} ${itemBaseData.name}`;
            }
        }
        else {
            // Data comes from getProjectTreeOfProject or getProjectsList
            itemBaseData = jsonData;
            itemKey = jsonData.key;
            itemName = jsonData.name;
        }
        // Check if needed properties were found
        if (!itemKey || itemName === undefined) {
            // Check itemName for undefined specifically
            extension_1.logger.warn(`Attempted to create tree item with missing key or name. Key: ${itemKey}, Name: ${itemName}`, itemBaseData);
            return null;
        }
        // contextValue can be one of these types, which can be found in the response from the server:
        // Project, Version, Cycle, TestThemeNode, TestCaseSetNode, TestCaseNode
        const contextValue = explicitContextValue;
        const label = itemName; // Use the extracted name/label
        // Cycle elements are not collapsible since children of test cycles are shown in the Test Theme Tree.
        // Determine default collapsible state based on type and potential children
        let defaultCollapsibleState;
        if (contextValue === constants_1.TreeItemContextValues.CYCLE) {
            defaultCollapsibleState = vscode.TreeItemCollapsibleState.None; // Cycles offload children
        }
        else if (contextValue === constants_1.TreeItemContextValues.PROJECT) {
            // Projects are collapsible if they have TOVs or Cycles reported by the API
            const hasPotentialChildren = (jsonData.tovsCount && jsonData.tovsCount > 0) || (jsonData.cyclesCount && jsonData.cyclesCount > 0);
            defaultCollapsibleState = hasPotentialChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
        }
        else if (contextValue === constants_1.TreeItemContextValues.VERSION) {
            // TOVs are collapsible if they have children (Cycles) in the TreeNode structure
            defaultCollapsibleState =
                jsonData.children && jsonData.children.length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
        }
        else {
            // Default fallback for other types
            defaultCollapsibleState = vscode.TreeItemCollapsibleState.None;
        }
        const treeItem = new ProjectManagementTreeItem(label, contextValue, 
        // Initially set to the default state determined above
        defaultCollapsibleState, jsonData, parent);
        // Restore Expansion State
        // Check if this item's key was previously expanded
        if (this.expandedTreeItems.has(itemKey) && defaultCollapsibleState !== vscode.TreeItemCollapsibleState.None) {
            // If it was expanded, override the default state to Expanded
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            extension_1.logger.trace(`Restoring expanded state for item: ${label} (Key: ${itemKey})`);
        }
        // Update tooltip and description after creation
        if (contextValue === constants_1.TreeItemContextValues.PROJECT ||
            contextValue === constants_1.TreeItemContextValues.VERSION ||
            contextValue === constants_1.TreeItemContextValues.CYCLE) {
            treeItem.tooltip = `Type: ${contextValue}\nName: ${treeItem.item.name}\nStatus: ${treeItem.statusOfTreeItem}\nKey: ${treeItem.item.key}`;
            if (contextValue === constants_1.TreeItemContextValues.PROJECT) {
                treeItem.tooltip += `\nTOVs: ${treeItem.item.tovsCount || 0}\nCycles: ${treeItem.item.cyclesCount || 0}`;
            }
        }
        else if (itemBaseData &&
            (contextValue === constants_1.TreeItemContextValues.TEST_THEME_NODE ||
                contextValue === constants_1.TreeItemContextValues.TEST_CASE_SET_NODE ||
                contextValue === constants_1.TreeItemContextValues.TEST_CASE_NODE)) {
            // Use itemBaseData for these types
            treeItem.tooltip = `Type: ${contextValue}\nName: ${itemBaseData.name}\nStatus: ${treeItem.statusOfTreeItem}\nID: ${itemBaseData.uniqueID}`;
            if (itemBaseData.numbering) {
                treeItem.tooltip = `Numbering: ${itemBaseData.numbering}\n${treeItem.tooltip}`;
            }
            treeItem.description = itemBaseData.uniqueID || "";
        }
        return treeItem;
    }
    /**
     * Gets the children of a given tree item.
     * If no element is provided, it returns the root project.
     * Called when the tree view is first loaded or refreshed.
     *
     * @param {ProjectManagementTreeItem} element Optional parent tree item.
     * @returns {Promise<ProjectManagementTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    async getChildren(element) {
        if (!extension_1.connection) {
            // If no connection is available, return a placeholder item.
            return [
                new ProjectManagementTreeItem("Not connected to TestBench", "error.notConnected", vscode.TreeItemCollapsibleState.None, {}, null)
            ];
        }
        try {
            // Fetch Root Projects
            if (!element) {
                // Root level: Fetch and display all projects
                extension_1.logger.debug("Fetching all projects for the root of Project Management Tree.");
                const projectList = await extension_1.connection.getProjectsList();
                if (projectList && projectList.length > 0) {
                    // If projects are found, map each project data to a ProjectManagementTreeItem
                    // createTreeItem handles expansion state.
                    return projectList
                        .map((project) => 
                    // Create item for Project: pass project data, explicit context, and null parent.
                    this.createTreeItem(project, constants_1.TreeItemContextValues.PROJECT, null))
                        .filter((item) => item !== null); // Filter out any null items if creation failed.
                }
                else if (projectList) {
                    // Empty list
                    extension_1.logger.debug("No projects found on the server.");
                    return [
                        new ProjectManagementTreeItem("No projects found", "info.noProjects", vscode.TreeItemCollapsibleState.None, {}, null)
                    ];
                }
                else {
                    // Error during fetch, return placeholder
                    extension_1.logger.error("Failed to fetch project list from the server.");
                    return [
                        new ProjectManagementTreeItem("Error fetching projects", "error.fetchProjects", vscode.TreeItemCollapsibleState.None, {}, null)
                    ];
                }
            }
            // Children of a Project item (Test Object Versions)
            if (element.contextValue === constants_1.TreeItemContextValues.PROJECT) {
                extension_1.logger.debug(`Fetching children (TOVs) for project: ${element.label}`);
                const projectKey = element.item.key; // element.item is testBenchTypes.Project
                if (!projectKey) {
                    extension_1.logger.error(`Project key is missing for project item: ${element.label}`);
                    return [];
                }
                // Fetch the detailed tree for this project, which contains TOVs as children
                const projectTree = await extension_1.connection.getProjectTreeOfProject(projectKey);
                // Check if the project tree and its children (TOVs) exist.
                if (projectTree && projectTree.children && projectTree.children.length > 0) {
                    return projectTree.children
                        .map((tovNode // tovNode is testBenchTypes.TreeNode
                    ) => 
                    // Pass `element` as the parent
                    this.createTreeItem(tovNode, tovNode.nodeType, element) // tovNode.nodeType should be "Version"
                    )
                        .filter((item) => item !== null);
                }
                extension_1.logger.debug(`No children (TOVs) found for project: ${element.label}`);
                return [];
            }
            // Children of a TOV (Cycles)
            if (element.contextValue === constants_1.TreeItemContextValues.VERSION) {
                extension_1.logger.debug(`Fetching children (Cycles) for TOV: ${element.label}`);
                // element.item is testBenchTypes.TreeNode representing a TOV
                // Its children array contains the Cycle nodes.
                const cycleNodes = element.item.children ?? [];
                return cycleNodes
                    .map((cycleNode // cycleNode is a testBenchTypes.TreeNode
                ) => this.createTreeItem(cycleNode, cycleNode.nodeType, element) // cycleNode.nodeType should be "Cycle"
                )
                    .filter((item) => item !== null);
            }
            // Cycles do not show children directly in this tree; they are offloaded to TestThemeTree
            if (element.contextValue === constants_1.TreeItemContextValues.CYCLE) {
                extension_1.logger.trace(`Cycle node ${element.label} expanded in Project Tree. Offloading children to Test Theme Tree.`);
                // Offload children to TestThemeTree
                this.testThemeDataProvider.clearTree(); // Clear previous
                const childrenOfCycle = await this.getChildrenOfCycle(element); // Fetche and prepare children for TestThemeTree
                const cycleKey = element.item?.key;
                if (typeof cycleKey === 'string') {
                    this.testThemeDataProvider.setRoots(childrenOfCycle, cycleKey);
                }
                else {
                    extension_1.logger.error(`Cycle key not found for element ${element.label} in getChildren. Clearing test theme tree.`);
                    this.testThemeDataProvider.clearTree();
                }
                return []; // Return empty as children are in another tree
            }
            // Fallback for unexpected element types or elements with pre-loaded children.
            if (element.children) {
                extension_1.logger.warn(`Returning pre-loaded children for element: ${element.label}.`);
                return element.children;
            }
        }
        catch (error) {
            extension_1.logger.error(`Error in getChildren for element ${element?.label || "root"}:`, error);
            vscode.window.showErrorMessage(`Error fetching tree data: ${error instanceof Error ? error.message : "Unknown error"}`);
            return [
                new ProjectManagementTreeItem("Error loading children", "error.generic", vscode.TreeItemCollapsibleState.None, {}, null)
            ];
        }
        extension_1.logger.warn(`getChildren reached end without returning for element: ${element?.label}`);
        return []; // Default empty return
    }
    /**
     * Adds the key of an expanded element to the set used for state preservation.
     * Called by the tree view's onDidExpandElement listener.
     * @param {ProjectManagementTreeItem} element The element that was expanded.
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
     * @param {ProjectManagementTreeItem} element The element that was collapsed.
     */
    forgetExpandedItem(element) {
        if (element && element.item && element.item.key) {
            this.expandedTreeItems.delete(element.item.key);
            extension_1.logger.trace(`Forgot expanded item: ${element.label} (Key: ${element.item.key})`);
        }
    }
    /**
     * Fetches the sub-elements of a cycle element and builds the test theme tree.
     *
     * @param {ProjectManagementTreeItem} cycleElement The cycle tree item.
     * @returns {Promise<ProjectManagementTreeItem[]>} A promise that resolves to an array of TestbenchTreeItems.
     */
    async getChildrenOfCycle(cycleElement) {
        extension_1.logger.trace("Fetching children of cycle element:", cycleElement.label);
        // Ensure we are dealing with a Cycle element
        if (cycleElement.contextValue !== constants_1.TreeItemContextValues.CYCLE) {
            extension_1.logger.warn(`getChildrenOfCycle called on non-Cycle item: ${cycleElement.label}`);
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
        // If the cycle has no sub-elements, return a placeholder item.
        if (!cycleData || !cycleData.nodes?.length) {
            extension_1.logger.trace("Cycle has no sub-elements (getChildrenOfCycle).");
            // vscode.window.showErrorMessage("Failed to fetch data for the selected cycle.");
            return []; // Return empty, which will result in the placeholder in TestThemeTree
        }
        if (!cycleData.nodes || cycleData.nodes.length === 0 || !cycleData.root?.base?.key) {
            extension_1.logger.error(`Cycle structure for ${cycleElement.label} has no nodes or root key. Displaying placeholder.`);
            return [];
        }
        // Create a map to store elements by their key. A key identifies an element uniquely.
        const elementsByKey = new Map();
        cycleData.nodes.forEach((data) => {
            if (data?.base?.key) {
                elementsByKey.set(data.base.key, data);
            }
            else {
                // logger.warn("Found node without base.key in cycle structure:", data);
            }
        });
        if (elementsByKey.size === 0 && cycleData.nodes.length > 0) {
            extension_1.logger.error(`No nodes with base.key were found in the cycle structure data, cannot build tree.`);
            return []; // Cannot proceed if no nodes have keys for lookup
        }
        /**
         * Recursively builds the test theme tree starting from a given parent cycle key.
         * Processes nodes from the cycle structure, filters them,
         * creates corresponding tree items, and handles hierarchy and expansion state.
         *
         * @param {string} parentCycleKey - The key of the parent element whose children are being built.
         * @param {ProjectManagementTreeItem} parentTreeItem - The tree item representing the parent.
         * @returns {ProjectManagementTreeItem[]} An array of tree items representing the children for the Test Theme tree.
         */
        const buildTestThemeTree = (parentCycleKey, parentTreeItem) => {
            // Filter potential children
            // Get all nodes from the map, filter them based on parent key and type first.
            const potentialChildrenData = Array.from(elementsByKey.values()).filter((data) => 
            // Ensure node has base data and matches the parent key
            data?.base?.parentKey === parentCycleKey &&
                // Exclude test cases from this tree view
                data.elementType !== constants_1.TreeItemContextValues.TEST_CASE_NODE &&
                // Filter out non-executable elements and elements that are locked by the system
                data.exec?.status !== "NotPlanned" &&
                data.exec?.locker?.key !== "-2");
            // Map filtered data to Tree Items
            // Process each valid child node data to create a tree item.
            const childTreeItems = potentialChildrenData.map((data) => {
                // Determine if this node has its own valid children
                // Check if any node in the original map lists the current node's key as its parent,
                // meets the type criteria, and isn't filtered by status/locker.
                const hasVisibleChildren = Array.from(elementsByKey.values()).some((childData) => childData?.base?.parentKey === data.base.key &&
                    childData.elementType !== constants_1.TreeItemContextValues.TEST_CASE_NODE &&
                    childData.exec?.status !== "NotPlanned" &&
                    childData.exec?.locker?.key !== "-2");
                // Create the basic tree item
                // Call the main createTreeItem helper, passing the base data and explicit type.
                // It handles basic creation, label generation and context value.
                const treeItem = this.createTreeItem(data.base, // Pass the base data containing key, name, numbering etc.
                data.elementType, parentTreeItem // Pass the parent item for hierarchy
                );
                // If item creation failed, skip further processing
                if (!treeItem) {
                    return null;
                }
                // Store the full original data node onto the item if needed elsewhere
                treeItem.item = data;
                // Configure Collapsible State
                // Determine the state based on type and whether it has children.
                treeItem.collapsibleState =
                    data.elementType === constants_1.TreeItemContextValues.TEST_CASE_SET_NODE
                        ? vscode.TreeItemCollapsibleState.None // TestCaseSetNodes are leaves in this view
                        : hasVisibleChildren
                            ? vscode.TreeItemCollapsibleState.Collapsed // Expandable if it has valid children
                            : vscode.TreeItemCollapsibleState.None; // Not expandable otherwise
                // Restore Expansion State
                // Check if this item was previously expanded and override state if necessary.
                const itemKey = data.base.key; // Use the key from the base object
                if (itemKey &&
                    this.expandedTreeItems.has(itemKey) &&
                    treeItem.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                }
                // Recursively build children
                // If the current element has children, recursively call this function
                // to build the subtree for the next level.
                if (hasVisibleChildren) {
                    // Pass current treeItem as the new parent, use data.base.key for the next level's parent key
                    treeItem.children = buildTestThemeTree(data.base.key, treeItem);
                }
                else {
                    // Ensure children property is an empty array if no children
                    treeItem.children = [];
                }
                return treeItem; // Return the tree item
            });
            // Filter out nulls
            // Remove any null entries that might have resulted from failed item creation.
            return childTreeItems.filter((item) => item !== null);
        };
        const rootCycleKey = cycleData.root.base.key;
        // The parent for the first level of TestThemeTree items is the original cycleElement from ProjectManagementTree
        const childrenOfCycle = buildTestThemeTree(rootCycleKey, cycleElement);
        // Assign the built children to the current element
        cycleElement.children = childrenOfCycle;
        // Display the test theme tree view if not already displayed
        await displayTestThemeTreeView();
        // Update the title of the test theme tree view
        if (exports.testThemeTreeView) {
            exports.testThemeTreeView.title = `Test Themes (${cycleElement.label})`;
        }
        return childrenOfCycle;
    }
    /**
     * Returns a TreeItem representation for the given element.
     *
     * @param {ProjectManagementTreeItem} element The tree item.
     * @returns {vscode.TreeItem} The tree item.
     */
    getTreeItem(element) {
        return element;
    }
    /**
     * Sets the selected tree item as the root and refreshes the tree.
     *
     * @param {ProjectManagementTreeItem} treeItem The tree item to set as root.
     */
    makeRoot(treeItem) {
        extension_1.logger.debug("Setting selected element as a temporary root:", treeItem.label);
        this.refresh(); // re-trigger getChildren, which loads all projects.
    }
    /**
     * Handles expansion and collapse of a tree item.
     *
     * @param {ProjectManagementTreeItem} element The tree item.
     * @param {boolean} expanded True if the item is expanded, false otherwise.
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
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
        /*
        // The test Cycles are not expandable anymore, but this code is left to be able to switch back to expandable cycles.
        // If the element is a test cycle, expanding it initializes the test theme tree
        if (expanded) {
            await this.handleTestCycleClick(element);
        }
        */
    }
    /**
     * Handles a click on a test cycle element to initialize the test theme tree and the test elements tree.
     *
     * @param {ProjectManagementTreeItem} projectsTreeViewItem The clicked tree item in the projects tree view.
     * @returns {Promise<void>} A promise that resolves when the operation is complete.
     */
    async handleTestCycleClick(projectsTreeViewItem) {
        extension_1.logger.trace("Handling tree item click for:", projectsTreeViewItem.label);
        extension_1.logger.debug("ProjectManagementTreeDataProvider instance in handleTestCycleClick:", this);
        if (projectsTreeViewItem.contextValue !== constants_1.TreeItemContextValues.CYCLE) {
            extension_1.logger.error("Clicked tree item is not a cycle. Cannot proceed.");
            return;
        }
        const cycleKey = projectsTreeViewItem.item.key;
        // Skip if already viewing this cycle
        if (this.testThemeDataProvider.isCurrentCycle(cycleKey)) {
            return;
        }
        // Display a progress bar since this operation may take some time.
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Fetching data for cycle: ${projectsTreeViewItem.label}`,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: "Fetching test themes..." });
            extension_1.logger.trace("Clicked tree item is a cycle. Creating test theme tree view.");
            // Clear the test theme tree first
            this.testThemeDataProvider.clearTree();
            extension_2.testElementsTreeDataProvider.refresh([]);
            // Ensure activeProjectKeyInView is set based on the clicked cycle's project.
            const projectKey = findProjectKeyOfCycleElement(projectsTreeViewItem);
            if (!projectKey) {
                extension_1.logger.error("Could not determine project key for the clicked cycle. Aborting further actions.");
                vscode.window.showErrorMessage("Could not identify the project for the selected cycle.");
                return;
            }
            // Hide the project management tree view
            await hideProjectManagementTreeView();
            // Display the test theme tree view
            await displayTestThemeTreeView();
            // Display the test elements tree view
            await (0, testElementsTreeView_1.displayTestElementsTreeView)();
            progress.report({ increment: 20, message: "Fetching test themes..." });
            // Fetch new data for the test theme tree
            const childrenForTestThemeTree = await this.getChildrenOfCycle(projectsTreeViewItem);
            extension_1.logger.debug("TestThemeTreeDataProvider instance before setRoots:", this.testThemeDataProvider);
            this.testThemeDataProvider.setRoots(childrenForTestThemeTree, cycleKey);
            progress.report({ increment: 60, message: "Fetching test elements..." });
            // If the cycle has a parent of type TOV (Version), fetch and display test elements.
            if (projectsTreeViewItem.parent?.contextValue === constants_1.TreeItemContextValues.VERSION) {
                // Check parent context value
                const tovKeyOfSelectedCycleElement = projectsTreeViewItem.parent?.item?.key; // Get key from parent's item
                const tovLabel = typeof projectsTreeViewItem.parent?.label === "string"
                    ? projectsTreeViewItem.parent.label
                    : undefined;
                if (tovKeyOfSelectedCycleElement) {
                    extension_1.logger.trace(`Clicked cycle item has a parent TOV with key: ${tovKeyOfSelectedCycleElement}. Fetching test elements.`);
                    const areTestElementsFetched = await extension_2.testElementsTreeDataProvider.fetchAndDisplayTestElements(tovKeyOfSelectedCycleElement, tovLabel);
                    if (!areTestElementsFetched) {
                        (0, testElementsTreeView_1.clearTestElementsTreeView)();
                    }
                }
                else {
                    extension_1.logger.warn("Parent TOV key not found for the clicked cycle.");
                }
            }
            else {
                extension_1.logger.trace("Clicked cycle item does not have a direct TOV parent or parent information is missing.");
                (0, testElementsTreeView_1.clearTestElementsTreeView)();
            }
            progress.report({ increment: 100, message: "Data loaded." });
        });
    }
    /**
     * Clears the project management tree.
     */
    clearTree() {
        extension_1.logger.trace("Clearing project management tree.");
        if (this.testThemeDataProvider) {
            this.testThemeDataProvider.clearTree();
        }
        this.refresh();
    }
}
exports.ProjectManagementTreeDataProvider = ProjectManagementTreeDataProvider;
/**
 * Finds the project key (serial) for a given cycle element by traversing upward in the tree hierarchy.
 *
 * @param {ProjectManagementTreeItem} element The cycle tree item.
 * @returns {string | null} The project key as a string if found; otherwise null.
 */
function findProjectKeyOfCycleElement(element) {
    extension_1.logger.trace("Finding project key for cycle element:", element.label);
    if (element.contextValue !== constants_1.TreeItemContextValues.CYCLE) {
        extension_1.logger.error("Element is not a cycle; cannot find project key.");
        return null;
    }
    let current = element;
    while (current) {
        if (current.contextValue === constants_1.TreeItemContextValues.PROJECT) {
            extension_1.logger.trace("Found project key for cycle element:", current.item.key);
            return current.item.key;
        }
        current = current.parent;
    }
    const projectKeyNotFoundErrorMessage = `Project key not found for cycle element: ${element.label}`;
    extension_1.logger.error(projectKeyNotFoundErrorMessage);
    vscode.window.showErrorMessage(projectKeyNotFoundErrorMessage);
    return null;
}
/**
 * Finds the project key (serial) for a given project tree item by traversing upward in the tree hierarchy.
 * The input element can be of type Project, Version, Cycle, TestThemeNode, TestCaseSetNode, or TestCaseNode.
 *
 * @param {ProjectManagementTreeItem} element The project tree item.
 * @returns {string | null} The project key as a string if found; otherwise null.
 */
function findProjectKeyOfProjectTreeItem(element) {
    extension_1.logger.trace("Finding project key for project tree item:", element.label);
    let current = element;
    while (current) {
        if (current.contextValue === constants_1.TreeItemContextValues.PROJECT) {
            extension_1.logger.trace("Found project key:", current.item.key);
            return current.item.key;
        }
        current = current.parent;
    }
    const projectKeyNotFoundErrorMessage = `Project key not found traversing up from tree element: ${element.label}`;
    extension_1.logger.error(projectKeyNotFoundErrorMessage);
    return null;
}
/**
 * Finds the cycle key (serial) for a given tree element by traversing upward in the tree hierarchy.
 *
 * @param {ProjectManagementTreeItem} element The tree item.
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
     * @param {string} label The label to display.
     * @param {string} contextValue The type of the tree item.
     * @param {vscode.TreeItemCollapsibleState} collapsibleState The initial collapsible state.
     * @param {any} item The original data of the tree item.
     * @param {ProjectManagementTreeItem | null} parent The parent tree item.
     */
    constructor(label, contextValue, collapsibleState, item, parent = null) {
        super(label, collapsibleState);
        this.item = item;
        this.contextValue = contextValue;
        this.parent = parent;
        this.statusOfTreeItem = item.exec?.status || item.status || "None"; // Possible values: Active, Planned, Finished, Closed, etc.
        // Set the tooltip based on the context value.
        // Tooltip for project, TOV and cycle elements looks like this: Type, Name, Status, Key
        if (contextValue === constants_1.TreeItemContextValues.PROJECT ||
            contextValue === constants_1.TreeItemContextValues.VERSION ||
            contextValue === constants_1.TreeItemContextValues.CYCLE) {
            this.tooltip = `Type: ${contextValue}\nName: ${item.name}\nStatus: ${this.statusOfTreeItem}\nKey: ${item.key}`;
        }
        // Tooltip for test theme, test case set and test case looks like this: Numbering, Type, Name, Status, ID
        else if (contextValue === constants_1.TreeItemContextValues.TEST_THEME_NODE ||
            contextValue === constants_1.TreeItemContextValues.TEST_CASE_SET_NODE ||
            contextValue === constants_1.TreeItemContextValues.TEST_CASE_NODE) {
            if (item?.base?.numbering) {
                this.tooltip = `Numbering: ${item.base.numbering}\nType: ${item.elementType}\nName: ${item.base.name}\nStatus: ${this.statusOfTreeItem}\nID: ${item.base.uniqueID}`;
            }
            // Display the uniqueID as a description next to the label.
            this.description = item.base?.uniqueID || "";
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
        // Set the icon path based on the context value and status.
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
        const status = this.item?.status || "default"; // (Active, Planned, Finished, Closed etc.)
        const type = this.contextValue; // (Project, TOV, Cycle etc.)
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
        const typeIcons = iconMap[type] || iconMap["default"];
        const iconFileNames = typeIcons[status] || typeIcons["default"] || iconMap.default.default;
        // Return the full paths for light and dark mode icons
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
exports.ProjectManagementTreeItem = ProjectManagementTreeItem;
/**
 * Initializes the project management tree view.
 * This function creates a new tree view for project management and sets its data provider.
 * @param {TestThemeTreeDataProvider} testThemeDataProvider The test theme tree data provider.
 * @returns {ProjectManagementTreeDataProvider} The initialized project management tree data provider.
 */
function createProjectDataProviderAndView(testThemeDataProvider) {
    extension_1.logger.debug("Initializing project management tree view.");
    const provider = new ProjectManagementTreeDataProvider(testThemeDataProvider);
    (0, extension_1.setProjectManagementTreeDataProvider)(provider);
    const newProjectTreeView = vscode.window.createTreeView("projectManagementTree", {
        // View ID from package.json
        treeDataProvider: provider,
        canSelectMany: false
    });
    (0, extension_1.setProjectTreeView)(newProjectTreeView);
    return provider;
}
/**
 * Sets up event listeners for the project tree view to handle expand/collapse and selection events.
 * These events update the expansion state, icons dynamically, and initialize the test theme tree on cycle click.
 */
function setupProjectTreeViewEventListeners() {
    if (!extension_1.projectTreeView) {
        extension_1.logger.error("Project tree view (projectTreeView) is not initialized. Cannot set up event listeners.");
        return;
    }
    // Handle expand events to update expansion state and icons dynamically.
    extension_1.projectTreeView.onDidExpandElement(async (event) => {
        if (extension_1.projectManagementTreeDataProvider) {
            await extension_1.projectManagementTreeDataProvider.handleExpansion(event.element, true);
        }
    });
    // Handle collapse events to update expansion state and icons dynamically.
    extension_1.projectTreeView.onDidCollapseElement(async (event) => {
        if (extension_1.projectManagementTreeDataProvider) {
            await extension_1.projectManagementTreeDataProvider.handleExpansion(event.element, false);
        }
    });
    // Handle selection changes (initial click events) to trigger test theme tree initialization on cycle click.
    // Note: Clicking on an already clicked cycle item does not trigger this onDidChangeSelection, another command is used to handle this.
    extension_1.projectTreeView.onDidChangeSelection(async (event) => {
        if (event.selection.length > 0) {
            const selectedElement = event.selection[0];
            extension_1.logger.trace(`Selection changed in Project Tree: ${selectedElement.label}, context: ${selectedElement.contextValue}`);
            // TODO: Remove?
            if (selectedElement && selectedElement.contextValue === constants_1.TreeItemContextValues.CYCLE) {
                // Trigger loading data into TestThemeTree and TestElementsTree
                if (extension_1.projectManagementTreeDataProvider) {
                    // await projectManagementTreeDataProvider.handleTestCycleClick(selectedElement);
                }
                else {
                    extension_1.logger.error("projectManagementTreeDataProvider is null, cannot handle test cycle click.");
                }
            }
        }
    });
}
/**
 * Initializes or updates the project management tree view and test theme tree view and set the global references.
 * This function ensures that tree views and data providers are created only once during extension activation.
 * Subsequent calls update the existing instances and their internal references.
 * @param {vscode.ExtensionContext} context The VS Code extension context.
 * @returns {Promise<void>} A promise that resolves when the trees are initialized or updated.
 */
async function initializeProjectAndTestThemeTrees(context) {
    extension_1.logger.debug("Initializing project and test theme trees (multi-project mode).");
    // Always create fresh providers to ensure clean state
    const testThemeDataProvider = new testThemeTreeView_1.TestThemeTreeDataProvider();
    setTestThemeTreeView(vscode.window.createTreeView("testThemeTree", {
        treeDataProvider: testThemeDataProvider
    }));
    const projectProvider = new ProjectManagementTreeDataProvider(testThemeDataProvider);
    (0, extension_1.setProjectManagementTreeDataProvider)(projectProvider);
    // Clear any existing state
    testThemeDataProvider.clearTree();
    projectProvider.clearTree();
    // Setup the test theme tree view first, its provider is needed by ProjectManagementTreeDataProvider
    // const testThemeDataProvider: TestThemeTreeDataProvider = initializeTestThemeTreeView();
    if (!exports.testThemeTreeView) {
        extension_1.logger.error("Failed to create test theme tree view instance.");
        return;
    }
    if (testThemeDataProvider && extension_1.projectManagementTreeDataProvider) {
        extension_1.projectManagementTreeDataProvider.setTestThemeDataProvider(testThemeDataProvider);
    }
    else if (testThemeDataProvider && !extension_1.projectManagementTreeDataProvider) {
        // initializing for the first time
    }
    else {
        extension_1.logger.error("Failed to initialize testThemeDataProvider or projectManagementDataProvider not yet ready.");
    }
    // Setup the project management tree view.
    createProjectDataProviderAndView(testThemeDataProvider);
    setupProjectTreeViewEventListeners();
    if (!extension_1.projectManagementTreeDataProvider) {
        extension_1.logger.error("Failed to create project management tree data provider.");
        return;
    }
    if (extension_1.projectTreeView) {
        context.subscriptions.push(extension_1.projectTreeView);
    }
    else {
        extension_1.logger.error("Project Tree View (projectTreeView) was not created successfully.");
    }
    // Initialize Test Theme Tree
    if (extension_1.projectManagementTreeDataProvider && testThemeDataProvider) {
        extension_1.projectManagementTreeDataProvider.setTestThemeDataProvider(testThemeDataProvider);
        extension_1.projectManagementTreeDataProvider.testThemeDataProvider.refresh();
    }
    if (exports.testThemeTreeView) {
        context.subscriptions.push(exports.testThemeTreeView);
    }
    // Display the project management tree view if not displayed already
    // Triggers getChildren() for the root, loads all projects.
    await vscode.commands.executeCommand("projectManagementTree.focus");
    extension_1.logger.info("Project and Test Theme trees initialized for multi-project display.");
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
/**
 * Finds the project key (serial) for a given tree element by traversing upward in the tree hierarchy.
 *
 * @param {ProjectManagementTreeItem} element The tree item.
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