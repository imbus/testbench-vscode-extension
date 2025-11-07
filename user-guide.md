This guide explains how to use the TestBench VS Code Extension to navigate inside projects, generate Robot Framework tests, execute them, import results back to TestBench and manage Robot Framework resource files.

## Requirements

- Python 3.10 or newer installed on your system
- An open VS Code workspace. Without a workspace, the extension runs in read-only mode and features like test generation and importing results are disabled

**Note:** The following VS Code extensions are required dependencies and will be automatically installed (if not already present) when you install the TestBench extension:

- Python extension (`ms-python.python`)
- RobotCode extension (`d-biehl.robotcode`) - for Robot Framework test execution

## Quick Start

1. Open the TestBench view in VS Code (activity bar icon)
2. Create/select a TestBench connection and log in
3. After the first login, the Projects view opens automatically

If no workspace is open, the extension informs you that it’s running in read-only mode.

## Login and Connections

- Manage connections (create, edit, remove) with: label, server URL, port, username, and password
- Password storage is optional; other details are stored in VS Code Secret Storage
- The connection label must be unique for a connection; the extension also prevents creation of duplicate connections of the same host, port, and username
- Use the Extension settings button at the top-right of the login page to open the extension settings

## Projects View

- Shows all available projects for the logged-in user. A project contains Test Object Versions (TOVs), and a TOV contains Test Cycles
- Toolbar of projects view contains following buttons: Logout, Refresh Projects, Search, Open Extension Settings
- Test Object Versions and Test Cycles have buttons to open them in the Test Themes view and buttons to generate tests
- In read-only mode TOVs and cycles do not have buttons for test generation
- Opening a TOV or Cycle switches to a new view where the Test Themes view and Test Elements view are displayed together for that context
- The extension remembers visible tree views and expansion/collapse states of tree items and restores them when you log in again

### Opening Context and Configuration

The extension tracks the active Project and TOV via a config file at `.testbench/ls.config.json` in your workspace root.

- Open a TOV or a Cycle by clicking its button (double-clicking a Cycle name also opens it)
- If `.testbench/ls.config.json` doesn’t exist, the extension offers to create it and fills `projectName` and `tovName` when you open a TOV or Cycle
- You can also right-click a Project or TOV and choose Set as Active Project / Set as Active TOV. A pin icon marks the active items in projects tree view
- The extension listens for `ls.config.json` changes and updates pin icons automatically in the Projects view
- If `ls.config.json` is missing or invalid, a guided fix is offered to set a valid configuration based on visible projects and TOVs

Example `ls.config.json`

```json
{
    "projectName": "MyProject",
    "tovName": "MyTOV"
}
```

## Search in Tree Views

- Press the Search button of a tree view to filter tree items live as you type
- Once a search is active, the search icon changes its color to indicate the active state. Clearing the search text disables the search
- Configure Search Options via the gear icon to tailor matching
    - Search criteria: Name, Tooltip, UIDs (note: Projects view items do not have UIDs)
    - Options: Case Sensitive, Exact Match, Show Children of Matches (also shows the children of matching items)

## Test Themes View

- Test themes view is opened by opening a TOV or Cycle in the Projects view
- Shows test themes and test case sets for the opened TOV or Cycle
- The view title includes the Project, TOV, and Cycle name to display the current context
- Toolbar of test themes view contains following buttons: Refresh Test Themes, Open Projects View, Search (TODO: Filter and Filter diff)
- The view displays only tree items with an execution status other than NotPlanned and not locked by the system

## Generating Robot Framework Tests

- You can generate Robot Framework tests for a single tree item or for entire subtrees by clicking the robotframework icon next to the tree item.
- Test generation process uses the bundled `testbench2robotframework` library internally
- Output location of generated tests is configured via the Output Directory setting (relative to the workspace)
- After test generation, generated tree items in the tree are marked visually
- Single-click a generated Test Case Set to open the generated `.robot` file, double-click also reveals the file location in VS Code Explorer
- In Extension settings you can enable 'Open Testing View After Test Generation' to automatically open VS Code’s Testing view after generating tests

