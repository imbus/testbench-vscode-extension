/**
 * @file src/treeViews/implementations/projects/ProjectsDataProvider.ts
 * @description Data provider implementation for managing projects in the tree view.
 */

import { TestBenchLogger } from "../../../testBenchLogger";
import { PlayServerConnection } from "../../../testBenchConnection";
import { TreeNode } from "../../../testBenchTypes";
import { ProjectData } from "./ProjectsTreeItem";
import { ProjectItemTypes, TreeViewTiming } from "../../../constants";
import { CacheManager } from "../../../core/cacheManager";

const PROJECTS_CACHE_KEY = "all_projects";

export class ProjectsDataProvider {
    private projectsCache: CacheManager<string, ProjectData[]>;
    private projectTreeCache: CacheManager<string, TreeNode>;

    constructor(
        private logger: TestBenchLogger,
        private getConnection: () => PlayServerConnection | null
    ) {
        this.projectsCache = new CacheManager<string, ProjectData[]>(TreeViewTiming.TREE_DATA_FRESHNESS_THRESHOLD_MS);
        this.projectTreeCache = new CacheManager<string, TreeNode>(TreeViewTiming.TREE_DATA_FRESHNESS_THRESHOLD_MS);
    }

    /**
     * Clears all cached data.
     */
    public clearCache(): void {
        this.projectsCache.clearCache();
        this.projectTreeCache.clearCache();
        this.logger.trace("[ProjectsDataProvider] Cleared all caches.");
    }

    /**
     * Fetches all projects from the server and transforms them to ProjectData format.
     * @returns Promise resolving to ProjectData array on success, null on failure
     */
    public async fetchAndTransformProjects(): Promise<ProjectData[] | null> {
        const cachedProjects = this.projectsCache.getEntryFromCache(PROJECTS_CACHE_KEY);
        if (cachedProjects) {
            this.logger.trace("[ProjectsDataProvider] Returning cached projects list.");
            return cachedProjects;
        }

        const connection = this.getConnection();
        if (!connection) {
            this.logger.trace(
                "[ProjectsDataProvider] No connection available when fetching projects. This is expected during startup/logout"
            );
            return null;
        }

        try {
            const projectsFetchedFromServer = await connection.getProjectsList();

            if (!projectsFetchedFromServer || !Array.isArray(projectsFetchedFromServer)) {
                return [];
            }

            const transformedProjects: ProjectData[] = [];
            for (const project of projectsFetchedFromServer) {
                try {
                    if (!project || typeof project !== "object") {
                        this.logger.warn(
                            `[ProjectsDataProvider] Invalid project data received. Type: ${typeof project}`
                        );
                        continue;
                    }

                    if (!project.key || typeof project.key !== "string") {
                        this.logger.warn("[ProjectsDataProvider] Project missing key or invalid key.");
                        continue;
                    }

                    const transformedProject: ProjectData = {
                        key: project.key,
                        name: project.name || project.key, // Fallback to key if name is missing
                        description: project.description || "",
                        type: "project" as const,
                        metadata: {
                            creationTime: project.creationTime,
                            status: project.status,
                            visibility: project.visibility,
                            tovsCount: project.tovsCount,
                            cyclesCount: project.cyclesCount,
                            lockerKey: project.lockerKey,
                            startDate: project.startDate,
                            endDate: project.endDate
                        }
                    };

                    transformedProjects.push(transformedProject);
                } catch (transformError) {
                    this.logger.error("[ProjectsDataProvider] Error transforming project:", transformError);
                }
            }

            this.projectsCache.setEntryInCache(PROJECTS_CACHE_KEY, transformedProjects);
            return transformedProjects;
        } catch (error) {
            this.logger.error("[ProjectsDataProvider] Failed to fetch projects:", error);
            return null;
        }
    }

    /**
     * Fetch the complete project tree structure including versions and cycles for a given project key.
     * @param projectKey The key of the project to fetch the tree for.
     * @returns The project tree structure or null if no project tree is found.
     */
    public async fetchProjectTree(projectKey: string): Promise<TreeNode | null> {
        const cachedTree = this.projectTreeCache.getEntryFromCache(projectKey);
        if (cachedTree) {
            this.logger.trace(`[ProjectsDataProvider] Returning cached project tree for key ${projectKey}.`);
            return cachedTree;
        }

        const connection = this.getConnection();
        if (!connection) {
            this.logger.error("[ProjectsDataProvider] No connection available when fetching project tree");
            return null;
        }

        try {
            const projectTreeFromServer = await connection.getProjectTreeOfProject(projectKey);
            if (!projectTreeFromServer) {
                return null;
            }

            this.projectTreeCache.setEntryInCache(projectKey, projectTreeFromServer);
            return projectTreeFromServer;
        } catch (error) {
            this.logger.error(
                `[ProjectsDataProvider] Failed to fetch project tree for project key ${projectKey}:`,
                error
            );
            return null;
        }
    }

