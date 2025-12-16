/**
 * @file src/test/suite/treeViews/index.ts
 * @description Index file for tree framework tests
 */

// Import all tree framework test suites
import "./TreeItemBase.test";
import "./TreeViewConfig.test";
import "./TreeViewContext.test";
import "./TreeViewModule.test";
import "./ModuleRegistry.test";
import "./TreeViewBase.test";
import "./FilteringModule.test";
import "./ProjectsConfig.test";
import "./ProjectsTreeItem.test";
import "./ProjectsDataProvider.test";
import "./ProjectsTreeView.test";
import "./TestThemesTreeItem.test";
import "./TestThemesTreeView.test";
import "./RobotFileService.test";
import "./ResourceFileService.test";

// Export test suite names for reference
export const treeViewsTestSuites = [
    "TreeItemBase",
    "TreeViewConfig",
    "TreeViewContext",
    "TreeViewModule",
    "ModuleRegistry",
    "TreeViewBase",
    "FilteringModule",
    "ProjectsConfig",
    "ProjectsTreeItem",
    "ProjectsDataProvider",
    "ProjectsTreeView",
    "TestThemesTreeItem",
    "TestThemesTreeView",
    "RobotFileService",
    "ResourceFileService"
];

// Export test descriptions
export const treeViewsTestDescriptions = {
    TreeItemBase: "Tests for the base tree item class including metadata management, tree navigation, and lifecycle",
    TreeViewConfig: "Tests for tree view configuration interfaces and validation",
    TreeViewContext: "Tests for tree view context object and its integration with tree views",
    TreeViewModule: "Tests for tree view module interface and basic module functionality",
    ModuleRegistry: "Tests for module registry including registration, creation, and management",
    TreeViewBase: "Tests for the base tree view class including data loading, module management, and lifecycle",
    FilteringModule: "Tests for the filtering module including diff mode context key functionality",
    ProjectsConfig: "Tests for the projects configuration including structure validation and immutability",
    ProjectsTreeItem:
        "Tests for the projects tree item class including data management, tree navigation, and serialization",
    ProjectsDataProvider:
        "Tests for the projects data provider including data fetching, transformation, and validation",
    ProjectsTreeView: "Tests for the projects tree view including data loading, tree navigation, and command handling",
    TestThemesTreeItem:
        "Tests for the test themes tree item class including context-aware ID generation and language server parameter extraction",
    TestThemesTreeView:
        "Tests for the test themes tree view including title update functionality for cycle and TOV contexts and state management",
    RobotFileService:
        "Tests for the robot file service including file existence checking and path generation for test themes and test case sets",
    ResourceFileService:
        "Tests for the resource file service including special character handling and path construction for test elements"
};
