/**
 * @file src/services/treeServiceManager.ts
 * @description Service manager for coordinating all tree view services with improved architecture
 * @author VS Code Extension Team
 * @version 2.0.0
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../testBenchLogger";
import { IconManagementService } from "./iconManagementService";
import { CustomRootService } from "./customRootService";
import { ProjectDataService } from "./projectDataService";
import { TestElementDataService } from "./testElementDataService";
import { ResourceFileService } from "./resourceFileService";
import { MarkedItemStateService } from "./markedItemStateService";
import { PlayServerConnection } from "../testBenchConnection";
import { ProjectManagementTreeDataProvider } from "../views/projectManagement/projectManagementTreeDataProvider";
import { TestThemeTreeDataProvider } from "../views/testTheme/testThemeTreeDataProvider";
import { TestElementsTreeDataProvider } from "../views/testElements/testElementsTreeDataProvider";
import { TestElementTreeBuilder } from "../views/testElements/testElementTreeBuilder";
import { BaseTreeItem } from "../views/common/baseTreeItem";

/**
 * Dependencies required for the TreeServiceManager initialization
 */
export interface TreeServiceDependencies {
    readonly extensionContext: vscode.ExtensionContext;
    readonly logger: TestBenchLogger;
    readonly getConnection: () => PlayServerConnection | null;
}

/**
 * Health status information for individual services
 */
export interface ServiceHealthInfo {
    readonly service: string;
    readonly status: ServiceStatus;
    readonly details?: string;
    readonly lastCheck?: Date;
}

/**
 * Validation result for service dependencies
 */
export interface ValidationResult {
    readonly valid: boolean;
    readonly issues: readonly string[];
    readonly timestamp: Date;
}

/**
 * Provider dependencies that will be injected into tree data providers
 */
export interface ProviderDependencies {
    readonly extensionContext: vscode.ExtensionContext;
    readonly logger: TestBenchLogger;
    readonly iconManagementService: IconManagementService;
    readonly projectDataService: ProjectDataService;
    readonly testElementDataService: TestElementDataService;
    readonly resourceFileService: ResourceFileService;
    readonly markedItemStateService: MarkedItemStateService;
    readonly createCustomRootService: <T extends BaseTreeItem>(
        contextKey: string,
        customContextValue: string,
        onStateChange?: (state: any) => void
    ) => CustomRootService<T>;
}

/**
 * Factory function type for creating tree data providers
 */
export type ProviderFactory<T> = (updateMessageCallback: (message: string | undefined) => void) => T;

/**
 * Service factory interface containing all provider creation methods
 */
export interface TreeServiceFactory {
    readonly createProjectManagementProvider: ProviderFactory<ProjectManagementTreeDataProvider>;
    readonly createTestThemeProvider: ProviderFactory<TestThemeTreeDataProvider>;
    readonly createTestElementsProvider: ProviderFactory<TestElementsTreeDataProvider>;
}

/**
 * Possible service status values
 */
export type ServiceStatus = "active" | "inactive" | "initializing" | "waiting_for_connection" | "error";

/**
 * Service manager for coordinating all tree view services.
 *
 * This class follows the Dependency Injection pattern and provides a centralized
 * way to manage all services required by tree view providers. It handles service
 * initialization, health monitoring, and provides factory methods for creating
 * tree data providers with proper dependency injection.
 */
export class TreeServiceManager {
    // Core services - readonly to prevent external modification
    public readonly iconManagementService: IconManagementService;
    public readonly projectDataService: ProjectDataService;
    public readonly testElementDataService: TestElementDataService;
    public readonly resourceFileService: ResourceFileService;
    public readonly markedItemStateService: MarkedItemStateService;

    // Service state
    private _isInitialized: boolean = false;
    private _initializationPromise: Promise<void> | null = null;
    private readonly _disposables: vscode.Disposable[] = [];