## Execute and Import Results

- Generated tests can be executed with the RobotCode extension
- Robot Framework writes results of test execution to `output.xml`. Set the 'Output Xml File Path' (relative to the workspace) in the extension settings to point to this file
- After test generation, an Import button appears for tree items that were generated
    - Import results for an entire generated hierarchy from the top-most item, or
    - Import results for specific items only
- After an import, the tooltip of the imported tree items is updated to display the results. Execution status of the imported items is set to Performed, and the verdict displays the execution outcome.

## Test Elements View

- Test elements view shows subdivisions and their keywords for the current TOV context
- The title of test elements view includes the Project and TOV name to display the current context
- The 'Resource Marker' setting identifies subdivisions that correspond to Robot Framework resources. Subdivisions whose names end with this marker are treated as `.resource` files
- Use the 'Create Resource' action on such a subdivision to create a local `.resource` file. After creation, the file is revealed in the VS Code Explorer and opened in the VS Code editor
- The icons of subdivision tree items that are locally available as resource files will be colored differently to indicate their local availability. The 'Create Resource' button becomes 'Open Resource' for such items to open and reveal the existing resource file.
- In test elements view, single-clicking a keyword under a Robot Framework resource subdivision opens the corresponding resource file and jumps to the keyword definition. Double-clicking the keyword also reveals the file location in VS Code Explorer.

### Language Server Features for Resource Files

- The first two lines of a generated resource file contain metadata: the subdivision UID and its context
- If context metadata is missing or invalid, a quick fix helps set the correct context
- CodeLens actions over metadata and keywords let you pull from and push to the TestBench server to keep local files synchronized

## Extension Settings

Settings are grouped in VS Code under these sections

- Login
- Logger
- TestBench2RobotFramework
- Test Generation
- Connection

### Settings Overview

#### Login Settings

- **Automatic Login After Extension Activation**
    - **Type:** Boolean
    - **Default:** `false`
    - **Description:** When enabled, the extension automatically attempts to log in to the TestBench server using the last used connection after the extension is activated.

#### Logger Settings

- **TestBench Log Level**
    - **Type:** String (Enum)
    - **Default:** `Info`
    - **Options:** `No logging`, `Trace`, `Debug`, `Info`, `Warn`, `Error`
    - **Description:** Sets the minimum log level for the extension. Logs are saved in the log folder inside the `.testbench` directory within the workspace. Choose `Trace` or `Debug` for detailed troubleshooting, `Info` for general operation monitoring, `Warn` for warnings only, or `Error` to log only errors. Select `No logging` to disable logging entirely. Log rotation automatically manages log files (up to 3 files, max 10 MB each).

#### TestBench2RobotFramework Settings

These settings control how the extension generates Robot Framework test suites from TestBench data.

- **Use Configuration File**
    - **Type:** Boolean
    - **Default:** `false`
    - **Description:** When enabled, `testbench2robotframework` prioritizes settings specified in the `pyproject.toml` file over the extension settings defined in VS Code.

- **Clean Files Before Test Generation**
    - **Type:** Boolean
    - **Default:** `true`
    - **Description:** When enabled, deletes all files present in the output directory before new test suites are created.

- **Fully Qualified Keywords**
    - **Default:** `false`
    - **Description:** When enabled, Robot Framework keywords are called by their fully qualified name (e.g., `LibraryName.Keyword Name`) in the generated test suites.

- **Output Directory**
    - **Type:** String
    - **Default:** `tests`
    - **Description:** Specifies the directory where the generated Robot Framework test suites (`.robot` files) will be created. The path is relative to the workspace root. For example, if set to `tests`, files will be created in `<workspace>/tests/`.

