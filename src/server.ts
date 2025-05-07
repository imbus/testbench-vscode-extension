import * as vscode from "vscode";
import { LANGUAGE_SERVER_SCRIPT_PATH, LANGUAGE_SERVER_DEBUG_PATH, baseKeyOfExtension } from "./constants";
import { getInterpreterPath } from "./python";
import { LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { connection, logger } from "./extension";

export let client: LanguageClient;

export async function initializeLanguageServer(): Promise<void> {
    const pythonPath: string | undefined = await getInterpreterPath();
    if (!pythonPath) {
        logger.warn(
            "Python interpreter path not found. Language Server will not be started. Please ensure Python is configured correctly."
        );
        return;
    }
    if (!connection) {
        logger.info("No active TestBench connection. Language Server will not be started yet.");
        return;
    }
    const serverName = connection.getServerName();
    const serverPort = connection.getServerPort();
    const username = connection.getUsername();
    const sessionToken = connection.getSessionToken();

    const languge_server_settings: vscode.WorkspaceConfiguration =
        vscode.workspace.getConfiguration(baseKeyOfExtension);
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
                LANGUAGE_SERVER_DEBUG_PATH,
                serverName || "",
                serverPort || "",
                username || "",
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
            const newServerName: string | null = vscode.workspace
                .getConfiguration(baseKeyOfExtension)
                .get<string | null>("serverName", null);
            vscode.commands.executeCommand("testbench_ls.updateServerName", newServerName);
        } else if (event.affectsConfiguration("testbenchExtension.portNumber")) {
            const newPortNumber: string | null = vscode.workspace
                .getConfiguration(baseKeyOfExtension)
                .get<string | null>("portNumber", null);
            vscode.commands.executeCommand("testbench_ls.updateServerPort", newPortNumber);
        }
        // else if (event.affectsConfiguration('testbenchExtension.username')) {
        //   const newUsername = vscode.workspace.getConfiguration('testbenchExtension').get<string | null>("username", null);
        //   vscode.commands.executeCommand("testbench_ls.updateLoginName", newUsername);
        // }
        else if (event.affectsConfiguration("testbenchExtension.project")) {
            const newProject: string | null = vscode.workspace
                .getConfiguration(baseKeyOfExtension)
                .get<string | null>("project", null);
            vscode.commands.executeCommand("testbench_ls.updateProject", newProject);
        } else if (event.affectsConfiguration("testbenchExtension.tov")) {
            const newTov: string | null = vscode.workspace
                .getConfiguration(baseKeyOfExtension)
                .get<string | null>("tov", null);
            vscode.commands.executeCommand("testbench_ls.updateTov", newTov);
        }
    });
}
