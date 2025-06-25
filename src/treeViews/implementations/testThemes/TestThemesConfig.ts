/**
 * @file src/treeViews/implementations/testThemes/TestThemesConfig.ts
 * @description Configuration for the Test Themes tree view.
 */

import { TestThemeItemTypes } from "../../../constants";
import { TreeViewConfig } from "../../core/TreeViewConfig";
import { TreeViewTiming } from "../../../constants";

export const testThemesConfig: TreeViewConfig = {
    id: "testbench.testThemes",
    title: "Test Themes",
    contextValue: "testTheme",

    features: {
        customRoot: true,
        marking: true,
        persistence: true,
        filtering: true,
        icons: true,
        expansion: true
    },

    modules: {
        customRoot: {
            enabled: true,
            contextKey: "testThemeTreeHasCustomRoot",
            allowedItemTypes: [TestThemeItemTypes.TEST_THEME],
            persistAcrossSessions: true
        },

        marking: {
            enabled: true,
            strategies: ["generation", "import"],
            persistMarks: true,
            showImportButton: true,
            allowPersistentImport: false,
            markingContextValues: [TestThemeItemTypes.TEST_THEME, TestThemeItemTypes.TEST_CASE_SET]
        },

        persistence: {
            strategy: "workspace",
            autoSave: true,
            includeCustomRoot: true,
            includeExpansion: true,
            includeMarking: true
        },

        expansion: {
            rememberExpansion: true,
            defaultExpanded: false,
            expandedLevels: 2,
            collapseOnRefresh: false
        },

        icons: {
            theme: "colorful",
            showStatusIcons: true,
            animateLoading: false
        },

        filtering: {
            enabled: true,
            defaultFilters: [
                {
                    id: "testThemes",
                    name: "Test Themes",
                    predicate: (item: any) => item.data?.type === "TestThemeNode",
                    enabled: false
                },
                {
                    id: "testCaseSets",
                    name: "Test Case Sets",
                    predicate: (item: any) => item.data?.type === "TestCaseSetNode",
                    enabled: false
                },
                {
                    id: "testCases",
                    name: "Test Cases",
                    predicate: (item: any) => item.data?.type === "TestCaseNode",
                    enabled: false
                },
                {
                    id: "markedForImport",
                    name: "Marked for Import",
                    predicate: (item: any) => item.data?.type?.includes("MarkedForImport"),
                    enabled: false
                },
                {
                    id: "markedForGeneration",
                    name: "Marked for Generation",
                    predicate: (item: any) => item.data?.type?.includes("MarkedForGeneration"),
                    enabled: false
                }
            ],
            allowUserFilters: true,
            persistFilters: true,
            showParentsOfMatches: true,
            showChildrenOfMatches: true
        }
    },

    behavior: {
        refreshStrategy: "incremental",
        errorHandling: "notify",
        //loadingTimeout: 40000,
        debounceDelay: TreeViewTiming.DEFAULT_DEBOUNCE_DELAY_MS
    },

    ui: {
        emptyMessage: "Select a cycle from the Projects view to see test themes.",
        loadingMessage: "Loading test themes...",
        errorMessage: "Failed to load test themes",
        showTooltips: true,
        tooltipFormat: "detailed"
    }
};
