import * as vscode from "vscode";
import axios from "axios";
import { PlayServerConnection } from "../testBenchConnection";
import { ProjectManagementTreeDataProvider } from "../projectManagementTreeView";
import { expect, jest } from "@jest/globals";

jest.mock("axios");

describe("PlayServerConnection", () => {
    let context: vscode.ExtensionContext;
    let serverName: string;
    let portNumber: number;
    let sessionToken: string;
    let connection: PlayServerConnection;

    beforeEach(() => {
        context = {} as vscode.ExtensionContext;
        serverName = "testServer";
        portNumber = 9445;
        sessionToken = "fakeSessionToken";
        connection = new PlayServerConnection(context, serverName, portNumber, sessionToken);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test("should initialize with correct baseURL", () => {
        expect(connection.getBaseURL()).toBe(`https://${serverName}:${portNumber}/api`);
    });

    test("should return session token", () => {
        expect(connection.getSessionToken()).toBe(sessionToken);
    });

    test("should fetch projects list", async () => {
        const projectsData = [
            {
                key: "project1",
                creationTime: "2023-01-01T00:00:00Z",
                name: "Project 1",
                status: "active",
                visibility: true,
                tovsCount: 5,
                cyclesCount: 3,
                description: "Test project 1",
                lockerKey: null,
                startDate: null,
                endDate: null,
            },
        ];

        (axios.get as jest.MockedFunction<typeof axios.get>).mockResolvedValue({ data: projectsData });

        const projects = await connection.getProjectsList();
        expect(projects).toEqual(projectsData);
    });

    test("should handle error when fetching projects list", async () => {
        (axios.get as jest.MockedFunction<typeof axios.get>).mockRejectedValue(new Error("Network Error"));

        const projects = await connection.getProjectsList();
        expect(projects).toBeNull();
    });

    test("should fetch project tree", async () => {
        const projectTree = {
            nodeType: "root",
            key: "root",
            name: "Root Node",
            creationTime: "2023-01-01T00:00:00Z",
            status: "active",
            visibility: true,
            children: [],
        };

        (axios.get as jest.MockedFunction<typeof axios.get>).mockResolvedValue({ data: projectTree });

        const tree = await connection.getProjectTreeOfProject("project1");
        expect(tree).toEqual(projectTree);
    });

    test("should handle error when fetching project tree", async () => {
        (axios.get as jest.MockedFunction<typeof axios.get>).mockRejectedValue(new Error("Network Error"));

        const tree = await connection.getProjectTreeOfProject("project1");
        expect(tree).toBeNull();
    });

    test("should check if server connection is working", async () => {
        (axios.get as jest.MockedFunction<typeof axios.get>).mockResolvedValue({ status: 200 });

        const isWorking = await connection.checkIsWorking();
        expect(isWorking).toBe(true);
    });

    test("should handle error when checking server connection", async () => {
        (axios.get as jest.MockedFunction<typeof axios.get>).mockRejectedValue(new Error("Network Error"));

        const isWorking = await connection.checkIsWorking();
        expect(isWorking).toBe(false);
    });

    test("should logout user", async () => {
        const treeDataProvider = new ProjectManagementTreeDataProvider(connection, "projectKey", undefined);
        (axios.post as jest.MockedFunction<typeof axios.post>).mockResolvedValue({ status: 200 });

        await connection.logoutUser(context, treeDataProvider);
        expect(axios.post).toHaveBeenCalledWith(
            `${connection.getBaseURL()}/logout`,
            {},
            { headers: { Authorization: `Bearer ${sessionToken}` } }
        );
    });

    test("should handle error when logging out user", async () => {
        const treeDataProvider = new ProjectManagementTreeDataProvider(connection, "projectKey", undefined);
        (axios.post as jest.MockedFunction<typeof axios.post>).mockRejectedValue(new Error("Network Error"));

        await connection.logoutUser(context, treeDataProvider);
        expect(axios.post).toHaveBeenCalledWith(
            `${connection.getBaseURL()}/logout`,
            {},
            { headers: { Authorization: `Bearer ${sessionToken}` } }
        );
    });
});
