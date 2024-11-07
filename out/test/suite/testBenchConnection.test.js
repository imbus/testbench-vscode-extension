"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const vscode = __importStar(require("vscode"));
const sinon = __importStar(require("sinon"));
const axios_1 = __importDefault(require("axios"));
const testBenchConnection_1 = require("../../testBenchConnection");
suite("PlayServerConnection Tests", () => {
    let context;
    let serverConnection;
    let axiosStub;
    setup(() => {
        context = {
            secrets: {
                get: sinon.stub().resolves("mockSessionToken"),
                store: sinon.stub().resolves(),
                delete: sinon.stub().resolves(),
            },
        };
        // Mock the startKeepAlive method
        const startKeepAliveStub = sinon.stub(testBenchConnection_1.PlayServerConnection.prototype, "startKeepAlive");
        serverConnection = new testBenchConnection_1.PlayServerConnection(context, "mockServer", 1234, "mockSessionToken");
        axiosStub = sinon.stub(axios_1.default, "create").returns({
            get: sinon.stub(),
            post: sinon.stub(),
            delete: sinon.stub(),
        });
    });
    teardown(() => {
        sinon.restore();
    });
    test("getSessionToken should return the session token", async () => {
        await vscode.commands.executeCommand("workbench.extensions.installExtension", "ms-python.python");
        let ext = vscode.extensions.getExtension("ms-python.python");
        if (!ext) {
            console.error("Extension not found");
        }
        else {
            console.log("Extension found:", ext);
        }
        await vscode.commands.executeCommand("workbench.extensions.uninstallExtension", "ms-python.python");
        const token = serverConnection.getSessionToken();
        assert_1.default.strictEqual(token, "mockSessionToken");
    });
    test("getBaseURL should return the base URL", () => {
        const baseURL = serverConnection.getBaseURL();
        assert_1.default.strictEqual(baseURL, "https://mockServer:1234/api");
    });
    test("getApiClient should return the axios instance", () => {
        const apiClient = serverConnection.getApiClient();
        assert_1.default.ok(apiClient);
    });
    test("getSessionTokenFromSecretStorage should return the session token from secret storage", async () => {
        const token = await serverConnection.getSessionTokenFromSecretStorage(context);
        assert_1.default.strictEqual(token, "mockSessionToken");
    });
    test("clearSessionData should clear session data", () => {
        serverConnection.clearSessionData();
        assert_1.default.strictEqual(serverConnection.getSessionToken(), "");
        assert_1.default.strictEqual(serverConnection.getBaseURL(), "");
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
//# sourceMappingURL=testBenchConnection.test.js.map