/**
 * @file src/test/suite/treeViews/ProjectsTreeItem.test.ts
 * @description Unit tests for the ProjectsTreeItem class
 */

import assert from "assert";
import * as vscode from "vscode";
import { ProjectsTreeItem, ProjectData } from "../../../treeViews/implementations/projects/ProjectsTreeItem";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { allExtensionCommands } from "../../../constants";

suite("ProjectsTreeItem", function () {
    let testEnv: TestEnvironment;
    let mockContext: vscode.ExtensionContext;

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockContext = testEnv.mockContext;
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("Constructor and Basic Properties", () => {
        test("should create project tree item with correct properties", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Test Project",
                description: "A test project",
                type: "project",
                metadata: {
                    tovsCount: 5,
                    cyclesCount: 10
                }
            };

            const item = new ProjectsTreeItem(projectData, mockContext);

            assert.strictEqual(item.label, "Test Project");
            assert.strictEqual(item.data.key, "PROJ-001");
            assert.strictEqual(item.data.type, "project");
            assert.strictEqual(item.contextValue, "Project");
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });

        test("should create version tree item with correct properties", () => {
            const versionData: ProjectData = {
                key: "VERSION-001",
                name: "Test Version",
                type: "version",
                parentKey: "PROJ-001"
            };

            const item = new ProjectsTreeItem(versionData, mockContext);

            assert.strictEqual(item.label, "Test Version");
            assert.strictEqual(item.data.key, "VERSION-001");
            assert.strictEqual(item.data.type, "version");
            assert.strictEqual(item.contextValue, "Version");
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });

        test("should create cycle tree item with correct properties and command", () => {
            const cycleData: ProjectData = {
                key: "CYCLE-001",
                name: "Test Cycle",
                type: "cycle",
                parentKey: "VERSION-001"
            };

            const item = new ProjectsTreeItem(cycleData, mockContext);

            assert.strictEqual(item.label, "Test Cycle");
            assert.strictEqual(item.data.key, "CYCLE-001");
            assert.strictEqual(item.data.type, "cycle");
            assert.strictEqual(item.contextValue, "Cycle");
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
            assert.deepStrictEqual(item.command, {
                command: allExtensionCommands.handleProjectCycleClick,
                title: "Select Cycle",
                arguments: [item]
            });
        });

        test("should use key as fallback when name is missing", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "",
                type: "project"
            };

            const item = new ProjectsTreeItem(projectData, mockContext);

            assert.strictEqual(item.label, "PROJ-001");
        });

        test("should set parent when provided", () => {
            const parentData: ProjectData = {
                key: "PROJ-001",
                name: "Parent Project",
                type: "project"
            };
            const childData: ProjectData = {
                key: "VERSION-001",
                name: "Child Version",
                type: "version",
                parentKey: "PROJ-001"
            };

            const parent = new ProjectsTreeItem(parentData, mockContext);
            const child = new ProjectsTreeItem(childData, mockContext, parent);

            assert.strictEqual(child.parent, parent);
        });
    });

    suite("Unique ID Generation", () => {
        test("should generate unique ID for project", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Test Project",
                type: "project"
            };

            const item = new ProjectsTreeItem(projectData, mockContext);
            const expectedId = "project::PROJ-001";
            assert.strictEqual(item.id, expectedId);
        });

        test("should generate unique ID for version with parent", () => {
            const parentData: ProjectData = {
                key: "PROJ-001",
                name: "Parent Project",
                type: "project"
            };
            const versionData: ProjectData = {
                key: "VERSION-001",
                name: "Test Version",
                type: "version",
                parentKey: "PROJ-001"
            };

            const parent = new ProjectsTreeItem(parentData, mockContext);
            const version = new ProjectsTreeItem(versionData, mockContext, parent);
            const expectedId = "version:PROJ-001:VERSION-001";
            assert.strictEqual(version.id, expectedId);
        });

        test("should generate unique ID for cycle with parent", () => {
            const parentData: ProjectData = {
                key: "VERSION-001",
                name: "Parent Version",
                type: "version"
            };
            const cycleData: ProjectData = {
                key: "CYCLE-001",
                name: "Test Cycle",
                type: "cycle",
                parentKey: "VERSION-001"
            };

            const parent = new ProjectsTreeItem(parentData, mockContext);
            const cycle = new ProjectsTreeItem(cycleData, mockContext, parent);
            const expectedId = "cycle:VERSION-001:CYCLE-001";
            assert.strictEqual(cycle.id, expectedId);
        });
    });

    suite("Tooltip Generation", () => {
        test("should generate tooltip for project with metadata", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Test Project",
                description: "A test project description",
                type: "project",
                metadata: {
                    tovsCount: 5,
                    cyclesCount: 10
                }
            };

            const item = new ProjectsTreeItem(projectData, mockContext);
            const tooltip = item.tooltip as string;

            assert(tooltip.includes("Type: project"));
            assert(tooltip.includes("Name: Test Project"));
            assert(tooltip.includes("Key: PROJ-001"));
            assert(tooltip.includes("TOVs: 5"));
            assert(tooltip.includes("Cycles: 10"));
            assert(tooltip.includes("Description: A test project description"));
        });

        test("should generate tooltip for version without description", () => {
            const versionData: ProjectData = {
                key: "VERSION-001",
                name: "Test Version",
                type: "version"
            };

            const item = new ProjectsTreeItem(versionData, mockContext);
            const tooltip = item.tooltip as string;

            assert(tooltip.includes("Type: version"));
            assert(tooltip.includes("Name: Test Version"));
            assert(tooltip.includes("Key: VERSION-001"));
            assert(!tooltip.includes("Description:"));
        });

        test("should generate tooltip for cycle", () => {
            const cycleData: ProjectData = {
                key: "CYCLE-001",
                name: "Test Cycle",
                type: "cycle"
            };

            const item = new ProjectsTreeItem(cycleData, mockContext);
            const tooltip = item.tooltip as string;

            assert(tooltip.includes("Type: cycle"));
            assert(tooltip.includes("Name: Test Cycle"));
            assert(tooltip.includes("Key: CYCLE-001"));
        });
    });

    suite("Tree Navigation Methods", () => {
        test("should get project key for project item", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Test Project",
                type: "project"
            };

            const item = new ProjectsTreeItem(projectData, mockContext);
            assert.strictEqual(item.getProjectKey(), "PROJ-001");
        });

        test("should get project key for version item by traversing up", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Parent Project",
                type: "project"
            };
            const versionData: ProjectData = {
                key: "VERSION-001",
                name: "Test Version",
                type: "version",
                parentKey: "PROJ-001"
            };

            const project = new ProjectsTreeItem(projectData, mockContext);
            const version = new ProjectsTreeItem(versionData, mockContext, project);

            assert.strictEqual(version.getProjectKey(), "PROJ-001");
        });

        test("should get project key for cycle item by traversing up", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Parent Project",
                type: "project"
            };
            const versionData: ProjectData = {
                key: "VERSION-001",
                name: "Parent Version",
                type: "version",
                parentKey: "PROJ-001"
            };
            const cycleData: ProjectData = {
                key: "CYCLE-001",
                name: "Test Cycle",
                type: "cycle",
                parentKey: "VERSION-001"
            };

            const project = new ProjectsTreeItem(projectData, mockContext);
            const version = new ProjectsTreeItem(versionData, mockContext, project);
            const cycle = new ProjectsTreeItem(cycleData, mockContext, version);

            assert.strictEqual(cycle.getProjectKey(), "PROJ-001");
        });

        test("should return null for project key when no project ancestor found", () => {
            const versionData: ProjectData = {
                key: "VERSION-001",
                name: "Test Version",
                type: "version"
            };

            const item = new ProjectsTreeItem(versionData, mockContext);
            assert.strictEqual(item.getProjectKey(), null);
        });

        test("should get version key for version item", () => {
            const versionData: ProjectData = {
                key: "VERSION-001",
                name: "Test Version",
                type: "version"
            };

            const item = new ProjectsTreeItem(versionData, mockContext);
            assert.strictEqual(item.getVersionKey(), "VERSION-001");
        });

        test("should get version key for cycle item by traversing up", () => {
            const versionData: ProjectData = {
                key: "VERSION-001",
                name: "Parent Version",
                type: "version"
            };
            const cycleData: ProjectData = {
                key: "CYCLE-001",
                name: "Test Cycle",
                type: "cycle",
                parentKey: "VERSION-001"
            };

            const version = new ProjectsTreeItem(versionData, mockContext);
            const cycle = new ProjectsTreeItem(cycleData, mockContext, version);

            assert.strictEqual(cycle.getVersionKey(), "VERSION-001");
        });

        test("should return null for version key when no version ancestor found", () => {
            const cycleData: ProjectData = {
                key: "CYCLE-001",
                name: "Test Cycle",
                type: "cycle"
            };

            const item = new ProjectsTreeItem(cycleData, mockContext);
            assert.strictEqual(item.getVersionKey(), null);
        });

        test("should get cycle key for cycle item", () => {
            const cycleData: ProjectData = {
                key: "CYCLE-001",
                name: "Test Cycle",
                type: "cycle"
            };

            const item = new ProjectsTreeItem(cycleData, mockContext);
            assert.strictEqual(item.getCycleKey(), "CYCLE-001");
        });

        test("should return null for cycle key when not a cycle", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Test Project",
                type: "project"
            };

            const item = new ProjectsTreeItem(projectData, mockContext);
            assert.strictEqual(item.getCycleKey(), null);
        });
    });

    suite("Data Management", () => {
        test("should update data correctly", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Original Name",
                description: "Original Description",
                type: "project"
            };

            const item = new ProjectsTreeItem(projectData, mockContext);

            item.updateData({
                name: "Updated Name",
                description: "Updated Description"
            });

            assert.strictEqual(item.data.name, "Updated Name");
            assert.strictEqual(item.data.description, "Updated Description");
            assert.strictEqual(item.label, "Updated Name");
            assert.strictEqual(item.description, "Updated Description");
        });

        test("should update tooltip after data update", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Original Name",
                type: "project"
            };

            const item = new ProjectsTreeItem(projectData, mockContext);
            const originalTooltip = item.tooltip;

            item.updateData({
                name: "Updated Name",
                description: "New Description"
            });

            assert.notStrictEqual(item.tooltip, originalTooltip);
            assert((item.tooltip as string).includes("Updated Name"));
            assert((item.tooltip as string).includes("New Description"));
        });
    });

    suite("Context Value Management", () => {
        test("should update context value for project", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Test Project",
                type: "project"
            };

            const item = new ProjectsTreeItem(projectData, mockContext);
            assert.strictEqual(item.contextValue, "Project");

            item.setMetadata("isCustomRoot", true);
            item.updateContextValue();

            assert.strictEqual(item.contextValue, "customRoot.Project");
        });

        test("should update context value for version", () => {
            const versionData: ProjectData = {
                key: "VERSION-001",
                name: "Test Version",
                type: "version"
            };

            const item = new ProjectsTreeItem(versionData, mockContext);
            assert.strictEqual(item.contextValue, "Version");

            item.setMetadata("isCustomRoot", true);
            item.updateContextValue();

            assert.strictEqual(item.contextValue, "customRoot.Version");
        });

        test("should update context value for cycle", () => {
            const cycleData: ProjectData = {
                key: "CYCLE-001",
                name: "Test Cycle",
                type: "cycle"
            };

            const item = new ProjectsTreeItem(cycleData, mockContext);
            assert.strictEqual(item.contextValue, "Cycle");

            item.setMetadata("isCustomRoot", true);
            item.updateContextValue();

            assert.strictEqual(item.contextValue, "customRoot.Cycle");
        });

        test("should handle unknown type in context value", () => {
            const unknownData: ProjectData = {
                key: "UNKNOWN-001",
                name: "Unknown Item",
                type: "project" // This will be overridden in the test
            };

            const item = new ProjectsTreeItem(unknownData, mockContext);

            // Manually set an unknown type to test the fallback
            (item as any).data.type = "unknown";
            item.updateContextValue();

            assert.strictEqual(item.contextValue, "Other");
        });
    });

    suite("Serialization and Deserialization", () => {
        test("should serialize tree item correctly", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Test Project",
                description: "Test Description",
                type: "project",
                metadata: {
                    tovsCount: 5
                }
            };

            const item = new ProjectsTreeItem(projectData, mockContext);
            item.setMetadata("customKey", "customValue");

            const serialized = item.serialize();

            assert.deepStrictEqual(serialized.data, projectData);
            assert.strictEqual(serialized.id, item.id);
            assert.strictEqual(serialized.label, item.label);
            assert.strictEqual(serialized.description, item.description);
            assert.strictEqual(serialized.contextValue, item.contextValue);
            assert.strictEqual(serialized.collapsibleState, item.collapsibleState);
            assert(Array.isArray(serialized.metadata));
        });

        test("should deserialize tree item correctly", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Test Project",
                description: "Test Description",
                type: "project"
            };

            const originalItem = new ProjectsTreeItem(projectData, mockContext);
            originalItem.setMetadata("customKey", "customValue");

            const serialized = originalItem.serialize();
            const deserialized = ProjectsTreeItem.deserialize(
                serialized,
                mockContext,
                ProjectsTreeItem.createDeserializer()
            );

            assert.strictEqual(deserialized.data.key, originalItem.data.key);
            assert.strictEqual(deserialized.data.name, originalItem.data.name);
            assert.strictEqual(deserialized.data.type, originalItem.data.type);
            assert.strictEqual(deserialized.getMetadata("customKey"), "customValue");
            assert.strictEqual(deserialized.collapsibleState, originalItem.collapsibleState);
        });

        test("should deserialize with parent correctly", () => {
            const parentData: ProjectData = {
                key: "PROJ-001",
                name: "Parent Project",
                type: "project"
            };
            const childData: ProjectData = {
                key: "VERSION-001",
                name: "Child Version",
                type: "version",
                parentKey: "PROJ-001"
            };

            const parent = new ProjectsTreeItem(parentData, mockContext);
            const child = new ProjectsTreeItem(childData, mockContext, parent);

            const serialized = child.serialize();
            const deserialized = ProjectsTreeItem.deserializeWithParent(serialized, mockContext, parent);

            assert.strictEqual(deserialized.parent, parent);
            assert.strictEqual(deserialized.data.key, child.data.key);
        });

        test("should create deserializer function correctly", () => {
            const parentData: ProjectData = {
                key: "PROJ-001",
                name: "Parent Project",
                type: "project"
            };
            const parent = new ProjectsTreeItem(parentData, mockContext);

            const deserializer = ProjectsTreeItem.createDeserializer(parent, mockContext);
            const childData: ProjectData = {
                key: "VERSION-001",
                name: "Child Version",
                type: "version"
            };

            const child = deserializer({ data: childData });

            assert(child instanceof ProjectsTreeItem);
            assert.strictEqual(child.parent, parent);
            assert.strictEqual(child.data.key, "VERSION-001");
        });
    });

    suite("Cloning", () => {
        test("should clone tree item correctly", () => {
            const projectData: ProjectData = {
                key: "PROJ-001",
                name: "Test Project",
                type: "project"
            };
            const item = new ProjectsTreeItem(projectData, mockContext);
            const clone = item.clone();
            assert.notStrictEqual(clone, item, "Clone should be a different object");
            assert.strictEqual(clone.id, item.id, "Clone should have the same id");
            assert.deepStrictEqual(clone.data, item.data, "Clone should have the same data");
        });

        test("should clone with parent correctly", () => {
            const parentData: ProjectData = {
                key: "PROJ-001",
                name: "Parent Project",
                type: "project"
            };
            const childData: ProjectData = {
                key: "VERSION-001",
                name: "Child Version",
                type: "version",
                parentKey: "PROJ-001"
            };

            const parent = new ProjectsTreeItem(parentData, mockContext);
            const child = new ProjectsTreeItem(childData, mockContext, parent);

            const clonedChild = child.clone();

            assert.strictEqual(clonedChild.parent, parent);
            assert.strictEqual(clonedChild.data.key, child.data.key);
        });
    });
});