    /**
     * Transform TreeNode structure to ProjectData format.
     * @param node The TreeNode to transform.
     * @param type The type of the node.
     * @param parentKey (Optional) The key of the parent node.
     * @returns The transformed ProjectData.
     */
    public transformTreeNode(node: TreeNode, type: "version" | "cycle", parentKey?: string): ProjectData {
        return {
            key: node.key,
            name: node.name,
            description: "", // TreeNode doesn't have description
            type: type,
            parentKey: parentKey,
            metadata: {
                nodeType: node.nodeType,
                creationTime: node.creationTime,
                status: node.status,
                visibility: node.visibility,
                hasChildren: !!(node.children && node.children.length > 0),
                childCount: node.children ? node.children.length : 0
            }
        };
    }

    /**
     * Validate project data.
     * @param data The data to validate.
     * @returns True if the data is valid, false otherwise.
     */
    public validateProjectData(data: any): boolean {
        return !!(
            data &&
            typeof data === "object" &&
            typeof data.key === "string" &&
            typeof data.name === "string" &&
            ["project", "version", "cycle"].includes(data.type)
        );
    }

    /**
     * Extract cycles from a test object version node.
     * @param tovNode The test object version node to extract cycles from.
     * @returns The extracted cycles.
     */
    public extractCyclesFromVersion(tovNode: TreeNode): ProjectData[] {
        if (!tovNode.children) {
            return [];
        }

        return tovNode.children
            .filter((child) => child.nodeType === ProjectItemTypes.CYCLE)
            .map((cycleNode) => this.transformTreeNode(cycleNode, "cycle", tovNode.key));
    }

    /**
     * Extract test object versions from a project tree.
     * @param projectTree The project tree to extract versions from.
     * @returns The extracted test object versions.
     */
    public extractVersionsFromProjectTree(projectTree: TreeNode): ProjectData[] {
        if (!projectTree.children) {
            return [];
        }

        return projectTree.children
            .filter((child) => child.nodeType === ProjectItemTypes.VERSION)
            .map((versionNode) => this.transformTreeNode(versionNode, "version", projectTree.key));
    }

    /**
     * Get a flattened list of all cycles in a project.
     * @param projectKey The key of the project to get all cycles for.
     * @returns A promise that resolves to a list of all cycles in the project.
     */
    public async getAllCyclesForProject(projectKey: string): Promise<ProjectData[]> {
        const projectTreeFromServer = await this.fetchProjectTree(projectKey);
        if (!projectTreeFromServer || !projectTreeFromServer.children) {
            return [];
        }

        const cycles: ProjectData[] = [];

        // Iterate through test object versions
        for (const tovNode of projectTreeFromServer.children) {
            if (tovNode.nodeType === ProjectItemTypes.VERSION && tovNode.children) {
                // Extract cycles from this tov
                const tovCycles = tovNode.children
                    .filter((child) => child.nodeType === ProjectItemTypes.CYCLE)
                    .map((cycleNode) => this.transformTreeNode(cycleNode, "cycle", tovNode.key));

                cycles.push(...tovCycles);
            }
        }

        return cycles;
    }

    /**
     * Find a specific node in the tree by key.
     * @param root The root node of the tree to search in.
     * @param targetKey The key of the node to find.
     * @returns The node if found, null otherwise.
     */
    public findNodeByKey(root: TreeNode, targetKey: string): TreeNode | null {
        if (root.key === targetKey) {
            return root;
        }

        if (root.children) {
            for (const child of root.children) {
                const foundNode = this.findNodeByKey(child, targetKey);
                if (foundNode) {
                    return foundNode;
                }
            }
        }

        return null;
    }

    /**
     * Get the path from root to a specific node.
     * @param root The root node of the tree to search in.
     * @param targetKey The key of the node to find.
     * @param path The path to the node.
     * @returns The path if found, null otherwise.
     */
    public getNodePath(root: TreeNode, targetKey: string, path: string[] = []): string[] | null {
        path.push(root.key);

        if (root.key === targetKey) {
            return path;
        }

        if (root.children) {
            for (const child of root.children) {
                const foundPath = this.getNodePath(child, targetKey, [...path]);
                if (foundPath) {
                    return foundPath;
                }
            }
        }

        return null;
    }
}
