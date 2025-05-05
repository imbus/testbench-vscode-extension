import * as path from "path";

export const EXTENSION_ID: string = "imbus.testbench-visual-studio-code-extension";
export const EXTENSION_ROOT_DIR: string = path.dirname(__dirname);
export const PACKAGES_DIR: string = path.join(EXTENSION_ROOT_DIR, "packages");
export const LANGUAGE_SERVER_SCRIPT_PATH: string = path.join(
    PACKAGES_DIR,
    "testbench-ls",
    "testbench_ls",
    "__main__.py"
);

/*
export const BUNDLED_PYTHON_SCRIPTS_DIR: string = path.join(EXTENSION_ROOT_DIR, "bundled");
export const LANGUAGE_SERVER_SCRIPT_PATH: string = path.join(
    BUNDLED_PYTHON_SCRIPTS_DIR,
    "libs",
    "testbench_ls",
    "__main__.py"
);
*/
