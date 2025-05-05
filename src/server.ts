import * as vscode from "vscode";
import { extensions } from "vscode";
import { LANGUAGE_SERVER_SCRIPT_PATH } from "./constants";
import { getInterpreterPath } from "./python";
import { LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { connection } from "./extension";

export let client: LanguageClient;

export async function initializeLanguageServer(): Promise<void> {
    const pythonPath: string | undefined = await getInterpreterPath();
    if (!pythonPath) {
        return;
    }
    if (!connection) {
        return;
    }
    const serverName = connection.getServerName();
    const serverPort = connection.getServerPort();
    const username = connection.getUsername();
    const sessionToken = connection.getSessionToken();

    const languge_server_settings = vscode.workspace.getConfiguration("testbenchExtension");
    // const server_name: string | null = languge_server_settings.get<string | null>("serverName", null);
    // const server_port: string | null = languge_server_settings.get<string | null>("portNumber", null);
    // const username: string | null = languge_server_settings.get<string | null>("username", null);
    // const username: string | null = null;

    const project: string = languge_server_settings.get<string>("project", "");
    const tov: string = languge_server_settings.get<string>("tov", "");
    const serverOptions: ServerOptions = {
        run: {
            command: pythonPath,
            args: [
                LANGUAGE_SERVER_SCRIPT_PATH,
                serverName || "",
                serverPort || "",
                username || "",
                sessionToken || "",
                project,
                tov || ""
            ]
        },
        debug: {
            command: pythonPath,
            args: [
                LANGUAGE_SERVER_SCRIPT_PATH,
                serverName || "",
                serverPort || "",
                username || "robot",
                sessionToken || "",
                project,
                tov || ""
            ]
        }
        // debug: { command: pythonPath, args: ["-m", "testbench_ls", "--debug"] },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "robotframework", pattern: "**/*.resource" }],
        synchronize: {
            fileEvents: [vscode.workspace.createFileSystemWatcher("**/*.resource", false, false)]
        }
    };

    client = new LanguageClient("testbench-ls", "TestBench LS", serverOptions, clientOptions);
    client.start();
    client.onNotification("custom/notification", (params) => {
        vscode.window.showInformationMessage(`${params.message}`);
    });
    vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("testbenchExtension.serverName")) {
            const newServerName = vscode.workspace
                .getConfiguration("testbenchExtension")
                .get<string | null>("serverName", null);
            vscode.commands.executeCommand("testbench_ls.updateServerName", newServerName);
        } else if (event.affectsConfiguration("testbenchExtension.portNumber")) {
            const newPortNumber = vscode.workspace
                .getConfiguration("testbenchExtension")
                .get<string | null>("portNumber", null);
            vscode.commands.executeCommand("testbench_ls.updateServerPort", newPortNumber);
        }
        // else if (event.affectsConfiguration('testbenchExtension.username')) {
        //   const newUsername = vscode.workspace.getConfiguration('testbenchExtension').get<string | null>("username", null);
        //   vscode.commands.executeCommand("testbench_ls.updateLoginName", newUsername);
        // }
        else if (event.affectsConfiguration("testbenchExtension.project")) {
            const newProject = vscode.workspace
                .getConfiguration("testbenchExtension")
                .get<string | null>("project", null);
            vscode.commands.executeCommand("testbench_ls.updateProject", newProject);
        } else if (event.affectsConfiguration("testbenchExtension.tov")) {
            const newTov = vscode.workspace.getConfiguration("testbenchExtension").get<string | null>("tov", null);
            vscode.commands.executeCommand("testbench_ls.updateTov", newTov);
        }
    });
}