    /**
     * Creates a new TreeServiceManager instance.
     *
     * @param dependencies - The required dependencies for service initialization
     */
    constructor(private readonly dependencies: TreeServiceDependencies) {
        const { extensionContext, logger, getConnection } = dependencies;

        // Initialize core services with dependency injection
        this.iconManagementService = new IconManagementService(logger, extensionContext);
        this.projectDataService = new ProjectDataService(getConnection, logger);
        this.testElementDataService = new TestElementDataService(getConnection, logger);
        this.resourceFileService = new ResourceFileService(logger);
        this.markedItemStateService = new MarkedItemStateService(extensionContext, logger);

        logger.trace("[TreeServiceManager] Services created successfully");
    }

    /**
     * Initializes all services asynchronously.
     *
     * This method ensures that all services are properly initialized before they can be used.
     * It's safe to call this method multiple times - subsequent calls will return the same promise.
     *
     * @returns Promise that resolves when all services are initialized
     * @throws Error if any service fails to initialize
     */
    public async initialize(): Promise<void> {
        // Return existing promise if initialization is already in progress
        if (this._initializationPromise) {
            return this._initializationPromise;
        }

        // Return immediately if already initialized
        if (this._isInitialized) {
            this.dependencies.logger.debug("[TreeServiceManager] Already initialized");
            return;
        }

        // Create and cache the initialization promise
        this._initializationPromise = this._performInitialization();
        return this._initializationPromise;
    }

    /**
     * Performs the actual service initialization.
     *
     * @private
     */
    private async _performInitialization(): Promise<void> {
        try {
            this.dependencies.logger.debug("[TreeServiceManager] Starting service initialization...");

            // Initialize services that require async setup
            await this._initializeAsyncServices();

            // Perform optional validations in trace mode
            await this._performTraceValidations();

            this._isInitialized = true;
            this.dependencies.logger.info("[TreeServiceManager] All services initialized successfully");
        } catch (error) {
            this.dependencies.logger.error("[TreeServiceManager] Service initialization failed:", error);
            this._isInitialized = false;
            this._initializationPromise = null;
            throw error;
        }
    }

    /**
     * Initializes services that require asynchronous setup.
     *
     * @private
     */
    private async _initializeAsyncServices(): Promise<void> {
        await this.markedItemStateService.initialize();
        this.dependencies.logger.trace("[TreeServiceManager] MarkedItemStateService initialized");
    }

    /**
     * Performs validation checks when in trace logging mode.
     *
     * @private
     */
    private async _performTraceValidations(): Promise<void> {
        if (this.dependencies.logger.level === "Trace") {
            try {
                const iconValidation = await this.iconManagementService.validateIcons();
                if (iconValidation.invalid.length > 0) {
                    this.dependencies.logger.warn(
                        "[TreeServiceManager] Some icon files are missing:",
                        iconValidation.invalid
                    );
                }
            } catch (error) {
                this.dependencies.logger.warn("[TreeServiceManager] Icon validation failed:", error);
            }
        }
    }

    /**
     * Gets the current service initialization status.
     *
     * @returns True if all services are initialized, false otherwise
     */
    public getInitializationStatus(): boolean {
        return this._isInitialized;
    }

    /**
     * Creates a custom root service for a specific tree.
     *
     * This method provides a factory function for creating CustomRootService instances
     * with proper dependency injection and logging.
     *
     * @template T - The type of tree items this service will handle
     * @param contextKey - VS Code context key for this custom root
     * @param customContextValue - Context value to use when item is set as custom root
     * @param onStateChange - Optional callback for state change events
     * @returns A new CustomRootService instance
     */
    public createCustomRootService<T extends BaseTreeItem>(
        contextKey: string,
        customContextValue: string,
        onStateChange?: (state: any) => void
    ): CustomRootService<T> {
        const service = new CustomRootService<T>(
            this.dependencies.logger,
            contextKey,
            customContextValue,
            onStateChange
        );

        this.dependencies.logger.trace(`[TreeServiceManager] Created CustomRootService for context: ${contextKey}`);
        return service;
    }

