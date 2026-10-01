/**
 * @file src/treeViews/implementations/projects/ProjectsConfig.ts
 * @description Configuration for the Projects tree view.
 */

import { TreeViewConfig } from "../../core/TreeViewConfig";
import { TreeViewTiming } from "../../../constants";

export const projectsConfig: TreeViewConfig = {
    id: "testbench.projects",
    title: "Projects",
    contextValue: "project",

    features: {
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
            includeExpansion: true,
            includeMarking: false
        },

        expansion: {
            rememberExpansion: true,
            defaultExpanded: false,
            expandedLevels: 1,
            collapseOnRefresh: false
        },

        icons: {
            theme: "default",
            showStatusIcons: true,
            animateLoading: true
        },

        filtering: {
            enabled: true,
            defaultFilters: [
                {
                    id: "hasProjects",
                    name: "Has Projects",
                    predicate: (item: any) => item.data?.type === "project",
                    enabled: false
                },
                {
                    id: "hasVersions",
                    name: "Has Versions",
                    predicate: (item: any) => item.data?.type === "version",
                    enabled: false
                },
                {
                    id: "hasCycles",
                    name: "Has Cycles",
                    predicate: (item: any) => item.data?.type === "cycle",
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
        emptyMessage: "No projects available.",
        loadingMessage: "Loading projects...",
        errorMessage: "Failed to load projects",
        showTooltips: true,
        tooltipFormat: "detailed"
    }
};
