---
sidebar_position: 6
title: Settings Reference
---

Settings are grouped in VS Code under:

- Login
- Logger
- TestBench2RobotFramework
- Test Generation
- Connection

## Login

| Setting                                | Value Type | Default | Description                                            |
| -------------------------------------- | ---------- | ------- | ------------------------------------------------------ |
| automaticLoginAfterExtensionActivation | On/Off     | false   | Attempts login with last active connection on startup. |

## Logger

| Setting           | Value Type             | Default | Description                                                          |
| ----------------- | ---------------------- | ------- | -------------------------------------------------------------------- |
| testbenchLogLevel | One option from a list | Info    | Log threshold. Options: No logging, Trace, Debug, Info, Warn, Error. |

## TestBench2RobotFramework

| Setting                        | Value Type             | Default              | Description                                                                                      |
| ------------------------------ | ---------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| cleanFilesBeforeTestGeneration | On/Off                 | true                 | Clears output directory before generation.                                                       |
| fullyQualifiedKeywords         | On/Off                 | false                | Uses fully qualified keyword calls in generated suites, for example `ResourceOrLibrary.Keyword`. |
| outputDirectory                | Text path              | tests                | Relative path for generated `.robot` suites.                                                     |
| compoundKeywordLogging         | One option from a list | GROUP                | Logging mode for compound keywords: GROUP, COMMENT, NONE.                                        |
| logSuiteNumbering              | On/Off                 | false                | Adds numbering prefixes to generated suite folder and file names, for example `1_Name.robot`.    |
| resourceDirectoryPath          | Text path              | empty                | Relative base path for generated/managed `.resource` files.                                      |
| resourceRootRegex              | Text pattern (regex)   | resources            | Cut point regex for mapping subdivision hierarchy to local path.                                 |
| libraryMarker                  | List of text values    | ["[Robot-Library]"]  | Marker suffixes identifying library subdivisions.                                                |
| libraryRoot                    | List of text values    | ["RF", "RF-Library"] | Root nodes used to identify library hierarchy.                                                   |
| resourceMarker                 | List of text values    | ["[Robot-Resource]"] | Marker suffixes identifying resource subdivisions.                                               |
| resourceRoot                   | List of text values    | ["RF-Resource"]      | Root nodes used to identify resource hierarchy.                                                  |
| libraryMapping                 | List of text values    | []                   | Custom subdivision-to-library import mappings.                                                   |
| resourceMapping                | List of text values    | []                   | Custom subdivision-to-resource import mappings.                                                  |
| outputXmlFilePath              | Text path              | results/output.xml   | Relative path to Robot Framework execution result XML.                                           |

## Test Generation

| Setting                                             | Value Type | Default | Description                                                                                 |
| --------------------------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------- |
| clearInternalTestbenchDirectoryBeforeTestGeneration | On/Off     | false   | Clears internal `.testbench` files before generation (except protected internal artifacts). |
| openTestingViewAfterTestGeneration                  | On/Off     | false   | Opens VS Code Testing view automatically after generation.                                  |

## Connection

| Setting         | Value Type | Default | Description                                                               |
| --------------- | ---------- | ------- | ------------------------------------------------------------------------- |
| certificatePath | Text path  | empty   | Optional custom PEM certificate path. Supports relative or absolute path. |

## Path rules

- all path settings are workspace-relative except `certificatePath`
- `certificatePath` supports absolute and relative values

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
