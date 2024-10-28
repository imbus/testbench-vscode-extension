import assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import axios from "axios";
import { PlayServerConnection } from "../../testBenchConnection";
import * as types from "../../types";

suite("PlayServerConnection Tests", () => {
    let context: vscode.ExtensionContext;
    let serverConnection: PlayServerConnection;
    let axiosStub: sinon.SinonStub;

    setup(() => {
        context = {
            secrets: {
                get: sinon.stub().resolves("mockSessionToken"),
                store: sinon.stub().resolves(),
                delete: sinon.stub().resolves(),
            },
        } as unknown as vscode.ExtensionContext;

        serverConnection = new PlayServerConnection(context, "mockServer", 1234, "mockSessionToken");

        axiosStub = sinon.stub(axios, "create").returns({
            get: sinon.stub(),
            post: sinon.stub(),
            delete: sinon.stub(),
        } as any);
    });

    teardown(() => {
        sinon.restore();
    });

    test("getSessionToken should return the session token", () => {
        const token = serverConnection.getSessionToken();
        assert.strictEqual(token, "mockSessionToken");
    });

    test("getBaseURL should return the base URL", () => {
        const baseURL = serverConnection.getBaseURL();
        assert.strictEqual(baseURL, "https://mockServer:1234/api");
    });

    test("getApiClient should return the axios instance", () => {
        const apiClient = serverConnection.getApiClient();
        assert.ok(apiClient);
    });

    test("getSessionTokenFromSecretStorage should return the session token from secret storage", async () => {
        const token = await serverConnection.getSessionTokenFromSecretStorage(context);
        assert.strictEqual(token, "mockSessionToken");
    });

    test("clearSessionData should clear session data", () => {
        serverConnection.clearSessionData();
        assert.strictEqual(serverConnection.getSessionToken(), "");
        assert.strictEqual(serverConnection.getBaseURL(), "");
    });

    /*
    test("selectProjectKeyFromProjectList should return the selected project key", async () => {
        const projectsData: types.Project[] = [
            {
                name: "Project1", key: "key1", creationTime: new Date().toISOString(), status: "active", visibility: true, tovsCount: 0,
                cyclesCount: 0,
                description: "",
                lockerKey: null,
                startDate: null,
                endDate: null
            },
            {
                name: "Project2", key: "key2", creationTime: new Date().toISOString(), status: "active", visibility: true, tovsCount: 0,
                cyclesCount: 0,
                description: "",
                lockerKey: null,
                startDate: null,
                endDate: null
            },
        ];

        sinon.stub(vscode.window, "showQuickPick").resolves({ label: "Project1" });

        const projectKey = await serverConnection.selectProjectKeyFromProjectList(projectsData);
        assert.strictEqual(projectKey, "key1");
    });    
    
    test("getProjectsList should return the list of projects", async () => {
        const mockProjects: types.Project[] = [{
            name: "Project1",
            key: "key1",
            creationTime: new Date().toISOString(),
            status: "active",
            visibility: true,
            tovsCount: 0,
            cyclesCount: 0,
            description: "",
            lockerKey: null,
            startDate: null,
            endDate: null
        }];
        axiosStub().get.resolves({ data: mockProjects, status: 200 });

        const projects = await serverConnection.getProjectsList();
        assert.deepStrictEqual(projects, mockProjects);
    });

    test("getProjectTreeOfProject should return the project tree", async () => {
        const mockTree: types.TreeNode = {
            name: "Root", children: [],
            nodeType: "",
            key: "",
            creationTime: "",
            status: "",
            visibility: false
        };
        axiosStub().get.resolves({ data: mockTree, status: 200 });

        const tree = await serverConnection.getProjectTreeOfProject("key1");
        assert.deepStrictEqual(tree, mockTree);
    });

    test("fetchCycleStructure should handle errors gracefully", async () => {
        axiosStub().post.rejects(new Error("Network Error"));

        try {
            await serverConnection.fetchCycleStructure("projectKey", "cycleKey");
        } catch (error) {
            assert.fail("fetchCycleStructure should not throw an error");
        }
    });

    test("checkIsWorking should return true if connection is working", async () => {
        axiosStub().get.resolves({ status: 200 });

        const isWorking = await serverConnection.checkIsWorking();
        assert.strictEqual(isWorking, true);
    });

    test("logoutUser should clear session data and stop keep-alive", async () => {
        const stopKeepAliveStub = sinon.stub(serverConnection as any, "stopKeepAlive");
        axiosStub().delete.resolves({ status: 204 });

        await serverConnection.logoutUser(context, {} as any);
        assert.strictEqual(serverConnection.getSessionToken(), "");
        assert(stopKeepAliveStub.calledOnce);
    });

    test("uploadExecutionResults should handle errors gracefully", async () => {
        axiosStub().post.rejects(new Error("Network Error"));

        try {
            await serverConnection.uploadExecutionResults(1, "path/to/zip");
        } catch (error) {
            assert.fail("uploadExecutionResults should not throw an error");
        }
    });

    test("importExecutionResults should handle errors gracefully", async () => {
        axiosStub().post.rejects(new Error("Network Error"));

        try {
            await serverConnection.importExecutionResults(1, 1, {} as any);
        } catch (error) {
            assert.fail("importExecutionResults should not throw an error");
        }
    });
    */
});
