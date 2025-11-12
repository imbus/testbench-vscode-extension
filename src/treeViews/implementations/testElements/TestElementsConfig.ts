/**
 * @file src/treeViews/implementations/testElements/TestElementsConfig.ts
 * @description Configuration for the Test Elements tree view.
 */

import { TreeViewConfig } from "../../core/TreeViewConfig";
import { TreeViewTiming } from "../../../constants";

export const testElementsConfig: TreeViewConfig = {
    id: "testbench.testElements",
    title: "Test Elements",
    contextValue: "testElement",

    features: {
        customRoot: false,
        marking: false,
        persistence: true,
        filtering: true,
        icons: true,
        expansion: true
    },

    modules: {
        persistence: {
            strategy: "workspace",
            autoSave: true,
            includeCustomRoot: false,
            includeExpansion: true,
            includeMarking: false
        },

        expansion: {
            rememberExpansion: true,
            defaultExpanded: false,
            expandedLevels: 2,
            collapseOnRefresh: false
        },

        icons: {
            theme: "default",
            showStatusIcons: true,
            animateLoading: false
        },

        filtering: {
            enabled: true,
            defaultFilters: [
                {
                    id: "subdivisions",
                    name: "Subdivisions",
                    predicate: (item: any) => item.data?.testElementType === "Subdivision",
                    enabled: false
                },
                {
                    id: "keywords",
                    name: "Keywords",
                    predicate: (item: any) => item.data?.testElementType === "Keyword",
                    enabled: false
                },
                {
                    id: "dataTypes",
                    name: "Data Types",
                    predicate: (item: any) => item.data?.testElementType === "DataType",
                    enabled: false
                },
                {
                    id: "conditions",
                    name: "Conditions",
                    predicate: (item: any) => item.data?.testElementType === "Condition",
                    enabled: false
                },
                {
                    id: "locallyAvailable",
                    name: "Locally Available",
                    predicate: (item: any) => item.data?.isLocallyAvailable === true,
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
        refreshStrategy: "smart",
        errorHandling: "notify",
        // loadingTimeout: 40000,
        debounceDelay: TreeViewTiming.DEFAULT_DEBOUNCE_DELAY_MS
    },

    ui: {
        emptyMessage: "No test elements to display.",
        loadingMessage: "Loading test elements...",
        errorMessage: "Failed to load test elements",
        showTooltips: true,
        tooltipFormat: "detailed"
    }
};
