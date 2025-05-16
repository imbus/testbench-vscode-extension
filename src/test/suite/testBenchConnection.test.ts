/*
import assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import axios from "axios";
import { PlayServerConnection } from "../../testBenchConnection";

suite("PlayServerConnection Tests", () => {
    let context: vscode.ExtensionContext;
    let serverConnection: PlayServerConnection;
    let axiosStub: sinon.SinonStub;

    setup(() => {
        context = {
            secrets: {
                get: sinon.stub().resolves("mockSessionToken"),
                store: sinon.stub().resolves(),
                delete: sinon.stub().resolves()
            }
        } as unknown as vscode.ExtensionContext;

        // Mock the startKeepAlive method
        const startKeepAliveStub = sinon.stub(PlayServerConnection.prototype as any, "startKeepAlive");

        serverConnection = new PlayServerConnection(context, "mockServer", 1234, "mockSessionToken");

        axiosStub = sinon.stub(axios, "create").returns({
            get: sinon.stub(),
            post: sinon.stub(),
            delete: sinon.stub()
        } as any);
    });

    teardown(() => {
        sinon.restore();
    });

    test("getSessionToken should return the session token", async () => {
        await vscode.commands.executeCommand("workbench.extensions.installExtension", "ms-python.python");
        let ext = vscode.extensions.getExtension("ms-python.python");
        if (!ext) {
            console.error("Extension not found");
        } else {
            console.log("Extension found:", ext);
        }
        await vscode.commands.executeCommand("workbench.extensions.uninstallExtension", "ms-python.python");

        const token: string = serverConnection.getSessionToken();
        assert.strictEqual(token, "mockSessionToken");
    });

    test("getBaseURL should return the base URL", () => {
        const baseURL: string = serverConnection.getBaseURL();
        assert.strictEqual(baseURL, "https://mockServer:1234/api");
    });

    test("getApiClient should return the axios instance", () => {
        const apiClient: axios.AxiosInstance = serverConnection.getApiClient();
        assert.ok(apiClient);
    });

    test("getSessionTokenFromSecretStorage should return the session token from secret storage", async () => {
        const token: string | undefined = await serverConnection.getSessionTokenFromSecretStorage(context);
        assert.strictEqual(token, "mockSessionToken");
    });
    
    test("selectProjectKeyFromProjectList should return the selected project key", async () => {
        const projectsData: testBenchTypes.Project[] = [
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
        const mockProjects: testBenchTypes.Project[] = [{
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
        const mockTree: testBenchTypes.TreeNode = {
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

    test("importExecutionResults should handle errors gracefully", async () => {
        axiosStub().post.rejects(new Error("Network Error"));

        try {
            await serverConnection.importExecutionResults(1, "path/to/zip");
        } catch (error) {
            assert.fail("importExecutionResults should not throw an error");
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
    
});
*/
