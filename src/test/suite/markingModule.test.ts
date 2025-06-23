/**
 * @file src/test/suite/markingModule.test.ts
 * @description Tests for the MarkingModule functionality.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { MarkingModule } from "../../treeViews/features/marking/MarkingModule";
import { TreeViewContext } from "../../treeViews/core/TreeViewContext";
import { TreeItemBase } from "../../treeViews/core/TreeItemBase";
import { TreeViewConfig } from "../../treeViews/core/TreeViewConfig";

suite("MarkingModule", () => {
    let markingModule: MarkingModule;
    let mockContext: TreeViewContext;
    let mockItem: TreeItemBase;

    setup(() => {
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
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {}
            },
            stateManager: {
                getState: () => ({}),
                setState: () => {}
            },
            eventBus: {
                emit: () => {},
                on: () => ({ dispose: () => {} })
            },
            refresh: () => {}
        } as any;

        // Create mock item
        mockItem = {
            id: "test-item-1",
            label: "Test Item",
            originalContextValue: "TestThemeNode",
            setMetadata: () => {},
            getMetadata: () => undefined
        } as any;
    });

    test("should respect showImportButton configuration when applying import marking", async () => {
        // Initialize the module
        await markingModule.initialize(mockContext);

        // Mark an item for import
        markingModule.markItem(mockItem, "project1", "cycle1", "import");

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

        // Mark an item for generation (not import)
        markingModule.markItem(mockItem, "project1", "cycle1", "generation");

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
});
