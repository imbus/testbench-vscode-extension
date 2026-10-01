/**
 * @file src/test/suite/treeViews/TreeViewConfig.test.ts
 * @description Unit tests for the TreeViewConfig interface and related configuration types
 */

import * as assert from "assert";
import {
    TreeViewConfig,
    MarkingConfig,
    PersistenceConfig,
    FilterConfig,
    FilterDefinition,
    IconConfig,
    ExpansionConfig
} from "../../../treeViews/core/TreeViewConfig";

suite("TreeViewConfig", () => {
    suite("TreeViewConfig Interface", () => {
        test("should create valid TreeViewConfig", () => {
            const config: TreeViewConfig = {
                id: "test-tree",
                title: "Test Tree View",
                contextValue: "testTreeView",
                features: {
                    marking: true,
                    persistence: false,
                    filtering: true,
                    icons: false,
                    expansion: true
                },
                modules: {
                    marking: {
                        enabled: true,
                        strategies: ["click", "keyboard"],
                        persistMarks: true,
                        showImportButton: true,
                        allowPersistentImport: true,
                        markingContextValues: ["marked", "selected"]
                    },
                    persistence: {
                        strategy: "workspace",
                        autoSave: true,
                        includeExpansion: true,
                        includeMarking: true
                    },
                    filtering: {
                        enabled: true,
                        defaultFilters: [],
                        allowUserFilters: true,
                        persistFilters: true,
                        showParentsOfMatches: true,
                        showChildrenOfMatches: false
                    },
                    icons: {
                        theme: "default",
                        customMappings: { custom: "icon.svg" },
                        showStatusIcons: true,
                        animateLoading: false
                    },
                    expansion: {
                        rememberExpansion: true,
                        defaultExpanded: false,
                        expandedLevels: 2,
                        collapseOnRefresh: false
                    }
                },
                behavior: {
                    refreshStrategy: "smart",
                    errorHandling: "notify",
                    loadingTimeout: 50000,
                    debounceDelay: 500
                },
                ui: {
                    emptyMessage: "No items found",
                    loadingMessage: "Loading...",
                    errorMessage: "An error occurred",
                    showTooltips: true,
                    tooltipFormat: "default"
                }
            };

            assert.strictEqual(config.id, "test-tree");
            assert.strictEqual(config.title, "Test Tree View");
            assert.strictEqual(config.contextValue, "testTreeView");
            assert.strictEqual(config.features.persistence, false);
            assert.strictEqual(config.behavior.refreshStrategy, "smart");
            assert.strictEqual(config.ui.emptyMessage, "No items found");
        });

        test("should create minimal TreeViewConfig", () => {
            const config: TreeViewConfig = {
                id: "minimal-tree",
                title: "Minimal Tree",
                contextValue: "minimal",
                features: {
                    marking: false,
                    persistence: false,
                    filtering: false,
                    icons: false,
                    expansion: false
                },
                modules: {},
                behavior: {
                    refreshStrategy: "full",
                    errorHandling: "silent",
                    loadingTimeout: 10000,
                    debounceDelay: 300
                },
                ui: {
                    emptyMessage: "",
                    loadingMessage: "",
                    errorMessage: "",
                    showTooltips: false,
                    tooltipFormat: ""
                }
            };

            assert.strictEqual(config.id, "minimal-tree");
            assert.strictEqual(config.title, "Minimal Tree");
            assert.strictEqual(config.contextValue, "minimal");
        });
    });

    suite("MarkingConfig", () => {
        test("should create valid MarkingConfig", () => {
            const config: MarkingConfig = {
                enabled: true,
                strategies: ["click", "keyboard", "contextMenu"],
                persistMarks: true,
                showImportButton: true,
                allowPersistentImport: true,
                markingContextValues: ["marked", "selected", "highlighted"]
            };

            assert.strictEqual(config.enabled, true);
            assert.deepStrictEqual(config.strategies, ["click", "keyboard", "contextMenu"]);
            assert.strictEqual(config.persistMarks, true);
            assert.strictEqual(config.showImportButton, true);
            assert.strictEqual(config.allowPersistentImport, true);
            assert.deepStrictEqual(config.markingContextValues, ["marked", "selected", "highlighted"]);
        });

        test("should create disabled MarkingConfig", () => {
            const config: MarkingConfig = {
                enabled: false,
                strategies: [],
                persistMarks: false,
                showImportButton: false,
                allowPersistentImport: false,
                markingContextValues: []
            };

            assert.strictEqual(config.enabled, false);
            assert.deepStrictEqual(config.strategies, []);
            assert.strictEqual(config.persistMarks, false);
            assert.strictEqual(config.showImportButton, false);
            assert.strictEqual(config.allowPersistentImport, false);
            assert.deepStrictEqual(config.markingContextValues, []);
        });
    });

    suite("PersistenceConfig", () => {
        test("should create workspace persistence config", () => {
            const config: PersistenceConfig = {
                strategy: "workspace",
                autoSave: true,
                includeExpansion: true,
                includeMarking: true
            };

            assert.strictEqual(config.strategy, "workspace");
            assert.strictEqual(config.autoSave, true);
            assert.strictEqual(config.includeExpansion, true);
            assert.strictEqual(config.includeMarking, true);
        });

        test("should create global persistence config", () => {
            const config: PersistenceConfig = {
                strategy: "global",
                autoSave: false,
                includeExpansion: false,
                includeMarking: false
            };

            assert.strictEqual(config.strategy, "global");
            assert.strictEqual(config.autoSave, false);
            assert.strictEqual(config.includeExpansion, false);
            assert.strictEqual(config.includeMarking, false);
        });

        test("should create no persistence config", () => {
            const config: PersistenceConfig = {
                strategy: "none",
                autoSave: false,
                includeExpansion: false,
                includeMarking: false
            };

            assert.strictEqual(config.strategy, "none");
            assert.strictEqual(config.autoSave, false);
        });
    });

    suite("FilterConfig", () => {
        test("should create valid FilterConfig", () => {
            const defaultFilter: FilterDefinition = {
                id: "test-filter",
                name: "Test Filter",
                predicate: (item: any) => item.type === "test",
                enabled: true
            };

            const config: FilterConfig = {
                enabled: true,
                defaultFilters: [defaultFilter],
                allowUserFilters: true,
                persistFilters: true,
                showParentsOfMatches: true,
                showChildrenOfMatches: true
            };

            assert.strictEqual(config.enabled, true);
            assert.strictEqual(config.defaultFilters.length, 1);
            assert.strictEqual(config.defaultFilters[0].id, "test-filter");
            assert.strictEqual(config.allowUserFilters, true);
            assert.strictEqual(config.persistFilters, true);
            assert.strictEqual(config.showParentsOfMatches, true);
            assert.strictEqual(config.showChildrenOfMatches, true);
        });

        test("should create FilterConfig with empty filters", () => {
            const config: FilterConfig = {
                enabled: false,
                defaultFilters: [],
                allowUserFilters: false,
                persistFilters: false,
                showParentsOfMatches: false,
                showChildrenOfMatches: false
            };

            assert.strictEqual(config.enabled, false);
            assert.deepStrictEqual(config.defaultFilters, []);
            assert.strictEqual(config.allowUserFilters, false);
            assert.strictEqual(config.persistFilters, false);
            assert.strictEqual(config.showParentsOfMatches, false);
            assert.strictEqual(config.showChildrenOfMatches, false);
        });
    });

    suite("FilterDefinition", () => {
        test("should create valid FilterDefinition", () => {
            const filter: FilterDefinition = {
                id: "custom-filter",
                name: "Custom Filter",
                predicate: (item: any) => item.label && item.label.includes("test"),
                enabled: false
            };

            assert.strictEqual(filter.id, "custom-filter");
            assert.strictEqual(filter.name, "Custom Filter");
            assert.strictEqual(typeof filter.predicate, "function");
            assert.strictEqual(filter.enabled, false);
        });

        test("should test filter predicate", () => {
            const filter: FilterDefinition = {
                id: "type-filter",
                name: "Type Filter",
                predicate: (item: any) => item.type === "project",
                enabled: true
            };

            const matchingItem = { type: "project", label: "Test Project" };
            const nonMatchingItem = { type: "cycle", label: "Test Cycle" };

            assert.strictEqual(filter.predicate(matchingItem), true);
            assert.strictEqual(filter.predicate(nonMatchingItem), false);
        });
    });

    suite("IconConfig", () => {
        test("should create default icon config", () => {
            const config: IconConfig = {
                theme: "default",
                showStatusIcons: true,
                animateLoading: true
            };

            assert.strictEqual(config.theme, "default");
            assert.strictEqual(config.showStatusIcons, true);
            assert.strictEqual(config.animateLoading, true);
            assert.strictEqual(config.customMappings, undefined);
        });

        test("should create custom icon config", () => {
            const config: IconConfig = {
                theme: "custom",
                customMappings: {
                    project: "project-icon.svg",
                    cycle: "cycle-icon.svg",
                    test: "test-icon.svg"
                },
                showStatusIcons: false,
                animateLoading: false
            };

            assert.strictEqual(config.theme, "custom");
            assert.deepStrictEqual(config.customMappings, {
                project: "project-icon.svg",
                cycle: "cycle-icon.svg",
                test: "test-icon.svg"
            });
            assert.strictEqual(config.showStatusIcons, false);
            assert.strictEqual(config.animateLoading, false);
        });

        test("should create minimal icon config", () => {
            const config: IconConfig = {
                theme: "minimal",
                showStatusIcons: false,
                animateLoading: false
            };

            assert.strictEqual(config.theme, "minimal");
            assert.strictEqual(config.showStatusIcons, false);
            assert.strictEqual(config.animateLoading, false);
        });
    });

    suite("ExpansionConfig", () => {
        test("should create valid ExpansionConfig", () => {
            const config: ExpansionConfig = {
                rememberExpansion: true,
                defaultExpanded: true,
                expandedLevels: 3,
                collapseOnRefresh: false
            };

            assert.strictEqual(config.rememberExpansion, true);
            assert.strictEqual(config.defaultExpanded, true);
            assert.strictEqual(config.expandedLevels, 3);
            assert.strictEqual(config.collapseOnRefresh, false);
        });

        test("should create conservative ExpansionConfig", () => {
            const config: ExpansionConfig = {
                rememberExpansion: false,
                defaultExpanded: false,
                expandedLevels: 1,
                collapseOnRefresh: true
            };

            assert.strictEqual(config.rememberExpansion, false);
            assert.strictEqual(config.defaultExpanded, false);
            assert.strictEqual(config.expandedLevels, 1);
            assert.strictEqual(config.collapseOnRefresh, true);
        });
    });

    suite("Configuration Validation", () => {
        test("should validate refresh strategy values", () => {
            const validStrategies: Array<"full" | "incremental" | "smart"> = ["full", "incremental", "smart"];

            validStrategies.forEach((strategy) => {
                const config: TreeViewConfig = {
                    id: "test",
                    title: "Test",
                    contextValue: "test",
                    features: {
                        marking: false,
                        persistence: false,
                        filtering: false,
                        icons: false,
                        expansion: false
                    },
                    modules: {},
                    behavior: {
                        refreshStrategy: strategy,
                        errorHandling: "silent",
                        loadingTimeout: 10000,
                        debounceDelay: 300
                    },
                    ui: {
                        emptyMessage: "",
                        loadingMessage: "",
                        errorMessage: "",
                        showTooltips: false,
                        tooltipFormat: ""
                    }
                };

                assert.strictEqual(config.behavior.refreshStrategy, strategy);
            });
        });

        test("should validate error handling values", () => {
            const validErrorHandling: Array<"silent" | "notify" | "throw"> = ["silent", "notify", "throw"];

            validErrorHandling.forEach((errorHandling) => {
                const config: TreeViewConfig = {
                    id: "test",
                    title: "Test",
                    contextValue: "test",
                    features: {
                        marking: false,
                        persistence: false,
                        filtering: false,
                        icons: false,
                        expansion: false
                    },
                    modules: {},
                    behavior: {
                        refreshStrategy: "full",
                        errorHandling: errorHandling,
                        loadingTimeout: 10000,
                        debounceDelay: 300
                    },
                    ui: {
                        emptyMessage: "",
                        loadingMessage: "",
                        errorMessage: "",
                        showTooltips: false,
                        tooltipFormat: ""
                    }
                };

                assert.strictEqual(config.behavior.errorHandling, errorHandling);
            });
        });

        test("should validate icon theme values", () => {
            const validThemes: Array<"default" | "minimal" | "colorful" | "custom"> = [
                "default",
                "minimal",
                "colorful",
                "custom"
            ];

            validThemes.forEach((theme) => {
                const config: IconConfig = {
                    theme: theme,
                    showStatusIcons: true,
                    animateLoading: true
                };

                assert.strictEqual(config.theme, theme);
            });
        });

        test("should validate persistence strategy values", () => {
            const validStrategies: Array<"workspace" | "global" | "none"> = ["workspace", "global", "none"];

            validStrategies.forEach((strategy) => {
                const config: PersistenceConfig = {
                    strategy: strategy,
                    autoSave: true,
                    includeExpansion: true,
                    includeMarking: true
                };

                assert.strictEqual(config.strategy, strategy);
            });
        });
    });
});
