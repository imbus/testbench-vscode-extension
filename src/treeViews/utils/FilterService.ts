/**
 * @file src/treeViews/utils/FilterService.ts
 * @description Service for handling filter UI interactions and operations.
 */

import * as vscode from "vscode";
import { TextFilterOptions } from "../features/filtering/FilteringModule";
import { TreeViewBase } from "../core/TreeViewBase";
import { TreeItemBase } from "../core/TreeItemBase";

export class FilterService {
    private static instance: FilterService;
    private activeTreeView: TreeViewBase<TreeItemBase> | null = null;
    private lastFocusedTreeView: TreeViewBase<TreeItemBase> | null = null;
    private treeViewFocusHistory: TreeViewBase<TreeItemBase>[] = [];

    private constructor() {}

    /**
     * Get the singleton instance of the FilterService
     * @return The singleton instance
     */
    public static getInstance(): FilterService {
        if (!FilterService.instance) {
            FilterService.instance = new FilterService();
        }
        return FilterService.instance;
    }

    /**
     * Set the active tree view for filtering operations
     * @param treeView The tree view to set as active
     */
    public setActiveTreeView(treeView: TreeViewBase<TreeItemBase>): void {
        this.activeTreeView = treeView;
        this.updateFocusHistory(treeView);
    }

    /**
     * Get the active tree view
     * @return The active tree view
     */
    public getActiveTreeView(): TreeViewBase<TreeItemBase> | null {
        return this.activeTreeView;
    }

    /**
     * Update focus history when a tree view is focused
     * @param treeView The tree view to update the focus history for
     */
    public updateFocusHistory(treeView: TreeViewBase<TreeItemBase>): void {
        this.lastFocusedTreeView = treeView;
        
        // Remove the tree view from history if it's already there
        this.treeViewFocusHistory = this.treeViewFocusHistory.filter(tv => tv !== treeView);
        
        // Add to the beginning of history
        this.treeViewFocusHistory.unshift(treeView);
        
        // Keep only the last 5 focused tree views
        if (this.treeViewFocusHistory.length > 5) {
            this.treeViewFocusHistory = this.treeViewFocusHistory.slice(0, 5);
        }
        
        console.log(`[FilterService] Focus history updated: ${this.getTreeViewName(treeView)}`);
    }

    /**
     * Get the most recently focused tree view that has data
     * @param allTreeViews The map of all tree views
     * @return The most recently focused tree view that has data
     */
    public getMostRecentTreeViewWithData(allTreeViews: {
        projectsTree: TreeViewBase<TreeItemBase>;
        testThemesTree: TreeViewBase<TreeItemBase>;
        testElementsTree: TreeViewBase<TreeItemBase>;
    }): TreeViewBase<TreeItemBase> | null {
        // First, check the focus history for tree views with data
        for (const treeView of this.treeViewFocusHistory) {
            if (treeView.getCurrentRootItems().length > 0) {
                console.log(`[FilterService] Using most recent tree view with data: ${this.getTreeViewName(treeView)}`);
                return treeView;
            }
        }
        
        // If no tree view in history has data, fall back to priority-based detection
        return this.autoDetectActiveTreeView(allTreeViews);
    }

    /**
     * Get the name of a tree view for debugging
     * @param treeView The tree view to get the name of
     * @return The name of the tree view
     */
    private getTreeViewName(treeView: TreeViewBase<TreeItemBase>): string {
        const configId = treeView.config.id;
        switch (configId) {
            case 'testbench.projects':
                return 'Projects';
            case 'testbench.testThemes':
                return 'Test Themes';
            case 'testbench.testElements':
                return 'Test Elements';
            default:
                return configId;
        }
    }

