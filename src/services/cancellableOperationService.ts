/**
 * @file src/services/cancellableOperationService.ts
 * Service for managing cancellable background operations
 */

import * as vscode from "vscode";
import { TestBenchLogger } from "../testBenchLogger";

/**
 * Represents a cancellable operation with proper cleanup
 */
export class CancellableOperation implements vscode.Disposable {
    private _isCancelled = false;
    private readonly _cancellationToken: vscode.CancellationToken;
    private readonly _cancellationTokenSource: vscode.CancellationTokenSource;

    constructor(
        private readonly logger: TestBenchLogger,
        private readonly operationName: string
    ) {
        this._cancellationTokenSource = new vscode.CancellationTokenSource();
        this._cancellationToken = this._cancellationTokenSource.token;
    }

    /**
     * Gets the cancellation token for this operation
     */
    public get token(): vscode.CancellationToken {
        return this._cancellationToken;
    }

    /**
     * Checks if the operation has been cancelled
     */
    public get isCancelled(): boolean {
        return this._isCancelled || this._cancellationToken.isCancellationRequested;
    }

    /**
     * Cancels the operation
     */
    public cancel(): void {
        if (!this._isCancelled) {
            this._isCancelled = true;
            this._cancellationTokenSource.cancel();
            this.logger.trace(`[CancellableOperation] Cancelled operation: ${this.operationName}`);
        }
    }

    /**
     * Throws a cancellation error if the operation has been cancelled
     * @param context Additional context for the cancellation check (for logging only)
     */
    public throwIfCancelled(context?: string): void {
        if (this.isCancelled) {
            if (context) {
                this.logger.debug(
                    `[CancellableOperation] Operation '${this.operationName}' was cancelled during: ${context}`
                );
            } else {
                this.logger.debug(`[CancellableOperation] Operation '${this.operationName}' was cancelled`);
            }
            throw new vscode.CancellationError();
        }
    }

    /**
     * Creates a delay that respects cancellation
     * @param ms Milliseconds to delay
     */
    public async delay(ms: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.isCancelled) {
                this.logger.debug(`[CancellableOperation] Delay cancelled for operation: ${this.operationName}`);
                reject(new vscode.CancellationError());
                return;
            }

            const timeout = setTimeout(() => {
                if (this.isCancelled) {
                    this.logger.debug(`[CancellableOperation] Delay cancelled for operation: ${this.operationName}`);
                    reject(new vscode.CancellationError());
                } else {
                    resolve();
                }
            }, ms);

            this._cancellationToken.onCancellationRequested(() => {
                clearTimeout(timeout);
                this.logger.debug(`[CancellableOperation] Delay cancelled for operation: ${this.operationName}`);
                reject(new vscode.CancellationError());
            });
        });
    }
    /**
     * Disposes of the operation and its resources
     */
    public dispose(): void {
        this.cancel();
        this._cancellationTokenSource.dispose();
    }
}

/**
 * Service for managing multiple cancellable operations
 */
export class CancellableOperationManager implements vscode.Disposable {
    private readonly operations = new Map<string, CancellableOperation>();
    private readonly logger: TestBenchLogger;

    constructor(logger: TestBenchLogger) {
        this.logger = logger;
    }

    /**
     * Creates a new cancellable operation
     * @param operationId Unique identifier for the operation
     * @param operationName Human-readable name for the operation
     * @returns The created operation
     */
    public createOperation(operationId: string, operationName: string): CancellableOperation {
        this.cancelOperation(operationId);

        const operation = new CancellableOperation(this.logger, operationName);
        this.operations.set(operationId, operation);

        this.logger.trace(`[CancellableOperationManager] Created operation: ${operationName} (${operationId})`);
        return operation;
    }

    /**
     * Cancels a specific operation
     * @param operationId The ID of the operation to cancel
     */
    public cancelOperation(operationId: string): void {
        const operation = this.operations.get(operationId);
        if (operation) {
            operation.dispose();
            this.operations.delete(operationId);
            this.logger.trace(`[CancellableOperationManager] Cancelled operation: ${operationId}`);
        }
    }

    /**
     * Cancels all operations
     */
    public cancelAllOperations(): void {
        this.logger.trace(`[CancellableOperationManager] Cancelling ${this.operations.size} operations`);

        this.operations.forEach((operation, operationId) => {
            try {
                operation.dispose();
            } catch (error) {
                this.logger.error(`[CancellableOperationManager] Error disposing operation ${operationId}:`, error);
            }
        });

        this.operations.clear();
    }

    /**
     * Gets the count of active operations
     */
    public get activeOperationCount(): number {
        return this.operations.size;
    }

    /**
     * Disposes of the manager and all operations
     */
    public dispose(): void {
        this.cancelAllOperations();
    }
}