- **Compound Keyword Logging**
    - **Type:** String (Enum)
    - **Default:** `GROUP`
    - **Options:** `GROUP`, `COMMENT`, `NONE`
    - **Description:** Controls how compound TestBench keywords (keywords that contain other keywords) are logged in the generated test suites:
        - `GROUP`: Compound keywords are wrapped in a collapsible group
        - `COMMENT`: Compound keywords are marked with comments
        - `NONE`: No special logging for compound keywords

- **Log Suite Numbering**
    - **Type:** Boolean
    - **Default:** `false`
    - **Description:** When enabled, test suite numbering is logged in the generated Robot Framework files. This can help with traceability and organization when dealing with large numbers of test suites.

- **Library Marker**
    - **Type:** Array of Strings
    - **Default:** `["[Robot-Library]"]`
    - **Description:** Marker(s) used to identify TestBench Subdivisions that correspond to Robot Framework libraries. Subdivisions whose names end with any of these markers will be treated as Robot Framework libraries during test generation. For example, a subdivision named `MySubdivision [Robot-Library]` would be recognized as a library.

- **Library Root**
    - **Type:** Array of Strings
    - **Default:** `["RF", "RF-Library"]`
    - **Description:** Identifies TestBench root subdivision(s) whose direct children correspond to Robot Framework libraries.

- **Resource Root Regex**
    - **Type:** String
    - **Default:** `resources`
    - **Description:** Regular expression that identifies where the resource directory begins in TestBench's subdivision hierarchy. Acts as a cut point, where everything before this marker is ignored, and everything after it is preserved in the local file structure under the Resource Directory Path. For example: with regex `resources` and TestBench path `Project/resources/Login/Keywords`, the local file becomes `<Resource Directory Path>/Login/Keywords.resource` (ignoring `Project/resources`).

- **Resource Directory Path**
    - **Type:** String
    - **Default:** `""` (empty)
    - **Description:** Specifies the local directory where Robot Framework resource files (`.resource` files) will be stored. The path is relative to the workspace root. This setting works with Resource Root Regex to map TestBench's subdivision hierarchy to your local file system. For example: if Resource Root Regex is `resources` and this is set to `robot_resources`, a TestBench path like `Project/resources/Utils/Keywords` becomes `robot_resources/Utils/Keywords.resource` locally.

- **Resource Marker**
    - **Type:** Array of Strings
    - **Default:** `["[Robot-Resource]"]`
    - **Description:** Marker(s) used to identify TestBench Subdivisions that correspond to Robot Framework resources. Subdivisions whose names end with any of these markers are treated as Robot Framework resources. In the Test Elements view, subdivisions with this marker are displayed and have special actions to create or open the corresponding `.resource` file.

- **Resource Root**
    - **Type:** Array of Strings
    - **Default:** `["RF-Resource"]`
    - **Description:** Identifies TestBench root subdivision(s) whose direct children correspond to Robot Framework resources.

- **Library Mapping**
    - **Type:** Array of Strings
    - **Default:** `[]` (empty)
    - **Description:** Optional custom mapping of TestBench Subdivisions to Robot Framework library imports. Each entry must be in the format: `<TestBench Subdivision Name>:<Robot Framework Library import>`.

- **Resource Mapping**
    - **Type:** Array of Strings
    - **Default:** `[]` (empty)
    - **Description:** Optional custom mapping of TestBench Subdivisions to Robot Framework resource imports. Each entry must be in the format: `<TestBench Subdivision Name>:<Robot Framework Resource import>`.

- **Output Xml File Path**
    - **Type:** String
    - **Default:** `results/output.xml`
    - **Description:** The relative file path where the Robot Framework output XML file (test execution results) is stored. This file is generated by Robot Framework after test execution and is used by the extension to import test results back to the TestBench server. The path is relative to the workspace root. If not set, the extension will prompt you to select an `output.xml` file location when importing results.

#### Test Generation Settings