    /**
     * Registers additional icon sets with the icon management service.
     *
     * @param category - The category name for the icon set
     * @param iconSet - The icon set configuration object
     */
    public registerIconSet(category: string, iconSet: Record<string, Record<string, any>>): void {
        this.iconManagementService.registerIconSet(category, iconSet);
        this.dependencies.logger.trace(`[TreeServiceManager] Registered icon set: ${category}`);
    }

    /**
     * Gets comprehensive health status for all managed services.
     *
     * @returns Array of service health information objects
     */
    public getServiceHealth(): ServiceHealthInfo[] {
        const now = new Date();
        const connection = this.dependencies.getConnection();

        return [
            {
                service: "IconManagementService",
                status: "active",
                details: `Categories: ${this.iconManagementService.getAvailableCategories().join(", ")}`,
                lastCheck: now
            },
            {
                service: "ProjectDataService",
                status: connection ? "active" : "waiting_for_connection",
                details: connection ? "Connected" : "No connection available",
                lastCheck: now
            },
            {
                service: "TestElementDataService",
                status: connection ? "active" : "waiting_for_connection",
                details: connection ? "Connected" : "No connection available",
                lastCheck: now
            },
            {
                service: "ResourceFileService",
                status: "active",
                details: "File operations ready",
                lastCheck: now
            },
            {
                service: "MarkedItemStateService",
                status: this._isInitialized ? "active" : "initializing",
                details: this.markedItemStateService.getActiveMarkedItemInfo() ? "has_marked_items" : "no_marked_items",
                lastCheck: now
            }
        ];
    }

    /**
     * Validates all service dependencies and external requirements.
     *
     * @returns Validation result with any detected issues
     */
    public async validateDependencies(): Promise<ValidationResult> {
        const issues: string[] = [];
        const timestamp = new Date();

        try {
            this._validateCoreDependencies(issues);
            this._validateWorkspaceAvailability(issues);
            await this._validateIconFiles(issues);
        } catch (error) {
            issues.push(`Validation error: ${error instanceof Error ? error.message : "Unknown error"}`);
        }

        return {
            valid: issues.length === 0,
            issues: Object.freeze(issues),
            timestamp
        };
    }

    /**
     * Validates core dependency availability.
     *
     * @private
     * @param issues - Array to collect validation issues
     */
    private _validateCoreDependencies(issues: string[]): void {
        if (!this.dependencies.extensionContext) {
            issues.push("Extension context not available");
        }

        if (!this.dependencies.logger) {
            issues.push("Logger not available");
        }

        if (!this.dependencies.getConnection) {
            issues.push("Connection factory not available");
        }
    }

