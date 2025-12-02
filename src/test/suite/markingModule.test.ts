/**
 * @file src/test/suite/markingModule.test.ts
 * @description Tests for the MarkingModule functionality.
 */

import * as assert from "assert";
import { MarkingModule } from "../../treeViews/features/MarkingModule";
import { TreeViewContext } from "../../treeViews/core/TreeViewContext";
import { TreeItemBase } from "../../treeViews/core/TreeItemBase";
import { setupTestEnvironment, TestEnvironment } from "../setup/testSetup";

suite("MarkingModule", () => {
    let markingModule: MarkingModule;
    let mockContext: TreeViewContext;
    let mockItem: TreeItemBase;
    let testEnv: TestEnvironment;

    setup(() => {
        testEnv = setupTestEnvironment();
        markingModule = new MarkingModule();

        // Create mock context
        mockContext = {
            config: {
                id: "test",
                modules: {
                    marking: {
                        enabled: true,
                        showImportButton: true,
                        strategies: ["import"],
                        persistMarks: true,
                        allowPersistentImport: false,
                        markingContextValues: ["TestThemeNode"]
                    }
                }
            },
            logger: testEnv.logger,
            stateManager: {
                getState: () => ({}),
                setState: () => {}
            },
            eventBus: {
                emit: () => {},
                on: () => ({ dispose: () => {} })
            },
            refresh: () => {},
            buildLogPrefix: (moduleId: string, operation: string): string => {
                return `[${moduleId}:test] ${operation}`;
            }
        } as any;

        // Create mock item
        mockItem = {
            id: "test-item-1",
            label: "Test Item",
            originalContextValue: "TestThemeNode",
            setMetadata: () => {},
            getMetadata: () => undefined,
            updateContextValue: () => {}
        } as any;
    });

    teardown(() => {
        testEnv.sandbox.restore();
    });

    test("should respect showImportButton configuration when applying import marking", async () => {
        // Initialize the module
        await markingModule.initialize(mockContext);
        markingModule.setContextResolver(() => ({ projectKey: "project1", cycleKey: "cycle1", contextType: "cycle" }));

        // Mark an item for import
        markingModule.markItem(
            mockItem,
            { projectKey: "project1", cycleKey: "cycle1", contextType: "cycle" },
            "import"
        );

        // Test with showImportButton = true (should apply marking)
        if (mockContext.config.modules.marking) {
            mockContext.config.modules.marking.showImportButton = true;
        }
        let markedApplied = false;
        let markingInfoApplied: any = null;

        mockItem.setMetadata = (key: string, value: any) => {
            if (key === "marked") {
                markedApplied = value;
            } else if (key === "markingInfo") {
                markingInfoApplied = value;
            }
        };

        markingModule.applyMarkingToItem(mockItem);

        assert.strictEqual(markedApplied, true, "Marking should be applied when showImportButton is true");
        assert.notStrictEqual(
            markingInfoApplied,
            undefined,
            "Marking info should be applied when showImportButton is true"
        );

        // Test with showImportButton = false (should not apply import marking)
        if (mockContext.config.modules.marking) {
            mockContext.config.modules.marking.showImportButton = false;
        }
        markedApplied = false;
        markingInfoApplied = null;

        markingModule.applyMarkingToItem(mockItem);

        assert.strictEqual(markedApplied, false, "Import marking should not be applied when showImportButton is false");
        assert.strictEqual(
            markingInfoApplied,
            undefined,
            "Import marking info should not be applied when showImportButton is false"
        );
    });

    test("should apply non-import marking regardless of showImportButton setting", async () => {
        // Initialize the module
        await markingModule.initialize(mockContext);
        markingModule.setContextResolver(() => ({ projectKey: "project1", cycleKey: "cycle1", contextType: "cycle" }));

        // Mark an item for generation (not import)
        markingModule.markItem(
            mockItem,
            { projectKey: "project1", cycleKey: "cycle1", contextType: "cycle" },
            "generation"
        );

        // Test with showImportButton = false (should still apply generation marking)
        if (mockContext.config.modules.marking) {
            mockContext.config.modules.marking.showImportButton = false;
        }
        let markedApplied = false;
        let markingInfoApplied: any = null;

        mockItem.setMetadata = (key: string, value: any) => {
            if (key === "marked") {
                markedApplied = value;
            } else if (key === "markingInfo") {
                markingInfoApplied = value;
            }
        };

        markingModule.applyMarkingToItem(mockItem);

        assert.strictEqual(
            markedApplied,
            true,
            "Generation marking should be applied regardless of showImportButton setting"
        );
        assert.notStrictEqual(
            markingInfoApplied,
            undefined,
            "Generation marking info should be applied regardless of showImportButton setting"
        );
    });

    test("should emit global marking cleared event when clearing all markings", async () => {
        await markingModule.initialize(mockContext);
        markingModule.setContextResolver(() => ({ projectKey: "project1", cycleKey: "cycle1", contextType: "cycle" }));
        markingModule.markItem(
            mockItem,
            { projectKey: "project1", cycleKey: "cycle1", contextType: "cycle" },
            "import"
        );

        const emittedEvents: any[] = [];
        const originalEmit = mockContext.eventBus.emit;
        mockContext.eventBus.emit = (event: any) => {
            emittedEvents.push(event);
            return originalEmit(event);
        };

        markingModule.clearAllMarkings();

        assert.strictEqual(emittedEvents.length, 1, "One event should have been emitted");

        const emittedEvent = emittedEvents[0];
        assert.strictEqual(emittedEvent.type, "marking:cleared:global");
        assert.strictEqual(emittedEvent.source, mockContext.config.id);
        assert.strictEqual(emittedEvent.data.reason, "testGeneration");
        assert.ok(emittedEvent.data.timestamp, "Event should have a timestamp");
    });

    test("should not emit global marking cleared event when clearing all markings with emitGlobalEvent=false", async () => {
        await markingModule.initialize(mockContext);
        markingModule.setContextResolver(() => ({ projectKey: "project1", cycleKey: "cycle1", contextType: "cycle" }));
        markingModule.markItem(
            mockItem,
            { projectKey: "project1", cycleKey: "cycle1", contextType: "cycle" },
            "import"
        );

        const emittedEvents: any[] = [];
        const originalEmit = mockContext.eventBus.emit;
        mockContext.eventBus.emit = (event: any) => {
            emittedEvents.push(event);
            return originalEmit(event);
        };

        markingModule.clearAllMarkings(false);

        assert.strictEqual(emittedEvents.length, 0, "No events should have been emitted");
    });
});
