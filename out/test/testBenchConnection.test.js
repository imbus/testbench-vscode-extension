"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const testBenchConnection_1 = require("../testBenchConnection");
const projectManagementTreeView_1 = require("../projectManagementTreeView");
const globals_1 = require("@jest/globals");
globals_1.jest.mock("axios");
describe("PlayServerConnection", () => {
    let context;
    let serverName;
    let portNumber;
    let sessionToken;
    let connection;
    beforeEach(() => {
        context = {};
        serverName = "testServer";
        portNumber = 9445;
        sessionToken = "fakeSessionToken";
        connection = new testBenchConnection_1.PlayServerConnection(context, serverName, portNumber, sessionToken);
    });
    afterEach(() => {
        globals_1.jest.clearAllMocks();
    });
    test("should initialize with correct baseURL", () => {
        (0, globals_1.expect)(connection.getBaseURL()).toBe(`https://${serverName}:${portNumber}/api`);
    });
    test("should return session token", () => {
        (0, globals_1.expect)(connection.getSessionToken()).toBe(sessionToken);
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
        axios_1.default.get.mockResolvedValue({ data: projectsData });
        const projects = await connection.getProjectsList();
        (0, globals_1.expect)(projects).toEqual(projectsData);
    });
    test("should handle error when fetching projects list", async () => {
        axios_1.default.get.mockRejectedValue(new Error("Network Error"));
        const projects = await connection.getProjectsList();
        (0, globals_1.expect)(projects).toBeNull();
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
        axios_1.default.get.mockResolvedValue({ data: projectTree });
        const tree = await connection.getProjectTreeOfProject("project1");
        (0, globals_1.expect)(tree).toEqual(projectTree);
    });
    test("should handle error when fetching project tree", async () => {
        axios_1.default.get.mockRejectedValue(new Error("Network Error"));
        const tree = await connection.getProjectTreeOfProject("project1");
        (0, globals_1.expect)(tree).toBeNull();
    });
    test("should check if server connection is working", async () => {
        axios_1.default.get.mockResolvedValue({ status: 200 });
        const isWorking = await connection.checkIsWorking();
        (0, globals_1.expect)(isWorking).toBe(true);
    });
    test("should handle error when checking server connection", async () => {
        axios_1.default.get.mockRejectedValue(new Error("Network Error"));
        const isWorking = await connection.checkIsWorking();
        (0, globals_1.expect)(isWorking).toBe(false);
    });
    test("should logout user", async () => {
        const treeDataProvider = new projectManagementTreeView_1.ProjectManagementTreeDataProvider(connection, "projectKey", undefined);
        axios_1.default.post.mockResolvedValue({ status: 200 });
        await connection.logoutUser(context, treeDataProvider);
        (0, globals_1.expect)(axios_1.default.post).toHaveBeenCalledWith(`${connection.getBaseURL()}/logout`, {}, { headers: { Authorization: `Bearer ${sessionToken}` } });
    });
    test("should handle error when logging out user", async () => {
        const treeDataProvider = new projectManagementTreeView_1.ProjectManagementTreeDataProvider(connection, "projectKey", undefined);
        axios_1.default.post.mockRejectedValue(new Error("Network Error"));
        await connection.logoutUser(context, treeDataProvider);
        (0, globals_1.expect)(axios_1.default.post).toHaveBeenCalledWith(`${connection.getBaseURL()}/logout`, {}, { headers: { Authorization: `Bearer ${sessionToken}` } });
    });
});
//# sourceMappingURL=testBenchConnection.test.js.map