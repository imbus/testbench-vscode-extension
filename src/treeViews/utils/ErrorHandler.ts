/**
 * @file src/treeViews/utils/ErrorHandler.ts
 * @description Centralized error handling for tree views with configurable strategies.
 */

import { TestBenchLogger } from "../../testBenchLogger";
import { TreeViewTiming } from "../../constants";

export type ErrorHandlingStrategy = "silent" | "notify" | "throw";

export interface ErrorInfo {
    error: Error;
    context: string;
    timestamp: Date;
    handled: boolean;
    strategy: ErrorHandlingStrategy;
    metadata?: Record<string, any>;
}

export interface ErrorHandlerConfig {
    strategy?: ErrorHandlingStrategy;
    showErrorDetails?: boolean;
    logErrors?: boolean;
    maxHistorySize?: number;
    customHandlers?: Map<string, (error: Error, context: string) => void>;
}

export class ErrorHandler {
    private history: ErrorInfo[] = [];
    private maxHistorySize: number;
    private showErrorDetails: boolean;
    private logErrors: boolean;
    private customHandlers: Map<string, (error: Error, context: string) => void>;

    constructor(private readonly logger: TestBenchLogger) {
        this.maxHistorySize = TreeViewTiming.ERROR_HISTORY_MAX_SIZE;
        this.showErrorDetails = false;
        this.logErrors = true;
        this.customHandlers = new Map();
    }

    /**
     * Handle an error with the configured strategy
     * @param error The error to handle
     * @param message The message to log
     * @param fallbackValue The fallback value to return
     * @return The fallback value
     */
    public handle<T>(error: Error, message: string, fallbackValue: T): T {
        this.logger.error(message, error);
        return fallbackValue;
    }

    /**
     * Handle an error without returning a value (for void operations)
     * @param error The error to handle
     * @param message The message to log
     */
    public handleVoid(error: Error, message: string): void {
        this.logger.error(message, error);
    }

    /**
     * Handle an async error
     * @param promise The promise to handle
     * @param context The context of the error
     * @param fallbackValue The fallback value to return
     * @return The fallback value
     */
    public async handleAsync<T>(promise: Promise<T>, context: string, fallbackValue: T): Promise<T> {
        try {
            return await promise;
        } catch (error) {
            return this.handle(error instanceof Error ? error : new Error(String(error)), context, fallbackValue);
        }
    }

    /**
     * Handle an async error without return value
     * @param promise The promise to handle
     * @param context The context of the error
     */
    public async handleAsyncVoid(promise: Promise<void>, context: string): Promise<void> {
        try {
            await promise;
        } catch (error) {
            this.handleVoid(error instanceof Error ? error : new Error(String(error)), context);
        }
    }

    /**
     * Wrap a function with error handling
     * @param fn The function to wrap
     * @param context The context of the error
     * @param fallbackValue The fallback value to return
     * @return The wrapped function
     */
    public wrap<T extends (...args: any[]) => any>(fn: T, context: string, fallbackValue: ReturnType<T>): T {
        return ((...args: Parameters<T>) => {
            try {
                const result = fn(...args);
                if (result instanceof Promise) {
                    return this.handleAsync(result, context, fallbackValue);
                }
                return result;
            } catch (error) {
                return this.handle(error instanceof Error ? error : new Error(String(error)), context, fallbackValue);
            }
        }) as T;
    }

    /**
     * Wrap a void function with error handling
     * @param fn The function to wrap
     * @param context The context of the error
     * @return The wrapped function
     */
    public wrapVoid<T extends (...args: any[]) => void | Promise<void>>(fn: T, context: string): T {
        return ((...args: Parameters<T>) => {
            try {
                const result = fn(...args);
                if (result instanceof Promise) {
                    return this.handleAsyncVoid(result, context);
                }
                return result;
            } catch (error) {
                this.handleVoid(error instanceof Error ? error : new Error(String(error)), context);
            }
        }) as T;
    }

    /**
     * Create a scoped error handler with a specific context
     * @param context The context of the error
     * @return The scoped error handler
     */
    public createScoped(context: string): ScopedErrorHandler {
        return new ScopedErrorHandler(this, context);
    }

    /**
     * Register a custom error handler for a specific context
     * @param context The context of the error
     */
    public registerHandler(context: string, handler: (error: Error, context: string) => void): void {
        this.customHandlers.set(context, handler);
    }

    /**
     * Get error history
     * @return The error history
     */
    public getHistory(): ErrorInfo[] {
        return [...this.history];
    }

    /**
     * Clear error history
     */
    public clearHistory(): void {
        this.history = [];
    }

    /**
     * Get error statistics
     * @return The error statistics
     */
    public getStats(): {
        total: number;
        byContext: Map<string, number>;
        byType: Map<string, number>;
        handled: number;
        unhandled: number;
    } {
        const byContext = new Map<string, number>();
        const byType = new Map<string, number>();
        let handled = 0;
        let unhandled = 0;

        for (const error of this.history) {
            // Count by context
            const contextCount = byContext.get(error.context) ?? 0;
            byContext.set(error.context, contextCount + 1);

            // Count by error type
            const errorType = error.error.constructor.name;
            const typeCount = byType.get(errorType) ?? 0;
            byType.set(errorType, typeCount + 1);

            // Count handled/unhandled
            if (error.handled) {
                handled++;
            } else {
                unhandled++;
            }
        }

        return {
            total: this.history.length,
            byContext,
            byType,
            handled,
            unhandled
        };
    }
}

/**
 * Scoped error handler for a specific context
 */
export class ScopedErrorHandler {
    constructor(
        private readonly handler: ErrorHandler,
        private readonly context: string
    ) {}

    /**
     * Handle an error with the configured strategy
     * @param error The error to handle
     * @param fallbackValue The fallback value to return
     */
    public handle<T>(error: Error, fallbackValue: T): T {
        return this.handler.handle(error, this.context, fallbackValue);
    }

    /**
     * Handle an error without returning a value (for void operations)
     * @param error The error to handle
     */
    public handleVoid(error: Error): void {
        return this.handler.handleVoid(error, this.context);
    }

    /**
     * Handle an async error
     * @param promise The promise to handle
     * @param fallbackValue The fallback value to return
     * @return The fallback value
     */
    public async handleAsync<T>(promise: Promise<T>, fallbackValue: T): Promise<T> {
        return this.handler.handleAsync(promise, this.context, fallbackValue);
    }

    /**
     * Handle an async error without return value
     * @param promise The promise to handle
     * @return The promise
     */
    public async handleAsyncVoid(promise: Promise<void>): Promise<void> {
        return this.handler.handleAsyncVoid(promise, this.context);
    }

    /**
     * Wrap a function with error handling
     * @param fn The function to wrap
     * @param fallbackValue The fallback value to return
     * @return The wrapped function
     */
    public wrap<T extends (...args: any[]) => any>(fn: T, fallbackValue: ReturnType<T>): T {
        return this.handler.wrap(fn, this.context, fallbackValue);
    }

    /**
     * Wrap a void function with error handling
     * @param fn The function to wrap
     * @return The wrapped function
     */
    public wrapVoid<T extends (...args: any[]) => void | Promise<void>>(fn: T): T {
        return this.handler.wrapVoid(fn, this.context);
    }
}
