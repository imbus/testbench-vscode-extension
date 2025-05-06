import * as path from "path";

export const EXTENSION_ID = "imbus.testbench-visual-studio-code-extension";
export const EXTENSION_ROOT_DIR = path.dirname(__dirname);
export const BUNDLED_PYTHON_SCRIPTS_DIR = path.join(EXTENSION_ROOT_DIR, "bundled");
export const LANGUAGE_SERVER_SCRIPT_PATH = path.join(
    BUNDLED_PYTHON_SCRIPTS_DIR,
    "libs",
    "testbench_ls",
    "language_server.py"
);

export const LANGUAGE_SERVER_DEBUG_PATH = path.join(
    EXTENSION_ROOT_DIR,
    "packages",
    "testbench-ls",
    "testbench_ls",
    "language_server_debug.py"
);