    /**
     * Auto-detect the active tree view based on current focus
     * @param allTreeViews The map of all tree views
     * @return The active tree view
     */
    public autoDetectActiveTreeView(allTreeViews: {
        projectsTree: TreeViewBase<TreeItemBase>;
        testThemesTree: TreeViewBase<TreeItemBase>;
        testElementsTree: TreeViewBase<TreeItemBase>;
    }): TreeViewBase<TreeItemBase> | null {
        // Use a priority-based approach to determine the active tree view
        // Priority: Test Themes > Test Elements > Projects
        
        // Check if test themes tree has data (highest priority)
        if (allTreeViews.testThemesTree.getCurrentRootItems().length > 0) {
            this.activeTreeView = allTreeViews.testThemesTree;
            console.log(`[FilterService] Auto-detected active tree view: Test Themes (${allTreeViews.testThemesTree.getCurrentRootItems().length} items)`);
            return allTreeViews.testThemesTree;
        }
        
        // Check if test elements tree has data (second priority)
        if (allTreeViews.testElementsTree.getCurrentRootItems().length > 0) {
            this.activeTreeView = allTreeViews.testElementsTree;
            console.log(`[FilterService] Auto-detected active tree view: Test Elements (${allTreeViews.testElementsTree.getCurrentRootItems().length} items)`);
            return allTreeViews.testElementsTree;
        }
        
        // Default to projects tree (lowest priority)
        this.activeTreeView = allTreeViews.projectsTree;
        console.log(`[FilterService] Auto-detected active tree view: Projects (${allTreeViews.projectsTree.getCurrentRootItems().length} items)`);
        return allTreeViews.projectsTree;
    }

    /**
     * Set the active tree view based on the current VS Code view context
     * This method should be called when a tree view becomes active
     * @param allTreeViews The map of all tree views
     * @param contextKey The context key to set the active tree view for
     */
    public setActiveTreeViewByContext(allTreeViews: {
        projectsTree: TreeViewBase<TreeItemBase>;
        testThemesTree: TreeViewBase<TreeItemBase>;
        testElementsTree: TreeViewBase<TreeItemBase>;
    }, contextKey: string): void {
        let treeViewName = "Unknown";
        
        switch (contextKey) {
            case 'testbenchExtension.showProjectsTree':
                this.activeTreeView = allTreeViews.projectsTree;
                treeViewName = "Projects";
                break;
            case 'testbenchExtension.showTestThemesTree':
                this.activeTreeView = allTreeViews.testThemesTree;
                treeViewName = "Test Themes";
                break;
            case 'testbenchExtension.showTestElementsTree':
                this.activeTreeView = allTreeViews.testElementsTree;
                treeViewName = "Test Elements";
                break;
            default:
                // Fall back to auto-detection
                this.autoDetectActiveTreeView(allTreeViews);
                treeViewName = this.activeTreeView ? this.getTreeViewName(this.activeTreeView) : "Unknown";
        }
        
        console.log(`[FilterService] Active tree view set to: ${treeViewName} (context: ${contextKey})`);
    }