    /**
     * Validates workspace folder availability.
     *
     * @private
     * @param issues - Array to collect validation issues
     */
    private _validateWorkspaceAvailability(issues: string[]): void {
        try {
            if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
                issues.push("No workspace folders available for resource operations");
            }
        } catch (error) {
            issues.push(
                "Error accessing workspace folders: " + (error instanceof Error ? error.message : "Unknown error")
            );
        }
    }

    /**
     * Validates icon file availability.
     *
     * @private
     * @param issues - Array to collect validation issues
     */
    private async _validateIconFiles(issues: string[]): Promise<void> {
        try {
            const iconValidation = await this.iconManagementService.validateIcons();
            if (iconValidation.invalid.length > 0) {
                issues.push(`${iconValidation.invalid.length} icon files are missing or invalid`);
            }
        } catch (error) {
            issues.push("Error validating icon files: " + (error instanceof Error ? error.message : "Unknown error"));
        }
    }

    /**
     * Resets all service state, useful for logout/login cycles.
     *
     * @throws Error if state reset fails
     */
    public async resetAllState(): Promise<void> {
        this.dependencies.logger.debug("[TreeServiceManager] Resetting all service state...");

        try {
            await this.markedItemStateService.clearMarking();
            this.dependencies.logger.info("[TreeServiceManager] All service state reset successfully");
        } catch (error) {
            this.dependencies.logger.error("[TreeServiceManager] Error resetting service state:", error);
            throw error;
        }
    }

    /**
     * Gets dependency injection object for tree providers.
     *
     * @returns Object containing all dependencies needed by tree data providers
     */
    public getProviderDependencies(): ProviderDependencies {
        return Object.freeze({
            extensionContext: this.dependencies.extensionContext,
            logger: this.dependencies.logger,
            iconManagementService: this.iconManagementService,
            projectDataService: this.projectDataService,
            testElementDataService: this.testElementDataService,
            resourceFileService: this.resourceFileService,
            markedItemStateService: this.markedItemStateService,
            createCustomRootService: this.createCustomRootService.bind(this)
        });
    }

    /**
     * Creates a service factory for consistent provider initialization.
     *
     * This factory ensures that all tree data providers are created with the same
     * dependencies and follows the same initialization pattern.
     *
     * @returns Service factory with methods to create different types of providers
     */
    public createServiceFactory(): TreeServiceFactory {
        if (!this._isInitialized) {
            this.dependencies.logger.warn("[TreeServiceManager] Creating factory before initialization is complete");
        }

        return Object.freeze({
            createProjectManagementProvider: (updateMessageCallback: (message: string | undefined) => void) => {
                return new ProjectManagementTreeDataProvider(
                    this.dependencies.extensionContext,
                    this.dependencies.logger,
                    this.iconManagementService,
                    updateMessageCallback,
                    this.projectDataService
                );
            },

            createTestThemeProvider: (updateMessageCallback: (message: string | undefined) => void) => {
                return new TestThemeTreeDataProvider(
                    this.dependencies.extensionContext,
                    this.dependencies.logger,
                    updateMessageCallback,
                    this.projectDataService,
                    this.markedItemStateService,
                    this.iconManagementService
                );
            },

            createTestElementsProvider: (updateMessageCallback: (message: string | undefined) => void) => {
                const treeBuilder = new TestElementTreeBuilder(this.dependencies.logger);

                return new TestElementsTreeDataProvider(
                    this.dependencies.extensionContext,
                    this.dependencies.logger,
                    updateMessageCallback,
                    this.testElementDataService,
                    this.resourceFileService,
                    this.iconManagementService,
                    treeBuilder
                );
            }
        });
    }

    /**
     * Disposes of all managed resources and services.
     *
     * This method should be called when the extension is deactivated to ensure
     * proper cleanup of all resources.
     */
    public dispose(): void {
        this.dependencies.logger.debug("[TreeServiceManager] Disposing services...");

        try {
            this._disposables.forEach((disposable) => {
                try {
                    disposable.dispose();
                } catch (error) {
                    this.dependencies.logger.warn("[TreeServiceManager] Error disposing resource:", error);
                }
            });
            this._disposables.length = 0;

            // Note: Add dispose calls here when services implement IDisposable
            // this.markedItemStateService.dispose?.();
            // this.iconManagementService.dispose?.();

            // Reset state
            this._isInitialized = false;
            this._initializationPromise = null;

            this.dependencies.logger.trace("[TreeServiceManager] Services disposed successfully");
        } catch (error) {
            this.dependencies.logger.error("[TreeServiceManager] Error during disposal:", error);
        }
    }

    /**
     * Adds a disposable resource to be cleaned up when the service manager is disposed.
     *
     * @param disposable - The disposable resource to track
     */
    public addDisposable(disposable: vscode.Disposable): void {
        this._disposables.push(disposable);
    }

    /**
     * Gets diagnostic information about the service manager state.
     *
     * @returns Object containing diagnostic information
     */
    public getDiagnostics(): Record<string, any> {
        return {
            isInitialized: this._isInitialized,
            hasInitializationPromise: this._initializationPromise !== null,
            disposableCount: this._disposables.length,
            serviceHealth: this.getServiceHealth(),
            timestamp: new Date().toISOString()
        };
    }
}
