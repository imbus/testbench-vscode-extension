---
sidebar_position: 1
title: Settings Reference
---

This page is a quick reference for TestBench extension settings.

- Use the **Setting** column when browsing settings in VS Code.
- Use the **Setting ID** column when editing `.vscode/settings.json` or searching by ID.

For deeper behavior of generation and import related options (provided by the bundled TestBench2RobotFramework tooling), see the [TestBench2RobotFramework documentation](https://github.com/imbus/testbench2robotframework#readme).

Settings are grouped in VS Code under these categories:

- Login
- Logger
- TestBench2RobotFramework
- Test Generation
- Connection

## Login

| Setting                                    | Setting ID                                                | Value Type | Default | Description                                                                                    |
| ------------------------------------------ | --------------------------------------------------------- | ---------- | ------- | ---------------------------------------------------------------------------------------------- |
| Automatic Login After Extension Activation | testbenchExtension.automaticLoginAfterExtensionActivation | Boolean    | false   | Automatically attempts login on startup using the last active connection, if one is available. |

## Logger

| Setting             | Setting ID                           | Value Type | Default | Description                                                              |
| ------------------- | ------------------------------------ | ---------- | ------- | ------------------------------------------------------------------------ |
| Testbench Log Level | testbenchExtension.testbenchLogLevel | Enum       | Info    | Minimum log level. Options: No logging, Trace, Debug, Info, Warn, Error. |

## TestBench2RobotFramework

| Setting                            | Setting ID                                        | Value Type      | Default              | Description                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------- | --------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean Files Before Test Generation | testbenchExtension.cleanFilesBeforeTestGeneration | Boolean         | true                 | Deletes existing files in the output directory before generating new suites.                                                                                      |
| Fully Qualified Keywords           | testbenchExtension.fullyQualifiedKeywords         | Boolean         | false                | Uses fully qualified keyword calls in generated suites, for example `ResourceOrLibrary.Keyword`.                                                                  |
| Output Directory                   | testbenchExtension.outputDirectory                | String          | tests                | Output location for generated suites (relative to workspace). A ZIP archive path is also supported by the underlying generator.                                   |
| Compound Keyword Logging           | testbenchExtension.compoundKeywordLogging         | Enum            | GROUP                | Logging mode for compound keywords: GROUP, COMMENT, NONE.                                                                                                         |
| Log Suite Numbering                | testbenchExtension.logSuiteNumbering              | Boolean         | true                 | Enables logging of the test suite numbering (generator option `--log-suite-numbering`).                                                                           |
| Resource Directory Path            | testbenchExtension.resourceDirectoryPath          | String          | empty                | Base directory for generated or managed `.resource` files (relative to workspace).                                                                                |
| Resource Root Regex                | testbenchExtension.resourceRootRegex              | String          | .\*                  | Regex anchor used when mapping subdivision hierarchy to local resource folder paths and imports.                                                                  |
| Library Marker                     | testbenchExtension.libraryMarker                  | List of strings | ["[Robot-Library]"]  | Marker suffixes used to identify library subdivisions.                                                                                                            |
| Library Root                       | testbenchExtension.libraryRoot                    | List of strings | ["RF", "RF-Library"] | Root nodes used to identify the library hierarchy.                                                                                                                |
| Resource Marker                    | testbenchExtension.resourceMarker                 | List of strings | ["[Robot-Resource]"] | Marker suffixes used to identify resource subdivisions.                                                                                                           |
| Resource Root                      | testbenchExtension.resourceRoot                   | List of strings | ["RF-Resource"]      | Root nodes used to identify the resource hierarchy.                                                                                                               |
| Library Mapping                    | testbenchExtension.libraryMapping                 | List of strings | []                   | Optional subdivision-to-library import mappings in the form `<Subdivision>:<Library Import>`.                                                                     |
| Resource Mapping                   | testbenchExtension.resourceMapping                | List of strings | []                   | Optional subdivision-to-resource import mappings in the form `<Subdivision>:<Resource Import>`.                                                                   |
| Output Xml File Path               | testbenchExtension.outputXmlFilePath              | String          | results/output.xml   | Path to the Robot Framework output XML used for execution result import (relative to workspace). If no file is found there, the extension asks you to select one. |

### How subdivisions map to resource files

These settings decide which TestBench subdivisions are treated as Robot Framework resources and where their `.resource` files live:

- **Resource Marker** identifies resource subdivisions by a name suffix (default: `[Robot-Resource]`).
- **Resource Root Regex** selects the anchor subdivision. The regular expression is tested against each subdivision in the path, and the first match becomes the anchor. The anchor and everything above it are ignored; the subdivisions below it form the folder structure.
- **Resource Directory Path** is prefixed to the resulting path and to the resource imports in generated suites.

Example:

| Item                    | Value                                                             |
| ----------------------- | ----------------------------------------------------------------- |
| Subdivision path        | `Keywords` / `RF-Keywords` / `Shop` / `Checkout [Robot-Resource]` |
| Resource Root Regex     | `RF-Keywords`                                                     |
| Resource Directory Path | `resources`                                                       |
| Resulting resource file | `resources/Shop/Checkout.resource`                                |

With the default regex `.*`, the first subdivision in the path is the anchor.

### Example `settings.json`

```json
{
    "testbenchExtension.outputDirectory": "tests",
    "testbenchExtension.outputXmlFilePath": "results/output.xml",
    "testbenchExtension.resourceDirectoryPath": "resources",
    "testbenchExtension.resourceRootRegex": "RF-Keywords",
    "testbenchExtension.resourceMarker": ["[Robot-Resource]"],
    "testbenchExtension.libraryMapping": ["Browser Keywords:Browser"],
    "testbenchExtension.resourceMapping": ["Common Keywords:resources/common.resource"]
}
```

Each **Library Mapping** and **Resource Mapping** entry has the form `<Subdivision name>:<import>`. The import is written to the generated suites instead of the import derived from the subdivision name.

## Test Generation

| Setting                                                   | Setting ID                                                             | Value Type | Default | Description                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------- |
| Clear Internal Testbench Directory Before Test Generation | testbenchExtension.clearInternalTestbenchDirectoryBeforeTestGeneration | Boolean    | false   | Clears internal `.testbench` files before generation (except protected internal artifacts). |
| Open Testing View After Test Generation                   | testbenchExtension.openTestingViewAfterTestGeneration                  | Boolean    | false   | Opens the VS Code Testing view automatically after generation.                              |

## Connection

| Setting          | Setting ID                         | Value Type | Default | Description                                                               |
| ---------------- | ---------------------------------- | ---------- | ------- | ------------------------------------------------------------------------- |
| Certificate Path | testbenchExtension.certificatePath | String     | empty   | Optional custom PEM certificate path. Supports relative or absolute path. |

## Path rules

- All path settings are workspace-relative except `certificatePath`.
- `certificatePath` supports both absolute and relative values.

Example:

- workspace: `C:\MyWorkspace`
- outputDirectory value for `C:\MyWorkspace\tests`: `tests`

## Certificate and TLS configuration

Use **certificatePath** only when your TestBench server uses a self-signed or private CA certificate.

Certificate validation behavior:

1. If **certificatePath** is configured, extension validation uses both the provided certificate and system trust.
2. If **certificatePath** is empty, **NODE_EXTRA_CA_CERTS** is checked.
3. If neither is configured, only system trust is used.

Alternative environment variable approach:

- Windows: set `NODE_EXTRA_CA_CERTS=C:\path\to\certificate.pem` and restart VS Code.
- Linux/macOS: export `NODE_EXTRA_CA_CERTS=/path/to/certificate.pem`, then restart terminal and VS Code.

## Proxy

The extension has no proxy setting of its own. It uses the VS Code settings:

- `http.proxy` is used for requests to the TestBench server.
- `http.noProxy` is additionally passed to the keyword synchronization backend, together with `http.proxy`.

## Logging behavior

- Logs are stored in `.testbench/logs` in the workspace. The active log file is `testBenchExtension.log`.
- Up to 3 log files are retained.
- Each log file rotates at 5 MB.
