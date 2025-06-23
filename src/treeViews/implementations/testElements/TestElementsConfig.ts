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
            saveDebounce: TreeViewTiming.DEFAULT_SAVE_DEBOUNCE_MS,
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
                    id: "interactions",
                    name: "Interactions",
                    predicate: (item: any) => item.data?.testElementType === "Interaction",
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
        emptyMessage: "Select a TOV from the Projects view to see test elements.",
        loadingMessage: "Loading test elements...",
        errorMessage: "Failed to load test elements",
        showTooltips: true,
        tooltipFormat: "detailed"
    }
};