- **Clear Internal TestBench Directory Before Test Generation**
    - **Type:** Boolean
    - **Default:** `false`
    - **Description:** When enabled, deletes all files (excluding log files and project config file) from the internal `.testbench` directory before generating tests.

- **Open Testing View After Generation**
    - **Type:** Boolean
    - **Default:** `false`
    - **Description:** When enabled, the VS Code Testing view is automatically opened after test generation completes, where you can run the newly generated tests.

#### Connection Settings

- **Certificate Path**
    - **Type:** String
    - **Default:** `""` (empty)
    - **Description:** Optional path to the public TestBench server certificate file (`.pem` format). This can be either an absolute path or a path relative to the workspace root.

        **When to use:** A certificate is only required when connecting to TestBench servers that use self-signed certificates or custom certificate authorities (e.g., development/test environments or unofficial server versions). In production environments with official TestBench servers using standard certificates, this setting can be left empty.

        **How certificate validation works:**
        1. If Certificate Path is set, the extension uses both your custom certificate AND the system's default certificate store for validation
        2. If Certificate Path is empty, the extension checks the `NODE_EXTRA_CA_CERTS` environment variable (see below)
        3. If neither is set, only the system's default certificate store is used

        **Using NODE_EXTRA_CA_CERTS environment variable:** Instead of configuring Certificate Path in the extension settings, you can set the `NODE_EXTRA_CA_CERTS` environment variable to point to your certificate file.

        To set `NODE_EXTRA_CA_CERTS`:
        - **Windows:** Set a system or user environment variable `NODE_EXTRA_CA_CERTS=C:\path\to\certificate.pem`, then restart VS Code
        - **Linux/macOS:** Add `export NODE_EXTRA_CA_CERTS=/path/to/certificate.pem` to your shell profile (e.g., `~/.bashrc`, `~/.zshrc`), then restart your terminal and VS Code

### Note

- **All path strings in the extension settings are relative to your current VS Code workspace root, except Certificate Path which accepts both absolute and relative paths.** For example, if your workspace is `C:\MyWorkspace` and you want to set 'Output Directory' to `C:\MyWorkspace\tests`, use `tests`. For Certificate Path, you can use either `C:\certs\server.pem` (absolute) or `certs\server.pem` (relative).

- **Most settings apply at the workspace level**, meaning they are specific to the current workspace. Some settings like login and logging apply at the resource level, which allows different configurations for different workspace folders in a multi-root workspace.

## Logging

- Logs for the extension are kept under the internal `.testbench` folder in your workspace
- Log levels: NO LOGGING, INFO (default), WARN, ERROR, DEBUG, TRACE
- Log rotation: Up to 3 files are kept. When a log exceeds 10 MB, a new file is created and the oldest is overwritten

## Technical Details

- For failed but recoverable HTTP responses, the extension retries requests automatically
- If retries repeatedly fail, the extension assumes the server is unavailable and returns you to the login page
- If you are logged in to the extension on one VS Code window, and open a new VS Code window, the extension shares the existing user session in new VS Code windows and automatically logs you in. A logout in one VS Code window logs out all windows using that connection. The extension does not remove the current user session on the server when logging out, so that any other potential existing API users are not affected.

## Troubleshooting

- Ensure a folder is opened as your VS Code workspace
- Python 3.10+ is required. Ensure it’s installed and available to VS Code

- Cannot generate or import results
    - Set Output Directory and Output Xml File Path correctly (paths are relative to your workspace)
    - Ensure the RobotCode extension is installed to run Robot Framework tests
    - Make sure tests were executed and `output.xml` exists
    - Make sure that tree items that are being generated are not locked by the system inside TestBench client
- The command 'Reload Window' (Ctrl+R) can help resolve transient issues with the extension
- The extension offers the command 'TestBench: Clear All Extension Data' to reset all persistent extension data stored in the current workspace, including stored connections. Use this command if you encounter persistent issues that cannot be resolved otherwise. This action cannot be undone.
