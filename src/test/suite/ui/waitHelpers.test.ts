/**
 * @file src/test/suite/ui/waitHelpers.test.ts
 * @description Unit tests for wait utility helpers.
 */

import * as assert from "assert";
import type { WebDriver } from "vscode-extension-tester";
import { applySlowMotion, waitForCondition, waitForTreeRefresh } from "../../ui/utils/waitHelpers";

suite("Wait Helpers", () => {
    function createPollingDriver(collectedSleeps: number[]): WebDriver {
        return {
            sleep: async (delay: number): Promise<void> => {
                collectedSleeps.push(delay);
            },
            wait: async (
                condition: () => Promise<boolean>,
                timeout: number = 0,
                message?: string,
                pollTimeout: number = 0
            ): Promise<boolean> => {
                const maxAttempts = Math.max(1, Math.ceil(timeout / Math.max(1, pollTimeout)) + 1);

                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    if (await condition()) {
                        return true;
                    }

                    if (attempt < maxAttempts - 1) {
                        collectedSleeps.push(pollTimeout);
                    }
                }

                throw new Error(message || "Wait timed out");
            }
        } as unknown as WebDriver;
    }

    test("waitForCondition returns true when condition eventually succeeds", async () => {
        const sleeps: number[] = [];
        const driver = createPollingDriver(sleeps);

        let attempts = 0;
        const succeeded = await waitForCondition(
            driver,
            async () => {
                attempts++;
                return attempts >= 3;
            },
            50,
            1,
            "eventual success"
        );

        assert.strictEqual(succeeded, true);
        assert.strictEqual(attempts, 3);
        assert.strictEqual(sleeps.length, 2);
    });

    test("waitForCondition tolerates thrown errors and times out", async () => {
        const sleeps: number[] = [];
        const driver = createPollingDriver(sleeps);

        const succeeded = await waitForCondition(
            driver,
            async () => {
                throw new Error("transient failure");
            },
            10,
            1,
            "always throwing condition"
        );

        assert.strictEqual(succeeded, false);
        assert.ok(sleeps.length > 0);
    });

    test("applySlowMotion sleeps for the custom delay", async () => {
        const sleeps: number[] = [];
        const driver = createPollingDriver(sleeps);

        await applySlowMotion(driver, 25);

        assert.deepStrictEqual(sleeps, [25]);
    });

    test("applySlowMotion skips sleep for zero custom delay", async () => {
        const sleeps: number[] = [];
        const driver = createPollingDriver(sleeps);

        await applySlowMotion(driver, 0);

        assert.deepStrictEqual(sleeps, []);
    });

    test("waitForTreeRefresh checks provided section before global sidebar scan", async () => {
        const sleeps: number[] = [];
        const driver = createPollingDriver(sleeps);

        const section = {
            getVisibleItems: async (): Promise<unknown[]> => ["item"]
        };

        const refreshed = await waitForTreeRefresh(driver, section, 50);

        assert.strictEqual(refreshed, true);
        assert.deepStrictEqual(sleeps, []);
    });
});
