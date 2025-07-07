/**
 * @file src/test/utils/mockDataFactory.ts
 * @description Factory functions for creating consistent mock data for tests.
 * This file provides factory functions to easily create mock data objects that match the extension's types, ensuring consistency.
 */

import { Project, TreeNode, TestStructure } from "../../testBenchTypes";

// Counter to ensure unique keys/ids in sequential calls
let idCounter = 1;

export function createMockProject(overrides: Partial<Project> = {}): Project {
    const key = `proj_${idCounter++}`;
    return {
        key,
        name: `Test Project ${key}`,
        tovsCount: 2,
        cyclesCount: 1,
        creationTime: new Date().toISOString(),
        status: "active",
        visibility: true,
        description: "A mock project for testing",
        lockerKey: null,
        startDate: null,
        endDate: null,
        ...overrides
    };
}

export function createMockTreeNode(overrides: Partial<TreeNode> = {}): TreeNode {
    const key = `node_${idCounter++}`;
    return {
        key,
        name: `Node ${key}`,
        nodeType: "Version",
        children: [],
        creationTime: new Date().toISOString(),
        status: "active",
        visibility: true,
        ...overrides
    };
}

export function createMockCycleStructure(overrides: Partial<TestStructure> = {}): TestStructure {
    const rootKey = `cycle_root_${idCounter++}`;
    return {
        root: {
            base: {
                key: rootKey,
                name: `Root Cycle ${rootKey}`,
                uniqueID: `uid_cycle_${rootKey}`,
                parentKey: "",
                numbering: "1",
                matchesFilter: false
            },
            elementType: "Cycle",
            filters: []
        },
        nodes: [],
        ...overrides
    };
}
