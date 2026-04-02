---
sidebar_position: 6
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
| Automatic Login After Extension Activation | testbenchExtension.automaticLoginAfterExtensionActivation | On/Off     | false   | Automatically attempts login on startup using the last active connection, if one is available. |

## Logger

| Setting             | Setting ID                           | Value Type             | Default | Description                                                              |
| ------------------- | ------------------------------------ | ---------------------- | ------- | ------------------------------------------------------------------------ |
| Testbench Log Level | testbenchExtension.testbenchLogLevel | One option from a list | Info    | Minimum log level. Options: No logging, Trace, Debug, Info, Warn, Error. |

## TestBench2RobotFramework

| Setting                            | Setting ID                                        | Value Type             | Default              | Description                                                                                                                     |
| ---------------------------------- | ------------------------------------------------- | ---------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Clean Files Before Test Generation | testbenchExtension.cleanFilesBeforeTestGeneration | On/Off                 | true                 | Deletes existing files in the output directory before generating new suites.                                                    |
| Fully Qualified Keywords           | testbenchExtension.fullyQualifiedKeywords         | On/Off                 | false                | Uses fully qualified keyword calls in generated suites, for example `ResourceOrLibrary.Keyword`.                                |
| Output Directory                   | testbenchExtension.outputDirectory                | Text path              | tests                | Output location for generated suites (relative to workspace). A ZIP archive path is also supported by the underlying generator. |
| Compound Keyword Logging           | testbenchExtension.compoundKeywordLogging         | One option from a list | GROUP                | Logging mode for compound keywords: GROUP, COMMENT, NONE.                                                                       |
| Log Suite Numbering                | testbenchExtension.logSuiteNumbering              | On/Off                 | true                 | Adds numbering prefixes to generated suite folder and file names, for example `1_Name.robot`.                                   |
| Resource Directory Path            | testbenchExtension.resourceDirectoryPath          | Text path              | empty                | Base directory for generated or managed `.resource` files (relative to workspace).                                              |
| Resource Root Regex                | testbenchExtension.resourceRootRegex              | Text pattern (regex)   | .\*                  | Regex anchor used when mapping subdivision hierarchy to local resource folder paths and imports.                                |
| Library Marker                     | testbenchExtension.libraryMarker                  | List of text values    | ["[Robot-Library]"]  | Marker suffixes used to identify library subdivisions.                                                                          |
| Library Root                       | testbenchExtension.libraryRoot                    | List of text values    | ["RF", "RF-Library"] | Root nodes used to identify the library hierarchy.                                                                              |
| Resource Marker                    | testbenchExtension.resourceMarker                 | List of text values    | ["[Robot-Resource]"] | Marker suffixes used to identify resource subdivisions.                                                                         |
| Resource Root                      | testbenchExtension.resourceRoot                   | List of text values    | ["RF-Resource"]      | Root nodes used to identify the resource hierarchy.                                                                             |
| Library Mapping                    | testbenchExtension.libraryMapping                 | List of text values    | []                   | Optional subdivision-to-library import mappings in the form `<Subdivision>:<Library Import>`.                                   |
| Resource Mapping                   | testbenchExtension.resourceMapping                | List of text values    | []                   | Optional subdivision-to-resource import mappings in the form `<Subdivision>:<Resource Import>`.                                 |
| Output Xml File Path               | testbenchExtension.outputXmlFilePath              | Text path              | results/output.xml   | Path to the Robot Framework output XML used for execution result import (relative to workspace).                                |

## Test Generation

| Setting                                                   | Setting ID                                                             | Value Type | Default | Description                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------- |
| Clear Internal Testbench Directory Before Test Generation | testbenchExtension.clearInternalTestbenchDirectoryBeforeTestGeneration | On/Off     | false   | Clears internal `.testbench` files before generation (except protected internal artifacts). |
| Open Testing View After Test Generation                   | testbenchExtension.openTestingViewAfterTestGeneration                  | On/Off     | false   | Opens the VS Code Testing view automatically after generation.                              |

## Connection

| Setting          | Setting ID                         | Value Type | Default | Description                                                               |
| ---------------- | ---------------------------------- | ---------- | ------- | ------------------------------------------------------------------------- |
| Certificate Path | testbenchExtension.certificatePath | Text path  | empty   | Optional custom PEM certificate path. Supports relative or absolute path. |

## Path rules

- All path settings are workspace-relative except `certificatePath`.
- `certificatePath` supports both absolute and relative values.

Example:

- workspace: `C:\\MyWorkspace`
- outputDirectory value for `C:\\MyWorkspace\\tests`: `tests`

## Certificate and TLS configuration

Use **certificatePath** only when your TestBench server uses a self-signed or private CA certificate.

Certificate validation behavior:

1. If **certificatePath** is configured, extension validation uses both the provided certificate and system trust.
2. If **certificatePath** is empty, **NODE_EXTRA_CA_CERTS** is checked.
3. If neither is configured, only system trust is used.

Alternative environment variable approach:

- Windows: set `NODE_EXTRA_CA_CERTS=C:\\path\\to\\certificate.pem` and restart VS Code.
- Linux/macOS: export `NODE_EXTRA_CA_CERTS=/path/to/certificate.pem`, then restart terminal and VS Code.

## Logging behavior

- Logs are stored under `.testbench` in workspace.
- Up to 3 log files are retained.
- Each log file rotates at 10 MB.
