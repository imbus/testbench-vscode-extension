/**
 * @file src/test/suite/treeViews/ProjectsDataProvider.test.ts
 * @description Unit tests for the ProjectsDataProvider class
 */

import * as assert from "assert";
import * as sinon from "sinon";
import { ProjectsDataProvider } from "../../../treeViews/implementations/projects/ProjectsDataProvider";
import { ProjectData } from "../../../treeViews/implementations/projects/ProjectsTreeItem";
import { PlayServerConnection } from "../../../testBenchConnection";
import { TreeNode, Project } from "../../../testBenchTypes";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { TestBenchLogger } from "../../../testBenchLogger";

suite("ProjectsDataProvider", function () {
    let testEnv: TestEnvironment;
    let dataProvider: ProjectsDataProvider;
    let mockConnection: sinon.SinonStubbedInstance<PlayServerConnection>;
    let mockLogger: sinon.SinonStubbedInstance<TestBenchLogger>;
    let getConnectionStub: sinon.SinonStub;

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockConnection = testEnv.sandbox.createStubInstance(PlayServerConnection);
        mockLogger = testEnv.sandbox.createStubInstance(TestBenchLogger);

        getConnectionStub = testEnv.sandbox.stub();
        getConnectionStub.returns(mockConnection);

        dataProvider = new ProjectsDataProvider(mockLogger, getConnectionStub);
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
    });

    suite("Constructor", () => {
        test("should create data provider with dependencies", () => {
            assert.strictEqual(dataProvider instanceof ProjectsDataProvider, true);
        });
    });

    suite("fetchAndTransformProjects", () => {
        test("should fetch and transform projects successfully", async () => {
            const mockProjectsFromServer: Project[] = [
                {
                    key: "PROJ-001",
                    name: "Test Project 1",
                    description: "First test project",
                    creationTime: "2023-01-01T00:00:00Z",
                    status: "ACTIVE",
                    visibility: true,
                    tovsCount: 5,
                    cyclesCount: 10,
                    lockerKey: "LOCKER-001",
                    startDate: "2023-01-01",
                    endDate: "2023-12-31"
                },
                {
                    key: "PROJ-002",
                    name: "Test Project 2",
                    description: "Second test project",
                    creationTime: "2023-02-01T00:00:00Z",
                    status: "ACTIVE",
                    visibility: false,
                    tovsCount: 3,
                    cyclesCount: 7,
                    lockerKey: "LOCKER-002",
                    startDate: "2023-02-01",
                    endDate: "2023-11-30"
                }
            ];

            mockConnection.getProjectsList.resolves(mockProjectsFromServer);

            const result = await dataProvider.fetchAndTransformProjects();

            assert.notStrictEqual(result, null);
            assert.strictEqual(result!.length, 2);
            assert.strictEqual(result![0].key, "PROJ-001");
            assert.strictEqual(result![0].name, "Test Project 1");
            assert.strictEqual(result![0].type, "project");
            assert.strictEqual(result![0].metadata?.tovsCount, 5);
            assert.strictEqual(result![0].metadata?.cyclesCount, 10);

            assert.strictEqual(result![1].key, "PROJ-002");
            assert.strictEqual(result![1].name, "Test Project 2");
            assert.strictEqual(result![1].type, "project");
            assert.strictEqual(result![1].metadata?.tovsCount, 3);
            assert.strictEqual(result![1].metadata?.cyclesCount, 7);

            sinon.assert.calledOnce(mockConnection.getProjectsList);
        });

        test("should handle empty projects response", async () => {
            mockConnection.getProjectsList.resolves([]);

            const result = await dataProvider.fetchAndTransformProjects();

            assert.notStrictEqual(result, null);
            assert.strictEqual(result!.length, 0);
        });

        test("should handle null projects response", async () => {
            mockConnection.getProjectsList.resolves(null);

            const result = await dataProvider.fetchAndTransformProjects();

            assert.notStrictEqual(result, null);
            assert.strictEqual(result!.length, 0);
        });

        test("should handle invalid project data", async () => {
            const mockProjectsFromServer: any[] = [
                // Only one valid project
                {
                    key: "PROJ-001",
                    name: "Valid Project",
                    type: "project",
                    creationTime: "2023-01-01T00:00:00Z",
                    status: "ACTIVE",
                    visibility: true,
                    tovsCount: 5,
                    cyclesCount: 10,
                    description: "Valid project",
                    lockerKey: null,
                    startDate: null,
                    endDate: null
                },
                null, // Invalid project
                {
                    // Missing key
                    name: "Invalid Project",
                    type: "project",
                    creationTime: "2023-01-01T00:00:00Z",
                    status: "ACTIVE",
                    visibility: true,
                    tovsCount: 5,
                    cyclesCount: 10,
                    description: "Invalid project",
                    lockerKey: null,
                    startDate: null,
                    endDate: null
                },
                {
                    key: 123, // Invalid (non string) key type
                    name: "Invalid Project 2",
                    type: "project",
                    creationTime: "2023-01-01T00:00:00Z",
                    status: "ACTIVE",
                    visibility: true,
                    tovsCount: 5,
                    cyclesCount: 10,
                    description: "Invalid project",
                    lockerKey: null,
                    startDate: null,
                    endDate: null
                }
            ];

            mockConnection.getProjectsList.resolves(mockProjectsFromServer);

            const result = await dataProvider.fetchAndTransformProjects();

            assert.notStrictEqual(result, null);
            assert.strictEqual(result!.length, 1);
            assert.strictEqual(result![0].key, "PROJ-001");
            assert.strictEqual(result![0].name, "Valid Project");
        });

        test("should use key as fallback when name is missing", async () => {
            const mockProjectsFromServer: Project[] = [
                {
                    key: "PROJ-001",
                    name: "",
                    creationTime: "2023-01-01T00:00:00Z",
                    status: "ACTIVE",
                    visibility: true,
                    tovsCount: 5,
                    cyclesCount: 10,
                    description: "Test project",
                    lockerKey: null,
                    startDate: null,
                    endDate: null
                }
            ];

            mockConnection.getProjectsList.resolves(mockProjectsFromServer);

            const result = await dataProvider.fetchAndTransformProjects();

            assert.notStrictEqual(result, null);
            assert.strictEqual(result!.length, 1);
            assert.strictEqual(result![0].name, "PROJ-001");
        });

        test("should handle server error", async () => {
            mockConnection.getProjectsList.rejects(new Error("Server connection failed"));

            const result = await dataProvider.fetchAndTransformProjects();

            assert.strictEqual(result, null);
        });
    });

    suite("fetchProjectTree", () => {
        test("should fetch project tree successfully", async () => {
            const mockProjectTree: TreeNode = {
                key: "PROJ-001",
                name: "Test Project",
                nodeType: "Project",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "VERSION-001",
                        name: "Test Version",
                        nodeType: "Version",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: [
                            {
                                key: "CYCLE-001",
                                name: "Test Cycle",
                                nodeType: "Cycle",
                                creationTime: "2023-01-01T00:00:00Z",
                                status: "ACTIVE",
                                visibility: true,
                                children: []
                            }
                        ]
                    }
                ]
            };

            mockConnection.getProjectTreeOfProject.resolves(mockProjectTree);

            const result = await dataProvider.fetchProjectTree("PROJ-001");

            assert.deepStrictEqual(result, mockProjectTree);
            sinon.assert.calledOnce(mockConnection.getProjectTreeOfProject);
            sinon.assert.calledWith(mockConnection.getProjectTreeOfProject, "PROJ-001");
        });

        test("should handle server error", async () => {
            mockConnection.getProjectTreeOfProject.rejects(new Error("Server connection failed"));
            const result = await dataProvider.fetchProjectTree("PROJ-001");
            assert.strictEqual(result, null);
        });
    });

    suite("transformTreeNode", () => {
        test("should transform version node correctly", () => {
            const versionNode: TreeNode = {
                key: "VERSION-001",
                name: "Test Version",
                nodeType: "Version",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "CYCLE-001",
                        name: "Test Cycle",
                        nodeType: "Cycle",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    }
                ]
            };

            const result = dataProvider.transformTreeNode(versionNode, "version", "PROJ-001");

            assert.strictEqual(result.key, "VERSION-001");
            assert.strictEqual(result.name, "Test Version");
            assert.strictEqual(result.type, "version");
            assert.strictEqual(result.parentKey, "PROJ-001");
            assert.strictEqual(result.description, "");
            assert.strictEqual(result.metadata?.nodeType, "Version");
            assert.strictEqual(result.metadata?.hasChildren, true);
            assert.strictEqual(result.metadata?.childCount, 1);
        });

        test("should transform cycle node correctly", () => {
            const cycleNode: TreeNode = {
                key: "CYCLE-001",
                name: "Test Cycle",
                nodeType: "Cycle",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: []
            };

            const result = dataProvider.transformTreeNode(cycleNode, "cycle", "VERSION-001");

            assert.strictEqual(result.key, "CYCLE-001");
            assert.strictEqual(result.name, "Test Cycle");
            assert.strictEqual(result.type, "cycle");
            assert.strictEqual(result.parentKey, "VERSION-001");
            assert.strictEqual(result.description, "");
            assert.strictEqual(result.metadata?.nodeType, "Cycle");
            assert.strictEqual(result.metadata?.hasChildren, false);
            assert.strictEqual(result.metadata?.childCount, 0);
        });

        test("should handle node without children", () => {
            const node: TreeNode = {
                key: "VERSION-001",
                name: "Version 1",
                nodeType: "Version",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true
                // no children
            };

            const result = dataProvider.transformTreeNode(node, "version", "PROJ-001");
            assert.strictEqual(result.metadata?.hasChildren, false);
        });
    });

    suite("validateProjectData", () => {
        test("should validate valid project data", () => {
            const validData: ProjectData = {
                key: "PROJ-001",
                name: "Test Project",
                type: "project"
            };

            assert.strictEqual(dataProvider.validateProjectData(validData), true);
        });

        test("should validate valid version data", () => {
            const validData: ProjectData = {
                key: "VERSION-001",
                name: "Test Version",
                type: "version"
            };

            assert.strictEqual(dataProvider.validateProjectData(validData), true);
        });

        test("should validate valid cycle data", () => {
            const validData: ProjectData = {
                key: "CYCLE-001",
                name: "Test Cycle",
                type: "cycle"
            };

            assert.strictEqual(dataProvider.validateProjectData(validData), true);
        });

        test("should reject null data", () => {
            const result = dataProvider.validateProjectData(null);
            assert.strictEqual(result, false);
        });

        test("should reject non-object data", () => {
            assert.strictEqual(dataProvider.validateProjectData("string"), false);
            assert.strictEqual(dataProvider.validateProjectData(123), false);
        });

        test("should reject data without key", () => {
            const invalidData = {
                name: "Test Project",
                type: "project"
            };

            assert.strictEqual(dataProvider.validateProjectData(invalidData), false);
        });

        test("should reject data without name", () => {
            const invalidData = {
                key: "PROJ-001",
                type: "project"
            };

            assert.strictEqual(dataProvider.validateProjectData(invalidData), false);
        });

        test("should reject data with invalid type", () => {
            const invalidData = {
                key: "PROJ-001",
                name: "Test Project",
                type: "invalid"
            };

            assert.strictEqual(dataProvider.validateProjectData(invalidData), false);
        });
    });

    suite("extractCyclesFromVersion", () => {
        test("should extract cycles from version node", () => {
            const tovNode: TreeNode = {
                key: "VERSION-001",
                name: "Test Version",
                nodeType: "Version",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "CYCLE-001",
                        name: "Test Cycle 1",
                        nodeType: "Cycle",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    },
                    {
                        key: "CYCLE-002",
                        name: "Test Cycle 2",
                        nodeType: "Cycle",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    },
                    {
                        key: "OTHER-001",
                        name: "Other Item",
                        nodeType: "Other",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    }
                ]
            };

            const result = dataProvider.extractCyclesFromVersion(tovNode);

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].key, "CYCLE-001");
            assert.strictEqual(result[0].name, "Test Cycle 1");
            assert.strictEqual(result[0].type, "cycle");
            assert.strictEqual(result[0].parentKey, "VERSION-001");

            assert.strictEqual(result[1].key, "CYCLE-002");
            assert.strictEqual(result[1].name, "Test Cycle 2");
            assert.strictEqual(result[1].type, "cycle");
            assert.strictEqual(result[1].parentKey, "VERSION-001");
        });

        test("should return empty array for version without children", () => {
            const tovNode: TreeNode = {
                key: "VERSION-001",
                name: "Test Version",
                nodeType: "Version",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true
            };

            const result = dataProvider.extractCyclesFromVersion(tovNode);

            assert.strictEqual(result.length, 0);
        });

        test("should return empty array for version without cycles", () => {
            const tovNode: TreeNode = {
                key: "VERSION-001",
                name: "Test Version",
                nodeType: "Version",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "OTHER-001",
                        name: "Other Item",
                        nodeType: "Other",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    }
                ]
            };

            const result = dataProvider.extractCyclesFromVersion(tovNode);

            assert.strictEqual(result.length, 0);
        });
    });

    suite("extractVersionsFromProjectTree", () => {
        test("should extract versions from project tree", () => {
            const projectTree: TreeNode = {
                key: "PROJ-001",
                name: "Test Project",
                nodeType: "Project",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "VERSION-001",
                        name: "Test Version 1",
                        nodeType: "Version",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    },
                    {
                        key: "VERSION-002",
                        name: "Test Version 2",
                        nodeType: "Version",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    },
                    {
                        key: "OTHER-001",
                        name: "Other Item",
                        nodeType: "Other",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    }
                ]
            };

            const result = dataProvider.extractVersionsFromProjectTree(projectTree);

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].key, "VERSION-001");
            assert.strictEqual(result[0].name, "Test Version 1");
            assert.strictEqual(result[0].type, "version");
            assert.strictEqual(result[0].parentKey, "PROJ-001");

            assert.strictEqual(result[1].key, "VERSION-002");
            assert.strictEqual(result[1].name, "Test Version 2");
            assert.strictEqual(result[1].type, "version");
            assert.strictEqual(result[1].parentKey, "PROJ-001");
        });

        test("should return empty array for project without children", () => {
            const projectTree: TreeNode = {
                key: "PROJ-001",
                name: "Test Project",
                nodeType: "Project",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true
            };

            const result = dataProvider.extractVersionsFromProjectTree(projectTree);

            assert.strictEqual(result.length, 0);
        });

        test("should return empty array for project without versions", () => {
            const projectTree: TreeNode = {
                key: "PROJ-001",
                name: "Test Project",
                nodeType: "Project",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "OTHER-001",
                        name: "Other Item",
                        nodeType: "Other",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    }
                ]
            };

            const result = dataProvider.extractVersionsFromProjectTree(projectTree);

            assert.strictEqual(result.length, 0);
        });
    });

    suite("getAllCyclesForProject", () => {
        test("should get all cycles for project", async () => {
            const mockProjectTree: TreeNode = {
                key: "PROJ-001",
                name: "Test Project",
                nodeType: "Project",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "VERSION-001",
                        name: "Test Version 1",
                        nodeType: "Version",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: [
                            {
                                key: "CYCLE-001",
                                name: "Test Cycle 1",
                                nodeType: "Cycle",
                                creationTime: "2023-01-01T00:00:00Z",
                                status: "ACTIVE",
                                visibility: true,
                                children: []
                            },
                            {
                                key: "CYCLE-002",
                                name: "Test Cycle 2",
                                nodeType: "Cycle",
                                creationTime: "2023-01-01T00:00:00Z",
                                status: "ACTIVE",
                                visibility: true,
                                children: []
                            }
                        ]
                    },
                    {
                        key: "VERSION-002",
                        name: "Test Version 2",
                        nodeType: "Version",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: [
                            {
                                key: "CYCLE-003",
                                name: "Test Cycle 3",
                                nodeType: "Cycle",
                                creationTime: "2023-01-01T00:00:00Z",
                                status: "ACTIVE",
                                visibility: true,
                                children: []
                            }
                        ]
                    }
                ]
            };

            mockConnection.getProjectTreeOfProject.resolves(mockProjectTree);

            const result = await dataProvider.getAllCyclesForProject("PROJ-001");

            assert.strictEqual(result.length, 3);
            assert.strictEqual(result[0].key, "CYCLE-001");
            assert.strictEqual(result[0].name, "Test Cycle 1");
            assert.strictEqual(result[0].type, "cycle");
            assert.strictEqual(result[0].parentKey, "VERSION-001");

            assert.strictEqual(result[1].key, "CYCLE-002");
            assert.strictEqual(result[1].name, "Test Cycle 2");
            assert.strictEqual(result[1].type, "cycle");
            assert.strictEqual(result[1].parentKey, "VERSION-001");

            assert.strictEqual(result[2].key, "CYCLE-003");
            assert.strictEqual(result[2].name, "Test Cycle 3");
            assert.strictEqual(result[2].type, "cycle");
            assert.strictEqual(result[2].parentKey, "VERSION-002");
        });

        test("should return empty array for project without tree", async () => {
            mockConnection.getProjectTreeOfProject.resolves(null);

            const result = await dataProvider.getAllCyclesForProject("PROJ-001");

            assert.strictEqual(result.length, 0);
        });

        test("should return empty array for project without children", async () => {
            const mockProjectTree: TreeNode = {
                key: "PROJ-001",
                name: "Test Project",
                nodeType: "Project",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true
            };

            mockConnection.getProjectTreeOfProject.resolves(mockProjectTree);

            const result = await dataProvider.getAllCyclesForProject("PROJ-001");

            assert.strictEqual(result.length, 0);
        });
    });

    suite("findNodeByKey", () => {
        test("should find node by key in simple tree", () => {
            const root: TreeNode = {
                key: "ROOT",
                name: "Root",
                nodeType: "Root",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "CHILD-001",
                        name: "Child 1",
                        nodeType: "Child",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    },
                    {
                        key: "CHILD-002",
                        name: "Child 2",
                        nodeType: "Child",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    }
                ]
            };

            const result = dataProvider.findNodeByKey(root, "CHILD-001");

            assert.strictEqual(result?.key, "CHILD-001");
            assert.strictEqual(result?.name, "Child 1");
        });

        test("should find node by key in nested tree", () => {
            const root: TreeNode = {
                key: "ROOT",
                name: "Root",
                nodeType: "Root",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "LEVEL-1",
                        name: "Level 1",
                        nodeType: "Level",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: [
                            {
                                key: "LEVEL-2",
                                name: "Level 2",
                                nodeType: "Level",
                                creationTime: "2023-01-01T00:00:00Z",
                                status: "ACTIVE",
                                visibility: true,
                                children: [
                                    {
                                        key: "TARGET",
                                        name: "Target",
                                        nodeType: "Target",
                                        creationTime: "2023-01-01T00:00:00Z",
                                        status: "ACTIVE",
                                        visibility: true,
                                        children: []
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const result = dataProvider.findNodeByKey(root, "TARGET");

            assert.strictEqual(result?.key, "TARGET");
            assert.strictEqual(result?.name, "Target");
        });

        test("should return null when node not found", () => {
            const root: TreeNode = {
                key: "ROOT",
                name: "Root",
                nodeType: "Root",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "CHILD-001",
                        name: "Child 1",
                        nodeType: "Child",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    }
                ]
            };

            const result = dataProvider.findNodeByKey(root, "NOT-FOUND");

            assert.strictEqual(result, null);
        });

        test("should find root node", () => {
            const root: TreeNode = {
                key: "ROOT",
                name: "Root",
                nodeType: "Root",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: []
            };

            const result = dataProvider.findNodeByKey(root, "ROOT");

            assert.strictEqual(result?.key, "ROOT");
            assert.strictEqual(result?.name, "Root");
        });
    });

    suite("getNodePath", () => {
        test("should get path to node in simple tree", () => {
            const root: TreeNode = {
                key: "ROOT",
                name: "Root",
                nodeType: "Root",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "CHILD-001",
                        name: "Child 1",
                        nodeType: "Child",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    }
                ]
            };

            const result = dataProvider.getNodePath(root, "CHILD-001");

            assert.deepStrictEqual(result, ["ROOT", "CHILD-001"]);
        });

        test("should get path to node in nested tree", () => {
            const root: TreeNode = {
                key: "ROOT",
                name: "Root",
                nodeType: "Root",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "LEVEL-1",
                        name: "Level 1",
                        nodeType: "Level",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: [
                            {
                                key: "LEVEL-2",
                                name: "Level 2",
                                nodeType: "Level",
                                creationTime: "2023-01-01T00:00:00Z",
                                status: "ACTIVE",
                                visibility: true,
                                children: [
                                    {
                                        key: "TARGET",
                                        name: "Target",
                                        nodeType: "Target",
                                        creationTime: "2023-01-01T00:00:00Z",
                                        status: "ACTIVE",
                                        visibility: true,
                                        children: []
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            const result = dataProvider.getNodePath(root, "TARGET");

            assert.deepStrictEqual(result, ["ROOT", "LEVEL-1", "LEVEL-2", "TARGET"]);
        });

        test("should return null when node not found", () => {
            const root: TreeNode = {
                key: "ROOT",
                name: "Root",
                nodeType: "Root",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: [
                    {
                        key: "CHILD-001",
                        name: "Child 1",
                        nodeType: "Child",
                        creationTime: "2023-01-01T00:00:00Z",
                        status: "ACTIVE",
                        visibility: true,
                        children: []
                    }
                ]
            };

            const result = dataProvider.getNodePath(root, "NOT-FOUND");

            assert.strictEqual(result, null);
        });

        test("should get path to root node", () => {
            const root: TreeNode = {
                key: "ROOT",
                name: "Root",
                nodeType: "Root",
                creationTime: "2023-01-01T00:00:00Z",
                status: "ACTIVE",
                visibility: true,
                children: []
            };

            const result = dataProvider.getNodePath(root, "ROOT");

            assert.deepStrictEqual(result, ["ROOT"]);
        });
    });
});