    /**
     * Show text filter input dialog
     * @return Promise that resolves when the dialog is closed
     */
    public async showTextFilterDialog(): Promise<void> {
        if (!this.activeTreeView) {
            vscode.window.showErrorMessage("No active tree view for filtering. Please ensure a tree view is loaded.");
            return;
        }

        console.log(`[FilterService] Applying filter to tree view: ${this.getTreeViewName(this.activeTreeView)}`);

        try {
            // Get current filter options
            const filteringModule = this.activeTreeView.getModule("filtering");
            if (!filteringModule) {
                vscode.window.showErrorMessage("Filtering module not available for the current tree view.");
                return;
            }

            const currentFilter = filteringModule.getTextFilter();
            
            // Show input box for search text
            const searchText = await vscode.window.showInputBox({
                prompt: "Enter search text to filter tree items",
                placeHolder: "Search in labels, IDs, and descriptions...",
                value: currentFilter?.searchText || "",
                ignoreFocusOut: true
            });

            if (searchText === undefined) {
                return; // User cancelled
            }

            // Show quick pick for filter options
            const options = await this.showFilterOptionsDialog(currentFilter);
            if (!options) {
                return; // User cancelled
            }

            // Apply the filter
            const filterOptions: TextFilterOptions = {
                searchText: searchText.trim(),
                caseSensitive: options.caseSensitive,
                searchInLabel: options.searchInLabel,
                searchInUniqueId: options.searchInUniqueId,
                searchInDescription: options.searchInDescription,
                showParentsOfMatches: options.showParentsOfMatches,
                showChildrenOfMatches: options.showChildrenOfMatches
            };

            filteringModule.setTextFilter(filterOptions);
            
            vscode.window.showInformationMessage(
                `Filter applied to ${this.getTreeViewName(this.activeTreeView)}: "${searchText}" (${this.getFilterSummary(filterOptions)})`
            );

        } catch (error) {
            vscode.window.showErrorMessage(`Error applying filter: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }

    /**
     * Show filter options dialog
     * @param currentFilter The current filter options
     * @return Promise that resolves with the selected filter options
     */
    private async showFilterOptionsDialog(currentFilter: TextFilterOptions | null): Promise<{
        caseSensitive: boolean;
        searchInLabel: boolean;
        searchInUniqueId: boolean;
        searchInDescription: boolean;
        showParentsOfMatches: boolean;
        showChildrenOfMatches: boolean;
    } | null> {
        // Get default options from the filtering module
        const filteringModule = this.activeTreeView?.getModule("filtering");
        const defaultOptions = filteringModule?.getDefaultTextFilterOptions() || {
            caseSensitive: false,
            searchInLabel: true,
            searchInUniqueId: false,
            searchInDescription: false,
            showParentsOfMatches: false,
            showChildrenOfMatches: false
        };

        const options = [
            {
                label: "Case Sensitive",
                picked: currentFilter?.caseSensitive ?? defaultOptions.caseSensitive,
                value: "caseSensitive"
            },
            {
                label: "Search in Labels",
                picked: currentFilter?.searchInLabel ?? defaultOptions.searchInLabel,
                value: "searchInLabel"
            },
            {
                label: "Search in Unique IDs",
                picked: currentFilter?.searchInUniqueId ?? defaultOptions.searchInUniqueId,
                value: "searchInUniqueId"
            },
            {
                label: "Search in Descriptions",
                picked: currentFilter?.searchInDescription ?? defaultOptions.searchInDescription,
                value: "searchInDescription"
            },
            {
                label: "Show Parents of Matching Items",
                picked: currentFilter?.showParentsOfMatches ?? defaultOptions.showParentsOfMatches,
                value: "showParentsOfMatches"
            },
            {
                label: "Show Children of Matching Items",
                picked: currentFilter?.showChildrenOfMatches ?? defaultOptions.showChildrenOfMatches,
                value: "showChildrenOfMatches"
            }
        ];

        const selectedOptions = await vscode.window.showQuickPick(options, {
            placeHolder: "Select filter options (use space to toggle)",
            canPickMany: true,
            ignoreFocusOut: true
        });

        if (!selectedOptions) {
            return null;
        }

        const selectedValues = selectedOptions.map(option => option.value);
        
        return {
            caseSensitive: selectedValues.includes("caseSensitive"),
            searchInLabel: selectedValues.includes("searchInLabel"),
            searchInUniqueId: selectedValues.includes("searchInUniqueId"),
            searchInDescription: selectedValues.includes("searchInDescription"),
            showParentsOfMatches: selectedValues.includes("showParentsOfMatches"),
            showChildrenOfMatches: selectedValues.includes("showChildrenOfMatches")
        };
    }

    /**
     * Clear text filter
     * @return Promise that resolves when the filter is cleared
     */
    public async clearTextFilter(): Promise<void> {
        if (!this.activeTreeView) {
            vscode.window.showErrorMessage("No active tree view for filtering. Please ensure a tree view is loaded.");
            return;
        }

        try {
            const filteringModule = this.activeTreeView.getModule("filtering");
            if (!filteringModule) {
                vscode.window.showErrorMessage("Filtering module not available for the current tree view.");
                return;
            }

            filteringModule.setTextFilter(null);
            vscode.window.showInformationMessage("Text filter cleared");
        } catch (error) {
            vscode.window.showErrorMessage(`Error clearing filter: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }

    /**
     * Toggle filter diff mode
     * @return Promise that resolves when the filter diff mode is toggled
     */
    public async toggleFilterDiffMode(): Promise<void> {
        if (!this.activeTreeView) {
            vscode.window.showErrorMessage("No active tree view for filtering. Please ensure a tree view is loaded.");
            return;
        }

        try {
            const filteringModule = this.activeTreeView.getModule("filtering");
            if (!filteringModule) {
                vscode.window.showErrorMessage("Filtering module not available for the current tree view.");
                return;
            }

            const currentDiffState = filteringModule.getFilterDiffState();
            const newState = !currentDiffState.enabled;
            
            filteringModule.setFilterDiffMode(newState);
            
            const message = newState 
                ? "Filter diff mode enabled" 
                : "Filter diff mode disabled";
            vscode.window.showInformationMessage(message);
        } catch (error) {
            vscode.window.showErrorMessage(`Error toggling filter diff mode: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }

    /**
     * Clear all filters
     * @return Promise that resolves when the filters are cleared
     */
    public async clearAllFilters(): Promise<void> {
        if (!this.activeTreeView) {
            vscode.window.showErrorMessage("No active tree view for filtering. Please ensure a tree view is loaded.");
            return;
        }

        try {
            const filteringModule = this.activeTreeView.getModule("filtering");
            if (!filteringModule) {
                vscode.window.showErrorMessage("Filtering module not available for the current tree view.");
                return;
            }

            const confirmation = await vscode.window.showWarningMessage(
                "Are you sure you want to clear all filters?",
                { modal: true },
                "Clear All",
                "Cancel"
            );

            if (confirmation === "Clear All") {
                filteringModule.clearAllFilters();
                vscode.window.showInformationMessage("All filters cleared");
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error clearing filters: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }

    /**
     * Show filter status
     * @return Promise that resolves when the filter status is shown
     */
    public async showFilterStatus(): Promise<void> {
        if (!this.activeTreeView) {
            vscode.window.showInformationMessage("No active tree view for filtering. Please ensure a tree view is loaded.");
            return;
        }

        try {
            const filteringModule = this.activeTreeView.getModule("filtering");
            if (!filteringModule) {
                vscode.window.showInformationMessage("Filtering module not available for the current tree view.");
                return;
            }

            const textFilter = filteringModule.getTextFilter();
            const diffState = filteringModule.getFilterDiffState();
            const isActive = filteringModule.isActive();

            let statusMessage = "Filter Status:\n";
            statusMessage += `• Active: ${isActive ? "Yes" : "No"}\n`;
            
            if (textFilter) {
                statusMessage += `• Text Filter: "${textFilter.searchText}"\n`;
                statusMessage += `• Case Sensitive: ${textFilter.caseSensitive ? "Yes" : "No"}\n`;
                statusMessage += `• Search in Labels: ${textFilter.searchInLabel ? "Yes" : "No"}\n`;
                statusMessage += `• Search in IDs: ${textFilter.searchInUniqueId ? "Yes" : "No"}\n`;
                statusMessage += `• Search in Descriptions: ${textFilter.searchInDescription ? "Yes" : "No"}\n`;
                statusMessage += `• Show Parents of Matches: ${textFilter.showParentsOfMatches ? "Yes" : "No"}\n`;
                statusMessage += `• Show Children of Matches: ${textFilter.showChildrenOfMatches ? "Yes" : "No"}\n`;
            }
            
            statusMessage += `• Filter Diff Mode: ${diffState.enabled ? "Enabled" : "Disabled"}\n`;
            
            if (diffState.enabled) {
                statusMessage += `• Filtered Items: ${diffState.filteredItems.size}\n`;
            }

            vscode.window.showInformationMessage(statusMessage);
        } catch (error) {
            vscode.window.showErrorMessage(`Error showing filter status: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }

    /**
     * Get a summary of filter options
     * @param options The filter options to get a summary of
     * @return The summary of the filter options
    */
    private getFilterSummary(options: TextFilterOptions): string {
        const parts: string[] = [];
        
        if (options.caseSensitive) {
            parts.push("case-sensitive");
        }
        
        const searchFields: string[] = [];
        if (options.searchInLabel) {searchFields.push("labels");}
        if (options.searchInUniqueId) {searchFields.push("IDs");}
        if (options.searchInDescription) {searchFields.push("descriptions");}
        
        if (searchFields.length > 0) {
            parts.push(`in ${searchFields.join(", ")}`);
        }

        const inclusionOptions: string[] = [];
        if (options.showParentsOfMatches) {inclusionOptions.push("show parents");}
        if (options.showChildrenOfMatches) {inclusionOptions.push("show children");}
        
        if (inclusionOptions.length > 0) {
            parts.push(`include ${inclusionOptions.join(", ")}`);
        }
        
        return parts.join(", ");
    }
} 