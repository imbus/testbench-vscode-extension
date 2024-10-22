import * as vscode from "vscode";
import { ProjectManagementTreeDataProvider } from "./projectManagementTreeView.ts";
interface Project {
    key: string;
    creationTime: string;
    name: string;
    status: string;
    visibility: boolean;
    tovsCount: number;
    cyclesCount: number;
    description: string;
    lockerKey: string | null;
    startDate: string | null;
    endDate: string | null;
}
interface TreeNode {
    nodeType: string;
    key: string;
    name: string;
    creationTime: string;
    status: string;
    visibility: boolean;
    children?: TreeNode[];
}
export declare class PlayServerConnection {
    private context;
    private serverName;
    private portNumber;
    private sessionToken;
    private baseURL;
    private apiClient;
    private keepAliveIntervalId;
    constructor(context: vscode.ExtensionContext, serverName: string, portNumber: number, sessionToken: string);
    getSessionToken(): string;
    getBaseURL(): string;
    getSessionTokenFromSecretStorage(context: vscode.ExtensionContext): Promise<string | undefined>;
    clearSessionData(): void;
    selectProjectKeyFromProjectList(projectsData: Project[]): Promise<string | null>;
    getProjectsList(): Promise<Project[] | null>;
    getProjectTreeOfProject(projectKey: string | null): Promise<TreeNode | null>;
    fetchCycleStructure(projectKey: string, cycleKey: string): Promise<any>;
    checkIsWorking(): Promise<boolean>;
    logoutUser(context: vscode.ExtensionContext, treeDataProvider: ProjectManagementTreeDataProvider): Promise<void>;
    private startKeepAlive;
    private stopKeepAlive;
    private sendKeepAliveRequest;
}
export declare function performLogin(context: vscode.ExtensionContext, baseKey: string, promptForNewCredentials?: boolean): Promise<PlayServerConnection | null>;
export declare function changeConnection(context: vscode.ExtensionContext, baseKey: string, oldConnection: PlayServerConnection, oldTreeDataProvider: ProjectManagementTreeDataProvider): Promise<{
    newConnection: PlayServerConnection | null;
    newTreeDataProvider: ProjectManagementTreeDataProvider | null;
}>;
export {};
