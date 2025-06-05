/**
 * @file src/services/iconManagementService.ts
 * @description Centralized icon management service for all tree items
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../testBenchLogger";
import { TreeItemContextValues } from "../constants";

export interface IconDefinition {
    light: string;
    dark: string;
    markedLight?: string;
    markedDark?: string;
}

export interface IconContext {
    contextValue: string;
    status?: string;
    isMarked?: boolean;
    isCustomRoot?: boolean;
    originalContextValue?: string;
}

export class IconManagementService {
    private readonly iconRegistry: Map<string, Map<string, IconDefinition>> = new Map();

    constructor(
        private readonly logger: TestBenchLogger,
        private readonly extensionContext: vscode.ExtensionContext
    ) {
        this.initializeIconRegistry();
    }

    /**
     * Initialize the icon registry with all known icon configurations
     */
    private initializeIconRegistry(): void {
        this.registerIconSet("projectManagement", {
            [TreeItemContextValues.PROJECT]: {
                active: { light: "project-light.svg", dark: "project-dark.svg" },
                default: { light: "project-light.svg", dark: "project-dark.svg" }
            },
            [TreeItemContextValues.VERSION]: {
                default: { light: "TOV-specification-light.svg", dark: "TOV-specification-dark.svg" }
            },
            [TreeItemContextValues.CYCLE]: {
                default: { light: "Cycle-execution-light.svg", dark: "Cycle-execution-dark.svg" }
            }
        });

        this.registerIconSet("testTheme", {
            [TreeItemContextValues.TEST_THEME_NODE]: {
                default: {
                    light: "TestThemeOriginal-light.svg",
                    dark: "TestThemeOriginal-dark.svg",
                    markedLight: "TestThemeOriginal-marked-light.svg",
                    markedDark: "TestThemeOriginal-marked-dark.svg"
                }
            },
            [TreeItemContextValues.TEST_CASE_SET_NODE]: {
                default: {
                    light: "TestCaseSetOriginal-light.svg",
                    dark: "TestCaseSetOriginal-dark.svg",
                    markedLight: "TestCaseSetOriginal-marked-light.svg",
                    markedDark: "TestCaseSetOriginal-marked-dark.svg"
                }
            },
            [TreeItemContextValues.TEST_CASE_NODE]: {
                default: { light: "TestCase-light.svg", dark: "TestCase-dark.svg" }
            }
        });

        this.registerIconSet("testElement", {
            DataType: {
                default: { light: "dataType-light.svg", dark: "dataType-dark.svg" }
            },
            Interaction: {
                default: { light: "testStep-light.svg", dark: "testStep-dark.svg" }
            },
            Condition: {
                default: { light: "condition-light.svg", dark: "condition-dark.svg" }
            },
            Subdivision: {
                default: { light: "missingSubdivision-light.svg", dark: "missingSubdivision-dark.svg" }
            },
            LocalSubdivision: {
                default: { light: "localSubdivision-light.svg", dark: "localSubdivision-dark.svg" }
            },
            MissingSubdivision: {
                default: { light: "missingSubdivision-light.svg", dark: "missingSubdivision-dark.svg" }
            },
            Other: {
                default: { light: "other-light.svg", dark: "other-dark.svg" }
            }
        });

        this.registerIconSet("default", {
            default: {
                default: { light: "testbench-logo.svg", dark: "testbench-logo.svg" }
            }
        });

        this.logger.trace("[IconManagementService] Icon registry initialized");
    }

    /**
     * Register a set of icons under a category
     */
    public registerIconSet(category: string, iconSet: Record<string, Record<string, IconDefinition>>): void {
        const categoryMap = new Map<string, IconDefinition>();

        for (const [contextValue, statusMap] of Object.entries(iconSet)) {
            for (const [status, iconDef] of Object.entries(statusMap)) {
                const key = this.createIconKey(contextValue, status);
                categoryMap.set(key, iconDef);
            }
        }

        this.iconRegistry.set(category, categoryMap);
        this.logger.trace(`[IconManagementService] Registered icon set for category: ${category}`);
    }

    /**
     * Get icon URIs for a given context
     */
    public getIconUris(context: IconContext, category: string = "default"): { light: vscode.Uri; dark: vscode.Uri } {
        try {
            const iconDef = this.findIconDefinition(context, category);
            let iconFiles = iconDef;
            if (context.isMarked && iconDef.markedLight && iconDef.markedDark) {
                iconFiles = {
                    light: iconDef.markedLight,
                    dark: iconDef.markedDark
                };
            }

            return {
                light: this.createIconUri(iconFiles.light),
                dark: this.createIconUri(iconFiles.dark)
            };
        } catch (error) {
            this.logger.error(`[IconManagementService] Error getting icon URIs for context:`, [context, error]);
            return this.getFallbackIconUris();
        }
    }

    /**
     * Find icon definition for a given context
     */
    private findIconDefinition(context: IconContext, category: string): IconDefinition {
        let contextValueForIcon = context.contextValue;

        if (
            context.contextValue === TreeItemContextValues.MARKED_TEST_THEME_NODE ||
            context.contextValue === TreeItemContextValues.MARKED_TEST_CASE_SET_NODE
        ) {
            contextValueForIcon = context.originalContextValue || context.contextValue;
        } else if (context.isCustomRoot && context.originalContextValue) {
            contextValueForIcon = context.originalContextValue;
        }

        const categoryMap = this.iconRegistry.get(category);
        if (categoryMap) {
            const iconDef = this.findInCategory(categoryMap, contextValueForIcon, context.status);
            if (iconDef) {
                return iconDef;
            }
        }

        for (const [catName, catMap] of this.iconRegistry) {
            if (catName !== category) {
                const iconDef = this.findInCategory(catMap, contextValueForIcon, context.status);
                if (iconDef) {
                    return iconDef;
                }
            }
        }

        const defaultCategory = this.iconRegistry.get("default");
        const fallback = defaultCategory?.get(this.createIconKey("default", "default"));

        if (!fallback) {
            throw new Error("No fallback icon definition found");
        }

        return fallback;
    }

    /**
     * Find icon definition in a specific category
     */
    private findInCategory(
        categoryMap: Map<string, IconDefinition>,
        contextValue: string,
        status?: string
    ): IconDefinition | null {
        if (status) {
            const withStatus = categoryMap.get(this.createIconKey(contextValue, status.toLowerCase()));
            if (withStatus) {
                return withStatus;
            }
        }

        const withDefault = categoryMap.get(this.createIconKey(contextValue, "default"));
        if (withDefault) {
            return withDefault;
        }

        return null;
    }

    /**
     * Create icon key for lookup
     */
    private createIconKey(contextValue: string, status: string): string {
        return `${contextValue}:${status}`;
    }

    /**
     * Create icon URI from file name
     */
    private createIconUri(fileName: string): vscode.Uri {
        return vscode.Uri.joinPath(this.extensionContext.extensionUri, "resources", "icons", fileName);
    }

    /**
     * Get fallback icon URIs
     */
    private getFallbackIconUris(): { light: vscode.Uri; dark: vscode.Uri } {
        return {
            light: this.createIconUri("testbench-logo.svg"),
            dark: this.createIconUri("testbench-logo.svg")
        };
    }

    /**
     * Register a custom icon for a specific context
     */
    public registerCustomIcon(category: string, contextValue: string, status: string, iconDef: IconDefinition): void {
        let categoryMap = this.iconRegistry.get(category);
        if (!categoryMap) {
            categoryMap = new Map();
            this.iconRegistry.set(category, categoryMap);
        }

        const key = this.createIconKey(contextValue, status);
        categoryMap.set(key, iconDef);

        this.logger.trace(`[IconManagementService] Registered custom icon for ${category}:${key}`);
    }

    /**
     * Get all available categories
     */
    public getAvailableCategories(): string[] {
        return Array.from(this.iconRegistry.keys());
    }

    /**
     * Get all context values for a category
     */
    public getContextValuesForCategory(category: string): string[] {
        const categoryMap = this.iconRegistry.get(category);
        if (!categoryMap) {
            return [];
        }

        const contextValues = new Set<string>();
        for (const key of categoryMap.keys()) {
            const [contextValue] = key.split(":");
            contextValues.add(contextValue);
        }

        return Array.from(contextValues);
    }

    /**
     * Validate icon files exist
     */
    public async validateIcons(): Promise<{ valid: string[]; invalid: string[] }> {
        const valid: string[] = [];
        const invalid: string[] = [];

        for (const [category, categoryMap] of this.iconRegistry) {
            for (const [key, iconDef] of categoryMap) {
                const files = [iconDef.light, iconDef.dark];
                if (iconDef.markedLight) {
                    files.push(iconDef.markedLight);
                }
                if (iconDef.markedDark) {
                    files.push(iconDef.markedDark);
                }

                for (const file of files) {
                    try {
                        const uri = this.createIconUri(file);
                        await vscode.workspace.fs.stat(uri);
                        valid.push(`${category}:${key}:${file}`);
                    } catch {
                        invalid.push(`${category}:${key}:${file}`);
                    }
                }
            }
        }

        if (invalid.length > 0) {
            this.logger.warn(`[IconManagementService] Invalid icon files found:`, invalid);
        }

        return { valid, invalid };
    }
}
