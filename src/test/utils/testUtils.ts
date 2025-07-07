/**
 * @file src/test/utils/testUtils.ts
 * @description Common test utilities, assertion helpers, and async test helpers.
 */

import * as vscode from "vscode";

/**
 * Creates a promise that resolves after a specified number of milliseconds.
 * Useful for waiting for asynchronous operations to complete in tests.
 * @param ms - The number of milliseconds to wait.
 */
export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Awaits a specific event from a VS Code EventEmitter.
 * Rejects if the event does not fire within the specified timeout.
 * @param event - The vscode.Event to listen to.
 * @param timeout - The maximum time to wait in milliseconds.
 * @returns A promise that resolves with the event's payload.
 */
export function waitForEvent<T>(event: vscode.Event<T>, timeout: number = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Event did not fire within ${timeout}ms`));
            listener.dispose();
        }, timeout);

        const listener = event((e) => {
            clearTimeout(timer);
            resolve(e);
            listener.dispose();
        });
    });
}
