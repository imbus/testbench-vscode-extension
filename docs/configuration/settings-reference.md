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

| Setting                                | Type    | Default | Description                                            |
| -------------------------------------- | ------- | ------- | ------------------------------------------------------ |
| automaticLoginAfterExtensionActivation | boolean | false   | Attempts login with last active connection on startup. |

## Logger

| Setting           | Type | Default | Description                                                         |
| ----------------- | ---- | ------- | ------------------------------------------------------------------- |
| testbenchLogLevel | enum | Info    | Log threshold. Values: No logging, Trace, Debug, Info, Warn, Error. |

## TestBench2RobotFramework

| Setting                        | Type     | Default              | Description                                                      |
| ------------------------------ | -------- | -------------------- | ---------------------------------------------------------------- |
| cleanFilesBeforeTestGeneration | boolean  | true                 | Clears output directory before generation.                       |
| fullyQualifiedKeywords         | boolean  | false                | Uses fully qualified keyword names in generated suites.          |
| outputDirectory                | string   | tests                | Relative path for generated `.robot` suites.                     |
| compoundKeywordLogging         | enum     | GROUP                | Logging mode for compound keywords: GROUP, COMMENT, NONE.        |
| logSuiteNumbering              | boolean  | false                | Adds suite numbering output in generated content.                |
| resourceDirectoryPath          | string   | empty                | Relative base path for generated/managed `.resource` files.      |
| resourceRootRegex              | string   | resources            | Cut point regex for mapping subdivision hierarchy to local path. |
| libraryMarker                  | string[] | ["[Robot-Library]"]  | Marker suffixes identifying library subdivisions.                |
| libraryRoot                    | string[] | ["RF", "RF-Library"] | Root nodes used to identify library hierarchy.                   |
| resourceMarker                 | string[] | ["[Robot-Resource]"] | Marker suffixes identifying resource subdivisions.               |
| resourceRoot                   | string[] | ["RF-Resource"]      | Root nodes used to identify resource hierarchy.                  |
| libraryMapping                 | string[] | []                   | Custom subdivision-to-library import mappings.                   |
| resourceMapping                | string[] | []                   | Custom subdivision-to-resource import mappings.                  |
| outputXmlFilePath              | string   | results/output.xml   | Relative path to Robot Framework execution result XML.           |

## Test Generation

| Setting                                             | Type    | Default | Description                                                                                 |
| --------------------------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------- |
| clearInternalTestbenchDirectoryBeforeTestGeneration | boolean | false   | Clears internal `.testbench` files before generation (except protected internal artifacts). |
| openTestingViewAfterTestGeneration                  | boolean | false   | Opens VS Code Testing view automatically after generation.                                  |

## Connection

| Setting         | Type   | Default | Description                                                               |
| --------------- | ------ | ------- | ------------------------------------------------------------------------- |
| certificatePath | string | empty   | Optional custom PEM certificate path. Supports relative or absolute path. |

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

- logs are stored under `.testbench` in workspace
- up to 3 log files are retained
- each log file rotates at 10 MB

## Request retry behavior

- temporary network-related request failures are retried automatically
- requests are typically retried up to 3 times with a short delay between attempts before the extension reports the failure
- if a request still fails after retries because the session appears to be expired, access is forbidden, or the server is unreachable, the extension logs out locally and returns to the login view
