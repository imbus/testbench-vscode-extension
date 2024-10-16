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
exports.PlayServerConnection = void 0;
exports.performLogin = performLogin;
exports.changeConnection = changeConnection;
const https = __importStar(require("https"));
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const axios_1 = __importDefault(require("axios"));
const projectManagementTreeView_1 = require("./projectManagementTreeView");
// Ignore SSL certificate validation in node requests
// TODO: Remove this in production, and use a valid certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// Function to save JSON data to a file (For analysing the responses of the server)
function saveJsonToFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        vscode.window.showInformationMessage(`Cycle structure saved to ${filePath}`);
    }
    catch (error) {
        vscode.window.showErrorMessage(`Error saving file: ${error.message}`);
    }
}
// TestBench server connection
class PlayServerConnection {
    context;
    serverName;
    portNumber;
    sessionToken;
    baseURL;
    apiClient;
    keepAliveIntervalId = null;
    constructor(context, serverName, portNumber, sessionToken) {
        this.context = context;
        this.serverName = serverName;
        this.portNumber = portNumber;
        this.sessionToken = sessionToken;
        this.baseURL = `https://${this.serverName}:${this.portNumber}/api`;
        // Create Axios instance for API calls to the server
        this.apiClient = axios_1.default.create({
            baseURL: this.baseURL,
            headers: {
                Authorization: this.sessionToken,
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false, // TODO: Should be true in production
            }),
        });
        // Start the keep-alive process to prevent timeout after 5 minutes
        this.startKeepAlive();
    }
    getSessionToken() {
        return this.sessionToken;
    }
    getBaseURL() {
        return this.baseURL;
    }
    async getSessionTokenFromSecretStorage(context) {
        const token = await context.secrets.get("sessionToken");
        if (!token) {
            console.error("Session token not found.");
        }
        return token;
    }
    clearSessionData() {
        this.baseURL = "";
        this.serverName = "";
        this.portNumber = 0;
        this.sessionToken = "";
        this.apiClient = axios_1.default.create();
        this.keepAliveIntervalId = null;
    }
    async selectProjectKeyFromProjectList(projectsData) {
        const projectNames = projectsData.map((project) => project.name);
        const selectedProjectName = await vscode.window.showQuickPick(projectNames, {
            placeHolder: "Select a project",
        });
        if (!selectedProjectName) {
            return null;
        }
        console.log("Selected project name:", selectedProjectName);
        const selectedProject = projectsData.find((project) => project.name === selectedProjectName);
        if (!selectedProject) {
            // vscode.window.showErrorMessage("Selected project not found.");
            return null;
        }
        return selectedProject.key;
    }
    async getProjectsList() {
        if (!this.sessionToken) {
            console.warn("Session token is null. Cannot fetch projects list.");
            return null;
        }
        try {
            const projectsURL = `/projects/v1`;
            const projectsResponse = await this.apiClient.get(projectsURL, {
                headers: {
                    accept: "application/vnd.testbench+json",
                },
            });
            // Save the JSON to a file for analyzing the structure
            /*
            const savePath = await vscode.window.showSaveDialog({
                saveLabel: "Save Project Tree",
                filters: {
                    "JSON Files": ["json"],
                    "All Files": ["*"],
                },
            });
            if (savePath) {
                const filePath = savePath.fsPath;
                saveJsonToFile(filePath, projectsResponse.data);
            } else {
                vscode.window.showErrorMessage("No file path selected.");
            }
            */
            console.log("Fetched project list:", projectsResponse.data);
            return projectsResponse.data || [];
        }
        catch (error) {
            console.error("Error fetching projects:", error);
            return null;
        }
    }
    async getProjectTreeOfProject(projectKey) {
        if (!this.sessionToken) {
            console.warn("Session token is null. Cannot fetch project tree:", projectKey);
            return null;
        }
        if (!projectKey) {
            console.warn("Project key is null or undefined. Cannot fetch project tree.");
            return null;
        }
        try {
            const projectTreeURL = `/projects/${projectKey}/tree/v1`;
            const projectTreeResponse = await this.apiClient.get(projectTreeURL, {
                headers: {
                    accept: "application/vnd.testbench+json",
                },
            });
            // Save the JSON to a file for analyzing the structure
            /*
            const savePath = await vscode.window.showSaveDialog({
                saveLabel: "Save Project Tree",
                filters: {
                    "JSON Files": ["json"],
                    "All Files": ["*"],
                },
            });
            if (savePath) {
                const filePath = savePath.fsPath;
                saveJsonToFile(filePath, projectTreeResponse.data);
            } else {
                vscode.window.showErrorMessage("No file path selected.");
            }
            */
            console.log("Fetched project tree:", projectTreeResponse.data);
            return projectTreeResponse.data || null;
        }
        catch (error) {
            console.error("Error fetching project tree:", error);
            return null;
        }
    }
    async fetchCycleStructure(projectKey, cycleKey) {
        const cycleStructureUrl = `/projects/${projectKey}/cycles/${cycleKey}/structure/v1`;
        const requestBody = {
            basedOnExecution: true,
            suppressFilteredData: false,
            suppressNotExecutable: false,
            suppressEmptyTestThemes: false,
            filters: [],
        };
        try {
            const response = await this.apiClient.post(cycleStructureUrl, requestBody, {
                headers: {
                    accept: "application/json",
                    "Content-Type": "application/json",
                },
            });
            if (response.status === 200) {
                console.log("Cycle Structure received:", response.data);
                // User selects a file path for saving the JSON
                /*
                const savePath = await vscode.window.showSaveDialog({
                    saveLabel: "Save Cycle Structure",
                    filters: {
                        "JSON Files": ["json"],
                        "All Files": ["*"],
                    },
                });

                if (savePath) {
                    const filePath = savePath.fsPath;
                    saveJsonToFile(filePath, response.data);
                } else {
                    vscode.window.showErrorMessage("No file path selected.");
                }
                */
                return response.data;
            }
            else {
                console.error(`Unexpected response code: ${response.status}`);
            }
        }
        catch (error) {
            console.error("Error fetching cycle structure:", error);
        }
    }
    // Sends a GET request to the projects endpoint to verify if the connection is working.
    async checkIsWorking() {
        try {
            const projectsURL = `/projects/v1`;
            const projectsResponse = await this.apiClient.get(projectsURL, {
                headers: {
                    accept: "application/vnd.testbench+json",
                },
            });
            return projectsResponse.status === 200;
        }
        catch (error) {
            console.error("Error checking connection:", error.message);
            if (error.response) {
                console.error("Error response data:", error.response.data);
                console.error("Error response status:", error.response.status);
                console.error("Error response headers:", error.response.headers);
            }
            return false;
        }
    }
    async logoutUser(context, treeDataProvider) {
        try {
            const response = await this.apiClient.delete(`/login/session/v1`, {
                headers: {
                    accept: "application/vnd.testbench+json",
                },
            });
            if (response.status === 204) {
                if (treeDataProvider) {
                    treeDataProvider.clearTree();
                }
                console.log("Logout successful");
                vscode.window.showInformationMessage("Logout successful.");
            }
            else {
                console.log(`Unexpected response status: ${response.status}`);
                vscode.window.showInformationMessage(`Unexpected response status: ${response.status}`);
            }
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                console.error(`Error during logout: ${error.response?.status} - ${error.response?.statusText}. If the issue persists, please log in again.`);
                vscode.window.showInformationMessage(`Error during logout: ${error.response?.status} - ${error.response?.statusText}. If the issue persists, please log in again.`);
            }
            else {
                console.error(`An unexpected error occurred: ${error}`);
            }
        }
        finally {
            // Regardless of the outcome, stop the keep-alive process
            this.stopKeepAlive();
            this.clearSessionData(); // Clear the session data after stopping keep-alive because it also resets keepAliveIntervalId
            vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", false);
        }
    }
    startKeepAlive() {
        this.stopKeepAlive(); // Ensure no multiple intervals
        this.keepAliveIntervalId = setInterval(() => {
            this.sendKeepAliveRequest();
        }, 4 * 60 * 1000); // Every 4 minutes
        console.log("Keep-alive STARTED.");
        // Send an immediate keep-alive request
        this.sendKeepAliveRequest();
    }
    stopKeepAlive() {
        if (this.keepAliveIntervalId) {
            clearInterval(this.keepAliveIntervalId);
            this.keepAliveIntervalId = null;
            console.log("Keep-alive STOPPED.");
        }
    }
    // Sends a GET request to the server to keep the session alive, which normally times out after 5 minutes
    async sendKeepAliveRequest() {
        if (!this.sessionToken) {
            console.warn("Session token is null. Cannot send keep-alive request.");
            return;
        }
        try {
            await this.apiClient.get(`/login/session/v1`, {
                headers: {
                    accept: "application/vnd.testbench+json",
                },
            });
            console.log("Keep-alive request SENT.");
        }
        catch (error) {
            console.error("Keep-alive request failed:", error);
        }
    }
}
exports.PlayServerConnection = PlayServerConnection;
// A generalized method to prompt for any user input with live validation
async function promptForInput(prompt, canBeEmpty = false, password = false, validate) {
    while (true) {
        const input = await vscode.window.showInputBox({
            prompt,
            password,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!canBeEmpty && value === "") {
                    return "Value cannot be empty";
                }
                if (validate) {
                    return validate(value);
                }
                return null;
            },
        });
        if (input === undefined || input.toLowerCase() === "quit") {
            vscode.window.showInformationMessage("Login process aborted");
            return undefined;
        }
        if (!validate || validate(input) === null) {
            return input;
        }
        vscode.window.showErrorMessage(validate(input) || "Invalid input, please try again.");
    }
}
// Entry point for the login process
async function performLogin(context, baseKey, promptForNewCredentials = false) {
    // Loop until the user successfully logs in or cancels the login process
    while (true) {
        // Retrieve the stored credentials if they exist
        const config = vscode.workspace.getConfiguration(baseKey);
        let storePassword = config.get("storePasswordAfterLogin", false);
        let password;
        // Only retrieve the password if the user has choosen to store it
        if (storePassword) {
            password = await context.secrets.get("password");
        }
        const hasStoredCredentials = config.get("serverName") && config.get("username") && password && storePassword;
        let useStoredCredentials = false;
        if (hasStoredCredentials && !promptForNewCredentials) {
            const choice = await vscode.window.showInformationMessage("Do you want to login using your previous credentials?", "Yes", "No");
            if (choice === "Yes") {
                useStoredCredentials = true;
            }
        }
        let serverName;
        let portNumber;
        let username;
        if (useStoredCredentials) {
            serverName = config.get("serverName");
            portNumber = config.get("portNumber");
            username = config.get("username");
        }
        else {
            const credentials = await promptForLoginCredentials(context, baseKey);
            if (!credentials) {
                vscode.window.showInformationMessage("Login process aborted");
                return null;
            }
            ({ serverName, portNumber, username, password } = credentials);
        }
        // Attempt to login
        const connection = await loginToNewPlayServerAndInitSessionToken(context, serverName, portNumber, username, password, baseKey);
        if (connection) {
            vscode.window.showInformationMessage("Login successful!");
            vscode.commands.executeCommand("setContext", "testbenchExtension.connectionActive", true);
            return connection;
        }
        else {
            await clearStoredCredentials(context, baseKey);
            const retry = await vscode.window.showInformationMessage("Login failed! Do you want to retry?", "Retry", "Cancel");
            if (retry !== "Retry") {
                vscode.window.showInformationMessage("Login process aborted");
                return null;
            }
            else {
                // Continue the loop to retry
            }
        }
    }
}
// Function to prompt user for login credentials
async function promptForLoginCredentials(context, baseKey) {
    const config = vscode.workspace.getConfiguration(baseKey);
    // Get server name from configuration
    const serverNameConfig = config.get("serverName", "testbench");
    // Prompt user for server name, showing the default value only if it exists
    const serverNameInput = await promptForInput(`Enter the server name${serverNameConfig ? ` (Default: ${serverNameConfig})` : ""}`, true);
    // If user cancels the input prompt, return null to cancel the login process
    if ((!serverNameInput && !serverNameConfig) || serverNameInput === undefined) {
        return null;
    }
    // Use user input if provided, otherwise fallback to configuration value
    const serverName = serverNameInput || serverNameConfig;
    // Get port number from configuration (default: 9445)
    const portConfig = config.get("portNumber", 9445);
    // Prompt user for port number, only showing the default if it's configured
    const portInputAsString = await promptForInput(`Enter the port number${portConfig ? ` (Default: ${portConfig})` : ""}`, true, false, (value) => {
        if (value && !/^\d+$/.test(value)) {
            return "Port number must be a number";
        }
        return null;
    });
    if ((!portInputAsString && !portConfig) || portInputAsString === undefined) {
        return null;
    }
    const portNumber = portInputAsString ? parseInt(portInputAsString, 10) : portConfig;
    // Check if the server is accessible
    const serverVersions = await fetchServerVersions(serverName, portNumber);
    if (!serverVersions) {
        vscode.window.showErrorMessage("Server not accessible with the provided server name and port.");
        return null;
    }
    const usernameInput = await promptForInput(`Enter your login name (Default: ${config.get("username", "undefined")})`, true);
    if (usernameInput === undefined) {
        return null;
    }
    const username = usernameInput || config.get("username", "undefined");
    // Prompt for password
    const password = await promptForInput("Enter your password", false, true);
    if (password === undefined) {
        return null;
    }
    return { serverName, portNumber, username, password };
}
// Login to the new play server and return the session token.
async function loginToNewPlayServerAndInitSessionToken(context, serverName, portNumber, username, password, baseKey) {
    const requestBody = {
        login: username,
        password: password,
        force: true,
    };
    try {
        const baseURL = `https://${serverName}:${portNumber}/api`;
        const loginURL = `${baseURL}/login/session/v1`;
        console.log("Sending Login POST request to:", loginURL);
        const response = await axios_1.default.post(loginURL, requestBody, {
            headers: {
                accept: "application/vnd.testbench+json",
                "Content-Type": "application/vnd.testbench+json",
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
        });
        if (response.status === 201) {
            console.log("Login successful. Received session token:", response.data.sessionToken);
            // Store password in secret storage if the user chooses to
            const config = vscode.workspace.getConfiguration(baseKey);
            const storePassword = config.get("storePasswordAfterLogin", false);
            if (storePassword) {
                await context.secrets.store("password", password);
                console.log("Password stored securely in secret storage.");
            }
            // This starts keep alive in the constructor
            const connection = new PlayServerConnection(context, serverName, portNumber, response.data.sessionToken);
            if (connection) {
                // Deleted checkIsWorking from here
                return connection;
            }
            return null;
        }
        else {
            console.log("Login failed. Unexpected status code:", response.status);
            return null;
        }
    }
    catch (error) {
        console.error("Error during login:", error);
        return null;
    }
}
// Function to clear stored credentials
async function clearStoredCredentials(context, baseKey) {
    try {
        await context.secrets.delete("password");
    }
    catch (error) {
        console.error("Failed to clear credentials:", error);
    }
}
async function changeConnection(context, baseKey, oldConnection, oldTreeDataProvider) {
    if (oldConnection) {
        await oldConnection.logoutUser(context, oldTreeDataProvider);
        await clearStoredCredentials(context, baseKey);
        let newConnection = await performLogin(context, baseKey, true);
        let newTreeDataProvider = null;
        if (newConnection) {
            [newTreeDataProvider] = await (0, projectManagementTreeView_1.initializeTreeView)(context, newConnection);
        }
        return { newConnection, newTreeDataProvider };
    }
    else {
        vscode.window.showErrorMessage("No connection available. Please log in first.");
    }
    return { newConnection: null, newTreeDataProvider: null };
}
// Retrieves the current versions of the TestBench web server.
// Used to verify the availability of server after receiving the server URL and port number in the login process.
async function fetchServerVersions(serverName, portNumber) {
    try {
        const baseURL = `https://${serverName}:${portNumber}`;
        const serverVersionsURL = `${baseURL}/api/serverVersions/v1`;
        console.log("Fetching server versions with URL:", serverVersionsURL);
        const response = await axios_1.default.get(serverVersionsURL, {
            headers: {
                Accept: "application/vnd.testbench+json",
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: false, // TODO: Should be true in production
            }),
        });
        vscode.window.showInformationMessage(`TestBench Release Version: ${response.data.releaseVersion}, Database Version: ${response.data.databaseVersion}, Revision: ${response.data.revision}`);
        return response.data;
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error)) {
            if (error.response) {
                console.error(`Error: Received status code ${error.response.status}`, error.response.data);
                if (error.response.status === 404) {
                    console.error(`TestBench version cannot be found under the URL https://${serverName}:${portNumber}`);
                }
            }
            else if (error.request) {
                console.error("Error: No response received from server.", error.request);
            }
            else {
                console.error("Error:", error.message);
            }
        }
        else {
            console.error("Unexpected error:", error);
        }
        return null;
    }
}
//# sourceMappingURL=testBenchConnection.js.map