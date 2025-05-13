import * as vscode from "vscode";
import { LANGUAGE_SERVER_SCRIPT_PATH, LANGUAGE_SERVER_DEBUG_PATH, baseKeyOfExtension } from "./constants";
import { getInterpreterPath } from "./python";
import { LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { connection, logger } from "./extension";

export let client: LanguageClient;

export async function initializeLanguageServer(project: string, tov: string): Promise<void> {
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
    const serverName: string = connection.getServerName();
    const serverPort: string = connection.getServerPort();
    const username: string = connection.getUsername();
    const sessionToken: string = connection.getSessionToken();
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
}
