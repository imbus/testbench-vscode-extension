---
sidebar_position: 1
title: Introduction
---

TestBench Extension for Visual Studio Code connects TestBench and Robot Framework directly inside VS Code.

## What you can do

With the extension, you can:

- browse TestBench projects, test object versions (TOVs), test cycles, subdivisions, and keywords,
- generate Robot Framework test suites from TestBench structures,
- synchronize keywords bidirectionally between VS Code and TestBench,
- import Robot Framework execution results back into TestBench.

## Requirements

See [Installation](getting-started/installation#requirements) for the supported versions of VS Code, Python, and TestBench.

## Terminology

| Term                      | Meaning                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Project                   | Top-level container in TestBench.                                                                                                               |
| Test Object Version (TOV) | A version of the test object within a project. It holds the test specification: the test theme tree and the test elements.                      |
| Test Cycle                | A test run that belongs to a TOV. Tests are executed and results are recorded in a cycle, so execution results can only be uploaded to a cycle. |
| Test Theme                | A structuring node in the test theme tree. Test themes contain other test themes or test case sets.                                             |
| Test Case Set             | A group of test cases below a test theme. Each test case set is generated as one Robot Framework `.robot` suite file.                           |
| Subdivision               | A grouping node in the test elements of a TOV. Subdivisions marked as resources are mapped to Robot Framework `.resource` files.                |
| Keyword                   | A TestBench keyword inside a subdivision. It corresponds to a Robot Framework keyword and is linked to it by its UID.                           |
| Context                   | The TOV or cycle that is currently opened in **Test Themes View** and **Test Elements View**.                                                   |

## Repository

See the source code of the extension in the
[TestBench VS Code extension GitHub repository](https://github.com/imbus/testbench-vscode-extension).

## Contents

- [Installation](getting-started/installation)
- [Quickstart](getting-started/quickstart)
- [Main Views](views/main-views)
- [Projects View](views/projects-view)
- [Test Themes View](views/test-themes-view)
- [Test Elements View](views/test-elements-view)
- [Settings Reference](configuration/settings-reference)
- [Troubleshooting](troubleshooting/)
